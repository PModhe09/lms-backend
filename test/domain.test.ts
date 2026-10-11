import { describe, expect, it } from 'vitest';
import { ConflictError, ForbiddenError } from '../src/domain/errors.ts';
import { LoanStatus, LOAN_STATUSES } from '../src/domain/loan/status.ts';
import { assertTransition, SYSTEM, TRANSITIONS, type Actor } from '../src/domain/loan/transitions.ts';
import { ROLES } from '../src/domain/enums.ts';
import { DEFAULT_RATE_BPS, Money, simpleInterest } from '../src/domain/money.ts';

describe('simpleInterest', () => {
  it.each([
    // ₹50,000 × 12% × 30 / 365 = ₹493.150684… → 49,315 paise
    [5_000_000, 30, 49_315],
    // ₹5,00,000 × 12% × 365 / 365 = ₹60,000 exactly
    [50_000_000, 365, 6_000_000],
    // ₹1,00,000 × 12% × 100 / 365 = ₹3,287.671… → 328,767 paise
    [10_000_000, 100, 328_767],
    // ₹50,000 × 12% × 73 / 365 = ₹1,200 exactly
    [5_000_000, 73, 120_000],
  ])('%i paise for %i days → %i paise', (principal, days, expected) => {
    expect(simpleInterest(Money.ofPaise(principal), DEFAULT_RATE_BPS, days).paise).toBe(expected);
  });

  it('rounds half up', () => {
    // 1 paisa × 1200 bps × 1825 days / 3,650,000 = 0.6 → 1; × 1520.83 days ≈ 0.5
    expect(simpleInterest(Money.ofPaise(1), 1200, 1825).paise).toBe(1);
    expect(simpleInterest(Money.ofPaise(1), 1200, 1).paise).toBe(0);
  });
});

describe('Money', () => {
  it('rejects fractional paise', () => {
    expect(() => Money.ofPaise(1.5)).toThrow(RangeError);
  });
  it('formats in Indian grouping', () => {
    expect(Money.ofPaise(10_000_000).format()).toBe('₹1,00,000.00');
  });
});

describe('assertTransition', () => {
  const actors: Actor[] = [...ROLES, SYSTEM];
  for (const from of LOAN_STATUSES) {
    for (const to of LOAN_STATUSES) {
      const row = TRANSITIONS.find((t) => t.from === from && t.to === to);
      for (const actor of actors) {
        const allowed = row?.by.includes(actor) ?? false;
        it(`${from} → ${to} by ${actor}: ${allowed ? 'allowed' : 'refused'}`, () => {
          if (allowed) expect(() => assertTransition(from, to, actor)).not.toThrow();
          else expect(() => assertTransition(from, to, actor)).toThrow(row ? ForbiddenError : ConflictError);
        });
      }
    }
  }

  it('only the system can close a loan', () => {
    expect(() => assertTransition(LoanStatus.DISBURSED, LoanStatus.CLOSED, 'ADMIN')).toThrow(ForbiddenError);
  });
});
