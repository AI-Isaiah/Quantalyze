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
import { render, screen } from "@testing-library/react";
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
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.in = () => chain;
      chain.maybeSingle = () =>
        Promise.resolve(
          table === "investor_attestations"
            ? { data: { attested_at: "2026-01-01T00:00:00Z" }, error: null }
            : { data: seeded.prefs, error: null },
        );
      chain.then = (onFulfilled: (v: { data: unknown; error: unknown }) => unknown) =>
        Promise.resolve(
          table === "strategy_analytics"
            ? { data: seeded.statusRows, error: seeded.statusError }
            : { data: [], error: null },
        ).then(onFulfilled);
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
    analytics_computed_at: new Date().toISOString(),
  };
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
  }));
  seeded.statusError = null;
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
