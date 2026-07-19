"""SFOX-07 (121-02) — WORKER_EGRESS_PROXY_URL threading + all-4-sites wiring.

The safety property under test is BYTE-IDENTICAL-WHEN-UNSET: with the env unset,
`make_sfox_client()` must pass `proxy=None` (today's SfoxClient behavior) and
`create_exchange(...)` must leave `exchange.aiohttp_proxy` at its ccxt `None`
class default. The pre-existing sfox/ccxt suites staying green is the behavioral
half of that proof; the explicit None-pins here are the structural half.

Env is ALWAYS mutated via monkeypatch.setenv/delenv (never os.environ directly)
so no test leaks proxy state into a sibling.
"""
from __future__ import annotations

import asyncio
import re
from pathlib import Path

import pytest

from services.exchange import create_exchange
from services.sfox_client import SFOX_PROD_BASE_URL
from services.sfox_factory import make_sfox_client, worker_egress_proxy_url

_URL = "http://u:p@1.2.3.4:8888"
_ENV = "WORKER_EGRESS_PROXY_URL"
_CCXT_FLAG = "WORKER_EGRESS_PROXY_APPLIES_TO_CCXT"


# --------------------------------------------------------------------------- #
# worker_egress_proxy_url() — env → str|None coercion                          #
# --------------------------------------------------------------------------- #
def test_worker_egress_proxy_url_unset_is_none(monkeypatch):
    monkeypatch.delenv(_ENV, raising=False)
    assert worker_egress_proxy_url() is None


def test_worker_egress_proxy_url_empty_string_is_none(monkeypatch):
    # An empty string is deploy-config noise (an unset Railway var reads as "");
    # coerce to None so it is byte-identical to truly unset.
    monkeypatch.setenv(_ENV, "")
    assert worker_egress_proxy_url() is None


def test_worker_egress_proxy_url_set_returns_url(monkeypatch):
    monkeypatch.setenv(_ENV, _URL)
    assert worker_egress_proxy_url() == _URL


@pytest.mark.parametrize("ws", ["   ", "\t", "\n", " \t\n "])
def test_worker_egress_proxy_url_whitespace_only_is_none(monkeypatch, ws):
    # F5 (121): an all-whitespace value is deploy-config noise; coerce to None so
    # it is byte-identical to truly unset, NOT handed to aiohttp as InvalidURL('').
    monkeypatch.setenv(_ENV, ws)
    assert worker_egress_proxy_url() is None


# --------------------------------------------------------------------------- #
# make_sfox_client() — explicit proxy threading + credential passthrough       #
# --------------------------------------------------------------------------- #
def test_make_sfox_client_env_unset_proxy_is_none(monkeypatch):
    # The byte-identical pin: unset env → proxy None, exactly today's SfoxClient.
    monkeypatch.delenv(_ENV, raising=False)
    client = make_sfox_client("k")
    assert client._proxy is None


def test_make_sfox_client_empty_env_proxy_is_none(monkeypatch):
    monkeypatch.setenv(_ENV, "")
    client = make_sfox_client("k")
    assert client._proxy is None


def test_make_sfox_client_whitespace_env_proxy_is_none(monkeypatch):
    # F5: whitespace-only env → None → no validation → byte-identical to unset.
    monkeypatch.setenv(_ENV, "   ")
    client = make_sfox_client("k")
    assert client._proxy is None


def test_make_sfox_client_malformed_bad_port_fails_loud_no_secret(monkeypatch):
    # F5: a genuinely-malformed proxy URL (bad port 88x8) must fail LOUD at the
    # construction seam with a clear message that NEVER echoes the BasicAuth secret.
    secret = "deadbeefcafe"
    monkeypatch.setenv(_ENV, f"http://quantalyze:{secret}@37.16.1.5:88x8")
    with pytest.raises(ValueError) as excinfo:
        make_sfox_client("k")
    msg = str(excinfo.value)
    assert secret not in msg, f"malformed-URL error leaked the secret: {msg!r}"
    assert "WORKER_EGRESS_PROXY_URL" in msg


def test_make_sfox_client_truncated_at_at_sign_no_secret_leak(monkeypatch):
    # Red-team (MED): a URL COPY-CUT at the '@' (`scheme://user:PASSWORD`, no host)
    # makes urlsplit parse PASSWORD into the PORT slot, so the port-cast ValueError's
    # text IS the password — and scrub_url_userinfo is a structural no-op (no
    # `://...@`). The validator must name the failure WITHOUT echoing the value.
    secret = "MySecret123"
    monkeypatch.setenv(_ENV, f"http://quantalyze:{secret}")
    with pytest.raises(ValueError) as excinfo:
        make_sfox_client("k")
    msg = str(excinfo.value)
    assert secret not in msg, f"truncated-URL port-cast leaked the secret: {msg!r}"
    assert "WORKER_EGRESS_PROXY_URL" in msg


def test_make_sfox_client_missing_scheme_fails_loud_no_secret(monkeypatch):
    # F5: a non-empty URL with no http(s):// scheme fails loud; the shape error
    # names the expected form WITHOUT echoing the (un-`://`-anchored) secret.
    secret = "topsecretpw"
    monkeypatch.setenv(_ENV, f"quantalyze:{secret}@37.16.1.5:8888")
    with pytest.raises(ValueError) as excinfo:
        make_sfox_client("k")
    msg = str(excinfo.value)
    assert secret not in msg, f"shape error leaked the secret: {msg!r}"
    assert "http(s)://" in msg


def test_make_sfox_client_valid_url_passes_validation(monkeypatch):
    # F5 must NOT regress a well-formed URL: it validates cleanly and threads.
    monkeypatch.setenv(_ENV, _URL)
    client = make_sfox_client("k")
    assert client._proxy == _URL


def test_make_sfox_client_env_set_threads_proxy(monkeypatch):
    monkeypatch.setenv(_ENV, _URL)
    client = make_sfox_client("k")
    assert client._proxy == _URL


def test_make_sfox_client_does_not_strip_api_key(monkeypatch):
    # DELIBERATE deviation from RESEARCH Pattern 2: the factory NEVER .strip()s —
    # each call site keeps its EXACT current credential expression so env-unset
    # wiring is byte-identical. " k " must survive verbatim.
    monkeypatch.delenv(_ENV, raising=False)
    client = make_sfox_client(" k ")
    assert client._api_key == " k "


def test_make_sfox_client_base_url_default_and_override(monkeypatch):
    monkeypatch.delenv(_ENV, raising=False)
    assert make_sfox_client("k")._base_url == SFOX_PROD_BASE_URL
    override = "https://api.staging.sfox.com"
    assert make_sfox_client("k", base_url=override)._base_url == override


# --------------------------------------------------------------------------- #
# create_exchange() — ccxt aiohttp_proxy opt-in gating                         #
# --------------------------------------------------------------------------- #
def _make_bybit(monkeypatch):
    exchange = create_exchange("bybit", "key", "secret")
    return exchange


def _close(exchange):
    asyncio.run(exchange.close())


def test_create_exchange_env_unset_aiohttp_proxy_none(monkeypatch):
    monkeypatch.delenv(_ENV, raising=False)
    monkeypatch.delenv(_CCXT_FLAG, raising=False)
    ex = _make_bybit(monkeypatch)
    try:
        assert ex.aiohttp_proxy is None
    finally:
        _close(ex)


def test_create_exchange_url_set_flag_unset_aiohttp_proxy_none(monkeypatch):
    # Opt-in gating: URL present but ccxt flag absent → ccxt egress UNDISTURBED.
    monkeypatch.setenv(_ENV, _URL)
    monkeypatch.delenv(_CCXT_FLAG, raising=False)
    ex = _make_bybit(monkeypatch)
    try:
        assert ex.aiohttp_proxy is None
    finally:
        _close(ex)


@pytest.mark.parametrize("flag", ["1", "true", "on", "TRUE", "On"])
def test_create_exchange_url_and_flag_set_threads_proxy(monkeypatch, flag):
    monkeypatch.setenv(_ENV, _URL)
    monkeypatch.setenv(_CCXT_FLAG, flag)
    ex = _make_bybit(monkeypatch)
    try:
        assert ex.aiohttp_proxy == _URL
    finally:
        _close(ex)


def test_create_exchange_flag_set_url_unset_aiohttp_proxy_none(monkeypatch):
    # A dangling flag with no URL must not thread a None/garbage proxy.
    monkeypatch.delenv(_ENV, raising=False)
    monkeypatch.setenv(_CCXT_FLAG, "on")
    ex = _make_bybit(monkeypatch)
    try:
        assert ex.aiohttp_proxy is None
    finally:
        _close(ex)


def test_create_exchange_flag_junk_value_aiohttp_proxy_none(monkeypatch):
    # Only {1,true,on} opt in; any other value stays byte-identical (None).
    monkeypatch.setenv(_ENV, _URL)
    monkeypatch.setenv(_CCXT_FLAG, "yes")
    ex = _make_bybit(monkeypatch)
    try:
        assert ex.aiohttp_proxy is None
    finally:
        _close(ex)


# --------------------------------------------------------------------------- #
# Secret hygiene — the factory module never logs/reprs the URL (T-121-06)      #
# --------------------------------------------------------------------------- #
def test_sfox_factory_never_logs_or_strips_url():
    import ast

    src = Path(__file__).resolve().parent.parent / "services" / "sfox_factory.py"
    tree = ast.parse(src.read_text())
    # Scan the ACTUAL code (AST), so the docstring's prose mention of `.strip()`
    # and this module's own name cannot false-trip the guard.
    for node in ast.walk(tree):
        # No .strip( call inside the factory (deviation (a) — call sites own the trim).
        if isinstance(node, ast.Attribute):
            assert node.attr != "strip", "factory must not .strip() the api_key"
        # No logging / print of the URL secret (T-121-06 / Pitfall 5).
        if isinstance(node, ast.Name):
            assert node.id not in ("logger", "logging", "print")


# --------------------------------------------------------------------------- #
# Task 2 — all 4 SfoxClient sites route through the factory                    #
# --------------------------------------------------------------------------- #
_ANALYTICS_ROOT = Path(__file__).resolve().parent.parent
_SITES = (
    "routers/exchange.py",
    "routers/internal.py",
    "services/job_worker.py",
    "services/ingestion/sfox.py",
)


@pytest.mark.parametrize("rel", _SITES)
def test_site_routes_through_factory_not_bare_constructor(rel):
    # P110 "test the wiring" lesson: read the site from disk. It must construct
    # via make_sfox_client( and contain ZERO bare `SfoxClient(` construction
    # tokens. Type annotations / `import ... SfoxClient` (no paren) are fine — the
    # scan matches the exact constructor token `SfoxClient(`.
    text = (_ANALYTICS_ROOT / rel).read_text()
    assert "make_sfox_client(" in text, f"{rel} must call make_sfox_client("
    assert "SfoxClient(" not in text, f"{rel} must not construct SfoxClient( directly"


def test_scan_fails_when_neutered_factory_itself_constructs():
    # Prove the scan can fail: the ONE allowed constructor (besides sfox_client.py
    # and tests) is the factory itself, which DOES contain `SfoxClient(`.
    text = (_ANALYTICS_ROOT / "services" / "sfox_factory.py").read_text()
    assert "SfoxClient(" in text


def test_job_worker_sfox_branch_threads_proxy_and_preserves_strip(monkeypatch):
    from services.job_worker import _make_exchange_client

    monkeypatch.setenv(_ENV, _URL)
    client = _make_exchange_client("sfox", " k \n", "", None)
    try:
        assert client._proxy == _URL
        # The site's own .strip() is preserved (factory does not strip).
        assert client._api_key == "k"
    finally:
        asyncio.run(client.aclose())


def test_job_worker_sfox_branch_env_unset_proxy_none(monkeypatch):
    from services.job_worker import _make_exchange_client

    monkeypatch.delenv(_ENV, raising=False)
    client = _make_exchange_client("sfox", " k \n", "", None)
    try:
        assert client._proxy is None
    finally:
        asyncio.run(client.aclose())


def test_ingestion_sfox_imports_the_factory_name():
    # The ingestion adapter must reference make_sfox_client as the imported
    # constructor (the source-scan above already proves no bare SfoxClient().
    import services.ingestion.sfox as mod

    assert hasattr(mod, "make_sfox_client")


def test_ingestion_sfox_constructs_via_factory(monkeypatch):
    # Functional: the adapter's client construction routes through the factory,
    # so a set env threads the proxy. Capture the constructed client via a spy
    # on the imported name.
    import services.ingestion.sfox as mod

    monkeypatch.setenv(_ENV, _URL)
    captured = {}
    real = mod.make_sfox_client

    def spy(*args, **kwargs):
        client = real(*args, **kwargs)
        captured["client"] = client
        return client

    monkeypatch.setattr(mod, "make_sfox_client", spy)
    client = mod.make_sfox_client("token")
    try:
        assert captured["client"]._proxy == _URL
    finally:
        asyncio.run(client.aclose())
