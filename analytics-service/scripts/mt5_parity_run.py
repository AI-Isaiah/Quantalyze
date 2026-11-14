"""Run the MT5 parity harness by hand: the verdict and the RED proofs (PARITY-01, PARITY-02).

A thin argparse wrapper; every decision lives in ``services.mt5_parity``,
``services.mt5_parity_intake``, ``services.mt5_parity_report`` and
``services.mt5_parity_proofs``. Run from ``analytics-service/``::

    python3 -m scripts.mt5_parity_run verdict (--capture-dir D | --capture-bundle B) \\
        --worksheet W --report R --account LABEL --run-day YYYY-MM-DD \\
        --out-json F --out-md F
    python3 -m scripts.mt5_parity_run red-proof (--capture-dir D | --capture-bundle B) \\
        --worksheet W --report R --account LABEL --run-day YYYY-MM-DD \\
        --mutation (all | reclassify_balance | clock_shift_1h | drop_oldest_deal) --out-md F

``--capture-dir`` is a sealed run directory; ``--capture-bundle`` is a synthetic bundle,
sealed into a temporary directory. The windows are the given ``--gate-a-*`` and
``--gate-b-*`` pairs, or the picker's proposal for a gate left unset. A gate the picker cannot build is
kept in the verdict as a RED ``window_refused`` entry, never dropped. The CLI reads the
files it is given, writes only the ``--out-*`` paths, and derives no path of its own.
It never reaches a database or the MT5 gateway: ``services.mt5_parity*`` cannot.

Exit codes: 0 the command ran (a RED verdict is still exit 0 and is reported in the
output), 2 an input refusal (exception class and message on stderr) or a verdict in
which no window was judged at all, 3 a RED proof
failed: its restore was not byte-identical, its baseline was RED or its mutation
stayed GREEN (any inputs), or, on the synthetic bundle, it also missed its expected
bucket or leg or its GREEN restore.
"""
from __future__ import annotations

import argparse
import sys
import tempfile
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Final, Literal

from services import mt5_parity_proofs as proofs
from services.mt5_parity import (
    OracleBindingRefused,
    Verdict,
    Window,
    evaluate_windows,
    propose_windows,
    render_verdict_markdown,
    verdict_to_json,
)
from services.mt5_parity_capture import (
    Capture,
    CaptureRefused,
    load_bundle,
    load_capture,
    seal_bytes,
    seal_capture,
)
from services.mt5_parity_intake import (
    Worksheet,
    bind_report,
    load_required_readings,
    load_worksheet,
    require_complete,
)
from services.mt5_parity_report import load_oracle_deals, oracle_deals_bytes, parse_report
from services.mt5_server_clock import server_clock_for_rule

EXIT_OK: Final = 0
EXIT_REFUSED: Final = 2
EXIT_PROOF_FAILED: Final = 3

_DEFAULT_REQUIRED = (
    Path(__file__).resolve().parents[2] / "docs" / "runbooks" / "mt5-parity" / "required-readings.json"
)
_REFUSALS = (
    ValueError,
    CaptureRefused,
    OSError,
    KeyError,
    TypeError,
    proofs.MutationVacuous,
)


class UsageRefused(ValueError):
    """An argument combination the harness cannot act on."""


@dataclass(frozen=True, slots=True)
class _Inputs:
    capture: Capture
    ordinal: str
    worksheet: Worksheet
    oracle_label: str
    deals_bytes: bytes
    clock_rule: Literal["us", "eu"]
    run_day: date
    windows: tuple[Window, ...]
    synthetic_pair: bool


def _refuse(error: BaseException) -> int:
    print(f"{type(error).__name__}: {error}", file=sys.stderr)
    return EXIT_REFUSED


def _add_inputs(parser: argparse.ArgumentParser) -> None:
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--capture-dir", help="a sealed run directory")
    source.add_argument("--capture-bundle", help="a synthetic capture bundle")
    parser.add_argument("--worksheet", required=True)
    parser.add_argument("--report", required=True)
    parser.add_argument(
        "--required-readings",
        default=str(_DEFAULT_REQUIRED),
        help="the shared required-readings list (default: the runbook's)",
    )
    parser.add_argument("--account", required=True, help="a capture account label")
    parser.add_argument("--oracle-label", help="the worksheet account to compare against")
    parser.add_argument("--clock-rule", choices=("us", "eu"), default="us")
    parser.add_argument("--run-day", required=True, help="YYYY-MM-DD")
    for gate in ("a", "b"):
        parser.add_argument(f"--gate-{gate}-start", help="YYYY-MM-DD")
        parser.add_argument(f"--gate-{gate}-end", help="YYYY-MM-DD")


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="mt5_parity_run", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    verdict = sub.add_parser("verdict", help="judge one account on its windows")
    _add_inputs(verdict)
    verdict.add_argument("--out-json", required=True)
    verdict.add_argument("--out-md", required=True)
    verdict.set_defaults(func=_cmd_verdict)
    red = sub.add_parser("red-proof", help="break the oracle deliberately and watch it go RED")
    _add_inputs(red)
    red.add_argument("--mutation", choices=(*proofs.MUTATIONS, "all"), required=True)
    red.add_argument("--out-md", required=True)
    red.set_defaults(func=_cmd_red_proof)
    return parser


def _day(text: str, flag: str) -> date:
    try:
        return date.fromisoformat(text)
    except ValueError:
        raise UsageRefused(f"{flag} is not a YYYY-MM-DD day") from None


def _flag_window(args: argparse.Namespace, gate: Literal["A", "B"]) -> Window | None:
    lower = gate.lower()
    start = getattr(args, f"gate_{lower}_start")
    end = getattr(args, f"gate_{lower}_end")
    if (start is None) != (end is None):
        raise UsageRefused(f"--gate-{lower}-start and --gate-{lower}-end go together")
    if start is None:
        return None
    return Window(gate, _day(start, f"--gate-{lower}-start"), _day(end, f"--gate-{lower}-end"))


def _load_capture(args: argparse.Namespace) -> tuple[Capture, bool]:
    if args.capture_dir is not None:
        capture = load_capture(Path(args.capture_dir))
        return capture, capture.synthetic
    with tempfile.TemporaryDirectory(prefix="mt5-parity-bundle-") as tmp:
        run_dir = load_bundle(Path(args.capture_bundle), Path(tmp))
        seal_capture(run_dir)
        capture = load_capture(run_dir)
        return capture, capture.synthetic


def _prepare(args: argparse.Namespace) -> _Inputs:
    run_day = _day(args.run_day, "--run-day")
    fixed = {gate: _flag_window(args, gate) for gate in ("A", "B")}
    capture, synthetic_pair = _load_capture(args)
    worksheet = load_worksheet(Path(args.worksheet))
    require_complete(worksheet, load_required_readings(Path(args.required_readings)))
    ordinals = [o for o, label in capture.labels.items() if label == args.account]
    if len(ordinals) != 1:
        raise UsageRefused("--account is not exactly one retained capture label")
    ordinal = ordinals[0]
    oracle_label: str = args.oracle_label if args.oracle_label is not None else args.account
    if oracle_label != args.account and not worksheet.synthetic:
        raise OracleBindingRefused(
            "a real worksheet cannot be bound to a different account label"
        )
    if synthetic_pair and not worksheet.synthetic:
        # A synthetic capture is rehearsal data by construction: judging it against a real
        # worksheet would print a parity result for numbers no account ever produced.
        raise UsageRefused("a synthetic capture bundle cannot be judged against a real worksheet")
    report_bytes = Path(args.report).read_bytes()
    bind_report(worksheet, oracle_label, report_bytes)
    parsed = parse_report(report_bytes)
    deals_bytes = oracle_deals_bytes(parsed)
    rule: Literal["us", "eu"] = args.clock_rule
    clock = server_clock_for_rule(rule)
    windows: list[Window] = []
    proposed: tuple[Window, ...] | None = None
    for gate in ("A", "B"):
        window = fixed[gate]
        if window is None:
            if proposed is None:
                # keep_refused: a gate the picker cannot build stays in the verdict as
                # a RED window_refused entry, never a silently absent gate.
                proposed = propose_windows(
                    capture=capture,
                    ordinal=ordinal,
                    readings=worksheet.accounts[oracle_label],
                    oracle_deals=parsed.deals,
                    clock=clock,
                    run_day=run_day,
                    keep_refused=True,
                )
            window = next(w for w in proposed if w.gate == gate)
        windows.append(window)
    return _Inputs(
        capture=capture,
        ordinal=ordinal,
        worksheet=worksheet,
        oracle_label=oracle_label,
        deals_bytes=deals_bytes,
        clock_rule=rule,
        run_day=run_day,
        windows=tuple(windows),
        synthetic_pair=synthetic_pair,
    )


def _judge(inputs: _Inputs, deals_bytes: bytes) -> Verdict:
    return evaluate_windows(
        inputs.capture,
        inputs.ordinal,
        inputs.worksheet,
        inputs.windows,
        oracle_deals=load_oracle_deals(deals_bytes),
        clock=server_clock_for_rule(inputs.clock_rule),
        run_day=inputs.run_day,
        oracle_label=inputs.oracle_label,
        capture_synthetic=inputs.synthetic_pair,
    )


def _cmd_verdict(args: argparse.Namespace) -> int:
    try:
        inputs = _prepare(args)
        verdict = _judge(inputs, inputs.deals_bytes)
        raw, _digest = seal_bytes(verdict_to_json(verdict))
        markdown = render_verdict_markdown(verdict)
        Path(args.out_json).write_bytes(raw)
        Path(args.out_md).write_text(markdown, encoding="utf-8")
    except _REFUSALS as error:
        return _refuse(error)
    print(
        f"verdict: accounts={len(verdict.accounts)} "
        f"rehearsal={'yes' if verdict.rehearsal else 'no'} "
        f"final_green={'yes' if verdict.final_green else 'no'}"
    )
    if not any(a.legs for a in verdict.accounts):
        print("the verdict judged no window: every gate was refused", file=sys.stderr)
        return EXIT_REFUSED
    return EXIT_OK


def _cmd_red_proof(args: argparse.Namespace) -> int:
    try:
        inputs = _prepare(args)
        selected = (
            proofs.MUTATIONS if args.mutation == "all" else (args.mutation,)
        )
        records: list[proofs.RedProofRecord] = []
        with tempfile.TemporaryDirectory(prefix="mt5-parity-redproof-") as tmp:
            copy = Path(tmp) / "oracle.json"
            for mutation in selected:
                copy.write_bytes(inputs.deals_bytes)
                records.append(
                    proofs.run_red_proof(
                        oracle_copy=copy,
                        mutation=mutation,
                        evaluate=lambda path: _judge(inputs, path.read_bytes()),
                        account_label=args.account,
                    )
                )
        Path(args.out_md).write_text(
            proofs.render_red_proof_markdown(tuple(records)), encoding="utf-8"
        )
    except _REFUSALS as error:
        return _refuse(error)
    if inputs.synthetic_pair:
        failed = [r.mutation for r in records if not proofs.meets_expectation(r)]
    else:
        # On real inputs the expected bucket and leg are not asserted, but a proof still
        # fails when its baseline was RED or its mutation stayed GREEN: that proves nothing.
        failed = [
            r.mutation
            for r in records
            if not (proofs.restore_intact(r) and r.baseline_passed and not r.mutated_passed)
        ]
    if failed:
        print(f"red-proof: expectation failed for {', '.join(failed)}", file=sys.stderr)
        return EXIT_PROOF_FAILED
    print(f"red-proof: {len(records)} proof(s) ran")
    return EXIT_OK


def main(argv: Sequence[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    code: int = args.func(args)
    return code


if __name__ == "__main__":
    sys.exit(main())
