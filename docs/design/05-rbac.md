# 05 — Role-Based Access Control

## Roles vs permissions

Code checks **permissions**, not roles. Roles are just named bundles of permissions.

```ts
enum Permission {
  BORROWER_PORTAL,
  LEADS_READ,
  SANCTION_READ, SANCTION_DECIDE,
  DISBURSEMENT_READ, DISBURSEMENT_EXECUTE,
  COLLECTION_READ, COLLECTION_RECORD,
}

const OPS = [LEADS_READ, SANCTION_READ, SANCTION_DECIDE, DISBURSEMENT_READ, DISBURSEMENT_EXECUTE, COLLECTION_READ, COLLECTION_RECORD];

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  ADMIN:        OPS,
  SALES:        [LEADS_READ],
  SANCTION:     [SANCTION_READ, SANCTION_DECIDE],
  DISBURSEMENT: [DISBURSEMENT_READ, DISBURSEMENT_EXECUTE],
  COLLECTION:   [COLLECTION_READ, COLLECTION_RECORD],
  BORROWER:     [BORROWER_PORTAL],
};
```

Why not `if (role === 'SANCTION' || role === 'ADMIN')` in each route: that check gets copied into
every handler, and the day someone adds a "Sanction Lead" role you edit twenty places and miss one.
With a map, you edit one line. Admin does NOT get `BORROWER_PORTAL`: admins manage loans, they do not apply for them.

## Where the role lives

- Stored on `users.role` (one role per user; the spec has no multi-role users).
- Copied into the JWT payload at login: `{ sub: userId, role }`, signed HS256, 1 day expiry.
- Trade-off: if an admin changes someone's role, the old token keeps the old role until it expires.
  Acceptable here (no role-change UI). The fix if needed: short-lived access token + refresh token,
  or a `tokenVersion` on the user checked on each request.

## Backend middleware chain

```
requestId → helmet → json(limit 100kb) → cookieParser
  → router
     → authenticate          401 if no/invalid/expired token; sets req.user = {id, role}
     → authorize(...perms)   403 if role lacks ANY listed permission
     → controller            parses body/query with Zod (400 on mismatch), so it gets typed input
     → service → repository
  → errorHandler             maps AppError subclasses to status + envelope
```

This is **Chain of Responsibility**: each middleware handles one concern and either passes control on or stops.
Applied at router level, so a new route under `/ops/sanction` cannot forget the check:

```ts
sanctionRouter.use(authenticate, authorize(Permission.SANCTION_READ));
sanctionRouter.post('/loans/:id/approve', authorize(Permission.SANCTION_DECIDE), controller.approve);
```

### Ownership is not RBAC

RBAC answers "can a borrower read loans?" Yes. Ownership answers "can *this* borrower read *this* loan?"
That check lives in the service: `Loan.findOne({_id, borrowerId: req.user.id})`. Missing → 404, not 403,
so a borrower cannot probe which loan IDs exist. Forgetting this check is IDOR, the most common real-world authz bug.

## Frontend enforcement (UX layer, not security)

1. `src/proxy.ts` (Next.js 16's name for `middleware.ts`, Node runtime) reads the cookie, verifies the JWT signature with `jose`, and redirects:
   - no token → `/login`
   - BORROWER on `/dashboard/*` → `/apply`
   - executive on a module it lacks → `/dashboard` (which shows only allowed modules), or `/403`
2. Sidebar renders only modules from `ROLE_PERMISSIONS[role]` (same map, copied to frontend).
3. Buttons for actions the user lacks are not rendered.

None of this is trusted. The spec's line "hiding a menu item is not enough" is exactly why every
API route re-checks. `test/rbac-matrix.test.ts` proves it by calling every ops route with every role's token, and
`scripts/smoke-live.ts` repeats the matrix against the deployed site with the six seeded logins.

## Seeded accounts

| Role | Email | Password |
|---|---|---|
| Admin | admin@lms.dev | Admin@123 |
| Sales | sales@lms.dev | Sales@123 |
| Sanction | sanction@lms.dev | Sanction@123 |
| Disbursement | disbursement@lms.dev | Disburse@123 |
| Collection | collection@lms.dev | Collect@123 |
| Borrower | borrower@lms.dev | Borrower@123 |

Demo-only credentials, published in the README on purpose so the evaluator can log in. The seed is idempotent
(upsert by email) so running it twice does not fail or duplicate users.
