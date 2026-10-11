# LMS — Loan Management System (API)

Express + TypeScript + MongoDB API for a small-ticket personal loan product: a **borrower portal**
(sign up → personal details + eligibility → salary slip → choose amount/tenure → apply) and an
**operations dashboard** (Sales, Sanction, Disbursement, Collection; Admin sees all) with RBAC enforced on every route.

**Live:** https://lms-web-five-nu.vercel.app (API: https://lms-api-black.vercel.app/api/healthz) — log in with the demo accounts below.
**Demo video:** _link to be added_

**Stack:** Next.js (App Router) + TypeScript + Tailwind + shadcn/ui · Express 5 + TypeScript · MongoDB + Mongoose · JWT (httpOnly cookie) + bcrypt · Zod · Vitest, supertest, Playwright · Docker

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

### Run for development (hot reload)

```bash
docker compose up -d mongo storage        # Mongo replica set + S3 storage only
cp .env.example .env
npm install
npm run seed                              # demo accounts (idempotent)
npm run dev                               # API on http://localhost:4000 (tsx watch)
# in ../lms-frontend: cp .env.example .env.local && npm install && npm run dev   → http://localhost:3000
```

Mongo must be a replica set (payments run in transactions), which is why the compose service is used even in dev.
`GET /api/healthz` should return `{"status":"ok","mongo":true}`.

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
npm test          # 354 tests: domain units + HTTP integration on an in-memory Mongo replica set (no Docker)
npm run lint && npm run typecheck
```

Highlights: BRE boundaries (age 22/23/50/51 on the exact birthday, salary ₹24,999/₹25,000, PAN shapes),
simple-interest rounding, every state-machine transition × actor, an **RBAC matrix** (every ops route × every
role → 401/403/allowed), IDOR (another borrower's loan → 404), and real races: concurrent applies (one 201,
one 409), approve vs reject (one wins), two payments that together would overpay (one 201, one 422).
The frontend repo has Playwright E2E for the full lifecycle in a browser.

**Live acceptance run** — 69 HTTP checks against the deployed site, through the same `/api` path a browser uses:
every BRE boundary, upload type/size rules (including a 4.9 MB direct upload), apply limits and races, sanction/disbursement/collection rules
including concurrent payments, the RBAC matrix for all six seeded roles, and the web route guards.

```bash
BASE_URL=https://lms-web-five-nu.vercel.app npm run smoke:live    # 69/69 pass
MONGO_URI=... npx tsx scripts/smoke-cleanup.ts                     # removes the test borrowers it created
```

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
- **Uploads:** multer in memory (5 MB cap) → magic-byte type check (the name and `Content-Type` are ignored) → private bucket under a server-chosen key. Staff view slips through 5-minute presigned URLs. Where the host caps request bodies below 5 MB (Vercel: 4.5 MB), the browser uploads straight to the private store with a 5-minute presigned PUT (5 MB and type limits enforced by storage), and the API then checks the stored bytes before accepting them ([ADR 0002](docs/design/adr/0002-salary-slip-storage.md)).
- **Errors:** one envelope everywhere: `{ error: { code, message, details }, requestId }`. 400 schema, 401 not logged in, 403 wrong role, 404 not found/not yours, 409 state conflict, 422 business rule.
- **API contract:** Zod schemas → OpenAPI 3.1 (`openapi.json`, also served at `/api/openapi.json`) → frontend types via `openapi-typescript`.

## Data model

Three collections ([`02-domain-model.md`](docs/design/02-domain-model.md)):

```
users ──1:N──► loans ──1:N──► payments
```

| Collection | Key fields | Indexes |
|---|---|---|
| `users` | `email` (unique), `passwordHash` (bcrypt, never returned), `role`, and for borrowers: `onboardingStage`, embedded `borrowerProfile` (name, PAN, DOB, `monthlySalaryPaise`, employment), `salarySlip` (pointer), `breResult` (passed, failures, rule version, facts, time) | `email` unique · PAN unique among BRE-passed profiles · `{role, onboardingStage, createdAt}` for Sales |
| `loans` | `borrowerId`, `principalPaise`, `tenureDays`, `rateBps` (1200), `interestPaise`, `totalRepaymentPaise`, `amountPaidPaise`, `status`, slip snapshot, `rejectionReason`, `sanctionedAt/By`, `disbursedAt/By`, `closedAt`, `statusHistory[]` | `{status, createdAt}` per queue · `{borrowerId, createdAt}` · **partial unique `{borrowerId}` while APPLIED/SANCTIONED/DISBURSED** (one open loan) |
| `payments` | `loanId`, `utr` (unique, uppercased), `amountPaise`, `paidAt`, `recordedBy` | `utr` unique · `{loanId, paidAt}` |

- Borrower profile, slip and BRE result are embedded in the user (1:1, always read together). Loans and payments are separate collections because they grow and are queried on their own.
- **Outstanding balance** = `totalRepaymentPaise − amountPaidPaise`, computed on read, never stored. `amountPaidPaise` is a running total written in the same transaction as each payment, so the Collection list needs no aggregation.
- The slip is copied onto the loan at apply time, so a later re-upload does not change what a loan was approved on.

## Loan lifecycle

```
APPLIED ──approve──► SANCTIONED ──disburse──► DISBURSED ──(paid in full)──► CLOSED
   └──reject (reason)──► REJECTED
```

| From → To | Who | Guard |
|---|---|---|
| — → APPLIED | Borrower | BRE passed, slip uploaded, no open loan, ₹50,000–₹5,00,000, 30–365 days |
| APPLIED → SANCTIONED | Sanction, Admin | still APPLIED (else 409) |
| APPLIED → REJECTED | Sanction, Admin | reason 1–500 chars |
| SANCTIONED → DISBURSED | Disbursement, Admin | still SANCTIONED (else 409) |
| DISBURSED → CLOSED | System only | inside the payment transaction, when paid = total |

REJECTED and CLOSED are terminal; the borrower can then apply again (and reappears as a Sales lead).
The table is a constant in `src/domain/loan/transitions.ts`; every status write checks it and is a conditional update on the
expected current status, so two people acting at once cannot both succeed.

**Payment validations:** amount > 0 and ≤ outstanding (no overpayment, 422); date between the disbursal date and today in IST (422);
UTR 6–30 letters/digits, unique across all payments, case-insensitive (409); loan must be DISBURSED (409). Payments are never edited or deleted.

## Roles and access control

- **Storage:** one `role` per user (`ADMIN`, `SALES`, `SANCTION`, `DISBURSEMENT`, `COLLECTION`, `BORROWER`), copied into the signed JWT (`{sub, role}`, HS256, 1 day).
- **Permissions, not role names:** `src/domain/rbac.ts` maps each role to permissions (`SANCTION_DECIDE`, `COLLECTION_RECORD`, …). Admin holds every ops permission but not `BORROWER_PORTAL`.
- **Backend:** `authenticate` (401) then `authorize(permission)` (403) mounted on each module's router; write actions add a stricter permission. Borrower data is filtered by owner in the query, so another user's loan is 404.
- **Frontend:** `proxy.ts` verifies the JWT signature and redirects (borrower ↔ dashboard, executive on another module → `/403`); the sidebar and buttons come from the same permission map. This is for UX only; the API checks every request.
- **Status codes:** 401 not logged in · 403 logged in but not allowed · 404 not yours / not found · 400 bad input · 422 business rule · 409 state conflict.

## Where salary slips are stored

| | Files (PDF/JPG/PNG) | What MongoDB keeps |
|---|---|---|
| Live | Private **Vercel Blob** store `lms-salary-slips` (region `bom1`), attached to the `lms-api` project | Pointer only: `{ key, mime, size, originalName, uploadedAt }` on the user, copied onto the loan at apply time |
| Local Docker | **SeaweedFS** (S3-compatible) bucket `lms-salary-slips`, Docker volume `storage-data` | Same |

- Files never touch the API server's disk (multer keeps them in memory; on Vercel they skip the API entirely) and are never stored in MongoDB.
- Object keys are chosen by the server: `slips/<userId>/<uuid>.<ext>`. The user's file name is kept only as display metadata.
- The store is private: a bare object URL returns 403. Sanction and Admin view a slip through a 5-minute presigned URL from `GET /api/ops/sanction/loans/:id/salary-slip`.


| Method | Path | Who |
|---|---|---|
| POST | `/api/auth/signup`, `/api/auth/login`, `/api/auth/logout` · GET `/api/auth/me` | public / any |
| GET | `/api/bre/rules` | borrower |
| GET/PUT | `/api/borrower/profile` | borrower (PUT runs the BRE) |
| POST | `/api/borrower/salary-slip` (multipart `file`) · GET `/upload-options` · POST `/presign` · `/confirm` (direct upload) | borrower |
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
| PAN regex | `^[A-Z]{5}[0-9]{4}[A-Z]$` after uppercasing: 5 letters, 4 digits, 1 letter. The 4th letter is the holder type (`P` = individual); a stricter `^[A-Z]{3}P[A-Z][0-9]{4}[A-Z]$` is one line in the rule data if the business wants individuals only. |
| Where does the BRE run? | Server decides; client shows hints from the server's rule set. A rule the server does not check is not a rule, since anyone can call the API with curl. |
| Age | Completed years on today's date in India (Asia/Kolkata), 23 and 50 inclusive. Someone turning 23 tomorrow fails today. |
| Loans per borrower | One open loan (APPLIED/SANCTIONED/DISBURSED) at a time, enforced by a partial unique index. Reapply after REJECTED or CLOSED. |
| Retry after BRE failure | Allowed; the latest decision (with rule version and failures) is stored so Sales can see why a lead is stuck. |
| Partial payments | Yes, many per loan; no overpayment; date between disbursement and today (IST); UTR unique across all payments. |
| Outstanding balance | Total repayment − amount paid, computed on read; the loan closes automatically when it reaches 0. |
| Interest rounding | Integer paise, simple interest rounded half-up once at apply and stored on the loan, so the contract never changes later. |
| Staff accounts | Seed only; signup ignores any `role` field. |
| 401 vs 403 vs 404 | 401 not logged in, 403 role lacks permission, 404 for someone else's loan (no ID probing). |

## Project structure

```
src/
  domain/          pure business logic, no Express/Mongoose: BRE rules + evaluator, Money + interest,
                   loan transition table, permission map, error types
  modules/         one folder per feature: auth, borrower, bre, ops (sales/sanction/disbursement/collection),
                   loans, users — each with routes → controller → service → repository (+ Zod schemas, OpenAPI)
  middleware/      authenticate, authorize, upload (multer, memory), error handler, request logger
  infra/           Mongoose models, Mongo connection + transactions, storage adapters (S3, Vercel Blob, in-memory)
  config/env.ts    environment parsed with Zod at boot
  create-app.ts    composition root (wires repositories → services → controllers → routers)
  server.ts        long-running entry (Docker)      index.ts   Vercel entry
test/              Vitest + supertest on an in-memory Mongo replica set
scripts/           OpenAPI generation, live acceptance run, test-data cleanup
docs/design/       requirements, HLD, domain model, state machine, API contract, RBAC, ADRs
```

## Environment variables

| Variable | Example | Notes |
|---|---|---|
| `MONGO_URI` | `mongodb://localhost:27017/lms?directConnection=true` | Must be a replica set (Atlas is by default) |
| `JWT_SECRET` | 48 random chars (`openssl rand -base64 48`) | Same value in the frontend (route guard) |
| `JWT_EXPIRES_IN_SECONDS` | `86400` | Session length |
| `COOKIE_SECURE` | `false` locally, `true` on HTTPS | |
| `STORAGE_DRIVER` | `s3` or `blob` | `blob` = private Vercel Blob (live) |
| `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION`, `S3_FORCE_PATH_STYLE`, `S3_AUTO_CREATE_BUCKET` | see `.env.example` | Required when `STORAGE_DRIVER=s3` |
| `PORT`, `LOG_LEVEL`, `NODE_ENV` | `4000`, `info` | |

Full list with comments: [`.env.example`](.env.example). The API parses its environment with Zod at boot and refuses to start
on a missing or malformed value. `npm run dev`, `npm run seed` and `npm start` load `.env` automatically.

Frontend (`lms-frontend/.env.example`): `API_ORIGIN` (where `/api/*` is forwarded) and `JWT_SECRET`.

## Security

- Passwords: bcrypt, cost 12; never returned or logged. Login gives the same 401 for unknown email and wrong password, and takes the same time.
- Session: JWT in an `HttpOnly`, `Secure` (live), `SameSite=Lax` cookie, so page scripts cannot read it. Signature verified on every API request and in the frontend guard.
- Input: every body and query is parsed with Zod; unknown fields are dropped (a `role` or `totalRepaymentPaise` sent by a client is ignored).
- Uploads: type from magic bytes, 5 MB cap, server-chosen keys, private storage, 5-minute view links.
- Headers via `helmet`; JSON body limit 100 KB; logs record only request id, method, URL and status (no headers, cookies or tokens).
- Secrets: `.env` files are git-ignored; a gitleaks pre-commit hook blocks committed secrets.

## Deployment (live)

Both apps run on Vercel (region `bom1`): web at https://lms-web-five-nu.vercel.app, API at https://lms-api-black.vercel.app.
The Playwright E2E suite passes against the live site (`E2E_BASE_URL=https://lms-web-five-nu.vercel.app npm run test:e2e` in the frontend).

- **API** — project `lms-api`. Vercel runs `npm run build` (tsc) and serves `index.js` → `dist/index.js` as one Fluid-compute function; the Mongo connection is opened lazily and reused across invocations.
- **Database** — MongoDB Atlas (replica set by default, so transactions work). `MONGO_URI` is a project env var.
- **Slips** — a private Vercel Blob store (`STORAGE_DRIVER=blob`); staff get presigned GET URLs.
- **Web** — project `lms-web` with `API_ORIGIN` pointing at the API; `JWT_SECRET` is shared so the route guard can verify sessions.

Vercel Functions accept request bodies up to 4.5 MB, so slips do not pass through the API there: the browser uploads
directly to the private Blob store with a short-lived presigned PUT, and the API verifies the stored file
(size and magic bytes) before recording it. Verified live with a 4.9 MB slip; over 5 MB is refused by storage itself.
Locally (Docker) slips go through the API as multipart. See [ADR 0002](docs/design/adr/0002-salary-slip-storage.md).

## Considered, not built

How larger lenders do it, and why it was left out here. The design leaves a hook for each.

| Practice | Why not now |
|---|---|
| Refresh tokens + revocation (`tokenVersion`) | No role-change UI; 1-day token is fine for a demo |
| Staff SSO + MFA (Okta/Google) | Evaluators need seeded password logins |
| Login rate limiting / lockout | Needs a shared store (e.g. Redis) across serverless instances; Vercel Firewall rate rules are the next step |
| `Idempotency-Key` header | Unique UTR and the one-open-loan index already make retries safe |
| Payment reversals | Changes the state machine (CLOSED → DISBURSED); ledger is already append-only |
| PAN/KYC verification, credit bureau | Paid APIs; adapter sketched in [ADR 0006](docs/design/adr/0006-kyc-provider-adapter.md) |
| BRE rules in DB, decision log, cool-off, shadow testing | Rules are already data with a version; moving them to a collection is mechanical |
| Audit log + transactional outbox (SMS/email) | `statusHistory` covers who/when; design in [ADR 0005](docs/design/adr/0005-audit-log-and-outbox.md) |
| EMI schedules, penalties, password reset, admin user management | Not in the brief |

## Known limitations

- A role change takes effect when the user's token expires (up to 1 day); there is no role-change UI, and `tokenVersion` is the planned fix.
- Only INR. Amounts carry `currency: 'INR'` so a second currency would not be ambiguous.
- Slip files from deleted test accounts are not garbage-collected from storage.
- The live demo database contains the six demo accounts and one pending application ("Riya Demo") to try Sanction with.
