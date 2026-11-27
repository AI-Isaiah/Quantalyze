# Phase 252: DERIBITOPTIONS - Context

**Gathered:** 2026-11-25
**Status:** Ready for planning

<domain>
## Phase Boundary

A Deribit strategy whose headline comes from the cash wallet of an options book never publishes that headline. Wave 1 withholds it under a named reason that every surface honours. Wave 2 measures mark-to-market (market-price) valuation for these keys and switches the headline to it only if the measurement shows it works. The phase also re-measures `DEF-142.2-07` and closes or rewrites it.

Out of scope: Deribit allocator books in key mode (Phase 233 DERIBITTRUTH owns book days), MT5 (the 155.2 freeze), and any numeric plausibility bound (Phase 194 D-05).

</domain>

<decisions>
## Implementation Decisions

### Remedy (founder ruling)
- FOUNDER RULING, 2026-11-25 (AskUserQuestion via the coordinator), verbatim answer "Withhold first, then MTM (Recommended)". The option text chosen, verbatim: "Ship now: withhold the headline of a Deribit options book whose figure comes from the cash wallet, with the reason named on every surface (factsheet, share card, Compare, Discovery). The trigger is the existing 'unsmoothed options book' flag, not a size threshold. This extends D-05, so you'd be accepting a new named withhold, like you did for 233 today. Then measure market-price valuation and switch the headline to it only if it actually works for these keys." — **Reversibility:** costly — it changes what published surfaces show for a class of strategies and extends a founder decision.
- This EXTENDS Phase 194 D-05. D-05 read "Implausible values are SHOWN and NOT flagged ... Only D-04 and genuine nulls withhold a figure." The founder accepts one more named withhold: a Deribit options book measured on the cash wallet. It is a structural, non-numeric trigger. It is not a plausibility bound, and no criterion in this phase applies a magnitude threshold. The KPI-gate ruling (withhold KPIs only under about 3 months of total record) is unchanged and still applies on its own.

### Wave 1: the named withhold
- Trigger: `strategy_analytics.data_quality_flags.mtm_gated_reason === "unsmoothed_options_book"` (strict string equality), read on a row whose headline is the cash-settlement basis. Today only the composite stitch produces that value (`stitch_composite.py` `MTM_REASON_OPTIONS`, via `mark_to_market_available`). — **Reversibility:** costly — every surface keys off it.
- The withhold NEVER fires on `twr_chain_broken` alone and NEVER on an MT5 row. Other `mtm_gated_reason` values (`mtm_basis_unavailable_for_venue`, `mtm_summary_coverage_incomplete`, the second-pass timeout and uncomputable reasons) do not trigger it. A test pins each of these negatives.
- Surfaces: the factsheet headline and KPIs, the share card and OG image, Compare, and Discovery (grid, table and ranking), plus every other surface that already honours the headline verdict or the D-15 withhold for the same stored scalars. They agree for the same row, and the reason is named on each one.
- The withhold applies to the headline figures measured on the cash wallet: cumulative return, CAGR and the ratios derived from the stored cash scalars. Where a non-cash basis series (MTM or smoothed) is actually stored and shown behind the basis toggle, it is not withheld by this rule.

### Wave 2: market-price valuation, measured first
- Measure before promoting. The first wave-2 plan measures whether the existing smoothed mark-to-market reconstruction computes for these keys (no missing daily option marks on held days, no `LedgerValuationError`) and what it produces. The headline switches to it only if the measurement passes criteria the plan states in advance. If it does not pass, the withhold stays and the result is recorded.
- The measurement is read-only. A run that needs the keys' credentials, so it runs in the worker, is a founder-gated step, as R11 was in the debug session.

### DEF-142.2-07
- The census was re-run on PROD at HEAD on 2026-11-25 (marker query first, read-only). Deribit strategy rows carrying `twr_chain_broken`: 2 total, 0 published. Both are private composites stamped `composite_stitched` with `mtm_gated_reason = unsmoothed_options_book`. Deribit rows stamped `ledger_complete` with a broken chain (the entry's own subject): 0. PROD has no single-key Deribit strategy. All venues: 6 rows (2 Deribit, 4 MT5), all private. The planner decides whether the ship closes and deletes the entry or rewrites it with these numbers, and says which.

### Decided at planning (orchestrator, 2026-11-25, after RESEARCH)
- Trigger population, PROD read 2026-11-25 (marker first, read-only): rows carrying any `mtm_gated_reason` = 2, both `unsmoothed_options_book`, both private composites. Every composite member on PROD is a Deribit key (0 MT5 members). So no published figure moves in wave 1 and no MT5 number can move (155.2 freeze not engaged). RESEARCH Open Question 0 is answered.
- The share card names the reason. The ruling says "with the reason named on every surface (factsheet, share card, Compare, Discovery)", so dashes alone are not enough on the card.
- No migration in this phase. `get_verified_cohort_rank` (peer-set RPC) is not changed: both trigger rows are private and never enter a verified cohort. TS percentile ranks skip a flagged row. If a flagged strategy is ever published, a migration would be needed to drop it from others' peer sets. This is booked in `<deferred>`.
- Allocation blends that consume a flagged leg's returns series are out of wave 1 scope (the ruling names four surfaces). A constituent's own annualized figures are withheld through the figure-record marker. Blend-level handling is deferred.
- The wizard preview and admin approve are out of scope.
- Selected-range and zoomed-window figures (plan-check W3, orchestrator 2026-11-25): for this cause they are withheld too, with the same named reason, so SC-3's "never shows the cash-wallet cumulative, CAGR or Calmar" holds on every view. The chain-break pattern, which re-derives range figures from the series, is not carried over to this cause. The equity and rolling charts may still draw the series, with the named note beside them. This is not a KPI-gate change: the ruling's structural withhold covers every figure measured on the cash wallet, whatever the window.
- Withheld-note tone: muted, not amber. DESIGN.md reserves amber for transient, recoverable states, and this withhold is structural.

### Decided autonomously
- [Wave 1] Q: "Where does the withhold decision live?" → Selected: "One TS owner beside the existing headline verdict in `src/lib/factsheet/headline-basis.ts`, read by every surface; Python needs no change for wave 1 because the composite already stamps the flag" — internal code location, cheap to move.
- [Wave 1] Q: "Does wave 1 need a re-derive?" → Selected: "No backfill UPDATE, ever. The trigger is already stored on both affected rows; after deploy, re-stitch them through the product's own job only if the planner finds a stored value the read path needs that is missing" — the re-stitch path exists and is repeatable.
- [Wave 1] Q: "How is SC-2's RED fixture built?" → Selected: "A fixture with the debug session's wallet shape 0.311 → 0.1605 → 0.165 → 0.528 on an options member goes RED on today's code (its headline reaches a surface) and GREEN after (withheld with the named reason)" — test-only.
- [Ship] Q: "One PR or two?" → Selected: "Wave 1 ships in the phase PR. Wave 2's measurement tooling ships with it if it is ready; the founder-gated measurement run and any promotion follow the measurement" — release sequencing, cheap to change.

### Founder decision 2026-11-26 (OG card and returns charts stay as they are)
- The OG card does NOT get the withheld sentence, and the return and drawdown charts are NOT withheld. Both stay as they are. This closes the open question the founder-visual-check item carried (the Monthly Returns heatmap, IN-06, and the card wording); it narrows the "reason named on every surface" reading of the 2026-11-25 ruling for these two surfaces only. Recorded here and in the ROADMAP 252 section per the deviation policy.

### Founder decision 2026-11-26 (probe FAIL is fixed inside 252)
- The wave-2 probe ran on PROD on 2026-11-26 at 21:32Z and read verdict `fail` (3 members, 1 failed). m1 and m2 smoothed: pass (704 and 410 days, days_over_guard 0). m3 smoothed: `build-error:LedgerValuationError`, detail `LedgerValuationError:position`, 0 series days, c3/c4 not-run, option_activity `no`. m3's cash contrast built: 1232 days, option_activity `yes`.
- FOUNDER DECISION 2026-11-26 (AskUserQuestion via the coordinator), verbatim answer "Fix it inside 252": fix the cause of the probe FAIL inside Phase 252, and keep 252 open until the probe passes. The fix must not invent data (an uncomputable value stays null or withheld) and must not narrow the MTM span without a separate founder ruling.
- Local diagnosis 2026-11-27, from code only: that detail can come from exactly three smoothed-only raises in `services/deribit_txn.py`. They are the D-07 daily-mark hole in `option_mtm_daily`, the D-09 `exercise` refusal in `replay_option_positions`, and the D-09 `expiry` row with a nonzero or non-numeric `position` in `_expiry_close`. m3 is the only member whose history (1232 days) is older than the 913-day mark-retention default, so a retention straddler (the D-07 hole) is the leading hypothesis. It is NOT measured. The probe's vocabulary cannot tell the three apart, so the first gap plan makes the code name which one fired, then the probe is re-run. If the cause is a straddler, every remedy narrows the MTM span, and that needs a founder ruling.

### Founder decision 2026-11-27 (partial reversal of D-09: the measured exercise shape is accepted)
- FOUNDER DECISION 2026-11-27 (AskUserQuestion via the coordinator), verbatim answer "Accept measured shape only (Recommended)". A Deribit `exercise` transaction-log row on an option is accepted ONLY in the shape the 2026-11-27 PROD probe measured: `change` zero, and `position` present and zero. It closes the option position to 0 on its UTC day, the way an `expiry` row does. Every other `exercise` shape keeps refusing by name (`OptionExerciseRowError`): a nonzero change, or an absent, non-numeric or nonzero position. **This partially reverses D-09** (founder decision 2026-09-26, which refused every `exercise` row because its shape was unmeasured). Evidence: m3's refusal_shape `{kind: exercise, change: zero, position: zero, siblings: trade 18, exercise 1, other close rows 0}`. Deribit documents `position` as the updated position size after the transaction. Gap plan 252-08 carries the fix. No data is invented and the MTM span is not narrowed. **Reversibility:** cheap, because it is one replay branch with a pinned test.

### Decided at gap planning (orchestrator, 2026-11-27, after the PASS probe; not a founder ruling)
- Input: the 2026-11-25 ruling ("switch the headline to it only if it actually works for these keys") and the 2026-11-27 18:36Z PROD probe, verdict pass, 3/3 members. Gap plans 252-09 (producer) and 252-10 (read path) carry the promotion.
- The composite smoothed pass no longer reads `SMOOTHED_MTM_ENABLED`; it runs for every composite that trades options (the population the wave-1 withhold already hides). The flag keeps controlling the single-key smoothed pass and the RT-4 config refusal. Precedent: Phase 185 D-04 builds the key-mode options headline without the flag. This is effectively turning the flag on for composites in code. **Reversibility:** cheap (one revert); the founder may overturn it.
- Promotion criteria, stated before any PROD stitch: P1 the composite trades options; P2 every member's smoothed build computes and the stitched series derives; P3 no option day inside the span is valued at cash for mark retention; P4 the smoothed headline has no interior chain break. Any miss stores today's shape: cash headline plus `unsmoothed_options_book`.
- A promoted row stores the smoothed scalars at top level, sets `data_quality_flags.headline_basis = "smoothed_mtm"` and drops `mtm_gated_reason`, in one upsert. The factsheet opens a promoted row on the smoothed basis (the segment renders even with `NEXT_PUBLIC_SMOOTHED_MTM_ENABLED` off) and the cash basis stays withheld under the wave-1 sentence. The top-level series carried in `metrics_json` (`returns_series`, `drawdown_series`, `monthly_returns`, sparklines) follow the promoted headline, so the charts drawn from them show the smoothed curve that matches the promoted figures; `csv_daily_returns`, the cash by-basis object and the sibling series rows stay cash. This keeps the 2026-11-26 decision (the return and drawdown charts are not withheld and need no code change); it does not keep a cash curve under smoothed figures.
- The smoothed derive takes the cash derive's zero-fill arguments (`scalar_returns`, `densify_policy="zero_fill"`). PROD has never stored a smoothed row, so no stored value moves.

- Known limit recorded after review (WR-02, 2026-11-27): the promotion is time-limited by venue mark retention. The retention cutoff counts back from today, so as a held option's daily marks age out, a later refresh fails P2 or P3 and the headline returns to the named withhold on its own. When that happens per member is unmeasured. A stitch that withdraws a previously promoted headline logs at WARNING and reports to Sentry with the cause. Any remedy (e.g. storing marks) needs its own founder ruling; this phase does not narrow the span.
- WR-01 (review fix): on a composite job's last attempt, a transient from the smoothed pass degrades to the cash headline plus the named withhold instead of failing the job; earlier attempts still retry. This supersedes the planner's acceptance of T-252-27 for the last attempt only.

### Claude's Discretion
- The public wording of the withheld reason follows the existing withheld-headline sentences and DESIGN.md, with no flag names or job vocabulary. It is user-facing copy, so the founder sees it at the visual check.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/factsheet/headline-basis.ts`: `readHeadlineBasis`, `headlineVerdict`, `HeadlineWithholdCause` (`unmeasured | recomputing | failed`), `storedCashHeadlineGate`. These are the shared headline decision for the factsheet read path and the OG card.
- `src/lib/factsheet/og-metrics.ts` `computeOgHeadline`; `src/lib/factsheet/composite-read-path.ts` `applyHeadlineBasis`.
- `src/lib/figure-gate.ts`: the D-15 gate (`gateAnnualized`, `withheldReason`, `FigureState`) used by Discovery, lists, Compare and ranking (`queries.ts` `withholdShortRecordRanks`).
- `src/app/factsheet/[id]/v2/basis-context.tsx`: `mtmDisabledReasonCopy` and `mtmReasonTone` already render `unsmoothed_options_book` for the basis toggle.

### Established Patterns
- Withheld verdicts are closed TS enums with a compile-checked phrase table. Flag names never reach public text.
- Producer-stamped flags in `data_quality_flags` are read strictly (`=== true` or exact string).
- Remedy rule: re-derive or re-stitch, never a backfill UPDATE.

### Integration Points
- Python producer: `analytics-service/services/stitch_composite.py` `mark_to_market_available` and the `run_stitch_composite_job` flag stamping in `job_worker.py`.
- Wave 2: `deribit_txn.py` `replay_option_positions` and `option_mtm_daily`, `deribit_ingest.py` `_build_smoothed_option_mtm` and `fetch_deribit_option_daily_marks`, the `SMOOTHED_MTM_ENABLED` kill switch (`closed_sets.py` `is_smoothed_mtm_enabled`).
- Phase 233 write scope, which no plan here may edit in parallel: `deribit_txn.py` `correction_is_trading`, `assert_correction_classifiable`, `_correction_names_instrument`, `_CORRECTION_INSTRUMENT_TOKEN_RE`; `scripts/deribit_book_oracle.py`; `scripts/prod-prober/arms/freshness.mjs` and `run.mjs`; `.github/workflows/prod-prober.yml`; `src/__tests__/prod-prober-wiring.test.ts`.

</code_context>

<specifics>
## Specific Ideas

- Evidence row: the owner factsheet of a private Deribit options composite showed cumulative +1636172.7%, CAGR +514301268133036.3% and Calmar 10402151596756.16 over 122 days "measured since Dec 16, 2025". Its verdict today is `dated` (it has `headline_since`), so no current gate withholds it. A second private composite carries the identical series.
- Deribit docs read (2026-11-25): `equity = balance + futures session (UPL+RPL) + options_value`. `balance` excludes option mark value, and premiums debit `balance` at trade time. Transaction-log rows carry an optional post-transaction `equity` but no daily mark row. `get_mark_price_history` covers only options in the volatility index; the smoothed path's daily marks are trade candles from `get_tradingview_chart_data`.
- PROD has never stored an `mtm_daily_returns` or `smoothed_mtm_daily_returns` row (read 2026-11-25).

</specifics>

<deferred>
## Deferred Ideas

- A single-key Deribit options strategy whose MTM second pass succeeds still headlines on cash and carries no `unsmoothed_options_book`. PROD has none today. Wave 2's promotion, or a follow-up phase, owns it if one appears.
- Deribit allocator books in key mode: Phase 233 DERIBITTRUTH.
- Peer-set RPC `get_verified_cohort_rank`: drop a flagged strategy from other strategies' peer sets if one is ever published (needs a migration). Not needed today because both rows are private.
- Allocation blends whose leg is a flagged options book.

</deferred>
