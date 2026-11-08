---
phase: 194-figuretruth-a-figure-means-one-thing-everywhere-and-shows-on
verified: 2026-11-08T12:00:00Z
status: human_needed
score: 11/11 must-haves verified in code; PROD after-reading done (plan 194-09, 194-RECOMPUTE.md); browser UAT pending
verified_at_sha: 77d8a6552c1a9a8dcf39d7b82e915fdaf4e5df19
drift_subjects:
  - analytics-service/services/metrics.py
  - src/lib/figure-gate.ts
  - src/lib/list-figures.ts
  - src/lib/return-stats.ts
  - src/lib/record-span-read.ts
  - src/lib/factsheet/compute.ts
  - src/lib/factsheet/basis-metrics.ts
  - src/lib/factsheet/build-payload.ts
  - src/lib/factsheet/fetch-and-build-payload.ts
  - src/lib/factsheet/rolling.ts
  - src/lib/factsheet/comparator-block.ts
  - src/app/factsheet/[id]/tearsheet/page.tsx
  - src/app/factsheet/[id]/v2/MetricsColumn.tsx
  - src/app/factsheet/[id]/v2/FactsheetView.tsx
  - src/components/strategy/StrategyTable.tsx
  - src/components/strategy/StrategyGrid.tsx
  - src/app/(dashboard)/allocations/components/HoldingsTable.tsx
  - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
  - src/app/(dashboard)/allocations/widgets/attribution/AlphaBetaDecomposition.tsx
  - supabase/schema/functions/get_verified_cohort_rank.sql
  - supabase/migrations/20261107140000_get_verified_cohort_rank_span_gate.sql
  - src/__tests__/figure-parity-pages.test.tsx
behavior_unverified: 0
overrides_applied: 0
deferred:
  - truth: "OG share card (census B3) prints stored CAGR/Sharpe/Vol with no D-15 gate"
    addressed_in: "Phase 194.1 (D04SWEEP)"
    evidence: "Census row B3; ROADMAP 194.1 'census pages B1-B13'; route.stored-parity.test.tsx pins a KNOWN DIVERGENCE (B3, Phase 194.1) case; no figure-gate import in src/app/api/og/factsheet/[id]/route.tsx"
human_verification:
  - test: "Run plan 194-09 after the phase merges and deploys (founder cleared it 2026-11-07: 'Recompute after deploy'). Marker query first, then recompute every complete strategy_analytics row through the product's own path, then repeat the SC-1 per-page reading for S1 and write 194-RECOMPUTE.md."
    expected: "rc-after lacking=0 for figure_defs_version=2, record_observations, the three 1y rolling keys and a stored returns_series beside every stored annualised KPI (D-17); every rc-metric line reads pages=agree, including 6 Month, 3 Month, VaR 95% and CVaR 95%."
    why_human: "PROD write plus a PROD read. 194-RECOMPUTE.md does not exist yet (pending by founder decision, not a gap). Until it runs, PROD rows carry the old definitions: the list and tearsheet print the stored 126-row 6 Month while the factsheet prints the calendar 6 Month; the tearsheet withholds VaR/CVaR for rows lacking figure_defs_version 2; non-crypto rows without a stored observation count are gated on the 90-day span fallback (A-194-D15-02, failure direction is the dash)."
    result: "passed 2026-11-08. 194-RECOMPUTE.md: deploy of 959ef982 confirmed by Railway and /health; marker first; 27 jobs through enqueue_compute_job, all done; rc-after complete=27 lacking=0; rc-lacking-keys when=after defs=0 obs=0 roll1y=0; rc-d17 kpi-without-series=0; 11 rc-metric lines read pages=agree, 6 Month, 3 Month, VaR 95% and CVaR 95% included (store reading; the three page-only rows stay with the browser item below)."
  - test: "After deploy and recompute, open S1 on My Strategies/discovery (table and grid view), the factsheet, the tearsheet, Scenario and Holdings in a signed-in browser, plus a short-record strategy and a record of about one year."
    expected: "Same value per name per page; a short total record shows dashes with the reason on table, grid card, factsheet strip and rail (and the benchmark column, D-19); a window under one year (zoom) carries the one muted note and still shows its figures (D-15/D-16); a record of 365 daily returns shows no under-1y note (D-20) and draws its first 1-year rolling point (D-21); the tearsheet AUM row appears only for an allocator or the strategy's own manager; the 'could not be read' reasons never appear on a healthy record."
    why_human: "Visual rendering and PROD data; the repo tests render components against fixtures, not PROD rows. Includes the D-13 muted-note styling and the D-08 equity/exposure labels read in place."
  - test: "Confirm CI `sql-tests` (and `sql-mutation`) are green on the head SHA with the expected check count, because they execute `supabase/tests/test_get_verified_cohort_rank_gate.sql` and the mutation floors for the migration edited in rounds 2 to 4."
    expected: "Gate arms for D-18 (a short record leaves the Sharpe/Sortino sets, stays in Max DD) and D-20 (the +1 covered-day count) pass and bite."
    why_human: "No database was available to this verification; the SQL gate was checked statically and by the vitest parity pins only. CI is its runner."
    result: "passed 2026-11-08. On merge sha 959ef982, main CI's sql-tests and sql-mutation jobs concluded success. sql-gate-lint concluded failure on the get_verified_cohort_rank stale-baseline drift only, which counts as green; booked as TODOS [194-BASELINE-REDUMP-COHORT-RANK]."
---

# Phase 194: FIGURETRUTH Verification Report

**Phase Goal:** A metric with the same name shows the same value for the same strategy and period on My Strategies, the factsheet, the tearsheet, Scenario and Holdings, and where two figures differ on purpose the label says why. A figure that cannot be meaningful is withheld or plainly qualified, never shown at full confidence.
**Verified:** 2026-11-08, HEAD `77d8a6552c1a9a8dcf39d7b82e915fdaf4e5df19`, branch feat/194-figuretruth
**Status:** human_needed
**Re-verification:** Yes, after six review/fix rounds (64 commits since `35351d233`) and founder decisions D-16 to D-21. The prior report had no `gaps:` section; every truth was re-checked against HEAD, and the new decisions were added as truths.

## Goal Achievement

Verdict: the code goal is achieved for the pages the phase names, and the surface set got wider since the first report. No must-have is FAILED and no blocker was found. Two of the three prior deferrals (StrategyGrid card CAGR, AlphaBetaDecomposition alpha) are now closed in code (commits `b4168cd16` V-a and `63745db78` V-b). The one open code-side deferral is the OG share card (B3), founder-routed to Phase 194.1. Plan 194-09 (PROD recompute) is pending by design, so the PROD after-reading is the human item.

**Update 2026-11-08 (plan 194-09 ran):** the PROD recompute is done. `194-RECOMPUTE.md` records every complete row on the Phase 194 definitions (`lacking=0`, `defs=0 obs=0 roll1y=0`), and S1's four SC-1 differences now agree. The CI item is resolved as well. The signed-in browser UAT is the one human item left, so the status stays `human_needed`.

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | SC-1: a read-only PROD reading, taken before any code change, records each page's value per TRUST-04 metric and names each cause | VERIFIED | `194-SC1-READING.md` exists with 14 `sc1-metric:` lines (unchanged from the first report; committed code-free at `ac3fa8c89`). |
| 2 | SC-2: same name, same value for same strategy and period on My Strategies, factsheet, tearsheet, Scenario, Holdings; deliberate differences labelled; a test goes RED on the mismatch; the fix lives where pages read | VERIFIED (code); PROD after-reading pending | Producer writes historical VaR/CVaR and calendar 3M/6M (`metrics.py`: `_historical_var_cvar` :814, `figure_defs_version` :2442); TS twin `historicalVarCvar` shared by factsheet, Scenario, book; cross-language fixture pinned (`figure-parity.test.ts`, `test_figure_parity.py` pass). `figure-parity-pages.test.tsx` feeds one stored fixture through the factsheet payload, StrategyTable, tearsheet and row adapter and passes. Stored is canonical at full history via `overlayStoredFigureDefs` (basis-metrics.ts:134, D-01); the stored observation count now reaches every factsheet build (`bf8250318`, CR-01). Gap until plan 09: PROD rows hold old definitions. |
| 3 | SC-3: no label contradicts its value ("Minimum Allocation" that is AUM) | VERIFIED | Only a comment (tearsheet page.tsx:758) still names "Minimum Allocation"; no "Negotiable" or "Lockup: None" in non-test source. Row is `AUM`, rendered only when `showAum` (own manager by server-read `user_id` compare, or the `allocator` role; every failure path false; `getUser()`; page.tsx:350-389, :762). D-08 labels: `194-D08-SITES.md` plus the edited exposure components. |
| 4 | SC-4 as amended (D-05, D-13, D-14, D-15): annualised figures are withheld only when the TOTAL record is under the minimum; windows under a year carry the one muted note; no list shows 0.00% for a figure it lacks | VERIFIED | `figure-gate.ts` (406 lines): `recordClears`, `gateAnnualized`, `gatedValue`, `gateDelta`, `gateRollingWindow`; no magnitude test (D-05). 29 non-test modules import it. `list-figures.ts` missing-last contract used by StrategyTable (D-09); `notShownLine` states the excluded count. StrategyGrid card now gates on the table's record verdict (`rowRecord`, StrategyGrid.tsx:68-69). AlphaBetaDecomposition builds a `figureRecord` and calls `gateAnnualized(record, overlapSpan)` (lines 142-149). A present but malformed date reads as `unreadable` and is withheld, an absent one is unknown (R4 WR-02, R5 WR-02, `figureRecord` :123). |
| 5 | SC-5 (as amended with D-16 to D-19): never invent data; a withheld figure reads as withheld; the factsheet benchmark column follows D-15 on a zoom and the strategy's total-record verdict; every KPI write stores its return series; short records leave the Sharpe/Sortino peer sets only | VERIFIED | `gatedValue` returns `null` for withheld or non-finite; the overlay keeps a stored null null; tearsheet withholds VaR/CVaR below `FIGURE_DEFS_VERSION`. MetricsColumn.tsx:362-416: benchmark cells use the same `gv` as the strategy (D-19), no overlap gate (D-16), muted `bench-figure-gate-note` when the comparator's own span is under a year. D-17: `test_stored_kpi_has_return_series.py` passes and `seed-demo-data.ts` writes `returns_series` beside its KPIs. |
| 6 | D-15 values and the D-20 span definition agree across languages | VERIFIED | `MIN_ANNUALIZATION_DAYS=90`, `MIN_ANNUALIZATION_OBS=60`, `ONE_YEAR_DAYS=365`, `FIGURE_DEFS_VERSION=2` in both `figure-gate.ts` and `metrics.py`. D-20: TS `coveredDays` = `spanDays + 1` (figure-gate.ts:78), Python `_index_span_days` = `.days + 1` (metrics.py:165-176), SQL `... - GREATEST(first, headline_since) + 1 < v_min_span_days` in the cohort RPC. Tests that read the Python and SQL as text pin the pairs and pass (`figure-gate` span tests, `test_figure_gate_span.py`, `closed-sets.cohort-gate-parity`). |
| 7 | Peer ranks and the cohort RPC leave out short records from the annualised sets only (D-18), counting covered days (D-20) | VERIFIED (code and test text); SQL gate not executed here | RPC: `v_n` (annualised cohort, `rec_ok` rows) divides Sharpe/Sortino; `v_n_all` divides Max DD, whose numerator has no `rec_ok` predicate. The record predicate is character-identical in the count and rank queries. Schema function and migration agree; rollback `down/20261107140000-rollback.sql` present. TS `percentile-core` and the tearsheet rank marker carry the same gate; tearsheet withholds annualised ranks when the record is withheld or unreadable (`a9d67a382`). See human item 3 for the CI-run caveat. |
| 8 | The fix lands where pages read the value (the tearsheet becomes the factsheet's print view later) | VERIFIED | One verdict module and one list contract; pages call them. The stored overlay and the total-record readability pass are in the payload builder (`build-payload.ts:902-914`), not in per-component code. |
| 9 | D-14 + D-21: a 365-day rolling window is produced, stored, drawn without the note once filled, and fills at 365 covered days | VERIFIED | `metrics.py`: `ROLLING_1Y_WINDOW_DAYS`, `_rolling_calendar_stats` (first full point at `index[0] + 364 days`, i.e. 365 covered days), `rolling["sharpe_1y"]` etc. TS twin `rollingCalendarStats` uses `coveredDays(dates[0], dates[i]) < windowDays` (rolling.ts:186). Both proven equal on `rolling_1y_vectors.json` (`test_rolling_1y.py`, `rolling-calendar.test.ts` pass). |
| 10 | The unreadable-record report fires once, on the server only (R6 WR-01) | VERIFIED | `captureToSentry` in `build-payload.ts:917` is guarded by `opts?.reportUnreadable`; only `fetch-and-build-payload.ts:1038` and `:1159` set it. A client `useMemo` re-derive withholds but does not report; `figure-record-unreadable.test.ts:87` pins that case and passes. |
| 11 | Founder decisions D-06, D-07, D-09, D-13 are delivered | VERIFIED | D-06/D-07: truth 3. D-09: truth 4. D-13: the single muted `figure-gate-note` and `bench-figure-gate-note` (italic, `text-text-muted`, no glyph) replace the amber sentences in MetricsColumn.tsx; covered by the factsheet component tests that pass. |

**Score:** 11/11 truths verified in code; 0 present-but-behaviour-unverified. The PROD effect and the rendered check are the human items.

### Deferred Items

Not met on this surface, explicitly routed to a later phase by founder decision (D-10, D-11).

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | OG share card prints stored CAGR/Sharpe/Vol ungated (census B3) | Phase 194.1 | `KNOWN DIVERGENCE (B3, Phase 194.1)` test pins it; no `figure-gate` import in the route |

Closed since the first report (no longer deferred): StrategyGrid card CAGR (`b4168cd16`), AlphaBetaDecomposition annualised alpha (`63745db78`).

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `analytics-service/services/metrics.py` | historical VaR/CVaR, calendar 3M/6M, 1y rolling, record count, version marker, D-20/D-21 spans | VERIFIED | Wired into `compute_all`; 532 pytest tests across the 194 files pass |
| `src/lib/figure-gate.ts` | one verdict and copy | VERIFIED | 406 lines, pure, 29 non-test consumers |
| `src/lib/list-figures.ts`, `src/lib/record-span-read.ts` | missing-last contract, record span read | VERIFIED | Used by StrategyTable and queries |
| Cohort RPC migration, rollback, schema function, SQL gate | D-18/D-20 record gate | VERIFIED (static) | Files exist and agree; SQL gate not executed here |
| `194-RECOMPUTE.md` | PROD recompute record | EXISTS (2026-11-08) | Plan 194-09 ran; human item 1 passed |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| factsheet fetch path | stored row | select aliases, `overlayStoredFigureDefs`, `recordObservations` | WIRED | `fetch-and-build-payload.ts`; parity test fake client honours the select string |
| StrategyTable, StrategyGrid, tearsheet, Holdings, Scenario, AlphaBeta | `figure-gate` | `figureRecord` / `rowRecord` + `gateAnnualized` | WIRED | Imports and calls confirmed |
| TS `historicalVarCvar`, `coveredDays`, `rollingCalendarStats` | Python twins and SQL | shared fixtures and text-reading pins | WIRED | Pin tests pass |
| `fetch-and-build-payload` | Sentry unreadable report | `reportUnreadable: true` | WIRED | Two call sites; client path does not set it |

### Data-Flow Trace (Level 4)

| Artifact | Data variable | Source | Real data | Status |
|----------|---------------|--------|-----------|--------|
| StrategyTable / StrategyGrid cells | `s.analytics.*` gated by `rowRecord(s)` | `queries.ts` stored columns plus record aliases | Yes | FLOWING |
| Tearsheet figures | `analytics.*` via `annualized()` | stored row | Yes | FLOWING |
| Factsheet rail and benchmark column | payload `strategyMetrics`, `hb` | stored overlay at full history, engine for a narrowed range | Yes | FLOWING |
| Record observation count on PROD | `record_observations` | written by the producer | No on PROD until recompute | pending plan 09 (interim span rule fails to the dash) |

### Behavioral Spot-Checks (run at 77d8a6552)

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All 170 vitest files this phase added or edited (vs merge-base with main) | `npx vitest run <those .test files>` | 170 files, 5595 tests passed | PASS |
| Pre-existing `compute.conventions` fixtures B and C | `npx vitest run src/lib/factsheet/compute.conventions` | 2 fail, 21 pass; `compute.ts` skew untouched by the phase (no skew line in the diff); recorded in `deferred-items.md` as failing before 194 (last-float-digit skew) | PASS as pre-existing, unrelated |
| Python tests changed by this phase (10 files incl. figure parity, span, 1y rolling, stored-KPI-has-series, match engine) | `python3 -m pytest ...` from `analytics-service/` | 532 passed | PASS |
| Typecheck | `npm run typecheck` | exit 0 | PASS |
| Debt markers added in non-test source | diff grep for TBD/FIXME/XXX | none | PASS |

Not re-run by me: the full vitest and pytest suites, lint, mypy strict, and every SQL gate (no database). Those are the orchestrator's and CI's.

### Probe Execution

SKIPPED: no probe declared by the phase.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| TRUST-04 | 01-08, 10-24 | same metric, same value across pages | SATISFIED in code; PROD after-reading pending | Truths 1, 2, 6, 8, 9 |
| TRUST-05 | 03-08, 10-24 | a figure that cannot mean anything is withheld or qualified | SATISFIED for the named pages and for the grid card and allocations alpha; OG card deferred to 194.1 | Truths 4, 5, 7, 10 |

No orphaned requirements.

### Anti-Patterns Found

None blocking. No debt markers in non-test source. No `?? 0` introduced to hide a missing figure.

### Known Residuals (booked by the founder, not gaps)

Recorded here so the report matches the ledger; none contradicts a success criterion on the named pages.

- Holdings `figureRecordScalars` lacks the `unreadable` flag.
- Mark-to-market and smoothed date arrays (R6 WR-02) and `shapedRecordScalars` / the SQL `headline_since` regex (R6 WR-03) treat a malformed date as absent; the SQL arm stays on the unknown side. PROD holds 0 malformed dates across 34 series.
- Scenario factsheet payload interior dates; `percentileRecord` Sentry dedup; the HARD-04 `insufficient_window` raw gap (194.1); a zoomed benchmark short-coverage note.

### Gaps Summary

No gaps. Warnings, none blockers:

- **W1 (OG share card B3).** A public share image shows annualised figures at full confidence that the factsheet withholds on a short record. Pinned by a `KNOWN DIVERGENCE` test; Phase 194.1 deletes the case when it gates the card. Phase 194.1 still has "Plans: 0 plans" and goal text "[Urgent work - to be planned]", so this stays visible until it is planned.
- **W2 (interim PROD state between deploy and plan 09).** The list and tearsheet print the old 126-row 6 Month while the factsheet prints the calendar one; non-crypto rows fall back to the 90-day rule. Designed; the exposure window is the time between deploy and recompute.
- **W3 (migration edited in place).** `20261107140000_get_verified_cohort_rank_span_gate.sql` was revised over four review rounds before merge; safe only because it has not been applied to PROD or TEST. Do not re-edit it after merge.
- **I1 (bookkeeping).** ROADMAP Phase 194 line reads "23/24 plans executed" and the Progress/overview bullet stays unticked until 194-09 completes.

---

_Verified: 2026-11-08, at 77d8a6552c1a9a8dcf39d7b82e915fdaf4e5df19_
_Verifier: Claude (gsd-verifier)_
