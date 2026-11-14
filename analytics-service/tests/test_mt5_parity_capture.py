"""The synthetic account is ONE account, and the seal refuses what does not add up.

Three artefacts describe the same invented account: the hand-written ledger
(``ledger_synthetic.json``, the deals a terminal Report would list), the sealed
capture bundle (what our stored rows look like) and ``capture-contract.json`` (the
per-file output shape the capture SQL, its exec test and the TS harness all build
to). Nothing here generates one from another: the integrity tests fold the ledger
through the OWNER of the MT5 arithmetic (``services.broker_dailies.mt5_day_pnl``) and
compare, so a fixture that drifts from the arithmetic, from the schema or from the
contract goes RED.

The ledger is designed backward from the three PARITY-02 mutations (a reclassified
BALANCE deal, a one-hour clock shift, the oldest deal dropped). Tests 3 and 4 pin the
design that makes the clock-shift proof able to bite.
"""
from __future__ import annotations

import calendar
import hashlib
import json
import math
import re
from datetime import datetime
from pathlib import Path
from typing import Any

import pytest

from services.broker_dailies import mt5_day_pnl
from services.mt5_deals import deal_utc_day
from services.mt5_parity_capture import (
    CAPTURE_FILES,
    WITNESS_COLUMNS,
    Capture,
    CaptureRefused,
    account_rows,
    load_bundle,
    load_capture,
    our_key_inputs,
    seal_bytes,
    seal_capture,
)
from services.mt5_server_clock import server_clock_for_rule

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "mt5_parity"
REPO = Path(__file__).resolve().parents[2]
CONTRACT = REPO / "docs" / "runbooks" / "mt5-parity" / "capture-contract.json"
BASELINE = REPO / "supabase" / "schema" / "baseline.sql"
BUNDLE = FIXTURES / "capture_synthetic.json"
LEDGER = FIXTURES / "ledger_synthetic.json"


def _ledger() -> dict[str, Any]:
    data: dict[str, Any] = json.loads(LEDGER.read_text(encoding="utf-8"))
    return data


def _bundle() -> dict[str, Any]:
    data: dict[str, Any] = json.loads(BUNDLE.read_text(encoding="utf-8"))
    return data


def _sealed(tmp_path: Path) -> tuple[Path, Capture]:
    run_dir = load_bundle(BUNDLE, tmp_path / "run")
    seal_capture(run_dir)
    return run_dir, load_capture(run_dir)


def _fold_inputs(shift_s: int = 0) -> list[dict[str, Any]]:
    """The ledger deals as the dicts ``mt5_day_pnl`` takes: ``time`` is the broker
    wall clock encoded as if it were UTC."""
    deals = []
    for d in _ledger()["deals"]:
        wall = datetime.strptime(d["wall_time"], "%Y.%m.%d %H:%M:%S")
        deals.append(
            {
                "type": d["type"],
                "time": calendar.timegm(wall.timetuple()) + shift_s,
                "entry": d["entry"],
                "profit": d["profit"],
                "swap": d["swap"],
                "commission": d["commission"],
                "fee": d["fee"],
            }
        )
    return deals


def _day_pnl(rule: str, shift_s: int = 0) -> dict[str, float]:
    series = mt5_day_pnl(
        _fold_inputs(shift_s), server_utc_offset_s=server_clock_for_rule(rule)
    )
    return {ts.date().isoformat(): float(v) for ts, v in series.items()}


def _ddl_columns(table: str) -> list[str]:
    text = BASELINE.read_text(encoding="utf-8")
    block = re.search(
        rf'CREATE TABLE IF NOT EXISTS "public"\."{table}" \((.*?)\n\);', text, re.S
    )
    assert block is not None, f"{table} not found in the baseline schema"
    return re.findall(r'^\s+"([a-z_0-9]+)" ', block.group(1), re.M)


# ------------------------------------------------------------------- contract and DDL


def test_capture_files_equal_the_contract_file() -> None:
    contract = json.loads(CONTRACT.read_text(encoding="utf-8"))
    assert contract["contract_version"] == 1
    assert tuple(contract["witness_columns"]) == WITNESS_COLUMNS
    assert set(contract["files"]) == set(CAPTURE_FILES)
    for name, spec in CAPTURE_FILES.items():
        listed = contract["files"][name]
        assert listed == {
            "slice": spec.slice,
            "table": spec.table,
            "day_column": spec.day_column,
            "row_shape": spec.row_shape,
            "columns": list(spec.columns),
            "extra_witness": list(spec.extra_witness),
        }, name


def test_whole_row_slices_carry_exactly_their_tables_columns() -> None:
    checked = 0
    raw = _bundle()["raw"]
    for name, spec in CAPTURE_FILES.items():
        table_columns = _ddl_columns(spec.table)
        if spec.row_shape == "columns":
            # holdings omits only raw_payload; the contract says so on purpose.
            if spec.table == "allocator_holdings":
                assert sorted(c for c in table_columns if c != "raw_payload") == sorted(
                    spec.columns
                )
            continue
        for witness in raw[name.replace(".sql", ".json")]:
            for row in witness["slice_rows"]:
                assert sorted(row) == sorted(table_columns), (name, witness["key_ordinal"])
                checked += 1
    assert checked >= 6, "the check would be vacuous on an empty fixture"


# ---------------------------------------------------- ledger, clock and arithmetic


def test_ledger_folds_to_its_literals_and_to_the_captures_pre_mark_pnl(
    tmp_path: Path,
) -> None:
    ledger = _ledger()
    folded = _day_pnl("us")
    assert folded == pytest.approx(ledger["utc_day_pnl"], abs=1e-9)
    assert set(folded) == set(ledger["utc_day_pnl"])

    _, capture = _sealed(tmp_path)
    payload = our_key_inputs(capture, "k1")
    assert payload is not None
    composed = {r["utc_day_iso"]: r["pnl_usd"] for r in payload["composed_day_pnl"]}
    pre_mark = [d for d in folded if d < ledger["first_mark_day"]]
    assert pre_mark, "no pre-mark day: the comparison would be vacuous"
    for day in pre_mark:
        assert composed.get(day, 0.0) == pytest.approx(folded.get(day, 0.0), abs=1e-9), day
    assert {d for d in composed if d < ledger["first_mark_day"]} <= set(pre_mark)


def test_a_one_hour_shift_moves_exactly_the_midnight_straddling_deal() -> None:
    ledger = _ledger()
    amount = next(d["profit"] for d in ledger["deals"] if d["deal"] == 1007)
    base = _day_pnl("us")
    for alternative in (_day_pnl("eu"), _day_pnl("us", shift_s=3600)):
        moved = {
            day: alternative.get(day, 0.0) - base.get(day, 0.0)
            for day in set(base) | set(alternative)
            if abs(alternative.get(day, 0.0) - base.get(day, 0.0)) > 1e-9
        }
        assert moved == pytest.approx({"2026-10-26": -amount, "2026-10-27": amount})


def test_ledger_balance_column_is_its_own_cross_check() -> None:
    ledger = _ledger()
    balance = 0.0
    balances_by_day: dict[str, float] = {}
    clock = server_clock_for_rule(ledger["base_clock_rule"])
    for d in ledger["deals"]:
        wall = datetime.strptime(d["wall_time"], "%Y.%m.%d %H:%M:%S")
        cash = d["profit"] + d["swap"] + d["commission"] + d["fee"]
        balance += cash
        assert balance == pytest.approx(d["balance"], abs=1e-9), d["deal"]
        balances_by_day[deal_utc_day(calendar.timegm(wall.timetuple()), clock)] = balance
    # Before the first mark our NAV is the realized balance at the end of that UTC day.
    for day, nav in ledger["nav_close"].items():
        if day < ledger["first_mark_day"]:
            assert nav == pytest.approx(balances_by_day[day], abs=1e-9), day


def test_stored_daily_returns_are_the_twr_of_the_ledger_nav_table(tmp_path: Path) -> None:
    ledger = _ledger()
    _, capture = _sealed(tmp_path)
    (analytics,) = account_rows(capture, "k1", "analytics")
    stored = {r["date"]: r["value"] for r in analytics["daily_returns"]}
    days = sorted(ledger["nav_close"])
    flows = ledger["utc_day_flows"]
    assert sorted(stored) == days[1:]
    for previous, day in zip(days, days[1:], strict=False):
        expected = (ledger["nav_close"][day] - flows.get(day, 0.0)) / ledger["nav_close"][
            previous
        ] - 1.0
        assert stored[day] == pytest.approx(expected, abs=1e-12), day
    csv = {r["date"]: r["daily_return"] for r in account_rows(capture, "k1", "returns")}
    assert csv == stored
    # The stored curve is the geometric chain of those returns, and the stored scalars
    # are read off it.
    level = 1.0
    peak = 1.0
    worst = 0.0
    curve = {r["date"]: r["value"] for r in analytics["returns_series"]}
    assert curve[days[0]] == 1.0
    for day in days[1:]:
        level *= 1.0 + stored[day]
        assert curve[day] == pytest.approx(level, abs=1e-9), day
        peak = max(peak, level)
        worst = min(worst, level / peak - 1.0)
    assert analytics["cumulative_return"] == pytest.approx(level - 1.0, abs=1e-9)
    assert analytics["max_drawdown"] == pytest.approx(worst, abs=1e-9)


def test_inception_identity_is_zero_on_our_rows_and_on_the_ledger(tmp_path: Path) -> None:
    _, capture = _sealed(tmp_path)
    payload = our_key_inputs(capture, "k1")
    assert payload is not None
    ours = (
        payload["realized_terminal_usd"]
        - sum(r["pnl_usd"] for r in payload["composed_day_pnl"])
        - sum(r["flow_usd"] for r in payload["composed_flows"])
    )
    assert math.isclose(ours, 0.0, abs_tol=1e-9)

    ledger = _ledger()
    deals = ledger["deals"]
    cash = sum(
        d["profit"] + d["swap"] + d["commission"] + d["fee"]
        for d in deals
        if d["type"] != 2
    )
    flows = sum(ledger["utc_day_flows"].values())
    assert math.isclose(deals[-1]["balance"] - cash - flows, 0.0, abs_tol=1e-9)
    # Dropping the oldest deal (the first deposit) moves ONLY this identity.
    assert not math.isclose(
        deals[-1]["balance"] - cash - (flows - deals[0]["profit"]), 0.0, abs_tol=1e-9
    )


# --------------------------------------------------------------------- seal refusals


def _raw(run_dir: Path, name: str) -> Path:
    return run_dir / "raw" / name


def _edit_raw(run_dir: Path, name: str, mutate: Any) -> None:
    path = _raw(run_dir, name)
    data = json.loads(path.read_text(encoding="utf-8"))
    mutate(data)
    path.write_text(json.dumps(data), encoding="utf-8")


def test_seal_refuses_a_moved_bind_witness(tmp_path: Path) -> None:
    run_dir = load_bundle(BUNDLE, tmp_path / "run")

    def move(data: list[dict[str, Any]]) -> None:
        data[0]["marks_count"] += 1

    _edit_raw(run_dir, "bind-after.json", move)
    with pytest.raises(CaptureRefused, match="bind"):
        seal_capture(run_dir)


def test_seal_refuses_a_row_count_that_disagrees_with_the_rows(tmp_path: Path) -> None:
    run_dir = load_bundle(BUNDLE, tmp_path / "run")

    def bump(data: list[dict[str, Any]]) -> None:
        data[0]["row_count"] += 1

    _edit_raw(run_dir, "capture-marks.json", bump)
    with pytest.raises(CaptureRefused, match="row_count"):
        seal_capture(run_dir)


def test_seal_refuses_a_last_day_that_is_not_the_max_of_the_day_column(
    tmp_path: Path,
) -> None:
    run_dir = load_bundle(BUNDLE, tmp_path / "run")

    def move(data: list[dict[str, Any]]) -> None:
        data[0]["last_day"] = "2026-11-12"

    _edit_raw(run_dir, "capture-marks.json", move)
    with pytest.raises(CaptureRefused, match="first_day/last_day"):
        seal_capture(run_dir)


def test_seal_refuses_a_length_witness_that_disagrees_with_the_stored_array(
    tmp_path: Path,
) -> None:
    run_dir = load_bundle(BUNDLE, tmp_path / "run")

    def move(data: list[dict[str, Any]]) -> None:
        data[0]["daily_returns_len"] = [9]

    _edit_raw(run_dir, "capture-analytics.json", move)
    with pytest.raises(CaptureRefused, match="daily_returns_len"):
        seal_capture(run_dir)


@pytest.mark.parametrize("file_name", sorted(CAPTURE_FILES))
def test_seal_refuses_a_required_slice_file_that_was_never_written(
    tmp_path: Path, file_name: str
) -> None:
    """A deleted capture file used to be skipped, so a bundle with no analytics and no
    holdings sealed. The slice list is the contract's, never the files that happen to
    be present."""
    run_dir = load_bundle(BUNDLE, tmp_path / "run")
    _raw(run_dir, file_name.replace(".sql", ".json")).unlink()
    with pytest.raises(CaptureRefused, match="is absent"):
        seal_capture(run_dir)


@pytest.mark.parametrize("stem", ["capture-marks", "capture-btc"])
def test_seal_refuses_a_slice_with_a_bound_ordinal_missing(
    tmp_path: Path, stem: str
) -> None:
    """Truncation at whole ordinals (every witness row stripped, or the last one cut)
    keeps each remaining row_count honest, so only the bound ordinal set can see it.
    capture-btc has no bind column: the ordinal set is its only witness."""
    run_dir = load_bundle(BUNDLE, tmp_path / "run")
    _edit_raw(run_dir, f"{stem}.json", lambda data: data.pop())
    with pytest.raises(CaptureRefused, match="bound ordinals"):
        seal_capture(run_dir)

    run_dir = load_bundle(BUNDLE, tmp_path / "stripped")
    _edit_raw(run_dir, f"{stem}.json", lambda data: data.clear())
    with pytest.raises(CaptureRefused, match="bound ordinals"):
        seal_capture(run_dir)


def test_seal_refuses_a_slice_whose_row_count_disagrees_with_the_bind_witness(
    tmp_path: Path,
) -> None:
    """The oldest mark dropped with its own row_count and last_day left consistent:
    the per-file checks pass, so only bind-before's marks_count can refuse it."""
    run_dir = load_bundle(BUNDLE, tmp_path / "run")

    def drop_oldest(data: list[dict[str, Any]]) -> None:
        k1 = next(r for r in data if r["key_ordinal"] == "k1")
        k1["slice_rows"] = k1["slice_rows"][1:]
        k1["row_count"] = len(k1["slice_rows"])
        k1["first_day"] = min(r["mark_day"] for r in k1["slice_rows"])

    _edit_raw(run_dir, "capture-marks.json", drop_oldest)
    with pytest.raises(CaptureRefused, match="bind witness marks_count"):
        seal_capture(run_dir)


def test_seal_refuses_a_slice_whose_newest_timestamp_disagrees_with_the_bind_witness(
    tmp_path: Path,
) -> None:
    """Holdings has no bind row count, so a newest-timestamp witness is all it has."""
    run_dir = load_bundle(BUNDLE, tmp_path / "run")

    def older(data: list[dict[str, Any]]) -> None:
        k1 = next(r for r in data if r["key_ordinal"] == "k1")
        k1["slice_rows"][0]["updated_at"] = "2026-11-13T03:00:00Z"

    _edit_raw(run_dir, "capture-holdings.json", older)
    with pytest.raises(CaptureRefused, match="bind witness holdings_max_updated_at"):
        seal_capture(run_dir)


def test_seal_accepts_the_bind_witness_in_the_mcp_timestamp_spelling(
    tmp_path: Path,
) -> None:
    """The bind query returns timestamptz as the driver spells it; the slice rows come
    from to_jsonb. Equal instants must compare equal whatever the spelling."""
    run_dir = load_bundle(BUNDLE, tmp_path / "run")

    def respell(data: list[dict[str, Any]]) -> None:
        data[0]["marks_max_created_at"] = "2026-11-14 00:10:00+00"

    for name in ("bind-before.json", "bind-after.json"):
        _edit_raw(run_dir, name, respell)
    seal_capture(run_dir)


def test_seal_refuses_a_nan_a_symlink_and_an_unlabelled_ordinal(tmp_path: Path) -> None:
    run_dir = load_bundle(BUNDLE, tmp_path / "nan")
    path = _raw(run_dir, "capture-marks.json")
    path.write_text(path.read_text(encoding="utf-8").replace("11900.0", "NaN"), encoding="utf-8")
    with pytest.raises(CaptureRefused, match="capture-marks"):
        seal_capture(run_dir)

    run_dir = load_bundle(BUNDLE, tmp_path / "link")
    target = tmp_path / "elsewhere.json"
    target.write_text("[]", encoding="utf-8")
    link = _raw(run_dir, "census-accounts.json")
    link.symlink_to(target)
    with pytest.raises(CaptureRefused, match="symlink"):
        seal_capture(run_dir)

    run_dir = load_bundle(BUNDLE, tmp_path / "unlabelled")
    (run_dir / "labels.json").write_text(json.dumps({"k1": "SYN-A"}), encoding="utf-8")
    with pytest.raises(CaptureRefused, match="k2"):
        seal_capture(run_dir)


def test_a_per_ordinal_fallback_replaces_that_ordinals_row(tmp_path: Path) -> None:
    run_dir = load_bundle(BUNDLE, tmp_path / "run")
    path = _raw(run_dir, "capture-marks.json")
    marks = json.loads(path.read_text(encoding="utf-8"))
    k1 = next(r for r in marks if r["key_ordinal"] == "k1")
    full = json.loads(json.dumps(k1))
    # The main file carries a truncated k1 row (self-consistent, so only the bind
    # witness can tell); the per-ordinal fallback carries the whole one.
    k1["slice_rows"] = k1["slice_rows"][:2]
    k1["row_count"] = 2
    k1["last_day"] = "2026-11-06"
    path.write_text(json.dumps(marks), encoding="utf-8")
    with pytest.raises(CaptureRefused, match="bind witness marks_count"):
        seal_capture(run_dir)
    _raw(run_dir, "capture-marks.k1.json").write_text(json.dumps([full]), encoding="utf-8")
    seal_capture(run_dir)
    capture = load_capture(run_dir)
    assert len(account_rows(capture, "k1", "marks")) == 3


def test_excluded_ordinals_are_dropped_on_load(tmp_path: Path) -> None:
    _, capture = _sealed(tmp_path)
    assert dict(capture.labels) == {"k1": "SYN-A"}
    for rows in capture.slices.values():
        assert {r["key_ordinal"] for r in rows} <= {"k1"}
    assert capture.computed_at["k1"] == "2026-11-14T03:00:00Z"


def test_a_tampered_sealed_slice_is_refused_and_a_byte_restore_loads_again(
    tmp_path: Path,
) -> None:
    run_dir, _ = _sealed(tmp_path)
    target = run_dir / "sealed" / "marks.json"
    backup = target.read_bytes()  # byte backup, never git
    backup_sha = hashlib.sha256(backup).hexdigest()

    flipped = bytearray(backup)
    flipped[len(flipped) // 2] ^= 0x01
    target.write_bytes(bytes(flipped))
    assert hashlib.sha256(target.read_bytes()).hexdigest() != backup_sha  # vacuity guard
    with pytest.raises(CaptureRefused, match="marks"):
        load_capture(run_dir)

    target.write_bytes(backup)
    assert hashlib.sha256(target.read_bytes()).hexdigest() == backup_sha
    assert "k1" in load_capture(run_dir).labels


def _rewrite_manifest(run_dir: Path, mutate: Any) -> None:
    """Edit the sealed manifest and re-write its sidecar, so only the manifest CONTENT
    (not a hash mismatch) is what the loader has to refuse."""
    path = run_dir / "sealed" / "manifest.json"
    manifest = json.loads(path.read_text(encoding="utf-8"))
    mutate(manifest)
    raw = json.dumps(manifest, sort_keys=True).encode("utf-8")
    path.write_bytes(raw)
    (run_dir / "sealed" / "manifest.json.sha256").write_text(
        hashlib.sha256(raw).hexdigest(), encoding="ascii"
    )


def test_a_sealed_bundle_says_it_is_synthetic_and_a_real_run_dir_says_it_is_not(
    tmp_path: Path,
) -> None:
    # Why: provenance must be a property of the sealed capture, not of the CLI flag it
    # arrived through, or a synthetic capture passed as --capture-dir is judged as real.
    run_dir, capture = _sealed(tmp_path)
    assert capture.synthetic is True
    assert json.loads((run_dir / "sealed" / "manifest.json").read_text())["synthetic"] is True
    (run_dir / "provenance.json").unlink()  # a real run dir carries no marker
    seal_capture(run_dir)
    assert load_capture(run_dir).synthetic is False


@pytest.mark.parametrize(
    "marker", ['{"synthetic": "true"}', "[true]", '{"synthetic": 1}', "{}", '{"synthetic": true, "x": 1}']
)
def test_seal_refuses_a_provenance_marker_that_is_not_exactly_a_boolean_synthetic(
    tmp_path: Path, marker: str
) -> None:
    """A marker that is present but malformed used to seal as REAL (fail-open): a synthetic
    capture could then be judged as a real run."""
    run_dir = load_bundle(BUNDLE, tmp_path / "run")
    (run_dir / "provenance.json").write_text(marker, encoding="utf-8")
    with pytest.raises(CaptureRefused, match="provenance.json"):
        seal_capture(run_dir)


def test_load_refuses_a_pre_fix_manifest_and_one_without_a_synthetic_flag(
    tmp_path: Path,
) -> None:
    run_dir, _ = _sealed(tmp_path)
    _rewrite_manifest(run_dir, lambda m: m.update(manifest_version=1))
    with pytest.raises(CaptureRefused, match="seal the run directory again"):
        load_capture(run_dir)
    _rewrite_manifest(run_dir, lambda m: m.update(manifest_version=2))
    assert "k1" in load_capture(run_dir).labels
    _rewrite_manifest(run_dir, lambda m: m.pop("synthetic"))
    with pytest.raises(CaptureRefused, match="synthetic"):
        load_capture(run_dir)


def test_load_refuses_a_manifest_that_lists_fewer_slices_than_the_contract(
    tmp_path: Path,
) -> None:
    # Why: a truncated manifest otherwise loads as a shorter record and a surface that
    # lost its holdings reads as "not in the book" instead of as a defect.
    run_dir, _ = _sealed(tmp_path)
    _rewrite_manifest(run_dir, lambda m: m["files"].pop("holdings"))
    with pytest.raises(CaptureRefused, match="does not list slice holdings"):
        load_capture(run_dir)


def test_seal_bytes_is_canonical_and_refuses_non_finite_numbers() -> None:
    raw, digest = seal_bytes({"b": 1, "a": [1.5, None]})
    assert raw == b'{"a":[1.5,null],"b":1}'
    assert digest == hashlib.sha256(raw).hexdigest()
    for bad in (float("nan"), float("inf"), float("-inf")):
        with pytest.raises(ValueError):
            seal_bytes({"x": bad})


# ---------------------------------------------------------------- per-ordinal wrapper


def test_render_per_ordinal_wraps_the_statement_byte_for_byte() -> None:
    from services.mt5_parity_capture import render_per_ordinal

    statement = "WITH q AS (SELECT 1 AS key_ordinal) SELECT key_ordinal FROM q;"
    wrapped = render_per_ordinal(statement, "k1")
    assert wrapped.startswith("SELECT")
    assert statement[:-1] in wrapped
    assert wrapped.endswith(";") and not wrapped.endswith(";;")
    assert wrapped.count(";") == 1
    assert "'k1'" in wrapped
    with pytest.raises(ValueError):
        render_per_ordinal(statement, "k1'; DROP TABLE x; --")
    with pytest.raises(ValueError):
        render_per_ordinal(statement, "K1")
    with pytest.raises(ValueError):
        render_per_ordinal(statement[:-1], "k1")
