"""SFOX-07 (121-02) — probe_exchange_egress --expect fail-loud gate.

The founder's pre-whitelist gate: run the probe from the worker's realized egress
and refuse to whitelist unless the observed egress IP == the expected static IP. A
gate can NEVER false-pass on missing evidence (ipinfo unreachable/unparseable ⇒
exit 1), and it must not print the proxy URL secret.

Tests inject responses by monkeypatching `_get` (the single fetch chokepoint) and
drive `main(argv=[...])`, asserting the exit-code contract.
"""
from __future__ import annotations

import scripts.probe_exchange_egress as probe


def _fake_get_factory(ipinfo_response, exchange_status=200):
    """Return a `_get(url, opener=None)` stub: ipinfo.io → `ipinfo_response`,
    every exchange host → `(exchange_status, "{}")`."""

    def _fake_get(url, opener=None):
        if "ipinfo.io" in url:
            return ipinfo_response
        return (exchange_status, "{}")

    return _fake_get


def test_expect_match_exit_0(monkeypatch, capsys):
    monkeypatch.setattr(
        probe, "_get", _fake_get_factory((200, '{"ip":"1.2.3.4","country":"NL"}'))
    )
    rc = probe.main(argv=["--expect", "1.2.3.4"])
    out = capsys.readouterr().out
    assert rc == 0
    assert "1.2.3.4" in out


def test_expect_mismatch_exit_1_names_both(monkeypatch, capsys):
    monkeypatch.setattr(
        probe, "_get", _fake_get_factory((200, '{"ip":"5.6.7.8","country":"NL"}'))
    )
    rc = probe.main(argv=["--expect", "1.2.3.4"])
    out = capsys.readouterr().out
    assert rc == 1
    assert "EGRESS-MISMATCH" in out
    assert "5.6.7.8" in out and "1.2.3.4" in out


def test_expect_ipinfo_transport_failure_exit_1(monkeypatch):
    # ipinfo unreachable (status None) → cannot confirm → fail loud, never pass.
    monkeypatch.setattr(probe, "_get", _fake_get_factory((None, "ConnResetError")))
    assert probe.main(argv=["--expect", "1.2.3.4"]) == 1


def test_expect_ipinfo_non200_exit_1(monkeypatch):
    monkeypatch.setattr(probe, "_get", _fake_get_factory((429, "rate limited")))
    assert probe.main(argv=["--expect", "1.2.3.4"]) == 1


def test_expect_ipinfo_unparseable_exit_1(monkeypatch):
    # A 200 with a non-JSON body yields no ip → missing evidence → exit 1.
    monkeypatch.setattr(probe, "_get", _fake_get_factory((200, "not json at all")))
    assert probe.main(argv=["--expect", "1.2.3.4"]) == 1


def test_no_expect_all_reachable_exit_0(monkeypatch):
    # No --expect → the geo-block exit contract is unchanged.
    monkeypatch.setattr(
        probe,
        "_get",
        _fake_get_factory((200, '{"ip":"1.2.3.4","country":"NL"}'), exchange_status=200),
    )
    assert probe.main(argv=[]) == 0


def test_no_expect_geo_block_exit_1(monkeypatch):
    def _fake_get(url, opener=None):
        if "ipinfo.io" in url:
            return (200, '{"ip":"9.9.9.9","country":"US"}')
        return (451, "restricted location")

    monkeypatch.setattr(probe, "_get", _fake_get)
    assert probe.main(argv=[]) == 1


class _RaisingOpener:
    """An opener whose .open raises an error echoing the proxy URL — simulates a
    ProxyHandler failing to connect to a (malformed/unreachable) proxy."""

    def __init__(self, message):
        self._message = message

    def open(self, req, timeout=None):
        raise OSError(self._message)


def test_get_error_body_redacts_proxy_userinfo():
    # F3/121: when the routed fetch raises an error whose message carries the
    # proxy URL (`user:pass@host`), `_get`'s catch-all body — which main() prints
    # to stdout — must have the BasicAuth userinfo redacted before it is returned.
    opener = _RaisingOpener(
        "Cannot connect to proxy http://quantalyze:SECRETPW@10.0.0.1:8888"
    )
    status, body = probe._get("https://api.bybit.com/v5/market/time", opener=opener)
    assert status is None
    assert "SECRETPW" not in body
    assert "[REDACTED]" in body


def test_proxy_url_secret_never_printed(monkeypatch, capsys):
    # When routed through the proxy, the probe must redact the URL to host:port —
    # the BasicAuth secret must never reach stdout (T-121-06 / Pitfall 5).
    monkeypatch.setenv("WORKER_EGRESS_PROXY_URL", "http://user:SECRETPW@10.0.0.1:8888")
    monkeypatch.setattr(
        probe, "_get", _fake_get_factory((200, '{"ip":"1.2.3.4","country":"NL"}'))
    )
    probe.main(argv=["--expect", "1.2.3.4"])
    out = capsys.readouterr().out
    assert "SECRETPW" not in out
    assert "user:SECRETPW" not in out
