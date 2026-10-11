# ADR 0001 — Auth cookie when web and API run on different domains

Status: Accepted · 2026-10-10

## Context
JWT is stored in an httpOnly cookie so JavaScript (and any XSS) cannot read it.
Live deploy puts the web app on `*.vercel.app` and the API on `*.onrender.com` (or similar).
Both suffixes are on the Public Suffix List, so `lms.vercel.app` and `lms-api.onrender.com` are
different *sites*, not just different origins. A cookie set by the API is a third-party cookie
from the browser's point of view.

## Options

### A. Next.js rewrites `/api/*` to the API (chosen)
Browser calls `https://lms.vercel.app/api/...`. Vercel forwards it to the API. The cookie is set on the
Vercel domain, so it is first-party: `HttpOnly; Secure; SameSite=Lax; Path=/`. No CORS, because the
browser sees one origin.

The backend stays a separate Express service. Next.js only forwards requests: the rewrite is a
config entry, not code, and there are no Next.js API route handlers or business logic in the frontend.

```ts
// lms-frontend/next.config.ts
async rewrites() {
  return [{ source: '/api/:path*', destination: `${process.env.API_INTERNAL_URL}/api/:path*` }];
}
```

- Works in every browser, including Safari, Brave and incognito.
- Cost: one extra network hop through Vercel (~10–50 ms).
- Risk: salary slip uploads (up to 5 MB) go through this rewrite (ADR 0002). Vercel Functions cap bodies at 4.5 MB,
  and it is not documented whether external rewrites share that cap. Checked at deploy time; fallback in ADR 0002.

### B. Cross-site cookie: `SameSite=None; Secure` + CORS with `credentials: 'include'`
| Browser (default settings) | Works? | Why |
|---|---|---|
| Chrome | Yes | Google dropped its plan to block third-party cookies by default |
| Chrome incognito | No | Third-party cookies blocked by default in incognito |
| Firefox | Yes | Total Cookie Protection partitions the cookie under the top-level site, but our fetches always come from the same top-level site, so the partitioned cookie is sent |
| Brave | No | Shields blocks third-party cookies by default |
| Safari | No | ITP blocks all third-party cookies |
An evaluator on a Mac with Safari, or on Brave, could not log in. Too risky for a graded demo.

### C. Custom domain: `app.example.com` + `api.example.com`
Same registrable domain = same site, so `SameSite=Lax` works everywhere. Cleanest production answer.
Cost: buy and configure a domain. Good upgrade path from A, not needed now.

### D. Bearer token in `Authorization` header, stored in `localStorage`
No cookie problems at all. But any XSS reads the token, and Next.js middleware cannot see it on page
navigation, so server-side route guards stop working.

## Decision
Option A. Local Docker Compose uses the same rewrite (`web` → `http://api:4000`), so dev and prod behave the same.

## Consequences
- API sets cookies without a `Domain` attribute; the browser scopes them to the web domain.
- API keeps a strict CORS config (no origins allowed) since browsers never call it directly.
- Next.js needs `API_INTERNAL_URL` at build/run time, and `JWT_SECRET` for middleware verification.
