/** @vitest-environment jsdom */
/**
 * STALE-01 part 2 — THE STRUCTURAL ONE: the page both PDF wrappers screenshot.
 *
 * `/api/factsheet/[id]/pdf` refuses a non-computed strategy with a 400
 * "Analytics not computed" — and then `page.goto()`s `/factsheet/[id]`, which
 * re-exports THIS module. `/api/factsheet/[id]/tearsheet.pdf` does the same for
 * the tearsheet. Both wrappers were guarding a front door beside an open side
 * door: the pages they screenshot are directly reachable URLs and neither
 * refused anything, so every figure the PDF withheld was served in full to
 * anyone who typed the page URL. The wrappers are deliberately UNCHANGED; the
 * pages now hold the same line, which is what makes their refusal mean
 * something.
 *
 * The defect here is subtler than a missing column. `computation_status` was
 * ALREADY on this page's analytics embed and ALREADY read — but only as an
 * argument passed down into `readSingleKeyBasisOpts`. Nothing gated the RENDER
 * on it. The render gate was `dailyReturns.length === 0`, and a failed run
 * leaves the previous run's `daily_returns` / `returns_series` untouched (the
 * writer stamps the status and the error, not the data), so the gate never
 * fired and the whole panel set was built from a track no finished run
 * vouches for. That is the recurring shape of this defect class across the
 * codebase: the status is selected, and then never filtered.
 *
 * The fix returns the EXISTING `null`, which the caller already renders as the
 * "still computing" placeholder it shows for any strategy whose series has not
 * been ingested. No new state, no new copy, nothing red.
 *
 * ANTI-VACUITY: the fixture carries a REAL 10-point cash series that builds a
 * full payload — proven by the `complete` control in this file, which asserts
 * the payload is PRESENT with real metrics. So the failed-row assertions cannot
 * pass because the fixture had nothing to build from.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound() called");
  },
}));
// unstable_cache → identity: this spec exercises the REAL fetchAndBuildPayload,
// not Next's cache plumbing.
vi.mock("next/cache", () => ({
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
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
import type { FactsheetPayload } from "@/lib/factsheet/types";

// --- Fixtures ---------------------------------------------------------------

const STRATEGY_ID = "51a10001-0000-4000-8000-00000000000c";

/** A REAL, buildable series — the `complete` control proves it builds. */
const CASH_DAILY = [
  { date: "2025-08-01", value: 0.01 },
  { date: "2025-08-02", value: -0.02 },
  { date: "2025-08-03", value: 0.015 },
  { date: "2025-08-04", value: 0.005 },
  { date: "2025-08-05", value: -0.01 },
  { date: "2025-08-06", value: 0.02 },
  { date: "2025-08-07", value: -0.005 },
  { date: "2025-08-08", value: 0.03 },
  { date: "2025-08-09", value: -0.015 },
  { date: "2025-08-10", value: 0.01 },
];

function strategyRow(computationStatus: string) {
  return {
    id: STRATEGY_ID,
    name: "Orpheus",
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
      daily_returns: CASH_DAILY,
      returns_series: null,
      // Re-stamped to the moment of FAILURE by the SQL status bridge.
      computed_at: "2026-08-25T09:15:00.000Z",
      data_quality_flags: {},
      metrics_json_by_basis: null,
      computation_status: computationStatus,
    },
  };
}

function mockAdmin(strategy: unknown): SupabaseClient {
  const from = () => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: () => Promise.resolve({ data: strategy, error: null }),
    };
    return chain;
  };
  return { from } as unknown as SupabaseClient;
}

/** Request-client stub for the outer signature probe (Lane A always hits). */
function mockRequestClient() {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: () =>
      Promise.resolve({
        data: {
          id: STRATEGY_ID,
          name: "Orpheus",
          codename: null,
          disclosure_tier: "exploratory",
          strategy_analytics: { computed_at: "2026-08-25T09:15:00.000Z" },
        },
        error: null,
      }),
  };
  return { from: () => chain };
}

/** Depth-first search of an RSC element tree for the FactsheetView payload. */
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

/** Depth-first collection of every string in an RSC element tree. */
function collectText(node: unknown, out: string[] = []): string[] {
  if (node == null) return out;
  if (typeof node === "string") {
    out.push(node);
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, out);
    return out;
  }
  if (typeof node === "object") {
    const el = node as { props?: { children?: unknown } };
    collectText(el.props?.children ?? null, out);
  }
  return out;
}

async function renderPage(status: string) {
  vi.mocked(createAdminClient).mockReturnValue(mockAdmin(strategyRow(status)));
  return FactsheetV2Page({ params: Promise.resolve({ id: STRATEGY_ID }) });
}

beforeEach(() => {
  vi.mocked(createClient).mockResolvedValue(mockRequestClient() as never);
  vi.mocked(readPublicVerificationSignals).mockResolvedValue(
    new Map([[STRATEGY_ID, { trust_tier: "api_verified", status: "verified" }]]) as never,
  );
});

describe("STALE-01 · /factsheet/[id]/v2 — the page both PDF wrappers screenshot", () => {
  it("V1: a `failed` row builds NO payload — the panel set never renders", async () => {
    const ui = await renderPage("failed");

    expect(
      findPayload(ui),
      "the full factsheet was built from a run that did not finish",
    ).toBeNull();
  });

  it("V2: it falls to the EXISTING still-computing placeholder, not a new error state", async () => {
    const ui = await renderPage("failed");
    const text = collectText(ui).join(" ");

    expect(text).toContain("still computing");
    // The strategy is not deleted and is not shouted at: it keeps its name and
    // the page carries no error/failure vocabulary.
    expect(text).toContain("Orpheus");
    expect(text.toLowerCase()).not.toContain("failed");
    expect(text.toLowerCase()).not.toContain("error");
  });

  it("V3: a live `computing` run is withheld the same way", async () => {
    const ui = await renderPage("computing");

    expect(findPayload(ui)).toBeNull();
  });

  it("V4: CONTROL — a `complete` row builds the full payload with real metrics", async () => {
    const ui = await renderPage("complete");
    const payload = findPayload(ui);

    // Non-null is what proves the fixture series is genuinely buildable: if it
    // were not, V1/V3 would pass vacuously.
    expect(
      payload,
      "the fixture series does not build — V1/V3 would be vacuous",
    ).not.toBeNull();
    expect(payload!.strategyName).toBe("Orpheus");
    expect(Number.isFinite(payload!.strategyMetrics.sharpe)).toBe(true);
  });

  it("V5: CONTROL — `complete_with_warnings` is a terminal SUCCESS and builds too", async () => {
    const ui = await renderPage("complete_with_warnings");

    expect(findPayload(ui)).not.toBeNull();
  });
});
