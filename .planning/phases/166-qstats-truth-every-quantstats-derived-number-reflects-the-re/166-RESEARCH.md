# Phase 166: QSTATS-TRUTH — every quantstats-derived number reflects the returns it was given - Research

**Researched:** 2026-09-24 (worktree HEAD `a1d479c22`, branch `feat/166-qstatstruth`)
**Domain:** Python money math (pandas / numpy / scipy / quantstats 0.0.81) in `analytics-service/services/metrics.py`; one Python AST gate; one small TS constant derivation
**Confidence:** HIGH (every mechanism claim below was measured this session against the installed 0.0.81 source, and every proposed mirror was prototyped and measured bit-exact against live quantstats)

<user_constraints>
## User Constraints (from CONTEXT.md)

The block below is copied VERBATIM from `166-CONTEXT.md` §`<decisions>` (Measured premises, Library shape,
Closure mechanism, Money-math rules, Gate, Disclosure, KPI-array derivation, No UI work, Claude's
Discretion, Folded Todos, OPEN). Deferred ideas follow it, also verbatim.

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
- **OPEN-2 — recomputing existing PRODUCTION rows.** Whether to enqueue recomputes for strategies the
  D-11 census finds affected, and when. A PRODUCTION data write, visible in users' rows.

### Deferred Ideas (OUT OF SCOPE) — verbatim from CONTEXT.md `<deferred>`

- Removing quantstats from the production requirements (D-02) — belongs with Phase 165's dependency
  campaign once every site is closed or mirrored.
- Adopting a fork or unreleased fix (OPEN-1) and recomputing PRODUCTION rows (OPEN-2) — founder calls.

### Research findings that bear on a locked decision (reported, NOT silently applied)

| Decision | What research found | Effect |
|---|---|---|
| D-03 | The kwarg is **not** honoured transitively by **any** of the four "kwarg-capable" dispatched scalars (`recovery_factor`, `kelly_criterion`, `common_sense_ratio`, `cpc_index`), nor on the **benchmark** leg of `r_squared` / `greeks` / `rolling_greeks`. Measured with a preparer spy (§Q2). | D-03's own rule sends **all eleven** new sites to the inline arm. The "kwarg-proven" arm gains **no** site from compute_qstats_scalars / greeks / rolling_greeks. `WINDOWS.md` entry 9 and the 159-05 SUMMARY "Residual" table both call these "kwarg-closable" — that claim is **refuted** by measurement and the closing commit should say so. |
| D-04 | `_downside_rms` has **no consumer among the new mirrors** (PSR's base is a non-annualized *Sharpe*, not Sortino; no other dispatched scalar uses downside RMS). TODOS 0f's "will need a THIRD copy" premise is true for the drawdown primitive and for Sharpe, not for downside RMS. | D-04's order still binds (extract first). Extracting `_downside_rms` is then a pure dedup of the two existing copies (headline `sortino`, `smart_sortino`), not a prerequisite. Not overridden — reported. |
| D-09 | Invariants confirmed against the 0.0.81 formulas. **Sharpened**: on the canonical trigger, `kelly_criterion` and `cpc_index` are *already* `None` (for the wrong reason), so an invariant on them cannot be observed RED there. A second, **non-monotone** all-winning trigger makes them (and `common_sense_ratio`) RED. See §Q4. | Add one fixture; strengthens, does not weaken, D-09. |
| D-05 | Inlining `greeks` exposes a **live defect introduced by RANK-05**: 0.0.81's `greeks` ends in `.fillna(0)`, and since 159 passed `prepare_returns=False` the strategy leg keeps its NaN days, so a NaN-bearing benchmarked series now persists **`alpha = 0.0`, `beta = 0.0`** (fabricated zeros, rendered in the Benchmark greeks table). Measured §Q5/F-3. | D-08/D-09 tension the planner must resolve explicitly (recommendation in §F-3). |
| D-12 | The two lists are the same set **by design** (the prose says so at three sites), and a **fourth** copy already exists and is already **exported**: `PERCENTILE_METRICS` in `src/lib/percentile-core.ts` (same seven, same order). No test pins either literal byte-for-byte; "byte-frozen" is prose-only. | The derivation source is `PERCENTILE_METRICS`; no new array needed (§Q7). |
</user_constraints>

<phase_requirements>
## Phase Requirements

No formal REQUIREMENTS.md IDs (ROADMAP: "Requirements: TBD"). The five ROADMAP success criteria stand in,
plus the folded ledger items.

| ID | Description | Research Support |
|----|-------------|------------------|
| SC-1 | Upgrade-vs-mirror decided on evidence | §Q1: PyPI latest = 0.0.81; upstream `main` is **identical** to tag `v0.0.81`; heuristic present on `main`; the one maintained fork (`quantstats-lumi` 1.1.5) carries both heuristics; two open unmerged upstream PRs touch `_prepare_prices` only and neither fixes the guess. → D-01 default path; OPEN-1 has nothing to adopt. |
| SC-2 | Every `qs.stats.*` site closed or excluded with a printed reason | §Q2 kwarg matrix + §Census (9 AST nodes / 16 functions today → 5 surviving nodes after the fix, each with an arm and reason); 30-vs-9 reconciliation reproduced. |
| SC-3 | AST gate that sees getattr dispatch + `_rolling_alpha_beta`, proven able to fail | §Pattern 3 (gate spec) + red/green self-test fixtures per call shape. |
| SC-4 | Measured wrong values gone on the same fixture, asserted against economics | §Q4 before/after table on `_rank05_trigger_series`; invariants derived from formulas, each observed RED on live code. |
| SC-5 | Every corrected persisted value named with before/after | §Q4 tables (canonical trigger, non-monotone trigger, benchmark trigger, NaN-bearing greeks); benign/golden fixtures measured **not** to move (rel diff 0.0). |
| TODOS 0f | Extract primitives before a third hand-copy; AST gate; one KPI array | §Pattern 1 (primitives), §Pattern 3 (gate), §Q7 (KPI array). |
| WINDOWS 5, 9 | Close both | Both closed by the fix commit; entry 9's "kwarg-closable" sentence is refuted (§Q2) and the closure note should say so. |
</phase_requirements>

## Summary

The defect is exactly as CONTEXT P-1 measured: re-running `compute_qstats_scalars(_rank05_trigger_series(), None)` at HEAD returns `recovery_factor=2.0737188382869305`, `ulcer_index=0.9947130555497081`, `upi=2.9998728744771372`, `probabilistic_sharpe_ratio=0.1531252134903383`, `common_sense_ratio=0.0`, `serenity_index=0.3204442673452879`, `kelly_criterion=None`, `cpc_index=None` [VERIFIED: in-env probe, 2026-09-24]. There is no upstream escape: quantstats `main` is byte-identical to `v0.0.81`, and both the upstream code and the only maintained fork still carry `elif data.min() >= 0 and data.max() > 1: data = data.pct_change(...)` and `elif data.min() < 0 or data.max() < 1: data = to_prices(...)` [VERIFIED: GitHub compare API + contents API]. So the phase takes D-01's default: keep the pin, close every site ourselves.

The central finding is that **the `prepare_returns=` kwarg closes none of the new sites.** A preparer spy on the trigger fixture shows `recovery_factor(…, prepare_returns=False)` still guesses via `max_drawdown → _prepare_prices`; `kelly_criterion` via `payoff_ratio` and `win_rate`; `common_sense_ratio` via `profit_factor` and `tail_ratio`; `cpc_index` via `profit_factor`, `win_rate` and `payoff_ratio`; and `r_squared` / `greeks` / `rolling_greeks` all route the **benchmark** through `_prepare_benchmark → _prepare_returns` unconditionally. Only leaf functions honour the kwarg (`profit_factor`, `tail_ratio`, `win_rate`, `avg_win`, `avg_loss`, `value_at_risk`, `volatility`, `skew`, `kurtosis` — zero preparer calls with `prepare_returns=False`); `payoff_ratio`/`win_loss_ratio` do **not** (they call `avg_win`/`avg_loss` without forwarding). So every one of the 8 dispatched scalars, `r_squared`, the `greeks` benchmark leg and `rolling_greeks` goes to the inline arm, built on (a) extracted module primitives and (b) the kwarg-proven leaves.

Feasibility is proven, not argued: a prototype of every mirror ("quantstats 0.0.81 minus the guess" — `_prepare_returns` reduced to its `inf→NaN→fillna(0)` cleanup, `_prepare_prices` reduced to unconditional `to_prices`, `_prepare_benchmark` kept intact minus the guess) matches **live** quantstats with **relative difference 0.0** on every scalar and every rolling point across five benign fixtures — including `golden_252d` (the parity-test fixture), a 3-NaN-day series, and a weekday-strategy vs 7-day-benchmark calendar mismatch — while producing the economically correct values on the trigger fixtures. So the benign/golden fixtures will not move by a single ulp, and the only persisted values that change are trigger-shaped ones (plus the NaN-greeks defect, if the planner fixes it).

**Primary recommendation:** Keep quantstats 0.0.81. Extract the drawdown-series, annualized-Sharpe/vol, downside-RMS and CVaR-tail primitives first (D-04), add one `_align_benchmark_like_qs` primitive, then replace the `getattr(qs.stats, …)` dispatch, `qs.stats.r_squared`, the `greeks` call and the `rolling_greeks` call with mirrors that reproduce 0.0.81's expression order exactly (bit parity with the golden JSON) minus the two guesses. Replace the line gate with an AST gate whose allowlists are **named sites pinned by behavioural tests**, not a kwarg-presence check.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Scalar money math (8 scalars + r_squared + alpha/beta) | API / Backend (Python worker `services/metrics.py`) | — | `compute_all_metrics` → `metrics_json.update(compute_qstats_scalars(...))` is the only writer of these keys |
| Rolling alpha/beta series | API / Backend (`_rolling_alpha_beta`) | Database (`strategy_analytics_series`) | Emitted as sibling kinds, persisted via the batch RPC, read by the chart |
| Rendering of alpha/beta and rolling series | Browser / Client (`BenchmarkGreeksTable`, `RollingAlphaBetaChart`) | Frontend Server (`getStrategyDetailV2` panel7 projection) | Already null-safe (§Q6); no change |
| AST gate | CI (pytest in `analytics-service/tests/`, python job) | — | D-14: stays a pytest |
| KPI array derivation | Frontend Server + API route (`src/lib/queries.ts`, csv-finalize route) | `src/lib/percentile-core.ts` (pure, import-free) | Constant composition only |
| Affected-population census | Database (read-only SQL, founder-run) | — | D-11: no remote touched by this phase |

## Q1 — Is 0.0.81 current, and is there an upstream or fork fix?

| Check | Result | Tag |
|---|---|---|
| PyPI latest | `0.0.81`, uploaded 2026-01-13; previous `0.0.77` (2025-09-05) | [VERIFIED: pypi.org/pypi/quantstats/json] |
| Upstream default branch | `main`; `compare v0.0.81...main` → `status: identical, ahead_by: 0, behind_by: 0`. Last commit on `main` is `fbd10daed0` (2026-01-13) | [VERIFIED: GitHub API, 2026-09-24] |
| Heuristic on `main` | `quantstats/utils.py` on `main` still contains `elif data.min() < 0 or data.max() < 1:` and `elif data.min() >= 0 and data.max() > 1:` | [VERIFIED: GitHub contents API] |
| `dev` branch | diverged (1 ahead / 108 behind `main`), last commit 2025-03-31, still carries both heuristics | [VERIFIED: GitHub API] |
| Upstream issue history | #7 "Problem when daily return >= 100%" (2019) — exactly this defect; closed "Fixed in 0.0.21", but the fix only changed `and`→`or` in `_prepare_prices`, which does not help an all-non-negative series | [VERIFIED: GitHub issue #7] |
| Open upstream PRs | #541 "Fix max_drawdown inventing drawdowns for price series" (the `_get_baseline_value` ladder — the divergence 159 already pinned at 1.0) and #545 "`_prepare_prices` fills a missing price with 0". Both **open, unmerged**, neither removes the returns-vs-prices guess | [VERIFIED: GitHub API] |
| Maintained fork | `quantstats-lumi` (PyPI 1.1.5, 2026-06-01; repo pushed 2026-09-09, 152 stars) — **both heuristics present** in its utils | [VERIFIED: PyPI JSON + GitHub contents API] |
| Other forks | Newest-30 and top-10-by-stars forks: none maintained with releases; none identified as fixing the guess | [VERIFIED: GitHub forks API; absence of a fix across unlisted forks is not asserted] |

**Conclusion (D-01 rule):** no PyPI release fixes either path; no unreleased commit or fork fixes it → "Nothing found → proceed on the default." OPEN-1 has no candidate to decide. D-02 stands: quantstats stays, as a kwarg-closed dependency (5 surviving nodes, §Census) and as the live parity oracle.

**For Phase 165 (not this phase):** `scipy` is **transitive-only** (`requirements.txt`: `scipy==1.18.0  # via quantstats`), yet `services/portfolio_metrics.py` and `services/optimizer.py` already import it directly, and this phase's mirrors add `scipy.stats` (`norm`, `linregress`) to `services/metrics.py`. Removing quantstats would break all three unless `scipy` is promoted into `requirements.in` [VERIFIED: requirements.txt + grep]. Also observed, out of scope: `requirements.in` pins `pandas==2.2.3` while the lock pins `pandas==3.0.3` "via -r requirements.in" [VERIFIED: both files] — a `.in`/lock drift for Phase 165 to adjudicate.

## Q2 — Does `prepare_returns=False` behaviourally remove the guess? (the D-03 matrix)

Method: wrap `quantstats.utils._prepare_returns` / `_prepare_prices` with a spy that records the caller and whether the guess condition fired, then call each function on the RANK-05 trigger fixture (and a benign strategy against an all-non-negative benchmark with a +150% day). Source read from the installed 0.0.81 `quantstats/stats.py` and `quantstats/utils.py` [VERIFIED: inspect.getsource in-env].

| Function | `prepare_returns=` in signature | Preparer calls observed with `prepare_returns=False` | Guess still fires? | Arm |
|---|---|---|---|---|
| `recovery_factor` | yes | `_prepare_prices` from `max_drawdown` | **YES** (returns `1.9733`, still wrong) | **inline** |
| `kelly_criterion` | yes | `_prepare_returns` from `payoff_ratio`, `win_rate` | **YES** | **inline** |
| `common_sense_ratio` | yes | `_prepare_returns` from `profit_factor`, `tail_ratio` | **YES** (returns `0.0`) | **inline** |
| `cpc_index` | yes | `_prepare_returns` from `profit_factor`, `win_rate`, `payoff_ratio` | **YES** | **inline** |
| `ulcer_index` | **no** | `_prepare_prices` from `to_drawdown_series` | YES | inline |
| `ulcer_performance_index` | **no** | same | YES | inline |
| `probabilistic_ratio` | **no** | `_prepare_returns` from `sharpe` | YES | inline |
| `serenity_index` | **no** | `_prepare_prices` ×2 (`to_drawdown_series`) + `cvar`/`value_at_risk` on the dd series (cannot fire: dd ≤ 0) | YES | inline |
| `r_squared` | yes | strategy leg closed; benchmark: `_prepare_benchmark` → `_prepare_returns` **twice** (it prepares the benchmark, then prepares it again inside the `linregress` call) | **YES on benchmark leg** | **inline** |
| `greeks` | yes | benchmark: `_prepare_benchmark` → `_prepare_returns` | **YES on benchmark leg** | **inline** (D-05) |
| `rolling_greeks` | yes | benchmark: `_prepare_benchmark` → `_prepare_returns` | **YES on benchmark leg** | **inline** (D-06) |

Kwarg-honouring **leaves** (zero preparer calls with `prepare_returns=False`, trigger fixture): `profit_factor`, `tail_ratio`, `win_rate`, `avg_win`, `avg_loss`, `value_at_risk`, `volatility`, `skew`, `kurtosis`. **Not** honoured: `payoff_ratio`, `win_loss_ratio` (both call `avg_loss(returns)` / `avg_win(returns)` without forwarding the kwarg), and `cvar` (159's finding, still true) [VERIFIED: spy probe].

Note `_prepare_benchmark(benchmark, period, rf=0.0, prepare_returns=True)` itself has a `prepare_returns` parameter, but none of `r_squared`/`greeks`/`rolling_greeks` forward theirs to it [VERIFIED: 0.0.81 source]. Calling the private `_prepare_benchmark(..., prepare_returns=False)` from our code is possible but would put a private quantstats symbol in production and in the gate; the mirror below reproduces it in eight lines of pandas instead.

## Q3 — 0.0.81 formulas, and what each mirror is built on

Quoted from the installed 0.0.81 source (docstrings stripped) [VERIFIED: inspect.getsource]. `P(r)` below means "`_prepare_returns(r)` minus the guess" = `r.replace([inf,-inf], nan).fillna(0)` (rf = 0 path); `DD(r)` means `to_drawdown_series` minus the guess.

| Scalar (metrics_json key) | 0.0.81 formula, exactly | Mirror built on |
|---|---|---|
| `recovery_factor` | `r = P(r); total = r.sum() - rf; max_dd = max_drawdown(r); NaN if max_dd == 0 else abs(total)/abs(max_dd)` — note the numerator is an **arithmetic sum**, not a compounded return | extracted drawdown primitive (`max_dd` of the wealth curve of `P(r)`) |
| `ulcer_index` | `dd = to_drawdown_series(r); sqrt((dd**2).sum() / (r.shape[0] - 1))` — `r` is **raw** (denominator counts NaN rows) | drawdown primitive |
| `upi` (`ulcer_performance_index`) | `u = ulcer_index(r); NaN if u == 0 else (comp(r) - rf) / u`, `comp(r) = r.add(1).prod() - 1` on **raw** `r` (skipna prod ≡ fillna(0)) | the `ulcer_index` mirror |
| `kelly_criterion` | `r = P(r); wl = payoff_ratio(r); wp = win_rate(r); NaN if wl == 0 or isna(wl) else ((wl*wp) - (1-wp)) / wl`; `payoff_ratio = avg_win / abs(avg_loss)` (NaN if `avg_loss == 0`); `avg_win = r[r>0].dropna().mean()`, `avg_loss = r[r<0].dropna().mean()`; `win_rate = len(r[r>0]) / len(r[r!=0])` (0.0 if no non-zero) | kwarg-proven leaves `avg_win`, `avg_loss`, `win_rate` with `prepare_returns=False` on `P(r)`, plus a 3-line payoff composition (payoff itself must NOT be called via qs — not honoured) |
| `probabilistic_sharpe_ratio` (`probabilistic_ratio`, base "sharpe") | `base = sharpe(r, periods=252, annualize=False)` = `P(r).mean() / P(r).std(ddof=1)`; `skew = r.skew()`, `kurt = r.kurtosis()` on **raw** `r` (pandas; kurtosis is **excess**); `n = len(r)` raw; `sigma = sqrt((1 + 0.5*base**2 - skew*base + ((kurt-3)/4)*base**2) / (n-1))`; `psr = norm.cdf((base - rf)/sigma)` | `_annualized_vol_sharpe(P(r), periods_per_year=1)` gives `mean/std` bit-identically (×1 and ×√1 are exact); `scipy.stats.norm.cdf` |
| `common_sense_ratio` | `r = P(r); profit_factor(r) * tail_ratio(r)`; `profit_factor = r[r>=0].sum() / abs(r[r<0].sum())`, returning `inf` when there are wins and no losses, `0.0` when neither; `tail_ratio = abs(q95/q05)`, NaN if `q05 == 0` | kwarg-proven leaves `profit_factor`, `tail_ratio` with `prepare_returns=False` on `P(r)` (same mechanism `compute_all_metrics` already uses — no second implementation) |
| `cpc_index` | `r = P(r); profit_factor(r) * win_rate(r) * win_loss_ratio(r)` (`win_loss_ratio = payoff_ratio`) | same leaves + the shared payoff composition |
| `serenity_index` | `dd = to_drawdown_series(r); sd = r.std()` (**raw**, skipna); `NaN if sd == 0`; `pitfall = -cvar(dd) / sd`; `den = ulcer_index(r) * pitfall`; `NaN if den == 0 else (r.sum() - rf) / den` — `cvar(dd)` = mean of `dd[dd < VaR]` falling back to VaR, `VaR = norm.ppf(0.05, dd.mean(), dd.std())` | drawdown primitive + the extracted CVaR-tail primitive (from the existing inline `cvar` block in `compute_all_metrics`) + `qs.stats.value_at_risk(dd, confidence=0.95, prepare_returns=False)` (kwarg-proven, already allowlisted) |
| `r_squared` | `r = P(r); b = _prepare_benchmark(bm, r.index); _, _, rv, _, _ = linregress(r, _prepare_benchmark(b, r.index)); rv**2` | `_align_benchmark_like_qs` primitive called twice exactly as qs does; `scipy.stats.linregress` |
| `alpha`/`beta` (`greeks`) | strategy leg as passed (production passes `prepare_returns=False` → raw); `b = _prepare_benchmark(bm, r.index)`; `m = np.cov(r, b)`; `beta = NaN if m[1,1]==0 else m[0,1]/m[1,1]`; `alpha = (r.mean() - beta*b.mean()) * periods`; `Series({beta, alpha}).fillna(0)` | `_align_benchmark_like_qs` + numpy; see F-3 for the `fillna(0)` decision |
| `rolling_alpha`/`rolling_beta` (`rolling_greeks`) | `r = P(r)` (production passes no kwarg); `df = DataFrame({returns: r, benchmark: _prepare_benchmark(bm, r.index)}).fillna(0)`; `corr = df.rolling(w).corr().unstack()["returns"]["benchmark"]`; `std = df.rolling(w).std()`; `beta = corr*std.returns / std.benchmark.replace(0, NaN)`; `alpha = df.returns.mean() - beta*df.benchmark.mean()` (**full-sample means**, see F-4); `periods` is the window | `_align_benchmark_like_qs` + the same pandas ops |

`_prepare_benchmark` minus the guess (the one new primitive) [VERIFIED: 0.0.81 source]: if `set(period) != set(benchmark.index)`: `prices = to_prices(benchmark, base=1)`, `reindex(date_range(period[0], period[-1], freq="D"), method="bfill").reindex(period).pct_change(fill_method=None).fillna(0)`, keep `index ∈ period`; then tz-normalize; then `P(benchmark.dropna())`. In production `compute_qstats_scalars` is called with the **unaligned** strategy series and the 1000-day BTC benchmark, so for `r_squared` the reindex branch runs on **every** benchmarked strategy (`set` equality is false whenever the benchmark spans more dates) — the mirror must reproduce it or `r_squared` moves for everyone.

### Prototype parity (the load-bearing evidence)

A research prototype of all eleven mirrors, written to reproduce the 0.0.81 expression order, compared with live quantstats [VERIFIED: in-env probe]:

| Fixture | 8 scalars | r_squared | greeks α/β | rolling α/β (90d, every point) |
|---|---|---|---|---|
| `golden_returns` + `benchmark_returns` (conftest) | rel diff **0.0** ×8 | 0.0 | 0.0 / 0.0 | max rel 0.0 (411 pts) |
| `golden_252d_input.parquet` (the METRICS-13 parity fixture) | 0.0 ×8 | 0.0 | 0.0 / 0.0 | 0.0 (163 pts) |
| `_rank05_benign_mixed` | 0.0 ×8 | — | — | — |
| weekday strategy vs 7-day benchmark (reindex branch) | 0.0 ×8 | 0.0 | 0.0 / 0.0 | 0.0 (161 pts) |
| `golden_returns` with 3 NaN days | 0.0 ×8 | 0.0 | 0.0 / 0.0 | 0.0 (411 pts) |

Also measured: `compute_all_metrics`' existing inline drawdown form `(c / c.cummax().clip(lower=1.0) - 1).replace([inf,-inf,-0.0], 0.0)` with `c = (1 + r.fillna(0)).cumprod()` equals `qs.stats.to_drawdown_series` with **max abs diff 0.0**, and `ulcer_index` built on it has rel diff 0.0, on all five fixtures — so the extracted drawdown primitive can serve both the chart and the ulcer family without a parity cost.

## Q4 — Economic invariants (D-09), confirmed and sharpened; before/after values

### Canonical trigger `_rank05_trigger_series` (60 bdays, day 1 = +150%, then `linspace(0.012, 0.004)`)

| Key | Before (live, HEAD) | After (prototype mirror) | Invariant | Derivation from the formula | RED on live? |
|---|---|---|---|---|---|
| `ulcer_index` | 0.9947130555497081 | **0.0** | `== 0` exactly | no losing day ⇒ wealth curve monotone ⇒ `dd ≡ 0` ⇒ `sqrt(0/(n-1)) = 0` | yes |
| `recovery_factor` | 2.0737188382869305 | **None** | `None` | denominator `max_dd == 0` ⇒ qs returns NaN ⇒ `_safe_float` → None | yes |
| `upi` | 2.9998728744771372 | **None** | `None` | denominator ulcer `== 0` ⇒ NaN | yes |
| `serenity_index` | 0.3204442673452879 | **None** | `None` | `ulcer == 0` ⇒ denominator `0 * pitfall`; VaR of an all-zero dd is `norm.ppf(0.05, 0, 0) = NaN` ⇒ NaN either way | yes |
| `common_sense_ratio` | 0.0 | **None** | `None` when no losing day | `profit_factor = +inf` (wins, zero losses) ⇒ `inf * tail` ⇒ `_safe_float(inf)` → None | yes |
| `probabilistic_sharpe_ratio` | 0.1531252134903383 | **0.9999630294673815** | `> 0.5` | `PSR = Φ(base/σ)`, `base = mean/std > 0` for an all-positive series ⇒ `PSR > 0.5` whenever σ is real | yes |
| `kelly_criterion` | None | None | `None` | `avg_loss` of an empty set = NaN ⇒ payoff NaN ⇒ NaN | **no — already None (wrong reason)** |
| `cpc_index` | None | None | `None` | `inf * 1.0 * NaN = NaN` | **no** |

**Sharpening (with evidence).** Because live `kelly_criterion`/`cpc_index` are already `None` on the canonical fixture (the guessed series has no positive day, so `avg_win` is NaN), their invariants cannot be observed RED there — violating D-09's "observed RED first" for those two. Add a **non-monotone** all-winning trigger (proposed helper name `_q166_trigger_nonmonotone`: 60 bdays from 2024-01-01, `0.004` on even rows, `0.02` on odd rows, row 0 = `1.5`). Measured [VERIFIED: in-env probe]:

| Key | Before (live) | After | RED on live? |
|---|---|---|---|
| `recovery_factor` | 92.05882352941175 | None | yes |
| `ulcer_index` | 0.9919239385213344 | 0.0 | yes |
| `upi` | 4.117455241335786 | None | yes |
| `kelly_criterion` | 0.3890395480225989 | None | **yes** |
| `probabilistic_sharpe_ratio` | 0.9997018052168664 | 0.9999999995117091 | no (both > 0.5) |
| `common_sense_ratio` | 23.98015435501653 | None | yes |
| `cpc_index` | 11.695887516415286 | None | **yes** |
| `serenity_index` | 0.36207650738764285 | None | yes |

A **shuffle test** is a formula-free detector for the order-independent scalars (PSR, kelly, csr, cpc): permuting this fixture moves live `kelly` 0.389→0.485, `csr` 23.98→166.96, `cpc` 11.70→557.49, `PSR` 0.99970→0.99513 — the 159 house pattern (`test_rank05_order_independent_statistics_survive_a_shuffle`) extends directly. ulcer/upi/serenity/recovery are path-dependent and must not be in the shuffle set.

**Benign parity anchor (what live quantstats returns today, and what must stay):** on `_rank05_benign_mixed`, live: `recovery_factor=0.9517263110721105`, `ulcer_index=0.09511182002853455`, `upi=1.583422458226051`, `kelly_criterion=0.06044860544137644`, `probabilistic_sharpe_ratio=0.7693296699257343`, `common_sense_ratio=1.2710944312227488`, `cpc_index=0.6338794871802247`, `serenity_index=0.143686058754821`. The committed golden (`golden_252d_expected.json`) carries `recovery_factor 0.1807251739470478`, `ulcer_index 0.13339796931864364`, `upi 0.16179844081267633`, `kelly_criterion 0.017170345942251242`, `probabilistic_sharpe_ratio 0.5815691494050974`, `common_sense_ratio 0.9914493068835851`, `cpc_index 0.5090142556782696`, `serenity_index 0.019258489731125872`, `r_squared 0.0016622195221271503`, `alpha 0.03903913128463262`, `beta 0.022877038598508564` [VERIFIED: file read]. The prototype reproduces all of them at rel diff 0.0.

### Benchmark-leg trigger (new fixture, D-03/D-05/D-06)

Strategy = benign `normal(0.0006, 0.013, 250)` (seed 15905, 250 bdays); benchmark = `[1.5] + linspace(0.02, 0.001, 249)` on the same index (all-non-negative, +150% day) [VERIFIED: in-env probe]:

| Quantity | Before (live) | After (mirror) | Economic anchor (non-self-referential) |
|---|---|---|---|
| `r_squared` | 0.006670639650444322 | 0.0037210240094842093 | `== aligned_returns.corr(aligned_benchmark)**2` = 0.0037210240094842067 (R² of a one-regressor OLS is the squared Pearson correlation) — use `rel=1e-12` |
| `beta` (greeks, `prepare_returns=False`) | −0.015400848308443902 | 0.007651507459018336 | `== cov(r,b)/var(b)` on the raw aligned pair |
| `alpha` | 0.12212418616146373 | 0.1516558141912828 | `== (mean(r) − β·mean(b))·periods` |
| rolling β, last point | −0.08887237598396791 | −0.7554623350323423 | `== rolling cov/var` of the raw pair over the last 90 rows |
| rolling α, last point | −0.0006752004065154814 | 0.013161136406196155 | see F-4 |

Joint (pairwise) permutation is also a valid detector: `beta`, `r_squared` are invariant under permuting the (r, b) **pairs**; the guess (a `pct_change` of the benchmark) is not.

**Reachability of the benchmark leg in production:** the only benchmark is BTC daily returns (`services/benchmark.py` `get_benchmark_returns`, `symbol != "BTC"` raises) [VERIFIED: file read]. A BTC window that is all-non-negative **and** contains a ≥ +100% day is not a realistic market event, so the benchmark-leg closure is correctness-by-construction and gate completeness, not a live-value fix. The D-11 census should still measure it (query below) rather than assume it.

## Q5 — Annualization at each closed site (findings recorded, not silently fixed — D-08)

Project rules: crypto √365 / traditional √252; RISK on frequency, RETURN/CAGR on CALENDAR; blend 365 if any leg is crypto (`periods_per_year_for_asset_class`, `_CALENDAR_DAYS_PER_YEAR` in `services/metrics.py`).

| Site | periods used today | Verdict |
|---|---|---|
| recovery_factor, ulcer_index, upi, kelly, csr, cpc, serenity, r_squared | none (dimensionless / total-return based) | No annualization → no violation. Note: `recovery_factor`'s numerator is `sum(returns)` (arithmetic) while `upi` uses the compounded `comp(returns)` — a quantstats convention inconsistency, recorded, not changed. |
| `probabilistic_ratio` | default `periods=252` | **No effect.** With `rf = 0` and `annualize=False`, `periods` only feeds rf de-annualization in `_prepare_returns`, which is skipped. Measured: PSR identical at 252 and 365 on `_rank05_benign_mixed` (0.7693296699257343 both). Mirror need not take a periods argument. |
| `greeks` alpha | `periods_per_year` (365 crypto / 252 traditional) | Alpha is `mean excess × periods` — an arithmetic RETURN annualized on the FREQUENCY clock. The TWR-05 docblock lists Sharpe/vol/Sortino/rolling/TE-IR as frequency-clock, and is silent on alpha. **Finding F-1 (LOW):** for a sparse series (rows < calendar days) this differs from a calendar-clock return. Pinned today by `test_metrics_parity.py` (alpha rescales exactly ×365/252). Record; do not change. |
| `rolling_greeks` | window only (`periods` arg = 90) | Unannualized by design (Phase 34 note in `_rolling_alpha_beta`). No violation. |
| `smart_sharpe` / `smart_sortino` (already closed in 159) | hardcoded 252 | Pre-existing; already recorded by 159. Not this phase. |

### Correctness findings surfaced by reading the formulas (record in SUMMARY; D-08 forbids silent fixes)

- **F-2 — PSR kurtosis double-subtraction (quantstats bug).** 0.0.81 feeds pandas **excess** kurtosis into `((kurt − 3)/4)·SR²`. Bailey & López de Prado's PSR uses the **non-excess** fourth moment γ₄ in `(γ₄ − 1)/4·SR²` [CITED: davidhbailey.com/dhbpapers/deflated-sharpe.pdf; en.wikipedia.org/wiki/Deflated_Sharpe_ratio]. Net: quantstats' variance term is short by `0.75·SR²/(n−1)`. Measured effect: small on typical series (`_rank05_benign_mixed`: 0.769330 vs 0.769147), but on `_rank05_benign_all_positive` the inner term goes **negative**, so live PSR is `None` for a steadily-winning series (the correct formula gives a real PSR ≈ 1). The mirror reproduces 0.0.81 (parity anchor); the correction is a separate, disclosed decision.
- **F-3 — `greeks` fabricates `alpha = 0.0, beta = 0.0` on NaN-bearing strategies (introduced by RANK-05).** 0.0.81's `greeks` ends in `.fillna(0)`. Before 159, `_prepare_returns` zero-filled the strategy leg; since 159 passes `prepare_returns=False`, a NaN day propagates through `np.cov` to NaN, and `.fillna(0)` turns it into a confident zero. Measured on `golden_returns` + `benchmark_returns` with 3 NaN days: `alpha 0.0, beta 0.0` persisted (clean series: `0.0761650652923466 / 0.001985339560388405`; pre-159 form: `0.05322625630365148 / 0.004625802229580064`); `treynor` silently disappears (it is skipped when beta is 0). This is rendered in `BenchmarkGreeksTable` as `0.000`. NaN-bearing inputs are reachable (`compute_all_metrics` logs "NaN day(s) in returns … statistics keep NaN handling"; `derive_basis_series` passes a caller-conditioned `scalar_returns` that may carry NaN under `zero_fill`). **Recommendation:** in the inlined `greeks`, (a) compute beta/alpha over **pairwise-complete** observations — the convention the sibling `correlation` in the same M1 block already uses (`aligned_returns.corr(aligned_benchmark)`, pandas pairwise) and the skipna convention 159 chose for the strategy statistics; (b) emit `None`, never `0.0`, when beta is undefined (`var(b) == 0` or < 2 pairs), per D-09's spirit. That is a D-10 disclosed change for NaN-bearing benchmarked series only; NaN-free series stay bit-identical. If the planner prefers strict D-08 parity instead, the `fillna(0)` must at minimum be recorded as a known wrong-value class with its own routed phase — leaving it silent is not an option under SC-5.
- **F-4 — "rolling alpha" is not a rolling alpha.** 0.0.81 computes `alpha_t = mean(r_all) − β_t · mean(b_all)` using **full-sample** means, so the rendered `rolling_alpha` series is a linear transform of rolling beta, not a windowed intercept. D-08 → mirror it exactly; record as a user-facing correctness finding (it is rendered by `RollingAlphaBetaChart`) and route it (memory rule: a user-facing deferral must name a phase).
- **F-5 — the kwarg gate trusted a lie.** The 159 gate passes any call carrying the literal text `prepare_returns=False`. `cvar` carries it and is not closed; `payoff_ratio(x, prepare_returns=False)` would also pass and is not closed. The new gate must allowlist **functions**, each pinned by a behavioural test, not keywords.

## Q6 — Surfaces reading the affected keys (D-13)

| Key / series | Readers found | Renders `None` as absence? | Tag |
|---|---|---|---|
| `recovery_factor`, `ulcer_index`, `common_sense_ratio` | `src/app/factsheet/[id]/v2/MetricsColumn.tsx` renders labels "Recovery Factor" / "Ulcer Index" from **`view.strategyMetrics`** — the TS `compute()` summary from dailies (`src/lib/factsheet/compute.ts`), **not** `metrics_json`. `scenario-factsheet-payload.ts` builds its own scenario payload. | Yes — `num()` / `pct()` return `"—"` for `null`/non-finite | [VERIFIED: file reads] |
| `upi`, `kelly_criterion`, `probabilistic_sharpe_ratio`, `cpc_index`, `serenity_index`, `r_squared` | **No reader** under `src/` (grep for key and camelCase variants: zero hits outside tests); **no reader** in `analytics-service/services` or `routers` outside `metrics.py`; none in `supabase/migrations` | n/a — persisted-only | [VERIFIED: grep] |
| `alpha`, `beta` | `src/lib/queries.ts` `getStrategyDetailV2` → `panel7Inputs.benchmark_greeks` (`typeof … === "number" ? … : null`) → `ExposureAndGreeksPanel` → `BenchmarkGreeksTable` (`fmt()` returns null → em-dash via `MetricCell`) | Yes | [VERIFIED: file reads] |
| `rolling_alpha`, `rolling_beta` (sibling kinds) | `RollingMetricsPanel` → `RollingAlphaBetaChart` (`alpha ?? []`, returns `null` when both empty); NaN points never reach JSONB (`_finalize_rolling` drops non-finite) | Yes | [VERIFIED: file reads] |

**Conclusion:** no surface renders `None` as `0` or crashes. D-13 needs **no** TS change. The honest consequence to state in the SUMMARY: the eight dispatched scalars' wrong values were persisted but **not rendered** anywhere today; the only rendered surfaces this phase touches are alpha/beta (F-3) and the rolling alpha/beta chart.

## Q7 — D-12: are the two KPI lists one set by design?

Verbatim values [VERIFIED: files read this session]:
- `src/lib/queries.ts` `PERCENTILE_ANALYTICS_COLUMNS` (not exported): `"cagr, sharpe, sortino, calmar, max_drawdown, volatility, cumulative_return"`
- `src/app/api/strategies/csv-finalize/route.ts` `CLOCK_SAFETY_KPI_COLUMNS`: `["cagr", "sharpe", "sortino", "calmar", "max_drawdown", "volatility", "cumulative_return"] as const`
- same route, the guard's select literal: `"cagr, sharpe, sortino, calmar, max_drawdown, volatility, cumulative_return, computation_status"`
- `src/lib/percentile-core.ts` **`export const PERCENTILE_METRICS`**: `["cagr", "sharpe", "sortino", "calmar", "max_drawdown", "volatility", "cumulative_return"] as const`
- `src/lib/closed-sets.ts` `export const PERCENTILE_GATE_COLUMN = "computation_status";`

**Same set by design:** the route's docblock says it is "MIRRORING `PERCENTILE_ANALYTICS_COLUMNS` … member for member … If that set ever changes, this one must follow", and gives the reason it was duplicated rather than imported: "`queries.ts` is a client-reachable module and the original is not exported." `percentile-core.ts` has **no imports at all**, so importing `PERCENTILE_METRICS` from it into the route has none of that concern.

**Byte-freeze tests:** none pin either literal. Searches for the joined string and for the two symbol names in `*.test.*` found only prose mentions (`my-strategies/page.test.tsx` matches the projection by a `/^id,\s*strategy_analytics \(/` prefix; `csv-finalize-cross-submission-merge.test.ts` mentions the seven in a comment). "Byte-frozen" is enforced by prose + Phase 159 D-03, not by a test [VERIFIED: grep].

**Recommended derivation (byte-identical by construction):**
```ts
// src/lib/queries.ts
import { PERCENTILE_METRICS } from "./percentile-core";
const PERCENTILE_ANALYTICS_COLUMNS = PERCENTILE_METRICS.join(", ");
// src/app/api/strategies/csv-finalize/route.ts
import { PERCENTILE_METRICS } from "@/lib/percentile-core";
import { PERCENTILE_GATE_COLUMN } from "@/lib/closed-sets";
const CLOCK_SAFETY_KPI_COLUMNS = PERCENTILE_METRICS;
// guard select:
`${PERCENTILE_METRICS.join(", ")}, ${PERCENTILE_GATE_COLUMN}`
```
`["cagr",…].join(", ")` reproduces the literal exactly (single space after each comma, no trailing separator). Because no test pins the bytes today, the plan should **add** one: assert `PERCENTILE_ANALYTICS_COLUMNS` (exported for test, or observed via the recorded `select`) equals the old literal, and the route's recorded select equals the old literal — observed RED by mutating the join separator. The three prose sites that say "mirrors member for member" must be rewritten to "derived from `PERCENTILE_METRICS`" in the same commit, or they become false.

`get_verified_cohort_rank` (SQL RPC) carries its own KPI list in SQL (159 D-03 mentions its "parity-by-construction" prose); TS cannot derive it. Out of D-12's scope — record, do not touch.

## Q8 — Existing tests that will observe the change

| Test | Today | After the fix | Action |
|---|---|---|---|
| `test_metrics_parity.py` (golden_252d, 1e-12 scalar / 1e-9 series) | green | **unchanged** (prototype rel diff 0.0 on this exact fixture) | none; a movement here is a defect in the mirror |
| `test_metrics_parity.py` `test_periods_param_rescales_365` (alpha ×365/252, beta invariant) | green | unchanged if the mirror keeps `alpha * periods` | none |
| `test_metrics.py` `test_qstats_scalars_complete_set` / `_handle_missing_benchmark` (≥ 8 non-None floors) | green | unchanged (golden is benign) | none |
| `test_rank05_*` benign parity, sign, drawdown, shuffle, drawdown_details source-scan | green | unchanged | keep |
| `test_rank05_no_unclosed_quantstats_call_survives_in_compute_all_metrics` | green | **replaced** by the AST gate (D-14) | rewrite |
| `test_rolling_alpha_beta_single_rolling_greeks_call` (counts `qs.stats.rolling_greeks` calls == 1) | green | **fails** (0 calls) | re-pin the H-0711 one-pass contract on the new inline helper (spy it; assert exactly 1 pass) |
| `test_rolling_alpha_beta_logs_warning_on_qs_failure` (detonates `qs.stats.rolling_greeks`) | green | **fails** (never reached) | re-target the fault into the inline math (e.g. monkeypatch the extracted helper) and keep the WARNING + `([], [])` contract |
| `test_rolling_alpha_beta_missing_columns_returns_empty_and_logs` | green | branch becomes unreachable (no qs DataFrame) | delete the dead branch and this test **together**, recorded (159 Deviation-2 rule: never leave a test that cannot fail) |
| `test_qstats_scalars_logs_warning_on_qs_failure` (detonates `qs.stats.recovery_factor`) | green | **fails** | re-target to the mirror |
| `test_qstats_scalars_r_squared_status_error_on_qs_failure` / `_when_qs_returns_nan` | green | **fail** | re-target (monkeypatch the module's `linregress` / the r_squared mirror) — keep the `'error'` status contract |
| `test_qstats_scalars_dispatch_table_per_entry` (parametrized over `_QSTATS_SINGLE_ARG_SCALARS`, detonates `qs.stats.<attr>`) | green (8 rows) | **fails / changes shape** | keep a dispatch table (see Pattern 2) and parametrize the fault over its callables |
| `test_rolling_alpha_beta_aligns_misaligned_series`, `_short_benchmark_returns_empty`, `_none_benchmark_returns_empty`, `_zero_overlap_returns_empty` | green | unchanged (guards precede the math) | none |
| `test_composite_headline_parity.py` (correlation/alpha/beta equality across composite paths) | green | unchanged (both sides use the same function) | none |
| TS `metrics-parity-helper` (reads `golden_252d_expected.json`) | green | unchanged (JSON not regenerated) | none |

Baseline measured this session: `tests/test_metrics.py tests/test_metrics_parity.py` → **206 passed** in 3.9 s; full `analytics-service` suite with `-n auto` → **6109 passed, 90 skipped** in 29 s [VERIFIED: local run]. (The suite's "live-db transport: 11 retries across 6 calls" summary line comes entirely from `tests/test_live_db_transport.py`'s in-process fakes — reproduced by running that file alone; no database env var was set.)

## Standard Stack

### Core (all already installed and pinned — this phase installs nothing)
| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| quantstats | 0.0.81 | Remains for the 5 surviving kwarg-proven/exempt nodes and as the live parity oracle in tests | D-02 [VERIFIED: requirements.in/.txt, in-env `__version__`] |
| pandas | 3.0.3 | All mirror arithmetic (same ops quantstats uses → bit parity) | [VERIFIED: requirements.txt + venv] |
| numpy | 2.5.1 | `np.cov`, `np.sqrt`, `np.maximum.accumulate` | [VERIFIED] |
| scipy | 1.18.0 | `scipy.stats.norm.cdf` (PSR), `scipy.stats.linregress` (r_squared) — the exact functions quantstats imports (`from scipy.stats import norm as _norm, linregress as _linregress`) | [VERIFIED: 0.0.81 stats.py imports]; transitive-only today — see Q1 note for Phase 165 |

**mypy:** `pyproject.toml` already sets `ignore_missing_imports = true` for `scipy.*` and `pandas.*`, and `follow_imports = "skip"` for `quantstats.*` [VERIFIED: file read], so a new `from scipy.stats import linregress, norm` in `services/metrics.py` passes the CI `mypy --strict --follow-imports=silent services/ routers/ models/` step.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Mirroring `_prepare_benchmark` (8 lines) | Calling private `quantstats.utils._prepare_benchmark(..., prepare_returns=False)` | Puts a private qs symbol in production money math and in the gate's allowlist; breaks silently on any qs refactor. Rejected. |
| `scipy.stats.linregress` for r_squared | `np.corrcoef(r, b)[0,1]**2` | Algebraically equal but not bit-identical to the golden (linregress derives r from `np.cov(..., bias=1)` and clips) → would move golden bytes. Rejected. |
| Composing csr/cpc/kelly on kwarg-proven qs leaves | Pure-pandas reimplementations of `profit_factor`/`tail_ratio`/`win_rate` | Would create a second implementation beside the qs kwarg calls `compute_all_metrics` already makes (Rule 7 / "no third hand-copy"). Rejected. |

## Package Legitimacy Audit

This phase installs **no** packages (Python or npm) and changes no dependency file (CONTEXT D-01 "no dependency file changes in this phase"). No legitimacy check applies.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| — | — | — | — | — | — | nothing installed |

**Packages removed due to [SLOP] verdict:** none. **Packages flagged [SUS]:** none.

## Architecture Patterns

### System Architecture Diagram

```
returns (float64, DatetimeIndex)  +  benchmark_returns (BTC, 1000d) | None
            │
            ▼
compute_all_metrics ──► headline + 159-closed sites (unchanged)
            │                 volatility / value_at_risk / tail_ratio / profit_factor  ──► qs (kwarg-proven leaves)
            │                 drawdown_details ──► qs (exempt: consumes dd curve)
            │
            ├─ benchmark block (M1 inner-join aligned pair)
            │      └─► _greeks_mirror(aligned_r, aligned_b, periods) ──► alpha, beta   [was qs.stats.greeks]
            │                └─ _align_benchmark_like_qs ─┐
            │                                              │  (one primitive, three consumers)
            ├─ compute_qstats_scalars(returns, benchmark)  │
            │      ├─ P(r) = inf→NaN→fillna(0)             │
            │      ├─ dispatch table: key → mirror fn ─────┼─► drawdown primitive (ulcer, upi, serenity, recovery)
            │      │                                        │   _annualized_vol_sharpe(ppy=1) (PSR base) + norm.cdf
            │      │                                        │   kwarg-proven leaves (pf, tail, win_rate, avg_win, avg_loss)
            │      │                                        │   _cvar_tail + value_at_risk(prepare_returns=False) (serenity)
            │      └─ r_squared ── _align_benchmark_like_qs ×2 ──► linregress ──► r²
            │
            └─ _rolling_alpha_beta(returns, benchmark, 90)
                   └─ inner-join align → P(r) + _align_benchmark_like_qs → DataFrame.fillna(0)
                      → rolling corr / std → beta_t, alpha_t  ──► sibling_kinds rolling_alpha/beta
                                                                 ──► strategy_analytics_series ──► RollingAlphaBetaChart

AST gate (pytest): every non-test module importing quantstats ⊆ COVERED; every qs.stats node in
COVERED modules ∈ {KWARG_PROVEN leaf with prepare_returns=False constant, EXEMPT by name};
getattr(qs.stats, …) / aliases / qs.utils refs → RED; census printed via pytest_terminal_summary.
```

### Recommended structure (all inside `analytics-service/services/metrics.py` — no new module)

```
services/metrics.py
├── (module level, before compute_all_metrics)  "RANK-05 / Phase 166 primitives" section
│   ├── _drawdown_series(wealth) / _max_drawdown(wealth)       # extracted from compute_all_metrics' geometric branch
│   ├── _annualized_vol_sharpe(r, periods_per_year)            # extracted; 3 spellings → 1 (headline, backbone, PSR base via ppy=1)
│   ├── _downside_rms(x)                                       # extracted; headline sortino + smart_sortino (D-04 order)
│   ├── _cvar_tail(series, threshold)                          # extracted from the inline cvar block
│   ├── _prepared_returns_no_guess(r)                          # P(r): inf→NaN→fillna(0)
│   └── _align_benchmark_like_qs(benchmark, period)            # _prepare_benchmark minus the guess
├── mirrors: _recovery_factor, _ulcer_index, _upi, _kelly, _psr, _common_sense, _cpc, _serenity,
│            _r_squared, _greeks, _rolling_greeks   (each with a P114-style docblock citing 0.0.81)
└── _QSTATS_SINGLE_ARG_SCALARS: tuple[tuple[_QstatsScalarKey, Callable[[pd.Series], float]], ...]
tests/test_metrics.py        # new "Phase 166 / QSTATS-TRUTH" section
tests/test_qstats_gate.py    # (recommended) the AST gate + its red/green self-test fixtures
tests/conftest.py            # pytest_terminal_summary: print the gate census unconditionally
```

### Pattern 1: Extract primitives FIRST, re-point existing sites, prove zero movement (D-04 order)

**What:** Wave 1 is a pure refactor: move the drawdown, Sharpe/vol, downside-RMS and CVaR-tail math into module functions; re-point `compute_all_metrics`, `sharpe_vol_status_from_backbone` and the smart/headline Sortino sites; every existing test and the golden parity stay green **unchanged**.
**Bit-identity constraints measured/derived:**
- Sharpe: headline computes `(mean*ppy) / (std*sqrt(ppy))`; the backbone computes `vol = std*sqrt(ppy)` then `mean*ppy / vol`. Same operations in the same order → one primitive returning `(vol, sharpe)` with `vol = std * sqrt(ppy)` and `sharpe = (mean * ppy) / vol` is bit-identical for both (the backbone's `_safe_float(vol)` is `float()` of the same finite value).
- Downside RMS: headline uses `sqrt(float((x[x<0]**2).sum()) / x.count())` on the MAR-excess series; `smart_sortino` uses the same on `dropna()` with `len` (== count). One primitive serves both.
- Drawdown: keep `c / c.cummax().clip(lower=1.0) - 1.0` then `.replace([inf, -inf, -0.0], 0.0)` for the SERIES; for `max_drawdown` the current code does `min(c / peak) - 1.0` **without** the `-0.0` replace. `min(x) - 1 == min(x - 1)` in IEEE (monotone rounding), but a `-0.0` vs `0.0` sign can differ if the primitive applies the replace before `.min()`. Keep the two call shapes' exact operation order, or prove equality incl. sign on the golden fixtures.
- The chart path builds its wealth from `returns_for_chart` (clipped at `_LOG_RETURN_FLOOR`); the `max_dd` and ulcer paths from `returns.fillna(0)` (unclipped). The primitive should take a **wealth curve** so each caller keeps its own input; do not unify the clip.

### Pattern 2: The mirror arm — "0.0.81 minus the guess", expression order preserved

**What:** each mirror reproduces the 0.0.81 function body with `_prepare_returns`/`_prepare_prices` replaced by their non-guessing cleanup, keeping quantstats' raw-vs-prepared choice per sub-term (e.g. serenity's `returns.std()` and `returns.sum()` are **raw**; PSR's `skew`/`kurtosis`/`n` are **raw** while its Sharpe base is **prepared**).
**Why expression order matters:** the golden comparator is 12 significant digits / `rel 1e-12`, series `rel 1e-9` (`test_metrics_parity.py` module docstring). The prototype hit rel 0.0 precisely because it used the same pandas/numpy ops in the same order.
**NaN convention (recommended, with the reason):** use `P(r)` = `_prepare_returns` minus the guess (`fillna(0)`), **not** 159's skipna, for the eleven new mirrors. Then the phase changes **only** trigger-shaped values, and D-11's census predicate (the guess condition) characterises the whole affected population. A skipna switch would also move every NaN-bearing series (a population D-11's SQL does not describe). This deliberately differs from 159's choice for the headline sites; record the divergence at the site (Rule 7: surfaced, reasoned, not blended). The one exception is F-3 (`greeks`), where 0.0.81's own `fillna(0)` produces a fabricated zero.
**Dispatch table shape:** keep `_QSTATS_SINGLE_ARG_SCALARS` and `_QstatsScalarKey` (the Literal typo guard) but change the second element from a qs attribute name to a module callable, and keep `_safe_qstats_scalar(name, fn, returns, returns_len)` as the failure-soft wrapper (its signature already takes `fn: Any`). This removes the `getattr(qs.stats, …)` shape entirely while preserving the H-0710 per-scalar WARNING contract and the parametrized per-entry fault test.

```python
# Source: prototype measured bit-exact vs quantstats 0.0.81 on 5 fixtures (this research)
def _prepared_returns_no_guess(r: pd.Series) -> pd.Series:
    # quantstats 0.0.81 _utils._prepare_returns, rf=0 path, MINUS the price guess
    return r.copy().replace([np.inf, -np.inf], np.nan).fillna(0).replace([np.inf, -np.inf], np.nan)

def _align_benchmark_like_qs(benchmark: pd.Series, period: pd.DatetimeIndex) -> pd.Series:
    # quantstats 0.0.81 _utils._prepare_benchmark(benchmark, period, prepare_returns=True) MINUS the guess
    if set(period) != set(benchmark.index):
        prices = 1.0 + ((benchmark.copy().fillna(0).replace([np.inf, -np.inf], np.nan)).add(1).cumprod() - 1)  # to_prices(base=1)
        daily = pd.date_range(start=period[0], end=period[-1], freq="D")
        benchmark = prices.reindex(daily, method="bfill").reindex(period).pct_change(fill_method=None).fillna(0)
        benchmark = benchmark[benchmark.index.isin(period)]
    # (tz normalisation step of the original goes here verbatim)
    return _prepared_returns_no_guess(benchmark.dropna())

def _r_squared(r: pd.Series, benchmark: pd.Series) -> float:
    p = _prepared_returns_no_guess(r)
    b = _align_benchmark_like_qs(benchmark, p.index)
    return float(linregress(p, _align_benchmark_like_qs(b, p.index))[2] ** 2)  # qs prepares twice; so do we
```

### Pattern 3: The AST gate (D-14), allowlists pinned as named sites

**Inputs:** every `*.py` under `analytics-service/` excluding `tests/` and `.venv/`.
**Rule A — importer coverage:** any module with an `Import`/`ImportFrom` of `quantstats` (any alias, `from quantstats import stats`, `from quantstats.stats import x`) must be in `COVERED_MODULES = {"services/metrics.py"}`; otherwise RED naming the module. Today exactly one production importer exists [VERIFIED: grep + AST].
**Rule B — node classification** in each covered module (resolve the local alias names first):
1. `Call` whose `func` is `<qs>.stats.<name>`: GREEN only if `<name> ∈ KWARG_PROVEN` **and** it has a keyword `prepare_returns` whose value is `ast.Constant(False)` (reject `True`, a variable, `**kwargs`); or `<name> ∈ EXEMPT = {"drawdown_details"}`. Else RED with `module:function:name:lineno`.
2. Any `Attribute` `<qs>.stats.<name>` that is **not** a call's `func` (alias `fn = qs.stats.x`, passed as an argument, stored in a tuple): RED.
3. `Call` to `getattr` whose first arg is `<qs>.stats`: RED, and report the dispatched names — resolve a `Name` second arg by finding the enclosing `for … in <TABLE>` and reading `<TABLE>`'s literal tuple from the module AST (today: the 8 attributes of `_QSTATS_SINGLE_ARG_SCALARS`).
4. Any reference to `<qs>.utils` / `quantstats.utils` / `_prepare_*`: RED.
**Allowlists as SITES not counts** (house B3 convention): `KWARG_PROVEN = {"volatility", "value_at_risk", "tail_ratio", "profit_factor", "win_rate", "avg_win", "avg_loss"}` (trim to what the code actually calls), each membership justified by a **behavioural** pin test that spies the preparers and calls the function with `prepare_returns=False` on the trigger fixture, asserting zero preparer calls — the same shape as `test_rank05_drawdown_details_is_heuristic_free`, but behavioural rather than source-scan (the cvar lesson: a signature lies; a source scan of the function body alone would have missed `payoff_ratio`'s un-forwarded calls, a behavioural spy does not).
**Anti-vacuity:** `scanned_nodes > 0` and `covered_modules_found == COVERED_MODULES` (a rename that makes the scan read nothing is RED).
**Printed census (D-07):** the gate returns rows `(module, enclosing function, qs function, call shape, arm, reason)`; a `pytest_terminal_summary` hook in `tests/conftest.py` prints them **unconditionally** (precedent: the "live-db transport: N retries" line in the same conftest, emitted even for the zero case because pytest captures passing-test stdout). Include the 30-vs-9 reconciliation line: `grep 'qs.stats.' = 30 occurrences / 30 lines; AST call-or-reference nodes = 9` today [VERIFIED: grep -c and AST walk this session].
**Proven able to fail — permanently, not once:** the gate is a pure function over source text, so ship red/green fixture strings per shape (direct unclosed call, `prepare_returns=True`, `cvar(..., prepare_returns=False)` [not allowlisted], `payoff_ratio(..., prepare_returns=False)`, getattr dispatch over a table, `fn = qs.stats.x` alias, `from quantstats.stats import greeks`, a helper named `_rolling_alpha_beta` calling `rolling_greeks`, a new importer module) — each must be RED naming its site; one clean fixture must be GREEN (the `lint-sql-gates` "red and green fixture per rule" house pattern). Then record one real neuter drill against `services/metrics.py` in the SUMMARY (reintroduce the getattr dispatch / a bare `rolling_greeks` → observe RED → restore).

Measured today's AST census (9 nodes) [VERIFIED: AST walk]:

| Enclosing function | qs node | shape | `prepare_returns=False`? |
|---|---|---|---|
| compute_all_metrics | volatility | call | yes |
| compute_all_metrics | value_at_risk | call | yes |
| compute_all_metrics | tail_ratio | call | yes |
| compute_all_metrics | profit_factor | call | yes |
| compute_all_metrics | greeks | call | yes (strategy leg only — benchmark leg open) |
| compute_all_metrics | drawdown_details | call | no (exempt) |
| compute_qstats_scalars | `getattr(qs.stats, qs_attr)` | dispatch over 8 names | no |
| compute_qstats_scalars | r_squared | call | no |
| _rolling_alpha_beta | rolling_greeks | call | no |

Target census after the phase: the first four (kwarg-proven), `drawdown_details` (exempt), plus whichever kwarg-proven leaves the mirrors compose on (e.g. `value_at_risk` for serenity's dd-VaR; `profit_factor`/`tail_ratio`/`win_rate`/`avg_win`/`avg_loss` inside `compute_qstats_scalars`); **zero** getattr dispatch, zero `greeks`/`rolling_greeks`/`r_squared` and zero dispatched-scalar nodes.

### Anti-Patterns to Avoid
- **Keyword-presence gating:** "the call has `prepare_returns=False`, so it is closed" — refuted by `cvar`, `payoff_ratio`, `win_loss_ratio`, and by all four dispatched kwarg-capable scalars (Q2).
- **Algebraic rewrites of qs formulas** (e.g. `np.corrcoef` for r², P114-form PSR base with `ppy != 1`, `(1+r).prod()` vs `r.add(1).prod()`): correct math, wrong bytes against a 1e-12 golden.
- **Aligning `r_squared` onto the M1 inner join "for consistency":** changes `r_squared` for every benchmarked strategy (the reindex/bfill branch runs for all of them, Q3). That is a convention change needing its own D-10 disclosure — not a side effect of this closure.
- **Deleting fault-injection tests that became unreachable without replacing the contract** (159 Deviation-2): re-target them at the inline math.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Normal CDF / PPF | a hand-written erf/probit | `scipy.stats.norm` (what qs uses) | bit parity + tails |
| Linear-regression r | `np.corrcoef` or manual cov | `scipy.stats.linregress` (what qs uses) | bit parity with golden `r_squared` |
| Profit factor, tail ratio, win rate, avg win/loss | pandas re-implementations | `qs.stats.<leaf>(p, prepare_returns=False)` — kwarg-proven, already the 159 mechanism | one implementation per formula |
| Drawdown series | a fourth copy | the extracted primitive (from 159's inline block) | D-04 |
| Python AST walking | regex over source lines | stdlib `ast` (`ast.parse`, `ast.walk`, parent map) | the line gate's exact failure mode |
| `_prepare_benchmark` reindex | calling the private qs symbol | the 8-line mirror | keeps private qs out of prod + gate |

**Key insight:** the correctness anchor is "live quantstats on inputs where the guess cannot fire". Every mirror should be judged by that oracle at `rel ≤ 1e-12` (scalars) and by an economic invariant on trigger inputs — never by its own output.

## Runtime State Inventory

Not a rename/refactor of identifiers; included because persisted values change.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `strategy_analytics.metrics_json` keys `recovery_factor, ulcer_index, upi, kelly_criterion, probabilistic_sharpe_ratio, common_sense_ratio, cpc_index, serenity_index, r_squared, alpha, beta`; `strategy_analytics_series` kinds `rolling_alpha`, `rolling_beta` — written before the fix stay until the strategy's next compute (D-11) | **No data migration in this phase** (D-11). Plan writes the read-only census SQL below into the SUMMARY; OPEN-2 decides recomputes. Ledger venues never recompute on their own (project memory). |
| Live service config | None — verified: no dashboard/UI-held config references these metric keys | none |
| OS-registered state | None — no scheduler/unit embeds metric names | none |
| Secrets/env vars | None — no env var names these metrics | none |
| Build artifacts | None — Railway image rebuilds from source; no dependency file changes | none |

**Census predicate (read-only, for the SUMMARY; the founder runs it — this phase touches no remote):** the guess fires on the series *as passed* to quantstats. `_prepare_returns` fires when `min ≥ 0 AND max > 1`; `_prepare_prices` passes through (the drawdown family) when `NOT (min < 0 OR max < 1)`, i.e. `min ≥ 0 AND max ≥ 1`. The union predicate is therefore `min(r) >= 0 AND max(r) >= 1`. The best stored proxy of the exact series `compute_all_metrics` saw is the `daily_returns_grid` sibling kind (emitted from that same `returns`, rounded to 6 dp, NaN dropped, capped to the most recent 5000 points by `cap_data_points`):

```sql
-- READ-ONLY. Strategies whose last computed input tripped the quantstats guess.
SELECT sas.strategy_id,
       min((e->>'value')::float8) AS min_r,
       max((e->>'value')::float8) AS max_r,
       count(*)                   AS n_days
FROM public.strategy_analytics_series sas
CROSS JOIN LATERAL jsonb_array_elements(sas.payload) AS e
WHERE sas.kind = 'daily_returns_grid'
GROUP BY sas.strategy_id
HAVING min((e->>'value')::float8) >= 0
   AND max((e->>'value')::float8) >= 1;

-- Benchmark leg: has the cached BTC series ever had a >= +100% day? (expected: no rows)
SELECT date, close_price,
       close_price / lag(close_price) OVER (ORDER BY date) - 1 AS r
FROM public.benchmark_prices WHERE symbol = 'BTC'
ORDER BY r DESC NULLS LAST LIMIT 5;
```
Caveats to print with it: a series longer than 5000 days is truncated in the grid (older days unseen); the 6-dp rounding can move a value within 5e-7 of the `>= 1` boundary; F-3's NaN-greeks population is a **different** predicate (any NaN day in a benchmarked series) and needs its own query if the planner fixes F-3.

## Common Pitfalls

### Pitfall 1: Trusting the kwarg
**What goes wrong:** a site is "closed" by adding `prepare_returns=False`, the gate goes green, the value stays wrong.
**Why:** 0.0.81 composite functions call their helpers without forwarding the kwarg (Q2: 4/4 dispatched scalars, 3/3 benchmark legs, plus `cvar`, `payoff_ratio`, `win_loss_ratio`).
**How to avoid:** allowlist leaf **functions** with a behavioural preparer-spy pin each; RED on everything else.
**Warning signs:** a kwarg'd call whose value is unchanged on the trigger fixture.

### Pitfall 2: A golden byte moves by an ulp
**What goes wrong:** `test_metrics_parity.py` fails at 1e-12 after a "harmless" rewrite.
**Why:** reordered float ops (`corrcoef` vs `linregress`, `(1+r).prod()` vs `r.add(1).prod()`, P114 Sharpe form with `ppy != 1`).
**How to avoid:** mirror the exact 0.0.81 expression; run the parity suite after each mirror, not at the end. The prototype shows rel 0.0 is achievable for every site.

### Pitfall 3: r_squared's hidden reindex branch
**What goes wrong:** the mirror uses the M1 inner-join pair and `r_squared` moves for every benchmarked strategy.
**Why:** `compute_qstats_scalars` receives the unaligned 1000-day BTC series; 0.0.81's `_prepare_benchmark` reindexes it with `bfill` on a daily grid and `pct_change`s it, and does so twice.
**How to avoid:** `_align_benchmark_like_qs`, called twice, as in Pattern 2; include the calendar-mismatch fixture in the parity triad.

### Pitfall 4: Fault-injection tests that cannot fail
**What goes wrong:** tests that monkeypatch `qs.stats.rolling_greeks` / `recovery_factor` / `r_squared` keep "passing" by being skipped, or are deleted without replacement.
**How to avoid:** Q8 table — re-target each to the inline math; delete only the genuinely dead missing-columns branch together with its test, recorded.

### Pitfall 5: The census is invisible on a green run
**What goes wrong:** the gate prints its census with `print()`, pytest captures it, CI shows nothing on success.
**How to avoid:** `pytest_terminal_summary` hook (house precedent in `tests/conftest.py`).

### Pitfall 6: `-0.0` vs `0.0`
**What goes wrong:** a drawdown primitive that applies `.replace([..., -0.0], 0.0)` before `.min()` flips the sign of a zero `max_drawdown` (serializes as `-0.0` vs `0.0`).
**How to avoid:** keep each caller's op order; assert `math.copysign(1, v)` on the all-winning fixture if the order changes.

### Pitfall 7: Running Python from the wrong place
**What goes wrong:** pytest from repo root → cassette misses → live broker calls (project memory).
**How to avoid:** always `cd analytics-service` and use the main checkout's `.venv` python by absolute path (the worktree has no `.venv`).

## Code Examples

### Behavioural kwarg pin (one row per allowlisted leaf)
```python
# Source: this research's probe (spy on the preparers); pattern of test_rank05_drawdown_details_is_heuristic_free
@pytest.mark.parametrize("name", sorted(KWARG_PROVEN))
def test_q166_kwarg_proven_leaf_never_reaches_a_preparer(name, monkeypatch):
    from quantstats import utils as qs_utils
    calls: list[str] = []
    real_r, real_p = qs_utils._prepare_returns, qs_utils._prepare_prices
    monkeypatch.setattr(qs_utils, "_prepare_returns", lambda *a, **k: calls.append("returns") or real_r(*a, **k))
    monkeypatch.setattr(qs_utils, "_prepare_prices", lambda *a, **k: calls.append("prices") or real_p(*a, **k))
    getattr(qs.stats, name)(_rank05_trigger_series(), prepare_returns=False)
    assert calls == [], f"{name}(prepare_returns=False) still reached {calls} — not a closure"
```
(Anti-vacuity: the same test must go RED for `payoff_ratio` and `cvar` — ship those two as expected-RED calibration rows.)

### Economic invariants on the canonical trigger (D-09 / SC-4)
```python
def test_q166_all_winning_series_has_no_drawdown_derived_ratios():
    s = compute_qstats_scalars(_rank05_trigger_series(), None)
    assert s["ulcer_index"] == 0.0                       # no loss ⇒ no drawdown ⇒ zero RMS drawdown
    for key in ("recovery_factor", "upi", "serenity_index"):
        assert s[key] is None, f"{key}: denominator is a drawdown that does not exist"
    assert s["common_sense_ratio"] is None               # profit factor undefined with zero losses
    assert s["probabilistic_sharpe_ratio"] > 0.5         # positive-Sharpe series
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Region gate: regex over `inspect.getsource(compute_all_metrics)` lines, trusts `prepare_returns=False` text | AST over every quantstats-importing module; function allowlists pinned behaviourally; census printed | this phase | sees dispatch, aliases, helpers, new importers |
| quantstats as the computation for 16 functions | quantstats for ≤ 7 kwarg-proven leaves + 1 exempt; mirrors for the rest | 159 → 166 | makes Phase 165's removal a small, measurable step |

**Deprecated/outdated:** the 159-05 SUMMARY "Residual" table's "closable by kwarg? yes" rows and `WINDOWS.md` entry 9's "(kwarg-closable)" — both refuted by §Q2.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | A ≥ +100% BTC daily return has not occurred in the cached window, so the benchmark-leg guess is unreachable in production today | Q4, Runtime State | Low — the census query measures it; the closure is needed regardless |
| A2 | Pairwise-complete alpha/beta (F-3 recommendation) is the right NaN convention rather than strict 0.0.81 parity | F-3 | Medium — it is a disclosed value change for NaN-bearing benchmarked series; planner may insert a `checkpoint:decision` |
| A3 | No other fork outside the ones listed fixes the guess | Q1 | None for this phase (D-01 does not adopt forks anyway) |
| A4 | The Bailey–López de Prado PSR uses non-excess kurtosis with `(γ₄−1)/4` | F-2 | Low — only affects a recorded finding, not the mirror (which reproduces 0.0.81) |

## Open Questions (RESOLVED)

> All three were resolved by the orchestrator in `166-CONTEXT.md`'s post-research amendment. The recommendations below are kept as the research record; where they differ from the resolution, the resolution binds.

1. **RESOLVED → D-15 (fix here, disclosed).** **F-3 — fix the NaN-greeks fabricated zero here, or record and route?**
   - Known: live, measured, rendered, introduced by 159's kwarg; `greeks` is being inlined in this phase anyway.
   - Unclear: whether the founder wants D-08 strict parity at this site.
   - Recommendation: fix under D-10 (pairwise-complete + `None` when undefined); one disclosed row per affected class.
2. **RESOLVED → D-16 and D-17 (both fixed in this phase, disclosed; NOT routed — this supersedes the recommendation below).** **F-2 (PSR kurtosis) and F-4 (rolling alpha uses full-sample means)** — both are correctness defects in quantstats' own formulas, not the guess. Recommendation: mirror 0.0.81 now (parity), record both with measured before/after, and route each via `/gsd-phase --edit` to a named phase (F-4 is user-facing — rendered chart).
3. **RESOLVED → D-19 (symlinked `node_modules`, measured to resolve).** **TS verification environment for D-12** — this worktree has no `node_modules`, and module resolution walks **up** from the worktree (a sibling of the main checkout), so it will not find the main checkout's `node_modules`. The plan needs an explicit, tested way to run `vitest`/`tsc` for the D-12 plan (no `npm install` — disk is tight).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Python venv (analytics-service) | all Python work | ✓ (main checkout's `analytics-service/.venv`, used by absolute path from this worktree's `analytics-service/`) | Python 3.12 | — |
| quantstats / pandas / numpy / scipy | mirrors + parity oracle | ✓ | 0.0.81 / 3.0.3 / 2.5.1 / 1.18.0 (match the lock) | — |
| mypy | CI strict step | ✓ | 2.2.0 | — |
| pytest + xdist | tests | ✓ | full suite 29 s with `-n auto` | serial run |
| Node / vitest / tsc for D-12 | TS plan | ✗ in this worktree (no `node_modules`, not resolvable by walking up) | — | a tested symlink/runner from the main checkout, or run the TS plan's checks in CI only (weaker — say so) |
| GitHub CLI (read-only upstream checks) | Q1 re-verification | ✓ | — | — |

**Missing dependencies with no fallback:** none. **With fallback:** TS toolchain for D-12 (above).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest (+ pytest-xdist) for Python; vitest for the D-12 TS plan |
| Config file | `analytics-service/pytest.ini` (`testpaths = tests`, `pythonpath = .`); `analytics-service/pyproject.toml` (mypy) |
| Quick run command | from `analytics-service/`: `<main-checkout>/analytics-service/.venv/bin/python -m pytest tests/test_metrics.py tests/test_metrics_parity.py -q -k "rank05 or q166 or qstats or rolling_alpha or greeks"` (~4 s) |
| Full suite command | from `analytics-service/`: `<venv python> -m pytest -q -n auto` (~30 s, 6109 passed / 90 skipped at HEAD) and `<venv python> -m mypy --strict --follow-imports=silent services/ routers/ models/` |
| TS (D-12) | `npx vitest run src/lib/queries.test.ts src/lib/percentile-core.test.ts src/__tests__/csv-finalize-cross-submission-merge.test.ts` + `npx tsc --noEmit` (needs a working `node_modules`, see Open Question 3) |

### Phase Requirements → Test Map
| Req | Behavior | Test Type | Automated Command | File Exists? |
|-----|----------|-----------|-------------------|-------------|
| SC-1 | Pin stays 0.0.81; decision recorded | unit (existing) | `pytest tests/test_metrics.py -k quantstats_pin` | ✅ `test_rank05_quantstats_pin_is_still_0_0_81` |
| SC-2 | Every kwarg-proven leaf is behaviourally proven; payoff_ratio/cvar calibrate RED | unit | `pytest tests/test_qstats_gate.py -k kwarg_proven` | ❌ Wave 0 |
| SC-2 | Census printed with arm + reason per node, 30-vs-9 line | unit + terminal summary | `pytest tests/test_qstats_gate.py -q` (census appears in summary) | ❌ Wave 0 |
| SC-3 | AST gate RED per shape (direct, `=True`, not-allowlisted, getattr dispatch, alias, `_rolling_alpha_beta`, new importer), GREEN on clean | unit (red/green fixtures) | `pytest tests/test_qstats_gate.py -k fixture` | ❌ Wave 0 |
| SC-3 | Gate GREEN on real `services/metrics.py`, scanned > 0 | unit | `pytest tests/test_qstats_gate.py -k real_corpus` | ❌ Wave 0 |
| SC-4 | Canonical-trigger invariants (ulcer 0; recovery/upi/serenity/csr None; PSR > 0.5) | unit, economic | `pytest tests/test_metrics.py -k q166_all_winning` | ❌ Wave 0 |
| SC-4 | Non-monotone trigger: kelly/cpc/csr None; shuffle invariance of PSR/kelly/csr/cpc | unit, economic | `pytest tests/test_metrics.py -k "q166_nonmonotone or q166_shuffle"` | ❌ Wave 0 |
| SC-4 | Benchmark trigger: r² == corr² of raw pair; β == cov/var; rolling β == rolling cov/var; joint-permutation invariance | unit, economic | `pytest tests/test_metrics.py -k q166_benchmark` | ❌ Wave 0 |
| SC-4/D-08 | Every mirror == live quantstats on benign fixtures (benign_mixed, golden_returns+bm, calendar-mismatch, 3-NaN) at rel 1e-12; rolling series point-by-point | unit, parity | `pytest tests/test_metrics.py -k q166_parity` | ❌ Wave 0 |
| SC-5 | Golden bytes unchanged | integration | `pytest tests/test_metrics_parity.py -q` | ✅ |
| D-04 | Primitive extraction is byte-neutral | integration | full suite + parity, before any mirror lands | ✅ (existing tests) |
| H-0711 / H-0726 | one rolling pass; fail-soft WARNING on inline fault; empty on short/None benchmark | unit | `pytest tests/test_metrics.py -k rolling_alpha_beta` | ✅ (3 tests re-targeted, 1 removed with its dead branch) |
| D-12 | Derived strings byte-identical to the old literals; RED on a separator mutation | unit (TS) | vitest command above | ❌ Wave 0 (new pin) |

### Sampling Rate
- **Per task commit:** quick run command.
- **Per wave merge:** full Python suite + mypy strict (+ vitest/tsc for the TS wave).
- **Phase gate:** full suite green, the gate's neuter drill recorded (RED observed, restored), before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `analytics-service/tests/test_qstats_gate.py` — AST gate, red/green fixtures, behavioural kwarg pins, real-corpus run
- [ ] `analytics-service/tests/conftest.py` — `pytest_terminal_summary` census print
- [ ] `analytics-service/tests/test_metrics.py` — Phase 166 section: `_q166_trigger_nonmonotone`, benchmark-trigger fixture, calendar-mismatch fixture, invariant/parity/shuffle tests; re-target the Q8 fault-injection tests
- [ ] TS byte pin for the derived KPI strings
- [ ] Every new invariant observed RED against HEAD's `services/metrics.py` (neuter → RED → restore) before the mirror lands

## Security Domain

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | no | no route or RLS change; alpha/beta projection unchanged |
| V5 Input Validation | yes (numeric) | existing `compute_all_metrics` preconditions (DatetimeIndex, float dtype, monotonic index); `_safe_float` maps NaN/±inf to `None` before JSONB |
| V6 Cryptography | no | — |

| Threat Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Crafted CSV (all-winning, one ≥100% day) inflating/deflating public-facing ratios | Tampering / Information integrity | the closure itself + economic-invariant tests |
| Non-finite values reaching JSONB (Postgres rejects NaN) | Denial of service (failed write) | `_safe_float` / `_drop_nonfinite` on every mirror output |
| Supply chain: adopting a git-URL/fork quantstats | Tampering | not done (D-01/OPEN-1); pin unchanged |
| Public repo leakage in `.planning/` | Information disclosure | this document contains no credential, project ref, strategy name, home path or username; census SQL is table-level only |

## Sources

### Primary (HIGH confidence)
- Installed quantstats 0.0.81 source (`quantstats/stats.py`, `quantstats/utils.py`) via `inspect.getsource` — every formula in §Q3 and the preparers
- In-env probes (spy on preparers; prototype mirrors vs live qs on 5 benign + 3 trigger fixtures) — §Q2, §Q3 parity table, §Q4
- `analytics-service/services/metrics.py` (`compute_all_metrics`, `_QSTATS_SINGLE_ARG_SCALARS`, `compute_qstats_scalars`, `_rolling_alpha_beta`, `sharpe_vol_status_from_backbone`), `tests/test_metrics.py`, `tests/test_metrics_parity.py`, `tests/conftest.py`, `services/benchmark.py`, `services/basis_series.py`, `pyproject.toml`, `requirements*.{in,txt}`
- `src/lib/percentile-core.ts`, `src/lib/queries.ts`, `src/app/api/strategies/csv-finalize/route.ts`, `src/lib/closed-sets.ts`, `src/components/strategy-v2/BenchmarkGreeksTable.tsx`, `src/components/charts/RollingAlphaBetaChart.tsx`, `src/app/factsheet/[id]/v2/MetricsColumn.tsx`
- https://pypi.org/pypi/quantstats/json — release list
- GitHub API for ranaroussi/quantstats: compare `v0.0.81...main` (identical), `main` contents of `quantstats/utils.py`, issues #7, PRs #541 and #545, forks list
- https://pypi.org/pypi/quantstats-lumi/json and github.com/Lumiwealth/quantstats_lumi utils contents

### Secondary (MEDIUM confidence)
- https://www.davidhbailey.com/dhbpapers/deflated-sharpe.pdf, https://www.davidhbailey.com/dhbpapers/sharpe-frontier.pdf, https://en.wikipedia.org/wiki/Deflated_Sharpe_ratio — PSR standard-error formula with non-excess kurtosis (F-2)

### Tertiary (LOW confidence)
- none relied upon

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — nothing new; versions read from the lock and the venv
- Architecture (mirrors, gate): HIGH — prototyped and measured bit-exact; gate rules derived from the measured failure shapes
- Pitfalls/findings: HIGH for F-3/F-5 (measured), MEDIUM for F-2 (external formula citation), HIGH for F-4 (source read)

**Research date:** 2026-09-24
**Valid until:** stable while the quantstats pin is 0.0.81 (re-run the Q2 spy matrix on any pin move)
