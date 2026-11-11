/**
 * Phase 170.1.2 D-01 — /admin/intros shows names and words where it showed
 * ids and raw values. A lookup miss reads "Unknown allocator" / "Unnamed
 * strategy"; source and snapshot status read through the shared labels; no id
 * reaches the rendered text or any title/aria-label attribute.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

const ALLOCATOR_ID = "aaaaaaaa-1111-4222-8333-444444444444";
const STRATEGY_ID = "bbbbbbbb-1111-4222-8333-444444444444";
const REPLACEMENT_ID = "cccccccc-1111-4222-8333-444444444444";
const REQUEST_ID = "dddddddd-1111-4222-8333-444444444444";
const IDS = [ALLOCATOR_ID, STRATEGY_ID, REPLACEMENT_ID, REQUEST_ID];

const state = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  profiles: [] as Array<Record<string, unknown>>,
  strategies: [] as Array<Record<string, unknown>>,
}));

// `@/lib/intro/snapshot` is server-only; the page is a Server Component.
vi.mock("server-only", () => ({}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`unexpected redirect to ${to}`);
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: "admin-1" } }, error: null }),
    },
  })),
}));

vi.mock("@/lib/admin", () => ({
  isAdminUser: vi.fn(async () => true),
}));

// Self-returning, awaitable query builder keyed by table.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "in", "order", "limit"]) {
        builder[method] = () => builder;
      }
      builder.then = (resolve: (v: unknown) => unknown) =>
        resolve({
          data:
            table === "contact_requests"
              ? state.rows
              : table === "profiles"
                ? state.profiles
                : state.strategies,
          error: null,
        });
      return builder;
    },
  }),
}));

import AdminIntrosPage from "./page";

function request(over: Record<string, unknown> = {}) {
  return {
    id: REQUEST_ID,
    created_at: "2026-01-01T12:00:00Z",
    status: "pending",
    source: "direct",
    replacement_for: null,
    snapshot_status: "ready",
    allocator_id: ALLOCATOR_ID,
    strategy_id: STRATEGY_ID,
    message: null,
    mandate_context: null,
    portfolio_snapshot: null,
    ...over,
  };
}

beforeEach(() => {
  state.rows = [request()];
  state.profiles = [];
  state.strategies = [];
});

describe("/admin/intros labels and names", () => {
  it("reads a missing allocator and strategy as words, never an id", async () => {
    state.rows = [request({ source: "bridge", replacement_for: REPLACEMENT_ID })];
    const { container } = render(await AdminIntrosPage());
    const text = container.textContent ?? "";

    expect(text).toContain("Unknown allocator");
    expect(text).toContain("Unnamed strategy");
    for (const id of IDS) {
      expect(text).not.toContain(id);
      expect(text).not.toContain(id.slice(0, 8));
    }
    for (const el of container.querySelectorAll("[title], [aria-label]")) {
      const attrs = `${el.getAttribute("title")} ${el.getAttribute("aria-label")}`;
      for (const id of IDS) {
        expect(attrs).not.toContain(id);
        expect(attrs).not.toContain(id.slice(0, 8));
      }
    }
  });

  it("names the allocator and strategies when they resolve", async () => {
    state.rows = [request({ source: "bridge", replacement_for: REPLACEMENT_ID })];
    state.profiles = [
      { id: ALLOCATOR_ID, display_name: "Jane Doe", email: "jane@example.com", company: null },
    ];
    state.strategies = [
      { id: STRATEGY_ID, name: "Alpha Fund" },
      { id: REPLACEMENT_ID, name: "Beta Fund" },
    ];
    const { container } = render(await AdminIntrosPage());
    const text = container.textContent ?? "";
    expect(text).toContain("Jane Doe");
    expect(text).toContain("Alpha Fund");
    expect(text).toContain("Beta Fund");
    expect(text).not.toContain("Unknown allocator");
    expect(text).not.toContain("Unnamed strategy");
  });

  // Phase 201 / F-04, U-26: a row from the `bridge` source reads "Replacement"
  // and the header explains it in plain words. The stored value `bridge` and
  // the retired word never reach the rendered page.
  it("labels the source and the snapshot status", async () => {
    state.rows = [request({ source: "bridge", snapshot_status: "ready" })];
    const { container } = render(await AdminIntrosPage());
    const text = container.textContent ?? "";
    expect(text).toContain("Replacement");
    expect(text).toContain(
      "Allocator → manager introductions. Rows from a replacement suggestion include replacement context.",
    );
    expect(text).not.toMatch(/\bBridge\b/);
    expect(text).toContain("Ready");
    expect(text).not.toContain("bridge");
    expect(text).not.toContain("ready");
  });

  // Phase 201 / R2-02 (D-21): a time stamp is the day format, then the time.
  it("prints the request time as a day then a UTC time, not a raw ISO slice", async () => {
    const { container } = render(await AdminIntrosPage());
    const text = container.textContent ?? "";
    expect(text).toContain("Jan 1, 2026, 12:00 UTC");
    expect(text).not.toContain("2026-01-01 12:00");
  });

  it("reads a source outside the set as Other source", async () => {
    state.rows = [request({ source: "zzz" })];
    const { container } = render(await AdminIntrosPage());
    expect(container.textContent).toContain("Other source");
    expect(container.textContent).not.toContain("zzz");
  });
});

/**
 * Phase 194.1 B12c (194 D-12 / D-15) - a frozen Sharpe is judged on the record frozen beside
 * it. Titles are typed by hand so a reworded sentence in `figure-gate.ts` fails here instead of
 * agreeing with itself; dates are not needed because the snapshot freezes `span_days` itself.
 *
 * Neuter to redden: render the mini-table Sharpe as the bare `formatNumber(r.sharpe)` in
 * `page.tsx`, without `annualizedCell` (the 40-day row then prints its number).
 */
describe("/admin/intros withholds a frozen Sharpe by the record frozen beside it (194.1 B12c)", () => {
  const crypto = (span_days: number) => ({ span_days, observations: null, crypto: true });

  function snapshot(over: Record<string, unknown>) {
    return {
      sharpe: 1.23,
      max_drawdown: -0.1,
      concentration: 0.5,
      top_3_strategies: [],
      bottom_3_strategies: [],
      alerts_last_7d: 0,
      ...over,
    };
  }

  /** The `<td>` of the mini-table row naming `name`. */
  function sharpeTd(container: HTMLElement, name: string): HTMLElement {
    const nameTd = Array.from(container.querySelectorAll("td")).find((td) => td.textContent === name);
    if (!nameTd) throw new Error(`no mini-table row for ${name}`);
    return nameTd.nextElementSibling as HTMLElement;
  }

  const row = (id: string, name: string, sharpe: number, sharpe_record?: unknown) => ({
    strategy_id: id,
    strategy_name: name,
    sharpe,
    ...(sharpe_record === undefined ? {} : { sharpe_record }),
  });

  it("a 40-day crypto row prints a dash with the withheld title and not its number", async () => {
    state.rows = [
      request({
        portfolio_snapshot: snapshot({ top_3_strategies: [row("s1", "Short Fund", 7.77, crypto(40))] }),
      }),
    ];
    const { container } = render(await AdminIntrosPage());
    const td = sharpeTd(container, "Short Fund");

    expect(td.textContent).not.toContain("7.77");
    expect(td.textContent).toContain("—");
    expect(td.querySelector("[title]")?.getAttribute("title")).toBe(
      "Withheld until the record reaches 90 days (40 days so far).",
    );
    expect(td.querySelector(".sr-only")?.textContent).toBe(
      "Withheld until the record reaches 90 days (40 days so far).",
    );
  });

  it("a 200-day record prints the Sharpe plus the <1y marker", async () => {
    state.rows = [
      request({
        portfolio_snapshot: snapshot({ top_3_strategies: [row("s1", "Mid Fund", 2.5, crypto(200))] }),
      }),
    ];
    const { container } = render(await AdminIntrosPage());
    const td = sharpeTd(container, "Mid Fund");

    expect(td.textContent).toContain("2.50");
    expect(td.textContent).toContain("<1y");
    expect(td.querySelector("[title]")?.getAttribute("title")).toBe(
      "Annualized from 200 days of record, under one year.",
    );
  });

  it("a record of a year or more prints the Sharpe with no marker and no title", async () => {
    state.rows = [
      request({
        portfolio_snapshot: snapshot({ top_3_strategies: [row("s1", "Long Fund", 2.5, crypto(400))] }),
      }),
    ];
    const { container } = render(await AdminIntrosPage());
    const td = sharpeTd(container, "Long Fund");

    expect(td.textContent).toBe("2.50");
    expect(td.querySelector("[title]")).toBeNull();
  });

  it("a legacy row without the record prints the stored Sharpe with no title", async () => {
    state.rows = [
      request({ portfolio_snapshot: snapshot({ bottom_3_strategies: [row("s1", "Old Fund", 0.4)] }) }),
    ];
    const { container } = render(await AdminIntrosPage());
    const td = sharpeTd(container, "Old Fund");

    expect(td.textContent).toBe("0.40");
    expect(td.querySelector("[title]")).toBeNull();
  });

  it("the book Sharpe follows its own record: withheld, then qualified, then as stored", async () => {
    state.rows = [request({ portfolio_snapshot: snapshot({ sharpe: 9.99, sharpe_record: crypto(40) }) })];
    let { container, unmount } = render(await AdminIntrosPage());
    let line = Array.from(container.querySelectorAll("div")).find((d) => d.textContent?.startsWith("Sharpe"));
    expect(line?.textContent).not.toContain("9.99");
    expect(line?.querySelector("[title]")?.getAttribute("title")).toBe(
      "Withheld until the record reaches 90 days (40 days so far).",
    );
    unmount();

    state.rows = [request({ portfolio_snapshot: snapshot({ sharpe: 1.23, sharpe_record: crypto(200) }) })];
    ({ container, unmount } = render(await AdminIntrosPage()));
    line = Array.from(container.querySelectorAll("div")).find((d) => d.textContent?.startsWith("Sharpe"));
    expect(line?.textContent).toContain("1.23");
    expect(line?.textContent).toContain("<1y");
    unmount();

    state.rows = [request({ portfolio_snapshot: snapshot({ sharpe: 1.23 }) })];
    ({ container } = render(await AdminIntrosPage()));
    line = Array.from(container.querySelectorAll("div")).find((d) => d.textContent?.startsWith("Sharpe"));
    expect(line?.textContent).toBe("Sharpe 1.23");
    expect(line?.querySelector("[title]")).toBeNull();
  });

  it("an unreadable record withholds with the dates-could-not-be-read title", async () => {
    state.rows = [
      request({
        portfolio_snapshot: snapshot({
          top_3_strategies: [
            row("s1", "Odd Fund", 3.3, { span_days: null, observations: null, crypto: true, unreadable: true }),
          ],
        }),
      }),
    ];
    const { container } = render(await AdminIntrosPage());
    const td = sharpeTd(container, "Odd Fund");
    expect(td.textContent).not.toContain("3.30");
    expect(td.querySelector("[title]")?.getAttribute("title")).toBe(
      "Withheld: the record's dates could not be read.",
    );
  });

  it("never re-ranks: a withheld row keeps its place in the list", async () => {
    state.rows = [
      request({
        portfolio_snapshot: snapshot({
          top_3_strategies: [row("s1", "First", 5, crypto(40)), row("s2", "Second", 4, crypto(400))],
        }),
      }),
    ];
    const { container } = render(await AdminIntrosPage());
    const names = Array.from(container.querySelectorAll("td"))
      .map((td) => td.textContent)
      .filter((t) => t === "First" || t === "Second");
    expect(names).toEqual(["First", "Second"]);
  });
});
