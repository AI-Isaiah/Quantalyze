/**
 * Phase 18 / FIX-04 — TS ↔ Python denylist parity test.
 *
 * Pattern: tests/a11y/chart-contrast.test.ts — read sibling file via
 * fs.readFileSync, assert content invariants, NO AST parsing, NO Python
 * execution. Drift-prevention only.
 *
 * Why this test exists:
 *   src/lib/admin/pii-scrub.ts (TypeScript, used in Next.js admin pages)
 *   and analytics-service/services/redact.py (Python, used in Sentry
 *   before_send + structlog processor + audit.py wire-ups) MUST share
 *   the same denylist. Without a parity test, future TS additions silently
 *   diverge from Python and credential-shaped data leaks through one runtime.
 *
 * Pitfall 5 (18-RESEARCH.md): TS regex extraction is fragile. Guard with a
 * minimum-count assertion (>= 17) so silent regex failure is loud.
 *
 * Adversarial revision 2026-05-06:
 *   - W3: use quote-style insensitive matchers (/["']<key>["']/) instead
 *         of toContain('"<key>"') — Python frozenset literals can be
 *         spelled with either single or double quotes.
 *   - Grok B1: minimum-count post-promotion is 17 (was 11), reflecting the
 *         6 broker-quirk keys added to the canonical denylist
 *         (x-bapi-apikey, x-bapi-sign, x-bapi-signature, ok-access-passphrase,
 *         ok-access-key, ok-access-timestamp).
 *   - W4: leaf-module test uses anchored regex (^\\s*from services\\.) to
 *         avoid false-negatives on docstring lines mentioning "from services."
 *         in prose.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { scrubFreeformString } from "@/lib/admin/pii-scrub";

const TS_FILE = resolve(process.cwd(), "src/lib/admin/pii-scrub.ts");
const PY_FILE = resolve(
  process.cwd(),
  "analytics-service/services/redact.py",
);

describe("redact.py mirrors pii-scrub.ts denylist verbatim", () => {
  it("every TS DENYLIST_EXACT key appears verbatim in redact.py text", () => {
    const ts = readFileSync(TS_FILE, "utf8");
    const py = readFileSync(PY_FILE, "utf8");

    // Extract the DENYLIST_EXACT block from the TS source. Note the [\s\S]*?
    // non-greedy match so we don't sweep past the closing ]).
    const blockMatch = ts.match(
      /DENYLIST_EXACT\s*=\s*new Set<string>\(\[([\s\S]*?)\]\)/,
    );
    expect(
      blockMatch,
      "TS DENYLIST_EXACT block must be parseable",
    ).not.toBeNull();
    const keys = [...blockMatch![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);

    // Pitfall 5 — silent regex-extraction failure guard.
    // Adversarial revision 2026-05-06: Grok B1 — minimum bumped from 11 to 17
    // (6 broker-quirk keys promoted to canonical).
    expect(
      keys.length,
      "must extract at least 17 keys (canonical set after Grok B1 promotion)",
    ).toBeGreaterThanOrEqual(17);

    for (const key of keys) {
      // Adversarial revision W3 — quote-style insensitive (Python may use
      // " or ' for frozenset string literals).
      const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      expect(
        py,
        `redact.py must contain literal ${JSON.stringify(key)} (any quote style)`,
      ).toMatch(new RegExp(`["']${escaped}["']`));
    }
  });

  it("DENYLIST_PREFIX (sb-ec-) appears verbatim in redact.py", () => {
    const py = readFileSync(PY_FILE, "utf8");
    // Adversarial revision W3 — quote-style insensitive.
    expect(py).toMatch(/["']sb-ec-["']/);
  });

  it("JWT_SHAPE anchored regex appears verbatim in redact.py", () => {
    const py = readFileSync(PY_FILE, "utf8");
    expect(py).toContain(
      "^[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$",
    );
  });

  it("JWT_SUBSTRING regex appears verbatim in redact.py", () => {
    const py = readFileSync(PY_FILE, "utf8");
    expect(py).toContain(
      "[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}",
    );
  });

  // Phase 18 / WR-01 fix — `scrubFreeformString` parity corpus. Earlier
  // versions of this file only checked denylist key strings appeared in
  // the Python text, which silently missed the TS↔Python 3-pass-vs-4-pass
  // semantic drift. These cases assert the TS implementation now performs
  // the same transitive re-walk that `redact.py::scrub_freeform_string`
  // already runs as Pass 4 (Grok B1 secondary).
  //
  // Each case: input → expected post-redaction substring assertions.
  // The Python side covers the same shape via
  // `test_scrub_freeform_string_transitive_match` in test_redact.py.
  describe("scrubFreeformString TS↔Python behavioral parity (WR-01)", () => {
    it("redacts both api_key occurrences across newline (transitive shape)", () => {
      const out = scrubFreeformString("api_key=abc123\napi_key=def456");
      expect(out).not.toContain("abc123");
      expect(out).not.toContain("def456");
      // Both redactions visible — Pass 1 catches one, Pass 4 catches the
      // other if Pass 1's lazy match left it (depends on the regex's
      // global flag handling). Either way, no plaintext leaks.
      const redactedCount = (out.match(/\[REDACTED\]/g) ?? []).length;
      expect(redactedCount).toBeGreaterThanOrEqual(2);
    });

    it("redacts the value when key:value precedes a JWT shape", () => {
      const jwt =
        "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
      const out = scrubFreeformString(`token=secretXYZ ${jwt}`);
      expect(out).not.toContain("secretXYZ");
      expect(out).not.toContain(jwt);
      expect(out).toContain("[REDACTED]");
      expect(out).toContain("[REDACTED_JWT]");
    });

    it("preserves benign multi-line strings unchanged", () => {
      const benign = "Sharpe: 1.2\nMax DD: -8%\nstrategy_id=abc";
      const out = scrubFreeformString(benign);
      expect(out).toBe(benign);
    });

    it("redacts multiple distinct denylist key shapes on the same line", () => {
      const out = scrubFreeformString(
        "api_key=AAAA passphrase=BBBB ok-access-sign=CCCC",
      );
      expect(out).not.toContain("AAAA");
      expect(out).not.toContain("BBBB");
      expect(out).not.toContain("CCCC");
      const redactedCount = (out.match(/\[REDACTED\]/g) ?? []).length;
      expect(redactedCount).toBeGreaterThanOrEqual(3);
    });

    it("idempotent — running twice produces the same output", () => {
      const input = "api_key=abc123\napi_key=def456";
      const once = scrubFreeformString(input);
      const twice = scrubFreeformString(once);
      expect(once).toBe(twice);
    });

    // Phase 18 / A2 (Claude adversarial 2026-05-07) — earlier versions of
    // this test only checked DENYLIST_EXACT keys appeared in `redact.py` as
    // text. That left a real drift class invisible: a key in the frozenset
    // but absent from `SENSITIVE_KEY_VALUE` would pass the textual check
    // while leaking through `scrub_freeform_string`. The cases below
    // exercise EVERY canonical denylist key as a freeform `<key>: SECRET`
    // shape on the TS side. The Python mirror is covered by the new
    // `test_scrub_freeform_string_covers_every_denylist_key` case in
    // `analytics-service/tests/test_redact.py`.
    it("scrubFreeformString redacts EVERY canonical DENYLIST_EXACT key in freeform shape", () => {
      const ts = readFileSync(TS_FILE, "utf8");
      const blockMatch = ts.match(
        /DENYLIST_EXACT\s*=\s*new Set<string>\(\[([\s\S]*?)\]\)/,
      );
      expect(blockMatch).not.toBeNull();
      const keys = [...blockMatch![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
      expect(keys.length).toBeGreaterThanOrEqual(17);

      const sentinel = "SENTINEL_SECRET_VALUE_42";
      for (const key of keys) {
        const colon = scrubFreeformString(`${key}: ${sentinel}`);
        expect(
          colon,
          `'${key}: <secret>' must redact the value`,
        ).not.toContain(sentinel);
        const equals = scrubFreeformString(`${key}=${sentinel}`);
        expect(
          equals,
          `'${key}=<secret>' must redact the value`,
        ).not.toContain(sentinel);
      }
    });

    it("scrubFreeformString redacts DENYLIST_PREFIX (sb-ec-) freeform shape", () => {
      const sentinel = "SENTINEL_SECRET_VALUE_43";
      const out = scrubFreeformString(`sb-ec-something=${sentinel}`);
      expect(out).not.toContain(sentinel);
    });
  });

  it("redact.py is a leaf module (no sentry_sdk / structlog / services.* sibling imports)", () => {
    const py = readFileSync(PY_FILE, "utf8");
    expect(py, "redact.py must NOT import sentry_sdk").not.toMatch(
      /^import sentry_sdk\b/m,
    );
    expect(py, "redact.py must NOT import from sentry_sdk").not.toMatch(
      /^from sentry_sdk\b/m,
    );
    expect(py, "redact.py must NOT import structlog").not.toMatch(
      /^import structlog\b/m,
    );
    expect(py, "redact.py must NOT import from structlog").not.toMatch(
      /^from structlog\b/m,
    );
    // Adversarial revision W4 — anchored regex (line-start) avoids false
    // negatives on prose / docstring lines that mention "from services.X" inline.
    expect(py, "redact.py must NOT import sibling services.*").not.toMatch(
      /^from services\./m,
    );
  });
});
