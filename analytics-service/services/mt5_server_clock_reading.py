"""Phase 155.1 SERVERCLOCK (MT5-06) — the persisted shape of one server-clock
reading: the row builder and the server-label hash.

Worker leaf. ⛔ It MUST NEVER import ``services.job_worker`` (``job_worker`` imports
IT). Its in-tree imports are ``services.mt5_probe`` (for the house server-name
normalisation) and ``services.mt5_server_clock`` (the pure assessment). It takes
plain ints rather than ``Mt5ServerTickTimes`` so it never imports
``services.mt5_client``.

⛔ The account's server NAME is hashed here and never logged, returned or stored
(D-17): the row carries ``server_label_hash`` only.

``tests/test_mt5_server_clock_readings_parity.py`` pins the row's keys and the
verdict, reason and rule sets against the migration text, because the insert is the
first write of every MT5 derive and a drift fails every derive after deploy.
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from typing import Any, Final

from services.mt5_probe import normalise_mt5_server
from services.mt5_server_clock import Mt5ServerClock, Mt5ServerClockAssessment

MT5_SERVER_CLOCK_READINGS_TABLE: Final = "mt5_server_clock_readings"


def server_label_hash(server: object) -> str | None:
    """UNSALTED SHA-256 hex of the normalised account server, or ``None`` for a
    non-string or blank value (never invent one).

    Three properties, each deliberate (``155.1-RESEARCH.md`` "Open Questions
    (RESOLVED)" Q5):

    * UNSALTED and unkeyed: no HMAC, no Railway secret. The table is service-role
      only (D-15) and its one consumer is the per-key equality check of criterion
      4, so a keyed hash would add a secret for no reader who could exploit
      reversal.
    * EQUALITY ONLY: two readings carry the same hash exactly when the normalised
      names are equal (``normalise_mt5_server``: trim, then case-fold).
    * NEVER PRINTED: the hash reaches no log line, report or error (D-17).
    """
    if not isinstance(server, str) or not server.strip():
        return None
    return hashlib.sha256(normalise_mt5_server(server).encode("utf-8")).hexdigest()


def build_mt5_server_clock_reading_row(
    *,
    api_key_id: str,
    job_id: str | None,
    read_at: datetime,
    clock: Mt5ServerClock,
    assessment: Mt5ServerClockAssessment,
    newest_tick_wall_ms: int | None,
    symbols_visible: int | None,
    symbols_answered: int | None,
    server: object,
) -> dict[str, Any]:
    """The ``public.mt5_server_clock_readings`` insert payload. Its keys are exactly
    the table's non-defaulted columns (everything but ``id`` and ``created_at``)."""
    return {
        "api_key_id": api_key_id,
        "job_id": job_id,
        "read_at": read_at.astimezone(timezone.utc).isoformat(),
        "configured_rule": clock.rule,
        "verdict": assessment.verdict,
        "reason": assessment.reason,
        "newest_tick_wall_ms": newest_tick_wall_ms,
        "raw_offset_s": assessment.raw_offset_s,
        "measured_offset_s": assessment.measured_offset_s,
        "expected_offset_s": assessment.expected_offset_s,
        "residual_s": assessment.residual_s,
        "newest_tick_age_s": assessment.newest_tick_age_s,
        "symbols_visible": symbols_visible,
        "symbols_answered": symbols_answered,
        "server_label_hash": server_label_hash(server),
    }
