import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { deriveFacts, evaluate } from '../../domain/bre/evaluate.ts';
import { BRE_RULES } from '../../domain/bre/rules.ts';
import { OnboardingStage } from '../../domain/enums.ts';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../domain/errors.ts';
import { LoanStatus } from '../../domain/loan/status.ts';
import { CURRENCY, DEFAULT_RATE_BPS, Money, simpleInterest } from '../../domain/money.ts';
import type { UserDocument } from '../../infra/models/user.model.ts';
import { isDuplicateKeyError } from '../../infra/mongo.ts';
import type { ObjectStorage } from '../../infra/storage.ts';
import { inTransaction } from '../../infra/transaction.ts';
import { sniffSlipType, type SlipMime } from '../../lib/file-type.ts';
import { istDate, type Clock } from '../../lib/time.ts';
import { toLoanDto, toPaymentDto, type LoanDto } from '../loans/loan.dto.ts';
import type { LoanRepository } from '../loans/loan.repository.ts';
import type { UserRepository } from '../users/user.repository.ts';
import type { ApplyBody, ProfileBody, ProfileDto } from './borrower.schemas.ts';

const EDITABLE_STAGES: readonly OnboardingStage[] = [
  OnboardingStage.REGISTERED,
  OnboardingStage.BRE_REJECTED,
  OnboardingStage.DETAILS_SUBMITTED,
  OnboardingStage.SLIP_UPLOADED,
];
const UPLOAD_STAGES: readonly OnboardingStage[] = [
  OnboardingStage.DETAILS_SUBMITTED,
  OnboardingStage.SLIP_UPLOADED,
];

export const SLIP_MAX_BYTES = 5 * 1024 * 1024;
export const SLIP_CONTENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const DIRECT_UPLOAD_TTL_SECONDS = 300;
/** Keys the client may upload to: its own folder, a UUID name, an allowed extension. */
const slipKeyPattern = (userId: string) =>
  new RegExp(
    `^slips/${userId}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(pdf|jpg|jpeg|png)$`,
  );

export function toProfileDto(user: UserDocument): ProfileDto {
  const p = user.borrowerProfile;
  const slip = user.salarySlip;
  const bre = user.breResult;
  return {
    onboardingStage: user.onboardingStage ?? OnboardingStage.REGISTERED,
    ...(p && {
      profile: {
        fullName: p.fullName,
        pan: p.pan,
        dob: p.dob.toISOString().slice(0, 10),
        monthlySalaryPaise: p.monthlySalaryPaise,
        employmentMode: p.employmentMode,
      },
    }),
    ...(slip && {
      salarySlip: {
        mime: slip.mime,
        size: slip.size,
        originalName: slip.originalName,
        uploadedAt: slip.uploadedAt.toISOString(),
      },
    }),
    ...(bre && {
      breResult: {
        passed: bre.passed,
        failures: bre.failures.map(({ rule, message }) => ({ rule, message })),
        rulesVersion: bre.rulesVersion,
        evaluatedAt: bre.evaluatedAt.toISOString(),
      },
    }),
  };
}

export class BorrowerService {
  constructor(
    private readonly users: UserRepository,
    private readonly loans: LoanRepository,
    private readonly storage: ObjectStorage,
    private readonly clock: Clock,
  ) {}

  private async borrower(userId: string): Promise<UserDocument> {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundError('Account not found');
    return user;
  }

  async getProfile(userId: string): Promise<ProfileDto> {
    return toProfileDto(await this.borrower(userId));
  }

  /**
   * Runs the BRE on the server (the only authority). The decision is stored either way, so Sales can
   * see why a lead is stuck. A failure answers 422 with every failed rule.
   */
  async submitProfile(userId: string, input: ProfileBody): Promise<ProfileDto> {
    const user = await this.borrower(userId);
    const stage = user.onboardingStage ?? OnboardingStage.REGISTERED;
    if (!EDITABLE_STAGES.includes(stage)) {
      throw new ConflictError('LOAN_IN_PROGRESS', 'Details cannot change while a loan application is open');
    }

    const now = this.clock();
    const facts = deriveFacts(input, istDate(now));
    const decision = evaluate(BRE_RULES, facts, now);
    const nextStage = !decision.passed
      ? OnboardingStage.BRE_REJECTED
      : user.salarySlip
        ? OnboardingStage.SLIP_UPLOADED
        : OnboardingStage.DETAILS_SUBMITTED;

    const saved = await this.users.saveProfile(userId, {
      borrowerProfile: {
        fullName: input.fullName,
        pan: facts.pan,
        dob: new Date(`${input.dob}T00:00:00Z`),
        monthlySalaryPaise: input.monthlySalaryPaise,
        currency: CURRENCY,
        employmentMode: input.employmentMode,
      },
      breResult: decision,
      onboardingStage: nextStage,
    });

    if (!decision.passed) {
      throw new BusinessRuleError(
        'BRE_REJECTED',
        'Application does not meet eligibility rules',
        decision.failures,
      );
    }
    return toProfileDto(saved);
  }

  private async assertCanUpload(userId: string): Promise<void> {
    const user = await this.borrower(userId);
    if (!UPLOAD_STAGES.includes(user.onboardingStage ?? OnboardingStage.REGISTERED)) {
      throw new ConflictError(
        'STAGE_INVALID',
        'Submit eligible personal details before uploading a salary slip',
      );
    }
  }

  /** Upload through the API (multipart). Used locally and wherever the platform allows 5 MB request bodies. */
  async uploadSlip(userId: string, file: Express.Multer.File | undefined): Promise<ProfileDto> {
    if (!file) throw new BusinessRuleError('INVALID_FILE', 'Attach a file in the "file" field');
    await this.assertCanUpload(userId);
    const type = sniffSlipType(file.buffer);
    if (!type) throw new BusinessRuleError('INVALID_FILE', 'Only PDF, JPG or PNG files are accepted');

    // Server-chosen key: the client's file name never becomes a path.
    const key = `slips/${userId}/${randomUUID()}.${type.ext}`;
    await this.storage.put(key, file.buffer, type.mime);
    return this.recordSlip(userId, key, type.mime, file.size, file.originalname);
  }

  /** Tells the client whether to upload straight to storage, and the limits it must respect. */
  uploadOptions(userId: string) {
    return {
      mode: this.storage.directUpload ? ('direct' as const) : ('server' as const),
      maxBytes: SLIP_MAX_BYTES,
      contentTypes: SLIP_CONTENT_TYPES,
      keyPrefix: `slips/${userId}/`,
    };
  }

  /**
   * Answers the storage SDK's presign request for a browser-to-storage upload. The URL is scoped to one
   * pathname in the caller's own folder, expires in 5 minutes, and is capped at 5 MB and the allowed types.
   */
  async presignSlipUpload(userId: string, body: unknown, request: IncomingMessage): Promise<unknown> {
    if (!this.storage.directUpload) {
      throw new ConflictError(
        'DIRECT_UPLOAD_UNAVAILABLE',
        'Upload the file to /borrower/salary-slip instead',
      );
    }
    await this.assertCanUpload(userId);
    const pattern = slipKeyPattern(userId);
    return this.storage.directUpload(body, request, {
      authorize: (pathname) => {
        if (!pattern.test(pathname)) throw new BusinessRuleError('INVALID_FILE', 'Upload path not allowed');
      },
      maxBytes: SLIP_MAX_BYTES,
      contentTypes: SLIP_CONTENT_TYPES,
      ttlSeconds: DIRECT_UPLOAD_TTL_SECONDS,
    });
  }

  /**
   * After a direct upload: the server reads what actually landed in storage and applies the same checks
   * as the multipart path (size, magic bytes). A file that fails is deleted.
   */
  async confirmSlipUpload(userId: string, key: string, originalName: string): Promise<ProfileDto> {
    if (!slipKeyPattern(userId).test(key)) throw new NotFoundError('Upload not found');
    await this.assertCanUpload(userId);
    const info = await this.storage.inspect(key, 16);
    if (!info) throw new NotFoundError('Upload not found');
    const type = sniffSlipType(info.head);
    if (!type || info.size > SLIP_MAX_BYTES) {
      await this.storage.remove(key);
      throw new BusinessRuleError(
        'INVALID_FILE',
        type ? 'File is larger than 5 MB' : 'Only PDF, JPG or PNG files are accepted',
      );
    }
    return this.recordSlip(userId, key, type.mime, info.size, originalName);
  }

  private async recordSlip(userId: string, key: string, mime: SlipMime, size: number, originalName: string) {
    const saved = await this.users.saveSalarySlip(userId, {
      key,
      mime,
      size,
      originalName: originalName.slice(0, 200) || 'salary-slip',
      uploadedAt: this.clock(),
    });
    return toProfileDto(saved);
  }

  async apply(userId: string, input: ApplyBody): Promise<LoanDto> {
    const principal = Money.ofPaise(input.principalPaise);
    const interest = simpleInterest(principal, DEFAULT_RATE_BPS, input.tenureDays);
    try {
      const loan = await inTransaction(async (session) => {
        const user = await this.users.findById(userId, session);
        if (!user) throw new NotFoundError('Account not found');
        if (user.onboardingStage === OnboardingStage.APPLIED) throw openLoanExists();
        if (user.onboardingStage !== OnboardingStage.SLIP_UPLOADED || !user.salarySlip) {
          throw new ConflictError('STAGE_INVALID', 'Complete personal details and salary slip upload first');
        }
        const now = this.clock();
        const created = await this.loans.create(
          {
            borrowerId: user._id,
            principalPaise: principal.paise,
            tenureDays: input.tenureDays,
            rateBps: DEFAULT_RATE_BPS,
            interestPaise: interest.paise,
            totalRepaymentPaise: principal.add(interest).paise,
            amountPaidPaise: 0,
            currency: CURRENCY,
            status: LoanStatus.APPLIED,
            salarySlip: user.salarySlip,
            statusHistory: [{ from: null, to: LoanStatus.APPLIED, by: userId, at: now }],
          },
          session,
        );
        await this.users.setStage(userId, OnboardingStage.APPLIED, session);
        return created;
      });
      return toLoanDto(loan);
    } catch (err) {
      // The partial unique index is the real guard against two concurrent applications.
      if (isDuplicateKeyError(err)) throw openLoanExists();
      throw err;
    }
  }

  async listLoans(userId: string): Promise<LoanDto[]> {
    return (await this.loans.listForBorrower(userId)).map((l) => toLoanDto(l));
  }

  async getLoan(userId: string, loanId: string) {
    const loan = await this.loans.findOwned(loanId, userId);
    if (!loan) throw new NotFoundError('Loan not found');
    const payments = await this.loans.listPayments(loanId);
    return { ...toLoanDto(loan), payments: payments.map((p) => toPaymentDto(p, istDate)) };
  }
}

const openLoanExists = () =>
  new ConflictError('OPEN_LOAN_EXISTS', 'You already have an open loan application');
