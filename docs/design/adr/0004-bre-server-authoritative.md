# ADR 0004 — BRE as a server-side decision service with versioned, data-driven rules

Status: Accepted · 2026-10-10 (revised same day: big-tech shape, scoped to the assignment)

## Context
The spec asks: should BRE live on the client, server, or both?
Lenders treat eligibility as a **decision service**: the server decides, rules are data, every decision is
recorded with the rule version that made it, and the client gets its hints from the same rule definitions.

## Decision

### 1. Server is the only authority
`PUT /borrower/profile` evaluates the rules and refuses to advance the stage on failure.
Creating a loan requires stage `SLIP_UPLOADED`, which can only be reached after a server pass.

### 2. Rules are data: a versioned constant in code
`src/domain/bre/rules.ts`:
```ts
type RuleDef =
  | { id: string; type: 'RANGE';  field: 'age' | 'monthlySalary'; min?: number; max?: number; message: string }
  | { id: string; type: 'REGEX';  field: 'pan';  pattern: string;  message: string }
  | { id: string; type: 'NOT_IN'; field: 'employmentMode'; values: string[]; message: string };

export const BRE_RULES = { version: 1, rules: [
  { id: 'AGE',        type: 'RANGE',  field: 'age',           min: 23, max: 50, message: 'Age must be between 23 and 50' },
  { id: 'SALARY',     type: 'RANGE',  field: 'monthlySalary', min: 25000,       message: 'Monthly salary must be at least ₹25,000' },
  { id: 'PAN',        type: 'REGEX',  field: 'pan', pattern: '^[A-Z]{5}[0-9]{4}[A-Z]$', message: 'PAN format is invalid' },
  { id: 'EMPLOYMENT', type: 'NOT_IN', field: 'employmentMode', values: ['UNEMPLOYED'], message: 'Unemployed applicants are not eligible' },
] satisfies RuleDef[] } as const;
```
Changing a threshold = edit data + bump `version`. No `if` statements to hunt down.

### 3. Small generic evaluator (Strategy + Interpreter)
The code knows **rule types**, not rule values:
```ts
const evaluators: Record<RuleDef['type'], (rule: any, facts: Facts) => boolean> = {
  RANGE:  (r, f) => (r.min === undefined || f[r.field] >= r.min) && (r.max === undefined || f[r.field] <= r.max),
  REGEX:  (r, f) => new RegExp(r.pattern).test(f[r.field]),
  NOT_IN: (r, f) => !r.values.includes(f[r.field]),
};
```
Facts are derived first (`age` from `dob` and `today`, PAN uppercased), then every rule runs and
all failures are returned together. `today` is a parameter so tests can pin the date.

### 4. Decision recorded on the user
`users.breResult = { passed, failures[], rulesVersion, facts, evaluatedAt }`, overwritten on each check.
Answers "why was this person rejected, under which rules?" Sales sees it on the lead.

### 5. Client gets rules from the server
`GET /api/bre/rules` returns `BRE_RULES`. The frontend runs the same ~15-line evaluator over it for instant
inline errors. Thresholds are never hard-coded in the frontend. The client result is only a hint.

## Considered, not built (big-tech next steps)
| Practice | What it adds | Hook in this design |
|---|---|---|
| Rule sets in DB + admin API | Risk team changes rules without a deploy | Rules are already pure data; move the constant into a collection |
| Append-only decision log (`bre_decisions`) | Full attempt history; changed facts between attempts flag fraud | `breResult` already has the record shape |
| Cool-off after rejection | Stops gaming the rules by retrying with different numbers | Add `coolOffDays` to `RuleDef` |
| Shadow evaluation | Test a new rule version next to the live one, zero customer impact | Evaluator takes a rule set as input, so running two is one extra call |
| Real A-B split | % of live traffic decided by new rules | Needs volume + compliance review |

## Why not client-only
Anyone can call the API with curl and skip the browser. A rule the server does not check is not a rule.

## Consequences
- Rule code lives once on the server; the client evaluator is generic and gets its data from the API.
- Tests: evaluator unit tests per rule type, plus boundary tests on v1
  (age 22/23/50/51, salary 24,999/25,000, PAN samples, each employment mode).
