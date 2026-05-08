"""Audit-2026-05-07 #38 — _load_candidate_universe warning regression tests.

Pre-fix the bare `except (ValueError, AttributeError): pass` in the
`start_date` parsing block silently produced track_record_days=0 for
the affected strategy, which biased match scoring AGAINST the strategy
because younger track records score lower in the candidate universe.
The fix logs the bad value at WARN with the strategy id so an operator
can find the source row instead of debugging a quiet ranking drift.

Test approach:
  Patch `routers.match.get_supabase` with a MagicMock that returns one
  strategy with a malformed `start_date`. Call `_load_candidate_universe`
  and assert the warning fired with the strategy's id and the bad value.
"""

from __future__ import annotations

import logging
from unittest.mock import MagicMock

import pytest


def _build_supabase_mock_with_strategy(strategy: dict) -> MagicMock:
    """Build the minimum supabase-shape mock _load_candidate_universe expects."""
    sb = MagicMock()

    def _table(name: str):
        chain = MagicMock()
        if name == "strategies":
            (
                chain.select.return_value.eq.return_value.execute.return_value
            ) = MagicMock(data=[strategy])
        elif name == "strategy_analytics":
            (
                chain.select.return_value.in_.return_value.execute.return_value
            ) = MagicMock(data=[])
        return chain

    sb.table.side_effect = _table
    return sb


class TestLoadCandidateUniverseWarning:
    def test_warns_on_malformed_start_date_and_includes_strategy_id(
        self, caplog: pytest.LogCaptureFixture, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from routers.match import _load_candidate_universe

        bad_strategy = {
            "id": "test-sid-bad-date",
            "name": "Strategy with bad start_date",
            "codename": None,
            "strategy_types": ["systematic"],
            "subtypes": [],
            "supported_exchanges": ["binance"],
            "status": "published",
            "aum": 0,
            "max_capacity": 0,
            "user_id": "test-user-id",
            "start_date": "not-a-real-date",
        }
        sb_mock = _build_supabase_mock_with_strategy(bad_strategy)
        monkeypatch.setattr("routers.match.get_supabase", lambda: sb_mock)

        with caplog.at_level(logging.WARNING, logger="quantalyze.analytics"):
            result = _load_candidate_universe()

        # Function still completes — the bad row degrades but does not crash
        # the cron run (consistent with pre-fix behaviour, just no longer silent).
        assert result["strategies_by_id"]["test-sid-bad-date"]["track_record_days"] == 0

        warnings = [
            r for r in caplog.records if "match: bad start_date" in r.getMessage()
        ]
        assert len(warnings) == 1, "expected exactly one warning for the bad row"
        msg = warnings[0].getMessage()
        # The strategy id MUST appear in the log so an operator can find
        # the offending row by `select id, name, start_date from strategies
        # where id = '<id>'`.
        assert "test-sid-bad-date" in msg
        # The bad value MUST appear so the operator does not have to re-query
        # to see what's wrong.
        assert "not-a-real-date" in msg

    def test_valid_start_date_does_not_warn(
        self, caplog: pytest.LogCaptureFixture, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from routers.match import _load_candidate_universe

        good_strategy = {
            "id": "test-sid-good",
            "name": "Strategy with valid start_date",
            "codename": None,
            "strategy_types": ["systematic"],
            "subtypes": [],
            "supported_exchanges": ["binance"],
            "status": "published",
            "aum": 0,
            "max_capacity": 0,
            "user_id": "test-user-id",
            "start_date": "2024-01-01",
        }
        sb_mock = _build_supabase_mock_with_strategy(good_strategy)
        monkeypatch.setattr("routers.match.get_supabase", lambda: sb_mock)

        with caplog.at_level(logging.WARNING, logger="quantalyze.analytics"):
            _load_candidate_universe()

        # Happy path emits no bad-start_date warnings — false-positive
        # warnings would noise up production logs and erode trust in the
        # signal.
        warnings = [
            r for r in caplog.records if "match: bad start_date" in r.getMessage()
        ]
        assert warnings == [], "valid start_date must not emit a warning"
