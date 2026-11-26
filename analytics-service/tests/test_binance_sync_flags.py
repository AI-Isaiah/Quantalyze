"""Phase 253 BINANCECURSOR plan 04 (SC-3, D-08, D-09): the sync-time `binance_*` flag allowlist,
its shape validators, the carry, the clear and the guarded prior-flags read.

WHY THIS MATTERS. The Binance sync writes `binance_stop_below_cursor` and eight sibling keys onto
`strategy_analytics.data_quality_flags`; the chained derive prestamp and the CSV rebuild replace
that column wholesale, so each key is carried by an EXPLICIT allowlist (never a prefix match: a
later `binance_*` key written for another purpose must not be republished by accident) and a
malformed value is dropped rather than republished. The parity scan ties the allowlist to the
producers in `services/exchange.py` and `services/job_worker.py`, so adding a producer without
adding it here fails this file instead of silently dropping the key at the first derive.

NEUTER (PROOF-01; recorded verbatim in the 253-04 SUMMARY):
  F5 remove `binance_deadline_symbols` from BINANCE_SYNC_FLAG_KEYS:
     test_the_allowlist_equals_the_set_of_binance_keys_the_producers_write goes RED.
"""

from __future__ import annotations

import ast
import logging
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import pytest

from services.binance_sync_flags import (
    BINANCE_SYNC_FLAG_KEYS,
    carry_binance_sync_flags,
    clear_absent_binance_sync_flags,
    read_binance_sync_flags,
)

_SERVICES = Path(__file__).resolve().parent.parent / "services"

_VALID: dict[str, Any] = {
    "binance_fills_reach_clamped": True,
    "binance_fill_cursor_advance_plus1": True,
    "binance_stop_below_cursor": True,
    "binance_partial_symbols": ["BTCUSDT", "ETHUSDT"],
    "binance_unlisted_symbols": ["XYZUSDT"],
    "binance_page_cap_symbols": ["BTCUSDT"],
    "binance_untimed_page_symbols": ["SOLUSDT"],
    "binance_deadline_symbols": ["BNBUSDT"],
    "binance_read_through_ms": 1780304400000,
}


def test_the_fixture_names_exactly_the_nine_allowlisted_keys() -> None:
    assert set(_VALID) == set(BINANCE_SYNC_FLAG_KEYS)
    assert len(BINANCE_SYNC_FLAG_KEYS) == 9


@pytest.mark.parametrize("key", sorted(_VALID))
def test_every_allowlisted_key_is_carried_with_its_shape(key: str) -> None:
    carried = carry_binance_sync_flags({key: _VALID[key], "csv_source": True})
    assert carried == {key: _VALID[key]}


def test_a_carried_list_is_a_deep_copy() -> None:
    src = {"binance_deadline_symbols": ["BTCUSDT"]}
    carried = carry_binance_sync_flags(src)
    carried["binance_deadline_symbols"].append("MUTATED")
    assert src["binance_deadline_symbols"] == ["BTCUSDT"]


_TRUE_KEYS = [
    "binance_fills_reach_clamped",
    "binance_fill_cursor_advance_plus1",
    "binance_stop_below_cursor",
]
_LIST_KEYS = [
    "binance_partial_symbols",
    "binance_unlisted_symbols",
    "binance_page_cap_symbols",
    "binance_untimed_page_symbols",
    "binance_deadline_symbols",
]


@pytest.mark.parametrize("key", _TRUE_KEYS)
@pytest.mark.parametrize("bad", [False, 1, "x", None, ["x"], {}])
def test_a_true_only_key_rejects_anything_but_true(key: str, bad: object) -> None:
    assert carry_binance_sync_flags({key: bad}) == {}


@pytest.mark.parametrize("key", _LIST_KEYS)
@pytest.mark.parametrize("bad", [[], [1], ["ok", 2], "BTCUSDT", None, True, {"a": 1}])
def test_a_symbol_list_key_rejects_anything_but_a_non_empty_list_of_str(
    key: str, bad: object
) -> None:
    assert carry_binance_sync_flags({key: bad}) == {}


@pytest.mark.parametrize("bad", [True, False, -1, 1.5, "1780304400000", None, [1]])
def test_the_read_through_key_rejects_anything_but_a_non_negative_non_bool_int(
    bad: object,
) -> None:
    assert carry_binance_sync_flags({"binance_read_through_ms": bad}) == {}


def test_zero_is_a_valid_read_through_instant() -> None:
    assert carry_binance_sync_flags({"binance_read_through_ms": 0}) == {"binance_read_through_ms": 0}


@pytest.mark.parametrize("flags", [None, [], "x", 3, MagicMock()])
def test_a_non_dict_input_carries_nothing_and_never_raises(flags: object) -> None:
    assert carry_binance_sync_flags(flags) == {}


def test_a_key_outside_the_allowlist_is_never_carried() -> None:
    carried = carry_binance_sync_flags(
        {
            "sync_truncated_okx": True,
            "daily_pnl_malformed_binance": True,
            "daily_pnl_binance_income_fallback": True,
            "binance_something_new": True,
            "binance_stop_below_cursor": True,
        }
    )
    assert carried == {"binance_stop_below_cursor": True}


def test_clear_pops_every_allowlisted_key_the_fresh_flags_lack() -> None:
    existing = {**_VALID, "csv_source": True, "sync_truncated_okx": True}
    assert clear_absent_binance_sync_flags(existing, {}) is True
    assert existing == {"csv_source": True, "sync_truncated_okx": True}


def test_clear_keeps_a_key_the_fresh_run_raised_and_reports_the_rest() -> None:
    existing = {**_VALID}
    fresh = {"binance_page_cap_symbols": ["ETHUSDT"]}
    assert clear_absent_binance_sync_flags(existing, fresh) is True
    assert set(existing) == {"binance_page_cap_symbols"}


def test_clear_reports_false_when_nothing_was_popped() -> None:
    existing = {"csv_source": True, "binance_stop_below_cursor": True}
    assert clear_absent_binance_sync_flags(existing, {"binance_stop_below_cursor": True}) is False
    assert existing == {"csv_source": True, "binance_stop_below_cursor": True}


def _client(answer: object) -> MagicMock:
    client = MagicMock()
    execute = client.table.return_value.select.return_value.eq.return_value.maybe_single.return_value.execute
    if isinstance(answer, Exception):
        execute.side_effect = answer
    else:
        execute.return_value = MagicMock(data=answer)
    return client


def test_the_guarded_read_returns_the_carried_keys_of_the_stored_row() -> None:
    client = _client(
        {"data_quality_flags": {"csv_source": True, "binance_stop_below_cursor": True, "x": 1}}
    )
    assert read_binance_sync_flags(client, "strat-1") == {"binance_stop_below_cursor": True}
    client.table.assert_called_once_with("strategy_analytics")


@pytest.mark.parametrize("answer", [None, {}, {"data_quality_flags": None}, MagicMock()])
def test_the_guarded_read_of_no_row_or_no_keys_is_empty(answer: object) -> None:
    assert read_binance_sync_flags(_client(answer), "strat-1") == {}


def test_the_guarded_read_never_raises_and_logs_one_warning_naming_the_strategy(
    caplog: pytest.LogCaptureFixture,
) -> None:
    with caplog.at_level(logging.WARNING):
        out = read_binance_sync_flags(_client(RuntimeError("refused")), "strat-boom")
    assert out == {}
    named = [r for r in caplog.records if r.levelno == logging.WARNING and "strat-boom" in r.getMessage()]
    assert len(named) == 1
    assert "RuntimeError" in named[0].getMessage()


def _first_arg_constants(tree: ast.AST, func_name: str) -> set[str]:
    out: set[str] = set()
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == func_name
            and node.args
            and isinstance(node.args[0], ast.Constant)
            and isinstance(node.args[0].value, str)
        ):
            out.add(node.args[0].value)
    return out


def _subscript_assign_constants(tree: ast.AST, target_name: str) -> set[str]:
    out: set[str] = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.Assign):
            continue
        for target in node.targets:
            if (
                isinstance(target, ast.Subscript)
                and isinstance(target.value, ast.Name)
                and target.value.id == target_name
                and isinstance(target.slice, ast.Constant)
                and isinstance(target.slice.value, str)
            ):
                out.add(target.slice.value)
    return out


def test_the_allowlist_equals_the_set_of_binance_keys_the_producers_write() -> None:
    """The producers: every `_record_dq_flag("binance_...", ...)` in services/exchange.py (the
    fills read) plus every `exchange_dq_flags["binance_..."] = ...` in services/job_worker.py (the
    worker's own `binance_stop_below_cursor`). A key added to a producer and not to the allowlist
    would be dropped by the first derive; a key left in the allowlist after its producer is gone
    is dead weight that still gets republished."""
    exchange_tree = ast.parse((_SERVICES / "exchange.py").read_text())
    worker_tree = ast.parse((_SERVICES / "job_worker.py").read_text())
    produced = {
        k
        for k in _first_arg_constants(exchange_tree, "_record_dq_flag")
        if k.startswith("binance_")
    } | {
        k
        for k in _subscript_assign_constants(worker_tree, "exchange_dq_flags")
        if k.startswith("binance_")
    }
    assert produced, "the scan found no producer: it has gone blind"
    assert produced == set(BINANCE_SYNC_FLAG_KEYS)
