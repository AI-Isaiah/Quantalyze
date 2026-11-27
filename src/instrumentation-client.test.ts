import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Phase 221 SENTRYSCRUB2 / SCRB-02 — the browser Sentry init, exercised for real.
//
// WHY THE MOCK. Under vitest `@sentry/nextjs` resolves to the SERVER build even
// in the jsdom project (measured, RESEARCH Q4), so a test that called its
// `init` would exercise the Node SDK, not the browser one. The module is
// therefore aliased to `@sentry/browser`, and its `init` is a wrapper that
// records the options the file registered and passes them on UNTOUCHED apart
// from an in-memory `transport`. `src/instrumentation-client.ts` runs for real
// against the real browser SDK, and `captureToSentry`'s own dynamic
// `import("@sentry/nextjs")` resolves to the same mock, so it reaches the same
// client the init created.
//
// DECLARED LIMIT: @sentry/nextjs's own client wrapper (its BrowserTracing push,
// the Next frame normaliser, the redirect filter) is outside this loop. The
// real bundler is covered by plan 05's build smoke.
type Envelope = [unknown, Array<[{ type?: string }, Record<string, unknown>]>];

const h = vi.hoisted(() => ({
  envelopes: [] as unknown[],
  initOptions: [] as Array<Record<string, unknown>>,
}));

vi.mock("@sentry/nextjs", async () => {
  const browser = await vi.importActual<typeof import("@sentry/browser")>("@sentry/browser");
  return {
    ...browser,
    init: (options: Record<string, unknown>) => {
      h.initOptions.push(options);
      return browser.init({
        ...options,
        transport: () => ({
          send: async (envelope: unknown) => {
            h.envelopes.push(envelope);
            return {};
          },
          flush: async () => true,
        }),
      } as Parameters<typeof browser.init>[0]);
    },
  };
});

const DSN = "https://publickey@o0.ingest.de.sentry.io/1";
/** 43 base64url characters, typed by hand (the `[164 SHARE-01]` harness's value). */
const TOKEN = ["Xk3pQ9vLm2", "Rt7Wb1Yz4N", "c6Hs8Jd0Fg", "5Aq3Ue7Ip9", "Ov1"].join("");
/** Any 43-char base64url run at all, to catch a partially scrubbed leak. */
const TOKEN_SHAPED = /[A-Za-z0-9_-]{43}/;
const DETAILS = "DETAILS-SENTINEL Key (email)=(victim@example.com) already exists";
const HINT = "HINT-SENTINEL ask the founder";

// The fetch breadcrumb case needs the SDK's REAL fetch instrumentation (which
// filters the URL), not Sentry.addBreadcrumb, which would bypass it. That
// instrumentation wraps the global fetch ONCE per process: @sentry/core is an
// external module that vi.resetModules() does not reset, so a fetch stubbed
// inside a case would arrive after the first init had already wrapped the real
// one. The stub is therefore installed here, before any init, and it presents
// itself as native because the SDK only instruments a native-looking fetch.
// No network is touched. Test files are isolated, so this reaches no other file.
const stubbedFetch = async () => new Response("{}");
stubbedFetch.toString = () => "function fetch() { [native code] }";
globalThis.fetch = stubbedFetch as unknown as typeof fetch;

const loadInit = () => import("./instrumentation-client");
const sentry = () => import("@sentry/nextjs");

/** The `event` items of every envelope the transport received. */
const eventItems = () =>
  (h.envelopes as Envelope[])
    .flatMap((e) => e[1])
    .filter((item) => item[0].type === "event")
    .map((item) => item[1]);

beforeEach(() => {
  vi.resetModules();
  h.envelopes.length = 0;
  h.initOptions.length = 0;
  vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", DSN);
  vi.stubEnv("NEXT_PUBLIC_SENTRY_ENVIRONMENT", "preview");
});

afterEach(async () => {
  await (await sentry()).close();
  vi.restoreAllMocks();
  window.history.pushState({}, "", "/");
});

describe("[221 SCRB-02] a capture in browser code reaches Sentry through the client init", () => {
  // SC-3: until this init existed every captureToSentry call in browser code was
  // a silent no-op ([167.2.1-CLIENT-SENTRY-NOOP], closed and deleted from
  // TODOS.md by Phase 221, 2026-11-27: lineage only). The call below goes through a
  // real "use client" module, so it fails if either half is missing.
  it("setStorageRecoveryFlag in a use-client module produces one tagged warning event", async () => {
    await loadInit();
    const { setStorageRecoveryFlag } = await import("@/lib/storage/cross-tab");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });

    setStorageRecoveryFlag("221-recovery-key", "corrupt", "221-area");
    // The caller does not return captureToSentry's promise, so wait for the wire.
    await vi.waitFor(() => expect(eventItems()).toHaveLength(1));

    const event = eventItems()[0] as {
      level?: string;
      environment?: string;
      tags?: Record<string, string>;
    };
    expect(event.tags).toMatchObject({ area: "221-area", reason: "recovery_write_failed" });
    expect(event.level).toBe("warning");
    // CONTEXT research correction: the environment is the inlined name, never the
    // SDK's "production" default.
    expect(event.environment).toBe("preview");
  });

  it("a direct captureToSentry carries a share path as /factsheet-share/[token], never the token", async () => {
    await loadInit();
    const { captureToSentry } = await import("@/lib/sentry-capture");
    await captureToSentry(new Error("221 browser capture"), {
      tags: { area: "221" },
      extra: { path: `/factsheet-share/${TOKEN}` },
    });
    await (await sentry()).flush(2000);

    expect(eventItems()).toHaveLength(1);
    const serialized = JSON.stringify(h.envelopes);
    // Anti-vacuity: the extra really travelled, in scrubbed form.
    expect(serialized).toContain("/factsheet-share/[token]");
    expect(serialized).not.toContain(TOKEN);
    expect(serialized).not.toMatch(TOKEN_SHAPED);
  });
});

describe("[221 SCRB-02] the browser init opens no extra channel and runs the server's scrub", () => {
  const registered = () => h.initOptions[0] as Record<string, unknown> & {
    beforeSend: unknown;
    beforeSendTransaction: unknown;
    beforeBreadcrumb: (crumb: { category?: string }) => unknown;
    integrations: (defaults: Array<{ name: string }>) => Array<{ name: string }>;
  };

  // CONTEXT [Code layout]: ONE scrub function for every runtime. A parallel copy
  // in the browser would drift. `toBe`, not `toEqual` or a name check, and the
  // scrub comes from a dynamic import AFTER the init loaded with no
  // resetModules between, so both sides share one module instance.
  it("beforeSend and beforeSendTransaction ARE scrubSentryEvent, and no extra channel is configured", async () => {
    await loadInit();
    const { scrubSentryEvent } = await import("@/lib/sentry-scrub");

    expect(h.initOptions).toHaveLength(1);
    const options = registered();
    expect(options.beforeSend).toBe(scrubSentryEvent);
    expect(options.beforeSendTransaction).toBe(scrubSentryEvent);
    // Research correction: static lifecycle, or streamed spans skip the hook.
    expect(options.traceLifecycle).toBe("static");
    expect(options.dataCollection).toEqual({ userInfo: false, urlQueryParams: false });
    expect(options.dsn).toBe(DSN);
    expect(options.environment).toBe("preview");
    for (const key of [
      "tracesSampleRate",
      "tracesSampler",
      "replaysSessionSampleRate",
      "replaysOnErrorSampleRate",
      "tunnel",
      "sendDefaultPii",
    ]) {
      expect(Object.keys(options)).not.toContain(key);
    }
    // The whole option set, so an added option is a deliberate, reviewed change.
    expect(Object.keys(options).sort()).toEqual(
      [
        "beforeBreadcrumb",
        "beforeSend",
        "beforeSendTransaction",
        "dataCollection",
        "dsn",
        "environment",
        "integrations",
        "traceLifecycle",
      ].sort(),
    );
  });

  // CONTEXT Client channel shape: console breadcrumbs are dropped exactly as the
  // server does, because the seam LOG renderer keeps details/hint on purpose.
  it("beforeBreadcrumb returns null for console crumbs and the SAME object for every other category", async () => {
    await loadInit();
    const { beforeBreadcrumb } = registered();
    expect(beforeBreadcrumb({ category: "console" })).toBeNull();
    for (const category of ["navigation", "ui.click", "http", undefined]) {
      const crumb = { category, message: "m" };
      expect(beforeBreadcrumb(crumb)).toBe(crumb);
    }
  });

  // Research correction: BrowserTracing (spans, trace headers) and BrowserSession
  // (a session envelope on every page load) are filtered out of the defaults.
  it("the integrations filter drops BrowserTracing and BrowserSession and keeps the rest", async () => {
    await loadInit();
    const defaults = [
      { name: "BrowserTracing" },
      { name: "BrowserSession" },
      { name: "Breadcrumbs" },
      { name: "GlobalHandlers" },
    ];
    expect(registered().integrations(defaults)).toStrictEqual([defaults[2], defaults[3]]);
  });

  it("on the live client BrowserSession is absent while Breadcrumbs and GlobalHandlers are present", async () => {
    await loadInit();
    const client = (await sentry()).getClient();
    // Anti-vacuity: the SDK DOES ship BrowserSession by default, so absence here
    // is the filter's doing, and the handlers we rely on are present.
    expect(client?.getIntegrationByName("BrowserSession")).toBeUndefined();
    expect(client?.getIntegrationByName("Breadcrumbs")).toBeDefined();
    expect(client?.getIntegrationByName("GlobalHandlers")).toBeDefined();
  });

  // CONTEXT research correction: the environment is set explicitly, because the
  // browser SDK would file a preview event as "production".
  it("with no inlined environment the init reports development", async () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_ENVIRONMENT", undefined);
    vi.resetModules();
    await loadInit();
    expect(registered().environment).toBe("development");
  });

  // CONTEXT [DSN source]: with no DSN nothing is inlined, so no browser init.
  it("with no DSN the module calls Sentry.init zero times and exports nothing", async () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", undefined);
    vi.resetModules();
    const mod = await loadInit();
    expect(h.initOptions).toHaveLength(0);
    expect(Object.keys(mod)).toEqual([]);
  });

  // SCRB-01 arm, carried to the browser by the shared hook (SC-2). Sentinel
  // VALUES are asserted absent: the SDK's exception text lists key NAMES.
  it("a captured plain PostgREST object ships neither details nor hint", async () => {
    await loadInit();
    const s = await sentry();
    s.captureException({
      code: "23505",
      message: "duplicate key value",
      details: DETAILS,
      hint: HINT,
    });
    await s.flush(2000);

    // Anti-vacuity: the fixture holds the sentinels, and the non-Error path ran.
    expect(DETAILS).toContain("DETAILS-SENTINEL");
    expect(HINT).toContain("HINT-SENTINEL");
    const event = eventItems()[0] as { extra?: { __serialized__?: Record<string, unknown> } };
    expect(event.extra?.__serialized__?.code).toBe("23505");
    const serialized = JSON.stringify(h.envelopes);
    expect(serialized).not.toContain("DETAILS-SENTINEL");
    expect(serialized).not.toContain("HINT-SENTINEL");
    expect(serialized).not.toContain("victim@example.com");
  });

  // T-221-13 / T-221-14: the URL bar reaches an event by request.url and by the
  // navigation breadcrumb. The share token goes through the shared scrub and the
  // PKCE code through dataCollection.urlQueryParams.
  it("a navigation to a share URL with a PKCE code ships no token and no code", async () => {
    await loadInit();
    window.history.pushState({}, "", `/factsheet-share/${TOKEN}?code=AUTHCODE-SENTINEL#frag`);
    const s = await sentry();
    s.captureException(new Error("221 after navigation"));
    await s.flush(2000);

    const event = eventItems()[0] as {
      environment?: string;
      request?: { url?: string };
      breadcrumbs?: Array<{ category?: string }>;
    };
    // Anti-vacuity: both URL-bearing channels are present in the event.
    expect(event.request?.url).toBeDefined();
    expect(event.breadcrumbs?.some((b) => b.category === "navigation")).toBe(true);
    const serialized = JSON.stringify(h.envelopes);
    expect(serialized).toContain("/factsheet-share/[token]");
    expect(serialized).not.toContain(TOKEN);
    expect(serialized).not.toContain("AUTHCODE-SENTINEL");
    expect(event.environment).toBe("preview");
  });

  // Orchestrator addendum 2026-11-27: a PostgREST query string rides a fetch
  // breadcrumb's data.url, and the SDK filters it through dataCollection.
  it("a fetch breadcrumb URL carries no query string", async () => {
    await loadInit();
    await fetch("https://project.example.test/rest/v1/trades?select=*&id=eq.QUERY-SENTINEL");
    const s = await sentry();
    s.captureException(new Error("221 after fetch"));
    await s.flush(2000);

    const event = eventItems()[0] as {
      breadcrumbs?: Array<{ category?: string; data?: { url?: string } }>;
    };
    const crumb = event.breadcrumbs?.find((b) => b.category === "fetch");
    // Anti-vacuity: the fetch crumb exists and still names the endpoint.
    expect(crumb?.data?.url).toContain("/rest/v1/trades");
    expect(crumb?.data?.url).not.toContain("?");
    expect(JSON.stringify(h.envelopes)).not.toContain("QUERY-SENTINEL");
  });
});
