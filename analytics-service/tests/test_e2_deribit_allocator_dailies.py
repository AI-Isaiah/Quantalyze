"""Phase 115 (E2 / STITCH-01 / BACKBONE-02) — the all-deribit allocator
dogfooding gap: an eligible deribit allocator key must produce per-key
``csv_daily_returns`` rows through KEY-MODE ``run_derive_broker_dailies_job`` so
the EXISTING Phase-36 blend (``queries.ts`` ``liveBaselineMetricsFromPerKeyDailies``)
renders shape + KPIs for an all-deribit allocator. Today all-deribit allocators
get NOTHING: the legacy ``allocator_equity_snapshots`` store carves out deribit
(``equity_reconstruction.py``:2084) and — per the 115-01 A1 census — 364/364
eligible deribit allocator keys on TEST have ZERO per-key csv_daily_returns rows.

VERIFY-FIRST characterization (Task 1). Three tests pin the exact failure layer
so Task 2 fixes the ROOT cause, not a guess:

  * ``TestHandlerKeyModeDeribitPath`` (H): does the key-mode + deribit native
    branch actually UPSERT csv_daily_returns keyed (api_key_id, date) with the
    denormalized allocator_id (= key.user_id), strategy_id None, and WITHOUT the
    strategy-only compute_analytics_from_csv enqueue? If yes → the handler is
    fine and the gap is enqueue/backfill.
  * ``TestStructuralRefusalFailsLoud`` (fail-loud invariant): a deribit key-mode
    derive whose native core raises ``NavReconstructionError`` stamps NO per-key
    row and writes ZERO csv_daily_returns — never a fabricated spot-gap series.
  * ``TestKeyModeEnqueueReachesDeribit`` (E): the ONLY key-mode (api_key-scoped)
    ``derive_broker_dailies`` enqueue is ``scripts.phase35_backfill_enqueue``
    (every recurring enqueue — cron re-sync, sync_trades epilogue, long_fetch tail
    — is strategy_id-scoped). Its active-key predicate is role- AND venue-agnostic,
    so an eligible deribit allocator key IS enqueued. This test drives ``main()``
    against an in-memory api_keys set and asserts the deribit key lands in the
    bulk-insert payload — mutation-falsifiable: adding any venue filter that drops
    deribit (``.eq("exchange", ...)`` / ``.neq("exchange", "deribit")``) reddens it.

Network-free: every I/O primitive is a stub / AsyncMock. The job imports its
Deribit primitives FUNCTION-LOCALLY, so the harness (reused from
``test_mtm_single_key``) patches the SOURCE modules.
"""
from __future__ import annotations

from typing import Any

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from services.job_worker import DispatchOutcome, run_derive_broker_dailies_job
from services.nav_twr import NavReconstructionError

# Reuse the proven single-key Deribit harness (mock exchange, capture upserts,
# native-ledger + account-state stubs) rather than re-building it.
from tests.test_mtm_single_key import (
    _apply,
    _base_patches,
    _cash_series,
    _ctx,
    _recording_ledger,
    _report,
)


# ── (H) handler: key-mode + deribit native branch → per-key csv upsert ──────


class TestHandlerKeyModeDeribitPath:
    """Characterize the KEY-MODE deribit handler path. The native branch runs for
    BOTH modes (it reads ``venue``, not role); the post-branch upsert (job_worker
    :2848) builds the api_key payload when ``is_key_mode``."""

    @pytest.mark.asyncio
    async def test_key_mode_deribit_upserts_per_key_dailies(self) -> None:
        # Eligible deribit allocator key. user_id is the AUTHORITATIVE owner —
        # the api_key payload's allocator_id must come from it, never the job.
        ctx, capture = _ctx(strategy_row=None, key_mode=True)
        ctx.key_row = {
            "id": "key-drb-alloc",
            "user_id": "alloc-deribit-1",
            "exchange": "deribit",
        }
        # A >=2-day native cash series (combine_native_ledger mock) so the derive
        # reaches the upsert (not the <2 short-circuit).
        reports = [_report(has_option_activity=False)]  # perp-only → single pass
        ledger_mock, calls = _recording_ledger(reports)
        combine = MagicMock(
            return_value=(_cash_series(), {"used_heuristic_capital": False})
        )
        with _apply(_base_patches(
            ctx, key_mode=True, ledger_mock=ledger_mock, combine_mock=combine,
        )):
            result = await run_derive_broker_dailies_job(
                {"api_key_id": "key-drb-alloc"}
            )

        assert result.outcome == DispatchOutcome.DONE

        csv_upserts = [u for u in capture["upserts"] if u[0] == "csv_daily_returns"]
        assert len(csv_upserts) == 1, (
            "an eligible deribit allocator key must upsert per-key csv_daily_returns "
            f"(the dogfooding-gap consumer); got {capture['upserts']!r}"
        )
        _name, payload, on_conflict = csv_upserts[0]
        # Per-key arbiter — NOT strategy_id,date.
        assert on_conflict == "api_key_id,date", (
            f"key-mode deribit must upsert on_conflict='api_key_id,date'; "
            f"got {on_conflict!r}"
        )
        assert isinstance(payload, list) and len(payload) >= 2
        for row in payload:
            assert row["api_key_id"] == "key-drb-alloc"
            # Denormalized allocator_id is the key owner (api_keys.user_id),
            # sourced from the preflight — never a job-payload allocator_id.
            assert row["allocator_id"] == "alloc-deribit-1", (
                "allocator_id must be the key owner (D3 blend denormalization); "
                f"got {row['allocator_id']!r}"
            )
            assert row["strategy_id"] is None
            assert "daily_return" in row and "date" in row

        # NO strategy-only side effects (per-key reads are Phase 36):
        # no compute_analytics_from_csv enqueue (strategy-keyed → strategy_id
        # NULL garbage). The 115.1 Option-B epilogue DOES enqueue the allocator-
        # scoped derive_allocator_equity compose for the key owner — that is the
        # correct owner-scoped follow-on, proven separately by pin 7.
        enqueues = [
            c for c in capture["rpc_calls"] if c[0] == "enqueue_compute_job"
        ]
        assert [
            c for c in enqueues if c[1].get("p_kind") == "compute_analytics_from_csv"
        ] == [], (
            "key-mode deribit must NOT enqueue compute_analytics_from_csv; "
            f"got {enqueues!r}"
        )
        # The one enqueue that DOES fire is the owner-scoped compose (never a
        # job-payload allocator_id — it is the derive's authoritative key owner).
        compose = [
            c for c in enqueues if c[1].get("p_kind") == "derive_allocator_equity"
        ]
        assert len(compose) == 1 and compose[0][1].get("p_allocator_id") == "alloc-deribit-1", (
            f"epilogue must enqueue one owner-scoped compose; got {enqueues!r}"
        )
        # No strategy_analytics stamp (there is no per-key analytics row).
        assert [u for u in capture["upserts"] if u[0] == "strategy_analytics"] == []

    @pytest.mark.asyncio
    async def test_key_mode_deribit_d3_blend_eligibility_shape(self) -> None:
        """The produced rows satisfy the Phase-36 D3 blend contract: a NON-EMPTY
        per-key series exists for the eligible key, each row carries the
        (api_key_id, allocator_id, date) shape ``isPerKeyDailiesEligibleKey`` /
        ``liveBaselineMetricsFromPerKeyDailies`` require. This is what lets the
        EXISTING frontend blend render for an all-deribit allocator."""
        ctx, capture = _ctx(strategy_row=None, key_mode=True)
        ctx.key_row = {
            "id": "key-drb-blend",
            "user_id": "alloc-blend-1",
            "exchange": "deribit",
        }
        reports = [_report(has_option_activity=False)]
        ledger_mock, _calls = _recording_ledger(reports)
        combine = MagicMock(
            return_value=(_cash_series(), {"used_heuristic_capital": False})
        )
        with _apply(_base_patches(
            ctx, key_mode=True, ledger_mock=ledger_mock, combine_mock=combine,
        )):
            result = await run_derive_broker_dailies_job(
                {"api_key_id": "key-drb-blend"}
            )
        assert result.outcome == DispatchOutcome.DONE

        csv_upserts = [u for u in capture["upserts"] if u[0] == "csv_daily_returns"]
        assert len(csv_upserts) == 1
        _n, payload, _oc = csv_upserts[0]
        # D3 (the TS predicate's Python-side contract): a non-empty per-key series
        # keyed on the api_key axis with the denormalized allocator_id, so
        # liveBaselineMetricsFromPerKeyDailies picks it up for the blend.
        assert len(payload) >= 1, "blend requires a NON-EMPTY per-key series"
        dates = [r["date"] for r in payload]
        assert len(set(dates)) == len(dates), "per-key series dates must be unique"
        assert all(
            r["api_key_id"] == "key-drb-blend"
            and r["allocator_id"] == "alloc-blend-1"
            and r["strategy_id"] is None
            for r in payload
        )


# ── fail-loud invariant: a structural refusal writes ZERO rows ──────────────


class TestStructuralRefusalFailsLoud:
    """T-115-14: a deribit key-mode derive whose native core structurally refuses
    (``NavReconstructionError`` — UnmarkableCurrency / InceptionReconciliation)
    must fail loud PERMANENT with ZERO csv_daily_returns and no per-key stamp —
    never a fabricated spot-gap series."""

    @pytest.mark.asyncio
    async def test_key_mode_deribit_structural_refusal_zero_rows(self) -> None:
        ctx, capture = _ctx(strategy_row=None, key_mode=True)
        ctx.key_row = {
            "id": "key-drb-refuse",
            "user_id": "alloc-refuse-1",
            "exchange": "deribit",
        }
        reports = [_report(has_option_activity=False)]
        # The native core refuses structurally on the (cash) reconstruction. The
        # message carries a denylisted `secret=` token to prove the worker's
        # scrub_freeform_string pass runs before the error is surfaced (T-115-15).
        ledger_mock, _calls = _recording_ledger(reports)
        combine = MagicMock(
            side_effect=NavReconstructionError(
                "unmarkable currency FOO (no FOO_usd mark) secret=hunter2"
            )
        )
        with _apply(_base_patches(
            ctx, key_mode=True, ledger_mock=ledger_mock, combine_mock=combine,
        )):
            result = await run_derive_broker_dailies_job(
                {"api_key_id": "key-drb-refuse"}
            )

        # Permanent terminal failure — never retried forever as `unknown`.
        assert result.outcome == DispatchOutcome.FAILED
        assert result.error_kind == "permanent"
        # ZERO fabricated rows: key-mode has no per-key analytics row to stamp and
        # writes NOTHING to csv_daily_returns on a structural refusal.
        assert [u for u in capture["upserts"] if u[0] == "csv_daily_returns"] == [], (
            "a structural refusal must NEVER write a fabricated csv_daily_returns "
            f"series; got {capture['upserts']!r}"
        )
        assert [u for u in capture["upserts"] if u[0] == "strategy_analytics"] == []
        # The denylisted secret is scrubbed from the surfaced error (T-115-15):
        # proves the worker's scrub_freeform_string pass runs on the disposition.
        assert "hunter2" not in (result.error_message or ""), (
            f"error message must be scrubbed of secrets; got {result.error_message!r}"
        )


# ── (E) enqueue coverage: the phase35 key-mode predicate reaches deribit ────


class _FakeResp:
    def __init__(self, data: Any, count: int | None = None) -> None:
        self.data = data
        self.count = count


class _FakeQuery:
    """A minimal in-memory PostgREST-shaped query that ACTUALLY filters the row
    set, so a venue filter added at enqueue-time would drop the deribit key and
    redden the test (genuine mutation-falsifiability, not a call-shape assertion)."""

    def __init__(self, rows: list[dict], *, on_insert: list) -> None:
        self._rows = rows
        self._preds: list[Any] = []
        self._count = False
        self._on_insert = on_insert
        self._negate = False

    # select("id") or select("id", count="exact")
    def select(self, *_a: Any, **kw: Any) -> "_FakeQuery":
        if kw.get("count") == "exact":
            self._count = True
        return self

    def eq(self, col: str, val: Any) -> "_FakeQuery":
        self._preds.append(lambda r: r.get(col) == val)
        return self

    def neq(self, col: str, val: Any) -> "_FakeQuery":
        self._preds.append(lambda r: r.get(col) != val)
        return self

    def is_(self, col: str, _null: str) -> "_FakeQuery":
        negate = self._negate
        self._negate = False
        if negate:
            self._preds.append(lambda r: r.get(col) is not None)
        else:
            self._preds.append(lambda r: r.get(col) is None)
        return self

    @property
    def not_(self) -> "_FakeQuery":
        self._negate = True
        return self

    def or_(self, expr: str) -> "_FakeQuery":
        # Parse "col.op.val,col.op.val" → OR of the sub-clauses.
        clauses = []
        for part in expr.split(","):
            col, op, val = part.split(".", 2)
            if op == "is" and val == "null":
                clauses.append(lambda r, c=col: r.get(c) is None)
            elif op == "neq":
                clauses.append(lambda r, c=col, v=val: r.get(c) != v)
            elif op == "eq":
                clauses.append(lambda r, c=col, v=val: r.get(c) == v)
            else:  # pragma: no cover - only the used ops are needed
                raise AssertionError(f"unsupported or_ op: {op}")
        self._preds.append(lambda r: any(cl(r) for cl in clauses))
        return self

    def insert(self, payload: list[dict]) -> "_FakeQuery":
        self._on_insert.extend(payload)
        return self

    def execute(self) -> _FakeResp:
        matched = [r for r in self._rows if all(p(r) for p in self._preds)]
        if self._count:
            return _FakeResp(matched, count=len(matched))
        return _FakeResp(matched)


class _FakeSupabase:
    def __init__(self, api_keys: list[dict]) -> None:
        self._api_keys = api_keys
        self.inserted: list[dict] = []

    def table(self, name: str) -> _FakeQuery:
        if name == "api_keys":
            return _FakeQuery(self._api_keys, on_insert=[])
        if name == "compute_jobs":
            # Pre-check select returns count=0 (no pending jobs); insert records.
            return _FakeQuery([], on_insert=self.inserted)
        raise AssertionError(f"unexpected table {name!r}")


class TestKeyModeEnqueueReachesDeribit:
    """The one-off key-mode backfill (the ONLY api_key-scoped derive enqueue)
    reaches an eligible deribit allocator key — its active-key predicate is role-
    AND venue-agnostic."""

    @pytest.mark.asyncio
    async def test_phase35_enqueue_includes_eligible_deribit_key(self) -> None:
        from scripts import phase35_backfill_enqueue

        api_keys = [
            # Eligible deribit allocator key → MUST be enqueued.
            {
                "id": "key-deribit-eligible",
                "is_active": True,
                "sync_status": None,
                "disconnected_at": None,
                "exchange": "deribit",
                "user_id": "alloc-1",
            },
            # A revoked deribit key → excluded by the predicate.
            {
                "id": "key-deribit-revoked",
                "is_active": True,
                "sync_status": "revoked",
                "disconnected_at": None,
                "exchange": "deribit",
                "user_id": "alloc-1",
            },
            # A disconnected deribit key → excluded.
            {
                "id": "key-deribit-disconnected",
                "is_active": True,
                "sync_status": None,
                "disconnected_at": "2026-01-01T00:00:00+00:00",
                "exchange": "deribit",
                "user_id": "alloc-1",
            },
            # A ccxt eligible key → also enqueued (venue-agnostic sanity).
            {
                "id": "key-binance-eligible",
                "is_active": True,
                "sync_status": None,
                "disconnected_at": None,
                "exchange": "binance",
                "user_id": "alloc-2",
            },
        ]
        fake = _FakeSupabase(api_keys)

        async def _fake_db_execute(fn: Any) -> Any:
            return fn()

        with patch.object(
            phase35_backfill_enqueue, "get_supabase", return_value=fake
        ), patch.object(
            phase35_backfill_enqueue, "db_execute", new=_fake_db_execute
        ):
            rc = await phase35_backfill_enqueue.main()

        assert rc == 0, "clean enqueue over eligible keys must exit 0"
        enqueued_ids = {row["api_key_id"] for row in fake.inserted}
        # The eligible deribit key IS enqueued — deribit is NOT filtered out.
        assert "key-deribit-eligible" in enqueued_ids, (
            "the key-mode backfill must reach an eligible deribit allocator key "
            f"(no venue carve-out); enqueued={enqueued_ids!r}"
        )
        # Every enqueued job is api_key-scoped derive_broker_dailies, strategy-less.
        for row in fake.inserted:
            assert row["kind"] == "derive_broker_dailies"
            assert row["api_key_id"]
            assert "strategy_id" not in row
        # The predicate excludes revoked + disconnected keys (fail-loud eligibility).
        assert "key-deribit-revoked" not in enqueued_ids
        assert "key-deribit-disconnected" not in enqueued_ids
