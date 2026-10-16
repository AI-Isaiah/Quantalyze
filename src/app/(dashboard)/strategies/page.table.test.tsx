/**
 * Phase 170.7 / Plan 06 / D-05 — /strategies is the shared ranking table.
 *
 * The founder's request (2026-10-02): the manager's My Strategies page uses the
 * same ranking table as Discovery, and a strategy's name opens its factsheet.
 * These are PAGE-level gates on purpose (RESEARCH Pitfall 2): the shared table
 * already links to the factsheet and already prints a dash for a missing
 * figure, so a component-level test is green before any change. Each case
 * below renders the real server page over a Supabase double and is RED on the
 * card page this phase replaced.
 *
 *   P1 (D-02)  every status's name links to /factsheet/<id>, never to /edit
 *   P2 (D-01)  Status and Created right after Strategy, Actions last, and the
 *              Actions cell holds Edit, then the private-link control, then
 *              the lifecycle actions, in that DOM order
 *   P3 (D-03)  no analytics, or a failed run (even one with stored figures),
 *              reads a dash in rank, Return %, CAGR, Sharpe and Max DD
 *   P4 (D-09)  the first row is the newest strategy, including a newest one
 *              with no analytics
 *   P5         an archived strategy is still listed
 *   P6 (D-06, D-08) review feedback / key lines / share note sit in ONE note
 *              row directly under their strategy; the feedback is amber
 *
 * Cells are located by HEADER INDEX, never by absolute td position, so a
 * later column insertion does not silently shift what a case reads.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { installFetchMock, restoreFetchMock } from "@/test/helpers/fetch";
import { Badge } from "@/components/ui/Badge";
import { formatIsoDay } from "@/lib/utils";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

// Forwards every prop (aria-label included): the table's name and Edit links
// are found by their accessible names.
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...rest
  }: { children: React.ReactNode; href: string } & Record<string, unknown>) =>
    React.createElement("a", { href, ...rest }, children),
}));

vi.mock("@/components/layout/PageHeader", () => ({
  PageHeader: ({ title }: { title: string }) =>
    React.createElement("h1", null, title),
}));

vi.mock("@/components/strategy/StrategyActions", () => ({
  StrategyActions: (props: { strategyId: string }) =>
    React.createElement("span", { "data-testid": `actions-${props.strategyId}` }),
}));
vi.mock("@/components/strategy/PendingIntros", () => ({
  PendingIntros: () => null,
}));
vi.mock("@/components/discovery/SimulateImpactButton", () => ({
  SimulateImpactButton: () => React.createElement("span", { "data-testid": "simulate-probe" }),
}));

// A probe, not a null stub: the Actions-cell order case reads where it sits.
vi.mock("@/components/strategy/ShareableLink", async () => {
  const actual = await vi.importActual<
    typeof import("@/components/strategy/ShareableLink")
  >("@/components/strategy/ShareableLink");
  return {
    ...actual,
    ShareableLink: (props: { strategyId: string; published: boolean }) =>
      React.createElement(
        "span",
        { "data-testid": `share-${props.strategyId}` },
        props.published ? "public" : "private",
      ),
  };
});

// Every computed row is BUILDABLE under this double (the service-role read
// behind `probeFactsheetBuildable` answers the id it was asked for with a
// 30-point series), so a computed row carries no share note. Cloned from
// page.key-pill.test.tsx's admin double; the probe itself is REAL.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      let id = "";
      const b: Record<string, unknown> = {};
      const self = () => b;
      b.select = self;
      b.order = self;
      b.limit = self;
      b.or = self;
      b.abortSignal = self;
      b.eq = (column: string, value: string) => {
        if (column === "id") id = value;
        return b;
      };
      b.maybeSingle = async () =>
        table === "strategies"
          ? {
              data: {
                id,
                name: `Strategy ${id}`,
                codename: null,
                disclosure_tier: null,
                status: "draft",
                markets: [],
                strategy_types: [],
                description: null,
                subtypes: [],
                supported_exchanges: [],
                leverage_range: null,
                aum: null,
                max_capacity: null,
                avg_daily_turnover: null,
                start_date: null,
                benchmark: null,
                asset_class: "crypto",
                returns_denominator_config: null,
                strategy_analytics: {
                  daily_returns: Array.from({ length: 30 }, (_, i) => ({
                    date: new Date(Date.UTC(2024, 0, 2) + i * 86_400_000)
                      .toISOString()
                      .slice(0, 10),
                    value: ((i % 7) - 3) / 1000,
                  })),
                  returns_series: null,
                  computed_at: "2024-03-01T00:00:00Z",
                  data_quality_flags: null,
                  metrics_json_by_basis: null,
                  computation_status: "complete",
                },
              },
              error: null,
            }
          : { data: null, error: null };
      b.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null });
      return b;
    },
  }),
}));

const redirectMock = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    redirectMock(path);
    throw new Error(`__REDIRECT__:${path}`);
  },
}));

type AnalyticsEmbed = Record<string, unknown> | Record<string, unknown>[] | null;

interface MockStrategyRow {
  id: string;
  name: string;
  status: string;
  source: string;
  strategy_types: string[];
  review_note: string | null;
  created_at: string;
  api_key_id: string | null;
  user_id: string;
  category_id: string | null;
  description: string | null;
  subtypes: string[];
  markets: string[];
  supported_exchanges: string[];
  leverage_range: string | null;
  avg_daily_turnover: number | null;
  aum: number | null;
  max_capacity: number | null;
  start_date: string | null;
  is_example: boolean;
  benchmark: string;
  strategy_analytics: AnalyticsEmbed;
}

const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  strategies: [] as unknown[],
  /**
   * Every `.from(table).select(cols)` the page issued, in order, with the
   * `.eq(col, val)` filters chained after it (WR-03: the owner scope is a
   * recorded filter on the LIST read, not a substring somewhere in the page).
   */
  selects: [] as Array<{
    table: string;
    cols: string;
    eqs: Array<[string, unknown]>;
  }>,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: state.user }, error: null }),
    },
    rpc: async () => ({ data: [], error: null }),
    from: (table: string) => {
      if (
        table !== "strategies" &&
        table !== "contact_requests" &&
        table !== "api_keys" &&
        table !== "strategy_keys" &&
        table !== "strategy_shares"
      ) {
        throw new Error(`Unexpected table: ${table}`);
      }
      const listResult =
        table === "strategies"
          ? { data: state.strategies, error: null }
          : { data: [], error: null };
      let current: (typeof state.selects)[number] | null = null;
      const builder = {
        select: (cols: string) => {
          current = { table, cols, eqs: [] };
          state.selects.push(current);
          return builder;
        },
        eq: (col: string, val: unknown) => {
          current?.eqs.push([col, val]);
          return builder;
        },
        or: () => builder,
        in: () => builder,
        limit: () => builder,
        order: () => builder,
        maybeSingle: async () => ({ data: null, error: null }),
        then: (
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onF: (v: { data: unknown; error: unknown }) => any,
        ) => Promise.resolve(listResult).then(onF),
      };
      return builder;
    },
  }),
}));

const COMPLETE = {
  computation_status: "complete",
  cumulative_return: 0.42,
  cagr: 0.18,
  sharpe: 1.5,
  max_drawdown: -0.12,
  volatility: 0.22,
  six_month_return: 0.21,
};

function row(
  id: string,
  status: string,
  overrides: Partial<MockStrategyRow> = {},
): MockStrategyRow {
  return {
    id,
    name: `Strategy ${id}`,
    status,
    source: "legacy",
    strategy_types: ["options"],
    review_note: null,
    created_at: "2026-01-01T00:00:00.000Z",
    api_key_id: null,
    user_id: "u-1",
    category_id: "cat-1",
    description: null,
    subtypes: ["Trend Following"],
    markets: ["Spot"],
    supported_exchanges: ["Binance"],
    leverage_range: null,
    avg_daily_turnover: null,
    aum: 1_000_000,
    max_capacity: 10_000_000,
    start_date: "2024-01-01",
    is_example: false,
    benchmark: "BTC",
    strategy_analytics: COMPLETE,
    ...overrides,
  };
}

/** The status label exactly as the shared Badge prints it (never typed here). */
function badgeLabel(status: string): string {
  const { container, unmount } = render(<Badge type="status" label={status} />);
  const text = (container.textContent ?? "").trim();
  unmount();
  return text;
}

async function renderPage(): Promise<HTMLElement> {
  const { default: StrategiesPage } = await import("./page");
  // 170.1 D-07: the page reads `searchParams` (a Promise in Next 16), so every
  // render passes the empty query a plain /strategies visit carries.
  const jsx = await (
    StrategiesPage as unknown as (props: {
      searchParams: Promise<Record<string, string | string[] | undefined>>;
    }) => Promise<React.ReactElement>
  )({ searchParams: Promise.resolve({}) });
  const { container } = render(jsx);
  return container;
}

/** A header's label without its sort-arrow glyph. */
function labelOf(h: HTMLElement): string {
  // The Rank header's visible "#" glyph is part of its text, not its label.
  return (h.textContent ?? "").replace(/[\u2191\u2193]/g, "").replace(/#$/, "").trim();
}

function headerNames(): string[] {
  return screen.getAllByRole("columnheader").map(labelOf);
}

/** The data row of one strategy (the row holding its name link). */
function dataRow(name: string): HTMLTableRowElement {
  const link = screen.getByRole("link", { name });
  const tr = link.closest("tr");
  if (!tr) throw new Error(`no row for "${name}"`);
  return tr as HTMLTableRowElement;
}

/** The cell under the header called `header`, found by header index. */
function cellUnder(tr: HTMLElement, header: string): HTMLTableCellElement {
  const names = headerNames();
  const idx = names.findIndex((n) => n === header);
  if (idx < 0) throw new Error(`no "${header}" header in [${names.join(" | ")}]`);
  const tds = Array.from(tr.querySelectorAll<HTMLTableCellElement>(":scope > td"));
  return tds[idx];
}

/** Rows that carry a strategy (a factsheet link), in DOM order. */
function strategyRows(container: HTMLElement): HTMLTableRowElement[] {
  return Array.from(container.querySelectorAll<HTMLTableRowElement>("tbody > tr")).filter(
    (tr) => tr.querySelector('a[href^="/factsheet/"], a[href$="/edit"]') !== null &&
      tr.getAttribute("data-testid") !== "strategy-row-note",
  );
}

beforeEach(() => {
  installFetchMock();
  try {
    window.localStorage.clear();
  } catch {
    // jsdom may not implement clear in some configurations; non-fatal.
  }
  redirectMock.mockReset();
  // UUID-shaped: the probe runs under `withPublishedOrOwner(q, user.id)`.
  state.user = { id: "00000000-0000-4000-8000-0000000000a1" };
  state.strategies = [];
  state.selects = [];
});

afterEach(() => {
  restoreFetchMock();
});

// The shared table is heavy under RTL; an explicit timeout, not the 5 s default.
const T = 30_000;

describe("StrategiesPage — the name opens the factsheet (D-02, P1)", () => {
  it(
    "links every status's name to /factsheet/<id>, and no name links to the edit form",
    async () => {
      const ids = ["s-pub", "s-priv", "s-pend", "s-draft", "s-arch"];
      state.strategies = [
        row("s-pub", "published"),
        row("s-priv", "private"),
        row("s-pend", "pending_review"),
        row("s-draft", "draft"),
        row("s-arch", "archived"),
      ];

      const container = await renderPage();

      for (const id of ids) {
        const link = screen.getByRole("link", { name: `Strategy ${id}` });
        expect(link.getAttribute("href"), `${id}'s name must open its factsheet`).toBe(
          `/factsheet/${id}`,
        );
      }
      // Non-vacuity: the edit links exist (so "no name link ends in /edit" is
      // a real statement about a page that has edit links), and they are not
      // named after a strategy.
      const edits = Array.from(container.querySelectorAll<HTMLAnchorElement>('a[href$="/edit"]'));
      expect(edits.length).toBe(ids.length);
      for (const a of edits) {
        expect(a.textContent?.trim()).toBe("Edit");
        expect(a.getAttribute("aria-label")).toMatch(/^Edit Strategy /);
      }
    },
    T,
  );
});

describe("StrategiesPage — Status, Created and Actions (D-01, D-09, P2)", () => {
  it(
    "puts Status then Created right after Strategy and Actions last",
    async () => {
      state.strategies = [row("s-1", "published")];
      await renderPage();

      const names = headerNames();
      const strategyIdx = names.indexOf("Strategy");
      expect(strategyIdx).toBeGreaterThanOrEqual(0);
      expect(names[strategyIdx + 1]).toBe("Status");
      expect(names[strategyIdx + 2]).toBe("Created");
      expect(names[names.length - 1]).toBe("Actions");
      // Discovery's metric columns are still there.
      for (const metric of ["Return %", "CAGR", "Sharpe", "Max DD"]) {
        expect(names, `${metric} column`).toContain(metric);
      }
    },
    T,
  );

  it(
    "fills each row's Status, Created and Actions cells, Edit then private link then lifecycle actions",
    async () => {
      const rows = [
        row("s-pub", "published", { created_at: "2026-03-05T10:00:00.000Z" }),
        row("s-priv", "private", { created_at: "2026-02-04T10:00:00.000Z" }),
        row("s-pend", "pending_review", { created_at: "2026-01-03T10:00:00.000Z" }),
      ];
      state.strategies = rows;
      await renderPage();

      for (const r of rows) {
        const tr = dataRow(r.name);
        expect(cellUnder(tr, "Status").textContent?.trim()).toBe(badgeLabel(r.status));
        expect(cellUnder(tr, "Created").textContent?.trim()).toBe(formatIsoDay(r.created_at));

        const actions = cellUnder(tr, "Actions");
        const edit = within(actions).getByRole("link", { name: `Edit ${r.name}` });
        expect(edit.getAttribute("href")).toBe(`/strategies/${r.id}/edit`);
        const share = actions.querySelector(`[data-testid="share-${r.id}"]`);
        const lifecycle = actions.querySelector(`[data-testid="actions-${r.id}"]`);
        expect(share, `${r.id} private-link control`).not.toBeNull();
        expect(lifecycle, `${r.id} lifecycle actions`).not.toBeNull();
        const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;
        expect(edit.compareDocumentPosition(share!) & FOLLOWING).toBeTruthy();
        expect(share!.compareDocumentPosition(lifecycle!) & FOLLOWING).toBeTruthy();
      }
      // The Created column really tells the three rows apart.
      expect(new Set(rows.map((r) => formatIsoDay(r.created_at))).size).toBe(3);
    },
    T,
  );
});

describe("StrategiesPage — honest dashes (D-03, P3)", () => {
  const DASH_COLUMNS = ["Rank", "Return %", "CAGR", "Sharpe", "Max DD"];

  it(
    "a strategy with no analytics, and a failed run with stored figures, read exactly a dash",
    async () => {
      state.strategies = [
        row("s-ok", "published"),
        row("s-none", "draft", { strategy_analytics: null }),
        row("s-failed", "draft", {
          strategy_analytics: [
            {
              computation_status: "failed",
              cumulative_return: 0.5,
              cagr: 0.2,
              sharpe: 1.5,
              max_drawdown: -0.1,
            },
          ],
        }),
      ];
      await renderPage();

      // Both strategies still appear (never hidden).
      for (const id of ["s-none", "s-failed"]) {
        const tr = dataRow(`Strategy ${id}`);
        for (const col of DASH_COLUMNS) {
          expect(cellUnder(tr, col).textContent, `${id} / ${col}`).toBe("—");
        }
      }
      // Anti-vacuity: the computed row's same cells are NOT dashes, so "reads a
      // dash" is not what every cell of this table does.
      const ok = dataRow("Strategy s-ok");
      for (const col of ["Return %", "CAGR", "Sharpe", "Max DD"]) {
        expect(cellUnder(ok, col).textContent, `s-ok / ${col}`).not.toBe("—");
      }
    },
    T,
  );
});

describe("StrategiesPage — newest first and archived listed (D-09, P4 and P5)", () => {
  it(
    "opens with the newest strategy on top, even one with no analytics",
    async () => {
      // OLDEST first on purpose: the double does not sort, so the order on
      // screen is the table's own `initialSort`, not the database's.
      state.strategies = [
        row("s-old", "published", { created_at: "2026-01-01T00:00:00.000Z" }),
        row("s-mid", "published", { created_at: "2026-02-01T00:00:00.000Z" }),
        row("s-new", "draft", {
          created_at: "2026-03-01T00:00:00.000Z",
          strategy_analytics: null,
        }),
      ];
      const container = await renderPage();

      const order = strategyRows(container).map(
        (tr) => tr.querySelector('a[href^="/factsheet/"]')?.textContent,
      );
      expect(order).toEqual(["Strategy s-new", "Strategy s-mid", "Strategy s-old"]);
    },
    T,
  );

  it(
    "keeps an archived strategy listed, with its status and its actions",
    async () => {
      state.strategies = [row("s-live", "published"), row("s-arch", "archived")];
      await renderPage();

      const tr = dataRow("Strategy s-arch");
      expect(cellUnder(tr, "Status").textContent?.trim()).toBe(badgeLabel("archived"));
      expect(badgeLabel("archived")).toBe("Archived");
      expect(tr.querySelector('[data-testid="actions-s-arch"]')).not.toBeNull();
    },
    T,
  );
});

describe("StrategiesPage — the note row (D-06, D-08, P6)", () => {
  it(
    "puts a draft's review feedback in the note row under it, amber, and nothing under a clean row",
    async () => {
      state.strategies = [
        // Uncomputed (no analytics): it also gets the share note, so the ORDER
        // review feedback -> share note is observable.
        row("s-fb", "draft", {
          review_note: "Add a longer track record",
          strategy_analytics: null,
          created_at: "2026-02-01T00:00:00.000Z",
        }),
        // Computed and buildable, published: no key line, no share note.
        row("s-clean", "published", { created_at: "2026-01-01T00:00:00.000Z" }),
      ];
      await renderPage();

      const fb = dataRow("Strategy s-fb");
      const note = fb.nextElementSibling as HTMLElement | null;
      expect(note?.getAttribute("data-testid")).toBe("strategy-row-note");

      const line = Array.from(note!.querySelectorAll("p")).find((p) =>
        (p.textContent ?? "").includes("Review feedback: Add a longer track record"),
      );
      expect(line, "the review feedback line").toBeDefined();
      const tokens = line!.className.split(/\s+/);
      for (const t of ["text-warning", "bg-warning/5", "text-caption"]) {
        expect(tokens, `feedback line class list`).toContain(t);
      }
      expect(tokens).not.toContain("text-negative");
      expect(tokens).not.toContain("bg-negative/5");

      // D-06 order: review feedback first, then the share note.
      const footer = note!.querySelector('[data-testid="strategy-row-footer"]')!;
      const children = Array.from(footer.children);
      expect(children[0]).toBe(line);
      expect(children.length).toBeGreaterThan(1);
      expect(
        (children[1] as HTMLElement).getAttribute("data-testid"),
        "the share note follows the feedback",
      ).toBe("strategy-row-share-note");

      // A strategy with nothing to say has no note row at all.
      const clean = dataRow("Strategy s-clean");
      expect(clean.nextElementSibling?.getAttribute("data-testid")).not.toBe(
        "strategy-row-note",
      );
    },
    T,
  );

  it(
    "shows review feedback only for a draft",
    async () => {
      state.strategies = [
        row("s-pub-note", "published", { review_note: "stale note on a live strategy" }),
      ];
      const container = await renderPage();
      expect(container.textContent).not.toContain("Review feedback:");
    },
    T,
  );
});

describe("StrategiesPage — pagination is the table's (20 per page)", () => {
  it(
    "renders 20 rows of 21 on the first page",
    async () => {
      state.strategies = Array.from({ length: 21 }, (_, i) =>
        row(`s-${String(i).padStart(2, "0")}`, "published", {
          created_at: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
        }),
      );
      const container = await renderPage();
      expect(strategyRows(container)).toHaveLength(20);
      // The oldest of the 21 is the one pushed to page two.
      expect(screen.queryByRole("link", { name: "Strategy s-00" })).toBeNull();
    },
    T,
  );
});

describe("StrategiesPage — the owner list read (source pins, T-170.7-05 and T-170.7-06)", () => {
  const ROOT = join(__dirname, "..", "..", "..", "..");
  const stripComments = (src: string) =>
    src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((l) => !/^\s*\/\//.test(l))
      .join("\n");
  const page = stripComments(
    readFileSync(join(ROOT, "src/app/(dashboard)/strategies/page.tsx"), "utf8"),
  );

  it("reads the owner's own rows through the explicit ranking allowlist, shaped by the one shaper", () => {
    // WR-03: `.eq("user_id", user.id)` appears TWICE in page.tsx (the list read
    // and the wizard-draft lookup), so a bare substring check stays green when
    // the list read loses it. Anchor the filter to the list select's own chain.
    expect(page).toMatch(
      /\.select\(`\*, strategy_analytics \(\$\{CATEGORY_RANKING_ANALYTICS_COLUMNS\}\)`\)\s*\.eq\("user_id", user\.id\)/,
    );
    expect(page).toContain('.or("source.neq.wizard,status.neq.draft")');
    expect(page).toContain("strategy_analytics (${CATEGORY_RANKING_ANALYTICS_COLUMNS})");
    expect(page).toContain("shapeRowAnalytics(");
    expect(page).toContain('initialSort={{ key: "created_at", dir: "desc" }}');
    // The wildcard embed is the owner-only exemption inside getMyStrategies;
    // this page must not copy it, and must not read through getMyStrategies
    // (it drops archived rows).
    expect(page).not.toContain("strategy_analytics (*)");
    expect(page).not.toContain("getMyStrategies(");
  });

  it("issues the list read with the allowlist, not a wildcard embed, at runtime", async () => {
    state.strategies = [row("s-1", "published")];
    await renderPage();
    const list = state.selects.find(
      (s) => s.table === "strategies" && s.cols.startsWith("*, strategy_analytics"),
    );
    expect(list, "the owner list select").toBeDefined();
    // WR-03 / T-170.7-05: the list read itself carries the owner scope, for the
    // SIGNED-IN user. RLS would otherwise show other managers' published rows
    // here with Edit / Share actions.
    expect(
      list!.eqs,
      "the strategies list read must be filtered to the signed-in user",
    ).toContainEqual(["user_id", state.user!.id]);
    expect(list!.cols).not.toContain("strategy_analytics (*)");
    expect(list!.cols).toContain("computation_status");
    expect(list!.cols).toContain("cumulative_return");
    // Never a whole private blob: every embedded column is a scalar or a named
    // alias into one (`three_month:metrics_json->three_month`), not the blob.
    const embedded = list!.cols
      .slice(list!.cols.indexOf("(") + 1, list!.cols.lastIndexOf(")"))
      .split(",")
      .map((c) => c.trim());
    for (const blob of [
      "*",
      "daily_returns",
      "returns_series",
      "metrics_json",
      "metrics_json_by_basis",
      "data_quality_flags",
    ]) {
      expect(embedded, `the embed must not project the whole ${blob}`).not.toContain(blob);
    }
  }, T);
});
