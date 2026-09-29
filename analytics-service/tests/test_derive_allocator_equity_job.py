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
        # A read of the legacy store is the duplicate-writer date reaching the
        # compose. Refuse it the same way a write is refused (BACKBONE-03).
        if self._name == LEGACY_TABLE:
            raise _LegacyWriteError(
                f"BACKBONE-03: read of {LEGACY_TABLE!r} is forbidden — the compose "
                "must not see the duplicate-writer date"
            )
        if _a:
            self._store.selects.append((self._name, _a[0]))
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
        self.selects: list[tuple[str, Any]] = []

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


def _seed_null_anchor_sibling(reason: str) -> dict[str, list[dict]]:
    """Healthy key-A (returns + real anchor) + idle key-B whose key_inputs row
    carries anchor_usd=None + the given anchor_null_reason and NO returns. Both
    eligible; a stale equity_curve row is present. The fourth-bucket seam gates
    key-B on `reason`: dust → omit (trustworthy over A); else → DROPPED_KEY."""
    alloc = "alloc-nullsib"
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
    ki_b_payload: dict[str, Any] = {"flows": [], "anchor_usd": None, "venue": "binance"}
    if reason is not None:
        ki_b_payload["anchor_null_reason"] = reason
    derived = [
        {"allocator_id": alloc, "kind": "key_inputs:key-A",
         "payload": {"flows": [], "anchor_usd": 100_000.0, "venue": "binance"}},
        {"allocator_id": alloc, "kind": "key_inputs:key-B", "payload": ki_b_payload},
        {"allocator_id": alloc, "kind": "equity_curve",
         "payload": {"curve": [{"date": "2026-01-01", "equity_usd": 1.0}],
                     "is_trustworthy": True}},
    ]
    return {"csv_daily_returns": csv, DERIVED_TABLE: derived,
            LEGACY_TABLE: [], "api_keys": api_keys}


@pytest.mark.asyncio
async def test_pin_fourthbucket_nondust_null_anchor_sibling_degrades() -> None:
    """F1a×F3/M2 seam (end-to-end): a healthy key-A + an idle key-B whose key_inputs
    row has anchor_usd=None + anchor_null_reason='balance_error' (real-capital read
    failure) and no returns → the compose threads the reason token, hits the fourth
    bucket, and the composed curve is UNTRUSTWORTHY (DROPPED_KEY) → legacy. NOT a
    trustworthy 1-of-2 curve. key-B has a key_inputs row so it passes F1(b) — this is
    the seam F1(b) does NOT cover."""
    from services.job_worker import run_derive_allocator_equity_job

    fake = _FakeSupabase(_seed_null_anchor_sibling("balance_error"))
    job = {"id": "j-4b", "kind": "derive_allocator_equity", "allocator_id": "alloc-nullsib"}

    from unittest.mock import patch

    with patch("services.job_worker.get_supabase", return_value=fake):
        result = await run_derive_allocator_equity_job(job)

    assert result.outcome.name == "DONE"
    curve_upserts = [u for u in fake.upserts if _is_equity_curve_upsert(u[1])]
    assert len(curve_upserts) == 1, (
        f"key-A yields a non-empty curve → it upserts (untrustworthy); got {fake.upserts!r}"
    )
    payload = _extract_payload(curve_upserts[0][1])
    assert payload["is_trustworthy"] is False, (
        f"a null-anchor real-failure sibling must degrade the allocator; "
        f"got degrade_reasons={payload['degrade_reasons']!r}"
    )
    assert "dropped_key" in payload["degrade_reasons"]


@pytest.mark.asyncio
async def test_pin_fourthbucket_dust_null_anchor_sibling_omitted() -> None:
    """F1a×F3/M2 seam (end-to-end): a DUST null-anchor sibling is silently omitted →
    the rest composes TRUSTWORTHY (dust materiality must not pin the allocator to
    legacy)."""
    from services.job_worker import run_derive_allocator_equity_job

    fake = _FakeSupabase(_seed_null_anchor_sibling("dust"))
    job = {"id": "j-4bd", "kind": "derive_allocator_equity", "allocator_id": "alloc-nullsib"}

    from unittest.mock import patch

    with patch("services.job_worker.get_supabase", return_value=fake):
        result = await run_derive_allocator_equity_job(job)

    assert result.outcome.name == "DONE"
    curve_upserts = [u for u in fake.upserts if _is_equity_curve_upsert(u[1])]
    assert len(curve_upserts) == 1
    payload = _extract_payload(curve_upserts[0][1])
    assert payload["is_trustworthy"] is True, (
        f"a dust null-anchor sibling must be omitted, not degrade; "
        f"got degrade_reasons={payload['degrade_reasons']!r}"
    )


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
    """F1(b) boundary (NON-null-anchor variant): a key WITH a key_inputs row carrying
    a REAL (non-null) anchor but NO returns is VISIBLE to the compose core
    (anchored-without-returns → DROPPED_KEY via B3), so it must NOT trip the
    missing-key refusal — the compose proceeds (and degrades honestly via B3), not
    via the F1(b) backfill-window delete. The NULL-anchor variant (a key_inputs row
    with anchor_usd=None + no returns) is covered by the F1a×F3/M2-seam fourth-bucket
    pins below and in test_e2_segment_blend_wiring.py."""
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
async def test_pin_f4b_corrupt_value_scrubbed_of_raw_numeric() -> None:
    """F4b: a corrupt persisted value whose float() ValueError echoes the raw value
    (`could not convert string to float: '987654.32abc'`) must NOT leak that numeric
    magnitude into error_message (admin-only, but the T-115-05 no-raw-USD rule)."""
    from services.job_worker import run_derive_allocator_equity_job

    seed = _seed_allocator_inputs()
    for row in seed[DERIVED_TABLE]:
        if row["kind"] == "key_inputs:key-A":
            row["payload"]["flows"] = [
                {"utc_day_iso": "2026-03-02", "usd_signed": "987654.32abc"}
            ]
    fake = _FakeSupabase(seed)
    job = {"id": "j-leak", "kind": "derive_allocator_equity", "allocator_id": "alloc-1"}

    from unittest.mock import patch

    with patch("services.job_worker.get_supabase", return_value=fake):
        result = await run_derive_allocator_equity_job(job)

    assert result.outcome.name == "FAILED"
    assert result.error_kind == "permanent"
    msg = result.error_message or ""
    assert "987654" not in msg and "987654.32" not in msg, (
        f"the scrubbed message must not leak the raw numeric magnitude; got {msg!r}"
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
    # A balance_error read stamps the reason so compose can degrade (non-dust).
    assert payload.get("anchor_null_reason") == "balance_error", (
        f"a balance_error read must stamp anchor_null_reason='balance_error'; "
        f"got {payload.get('anchor_null_reason')!r}"
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


def _persisted_ki_payload(capture: dict) -> dict:
    ki = [
        u for u in capture["upserts"]
        if u[0] == DERIVED_TABLE and _is_key_inputs_upsert(u[1])
    ]
    assert len(ki) == 1, f"expected one key_inputs upsert; got {capture['upserts']!r}"
    return _rows_of(ki[0][1])[0]["payload"]


def _persisted_anchor(capture: dict):
    return _persisted_ki_payload(capture)["anchor_usd"]


def _persisted_null_reason(capture: dict):
    # F1a×F3/M2 seam: the epilogue stamps WHY it nulled the anchor.
    return _persisted_ki_payload(capture).get("anchor_null_reason")


@pytest.mark.asyncio
async def test_pin_positive_anchor_persists_the_live_nav() -> None:
    """Neuter gap (paired positive for pin 8): a TRUSTWORTHY material positive live
    equity read persists that EXACT NAV as anchor_usd — proving the anchor is the
    equity read itself (the derivative-notional trap: NOT a value_usd/holdings sum)."""
    capture = await _run_key_epilogue_with_equity_read(123_456.78, balance_error=False)
    assert _persisted_anchor(capture) == 123_456.78, (
        "a trustworthy positive equity read must persist as the anchor verbatim"
    )
    # A real anchor carries NO null-reason token.
    assert _persisted_null_reason(capture) is None


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
        assert _persisted_null_reason(capture) == "nonfinite", (
            f"a non-finite equity must stamp anchor_null_reason='nonfinite'; "
            f"got {_persisted_null_reason(capture)!r}"
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
    assert _persisted_null_reason(capture) == "dust", (
        f"a dust equity must stamp anchor_null_reason='dust' (materiality omit); "
        f"got {_persisted_null_reason(capture)!r}"
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
    assert payload.get("anchor_null_reason") == "flow_drop", (
        f"a dropped flow must stamp anchor_null_reason='flow_drop'; "
        f"got {payload.get('anchor_null_reason')!r}"
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
    assert _persisted_null_reason(capture) == "nonpositive", (
        f"a negative equity must stamp anchor_null_reason='nonpositive'; "
        f"got {_persisted_null_reason(capture)!r}"
    )


# ---------------------------------------------------------------------------
# 167.1.2-05 — the persisted payload carries D-06 returns (version 2).
# The compose dict is upserted unchanged, so a deposit that steps the $-curve
# does not step the stored return. MUTATION-FALSIFIABLE: drop ``returns`` from
# the upserted payload → this test RED.
# ---------------------------------------------------------------------------


def _seed_one_key_deposit() -> dict[str, list[dict]]:
    """One eligible key, three days, a deposit on day 3. Hand-derivable."""
    alloc = "alloc-deposit"
    days = ["2026-06-01", "2026-06-02", "2026-06-03"]
    returns = [0.0, 0.0, 0.02]
    return {
        "api_keys": [
            {
                "id": "key-A",
                "user_id": alloc,
                "is_active": True,
                "sync_status": "connected",
                "disconnected_at": None,
                "exchange": "binance",
                "venue_account_id": "venue-A",
            },
        ],
        "csv_daily_returns": [
            {
                "api_key_id": "key-A",
                "allocator_id": alloc,
                "date": day,
                "daily_return": ret,
            }
            for day, ret in zip(days, returns)
        ],
        DERIVED_TABLE: [
            {
                "allocator_id": alloc,
                "kind": "key_inputs:key-A",
                "payload": {
                    "flows": [{"utc_day_iso": "2026-06-03", "usd_signed": 1000.0}],
                    "anchor_usd": 5100.0,
                    "anchor_asof": "2026-06-03",
                    "venue": "binance",
                },
            },
        ],
        LEGACY_TABLE: [],
    }


@pytest.mark.asyncio
async def test_one_key_deposit_persists_version_2_returns() -> None:
    """The upserted equity_curve payload is the compose payload: version 2 and a
    returns list of ISO dates and finite floats, ascending, whose day-3 entry is
    the key's own r (the deposit is not a return)."""
    import math

    from services.job_worker import run_derive_allocator_equity_job

    fake = _FakeSupabase(_seed_one_key_deposit())
    job = {
        "id": "j-deposit",
        "kind": "derive_allocator_equity",
        "allocator_id": "alloc-deposit",
    }

    from unittest.mock import patch

    with patch("services.job_worker.get_supabase", return_value=fake):
        result = await run_derive_allocator_equity_job(job)

    assert result.outcome.name == "DONE"
    curve_upserts = [
        u for u in fake.upserts
        if u[0] == DERIVED_TABLE and _is_equity_curve_upsert(u[1])
    ]
    assert len(curve_upserts) == 1, fake.upserts
    payload = _extract_payload(curve_upserts[0][1])
    assert payload.get("version") == 2
    returns = payload.get("returns")
    assert isinstance(returns, list) and returns, payload
    dates = [row["date"] for row in returns]
    assert dates == sorted(dates)
    assert all(
        isinstance(row["date"], str) and len(row["date"]) == 10 and row["date"][4] == "-"
        for row in returns
    )
    assert all(isinstance(row["r"], float) and math.isfinite(row["r"]) for row in returns)
    by_date = {row["date"]: row["r"] for row in returns}
    assert "2026-06-01" not in by_date
    assert by_date["2026-06-03"] == pytest.approx(0.02, abs=1e-12)
    curve = {point["date"]: point["equity_usd"] for point in payload["curve"]}
    level_ratio = curve["2026-06-03"] / curve["2026-06-02"] - 1.0
    assert abs(level_ratio - by_date["2026-06-03"]) > 1e-4


# ---------------------------------------------------------------------------
# 167.1.2-05 task 2 — identity gate over the counted set, and one account once.
# MUTATION-FALSIFIABLE: drop the duplicate branch (treat 'duplicate' as ordinary
# when the holder is working, and the keys do not share a venue id) → the
# duplicate test upserts a curve and goes RED.
# ---------------------------------------------------------------------------


def _gate_key(key_id: str, alloc: str, **extra: Any) -> dict[str, Any]:
    row: dict[str, Any] = {
        "id": key_id,
        "user_id": alloc,
        "is_active": True,
        "sync_status": "connected",
        "disconnected_at": None,
        "exchange": "binance",
        "venue_account_id": None,
        "account_shared_with_api_key_id": None,
        "account_share_kind": None,
    }
    row.update(extra)
    return row


def _stale_curve(alloc: str) -> dict[str, Any]:
    return {
        "allocator_id": alloc,
        "kind": "equity_curve",
        "payload": {
            "curve": [{"date": "2026-01-01", "equity_usd": 1.0}],
            "is_trustworthy": True,
        },
    }


def _series_rows(alloc: str, key_id: str, anchor: float) -> tuple[list[dict], dict]:
    """Three flat days and a key_inputs row so a single counted key can compose."""
    days = ["2026-06-01", "2026-06-02", "2026-06-03"]
    csv = [
        {
            "api_key_id": key_id,
            "allocator_id": alloc,
            "date": day,
            "daily_return": 0.0,
        }
        for day in days
    ]
    ki = {
        "allocator_id": alloc,
        "kind": f"key_inputs:{key_id}",
        "payload": {
            "flows": [],
            "anchor_usd": anchor,
            "anchor_asof": days[-1],
            "venue": "binance",
        },
    }
    return csv, ki


async def _run_gate(fake: _FakeSupabase, alloc: str):
    from unittest.mock import patch

    from services.job_worker import run_derive_allocator_equity_job

    job = {"id": "j-gate", "kind": "derive_allocator_equity", "allocator_id": alloc}
    with patch("services.job_worker.get_supabase", return_value=fake):
        return await run_derive_allocator_equity_job(job)


def _curve_upserts(fake: _FakeSupabase) -> list:
    return [
        u for u in fake.upserts
        if u[0] == DERIVED_TABLE and _is_equity_curve_upsert(u[1])
    ]


def _curve_deletes(fake: _FakeSupabase, alloc: str) -> list:
    return [
        d for d in fake.deletes
        if d[0] == DERIVED_TABLE
        and d[1].get("kind") == "equity_curve"
        and d[1].get("allocator_id") == alloc
    ]


def test_account_identity_collisions_intervals() -> None:
    """The helper is pure and interval-based. Overlap collides; a clipped
    rotation does not; NULL ids do not; two departed keys that share an id and
    an end day do. That last shape is what plan 09 feeds in."""
    from services.job_worker import account_identity_collisions

    def row(key_id: str, **extra: Any) -> dict[str, Any]:
        base = {
            "id": key_id,
            "exchange": "binance",
            "venue_account_id": "acct-1",
            "first_counted_day": "2026-01-01",
            "last_counted_day": "2026-03-01",
        }
        base.update(extra)
        return base

    overlap = account_identity_collisions([
        row("a", last_counted_day="2026-02-01"),
        row("b", first_counted_day="2026-01-15", last_counted_day="2026-04-01"),
    ])
    assert len(overlap) == 1 and overlap[0].n_keys == 2
    # Counts only — the group carries no id a log could leak.
    assert "acct-1" not in repr(overlap[0])
    assert "a" not in repr(overlap[0])

    clipped = account_identity_collisions([
        row("a", last_counted_day="2026-01-04"),
        row("b", first_counted_day="2026-01-05", last_counted_day="2026-02-01"),
    ])
    assert clipped == []

    unknown = account_identity_collisions([
        row("a", venue_account_id=None),
        row("b", venue_account_id=None),
    ])
    assert unknown == []
    # A blank id is not a shared account (pitfall 2). It collides with nothing,
    # including another blank.
    blank = account_identity_collisions([
        row("a", venue_account_id="  "),
        row("b", venue_account_id=""),
    ])
    assert blank == []

    departed = account_identity_collisions([
        row("a", first_counted_day="2026-01-01", last_counted_day="2026-03-01"),
        row("b", first_counted_day="2026-02-01", last_counted_day="2026-03-01"),
    ])
    assert len(departed) == 1 and departed[0].n_keys == 2

    live = account_identity_collisions([
        row("a", first_counted_day=None, last_counted_day=None),
        row("b", first_counted_day=None, last_counted_day=None),
    ])
    assert len(live) == 1 and live[0].n_keys == 2

    other_venue = account_identity_collisions([
        row("a", exchange="okx"),
        row("b", exchange="binance"),
    ])
    assert other_venue == []


@pytest.mark.asyncio
async def test_duplicate_with_working_holder_deletes_curve(caplog: pytest.LogCaptureFixture) -> None:
    """A marked duplicate whose holder is still connected is not counted on its
    own. The marker alone refuses the curve — the two keys need not share a
    venue id — and the log is the token plus counts, never an id."""
    import logging

    alloc = "alloc-dup"
    caplog.set_level(logging.INFO, logger="quantalyze.analytics.job_worker")
    csv, ki = _series_rows(alloc, "key-D", 1_000.0)
    _, holder_ki = _series_rows(alloc, "key-H", 1_000.0)
    fake = _FakeSupabase({
        "api_keys": [
            _gate_key(
                "key-D", alloc,
                venue_account_id="venue-dup",
                account_share_kind="duplicate",
                account_shared_with_api_key_id="key-H",
            ),
            _gate_key("key-H", alloc, venue_account_id="venue-holder"),
        ],
        "csv_daily_returns": csv,
        DERIVED_TABLE: [ki, holder_ki, _stale_curve(alloc)],
        LEGACY_TABLE: [],
    })
    result = await _run_gate(fake, alloc)
    assert result.outcome.name == "DONE"
    assert _curve_upserts(fake) == []
    assert len(_curve_deletes(fake, alloc)) == 1
    assert "account_duplicate" in caplog.text
    assert "account_identity_collision" not in caplog.text
    assert "key-D" not in caplog.text
    assert "venue-dup" not in caplog.text


@pytest.mark.asyncio
async def test_duplicate_with_revoked_holder_is_a_collision(caplog: pytest.LogCaptureFixture) -> None:
    """A revoked holder is not working, so the marked key counts on its own. The
    same venue id as another counted key is then a collision, not a duplicate."""
    import logging

    alloc = "alloc-revoked"
    caplog.set_level(logging.INFO, logger="quantalyze.analytics.job_worker")
    fake = _FakeSupabase({
        "api_keys": [
            _gate_key(
                "key-D", alloc,
                venue_account_id="venue-shared",
                account_share_kind="duplicate",
                account_shared_with_api_key_id="key-H",
            ),
            _gate_key("key-H", alloc, sync_status="revoked", venue_account_id="venue-shared"),
            _gate_key("key-X", alloc, venue_account_id="venue-shared"),
        ],
        "csv_daily_returns": [],
        DERIVED_TABLE: [_stale_curve(alloc)],
        LEGACY_TABLE: [],
    })
    result = await _run_gate(fake, alloc)
    assert result.outcome.name == "DONE"
    assert _curve_upserts(fake) == []
    assert len(_curve_deletes(fake, alloc)) == 1
    assert "account_identity_collision" in caplog.text
    assert "account_duplicate" not in caplog.text
    assert "key-D" not in caplog.text
    assert "venue-shared" not in caplog.text


@pytest.mark.asyncio
async def test_duplicate_with_disconnected_holder_is_a_collision(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """A disconnected holder is the same reader rule as a revoked one: the marked
    key is ordinary, and a shared venue id with another counted key collides."""
    import logging

    alloc = "alloc-disc"
    caplog.set_level(logging.INFO, logger="quantalyze.analytics.job_worker")
    fake = _FakeSupabase({
        "api_keys": [
            _gate_key(
                "key-D", alloc,
                venue_account_id="venue-shared",
                account_share_kind="duplicate",
                account_shared_with_api_key_id="key-H",
            ),
            _gate_key(
                "key-H", alloc,
                disconnected_at="2026-05-01T00:00:00+00:00",
                venue_account_id="venue-shared",
            ),
            _gate_key("key-X", alloc, venue_account_id="venue-shared"),
        ],
        "csv_daily_returns": [],
        DERIVED_TABLE: [_stale_curve(alloc)],
        LEGACY_TABLE: [],
    })
    result = await _run_gate(fake, alloc)
    assert result.outcome.name == "DONE"
    assert _curve_upserts(fake) == []
    assert "account_identity_collision" in caplog.text
    assert "account_duplicate" not in caplog.text


@pytest.mark.asyncio
async def test_duplicate_with_revoked_holder_counts_when_alone() -> None:
    """With the holder gone and no other counted key on the account, the marked
    key is an ordinary key: the curve is composed, not refused as a duplicate."""
    alloc = "alloc-alone"
    csv, ki = _series_rows(alloc, "key-D", 4_000.0)
    fake = _FakeSupabase({
        "api_keys": [
            _gate_key(
                "key-D", alloc,
                venue_account_id="venue-only",
                account_share_kind="duplicate",
                account_shared_with_api_key_id="key-H",
            ),
            _gate_key("key-H", alloc, sync_status="revoked", venue_account_id="venue-only"),
        ],
        "csv_daily_returns": csv,
        DERIVED_TABLE: [ki],
        LEGACY_TABLE: [],
    })
    result = await _run_gate(fake, alloc)
    assert result.outcome.name == "DONE"
    upserts = _curve_upserts(fake)
    assert len(upserts) == 1
    payload = _extract_payload(upserts[0][1])
    assert payload.get("version") == 2
    assert payload.get("is_trustworthy") is True


@pytest.mark.asyncio
async def test_two_keys_same_venue_without_marker_collide(caplog: pytest.LogCaptureFixture) -> None:
    """No duplicate marker, but two eligible keys share (exchange, venue id).
    Open intervals overlap, so the curve is deleted with the collision token."""
    import logging

    alloc = "alloc-collide"
    caplog.set_level(logging.INFO, logger="quantalyze.analytics.job_worker")
    fake = _FakeSupabase({
        "api_keys": [
            _gate_key("key-A", alloc, venue_account_id="venue-shared"),
            _gate_key("key-B", alloc, venue_account_id="venue-shared"),
        ],
        "csv_daily_returns": [],
        DERIVED_TABLE: [_stale_curve(alloc)],
        LEGACY_TABLE: [],
    })
    result = await _run_gate(fake, alloc)
    assert result.outcome.name == "DONE"
    assert _curve_upserts(fake) == []
    assert len(_curve_deletes(fake, alloc)) == 1
    assert "account_identity_collision" in caplog.text
    assert "key-A" not in caplog.text
    assert "venue-shared" not in caplog.text


@pytest.mark.asyncio
async def test_composite_member_counted_once_and_trustworthy() -> None:
    """A composite_member non-holder is left out of the compose. The holder stays,
    the shared account is flagged, and the payload stays trustworthy. The member's
    key_inputs row is not deleted — the key is still eligible."""
    alloc = "alloc-comp"
    csv_h, ki_h = _series_rows(alloc, "key-H", 100_000.0)
    csv_m, ki_m = _series_rows(alloc, "key-M", 100_000.0)
    fake = _FakeSupabase({
        "api_keys": [
            _gate_key("key-H", alloc, venue_account_id="venue-shared"),
            _gate_key(
                "key-M", alloc,
                venue_account_id="venue-shared",
                account_share_kind="composite_member",
                account_shared_with_api_key_id="key-H",
            ),
        ],
        "csv_daily_returns": csv_h + csv_m,
        DERIVED_TABLE: [ki_h, ki_m],
        LEGACY_TABLE: [],
    })
    result = await _run_gate(fake, alloc)
    assert result.outcome.name == "DONE"
    upserts = _curve_upserts(fake)
    assert len(upserts) == 1, fake.upserts
    payload = _extract_payload(upserts[0][1])
    assert "composite_shared_account_counted_once" in payload["flags"]
    assert payload["is_trustworthy"] is True
    assert payload["inputs"]["n_keys"] == 1
    terminal = payload["curve"][-1]["equity_usd"]
    assert terminal == pytest.approx(100_000.0, rel=1e-6)
    assert terminal < 150_000.0
    kinds = [row["kind"] for row in fake.rows[DERIVED_TABLE]]
    assert "key_inputs:key-M" in kinds
    assert "key_inputs:key-H" in kinds


# ---------------------------------------------------------------------------
# 167.1.2 C2 review CR-01 / SFH-01..03 — the D-18 working-holder rule.
#
# D-18 (founder, 2026-09-27; COMMENT ON COLUMN api_keys.account_share_kind in
# migration 20260927180000): a marked key counts through its holder only while
# the holder is WORKING — active, not disconnected, and a last sync that is NULL
# or not revoked / sign_in_failed / error. Before this fix the derive used the
# superseded rule (not disconnected, not revoked), so an inactive or failing
# holder deleted the curve as "account_duplicate". A naive predicate swap on its
# own would then SUM a failing-but-eligible holder and its healthy marked key:
# the marked key's venue_account_id is NULL (_mark_shared never writes it while
# the holder keeps the index slot), so the collision gate cannot see the pair.
#
# Fixtures are the production shape: the marked key carries NO venue id, the
# holder carries the shared one, and the two anchors DIFFER so the terminal
# equity names which key the account was counted through.
# ---------------------------------------------------------------------------

HOLDER_ANCHOR = 100_000.0
MARKED_ANCHOR = 60_000.0


def _shared_pair(alloc: str, kind: str, *, holder: dict[str, Any], marked: dict[str, Any] | None = None) -> _FakeSupabase:
    csv_h, ki_h = _series_rows(alloc, "key-H", HOLDER_ANCHOR)
    csv_m, ki_m = _series_rows(alloc, "key-M", MARKED_ANCHOR)
    return _FakeSupabase({
        "api_keys": [
            _gate_key("key-H", alloc, venue_account_id="venue-shared", **holder),
            _gate_key(
                "key-M", alloc,
                account_share_kind=kind,
                account_shared_with_api_key_id="key-H",
                **(marked or {}),
            ),
        ],
        "csv_daily_returns": csv_h + csv_m,
        DERIVED_TABLE: [ki_h, ki_m, _stale_curve(alloc)],
        LEGACY_TABLE: [],
    })


def _composed_payload(fake: _FakeSupabase) -> dict:
    upserts = _curve_upserts(fake)
    assert len(upserts) == 1, (
        f"expected one composed curve, got {len(upserts)} upserts and "
        f"{len(fake.deletes)} deletes"
    )
    return _extract_payload(upserts[0][1])


def test_working_holder_predicate_is_the_d18_rule() -> None:
    """The truth table of the D-18 rule, including the explicit NULL leg: a key
    that has never synced is WORKING (as eligible_key_predicate treats it)."""
    from services.allocator_equity_derive import working_holder_predicate

    base = {"is_active": True, "disconnected_at": None, "sync_status": "complete"}
    assert working_holder_predicate(base) is True
    assert working_holder_predicate({**base, "sync_status": None}) is True
    assert working_holder_predicate({**base, "sync_status": "complete_with_warnings"}) is True
    assert working_holder_predicate({**base, "sync_status": "rate_limited"}) is True
    assert working_holder_predicate({**base, "is_active": False}) is False
    assert working_holder_predicate({**base, "disconnected_at": "2026-09-01T00:00:00Z"}) is False
    for status in ("revoked", "sign_in_failed", "error"):
        assert working_holder_predicate({**base, "sync_status": status}) is False, status
    assert working_holder_predicate(None) is False


def test_working_holder_status_set_matches_ts_and_sql() -> None:
    """Parity: the Python set is the TS NOT_WORKING_SYNC_STATUSES set and the SQL
    tuple in migration 20260927180000. A status added to one side only would make
    the writer and the reader disagree on which key an account is counted through."""
    import re
    from pathlib import Path

    from services.allocator_equity_derive import NOT_WORKING_SYNC_STATUSES

    repo = Path(__file__).resolve().parents[2]
    ts = (repo / "src/lib/account-share-note.ts").read_text()
    ts_block = re.search(
        r"NOT_WORKING_SYNC_STATUSES[^=]*=\s*new Set\(\[(.*?)\]\)", ts, re.S
    )
    assert ts_block, "NOT_WORKING_SYNC_STATUSES not found in account-share-note.ts"
    ts_set = set(re.findall(r'"([a-z_]+)"', ts_block.group(1)))

    sql = (repo / "supabase/migrations/20260927180000_working_holder_rule_d18.sql").read_text()
    sql_tuple = re.search(r"v_sync_status NOT IN \(([^)]*)\)", sql)
    assert sql_tuple, "the D-18 status tuple not found in migration 20260927180000"
    sql_set = set(re.findall(r"'([a-z_]+)'", sql_tuple.group(1)))

    assert set(NOT_WORKING_SYNC_STATUSES) == ts_set == sql_set == {
        "revoked", "sign_in_failed", "error",
    }


@pytest.mark.asyncio
async def test_duplicate_of_an_inactive_holder_counts_on_its_own() -> None:
    """D-18: an inactive holder (not disconnected, not revoked) is not working.
    It is not eligible either, so the healthy marked key is the only key that
    can count the account. The old rule refused the curve as a duplicate."""
    alloc = "alloc-inactive"
    fake = _shared_pair(alloc, "duplicate", holder={"is_active": False})
    assert (await _run_gate(fake, alloc)).outcome.name == "DONE"
    payload = _composed_payload(fake)
    assert payload["is_trustworthy"] is True
    assert payload["inputs"]["n_keys"] == 1
    assert payload["curve"][-1]["equity_usd"] == pytest.approx(MARKED_ANCHOR, rel=1e-6)


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["error", "sign_in_failed"])
async def test_duplicate_of_a_failing_holder_is_counted_once_through_the_healthy_key(
    status: str,
) -> None:
    """D-18 holder-drop half: a failing holder is still ELIGIBLE (active, not
    revoked, not disconnected), so after the predicate swap it would be summed
    beside the now-ordinary marked key — one account counted twice, with no
    collision to catch it. The account is counted exactly once, through the
    healthy key; the failing holder leaves the sum (its key_inputs row stays)."""
    alloc = f"alloc-dup-{status}"
    fake = _shared_pair(alloc, "duplicate", holder={"sync_status": status})
    assert (await _run_gate(fake, alloc)).outcome.name == "DONE"
    payload = _composed_payload(fake)
    assert payload["inputs"]["n_keys"] == 1, "one account must be ONE counted key"
    terminal = payload["curve"][-1]["equity_usd"]
    assert terminal == pytest.approx(MARKED_ANCHOR, rel=1e-6), (
        f"counted through the failing holder or summed both: {terminal}"
    )
    assert "duplicate_shared_account_counted_once" in payload["flags"]
    kinds = [row["kind"] for row in fake.rows[DERIVED_TABLE]]
    assert "key_inputs:key-H" in kinds, "an eligible key's inputs are not an orphan"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "holder",
    [
        pytest.param({"sync_status": "error"}, id="holder-error"),
        pytest.param({"sync_status": "sign_in_failed"}, id="holder-sign-in-failed"),
        pytest.param({"is_active": False}, id="holder-inactive"),
    ],
)
async def test_composite_member_of_a_non_working_holder_counts_through_the_member(
    holder: dict[str, Any],
) -> None:
    """SFH-03: the composite branch used eligible_key_predicate, which admits a
    failing holder, so the stale holder was counted and the healthy member's P&L
    left the book as flat 0% days while the payload stayed trustworthy."""
    alloc = "alloc-comp-failing"
    fake = _shared_pair(alloc, "composite_member", holder=holder)
    assert (await _run_gate(fake, alloc)).outcome.name == "DONE"
    payload = _composed_payload(fake)
    assert payload["inputs"]["n_keys"] == 1
    assert payload["curve"][-1]["equity_usd"] == pytest.approx(MARKED_ANCHOR, rel=1e-6)


@pytest.mark.asyncio
async def test_shared_account_with_no_working_key_is_counted_once_and_loudly(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Neither key of the pair is working (both eligible, both failing). The
    account is still counted exactly once — through the holder, whose history is
    kept — never twice and never as $0, and the job says so at WARNING with a
    flag on the payload."""
    import logging

    alloc = "alloc-none-working"
    caplog.set_level(logging.INFO, logger="quantalyze.analytics.job_worker")
    fake = _shared_pair(
        alloc, "duplicate",
        holder={"sync_status": "error"},
        marked={"sync_status": "sign_in_failed"},
    )
    assert (await _run_gate(fake, alloc)).outcome.name == "DONE"
    payload = _composed_payload(fake)
    assert payload["inputs"]["n_keys"] == 1
    assert payload["curve"][-1]["equity_usd"] == pytest.approx(HOLDER_ANCHOR, rel=1e-6)
    assert "shared_account_no_working_key" in payload["flags"]
    warnings = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert any("no working key" in r.getMessage() for r in warnings), caplog.text
    assert "key-H" not in caplog.text and "venue-shared" not in caplog.text


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("keys", "token"),
    [
        pytest.param(
            [
                _gate_key(
                    "key-D", "alloc-refuse",
                    account_share_kind="duplicate",
                    account_shared_with_api_key_id="key-H",
                ),
                _gate_key("key-H", "alloc-refuse", venue_account_id="venue-holder"),
            ],
            "account_duplicate",
            id="duplicate",
        ),
        pytest.param(
            [
                _gate_key("key-A", "alloc-refuse", venue_account_id="venue-shared"),
                _gate_key("key-B", "alloc-refuse", venue_account_id="venue-shared"),
            ],
            "account_identity_collision",
            id="collision",
        ),
    ],
)
async def test_identity_refusal_is_a_warning_not_info(
    caplog: pytest.LogCaptureFixture, keys: list[dict[str, Any]], token: str
) -> None:
    """C2 silent-failure SFH-07: the identity refusal deletes the allocator's
    curve and ends the job DONE. At INFO nobody can find out from the logs why
    the curve keeps disappearing. It logs at WARNING: token and counts only."""
    import logging

    alloc = "alloc-refuse"
    caplog.set_level(logging.INFO, logger="quantalyze.analytics.job_worker")
    fake = _FakeSupabase({
        "api_keys": keys,
        "csv_daily_returns": [],
        DERIVED_TABLE: [_stale_curve(alloc)],
        LEGACY_TABLE: [],
    })
    assert (await _run_gate(fake, alloc)).outcome.name == "DONE"
    assert len(_curve_deletes(fake, alloc)) == 1
    refusals = [r for r in caplog.records if token in r.getMessage()]
    assert refusals, caplog.text
    assert all(r.levelno == logging.WARNING for r in refusals), [
        logging.getLevelName(r.levelno) for r in refusals
    ]


@pytest.mark.asyncio
async def test_composite_pair_keeps_the_key_whose_history_starts_first() -> None:
    """C2 review WR-01 (C1 WR-03): the marker's direction follows stamp order,
    not seniority, so during the backfill window the HOLDER is often the newer
    key. Keeping the holder dropped the older member's earlier returns while the
    benign composite flag kept the shortened curve trustworthy. Of two working
    members the one whose returns start first is counted."""
    alloc = "alloc-comp-older-member"
    early = ["2026-05-29", "2026-05-30", "2026-05-31", "2026-06-01", "2026-06-02", "2026-06-03"]
    csv_h, ki_h = _series_rows(alloc, "key-H", HOLDER_ANCHOR)
    _, ki_m = _series_rows(alloc, "key-M", MARKED_ANCHOR)
    csv_m = [
        {"api_key_id": "key-M", "allocator_id": alloc, "date": day, "daily_return": 0.0}
        for day in early
    ]
    fake = _FakeSupabase({
        "api_keys": [
            _gate_key("key-H", alloc, venue_account_id="venue-shared"),
            _gate_key(
                "key-M", alloc,
                account_share_kind="composite_member",
                account_shared_with_api_key_id="key-H",
            ),
        ],
        "csv_daily_returns": csv_h + csv_m,
        DERIVED_TABLE: [ki_h, ki_m],
        LEGACY_TABLE: [],
    })
    assert (await _run_gate(fake, alloc)).outcome.name == "DONE"
    payload = _composed_payload(fake)
    assert payload["inputs"]["n_keys"] == 1
    assert payload["curve"][0]["date"] <= "2026-05-30", payload["curve"][0]
    assert payload["curve"][-1]["equity_usd"] == pytest.approx(MARKED_ANCHOR, rel=1e-6)
    assert "composite_shared_account_counted_once" in payload["flags"]


# ---------------------------------------------------------------------------
# C2 round 2: SFH-R2-03 (high) / R2 IN-01. D-18's working-first rule keeps the
# WORKING member of a shared account. When that member's series starts later
# than a failing member's (a key rotation: the new key's reconstruct depth is
# shorter than the old key's accumulated history), round 1 dropped the older
# history under a benign *_counted_once flag, and the book read "ready" over
# the shortened window. The account is one series: the failing member's
# returns are used for the days BEFORE the kept member's first return day
# (D-09 case (2) ordering), with that member's flows for those days, so the
# history keeps its start and nothing is counted twice. Where that cannot be
# done honestly (a gap between the two series, or no flows for the older
# days) the book is untrustworthy, never benign.
# ---------------------------------------------------------------------------

_ROTATION_OLD_DAYS = [f"2026-05-{d:02d}" for d in range(1, 32)] + [
    "2026-06-01", "2026-06-02", "2026-06-03",
]
_ROTATION_NEW_DAYS = ["2026-06-01", "2026-06-02", "2026-06-03"]


def _rotation_pair(
    alloc: str,
    kind: str,
    *,
    old_days: list[str] | None = None,
    old_flows: list[dict[str, Any]] | None = None,
    new_flows: list[dict[str, Any]] | None = None,
    old_key_inputs: bool = True,
    old_null_reason: str | None = None,
) -> _FakeSupabase:
    """The SFH-R2-03 measurement: old key H (the holder, stamped) fails with
    sign_in_failed and holds returns from 2026-05-01 through 2026-06-03; new
    key M (marked ``kind``) works and holds returns from 2026-06-01. H's return
    on the overlap days is 0.5, so a curve that used it there is visibly wrong."""
    days = old_days if old_days is not None else _ROTATION_OLD_DAYS
    csv = [
        {
            "api_key_id": "key-H", "allocator_id": alloc, "date": day,
            "daily_return": 0.5 if day >= "2026-06-01" else 0.001,
        }
        for day in days
    ] + [
        {"api_key_id": "key-M", "allocator_id": alloc, "date": day, "daily_return": 0.002}
        for day in _ROTATION_NEW_DAYS
    ]
    derived: list[dict[str, Any]] = [
        {
            "allocator_id": alloc, "kind": "key_inputs:key-M",
            "payload": {
                "flows": new_flows or [], "anchor_usd": MARKED_ANCHOR,
                "anchor_asof": "2026-06-03", "venue": "binance",
            },
        },
        _stale_curve(alloc),
    ]
    if old_key_inputs:
        derived.append({
            "allocator_id": alloc, "kind": "key_inputs:key-H",
            "payload": {
                "flows": old_flows or [],
                "anchor_usd": None if old_null_reason else HOLDER_ANCHOR,
                "anchor_null_reason": old_null_reason,
                "anchor_asof": "2026-06-03", "venue": "binance",
            },
        })
    return _FakeSupabase({
        "api_keys": [
            _gate_key(
                "key-H", alloc, venue_account_id="venue-shared", sync_status="sign_in_failed"
            ),
            _gate_key(
                "key-M", alloc,
                account_share_kind=kind,
                account_shared_with_api_key_id="key-H",
            ),
        ],
        "csv_daily_returns": csv,
        DERIVED_TABLE: derived,
        LEGACY_TABLE: [],
    })


def _expected_stitched_curve(flows: list[tuple[str, float]]) -> list[tuple[str, float]]:
    """The account's one series, replayed from M's anchor: H's returns before
    2026-06-01, M's from it, the given flows."""
    import pandas as pd

    from services.allocator_equity_derive import replay_key_equity

    days = [d for d in _ROTATION_OLD_DAYS if d < "2026-06-01"] + _ROTATION_NEW_DAYS
    returns = pd.Series(
        [0.001 if d < "2026-06-01" else 0.002 for d in days], index=days, dtype="float64"
    )
    equity = replay_key_equity(returns, flows, MARKED_ANCHOR).equity
    assert equity is not None
    return [(str(d), float(v)) for d, v in equity.items()]


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["duplicate", "composite_member"])
async def test_a_working_newer_key_is_stitched_onto_the_failing_older_keys_history(
    kind: str,
) -> None:
    """SFH-R2-03, the reviewer's measurement: before the fix the curve started
    on 2026-06-01 with n=3, trustworthy, flags only *_counted_once. The book's
    history keeps H's start, the account is still one counted key, the terminal
    is M's anchor, and H's overlap-day returns (0.5) are not used."""
    alloc = f"alloc-stitch-{kind}"
    fake = _rotation_pair(alloc, kind)
    assert (await _run_gate(fake, alloc)).outcome.name == "DONE"
    payload = _composed_payload(fake)
    assert payload["inputs"]["n_keys"] == 1
    assert payload["curve"][0]["date"] == "2026-05-01", payload["curve"][0]
    assert payload["is_trustworthy"] is True, payload["degrade_reasons"]
    assert "shared_account_history_stitched" in payload["flags"]
    got = [(row["date"], row["equity_usd"]) for row in payload["curve"]]
    expected = _expected_stitched_curve([])
    assert [d for d, _ in got] == [d for d, _ in expected]
    for (day, value), (_, want) in zip(got, expected):
        assert value == pytest.approx(want, rel=1e-9), day
    assert payload["curve"][-1]["equity_usd"] == pytest.approx(MARKED_ANCHOR, rel=1e-9)


@pytest.mark.asyncio
async def test_a_stitched_account_takes_each_days_flows_from_the_key_that_owns_the_day() -> None:
    """One account, one set of transfers. H's flows are the account's flows
    for H's days, M's for M's days. M's own crawl may reach back over H's days
    and list the same May deposit; counting it from both keys would put the
    deposit into the curve twice."""
    alloc = "alloc-stitch-flows"
    may_deposit = {"utc_day_iso": "2026-05-15", "usd_signed": 10_000.0}
    june_withdrawal = {"utc_day_iso": "2026-06-02", "usd_signed": -5_000.0}
    fake = _rotation_pair(
        alloc, "duplicate",
        old_flows=[may_deposit, {"utc_day_iso": "2026-06-02", "usd_signed": -99.0}],
        new_flows=[may_deposit, june_withdrawal],
    )
    assert (await _run_gate(fake, alloc)).outcome.name == "DONE"
    payload = _composed_payload(fake)
    assert payload["is_trustworthy"] is True, payload["degrade_reasons"]
    expected = _expected_stitched_curve([("2026-05-15", 10_000.0), ("2026-06-02", -5_000.0)])
    got = [(row["date"], row["equity_usd"]) for row in payload["curve"]]
    assert [d for d, _ in got] == [d for d, _ in expected]
    for (day, value), (_, want) in zip(got, expected):
        assert value == pytest.approx(want, rel=1e-9), day


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "case",
    [
        pytest.param("gap", id="the-older-series-ends-before-the-newer-starts"),
        pytest.param("no_key_inputs", id="the-older-key-has-no-flows-row"),
        pytest.param("flow_drop", id="the-older-keys-flows-were-cut"),
    ],
)
async def test_a_shared_account_whose_history_cannot_be_stitched_is_not_trustworthy(
    case: str,
) -> None:
    """Where the older history cannot be joined honestly, the curve keeps the
    newer key's shorter window and says so with a BLOCKING reason, so the
    reader holds the book instead of showing a shortened history as ready.
    A gap between the two series leaves days whose returns nobody holds; a
    missing or cut flow list would mis-level every older day."""
    alloc = f"alloc-trunc-{case}"
    if case == "gap":
        fake = _rotation_pair(
            alloc, "duplicate",
            old_days=[f"2026-05-{d:02d}" for d in range(1, 21)],
        )
    elif case == "no_key_inputs":
        fake = _rotation_pair(alloc, "duplicate", old_key_inputs=False)
    else:
        fake = _rotation_pair(alloc, "duplicate", old_null_reason="flow_drop")
    assert (await _run_gate(fake, alloc)).outcome.name == "DONE"
    payload = _composed_payload(fake)
    assert payload["curve"][0]["date"] == "2026-06-01", payload["curve"][0]
    assert payload["is_trustworthy"] is False
    assert "shared_account_history_truncated" in payload["degrade_reasons"]
    assert "shared_account_history_stitched" not in payload["flags"]


@pytest.mark.asyncio
async def test_duplicate_whose_marked_key_fails_behind_a_working_holder_still_refuses() -> None:
    """Reader parity (queries.ts countsAsDuplicate): an ELIGIBLE duplicate-marked
    key whose holder is working is a duplicate, whatever the marked key's own
    status. The curve is refused, as before."""
    alloc = "alloc-dup-marked-failing"
    fake = _shared_pair(alloc, "duplicate", holder={}, marked={"sync_status": "error"})
    assert (await _run_gate(fake, alloc)).outcome.name == "DONE"
    assert _curve_upserts(fake) == []
    assert len(_curve_deletes(fake, alloc)) == 1


@pytest.mark.asyncio
async def test_compose_does_not_read_legacy_snapshots() -> None:
    """The fake raises on any read of allocator_equity_snapshots. The job still
    composes — that table is not an input, so a duplicate-writer date cannot
    reach the curve."""
    alloc = "alloc-deposit"
    fake = _FakeSupabase(_seed_one_key_deposit())
    # Prove the fake itself refuses the read, then that the job never trips it.
    with pytest.raises(_LegacyWriteError):
        fake.table(LEGACY_TABLE).select("date").execute()
    result = await _run_gate(fake, alloc)
    assert result.outcome.name == "DONE"
    upserts = _curve_upserts(fake)
    assert len(upserts) == 1
    payload = _extract_payload(upserts[0][1])
    assert payload.get("version") == 2
    selects = [name for name, _cols in fake.selects]
    assert LEGACY_TABLE not in selects
    assert any(
        name == "api_keys" and "account_share_kind" in str(cols)
        and "venue_account_id" in str(cols)
        and "exchange" in str(cols)
        and "account_shared_with_api_key_id" in str(cols)
        for name, cols in fake.selects
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
