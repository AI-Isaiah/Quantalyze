/**
 * Phase 194 plan 18 (D-11 as superseded by D-15, founder-decided 2026-11-07): the tearsheet's
 * peer-rank badges for the ANNUALISED metrics (CAGR, Sharpe, Sortino, Volatility) carry the
 * `<1y` marker when the strategy's total record cleared D-15's minimum but spans under one
 * year. Max DD is not annualised and never carries it. A record of a year or more carries no
 * marker. The real `PercentileRankBadge` and the real `PeerRanksSection` are rendered, so what
 * is asserted is what a reader sees.
 *
 * Phase 196 plan 13: the ranks stay on the print view (no decision removed them) and now gate on
 * the factsheet payload's `figureRecord`, built here with `figureRecord()` from the same spans and
 * observation counts the retired span-read stubs used. One record, one verdict: the figures in the
 * opening view and the ranks beside them cannot disagree about whether the record clears. A
 * record that could not be read is `figureRecord: null` on the payload, and the section fails
 * closed exactly as the retired span-read failure did. `FactsheetView` is stubbed: its own tests
 * prove the opening view renders.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
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
vi.mock("../v2/FactsheetView", () => ({
  FactsheetView: () => React.createElement("div", { "data-testid": "factsheet-view" }),
}));
vi.mock("@/components/ui/PrintButton", () => ({
  PrintButton: () => React.createElement("button", null, "Print"),
}));

vi.mock("@/lib/queries", () => ({
  getFactsheetDetail: vi.fn().mockResolvedValue({
    strategy: {
      id: "s-1",
      name: "Test Strategy",
      codename: "STRAT-001",
      status: "published",
      disclosure_tier: "institutional",
      user_id: "u-1",
      discovery_categories: { slug: "momentum" },
    },
    analytics: { computation_status: "complete" },
    manager: null,
    disclosureTier: "institutional",
  }),
  // The rank map the badges read. Five metrics are shown on the tearsheet.
  getPercentiles: vi.fn().mockResolvedValue({
    "s-1": { cagr: 70, sharpe: 80, sortino: 75, max_drawdown: 60, volatility: 55 },
  }),
  readPublicVerificationSignals: vi.fn().mockResolvedValue(new Map()),
}));
vi.mock("@/lib/factsheet/fetch-and-build-payload", () => ({ fetchAndBuildPayloadWithReason: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getUserRolesResult: vi.fn() }));

import TearSheetPage from "./page";
import { createClient } from "@/lib/supabase/server";
import { fetchAndBuildPayloadWithReason } from "@/lib/factsheet/fetch-and-build-payload";
import { figureRecord, shortTrackMarkerTitle } from "@/lib/figure-gate";
import type { FactsheetPayload } from "@/lib/factsheet/types";

beforeEach(() => {
  // An anonymous viewer: the ranks are public, so every case is anonymous.
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
    from: vi.fn(),
  } as unknown as Awaited<ReturnType<typeof createClient>>);
});

afterEach(cleanup);

/**
 * The payload the builder hands the page, carrying the record the factsheet judges the figures
 * on. The strategy has no `asset_class`, so it is judged as non-crypto (252 periods): it clears
 * D-15 on its observation count. `null` is a record that could not be read.
 */
function stub(span: { start: string; end: string; observations: number } | null) {
  const record = span
    ? figureRecord({
        seriesStart: span.start,
        seriesEnd: span.end,
        observations: span.observations,
        periodsPerYear: 252,
      })
    : null;
  vi.mocked(fetchAndBuildPayloadWithReason).mockResolvedValue({
    payload: {
      strategyId: "s-1",
      aum: null,
      maxCapacity: null,
      figureRecord: record,
    } as unknown as FactsheetPayload,
    reason: null,
  });
}

async function renderPage() {
  const page = await TearSheetPage({ params: Promise.resolve({ id: "s-1" }) });
  return render(page as React.ReactElement);
}

/** The badge whose label is `label`, from the "Peer-relative ranks" section. */
function badge(label: string): HTMLElement {
  const section = screen.getByText("Peer-relative ranks").closest("section") as HTMLElement;
  const hit = within(section)
    .getAllByTestId("percentile-rank-badge")
    .find((el) => el.firstElementChild?.textContent === label);
  if (!hit) throw new Error(`no ${label} badge`);
  return hit;
}

describe("TearSheet page - rank badges carry the short-track marker (D-15)", () => {
  it("a 200-day record: CAGR, Sharpe, Sortino and Volatility badges carry <1y; Max DD does not", async () => {
    // 2025-09-01 -> 2026-03-19 covers 200 days (D-20 counts both ends); 140 observations clears the 60 minimum.
    stub({ start: "2025-09-01", end: "2026-03-19", observations: 140 });
    await renderPage();

    const reason = shortTrackMarkerTitle(200);
    for (const label of ["CAGR", "Sharpe", "Sortino", "Volatility"]) {
      const b = badge(label);
      expect(b, label).toHaveTextContent("<1y");
      expect(within(b).getByTitle(reason), label).toBeInTheDocument();
    }
    const dd = badge("Max DD");
    expect(dd).not.toHaveTextContent("<1y");
    expect(dd.querySelector(".sr-only")).toBeNull();
  });

  it("a 400-day record: no badge carries the marker", async () => {
    // 2025-01-01 -> 2026-02-05 is 400 calendar days.
    stub({ start: "2025-01-01", end: "2026-02-05", observations: 280 });
    await renderPage();

    const section = screen.getByText("Peer-relative ranks").closest("section") as HTMLElement;
    const badges = within(section).getAllByTestId("percentile-rank-badge");
    expect(badges).toHaveLength(5);
    for (const b of badges) expect(b).not.toHaveTextContent("<1y");
  });
});

describe("TearSheet page - a withheld or unreadable record ranks Max DD only (194 review WR-01, D-18)", () => {
  const labels = (): string[] => {
    const section = screen.getByText("Peer-relative ranks").closest("section") as HTMLElement;
    return within(section)
      .getAllByTestId("percentile-rank-badge")
      .map((el) => el.firstElementChild?.textContent ?? "");
  };

  it("a 20-observation record (under D-15's minimum): only the Max DD rank renders, though getPercentiles returned all five", async () => {
    stub({ start: "2026-03-01", end: "2026-03-20", observations: 20 });
    await renderPage();
    expect(labels()).toEqual(["Max DD"]);
  });

  it("a record that could not be read (figureRecord null): the figures dash, so the annualised ranks do not render either; Max DD keeps its rank", async () => {
    // No record: the gate fails closed, as the retired span-read failure did.
    stub(null);
    await renderPage();
    expect(labels()).toEqual(["Max DD"]);
  });
});

