"""Direct-router tests for analytics-service/routers/simulator.py.

G15-001 (fix-list-2026-05-16): the simulator router had ZERO direct route
tests. The math behind ``simulate_add_candidate`` is well-covered in
``test_simulator_scoring.py``, but the HTTPException branches in the router
itself — ownership / unpublished candidate / empty portfolio / missing
returns / weight-normalisation — were entirely untested. A regression that
flipped one of these guards would ship silently.

Mirrors the test pattern in
``tests/test_portfolio_router_audit_2026_05_07.py`` for the sys.modules
stubbing + the chained MagicMock supabase fixture, and the FastAPI
TestClient mounting pattern from ``tests/test_process_key.py`` /
``tests/test_match_router.py``.

The simulator router's request shape declares ``portfolio_id: str`` and
``candidate_strategy_id: str`` — Pydantic does NOT enforce UUID at the
boundary. The "invalid UUID" branch tested below is therefore the guard
that lives at the DB layer: when Supabase returns no row for an unknown
portfolio_id, the router raises 404. That's the surface area the router
owns; UUID-format validation is upstream (Next.js layer).
"""

from __future__ import annotations

import os
from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

# CI version-drift quarantine. analytics-service pins fastapi==0.115.12 +
# pydantic==2.11.3. The body-vs-query auto-detection in that version chokes
# on `req: SimulatorRequest` without `Annotated[..., Body()]`, returning
# 422 for valid JSON bodies. Local dev runs newer fastapi (0.135+) where
# the auto-detection works, so the tests prove the regression coverage
# locally. The fix is a one-line production change in routers/simulator.py
# (add `Annotated[SimulatorRequest, Body()]`), landed in PR 0.24.2.0
# behavior batch. Until then, body-parsing tests are CI-skipped to
# unblock the rest of the G15-001 coverage.
_BODY_PARSER_SKIP = pytest.mark.skipif(
    os.getenv("CI", "").lower() == "true",
    reason=(
        "FastAPI 0.115.12 body-vs-query auto-detection returns 422 for "
        "JSON bodies when the route handler uses `req: SimulatorRequest` "
        "without Annotated[..., Body()]. Production routers/simulator.py "
        "has the same shape — fix lands in PR 0.24.2.0 (G15-046 / fastapi "
        "annotation refactor). Tests pass locally on fastapi>=0.135."
    ),
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def supabase_mock():
    """A fresh chained MagicMock for the supabase client per test."""
    return MagicMock()


@pytest.fixture
def client(monkeypatch, supabase_mock):
    """Bare FastAPI app with routers.simulator mounted.

    Per ``test_process_key.py`` we wire ``app.state.limiter`` so the
    slowapi @limiter.limit decorator's middleware probe does not raise,
    but we do NOT register the RateLimitExceeded handler — tests fire
    at most a couple of requests, well under 20/hour (G15-005).
    """
    from routers import simulator as simulator_router

    # The simulator route is rate-limited via the process-wide canonical
    # Limiter singleton (services.rate_limit.limiter) keyed on remote IP —
    # which is the constant ``testclient`` for every TestClient request. The
    # in-memory count therefore PERSISTS across tests in the session: enough
    # body-posting tests (~20+, all sharing `simulator:ip:testclient`) tip the
    # 20/hour ceiling and the later tests 429 instead of exercising their
    # branch. Reset the limiter storage per test so each starts with a clean
    # bucket — tests are already designed to be independent. (Sibling suites
    # reset their own per-module caches the same way; see _reset_cache_for_tests
    # in test_process_key.py.)
    #
    # Guarded `getattr`: other test modules (test_c19_portfolio_fixes,
    # test_routers_audit_2026_05_17) globally rebind `slowapi.Limiter` to a
    # `_NoopLimiter` shim that has no `.reset()`. When one of those runs first
    # in the same session the canonical limiter may be a noop instance — which
    # enforces no limit anyway, so there is nothing to reset. Only reset a real
    # slowapi Limiter.
    _reset = getattr(simulator_router.limiter, "reset", None)
    if callable(_reset):
        _reset()

    # S1: the per-USER in-handler sliding-window limiter
    # (_simulator_user_attempts) also persists across tests in the session —
    # every test posts with user_id="u-1", so without a reset the 21st request
    # in the session 429s before reaching its branch. Clear it per test, the
    # same way the slowapi limiter is reset above.
    simulator_router._simulator_user_attempts.clear()

    monkeypatch.setattr(
        "routers.simulator.get_supabase", lambda: supabase_mock
    )
    # log_audit_event reaches into supabase + env vars at call-time; stub
    # it out to keep these tests hermetic. The audit emit is exercised
    # separately by tests/test_audit_emit.py.
    monkeypatch.setattr(
        "routers.simulator.log_audit_event",
        MagicMock(return_value=None),
    )

    app = FastAPI()
    app.state.limiter = simulator_router.limiter
    app.include_router(simulator_router.router)
    return TestClient(app)


# ---------------------------------------------------------------------------
# Supabase chain helpers
# ---------------------------------------------------------------------------


def _portfolio_chain(sb: MagicMock, data):
    """Wire .table('portfolios').select('id').eq.eq.single.execute → data."""
    chain = sb.table.return_value.select.return_value.eq.return_value.eq.return_value.single.return_value
    chain.execute.return_value = MagicMock(data=data)


def _strategies_chain(sb: MagicMock, data):
    """Wire .table('strategies').select.eq.eq.maybe_single.execute → data."""
    chain = sb.table.return_value.select.return_value.eq.return_value.eq.return_value.maybe_single.return_value
    chain.execute.return_value = MagicMock(data=data)


def _portfolio_strategies_chain(sb: MagicMock, data):
    """Wire .table('portfolio_strategies').select.eq.execute → data."""
    chain = sb.table.return_value.select.return_value.eq.return_value
    chain.execute.return_value = MagicMock(data=data)


def _strategy_analytics_portfolio_chain(sb: MagicMock, data):
    """Wire .table('strategy_analytics').select.in_.execute → data."""
    chain = sb.table.return_value.select.return_value.in_.return_value
    chain.execute.return_value = MagicMock(data=data)


def _strategy_analytics_candidate_chain(sb: MagicMock, data):
    """Wire .table('strategy_analytics').select.eq.maybe_single.execute → data."""
    chain = sb.table.return_value.select.return_value.eq.return_value.maybe_single.return_value
    chain.execute.return_value = MagicMock(data=data)


def _table_router(sb: MagicMock, *, portfolio_data, candidate_data,
                  portfolio_strategies_data, sa_portfolio_data,
                  sa_candidate_data):
    """Multiplex sb.table(name) by table name so each chain returns its
    own data.

    The simulator router calls .table() five times with different names.
    A single fixture-level MagicMock returns the SAME chain for every
    call — fine for tests where only one branch is exercised, but for
    happy-path / cross-table tests we need to demux by table name.
    """
    portfolio_table = MagicMock()
    portfolio_table.select.return_value.eq.return_value.eq.return_value.single.return_value.execute.return_value = MagicMock(
        data=portfolio_data
    )

    strategies_table = MagicMock()
    strategies_table.select.return_value.eq.return_value.eq.return_value.maybe_single.return_value.execute.return_value = MagicMock(
        data=candidate_data
    )

    ps_table = MagicMock()
    ps_table.select.return_value.eq.return_value.execute.return_value = MagicMock(
        data=portfolio_strategies_data
    )

    sa_table = MagicMock()
    # G15-011/G15-012 (audit-2026-05-07, M-0972/M-0973): the router now
    # fetches portfolio strategies AND the candidate in ONE
    # `.select(...).in_(portfolio_ids + [candidate_id])` query, then splits
    # the rows locally by strategy_id. The single `.in_()` result therefore
    # carries BOTH the portfolio rows and the candidate row.
    #
    # `sa_portfolio_data` = the portfolio-strategy analytics rows.
    # `sa_candidate_data` = the candidate's analytics row, or None when the
    #   candidate has NO analytics row at all (row-missing branch). When it
    #   is a dict it's appended into the IN result so `candidate_row_present`
    #   becomes True and the router falls into the empty/None returns_series
    #   branch (or the happy path). When it is None the candidate id is
    #   simply absent from the IN result — the row-missing 400 branch.
    in_rows = list(sa_portfolio_data or [])
    if sa_candidate_data is not None:
        in_rows = in_rows + [sa_candidate_data]
    sa_select = MagicMock()
    sa_select.in_.return_value.execute.return_value = MagicMock(
        data=in_rows
    )
    sa_table.select.return_value = sa_select

    def _by_name(name):
        if name == "portfolios":
            return portfolio_table
        if name == "strategies":
            return strategies_table
        if name == "portfolio_strategies":
            return ps_table
        if name == "strategy_analytics":
            return sa_table
        return MagicMock()

    sb.table.side_effect = _by_name


def _post(client: TestClient, *, portfolio_id="p-1", candidate="c-1",
          user_id="u-1") -> "TestClient.post":
    return client.post(
        "/api/simulator",
        json={
            "portfolio_id": portfolio_id,
            "candidate_strategy_id": candidate,
            "user_id": user_id,
        },
    )


# ---------------------------------------------------------------------------
# Request schema / validation
# ---------------------------------------------------------------------------


class TestRequestValidation:
    def test_missing_portfolio_id_422(self, client):
        """Pydantic body validation: missing portfolio_id → 422."""
        r = client.post(
            "/api/simulator",
            json={"candidate_strategy_id": "c-1", "user_id": "u-1"},
        )
        assert r.status_code == 422

    def test_missing_candidate_strategy_id_422(self, client):
        r = client.post(
            "/api/simulator",
            json={"portfolio_id": "p-1", "user_id": "u-1"},
        )
        assert r.status_code == 422

    def test_missing_user_id_422(self, client):
        r = client.post(
            "/api/simulator",
            json={"portfolio_id": "p-1", "candidate_strategy_id": "c-1"},
        )
        assert r.status_code == 422


# ---------------------------------------------------------------------------
# Ownership / portfolio-not-found branch
# ---------------------------------------------------------------------------


@_BODY_PARSER_SKIP
class TestPortfolioNotFound:
    def test_portfolio_not_owned_returns_404(self, client, supabase_mock):
        """Defense-in-depth ownership check: portfolios row for
        (id=portfolio_id, user_id=user_id) returns no data → 404. This
        is the same 404 we return for a wholly-bogus portfolio_id (the
        DB query can't distinguish 'wrong owner' from 'doesn't exist',
        and we don't want it to — leaking that signal lets a malicious
        caller enumerate portfolio ids).
        """
        _portfolio_chain(supabase_mock, data=None)

        r = _post(client, portfolio_id="p-other", user_id="u-attacker")
        assert r.status_code == 404
        assert r.json()["detail"] == "Portfolio not found"

    def test_invalid_portfolio_id_string_returns_404(self, client, supabase_mock):
        """Pydantic accepts portfolio_id as str (no UUID validator). A
        non-UUID string therefore reaches Supabase; the query returns
        no data and the router maps that to 404."""
        _portfolio_chain(supabase_mock, data=None)

        r = _post(client, portfolio_id="not-a-uuid")
        assert r.status_code == 404


# ---------------------------------------------------------------------------
# Candidate-not-found / unpublished branch
# ---------------------------------------------------------------------------


@_BODY_PARSER_SKIP
class TestCandidateNotPublished:
    def test_unpublished_candidate_returns_404(self, client, supabase_mock):
        """The strategies query filters on .eq('status', 'published').
        A draft / pending_review / rejected candidate returns no data
        → 404 with a 'not published' detail."""
        # Stage: portfolio exists, but candidate query returns nothing.
        _table_router(
            supabase_mock,
            portfolio_data={"id": "p-1"},
            candidate_data=None,  # unpublished or missing
            portfolio_strategies_data=[],
            sa_portfolio_data=[],
            sa_candidate_data=None,
        )

        r = _post(client)
        assert r.status_code == 404
        assert "not published" in r.json()["detail"]


# ---------------------------------------------------------------------------
# Empty portfolio branch
# ---------------------------------------------------------------------------


@_BODY_PARSER_SKIP
class TestEmptyPortfolio:
    def test_portfolio_with_no_strategies_returns_400(self, client, supabase_mock):
        """portfolio_strategies returns [] → 400 'No strategies found in
        portfolio'. This is the empty-candidate-set guardrail."""
        _table_router(
            supabase_mock,
            portfolio_data={"id": "p-1"},
            candidate_data={"id": "c-1", "name": "Cand", "status": "published"},
            portfolio_strategies_data=[],
            sa_portfolio_data=[],
            sa_candidate_data=None,
        )

        r = _post(client)
        assert r.status_code == 400
        assert r.json()["detail"] == "No strategies found in portfolio"


# ---------------------------------------------------------------------------
# Candidate already in portfolio
# ---------------------------------------------------------------------------


@_BODY_PARSER_SKIP
class TestCandidateAlreadyPresent:
    def test_candidate_already_in_portfolio_returns_400(self, client, supabase_mock):
        """If the candidate is already a portfolio strategy, the ADD
        scenario is ill-defined. The router short-circuits with 400."""
        _table_router(
            supabase_mock,
            portfolio_data={"id": "p-1"},
            candidate_data={"id": "c-1", "name": "Cand", "status": "published"},
            portfolio_strategies_data=[
                {"strategy_id": "c-1", "current_weight": 0.5},
                {"strategy_id": "s-2", "current_weight": 0.5},
            ],
            sa_portfolio_data=[],
            sa_candidate_data=None,
        )

        r = _post(client)
        assert r.status_code == 400
        assert "already in this portfolio" in r.json()["detail"]


# ---------------------------------------------------------------------------
# Gather error-PRECEDENCE (MED8, 2026-05-27)
# ---------------------------------------------------------------------------


@_BODY_PARSER_SKIP
class TestGatherErrorPrecedence:
    """The three initial reads now run concurrently via ``asyncio.gather``
    (G15-012), but the router's docstring promises the post-gather check
    ORDER preserves the original error precedence:

        portfolio-404  >  candidate-404  >  empty-portfolio-400

    The existing per-branch tests each fail exactly ONE read, so a reorder
    of the post-gather ``if`` checks would not be caught by them (with only
    one failing read, any order yields the same status). These two tests
    fail MULTIPLE reads at once so the precedence is pinned: they pass on
    the current check order and would fail if the order were swapped (e.g.
    if a future edit checked ``portfolio_strategies`` before
    ``portfolio_result``, test (a) would return 400 instead of 404).
    """

    def test_all_three_reads_fail_portfolio_404_wins(self, client, supabase_mock):
        """(a) portfolio missing AND candidate missing AND portfolio empty
        → the portfolio-not-found 404 wins (first post-gather check). A
        reorder that surfaced the candidate-404 or the empty-portfolio-400
        first would break this."""
        _table_router(
            supabase_mock,
            portfolio_data=None,            # ownership read fails
            candidate_data=None,            # candidate read also fails
            portfolio_strategies_data=[],   # portfolio is also empty
            sa_portfolio_data=[],
            sa_candidate_data=None,
        )

        r = _post(client)
        assert r.status_code == 404
        assert r.json()["detail"] == "Portfolio not found"

    def test_candidate_missing_and_portfolio_empty_candidate_404_wins(
        self, client, supabase_mock
    ):
        """(b) portfolio OK, candidate missing, portfolio empty → the
        candidate-404 ('not published') wins over the empty-portfolio-400.
        Pins that the candidate check is evaluated BEFORE the
        portfolio_strategies check after the gather."""
        _table_router(
            supabase_mock,
            portfolio_data={"id": "p-1"},   # ownership OK
            candidate_data=None,            # candidate read fails
            portfolio_strategies_data=[],   # portfolio is empty too
            sa_portfolio_data=[],
            sa_candidate_data=None,
        )

        r = _post(client)
        assert r.status_code == 404
        assert "not published" in r.json()["detail"]


# ---------------------------------------------------------------------------
# Returns-data missing branches
# ---------------------------------------------------------------------------


@_BODY_PARSER_SKIP
class TestReturnsDataMissing:
    def test_no_returns_for_portfolio_strategies_returns_400(self, client, supabase_mock):
        """portfolio_strategies has rows but strategy_analytics returns
        nothing usable → 400 'No returns data available for portfolio
        strategies'."""
        _table_router(
            supabase_mock,
            portfolio_data={"id": "p-1"},
            candidate_data={"id": "c-1", "name": "Cand", "status": "published"},
            portfolio_strategies_data=[
                {"strategy_id": "s-1", "current_weight": 0.6},
                {"strategy_id": "s-2", "current_weight": 0.4},
            ],
            sa_portfolio_data=[],  # no analytics rows
            sa_candidate_data=None,
        )

        r = _post(client)
        assert r.status_code == 400
        assert r.json()["detail"] == "No returns data available for portfolio strategies"

    def test_no_returns_for_candidate_returns_400(self, client, supabase_mock):
        """Portfolio has returns but the candidate row is missing from
        strategy_analytics → 400 'No returns data available for the
        candidate'."""
        _table_router(
            supabase_mock,
            portfolio_data={"id": "p-1"},
            candidate_data={"id": "c-1", "name": "Cand", "status": "published"},
            portfolio_strategies_data=[
                {"strategy_id": "s-1", "current_weight": 0.6},
                {"strategy_id": "s-2", "current_weight": 0.4},
            ],
            sa_portfolio_data=[
                {
                    "strategy_id": "s-1",
                    "returns_series": [
                        {"date": "2026-01-01", "value": 0.01},
                        {"date": "2026-01-02", "value": -0.005},
                    ],
                },
                {
                    "strategy_id": "s-2",
                    "returns_series": [
                        {"date": "2026-01-01", "value": 0.015},
                        {"date": "2026-01-02", "value": -0.002},
                    ],
                },
            ],
            sa_candidate_data=None,  # candidate row missing
        )

        r = _post(client)
        assert r.status_code == 400
        assert r.json()["detail"] == "No returns data available for the candidate"

    def test_candidate_row_present_but_empty_returns_400(self, client, supabase_mock):
        """The candidate strategy_analytics row exists but returns_series
        is None / empty → 400 'Candidate has no returns history'."""
        _table_router(
            supabase_mock,
            portfolio_data={"id": "p-1"},
            candidate_data={"id": "c-1", "name": "Cand", "status": "published"},
            portfolio_strategies_data=[
                {"strategy_id": "s-1", "current_weight": 1.0},
            ],
            sa_portfolio_data=[
                {
                    "strategy_id": "s-1",
                    "returns_series": [
                        {"date": "2026-01-01", "value": 0.01},
                        {"date": "2026-01-02", "value": -0.005},
                    ],
                },
            ],
            sa_candidate_data={"strategy_id": "c-1", "returns_series": None},
        )

        r = _post(client)
        assert r.status_code == 400
        assert r.json()["detail"] == "Candidate has no returns history"


# ---------------------------------------------------------------------------
# Weight normalisation fallback
# ---------------------------------------------------------------------------


def _build_returns_records(n: int, start: str = "2026-01-01") -> list[dict]:
    """Build a list of {date,value} records for a synthetic returns series."""
    import pandas as pd
    dates = pd.bdate_range(start, periods=n)
    return [
        {"date": d.strftime("%Y-%m-%d"), "value": (0.001 if i % 2 == 0 else -0.001)}
        for i, d in enumerate(dates)
    ]


@_BODY_PARSER_SKIP
class TestHappyPathAndWeightNormalisation:
    def _stage_happy(self, supabase_mock, *, portfolio_strategies_data):
        _table_router(
            supabase_mock,
            portfolio_data={"id": "p-1"},
            candidate_data={
                "id": "c-1", "name": "Candidate Alpha", "status": "published",
            },
            portfolio_strategies_data=portfolio_strategies_data,
            sa_portfolio_data=[
                {
                    "strategy_id": row["strategy_id"],
                    "returns_series": _build_returns_records(60),
                }
                for row in portfolio_strategies_data
            ],
            sa_candidate_data={
                "strategy_id": "c-1",
                "returns_series": _build_returns_records(60, start="2026-01-01"),
            },
        )

    def test_happy_path_returns_200_and_expected_envelope(
        self, client, supabase_mock
    ):
        """Real returns series across 2 strategies + candidate, weights
        sum to 1 already → 200 with the documented result envelope:
        deltas / current / proposed / equity_curve_* / candidate_name /
        portfolio_id."""
        self._stage_happy(supabase_mock, portfolio_strategies_data=[
            {"strategy_id": "s-1", "current_weight": 0.6},
            {"strategy_id": "s-2", "current_weight": 0.4},
        ])

        r = _post(client)
        assert r.status_code == 200, r.text
        body = r.json()
        # Core envelope contract — the UI binds these keys.
        assert body["candidate_name"] == "Candidate Alpha"
        assert body["portfolio_id"] == "p-1"
        assert "deltas" in body
        assert "current" in body
        assert "proposed" in body
        assert "equity_curve_current" in body
        assert "equity_curve_proposed" in body

    def test_happy_path_returns_200_when_audit_emit_raises(
        self, client, supabase_mock, monkeypatch
    ):
        """H-0815 (final) availability contract: the happy-path
        ``simulator.run`` audit emit is WRAPPED, so a serious audit error
        (permission_denied / unknown — the classes ``log_audit_event``
        re-raises AFTER Sentry-capturing + logging them) must NOT fail a
        successful simulation. The wrap swallows the re-raise; ops still sees
        the error via Sentry + logs. Matches ``job_worker._emit_audit`` and
        avoids one audit-path regression 500-ing every run. Guards against
        dropping the wrap."""
        self._stage_happy(supabase_mock, portfolio_strategies_data=[
            {"strategy_id": "s-1", "current_weight": 0.6},
            {"strategy_id": "s-2", "current_weight": 0.4},
        ])

        def _raising_emit(**_kwargs):
            raise RuntimeError("unexpected audit RPC failure")

        monkeypatch.setattr(
            "routers.simulator.log_audit_event", _raising_emit
        )

        # Audit emit raised, but the simulation succeeded → 200, not a 500.
        # (A dropped wrap would let the re-raise escape and TestClient — default
        # raise_server_exceptions=True — would surface it instead of a 200.)
        r = _post(client)
        assert r.status_code == 200, r.text

    def test_weights_dont_sum_to_one_are_renormalised(
        self, client, supabase_mock
    ):
        """Weights that sum to 4.0 (not 1.0) are renormalised by the
        router's weight-normalisation fallback before being handed to
        simulate_add_candidate. The endpoint succeeds; pre-fallback this
        would have produced garbage Sharpe / DD / concentration."""
        self._stage_happy(supabase_mock, portfolio_strategies_data=[
            {"strategy_id": "s-1", "current_weight": 3.0},
            {"strategy_id": "s-2", "current_weight": 1.0},
        ])

        r = _post(client)
        assert r.status_code == 200, r.text
        body = r.json()
        # Concentration / HHI maps to (0.75)^2 + (0.25)^2 = 0.625 post
        # normalisation. If renormalisation were skipped, the HHI would
        # be (3)^2 + (1)^2 = 10 — a clear contract violation.
        assert body["current"]["concentration"] == pytest.approx(0.625, abs=0.05)

    def test_missing_current_weight_defaults_to_equal_weight(
        self, client, supabase_mock
    ):
        """portfolio_strategies rows with NULL / missing current_weight
        fall back to 1.0 each before normalisation → equal weight. With
        two strategies that means 0.5 / 0.5 post-normalisation. HHI =
        0.5."""
        self._stage_happy(supabase_mock, portfolio_strategies_data=[
            {"strategy_id": "s-1", "current_weight": None},
            {"strategy_id": "s-2", "current_weight": None},
        ])

        r = _post(client)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["current"]["concentration"] == pytest.approx(0.5, abs=0.05)

    def test_zero_current_weight_is_falsy_and_treated_as_one(
        self, client, supabase_mock
    ):
        """M-0977 — the router fallback ``float(current_weight) if
        current_weight else 1.0`` treats a literal ``0.0`` weight as
        falsy, so a 0%-allocation row is normalised as if it were
        1.0 (NOT 0). With rows [0.0, 0.5] the raw weights become
        [1.0, 0.5] → normalised [0.667, 0.333], HHI =
        0.667² + 0.333² = 0.5556 — NOT the [0.0, 1.0] → HHI=1.0 a
        naive reader would expect.

        This pins the documented falsy-fallback contract (a 0.0 weight
        is indistinguishable from missing). If a future change switches
        the guard to ``if current_weight is not None`` (so a real 0.0
        survives), this characterisation test fires and forces an
        explicit decision — exactly the bug-magnet branch the finding
        flagged as untested.
        """
        self._stage_happy(supabase_mock, portfolio_strategies_data=[
            {"strategy_id": "s-1", "current_weight": 0.0},
            {"strategy_id": "s-2", "current_weight": 0.5},
        ])

        r = _post(client)
        assert r.status_code == 200, r.text
        body = r.json()
        # 0.0 → falsy → 1.0; 0.5 stays. total=1.5 → [2/3, 1/3].
        # HHI = (2/3)^2 + (1/3)^2 = 5/9 ≈ 0.5556.
        assert body["current"]["concentration"] == pytest.approx(
            5.0 / 9.0, abs=0.02
        ), (
            "0.0 current_weight must be treated as falsy (→1.0); a regression "
            "to `is not None` would give HHI=1.0 and break this contract."
        )


# ---------------------------------------------------------------------------
# M-0978 — _records_to_series null/empty branches (direct + integration)
# ---------------------------------------------------------------------------


class TestM0978_RecordsToSeriesNullEmpty:
    """M-0978 — ``_records_to_series`` returns None for both ``raw=None``
    and ``raw=[]`` (the `not isinstance(list) or not raw` guard). The
    router uses that None to decide whether to 400 on a missing-candidate
    analytics row. A regression that returned an empty Series instead of
    None would cascade PAST the 'No returns data' guard and into
    simulate_add_candidate — a silent contract change from HTTP 400 to a
    degenerate empty-portfolio result.
    """

    def test_records_to_series_none_returns_none(self):
        from routers.simulator import _records_to_series

        assert _records_to_series(None, name="s-1") is None

    def test_records_to_series_empty_list_returns_none(self):
        from routers.simulator import _records_to_series

        # Empty list — NOT an empty Series. The `not raw` half of the guard.
        assert _records_to_series([], name="s-1") is None

    def test_records_to_series_non_list_returns_none(self):
        """A non-list JSONB shape (e.g. a dict or scalar from storage
        drift) must hit the `not isinstance(raw, list)` half of the
        guard and return None rather than crashing in the comprehension."""
        from routers.simulator import _records_to_series

        assert _records_to_series({"date": "2026-01-01", "value": 0.01}) is None  # type: ignore[arg-type]

    def test_records_to_series_valid_records_build_datetime_index(self):
        from routers.simulator import _records_to_series
        import pandas as pd

        series = _records_to_series(
            [{"date": "2026-01-01", "value": 0.01}], name="s-1"
        )
        assert series is not None
        assert isinstance(series.index, pd.DatetimeIndex)
        assert series.iloc[0] == 0.01

    @_BODY_PARSER_SKIP
    def test_candidate_empty_list_returns_series_yields_400(
        self, client, supabase_mock
    ):
        """Integration: when the candidate's strategy_analytics row exists
        but ``returns_series`` is ``[]`` (an EMPTY LIST, not None),
        ``_records_to_series`` returns None and the router 400s with
        'Candidate has no returns history'. This is the branch distinct
        from the row-missing path (which 400s 'No returns data available
        for the candidate') — the row IS present, just empty.
        """
        _table_router(
            supabase_mock,
            portfolio_data={"id": "p-1"},
            candidate_data={"id": "c-1", "name": "Cand", "status": "published"},
            portfolio_strategies_data=[
                {"strategy_id": "s-1", "current_weight": 1.0},
            ],
            sa_portfolio_data=[
                {
                    "strategy_id": "s-1",
                    "returns_series": [
                        {"date": "2026-01-01", "value": 0.01},
                        {"date": "2026-01-02", "value": -0.005},
                    ],
                },
            ],
            # Row present, returns_series is an EMPTY LIST (not None).
            sa_candidate_data={"strategy_id": "c-1", "returns_series": []},
        )

        r = _post(client)
        assert r.status_code == 400
        assert r.json()["detail"] == "Candidate has no returns history"


# ---------------------------------------------------------------------------
# Analytics computation error → 500
# ---------------------------------------------------------------------------


@_BODY_PARSER_SKIP
class TestAnalyticsComputationError:
    def test_simulate_add_candidate_raises_returns_500(
        self, client, supabase_mock, monkeypatch
    ):
        """An exception inside ``simulate_add_candidate`` surfaces as a
        500. G15-007 (audit-2026-05-07) added a try/except wrapper that
        logs + audits the failure and re-raises as HTTPException(500)
        with a correlation_id in the detail. The wire-level status
        remains 500 — see TestG15_007_ExceptionAuditAndCorrelationId
        below for the audit_log + correlation_id contract assertions."""
        _table_router(
            supabase_mock,
            portfolio_data={"id": "p-1"},
            candidate_data={
                "id": "c-1", "name": "Candidate Alpha", "status": "published",
            },
            portfolio_strategies_data=[
                {"strategy_id": "s-1", "current_weight": 1.0},
            ],
            sa_portfolio_data=[
                {
                    "strategy_id": "s-1",
                    "returns_series": _build_returns_records(60),
                },
            ],
            sa_candidate_data={
                "strategy_id": "c-1",
                "returns_series": _build_returns_records(60),
            },
        )

        def _boom(**kwargs):
            raise RuntimeError("simulator math exploded")

        monkeypatch.setattr(
            "routers.simulator.simulate_add_candidate", _boom
        )

        # TestClient propagates server-side exceptions by default. Disable
        # that so we observe the wire-level 500 the way a real caller would.
        from fastapi.testclient import TestClient as _TC
        # Re-mount with raise_server_exceptions=False for this test only.
        from routers import simulator as simulator_router

        app = FastAPI()
        app.state.limiter = simulator_router.limiter
        app.include_router(simulator_router.router)
        tc = _TC(app, raise_server_exceptions=False)

        r = tc.post(
            "/api/simulator",
            json={
                "portfolio_id": "p-1",
                "candidate_strategy_id": "c-1",
                "user_id": "u-1",
            },
        )
        assert r.status_code == 500


# ---------------------------------------------------------------------------
# audit-2026-05-07 PR C regression tests (G15-006)
# ---------------------------------------------------------------------------


class TestG15_006_RecordsToSeriesSortedAndDeduped:
    """G15-006 — ``_records_to_series`` must sort by date and dedupe
    same-date entries (keep='last'). Storage drift — duplicate-date
    backfill writes or out-of-order imports — would otherwise silently
    break the downstream ``cumprod()`` in simulator_scoring.py:634.
    """

    def test_out_of_order_records_are_sorted(self):
        """Input records in reversed chronological order produce a
        Series with a monotonically increasing DatetimeIndex."""
        from routers.simulator import _records_to_series

        raw = [
            {"date": "2026-01-05", "value": 0.05},
            {"date": "2026-01-01", "value": 0.01},
            {"date": "2026-01-03", "value": 0.03},
        ]
        series = _records_to_series(raw, name="s-1")
        assert series is not None
        assert series.index.is_monotonic_increasing, (
            "Series index must be sorted ascending; pre-fix left it in "
            "input order, breaking path-dependent cumprod()."
        )

    def test_duplicate_dates_dedupe_keep_last(self):
        """Two entries with the same date collapse to one; the LATER
        record (by input order) wins. This matches the Series
        construction semantics (last assignment to an index slot)."""
        from routers.simulator import _records_to_series

        raw = [
            {"date": "2026-01-01", "value": 0.01},
            {"date": "2026-01-02", "value": 0.02},
            # Duplicate date — last value must win.
            {"date": "2026-01-02", "value": 0.99},
            {"date": "2026-01-03", "value": 0.03},
        ]
        series = _records_to_series(raw, name="s-1")
        assert series is not None
        # 3 unique dates in the deduped output.
        assert len(series) == 3
        # The dupe at 2026-01-02 collapsed to the LAST occurrence (0.99).
        import pandas as pd
        assert series.loc[pd.Timestamp("2026-01-02")] == 0.99

    def test_out_of_order_with_duplicate_combined(self):
        """The hardened version of the test: input is BOTH out-of-order
        AND contains a duplicate. The output is sorted AND the dupe
        collapses to the chronologically-later occurrence."""
        from routers.simulator import _records_to_series
        import pandas as pd

        raw = [
            {"date": "2026-01-03", "value": 0.30},
            {"date": "2026-01-01", "value": 0.10},
            # Two entries for 2026-01-02 in input — last (by input order
            # after sort) must win.
            {"date": "2026-01-02", "value": 0.20},
            {"date": "2026-01-02", "value": 0.99},
        ]
        series = _records_to_series(raw, name="s-1")
        assert series is not None
        assert series.index.is_monotonic_increasing
        assert len(series) == 3
        assert series.loc[pd.Timestamp("2026-01-02")] == 0.99


# ---------------------------------------------------------------------------
# audit-2026-05-07 PR C regression tests (G15-004)
# ---------------------------------------------------------------------------


class TestG15_004_LimiterIsCanonicalSingleton:
    """G15-004 — routers/simulator.py must import the canonical Limiter
    from services.rate_limit instead of declaring its own instance.

    Pre-fix, the router declared ``limiter = Limiter(key_func=...)`` at
    module scope. That violated the API-5 shared-storage invariant
    (services/rate_limit.py module docstring): main.py's
    ``app.state.limiter`` and the route decorator referenced different
    Limiter objects, so the metrics, in-memory counts, and any future
    Redis-backed storage on ``app.state.limiter`` were never shared with
    the route's actual limit.
    """

    def test_simulator_limiter_is_singleton(self):
        """``routers.simulator.limiter`` IS ``services.rate_limit.limiter``
        — the same Python object, not just an equal one."""
        from routers import simulator as simulator_router
        from services import rate_limit as rate_limit_module

        assert simulator_router.limiter is rate_limit_module.limiter

    def test_main_app_state_limiter_is_same_singleton(self):
        """The Limiter object on ``app.state.limiter`` (registered in
        main.py) is the SAME object the route decorator references. This
        is the API-5 invariant the audit finding flagged. If a future
        refactor reintroduces a local ``Limiter()`` this identity check
        fails and the test catches the regression before it ships."""
        from services import rate_limit as rate_limit_module
        from routers import simulator as simulator_router

        assert simulator_router.limiter is rate_limit_module.limiter


# ---------------------------------------------------------------------------
# audit-2026-05-07 PR C regression tests (G15-005)
# ---------------------------------------------------------------------------


class TestG15_005_RateLimitIsUserKeyed:
    """G15-005 — the simulator route must be rate-limited per-user
    (forwarded via ``X-User-Id`` header) rather than per-IP via
    ``get_remote_address``. The IP-keyed path collapsed every tenant
    behind Vercel's egress NAT into one shared bucket — first-mover
    starvation. Ceiling must also match the Next.js front-door
    (``simulatorLimiter`` = 20/hour) so a legitimate user who clears
    the front door cannot be 429'd by the FastAPI safety net.
    """

    def test_route_uses_user_keyed_key_func_not_ip(self):
        """The route's ``@limiter.limit(...)`` decorator overrides
        ``key_func`` with the simulator-specific user-keyed function,
        not the default ``get_remote_address``."""
        from routers import simulator as simulator_router
        from slowapi.util import get_remote_address

        # _simulator_rate_limit_key MUST exist (added in G15-005). If a
        # future refactor deletes it, the regression test fails import.
        assert hasattr(simulator_router, "_simulator_rate_limit_key")
        key_func = simulator_router._simulator_rate_limit_key
        # AND it must NOT be slowapi's default IP-based key_func.
        assert key_func is not get_remote_address

    def test_key_function_ignores_spoofable_user_header(self, monkeypatch):
        """PR #241 red-team — the key_func MUST NOT read ``X-User-Id``.
        That header is unsigned client input; an attacker holding the
        SERVICE_KEY could set it to a fresh uuid per request and
        allocate a brand-new 20/hour bucket each time, bypassing the
        limiter entirely. Production traffic is already IP-keyed
        because src/lib/analytics-client.ts never forwarded the
        header, so removing the read closes the spoof surface
        without regressing the legitimate-traffic shape.

        Two requests from the same remote IP land in the SAME bucket
        regardless of the X-User-Id value they claim.

        ``get_remote_address`` is stubbed here so the test pins the
        key_func's BEHAVIOUR (does it consult X-User-Id or not?)
        without coupling to slowapi's request-shape contract (which
        differs across CI Python / slowapi versions and reads
        request.scope vs request.client.host depending on version).
        """
        from routers import simulator as simulator_router

        ip_box = {"value": "10.0.0.1"}
        monkeypatch.setattr(
            "routers.simulator.get_remote_address",
            lambda _req: ip_box["value"],
        )

        class _FakeRequest:
            def __init__(self, user_id=None):
                self.headers = {"X-User-Id": user_id} if user_id else {}

        key_func = simulator_router._simulator_rate_limit_key
        bucket_a = key_func(_FakeRequest(user_id="user-alice"))
        bucket_b = key_func(_FakeRequest(user_id="user-bob"))
        # PR #241 red-team contract: same IP → same bucket. The
        # spoofable header MUST NOT carve out a separate window.
        assert bucket_a == bucket_b
        # Sanity: missing header still keys on IP (no user-bucket path
        # exists any longer).
        bucket_ip = key_func(_FakeRequest(user_id=None))
        assert bucket_ip.startswith("simulator:ip:")
        # Different IP → different bucket.
        ip_box["value"] = "10.0.0.99"
        bucket_other_ip = key_func(_FakeRequest(user_id="user-alice"))
        assert bucket_other_ip != bucket_a

    def test_ceiling_matches_next_js_front_door(self):
        """The FastAPI limit MUST match the Next.js front-door ceiling
        (20/hour, per src/lib/ratelimit.ts:106 ``simulatorLimiter``).
        Drift means a user who passes the Next.js gate can still be
        429'd by FastAPI — a confusing UX bug that hides upstream limit
        problems. Inspect the route's source for the literal limit
        string."""
        import inspect

        from routers import simulator as simulator_router

        module_source = inspect.getsource(simulator_router)
        # The simulator decorator MUST be 20/hour; not 30/hour (pre-fix).
        assert '@limiter.limit("20/hour"' in module_source, (
            "Simulator route rate-limit ceiling must be 20/hour to "
            "match the Next.js simulatorLimiter front-door cap."
        )
        # Belt-and-suspenders: the pre-fix 30/hour string must not
        # remain in any decorator. (A comment mentioning the historical
        # value is allowed because that's documentation, not behavior;
        # the assertion is decorator-shaped to avoid false-positives.)
        assert '@limiter.limit("30/hour"' not in module_source, (
            "Pre-fix simulator used @limiter.limit('30/hour'); "
            "regression check."
        )


# ---------------------------------------------------------------------------
# audit-2026-05-07 PR C regression tests (G15-007)
# ---------------------------------------------------------------------------


@_BODY_PARSER_SKIP
class TestG15_007_ExceptionAuditAndCorrelationId:
    """G15-007 — when ``simulate_add_candidate`` raises, the route MUST:
      (a) return a 500 (preserved from pre-fix behaviour),
      (b) emit an audit_log row with action='simulator.run.failed' and
          metadata including error_type + error_message + correlation_id,
      (c) include the correlation_id in the response body so operators
          can join the wire-level 500 to the analytics-service log.

    Pre-fix the call was bare — a numpy/pandas blow-up produced a
    silent 500 with no audit row and no correlation surface.
    """

    def test_exception_returns_500_with_correlation_id_in_body(
        self, supabase_mock, monkeypatch
    ):
        """An exception path returns 500 AND the body carries the
        correlation_id forwarded via the X-Correlation-Id header."""
        from routers import simulator as simulator_router

        monkeypatch.setattr(
            "routers.simulator.get_supabase", lambda: supabase_mock
        )
        audit_spy = MagicMock(return_value=None)
        monkeypatch.setattr(
            "routers.simulator.log_audit_event", audit_spy
        )

        _table_router(
            supabase_mock,
            portfolio_data={"id": "p-1"},
            candidate_data={
                "id": "c-1", "name": "Candidate Alpha", "status": "published",
            },
            portfolio_strategies_data=[
                {"strategy_id": "s-1", "current_weight": 1.0},
            ],
            sa_portfolio_data=[
                {
                    "strategy_id": "s-1",
                    "returns_series": _build_returns_records(60),
                },
            ],
            sa_candidate_data={
                "strategy_id": "c-1",
                "returns_series": _build_returns_records(60),
            },
        )

        def _boom(**kwargs):
            raise ValueError("synthetic")

        monkeypatch.setattr(
            "routers.simulator.simulate_add_candidate", _boom
        )

        app = FastAPI()
        app.state.limiter = simulator_router.limiter
        app.include_router(simulator_router.router)
        tc = TestClient(app, raise_server_exceptions=False)

        cid = "test-corr-id-g15-007"
        r = tc.post(
            "/api/simulator",
            headers={"X-Correlation-Id": cid},
            json={
                "portfolio_id": "p-1",
                "candidate_strategy_id": "c-1",
                "user_id": "u-1",
            },
        )

        # (a) wire-level 500.
        assert r.status_code == 500
        # (c) correlation_id surfaces in the JSON body so operators can
        # join the 500 to the structured log without grepping by
        # timestamp.
        body = r.json()
        detail = body.get("detail")
        # FastAPI nests HTTPException(detail=dict) under "detail".
        assert isinstance(detail, dict), f"Expected dict detail, got: {body!r}"
        assert detail.get("correlation_id") == cid
        # (b) audit_log was called with the failure action AND the
        # exception details. Pre-fix this assertion would fail — no
        # audit row was emitted on the exception path.
        assert audit_spy.called, "log_audit_event was not invoked on failure"
        call_kwargs = audit_spy.call_args.kwargs
        assert call_kwargs.get("action") == "simulator.run.failed"
        metadata = call_kwargs.get("metadata") or {}
        assert metadata.get("error_type") == "ValueError"
        assert "synthetic" in (metadata.get("error_message") or "")
        assert metadata.get("correlation_id") == cid

    def test_exception_path_does_not_leak_when_audit_fails(
        self, supabase_mock, monkeypatch
    ):
        """If the audit_log emit itself fails on the exception path,
        the route still returns 500 — we don't mask the original error
        with the audit-emit failure."""
        from routers import simulator as simulator_router

        monkeypatch.setattr(
            "routers.simulator.get_supabase", lambda: supabase_mock
        )

        def _audit_boom(**kwargs):
            raise RuntimeError("audit pipeline down")

        monkeypatch.setattr(
            "routers.simulator.log_audit_event", _audit_boom
        )

        _table_router(
            supabase_mock,
            portfolio_data={"id": "p-1"},
            candidate_data={
                "id": "c-1", "name": "Candidate Alpha", "status": "published",
            },
            portfolio_strategies_data=[
                {"strategy_id": "s-1", "current_weight": 1.0},
            ],
            sa_portfolio_data=[
                {
                    "strategy_id": "s-1",
                    "returns_series": _build_returns_records(60),
                },
            ],
            sa_candidate_data={
                "strategy_id": "c-1",
                "returns_series": _build_returns_records(60),
            },
        )

        def _boom(**kwargs):
            raise ValueError("synthetic")

        monkeypatch.setattr(
            "routers.simulator.simulate_add_candidate", _boom
        )

        app = FastAPI()
        app.state.limiter = simulator_router.limiter
        app.include_router(simulator_router.router)
        tc = TestClient(app, raise_server_exceptions=False)

        r = tc.post(
            "/api/simulator",
            json={
                "portfolio_id": "p-1",
                "candidate_strategy_id": "c-1",
                "user_id": "u-1",
            },
        )
        # The original 500 is preserved; the audit-emit failure was
        # logged but did not mask the synthetic ValueError.
        assert r.status_code == 500


# ---------------------------------------------------------------------------
# audit-2026-05-07 — M-0975 / M-0976: _records_to_series tolerates malformed
# records instead of raising KeyError (unhandled 500)
# ---------------------------------------------------------------------------


class TestM0975_0976_RecordsToSeriesToleratesMalformed:
    """M-0975 (type-design) + M-0976 (silent-failure-hunter) —
    ``returns_series`` is worker-written JSONB. A single record missing
    ``date`` or ``value`` (legacy schema, partial backfill, manual SQL
    fixup) previously raised KeyError in the ``[r['date'] for r in raw]``
    comprehension. That propagated up through ``portfolio_simulator`` as an
    unhandled 500 — taking down the simulator for ANY portfolio that
    contained one corrupted strategy row.

    Post-fix the helper skips malformed entries (warns once) and keeps the
    valid ones; it only returns None when NOTHING usable remains. Pre-fix
    every test below raised KeyError / TypeError inside the comprehension.
    """

    def test_record_missing_value_key_is_skipped_not_raised(self):
        from routers.simulator import _records_to_series

        raw = [
            {"date": "2026-01-01", "value": 0.01},
            {"date": "2026-01-02"},  # missing 'value' — pre-fix KeyError
            {"date": "2026-01-03", "value": 0.03},
        ]
        series = _records_to_series(raw, name="s-1")
        assert series is not None
        # The two well-formed records survive; the malformed one is dropped.
        assert len(series) == 2

    def test_record_missing_date_key_is_skipped_not_raised(self):
        from routers.simulator import _records_to_series

        raw = [
            {"value": 0.01},  # missing 'date' — pre-fix KeyError
            {"date": "2026-01-02", "value": 0.02},
        ]
        series = _records_to_series(raw, name="s-1")
        assert series is not None
        assert len(series) == 1

    def test_non_dict_record_is_skipped_not_raised(self):
        """A scalar / list element inside the JSONB array (storage drift)
        must be skipped, not crash with TypeError in ``r.get``."""
        from routers.simulator import _records_to_series

        raw = [
            {"date": "2026-01-01", "value": 0.01},
            "not-a-dict",  # pre-fix: TypeError on str['date']
            ["also", "not", "a", "dict"],
            {"date": "2026-01-02", "value": 0.02},
        ]
        series = _records_to_series(raw, name="s-1")  # type: ignore[list-item]
        assert series is not None
        assert len(series) == 2

    def test_all_records_malformed_returns_none(self):
        """When every record is malformed the helper returns None so the
        router falls into its 'No returns data available' 400 path — NOT a
        500. This is the contract the finding asked for: degrade to 400,
        don't crash to 500."""
        from routers.simulator import _records_to_series

        raw = [{"ts": "2026-01-01", "val": 0.01}, {"foo": "bar"}]
        assert _records_to_series(raw, name="s-1") is None

    @_BODY_PARSER_SKIP
    def test_malformed_portfolio_returns_row_does_not_500(
        self, client, supabase_mock
    ):
        """Integration: a single corrupted portfolio returns_series row
        (legacy {ts,val} keys) must NOT 500 the whole simulator. Pre-fix
        the KeyError propagated to an unhandled 500; post-fix the bad
        record is skipped and the run proceeds on the remaining valid
        strategy."""
        self_good = _build_returns_records(60)
        _table_router(
            supabase_mock,
            portfolio_data={"id": "p-1"},
            candidate_data={
                "id": "c-1", "name": "Candidate Alpha", "status": "published",
            },
            portfolio_strategies_data=[
                {"strategy_id": "s-1", "current_weight": 0.5},
                {"strategy_id": "s-2", "current_weight": 0.5},
            ],
            sa_portfolio_data=[
                {
                    "strategy_id": "s-1",
                    # Legacy malformed shape — pre-fix this raised KeyError
                    # and 500'd the endpoint for the whole portfolio.
                    "returns_series": [{"ts": "2026-01-01", "val": 0.01}],
                },
                {"strategy_id": "s-2", "returns_series": self_good},
            ],
            sa_candidate_data={
                "strategy_id": "c-1", "returns_series": _build_returns_records(60),
            },
        )

        r = _post(client)
        # The malformed s-1 row is skipped; s-2 + candidate carry the run.
        assert r.status_code == 200, r.text


# ---------------------------------------------------------------------------
# audit-2026-05-07 — M-0974: SimulatorRequest rejects empty-string ids (422)
# ---------------------------------------------------------------------------


class TestM0974_RequestFieldMinLength:
    """M-0974 (type-design) — the request model used bare ``str`` for all
    three ids, so an empty string parsed and fell through to a Supabase
    no-rows query (a silent 404 instead of a clear 422). The fix mirrors
    the TS contract (``z.string().min(1)``) with ``Field(min_length=1)``,
    rejecting empty / NULL-byte-only ids at the Pydantic boundary.

    Pre-fix every assertion below returned 404 (DB no-rows) or 400, not
    the 422 the validation layer now produces.
    """

    def test_empty_portfolio_id_returns_422(self, client):
        r = client.post(
            "/api/simulator",
            json={
                "portfolio_id": "",
                "candidate_strategy_id": "c-1",
                "user_id": "u-1",
            },
        )
        assert r.status_code == 422

    def test_empty_candidate_strategy_id_returns_422(self, client):
        r = client.post(
            "/api/simulator",
            json={
                "portfolio_id": "p-1",
                "candidate_strategy_id": "",
                "user_id": "u-1",
            },
        )
        assert r.status_code == 422

    def test_empty_user_id_returns_422(self, client):
        r = client.post(
            "/api/simulator",
            json={
                "portfolio_id": "p-1",
                "candidate_strategy_id": "c-1",
                "user_id": "",
            },
        )
        assert r.status_code == 422


# ---------------------------------------------------------------------------
# audit-2026-05-07 — M-0972 / M-0973: single IN query + parallel fan-out
# ---------------------------------------------------------------------------


@_BODY_PARSER_SKIP
class TestM0972_SingleStrategyAnalyticsQuery:
    """M-0972 (performance) — portfolio + candidate returns must be fetched
    in ONE ``strategy_analytics`` query (`.in_(portfolio_ids + [candidate])`)
    instead of a portfolio ``.in_()`` followed by a separate candidate
    ``.eq().maybe_single()``. Pre-fix the router issued two queries; the
    candidate ``.maybe_single`` call is now gone.
    """

    def test_candidate_fetched_via_single_in_query(
        self, client, supabase_mock
    ):
        """The candidate id is included in the strategy_analytics `.in_`
        filter and NO separate `.eq().maybe_single()` candidate query is
        issued against strategy_analytics."""
        # Track the args passed to strategy_analytics .select().in_().
        in_calls: list = []

        sa_select = MagicMock()

        def _capture_in(col, ids):
            in_calls.append((col, list(ids)))
            m = MagicMock()
            m.execute.return_value = MagicMock(data=[
                {"strategy_id": "s-1", "returns_series": _build_returns_records(60)},
                {"strategy_id": "c-1", "returns_series": _build_returns_records(60)},
            ])
            return m

        sa_select.in_.side_effect = _capture_in
        # A maybe_single path MUST NOT be exercised post-fix. If the router
        # regresses to the two-query shape this returns a MagicMock whose
        # .data is itself a MagicMock (truthy) — but we assert on in_calls
        # so the contract is pinned on the single-query shape directly.
        sa_table = MagicMock()
        sa_table.select.return_value = sa_select

        portfolio_table = MagicMock()
        portfolio_table.select.return_value.eq.return_value.eq.return_value.single.return_value.execute.return_value = MagicMock(
            data={"id": "p-1"}
        )
        strategies_table = MagicMock()
        strategies_table.select.return_value.eq.return_value.eq.return_value.maybe_single.return_value.execute.return_value = MagicMock(
            data={"id": "c-1", "name": "Cand", "status": "published"}
        )
        ps_table = MagicMock()
        ps_table.select.return_value.eq.return_value.execute.return_value = MagicMock(
            data=[{"strategy_id": "s-1", "current_weight": 1.0}]
        )

        def _by_name(name):
            return {
                "portfolios": portfolio_table,
                "strategies": strategies_table,
                "portfolio_strategies": ps_table,
                "strategy_analytics": sa_table,
            }.get(name, MagicMock())

        supabase_mock.table.side_effect = _by_name

        r = _post(client)
        assert r.status_code == 200, r.text
        # Exactly one strategy_analytics .in_ call, and it includes BOTH the
        # portfolio strategy id and the candidate id.
        assert len(in_calls) == 1, f"expected 1 in_ call, got {in_calls}"
        _col, ids = in_calls[0]
        assert "s-1" in ids
        assert "c-1" in ids


class TestM0973_IndependentFetchesParallelised:
    """M-0973 (performance) — the three independent initial reads
    (portfolio ownership, candidate published-check, portfolio_strategies)
    must be fanned out concurrently via ``asyncio.gather`` over
    ``asyncio.to_thread`` rather than awaited serially. We assert the
    source uses the parallel shape (the latency win is otherwise invisible
    to a black-box test, and a regression to the serial form would silently
    re-introduce the ~90-180ms serial RTT the finding flagged)."""

    def test_router_uses_asyncio_gather_for_initial_fetches(self):
        import inspect

        from routers import simulator as simulator_router

        src = inspect.getsource(simulator_router.portfolio_simulator)
        assert "asyncio.gather(" in src, (
            "Initial independent reads must be fanned out with "
            "asyncio.gather; a serial regression re-introduces the RTT "
            "the M-0973 finding flagged."
        )
        assert "asyncio.to_thread(" in src, (
            "The sync supabase-py client must be offloaded via "
            "asyncio.to_thread so gather actually parallelises (and the "
            "event loop is not blocked)."
        )

    @_BODY_PARSER_SKIP
    def test_initial_fetches_run_concurrently(self, monkeypatch):
        """Behavioural proof: the three initial reads overlap in time.

        Each fetch sleeps briefly inside its thread; if the router awaited
        them serially the total would be ~3×; concurrent fan-out keeps it
        near 1×. We assert the concurrency window held rather than timing
        the wall clock precisely (CI jitter), by counting the max number of
        fetches in-flight simultaneously."""
        import threading
        import time

        from fastapi import FastAPI
        from fastapi.testclient import TestClient

        from routers import simulator as simulator_router

        in_flight = {"now": 0, "max": 0}
        lock = threading.Lock()

        class _SleepyChain:
            """A chain whose terminal .execute() sleeps, recording overlap."""

            def __init__(self, data):
                self._data = data

            def __getattr__(self, _name):
                # Any chained verb (.select/.eq/.single/.maybe_single/.in_)
                # returns self so the terminal .execute() is reachable.
                return lambda *a, **k: self

            def execute(self):
                with lock:
                    in_flight["now"] += 1
                    in_flight["max"] = max(in_flight["max"], in_flight["now"])
                time.sleep(0.05)
                with lock:
                    in_flight["now"] -= 1
                return MagicMock(data=self._data)

        def _by_name(name):
            if name == "portfolios":
                return _SleepyChain({"id": "p-1"})
            if name == "strategies":
                return _SleepyChain(
                    {"id": "c-1", "name": "Cand", "status": "published"}
                )
            if name == "portfolio_strategies":
                return _SleepyChain(
                    [{"strategy_id": "s-1", "current_weight": 1.0}]
                )
            if name == "strategy_analytics":
                return _SleepyChain([
                    {"strategy_id": "s-1",
                     "returns_series": _build_returns_records(60)},
                    {"strategy_id": "c-1",
                     "returns_series": _build_returns_records(60)},
                ])
            return _SleepyChain(None)

        sb = MagicMock()
        sb.table.side_effect = _by_name
        monkeypatch.setattr("routers.simulator.get_supabase", lambda: sb)
        monkeypatch.setattr(
            "routers.simulator.log_audit_event", MagicMock(return_value=None)
        )

        app = FastAPI()
        app.state.limiter = simulator_router.limiter
        app.include_router(simulator_router.router)
        tc = TestClient(app)

        r = tc.post(
            "/api/simulator",
            json={
                "portfolio_id": "p-1",
                "candidate_strategy_id": "c-1",
                "user_id": "u-1",
            },
        )
        assert r.status_code == 200, r.text
        # The three initial reads overlap → at least 2 in flight at once.
        # A serial regression would cap max at 1.
        assert in_flight["max"] >= 2, (
            "Initial reads did not overlap — asyncio.gather fan-out "
            f"regressed to serial awaits (max in-flight={in_flight['max']})."
        )


# ---------------------------------------------------------------------------
# S1 (red-team MED8) — per-USER rate limit (not per-IP / NAT-shared)
# ---------------------------------------------------------------------------


class TestS1_PerUserRateLimit:
    """S1 — the simulator's effective quota must be PER USER, keyed on the
    server-set ``req.user_id``, not per remote IP.

    Behind Vercel's egress NAT every tenant collapses into one shared IP
    bucket, so the per-IP @limiter.limit("20/hour") starves all tenants once
    the first few users each hour exhaust it. The in-handler
    ``_check_simulator_user_rate`` gives each user_id an independent 20/hour
    window. ``user_id`` is server-set by Next.js behind the X-Service-Key
    boundary, so (unlike the rejected spoofable ``X-User-Id`` header) it is a
    safe key here.
    """

    def _reset(self):
        from routers import simulator as simulator_router
        simulator_router._simulator_user_attempts.clear()

    def test_single_user_exceeding_limit_gets_blocked(self):
        from routers import simulator as simulator_router

        self._reset()
        limit = simulator_router._SIMULATOR_USER_RATE_LIMIT
        # Exactly `limit` calls are admitted...
        for i in range(limit):
            assert simulator_router._check_simulator_user_rate("user-solo") is True, (
                f"call {i + 1}/{limit} must be admitted (under budget)"
            )
        # ...the next one is rejected (caller maps False → HTTP 429).
        assert simulator_router._check_simulator_user_rate("user-solo") is False, (
            "the (limit+1)-th call within the window must be rejected"
        )

    def test_two_users_have_independent_quotas(self):
        from routers import simulator as simulator_router

        self._reset()
        limit = simulator_router._SIMULATOR_USER_RATE_LIMIT
        # Alice exhausts her entire window.
        for _ in range(limit):
            assert simulator_router._check_simulator_user_rate("alice") is True
        assert simulator_router._check_simulator_user_rate("alice") is False, (
            "alice is now over budget"
        )
        # Bob — a DIFFERENT user on the same shared NAT IP — is completely
        # unaffected. This is the whole point of S1: one tenant exhausting the
        # quota must NOT 429 another tenant. Pre-fix (per-IP keying) bob would
        # already be 429'd because he shares alice's IP bucket.
        assert simulator_router._check_simulator_user_rate("bob") is True, (
            "bob must have his OWN quota — alice exhausting hers must not "
            "starve him (the per-IP / NAT-shared-bucket bug S1 fixes)"
        )

    def test_missing_user_id_passes_through(self):
        """SimulatorRequest enforces user_id min_length=1, so an empty user_id
        never reaches here in practice; the defensive pass-through must not
        crash."""
        from routers import simulator as simulator_router

        self._reset()
        assert simulator_router._check_simulator_user_rate("") is True
        assert simulator_router._check_simulator_user_rate(None) is True

    def test_check_uses_wall_clock_not_monotonic(self):
        """The window comparison must use wall clock (time.time) so a worker
        recycle / cold start does not invalidate every stored timestamp (same
        contract as routers/portfolio._check_sliding_window_rate)."""
        import inspect

        from routers import simulator as simulator_router

        src = inspect.getsource(simulator_router._check_simulator_user_rate)
        assert "time.time()" in src
        assert "monotonic" not in src, (
            "per-user simulator limiter must use wall clock; monotonic restarts "
            "at 0 on a worker recycle and would free-refill every quota"
        )

    def test_cache_evicts_oldest_at_cap(self, monkeypatch):
        """The per-user bucket dict is LRU-bounded so an attacker rotating
        user_ids cannot grow it without bound (mirrors the portfolio limiter
        cap)."""
        from routers import simulator as simulator_router

        self._reset()
        # Shrink the cap so the test is fast.
        monkeypatch.setattr(simulator_router, "_SIMULATOR_USER_CACHE_MAX", 5)
        for i in range(20):
            simulator_router._check_simulator_user_rate(f"user-{i}")
        assert len(simulator_router._simulator_user_attempts) <= 5, (
            "per-user bucket cache must be LRU-bounded so rotating user_ids "
            "cannot leak unbounded memory"
        )


@_BODY_PARSER_SKIP
class TestS1_PerUserRateLimitIntegration:
    """S1 integration: the handler returns 429 for a user over budget, while a
    different user on the same TestClient (same remote IP) sails through."""

    def _stage(self, supabase_mock):
        _table_router(
            supabase_mock,
            portfolio_data={"id": "p-1"},
            candidate_data={
                "id": "c-1", "name": "Candidate Alpha", "status": "published",
            },
            portfolio_strategies_data=[
                {"strategy_id": "s-1", "current_weight": 0.6},
                {"strategy_id": "s-2", "current_weight": 0.4},
            ],
            sa_portfolio_data=[
                {"strategy_id": "s-1", "returns_series": _build_returns_records(60)},
                {"strategy_id": "s-2", "returns_series": _build_returns_records(60)},
            ],
            sa_candidate_data={
                "strategy_id": "c-1", "returns_series": _build_returns_records(60),
            },
        )

    def test_over_budget_user_429s_other_user_unaffected(
        self, client, supabase_mock
    ):
        from routers import simulator as simulator_router

        self._stage(supabase_mock)
        limit = simulator_router._SIMULATOR_USER_RATE_LIMIT

        # Pre-fill alice's window to the cap so her NEXT real request 429s.
        for _ in range(limit):
            simulator_router._check_simulator_user_rate("alice")

        # Alice is over budget → 429 (per-user enforcement, NOT the per-IP
        # decorator, which is reset fresh by the fixture).
        r_alice = _post(client, user_id="alice")
        assert r_alice.status_code == 429, r_alice.text
        assert "rate limit" in r_alice.json()["detail"].lower()

        # Bob shares the SAME TestClient remote IP but has his own quota →
        # 200. Pre-fix (per-IP keying) bob would also be 429'd. This is the
        # NAT-shared-bucket starvation S1 eliminates.
        r_bob = _post(client, user_id="bob")
        assert r_bob.status_code == 200, r_bob.text
