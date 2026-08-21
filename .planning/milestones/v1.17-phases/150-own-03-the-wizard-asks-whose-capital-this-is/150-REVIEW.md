---
phase: 150-own-03-the-wizard-asks-whose-capital-this-is
reviewed: 2026-08-06T21:57:01Z
depth: standard
files_reviewed: 61
files_reviewed_list:
  - analytics-service/services/audit.py
  - src/__tests__/format-percent-contract.test.ts
  - src/__tests__/no-store-coverage.test.ts
  - src/__tests__/phase-150-capital-ownership-invariant.test.ts
  - src/app/(dashboard)/allocations/AllocationsTabs.tsx
  - src/app/(dashboard)/allocations/components/AllocateDialog.test.tsx
  - src/app/(dashboard)/allocations/components/AllocateDialog.tsx
  - src/app/(dashboard)/allocations/components/HoldingsTable.strategy-rows.test.tsx
  - src/app/(dashboard)/allocations/components/HoldingsTable.tsx
  - src/app/(dashboard)/allocations/HoldingsTabPanel.tsx
  - src/app/(dashboard)/allocations/lib/strategies-row-adapter.test.ts
  - src/app/(dashboard)/allocations/lib/strategies-row-adapter.ts
  - src/app/(dashboard)/allocations/page.tsx
  - src/app/(dashboard)/my-strategies/MyStrategiesSection.tsx
  - src/app/(dashboard)/strategies/new/wizard/steps/MetadataStep.test.tsx
  - src/app/(dashboard)/strategies/new/wizard/steps/MetadataStep.tsx
  - src/app/(dashboard)/strategies/new/wizard/steps/SubmitStep.tsx
  - src/app/(dashboard)/strategies/new/wizard/WizardClient.test.tsx
  - src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx
  - src/app/api/portfolio-strategies/allocation/route.test.ts
  - src/app/api/portfolio-strategies/allocation/route.ts
  - src/app/api/strategies/[id]/name/route.test.ts
  - src/app/api/strategies/[id]/name/route.ts
  - src/app/api/strategies/[id]/ownership/route.test.ts
  - src/app/api/strategies/[id]/ownership/route.ts
  - src/app/api/strategies/finalize-wizard/route.test.ts
  - src/app/api/strategies/finalize-wizard/route.ts
  - src/app/factsheet/[id]/v2/FactsheetView.owner-notice.test.tsx
  - src/app/factsheet/[id]/v2/FactsheetView.tsx
  - src/app/factsheet/[id]/v2/page.owner-lane.test.tsx
  - src/app/factsheet/[id]/v2/page.tsx
  - src/components/portfolio/AddToPortfolio.test.tsx
  - src/components/portfolio/AddToPortfolio.tsx
  - src/components/strategy/CapitalOwnershipRadioGroup.test.tsx
  - src/components/strategy/CapitalOwnershipRadioGroup.tsx
  - src/components/strategy/MarkOwnershipDialog.test.tsx
  - src/components/strategy/MarkOwnershipDialog.tsx
  - src/components/strategy/OwnershipTag.test.tsx
  - src/components/strategy/OwnershipTag.tsx
  - src/components/strategy/RenameStrategyDialog.test.tsx
  - src/components/strategy/RenameStrategyDialog.tsx
  - src/components/strategy/StrategyTable.tsx
  - src/components/strategy/StrategyTable.visibility.test.tsx
  - src/lib/api/limiter-ordering.test.ts
  - src/lib/audit.ts
  - src/lib/capital-ownership.test.ts
  - src/lib/capital-ownership.ts
  - src/lib/database.types.ts
  - src/lib/dollar-validation.test.ts
  - src/lib/dollar-validation.ts
  - src/lib/queries.ts
  - src/lib/types.ts
  - supabase/migrations/20260806120000_strategies_capital_ownership.sql
  - supabase/migrations/20260806130000_seed_weight_snapshot_secdef.sql
  - supabase/schema/functions/flip_capital_ownership_to_team_review.sql
  - supabase/schema/functions/guard_allocation_requires_own_capital.sql
  - supabase/schema/functions/seed_weight_snapshot_for_portfolio_strategy.sql
  - supabase/schema/functions/seed_weight_snapshots_for_portfolio.sql
  - supabase/tests/test_capital_ownership_allocation_guard.sql
  - supabase/tests/test_capital_ownership_column.sql
  - supabase/tests/test_weight_snapshot_seed_secdef.sql
findings:
  critical: 0
  warning: 3
  info: 4
  total: 7
status: issues_found
---

# Phase 150: Code Review Report

**Reviewed:** 2026-08-06T21:57:01Z
**Depth:** standard
**Files Reviewed:** 61
**Status:** issues_found

## Summary

Reviewed the full OWN-03/OWN-05 surface: the capital-ownership migration pair
(column + CHECK + three triggers + flip RPC; seed-trigger SECDEF repair), the
three new API routes (allocation money write, ownership mark, rename), the
shared predicate/validator leaves, the D-12-A union adapter and Holdings
strategies table, the wizard capital question, the retro Mark/Rename dialogs,
the factsheet owner lane, and the DB + structural test suites.

The security-sensitive core holds up under adversarial reading. I attempted to
break the flip RPC (non-owner call, caller-holds-position, service-role
context), the D-03-A trigger (third-party inserts, upsert edits, repoint,
RLS-blindness), the mark-transition guard (raw PATCH, NULL transitions,
ordering vs the RPC's DELETE-before-UPDATE), the cache isolation on the
factsheet owner lane, and the allocation route's provision-ordering /
23505-race arms — each attack is closed and pinned by a test that would
genuinely fail. The B15 validate-then-limit ordering, no-store coverage, CSRF,
and audit taxonomy additions (TS + Python parity) are all correctly wired. No
Critical (user-facing breakage / data-integrity) finding.

Three Warnings: a real user-facing data gap on the new money surface (MTD
strands for API-ingested marked strategies — the phase-147 guard is satisfied
textually but its intent is defeated), a discarded error contract at the one
call site of the two new queries (transient DB failure renders as a definitive
empty state, which the queries' own docblocks forbid), and a vacuous
structural assertion in the DB guard test (case 7c's occurrence count is
inflated by in-body comments and cannot fail).

## Warnings

### WR-01: `getOwnCapitalStrategies` selects `returns_series` but never resolves it — MTD strands at "—" for every API-ingested marked strategy

**File:** `src/lib/queries.ts:1692-1733`, `src/app/(dashboard)/allocations/lib/strategies-row-adapter.ts:194,223`
**Issue:** Per `phase-147-series-resolution-guards.test.ts` (its own header), an
API-ingested strategy has `daily_returns = NULL` and its real track in
`returns_series` (a cumprod wealth index); "a bare `daily_returns` reader
strands every API-ingested strategy at `[]`". The dashboard position query
resolves this server-side (`resolveDailyReturnSeries`, queries.ts:3982) and
emits the resolved series *as* `daily_returns`. `getOwnCapitalStrategies` does
NOT: it selects `returns_series` (queries.ts:1713) — which satisfies the
phase-147 Layer-A grep — but returns the raw rows
(`(data ?? []) as unknown as OwnCapitalStrategy[]`, :1733) with no resolution,
and the `OwnCapitalStrategy` type's `strategy_analytics` Pick omits
`returns_series`, so no downstream reader can even reach it. The adapter's
`computeMtd(s.strategy_analytics?.daily_returns)` (strategies-row-adapter.ts:223,
half 2) therefore sees `null` → `[]` → MTD renders "—" for every marked-but-
unallocated API-key strategy — which is the phase's primary persona (the
capital question is asked at API key-add). Sharpe/MaxDD render from their own
columns; only MTD strands. The selected `returns_series` column is dead weight
on the wire, and the Layer-A guard's intent (never a bare reader) is defeated
while its letter passes.
**Fix:** Resolve server-side in `getOwnCapitalStrategies`, mirroring the
dashboard path — map each row's analytics through `resolveDailyReturnSeries(a.daily_returns, a.returns_series, …)`
and emit the resolved series as `daily_returns`, stripping the raw
`returns_series` before returning (the queries.ts:3966-3990 `_dqf`-destructure
idiom). Then the adapter needs no change. Add an adapter/query test fixture
with `daily_returns: null` + populated `returns_series` asserting a non-null
MTD — no such fixture exists today (`strategies-row-adapter.test.ts` never
exercises `returns_series`).

### WR-02: allocations/page.tsx collapses the null-vs-empty error contract the two new queries were built to provide

**File:** `src/app/(dashboard)/allocations/page.tsx:115,156`
**Issue:** `getOwnCapitalStrategies` and `getMyStrategies` both return `null`
(never `[]`) on a transient DB/RLS failure — `getOwnCapitalStrategies`'s
docblock says this exists precisely so "a caller can distinguish 'nothing
marked yet' from 'fetch failed' and avoid rendering a definitive empty state
to an owner who HAS marked strategies", and page.tsx's own comment repeats "a
fetch error cannot masquerade as a definitive empty state". The sole caller
then does exactly that: `ownCapitalStrategies={ownCapitalStrategies ?? []}`
(:156) and `hasAnyStrategies = ((myStrategies?.length ?? 0) > 0)` (:115). On a
transient failure the owner's marked-but-unallocated rows silently vanish from
the money surface, positioned rows lose their own-capital tag and the
Allocate/Edit affordance (the adapter derives `capitalOwnership` from
marked-set membership), and if the position half is also empty the panel
renders the definitive "No strategies yet." / "No strategies marked as own
capital." copy — a fabricated claim about the account. The error contract is
built, documented twice, and discarded at its only consumption point.
**Fix:** Distinguish the null arm at the page. Minimal version consistent with
the sibling reads' throw-to-error.tsx discipline:
```ts
if (ownCapitalStrategies === null || myStrategies === null) {
  throw new Error("allocations: strategies read failed (transient)"); // error.tsx boundary
}
```
or thread a `strategiesLoadFailed` prop and render an error strip instead of
the empty-state arms. Either way, `null` must not reach the panel as `[]`/`false`.

### WR-03: DB guard test case 7c is vacuous — the `auth.uid()` occurrence count is inflated by the function body's own comments

**File:** `supabase/tests/test_capital_ownership_allocation_guard.sql:543-554`
**Issue:** Case 7c asserts the flip RPC "carries all three explicit auth.uid()
predicates" by counting `auth.uid()` occurrences in `pg_get_functiondef()`
with a `>= 3` threshold. `pg_get_functiondef` returns the body verbatim,
comments included, and the body's comments contain four more `auth.uid()`
occurrences (migration 20260806120000 lines ~509, ~518, ~534, ~544-548) — 7
total. Delete all three code predicates and the count is still 4 ≥ 3: the case
cannot fail for the mutation it exists to catch, despite its failure message
claiming "nothing else in this suite would notice". The vitest pin P4
(`phase-150-capital-ownership-invariant.test.ts:692-716`) does this correctly
— whole-line comment stripping plus an exact `=== 3` — so repo-side edits are
covered; but P4 reads the migration *file*, while 7c is the only control that
runs against the *live database*, which is exactly where a direct
MCP-applied hotfix or a later migration with different comments would drift.
This is the self-matching-comment trap the phase's own files repeatedly warn
about, landed in the one place that checks the deployed artifact.
**Fix:** Count against a comment-stripped body, and pin exactly:
```sql
SELECT (length(body) - length(replace(body, 'auth.uid()', ''))) / length('auth.uid()')
  INTO row_cnt
FROM (
  SELECT string_agg(line, E'\n') AS body
  FROM (
    SELECT unnest(string_to_array(pg_get_functiondef(p.oid), E'\n')) AS line
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'flip_capital_ownership_to_team_review'
  ) l WHERE line !~ '^\s*--'
) s;
IF row_cnt <> 3 THEN … END IF;
```
(Exact `= 3`, matching P4's bar, so a comment edit that adds an inline
occurrence also reddens rather than silently re-arming the inflation.)

## Info

### IN-01: Three Phase-150 docblocks repeat the "strategies_update has NO WITH CHECK" claim that the migration's own rev-3 pass established is false

**File:** `src/app/api/strategies/[id]/ownership/route.ts:42-44`, `src/app/api/strategies/[id]/name/route.ts:46-47`, `src/app/api/strategies/finalize-wizard/route.ts:1339-1342`
**Issue:** All three assert the `.eq("user_id", …)` predicate is "the real
tenant gate" because `strategies_update` RLS has "NO WITH CHECK
(20260405061912_rls_policies.sql:32)". That policy was DROPped and recreated
with an explicit `WITH CHECK (user_id = auth.uid())` by
`20260410225610_sec005_follow_ups.sql:101-105` — a correction migration
20260806120000 itself records ("rev-3 CITATION RE-BASE… That is FALSE").
The predicates are correct defence-in-depth either way, but the routes'
security reasoning cites a policy state that has not existed since April, and
the phase now ships both the corrected claim (migration) and the stale one
(routes) side by side — a Rule-7 conflict a future editor will average.
**Fix:** Reword the three docblocks to the migration's corrected ground:
belt-and-braces against a future SECURITY DEFINER / service-role context, not
"the real tenant gate"; cite 20260410225610.

### IN-02: The allocation route has no status gate — an archived (or otherwise UI-hidden) own-capital strategy is allocatable via direct API

**File:** `src/app/api/portfolio-strategies/allocation/route.ts:195-216`
**Issue:** `getOwnCapitalStrategies` filters `.neq("status", "archived")` and
its docblock defines the result as "everything the Holdings panel may offer an
`Allocate…` action for". The route's pre-check selects only
`id, capital_ownership` with no status conjunct, and the D-03-A trigger reads
only the mark — so a POST with an archived own-capital strategy's id mints a
live position the UI would never have offered, which then renders in the
positions half. Owner-only, own-book, so no tenant risk; but the write gate is
wider than the render gate with no recorded decision either way (contrast
D-17, where the rename route deliberately mirrors its render gate
server-side). Similarly, `StrategyTable`'s "Mark ownership…" action renders on
archived rows.
**Fix:** Either add `.neq("status", "archived")` to the route's strategy
pre-check (mirroring the marked-set filter) or record the acceptance in the
route docblock so the mismatch reads as a decision rather than an oversight.

### IN-03: A mark-flip race between the allocation route's 409 pre-check and the upsert surfaces as a 500, and the dialog does not refresh stale affordances on that arm

**File:** `src/app/api/portfolio-strategies/allocation/route.ts:298-304`, `src/app/(dashboard)/allocations/components/AllocateDialog.tsx:207-219`
**Issue:** The route's docblock is explicit that "the 409 pre-check is UX; the
trigger is the gate" — but when the trigger fires (mark flipped between
pre-check and write, or the case-4 upsert-edit arm), `writeErr` is a 23514
that the route maps to a generic 500 `internal error`. The dialog only calls
`router.refresh()` on 409, so on this arm the user gets the UNKNOWN envelope
with a Retry that re-fails identically against a stale affordance — the exact
outcome the 409 arm's refresh exists to prevent, reachable through a one-line
race.
**Fix:** In the POST error arm, map the trigger's SQLSTATE to the same
envelope as the pre-check: `if (writeErr.code === "23514") return json({ error: "not_allocatable" }, 409);`
(the Supabase error object carries `code`). No client change needed — the
existing 409 arm then refreshes the row set.

### IN-04: MarkOwnershipDialog's confirm arm leaves "Keep own capital" (and Cancel/backdrop) enabled while the destructive removal is in flight

**File:** `src/components/strategy/MarkOwnershipDialog.tsx:159-181`
**Issue:** After clicking "Change mark and remove allocation", `submit(true)`
is in flight and only the danger button is disabled. Clicking "Keep own
capital" during that window clears `pendingRemoval` and repaints the radio
view as if the flip were declined — but the request is already committed
server-side; moments later the dialog closes and the refresh shows the
position gone. The user's last observed interaction says "kept", the outcome
is "removed". The sibling `AllocateDialog` disables *both* confirm-arm buttons
with `busy`; this dialog should match.
**Fix:** Add `disabled={status === "loading"}` to the "Keep own capital"
button (and the plain-arm Cancel), mirroring AllocateDialog's `busy` guard.

---

## Verified attack surface (negative findings — checked, not assumed)

- Flip RPC: owner precheck runs before the DELETE (F1 closed); non-owner call
  with a held position is a proven no-op (guard-test 7d); DELETE-before-UPDATE
  order pinned twice (migration self-check 5e, vitest P4).
- D-03-A: unconditional team_review arm proven non-RLS-blind via the private
  third-party probe (2c); repoint hole (F4) closed with column-targeted
  trigger; alias write preserved (cases 5, 7i positive control).
- Mark-transition guard: NULL-safe (`IS NOT DISTINCT FROM`), owner-scoped,
  column-targeted; raw-PATCH stranding closed (7f) with positive control (7g).
- Seed-trigger SECDEF repair: deny policies proven intact (test assertion 2);
  FORCE-RLS and owner-exemption preconditions asserted rather than assumed.
- Cache isolation: ownership mark never enters `buildFactsheetPayloadCached`'s
  callback (P7); OwnershipTag mounts in the shared table gated on
  `visibility === "owner-all-statuses"` (P8) — public rows do arrive
  mark-populated, so this gate is load-bearing and pinned.
- Allocation route: pre-checks before provisioning (a 404/409 probe mints no
  container), 23505 race re-select fails closed on an empty re-select, upsert
  is count-checked, `current_weight` is never written (P3), no `portfolio_id`
  crosses the trust boundary.
- B15 ordering, no-store (33→36 with count pin), CSRF, strict-boolean
  `confirm_remove_allocation`, mass-assignment narrowing, and the TS↔Python
  audit-action parity additions are all correct.

---

_Reviewed: 2026-08-06T21:57:01Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
