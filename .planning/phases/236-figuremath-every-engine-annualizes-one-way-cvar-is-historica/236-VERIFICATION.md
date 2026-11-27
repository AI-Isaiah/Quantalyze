---
phase: 236-figuremath-every-engine-annualizes-one-way-cvar-is-historica
verified: 2026-11-25T23:55:00Z
status: passed
score: 7/7 must-haves verified
verified_at_sha: 45d7b4e5c701f5f924979b571021000b9550d7bb
drift_subjects:
  - analytics-service/services/figure_conventions.py
  - src/lib/figure-conventions.ts
  - analytics-service/services/metrics.py
  - analytics-service/services/optimizer.py
  - analytics-service/services/portfolio_metrics.py
  - analytics-service/services/portfolio_optimizer.py
  - src/lib/closed-sets.ts
  - src/lib/scenario.ts
  - src/lib/factsheet/compute.ts
  - src/lib/factsheet/build-payload.ts
  - src/lib/factsheet/record-length.ts
  - src/lib/factsheet/og-metrics.ts
  - src/lib/figure-gate.ts
  - analytics-service/tests/test_annualization_census.py
  - analytics-service/tests/test_annualization_parity.py
  - analytics-service/tests/fixtures/annualization_parity_vectors.json
  - src/__tests__/annualization-census.test.ts
  - src/__tests__/annualization-parity.test.ts
  - src/__tests__/cvar-reader-census.test.ts
  - analytics-service/requirements.in
  - analytics-service/requirements.txt
  - docs/runbooks/figuremath-fleet-rederive.md
behavior_unverified: 0
overrides_applied: 0
behavior_unverified_items: []
human_verification: []
---

# Phase 236: FIGUREMATH Verification Report

**Phase Goal:** Every engine that annualizes follows F-5 ("365, ddof 1 everywhere"): the stored Python metrics, the factsheet and Scenario TypeScript engines, portfolio analytics and matching. CVaR is historical and null below one named minimum (F-6). quantstats moves to 0.0.86 with a per-metric decision record. CAGR uses one span rule in every engine. The moved figures are re-derived for the whole fleet, the frozen spine is re-baselined as a reviewed act, and the CHANGELOG names the figures that moved.
**Verified:** 2026-11-25; closed 2026-11-27
**Status:** passed
**Re-verification:** No, initial verification

Everything the repository itself can prove is proven: the conventions, the pins, the censuses, the parity oracle, the CVaR floor, the span rule, the quantstats pin and decision record, the runbook and the figures-moved list. What remains is the PROD fleet re-derive and the CHANGELOG, neither of which a phase branch can perform. No code gap was found.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | SC1 (FIG-01): a cross-language pin fails if any engine's year length or ddof changes; each language holds both in one named constant set; a census lists every annualizing site | VERIFIED | `analytics-service/services/figure_conventions.py` and `src/lib/figure-conventions.ts` hold `CALENDAR_DAYS_PER_YEAR=365`, `SD_DDOF=1`, `PERIODS_PER_YEAR_CRYPTO=365`, `PERIODS_PER_YEAR_TRADITIONAL=252`, `CVAR_MIN_OBS=60`, each one definition. Engines import them (`metrics.py:25-29`, `closed-sets.ts` `annualizationPeriods`/`blendPeriodsPerYear`/`calendarYears`, `compute.ts`, `scenario.ts`). Pin tests plus both censuses ran green here: `pytest tests/test_figure_conventions.py tests/test_annualization_census.py tests/test_annualization_parity.py tests/test_figure_parity.py` = 80 passed; vitest `figure-conventions.test.ts`, `annualization-census.test.ts`, `annualization-parity.test.ts`, `cvar-reader-census.test.ts`, `cvar-floor.test.ts` = 95 passed. Both censuses carry an empty `NOT_YET_MIGRATED`. Only residual `365.25` hits in source are comments saying "not 365.25". `match_engine.py` `years = track / 365` is classified `display` by name (user-facing "Long track record" text, no figure); `routers/portfolio.py` is classified a consumer that threads `blend_periods_per_year` into the metrics.py backbone. I neutered it myself: `SD_DDOF = 0` in `src/lib/figure-conventions.ts` turned `figure-conventions.test.ts` 2 RED (names `SD_DDOF agrees across languages`) and 20 of 63 `annualization-parity` cases RED; restored from a byte backup, `cmp` equal, 70/70 GREEN. |
| 2 | SC2 (FIG-02): every engine reports the same CAGR, Sharpe and TWR within a pinned tolerance; the oracle imports no production helper | VERIFIED | One shared fixture `tests/fixtures/annualization_parity_vectors.json` of closed forms (repeating `[+0.02, -0.01]` series, expected values written from math in each `_comment`, e.g. n=730 sd = 0.015*sqrt(730/729) = 0.0150103, matches the file). The Python oracle in `test_annualization_parity.py` imports only `math`, `datetime`, `json`, `pandas` for the series; engines are imported only as subjects under test. The TS test imports only engines and `node:fs`. Tolerance `rtol 1e-9, atol 0` is derived in the docstring (conservative bound 5.3e-12). Ran green (see truth 1). Composite paths excluded (F-2). |
| 3 | SC3 part 1 (FIG-03): CVaR is historical and null below one named minimum | VERIFIED | `_historical_var_cvar` (`metrics.py` ~930-955) returns `(var, None)` when `n < CVAR_MIN_OBS`; VaR is not floored (F-6 names CVaR only); the floor is on the TOTAL record (founder Q2). TS side floors where the whole-record figures are built: `build-payload.ts:675` and `:904` (stored, mark-to-market and smoothed bundles, `overlaid`), `scenario-stress.ts:198` (blend CVaR on the whole common series), `VarExpectedShortfall.tsx:60`, `scenario-factsheet-payload.ts:482` (Scenario composer). `historicalVarCvar` in `return-stats.ts` carries no floor, so a zoomed window always shows CVaR (Q2). `cvar-reader-census.test.ts` and `cvar-floor.test.ts` green; the census classifies each CVaR reader as total-record or window. The review rounds found CR-01, CR-02 and CR-04 (floor bypasses) and all were fixed in code with neuter and restore arms (fix rounds 1 and 2). |
| 4 | SC3 part 2 (FIG-03): quantstats is 0.0.86 with a per-metric decision record in the same PR; no moved value re-pinned without a decision | VERIFIED (see caveat) | `quantstats==0.0.86` in `requirements.in:19`, `requirements.txt:223`, `requirements-dev.txt:16`; the Dependabot quantstats hold is deleted; `grep 0.0.81` in non-test service/requirements files finds nothing. `236-QUANTSTATS-DECISIONS.md` carries 16 per-metric rows (ADOPT / KEEP / ALREADY-ADOPTED); `236-06-SUMMARY.md` records the pre-edit RED list measured on a scratch 0.0.86 interpreter and the post-change corpus `16691 passed, 93 skipped`. The one hand-moved fixture value I could check (constit golden `cagr` 0.95003) was recomputed independently by the code reviewer; `golden_252d_expected.json` `serenity_index` was hand-edited under a decision row and its recompute was NOT independently re-done by the reviewer. Caveat: this machine's interpreter has quantstats 0.0.81 installed, so the live-0.0.86 arms could not be run here; CI's full pytest under the 0.0.86 lock is the evidence for those arms (shipper item below). `mypy` project config over the eight touched analytics files: `Success: no issues found in 8 source files`. |
| 5 | SC3 part 3 (FIG-04): CAGR uses one span rule in every engine, pinned by a test, per the founder ruling | VERIFIED | Rule: first to last observed date of the same suffix, whole days, over 365 (CONTEXT Q1 "Keep calendar span, show it"). Python stored CAGR `metrics.py` ~2296-2327 (`_CALENDAR_DAYS_PER_YEAR / _elapsed_days`), TS `wholeCalendarDays` + `calendarYears` (`closed-sets.ts`), `compute.ts` (whole days, NaN on an unparseable end, never the one-day-floor compound), Scenario/OG via `calendarYears`. Pinned across engines by the parity vectors (`emptied_stretch`, `broken_chain_suffix`, `weekday_gaps`) and by `compute.conventions.test.ts`, `closed-sets.test.ts`, `og-metrics.test.ts`, `record-length.test.ts`. "The factsheet states the span": `formatCagrSpan` in `record-length.ts`, `cagr_start`/`cagr_end` stored by `metrics.py` (lines 2254-2255, 2326-2327, 2637-2638) and computed for every full-history view (CR-03 fix: allocator book, MTM/smoothed bases, older rows, USD view, Scenario composer); `MetricsColumn.cagr-span.test.tsx` and `AllocationDashboardV2.cagr-span.test.tsx` green. |
| 6 | SC4 (FIG-05): the moved figures are re-derived for the whole fleet; the frozen spine is re-baselined as a reviewed act (never by re-running `regen_golden.py` in a constants PR); the CHANGELOG entry names the figures that moved | PRESENT_BEHAVIOR_UNVERIFIED | In-repo deliverables are present: `236-FIGURES-MOVED.md` (10 sections, per figure, for whom, which plan; it states plainly that nothing in it is a measured PROD number); `docs/runbooks/figuremath-fleet-rederive.md` (747 lines, rewritten over 4 review rounds: marker gate, population from `strategies`/`strategy_analytics` not `ledger_refresh_staleness`, bind step that STOPs on empty, batch tagging, number-to-null report for every figure, allocator MWR guard, 155.2 written confirmation); the frozen spine moved by hand in `golden_252d_expected.json` (only `cagr_start/end`, `figure_defs_version` 3, `serenity_index`) and `constit_parity_golden.json` (`cagr` 0.95092 to 0.95003, derived from the golden's own returns), with dated reviewed-act blocks in `phase-29-` and `phase-52-frozen-spine-guards.test.ts` and no `regen_golden.py` run; the four TODOS ids are deleted (grep count 0); `OG_CARD_VERSION` 3 to 4 and `FIGURE_DEFS_VERSION` 2 to 3 in both languages. NOT present and not presentable from a phase branch: the executed re-derive and the CHANGELOG entry. See "FIG-05 scope decision". |
| 7 | SC5 / PROOF-01: each gate goes RED on a one-sided constant change or neutered copy with its named arm first, restored from a byte backup, GREEN, recorded verbatim in the plan SUMMARY | VERIFIED | Every plan SUMMARY (01 to 11) records RED arms and `cmp` restores (e.g. 236-07: `CMP_OK` x4 plus a GREEN `257 passed / 5072 passed` re-run; 236-06: 50 RED references, 10 `cmp`). I re-executed the pin/parity neuter above and it bit as described. I did not re-neuter the other gates (load limit); those rest on the recorded verbatim logs. |

**Score:** 7/7 truths verified. FIG-05, the PROD re-derive, was the last item and was recorded as PASSED on 2026-11-27 (see Closure).

### FIG-05 scope decision (what text decides it)

The re-derive is **in scope and handed off, with the runbook as the in-phase deliverable; the executed re-derive is a human/coordinator item, not a code gap.** The deciding text:

- `236-CONTEXT.md` Scheduling (coordinator, 2026-11-25): "236's merge and FIG-05's fleet re-derive wait for 233 and 234 to merge ... The fleet re-derive is a PROD write: stop and hand it to the coordinator." And Deferred: "The fleet re-derive execution itself (PROD write) - handed to the coordinator after 233 and 234 merge."
- ROADMAP Depends-on: "Phases 229, 233 and 234 merged, so one fleet re-derive covers the stored inputs they change." The re-derive is defined as happening after those merge, so it is structurally impossible inside this branch.
- REQUIREMENTS FIG-05 and ROADMAP SC4 word the outcome ("are re-derived for the whole fleet") rather than "a runbook exists". Read literally that outcome is not yet true in the world, which is why this is `human_needed` and not `passed`. It is not `gaps_found` because no plan was supposed to run it and every deliverable that could precede it exists and is tested. The phase's own FIGURES-MOVED states: "FIG-05 stays pending until it is recorded."

The runbook's SQL and shell were never run against PROD or TEST (stated in its header and the SUMMARYs); they were run only against a throwaway local PostgreSQL with stubs. The first run on PROD is its own test, which the runbook says.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `analytics-service/services/figure_conventions.py` | Python constant set | VERIFIED | 39 lines, five names, no imports, imported by metrics.py and others |
| `src/lib/figure-conventions.ts` | TS twin plus `wholeCalendarDays` | VERIFIED | zero-import leaf; imported by closed-sets, compute, record-length, scenario |
| `analytics-service/tests/test_annualization_census.py`, `src/__tests__/annualization-census.test.ts` | site census, empty migration list | VERIFIED | run green |
| `tests/fixtures/annualization_parity_vectors.json` + two parity tests | independent oracle | VERIFIED | run green, bites on SD_DDOF=0 |
| `src/__tests__/cvar-reader-census.test.ts`, `src/lib/factsheet/cvar-floor.test.ts` | CVaR reader census | VERIFIED | run green |
| `236-QUANTSTATS-DECISIONS.md` | per-metric record | VERIFIED | 16 rows |
| `docs/runbooks/figuremath-fleet-rederive.md` | coordinator's re-derive | VERIFIED as a deliverable | not executed |
| `236-FIGURES-MOVED.md` | CHANGELOG input | VERIFIED | |

### Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| `figure_conventions.py` | `figure-conventions.ts` | one-regex text pin, exactly one definition per name | WIRED (tests green, RED on edit) |
| `FIGURE_DEFS_VERSION` (metrics.py) | `figure-gate.ts` | cross-language pin, both 3 | WIRED |
| `_historical_var_cvar` floor | `compute_all_metrics` total-record call | census arm pins the call-site set | WIRED |
| TS whole-record figures | `CVAR_MIN_OBS` | floors in `build-payload.ts`, `scenario-stress.ts`, `VarExpectedShortfall.tsx`, `scenario-factsheet-payload.ts` | WIRED |
| `cagr_start`/`cagr_end` (stored and computed) | `formatCagrSpan` in `MetricsColumn.tsx` | span line | WIRED (span tests green) |
| `optimize_weights` | blend clock | `periods_per_year` param threaded from route and composer, no default, `TRADING_DAYS` removed | WIRED |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Pins, censuses, parity (Python) | `cd analytics-service && python3 -m pytest tests/test_figure_conventions.py tests/test_annualization_census.py tests/test_annualization_parity.py tests/test_figure_parity.py -q` | 80 passed | PASS |
| Pins, censuses, parity, CVaR floor (TS) | `npx vitest run --maxWorkers=2` on 5 named files | 95 passed | PASS |
| Frozen-spine guards, closed-sets, compute conventions, OG, record-length, scenario, span and floor-note UI, rolling, bootstrap | `npx vitest run --maxWorkers=2` on 12 named files | 231 passed, 2 failed | See anti-patterns: both failures are the pre-existing last-ulp `skew` pin under local Node 25 |
| Neutered `SD_DDOF` | edit, run, restore, `cmp`, rerun | 2 + 20 RED, then 70/70 GREEN | PASS |
| mypy strict | `python3 -m mypy --config-file=pyproject.toml` on 8 touched files | no issues | PASS |

### Probe Execution

SKIPPED: the phase declares no `probe-*.sh`.

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|-------------|--------------|-------------|--------|----------|
| FIG-01 | 01, 02, 03, 04, 05, 09, 10 | one convention, named constants, cross-language pin | SATISFIED | truth 1 |
| FIG-02 | 08 | cross-engine parity, independent oracle | SATISFIED | truth 2 |
| FIG-03 | 03, 06, 07 | historical CVaR floor; quantstats 0.0.86 + decision record | SATISFIED | truths 3, 4 (0.0.86 arms evidenced by CI/SUMMARY, see caveat) |
| FIG-04 | 02, 03, 10, 11 | one span rule, shown | SATISFIED | truth 5 |
| FIG-05 | 09 | fleet re-derive, spine re-baselined, CHANGELOG | PARTIAL: in-repo parts SATISFIED, execution and CHANGELOG pending | truth 6; human items |

No orphaned requirements: REQUIREMENTS.md maps FIG-01..05 to Phase 236 and every id is claimed by a plan.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/lib/factsheet/compute.conventions.test.ts` | 95, 133 (fixtures B and C inline snapshots) | `skew` differs in the last ulp (`-0.11360716852722537` vs `...538`, `0.036844507138639` vs `...638946`) | Info | Environmental: local Node is v25.8.1, `.nvmrc` is 22 (the SUMMARYs ran Node 22.22.1 green). The `skew` pins are unchanged context lines in this phase's diff, so the phase did not move them. Recorded in `deferred-items.md`. Not a gap; CI on Node 22 decides. |
| debt markers | n/a | `TBD`, `FIXME`, `XXX` in changed files | none checked as blocker | Not scanned file-by-file; the review's 102-file diff review found none called out. |

### Review state

`236-REVIEW.md` records 4 review rounds and 4 fix rounds. Round 4's one MEDIUM (WR-06, allocator reads unguarded in the runbook) and the silent-failure hunt's M1 were fixed in `370a8194e` and verified by the phase agent only (no fifth review round, by the agent's call). Survivors are LOW/Info, recorded in the REVIEW only, per repo rule. Open LOWs worth the coordinator's eye at the PROD run: the `tagged_total` gate is compared by eye with no reconcile step; "empty CSV cell is null" assumes `supabase db query -o csv` output nobody has observed.

### For the shipper (merge-time and ship-time conditions, not gaps)

1. **155.2 freeze.** The ROADMAP rule (a change that moves MT5 numbers for MM2, MM3 or FX-AI_V merges before 155.2 plan 12's recapture or after plan 14, never between) is a merge-time condition. Measured at HEAD against the local `origin/main` ref: `155.2-12-SUMMARY.md` count is 0, so 236 currently merges BEFORE plan 12's recapture, the side `236-FIGURES-MOVED.md` section 9 records. Re-run a fresh `git fetch origin main` and the check immediately before the push; it is only true until plan 12 lands. The runbook's own freeze block needs the coordinator's written confirmation.
2. **Depends-on merge state.** Local `origin/main` contains 229 (`v0.133.69.0`, #1328) and 234 (`v0.133.76.0`, #1339) but no Phase 233 DERIBITTRUTH merge (branches `gsd/phase-233-deribittruth` and `-pr` exist). The local ref may be stale (this branch is 15 commits behind `origin/main`); fetch and confirm 233 is merged before the fleet re-derive, which ROADMAP Depends-on says should cover the stored inputs of 229, 233 and 234.
3. **CHANGELOG, VERSION, package.json.** Not touched by this branch. The ship writes the entry from `236-FIGURES-MOVED.md` (name `236-QUANTSTATS-DECISIONS.md` by file because a filtered `-pr` branch drops `.planning/`), names the four closed TODOS ids (`194-ENGINE-CONSTANTS`, `QUANTSTATS-0086-REDERIVE-01`, `167.1.2.2.1-CAGR-EMPTY-SPAN`, the non-composite half of `L2214`), and carries the section 10 known limits.
4. **CI is the evidence for what I could not run:** full vitest and pytest under the 0.0.86 lock (the live-0.0.86 arms, `golden_252d_expected.json` `serenity_index`), the mutation and SQL gate jobs, and `compute.conventions.test.ts` on Node 22. Verify the head SHA has the full expected check count, not just "no red".
5. **Planning-path guard.** The branch carries `.planning/` commits; the ship branch must change nothing under `.planning`.

### Human Verification Required

#### 1. Fleet re-derive (FIG-05)

**Test:** After 229, 233 and 234 are merged and 236 is deployed, the coordinator runs `docs/runbooks/figuremath-fleet-rederive.md` against PROD (marker query first, as the runbook and CLAUDE.md require) and records the outcome.
**Expected:** every non-composite strategy on `figure_defs_version` 3 with `cagr_start`/`cagr_end`; allocator MWR recomputed; number-to-null counts zero or each with a written cause; the 155.2 freeze confirmation in writing.
**Why human:** PROD write, handed to the coordinator by the CONTEXT scheduling decision; the outcome exists only after merge and deploy.

#### 2. CHANGELOG naming the moved figures (FIG-05)

**Test:** Confirm the shipped CHANGELOG entry lists the figures in `236-FIGURES-MOVED.md` sections 1 to 8.
**Expected:** one unified entry in the repo's section vocabulary, per the CHANGELOG discipline.
**Why human:** written by the ship step; absent on this branch by design.

### Gaps Summary

No gaps. All four engineering success criteria (SC1, SC2, SC3, SC5) are verified against code and targeted test runs, including a neuter-and-restore I performed myself. SC4 (FIG-05) is the single unproven truth: its in-repo parts (spine re-baselined as a reviewed act, figures-moved list, runbook, TODOS deletions, cache and version bumps) are present, while the PROD fleet re-derive and the CHANGELOG entry are handed off per the phase's own CONTEXT and cannot be completed on this branch. Hence `human_needed`.

---

_Verified: 2026-11-25_
_Verifier: Claude (gsd-verifier)_

## Closure (2026-11-27)

Both human items are met, so the status moves from `human_needed` to `passed`. Nothing in the code verdict changed.

1. **Fleet re-derive (FIG-05).** Run by the coordinator's agent from `docs/runbooks/figuremath-fleet-rederive.md`, recorded in `236-09-SUMMARY.md`. Strategy half: 22 of 22 bound strategies re-derived, `still_old` 0, number-to-null 0 on every figure. Allocator half, read after the 2026-11-27 00:40Z cron tick: `equity_curve_rows` 6 against a floor of 6, `not_rederived` 0, `guard_alloc` passed on 6 rows, allocator MWR n=6 changed=3, min 0.999849, max 1.00015, number-to-null 0, null-to-number 0. The 155.2 freeze confirmation was given in writing on 2026-11-26.
2. **CHANGELOG naming the moved figures.** Met by the v0.133.82.0 entry.

Caveats recorded, none a Phase 236 gap:
- Two runbook defects, found at the run and not fixed in the runbook: the CLI prints a SQL NULL as the literal string `NULL` (section 6's counts assume an empty cell), and the allocator cron runs at 00:40 UTC, not the 05:30 UTC the runbook's section 4 states.
- Four `derive_broker_dailies` jobs end `failed_final` every day (2026-11-25, 11-26, 11-27) with `realized read incomplete (daily_pnl_non_usd_okx)`, the named refusal for non-USD OKX keys that Phase 232 plan 03 designed. It does not touch the Phase 236 figures and has no open owner.
