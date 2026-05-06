import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { scrubPii, scrubFreeformString, truncateAccountId } from "./pii-scrub";

/**
 * 20 known-bad samples that MUST be redacted. Mix of direct key hits,
 * nested key hits, prefix matches (sb-ec-*), and JWT-shaped strings.
 *
 * 5 known-good samples that MUST NOT be redacted. Regular strings,
 * numbers, names — normal contact_requests payload shapes.
 *
 * A failure in either list means the walker regressed on the contract
 * the /admin/intros page relies on.
 */

describe("scrubPii — denylist samples", () => {
  const BAD_SAMPLES: Array<{ name: string; input: unknown; expectRedactedKeys?: string[]; expectJwtRedacted?: boolean }> = [
    // 1-8: exact key hits at the top level (case-insensitive)
    { name: "apiKey top-level", input: { apiKey: "abc123secret" }, expectRedactedKeys: ["apiKey"] },
    { name: "APIKEY uppercase", input: { APIKEY: "abc123secret" }, expectRedactedKeys: ["APIKEY"] },
    { name: "apiSecret", input: { apiSecret: "s3cr3tvalue" }, expectRedactedKeys: ["apiSecret"] },
    { name: "secret", input: { secret: "very-secret" }, expectRedactedKeys: ["secret"] },
    { name: "signature", input: { signature: "hmac-sig-xyz" }, expectRedactedKeys: ["signature"] },
    { name: "passphrase", input: { passphrase: "my pass phrase" }, expectRedactedKeys: ["passphrase"] },
    { name: "Authorization header", input: { Authorization: "Bearer tok" }, expectRedactedKeys: ["Authorization"] },
    { name: "X-MBX-APIKEY Binance", input: { "X-MBX-APIKEY": "binance-key-abc" }, expectRedactedKeys: ["X-MBX-APIKEY"] },

    // 9-10: OK-ACCESS-SIGN and case variants
    { name: "OK-ACCESS-SIGN OKX", input: { "OK-ACCESS-SIGN": "okx-sig-xyz" }, expectRedactedKeys: ["OK-ACCESS-SIGN"] },
    { name: "ok-access-sign lowercase", input: { "ok-access-sign": "okx-sig-low" }, expectRedactedKeys: ["ok-access-sign"] },

    // 11-12: sb-ec-* prefix
    { name: "sb-ec- cookie prefix", input: { "sb-ec-token": "supabase-tok-abc" }, expectRedactedKeys: ["sb-ec-token"] },
    { name: "sb-ec-AUTH prefix", input: { "sb-ec-Auth": "sbec-token-2" }, expectRedactedKeys: ["sb-ec-Auth"] },

    // 13-15: nested key hits
    {
      name: "nested apiKey inside object",
      input: { outer: { apiKey: "deep-secret" } },
      expectRedactedKeys: ["apiKey"],
    },
    {
      name: "deeply nested passphrase (3 levels)",
      input: { a: { b: { c: { passphrase: "deep-pass" } } } },
      expectRedactedKeys: ["passphrase"],
    },
    {
      name: "array of creds",
      input: [{ secret: "one" }, { secret: "two" }],
      expectRedactedKeys: ["secret"],
    },

    // 16-20: JWT-shaped strings at various positions
    {
      name: "JWT-shaped string as bare value",
      input: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
      expectJwtRedacted: true,
    },
    {
      name: "JWT embedded in payload.token",
      input: { token: "abc.def.ghijk_MNO123" },
      expectJwtRedacted: true,
    },
    {
      name: "JWT in array element",
      input: ["harmless", "xxx.yyy.zzz", 42],
      expectJwtRedacted: true,
    },
    {
      name: "JWT nested inside array of objects",
      input: [{ bearer: "AAA.BBB.CCC" }],
      expectJwtRedacted: true,
    },
    {
      name: "mixed: sb-ec prefix + nested JWT",
      input: { "sb-ec-session": "raw-cookie", inner: { tok: "111.222.333" } },
      expectRedactedKeys: ["sb-ec-session"],
      expectJwtRedacted: true,
    },
  ];

  it("redacts all 20 known-bad samples", () => {
    expect(BAD_SAMPLES).toHaveLength(20);
    for (const sample of BAD_SAMPLES) {
      const out = scrubPii(sample.input);
      const json = JSON.stringify(out);

      if (sample.expectRedactedKeys) {
        for (const key of sample.expectRedactedKeys) {
          // The key should still be present (we preserve shape), but its
          // value must have become "[REDACTED]".
          const search = `"${key}":"[REDACTED]"`;
          expect(json, `sample "${sample.name}": expected ${search} in ${json}`).toContain(search);
        }
      }

      if (sample.expectJwtRedacted) {
        expect(
          json.includes("[REDACTED_JWT]") || json.includes("[REDACTED]"),
          `sample "${sample.name}": expected a JWT redaction in ${json}`,
        ).toBe(true);
      }

      // Spot-check: original sensitive substrings should not appear in the output.
      const raw = JSON.stringify(sample.input);
      // Only check for specific leak markers that appear in the originals.
      const leakMarkers = [
        "abc123secret",
        "s3cr3tvalue",
        "very-secret",
        "hmac-sig-xyz",
        "my pass phrase",
        "Bearer tok",
        "binance-key-abc",
        "okx-sig-xyz",
        "okx-sig-low",
        "supabase-tok-abc",
        "sbec-token-2",
        "deep-secret",
        "deep-pass",
      ];
      for (const marker of leakMarkers) {
        if (raw.includes(marker)) {
          expect(json, `sample "${sample.name}": leak marker "${marker}" still present`).not.toContain(marker);
        }
      }
    }
  });
});

describe("scrubPii — allowlist samples", () => {
  const GOOD_SAMPLES: Array<{ name: string; input: unknown }> = [
    { name: "plain string", input: "Looking for a market-neutral crypto SMA" },
    { name: "small integer", input: 42 },
    { name: "normal object with non-sensitive keys", input: { name: "Alice", firm: "Acme Capital" } },
    { name: "nested display name", input: { allocator: { display_name: "Alice Smith", email: "alice@acme.example" } } },
    { name: "array of metrics", input: [{ sharpe: 1.2 }, { max_drawdown: -0.08 }] },
  ];

  it("leaves all 5 known-good samples untouched", () => {
    expect(GOOD_SAMPLES).toHaveLength(5);
    for (const sample of GOOD_SAMPLES) {
      const out = scrubPii(sample.input);
      expect(out, `sample "${sample.name}" changed unexpectedly`).toEqual(sample.input);
    }
  });

  it("does not flag two-segment strings as JWTs", () => {
    // "foo.bar" is NOT a JWT shape. Don't over-redact.
    const out = scrubPii({ label: "foo.bar" });
    expect(out).toEqual({ label: "foo.bar" });
  });

  it("preserves null and undefined", () => {
    expect(scrubPii(null)).toBeNull();
    expect(scrubPii(undefined)).toBeUndefined();
  });
});

describe("scrubFreeformString", () => {
  // Multi-key shape coverage: every key-shape the SENSITIVE_KEY_VALUE
  // regex names must redact its value. Previously only `apikey:` was
  // exercised by ErrorEnvelope.test.tsx — testing specialist flagged the
  // asymmetry.
  const SECRET = "SECRET_VALUE_ABC123";
  // The regex requires `key[:=]value` shape — `bearer X` (whitespace only)
  // is intentionally not in this list because raw `Bearer <token>` lines
  // are caught via the outer `authorization:` prefix or the JWT substring
  // scrubber, not via a `bearer:` key match.
  const KEY_SHAPES: Array<[label: string, line: string]> = [
    ["apikey", `apikey: ${SECRET}`],
    ["api-key dash", `api-key=${SECRET}`],
    ["api_key snake", `api_key:${SECRET}`],
    ["api_secret", `api_secret: ${SECRET}`],
    ["x-mbx-apikey Binance", `x-mbx-apikey: ${SECRET}`],
    ["ok-access-sign OKX", `ok-access-sign:${SECRET}`],
    ["secret", `secret=${SECRET}`],
    ["passphrase", `passphrase: ${SECRET}`],
    ["password", `password=${SECRET}`],
    ["token", `token: ${SECRET}`],
    ["credential", `credential=${SECRET}`],
    ["cookie", `cookie: ${SECRET}`],
    ["session", `session: ${SECRET}`],
    ["authorization", `authorization: ${SECRET}`],
    ["bearer with separator", `bearer: ${SECRET}`],
  ];

  it.each(KEY_SHAPES)(
    "redacts the value when the key shape is %s",
    (_label, line) => {
      const out = scrubFreeformString(line);
      expect(out).not.toContain(SECRET);
      expect(out).toContain("[REDACTED]");
    },
  );

  it("redacts an embedded JWT inside an Authorization: Bearer line", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    const out = scrubFreeformString(`Authorization: Bearer ${jwt}`);
    expect(out).not.toContain(jwt);
    expect(out).toContain("[REDACTED_JWT]");
  });

  it("redacts a whole-string JWT", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    const out = scrubFreeformString(jwt);
    expect(out).toBe("[REDACTED_JWT]");
  });

  it("preserves benign strings unchanged", () => {
    expect(scrubFreeformString("Step one.")).toBe("Step one.");
    expect(scrubFreeformString("Sharpe: 1.2 over 90d")).toBe(
      "Sharpe: 1.2 over 90d",
    );
    expect(scrubFreeformString("")).toBe("");
  });

  it("does NOT flag two-segment dotted strings as JWTs", () => {
    expect(scrubFreeformString("foo.bar")).toBe("foo.bar");
  });
});

describe("truncateAccountId", () => {
  it("truncates strings >= 8 chars to last 4", () => {
    expect(truncateAccountId("1234567890abcdef")).toBe("***cdef");
    expect(truncateAccountId("12345678")).toBe("***5678");
  });

  it("leaves short strings alone", () => {
    expect(truncateAccountId("1234567")).toBe("1234567");
    expect(truncateAccountId("abc")).toBe("abc");
    expect(truncateAccountId("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Plan-checker fix 2026-05-06: blocker — corpus loading gap (TS side).
//
// The Python pytest TestSharedCorpus class loads tests/fixtures/redact-corpus.json
// and asserts parity; this TS-side describe block does the same so the
// "loaded by BOTH Vitest AND pytest" truth is backed by actual test code on
// both sides. Both runtimes consume the same file — drift gets caught here.
// ---------------------------------------------------------------------------

type CorpusBad = {
  name: string;
  input: unknown;
  expectRedactedKeys?: string[];
  expectJwtRedacted?: boolean;
  expectFreeformJwtRedacted?: boolean;
};
type CorpusGood = { name: string; input: unknown };
type Corpus = { bad: CorpusBad[]; good: CorpusGood[] };

const CORPUS: Corpus = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "tests/fixtures/redact-corpus.json"),
    "utf8",
  ),
);

describe("Shared corpus — TS side (Plan-checker fix 2026-05-06)", () => {
  it("loads the corpus and exposes 20 bad + 6 good", () => {
    expect(CORPUS.bad).toHaveLength(20);
    // Phase 18 / WR-06: 6th good-case ("null value passes through")
    // added so TestSharedCorpus asserts null-input parity on BOTH runtimes.
    expect(CORPUS.good).toHaveLength(6);
  });

  it.each(CORPUS.bad.map((b) => [b.name, b] as const))(
    "redacts bad case: %s",
    (_name, bad) => {
      const out = scrubPii(bad.input);
      const json = JSON.stringify(out);
      if (bad.expectRedactedKeys) {
        for (const key of bad.expectRedactedKeys) {
          expect(
            json,
            `bad "${bad.name}": expected "${key}":"[REDACTED]" in ${json}`,
          ).toContain(`"${key}":"[REDACTED]"`);
        }
      }
      if (bad.expectJwtRedacted) {
        expect(
          json.includes("[REDACTED_JWT]") || json.includes("[REDACTED]"),
          `bad "${bad.name}": expected a JWT redaction in ${json}`,
        ).toBe(true);
      }
      if (bad.expectFreeformJwtRedacted) {
        // Whole-string JWT inside a dict value — anchored regex catches it.
        expect(
          json.includes("[REDACTED_JWT]"),
          `bad "${bad.name}": expected freeform JWT redaction in ${json}`,
        ).toBe(true);
      }
    },
  );

  it.each(CORPUS.good.map((g) => [g.name, g] as const))(
    "leaves good case unchanged: %s",
    (_name, good) => {
      const out = scrubPii(good.input);
      expect(out, `good "${good.name}" round-trip changed`).toEqual(good.input);
    },
  );
});
