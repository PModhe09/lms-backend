# TASKS — lms-backend

Vertical slices, built in order. Each slice ends green: `npm run lint && npm run typecheck && npm test`,
then a review, then one commit (Conventional Commits). Tests come first (TDD) for every domain rule and route.
Design references are in `docs/design/`. The frontend counterpart is `../lms-frontend/TASKS.md`.

Legend: `[ ]` todo · `[x]` done · **AC** = acceptance criteria.

## Decisions made at planning time

| Topic | Decision | Why |
|---|---|---|
| Package manager | npm | Ships with Node 22, one less tool for the evaluator |
| Runtime | Node 22, TypeScript strict, ESM, `tsx` for dev, `tsc` for build | Matches local Node v22.16.0 |
| Zod → OpenAPI | `@asteasolutions/zod-to-openapi`, script writes `openapi.json` at repo root, committed | Frontend generates types from the committed file. No running server needed at frontend build time |
| Password hashing | `bcryptjs` (pure JS, same bcrypt algorithm, cost 12) | No native build step in Alpine images |
| Validation placement | `parse(schema, req.body)` in controllers instead of a `validate` middleware | Same 400 behavior, but the controller gets typed input |
| Config | `src/config/env.ts` parses `process.env` with Zod at boot, crashes on missing vars | Fail fast, not on first request |
| Logging | `pino` + `pino-http`, `requestId` on every log line and every error envelope | Ops can join a user report to a log line |
| Object storage | `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`, `forcePathStyle` locally | One client for SeaweedFS, R2 and S3 |
| Time | All "today" logic takes `now: Date` as a parameter; Asia/Kolkata for age and payment-date checks | Tests pin the date |

## Folder layout

```
src/
  app.ts                 express app factory (no listen), used by tests
  server.ts              listen + graceful shutdown
  config/env.ts
  domain/                pure: no Express, no Mongoose
    money.ts             Money value object, SI calc
    bre/rules.ts, bre/evaluate.ts
    loan/transitions.ts  TRANSITIONS table + assertTransition
    rbac.ts              Permission, ROLE_PERMISSIONS
    errors.ts            AppError subclasses
  modules/<auth|borrower|bre|sanction|disbursement|collection|leads|ops>/
    *.routes.ts  *.controller.ts  *.service.ts  *.repository.ts  *.schemas.ts
  middleware/            requestId, authenticate, authorize, validate, errorHandler, upload
  infra/                 mongo.ts, models/*.ts, storage.ts
  openapi/               registry + generate script
scripts/seed.ts
test/                    vitest + supertest + mongodb-memory-server (replica set mode)
```

---

## (a) Scaffold + Docker + auth + seed + RBAC skeleton

- [x] a1. `npm init`, TypeScript strict, ESLint (typescript-eslint) + Prettier, Vitest. Scripts: `dev`, `build`, `start`, `lint`, `typecheck`, `test`, `openapi`, `seed`.
- [x] a2. `config/env.ts`, `.env.example` (`PORT`, `MONGO_URI`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `COOKIE_SECURE`, `S3_*`, `CORS_ORIGIN` unused by default).
- [x] a3. `app.ts` middleware chain from `05-rbac.md`: requestId → helmet → `json({limit: '100kb'})` → cookieParser → routers → errorHandler. `GET /api/healthz` pings Mongo.
- [x] a4. Domain: `errors.ts` (`ValidationError` 400, `UnauthenticatedError` 401, `ForbiddenError` 403, `NotFoundError` 404, `ConflictError` 409, `BusinessRuleError` 422), `rbac.ts`, error envelope `{error: {code, message, details}, requestId}`.
- [x] a5. `User` model: email unique (lowercased), `passwordHash`, `role`, `onboardingStage`, embedded `borrowerProfile` / `salarySlip` / `breResult`, indexes from `02-domain-model.md`.
- [x] a6. Auth module: signup (always BORROWER, `role` in body ignored), login (same 401 for unknown email and wrong password), logout, me. bcrypt cost 12. JWT HS256 `{sub, role}` 1 day in httpOnly cookie `lms_token`, `SameSite=Lax`, `Secure` from env.
- [x] a7. `authenticate`, `authorize(...perms)`, `validate(schema)` middleware.
- [x] a8. `scripts/seed.ts`: upsert the 6 users from `05-rbac.md`, idempotent.
- [x] a9. Dockerfile (multi-stage, non-root, `HEALTHCHECK` on `/api/healthz`). `docker-compose.yml`: `mongo` (rs0 + init), `storage` (SeaweedFS S3, see ADR 0002 amendment), `api`, `seed` (one-shot).
- [x] a11. Add `web` service to compose (build context `../lms-frontend`) once the frontend Dockerfile exists.
- [x] a10. OpenAPI registry + `npm run openapi` writes `openapi.json`. Serve it at `GET /api/openapi.json`.

**AC**
- `docker compose up` brings up mongo, storage, api and seed; `curl localhost:4000/api/healthz` returns 200.
- Signup with `{"role":"ADMIN"}` in the body creates a BORROWER (test).
- Login with an unknown email and with a wrong password return an identical 401 body, except `requestId` (test).
- A protected test route returns 401 without a cookie and 403 with a role lacking the permission (test).
- Running the seed twice leaves exactly 6 seeded users (test).

## (b) Personal details + BRE

- [x] b1. `domain/bre`: rules v1 + generic evaluator + fact derivation (`age` from `dob` and `now` in Asia/Kolkata, PAN uppercased).
- [x] b2. Boundary tests: age 22/23/50/51 (birthday today and tomorrow), salary 24,999/25,000, PAN samples, each employment mode, multiple failures returned together.
- [x] b3. `GET /api/bre/rules` (BORROWER).
- [x] b4. `GET /api/borrower/profile`, `PUT /api/borrower/profile`: run BRE, store `breResult`, stage → `DETAILS_SUBMITTED` or `BRE_REJECTED`; 422 `BRE_REJECTED` with `details[]`; 409 on PAN owned by another account (sparse unique index, E11000 mapped).
- [x] b5. PUT after `SLIP_UPLOADED` or `APPLIED`: allowed only before apply. Re-passing BRE keeps stage `SLIP_UPLOADED` if a slip exists. Once a loan is open, 409.

**AC**: all b2 cases pass; failing PUT stores `breResult.passed=false` and never advances the stage.

## (c) Salary slip upload

- [x] c1. `infra/storage.ts`: `putObject`, `presignGet(key, 300s)`. Key = `slips/<userId>/<uuid>.<ext>`, server-chosen.
- [x] c2. `middleware/upload.ts`: multer memory storage, `fileSize: 5 MB`, one file field `file`. Over-limit maps to 422 `INVALID_FILE`.
- [x] c3. Magic-byte check (`%PDF`, `FF D8 FF`, `89 50 4E 47`); MIME is taken from the bytes, never from the client.
- [x] c4. `POST /api/borrower/salary-slip`: stage must be `DETAILS_SUBMITTED` or `SLIP_UPLOADED` (else 409); store `{key, mime, size, originalName, uploadedAt}`; stage → `SLIP_UPLOADED`.

**AC**: a `.pdf`-named PNG is stored as `image/png`; a renamed `.exe` gives 422; a 5 MB + 1 byte file gives 422; tests use an in-memory storage fake behind the same interface.

## (d) Loan config + apply

- [x] d1. `domain/money.ts`: `Money` (integer paise, `INR`), `computeSimpleInterest(principalPaise, rateBps, tenureDays)`, rounded once (half-up) at apply. Unit tests including ₹50,000 × 30 days.
- [x] d2. `domain/loan/transitions.ts`: `TRANSITIONS` + `assertTransition(from, to, actor)`. Table tests for every allowed and forbidden pair.
- [x] d3. `Loan` model + indexes (`{status, createdAt}`, `{borrowerId, createdAt}`, partial unique `{borrowerId}` on open statuses), `statusHistory`.
- [x] d4. `POST /api/borrower/loans`: body `{principalPaise, tenureDays}` only (other keys stripped); range checks (400); stage must be `SLIP_UPLOADED` (409); server computes interest and total; slip snapshot; E11000 on the partial index → 409 `OPEN_LOAN_EXISTS`; stage → `APPLIED`.
- [x] d5. `GET /api/borrower/loans`, `GET /api/borrower/loans/:id` (own only, else 404; includes payments).

**AC**: client-sent `totalRepaymentPaise` is ignored (test); two concurrent applies give one 201 and one 409 (test); another borrower's loan id gives 404 (test).

## (e) Sanction

- [x] e1. `GET /api/ops/sanction/loans` (status APPLIED, paginated, with borrower summary).
- [x] e2. `POST .../:id/approve`, `POST .../:id/reject {reason 1..500}`: conditional `findOneAndUpdate` on `status: APPLIED`, push `statusHistory`, 409 `INVALID_STATE` on miss. Reject sets borrower stage → `SLIP_UPLOADED`.
- [x] e3. `GET /api/ops/loans/:id`: detail + history + borrower BRE result (any ops read permission).
- [x] e4. `GET /api/ops/sanction/loans/:id/salary-slip` → `{url}` presigned GET, 5 min.

**AC**: approve then reject on the same loan → second call 409; SALES token → 403; DISBURSEMENT token on approve → 403.

## (f) Disbursement

- [x] f1. `GET /api/ops/disbursement/loans` (SANCTIONED), `POST .../:id/disburse` (conditional update, `disbursedAt`, `disbursedBy`).

**AC**: disbursing an APPLIED loan → 409.

## (g) Collection + auto-close

- [x] g1. `Payment` model: `{loanId, utr unique, amountPaise, paidAt, recordedBy}`, index `{loanId, paidAt}`.
- [x] g2. `GET /api/ops/collection/loans` (DISBURSED, with `outstandingPaise`), `GET .../:id/payments`.
- [x] g3. `POST .../:id/payments`: `session.withTransaction` per `03-loan-state-machine.md`. 409 `DUPLICATE_UTR`, 422 `OVERPAYMENT`, 422 `INVALID_PAYMENT_DATE`, 409 if not DISBURSED. Auto-close to CLOSED by SYSTEM when paid equals total; borrower stage → `SLIP_UPLOADED`.

**AC**: partial then final payment closes the loan; duplicate UTR on a different loan → 409; two concurrent ₹10,000 payments on ₹15,000 outstanding → one 201 and one 422 (test on a replica set memory server).

## (h) Sales leads

- [x] h1. `GET /api/ops/sales/leads?stage=`: borrowers whose stage is not `APPLIED`, newest first, with stage and BRE failures.

**AC**: a borrower with an APPLIED loan is not a lead; after rejection they are a lead again.

## (i) Admin view

- [x] i1. ADMIN already holds every ops permission. Add an `rbac-matrix` test: every ops route × every role → the expected 200/201/403.

**AC**: the matrix test passes and is the proof cited in the README.

## (j) Polish

- [ ] j1. README: setup, `docker compose up`, credentials table, architecture summary, API table, "considered, not built" list, test commands.
- [ ] j2. `.env.example` final; `openapi.json` up to date (test fails on drift).
- [ ] j3. Live deploy (Render + Atlas + R2) if time allows; a 4.9 MB upload through the Vercel rewrite.

## Blockers to clear before coding

| # | Blocker | Status |
|---|---|---|
| 1 | Docker Desktop running | check at slice (a) start (`open -a Docker`) |
| 2 | Per-repo `CLAUDE.md` + lint/format/typecheck hooks | do at a1 |
| 3 | GitHub repo created | at first commit (`gh repo create`, public) |
| 4 | Design quiz answered | user's pace; not blocking. Review answers before the slice they cover |
