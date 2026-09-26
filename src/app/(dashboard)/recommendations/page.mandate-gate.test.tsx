/** @vitest-environment jsdom */
/**
 * Phase 169.3 / SC8: /recommendations makes ONE statement about the mandate.
 *
 * WHY THIS MATTERS. Before this fix the page derived `mandateSet`, rendered
 * "Set your mandate to see recommendations" when it was false, and STILL
 * rendered the candidate list plus a hard-coded header saying the strategies
 * "fit your mandate". The match engine scores an allocator with no mandate on
 * its default preferences, so a batch exists for them and the page asserted a
 * mandate fit it had no mandate to fit. An allocator reading the page could not
 * tell which of the two contradicting statements was true.
 *
 * CHOSEN TREATMENT: WITHHOLD. With no mandate, the candidate list is not
 * rendered at all; only the set-mandate call to action is. That keeps the call
 * to action's own heading ("... to see recommendations") true, and it keeps the
 * card copy (engine reasons such as "Matches the X mandate", and the card's
 * fallback reason) from making a mandate claim on a no-mandate page.
 *
 * The mandate PREDICATE is not under test here: plan 169.3-04 replaces it
 * (D-03). These tests pin that the page is self-consistent around whichever
 * predicate it reads.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import React from "react";

vi.mock("server-only", () => ({}));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement("a", { href }, children),
}));
vi.mock("next/cache", () => ({ unstable_noStore: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: () => {
    throw new Error("redirect() called");
  },
}));
vi.mock("@/lib/auth/requireRolePage", () => ({
  requireRolePage: async () => {},
}));
vi.mock("@/components/ui/Disclaimer", () => ({
  Disclaimer: () => React.createElement("div", { "data-testid": "disclaimer" }),
}));
vi.mock("@/components/legal/AccreditedInvestorGate", () => ({
  AccreditedInvestorGate: () =>
    React.createElement("div", { "data-testid": "gate" }),
}));

const seeded = vi.hoisted(() => ({
  prefs: null as unknown,
  recs: [] as unknown[],
  batchMeta: [] as unknown[],
  statusRows: [] as unknown[],
  statusError: null as unknown,
  analyticsSelect: [] as string[],
  analyticsIn: [] as Array<{ column: string; ids: unknown }>,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: { id: "00000000-0000-4000-8000-0000000000aa" } },
        error: null,
      }),
    },
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      chain.select = (cols: string) => {
        if (table === "strategy_analytics") seeded.analyticsSelect.push(cols);
        return chain;
      };
      chain.eq = () => chain;
      chain.in = (column: string, ids: unknown) => {
        if (table === "strategy_analytics") seeded.analyticsIn.push({ column, ids });
        return chain;
      };
      chain.maybeSingle = () =>
        Promise.resolve(
          table === "investor_attestations"
            ? { data: { attested_at: "2026-01-01T00:00:00Z" }, error: null }
            : { data: seeded.prefs, error: null },
        );
      // Like PostgREST, a column comes back only if the select projected it:
      // a row's `series_end` is dropped unless the alias was selected, so a
      // regression that stops projecting it fails AGE1, not only AGE4.
      chain.then = (onFulfilled: (v: { data: unknown; error: unknown }) => unknown) => {
        const projected = (seeded.analyticsSelect.at(-1) ?? "").includes("series_end:");
        const rows = (seeded.statusRows as Array<Record<string, unknown>>).map((r) => {
          if (projected) return r;
          const { series_end: _dropped, ...rest } = r;
          return rest;
        });
        return Promise.resolve(
          table === "strategy_analytics"
            ? { data: rows, error: seeded.statusError }
            : { data: [], error: null },
        ).then(onFulfilled);
      };
      return chain;
    },
    rpc: async (name: string) =>
      name === "get_allocator_recommendations"
        ? { data: seeded.recs, error: null }
        : { data: seeded.batchMeta, error: null },
  }),
}));

import RecommendationsPage from "./page";

// --- Fixtures (synthetic ids and names only) ------------------------------

const IDS = [
  "51a10002-0000-4000-8000-000000000001",
  "51a10002-0000-4000-8000-000000000002",
  "51a10002-0000-4000-8000-000000000003",
] as const;
const NAMES = ["Alpha Test", "Beta Test", "Gamma Test"] as const;

const MANDATE = { mandate_archetype: "systematic", target_ticket_size_usd: 1 };
const BATCH = {
  batch_id: "51a10002-0000-4000-8000-0000000000b0",
  computed_at: "2026-09-25T00:00:00.000Z",
  candidate_count: 3,
};

function rec(i: 0 | 1 | 2) {
  return {
    id: `cand-${IDS[i]}`,
    strategy_id: IDS[i],
    rank: i + 1,
    score: 0.9,
    reasons: ["Matches the trend mandate"],
    strategy_name: NAMES[i],
    strategy_description: null,
    discovery_category_slug: "crypto-sma",
    cagr: 0.1,
    sharpe: 1.1,
    max_drawdown: -0.2,
    analytics_computed_at: hoursAgo(1),
  };
}

/** Relative to the real clock: SyncBadge reads Date.now() with no injection. */
function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 3_600_000).toISOString();
}
function dateDaysAgo(d: number): string {
  return new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10);
}

function cardFor(name: string): HTMLElement {
  const li = screen.getByText(name).closest("li");
  expect(li, `no card rendered for ${name}`).not.toBeNull();
  return li as HTMLElement;
}

async function renderPage() {
  const ui = await RecommendationsPage();
  return render(ui as React.ReactElement);
}

const CTA = "Set your mandate to see recommendations";
const MANDATE_FIT_HEADER = "Top 3 strategies that fit your mandate. Updated daily.";

beforeEach(() => {
  seeded.prefs = MANDATE;
  seeded.recs = [rec(0), rec(1), rec(2)];
  seeded.batchMeta = [BATCH];
  seeded.statusRows = IDS.map((id) => ({
    strategy_id: id,
    computation_status: "complete",
    computed_at: hoursAgo(1),
    series_end: dateDaysAgo(1),
  }));
  seeded.statusError = null;
  seeded.analyticsSelect = [];
  seeded.analyticsIn = [];
});

describe("SC8 · /recommendations — one mandate branch drives the header and the list", () => {
  it("MG1: no mandate + a 3-candidate batch — never says 'fit your mandate' and withholds the list", async () => {
    seeded.prefs = null;
    const { container } = await renderPage();
    const text = container.textContent ?? "";

    expect(
      text,
      "the page claimed a mandate fit for an allocator with no mandate",
    ).not.toMatch(/fit your mandate/i);
    expect(screen.getByText(CTA)).toBeTruthy();
    // Withheld, not relabelled: no candidate card renders beside the CTA.
    for (const name of NAMES) {
      expect(screen.queryByText(name), `${name} rendered on a no-mandate page`).toBeNull();
    }
    expect(container.querySelector("ol")).toBeNull();
    // The card copy's mandate claims cannot leak through a withheld list.
    expect(text).not.toMatch(/Matches the .* mandate/i);
  });

  it("MG2: mandate set + a 3-candidate batch — the header states the mandate fit and no CTA renders", async () => {
    await renderPage();

    expect(screen.getByText(MANDATE_FIT_HEADER)).toBeTruthy();
    expect(screen.queryByText(CTA)).toBeNull();
    for (const name of NAMES) {
      expect(screen.getByText(name)).toBeTruthy();
    }
  });

  it("MG3: mandate set + no batch — the first-batch state only", async () => {
    seeded.batchMeta = [];
    seeded.recs = [];
    const { container } = await renderPage();

    expect(screen.getByText("Your first batch is computing")).toBeTruthy();
    expect(screen.queryByText(CTA)).toBeNull();
    expect(screen.queryByText("No candidates match today")).toBeNull();
    expect(container.querySelector("ol")).toBeNull();
  });

  it("MG4: no mandate + no candidates — the CTA only, no empty-list copy that implies a mandate", async () => {
    seeded.prefs = null;
    seeded.batchMeta = [];
    seeded.recs = [];
    const { container } = await renderPage();

    expect(screen.getByText(CTA)).toBeTruthy();
    expect(screen.queryByText("Your first batch is computing")).toBeNull();
    expect(screen.queryByText("No candidates match today")).toBeNull();
    expect(container.textContent ?? "").not.toMatch(/fit your mandate/i);
  });
});

describe("SC8 · /recommendations — every recommended record states where its track record ends", () => {
  it("AGE1: a series that ended 200 days ago renders the track-record-ended state, not a fresh sync", async () => {
    seeded.statusRows = [
      {
        strategy_id: IDS[0],
        computation_status: "complete",
        computed_at: hoursAgo(1),
        series_end: dateDaysAgo(200),
      },
    ];
    await renderPage();
    const card = within(cardFor(NAMES[0]));

    expect(
      card.queryByText(/^Track record ends 200d ago$/),
      "a record that ended 200 days ago read as current",
    ).not.toBeNull();
    expect(card.queryByText(/^Synced /)).toBeNull();
  });

  it("AGE2: a series that ended yesterday renders the fresh sync state", async () => {
    await renderPage();
    const card = within(cardFor(NAMES[1]));

    expect(card.queryByText(/^Synced 1h ago$/)).not.toBeNull();
    expect(card.queryByText(/Track record ends/)).toBeNull();
  });

  it("AGE3: a failed status read renders no age claim at all (fail-closed)", async () => {
    seeded.statusError = { message: "boom" };
    seeded.statusRows = [];
    await renderPage();

    for (const name of NAMES) {
      const card = within(cardFor(name));
      expect(card.queryByText(/^Synced /)).toBeNull();
      expect(card.queryByText(/Track record ends/)).toBeNull();
    }
  });

  it("AGE4: the status read stays bounded to the RPC's own ids and projects one date, never the series", async () => {
    await renderPage();

    expect(seeded.analyticsIn).toEqual([{ column: "strategy_id", ids: [...IDS] }]);
    expect(seeded.analyticsSelect).toHaveLength(1);
    const cols = seeded.analyticsSelect[0];
    expect(cols).toContain("series_end:returns_series->-1->>date");
    // The whole returns_series blob is never projected; only the arrow alias.
    expect(cols.replace("returns_series->-1->>date", "")).not.toContain("returns_series");
  });
});
