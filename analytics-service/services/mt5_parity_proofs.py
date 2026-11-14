"""The RED proofs for the MT5 parity harness (PARITY-02): the harness must be seen to fail.

A comparison that has never gone RED proves nothing. Each proof takes an oracle-deals
file, breaks it in one deliberate way, and shows the verdict flip from GREEN to RED
with a NAMED bucket and leg; it then restores the file from a byte backup and shows the
verdict come back GREEN and byte-identical to the baseline.

* ``reclassify_balance``: a BALANCE deal becomes a trade, so the oracle's flow disappears
  from its day. Bucket ``flow_placement``, leg ``cum_return``.
* ``clock_shift_1h``: every deal time moves one hour. Bucket ``clock_mismatch``, leg
  ``day_placement``.
* ``drop_oldest_deal``: the account's first deal vanishes, so the ledger no longer
  starts at inception. Bucket ``unexplained``, leg ``inception_identity``.

Safety rules the code enforces, not the reader:

* The mutation acts on a byte COPY outside ``tests/fixtures``; ``run_red_proof`` refuses a
  path inside the fixtures directory, so a committed fixture can never be the file that
  is broken.
* ``apply_mutation`` re-reads its own output and raises ``MutationVacuous`` unless exactly
  the intended field moved, so a proof that changes nothing cannot pass for a proof.
* Restoration is from the byte backup only (a ``finally``, so even a crash restores).
  Nothing here, or in its tests, runs git.

PURE: stdlib and sibling ``services.mt5_parity*`` modules only. ``RedProofRecord`` holds
labels, flags, bucket and leg names and ratios to three significant figures: no amount
and no id.
"""
from __future__ import annotations

import hashlib
import re
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Final, Literal

from services.mt5_parity import (
    CLOCK_MISMATCH,
    FLOW_PLACEMENT,
    UNEXPLAINED,
    AccountVerdict,
    LegResult,
    Verdict,
    ratio_3sf,
    verdict_to_json,
)
from services.mt5_parity_capture import seal_bytes
from services.mt5_parity_report import EmptyDeals, load_oracle_deals

Mutation = Literal["reclassify_balance", "clock_shift_1h", "drop_oldest_deal"]
MUTATIONS: Final[tuple[Mutation, ...]] = (
    "reclassify_balance",
    "clock_shift_1h",
    "drop_oldest_deal",
)

# What each broken input must produce: (bucket, the leg that carries the breach).
EXPECTED_OUTCOME: Final[Mapping[Mutation, tuple[str, str]]] = {
    "reclassify_balance": (FLOW_PLACEMENT, "cum_return"),
    "clock_shift_1h": (CLOCK_MISMATCH, "day_placement"),
    "drop_oldest_deal": (UNEXPLAINED, "inception_identity"),
}

_SHIFT_SECONDS: Final[int] = 3600
_BALANCE_TYPE: Final[int] = 2
_BUY_TYPE: Final[int] = 1
_ORACLE_VERSION: Final[int] = 1
# The committed fixtures: a RED proof may never write here.
_FIXTURES_DIR: Final[Path] = Path(__file__).resolve().parents[1] / "tests" / "fixtures"
_LABEL_RE: Final[re.Pattern[str]] = re.compile(r"^[A-Za-z][A-Za-z0-9_-]{0,31}$")
_LONG_DIGIT_RUN_RE: Final[re.Pattern[str]] = re.compile(r"[0-9]{5,}")


class MutationVacuous(AssertionError):
    """A mutation that would change nothing, or something other than its intended
    field. A proof built on it would prove nothing."""


class OracleCopyRefused(ValueError):
    """``oracle_copy`` is not a file outside the committed fixtures directory."""


# --------------------------------------------------------------------- mutations


def _oldest_index(deals: tuple[Mapping[str, Any], ...]) -> int:
    """The deal with the minimum time; the first in file order on a tie."""
    return min(range(len(deals)), key=lambda i: (deals[i]["time"], i))


def _mutated_deals(
    deals: tuple[Mapping[str, Any], ...], mutation: Mutation
) -> list[dict[str, Any]]:
    out = [dict(d) for d in deals]
    if mutation == "reclassify_balance":
        oldest = _oldest_index(deals)
        candidates = [
            i for i, d in enumerate(deals) if d["type"] == _BALANCE_TYPE and i != oldest
        ]
        if not candidates:
            raise MutationVacuous("no balance deal other than the oldest deal to reclassify")
        target = min(candidates, key=lambda i: (deals[i]["time"], i))
        out[target]["type"] = _BUY_TYPE
    elif mutation == "clock_shift_1h":
        for deal in out:
            deal["time"] = deal["time"] + _SHIFT_SECONDS
    else:
        del out[_oldest_index(deals)]
    return out


def _check_only_intended(
    before: tuple[Mapping[str, Any], ...],
    after: tuple[Mapping[str, Any], ...],
    mutation: Mutation,
) -> None:
    """Re-read the mutated deals and prove exactly the intended field moved."""
    if mutation == "drop_oldest_deal":
        gone = _oldest_index(before)
        expected = tuple(before[:gone]) + tuple(before[gone + 1 :])
        if after != expected:
            raise MutationVacuous("drop_oldest_deal changed more than the oldest deal")
        return
    if len(after) != len(before):
        raise MutationVacuous(f"{mutation} changed the number of deals")
    moved = 0
    for old, new in zip(before, after, strict=True):
        changed = {k for k in old if old[k] != new[k]}
        if mutation == "clock_shift_1h":
            if changed != {"time"} or new["time"] - old["time"] != _SHIFT_SECONDS:
                raise MutationVacuous("clock_shift_1h did not move exactly every time by 3600")
            moved += 1
        elif changed:
            if (
                changed != {"type"}
                or old["type"] != _BALANCE_TYPE
                or new["type"] != _BUY_TYPE
            ):
                raise MutationVacuous("reclassify_balance changed more than one deal's type")
            moved += 1
    if moved != (len(before) if mutation == "clock_shift_1h" else 1):
        raise MutationVacuous(f"{mutation} moved an unexpected number of deals")


def apply_mutation(oracle_bytes: bytes, mutation: Mutation) -> bytes:
    """The oracle-deals bytes with ``mutation`` applied, re-serialised canonically.

    Raises ``MutationVacuous`` when the input holds no deal the mutation can act on,
    when the bytes come out unchanged, or when anything beyond the intended field
    moved. Input that is not valid oracle-deals JSON raises the parser's refusal."""
    if mutation not in MUTATIONS:
        raise ValueError("unknown mutation")
    try:
        before = load_oracle_deals(oracle_bytes)
    except EmptyDeals:
        raise MutationVacuous("the oracle holds no deal to mutate") from None
    mutated = _mutated_deals(before, mutation)
    raw, _digest = seal_bytes({"oracle_version": _ORACLE_VERSION, "deals": mutated})
    if raw == oracle_bytes:
        raise MutationVacuous(f"{mutation} left the bytes unchanged")
    try:
        after = load_oracle_deals(raw)
    except EmptyDeals:
        raise MutationVacuous(f"{mutation} left no deal") from None
    _check_only_intended(before, after, mutation)
    return raw


# ------------------------------------------------------------------------ records


@dataclass(frozen=True, slots=True)
class RedProofRecord:
    """One proof's outcome. ``leg_gaps`` maps a leg to its (before, mutated, restored)
    ratios, each to three significant figures. No amount, no id."""

    mutation: Mutation
    account_label: str
    baseline_passed: bool
    mutated_passed: bool
    mutated_bucket: str
    mutated_breaching_legs: tuple[str, ...]
    named_leg_moved: bool
    restored_sha_equal: bool
    restored_identical: bool
    restored_passed: bool
    leg_gaps: Mapping[str, tuple[str, str, str]]
    note: str | None

    def __post_init__(self) -> None:
        if not _LABEL_RE.match(self.account_label) or _LONG_DIGIT_RUN_RE.search(
            self.account_label
        ):
            raise ValueError("account label is not a plain account label")


def restore_intact(record: RedProofRecord) -> bool:
    """The restore put back the same bytes and the same verdict, on any inputs."""
    return record.restored_sha_equal and record.restored_identical


def meets_expectation(record: RedProofRecord) -> bool:
    """The full PARITY-02 reading on the synthetic pair: GREEN, then RED with the
    expected bucket and leg, then restored, identical and GREEN again."""
    bucket, leg = EXPECTED_OUTCOME[record.mutation]
    return (
        record.baseline_passed
        and not record.mutated_passed
        and record.mutated_bucket == bucket
        and leg in record.mutated_breaching_legs
        and record.named_leg_moved
        and restore_intact(record)
        and record.restored_passed
    )


def _of_label(verdict: Verdict, label: str) -> tuple[AccountVerdict, ...]:
    found = tuple(a for a in verdict.accounts if a.label == label)
    if not found:
        raise ValueError("the verdict holds no account verdict for the proof's label")
    return found


def _focus(verdict: Verdict, label: str) -> AccountVerdict:
    """The account verdict a proof reads: Gate A (the deal-ledger gate every mutation
    acts on) when the label has one, else the label's first verdict."""
    found = _of_label(verdict, label)
    for account in found:
        if account.gate == "A":
            return account
    return found[0]


def _all_passed(verdict: Verdict, label: str) -> bool:
    return all(a.passed for a in _of_label(verdict, label))


def _leg(account: AccountVerdict, name: str) -> LegResult | None:
    for leg in account.legs:
        if leg.leg == name:
            return leg
    return None


def _canonical(verdict: Verdict) -> bytes:
    raw, _digest = seal_bytes(verdict_to_json(verdict))
    return raw


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def run_red_proof(
    *,
    oracle_copy: Path,
    mutation: Mutation,
    evaluate: Callable[[Path], Verdict],
    account_label: str,
) -> RedProofRecord:
    """Break ``oracle_copy`` one way, record the verdict, restore it from the byte backup.

    ``evaluate`` reads the file at the given path and returns the verdict. The copy
    must be a file outside the committed fixtures directory."""
    if mutation not in MUTATIONS:
        raise ValueError("unknown mutation")
    resolved = oracle_copy.resolve()
    if resolved.is_relative_to(_FIXTURES_DIR):
        raise OracleCopyRefused("a RED proof never writes inside the committed fixtures")
    if not resolved.is_file():
        raise OracleCopyRefused("the oracle copy is not a file")

    backup = resolved.read_bytes()
    original_sha = _sha(backup)
    baseline = evaluate(resolved)
    baseline_json = _canonical(baseline)

    mutated_bytes = apply_mutation(backup, mutation)
    if _sha(mutated_bytes) == original_sha:
        raise MutationVacuous(f"{mutation} did not change the file's sha256")
    try:
        resolved.write_bytes(mutated_bytes)
        mutated = evaluate(resolved)
    finally:
        resolved.write_bytes(backup)
    restored_sha_equal = _sha(resolved.read_bytes()) == original_sha
    restored = evaluate(resolved)

    _bucket, named = EXPECTED_OUTCOME[mutation]
    before = _focus(baseline, account_label)
    after = _focus(mutated, account_label)
    back = _focus(restored, account_label)
    names = tuple(
        dict.fromkeys(leg.leg for acct in (before, after, back) for leg in acct.legs)
    )
    gaps: dict[str, tuple[str, str, str]] = {}
    for name in names:
        trio = tuple(
            "n/a" if (leg := _leg(acct, name)) is None else ratio_3sf(leg.gap)
            for acct in (before, after, back)
        )
        gaps[name] = (trio[0], trio[1], trio[2])

    leg_before = _leg(before, named)
    leg_after = _leg(after, named)
    moved = (
        leg_before is not None
        and leg_after is not None
        and (leg_before.gap, leg_before.reason) != (leg_after.gap, leg_after.reason)
    )
    note: str | None = None
    if not moved:
        if leg_after is None:
            note = f"named_leg_absent:{after.reason or 'no_reason'}"
        elif leg_before is None:
            note = f"named_leg_absent_in_baseline:{before.reason or 'no_reason'}"
        else:
            note = "named_leg_unchanged"
    return RedProofRecord(
        mutation=mutation,
        account_label=account_label,
        baseline_passed=_all_passed(baseline, account_label),
        mutated_passed=_all_passed(mutated, account_label),
        mutated_bucket=after.bucket,
        mutated_breaching_legs=tuple(leg.leg for leg in after.legs if not leg.passed),
        named_leg_moved=moved,
        restored_sha_equal=restored_sha_equal,
        restored_identical=_canonical(restored) == baseline_json,
        restored_passed=_all_passed(restored, account_label),
        leg_gaps=gaps,
        note=note,
    )


def _yes(value: bool) -> str:
    return "yes" if value else "no"


def render_red_proof_markdown(records: tuple[RedProofRecord, ...]) -> str:
    """The tracked RED-proof document, rendered from the typed records."""
    lines = ["# MT5 parity RED proofs", "", f"Proofs: {len(records)}"]
    for record in records:
        bucket, leg = EXPECTED_OUTCOME[record.mutation]
        lines += [
            "",
            f"## {record.mutation} ({record.account_label})",
            "",
            f"- expected: bucket {bucket}, leg {leg}",
            f"- baseline passed: {_yes(record.baseline_passed)}",
            f"- mutated passed: {_yes(record.mutated_passed)}",
            f"- mutated bucket: {record.mutated_bucket}",
            "- mutated breaching legs: "
            + (", ".join(record.mutated_breaching_legs) or "none"),
            f"- named leg moved: {_yes(record.named_leg_moved)}",
            f"- restored sha256 equal: {_yes(record.restored_sha_equal)}",
            f"- restored verdict byte-identical: {_yes(record.restored_identical)}",
            f"- restored passed: {_yes(record.restored_passed)}",
            f"- meets expectation: {_yes(meets_expectation(record))}",
        ]
        for name, (b, m, r) in record.leg_gaps.items():
            lines.append(f"- gap {name}: before {b}, mutated {m}, restored {r}")
        if record.note is not None:
            lines.append(f"- note: {record.note}")
    return "\n".join(lines) + "\n"


__all__ = [
    "EXPECTED_OUTCOME",
    "MUTATIONS",
    "Mutation",
    "MutationVacuous",
    "OracleCopyRefused",
    "RedProofRecord",
    "apply_mutation",
    "meets_expectation",
    "render_red_proof_markdown",
    "restore_intact",
    "run_red_proof",
]
