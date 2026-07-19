"""Phase 18 / FIX-04 — pytest coverage for analytics-service/services/redact.py.

This module mirrors src/lib/admin/pii-scrub.ts byte-for-byte at the API layer.
The TS test (src/lib/admin/pii-scrub.test.ts) already covers the same shapes;
this file enforces parity on the Python side, including:

  - Tests 1-12  : core scrub_pii / truncate_account_id / scrub_freeform_string semantics
  - Test 13     : leaf-module invariant (no sentry_sdk / structlog / services.* imports)
                  — anchored regex per Adversarial revision W4
  - Test 14     : broker-quirk Bybit/OKX header keys (Adversarial revision Grok B1)
  - Test 15     : recursion guard via max_depth (Adversarial revision Grok W3)
  - Test 16     : transitive re-walk in scrub_freeform_string (Grok B1 secondary)
  - TestSharedCorpus : loads tests/fixtures/redact-corpus.json — same fixture as
                       Vitest's "Shared corpus — TS side" describe block
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from services.redact import (
    DENYLIST_EXACT,
    DENYLIST_PREFIX,
    JWT_SHAPE,
    JWT_SUBSTRING,
    SENSITIVE_KEY_VALUE,
    URL_USERINFO,
    REDACTED,
    REDACTED_JWT,
    scrub_freeform_string,
    scrub_pii,
    scrub_url_userinfo,
    truncate_account_id,
)


# ---------------------------------------------------------------------------
# Test 1-12: core API surface
# ---------------------------------------------------------------------------


def test_scrub_pii_redacts_apikey():
    out = scrub_pii({"apiKey": "secret123"})
    assert out == {"apiKey": REDACTED}


def test_scrub_pii_case_insensitive():
    out = scrub_pii({"APIKEY": "x", "Api_Key": "y"})
    assert out["APIKEY"] == REDACTED
    assert out["Api_Key"] == REDACTED


def test_scrub_pii_recursive():
    out = scrub_pii({"outer": {"secret": "x"}})
    assert out == {"outer": {"secret": REDACTED}}


def test_scrub_pii_jwt_whole_string():
    # Whole-string JWT: 3 base64url segments, anchored.
    jwt = "aaaaaaaaaa.bbbbbbbbbb.cccccccccc"
    assert scrub_pii(jwt) == REDACTED_JWT


def test_scrub_pii_passes_non_jwt_string():
    assert scrub_pii("Mary Smith") == "Mary Smith"


def test_scrub_pii_arrays():
    out = scrub_pii([{"secret": "x"}, "y"])
    assert out == [{"secret": REDACTED}, "y"]


def test_scrub_pii_prefix_denylist():
    out = scrub_pii({"sb-ec-cookie": "x"})
    assert out == {"sb-ec-cookie": REDACTED}


def test_truncate_account_id_long():
    assert truncate_account_id("abcdef1234") == "***1234"


def test_truncate_account_id_short():
    assert truncate_account_id("abc") == "abc"
    assert truncate_account_id("") == ""
    assert truncate_account_id("1234567") == "1234567"


def test_truncate_account_id_non_string():
    # Defensive: must pass non-strings through unchanged (mirrors TS behavior).
    assert truncate_account_id(123) == 123  # type: ignore[arg-type]
    assert truncate_account_id(None) is None  # type: ignore[arg-type]


def test_scrub_freeform_string_key_value():
    # Pass 1 — SENSITIVE_KEY_VALUE captures `key: value` shapes. For
    # `apikey: SECRET_VALUE_ABC`, the value is captured up to the next
    # whitespace and replaced with [REDACTED].
    secret = "SECRET_VALUE_ABC123"
    out = scrub_freeform_string(f"apikey: {secret}")
    assert secret not in out
    assert REDACTED in out

    # Verify the same shape across multiple denylisted keys (parity with
    # the TS test's KEY_SHAPES table at pii-scrub.test.ts L168-185).
    for line in (
        f"api_key: {secret}",
        f"api_secret: {secret}",
        f"x-mbx-apikey: {secret}",
        f"ok-access-sign:{secret}",
        f"passphrase={secret}",
        f"token: {secret}",
        f"authorization: {secret}",
    ):
        out = scrub_freeform_string(line)
        assert secret not in out, f"line {line!r} leaked secret in {out!r}"
        assert REDACTED in out


def test_scrub_freeform_string_compound_credential_keys():
    """CR-1 regression: compound keys with a `[a-z0-9]_` prefix (client_secret,
    access_token, db_password, x-api-key) must be redacted.

    The bare `secret`/`token` alternates only matched at a `\\b` word boundary,
    which the underscore/hyphen prefix suppressed — so `client_secret=VALUE`
    leaked while `signature=VALUE` was caught. This asserts the whole CLASS is
    closed. Values are obviously-synthetic (gitleaks-safe).
    """
    secret = "SYNTHETIC_NOT_A_REAL_SECRET_00000"
    compound_lines = (
        f"client_secret={secret}",
        f"client_secret: {secret}",
        f"access_token={secret}",
        f"refresh_token: {secret}",
        f"db_password={secret}",
        f"aws_secret={secret}",
        f"x-api-key: {secret}",
        # Re-verify caveat A: CONCATENATED spellings (no separator) were covered
        # by the old `api[-_]?secret` alternate and must stay covered — the new
        # prefixed-class alternate alone requires a separator and misses these.
        f"apisecret={secret}",
        f"apiSecret: {secret}",
    )
    for line in compound_lines:
        out = scrub_freeform_string(line)
        assert secret not in out, f"compound key line {line!r} leaked secret: {out!r}"
        assert REDACTED in out, f"compound key line {line!r} not redacted: {out!r}"

    # Guard against over-redaction: a bare `key: value` benign log line must NOT
    # be swallowed (we only generalized `key` behind the `api` anchor).
    benign = scrub_freeform_string("sort key: name")
    assert "name" in benign, f"benign 'sort key' line over-redacted: {benign!r}"


def test_scrub_freeform_string_jwt_embedded():
    # Pass 3 — JWT_SUBSTRING redacts an embedded JWT shape mid-string.
    line = "Header: aaaaaaaaaa.bbbbbbbbbb.cccccccccc end"
    out = scrub_freeform_string(line)
    assert "aaaaaaaaaa.bbbbbbbbbb.cccccccccc" not in out
    assert REDACTED_JWT in out


# ---------------------------------------------------------------------------
# Phase 121 / F1 — URL userinfo (proxy BasicAuth) redaction (secret-leak class)
# ---------------------------------------------------------------------------


def test_scrub_url_userinfo_redacts_proxy_basicauth():
    """The F1 red-team case: a raw proxy URL with BasicAuth userinfo must have the
    `user:pass@` stripped. `SENSITIVE_KEY_VALUE` + the JWT detector are both blind
    to this shape, so before F1 the proxy secret rode `str(exc)` verbatim."""
    url = "http://quantalyze:deadbeefcafe@37.16.1.5:8888"
    out = scrub_url_userinfo(url)
    assert "deadbeefcafe" not in out
    assert "quantalyze" not in out
    assert out == "http://[REDACTED]@37.16.1.5:8888"


def test_scrub_freeform_string_redacts_proxy_url_userinfo():
    """The class fix must apply inside scrub_freeform_string so EVERY str(exc)
    scrub (SfoxApiError, ccxt NetworkError logs, Sentry exc value) catches it."""
    secret = "deadbeefcafe"
    for line in (
        f"http://quantalyze:{secret}@37.16.1.5:8888",
        f"InvalidURL('http://quantalyze:{secret}@37.16.1.5:88x8')",
        f"Cannot connect to proxy https://user:{secret}@10.0.0.1:8888 ssl:default",
    ):
        out = scrub_freeform_string(line)
        assert secret not in out, f"line {line!r} leaked proxy secret: {out!r}"
        assert "[REDACTED]" in out


def test_scrub_freeform_string_redacts_ccxt_networkerror_with_proxy():
    """F1 closes the create_exchange ccxt path by value: validate_key_permissions
    already routes every str(exc) through scrub_freeform_string, so a proxy-bearing
    ccxt.NetworkError message is now userinfo-redacted with no exchange.py change."""
    msg = "bybit GET https://api.bybit.com via proxy http://quantalyze:s3cr3tpw@1.2.3.4:8888 failed"
    out = scrub_freeform_string(msg)
    assert "s3cr3tpw" not in out
    assert "[REDACTED]" in out


def test_scrub_url_userinfo_leaves_benign_urls_untouched():
    """No `scheme://...@` userinfo → byte-identical passthrough (no over-redaction)."""
    for benign in (
        "https://api.sfox.com/v1/user/balance",
        "http://37.16.1.5:8888",
        "GET https://api.bybit.com/v5/market/time 200",
    ):
        assert scrub_url_userinfo(benign) == benign


def test_scrub_url_userinfo_redacts_password_only_userinfo():
    """Specialist finding (MED): a PASSWORD-ONLY userinfo `scheme://:secret@host`
    (the common token-as-password proxy form) must also redact. The username
    sub-pattern was `+` (≥1 char), so an empty username made the whole regex fail
    to match and the proxy password rode `str(exc)` verbatim — a real secret leak."""
    for url, expected in (
        ("http://:s3cr3tpw@egress.host:8080", "http://[REDACTED]@egress.host:8080"),
        ("socks5://:tokvalue@10.0.0.1:1080", "socks5://[REDACTED]@10.0.0.1:1080"),
    ):
        out = scrub_url_userinfo(url)
        assert "s3cr3tpw" not in out and "tokvalue" not in out
        assert out == expected
    # And through the freeform scrub (the surface that actually echoes str(exc)).
    assert "s3cr3tpw" not in scrub_freeform_string(
        "InvalidURL('http://:s3cr3tpw@egress.host:80x80')"
    )


def test_scrub_url_userinfo_redacts_password_containing_at_sign():
    """Red-team finding (MED): a password CONTAINING '@' (`user:p@ss@host`). urlsplit
    splits userinfo at the LAST '@', so validation accepts it and the URL is used;
    a single-'@' terminator in the scrub stopped at the FIRST '@' and leaked the
    tail. The userinfo must be consumed whole, up to the last '@' before the host."""
    for url, expected in (
        ("http://user:p@ssw0rd@37.16.1.5:8888", "http://[REDACTED]@37.16.1.5:8888"),
        ("http://quantalyze:a@b@c@10.0.0.1:8888", "http://[REDACTED]@10.0.0.1:8888"),
    ):
        out = scrub_url_userinfo(url)
        assert "ssw0rd" not in out and "a@b@c" not in out
        assert out == expected
    assert "ssw0rd" not in scrub_freeform_string(
        "Cannot connect to proxy http://user:p@ssw0rd@37.16.1.5:8888 ssl:default"
    )


def test_scrub_url_userinfo_non_string_passthrough():
    assert scrub_url_userinfo(None) is None
    assert scrub_url_userinfo(42) == 42


def test_url_userinfo_pattern_compiled():
    assert URL_USERINFO.search("http://u:p@h:1") is not None
    assert URL_USERINFO.search("https://example.com/path") is None


# ---------------------------------------------------------------------------
# Test 13: leaf-module invariant — anchored regex per Adversarial revision W4
# ---------------------------------------------------------------------------


def test_no_external_imports():
    """redact.py must import ONLY from `__future__`, `re`, `typing`.

    Adversarial revision 2026-05-06 (W4): use ast parsing so docstring prose
    mentioning the words "import sentry_sdk" / "import this module" does NOT
    produce false negatives. ast walks ONLY actual import statements.
    """
    import ast

    text = (
        Path(__file__).resolve().parents[1] / "services" / "redact.py"
    ).read_text()

    # Anchored regex sanity-check (W4) — line-start matches; prose in
    # docstrings (e.g., "NEVER import sentry_sdk,") is filtered out by the
    # `^\s*` anchor since docstring lines never start with `import ` at column 0.
    assert not re.search(r"^import sentry_sdk\b", text, re.M)
    assert not re.search(r"^from sentry_sdk\b", text, re.M)
    assert not re.search(r"^import structlog\b", text, re.M)
    assert not re.search(r"^from structlog\b", text, re.M)
    assert not re.search(r"^from services\.", text, re.M), (
        "redact.py must not import any sibling services.* module (leaf-module invariant)"
    )

    # AST-level whitelist — every actual import node is checked.
    allowed_modules = {"__future__", "re", "typing"}
    tree = ast.parse(text)
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                root = alias.name.split(".")[0]
                assert root in allowed_modules, (
                    f"unexpected import: {alias.name!r} (allowed roots: {allowed_modules})"
                )
        elif isinstance(node, ast.ImportFrom):
            root = (node.module or "").split(".")[0]
            assert root in allowed_modules, (
                f"unexpected from-import: {node.module!r} (allowed roots: {allowed_modules})"
            )
            assert root != "services", (
                "redact.py must not import sibling services.* module"
            )


# ---------------------------------------------------------------------------
# Test 14: broker-quirk header keys — Adversarial revision Grok B1
# ---------------------------------------------------------------------------


def test_scrub_pii_broker_quirk_headers():
    """Bybit + OKX broker-quirk header keys must be redacted (Grok B1)."""
    headers = {
        "x-bapi-apikey": "a",
        "x-bapi-sign": "b",
        "x-bapi-signature": "b2",
        "ok-access-passphrase": "c",
        "ok-access-key": "d",
        "ok-access-timestamp": "e",
        "x-harmless": "ok",
    }
    out = scrub_pii({"headers": headers})
    inner = out["headers"]
    assert inner["x-bapi-apikey"] == REDACTED
    assert inner["x-bapi-sign"] == REDACTED
    assert inner["x-bapi-signature"] == REDACTED
    assert inner["ok-access-passphrase"] == REDACTED
    assert inner["ok-access-key"] == REDACTED
    assert inner["ok-access-timestamp"] == REDACTED
    assert inner["x-harmless"] == "ok"


def test_denylist_contains_all_canonical_keys():
    """All 17 canonical denylist keys (11 original + 6 Grok B1) must be present."""
    expected = {
        "apikey", "apisecret", "api_key", "api_secret",
        "secret", "signature", "passphrase", "authorization",
        "x-mbx-apikey", "ok-access-sign", "x-internal-token",
        # Grok B1 promotions
        "x-bapi-apikey", "x-bapi-sign", "x-bapi-signature",
        "ok-access-passphrase", "ok-access-key", "ok-access-timestamp",
    }
    assert expected.issubset(DENYLIST_EXACT), (
        f"missing keys: {expected - set(DENYLIST_EXACT)}"
    )
    assert "sb-ec-" in DENYLIST_PREFIX


# ---------------------------------------------------------------------------
# Phase 18 / A2 (Claude adversarial 2026-05-07) — freeform-redaction parity.
# The textual-presence parity check (TS side) only verified DENYLIST_EXACT
# entries appeared in the Python file. It missed a real drift class: a key
# in the frozenset but absent from `SENSITIVE_KEY_VALUE` regex. The case
# below exercises EVERY canonical denylist key as a freeform `<key>: SECRET`
# shape so a freeform-redaction gap can never re-emerge.
# ---------------------------------------------------------------------------


def test_scrub_freeform_string_covers_every_denylist_key():
    """Each canonical key + the sb-ec- prefix must redact the value in
    freeform `<key>: SECRET` and `<key>=SECRET` shapes."""
    sentinel = "SENTINEL_SECRET_VALUE_42"
    for key in DENYLIST_EXACT:
        colon = scrub_freeform_string(f"{key}: {sentinel}")
        assert sentinel not in colon, (
            f"freeform '{key}: SECRET' leaked secret (output: {colon!r})"
        )
        equals = scrub_freeform_string(f"{key}={sentinel}")
        assert sentinel not in equals, (
            f"freeform '{key}=SECRET' leaked secret (output: {equals!r})"
        )
    # DENYLIST_PREFIX
    prefix_out = scrub_freeform_string(f"sb-ec-something={sentinel}")
    assert sentinel not in prefix_out, (
        f"freeform 'sb-ec-...=SECRET' leaked secret (output: {prefix_out!r})"
    )


# ---------------------------------------------------------------------------
# Test 15: recursion guard — Adversarial revision Grok W3
# ---------------------------------------------------------------------------


def test_scrub_pii_recursion_guard():
    """Build a 200-deep nested dict; max_depth=100 must raise; max_depth=300 succeeds."""
    def deep(n: int) -> dict:
        d: dict = {"leaf": "x"}
        for _ in range(n):
            d = {"nested": d}
        return d

    nested_200 = deep(200)
    with pytest.raises(RecursionError):
        scrub_pii(nested_200, max_depth=100)

    # With a higher cap, it should succeed.
    out = scrub_pii(nested_200, max_depth=300)
    assert isinstance(out, dict)


# ---------------------------------------------------------------------------
# Test 16: scrub_freeform_string transitive re-walk — Grok B1 secondary
# ---------------------------------------------------------------------------


def test_scrub_freeform_string_transitive_match():
    """Multiple key-value occurrences on separate lines all get redacted."""
    line = "api_key=abc123\napi_key=def456"
    out = scrub_freeform_string(line)
    assert "abc123" not in out
    assert "def456" not in out
    # Both api_key occurrences should still be visible (only values redacted).
    assert out.count(REDACTED) >= 2


def test_scrub_freeform_string_passes_benign_strings():
    assert scrub_freeform_string("Step one.") == "Step one."
    assert scrub_freeform_string("") == ""
    # Two-segment dotted strings are NOT JWT-shaped (anchored requires 3 segments).
    assert scrub_freeform_string("foo.bar") == "foo.bar"


# ---------------------------------------------------------------------------
# Test 17: TS↔Python parity on null/None inputs (Phase 18 / WR-06)
# ---------------------------------------------------------------------------


def test_scrub_pii_passes_none_unchanged():
    """Mirror of pii-scrub.test.ts L155-158 — TS asserts both null and undefined
    pass through unchanged; Python has no `undefined`, but `None` covers the same
    semantic. Without this assertion, a future Python refactor that drops the
    `if value is None: return value` guard would silently break admin pages
    rendering `mandate_context: None` blobs.
    """
    assert scrub_pii(None) is None
    # Round-trip via list/dict containers.
    assert scrub_pii([None, "ok"]) == [None, "ok"]
    assert scrub_pii({"k": None}) == {"k": None}


def test_scrub_freeform_string_passes_non_strings_unchanged():
    """Mirror of pii-scrub.ts scrubFreeformString's non-string guard."""
    # The Python implementation's `if not isinstance(s, str)` guard returns
    # the input unchanged for any non-string. Asserts None and int round-trip.
    assert scrub_freeform_string(None) is None
    assert scrub_freeform_string(42) == 42


# ---------------------------------------------------------------------------
# Constants smoke checks — ensure regex objects compiled correctly.
# ---------------------------------------------------------------------------


def test_jwt_shape_compiled_correctly():
    assert JWT_SHAPE.match("aaa.bbb.ccc") is not None
    assert JWT_SHAPE.match("aaa.bbb") is None
    assert JWT_SHAPE.match("not-a-jwt") is None


def test_jwt_substring_compiled_correctly():
    matches = JWT_SUBSTRING.findall("xxx aaaaaaaaaa.bbbbbbbbbb.cccccccccc yyy")
    assert len(matches) == 1


def test_sensitive_key_value_case_insensitive():
    out = SENSITIVE_KEY_VALUE.sub("X", "API_KEY: secret_val")
    # Whole match replaced with X — value is no longer present.
    assert "secret_val" not in out


# ---------------------------------------------------------------------------
# TestSharedCorpus — the same fixture used by Vitest's TS-side describe block
# ---------------------------------------------------------------------------

CORPUS_PATH = (
    Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "redact-corpus.json"
)
CORPUS = json.loads(CORPUS_PATH.read_text())


class TestSharedCorpus:
    """Loads tests/fixtures/redact-corpus.json — must be the SAME fixture
    consumed by src/lib/admin/pii-scrub.test.ts (TS-side describe block)."""

    def test_corpus_shape(self):
        assert len(CORPUS["bad"]) == 20
        # Phase 18 / WR-06: 6th good-case ("null value passes through")
        # added so this class asserts null-input parity on BOTH runtimes.
        assert len(CORPUS["good"]) == 6

    def test_bad_samples_redacted(self):
        for sample in CORPUS["bad"]:
            out = scrub_pii(sample["input"])
            json_out = json.dumps(out)

            if sample.get("expectRedactedKeys"):
                for key in sample["expectRedactedKeys"]:
                    needle = f'"{key}": "{REDACTED}"'
                    # Allow either pretty or compact JSON — also accept compact form.
                    compact = f'"{key}":"{REDACTED}"'
                    assert needle in json_out or compact in json_out, (
                        f"sample {sample['name']!r}: expected key {key!r} "
                        f"to be redacted; got {json_out}"
                    )

            if sample.get("expectJwtRedacted"):
                # Whole-string JWT redaction returns the literal token.
                assert (
                    REDACTED_JWT in json_out or REDACTED in json_out
                ), f"sample {sample['name']!r}: expected JWT redaction in {json_out}"

            if sample.get("expectFreeformJwtRedacted"):
                # A nested JWT-shaped freeform string. scrub_pii's anchored
                # regex catches whole-string matches inside dict values too.
                assert (
                    REDACTED_JWT in json_out
                ), f"sample {sample['name']!r}: expected freeform JWT redaction in {json_out}"

    def test_good_samples_unchanged(self):
        for sample in CORPUS["good"]:
            out = scrub_pii(sample["input"])
            assert out == sample["input"], (
                f"sample {sample['name']!r}: round-trip changed: "
                f"in={sample['input']!r} out={out!r}"
            )
