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
import { scrubSeamError } from "@/lib/seam-redaction";

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
        // The console integration's real shape: `arguments` is an ARRAY, so a
        // walk that only scrubs top-level strings skips it entirely. Observed
        // off the wire, not invented.
        { data: { arguments: [`/factsheet-share/${TOKEN}`] } },
        // An OBJECT inside that array — also the observed shape
        // (`breadcrumbs[].data.arguments[].stack` came back off the wire).
        // Pins the array branch's own recursion, which an array of plain
        // strings does not: that case is handled by the string check beside it.
        { data: { arguments: [{ stack: `at /factsheet-share/${TOKEN}:1:1` }] } },
      ],
      extra: { path: `/factsheet-share/${TOKEN}` },
      // The SDK sets this tag itself, from the raw URL — see the note in
      // scrubSentryEvent. Verified against a real production event before
      // being added here, not assumed.
      tags: { url: `https://quantalyze.xyz/factsheet-share/${TOKEN}` },
      // ⛔ NESTED, AND THIS IS THE POINT. Both of these were captured OFF THE
      // WIRE from a real `next build && next start` server driven into a 500 on
      // the share lane (/qa 2026-08-28): `contexts.trace.data.http.target` held
      // the RAW token while `http.route` beside it was parameterised, because
      // the scrub walked only the top level of a record. `data.arguments` is
      // the array shape from Sentry's console integration. A fixture that only
      // models flat fields cannot fail on either.
      contexts: {
        trace: {
          description: `/factsheet-share/${TOKEN}`,
          data: {
            "http.route": "/factsheet-share/[token]",
            "http.target": `/factsheet-share/${TOKEN}`,
          },
        },
      },
      spans: [
        {
          description: `GET /factsheet-share/${TOKEN}`,
          data: { "http.target": `/factsheet-share/${TOKEN}` },
        },
      ],
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

  /**
   * Phase 209 / SC2 (SHARE-QA-07). In `@sentry/core` 11.11.0 a `beforeSend`
   * that THROWS is caught and the event is DROPPED (`callback_error`), so a
   * frozen object anywhere in the walked subtree used to lose the error report
   * outright, token or no token. Returning the event unscrubbed would ship a
   * live capability and returning `null` would lose the report; the contract
   * under test is: deliver the event, carry no token.
   *
   * Every case runs the REGISTERED hook, so the wiring is exercised too.
   */
  describe("[209 SC2] the scrub never throws and never loses the report", () => {
    type Delivered = ReturnType<typeof tokenEvent>;

    /** Run a registered hook and capture its result; a throw fails the case. */
    function deliver<R = Delivered>(
      hook: ((e: unknown) => unknown) | undefined,
      event: unknown,
    ): R {
      let out: unknown;
      expect(() => {
        out = hook!(event);
      }).not.toThrow();
      expect(out).not.toBeNull();
      return out as R;
    }

    /** Assert the anti-vacuity floor on the fixture, then the absence on the output. */
    function expectNoToken(fixtureJson: string, out: unknown) {
      expect(fixtureJson).toContain(TOKEN);
      const serialized = JSON.stringify(out);
      expect(serialized).not.toContain(TOKEN);
      expect(serialized).not.toMatch(TOKEN_SHAPED);
    }

    /** The marker a rebuilt object carries (WR-06): the count of omissions
     *  (WR-11), "0" when the rebuild lost nothing. Hand-typed, never imported. */
    const REBUILT = { scrub_rebuilt: "0" };

    it.each(["contexts.trace.data", "extra", "tags"] as const)(
      "a frozen object holding the token in %s is rebuilt scrubbed at its parent and the event is delivered",
      async (channel) => {
        const opts = await registeredInitOptions();
        const event = tokenEvent();
        if (channel === "contexts.trace.data") {
          event.contexts.trace.data = Object.freeze({
            "http.route": "/factsheet-share/[token]",
            "http.target": `/factsheet-share/${TOKEN}`,
          });
        } else if (channel === "extra") {
          event.extra = Object.freeze({ path: `/factsheet-share/${TOKEN}` });
        } else {
          event.tags = Object.freeze({
            url: `https://quantalyze.xyz/factsheet-share/${TOKEN}`,
          });
        }
        const fixtureJson = JSON.stringify(event);

        const out = deliver(opts.beforeSend, event);

        // The container was rebuilt at a writable parent, never at the root.
        expect(out).toBe(event);
        expectNoToken(fixtureJson, out);
        if (channel === "contexts.trace.data") {
          expect(out.contexts.trace.data).toEqual({
            "http.route": PLACEHOLDER,
            "http.target": PLACEHOLDER,
            ...REBUILT,
          });
        } else if (channel === "extra") {
          expect(out.extra).toEqual({ path: PLACEHOLDER, ...REBUILT });
        } else {
          expect(out.tags).toEqual({
            url: `https://quantalyze.xyz${PLACEHOLDER}`,
            ...REBUILT,
          });
        }
        // The rest of the event was scrubbed and delivered, not dropped.
        expect(out.transaction).toBe(`GET ${PLACEHOLDER}`);
      },
    );

    it("a getter-only property carrying the token is rebuilt scrubbed, not thrown on", async () => {
      const opts = await registeredInitOptions();
      const event = tokenEvent();
      const data: Record<string, unknown> = { "http.route": "/factsheet-share/[token]" };
      Object.defineProperty(data, "http.target", {
        enumerable: true,
        get: () => `/factsheet-share/${TOKEN}`,
      });
      event.contexts.trace.data = data as typeof event.contexts.trace.data;
      const fixtureJson = JSON.stringify(event);

      const out = deliver(opts.beforeSend, event);

      expectNoToken(fixtureJson, out);
      expect(out.contexts.trace.data).toEqual({
        "http.route": PLACEHOLDER,
        "http.target": PLACEHOLDER,
        ...REBUILT,
      });
      expect(out.transaction).toBe(`GET ${PLACEHOLDER}`);
    });

    it("a throwing enumerable getter cannot throw out of the scrub or lose the rest of the event", async () => {
      const opts = await registeredInitOptions();
      const event = tokenEvent();
      const extra: Record<string, unknown> = {};
      Object.defineProperty(extra, "boom", {
        enumerable: true,
        get: () => {
          throw new Error("hostile getter");
        },
      });
      event.extra = extra as typeof event.extra;
      const fixtureJson = JSON.stringify({ ...event, extra: undefined });

      const out = deliver(opts.beforeSend, event);

      expect(() => JSON.stringify(out)).not.toThrow();
      expectNoToken(fixtureJson, out);
      expect(out.transaction).toBe(`GET ${PLACEHOLDER}`);
    });

    it("a frozen object with NO token is left untouched and the event passes through as the same object (D-06)", async () => {
      const opts = await registeredInitOptions();
      const frozenExtra = Object.freeze({ note: "nothing to scrub" });
      const event = {
        transaction: "GET /browse",
        request: { url: "https://quantalyze.xyz/browse?sort=sharpe" },
        extra: frozenExtra,
      };
      const before = JSON.stringify(event);

      const out = deliver(opts.beforeSend, event);

      expect(out).toBe(event);
      expect(out.extra).toBe(frozenExtra);
      expect(JSON.stringify(out)).toBe(before);
    });

    /** Recursive `Object.freeze` over own enumerable values. */
    function deepFreeze<V>(value: V): V {
      if (value !== null && typeof value === "object") {
        for (const child of Object.values(value)) deepFreeze(child);
        Object.freeze(value);
      }
      return value;
    }

    /** The shape of a replacement event, as far as these cases read it. */
    type Replacement = {
      message?: string;
      event_id?: string;
      level?: string;
      type?: string;
      start_timestamp?: number;
      contexts?: { trace?: { trace_id?: string; span_id?: string } };
    };
    // Hand-typed on purpose, never imported: a test that reads the value out of
    // the module cannot disagree with it.
    const WITHHELD_MARKER =
      "[beforeSend] event content withheld: a share token could not be removed in place";

    it("a setter that swallows the write cannot pass for a scrubbed slot (read-back, D-07)", async () => {
      const opts = await registeredInitOptions();
      const event = tokenEvent();
      const data: Record<string, unknown> = {};
      Object.defineProperty(data, "http.target", {
        enumerable: true,
        get: () => `/factsheet-share/${TOKEN}`,
        set: () => {
          /* swallow: the assignment "succeeds" and changes nothing */
        },
      });
      event.contexts.trace.data = data as typeof event.contexts.trace.data;
      const fixtureJson = JSON.stringify(event);

      const out = deliver(opts.beforeSend, event);

      expectNoToken(fixtureJson, out);
      expect(out.contexts.trace.data).toEqual({
        "http.target": PLACEHOLDER,
        ...REBUILT,
      });
    });

    it.each([
      ["breadcrumbs", 5],
      ["breadcrumbs", { a: `/factsheet-share/${TOKEN}` }],
      ["spans", "x"],
      ["spans", { d: `/factsheet-share/${TOKEN}` }],
    ] as const)(
      "a non-array %s value (%j) neither throws nor lets the token through",
      async (channel, value) => {
        const opts = await registeredInitOptions();
        const event = tokenEvent() as Record<string, unknown>;
        event[channel] = value;
        const fixtureJson = JSON.stringify(event);

        const out = deliver(opts.beforeSend, event);

        expectNoToken(fixtureJson, out);
        expect(out.transaction).toBe(`GET ${PLACEHOLDER}`);
      },
    );

    it("a frozen breadcrumb is rebuilt scrubbed in place beside a writable one that is scrubbed in place", async () => {
      const opts = await registeredInitOptions();
      const event = tokenEvent();
      const crumbs = [
        Object.freeze({ message: `navigated to /factsheet-share/${TOKEN}` }),
        { message: `navigated to /factsheet-share/${TOKEN}` },
      ];
      event.breadcrumbs = crumbs as unknown as typeof event.breadcrumbs;
      const fixtureJson = JSON.stringify(event);

      const out = deliver(opts.beforeSend, event);

      expectNoToken(fixtureJson, out);
      expect(out.breadcrumbs).toBe(crumbs);
      expect(crumbs[1].message).toBe(`navigated to ${PLACEHOLDER}`);
      expect(crumbs[0]).toEqual({
        message: `navigated to ${PLACEHOLDER}`,
        ...REBUILT,
      });
    });

    it("a frozen request carrying the token is rebuilt scrubbed and the event is delivered", async () => {
      const opts = await registeredInitOptions();
      const event = tokenEvent();
      event.request = Object.freeze({
        url: `https://quantalyze.xyz/factsheet-share/${TOKEN}`,
      });
      const fixtureJson = JSON.stringify(event);

      const out = deliver(opts.beforeSend, event);

      expect(out).toBe(event);
      expectNoToken(fixtureJson, out);
      expect(out.request).toEqual({
        url: `https://quantalyze.xyz${PLACEHOLDER}`,
        ...REBUILT,
      });
    });

    it("an unwritable event root is replaced by a minimal event, never null, for beforeSend", async () => {
      const opts = await registeredInitOptions();
      const event = deepFreeze({
        event_id: "0123456789abcdef0123456789abcdef",
        level: "error",
        transaction: `GET /factsheet-share/${TOKEN}`,
        extra: { path: `/factsheet-share/${TOKEN}` },
      });
      const fixtureJson = JSON.stringify(event);

      const out = deliver<Replacement>(opts.beforeSend, event);

      expect(out).not.toBe(event);
      expect(out.message).toBe(WITHHELD_MARKER);
      expect(out.event_id).toBe(event.event_id);
      expect(out.level).toBe("error");
      expect(out.type).toBeUndefined();
      expectNoToken(fixtureJson, out);
    });

    it("an unwritable transaction root is replaced by a minimal event that stays a transaction", async () => {
      const opts = await registeredInitOptions();
      const event = deepFreeze({
        type: "transaction",
        transaction: `GET /factsheet-share/${TOKEN}`,
        start_timestamp: 1700000000.5,
        timestamp: 1700000001.5,
        contexts: {
          trace: {
            trace_id: "0123456789abcdef0123456789abcdef",
            span_id: "0123456789abcdef",
          },
        },
      });
      const fixtureJson = JSON.stringify(event);

      const out = deliver<Replacement>(opts.beforeSendTransaction!, event);

      expect(out).not.toBe(event);
      expect(out.type).toBe("transaction");
      expect(out.start_timestamp).toBe(1700000000.5);
      expect(out.contexts?.trace?.trace_id).toBe("0123456789abcdef0123456789abcdef");
      expect(out.contexts?.trace?.span_id).toBe("0123456789abcdef");
      expectNoToken(fixtureJson, out);
    });

    it("a fully deep-frozen event with NO token passes through as the same object (D-06 at the root)", async () => {
      const opts = await registeredInitOptions();
      const event = deepFreeze({
        transaction: "GET /browse",
        request: { url: "https://quantalyze.xyz/browse?sort=sharpe" },
        breadcrumbs: [{ message: "clicked", data: { arguments: ["a"] } }],
        extra: { n: 1 },
        tags: { route: "/browse" },
      });
      const before = JSON.stringify(event);

      const out = deliver<typeof event>(opts.beforeSend, event);

      expect(out).toBe(event);
      expect(JSON.stringify(out)).toBe(before);
    });

    /**
     * Phase 209 / WR-05. A replacement event used to be one anonymous constant:
     * no exception type, no tag, no fingerprint, no log, and the last-resort
     * catch reused the "token could not be removed" message for ANY throw. It
     * now says which path produced it, tells unrelated errors apart, and logs
     * one line with no event content.
     */
    it("a root-withheld event carries the reason tag, a fingerprint, the exception type and logs a content-free line", async () => {
      const opts = await registeredInitOptions();
      const event = deepFreeze({
        event_id: "0123456789abcdef0123456789abcdef",
        level: "error",
        transaction: `GET /factsheet-share/${TOKEN}`,
        exception: {
          values: [{ type: "TypeError", value: `bad /factsheet-share/${TOKEN}` }],
        },
      });
      const fixtureJson = JSON.stringify(event);
      errorSpy.mockClear();

      const out = deliver<
        Replacement & {
          tags?: Record<string, string>;
          fingerprint?: string[];
          exception?: { values?: Array<{ type?: string; value?: string }> };
        }
      >(opts.beforeSend, event);

      expect(out.message).toBe(WITHHELD_MARKER);
      expect(out.tags).toEqual({ scrub_withheld: "root" });
      expect(out.fingerprint).toEqual(["beforeSend-withheld", "root", "TypeError"]);
      expect(out.exception?.values).toEqual([{ type: "TypeError" }]);
      expectNoToken(fixtureJson, out);
      expect(errorSpy).toHaveBeenCalledWith("[beforeSend] withheld event", {
        event_id: "0123456789abcdef0123456789abcdef",
        reason: "root",
      });
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(TOKEN);
    });

    it("a throw out of the walk is a DISTINCT, tagged, logged replacement, not the token-case marker", async () => {
      const opts = await registeredInitOptions();
      // `Array.isArray` on a revoked Proxy throws inside the walk.
      const { proxy, revoke } = Proxy.revocable({}, {});
      revoke();
      errorSpy.mockClear();

      const out = deliver<
        Replacement & { tags?: Record<string, string>; fingerprint?: string[] }
      >(opts.beforeSend, proxy);

      expect(out.message).not.toBe(WITHHELD_MARKER);
      expect(out.message).toBe("[beforeSend] event content withheld: the scrub itself failed");
      // WR-10: the class name of what threw (`Array.isArray` on a revoked
      // Proxy throws a TypeError) rides into the event and the log line, so a
      // future bug in the walk is findable. Class name only, never a message.
      expect(out.tags).toEqual({ scrub_withheld: "caught", scrub_error: "TypeError" });
      expect(out.fingerprint).toEqual(["beforeSend-withheld", "caught"]);
      expect(errorSpy).toHaveBeenCalledWith("[beforeSend] withheld event", {
        event_id: null,
        reason: "caught",
        error: "TypeError",
      });
    });

    /**
     * Phase 209 / WR-06. One stuck slot used to wipe its whole container, so a
     * single unscrubbable tag took the alert-routing `route`/`stage` tags with
     * it. The rebuild keeps every readable sibling, omits only the unreadable
     * key, marks the object, and says so in the log without any content.
     */
    it("a stuck tag no longer wipes its siblings: they survive, the unreadable key is omitted, the object is marked and a content-free line is logged", async () => {
      const opts = await registeredInitOptions();
      const event = tokenEvent();
      const tags: Record<string, unknown> = {
        route: "/api/keys/validate-and-encrypt",
        stage: "persist",
        url: `https://quantalyze.xyz/factsheet-share/${TOKEN}`,
      };
      Object.defineProperty(tags, "boom", {
        enumerable: true,
        get: () => {
          throw new Error("hostile getter");
        },
      });
      event.tags = Object.freeze(tags) as unknown as typeof event.tags;
      const fixtureJson = JSON.stringify({ ...event, tags: undefined });
      errorSpy.mockClear();

      const out = deliver(opts.beforeSend, event);

      expectNoToken(fixtureJson, out);
      expect(out.tags).toEqual({
        route: "/api/keys/validate-and-encrypt",
        stage: "persist",
        url: `https://quantalyze.xyz${PLACEHOLDER}`,
        // WR-11: one unreadable key was omitted, and the marker says how many.
        scrub_rebuilt: "omitted=1",
      });
      expect(out.tags).not.toHaveProperty("boom");
      // The line carries a handle (event id, top-level channel) and the count,
      // and still nothing from the event.
      expect(errorSpy).toHaveBeenCalledWith(
        "[beforeSend] an unscrubbable value was rebuilt in place",
        { event_id: null, channel: "tags", omitted: 1 },
      );
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("route");
    });

    /**
     * Phase 209 / WR-11. The rebuild drops a value past the depth cap, and the
     * marker used to be a constant "true" whether it dropped anything or not. It
     * now counts, and the log line names the event and the channel.
     */
    it("a rebuild that drops a too-deep value says so: the marker counts it and the log line names the event and the channel", async () => {
      const opts = await registeredInitOptions();
      const event = tokenEvent() as ReturnType<typeof tokenEvent> & { event_id: string };
      event.event_id = "0123456789abcdef0123456789abcdef";
      let deep: Record<string, unknown> = { leaf: "x" };
      for (let i = 0; i < 10; i++) deep = { n: deep };
      event.extra = Object.freeze({
        path: `/factsheet-share/${TOKEN}`,
        deep,
      }) as unknown as typeof event.extra;
      const fixtureJson = JSON.stringify(event);
      errorSpy.mockClear();

      const out = deliver(opts.beforeSend, event);

      expectNoToken(fixtureJson, out);
      expect(out.extra).toMatchObject({ path: PLACEHOLDER, scrub_rebuilt: "omitted=1" });
      expect(errorSpy).toHaveBeenCalledWith(
        "[beforeSend] an unscrubbable value was rebuilt in place",
        {
          event_id: "0123456789abcdef0123456789abcdef",
          channel: "extra",
          omitted: 1,
        },
      );
    });

    /**
     * Phase 209 / WR-03. Sentry ingest drops a transaction whose
     * `contexts.trace` lacks `trace_id`/`span_id`, so a withhold that blanked
     * the trace to `{}` lost the report. The WR-06 rebuild copies the two ids,
     * so both the "trace itself is stuck" and the "contexts is stuck" paths keep
     * them on a transaction.
     */
    const TRACE_ID = "0123456789abcdef0123456789abcdef";
    const SPAN_ID = "0123456789abcdef";
    it.each(["contexts.trace", "contexts"] as const)(
      "a frozen %s holding the token on a transaction keeps trace_id and span_id so it still ingests",
      async (frozen) => {
        const opts = await registeredInitOptions();
        const trace = {
          trace_id: TRACE_ID,
          span_id: SPAN_ID,
          description: `GET /factsheet-share/${TOKEN}`,
        };
        const event = {
          type: "transaction",
          transaction: "GET /browse",
          start_timestamp: 1700000000.5,
          timestamp: 1700000001.5,
          contexts: frozen === "contexts.trace"
            ? { trace: Object.freeze(trace) }
            : deepFreeze({ trace }),
        };
        const fixtureJson = JSON.stringify(event);

        const out = deliver<typeof event>(opts.beforeSendTransaction, event);

        expectNoToken(fixtureJson, out);
        expect(out.type).toBe("transaction");
        expect(out.contexts.trace.trace_id).toBe(TRACE_ID);
        expect(out.contexts.trace.span_id).toBe(SPAN_ID);
        expect(out.contexts.trace.description).toBe(`GET ${PLACEHOLDER}`);
      },
    );

    /**
     * Phase 209 / WR-02. The contract says the original event is never returned
     * with a token, so the scrub walks EVERY top-level key. Each channel below
     * is one the SDK really emits (or a malformed shape of one) and none of
     * them was named by the earlier enumerated steps.
     */
    const URL_WITH_TOKEN = `https://quantalyze.xyz/factsheet-share/${TOKEN}`;
    it.each([
      ["request.headers.referer", (e: Record<string, unknown>) => { e.request = { url: "https://quantalyze.xyz/x", headers: { referer: URL_WITH_TOKEN } }; }],
      ["request.query_string", (e: Record<string, unknown>) => { e.request = { query_string: `next=/factsheet-share/${TOKEN}` }; }],
      ["request.data", (e: Record<string, unknown>) => { e.request = { data: { redirect: URL_WITH_TOKEN } }; }],
      ["exception.values[].value", (e: Record<string, unknown>) => { e.exception = { values: [{ type: "Error", value: `GET /factsheet-share/${TOKEN} failed` }] }; }],
      ["message", (e: Record<string, unknown>) => { e.message = `GET /factsheet-share/${TOKEN} failed`; }],
      ["logentry.message", (e: Record<string, unknown>) => { e.logentry = { message: `GET /factsheet-share/${TOKEN} failed` }; }],
      ["user", (e: Record<string, unknown>) => { e.user = { ip_address: "1.2.3.4", username: URL_WITH_TOKEN }; }],
      ["fingerprint[]", (e: Record<string, unknown>) => { e.fingerprint = ["{{ default }}", `/factsheet-share/${TOKEN}`]; }],
      ["contexts.<non-trace key>", (e: Record<string, unknown>) => { e.contexts = { app: { url: URL_WITH_TOKEN } }; }],
      ["a string where extra should be an object", (e: Record<string, unknown>) => { e.extra = URL_WITH_TOKEN; }],
      ["a string where tags should be an object", (e: Record<string, unknown>) => { e.tags = URL_WITH_TOKEN; }],
      ["a string where request should be an object", (e: Record<string, unknown>) => { e.request = URL_WITH_TOKEN; }],
      ["a string breadcrumb entry", (e: Record<string, unknown>) => { e.breadcrumbs = [URL_WITH_TOKEN]; }],
    ] as const)(
      "a token in %s is scrubbed",
      async (_label, plant) => {
        const opts = await registeredInitOptions();
        const event: Record<string, unknown> = { transaction: "GET /browse" };
        plant(event);
        const fixtureJson = JSON.stringify(event);

        const out = deliver<Record<string, unknown>>(opts.beforeSend, event);

        expectNoToken(fixtureJson, out);
        expect(out).toBe(event);
      },
    );
  });
});

/**
 * Phase 209 / WR-01. A PostgREST error object thrown raw from a server reader is
 * wrapped by Next as `new Error(JSON.stringify(obj))`, so `details` and `hint`
 * ride in the exception MESSAGE of what `onRequestError` captures. The hook must
 * hand Sentry a message built by the capture renderer, which never emits those
 * two fields.
 */
describe("[209 WR-01] onRequestError never ships PostgREST details/hint", () => {
  const DETAILS = "DETAILS-SENTINEL Key (email)=(victim@example.com) already exists";
  const HINT = "HINT-SENTINEL ask the founder";
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    saved.SENTRY_DSN = process.env.SENTRY_DSN;
    process.env.SENTRY_DSN = "https://publickey@o0.ingest.sentry.io/1";
    vi.clearAllMocks();
  });
  afterEach(() => {
    if (saved.SENTRY_DSN === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = saved.SENTRY_DSN;
  });

  const REQUEST = { path: "/allocations", method: "GET", headers: {} };
  const CONTEXT = {
    routerKind: "App Router",
    routePath: "/allocations",
    routeType: "render",
    renderSource: "react-server-components",
  };

  it("rebuilds a wrapped plain-object error without details/hint, keeping the stack and digest", async () => {
    const wrapped = Object.assign(
      new Error(
        JSON.stringify({
          code: "23505",
          message: "duplicate key value violates unique constraint",
          details: DETAILS,
          hint: HINT,
        }),
      ),
      { digest: "d-wr01" },
    );
    // Anti-vacuity: the fixture itself carries both sentinels.
    expect(wrapped.message).toContain("DETAILS-SENTINEL");
    expect(wrapped.message).toContain("HINT-SENTINEL");

    await onRequestError(wrapped, REQUEST, CONTEXT);

    expect(sentryCaptureExceptionMock).toHaveBeenCalledTimes(1);
    const [captured, opts] = sentryCaptureExceptionMock.mock.calls[0] as [
      Error & { digest?: string },
      unknown,
    ];
    expect(captured).toBeInstanceOf(Error);
    expect(captured.message).toContain("code=23505");
    expect(captured.message).toContain("duplicate key value");
    expect(captured.stack).toBe(wrapped.stack);
    expect(captured.digest).toBe("d-wr01");
    const everything = `${captured.message}${JSON.stringify(opts)}`;
    expect(everything).not.toContain("DETAILS-SENTINEL");
    expect(everything).not.toContain("HINT-SENTINEL");
    expect(everything).not.toContain("victim@example.com");
  });

  /**
   * Phase 209 / WR-12. The rebuild gate used to match ANY Error whose message
   * parsed to an object, which dropped a subclass name and `cause`, and replaced
   * an upstream JSON body with the opaque placeholder. It now matches only the
   * exact shape Next produces (a plain Error, no cause, a PostgREST-shaped
   * body), and tags the capture when it rebuilt.
   */
  it.each([
    ["a subclass of Error", () => Object.assign(new RangeError(JSON.stringify({ code: "23505", message: "m" })), { digest: "d" })],
    ["a subclass that keeps the name Error", () => new (class UpstreamError extends Error {})(JSON.stringify({ code: "23505", message: "m" }))],
    ["an Error with a cause", () => new Error(JSON.stringify({ code: "23505", message: "m" }), { cause: new Error("root") })],
    ["a JSON body with neither a string code nor a string message", () => new Error(JSON.stringify({ status: 502, upstream: "body" }))],
    ["a JSON body whose code and message are not strings", () => new Error(JSON.stringify({ code: 500, message: { nested: true } }))],
  ] as const)("passes %s through untouched and untagged", async (_label, make) => {
    const error = make() as Error & { digest?: string };
    await onRequestError(error, REQUEST, CONTEXT);
    const [captured, opts] = sentryCaptureExceptionMock.mock.calls[0] as [
      unknown,
      { tags: Record<string, unknown> },
    ];
    expect(captured).toBe(error);
    expect(opts.tags).not.toHaveProperty("message_rebuilt");
  });

  it("tags the capture message_rebuilt when it rebuilt the wrapper, and not otherwise", async () => {
    const wrapped: Error & { digest?: string } = new Error(
      JSON.stringify({ code: "23505", message: "dup", details: DETAILS, hint: HINT }),
    );
    const ordinary: Error & { digest?: string } = new Error("boom");
    await onRequestError(wrapped, REQUEST, CONTEXT);
    await onRequestError(ordinary, REQUEST, CONTEXT);
    const first = sentryCaptureExceptionMock.mock.calls[0] as [unknown, { tags: Record<string, unknown> }];
    const second = sentryCaptureExceptionMock.mock.calls[1] as [unknown, { tags: Record<string, unknown> }];
    expect(first[0]).not.toBe(wrapped);
    expect(first[1].tags.message_rebuilt).toBe("true");
    expect(second[1].tags).not.toHaveProperty("message_rebuilt");
  });

  it("passes an ordinary error through untouched, including one whose message starts with a brace", async () => {
    const plain: Error & { digest?: string } = new Error("boom");
    const braced: Error & { digest?: string } = new Error("{ not json");
    await onRequestError(plain, REQUEST, CONTEXT);
    await onRequestError(braced, REQUEST, CONTEXT);
    expect(sentryCaptureExceptionMock.mock.calls[0][0]).toBe(plain);
    expect(sentryCaptureExceptionMock.mock.calls[1][0]).toBe(braced);
  });
});

/**
 * 164.6.5 review round 1 / WR-07. Plan 07 made the wizard's `X-Correlation-Id`
 * per-REQUEST and moved the stable per-page-load id onto its own
 * `X-Wizard-Page-Load-Id` header "so nothing loses the page-load join" — and
 * then no server code read that header. This hook is the one server sink that
 * sees every request's headers, so the page-load id rides here as its own tag,
 * beside the per-request `correlation_id`, and two failures from one open tab
 * can be grouped again.
 */
describe("[164.6.5 WR-07] onRequestError carries the wizard page-load id", () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    saved.SENTRY_DSN = process.env.SENTRY_DSN;
    process.env.SENTRY_DSN = "https://publickey@o0.ingest.sentry.io/1";
    vi.clearAllMocks();
  });
  afterEach(() => {
    if (saved.SENTRY_DSN === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = saved.SENTRY_DSN;
  });

  const CONTEXT = {
    routerKind: "App Router",
    routePath: "/api/strategies/create-with-key",
    routeType: "route",
    renderSource: "react-server-components",
  };

  // Next's DOCUMENTED type for `request.headers` (instrumentation.md,
  // `onRequestError`): `{ [key: string]: string | string[] }`. The helper takes
  // that type, not the narrower one, so an array value is expressible here.
  async function tagsFor(headers: { [key: string]: string | string[] }) {
    await onRequestError(
      { digest: "d1" },
      { path: "/api/strategies/create-with-key", method: "POST", headers },
      CONTEXT,
    );
    expect(sentryCaptureExceptionMock).toHaveBeenCalledTimes(1);
    return (
      sentryCaptureExceptionMock.mock.calls[0][1] as {
        tags: Record<string, string | null>;
      }
    ).tags;
  }

  it("a well-formed page-load id becomes its own tag, beside the per-request id", async () => {
    const tags = await tagsFor({
      "x-correlation-id": "wizard:11111111-1111-4111-8111-111111111111",
      "x-wizard-page-load-id": "wizard:22222222-2222-4222-8222-222222222222",
    });
    expect(tags.wizard_page_load_id).toBe(
      "wizard:22222222-2222-4222-8222-222222222222",
    );
    expect(tags.correlation_id).toBe(
      "wizard:11111111-1111-4111-8111-111111111111",
    );
  });

  /**
   * ⛔ CORRECTED 2026-09-25 (164.6.5 review round 2 / R2-SFH-11). This case
   * used to assert `null` for absent, empty AND malformed alike, so Sentry
   * could not tell "the client sent no header" (an old bundle) from "the
   * client sent a bad one" (a bug). Absent stays `null`; a present header that
   * fails the shape check is the fixed sentinel `<malformed>`. The sentinel's
   * angle brackets are outside the shape allowlist, so no client can send a
   * value that reads as it, and the client's own value is still never echoed.
   */
  it("an absent page-load id is null; an empty or malformed one is the fixed <malformed> sentinel, never echoed", async () => {
    expect((await tagsFor({})).wizard_page_load_id).toBeNull();
    vi.clearAllMocks();
    expect(
      (await tagsFor({ "x-wizard-page-load-id": "" })).wizard_page_load_id,
    ).toBe("<malformed>");
    vi.clearAllMocks();
    // Client-supplied, so CR/LF or whitespace must never reach a tag.
    const crlf = (await tagsFor({ "x-wizard-page-load-id": "wizard:a\r\nx: y" }))
      .wizard_page_load_id;
    expect(crlf).toBe("<malformed>");
    expect(crlf).not.toContain("wizard:a");
  });

  /**
   * 164.6.5 review round 2 / IN-03. Next documents `request.headers` values as
   * `string | string[]`. The hook used to declare `Record<string, string>` and
   * call `.trim()` on the value, so an array would have thrown INSIDE the error
   * hook and lost that capture. Node joins duplicate custom headers into one
   * string today, which is why this never fired; the narrowed type hid it.
   */
  it("an ARRAY-valued header does not throw inside the hook: the capture still happens, page-load id is <malformed>, correlation id is null", async () => {
    const tags = await tagsFor({
      "x-correlation-id": ["wizard:a", "wizard:b"],
      "x-wizard-page-load-id": [
        "wizard:22222222-2222-4222-8222-222222222222",
        "wizard:33333333-3333-4333-8333-333333333333",
      ],
    });
    expect(tags.wizard_page_load_id).toBe("<malformed>");
    // A tag value must be a primitive; an array is not a correlation id.
    expect(tags.correlation_id).toBeNull();
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

/**
 * Phase 209 / CR-01 + CR-02 (D-17, D-18) — proven through the REAL SDK.
 *
 * A fixture-only test missed both leaks, because both live in what the SDK does
 * between `Sentry.init` and the wire, not in `scrubSentryEvent`. So these cases
 * take the options `register()` REALLY hands to `Sentry.init` (read off the
 * mock above), start the REAL `@sentry/nextjs` with them and an in-memory
 * transport, and read the SERIALISED envelope the transport receives.
 *
 * Two test-only overrides, both outside what is under test: `tracesSampleRate`
 * is 1 so the span is sampled, and `transport` captures instead of sending.
 * `traceLifecycle`, `beforeBreadcrumb`, `beforeSend` and `beforeSendTransaction`
 * are the registered ones, untouched.
 */
describe("[209 CR-01/CR-02] the registered Sentry options, through the real SDK envelope", () => {
  const TOKEN = "Xk3pQ9vLm2Rt7Wb1Yz4Nc6Hs8Jd0Fg5Aq3Ue7Ip9Ov";
  const RAW_PATH = `/factsheet-share/${TOKEN}`;
  const DETAILS = "DETAILS-SENTINEL Key (email)=(victim@example.com) already exists";
  const HINT = "HINT-SENTINEL ask the founder";

  type EnvelopeItem = [{ type?: string }, Record<string, unknown>];
  type Envelope = [unknown, EnvelopeItem[]];

  let real: typeof import("@sentry/nextjs");
  let envelopes: Envelope[];
  /** The `sdkProcessingMetadata` object of every transaction the hook saw. */
  let metadataSeen: Array<Record<string, unknown>>;
  const saved: Record<string, string | undefined> = {};

  beforeEach(async () => {
    for (const k of ["SENTRY_DSN", "VERCEL_ENV"]) saved[k] = process.env[k];
    vi.clearAllMocks();
    envelopes = [];
    metadataSeen = [];
    real = await vi.importActual<typeof import("@sentry/nextjs")>("@sentry/nextjs");
    process.env.SENTRY_DSN = "https://publickey@o0.ingest.sentry.io/1";
    process.env.VERCEL_ENV = "preview";
    await register();
    expect(sentryInitMock).toHaveBeenCalledTimes(1);
    const registered = sentryInitMock.mock.calls[0][0] as Record<string, unknown> & {
      beforeSendTransaction: (e: unknown) => unknown;
    };
    real.init({
      ...registered,
      tracesSampleRate: 1,
      // Only records what the REGISTERED hook is handed, then runs it.
      beforeSendTransaction: (e: unknown) => {
        metadataSeen.push(
          (e as { sdkProcessingMetadata: Record<string, unknown> }).sdkProcessingMetadata,
        );
        return registered.beforeSendTransaction(e);
      },
      transport: () => ({
        send: async (envelope: unknown) => {
          envelopes.push(envelope as Envelope);
          return {};
        },
        flush: async () => true,
      }),
    } as Parameters<typeof real.init>[0]);
  });
  afterEach(async () => {
    await real.close();
    for (const k of ["SENTRY_DSN", "VERCEL_ENV"]) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  const itemTypes = () =>
    envelopes.flatMap((e) => e[1].map((item) => item[0].type));

  it("CR-01: a span on the share path ships as a scrubbed TRANSACTION, never as a streamed span with the raw token", async () => {
    await real.startSpan({ name: `GET ${RAW_PATH}` }, async () => {});
    await real.flush(2000);

    // The streamed lifecycle sends `span` items and never calls
    // `beforeSendTransaction`. Anti-vacuity: the scrub is only reachable when
    // the item is a transaction.
    expect(itemTypes()).toContain("transaction");
    expect(itemTypes()).not.toContain("span");
    const serialized = JSON.stringify(envelopes);
    expect(serialized).not.toContain(TOKEN);
    expect(serialized).toContain("/factsheet-share/[token]");
    // The SDK deletes `sdkProcessingMetadata` before serialising.
    expect(serialized).not.toContain("sdkProcessingMetadata");
  });

  it("CR-01 / IN-05: the walk leaves the live Scope in sdkProcessingMetadata untouched", async () => {
    await real.withScope(async (scope) => {
      // A share path on the scope the transaction captures. The event's own
      // copy of this tag is scrubbed legitimately; the live scope must not be
      // written to.
      scope.setTag("probe", RAW_PATH);
      await real.startSpan({ name: "GET /browse" }, async () => {});
    });
    await real.flush(2000);

    expect(itemTypes()).toContain("transaction");
    expect(metadataSeen).toHaveLength(1);
    const captured = metadataSeen[0].capturedSpanScope as import("@sentry/nextjs").Scope;
    // Anti-vacuity: the live scope really is reachable and really holds the tag.
    expect(captured.getScopeData().tags.probe).toBe(RAW_PATH);
    expect(captured.getClient()).toBeDefined();
    // ...and the envelope still carries no raw token.
    expect(JSON.stringify(envelopes)).not.toContain(TOKEN);
  });

  it("CR-02: a seam log line with details/hint never rides a captured event as a console breadcrumb", async () => {
    const pgError = {
      code: "23505",
      message: "duplicate key value",
      details: DETAILS,
      hint: HINT,
    };
    await real.withIsolationScope(async () => {
      // The seam LOG renderer keeps details/hint on purpose (D-03).
      console.error("[route] rpc error:", scrubSeamError(pgError), pgError.code);
      real.addBreadcrumb({ category: "ui.click", message: "kept-breadcrumb" });
      real.captureException(new Error("boom"));
    });
    await real.flush(2000);

    const event = envelopes
      .flatMap((e) => e[1])
      .find((item) => item[0].type === "event")?.[1] as
      | { breadcrumbs?: Array<{ category?: string; message?: string }> }
      | undefined;
    expect(event).toBeDefined();
    const serialized = JSON.stringify(envelopes);
    expect(serialized).not.toContain("DETAILS-SENTINEL");
    expect(serialized).not.toContain("HINT-SENTINEL");
    expect(serialized).not.toContain("victim@example.com");
    // Anti-vacuity: breadcrumbs ARE recorded, and only the console ones go.
    expect(event!.breadcrumbs?.map((b) => b.message)).toEqual(["kept-breadcrumb"]);
    expect(event!.breadcrumbs?.some((b) => b.category === "console")).toBe(false);
  });

  it("CR-02: beforeBreadcrumb returns null for console crumbs and the SAME object for every other category", () => {
    const registered = sentryInitMock.mock.calls[0][0] as {
      beforeBreadcrumb?: (crumb: { category?: string }) => unknown;
    };
    expect(registered.beforeBreadcrumb!({ category: "console" })).toBeNull();
    for (const category of ["ui.click", "navigation", "http", undefined]) {
      const crumb = { category, message: "m" };
      expect(registered.beforeBreadcrumb!(crumb)).toBe(crumb);
    }
  });
});
