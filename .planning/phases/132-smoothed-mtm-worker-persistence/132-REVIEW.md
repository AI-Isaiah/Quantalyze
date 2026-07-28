---
phase: 132-smoothed-mtm-worker-persistence
reviewed: 2026-07-22T00:00:00Z
depth: deep
commits: 107887d9^..60800ee9 (107887d9, cad6a898, 60800ee9)
files_reviewed: 13
files_reviewed_list:
  - analytics-service/services/basis_series.py
  - analytics-service/services/job_worker.py
  - analytics-service/services/stitch_composite.py
  - analytics-service/services/nav_twr.py
  - analytics-service/tests/test_basis_series.py
  - analytics-service/tests/test_mtm_single_key.py
  - analytics-service/tests/test_stitch_composite.py
  - analytics-service/tests/test_stitch_composite_job.py
  - analytics-service/tests/test_cash_basis_series_sc4.py
  - analytics-service/tests/test_derive_broker_dailies_dualmode.py
  - analytics-service/tests/test_composite_headline_parity.py
  - analytics-service/tests/test_nav_twr.py
  - analytics-service/tests/test_sfox_reconstruct.py
findings:
  critical: 0
  warning: 3   # 2 HIGH + 1 MEDIUM
  info: 3      # LOW
  total: 6
status: resolved
verdict: PASS-with-fixes
resolution:
  re_reviewed_at: 2026-07-22T00:00:00Z
  fix_range: 60800ee9..a1d03d59
  all_findings: RESOLVED   # HIGH-01, HIGH-02, MED-01, LOW-02, LOW-03; LOW-01 deferred to Phase 133
  re_review_verdict: PASS
  detail: .planning/phases/132-smoothed-mtm-worker-persistence/132-REVIEW-FIX.md
---

# Phase 132: Code Review Report — smoothed_mtm worker persistence

**Reviewed:** 2026-07-22
**Depth:** deep (full diff + cross-file trace + suite re-run)
**Verdict:** **PASS-with-fixes** — no wrong-money-number defect, no gate regression, but two HIGH findings (an availability-regression hazard on large options books, and a violation of the module's own Pitfall-5 stale-series invariant) should be fixed before the worker passes ship.

Independently verified (not taken from the SUMMARY):

- **Suite green:** `pytest` on all 9 touched test files → **340 passed** at 60800ee9 (HEAD == reviewed commit). `mypy --strict` on the 4 changed services → **0 issues**.
- **Priority 1 — MTM gate byte-unchanged: CONFIRMED.** `git diff 107887d9^..60800ee9` shows `stitch_composite.py` is purely additive (`mark_to_market_available` / `MTM_REASON_OPTIONS` byte-identical; `smoothed_mtm_available` is a new pure function of `member_signals` that neither consults nor mutates the MTM decision — pinned by `test_smoothed_availability_never_mutates_the_mtm_gate`). In `job_worker.py` the ONLY deleted lines are the 5-line by-basis prestamp assignment; the replacement (`_by_basis_obj` at job_worker.py:4084-4089) is provably equivalent on every non-options path: both attempted flags False → `{} or None` → `None`, exactly the prior write. The single-key MTM pass block (:2520-2636) and the composite `mtm_ok, mtm_reason = mark_to_market_available(member_signals)` decision (:5292) are byte-unchanged.
- **Priority 2 — all 14 contract-evolution test edits audited line-by-line: FAITHFUL.** Every cash/MTM/smoothed VALUE, gate, and reason assertion is preserved; only combine/report/fan-out arity (2→3, 2→4) and by-basis SHAPE assertions changed, and each new shape is the correct new contract (options book → `{mark_to_market, smoothed_mtm}`; MTM-degrades-but-smoothed-OK → `{smoothed_mtm}`; both degrade → `None` pinned by `test_mtm_compute_valueerror_degrades`; perp-only → `None` + zero smoothed persists pinned by `test_perp_only_skips_smoothed_pass_sc4`). No test was made trivially green: e.g. `set(by_basis) == {...}` still reddens if smoothed is dropped OR cash leaks; `test_degraded_mtm_persists_null_and_reason`'s old `is None` assertion was correctly RELOCATED (the attempted-and-all-degraded → NULL invariant now lives in `test_mtm_compute_valueerror_degrades`; the not-attempted → NULL invariant in `test_perp_only_skips_smoothed_pass_sc4`) rather than deleted. Its combine stub change (`_cash_series` → `_mtm_series` return_value) is harness convenience; no surviving assertion depends on the cash values.
- **Priority 3 — SC-4: HOLDS.** Perp-only: 1 crawl, no smoothed persist call at all (spy-asserted, not just absence of a row), by-basis `None` — byte-identical write. The `_by_basis_obj or None` equivalence (above) closes the scalar side; `test_sc4_cash_parity_mtm_on_vs_off` still proves the cash track invariant.
- **Priority 5 — persistence shape: CORRECT.** Both routes persist via `persist_basis_series(basis="smoothed_mtm")` → `KIND_SMOOTHED_MTM` (round-trip + heal-delete pinned in `test_basis_series.py`; generic `_PNL_BASES` sync pin closes the future-fourth-basis gap). `metrics_json_by_basis.smoothed_mtm` is `dict(BasisSeriesResult.metrics_json)` — the SAME producer as `mark_to_market`, so the seven `BASIS_KPI_MAP` scalars Phase 133 will read are shape-identical. Verified the CURRENT frontend tolerates the new key pre-133: `basis-metrics.ts` / `composite-read-path.ts` do keyed lookups (`.mark_to_market`, `.cash_settlement`), no closed-set/strict schema — an extra `smoothed_mtm` key is ignored.

## Critical Issues

None.

## High

### HIGH-01: The smoothed third pass is unbudgeted inside the 15-min derive envelope — reintroduces the exact FIX-2 failure mode (healthy options key → failed_final) that the MTM pass was engineered to prevent

**File:** `analytics-service/services/job_worker.py:2659-2672` (smoothed crawl), vs `:2526-2551` (MTM budget slice), `:2698-2725` (shared TimeoutError arm), `:206-243` (constants)

**Issue:** The MTM second pass carries FIX-2 machinery precisely because a second FULL-HISTORY crawl inside the fixed 900s outer `wait_for` can sink the whole derive: it is bounded to `0.7 × remaining budget` and REFUSES to start (degrading loud with `MTM_REASON_SECOND_PASS_TIMEOUT`) when < 60s of budget remains (:2535-2551). The new smoothed THIRD pass is the same class of full-history crawl PLUS the dense-marks index fetch — strictly heavier — yet it is bounded only by `_BROKER_CRAWL_TIMEOUT_S` (default **810s**, sized for the CASH pass as outer-minus-reserve) and has **no remaining-budget check and no refusal floor**. Three consequences:

1. **Concrete failing scenario (deterministic, plausible input):** an options key whose legitimate cash crawl runs ~11-12 min (the v1.11 incident measured ~12-min crawls as LEGITIMATE, :232-238). Pre-132: MTM refuses on the 60s floor, degrades loud, cash headline ships → DONE. Post-132: the smoothed pass then STARTS a full-history crawl+marks fetch with an 810s bound while <3 min of outer budget remain → the outer 900s `wait_for` fires mid-crawl → transient → 3 attempts repeat identically → **failed_final. The previously-green cash headline stops refreshing entirely.** This is availability loss on the money path, not the accepted retention-straddle trade-off (which the SUMMARY does surface) — it is undocumented and untested.
2. The comment at :2706-2707 ("this only ever fires for the cash pass") is now **false** — a smoothed `wait_for` expiry (< outer budget) lands in that arm and returns an error message blaming the "deribit cash-pass crawl" (:2712, :2720), corrupting ops triage.
3. `test_mtm_second_pass_timeout_degrades_loud_not_failed_final` was updated for the third pass but the smoothed pass's OWN timeout disposition has no test at all.

**Fix:** Clone the FIX-2 envelope for the third pass: compute remaining budget, bound the smoothed crawl to a slice of it, and on the refusal floor / bounded timeout choose an explicit disposition (a distinct transient reason is fine given the fail-loud mandate — but it must be a *smoothed*-labelled, budget-aware disposition, not an 810s bound that guarantees the outer kills the job first). Minimum viable: `timeout=min(_BROKER_CRAWL_TIMEOUT_S, remaining - reserve)` + a smoothed-specific TimeoutError arm + a test pinning the disposition. Update the :2706 comment and the "cash-pass" message either way.

### HIGH-02: Guarded smoothed persist skips the HEAL on the attempted-but-degraded path — a stale smoothed series row outlives the scalar omission, violating the module's own Pitfall-5 invariant; the justifying comment is factually wrong

**File:** `analytics-service/services/job_worker.py:4017-4037` (guarded persist + comment), `:3845-3856` (the degrade path that falsifies it); invariant at `analytics-service/services/basis_series.py:317-319`

**Issue:** The persist guard's rationale (:4022-4025) claims "A started-but-failed smoothed pass fails the WHOLE job upstream, so there is no attempted-but-null smoothed persist to heal here." **False.** The smoothed SCALAR ValueError degrade (:3845-3856) is exactly a started-but-null path that completes DONE: crawl succeeded (`smoothed_attempted=True`), `derive_basis_series` rejected the series, `smoothed_metrics_json=None` → persist skipped, **no heal**. Concrete failing scenario: an options key with a successful smoothed derive on Monday (series row persisted); Tuesday's re-derive hits a `cumulative_method='simple'` interior chain-break → by-basis omits `smoothed_mtm` (correct) but **Monday's stale `smoothed_mtm_daily_returns` row survives indefinitely** — every subsequent degraded derive skips the heal again. `persist_basis_series`'s own docstring names this the Pitfall-5 hazard ("a stale series must never outlive the scalars' authoritative-NULL write"), and the MTM pass heals precisely this case (`result=None` → DELETE). Today it is latent (no reader; the Phase-103 read pattern gates the series roundtrip on the by-basis key, and Phase 133 will presumably clone it), but it is a real-looking stale MONEY series sitting in a table that `mtm_daily_returns` consumers already read by bare `(strategy_id, kind)`. `test_single_key_derive_helper_valueerrors_degrades_and_heals` pins the no-heal behavior as if it were correct.

**Fix (SC-4-compatible, small):** heal on ATTEMPTED-but-degraded — `if smoothed_attempted: persist(result=_smoothed_basis_result)` (None ⇒ delete), keeping the not-attempted skip. `smoothed_attempted` is only ever True on option-activity keys, so SC-4's "no smoothed RPC on a no-option key" is untouched; the executor's stated trade-off conflated not-attempted with attempted-degraded. The separate **options→perp-only reconfiguration** stale case (SUMMARY's "Known limitations") genuinely does conflict with SC-4-as-written and is acceptable to defer — but only because the by-basis scalar heals wholesale and Phase 133 must gate the series read on the scalar key; carry that as a hard requirement into 133, not an assumption.

## Medium

### MED-01: Composite route never stamps `pre_mark_retention_option_dailies` — honesty-caveat asymmetry vs single-key

**File:** `analytics-service/services/job_worker.py:5436` (`_sm_metas` discarded), `:4494-4514` (`_reconstruct_deribit` discards the completeness report), `:5594-5601` (guard-flag union runs over CASH-pass `member_metas` only)

**Issue:** Single-key: pre-retention buckets from the smoothed completeness report stamp `pre_mark_retention_option_dailies` → `complete_with_warnings` (:2691-2697, pinned by test). Composite: `_reconstruct_deribit` returns only `(returns, has_option_activity, member_meta)` — `completeness.pre_mark_retention_option_days` is never bridged into any meta, `_sm_metas` are discarded, and the Finding-3 flag union iterates the cash-pass metas. **A composite whose options leg has marks aged past the retention horizon persists a smoothed_mtm basis with NO caveat**, while the identical book as a single key is honestly warned. Same data, two disclosure levels on a public factsheet surface. (The plan's must-have only named the single-key stamp, so this is a gap in the plan carried into the code — still worth closing while the seam is warm.)

**Fix:** in `_reconstruct_deribit`, when `basis == PNL_BASIS_SMOOTHED_MTM` and `completeness.pre_mark_retention_option_days`, stamp the bucket into the returned `member_meta`; union the smoothed metas (or just this key) into the Finding-3 flag merge. Plus a composite sibling of `test_pre_mark_retention_stamps_complete_with_warnings`.

## Low

### LOW-01: No smoothed degrade-reason channel — compounding with HIGH-02
**File:** `analytics-service/services/job_worker.py:3805-3806`
A single-key smoothed scalar degrade is persisted identically to "book has no options" (key absent, no reason — unlike MTM's `mtm_gated_reason`). Explicitly deferred to 131-03 and logged, so acceptable — but note it compounds HIGH-02: absent key + stale series + no reason leaves zero persisted evidence that a smoothed pass ever degraded. Ensure 131-03 actually adds the reason channel.

### LOW-02: Test-harness side-effect doubling weakens the pass-arity oracle
**File:** `analytics-service/tests/test_stitch_composite_job.py:376-393`, `tests/test_composite_headline_parity.py:283-288`
`_deribit_patches`/`_patches` now blanket-double `combine_returns` (and preflight lists) for options composites. Previously an exact-sized `side_effect` list made any EXTRA fan-out fail loud via `StopIteration`; now an accidental duplicate smoothed fan-out (same persisted output, doubled live crawls) would pass silently. Value assertions still catch cross-basis leaks (e.g. `"mark_to_market" not in by_basis`), so this is robustness, not a hole in the shipped assertions. Consider asserting the total `combine` call count in one options-composite test.

### LOW-03: Third synchronous pandas combine on the shared event loop (single-key route)
**File:** `analytics-service/services/job_worker.py:2678-2682`
The composite arm offloads `combine_native_ledger` via `asyncio.to_thread` (WEDGE-01); the single-key route runs it on-loop — pre-existing for cash/MTM, and the smoothed pass adds a third on-loop full-book combine (options ledgers are the largest), linearly extending the heartbeat-starvation window WEDGE-01 was about. Consistent with the existing single-key pattern, so not a regression — flag for the WEDGE-01 follow-up sweep.

## Explicit answers to the review questions

1. **MTM gate byte-unchanged?** Yes — verified from the diff, not the SUMMARY (zero deletions in `stitch_composite.py`; the only `job_worker.py` deletion is the by-basis assignment, and its replacement is output-equivalent on all non-options inputs). The smoothed predicate is genuinely separate (pure, option-activity-only, non-mutating).
2. **The 14 test edits?** All faithful; none trivially green; every relocated assertion re-pinned elsewhere; new shape contracts correct; falsifiability preserved. One gap: the smoothed pass's own TIMEOUT disposition is untested (part of HIGH-01).
3. **SC-4?** Holds at the worker layer, by construction and by test.
4. **Deviations:** #2 (nav_twr registration) — correct mechanism, no leak (flag collapses to boolean at :3882-3884; closed-set pin grown non-weakeningly). #3 (guarded persist) — the reconfiguration limitation is acceptably deferred, but the guard is over-broad and creates the NEW, more reachable attempted-but-degraded stale case = HIGH-02, fix now. #4 (fail-loud symmetry) — correct: ledger/marks failure fail-loud both routes; scalar ValueError degrades single-key (mirrors MTM) and fails the composite job (mirrors existing composite MTM semantics) — internally consistent.
5. **Persistence/by-basis shape?** Correct and forward-compatible; current frontend tolerates the new key today.

**Verdict: PASS-with-fixes** — fix HIGH-01 and HIGH-02 (both small, both in the new code only, neither touches the byte-frozen cash/MTM blocks) before shipping the worker; MED-01 strongly recommended in the same pass.

---

_Reviewed: 2026-07-22 · Reviewer: Claude (gsd-code-reviewer) · Depth: deep · Suite: 340 passed @ 60800ee9 · mypy --strict: clean_
