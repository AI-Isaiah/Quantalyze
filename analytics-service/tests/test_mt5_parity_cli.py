"""PARITY-01 / PARITY-02: the rehearsal can never read as a pass, and the CLI is mechanical.

Why these tests exist: a dress rehearsal runs the whole pipeline on a SYNTHETIC oracle.
It proves the pipeline runs and nothing about parity, so a verdict built on one must
be flagged, must say so in its first rendered line, and must never be ``final_green``
whatever its legs say. A real worksheet must not be bound to another account's
label (that is how a rehearsal would borrow a real pass), and the CLI must refuse bad
inputs with exit 2, report a RED verdict with exit 0, and fail a RED proof that missed
its expectation with exit 3. Everything runs in-process on ``tmp_path`` copies.
"""
from __future__ import annotations

import dataclasses
import hashlib
import json
from collections.abc import Iterator
from datetime import date
from pathlib import Path
from typing import Any, Literal

import pytest

import services.mt5_parity_proofs as proofs
from scripts.mt5_parity_run import main
from services.mt5_parity import (
    REHEARSAL_HEADER,
    UNEXPLAINED,
    WITHIN_TOLERANCE,
    AccountVerdict,
    LegResult,
    OracleBindingRefused,
    Verdict,
    Window,
    evaluate_windows,
    render_verdict_markdown,
    verdict_to_json,
)
from services.mt5_parity_capture import load_bundle, load_capture, seal_capture
from services.mt5_parity_intake import load_worksheet
from services.mt5_parity_report import parse_report
from services.mt5_server_clock import server_clock_for_rule

SERVICE_ROOT = Path(__file__).resolve().parents[1]
FIXTURES = SERVICE_ROOT / "tests" / "fixtures" / "mt5_parity"
BUNDLE = FIXTURES / "capture_synthetic.json"
WORKSHEET = FIXTURES / "worksheet_synthetic.json"
REPORT = FIXTURES / "report_synthetic.utf16le.html"
RUN_DAY = "2026-11-16"
US = server_clock_for_rule("us")


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


@pytest.fixture(scope="module", autouse=True)
def committed_fixtures_are_untouched() -> Iterator[None]:
    before = {p.name: _sha(p) for p in sorted(FIXTURES.iterdir()) if p.is_file()}
    assert before
    yield
    assert {p.name: _sha(p) for p in sorted(FIXTURES.iterdir()) if p.is_file()} == before


def _passed_account(
    label: str = "SYN-A", passed: bool = True, gate: Literal["A", "B"] = "B"
) -> AccountVerdict:
    leg = LegResult(leg="start_level", gap=0.0, passed=True, reason=None)
    return AccountVerdict(
        label=label,
        gate=gate,
        window_days=7,
        legs=(leg,),
        bucket=WITHIN_TOLERANCE if passed else UNEXPLAINED,
        matched=(),
        reason=None if passed else "start_level",
        passed=passed,
    )


def _worksheet_copy(tmp_path: Path, mutate: Any, name: str = "worksheet.json") -> Path:
    data = json.loads(WORKSHEET.read_text(encoding="utf-8"))
    mutate(data)
    out = tmp_path / name
    out.write_text(json.dumps(data), encoding="utf-8")
    return out


def _bundle_copy(tmp_path: Path, mutate: Any, name: str = "bundle.json") -> Path:
    data = json.loads(BUNDLE.read_text(encoding="utf-8"))
    mutate(data)
    out = tmp_path / name
    out.write_text(json.dumps(data), encoding="utf-8")
    return out


def _verdict_args(
    tmp_path: Path,
    *,
    bundle: Path = BUNDLE,
    worksheet: Path = WORKSHEET,
    report: Path = REPORT,
    account: str = "SYN-A",
    run_day: str = RUN_DAY,
    extra: tuple[str, ...] = (),
) -> list[str]:
    return [
        "verdict",
        "--capture-bundle",
        str(bundle),
        "--worksheet",
        str(worksheet),
        "--report",
        str(report),
        "--account",
        account,
        "--run-day",
        run_day,
        "--out-json",
        str(tmp_path / "verdict.json"),
        "--out-md",
        str(tmp_path / "verdict.md"),
        *extra,
    ]


def _red_args(
    tmp_path: Path,
    *,
    mutation: str = "all",
    capture: tuple[str, str] = ("--capture-bundle", str(BUNDLE)),
    extra: tuple[str, ...] = (),
) -> list[str]:
    return [
        "red-proof",
        *capture,
        "--worksheet",
        str(WORKSHEET),
        "--report",
        str(REPORT),
        "--account",
        "SYN-A",
        "--run-day",
        RUN_DAY,
        "--mutation",
        mutation,
        "--out-md",
        str(tmp_path / "red.md"),
        *extra,
    ]


# ------------------------------------------------------------- the rehearsal flag


def test_final_green_is_false_for_a_rehearsal_whatever_the_legs_say() -> None:
    accounts = (_passed_account(gate="A"), _passed_account(gate="B"))
    assert Verdict(accounts, rehearsal=True, run_day=date(2026, 11, 16)).final_green is False
    assert Verdict(accounts, rehearsal=False, run_day=date(2026, 11, 16)).final_green is True


def test_final_green_needs_every_account_to_pass_and_at_least_one_account() -> None:
    day = date(2026, 11, 16)
    mixed = (
        _passed_account("MM2", gate="A"),
        _passed_account("MM2", gate="B"),
        _passed_account("MM3", gate="A"),
        _passed_account("MM3", passed=False, gate="B"),
    )
    assert Verdict(mixed, rehearsal=False, run_day=day).final_green is False
    # A verdict that judged nothing is not a pass: all() of nothing is True.
    assert Verdict((), rehearsal=False, run_day=day).final_green is False


def test_final_green_needs_both_gates_judged_for_every_account() -> None:
    # Why: a gate the picker could not build used to simply not exist in the verdict,
    # and the verdict read green on the other gate alone. An absent gate is a gate never
    # judged, so it can never be a parity pass.
    day = date(2026, 11, 16)
    only_a = (_passed_account(gate="A"),)
    only_b = (_passed_account(gate="B"),)
    assert Verdict(only_a, rehearsal=False, run_day=day).final_green is False
    assert Verdict(only_b, rehearsal=False, run_day=day).final_green is False
    # One account complete does not cover another that is missing a gate.
    lopsided = (
        _passed_account("MM2", gate="A"),
        _passed_account("MM2", gate="B"),
        _passed_account("MM3", gate="A"),
    )
    assert Verdict(lopsided, rehearsal=False, run_day=day).final_green is False


def test_a_rehearsal_verdict_renders_the_dress_rehearsal_line_first() -> None:
    rehearsal = render_verdict_markdown(
        Verdict((_passed_account(),), rehearsal=True, run_day=date(2026, 11, 16))
    )
    assert rehearsal.startswith(REHEARSAL_HEADER + "\n")
    assert REHEARSAL_HEADER == (
        "DRESS REHEARSAL: synthetic oracle. Proves the pipeline runs; proves nothing about parity."
    )
    real = render_verdict_markdown(
        Verdict((_passed_account(),), rehearsal=False, run_day=date(2026, 11, 16))
    )
    assert "DRESS REHEARSAL" not in real and real.startswith("# MT5 parity verdict")


def test_the_verdict_json_records_final_green_and_the_oracle_label() -> None:
    as_json = verdict_to_json(
        Verdict((_passed_account(),), rehearsal=True, run_day=date(2026, 11, 16))
    )
    assert as_json["final_green"] is False
    assert as_json["accounts"][0]["oracle_label"] is None


def test_an_oracle_label_must_be_a_plain_label() -> None:
    with pytest.raises(ValueError):
        AccountVerdict(
            label="SYN-A",
            gate="B",
            window_days=7,
            legs=(),
            bucket=UNEXPLAINED,
            matched=(),
            reason="x",
            passed=False,
            oracle_label="login12345",
        )


def _service_inputs(tmp_path: Path, *, label: str = "SYN-A") -> Any:
    tmp_path.mkdir(exist_ok=True)
    bundle = _bundle_copy(
        tmp_path, lambda d: d.update(labels={"k1": label, "k2": "excluded"})
    )
    run_dir = load_bundle(bundle, tmp_path / "run")
    seal_capture(run_dir)
    deals = parse_report(REPORT.read_bytes()).deals
    return load_capture(run_dir), deals


def test_evaluate_windows_refuses_a_cross_label_binding_on_a_real_worksheet(
    tmp_path: Path,
) -> None:
    capture, deals = _service_inputs(tmp_path, label="OTHER")
    real = load_worksheet(
        _worksheet_copy(tmp_path, lambda d: d.update(synthetic=False), "real.json")
    )
    gate_b = Window("B", date(2026, 11, 6), date(2026, 11, 13))
    kwargs: dict[str, Any] = {"oracle_deals": deals, "clock": US, "run_day": date(2026, 11, 16)}
    with pytest.raises(OracleBindingRefused):
        evaluate_windows(capture, "k1", real, (gate_b,), oracle_label="SYN-A", **kwargs)
    # The same label is fine on a real worksheet (a real run binds each account to itself).
    capture_same, _ = _service_inputs(tmp_path / "same")
    verdict = evaluate_windows(capture_same, "k1", real, (gate_b,), **kwargs)
    assert verdict.rehearsal is False and verdict.accounts[0].oracle_label == "SYN-A"
    # ... but a capture that came from a synthetic bundle makes the verdict a rehearsal
    # whatever the worksheet says: it can never be a parity pass.
    from_bundle = evaluate_windows(
        capture_same, "k1", real, (gate_b,), capture_synthetic=True, **kwargs
    )
    assert from_bundle.rehearsal is True and from_bundle.final_green is False
    # A synthetic worksheet may be rebound, and the binding is recorded.
    synthetic = load_worksheet(WORKSHEET)
    rebound = evaluate_windows(capture, "k1", synthetic, (gate_b,), oracle_label="SYN-A", **kwargs)
    assert rebound.accounts[0].label == "OTHER"
    assert rebound.accounts[0].oracle_label == "SYN-A"
    assert rebound.rehearsal is True and rebound.final_green is False
    with pytest.raises(OracleBindingRefused):
        evaluate_windows(capture, "k1", synthetic, (gate_b,), oracle_label="NOBODY", **kwargs)


def test_a_demo_account_is_red_on_every_window_and_never_final_green(tmp_path: Path) -> None:
    # Why: MT5-08 says a demo account does not count as the run. trade_mode was read
    # at intake and then ignored, so a demo worksheet could reach final_green.
    capture, deals = _service_inputs(tmp_path)

    def sheet(mode: str) -> Any:
        def mutate(data: dict[str, Any]) -> None:
            data["synthetic"] = False
            for r in data["accounts"]["SYN-A"]["readings"]:
                if r["id"] == "trade_mode":
                    r["value"] = mode

        return load_worksheet(_worksheet_copy(tmp_path, mutate, f"{mode}.json"))

    windows = (
        Window("A", date(2026, 10, 5), date(2026, 10, 30)),
        Window("B", date(2026, 11, 6), date(2026, 11, 13)),
    )
    kwargs: dict[str, Any] = {"oracle_deals": deals, "clock": US, "run_day": date(2026, 11, 16)}
    real = evaluate_windows(capture, "k1", sheet("real"), windows, **kwargs)
    assert real.final_green is True  # the counterfactual: only trade_mode differs
    demo = evaluate_windows(capture, "k1", sheet("demo"), windows, **kwargs)
    assert demo.final_green is False
    assert [a.passed for a in demo.accounts] == [False, False]
    assert {a.reason for a in demo.accounts} == {"trade_mode_not_real"}


# ------------------------------------------------------------------ CLI: verdict


def test_cli_verdict_on_the_synthetic_pair_is_a_flagged_rehearsal(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(_verdict_args(tmp_path)) == 0
    markdown = (tmp_path / "verdict.md").read_text(encoding="utf-8")
    assert markdown.startswith(REHEARSAL_HEADER)
    assert "DRESS REHEARSAL" in markdown
    assert "## SYN-A (gate A)" in markdown and "## SYN-A (gate B)" in markdown
    assert markdown.count(f"- bucket: {WITHIN_TOLERANCE}") == 2
    as_json = json.loads((tmp_path / "verdict.json").read_text(encoding="utf-8"))
    assert as_json["rehearsal"] is True
    assert as_json["final_green"] is False
    assert [a["gate"] for a in as_json["accounts"]] == ["A", "B"]
    assert all(a["passed"] for a in as_json["accounts"])
    assert "final_green=no" in capsys.readouterr().out


def test_cli_verdict_output_is_deterministic(tmp_path: Path) -> None:
    first, second = tmp_path / "a", tmp_path / "b"
    first.mkdir()
    second.mkdir()
    assert main(_verdict_args(first)) == 0
    assert main(_verdict_args(second)) == 0
    assert (first / "verdict.json").read_bytes() == (second / "verdict.json").read_bytes()
    assert (first / "verdict.md").read_bytes() == (second / "verdict.md").read_bytes()


def test_cli_verdict_writes_only_the_paths_it_was_given(tmp_path: Path) -> None:
    out = tmp_path / "out"
    out.mkdir()
    args = _verdict_args(tmp_path)
    args[args.index("--out-json") + 1] = str(out / "v.json")
    args[args.index("--out-md") + 1] = str(out / "v.md")
    before = {p for p in tmp_path.iterdir()}
    assert main(args) == 0
    assert {p.name for p in out.iterdir()} == {"v.json", "v.md"}
    assert {p for p in tmp_path.iterdir()} == before


def test_cli_source_names_no_phase_path() -> None:
    source = (SERVICE_ROOT / "scripts" / "mt5_parity_run.py").read_text(encoding="utf-8")
    assert "phases/155" not in source


def test_cli_verdict_with_explicit_windows_matches_the_proposed_ones(tmp_path: Path) -> None:
    proposed, explicit = tmp_path / "p", tmp_path / "e"
    proposed.mkdir()
    explicit.mkdir()
    assert main(_verdict_args(proposed)) == 0
    flags = (
        "--gate-a-start", "2026-10-05", "--gate-a-end", "2026-10-30",
        "--gate-b-start", "2026-11-06", "--gate-b-end", "2026-11-13",
    )  # fmt: skip
    assert main(_verdict_args(explicit, extra=flags)) == 0
    assert (proposed / "verdict.json").read_bytes() == (explicit / "verdict.json").read_bytes()


def test_cli_verdict_reports_a_refused_window_as_red_with_exit_zero(tmp_path: Path) -> None:
    # A window that is not closed on the run day is refused by name: a RED verdict.
    flags = ("--gate-b-start", "2026-11-06", "--gate-b-end", RUN_DAY)
    assert main(_verdict_args(tmp_path, extra=flags)) == 0
    as_json = json.loads((tmp_path / "verdict.json").read_text(encoding="utf-8"))
    gate_b = next(a for a in as_json["accounts"] if a["gate"] == "B")
    assert gate_b["passed"] is False
    assert gate_b["reason"] == "window_refused:window_not_closed"


def test_cli_verdict_with_no_window_judges_nothing_exits_nonzero_and_is_not_green(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    # Why: a run that judged no window at all must never look like a finished verdict.
    assert main(_verdict_args(tmp_path, run_day="2026-10-01")) == 2
    as_json = json.loads((tmp_path / "verdict.json").read_text(encoding="utf-8"))
    assert [a["gate"] for a in as_json["accounts"]] == ["A", "B"]
    assert all(a["passed"] is False and a["legs"] == [] for a in as_json["accounts"])
    assert all(a["reason"].startswith("window_refused:") for a in as_json["accounts"])
    assert as_json["final_green"] is False
    assert "judged no window" in capsys.readouterr().err


def test_cli_verdict_keeps_an_unbuildable_gate_as_a_red_entry_with_the_real_reason(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    # Why: a gate the picker could not build used to vanish from the verdict, so Gate A
    # alone read as a pass. It must stay in the verdict, RED, naming why.
    def no_start_reading(data: dict[str, Any]) -> None:
        readings = data["accounts"]["SYN-A"]["readings"]
        readings[:] = [
            r
            for r in readings
            if not (r["id"] == "statement_equity" and r["as_of"] == "2026-11-06")
        ]

    sheet = _worksheet_copy(tmp_path, no_start_reading)
    assert main(_verdict_args(tmp_path, worksheet=sheet)) == 0
    as_json = json.loads((tmp_path / "verdict.json").read_text(encoding="utf-8"))
    by_gate = {a["gate"]: a for a in as_json["accounts"]}
    assert by_gate["A"]["passed"] is True
    assert by_gate["B"]["passed"] is False
    assert by_gate["B"]["reason"] == "window_refused:edge_without_reading"
    assert as_json["final_green"] is False
    assert "final_green=no" in capsys.readouterr().out


# ------------------------------------------------------------ CLI: oracle binding


def _relabelled(tmp_path: Path) -> Path:
    return _bundle_copy(tmp_path, lambda d: d.update(labels={"k1": "OTHER", "k2": "excluded"}))


def test_cli_refuses_a_cross_label_binding_on_a_real_worksheet(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    real = _worksheet_copy(tmp_path, lambda d: d.update(synthetic=False))
    args = _verdict_args(
        tmp_path,
        bundle=_relabelled(tmp_path),
        worksheet=real,
        account="OTHER",
        extra=("--oracle-label", "SYN-A"),
    )
    assert main(args) == 2
    assert "OracleBindingRefused" in capsys.readouterr().err
    assert not (tmp_path / "verdict.json").exists()


def test_cli_refuses_a_synthetic_capture_bundle_judged_against_a_real_worksheet(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    # Why: the synthetic bundle is rehearsal data by construction. Paired with a worksheet
    # flagged real it printed `rehearsal=no`, a parity verdict on numbers no account made.
    real = _worksheet_copy(tmp_path, lambda d: d.update(synthetic=False))
    assert main(_verdict_args(tmp_path, worksheet=real)) == 2
    err = capsys.readouterr().err
    assert "UsageRefused" in err and "synthetic capture bundle" in err
    assert not (tmp_path / "verdict.json").exists()
    # Neither red-proof may run on that pairing either.
    red = _red_args(tmp_path)
    red[red.index("--worksheet") + 1] = str(real)
    assert main(red) == 2


def test_cli_refuses_a_sealed_synthetic_capture_dir_judged_against_a_real_worksheet(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    # Why: provenance is a property of the sealed capture. The same synthetic capture,
    # sealed into a run dir and passed as --capture-dir, must be refused against a real
    # worksheet exactly like --capture-bundle (it printed rehearsal=no final_green=yes).
    run_dir = load_bundle(BUNDLE, tmp_path / "run")
    seal_capture(run_dir)
    real = _worksheet_copy(tmp_path, lambda d: d.update(synthetic=False))
    args = _verdict_args(tmp_path, worksheet=real)
    args[args.index("--capture-bundle")] = "--capture-dir"
    args[args.index(str(BUNDLE))] = str(run_dir)
    assert main(args) == 2
    err = capsys.readouterr().err
    assert "UsageRefused" in err and "synthetic capture" in err
    assert not (tmp_path / "verdict.json").exists()


def test_cli_allows_a_cross_label_binding_on_a_synthetic_worksheet_and_records_it(
    tmp_path: Path,
) -> None:
    args = _verdict_args(
        tmp_path,
        bundle=_relabelled(tmp_path),
        account="OTHER",
        extra=("--oracle-label", "SYN-A"),
    )
    assert main(args) == 0
    as_json = json.loads((tmp_path / "verdict.json").read_text(encoding="utf-8"))
    assert {a["label"] for a in as_json["accounts"]} == {"OTHER"}
    assert {a["oracle_label"] for a in as_json["accounts"]} == {"SYN-A"}
    assert as_json["rehearsal"] is True and as_json["final_green"] is False
    assert "- oracle label: SYN-A" in (tmp_path / "verdict.md").read_text(encoding="utf-8")


# ------------------------------------------------------------ CLI: input refusals


def test_cli_refuses_gateway_provenance_with_exit_two(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    def mutate(data: dict[str, Any]) -> None:
        data["accounts"]["SYN-A"]["readings"][0]["provenance"] = "gateway"

    assert main(_verdict_args(tmp_path, worksheet=_worksheet_copy(tmp_path, mutate))) == 2
    err = capsys.readouterr().err
    assert "ProvenanceRefused" in err and "gateway" in err


def test_cli_refuses_a_report_that_is_not_the_bound_file(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    edited = tmp_path / "edited.html"
    edited.write_bytes(REPORT.read_bytes() + b" ")
    assert main(_verdict_args(tmp_path, report=edited)) == 2
    assert "ReportBindingRefused" in capsys.readouterr().err


def test_cli_refuses_a_report_that_does_not_parse(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    garbage = tmp_path / "garbage.html"
    garbage.write_bytes(b"<html><body>not a report</body></html>")
    digest = hashlib.sha256(garbage.read_bytes()).hexdigest()

    def rebind(data: dict[str, Any]) -> None:
        for reading in data["accounts"]["SYN-A"]["readings"]:
            if reading["id"] == "all_history_report_sha256":
                reading["value"] = digest

    sheet = _worksheet_copy(tmp_path, rebind)
    assert main(_verdict_args(tmp_path, worksheet=sheet, report=garbage)) == 2
    assert "EmptyDeals: the Report has no Deals section" in capsys.readouterr().err
    assert not (tmp_path / "verdict.json").exists()


def test_cli_refuses_an_incomplete_worksheet(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    def mutate(data: dict[str, Any]) -> None:
        data["accounts"]["SYN-A"]["readings"] = data["accounts"]["SYN-A"]["readings"][:2]

    assert main(_verdict_args(tmp_path, worksheet=_worksheet_copy(tmp_path, mutate))) == 2
    assert "WorksheetIncomplete" in capsys.readouterr().err


def test_cli_refuses_an_unsealed_capture_directory(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    run_dir = load_bundle(BUNDLE, tmp_path / "unsealed")  # raw files only: never sealed
    args = _verdict_args(tmp_path)
    args[args.index("--capture-bundle")] = "--capture-dir"
    args[args.index(str(BUNDLE))] = str(run_dir)
    assert main(args) == 2
    assert "CaptureRefused" in capsys.readouterr().err


def test_cli_refuses_an_account_the_capture_does_not_hold(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(_verdict_args(tmp_path, account="NOBODY")) == 2
    assert "UsageRefused" in capsys.readouterr().err


def test_cli_refuses_a_half_given_window_and_a_bad_day(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(_verdict_args(tmp_path, extra=("--gate-a-start", "2026-10-05"))) == 2
    assert main(_verdict_args(tmp_path, run_day="16/11/2026")) == 2
    err = capsys.readouterr().err
    assert err.count("UsageRefused") == 2


def test_cli_takes_exactly_one_capture_source(tmp_path: Path) -> None:
    args = _verdict_args(tmp_path, extra=("--capture-dir", str(tmp_path)))
    with pytest.raises(SystemExit) as exited:
        main(args)
    assert exited.value.code == 2


# ----------------------------------------------------------------- CLI: red-proof


def test_cli_red_proof_all_lists_the_three_mutations_and_their_buckets(tmp_path: Path) -> None:
    assert main(_red_args(tmp_path)) == 0
    text = (tmp_path / "red.md").read_text(encoding="utf-8")
    for mutation, (bucket, leg) in proofs.EXPECTED_OUTCOME.items():
        assert f"## {mutation} (SYN-A)" in text
        assert f"expected: bucket {bucket}, leg {leg}" in text
        assert f"mutated bucket: {bucket}" in text
    assert text.count("meets expectation: yes") == 3
    assert text.count("restored verdict byte-identical: yes") == 3


def test_cli_red_proof_runs_a_single_mutation(tmp_path: Path) -> None:
    assert main(_red_args(tmp_path, mutation="clock_shift_1h")) == 0
    text = (tmp_path / "red.md").read_text(encoding="utf-8")
    assert "## clock_shift_1h (SYN-A)" in text and "## drop_oldest_deal" not in text


def test_cli_red_proof_exits_three_when_the_expectation_is_wrong(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setitem(
        proofs.EXPECTED_OUTCOME, "clock_shift_1h", (UNEXPLAINED, "day_placement")
    )
    assert main(_red_args(tmp_path, mutation="clock_shift_1h")) == 3
    assert "clock_shift_1h" in capsys.readouterr().err


def _sealed_as_real(tmp_path: Path) -> Path:
    """The synthetic bundle sealed WITHOUT its provenance marker: what a real run dir
    looks like to the seal, so the red-proof's real-inputs branch (the one that does not
    assert the expected bucket) is the branch under test."""
    run_dir = load_bundle(BUNDLE, tmp_path / "run")
    (run_dir / "provenance.json").unlink()
    seal_capture(run_dir)
    return run_dir


def test_cli_red_proof_on_a_capture_dir_fails_only_on_a_broken_restore(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Rehearsal inputs have a RED baseline by design, so the expectation is not asserted
    # there; only a restore that is not intact fails the run.
    run_dir = _sealed_as_real(tmp_path)
    capture = ("--capture-dir", str(run_dir))
    monkeypatch.setitem(
        proofs.EXPECTED_OUTCOME, "clock_shift_1h", (UNEXPLAINED, "day_placement")
    )
    assert main(_red_args(tmp_path, mutation="clock_shift_1h", capture=capture)) == 0
    monkeypatch.setattr(proofs, "restore_intact", lambda record: False)
    assert main(_red_args(tmp_path, mutation="clock_shift_1h", capture=capture)) == 3


@pytest.mark.parametrize(
    ("field", "value"), [("mutated_passed", True), ("baseline_passed", False)]
)
def test_cli_red_proof_on_a_capture_dir_exits_three_when_the_proof_proved_nothing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, field: str, value: bool
) -> None:
    # Why: a red proof exists to show the oracle can fail. On real inputs a mutation that
    # stayed GREEN (or a baseline that was already RED) proved nothing, and exiting 0 would
    # let the run read as "the oracle can say no" when it just did not.
    run_dir = _sealed_as_real(tmp_path)
    capture = ("--capture-dir", str(run_dir))
    assert main(_red_args(tmp_path, mutation="clock_shift_1h", capture=capture)) == 0
    real_run = proofs.run_red_proof

    def run_and_blind(**kwargs: Any) -> proofs.RedProofRecord:
        return dataclasses.replace(real_run(**kwargs), **{field: value})

    monkeypatch.setattr(proofs, "run_red_proof", run_and_blind)
    assert main(_red_args(tmp_path, mutation="clock_shift_1h", capture=capture)) == 3


def test_cli_red_proof_leaves_the_committed_fixtures_alone(tmp_path: Path) -> None:
    before = {p.name: _sha(p) for p in sorted(FIXTURES.iterdir()) if p.is_file()}
    assert main(_red_args(tmp_path)) == 0
    assert {p.name: _sha(p) for p in sorted(FIXTURES.iterdir()) if p.is_file()} == before
