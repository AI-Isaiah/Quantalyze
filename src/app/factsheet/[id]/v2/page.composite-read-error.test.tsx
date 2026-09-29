/** @vitest-environment jsdom */
/**
 * Phase 169 (D-41 / R3, routed from 167.2.1 D-07) — a composite whose
 * `csv_daily_returns` read fails is NOT cached as its public factsheet for the
 * analytics run.
 *
 * THE DEFECT. `readCompositeFactsheet` logged a failed `csv_daily_returns`
 * read and continued with an empty series. The resolve stage then answered
 * `composite_unbuildable`, a fact about the ROW, and `buildFactsheetPayloadCached`
 * stored that `null` under the run's `computed_at` for the 3600 s TTL. One read
 * blip therefore hid a composite's factsheet behind the placeholder for up to
 * an hour while discovery, recommendations and /strategies showed it as live
 * (the SC4 disagreement). The single-key path had been closed by 167.2.1-REVIEW-R2
 * WR-02 (`FactsheetReadError` on `read_error`); the composite path could not
 * reach it, because the error was gone by the time the resolve stage saw the
 * series.
 *
 * THE FIX. The reader throws `CompositeSeriesReadError`, the resolve stage
 * answers `read_error` with its code, and 167.2.1's existing throw keeps it out
 * of the cache. This file pins that end to end: request 1 renders the public
 * placeholder and stores nothing, request 2 on the SAME `computed_at` builds.
 *
 * THE DOUBLE. As in `page.public-cache-key.test.tsx`: `unstable_cache` is a
 * real store keyed the way Next keys it, which stores a `null` and lets a throw
 * propagate before the store (Next 16's miss path awaits the callback before
 * `cacheNewResult`). An identity stub (`(fn) => fn`) would make request 2's
 * assertion vacuous: nothing would ever be cached. The builder, the resolve
 * stage and the composite reader are REAL; only the admin client is a double,
 * dispatching by table name.
 *
 * All ids, names and figures are synthetic.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound() called");
  },
}));

const cacheStore = vi.hoisted(() => new Map<string, unknown>());
vi.mock("next/cache", () => ({
  unstable_cache:
    (fn: (...args: unknown[]) => Promise<unknown>, keyParts: unknown[]) =>
    async (...args: unknown[]) => {
      const key = JSON.stringify([keyParts, args]);
      if (cacheStore.has(key)) return cacheStore.get(key);
      // A throw propagates before the store, as Next's miss path does.
      const value = await fn(...args);
      cacheStore.set(key, value); // a null is stored too, as Next stores it
      return value;
    },
}));
vi.mock("@/lib/visibility", () => ({
  withPublishedOnly: (qb: unknown) => qb,
  withPublishedOrOwner: (qb: unknown) => qb,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/queries", () => ({
  readPublicVerificationSignals: vi.fn(),
}));

import FactsheetV2Page from "./page";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { readPublicVerificationSignals } from "@/lib/queries";
import { captureToSentry } from "@/lib/sentry-capture";
import type { FactsheetPayload } from "@/lib/factsheet/types";

const STRATEGY_ID = "51a10001-0000-4000-8000-0000000000e7";
const T0 = "2026-09-01T00:00:00.000Z";

/** A valid persisted composite headline (the F1/H-1 gate passes). */
const FULL_CASH = {
  cumulative_return: 0.05,
  volatility: 0.12,
  max_drawdown: -0.04,
  cagr: 0.31,
  sharpe: 1.4,
  sortino: 2.1,
  calmar: 3.0,
};

/** 30 consecutive synthetic days of sparse composite returns. */
const CSV_ROWS = Array.from({ length: 30 }, (_, i) => ({
  date: new Date(Date.parse("2025-08-01T00:00:00Z") + i * 86_400_000).toISOString().slice(0, 10),
  daily_return: ((i % 7) - 3) / 1000,
}));

/** A published composite: daily_returns NULL, its series lives in csv_daily_returns. */
const COMPOSITE_ROW = {
  id: STRATEGY_ID,
  name: "Synthetic Composite",
  codename: null,
  disclosure_tier: "exploratory",
  status: "published",
  markets: ["BTC"],
  strategy_types: ["momentum"],
  description: null,
  subtypes: [],
  supported_exchanges: ["binance"],
  leverage_range: null,
  aum: null,
  max_capacity: null,
  avg_daily_turnover: null,
  start_date: null,
  benchmark: null,
  asset_class: "crypto",
  returns_denominator_config: null,
  strategy_analytics: {
    computed_at: T0,
    computation_status: "complete",
    daily_returns: null,
    returns_series: null,
    data_quality_flags: { composite: true },
    metrics_json_by_basis: { cash_settlement: FULL_CASH },
  },
};

let strategyReads = 0;

type CsvAnswer = { rows: typeof CSV_ROWS } | { error: { message: string; code?: string } };

/**
 * The service-role client, dispatching by table. `strategies` answers the
 * resolve stage's read; `csv_daily_returns` answers the composite reader
 * (awaited directly after `.limit(...)`, one date-keyset page at a time); any other table (a series row, a
 * benchmark read a later plan adds) is an empty SUCCESSFUL read, so it can
 * never be what turns a case red.
 */
function mockAdmin(
  csv: CsvAnswer,
  opts: { row?: unknown; series?: { payload: unknown } | { error: { message: string; code?: string } } } = {},
): SupabaseClient {
  const from = (table: string) => {
    if (table === "strategies") {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () => {
          strategyReads += 1;
          return Promise.resolve({ data: opts.row ?? COMPOSITE_ROW, error: null });
        },
      };
      return chain;
    }
    if (table === "strategy_analytics_series" && opts.series) {
      // A persisted per-basis series row (review round 1, WR-05 / M-3): a
      // payload, or a failed read.
      const series = opts.series;
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () =>
          Promise.resolve("error" in series ? { data: null, error: series.error } : { data: series, error: null }),
      };
      return chain;
    }
    if (table === "csv_daily_returns") {
      // The reader pages by a date keyset (review round 1, CSV-READ-CAP): a
      // page after the first carries `.gt("date", cursor)`, and it stops on an
      // empty page, so the cursor is honoured here.
      let after: string | null = null;
      const chain = {
        select: () => chain,
        eq: () => chain,
        gt: (_column: string, value: string) => {
          after = value;
          return chain;
        },
        order: () => chain,
        limit: () =>
          Promise.resolve(
            "error" in csv
              ? { data: null, error: csv.error }
              : { data: csv.rows.filter((r) => after === null || r.date > after), error: null },
          ),
      };
      return chain;
    }
    const empty = { data: [], error: null };
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "gte", "lte", "lt", "order", "limit"]) b[m] = () => b;
    b.maybeSingle = () => Promise.resolve({ data: null, error: null });
    b.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(empty).then(resolve, reject);
    return b;
  };
  return { from } as unknown as SupabaseClient;
}

/** The outer signature probe (the published lane hits), carrying computed_at. */
function mockRequestClient() {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: () =>
      Promise.resolve({
        data: {
          id: STRATEGY_ID,
          name: "Synthetic Composite",
          codename: null,
          disclosure_tier: "exploratory",
          strategy_analytics: { computed_at: T0 },
        },
        error: null,
      }),
  };
  return { from: () => chain };
}

function findPayload(node: unknown): FactsheetPayload | null {
  if (node == null || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findPayload(child);
      if (hit) return hit;
    }
    return null;
  }
  const el = node as { props?: { payload?: unknown; children?: unknown } };
  if (el.props?.payload != null) return el.props.payload as FactsheetPayload;
  return findPayload(el.props?.children ?? null);
}

/** One public request on the same analytics run, with the csv read answering `csv`. */
async function request(csv: CsvAnswer, opts: Parameters<typeof mockAdmin>[1] = {}) {
  vi.mocked(createClient).mockResolvedValue(mockRequestClient() as never);
  vi.mocked(createAdminClient).mockReturnValue(mockAdmin(csv, opts));
  return FactsheetV2Page({ params: Promise.resolve({ id: STRATEGY_ID }) });
}

beforeEach(() => {
  cacheStore.clear();
  strategyReads = 0;
  vi.mocked(captureToSentry).mockClear();
  vi.mocked(readPublicVerificationSignals).mockResolvedValue(
    new Map([[STRATEGY_ID, { trust_tier: "api_verified", status: "verified" }]]) as never,
  );
});

describe("169 D-41 — a composite's csv_daily_returns read outage is not cached for its analytics run", () => {
  it("COMPOSITE-READ-ERROR-NOT-CACHED: request 1 renders the placeholder and stores nothing; request 2 on the same computed_at builds", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      // Request 1: the composite's csv read fails. The page must not 500: it
      // renders the public placeholder sentence (hand-typed, KCS-10).
      const failed = await request({ error: { message: "synthetic statement timeout", code: "57014" } });
      expect(findPayload(failed)).toBeNull();
      const { container } = render(failed as ReactElement);
      expect(container.querySelector("article p:last-child")?.textContent).toBe(
        "The detailed factsheet for this strategy is not available yet.",
      );
      // Nothing was stored for the run: the outage threw out of the callback.
      expect(cacheStore.size, "the outage was stored as the run's answer").toBe(0);
      // Captured once, by the resolve stage, as an outage with its code.
      expect(vi.mocked(captureToSentry)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(captureToSentry).mock.calls[0][1]).toMatchObject({
        tags: { stage: "factsheet-resolve", reason: "read_error", code: "57014" },
      });

      // Request 2: same run, the csv read recovers. It must BUILD, not replay
      // the outage from the cache.
      const recovered = await request({ rows: CSV_ROWS });
      expect(findPayload(recovered), "the composite read outage was cached for the run").not.toBeNull();
      expect(strategyReads, "both requests reached the resolve stage").toBe(2);
    } finally {
      errSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it("CONTROL: a successful EMPTY csv read is a fact about the row and is still cached as the run's placeholder", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const empty = await request({ rows: [] });
      expect(findPayload(empty)).toBeNull();
      expect(cacheStore.size, "an empty composite is a fact and is cached as before").toBe(1);
      const again = await request({ rows: CSV_ROWS });
      expect(findPayload(again), "the cached fact is served for the run").toBeNull();
      expect(strategyReads).toBe(1);
    } finally {
      errSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });
});

/**
 * Phase 169 review round 1, WR-05 / SFH M-3 — the rest of D-41's class. The
 * persisted MTM and smoothed series reads turned a failed read into `null`
 * ("charts stay cash"), so the build succeeded without the basis bundle and
 * `buildFactsheetPayloadCached` stored that degraded payload for the whole
 * analytics run: for up to the TTL the MTM toggle drew the cash series under
 * the mark-to-market label. The readers now throw `CompositeSeriesReadError`
 * naming the series, the resolve stage answers `read_error`, and the public
 * cache stores nothing, exactly as for the composite's `csv_daily_returns`.
 */
describe("169 WR-05 — a single-key MTM series read outage is not cached for its analytics run", () => {
  /** A published single-key options book: a cash series plus a persisted MTM basis. */
  const OPTIONS_ROW = {
    ...COMPOSITE_ROW,
    name: "Synthetic Options Book",
    strategy_analytics: {
      computed_at: T0,
      computation_status: "complete",
      daily_returns: CSV_ROWS.map((r) => ({ date: r.date, value: r.daily_return })),
      returns_series: null,
      data_quality_flags: {},
      metrics_json_by_basis: { mark_to_market: FULL_CASH },
      ...FULL_CASH,
    },
  };
  const MTM_SERIES = {
    payload: {
      schema: 2,
      basis: "mark_to_market",
      rows: CSV_ROWS.map((r) => ({ date: r.date, return: r.daily_return })),
      gap_spans: [],
    },
  };

  it("MTM-READ-ERROR-NOT-CACHED: request 1 renders the placeholder and stores nothing; request 2 on the same computed_at builds the MTM bundle", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const failed = await request(
        { rows: [] },
        { row: OPTIONS_ROW, series: { error: { message: "synthetic statement timeout", code: "57014" } } },
      );
      expect(findPayload(failed), "the MTM outage was built into a payload without its bundle").toBeNull();
      expect(cacheStore.size, "the MTM outage was stored as the run's answer").toBe(0);
      expect(vi.mocked(captureToSentry)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(captureToSentry).mock.calls[0][1]).toMatchObject({
        tags: { stage: "factsheet-resolve", reason: "read_error", code: "57014", read: "mtm_daily_returns" },
      });

      const recovered = await request({ rows: [] }, { row: OPTIONS_ROW, series: MTM_SERIES });
      const payload = findPayload(recovered);
      expect(payload, "the MTM outage was cached for the run").not.toBeNull();
      expect(payload!.seriesByBasis?.mark_to_market, "the recovered build lacks its MTM bundle").toBeDefined();
      expect(strategyReads, "both requests reached the resolve stage").toBe(2);
    } finally {
      errSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });
});
