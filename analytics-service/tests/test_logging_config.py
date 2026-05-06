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


# ---------------------------------------------------------------------------
# Phase 18 / FIX-04 — redact processor wire-up.
# A new processor between merge_contextvars and add_log_level walks every
# event_dict through services.redact.scrub_pii so denylisted keys never leak
# into the JSON output line.
# ---------------------------------------------------------------------------


class TestRedactProcessor:
    @classmethod
    def setup_class(cls) -> None:
        configure_logging()

    def test_redact_processor_scrubs_event_dict(self, capsys):
        log = structlog.get_logger()
        log.info("event", api_key="should-be-gone", safe_field="kept")

        captured = capsys.readouterr().out.strip().splitlines()
        record = json.loads(captured[-1])

        # api_key is denylisted — the redact processor replaces with [REDACTED].
        assert record["api_key"] == "[REDACTED]"
        # Non-sensitive field is preserved verbatim.
        assert record["safe_field"] == "kept"

    def test_redact_processor_scrubs_broker_quirk_keys(self, capsys):
        # Grok B1 — broker-quirk header keys are in the canonical denylist.
        log = structlog.get_logger()
        log.info(
            "broker_event",
            **{
                "x-bapi-apikey": "leaky",
                "ok-access-passphrase": "leaky2",
                "harmless": "ok",
            },
        )
        captured = capsys.readouterr().out.strip().splitlines()
        record = json.loads(captured[-1])
        assert record["x-bapi-apikey"] == "[REDACTED]"
        assert record["ok-access-passphrase"] == "[REDACTED]"
        assert record["harmless"] == "ok"

    def test_redact_processor_swallows_exceptions(self, capsys, monkeypatch):
        """Logging must NEVER break the request — the processor wraps
        scrub_pii in try/except. Force scrub_pii to raise and confirm the log
        line still emits (the processor falls through to the original event_dict)."""
        from services import logging_config

        def raising_scrub(_value):
            raise RuntimeError("scrub_pii blew up")

        monkeypatch.setattr(
            logging_config, "_redact_scrub_pii", raising_scrub
        )

        log = structlog.get_logger()
        log.info("safe_event", api_key="still-here")  # processor catches, falls through
        captured = capsys.readouterr().out.strip().splitlines()
        record = json.loads(captured[-1])
        # Note: when scrub_pii raises, the unscrubbed event_dict is returned —
        # this is intentional fail-open behavior so logging never breaks.
        assert record["event"] == "safe_event"
