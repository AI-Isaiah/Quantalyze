/** @vitest-environment jsdom */
/**
 * Phase 167.1.2.2.2 (TRADESYNC, plan 11) → Phase 196 plan 13: the printed tear sheet states the
 * same two facts as the factsheet header — when the exchange was last read (D-06, D-10) and which
 * days nobody has supplied (D-02, F1) — and now states them BECAUSE it is the factsheet's print
 * view.
 *
 * WHY THESE ARMS MATTER. THE ONE-PAGER IS WHAT GETS FORWARDED. `Data: Fresh` names `computed_at`,
 * which advances for an account that has not been fetched, so a printed document that said "fresh"
 * about a key that stopped being read nine days ago would mislead whoever received it. Until this
 * phase the tear sheet made a service-role read of its own to print the line. It now prints the
 * masthead's, so the facts must reach `FactsheetView` unchanged and the page must NOT make a second
 * read of them: a second read is how the two surfaces came to word one fact two ways.
 *
 * The wording, size, order and verdicts of the lines are proven where they render:
 * `../v2/FactsheetView.trade-fetch-line.test.tsx` and `../v2/FactsheetView.reconstructed-range.test.tsx`
 * (the masthead). The retired arms of this file tested the page's own `readTradeFacts`
 * (published-only select, malformed stamp, non-string exchange, read failure to Sentry, the
 * "unavailable" line, `text-fixed-10` sizing, DOM order under the retired Data pill); each had no
 * subject left once the read was removed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";
import React from "react";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_HTTP_ERROR_FALLBACK;404");
  }),
}));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement("a", { href }, children),
}));
vi.mock("@/components/ui/PrintButton", () => ({
  PrintButton: () => React.createElement("button", null, "Print"),
}));

const recorded = vi.hoisted(() => ({ payloads: [] as Array<Record<string, unknown>> }));
vi.mock("../v2/FactsheetView", () => ({
  FactsheetView: ({ payload }: { payload: Record<string, unknown> }) => {
    recorded.payloads.push(payload);
    return React.createElement("div", { "data-testid": "factsheet-view" });
  },
}));

vi.mock("@/lib/queries", () => ({
  getFactsheetDetail: vi.fn().mockResolvedValue({
    strategy: {
      id: "s-1",
      name: "Test Strategy",
      codename: "STRAT-001",
      status: "published",
      disclosure_tier: "exploratory",
      user_id: "u-1",
      discovery_categories: { slug: "momentum" },
    },
    analytics: { computation_status: "complete" },
    manager: null,
    disclosureTier: "exploratory",
  }),
  getPercentiles: vi.fn().mockResolvedValue(null),
  readPublicVerificationSignals: vi.fn().mockResolvedValue(new Map()),
}));
vi.mock("@/lib/factsheet/fetch-and-build-payload", () => ({ fetchAndBuildPayloadWithReason: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getUserRolesResult: vi.fn() }));
// The page must not reach the service-role client any more: this mock fails loudly if it does.
const adminCalls = vi.hoisted(() => ({ count: 0 }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    adminCalls.count += 1;
    throw new Error("the tear sheet made a service-role read of its own");
  },
}));

import TearSheetPage from "./page";
import { createClient } from "@/lib/supabase/server";
import { fetchAndBuildPayloadWithReason } from "@/lib/factsheet/fetch-and-build-payload";
import type { FactsheetPayload } from "@/lib/factsheet/types";

const FACTS = {
  tradesFetchedAt: "2026-11-01T08:00:00Z",
  tradeFetchVenue: "okx",
  unrecoveredGaps: [{ from: "2026-10-20", to: "2026-10-22", days: 3 }],
  reconstructedRanges: [{ from: "2026-10-01", to: "2026-10-05", days: 5 }],
  reconstructedRangesUnavailable: false,
};

beforeEach(() => {
  recorded.payloads.length = 0;
  adminCalls.count = 0;
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
    from: vi.fn(),
  } as unknown as Awaited<ReturnType<typeof createClient>>);
  vi.mocked(fetchAndBuildPayloadWithReason).mockResolvedValue({
    payload: {
      strategyId: "s-1",
      aum: null,
      maxCapacity: null,
      figureRecord: null,
      ...FACTS,
    } as unknown as FactsheetPayload,
    reason: null,
  });
});

afterEach(cleanup);

async function renderPage() {
  const page = await TearSheetPage({ params: Promise.resolve({ id: "s-1" }) });
  return render(page as React.ReactElement);
}

describe("TearSheet page - the trade-fetch facts ride the factsheet payload (D-06, D-10, D-02, F1)", () => {
  it("hands FactsheetView the last-fetch stamp, the venue, the named gaps and the rebuilt ranges exactly as built", async () => {
    await renderPage();
    expect(recorded.payloads).toHaveLength(1);
    const p = recorded.payloads[0];
    expect(p.tradesFetchedAt).toBe(FACTS.tradesFetchedAt);
    expect(p.tradeFetchVenue).toBe(FACTS.tradeFetchVenue);
    expect(p.unrecoveredGaps).toEqual(FACTS.unrecoveredGaps);
    expect(p.reconstructedRanges).toEqual(FACTS.reconstructedRanges);
    expect(p.reconstructedRangesUnavailable).toBe(false);
  });

  it("a malformed reconstructed-range record reaches the masthead as `unavailable`, never as an empty list", async () => {
    vi.mocked(fetchAndBuildPayloadWithReason).mockResolvedValue({
      payload: {
        strategyId: "s-1",
        aum: null,
        maxCapacity: null,
        figureRecord: null,
        ...FACTS,
        reconstructedRanges: [],
        reconstructedRangesUnavailable: true,
      } as unknown as FactsheetPayload,
      reason: null,
    });
    await renderPage();
    const p = recorded.payloads[0];
    expect(p.reconstructedRangesUnavailable).toBe(true);
    expect(p.reconstructedRanges).toEqual([]);
  });

  it("the page makes no service-role read of its own for them (one data path)", async () => {
    await renderPage();
    expect(adminCalls.count).toBe(0);
  });
});
