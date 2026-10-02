---
phase: 169
topic: T5
fixed_at: 2026-09-29
review_path: .planning/phases/169-pagetruth/169-REVIEW.md
iteration: 1
findings_in_scope: 6
fixed: 6
skipped: 0
status: all_fixed
---

# Phase 169: Code Review Fix Report, topic T5 (the leftovers from T1 to T4)

**Fixed at:** 2026-09-29
**Source reviews:** `169-REVIEW.md` (WR-04, IN-03) and `169-REVIEW-SFH.md` (H-1, H-2, M-2, M-3, H-3, L-1), through the "for the orchestrator" and handoff sections of `169-REVIEW-FIX-T1.md` to `-T4.md`
**Branch:** `feat/169-pagetruth`, starting at `6650059cf` (T1 to T4 merged)
**Iteration:** 1

**Summary:**
- Items in scope: 6 (the orchestrator's brief, items 1 to 6).
- Fixed: 6.
- Skipped: 0.
- Items 2 and 3 carry new behaviour and new copy, and item 4 changes a freshness verdict on a public surface. They are marked **fixed: requires human verification**. A test pins the rule chosen here; it does not prove the rule is the right one.

## Where verification ran

Every edit, test and gate ran in the checkout the orchestrator named, `quantalyze-169`, on `feat/169-pagetruth`, and nowhere else. I did not create a GSD worktree, because the brief said to work in that checkout and no sibling fixers were running. `node_modules` resolves there, so the numbers below reproduce from that tree.

| Gate | Baseline at `6650059cf` | Final, at the report commit's parent `def0c931e` |
|---|---|---|
| `npx tsc --noEmit -p .` | not run | exit 0 |
| `npm run lint` (eslint, admin-route manifest 20 OK, route contract 58 OK, planning hygiene OK) | not run | exit 0 |
| `npx vitest run src/lib src/app/factsheet src/app/factsheet-share src/components "src/app/(dashboard)"` | 612 files: 1 failed, 611 passed. Tests: 1 failed, 10628 passed, 9 skipped | 613 files, all passed. Tests: 10649 passed, 9 skipped |

**The 9 skipped tests exist before and after, and none is in a file T5 touched.** They are live-database probes that skip without a credential: 4 in `src/lib/sec-005-live-probe.test.ts` and 5 in `src/lib/migration-028-tenant-check.test.ts`. **They were not run.** No gate was turned green by skipping.

**Method for every behaviour change:** the test was written first and observed red, then the fix went in. After that, each load-bearing piece of the fix was neutered by hand (never with `git checkout --`), the named case was observed red, and the file was restored from a byte backup in the scratchpad. `cmp` confirmed the restore every time.

## Fixed Issues

### Item 1: the discovery test "an untrusted composite headline (no outage) keeps KCS-10 and raises no alert" failed on the merged tree

**Files modified:** `src/app/(dashboard)/discovery/[slug]/[strategyId]/page.pending-fallback.test.tsx`
**Commit:** `78964fb96`
**Status:** fixed

**Cause, which was in the test fake:**
- The failure was `TypeError: query.gt is not a function` at `readCsvDailyReturns`.
- T1's CSV-READ-CAP made the composite csv read page by a date keyset. Every page after the first adds `.gt("date", cursor)`, and the read stops only on an empty page.
- T3's `csvRowsAdmin` fake had no `.gt`, and it served the same three rows on every call.
- T1's report says T3's mock "keeps working" because the first page's chain is unchanged. That holds for the outage fake, which fails on page 1. It does not hold for the rows fake, which has to answer page 2.

**Fix:** the fake records the cursor and answers only the rows after it. That is the shape of T1's own fake in `v2/page.composite-read-error.test.tsx`. The assertion is unchanged.

**The reader was not changed:** it is right to refuse a page that repeats a date, as `page_order`. A fake with only `.gt` added, still stateless, would have tripped that refusal and failed on the outage branch instead.

**Result:** 5/5.

### Item 2: the discovery single-key arm did not catch a series read outage, and did not pass the returns convention

**Files modified:**
- `src/app/(dashboard)/discovery/[slug]/[strategyId]/page.tsx`
- `page.pending-fallback.test.tsx` in the same folder

**Commit:** `e3c2fb190`
**Status:** fixed: requires human verification

**Applied fix:**
- **The catch.** The `readSingleKeyBasisOpts` call is wrapped exactly as the composite arm is wrapped:
  - only `CompositeSeriesReadError` is caught, and any other throw propagates;
  - on the outage no payload is built (`dailyReturns = []`, the same route the composite arm takes), so the fallback shows the read-failure line and never KCS-10;
  - a partial payload is deliberately not built, because it would show cash charts under an MTM label.
- **One reporter for both arms.** The log and the capture moved into one local helper, `reportSeriesReadFailure`, which both arms call.
  - `read` is now the error's own discriminant (`err.read`).
  - **This is an adaptation to the brief.** The composite arm hardcoded `read: "csv_daily_returns"`. Since T1, `readCompositeFactsheet` also throws for its MTM and smoothed reads, so that tag already misnamed those outages on the merged tree. The existing csv-outage case still pins `csv_daily_returns`, because that is `err.read` there.
  - `stage` is `"composite-read"` or `"single-key-read"`, so the event says which assembly failed.
  - The rest of the capture is unchanged: level `error`, route, reason `read_error`, code, strategy id, and the reader's own error as the captured object.
- **The flag and the sentence were renamed.** `compositeReadFailed` became `seriesReadFailed`, and the sentence constant became `SERIES_READ_FAILED_SENTENCE`. The flag now covers both arms, so the old name would have been false. The wording of the sentence is unchanged.
- **H-2 / M-2.** The call passes `strategy.returns_denominator_config` as its 7th argument. That is the column the composite arm already reads, and `getStrategyDetail` selects `*` on `strategies`, so it arrives on the row. Two consequences:
  - a `simple` single-key row draws the arithmetic curve;
  - a `simple` or active-day row is flagged `returnsConventionOverride`, which withholds the leverage what-if.

**Tests (4 new cases):**
- An MTM series outage (`strategy_analytics_series` fails with `57014`): the page builds no payload, shows the read-failure line and not KCS-10, and captures once. The capture carries the reader's error, `cause` set to the PostgREST message, and the exact tag set, including `stage: "single-key-read"` and `read: "mtm_daily_returns"`.
- Any other throw from the single-key read still propagates, and nothing is captured.
- A `simple` config: the payload's `dataQuality.returnsConventionOverride` is `true`, and the equity curve ends at 1 + Σr, which is exactly 1 for 20 steps of +2% and 20 of -2%.
- A control with no config: the curve is geometric, ending at (1.02 × 0.98)^20, and no override is flagged.

**Red and neuters:**
- **Red against the pre-fix `page.tsx`** (the HEAD version, written over the fixed file): 2 cases failed, the MTM outage case and the `simple` case.
- **Neuter A**, the 7th argument replaced with `undefined`: the `simple` case went red.
- **Neuter B**, the single-key catch made to rethrow: the outage case went red.
- Each was restored from the byte backup, with `cmp` OK.

**Fixture note:** the single-key fixture row carries the seven persisted headline scalars. The "discovery" projection carries them in production. Without them, a rankable row captures `missing_keys`, which is T1's M-1 guard doing its job, not a defect.

### Item 3: H-1, the caveat for a chain-broken row's stored headline

**Files modified:**
- `src/app/factsheet/[id]/v2/MetricsColumn.tsx`
- `src/app/factsheet/[id]/v2/FactsheetView.tsx`
- `src/app/factsheet/[id]/v2/FactsheetView.headline-coverage.test.tsx` (new)

**Commit:** `fe0d0e0e3`
**Status:** fixed: requires human verification (new copy, and a gating decision)

**Applied fix:**
- **One authored caveat.** `headlineCoverageCaveat(dataQuality, basis)` in `MetricsColumn.tsx` renders in three places:
  - beside the headline in the KPI strip (FactsheetView.tsx), in the existing amber caveat style after the `insufficientWindow` caveat;
  - in the Main Metrics panel;
  - in the Cumulative Return Metrics panel.
- **Where it lives.** It sits in `MetricsColumn.tsx` because FactsheetView already imports that module. Its date formatter there, `isoToMonthDay`, is the same `Mon D, YYYY` shape the page uses elsewhere, so no third formatter copy was added.
- **Copy:**
  - With a date: "⚠ Cumulative return, CAGR and Calmar cover the record from Jun 15, 2024, after its last break in the return chain. The chart shows the whole record."
  - With `null`: "⚠ Cumulative return, CAGR and Calmar cover only the record after its last break in the return chain. The chart shows the whole record."
  - The copy is declarative and uses no em dash. It never invents a date.
- **Why Calmar is named.** `metrics.py` computes Calmar as the suffix CAGR over the max drawdown, so Calmar covers the suffix too. T1 named only Since Inception and CAGR.

**Gating: it renders only while the stored headline is the one shown.** Three conditions must all hold:
1. `twrChainBroken === true`.
2. **`headlineCoversFrom` is present.** `readSingleKeyBasisOpts` sets it, to a date or `null`, only when it overlaid the persisted cash headline on a chain-broken row. A chain-broken row that is not rankable keeps the TypeScript whole-series headline, and a caveat there would be false. That arm is reachable on the discovery page, and the cache's JSON round trip keeps `null` distinct from absent. This condition goes beyond the brief's literal "when twrChainBroken". It is recorded here as a decision.
3. **The basis is cash, and in the KPI strip no leverage what-if is applied.** Under mark_to_market or smoothed MTM, the figures come from that basis's series, not from the stored cash headline. A chain-broken row has no what-if anyway (`leverageEligibleFor`).

**Tests (8 cases, sentences hand-typed):**
- dated and undated caveats in MetricsColumn, asserted in exactly the Main Metrics and Cumulative Return Metrics panels;
- dated and undated caveats in the KPI strip;
- a clean-row control on both mounts;
- no caveat when `headlineCoversFrom` is absent;
- no caveat under mark_to_market.

**Red and neuters:**
- **Red before the render existed:** 4 cases failed, the dated and undated cases on both mounts. The controls passed.
- **Neuters**, each restored from a byte backup with `cmp` OK:

| Neuter | Result |
|---|---|
| basis gate removed | 1 red (the MTM case) |
| presence gate removed | 1 red (the no-`headlineCoversFrom` case) |
| date branch forced to undated | 2 red (both dated cases) |
| whole caveat returns null | 4 red |

**PROD measurement:** per the orchestrator's measurement on 2026-09-29, both branches are live. There are 4 chain-broken complete rows: 2 `broker_nan` rows (dateable) and 2 `zero_fill` rows (not dateable).

**Not browser-checked:** the 390px and desktop 200% zoom checks of the new line belong to the phase's post-deploy browser checkpoint.

### Item 4: WR-04, the chip and the discovery badge bucket the series age on the same whole days

**Files modified:**
- `src/app/factsheet/[id]/v2/FactsheetView.tsx`
- `src/app/factsheet/[id]/v2/FactsheetView.chip-honesty.test.tsx`
- `src/lib/freshness.ts`
- `src/lib/freshness.two-surfaces.test.tsx`

**Commit:** `a2bbb3edc`. This is one commit for both surfaces, as `freshness.two-surfaces.test.tsx` and TODOS require.
**Status:** fixed: requires human verification (a freshness verdict on a public surface moves on fractional days)

**Applied fix:**
- **Cherry-pick.** `git cherry-pick -n 34edabc65 5cadefab7` re-applied T2's chip change and its WR04-1 to WR04-5 tests. It applied cleanly.
- **The badge.** `bucketSeriesAge` in `src/lib/freshness.ts` now floors the age before the 3d / 7d ladder, the same way the chip does. The future allowance holds:
  - `floor(-0.4) = -1` is fresh;
  - two days ahead is `-2`, which is future.
- **Two-surfaces rows.** Two rows were added to `freshness.two-surfaces.test.tsx`, each rendered on both surfaces from one row, with the clock frozen at 14:24Z:
  - a series 3.6 days old under a fresh job: expected green, and the job speaks;
  - a series 7.6 days old under a fresh job: expected amber, and the track record speaks.
- **A third claim, the band.** At 7.6 days the two surfaces had agreed on the subject and differed only in colour, so the new rows also assert the band. It is read from each surface's own render: the badge's dot class and the chip's eyebrow word. The expectations are hand-typed.

**Red and neuters:**
- **Red:** with the chip fixed and the badge not, both new rows were red.
  - At 3.6 days the badge put the row on the series arm.
  - At 7.6 days the badge read red.
- **Neuter**, the freshness floor alone: 2 red.
- **Neuter**, the chip floor alone: 2 red.
- Each was restored from a byte backup, with `cmp` OK.

**Suites:** after the change, every test file that imports `resolveEffectiveRecency` or `SyncBadge` passed (9 files, 199 tests), as did `src/lib/freshness*` and the chip-honesty suite. **No existing fractional-boundary pin had to move.**

### Item 5: IN-03 / SFH L-1, an empty scenario blend

**Files modified:**
- `src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.ts`
- `src/app/factsheet/[id]/v2/MetricsColumn.window-rows.test.tsx`

**Commit:** `7e1ba0bc7`
**Status:** fixed

**Applied fix:** `emptyComputeSummary` now sets `p6m: null` and `p1y: null`, and adds `p3y: null` and `p5y: null`. `ComputeSummary` admits all four as nullable.
- MTD, YTD and 3M stay `NaN` and render as em-dash rows.
- YTD stays because it is a calendar window (D-11).

**Test:** a new case, "an empty blend", on the scenario mount. It asserts:
- Cumulative Return Metrics has none of 6 Month, 1 Year, 3 Year or 5 Year, and keeps Since Inception;
- Returns has neither 6 Month nor 1 Year, and keeps 3 Month.

**Red and neuter:**
- **Red before the fix:** 6 Month was present.
- **Neuter**, `p1y` set back to `NaN`: red, with 1 Year present.
- Restored from a byte backup, with `cmp` OK.

### Item 6: record WR-02's change to D-11, and correct D-41

**Files modified:** `.planning/phases/169-pagetruth/169-CONTEXT.md`
**Commit:** `def0c931e`
**Status:** fixed

**What was recorded:**
- **Under D-11:** a dated note, "D-11 amended 2026-09-29 (review fix T2, WR-02)". It records:
  - the rule: a window counts as covered when every UTC day strictly between its cutoff and the record's first date is a non-trading day for the venue;
  - the non-trading days on the weekday basis (252): Saturday, Sunday, 1 January and 25 December;
  - that crypto (365) is unchanged, byte for byte;
  - pointers to commit `a592a3f14` and to T2's WR-02 section.

  The original bullet is kept as lineage.
- **Under D-41:** a dated note, "D-41 amended 2026-09-29 (review fixes T3 and T5; SFH H-3)". It records:
  - that the discovery page now captures the outage and shows the read-failure copy, on the composite arm (T3, `2f1daac40`) and on the single-key arm (T5);
  - that the `read` tag is the error's own discriminant;
  - that the public v2 lane's KCS-10 on `read_error` is unchanged.

  The stale sentence is kept as lineage.

`STATE.md` and `ROADMAP.md` were not touched. The matching ROADMAP note is the orchestrator's.

## For the orchestrator

- **ROADMAP:** the D-11 amendment needs its matching note there, per the deviation policy.
- **`169-REVIEW.md`:** the "Deliberately not flagged" bullet for the discovery page's console-only catch is now superseded on both arms, as T3 noted for the composite arm.
- **Item 3's copy and gating are decisions.** Naming Calmar and requiring `headlineCoversFrom` to be present are both beyond the brief's literal text; see item 3.
- **Item 2's `stage` values are new.** The composite arm's Sentry `stage` is still `composite-read`, and the new single-key arm sends `single-key-read`. Any alert rule keyed on the old fixed `read` tag should now expect `mtm_daily_returns`, `smoothed_mtm_daily_returns` or `cash_settlement` as well as `csv_daily_returns`.
- **T1's handoff note 4 still applies.** The discovery page runs `readSingleKeyBasisOpts` per request with capture on, so a series outage now also captures once per discovery view until 169.1-01 moves the page onto the shared build.

---

_Fixed: 2026-09-29_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
