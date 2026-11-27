/**
 * Phase 164.9.4 / CIOFFMUTEX D-14 — the configured Supabase origin is derived
 * into the CSP `connect-src`, asserted on the RESOLVED header table rather than
 * on the config file's text.
 *
 * WHY THIS EXISTS. The seeded e2e suite moves onto a private local Supabase
 * stack whose API answers on a LOOPBACK origin (`http://127.0.0.1:<port>`). The
 * site-wide `connect-src` allows only `'self'`, `https://*.supabase.co`,
 * `wss://*.supabase.co` and `https://plausible.io`, so a browser build inlined
 * with the loopback URL had every sign-in refused by the header. D-14 rejected
 * `bypassCSP` for that run: it would leave the seeded suite unable to catch a
 * CSP edit that breaks production login, a user-facing gate turned vacuous.
 * Instead `next.config.ts` appends the configured origin (and its `ws:`/`wss:`
 * twin) ONLY when no existing source already matches it.
 *
 * So the three things this file pins are:
 *   1. A loopback build gains exactly its origin and the ws twin, nothing else.
 *   2. A production-shaped build, the `frontend-build` placeholder build, and
 *      an unset, empty or unparseable value all emit a header BYTE-IDENTICAL to
 *      the hand-typed literal below. Production is not widened.
 *   3. An env value that would inject a CSP token (`;`, `'`, `,`, `*` in the
 *      host) or carries a non-http scheme emits the literal unchanged. WHATWG
 *      `new URL()` accepts `http://a;b.example` and decodes `%27` to `'` in a
 *      host, so without the hostname charset guard an env value could add a
 *      directive.
 *
 * WHAT THIS TEST CAN AND CANNOT DO. It calls the real `headers()` from
 * `next.config.ts` with `NEXT_PUBLIC_SUPABASE_URL` stubbed per case, and
 * asserts on the entries Next will consume. It CANNOT prove what a deployed
 * response carries, or what a `next build` serialised into its routes
 * manifest; that is the seeded e2e run on the lane (plan 08), which fails at
 * login if the header refuses the lane.
 *
 * The CSP literal is typed by hand and never read back from the config under
 * test, so an edit to the production header reds here as well as in
 * `critical-regressions.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import nextConfig from "../../../next.config";

/** Oracles typed by hand — never read back from the config under test. */
const GLOBAL_SOURCE = "/(.*)";
const CSP_KEY = "Content-Security-Policy";
const ENV = "NEXT_PUBLIC_SUPABASE_URL";
const CSP_LITERAL =
  "default-src 'self'; worker-src 'self' blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://plausible.io; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://plausible.io";

type HeaderEntry = { key: string; value: string };
type HeaderBlock = { source: string; headers: HeaderEntry[] };

async function resolvedHeaderBlocks(): Promise<HeaderBlock[]> {
  expect(
    typeof nextConfig.headers,
    "next.config.ts must still define headers()",
  ).toBe("function");
  return (await nextConfig.headers!()) as unknown as HeaderBlock[];
}

/** The resolved CSP value of the global block, for the env as currently stubbed. */
async function globalCsp(): Promise<string | undefined> {
  const blocks = await resolvedHeaderBlocks();
  const block = blocks.find((b) => b.source === GLOBAL_SOURCE);
  expect(block, `no header block with source ${GLOBAL_SOURCE}`).toBeDefined();
  return block!.headers.find((h) => h.key === CSP_KEY)?.value;
}

// Phase 221: once the derivation reads a Sentry DSN, a developer or CI shell
// that carries one would turn every literal case below red (RESEARCH Pitfall 4).
// Both variables start unset in every case; a case that needs one stubs it.
beforeEach(() => {
  vi.stubEnv("SENTRY_DSN", undefined);
  vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("[164.9.4 D-14] configured Supabase origin in CSP connect-src", () => {
  it("loopback lane URL: literal plus the origin and its ws twin, nothing else", async () => {
    vi.stubEnv(ENV, "http://127.0.0.1:54421");
    expect(
      await globalCsp(),
      "D-14 loopback: a build inlined with the lane URL must be able to reach the lane",
    ).toBe(`${CSP_LITERAL} http://127.0.0.1:54421 ws://127.0.0.1:54421`);
  });

  it("loopback by name: localhost gets its origin and ws twin too", async () => {
    vi.stubEnv(ENV, "http://localhost:54421");
    expect(
      await globalCsp(),
      "D-14 localhost: the lane's by-name loopback origin must be reachable",
    ).toBe(`${CSP_LITERAL} http://localhost:54421 ws://localhost:54421`);
  });

  it("https non-matching origin: the twin is wss, with the same host and port", async () => {
    vi.stubEnv(ENV, "https://db.internal.example:8443");
    expect(
      await globalCsp(),
      "D-14 https twin: an https origin pairs with wss, never ws",
    ).toBe(
      `${CSP_LITERAL} https://db.internal.example:8443 wss://db.internal.example:8443`,
    );
  });

  it("production-shaped URL: the header is byte-identical to the literal", async () => {
    // An obviously fake label: this repo is public, so no real project ref.
    vi.stubEnv(ENV, "https://example-project.supabase.co");
    expect(
      await globalCsp(),
      "D-14 production: *.supabase.co already allows it, so production must not be widened",
    ).toBe(CSP_LITERAL);
  });

  it("frontend-build placeholder URL: the header is byte-identical to the literal", async () => {
    vi.stubEnv(ENV, "https://placeholder.supabase.co");
    expect(
      await globalCsp(),
      "D-14 placeholder: the frontend-build header must stay the literal",
    ).toBe(CSP_LITERAL);
  });

  it("unset, empty or unparseable value: the literal, never a throw or `undefined`", async () => {
    vi.stubEnv(ENV, undefined);
    expect(process.env[ENV], "the unset case must really be unset").toBeUndefined();
    expect(await globalCsp(), "D-14 unset: must be the literal").toBe(CSP_LITERAL);

    vi.stubEnv(ENV, "");
    expect(await globalCsp(), "D-14 empty: must be the literal").toBe(CSP_LITERAL);

    vi.stubEnv(ENV, "not a url");
    expect(await globalCsp(), "D-14 unparseable: must be the literal").toBe(
      CSP_LITERAL,
    );
  });

  // `new URL()` ACCEPTS every one of these hosts (measured: `a;b.example`,
  // `a'b.example` after decoding `%27`, `a,b.example`), so only the hostname
  // charset guard stands between the env value and an injected CSP token.
  async function expectLiteralFor(label: string, value: string) {
    vi.stubEnv(ENV, value);
    expect(
      await globalCsp(),
      `D-14 injection (${label}): ${value} must never reach the header`,
    ).toBe(CSP_LITERAL);
  }

  it("injection, semicolon in the host (directive injection): the literal", async () => {
    await expectLiteralFor("semicolon", "http://a;b.example");
  });

  it("injection, %27-decoded quote in the host (keyword injection): the literal", async () => {
    await expectLiteralFor("quote", "http://a%27b.example");
  });

  it("injection, comma in the host: the literal", async () => {
    await expectLiteralFor("comma", "http://a,b.example");
  });

  it("injection, asterisk in the host (a derived wildcard): the literal", async () => {
    await expectLiteralFor("asterisk", "http://a*b.example");
  });

  it("non-http scheme: the literal", async () => {
    await expectLiteralFor("ftp scheme", "ftp://127.0.0.1:54421");
  });

  it("anti-vacuity: the table is non-empty and the global block has exactly one CSP entry", async () => {
    vi.stubEnv(ENV, "http://127.0.0.1:54421");
    const blocks = await resolvedHeaderBlocks();
    expect(blocks.length, "D-14: the resolved header table is empty").toBeGreaterThan(0);
    const global = blocks.filter((b) => b.source === GLOBAL_SOURCE);
    expect(global, "D-14: exactly one global header block").toHaveLength(1);
    const csp = global[0].headers.filter((h) => h.key === CSP_KEY);
    expect(csp, "D-14: exactly one CSP entry in the global block").toHaveLength(1);
    // The derivation touches the global block only; no other block carries CSP.
    const elsewhere = blocks
      .filter((b) => b.source !== GLOBAL_SOURCE)
      .flatMap((b) => b.headers)
      .filter((h) => h.key === CSP_KEY);
    expect(elsewhere, "D-14: CSP must live in the global block only").toHaveLength(0);
  });
});

// Phase 221 SENTRYSCRUB2 / SCRB-02: the browser's Sentry DSN reaches the client
// bundle through next.config's `env` block, and the CSP `connect-src` admits
// exactly that DSN's ingest origin. The labels are FAKE on purpose: this repo is
// public, so no real DSN host or project id appears in tracked text.
const SENTRY_DSN_FAKE = "https://publickey@o0.ingest.de.sentry.io/1";
const SENTRY_ORIGIN_FAKE = "https://o0.ingest.de.sentry.io";
const SENTRY_DSN_ENV = "SENTRY_DSN";
const SENTRY_PUBLIC_DSN_ENV = "NEXT_PUBLIC_SENTRY_DSN";
const VERCEL_ENV_NAME = "VERCEL_ENV";

type FreshConfig = {
  env: Record<string, string | undefined> | undefined;
  headers: () => Promise<HeaderBlock[]>;
};

/** next.config re-imported under the CURRENT stubbed env: the `env` block is evaluated once, at load. */
async function freshConfig(): Promise<FreshConfig> {
  vi.resetModules();
  const mod = await import("../../../next.config");
  return {
    env: mod.default.env,
    headers: async () => (await mod.default.headers!()) as unknown as HeaderBlock[],
  };
}

describe("[221 SCRB-02] the browser's Sentry DSN and its ingest origin", () => {
  it("a DSN set at build: the CSP gains exactly its ingest origin and never the public key", async () => {
    vi.stubEnv(SENTRY_DSN_ENV, SENTRY_DSN_FAKE);
    const csp = await globalCsp();
    expect(
      csp,
      "221 SCRB-02: the browser must be able to reach the Sentry ingest host, and only that origin",
    ).toBe(`${CSP_LITERAL} ${SENTRY_ORIGIN_FAKE}`);
    expect(
      csp,
      "221 SCRB-02: the DSN's public key must never be copied into a response header",
    ).not.toContain("publickey");
  });

  it("a DSN set at build: env inlines the DSN and the build's environment, and the CSP admits that same origin", async () => {
    vi.stubEnv(SENTRY_DSN_ENV, SENTRY_DSN_FAKE);
    vi.stubEnv(VERCEL_ENV_NAME, "preview");
    const fresh = await freshConfig();
    expect(
      fresh.env?.[SENTRY_PUBLIC_DSN_ENV],
      "221 SCRB-02: browser code needs the DSN inlined from the server-side variable",
    ).toBe(SENTRY_DSN_FAKE);
    expect(
      fresh.env?.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
      "221 SCRB-02: a preview build's browser events must not be filed as production",
    ).toBe("preview");
    const block = (await fresh.headers()).find((b) => b.source === GLOBAL_SOURCE);
    const csp = block?.headers.find((h) => h.key === CSP_KEY)?.value;
    expect(
      csp?.endsWith(` ${new URL(fresh.env![SENTRY_PUBLIC_DSN_ENV]!).origin}`),
      "221 SCRB-02: the origin the CSP admits must be the origin of the DSN the bundle carries",
    ).toBe(true);
  });

  it("precedence: an explicit NEXT_PUBLIC_SENTRY_DSN wins over SENTRY_DSN, in the CSP and in the env block alike", async () => {
    const explicit = "https://publickey@o1.ingest.de.sentry.io/2";
    vi.stubEnv(SENTRY_DSN_ENV, SENTRY_DSN_FAKE);
    vi.stubEnv(SENTRY_PUBLIC_DSN_ENV, explicit);
    const fresh = await freshConfig();
    expect(
      fresh.env?.[SENTRY_PUBLIC_DSN_ENV],
      "221 SCRB-02 precedence: config env beats process env, so the explicit value must be chosen in the value itself",
    ).toBe(explicit);
    const block = (await fresh.headers()).find((b) => b.source === GLOBAL_SOURCE);
    expect(
      block?.headers.find((h) => h.key === CSP_KEY)?.value,
      "221 SCRB-02 precedence: the CSP must admit the explicit DSN's origin, never the shadowed one",
    ).toBe(`${CSP_LITERAL} https://o1.ingest.de.sentry.io`);
  });

  it("unset, empty or unparseable DSN: the literal, never a throw", async () => {
    expect(
      process.env[SENTRY_DSN_ENV],
      "the unset case must really be unset",
    ).toBeUndefined();
    expect(await globalCsp(), "221 SCRB-02 unset: must be the literal").toBe(
      CSP_LITERAL,
    );

    vi.stubEnv(SENTRY_DSN_ENV, "");
    expect(await globalCsp(), "221 SCRB-02 empty: must be the literal").toBe(
      CSP_LITERAL,
    );

    vi.stubEnv(SENTRY_DSN_ENV, "not a url");
    expect(
      await globalCsp(),
      "221 SCRB-02 unparseable: must be the literal",
    ).toBe(CSP_LITERAL);
  });

  it("neither variable set: nothing is inlined, so no browser init can happen", async () => {
    vi.stubEnv(VERCEL_ENV_NAME, "preview");
    const fresh = await freshConfig();
    expect(
      fresh.env?.[SENTRY_PUBLIC_DSN_ENV],
      "221 SCRB-02: with no DSN the client bundle must carry none",
    ).toBeUndefined();
    expect(
      fresh.env?.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
      "221 SCRB-02: an environment name without a DSN would be an orphan inline",
    ).toBeUndefined();
  });

  it("a DSN with no VERCEL_ENV: the environment is development", async () => {
    vi.stubEnv(SENTRY_DSN_ENV, SENTRY_DSN_FAKE);
    vi.stubEnv(VERCEL_ENV_NAME, undefined);
    const fresh = await freshConfig();
    expect(
      fresh.env?.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
      "221 SCRB-02: a local build must not claim production",
    ).toBe("development");
  });

  // The Sentry twin of expectLiteralFor: the DSN is the hostile input here.
  async function expectSentryLiteralFor(label: string, host: string) {
    const value = `https://publickey@${host}/1`;
    vi.stubEnv(SENTRY_DSN_ENV, value);
    expect(
      await globalCsp(),
      `221 SCRB-02 injection (${label}): ${value} must never reach the header`,
    ).toBe(CSP_LITERAL);
  }

  it("injection, semicolon in the host (directive injection): the literal", async () => {
    await expectSentryLiteralFor("semicolon", "a;b.example");
  });

  it("injection, %27-decoded quote in the host (keyword injection): the literal", async () => {
    await expectSentryLiteralFor("quote", "a%27b.example");
  });

  it("injection, comma in the host: the literal", async () => {
    await expectSentryLiteralFor("comma", "a,b.example");
  });

  it("injection, asterisk in the host (a derived wildcard): the literal", async () => {
    await expectSentryLiteralFor("asterisk", "a*b.example");
  });

  it("non-http scheme: the literal", async () => {
    vi.stubEnv(SENTRY_DSN_ENV, "ftp://publickey@o0.ingest.de.sentry.io/1");
    expect(
      await globalCsp(),
      "221 SCRB-02 injection (ftp scheme): a non-http DSN must never reach the header",
    ).toBe(CSP_LITERAL);
  });

  // SFH-M2: the `env` inline and the CSP must agree on what a usable DSN is. A DSN
  // the CSP refuses, inlined anyway, starts a browser init whose every send the
  // CSP then blocks, with no signal.
  it.each([
    ["ftp scheme", "ftp://publickey@o0.ingest.de.sentry.io/1"],
    ["underscore host", "https://publickey@o_0.ingest.de.sentry.io/1"],
  ])(
    "an unusable DSN (%s): nothing is inlined and the CSP is the literal, with one build warning that never prints the DSN",
    async (_label, dsn) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        vi.stubEnv(SENTRY_DSN_ENV, dsn);
        const fresh = await freshConfig();
        expect(
          fresh.env?.[SENTRY_PUBLIC_DSN_ENV],
          "221 SFH-M2: a DSN the CSP would block must not start a browser init",
        ).toBeUndefined();
        expect(
          fresh.env?.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
          "221 SFH-M2: no DSN inlined means no orphan environment inline either",
        ).toBeUndefined();
        const block = (await fresh.headers()).find((b) => b.source === GLOBAL_SOURCE);
        expect(
          block?.headers.find((h) => h.key === CSP_KEY)?.value,
          "221 SFH-M2: an unusable DSN leaves the CSP literal",
        ).toBe(CSP_LITERAL);
        expect(
          warn,
          "221 SFH-M2: a set-but-unusable DSN must be named once at build time, not fail silently",
        ).toHaveBeenCalledTimes(1);
        expect(
          String(warn.mock.calls[0]?.[0]),
          "221 SFH-M2: the warning must never carry the DSN or its key",
        ).not.toContain("publickey");
      } finally {
        warn.mockRestore();
      }
    },
  );

  it("an invalid NEXT_PUBLIC_SENTRY_DSN does not shadow a valid SENTRY_DSN: the valid one is inlined and its origin admitted", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      vi.stubEnv(SENTRY_PUBLIC_DSN_ENV, "ftp://publickey@o9.ingest.de.sentry.io/9");
      vi.stubEnv(SENTRY_DSN_ENV, SENTRY_DSN_FAKE);
      vi.stubEnv(VERCEL_ENV_NAME, "preview");
      const fresh = await freshConfig();
      expect(
        fresh.env?.[SENTRY_PUBLIC_DSN_ENV],
        "221 SFH-M2: the first USABLE DSN is inlined, not the first truthy one",
      ).toBe(SENTRY_DSN_FAKE);
      expect(
        fresh.env?.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
        "221 SFH-M2: the environment follows the inlined DSN",
      ).toBe("preview");
      const block = (await fresh.headers()).find((b) => b.source === GLOBAL_SOURCE);
      expect(
        block?.headers.find((h) => h.key === CSP_KEY)?.value,
        "221 SFH-M2: the CSP admits the origin of the DSN the bundle carries",
      ).toBe(`${CSP_LITERAL} ${SENTRY_ORIGIN_FAKE}`);
      expect(
        warn,
        "221 SFH-M2: a usable DSN exists, so there is nothing to warn about",
      ).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("no DSN at all: no build warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await freshConfig();
      expect(warn, "221 SFH-M2: no DSN is a decision, not a fault").not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("an http DSN with a port: the origin keeps the port and drops the key and path", async () => {
    vi.stubEnv(SENTRY_DSN_ENV, "http://publickey@127.0.0.1:9000/1");
    expect(
      await globalCsp(),
      "221 SCRB-02: a self-hosted ingest on a port must stay reachable, with no key or path in the header",
    ).toBe(`${CSP_LITERAL} http://127.0.0.1:9000`);
  });

  it("loopback Supabase lane plus a DSN: the Supabase origin and ws twin, then the Sentry origin, in that order", async () => {
    vi.stubEnv(ENV, "http://127.0.0.1:54421");
    vi.stubEnv(SENTRY_DSN_ENV, SENTRY_DSN_FAKE);
    expect(
      await globalCsp(),
      "221 SCRB-02: the two derivations must compose, neither dropping the other's entry",
    ).toBe(
      `${CSP_LITERAL} http://127.0.0.1:54421 ws://127.0.0.1:54421 ${SENTRY_ORIGIN_FAKE}`,
    );
  });

  it("anti-vacuity: with a DSN set the global block still has exactly one CSP entry and no other block has one", async () => {
    vi.stubEnv(SENTRY_DSN_ENV, SENTRY_DSN_FAKE);
    const blocks = await resolvedHeaderBlocks();
    expect(blocks.length, "221 SCRB-02: the resolved header table is empty").toBeGreaterThan(0);
    const global = blocks.filter((b) => b.source === GLOBAL_SOURCE);
    expect(global, "221 SCRB-02: exactly one global header block").toHaveLength(1);
    expect(
      global[0].headers.filter((h) => h.key === CSP_KEY),
      "221 SCRB-02: exactly one CSP entry in the global block",
    ).toHaveLength(1);
    const elsewhere = blocks
      .filter((b) => b.source !== GLOBAL_SOURCE)
      .flatMap((b) => b.headers)
      .filter((h) => h.key === CSP_KEY);
    expect(elsewhere, "221 SCRB-02: CSP must live in the global block only").toHaveLength(0);
  });
});
