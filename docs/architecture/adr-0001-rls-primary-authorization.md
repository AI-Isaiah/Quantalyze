# ADR-0001: Supabase RLS is the primary authorization layer

## Status
Accepted (retroactively documenting existing decision)

## Context
The application needs row-level authorization across 9+ tables containing
user-owned data (strategies, portfolios, attestations, allocations, etc.).
The team chose to delegate authorization to Postgres Row-Level Security (RLS)
rather than implementing ownership checks in application code. This means the
database is the single source of truth for "which user can see which rows."

However, the pattern is inconsistent in practice. Most routes use the
cookie-based server client (which runs under the caller's JWT and respects
RLS), but some routes use the admin client (`createAdminClient()`) and
reimplement ownership checks in application code. Additionally, column-level
REVOKE/GRANT interactions with table-level grants caused silent no-op bugs
in migrations 012 and 017, which were only fixed in migration 020's
table-REVOKE-then-GRANT-back pattern.

## Decision
RLS is the primary authorization layer. API handlers are NOT expected to
re-check row ownership except in two narrow cases:

1. **Admin client for cross-tenant reads**: When `createAdminClient()` is
   deliberately used for a cross-tenant or service-level operation, the
   handler MUST perform its own authorization check (e.g.,
   `assertPortfolioOwnership`).

2. **Column-level PII hiding**: When specific columns are hidden via
   REVOKE/GRANT (e.g., profiles PII), service-role reads are required and
   must be gated by application-level authorization.

### Authorization model

- **Table-level baseline**: `GRANT ALL ON <table> TO authenticated` is the
  current pattern. RLS policies (typically `FOR ALL USING (user_id = auth.uid())`)
  restrict access to owned rows.

- **Column-level REVOKE/GRANT pattern**: Migration 020 established the
  canonical template: REVOKE ALL at the table level first, then GRANT back
  only the allowed columns. Direct column-level REVOKEs against table-level
  grants are silent no-ops in Postgres and MUST NOT be used.

- **Admin-client paths**: Every `createAdminClient()` call site is an RLS
  bypass. Each must carry a manual ownership or authorization check and
  must be classifiable into one of the four categories defined in ADR-0003.

## Consequences

### Positive
- Database is the single source of truth; a new table automatically gets
  RLS treatment once policies are added.
- Multi-tenant safety is DB-enforced; API-layer bugs cannot open
  cross-tenant data leaks for RLS-protected paths.
- The migration 020 template provides a proven, repeatable pattern for
  future PII columns.

### Negative
- Any `createAdminClient()` use is a potential footgun -- it bypasses all
  RLS and must carry a manual ownership check.
- Column-level REVOKE footguns (migrations 012, 017 were silent no-ops)
  remain possible if the migration 020 pattern is not followed.
- The dual pattern (RLS for most paths, app-level checks for admin paths)
  increases review burden.

## Evidence
- RLS policies: `supabase/migrations/002_rls_policies.sql` (lines 1-69)
  enables RLS on 9 tables with owner-scoped policies.
- Security hardening: `supabase/migrations/007_security_hardening.sql`,
  `011_perfect_match.sql`, `020_profile_pii_revoke_hardened.sql`,
  `021_function_execute_hardening.sql`,
  `022_public_profiles_view_security_invoker.sql`.
- Server client (RLS-bound): `src/lib/supabase/server.ts` (lines 4-27).
- Admin client (RLS bypass): `src/lib/supabase/admin.ts` (lines 1-12).
- Ownership assertion pattern: `src/lib/queries.ts` (`assertPortfolioOwnership`).
- Column-level REVOKE fix: `supabase/migrations/020_profile_pii_revoke_hardened.sql`.
- Route handlers using server client: `src/app/api/preferences/route.ts`,
  `src/app/api/attestation/route.ts`.
