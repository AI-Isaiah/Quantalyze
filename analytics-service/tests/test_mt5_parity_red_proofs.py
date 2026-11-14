"""PARITY-02: the harness is seen to go RED, with a named bucket and leg, and to come back.

Why these tests exist: a comparison that has never failed proves nothing. Each proof
here breaks the synthetic oracle in one deliberate way and asserts the verdict flips
from GREEN to RED with the bucket and the leg the mutation is meant to hit, then
restores the file from a byte backup and asserts the sha256 and the verdict are the
originals again. Each mutation is applied to a COPY in ``tmp_path``; a vacuity guard
proves the bytes moved in exactly the intended field, and a module-scoped guard proves
no committed fixture changed. Nothing here runs git.
"""
from __future__ import annotations

import hashlib
import json
from collections.abc import Iterator
from datetime import date
from pathlib import Path
from typing import Any

import pytest

import services.mt5_parity_proofs as proofs
from services.mt5_parity import (
    CLOCK_MISMATCH,
    FLOW_PLACEMENT,
    UNEXPLAINED,
    Verdict,
    Window,
    evaluate_account,
)
from services.mt5_parity_capture import Capture, load_bundle, load_capture, seal_capture
from services.mt5_parity_intake import Worksheet, load_worksheet
from services.mt5_parity_proofs import (
    EXPECTED_OUTCOME,
    MUTATIONS,
    MutationVacuous,
    OracleCopyRefused,
    RedProofRecord,
    apply_mutation,
    meets_expectation,
    render_red_proof_markdown,
    run_red_proof,
)
from services.mt5_parity_report import load_oracle_deals, oracle_deals_bytes, parse_report
from services.mt5_server_clock import server_clock_for_rule

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "mt5_parity"
US = server_clock_for_rule("us")
RUN_DAY = date(2026, 11, 16)
GATE_A = Window(gate="A", start=date(2026, 10, 5), end=date(2026, 10, 30))
GATE_B = Window(gate="B", start=date(2026, 11, 6), end=date(2026, 11, 13))
LABEL = "SYN-A"


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


@pytest.fixture(scope="module", autouse=True)
def committed_fixtures_are_untouched() -> Iterator[None]:
    """No proof may write to a committed fixture: their sha256 values must be the same
    after the whole module as before it."""
    before = {p.name: _sha(p) for p in sorted(FIXTURES.iterdir()) if p.is_file()}
    assert before, "no committed fixtures were found, so this guard would be vacuous"
    yield
    after = {p.name: _sha(p) for p in sorted(FIXTURES.iterdir()) if p.is_file()}
    assert after == before


def _synthetic_oracle_bytes() -> bytes:
    return oracle_deals_bytes(
        parse_report((FIXTURES / "report_synthetic.utf16le.html").read_bytes())
    )


class _Pair:
    """The synthetic pair: sealed capture, worksheet, and the oracle copy to mutate."""

    def __init__(self, tmp_path: Path) -> None:
        run_dir = load_bundle(FIXTURES / "capture_synthetic.json", tmp_path / "run")
        seal_capture(run_dir)
        self.capture: Capture = load_capture(run_dir)
        self.worksheet: Worksheet = load_worksheet(FIXTURES / "worksheet_synthetic.json")
        self.oracle = tmp_path / "oracle.json"
        self.oracle.write_bytes(_synthetic_oracle_bytes())

    def evaluate(self, path: Path) -> Verdict:
        deals = load_oracle_deals(path.read_bytes())
        accounts = tuple(
            evaluate_account(
                self.capture,
                "k1",
                self.worksheet,
                window,
                oracle_deals=deals,
                clock=US,
                run_day=RUN_DAY,
            )
            for window in (GATE_A, GATE_B)
        )
        return Verdict(accounts=accounts, rehearsal=self.worksheet.synthetic, run_day=RUN_DAY)

    def prove(self, mutation: Any) -> RedProofRecord:
        return run_red_proof(
            oracle_copy=self.oracle,
            mutation=mutation,
            evaluate=self.evaluate,
            account_label=LABEL,
        )


# ------------------------------------------------------------------ the three proofs


@pytest.mark.parametrize("mutation", MUTATIONS)
def test_red_proof_flips_green_to_red_with_the_named_bucket_and_back(
    tmp_path: Path, mutation: Any
) -> None:
    pair = _Pair(tmp_path)
    original = _sha(pair.oracle)
    bucket, leg = EXPECTED_OUTCOME[mutation]

    record = pair.prove(mutation)

    assert record.baseline_passed is True
    assert record.mutated_passed is False
    assert record.mutated_bucket == bucket
    assert leg in record.mutated_breaching_legs
    assert record.named_leg_moved is True
    assert record.restored_sha_equal is True
    assert record.restored_identical is True
    assert record.restored_passed is True
    assert record.note is None
    assert _sha(pair.oracle) == original, "the copy was not restored from the byte backup"
    assert meets_expectation(record)


def test_the_expected_outcomes_are_the_three_named_buckets() -> None:
    assert dict(EXPECTED_OUTCOME) == {
        "reclassify_balance": (FLOW_PLACEMENT, "cum_return"),
        "clock_shift_1h": (CLOCK_MISMATCH, "day_placement"),
        "drop_oldest_deal": (UNEXPLAINED, "inception_identity"),
    }


def test_red_proof_of_drop_oldest_moves_only_the_identity_leg(tmp_path: Path) -> None:
    # Pitfall 1: dropping the first deal must not be mistaken for a level or a placement
    # breach. The identity leg moves; the four others stay where they were.
    record = _Pair(tmp_path).prove("drop_oldest_deal")
    assert record.named_leg_moved is True
    gaps = record.leg_gaps
    for leg in ("start_level", "end_level", "cum_return", "day_placement"):
        before, mutated, restored = gaps[leg]
        assert before == mutated == restored, leg
    before, mutated, restored = gaps["inception_identity"]
    assert before == restored
    assert mutated != before
    assert record.mutated_breaching_legs == ("inception_identity",)


def test_red_proof_records_every_leg_gap_as_three_significant_figures(
    tmp_path: Path,
) -> None:
    record = _Pair(tmp_path).prove("reclassify_balance")
    assert set(record.leg_gaps) >= {"cum_return", "day_placement"}
    for trio in record.leg_gaps.values():
        for text in trio:
            if text == "n/a":
                continue
            mantissa = text.lower().split("e")[0]
            assert len(mantissa.replace(".", "").replace("-", "").lstrip("0")) <= 3, text


def test_red_proof_markdown_names_each_mutation_and_its_bucket(tmp_path: Path) -> None:
    pair = _Pair(tmp_path)
    records = tuple(pair.prove(m) for m in MUTATIONS)
    text = render_red_proof_markdown(records)
    for mutation in MUTATIONS:
        assert f"## {mutation} ({LABEL})" in text
        assert f"expected: bucket {EXPECTED_OUTCOME[mutation][0]}" in text
    assert text.count("meets expectation: yes") == 3
    assert "restored sha256 equal: yes" in text


# ----------------------------------------------------------- the proofs can fail


def test_red_proof_cannot_pass_on_a_mutation_that_changes_nothing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Neuter the mutation to the identity: the proof must refuse, not report a RED
    # that never happened.
    pair = _Pair(tmp_path)
    monkeypatch.setattr(proofs, "apply_mutation", lambda data, mutation: data)
    with pytest.raises(MutationVacuous):
        pair.prove("clock_shift_1h")
    assert _sha(pair.oracle) == hashlib.sha256(_synthetic_oracle_bytes()).hexdigest()


def test_red_proof_restores_the_bytes_even_when_the_mutated_run_crashes(
    tmp_path: Path,
) -> None:
    pair = _Pair(tmp_path)
    original = _sha(pair.oracle)
    calls = {"n": 0}

    def crash_on_second(path: Path) -> Verdict:
        calls["n"] += 1
        if calls["n"] == 2:
            raise RuntimeError("boom")
        return pair.evaluate(path)

    with pytest.raises(RuntimeError):
        run_red_proof(
            oracle_copy=pair.oracle,
            mutation="drop_oldest_deal",
            evaluate=crash_on_second,
            account_label=LABEL,
        )
    assert _sha(pair.oracle) == original


def test_red_proof_reports_a_restore_that_is_not_identical(tmp_path: Path) -> None:
    # An evaluate that drifts on its third call (the restored run) must show up as a
    # non-identical restore, and meets_expectation must then be False.
    pair = _Pair(tmp_path)
    calls = {"n": 0}

    def drifting(path: Path) -> Verdict:
        calls["n"] += 1
        verdict = pair.evaluate(path)
        if calls["n"] == 3:
            return Verdict(accounts=verdict.accounts[:1], rehearsal=True, run_day=RUN_DAY)
        return verdict

    record = run_red_proof(
        oracle_copy=pair.oracle,
        mutation="clock_shift_1h",
        evaluate=drifting,
        account_label=LABEL,
    )
    assert record.restored_sha_equal is True
    assert record.restored_identical is False
    assert not meets_expectation(record)


def test_red_proof_refuses_a_copy_inside_the_committed_fixtures() -> None:
    fixture = FIXTURES / "ledger_synthetic.json"
    before = _sha(fixture)
    with pytest.raises(OracleCopyRefused):
        run_red_proof(
            oracle_copy=fixture,
            mutation="drop_oldest_deal",
            evaluate=lambda path: pytest.fail("must refuse before evaluating"),
            account_label=LABEL,
        )
    assert _sha(fixture) == before


def test_red_proof_refuses_a_copy_that_is_not_a_file(tmp_path: Path) -> None:
    with pytest.raises(OracleCopyRefused):
        run_red_proof(
            oracle_copy=tmp_path / "absent.json",
            mutation="drop_oldest_deal",
            evaluate=lambda path: pytest.fail("must refuse before evaluating"),
            account_label=LABEL,
        )


def test_red_proof_needs_a_verdict_for_its_label(tmp_path: Path) -> None:
    pair = _Pair(tmp_path)
    with pytest.raises(ValueError, match="no account verdict"):
        run_red_proof(
            oracle_copy=pair.oracle,
            mutation="drop_oldest_deal",
            evaluate=pair.evaluate,
            account_label="OTHER",
        )
    assert _sha(pair.oracle) == hashlib.sha256(_synthetic_oracle_bytes()).hexdigest()


def test_a_record_refuses_a_login_shaped_label() -> None:
    with pytest.raises(ValueError):
        RedProofRecord(
            mutation="clock_shift_1h",
            account_label="acct12345",
            baseline_passed=True,
            mutated_passed=False,
            mutated_bucket=CLOCK_MISMATCH,
            mutated_breaching_legs=(),
            named_leg_moved=True,
            restored_sha_equal=True,
            restored_identical=True,
            restored_passed=True,
            leg_gaps={},
            note=None,
        )


# ------------------------------------------------------------------------ vacuity


def _deals(raw: bytes) -> tuple[Any, ...]:
    return tuple(load_oracle_deals(raw))


def test_reclassify_changes_exactly_one_deals_type_the_earliest_balance_but_the_first() -> None:
    before_raw = _synthetic_oracle_bytes()
    before, after = _deals(before_raw), _deals(apply_mutation(before_raw, "reclassify_balance"))
    assert len(before) == len(after)
    diffs = [i for i, (a, b) in enumerate(zip(before, after, strict=True)) if a != b]
    assert diffs == [3]  # deal 1004: the earliest type-2 deal that is not the oldest
    assert (before[3]["type"], after[3]["type"]) == (2, 1)
    assert {k for k in before[3] if before[3][k] != after[3][k]} == {"type"}


def test_clock_shift_moves_every_time_by_exactly_one_hour_and_nothing_else() -> None:
    before_raw = _synthetic_oracle_bytes()
    before, after = _deals(before_raw), _deals(apply_mutation(before_raw, "clock_shift_1h"))
    assert len(before) == len(after) > 1
    for old, new in zip(before, after, strict=True):
        assert new["time"] - old["time"] == 3600
        assert {k for k in old if old[k] != new[k]} == {"time"}


def test_drop_oldest_removes_exactly_the_oldest_deal() -> None:
    before_raw = _synthetic_oracle_bytes()
    before, after = _deals(before_raw), _deals(apply_mutation(before_raw, "drop_oldest_deal"))
    assert len(after) == len(before) - 1
    assert before[0]["deal"] == 1001 and 1001 not in {d["deal"] for d in after}
    assert after == before[1:]


def test_drop_oldest_takes_the_first_in_file_order_on_a_time_tie() -> None:
    raw = _synthetic_oracle_bytes()
    obj = json.loads(raw)
    obj["deals"][1]["time"] = obj["deals"][0]["time"]  # a tie for the minimum time
    tied = json.dumps(obj, sort_keys=True, separators=(",", ":")).encode("ascii")
    out = _deals(apply_mutation(tied, "drop_oldest_deal"))
    assert [d["deal"] for d in out][0] == 1002  # 1001 (first in file order) is the one gone


def test_apply_mutation_refuses_oracle_bytes_with_no_qualifying_deal() -> None:
    obj = json.loads(_synthetic_oracle_bytes())
    only_balance_first = {"oracle_version": 1, "deals": obj["deals"][:1]}
    raw = json.dumps(only_balance_first, sort_keys=True, separators=(",", ":")).encode("ascii")
    with pytest.raises(MutationVacuous):
        apply_mutation(raw, "reclassify_balance")  # the one balance deal is the oldest
    no_balance = {"oracle_version": 1, "deals": [d for d in obj["deals"] if d["type"] != 2]}
    raw = json.dumps(no_balance, sort_keys=True, separators=(",", ":")).encode("ascii")
    with pytest.raises(MutationVacuous):
        apply_mutation(raw, "reclassify_balance")
    empty = json.dumps({"oracle_version": 1, "deals": []}).encode("ascii")
    for mutation in MUTATIONS:
        with pytest.raises(MutationVacuous):
            apply_mutation(empty, mutation)


def test_apply_mutation_is_deterministic_and_does_not_touch_its_input() -> None:
    raw = _synthetic_oracle_bytes()
    first = apply_mutation(raw, "clock_shift_1h")
    assert apply_mutation(raw, "clock_shift_1h") == first
    assert raw == _synthetic_oracle_bytes()
    assert first != raw


def test_apply_mutation_refuses_an_unknown_mutation() -> None:
    with pytest.raises(ValueError):
        apply_mutation(_synthetic_oracle_bytes(), "delete_everything")  # type: ignore[arg-type]
