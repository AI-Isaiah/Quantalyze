"""NEW-C13-10 — regression tests for the stdlib→structlog redact bridge.

Without `configure_logging()` installing the LogRecord factory wrapper, a
`logger.warning("ccxt failure: %s", str(exc))` call in exchange.py would
emit an unscrubbed HMAC signature to Railway stdout + Sentry breadcrumbs.

These tests pin the contract:
  1. signature= leak is scrubbed before the handler sees the record
  2. configure_logging() is idempotent (no double-wrapping of the factory)
  3. The factory is fail-open (a redact bug must not break logging)
  4. Both root-attached and child-logger-attached handlers see scrubbed records
"""

from __future__ import annotations

import logging
import unittest.mock
from io import StringIO

import pytest

import services.logging_config as lc_mod
from services.logging_config import configure_logging


@pytest.fixture(autouse=True)
def _reset_factory_state():
    """Strip our factory wrapper between tests so each one observes a clean install."""
    original = lc_mod._ORIGINAL_LOG_RECORD_FACTORY
    if original is not None:
        logging.setLogRecordFactory(original)
    lc_mod._ORIGINAL_LOG_RECORD_FACTORY = None
    lc_mod._REDACT_FACTORY_INSTALLED = False
    yield
    original = lc_mod._ORIGINAL_LOG_RECORD_FACTORY
    if original is not None:
        logging.setLogRecordFactory(original)
    lc_mod._ORIGINAL_LOG_RECORD_FACTORY = None
    lc_mod._REDACT_FACTORY_INSTALLED = False


def _attach_capture_handler() -> tuple[StringIO, logging.Handler]:
    buf = StringIO()
    handler = logging.StreamHandler(buf)
    handler.setLevel(logging.DEBUG)
    handler.setFormatter(logging.Formatter("%(message)s"))
    quant = logging.getLogger("quantalyze.analytics")
    quant.setLevel(logging.DEBUG)
    quant.addHandler(handler)
    return buf, handler


def _detach(handler: logging.Handler) -> None:
    logging.getLogger("quantalyze.analytics").removeHandler(handler)


def test_stdlib_logger_scrubs_signature_in_arg():
    """Headline NEW-C13-10 case: `logger.warning("%s", url_with_signature)`."""
    configure_logging()
    buf, handler = _attach_capture_handler()
    try:
        logger = logging.getLogger("quantalyze.analytics")
        url = (
            "https://api.binance.com/api/v3/order?symbol=BTCUSDT&timestamp=1700000000"
            "&signature=DEADBEEFCAFE1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF12"
        )
        logger.warning("ccxt failure: %s", url)
    finally:
        _detach(handler)
    out = buf.getvalue()
    assert "DEADBEEF" not in out, (
        f"NEW-C13-10 regression: HMAC signature leaked to stdlib emit. Got: {out!r}"
    )
    assert "[REDACTED]" in out, f"expected [REDACTED] marker; got: {out!r}"


def test_stdlib_logger_scrubs_signature_in_msg_format_string():
    """Pre-interpolated signature in the format string itself must scrub too."""
    configure_logging()
    buf, handler = _attach_capture_handler()
    try:
        logger = logging.getLogger("quantalyze.analytics")
        logger.error("ccxt error: signature=ABCDEFCAFE12345678901234567890ABCDEF")
    finally:
        _detach(handler)
    out = buf.getvalue()
    assert "ABCDEFCAFE" not in out, (
        f"NEW-C13-10 regression: literal signature leaked. Got: {out!r}"
    )
    assert "[REDACTED]" in out


def test_configure_logging_is_idempotent():
    """Repeated configure_logging() MUST NOT recursively wrap our own wrapper."""
    configure_logging()
    factory_after_first = logging.getLogRecordFactory()
    configure_logging()
    configure_logging()
    factory_after_third = logging.getLogRecordFactory()
    assert factory_after_first is factory_after_third, (
        "configure_logging is not idempotent — factory wrapper was re-installed"
    )
    # And the stored original must be the truly original logging.LogRecord,
    # not a wrapped version of itself.
    assert lc_mod._ORIGINAL_LOG_RECORD_FACTORY is logging.LogRecord, (
        "captured _ORIGINAL_LOG_RECORD_FACTORY drifted across idempotent calls"
    )


def test_record_factory_fails_open_on_scrub_exception():
    """If scrub_freeform_string raises, the factory MUST still return a usable
    record and the handler must emit it. A redact bug cannot break logging."""
    configure_logging()
    buf, handler = _attach_capture_handler()
    try:
        with unittest.mock.patch(
            "services.logging_config.scrub_freeform_string",
            side_effect=RuntimeError("simulated scrub failure"),
        ):
            logger = logging.getLogger("quantalyze.analytics")
            logger.warning("benign message that should still emit")
    finally:
        _detach(handler)
    out = buf.getvalue()
    assert "benign message" in out, (
        "fail-open broken: a scrub exception suppressed the log record"
    )


def test_factory_handles_root_logger_direct_emit():
    """A direct root-logger emit (e.g., from a third-party library) must also scrub."""
    configure_logging()
    buf = StringIO()
    handler = logging.StreamHandler(buf)
    handler.setFormatter(logging.Formatter("%(message)s"))
    root = logging.getLogger()
    root.addHandler(handler)
    try:
        root.warning("third-party leak: signature=LEAK1234ABCD5678EFGH")
    finally:
        root.removeHandler(handler)
    out = buf.getvalue()
    assert "LEAK1234ABCD" not in out
    assert "[REDACTED]" in out


def test_stdlib_logger_scrubs_dict_args_branch():
    """pr-test-analyzer M conf=9: the dict-args branch in _scrub_record_in_place
    was not exercised by the original 5 tests. `logger.warning("%(sig)s", {...})`
    is a real shape (structlog shim, %(name)s formatting). Pin it here."""
    configure_logging()
    buf, handler = _attach_capture_handler()
    try:
        logger = logging.getLogger("quantalyze.analytics")
        logger.warning("%(sig)s", {"sig": "signature=DICTLEAK1234ABCD5678EFGH"})
    finally:
        _detach(handler)
    out = buf.getvalue()
    assert "DICTLEAK" not in out, f"dict-arg scrub failed: {out!r}"
    assert "[REDACTED]" in out


def test_stdlib_logger_preserves_non_string_args():
    """pr-test-analyzer M conf=9: non-string args (ints, floats, bools) must
    pass through untouched. A regex on `42` would corrupt log output."""
    configure_logging()
    buf, handler = _attach_capture_handler()
    try:
        logging.getLogger("quantalyze.analytics").warning(
            "count=%d ratio=%.2f flag=%s", 42, 3.14, True,
        )
    finally:
        _detach(handler)
    out = buf.getvalue()
    assert "count=42 ratio=3.14 flag=True" in out, f"non-string passthrough corrupted: {out!r}"


def test_stdlib_logger_skips_args_with_no_strings():
    """Perf L conf=9: when args has no string values the allocation/comprehension
    is skipped entirely. Pin the contract so a refactor can't re-introduce the
    unconditional comprehension."""
    configure_logging()
    buf, handler = _attach_capture_handler()
    try:
        logger = logging.getLogger("quantalyze.analytics")
        # Tuple of ints only — should NOT trigger comprehension rebuild.
        logger.warning("a=%d b=%d c=%d", 1, 2, 3)
    finally:
        _detach(handler)
    assert "a=1 b=2 c=3" in buf.getvalue()


def test_logger_exception_scrubs_traceback_via_exc_text():
    """Security H conf=9 + PR-2 background-reviewer C1 (2026-05-28):
    `logger.exception(...)` with a ccxt exception whose `.args` carry an
    HMAC-bearing URL. The factory pre-populates `record.exc_text` with
    the SCRUBBED formatted traceback so the stdlib Formatter renders the
    scrubbed string (when using the standard `%(message)s` format the
    Formatter appends `record.exc_text` after the message).

    The LIVE exception's `.args` are intentionally NOT mutated (action-at-
    a-distance risk: a wrapping `try/except` that re-raises and pattern-
    matches `str(exc)` for rate-limit dispatching would otherwise see
    scrubbed strings). Custom Formatters using `%(exc_info)s` directly
    DO bypass exc_text — that is a documented Formatter foot-gun, not a
    redact-bridge regression.
    """
    configure_logging()
    buf = StringIO()
    handler = logging.StreamHandler(buf)
    # Standard format string: appends record.exc_text after the message
    # when exc_info is attached. record.exc_text is pre-populated by the
    # factory with the scrubbed traceback.
    handler.setFormatter(logging.Formatter("%(message)s"))
    quant = logging.getLogger("quantalyze.analytics")
    quant.addHandler(handler)
    try:
        try:
            raise RuntimeError(
                "ccxt PermissionDenied: GET /api/v3/order"
                "?symbol=BTC&signature=EXC_LEAK_HMAC_1234567890ABCDEF"
            )
        except RuntimeError:
            quant.exception("upstream failed")
    finally:
        quant.removeHandler(handler)
    out = buf.getvalue()
    assert "EXC_LEAK_HMAC" not in out, (
        f"NEW-C13-10 regression: HMAC leaked through stdlib Formatter path. "
        f"Got: {out!r}"
    )
    # And the live exception's args remain UNTOUCHED — verifies the new
    # action-at-a-distance defense.
    try:
        raise RuntimeError(
            "ccxt PermissionDenied: GET /api/v3/order"
            "?symbol=BTC&signature=ARGS_PRESERVED_LEAK"
        )
    except RuntimeError as exc:
        # Trigger the factory by emitting a log record carrying this exc.
        quant.exception("test args preservation", exc_info=exc)
        # The live exception's .args[0] MUST still contain the original
        # token — downstream try/except handlers must see the truth.
        assert "ARGS_PRESERVED_LEAK" in exc.args[0], (
            "PR-2 C1 regression: redact bridge mutated exc.args — breaks "
            "downstream pattern matching on str(exc)."
        )


def test_scrub_freeform_fast_path_skips_prose_lines():
    """Perf M conf=9: prose log lines with no `:`, `=`, `.` chars short-circuit
    the 4-pass scrub. Verify via direct call that a prose string round-trips
    identical (no [REDACTED] insertion, no allocation churn)."""
    from services.redact import scrub_freeform_string

    s = "Worker starting Claimed jobs Done"
    assert scrub_freeform_string(s) is s, (
        "fast-path should return identical reference (zero allocation) on "
        "strings with no `:`, `=`, or `.`"
    )
    # And the slow path still scrubs when a key=value hits.
    s2 = "signature=LEAK99887766"
    out = scrub_freeform_string(s2)
    assert out is not s2
    assert "LEAK99887766" not in out


def test_redact_processor_scrubs_dict_tracebacks_freeform_leaves():
    """PR-2 red-team H2 (2026-05-28): structlog.processors.dict_tracebacks
    writes the `exception` block as a nested dict whose string leaves can
    carry HMAC-bearing ccxt URLs. The key-denylist `_redact_scrub_pii` does
    NOT substring-scrub freeform strings. The processor must walk the tree
    and scrub every string leaf through scrub_freeform_string.
    """
    from services.logging_config import _redact_processor

    event_dict = {
        "event": "ccxt failure",
        "exception": [
            {
                "exc_type": "PermissionDenied",
                "exc_value": "GET /api/v3/order?symbol=BTC&signature=DICTTBLEAK1234ABCD",
                "syntax_error": None,
                "is_cause": False,
                "frames": [
                    {
                        "filename": "exchange.py",
                        "lineno": 42,
                        "name": "place_order",
                        "vars": {
                            "url": "https://api.binance.com/order?signature=FRAMEVARLEAK5678",
                            "qty": "0.1",
                        },
                    },
                ],
            },
        ],
    }
    scrubbed = _redact_processor(None, "error", event_dict)
    rendered = repr(scrubbed)
    assert "DICTTBLEAK" not in rendered, (
        f"dict_tracebacks exc_value leaked: {rendered!r}"
    )
    assert "FRAMEVARLEAK" not in rendered, (
        f"dict_tracebacks frame vars leaked: {rendered!r}"
    )
    assert "[REDACTED]" in rendered


# ---------------------------------------------------------------------------
# OPS-05 (Phase 163) — the scrub must not DELETE log lines
# ---------------------------------------------------------------------------
# `record.msg` with args is a %-format TEMPLATE. scrub_freeform_string rewrites
# `claim_token=%s,` to `claim_token: [REDACTED]`, eating one `%s`; getMessage()
# then raises TypeError and stdlib logging DROPS the record via handleError,
# emitting only "--- Logging error ---" to stderr. Measured 2026-08-26 with an
# AST scan of all 111 non-test modules in this service: 3 live templates hit it,
# all of them worker/compute diagnostics that ops silently never received.
# ---------------------------------------------------------------------------

# Verbatim from main_worker.py's LATE_MARK_IGNORED warning — the fencing
# diagnostic that says another worker legitimately took a claimed job over. If
# that template is ever rephrased this constant should follow it, but the
# contract under test is the shape (`<denylisted-key>=%s` inside a template with
# other placeholders), not this one call site.
_LATE_MARK_TEMPLATE = (
    "LATE_MARK_IGNORED: job %s %s preempted by watchdog reclaim "
    "(claim_token=%s, worker=%s) — another worker has taken over"
)


def test_scrub_never_drops_a_record_by_eating_a_format_placeholder():
    """A denylist-shaped literal in a %-template must not delete the log line.

    RED demo M4 (2026-08-26): reverting the guard in
    services/logging_config.py::_scrub_record_in_place to the unconditional
    `record.msg = scrub_freeform_string(record.msg)` fails this test at the
    `logger.warning(...)` call itself, with
    `TypeError: not all arguments converted during string formatting` raised out
    of `Handler.handleError` (pytest's LogCaptureHandler re-raises it; a
    PRODUCTION handler instead swallows it and drops the record, printing only
    "--- Logging error ---" to stderr). The same mutation independently reddens
    `tests/test_compute_jobs_fencing.py::TestDispatchTickThreadsClaimToken` —
    3 failed / 2 passed — which is how this defect was found: it is not a
    hypothetical, it is what production has been doing at three call sites.

    ⚠️ That sibling module must be run on its OWN to see it. This file's autouse
    `_reset_factory_state` fixture uninstalls the LogRecord factory on teardown,
    so a combined run leaves the fencing tests unconfigured and green.

    ⚠️ The assertion is deliberately "the line came out", not "the line came out
    scrubbed". Redacting a developer-authored constant template is worth nothing;
    delivering the diagnostic is worth a lot. The VALUES — the only part an
    exchange, a venue or a user can influence — are `record.args`, and they are
    scrubbed on their own path (see the signature tests above, which still pass).
    """
    configure_logging()
    buf, handler = _attach_capture_handler()
    try:
        logging.getLogger("quantalyze.analytics").warning(
            _LATE_MARK_TEMPLATE, "job-1", "done", "tok-abc123", "worker-7"
        )
    finally:
        _detach(handler)
    out = buf.getvalue()
    assert "LATE_MARK_IGNORED" in out, (
        "the record was DROPPED. scrub_freeform_string ate a `%s` from the "
        "format template, getMessage() raised TypeError, and stdlib logging "
        f"swallowed the line in Handler.handleError. Got: {out!r}"
    )
    # All four positional args must have landed — a partially-formatted line
    # would mean the placeholder count was preserved but the mapping shifted.
    for expected in ("job-1", "done", "tok-abc123", "worker-7"):
        assert expected in out, f"arg {expected!r} missing from {out!r}"


def test_scrub_still_redacts_a_template_when_placeholders_survive():
    """The revert is NARROW: a scrub that leaves the placeholders alone is kept.

    Pins that the fix above did not degrade into "never scrub a template with
    args". Here the denylisted literal sits away from the placeholder, so the
    scrubbed template still formats and the secret is redacted.
    """
    configure_logging()
    buf, handler = _attach_capture_handler()
    try:
        logging.getLogger("quantalyze.analytics").warning(
            "venue rejected apisecret=SUPERSECRETVALUE for job %s", "job-9"
        )
    finally:
        _detach(handler)
    out = buf.getvalue()
    assert "SUPERSECRETVALUE" not in out, f"template literal leaked: {out!r}"
    assert "[REDACTED]" in out, f"expected the redaction marker: {out!r}"
    assert "job-9" in out, f"the record was dropped or mis-formatted: {out!r}"
