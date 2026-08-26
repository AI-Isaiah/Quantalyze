---
phase: 163-harden-fail-safe-closed-and-loud
plan: 04
subsystem: ui
tags: [freshness, postgrest, jsonb, discovery, honesty, react, vitest]

requires:
  - phase: 162-honest-surfaces
    provides: "FreshnessChip's staler-of-two rule and the 3d/7d series ladder (HONEST-02)"
  - phase: 159-rank-public-ranking-integrity
    provides: "CATEGORY_RANKING_ANALYTICS_COLUMNS — the explicit anon-safe projection and its JSONB-alias precedent"
  - phase: 162-honest-surfaces
    provides: "STALE-01's shapeRowAnalytics — the shaper this plan extends with series_end"
provides:
  - "resolveEffectiveRecency — the ONE staler-of-two derivation, shared by the discovery badge"
  - "SERIES_FRESH_DAYS / SERIES_STALE_DAYS — the 3d/7d series ladder, now read by both FreshnessChip and the badge"
  - "series_end plumbed to every ranked row as a JSONB scalar alias (the array never reaches anon)"
  - "SyncBadge with a REQUIRED seriesEnd prop — every mount compile-forced into an explicit decision"
  - "seriesEndOf — normalises the scalar-alias vs returns_series-array reads into one answer"
affects: [discovery, browse, factsheet, portfolios, future freshness surfaces]

actuals:
  tokens: 15000
  tasks: 3
  commits: 4

tech-stack:
  added: []
  patterns:
    - "PostgREST negative JSONB array index as a projection alias (returns_series->-1->>date) — measured, not assumed"
    - "Required-prop-as-forcing-function: a new fact is a REQUIRED prop so no mount can reopen the class by omission"
    - "Compare VERDICTS, not raw dates, when two clocks run at different cadences"

key-files:
  created:
    - src/components/strategy/SyncBadge.staler-of-two.test.tsx
  modified:
    - src/lib/freshness.ts
    - src/lib/queries.ts
    - src/lib/queries.test.ts
    - src/lib/types.ts
    - src/lib/utils.ts
    - src/components/strategy/SyncBadge.tsx
    - src/components/strategy/StrategyTable.tsx
    - src/components/strategy/StrategyGrid.tsx
    - src/components/strategy/StrategyHeader.tsx
    - src/components/portfolio/StrategyBreakdownTable.tsx
    - src/components/portfolio/CompositionDonut.tsx
    - src/app/factsheet/[id]/v2/FactsheetView.tsx
    - src/app/(dashboard)/portfolios/[id]/page.tsx

key-decisions:
  - "The staler-of-two comparison is between VERDICTS, not raw dates. The plan specified 'classify on the OLDER of the two dates'; a daily return series' last point is routinely yesterday's, so that rule would have flipped EVERY healthy row onto the track-record arm and deleted the sync copy product-wide — closing the bug by removing the badge's information, the one fix the founder ruled out. Each subject is judged on the ladder appropriate to it (job 12h/48h, series 3d/7d) and the series binds only when STRICTLY worse, exactly as FreshnessChip's TONE_RANK does."
  - "The 3d/7d SERIES ladder was hoisted out of FactsheetView.tsx into lib/freshness.ts and is now imported by the chip. Transcribing 3 and 7 into a second file is how the list and the factsheet came to disagree about the same strategy in the first place."
  - "PRIMARY probe approach shipped — no server-side-strip fallback needed. The raw returns_series array never joins the anon projection, and a regex pin now enforces that."
  - "seriesEnd is a REQUIRED prop on SyncBadge so every call site is compile-forced into an explicit decision. Two mounts that genuinely cannot answer (StrategyHeader, and CompositionDonut when its caller supplies nothing) pass null and accept the conservative capping, documented at each site."
  - "series_end is OPTIONAL on the StrategyAnalytics interface, following the three_month alias precedent: it is a projection alias, not a table column, and absent must read as UNKNOWN rather than break every existing fixture."

patterns-established:
  - "Unknown caps fresh, never erases stale: an unresolvable input sits BELOW a freshness claim and ABOVE a staleness one, so absence downgrades a green dot but never softens a known-bad age."
  - "Anti-vacuity control rows: every stale-case assertion renders beside a healthy control row in the SAME mount, so a globally broken badge cannot make the spec pass."

requirements-completed: [HONEST-08]

coverage:
  - id: D1
    description: "The ranked-list projection carries a series_end scalar; the raw returns_series array still never reaches an anonymous reader"
    requirement: HONEST-08
    verification:
      - kind: unit
        ref: "src/lib/queries.test.ts#carries the series end as an aliased LAST-element JSONB date, not the array"
        status: pass
      - kind: unit
        ref: "src/lib/queries.test.ts#never projects daily_returns, the metrics_json blob, data_quality_flags, or the raw returns_series"
        status: pass
    human_judgment: false
  - id: D2
    description: "SyncBadge buckets and labels on the staler of sync- and series-recency via the one shared resolver"
    requirement: HONEST-08
    verification:
      - kind: unit
        ref: "src/components/strategy/SyncBadge.staler-of-two.test.tsx#SyncBadge — buckets on the staler of sync- and series-recency"
        status: pass
    human_judgment: false
  - id: D3
    description: "The measured production row renders honestly through BOTH real mount paths (StrategyTable and StrategyGrid), on a published non-example fixture"
    requirement: HONEST-08
    verification:
      - kind: unit
        ref: "src/components/strategy/SyncBadge.staler-of-two.test.tsx#the discovery TABLE makes no fresh sync claim over a 112-day-dead series"
        status: pass
      - kind: unit
        ref: "src/components/strategy/SyncBadge.staler-of-two.test.tsx#the discovery GRID card is guarded identically (both render paths)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The live /browse and /discovery surfaces now agree with the factsheet chip about the same strategy"
    verification: []
    human_judgment: true
    rationale: "The defect was found by looking at two public pages side by side. The unit specs pin the logic on fixtures; only a human comparing the deployed row against the deployed factsheet can confirm the two surfaces have actually stopped contradicting each other on the real rows."

duration: 33min
completed: 2026-08-26
status: complete
---

# Phase 163 Plan 04: HONEST-08 Discovery Freshness Badge Summary

**The discovery badge now buckets and labels on the staler of sync- and series-recency via one shared resolver in `lib/freshness.ts`, fed by a `series_end` JSONB scalar alias that keeps the raw returns array away from anonymous readers.**

## Performance

- **Duration:** 33 min
- **Tasks:** 3
- **Files modified:** 16 (1 created, 15 modified)
- **Commits:** 4

## Accomplishments

- **The measured production lie is closed.** A published row with a job that ran 7 hours ago over a return series that ended 112 days earlier no longer renders "Synced 7h ago". It renders `Track record ends 112d ago` with the negative dot — the same verdict its own factsheet chip already gave.
- **One derivation, two surfaces.** `resolveEffectiveRecency` in `src/lib/freshness.ts` owns the staler-of-two decision, and the 3d/7d series ladder was hoisted out of `FactsheetView.tsx` so the chip and the badge read one pair of numbers.
- **The badge was not deleted, and sync recency was not thrown away.** When the series binds, the compute date moves into the `title` attribute; when sync binds — every healthy row — the render is unchanged.
- **The anon projection got a scalar, not a blob.** `series_end:returns_series->-1->>date` was measured against the TEST project before it was written, and a regex pin now forbids `returns_series` from ever appearing as a bare column.
- **All five real SyncBadge mounts made an explicit decision**, forced by a required prop rather than trusted to review.

## Task Commits

1. **Task 1: Plumb a series-end scalar to every ranked row** — `8ab1eaf48` (feat)
2. **Task 2 (RED): failing spec for staler-of-two bucketing** — `321e72a30` (test)
3. **Task 2 (GREEN): SyncBadge buckets on the staler of two** — `4c267c3d5` (feat)
4. **Task 3: the regression through both real mount paths** — `5c186bb8d` (test)

## The TEST-project probe (Task 1)

The plan required the JSONB-alias approach be **probed before being written**, with the fallback reserved for rejection. Measured against the TEST project on 2026-08-26 with a service-role key:

| # | Query | Result |
|---|---|---|
| A | `select=computed_at,series_end:returns_series->-1->>date` | **HTTP 200** — `{"computed_at":"2026-04-30T…","series_end":"2026-04-29"}` |
| B | `select=computed_at,series_end:returns_series->0->>date` (control) | **HTTP 200** — `series_end:"2025-04-30"` |
| C | `select=series_end:returns_series->>-1` | HTTP 200, but returns the whole point object as text — rejected |
| D | `select=id,strategy_analytics(computed_at,series_end:returns_series->-1->>date)` | **HTTP 200** — `{"strategy_analytics":{"series_end":"2026-05-29",…}}` |

**Form A/D shipped.** Query B is the load-bearing control: `->0` returned the series' FIRST date on the same rows, which is what proves `-1` resolves to the LAST element rather than silently yielding null. `->>` rather than `->` is also load-bearing — it yields the bare date text instead of a quoted JSON scalar.

**The fallback was NOT needed**, so the RSC-leak hazard the plan named never materialised: `returns_series` is still absent from the anonymous projection, and `queries.test.ts` now regex-pins it to the arrow form only (threat T-163-09).

## RED-proof evidence (Task 3)

**The mutation:** in `src/components/strategy/SyncBadge.tsx`, bypass the shared resolver so the badge classifies on `computedAt` alone —

```
-  const recency = resolveEffectiveRecency(computedAt, seriesEnd);
+  const recency = { freshness: computeFreshness(date),
+                    subject: "sync" as const, seriesEndDate: null };
```

— i.e. exactly the code that shipped to production. **Observed: `Tests  5 failed | 4 passed (9)`.**

```
× the discovery TABLE makes no fresh sync claim over a 112-day-dead series
  → expected '#1Phoenix Protocol FixtureLong-OnlyBi…' not to match /Synced/
× the discovery GRID card is guarded identically (both render paths)
  → expected [ 'Synced', 'Synced' ] to have a length of 1 but got 2
× Test 1: a fresh job over a 112-day-dead series reads the SERIES
  → expected 'h-1.5 w-1.5 rounded-full shrink-0 bg-…' to contain 'bg-negative'
× Test 3 / Test 3c: an unknown series end caps 'fresh'
  → expected '…rounded-full shrink-0 bg-…' not to contain 'bg-positive'
```

The **four control assertions stayed GREEN** under the mutation (the healthy row keeps its green dot and its "Synced 2h ago"; a known-bad sync age still binds; the null-`computedAt` early return holds). That is what proves the spec discriminates between the two rows rather than merely asserting the badge is globally broken.

**Restore verified two ways:** `shasum` of `SyncBadge.tsx` back to its pre-neuter digest `55b21e28…`, and `grep -c resolveEffectiveRecency` back to 3. A byte backup was taken before the neuter rather than relying on `git checkout --`.

The mutation and this verbatim output are recorded in the test file's own docstring.

**Anti-vacuity, per the CONTEXT lock:** every fixture is `status: "published", is_example: false` with terminal-success analytics, rendered through the real `StrategyTable` / `StrategyGrid` mount paths. Nothing routes through the `is_example` gate — it guards zero rows on this surface since the 15 examples were deleted, so a test leaning on it would be vacuous by construction.

## Decisions Made

**1. The comparison is between verdicts, not raw dates — the plan's stated rule was wrong.**

The plan specified: *"Because computeFreshness is monotone in age, 'staler of two' here means: classify on the OLDER of the two dates when both resolve."* The monotonicity argument is correct for the **dot**, but it silently decides the **subject** too — and there it fails.

A return series is a series of DAILY bars. A perfectly healthy strategy's last point is routinely yesterday's, which is older than a job that ran two hours ago. Under older-date-wins, **every row in the product** would have flipped onto the track-record arm and lost its sync copy — closing the bug by deleting the badge's information, which is precisely the fix the founder ruled out.

This was caught by a control case (`Test 2b`) written before the implementation, which went red on the first GREEN attempt. The fix mirrors what `FreshnessChip` already does via `TONE_RANK`: judge each subject on the ladder appropriate to it, and let the series bind only when its verdict is STRICTLY worse.

**2. The 3d/7d series ladder moved into `lib/freshness.ts`.** The badge needed to judge a series and the chip's numbers were private to `FactsheetView.tsx`. Transcribing them would have created the second copy this requirement exists to prevent, so they were hoisted and the chip now imports them. The ladder itself is unchanged, and no new threshold was introduced anywhere — the JOB ladders (12h/48h vs 3d/7d) still differ per UI-SPEC C-1, deliberately.

**3. `seriesEnd` is a REQUIRED prop.** Optional would have let a future mount reopen the class by omission. Required means the compiler asks every call site the question.

**4. `series_end` is OPTIONAL on the `StrategyAnalytics` interface**, following the `three_month` alias precedent — it is a projection alias, not a table column, and an absent value must read as UNKNOWN rather than break every existing fixture. `EMPTY_ANALYTICS` nonetheless carries an explicit `series_end: null`, because a run that produced no numbers cannot claim a track-record end either.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The plan's staler-of-two rule would have deleted the sync copy product-wide**

- **Found during:** Task 2 (GREEN implementation)
- **Issue:** The plan's "classify on the OLDER of the two dates" rule flips every healthy row onto the track-record arm, because a daily series' last point is always older than a fresh job. That removes sync recency from the entire product — the outcome the CONTEXT explicitly forbids.
- **Fix:** Compare VERDICTS on per-subject ladders (job 12h/48h, series 3d/7d) and bind the series only when strictly worse, mirroring `FreshnessChip`'s `TONE_RANK`. The dot is unaffected (monotonicity still holds); only the subject selection changed.
- **Files modified:** `src/lib/freshness.ts`
- **Verification:** `Test 2b` (healthy row keeps green dot + "Synced 2h ago") went from RED to GREEN; the whole spec is green and the neuter still reddens it.
- **Committed in:** `4c267c3d5`

**2. [Rule 3 - Blocking] The plan's Task 2 file list named three files that are not SyncBadge mounts**

- **Found during:** Task 2
- **Issue:** The plan listed `factsheet/[id]/tearsheet/page.tsx`, `(dashboard)/portfolios/[id]/page.tsx` and `allocations/components/ScenarioComposer.tsx` as "the three other SyncBadge mounts". `grep` shows all three only MENTION SyncBadge in comments. The actual mounts are `StrategyHeader.tsx`, `portfolio/StrategyBreakdownTable.tsx` and `portfolio/CompositionDonut.tsx`. Making `seriesEnd` required made this a compile error, not a silent miss.
- **Fix:** Made the explicit `seriesEnd` decision at the three REAL mounts instead. The portfolios page IS touched, but as the data source for `CompositionDonut`'s new `seriesEnd` slice field rather than as a mount. The tearsheet page and `ScenarioComposer` were correctly left untouched.
- **Files modified:** `StrategyHeader.tsx`, `portfolio/StrategyBreakdownTable.tsx`, `portfolio/CompositionDonut.tsx`, `(dashboard)/portfolios/[id]/page.tsx`
- **Verification:** `tsc --noEmit` clean; the required prop proves no mount was missed.
- **Committed in:** `4c267c3d5`

**3. [Rule 2 - Missing Critical] The portfolio surfaces needed the same fix, and would have silently degraded without it**

- **Found during:** Task 2
- **Issue:** Making `seriesEnd` required exposed that `StrategyBreakdownTable` and `CompositionDonut` make the SAME cross-tenant freshness claim about other managers' strategies. Passing a hardcoded `null` would have capped both surfaces at amber forever, silently removing B14's fresh/stale distinction (two existing tests went red proving exactly that).
- **Fix:** Plumbed the real fact instead of hardcoding unknown — `seriesEndOf()` in `lib/utils.ts` normalises the scalar-alias and `returns_series`-array read shapes into one answer, consumed by the portfolio table, the donut's data source, and `shapeRowAnalytics`'s owner path. The two B14 specs were updated to supply the new fact and two HONEST-08 cases were added to each.
- **Files modified:** `src/lib/utils.ts`, `src/lib/queries.ts`, `portfolio/StrategyBreakdownTable.tsx`, `portfolio/CompositionDonut.tsx`, `(dashboard)/portfolios/[id]/page.tsx`, plus both B14 test files
- **Verification:** Full portfolio + strategy suites green (744 tests); new HONEST-08 cases assert the dead-track and unknown-series arms on both surfaces.
- **Committed in:** `4c267c3d5`

**4. [Rule 3 - Blocking] postgrest-js cannot type-parse a negative JSONB array index**

- **Found during:** Task 1
- **Issue:** The server accepts `series_end:returns_series->-1->>date` (measured, HTTP 200), but postgrest-js's compile-time select parser resolves it to `ParserError<"Unable to parse renamed field…">`, failing `tsc`.
- **Fix:** A narrow cast at the one call site, matching the cast `getMyStrategies` already carries, with a comment naming the exact library limitation and citing the measurement. The runtime contract it stands in for is pinned by the projection tests, not by the cast.
- **Files modified:** `src/lib/queries.ts`
- **Verification:** `tsc --noEmit` clean; `queries.test.ts` projection pins green.
- **Committed in:** `8ab1eaf48`

---

**Total deviations:** 4 auto-fixed (1 bug, 1 missing critical, 2 blocking)
**Impact on plan:** Deviation 1 is a correction to the plan's own rule and is the difference between a fix and a regression. Deviations 2 and 3 are the required prop doing its job — it forced the true mount set into the open. No scope creep: every file touched is a SyncBadge mount, its data source, or the shared derivation.

## Issues Encountered

- **The worktree had no `node_modules`.** Symlinked from the main checkout before running anything, per the standing rule that `npx` in a bare worktree downloads a different toolchain rather than failing.
- **knip reports `RecencySubject` as an unused exported type.** It sits in a pre-existing baseline of ~dozens of such findings (`VenueCapabilityName`, `FixRequirement`, …), knip is not wired into `npm run lint` or CI, and the type is a genuine part of the resolver's public contract. Left exported; not a regression into a green gate.

## Verification

- **Full vitest suite: 807 files passed, 19 skipped, 12607 tests passed, 0 failed.**
- `tsc --noEmit`: clean.
- `npm run lint`: 0 errors (3 pre-existing warnings in untouched files; route-contract and admin-manifest checks OK).
- Factsheet chip suites green and behaviourally unchanged — only the two ladder literals moved.

## Known Stubs

None.

## Threat Flags

None. The plan's `T-163-09` (raw `returns_series` joining the anon projection) was mitigated by the probe succeeding on the scalar alias, so the fallback path that carried the risk was never taken; the regex pin in `queries.test.ts` is the standing guard. `T-163-10` (badge advertising false freshness) is closed by the shared resolver plus the falsifiable regression test.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- SC-6 / HONEST-08 is closed in code with a demonstrably falsifiable regression test.
- **Open for human UAT (coverage D4):** the fix should be confirmed on the deployed surfaces by comparing a stale row on `/browse/crypto-sma` against that same strategy's factsheet — the defect was found by looking at two public pages side by side, and that is the only check that confirms they have stopped disagreeing on real rows.
- `resolveEffectiveRecency` and `seriesEndOf` are available to any future surface that needs to make a freshness claim; a new surface should consume them rather than re-derive.

## Self-Check: PASSED

All six claimed files exist on disk; all four claimed commit hashes
(`8ab1eaf48`, `321e72a30`, `4c267c3d5`, `5c186bb8d`) resolve in this branch's
log with the messages quoted above.

---
*Phase: 163-harden-fail-safe-closed-and-loud*
*Completed: 2026-08-26*
