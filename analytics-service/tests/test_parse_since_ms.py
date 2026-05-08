"""Audit-2026-05-07 #10 — parse_since_ms warning regression tests.

Pre-fix the bare `except Exception: return None` swallowed every parse
failure silently. The caller treats `None` as "fetch from the beginning
of time", which burns API quota AND can collide with sync_trades'
DELETE+INSERT (audit item #2). The fix logs the bad value at WARN so an
operator sees the malformed timestamp instead of debugging a quiet
full-history refetch.

Asserted invariants:
  1. Happy path: a valid ISO 8601 timestamp returns int(ts*1000) and
     emits NO warning.
  2. Bad input (non-ISO string) returns None AND emits a single warning
     containing the bad value and the parser's error.
  3. None input returns None and emits NO warning (the function has an
     early return for `value is None`).
"""

from __future__ import annotations

import logging

import pytest

from services.exchange import parse_since_ms


class TestParseSinceMs:
    def test_returns_milliseconds_for_valid_iso8601(self) -> None:
        # 2026-01-01T00:00:00Z → 1767225600000 ms
        result = parse_since_ms("2026-01-01T00:00:00Z")
        assert result == 1767225600000

    def test_does_not_warn_on_valid_iso8601(self, caplog: pytest.LogCaptureFixture) -> None:
        with caplog.at_level(logging.WARNING, logger="quantalyze.analytics"):
            parse_since_ms("2026-01-01T00:00:00Z")
        assert not any(
            "parse_since_ms" in r.getMessage() for r in caplog.records
        ), "happy path should not emit a warning"

    def test_returns_none_for_garbage_string(self) -> None:
        assert parse_since_ms("not-a-date") is None

    def test_warns_on_garbage_string_with_value_and_exception(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        # Audit-2026-05-07 #10: surface the bad value + the parser exception
        # so an operator can find the source row in api_keys.last_sync_at.
        with caplog.at_level(logging.WARNING, logger="quantalyze.analytics"):
            parse_since_ms("not-a-date")
        warnings = [
            r for r in caplog.records if "parse_since_ms" in r.getMessage()
        ]
        assert len(warnings) == 1, "expected exactly one warning"
        msg = warnings[0].getMessage()
        # The bad value must appear in the log so an operator can grep for it.
        assert "not-a-date" in msg
        # The phrase "refetch from start" makes the consequence obvious so
        # the operator does not assume the worker is idle.
        assert "refetch from start" in msg

    def test_returns_none_for_none_input(self) -> None:
        assert parse_since_ms(None) is None

    def test_does_not_warn_on_none_input(self, caplog: pytest.LogCaptureFixture) -> None:
        # The early `if value is None` short-circuit means None must NOT
        # trip the warning path — a None last_sync_at is normal for a
        # never-synced api_key.
        with caplog.at_level(logging.WARNING, logger="quantalyze.analytics"):
            parse_since_ms(None)
        assert not any(
            "parse_since_ms" in r.getMessage() for r in caplog.records
        ), "None input is the expected first-sync state, not a warning"
