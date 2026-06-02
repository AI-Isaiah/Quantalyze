"""Probe the worker's egress region + exchange reachability (read-only).

WHY: Bybit (CloudFront 403 "blocked from your country") and Binance (451
"restricted location") deny access by the CALLER's country at the edge. If the
Railway worker egresses from a blocked region (e.g. US), ALL calls to those
exchanges fail — trades, positions, equity, funding — surfacing as
"funding fetch failed … RateLimitExceeded" + aiohttp "Unclosed connector"
noise. The root cause is the egress region, not the code.

This script makes the egress region + per-exchange reachability observable in
one shot, using only the stdlib (no deps), so it runs identically locally,
inside the container, or via `railway ssh`.

USAGE
-----
  # From the running prod worker's actual egress (the authoritative check):
  railway ssh "cd /app && python -m scripts.probe_exchange_egress"

  # Locally / from a candidate region host:
  python -m scripts.probe_exchange_egress

RUNBOOK — moving the worker out of a blocked region
---------------------------------------------------
1. Run this probe from the current prod egress (command above). Record the
   egress country + which exchanges return HTTP 200 vs 403/451.
2. Change the Railway service's region to a non-US region that allows the
   exchanges in use. Railway: Service → Settings → Regions (dashboard), or
   `railway scale` for multi-region. Candidates: EU-West (Amsterdam) or
   Southeast Asia (Singapore). NOTE: eligibility differs per exchange and
   region (Binance derivatives are also restricted in parts of the EU), so do
   NOT assume — validate in step 4.
3. Redeploy: `railway up` (or redeploy from the dashboard) so the service runs
   in the new region.
4. RE-RUN this probe from the new region (`railway ssh "cd /app && python -m
   scripts.probe_exchange_egress"`) and confirm EVERY in-use exchange returns
   HTTP 200 BEFORE relying on it. If Bybit/Binance still 403/451, the region
   is still blocked — try another or use an allowed-region egress proxy.
5. Re-enqueue the affected strategies' ingestion once green.

Exit code is non-zero if any probed exchange host is geo-blocked, so this can
gate a deploy/health check.
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request

_TIMEOUT_S = 10
_UA = "quantalyze-egress-probe/1"

# Public, unauthenticated endpoints on the SAME hosts the ingestion paths use.
# A CloudFront/region block hits the whole host, so a public probe is a faithful
# proxy for whether authenticated ingestion will work.
_EXCHANGE_PROBES: tuple[tuple[str, str], ...] = (
    ("bybit", "https://api.bybit.com/v5/market/time"),
    ("binance", "https://fapi.binance.com/fapi/v1/time"),
    ("okx", "https://www.okx.com/api/v5/public/time"),
)

# Substrings that mark an egress-region geo-block (mirror services.geo_block).
_GEO_MARKERS = ("block access from your country", "restricted location")


def _get(url: str) -> tuple[int | None, str]:
    """Return (http_status_or_None, body_snippet). Never raises."""
    req = urllib.request.Request(url, headers={"User-Agent": _UA})
    try:
        with urllib.request.urlopen(req, timeout=_TIMEOUT_S) as resp:
            return resp.status, resp.read(400).decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read(400).decode("utf-8", "replace")
    except Exception as exc:  # noqa: BLE001 - report any transport failure
        return None, f"{type(exc).__name__}: {exc}"


def _is_geo_blocked(status: int | None, body: str) -> bool:
    low = body.lower()
    if any(m in low for m in _GEO_MARKERS):
        return True
    return status == 451


def main() -> int:
    egress_status, egress_body = _get("https://ipinfo.io/json")
    country = "?"
    if egress_status == 200:
        try:
            country = json.loads(egress_body).get("country", "?")
        except Exception:  # noqa: BLE001
            pass
    print(f"EGRESS country={country} (ipinfo HTTP {egress_status})")

    blocked: list[str] = []
    for name, url in _EXCHANGE_PROBES:
        status, body = _get(url)
        geo = _is_geo_blocked(status, body)
        verdict = "GEO-BLOCKED" if geo else ("OK" if status == 200 else "FAIL")
        snippet = body.replace("\n", " ")[:120]
        print(f"  {name:8} HTTP {status} {verdict} | {snippet}")
        if geo:
            blocked.append(name)

    if blocked:
        print(f"RESULT: geo-blocked from egress country={country}: {', '.join(blocked)}")
        return 1
    print(f"RESULT: all probed exchanges reachable from egress country={country}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
