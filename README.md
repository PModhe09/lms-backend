# LMS — Loan Management System (API)

Express + TypeScript + MongoDB API for a small-ticket personal loan product: a **borrower portal**
(sign up → personal details + eligibility → salary slip → choose amount/tenure → apply) and an
**operations dashboard** (Sales, Sanction, Disbursement, Collection; Admin sees all) with RBAC enforced on every route.

Frontend: [lms-frontend](https://github.com/PModhe09/lms-frontend) · Design docs: [`docs/design`](docs/design/README.md)

## Run it locally (one command)

Requires Docker. Clone both repos side by side:

```bash
git clone https://github.com/PModhe09/lms-backend && git clone https://github.com/PModhe09/lms-frontend
cd lms-backend
cp .env.example .env
docker compose up --build
```

Open **http://localhost:3000**. Compose starts MongoDB (single-node replica set, needed for transactions),
SeaweedFS (S3-compatible storage), the API on :4000, the web app on :3000, and seeds the accounts below.

## Demo accounts

| Role | Email | Password | Lands on |
|---|---|---|---|
| Admin | admin@lms.dev | Admin@123 | Dashboard, all four modules |
| Sales | sales@lms.dev | Sales@123 | Sales leads |
| Sanction | sanction@lms.dev | Sanction@123 | Sanction queue |
| Disbursement | disbursement@lms.dev | Disburse@123 | Disbursement queue |
| Collection | collection@lms.dev | Collect@123 | Collection queue |
| Borrower | borrower@lms.dev | Borrower@123 | Borrower portal (or sign up a new one) |

Public signup always creates a `BORROWER`; staff accounts come only from the seed (`npm run seed`, idempotent).

## Tests

```bash
npm test          # 343 tests: domain units + HTTP integration on an in-memory Mongo replica set (no Docker)
npm run lint && npm run typecheck
```

Highlights: BRE boundaries (age 22/23/50/51 on the exact birthday, salary ₹24,999/₹25,000, PAN shapes),
simple-interest rounding, every state-machine transition × actor, an **RBAC matrix** (every ops route × every
role → 401/403/allowed), IDOR (another borrower's loan → 404), and real races: concurrent applies (one 201,
one 409), approve vs reject (one wins), two payments that together would overpay (one 201, one 422).
The frontend repo has Playwright E2E for the full lifecycle in a browser.

## Architecture

```
Browser ──► Next.js (Vercel) ──rewrite /api/*──► Express API ──► MongoDB (replica set / Atlas)
                                                      └──────► Object storage (SeaweedFS/S3 locally, Vercel Blob live)
```

- **Layers:** routes → controller (Zod-parses input) → service (business rules) → repository (Mongoose) → domain (pure TS).
- **Auth:** JWT (HS256, 1 day) in an `httpOnly`, `SameSite=Lax` cookie. The web app proxies `/api/*`, so the cookie is first-party and no CORS is needed ([ADR 0001](docs/design/adr/0001-auth-cookie-across-domains.md)).
- **RBAC:** a permission map per role; `authenticate` + `authorize(permission)` at router level, so a new route under a module cannot skip the check. Ownership is checked in queries (`{_id, borrowerId}`) and returns 404.
- **BRE:** server is the only authority. Rules are versioned data run by a generic evaluator; the client fetches the same rules from `GET /api/bre/rules` for instant hints ([ADR 0004](docs/design/adr/0004-bre-server-authoritative.md)).
- **Money:** integer paise + `currency: 'INR'` through a `Money` value object. SI = P × R × T / (365 × 100), computed once at apply, rounded half-up ([ADR 0003](docs/design/adr/0003-money-as-integer-paise.md)).
- **Loan state machine:** `APPLIED → SANCTIONED | REJECTED → DISBURSED → CLOSED`, as a transition table. Status changes are conditional updates on the expected status (optimistic concurrency → 409). `CLOSED` is set only by the system inside the payment transaction.
- **Payments:** append-only ledger with a unique UTR index. Payment insert + loan update + auto-close run in one Mongo transaction; concurrent payments are serialized by write conflicts and retried.
- **Uploads:** multer in memory (5 MB cap) → magic-byte type check (the name and `Content-Type` are ignored) → private bucket under a server-chosen key. Staff view slips through 5-minute presigned URLs ([ADR 0002](docs/design/adr/0002-salary-slip-storage.md)).
- **Errors:** one envelope everywhere: `{ error: { code, message, details }, requestId }`. 400 schema, 401 not logged in, 403 wrong role, 404 not found/not yours, 409 state conflict, 422 business rule.
- **API contract:** Zod schemas → OpenAPI 3.1 (`openapi.json`, also served at `/api/openapi.json`) → frontend types via `openapi-typescript`.

## API

| Method | Path | Who |
|---|---|---|
| POST | `/api/auth/signup`, `/api/auth/login`, `/api/auth/logout` · GET `/api/auth/me` | public / any |
| GET | `/api/bre/rules` | borrower |
| GET/PUT | `/api/borrower/profile` | borrower (PUT runs the BRE) |
| POST | `/api/borrower/salary-slip` (multipart `file`) | borrower |
| GET/POST | `/api/borrower/loans` · GET `/api/borrower/loans/:id` | borrower (own loans only) |
| GET | `/api/ops/sales/leads?stage=` | Sales, Admin |
| GET | `/api/ops/sanction/loans` · `/:id/salary-slip` · POST `/:id/approve` · `/:id/reject` | Sanction, Admin |
| GET | `/api/ops/disbursement/loans` · POST `/:id/disburse` | Disbursement, Admin |
| GET | `/api/ops/collection/loans` · `/:id/payments` · POST `/:id/payments` | Collection, Admin |
| GET | `/api/ops/loans/:id` | any ops module reader |
| GET | `/api/healthz`, `/api/openapi.json` | public |

Full detail: [`docs/design/04-api-contract.md`](docs/design/04-api-contract.md) and `openapi.json`.

## Decisions on the open questions

| Question | Decision |
|---|---|
| Where does the BRE run? | Server decides; client shows hints from the server's rule set. A rule the server does not check is not a rule. |
| Loans per borrower | One open loan (APPLIED/SANCTIONED/DISBURSED) at a time, enforced by a partial unique index. Reapply after REJECTED or CLOSED. |
| Retry after BRE failure | Allowed; the latest decision (with rule version and failures) is stored so Sales can see why a lead is stuck. |
| Partial payments | Yes, many per loan; no overpayment; date between disbursement and today (IST); UTR unique across all payments. |
| Staff accounts | Seed only; signup ignores any `role` field. |
| 401 vs 403 vs 404 | 401 not logged in, 403 role lacks permission, 404 for someone else's loan (no ID probing). |

## Configuration

See [`.env.example`](.env.example). The process validates its environment with Zod at boot and refuses to start on a missing or malformed value.

## Deployment (live)

Both apps run on Vercel (region `bom1`):

- **API** — project `lms-api`. Vercel runs `npm run build` (tsc) and serves `index.js` → `dist/index.js` as one Fluid-compute function; the Mongo connection is opened lazily and reused across invocations.
- **Database** — MongoDB Atlas (replica set by default, so transactions work). `MONGO_URI` is a project env var.
- **Slips** — a private Vercel Blob store (`STORAGE_DRIVER=blob`); staff get presigned GET URLs.
- **Web** — project `lms-web` with `API_ORIGIN` pointing at the API; `JWT_SECRET` is shared so the route guard can verify sessions.

Known platform limit: Vercel Functions accept request bodies up to **4.5 MB**, so on the live deployment slips
between 4.5 MB and 5 MB are refused by the platform before reaching the API (locally the full 5 MB works).
The fix, if needed, is direct-to-storage client uploads with a presigned PUT ([ADR 0002](docs/design/adr/0002-salary-slip-storage.md), option 4).

## Considered, not built

How larger lenders do it, and why it was left out here. The design leaves a hook for each.

| Practice | Why not now |
|---|---|
| Refresh tokens + revocation (`tokenVersion`) | No role-change UI; 1-day token is fine for a demo |
| Staff SSO + MFA (Okta/Google) | Evaluators need seeded password logins |
| `Idempotency-Key` header | Unique UTR and the one-open-loan index already make retries safe |
| Payment reversals | Changes the state machine (CLOSED → DISBURSED); ledger is already append-only |
| PAN/KYC verification, credit bureau | Paid APIs; adapter sketched in [ADR 0006](docs/design/adr/0006-kyc-provider-adapter.md) |
| BRE rules in DB, decision log, cool-off, shadow testing | Rules are already data with a version; moving them to a collection is mechanical |
| Audit log + transactional outbox (SMS/email) | `statusHistory` covers who/when; design in [ADR 0005](docs/design/adr/0005-audit-log-and-outbox.md) |
| EMI schedules, penalties, password reset, admin user management | Not in the brief |
