# ADR-0020: Multi-tenancy + disclosure tier -- per-row `tenant_id` + per-strategy `disclosure_tier`

## Status
Accepted (retroactively documenting existing decision)

## Context
The application serves two user roles (strategy managers and allocators)
with a partner-pilot model for future multi-tenancy. Two structural
decisions were made in migration 012 that are invisible to anyone not
reading the migration's preamble:

1. **Multi-tenancy is per-row** (nullable `tenant_id`), not multi-schema
   or multi-database. In v1, `tenant_id` is NULL everywhere (single-tenant).
   Adding a partner becomes a configuration change, not a schema migration.

2. **Manager identity is gated in application code**, not at the RLS level.
   The `disclosure_tier` column on strategies determines whether allocators
   can see the manager's identity (bio, years_trading, aum_range). This
   gating happens in the `loadManagerIdentity` helper, which requires the
   admin client because column-level REVOKEs force service-role reads.

## Decision

### Multi-tenancy model
- `tenant_id` is a nullable column on tenant-scoped tables.
- NULL means "default tenant" (the platform itself in v1).
- RLS policies must always filter by `tenant_id` when it is non-NULL.
  A partner's allocators must not see another partner's strategies.
- Adding a new partner: insert a tenant row, backfill `tenant_id` on
  their strategies/portfolios, no schema migration needed.

### Disclosure tier model
- `disclosure_tier` is a CHECK-constrained column on strategies:
  `'institutional' | 'exploratory'`.
- **Institutional tier**: Allocators can see the manager's identity
  (bio, years_trading, aum_range) alongside strategy data.
- **Exploratory tier**: Manager identity is hidden. Allocators see
  strategy data only.
- The `loadManagerIdentity` helper in `src/lib/queries.ts` is the ONLY
  read path for bio/years_trading/aum_range. It uses the admin client
  because column-level REVOKEs prevent the server client from reading
  these columns.
- Flipping a strategy from exploratory to institutional is an
  allocator-visible disclosure event and should be audited (logged to
  `notification_dispatches` or a dedicated audit table).

### TypeScript types
- `DisclosureTier = "institutional" | "exploratory"` is defined in
  `src/lib/types.ts` (line 31).
- The type must stay in sync with the database CHECK constraint.

## Consequences

### Positive
- Future partners plug in without a schema change -- just add a
  `tenant_id` value and configure their strategies.
- Disclosure tier provides a clear, auditable boundary between "can
  see manager identity" and "cannot."
- The per-row model is simple and well-understood.

### Negative
- Partner isolation is soft: RLS policies must correctly filter by
  `tenant_id`. If a policy is missing the filter, cross-tenant leakage
  occurs.
- The admin-client requirement for identity reads adds complexity (see
  ADR-0003 for admin client guidelines).
- The ADR must enumerate which tables have `tenant_id` and which do not,
  as new tables may need the column added retroactively.

## Evidence
- Migration 012: `supabase/migrations/012_disclosure_and_tenancy.sql`
  (lines 1-50) -- creates `disclosure_tier` CHECK column, nullable
  `tenant_id`, and adds bio/years_trading/aum_range to profiles.
- Manager identity gate: `src/lib/queries.ts` (lines 41-50) --
  `loadManagerIdentity` with admin client and disclosure-tier check.
- TypeScript type: `src/lib/types.ts` (line 31) --
  `DisclosureTier = "institutional" | "exploratory"`.
