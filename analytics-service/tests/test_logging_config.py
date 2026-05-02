"""Phase 16 / OBSERV-09 — unit tests for analytics-service/services/logging_config.py.

Asserted invariants:
  1. configure_logging() produces JSON output with sort_keys=True deterministic
     ordering on every log line.
  2. structlog.contextvars.bind_contextvars(...) values appear automatically on
     every subsequent log call inside the same context (merge_contextvars
     processor wired correctly).
"""

from __future__ import annotations

import json

import structlog

from services.logging_config import configure_logging, correlation_id_var


class TestConfigureLogging:
    @classmethod
    def setup_class(cls) -> None:
        configure_logging()

    def test_emits_json_with_sorted_keys(self, capsys):
        log = structlog.get_logger()
        log.info("foo", bar=1)
        captured = capsys.readouterr().out.strip().splitlines()
        # Last line should be the JSON record we just emitted.
        record = json.loads(captured[-1])
        assert record["event"] == "foo"
        assert record["bar"] == 1
        assert record["level"] == "info"
        assert "timestamp" in record
        # sort_keys=True is asserted by the JSONRenderer; verify lexicographic order:
        assert list(record.keys()) == sorted(record.keys())

    def test_bound_contextvars_merge_into_log_record(self, capsys):
        # Use BOTH the explicit ContextVar (FIX 11) AND structlog's binding helper
        # so we exercise the same path the middleware uses.
        cv_token = correlation_id_var.set("abc-123")
        structlog.contextvars.bind_contextvars(correlation_id="abc-123")
        try:
            structlog.get_logger().info("ping")
            record = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
            assert record["correlation_id"] == "abc-123"
        finally:
            structlog.contextvars.unbind_contextvars("correlation_id")
            correlation_id_var.reset(cv_token)
