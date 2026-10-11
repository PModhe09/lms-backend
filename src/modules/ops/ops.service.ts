import type { ClientSession, UpdateQuery } from 'mongoose';
import { OnboardingStage, type OnboardingStage as Stage } from '../../domain/enums.ts';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../domain/errors.ts';
import { LoanStatus } from '../../domain/loan/status.ts';
import { assertTransition, SYSTEM } from '../../domain/loan/transitions.ts';
import { Money } from '../../domain/money.ts';
import type { Loan, LoanDocument } from '../../infra/models/loan.model.ts';
import { isDuplicateKeyError } from '../../infra/mongo.ts';
import type { ObjectStorage } from '../../infra/storage.ts';
import { inTransaction } from '../../infra/transaction.ts';
import type { SessionUser } from '../../lib/session.ts';
import { istDate, istMidnight, type Clock } from '../../lib/time.ts';
import {
  toBorrowerSummary,
  toLoanDto,
  toPaymentDto,
  type LoanDto,
  type PaymentDto,
} from '../loans/loan.dto.ts';
import type { LoanRepository } from '../loans/loan.repository.ts';
import type { Page, PageQuery } from '../shared/http.ts';
import type { UserRepository } from '../users/user.repository.ts';
import type { LeadDto, RecordPaymentBody } from './ops.schemas.ts';

const SLIP_URL_TTL_SECONDS = 300;

export class OpsService {
  constructor(
    private readonly users: UserRepository,
    private readonly loans: LoanRepository,
    private readonly storage: ObjectStorage,
    private readonly clock: Clock,
  ) {}

  async queue(status: LoanStatus, page: PageQuery): Promise<Page<LoanDto>> {
    const result = await this.loans.listByStatus(status, page);
    return { ...result, items: result.items.map((l) => toLoanDto(l)) };
  }

  async leads(stage: Stage | undefined, page: PageQuery): Promise<Page<LeadDto>> {
    const result = await this.users.listLeads(stage, page);
    return {
      ...result,
      items: result.items.map((u) => ({
        ...toBorrowerSummary(u, { withBre: true }),
        registeredAt: (u.get('createdAt') as Date).toISOString(),
      })),
    };
  }

  async detail(loanId: string): Promise<LoanDto & { payments: PaymentDto[] }> {
    const loan = await this.loans.findByIdWithBorrower(loanId);
    if (!loan) throw new NotFoundError('Loan not found');
    const payments = await this.loans.listPayments(loanId);
    return { ...toLoanDto(loan, { withBre: true }), payments: payments.map((p) => toPaymentDto(p, istDate)) };
  }

  async slipUrl(loanId: string): Promise<{ url: string; expiresInSeconds: number }> {
    const loan = await this.loans.findById(loanId);
    if (!loan) throw new NotFoundError('Loan not found');
    return {
      url: await this.storage.presignGet(loan.salarySlip.key, SLIP_URL_TTL_SECONDS),
      expiresInSeconds: SLIP_URL_TTL_SECONDS,
    };
  }

  approve(loanId: string, actor: SessionUser): Promise<LoanDto> {
    const now = this.clock();
    return this.move(loanId, LoanStatus.APPLIED, LoanStatus.SANCTIONED, actor, {
      $set: { sanctionedAt: now, sanctionedBy: actor.id },
    });
  }

  /** Rejection frees the borrower to apply again, so they also reappear as a Sales lead. */
  reject(loanId: string, actor: SessionUser, reason: string): Promise<LoanDto> {
    const now = this.clock();
    return this.move(
      loanId,
      LoanStatus.APPLIED,
      LoanStatus.REJECTED,
      actor,
      { $set: { rejectedAt: now, rejectedBy: actor.id, rejectionReason: reason } },
      reason,
      (loan, session) => this.users.setStage(String(loan.borrowerId), OnboardingStage.SLIP_UPLOADED, session),
    );
  }

  disburse(loanId: string, actor: SessionUser): Promise<LoanDto> {
    const now = this.clock();
    return this.move(loanId, LoanStatus.SANCTIONED, LoanStatus.DISBURSED, actor, {
      $set: { disbursedAt: now, disbursedBy: actor.id },
    });
  }

  /**
   * One status change: checked against the transition table, then applied with a conditional update
   * on the expected current status, so two people clicking at once cannot both win (the loser gets 409).
   */
  private async move(
    loanId: string,
    from: LoanStatus,
    to: LoanStatus,
    actor: SessionUser,
    update: UpdateQuery<Loan>,
    note?: string,
    after?: (loan: LoanDocument, session: ClientSession) => Promise<void>,
  ): Promise<LoanDto> {
    assertTransition(from, to, actor.role);
    await inTransaction(async (session) => {
      const updated = await this.loans.updateIfState(
        loanId,
        { status: from },
        {
          ...update,
          $set: { ...update.$set, status: to },
          $push: { statusHistory: { from, to, by: actor.id, at: this.clock(), ...(note && { note }) } },
        },
        session,
      );
      if (!updated) {
        const current = await this.loans.findById(loanId, session);
        if (!current) throw new NotFoundError('Loan not found');
        throw new ConflictError('INVALID_STATE', `Loan is ${current.status}, expected ${from}`);
      }
      await after?.(updated, session);
    });
    return this.detail(loanId);
  }

  async payments(loanId: string): Promise<PaymentDto[]> {
    if (!(await this.loans.findById(loanId))) throw new NotFoundError('Loan not found');
    return (await this.loans.listPayments(loanId)).map((p) => toPaymentDto(p, istDate));
  }

  /**
   * Payment and auto-close in one transaction. If two payments race on the same loan, Mongo aborts one
   * with a WriteConflict, the driver retries it, and the retry re-reads the smaller outstanding.
   */
  async recordPayment(
    loanId: string,
    actor: SessionUser,
    input: RecordPaymentBody,
  ): Promise<{ payment: PaymentDto; loan: LoanDto }> {
    try {
      const payment = await inTransaction(async (session) => {
        const loan = await this.loans.findById(loanId, session);
        if (!loan) throw new NotFoundError('Loan not found');
        if (loan.status !== LoanStatus.DISBURSED || !loan.disbursedAt) {
          throw new ConflictError(
            'INVALID_STATE',
            `Payments can only be recorded on DISBURSED loans (this one is ${loan.status})`,
          );
        }

        const total = Money.ofPaise(loan.totalRepaymentPaise);
        const paid = Money.ofPaise(loan.amountPaidPaise);
        const outstanding = total.subtract(paid);
        const amount = Money.ofPaise(input.amountPaise);
        if (amount.greaterThan(outstanding)) {
          throw new BusinessRuleError(
            'OVERPAYMENT',
            `Amount exceeds the outstanding balance of ${outstanding.format()}`,
            { outstandingPaise: outstanding.paise },
          );
        }
        const disbursedOn = istDate(loan.disbursedAt);
        const today = istDate(this.clock());
        if (input.paidAt < disbursedOn || input.paidAt > today) {
          throw new BusinessRuleError(
            'INVALID_PAYMENT_DATE',
            `Payment date must be between ${disbursedOn} and ${today}`,
          );
        }

        const created = await this.loans.createPayment(
          {
            loanId: loan._id,
            utr: input.utr,
            amountPaise: amount.paise,
            paidAt: istMidnight(input.paidAt),
            recordedBy: actor.id,
          },
          session,
        );

        const newPaid = paid.add(amount);
        const closes = newPaid.equals(total);
        if (closes) assertTransition(LoanStatus.DISBURSED, LoanStatus.CLOSED, SYSTEM);
        const now = this.clock();
        const updated = await this.loans.updateIfState(
          loanId,
          { status: LoanStatus.DISBURSED, amountPaidPaise: paid.paise },
          {
            $inc: { amountPaidPaise: amount.paise },
            ...(closes && {
              $set: { status: LoanStatus.CLOSED, closedAt: now },
              $push: {
                statusHistory: { from: LoanStatus.DISBURSED, to: LoanStatus.CLOSED, by: SYSTEM, at: now },
              },
            }),
          },
          session,
        );
        if (!updated)
          throw new ConflictError('INVALID_STATE', 'Loan changed while recording the payment; retry');
        if (closes)
          await this.users.setStage(String(loan.borrowerId), OnboardingStage.SLIP_UPLOADED, session);
        return created;
      });
      return { payment: toPaymentDto(payment, istDate), loan: await this.detail(loanId) };
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        throw new ConflictError('DUPLICATE_UTR', 'A payment with this UTR has already been recorded');
      }
      throw err;
    }
  }
}
