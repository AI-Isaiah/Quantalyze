import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// The Sentry SDK is a DYNAMIC import inside `register()` / `onRequestError()`.
// Mocking it lets the tests below capture the REAL init options — so the
// scrubbing assertions run the callback the process would actually register,
// not a copy of it typed into the test.
const sentryInitMock = vi.hoisted(() => vi.fn());
const sentryCaptureExceptionMock = vi.hoisted(() => vi.fn());
const sentryCaptureMessageMock = vi.hoisted(() => vi.fn());
vi.mock("@sentry/nextjs", () => ({
  init: sentryInitMock,
  captureException: sentryCaptureExceptionMock,
  captureMessage: sentryCaptureMessageMock,
}));

import {
  warnUnsetSoftSkipKeys,
  SOFT_SKIP_PROD_KEYS,
  register,
  onRequestError,
  shareTokenSecretBootError,
} from "./instrumentation";

/**
 * [#15] startup warn-loud for unset soft-skip prod keys. Intent: a missing key
 * that silently disables a prod feature (the RESEND_API_KEY founder-LP incident)
 * shows up in the deploy log instead of only when the feature fails to run —
 * and ONLY in production, and NEVER by crashing.
 */
describe("[#15] warnUnsetSoftSkipKeys", () => {
  const saved: Record<string, string | undefined> = {};
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    for (const k of [...SOFT_SKIP_PROD_KEYS, "VERCEL_ENV"]) saved[k] = process.env[k];
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    for (const k of [...SOFT_SKIP_PROD_KEYS, "VERCEL_ENV"]) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    warn.mockRestore();
  });

  it("stays silent outside production even with keys unset", () => {
    process.env.VERCEL_ENV = "preview";
    for (const k of SOFT_SKIP_PROD_KEYS) delete process.env[k];
    warnUnsetSoftSkipKeys();
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns in production listing exactly the unset keys", () => {
    process.env.VERCEL_ENV = "production";
    for (const k of SOFT_SKIP_PROD_KEYS) process.env[k] = "set";
    delete process.env.RESEND_API_KEY;
    warnUnsetSoftSkipKeys();
    expect(warn).toHaveBeenCalledTimes(1);
    const msg = warn.mock.calls[0][0] as string;
    expect(msg).toContain("RESEND_API_KEY");
    // a key that IS set must not be listed
    expect(msg).not.toContain("SENTRY_DSN");
  });

  it("stays silent in production when all soft-skip keys are set", () => {
    process.env.VERCEL_ENV = "production";
    for (const k of SOFT_SKIP_PROD_KEYS) process.env[k] = "set";
    warnUnsetSoftSkipKeys();
    expect(warn).not.toHaveBeenCalled();
  });
});

/**
 * Phase 164 / SHARE-01 — the share token must never reach Sentry.
 *
 * ⚠️ HONESTY BOUNDARY, STATED SO IT IS NOT MISTAKEN FOR MORE THAN IT IS.
 * These tests prove the WIRING and the TRANSFORM: the callback the process
 * really registers, run against a synthetic event, emits no token. They do NOT
 * prove that a real Sentry event, produced by a real error on a real deployed
 * token URL, arrives redacted — no in-process test can, because the SDK's own
 * event assembly is mocked out here. That verification is a POST-DEPLOY UAT
 * item for this phase (164-CONTEXT.md Blocker 3: "verify by triggering a real
 * error on a token URL and reading the event, not from config"), not a step
 * that was skipped.
 *
 * The assertions are made on the OUTPUT EVENT, never on the presence of a
 * config key. `expect(opts.beforeSend).toBeDefined()` would pass against a
 * hook that returned the event untouched.
 */
describe("[164 SHARE-01] Sentry never receives a share token", () => {
  /** 43 base64url characters — the width `deriveShareToken` emits. Typed by
   *  hand so this file does not depend on the deriver, and asserted ABSENT
   *  from every scrubbed output below. */
  const TOKEN = "Xk3pQ9vLm2Rt7Wb1Yz4Nc6Hs8Jd0Fg5Aq3Ue7Ip9Ov";
  const PLACEHOLDER = "/factsheet-share/[token]";
  /** Any 43-char base64url run at all — catches a partially-scrubbed leak that
   *  an equality assertion against PLACEHOLDER would miss. */
  const TOKEN_SHAPED = /[A-Za-z0-9_-]{43}/;

  const saved: Record<string, string | undefined> = {};
  const ENV_KEYS = ["SENTRY_DSN", "VERCEL_ENV", "SHARE_TOKEN_SECRET"];
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    vi.clearAllMocks();
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    errorSpy.mockRestore();
  });

  /** A synthetic event carrying the token on EVERY channel the scrubber claims
   *  to cover. Rebuilt per call because the scrubber mutates in place. */
  function tokenEvent() {
    return {
      transaction: `GET /factsheet-share/${TOKEN}`,
      request: { url: `https://quantalyze.xyz/factsheet-share/${TOKEN}?ref=x` },
      breadcrumbs: [
        { message: `navigated to /factsheet-share/${TOKEN}` },
        { data: { url: `https://quantalyze.xyz/factsheet-share/${TOKEN}` } },
      ],
      spans: [{ description: `GET /factsheet-share/${TOKEN}` }],
      contexts: { trace: { description: `/factsheet-share/${TOKEN}` } },
      extra: { path: `/factsheet-share/${TOKEN}` },
    };
  }

  /** Anti-vacuity floor: the fixture really does carry the token, so an
   *  "absent from the output" assertion is a real claim about the transform
   *  and not a statement about an empty fixture. */
  it("the fixture itself contains the raw token (anti-vacuity)", () => {
    expect(JSON.stringify(tokenEvent())).toContain(TOKEN);
  });

  async function registeredInitOptions() {
    process.env.SENTRY_DSN = "https://publickey@o0.ingest.sentry.io/1";
    process.env.VERCEL_ENV = "preview"; // keeps the boot check quiet here
    await register();
    expect(sentryInitMock).toHaveBeenCalledTimes(1);
    return sentryInitMock.mock.calls[0][0] as {
      beforeSend?: (e: unknown) => unknown;
      beforeSendTransaction?: (e: unknown) => unknown;
    };
  }

  it("the REGISTERED beforeSend scrubs every URL-shaped field of the event", async () => {
    const opts = await registeredInitOptions();
    expect(typeof opts.beforeSend).toBe("function");

    const out = opts.beforeSend!(tokenEvent()) as ReturnType<typeof tokenEvent>;

    // Field by field, so a failure names the channel that leaked.
    expect(out.transaction).toBe(`GET ${PLACEHOLDER}`);
    expect(out.request.url).toBe(`https://quantalyze.xyz${PLACEHOLDER}?ref=x`);
    expect(out.breadcrumbs[0].message).toBe(`navigated to ${PLACEHOLDER}`);
    expect(out.breadcrumbs[1].data!.url).toBe(
      `https://quantalyze.xyz${PLACEHOLDER}`,
    );
    expect(out.spans[0].description).toBe(`GET ${PLACEHOLDER}`);
    expect(out.contexts.trace.description).toBe(PLACEHOLDER);
    expect(out.extra.path).toBe(PLACEHOLDER);

    // And the whole-event property: nothing token-shaped survives ANYWHERE,
    // including fields this test did not enumerate.
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain(TOKEN);
    expect(serialized).not.toMatch(TOKEN_SHAPED);
  });

  it("the REGISTERED beforeSendTransaction scrubs too — tracing is its own channel", async () => {
    const opts = await registeredInitOptions();
    expect(typeof opts.beforeSendTransaction).toBe("function");

    const out = opts.beforeSendTransaction!(tokenEvent());

    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain(TOKEN);
    expect(serialized).not.toMatch(TOKEN_SHAPED);
  });

  it("an event with no share path passes through byte-identical", async () => {
    const opts = await registeredInitOptions();
    const clean = {
      transaction: "GET /factsheet/44444444-4444-4444-8444-444444444444/v2",
      request: { url: "https://quantalyze.xyz/browse?sort=sharpe" },
    };
    const before = JSON.stringify(clean);
    const out = opts.beforeSend!(clean);
    expect(JSON.stringify(out)).toBe(before);
  });

  it("onRequestError sends the PLACEHOLDER as extra.path, never the raw token", async () => {
    process.env.SENTRY_DSN = "https://publickey@o0.ingest.sentry.io/1";

    await onRequestError(
      { digest: "abc123" },
      {
        path: `/factsheet-share/${TOKEN}`,
        method: "GET",
        headers: { "x-correlation-id": "cid-1" },
      },
      {
        routerKind: "App Router",
        // Next hands this one already parameterized — pinned so a future
        // "scrub it too" edit is recognised as unnecessary, not as missing.
        routePath: "/factsheet-share/[token]",
        routeType: "render",
        renderSource: "react-server-components",
      },
    );

    expect(sentryCaptureExceptionMock).toHaveBeenCalledTimes(1);
    const opts = sentryCaptureExceptionMock.mock.calls[0][1] as {
      extra: { path: string };
      tags: { routePath: string };
    };
    expect(opts.extra.path).toBe(PLACEHOLDER);
    expect(opts.extra.path).not.toContain(TOKEN);
    expect(JSON.stringify(opts)).not.toMatch(TOKEN_SHAPED);
    // The correlation tag and the parameterized route survive — the scrub must
    // not cost the diagnostics the hook exists for.
    expect(opts.tags.routePath).toBe("/factsheet-share/[token]");
  });
});

/**
 * Phase 164 / D-02 second half — the secret's boot-time VISIBILITY.
 *
 * The module-load throw in `src/lib/strategy-share-token.ts` is the hard stop;
 * this is the deploy-log signal that fires before anyone clicks Copy Link.
 * ⛔ It must NOT be on `SOFT_SKIP_PROD_KEYS` (warn-only, never-crash) — that
 * list's contract is the opposite of this ruling's intent.
 */
describe("[164 D-02] SHARE_TOKEN_SECRET boot check", () => {
  const saved: Record<string, string | undefined> = {};
  const ENV_KEYS = ["SENTRY_DSN", "VERCEL_ENV", "SHARE_TOKEN_SECRET"];
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    vi.clearAllMocks();
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    errorSpy.mockRestore();
  });

  it("is silent outside production even with the secret absent", () => {
    process.env.VERCEL_ENV = "preview";
    delete process.env.SHARE_TOKEN_SECRET;
    expect(shareTokenSecretBootError()).toBeNull();
  });

  it("is silent in production when the secret is present and long enough", () => {
    process.env.VERCEL_ENV = "production";
    process.env.SHARE_TOKEN_SECRET = "z".repeat(32);
    expect(shareTokenSecretBootError()).toBeNull();
  });

  it("reports in production when the secret is UNSET", () => {
    process.env.VERCEL_ENV = "production";
    delete process.env.SHARE_TOKEN_SECRET;
    const msg = shareTokenSecretBootError();
    expect(msg).toContain("SHARE_TOKEN_SECRET");
    expect(msg).toContain("UNSET");
    expect(msg).toContain("openssl rand -base64 48");
  });

  it("reports in production when the secret is one character too short", () => {
    process.env.VERCEL_ENV = "production";
    process.env.SHARE_TOKEN_SECRET = "z".repeat(31);
    const msg = shareTokenSecretBootError();
    expect(msg).toContain("31 characters");
    // ⛔ The value itself must never appear in a log line.
    expect(msg).not.toContain("z".repeat(31));
  });

  it("register() logs the error AND captures it to Sentry in a broken prod", async () => {
    process.env.VERCEL_ENV = "production";
    process.env.SENTRY_DSN = "https://publickey@o0.ingest.sentry.io/1";
    delete process.env.SHARE_TOKEN_SECRET;

    await register();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0][0])).toContain("SHARE_TOKEN_SECRET");
    expect(sentryCaptureMessageMock).toHaveBeenCalledTimes(1);
    expect(String(sentryCaptureMessageMock.mock.calls[0][0])).toContain(
      "SHARE_TOKEN_SECRET",
    );
    expect(sentryCaptureMessageMock.mock.calls[0][1]).toBe("error");
  });

  it("register() stays silent when the secret is healthy", async () => {
    process.env.VERCEL_ENV = "production";
    process.env.SENTRY_DSN = "https://publickey@o0.ingest.sentry.io/1";
    process.env.SHARE_TOKEN_SECRET = "z".repeat(64);

    await register();

    expect(errorSpy).not.toHaveBeenCalled();
    expect(sentryCaptureMessageMock).not.toHaveBeenCalled();
  });

  it("console.error still fires when Sentry is unconfigured", async () => {
    process.env.VERCEL_ENV = "production";
    delete process.env.SENTRY_DSN;
    delete process.env.SHARE_TOKEN_SECRET;

    await register();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(sentryInitMock).not.toHaveBeenCalled();
    expect(sentryCaptureMessageMock).not.toHaveBeenCalled();
  });

  it("SHARE_TOKEN_SECRET is NOT on the warn-only soft-skip list", () => {
    expect(SOFT_SKIP_PROD_KEYS as readonly string[]).not.toContain(
      "SHARE_TOKEN_SECRET",
    );
  });
});
