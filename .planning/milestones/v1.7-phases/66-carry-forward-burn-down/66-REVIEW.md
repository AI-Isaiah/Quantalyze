---
phase: 66-carry-forward-burn-down
reviewed: 2026-07-04T00:00:00Z
depth: standard
files_reviewed: 12
files_reviewed_list:
  - scripts/sweeps/f4-memberkeyids-restamp.sql
  - supabase/tests/test_scenario_downgrade_sweep.sql
  - src/app/(dashboard)/allocations/AllocationsTabs.tsx
  - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
  - src/app/(dashboard)/allocations/components/ScenarioComparePanel.tsx
  - src/app/(dashboard)/allocations/lib/scenario-state.ts
  - src/app/api/allocator/scenario/share/route.ts
  - src/app/api/allocator/scenario/saved/route.ts
  - src/app/api/for-quants-lead/route.ts
  - src/app/scenario-share/[token]/share-resolve.ts
  - src/components/layout/MobileNav.tsx
  - src/components/layout/Sidebar.tsx
findings:
  critical: 0
  warning: 1
  info: 1
  total: 2
resolution:
  warning_fixed: 1
  info_open: 1   # IN-01 — info, out of default fix scope
  fix_commits:
    - WR-01: 08d3f8b2
status: fixed
---

# Phase 66: Code Review Report

**Reviewed:** 2026-07-04
**Depth:** standard
**Files Reviewed:** 12 (source; associated test files also inspected for fidelity)
**Status:** WR-01 fixed (commit `08d3f8b2`); IN-01 open (info, out of default fix scope)

## Summary

Reviewed the phase-66 carry-forward burn-down diff (9 commits: F-3 dead-disjunct
deletion, memberKeyIds cap raise + honest error copy, F-4 re-stamp sweep SQL +
pgTAP fixture, dead `holdingReturnsByScopeRef` pipeline removal, gantt friendly
labels, compare-panel payload narrow, 99+ badge cap, DesktopGate comment fixes,
TODOS.md triage).

The bulk of this diff is high-quality, well-reasoned cleanup and holds up under
adversarial tracing:

- **F-3 (share-mint disjunct deletion):** VERIFIED correct. The removed
  `isBookOnlyDraft(draft)` disjunct was provably dead — it can only be true when
  `addedStrategies.length === 0`, which `nothingShareable` already covers, so the
  `||` branch never changed the outcome. Deletion is behavior-preserving.
- **memberKeyIds cap raise (64 → 1000):** VERIFIED consistent. `MAX_MEMBER_KEY_IDS`
  is applied to `scenarioDraftSchema`, and `scenarioDraftSaveSchema` extends that
  schema (inherits the cap), so decode and both save routes (POST + PUT) share one
  ceiling. The per-id `.max(MAX_DRAFT_KEY_LENGTH)` + route `MAX_DRAFT_BODY_BYTES`
  remain the real DoS bounds.
- **over-cap error copy:** VERIFIED. Save route emits `{ issues: [{ code:"too_big",
  path:["draft","memberKeyIds"] }] }`; `saveErrorMessage` uses `path.includes(...)`
  which correctly matches the nested path. Tests pin both the positive (honest
  ceiling copy) and negative (no-scope-creep generic copy) cases.
- **compare-panel payload narrow:** VERIFIED complete. The panel reads exactly the
  5 fields the explicit narrow supplies (`holdingsSummary`, `strategies`,
  `perKeyReturnsByApiKeyId`, `eligibleApiKeyIds`, `perKeyDailiesGateSatisfied`);
  the type requires only the first two, so it is compiler-gated. Replaces an
  unchecked `props as unknown as ...` double-cast — a genuine improvement.
- **gantt friendly labels:** VERIFIED. `apiKeyLabelById.get(s.id)` keys on
  `s.id`, and `buildPerKeyStrategyForBuilderSet` sets `id: apiKeyId` (id ===
  api_key_id), so per-key rows resolve; strategy rows have no map entry and fall
  through to `s.name`.
- **dead pipeline removal:** VERIFIED clean. No remaining references to
  `holdingReturnsByScopeRef` / `reconstructHoldingReturnsByScopeRef`;
  `holdingScopeKey` remains referenced elsewhere. Deleted tests were all bound to
  the removed helper; the multi-venue-not-collapsed invariant remains covered by
  `keys.test.ts`.
- **badge cap + for-quants-lead:** VERIFIED. `formatBadgeCount` is display-only;
  aria-labels retain the true count. The for-quants-lead change is comment-only
  (no logic touched).

One substantive defect: the F-4 sweep SQL's "has series" check is not a faithful
mirror of the runtime series-derivation, so its "byte-equal to a reopen" claim
does not hold for one data shape (below). Plus one low-severity precision issue in
the over-cap error mapper.

## Warnings

### WR-01: F-4 sweep `has_series` diverges from the runtime series filter — stamped membership is not always byte-equal to a reopen

**STATUS: FIXED** (commit `08d3f8b2`). `has_series` now excludes the three
non-finite `float8` literals so it mirrors `buildPerKeyReturnsByApiKeyId`'s
`Number.isFinite` drop. Correction to the fix suggestion below: `csv_daily_returns.daily_return`
is `DOUBLE PRECISION NOT NULL` (not NUMERIC), so (a) no `IS NOT NULL` guard is
needed — the column forbids NULL — and (b) the suggested `c.daily_return = c.daily_return`
NaN test does NOT work: Postgres treats `NaN = NaN` as TRUE (non-IEEE ordering
for float8), verified against Postgres 16. The shipped predicate is
`c.daily_return <> 'NaN'::float8 AND c.daily_return <> 'Infinity'::float8 AND
c.daily_return <> '-Infinity'::float8`. Applied to the sweep and both verbatim
copies in the pgTAP fixture; added an NF-allocator fixture case (one eligible key
whose only rows are NaN/±Infinity → empty runtime series → gate false → stamped
`[]`, proving the mirror). Stale queries.ts line-refs in the header corrected
(2205-2214 / 2241-2249 / 2257-2271).

**File:** `scripts/sweeps/f4-memberkeyids-restamp.sql:129-131` (and the mirrored
copy in `supabase/tests/test_scenario_downgrade_sweep.sql:212-214, 307-309`)

**Issue:** The sweep derives the per-key gate from
```sql
EXISTS (SELECT 1 FROM csv_daily_returns c WHERE c.api_key_id = k.id) AS has_series
```
but the runtime gate it claims to mirror does NOT count a key as having a series
merely because a row exists. `allActiveKeysHavePerKeyDailies` (queries.ts:2205-2214)
checks `perKeyReturnsByApiKeyId[id].length > 0`, and that record is built by
`buildPerKeyReturnsByApiKeyId` (queries.ts:2257+), which explicitly **drops rows
with a null `api_key_id` or a non-finite `daily_return`**. So a key whose only
`csv_daily_returns` rows carry `NULL`/`NaN`/`Infinity` daily_returns yields an
EMPTY runtime series (gate contribution = false) but a TRUE `has_series` in the
sweep. When such a key is the reason the gate flips, the sweep stamps a membership
array (`[...eligibleIds]`) that a genuine runtime reopen would NOT have produced
(it would stamp `[]`), directly violating the script's stated invariant
("a swept row is byte-equal to what a reopen would have produced",
f4-memberkeyids-restamp.sql:22-23). The pgTAP fixture only inserts finite
daily_returns, so it does not exercise or catch this path. (The header's
line-number cross-references are also stale — it cites queries.ts:2302-2311 /
2338-2346 for the gate/eligible predicates, which actually live at 2205-2214 /
2241-2249, and neither cited range is where the finite-filter that defines
"non-empty series" lives.)

Severity is WARNING, not BLOCKER: the RESTAMP is gated behind a mandatory
same-session DETECT (canary reported 0 downgraded rows, so the UPDATE likely never
runs), and the trigger requires an unusual all-non-finite-series data state. But
it is a real correctness gap in a data-integrity correction script whose whole
value proposition is faithfulness to the runtime derive.

**Fix:** Make `has_series` mirror `buildPerKeyReturnsByApiKeyId`'s drop rule so the
EXISTS only counts rows the runtime would keep:
```sql
EXISTS (
  SELECT 1 FROM csv_daily_returns c
  WHERE c.api_key_id = k.id
    AND c.daily_return IS NOT NULL
    AND c.daily_return = c.daily_return          -- excludes NaN
    AND c.daily_return <> 'Infinity'::float8
    AND c.daily_return <> '-Infinity'::float8
) AS has_series
```
(or `AND isfinite(c.daily_return::numeric)` if the column type permits). Apply the
same change to both inline copies in the pgTAP test and add a fixture case: an
eligible key whose only rows are non-finite/null → runtime empty series → gate
false → stamped `[]`, proving the mirror. Also correct the stale queries.ts line
references in the header comment.

## Info

### IN-01: `saveErrorMessage` misattributes a per-id-length `too_big` as an over-cap ("more than 1000 book sources") message

**File:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:684-695`

**Issue:** The over-cap branch keys on `iss.code === "too_big"` +
`iss.path.includes("memberKeyIds")`. Zod emits `too_big` for BOTH the array-count
cap (`.max(MAX_MEMBER_KEY_IDS)`, path `["draft","memberKeyIds"]`) AND an individual
element exceeding `.max(MAX_DRAFT_KEY_LENGTH)` (path `["draft","memberKeyIds",<idx>]`).
Because `.includes("memberKeyIds")` matches the nested-index path too, a single
over-length id (a 512+ char member id) would surface the "This portfolio references
more than 1000 book sources" copy — which is wrong; the count is fine, one id is
too long. This is effectively unreachable through the UI (member ids are
derivation-sourced UUIDs, never user free-text), so it is INFO, not WARNING.

**Fix:** Tighten the discriminator to the array-cap shape only, e.g. require the
path to END at `memberKeyIds` (no trailing numeric index):
```ts
const overCap = issues.some(
  (iss) =>
    iss?.code === "too_big" &&
    Array.isArray(iss.path) &&
    iss.path[iss.path.length - 1] === "memberKeyIds",
);
```

---

_Reviewed: 2026-07-04_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
