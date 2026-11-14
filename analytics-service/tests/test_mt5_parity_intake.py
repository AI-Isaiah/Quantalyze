"""PARITY-01: no value enters a comparison unless its provenance is the terminal, the
terminal's own export or a broker statement.

The synthetic worksheet is complete against ``required-readings.json`` and bound to
the synthetic Report by sha256. Every broken copy below is built from it with one
edit, so each refusal is attributable to that edit alone. Expected figures are
hand literals or come from the hand-written ledger fixture, never from the code
under test.
"""
from __future__ import annotations

import dataclasses
import hashlib
import json
import re
from pathlib import Path
from typing import Any

import pytest

from services.mt5_parity_intake import (
    PROVENANCE_VALUES,
    ProvenanceRefused,
    Reading,
    ReportBindingRefused,
    RequiredReading,
    UnknownReading,
    Worksheet,
    WorksheetIncomplete,
    WorksheetRefused,
    bind_report,
    load_required_readings,
    load_worksheet,
    require_complete,
    require_provenance,
)
from services.mt5_parity_report import parse_report

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "mt5_parity"
RUNBOOK_DIR = Path(__file__).resolve().parents[2] / "docs" / "runbooks" / "mt5-parity"
READINGS_PATH = RUNBOOK_DIR / "required-readings.json"
SCRIPT_PATH = RUNBOOK_DIR / "founder-session.md"
WORKSHEET_PATH = FIXTURES / "worksheet_synthetic.json"
REPORT_UTF16 = (FIXTURES / "report_synthetic.utf16le.html").read_bytes()


def _required() -> tuple[RequiredReading, ...]:
    return load_required_readings(READINGS_PATH)


def _worksheet() -> Worksheet:
    return load_worksheet(WORKSHEET_PATH)


def _with_readings(readings: tuple[Reading, ...], label: str = "SYN-A") -> Worksheet:
    return Worksheet(synthetic=True, accounts={label: readings})


def _syn_a() -> tuple[Reading, ...]:
    return _worksheet().accounts["SYN-A"]


def _replace_reading(reading_id: str, **changes: Any) -> Worksheet:
    out = tuple(
        dataclasses.replace(r, **changes) if r.id == reading_id else r for r in _syn_a()
    )
    return _with_readings(out)


def _missing_ids(message: str) -> set[str]:
    """The ids named after ``SYN-A:`` in a WorksheetIncomplete message."""
    match = re.search(r"SYN-A: ([a-z0-9_, ]+)\)", message)
    assert match, message
    return {part.strip() for part in match.group(1).split(",")}


# --- provenance --------------------------------------------------------------------


def test_the_provenance_enum_is_exactly_the_three_oracle_sources() -> None:
    assert PROVENANCE_VALUES == frozenset(
        {"terminal_reading", "terminal_report_export", "broker_statement"}
    )


@pytest.mark.parametrize(
    "value",
    [
        "gateway",
        "mt5_soak.reconcile_parity",
        "quantalyze",
        "",
        None,
        " terminal_reading",
        "terminal_reading ",
        "Terminal_Reading",
        "TERMINAL_READING",
        "broker statement",
    ],
)
def test_every_non_oracle_provenance_is_refused_and_named(value: object) -> None:
    with pytest.raises(ProvenanceRefused) as caught:
        require_provenance(value)
    assert repr(value) in str(caught.value)


@pytest.mark.parametrize("value", sorted(PROVENANCE_VALUES))
def test_the_three_oracle_sources_are_accepted_as_written(value: str) -> None:
    assert require_provenance(value) == value


# --- the shared list ---------------------------------------------------------------


def test_the_shared_list_loads_and_is_well_formed() -> None:
    required = _required()
    ids = [spec.id for spec in required]
    assert len(ids) == len(set(ids)) == 13
    for spec in required:
        assert spec.provenance <= PROVENANCE_VALUES and spec.provenance
        assert spec.min_count >= 1 and spec.founder_prompt.strip()
    by_id = {spec.id: spec for spec in required}
    assert by_id["statement_equity"].provenance == frozenset({"broker_statement"})
    assert by_id["all_history_report_sha256"].provenance == frozenset(
        {"terminal_report_export"}
    )
    assert by_id["weekend_close_equity"].as_of == "required"
    assert by_id["credit"].as_of == "forbidden"


def _list_copy(tmp_path: Path, mutate: Any) -> Path:
    doc = json.loads(READINGS_PATH.read_text(encoding="utf-8"))
    mutate(doc)
    out = tmp_path / "required-readings.json"
    out.write_text(json.dumps(doc), encoding="utf-8")
    return out


def test_the_list_loader_refuses_a_provenance_outside_the_three(tmp_path: Path) -> None:
    path = _list_copy(
        tmp_path, lambda d: d["readings"][0].update(provenance=["gateway"])
    )
    with pytest.raises(ProvenanceRefused, match="gateway"):
        load_required_readings(path)


def test_the_list_loader_refuses_a_duplicate_id(tmp_path: Path) -> None:
    path = _list_copy(tmp_path, lambda d: d["readings"].append(dict(d["readings"][0])))
    with pytest.raises(WorksheetRefused, match="repeats the id"):
        load_required_readings(path)


# --- completeness ------------------------------------------------------------------


def test_the_synthetic_worksheet_is_complete_and_stays_synthetic() -> None:
    worksheet = _worksheet()
    require_complete(worksheet, _required())
    assert worksheet.synthetic is True


def test_an_account_with_no_readings_names_every_required_id() -> None:
    required = _required()
    with pytest.raises(WorksheetIncomplete) as caught:
        require_complete(_with_readings(()), required)
    assert _missing_ids(str(caught.value)) == {spec.id for spec in required}


def test_one_missing_reading_names_only_that_reading() -> None:
    kept = tuple(r for r in _syn_a() if r.id != "statement_equity")
    with pytest.raises(WorksheetIncomplete) as caught:
        require_complete(_with_readings(kept), _required())
    assert _missing_ids(str(caught.value)) == {"statement_equity"}


def test_every_account_is_reported_not_just_the_first() -> None:
    kept = tuple(r for r in _syn_a() if r.id != "credit")
    worksheet = Worksheet(synthetic=True, accounts={"SYN-A": kept, "SYN-B": ()})
    with pytest.raises(WorksheetIncomplete) as caught:
        require_complete(worksheet, _required())
    message = str(caught.value)
    assert "SYN-A: credit" in message and "SYN-B: " in message


def test_a_worksheet_with_no_account_is_incomplete() -> None:
    with pytest.raises(WorksheetIncomplete):
        require_complete(Worksheet(synthetic=True, accounts={}), _required())


def test_a_reading_may_only_carry_a_provenance_allowed_for_its_id() -> None:
    # statement_equity is a broker statement figure: a terminal reading of it would
    # be the founder reading our own number back to us.
    out = tuple(
        dataclasses.replace(r, provenance="terminal_reading")
        if r.id == "statement_equity" and r.as_of == "2026-11-06"
        else r
        for r in _syn_a()
    )
    with pytest.raises(ProvenanceRefused, match="statement_equity"):
        require_complete(_with_readings(out), _required())


def test_a_reading_id_outside_the_list_is_refused_by_name() -> None:
    extra = _syn_a() + (Reading("quantalyze_equity", None, 1.0, "terminal_reading"),)
    with pytest.raises(UnknownReading, match="quantalyze_equity"):
        require_complete(_with_readings(extra), _required())


def test_the_as_of_rule_is_enforced_both_ways() -> None:
    with pytest.raises(WorksheetRefused, match="must not carry an as_of"):
        require_complete(_replace_reading("credit", as_of="2026-11-13"), _required())
    with pytest.raises(WorksheetRefused, match="needs an as_of"):
        require_complete(
            _replace_reading("weekend_close_equity", as_of=None), _required()
        )


def test_a_non_finite_money_reading_is_refused() -> None:
    for bad in (float("nan"), float("inf")):
        with pytest.raises(WorksheetRefused, match="summary_equity_at_t"):
            require_complete(
                _replace_reading("summary_equity_at_t", value=bad), _required()
            )


@pytest.mark.parametrize(
    ("reading_id", "bad"),
    [
        ("trade_mode", "paper"),
        ("summary_instant_utc", "2026-11-16 10:00:00"),
        ("summary_instant_utc", "2026-11-16T10:00:00+00:00"),
        ("summary_instant_utc", "2026-13-16T10:00:00Z"),
        ("all_history_report_sha256", "ABC"),
        ("all_history_report_sha256", "A" * 64),
        ("account_currency", "  "),
        ("credit", "0.00"),
    ],
)
def test_a_value_of_the_wrong_kind_is_refused(reading_id: str, bad: str) -> None:
    with pytest.raises(WorksheetRefused, match=reading_id):
        require_complete(_replace_reading(reading_id, value=bad), _required())


def test_the_same_reading_twice_for_one_as_of_is_refused() -> None:
    doubled = _syn_a() + (
        Reading("statement_equity", "2026-11-06", 11900.0, "broker_statement"),
    )
    with pytest.raises(WorksheetRefused, match="twice"):
        require_complete(_with_readings(doubled), _required())


# --- binding the Report to the worksheet -------------------------------------------


def test_the_synthetic_report_is_bound_to_the_worksheet_by_sha256() -> None:
    worksheet = _worksheet()
    bind_report(worksheet, "SYN-A", REPORT_UTF16)
    recorded = next(r for r in _syn_a() if r.id == "all_history_report_sha256")
    assert recorded.value == hashlib.sha256(REPORT_UTF16).hexdigest()


def test_one_changed_byte_breaks_the_binding() -> None:
    tampered = bytearray(REPORT_UTF16)
    tampered[-3] ^= 0x01
    with pytest.raises(ReportBindingRefused, match="SYN-A"):
        bind_report(_worksheet(), "SYN-A", bytes(tampered))


def test_the_binding_refuses_an_unknown_account_and_a_missing_or_foreign_reading() -> None:
    with pytest.raises(ReportBindingRefused, match="no account"):
        bind_report(_worksheet(), "SYN-Z", REPORT_UTF16)
    without = tuple(r for r in _syn_a() if r.id != "all_history_report_sha256")
    with pytest.raises(ReportBindingRefused, match="exactly one"):
        bind_report(_with_readings(without), "SYN-A", REPORT_UTF16)
    foreign = _replace_reading("all_history_report_sha256", provenance="terminal_reading")
    with pytest.raises(ReportBindingRefused, match="terminal_report_export"):
        bind_report(foreign, "SYN-A", REPORT_UTF16)


def test_the_worksheet_and_the_report_describe_one_account() -> None:
    # An independent cross-check: the worksheet's Summary balance reading is the
    # last balance of the Report it is bound to, and the deposit-currency reading
    # matches the ledger's unit. Neither number is produced by the code under test.
    ledger = json.loads((FIXTURES / "ledger_synthetic.json").read_text(encoding="utf-8"))
    readings = {r.id: r.value for r in _syn_a() if r.as_of is None}
    parsed = parse_report(REPORT_UTF16)
    assert parsed.deals[-1]["balance"] == readings["summary_balance_at_t"] == 12070.0
    assert readings["account_currency"] == ledger["unit"]
    friday_balances = {
        r.as_of: r.value for r in _syn_a() if r.id == "statement_equity"
    }
    assert friday_balances["2026-10-30"] == ledger["nav_close"]["2026-10-30"]


# --- the founder script and the intake read ONE list --------------------------------


def _script_ids(markdown: str) -> set[str]:
    """Backticked first cells of the Readings table in founder-session.md."""
    lines = markdown.split("\n")
    start = next(i for i, ln in enumerate(lines) if ln.strip() == "## Readings")
    ids: set[str] = set()
    for line in lines[start + 1 :]:
        if line.startswith("## "):
            break
        cell = re.match(r"^\|\s*`([a-z0-9_]+)`\s*\|", line)
        if cell:
            ids.add(cell.group(1))
    return ids


def _assert_script_matches(list_ids: set[str], markdown: str) -> None:
    script_ids = _script_ids(markdown)
    missing = sorted(list_ids - script_ids)
    extra = sorted(script_ids - list_ids)
    assert not missing and not extra, (
        f"founder-session.md and required-readings.json disagree: "
        f"missing from the script {missing}, not in the list {extra}"
    )


def test_the_founder_script_names_exactly_the_ids_in_the_list() -> None:
    list_ids = {spec.id for spec in _required()}
    markdown = SCRIPT_PATH.read_bytes().decode("utf-8")
    assert len(list_ids) == 13
    _assert_script_matches(list_ids, markdown)
    for spec in _required():
        assert spec.founder_prompt in markdown, spec.id


def test_the_id_check_fails_when_a_row_is_removed_from_either_side() -> None:
    list_ids = {spec.id for spec in _required()}
    markdown = SCRIPT_PATH.read_bytes().decode("utf-8")

    without_row = "\n".join(
        ln for ln in markdown.split("\n") if not ln.startswith("| `weekend_close_equity`")
    )
    with pytest.raises(AssertionError, match="weekend_close_equity"):
        _assert_script_matches(list_ids, without_row)

    with pytest.raises(AssertionError, match="statement_equity"):
        _assert_script_matches(list_ids - {"statement_equity"} | {"made_up"}, markdown)


def test_the_founder_script_leaks_nothing_and_carries_no_link() -> None:
    markdown = SCRIPT_PATH.read_bytes().decode("utf-8")
    planning = "." + "planning"
    home = "/" + "Users" + "/"
    for forbidden in (planning, home, "http://", "https://", "](", "@"):
        assert forbidden not in markdown, forbidden
    for section in (
        "## Before the session",
        "## Readings",
        "## Export the All-History Report",
        "## Where values go",
    ):
        assert section in markdown, section
