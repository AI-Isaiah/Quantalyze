"""Detect exchange geo-restriction errors (worker egress blocked by region).

Some exchanges deny access by the CALLER's country at the edge, BEFORE any
auth/rate-limit logic:

  - **Bybit** fronts ``api.bybit.com`` with AWS CloudFront, which returns
    ``403`` + ``"The Amazon CloudFront distribution is configured to block
    access from your country"`` for blocked regions (e.g. US). ccxt sees a
    non-JSON 403 and (mis)maps it to ``ccxt.RateLimitExceeded``.
  - **Binance** returns ``451`` + ``"Service unavailable from a restricted
    location ..."`` (legal/eligibility restriction).

These are PERMANENT from the worker's current egress region — retrying or
stamping a 429 cooldown is futile and misleading (the request will never
succeed until the worker egresses from an allowed region). This module gives
the dispatch classifier one place to recognise the signature regardless of
which ccxt exception type wraps it, so the failure is classified ``permanent``
(no retry) with a clear operator message rather than a phantom rate-limit.

Detection is intentionally SIGNATURE-based (not status-code-based): ccxt
collapses the upstream status into varied exception types, but it preserves the
response body text in the exception message, and that body is the unambiguous
tell. Markers are specific enough to avoid false-positives on ordinary
permission/rate errors.
"""

from __future__ import annotations

import re

# Lower-cased substrings that uniquely identify an egress-region geo-block.
# Keep these SPECIFIC — a false positive would mark a transient/auth error as
# a permanent geo-block and suppress a legitimate retry.
_GEO_BLOCK_MARKERS: tuple[str, ...] = (
    "block access from your country",  # AWS CloudFront geo-restriction (Bybit)
    "restricted location",  # Binance 451 eligibility block
    "service unavailable from a restricted location",
)


def _exc_text(exc: BaseException) -> str:
    """Flatten an exception (and its direct cause/context) to lower-cased text.

    ccxt embeds the upstream response body in ``str(exc)``; a wrapper may carry
    the original under ``__cause__``/``__context__``, so include both.
    """
    parts = [str(exc)]
    for attr in ("__cause__", "__context__"):
        nested = getattr(exc, attr, None)
        if nested is not None:
            parts.append(str(nested))
    return " ".join(parts).lower()


def is_geo_blocked(exc: BaseException) -> bool:
    """True if ``exc`` is an exchange edge geo-restriction (CloudFront / 451).

    Permanent from the current worker egress region. Used by the dispatch
    classifier to override ccxt's mis-mapping (e.g. Bybit's CloudFront 403 →
    ``RateLimitExceeded``) so the job is failed-permanent (no retry, no 429
    cooldown) with an operator-actionable message instead of a phantom
    rate-limit retry loop.
    """
    text = _exc_text(exc)
    if any(marker in text for marker in _GEO_BLOCK_MARKERS):
        return True
    # Binance returns HTTP 451 with a legal-eligibility tell. Require BOTH a
    # word-boundary 451 (NOT a "451" substring of a price/id/timestamp — ccxt
    # embeds the full response body in str(exc), so e.g. "1451.59" or an order
    # id would otherwise match) AND the specific "eligibility" signal. The bare
    # word "restricted" is deliberately NOT a tell: it appears in many RETRYABLE
    # exchange errors (e.g. OKX "Operation restricted") and would false-positive
    # a recoverable failure into a no-retry 'permanent' (→ failed_final on the
    # first attempt). Binance's real 451 body ("...restricted location according
    # to 'b. Eligibility'") is already caught above by the "restricted location"
    # phrase marker, so dropping the bare-word fallback loses no real coverage.
    if re.search(r"\b451\b", text) and "eligibility" in text:
        return True
    return False
