# Phase 204: INTROAUTH - Context

**Gathered:** 2026-11-10
**Status:** Ready for planning
**Mode:** autonomous smart-discuss (no founder questions possible; every gray-area choice below is the orchestrator's recommended option, marked as such)

<domain>
## Phase Boundary

The database side of the intro path enforces what `/api/intro` enforces: only an approved,
attested allocator can create an intro, on every entry point, not only through the route.

Two database objects are in scope, and nothing else:

1. The `contact_requests_insert` RLS policy on `public.contact_requests` (created in
   `supabase/migrations/20260405061912_rls_policies.sql:47`, never replaced since;
   `supabase/schema/baseline.sql:16605`). Its `WITH CHECK` is `allocator_id = auth.uid()` only.
2. The 6-arg `public.send_intro_with_decision(uuid, uuid, uuid, uuid, text, uuid)`, SECURITY
   DEFINER, owned by `postgres`. Its ACL holds EXECUTE for `anon`, `authenticated` and
   `service_role` (`baseline.sql:18051-18054`). `20260419140916_match_decisions_original_strategy.sql:133-134`
   granted `authenticated` explicitly; the `anon` grant came from the schema's default privileges.

Re-measured at HEAD 2026-11-10, with a read-only catalogue check through the Supabase MCP (marker
query first): the 5-arg overload is gone, and no trigger on `contact_requests` is involved.

Out of scope: the `/api/intro` route logic, the `contact_requests_update` / `_read` policies, the
table-level grants, any UI.
</domain>

<decisions>
## Implementation Decisions

### D-01 — Tighten the INSERT policy's `WITH CHECK`; keep direct inserts by the signed-in user (orchestrator default, founder may revisit)
- `ALTER POLICY "contact_requests_insert" ON public.contact_requests WITH CHECK (...)` — keeps the
  policy name, no DROP/CREATE window.
- Rejected alternative: revoke INSERT from `authenticated` and insert via the service role.
  `/api/intro` (`src/app/api/intro/route.ts:188`) inserts with the USER-scoped client, so that
  option forces a route rewrite. The policy change closes every entry point with no app change.

### D-02 — The policy mirrors the route's predicate exactly, no stricter and no looser (orchestrator default, founder may revisit)
The new `WITH CHECK` is the conjunction of:
- `allocator_id = auth.uid()` (unchanged);
- the caller's `profiles` row satisfies `isProfileApproved` (`src/lib/approval.ts`):
  `is_admin` → approved; else role `allocator` needs `allocator_status = 'verified'`, role `both`
  needs `allocator_status = 'verified' AND manager_status = 'verified'`, role `manager` → refused
  by the next bullet, anything else → refused;
- role is `allocator` or `both` (`route.ts:106`) — note this applies to admins too, matching the
  route, which runs the role check after the approval gate;
- an `investor_attestations` row for the caller with `attested_at IS NOT NULL`
  (`route.ts:119-136`).
A policy stricter than the route would turn a legitimate request into the route's 500
(the route maps only 23505 to 409); looser would leave the gap.

### D-03 — Inline `EXISTS` subqueries, no new SECURITY DEFINER helper (orchestrator default, founder may revisit)
- Measured: no SELECT policy on `profiles` (`profiles_read_public`) or `investor_attestations`
  (`attestations_self_read`, `attestations_admin_read`) references `contact_requests`, so there is
  no policy-recursion risk, and the caller can read both of its own rows under RLS.
- No new function means no new ACL to harden, no `database.types.ts` change and no function census
  movement. If execution measures a recursion or visibility problem, a zero-argument helper reading
  `auth.uid()` internally (never a `p_user_id` argument) with anon EXECUTE is the fallback.

### D-04 — Revoke client EXECUTE on the 6-arg `send_intro_with_decision`; no in-body check (orchestrator default, founder may revisit)
- `REVOKE ALL ON FUNCTION public.send_intro_with_decision(uuid, uuid, uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated;`
  `service_role` keeps EXECUTE.
- Measured: the only app caller is `src/app/api/admin/match/send-intro/route.ts:460`, via
  `createAdminClient()` (service role), behind `isAdminUser`. No `scripts/`, `e2e/` or
  `analytics-service/` caller. An in-body `auth.uid()`/admin check would see NULL under the service
  role and break the admin path. The function is not used inside any policy, so the
  "SECDEF helpers in {public} policies need anon EXECUTE" rule does not apply.
- No `CREATE OR REPLACE` — the body is unchanged, so there is nothing to re-base.
- Precedent for the REVOKE shape: `20260409133655_function_execute_hardening.sql`.

### D-05 — Admin-sent intros stay admin-authorized (orchestrator default, founder may revisit)
The SECURITY DEFINER RPC is owned by `postgres` and bypasses RLS, so the admin match path keeps
creating intros for an allocator chosen by the admin, without the D-02 predicate. Requiring the
target allocator to be approved and attested on the admin path would be a product change beyond
this phase's goal.

### D-06 — Migration assertions read the catalogue only
Any `DO` block in the migration asserts on `pg_policies` / `pg_proc.proacl` /
`has_function_privilege`, never on table rows (TEST is schema-only; a data-reading RAISE would
block the PROD apply).

### D-07 — SQL gate in `supabase/tests` with biting `RED-UNDER` annotations
A gate proves: (a) the policy refuses an insert from an unapproved, a non-allocator and an
unattested caller, and admits an approved, attested allocator; (b) `anon` and `authenticated` hold
no EXECUTE on the 6-arg function and `service_role` does. Every new arm carries a `RED-UNDER`
annotation that the mutation runner shows biting. A new gate file moves several censuses
(mutation floors, ratchet tests, lint fixtures): grep them all and move every one.

### D-08 — Public-repo wording rule (binding on every artifact of this phase)
`.planning` is tracked and public. Until the change is live on PROD, no tracked text — commits,
plans, SUMMARYs, migration comments, test and arm names — describes how to misuse the current
policy or function, or states that the live objects are currently open. Describe the change as
hardening the intro path's database-side authorization so it matches `/api/intro`. The phase's
`held/` directory is reference-only and is NEVER committed (`git add` explicit paths only; check
`git show --stat` after each commit).

### Claude's Discretion
- Migration filename timestamp (after `20261110120000`), comment wording within D-08, gate file
  name and arm layout, and whether the route's existing comment ("RLS on contact_requests is the
  DB-layer gate") needs any touch (prefer not).
</decisions>

<canonical_refs>
## Canonical References

- `supabase/schema/baseline.sql` — lines 9996-10054 (function), 16602-16620 (policies), 18051-18054 (function ACL), 18622-18624 (table grants), 16455-16469 (attestation policies), 16965 (profiles read policy)
- `supabase/migrations/20260405061912_rls_policies.sql` — original policy
- `supabase/migrations/20260419140916_match_decisions_original_strategy.sql` — current function definition and grants
- `supabase/migrations/20260409133655_function_execute_hardening.sql` — REVOKE precedent
- `src/app/api/intro/route.ts` — the predicate to mirror
- `src/lib/approval.ts`, `src/lib/api/approval-gate.ts` — approval truth table
- `src/app/api/admin/match/send-intro/route.ts` — admin RPC caller (service role)
- `src/__tests__/audit-coverage.test.ts:384` — lists the RPC as a mutating RPC (unaffected)
- `src/__tests__/match-decisions-schema.test.ts` — calls the RPC with the admin client
- `scripts/mutation-runner/run.mjs`, `scripts/mutation-floors.mjs`, `scripts/lint-sql-gates.mjs` — SQL gate machinery
- CLAUDE.md — PROD auto-apply after apply-test; migration-reviewer and rls-policy-auditor before merge
</canonical_refs>

<code_context>
## Existing Code Insights

- Seed scripts (`scripts/seed-demo-data.ts`, `scripts/seed-full-app-demo.ts`) insert
  `contact_requests` — confirm during planning that they use the service-role client (RLS bypass).
- `RequestIntroButton.tsx` only SELECTs; the write goes through `/api/intro`.
- `analytics-service/services/job_worker.py` only UPDATEs `contact_requests` (snapshot columns).
</code_context>

<deferred>
## Deferred Ideas

- `contact_requests_update` and `_read` policies, and the table-level anon grants — not part of
  this phase's goal; not changed.
</deferred>

---

*Phase: 204-introauth*
