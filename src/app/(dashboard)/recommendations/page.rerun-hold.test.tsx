/** @vitest-environment jsdom */
/**
 * Phase 237 (FACTSHEETHONEST) FACT-02, surface S7 — a /recommendations card
 * stays published during a re-run and says so.
 *
 * A `pending` or `computing` row over a stored success result carries the last
 * success's figures, still true while a re-run is in flight. The card keeps its
 * CAGR, Sharpe and Max DD and shows ANALYTICS_UPDATING_LINE as the last child of
 * its left column. The verdict is `analyticsHold(row)`, the same one the
 * factsheet applies (phase agent ruling 2: parity, not an alias-only
 * exemption), so a composite re-stitch and a terminal-success row with an
 * unbound derive prestamp withhold here as they do on the factsheet.
 *
 * ANTI-VACUITY: every case renders a held or terminal control in the SAME list
 * as the case under test, with unique figure strings, so a withheld card cannot
 * pass by the page rendering nothing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import React from "react";

import { ANALYTICS_UPDATING_LINE } from "@/lib/status-surface-copy";

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
  AccreditedInvestorGate: () => React.createElement("div", { "data-testid": "gate" }),
}));

const seeded = vi.hoisted(() => ({
  recs: [] as unknown[],
  statusRows: [] as unknown[],
  statusError: null as unknown,
  /** Every `.select(...)` argument the page issued against `strategy_analytics`. */
  analyticsSelects: [] as string[],
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
        if (table === "strategy_analytics") seeded.analyticsSelects.push(cols);
        return chain;
      };
      chain.eq = () => chain;
      chain.in = () => chain;
      chain.maybeSingle = () =>
        Promise.resolve(
          table === "investor_attestations"
            ? { data: { attested_at: "2026-01-01T00:00:00Z" }, error: null }
            : {
                data: { max_weight: 0.2, preferred_strategy_types: [], target_ticket_size_usd: 1 },
                error: null,
              },
        );
      chain.then = (onFulfilled: (v: { data: unknown; error: unknown }) => unknown) =>
        Promise.resolve(
          table === "strategy_analytics"
            ? { data: seeded.statusRows, error: seeded.statusError }
            : table === "strategies"
              ? {
                  data: (seeded.recs as Array<{ strategy_id: string }>).map((r) => ({
                    id: r.strategy_id,
                    asset_class: "crypto",
                  })),
                  error: null,
                }
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
                computed_at: "2026-11-20T00:00:00.000Z",
                candidate_count: 2,
              },
            ],
            error: null,
          },
  }),
}));

import RecommendationsPage from "./page";

// --- Fixtures -------------------------------------------------------------

const HELD_ID = "51a10001-0000-4000-8000-0000000000a1";
const CTRL_ID = "51a10001-0000-4000-8000-0000000000a2";

// Unique rendered strings per card: held and control never share a figure.
const HELD_TEXT = { cagr: "+66.12%", sharpe: "3.77", max_dd: "-3.11%" } as const;
const CTRL_TEXT = { cagr: "+5.00%", sharpe: "0.60", max_dd: "-40.00%" } as const;

const COMPUTED_AT = "2026-11-20T09:15:00.000Z";

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
    analytics_computed_at: COMPUTED_AT,
  };
}

const HELD_REC = rec(HELD_ID, "Orpheus", 1, { cagr: 0.6612, sharpe: 3.77, max_drawdown: -0.0311 });
const CTRL_REC = rec(CTRL_ID, "Meridian", 2, { cagr: 0.05, sharpe: 0.6, max_drawdown: -0.4 });

// A stored success: series end, a finite headline, success-written flags.
const STORED = {
  series_end: "2026-11-19",
  cumulative_return: 0.42,
  computed_at: COMPUTED_AT,
  data_quality_flags: { cumulative_method: "compounded" },
};

const CTRL_COMPLETE = { strategy_id: CTRL_ID, computation_status: "complete", ...STORED };

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

function updatingLines(card: HTMLElement): HTMLElement[] {
  return Array.from(card.querySelectorAll<HTMLElement>('[data-testid="recommendation-analytics-updating"]'));
}

beforeEach(() => {
  seeded.recs = [HELD_REC, CTRL_REC];
  seeded.statusRows = [];
  seeded.statusError = null;
  seeded.analyticsSelects = [];
});

describe("FACT-02 S7 · /recommendations — a held re-run keeps its figures and says it is updating", () => {
  for (const status of ["pending", "computing"] as const) {
    it(`H1: a ${status} candidate over a stored success keeps CAGR, Sharpe and Max DD and shows the Updating line once`, async () => {
      seeded.statusRows = [{ strategy_id: HELD_ID, computation_status: status, ...STORED }, CTRL_COMPLETE];
      await renderPage();
      const held = within(cardFor("Orpheus"));

      for (const [metric, text] of Object.entries(HELD_TEXT)) {
        expect(
          held.queryByText(text),
          `${metric} (${text}) of a ${status} re-run over a stored success was withheld`,
        ).not.toBeNull();
      }
      const lines = updatingLines(cardFor("Orpheus"));
      expect(lines).toHaveLength(1);
      expect(lines[0].textContent).toBe(ANALYTICS_UPDATING_LINE);
      expect(lines[0].tagName).toBe("P");
      expect(lines[0].className).toBe("mt-2 text-xs text-text-muted");
      // UI-SPEC G3: static copy, no live region.
      expect(lines[0].getAttribute("role")).toBeNull();
      expect(lines[0].getAttribute("aria-live")).toBeNull();
    });
  }

  it("H2: the line is the LAST child of the card's left column, after the Metric row", async () => {
    seeded.statusRows = [{ strategy_id: HELD_ID, computation_status: "computing", ...STORED }, CTRL_COMPLETE];
    await renderPage();
    const [line] = updatingLines(cardFor("Orpheus"));
    const column = line.parentElement as HTMLElement;
    expect(column.lastElementChild).toBe(line);
    const metrics = column.querySelectorAll("[data-metric]");
    expect(metrics.length).toBe(3);
    const lastMetric = metrics[metrics.length - 1] as HTMLElement;
    expect(lastMetric.parentElement?.nextElementSibling).toBe(line);
  });

  it("H3: CONTROL — a terminal-success candidate keeps its figures and has no Updating line", async () => {
    seeded.statusRows = [{ strategy_id: HELD_ID, computation_status: "computing", ...STORED }, CTRL_COMPLETE];
    await renderPage();
    const ctrl = within(cardFor("Meridian"));
    for (const text of Object.values(CTRL_TEXT)) expect(ctrl.queryByText(text)).not.toBeNull();
    expect(updatingLines(cardFor("Meridian"))).toHaveLength(0);
  });

  it("H4: a computing candidate WITHOUT stored evidence withholds, with no Updating line", async () => {
    seeded.statusRows = [{ strategy_id: HELD_ID, computation_status: "computing" }, CTRL_COMPLETE];
    await renderPage();
    const card = cardFor("Orpheus");
    expect(within(card).getAllByText("—").length).toBe(3);
    for (const text of Object.values(HELD_TEXT)) expect(within(card).queryByText(text)).toBeNull();
    expect(updatingLines(card)).toHaveLength(0);
    // Anti-vacuity: the control beside it still renders its figures.
    expect(within(cardFor("Meridian")).queryByText(CTRL_TEXT.sharpe)).not.toBeNull();
  });

  it("H5: a FAILED candidate withholds even over stored evidence, with no Updating line", async () => {
    seeded.statusRows = [{ strategy_id: HELD_ID, computation_status: "failed", ...STORED }, CTRL_COMPLETE];
    await renderPage();
    const card = cardFor("Orpheus");
    expect(within(card).getAllByText("—").length).toBe(3);
    expect(updatingLines(card)).toHaveLength(0);
    expect(within(cardFor("Meridian")).queryByText(CTRL_TEXT.sharpe)).not.toBeNull();
  });

  it("H6: a computing COMPOSITE over stored evidence withholds, as the factsheet does", async () => {
    seeded.statusRows = [
      {
        strategy_id: HELD_ID,
        computation_status: "computing",
        ...STORED,
        data_quality_flags: { cumulative_method: "compounded", composite: true },
      },
      CTRL_COMPLETE,
    ];
    await renderPage();
    const card = cardFor("Orpheus");
    expect(within(card).getAllByText("—").length).toBe(3);
    for (const text of Object.values(HELD_TEXT)) expect(within(card).queryByText(text)).toBeNull();
    expect(updatingLines(card)).toHaveLength(0);
    expect(within(cardFor("Meridian")).queryByText(CTRL_TEXT.sharpe)).not.toBeNull();
  });

  it("H7: a terminal-success candidate whose live flags carry the snapshot key and no bound snapshot withholds (D-04)", async () => {
    seeded.statusRows = [
      {
        strategy_id: HELD_ID,
        computation_status: "complete",
        ...STORED,
        data_quality_flags: { last_success_snapshot: null },
      },
      CTRL_COMPLETE,
    ];
    await renderPage();
    const card = cardFor("Orpheus");
    expect(within(card).getAllByText("—").length).toBe(3);
    for (const text of Object.values(HELD_TEXT)) expect(within(card).queryByText(text)).toBeNull();
    expect(updatingLines(card)).toHaveLength(0);
    expect(within(cardFor("Meridian")).queryByText(CTRL_TEXT.sharpe)).not.toBeNull();
  });

  it("H8: a status-read ERROR keeps every card withheld with no Updating line", async () => {
    seeded.statusError = { message: "boom" };
    seeded.statusRows = [];
    await renderPage();
    for (const name of ["Orpheus", "Meridian"]) {
      expect(within(cardFor(name)).getAllByText("—").length).toBe(3);
      expect(updatingLines(cardFor(name))).toHaveLength(0);
    }
  });

  it("H9: the status read names cumulative_return, computed_at and data_quality_flags, or the hold is dead code", async () => {
    seeded.statusRows = [{ strategy_id: HELD_ID, computation_status: "computing", ...STORED }, CTRL_COMPLETE];
    await renderPage();
    expect(seeded.analyticsSelects).toHaveLength(1);
    const cols = seeded.analyticsSelects[0];
    for (const needed of ["cumulative_return", "computed_at", "data_quality_flags", "computation_status", "series_end"]) {
      expect(cols, `the status read does not select ${needed}`).toContain(needed);
    }
  });

  it("H10: the flags blob never reaches the DOM", async () => {
    seeded.statusRows = [
      {
        strategy_id: HELD_ID,
        computation_status: "computing",
        ...STORED,
        data_quality_flags: { cumulative_method: "compounded", secret_marker_blob: "LEAK-CANARY" },
      },
      CTRL_COMPLETE,
    ];
    await renderPage();
    expect(document.body.innerHTML).not.toContain("LEAK-CANARY");
    expect(document.body.innerHTML).not.toContain("secret_marker_blob");
  });
});
