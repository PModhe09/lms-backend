# ADR 0003 — Store money as integer paise

Status: Accepted · 2026-10-10

## Context
Amounts are summed (payments) and compared for equality (auto-close when paid == total).
JavaScript `number` is IEEE-754 double: `0.1 + 0.2 === 0.30000000000000004`.

## Decision
All persisted and API money fields are integers in paise, named with a `Paise` suffix (`principalPaise`).
Interest: `interestPaise = round(principalPaise × rateBps × tenureDays / (365 × 10000))`, rounding half up, once, at Apply.
`rateBps × / 10000` equals `R / 100` with R in percent, so this is the spec's formula with integer inputs.
Every money-bearing document and API response also carries `currency: 'INR'` (Razorpay / Stripe style: `amount` + `currency`).
In code, services never do arithmetic on raw numbers. They use a `Money` value object (Fowler's Money pattern):
`Money.ofPaise(n)`, `add`, `subtract`, `isZero`, `equals`, `compare`, `format()`. It rejects non-integers and mixing currencies.
UI converts to rupees only for display (`Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })`).

## Alternatives
- `Decimal128` in Mongo + a decimal library: exact, but every arithmetic call goes through a library and
  JSON serialization needs custom handling. Overkill for add/subtract/compare.
- Rupees as float: rejected, see context.

## Consequences
- Equality check for auto-close is exact.
- Every API consumer must know the unit. The `Paise` suffix makes it impossible to miss.
- Max safe integer 9×10^15 paise; our max loan is 5×10^7 paise.

## Concrete failure this prevents
A loan total is ₹300.30. The borrower pays ₹100.10 and then ₹200.20.

```js
100.10 + 200.20            // 300.29999999999995
100.10 + 200.20 === 300.30 // false → loan never auto-closes
10010 + 20020 === 30030    // true  (same amounts in paise)
(1.005).toFixed(2)         // "1.00" → rounding a float can round the wrong way
```

Doubles store numbers in base 2. Most decimal fractions (0.1, 0.2, 0.15) have no exact base-2 form,
so each is stored slightly wrong. Integers have no fraction, so they are always exact.

## What the industry does
| Company / standard | How money is stored or sent |
|---|---|
| Stripe | Integer in the smallest currency unit: `amount: 1000` = $10.00 |
| Razorpay | Integer paise: `amount: 50000` = ₹500.00 |
| Adyen | Integer "minor units" plus a `currency` code |
| Google APIs (`google.type.Money`) | `units` (int64 whole units) + `nanos` (int32 billionths), never a float |
| Banks / Java systems | `BigDecimal` (exact decimal type), often `NUMERIC(19,4)` in SQL |
| ISO 4217 | Defines the minor unit per currency: INR 2 decimals, JPY 0, KWD 3 |

Two common approaches: integer minor units (payments companies, most APIs) or an exact decimal type
(banks, accounting ledgers). Nobody serious uses a float. We pick integer paise because the app only
adds, subtracts and compares money, and does one division (interest) that we round once.

## If this were multi-currency
Store `{ amountMinor: number, currency: 'INR' }` and look up the minor-unit digits from ISO 4217.
The `Paise` suffix would become `Minor`. Not needed here: INR only.
