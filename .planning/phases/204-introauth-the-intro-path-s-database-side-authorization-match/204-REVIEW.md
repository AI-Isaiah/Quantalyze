---
phase: 204-introauth
round: 1
reviewed_range: a83b7ac8c..ec29146af
scope: diff excluding .planning
threshold: MEDIUM and above
reviewed: 2026-11-10
status: issues_found
findings: { critical: 0, high: 0, medium: 1 }
---

# Phase 204 review, round 1

Four reviewers ran in parallel over `a83b7ac8c..ec29146af` (`.planning` excluded). They were
asked for MEDIUM and above only.

Before the review, the migration ordering was re-measured read-only through the Supabase MCP,
with the marker query first (it answered PRODUCTION). The applied tip there is `20261110120000`.
`origin/main`'s newest migration is also `20261110120000`. The new `20261110150000` sorts after
both.

## gsd-code-reviewer (opus): no MEDIUM+ findings

- **Check 1, predicate parity: matches exactly in both directions.** The route code was quoted:
  - `src/app/api/intro/route.ts:91-92` with `src/lib/api/approval-gate.ts:33-37` and `src/lib/approval.ts` `isProfileApproved`;
  - the role check at `route.ts:97-108`;
  - the attestation check at `route.ts:116-136`.

  The case-by-case comparison: a manager, an admin with role `manager`, a missing profile and a
  NULL role are refused by both sides. An admin with role `allocator` or `both` is admitted by
  both. `profiles.is_admin` is NOT NULL, and `investor_attestations.user_id` is the primary key.
  Column grants and the self-read policies let the caller read every value the policy reads.
  `contact_requests_insert` is the only INSERT policy on the table.
- **Check 2: no SECURITY DEFINER function is used in the policy,** so no anon EXECUTE is needed.
- **Check 3: no caller breaks.** The repo-wide grep found one runtime caller,
  `src/app/api/admin/match/send-intro/route.ts:460`, which uses `createAdminClient()`. The test
  references use the admin client or list the name only. No other database function inserts
  into `contact_requests`.
- **Check 4: the rollback is exact.** It was applied on a throwaway pg-lane: the policy came back
  as `allocator_id = auth.uid()` with roles `{public}`, and the ACL came back as it was before
  `20261110150000`.
- **Check 5: the gate bites.** `mutation-runner --file` gave 15/15 arms `RED (identity ok)`.
  - The census matches `--parse-only`: 81/108 files, 830 arms.
  - vitest passed 1494/1494 across eight census and contract files, and 60/60 across five related files.
- **Not run:** the real-schema `sql-tests` lane, which needs Docker. It is CI-only.
- **Below threshold, not booked:** see the "Below threshold" section at the end.

## pr-review-toolkit:silent-failure-hunter (sonnet): 1 MEDIUM

### SF-01 [MEDIUM, user-facing]: a policy refusal reaches `/api/intro` as an unlogged generic 500

**Where:** the `if (error)` block after the `contact_requests` insert in
`src/app/api/intro/route.ts`.

**Issue:** that block maps only `23505` to 409. Every other error, including an RLS refusal
(`42501`), returns `{error: "Failed to create request"}` with status 500. It carries no named
code and sends no Sentry capture. The rest of the route uses named codes and captures, for
example `INTRO_ATTESTATION_CHECK_FAILED`.

**Why it matters now:** the policy is now a third copy of the route's checks. If the two copies
ever drift apart, or a status changes between the route's reads and the insert, the allocator
sees an unexplained 500. Nothing is recorded, so nobody can act on it.

**Fix:** handle `error.code === "42501"` as its own case. Capture it to Sentry with an
`area: intro` tag and a stage tag for an insert refused by policy, and return 403 with a named
refusal code. Capture the remaining generic 500s as well.

**Checked sound:**
- The deny arms require all of: a refusal, SQLSTATE `42501`, a row-level-security message, and
  zero rows. The admit arms require exactly one row. The ARM 0 controls stop the gate from
  passing vacuously.
- The twins are post-apply steps.
- The real schema's column grants match the lane fixture.
- The REVOKE keeps `service_role`.
- The rollback matches the baseline.
- The census edits only raise floors.

## migration-reviewer (sonnet): clean

0 CRITICAL, 0 HIGH, 0 MEDIUM.

- **Filename and ordering:** the filename matches the convention and sorts after `20261110120000`.
- **The diff:** it adds two files and edits no migration that has already been applied.
- **Code checks:** there are no template artifacts. RAISE formats are single literals. The
  migration has no transaction control, and the rollback's transaction control matches its
  sibling `down/` files.
- **Apply safety:** the DO block reads only the catalogue, so it cannot refuse on schema-only
  TEST and block PROD.
- **Policy:** the subqueries cause no recursion, and the predicate matches the route.
- **Rollback:** it is an exact restore of the prior policy text and the prior effective ACL,
  including the explicit default-privilege grant.
- **Assertions:** the ACL assertions bite. The policy-text assertions are deliberately loose,
  and the behavioural gate covers that logic.
- **Callers:** the only runtime caller is the service-role admin route.

## rls-policy-auditor (sonnet): clean

0 CRITICAL, 0 HIGH, 0 MEDIUM.

- **Parity:** the `WITH CHECK` matches `/api/intro` exactly, case by case, including NULL
  handling.
- **Policy shape:** there is no recursion and no restrictive or FORCE policy on the tables read.
  Column grants cover the subqueries. `ALTER POLICY` keeps the roles at `{public}`, and the
  table has no other INSERT policy.
- **Helpers:** no SECURITY DEFINER helper is used in the policy.
- **The function:** after the REVOKE, `send_intro_with_decision` is callable only by
  `service_role`. It is the only database function that inserts into `contact_requests`, and
  there is no other client-callable insert path.
- **Layering:** the two-layer authorization model holds, and the D-04 and D-05 rationale is
  correct.
- **Notes outside the phase boundary (CONTEXT `<deferred>`), not booked here:**
  - The policy controls who may insert, not the row's other column values.
  - `contact_requests_update` has no explicit `WITH CHECK`.
  - The function's `search_path` is `public` only, and its body is untouched by this phase.

## Disposition

| ID | Severity | Class | Disposition |
|---|---|---|---|
| SF-01 | MEDIUM | user-facing (silent 500 on the intro route) | Fixer round 1 |

The review rule runs a fixer round when there is a user-facing MEDIUM. migration-reviewer and
rls-policy-auditor are already clean.

## Below threshold (not fixed, per the LOW/INFO rule)

From the code reviewer:
- The migration has no `lock_timeout`.
- POL-BOTH-HALF covers only one of the two half-verified orders.
- No arm proves that service-role inserts still pass.
- Two file headers name the pre-migration grantees in prose. That fact is already public in
  `baseline.sql`.
