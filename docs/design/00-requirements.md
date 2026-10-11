# 00 — Requirements

Source: `lms-docs/LMS_Assignment (1).pdf`. This doc restates the spec in our own words, fills the gaps
the spec leaves open, and lists what was considered but not built. Every later design doc traces back to this one.

## Actors

| Actor | Where they work | What they do |
|---|---|---|
| Borrower | Borrower portal | Signs up, submits personal details, uploads salary slip, applies for a loan |
| Sales executive | Dashboard → Sales | Sees registered borrowers who have not applied yet (leads) |
| Sanction executive | Dashboard → Sanction | Approves or rejects applied loans (reject needs a reason) |
| Disbursement executive | Dashboard → Disbursement | Marks sanctioned loans as disbursed |
| Collection executive | Dashboard → Collection | Records repayments against disbursed loans |
| Admin | Dashboard → all modules | Everything the four executive roles can do |
| System | — | Auto-closes a loan when it is fully repaid |

## Core flows (Actor → Action → Result)

1. Borrower → signs up with email + password → account with role `BORROWER`, onboarding stage `REGISTERED`.
2. Borrower → submits name, PAN, DOB, salary, employment mode → server runs BRE.
   - Pass → stage `DETAILS_SUBMITTED`.
   - Fail → stage `BRE_REJECTED`, response lists every failed rule. Borrower can edit and retry.
3. Borrower → uploads salary slip (PDF/JPG/PNG, ≤ 5 MB) → file stored in object storage → stage `SLIP_UPLOADED`.
4. Borrower → picks amount (₹50,000–₹5,00,000) and tenure (30–365 days) with sliders, sees live SI → clicks Apply
   → server recomputes the numbers and creates a loan in status `APPLIED` → stage `APPLIED`.
5. Sanction exec → approves → `SANCTIONED`, or rejects with a reason → `REJECTED`.
6. Disbursement exec → marks disbursed → `DISBURSED` (repayment clock starts).
7. Collection exec → records payment (UTR, amount, date) → outstanding goes down.
   When outstanding reaches 0 → system sets `CLOSED`.

## Business rules

| Rule | Value | Notes |
|---|---|---|
| Age | 23 ≤ age ≤ 50, inclusive | Age in completed years on the server's current date, Asia/Kolkata timezone |
| Salary | ≥ ₹25,000 per month | ₹24,999 fails, ₹25,000 passes |
| PAN | `^[A-Z]{5}[0-9]{4}[A-Z]$` | Uppercased before checking. Fourth letter = holder type (`P` = individual). We accept any valid type letter, see 02-domain-model |
| Employment | Not `UNEMPLOYED` | `SALARIED` and `SELF_EMPLOYED` pass |
| Loan amount | ₹50,000 – ₹5,00,000 | Slider step ₹1,000 |
| Tenure | 30 – 365 days | Slider step 1 day |
| Interest | 12% p.a., simple | `SI = P × R × T / (365 × 100)`, total = P + SI |
| Payment UTR | Unique across all payments | Enforced by a unique DB index, not only by a lookup |
| Payment amount | 0 < amount ≤ outstanding | No overpayment |
| Payment date | disbursedAt ≤ date ≤ today | Cannot pay before money went out, cannot pay in the future |

## Gaps the spec leaves open, and our answers

Each answer follows how large lenders and platforms solve the same problem, scaled to this assignment.

| Question | How big tech does it | Our decision |
|---|---|---|
| Where does BRE run? | Server-side decision service. Rules stored as versioned data, every decision logged, client gets rules from the server. | Same shape, scoped down (`adr/0004`): rules are a versioned data constant run by a generic evaluator, latest decision stored on the user with its rule version, client fetches `GET /bre/rules`. |
| How many loans per borrower? | Exposure limits: a cap on total outstanding per borrower, checked on every new loan and enforced in the database, not only in code. | One open loan (APPLIED, SANCTIONED or DISBURSED) at a time, enforced by a partial unique index. This is the simplest exposure limit. Reapply after REJECTED or CLOSED. |
| Can a borrower retry after BRE fails? | Retries allowed, but every attempt is logged. Changing key facts (DOB, salary) after a rejection is a fraud signal. Declared data is later verified against documents or bureau data. Some lenders add a cool-off period. | Retry allowed. Latest result stored in `users.breResult`. Attempt log, cool-off and PAN verification are next steps (table below). |
| Partial payments? | Payments are an append-only ledger. Entries are never edited or deleted; mistakes are fixed with a reversal entry. Each payment carries a unique bank reference for reconciliation and idempotency (Stripe uses an `Idempotency-Key` header). | Many payments per loan. Payments are immutable: no update or delete endpoint. The unique UTR is the natural idempotency key, so a retried request cannot double-count. Reversals are a next step. |
| Who creates staff accounts? | Internal tools use company SSO (Okta, Google Workspace) with MFA, accounts provisioned by IT (SCIM), least privilege per role. Public signup never grants staff roles. | Seed script only. Public signup always creates a `BORROWER` and ignores any `role` field. SSO and an admin user-management screen are next steps. |
| Unauthorized status code? | 401 = not authenticated, 403 = authenticated but not allowed. For resources the caller should not know exist, return 404 (GitHub returns 404 for private repos you cannot access). | 401 / 403 for module access. 404 when a borrower asks for someone else's loan, so loan IDs cannot be probed. |

## Non-functional requirements

- Security: bcrypt (cost 12) for passwords, httpOnly cookie for JWT, RBAC on every ops route, private file bucket.
- Correctness: money stored as integer paise. No floating point in persisted amounts.
- Consistency: recording a payment and closing a loan happen in one Mongo transaction.
- Operability: `docker compose up` brings up the full system with seeded users.
- Responsiveness: borrower portal and dashboard usable at 375 px width.

## Considered, not built

Each item below is how big tech does it. We designed around it so it can be added later without a rewrite.
The README repeats this list as "next steps" so the evaluator sees the cuts were on purpose.

| Practice | How big tech does it | Why not now | Hook already in the design |
|---|---|---|---|
| Refresh tokens + revocation | 15-min access token, rotating refresh token, `tokenVersion` to kill sessions on logout or role change | No role-change UI, 1-day token is acceptable for a demo | JWT payload and `authenticate` middleware are one place to change |
| Staff SSO | Okta / Google Workspace with MFA, accounts provisioned via SCIM | Evaluator needs seeded password logins | Staff accounts already separate from public signup |
| `Idempotency-Key` header | Stripe: client sends a key, retries return the first response | Natural keys already give idempotency: unique UTR for payments, one-open-loan index for apply | Could add middleware + TTL collection |
| Payment reversals | Append-only ledger; wrong entry fixed with a negative reversal entry, never edited | Changes the state machine (CLOSED → DISBURSED reopen) | Payments already immutable, no update/delete route |
| Credit bureau / PAN verification | CIBIL score and PAN-vs-name check via a KYC vendor (NSDL, Karza) after BRE | Paid APIs | Adapter interface, sketched in `adr/0006` |
| BRE rules in DB, decision log, cool-off, shadow testing | Risk team edits versioned rules without deploys, every attempt logged, cool-off stops gaming, new rules tested in shadow | Beyond the spec | Rules already pure data (`adr/0004`) |
| Audit log | Append-only `audit_events` written in the same transaction as each change | Beyond the spec; `statusHistory` on each loan covers who/when | Designed in `adr/0005` |
| Notifications (SMS/email) | Outbox relay publishes to a broker; notification service sends | No provider accounts | Transactional outbox designed in `adr/0005` |
| Real A-B rule split | % of traffic decided by a new rule set | Needs volume + compliance review | — |
| EMI schedules, penalties, password reset, admin user-management UI | Standard lending features | Not in the spec | — |
