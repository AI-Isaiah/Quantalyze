# Phase 168: DRBOPTIONS — a Deribit options account ingests end to end - Pattern Map

**Mapped:** 2026-09-26
**Files analyzed:** 7 (5 modified, 2 new — 1 of them optional)
**Analogs found:** 7 / 7 (every file has an in-repo analog; this phase is edits beside existing code)

> Cite by SYMBOL. Line numbers below are a convenience at worktree HEAD and WILL drift — grep the
> symbol before editing. All paths are relative to the repo root; all analogs are git-tracked
> (`git ls-files` verified for `analytics-service/services/deribit_txn.py`,
> `analytics-service/tests/test_deribit_unclassified_evidence.py` and every
> `analytics-service/docs/evidence/*.json`).

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `analytics-service/services/deribit_txn.py` (modify) | service (pure classifier core) | transform / batch | itself: `CASH_BEARING_TYPES` block, `_NATIVE_*` set block + import asserts, `describe_unclassified_row`, `assert_correction_classifiable`, both twins | exact (in-place) |
| `analytics-service/services/deribit_ingest.py` (modify `_crawl_deribit_ledger`) | service (I/O adapter) | batch crawl | `build_deribit_native_ledger` WR-05 `smoothed_mtm requires a full-history crawl` refusal | exact |
| `analytics-service/docs/evidence/drb-assignment-census-2026-09.json` (new) | config / evidence doc | static | `analytics-service/docs/evidence/drb-options-semantics-2026-07.json` (key shape only) | role-match (⚠️ do NOT copy its `_subject` habit) |
| `analytics-service/tests/test_deribit_unclassified_evidence.py` (modify, re-point) | test | transform | itself | exact |
| `analytics-service/tests/test_deribit_txn.py` (modify `test_type_sets_pinned_to_evidence`) | test | transform | itself | exact |
| `analytics-service/tests/test_deribit_assignment.py` (new; or extend `test_deribit_txn.py` — discretion) | test | transform + batch crawl | `test_deribit_txn.py` (`_ms`, `_summary_row`, `_option_trade`, `_opt_row`, `test_unknown_change_type_fails_loud`); `test_deribit_ingest.py` `_patch_pipeline`; `test_smoothed_mtm_core.py` `test_smoothed_requires_full_history_crawl` | exact |
| `analytics-service/docs/deribit-ingestion-design.md` (modify prose) | docs | — | itself, `### Type allow-list` section | exact |

---

## Pattern Assignments

### `analytics-service/services/deribit_txn.py` (service, transform)

Six distinct edits (Edit 6 is discretionary). Each has its analog in the SAME file.

#### Edit 1 — add `assignment` to `CASH_BEARING_TYPES` + update the type-table comment

**Analog:** the comment block directly above `CASH_BEARING_TYPES` (≈ lines 516–535):
```python
# `change` on each captures realized cash exactly once:
#   trade                -> fees (+ option premium)
#   settlement           -> futures session PnL + perpetual funding
#   delivery             -> option/future expiry cash settlement
#   liquidation          -> forced-close PnL/fees
#   negative_balance_fee -> a genuine cost of carry (live-confirmed cash-bearing)
#
# NOTE: `correction` is DELIBERATELY NOT a static member of this set — ...
CASH_BEARING_TYPES: frozenset[str] = frozenset(
    {"trade", "settlement", "delivery", "liquidation", "negative_balance_fee"}
)
```
Add an `assignment -> ...` line in the same column format, citing
`docs/evidence/drb-assignment-census-2026-09.json` (D-03), stating it is licensed ONLY for the
census shape (no same-instrument `delivery`/`settlement`), that the delivery-relabel reading is an
ASSUMPTION, and that under `mark_to_market` inside coverage it contributes `-commission` like
`delivery`. ⛔ Never cite the row's `change` magnitude (D-01).

**Also update the stale 2026-09-12 evidence comment** above `_SHAPE_FIELDS` (≈ lines 555–580). It
says "Deribit does NOT enumerate the `type` enum in its published docs" and quotes the refusal with
its `change` value. The phrase is stale per CONTEXT [informational]. Keep the block as lineage, but
append a dated correction in the house style (`⛔ CORRECTED <date> (Phase 168): ...`), and do not add
a new magnitude.

#### Edit 2 — the shared option-event vocabulary constant (D-07) + import assert

**Analog:** the `_NATIVE_*` derived-set block + import-time asserts (≈ lines 673–693):
```python
_NATIVE_INTERNAL_REBALANCE_TYPES: frozenset[str] = frozenset({"swap"})
_NATIVE_INFORMATIONAL_TYPES: frozenset[str] = (
    INFORMATIONAL_TYPES - _NATIVE_INTERNAL_REBALANCE_TYPES
)
_NATIVE_CASH_BEARING_TYPES: frozenset[str] = (
    CASH_BEARING_TYPES | _NATIVE_INTERNAL_REBALANCE_TYPES
)
# Invariants (import-time, mirroring the USD-set disjointness assert):
assert _NATIVE_INTERNAL_REBALANCE_TYPES <= (
    INFORMATIONAL_TYPES - _EXTERNAL_FLOW_TYPES
), "native-reclassed types must be INFORMATIONAL non-external-flow (internal) types"
```
New constant (research name, discretionary):
```python
_OPTION_EXPIRY_TYPES: frozenset[str] = frozenset({"delivery", "assignment"})
_OPTION_BOOK_EVENT_TYPES: frozenset[str] = frozenset({"trade"}) | _OPTION_EXPIRY_TYPES
assert _OPTION_BOOK_EVENT_TYPES <= CASH_BEARING_TYPES, "<message naming the invariant>"
```
Place it AFTER `CASH_BEARING_TYPES` is defined (the assert needs it) and before the first reader
(`_pre_coverage_option_days`). Keep the existing disjointness asserts
(`CASH_BEARING_TYPES & INFORMATIONAL_TYPES`, native pair, and the two `_NATIVE_OPTIONS_SUMMARY_TYPES`
asserts ≈ lines 910–915). ⛔ Do NOT add `assignment` to `_NATIVE_OPTIONS_SUMMARY_TYPES`: that breaks
`assert not (_NATIVE_OPTIONS_SUMMARY_TYPES & _NATIVE_CASH_BEARING_TYPES)`.

#### Edit 3 — the six literal `("trade", "delivery")` sites → the constant (D-07)

Find every site with `grep -n '"trade", "delivery"\|row_type == "delivery"\|row_type == "trade"' analytics-service/services/deribit_txn.py`
(measured: 6 hits, matching RESEARCH Q2-B):

| # | Symbol | Current literal (verbatim) | Replace with |
|---|---|---|---|
| 1 | `_pre_coverage_option_days` | `if str(row.get("type", "")) not in ("trade", "delivery"):` | `... not in _OPTION_BOOK_EVENT_TYPES:` |
| 2 | `_option_activity_after_coverage` | same | same |
| 3 | `_assert_smoothed_summary_cross_check` | `elif row_type in ("trade", "delivery") and classify_instrument(` | `elif row_type in _OPTION_BOOK_EVENT_TYPES and ...` |
| 4 | `replay_option_positions` | `if str(row.get("type", "")) not in ("trade", "delivery"):` | `... not in _OPTION_BOOK_EVENT_TYPES:` |
| 5 | `txn_rows_to_native_daily` option arm | `if row_type == "trade" or row_type == "delivery":` | `if row_type in _OPTION_BOOK_EVENT_TYPES:` |
| 6 | same arm, derivative guard | `row_type == "delivery"` inside `elif (row_type == "delivery" and cls in ("unknown", "spot") and change != 0.0)` | `row_type in _OPTION_EXPIRY_TYPES` |

**Seventh literal site — decide explicitly (D-04):** `_SIBLING_TYPES: tuple[str, ...] = ("delivery", "settlement", "trade")`
feeds the `describe_unclassified_row` census. RESEARCH quotes it but decides it in neither table. Adding
`"assignment"` makes the next `exercise`/`expiry` refusal (Pitfall 5) show whether an `assignment` co-occurred on the
same instrument, and it does not break `test_the_census_DISTINGUISHES_the_two_worlds` (that test asserts `delivery=`
substrings only). The plan must record the choice either way.

**Prose that names "trade/delivery" outside `deribit_txn.py`:** the WR-05 comment in `build_deribit_native_ledger`
("the replay (trade/delivery rows only)") and the `test_smoothed_requires_full_history_crawl` docstring in
`tests/test_smoothed_mtm_core.py`. Update both so the vocabulary does not fork in prose.

Site 5/6 current shape (the arm the new types must flow through, `txn_rows_to_native_daily`):
```python
            contribution = change
            if row_type == "trade" or row_type == "delivery":
                cls = classify_instrument(str(row.get("instrument_name", "")))
                if cls == "option":
                    instant = _row_utc_instant(row.get("timestamp"))
                    if _ts_in_coverage(instant, coverage_windows.get(ccy)):
                        contribution = -_option_commission(row)
                    # else: cash fallback — contribution stays `change`.
                elif (
                    row_type == "delivery"
                    and cls in ("unknown", "spot")
                    and change != 0.0
                ):
                    raise LedgerValuationError(
                        f"Deribit delivery row id={row.get('id')!r} names an "
                        "unclassifiable or spot instrument yet carries nonzero cash — "
                        ...
```
Site 6: the message says "Deribit delivery row". Parameterise it on `row_type!r` so an `assignment`
refusal names itself. Leak discipline: id/type only.

Docstrings that name "trade/delivery" by word and must be updated in the same edit:
`_pre_coverage_option_days`, `_option_activity_after_coverage`, `_option_commission`,
`replay_option_positions`, and the option comment inside `txn_rows_to_native_daily`.

**Fail-closed field guards reused, never duplicated.** Sites 4 and 5 already raise on a missing field:
- `replay_option_positions` raises on an absent/null/blank/non-numeric `position`
  ("the signed post-trade position is the ONLY option-book source; refusing to fabricate it").
- `_option_commission` raises on an absent/null `commission` inside coverage.
An `assignment` lacking either must fail through these guards (D-07). Do NOT add defaults.

#### Edit 4 — the D-02 co-occurrence guard (new shared pure helper)

**Analog A (shared helper, called by both twins):** `describe_unclassified_row` (≈ lines 594–639).
It is pure and total, takes `(row, rows)`, and uses the same-instrument sibling loop:
```python
        instrument = row.get("instrument_name")
        if instrument in (None, ""):
            siblings = "instrument_name absent — no sibling census possible"
        else:
            counts = []
            for sibling_type in _SIBLING_TYPES:
                n = sum(
                    1
                    for other in rows
                    if other is not row
                    and other.get("instrument_name") == instrument
                    and str(other.get("type", "")).strip().lower() == sibling_type
                )
```
**Analog B (an `assert_*` helper that raises `LedgerValuationError`):** `assert_correction_classifiable`
(≈ lines 849–863). It returns None on the passing case and raises one message otherwise:
```python
def assert_correction_classifiable(row: Mapping[str, Any]) -> None:
    """Fail loud on a ``correction`` whose ``info.reason`` is NOT a recognized ..."""
    if correction_is_trading(row):
        return
    raise LedgerValuationError(
        f"Deribit correction row id={row.get('id')!r} "
        ...
    )
```
Build the new helper, e.g. `assert_assignment_uncontested(row, rows) -> None`, as Analog B's shape
with Analog A's sibling predicate. Contesting set: `frozenset({"delivery", "settlement"})`. Fail
closed when `instrument_name` is None or empty. Unlike Analog A, it must RAISE, not be total. Guard
`isinstance(other, Mapping)` in the loop, because the twins skip non-Mapping rows and so should this.

Message requirements (Pitfall 1):
- carry a **discriminator phrase absent from the unknown-type message**, e.g.
  `"shares instrument_name with a delivery/settlement row"`. ⛔ "double-count" is NOT a
  discriminator: the unknown-type message already contains `"never silently drop nor double-count realized cash"`.
- append `+ describe_unclassified_row(row, rows)` (whitelist renderer; no raw fields).
- do not reuse the unknown-type wording "in neither CASH_BEARING nor INFORMATIONAL".

Zero-`change` decision: RESEARCH recommends the guard fire only on a nonzero `change`. Whichever
choice the plan makes, pin it with a test.

#### Edit 5 — call the guard in both twins, at the SAME point

**Analog:** the `correction` per-row gate. It sits at the same position in both twins, after the
INFORMATIONAL skip and the spot-extraction skip, and before the cash-bearing branch.

USD twin, `txn_rows_to_daily_records`:
```python
        if row_type in INFORMATIONAL_TYPES:
            continue
        if _row_is_net_extraction_spot(row, spot_extraction):
            continue
        if row_type == "correction" and not correction_is_trading(row):
            ...
            continue
        if _row_is_cash_bearing(row):
```
Native twin, `txn_rows_to_native_daily`: the same order, with `_NATIVE_INFORMATIONAL_TYPES` and
`_row_is_native_cash_bearing`. In the native twin the options-summary arms (`use_mtm` /
`use_smoothed`) come before the correction gate. Insert `if row_type == "assignment": assert_assignment_uncontested(row, rows)`
right beside the correction gate in BOTH twins, so the twins stay verbatim-parallel. The existing
`[VERBATIM from txn_rows_to_daily_records]` comments show the house convention for marking a
twin-parallel block.

#### Edit 6 (discretion) — widen `_SHAPE_FIELDS`

**Analog:** `_SHAPE_FIELDS` tuple (≈ lines 581–588). You may add `"commission"` and `"position"`
(sizes and fees, not identifiers), so that the next refusal answers the open field question
(CONTEXT [informational]). `test_identifiers_are_REDACTED_by_whitelist` must stay green.

---

### `analytics-service/services/deribit_ingest.py` (service, batch crawl) — D-02 amended backstop

**Analog:** the WR-05 refusal in `build_deribit_native_ledger` (≈ lines 2238–2254):
```python
    if pnl_basis == PNL_BASIS_SMOOTHED_MTM and since_ms is not None:
        raise LedgerValuationError(
            "smoothed_mtm requires a full-history crawl (since_ms=None): the "
            "option-book replay reconstructs absolute positions from the signed "
            "post-trade position field and a cropped window would silently "
            "mis-state the daily MTM"
        )
```
**Placement: inside `_crawl_deribit_ledger`, per `(scope, currency)` batch, AFTER `paginate_txn_log`
returns `rows` and BEFORE `records = txn_rows_to_daily_records(...)`** (CONTEXT amendment + RESEARCH
Q1 step 4). The USD twin runs inside this loop, so a check placed after the crawl, in
`build_deribit_native_ledger`, would come after the USD twin has already summed. `fetch_deribit_ledger_daily_records`
delegates here too, so both entry points are covered. The loop anchor:
```python
    start_ms = since_ms if since_ms is not None else DEFAULT_START_MS
    ...
            rows = await paginate_txn_log(exchange, scope.label, currency, start_ms, end_ms, auth, sleep=sleep)
            ...
            records = txn_rows_to_daily_records(
                rows,
                supplemental_index=supplemental,
                indexable_currencies=indexable,
            )
```
Condition: `since_ms is not None` and any Mapping row with `type == "assignment"` (and a nonzero
`change`, if the plan follows the zero-change decision). Message: "assignment classification
requires a full-history crawl (since_ms=None) ...". It is inert on every production path, which all
pass `since_ms=None` (RESEARCH Q1). `LedgerValuationError` is already imported in this module and is
in `_PERMANENT_LEDGER_ERRORS` downstream. No new import is needed.

Nothing else in `deribit_ingest.py` changes. `total_return_rows` (via `_row_is_cash_bearing`) and
`deribit_raw_rows_have_option_activity` pick up `assignment` automatically (RESEARCH Q2-A).

---

### `analytics-service/docs/evidence/drb-assignment-census-2026-09.json` (new, evidence)

**Analog:** `analytics-service/docs/evidence/drb-options-semantics-2026-07.json`. Its top-level
keys, measured: `_evidence`, `_generated`, `_subject`, `_sources`, `E1_...`, `E2_...`, ...,
`settled_do_not_reopen`. `drb02-deribit-field-semantics-2026-07-05.json` uses `_method` / `_finding` /
`classification`. Convention: underscore-prefixed metadata first, then finding keys.

Example of the analog's style (values abbreviated):
```json
"_evidence": "DRB options-semantics — consolidated Task-E record for Phase 82 (options-aware native daily P&L)",
"_generated": "2026-07-08",
"settled_do_not_reopen": ["field is `change` NOT cashflow (drb02)", "..."]
```
⛔ **Do NOT copy the analogs' `_subject` / `accounts` content.** Those fields carry key ids and
strategy names. The D-03 file holds counts and categories only: `type`, `currency`,
`option_kind: "put"`, `side: "close buy"`, `instrument_expired_before_observation: true`,
`change_nonzero: true` (a boolean, never the value), `same_instrument_sibling_census: {delivery: 0, settlement: 0, trade: 1}`,
`n: 1`, `_method`, a docs-corroboration sentence, and `limits` (n=1; `position`/`commission`
presence unobservable through `_SHAPE_FIELDS`). No job id, correlation id, account, instrument
strike or expiry string, strategy name, or `change` value.

No existing test loads a `docs/evidence/*.json` file (grep measured 0 hits). If the plan adds the
"evidence file parses and carries no forbidden keys" test, resolve the path with
`Path(__file__).resolve().parent.parent / "docs" / "evidence" / ...`. That mirrors
`tests/conftest.py`'s `FIXTURES_DIR = Path(__file__).parent / "fixtures"`.

---

### `analytics-service/tests/test_deribit_unclassified_evidence.py` (test, re-point per D-05)

**Analog:** itself. It currently has three tests that use `ASSIGNMENT_ROW` and flip under D-01
(RESEARCH Q3):
- `test_refusal_carries_the_shape_and_the_sibling_census`
- `test_the_native_sibling_refusal_carries_it_too`
- `test_a_zero_change_unknown_type_still_passes_silently`

Current fixture shape (keep the redaction-bait fields when re-pointing):
```python
ASSIGNMENT_ROW = {
    "type": "assignment",
    "currency": "BTC",
    "change": <nonzero>,  # magnitude deliberately not reproduced (D-01)
    "instrument_name": INSTRUMENT,
    "timestamp": 1757678400000,
    # ... plus synthetic user_id / order_id / username redaction-bait fields
}
```
Re-point: add an `UNKNOWN_ROW = dict(ASSIGNMENT_ROW, type="<still-unknown type, e.g. mystery_new_type>")`.
Use it in the three flipping tests, and add `assert "<D-02 discriminator>" not in msg` to each
refusal test (Pitfall 1: after D-02, the old fixture would go green for the wrong reason).
⚠️ Warning sign: a re-pointed test that still uses `type: "assignment"`.

The module docstring's paragraph "⚠️ These tests deliberately do NOT assert any classification for
`assignment`" is now false. Rewrite it to point at the new D-01/D-02 tests and the D-03 file. The
docstring also quotes the refusal with its `change` value. Do not add further magnitude text.

Unaffected (they call `describe_unclassified_row` directly):
`test_the_census_DISTINGUISHES_the_two_worlds`, `test_identifiers_are_REDACTED_by_whitelist`,
`test_the_renderer_never_raises_on_a_hostile_row`.

---

### `analytics-service/tests/test_deribit_txn.py` — `test_type_sets_pinned_to_evidence` (test)

**Analog:** itself (≈ line 359):
```python
def test_type_sets_pinned_to_evidence() -> None:
    # Return-bearing: trade (fees), settlement (PnL+funding), delivery (expiry),
    # liquidation (forced-close), negative_balance_fee (cost of carry).
    assert CASH_BEARING_TYPES == {
        "trade",
        "settlement",
        "delivery",
        "liquidation",
        "negative_balance_fee",
    }
    ...
    for unknown in ("mystery_new_type", "rebate_v2"):
        assert unknown not in CASH_BEARING_TYPES
        assert unknown not in INFORMATIONAL_TYPES
```
Add `"assignment"` to the exact-set pin, with a comment citing the D-03 file. Also pin
`"exercise"` and `"expiry"` as still in NEITHER set (CONTEXT [informational]: they stay refused).
This is the same pattern as the existing `options_settlement_summary` and `correction` not-in
assertions.

---

### `analytics-service/tests/test_deribit_assignment.py` (new test file; or extend `test_deribit_txn.py`)

**Imports analog:** `tests/test_deribit_txn.py` header and `tests/test_deribit_ingest.py` header:
```python
from __future__ import annotations

import pytest
from datetime import datetime

from services.deribit_txn import (
    LedgerValuationError,
    ...
)
# crawl-level:
from typing import Any
from services import deribit_ingest as di
```
`tests.fixtures...` is importable as a package (`from tests.fixtures.deribit_flow_fixtures import ...`
in `test_deribit_txn.py`). A new file can reuse private helpers by importing them from the sibling
test module, or copy the three small row builders. Copying avoids cross-test-module coupling;
that choice is the planner's.

**Row builders to reuse or copy (from `test_deribit_txn.py`):**
```python
def _ms(iso: str) -> int:
    return int(datetime.fromisoformat(iso).timestamp() * 1000)

def _option_trade(ts, *, ccy="BTC", change, commission=0.0007,
                  instrument="BTC-14JUL25-60000-C", rid=0) -> dict[str, object]:
    return {"type": "trade", "instrument_name": instrument, "currency": ccy,
            "change": change, "commission": commission, "timestamp": _ms(ts), "id": 8210000 + rid}

def _summary_row(ts, *, ccy="BTC", rpl=0.0, upl=0.0, rid=0) -> dict[str, object]:
    # options_settlement_summary: change ALWAYS 0.0; P&L in realized_pl + unrealized_pl

def _opt_row(*, instrument, ccy, day, position, id, type="trade") -> dict[str, object]:
    # `type=` already parameterised → type="assignment" drops in for the replay tests
```
Replay analog: `test_replay_option_long_build_reduce_close` (after the `_opt_row` definition). It
uses trade, trade, then `type="delivery"` at position 0.0. The D-07 site-4 test is the same shape
with `type="assignment"` closing a short (-1.0 → 0.0), plus a missing-`position` refusal.

**Fail-loud test analog:** `test_unknown_change_type_fails_loud` (parametrised). A linear `USDC`
currency isolates the type guard from index conversion:
```python
    row = {
        "type": unknown_type,
        "instrument_name": "BTC-PERPETUAL",
        "currency": "USDC",  # USD-family: isolates the type guard from conversion
        "change": 42.0,
        ...
    }
    with pytest.raises(ValueError) as exc:
        txn_rows_to_daily_records([row])
```
⚠️ Pitfall 4: a BTC (inverse) `assignment` in the USD twin needs an own `index_price`, a same-day
index-bearing row, or `supplemental_index=`. Otherwise it raises the D-07 index error instead of
exercising the behaviour under test.

**Crawl-level stubs (for the `since_ms` backstop test):** `_patch_pipeline` in
`tests/test_deribit_ingest.py`:
```python
def _patch_pipeline(monkeypatch, *, scopes, currencies, paginate, auth=None) -> None:
    """Monkeypatch the four I/O primitives the producer composes."""
    ...
    monkeypatch.setattr(di, "enumerate_scopes", _enumerate_scopes)
    monkeypatch.setattr(di, "resolve_scope_auth", auth or _resolve_scope_auth)
    monkeypatch.setattr(di, "enumerate_currencies", _enumerate_currencies)
    monkeypatch.setattr(di, "paginate_txn_log", paginate)
```
Usage analog: `test_ledger_producer_loops_scope_x_currency` calls
`await di.fetch_deribit_ledger_daily_records(object())` with async tests (no decorator; the suite
runs asyncio auto mode). ⚠️ `_crawl_deribit_ledger` also calls `build_deribit_indexable_currencies`.
Use a linear currency, or check how existing `_patch_pipeline` tests avoid that network call, before
asserting.

**Full-history refusal test analog:** `tests/test_smoothed_mtm_core.py`
`test_smoothed_requires_full_history_crawl`. It asserts the refusal with `since_ms=1`, then proves
the non-windowed path still builds (SC-4 pair):
```python
    with pytest.raises(LedgerValuationError) as exc:
        _run_options_ledger(monkeypatch, btc_rows=..., summaries=..., charts=...,
                            pnl_basis="smoothed_mtm", since_ms=1)
    assert "full-history" in str(exc.value)
    # SC-4: cash_settlement with the SAME since_ms still builds ...
```
Mirror this: `since_ms=1` plus an `assignment` row → refuse; `since_ms=None` with the same rows →
ingests; `since_ms=1` without an `assignment` → still ingests (the backstop stays inert off-shape).
`_run_options_ledger(monkeypatch, *, btc_rows, summaries, charts, pnl_basis, since_ms=None)` in
`test_smoothed_mtm_core.py` is the options-ledger harness for the mark_to_market and smoothed tests.

**Tests the plan must contain (RESEARCH Validation Architecture):**
- D-01: the census shape (opening option `trade` + `assignment`, side `close buy`, no sibling) is
  summed on the USD twin (per day) and the native twin (per day, ccy), and `assert_balance_identity`
  closes under `cash_settlement`.
- D-02: `assignment` + same-instrument `delivery` refuses on both twins, and likewise with
  `settlement`. The discriminator phrase is present and the census is appended. An empty
  `instrument_name` refuses. The zero-change choice is pinned.
- D-07: site 5, a `mark_to_market` `assignment` inside coverage contributes `-commission` (with the
  `_summary_row`/`_option_trade` coverage setup, analog `test_option_trade_premium_excluded_fee_kept_inside_coverage`);
  site 4, the replay zeroes the short; site 6, a spot-named `assignment` refuses; the
  `_OPTION_BOOK_EVENT_TYPES <= CASH_BEARING_TYPES` invariant holds.
- Every new data-integrity assertion goes through neuter → observe RED → restore, using a byte
  backup. ⛔ Never `git checkout --`.

---

### `analytics-service/docs/deribit-ingestion-design.md` (docs)

**Analog:** its own `### Type allow-list (fail loud on unknown — the enum is officially extensible)`
section:
```
- **INCLUDE (return-bearing, sum `change`):** `trade`, `settlement`, `delivery`, `liquidation`,
  `negative_balance_fee`. ...
```
Add `assignment` to the INCLUDE list, with its census-shape licence and the D-03 citation. Every
basis paragraph that says option `` `trade`/`delivery` `` rows (grep `trade\`/\`delivery`, several
hits) becomes trade/delivery/assignment, or points at the new constant by symbol.

---

## Shared Patterns

### Error type: `LedgerValuationError`
**Source:** `analytics-service/services/deribit_txn.py` `class LedgerValuationError(ValueError)`
**Apply to:** the D-02 guard, the `_crawl_deribit_ledger` backstop, and the site-6 refusal.
It is a permanent structural error. `run_stitch_composite_job` treats it via
`_PERMANENT_LEDGER_ERRORS`. Never raise a bare `ValueError` on these paths.

### Leak discipline in refusal text
**Source:** `describe_unclassified_row` (whitelist `_SHAPE_FIELDS`) and every existing raise, which
names `id=`/`type=` only.
**Apply to:** every new message. Any row detail goes through `describe_unclassified_row(row, rows)`.
Never f-string a raw row, balance, or `user_id`.

### Twin parity
**Source:** the `[VERBATIM from txn_rows_to_daily_records]` comments in `txn_rows_to_native_daily`,
and the `correction` gate placed identically in both twins.
**Apply to:** the D-02 guard call. It goes at the same position in both twins, calls the same
helper, and carries the same message.

### Import-time invariants
**Source:** the `assert not (CASH_BEARING_TYPES & INFORMATIONAL_TYPES)` family and the
`_NATIVE_OPTIONS_SUMMARY_TYPES` asserts.
**Apply to:** the new `_OPTION_BOOK_EVENT_TYPES <= CASH_BEARING_TYPES` assert.

### Full-history precondition
**Source:** the WR-05 `smoothed_mtm requires a full-history crawl` refusal in `build_deribit_native_ledger`.
**Apply to:** the `assignment` windowed-crawl backstop in `_crawl_deribit_ledger`.

### Purity
`deribit_txn.py` is pandas- and async-free, enforced by an AST purity guard in `test_deribit_txn.py`.
The new helper and constant must be stdlib-only.

## No Analog Found

None. Every file is an edit beside an existing pattern, or a new file with a direct sibling.

## Metadata

**Analog search scope:** `analytics-service/services/deribit_txn.py`, `analytics-service/services/deribit_ingest.py`,
`analytics-service/tests/test_deribit_*.py`, `analytics-service/tests/test_smoothed_mtm_core.py`,
`analytics-service/tests/conftest.py`, `analytics-service/docs/evidence/*.json`,
`analytics-service/docs/deribit-ingestion-design.md`
**Files scanned:** 10
**Pattern extraction date:** 2026-09-26
**Test runner reminder:** pytest ONLY from `analytics-service/`, with the four TEST env vars unset
(see RESEARCH Validation Architecture). No live broker, no uvicorn.
