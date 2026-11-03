# Phase 185: DERIBITFLOWTIME (replanned, D-04: Deribit allocator books value open options at market) - Pattern Map

**Mapped:** 2026-11-01
**Files analyzed:** 14 (4 Python source touch points in 2 files, 3 Python test files, 7 frontend files/tests)
**Analogs found:** 13 / 14 (1 partial: the crawl/assemble split has only the `nav_twin` precedent)

All paths are repo-relative and git-tracked (`git ls-files` verified for every analog named). No key ids, PROD ids, amounts or home paths appear below. Line numbers were read at this checkout and drift; the SYMBOL is the stable handle.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `analytics-service/services/deribit_ingest.py` (assemble a smoothed ledger from the SAME crawl's raw rows; opt-in on `build_deribit_native_ledger` or a split) | service (ledger adapter) | batch / transform | same file: `build_deribit_native_ledger` `nav_twin` block + smoothed merge block | role-match (partial: no existing "second basis from same rows" for the smoothed basis) |
| `analytics-service/services/job_worker.py` `run_derive_broker_dailies_job` key-mode block (basis selection, local fallback, budget bound, flag) | service (job handler) | request-response + batch | same file: smoothed THIRD pass (`SMTM-01`) structural/timeout arms + `meta["pre_mark_retention_option_dailies"]` stamp | exact (pattern), inverted gate |
| `analytics-service/services/job_worker.py` `_run_key_mode_compose_epilogue` (present-only caveat flag in `key_inputs`) | service (writer) | CRUD (upsert) | same file: `_key_inputs_payload["marks_since"]` block | exact |
| `analytics-service/tests/test_deribit_key_mode_options_basis.py` (NEW) | test | request-response (derive harness) | `tests/test_allocator_equity_writer_basis.py` `_run_derive` | exact |
| `analytics-service/tests/test_mtm_single_key.py` (EDIT: rewrite `test_key_mode_never_runs_second_pass`, harness stub signature) | test | request-response | same file: `_recording_ledger`, `test_structural_smoothed_failure_degrades_keeps_cash_mtm`, `test_mtm_second_pass_timeout_degrades_loud_not_failed_final` | exact |
| seam test (pre-mark smoothed vs marked days, no double count) inside the new module | test | transform | `tests/test_nav_marks_compose_roundtrip.py` (`derive_key_ccxt`, `compose_curve`, `assert_levels`) | role-match (that file is ccxt/okx; Deribit seeding must be added) |
| ingest-level smoothed-from-same-rows test (inside new module or `tests/test_smoothed_mtm_core.py`) | test | batch | `tests/test_smoothed_mtm_core.py` `_run_options_ledger`, `test_perp_only_smoothed_zero_fetches_byte_identical` | exact |
| `src/lib/<new>-flag module` (e.g. `src/lib/options-cash-basis-flag.ts`: constant + strict reader) | utility | transform | `src/lib/nav-marks-start.ts` (`MARKS_SINCE_FLAG`, `parseMarksStart`) | exact |
| `src/__tests__/<new>-literal-pin.test.ts` (NEW) | test | file-I/O (raw-source grep) | `src/__tests__/nav-marks-start-literal-pin.test.ts` | exact |
| `src/lib/queries.ts` (`readMarksStart` extended OR sibling reader; payload field on `MyAllocationDashboardPayload`; both return branches) | service (server query) | CRUD read | same file: `readMarksStart` + `marksTrailingSince` carry | exact |
| `src/lib/queries.my-allocation.test.ts` (EDIT) | test | request-response | same file: the `paused(...)` / `marksTrailingSince` cases | exact |
| `src/app/(dashboard)/allocations/AllocationDashboardV2.tsx` (destructure prop, add to `useMemo` meta + deps) | component | request-response | same file: `marksTrailingSince` | exact |
| `src/lib/factsheet/allocator-portfolio-payload.ts` + `src/lib/factsheet/types.ts` (`dataQuality.<flag>`) | utility / type | transform | same files: `marksTrailingSince` spread; `dataQuality.flowTimingDayLevelLarge` type | exact (spread pattern), role-match (target field is `dataQuality`, today not written by this builder) |
| `src/app/factsheet/[id]/v2/FactsheetView.tsx` (third condition and sentence in the amber paragraph) | component | request-response | same file: the `smallBaseMeasured`/`flowTimingDayLevelLarge` paragraph | exact |
| `src/lib/factsheet/allocator-portfolio-payload.test.ts`, `src/app/factsheet/[id]/v2/FactsheetView.kpistrip.test.tsx` (EDIT) | test | transform / render | same files: `marksTrailingSince` describe; `flowTimingDayLevelLarge` describe | exact |

Existing plan files `185-06-PLAN.md` / `185-07-PLAN.md` already encode the writer/reader hop structure for the flow-timing label; RESEARCH Q8 says adapt (new flag name and sentence, new trigger, self-clearing removal), do not copy their flag. Plans 02-05 are dropped.

## Pattern Assignments

### `analytics-service/services/job_worker.py` key-mode basis selection (service, request-response/batch)

**Analog:** the smoothed THIRD pass in the same function (`SMTM-01 (Phase 132)`, ~lines 5672-5862) for budget, structural-degrade and warning-stamp shape; the cash pass (~5339-5458) for where the key-mode ledger and the four writer quantities are produced.

**Where the four writer quantities come from (all must read the SAME ledger; RESEARCH Q6, Pitfall 3)** (~5454-5476):
```python
returns, meta = combine_native_ledger(
    native_ledger,
    _completeness.indexable_currencies,
    denominator_config=denominator_config,
)
if is_key_mode and denominator_config is None:
    _day_pnl_usd = native_ledger_day_pnl(native_ledger, _completeness.indexable_currencies)
    _realized_terminal = native_ledger_realized_terminal(native_ledger, _completeness.indexable_currencies)
    _composed_flows_usd = native_ledger_composed_flows(native_ledger, _completeness.indexable_currencies)
```
The key-mode options step belongs between the cash `build_deribit_native_ledger`/`assert_ledger_complete` (~5339-5350) and this block: on success rebind `native_ledger` (and `returns`/`meta`) to the options-basis ledger so every downstream reader (`native_ledger.flow_instants` at the apply seam ~7940/7950, the writer terminal at ~7967, the epilogue) sees one ledger.

**Gate being reversed** (verbatim, ~5546-5550 and ~5716-5721):
```python
if (
    not is_key_mode
    and pnl_basis == DEFAULT_PNL_BASIS
    and _completeness.has_option_activity
):
```
Key mode keeps `pnl_basis == DEFAULT_PNL_BASIS` (key mode has no `denominator_config`, so the basis is always the default) and gains `is_key_mode and denominator_config is None and _completeness.has_option_activity`. Do NOT run through the RT-4 guard at ~5275 (`if pnl_basis == PNL_BASIS_SMOOTHED_MTM and not is_smoothed_mtm_enabled()` returns FAILED permanent); the key-mode path must not set `pnl_basis` to smoothed. Founder question F6 decides whether `is_smoothed_mtm_enabled()` is consulted at all (RESEARCH recommends not).

**Budget bound** (copy shape from ~5732-5756; constants `_MTM_SECOND_PASS_BUDGET_FRACTION = 0.7`, `_MTM_SECOND_PASS_MIN_SECONDS = 60.0`, `_derive_start`, `TIMEOUT_PER_KIND`, `_DERIVE_BUDGET_DEFAULT_S` already in scope):
```python
_smoothed_budget = float(TIMEOUT_PER_KIND.get("derive_broker_dailies", _DERIVE_BUDGET_DEFAULT_S))
_smoothed_remaining = _smoothed_budget - (asyncio.get_running_loop().time() - _derive_start)
_smoothed_pass_timeout = _smoothed_remaining * _MTM_SECOND_PASS_BUDGET_FRACTION
if _smoothed_pass_timeout < _MTM_SECOND_PASS_MIN_SECONDS:
    # degrade: keep cash, log (scrubbed), never start the step
```
Difference to flag in the plan: the strategy pass bounds a whole second crawl; key mode bounds only the options step (N_held chart requests + dense marks + combine) because the crawl is reused.

**Off-loop combine** (copy, ~5788-5795):
```python
smoothed_returns, _smoothed_meta = await asyncio.to_thread(
    combine_native_ledger, _smoothed_ledger, _smoothed_completeness.indexable_currencies,
    denominator_config=denominator_config,
)
```

**Structural-degrade arms (copy the tuple EXACTLY; transients must keep propagating)** (~5815-5862):
```python
except asyncio.TimeoutError:
    ...  # degrade to cash, log with %.0fs budget and id only
except (
    LedgerValuationError,
    NavReconstructionError,
    LedgerCompletenessError,
    LedgerTruncatedError,
    CurrencyEnumerationError,
    ScopeAuthError,
) as _smoothed_exc:
    ...  # degrade to cash; logger.warning(... scrub_freeform_string(str(_exc)))
```
Key-mode difference: the degrade also sets the caveat flag (see epilogue below) and must keep the cash ledger as `native_ledger`. The cash pass's own outer arms (`except asyncio.TimeoutError` -> transient at ~5863; `except LedgerValuationError`/`NavReconstructionError` -> permanent, `_record_refusal`) are what a smoothed-only failure must NEVER reach (Pitfall 2). Do NOT catch bare `ValueError`, `DeribitTransientReadError`, ccxt network errors.

**Retention warning stamp** (copy, ~5807-5814; key mode may stamp `meta` the same way and/or drive the flag from it, RESEARCH F2/Q8):
```python
if _smoothed_completeness.pre_mark_retention_option_days:
    meta["pre_mark_retention_option_dailies"] = [
        f"{ccy}:{day}" for ccy, day in _smoothed_completeness.pre_mark_retention_option_days
    ]
```

---

### `analytics-service/services/deribit_ingest.py` same-crawl smoothed assembly (service, batch/transform)

**Analog:** `build_deribit_native_ledger` itself. Two blocks supply every piece; nothing new needs inventing, only recombining.

**Smoothed merge (the pieces to reuse)** (~2780-2798):
```python
series_daily = native_daily
smoothed_terminal_book: dict[str, float] = {}
smoothed_delta_mtm: dict[str, dict[str, float]] = {}
if pnl_basis == PNL_BASIS_SMOOTHED_MTM and deribit_raw_rows_have_option_activity(raw_rows):
    smoothed_delta_mtm, smoothed_terminal_book, pre_retention = (
        await _build_smoothed_option_mtm(exchange, raw_rows, sleep=sleep)
    )
    report.pre_mark_retention_option_days = pre_retention
    series_daily = {ccy: dict(days) for ccy, days in native_daily.items()}
    for ccy, day_map in smoothed_delta_mtm.items():
        bucket = series_daily.setdefault(ccy, {})
        for day, change in day_map.items():
            bucket[day] = bucket.get(day, 0.0) + change
native_pnl = {ccy: _native_daily_to_series(day_map) for ccy, day_map in series_daily.items()}
```

**Wedge branch that makes the level include the option book** (~2939-2944):
```python
if pnl_basis in (PNL_BASIS_MARK_TO_MARKET, PNL_BASIS_SMOOTHED_MTM):
    terminal_upnl_native: Mapping[str, float] = state.native_upnl
else:
    terminal_upnl_native = {c: _cash_basis_wedge(state, c) for c in _cash_wedge_currencies(state)}
```

**Identity guard with the smoothed channels** (~2872-2883): `assert_balance_identity(raw_rows, native_daily, native_floor=..., open_option_ccys=open_opt, exclude_spot_extraction=..., pnl_basis=pnl_basis, terminal_book=smoothed_terminal_book if pnl_basis == PNL_BASIS_SMOOTHED_MTM else None, native_options_value=state.native_options_value, native_options_session_upl=state.native_options_session_upl, option_delta_mtm=smoothed_delta_mtm)`.

**The "second ledger from the SAME crawl" precedent: `nav_twin`** (~2954-3008, docstring ~2715-2727): reuses `marks`, `state`, `native_flows`, `native_floor`, `open_opt`; re-aggregates `txn_rows_to_native_daily` from `raw_rows`; wraps ONLY the twin steps in `try ... except LedgerValuationError` and records `report.nav_twin_error = type(exc).__name__`; returns `replace(ledger, native_pnl=...)` on the report:
```python
report.nav_twin_ledger = replace(
    ledger,
    native_pnl={ccy: _native_daily_to_series(day_map) for ccy, day_map in twin_series_daily.items()},
)
...
except LedgerValuationError as exc:
    report.nav_twin_error = type(exc).__name__
    logger.warning("build_deribit_native_ledger: nav twin unbuildable (error=%s)", type(exc).__name__)
```
Planner choice (RESEARCH Q1 "design constraints"): either (a) an opt-in kwarg that assembles the smoothed ledger from `raw_rows` into a report field like `nav_twin_ledger`/`nav_twin_error`, or (b) split crawl and assemble (`_crawl_deribit_ledger` already returns `raw_rows`). Gaps the nav_twin precedent does NOT cover and the plan must handle:
- `nav_twin` reuses the cash `marks`; the smoothed ledger's `native_pnl` span includes the DeltaMTM days, so `_build_dense_native_marks(...)` (~2814, takes `native_pnl`, `native_flows`, terminal equity/wedge, `raw_rows`) may need to be re-run over the merged `native_pnl` or its span proven sufficient (RESEARCH A6: test it, do not assume).
- The terminal wedge differs (`state.native_upnl` vs `_cash_basis_wedge`) so the options ledger needs its own `terminal_upnl_native`, not a copy of the cash ledger's.
- Smoothed needs `since_ms=None` (WR-05 guard at ~2744); the key-mode cash crawl is already full-history.
- Gate on `deribit_raw_rows_have_option_activity(raw_rows)` (~1235) so a perp-only key is byte-identical to cash (Pitfall 1).

**Test-harness caveat:** `tests/test_mtm_single_key.py::_recording_ledger._impl` has a FIXED signature `(exchange, *, account_state, pnl_basis, exclude_spot_extraction, nav_twin=False)`. Any new kwarg on `build_deribit_native_ledger` must be added there the same way `nav_twin` was, or every key-mode test errors on an unexpected keyword.

---

### `analytics-service/services/job_worker.py` `_run_key_mode_compose_epilogue` caveat flag (service, CRUD upsert)

**Analog:** the present-only `marks_since` block (~8608-8622), same function, same payload dict.
```python
_key_inputs_payload = {
    "flows": _flows_payload,
    "anchor_usd": _anchor_usd,
    "anchor_null_reason": _anchor_null_reason,
    "anchor_asof": ...,
    "venue": venue,
}
...
if _applied_marks is not None:
    _key_inputs_payload["marks_since"] = _applied_marks.marks_since
    if _applied_marks.mark_gap_days:
        _key_inputs_payload["mark_gap_days"] = list(_applied_marks.mark_gap_days)
    if _marks_trailing_since is not None:
        _key_inputs_payload["marks_trailing_since"] = _marks_trailing_since
```
New block (same voice, present-only, strict): `if _options_cash_basis_caveat is True: _key_inputs_payload["<flag>"] = True`. The module-level `_options_cash_basis_caveat: bool = False` local belongs with the other epilogue-fed locals (`_day_pnl_usd`, `_realized_terminal`, `_native_inception_verdict` declared ~5040-5063 with a comment per field) so the epilogue closure reads it; set it in the key-mode options step. Trigger per RESEARCH Q8: `_completeness.has_option_activity` AND the key ended on the cash basis (smoothed unavailable, budget refusal, or non-empty `pre_mark_retention_option_days`). Self-clearing: not written on a key whose options basis applied. The epilogue also runs on the `<2 days` short-circuit (~8719), so the flag must be set before that return.

---

### `analytics-service/tests/test_deribit_key_mode_options_basis.py` NEW (test, request-response)

**Analog:** `analytics-service/tests/test_allocator_equity_writer_basis.py` (`_run_derive`, ~76-115) for a key-mode Deribit derive over a REAL ledger with the real combine/day-P&L/terminal/composed-flows functions, returning the persisted `key_inputs` payload.

**Core harness (copy)**:
```python
async def _run_derive(ledger: NativeLedger, *, extra_patches: list | None = None) -> dict:
    from tests.test_mtm_single_key import _apply, _base_patches, _ctx, _ledger_meta, _report
    returns, _ = combine_native_ledger(ledger, frozenset({"BTC"}))
    report = dataclasses.replace(
        _report(has_option_activity=False), dated_external_flows=list(ledger.native_flows)
    )
    ctx, capture = _ctx(strategy_row=None, key_mode=True)
    patches = _base_patches(
        ctx, key_mode=True,
        ledger_mock=AsyncMock(return_value=(ledger, report)),
        combine_mock=MagicMock(return_value=(returns, _ledger_meta())),
    ) + [
        patch("services.broker_dailies.native_ledger_day_pnl", new=native_ledger_day_pnl),
        patch("services.broker_dailies.native_ledger_realized_terminal", new=native_ledger_realized_terminal),
        patch("services.broker_dailies.native_ledger_composed_flows", new=native_ledger_composed_flows),
    ] + (extra_patches or [])
    with _apply(patches):
        result = await run_derive_broker_dailies_job(
            {"id": "j-drb-basis", "kind": "derive_broker_dailies", "api_key_id": "key-drb"})
    assert result.outcome == DispatchOutcome.DONE
    return _key_inputs_payload(capture, "key-drb")
```
Extension needed for this phase: the real `combine_native_ledger` patch too (it is mocked in the base patches), and a ledger mock that returns the cash ledger first and supplies the options-basis ledger per the chosen API. Fixture scaling lesson (RESEARCH Pitfall 6): day-0 level 100,000 USD; BTC-scale fixtures fall under the dust floor and return all-NaN.

**RED-first oracle** (RESEARCH Q10, verified): cash `[0, -0.4839, +0.0280, +3.3339]` (raises `flow_timing_day_level_large`) versus option-book-in-level `[0, 0.0000, +0.1740, +0.9586]`, cumulative +1.2994 on both. Assert the derive's persisted `composed_day_pnl`/`realized_terminal_*` and `csv_daily_returns` upserts equal the options-basis shape, and that a perp-only ledger yields rows byte-identical to cash.

**Required cases (RESEARCH Q10 layout):** (1) option-activity key -> options-basis returns, day P&L, terminal, composed flows in the payload; (2) perp-only key -> cash rows byte-identical; (3) fallback: `LedgerValuationError` from the options step leaves outcome `DONE`, writes cash rows, sets the flag; `DeribitTransientReadError` still propagates; (4) budget overrun (`asyncio.TimeoutError`) degrades, no `failed_final`; (5) seam (below); (6) neuter drills (byte backup, neuter, RED, restore, `cmp`).

### Seam test (inside the new module)

**Analog:** `analytics-service/tests/test_nav_marks_compose_roundtrip.py` helpers `derive_key_ccxt`, `compose_curve`, `levels`, `assert_levels`, `assert_same_before` and `test_okx_key_mode_compose_reproduces_every_mark`. Pattern: derive with seeded marks, run the real compose, assert (i) days before `S` equal the options-basis series, (ii) days on/after `S` are exactly the mark days, (iii) disjoint day sets and gap days equal `mark_gap_days`, (iv) `replay_key_equity` from the last mark reproduces every marked level AND the options-basis level at `S-1`, (v) RED variant where only `returns` is options-basis and the terminal stays cash fails (iv). That file seeds ccxt/okx; a Deribit variant must seed `api_key_nav_marks` rows plus a Deribit ledger (copy `seed_okx_marks`/`route_key_csv` shapes).

**Seam contract to quote in the plan** (`apply_marks` docstring in `services/nav_marks_apply.py`, rules 2-6, 8, 9, 13, 14; call at job_worker ~8126):
```python
_applied_marks = apply_marks(
    returns, _apply_flows, _marks_in,
    day_pnl=_apply_day_pnl, roll_basis=_apply_roll,
    dust_floor=_apply_dust_floor, flow_instants=_apply_instants,
    writer_terminal=_apply_writer_terminal,
)
```
Key-mode inputs at ~7917-7972 come from `_composed_day_pnl_usd`/`_day_pnl_usd`, `_composed_flows_usd`, `native_ledger.flow_instants`, `_realized_terminal` (read BEFORE the key-mode block overwrites it). The refusal token `_MARK_WRITER_TERMINAL_ABSENT` already guards a missing terminal. Marked days do not change (RESEARCH A9).

---

### `analytics-service/tests/test_mtm_single_key.py` EDIT (test, request-response)

**Analog:** itself.
- `test_key_mode_never_runs_second_pass` (~385-397) pins the gate D-04 reverses:
```python
ctx, _ = _ctx(strategy_row=None, key_mode=True)
reports = [_report(has_option_activity=True)]
ledger_mock, calls = _recording_ledger(reports)
...
result = await run_derive_broker_dailies_job({"api_key_id": "key-drb"})
assert result.outcome == DispatchOutcome.DONE
assert len(calls) == 1, "key-mode must NOT run a second mark_to_market pass"
```
Rewrite to the new contract on purpose (RESEARCH Pitfall 7): the module docstring bullet ("kills dropping the `not is_key_mode` guard") must be updated in the same edit, not left to mislead. The strategy-mode tests stay.
- Degrade-test templates to mirror for key mode: `test_structural_smoothed_failure_degrades_keeps_cash_mtm` (~1591: `side_effects=[None, None, LedgerValuationError(...)]`, asserts `DONE`, no failed stamp) and `test_mtm_second_pass_timeout_degrades_loud_not_failed_final` (~1278: `side_effects=[None, _asyncio.TimeoutError()]`, with the neuter note "remove the `except asyncio.TimeoutError` arm -> reddens"). Keep each test's docstring "Neuter:" sentence; the repo reads them as the falsifiability record.
- Harness to reuse unchanged: `_ctx`, `_report(has_option_activity=..., pre_mark_retention_option_days=...)`, `_ledger_meta`, `_base_patches`, `_apply`, `_recording_ledger`, and the `pytestmark = pytest.mark.usefixtures("smoothed_mtm_enabled")` module opt-in (relevant to F6: if key mode does NOT consult the flag, add a flag-off key-mode test).

---

### Ingest-level same-rows test (test, batch)

**Analog:** `analytics-service/tests/test_smoothed_mtm_core.py`: `_run_options_ledger(monkeypatch, btc_rows=..., summaries=..., charts=..., pnl_basis=..., since_ms=None)` (monkeypatches `enumerate_scopes`, `resolve_scope_auth`, `enumerate_currencies`, `paginate_txn_log`, `fetch_deribit_settlement_index`; a `_OptionsAdapterStub` counts `chart_calls`), plus fixtures `_IN_RET_ROWS`, `_IN_RET_CHARTS`, `_PRE_RET_ROWS`.
```python
def test_perp_only_smoothed_zero_fetches_byte_identical(monkeypatch):
    ...
    assert stub_s.chart_calls == []
    pd.testing.assert_series_equal(led_s.native_pnl["BTC"], led_c.native_pnl["BTC"], check_exact=True)
```
Copy this for: options-from-same-rows makes ZERO extra `paginate_txn_log` calls (assert the paginate stub's call count equals one crawl), perp-only byte-identity, retention-bucketed day stays cash and sets `pre_mark_retention_option_days`, in-retention empty marks and straddler raise `LedgerValuationError` (existing `test_in_retention_empty_marks_fails_loud`, `test_retention_straddler_partial_marks_not_bucketed_fails_loud` show the arms).

---

### `src/lib/<new>-flag module` (utility, transform)

**Analog:** `src/lib/nav-marks-start.ts`. Shape to copy: a documented `as const` literal pinned by a test, plus a strict total reader.
```ts
export const MARKS_SINCE_FLAG = "marks_since" as const;
export const MARKS_TRAILING_SINCE_FLAG = "marks_trailing_since" as const;
```
Differences for this phase: the value is a boolean, so the reader is `payload?.[FLAG] === true` (strict; `"true"`, `1`, `false`, absent all read as absent), not a date parser. Keep the file small (RESEARCH "Recommended Project Structure": one small flag module). The warning sentence (founder question F3) lives with the component per the existing paragraph, not in this module unless the founder wants a shared string.

### `src/__tests__/<new>-literal-pin.test.ts` (test, file-I/O)

**Analog:** `src/__tests__/nav-marks-start-literal-pin.test.ts`. Read the Python writer and the TS constant RAW, assert non-empty plus an anchor in each file, extract the literal by regex, compare with an independent literal written once in the test.
```ts
const workerPath = join(root, "analytics-service", "services", "job_worker.py");
...
const match = /_prestamp_flags\["([^"]+)"\]\s*=\s*_applied_marks\.marks_since\b/.exec(read(workerPath));
expect(match, '...').not.toBeNull();
expect(match![1]).toBe(PINNED_KEY);
```
For this phase the Python side is `_key_inputs_payload["<flag>"] = True` in `job_worker.py`; write the regex against that, assert the anchor `run_derive_broker_dailies_job`, and neuter-drill it (change the Python key, see RED, restore from byte backup).

---

### `src/lib/queries.ts` reader (service, CRUD read)

**Analog:** `readMarksStart` (~4100-4147) and its carry. It already reads every included key's `key_inputs:<id>` row on the USER client under owner RLS with the allocator filter written out and the fail-closed `departed_history_unavailable` rule; extend it (RESEARCH Q8 item 2) rather than add a second read.
```ts
const { data, error } = await supabase
  .from("allocator_equity_derived")
  .select("kind, payload")
  .eq("allocator_id", userId)
  .in("kind", includedKeyIds.map((id) => KEY_INPUTS_KIND_PREFIX + id));
if (error) { console.warn("[queries.getMyAllocationDashboard] ... (naming no ...):", error.message ?? "unknown supabase error");
  scheduleDerivedRowCapture(captureToSentry(error, { tags: { op: "getMyAllocationDashboard", reason: "nav_marks_start_read_failed" }, level: "warning" }));
  return none; }
...
const failsClosed = (e: { keyId: string } | null) =>
  e === null || (departedHistoryUnavailable && departedIncluded.has(e.keyId));
```
Return type is `{ start, trailingSince }`; add a boolean (`optionsCashBasis`) computed as "any included key's payload has the flag `=== true`", with the same departed fail-closed rule (a flag only on a departed key while `departedHistoryUnavailable` reads false, so the caveat does not claim a curve the book does not contain). Carry: destructure at ~6022, add to BOTH return branches (~6083 `!portfolio` branch and ~6583 main branch) and to the `MyAllocationDashboardPayload` type beside `marksTrailingSince` (~3370-3380, optional "so legacy fixtures compile").

**Test analog:** `src/lib/queries.my-allocation.test.ts` ~5597-5665: the `paused(apiKeyId, value)` row factory and the four cases (earliest across included keys; none/malformed -> null; another owner's key and an excluded departed key never count; `departed_history_unavailable` + departed-only -> fail closed). Port each case to the boolean, including `"true"` and `1` payloads reading as absent.

### `AllocationDashboardV2.tsx` (component)

**Analog:** same file, `marksTrailingSince` (~80-83, 121-130). Destructure with a default (`optionsCashBasis = false`), pass into `buildAllocatorPortfolioFactsheetPayload(..., { ..., marksTrailingSince, <new> })`, and add to the `useMemo` dependency list (the list at ~126-137 is exhaustive; a missed dep is a stale-caveat bug).

### `allocator-portfolio-payload.ts` / `types.ts` (utility / type)

**Analog:** the `marksTrailingSince` meta field and the end-of-function spread (`allocator-portfolio-payload.ts` ~54-60, ~134-143):
```ts
const marksSince = parseMarksStart(meta.marksStart);
const marksTrailingSince = parseMarksStart(meta.marksTrailingSince);
if (payload === null || (!marksSince && !marksTrailingSince)) return payload;
return { ...payload, ...(marksSince ? { marksSince } : {}), ...(marksTrailingSince ? { marksTrailingSince } : {}) };
```
Difference: the target is `payload.dataQuality.<flag>`, which this builder does not write today (it passes `dataQuality` through `build-payload.ts` opts only). Copy the by-spread, present-only discipline (a book without the flag keeps its exact prior payload) and type the meta field `unknown`, coerced with the strict reader. Add the typed field next to `flowTimingDayLevelLarge?: boolean` in `src/lib/factsheet/types.ts` (~867-885) with a doc comment in the same "present only when true" voice. Note `dataQuality` also requires `composite`; the existing FactsheetView test builds `{ composite: false, ... }`. Test analog: `allocator-portfolio-payload.test.ts` ~366-400 (`build(...)` helper, `it.each` absent/null/impossible/number -> `"..." in build(value)!` is false).

### `FactsheetView.tsx` amber paragraph (component)

**Analog:** the existing paragraph (~2068-2085). Add a third condition and a third sentence; keep ONE paragraph so two flags never print two caveats (the comment above it records that rule).
```tsx
{(payload.dataQuality?.smallBaseMeasured === true ||
  payload.dataQuality?.flowTimingDayLevelLarge === true) && (
  <p className="px-3 sm:px-4 py-2 text-micro font-mono"
     style={{ borderTop: "1px solid var(--color-border)", color: "var(--color-warning, #B45309)" }}>
    {payload.dataQuality?.smallBaseMeasured === true
      ? "⚠ Some days were measured on a very small balance, so their returns can be extreme."
      : "⚠ Some days carried a deposit or withdrawal ... so their returns can be extreme."}
  </p>
)}
```
Do NOT reuse `flow_timing_day_level_large` (its sentence is about deposits and withdrawals and would be false for an option-premium day; RESEARCH Q8). Sentence and precedence among the three flags are founder question F3; the RESEARCH proposal is "Some days on a Deribit account were measured against its cash balance, which leaves out open option positions, so their returns can be extreme." Read `DESIGN.md` before the copy/styling edit (amber `--color-warning` is "system- or user-recoverable disclosure"). Test analog: `FactsheetView.kpistrip.test.tsx` ~540-585 (`largeFlowPayload`, strict-`=== true` `it.each([[false],[undefined],[null],["true"],[1]])`, "same amber styling, not a new component", "prints ONE caveat when both flags are true"); copy all four and add the three-flag precedence case.

## Shared Patterns

### Degrade, never fail, on a soft structural failure
**Source:** `job_worker.py` smoothed THIRD pass arms (~5815-5862).
**Apply to:** the key-mode options step. Exact tuple `LedgerValuationError, NavReconstructionError, LedgerCompletenessError, LedgerTruncatedError, CurrencyEnumerationError, ScopeAuthError` plus a local `asyncio.TimeoutError`; log class/scrubbed text only (`scrub_freeform_string`, T-74-03); never catch bare `ValueError`/`json.JSONDecodeError`/`DeribitTransientReadError`/ccxt network errors.

### Present-only strict flag through `key_inputs` (writer `is True`, reader `=== true`)
**Source:** `_key_inputs_payload["marks_since"]` (writer) + `readMarksStart` (reader) + `nav-marks-start-literal-pin.test.ts` (pin).
**Apply to:** the new caveat flag at every hop (writer, query, dashboard payload, `AllocationDashboardV2`, factsheet builder, `FactsheetView`). Each hop gets a RED-first test and a neuter drill (RESEARCH Q8 / plans 185-06/07 structure).

### One ledger feeds all four writer quantities
**Source:** job_worker ~5454-5476 and ~7917-7972.
**Apply to:** `returns`, `_day_pnl_usd`, `_composed_flows_usd`, `_realized_terminal`, `native_ledger.flow_instants`, and the `apply_marks` writer terminal. A hybrid (options-basis returns, cash terminal) reintroduces the G-01 seam-day defect with options.

### Reuse the crawl, bound the step
**Source:** `nav_twin` ("NO venue call and no second crawl", `build_deribit_native_ledger` docstring ~2722) and the FIX-2/HIGH-01 comments on the second/third passes.
**Apply to:** the options step. Constants already in scope: `_MTM_SECOND_PASS_BUDGET_FRACTION`, `_MTM_SECOND_PASS_MIN_SECONDS`, `_DERIVE_OUTER_BUDGET_S`, `_BROKER_CRAWL_TIMEOUT_S`. Dry run (orchestrator) prints `N_held`, crawl and step wall times before the bound is chosen.

### Option-activity gate
**Source:** `deribit_raw_rows_have_option_activity(raw_rows)` (deribit_ingest ~1235) = `CompletenessReport.has_option_activity`.
**Apply to:** gate the options basis on it; perp-only keys stay byte-identical (`test_perp_only_smoothed_zero_fetches_byte_identical`).

### Test-first neuter drill
**Source:** the "Neuter:" sentences in `test_mtm_single_key.py` docstrings and the user rule (byte backup, neuter, see RED, restore, `cmp`; never `git checkout`/`restore`/`stash` on uncommitted work).
**Apply to:** every data-integrity gate in this phase (options-only-when-option-activity, local fallback, one-ledger-for-four-quantities, flag strictness, literal pin).

### CI gates every Python brief must carry
`cd analytics-service && mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` plus pytest from `analytics-service/` only (never `importlib.reload`). Frontend: `npm run typecheck && npm run lint && npx vitest run <files>`.

## No Analog Found

| File / concern | Role | Data Flow | Reason |
|---|---|---|---|
| The crawl/assemble split or opt-in "options-basis ledger from the same raw rows" in `deribit_ingest.py` | service | batch/transform | Only `nav_twin` re-aggregates the same rows, and it keeps the cash `marks` and cash wedge. The smoothed basis needs its own wedge (`state.native_upnl`), a ΔMTM merge, a `marks` span check (RESEARCH A6) and the book-channel `assert_balance_identity`. Compose from the two blocks cited above; use RESEARCH "Code Examples" as the shape. |
| The read-only dry run (RESEARCH Wave 0) | orchestrator script | batch | Not a repo file: runs in the worker like 185-01, counts and ratios only, script not committed while it carries key tags (CONTEXT, RESEARCH Pitfall 8). |
| SC-4 PROD reading and Q7 reads (R-a..R-e) | orchestrator reads | n/a | Orchestrator-only, marker query first, counts and ratios; not an executor task. |

## Metadata

**Analog search scope:** `analytics-service/services/` (`job_worker.py`, `deribit_ingest.py`, `broker_dailies.py`), `analytics-service/tests/`, `src/lib/`, `src/lib/factsheet/`, `src/app/(dashboard)/allocations/`, `src/app/factsheet/[id]/v2/`, `src/__tests__/`.
**Files read for excerpts:** 12 (`job_worker.py` 4 regions, `deribit_ingest.py` 3 regions, `test_mtm_single_key.py`, `test_allocator_equity_writer_basis.py`, `test_smoothed_mtm_core.py`, `test_nav_marks_compose_roundtrip.py` outline, `nav-marks-start.ts`, its literal-pin test, `queries.ts` regions, three frontend test files, `FactsheetView.tsx`, `AllocationDashboardV2.tsx`, `allocator-portfolio-payload.ts`, `types.ts`).
**Tracked-source gate:** every analog path verified with `git ls-files`; none is a gitignored mirror.
**Pattern extraction date:** 2026-11-01
