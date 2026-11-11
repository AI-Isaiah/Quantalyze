/** @vitest-environment jsdom */
/**
 * Phase 194.1 plan 07 (2026-11-08; census B5, 194 D-04 as superseded by D-15) -
 * /recommendations judges each card's CAGR and Sharpe on THAT strategy's total
 * record.
 *
 * Why it matters: the page presents other managers' strategies as "a strong fit for
 * your mandate" with CAGR and Sharpe as the evidence. A 40-day record's Sharpe must
 * read as withheld here exactly as it does on the browse page and the factsheet.
 *
 * Mock idiom copied from page.stale-analytics.test.tsx, widened to answer the page's
 * bounded `strategies` read (the RPC returns no asset class) and to project the record
 * scalar aliases the way PostgREST would: a row carries them only if the select asked.
 * Expected strings are hand-typed, never imported from the gate module, so a wording
 * change there is seen here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
  statusRows: [] as Array<Record<string, unknown>>,
  statusError: null as unknown,
  // `undefined` = answer every recommended id with `classDefault`; an array = exactly those rows.
  classRows: undefined as Array<{ id: string; asset_class: string }> | undefined,
  classDefault: "crypto",
  classError: null as unknown,
  calls: [] as Array<{ table: string; op: string; args: unknown[] }>,
}));

const ALIAS_KEYS = ["series_start", "series_end", "headline_since", "record_observations"];

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
      let selected = "";
      chain.select = (cols: string) => {
        selected = cols;
        seeded.calls.push({ table, op: "select", args: [cols] });
        return chain;
      };
      chain.eq = (...args: unknown[]) => {
        seeded.calls.push({ table, op: "eq", args });
        return chain;
      };
      chain.in = (...args: unknown[]) => {
        seeded.calls.push({ table, op: "in", args });
        return chain;
      };
      chain.maybeSingle = () =>
        Promise.resolve(
          table === "investor_attestations"
            ? { data: { attested_at: "2026-01-01T00:00:00Z" }, error: null }
            : {
                data: { max_weight: 0.2, preferred_strategy_types: [], target_ticket_size_usd: 1 },
                error: null,
              },
        );
      chain.then = (onFulfilled: (v: { data: unknown; error: unknown }) => unknown) => {
        let result: { data: unknown; error: unknown } = { data: [], error: null };
        if (table === "strategy_analytics") {
          // Like PostgREST: an alias comes back only if the select projected it.
          const projected = ALIAS_KEYS.every((k) => selected.includes(`${k}:`));
          result = {
            data: seeded.statusRows.map((r) => {
              if (projected) return r;
              const copy = { ...r };
              for (const k of ALIAS_KEYS) delete copy[k];
              return copy;
            }),
            error: seeded.statusError,
          };
        } else if (table === "strategies") {
          const ids = (seeded.recs as Array<{ strategy_id: string }>).map((r) => r.strategy_id);
          result = {
            data:
              seeded.classError !== null
                ? null
                : (seeded.classRows ??
                  ids.map((id) => ({ id, asset_class: seeded.classDefault }))),
            error: seeded.classError,
          };
        }
        return Promise.resolve(result).then(onFulfilled);
      };
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

const START = "2025-01-01";

/** The last date of a record that COVERS `days` days from START (D-20: both ends counted). */
function endAfter(days: number): string {
  const d = new Date(`${START}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days - 1);
  return d.toISOString().slice(0, 10);
}

const A_ID = "51a10001-0000-4000-8000-00000000000a";
const B_ID = "51a10001-0000-4000-8000-00000000000b";

function rec(id: string, name: string, rank: number, sharpe = 2.1) {
  return {
    id: `cand-${id}`,
    strategy_id: id,
    rank,
    score: 0.9,
    reasons: ["Strong fit for your current mandate."],
    strategy_name: name,
    strategy_description: null,
    discovery_category_slug: "crypto-sma",
    cagr: 0.5,
    sharpe,
    max_drawdown: -0.2,
    analytics_computed_at: "2026-08-25T09:15:00.000Z",
  };
}

function status(
  id: string,
  coveringDays: number,
  observations: number | null,
  computation_status = "complete",
) {
  return {
    strategy_id: id,
    computation_status,
    trades_fetched_at: null,
    series_start: START,
    series_end: endAfter(coveringDays),
    headline_since: null,
    record_observations: observations,
  };
}

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

/**
 * The value span beside a metric label ("CAGR", "Sharpe", "Max DD"). Phase 201 plan 17: the
 * label text sits inside a `Term` trigger, so the row is the nearest
 * `[data-metric]` ancestor, not the label's direct parent.
 */
function cell(card: HTMLElement, label: string): HTMLElement {
  const l = within(card).getByText(label);
  const row = l.closest("[data-metric]") as HTMLElement;
  return row.lastElementChild as HTMLElement;
}

/** The `title` the cell carries, or null when it carries none. */
function titleOf(el: HTMLElement): string | null {
  return el.querySelector("[title]")?.getAttribute("title") ?? null;
}

const WITHHELD_40 = "Withheld until the record reaches 90 days (40 days so far).";

beforeEach(() => {
  seeded.recs = [rec(A_ID, "Orpheus", 1)];
  seeded.statusRows = [status(A_ID, 400, 400)];
  seeded.statusError = null;
  seeded.classRows = undefined;
  seeded.classDefault = "crypto";
  seeded.classError = null;
  seeded.calls = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("194.1 B5 · /recommendations - each card's CAGR and Sharpe follow its total record", () => {
  it("a 40-day crypto record: CAGR and Sharpe are withheld with the reason, Max DD shows", async () => {
    seeded.statusRows = [status(A_ID, 40, 40)];
    await renderPage();
    const card = cardFor("Orpheus");

    for (const label of ["CAGR", "Sharpe"]) {
      const c = cell(card, label);
      expect(c.textContent, `${label} printed a figure on a 40-day record`).toMatch(/^—/);
      expect(c.textContent).not.toMatch(/50|2\.10/);
      expect(titleOf(c)).toBe(WITHHELD_40);
      expect(c.querySelector(".sr-only")?.textContent).toBe(WITHHELD_40);
    }
    expect(cell(card, "Max DD").textContent).toBe("-20.00%");
  });

  it("a 200-day record: the figures print, each with the <1y marker and its reason", async () => {
    seeded.statusRows = [status(A_ID, 200, 200)];
    await renderPage();
    const card = cardFor("Orpheus");

    const cagr = cell(card, "CAGR");
    const sharpe = cell(card, "Sharpe");
    expect(cagr.textContent).toContain("+50.00%");
    expect(cagr.textContent).toContain("<1y");
    expect(sharpe.textContent).toContain("2.10");
    expect(sharpe.textContent).toContain("<1y");
    const reason = "Annualized from 200 days of record, under one year.";
    expect(titleOf(cagr)).toBe(reason);
    expect(titleOf(sharpe)).toBe(reason);
  });

  it("a 400-day record: the card is exactly as before (no title, no marker)", async () => {
    seeded.statusRows = [status(A_ID, 400, 400)];
    await renderPage();
    const card = cardFor("Orpheus");

    expect(cell(card, "CAGR").textContent).toBe("+50.00%");
    expect(cell(card, "Sharpe").textContent).toBe("2.10");
    expect(titleOf(cell(card, "CAGR"))).toBeNull();
    expect(titleOf(cell(card, "Sharpe"))).toBeNull();
    expect(card.textContent).not.toContain("<1y");
  });

  it("a non-rankable run (STALE-01) keeps today's plain dashes whatever the record", async () => {
    seeded.statusRows = [status(A_ID, 40, 40, "failed")];
    await renderPage();
    const card = cardFor("Orpheus");

    for (const label of ["CAGR", "Sharpe"]) {
      const c = cell(card, label);
      expect(c.textContent).toBe("—");
      expect(titleOf(c)).toBeNull();
    }
  });

  it("the reads stay bounded: scalar aliases only on the status read, id + asset_class on a published-only strategies read", async () => {
    await renderPage();

    const analyticsSelect = seeded.calls.find(
      (c) => c.table === "strategy_analytics" && c.op === "select",
    )?.args[0] as string;
    expect(analyticsSelect).toContain("trades_fetched_at");
    expect(analyticsSelect).toContain("series_end:returns_series->-1->>date");
    expect(analyticsSelect).toContain("record_observations:metrics_json->record_observations");
    // Strip the four arrow aliases; no whole blob column may remain.
    const bare = analyticsSelect.replace(/\w+:\w+->[^,]+/g, "");
    for (const blob of ["returns_series", "metrics_json", "data_quality_flags"]) {
      expect(bare, `${blob} projected whole`).not.toContain(blob);
    }

    const strategiesCalls = seeded.calls.filter((c) => c.table === "strategies");
    expect(strategiesCalls).toContainEqual({
      table: "strategies",
      op: "select",
      args: ["id, asset_class"],
    });
    expect(strategiesCalls).toContainEqual({
      table: "strategies",
      op: "in",
      args: ["id", [A_ID]],
    });
    expect(strategiesCalls).toContainEqual({
      table: "strategies",
      op: "eq",
      args: ["status", "published"],
    });
  });
});

describe("194.1 B5 · non-crypto records are judged on the stored observation count", () => {
  it("a traditional record with 59 observations is withheld by the trading-day minimum", async () => {
    seeded.classDefault = "traditional";
    seeded.statusRows = [status(A_ID, 84, 59)];
    await renderPage();
    const card = cardFor("Orpheus");

    for (const label of ["CAGR", "Sharpe"]) {
      const c = cell(card, label);
      expect(c.textContent).toMatch(/^—/);
      expect(titleOf(c)).toBe("Withheld until the record reaches 60 trading days (59 so far).");
    }
  });

  it("a traditional record with 60 observations over 84 days is short, not withheld", async () => {
    seeded.classDefault = "traditional";
    seeded.statusRows = [status(A_ID, 84, 60)];
    await renderPage();
    const card = cardFor("Orpheus");

    for (const label of ["CAGR", "Sharpe"]) {
      const c = cell(card, label);
      expect(c.textContent).toContain("<1y");
      expect(titleOf(c)).toBe("Annualized from 84 days of record, under one year.");
    }
    expect(cell(card, "CAGR").textContent).toContain("+50.00%");
  });
});

describe("194.1 B5 · each card carries its own verdict", () => {
  it("one short-record card and one full-record card sit side by side", async () => {
    seeded.recs = [rec(A_ID, "Orpheus", 1), rec(B_ID, "Meridian", 2)];
    seeded.statusRows = [status(A_ID, 40, 40), status(B_ID, 400, 400)];
    await renderPage();

    expect(titleOf(cell(cardFor("Orpheus"), "Sharpe"))).toBe(WITHHELD_40);
    const full = cell(cardFor("Meridian"), "Sharpe");
    expect(full.textContent).toBe("2.10");
    expect(titleOf(full)).toBeNull();
  });

  it("D-05: a huge stored Sharpe on a full record prints like any finite value", async () => {
    seeded.recs = [rec(A_ID, "Orpheus", 1, 123456.78)];
    await renderPage();

    expect(cell(cardFor("Orpheus"), "Sharpe").textContent).toMatch(/^123[,]?456\.78$/);
  });
});

describe("194.1 B5 · an unreadable or missing asset class fails closed", () => {
  it("a strategies read ERROR nulls every card's CAGR and Sharpe (plain dash, no reason) and logs once", async () => {
    seeded.recs = [rec(A_ID, "Orpheus", 1), rec(B_ID, "Meridian", 2)];
    seeded.statusRows = [status(A_ID, 400, 400), status(B_ID, 40, 40)];
    seeded.classError = { message: "boom" };
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await renderPage();

    for (const name of ["Orpheus", "Meridian"]) {
      const card = cardFor(name);
      for (const label of ["CAGR", "Sharpe"]) {
        const c = cell(card, label);
        expect(c.textContent, `${name} ${label} printed without a known asset class`).toBe("—");
        expect(titleOf(c)).toBeNull();
      }
      expect(cell(card, "Max DD").textContent).toBe("-20.00%");
    }
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(String(errSpy.mock.calls[0][0])).toMatch(/^\[recommendations\]/);
  });

  it("a MISSING row nulls that card only, and one error names the missing id", async () => {
    // A's class row is absent (RLS or the published filter hid it); its record is 400 days with
    // stored CAGR 0.5 and Sharpe 2.1, so a crypto or traditional default would print both.
    seeded.recs = [rec(A_ID, "Orpheus", 1), rec(B_ID, "Meridian", 2)];
    seeded.statusRows = [status(A_ID, 400, 400), status(B_ID, 400, 400)];
    seeded.classRows = [{ id: B_ID, asset_class: "crypto" }];
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await renderPage();

    const missing = cardFor("Orpheus");
    for (const label of ["CAGR", "Sharpe"]) {
      const c = cell(missing, label);
      expect(c.textContent, `${label} printed for a card with no asset class row`).toBe("—");
      expect(titleOf(c)).toBeNull();
    }
    expect(missing.textContent).not.toContain("<1y");
    expect(cell(missing, "Max DD").textContent).toBe("-20.00%");

    const other = cardFor("Meridian");
    expect(cell(other, "CAGR").textContent).toBe("+50.00%");
    expect(cell(other, "Sharpe").textContent).toBe("2.10");

    expect(errSpy).toHaveBeenCalledTimes(1);
    const message = errSpy.mock.calls[0].map(String).join(" ");
    expect(message).toMatch(/^\[recommendations\]/);
    expect(message).toContain(A_ID);
    expect(message).not.toContain(B_ID);
  });
});
