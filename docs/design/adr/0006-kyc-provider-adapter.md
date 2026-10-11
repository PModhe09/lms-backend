# ADR 0006 — PAN verification behind a KycProvider adapter (mock today)

Status: Proposed, deferred · 2026-10-10. Not built: scope cut to the spec to submit fast. Kept as the design for the next step.

## Context
The BRE checks the PAN *format*. Real lenders also check the PAN *exists* and matches the borrower's name and DOB,
via the Income Tax Department or a KYC vendor (NSDL, Karza, Signzy). These are paid APIs we cannot use here.

## Decision
```ts
interface KycProvider {
  verifyPan(input: { pan: string; fullName: string; dob: string }): Promise<{ status: 'VERIFIED' | 'MISMATCH' | 'UNAVAILABLE'; ref?: string }>;
}
```
- `MockKycProvider` (default): returns `VERIFIED`, except documented test PANs: `AAAPZ9999Z` → `MISMATCH`, `AAAPZ0000Z` → `UNAVAILABLE`.
  Chosen by env `KYC_PROVIDER=mock`. A real provider is a new class, no other code changes (Adapter + Dependency Inversion).
- Called after the BRE passes. Result stored on `users.kyc = { status, provider, ref, checkedAt }`.
- **It does not block the flow.** `MISMATCH` and `UNAVAILABLE` show as a warning badge to Sanction, who decides.
  Big-tech practice: vendor outages must not stop onboarding, so a failed check becomes manual review rather than an automatic reject.
- 3 s timeout. Timeout = `UNAVAILABLE`.

## Consequences
- The README lists the test PANs so the evaluator can see each badge.
- Shows the seam where a real integration plugs in, without pretending we verify anything today.
