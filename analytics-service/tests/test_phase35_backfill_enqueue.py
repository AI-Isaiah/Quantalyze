"""Tests for analytics-service/scripts/phase35_backfill_enqueue.py (DAILIES-03).

Mirrors test_phase12_backfill_enqueue.py. The contract:
  - one api_key-scoped derive_broker_dailies job per ACTIVE CONNECTED key
    (is_active=true, sync_status IS DISTINCT FROM 'revoked' INCLUDING NULL,
    disconnected_at IS NULL) — role-agnostic;
  - idempotent re-run (pre-check pending → 0 enqueued, no INSERT);
  - fail loud: count-None → RuntimeError, data-None → RuntimeError, malformed
    rows → skipped + non-zero exit, 23505 race → atomic rollback + non-zero exit;
  - never set strategy_id (coherence requires it NULL for the api_key arm).

The NULL-sync_status inclusion is load-bearing: the predicate must use
``.or_("sync_status.is.null,sync_status.neq.revoked")`` (a plain .neq drops
NULLs and would skip never-synced active keys). The select-chain mock records
the filters applied so the test pins that the OR filter was emitted.
"""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from scripts import phase35_backfill_enqueue as bf

# Sentinel to distinguish "caller did not pass keys_data" (use the n_keys
# default) from "caller explicitly passed None" (PostgREST query failure).
_DEFAULT = object()


def _make_supabase(
    *,
    pending_count: int | None = 0,
    n_keys: int = 3,
    keys_data: object = _DEFAULT,
    bulk_insert_effect: object | None = None,
) -> tuple[MagicMock, dict]:
    """Build a chained MagicMock mimicking the supabase client API.

    Returns ``(supabase, capture)`` recording:
      - ``capture['insert_calls']`` / ``capture['insert_payloads']``;
      - ``capture['precheck_filters']``: filter calls on the compute_jobs
        pre-check (to prove the api_key_id-NOT-NULL guard);
      - ``capture['keys_filters']``: filter calls on the api_keys select (to
        prove the active/or-revoked/disconnected predicate, incl. the OR).
    """
    supabase = MagicMock()
    capture: dict = {
        "insert_calls": 0,
        "insert_payloads": [],
        "precheck_filters": [],
        "keys_filters": [],
    }

    if keys_data is _DEFAULT:
        # Three active keys; one with sync_status NULL (never synced), one
        # 'active', one 'connected' — all must be enqueued. (The mock returns
        # whatever the filter chain "would" select; we encode only the kept
        # rows here and assert the filters separately.)
        keys_data = [{"id": f"key-{i}"} for i in range(n_keys)]

    # --- compute_jobs pre-check select chain -------------------------------
    precheck_chain = MagicMock()

    def _pc_eq(col: str, val: object) -> MagicMock:
        capture["precheck_filters"].append(("eq", col, val))
        return precheck_chain

    precheck_chain.eq.side_effect = _pc_eq

    # .not_ is a property returning a builder whose .is_ records the filter.
    not_builder = MagicMock()

    def _pc_not_is(col: str, val: object) -> MagicMock:
        capture["precheck_filters"].append(("not_is", col, val))
        return precheck_chain

    not_builder.is_.side_effect = _pc_not_is
    type(precheck_chain).not_ = property(lambda self: not_builder)
    precheck_chain.execute.return_value = MagicMock(count=pending_count, data=[])

    # --- api_keys select chain ---------------------------------------------
    keys_chain = MagicMock()

    def _k_eq(col: str, val: object) -> MagicMock:
        capture["keys_filters"].append(("eq", col, val))
        return keys_chain

    def _k_or(expr: str) -> MagicMock:
        capture["keys_filters"].append(("or", expr))
        return keys_chain

    def _k_is(col: str, val: object) -> MagicMock:
        capture["keys_filters"].append(("is", col, val))
        return keys_chain

    keys_chain.eq.side_effect = _k_eq
    keys_chain.or_.side_effect = _k_or
    keys_chain.is_.side_effect = _k_is
    keys_chain.execute.return_value = MagicMock(data=keys_data)

    def table(name: str) -> MagicMock:  # type: ignore[no-untyped-def]
        chain = MagicMock()

        def select(*args, **kwargs):  # type: ignore[no-untyped-def]
            return precheck_chain if name == "compute_jobs" else keys_chain

        chain.select = select

        def insert(payload):  # type: ignore[no-untyped-def]
            capture["insert_calls"] += 1
            capture["insert_payloads"].append(payload)
            inner = MagicMock()
            effect = bulk_insert_effect if bulk_insert_effect is not None else MagicMock()
            if isinstance(effect, Exception):
                inner.execute.side_effect = effect
            else:
                inner.execute.return_value = effect
            return inner

        chain.insert = insert
        return chain

    supabase.table = table
    return supabase, capture


# --- Happy path: one api_key-scoped derive job per active key -------------


@pytest.mark.asyncio
async def test_enqueues_one_derive_job_per_active_key(capsys) -> None:
    """3 active keys → exactly ONE bulk .insert() carrying a 3-element list,
    each row api_key-scoped (kind='derive_broker_dailies', api_key_id set, NO
    strategy_id), exit 0."""
    supabase, capture = _make_supabase(n_keys=3)

    with patch("scripts.phase35_backfill_enqueue.get_supabase", return_value=supabase):
        rc = await bf.main()

    assert rc == 0
    assert capture["insert_calls"] == 1
    payload = capture["insert_payloads"][0]
    assert isinstance(payload, list)
    assert len(payload) == 3
    assert all(row["kind"] == "derive_broker_dailies" for row in payload)
    assert all(isinstance(row["api_key_id"], str) and row["api_key_id"] for row in payload)
    # Coherence requires strategy_id NULL for the api_key arm — never set it.
    assert all("strategy_id" not in row for row in payload)
    assert all(row["metadata"] == {"phase": "35-backfill"} for row in payload)
    captured = capsys.readouterr()
    assert "3/3" in captured.out


@pytest.mark.asyncio
async def test_active_key_predicate_includes_null_sync_status(capsys) -> None:
    """Load-bearing: the api_keys select must use the OR filter
    (sync_status.is.null,sync_status.neq.revoked) so a NULL-sync_status active
    key (never synced) is INCLUDED — a plain .neq would drop it. Also pins the
    is_active and disconnected_at filters."""
    supabase, capture = _make_supabase(n_keys=2)

    with patch("scripts.phase35_backfill_enqueue.get_supabase", return_value=supabase):
        rc = await bf.main()

    assert rc == 0
    kf = capture["keys_filters"]
    assert ("eq", "is_active", True) in kf, f"is_active filter missing: {kf!r}"
    assert ("or", "sync_status.is.null,sync_status.neq.revoked") in kf, (
        f"the IS-DISTINCT-FROM-revoked OR filter (incl. NULL sync_status) is "
        f"missing — a plain .neq would drop never-synced active keys; got {kf!r}"
    )
    assert ("is", "disconnected_at", "null") in kf, (
        f"disconnected_at IS NULL filter missing: {kf!r}"
    )


@pytest.mark.asyncio
async def test_precheck_scopes_to_api_key_derive_jobs(capsys) -> None:
    """The pre-check must count pending derive_broker_dailies jobs with
    api_key_id NOT NULL (not strategy-scoped derive jobs)."""
    supabase, capture = _make_supabase(n_keys=1)

    with patch("scripts.phase35_backfill_enqueue.get_supabase", return_value=supabase):
        await bf.main()

    pf = capture["precheck_filters"]
    assert ("eq", "kind", "derive_broker_dailies") in pf, f"{pf!r}"
    assert ("eq", "status", "pending") in pf, f"{pf!r}"
    assert ("not_is", "api_key_id", "null") in pf, (
        f"pre-check must scope to api_key_id NOT NULL (api_key-scoped derive "
        f"jobs only); got {pf!r}"
    )


# --- Idempotency: pending jobs present → skip ------------------------------


@pytest.mark.asyncio
async def test_pending_jobs_present_skips_enqueue(capsys) -> None:
    """Pre-check finds pending api_key derive jobs → bail, 0 enqueued, rc=0."""
    supabase, capture = _make_supabase(pending_count=3, n_keys=3)

    with patch("scripts.phase35_backfill_enqueue.get_supabase", return_value=supabase):
        rc = await bf.main()

    captured = capsys.readouterr()
    assert rc == 0
    assert capture["insert_calls"] == 0
    assert "skipping to avoid duplicates" in captured.out


@pytest.mark.asyncio
async def test_none_pending_count_raises_not_skips_guard() -> None:
    """A missing count header (existing.count is None) must RAISE — never skip
    the duplicate guard blind (Rule 12)."""
    supabase, _ = _make_supabase(pending_count=None, n_keys=3)

    with patch("scripts.phase35_backfill_enqueue.get_supabase", return_value=supabase):
        with pytest.raises(RuntimeError, match="count came back\\s+None"):
            await bf.main()


@pytest.mark.asyncio
async def test_api_keys_none_data_raises() -> None:
    """rows.data is None on a query failure — must raise, not coerce to [] and
    exit 0 on a broken query (Rule 12)."""
    supabase, _ = _make_supabase(keys_data=None)

    with patch("scripts.phase35_backfill_enqueue.get_supabase", return_value=supabase):
        with pytest.raises(RuntimeError, match="api_keys select returned None"):
            await bf.main()


# --- Malformed rows skipped, non-zero exit --------------------------------


@pytest.mark.asyncio
async def test_malformed_rows_skipped_valid_rows_enqueued(capsys) -> None:
    """A key row missing/invalid 'id' is skipped (not a crash), valid rows are
    still enqueued, and rc!=0 flags the skip."""
    supabase, capture = _make_supabase(
        keys_data=[
            {"id": "key-0"},
            {"nope": "x"},      # missing id
            {"id": ""},         # empty id
            {"id": "key-1"},
            "not-a-dict",       # not even a dict
        ],
    )

    with patch("scripts.phase35_backfill_enqueue.get_supabase", return_value=supabase):
        rc = await bf.main()

    captured = capsys.readouterr()
    assert rc != 0
    assert capture["insert_calls"] == 1
    payload = capture["insert_payloads"][0]
    assert [row["api_key_id"] for row in payload] == ["key-0", "key-1"]
    assert "2/5" in captured.out
    assert "3 api_key rows skipped" in captured.out


@pytest.mark.asyncio
async def test_all_rows_malformed_no_insert(capsys) -> None:
    """If every row is malformed, no bulk insert is attempted and rc!=0."""
    supabase, capture = _make_supabase(
        keys_data=[{"nope": 1}, "x", {"id": None}],
    )

    with patch("scripts.phase35_backfill_enqueue.get_supabase", return_value=supabase):
        rc = await bf.main()

    captured = capsys.readouterr()
    assert rc != 0
    assert capture["insert_calls"] == 0
    assert "0/3" in captured.out


# --- 23505 race: atomic rollback, non-zero exit ---------------------------


@pytest.mark.asyncio
async def test_duplicate_race_aborts_atomically_zero_enqueued(capsys) -> None:
    """When the bulk insert hits the (api_key_id, kind) in-flight partial unique
    index (23505 — a racing operator/worker already enqueued), the whole
    statement rolls back atomically: 0 enqueued, rc!=0, a clean error message."""

    class _DupErr(Exception):
        code = "23505"

    supabase, capture = _make_supabase(
        n_keys=3,
        bulk_insert_effect=_DupErr("duplicate key value violates unique constraint"),
    )

    with patch("scripts.phase35_backfill_enqueue.get_supabase", return_value=supabase):
        rc = await bf.main()

    captured = capsys.readouterr()
    assert rc != 0
    assert capture["insert_calls"] == 1
    assert "0/3" in captured.out
    assert "23505" in captured.out


@pytest.mark.asyncio
async def test_non_race_bulk_failure_returns_nonzero(capsys) -> None:
    """A non-23505 bulk failure (network/auth/malformed) is surfaced loudly and
    exits non-zero — never swallowed as success."""
    supabase, capture = _make_supabase(
        n_keys=3,
        bulk_insert_effect=RuntimeError("connection reset"),
    )

    with patch("scripts.phase35_backfill_enqueue.get_supabase", return_value=supabase):
        rc = await bf.main()

    captured = capsys.readouterr()
    assert rc != 0
    assert capture["insert_calls"] == 1
    assert "0/3" in captured.out
    assert "connection reset" in captured.out
