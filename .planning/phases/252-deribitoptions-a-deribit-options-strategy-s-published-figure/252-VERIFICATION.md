---
phase: 252-deribitoptions
verified: 2026-11-25T20:50:00Z
status: gaps_found
score: 6/6 criteria verified for the scope of this run (wave 1 withhold + wave 2 measurement tooling); the PROD and founder-gated halves of SC-3, SC-4 and SC-5 are human_needed items, none is a gap
verified_at_sha: ee599e6c35e68271c9508eeabec8af5ad9a5a568
behavior_unverified: 0
overrides_applied: 0
drift_subjects:
  - src/lib/factsheet/headline-basis.ts
  - src/lib/factsheet/composite-read-path.ts
  - src/lib/factsheet/build-payload.ts
  - src/lib/factsheet/types.ts
  - src/lib/factsheet/fetch-and-build-payload.ts
  - src/app/factsheet/[id]/v2/MetricsColumn.tsx
  - src/app/factsheet/[id]/v2/FactsheetView.tsx
  - src/app/factsheet/[id]/v2/basis-context.tsx
  - src/app/factsheet/[id]/v2/page.tsx
  - src/app/api/og/factsheet/[id]/route.tsx
  - src/app/api/strategies/[id]/returns/route.ts
  - src/app/(dashboard)/compare/page.tsx
  - src/app/(dashboard)/recommendations/page.tsx
  - src/app/(dashboard)/allocations/lib/strategies-row-adapter.ts
  - src/app/(dashboard)/allocations/lib/constituent-figure.ts
  - src/app/(dashboard)/allocations/components/HoldingsTable.tsx
  - src/components/strategy/StrategyTable.tsx
  - src/components/strategy/CompareEquityOverlay.tsx
  - src/components/strategy/annualized-cell.tsx
  - src/lib/figure-gate.ts
  - src/lib/figure-record-scalars.ts
  - src/lib/queries.ts
  - src/lib/types.ts
  - src/__tests__/options-cash-wallet-withhold.census.test.ts
  - analytics-service/scripts/deribit_options_smoothed_probe.py
  - analytics-service/tests/test_deribit_options_smoothed_probe.py
gaps:
  - id: G252-PROBE-M3
    truth: "Wave 2: the smoothed mark-to-market reconstruction computes for every Deribit member of the evidence composite, so the read-only probe reads verdict pass (founder decision 2026-11-26: fix inside 252, keep 252 open until the probe passes)."
    status: failed
    reason: "PROD probe 2026-11-26 21:32Z: verdict fail, members 3, failed_members 1. m3 smoothed build-error:LedgerValuationError, detail LedgerValuationError:position, series_days 0. That detail is produced by three smoothed-only raises in services/deribit_txn.py (D-07 daily-mark hole in option_mtm_daily, D-09 exercise refusal in replay_option_positions, D-09 expiry nonzero position in _expiry_close). The probe's closed vocabulary cannot tell them apart, so the root cause is not yet measured. Leading hypothesis, unmeasured: a retention straddler, because m3's 1232-day history is the only one older than the 913-day mark-retention default."
    artifacts:
      - analytics-service/services/deribit_txn.py (option_mtm_daily, replay_option_positions, _expiry_close)
      - analytics-service/services/deribit_ingest.py (_build_smoothed_option_mtm)
      - analytics-service/scripts/deribit_options_smoothed_probe.py
      - analytics-service/scripts/navbreach_anchor_probe.py (LEDGER_ERROR_CLASSES, classify_ledger_error)
    missing:
      - "Each of the three refusals raises its own LedgerValuationError subclass (so every existing except still catches it), and the probe emits which one fired in closed vocabulary: for a hole, where it falls relative to the instrument's marks (no marks, before the first bar, between bars, after the last bar) and whether the day is older than the retention cutoff; for an exercise or expiry refusal, a closed shape census. No dates, instrument names, amounts or ids reach stdout."
      - "A probe re-run on PROD after deploy names the cause; then either a code fix (if the cause is a defect) or a founder question (if the cause is a straddler, whose remedy narrows the MTM span; or an unmeasured row shape)."
human_verification:
  - test: "Open the owner factsheet of the Quantum Drift evidence composite on the deployed build (PROD), after the ship deploys. Also open its share card and OG image."
    expected: "The headline strip, Main Metrics and rail show the em dash with the muted sentence 'Headline figures withheld: this strategy trades options, and its returns are measured on the cash wallet, ...'. No cumulative +1636172.7%, no CAGR, no Calmar. The card prints three dashes and the card sentence. No re-derive and no backfill UPDATE is needed: the trigger is already stored on both flagged rows (read-only PROD census 2026-11-25)."
    why_human: "Needs the deployed build and PROD data. The code path is proven by tests against fixtures, not against the live row."
  - test: "Founder visual check of the copy and tone on the factsheet, the share card, Compare, Discovery (table rank cell and grid), Holdings and the Compare overlay note."
    expected: "Wording follows the withheld-headline sentences, names no flag, job or chain-break vocabulary, and is muted (not amber). The Compare overlay note ('<name>: measured on the cash wallet, ... so no curve is drawn.') is a DRAFT owned by this check. The Monthly Returns heatmap (IN-06) still prints cash-wallet monthly cells; the founder decides if that needs a follow-up."
    why_human: "User-facing copy and visual tone."
  - test: "Run the wave-2 probe in the worker against the evidence composite: railway ssh 'cd /app && python -m scripts.deribit_options_smoothed_probe --strategy-id <id>', paste only the lines that start with {\"."
    expected: "A verdict line (pass or fail) with the C1 to C4 and C6 records per member. A pass (smoothed MTM builds, daily marks present, no cash-bucketed option days, reconciles, saw option activity) is the only input to a later MTM promotion plan. A fail keeps the withhold and is recorded."
    why_human: "Needs the keys' credentials inside the worker (founder-gated per CONTEXT). The probe was proven only against a stubbed exchange (59 pytest cases)."
  - test: "At ship time, re-take the PROD census with the marker query first (strategy_analytics rows by data_quality_flags->>mtm_gated_reason, grouped by strategies.status, composite member venues, MT5 member count) and paste the reading into the CHANGELOG entry."
    expected: "Still 2 rows, both private composites, all members Deribit, 0 published, 0 MT5 members. If a published row or an MT5 member appears, SC-5 and the 155.2 freeze rule govern the merge. The ship CHANGELOG must also name the deleted DEF-142.2-07 entry and the new [252-SINGLEKEY-OPTIONS-CASH] entry (TODOS rule (b))."
    why_human: "Ship-time PROD read and the CHANGELOG write belong to the orchestrator and the founder. A reading from 2026-11-25 is already recorded in 252-CONTEXT.md and 252-05-SUMMARY.md."
---

# Phase 252: DERIBITOPTIONS Verification Report

**Phase Goal:** A Deribit strategy that trades options never publishes a headline figure measured against the cash wallet alone. Either its returns are measured mark-to-market in key mode, or its headline is withheld by name when its chain is broken and its figures cannot be trusted.
**Verified:** 2026-11-25
**Status:** human_needed
**Re-verification:** No, initial verification
**Scope (founder ruling 2026-11-25, "Withhold first, then MTM"):** wave 1 (the named withhold) plus wave 2 measurement tooling. The PROD measurement run and any MTM promotion follow the ship, so SC-5's promotion half is pending by design.

**HEAD note:** verified at `ee599e6c3`, one docs-only commit (`252-05-SUMMARY.md` PROD reading) past the `a54033fcd` the caller named. No source file differs between the two.

## Goal Achievement

### Observable Truths (ROADMAP success criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | The discuss step records the remedy and why, citing D-05 and the KPI-gate ruling; no criterion applies a numeric plausibility bound | VERIFIED | `252-CONTEXT.md` records the ruling verbatim ("Withhold first, then MTM") and states it EXTENDS D-05 and leaves the KPI-gate ruling unchanged. `headline-basis.ts:154-157` `isOptionsCashWalletBook` takes only the flag blob and compares a string; no figure, balance or threshold input exists anywhere in the verdict path. |
| 2 | A Deribit key-mode options series yields equity-reflecting returns or a named withhold every surface honours; the 0.311 -> 0.1605 -> 0.165 -> 0.528 wallet-shape fixture goes RED on today's code | VERIFIED | Withhold route taken. `headlineVerdict` asks the predicate FIRST (`headline-basis.ts:236`), so it beats `dated` and needs neither a chain break nor an applicable gate. `headline-verdict.parity.test.ts` "252 SC-2" describe builds the wallet-shape series (-0.4839, +0.028, +3.3339 daily returns, from `deribit_option_round_trip.py`), has an anti-vacuity control (same series without the reason gives finite figures), and was reported RED on pre-edit code in `252-01-SUMMARY.md` (7 failed, 14 passed). I did not re-run the RED myself (see PROOF-01 below). GREEN re-run: passes. |
| 3 | Quantum Drift's owner factsheet shows MTM figures or a withheld headline with its named reason, never the cash cumulative, CAGR or Calmar; every surface that reads the series agrees | VERIFIED (code) / human_needed (PROD) | Code: the factsheet read path, KPI strip, Main Metrics, rail, trailing windows, selected range and rolling-chart avg label, OG card, Compare, Discovery table and grid, owner lists, percentile reads, Holdings, recommendations, composer constituents and the returns route all key off one predicate or the one cause. The census `options-cash-wallet-withhold.census.test.ts` (23 tests) pins agreement across `headlineVerdict`, `shapeRowAnalytics`, `recordFromScalars` + `gateAnnualized`, `parseConstituentRecord`, the cross-language string, the literal's four allowed files, and every `strategy_analytics` reader (26 readers: 7 covered, 19 excluded with checked reasons). The live row's rendering is the post-deploy human item. |
| 4 | The DEF-142.2-07 census is re-run on PROD at HEAD (marker first), reading recorded; entry closed and deleted, or rewritten | VERIFIED | Reading recorded in `252-CONTEXT.md` and `252-05-SUMMARY.md` (2026-11-25, marker query named PRODUCTION): 2 Deribit rows carry `twr_chain_broken`, 0 published, 0 stamped `ledger_complete`; 6 rows any venue (4 MT5, all private). `git diff 89a9e3d97..HEAD -- TODOS.md` shows item 7 `DEF-142.2-07` deleted whole and `[252-SINGLEKEY-OPTIONS-CASH]` (0.016) added with owner and trigger. The ship-time re-take is a human item; the CHANGELOG naming of both entries is written at ship. |
| 5 | Every Deribit strategy whose published figures move is re-derived and listed in the CHANGELOG; no MT5 figure moves | VERIFIED (scope) / human_needed (ship) | Nothing is published on this path: the PROD trigger population is 2 private composites, 0 published, 0 MT5 members. No migration, no stored value changes, no `analytics-service` source other than two new probe files. The change is TS read-path only, and the trigger string is producible only by `mark_to_market_available` in `stitch_composite.py` (composite, Deribit option activity). MT5-shaped rows are pinned byte-identical in `headline-basis.test.ts`. CHANGELOG has not been written yet (ship step); the promotion half of the ruling is pending by design. |
| 6 | PROOF-01: each gate RED on pre-fix or neutered copy, restored by cp and cmp, GREEN, recorded verbatim in the SUMMARY; any migration reviewed | VERIFIED (from SUMMARY evidence, not re-run) | Plan SUMMARYs 01-06 and `252-REVIEW-FIX.md` record neuter, FAIL lines, `cmp exit 0` and GREEN for the predicate, verdict order, note arm, card line, strict equality, cache key, leverage, range gate, Compare, overlay, Holdings and rolling avg. The tests carry anti-vacuity controls and table-driven NOT_TRIGGERS. I did not repeat the neuters (this run is edit-nothing). No migration exists (`git diff -- supabase` is empty), so the migration lane does not apply. |

**Score:** 6/6 verified for this run's scope; 0 present-but-behavior-unverified truths.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/factsheet/headline-basis.ts` | one trigger owner, cause, phrase table | VERIFIED | `OPTIONS_CASH_WALLET_REASON`, `isOptionsCashWalletReason` (strict `===`), `isOptionsCashWalletBook`, `OPTIONS_CASH_WALLET_CAUSE`, `OPTIONS_CASH_WALLET_PHRASES` (`satisfies Record<Slot,string>`, no flag or job wording). Wired by 8+ production files. |
| `src/__tests__/options-cash-wallet-withhold.census.test.ts` | completeness census and Python/TS pin | VERIFIED | 4 arms, passes. |
| `analytics-service/scripts/deribit_options_smoothed_probe.py` | read-only smoothed-MTM probe | VERIFIED | No `.insert/.update/.upsert/.delete/.rpc`, no `os.environ` read in code, SELECTs plus venue GETs only, key-whitelist emit with float refusal. mypy: no issues. pytest 59/59 (53 at review, plus the SFH-MEDIUM-1 cases: C6 "saw something", cannot pass on no evidence). |
| `TODOS.md` | DEF-142.2-07 deleted, follow-up booked | VERIFIED | See SC-4. |

### Key Link Verification

| From | To | Via | Status |
|------|----|----|--------|
| `headlineVerdict` | factsheet page, OG card | `composite-read-path.ts:1044` `isOptionsCashWalletBook(dqf)` in `readSingleKeyBasisOpts`; `route.tsx:280` on the effective flags | WIRED |
| options cause | KPI strip, Main Metrics, rail, range, rolling avg | `MetricsColumn.tsx` `isHeadlineWithheld` / `isRangeWithheld`, `FactsheetView.tsx` `railAvgWithheld` | WIRED |
| `queries.ts` `effectiveListFlag` | Discovery, owner lists, percentile reads (`:424`, `:1025`, `:1515`) | snapshot-aware effective flags generation | WIRED |
| `recordFromScalars` / `figure_withheld_by` | Compare, composer, Holdings, returns route | `figure-record-scalars.ts:71`, `queries.ts:2175` (`computed_at` now selected for own-capital, SFH-HIGH-1), adapter nulls MTD and Max DD (WR-01) | WIRED |
| public payload cache | key `factsheet-v2-payload-v28` | `page.tsx`, four pins in `page.public-cache-key.test.tsx` | WIRED |

### Data-Flow Trace (Level 4)

| Artifact | Data | Source | Status |
|----------|------|--------|--------|
| withhold verdict | `data_quality_flags.mtm_gated_reason` | stored JSONB stamped by `run_stitch_composite_job` via `mark_to_market_available`; census arm 2 pins the TS string to `MTM_REASON_OPTIONS` | FLOWING (trigger stored on both PROD rows per census) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Verdict, parity, read path, census, figure gate, OG card | `npx vitest run --testTimeout=60000` on 16 files (headline-basis, parity, composite-read-path, build-payload headline, census, recompute-verdict census, figure-gate, figure-record-scalars, queries.options-withhold, og/factsheet) | 16 files, 470 tests passed | PASS |
| Every surface touched | vitest on `src/app/factsheet`, compare, recommendations, `allocations/lib`, HoldingsTable, `src/components/strategy`, `src/app/api/strategies`, `factsheet-share`, `src/lib/queries*` | 298 files, 6039 tests passed (no compute.conventions or RiskTabPanel in these paths) | PASS |
| Types | `npm run typecheck` | exit 0 | PASS |
| Probe | `python3 -m pytest tests/test_deribit_options_smoothed_probe.py` and `python3 -m mypy scripts/deribit_options_smoothed_probe.py` | 59 passed; mypy clean | PASS |

`npm run lint` was not re-run here (the fix report records 0 errors).

### Probe Execution

The wave-2 probe is a founder-gated production script, not a `probe-*.sh` gate. It is not run here (see Human Verification 3).

### Requirements Coverage

None mapped (ROADMAP: "Requirements: none mapped"). No orphans.

### Anti-Patterns Found

None blocking. No `TBD`, `FIXME` or `XXX` in files changed by the phase, and no added `TODO` or `HACK` lines. No stub returns on wired surfaces.

### Review findings

`252-REVIEW.md` raised two MEDIUMs (WR-01 Holdings MTD and Max DD, WR-02 rolling avg label in a zoom) and the silent-failure pass raised SFH-HIGH-1 (own-capital Holdings could never bind the snapshot) and SFH-MEDIUM-1 (probe could pass on no evidence). `252-REVIEW-FIX.md` and commits `f2e540856`, `c0a3da3ed`, `2354497db`, `f701b9103` fix all four; the code and their tests are present and green. IN-01 to IN-09 are LOW or Info by the repo rule, recorded and not fixed. Worth the founder's attention at the visual check: IN-02 (census arm 4 is per file, and `getFactsheetDetail` fails open but only the tearsheet reads it for identity), IN-03 (the returns route still ships raw `cagr`/`sharpe` JSON for a flagged strategy, consumer withholds), IN-06 (heatmap monthly cells), IN-07 and IN-08 (probe edge-case exit codes; safe direction, no false pass).

### Known local-only failures (not regressions)

`compute.conventions.test.ts` fixtures B and C (Node 25 float) and `RiskTabPanel.book-series.test.tsx` (fails on the base). Neither is on a path this phase changes (`compute.ts` is untouched).

### Human Verification Required

1. **Post-deploy PROD factsheet of the evidence composite** shows the withheld headline, share card and OG image (see frontmatter).
2. **Founder visual check** of copy and tone on all surfaces.
3. **Probe run** in the worker (founder-gated); a pass is the only input to a later MTM promotion, a fail keeps the withhold.
4. **Ship-time PROD census** re-take, and the CHANGELOG entry naming the moved-figure reading (none expected), the deleted `DEF-142.2-07` and the new `[252-SINGLEKEY-OPTIONS-CASH]`.

### Founder decision 2026-11-26 against human item 2 (copy and tone check)

The founder decided that the OG card does NOT get the withheld sentence and that the return and drawdown charts are NOT withheld; both stay as they are. So the share-card and OG-image expectations in human item 1 and the monthly-returns follow-up in item 2 are settled by this decision, not left open. Recorded in `252-CONTEXT.md` and the ROADMAP 252 section.

**Status stays `human_needed`:** the founder still runs the PROD probe (item 3), and the post-deploy factsheet and ship-time census items remain.

### Gaps Summary

No gaps in the scope of this run. Wave 1 is implemented, wired across every surface the ruling names, covered by a census, and green. Wave 2's measurement tooling exists, is read-only and redacted, and is tested against a stub. What remains is founder-gated: the post-deploy confirmation, the copy check, the probe run, the ship-time census and CHANGELOG, and, only if the probe passes, a promotion plan (`/gsd-plan-phase 252 --gaps`).

---

_Verified: 2026-11-25_
_Verifier: Claude (gsd-verifier)_
