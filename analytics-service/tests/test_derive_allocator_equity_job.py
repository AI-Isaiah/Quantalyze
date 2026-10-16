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

from services.nav_twr import DUST_NAV_FLOOR

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
        self._order: list[tuple[str, bool]] = []
        self._range: tuple[int, int] | None = None
        self._gt: list[tuple[str, Any]] = []
        self._limit: int | None = None
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

    def order(self, col: str, desc: bool = False) -> "_FakeTable":
        self._order.append((col, desc))
        self._store.orders.append((self._name, col, desc))
        return self

    def gt(self, col: str, val: Any) -> "_FakeTable":
        # A keyset cursor. ISO dates compare correctly as strings.
        self._gt.append((col, val))
        return self

    def limit(self, n: int) -> "_FakeTable":
        self._limit = n
        return self

    def range(self, start: int, end: int) -> "_FakeTable":
        # PostgREST's range is INCLUSIVE of `end`. A new range replaces the last
        # one, as paginated_select re-ranges the same ordered builder per page.
        self._range = (start, end)
        return self

    def _rows(self) -> list[dict]:
        rows = self._store.rows.get(self._name, [])
        out = []
        for r in rows:
            if all(r.get(c) == v for c, v in self._filters) and all(
                r.get(c) is not None and str(r.get(c)) > str(v) for c, v in self._gt
            ):
                ok = True
                for c, pat in self._like:
                    prefix = pat.rstrip("%")
                    if not str(r.get(c, "")).startswith(prefix):
                        ok = False
                if ok:
                    out.append(r)
        # Apply ORDER BY right-to-left over a stable sort, so the first column
        # is the primary key. str() keeps a row that lacks a column sortable.
        for col, desc in reversed(self._order):
            out = sorted(out, key=lambda r, c=col: str(r.get(c)), reverse=desc)
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
        out = self._rows()
        if self._range is not None:
            start, end = self._range
            out = out[start:end + 1]
        if self._limit is not None:
            out = out[: self._limit]
        if self._store.max_rows is not None:
            # PostgREST's per-response cap (supabase/config.toml max_rows = 1000):
            # a bare read returns the first max_rows rows and no error.
            out = out[: self._store.max_rows]
        # Copy the rows, as a response is a fresh JSON decode: a later write to
        # the store must not reach back into a page already read.
        out = [dict(r) for r in out]
        if self._store.on_read is not None:
            # The response is already built, so a write the hook makes lands
            # BETWEEN this read and the next one, as a concurrent writer's would.
            self._store.on_read(self._name)
        return _R(out)


class _FakeSupabase:
    def __init__(
        self, rows: dict[str, list[dict]], max_rows: int | None = None
    ) -> None:
        self.rows = rows
        # None = no response cap, the default every older test in this file uses.
        self.max_rows = max_rows
        # Fired after each read's response is built (C3 round 2 race tests).
        self.on_read: Any = None
        self.orders: list[tuple[str, str, bool]] = []
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
async def test_pin_f2_permanent_failure_records_refusal_for_stale_curve() -> None:
    """F2: a poison structural input → permanent FAILED → the stale equity_curve
    row is REPLACED by a refusal record, never left rendering as trustworthy.
    167.1.2.1.1 D-04: it used to be deleted, which let the reader say the history
    is recomputed daily; the row now names ``compose_refused``."""
    from services.job_worker import run_derive_allocator_equity_job

    fake = _FakeSupabase(_seed_poison_with_stale_curve())
    job = {"id": "j-poison", "kind": "derive_allocator_equity", "allocator_id": "alloc-poison"}

    from unittest.mock import patch

    with patch("services.job_worker.get_supabase", return_value=fake):
        result = await run_derive_allocator_equity_job(job)

    assert result.outcome.name == "FAILED"
    assert result.error_kind == "permanent"
    _assert_refusal_recorded(fake, "alloc-poison", "compose_refused")


@pytest.mark.asyncio
async def test_pin_f2_corrupt_input_permanent_records_refusal() -> None:
    """F2: the M3 corrupt-input permanent disposition also replaces the stale row
    (167.1.2.1.1 D-04: with an ``input_corrupt`` refusal record, not a delete)."""
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
    _assert_refusal_recorded(fake, "alloc-poison", "input_corrupt")


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
    and must refuse: replace the equity_curve row with a ``compose_incomplete``
    refusal record (167.1.2.1.1 D-04; it used to be deleted), NEVER compose a
    trustworthy 1-of-2-capital curve."""
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
    # The stale equity_curve row is replaced by the refusal record, not deleted.
    _assert_refusal_recorded(fake, "alloc-partial", "compose_incomplete")


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
async def test_pin_b2_empty_compose_records_refusal_no_curve() -> None:
    """B2 (root cause): a zero-anchored-keys / empty-curve compose must NOT upsert
    an empty equity_curve CURVE row and MUST replace any existing one (never a
    blank chart labeled 'derived', never a stale trustworthy row surviving a
    structurally-empty recompute — this also closes L1). 167.1.2.1.1 D-04: it is
    replaced by a refusal record, not deleted. This seed has no key_inputs row, so
    the job stops at F1b and the token is ``compose_incomplete``; the B2 tokens
    themselves (``compose_empty``, ``compose_empty_blocked``) are pinned by
    ``test_every_refusal_path_persists_a_reason_row``."""
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
    # The stale equity_curve row was replaced (scoped to this allocator + kind).
    _assert_refusal_recorded(fake, "alloc-empty", "compose_incomplete")


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
    # No poison equity_curve upsert on a structural failure; the row holds the
    # refusal record instead (167.1.2.1.1 D-04).
    assert [u for u in fake.upserts if _is_equity_curve_upsert(u[1])] == []
    _assert_refusal_recorded(fake, "alloc-1", "compose_refused")


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
    """M2: a dust equity (|equity| <= DUST_NAV_FLOOR=$100, D-27) is immaterial — the
    epilogue must persist a null anchor, consistent with the function's materiality
    contract (:2651-2655), never a trustworthy near-zero curve basis.

    167.1.2 D-27 moved the floor from 1000 to 100, so the dust equity here is re-aimed from
    500 to 50; the sibling ``test_pin_m2_d27_500_equity_is_a_real_anchor`` pins the old 500."""
    capture = await _run_key_epilogue_with_equity_read(50.0, balance_error=False)
    assert _persisted_anchor(capture) is None, (
        "a dust equity must persist anchor_usd null (materiality contract)"
    )
    assert _persisted_null_reason(capture) == "dust", (
        f"a dust equity must stamp anchor_null_reason='dust' (materiality omit); "
        f"got {_persisted_null_reason(capture)!r}"
    )


@pytest.mark.asyncio
async def test_pin_m2_d27_500_equity_is_a_real_anchor() -> None:
    """167.1.2 D-27 sibling of ``test_pin_m2_dust_equity_persists_null_anchor``: with the dust
    floor at 100 an equity of 500 (dust under the old 1000 floor) is a real anchor, so the
    epilogue persists it and stamps no 'dust' reason. Fails if the floor returns to 1000."""
    capture = await _run_key_epilogue_with_equity_read(500.0, balance_error=False)
    assert _persisted_anchor(capture) == pytest.approx(500.0), (
        "a $500 equity is above the D-27 floor of 100 and must persist as the anchor"
    )
    assert _persisted_null_reason(capture) != "dust", (
        f"a $500 equity must not be stamped dust; got {_persisted_null_reason(capture)!r}"
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


def _refusal_upserts(fake: _FakeSupabase) -> list:
    """The ``equity_curve`` upserts that are a derive REFUSAL (SC-1, D-04): the
    payload's ``refusal`` is a token string. ``_curve_upserts`` excludes them.
    Each entry is ``(table, row, on_conflict)`` with ``row`` the single upserted
    row."""
    return [
        (table, row, on_conflict)
        for table, payload, on_conflict in fake.upserts
        if table == DERIVED_TABLE
        for row in _rows_of(payload)
        if row.get("kind") == "equity_curve"
        and isinstance(row.get("payload"), dict)
        and isinstance(row["payload"].get("refusal"), str)
    ]


def _assert_refusal_recorded(fake: _FakeSupabase, alloc: str, token: str) -> None:
    """167.1.2.1.1 SC-1 (D-04): the refusal is ONE atomic upsert of the
    ``equity_curve`` row naming ``token``, no curve is written, nothing is deleted."""
    refusals = _refusal_upserts(fake)
    assert [r["payload"]["refusal"] for _, r, _ in refusals] == [token], fake.upserts
    assert refusals[0][1]["allocator_id"] == alloc
    assert _curve_upserts(fake) == []
    assert _curve_deletes(fake, alloc) == [], fake.deletes


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

    # C2 round 2, IN-02 (round-1 IN-01): the venue is compared case-blind, as
    # every other reader of api_keys.exchange in this phase compares it
    # (_polled_empty_since, the refresh's identity rule, the TS reader). One
    # account behind "Binance" and "binance " is still one account.
    mixed_case = account_identity_collisions([
        row("a", exchange="Binance"),
        row("b", exchange="binance "),
    ])
    assert len(mixed_case) == 1 and mixed_case[0].n_keys == 2


@pytest.mark.asyncio
async def test_duplicate_with_working_holder_records_refusal(caplog: pytest.LogCaptureFixture) -> None:
    """A marked duplicate whose holder is still connected is not counted on its
    own. The marker alone refuses the curve — the two keys need not share a
    venue id — and the log is the token plus counts, never an id. 167.1.2.1.1
    D-04: the refusal is recorded in the row (``account_duplicate``), not deleted."""
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
    _assert_refusal_recorded(fake, alloc, "account_duplicate")
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
    # 167.1.2.1.1 SC-1 (D-04): the refusal is recorded, not deleted.
    assert [r["payload"]["refusal"] for _, r, _ in _refusal_upserts(fake)] == [
        "account_identity_collision"
    ]
    assert _curve_deletes(fake, alloc) == []
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
    Open intervals overlap, so the curve is refused with the collision token
    (167.1.2.1.1 SC-1, D-04: the refusal is recorded in the row, not deleted)."""
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
    # 167.1.2.1.1 SC-1 (D-04): the refusal is recorded, not deleted.
    assert [r["payload"]["refusal"] for _, r, _ in _refusal_upserts(fake)] == [
        "account_identity_collision"
    ]
    assert _curve_deletes(fake, alloc) == []
    assert "account_identity_collision" in caplog.text
    assert "key-A" not in caplog.text
    assert "venue-shared" not in caplog.text


@pytest.mark.asyncio
async def test_identity_collision_persists_its_refusal_reason() -> None:
    """Phase 167.1.2.1.1 SC-1 (D-04). Two unmarked keys on one venue collide, and
    the derive refuses the curve. It used to DELETE the row, so the reader fell
    back to "recomputed daily" for a book the derive refuses every day. It now
    replaces the row in ONE atomic upsert with a version-2 refusal payload that
    names the token, so no stale trustworthy curve survives and the reason is on
    disk. Nothing is deleted."""
    alloc = "alloc-collide-persist"
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
    refusals = _refusal_upserts(fake)
    assert len(refusals) == 1, "one atomic upsert of the refusal row"
    table, rows, on_conflict = refusals[0]
    assert table == DERIVED_TABLE
    assert on_conflict == "allocator_id,kind"
    assert rows["allocator_id"] == alloc and rows["kind"] == "equity_curve"
    payload = rows["payload"]
    assert payload["version"] == 2
    assert payload["is_trustworthy"] is False
    assert payload["curve"] == [] and payload["returns"] == []
    assert payload["refusal"] == "account_identity_collision"
    assert "account_identity_collision" in payload["degrade_reasons"]
    assert _curve_upserts(fake) == [], "a refusal row is not a curve"
    assert _curve_deletes(fake, alloc) == [], "the refusal replaces the row; nothing is deleted"


def _refusal_case_returns_read_cap() -> dict[str, Any]:
    rows, _first, _last = _seed_long_history()
    rows[DERIVED_TABLE].append(_stale_curve(_LONG_ALLOC))
    return {
        "fake": _FakeSupabase(rows),
        "alloc": _LONG_ALLOC,
        "token": "returns_read_cap",
        "outcome": "FAILED",
        "truncate_returns": True,
    }


def _refusal_case_duplicate() -> dict[str, Any]:
    alloc = "alloc-refusal-dup"
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
    return {"fake": fake, "alloc": alloc, "token": "account_duplicate", "outcome": "DONE"}


def _refusal_case_input_corrupt() -> dict[str, Any]:
    seed = _seed_poison_with_stale_curve()
    # A NULL daily_return: float(None) raises, the M3 permanent disposition.
    seed["csv_daily_returns"][1]["daily_return"] = None
    return {
        "fake": _FakeSupabase(seed), "alloc": "alloc-poison",
        "token": "input_corrupt", "outcome": "FAILED",
    }


def _refusal_case_compose_incomplete() -> dict[str, Any]:
    return {
        "fake": _FakeSupabase(_seed_partial_backfill()), "alloc": "alloc-partial",
        "token": "compose_incomplete", "outcome": "DONE",
    }


def _refusal_case_compose_empty() -> dict[str, Any]:
    """B2 with a TRUSTWORTHY empty compose. The only key has a key_inputs row (so
    it is visible and F1b does not refuse) whose anchor is NULL for the benign
    reason ``dust``, and no returns: the compose omits it, composes nothing and
    stays trustworthy. (``_seed_zero_anchored_with_stale_curve`` has NO key_inputs
    row, so it stops earlier, at F1b, as ``compose_incomplete``.)"""
    alloc = "alloc-empty-dust"
    fake = _FakeSupabase({
        "csv_daily_returns": [],
        DERIVED_TABLE: [
            {"allocator_id": alloc, "kind": "key_inputs:key-Z",
             "payload": {"flows": [], "anchor_usd": None, "venue": "binance",
                         "anchor_null_reason": "dust"}},
            _stale_curve(alloc),
        ],
        LEGACY_TABLE: [],
        "api_keys": [_gate_key("key-Z", alloc)],
    })
    return {"fake": fake, "alloc": alloc, "token": "compose_empty", "outcome": "DONE"}


def _refusal_case_compose_empty_blocked() -> dict[str, Any]:
    """The only key has an anchor and NO returns: the compose drops it as
    DROPPED_KEY (blocking), so the compose is empty AND untrustworthy."""
    alloc = "alloc-empty-blocked"
    fake = _FakeSupabase({
        "csv_daily_returns": [],
        DERIVED_TABLE: [
            {"allocator_id": alloc, "kind": "key_inputs:key-Z",
             "payload": {"flows": [], "anchor_usd": 50_000.0, "venue": "binance"}},
            _stale_curve(alloc),
        ],
        LEGACY_TABLE: [],
        "api_keys": [_gate_key("key-Z", alloc)],
    })
    return {
        "fake": fake, "alloc": alloc, "token": "compose_empty_blocked",
        "outcome": "DONE", "blocking": ["dropped_key"],
    }


def _refusal_case_compose_refused() -> dict[str, Any]:
    return {
        "fake": _FakeSupabase(_seed_poison_with_stale_curve()), "alloc": "alloc-poison",
        "token": "compose_refused", "outcome": "FAILED",
    }


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "build",
    [
        _refusal_case_returns_read_cap,
        _refusal_case_duplicate,
        _refusal_case_input_corrupt,
        _refusal_case_compose_incomplete,
        _refusal_case_compose_empty,
        _refusal_case_compose_empty_blocked,
        _refusal_case_compose_refused,
    ],
    ids=lambda b: b.__name__.removeprefix("_refusal_case_"),
)
async def test_every_refusal_path_persists_a_reason_row(build: Any) -> None:
    """Phase 167.1.2.1.1 SC-1 (D-04): every derive refusal path used to DELETE the
    allocator's equity_curve row, so the reader fell back to "recomputed daily"
    for a book the derive refuses every day. Each now replaces the row in ONE
    atomic upsert with a version-2 payload that names the token, and deletes
    nothing. The stale trustworthy curve is gone either way (T-167.1.2.1.1-01):
    the upsert replaces it. The job outcome of each path is unchanged."""
    from contextlib import ExitStack
    from unittest.mock import patch

    from services.db import PaginatedSelectTruncated

    case = build()
    fake, alloc = case["fake"], case["alloc"]
    with ExitStack() as stack:
        if case.get("truncate_returns"):
            def _boom(*_a: Any, **_kw: Any) -> list[dict]:
                raise PaginatedSelectTruncated(page_count=1000, page_size=1000, hint="probe")

            stack.enter_context(
                patch("services.job_worker._load_allocator_daily_returns", side_effect=_boom)
            )
        result = await _run_gate(fake, alloc)

    assert result.outcome.name == case["outcome"], result
    if case["outcome"] == "FAILED":
        assert result.error_kind == "permanent", result.error_kind
    refusals = _refusal_upserts(fake)
    assert len(refusals) == 1, f"one atomic refusal upsert, got {fake.upserts!r}"
    _table, row, on_conflict = refusals[0]
    assert on_conflict == "allocator_id,kind"
    assert row["allocator_id"] == alloc and row["kind"] == "equity_curve"
    payload = row["payload"]
    assert payload["refusal"] == case["token"]
    assert payload["version"] == 2
    assert payload["is_trustworthy"] is False
    assert payload["curve"] == [] and payload["returns"] == []
    assert payload["degrade_reasons"] == sorted([case["token"], *case.get("blocking", [])])
    assert _curve_upserts(fake) == [], "a refusal row is not a curve"
    assert _curve_deletes(fake, alloc) == [], "nothing is deleted; the row is replaced"


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
    kept — never twice and never as $0, and the job says so at WARNING.

    C2 round 2, SFH-R2-04: the account's series stopped when its keys began
    failing and is carried flat at r = 0 while the rest of the book moves, so
    the book's return is diluted by frozen capital. Round 1 raised a BENIGN
    flag nobody reads and the book read "ready". It is now a BLOCKING degrade
    reason: the curve is untrustworthy and the reader holds the book."""
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
    assert "shared_account_no_working_key" in payload["degrade_reasons"]
    assert "shared_account_no_working_key" not in payload["flags"]
    assert payload["is_trustworthy"] is False
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
    """C2 silent-failure SFH-07: the identity refusal replaces the allocator's
    curve with a refusal record and ends the job DONE. At INFO nobody can find out
    from the logs why the curve keeps disappearing. It logs at WARNING: token and
    counts only."""
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
    # 167.1.2.1.1 SC-1 (D-04): recorded in the row, not deleted.
    _assert_refusal_recorded(fake, alloc, token)
    refusals = [r for r in caplog.records if token in r.getMessage()]
    assert refusals, caplog.text
    assert all(r.levelno == logging.WARNING for r in refusals), [
        logging.getLevelName(r.levelno) for r in refusals
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("keys", "token"),
    [
        pytest.param(
            [
                _gate_key(
                    "key-D", "alloc-refuse-sentry",
                    account_share_kind="duplicate",
                    account_shared_with_api_key_id="key-H",
                ),
                _gate_key("key-H", "alloc-refuse-sentry", venue_account_id="venue-holder"),
            ],
            "account_duplicate",
            id="duplicate",
        ),
        pytest.param(
            [
                _gate_key("key-A", "alloc-refuse-sentry", venue_account_id="venue-shared"),
                _gate_key("key-B", "alloc-refuse-sentry", venue_account_id="venue-shared"),
            ],
            "account_identity_collision",
            id="collision",
        ),
    ],
)
async def test_identity_refusal_reaches_sentry_as_an_event(
    keys: list[dict[str, Any]], token: str
) -> None:
    """C2 silent-failure SFH-07 remainder (round 2). The WARNING log alone never
    reaches Sentry as an event: sentry_init.py keeps the SDK's default
    LoggingIntegration, whose event_level is ERROR, so a WARNING is only a
    breadcrumb and the refusal was visible in Railway logs only. The refusal is
    captured explicitly, at level warning, tagged with the job and the reason
    token, and the message carries no key id and no venue id."""
    from unittest.mock import patch

    alloc = "alloc-refuse-sentry"
    fake = _FakeSupabase({
        "api_keys": keys,
        "csv_daily_returns": [],
        DERIVED_TABLE: [_stale_curve(alloc)],
        LEGACY_TABLE: [],
    })
    with patch("services.job_worker.sentry_sdk") as sentry:
        assert (await _run_gate(fake, alloc)).outcome.name == "DONE"
    assert sentry.capture_message.call_count == 1
    args, kwargs = sentry.capture_message.call_args
    message = args[0]
    assert token in message
    assert kwargs.get("level") == "warning"
    for secret in ("key-D", "key-H", "key-A", "key-B", "venue-holder", "venue-shared"):
        assert secret not in message
    scope = sentry.new_scope.return_value.__enter__.return_value
    tags = {call.args[0]: call.args[1] for call in scope.set_tag.call_args_list}
    assert tags.get("compute_job_id") == "j-gate"
    assert tags.get("derive_refusal") == token


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
async def test_a_working_key_with_no_returns_yet_is_not_stitched_and_the_book_is_not_trustworthy() -> None:
    """SFH-R2-03's hidden case, decided and pinned: the kept (working) key has
    a key_inputs row but no returns yet (its first derive has not produced a
    series). Its anchor is TODAY's equity; hanging it on the failing key's last
    return day would misdate it, so nothing is stitched. The compose already
    drops such a key as DROPPED_KEY, so the book is untrustworthy and held,
    never "ready" over the old key's history or without the account."""
    alloc = "alloc-stitch-no-returns"
    fake = _rotation_pair(alloc, "duplicate")
    fake.rows["csv_daily_returns"] = [
        r for r in fake.rows["csv_daily_returns"] if r["api_key_id"] != "key-M"
    ]
    csv_o, ki_o = _series_rows(alloc, "key-O", 10_000.0)
    fake.rows["api_keys"].append(_gate_key("key-O", alloc, venue_account_id="venue-own"))
    fake.rows["csv_daily_returns"].extend(csv_o)
    fake.rows[DERIVED_TABLE].append(ki_o)
    assert (await _run_gate(fake, alloc)).outcome.name == "DONE"
    payload = _composed_payload(fake)
    assert payload["is_trustworthy"] is False
    assert "dropped_key" in payload["degrade_reasons"]
    assert "shared_account_history_stitched" not in payload["flags"]
    assert payload["curve"][0]["date"] == "2026-06-01", payload["curve"][0]


@pytest.mark.asyncio
async def test_duplicate_whose_marked_key_fails_behind_a_working_holder_still_refuses() -> None:
    """Reader parity (queries.ts countsAsDuplicate): an ELIGIBLE duplicate-marked
    key whose holder is working is a duplicate, whatever the marked key's own
    status. The curve is refused, as before (167.1.2.1.1 D-04: the refusal is
    recorded in the row, not deleted)."""
    alloc = "alloc-dup-marked-failing"
    fake = _shared_pair(alloc, "duplicate", holder={}, marked={"sync_status": "error"})
    assert (await _run_gate(fake, alloc)).outcome.name == "DONE"
    _assert_refusal_recorded(fake, alloc, "account_duplicate")


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
    # A derive REFUSAL row (SC-1, D-04: ``payload.refusal`` is a token string) is
    # an ``equity_curve`` row but not a curve. ``_refusal_upserts`` counts those.
    return any(
        r.get("kind") == "equity_curve"
        and not (
            isinstance(r.get("payload"), dict)
            and isinstance(r["payload"].get("refusal"), str)
        )
        for r in _rows_of(payload)
    )


def _extract_payload(payload: Any) -> dict:
    for r in _rows_of(payload):
        if r.get("kind") == "equity_curve":
            inner = r.get("payload")
            return inner if isinstance(inner, dict) else {}
    return {}


# ---------------------------------------------------------------------------
# 167.1.2 C3 topic D (SFH-R3-07) — the returns read drains every page.
# ---------------------------------------------------------------------------

_LONG_ALLOC = "alloc-long"
_LONG_DAYS = 1500  # > PostgREST's 1000-row response cap (supabase/config.toml)


def _seed_long_history() -> tuple[dict[str, list[dict]], str, str]:
    """One working key with 1500 consecutive days of returns, stored NEWEST
    FIRST, so a capped bare read (the first 1000 rows) provably loses the
    earliest 500 days rather than the latest ones."""
    import datetime as _dt

    start = _dt.date(2022, 1, 1)
    days = [(start + _dt.timedelta(days=i)).isoformat() for i in range(_LONG_DAYS)]
    csv = [
        {
            "id": _LONG_DAYS - i,
            "api_key_id": "key-L",
            "allocator_id": _LONG_ALLOC,
            "date": day,
            "daily_return": 0.001,
        }
        for i, day in enumerate(reversed(days))
    ]
    rows: dict[str, list[dict]] = {
        "api_keys": [
            {
                "id": "key-L", "user_id": _LONG_ALLOC, "is_active": True,
                "sync_status": "connected", "disconnected_at": None,
            },
        ],
        "csv_daily_returns": csv,
        DERIVED_TABLE: [
            {
                "allocator_id": _LONG_ALLOC,
                "kind": "key_inputs:key-L",
                "payload": {
                    "flows": [], "anchor_usd": 100_000.0,
                    "anchor_asof": days[-1], "venue": "binance",
                },
            },
        ],
        LEGACY_TABLE: [],
    }
    return rows, days[0], days[-1]


@pytest.mark.asyncio
async def test_sfh_r3_07_returns_read_drains_past_the_response_cap() -> None:
    """SFH-R3-07: PostgREST caps one response at 1000 rows, and PROD holds an
    allocator with 2804 csv_daily_returns rows (measured 2026-09-29). A bare
    `.select().eq().execute()` hands the derive an arbitrary 1000 of them, so
    the curve starts late (and the stitch picks keys from a partial read) while
    still being marked trustworthy. The read must drain every page under a
    total order, so the curve starts on the key's FIRST stored day."""
    from unittest.mock import patch

    from services.job_worker import run_derive_allocator_equity_job

    rows, first_day, last_day = _seed_long_history()
    fake = _FakeSupabase(rows, max_rows=1000)
    job = {"id": "j-long", "kind": "derive_allocator_equity", "allocator_id": _LONG_ALLOC}

    with patch("services.job_worker.get_supabase", return_value=fake):
        result = await run_derive_allocator_equity_job(job)

    assert result.outcome.name == "DONE", result
    curve_upserts = [
        u for u in fake.upserts
        if u[0] == DERIVED_TABLE and _is_equity_curve_upsert(u[1])
    ]
    assert len(curve_upserts) == 1, fake.upserts
    payload = _extract_payload(curve_upserts[0][1])
    curve_days = [p["date"] for p in payload["curve"]]
    assert curve_days[0] <= first_day, (
        f"the curve starts at {curve_days[0]}, after the key's first stored day "
        f"{first_day}: the returns read lost the earliest rows to the response cap"
    )
    assert curve_days[-1] == last_day, curve_days[-1]
    assert first_day in curve_days and len(set(curve_days)) >= _LONG_DAYS, (
        f"the curve holds {len(set(curve_days))} days; {_LONG_DAYS} were stored"
    )
    # C3 round 2: the read is keyset per key, so every csv_daily_returns page
    # is ordered by date alone (the key is fixed by an eq filter). Two or more
    # pages were read, so the drain crossed the response cap.
    csv_orders = [(c, d) for t, c, d in fake.orders if t == "csv_daily_returns"]
    assert len(csv_orders) >= 2 and set(csv_orders) == {("date", False)}, (
        csv_orders
    )


@pytest.mark.asyncio
async def test_sfh_r3_07_returns_read_truncation_is_permanent_and_records_refusal() -> None:
    """A returns read past the read's hard cap raises
    PaginatedSelectTruncated. Retrying re-reads the same rows, so the job must
    end permanent FAILED (not the classifier's retrying `unknown`), replace the
    stale equity_curve row with a ``returns_read_cap`` refusal record (167.1.2.1.1
    D-04; it used to delete it), and never compose from partial data. The message
    carries no allocator id (the hint is a log-only triage string)."""
    from unittest.mock import patch

    from services.db import PaginatedSelectTruncated
    from services.job_worker import run_derive_allocator_equity_job

    rows, _first, _last = _seed_long_history()
    rows[DERIVED_TABLE].append(
        {"allocator_id": _LONG_ALLOC, "kind": "equity_curve", "payload": {"curve": []}}
    )
    fake = _FakeSupabase(rows)
    job = {"id": "j-trunc", "kind": "derive_allocator_equity", "allocator_id": _LONG_ALLOC}

    def _boom(*_a: Any, **_kw: Any) -> list[dict]:
        raise PaginatedSelectTruncated(page_count=1000, page_size=1000, hint="probe")

    with patch("services.job_worker.get_supabase", return_value=fake), \
         patch("services.job_worker._load_allocator_daily_returns", side_effect=_boom):
        result = await run_derive_allocator_equity_job(job)

    assert result.outcome.name == "FAILED", result
    assert result.error_kind == "permanent", result.error_kind
    assert _LONG_ALLOC not in (result.error_message or ""), result.error_message
    _assert_refusal_recorded(fake, _LONG_ALLOC, "returns_read_cap")


# ---------------------------------------------------------------------------
# 167.1.2 C3 round 2 (WR-01 / SFH-C3R2-01) — the paged read is consistent
# under a concurrent per-key dailies write.
# ---------------------------------------------------------------------------

_RACE_ALLOC = "alloc-race"
_RACE_KEYS = ("key-1", "key-2", "key-3")  # sorted: key-1 is read first
_RACE_DAYS = 6
_RACE_PAGE = 4  # 6 days per key over 4-row pages: offset pages cross keys


def _race_day(i: int) -> str:
    return f"2026-04-{i:02d}"


def _seed_race() -> dict[str, list[dict]]:
    """Three working, unshared keys with 6 days each and key_inputs rows. Offset
    pages of 4 rows over the (api_key_id, date) order end INSIDE key-2, so a
    write to key-1 between pages shifts every later row."""
    csv = []
    next_id = 1
    for k in _RACE_KEYS:
        for i in range(1, _RACE_DAYS + 1):
            csv.append({
                "id": next_id, "api_key_id": k, "allocator_id": _RACE_ALLOC,
                "date": _race_day(i), "daily_return": 0.001,
            })
            next_id += 1
    return {
        "api_keys": [
            {
                "id": k, "user_id": _RACE_ALLOC, "is_active": True,
                "sync_status": "connected", "disconnected_at": None,
            }
            for k in _RACE_KEYS
        ],
        "csv_daily_returns": csv,
        DERIVED_TABLE: [
            {
                "allocator_id": _RACE_ALLOC,
                "kind": f"key_inputs:{k}",
                "payload": {
                    "flows": [], "anchor_usd": 10_000.0,
                    "anchor_asof": _race_day(_RACE_DAYS), "venue": "binance",
                },
            }
            for k in _RACE_KEYS
        ],
        LEGACY_TABLE: [],
    }


def _rewrite_key_1(fake: _FakeSupabase, shape: str) -> None:
    """A concurrent rewrite of key-1's span, applied between two page reads:
    delete key-1's span and re-insert it with NEW ids (the key-mode
    derive_broker_dailies writer's shape before C3 topic H reordered it to
    upsert-then-delete; the read must survive either shape). `day_added`
    appends today's new day; `day_removed` leaves a day the derive refused
    honestly absent."""
    rows = fake.rows["csv_daily_returns"]
    kept = [r for r in rows if r["api_key_id"] != "key-1"]
    days = list(range(1, _RACE_DAYS + 1))
    if shape == "day_added":
        days.append(_RACE_DAYS + 1)
    elif shape == "day_removed":
        days.remove(3)
    else:  # pragma: no cover - a typo in a parametrize id
        raise AssertionError(shape)
    new_id = 1000
    for i in days:
        kept.append({
            "id": new_id, "api_key_id": "key-1", "allocator_id": _RACE_ALLOC,
            "date": _race_day(i), "daily_return": 0.001,
        })
        new_id += 1
    fake.rows["csv_daily_returns"] = kept


def _arm_race(fake: _FakeSupabase, shape: str, after_read: int = 2) -> dict[str, Any]:
    """Fire the key-1 rewrite once, right after the `after_read`-th
    csv_daily_returns read. Returns the pairs present before the write, filled
    in when it fires."""
    state: dict[str, Any] = {"reads": 0, "before": None}

    def _hook(table: str) -> None:
        if table != "csv_daily_returns":
            return
        state["reads"] += 1
        if state["reads"] == after_read:
            state["before"] = {
                (r["api_key_id"], r["date"]) for r in fake.rows["csv_daily_returns"]
            }
            _rewrite_key_1(fake, shape)

    fake.on_read = _hook
    return state


def _present_throughout(fake: _FakeSupabase, state: dict[str, Any]) -> set[tuple[str, str]]:
    after = {(r["api_key_id"], r["date"]) for r in fake.rows["csv_daily_returns"]}
    assert state["before"] is not None, "the concurrent write never fired"
    return set(state["before"]) & after


@pytest.mark.parametrize("shape", ["day_added", "day_removed"])
def test_c3r2_wr01_keyset_read_neither_skips_nor_duplicates_under_a_concurrent_write(
    shape: str,
) -> None:
    """WR-01 / SFH-C3R2-01. A sibling key's dailies write lands between two
    page reads. The read must return no (api_key_id, date) pair twice, and
    every pair present for the whole read. Offset pages fail this: key-1's
    row count changes before the next page's offset, so `day_added` reads a
    key-2 day twice and `day_removed` never reads one."""
    from services.job_worker import _load_allocator_daily_returns

    fake = _FakeSupabase(_seed_race())
    state = _arm_race(fake, shape)

    got = _load_allocator_daily_returns(
        fake, _RACE_ALLOC, list(_RACE_KEYS), page_size=_RACE_PAGE
    )

    pairs = [(r["api_key_id"], r["date"]) for r in got]
    dupes = sorted({p for p in pairs if pairs.count(p) > 1})
    assert not dupes, f"{shape}: the paged read returned {dupes} twice"
    missing = sorted(_present_throughout(fake, state) - set(pairs))
    assert not missing, (
        f"{shape}: the paged read never returned {missing}, present for the whole read"
    )
    assert state["reads"] > len(_RACE_KEYS), (
        f"only {state['reads']} reads: the read never crossed a page boundary"
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("shape", ["day_added", "day_removed"])
async def test_c3r2_wr01_derive_composes_every_day_once_under_a_concurrent_write(
    shape: str,
) -> None:
    """The same race, through the derive. The series each counted key hands the
    compose holds every day present for the whole read, once. A doubled day
    would be composed twice; a skipped day would be carried at r = 0 in a curve
    still marked trustworthy."""
    from unittest.mock import patch

    import services.allocator_equity_compose as compose_mod
    from services.job_worker import run_derive_allocator_equity_job

    fake = _FakeSupabase(_seed_race())
    state = _arm_race(fake, shape)
    seen: dict[str, list[str]] = {}
    real_compose = compose_mod.compose_allocator_equity

    def _capture(returns_by_key: Any, *a: Any, **kw: Any) -> Any:
        for k, series in returns_by_key.items():
            seen[str(k)] = [str(d) for d in series.index]
        return real_compose(returns_by_key, *a, **kw)

    job = {"id": "j-race", "kind": "derive_allocator_equity", "allocator_id": _RACE_ALLOC}
    with patch("services.job_worker.get_supabase", return_value=fake), \
         patch("services.job_worker._DAILY_RETURNS_PAGE_SIZE", _RACE_PAGE), \
         patch.object(compose_mod, "compose_allocator_equity", side_effect=_capture):
        result = await run_derive_allocator_equity_job(job)

    assert result.outcome.name == "DONE", result
    assert sorted(seen) == list(_RACE_KEYS), seen
    for k, days in seen.items():
        dupes = sorted({d for d in days if days.count(d) > 1})
        assert not dupes, f"{shape}: {k} handed the compose {dupes} twice"
    for k, day in sorted(_present_throughout(fake, state)):
        assert day in seen[k], (
            f"{shape}: {k} {day} was present for the whole read and never "
            "reached the compose"
        )


@pytest.mark.parametrize(("stored", "raises"), [(4, False), (5, True)])
def test_c3r2_keyset_read_hard_cap_refuses_only_real_overflow(
    stored: int, raises: bool
) -> None:
    """The keyset read keeps topic D's contract: past its hard cap of non-empty
    pages it raises PaginatedSelectTruncated (the caller ends the job
    permanent), and a count landing exactly on the cap is read whole."""
    from services.db import PaginatedSelectTruncated
    from services.job_worker import _load_allocator_daily_returns

    rows = {
        "csv_daily_returns": [
            {
                "id": i, "api_key_id": "key-1", "allocator_id": _RACE_ALLOC,
                "date": _race_day(i), "daily_return": 0.001,
            }
            for i in range(1, stored + 1)
        ]
    }
    fake = _FakeSupabase(rows)
    if raises:
        with pytest.raises(PaginatedSelectTruncated):
            _load_allocator_daily_returns(
                fake, _RACE_ALLOC, ["key-1"], page_size=2, hard_cap_pages=2
            )
    else:
        got = _load_allocator_daily_returns(
            fake, _RACE_ALLOC, ["key-1"], page_size=2, hard_cap_pages=2
        )
        assert [r["date"] for r in got] == [_race_day(i) for i in range(1, stored + 1)]


def test_c3r2_keyset_read_survives_a_server_cap_below_its_page_size() -> None:
    """The read stops on an EMPTY page, not a short one. PostgREST clamps a
    response to max_rows, so if that cap ever sits below the page size a
    short-page stop would end each key after its first clamped page, silently:
    the SFH-R3-07 truncation again, by a different route."""
    from services.job_worker import _load_allocator_daily_returns

    fake = _FakeSupabase(_seed_race(), max_rows=_RACE_PAGE - 1)
    got = _load_allocator_daily_returns(
        fake, _RACE_ALLOC, list(_RACE_KEYS), page_size=_RACE_PAGE
    )
    pairs = sorted((r["api_key_id"], r["date"]) for r in got)
    assert pairs == sorted(
        (k, _race_day(i)) for k in _RACE_KEYS for i in range(1, _RACE_DAYS + 1)
    ), pairs


# ---------------------------------------------------------------------------
# Phase 164.6.6.2 plan 04 (D-03, D-13, D-14) — a non-USD MT5 KEY is kept out of the
# USD allocator curve by name.
#
# WHY: the allocator curve is a USD sum. A BTC key's equity is 0.11 BTC, not $0.11,
# and its returns are in BTC. Adding either as dollars understates the book by the
# whole account; dropping the key as "DROPPED_KEY" degrades the whole curve for a key
# that is perfectly healthy. The honest answer is neither: omit it, say why, keep the
# other keys' curve trustworthy.
# ---------------------------------------------------------------------------

from contextlib import ExitStack  # noqa: E402
from unittest.mock import AsyncMock, MagicMock, patch  # noqa: E402

from tests.test_mt5_derive_branch import (  # noqa: E402
    _BTC_SCALE,
    _CLOSE_DAY,
    _FROZEN_NOW,
    _FakeMt5Transport,
    _btc_account,
    _btc_closes_on,
    _canonical_deals,
    _epoch as _mt5_epoch,
    _reset_mt5_terminal_locks,  # noqa: F401  (autouse fixture: clears the terminal registry)
    _scaled_deals,
)
from tests.test_mt5_derive_branch import _build_ctx as _mt5_build_ctx  # noqa: E402

_KEY_JOB = {"id": "j-mt5-key", "kind": "derive_broker_dailies", "api_key_id": "key-mt5"}


async def _derive_mt5_key(
    monkeypatch: pytest.MonkeyPatch,
    account: dict,
    *,
    deals: list[dict] | None = None,
    stored: str | None = None,
    btc_closes: Any = None,
    closes_reader: AsyncMock | None = None,
):
    """Run the REAL key-mode derive over the offline MT5 transport double.

    The stored BTC closes are always patched (164.6.6.2.1 / plan 07): ``None`` is "no price
    source", so a derive here never reaches for the real ``benchmark_prices`` table."""
    from services.job_worker import run_derive_broker_dailies_job

    monkeypatch.setenv("MT5_ENABLED", "true")
    transport = _FakeMt5Transport(
        account=account, deals=deals if deals is not None else _scaled_deals(_BTC_SCALE)
    )
    ctx, capture = _mt5_build_ctx(transport, asset_class="traditional")
    if stored is not None:
        ctx.key_row["account_currency"] = stored
    patchers = [
        patch(
            "services.job_worker._allocator_key_preflight",
            new=AsyncMock(return_value=ctx),
        ),
        patch("services.job_worker.aclose_exchange", new=AsyncMock()),
        patch(
            "services.job_worker.db_execute",
            new=AsyncMock(side_effect=lambda fn: fn()),
        ),
        patch(
            "services.benchmark.read_btc_closes",
            new=closes_reader or AsyncMock(return_value=btc_closes),
        ),
        patch("services.job_worker._utc_now", new=lambda: _FROZEN_NOW),
    ]
    with ExitStack() as stack:
        for p in patchers:
            stack.enter_context(p)
        result = await run_derive_broker_dailies_job(_KEY_JOB)
    return result, capture


def _api_keys_updates(capture: dict) -> list[dict]:
    return [p for (name, p) in capture["updates"] if name == "api_keys"]


def _btc_key_deal(day: tuple[int, int, int], profit: float, *, flow: bool = False) -> dict:
    """One MT5 deal in BTC on a UTC day: a closed trade (``profit`` is its P&L) or, with
    ``flow=True``, a BALANCE deposit (+) / withdrawal (-) booked in ``profit``."""
    base = {"swap": 0.0, "commission": 0.0, "fee": 0.0, "time": _mt5_epoch(*day)}
    if flow:
        return {**base, "type": 2, "profit": profit}
    return {**base, "type": 1, "entry": 1, "profit": profit}


def _csv_rows_by_date(capture: dict) -> dict[str, float]:
    return {
        row["date"]: row["daily_return"]
        for (name, payload, _oc) in capture["upserts"]
        if name == "csv_daily_returns"
        for row in payload
    }


# The four-day BTC ledger the 164.6.6.2.1 plan-08 tests share. NAV (native, end of day):
# 10-04 1.0, 10-05 1.0, 10-06 1.0, 10-07 1.1 with only the last day trading (+0.1 BTC). The
# derive's clock is frozen on 2026-10-09, so 2026-10-07 is NOT the latest completed day
# (10-08 is); the closes below are what decide which days are priced.
_D0, _D1, _D2, _D3 = (2026, 10, 4), (2026, 10, 5), (2026, 10, 6), (2026, 10, 7)


def _four_day_btc_deals(*, last_profit: float = 0.1, last_flow: float | None = None) -> list[dict]:
    deals = [
        _btc_key_deal(_D0, 0.0),
        _btc_key_deal(_D1, 0.0),
        _btc_key_deal(_D2, 0.0),
        _btc_key_deal(_D3, last_profit),
    ]
    if last_flow is not None:
        deals.append(_btc_key_deal(_D3, last_flow, flow=True))
    return deals


def _btc_key_account(equity: float) -> dict:
    return {"equity": equity, "balance": equity, "currency": "BTC", "login": 123456}


@pytest.mark.asyncio
async def test_key_mode_btc_key_writes_usd_inputs_or_names_the_unpriced_day(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """TRACER (D-03, D-17; T-164.6.6.2.1-45): a key-mode BTC key is no longer skipped. Its
    per-key returns are USD returns, its anchor is the live balance priced at the latest
    completed close, its realized terminal is the native realized level at the last USD
    return day times that day's close, and the payload names its unit and how far it is
    priced.

    Hand literals. Native NAV 1.0 on 10-04..10-06 and 1.1 on 10-07 (native return 0.10).
    Closes 60000 on 10-04..10-06 and 66000 on 10-07, and the clock is 2026-10-09 so 10-07
    is NOT the latest completed day: the close of 10-08 is also 66000.
      USD return 10-07 = (1 + 0.10) x 66000 / 60000 - 1 = 1.21 - 1 = 0.21 (NOT 0.10)
      USD return 10-05, 10-06 = 0.0 (a flat balance at a flat price)
      anchor = 1.1 BTC x 66000 = 66000 + 6600 = 72600.0 (priced at 10-08's close)
      realized terminal = 1.1 x 66000 = 72600.0 at the last USD return day, 10-07."""
    closes = _btc_closes_on(
        ("2026-10-04", 60000.0), ("2026-10-05", 60000.0), ("2026-10-06", 60000.0),
        ("2026-10-07", 66000.0), (_CLOSE_DAY, 66000.0),
    )
    result, capture = await _derive_mt5_key(
        monkeypatch, _btc_key_account(1.1), deals=_four_day_btc_deals(), btc_closes=closes
    )

    assert result.outcome.name == "DONE", (result.error_kind, result.error_message)
    rows = _csv_rows_by_date(capture)
    assert set(rows) == {"2026-10-05", "2026-10-06", "2026-10-07"}
    assert rows["2026-10-07"] == pytest.approx(0.21, abs=1e-9), (
        "the per-key series must be USD returns: 1.10 x 66000 / 60000 - 1, not the BTC 0.10"
    )
    assert rows["2026-10-06"] == pytest.approx(0.0, abs=1e-12)
    payload = _persisted_ki_payload(capture)
    assert payload["anchor_usd"] == pytest.approx(72600.0, abs=1e-9)
    assert payload["anchor_null_reason"] is None
    assert payload["native_unit"] == "BTC"
    assert payload["priced_through"] == "2026-10-07"
    assert payload["unpriced_days"] == []
    assert payload["segment_terminals"] == []  # no interior hole, nothing to segment
    assert "unpriced_close_day" not in payload
    assert payload["realized_terminal_usd"] == pytest.approx(72600.0, abs=1e-9)
    assert payload["realized_terminal_day"] == "2026-10-07"
    assert payload["venue"] == "mt5"
    assert _api_keys_updates(capture) == [
        {
            "account_currency": "BTC",
            "account_balance_native": 1.1,
            "account_balance_usdt": pytest.approx(72600.0, abs=1e-9),
            "account_balance_usdt_close_date": _CLOSE_DAY,
        }
    ]


@pytest.mark.asyncio
async def test_key_mode_btc_deposit_is_a_usd_flow_at_its_days_close(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """T-164.6.6.2.1-45: each flow is ``amount x close(flow day)``, and the deposit is NOT a
    return. Same ledger as the tracer but 10-07 trades +0.05 BTC and receives a 0.05 BTC
    deposit, so the NAV is 1.0 BTC before and 1.1 after.
      flow = 0.05 x 66000 = 3300.0 on 10-07
      USD return 10-07 = (1 + 0.05) x 66000 / 60000 - 1 = 1.155 - 1 = 0.155 (the deposit
      is in the numerator, so it adds nothing to the return)."""
    closes = _btc_closes_on(
        ("2026-10-04", 60000.0), ("2026-10-05", 60000.0), ("2026-10-06", 60000.0),
        ("2026-10-07", 66000.0), (_CLOSE_DAY, 66000.0),
    )
    result, capture = await _derive_mt5_key(
        monkeypatch,
        _btc_key_account(1.1),
        deals=_four_day_btc_deals(last_profit=0.05, last_flow=0.05),
        btc_closes=closes,
    )

    assert result.outcome.name == "DONE", (result.error_kind, result.error_message)
    payload = _persisted_ki_payload(capture)
    assert payload["flows"] == [{"utc_day_iso": "2026-10-07", "usd_signed": pytest.approx(3300.0)}]
    assert _csv_rows_by_date(capture)["2026-10-07"] == pytest.approx(0.155, abs=1e-9)
    assert payload["unpriced_days"] == []


@pytest.mark.asyncio
async def test_key_mode_btc_key_with_the_live_close_missing_is_unpriced_never_stale(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D-09, D-17; T-164.6.6.2.1-46. The latest completed day is 2026-10-08, and no close is
    stored for it (or for 10-07): the newest close is 10-06's 60000. The anchor is NULL with
    the reason ``native_unpriced``, NOT 1.1 x 60000 = 66000 at the older close. The payload
    names the missing close's day and how far the key is priced, and the per-key USD
    returns that CAN be formed are still written (10-05, 10-06)."""
    closes = _btc_closes_on(
        ("2026-10-04", 60000.0), ("2026-10-05", 60000.0), ("2026-10-06", 60000.0)
    )
    result, capture = await _derive_mt5_key(
        monkeypatch, _btc_key_account(1.1), deals=_four_day_btc_deals(), btc_closes=closes
    )

    assert result.outcome.name == "DONE", (result.error_kind, result.error_message)
    payload = _persisted_ki_payload(capture)
    assert payload["anchor_usd"] is None
    assert payload["anchor_null_reason"] == "native_unpriced"
    assert payload["unpriced_close_day"] == _CLOSE_DAY
    assert payload["priced_through"] == "2026-10-06"
    # 10-07 is after the last stored close: the live tail, not an interior hole.
    assert payload["unpriced_days"] == []
    assert set(_csv_rows_by_date(capture)) == {"2026-10-05", "2026-10-06"}
    # The realized terminal is the native level on the last USD return day, 10-06: 1.0 x 60000.
    assert payload["realized_terminal_usd"] == pytest.approx(60000.0, abs=1e-9)
    assert payload["realized_terminal_day"] == "2026-10-06"
    (update,) = _api_keys_updates(capture)
    assert update["account_balance_usdt"] is None


def _hole_deals(*, deposit_on_hole: float | None = None) -> list[dict]:
    """Five trading days 10-04..10-08 (+0.0, +0.01, +0.02, +0.0, +0.03 BTC). The terminal
    balance is 1.06 BTC, so the native NAV (end of day) is 1.0, 1.01, 1.03, 1.03, 1.06."""
    deals = [
        _btc_key_deal((2026, 10, 4), 0.0),
        _btc_key_deal((2026, 10, 5), 0.01),
        _btc_key_deal((2026, 10, 6), 0.02),
        _btc_key_deal((2026, 10, 7), 0.0),
        _btc_key_deal((2026, 10, 8), 0.03),
    ]
    if deposit_on_hole is not None:
        deals.append(_btc_key_deal((2026, 10, 6), deposit_on_hole, flow=True))
    return deals


# No close on 2026-10-06 (the hole). 10-05 pairs with 10-04, 10-08 with 10-07; 10-06 has no
# close of its own and 10-07 has no usable 10-06 to pair against.
_HOLE_CLOSES = (
    ("2026-10-04", 60000.0), ("2026-10-05", 61000.0),
    ("2026-10-07", 63000.0), ("2026-10-08", 64000.0),
)


@pytest.mark.asyncio
async def test_key_mode_btc_interior_hole_is_named_never_written_as_zero(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D-09; T-164.6.6.2.1-46. A missing close on 10-06 leaves two native return days with no
    USD return: 10-06 (no close of its own) and 10-07 (it pairs against 10-06). Both are
    listed in ``unpriced_days`` and neither is written as r = 0. The key is priced through
    10-08, so the anchor (1.06 x 64000 = 67840.0) is unaffected.
      USD 10-05 = (1 + 0.01/1.0) x 61000 / 60000 - 1 = 61610 / 60000 - 1 = 0.0268333...
      USD 10-08 = (1 + 0.03/1.03) x 64000 / 63000 - 1 = 67840 / 64890 - 1 = 0.0454615..."""
    result, capture = await _derive_mt5_key(
        monkeypatch,
        _btc_key_account(1.06),
        deals=_hole_deals(),
        btc_closes=_btc_closes_on(*_HOLE_CLOSES),
    )

    assert result.outcome.name == "DONE", (result.error_kind, result.error_message)
    rows = _csv_rows_by_date(capture)
    assert set(rows) == {"2026-10-05", "2026-10-08"}, rows
    assert rows["2026-10-05"] == pytest.approx(0.026833333333, abs=1e-9)
    assert rows["2026-10-08"] == pytest.approx(0.0454615503, abs=1e-9)
    payload = _persisted_ki_payload(capture)
    assert payload["unpriced_days"] == ["2026-10-06", "2026-10-07"]
    assert payload["priced_through"] == "2026-10-08"
    # Plan 09: the allocator compose replays this key in two segments split at the hole, and the
    # first rolls back from the realized USD level on the last priced day before it: the native
    # NAV there (1.01) x that day's close (61000) = 61610.0, worked by hand.
    assert payload["segment_terminals"] == [
        {"utc_day_iso": "2026-10-05", "level_usd": pytest.approx(61610.0, abs=1e-9)}
    ]
    assert payload["anchor_usd"] == pytest.approx(67840.0, abs=1e-9)
    assert payload["anchor_null_reason"] is None
    # No P&L is carried for a day the key could not price: 10-06 has no close, and 10-07 is
    # named unpriced (its 63000 close exists but its return cannot be formed).
    assert {row["utc_day_iso"] for row in payload["dropped_day_pnl"]}.isdisjoint(
        {"2026-10-06", "2026-10-07"}
    )


@pytest.mark.asyncio
async def test_key_mode_btc_deposit_on_an_unpriced_day_is_named_and_not_persisted(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """MEASUREMENT I2=build: a deposit on a day with no close cannot be priced, so no flow is
    persisted for it and the day is named in ``unpriced_days`` (it is never priced at a
    neighbouring close). The hole ledger above plus a 0.05 BTC deposit on 10-06."""
    result, capture = await _derive_mt5_key(
        monkeypatch,
        _btc_key_account(1.06),
        deals=_hole_deals(deposit_on_hole=0.05),
        btc_closes=_btc_closes_on(*_HOLE_CLOSES),
    )

    assert result.outcome.name == "DONE", (result.error_kind, result.error_message)
    payload = _persisted_ki_payload(capture)
    assert payload["flows"] == []
    assert "2026-10-06" in payload["unpriced_days"]


@pytest.mark.asyncio
async def test_key_mode_btc_key_with_no_price_source_names_it_and_writes_no_series(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D-09: with no stored closes at all (a SUCCESSFUL ``read_btc_closes`` that found none, None) nothing is priced: no per-key series, a NULL anchor with ``native_unpriced``, no
    flow, and the same api_keys UPDATE as before. The pre-164.6.6.2.1 skip used the reason
    ``native_unit`` for this fixture; that reason is now reserved for an unsupported code."""
    result, capture = await _derive_mt5_key(monkeypatch, _btc_account())

    assert result.outcome.name == "DONE", (result.error_kind, result.error_message)
    assert not any(u[0] == "csv_daily_returns" for u in capture["upserts"])
    assert _api_keys_updates(capture) == [
        {
            "account_currency": "BTC",
            "account_balance_native": 0.1105,
            "account_balance_usdt": None,
            "account_balance_usdt_close_date": None,
        }
    ]
    payload = _persisted_ki_payload(capture)
    assert payload["anchor_usd"] is None
    assert payload["anchor_null_reason"] == "native_unpriced"
    assert payload["unpriced_close_day"] == _CLOSE_DAY
    assert payload["priced_through"] is None
    assert payload["flows"] == [], "a BTC flow must never enter the USD curve unpriced"
    assert payload["venue"] == "mt5"


@pytest.mark.asyncio
async def test_key_mode_btc_key_retries_when_the_closes_read_fails_and_writes_nothing(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """SFH-01. A closes READ that failed is not "no price source": the previous behaviour
    persisted ``native_unpriced`` with an ``unpriced_close_day`` that was never checked, and
    the allocator compose then dropped the key from the book by name for a close that may
    exist. It is a TRANSIENT failure instead (the derive retries), with the account unit,
    the series and the key_inputs row all untouched, so the last good inputs stand."""
    from services.benchmark import BtcClosesReadError

    caplog.set_level("WARNING")
    result, capture = await _derive_mt5_key(
        monkeypatch,
        _btc_account(),
        closes_reader=AsyncMock(side_effect=BtcClosesReadError("benchmark read failed")),
    )

    assert result.outcome.name == "FAILED"
    assert result.error_kind == "transient"
    assert "BTC prices" in (result.error_message or "")
    assert _api_keys_updates(capture) == []
    assert not any(u[0] == "csv_daily_returns" for u in capture["upserts"])
    assert not any(u[0] == "allocator_equity_derived" for u in capture["upserts"])
    assert any("closes unreadable" in r.getMessage() for r in caplog.records)


@pytest.mark.asyncio
async def test_key_mode_funded_btc_key_is_not_dust_against_the_usd_floor(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The dust, non-positive and non-finite checks judge the USD anchor. 0.4213 BTC is far
    below the USD dust floor (DUST_NAV_FLOOR) as a NUMBER but is worth 0.4213 x 61950.00 = 24780 +
    1319.535 = 26099.535 USD, so it is a real anchor, not ``dust``."""
    closes = _btc_closes_on(
        ("2025-06-01", 61950.00), ("2025-06-02", 61950.00), ("2025-06-03", 61950.00),
        ("2025-06-04", 61950.00), ("2025-06-05", 61950.00), (_CLOSE_DAY, 61950.00),
    )
    result, capture = await _derive_mt5_key(
        monkeypatch, _btc_key_account(0.4213), btc_closes=closes
    )

    assert result.outcome.name == "DONE", (result.error_kind, result.error_message)
    payload = _persisted_ki_payload(capture)
    assert payload["anchor_null_reason"] is None
    assert payload["anchor_usd"] == pytest.approx(26099.535, abs=1e-9)


@pytest.mark.asyncio
async def test_key_mode_btc_key_prices_its_balance_at_the_latest_completed_close(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """164.6.6.2.1 / plan 07 (D-17): the key-mode path persists the SAME dated USD balance
    as the strategy path. 0.1105 BTC x 61950.00 = 6845.475 (6195 + 650.475), dated the
    latest completed UTC day; the per-key series is still not written."""
    result, capture = await _derive_mt5_key(
        monkeypatch, _btc_account(), btc_closes=_btc_closes_on((_CLOSE_DAY, 61950.00))
    )

    assert result.outcome.name == "DONE", (result.error_kind, result.error_message)
    (update,) = _api_keys_updates(capture)
    assert update["account_balance_usdt"] == pytest.approx(6845.475, abs=1e-9)
    assert update["account_balance_usdt_close_date"] == _CLOSE_DAY
    assert update["account_balance_native"] == 0.1105


@pytest.mark.asyncio
async def test_key_mode_a_non_btc_native_code_is_never_priced_with_btc_closes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """164.6.6.2.1 / plan 07 (T-164.6.6.2.1-17): a key-mode EUR key is ``native`` only
    because it has no floors; 12345.67 EUR x a BTC close would be a confident wrong dollar
    figure. Its USD balance stays NULL even when BTC closes exist for the completed day, and
    the closes are not even read."""
    account = _btc_account("EUR")
    account["equity"], account["balance"] = 12_345.67, 12_345.67
    reader = AsyncMock(return_value=_btc_closes_on((_CLOSE_DAY, 61950.00)))
    result, capture = await _derive_mt5_key(
        monkeypatch, account, deals=_canonical_deals(), closes_reader=reader
    )

    assert result.outcome.name == "DONE", (result.error_kind, result.error_message)
    (update,) = _api_keys_updates(capture)
    assert update["account_balance_usdt"] is None
    assert update["account_balance_usdt_close_date"] is None
    reader.assert_not_awaited()


@pytest.mark.asyncio
async def test_key_mode_unsupported_currency_is_skipped_like_a_native_one(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D-13: any non-USD key is skipped honestly (CONTEXT 'Recorded 2026-10-07 after the
    plan check'). EUR has no floors, so the strategy path refuses it by name; the KEY path
    has no series to refuse, so it stores the code and the null anchor instead."""
    account = _btc_account("EUR")
    account["equity"], account["balance"] = 12_345.67, 12_345.67
    result, capture = await _derive_mt5_key(monkeypatch, account, deals=_canonical_deals())

    assert result.outcome.name == "DONE", (result.error_kind, result.error_message)
    assert not any(u[0] == "csv_daily_returns" for u in capture["upserts"])
    assert _api_keys_updates(capture) == [
        {
            "account_currency": "EUR",
            "account_balance_native": 12_345.67,
            "account_balance_usdt": None,
            "account_balance_usdt_close_date": None,
        }
    ]
    payload = _persisted_ki_payload(capture)
    assert payload["anchor_usd"] is None and payload["anchor_null_reason"] == "native_unit"


@pytest.mark.asyncio
async def test_key_mode_blank_currency_is_still_transient_and_writes_nothing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Plan 03's blank arm applies to key-mode too: a terminal that has not reported a
    currency is a read fault, not a verdict, so nothing is guessed and nothing written."""
    result, capture = await _derive_mt5_key(monkeypatch, _btc_account(""))
    assert result.outcome.name == "FAILED" and result.error_kind == "transient"
    assert capture["upserts"] == [] and capture["updates"] == []


@pytest.mark.asyncio
async def test_key_mode_btc_key_with_a_nonfinite_equity_persists_nothing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The unit is persisted only with an equity step (c) already validated. A NaN equity
    refuses on step (c)'s own arm BEFORE the skip, so no 'account_balance_native: NaN' can
    reach api_keys (Postgres would reject it and loop the job)."""
    account = _btc_account()
    account["equity"] = float("nan")
    result, capture = await _derive_mt5_key(monkeypatch, account)
    assert result.outcome.name == "FAILED" and result.error_kind == "permanent"
    assert capture["updates"] == [], capture["updates"]
    assert not any(u[0] == "allocator_equity_derived" for u in capture["upserts"])


@pytest.mark.asyncio
async def test_key_mode_a_changed_currency_refuses_and_proves_the_write_gave_d03_a_value(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D-03 in key-mode: stored BTC (what the key-mode skip above writes), now read as USD.
    ERROR-class refusal, transient, nothing written: the stored series is kept."""
    account = {"equity": 110_500.0, "balance": 110_500.0, "currency": "USD", "login": 123456}
    result, capture = await _derive_mt5_key(
        monkeypatch, account, deals=_canonical_deals(), stored="BTC"
    )
    assert result.outcome.name == "FAILED" and result.error_kind == "transient"
    assert capture["upserts"] == [] and capture["updates"] == []


@pytest.mark.asyncio
async def test_key_mode_usd_key_is_unchanged(monkeypatch: pytest.MonkeyPatch) -> None:
    """CONTROL: a USD-family key derives its per-key series and a real USD anchor exactly
    as before this plan. No unit write in key-mode (strategy-mode owns it), no reason."""
    account = {"equity": 110_500.0, "balance": 110_500.0, "currency": "USD", "login": 123456}
    result, capture = await _derive_mt5_key(monkeypatch, account, deals=_canonical_deals())
    assert result.outcome.name == "DONE", (result.error_kind, result.error_message)
    csv = [u for u in capture["upserts"] if u[0] == "csv_daily_returns"]
    assert csv and all(r["api_key_id"] == "key-mt5" for u in csv for r in u[1])
    assert capture["updates"] == []
    payload = _persisted_ki_payload(capture)
    assert payload["anchor_usd"] == 110_500.0
    assert payload["anchor_null_reason"] is None


# --- compose: the omit rule ------------------------------------------------


def _seed_native_sibling(*, with_returns: bool) -> dict[str, list[dict]]:
    seed = _seed_null_anchor_sibling("native_unit")
    if with_returns:
        # A BTC key whose per-key series pre-dates this plan (the interim key-mode path
        # wrote one): it must be omitted too, not turned into NO_ANCHOR + DROPPED_KEY.
        seed["csv_daily_returns"] = seed["csv_daily_returns"] + [
            {"api_key_id": "key-B", "allocator_id": "alloc-nullsib",
             "date": f"2026-03-0{i + 1}", "daily_return": 0.01}
            for i in range(3)
        ]
    return seed


@pytest.mark.asyncio
@pytest.mark.parametrize("with_returns", [False, True])
async def test_compose_omits_a_native_unit_key_without_degrading(
    with_returns: bool,
) -> None:
    """D-13, the UNSUPPORTED-unit variant (164.6.6.2.1 plan 09): ``native_unit`` is the null-anchor
    reason of a code with no price source (EUR) only. A BTC key is priced and is in the book (see
    the ``_btc_book`` cases below); this arm keeps its old promise for the codes that are not.
    The book stays trustworthy over the USD keys, nothing blocks, and the omission is named by a
    benign flag (T-164.6.6.2-15) so it is never silent."""
    from services.job_worker import run_derive_allocator_equity_job

    fake = _FakeSupabase(_seed_native_sibling(with_returns=with_returns))
    job = {"id": "j-nat", "kind": "derive_allocator_equity", "allocator_id": "alloc-nullsib"}
    with patch("services.job_worker.get_supabase", return_value=fake):
        result = await run_derive_allocator_equity_job(job)

    assert result.outcome.name == "DONE"
    curve = [u for u in fake.upserts if _is_equity_curve_upsert(u[1])]
    assert len(curve) == 1
    payload = _extract_payload(curve[0][1])
    assert payload["is_trustworthy"] is True, payload["degrade_reasons"]
    assert "dropped_key" not in payload["degrade_reasons"]
    assert "no_anchor" not in payload["degrade_reasons"]
    assert "native_unit_key_omitted" in payload["flags"]


# --- compose: a BTC key in the USD book (164.6.6.2.1 plan 09) -----------------------------
#
# Hand literals: key A (USD) holds 100000.0 on every day (returns 0.0, realized terminal and
# anchor 100000.0); key B (BTC) holds 1.0 BTC x 60000 = 60000.0 (returns 0.0, realized terminal
# 60000.0). The book is 160000.0 while both are in it. These rows are what plan 08's key-mode
# derive writes for a BTC key; seeding them directly keeps this test about the COMPOSE side.

_BTC_ALLOC = "alloc-btc"
_BTC_DAYS = [f"2026-06-{d:02d}" for d in range(6, 11)]  # 06-06 .. 06-10


def _btc_book(b_payload: dict[str, Any], *, b_days: list[str]) -> dict[str, list[dict]]:
    api_keys = [
        {"id": key, "user_id": _BTC_ALLOC, "is_active": True,
         "sync_status": "connected", "disconnected_at": None}
        for key in ("key-A", "key-B")
    ]
    csv = [
        {"api_key_id": "key-A", "allocator_id": _BTC_ALLOC, "date": day, "daily_return": 0.0}
        for day in _BTC_DAYS
    ] + [
        {"api_key_id": "key-B", "allocator_id": _BTC_ALLOC, "date": day, "daily_return": 0.0}
        for day in b_days
    ]
    derived = [
        {"allocator_id": _BTC_ALLOC, "kind": "key_inputs:key-A",
         "payload": {"flows": [], "anchor_usd": 100_000.0, "venue": "binance",
                     "realized_terminal_usd": 100_000.0, "realized_terminal_day": _BTC_DAYS[-1]}},
        {"allocator_id": _BTC_ALLOC, "kind": "key_inputs:key-B", "payload": b_payload},
    ]
    return {"csv_daily_returns": csv, DERIVED_TABLE: derived, LEGACY_TABLE: [], "api_keys": api_keys}


def _btc_payload(**overrides: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "flows": [], "anchor_usd": 60_000.0, "anchor_null_reason": None, "venue": "mt5",
        "native_unit": "BTC", "priced_through": "2026-06-09", "unpriced_days": [],
        "realized_terminal_usd": 60_000.0, "realized_terminal_day": "2026-06-09",
    }
    payload.update(overrides)
    return payload


async def _compose_btc_book(seed: dict[str, list[dict]]) -> dict:
    from unittest.mock import patch

    from services.job_worker import run_derive_allocator_equity_job

    fake = _FakeSupabase(seed)
    job = {"id": "j-btc", "kind": "derive_allocator_equity", "allocator_id": _BTC_ALLOC}
    with patch("services.job_worker.get_supabase", return_value=fake):
        result = await run_derive_allocator_equity_job(job)
    assert result.outcome.name == "DONE", (result.error_kind, result.error_message)
    curve = [u for u in fake.upserts if _is_equity_curve_upsert(u[1])]
    assert len(curve) == 1, fake.upserts
    return _extract_payload(curve[0][1])


@pytest.mark.asyncio
async def test_compose_puts_a_priced_btc_key_in_the_usd_book() -> None:
    """D-01 / D-09 (plan 09 tracer, priced half). B's live balance is priced at the D-1 close,
    so its row carries a USD anchor (60000.0) and B is in the book on every day: 100000.0 +
    60000.0 = 160000.0, trustworthy, nothing omitted."""
    payload = await _compose_btc_book(_btc_book(_btc_payload(), b_days=_BTC_DAYS[:-1]))

    assert {r["date"]: r["equity_usd"] for r in payload["curve"]} == {
        day: pytest.approx(160_000.0, abs=1e-9) for day in _BTC_DAYS
    }
    assert payload["is_trustworthy"] is True, payload["degrade_reasons"]
    assert "native_unpriced_key_omitted" not in payload["flags"]
    assert "unpriced_native_keys" not in payload


@pytest.mark.asyncio
async def test_compose_rotates_an_unpriced_anchor_btc_key_out_after_its_last_priced_day() -> None:
    """D-09 / D-20 (plan 09 tracer, trailing half), from the rows plan 08 writes. B is priced
    through 06-08 (realized terminal 60000.0 there) and the live close of 06-09 is missing: its
    row has a NULL anchor, ``native_unpriced``, ``priced_through`` 06-08 and ``unpriced_close_day``
    06-09. The book is 160000.0 through 06-08 and A alone (100000.0) after it. B leaving is an
    exit: the book return on 06-09 is A's own 0.0 (a booked loss would read -0.375). The omission
    is named with the day of the missing close."""
    b = _btc_payload(
        anchor_usd=None, anchor_null_reason="native_unpriced", priced_through="2026-06-08",
        unpriced_close_day="2026-06-09",
        realized_terminal_usd=60_000.0, realized_terminal_day="2026-06-08",
    )
    payload = await _compose_btc_book(_btc_book(b, b_days=_BTC_DAYS[:3]))

    curve = {r["date"]: r["equity_usd"] for r in payload["curve"]}
    assert [curve[d] for d in _BTC_DAYS[:3]] == [pytest.approx(160_000.0, abs=1e-9)] * 3
    assert [curve[d] for d in _BTC_DAYS[3:]] == [pytest.approx(100_000.0, abs=1e-9)] * 2
    assert {r["date"]: r["r"] for r in payload["returns"]}["2026-06-09"] == pytest.approx(0.0, abs=1e-12)
    assert payload["is_trustworthy"] is True, payload["degrade_reasons"]
    assert "dropped_key" not in payload["degrade_reasons"]
    assert "native_unpriced_key_omitted" in payload["flags"]
    assert payload["unpriced_native_keys"] == [{"api_key_id": "key-B", "day": "2026-06-09"}]


@pytest.mark.asyncio
async def test_compose_leaves_a_btc_key_out_of_an_interior_unpriced_stretch() -> None:
    """D-09 (plan 09 Task 2, mechanism I2). B has USD returns on 06-06, 06-07 and 06-10 and none
    on 06-08 and 06-09 (the close of 06-08 is missing, so 06-09 cannot pair either). Its row names
    both days and the realized USD level on 06-07, the last priced day before the hole (60000.0).
    The book is 160000.0 on the three priced days and A's 100000.0 on the two unpriced ones; a
    stale carry would read 160000.0 there. B leaves and re-enters; neither is a book return."""
    b = _btc_payload(
        priced_through="2026-06-10", unpriced_days=["2026-06-08", "2026-06-09"],
        segment_terminals=[{"utc_day_iso": "2026-06-07", "level_usd": 60_000.0}],
        realized_terminal_day="2026-06-10",
    )
    seed = _btc_book(b, b_days=[])
    seed["csv_daily_returns"] += [
        {"api_key_id": "key-B", "allocator_id": _BTC_ALLOC, "date": day, "daily_return": 0.0}
        for day in ("2026-06-06", "2026-06-07", "2026-06-10")
    ]
    payload = await _compose_btc_book(seed)

    curve = {r["date"]: r["equity_usd"] for r in payload["curve"]}
    for day in ("2026-06-06", "2026-06-07", "2026-06-10"):
        assert curve[day] == pytest.approx(160_000.0, abs=1e-9), day
    for day in ("2026-06-08", "2026-06-09"):
        assert curve[day] == pytest.approx(100_000.0, abs=1e-9), day
    returns = {r["date"]: r["r"] for r in payload["returns"]}
    for day in ("2026-06-08", "2026-06-09", "2026-06-10"):
        assert returns[day] == pytest.approx(0.0, abs=1e-12), day
    assert payload["is_trustworthy"] is True, payload["degrade_reasons"]
    assert "missing_return_inside_coverage" not in payload["flags"]
    assert "native_unpriced_key_omitted" in payload["flags"]


@pytest.mark.asyncio
async def test_compose_omits_a_btc_key_with_nothing_priced_by_name() -> None:
    """No price source at all: no series, a NULL anchor, no terminal. B is omitted by name (the
    same token and list), the book over A stays trustworthy."""
    b = _btc_payload(
        anchor_usd=None, anchor_null_reason="native_unpriced", priced_through=None,
        unpriced_close_day="2026-06-09",
    )
    del b["realized_terminal_usd"], b["realized_terminal_day"]
    payload = await _compose_btc_book(_btc_book(b, b_days=[]))

    assert {r["date"]: r["equity_usd"] for r in payload["curve"]} == {
        day: pytest.approx(100_000.0, abs=1e-9) for day in _BTC_DAYS
    }
    assert payload["is_trustworthy"] is True, payload["degrade_reasons"]
    assert "native_unpriced_key_omitted" in payload["flags"]
    assert payload["unpriced_native_keys"] == [{"api_key_id": "key-B", "day": "2026-06-09"}]


@pytest.mark.asyncio
async def test_compose_leaves_a_btc_key_with_a_malformed_native_field_out_by_name(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """T-164.6.6.2.1-23: the JSONB is worker-written but untrusted. A malformed ``priced_through``
    must never be read as a price: B is left out of the book (A alone, 100000.0), named, and the
    book is not degraded or failed. SFH-02 / WR-02: the entry carries a reason for its missing
    day, and the worker warning names the key and what was wrong with the field, so an operator
    can find the row."""
    import logging

    with caplog.at_level(logging.WARNING, logger="quantalyze.analytics.job_worker"):
        payload = await _compose_btc_book(
            _btc_book(_btc_payload(priced_through="not-a-day"), b_days=_BTC_DAYS[:-1])
        )
    warned = [r.getMessage() for r in caplog.records if "malformed native field" in r.getMessage()]
    assert len(warned) == 1, warned
    assert "key-B" in warned[0], warned[0]
    assert "priced_through" in warned[0], warned[0]

    assert {r["date"]: r["equity_usd"] for r in payload["curve"]} == {
        day: pytest.approx(100_000.0, abs=1e-9) for day in _BTC_DAYS
    }
    assert payload["is_trustworthy"] is True, payload["degrade_reasons"]
    assert "native_unpriced_key_omitted" in payload["flags"]
    assert payload["unpriced_native_keys"] == [
        {"api_key_id": "key-B", "day": None, "reason": "day_unknown"}
    ]


def test_native_unit_is_not_a_no_capital_anchor_reason() -> None:
    """A funded BTC account has capital. Putting 'native_unit' in this set would let an
    empty positions poll PROVE an allocator's BTC account was zero and write a $0 row."""
    from services.equity_reconstruction import _NO_CAPITAL_ANCHOR_REASONS

    assert "native_unit" not in _NO_CAPITAL_ANCHOR_REASONS
    assert _NO_CAPITAL_ANCHOR_REASONS == frozenset({"dust", "nonpositive"})


# --- compose: a no-capital key with real history exits the book (166.3.1 plan 08, D-08) ---------
#
# Hand literals: key A (binance) holds 100000.0 on all five days (returns 0.0, realized terminal
# and anchor 100000.0). Key B (deribit) was emptied: the live read found no capital, so its row
# has a NULL anchor stamped ``dust``, but its writer stored flat returns on the first three days,
# a realized terminal of 60.0 on the third (at or below DUST_NAV_FLOOR, D-08 A2) and the
# basis it rolled on. While B is in the book it is 100060.0; after its last measured day it is
# an exit, so the book is A's 100000.0. A booked loss on the day it leaves would read
# -60 / 100060, about -0.0006, which is what this test is written to refuse.
#
# ⛔ Every "dust" terminal below is a number chosen against DUST_NAV_FLOOR (A2 compares the
# stored terminal to it). 166.3.1 followed 167.1.2 D-27 moving that floor from 1000 to 100, and
# the old 600/650/500 terminals silently became material capital that A2 correctly refused. A
# fixture that means "dust" must stay at or below the floor; ``test_no_capital_fixture_terminals_
# are_dust_under_the_current_floor`` fails with a named reason when a floor move leaves one above.
_NC_DUST_TERMINAL = 60.0
_NC_A3_TERMINAL = 65.0   # 15.0 on L, walked forward over a 40.0 deposit and 10.0 of P&L

_NOCAP_ALLOC = "alloc-nocap"


def _no_capital_book(
    *, token: str = "dust", terminal_usd: float = _NC_DUST_TERMINAL, b_anchor: float | None = None
) -> dict[str, list[dict]]:
    api_keys = [
        {"id": "key-A", "user_id": _NOCAP_ALLOC, "is_active": True, "exchange": "binance",
         "sync_status": "connected", "disconnected_at": None},
        {"id": "key-B", "user_id": _NOCAP_ALLOC, "is_active": True, "exchange": "deribit",
         "sync_status": "connected", "disconnected_at": None},
    ]
    csv = [
        {"api_key_id": "key-A", "allocator_id": _NOCAP_ALLOC, "date": day, "daily_return": 0.0}
        for day in _BTC_DAYS
    ] + [
        {"api_key_id": "key-B", "allocator_id": _NOCAP_ALLOC, "date": day, "daily_return": 0.0}
        for day in _BTC_DAYS[:3]
    ]
    b_last = _BTC_DAYS[2]
    derived = [
        {"allocator_id": _NOCAP_ALLOC, "kind": "key_inputs:key-A",
         "payload": {"flows": [], "anchor_usd": 100_000.0, "venue": "binance",
                     "realized_terminal_usd": 100_000.0, "realized_terminal_day": _BTC_DAYS[-1]}},
        {"allocator_id": _NOCAP_ALLOC, "kind": "key_inputs:key-B",
         "payload": {"flows": [], "anchor_usd": b_anchor, "anchor_null_reason": token,
                     "venue": "deribit",
                     "realized_terminal_usd": terminal_usd, "realized_terminal_day": b_last,
                     "composed_flows": [],
                     "composed_day_pnl": [{"utc_day_iso": d, "pnl_usd": 0.0} for d in _BTC_DAYS[:3]]}},
    ]
    return {"csv_daily_returns": csv, DERIVED_TABLE: derived, LEGACY_TABLE: [], "api_keys": api_keys}


async def _compose_no_capital_book(seed: dict[str, list[dict]]) -> dict:
    from unittest.mock import patch

    from services.job_worker import run_derive_allocator_equity_job

    fake = _FakeSupabase(seed)
    job = {"id": "j-nocap", "kind": "derive_allocator_equity", "allocator_id": _NOCAP_ALLOC}
    with patch("services.job_worker.get_supabase", return_value=fake):
        result = await run_derive_allocator_equity_job(job)
    assert result.outcome.name == "DONE", (result.error_kind, result.error_message)
    curve = [u for u in fake.upserts if _is_equity_curve_upsert(u[1])]
    assert len(curve) == 1, fake.upserts
    return _extract_payload(curve[0][1])


@pytest.mark.asyncio
async def test_no_capital_exit_deribit_dust_key_composes_through_its_terminal_and_leaves() -> None:
    """D-08 (option A, plan 08 tracer). A Deribit account that was emptied has real history: the
    writer's own levels through its last measured day are the only numbers that are not invented.
    Dropping the key (``dropped_key``) marks a correct book untrustworthy for as long as the key
    stays connected; reading its NULL live anchor as capital would invent money. So B composes at
    its own levels through its realized-terminal day and leaves after it as an exit: never a
    return, its last level never carried, and named."""
    payload = await _compose_no_capital_book(_no_capital_book())

    assert payload["is_trustworthy"] is True, payload["degrade_reasons"]
    assert "dropped_key" not in payload["degrade_reasons"]
    assert "no_anchor" not in payload["degrade_reasons"]
    curve = {r["date"]: r["equity_usd"] for r in payload["curve"]}
    assert [curve[d] for d in _BTC_DAYS[:3]] == [pytest.approx(100_060.0, abs=1e-9)] * 3
    assert [curve[d] for d in _BTC_DAYS[3:]] == [pytest.approx(100_000.0, abs=1e-9)] * 2
    assert {r["date"]: r["r"] for r in payload["returns"]}[_BTC_DAYS[3]] == pytest.approx(
        0.0, abs=1e-12
    )
    assert "no_capital_key_exited" in payload["flags"]
    assert payload["no_capital_exited_keys"] == [
        {"api_key_id": "key-B", "reason": "dust", "day": _BTC_DAYS[2]}
    ]


@pytest.mark.asyncio
async def test_no_capital_exit_a_dust_token_over_a_funded_terminal_stays_dropped() -> None:
    """D-08 sub-option A2. The exit trusts the live read's token, so it must not be the only
    witness: a transient zero or a mis-priced balance on a FUNDED account would otherwise exit
    the key while the book still reads trustworthy, its capital understated with no blocking
    reason. The writer's own last level is the second witness. Here B's live read says ``dust``
    but its writer stored a terminal of 60000.0, far above the dust floor, so the two disagree and
    the key keeps today's ``dropped_key`` (blocking) instead of exiting."""
    payload = await _compose_no_capital_book(_no_capital_book(terminal_usd=60_000.0))

    assert payload["is_trustworthy"] is False
    assert "dropped_key" in payload["degrade_reasons"]
    assert "no_capital_key_exited" not in payload["flags"]
    assert "no_capital_exited_keys" not in payload


@pytest.mark.asyncio
async def test_no_capital_exit_a2_a_terminal_exactly_at_the_dust_floor_exits() -> None:
    """D-08 A2, the boundary. The writer stamps ``dust`` at ``|equity| <= DUST_NAV_FLOOR`` and A2
    asks the writer's own terminal to agree at that same line, so a terminal EQUAL to the floor
    is the writer's idea of dust and the key exits trustworthy. The floor is read by symbol: 167.1.2
    D-27 moved it from 1000 to 100 and fixtures written against a number went stale. With the
    pair below, a ``<=`` that drifts to ``<`` (or a floor that forks from the writer's) fails here."""
    payload = await _compose_no_capital_book(_no_capital_book(terminal_usd=DUST_NAV_FLOOR))

    assert payload["is_trustworthy"] is True, payload["degrade_reasons"]
    assert "dropped_key" not in payload["degrade_reasons"]
    curve = {r["date"]: r["equity_usd"] for r in payload["curve"]}
    assert [curve[d] for d in _BTC_DAYS[:3]] == [
        pytest.approx(100_000.0 + DUST_NAV_FLOOR, abs=1e-6)
    ] * 3
    assert payload["no_capital_exited_keys"] == [
        {"api_key_id": "key-B", "reason": "dust", "day": _BTC_DAYS[2]}
    ]


@pytest.mark.asyncio
async def test_no_capital_exit_a2_a_terminal_one_cent_over_the_dust_floor_stays_dropped() -> None:
    """D-08 A2, the other side of the boundary. A terminal of ``DUST_NAV_FLOOR + 0.01`` is material
    capital by the writer's own line, so a ``dust`` token over it is a transient zero or a
    mis-priced balance until proven otherwise: the key keeps today's blocking ``dropped_key``."""
    payload = await _compose_no_capital_book(
        _no_capital_book(terminal_usd=DUST_NAV_FLOOR + 0.01)
    )

    assert payload["is_trustworthy"] is False
    assert "dropped_key" in payload["degrade_reasons"]
    assert "no_capital_key_exited" not in payload["flags"]
    assert "no_capital_exited_keys" not in payload


def test_no_capital_fixture_terminals_are_dust_under_the_current_floor() -> None:
    """The fixtures that mean "dust" are numbers, and A2 compares them to ``DUST_NAV_FLOOR``. When
    the floor moves below one of them, every exit test fails with a composed-book symptom
    (``dropped_key``, a ValueError on unpack) that does not say why. Fail here instead, by name:
    re-aim these constants at or below the floor and rebuild the levels derived from them."""
    for name, terminal in (
        ("_NC_DUST_TERMINAL", _NC_DUST_TERMINAL),
        ("_NC_A3_TERMINAL", _NC_A3_TERMINAL),
    ):
        assert terminal <= DUST_NAV_FLOOR, (
            f"{name}={terminal} is above DUST_NAV_FLOOR={DUST_NAV_FLOOR}: A2 now refuses it"
        )


# --- compose: every shape a no-capital key can take (166.3.1 plan 09, D-08 A + A2 + A3) ---------
#
# Key A (binance) holds 100000.0 flat on every day of its book. Each candidate below is a connected
# key whose live read found no capital (NULL anchor, ``dust`` or ``nonpositive``) but whose writer
# stored a return series, a realized terminal and, on Deribit, the basis it rolled on. Day numbers
# in the docstrings are 1-based over the book's days.


def _nc_candidate(
    key: str,
    exchange: str,
    return_days: list[str],
    payload: dict[str, Any],
    *,
    returns: dict[str, float] | None = None,
) -> dict[str, Any]:
    return {
        "id": key, "exchange": exchange, "return_days": return_days, "payload": payload,
        "returns": returns or {},
    }


def _nc_assemble(
    candidates: list[dict[str, Any]], *, a_days: list[str] | None = None
) -> dict[str, list[dict]]:
    a_days = a_days or _BTC_DAYS
    api_keys = [
        {"id": "key-A", "user_id": _NOCAP_ALLOC, "is_active": True, "exchange": "binance",
         "sync_status": "connected", "disconnected_at": None}
    ] + [
        {"id": c["id"], "user_id": _NOCAP_ALLOC, "is_active": True, "exchange": c["exchange"],
         "sync_status": "connected", "disconnected_at": None}
        for c in candidates
    ]
    csv = [
        {"api_key_id": "key-A", "allocator_id": _NOCAP_ALLOC, "date": day, "daily_return": 0.0}
        for day in a_days
    ]
    for c in candidates:
        csv += [
            {"api_key_id": c["id"], "allocator_id": _NOCAP_ALLOC, "date": day,
             "daily_return": c["returns"].get(day, 0.0)}
            for day in c["return_days"]
        ]
    derived = [
        {"allocator_id": _NOCAP_ALLOC, "kind": "key_inputs:key-A",
         "payload": {"flows": [], "anchor_usd": 100_000.0, "venue": "binance",
                     "realized_terminal_usd": 100_000.0, "realized_terminal_day": a_days[-1]}}
    ] + [
        {"allocator_id": _NOCAP_ALLOC, "kind": f"key_inputs:{c['id']}", "payload": c["payload"]}
        for c in candidates
    ]
    return {"csv_daily_returns": csv, DERIVED_TABLE: derived, LEGACY_TABLE: [], "api_keys": api_keys}


def _nc_payload(
    token: str,
    venue: str,
    terminal_usd: float,
    terminal_day: str,
    *,
    flows: dict[str, float] | None = None,
    dropped_pnl: dict[str, float] | None = None,
    basis_flows: dict[str, float] | None = None,
    basis_pnl: dict[str, float] | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "flows": [{"utc_day_iso": d, "usd_signed": v} for d, v in (flows or {}).items()],
        "anchor_usd": None, "anchor_null_reason": token, "venue": venue,
        "realized_terminal_usd": terminal_usd, "realized_terminal_day": terminal_day,
    }
    if dropped_pnl:
        payload["dropped_day_pnl"] = [
            {"utc_day_iso": d, "pnl_usd": v} for d, v in dropped_pnl.items()
        ]
    if basis_pnl is not None:
        payload["composed_flows"] = [
            {"utc_day_iso": d, "flow_usd": v} for d, v in (basis_flows or {}).items()
        ]
        payload["composed_day_pnl"] = [{"utc_day_iso": d, "pnl_usd": v} for d, v in basis_pnl.items()]
    return payload


def _nc_curve(payload: dict) -> dict[str, float]:
    return {r["date"]: r["equity_usd"] for r in payload["curve"]}


def _nc_book_returns(payload: dict) -> dict[str, float]:
    return {r["date"]: r["r"] for r in payload["returns"]}


def _nc_deribit_a3_book(*, return_on_last_day: float = 0.0) -> dict[str, list[dict]]:
    """PROD book 1's Deribit dust key: returns end on day 3 (L), the writer's final day is day 4
    (P = L + 1) and carries a 40.0 dust deposit and 10.0 of P&L, the stored terminal is 65.0, and
    the writer's day P&L has NO entry on day 3 (the gap-fill row that carries the level)."""
    d = _BTC_DAYS
    return _nc_assemble([
        _nc_candidate(
            "key-B", "deribit", d[:3],
            _nc_payload(
                "dust", "deribit", _NC_A3_TERMINAL, d[3],
                flows={d[3]: 40.0}, dropped_pnl={d[3]: 10.0},
                basis_flows={d[3]: 40.0}, basis_pnl={d[0]: 0.0, d[1]: 0.0, d[3]: 10.0},
            ),
            returns={d[2]: return_on_last_day},
        )
    ])


def _nc_mt5_withdrawal_book() -> dict[str, list[dict]]:
    """PROD book 2's MT5 nonpositive key: returns end on day 3 (L), a full 20000.0 withdrawal is
    dated on day 4 (P = L + 1) and the stored terminal on day 4 is exactly 0.0. D-10 (166.3.1
    review round 1): the writer stores the P&L of every day it drops (D-15), so the withdrawal day
    carries a stored dropped-day P&L, 0.0 (the account only paid money out)."""
    d = _BTC_DAYS
    return _nc_assemble([
        _nc_candidate(
            "key-C", "mt5", d[:3],
            _nc_payload(
                "nonpositive", "mt5", 0.0, d[3],
                flows={d[3]: -20_000.0}, dropped_pnl={d[3]: 0.0},
            ),
        )
    ])


@pytest.mark.asyncio
async def test_no_capital_exit_mt5_nonpositive_key_emptied_by_a_final_withdrawal() -> None:
    """D-08 for the MT5 shape (return-factor roll, no writer basis). An account closed by a
    final withdrawal reads zero capital on the day it was emptied, and the withdrawal is a FLOW
    in the ledger, never a loss in the book. C holds 20000.0 on days 1 to 3, is 0.0 on day 4 (the
    withdrawal day, explained by the withdrawal), and is out of the book after it; the book's
    return on day 4 is A's own 0.0. Reading the emptied level as a loss, or dropping the key,
    both misstate a book whose owner simply took money out."""
    d = _BTC_DAYS
    book = _nc_assemble([
        _nc_candidate(
            "key-C", "mt5", d[:4],
            _nc_payload("nonpositive", "mt5", 0.0, d[3], flows={d[3]: -20_000.0}),
        )
    ])
    payload = await _compose_no_capital_book(book)

    assert payload["is_trustworthy"] is True, payload["degrade_reasons"]
    assert "dropped_key" not in payload["degrade_reasons"]
    curve = _nc_curve(payload)
    assert [curve[x] for x in d[:3]] == [pytest.approx(120_000.0, abs=1e-9)] * 3
    assert [curve[x] for x in d[3:]] == [pytest.approx(100_000.0, abs=1e-9)] * 2
    assert _nc_book_returns(payload)[d[3]] == pytest.approx(0.0, abs=1e-12)
    assert payload["no_capital_exited_keys"] == [
        {"api_key_id": "key-C", "reason": "nonpositive", "day": d[3]}
    ]


@pytest.mark.asyncio
async def test_no_capital_exit_mt5_dust_key_with_a_small_positive_terminal() -> None:
    """D-08 W5 (b). A dust key (no writer basis) whose writer ends at 80.0, under the dust floor
    and above its own emptied band (a 4000.0 peak gives a band under 40.0), is live capital by
    DERIBITWEDGE D-09: it composes at the writer's levels (4000.0, 800.0, 80.0), its last level is
    NOT zeroed, and it exits after day 3 as a named exit, never a loss."""
    d = _BTC_DAYS
    book = _nc_assemble([
        _nc_candidate(
            "key-D", "mt5", d[:3], _nc_payload("dust", "mt5", 80.0, d[2]),
            returns={d[1]: -0.8, d[2]: -0.9},
        )
    ])
    payload = await _compose_no_capital_book(book)

    assert payload["is_trustworthy"] is True, payload["degrade_reasons"]
    curve = _nc_curve(payload)
    assert [curve[x] for x in d[:3]] == [
        pytest.approx(104_000.0, abs=1e-6),
        pytest.approx(100_800.0, abs=1e-6),
        pytest.approx(100_080.0, abs=1e-6),
    ]
    assert [curve[x] for x in d[3:]] == [pytest.approx(100_000.0, abs=1e-9)] * 2
    assert _nc_book_returns(payload)[d[3]] == pytest.approx(0.0, abs=1e-12)
    assert payload["no_capital_exited_keys"] == [
        {"api_key_id": "key-D", "reason": "dust", "day": d[2]}
    ]


@pytest.mark.asyncio
async def test_no_capital_exit_a3_deribit_dust_deposit_after_last_return() -> None:
    """D-08 A3 (PROD book 1's Deribit dust key). The writer drops the return of its last day (a
    dust prior NAV), so the key's history ends on its last RETURN day L (day 3) while its stored
    terminal sits on day 4 with a 40.0 dust deposit and 10.0 of P&L. The level on L is the writer's
    own terminal walked back through that dropped day, 65.0 - 40.0 - 10.0 = 15.0, and nothing is
    invented. B is 15.0 on days 1 to 3 and leaves after day 3; the day-4 deposit is consumed by the
    walk-back, not booked, so there is no out-of-window flow, and the exit is not a book loss. The
    fixture leaves day 3 out of the writer day-P&L series, so this is also the pad's proof: without
    a zero P&L on L the replay would fall out of writer mode (``key_inputs_mismatch``)."""
    d = _BTC_DAYS
    payload = await _compose_no_capital_book(_nc_deribit_a3_book())

    assert "out_of_window_flow" not in payload["degrade_reasons"]
    assert "key_inputs_mismatch" not in payload["degrade_reasons"]
    assert payload["is_trustworthy"] is True, payload["degrade_reasons"]
    curve = _nc_curve(payload)
    assert [curve[x] for x in d[:3]] == [pytest.approx(100_015.0, abs=1e-9)] * 3
    assert [curve[x] for x in d[3:]] == [pytest.approx(100_000.0, abs=1e-9)] * 2
    assert _nc_book_returns(payload)[d[3]] == pytest.approx(0.0, abs=1e-12)
    assert payload["no_capital_exited_keys"] == [
        {"api_key_id": "key-B", "reason": "dust", "day": d[2]}
    ]


@pytest.mark.asyncio
async def test_no_capital_exit_a3_mt5_withdrawal_after_last_return() -> None:
    """D-08 A3 (PROD book 2's MT5 nonpositive key). The writer dropped the return of the day a
    withdrawal dominated the prior NAV, so the returns end on day 3 (L) and the full 20000.0
    withdrawal is dated on day 4. The level on L is the terminal walked back through the
    withdrawal, 0.0 - (-20000.0) - 0.0 = 20000.0. C is 20000.0 on days 1 to 3 and out after day 3;
    the withdrawal is consumed by the walk-back, never a book loss, and not an out-of-window flow."""
    d = _BTC_DAYS
    payload = await _compose_no_capital_book(_nc_mt5_withdrawal_book())

    assert "out_of_window_flow" not in payload["degrade_reasons"]
    assert payload["is_trustworthy"] is True, payload["degrade_reasons"]
    curve = _nc_curve(payload)
    assert [curve[x] for x in d[:3]] == [pytest.approx(120_000.0, abs=1e-9)] * 3
    assert [curve[x] for x in d[3:]] == [pytest.approx(100_000.0, abs=1e-9)] * 2
    assert _nc_book_returns(payload)[d[3]] == pytest.approx(0.0, abs=1e-12)
    assert payload["no_capital_exited_keys"] == [
        {"api_key_id": "key-C", "reason": "nonpositive", "day": d[2]}
    ]


# --- guards: the rule may only make a book better (166.3.1 plan 09, Task 2) --------------------


async def _compose_no_capital_book_spy(
    seed: dict[str, list[dict]],
) -> tuple[dict, list[dict[str, Any]]]:
    """``_compose_no_capital_book`` plus the keyword arguments each real compose call received."""
    from unittest.mock import patch

    import services.allocator_equity_compose as compose_module

    real = compose_module.compose_allocator_equity
    calls: list[dict[str, Any]] = []

    def _spy(*args: Any, **kwargs: Any) -> dict:
        calls.append({"args": args, **kwargs})
        return real(*args, **kwargs)

    with patch("services.allocator_equity_compose.compose_allocator_equity", _spy):
        payload = await _compose_no_capital_book(seed)
    return payload, calls


def _nc_deribit_dust_book(
    *, token: str | None = "dust", terminal: tuple[str, float] | None, **payload_kwargs: Any
) -> dict[str, list[dict]]:
    """A Deribit-shaped candidate on days 1 to 3 (flat returns, a writer basis with a zero day P&L
    on each), terminal on day 3 unless told otherwise."""
    d = _BTC_DAYS
    payload = _nc_payload(
        token or "dust", "deribit", terminal[1] if terminal else 0.0,
        terminal[0] if terminal else d[2],
        basis_pnl={d[0]: 0.0, d[1]: 0.0, d[2]: 0.0}, **payload_kwargs,
    )
    if token is None:
        del payload["anchor_null_reason"]
    if terminal is None:
        del payload["realized_terminal_usd"]
        del payload["realized_terminal_day"]
    return _nc_assemble([_nc_candidate("key-B", "deribit", d[:3], payload)])


@pytest.mark.asyncio
@pytest.mark.parametrize("token", ["balance_error", "nonfinite", "flow_drop", None])
async def test_no_capital_exit_read_failures_stay_dropped(token: str | None) -> None:
    """T-166.3.1-32. A failed read is not an empty account. ``balance_error``, ``nonfinite``,
    ``flow_drop`` and a missing token say the live balance could not be read, not that it was
    zero, so a key carrying them keeps the blocking ``dropped_key`` even when it has returns and a
    small stored terminal. Exiting it would turn an unknown into a clean book."""
    payload = await _compose_no_capital_book(
        _nc_deribit_dust_book(token=token, terminal=(_BTC_DAYS[2], _NC_DUST_TERMINAL))
    )

    assert "dropped_key" in payload["degrade_reasons"]
    assert payload["is_trustworthy"] is False
    assert "no_capital_exited_keys" not in payload
    assert "no_capital_key_exited" not in payload["flags"]


@pytest.mark.asyncio
async def test_no_capital_exit_no_stored_terminal_stays_dropped() -> None:
    """T-166.3.1-32. Without the writer's stored terminal there is no level that is not invented:
    the key would have to be anchored at zero. A dust key with returns, a withdrawal on its last
    day (the shape that WOULD compose as an emptied account) and no terminal keeps ``dropped_key``."""
    d = _BTC_DAYS
    payload = await _compose_no_capital_book(
        _nc_deribit_dust_book(
            terminal=None, flows={d[2]: -500.0}, basis_flows={d[2]: -500.0}
        )
    )

    assert "dropped_key" in payload["degrade_reasons"]
    assert payload["is_trustworthy"] is False
    assert "no_capital_exited_keys" not in payload


@pytest.mark.asyncio
async def test_no_capital_exit_terminal_inside_the_emptied_band_composes_as_zero_capital() -> None:
    """D-08 with DERIBITWEDGE D-01/D-09. An account drained by a withdrawal leaves 5.0 behind,
    inside its emptied band (a 20000.0 peak gives a band under 100.0). The replay reads that
    day as zero capital, explained by the withdrawal, and the job must admit the in-band terminal
    rather than refuse it: the key composes (20000.0, 20000.0, then 0.0), exits after day 3, is
    named, and the book reads trustworthy."""
    d = _BTC_DAYS
    book = _nc_assemble([
        _nc_candidate(
            "key-B", "deribit", d[:3],
            _nc_payload(
                "dust", "deribit", 5.0, d[2],
                flows={d[2]: -19_995.0}, basis_flows={d[2]: -19_995.0},
                basis_pnl={d[0]: 0.0, d[1]: 0.0, d[2]: 0.0},
            ),
        )
    ])
    payload = await _compose_no_capital_book(book)

    assert payload["is_trustworthy"] is True, payload["degrade_reasons"]
    curve = _nc_curve(payload)
    assert [curve[x] for x in d[:3]] == [
        pytest.approx(120_000.0, abs=1e-9),
        pytest.approx(120_000.0, abs=1e-9),
        pytest.approx(100_000.0, abs=1e-9),
    ]
    assert payload["no_capital_exited_keys"] == [
        {"api_key_id": "key-B", "reason": "dust", "day": d[2]}
    ]


@pytest.mark.asyncio
async def test_no_capital_exit_a3_consumed_days_never_reach_the_compose() -> None:
    """T-166.3.1-33 (the trim, narrowed by D-10). A candidate whose terminal day P is after its
    last return day L ends on L, and the days in (L, P] are consumed by the walk-back. Nothing
    dated after L (day 3) may reach the compose: left in, the replay reads a flow past the last
    return day (``out_of_window_flow``) and a series running past its terminal. The deposit and
    the P&L of day 4 are dust-sized, which is what lets this key exit at all (D-10)."""
    d = _BTC_DAYS
    payload, calls = await _compose_no_capital_book_spy(_nc_deribit_a3_book())

    assert payload["is_trustworthy"] is True, payload["degrade_reasons"]
    assert payload["no_capital_exited_keys"] == [
        {"api_key_id": "key-B", "reason": "dust", "day": d[2]}
    ]
    (call,) = calls
    assert all(f.utc_day_iso <= d[2] for f in call["args"][1]["key-B"])  # flows_by_key
    assert all(day <= d[2] for day in call["dropped_day_pnl_by_key"]["key-B"])
    basis_flows, basis_pnl = call["writer_basis_by_key"]["key-B"]
    assert all(f.utc_day_iso <= d[2] for f in basis_flows)
    assert all(day <= d[2] for day in basis_pnl)


@pytest.mark.asyncio
async def test_no_capital_exit_anything_dated_after_the_terminal_day_stays_dropped() -> None:
    """D-10 (1), CR-01. A flow, a dropped-day P&L or a writer-basis day dated AFTER the key's
    realized terminal day (day 3, also its last return day) is not an exit this rule may name:
    the trim would erase it, and ``out_of_window_flow`` is the gate that names it today. It was
    exited here before D-10, with dust-sized amounts; D-10 supersedes that (the premise D-08 was
    measured on is 0 flows after the terminal day), so the key keeps ``dropped_key``."""
    d = _BTC_DAYS
    book = _nc_deribit_dust_book(
        terminal=(d[2], _NC_DUST_TERMINAL),
        flows={d[3]: 40.0, d[4]: 30.0}, dropped_pnl={d[3]: 10.0},
        basis_flows={d[3]: 40.0},
    )
    book[DERIVED_TABLE][1]["payload"]["composed_day_pnl"].append(
        {"utc_day_iso": d[3], "pnl_usd": 10.0}
    )
    payload = await _compose_no_capital_book(book)

    assert "dropped_key" in payload["degrade_reasons"]
    assert payload["is_trustworthy"] is False
    assert "no_capital_exited_keys" not in payload
    assert "no_capital_key_exited" not in payload["flags"]


@pytest.mark.asyncio
async def test_no_capital_exit_anything_dated_after_the_terminal_day_stays_dropped_without_a_basis() -> None:
    """D-10 (1), the return-factor roll (no writer basis, the MT5 shape): the same refusal for a
    flow and a dropped-day P&L dated after the terminal day (day 3). Superseded by D-10 from the
    pre-D-10 T-166.3.1-33 expectation that these were trimmed and the key exited."""
    d = _BTC_DAYS
    book = _nc_assemble([
        _nc_candidate(
            "key-C", "mt5", d[:3],
            _nc_payload(
                "dust", "mt5", _NC_DUST_TERMINAL, d[2],
                flows={d[3]: 40.0, d[4]: 30.0}, dropped_pnl={d[3]: 10.0},
            ),
        )
    ])
    payload = await _compose_no_capital_book(book)

    assert "dropped_key" in payload["degrade_reasons"]
    assert payload["is_trustworthy"] is False
    assert "no_capital_exited_keys" not in payload
    assert "no_capital_key_exited" not in payload["flags"]


@pytest.mark.asyncio
async def test_no_capital_exit_margin_call_then_liquidation_stays_dropped() -> None:
    """D-10 (2), CR-01 reviewer Run 1. An MT5 dust key is flat on days 1 to 3 (L = day 3). Day 4
    carries a +10000 deposit and -14500 of P&L (a margin call, then a liquidation) and the stored
    terminal is 50.0, under the dust floor, so A2 passes. The walk-back would put 4550.0 on L and
    book the 14500 loss as nothing: a TRUSTWORTHY book with the loss erased and the key leaving as
    a 4550 withdrawal. The consumed P&L is far above the dust floor, so the key keeps
    ``dropped_key``, which is the honest answer."""
    d = _BTC_DAYS
    book = _nc_assemble([
        _nc_candidate(
            "key-C", "mt5", d[:3],
            _nc_payload(
                "dust", "mt5", 50.0, d[3],
                flows={d[3]: 10_000.0}, dropped_pnl={d[3]: -14_500.0},
            ),
        )
    ])
    payload = await _compose_no_capital_book(book)

    assert "dropped_key" in payload["degrade_reasons"]
    assert payload["is_trustworthy"] is False
    assert "no_capital_exited_keys" not in payload
    assert "no_capital_key_exited" not in payload["flags"]


@pytest.mark.asyncio
async def test_no_capital_exit_a_deposit_after_the_terminal_day_stays_blocked() -> None:
    """D-10 (1), CR-01 reviewer Run 2. A dust key has its terminal day P == its last return day L
    (day 3), a stored terminal of 60.0 and a +50000 flow dated on day 5. On ``origin/main`` that
    flow is a blocking ``out_of_window_flow``; the exit trim turned it into nothing, so the book
    read trustworthy with 50000 of capital gone. It keeps ``dropped_key`` and stays untrustworthy."""
    d = _BTC_DAYS
    book = _nc_assemble([
        _nc_candidate(
            "key-C", "mt5", d[:3],
            _nc_payload("dust", "mt5", _NC_DUST_TERMINAL, d[2], flows={d[4]: 50_000.0}),
        )
    ])
    payload = await _compose_no_capital_book(book)

    assert "dropped_key" in payload["degrade_reasons"]
    assert payload["is_trustworthy"] is False
    assert "no_capital_exited_keys" not in payload
    assert "no_capital_key_exited" not in payload["flags"]


@pytest.mark.asyncio
async def test_no_capital_exit_a_flow_day_without_a_stored_pnl_stays_dropped() -> None:
    """D-10 (3), WR-01. A binance dust key has returns on days 1 and 2 only (L = day 2) and a
    terminal of 50.0 on day 5, with a -8000 flow on day 4 and NO stored P&L anywhere. A writer
    would not drop day 3 (no flow, and a prior NAV above dust), so (L, P] is not evidenced as the
    writer's own dropped days: walking back through it would invent a level of 8050.0 on L and
    disable the ``key_inputs_mismatch`` detector that exists for exactly this row. The key keeps
    ``dropped_key``."""
    d = _BTC_DAYS
    book = _nc_assemble([
        _nc_candidate(
            "key-E", "binance", d[:2],
            _nc_payload("dust", "binance", 50.0, d[4], flows={d[3]: -8_000.0}),
        )
    ])
    payload = await _compose_no_capital_book(book)

    assert "dropped_key" in payload["degrade_reasons"]
    assert payload["is_trustworthy"] is False
    assert "no_capital_exited_keys" not in payload
    assert "no_capital_key_exited" not in payload["flags"]


@pytest.mark.asyncio
async def test_no_capital_exit_an_empty_window_after_the_last_return_stays_dropped() -> None:
    """D-10 (3), WR-03. A binance dust key has returns on days 1 and 2 only (L = day 2) and a
    stored terminal of 50.0 on day 5, with NO flow and NO stored P&L anywhere in (L, P].

    Why it must stay ``dropped_key``: a writer drops a no-flow day only when the prior NAV is dust,
    and it stores a P&L row for every NAV day it drops. So an empty window is what a
    returns/inputs disagreement looks like (returns missing, or a terminal that does not belong
    to this key's history), which is exactly the row the ``realized_terminal_day_mismatch``
    detector exists for. Treating the empty window as evidence passes the rule vacuously, rescales
    the key's whole history to the terminal level and silences that detector, so the book would
    read trustworthy where it was untrustworthy before this phase. Every day in (L, P] must carry
    a stored P&L, not only the days that carry a flow."""
    d = _BTC_DAYS
    book = _nc_assemble([
        _nc_candidate("key-E", "binance", d[:2], _nc_payload("dust", "binance", 50.0, d[4]))
    ])
    payload = await _compose_no_capital_book(book)

    assert "dropped_key" in payload["degrade_reasons"]
    assert payload["is_trustworthy"] is False
    assert "no_capital_exited_keys" not in payload
    assert "no_capital_key_exited" not in payload["flags"]


@pytest.mark.asyncio
async def test_no_capital_exit_dust_sized_final_days_still_exit() -> None:
    """D-10 control. The measured PROD shapes (dust-sized final days, no flow after P) are what
    A3 exists for and must still exit. An MT5 dust key is flat on days 1 to 3 (L = day 3); day 4
    (P) carries a deposit of 0.3 x DUST_NAV_FLOOR and a P&L of exactly -DUST_NAV_FLOOR (the
    boundary: ``>`` refuses, equal exits), both stored, and the terminal is 0.8 x DUST_NAV_FLOOR
    (under the floor, so A2 passes). The level on L is terminal - deposit + DUST_NAV_FLOOR, which
    is 1.5 x DUST_NAV_FLOOR for any floor; B composes at it through day 3 and leaves as a named
    exit."""
    d = _BTC_DAYS
    terminal = 0.8 * DUST_NAV_FLOOR
    deposit = 0.3 * DUST_NAV_FLOOR
    level_l = terminal - deposit + DUST_NAV_FLOOR
    book = _nc_assemble([
        _nc_candidate(
            "key-C", "mt5", d[:3],
            _nc_payload(
                "dust", "mt5", terminal, d[3],
                flows={d[3]: deposit}, dropped_pnl={d[3]: -DUST_NAV_FLOOR},
            ),
        )
    ])
    payload = await _compose_no_capital_book(book)

    assert payload["is_trustworthy"] is True, payload["degrade_reasons"]
    curve = _nc_curve(payload)
    assert [curve[x] for x in d[:3]] == [pytest.approx(100_000.0 + level_l, abs=1e-6)] * 3
    assert [curve[x] for x in d[3:]] == [pytest.approx(100_000.0, abs=1e-9)] * 2
    assert payload["no_capital_exited_keys"] == [
        {"api_key_id": "key-C", "reason": "dust", "day": d[2]}
    ]


@pytest.mark.asyncio
async def test_no_capital_exit_inception_residual_stays_dropped() -> None:
    """(c) A key whose opening flows do not reconcile with its first return day's level (here the
    capital implied before them is 0.15% of that level, against a 0.01% band) is a fact in the
    writer's stored data that no exit rule may paper over (D-02: the gate is not loosened). This
    test pins that a genuine unreconciled opening flow keeps today's named ``dropped_key``: the
    candidate falls back before its blocked curve can enter the book, so ``inception_unreconciled``
    is NOT what the book says, the key is not named as exited, and the book is untrustworthy.

    SC-9 (Phase 167.1.2.1.1 WRITERRESIDUALS) is no longer open. The 0.15% residual was measured on
    PROD book 1's MT5 key before the 164.6.6.2.3 recompute; it was re-measured clean on PROD on
    2026-10-16 (no equity-curve row carries ``inception_unreconciled``, book 1 is trustworthy,
    every connected MT5 key replays clean on its stored writer basis, far inside the band), and SC-9
    is closed by recorded decision (D-11, founder 2026-10-16), not by a code change."""
    d = _BTC_DAYS
    book = _nc_assemble([
        _nc_candidate(
            "key-D", "mt5", d[2:],
            _nc_payload("dust", "mt5", 80.0, d[4], flows={d[1]: 79.88}),
        )
    ])
    payload = await _compose_no_capital_book(book)

    assert "dropped_key" in payload["degrade_reasons"]
    assert "no_anchor" in payload["degrade_reasons"]
    assert "inception_unreconciled" not in payload["degrade_reasons"]
    assert payload["is_trustworthy"] is False
    assert "no_capital_exited_keys" not in payload
    assert "no_capital_key_exited" not in payload["flags"]


@pytest.mark.asyncio
async def test_no_capital_exit_a3_never_pads_a_writer_basis_over_a_real_return() -> None:
    """T-166.3.1-41. The pad states that a gap-fill row (stored return exactly 0.0) has no P&L. It
    is never laid over a day whose stored return is NOT zero: that would let a zero stand in for
    a real day's P&L. Here the key's return on its last day L is 0.01 and L is absent from its
    writer day P&L (a row whose basis and returns disagree). The job must not pad, so the replay
    reads ``writer_basis_mismatch`` and the key keeps ``dropped_key``: not composed, not named."""
    payload = await _compose_no_capital_book(_nc_deribit_a3_book(return_on_last_day=0.01))

    assert "dropped_key" in payload["degrade_reasons"]
    assert "no_anchor" in payload["degrade_reasons"]
    assert "key_inputs_mismatch" not in payload["degrade_reasons"]
    assert payload["is_trustworthy"] is False
    assert "no_capital_exited_keys" not in payload


# --- job level: a candidate must never cost the book its stored row (166.3.1 plan 09, Task 3) ---


@pytest.mark.asyncio
async def test_no_capital_exit_compose_refusal_reverts_the_candidates_and_keeps_the_row(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """T-166.3.1-39. The per-key fallback inside the compose cannot see a refusal that belongs to
    the WHOLE compose. If the compose refuses while a candidate is in play, the job must not take
    the permanent-failure path that deletes the stored equity_curve row (the book would show the
    rebuilding panel because of a rule that exists to make books better). It composes once more
    with every candidate's STORED inputs restored (NULL anchor, its token, the stored terminal pair
    on P, the untrimmed flows and the unpadded writer basis) and upserts today's result: B keeps
    ``dropped_key``. A wrapper is the honest way to reach this refusal: it raises only while a
    candidate is named, which no single stored row can make the real compose do on its own."""
    import logging
    from unittest.mock import patch

    import services.allocator_equity_compose as compose_module
    from services.job_worker import run_derive_allocator_equity_job
    from services.nav_twr import NavReconstructionError

    real = compose_module.compose_allocator_equity
    calls: list[dict[str, Any]] = []

    def _refuse_with_a_candidate(*args: Any, **kwargs: Any) -> dict:
        calls.append({"args": args, **kwargs})
        if kwargs.get("no_capital_exit_by_key"):
            raise NavReconstructionError("allocator equity replay: test-injected refusal")
        return real(*args, **kwargs)

    seed = _nc_deribit_a3_book()
    seed[DERIVED_TABLE].append(
        {"allocator_id": _NOCAP_ALLOC, "kind": "equity_curve",
         "payload": {"curve": [{"date": "2026-05-01", "equity_usd": 1.0}], "is_trustworthy": True,
                     "degrade_reasons": []}}
    )
    fake = _FakeSupabase(seed)
    job = {"id": "j-nocap-revert", "kind": "derive_allocator_equity", "allocator_id": _NOCAP_ALLOC}
    with (
        patch("services.job_worker.get_supabase", return_value=fake),
        patch("services.allocator_equity_compose.compose_allocator_equity", _refuse_with_a_candidate),
        caplog.at_level(logging.WARNING, logger="quantalyze.analytics.job_worker"),
    ):
        result = await run_derive_allocator_equity_job(job)

    assert result.outcome.name == "DONE", (result.error_kind, result.error_message)
    assert not [
        x for x in fake.deletes if x[0] == DERIVED_TABLE and x[1].get("kind") == "equity_curve"
    ], fake.deletes
    curve = [u for u in fake.upserts if _is_equity_curve_upsert(u[1])]
    assert len(curve) == 1
    payload = _extract_payload(curve[0][1])
    assert "dropped_key" in payload["degrade_reasons"]
    assert "no_anchor" in payload["degrade_reasons"]
    assert "no_capital_exited_keys" not in payload

    first, second = calls
    assert first["no_capital_exit_by_key"] == {"key-B": ("dust", _BTC_DAYS[2])}
    assert not second.get("no_capital_exit_by_key")
    _, flows_in, anchors_in, null_reasons_in = second["args"]
    assert anchors_in["key-B"] is None and null_reasons_in["key-B"] == "dust"
    assert [(f.utc_day_iso, f.usd_signed) for f in flows_in["key-B"]] == [(_BTC_DAYS[3], 40.0)]
    assert second["realized_terminal_by_key"]["key-B"] == (_BTC_DAYS[3], _NC_A3_TERMINAL)
    assert "key-B" not in (second.get("departed_end_by_key") or {})
    assert second["writer_basis_by_key"]["key-B"][1] == {
        _BTC_DAYS[0]: 0.0, _BTC_DAYS[1]: 0.0, _BTC_DAYS[3]: 10.0,
    }

    reverted = [r.getMessage() for r in caplog.records if "no-capital" in r.getMessage()]
    assert len(reverted) == 1, [r.getMessage() for r in caplog.records]
    assert "key-B" not in reverted[0] and "65.0" not in reverted[0]


@pytest.mark.asyncio
async def test_no_capital_exit_refusal_without_a_candidate_still_replaces_the_row() -> None:
    """T-166.3.1-39. The re-compose exists only for candidates. A compose that refuses with none in
    play is today's permanent failure and replaces the stale row with a refusal record (F2;
    167.1.2.1.1 D-04, it used to delete it); and when the re-compose itself refuses, the same path
    runs, so the job never loops and never keeps a row it cannot stand behind."""
    from unittest.mock import patch

    from services.job_worker import run_derive_allocator_equity_job
    from services.nav_twr import NavReconstructionError

    def _always_refuse(*_args: Any, **_kwargs: Any) -> dict:
        raise NavReconstructionError("allocator equity replay: test-injected refusal")

    for seed in (_nc_deribit_a3_book(), _nc_assemble([])):
        seed[DERIVED_TABLE].append(
            {"allocator_id": _NOCAP_ALLOC, "kind": "equity_curve",
             "payload": {"curve": [{"date": "2026-05-01", "equity_usd": 1.0}],
                         "is_trustworthy": True, "degrade_reasons": []}}
        )
        fake = _FakeSupabase(seed)
        job = {"id": "j-nocap-refuse", "kind": "derive_allocator_equity",
               "allocator_id": _NOCAP_ALLOC}
        with (
            patch("services.job_worker.get_supabase", return_value=fake),
            patch("services.allocator_equity_compose.compose_allocator_equity", _always_refuse),
        ):
            result = await run_derive_allocator_equity_job(job)
        assert result.outcome.name == "FAILED" and result.error_kind == "permanent"
        _assert_refusal_recorded(fake, _NOCAP_ALLOC, "compose_refused")


@pytest.mark.asyncio
async def test_no_capital_exit_two_candidates_each_leave_on_their_own_day() -> None:
    """W5 (a). PROD book 1 holds two candidates on different venues and days: a Deribit dust key
    whose terminal day is one day after its last return day (A3 ends it on day 3 at 15.0) and an
    MT5 dust key whose terminal is on its last return day (day 5, 80.0, no writer basis). Each
    leaves on its OWN end day, so the book is A+B+D (104015.0) through day 3, A+D on days 4 and 5
    (100800.0, 100080.0) and A alone (100000.0) after. B's day-4 deposit is consumed by the
    walk-back, never booked, and neither exit is a book loss: the book's return on day 6 is A's own
    0.0. Both are named with their own day, sorted by key id, and the book reads trustworthy."""
    days7 = [f"2026-06-{n:02d}" for n in range(6, 13)]
    d = days7
    book = _nc_assemble(
        [
            _nc_candidate(
                "key-B", "deribit", d[:3],
                _nc_payload(
                    "dust", "deribit", _NC_A3_TERMINAL, d[3],
                    flows={d[3]: 40.0}, dropped_pnl={d[3]: 10.0},
                    basis_flows={d[3]: 40.0}, basis_pnl={d[0]: 0.0, d[1]: 0.0, d[3]: 10.0},
                ),
            ),
            _nc_candidate(
                "key-D", "mt5", d[:5], _nc_payload("dust", "mt5", 80.0, d[4]),
                returns={d[3]: -0.8, d[4]: -0.9},
            ),
        ],
        a_days=d,
    )
    payload = await _compose_no_capital_book(book)

    assert "out_of_window_flow" not in payload["degrade_reasons"]
    assert payload["is_trustworthy"] is True, payload["degrade_reasons"]
    curve = _nc_curve(payload)
    assert [curve[x] for x in d] == [
        pytest.approx(v, abs=1e-6)
        for v in (104_015.0, 104_015.0, 104_015.0, 100_800.0, 100_080.0, 100_000.0, 100_000.0)
    ]
    book_returns = _nc_book_returns(payload)
    assert book_returns[d[5]] == pytest.approx(0.0, abs=1e-12)
    assert payload["no_capital_exited_keys"] == [
        {"api_key_id": "key-B", "reason": "dust", "day": d[2]},
        {"api_key_id": "key-D", "reason": "dust", "day": d[4]},
    ]


# ---------------------------------------------------------------------------
# 167.1.2.1.1 WRITERRESIDUALS plan 02, SC-2 (decision D-03): a single FAILING key
# whose series ends before the book's last day.
#
# WHY. Such a key is counted, but its series stopped the day it began to fail and
# the compose carries it flat at r = 0 (the benign ``stale_mark_carry``) while the
# rest of the book moves. The book's return is diluted by frozen capital and the
# curve still read "ready". A shared account with no working key already raises
# ``shared_account_no_working_key`` for the same dilution; a LONE failing key did
# not. A key that works but ends early, a failing key that reaches the book's last
# day, and a key that leaves the book on purpose (a no-capital exit) dilute nothing
# and raise nothing.
# ---------------------------------------------------------------------------

_SC2_ALLOC = "alloc-sc2"
_SC2_DAYS = [f"2026-06-{n:02d}" for n in range(1, 6)]  # 06-01 .. 06-05


def _sc2_book(
    *,
    a_status: str,
    a_days: list[str],
    b_days: list[str] | None = None,
    a_returns: bool = True,
    alloc: str = _SC2_ALLOC,
) -> _FakeSupabase:
    """Two single-key accounts: A (``a_status``, series over ``a_days``) and a
    working B (series over ``b_days``, default the whole span). Distinct stamped
    venue ids, so neither the identity gate nor SC-6 is in play."""
    b_days = _SC2_DAYS if b_days is None else b_days
    keys = [
        _gate_key("key-A", alloc, venue_account_id="venue-a", sync_status=a_status),
        _gate_key("key-B", alloc, venue_account_id="venue-b"),
    ]
    csv: list[dict] = []
    derived: list[dict] = [_stale_curve(alloc)]
    for key_id, days, anchor in (
        ("key-A", a_days if a_returns else [], 40_000.0),
        ("key-B", b_days, 60_000.0),
    ):
        csv += [
            {"api_key_id": key_id, "allocator_id": alloc, "date": day, "daily_return": 0.0}
            for day in days
        ]
        derived.append({
            "allocator_id": alloc,
            "kind": f"key_inputs:{key_id}",
            "payload": {
                "flows": [], "anchor_usd": anchor,
                "anchor_asof": (days or _SC2_DAYS)[-1], "venue": "binance",
            },
        })
    return _FakeSupabase({
        "api_keys": keys, "csv_daily_returns": csv, DERIVED_TABLE: derived, LEGACY_TABLE: [],
    })


@pytest.mark.asyncio
async def test_sc2_failing_single_key_ending_early_blocks() -> None:
    """A is failing (``error``) and its returns end two days before B's. The book
    carries A flat for those two days, so the curve is untrustworthy under
    ``failing_key_series_ended``. This is the derive half; the reader line is
    pinned by the writer_residual_resolution parity fixture."""
    fake = _sc2_book(a_status="error", a_days=_SC2_DAYS[:3])
    assert (await _run_gate(fake, _SC2_ALLOC)).outcome.name == "DONE"
    payload = _composed_payload(fake)
    assert "failing_key_series_ended" in payload["degrade_reasons"], payload["degrade_reasons"]
    assert payload["is_trustworthy"] is False


@pytest.mark.asyncio
async def test_sc2_failing_key_that_reaches_the_books_last_day_dilutes_nothing() -> None:
    """The same failing A, but its series reaches B's last day: no frozen capital
    is carried, so nothing is raised and the curve stays trustworthy."""
    fake = _sc2_book(a_status="error", a_days=_SC2_DAYS)
    assert (await _run_gate(fake, _SC2_ALLOC)).outcome.name == "DONE"
    payload = _composed_payload(fake)
    assert "failing_key_series_ended" not in payload["degrade_reasons"]
    assert payload["is_trustworthy"] is True, payload["degrade_reasons"]


@pytest.mark.asyncio
async def test_sc2_working_key_ending_early_raises_only_the_benign_carry() -> None:
    """A WORKING key that ends early is a sync lag, which the daily recompute
    answers; D-03 names a FAILING key. Only the benign ``stale_mark_carry`` shows."""
    fake = _sc2_book(a_status="connected", a_days=_SC2_DAYS[:3])
    assert (await _run_gate(fake, _SC2_ALLOC)).outcome.name == "DONE"
    payload = _composed_payload(fake)
    assert "failing_key_series_ended" not in payload["degrade_reasons"]
    assert payload["is_trustworthy"] is True, payload["degrade_reasons"]


@pytest.mark.asyncio
async def test_sc2_failing_key_that_leaves_the_book_on_purpose_raises_nothing() -> None:
    """RESEARCH Pitfall 7. A failing key in ``departed_end_by_key`` (here a
    no-capital exit: a Deribit dust key that is composed through its terminal day
    and then LEAVES the book) carries no frozen capital past that day, so ending
    early is its intended shape and not dilution."""
    seed = _no_capital_book()
    seed["api_keys"][1]["sync_status"] = "error"  # key-B: failing, ends on day 3 of 5
    payload = await _compose_no_capital_book(seed)
    assert "failing_key_series_ended" not in payload["degrade_reasons"]
    assert payload["is_trustworthy"] is True, payload["degrade_reasons"]
    assert payload["no_capital_exited_keys"], "the key must really have exited"


@pytest.mark.asyncio
async def test_sc2_failing_key_recovering_clears_the_token() -> None:
    """RESEARCH Pitfall 6. No grace is added: the token is a property of this
    derive's inputs. The same book with A back to working on the next derive
    carries no token."""
    failing = _sc2_book(a_status="error", a_days=_SC2_DAYS[:3])
    assert (await _run_gate(failing, _SC2_ALLOC)).outcome.name == "DONE"
    assert "failing_key_series_ended" in _composed_payload(failing)["degrade_reasons"]
    recovered = _sc2_book(a_status="connected", a_days=_SC2_DAYS[:3])
    assert (await _run_gate(recovered, _SC2_ALLOC)).outcome.name == "DONE"
    assert "failing_key_series_ended" not in _composed_payload(recovered)["degrade_reasons"]


@pytest.mark.asyncio
async def test_sc2_failing_key_with_inputs_but_no_returns_raises_no_keyerror() -> None:
    """A failing single key with a ``key_inputs`` row and no csv return rows has no
    last return day. SC-2 must not index ``last_return_day`` blindly (KeyError) and
    must not flag it: the compose already classifies it anchored-without-returns,
    which is the blocking ``dropped_key``, so the key is not silent."""
    fake = _sc2_book(a_status="error", a_days=[], a_returns=False)
    assert (await _run_gate(fake, _SC2_ALLOC)).outcome.name == "DONE"
    payload = _composed_payload(fake)
    assert "failing_key_series_ended" not in payload["degrade_reasons"]
    assert "dropped_key" in payload["degrade_reasons"]
    assert payload["is_trustworthy"] is False


# ---------------------------------------------------------------------------
# 167.1.2.1.1 WRITERRESIDUALS plan 02, SC-3 (decision D-03): the members of a
# stitched shared account disagree about the flows of a day the older one owns.
#
# WHY. The stitch keeps the owner's flows for a day and discards the newer key's
# (taking both would double a transfer the two crawls both list). If the newer key
# lists a DIFFERENT total, the curve is built on flows the account's own keys do
# not agree on, and it read "ready". The stitch itself is unchanged: the curve is
# withheld by the blocking token.
# ---------------------------------------------------------------------------

_SC3_MAY_DEPOSIT = {"utc_day_iso": "2026-05-15", "usd_signed": 10_000.0}


@pytest.mark.asyncio
async def test_sc3_flows_disagree_blocks() -> None:
    """M lists the May deposit AND a second 4000 deposit on 2026-05-20, a day H
    owns and lists nothing on. The two keys disagree on that day, so the book is
    untrustworthy under ``shared_account_flows_disagree``. The stitch is unchanged
    (the history still starts on H's first day, one counted key)."""
    alloc = "alloc-sc3-disagree"
    fake = _rotation_pair(
        alloc, "duplicate",
        old_flows=[_SC3_MAY_DEPOSIT],
        new_flows=[_SC3_MAY_DEPOSIT, {"utc_day_iso": "2026-05-20", "usd_signed": 4_000.0}],
    )
    assert (await _run_gate(fake, alloc)).outcome.name == "DONE"
    payload = _composed_payload(fake)
    assert "shared_account_flows_disagree" in payload["degrade_reasons"], payload["degrade_reasons"]
    assert payload["is_trustworthy"] is False
    assert payload["curve"][0]["date"] == "2026-05-01"
    assert payload["inputs"]["n_keys"] == 1


@pytest.mark.asyncio
async def test_sc3_flows_agree_keeps_the_stitch() -> None:
    """Both keys list the same May deposit: nothing disagrees, the stitch is
    today's (``shared_account_history_stitched``, trustworthy)."""
    alloc = "alloc-sc3-agree"
    fake = _rotation_pair(
        alloc, "duplicate",
        old_flows=[_SC3_MAY_DEPOSIT],
        new_flows=[_SC3_MAY_DEPOSIT],
    )
    assert (await _run_gate(fake, alloc)).outcome.name == "DONE"
    payload = _composed_payload(fake)
    assert "shared_account_flows_disagree" not in payload["degrade_reasons"]
    assert "shared_account_history_stitched" in payload["flags"]
    assert payload["is_trustworthy"] is True, payload["degrade_reasons"]


@pytest.mark.asyncio
async def test_sc3_a_newer_key_that_lists_nothing_is_silence() -> None:
    """The newer key's crawl does not reach back over H's days, so it lists none of
    H's flows. That is silence, not disagreement, and the book stays trustworthy."""
    alloc = "alloc-sc3-silence"
    fake = _rotation_pair(alloc, "duplicate", old_flows=[_SC3_MAY_DEPOSIT], new_flows=[])
    assert (await _run_gate(fake, alloc)).outcome.name == "DONE"
    payload = _composed_payload(fake)
    assert "shared_account_flows_disagree" not in payload["degrade_reasons"]
    assert payload["is_trustworthy"] is True, payload["degrade_reasons"]


# ---------------------------------------------------------------------------
# 167.1.2.1.1 WRITERRESIDUALS plan 02, SC-6 (decision D-03): two or more eligible
# WORKING keys on one stamping venue whose account is still UNKNOWN.
#
# WHY. Until the stamper reads a venue account id, the derive cannot tell whether two
# such keys read one exchange account (counted twice) or two. The reader already holds
# the book for any unknown key; the derive raised nothing, so the stored curve read
# "ready" to every consumer that does not go through the reader. The check reads the
# grouping and changes none of it (the four-way coupling rule is not triggered).
# ---------------------------------------------------------------------------


def _pending_key(key_id: str, **extra: Any) -> dict[str, Any]:
    """An eligible working key on a stamping venue with no account id yet."""
    return _gate_key(key_id, "alloc-pending", **{"exchange": "okx", **extra})


def test_identity_pending_venues_counts_venues_with_two_unknown_working_keys() -> None:
    from services.allocator_equity_derive import identity_pending_venues

    stamping = frozenset({"okx", "bybit", "binance", "deribit"})
    two = [_pending_key("k1"), _pending_key("k2")]
    assert identity_pending_venues(two, stamping) == 1
    assert identity_pending_venues(two[:1], stamping) == 0, "one unknown key is no pair"
    # Case and padding of the exchange do not hide the venue.
    assert identity_pending_venues(
        [_pending_key("k1", exchange=" OKX "), _pending_key("k2")], stamping
    ) == 1
    # Two venues with two keys each are counted as two.
    both = two + [
        _pending_key("k3", exchange="bybit"),
        _pending_key("k4", exchange="bybit"),
    ]
    assert identity_pending_venues(both, stamping) == 2
    # Keys on different venues never pair up.
    assert identity_pending_venues(
        [_pending_key("k1"), _pending_key("k2", exchange="bybit")], stamping
    ) == 0


def test_identity_pending_venues_ignores_every_key_that_cannot_be_a_pair_member() -> None:
    from services.allocator_equity_derive import identity_pending_venues

    stamping = frozenset({"okx", "bybit", "binance", "deribit"})
    # MT5 is not a stamping venue: its keys are exempt.
    assert identity_pending_venues(
        [_pending_key("k1", exchange="mt5"), _pending_key("k2", exchange="mt5")], stamping
    ) == 0
    # A marked key knows its account (the holder's), and so does the holder.
    assert identity_pending_venues(
        [
            _pending_key("k1"),
            _pending_key(
                "k2", account_share_kind="duplicate", account_shared_with_api_key_id="k1"
            ),
        ],
        stamping,
    ) == 0
    # A stamped key is known.
    assert identity_pending_venues(
        [_pending_key("k1", venue_account_id="v-1"), _pending_key("k2")], stamping
    ) == 0
    # A failing key is not WORKING: it is no candidate (the reader names it key_not_syncing).
    assert identity_pending_venues(
        [_pending_key("k1"), _pending_key("k2", sync_status="error")], stamping
    ) == 0
    # A disconnected or revoked key is not eligible at all.
    assert identity_pending_venues(
        [_pending_key("k1"), _pending_key("k2", disconnected_at="2026-06-01T00:00:00+00:00")],
        stamping,
    ) == 0
    assert identity_pending_venues(
        [_pending_key("k1"), _pending_key("k2", sync_status="revoked")], stamping
    ) == 0
    assert identity_pending_venues([], stamping) == 0


def _sc6_book(keys: list[dict[str, Any]], alloc: str = "alloc-pending") -> _FakeSupabase:
    csv: list[dict] = []
    derived: list[dict] = [_stale_curve(alloc)]
    for index, key in enumerate(keys):
        rows, ki = _series_rows(alloc, key["id"], 10_000.0 * (index + 1))
        csv += rows
        ki["payload"]["venue"] = key["exchange"]
        derived.append(ki)
    return _FakeSupabase({
        "api_keys": keys, "csv_daily_returns": csv, DERIVED_TABLE: derived, LEGACY_TABLE: [],
    })


@pytest.mark.asyncio
async def test_sc6_unknown_working_keys_block_the_derive() -> None:
    """Two unknown working okx keys: the book may count one account twice, so the
    curve is untrustworthy under ``account_identity_pending``."""
    fake = _sc6_book([_pending_key("key-A"), _pending_key("key-B")])
    assert (await _run_gate(fake, "alloc-pending")).outcome.name == "DONE"
    payload = _composed_payload(fake)
    assert "account_identity_pending" in payload["degrade_reasons"], payload["degrade_reasons"]
    assert payload["is_trustworthy"] is False


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "keys",
    [
        pytest.param([_pending_key("key-A"), _pending_key("key-B", venue_account_id="v-b")], id="one-unknown"),
        pytest.param(
            [_pending_key("key-A", exchange="mt5"), _pending_key("key-B", exchange="mt5")],
            id="mt5-pair",
        ),
        pytest.param(
            [_pending_key("key-A"), _pending_key("key-B", sync_status="error")], id="one-failing"
        ),
    ],
)
async def test_sc6_a_book_that_is_not_a_pair_of_unknown_working_keys_raises_nothing(
    keys: list[dict[str, Any]],
) -> None:
    fake = _sc6_book(keys)
    assert (await _run_gate(fake, "alloc-pending")).outcome.name == "DONE"
    payload = _composed_payload(fake)
    assert "account_identity_pending" not in payload["degrade_reasons"]
