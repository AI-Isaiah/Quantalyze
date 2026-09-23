# Phase 166: QSTATS-TRUTH — every quantstats-derived number reflects the returns it was given - Context

**Gathered:** 2026-09-24
**Status:** Ready for planning
**Mode:** `--auto` (founder asleep; every decision below was taken from repo evidence and says so — no AskUserQuestion was used)

<domain>
## Phase Boundary

Close the quantstats `_utils._prepare_returns` / `_utils._prepare_prices` price-detection heuristic on
EVERY quantstats call in the production analytics path — not only inside `compute_all_metrics`, which
Phase 159 (RANK-05) already closed — so no value persisted to `metrics_json`, and no rolling series
rendered in a chart, is the output of quantstats misreading a return series as prices. Replace the
line-matching RANK-05 region gate with an AST gate that can see every call shape and is proven able to
fail. Settle, on evidence, whether quantstats stays.

In scope: `compute_qstats_scalars` (8 dispatched scalars + `r_squared`), `_rolling_alpha_beta`'s
`rolling_greeks` call, the `greeks` benchmark leg in `compute_all_metrics`, the gate, the TODOS 0f
primitive extraction, and the before/after record of every corrected value.

Out of scope: the TypeScript factsheet math in `src/lib/factsheet/compute.ts` (it does not use
quantstats — it derives from dailies), any annualization-convention change not forced by a closure
(see D-08), any recompute or backfill of PRODUCTION rows (D-11, OPEN), and moving the quantstats pin.

</domain>

<decisions>
## Implementation Decisions

### Measured premises (taken at this worktree's HEAD, 2026-09-24 — the plan re-measures, never trusts)

- **P-1 — the defect is still live, same values.** Running `compute_qstats_scalars` on the RANK-05
  trigger fixture (`_rank05_trigger_series` in `analytics-service/tests/test_metrics.py`: 60 business
  days, day 1 +150%, then a decaying positive tail) returns `recovery_factor=2.0737`,
  `ulcer_index=0.9947`, `upi=2.9999`, `common_sense_ratio=0.0`, `serenity_index=0.3204` — byte-for-byte
  the WINDOWS.md entry 9 reading — plus `probabilistic_sharpe_ratio=0.1531` (a PSR below 0.5 for a
  series that never lost a day), `kelly_criterion=None`, `cpc_index=None`.
- **P-2 — "30 call sites" is a GREP count, not a call-site count.** `grep -c 'qs\.stats\.'` on
  `analytics-service/services/metrics.py` = 30, but most hits are comments and docstrings. An AST walk
  finds **9** quantstats call nodes: 6 in `compute_all_metrics` (`volatility`, `value_at_risk`,
  `tail_ratio`, `profit_factor`, `drawdown_details`, `greeks`), 2 in `compute_qstats_scalars` (the
  `getattr(qs.stats, qs_attr)` dispatch over `_QSTATS_SINGLE_ARG_SCALARS` — 8 functions — and
  `r_squared`), 1 in `_rolling_alpha_beta` (`rolling_greeks`). That is **16 distinct quantstats
  functions invoked**. `services/metrics.py` is the only production module that imports quantstats
  (`routers/process_key.py`, `services/analytics_runner.py`, `services/equity_reconstruction.py`
  mention it only in comments).
- **P-3 — upstream has no newer release.** PyPI's latest `quantstats` is `0.0.81` (uploaded
  2026-01-13); the release list tops out `…0.0.76, 0.0.77, 0.0.81`. So "upgrade to a fixed release" is
  empirically unavailable today; research must still check the upstream default branch and forks.
- **P-4 — signatures (installed 0.0.81).** `prepare_returns=` is ACCEPTED by `recovery_factor`,
  `kelly_criterion`, `common_sense_ratio`, `cpc_index`, `r_squared`, `rolling_greeks`, `greeks`.
  It is ABSENT on `ulcer_index`, `ulcer_performance_index`, `probabilistic_ratio`, `serenity_index`.

### Library shape (success criterion 1)

- **D-01: Research decides the shape by a fixed rule, and the default is "keep the 0.0.81 pin, close
  every site ourselves".** The researcher answers three questions with sources: (a) is `0.0.81`
  current (P-3 says yes on PyPI); (b) does the upstream default branch or a maintained fork fix
  `_prepare_returns`' price detection; (c) would any such fix cover the transitive `_prepare_prices`
  path too. Rule: a PyPI RELEASE that fixes both paths → record it and route the bump to Phase 165
  (dependency churn lands last, ROADMAP ordering 2026-09-05; Phase 159 D-04 "no quantstats fork/pin");
  still close the sites here, because a bump alone does not close a caller that hands prices in.
  An unreleased commit or a fork → NOT adopted (see OPEN-1). Nothing found → proceed on the default.
  — **Reversibility:** reversible — no dependency file changes in this phase.
- **D-02: quantstats STAYS in production for this phase, as a kwarg-closed dependency AND the live
  parity oracle.** Evidence: the RANK-05 parity tests (`test_rank05_every_closed_site_matches_live_quantstats_on_a_benign_series`
  and siblings) use live 0.0.81 as the non-self-referential correctness anchor, and
  `analytics-service/requirements-dev.txt` already carries a dev-only `quantstats==0.0.81` pin whose
  comment anticipates production dropping it. Removing it from `requirements.in`/`requirements.txt`
  is a dependency change that belongs with Phase 165's campaign, not here. The SUMMARY states the
  answer to "does the library stay" explicitly: yes, with the residual kwarg-closed sites named.
  — **Reversibility:** reversible.

### Closure mechanism (success criterion 2)

- **D-03: A kwarg closure counts ONLY when it is proven BEHAVIOURALLY on a trigger fixture, never by
  signature.** Phase 159 measured that `cvar` advertises `prepare_returns=` and does not honour it
  transitively (`159-05-SUMMARY.md`; the `cvar` comment block in `compute_all_metrics`). So each of
  the seven kwarg-capable functions in P-4 is closed by kwarg only if a test shows the kwarg removes
  the guess on the trigger fixture for EVERY leg (strategy AND benchmark for `r_squared`, `greeks`,
  `rolling_greeks`). Where the kwarg does not reach a transitive preparer (the 159 SUMMARY already
  flags `recovery_factor → max_drawdown`), the site moves to the inline arm.
- **D-04: The transitive sites are closed by inline mirrors built on EXTRACTED module-level
  primitives — never a third hand-copy.** TODOS 0f (`[159-SIMPLIFY-DEFER]`) is folded here and is
  binding on ORDER: first extract `_downside_rms`, `_annualized_vol_sharpe` (and a drawdown-series
  primitive from the existing inline `to_drawdown_series` mirror in `compute_all_metrics`) as
  module-level functions with the existing call sites re-pointed and every existing parity test
  unchanged and green; only then write the `ulcer_index` / `ulcer_performance_index` /
  `probabilistic_ratio` / `serenity_index` (and any D-03 fallouts) mirrors on top of them. Each mirror
  carries the P114-style docblock citing the 0.0.81 source it mirrors, as the 159 sites do.
- **D-05: The `greeks` benchmark leg is closed by inlining alpha/beta** (0.0.81's `greeks` runs the
  benchmark through `_prepare_benchmark` → `_prepare_returns` unconditionally, per the call-site
  comment in `compute_all_metrics`), unless D-03's behavioural test proves otherwise. The M1
  inner-join alignment contract at that site is preserved exactly.
- **D-06: `rolling_greeks` (feeds the rendered `rolling_alpha` / `rolling_beta` sibling series) is
  closed on BOTH legs**, by kwarg if D-03 proves it, else by an inline rolling cov/var mirror. The
  existing H-0711 one-pass contract and the Phase 34 "rolling alpha is not annualized" note are kept.
- **D-07: Every quantstats call node is accounted for in a PRINTED census** — the Phase 164.4
  printed-exclusion discipline. The census row per node: function, call shape, arm
  (`kwarg-proven` / `inline` / `exempt`), and for `exempt` the reason. `drawdown_details` stays the one
  exemption, still pinned by `test_rank05_drawdown_details_is_heuristic_free`. The 30-vs-9
  reconciliation (P-2) is written into the census so criterion 2's "30" is answered, not silently
  re-counted.

### Money-math rules for the mirrors

- **D-08: No annualization convention changes in this phase.** Each mirror reproduces its 0.0.81
  function's arithmetic on benign fixtures (parity with LIVE quantstats is the anchor, as in 159),
  taking any `periods` from the same place the current call does. The project rules (crypto √365 /
  traditional √252; RISK on frequency, RETURN/CAGR on CALENDAR; blend 365 if any leg is crypto) are
  checked against each closed site by the researcher; a violation found is RECORDED as a finding with
  before/after and fixed only under D-10's disclosure, never silently. Note for the researcher:
  `rolling_greeks` and `probabilistic_ratio` default `periods=252`.
- **D-09: A ratio whose denominator is a drawdown or a loss that does not exist is UNDEFINED → `None`,
  never `0.0` and never `±inf`.** Precedent: `src/lib/factsheet/compute.ts` already returns null
  "rather than 0 — `0 recovery_factor` would imply a real but zero ratio", and `compute_qstats_scalars`
  already emits `None` for `kelly_criterion` / `cpc_index` on the trigger fixture. Criterion 4's
  economic invariants on the all-winning, `max_drawdown == 0.0` fixture therefore are:
  `ulcer_index == 0`; `recovery_factor`, `upi`, `serenity_index` are `None` (zero-drawdown
  denominators); `common_sense_ratio` is `None` when `profit_factor` is undefined (no losing day);
  `probabilistic_sharpe_ratio` is `> 0.5` (a positive-Sharpe series). Every one of these must be
  asserted from economics, never from the implementation's own output, and each must be observed
  RED against the unfixed code first (neuter → RED → restore). The researcher confirms each invariant
  against the 0.0.81 formula and may SHARPEN one (with evidence), not weaken it.

### Gate (success criterion 3)

- **D-14: The region gate is rewritten as an AST walk over every production module that imports
  quantstats** (today only `services/metrics.py`, P-2), not a line scan over one function. It must see
  `qs.stats.X(...)` calls, the `getattr(qs.stats, <name>)` dispatch shape (resolving the dispatched
  names from `_QSTATS_SINGLE_ARG_SCALARS`), aliased references (`fn = qs.stats.X`), and it must fail if
  a NEW production module imports quantstats without being covered. It keeps the anti-vacuity count
  (`scanned > 0`) and prints its census (D-07). It is PROVEN able to fail: reintroduce an unclosed call
  at each shape (direct call, getattr dispatch, `_rolling_alpha_beta`), observe RED naming the site,
  restore — recorded in the SUMMARY. It stays a pytest in `analytics-service/tests/` so the existing
  python CI job runs it.

### Disclosure of changed values (success criterion 5)

- **D-10: Every corrected value is named with before and after.** The SUMMARY carries a table: metric
  key, fixture, before, after, reason — for the trigger fixture AND for every golden/parity fixture
  byte that moves. A fixture that moves without a row in that table is a defect. The benign fixtures
  are expected NOT to move (the heuristic cannot fire on them); any movement there is investigated,
  not re-baselined.
- **D-11: This phase changes code only; it does not recompute or backfill PRODUCTION rows.** Existing
  `strategy_analytics.metrics_json` values computed before the fix stay until each strategy's next
  compute (and ledger venues never re-compute on their own — project memory). No remote database is
  touched by this phase. The affected population is characterisable in SQL (a returns series that is
  all-non-negative with at least one day ≥ 100%, or such a benchmark), and the plan writes that
  read-only census query into the SUMMARY for the founder to run; whether to trigger recomputes is
  OPEN-2.

### TODOS 0f KPI-array derivation

- **D-12: The KPI-array derivation carried by the ROADMAP is included as an independent TS plan,
  byte-neutral.** Derive `PERCENTILE_ANALYTICS_COLUMNS` (`src/lib/queries.ts`) and csv-finalize's
  `CLOCK_SAFETY_KPI_COLUMNS` (`src/app/api/strategies/csv-finalize/route.ts`) from ONE exported KPI
  array, with the resulting string/array values byte-identical to today (Phase 159 D-03 makes
  `PERCENTILE_ANALYTICS_COLUMNS` byte-unchanged BINDING) and the existing byte-freeze tests unchanged
  and green. If the researcher finds the two lists are not the same set by design, the plan records
  that and derives only what is genuinely shared — no forced unification.

### No UI work

- **D-13: No UI-SPEC.** No component, copy or layout changes. Some persisted scalars go from a wrong
  number to `None` (D-09); the researcher confirms every surface that reads these `metrics_json` keys
  already renders null as an absence (e.g. "—") and lists them. A surface that would render `None`
  as `0` or crash is a finding the plan fixes minimally, without new copy.

### Post-research amendment (2026-09-24, orchestrator, `--auto`) — decisions forced by `166-RESEARCH.md`

These settle the research Open Questions. Each cites the research section it rests on; none weakens
a decision above.

- **D-03 outcome (not a new decision — D-03's own rule applied):** the preparer-spy matrix
  (`166-RESEARCH.md` §Q2) shows `prepare_returns=False` is honoured by NONE of the eleven new sites
  (`recovery_factor`, `kelly_criterion`, `common_sense_ratio`, `cpc_index` transitively; the benchmark
  leg of `r_squared`, `greeks`, `rolling_greeks`; plus the four kwarg-less scalars). All eleven go to
  the inline arm. The "kwarg-closable" wording in `.planning/WINDOWS.md` entry 9 and the
  `159-05-SUMMARY.md` Residual table is REFUTED by measurement; the closing commit and SUMMARY say so.
  The D-14 gate allowlists named leaf FUNCTIONS, each pinned by a behavioural test — never the
  literal keyword text (research F-5).
- **D-15 — F-3 is fixed in this phase, disclosed under D-10.** Research measured a LIVE fabricated
  value introduced by Phase 159: 0.0.81 `greeks` ends in `.fillna(0)`, so since RANK-05 passed
  `prepare_returns=False` a NaN-bearing benchmarked series persists `alpha = 0.0`, `beta = 0.0`
  (rendered as `0.000` in the Benchmark greeks table; `treynor` silently disappears). This is a
  user-facing, data-integrity lie on the exact site D-05 inlines, so leaving it would ship a known
  wrong value through new code. The inlined greeks compute alpha/beta over PAIRWISE-COMPLETE
  observations (the convention the sibling `correlation` in the same M1 block already uses) and
  emit `None`, never `0.0`, when beta is undefined (fewer than 2 complete pairs or zero benchmark
  variance) — D-09's rule. NaN-free series stay bit-identical (research §Q3 parity 0.0). The
  NaN-bearing class gets its own before/after row. — **Reversibility:** reversible.
- **D-16 — F-2 (PSR kurtosis double-subtraction) is fixed in this phase, disclosed under D-10.**
  0.0.81 feeds pandas EXCESS kurtosis into a term that expects the non-excess fourth moment
  (`166-RESEARCH.md` §Q5 F-2, cited to Bailey & López de Prado), which makes live PSR `None` on a
  steadily winning series. Project rule: a finding that is not user-facing is fixed or dropped, never
  parked (PSR has no reader under `src/`, research §Q6), and the fix is one term inside a function
  this phase already mirrors. The PSR mirror uses the non-excess moment; its correctness anchor is an
  independent in-test computation of the published formula from sample moments, NOT live quantstats;
  the benign-fixture parity test for PSR is replaced by that anchor and the change is a D-10 row.
- **D-17 — F-4 (rolling alpha uses full-sample means) is fixed in this phase, disclosed under D-10.**
  0.0.81's `rolling_greeks` computes `alpha_t = mean(r_all) − β_t·mean(b_all)`, so the rendered
  `rolling_alpha` is a linear transform of rolling beta, not a windowed intercept. It is user-facing
  (`RollingAlphaBetaChart`), and routing it would leave a known-wrong rendered series for no gain,
  since `rolling_greeks` is inlined here anyway (D-06). The mirror computes the windowed intercept
  `mean_w(r) − β_t·mean_w(b)` over the same 90-day window, still UNANNUALIZED (Phase 34 note kept).
  `rolling_beta` is unchanged. The before/after is a D-10 row. — **Reversibility:** reversible.
  ⚠️ D-08 still binds everything else: F-1 (alpha annualized on the frequency clock) is RECORDED in
  the SUMMARY, not changed.
- **D-18 — D-12's single source is the existing exported `PERCENTILE_METRICS`
  (`src/lib/percentile-core.ts`)** (research §Q7: same seven columns, same order, already exported,
  no imports). No new array. Because no test pins either literal today ("byte-frozen" is prose-only),
  the D-12 plan FIRST adds a byte pin on the current `PERCENTILE_ANALYTICS_COLUMNS` string and
  `CLOCK_SAFETY_KPI_COLUMNS` array (observed GREEN on the literals, then still GREEN after derivation),
  so the derivation is proven byte-neutral rather than asserted.
- **D-19 — TS verification in a worktree uses a symlinked `node_modules`, tested.** Module resolution
  from a sibling worktree does not reach the main checkout's `node_modules` (research Open Q3), and
  `npm install` is forbidden (disk). The executor links the main checkout's `node_modules` into the
  worktree root before running `vitest`/`tsc` and removes the link before every commit (it must never
  be committed). Measured 2026-09-24: `./node_modules/.bin/vitest --version` resolves (`vitest/4.1.10`)
  through the link. A TS verify command that exits 127 or "command not found" is a FAIL, never a skip.
- **Recorded, not changed (D-08):** F-1 (greeks alpha annualized on the frequency clock), and
  `recovery_factor`'s arithmetic numerator vs `upi`'s compounded one. Both appear in the SUMMARY's
  findings list. Research's Phase-165 notes (`scipy` imported directly but only a transitive pin;
  `requirements.in` `pandas==2.2.3` vs lock `3.0.3`) are for Phase 165 and change nothing here.

### Claude's Discretion

- Plan/wave split, naming of the extracted primitives beyond the TODOS 0f names, and fixture helper
  shapes (a benchmark-leg trigger fixture is needed for D-03/D-05/D-06 and does not exist yet).

### Folded Todos

- **TODOS 0f `[159-SIMPLIFY-DEFER]`** — extract `_downside_rms` / `_annualized_vol_sharpe` before any
  third hand-copy (D-04), AST region gate (D-14), one exported KPI array (D-12). Folded because the
  ROADMAP carries it by name and the entry itself says to do it as part of this closure.
- **`.planning/WINDOWS.md` entries 5 and 9** (both `open`) — this phase is their closure; the plan
  closes both entries with the commit that lands the fix.

### OPEN — founder-owned, recorded as `checkpoint:decision`, NOT decided here

- **OPEN-1 — adopting an unreleased quantstats commit or a fork.** Only if research finds one that
  fixes both preparers. Taking a git-URL or forked dependency into production money math is a
  supply-chain and maintenance one-way door. The plan proceeds on D-01's default regardless; this
  only decides whether a later phase switches.
  ⭐ **MOOT after research (2026-09-24):** `166-RESEARCH.md` §Q1 found upstream `main` identical to
  `v0.0.81` and the only maintained fork carrying both heuristics — there is nothing to adopt, so
  OPEN-1 generates no checkpoint in this phase's plans.
- **OPEN-2 — recomputing existing PRODUCTION rows.** Whether to enqueue recomputes for strategies the
  D-11 census finds affected, and when. A PRODUCTION data write, visible in users' rows.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase definition and prior closure
- `.planning/ROADMAP.md` §"Phase 166: QSTATS-TRUTH" — goal, the five success criteria, TODOS 0f carry.
- `.planning/phases/159-rank-public-ranking-integrity/159-05-SUMMARY.md` — RANK-05 closure, the
  `cvar` divergence, §"Residual" table (the surface this phase closes).
- `.planning/phases/159-rank-public-ranking-integrity/159-CONTEXT.md` — D-03 (byte-unchanged
  `PERCENTILE_ANALYTICS_COLUMNS`), D-04 (kill the guess; no fork/pin).
- `.planning/phases/159-rank-public-ranking-integrity/159-RESEARCH.md` §RANK-05 — the inline-mirror
  excerpts and 0.0.81 source citations.
- `.planning/WINDOWS.md` entries 5 and 9 — the measured wrong values and the gate-blindness finding.
- `TODOS.md` entry 0f `[159-SIMPLIFY-DEFER]`.

### Code
- `analytics-service/services/metrics.py` — `compute_all_metrics` (the closed RANK-05 sites and their
  docblocks), `_QSTATS_SINGLE_ARG_SCALARS`, `_safe_qstats_scalar`, `compute_qstats_scalars`,
  `_rolling_alpha_beta`, `sharpe_vol_status_from_backbone` (the annualized Sharpe/vol spelling TODOS 0f
  names). Cite by symbol; line numbers drift.
- `analytics-service/tests/test_metrics.py` — the RANK-05 section: `_rank05_trigger_series`,
  `_rank05_benign_all_positive`, `_rank05_benign_mixed`, the parity tests, and the gate to be replaced,
  `test_rank05_no_unclosed_quantstats_call_survives_in_compute_all_metrics`.
- `analytics-service/requirements.in`, `analytics-service/requirements-dev.txt` — the 0.0.81 pins.
- Installed quantstats source (`quantstats/_utils.py` `_prepare_returns`, `_prepare_prices`,
  `_prepare_benchmark`; `quantstats/stats.py`) inside the analytics-service venv — the mirror source.
- `src/lib/queries.ts` `PERCENTILE_ANALYTICS_COLUMNS`; `src/app/api/strategies/csv-finalize/route.ts`
  `CLOCK_SAFETY_KPI_COLUMNS` (D-12).
- `src/lib/factsheet/compute.ts` — null-not-zero precedent for undefined ratios (D-09).

### Project rules
- `CLAUDE.md` (repo) — gate integrity, CHANGELOG discipline, `drift_subjects` not `covered_files`.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- The inline drawdown mirror in `compute_all_metrics` (RANK-05 "WHY INLINE" block): the source for the
  extracted drawdown-series primitive that `ulcer_index` / `serenity_index` / `recovery_factor` need.
- The inline sharpe/sortino/smart-* mirrors: the source for `_downside_rms` / `_annualized_vol_sharpe`.
- `_safe_qstats_scalar` / `_safe_float` / `_should_emit_traceback`: the failure-soft contract every
  new mirror must keep (one failing scalar never takes down the others; a WARNING names it).
- `_QstatsScalarKey` Literal union: a new dispatch shape must keep its type-level typo guard.

### Established Patterns
- P114 inline mirror with a docblock citing the exact 0.0.81 source — the 159 house style.
- Economic-invariant tests + live-quantstats parity on benign fixtures + shuffle invariance for
  order-independent statistics — the 159 test triad.
- Neuter → observe RED → restore for any gate (project memory, test anti-vacuity discipline).

### Integration Points
- `compute_all_metrics` → `metrics_json.update(compute_qstats_scalars(...))` → `strategy_analytics.metrics_json`.
- `compute_all_metrics` → `sibling_kinds["rolling_alpha" / "rolling_beta"]` → `strategy_analytics_series`
  → `RollingAlphaBetaChart` (rendered).

</code_context>

<specifics>
## Specific Ideas

- The trigger fixture for criterion 4 is `_rank05_trigger_series` exactly — "the same fixture that
  produced them". A benchmark-leg trigger (an all-non-negative benchmark with a ≥100% day) is added
  for D-03/D-05/D-06.
- Before/after values for the SUMMARY table start from P-1's readings.

</specifics>

<deferred>
## Deferred Ideas

- Removing quantstats from the production requirements (D-02) — belongs with Phase 165's dependency
  campaign once every site is closed or mirrored.
- Adopting a fork or unreleased fix (OPEN-1) and recomputing PRODUCTION rows (OPEN-2) — founder calls.

</deferred>

---

*Phase: 166-qstats-truth-every-quantstats-derived-number-reflects-the-returns-it-was-given*
*Context gathered: 2026-09-24 (`--auto`)*
