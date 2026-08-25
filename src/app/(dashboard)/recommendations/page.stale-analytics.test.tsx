/** @vitest-environment jsdom */
/**
 * STALE-01 part 2 — /recommendations, the surface where the numbers ARE the
 * argument.
 *
 * Each card ranks another manager's published strategy under "Strong fit for
 * your current mandate" and prints CAGR / Sharpe / Max DD as the evidence. The
 * figures come from `get_allocator_recommendations`, whose body does
 * `LEFT JOIN strategy_analytics` with NO status clause and whose RETURNS TABLE
 * does not project `computation_status` at all — so nothing downstream could
 * tell a finished run's figures from a `failed` run's leftovers (17 of 18
 * published strategies, prod census 2026-08-25).
 *
 * WHY THE GATE IS IN TYPESCRIPT AND NOT IN THE RPC — argued, not defaulted.
 * Widening the RETURNS TABLE requires DROP + CREATE (Postgres refuses to change
 * a function's return type in place), and on a SECURITY DEFINER function that
 * also drops the ACL state migration 20260409133655 hardened. Merging
 * `supabase/migrations/**` AUTO-APPLIES to production, so a hotfix branch is
 * the worst place to spend that risk. A return-shape-preserving `CASE WHEN`
 * inside the function body is the right DURABLE home and belongs in a
 * migration-reviewed PR. Until then the gate reads the SAME `isRankable`
 * predicate every other surface in this fix reads, in one language, so the
 * cohort gate / cell gate / this gate cannot drift.
 *
 * The read is BOUNDED BY CONSTRUCTION to the ids the RPC returned, and it FAILS
 * CLOSED — RC5 pins that a status-read error degrades to em-dashes rather than
 * showing figures nothing vouches for.
 *
 * ANTI-VACUITY: the dead candidate carries best-in-class figures with unique
 * rendered strings; a terminal-success candidate sits beside it in the SAME
 * list asserting those strings DO render.
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
  recs: [] as unknown[],
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
            : {
                data: { mandate_archetype: "systematic", target_ticket_size_usd: 1 },
                error: null,
              },
        );
      // `strategy_analytics` is read by awaiting the `.in()` builder directly.
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
        : {
            data: [
              {
                batch_id: "51a10001-0000-4000-8000-0000000000b0",
                computed_at: "2026-08-25T00:00:00.000Z",
                candidate_count: 2,
              },
            ],
            error: null,
          },
  }),
}));

import RecommendationsPage from "./page";

// --- Fixtures -------------------------------------------------------------

const DEAD_ID = "51a10001-0000-4000-8000-00000000000d";
const LIVE_ID = "51a10001-0000-4000-8000-00000000000e";

const STALE_TEXT = { cagr: "+66.12%", sharpe: "3.77", max_dd: "-3.11%" } as const;
const LIVE_TEXT = { cagr: "+5.00%", sharpe: "0.60", max_dd: "-40.00%" } as const;

function rec(
  id: string,
  name: string,
  rank: number,
  kpis: { cagr: number; sharpe: number; max_drawdown: number },
) {
  return {
    id: `cand-${id}`,
    strategy_id: id,
    rank,
    score: 0.9,
    reasons: ["Strong fit for your current mandate."],
    strategy_name: name,
    strategy_description: null,
    discovery_category_slug: "crypto-sma",
    ...kpis,
    // Re-stamped to the moment of FAILURE by the SQL status bridge.
    analytics_computed_at: "2026-08-25T09:15:00.000Z",
  };
}

const DEAD_REC = rec(DEAD_ID, "Orpheus", 1, {
  cagr: 0.6612,
  sharpe: 3.77,
  max_drawdown: -0.0311,
});
const LIVE_REC = rec(LIVE_ID, "Meridian", 2, {
  cagr: 0.05,
  sharpe: 0.6,
  max_drawdown: -0.4,
});

async function renderPage() {
  const ui = await RecommendationsPage();
  render(ui as React.ReactElement);
}

function cardFor(name: string): HTMLElement {
  const heading = screen.getByText(name);
  const li = heading.closest("li");
  expect(li, `no card rendered for ${name}`).not.toBeNull();
  return li as HTMLElement;
}

beforeEach(() => {
  seeded.recs = [DEAD_REC, LIVE_REC];
  seeded.statusRows = [
    { strategy_id: DEAD_ID, computation_status: "failed" },
    { strategy_id: LIVE_ID, computation_status: "complete" },
  ];
  seeded.statusError = null;
});

describe("STALE-01 · /recommendations — the numbers ARE the argument", () => {
  it("RC1: a `failed` candidate's figures are withheld", async () => {
    await renderPage();
    const dead = within(cardFor("Orpheus"));

    for (const [metric, text] of Object.entries(STALE_TEXT)) {
      expect(
        dead.queryByText(text),
        `${metric} (${text}) from a failed run was offered as evidence for a recommendation`,
      ).toBeNull();
    }
    expect(dead.getAllByText("—").length).toBe(3);
  });

  it("RC2: the recommendation itself stands — rank, name and reason survive", async () => {
    await renderPage();
    const dead = within(cardFor("Orpheus"));

    // The match SCORE comes from the batch engine and is not a claim about a
    // current analytics run, so the card is not dropped.
    expect(dead.getByText("#1")).toBeTruthy();
    expect(dead.getByText(/Strong fit for your current mandate/)).toBeTruthy();
  });

  it("RC3: a live `computing` candidate is withheld the same way", async () => {
    seeded.statusRows = [
      { strategy_id: DEAD_ID, computation_status: "computing" },
      { strategy_id: LIVE_ID, computation_status: "complete" },
    ];
    await renderPage();

    expect(within(cardFor("Orpheus")).queryByText(STALE_TEXT.sharpe)).toBeNull();
  });

  it("RC4: a candidate with NO analytics row at all is withheld — the map fails closed", async () => {
    seeded.statusRows = [{ strategy_id: LIVE_ID, computation_status: "complete" }];
    await renderPage();

    expect(within(cardFor("Orpheus")).getAllByText("—").length).toBe(3);
  });

  it("RC5: a status-read ERROR degrades every card to em-dashes, never to unverified figures", async () => {
    seeded.statusError = { message: "boom" };
    seeded.statusRows = [];
    await renderPage();

    expect(within(cardFor("Orpheus")).getAllByText("—").length).toBe(3);
    expect(within(cardFor("Meridian")).getAllByText("—").length).toBe(3);
  });

  it("RC6: CONTROL — the `complete` candidate keeps every figure", async () => {
    await renderPage();
    const live = within(cardFor("Meridian"));

    for (const [metric, text] of Object.entries(LIVE_TEXT)) {
      expect(
        live.queryByText(text),
        `${metric} (${text}) vanished from a COMPLETE candidate — the gate is over-broad`,
      ).not.toBeNull();
    }
  });

  it("RC7: CONTROL — `complete_with_warnings` is a terminal SUCCESS and keeps its figures", async () => {
    seeded.statusRows = [
      { strategy_id: DEAD_ID, computation_status: "failed" },
      { strategy_id: LIVE_ID, computation_status: "complete_with_warnings" },
    ];
    await renderPage();

    expect(within(cardFor("Meridian")).getByText(LIVE_TEXT.sharpe)).toBeTruthy();
  });
});
