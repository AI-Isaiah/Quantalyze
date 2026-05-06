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
    REDACTED,
    REDACTED_JWT,
    scrub_freeform_string,
    scrub_pii,
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
    # Pass 1 — SENSITIVE_KEY_VALUE redacts the secret value.
    out = scrub_freeform_string("Authorization: Bearer abc")
    # Pass 1 catches `authorization: ...` and replaces value with [REDACTED].
    assert "abc" not in out
    assert REDACTED in out


def test_scrub_freeform_string_jwt_embedded():
    # Pass 3 — JWT_SUBSTRING redacts an embedded JWT shape mid-string.
    line = "Header: aaaaaaaaaa.bbbbbbbbbb.cccccccccc end"
    out = scrub_freeform_string(line)
    assert "aaaaaaaaaa.bbbbbbbbbb.cccccccccc" not in out
    assert REDACTED_JWT in out


# ---------------------------------------------------------------------------
# Test 13: leaf-module invariant — anchored regex per Adversarial revision W4
# ---------------------------------------------------------------------------


def test_no_external_imports():
    """redact.py must import ONLY from `__future__`, `re`, `typing`.

    Adversarial revision 2026-05-06 (W4): use anchored regex (re.M, line-start)
    so a comment like `# from services.foo` does not produce a false negative.
    """
    text = (
        Path(__file__).resolve().parents[1] / "services" / "redact.py"
    ).read_text()

    # Hard bans (anchored).
    assert "import sentry_sdk" not in text
    assert "import structlog" not in text
    assert not re.search(r"^\s*from services\.", text, re.M), (
        "redact.py must not import any sibling services.* module (leaf-module invariant)"
    )

    # Whitelist every actual `import ` / `from ` line.
    allowed_prefixes = (
        "from __future__",
        "import re",
        "from typing",
    )
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("import ") or stripped.startswith("from "):
            assert any(stripped.startswith(p) for p in allowed_prefixes), (
                f"unexpected import in redact.py: {stripped!r}"
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
        assert len(CORPUS["good"]) == 5

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
