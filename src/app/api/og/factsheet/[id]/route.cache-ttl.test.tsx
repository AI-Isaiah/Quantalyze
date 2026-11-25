import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Phase 237 CACHE-01 (TODOS `170.3-OG-NOTFOUND-CACHE`, ROADMAP SC-3) — a strategy published, or
 * computed, AFTER its OG card was first requested shows its real card on the VERY NEXT request.
 *
 * WHY THIS FILE EXISTS. The route used to send a not-found card with the long cache
 * (`s-maxage=86400`), so a strategy published after its first unfurl showed "Strategy - - -" for a
 * day at the CDN. A header assertion alone cannot prove the user-visible outcome, because what the
 * founder cares about is the card the SECOND request is shown. So this file puts a small HTTP-cache
 * double in front of the REAL `GET` handler and drives it under a manual clock: the double reads the
 * response's own `Cache-Control`, stores nothing for `no-store`, and otherwise serves the stored
 * card until `s-maxage` (falling back to `max-age`) runs out. A header that leaves the blank card in
 * the store makes the good-after-bad case fail by name.
 *
 * Ladder under test (phase agent ruling 1, 2026-11-23, which supersedes the SHORT not-found value
 * in 237-RESEARCH.md): a failed read, a genuine not-found and a published card rendered WITHOUT
 * figures are `no-store`; a rendered terminal card keeps the long cache; a held re-run card
 * (stored figures plus the Updating line, plan 05) is `public, max-age=60, s-maxage=60`.
 *
 * Coverage matrix:
 *   C1 - not-found good-after-bad: an unpublished id is no-store, and once published the very next
 *        request (one second later) renders the real card
 *   C2 - figure-less good-after-bad: a published row whose analytics are pending with no stored
 *        result is no-store, and once it computes the very next request renders its figures
 *   C3 - control (non-vacuity of the double): a terminal complete card is long-cached and a second
 *        request at +30 s is served from the store, the same markup; past s-maxage it refetches
 *   C4 - existence oracle (T-237-03): unknown, unpublished and malformed ids send the IDENTICAL
 *        Cache-Control and render the IDENTICAL card markup
 *   C5 - definition pin: a terminal chain-broken Withheld card (three dashes) that entered the
 *        figure branch keeps the long cache, because it is the row's true terminal state
 *   C6 - held re-run: the held card is short-cached, still served at +30 s after the run
 *        completes, and the first request after +61 s is the terminal card under the long cache
 *   C7 - a failed row over stored evidence is never held: three dashes, no-store
 *
 * The harness is route.public-access.test.tsx's: the cookie-scoped client fake applies every eq
 * filter, and the real `withPublishedOnly` and `computeOgHeadline` run.
 */

vi.mock("server-only", () => ({}));

const PUBLISHED_ID = "22222222-2222-4222-8222-222222222222";
const UNKNOWN_ID = "33333333-3333-4333-8333-333333333333";
const MALFORMED_ID = "not-a-uuid";

const STRATEGY_NAME = "Helios Momentum";
const STRATEGY_DESCRIPTION = "A test strategy for the share card";

const STATE = vi.hoisted(() => ({
  /** The one strategies row the fake database holds (null = empty table). */
  strategyRow: null as Record<string, unknown> | null,
  observed: {
    filters: [] as Array<[string, unknown]>,
    tables: [] as string[],
  },
}));

/** Every ImageResponse the route constructed, newest last. */
const ogCalls = vi.hoisted(
  () => [] as Array<{ element: unknown; options: unknown }>,
);

vi.mock("next/og", () => ({
  ImageResponse: class {
    headers = new Headers();
    status: number;
    constructor(element: unknown, options?: unknown) {
      ogCalls.push({ element, options });
      const asked = (options as { status?: unknown } | undefined)?.status;
      this.status = typeof asked === "number" ? asked : 200;
    }
  },
}));

// A failed read is reported through `after()`, which needs a Next request scope vitest does not
// provide: run the callback at once and record the capture.
vi.mock("@/lib/sentry-capture", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/sentry-capture")>()),
  captureToSentry: vi.fn(async () => undefined),
}));
const afterSpy = vi.hoisted(() =>
  vi.fn((cb: () => unknown) => {
    void cb();
  }),
);
vi.mock("next/server", async (importActual) => ({
  ...(await importActual<typeof import("next/server")>()),
  after: afterSpy,
}));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      STATE.observed.tables.push(table);
      const filters: Array<[string, unknown]> = [];
      const builder = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          filters.push([col, val]);
          STATE.observed.filters.push([col, val]);
          return builder;
        },
        maybeSingle: async () => {
          // PostgREST rejects a non-uuid value for a uuid column with 22P02.
          const idFilter = filters.find(([col]) => col === "id");
          if (idFilter && !UUID_RE.test(String(idFilter[1]))) {
            return {
              data: null,
              error: { code: "22P02", message: "invalid input syntax for type uuid" },
            };
          }
          const row = STATE.strategyRow;
          if (!row) return { data: null, error: null };
          // Anonymous RLS: a row is visible only if it matches every predicate the route sent
          // (notably `status = published`).
          const visible = filters.every(([col, val]) => row[col] === val);
          return { data: visible ? row : null, error: null };
        },
      };
      return builder;
    },
  }),
}));

const LONG_CACHE = "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800";
/** The held-re-run cache (plan 01's HELD_RERUN_CACHE_CONTROL): 60 s, no stale-while-revalidate. */
const HELD_CACHE = "public, max-age=60, s-maxage=60";
const UPDATING_LINE =
  "Updating with the latest data. These figures are from the last completed computation.";

/** FAILURE_CACHE_CONTROL is not exported, so read it BY SYMBOL from the route source: the
 *  assertion follows the route's definition, not a copy of it. */
function failureCacheControl(): string {
  const src = readFileSync(join(__dirname, "route.tsx"), "utf8");
  const m = /const FAILURE_CACHE_CONTROL\s*=\s*"([^"]+)"/.exec(src);
  expect(m, "route.tsx must define FAILURE_CACHE_CONTROL").toBeTruthy();
  return m![1];
}

function ctx(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

function urlFor(id: string): string {
  return `http://localhost:3000/api/og/factsheet/${id}`;
}

/** Every string anywhere in a React element tree, children or props. */
function collectStrings(node: unknown, out: string[] = []): string[] {
  if (typeof node === "string") {
    out.push(node);
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectStrings(child, out);
    return out;
  }
  if (node && typeof node === "object") {
    const props = (node as { props?: Record<string, unknown> }).props;
    if (props) {
      for (const value of Object.values(props)) collectStrings(value, out);
    }
  }
  return out;
}

/** 400 calendar days of a deterministic wealth curve (see route.test.tsx). */
const LONG_WEALTH_INDEX = (() => {
  const out: Array<{ date: string; value: number }> = [];
  const start = Date.UTC(2024, 0, 1);
  let wealth = 1;
  for (let i = 0; i < 400; i++) {
    if (i > 0) wealth *= 1 + 0.0006 + 0.004 * Math.sin(i);
    out.push({
      date: new Date(start + i * 86_400_000).toISOString().slice(0, 10),
      value: wealth,
    });
  }
  return out;
})();

type Analytics = Record<string, unknown>;

function makeRow(status: "draft" | "published", analytics: Analytics): Record<string, unknown> {
  return {
    id: PUBLISHED_ID,
    status,
    name: STRATEGY_NAME,
    codename: null,
    description: STRATEGY_DESCRIPTION,
    asset_class: "crypto",
    strategy_analytics: [analytics],
  };
}

/** A terminal-success row with stored figures and a real series. */
const COMPLETE: Analytics = {
  daily_returns: null,
  returns_series: LONG_WEALTH_INDEX,
  computation_status: "complete",
  sharpe: 1.87,
  cagr: 0.4321,
  max_drawdown: -0.1234,
};

/** A first-ever compute still pending: no series, no stored figures. */
const PENDING_NO_RESULT: Analytics = {
  daily_returns: null,
  returns_series: null,
  computation_status: "pending",
};

// ---------------------------------------------------------------------------------------------
// The HTTP-cache double. A manual clock (seconds) and a store keyed by request URL.
// ---------------------------------------------------------------------------------------------

type Served = {
  /** renderToStaticMarkup of the element the real GET handed to ImageResponse. */
  markup: string;
  strings: string[];
  cacheControl: string | null;
  /** true when the double answered from its store and never reached the handler. */
  fromStore: boolean;
};

let clock = 0;
const store = new Map<string, { expiresAt: number; served: Served }>();

/** The seconds a shared cache may hold a response: s-maxage, else max-age, else none. */
function freshnessSeconds(cacheControl: string | null): number {
  if (!cacheControl || /\bno-store\b/i.test(cacheControl)) return 0;
  const sMax = /\bs-maxage=(\d+)/i.exec(cacheControl);
  if (sMax) return Number(sMax[1]);
  const max = /\bmax-age=(\d+)/i.exec(cacheControl);
  return max ? Number(max[1]) : 0;
}

/** Run the real GET and capture the card it built plus its own Cache-Control. */
async function callRoute(id: string): Promise<Served> {
  const { GET } = await import("./route");
  const before = ogCalls.length;
  const res = (await GET(new Request(urlFor(id)), ctx(id))) as unknown as { headers: Headers };
  expect(ogCalls.length, "the route must always construct exactly one ImageResponse").toBe(before + 1);
  const element = ogCalls[ogCalls.length - 1].element;
  return {
    markup: renderToStaticMarkup(element as ReactElement),
    strings: collectStrings(element),
    cacheControl: res.headers.get("Cache-Control"),
    fromStore: false,
  };
}

/** A request through the cache: a hit before expiry returns the stored card, a miss calls the
 *  real handler and stores the response only if its own header allows it. */
async function viaCache(id: string): Promise<Served> {
  const key = urlFor(id);
  const hit = store.get(key);
  if (hit && hit.expiresAt > clock) return { ...hit.served, fromStore: true };
  const served = await callRoute(id);
  const ttl = freshnessSeconds(served.cacheControl);
  if (ttl > 0) store.set(key, { expiresAt: clock + ttl, served });
  return served;
}

beforeEach(async () => {
  const { __resetCaptureThrottleForTests } = await import("@/lib/sentry-capture");
  __resetCaptureThrottleForTests();
  STATE.strategyRow = null;
  STATE.observed = { filters: [], tables: [] };
  ogCalls.length = 0;
  clock = 0;
  store.clear();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("GET /api/og/factsheet/[id] - HTTP-cache double (CACHE-01)", () => {
  it("C1 - not-found good-after-bad: a strategy published after its first request shows its real card on the very next request", async () => {
    STATE.strategyRow = makeRow("draft", COMPLETE);

    const first = await viaCache(PUBLISHED_ID);
    expect(first.fromStore).toBe(false);
    expect(first.strings).toContain("Strategy");
    expect(first.strings).not.toContain(STRATEGY_NAME);

    // The founder publishes the strategy; the unfurler asks again one second later.
    STATE.strategyRow = makeRow("published", COMPLETE);
    clock += 1;

    const second = await viaCache(PUBLISHED_ID);
    expect(second.fromStore, "the blank card must not be held by any cache").toBe(false);
    expect(second.strings).toContain(STRATEGY_NAME);
    expect(second.strings).toContain("1.87");
    expect(second.markup).not.toBe(first.markup);
    // The mechanism, asserted AFTER the outcome so a wrong header fails the outcome by name first.
    expect(first.cacheControl).toBe(failureCacheControl());
  });

  it("C2 - figure-less good-after-bad: a published card with no figures is replaced on the very next request once the row computes", async () => {
    STATE.strategyRow = makeRow("published", PENDING_NO_RESULT);

    const first = await viaCache(PUBLISHED_ID);
    expect(first.fromStore).toBe(false);
    expect(first.strings).toContain(STRATEGY_NAME);
    expect(first.strings.filter((s) => s === "—")).toHaveLength(3);

    STATE.strategyRow = makeRow("published", COMPLETE);
    clock += 1;

    const second = await viaCache(PUBLISHED_ID);
    expect(second.fromStore, "the dash card must not be held by any cache").toBe(false);
    expect(second.strings).toContain("1.87");
    expect(second.strings).toContain("+43.2%");
    expect(second.strings.filter((s) => s === "—")).toHaveLength(0);
    expect(first.cacheControl).toBe(failureCacheControl());
  });

  it("C3 - control: a terminal complete card is long-cached, served from the store at +30 s and refetched past s-maxage", async () => {
    STATE.strategyRow = makeRow("published", COMPLETE);

    const first = await viaCache(PUBLISHED_ID);
    expect(first.cacheControl).toBe(LONG_CACHE);
    expect(first.strings).toContain("1.87");

    clock += 30;
    const second = await viaCache(PUBLISHED_ID);
    expect(second.fromStore).toBe(true);
    expect(second.markup).toBe(first.markup);

    clock += 86_400;
    const third = await viaCache(PUBLISHED_ID);
    expect(third.fromStore, "the double honours s-maxage, so it can tell a held card from a fresh one").toBe(false);
  });

  it("C4 - existence oracle: an unknown, an unpublished and a malformed id send the identical header and the identical card (T-237-03)", async () => {
    // A published row exists under another id, and a draft under its own id.
    STATE.strategyRow = makeRow("published", COMPLETE);
    const unknown = await callRoute(UNKNOWN_ID);

    STATE.strategyRow = makeRow("draft", COMPLETE);
    const unpublished = await callRoute(PUBLISHED_ID);

    const malformed = await callRoute(MALFORMED_ID);

    // Non-vacuity: the three really are the generic card, with nothing of the row.
    for (const served of [unknown, unpublished, malformed]) {
      expect(served.strings).toContain("Strategy");
      expect(served.strings).not.toContain(STRATEGY_NAME);
      expect(served.strings).not.toContain(STRATEGY_DESCRIPTION);
    }

    expect(unknown.cacheControl).toBe(failureCacheControl());
    expect(unpublished.cacheControl).toBe(unknown.cacheControl);
    expect(malformed.cacheControl).toBe(unknown.cacheControl);
    expect(unpublished.markup).toBe(unknown.markup);
    expect(malformed.markup).toBe(unknown.markup);
  });

  it("C5 - definition pin: a terminal chain-broken Withheld card (three dashes) keeps the long cache", async () => {
    // The O1f fixture of route.test.tsx: a legacy chain-broken row, no `headline_since`. The route
    // enters the figure branch (analytics admitted, 400 points) and the page's own gate withholds
    // Sharpe and CAGR, and the headline withholds Max DD too, so the card prints three dashes.
    // That is the row's true terminal state, not a card waiting for figures.
    STATE.strategyRow = makeRow("published", {
      daily_returns: null,
      returns_series: LONG_WEALTH_INDEX,
      computation_status: "complete",
      sharpe: 2.34,
      cagr: 0.567,
      max_drawdown: -0.089,
      data_quality_flags: { twr_chain_broken: true },
    });

    const served = await viaCache(PUBLISHED_ID);
    expect(served.strings).toContain(STRATEGY_NAME);
    expect(served.strings.filter((s) => s === "—")).toHaveLength(3);
    expect(served.cacheControl).toBe(LONG_CACHE);
  });

  it("C6 - held re-run (FACT-02 / CACHE-01): the held card is short-cached, served at +30 s, and the first request after +61 s is the terminal card under the long cache", async () => {
    // A computing row OVER a stored success: a series, a finite cumulative_return and a success
    // marker are its stored evidence (`hasStoredAnalyticsResult`).
    const HELD_ANALYTICS: Analytics = {
      ...COMPLETE,
      computation_status: "computing",
      cumulative_return: 0.4,
      computed_at: "2026-11-20T10:00:00Z",
      data_quality_flags: { cumulative_method: "geometric" },
    };
    STATE.strategyRow = makeRow("published", HELD_ANALYTICS);

    const first = await viaCache(PUBLISHED_ID);
    expect(first.fromStore).toBe(false);
    expect(first.strings).toContain("1.87");
    expect(first.strings).toContain(UPDATING_LINE);
    expect(first.cacheControl).toBe(HELD_CACHE);
    expect(first.cacheControl).not.toMatch(/stale-while-revalidate/);

    // The run completes. Thirty seconds on, the held card is still inside its s-maxage.
    STATE.strategyRow = makeRow("published", { ...HELD_ANALYTICS, computation_status: "complete" });
    clock += 30;
    const during = await viaCache(PUBLISHED_ID);
    expect(during.fromStore, "inside s-maxage the held card is still served").toBe(true);
    expect(during.strings).toContain(UPDATING_LINE);

    // Past 60 s the Updating line clears: the double refetches and the terminal card renders.
    clock += 31;
    const after = await viaCache(PUBLISHED_ID);
    expect(after.fromStore, "the held card must not outlive its 60 s").toBe(false);
    expect(after.strings).not.toContain(UPDATING_LINE);
    expect(after.strings).toContain("1.87");
    expect(after.cacheControl).toBe(LONG_CACHE);
  });

  it("C7 - a failed row over stored evidence stays no-store and prints dashes (never held)", async () => {
    STATE.strategyRow = makeRow("published", {
      ...COMPLETE,
      computation_status: "failed",
      cumulative_return: 0.4,
      computed_at: "2026-11-20T10:00:00Z",
      data_quality_flags: { cumulative_method: "geometric" },
    });
    const served = await viaCache(PUBLISHED_ID);
    expect(served.strings.filter((s) => s === "—")).toHaveLength(3);
    expect(served.strings).not.toContain(UPDATING_LINE);
    expect(served.cacheControl).toBe(failureCacheControl());
  });
});
