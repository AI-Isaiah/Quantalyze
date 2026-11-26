"""Phase 175 plan 04 (D-03): the MT5OFFSET dry run.

``scripts/mt5offset_dry_run.py`` turns a captured MT5 ledger into a counts-only before/after
report: for each key, which days move between a legacy fixed server offset and the broker's
daylight-saving rule, and whether that key's allocator snapshots (written once, ON CONFLICT DO
NOTHING) need a forced rebuild. The founder decides the rule switch and the rebuild list on these
counts, so each test names the decision it protects. All data is SYNTHETIC; nothing here opens a
database, a socket or a terminal.

A test that can no longer fail when the intent breaks is a wrong test: the winter test asserts the
VERDICT before any count, so a clock mix-up names the verdict that drives the rebuild approval.
"""
from __future__ import annotations

import ast
import json
from datetime import datetime, timezone
from pathlib import Path

import pytest

from scripts import mt5offset_dry_run as dr
from services.mt5_server_clock import server_clock_for_rule

_ZERO_COSTS = {"swap": 0.0, "commission": 0.0, "fee": 0.0}
_LEGACY_S = 10800  # the +3 h integer production stored history under


def _wall(y: int, mo: int, d: int, hh: int, mm: int = 0) -> int:
    """The broker WALL clock encoded as if it were UTC, in whole seconds: what a deal's ``time`` is."""
    return int(datetime(y, mo, d, hh, mm, tzinfo=timezone.utc).timestamp())


def _deal(deal_type: int, wall_s: int, profit: float) -> dict:
    return {
        "type": deal_type,
        "profit": profit,
        "time": wall_s,
        "time_msc": wall_s * 1000,
        **_ZERO_COSTS,
    }


def _balance(wall_s: int, amount: float) -> dict:
    return _deal(2, wall_s, amount)


def _close(wall_s: int, pnl: float) -> dict:
    return _deal(1, wall_s, pnl)


def _winter_key() -> dict:
    """Two deposits and two closing trades. The 50000 deposit is stamped 02:30 broker time on
    2025-11-11, after the US fall change: under ``us`` (+2) it is 00:30 UTC on 11-11, under the
    legacy +3 it is 23:30 UTC on 11-10. That single deal is the one that moves."""
    deals = [
        _balance(_wall(2025, 10, 1, 12), 10000.0),
        _close(_wall(2025, 11, 9, 12), 500.0),
        _balance(_wall(2025, 11, 11, 2, 30), 50000.0),
        _close(_wall(2025, 11, 12, 12), 100.0),
    ]
    return {"status": "captured", "deals": deals, "equity": 60600.0, "balance": 60600.0, "currency": "USD"}


def _summer_key() -> dict:
    """Every deal in July: ``us`` gives +3, exactly the legacy integer, so nothing can move."""
    deals = [
        _balance(_wall(2025, 7, 1, 12), 20000.0),
        _close(_wall(2025, 7, 8, 12), 300.0),
        _balance(_wall(2025, 7, 15, 2, 30), 5000.0),
        _close(_wall(2025, 7, 20, 12), -100.0),
    ]
    return {"status": "captured", "deals": deals, "equity": 25200.0, "balance": 25200.0, "currency": "USD"}


def test_winter_deposit_after_the_us_fall_change_moves_a_day_and_demands_a_rebuild() -> None:
    """D-03: a deal that lands on another UTC day under the rule changes the stored NAV level of
    that day, so the key's allocator snapshots must be rebuilt. The verdict is asserted FIRST."""
    out = dr.key_shift(
        _winter_key()["deals"],
        60600.0,
        60600.0,
        "USD",
        legacy_offset_s=_LEGACY_S,
        target=server_clock_for_rule("us"),
    )
    assert out["verdict"] == "rebuild"
    assert out["deals"] == 4
    assert out["moved_deals"] == 1
    assert out["moved_flow_deals"] == 1
    assert out["moved_days"] == 2  # 2025-11-10 and 2025-11-11
    assert out["instantless_flow_deals"] == 0
    assert out["level_days_changed"] >= 1


def test_summer_ledger_under_the_us_rule_moves_nothing_and_needs_no_rebuild() -> None:
    """D-03: a key written entirely in daylight time is untouched, so it stays off the rebuild list."""
    out = dr.key_shift(
        _summer_key()["deals"],
        25200.0,
        25200.0,
        "USD",
        legacy_offset_s=_LEGACY_S,
        target=server_clock_for_rule("us"),
    )
    assert out["verdict"] == "none"
    assert out["moved_deals"] == 0
    assert out["moved_flow_deals"] == 0
    assert out["moved_days"] == 0
    assert out["instantless_flow_deals"] == 0
    assert out["level_days_changed"] == 0
    assert out["return_days_changed"] == 0


def test_analyze_numbers_keys_by_capture_order_and_render_names_the_target_and_legacy_offset() -> None:
    """D-03: the founder reads one row per key by ordinal, under a header that says which clock the
    counts compare (the operator runs the script once per stored offset)."""
    captured = {
        "offset_s": _LEGACY_S,
        "keys": {"k-winter": _winter_key(), "k-summer": _summer_key()},
    }
    target = server_clock_for_rule("us")
    analysis = dr.analyze(captured, legacy_offset_s=_LEGACY_S, target=target)
    assert [r["ordinal"] for r in analysis["rows"]] == ["mt5-key-1", "mt5-key-2"]
    assert [r["verdict"] for r in analysis["rows"]] == ["rebuild", "none"]
    text = dr.render_report(analysis, target_label="rule us", legacy_offset_s=_LEGACY_S)
    assert "rule us" in text
    assert "+3 h" in text
    assert "| mt5-key-1 |" in text
    assert "| mt5-key-2 |" in text
    assert "k-winter" not in text and "k-summer" not in text


def test_a_flow_in_the_us_repeated_hour_is_counted_as_left_without_an_instant() -> None:
    """D-07/D-03: a deposit stamped in the hour the US clock repeats has no trustworthy instant
    under the rule, so the founder is told how many flows lose their intraday timing."""
    deals = [
        _balance(_wall(2025, 10, 1, 12), 10000.0),
        _balance(_wall(2025, 11, 2, 8, 30), 2000.0),
        _close(_wall(2025, 11, 5, 12), 50.0),
    ]
    out = dr.key_shift(
        deals, 12050.0, 12050.0, "USD", legacy_offset_s=_LEGACY_S, target=server_clock_for_rule("us")
    )
    assert out["instantless_flow_deals"] == 1


def test_an_unclassifiable_ledger_and_an_uncaptured_key_report_a_class_and_never_a_message() -> None:
    """D-03: a key the tool could not fold is 'not measured', named by its exception class, so the
    founder is never shown a rebuild list with a silent hole; the message could carry a field."""
    bad = {
        "status": "captured",
        "deals": [_balance(_wall(2025, 10, 1, 12), 1000.0), _deal(5, _wall(2025, 10, 2, 12), 7.0)],
        "equity": 1007.0,
        "balance": 1007.0,
        "currency": "USD",
    }
    captured = {
        "offset_s": _LEGACY_S,
        "keys": {"k1": bad, "k2": {"status": "not_captured", "error_class": "Mt5ConnectError"}},
    }
    analysis = dr.analyze(captured, legacy_offset_s=_LEGACY_S, target=server_clock_for_rule("us"))
    first, second = analysis["rows"]
    assert first["verdict"] == "not measured"
    assert first["error_class"] == "Mt5DealClassificationError"
    assert second["verdict"] == "not measured"
    assert second["error_class"] == "Mt5ConnectError"
    text = dr.render_report(analysis, target_label="rule us", legacy_offset_s=_LEGACY_S)
    assert "DEAL_TYPE" not in text and "fail loud" not in text
    assert "Mt5DealClassificationError" in text


def _write_captured(tmp_path: Path, keys: dict) -> Path:
    path = tmp_path / "captured.json"
    path.write_text(json.dumps({"offset_s": _LEGACY_S, "keys": keys}), encoding="utf-8")
    return path


def test_the_command_line_writes_the_report_and_the_id_map_and_scrubs_the_note(tmp_path: Path) -> None:
    """D-03: the run the founder reads is the CLI's; the id map exists only where --map-out says."""
    cap = _write_captured(tmp_path, {"key-id-a": _winter_key(), "key-id-b": _summer_key()})
    out, mapping = tmp_path / "report.md", tmp_path / "map.json"
    code = dr.main(
        [
            "--captured", str(cap), "--rule", "us", "--legacy-offset-s", "10800",
            "--out", str(out), "--map-out", str(mapping), "--note", "seen by a@b.co",
        ]
    )  # fmt: skip
    assert code == 0
    report = out.read_text(encoding="utf-8")
    assert "| mt5-key-1 | rebuild |" in report
    assert "a@b.co" not in report and "[redacted]" in report
    assert json.loads(mapping.read_text(encoding="utf-8")) == {
        "mt5-key-1": "key-id-a",
        "mt5-key-2": "key-id-b",
    }
    assert "key-id-a" not in report


def test_a_fixed_target_is_labelled_and_run(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    """D-03: a no-DST broker is checked against its own fixed integer, and the header says so."""
    cap = _write_captured(tmp_path, {"k": _winter_key()})
    assert dr.main(["--captured", str(cap), "--fixed-offset-s", "7200", "--legacy-offset-s", "10800"]) == 0
    text = capsys.readouterr().out
    assert "fixed +2 h" in text
    assert "Legacy offset: +3 h" in text


def test_a_run_that_measured_nothing_says_so_and_exits_non_zero(tmp_path: Path) -> None:
    """SFH-01 (D-03): the founder unions the 'rebuild' keys, so '0 of N' must never be what a run
    that measured nothing prints. A key that is not measured is counted in the footer, the report is
    still written, and the exit status is non-zero; an empty capture is the same."""
    bad = {"status": "not_captured", "error_class": "Mt5ConnectError"}
    cap = _write_captured(tmp_path, {"k1": bad, "k2": _summer_key()})
    out = tmp_path / "report.md"
    code = dr.main(["--captured", str(cap), "--rule", "us", "--legacy-offset-s", "10800", "--out", str(out)])
    assert code == 1
    report = out.read_text(encoding="utf-8")
    assert "Keys not measured: 1 of 2." in report
    assert "INCOMPLETE" in report
    empty_out = tmp_path / "empty.md"
    code = dr.main(
        [
            "--captured", str(_write_captured(tmp_path, {})), "--rule", "us",
            "--legacy-offset-s", "10800", "--out", str(empty_out),
        ]
    )  # fmt: skip
    assert code == 1
    assert "INCOMPLETE" in empty_out.read_text(encoding="utf-8")


def test_a_complete_run_reports_zero_not_measured_and_exits_zero(tmp_path: Path) -> None:
    """SFH-01 (D-03): the other half, so the non-zero exit is earned by a missing measurement and
    not by every run."""
    cap = _write_captured(tmp_path, {"k": _winter_key()})
    out = tmp_path / "report.md"
    assert dr.main(["--captured", str(cap), "--rule", "us", "--legacy-offset-s", "10800", "--out", str(out)]) == 0
    report = out.read_text(encoding="utf-8")
    assert "Keys not measured: 0 of 1." in report
    assert "INCOMPLETE" not in report


def test_a_capture_offset_that_differs_from_the_legacy_offset_is_named_not_silent(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """SFH-01 (D-03): plan 06 folds one capture under each offset the history was written under, so
    a different --legacy-offset-s is legitimate and is not refused, but the BEFORE fold must never be
    wrong without a line saying which offset it used."""
    cap = _write_captured(tmp_path, {"k": _winter_key()})  # captured at 10800
    out = tmp_path / "report.md"
    assert dr.main(["--captured", str(cap), "--rule", "us", "--legacy-offset-s", "7200", "--out", str(out)]) == 0
    assert "differs from --legacy-offset-s=7200" in capsys.readouterr().err
    assert "capture offset_s=10800 differs from --legacy-offset-s=7200" in out.read_text(encoding="utf-8")


@pytest.mark.parametrize(
    "extra",
    [
        ["--rule", "us", "--fixed-offset-s", "7200", "--legacy-offset-s", "10800"],
        ["--legacy-offset-s", "10800"],
        ["--rule", "us"],
        ["--rule", "asia", "--legacy-offset-s", "10800"],
    ],
    ids=["both-targets", "no-target", "no-legacy", "unknown-rule"],
)
def test_a_bad_command_line_is_a_usage_error(tmp_path: Path, extra: list[str]) -> None:
    """D-03: the target is exactly one of a rule or a fixed offset, the legacy offset is always
    named, and only the two real rules exist; anything else is argparse's exit 2, not a guess."""
    cap = _write_captured(tmp_path, {"k": _winter_key()})
    with pytest.raises(SystemExit) as exc:
        dr.main(["--captured", str(cap), *extra])
    assert exc.value.code == 2


def test_nothing_identifying_reaches_the_report(tmp_path: Path) -> None:
    """T-175-12: a uuid key id, an amount, a server name, a login and an email are all planted;
    the report carries only ordinals and counts."""
    key_id = "123e4567-e89b-12d3-a456-426614174000"
    entry = _winter_key()
    entry["deals"][0] = _balance(_wall(2025, 10, 1, 12), 54321.0)
    entry.update({"equity": 104921.0, "balance": 104921.0, "server": "Broker-Live", "login": 123456789})
    cap = _write_captured(tmp_path, {key_id: entry})
    out = tmp_path / "report.md"
    assert dr.main(
        ["--captured", str(cap), "--rule", "us", "--legacy-offset-s", "10800", "--out", str(out),
         "--note", "owner jane@example.com"]
    ) == 0  # fmt: skip
    report = out.read_text(encoding="utf-8")
    assert "mt5-key-1" in report
    for planted in (key_id, "54321", "Broker-Live", "123456789", "jane@example.com"):
        assert planted not in report


def test_the_script_imports_no_client_or_network_module() -> None:
    """T-175-13: the tool is read-only by construction; its own imports exclude every database
    client and network module. Parsed by path, never imported and inspected."""
    banned = {"supabase", "httpx", "requests", "socket", "psycopg", "psycopg2", "urllib", "aiohttp"}
    tree = ast.parse(Path(dr.__file__).read_text(encoding="utf-8"))
    imported: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported += [alias.name for alias in node.names]
        elif isinstance(node, ast.ImportFrom) and node.module:
            imported.append(node.module)
    assert imported, "the pin must see the script's imports"
    for name in imported:
        assert name.split(".")[0] not in banned, name
        assert name != "services.db" and not name.startswith("services.db."), name


# ---------------------------------------------------------------------------
# MT5D-03 (Phase 230 plan 03): --days-out hands the coordinator day sets, not just counts
# ---------------------------------------------------------------------------

_DAY_LISTS = ("moved_return_days", "moved_level_days", "legacy_return_days", "target_return_days")
_REPLAY_ARGS = ["--rule", "us", "--legacy-offset-s", "7200"]


def _summer_close_key() -> dict:
    """A July ledger whose closing trade is stamped 02:30 broker time. Under legacy +2 that is 00:30 UTC
    on 07-16; under ``us`` summer (+3) it is 23:30 UTC on 07-15, so the trade's P&L moves between two
    return days. A deposit alone never moves a RETURN day (a flow is neutral to a return), so the
    return-day assertions need a trade, while the flow-only summer key proves the NAV-level days."""
    deals = [
        _balance(_wall(2025, 7, 1, 12), 20000.0),
        _close(_wall(2025, 7, 8, 12), 300.0),
        _close(_wall(2025, 7, 16, 2, 30), 400.0),
    ]
    return {"status": "captured", "deals": deals, "equity": 20700.0, "balance": 20700.0, "currency": "USD"}


def _replay(tmp_path: Path, keys: dict, *, days_out: bool, tag: str) -> tuple[str, dict | None]:
    """One CLI replay under the one fold the attribution rests on (legacy 7200, rule us)."""
    cap = _write_captured(tmp_path, keys)
    out = tmp_path / f"report-{tag}.md"
    argv = ["--captured", str(cap), *_REPLAY_ARGS, "--out", str(out)]
    days = tmp_path / f"days-{tag}.json"
    if days_out:
        argv += ["--days-out", str(days)]
    dr.main(argv)
    return out.read_text(encoding="utf-8"), (
        json.loads(days.read_text(encoding="utf-8")) if days_out else None
    )


def test_days_out_holds_the_moved_and_fold_day_sets_per_ordinal_and_nothing_identifying(
    tmp_path: Path,
) -> None:
    """MT5D-03: the replay is compared with 202's moved DAYS, not counts (s5, s8 and s13 report
    identical counts), so the file carries four sorted ISO-date lists per ordinal and, to stay
    scratch-safe, no id, amount or deal field. Each moved list is as long as the report's count."""
    key_id = "123e4567-e89b-12d3-a456-426614174000"
    entry = _summer_close_key()
    entry.update({"server": "Broker-Live", "login": 123456789})
    report, days = _replay(tmp_path, {key_id: entry}, days_out=True, tag="shape")
    assert days is not None and list(days) == ["mt5-key-1"]
    row = days["mt5-key-1"]
    assert sorted(row) == sorted(_DAY_LISTS)
    for name in _DAY_LISTS:
        assert row[name] == sorted(row[name]), name
        assert all(len(d) == 10 and d[4] == "-" for d in row[name]), name
    assert row["moved_return_days"], "a summer trade folded under 7200 then us must move return days"
    def _cells(prefix: str) -> list[str]:
        line = next(ln for ln in report.splitlines() if ln.startswith(prefix))
        return [c.strip() for c in line.split("|")]

    cells, labels = _cells("| mt5-key-1 |"), _cells("| key |")
    count = lambda label: int(cells[labels.index(label)])  # noqa: E731
    assert len(row["moved_return_days"]) == count("return days changed")
    assert len(row["moved_level_days"]) == count("NAV-level days changed")
    blob = (tmp_path / "days-shape.json").read_text(encoding="utf-8")
    for planted in (key_id, "Broker-Live", "123456789", "20000", "deal", "profit"):
        assert planted not in blob


def test_days_out_under_7200_and_us_moves_a_summer_flow_and_not_a_winter_one(tmp_path: Path) -> None:
    """MT5D-03 / DEC-03-A: both older sides of 202's pairs were written under 7200, so the
    structural prediction is that US-summer deals move a day (the rule says +3, the history says +2)
    and US-winter ones do not (the two agree). If this inverts, the attribution rests on nothing.
    A summer FLOW moves its NAV-level day; a summer TRADE moves its return day."""
    _, days = _replay(
        tmp_path,
        {"k-flow": _summer_key(), "k-trade": _summer_close_key(), "k-winter": _winter_key()},
        days_out=True,
        tag="season",
    )
    assert days is not None
    assert days["mt5-key-1"]["moved_level_days"], "a summer flow must move a level day under 7200 -> us"
    # A flow is neutral to a return: the level set and the return set are different evidence.
    assert days["mt5-key-1"]["moved_return_days"] == []
    assert days["mt5-key-2"]["moved_return_days"] == ["2025-07-15", "2025-07-16"]
    assert days["mt5-key-3"]["moved_return_days"] == [], "winter key must not move under 7200 -> us"
    assert days["mt5-key-3"]["moved_level_days"] == []


def test_the_report_is_byte_identical_with_and_without_days_out_and_no_file_appears_without_it(
    tmp_path: Path,
) -> None:
    """MT5D-03: the report stays counts-only and passes _scrub, so the flag may not change one byte
    of it; and without the flag nothing but --out is written, so a day set never lands by accident."""
    keys = {"k-summer": _summer_close_key(), "k-winter": _winter_key()}
    with_flag, _ = _replay(tmp_path, keys, days_out=True, tag="with")
    before = {p.name for p in tmp_path.iterdir()}
    without_flag, none = _replay(tmp_path, keys, days_out=False, tag="without")
    assert none is None
    assert with_flag == without_flag
    new_files = {p.name for p in tmp_path.iterdir()} - before
    assert new_files == {"report-without.md"}


def test_days_out_lists_an_unmeasured_key_with_four_empty_lists_and_no_error_text(tmp_path: Path) -> None:
    """MT5D-03: the coordinator indexes the file by ordinal, so a key the tool could not fold is
    present and empty (the report's own row carries the error class), never absent or described."""
    keys = {
        "k1": {"status": "not_captured", "error_class": "Mt5ConnectError"},
        "k2": _summer_close_key(),
    }
    _, days = _replay(tmp_path, keys, days_out=True, tag="unmeasured")
    assert days is not None
    assert days["mt5-key-1"] == {name: [] for name in _DAY_LISTS}
    assert "Mt5ConnectError" not in (tmp_path / "days-unmeasured.json").read_text(encoding="utf-8")
    assert days["mt5-key-2"]["moved_return_days"]
