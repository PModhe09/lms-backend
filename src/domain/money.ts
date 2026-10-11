/**
 * Money as integer paise (ADR 0003). Services do arithmetic through this type, never on raw numbers,
 * so a float or a rupee/paise mix-up cannot sneak into a stored amount.
 */
export class Money {
  private constructor(readonly paise: number) {}

  static ofPaise(paise: number): Money {
    if (!Number.isSafeInteger(paise))
      throw new RangeError(`Money must be an integer number of paise, got ${paise}`);
    return new Money(paise);
  }

  static ofRupees(rupees: number): Money {
    return Money.ofPaise(Math.round(rupees * 100));
  }

  add(other: Money): Money {
    return Money.ofPaise(this.paise + other.paise);
  }

  subtract(other: Money): Money {
    return Money.ofPaise(this.paise - other.paise);
  }

  equals(other: Money): boolean {
    return this.paise === other.paise;
  }

  greaterThan(other: Money): boolean {
    return this.paise > other.paise;
  }

  isPositive(): boolean {
    return this.paise > 0;
  }

  /** `₹1,00,000.00` style, for messages only. */
  format(): string {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(this.paise / 100);
  }
}

export const CURRENCY = 'INR' as const;

/** 12% p.a. as basis points. Stored on each loan so a future rate change does not alter old loans. */
export const DEFAULT_RATE_BPS = 1200;

/**
 * Simple interest: P × R × T / (365 × 100), with R in percent. With R in basis points this is
 * P × bps × T / (365 × 10,000). Integer math throughout, rounded half-up once, at apply time.
 */
export function simpleInterest(principal: Money, rateBps: number, tenureDays: number): Money {
  const numerator = principal.paise * rateBps * tenureDays;
  const denominator = 365 * 10_000;
  return Money.ofPaise(Math.floor((2 * numerator + denominator) / (2 * denominator)));
}

export const LOAN_LIMITS = {
  minPrincipalPaise: 5_000_000, // ₹50,000
  maxPrincipalPaise: 50_000_000, // ₹5,00,000
  principalStepPaise: 100_000, // ₹1,000
  minTenureDays: 30,
  maxTenureDays: 365,
} as const;
