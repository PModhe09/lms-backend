import { Role } from '../enums.ts';
import { ConflictError, ForbiddenError } from '../errors.ts';
import { LoanStatus } from './status.ts';

export const SYSTEM = 'SYSTEM' as const;
export type Actor = Role | typeof SYSTEM;

/** The loan state machine as data. See docs/design/03-loan-state-machine.md. */
export const TRANSITIONS: readonly { from: LoanStatus; to: LoanStatus; by: readonly Actor[] }[] = [
  { from: LoanStatus.APPLIED, to: LoanStatus.SANCTIONED, by: [Role.SANCTION, Role.ADMIN] },
  { from: LoanStatus.APPLIED, to: LoanStatus.REJECTED, by: [Role.SANCTION, Role.ADMIN] },
  { from: LoanStatus.SANCTIONED, to: LoanStatus.DISBURSED, by: [Role.DISBURSEMENT, Role.ADMIN] },
  { from: LoanStatus.DISBURSED, to: LoanStatus.CLOSED, by: [SYSTEM] },
];

/** Throws unless the table allows `actor` to move a loan `from` → `to`. */
export function assertTransition(from: LoanStatus, to: LoanStatus, actor: Actor): void {
  const row = TRANSITIONS.find((t) => t.from === from && t.to === to);
  if (!row) throw new ConflictError('INVALID_STATE', `A loan cannot move from ${from} to ${to}`);
  if (!row.by.includes(actor)) throw new ForbiddenError(`${actor} cannot move a loan from ${from} to ${to}`);
}
