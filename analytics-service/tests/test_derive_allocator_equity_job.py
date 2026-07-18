"""Phase 115.1 (E2 display-repoint / BACKBONE-02 + BACKBONE-03) Wave-1 —
compose-job persistence + no-legacy-write + recurring-enqueue-gap RED pins.

Three concerns, each a REGRESSION-FIRST RED pin the later waves turn green:

  * Pin 5 (compose-job persistence, plan 04): a new allocator-scoped
    ``run_derive_allocator_equity_job({"allocator_id": ...})`` handler reads per-key
    ``csv_daily_returns`` + ``kind='key_inputs:<api_key_id>'`` rows from
    ``allocator_equity_derived`` and upserts EXACTLY ONE
    ``(allocator_id, 'equity_curve')`` row whose payload matches the phase-wide
    display-row contract (115.1-01-PLAN.md <interfaces>). RED: handler absent.

  * Pin 6 (no-legacy-write, BACKBONE-03): the derived curve lands on the NEW keyed
    surface ONLY — ANY write (insert/upsert/update/delete) to the legacy
    ``allocator_equity_snapshots`` store is a two-writers race with the legacy
    first-writer-wins jobs and must be a test failure, forever (T-115.1-01). RED:
    handler absent.

  * Pin 7 (recurring key-mode enqueue gap, plan 04): the key-mode
    ``run_derive_broker_dailies_job`` EPILOGUE must enqueue one
    ``derive_allocator_equity`` compute job targeted at ``ctx.key_row["user_id"]``
    (the AUTHORITATIVE owner) — NEVER a spoofed job-payload ``allocator_id``
    (T-115.1-02 / the T-115-16 pin). RED via assertion: no epilogue enqueue today.

The fake PostgREST here follows the 115-04 in-memory-filtering pattern (the
``_build_ctx`` capture from ``test_derive_broker_dailies_dualmode``, reused for pin 7;
a raise-on-legacy-write table for pins 5/6). Network-free — every I/O primitive is a
stub. NO importorskip / xfail — honest RED pins; the wave gate proves RED explicitly.
"""
from __future__ import annotations

from typing import Any

import pytest

# Reuse the proven dual-mode key-mode harness (mock _ExchangeContext + capture) for
# pin 7 rather than re-building it. These are module-level in the dualmode test.
from tests.test_derive_broker_dailies_dualmode import (
    _build_ctx,
    _patches,
    _two_day_returns,
)

LEGACY_TABLE = "allocator_equity_snapshots"
DERIVED_TABLE = "allocator_equity_derived"


# ---------------------------------------------------------------------------
# Fake PostgREST — in-memory rows + a HARD refusal on any legacy-store write.
# ---------------------------------------------------------------------------


class _LegacyWriteError(AssertionError):
    """Raised the instant any operation targets the legacy snapshots store."""


class _FakeTable:
    def __init__(self, name: str, store: "_FakeSupabase") -> None:
        self._name = name
        self._store = store
        self._filters: list[tuple[str, Any]] = []
        self._like: list[tuple[str, str]] = []
        self._is_delete = False

    # --- write ops: refuse the legacy store, record on the derived surface ------
    def _guard_legacy(self, op: str) -> None:
        if self._name == LEGACY_TABLE:
            raise _LegacyWriteError(
                f"BACKBONE-03: {op} on {LEGACY_TABLE!r} is forbidden — the derived "
                "curve must land on the NEW keyed surface only (two-writers race)"
            )

    def upsert(self, payload: Any, **kw: Any) -> "_FakeTable":
        self._guard_legacy("upsert")
        self._store.upserts.append((self._name, payload, kw.get("on_conflict")))
        return self

    def insert(self, payload: Any, **kw: Any) -> "_FakeTable":
        self._guard_legacy("insert")
        self._store.upserts.append((self._name, payload, None))
        return self

    def update(self, payload: Any, **kw: Any) -> "_FakeTable":
        self._guard_legacy("update")
        return self

    def delete(self, **kw: Any) -> "_FakeTable":
        self._guard_legacy("delete")
        # Record a chainable delete whose eq-filters are captured on .execute()
        # so a test can assert exactly which (allocator_id, kind) row was deleted.
        self._is_delete = True
        return self

    # --- read chain -------------------------------------------------------------
    def select(self, *_a: Any, **_k: Any) -> "_FakeTable":
        return self

    def eq(self, col: str, val: Any) -> "_FakeTable":
        self._filters.append((col, val))
        return self

    def like(self, col: str, pattern: str) -> "_FakeTable":
        self._like.append((col, pattern))
        return self

    def _rows(self) -> list[dict]:
        rows = self._store.rows.get(self._name, [])
        out = []
        for r in rows:
            if all(r.get(c) == v for c, v in self._filters):
                ok = True
                for c, pat in self._like:
                    prefix = pat.rstrip("%")
                    if not str(r.get(c, "")).startswith(prefix):
                        ok = False
                if ok:
                    out.append(r)
        return out

    def execute(self) -> Any:
        class _R:
            def __init__(self, data: list[dict]) -> None:
                self.data = data

        if self._is_delete:
            matched = self._rows()
            self._store.deletes.append(
                (self._name, dict(self._filters), len(matched))
            )
            # Reflect the delete in the in-memory store so a later read sees it gone.
            remaining = [
                r for r in self._store.rows.get(self._name, []) if r not in matched
            ]
            self._store.rows[self._name] = remaining
            return _R(matched)
        return _R(self._rows())


class _FakeSupabase:
    def __init__(self, rows: dict[str, list[dict]]) -> None:
        self.rows = rows
        self.upserts: list[tuple[str, Any, Any]] = []
        self.deletes: list[tuple[str, dict, int]] = []

    def table(self, name: str) -> _FakeTable:
        return _FakeTable(name, self)

    def from_(self, name: str) -> _FakeTable:  # PostgREST alias
        return _FakeTable(name, self)


def _seed_allocator_inputs() -> dict[str, list[dict]]:
    """Two eligible per-key inputs for one allocator: dense csv_daily_returns plus
    the Option-B ``key_inputs:<api_key_id>`` rows (flows + anchor) the compose job
    reads, plus the two eligible ``api_keys`` rows the compose job filters through
    the ONE shared ``eligible_key_predicate`` (is_active, non-revoked, connected).
    Hand-derivable; no I/O."""
    alloc = "alloc-1"
    api_keys = [
        {
            "id": "key-A", "user_id": alloc, "is_active": True,
            "sync_status": "connected", "disconnected_at": None,
        },
        {
            "id": "key-B", "user_id": alloc, "is_active": True,
            "sync_status": "connected", "disconnected_at": None,
        },
    ]
    csv = []
    for i in range(3):
        day = f"2026-03-0{i + 1}"
        csv.append(
            {"api_key_id": "key-A", "allocator_id": alloc, "date": day, "daily_return": 0.004}
        )
        csv.append(
            {"api_key_id": "key-B", "allocator_id": alloc, "date": day, "daily_return": -0.002}
        )
    derived = [
        {
            "allocator_id": alloc,
            "kind": "key_inputs:key-A",
            "payload": {
                "flows": [], "anchor_usd": 100_000.0,
                "anchor_asof": "2026-03-03", "venue": "binance",
            },
        },
        {
            "allocator_id": alloc,
            "kind": "key_inputs:key-B",
            "payload": {
                "flows": [], "anchor_usd": 50_000.0,
                "anchor_asof": "2026-03-03", "venue": "okx",
            },
        },
    ]
    return {
        "csv_daily_returns": csv,
        DERIVED_TABLE: derived,
        LEGACY_TABLE: [],
        "api_keys": api_keys,
    }


# ---------------------------------------------------------------------------
# Pin 5 — compose-job persistence (RED: run_derive_allocator_equity_job absent)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_pin5_compose_job_upserts_one_equity_curve_row() -> None:
    """run_derive_allocator_equity_job reads per-key csv_daily_returns + key_inputs
    rows and upserts EXACTLY ONE (allocator_id,'equity_curve') row matching the
    display-row payload contract (curve non-empty, is_trustworthy present, scalars
    present)."""
    from services.job_worker import run_derive_allocator_equity_job

    fake = _FakeSupabase(_seed_allocator_inputs())
    job = {"id": "j-compose", "kind": "derive_allocator_equity", "allocator_id": "alloc-1"}

    from unittest.mock import patch

    with patch("services.job_worker.get_supabase", return_value=fake):
        await run_derive_allocator_equity_job(job)

    curve_upserts = [
        u for u in fake.upserts
        if u[0] == DERIVED_TABLE and _is_equity_curve_upsert(u[1])
    ]
    assert len(curve_upserts) == 1, (
        f"expected exactly one (allocator_id,'equity_curve') upsert; got {fake.upserts!r}"
    )
    payload = _extract_payload(curve_upserts[0][1])
    assert isinstance(payload.get("curve"), list) and payload["curve"], (
        f"curve must be a non-empty list; got {payload.get('curve')!r}"
    )
    assert "is_trustworthy" in payload
    assert "scalars" in payload and "computable" in payload["scalars"]


# ---------------------------------------------------------------------------
# Pin 6 — no legacy-store write (BACKBONE-03) — RED: handler absent
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_pin6_compose_job_never_writes_legacy_snapshots() -> None:
    """The compose job must NEVER write allocator_equity_snapshots. The fake table
    RAISES on any insert/upsert/update/delete to the legacy store, so a mis-routed
    write fails the test loudly (T-115.1-01)."""
    from services.job_worker import run_derive_allocator_equity_job

    fake = _FakeSupabase(_seed_allocator_inputs())
    job = {"id": "j-compose", "kind": "derive_allocator_equity", "allocator_id": "alloc-1"}

    from unittest.mock import patch

    with patch("services.job_worker.get_supabase", return_value=fake):
        # A write to the legacy store raises _LegacyWriteError inside the handler.
        await run_derive_allocator_equity_job(job)

    # Belt-and-braces: no legacy upsert was recorded either.
    legacy = [u for u in fake.upserts if u[0] == LEGACY_TABLE]
    assert legacy == [], f"compose job wrote the legacy store: {legacy!r}"


# ---------------------------------------------------------------------------
# Pin 7 — recurring key-mode enqueue gap (T-115.1-02) — RED via assertion today
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_pin7_key_mode_epilogue_enqueues_owner_scoped_compose() -> None:
    """The key-mode run_derive_broker_dailies_job epilogue must enqueue ONE
    ``derive_allocator_equity`` compute job targeted at ``ctx.key_row['user_id']``
    (the authoritative owner) — never the spoofed ``allocator_id`` a hostile job
    payload might carry (T-115.1-02 / T-115-16).

    RED today: key-mode currently fires NO epilogue enqueue at all. GREEN after plan
    04 wires the owner-scoped enqueue. MUTATION-FALSIFIABLE: an epilogue that reads
    the job-payload allocator_id instead of key_row['user_id'] targets "spoofed" and
    reddens the owner assertion.
    """
    from services.job_worker import run_derive_broker_dailies_job

    ctx, capture = _build_ctx(
        key_row={"id": "key-1", "exchange": "binance", "user_id": "alloc-owner"},
        strategy_row=None,
    )
    job = {
        "id": "j-key",
        "kind": "derive_broker_dailies",
        "api_key_id": "key-1",
        # A hostile/stale payload allocator_id the epilogue must IGNORE.
        "allocator_id": "spoofed",
    }
    patches = _patches(ctx, key_mode=True, returns=_two_day_returns())
    with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6]:
        await run_derive_broker_dailies_job(job)

    enqueues = [c for c in capture["rpc_calls"] if c[0] == "enqueue_compute_job"]
    compose_enqueues = [
        c for c in enqueues if c[1].get("p_kind") == "derive_allocator_equity"
    ]
    assert len(compose_enqueues) == 1, (
        "key-mode epilogue must enqueue exactly one derive_allocator_equity compose "
        f"job; got rpc_calls={capture['rpc_calls']!r}"
    )
    target = compose_enqueues[0][1].get("p_allocator_id")
    assert target == "alloc-owner", (
        "compose enqueue must target ctx.key_row['user_id'] (authoritative owner), "
        f"NEVER the job-payload allocator_id; got {target!r}"
    )


def _seed_poison_with_stale_curve() -> dict[str, list[dict]]:
    """One eligible key whose returns carry a ≤−100% (-1.0) day → the frozen core's
    non-positive-return-factor refusal fires (structural, permanent). A STALE
    trustworthy equity_curve row is present (e.g. the pre-liquidation curve). F2:
    the permanent failure must DELETE that stale row so the dashboard degrades to
    legacy instead of rendering the frozen pre-liquidation curve as trustworthy
    forever."""
    alloc = "alloc-poison"
    api_keys = [
        {"id": "key-P", "user_id": alloc, "is_active": True,
         "sync_status": "connected", "disconnected_at": None},
    ]
    csv = [
        {"api_key_id": "key-P", "allocator_id": alloc, "date": "2026-03-01", "daily_return": 0.004},
        {"api_key_id": "key-P", "allocator_id": alloc, "date": "2026-03-02", "daily_return": -1.0},
    ]
    derived = [
        {"allocator_id": alloc, "kind": "key_inputs:key-P",
         "payload": {"flows": [], "anchor_usd": 100_000.0, "venue": "binance"}},
        {"allocator_id": alloc, "kind": "equity_curve",
         "payload": {"curve": [{"date": "2026-02-01", "equity_usd": 500_000.0}],
                     "is_trustworthy": True, "degrade_reasons": [],
                     "scalars": {"mwr": 0.5, "dietz": 0.5, "computable": True}}},
    ]
    return {
        "csv_daily_returns": csv,
        DERIVED_TABLE: derived,
        LEGACY_TABLE: [],
        "api_keys": api_keys,
    }


@pytest.mark.asyncio
async def test_pin_f2_permanent_failure_deletes_stale_curve() -> None:
    """F2: a poison structural input → permanent FAILED → the stale equity_curve
    row is DELETED (degrade to legacy), never left rendering as trustworthy."""
    from services.job_worker import run_derive_allocator_equity_job

    fake = _FakeSupabase(_seed_poison_with_stale_curve())
    job = {"id": "j-poison", "kind": "derive_allocator_equity", "allocator_id": "alloc-poison"}

    from unittest.mock import patch

    with patch("services.job_worker.get_supabase", return_value=fake):
        result = await run_derive_allocator_equity_job(job)

    assert result.outcome.name == "FAILED"
    assert result.error_kind == "permanent"
    curve_deletes = [
        d for d in fake.deletes
        if d[0] == DERIVED_TABLE and d[1].get("kind") == "equity_curve"
        and d[1].get("allocator_id") == "alloc-poison"
    ]
    assert len(curve_deletes) == 1, (
        f"a permanent failure must delete the stale equity_curve row (F2); got {fake.deletes!r}"
    )


@pytest.mark.asyncio
async def test_pin_f2_corrupt_input_permanent_deletes_stale_curve() -> None:
    """F2: the M3 corrupt-input permanent disposition also deletes the stale row."""
    from services.job_worker import run_derive_allocator_equity_job

    seed = _seed_poison_with_stale_curve()
    # Swap the poison for a corrupt (NULL) daily_return → the M3 permanent path.
    seed["csv_daily_returns"][1]["daily_return"] = None
    fake = _FakeSupabase(seed)
    job = {"id": "j-corrupt", "kind": "derive_allocator_equity", "allocator_id": "alloc-poison"}

    from unittest.mock import patch

    with patch("services.job_worker.get_supabase", return_value=fake):
        result = await run_derive_allocator_equity_job(job)

    assert result.outcome.name == "FAILED"
    assert result.error_kind == "permanent"
    curve_deletes = [
        d for d in fake.deletes
        if d[0] == DERIVED_TABLE and d[1].get("kind") == "equity_curve"
    ]
    assert len(curve_deletes) == 1, (
        f"the M3 corrupt-input permanent path must delete the stale row; got {fake.deletes!r}"
    )


@pytest.mark.asyncio
async def test_pin_f2_transient_error_preserves_curve() -> None:
    """F2: a TRANSIENT error (bubbles/retries) must KEEP the equity_curve row — only
    a PERMANENT disposition deletes. A generic RuntimeError from the compose call
    propagates (classified transient by the dispatcher), and no delete fires."""
    from services.job_worker import run_derive_allocator_equity_job

    fake = _FakeSupabase(_seed_allocator_inputs())
    # Add a stale equity_curve row.
    fake.rows[DERIVED_TABLE].append(
        {"allocator_id": "alloc-1", "kind": "equity_curve",
         "payload": {"curve": [{"date": "2026-01-01", "equity_usd": 1.0}],
                     "is_trustworthy": True}}
    )
    job = {"id": "j-transient", "kind": "derive_allocator_equity", "allocator_id": "alloc-1"}

    from unittest.mock import patch

    with patch("services.job_worker.get_supabase", return_value=fake), patch(
        "services.allocator_equity_compose.compose_allocator_equity",
        side_effect=RuntimeError("transient blip"),
    ):
        with pytest.raises(RuntimeError, match="transient blip"):
            await run_derive_allocator_equity_job(job)

    curve_deletes = [
        d for d in fake.deletes
        if d[0] == DERIVED_TABLE and d[1].get("kind") == "equity_curve"
    ]
    assert curve_deletes == [], (
        f"a transient error must PRESERVE the equity_curve row; got {fake.deletes!r}"
    )


def _seed_partial_backfill() -> dict[str, list[dict]]:
    """Two eligible keys but only key-A has any inputs (returns + key_inputs);
    key-B has NEITHER a returns series NOR a key_inputs row (its derive has not
    run yet — the backfill window). A stale equity_curve row is present. F1(b): a
    trustworthy 1-of-2-capital curve must NOT be composed over this subset."""
    alloc = "alloc-partial"
    api_keys = [
        {"id": "key-A", "user_id": alloc, "is_active": True,
         "sync_status": "connected", "disconnected_at": None},
        {"id": "key-B", "user_id": alloc, "is_active": True,
         "sync_status": "connected", "disconnected_at": None},
    ]
    csv = [
        {"api_key_id": "key-A", "allocator_id": alloc, "date": f"2026-03-0{i+1}",
         "daily_return": 0.004}
        for i in range(3)
    ]
    derived = [
        {"allocator_id": alloc, "kind": "key_inputs:key-A",
         "payload": {"flows": [], "anchor_usd": 100_000.0, "venue": "binance"}},
        {"allocator_id": alloc, "kind": "equity_curve",
         "payload": {"curve": [{"date": "2026-01-01", "equity_usd": 1.0}],
                     "is_trustworthy": True, "degrade_reasons": [],
                     "scalars": {"mwr": 0.1, "dietz": 0.1, "computable": True}}},
    ]
    return {
        "csv_daily_returns": csv,
        DERIVED_TABLE: derived,
        LEGACY_TABLE: [],
        "api_keys": api_keys,
    }


@pytest.mark.asyncio
async def test_pin_f1b_partial_backfill_refuses_and_degrades() -> None:
    """F1(b): an allocator with 2 eligible keys where one key is absent from BOTH
    the returns and key_inputs maps (backfill window) → the compose is INCOMPLETE
    and must refuse: delete the equity_curve row (degrade to legacy), NEVER compose
    a trustworthy 1-of-2-capital curve."""
    from services.job_worker import run_derive_allocator_equity_job

    fake = _FakeSupabase(_seed_partial_backfill())
    job = {"id": "j-partial", "kind": "derive_allocator_equity", "allocator_id": "alloc-partial"}

    from unittest.mock import patch

    with patch("services.job_worker.get_supabase", return_value=fake):
        result = await run_derive_allocator_equity_job(job)

    assert result.outcome.name == "DONE"
    # NO trustworthy partial curve upserted.
    assert [u for u in fake.upserts if _is_equity_curve_upsert(u[1])] == [], (
        f"a partial (incomplete) compose must NOT upsert a curve; got {fake.upserts!r}"
    )
    # The stale equity_curve row is deleted → legacy fallback.
    curve_deletes = [
        d for d in fake.deletes
        if d[0] == DERIVED_TABLE and d[1].get("kind") == "equity_curve"
        and d[1].get("allocator_id") == "alloc-partial"
    ]
    assert len(curve_deletes) == 1, (
        f"an incomplete compose must delete the stale equity_curve row; got {fake.deletes!r}"
    )


@pytest.mark.asyncio
async def test_pin_f1b_key_inputs_only_key_is_not_missing() -> None:
    """F1(b) boundary: a key WITH a key_inputs row but NO returns is VISIBLE to the
    compose core (anchored-without-returns → DROPPED_KEY via B3), so it must NOT trip
    the missing-key refusal — the compose proceeds (and degrades honestly via B3),
    not via the F1(b) backfill-window delete."""
    from services.job_worker import run_derive_allocator_equity_job

    seed = _seed_partial_backfill()
    # Give key-B a key_inputs row (anchor, no returns) → now BOTH keys are visible.
    seed[DERIVED_TABLE].append(
        {"allocator_id": "alloc-partial", "kind": "key_inputs:key-B",
         "payload": {"flows": [], "anchor_usd": 50_000.0, "venue": "okx"}}
    )
    fake = _FakeSupabase(seed)
    job = {"id": "j-vis", "kind": "derive_allocator_equity", "allocator_id": "alloc-partial"}

    from unittest.mock import patch

    with patch("services.job_worker.get_supabase", return_value=fake):
        result = await run_derive_allocator_equity_job(job)

    assert result.outcome.name == "DONE"
    # key-B is anchored-without-returns → DROPPED_KEY → the composed curve is
    # untrustworthy (B3), and since key-A DOES have a curve it is a NON-empty
    # untrustworthy upsert (NOT the F1b backfill delete).
    curve_upserts = [u for u in fake.upserts if _is_equity_curve_upsert(u[1])]
    assert len(curve_upserts) == 1, (
        f"a key_inputs-only key is visible → compose proceeds; got {fake.upserts!r}"
    )
    payload = _extract_payload(curve_upserts[0][1])
    assert payload["is_trustworthy"] is False, (
        "a key with an anchor but no returns must render the curve untrustworthy (B3)"
    )
    assert "dropped_key" in payload["degrade_reasons"]


@pytest.mark.asyncio
async def test_pin_f1a_short_key_persists_key_inputs_and_enqueues() -> None:
    """F1(a): a key-mode derive that hits the <2-non-NaN-days short-circuit must
    STILL persist its Option-B key_inputs row (anchor + flows already fetched) and
    enqueue the compose — so an idle/short key with real capital is visible to the
    compose core (anchored-without-returns → DROPPED_KEY → untrustworthy) instead of
    silently vanishing from a "Derived" curve that understates its capital.

    RED today: the epilogue runs AFTER the short-circuit's early return, so a <2-day
    key persists NO key_inputs. MUTATION-FALSIFIABLE: leave the epilogue below the
    short-circuit → no key_inputs upsert → RED.
    """
    from services.job_worker import run_derive_broker_dailies_job

    ctx, capture = _build_ctx(
        key_row={"id": "key-idle", "exchange": "binance", "user_id": "alloc-owner"},
        strategy_row=None,
    )
    job = {"id": "j-key", "kind": "derive_broker_dailies", "api_key_id": "key-idle"}
    import pandas as pd

    one_day = pd.Series(
        [0.01], index=pd.DatetimeIndex(["2024-05-01"]), dtype="float64"
    )
    from unittest.mock import AsyncMock, patch

    patches = _patches(ctx, key_mode=True, returns=one_day)
    # A trustworthy positive equity read so the persisted anchor is a real NAV.
    equity_patch = patch(
        "services.exchange.fetch_account_equity_and_upnl_usd",
        new=AsyncMock(return_value=(100_000.0, False, 0.0, False)),
    )
    with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6], equity_patch:
        result = await run_derive_broker_dailies_job(job)

    assert result.outcome.name == "DONE"
    # key_inputs IS persisted (with the fetched anchor) even at <2 days.
    ki_upserts = [
        u for u in capture["upserts"]
        if u[0] == DERIVED_TABLE and _is_key_inputs_upsert(u[1])
    ]
    assert len(ki_upserts) == 1, (
        f"a <2-day key-mode derive must still persist key_inputs; got {capture['upserts']!r}"
    )
    row = _rows_of(ki_upserts[0][1])[0]
    assert row["kind"] == "key_inputs:key-idle"
    assert row["payload"]["anchor_usd"] == 100_000.0
    # The compose is enqueued (owner-scoped) so the allocator recomposes.
    compose_enqueues = [
        c for c in capture["rpc_calls"]
        if c[0] == "enqueue_compute_job"
        and c[1].get("p_kind") == "derive_allocator_equity"
    ]
    assert len(compose_enqueues) == 1
    assert compose_enqueues[0][1].get("p_allocator_id") == "alloc-owner"
    # STILL no csv_daily_returns write and no strategy_analytics stamp (<2 days).
    assert [u for u in capture["upserts"] if u[0] == "csv_daily_returns"] == []
    assert [u for u in capture["upserts"] if u[0] == "strategy_analytics"] == []


def _seed_zero_anchored_with_stale_curve() -> dict[str, list[dict]]:
    """An allocator with an eligible key but ZERO per-key returns and ZERO
    key_inputs → the compose core emits an EMPTY curve (NO_ANCHORED_KEYS, benign
    → is_trustworthy True). A STALE (allocator_id,'equity_curve') display row is
    already present from an earlier compose. B2: the empty recompose must DELETE
    that stale row (degrade to the clean no-row legacy fallback), never upsert an
    empty trustworthy curve that blanks the dashboard."""
    alloc = "alloc-empty"
    api_keys = [
        {
            "id": "key-Z", "user_id": alloc, "is_active": True,
            "sync_status": "connected", "disconnected_at": None,
        },
    ]
    stale_curve = {
        "allocator_id": alloc,
        "kind": "equity_curve",
        "payload": {
            "curve": [{"date": "2026-01-01", "equity_usd": 12345.0}],
            "is_trustworthy": True,
            "degrade_reasons": [],
            "scalars": {"mwr": 0.1, "dietz": 0.1, "computable": True},
        },
    }
    return {
        "csv_daily_returns": [],
        DERIVED_TABLE: [stale_curve],
        LEGACY_TABLE: [],
        "api_keys": api_keys,
    }


@pytest.mark.asyncio
async def test_pin_b2_empty_compose_deletes_stale_curve_no_upsert() -> None:
    """B2 (root cause): a zero-anchored-keys / empty-curve compose must NOT upsert
    an empty equity_curve row and MUST delete any existing one, so the dashboard
    degrades to the clean no-row legacy fallback (never a blank chart labeled
    'derived', never a stale trustworthy row surviving a structurally-empty
    recompute — this also closes L1)."""
    from services.job_worker import run_derive_allocator_equity_job

    fake = _FakeSupabase(_seed_zero_anchored_with_stale_curve())
    job = {"id": "j-empty", "kind": "derive_allocator_equity", "allocator_id": "alloc-empty"}

    from unittest.mock import patch

    with patch("services.job_worker.get_supabase", return_value=fake):
        result = await run_derive_allocator_equity_job(job)

    assert result.outcome.name == "DONE"
    # NO equity_curve upsert on an empty compose.
    curve_upserts = [
        u for u in fake.upserts
        if u[0] == DERIVED_TABLE and _is_equity_curve_upsert(u[1])
    ]
    assert curve_upserts == [], (
        f"empty compose must NOT upsert an equity_curve row; got {fake.upserts!r}"
    )
    # The stale equity_curve row was deleted (scoped to this allocator + kind).
    curve_deletes = [
        d for d in fake.deletes
        if d[0] == DERIVED_TABLE and d[1].get("kind") == "equity_curve"
        and d[1].get("allocator_id") == "alloc-empty"
    ]
    assert len(curve_deletes) == 1, (
        f"empty compose must DELETE the stale equity_curve row; got {fake.deletes!r}"
    )


def _seed_malformed_daily_return() -> dict[str, list[dict]]:
    """One eligible key whose csv_daily_returns carries a NULL daily_return — a
    corrupt DB value. ``float(None)`` raises TypeError; without a guard that lands
    OUTSIDE the compose NavReconstructionError catch and is retried FOREVER as
    transient `unknown` (the T-74-02 class). M3: it must be a permanent FAILED."""
    alloc = "alloc-bad"
    api_keys = [
        {
            "id": "key-M", "user_id": alloc, "is_active": True,
            "sync_status": "connected", "disconnected_at": None,
        },
    ]
    csv = [
        {"api_key_id": "key-M", "allocator_id": alloc, "date": "2026-03-01", "daily_return": 0.004},
        # Corrupt: a NULL daily_return that float() cannot coerce.
        {"api_key_id": "key-M", "allocator_id": alloc, "date": "2026-03-02", "daily_return": None},
    ]
    derived = [
        {
            "allocator_id": alloc,
            "kind": "key_inputs:key-M",
            "payload": {"flows": [], "anchor_usd": 100_000.0, "venue": "binance"},
        },
    ]
    return {
        "csv_daily_returns": csv,
        DERIVED_TABLE: derived,
        LEGACY_TABLE: [],
        "api_keys": api_keys,
    }


@pytest.mark.asyncio
async def test_pin_m3_malformed_daily_return_permanent_failed() -> None:
    """M3: a malformed DB value (NULL daily_return → float(None) TypeError) parsed
    OUTSIDE the compose catch must land a PERMANENT FAILED with a scrubbed message,
    NOT an infinite transient `unknown` retry (the T-74-02 poison-retry class)."""
    from services.job_worker import run_derive_allocator_equity_job

    fake = _FakeSupabase(_seed_malformed_daily_return())
    job = {"id": "j-bad", "kind": "derive_allocator_equity", "allocator_id": "alloc-bad"}

    from unittest.mock import patch

    with patch("services.job_worker.get_supabase", return_value=fake):
        result = await run_derive_allocator_equity_job(job)

    assert result.outcome.name == "FAILED", (
        f"a malformed daily_return must FAIL permanently, not retry; got {result.outcome!r}"
    )
    assert result.error_kind == "permanent", (
        f"must be permanent (corrupt input, non-retryable); got {result.error_kind!r}"
    )
    # No poison equity_curve upsert on a structural parse failure.
    assert [u for u in fake.upserts if _is_equity_curve_upsert(u[1])] == []


@pytest.mark.asyncio
async def test_pin_m3_malformed_usd_signed_permanent_failed() -> None:
    """M3/M1: a malformed key_inputs flow (non-coercible usd_signed) reconstructing
    an ExternalFlow from JSONB must be a permanent FAILED, not an infinite retry."""
    from services.job_worker import run_derive_allocator_equity_job

    seed = _seed_allocator_inputs()
    # Corrupt one key's persisted flow: usd_signed is a non-numeric string.
    for row in seed[DERIVED_TABLE]:
        if row["kind"] == "key_inputs:key-A":
            row["payload"]["flows"] = [
                {"utc_day_iso": "2026-03-02", "usd_signed": "not-a-number"}
            ]
    fake = _FakeSupabase(seed)
    job = {"id": "j-badflow", "kind": "derive_allocator_equity", "allocator_id": "alloc-1"}

    from unittest.mock import patch

    with patch("services.job_worker.get_supabase", return_value=fake):
        result = await run_derive_allocator_equity_job(job)

    assert result.outcome.name == "FAILED"
    assert result.error_kind == "permanent"


@pytest.mark.asyncio
async def test_pin_structural_refusal_permanent_scrubbed_failed() -> None:
    """Neuter gap: a STRUCTURAL compose refusal (the frozen core's loud asserts —
    here a ≤−100% return factor that replay_key_equity cannot roll through) must
    return FAILED / error_kind='permanent' with a SCRUBBED message, never an
    infinite transient retry and never a raw USD magnitude leak."""
    from services.job_worker import run_derive_allocator_equity_job

    seed = _seed_allocator_inputs()
    # Taint key-A's series with a -1.0 day (factor 1 + (-1) = 0 ≤ 0 → the core's
    # non-positive-return-factor refusal fires during per-key replay).
    for r in seed["csv_daily_returns"]:
        if r["api_key_id"] == "key-A" and r["date"] == "2026-03-02":
            r["daily_return"] = -1.0
    fake = _FakeSupabase(seed)
    job = {"id": "j-refuse", "kind": "derive_allocator_equity", "allocator_id": "alloc-1"}

    from unittest.mock import patch

    with patch("services.job_worker.get_supabase", return_value=fake):
        result = await run_derive_allocator_equity_job(job)

    assert result.outcome.name == "FAILED"
    assert result.error_kind == "permanent", (
        f"a structural refusal is non-retryable; got {result.error_kind!r}"
    )
    assert "structural" in (result.error_message or "").lower()
    # No raw USD anchor magnitude (100000 / 50000) leaked into the message.
    assert "100000" not in (result.error_message or "")
    assert "50000" not in (result.error_message or "")
    # No poison equity_curve upsert on a structural failure.
    assert [u for u in fake.upserts if _is_equity_curve_upsert(u[1])] == []


@pytest.mark.asyncio
async def test_pin_orphan_key_inputs_cleanup_scoped() -> None:
    """Neuter gap: a key_inputs row for a revoked/absent key is an ORPHAN — the
    compose job deletes EXACTLY that row, scoped to (allocator_id, kind). The
    eligible key_inputs rows and the freshly-upserted equity_curve row survive
    (a mis-scoped delete predicate would wipe live rows)."""
    from services.job_worker import run_derive_allocator_equity_job

    seed = _seed_allocator_inputs()  # key-A + key-B eligible, with returns + anchors
    # Add an orphan key_inputs row for a key absent from api_keys (not eligible).
    seed[DERIVED_TABLE].append(
        {
            "allocator_id": "alloc-1",
            "kind": "key_inputs:key-GONE",
            "payload": {"flows": [], "anchor_usd": 999_999.0, "venue": "binance"},
        }
    )
    fake = _FakeSupabase(seed)
    job = {"id": "j-orphan", "kind": "derive_allocator_equity", "allocator_id": "alloc-1"}

    from unittest.mock import patch

    with patch("services.job_worker.get_supabase", return_value=fake):
        result = await run_derive_allocator_equity_job(job)

    assert result.outcome.name == "DONE"
    # EXACTLY the orphan kind was deleted (scoped to allocator + that kind).
    ki_deletes = [
        d for d in fake.deletes
        if d[0] == DERIVED_TABLE and str(d[1].get("kind", "")).startswith("key_inputs:")
    ]
    assert len(ki_deletes) == 1, f"exactly one orphan key_inputs delete; got {fake.deletes!r}"
    assert ki_deletes[0][1].get("kind") == "key_inputs:key-GONE"
    assert ki_deletes[0][1].get("allocator_id") == "alloc-1"
    # The eligible key_inputs rows were NOT deleted; the equity_curve row was upserted.
    assert not any(
        d[1].get("kind") in ("key_inputs:key-A", "key_inputs:key-B")
        for d in fake.deletes
    ), f"eligible key_inputs must survive; got {fake.deletes!r}"
    assert [u for u in fake.upserts if _is_equity_curve_upsert(u[1])], (
        "the equity_curve row must still be upserted alongside orphan cleanup"
    )


@pytest.mark.asyncio
async def test_pin_m1_nonfinite_flow_in_jsonb_permanent_failed() -> None:
    """M1: a non-finite usd_signed persisted in key_inputs JSONB must be rejected
    by validate_flow_shape on reconstruction → permanent FAILED (never a silent
    NaN sailing into the core)."""
    import math

    from services.job_worker import run_derive_allocator_equity_job

    seed = _seed_allocator_inputs()
    for row in seed[DERIVED_TABLE]:
        if row["kind"] == "key_inputs:key-A":
            row["payload"]["flows"] = [
                {"utc_day_iso": "2026-03-02", "usd_signed": math.inf}
            ]
    fake = _FakeSupabase(seed)
    job = {"id": "j-inf", "kind": "derive_allocator_equity", "allocator_id": "alloc-1"}

    from unittest.mock import patch

    with patch("services.job_worker.get_supabase", return_value=fake):
        result = await run_derive_allocator_equity_job(job)

    assert result.outcome.name == "FAILED"
    assert result.error_kind == "permanent"


# ---------------------------------------------------------------------------
# Pin 7b — enqueue named-notation completeness (B1, 115.1-close). The
# ``enqueue_compute_job`` RPC's FIRST positional param ``p_strategy_id`` has NO
# SQL DEFAULT, so a PostgREST named-notation call that OMITS it cannot resolve
# the overload → "function does not exist" → the surrounding try/except swallows
# it as a warning → the compose job is NEVER enqueued → the whole derived-equity
# feature is silently dead. Every SQL caller passes ``p_strategy_id := NULL``
# explicitly (see the migration's own cron body); the Python epilogue must too.
# MUTATION-FALSIFIABLE: drop ``p_strategy_id`` from the payload → RED.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_pin7b_compose_enqueue_passes_p_strategy_id_null() -> None:
    """The key-mode epilogue's ``derive_allocator_equity`` enqueue must include an
    explicit ``p_strategy_id`` key (value ``None`` → SQL NULL) so PostgREST can
    resolve the ``enqueue_compute_job`` overload whose first positional param has
    no default. Omitting it makes the RPC unresolvable and the feature dead."""
    from services.job_worker import run_derive_broker_dailies_job

    ctx, capture = _build_ctx(
        key_row={"id": "key-1", "exchange": "binance", "user_id": "alloc-owner"},
        strategy_row=None,
    )
    job = {"id": "j-key", "kind": "derive_broker_dailies", "api_key_id": "key-1"}
    patches = _patches(ctx, key_mode=True, returns=_two_day_returns())
    with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6]:
        await run_derive_broker_dailies_job(job)

    compose_enqueues = [
        c
        for c in capture["rpc_calls"]
        if c[0] == "enqueue_compute_job"
        and c[1].get("p_kind") == "derive_allocator_equity"
    ]
    assert len(compose_enqueues) == 1, (
        f"expected exactly one compose enqueue; got {capture['rpc_calls']!r}"
    )
    payload = compose_enqueues[0][1]
    assert "p_strategy_id" in payload, (
        "the compose enqueue must pass p_strategy_id explicitly (=None → SQL NULL) "
        "so the no-default first positional param resolves the PostgREST overload; "
        f"got {payload!r}"
    )
    assert payload["p_strategy_id"] is None, (
        f"p_strategy_id must be None (SQL NULL), never a value; got {payload['p_strategy_id']!r}"
    )
    assert payload.get("p_allocator_id") == "alloc-owner"


# ---------------------------------------------------------------------------
# Pin 8 — null-anchor honesty (T-115.1-16) — the epilogue never fabricates an
# anchor. When the live equity read is flagged untrustworthy (balance_error /
# equity is None), the persisted key_inputs row carries anchor_usd: null —
# NEVER a heuristic value — so the compose core honestly DROPS the key.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_pin8_epilogue_persists_null_anchor_on_untrustworthy_read() -> None:
    """The key-mode epilogue persists a ``key_inputs:<api_key_id>`` row whose
    ``anchor_usd`` is ``None`` when the live equity read is untrustworthy. The
    dual-mode harness stubs ``fetch_account_equity_and_upnl_usd`` via a MagicMock
    exchange whose ``fetch_balance`` never resolves cleanly → ``balance_error`` is
    truthy → the epilogue MUST persist a null anchor (never a fabricated one).

    MUTATION-FALSIFIABLE: an epilogue that back-fills a heuristic anchor (e.g. an
    allocator_holdings value_usd sum) instead of null reddens the ``is None``
    assertion.
    """
    from services.job_worker import run_derive_broker_dailies_job

    ctx, capture = _build_ctx(
        key_row={"id": "key-9", "exchange": "binance", "user_id": "alloc-owner"},
        strategy_row=None,
    )
    job = {"id": "j-key", "kind": "derive_broker_dailies", "api_key_id": "key-9"}
    patches = _patches(ctx, key_mode=True, returns=_two_day_returns())
    with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6]:
        await run_derive_broker_dailies_job(job)

    ki_upserts = [
        u for u in capture["upserts"]
        if u[0] == DERIVED_TABLE and _is_key_inputs_upsert(u[1])
    ]
    assert len(ki_upserts) == 1, (
        f"epilogue must persist exactly one key_inputs row; got {capture['upserts']!r}"
    )
    row = _rows_of(ki_upserts[0][1])[0]
    assert row["kind"] == "key_inputs:key-9"
    payload = row["payload"]
    assert payload["anchor_usd"] is None, (
        "an untrustworthy equity read must persist anchor_usd: null (never a "
        f"heuristic anchor); got {payload['anchor_usd']!r}"
    )
    assert payload["venue"] == "binance"
    assert isinstance(payload["flows"], list)


# ---------------------------------------------------------------------------
# Epilogue anchor-materiality gate (M1 finiteness / M2 dust+non-positive) +
# the paired POSITIVE-anchor neuter gap. The persisted key_inputs anchor_usd
# must be a trustworthy, MATERIAL, POSITIVE, FINITE venue-equity read — else
# NULL (never a poison JSONB, never a permanent-fail-inducing non-positive
# anchor). Drives the ccxt equity read via a patched
# fetch_account_equity_and_upnl_usd (returns (equity, balance_error, upnl,
# upnl_unreadable)).
# ---------------------------------------------------------------------------


async def _run_key_epilogue_with_equity_read(equity: object, balance_error: bool = False):
    """Run the key-mode derive with a patched live equity read; return the capture."""
    from unittest.mock import AsyncMock, patch

    from services.job_worker import run_derive_broker_dailies_job

    ctx, capture = _build_ctx(
        key_row={"id": "key-eq", "exchange": "binance", "user_id": "alloc-owner"},
        strategy_row=None,
    )
    job = {"id": "j-key", "kind": "derive_broker_dailies", "api_key_id": "key-eq"}
    patches = _patches(ctx, key_mode=True, returns=_two_day_returns())
    equity_patch = patch(
        "services.exchange.fetch_account_equity_and_upnl_usd",
        new=AsyncMock(return_value=(equity, balance_error, 0.0, False)),
    )
    with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6], equity_patch:
        await run_derive_broker_dailies_job(job)
    return capture


def _persisted_anchor(capture: dict):
    ki = [
        u for u in capture["upserts"]
        if u[0] == DERIVED_TABLE and _is_key_inputs_upsert(u[1])
    ]
    assert len(ki) == 1, f"expected one key_inputs upsert; got {capture['upserts']!r}"
    return _rows_of(ki[0][1])[0]["payload"]["anchor_usd"]


@pytest.mark.asyncio
async def test_pin_positive_anchor_persists_the_live_nav() -> None:
    """Neuter gap (paired positive for pin 8): a TRUSTWORTHY material positive live
    equity read persists that EXACT NAV as anchor_usd — proving the anchor is the
    equity read itself (the derivative-notional trap: NOT a value_usd/holdings sum)."""
    capture = await _run_key_epilogue_with_equity_read(123_456.78, balance_error=False)
    assert _persisted_anchor(capture) == 123_456.78, (
        "a trustworthy positive equity read must persist as the anchor verbatim"
    )


@pytest.mark.asyncio
async def test_pin_m1_nonfinite_equity_persists_null_anchor() -> None:
    """M1: a non-finite live equity (inf/NaN) must NOT be serialized into JSONB
    (Postgres rejects NaN/Inf → persist fails → transient re-crawl loop). Persist a
    null anchor honestly instead."""
    import math

    for bad in (math.inf, -math.inf, math.nan):
        capture = await _run_key_epilogue_with_equity_read(bad, balance_error=False)
        assert _persisted_anchor(capture) is None, (
            f"a non-finite equity ({bad!r}) must persist anchor_usd null, not poison JSONB"
        )


@pytest.mark.asyncio
async def test_pin_m2_dust_equity_persists_null_anchor() -> None:
    """M2: a dust equity (|equity| <= DUST_NAV_FLOOR=$1000) is immaterial — the
    epilogue must persist a null anchor, consistent with the function's materiality
    contract (:2651-2655), never a trustworthy near-zero curve basis."""
    capture = await _run_key_epilogue_with_equity_read(500.0, balance_error=False)
    assert _persisted_anchor(capture) is None, (
        "a dust equity must persist anchor_usd null (materiality contract)"
    )


@pytest.mark.asyncio
async def test_pin_f3_dropped_nonfinite_flow_nulls_anchor() -> None:
    """F3: M1 SKIPS a non-finite flow (JSONB can't hold NaN/Inf), but a dropped flow
    means the reconstructed $-level is MIS-LEVELED. Persisting a trustworthy anchor
    would read trustworthy over a silently mis-leveled curve. So if ANY flow is
    dropped, null that key's anchor → the key degrades honestly (compose DROPS it).
    """
    from unittest.mock import AsyncMock, MagicMock, patch

    from services.external_flows import ExternalFlow
    from services.job_worker import run_derive_broker_dailies_job

    ctx, capture = _build_ctx(
        key_row={"id": "key-f3", "exchange": "binance", "user_id": "alloc-owner"},
        strategy_row=None,
    )
    job = {"id": "j-key", "kind": "derive_broker_dailies", "api_key_id": "key-f3"}
    patches = _patches(ctx, key_mode=True, returns=_two_day_returns())
    # A trustworthy positive equity read — so ONLY the dropped flow can null it.
    equity_patch = patch(
        "services.exchange.fetch_account_equity_and_upnl_usd",
        new=AsyncMock(return_value=(100_000.0, False, 0.0, False)),
    )
    # Inject a non-finite flow into the crawl output.
    transfers_patch = patch(
        "services.ccxt_flow_fetch.fetch_ccxt_transfers",
        new=AsyncMock(return_value=[]),
    )
    price_patch = patch(
        "services.job_worker._resolve_ccxt_flow_price_index",
        new=AsyncMock(return_value={}),
    )
    flows_patch = patch(
        "services.ccxt_flows.ccxt_rows_to_dated_flows",
        new=MagicMock(
            return_value=[ExternalFlow("2024-05-01", float("inf"))]
        ),
    )
    with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6], equity_patch, transfers_patch, price_patch, flows_patch:
        await run_derive_broker_dailies_job(job)

    ki = [
        u for u in capture["upserts"]
        if u[0] == DERIVED_TABLE and _is_key_inputs_upsert(u[1])
    ]
    assert len(ki) == 1, f"expected one key_inputs upsert; got {capture['upserts']!r}"
    payload = _rows_of(ki[0][1])[0]["payload"]
    # The non-finite flow was NOT persisted (M1) AND the anchor is nulled (F3).
    assert payload["flows"] == [], (
        f"a non-finite flow must not be persisted; got {payload['flows']!r}"
    )
    assert payload["anchor_usd"] is None, (
        "a dropped non-finite flow must null the anchor so the key degrades honestly "
        f"(F3); got {payload['anchor_usd']!r}"
    )


@pytest.mark.asyncio
async def test_pin_m2_negative_equity_persists_null_anchor() -> None:
    """M2: a NEGATIVE live equity must persist a null anchor — a negative anchor
    sails past the (balance_error or None) guard and makes replay_key_equity raise
    non-positive-equity, permanently FAILING the WHOLE allocator compose. Anchor
    null degrades that one key honestly instead."""
    capture = await _run_key_epilogue_with_equity_read(-50_000.0, balance_error=False)
    assert _persisted_anchor(capture) is None, (
        "a negative equity must persist anchor_usd null, never a permanent-fail anchor"
    )


# ---------------------------------------------------------------------------
# helpers — tolerant of the exact upsert payload shape plan 04 chooses (a single
# dict row or a one-element list); assert on the CONTRACT fields, not the wrapper.
# ---------------------------------------------------------------------------


def _is_key_inputs_upsert(payload: Any) -> bool:
    return any(
        str(r.get("kind", "")).startswith("key_inputs:") for r in _rows_of(payload)
    )


def _rows_of(payload: Any) -> list[dict]:
    if isinstance(payload, list):
        return [r for r in payload if isinstance(r, dict)]
    if isinstance(payload, dict):
        return [payload]
    return []


def _is_equity_curve_upsert(payload: Any) -> bool:
    return any(r.get("kind") == "equity_curve" for r in _rows_of(payload))


def _extract_payload(payload: Any) -> dict:
    for r in _rows_of(payload):
        if r.get("kind") == "equity_curve":
            inner = r.get("payload")
            return inner if isinstance(inner, dict) else {}
    return {}
