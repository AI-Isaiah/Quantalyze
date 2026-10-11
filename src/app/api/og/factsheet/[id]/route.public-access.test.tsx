import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Phase 170.3 OGPUBLIC (D-02, D-03) — GET /api/og/factsheet/[id] for a caller
 * with NO session, i.e. the Slack / LinkedIn / X unfurler that now reaches the
 * route because `"/api/og/factsheet"` joined PUBLIC_ROUTES (src/proxy.ts).
 *
 * WHY THIS FILE EXISTS. Opening the route to the internet is only safe if the
 * card an anonymous caller gets cannot carry anything about a strategy that is
 * not published. The card is also cached publicly (`s-maxage=86400`,
 * `stale-while-revalidate=604800`) and copied by the unfurlers, so a leak would
 * outlive the request. Two layers keep that closed:
 *   1. RLS. The route reads through the cookie-scoped `createClient`. For a
 *      caller with no session the SELECT policies (`strategies_read`,
 *      `strategies_org_read`, `analytics_read`) return a row only when it is
 *      `status = 'published'`; anything else comes back as no row.
 *   2. The route's own `withPublishedOnly(...)` predicate. A SIGNED-IN owner or
 *      org member CAN read their unpublished rows through RLS, so without the
 *      predicate the same URL would render a different (private) card for them
 *      and a publicly cached copy could be served to someone else.
 *
 * THE FAKE. `@/lib/supabase/server` is replaced by a builder whose `maybeSingle()`
 * returns the fixture row ONLY IF every `eq(col, val)` filter the route applied
 * matches the row's own field (`row[col] === val`), else `{ data: null, error:
 * null }`. That is how PostgREST plus RLS answers an anonymous caller, and it is
 * the difference from `route.test.tsx`, whose fake returns the row regardless of
 * the filters. Here dropping the `status = 'published'` predicate makes an
 * unpublished row come back and the test go RED. `withPublishedOnly` and
 * `computeOgHeadline` are NOT mocked: the real ones run.
 *
 * Coverage matrix:
 *   P1 — unpublished id: generic card, nothing of the row, long cache, no Sentry
 *   P2 — unknown id: the same generic card, long cache (a genuine not-found)
 *   P3 — malformed id (PostgREST 22P02): generic card, a 200 never a 404,
 *        failure-path cache header
 *   P4 — published control (non-vacuity): the SAME row published renders its
 *        name and stored Sharpe, so P1 cannot pass because the fake is empty
 *   P5 — predicate: every case read `strategies` with status = published and
 *        the requested id
 */

vi.mock("server-only", () => ({}));

const PUBLISHED_ID = "22222222-2222-4222-8222-222222222222";
const UNKNOWN_ID = "33333333-3333-4333-8333-333333333333";
const MALFORMED_ID = "not-a-uuid";

const UNPUBLISHED_NAME = "Unpublished Alpha Draft";
const UNPUBLISHED_CODENAME = "UNPUB-CODENAME";
const UNPUBLISHED_DESCRIPTION = "Confidential thesis text for an unpublished strategy";

const STATE = vi.hoisted(() => ({
  /** The one strategies row the fake database holds (null = empty table). */
  strategyRow: null as Record<string, unknown> | null,
  /** When true, the fake answers every read with `{ data: null, error: null }`. */
  returnNothing: false,
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
    constructor(element: unknown, options?: unknown) {
      ogCalls.push({ element, options });
    }
  },
}));

// A failed read is reported through `after()`, which needs a Next request scope
// vitest does not provide: run the callback at once and record the capture.
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
              error: {
                code: "22P02",
                message: "invalid input syntax for type uuid",
              },
            };
          }
          const row = STATE.strategyRow;
          if (STATE.returnNothing || !row) return { data: null, error: null };
          // Anonymous RLS: a row is visible only if it matches every predicate
          // the route sent (notably `status = published`).
          const visible = filters.every(([col, val]) => row[col] === val);
          return { data: visible ? row : null, error: null };
        },
      };
      return builder;
    },
  }),
}));

/** The long cache a healthy (or genuinely not-found) card carries. */
const LONG_CACHE = "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800";

/** FAILURE_CACHE_CONTROL is not exported, so read it BY SYMBOL from the route
 *  source: the assertion follows the route's definition, not a copy of it. */
function failureCacheControl(): string {
  const src = readFileSync(join(__dirname, "route.tsx"), "utf8");
  const m = /const FAILURE_CACHE_CONTROL\s*=\s*"([^"]+)"/.exec(src);
  expect(m, "route.tsx must define FAILURE_CACHE_CONTROL").toBeTruthy();
  return m![1];
}

function ctx(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

function makeRequest(id: string): Request {
  return new Request(`http://localhost:3000/api/og/factsheet/${id}`);
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

function latestCardStrings(): string[] {
  const last = ogCalls[ogCalls.length - 1];
  expect(last, "the route must always construct an ImageResponse").toBeTruthy();
  return collectStrings(last.element);
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

/** A complete row with stored figures and a real series: the figures that must
 *  NOT reach an anonymous caller while the row is unpublished. */
function makeRow(status: "draft" | "published"): Record<string, unknown> {
  return {
    id: PUBLISHED_ID,
    status,
    name: UNPUBLISHED_NAME,
    codename: UNPUBLISHED_CODENAME,
    description: UNPUBLISHED_DESCRIPTION,
    asset_class: "crypto",
    strategy_analytics: [
      {
        daily_returns: null,
        returns_series: LONG_WEALTH_INDEX,
        computation_status: "complete",
        sharpe: 1.87,
        cagr: 0.4321,
        max_drawdown: -0.1234,
      },
    ],
  };
}

/** What a card for a row that is not visible must NOT contain. */
const FORBIDDEN = [
  UNPUBLISHED_NAME,
  UNPUBLISHED_CODENAME,
  UNPUBLISHED_DESCRIPTION,
  "1.87",
  "43.2",
  "12.3",
];

function expectGenericCard(): void {
  expect(ogCalls).toHaveLength(1);
  const strings = latestCardStrings();
  expect(strings).toContain("Strategy");
  for (const forbidden of FORBIDDEN) {
    expect(
      strings.filter((s) => s.includes(forbidden)),
      `the generic card must not carry "${forbidden}"`,
    ).toEqual([]);
  }
  // The three stats read the NaN sentinel.
  expect(strings.filter((s) => s === "—")).toHaveLength(3);
}

beforeEach(async () => {
  const { __resetCaptureThrottleForTests } = await import("@/lib/sentry-capture");
  __resetCaptureThrottleForTests();
  STATE.strategyRow = null;
  STATE.returnNothing = false;
  STATE.observed = { filters: [], tables: [] };
  ogCalls.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("GET /api/og/factsheet/[id] — signed-out caller (OGPUBLIC)", () => {
  it("P1 — an UNPUBLISHED id renders the generic card and nothing of the row (D-02, T-170.3-01)", async () => {
    STATE.strategyRow = makeRow("draft");
    const { GET } = await import("./route");
    const res = await GET(makeRequest(PUBLISHED_ID), ctx(PUBLISHED_ID));

    expectGenericCard();
    expect(ogCalls[0]).toBeTruthy();
    expect(res.headers.get("Cache-Control")).toBe(LONG_CACHE);
    // A not-found is not a failure: nothing goes to Sentry.
    expect(afterSpy).not.toHaveBeenCalled();
  });

  it("P2 — an UNKNOWN id renders the same generic card, long-cached (D-02)", async () => {
    STATE.strategyRow = makeRow("published"); // a row exists, but under another id
    const { GET } = await import("./route");
    const res = await GET(makeRequest(UNKNOWN_ID), ctx(UNKNOWN_ID));

    expectGenericCard();
    expect(res.headers.get("Cache-Control")).toBe(LONG_CACHE);
    expect(afterSpy).not.toHaveBeenCalled();
  });

  it("P3 — a MALFORMED id renders the generic card as a 200 (never a 404) with the failure-path cache header (D-02)", async () => {
    STATE.strategyRow = makeRow("published");
    const { GET } = await import("./route");
    const res = await GET(makeRequest(MALFORMED_ID), ctx(MALFORMED_ID));

    expectGenericCard();
    expect(res.status ?? 200).toBe(200);
    const failure = failureCacheControl();
    expect(failure).not.toBe(LONG_CACHE);
    expect(res.headers.get("Cache-Control")).toBe(failure);
  });

  it("P4 — non-vacuity: the SAME row, published, renders its name and stored figures", async () => {
    STATE.strategyRow = makeRow("published");
    const { GET } = await import("./route");
    const res = await GET(makeRequest(PUBLISHED_ID), ctx(PUBLISHED_ID));

    expect(ogCalls).toHaveLength(1);
    const strings = latestCardStrings();
    expect(strings).toContain(UNPUBLISHED_NAME);
    expect(strings).toContain("1.87");
    expect(strings).toContain("+43.2%");
    expect(strings).toContain("-12.3%");
    expect(res.headers.get("Cache-Control")).toBe(LONG_CACHE);
  });

  it.each([
    ["unpublished", PUBLISHED_ID, "draft"],
    ["unknown", UNKNOWN_ID, "published"],
    ["malformed", MALFORMED_ID, "published"],
    ["published", PUBLISHED_ID, "published"],
  ] as const)(
    "P5 — the %s read carries status = published and the requested id on strategies (T-170.3-03)",
    async (_label, id, status) => {
      STATE.strategyRow = makeRow(status);
      const { GET } = await import("./route");
      await GET(makeRequest(id), ctx(id));

      expect(STATE.observed.tables).toContain("strategies");
      expect(STATE.observed.filters).toContainEqual(["status", "published"]);
      expect(STATE.observed.filters).toContainEqual(["id", id]);
    },
  );
});
