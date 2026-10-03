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
import { afterEach, describe, expect, it, vi } from "vitest";

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
