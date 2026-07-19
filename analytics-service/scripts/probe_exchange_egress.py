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

  # SFOX-07 founder pre-whitelist gate — route through the static-egress proxy and
  # FAIL LOUD (exit 1) unless the realized egress IP == the expected static IP.
  # WORKER_EGRESS_PROXY_URL carries the proxy BasicAuth secret (never printed):
  railway ssh "cd /app && WORKER_EGRESS_PROXY_URL='http://user:pw@<inbound-v4>:8888' \
               python -m scripts.probe_exchange_egress --expect <egress-v4>"

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

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

# services.redact is a LEAF module (imports only stdlib `re`/`typing`), so this
# adds ZERO third-party dependency — the probe stays runnable identically
# locally, in-container, and via `railway ssh`. Reusing the ONE definition of the
# URL-userinfo scrub (F1) keeps the redaction pattern from drifting (Pitfall 5).
from services.redact import scrub_url_userinfo

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


def _get(url: str, opener: urllib.request.OpenerDirector | None = None) -> tuple[int | None, str]:
    """Return (http_status_or_None, body_snippet). Never raises.

    When `opener` is provided (the SFOX-07 proxy-routed path), the fetch goes
    THROUGH that opener so the probe measures the REALIZED proxied egress rather
    than the container's direct egress.
    """
    req = urllib.request.Request(url, headers={"User-Agent": _UA})
    open_fn = opener.open if opener is not None else urllib.request.urlopen
    try:
        with open_fn(req, timeout=_TIMEOUT_S) as resp:
            return resp.status, resp.read(400).decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read(400).decode("utf-8", "replace")
    except Exception as exc:  # noqa: BLE001 - report any transport failure
        # F3/121: a transport/proxy failure (esp. a malformed WORKER_EGRESS_PROXY_URL
        # routed via the ProxyHandler) can surface the FULL proxy URL — incl. its
        # `user:pass@` BasicAuth — inside `str(exc)`. This body is printed to stdout
        # in main(), so userinfo-redact it here (the earlier `_redact_proxy` only
        # covered the routed-through note, not this catch-all error body).
        return None, scrub_url_userinfo(f"{type(exc).__name__}: {exc}")


def _redact_proxy(url: str) -> str:
    """Reduce a proxy URL to scheme://host:port — DROP the BasicAuth userinfo.

    WORKER_EGRESS_PROXY_URL carries the proxy secret; it must NEVER reach stdout
    or logs (T-121-06 / Pitfall 5). urlsplit's `hostname`/`port` never include the
    userinfo, so this cannot leak the credential even on a malformed URL."""
    try:
        parts = urllib.parse.urlsplit(url)
        host = parts.hostname or "?"
        port = f":{parts.port}" if parts.port else ""
        return f"{parts.scheme}://{host}{port}"
    except Exception:  # noqa: BLE001 — never risk echoing the raw (secret) URL
        return "<proxy>"


def _build_proxy_opener() -> urllib.request.OpenerDirector | None:
    """If WORKER_EGRESS_PROXY_URL is set, build an opener that routes every probe
    fetch THROUGH it (so the measured egress is the proxied egress). Prints a
    redacted note; never the secret URL. Returns None when unset (direct egress)."""
    proxy_url = os.getenv("WORKER_EGRESS_PROXY_URL") or None
    if not proxy_url:
        return None
    handler = urllib.request.ProxyHandler({"http": proxy_url, "https": proxy_url})
    print(f"EGRESS routed THROUGH proxy {_redact_proxy(proxy_url)} (userinfo redacted)")
    return urllib.request.build_opener(handler)


def _is_geo_blocked(status: int | None, body: str) -> bool:
    low = body.lower()
    if any(m in low for m in _GEO_MARKERS):
        return True
    return status == 451


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Probe worker egress region + exchange reachability (read-only)."
    )
    parser.add_argument(
        "--expect",
        default=None,
        metavar="IP",
        help=(
            "SFOX-07 gate: the expected static egress IP. Fails loud (exit 1) if "
            "the realized egress IP != this — including when the egress IP cannot "
            "be read (a gate never false-passes on missing evidence)."
        ),
    )
    args = parser.parse_args(argv)

    # SFOX-07: when WORKER_EGRESS_PROXY_URL is set, route every fetch THROUGH the
    # proxy so we measure the REALIZED proxied egress (the whole point of the gate).
    opener = _build_proxy_opener()

    # SFOX-07: an ambient NO_PROXY/no_proxy makes urllib's ProxyHandler silently
    # BYPASS the proxy (proxy_bypass) while _build_proxy_opener still printed
    # "routed THROUGH proxy" — so the probe would measure DIRECT egress, diverging
    # from the real aiohttp path (SfoxClient trust_env=False + explicit proxy=, and
    # ccxt aiohttp_proxy) which ignores NO_PROXY. Refuse — but ONLY when a host this
    # probe actually fetches would be bypassed: proxy_bypass is PER-HOST, so the
    # near-universal `NO_PROXY=localhost,127.0.0.1` must not hard-fail a run whose
    # ipinfo/exchange fetches all still route through the proxy.
    if opener is not None:
        _probed_hosts = ["ipinfo.io"] + [
            urllib.parse.urlsplit(u).hostname for _, u in _EXCHANGE_PROBES
        ]
        _bypassed = [h for h in _probed_hosts if h and urllib.request.proxy_bypass(h)]
        if _bypassed:
            print(
                "EGRESS-VERIFY FAIL: NO_PROXY/no_proxy would BYPASS the egress proxy "
                f"for {', '.join(_bypassed)} — urllib would measure DIRECT egress for "
                "those hosts, diverging from the real aiohttp path (trust_env=False "
                "ignores NO_PROXY). Unset NO_PROXY/no_proxy for these hosts and re-run."
            )
            return 1

    egress_status, egress_body = _get("https://ipinfo.io/json", opener)
    country = "?"
    ip: str | None = None
    if egress_status == 200:
        try:
            parsed = json.loads(egress_body)
            country = parsed.get("country", "?")
            ip = parsed.get("ip")
        except Exception:  # noqa: BLE001
            pass
    print(f"EGRESS ip={ip} country={country} (ipinfo HTTP {egress_status})")

    # --expect gate (SFOX-07 pre-whitelist): fail loud on mismatch OR missing
    # evidence, BEFORE any exchange probe, so the founder never whitelists an
    # egress IP that was assumed rather than realized.
    if args.expect is not None:
        # A proxied-egress gate can only certify a PROXIED measurement. With no
        # proxy configured this probe measured DIRECT egress — which may equal the
        # expected IP by coincidence (e.g. run ON the Fly machine, where direct
        # egress IS the static IP), so certifying it would green-light a whitelist
        # for a path production never takes. Refuse on missing proxy, never assume.
        if opener is None:
            print(
                "EGRESS-VERIFY FAIL: WORKER_EGRESS_PROXY_URL is not set, so this "
                "probe measured DIRECT egress, not the proxied static-egress path. "
                f"Cannot confirm egress == {args.expect}. Set the proxy URL and "
                "re-run. NOT verified; do NOT whitelist."
            )
            return 1
        if egress_status != 200 or not ip:
            print(
                f"EGRESS-VERIFY FAIL: could not read the egress IP (ipinfo HTTP "
                f"{egress_status}) — cannot confirm egress == {args.expect}. "
                "NOT verified; do NOT whitelist."
            )
            return 1
        if ip != args.expect:
            print(
                f"EGRESS-MISMATCH: observed egress ip={ip} != expected "
                f"{args.expect} — the worker is NOT egressing from the static IP. "
                "Do NOT whitelist."
            )
            return 1
        print(f"EGRESS-VERIFY OK: egress ip={ip} == expected {args.expect}")

    blocked: list[str] = []
    for name, url in _EXCHANGE_PROBES:
        status, body = _get(url, opener)
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
