"""The tracer: one synthetic account from a capture bundle to a rendered Gate B verdict.

Why these tests exist: the harness is only worth running if it can say NO. The GREEN
test proves the pipeline is wired end to end on the committed synthetic files; the
perturbed tests prove a single moved reading flips the verdict, that the taxonomy is
fail-closed (``unexplained`` only after the registry was consulted), and that an
oracle from our own side is refused by name before any comparison runs.

Only ``tmp_path`` and the committed fixtures are used. Nothing here touches a
network, a database or the gateway.
"""
from __future__ import annotations

import json
import re
from datetime import date
from pathlib import Path
from typing import Any

import pytest

from services.mt5_parity import (
    BUCKET_LABELS,
    EDGE_INSTANT_MISMATCH,
    EXPLAINERS,
    MT5_PARITY_TOLERANCE,
    PASSING_BUCKETS,
    UNEXPLAINED,
    WITHIN_TOLERANCE,
    AccountVerdict,
    Verdict,
    Window,
    evaluate_account,
    render_verdict_markdown,
    verdict_to_json,
)
from services.mt5_parity_capture import Capture, load_bundle, load_capture, seal_capture
from services.mt5_parity_intake import ProvenanceRefused, Worksheet, load_worksheet

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "mt5_parity"
WINDOW = Window(gate="B", start=date(2026, 11, 6), end=date(2026, 11, 13))
END_READING_ID = "weekend_close_equity"


def _capture(tmp_path: Path, bundle: Path | None = None) -> Capture:
    run_dir = load_bundle(bundle or FIXTURES / "capture_synthetic.json", tmp_path / "run")
    seal_capture(run_dir)
    return load_capture(run_dir)


def _worksheet_copy(tmp_path: Path, mutate: Any) -> Path:
    data = json.loads((FIXTURES / "worksheet_synthetic.json").read_text(encoding="utf-8"))
    mutate(data)
    out = tmp_path / "worksheet.json"
    out.write_text(json.dumps(data), encoding="utf-8")
    return out


def _end_equity_to(value: float) -> Any:
    def mutate(data: dict[str, Any]) -> None:
        for reading in data["accounts"]["SYN-A"]["readings"]:
            if reading["id"] == END_READING_ID:
                reading["value"] = value

    return mutate


def _bundle_copy(tmp_path: Path, mutate: Any) -> Path:
    data = json.loads((FIXTURES / "capture_synthetic.json").read_text(encoding="utf-8"))
    mutate(data)
    out = tmp_path / "bundle.json"
    out.write_text(json.dumps(data), encoding="utf-8")
    return out


def _evaluate(capture: Capture, worksheet: Worksheet) -> AccountVerdict:
    return evaluate_account(capture, "k1", worksheet, WINDOW)


def test_green_pipeline_end_to_end(tmp_path: Path) -> None:
    verdict = _evaluate(
        _capture(tmp_path), load_worksheet(FIXTURES / "worksheet_synthetic.json")
    )
    assert verdict.bucket == WITHIN_TOLERANCE
    assert verdict.passed is True
    assert [leg.leg for leg in verdict.legs] == ["start_level", "end_level", "cum_return"]
    for leg in verdict.legs:
        assert leg.gap is not None
        assert leg.gap <= MT5_PARITY_TOLERANCE
        assert leg.passed is True


def test_one_moved_reading_turns_the_same_pipeline_red_and_unexplained(
    tmp_path: Path,
) -> None:
    # Oracle end equity moved by 250 on a start equity of 11900: a 250/11900 gap.
    sheet = load_worksheet(_worksheet_copy(tmp_path, _end_equity_to(12400.00)))
    verdict = _evaluate(_capture(tmp_path), sheet)
    expected_gap = abs(250.0) / 11900.0
    assert expected_gap > MT5_PARITY_TOLERANCE  # the perturbation is a real breach
    assert verdict.passed is False
    assert verdict.bucket == UNEXPLAINED
    by_leg = {leg.leg: leg for leg in verdict.legs}
    assert by_leg["end_level"].passed is False
    assert by_leg["end_level"].gap == pytest.approx(expected_gap, abs=1e-12)
    assert by_leg["cum_return"].gap == pytest.approx(expected_gap, abs=1e-12)
    assert by_leg["start_level"].passed is True  # only the moved edge breaches


def test_gateway_provenance_is_refused_by_name_before_any_comparison(
    tmp_path: Path,
) -> None:
    def mutate(data: dict[str, Any]) -> None:
        data["accounts"]["SYN-A"]["readings"][0]["provenance"] = "gateway"

    with pytest.raises(ProvenanceRefused) as refused:
        load_worksheet(_worksheet_copy(tmp_path, mutate))
    assert "gateway" in str(refused.value)


def test_rendered_verdict_carries_no_amount_and_no_long_ratio(tmp_path: Path) -> None:
    sheet = load_worksheet(FIXTURES / "worksheet_synthetic.json")
    account = _evaluate(_capture(tmp_path), sheet)
    text = render_verdict_markdown(
        Verdict(accounts=(account,), rehearsal=sheet.synthetic, run_day=date(2026, 11, 16))
    )
    assert "SYN-A" in text and WITHIN_TOLERANCE in text and "start_level" in text
    assert not re.search(r"[0-9]{5,}", text), "a 5-or-more-digit run could be an amount"
    for number in re.findall(r"[0-9]*\.[0-9]+", text):
        significant = (number.replace(".", "")).lstrip("0")
        assert len(significant) <= 3, "a decimal with more than 3 significant figures"
    # The typed object has no field that could hold an amount, a date or an id.
    assert verdict_to_json(
        Verdict(accounts=(account,), rehearsal=True, run_day=date(2026, 11, 16))
    )["accounts"][0]["label"] == "SYN-A"


def test_registry_is_consulted_before_the_unexplained_fallback(tmp_path: Path) -> None:
    # The same breach as the RED test, with the end mark taken after the weekend
    # interval the oracle reading is attested for: the registered explainer must win.
    def move_mark(data: dict[str, Any]) -> None:
        marks = data["raw"]["capture-marks.json"][0]["slice_rows"]
        assert marks[2]["mark_day"] == "2026-11-13"
        marks[2]["marked_at"] = "2026-11-16T00:05:00Z"

    sheet = load_worksheet(_worksheet_copy(tmp_path, _end_equity_to(12400.00)))
    capture = _capture(tmp_path, _bundle_copy(tmp_path, move_mark))
    verdict = _evaluate(capture, sheet)
    assert verdict.bucket == EDGE_INSTANT_MISMATCH
    assert verdict.matched == (EDGE_INSTANT_MISMATCH,)
    assert verdict.passed is False


def test_taxonomy_is_closed_and_the_registry_never_registers_a_passing_bucket() -> None:
    assert len(BUCKET_LABELS) == 8
    assert UNEXPLAINED in BUCKET_LABELS
    for bucket, _ in EXPLAINERS:
        assert bucket in BUCKET_LABELS
        assert bucket not in PASSING_BUCKETS
        assert bucket != UNEXPLAINED  # the fallback is never a registered explainer
