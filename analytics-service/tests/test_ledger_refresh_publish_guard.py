"""Phase 161.1 / CR-02 + CR-03 — the D-15 guard, at every site it has to hold.

Why this file exists
--------------------
``161.1-REVIEW.md`` found the D-15 non-destructive guard was real but partial.
Three independent paths routed around it:

* **CR-01** — the SQL status bridge re-decided the publish state one statement
  after the Python guard skipped its stamp. Fixed in migration 20260825150000
  and proven END TO END by ``supabase/tests/test_sync_status_marked_refresh_
  protected.sql``, which drives the real ``mark_compute_job_failed`` RPC. It is
  deliberately NOT re-asserted here: a Python test cannot execute SQL, and a
  mock-shaped restatement of it would be exactly the vacuity that let CR-01
  through in the first place.
* **CR-02** — ``run_derive_broker_dailies_job`` had FOUR terminal-``failed``
  stamp sites and the guard was on ONE of them. The worst,
  ``_mark_insufficient``, also DELETED both persisted basis-series rows, and it
  fires on ``<2`` daily-return days — which is what an MT5 terminal that has
  lost its login returns (a clean crawl of an EMPTY deal history).
* **CR-03** — the chained ``compute_analytics_from_csv`` hop was enqueued with
  no metadata, so hop 2 of every refresh carried no marker. Hop 2 is where the
  factsheet is compiled and ``analytics_runner`` stamps ``failed`` at five sites
  of its own, so a refresh could un-publish a funded account with every hop-1
  guard reading green.

Falsifiability
--------------
Every test here must be able to fail. Each class documents the neutering that
reddens it, and each was run and observed RED before this file was accepted.

The subtlest vacuity risk in this file is the *destructive control*. Assertions
of the form "a marked refresh did NOT write computation_status" pass trivially
against a handler that wrote nothing at all — a broken driver, a preflight that
returned early, a patch that swallowed the call. Every protected case is
therefore paired with an UNMARKED case driven through the IDENTICAL code path,
which must write the destructive payload. If the driver breaks, the control
fails first and loudly.
"""
from __future__ import annotations

import asyncio
import re
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pandas as pd
import pytest

from services.job_worker import (
    LEDGER_REFRESH_JOB_SOURCES,
    DispatchOutcome,
    run_compute_analytics_from_csv_job,
    run_derive_broker_dailies_job,
)
from tests.test_derive_broker_dailies_dualmode import (
    _CCXT_VERDICT,
    _build_ctx,
    _patches_with_combine,
    _two_day_returns,
)

# Hand-typed, like the other end of every cross-language contract in this phase.
_MARKER = "ledger-refresh"
_COMPOSITE_MARKER = "ledger-refresh-composite"
_STRATEGY_ID = "strat-cr02"

# The columns a terminal stamp writes that carry PUBLISH meaning. None of them
# may appear in — or be downgraded by — a protected refresh's payload.
_PUBLISH_STATE_KEYS = (
    "computation_status",
    "computation_warned",
    "metrics_json_by_basis",
    "data_quality_flags",
)

_REPO_ROOT = Path(__file__).resolve().parents[2]
_JOB_WORKER = _REPO_ROOT / "analytics-service" / "services" / "job_worker.py"
_ANALYTICS_RUNNER = _REPO_ROOT / "analytics-service" / "services" / "analytics_runner.py"
_MIGRATIONS_DIR = _REPO_ROOT / "supabase" / "migrations"

# Any string literal that OPENS with a ledger-refresh-shaped marker, in Python or
# SQL. Deliberately looser than the two known spellings: an underscore, a space,
# or an unknown suffix is precisely the "fifth spelling" this contract exists to
# catch, and a regex that only matched the correct values could never see one.
_MARKER_LITERAL_RE = re.compile(
    r"""["']((?:[Ll]edger[-_ ]?[Rr]efresh)[A-Za-z0-9_-]*)["']"""
)
_BRIDGE_MIGRATION = (
    _REPO_ROOT
    / "supabase"
    / "migrations"
    / "20260825150000_sync_status_protect_marked_refresh.sql"
)


# ---------------------------------------------------------------------------
# Shared drivers
# ---------------------------------------------------------------------------
def _stub_status_read(ctx: MagicMock, capture: dict[str, Any], row: dict[str, Any] | None) -> None:
    """Give the harness a real ``.select().eq().maybe_single().execute()``.

    Without this the harness's bare ``MagicMock`` makes
    ``row.get('computation_status')`` another ``MagicMock``, which never equals a
    real status string — so EVERY case would route to the destructive branch and
    the protected tests would fail for a reason that has nothing to do with the
    guard. Same trap ``test_ledger_refresh_nondestructive.py`` documents.
    """
    original = ctx.supabase.table.side_effect

    def _table(name: str) -> MagicMock:
        tbl: MagicMock = original(name)

        def _select(columns: str, **_kw: object) -> MagicMock:
            chain = MagicMock()
            chain.eq.return_value = chain
            chain.maybe_single.return_value = chain
            chain.execute.return_value = MagicMock(data=row)
            return chain

        tbl.select.side_effect = _select
        return tbl

    ctx.supabase.table.side_effect = _table


def _one_day_returns() -> pd.Series:
    """A ONE-day series: fewer than the two interpretable days the factsheet
    needs, which is the `_mark_insufficient` trigger."""
    return pd.Series(
        [0.01], index=pd.DatetimeIndex(["2024-05-01"]), dtype="float64"
    )


def _analytics_payloads(capture: dict[str, Any]) -> list[dict[str, Any]]:
    return [dict(u[1]) for u in capture["upserts"] if u[0] == "strategy_analytics"]


def _series_deletes(capture: dict[str, Any]) -> list[dict[str, Any]]:
    return [d for d in capture["deletes"] if d["table"] == "strategy_analytics_series"]


def _terminal_stamp(payloads: list[dict[str, Any]]) -> dict[str, Any]:
    """The ONE strategy_analytics upsert a terminal-failure arm produces."""
    assert len(payloads) == 1, (
        "expected exactly one strategy_analytics upsert from a terminal-failure "
        f"arm; got {payloads!r}. More than one means the driver ran past the "
        "arm under test and the assertions below are aimed at the wrong write."
    )
    return payloads[0]


# ---------------------------------------------------------------------------
# CR-02 — the three sibling stamps, driven behaviourally
# ---------------------------------------------------------------------------
class TestCR02SiblingStampsAreGuarded:
    """Neuter to redden: revert any of the three routings in
    ``run_derive_broker_dailies_job`` back to its own inline
    ``ctx.supabase.table("strategy_analytics").upsert({...})`` and the matching
    ``*_protected`` test goes RED.
    """

    @pytest.mark.asyncio
    async def test_insufficient_history_unmarked_is_destructive(self) -> None:
        """CONTROL for the arm below. An unmarked <2-day derive must still write
        the authoritative clear AND delete both series rows — that is correct for
        a first compute, and it is what makes the protected assertion mean
        something."""
        combine = MagicMock(
            return_value=(
                _one_day_returns(),
                {"used_heuristic_capital": False, "series_completeness": _CCXT_VERDICT},
            )
        )
        result, capture = await _adrive(combine=combine, marked=False)

        assert result.outcome == DispatchOutcome.DONE
        payload = _terminal_stamp(_analytics_payloads(capture))
        assert payload["computation_status"] == "failed"
        assert payload["computation_warned"] is False
        assert payload["metrics_json_by_basis"] is None
        assert _series_deletes(capture), (
            "the unmarked <2-day arm must still heal-delete both basis-series "
            "rows; if it does not, the protected arm's 'no delete' assertion "
            "below is vacuous."
        )

    @pytest.mark.asyncio
    async def test_insufficient_history_marked_is_protected(self) -> None:
        """CR-02's headline. ``_mark_insufficient`` fires on <2 interpretable
        daily-return days — exactly what a logged-out MT5 terminal produces — and
        it DELETED both persisted basis-series rows. On a live funded strategy
        with years of history, one refresh tick destroyed the series."""
        combine = MagicMock(
            return_value=(
                _one_day_returns(),
                {"used_heuristic_capital": False, "series_completeness": _CCXT_VERDICT},
            )
        )
        result, capture = await _adrive(combine=combine, marked=True)

        assert result.outcome == DispatchOutcome.DONE
        payload = _terminal_stamp(_analytics_payloads(capture))
        for key in _PUBLISH_STATE_KEYS:
            assert key not in payload, (
                f"a MARKED refresh hitting the <2-day arm wrote {key!r} onto a "
                f"published row. payload={payload!r}"
            )
        assert payload.get("computation_error"), (
            "the failure must stay VISIBLE in computation_error, not vanish."
        )
        assert not _series_deletes(capture), (
            "a MARKED refresh DELETED the persisted basis-series rows. Nothing "
            "downstream can put them back — not the SQL bridge, not a later "
            "successful run. This is the half the D-15 comment calls easy to "
            "miss, and it is the single most destructive site in the handler."
        )

    @pytest.mark.asyncio
    async def test_mt5_verdict_refusal_unmarked_is_destructive(self) -> None:
        """CONTROL for the MT5-12 series-completeness refusal."""
        combine = MagicMock(
            return_value=(_two_day_returns(), {"used_heuristic_capital": False}),
        )
        result, capture = await _adrive(combine=combine, marked=False)

        assert result.outcome == DispatchOutcome.FAILED
        assert result.error_kind == "permanent"
        payload = _terminal_stamp(_analytics_payloads(capture))
        assert payload["computation_status"] == "failed"

    @pytest.mark.asyncio
    async def test_mt5_verdict_refusal_marked_is_protected(self) -> None:
        """The MT5-12 seam is MT5-specific and MT5 is 4 of the 5 live
        ledger-backed strategies, so it is the highest-frequency route by which a
        recurring refresh could have downgraded a funded account."""
        combine = MagicMock(
            return_value=(_two_day_returns(), {"used_heuristic_capital": False}),
        )
        result, capture = await _adrive(combine=combine, marked=True)

        assert result.outcome == DispatchOutcome.FAILED
        payload = _terminal_stamp(_analytics_payloads(capture))
        for key in _PUBLISH_STATE_KEYS:
            assert key not in payload, (
                f"a MARKED refusal wrote {key!r} onto a published row. "
                f"payload={payload!r}"
            )

    @pytest.mark.asyncio
    async def test_nav_reconstruction_error_unmarked_is_destructive(self) -> None:
        """CONTROL for ``_dispose_broker_nav_error``."""
        from services.nav_twr import NavReconstructionError

        combine = MagicMock(side_effect=NavReconstructionError("nav hole at day 3"))
        result, capture = await _adrive(combine=combine, marked=False)

        assert result.outcome == DispatchOutcome.FAILED
        payload = _terminal_stamp(_analytics_payloads(capture))
        assert payload["computation_status"] == "failed"

    @pytest.mark.asyncio
    async def test_nav_reconstruction_error_marked_is_protected(self) -> None:
        from services.nav_twr import NavReconstructionError

        combine = MagicMock(side_effect=NavReconstructionError("nav hole at day 3"))
        result, capture = await _adrive(combine=combine, marked=True)

        assert result.outcome == DispatchOutcome.FAILED
        payload = _terminal_stamp(_analytics_payloads(capture))
        for key in _PUBLISH_STATE_KEYS:
            assert key not in payload, (
                f"a MARKED NAV-reconstruction refusal wrote {key!r} onto a "
                f"published row. payload={payload!r}"
            )

    @pytest.mark.asyncio
    async def test_marked_but_unpublished_row_is_still_loud(self) -> None:
        """FAIL-SAFE DIRECTION. A marked refresh over a row that is NOT published
        must take the destructive path. Never fail toward suppression."""
        combine = MagicMock(
            return_value=(
                _one_day_returns(),
                {"used_heuristic_capital": False, "series_completeness": _CCXT_VERDICT},
            )
        )
        _result, capture = await _adrive(combine=combine, marked=True, published=False)

        payload = _terminal_stamp(_analytics_payloads(capture))
        assert payload["computation_status"] == "failed", (
            "a marked refresh protected a row that was NOT published; the guard "
            "has stopped consulting the row's current status."
        )


# ---------------------------------------------------------------------------
# CR-02 — the structural invariant that stops a FIFTH site reopening it
# ---------------------------------------------------------------------------
def _strip_py_comments(text: str) -> str:
    """Drop whole-line ``#`` comments, preserving line count.

    This file's rule, stated in the CR-02 gate below and now enforced at every
    positive assertion in it: **prose must never satisfy a mechanical gate.**
    Line count is preserved so offsets computed on the stripped text stay
    comparable line-for-line with the raw source.
    """
    return "\n".join(
        "" if ln.lstrip().startswith("#") else ln for ln in text.splitlines()
    )


# A "tail sentinel" is only a tail sentinel if it is actually in the tail.
# MEASURED on the region this constant exists for: inside
# ``_stamp_strategy_analytics_failed`` the prose ``# ⛔ And NO
# _heal_delete_basis_series().`` sits at fraction 0.713 of the region while the
# real terminating call sits at 0.996. Without a floor, deleting the closure's
# terminating heal — the exact regression the sentinel exists to catch — leaves
# the gate satisfied by a COMMENT.
_TAIL_SENTINEL_MIN_FRACTION = 0.9


def _region(src: str, header: str, label: str, sentinel: str) -> tuple[int, int]:
    """Line span of a nested ``async def`` / top-level ``async def``, by indent.

    Returns ``(start, end)`` line indices. ``sentinel`` must be text from the
    region's TAIL that the header CANNOT supply — a sentinel that is a substring
    of its own locator cannot fail, which is the vacuity WR-01..04 of this
    phase's review caught in five of eight sibling regions.

    The sentinel check is made three ways non-vacuous:

    * it runs COMMENT-STRIPPED, so a mention in prose cannot satisfy it;
    * it uses the LAST occurrence, so an earlier code mention cannot stand in
      for the terminating one;
    * that last occurrence must lie past ``_TAIL_SENTINEL_MIN_FRACTION`` of the
      region — the offset floor ``_assert_region`` in the sibling file already
      carries and this extractor did not.
    """
    lines = src.splitlines()
    start = next(
        (i for i, ln in enumerate(lines) if ln.strip().startswith(header)), None
    )
    assert start is not None, (
        f"could not locate {label} (`{header}`). The extraction is broken, so "
        "every assertion scoped to it proves nothing. If the function was "
        "renamed, move this extractor with it — do not delete the gate."
    )
    indent = len(lines[start]) - len(lines[start].lstrip())
    end = len(lines)
    for i in range(start + 1, len(lines)):
        if not lines[i].strip():
            continue
        if len(lines[i]) - len(lines[i].lstrip()) <= indent:
            end = i
            break
    body = "\n".join(lines[start:end])
    # Structure was read from the RAW source (indentation is structure); the
    # positive assertion below runs against code only.
    code = _strip_py_comments(body)
    assert sentinel in code, (
        f"ANTI-VACUITY: the extracted {label} does not contain its tail sentinel "
        f"{sentinel!r} in CODE (comments stripped), so the extraction landed on "
        f"the wrong text, stopped short, or the sentinel now survives only as "
        f"prose. Region began: {body[:200]!r}"
    )
    offset = code.rindex(sentinel)
    floor = int(len(code) * _TAIL_SENTINEL_MIN_FRACTION)
    assert offset >= floor, (
        f"ANTI-VACUITY: the last CODE occurrence of tail sentinel {sentinel!r} "
        f"in {label} is at offset {offset} of {len(code)} (fraction "
        f"{offset / max(len(code), 1):.3f}), before the required tail floor "
        f"{floor}. Either the extraction is overrunning the region, or the "
        f"terminating statement this sentinel pins has been deleted and only an "
        f"earlier mention is holding the gate up. Do not lower the floor to make "
        f"this pass — that is the vacuity, not the fix."
    )
    return start, end


class TestCR02OneChokePoint:
    """The invariant, not the tidiness preference.

    Neuter to redden: give any one of the three routed sites its own inline
    ``"computation_status": "failed"`` payload again.
    """

    def test_only_the_guarded_closure_writes_a_terminal_failed(self) -> None:
        src = _JOB_WORKER.read_text()
        fn_start, fn_end = _region(
            src,
            "async def run_derive_broker_dailies_job",
            "run_derive_broker_dailies_job",
            # Tail sentinel: the chain-edge enqueue, ~3000 lines below the
            # header and unobtainable from it.
            "_enqueue_csv_analytics",
        )
        guard_start, guard_end = _region(
            src,
            "async def _stamp_strategy_analytics_failed",
            "the _stamp_strategy_analytics_failed choke point",
            # Tail sentinel: the D3-SECONDARY heal call that closes the closure.
            #
            # ⚠️ `await` is part of the sentinel, and that is F18, measured. The
            # bare spelling `_heal_delete_basis_series()` also occurs at
            # fraction 0.713 of this region inside the comment `# ⛔ And NO
            # _heal_delete_basis_series().`, so deleting the closure's real
            # terminating call left the gate satisfied by PROSE. The sibling
            # file's `_assert_region` already pinned the awaited form for this
            # exact reason; this one did not.
            "await _heal_delete_basis_series()",
        )
        assert fn_start < guard_start and guard_end <= fn_end, (
            "the choke point is no longer nested inside the handler; the "
            "containment assertion below would be comparing unrelated spans."
        )

        lines = src.splitlines()
        needle = '"computation_status": "failed"'
        # Comment lines are excluded: a commented-out payload is not a write,
        # and this repo's convention is that prose must never satisfy or trip a
        # mechanical gate. (Measured — the CR-02 note above the choke point
        # described the invariant and turned this gate RED against a correct
        # file. The note was reworded AND this filter added; either alone would
        # have left the next author to rediscover it.)
        hits = [
            i
            for i in range(fn_start, fn_end)
            if needle in lines[i] and not lines[i].lstrip().startswith("#")
        ]
        assert hits, (
            f"found no {needle} anywhere in run_derive_broker_dailies_job. The "
            "extraction is broken, or the payload was respelled — either way "
            "this gate is proving nothing right now."
        )
        stray = [i + 1 for i in hits if not (guard_start <= i < guard_end)]
        assert not stray, (
            "CR-02 REOPENED: run_derive_broker_dailies_job writes a terminal "
            f"computation_status='failed' outside `_stamp_strategy_analytics_"
            f"failed` at line(s) {stray}. That closure is the ONLY place the "
            "D-15 non-destructive guard and the D3-SECONDARY series heal live, "
            "so a stamp spelled anywhere else is an UNGUARDED publish-state "
            "downgrade — which is exactly the defect CR-02 recorded (three of "
            "four sites unguarded, one of them deleting both basis-series rows)."
        )


# ---------------------------------------------------------------------------
# CR-03 — the chain edge
# ---------------------------------------------------------------------------
class TestCR03ChainEdgeCarriesTheMarker:
    """Neuter to redden: drop the ``p_metadata`` key from ``_enqueue_csv_analytics``."""

    @staticmethod
    def _enqueue_metadata(capture: dict[str, Any]) -> dict[str, Any] | None:
        calls = [c for c in capture["rpc_calls"] if c[0] == "enqueue_compute_job"]
        assert len(calls) == 1, (
            "expected exactly one enqueue_compute_job RPC (the chained analytics "
            f"hop); got {capture['rpc_calls']!r}. If the derive did not reach its "
            "chain edge, the assertions below are aimed at nothing."
        )
        payload = calls[0][1]
        assert payload["p_kind"] == "compute_analytics_from_csv"
        meta = payload.get("p_metadata")
        return dict(meta) if isinstance(meta, dict) else None

    @pytest.mark.asyncio
    async def test_marked_derive_forwards_the_marker_to_hop_two(self) -> None:
        combine = MagicMock(
            return_value=(
                _two_day_returns(),
                {"used_heuristic_capital": False, "series_completeness": _CCXT_VERDICT},
            )
        )
        result, capture = await _adrive(combine=combine, marked=True)
        assert result.outcome == DispatchOutcome.DONE

        meta = self._enqueue_metadata(capture)
        assert meta is not None and meta.get("source") == _MARKER, (
            "hop 2 of a MARKED refresh carries no source. Hop 2 is where the "
            "factsheet is compiled and analytics_runner stamps 'failed' at five "
            "sites; without the marker every D-15-shaped guard — the runner's "
            "and the SQL bridge's — is structurally blind to it."
        )
        assert meta.get("chained_from") == "derive_broker_dailies"

    @pytest.mark.asyncio
    async def test_unmarked_derive_forwards_nothing(self) -> None:
        """CONTROL. A user-initiated derive's follow-on must stay unmarked, or
        the wizard poller loses its terminal gate on hop 2."""
        combine = MagicMock(
            return_value=(
                _two_day_returns(),
                {"used_heuristic_capital": False, "series_completeness": _CCXT_VERDICT},
            )
        )
        _result, capture = await _adrive(combine=combine, marked=False)
        assert self._enqueue_metadata(capture) is None

    @pytest.mark.asyncio
    async def test_unrecognised_source_is_not_forwarded(self) -> None:
        """FAIL-SAFE DIRECTION at the chain edge: forward only a RECOGNISED
        marker. A job carrying some other provenance string must not inherit the
        refresh protections on hop 2."""
        ctx, capture = _build_ctx(
            key_row={"id": "key-1", "exchange": "binance", "user_id": "user-1"},
            strategy_row={"id": _STRATEGY_ID, "user_id": "user-1"},
        )
        _stub_status_read(ctx, capture, {"computation_status": "complete_with_warnings"})
        job = {
            "id": "job-1",
            "kind": "derive_broker_dailies",
            "strategy_id": _STRATEGY_ID,
            "metadata": {"source": "wizard"},
        }
        combine = MagicMock(
            return_value=(
                _two_day_returns(),
                {"used_heuristic_capital": False, "series_completeness": _CCXT_VERDICT},
            )
        )
        patches = _patches_with_combine(ctx, key_mode=False, combine_mock=combine)
        with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6]:
            await run_derive_broker_dailies_job(job)

        assert self._enqueue_metadata(capture) is None, (
            "an unrecognised metadata source was forwarded to hop 2. The "
            "forward must be allow-listed against LEDGER_REFRESH_JOB_SOURCES."
        )


class TestCR03HandlerThreadsTheMarker:
    """The wiring seam. Neuter to redden: drop the ``refresh_source=`` kwarg
    from ``run_compute_analytics_from_csv_job``'s call.

    Testing the runner's guard is NOT the same as testing that the handler
    INVOKES it with the marker — this repo has been bitten by exactly that gap.
    """

    @pytest.mark.asyncio
    async def test_marked_job_threads_the_marker_into_the_runner(self) -> None:
        seen: dict[str, Any] = {}

        async def _fake(strategy_id: str, **kw: Any) -> dict[str, Any]:
            seen["strategy_id"] = strategy_id
            seen["kw"] = kw
            return {"status": "complete"}

        with patch("services.analytics_runner.run_csv_strategy_analytics", new=_fake):
            result = await run_compute_analytics_from_csv_job(
                {"strategy_id": "s1", "metadata": {"source": _COMPOSITE_MARKER}}
            )

        assert result.outcome == DispatchOutcome.DONE
        assert seen["kw"].get("refresh_source") == _COMPOSITE_MARKER

    @pytest.mark.asyncio
    async def test_unmarked_job_threads_none(self) -> None:
        seen: dict[str, Any] = {}

        async def _fake(strategy_id: str, **kw: Any) -> dict[str, Any]:
            seen["kw"] = kw
            return {"status": "complete"}

        with patch("services.analytics_runner.run_csv_strategy_analytics", new=_fake):
            await run_compute_analytics_from_csv_job(
                {"strategy_id": "s1", "metadata": {"source": "wizard"}}
            )
        assert seen["kw"].get("refresh_source") is None


# ---------------------------------------------------------------------------
# CR-03 — hop 2's own guard, inside analytics_runner
# ---------------------------------------------------------------------------
def _runner_supabase(
    rows: list[dict[str, Any]], *, existing_status: str | None
) -> MagicMock:
    """A supabase mock that distinguishes the runner's THREE maybe_single reads
    by the columns they select, so the publish snapshot is a real read rather
    than a MagicMock that can never match a status string.

    ⛔ STATEFUL, AND THAT IS THE POINT (F15). The first version of this fake
    answered every ``computation_status`` read with the canned ``existing_status``
    no matter what the runner had already WRITTEN. A fake like that cannot
    observe an ordering bug: move the publish-snapshot read below
    ``_mark_computing`` — the single regression that makes the whole hop-2 guard
    permanently inert — and it keeps handing back 'complete_with_warnings', so
    every behavioural test in this class stays green while production is broken.
    A ``strategy_analytics`` write now UPDATES what the next read returns, which
    is what makes ``test_marked_insufficient_history_preserves_publish_state``
    (and its siblings) able to fail on that regression at all: after
    ``_mark_computing`` the row really does read 'computing', the snapshot really
    does come back None, and the marked cases really do go destructive. Measured
    RED that way.
    """
    sb = MagicMock()
    table_mock = MagicMock()
    sb.table.return_value = table_mock

    # The row this fake actually holds: `dict[str, Any] | None`, left unannotated
    # because mypy --strict forbids declaring a type on a non-self attribute.
    sb.row = (
        None
        if existing_status is None
        else {
            "computation_status": existing_status,
            "computation_warned": existing_status == "complete_with_warnings",
        }
    )

    def _select(columns: str, *_a: object, **_kw: object) -> MagicMock:
        chain = MagicMock()
        chain.eq.return_value = chain
        chain.order.return_value = chain
        chain.range.return_value = chain
        chain.single.return_value = chain
        chain.maybe_single.return_value = chain
        if "computation_status" in columns:
            data: Any = None if sb.row is None else dict(sb.row)
        elif "data_quality_flags" in columns:
            data = {"data_quality_flags": {"csv_source": True}}
        elif "daily_return" in columns:
            data = rows
        else:
            data = {"id": "s1", "user_id": "u1"}
        chain.execute.return_value = MagicMock(data=data)
        return chain

    table_mock.select.side_effect = _select

    sb.upserts = []
    sb.deletes = []

    def _upsert(payload: dict[str, Any], **_kw: object) -> MagicMock:
        sb.upserts.append(dict(payload))
        # Apply the write, so a later read sees what this run actually did.
        row = dict(sb.row) if sb.row is not None else {}
        for column in ("computation_status", "computation_warned"):
            if column in payload:
                row[column] = payload[column]
        sb.row = row or None
        return MagicMock(execute=MagicMock(return_value=MagicMock(data=[])))

    def _delete(**_kw: object) -> MagicMock:
        record: dict[str, Any] = {"filters": {}}
        sb.deletes.append(record)
        chain = MagicMock()
        chain.eq.side_effect = lambda c, v: (record["filters"].__setitem__(c, v), chain)[1]
        chain.execute.return_value = MagicMock(data=[])
        return chain

    table_mock.upsert.side_effect = _upsert
    table_mock.delete.side_effect = _delete
    sb.rpc.return_value = MagicMock(execute=MagicMock(return_value=MagicMock(data=[])))
    return sb


class TestCR03RunnerGuard:
    """Neuter to redden: make ``_guarded_failure_payload`` the identity
    function, or move the publish snapshot BELOW ``_mark_computing``.

    ⛔ That second neutering is the one worth understanding. ``_mark_computing``
    writes ``computation_status='computing'`` unconditionally, so a snapshot
    taken after it can never read a terminal-success status and the guard is
    permanently, invisibly inert — a guard that looks right in review and
    protects nothing.

    ⚠️ This docstring used to claim ``test_snapshot_is_taken_before_mark_
    computing`` was "the only thing standing between this file and that". It was
    not standing between anything (F15): it compared the two ``def`` offsets,
    which the regression does not move, and the ``_runner_supabase`` fake
    answered every status read with a canned value regardless of what had been
    written — so neither the structural gate nor any behavioural test could see
    it. TWO independent detectors now do: that gate compares the two
    ``db_execute(...)`` CALL sites, and the fake is stateful, so the marked
    cases below genuinely go destructive once the snapshot is read too late.
    """

    @staticmethod
    def _terminal(sb: MagicMock) -> dict[str, Any]:
        failed = [
            u for u in sb.upserts
            if u.get("computation_status") != "computing"
            and u.get("computation_error") is not None
        ]
        assert failed, f"expected a terminal-failure upsert; got {sb.upserts!r}"
        payload: dict[str, Any] = failed[-1]
        return payload

    @pytest.mark.asyncio
    async def test_unmarked_insufficient_history_is_destructive(self) -> None:
        """CONTROL."""
        from services.analytics_runner import run_csv_strategy_analytics
        from fastapi import HTTPException

        sb = _runner_supabase(
            [{"date": "2024-01-01", "daily_return": 0.005}],
            existing_status="complete_with_warnings",
        )
        with patch("services.analytics_runner.get_supabase", return_value=sb):
            with pytest.raises(HTTPException):
                await run_csv_strategy_analytics("s1")

        payload = self._terminal(sb)
        assert payload["computation_status"] == "failed"
        assert payload["computation_warned"] is False

    @pytest.mark.asyncio
    async def test_marked_insufficient_history_preserves_publish_state(self) -> None:
        from services.analytics_runner import run_csv_strategy_analytics
        from fastapi import HTTPException

        sb = _runner_supabase(
            [{"date": "2024-01-01", "daily_return": 0.005}],
            existing_status="complete_with_warnings",
        )
        with patch("services.analytics_runner.get_supabase", return_value=sb):
            with pytest.raises(HTTPException):
                await run_csv_strategy_analytics("s1", refresh_source=_MARKER)

        payload = self._terminal(sb)
        assert payload["computation_status"] == "complete_with_warnings", (
            "hop 2 of a MARKED refresh un-published a funded account. The "
            "publish state must be RESTORED, not merely omitted: _mark_computing "
            "has already downgraded the row to 'computing' by this point, so an "
            "omitted status leaves a live factsheet parked there — and the SQL "
            "bridge's protection predicate keys on a PUBLISHED status, so the "
            "row would not be protected there either."
        )
        assert payload["computation_warned"] is True
        assert "data_quality_flags" not in payload, (
            "the wholesale {csv_source: True} rebuild would destroy the "
            "NAV_TWR_GUARD_KEYS the derive pre-stamped — the laundering class "
            "migration 20260707120000 closed."
        )
        assert payload.get("computation_error"), "the failure must stay visible"

    @pytest.mark.asyncio
    async def test_marked_over_unpublished_row_is_still_loud(self) -> None:
        """FAIL-SAFE DIRECTION on hop 2.

        ⚠️ The seed status is 'computing', NOT 'failed', and that was MEASURED.
        With 'failed', "the guard refused to protect" and "the guard protected
        and restored the snapshot" produce the SAME final status, so this
        assertion passed under a neutering that made the snapshot accept ANY
        status at all — the one green in an otherwise all-red falsifiability
        sweep. A fail-safe test whose two outcomes are indistinguishable is not
        a test. 'computing' is also the realistic shape: it is what
        ``_mark_computing`` leaves on a strategy that was never published.
        """
        from services.analytics_runner import run_csv_strategy_analytics
        from fastapi import HTTPException

        sb = _runner_supabase(
            [{"date": "2024-01-01", "daily_return": 0.005}],
            existing_status="computing",
        )
        with patch("services.analytics_runner.get_supabase", return_value=sb):
            with pytest.raises(HTTPException):
                await run_csv_strategy_analytics("s1", refresh_source=_MARKER)

        payload = self._terminal(sb)
        assert payload["computation_status"] == "failed", (
            "a marked refresh protected a row that was NOT published (it read "
            f"'computing'); the terminal stamp wrote "
            f"{payload['computation_status']!r}. The snapshot has stopped "
            "gating on the terminal-success pair, so a FIRST compute that fails "
            "now leaves the wizard poller spinning forever."
        )
        assert payload["computation_warned"] is False

    @pytest.mark.asyncio
    async def test_marked_catch_all_skips_the_cash_series_delete(self) -> None:
        """The catch-all arm heal-DELETEs the cash_settlement series row. On a
        protected refresh nothing downstream can put that back."""
        from services.analytics_runner import run_csv_strategy_analytics
        from fastapi import HTTPException

        rows = [
            {"date": "2024-01-01", "daily_return": 0.005},
            {"date": "2024-01-02", "daily_return": -0.003},
            {"date": "2024-01-03", "daily_return": 0.008},
        ]

        async def _run(marker: str | None) -> MagicMock:
            sb = _runner_supabase(rows, existing_status="complete_with_warnings")
            with patch("services.analytics_runner.get_supabase", return_value=sb), \
                 patch("services.analytics_runner.get_benchmark_returns",
                       new=AsyncMock(return_value=(None, True))), \
                 patch("services.basis_series.derive_basis_series",
                       side_effect=RuntimeError("metrics blew up")):
                with pytest.raises(HTTPException):
                    await run_csv_strategy_analytics("s1", refresh_source=marker)
            return sb

        unmarked = await _run(None)
        assert unmarked.deletes, (
            "the UNMARKED catch-all must still heal-delete the cash series; "
            "without that the marked assertion below is vacuous."
        )

        marked = await _run(_MARKER)
        assert not marked.deletes, (
            "a MARKED refresh deleted the live cash_settlement series row on its "
            "catch-all path."
        )

    def test_snapshot_is_taken_before_mark_computing(self) -> None:
        """ORDERING IS THE MECHANISM — see this class's docstring."""
        # ⛔ CALL SITES, NOT DEFINITIONS — this is F15, and the version of this
        # gate that compared `_read_publish_snapshot` (which resolves to its
        # `def`) against `def _mark_computing()` could not fail. Both closures
        # are DEFINED adjacently and then INVOKED further down; the hazard is
        # moving the snapshot's `await db_execute(...)` below the mark's. That
        # leaves both `def` offsets exactly where they were, so the old gate
        # stayed GREEN while in production `_mark_computing` had already written
        # 'computing', every snapshot read returned None, and the entire hop-2
        # guard was permanently, invisibly inert. Measured RED against the moved
        # CALL after this change; the old comparison was measured GREEN against
        # the same mutation.
        #
        # Comment-stripped, per this file's rule: a comment naming either call
        # must not be able to move — or hold up — this gate.
        src = _strip_py_comments(
            (_REPO_ROOT / "analytics-service" / "services" / "analytics_runner.py")
            .read_text()
        )
        snapshot_call = "db_execute(_read_publish_snapshot)"
        mark_call = "db_execute(_mark_computing)"
        for needle in (snapshot_call, mark_call):
            assert src.count(needle) == 1, (
                f"expected exactly ONE `{needle}` call site in "
                f"analytics_runner.py; found {src.count(needle)}. With zero the "
                "ordering assertion below is aimed at nothing; with more than "
                "one it is ambiguous about which pair it ordered. Re-point this "
                "gate deliberately — do not delete it."
            )
        snapshot = src.index(snapshot_call)
        mark_computing = src.index(mark_call)
        assert snapshot < mark_computing, (
            "the publish snapshot is READ at or after _mark_computing is CALLED, "
            "and _mark_computing writes computation_status='computing' "
            "unconditionally. Every subsequent read answers 'computing', never a "
            "terminal-success status, so the hop-2 guard can never fire — while "
            "still looking like a guard in review."
        )


class TestF3BudgetTimeoutLeavesNoParkedFactsheet:
    """F3 — the hole the ``except Exception`` arms cannot see.

    The worker runs every handler under ``asyncio.wait_for(handler(job),
    timeout=...)``. Expiry cancels the handler with ``CancelledError``, a
    **BaseException**: none of the runner's five guarded terminal stamps fire, so
    without an explicit arm the run exits with ``_mark_computing``'s
    ``'computing'`` still on the row. The SQL bridge then reads that row, sees a
    non-published status, refuses to protect it and writes ``'failed'`` — the
    factsheet goes dark on a recurring, unattended refresh.

    These tests drive the REAL mechanism (an actual ``asyncio.wait_for`` expiry
    against a hanging step) and assert the ROW'S END STATE, not that a handler
    was entered.

    Neuter to redden: make ``_restore_publish_state_on_abort`` a no-op (measured
    RED), or delete BOTH abort arms from ``run_csv_strategy_analytics`` — which
    is the pre-fix baseline and reproduces the audit's finding exactly, the row
    ending at ``'computing'`` (measured RED). Deleting only the
    ``except asyncio.CancelledError`` arm does NOT redden it: the
    ``except BaseException`` arm at the bottom catches the same cancellation.
    That redundancy is deliberate — the named arm documents the measured case,
    the broad arm closes the class.
    """

    _ROWS = [
        {"date": "2024-01-01", "daily_return": 0.005},
        {"date": "2024-01-02", "daily_return": -0.003},
        {"date": "2024-01-03", "daily_return": 0.008},
    ]

    @staticmethod
    async def _cancel_mid_run(sb: MagicMock, marker: str | None) -> None:
        """Run the real handler under a real budget that expires mid-compute."""
        from services.analytics_runner import run_csv_strategy_analytics

        async def _hang(*_a: object, **_kw: object) -> Any:
            await asyncio.sleep(30)

        with patch("services.analytics_runner.get_supabase", return_value=sb), \
             patch("services.analytics_runner.get_benchmark_returns", new=_hang):
            with pytest.raises(asyncio.TimeoutError):
                await asyncio.wait_for(
                    run_csv_strategy_analytics("s1", refresh_source=marker),
                    timeout=0.1,
                )

    @pytest.mark.asyncio
    async def test_unmarked_budget_timeout_still_leaves_the_row_computing(self) -> None:
        """CONTROL, and a deliberate statement of scope.

        A user-initiated compute that blows its budget is ATTENDED — the wizard
        poller is watching and the 16-hour reaper owns the stuck row. The runbook
        is explicit that no third mechanism may race them, so the restore must
        NOT fire here. This case also proves the marked assertion below is not
        passing because the driver failed to reach ``_mark_computing``: the row
        demonstrably moved to 'computing' on this identical path.
        """
        sb = _runner_supabase(self._ROWS, existing_status="complete_with_warnings")
        await self._cancel_mid_run(sb, None)

        assert sb.row == {"computation_status": "computing", "computation_warned": True}, (
            "the unmarked budget timeout did not even reach _mark_computing "
            f"(row={sb.row!r}); the marked case below would then be asserting "
            "against a run that never happened."
        )
        assert not [
            u for u in sb.upserts
            if u.get("computation_status") == "complete_with_warnings"
        ], "an UNMARKED cancellation restored a publish state it must not touch"

    @pytest.mark.asyncio
    async def test_marked_budget_timeout_restores_the_published_state(self) -> None:
        sb = _runner_supabase(self._ROWS, existing_status="complete_with_warnings")
        await self._cancel_mid_run(sb, _MARKER)

        assert sb.row is not None
        assert sb.row["computation_status"] == "complete_with_warnings", (
            "hop 2 of a MARKED refresh was killed by the worker's per-job budget "
            f"and left the row at {sb.row['computation_status']!r}. CancelledError "
            "is a BaseException, so none of the five guarded terminal stamps ran "
            "and _mark_computing's 'computing' is still standing. The SQL bridge "
            "(20260825150000) protects only a PUBLISHED status, so it will refuse "
            "this row and write 'failed' — strategyGate reads that as "
            "ANALYTICS_FAILED and the live factsheet goes dark."
        )
        assert sb.row["computation_warned"] is True

        restore = sb.upserts[-1]
        assert restore["computing_started_at"] is None, (
            "the restore left computing_started_at set, which re-arms "
            "reap_strategy_analytics_stuck_computing against a row that is no "
            "longer computing."
        )
        assert restore.get("computation_error"), (
            "the abort was made INVISIBLE. Protected is not the same as silent — "
            "computation_error is one of the four places this failure is supposed "
            "to remain readable."
        )
        assert "data_quality_flags" not in restore, (
            "the restore rebuilt data_quality_flags, which on a live row destroys "
            "the NAV_TWR_GUARD_KEYS the derive pre-stamped (the laundering class "
            "migration 20260707120000 closed)."
        )

    @pytest.mark.asyncio
    async def test_marked_budget_timeout_over_unpublished_row_stays_loud(self) -> None:
        """FAIL-SAFE DIRECTION on the abort path.

        A marked refresh over a row that was never published has nothing to
        restore. It must NOT invent a green state — it must leave the loud
        terminal decision to the bridge.
        """
        sb = _runner_supabase(self._ROWS, existing_status="computing")
        await self._cancel_mid_run(sb, _MARKER)

        assert sb.row == {"computation_status": "computing", "computation_warned": False}
        assert not [u for u in sb.upserts if u.get("computation_error")], (
            "a marked refresh over an UNPUBLISHED row wrote a restore payload. "
            "The snapshot must have been None, so nothing may be written here — "
            "suppressing the bridge's loud 'failed' would hang the wizard poller "
            "on an infinite spinner."
        )


class TestRegionExtractorRejectsProseSentinels:
    """F18, as a property of the extractor rather than a fact about one file.

    ⚠️ Proven against SYNTHETIC sources on purpose. The regression this guards
    is "delete the terminating call from ``job_worker.py``", and that file is
    owned by another change in flight; mutating a shared file to witness RED is
    how two agents corrupt each other's work. A synthetic source exercises the
    identical code path and, unlike a one-off mutation probe, keeps the property
    asserted forever.
    """

    _SRC = "\n".join(
        [
            "async def _victim() -> None:",
            "    do_something()",
            "    # ⛔ And NO _heal_delete_basis_series(). This is the point.",
            *["    filler()"] * 40,
            "    await _heal_delete_basis_series()",
            "",
            "def _next() -> None:",
            "    pass",
        ]
    )

    def test_real_tail_call_is_accepted(self) -> None:
        """CONTROL — without this, the two rejections below could be passing "
        because the extractor rejects everything."""
        start, end = _region(
            self._SRC, "async def _victim", "the victim", "await _heal_delete_basis_series()"
        )
        body = "\n".join(self._SRC.splitlines()[start:end])
        assert "await _heal_delete_basis_series()" in body
        assert "def _next" not in body, "the region overran into the next function"

    def test_prose_only_sentinel_is_rejected(self) -> None:
        """The F18 regression verbatim: the terminating call is gone, the
        comment naming it survives."""
        gutted = self._SRC.replace("    await _heal_delete_basis_series()\n", "")
        with pytest.raises(AssertionError, match="in CODE"):
            _region(gutted, "async def _victim", "the victim", "await _heal_delete_basis_series()")

    def test_code_sentinel_outside_the_tail_is_rejected(self) -> None:
        """The offset floor, independent of comments: an EARLY code mention
        cannot stand in for the terminating one."""
        early = self._SRC.replace(
            "    # ⛔ And NO _heal_delete_basis_series(). This is the point.",
            "    await _heal_delete_basis_series()",
        ).replace("    await _heal_delete_basis_series()\n\ndef _next", "\ndef _next")
        with pytest.raises(AssertionError, match="tail floor"):
            _region(early, "async def _victim", "the victim", "await _heal_delete_basis_series()")


# ---------------------------------------------------------------------------
# The cross-language marker contract
# ---------------------------------------------------------------------------
def _sql_function_body(path: Path) -> str:
    """The dollar-quoted body only, with ``--`` comments stripped.

    Scoped rather than whole-file because this migration's HEADER discusses the
    markers at length; a whole-file scan would match the prose and pass against
    a body that had lost them.
    """
    src = path.read_text()
    match = re.search(r"AS \$\$(.*?)\$\$;", src, re.DOTALL)
    assert match is not None, (
        f"{path.name} has no `AS $$ … $$;` function body. The extraction is "
        "broken and the drift gate below proves nothing."
    )
    body = match.group(1)
    stripped = "\n".join(re.sub(r"--.*$", "", ln) for ln in body.splitlines())
    assert "v_publish_healthy" in stripped, (
        "ANTI-VACUITY: the extracted SQL body does not contain the CR-01 health "
        "conjunct, so the extraction landed on the wrong statement."
    )
    return stripped


class TestMarkerContractHasNoFifthSpelling:
    """Four ends, no compiler between any of them. Neuter to redden: change one
    literal at any single end."""

    def test_consumer_set_matches_both_python_guards(self) -> None:
        # Comments stripped first: this file's own prose discusses the
        # contract, and prose must never satisfy a mechanical gate. (Measured —
        # the LEDGER_REFRESH_JOB_SOURCES header described the comparisons and
        # this gate counted three "guards", one of them an ellipsis.)
        src = "\n".join(
            ln for ln in _JOB_WORKER.read_text().splitlines()
            if not ln.lstrip().startswith("#")
        )
        guards = set(re.findall(r'job_source\s*==\s*"([^"]*)"', src))
        assert len(guards) == 2, (
            "expected exactly TWO inline `job_source == \"<marker>\"` guard "
            f"comparisons in services/job_worker.py (single-key + composite); "
            f"found {sorted(guards)}."
        )
        assert guards == set(LEDGER_REFRESH_JOB_SOURCES), (
            "MARKER DRIFT: LEDGER_REFRESH_JOB_SOURCES is "
            f"{sorted(LEDGER_REFRESH_JOB_SOURCES)} but the two inline guards "
            f"compare against {sorted(guards)}. The set decides what gets "
            "forwarded to hop 2; the guards decide what is protected. If they "
            "disagree, a refresh is marked at hop 1 and unprotected at hop 2 — "
            "and nothing anywhere errors."
        )

    def test_no_marker_literal_anywhere_in_the_runner(self) -> None:
        """F20 — the scan above names ``services/job_worker.py`` BY HAND, so a
        fifth spelling anywhere else was seen by nothing.

        ``analytics_runner`` is hop 2's end of the contract and receives the
        marker as a parameter; it must never hard-code one. A literal appearing
        here is either a fifth spelling or a bypass of ``refresh_source``.
        """
        src = _strip_py_comments(_ANALYTICS_RUNNER.read_text())
        literals = set(_MARKER_LITERAL_RE.findall(src))
        assert literals <= set(LEDGER_REFRESH_JOB_SOURCES), (
            "MARKER DRIFT: analytics_runner.py hard-codes ledger-refresh marker "
            f"literal(s) {sorted(literals - set(LEDGER_REFRESH_JOB_SOURCES))} that "
            "are not in LEDGER_REFRESH_JOB_SOURCES. Hop 2's guard keys on the "
            "refresh_source it was HANDED; a literal spelled here is a second, "
            "uncompared end of the contract."
        )

    def test_every_migration_writing_the_marker_uses_a_known_spelling(self) -> None:
        """F20 — the ENQUEUE end. Migrations 20260825130000/140000 build the
        job metadata with ``jsonb_build_object('source', 'ledger-refresh'…)``.

        That is where the marker is MINTED. A typo there is invisible to every
        gate in this phase: hop 1 enqueues a job the Python set does not
        recognise, nothing is forwarded to hop 2, no guard anywhere fires, and
        no error is raised at any end. Scanning the whole migrations directory
        (not a hand-listed pair) is the point — the next migration to mint a
        marker is caught the day it lands.
        """
        # Every `'source', '<value>'` pair any migration mints, not a hand-listed
        # pair of files. Scoped to the metadata KEY rather than to bare marker
        # literals because SQL object names legitimately contain the words
        # (`ledger_refresh_staleness`, `ledger_refresh_fanout`), and a gate that
        # tripped on those would be turned off within a week.
        minted: dict[str, set[str]] = {}
        for path in sorted(_MIGRATIONS_DIR.glob("*.sql")):
            body = "\n".join(
                re.sub(r"--.*$", "", ln) for ln in path.read_text().splitlines()
            )
            for value in re.findall(r"'source'\s*,\s*'([^']*)'", body):
                minted.setdefault(value, set()).add(path.name)

        refresh_like = {
            value for value in minted
            if re.match(r"[Ll]edger[-_ ]?[Rr]efresh", value)
        }
        # EQUALITY, not containment — and that is what makes a TYPO visible. A
        # fifth spelling adds a member; a mistyped one both adds a member and
        # removes the member it was supposed to be. Containment would only ever
        # have caught the first.
        assert refresh_like == set(LEDGER_REFRESH_JOB_SOURCES), (
            "MARKER DRIFT at the ENQUEUE end. The migrations mint ledger-refresh "
            f"job metadata with source(s) {sorted(refresh_like)} "
            f"(from {sorted({f for v in refresh_like for f in minted[v]})}), but "
            f"LEDGER_REFRESH_JOB_SOURCES is "
            f"{sorted(LEDGER_REFRESH_JOB_SOURCES)}. This is where the marker is "
            "MINTED: a job enqueued with an unrecognised source is not forwarded "
            "to hop 2, no guard at any end fires, and nothing anywhere errors. "
            f"All source values seen across the migrations: {sorted(minted)}."
        )

    def test_sql_bridge_partition_matches_the_python_set(self) -> None:
        body = _sql_function_body(_BRIDGE_MIGRATION)
        markers = set(
            re.findall(r"'(ledger-refresh(?:-[a-z]+)?)'", body)
        )
        assert markers == set(LEDGER_REFRESH_JOB_SOURCES), (
            "MARKER DRIFT (CR-01/CR-03): migration 20260825150000's branch (b) "
            f"partition keys on {sorted(markers)} but the worker's set is "
            f"{sorted(LEDGER_REFRESH_JOB_SOURCES)}. The arm whose marker is "
            "missing from the SQL side is un-published by the bridge no matter "
            "what the Python guard does — which is CR-01 verbatim."
        )


# ---------------------------------------------------------------------------
# Driver shim
# ---------------------------------------------------------------------------
async def _adrive(
    *, combine: MagicMock, marked: bool, published: bool = True
) -> tuple[Any, dict[str, Any]]:
    """Async twin of ``_drive_derive`` — awaits the handler on the running loop
    instead of creating a second one."""
    ctx, capture = _build_ctx(
        key_row={"id": "key-1", "exchange": "binance", "user_id": "user-1"},
        strategy_row={"id": _STRATEGY_ID, "user_id": "user-1"},
    )
    _stub_status_read(
        ctx,
        capture,
        {"computation_status": "complete_with_warnings"}
        if published
        # ⚠️ 'computing', not 'failed'. See the hop-2 twin of this case in
        # TestCR03RunnerGuard for why an unpublished fixture must differ from
        # the destructive stamp's OWN output, or the guarded and unguarded
        # outcomes coincide and the assertion cannot fail.
        else {"computation_status": "computing"},
    )
    job: dict[str, Any] = {
        "id": "job-1",
        "kind": "derive_broker_dailies",
        "strategy_id": _STRATEGY_ID,
    }
    if marked:
        job["metadata"] = {"source": _MARKER, "enqueued_at": "2026-08-25T00:00:00Z"}

    patches = _patches_with_combine(ctx, key_mode=False, combine_mock=combine)
    with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6]:
        result = await run_derive_broker_dailies_job(job)
    return result, capture
