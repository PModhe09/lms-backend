import { z } from 'zod';
import { EMPLOYMENT_MODES, ONBOARDING_STAGES } from '../../domain/enums.ts';
import { LOAN_STATUSES } from '../../domain/loan/status.ts';
import type { LoanDocument } from '../../infra/models/loan.model.ts';
import type { PaymentDocument } from '../../infra/models/payment.model.ts';
import type { UserDocument } from '../../infra/models/user.model.ts';

export const SalarySlipDto = z
  .object({ mime: z.string(), size: z.number(), originalName: z.string(), uploadedAt: z.iso.datetime() })
  .meta({ id: 'SalarySlip' });

export const BreResultDto = z
  .object({
    passed: z.boolean(),
    failures: z.array(z.object({ rule: z.string(), message: z.string() })),
    rulesVersion: z.number(),
    evaluatedAt: z.iso.datetime(),
  })
  .meta({ id: 'BreResult' });

export const BorrowerSummaryDto = z
  .object({
    id: z.string(),
    email: z.string(),
    fullName: z.string().optional(),
    pan: z.string().optional(),
    monthlySalaryPaise: z.number().optional(),
    employmentMode: z.enum(EMPLOYMENT_MODES).optional(),
    onboardingStage: z.enum(ONBOARDING_STAGES).optional(),
    breResult: BreResultDto.optional(),
  })
  .meta({ id: 'BorrowerSummary' });

export const StatusChangeDto = z
  .object({
    from: z.enum(LOAN_STATUSES).nullable(),
    to: z.enum(LOAN_STATUSES),
    by: z.string(),
    at: z.iso.datetime(),
    note: z.string().optional(),
  })
  .meta({ id: 'StatusChange' });

export const LoanDto = z
  .object({
    id: z.string(),
    status: z.enum(LOAN_STATUSES),
    currency: z.literal('INR'),
    principalPaise: z.number(),
    tenureDays: z.number(),
    rateBps: z.number(),
    interestPaise: z.number(),
    totalRepaymentPaise: z.number(),
    amountPaidPaise: z.number(),
    outstandingPaise: z.number(),
    salarySlip: SalarySlipDto,
    rejectionReason: z.string().optional(),
    appliedAt: z.iso.datetime(),
    sanctionedAt: z.iso.datetime().optional(),
    rejectedAt: z.iso.datetime().optional(),
    disbursedAt: z.iso.datetime().optional(),
    closedAt: z.iso.datetime().optional(),
    statusHistory: z.array(StatusChangeDto),
    borrower: BorrowerSummaryDto.optional(),
  })
  .meta({ id: 'Loan' });

export const PaymentDto = z
  .object({
    id: z.string(),
    loanId: z.string(),
    utr: z.string(),
    amountPaise: z.number(),
    currency: z.literal('INR'),
    paidAt: z.iso.date(),
    recordedAt: z.iso.datetime(),
  })
  .meta({ id: 'Payment' });

export type LoanDto = z.infer<typeof LoanDto>;
export type PaymentDto = z.infer<typeof PaymentDto>;
export type BorrowerSummaryDto = z.infer<typeof BorrowerSummaryDto>;

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : undefined);
const defined = <T extends object>(o: T): T =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

export function toBorrowerSummary(user: UserDocument, opts: { withBre?: boolean } = {}): BorrowerSummaryDto {
  const p = user.borrowerProfile;
  const bre = user.breResult;
  return defined({
    id: user.id as string,
    email: user.email,
    fullName: p?.fullName,
    pan: p?.pan,
    monthlySalaryPaise: p?.monthlySalaryPaise,
    employmentMode: p?.employmentMode,
    onboardingStage: user.onboardingStage ?? undefined,
    breResult:
      opts.withBre && bre
        ? {
            passed: bre.passed,
            failures: bre.failures.map(({ rule, message }) => ({ rule, message })),
            rulesVersion: bre.rulesVersion,
            evaluatedAt: bre.evaluatedAt.toISOString(),
          }
        : undefined,
  });
}

/** The borrower is included when `borrowerId` was populated (ops views), omitted otherwise (borrower's own view). */
export function toLoanDto(loan: LoanDocument, opts: { withBre?: boolean } = {}): LoanDto {
  const borrower = loan.populated('borrowerId') ? (loan.borrowerId as unknown as UserDocument) : undefined;
  const slip = loan.salarySlip;
  return defined({
    id: loan.id as string,
    status: loan.status,
    currency: 'INR' as const,
    principalPaise: loan.principalPaise,
    tenureDays: loan.tenureDays,
    rateBps: loan.rateBps,
    interestPaise: loan.interestPaise,
    totalRepaymentPaise: loan.totalRepaymentPaise,
    amountPaidPaise: loan.amountPaidPaise,
    outstandingPaise: loan.totalRepaymentPaise - loan.amountPaidPaise,
    salarySlip: {
      mime: slip.mime,
      size: slip.size,
      originalName: slip.originalName,
      uploadedAt: slip.uploadedAt.toISOString(),
    },
    rejectionReason: loan.rejectionReason ?? undefined,
    appliedAt: (loan.get('createdAt') as Date).toISOString(),
    sanctionedAt: iso(loan.sanctionedAt),
    rejectedAt: iso(loan.rejectedAt),
    disbursedAt: iso(loan.disbursedAt),
    closedAt: iso(loan.closedAt),
    statusHistory: loan.statusHistory.map((h) =>
      defined({
        from: h.from ?? null,
        to: h.to,
        by: h.by,
        at: h.at.toISOString(),
        note: h.note ?? undefined,
      }),
    ),
    borrower: borrower ? toBorrowerSummary(borrower, opts) : undefined,
  });
}

export function toPaymentDto(p: PaymentDocument, istDate: (d: Date) => string): PaymentDto {
  return {
    id: p.id as string,
    loanId: String(p.loanId),
    utr: p.utr,
    amountPaise: p.amountPaise,
    currency: 'INR',
    paidAt: istDate(p.paidAt),
    recordedAt: (p.get('createdAt') as Date).toISOString(),
  };
}
