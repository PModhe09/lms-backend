# 04 — API Contract

Base path `/api`. JSON in, JSON out. Auth via httpOnly cookie `lms_token`.
Every money field is integer paise with a `currency: "INR"` alongside it (ADR 0003). Payments have no update or delete route: the ledger is append-only.
Request bodies validated with Zod; the same Zod schemas generate `openapi.json`, which the frontend
turns into TypeScript types (`openapi-typescript`). One definition, two repos, no drift.

## Conventions

**Success**: the resource itself, or `{ items, page, limit, total }` for lists. Lists take `?page=1&limit=20` (limit ≤ 100).

**Error envelope**, every error, every route:
```json
{ "error": { "code": "BRE_REJECTED", "message": "Application does not meet eligibility rules", "details": [ ... ] }, "requestId": "6f1c..." }
```

| Status | Meaning here | Example code |
|---|---|---|
| 400 | Body/query fails schema (wrong type, missing field) | `VALIDATION_ERROR` |
| 401 | No cookie, bad or expired token | `UNAUTHENTICATED` |
| 403 | Logged in, role lacks permission | `FORBIDDEN` |
| 404 | Resource not found, or exists but caller may not see it | `NOT_FOUND` |
| 409 | Conflicts with current state: duplicate email/UTR, open loan exists, stale status | `DUPLICATE_UTR`, `INVALID_STATE` |
| 422 | Well-formed but breaks a business rule | `BRE_REJECTED`, `OVERPAYMENT`, `INVALID_FILE` |
| 500 | Bug. Message is generic; details only in logs with `requestId` | `INTERNAL` |

400 vs 422: 400 = "I can't parse what you sent". 422 = "I understood it, and the business says no".
The frontend shows 422 messages to the user as-is; 400 means our own form has a bug.

## Auth

| Method | Path | Who | Body | Success |
|---|---|---|---|---|
| POST | `/auth/signup` | public | `{email, password}` (password ≥ 8) | 201 user, sets cookie. Role is always BORROWER. |
| POST | `/auth/login` | public | `{email, password}` | 200 user, sets cookie. Wrong email or password → same 401 (no user enumeration). |
| POST | `/auth/logout` | any | — | 204, clears cookie |
| GET | `/auth/me` | any logged-in | — | 200 `{id, email, role, onboardingStage?}` |

## Borrower portal

| Method | Path | Body | Success | Errors |
|---|---|---|---|---|
| GET | `/borrower/profile` | — | 200 profile + stage + slip info | — |
| PUT | `/borrower/profile` | `{fullName, pan, dob, monthlySalaryPaise, employmentMode}` | 200 profile with `onboardingStage: DETAILS_SUBMITTED` and `breResult` | 422 `BRE_REJECTED` with `details: [{rule: "AGE", message}]`, 409 PAN used by another account |
| POST | `/borrower/salary-slip` | `multipart/form-data`, field `file` | 200 profile with `onboardingStage: SLIP_UPLOADED`, `salarySlip: {mime, size, originalName, uploadedAt}` | 422 `INVALID_FILE` (not PDF/JPG/PNG by magic bytes, or > 5 MB), 409 stage too early (BRE not passed) |
| GET | `/borrower/salary-slip/upload-options` | — | 200 `{mode: 'direct' \| 'server', maxBytes, contentTypes, keyPrefix}` | — |
| POST | `/borrower/salary-slip/presign` | storage SDK handshake `{type, payload: {pathname}}` | 200 presigned PUT (5 min, ≤ 5 MB, PDF/JPG/PNG, one path in own folder) | 409 `DIRECT_UPLOAD_UNAVAILABLE` or stage too early, 422 path not allowed |
| POST | `/borrower/salary-slip/confirm` | `{key, originalName}` | 200 profile with `SLIP_UPLOADED` | 404 not found / not own key, 422 `INVALID_FILE` (object deleted) |
| GET | `/borrower/loans` | — | 200 list of own loans | — |
| POST | `/borrower/loans` | `{principalPaise, tenureDays}` | 201 loan (status APPLIED, server-computed interest/total) | 409 `OPEN_LOAN_EXISTS`, 409 stage not SLIP_UPLOADED, 400 out of range |
| GET | `/borrower/loans/:id` | — | 200 loan + payments | 404 if not own loan |

The client sends only `principalPaise` and `tenureDays`. It never sends interest or total. If it did, we would ignore them.

## Eligibility rules

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/bre/rules` | BORROWER | Rule set `{version, rules}` for client-side hints |

## Operations dashboard

Routes are grouped by module so one module = one permission check at the router level.

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/ops/sales/leads?stage=` | `LEADS_READ` | Borrowers not in APPLIED stage |
| GET | `/ops/sanction/loans` | `SANCTION_READ` | status APPLIED |
| GET | `/ops/sanction/loans/:id/salary-slip` | `SANCTION_READ` | 200 `{url}` presigned GET, 5 min |
| POST | `/ops/sanction/loans/:id/approve` | `SANCTION_DECIDE` | 200 loan, 409 if not APPLIED |
| POST | `/ops/sanction/loans/:id/reject` | `SANCTION_DECIDE` | `{reason}` required |
| GET | `/ops/disbursement/loans` | `DISBURSEMENT_READ` | status SANCTIONED |
| POST | `/ops/disbursement/loans/:id/disburse` | `DISBURSEMENT_EXECUTE` | 200 loan, 409 if not SANCTIONED |
| GET | `/ops/collection/loans` | `COLLECTION_READ` | status DISBURSED, includes `outstandingPaise` |
| GET | `/ops/collection/loans/:id/payments` | `COLLECTION_READ` | payment history |
| POST | `/ops/collection/loans/:id/payments` | `COLLECTION_RECORD` | `{utr, amountPaise, paidAt}` → 201 `{payment, loan}`; 409 `DUPLICATE_UTR`, 422 `OVERPAYMENT` / `INVALID_PAYMENT_DATE`, 409 if not DISBURSED |
| GET | `/ops/loans/:id` | any ops read permission | Loan detail + status history + borrower's latest BRE result, used by every module's detail drawer |

## Health

`GET /healthz` → 200 `{status: "ok", mongo: true}` when Mongo is reachable, 503 otherwise. The Docker `HEALTHCHECK` uses it.
