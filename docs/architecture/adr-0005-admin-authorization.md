# ADR-0005: Admin authorization — consolidate on `isAdminUser` (V1), migrate to `user_app_roles` join table (V2)

## Status
Superseded-in-progress (Sprint 6 closeout Task 7.2 introduces the
join-table pattern; full migration across all admin routes is Sprint 7).

## Context
Admin authorization originally had THREE coexisting implementations,
each with different trust properties and adoption patterns. During
migration 011, `profiles.is_admin` was added and backfilled from
`ADMIN_EMAIL`, but the email-based gate was kept "for zero-downtime
rollout." It was never removed. Any new admin route had to choose
between three conventions, and code review could miss that a given
endpoint used the wrong one.

Beyond the inconsistency, the single-boolean `is_admin` column does
not scale to the multi-role product the Sprint 7 plan requires:
`admin`, `allocator`, `quant_manager`, `analyst`. Overloading
`profiles.role` (already `manager | allocator | both`) would conflate
the marketplace role with the app-access role and prevent a user
holding more than one app role.

### V1 implementations (pre-Task 7.2)

**Pattern A — Email match in proxy** (`src/proxy.ts`, lines 63-82):
Compares `session.user.email` against `ADMIN_EMAIL` env var. Fast (no DB
call), but only works for a single admin. Stopgap until a 2nd admin is
added.

**Pattern B — `isAdmin(email)` pure helper** (`src/lib/admin.ts`, lines
13-16): Email-only comparison. Used by callers that have an email but
no Supabase client. Legacy pattern.

**Pattern C — `isAdminUser(supabase, user)`** (`src/lib/admin.ts`, lines
25-43): Reads `profiles.is_admin` from DB. Falls back to Pattern B
(email check) first for performance. Used by `withAdminAuth` wrapper.

## Decision

### V1 (today, Sprint 6): consolidate on Pattern C via `withAdminAuth`
1. **`withAdminAuth`** (`src/lib/api/withAdminAuth.ts`) is the ONLY
   way to gate admin routes under the V1 pattern. It calls
   `isAdminUser` internally.
2. **Deprecate Pattern B** (`isAdmin(email)`): remove from new code.
   Any caller that only has an email should obtain a Supabase client
   instead.
3. **Proxy check becomes a soft gate**: the proxy email check in
   `src/proxy.ts` remains as a fast-path redirect for non-admin users
   but is explicitly labeled as optimistic / best-effort. The
   authoritative check is `withAdminAuth` at the handler level.

### V2 (Sprint 6 closeout Task 7.2, migrating through Sprint 7): `user_app_roles` join table
1. **Schema** (`supabase/migrations/054_user_app_roles.sql`):
   ```
   CREATE TABLE user_app_roles (
     user_id UUID REFERENCES auth.users ON DELETE CASCADE,
     role TEXT CHECK (role IN ('admin','allocator','quant_manager','analyst')),
     granted_by UUID REFERENCES auth.users,
     granted_at TIMESTAMPTZ DEFAULT now(),
     PRIMARY KEY (user_id, role)
   );
   ```
   A user holds zero or more roles. `profiles.is_admin` is backfilled
   into the `admin` row; `profiles.role` is backfilled into
   `allocator` and/or `quant_manager` rows (one per truth condition,
   so `is_admin=true AND role='allocator'` yields BOTH rows).

2. **TypeScript helpers** (`src/lib/auth.ts`):
   - `AppRole` — closed union, `"admin" | "allocator" | "quant_manager" | "analyst"`.
   - `getUserRoles(supabase, userId)` — DB fetch of a user's role set.
   - `requireRole(supabase, user, ...roles)` — returns a `NextResponse`
     with status 403 when the caller lacks any of the requested roles,
     401 when unauthenticated, or `null` on pass-through.
   - `withRole(...roles)` — route wrapper peer of `withAdminAuth` that
     composes CSRF check + authentication + role gate and threads the
     resolved role set into the handler.

3. **SQL helper** (`public.current_user_has_app_role(TEXT[])`):
   SECURITY DEFINER function that RLS policies can call without
   tripping the `user_app_roles_owner_read` constraint. Mirrors
   `requireRole` at the Postgres layer for defense in depth.

4. **Defense in depth, enforced at BOTH layers**:
   - Route layer: `withRole("admin")` rejects the request before any
     DB query, returning 403 with a clean envelope.
   - DB layer: RLS policies that need role-based filtering call
     `current_user_has_app_role(ARRAY['admin'])` to add an admin-bypass
     path. Migration 054 ships the PILOT on `portfolios` (admin SELECT
     bypass). Broad fanout to the other user-owned tables is Sprint 7.

5. **Back-compat**: `withAdminAuth` and `isAdminUser` continue to read
   `profiles.is_admin`. The V1 path is unchanged; the V2 path opts in
   per-route. Because the backfill in migration 054 populates the
   `admin` row for every `is_admin=true` user, the two paths agree on
   every existing admin at apply time. Sprint 7 removes the
   `profiles.is_admin` column after all admin routes have migrated.

### Pilot route
Task 7.2 ships `POST /api/admin/users/[id]/roles` as the single proof
of the V2 stack end-to-end:
- `withRole("admin")` as the route gate.
- `createAdminClient()` for the user_app_roles mutation.
- `logAuditEvent()` emitting `role.grant` / `role.revoke` on both
  branches (audit entity_type `user_app_role`, entity_id the target
  user id).
- Self-revoke guard: an admin cannot revoke their own admin role via
  this endpoint (self-lockout prevention).

The admin UI at `/admin/users` + `/admin/users/[id]` consumes this
route. The list page uses `isAdminUser` (V1) because it is a read
path; the mutation path is V2. Sprint 7 unifies on V2.

### Future: JWT custom claim
When a 2nd admin is added and Sprint 7 broad migration completes, the
proxy email check can be replaced with a JWT custom claim
(`app_metadata.roles: string[]`) set via a Supabase auth hook. This
eliminates the env-var dependency and the per-request DB query.

### Migration steps
**Sprint 6 closeout (shipped)**:
- Migration 054 introduces `user_app_roles`, backfills from legacy
  columns, installs `current_user_has_app_role`, and pilots an
  admin-SELECT RLS policy on `portfolios`.
- `src/lib/auth.ts` exports `AppRole`, `getUserRoles`, `requireRole`,
  `withRole`.
- `src/lib/audit.ts` gains `role.grant` + `role.revoke` actions and
  `user_app_role` entity_type (see ADR-0023 §4).
- Pilot route + admin UI land.

**Sprint 7 (planned)**:
- Migrate all `/api/admin/**` routes from `withAdminAuth` to
  `withRole("admin")`.
- Fan out the pilot RLS pattern to the 14 other user-owned tables
  (strategies, api_keys, contact_requests, allocations, …).
- Remove `profiles.is_admin` (or mark deprecated) once every read
  path has moved to `user_app_roles`.
- Implement JWT custom claim for proxy fast-path.

## Consequences

### Positive
- Multiple roles per user are first-class (analyst seat, dual-role
  admins, quant-manager+allocator "both" users).
- Route-layer and DB-layer gates agree on the same source of truth
  (`user_app_roles`) so a bypass in one layer can't widen access past
  the other.
- Grant/revoke are audited through the existing `logAuditEvent`
  infrastructure — no new durability machinery required.
- New admin endpoints get mechanical review: `withRole("admin")` is
  the only import to look for under V2.

### Negative
- TWO patterns coexist during the Sprint 6→7 window: `withAdminAuth`
  (V1, reads `is_admin`) and `withRole("admin")` (V2, reads
  `user_app_roles`). Code review must check which pattern a new route
  uses. Mitigated by the backfill keeping the two gates in agreement
  for every existing admin.
- Adding a role requires updates in three places: CHECK constraint
  (new migration), `AppRole` union, ADR-0005 table. Same constraint
  as the `AuditAction` enum per ADR-0023.

## Evidence
- Pattern A (proxy): `src/proxy.ts` (lines 63-82).
- Pattern B (email helper): `src/lib/admin.ts` (lines 13-16).
- Pattern C (DB check): `src/lib/admin.ts` (lines 25-43).
- `withAdminAuth` wrapper: `src/lib/api/withAdminAuth.ts` (lines 12-31).
- V2 migration: `supabase/migrations/054_user_app_roles.sql`.
- V2 TS helpers: `src/lib/auth.ts`.
- Pilot route: `src/app/api/admin/users/[id]/roles/route.ts`.
- Admin UI: `src/app/(dashboard)/admin/users/page.tsx`,
  `src/app/(dashboard)/admin/users/[id]/page.tsx`, and
  `src/components/admin/UserRolesPanel.tsx`.
- `profiles.is_admin` column: `supabase/migrations/011_perfect_match.sql`.
- Audit integration: ADR-0023 §4 (role.grant + role.revoke mapping).
