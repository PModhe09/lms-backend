export const LoanStatus = {
  APPLIED: 'APPLIED',
  SANCTIONED: 'SANCTIONED',
  REJECTED: 'REJECTED',
  DISBURSED: 'DISBURSED',
  CLOSED: 'CLOSED',
} as const;
export type LoanStatus = (typeof LoanStatus)[keyof typeof LoanStatus];
export const LOAN_STATUSES = Object.values(LoanStatus);

/** A borrower may hold at most one loan in these states (partial unique index). */
export const OPEN_LOAN_STATUSES: readonly LoanStatus[] = [
  LoanStatus.APPLIED,
  LoanStatus.SANCTIONED,
  LoanStatus.DISBURSED,
];
