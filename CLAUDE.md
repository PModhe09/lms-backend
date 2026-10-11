# lms-backend — agent notes

Express 5 + TypeScript (strict, ESM) + Mongoose 9 + Zod 4. Design docs: `docs/design/` (start at its README).
Work plan: `TASKS.md` (vertical slices a–j, tick boxes as you go).

## Commands
- `npm run dev` — API on :4000 (needs Mongo replica set + S3; easiest: `docker compose up -d mongo storage`)
- `npm test` — Vitest + supertest on an in-memory Mongo replica set. No Docker needed.
- `npm run lint && npm run typecheck` — also run by the pre-commit hook (with gitleaks)
- `npm run openapi` — regenerate `openapi.json` after any schema or route change; commit it (the frontend reads it)
- `docker compose up --build` — full local stack, seeds the demo users

## Conventions
- Layers: routes → controller (parse input with `parse(schema, req.body)`) → service (business rules) → repository (Mongoose) → domain (pure).
- Domain code (`src/domain`) imports nothing from Express or Mongoose.
- Throw `AppError` subclasses from `src/domain/errors.ts`; never `res.status(...)` for errors. Status mapping is in 04-api-contract.md.
- RBAC: `authenticate` + `authorize(Permission.X)` at router level. Ownership checks live in services and return 404.
- Money is integer paise with `currency: 'INR'`. No floats in stored amounts.
- Relative imports use the `.ts` extension (tsc rewrites them to `.js`).
- Every new route: register it in a `*.openapi.ts`, import that in `src/openapi/document.ts`, write tests first.
- Commits: Conventional Commits, one per slice task group, after lint + typecheck + tests are green.
