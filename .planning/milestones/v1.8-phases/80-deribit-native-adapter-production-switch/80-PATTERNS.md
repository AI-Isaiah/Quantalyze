# Phase 80: Deribit Native Adapter + Production Switch - Pattern Map

**Mapped:** 2026-07-10
**Files analyzed:** 6 new/modified functions + 1 SC-4 test suite across 5 source files
**Analogs found:** 6 / 6 (every target has a verbatim-sibling analog)

> ⚠️ **DOMINANT FINDING — read before planning. Every Phase-80 deliverable is ALREADY
> IMPLEMENTED AND COMMITTED on `main`.** The functions the plans (80-01…80-03) instruct an
> executor to *Add* all exist today, fully realized, in commit `eb8e357e` (v0.38.2.0,
> PR #598 — "v1.8 Deribit native-unit reconstruction + Zavara verification"), and have
> since **evolved beyond the plan spec** (Phase-82 mark-to-market, Zavara
> `exclude_spot_extraction` / `pnl_basis` / `denominator_config`, `assert_balance_identity`
> reconcile guard). MEMORY confirms: *"✅v1.8 SHIPPED v0.38.2.0 @eb8e357e (PR#598)"*.
> **Consequently the CONTEXT/plan line-number hints are ALL stale** (verified by grep on
> 2026-07-10 — see the Drift table). The planner must treat 80-01…80-03 not as greenfield
> "add the sibling" work but as **already-landed** — the correct pattern for each new
> function IS ITS OWN CURRENT IMPLEMENTATION (the strongest possible analog: verbatim
> self). Only 80-04 (the human-gated LIVE re-derivation) is plausibly still open. Escalate
> to the orchestrator to reconcile the plans against landed reality before executing any
> autonomous 80-01…80-03 task.

## File Classification

| Target function (plan) | Role | Data Flow | Closest analog | Match | Current status |
|------------------------|------|-----------|----------------|-------|----------------|
| `txn_rows_to_native_daily` (80-01 T1) | transform / aggregator | batch transform | `txn_rows_to_daily_records` (same file) | exact sibling | **ALREADY LANDED** `deribit_txn.py:1501` |
| 4-field `deribit_dated_external_flows_usd` (80-01 T2) | transform / producer | batch transform | its own pre-80 2-field form + `ExternalFlow` | exact | **ALREADY 4-field** `deribit_txn.py:895` (emit :1008-1011) |
| SI-02 `failed_final`-bounce fix (80-01 T3) | migration + runner | event-driven (status bridge) | `20260707120000_sync_status_preserve_warnings.sql` | role-match | Verify landed (see Open Items) |
| `fetch_deribit_native_account_state` (80-02 T1) | service / I-O read | request-response | `fetch_deribit_account_equity_and_upnl_usd` | exact sibling | **ALREADY LANDED** `deribit_ingest.py:1346` |
| `build_deribit_native_ledger` (80-02 T2) | adapter / assembler | request-response + assemble | `fetch_deribit_ledger_daily_records` crawl | role+flow | **ALREADY LANDED** `deribit_ingest.py:1725` |
| `combine_native_ledger` (80-03 T1) | service / wiring | transform | `combine_realized_and_funding` (same file) | exact sibling | **ALREADY LANDED** `broker_dailies.py:168` |
| Deribit job-path route (80-03 T2) | worker branch | event-driven | the legacy `combine_realized_and_funding` branch | exact | **ALREADY ROUTED** `job_worker.py:2145/2188/2273` |
| SC-4 dual-run identity (80-03 T3) | test | assertion | landed 79 `test_dual_run_bit_exact` | exact | **ALREADY EXTENDED** `test_native_nav_sc4_identity.py:452` |

## Drift: CONTEXT/plan line-number hints vs. verified-today anchors

The CONTEXT explicitly warns anchors are execute-time hints. Verified via `grep -n` on
2026-07-10 — **every hint is stale** (the files grew ~2×):

| Symbol | CONTEXT/plan hint | Verified TODAY | File |
|--------|-------------------|----------------|------|
| `CASH_BEARING_TYPES` | :333 | **:527** | deribit_txn.py |
| `INFORMATIONAL_TYPES` | :341 | **:535** | deribit_txn.py |
| `_EXTERNAL_FLOW_TYPES` | :361 | **:555** | deribit_txn.py |
| `_row_utc_day` | :388 | **:698** | deribit_txn.py |
| `deribit_dated_external_flows_usd` | :601 | **:895** (already 4-field) | deribit_txn.py |
| `txn_rows_to_daily_records` | :698 | **:1014** | deribit_txn.py |
| `txn_rows_to_native_daily` | (to be added) | **:1501 (exists)** | deribit_txn.py |
| `fetch_deribit_settlement_index` | :433 | **:482** | deribit_ingest.py |
| `CompletenessReport` | :512 | **:721** | deribit_ingest.py |
| `build_deribit_indexable_currencies` | :546 | **:779** | deribit_ingest.py |
| `fetch_deribit_ledger_daily_records` | :606 | **:1101** | deribit_ingest.py |
| `_deribit_session_upl_to_usd` wedge | :844-846 | **:1233** | deribit_ingest.py |
| `fetch_deribit_account_equity_and_upnl_usd` | :853 | **:1485** | deribit_ingest.py |
| `assert_ledger_complete` | :943 | **:1903** | deribit_ingest.py |
| `gap_fill_daily_returns` | :118 | **:123** | broker_dailies.py |
| `combine_realized_and_funding` | :130 | **:135** | broker_dailies.py |
| `reconstruct_native_nav_and_twr` | :520-570 | **:579** | native_nav.py |
| `_code_carries_value` | :263-268 | **:268** | native_nav.py |
| `_bucket_flow_qty` | :322-328 | **:323** | native_nav.py |
| Deribit branch / `combine_*` call | :2001-2284 / :2278 | **native at :2145/:2188; legacy at :2451** | job_worker.py |

**Additional structural drift (beyond line numbers):** the native path introduced NEW type
sets the plans do not mention — `_NATIVE_CASH_BEARING_TYPES` (`deribit_txn.py:586` =
`CASH_BEARING_TYPES` ∪ reclassed `swap`), `_NATIVE_INFORMATIONAL_TYPES` (:583),
`_NATIVE_OPTIONS_SUMMARY_TYPES` — the native sibling partitions on THESE, not the USD sets
the plan's "guards lifted verbatim" text names. The verbatim-lift discipline (locked
decision 5) *was* honoured for the three `change` guards, but the type-partition
deliberately diverges (HIGH-1 `swap` reclassification).

## Pattern Assignments

### `txn_rows_to_native_daily` (transform, batch) — LANDED `deribit_txn.py:1501`

**Analog:** `txn_rows_to_daily_records` (`deribit_txn.py:1014`) — the USD-space sibling.

**Guard block to copy VERBATIM** (locked decision 5) — the three `change` fail-loud guards.
Source `txn_rows_to_daily_records:1088-1117`; the native sibling copied them byte-for-byte
at `1648-1675`:
```python
raw_change = row.get("change", _MISSING)
if raw_change is _MISSING:
    raise LedgerValuationError(
        f"cash-bearing Deribit row id={row.get('id')!r} type={row_type!r} "
        "has NO `change` field — refusing to treat a missing balance-delta as zero ...")
if raw_change is None or (isinstance(raw_change, str) and not raw_change.strip()):
    raise LedgerValuationError(
        f"cash-bearing Deribit row id={row.get('id')!r} type={row_type!r} "
        f"has a null/blank change={raw_change!r} — refusing to coalesce it to zero ...")
change = _coerce_float(raw_change, field="change", row=row)
try:
    day = _row_utc_day(row.get("timestamp"))
except ValueError as e:
    raise LedgerValuationError(str(e)) from e
```

**The two sanctioned deltas from the analog** (per plan + as implemented):
1. Accumulate raw `_coerce_float(change)` into `by_day_ccy: dict[tuple[str,str], float]`
   keyed `(day, CCY_UPPER)` — **NO `txn_change_to_usd`, no index, no `supplemental_index`**
   (`deribit_txn.py:1593`, :1668, :1642). Contrast the analog's `usd = txn_change_to_usd(...)`
   at `:1130-1133`.
2. A zero-change cash-bearing row creates **no** entry (native has no all-zero placeholder);
   the analog `setdefault(day, 0.0)` at `:1120`.

**Unknown-type fail-loud** copied verbatim (message incl. `({change})`) — analog `:1140-1145`.
Return-type note (D9): returns **plain `dict[str, dict[str, float]]`, NOT `pd.Series`** — the
module has an AST purity guard forbidding `import pandas`
(`test_deribit_txn.py::test_option_enters_via_cash_delta_not_perp`); the dict→Series
conversion lives in `build_deribit_native_ledger` via `_native_daily_to_series`.

**Beyond-plan features now present** (planner must reconcile): `pnl_basis` kwarg
(`cash_settlement` default / `mark_to_market`, Phase 82, `:1504`), `exclude_spot_extraction`
(Zavara Bug-B, `:1505`), and the `_NATIVE_OPTIONS_SUMMARY_TYPES` summary-contribution branch
(`:1620-1643`). None of these are in 80-01's action text.

---

### `deribit_dated_external_flows_usd` — 4-field (transform, batch) — LANDED `deribit_txn.py:895`

**Analog:** its own pre-80 2-field form + `ExternalFlow` (`external_flows.py:45`).

The `(day, ccy)`-keyed parallel-accumulator pattern to copy (`deribit_txn.py:949-1011`):
```python
by_day_ccy_usd: dict[tuple[str, str], float] = {}
by_day_ccy_qty: dict[tuple[str, str], float] = {}
# ... same absent / null-blank change guards (:959-980) ...
key = (day, ccy)
by_day_ccy_usd[key] = by_day_ccy_usd.get(key, 0.0) + txn_change_to_usd(
    row, fallback_index=fb, indexable_currencies=indexable_currencies)   # usd leg UNCHANGED
by_day_ccy_qty[key] = by_day_ccy_qty.get(key, 0.0) + change              # native qty leg
return [
    ExternalFlow(day, by_day_ccy_usd[(day, ccy)], ccy, by_day_ccy_qty[(day, ccy)])
    for (day, ccy) in sorted(by_day_ccy_usd)
]
```
Byte-identity invariant: Σ `usd_signed` per day is unchanged (legacy consumers read
`usd_signed`). `ExternalFlow` 4-field shape at `external_flows.py:72-75`
(`utc_day_iso`, `usd_signed`, `currency='USD'`, `quantity=None`); `validate_flow_shape`
(`:78`) accepts it; the native value-gate `_code_carries_value` reads `usd_signed`
(`native_nav.py:268`) and `_bucket_flow_qty` refuses INDEXED `quantity=None`
(`native_nav.py:323`).

---

### `fetch_deribit_native_account_state` (service, request-response) — LANDED `deribit_ingest.py:1346`

**Analog:** `fetch_deribit_account_equity_and_upnl_usd` (`deribit_ingest.py:1485`).

Pattern (D5 one-read): a `DeribitNativeAccountState` dataclass carrying BOTH the native
maps (`native_equity` / `native_upnl` / `native_options_value`, read straight off each
summary's `equity` / `session_upl` in native units, no `{ccy}_usd` multiply) AND the
collapsed USD anchor, from **ONE** `private_get_get_account_summaries({})` call (`:1374`).
The legacy 4-tuple function now delegates to this so there is a single fetch + single code
path. `build_deribit_native_ledger` threads the caller's already-read `account_state` in
(`:1786-1790`) to avoid a double-fetch; a standalone/test caller omits it and this reads
itself.

---

### `build_deribit_native_ledger` (adapter, request-response) — LANDED `deribit_ingest.py:1725`

**Analog:** the crawl assembly in `fetch_deribit_ledger_daily_records` (`deribit_ingest.py:1101`)
+ `fetch_deribit_settlement_index` dense map (`:482`) + `assert_ledger_complete`/
`CompletenessReport` (`:1903`/`:721`).

The six-field `NativeLedger` assembly (`:1892-1899`):
```python
_daily_records, raw_rows, indexable, report = await _crawl_deribit_ledger(exchange, since_ms, sleep=sleep)
native_daily = txn_rows_to_native_daily(raw_rows, pnl_basis=..., exclude_spot_extraction=...)
native_pnl = {ccy: _native_daily_to_series(day_map) for ccy, day_map in native_daily.items()}
native_flows = report.dated_external_flows                     # reused verbatim, never recomputed
state = account_state or await fetch_deribit_native_account_state(exchange)   # D5 one-read
marks = await _build_dense_native_marks(exchange, indexable=..., native_pnl=..., native_flows=...,
        terminal_native_equity=state.native_equity, terminal_upnl_native=state.native_upnl, ...)
ledger = NativeLedger(native_pnl=native_pnl, terminal_native_equity=state.native_equity,
        marks=marks, native_flows=native_flows, terminal_upnl_native=terminal_upnl_native,
        full_history=True)
return ledger, report
```
`NativeLedger` def `native_nav.py:207`. Dense-marks planner factored into
`_build_dense_native_marks` (NOT inline as the plan's action describes); USD-family absent
from marks; the core is imported, never re-implemented (locked decision 2).

**Beyond-plan:** an `assert_balance_identity` fail-loud reconcile guard (`:1843`, Phase 82,
Σnative==Σchange to a $1-equiv native floor), the open-option → wedge folding for
cash_settlement §5 closure (`:1880-1891`), and `pnl_basis`/`exclude_spot_extraction`
threading. Not in 80-02's action text.

---

### `combine_native_ledger` (service, transform) — LANDED `broker_dailies.py:168`

**Analog:** `combine_realized_and_funding` (`broker_dailies.py:135`) — copy its tail exactly
(`gap_fill_daily_returns` reuse `:123`, then `return returns, dict(meta)`):
```python
returns, meta = reconstruct_native_nav_and_twr(ledger, indexable_currencies=indexable, venue="deribit")
returns = gap_fill_daily_returns(returns)
return returns, dict(meta)
```
`NavReconstructionError` subclasses are **not** caught here — propagate typed to the callsite
(`:197-200`). Core signature `reconstruct_native_nav_and_twr(ledger, *, indexable_currencies,
venue="")` at `native_nav.py:579`.

**Beyond-plan:** a `denominator_config: ReturnsDenominatorConfig | None` kwarg (`:172`) —
when PRESENT (Zavara-only) it returns `allocated_capital_returns_and_metrics(...)` and
**bypasses `reconstruct_native_nav_and_twr` and the §5 gate entirely** (`:211-216`). The
plan's 80-03 T1 action describes only the `None` NAV branch. This is a material scope
addition the planner must account for.

---

### Deribit job-path route (worker branch, event-driven) — LANDED `job_worker.py`

**Analog:** the pre-switch `combine_realized_and_funding` branch (still present for other
venues at `job_worker.py:2451`).

Native wiring landed: imports `combine_native_ledger` (`:2013`) + `build_deribit_native_ledger`
(`:2021`); builds the ledger (`:2145`); computes `returns, meta = combine_native_ledger(...)`
(`:2188`); a shared `NavReconstructionError` TERMINAL disposition helper (`:1970`) +
`except NavReconstructionError as exc:` arm (`:2273`) — permanent FAILED, scrubbed,
`_stamp_deribit_analytics_failed`, no retry (the `LedgerValuationError` discipline). No
per-account dispatch flag (locked decision 3). `assert_ledger_complete` still gates.

---

### SC-4 dual-run byte-identity (test) — LANDED `tests/test_native_nav_sc4_identity.py`

**Analog / idiom to mirror** — the landed 79 `test_dual_run_bit_exact` (`:246`) and the
80-03 real-adapter extension (`:452`). The EXACT gate idiom:
```python
# synthetic-shim tier (:271)
pd.testing.assert_series_equal(legacy_returns, native_returns, check_exact=True)
assert dict(legacy_meta) == dict(native_meta)
# SHIP GATE (i) — REAL adapter tier (:479)
pd.testing.assert_series_equal(legacy_returns, native_returns, check_exact=True, check_names=False)
assert dict(legacy_meta) == dict(native_meta)
```
The real adapter is driven through `di.build_deribit_native_ledger(stub)` fed synthetic
exchange stubs (`:423`, `:640`) — no network. Companion pins already present:
`test_real_adapter_materiality_flag_is_load_bearing` (:485), `test_anchor_composition_pin_real_adapter`
(:505), `test_dust_account_excluded_from_identity` (D8, :535),
`test_ieee_x_times_one_is_bit_identity` (:290),
`test_same_family_swap_is_noop_in_coalesced_usd_bucket` (:643). This is the byte-identity
idiom to reuse for any NEW SC-4 pin (`check_exact=True`, `check_names=False`, byte-equal
`dict(meta)` — **never weakened to a tolerance**).

## Shared Patterns

### Verbatim guard-lift (anti-drift)
**Source:** the three `change` guards in `txn_rows_to_daily_records` (`deribit_txn.py:1088-1117`).
**Apply to:** every new `(day,ccy)` txn aggregator (`txn_rows_to_native_daily`,
`deribit_dated_external_flows_usd`). Copy byte-for-byte — do not paraphrase (locked decision 5).

### Structural fail-loud → `LedgerValuationError` / `NavReconstructionError`
**Source:** `LedgerValuationError` wraps in deribit_txn; `NavReconstructionError` hierarchy
(`native_nav.py:105`/`:137`). **Apply to:** all adapter + wiring code — a structural refusal
is PERMANENT (no retry, no factsheet), dispositioned at the job_worker callsite. Message must
be scrubbed / carry codes-counts-ratios only (leak discipline, locked decision 6).

### (returns, meta) shape parity
**Source:** `combine_realized_and_funding` tail (`broker_dailies.py:156-165`) →
`gap_fill_daily_returns` (`:123`) + `dict(meta)`. **Apply to:** `combine_native_ledger` so
CSV route / `compute_all_metrics` / persistence / factsheet are untouched (§9.2).

### One-fetch discipline
**Source:** `fetch_deribit_native_account_state` reads ONE `get_account_summaries`
(`deribit_ingest.py:1374`); `build_deribit_native_ledger` threads the state in rather than
refetching (`:1786`). **Apply to:** any adapter needing native + collapsed anchors.

## No Analog Found

None. Every Phase-80 target has an exact or near-exact sibling analog in the current tree —
and, more strongly, **every target already exists as its own landed implementation**.

## Open Items for the Planner / Orchestrator

1. **Reconcile plans vs. landed reality.** 80-01…80-03 are already merged (`eb8e357e`).
   Do NOT dispatch them as greenfield "add the function" work — an executor would collide
   with existing, more-evolved code. Confirm whether the phase should be marked complete or
   re-scoped to only 80-04 (LIVE gate, `autonomous:false`).
2. **SI-02 (80-01 T3) is ALSO landed — confirmed.** `supabase/migrations/20260708120000_sync_status_failed_final_bounce.sql`
   exists and `supabase/tests/test_sync_status_preserves_warnings.sql` carries the
   `failed_final`-bounce regression (12 references). MEMORY still flags the pre-existing
   mig-038 `failed_final→failed` retry-poison (defect 1) as an active WATCH item for any
   80-04 live re-run — it is out of scope for the fix but must not poison the re-derivations.
3. **Scope additions not in the plans:** `pnl_basis` (Phase 82 MTM), `exclude_spot_extraction`
   / `denominator_config` (Zavara Bug-B), `assert_balance_identity`, open-option→wedge
   folding. Any further 80 work must respect these already-shipped seams, not overwrite them.

## Metadata

**Analog search scope:** `analytics-service/services/{deribit_txn,deribit_ingest,broker_dailies,native_nav,job_worker}.py`, `analytics-service/services/external_flows.py`, `analytics-service/tests/test_native_nav_sc4_identity.py`.
**Files scanned:** 7 source/test files + 4 phase plans + CONTEXT.
**Verification:** all anchors re-derived via `grep -n` on 2026-07-10; git history checked (`eb8e357e` / PR #598).
**Pattern extraction date:** 2026-07-10
