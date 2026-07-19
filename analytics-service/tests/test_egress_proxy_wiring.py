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
