import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as seamRedaction from "./seam-redaction";
import {
  MIN_REDACTABLE_SECRET_LENGTH,
  REDACTED,
  SEAM_PRESERVE_TOKENS,
  SEAM_SECRET_ENV_NAMES,
  scrubSeamError,
  scrubSeamString,
} from "./seam-redaction";

/**
 * Phase 140.2 / SEAMCORE-06 (TRAP-1) — the redaction leaf, asserted in BOTH
 * directions on the SAME input.
 *
 * ⚠️ WHY EVERY CASE BELOW IS TWO-SIDED. TRAP-1 is not "leaks are bad"; it is
 * that the two failure modes pull in OPPOSITE directions and a one-sided test
 * ships one of them green:
 *
 *   · Under-redacting leaks a live credential. undici embeds the outgoing
 *     headers in `err.message` and, in one shape, in `err.name`. On this seam
 *     those headers are `INTERNAL_API_TOKEN`, `X-Service-Key`, and
 *     `X-User-Access-Token` — a live end-user Supabase JWT.
 *   · Over-redacting destroys the diagnosis. A SHORT secret substring-matched
 *     against prose eats the `ECONNREFUSED` / `ENOTFOUND` / TLS token, which is
 *     the single most valuable thing in the line. A redactor that leaves the
 *     operator unable to tell TLS expiry from a refused connection has replaced
 *     one incident with two.
 *
 * So the secret-is-gone assertion and the token-survived assertion are made
 * against ONE scrub of ONE realistic undici message, never against two
 * separately-constructed inputs. Ledger row M33 (lower
 * `MIN_REDACTABLE_SECRET_LENGTH` so a short secret substring-matches prose)
 * reddens the PRESERVE side; nothing else in the repo can see it.
 *
 * ORACLE INDEPENDENCE. Every secret value, every preserve token and every
 * expected substring below is hand-typed in this file. Nothing is read back out
 * of the module under test except the three exported literal lists, which are
 * compared AGAINST hand-typed sets rather than used as expectations.
 *
 * ZERO `vi.mock`. The leaf imports nothing, so there is nothing to mock; that
 * property is itself asserted at the bottom of this file.
 */

// ── Hand-typed secrets, realistic in SHAPE as well as length ────────────────
//
// Realistic shapes matter: a synthetic `"secret"` is 6 characters, so it would
// be refused by the minimum-length rule and every redaction assertion would
// pass for the wrong reason.

/** A 40-char hex-ish internal token, the shape `INTERNAL_API_TOKEN` carries. */
const INTERNAL_TOKEN = "int_9f3a1c7e5b2d84a6f0c1e3d5b7a9f2c48e6d0b1a";

/** A live end-user Supabase JWT — three dot-separated base64url segments. */
const USER_JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
  "eyJzdWIiOiJ1c2VyLTQyIiwicm9sZSI6ImF1dGhlbnRpY2F0ZWQiLCJleHAiOjE3NjQ1MDAwMDB9." +
  "7Qd1s0mB2pXnA4vK9tL6cR3fY8wZ1jH5uE0oI2aS3dG";

/** The analytics service key, forwarded as `X-Service-Key`. */
const SERVICE_KEY = "asvc_5c1e8b90f47a2d63b58e0c9147ad3f26";

/** A raw exchange API secret — the key-connect path carries these in the body. */
const EXCHANGE_SECRET = "kX7pQ2mN9vB4tR8sL1wY6hG3jD5fA0cZ";

/**
 * A realistic undici transport-failure message, carrying BOTH a credential and
 * a syscall token.
 *
 * Shape taken from what Node actually prints for a refused connection through
 * `fetch`: a `TypeError: fetch failed` whose `cause` is the `ECONNREFUSED`
 * error, plus the `request` object — including its HEADERS — inlined into the
 * inspected output. That inlining is the whole leak: nothing in our code passes
 * a header value to a logger, undici puts it in the message for us.
 */
function undiciMessage(): string {
  return [
    "TypeError: fetch failed",
    "    at node:internal/deps/undici/undici:13502:13",
    "    at process.processTicksAndRejections (node:internal/process/task_queues:105:5) {",
    "  [cause]: Error: connect ECONNREFUSED 10.0.0.1:8002",
    "      at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1611:16) {",
    "    errno: -111,",
    "    code: 'ECONNREFUSED',",
    "    syscall: 'connect',",
    "    address: '10.0.0.1',",
    "    port: 8002",
    "  },",
    "  request: {",
    "    method: 'POST',",
    "    path: '/process-key',",
    "    headers: {",
    "      'content-type': 'application/json',",
    `      authorization: 'Bearer ${INTERNAL_TOKEN}',`,
    `      'x-service-key': '${SERVICE_KEY}',`,
    `      'x-user-access-token': '${USER_JWT}'`,
    "    }",
    "  }",
    "}",
  ].join("\n");
}

/**
 * Drop the leaf's trailing `[seam-redaction: …]` notices before a PRESERVE
 * assertion.
 *
 * ⚠️ ORACLE DEFECT FOUND WHILE OBSERVING LEDGER ROW M33, AND FIXED RATHER THAN
 * RECORDED AS A PASS. The collision notice NAMES the tokens it destroyed, so a
 * bare `expect(scrubbed).toContain("ECONNREFUSED")` was satisfied by the notice
 * text itself while the message body had been mangled to `E<redacted>REFUSED`.
 * A preserve assertion has to look at the LINE, never at the leaf's own report
 * about the line — that is a self-referential oracle wearing a different hat.
 */
function messageBody(scrubbed: string): string {
  return scrubbed.replace(/ \[seam-redaction: [^\]]*\]/g, "");
}

afterEach(() => {
  // Env is stubbed per case. A leaked stub silently changes which secrets the
  // NEXT case's scrub knows about, which is exactly how a redaction test starts
  // passing for the wrong reason.
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("[SEAMCORE-06 / TRAP-1] the redaction leaf is safe in BOTH directions", () => {
  it("strips every env secret from a realistic undici message AND keeps ECONNREFUSED", () => {
    vi.stubEnv("INTERNAL_API_TOKEN", INTERNAL_TOKEN);
    vi.stubEnv("ANALYTICS_SERVICE_KEY", SERVICE_KEY);

    const scrubbed = scrubSeamString(undiciMessage());

    // ── the LEAK side ────────────────────────────────────────────────────
    expect(scrubbed).not.toContain(INTERNAL_TOKEN);
    expect(scrubbed).not.toContain(SERVICE_KEY);
    expect(scrubbed).toContain(REDACTED);

    // ── the DIAGNOSIS side, on the SAME scrub ────────────────────────────
    expect(
      messageBody(scrubbed),
      "ECONNREFUSED was destroyed by redaction. That is the over-redaction " +
        "half of TRAP-1: without the syscall token, TLS expiry, DNS failure " +
        "and a refused connection are one indistinguishable line.",
    ).toContain("connect ECONNREFUSED 10.0.0.1:8002");
    expect(messageBody(scrubbed)).toContain("syscall: 'connect'");
    expect(messageBody(scrubbed)).toContain("errno: -111");
  });

  it("strips a PER-REQUEST secret the module list cannot know — a live user JWT", () => {
    // No env stub at all: a module-level name list cannot know a per-request
    // credential, which is why the caller passes it explicitly.
    const scrubbed = scrubSeamString(undiciMessage(), [USER_JWT]);

    expect(
      scrubbed,
      "The X-User-Access-Token value is a LIVE end-user Supabase JWT. It " +
        "cannot come from an env list, so if the caller's explicit secrets " +
        "argument is not applied it ships to the log verbatim.",
    ).not.toContain(USER_JWT);
    expect(scrubbed).toContain("ECONNREFUSED");
  });

  it("strips a raw exchange credential passed per-request, alongside the env secrets", () => {
    vi.stubEnv("INTERNAL_API_TOKEN", INTERNAL_TOKEN);

    const scrubbed = scrubSeamString(undiciMessage(), [
      USER_JWT,
      EXCHANGE_SECRET,
      undefined,
      null,
      "",
    ]);

    expect(scrubbed).not.toContain(INTERNAL_TOKEN);
    expect(scrubbed).not.toContain(USER_JWT);
    expect(scrubbed).toContain("ECONNREFUSED");
  });

  it("REFUSES to redact a secret shorter than the minimum, and SIGNALS the refusal", () => {
    // `CONN` is a substring of `ECONNREFUSED`. A substring replacement would
    // turn the syscall token into `E<redacted>REFUSED` and the operator loses
    // the one fact worth having. Ledger row M33 lowers the minimum so this
    // exact destruction happens.
    vi.stubEnv("CRON_SECRET", "CONN");

    const scrubbed = scrubSeamString(undiciMessage());

    expect(
      messageBody(scrubbed),
      "A secret shorter than the minimum was substring-replaced and it ate " +
        "the syscall token. Short candidates must be REFUSED, not applied. " +
        "Asserted against the message BODY, never the whole line: the leaf's " +
        "own collision notice NAMES the destroyed token, so a naive toContain " +
        "passes on a line that has been ruined.",
    ).toContain("connect ECONNREFUSED 10.0.0.1:8002");
    expect(scrubbed).not.toContain("<redacted>REFUSED");
    // The refusal is SIGNALLED, not silent: the line may be under-redacted and
    // the operator has to be able to see that from the line itself.
    expect(scrubbed).toContain("seam-redaction");
    expect(scrubbed).toContain("CRON_SECRET");
    expect(scrubbed).toContain(String(MIN_REDACTABLE_SECRET_LENGTH));
  });

  it("does not add a refusal notice for a short secret that is ABSENT from the line", () => {
    // A refusal notice on every line where a short secret merely EXISTS would
    // be noise on the healthy path and would train operators to ignore it.
    vi.stubEnv("CRON_SECRET", "abcd");

    const scrubbed = scrubSeamString("connect ENOTFOUND analytics.internal");

    expect(scrubbed).toBe("connect ENOTFOUND analytics.internal");
  });

  it("SIGNALS when a configured secret value collides with a preserve token", () => {
    // A long-enough secret whose value CONTAINS a syscall token cannot be
    // redacted without destroying the token. The leaf redacts (the credential
    // wins) and then says so, rather than shipping a silently mangled line.
    vi.stubEnv("INTERNAL_API_TOKEN", `prefix-ECONNREFUSED-${SERVICE_KEY}`);

    const scrubbed = scrubSeamString(
      `connect prefix-ECONNREFUSED-${SERVICE_KEY} at 10.0.0.1:8002`,
    );

    expect(scrubbed).not.toContain(SERVICE_KEY);
    expect(scrubbed).toContain("seam-redaction");
    expect(scrubbed).toContain("ECONNREFUSED");
    expect(scrubbed).toContain("INTERNAL_API_TOKEN");
  });

  it("preserves every hand-typed diagnostic token when a real secret is redacted", () => {
    vi.stubEnv("INTERNAL_API_TOKEN", INTERNAL_TOKEN);

    // One line carrying ALL EIGHT tokens plus the credential. A per-token
    // sweep would let a single destroyed member hide behind seven survivors.
    const line =
      `ECONNREFUSED ENOTFOUND ECONNRESET ETIMEDOUT EAI_AGAIN ` +
      `CERT_HAS_EXPIRED UNABLE_TO_VERIFY_LEAF_SIGNATURE ` +
      `DEPTH_ZERO_SELF_SIGNED_CERT authorization: Bearer ${INTERNAL_TOKEN}`;

    const scrubbed = scrubSeamString(line);

    expect(scrubbed).not.toContain(INTERNAL_TOKEN);
    for (const token of [
      "ECONNREFUSED",
      "ENOTFOUND",
      "ECONNRESET",
      "ETIMEDOUT",
      "EAI_AGAIN",
      "CERT_HAS_EXPIRED",
      "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
      "DEPTH_ZERO_SELF_SIGNED_CERT",
    ]) {
      expect(
        messageBody(scrubbed),
        `${token} did not survive redaction`,
      ).toContain(token);
    }
  });
});

describe("[SEAMCORE-06] scrubSeamError covers the shapes undici and the core produce", () => {
  it("scrubs the error NAME — the second undici shape", () => {
    vi.stubEnv("INTERNAL_API_TOKEN", INTERNAL_TOKEN);
    const err = new Error("connect ECONNREFUSED 10.0.0.1:8002");
    // A retry/wrapper layer that stringifies the request init into the NAME is
    // the shape H-0328 was originally filed for; scrubbing only `.message`
    // leaves it wide open.
    err.name = `RequestError [Bearer ${INTERNAL_TOKEN}]`;

    const scrubbed = scrubSeamError(err);

    expect(scrubbed).not.toContain(INTERNAL_TOKEN);
    expect(scrubbed).toContain("ECONNREFUSED");
    expect(scrubbed).toContain("RequestError");
  });

  it("walks the CAUSE chain — the shape SeamBodyReadError attaches", () => {
    vi.stubEnv("ANALYTICS_SERVICE_KEY", SERVICE_KEY);
    // Plan 140.2-05 made `SeamBodyReadError` carry the original rejection as
    // `cause`, so a scrubber that reads only the top-level message reports
    // "SeamBodyReadError: …" and throws the actual diagnosis away.
    const inner = new Error(
      `connect ETIMEDOUT via x-service-key ${SERVICE_KEY}`,
    );
    const outer = new Error("seam body read failed", { cause: inner });

    const scrubbed = scrubSeamError(outer);

    expect(scrubbed).not.toContain(SERVICE_KEY);
    expect(scrubbed).toContain("seam body read failed");
    expect(scrubbed).toContain("ETIMEDOUT");
  });

  it("returns a string and never throws for undefined, null, a non-Error and a circular object", () => {
    // A scrubber that throws runs INSIDE a catch block, so it would replace the
    // caller's real error with a bookkeeping error — strictly worse than not
    // scrubbing at all.
    const circular: Record<string, unknown> = { code: "ECONNREFUSED" };
    circular.self = circular;

    for (const thrown of [
      undefined,
      null,
      "a bare string rejection",
      42,
      Symbol("sym"),
      circular,
      { toString: () => { throw new Error("hostile toString"); } },
      Object.create(null) as object,
    ]) {
      const out = scrubSeamError(thrown);
      expect(typeof out).toBe("string");
      expect(out.length).toBeGreaterThan(0);
      // ⚠️ TOTALITY IS NOT THE WHOLE CONTRACT, and asserting only totality is
      // what let CR-01 ship. `typeof out === "string"` and `out.length > 0` are
      // BOTH satisfied by the string `"[object Object]"`, so the two assertions
      // above cannot redden for ANY rendering whatsoever — including the one
      // that destroys the entire diagnosis. A renderer is useless if it is
      // total and says nothing; pin the second half here.
      expect(out).not.toBe("[object Object]");
    }
  });

  // ── CR-01 — the PLAIN-OBJECT branch ────────────────────────────────────────
  //
  // Supabase/PostgREST errors on the NON-throwing path are plain parsed-JSON
  // objects, not `PostgrestError` instances: `postgrest-js` constructs the class
  // only under `shouldThrowOnError`, and every `const { data, error } = await
  // supabase…` in this repo takes the other path. `String(plainObject)` is
  // `"[object Object]"`, so a renderer with no plain-object branch throws away
  // the SQLSTATE, the message, the details and the hint — the A-10 harm,
  // reintroduced by the mechanism meant to close it.

  it("renders a PLAIN OBJECT's diagnostic fields rather than [object Object]", () => {
    // Hand-typed to the shape a Node system error takes when it arrives as a
    // plain object rather than an Error instance.
    const out = scrubSeamError({
      code: "ECONNREFUSED",
      message: "connect ECONNREFUSED 10.0.0.1:8002",
    });

    expect(out).not.toBe("[object Object]");
    // The PRESERVE side, asserted on a PLAIN OBJECT: the syscall token is the
    // most valuable thing in the line and it must survive this branch too.
    expect(out).toContain("ECONNREFUSED");
    expect(out).toContain("10.0.0.1:8002");
  });

  it("preserves the SQLSTATE, message, details and hint of a PostgREST-shaped object", () => {
    // The exact shape `finalize-wizard`'s six converted Supabase log sites hand
    // to the leaf. Every field below is hand-typed; nothing is read back out of
    // the module under test.
    const out = scrubSeamError({
      code: "42501",
      message: "permission denied for table strategy_keys",
      details: "RLS policy strategy_keys_owner_select denied the read",
      hint: "check auth.uid() against owner_id",
    });

    expect(out).not.toBe("[object Object]");
    expect(out).toContain("42501");
    expect(out).toContain("permission denied for table strategy_keys");
    expect(out).toContain("RLS policy strategy_keys_owner_select denied the read");
    expect(out).toContain("check auth.uid() against owner_id");
  });

  it("still redacts a secret carried in a PLAIN OBJECT's field", () => {
    // The plain-object branch must not become an under-redaction hole: it feeds
    // `scrubSeamString` exactly like the `Error` branch does.
    vi.stubEnv("INTERNAL_API_TOKEN", INTERNAL_TOKEN);

    const out = scrubSeamError({
      code: "ETIMEDOUT",
      message: `upstream rejected authorization=Bearer ${INTERNAL_TOKEN}`,
    });

    expect(out).not.toContain(INTERNAL_TOKEN);
    expect(out).toContain(REDACTED);
    expect(out).toContain("ETIMEDOUT");
  });

  it("falls back to a serialisation for an object with NO named diagnostic field", () => {
    // No `name`/`code`/`message`/`details`/`hint`/`errno`/`syscall`, and the
    // INHERITED `Object.prototype.toString` renders "[object Object]". A
    // serialisation is the only thing left that says anything at all.
    const out = scrubSeamError({ status: 503, upstream: "railway" });

    expect(out).not.toBe("[object Object]");
    expect(out).toContain("503");
    expect(out).toContain("railway");
  });

  it("bounds the serialised fallback so an opaque payload cannot flood the log", () => {
    // The fallback exists so an opaque object says SOMETHING, not so an
    // arbitrarily large payload lands in the Vercel log during exactly the
    // correlated incident this leaf runs inside. 500 is hand-typed here and in
    // the leaf; the input is 4 000 characters of a single letter.
    const out = scrubSeamError({ blob: "z".repeat(4_000) });

    expect(out).toContain("[truncated]");
    expect(out.length).toBeLessThan(600);
  });

  it("keeps a USEFUL custom toString instead of serialising over it", () => {
    // A `URL`, a `Date`, or any class with its own renderer says more through
    // `toString()` than through its (empty) own-property set. The branch must
    // only override the INHERITED "[object Object]", never a real renderer.
    const out = scrubSeamError(new URL("https://analytics.internal:8002/health"));

    expect(out).toContain("analytics.internal:8002");
  });

  it("terminates on a self-referential cause chain", () => {
    const a = new Error("outer ECONNRESET");
    const b = new Error("inner ETIMEDOUT", { cause: a });
    (a as { cause?: unknown }).cause = b;

    const scrubbed = scrubSeamError(a);

    expect(scrubbed).toContain("ECONNRESET");
    expect(scrubbed).toContain("ETIMEDOUT");
  });

  it("scrubs a per-request secret out of a thrown non-Error value", () => {
    const scrubbed = scrubSeamError(
      `upstream rejected api_secret=${EXCHANGE_SECRET}`,
      [EXCHANGE_SECRET],
    );
    expect(scrubbed).not.toContain(EXCHANGE_SECRET);
  });
});

describe("[SEAMCORE-06 / SC6-a] seam-redaction.ts is a dependency-free leaf", () => {
  const LEAF_PATH = "src/lib/seam-redaction.ts";

  /**
   * Whole-line and block comments go before matching. Without the strip, the
   * leaf's own docblock — which necessarily discusses imports and env reads —
   * satisfies the patterns below and the guard passes on a ruined file. This
   * phase hit prose-defeats-the-guard five times, once in the very commit that
   * documented the rule.
   */
  function stripComments(src: string): string {
    return src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
  }

  const LEAF_CODE = stripComments(
    readFileSync(join(process.cwd(), LEAF_PATH), "utf8"),
  );

  const RATIONALE =
    "The redaction leaf is applied from BOTH bundles: server-side seam modules " +
    "and, via plan 140.3, client-reachable error surfaces. A dependency here " +
    "drags whatever it pulls into the browser bundle, and anything seam-adjacent " +
    "pulls @upstash/redis plus a Redis.fromEnv() module-load side effect. It is " +
    "also applied from inside catch blocks, where a module-load failure would " +
    "replace the caller's real error with an import error. If this leaf " +
    "genuinely needs a dependency, the caller has to change — widening this " +
    "guard is never the fix.";

  it("contains no import statement", () => {
    expect(
      /^\s*import\s/m.test(LEAF_CODE),
      `${LEAF_PATH} now has an import statement. ${RATIONALE}`,
    ).toBe(false);
  });

  it("contains no re-export from another module", () => {
    expect(
      /^\s*export\s[^\n]*\bfrom\s/m.test(LEAF_CODE),
      `${LEAF_PATH} now re-exports from another module, which is an import in ` +
        `everything but name. ${RATIONALE}`,
    ).toBe(false);
  });

  it("contains no require() call", () => {
    expect(
      /\brequire\s*\(/.test(LEAF_CODE),
      `${LEAF_PATH} now calls require(). ${RATIONALE}`,
    ).toBe(false);
  });

  it("reads process.env at CALL time, never captured at module scope", () => {
    // The env read is REQUIRED here (unlike the other two leaves): the secret
    // VALUES live in the environment. What must not happen is a module-scope
    // capture — `resilient-fetch.wiring.test.ts` already documents that
    // ordering hazard, and a captured value is stale for every test that stubs
    // the env after import.
    const moduleScopeCapture =
      /^(?:const|let|var)\s+[\w$]+\s*=\s*process\.env/m.test(LEAF_CODE);
    expect(
      moduleScopeCapture,
      `${LEAF_PATH} captures process.env at module scope. Read it inside the ` +
        `scrub functions instead: a module-scope capture is evaluated once at ` +
        `import time, so a secret rotated (or a test env stubbed) afterwards is ` +
        `silently not redacted.`,
    ).toBe(false);
    expect(/process\.env/.test(LEAF_CODE)).toBe(true);
  });

  it("pins the exported surface as a hand-typed SET", () => {
    // A length check passes a RENAME (measured in plan 140.2-02). Everything
    // exported from this leaf is browser-reachable and survives every wholesale
    // seam mock, so adding a member is a decision to record here.
    expect(Object.keys(seamRedaction).sort()).toEqual(
      [
        "MIN_REDACTABLE_SECRET_LENGTH",
        "REDACTED",
        "SEAM_PRESERVE_TOKENS",
        "SEAM_SECRET_ENV_NAMES",
        "scrubSeamError",
        "scrubSeamString",
      ].sort(),
    );
  });

  it("pins the env-secret NAME list and the preserve-list to hand-typed sets", () => {
    // Hand-typed HERE, deliberately duplicating the leaf's own literals. A test
    // that read the list out of the module could not disagree with it, which is
    // the self-referential-oracle defect this phase exists to invert.
    expect([...SEAM_SECRET_ENV_NAMES].sort()).toEqual(
      [
        "ANALYTICS_SERVICE_KEY",
        "CRON_SECRET",
        "INTERNAL_API_TOKEN",
        "SUPABASE_SERVICE_ROLE_KEY",
        "UPSTASH_REDIS_REST_TOKEN",
      ].sort(),
    );
    expect([...SEAM_PRESERVE_TOKENS].sort()).toEqual(
      [
        "CERT_HAS_EXPIRED",
        "DEPTH_ZERO_SELF_SIGNED_CERT",
        "EAI_AGAIN",
        "ECONNREFUSED",
        "ECONNRESET",
        "ENOTFOUND",
        "ETIMEDOUT",
        "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
      ].sort(),
    );
    expect(MIN_REDACTABLE_SECRET_LENGTH).toBe(12);
    expect(REDACTED).toBe("<redacted>");
  });

  it("the minimum length exceeds the SHORTEST preserve token", () => {
    // The whole reason the minimum exists: a candidate at or below the length of
    // a diagnostic token cannot be told apart from prose. `ENOTFOUND`,
    // `ETIMEDOUT` and `EAI_AGAIN` are 9 characters, so the floor has to clear 9.
    const shortest = Math.min(...SEAM_PRESERVE_TOKENS.map((t) => t.length));
    expect(shortest).toBe(9);
    expect(MIN_REDACTABLE_SECRET_LENGTH).toBeGreaterThan(shortest);
  });
});
