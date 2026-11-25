# Phase 229: MT5DERIVE2 - Pattern Map

**Mapped:** 2026-11-24
**Files analyzed:** 12 files to modify: 6 production (`nav_twr.py`, `transforms.py`, `job_worker.py`, `analytics_runner.py`, `allocator_equity_derive.py`, `scripts/mt5_soak.py`) and 6 test files (`test_nav_twr.py`, `test_mt5_soak.py`, `test_allocator_equity_writer_basis.py`, `test_transforms.py`, `test_csv_analytics_runner.py`, `test_job_worker.py`). No new source file is needed; every change is an edit beside an existing symbol.
**Analogs found:** 12 / 12 (every analog is a symbol in the file being edited, or a tracked sibling)
**Symbols marked (new) do not exist at HEAD; do not grep for them** (`plan-anchor-verify` re-resolves named symbols).
**Line numbers** are measured in the worktree at its base commit. RESEARCH.md says to re-measure symbol locations at the plan's base commit (phases 225, 231 and 155.2 edit neighbouring symbols), so cite by symbol and re-grep before editing.

All paths below are relative to `analytics-service/` unless they start with `src/` (repo-root-relative form: prefix `analytics-service/`). Run pytest only from `analytics-service/`. Every `services/` edit must pass `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `services/nav_twr.py` `_judged_cohorts` (MT5D-04) | utility (pure money math) | transform | the same function's existing `(k > 0 or inception) and pnl == 0.0` skip | exact (edit in place) |
| `services/nav_twr.py` `chain_linked_twr` day-0 flag (new keys `inception_day_pnl_dropped`, `inception_day_pnl_dropped_days`) + `NavTWRMeta` + `NAV_TWR_ANNOTATION_KEYS` + `_build_nav_meta` (MT5D-05) | utility + registry | transform | `flow_timing_day_level_large(_days)` (D-15 annotation) | exact |
| `services/transforms.py` `_merge_status_meta` (MT5D-05 carry) | utility (carry) | transform | `flow_timing_day_level_large` carry, same function | exact |
| `services/job_worker.py` prestamp block (MT5D-05 carry) | service | request-response (derive) | `flow_timing_day_level_large` prestamp lines | exact |
| `services/analytics_runner.py` `DataQualityFlags` + carry (MT5D-05) | service / TypedDict | transform | `flow_timing_day_level_large` TypedDict key and `is True` carry | exact |
| `services/nav_twr.py` `FLOW_TIMING_LARGE_RATIO` (MT5D-06) | config | record only | existing constant plus its boundary test | exact (comment-only, optional) |
| `services/job_worker.py` `_native_key_usd_writer_basis`, `_convert_native_key_to_usd` caller guard, `_NativeKeyUsd`, store gate, new payload field `writer_basis_withheld` (new) (MT5D-07) | service | CRUD (jsonb upsert) | the holed-key `segment terminals withheld` block plus the `writer_basis_payload` store gate | exact |
| `services/allocator_equity_derive.py` sibling helpers, all (new): `read_writer_basis_withheld`, `returns_stamp_payload`, `read_returns_stamp`, `returns_stamp_mismatch_days` (MT5D-07, HOLD-03) | utility (payload build and read) | transform | `writer_basis_payload` + `_read_basis_rows` + `read_realized_terminal` | exact |
| `services/job_worker.py` `_run_key_mode_compose_epilogue` + both returns-write exits, new payload field `returns_stamp` (new) (HOLD-03 writer) | service | CRUD | `rows_payload` build and the `<2-day` exit `_measured` list | exact (edit in place) |
| `services/job_worker.py` `run_derive_allocator_equity_job` read loop + `_compose` `degrade_reasons=` (MT5D-07 and HOLD-03 reader) | service | request-response (compose) | the three `read_writer_basis(...)` sites and the `SHARED_ACCOUNT_FLOWS_DISAGREE` reason row | exact |
| `scripts/mt5_soak.py` `_walk_cohorts` (soak oracle rule) | utility (independent oracle) | transform | its own current `_walk_cohorts` | exact (rewrite from rule text, never from the production edit) |
| `tests/test_nav_twr.py` (MT5D-04 arms, MT5D-05 arms, replaced `off` half) | test | unit | `_timed_day_return` direct tests (lines 2248-2273), `_inception_chain` tests, `test_timed_*` family | exact |
| `tests/test_mt5_soak.py` (soak oracle arms, new zero-base-sweep fixture) | test | unit | `_funded_each_morning_and_swept_each_evening` + `_KNIFE_EDGE_SWEEPS` | exact |
| `tests/test_allocator_equity_writer_basis.py` (MT5D-07 G3 arm, HOLD-03 pair arms, reader unit arms) | test | e2e derive to compose, unit | `test_a_holed_btc_key_with_a_timed_day_withholds_the_basis_and_the_terminals` | exact |
| `tests/test_transforms.py` (MT5D-05 ccxt carry) | test | unit | `test_flow_timing_day_level_large_carried_as_a_bool_and_never_promotes` (line 230) | exact |
| `tests/test_csv_analytics_runner.py` (MT5D-05 runner carry) | test | unit | the three `flow_timing_day_level_large` tests (lines 1832-1861) | exact |
| `tests/test_job_worker.py` (MT5D-05 prestamp carry) | test | unit | the prestamp assertions at lines 2538-2554 | exact |

## Pattern Assignments

### `services/nav_twr.py` `_judged_cohorts` (utility, transform) - MT5D-04

**Analog:** itself. Edit only the skip condition; keep the rest of the function and `_timed_day_return` untouched.

**Current code** (`nav_twr.py` lines 601-620):
```python
    flows = [(instant, amount) for instant, amount in timing.flows if amount != 0.0]
    instants = [instant for instant, _ in flows]
    n_cohorts = len(flows) + 1
    cohort_pnl = [0.0] * n_cohorts
    for open_instant, cash, _realized_instant in timing.pnl:
        k = 0 if open_instant is None else bisect.bisect_right(instants, open_instant)
        cohort_pnl[k] += cash
    judged: list[tuple[float, float]] = []
    capital = prev  # prev plus the flows of cohorts 1..k plus the P&L of cohorts 0..k-1
    for k in range(n_cohorts):
        if k > 0:
            capital += flows[k - 1][1]
        pnl = cohort_pnl[k]
        if (k > 0 or inception) and pnl == 0.0:
            # Nothing was opened on this capital (an inception day's cohort 0 has none
            # before the first deposit, D-12). Its flow already sits in ``capital``.
            continue
        judged.append((capital, pnl))
        capital += pnl
    return judged
```

**New rule** (RESEARCH "MT5D-04", verified in a scratch run; CONTEXT locked). Compute `later_judged = any(cohort_pnl[k] != 0.0 for k in range(1, n_cohorts))` once, then change the skip to `if pnl == 0.0 and (k > 0 or inception or later_judged): continue`. Update the docstring paragraph at lines 589-592 ("Cohort 0 is always measured, except on an inception day ...") to the new rule in the same edit. Phase 188's tiny-base test is NOT touched: it runs after `_timed_day_return` at the call site (`nav_twr.py` lines 870-876, judged on `prev`), so tiny precedence is preserved by not editing that block.

**Second-order effect to state in the plan:** the D-25 `small_base_measured_min_nav` computation at `nav_twr.py` lines 880-885 calls `_judged_cohorts` again, so it follows the new rule by construction. Do not edit it.

**Test analogs (all in `tests/test_nav_twr.py`). Two fixture shapes, because `_two_day_timed` cannot carry every arm (measured with a scratch probe against the real helper):**
- `_two_day_timed(prev, flows, pnl, floors)` (lines 1918-1934) holds day 0 flat at `prev`. For `prev` of 0, -0.5, 5 or 50 day 0 raises its OWN guard (`negative_nav_guard` or `dust_nav_guard`, day 0 NaN), so a "no flag" assertion is polluted, and the 30-day peak equals `prev`, so the peak-dependent arms (prev 150 against a 10,100 peak; prev 50 against a 100 peak) cannot be built. Use it only for arms whose `prev` is large and healthy (cohort 0 with P&L still judged; flow-only day unchanged; a non-empty-cohort-0 day), copying `test_timed_cohort_negative_base_is_guarded_not_clamped` (lines 2222-2228) and `test_timed_flow_only_day_keeps_a_zero_return` (lines 2241-2245):
```python
def test_timed_cohort_negative_base_is_guarded_not_clamped() -> None:
    returns, flags = _two_day_timed(1000.0, [(1000, -1500.0)], [(2000, 5.0, 2500)])
    assert np.isnan(returns.iloc[1])
    assert flags.get("negative_nav_guard") is True
```
- **Pure cohort-rule arms (prev 0, prev -0.5, prev 5 dust, a refund with and without a later cohort, cohort 0 with P&L) go to direct `_timed_day_return(prev, timing, floors, inception=False)` calls.** That function judges guards per cohort only (negative, dust, P&L-dominated); the tiny-base test is applied later at the `chain_linked_twr` call site, so it does not appear here. Analogs: `test_timed_inception_cohort_zero_empty_measures_after_the_first_deposit` (lines 2248-2256) and `test_timed_inception_pnl_before_the_first_deposit_keeps_the_guard` (lines 2266-2273):
```python
timing = DayTiming(flows=((1000, 1.0),), pnl=((2000, 0.011, 3000),))
got, key = _timed_day_return(residue, timing, _BTC_FLOORS, inception=True)
assert key is None
assert got == pytest.approx(0.011, abs=1e-12)
```
- **Peak-dependent arms (dust-not-tiny, tiny precedence) need a series of at least three days: fund, drain to `prev`, timed re-fund.** Recipe verified by scratch run against `chain_linked_twr` with `floors=USD_FLOORS` (a neutral copy of the new `_judged_cohorts` was monkeypatched in to read the NEW column; HEAD column read off the unpatched code):
```python
idx = _days(3)
nav = pd.Series([peak, prev, prev + 1000.0 + 50.0], index=idx, name="nav")
daily = pd.Series([0.0, 0.0, 50.0], index=idx, name="daily_pnl")
flows = pd.Series([0.0, prev - peak, 1000.0], index=idx, name="flows")   # day 1 drains, day 2 re-funds
timing = {idx[2]: DayTiming(flows=((1000, 1000.0),), pnl=((2000, 50.0, 2500),))}
returns, flags = chain_linked_twr(nav, daily, flows, floors=USD_FLOORS, timing=timing)
```
  Measured day-2 outcome (HEAD -> new rule): prev 0 / peak 10,100: NaN `negative_nav_guard` -> 0.05; prev -0.5: NaN `negative_nav_guard` -> 0.05003; prev 5 / peak 10,100: NaN `dust_nav_guard` -> NaN `tiny_base_guard` (label changes, day still left out); prev 150 and 400 / peak 10,100: NaN `tiny_base_guard` -> unchanged (188 precedence); prev 50 / peak 100: NaN `dust_nav_guard` -> 0.04762; prev 5 / peak 100: NaN `dust_nav_guard` -> 0.04975. **Assert the day-2 return and the guard KEYS (`negative_nav_guard`, `dust_nav_guard`, `tiny_base_guard` in or out of `flags`), not the whole flag set:** day 1's drain is itself a day-level flow day and adds `flow_timing_day_level(_days)` and sometimes `flow_timing_day_level_large(_days)` to every row. The Phase 188 tiny-base behaviour is pinned by `tests/test_mt5_deal_reconstruction.py` lines 1189 and 1453 (`meta.get("tiny_base_guard") is True`, `tiny_base_days`, `tiny_base_day_pnl`; both run `combine_mt5_deal_ledger` over `_mm2x_deals(events)`) and the `tests/test_tiny_base_*.py` family; cite those, not `test_nav_twr.py`, as the 188 analog.
- Money-math oracle: copy the independence rule of `_exact_cohort_return` (line 1862, "Shares NO code with `services.nav_twr`", exact `Fraction`). Do not import a production helper into a new oracle.
- **The mover to handle, not edit silently:** `test_inception_with_a_timing_measures_the_positions_opened_after_the_deposit` (lines 2453-2475). Its second half (lines 2473-2475) asserts `np.isnan(off.loc[day0])` and `"dust_nav_guard" in off_meta or "negative_nav_guard" in off_meta`; under the founder-ruled rule that day is measured. Replace the `off` half with a new test named for the new invariant (an empty cohort 0 on a timed day is skipped whenever a later cohort is judged, with or without `full_history`); quote the old assertion plus the ruling in the plan SUMMARY (PROOF-01 forbids a re-pinned value as a close). Keep the first half (lines 2458-2471) as is.

---

### `services/nav_twr.py` `chain_linked_twr` day-0 flag (utility, transform) - MT5D-05

**Analog:** the D-15 large-flow annotation in the same function.

**Count-then-flag pattern** (`nav_twr.py` lines 923-928 count; 946-948 flag emit):
```python
        if flow_t != 0.0 and abs(flow_t) >= FLOW_TIMING_LARGE_RATIO * prev:
            large_flow_days += 1
...
    if large_flow_days:
        flags["flow_timing_day_level_large"] = True
        flags["flow_timing_day_level_large_days"] = large_flow_days
```

**Where to change** (`nav_twr.py` lines 888-890, the bare `continue` of the inception branch, reached only when the day has no `DayTiming`):
```python
        if inception:
            # D-12: with no timestamps day 0 is the inception day: no return, no warning.
            continue
```
Replace the bare `continue` with the RESEARCH "Day-0 flag" snippet: `pnl_day0 = cur - prev - flow_t` (the loop's own expression; the non-inception branch names it `pnl_t` at line 907, do NOT use `daily_pnl.iloc[0]`), count it when `abs(pnl_day0) > _INCEPTION_PNL_NOISE_REL * max(abs(cur), abs(flow_t))` (recommended `1e-9`, RESEARCH A3, discretion), then `continue`. Add a counter next to `large_flow_days`, and emit `inception_day_pnl_dropped` (bool) and `inception_day_pnl_dropped_days` (int) after the loop beside lines 946-948. A count only, never the amount (T-73-02).

**Registry edits (copy the D-15 entries line for line):**
- `NavTWRMeta` (class at line 134): declare both keys beside `flow_timing_day_level_large: bool` / `flow_timing_day_level_large_days: int` (lines 236-237), with a comment block in the same voice as lines 229-235.
- `NAV_TWR_ANNOTATION_KEYS` (lines 313-327): append both keys after `"flow_timing_day_level_large_days"` (line 321). Never add to `NAV_TWR_GUARD_KEYS` (lines 286-298); membership promotes status to `complete_with_warnings`.
- `_build_nav_meta` (lines 1087-1144): add a present-only carry copying lines 1130-1135:
```python
    if flags.get("flow_timing_day_level_large"):
        meta["flow_timing_day_level_large"] = True
        if "flow_timing_day_level_large_days" in flags:
            meta["flow_timing_day_level_large_days"] = int(
                flags["flow_timing_day_level_large_days"]
            )
```
The `warn = any(k not in NAV_TWR_ANNOTATION_KEYS for k in flags)` line (1097) is what keeps a flag-only set at `complete`; no edit needed there.

**Test analogs:**
- `test_small_base_is_an_annotation_not_a_guard_key` (`tests/test_nav_twr.py` lines 1831-1852) iterates `NAV_TWR_ANNOTATION_KEYS` and requires each key in `NavTWRMeta.__annotations__`: it forces the declaration and goes RED if the key is missing. Add the new keys to a `_build_nav_meta` assertion in the same shape.
- `_inception_chain(residue, *, full_history, flow0)` (lines 2348-2356) and `test_inception_day_zero_residue_raises_no_flag_without_timing` (lines 2359-2368): the day-0 fixture. Pin both sides of the floor: P&L exactly 0.0 -> no flag, residue 1e-12 -> no flag, 0.01 -> flag. Assert `flags["inception_day_pnl_dropped_days"] == 1` and that no guard key is set (`not (set(flags) & set(NAV_TWR_GUARD_KEYS))`).
- Native path: also assert on `reconstruct_native_nav_and_twr` and the `combine_mt5_deal_ledger` day 0 (RESEARCH test map); the flag fires on every full-history key whose day 0 passes the inception predicate and carries P&L (Deribit, MT5, the ccxt strategies whose `_ccxt_full_history_verdict` is true). State this in the SUMMARY.

---

### `services/transforms.py` `_merge_status_meta` (utility, transform) - MT5D-05 carry

**Analog:** the D-15 carry in the same function, lines 374-377:
```python
    # 164.6.6.2.3 D-15: same present-only carry for the large-flow annotation (a day-level flow
    # at least the prior NAV, whose end-of-day return can be extreme). Never a warning.
    if nav_meta.get("flow_timing_day_level_large") is True:
        meta["flow_timing_day_level_large"] = True
```
Add the same two lines for `inception_day_pnl_dropped` (bool only, `is True`, no count: the in-process day count is never carried). Skipping this silently loses the flag on the ccxt path (the SHOULD-1 hazard its comments describe).

**Test analog:** `tests/test_transforms.py::test_flow_timing_day_level_carried_as_a_bool_and_never_promotes` (lines ~187-230): feed `_merge_status_meta` the key plus the `_days` count, assert the bool is carried, the hint stays `complete`, the count is absent, and `for bad in (False, None, 1, "true")` is not carried.

---

### `services/job_worker.py` prestamp block (service, derive) - MT5D-05 carry

**Analog:** lines 10978-10983:
```python
    # 164.6.6.2.3 / D-15 - ... BOOL only, present-only, `is True`, NEVER a member of
    # NAV_TWR_GUARD_KEYS (an annotation on a kept day is not a warning).
    if meta.get("flow_timing_day_level_large") is True:
        _prestamp_flags["flow_timing_day_level_large"] = True
```
Add the same two lines for the new bool, after it (a pure addition; Pitfall 5: do not reformat or move neighbouring statements, the vitest literal pins read this file's text).

**Test analogs:** `tests/test_job_worker.py` lines 2538-2554 (the prestamp assertions: `prestamp_flags` read from `captured["analytics_upserts"]`, `assert all(f.get("flow_timing_day_level_large") is True for f in prestamp_flags)`, `assert "flow_timing_day_level_large_days" not in f`, with the "removing the pre-stamp carry drops the key -> RED" neuter note); and `tests/test_derive_broker_dailies_dualmode.py` lines 859-874 (`meta.get("flow_timing_day_level_large") is True` and `"..._days" not in meta` on the derive meta, wrapper and core).

---

### `services/analytics_runner.py` `DataQualityFlags` + carry (service, transform) - MT5D-05 carry

**Analog (TypedDict):** lines 276-283, key `flow_timing_day_level_large: bool` with the comment "Stamped by the broker derive's pre-stamp ... An INFORMATIONAL annotation, never a warning ... A BOOL only (T-73-02)". Add `inception_day_pnl_dropped: bool` with a comment in the same voice.

**Analog (carry):** lines 2332-2337:
```python
            if existing_flags.get("flow_timing_day_level_large") is True:
                data_quality_flags["flow_timing_day_level_large"] = True
```
Add the same present-only, strictly-`is True`, outside-the-`_warned`-loops carry.

**Test analog:** `tests/test_csv_analytics_runner.py` lines 1832-1861: three tests using `_run_with_flags({...})`: carried and never promotes (`computation_status == "complete"`, `computation_warned is False`), beside a real guard still warns, and `@pytest.mark.parametrize("bad", [False, None, 1, "true", ["x"], {}])` not carried. Copy all three for the new key.

---

### `services/nav_twr.py` `FLOW_TIMING_LARGE_RATIO` (config, record only) - MT5D-06

**Analog:** the constant at line 93 (`FLOW_TIMING_LARGE_RATIO = 1.0`) with its comment block ending at line 92. Founder ruling: accept the band, no code change to the value. An optional comment-only dated line recording the acceptance and reason is allowed (no behaviour change; never widen the ratio).

**Test analog (already bites, no new test needed):** `test_f1_large_flow_boundary_is_the_retired_dominance_condition` (`tests/test_nav_twr.py` lines 2576-2601): `(1000.0, True)`, `(-1000.0, True)`, `(999.99, False)`, `(-999.99, False)`. PROOF-01 arm: neuter the constant to 0.5 in a byte copy, see the `999.99` arm fail first, restore by `cp` from the backup and `cmp`, GREEN.

---

### `services/job_worker.py` `_native_key_usd_writer_basis`, `_NativeKeyUsd`, store gate (service, CRUD) - MT5D-07 writer

**Analog 1 (the holed-key withhold block, the block precedent)** `job_worker.py` lines 8521-8535:
```python
                if _segment_terminals and int(meta.get("flow_timing_timed_days", 0)) > 0:
                    # A holed key whose days were measured on a DayTiming returns cohort
                    # returns, which the segment roll ... cannot reproduce. Withhold the terminals: the compose's
                    # existing missing-terminal rule then composes the key unsplit and raises
                    # key_inputs_mismatch (blocking) rather than rolling silently wrong levels.
                    # Counts only (T-164.6.6.2.3-16).
                    logger.warning(
                        "derive_broker_dailies: native mt5 key has %d interior unpriced hole(s) "
                        "and %d timed flow day(s) - segment terminals withheld, the book "
                        "reports key_inputs_mismatch (164.6.6.2.3 plan 06)",
                        len(_segment_terminals),
                        int(meta.get("flow_timing_timed_days", 0)),
                    )
                    _segment_terminals = []
```
Copy: the condition on `flow_timing_timed_days > 0`, a counts-only `logger.warning` (token name, timed-day count, unpriced-day count; never an id, day or amount), and the voice of the comment.

**Analog 2 (the store gate to extend with an `else`)** lines 10081-10100:
```python
        if (
            venue in WRITER_BASIS_VENUES
            and _composed_flows_usd is not None
            and _basis_day_pnl is not None
            and not _basis_day_pnl.empty
            and _realized_terminal is not None
        ):
            from services.allocator_equity_derive import writer_basis_payload

            _key_inputs_payload.update(
                writer_basis_payload(_basis_day_pnl, _composed_flows_usd)
            )
```
Add `elif venue == "mt5" and int(meta.get("flow_timing_timed_days", 0)) > 0:` writing `_key_inputs_payload["writer_basis_withheld"] = <closed token>` and the single counts-only warning (RESEARCH "Writer-token and reader-block skeleton"). Add new statements after the existing ones; do not reformat existing `_key_inputs_payload[...]` lines (Pitfall 5: `src/__tests__/tiny-base-literal-pin.test.ts` and `src/__tests__/options-cash-basis-literal-pin.test.ts` match source shapes such as `_key_inputs_payload["..."] = _tiny_listed` and `if _options_cash_basis_caveat is True: _key_inputs_payload["..."] = True`).

**Analog 3 (additive present-only field voice):** lines 10132-10137 (`options_cash_basis`): present-only, a bool or closed token, rewritten whole each derive, so it self-clears when a later derive stores the basis.
```python
        if _options_cash_basis_caveat is True:
            _key_inputs_payload["options_cash_basis"] = True
```

**Writer-basis function to change** (`_native_key_usd_writer_basis`, lines 4706-4761, single caller at line 4682). Token decision points, by where the `None` originates:
- **In the caller's guard at line 4681** (`if priced_through is not None and not hole_ends and not unpriced_iso:`), BEFORE the function runs: `priced_through is None` -> `no_usd_return_day` (G1); `hole_ends` non-empty -> `interior_hole` (G2); `unpriced_iso` non-empty with `hole_ends` empty -> `unpriced_days_without_interior_hole` (G3, the silent shape: no `segment_terminals`, no basis). The token for these three must be set in `_convert_native_key_to_usd`, not inside `_native_key_usd_writer_basis`.
- **Inside `_native_key_usd_writer_basis`** (return the basis tuple or a closed reason token instead of `None`): empty levels or P&L (line 4727) -> `no_levels_or_pnl`; `first > priced_through or first not in pnl_by_day` (4735) -> `first_day_unpriceable`; any day with no close (4738) -> `calendar_day_without_close`; `carried is None` (4746) -> `no_carried_level`.
- **Closure trap (same class as the `rows_payload` trap below):** the token must reach the store gate, which runs inside the `_run_key_mode_compose_epilogue` closure (line 9761). Declare a typed local beside the other basis locals (`_composed_flows_usd` at line 5896, `_composed_day_pnl_usd` at line 5902, both `"pd.Series | None" = None`), for example a `str | None = None` token, and assign it where `_composed_day_pnl_usd = _usd_key.composed_day_pnl` is unpacked (line 8518, inside the native-key branch). A name bound only inside that `if` branch raises `NameError` or reads stale at the epilogue on every other venue path. The marks-era rebuild at line 9712 reassigns `_composed_day_pnl_usd`; the token logic must not be overwritten by it. Add a defaulted trailing field to the `_NativeKeyUsd` NamedTuple (lines 4543-4558; one construction site at 4693-4703). Closed token set per RESEARCH: `no_usd_return_day`, `interior_hole`, `unpriced_days_without_interior_hole`, `no_levels_or_pnl`, `first_day_unpriceable`, `calendar_day_without_close`, `no_carried_level`, plus `store_gate_unmet` as the generic fallback at the gate.

**Test analogs (all in `tests/test_allocator_equity_writer_basis.py`):**
- `_derive_btc_key(monkeypatch, deals, *, equity, closes)` (lines 648-659), `_btc_hole_timed_ledger()` (717-732), `_HOLE_BTC_CLOSES` (709-714), and the compose harness `_compose_job(members)` (1064-1075).
- The holed-key RED/GREEN precedent to clone for the G3 shape, `test_a_holed_btc_key_with_a_timed_day_withholds_the_basis_and_the_terminals` (lines 735-761):
```python
    from tests.test_allocator_equity_dropped_day_pnl import _csv_returns

    book = await _compose_job(
        [{"id": "key-mt5", "payload": payload, "returns": _csv_returns(capture),
          "api_key": {"exchange": "mt5"}}]
    )
    assert "key_inputs_mismatch" in book["degrade_reasons"]
    assert book["is_trustworthy"] is False
```
- **Every MT5D-07 RED arm asserts `"key_inputs_mismatch" in book["degrade_reasons"]` by name**, never only `is_trustworthy is False` (an incidental `inception_unreconciled` can block). Use a small timed trade on a late (non-inception) day with a trailing close missing (RESEARCH "RED fixtures that already work at HEAD").
- Unchanged-behaviour pins that must stay green: `test_a_holed_btc_key_with_no_timed_day_is_stored_exactly_as_today` (lines 764-788, asserts `"key_inputs_mismatch" not in book["degrade_reasons"]`), `test_an_mt5_key_mode_derive_stores_its_composed_flows_and_day_pnl` (line 345, USD timed key stores a basis and no token), and `test_a_stitched_mt5_account_without_the_basis_is_counted_not_blocked` (lines 1503-1537, legacy rows lack the token so they are NOT blocked: key the block on the token, never on an absent basis).

---

### `services/allocator_equity_derive.py` sibling helpers (utility, transform) - MT5D-07 reader and HOLD-03

**Analog:** `writer_basis_payload` (lines 1793-1825) for the writer side, `_read_basis_rows` (lines 1828-1849) and `read_realized_terminal` (lines 1772-1790) for the reader side. `read_writer_basis` (lines 1852-1871) stays BYTE-UNCHANGED (Pitfall 7: editing it fires the open `167.1.2.2.1-WRITER-BASIS-EMPTY-READS-LEGACY` entry's trigger). Add siblings after it.

**Writer-side pattern to copy for `returns_stamp_payload(returns)`** (lines 1817-1825):
```python
    pnl_rows: list[dict[str, Any]] = []
    for ts, raw in day_pnl.items():
        amount = float(raw)
        if not math.isfinite(amount):
            raise NavReconstructionError(
                "key_inputs composed day P&L: non-finite amount — refusing to persist it"
            )
        pnl_rows.append({"utc_day_iso": pd.Timestamp(ts).date().isoformat(), "pnl_usd": amount})
    return {"composed_flows": flow_rows, "composed_day_pnl": pnl_rows}
```
Refuse a non-finite value before the upsert with a message that names no amount and carries no digit (the existing test pins this). Row shape `{utc_day_iso, return}`; built from exactly the rows the exit wrote.

**Reader-side patterns:**
```python
def _read_basis_rows(raw: Any, amount_key: str, label: str) -> dict[str, float]:
    """{ISO day: amount} from one stored basis field; every malformation is a ``ValueError``."""
    if not isinstance(raw, list):
        raise ValueError(f"key_inputs {label}: not a list")
    ...
        # ``float(True) == 1.0``: a JSON boolean would be read as a dollar (as in the neighbours).
        if isinstance(raw_amount, bool) or not isinstance(raw_amount, (int, float)):
            raise ValueError(f"key_inputs {label}: non-numeric amount")
    ...
        if day in out:
            raise ValueError(f"key_inputs {label}: duplicate day")
```
`read_returns_stamp(payload) -> dict[str, float] | None` reuses `_read_basis_rows(raw, "return", "returns stamp")`; absent or null returns `None` (legacy row, not refused, counted at info level). `read_writer_basis_withheld(payload) -> str | None`: an unknown token still blocks (forward compatible); a non-string, non-null value raises `ValueError` like `read_realized_terminal` does for a bad amount (lines 1785-1789). `returns_stamp_mismatch_days(stamp, series, *, tol)` returns a count over the stamp's own `[first, last]` window; a day on one side only or `abs(diff) > tol` is a mismatch; a stored row after `last` is ignored; tolerance `1e-12` in return space (RESEARCH, discretion, to be stated and pinned).

**Reason mapping:** `DegradeReason.KEY_INPUTS_MISMATCH` (line 153) is a member of `_BLOCKING_REASONS` (lines 182-196), so no new reason or flag consumer is needed (Don't Hand-Roll).

**Test analogs (`tests/test_allocator_equity_writer_basis.py`):**
- Non-finite refusal: `test_a_non_finite_value_is_refused_before_the_upsert_without_naming_an_amount` (lines 177-194):
```python
    with pytest.raises(NavReconstructionError, match="refusing to persist it") as exc:
        writer_basis_payload(pnl, flows)
    assert "nan" not in str(exc.value).lower() and "inf" not in str(exc.value).lower()
    assert not any(ch.isdigit() for ch in str(exc.value))  # counts-only: no amount, no day
```
- Round-trip and older-row reads: `test_the_payload_keeps_every_nav_day_of_pnl_and_only_the_nonzero_flow_days` (197-212), `test_an_older_row_reads_as_none` (225-228, parametrize `{}` and null).
- Malformed-field table: `test_a_malformed_stored_field_raises_rather_than_being_read_as_a_guess` (249-270) with `_good()` / `_with(field, rows)` helpers: clone for the stamp (duplicate day, bad day, str amount, bool, nan, inf, not a list, malformed row).
- Determinism: `test_two_derives_over_the_same_stored_inputs_store_byte_equal_composed_fields` (line 849): extend so the stamp is byte-equal too.

---

### `services/job_worker.py` returns writes and `_run_key_mode_compose_epilogue` (service, CRUD) - HOLD-03 writer

**Analog (main exit rows):** lines 10517-10529 (`rows_payload`, excludes NaN days):
```python
    if is_key_mode:
        rows_payload = [
            {
                "api_key_id": api_key_id,
                "allocator_id": allocator_id,
                "strategy_id": None,
                "date": ts.date().isoformat(),
                "daily_return": float(val),
            }
            for ts, val in returns.items()
            if pd.notna(val)
        ]
```
**Analog (`<2-day` exit with marks):** lines 10255-10271, the `_measured` list upserted for marked days; at that exit WITHOUT marks nothing is written, so write NO stamp (Pitfall 3).

**Closure trap (Pitfall 2):** `_run_key_mode_compose_epilogue` (line 9761) is a closure defined before `rows_payload` exists and is called from both exits (line 10320 at the `<2-day` exit, line 10696 at the main exit). Initialise an explicit typed variable (for example `_returns_stamp_rows: list[dict[str, Any]] | None = None`) beside the other epilogue variables near lines 5871-5887, assign it at each exit immediately before the epilogue call, and have the epilogue read it; a bare reference to `rows_payload` raises `NameError` at the short exit. mypy strict needs the annotation. The stamp is written only inside the writer-basis gate (`venue in WRITER_BASIS_VENUES`), as an additive `_key_inputs_payload.update(...)` statement after the `writer_basis_payload` update (lines 10096-10100).

**Test analogs:** `_derive_btc_key` / `_run_mt5_key_derive` (line 304) for derive-to-compose; the HOLD-03 RED pair is "derive twice over the same terminal, one trade P&L changed (quiet day, separately the timed day), compose derive A's `key_inputs` payload with derive B's `_csv_returns(capture)`", asserting `"key_inputs_mismatch" in book["degrade_reasons"]` (RESEARCH measured `degrade_reasons == []`, `is_trustworthy is True` at HEAD). Healthy-pair family that must never be refused: timed flow day, net-zero timed day, guard-NaN day, tiny-base NaN day, gap-fill rows, marks era, absent stamp, stitched account.

---

### `services/job_worker.py` `run_derive_allocator_equity_job` read loop and `_compose` (service, request-response) - MT5D-07 and HOLD-03 reader

**Analog (the three read sites, copy the shape at each):** departed (lines 17085-17087), stitch source (17111-17113), counted (17130-17132):
```python
                    _departed_basis = read_writer_basis(departed_payload)
                    if _departed_basis is not None:
                        writer_basis_raw[api_key_id] = _departed_basis
```
```python
                    _source_basis = read_writer_basis(source_payload)
                    if _source_basis is not None:
                        source_writer_basis[api_key_id] = _source_basis
```
```python
            _basis = read_writer_basis(payload)
            if _basis is not None:
                writer_basis_raw[api_key_id] = _basis
```
Add, at each of the three sites, a call to `read_writer_basis_withheld(<payload>)` that adds the key to a `withheld_keys` set, and (HOLD-03) the stamp compare of that key's RAW series against `read_returns_stamp(<payload>)` adding the key to a `stamp_mismatch_keys` set. The compare must run per raw key BEFORE `stitch_shared_account` replaces `returns_by_key[kept_id]` (line 17354) (Pitfall 4: the replay sees the joined series, not each member's own rows). Source series for a stitch source come from `source_returns`, for the counted key from `returns_by_key`. Remove a key from both sets wherever the job REMOVES it from the book. Real removal sites (read in full): the loop at lines 17673-17694, where a failing or marked key with a `key_inputs` row and no returns is popped from every per-key map via `for _map in (anchors_by_key, null_anchor_reasons, flows_by_key, dropped_pnl_by_key, realized_terminal_by_key, writer_basis_by_key): _map.pop(_k, None)` (lines 17679-17683) and its `no_capital_stored` twin tuple (17684-17690); add a `discard(_k)` on both new sets there (a set is not in the tuple, so it will not be popped by it). Line 17694 (`failing_key_exit_by_key[_k] = (_reason_k, None)`) is an assignment that NAMES the exit, not a removal. The other exits do NOT remove the key: the failing-key exit at lines 17555-17566 moves it to `departed_end_by_key` (its history still counts to its last day, so a token on it still applies), and the no-capital candidate exit (lines 17426-17489) keeps the key and only trims its flows, dropped P&L and basis to `_nc_end`; leave the sets untouched at both. A departed key's own row is read at the departed site (line 17085).

**Analog (reason row in `_compose`)** lines 17745-17754:
```python
            degrade_reasons=[
                reason
                for reason, raised in (
                    (DegradeReason.SHARED_ACCOUNT_HISTORY_TRUNCATED, truncated_accounts > 0),
                    (DegradeReason.SHARED_ACCOUNT_NO_WORKING_KEY, no_working_groups > 0),
                    (DegradeReason.SHARED_ACCOUNT_FLOWS_DISAGREE, flows_disagree_accounts > 0),
                    (DegradeReason.ACCOUNT_IDENTITY_PENDING, identity_pending_venue_count > 0),
                )
                if raised
            ]
            or None,
```
Add `(DegradeReason.KEY_INPUTS_MISMATCH, bool(withheld_keys) or bool(stamp_mismatch_keys))` as one more tuple. The no-capital fallback's second compose reuses `_compose`, so the reason survives it.

**Analog (counts-only warning)** lines 17356-17365 (`flows_disagree_accounts`): `logger.warning("derive_allocator_equity: %d ... for allocator %s ...", count, allocator_id, DegradeReason.X.value)`. Emit one for withheld keys (key count and token histogram) and one for stamp mismatches (key count and mismatching-day count); no key id, venue id, day or USD (T-167.1.2-22, T-73-02).

**Analog (corrupt-input disposal):** the reads at 17055-17146 sit inside the `try` whose `ValueError`/`TypeError` disposes as a corrupt input; the new readers must raise there (`ValueError`), never guess.

**Test analogs:** `_run_compose` / `_compose_job` (`tests/test_allocator_equity_writer_basis.py` lines 1017-1075), `_stored_row` (1078), `test_a_malformed_stored_basis_disposes_the_compose_job_as_a_corrupt_input` (line 1884), `test_a_departed_key_whose_row_carries_the_fields_is_replayed_on_the_writer_basis` (line 1824, departed site), `test_the_writer_basis_adds_no_degrade_reason` (line 1908, re-check that this pin still holds for a healthy row).

---

### `scripts/mt5_soak.py` `_walk_cohorts` (utility, independent oracle) - soak rule

**Analog:** itself (lines 591-616). It encodes the OLD rule in code and in its docstring, so after the derive change it is RED against correct output (Pitfall 6).
```python
    capital = prev
    cohorts: list[tuple[float, float]] = []
    for k, pnl in enumerate(cohort_pnl):
        if k > 0:
            capital += flows[k - 1][1]
        if not ((k > 0 or inception) and pnl == 0.0):
            cohorts.append((capital, pnl))
        capital += pnl
    return cohorts
```
Rewrite from CONTEXT's rule text (skip an empty cohort 0 whenever a later cohort on the day holds P&L; a cohort 0 with P&L is always judged; a day with no judged cohort keeps today's behaviour), not by copying the production edit: this module's contract is "SPEC ONLY ... re-implemented here and never imported" (docstring of `_walk_timed_return`, lines 622-627; PITFALLS Pitfall 12). Update the docstring sentence "(the one exception is the first cohort of a non-inception day)" (line 601) and the `indeterminate` text in `_reconcile_published_returns` that says an "empty cohort ... skipped" (lines 804-812). `_RETURN_CHECK_TOL = 1e-9` (line 254) is the tolerance precedent (also the cited basis for the day-0 noise floor).

**Test analog (`tests/test_mt5_soak.py`):** the zero-base sweep param `[10000.0-10050.0]` of `test_one_checked_day_among_knife_edge_sweep_days_is_not_green` (lines 2746-2758) goes red with `timed_day_not_nan` because its premise changed: those days are now measured. Keep the CR-04 intent (an indeterminate day certifies nothing) with a NEW fixture whose judged cohort base is on the knife edge, built like `_funded_each_morning_and_swept_each_evening(first_deposit, drain, sweep_days)` (lines 2708-2739, uses `_stamped_deal`, `_ms`, `_DEAL_TYPE_*`). The `[1000.0-950.0]` dust-floor param did not move. Also add a hand-built `Fraction` walk check of the new rule, and a RED proof: revert `_walk_cohorts` to the old rule in a byte copy and show `timed_day_not_nan` on the re-fund fixture first.

**Operational:** the live `python -m scripts.mt5_soak` run needs `MT5_SPIKE_*` credentials and is a founder checkpoint; the offline suite runs with an injected client. Record only verdict lines in the SUMMARY, never the raw JSON (public repo).

---

## Shared Patterns

### Annotation (not warning) carry chain
**Source:** the `flow_timing_day_level_large` sites: `services/nav_twr.py` lines 236-237, 320-321, 946-948, 1130-1135; `services/transforms.py` lines 374-377; `services/job_worker.py` lines 10978-10983; `services/analytics_runner.py` lines 283 and 2332-2337.
**Apply to:** the MT5D-05 day-0 flag. Rules: bool only (the day count stays in-process), present-only, strictly `is True` at every hop, never in `NAV_TWR_GUARD_KEYS`, no frontend change (an unknown `data_quality_flags` key is ignored by `src/lib/factsheet`).

### Additive present-only `key_inputs` jsonb fields, no migration
**Source:** `services/job_worker.py` lines 10056-10162 (every field is written as an `if ...: _key_inputs_payload[...] = ...` statement in the "167.1.2.2 D-15 voice": a reader that does not know it, and a row written before it, are both fine; the payload is rewritten whole each derive, so a field self-clears).
**Apply to:** `writer_basis_withheld` and the returns stamp. Add statements; do not reformat or move existing ones (Pitfall 5).

### Counts-only logging
**Source:** the holed-key warning (`job_worker.py` lines 8528-8534) and the compose warnings (lines 17356-17376).
**Apply to:** every new log line. Closed token names and counts only; never an id, day, amount or instrument (T-73-02, T-115-05, T-164.6.6.2.3-16). Non-finite poison is refused before the upsert with a message carrying no digit.

### Blocking mismatch via the caller-supplied `degrade_reasons=` list
**Source:** `job_worker.py` lines 17745-17754 plus `DegradeReason.KEY_INPUTS_MISMATCH` (`allocator_equity_derive.py` line 153) in `_BLOCKING_REASONS` (lines 182-196).
**Apply to:** MT5D-07 and HOLD-03. One reason, one list; do not add a new reason and do not pop the basis (the existing mismatch precedents fall back to the legacy roll and block).

### Independent oracles and PROOF-01
**Source:** `tests/test_nav_twr.py::_exact_cohort_return` (line 1862, hand-coded `Fraction`, "Shares NO code with `services.nav_twr`"), `tests/test_allocator_equity_writer_basis.py::_btc_usd_oracle` (lines 624-645, "Nothing here reads a deal row or a return") and `_Forward` (line 1168).
**Apply to:** every new money-math assertion. Per gate: byte-copy the file, neuter it, see the NAMED arm go RED first, restore by `cp` and `cmp`, GREEN, record verbatim in the plan SUMMARY. The PROOF-01 neuter table is in RESEARCH "Validation Architecture". Never `git checkout`/`restore`/`stash` on uncommitted work. The frozen spine (`tests/test_golden_parity.py`, `tests/test_mt5_golden_fixtures.py`) stayed green under the cohort rule in the research run, so `regen_golden.py` is never run.

### Repo-hygiene at ship (not code patterns, but plan tasks)
- TODOS entries to delete in the same PR and name in the CHANGELOG: `[164.6.6.2.3-EMPTY-COHORT0-REFUND]`, `[164.6.6.2.3-INCEPTION-DAY0-PNL]`, `[164.6.6.2.3-D15-THRESHOLD-BAND]`, `[164.6.6.2.3-MT5-BASIS-SILENT-NONE]`, and the section `### 167.1.2.2.1-WRITER-BASIS-VALUES`. Keep `[164.6.6.2.3-DERIBIT-INTRADAY-TIMING]` and `### 167.1.2.2.1-WRITER-BASIS-EMPTY-READS-LEGACY` open.
- CHANGELOG entry and a 4-digit VERSION bump in the same commit; never write a skip-CI token in a commit message or PR body.
- Vitest literal pins to run after `job_worker.py` edits: `npx vitest run src/__tests__/tiny-base-literal-pin.test.ts src/__tests__/options-cash-basis-literal-pin.test.ts`.
- 155.2 freeze: this phase moves published MT5 returns, so merge before 155.2 plan 12's recapture or after plan 14; re-check `155.2-12-SUMMARY.md` on origin/main at ship.

## No Analog Found

None. Every change has an in-file or sibling analog. Three items are first uses of a shape in this codebase, with the closest precedent noted:

| Item | Role | Data Flow | Reason / closest precedent |
|------|------|-----------|----------------------------|
| Per-day returns stamp inside `key_inputs` (`returns_stamp`) | payload field | CRUD | No existing returns-record field. Closest: `writer_basis_payload` (per-day list, non-finite refusal) read by `_read_basis_rows`. |
| Closed-token field `writer_basis_withheld` | payload field | CRUD | No existing closed-token reason field on `key_inputs`. Closest: `anchor_null_reason` (a string token read with `isinstance(_reason, str) and _reason`, `job_worker.py` lines 17135-17140) and `nav_mark_refusal` (line 10115). |
| Stamp compare at the compose read loop (before `stitch_shared_account`) | reader check | request-response | No per-key returns compare exists. The nearest same-site hooks are the three `read_writer_basis` calls (lines 17085, 17111, 17130). |

## Metadata

**Analog search scope:** `services/nav_twr.py`, `services/transforms.py`, `services/job_worker.py`, `services/analytics_runner.py`, `services/allocator_equity_derive.py`, `scripts/mt5_soak.py`, `tests/test_nav_twr.py`, `tests/test_mt5_soak.py`, `tests/test_allocator_equity_writer_basis.py`, `tests/test_transforms.py`, `tests/test_csv_analytics_runner.py`, `tests/test_allocator_equity_dropped_day_pnl.py`, and the two vitest literal pins under `src/__tests__/`.
**Files scanned:** about 14 (each analog read once for the ranges cited; large files read by targeted non-overlapping ranges after Grep).
**Tracked-source gate:** every path named in this document was checked with `git ls-files --error-unmatch` using its repo-root-relative form (`analytics-service/...` and `src/__tests__/...`) and all print as tracked: the six production files, the nine test files named here (`test_nav_twr.py`, `test_mt5_soak.py`, `test_allocator_equity_writer_basis.py`, `test_transforms.py`, `test_csv_analytics_runner.py`, `test_job_worker.py`, `test_allocator_equity_dropped_day_pnl.py`, `test_derive_allocator_equity_job.py`, `test_mt5_deal_reconstruction.py`, `test_mt5_derive_branch.py`, `test_derive_broker_dailies_dualmode.py`), the two golden tests and the two vitest pins. No gitignored mirror path appears in this document.
**Pattern extraction date:** 2026-11-24

## PATTERN MAPPING COMPLETE
