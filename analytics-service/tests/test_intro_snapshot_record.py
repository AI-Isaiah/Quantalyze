"""Phase 194.1 plan 11 (B12c): the intro snapshot freezes each Sharpe's record.

Two producers write ``contact_requests.portfolio_snapshot``: the TS ``computePortfolioSnapshot``
(src/lib/intro/snapshot.ts) and this service's ``run_compute_intro_snapshot_job``. Both freeze
an optional ``sharpe_record`` ``{span_days, observations, crypto, unreadable?}`` beside the book
Sharpe and beside each listed strategy's Sharpe, and the admin intros page judges a figure with
``gateAnnualized`` over it. ONE fixture, ``fixtures/intro_snapshot_record_parity.json``, holds the
alias string and every record case; ``src/lib/intro/snapshot.test.ts`` asserts the same file, so
the two producers cannot drift apart.

Neuter to redden (from a byte backup of services/metrics.py): drop the ``+ 1`` in the span (the
40-day case fails here AND in the vitest suite), or take ``series_start`` even when
``headline_since`` is later (the headline case fails in both).
"""

import json
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import patch

import pytest

from services import metrics
from services.job_worker import run_compute_intro_snapshot_job
from services.metrics import figure_record_from_scalars, record_clears

FIXTURE = json.loads(
    (Path(__file__).parent / "fixtures" / "intro_snapshot_record_parity.json").read_text()
)
CASES = FIXTURE["cases"]


class TestParityFixture:
    def test_alias_string_equals_the_ts_constant_in_the_fixture(self) -> None:
        assert metrics.RECORD_SCALAR_ALIASES == FIXTURE["aliases"]

    def test_fixture_covers_the_planned_cases(self) -> None:
        # Guards the fixture itself: a case dropped here would silently narrow BOTH suites.
        names = " | ".join(c["name"] for c in CASES)
        for needle in (
            "crypto 40 days",
            "crypto 400 days",
            "count 59",
            "headline_since later",
            "not a date",
            "series_end absent",
            "numeric-string",
            "earlier than series_start",
        ):
            assert needle in names

    @pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
    def test_every_case_freezes_the_expected_record(self, case: dict[str, Any]) -> None:
        i = case["input"]
        got = figure_record_from_scalars(
            i["series_start"],
            i["series_end"],
            i["headline_since"],
            i["record_observations"],
            i["crypto"],
        )
        assert got == case["expected"]

    def test_unreadable_key_exists_only_when_true(self) -> None:
        got = figure_record_from_scalars("2026-01-01", "2026-02-09", None, None, True)
        assert "unreadable" not in got

    def test_a_frozen_record_is_judged_by_record_clears(self) -> None:
        # The verdict is the shared one, never restated: a 40-day crypto record is below the bar.
        rec = figure_record_from_scalars("2026-01-01", "2026-02-09", None, None, True)
        assert record_clears(rec["span_days"], rec["observations"], rec["crypto"]) is False
        rec = figure_record_from_scalars("2026-01-01", "2027-02-04", None, None, True)
        assert record_clears(rec["span_days"], rec["observations"], rec["crypto"]) is True

    def test_calendar_overflow_day_freezes_unreadable_the_documented_divergence(self) -> None:
        # Date.parse rolls 2026-02-30 forward; date.fromisoformat rejects it. Python freezes it
        # unreadable (withheld), the failure direction; it is NOT in the shared fixture.
        got = figure_record_from_scalars("2026-01-01", "2026-02-30", None, None, True)
        assert got["unreadable"] is True
        assert got["span_days"] is None


class _Query:
    """A chainable PostgREST-shaped query that records its select string and update payload."""

    def __init__(self, store: "_Fake", table: str) -> None:
        self._store = store
        self._table = table
        self._update: dict[str, Any] | None = None

    def select(self, columns: str, **_: Any) -> "_Query":
        self._store.selects.setdefault(self._table, []).append(columns)
        return self

    def update(self, payload: dict[str, Any]) -> "_Query":
        self._update = payload
        return self

    def eq(self, *_: Any) -> "_Query":
        return self

    def in_(self, *_: Any) -> "_Query":
        return self

    def gte(self, *_: Any) -> "_Query":
        return self

    def order(self, *_: Any, **__: Any) -> "_Query":
        return self

    def limit(self, *_: Any) -> "_Query":
        return self

    def maybe_single(self) -> "_Query":
        self._store.single.add(self._table)
        return self

    def execute(self) -> Any:
        if self._update is not None:
            self._store.updates.append((self._table, self._update))
            return SimpleNamespace(data=[], count=None)
        data = self._store.data.get(self._table, [])
        if self._table in self._store.single and self._table == "contact_requests":
            return SimpleNamespace(data=data[0] if data else None, count=None)
        return SimpleNamespace(data=data, count=len(data))


class _Fake:
    def __init__(self, data: dict[str, list[dict[str, Any]]]) -> None:
        self.data = data
        self.selects: dict[str, list[str]] = {}
        self.updates: list[tuple[str, dict[str, Any]]] = []
        self.single: set[str] = set()

    def table(self, name: str) -> _Query:
        return _Query(self, name)


def _job() -> dict[str, Any]:
    return {
        "id": "job-1",
        "kind": "compute_intro_snapshot",
        "strategy_id": "strat-target",
        "metadata": {"contact_request_id": "cr-1"},
    }


def _written_snapshot(fake: _Fake) -> dict[str, Any]:
    (table, payload), = [u for u in fake.updates if u[0] == "contact_requests"]
    assert table == "contact_requests"
    assert payload["snapshot_status"] == "ready"
    snap: dict[str, Any] = payload["portfolio_snapshot"]
    return snap


ALIASES_40 = {
    "series_start": "2026-01-01",
    "series_end": "2026-02-09",
    "headline_since": None,
    "record_observations": 38,
}


async def _run(fake: _Fake) -> dict[str, Any]:
    with patch("services.job_worker.get_supabase", return_value=fake):
        result = await run_compute_intro_snapshot_job(_job())
    assert result.outcome.name == "DONE"
    return _written_snapshot(fake)


class TestHandlerFreezesTheRecord:
    async def test_strategy_refs_and_book_carry_their_record(self) -> None:
        fake = _Fake(
            {
                "contact_requests": [
                    {"id": "cr-1", "allocator_id": "alloc-1", "strategy_id": "strat-target"}
                ],
                "portfolios": [{"id": "pf-1"}],
                "portfolio_analytics": [
                    {
                        "portfolio_sharpe": 1.4,
                        "portfolio_max_drawdown": -0.18,
                        "curve_start": "2026-01-01T00:00:00",
                        "curve_end": "2026-07-19T00:00:00",
                    }
                ],
                "portfolio_strategies": [
                    {
                        "strategy_id": "s-a",
                        "current_weight": 0.5,
                        "allocated_amount": 100,
                        "strategies": {"id": "s-a", "name": "Alpha", "asset_class": "crypto"},
                    },
                    {
                        "strategy_id": "s-b",
                        "current_weight": 0.5,
                        "allocated_amount": 100,
                        "strategies": {"id": "s-b", "name": "Beta", "asset_class": "traditional"},
                    },
                ],
                "strategy_analytics": [
                    {"strategy_id": "s-a", "sharpe": 2.5, **ALIASES_40},
                    {"strategy_id": "s-b", "sharpe": 1.0, **ALIASES_40, "record_observations": 59},
                ],
                "portfolio_alerts": [],
            }
        )
        snap = await _run(fake)

        # 2026-01-01 .. 2026-07-19 covers 200 days (31+28+31+30+31+30 = 181, plus 19).
        assert snap["sharpe_record"] == {"span_days": 200, "observations": None, "crypto": True}
        by_name = {r["strategy_name"]: r for r in snap["top_3_strategies"]}
        assert by_name["Alpha"]["sharpe_record"] == {
            "span_days": 40,
            "observations": 38,
            "crypto": True,
        }
        assert by_name["Beta"]["sharpe_record"] == {
            "span_days": 40,
            "observations": 59,
            "crypto": False,
        }
        # Ranking and stored Sharpe are untouched.
        assert [r["strategy_name"] for r in snap["top_3_strategies"]] == ["Alpha", "Beta"]
        assert [r["sharpe"] for r in snap["top_3_strategies"]] == [2.5, 1.0]
        assert [r["strategy_name"] for r in snap["bottom_3_strategies"]] == ["Beta", "Alpha"]
        assert snap["sharpe"] == 1.4

    async def test_reads_the_alias_string_the_asset_class_and_the_curve_ends(self) -> None:
        fake = _Fake(
            {
                "contact_requests": [
                    {"id": "cr-1", "allocator_id": "alloc-1", "strategy_id": "strat-target"}
                ],
                "portfolios": [{"id": "pf-1"}],
                "portfolio_analytics": [],
                "portfolio_strategies": [
                    {
                        "strategy_id": "s-a",
                        "current_weight": 1.0,
                        "allocated_amount": 100,
                        "strategies": {"id": "s-a", "name": "Alpha", "asset_class": "crypto"},
                    }
                ],
                "strategy_analytics": [{"strategy_id": "s-a", "sharpe": 2.5, **ALIASES_40}],
                "portfolio_alerts": [],
            }
        )
        await _run(fake)

        assert metrics.RECORD_SCALAR_ALIASES in fake.selects["strategy_analytics"][0]
        assert "asset_class" in fake.selects["portfolio_strategies"][0]
        analytics_select = fake.selects["portfolio_analytics"][0]
        assert "curve_start:portfolio_equity_curve->0->>date" in analytics_select
        assert "curve_end:portfolio_equity_curve->-1->>date" in analytics_select

    async def test_book_with_no_curve_freezes_an_unknown_span_and_an_unknown_leg_makes_it_crypto(
        self,
    ) -> None:
        fake = _Fake(
            {
                "contact_requests": [
                    {"id": "cr-1", "allocator_id": "alloc-1", "strategy_id": "strat-target"}
                ],
                "portfolios": [{"id": "pf-1"}],
                "portfolio_analytics": [],
                "portfolio_strategies": [
                    {
                        "strategy_id": "s-a",
                        "current_weight": 0.5,
                        "allocated_amount": 100,
                        "strategies": {"id": "s-a", "name": "Alpha", "asset_class": "traditional"},
                    },
                    {
                        "strategy_id": "s-b",
                        "current_weight": 0.5,
                        "allocated_amount": 100,
                        "strategies": {"id": "s-b", "name": "Beta"},
                    },
                ],
                "strategy_analytics": [],
                "portfolio_alerts": [],
            }
        )
        snap = await _run(fake)
        assert snap["sharpe_record"] == {"span_days": None, "observations": None, "crypto": True}

    async def test_a_missing_asset_class_never_freezes_a_leg_as_crypto(self) -> None:
        # A strategy with no asset class is not crypto for ITS OWN record (TS: annualizationPeriods
        # reads only the literal 'crypto'); only the BOOK's blend rule treats unknown as crypto.
        fake = _Fake(
            {
                "contact_requests": [
                    {"id": "cr-1", "allocator_id": "alloc-1", "strategy_id": "strat-target"}
                ],
                "portfolios": [{"id": "pf-1"}],
                "portfolio_analytics": [],
                "portfolio_strategies": [
                    {
                        "strategy_id": "s-a",
                        "current_weight": 1.0,
                        "allocated_amount": 100,
                        "strategies": {"id": "s-a", "name": "Alpha"},
                    }
                ],
                "strategy_analytics": [{"strategy_id": "s-a", "sharpe": 2.5, **ALIASES_40}],
                "portfolio_alerts": [],
            }
        )
        snap = await _run(fake)
        assert snap["top_3_strategies"][0]["sharpe_record"]["crypto"] is False

    async def test_no_portfolio_freezes_a_null_book_record_and_empty_lists(self) -> None:
        fake = _Fake(
            {
                "contact_requests": [
                    {"id": "cr-1", "allocator_id": "alloc-1", "strategy_id": "strat-target"}
                ],
                "portfolios": [],
            }
        )
        snap = await _run(fake)
        assert snap["sharpe_record"] is None
        assert snap["top_3_strategies"] == []
        assert snap["bottom_3_strategies"] == []
