# ADR-0005: Admin authorization -- consolidate on `isAdminUser` + `withAdminAuth`

## Status
Proposed (decision needed to resolve three coexisting implementations)

## Context
Admin authorization currently has THREE coexisting implementations, each
with different trust properties and adoption patterns. During migration 011,
`profiles.is_admin` was added and backfilled from `ADMIN_EMAIL`, but the
email-based gate was kept "for zero-downtime rollout." It was never removed.
Any new admin route must choose between three conventions, and code review
can miss that a given endpoint uses the wrong one.

### Current implementations

**Pattern A -- Email match in proxy** (`src/proxy.ts`, lines 63-82):
Compares `session.user.email` against `ADMIN_EMAIL` env var. Fast (no DB
call), but only works for a single admin. The code comment explicitly flags
this as a stopgap until a 2nd admin is added.

**Pattern B -- `isAdmin(email)` pure helper** (`src/lib/admin.ts`, lines
13-16): Email-only comparison. Used by callers that have an email but no
Supabase client. Legacy pattern.

**Pattern C -- `isAdminUser(supabase, user)`** (`src/lib/admin.ts`, lines
25-43): Reads `profiles.is_admin` from DB. Falls back to Pattern B (email
check) first for performance. Used by `withAdminAuth` wrapper.

### Inconsistent adoption
- `src/app/api/admin/match/kill-switch/route.ts` uses inline `isAdminUser`,
  NOT `withAdminAuth`.
- `src/app/api/admin/match/recompute/route.ts` also uses inline
  `isAdminUser`.
- `/api/admin/allocator-approve`, `/api/admin/intro-request`,
  `/api/admin/strategy-review` use `withAdminAuth`.

## Decision
**Recommended: Consolidate on Pattern C (`isAdminUser`) via the
`withAdminAuth` wrapper.**

1. **`withAdminAuth`** (`src/lib/api/withAdminAuth.ts`) becomes the ONLY
   way to gate admin routes. It calls `isAdminUser` internally.

2. **Deprecate Pattern B** (`isAdmin(email)`): Remove the pure email check.
   Any caller that only has an email should obtain a Supabase client instead.

3. **Proxy check becomes a soft gate**: The proxy email check in
   `src/proxy.ts` (lines 63-82) remains as a fast-path redirect for
   non-admin users but is explicitly labeled as optimistic / best-effort.
   The authoritative check is `withAdminAuth` at the handler level (DAL
   pattern, consistent with ADR-0022).

4. **Future: JWT custom claim**: When a 2nd admin is added, replace the
   proxy email check with a JWT custom claim (`app_metadata.is_admin`)
   set via a Supabase auth hook. This eliminates the env-var dependency
   and the per-request DB query.

### Migration steps
- Replace inline `isAdminUser` calls in kill-switch and recompute routes
  with `withAdminAuth`.
- Remove `isAdmin(email)` export from `src/lib/admin.ts`.
- Add a comment to the proxy email check marking it as deprecated/soft.
- File a tech-debt ticket for JWT custom claim migration.

## Consequences

### Positive
- New admin endpoints get mechanical review: `withAdminAuth` is the only
  import to look for.
- Eliminates the `ADMIN_EMAIL` env var as a hard requirement for admin
  access (the DB column becomes authoritative).
- Scales to multiple admins without code changes.

### Negative
- The proxy check becomes either a DB query (expensive per request) or a
  soft gate (clearly labeled). Both are tradeoffs.
- Until the JWT custom claim is implemented, the proxy soft gate provides
  weaker protection for admin UI routes (though the DAL check at the
  handler level remains authoritative).

## Evidence
- Pattern A (proxy): `src/proxy.ts` (lines 63-82, especially the comment
  at lines 64-70).
- Pattern B (email helper): `src/lib/admin.ts` (lines 13-16).
- Pattern C (DB check): `src/lib/admin.ts` (lines 25-43).
- `withAdminAuth` wrapper: `src/lib/api/withAdminAuth.ts` (lines 12-31).
- Inconsistent adoption: `src/app/api/admin/match/kill-switch/route.ts`
  (lines 8-14), `src/app/api/admin/match/recompute/route.ts` (line 10).
- `profiles.is_admin` column: `supabase/migrations/011_perfect_match.sql`.
