"""D-15 — the ``JOB_CHAIN_FOLLOW_ON`` unpack must be CONTAINED by the follow-on
guard, not sit outside it.

``run_process_key_long_job``'s tail-enqueue block carries an explicit promise in
its own comment (``services/ingestion/long_fetch.py``): the verification is
already ``published`` by the time it runs, so a worker retry short-circuits on
the idempotency check above and would NOT re-run this tail — *therefore we must
NOT let an enqueue blip crash the handler*. That promise was only half kept: the
late import and the fixed-arity 2-tuple unpack

    ledger_tail, trade_tail = JOB_CHAIN_FOLLOW_ON["process_key_long"]

sat OUTSIDE the ``try:``. Widen the chain topology to a 3-tuple — a plausible
future edit, since the map is the canonical topology JOB-03 reads — and the
``ValueError`` escapes the handler. The job is then retried, the retry
short-circuits on ``status == 'published'``, and the strategy is left published
with NO analytics chain ever enqueued: a permanent wizard spinner with no
failure recorded anywhere.

⚠️ Provenance, recorded honestly: this is **latent, not live**. Today the map is
a module-level literal 2-tuple, so the unpack cannot fail at runtime. Pass A
raised it three times and independent verifiers REFUTED it three times — each
time correctly. It is in scope because it is a two-line hoist, and this file is
what makes it falsifiable for the first time. It must NOT be recorded as
"Pass A missed it".

Harness provenance: the deribit ledger-backed driver is the one already proven in
``tests/test_long_fetch.py:317`` and ``tests/test_mt5_derive_branch.py:609``;
the ``monkeypatch.setitem`` idiom against a module-level topology map is
``tests/test_stitch_composite_job.py:1196``. ``setitem`` (not ``setattr``) is
used deliberately: ``long_fetch`` re-resolves the map by LATE import at call
time, so mutating the live dict object is what the production read actually
sees, and pytest restores it automatically.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import services.job_worker as _jw
from services.ingestion.long_fetch import run_process_key_long_job
from services.job_worker import DispatchOutcome

_STRATEGY_ID = "s-deribit-d15"


def _job() -> dict[str, Any]:
    """A deribit (ledger-backed) long-fetch job that reaches the tail block.

    deribit is in ``_LEDGER_BACKED_SOURCES``, so the fill pipeline is skipped
    and the handler runs straight through the state machine to the follow-on
    enqueue — the block under test — with no env gate to satisfy (unlike mt5,
    which needs ``MT5_ENABLED``).
    """
    return {
        "id": "job-deribit-d15",
        "kind": "process_key_long",
        "strategy_id": _STRATEGY_ID,
        "metadata": {
            "unified_backbone_at_claim": "true",
            "verification_id": "v-deribit-d15",
            "source": "deribit",
            "flow_type": "onboard",
            "correlation_id": "cid-d15",
            "context": {
                "strategy_id": _STRATEGY_ID,
                "api_key": "k",
                "api_secret": "s",
            },
        },
    }


def _supabase_mock() -> MagicMock:
    """Supabase double whose verification row is 'draft' (so no short-circuit)
    and whose RPCs are no-ops. Assertions route by RPC NAME (``c.args[0]``),
    never by call-counter position (PATTERNS S-8) — the handler issues several
    RPCs before the tail and a positional oracle would silently stop pointing at
    the enqueue the day one is added."""
    sb = MagicMock()
    table_chain = MagicMock()
    table_chain.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value = MagicMock(
        data={"status": "draft"}
    )
    sb.table.return_value = table_chain
    rpc_chain = MagicMock()
    rpc_chain.execute.return_value = MagicMock(data=None)
    sb.rpc.return_value = rpc_chain
    return sb


def _ledger_adapter() -> MagicMock:
    """A deribit adapter: validation succeeds, every FILL-derived method raises
    if touched (they raise by design in the real DeribitAdapter too)."""
    from services.ingestion.adapter import ValidationResult

    adapter = MagicMock()
    adapter.validate = AsyncMock(
        return_value=ValidationResult(
            valid=True,
            read_only=True,
            error_code=None,
            human_message=None,
            debug_context={},
        )
    )
    for name in (
        "fetch_raw",
        "reconstruct_positions",
    ):
        setattr(
            adapter,
            name,
            AsyncMock(side_effect=AssertionError(f"{name} must not run for deribit")),
        )
    for name in ("compute_metrics", "compute_fingerprint"):
        setattr(
            adapter,
            name,
            MagicMock(side_effect=AssertionError(f"{name} must not run for deribit")),
        )
    return adapter


def _enqueue_calls(sb: MagicMock) -> list[Any]:
    return [
        c for c in sb.rpc.call_args_list
        if c.args and c.args[0] == "enqueue_compute_job"
    ]


@pytest.mark.asyncio
async def test_unexpected_follow_on_arity_does_not_crash_the_handler(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """THE PROTECTION. A ``process_key_long`` chain entry of unexpected arity
    (here a 3-tuple, standing in for a future topology edit that adds a third
    tail) must be contained by the SAME best-effort guard as an enqueue blip:
    the handler logs loudly and returns DONE rather than raising.

    Kills: moving the unpack back outside the ``try:``. Pre-hoist this test
    fails with ``ValueError: too many values to unpack (expected 2)`` escaping
    ``run_process_key_long_job`` — the failure mode that leaves a published
    strategy with no analytics chain, because the retry short-circuits on
    ``status == 'published'`` and never reaches the tail again.
    """
    monkeypatch.setitem(
        _jw.JOB_CHAIN_FOLLOW_ON,
        "process_key_long",
        ("derive_broker_dailies", "sync_trades", "a_third_future_tail"),
    )

    sb = _supabase_mock()
    adapter = _ledger_adapter()

    with patch("services.ingestion.long_fetch.get_adapter", return_value=adapter), \
         patch("services.ingestion.long_fetch.get_supabase", return_value=sb), \
         patch("services.ingestion.long_fetch.log") as mock_log, \
         patch("services.encryption.encrypt_credentials", return_value={"v": 1}), \
         patch("services.encryption.get_kek", return_value=b"0" * 32):
        # No pytest.raises wrapper: an escaping exception IS the failure, and
        # letting it propagate here names the exact class in the report.
        result = await run_process_key_long_job(_job())

    assert result.outcome == DispatchOutcome.DONE, (
        "an unusable chain-topology entry must not fail the job — the "
        "verification is already 'published', so a FAILED outcome buys a retry "
        "that short-circuits and never re-runs the tail anyway"
    )

    # The containment must be LOUD, not silent — the guard's own comment
    # promises "Log loudly instead". A silently-swallowed arity error would be
    # strictly worse than the crash it replaces.
    failure_logs = [
        c for c in mock_log.error.call_args_list
        if c.args and c.args[0] == "process_key_long.enqueue_tail_failed"
    ]
    assert failure_logs, (
        "the contained arity error must be logged as "
        "process_key_long.enqueue_tail_failed — containment without a log is "
        "an invisible dropped chain, which is the defect this guard exists to "
        f"make visible (error logs seen: {mock_log.error.call_args_list!r})"
    )

    # And nothing was enqueued, because the tail kind could not be resolved.
    # Stated so the test's own scope is honest: this pins CONTAINMENT, not
    # recovery. Recovering a mis-shaped topology is not in scope — the manual
    # re-sync named in the guard's comment is the remedy.
    assert not _enqueue_calls(sb), (
        "an unresolvable tail kind must not enqueue a job under a guessed kind"
    )


@pytest.mark.asyncio
async def test_real_two_tuple_still_enqueues_the_selected_tail() -> None:
    """NEGATIVE CONTROL. With the REAL topology in place the guard must not have
    disabled the feature it now wraps: the ledger-backed tail is still selected
    from the tuple and still enqueued.

    Without this, the test above could be satisfied by a hoist that swallowed
    every follow-on enqueue — containment would pass while the chain silently
    stopped being built.
    """
    ledger_tail, trade_tail = _jw.JOB_CHAIN_FOLLOW_ON["process_key_long"]

    sb = _supabase_mock()
    adapter = _ledger_adapter()

    with patch("services.ingestion.long_fetch.get_adapter", return_value=adapter), \
         patch("services.ingestion.long_fetch.get_supabase", return_value=sb), \
         patch("services.encryption.encrypt_credentials", return_value={"v": 1}), \
         patch("services.encryption.get_kek", return_value=b"0" * 32):
        result = await run_process_key_long_job(_job())

    assert result.outcome == DispatchOutcome.DONE

    enqueue = _enqueue_calls(sb)
    assert enqueue, "a ledger-backed success must still enqueue its factsheet tail"
    payload = enqueue[0].args[1]
    assert payload["p_kind"] == ledger_tail, (
        "deribit is ledger-backed, so the tail must be the FIRST element of the "
        f"tuple ({ledger_tail!r}), never the trade-backed one ({trade_tail!r}) "
        "— the tuple order is load-bearing (services/job_worker.py)"
    )
    assert payload["p_strategy_id"] == _STRATEGY_ID
