---
phase: 236-figuremath-every-engine-annualizes-one-way-cvar-is-historica
plan: 06
subsystem: quantstats-pin-and-parity-mirrors
tags: [quantstats, decision-record, provenance, parity-arms, proof-01]
requires: [236-03]
provides:
  - "236-QUANTSTATS-DECISIONS.md: 16 table rows, one per touched metric, with the quoted rule and the pinning arm"
  - "quantstats==0.0.86 in requirements.in, the make-lock requirements.txt and requirements-dev.txt; the Dependabot quantstats ignore deleted"
  - "serenity_index CVaR leg = historical tail of the drawdown series; common_sense_ratio, PSR base and time_in_market on observed rows"
  - "live 0.0.86 arms for PSR, rolling alpha, strategy-gap greeks and r_squared, sortino count, stored-cvar KEEP, serenity-not-parametric"
affects: [236-08, 236-09, 236-10, 236-11]
tech-stack:
  added: []
  patterns: ["live oracle recomposed from live pieces when upstream bakes a default the repo rejects", "a scratch venv built from the lock for the measure-first RED list"]
key-files:
  created:
    - .planning/phases/236-figuremath-every-engine-annualizes-one-way-cvar-is-historica/236-QUANTSTATS-DECISIONS.md
  modified:
    - analytics-service/requirements.in
    - analytics-service/requirements.txt
    - analytics-service/requirements-dev.txt
    - .github/dependabot.yml
    - docs/runbooks/metrics-nan-policy.md
    - analytics-service/services/metrics.py
    - analytics-service/tests/test_metrics.py
    - analytics-service/tests/test_qstats_gate.py
    - analytics-service/tests/qstats_gate.py
    - analytics-service/tests/test_annualization_census.py
    - analytics-service/tests/fixtures/golden_252d_expected.json
decisions:
  - "serenity CVaR leg is the historical tail as 0.0.86 cvar(dd, method=\"historical\") computes it, never the parametric default and never the repo floor-index rule (A2)"
  - "PSR's Sharpe base moved to observed rows (a measured extension of A3 under Q3: 0.0.86's sharpe skips NaN); n = len(series) stays upstream's own"
  - "time_in_market takes 0.0.86's observed denominator and keeps the unrounded fraction (H-0724); all-NaN stays None, not 0.0"
  - "serenity's drawdown-dispersion predicate conjunct is dropped: it existed for 0.0.81's parametric VaR"
metrics:
  duration: "about 1h30m"
  completed: 2026-11-25
status: complete
actuals:
  tokens: 60000
  tasks: 3
  commits: 3
plan_head_before: 6c5d4bf399198f2830fb0f191fa540c9f37e74c5
plan_head_after: f06a9802c81cea52ab83a04a871fc2f6f8668d82
---

# Phase 236 Plan 06: quantstats 0.0.86 with a per-metric decision record Summary

quantstats moves 0.0.81 to 0.0.86 after the full corpus was measured RED on a scratch interpreter, every touched metric got a decision row under Q3, and each adopted mirror is pinned by a live 0.0.86 arm that was neutered RED and restored byte-exact.

## Commits

| Task | Commit | What |
|---|---|---|
| 1 (tracer) | 016ccdb42 | measured RED list, `236-QUANTSTATS-DECISIONS.md` (16 rows) |
| 2 | 4ffe90206 | provenance-checked pins, Dependabot ignore deleted, NaN-policy runbook cites 0.0.86 |
| 3 | f06a9802c | mirrors, live arms, hand-moved golden key, gate bookkeeping |

## Decision table in brief (full record: 236-QUANTSTATS-DECISIONS.md)

| Metric | Decision | Moves for |
|---|---|---|
| stored `cvar`, `var_1d_95` | KEEP repo floor-index historical rule (F-6) | nothing |
| `serenity_index` CVaR leg | ADOPT historical tail (A2); parametric default rejected | every strategy with a drawdown |
| `common_sense_ratio` | ADOPT observed-only (A3) | NaN-carrying series only |
| `time_in_market` | ADOPT observed denominator, KEEP unrounded (H-0724) | NaN-carrying series only |
| PSR base | ADOPT observed-only (Q3, A3 extension, measured) | NaN-carrying series only |
| `win_rate` | ADOPT, measured no move | nothing |
| rolling alpha, strategy-gap greeks and r_squared, sortino count | ALREADY-ADOPTED, now live arms | nothing |
| drawdown baseline | ALREADY-ADOPTED, no differentiating arm exists (honest limit) | nothing |
| `r_squared` on a benchmark gap | KEEP 166.4 D-A (0.0.86 did not touch it) | nothing |
| ulcer, upi, recovery, kelly, payoff, cpc, omega, live leaves | KEEP (no value change) | nothing |

Figures that move (for the CHANGELOG): `serenity_index` (golden_252d 0.019258489731125872 to 0.01893104775322315; benign_mixed 0.143686058754821 to 0.1494210488068295), and on NaN-carrying series `common_sense_ratio` (0.9094449129830964 to 0.909416022493258 on the golden-with-gaps fixture), `time_in_market` (0.994 to 1.0) and `probabilistic_sharpe_ratio` (0.3564452921230312 to 0.35603160170583026). Stored `cvar` and `var_1d_95` do not move. The fleet re-derive is the coordinator's PROD write.

## Measured RED list (Task 1, before any edit, quantstats 0.0.86 on the scratch interpreter)

```
FAILED tests/test_metrics.py::test_rank05_quantstats_pin_is_still_0_0_81 - As...
FAILED tests/test_qstats_gate.py::test_qstats_gate_calibration_non_honouring_functions_do_reach_a_preparer[cvar]
FAILED tests/test_metrics.py::test_q166_parity_every_mirror_matches_live_quantstats[serenity_index-benign_mixed]
FAILED tests/test_metrics.py::test_q166_parity_every_mirror_matches_live_quantstats[serenity_index-golden_returns]
FAILED tests/test_metrics.py::test_q166_parity_every_mirror_matches_live_quantstats[serenity_index-golden_returns_with_nan_days]
FAILED tests/test_metrics.py::test_q166_parity_every_mirror_matches_live_quantstats[common_sense_ratio-golden_returns_with_nan_days]
FAILED tests/test_metrics.py::test_q166_rolling_greeks_alpha_differs_from_the_full_sample_form
7 failed, 16670 passed, 93 skipped, 1147 warnings in 270.16s (0:04:30)
```

All seven are mapped to rows: the pin (version row), the `cvar` calibration (gate row), three serenity arms (A2 row), `common_sense_ratio` on the gap fixture (A3 row), the rolling-alpha anti-vacuity test (rolling alpha row, replaced by a live arm). Two moves were not on the list because no live arm covered them (PSR on a NaN series, `time_in_market`); both got rows and arms.

## Provenance (Task 2), verbatim

(i) artifact digest against PyPI's JSON API (`pip download quantstats==0.0.86 --no-deps`, then the script below):

```
$ pip download quantstats==0.0.86 --no-deps -d <scratchpad>/qs086-dl
Successfully downloaded quantstats
$ python -I prov.py <scratchpad>/qs086-dl
published: {
 "quantstats-0.0.86-py3-none-any.whl": "4cfb157c8228cbb47681d6a81767d465fbc2bdf529643dd7e836479d2165efd6",
 "quantstats-0.0.86.tar.gz": "eb348e342410f0abb9b7a457f524df703dc337ed075303b842eaba220a11c7e1"
}
quantstats-0.0.86-py3-none-any.whl sha256=4cfb157c8228cbb47681d6a81767d465fbc2bdf529643dd7e836479d2165efd6 match=True name_match=True
PROVENANCE OK
```

```python
import hashlib, json, sys, urllib.request, pathlib
d = pathlib.Path(sys.argv[1])
files = sorted(p for p in d.iterdir() if p.is_file())
assert files, "no downloaded artifacts"
with urllib.request.urlopen("https://pypi.org/pypi/quantstats/0.0.86/json", timeout=30) as r:
    meta = json.load(r)
pub = {u["filename"]: u["digests"]["sha256"] for u in meta["urls"]}
print("published:", json.dumps(pub, indent=1))
for p in files:
    h = hashlib.sha256(p.read_bytes()).hexdigest()
    ok = h in pub.values()
    print(f"{p.name} sha256={h} match={ok} name_match={pub.get(p.name)==h}")
    assert ok, f"MISMATCH {p.name}"
print("PROVENANCE OK")
```

(ii) lock diff after `make lock` (uv 0.11.6), and the script that fails on any non-quantstats line:

```
$ git diff -U0 -- analytics-service/requirements.txt
@@ -223 +223 @@ pyyaml==6.0.3
-quantstats==0.0.81
+quantstats==0.0.86
$ git diff -U0 -- analytics-service/requirements.txt | python3 -I lockdiff.py
LOCK-DIFF OK: only quantstats lines changed
```

(iii) banned packages, in all three requirement files:

```
react-native-international-phone-number: requirements.txt=0 requirements.in=0 requirements-dev.txt=0
react-native-country-select: requirements.txt=0 requirements.in=0 requirements-dev.txt=0
```

PROOF-01 for the lock-diff script (a non-quantstats line injected into a scratch copy of the diff; the repo file untouched):

```
LOCK-DIFF RED: non-quantstats lines:
  +aiohttp==9.9.9
rc=1
```

**The provenance check's limit.** It detects corruption in transit and mirror drift: the downloaded artifact equals the digest PyPI's own JSON API publishes. It does NOT detect a compromised upstream publisher, because a malicious release publishes its own matching digest. Only the wheel was downloaded by `pip` (it prefers the wheel), so the sdist digest is published but was not compared. The rest of the defence is the lock diff touching one line, the banned-package assertion, and 16,691 passing tests including live parity arms against the new code.

## Verification

- Full corpus under 0.0.86 after the change: `16691 passed, 93 skipped, 867 warnings in 250.83s (0:04:10)` (RED run was `7 failed, 16670 passed, 93 skipped`; the delta is 14 new arms net).
- CI mypy strict command (`grep -a -n mypy .github/workflows/ci.yml`, line 5740): `Success: no issues found in 144 source files`.
- `npx vitest run src/__tests__/metrics-parity.test.ts`: `Tests  19 passed (19)`.
- The new arms under 0.0.81 (main venv, read-only): 18 failed, 33 passed. Every ADOPT and ALREADY-ADOPTED arm is RED there except the three `time_in_market` fixtures that cannot discriminate and the gappy one that can.
- `npx tsx scripts/check-planning-hygiene.ts`: exit 0 before each commit.

## PROOF-01 (verbatim; each neutered copy restored by `cp` from a byte backup and `cmp`ed identical)

```
=== PROOF-01 serenity: mirror reverted to the 0.0.81 mixed-estimator CVaR leg
--- neutered; RED run:
FAILED tests/test_metrics.py::test_q166_parity_every_mirror_matches_live_quantstats[serenity_index-benign_mixed]
FAILED tests/test_metrics.py::test_q166_parity_every_mirror_matches_live_quantstats[serenity_index-golden_returns]
FAILED tests/test_metrics.py::test_q166_parity_every_mirror_matches_live_quantstats[serenity_index-golden_returns_with_nan_days]
FAILED tests/test_metrics.py::test_fig03_serenity_is_the_historical_tail_not_the_parametric_default
FAILED tests/test_metrics.py::test_q166_parity_benign_mixed_reproduces_the_research_anchor[serenity_index-0.1494210488068295]
5 failed, 28 passed, 14 warnings in 11.00s
--- restored by cp; cmp: identical
--- GREEN run:
33 passed in 14.47s
=== PROOF-01 common_sense_ratio: mirror reverted to the zero-filled P(r)
--- neutered; RED run:
E             comparison failed
FAILED tests/test_metrics.py::test_q166_parity_every_mirror_matches_live_quantstats[common_sense_ratio-golden_returns_with_nan_days]
1 failed, 27 passed in 13.14s
--- restored by cp; cmp: identical
--- GREEN run:
28 passed in 11.39s
=== PROOF-01 PSR: Sharpe base reverted to the zero-filled P(r)
--- neutered; RED run:
E             comparison failed
FAILED tests/test_metrics.py::test_fig03_live_psr_matches_mirror[golden_returns_with_nan_days]
1 failed, 3 passed in 12.46s
--- restored by cp; cmp: identical
--- GREEN run:
4 passed in 9.01s
=== PROOF-01 time_in_market: denominator reverted to len(returns)
--- neutered; RED run:
E         comparison failed
FAILED tests/test_metrics.py::test_fig03_time_in_market_is_the_unrounded_observed_exposure[fig03_gappy]
FAILED tests/test_metrics.py::test_qstats_scalars_time_in_market_excludes_nan_rows
2 failed, 4 passed in 7.67s
--- restored by cp; cmp: identical
--- GREEN run:
6 passed in 7.33s
=== PROOF-01 rolling alpha: windowed intercept reverted to the 0.0.81 full-sample means
--- neutered; RED run:
FAILED tests/test_metrics.py::test_fig03_live_rolling_alpha_matches_the_mirror
1 failed in 8.41s
--- restored by cp; cmp: identical
--- GREEN run:
1 passed in 11.99s
=== PROOF-01 golden JSON: serenity_index key restored to its 0.0.81 value
--- neutered; RED run:
36 passed, 296 deselected in 13.82s
--- restored by cp; cmp: identical
--- GREEN run:
36 passed, 296 deselected in 13.53s
=== PROOF-01 version pin: the 0.0.81 assertion reinstated
--- neutered; RED run:
FAILED tests/test_metrics.py::test_rank05_quantstats_pin_is_still_0_0_86 - As...
1 failed in 10.32s
--- restored by cp; cmp: identical
--- GREEN run:
1 passed in 9.81s
=== PROOF-01 golden JSON: serenity_index key restored to its 0.0.81 value
--- neutered; RED run:
FAILED tests/test_metrics_parity.py::test_metrics_parity_full - AssertionErro...
1 failed in 13.81s
--- restored by cp; cmp: identical
--- GREEN run:
1 passed in 12.53s
=== PROOF-01 stored cvar KEEP: _historical_var_cvar neutered to include the 13th day (upstream historical shape)
--- neutered; RED run:
E         comparison failed
E             comparison failed
FAILED tests/test_metrics.py::test_fig03_stored_cvar_keeps_the_repo_floor_index_rule
FAILED tests/test_figure_parity.py::test_historical_var_cvar_matches_hand_derived_vector[n200_k10_ten_worst]
2 failed, 3 passed in 8.42s
--- restored by cp; cmp: identical
--- GREEN run:
5 passed in 7.92s
```

The version-pin neuter is in the block above (`test_rank05_quantstats_pin_is_still_0_0_86`). The first golden-JSON attempt (selected with `-k golden`) did not select the test that reads the key, so it was GREEN and proved nothing; it is shown above for honesty and was redone against `test_metrics_parity_full`, which went RED. The first stored-cvar neuter hit `compute_all_metrics` rather than `_historical_var_cvar` and was caught by `test_compute_all_metrics_stores_historical_var_and_version_marker`; it was redone on `_historical_var_cvar` itself (above, last block).

The new arms against 0.0.81 (so none passes vacuously):

```
=== the new arms under quantstats 0.0.81 (main venv, read-only use)
quantstats 0.0.81
E             comparison failed
E         comparison failed. Mismatched elements: 411 / 411:
E             comparison failed
E             comparison failed
E             comparison failed
E         comparison failed
E         comparison failed
FAILED tests/test_metrics.py::test_rank05_quantstats_pin_is_still_0_0_86 - As...
FAILED tests/test_metrics.py::test_q166_parity_every_mirror_matches_live_quantstats[serenity_index-benign_mixed]
FAILED tests/test_metrics.py::test_q166_parity_every_mirror_matches_live_quantstats[serenity_index-benign_all_positive]
FAILED tests/test_metrics.py::test_q166_parity_every_mirror_matches_live_quantstats[serenity_index-golden_returns]
FAILED tests/test_metrics.py::test_q166_parity_every_mirror_matches_live_quantstats[serenity_index-golden_returns_with_nan_days]
FAILED tests/test_metrics.py::test_q166_parity_every_mirror_matches_live_quantstats[common_sense_ratio-golden_returns_with_nan_days]
FAILED tests/test_metrics.py::test_fig03_live_rolling_alpha_matches_the_mirror
FAILED tests/test_metrics.py::test_fig03_live_psr_matches_mirror[benign_mixed]
FAILED tests/test_metrics.py::test_fig03_live_psr_matches_mirror[benign_all_positive]
FAILED tests/test_metrics.py::test_fig03_live_psr_matches_mirror[golden_returns]
FAILED tests/test_metrics.py::test_fig03_live_psr_matches_mirror[golden_returns_with_nan_days]
FAILED tests/test_metrics.py::test_fig03_win_rate_is_nan_invariant - assert 0...
FAILED tests/test_metrics.py::test_fig03_time_in_market_is_the_unrounded_observed_exposure[fig03_gappy]
FAILED tests/test_metrics.py::test_fig03_live_greeks_and_r_squared_on_a_strategy_gap_pair
FAILED tests/test_metrics.py::test_fig03_live_sortino_matches_the_skipna_count
FAILED tests/test_metrics.py::test_fig03_stored_cvar_keeps_the_repo_floor_index_rule
FAILED tests/test_metrics.py::test_fig03_serenity_is_the_historical_tail_not_the_parametric_default
FAILED tests/test_qstats_gate.py::test_fig03_cvar_honours_prepare_returns_false
18 failed, 33 passed, 324 deselected, 5 warnings in 15.37s
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `_mirror_keys_defined_by` serenity predicate**
- **Found during:** Task 3 first run (`test_q166r2_each_mirror_precondition_is_necessary[serenity_flat_drawdown]`)
- **Issue:** the third conjunct (real dispersion in the drawdown series) existed because 0.0.81's parametric VaR needs a positive scale. Under the historical tail `[-0.1, 0, 0, 0, 0]` is defined (-0.4, hand arithmetic).
- **Fix:** conjunct replaced by "a losing day"; the case left `_Q166R2_UNDEFINED_CASES`; `test_fig03_serenity_flat_drawdown_is_defined` added. The 16691-test run holds the fuzz sufficiency arm GREEN.
- **Files modified:** analytics-service/services/metrics.py, analytics-service/tests/test_metrics.py
- **Commit:** f06a9802c

**2. [Rule 3 - Blocking] gate bookkeeping**
- **Found during:** Task 3 first run
- **Issue:** the serenity mirror was `value_at_risk`'s last call site, so `KWARG_PROVEN` (held EQUAL to the called leaves) went stale and a green needle named it; `cvar` left the non-honouring calibration list; the census count `std_call` for metrics.py fell 17 to 16 with the deleted conjunct.
- **Fix:** `value_at_risk` removed from `KWARG_PROVEN` and the needle; calibration keeps `payoff_ratio`; `test_fig03_cvar_honours_prepare_returns_false` added; census recorded 16. `tests/test_annualization_census.py` is outside the plan's file list.
- **Files modified:** analytics-service/tests/qstats_gate.py, analytics-service/tests/test_qstats_gate.py, analytics-service/tests/test_annualization_census.py
- **Commit:** f06a9802c

**3. [Measured extension of a ruling, not a new decision] PSR base and `time_in_market`**
- **Found during:** Task 1 measurement of each Q3-touched metric on the four parity fixtures.
- **Issue:** neither was on the RED list (no live arm covered them), but both move on NaN-carrying series under 0.0.86. RESEARCH had PSR as "no value move".
- **Fix:** adopted under Q3 ("adopt each upstream correction unless F-5/F-6 says otherwise") and the A3 reasoning, each with a row and a live arm. Flagged here so the coordinator can overrule: reverting either is a one-line change and its arm names the line.

### Observations (no change made)

- 0.0.86 `kelly_criterion`, `cpc_index`, `payoff_ratio` and `recovery_factor` now accept `prepare_returns=` but still reach a preparer with it False (gate spy), so the inline mirrors stay justified.
- `r_squared` on a benchmark-gap pair differs from live (0.0037907 vs 0.0036315): 0.0.86 still rebuilds benchmark prices; the mirror keeps 166.4 D-A. Not pinned by a live arm on purpose.
- The drawdown-baseline row has no arm that is RED under 0.0.81: the 0.0.86 baseline change acts on price-path input the repo never feeds.
- `TODOS.md` `QUANTSTATS-0086-REDERIVE-01` (owned by this phase) and the CHANGELOG entry belong to the ship step: the entry must be deleted from `TODOS.md` in the same PR per the repo rule, and `CHANGELOG.md` gets the figures above.
- Task 1's scratch interpreter, the lock-diff script and the PROOF-01 harness live in the session scratchpad (`<scratchpad>`), never in the repo.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or schema change; the one trust-boundary item (PyPI to runtime) is the provenance section above.

## Self-Check: PASSED
