/**
 * Phase 199 plan 09 (D-01, D-02, LEAN-01) - /strategies is one page for every
 * strategy owner, and each role sees its own furniture.
 *
 * D-01: allocators, managers and `both` all open /strategies, so the index no
 * longer guards on `manager`. The page reads `profiles.role` itself and builds
 * the role's furniture on the SERVER (the manager's Edit link, share control,
 * StrategyActions and PendingIntros; the allocator's ownership tag and
 * Simulate Impact). A role read that fails throws; it never defaults a role,
 * because a guessed role is a guessed set of controls (T-199-15).
 *
 * These are PAGE-level cases on purpose: the shared table already renders each
 * piece of furniture when it is handed one, so a component-level test is green
 * before the page changes. Every case renders the real server page over a
 * Supabase double and is RED on the manager-only page this plan replaces.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";
import { installFetchMock, restoreFetchMock } from "@/test/helpers/fetch";
import { OWN_CAPITAL } from "@/lib/capital-ownership";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...rest
  }: { children: React.ReactNode; href: string } & Record<string, unknown>) =>
    React.createElement("a", { href, ...rest }, children),
}));

// Unlike the other page suites this one renders `actions`, because "no New
// Strategy for an allocator" lives in the header's actions slot.
vi.mock("@/components/layout/PageHeader", () => ({
  PageHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) =>
    React.createElement("header", null, React.createElement("h1", null, title), actions),
}));

// Probes, not null stubs: each case reads whether the probe rendered.
vi.mock("@/components/strategy/StrategyActions", () => ({
  StrategyActions: (props: { strategyId: string }) =>
    React.createElement("span", { "data-testid": `actions-${props.strategyId}` }),
}));
vi.mock("@/components/strategy/PendingIntros", () => ({
  PendingIntros: () => React.createElement("div", { "data-testid": "pending-intros" }),
}));
vi.mock("@/components/discovery/SimulateImpactButton", () => ({
  SimulateImpactButton: (props: { candidateStrategyId: string }) =>
    React.createElement("span", { "data-testid": `simulate-${props.candidateStrategyId}` }),
}));
vi.mock("@/components/strategy/ShareableLink", async () => {
  const actual = await vi.importActual<
    typeof import("@/components/strategy/ShareableLink")
  >("@/components/strategy/ShareableLink");
  return {
    ...actual,
    ShareableLink: (props: { strategyId: string }) =>
      React.createElement("span", { "data-testid": `share-${props.strategyId}` }),
  };
});
// The wizard overlay portals to document.body and is not under test here.
vi.mock("@/app/(dashboard)/allocations/components/ContributionWizardOverlay", () => ({
  ContributionWizardOverlay: () => null,
}));

// Phase 199 plan 10: the four shared reads the merged page adds. Spies, not
// stubs, so a case can read WHICH rows the ranking was asked about (CD-12) and
// whether an allocator-only read ran at all (a manager's page makes none).
// Everything else in the module stays real.
const queries = vi.hoisted(() => ({
  getOwnRowPercentiles: vi.fn(),
  readPublicVerificationSignals: vi.fn(),
  getStrategylessActiveKeys: vi.fn(),
  getRealPortfolio: vi.fn(),
}));
vi.mock("@/lib/queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/queries")>()),
  ...queries,
}));

// Every computed row is buildable under this double, so no row carries a share
// note. Cloned (trimmed) from page.table.test.tsx's admin double.
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
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
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

function row(id: string, status: string) {
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
    capital_ownership: OWN_CAPITAL,
    strategy_analytics: COMPLETE,
  };
}

const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  /** The profiles row the page reads its role from. */
  profile: { data: null, error: null } as {
    data: { role: string } | null;
    error: { code: string; message: string } | null;
  },
  strategies: [] as unknown[],
  /** What the introductions read answers (a manager's pending requests). */
  intros: [{ id: "i-1" }] as unknown[],
  /** Every table the page asked the request client for, in order. */
  tables: [] as string[],
  /** Every `.eq(col, val)` chained on a `strategies` read. */
  strategyEqs: [] as Array<[string, unknown]>,
  /** "map": every row the ranking is asked about gets a Pnn; "null": no comparison set. */
  ranking: "map" as "map" | "null",
  /** The published population size the ranking reports. */
  populationSize: 7,
  /** trust_tier per strategy id, as readPublicVerificationSignals answers it. */
  signals: new Map<string, { trust_tier: string | null; status: string | null }>(),
  /** getStrategylessActiveKeys: the bare-key rows, or null for a failed read. */
  bareKeys: [] as Array<{ id: string; exchange: string; label: string }> | null,
  /** getRealPortfolio: the viewer's real portfolio, or null when there is none. */
  portfolio: null as { id: string } | null,
  /** A wizard draft the companion read finds, or null. */
  wizardDraft: null as { id: string; name: string; created_at: string; review_note: string | null } | null,
  /** The strategies list read fails whole. */
  listError: false,
  /** The api_keys status read fails. */
  keysError: false,
  /** The api_keys rows the status read answers (the double ignores the `in` filter). */
  keys: [] as unknown[],
  /** Every `.or(filter)` chained on a `strategies` read. */
  strategyOrs: [] as string[],
  /** 199-16: the compute-jobs rows `get_user_compute_jobs` answers, by strategy id. */
  jobs: {} as Record<string, unknown[]>,
  /** 199-16: every strategy id the compute-jobs RPC was asked about, in order. */
  rpcCalls: [] as string[],
  /** 199-16: the compute-jobs RPC fails. */
  rpcError: false,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: state.user }, error: null }),
    },
    rpc: async (_fn: string, args?: { p_strategy_id?: string }) => {
      const id = args?.p_strategy_id ?? "";
      state.rpcCalls.push(id);
      if (state.rpcError) return { data: null, error: { code: "XX000", message: "rpc failed" } };
      return { data: state.jobs[id] ?? [], error: null };
    },
    from: (table: string) => {
      state.tables.push(table);
      if (table === "profiles") {
        const p = {
          select: () => p,
          eq: () => p,
          maybeSingle: async () => state.profile,
        };
        return p;
      }
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
          ? state.listError
            ? { data: null, error: { message: "list read failed" } }
            : { data: state.strategies, error: null }
          : table === "contact_requests"
            ? { data: state.intros, error: null }
            : table === "api_keys" && state.keysError
              ? { data: null, error: { message: "keys read failed" } }
              : { data: table === "api_keys" ? state.keys : [], error: null };
      const builder = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          if (table === "strategies") state.strategyEqs.push([col, val]);
          return builder;
        },
        or: (filter: string) => {
          if (table === "strategies") state.strategyOrs.push(filter);
          return builder;
        },
        in: () => builder,
        limit: () => builder,
        order: () => builder,
        maybeSingle: async () => ({
          data: table === "strategies" ? state.wizardDraft : null,
          error: null,
        }),
        then: (
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onF: (v: { data: unknown; error: unknown }) => any,
        ) => Promise.resolve(listResult).then(onF),
      };
      return builder;
    },
  }),
}));

async function renderToElement(
  searchParams: Record<string, string | string[] | undefined> = {},
): Promise<React.ReactElement> {
  const { default: StrategiesPage } = await import("./page");
  return await (
    StrategiesPage as unknown as (props: {
      searchParams: Promise<Record<string, string | string[] | undefined>>;
    }) => Promise<React.ReactElement>
  )({ searchParams: Promise.resolve(searchParams) });
}

async function renderPage(): Promise<HTMLElement> {
  const { container } = render(await renderToElement());
  return container;
}

/**
 * The list's own table. Phase 199 plan 14 mounts the legend under it, and the
 * legend repeats every chip label ("Own capital", "Draft", ...), so a furniture
 * case that counts a label asks the TABLE, not the whole page.
 */
function tableEl(): HTMLElement {
  return document.querySelector("table") as HTMLElement;
}

function asRole(role: string) {
  state.profile = { data: { role }, error: null };
}

beforeEach(() => {
  redirectMock.mockClear();
  state.user = { id: "u-1" };
  asRole("manager");
  state.strategies = [row("s-pub", "published"), row("s-priv", "private")];
  state.tables = [];
  state.strategyEqs = [];
  state.ranking = "map";
  state.populationSize = 7;
  state.signals = new Map();
  state.bareKeys = [];
  state.portfolio = null;
  state.wizardDraft = null;
  state.listError = false;
  state.keysError = false;
  state.keys = [];
  state.strategyOrs = [];
  state.jobs = {};
  state.rpcCalls = [];
  state.rpcError = false;
  for (const spy of Object.values(queries)) spy.mockReset();
  queries.getOwnRowPercentiles.mockImplementation(
    async (rows: readonly { id: string }[]) =>
      state.ranking === "null"
        ? null
        : {
            ownMap: Object.fromEntries(
              rows.map((r) => [r.id, { sharpe: 50, cagr: 50 }]),
            ),
            publishedMap: {},
            populationSize: state.populationSize,
          },
  );
  queries.readPublicVerificationSignals.mockImplementation(async () => state.signals);
  queries.getStrategylessActiveKeys.mockImplementation(async () =>
    state.bareKeys === null ? null : state.bareKeys,
  );
  queries.getRealPortfolio.mockImplementation(async () => state.portfolio);
  installFetchMock();
});

afterEach(() => {
  restoreFetchMock();
});

/**
 * D-12 / LEAN-04: every control on the page that starts a new strategy, by its
 * rendered name. The manager's header is the ONLY one, so this must be 1.
 */
function addStrategyControls(): HTMLElement[] {
  // The page house style is a Link wrapping a Button: that is ONE control, so a
  // button inside an anchor is not counted a second time.
  return [
    ...screen.queryAllByRole("link", { name: "Add a strategy" }),
    ...screen
      .queryAllByRole("button", { name: "Add a strategy" })
      .filter((el) => el.closest("a") === null),
  ];
}

describe("/strategies furniture by role (199-09, D-02)", () => {
  it("an allocator opens the page: own rows, ownership tag and Simulate, none of the manager furniture", async () => {
    asRole("allocator");
    await renderPage();

    // The rows are the viewer's own (the owner scope survives the widening).
    expect(screen.getByRole("link", { name: "Strategy s-pub" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Strategy s-priv" })).toBeTruthy();
    expect(state.strategyEqs).toContainEqual(["user_id", "u-1"]);

    // Allocator furniture: the mark tag per row, Simulate on the PUBLISHED row only.
    expect(within(tableEl()).getAllByText("Own capital").length).toBe(2);
    expect(screen.getByTestId("simulate-s-pub")).toBeTruthy();
    expect(screen.queryByTestId("simulate-s-priv")).toBeNull();

    // Every role sees Status and Created.
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent ?? "");
    expect(headers.some((h) => h.includes("Status"))).toBe(true);
    expect(headers.some((h) => h.includes("Created"))).toBe(true);

    // None of the manager furniture.
    expect(screen.queryByRole("link", { name: /^Edit / })).toBeNull();
    expect(screen.queryByTestId("share-s-pub")).toBeNull();
    expect(screen.queryByTestId("share-s-priv")).toBeNull();
    expect(screen.queryByTestId("actions-s-pub")).toBeNull();
    expect(addStrategyControls()).toHaveLength(0);
    expect(screen.queryByTestId("pending-intros")).toBeNull();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("an allocator's page makes no introductions read at all (the read is manager-only)", async () => {
    asRole("allocator");
    await renderPage();
    expect(state.tables).not.toContain("contact_requests");
  });

  it("a manager gets one Add a strategy link to the wizard, Edit, the share control, the row actions and PendingIntros, and no allocator furniture", async () => {
    asRole("manager");
    await renderPage();

    const controls = addStrategyControls();
    expect(controls).toHaveLength(1);
    expect(controls[0].getAttribute("href")).toBe("/strategies/new/wizard");
    expect(screen.getByRole("link", { name: "Edit Strategy s-pub" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Edit Strategy s-priv" })).toBeTruthy();
    expect(screen.getByTestId("share-s-pub")).toBeTruthy();
    expect(screen.getByTestId("actions-s-pub")).toBeTruthy();
    expect(screen.getByTestId("pending-intros")).toBeTruthy();
    expect(state.tables).toContain("contact_requests");

    // No allocator furniture on a manager-only page.
    expect(within(tableEl()).queryByText("Own capital")).toBeNull();
    expect(screen.queryByTestId("simulate-s-pub")).toBeNull();
  });

  it("role both: the union of the furniture on one row each", async () => {
    asRole("both");
    await renderPage();

    expect(addStrategyControls()).toHaveLength(1);
    expect(screen.getAllByRole("link", { name: "Strategy s-pub" }).length).toBe(1);
    expect(screen.getByRole("link", { name: "Edit Strategy s-pub" })).toBeTruthy();
    expect(screen.getByTestId("share-s-pub")).toBeTruthy();
    expect(screen.getByTestId("actions-s-pub")).toBeTruthy();
    expect(within(tableEl()).getAllByText("Own capital").length).toBe(2);
    expect(screen.getByTestId("simulate-s-pub")).toBeTruthy();
    expect(screen.getByTestId("pending-intros")).toBeTruthy();

    // One row per strategy: the name link exists once, in one table row.
    const tr = screen.getByRole("link", { name: "Strategy s-pub" }).closest("tr");
    expect(tr).not.toBeNull();
    expect(within(tr as HTMLElement).getByTestId("share-s-pub")).toBeTruthy();
    expect(within(tr as HTMLElement).getByTestId("simulate-s-pub")).toBeTruthy();
  });
});

describe("/strategies role read discipline (199-09, T-199-15)", () => {
  it("a profiles read error throws and never defaults a role", async () => {
    state.profile = { data: null, error: { code: "XX000", message: "db down" } };
    await expect(renderPage()).rejects.toMatchObject({ code: "XX000" });
    expect(redirectMock).not.toHaveBeenCalled();
    // Nothing was read for a viewer whose role is unknown.
    expect(state.tables).not.toContain("strategies");
  });

  it("a missing profile row throws and never defaults a role", async () => {
    state.profile = { data: null, error: null };
    await expect(renderPage()).rejects.toThrow();
    expect(redirectMock).not.toHaveBeenCalled();
    expect(state.tables).not.toContain("strategies");
  });

  it("an unknown role is denied: sent to /pending-approval, no list read", async () => {
    asRole("viewer");
    await expect(renderPage()).rejects.toThrow("__REDIRECT__:/pending-approval");
    expect(state.tables).not.toContain("strategies");
  });
});

describe("/strategies mounts one host for every role (199-09, Task 2)", () => {
  it("allocator and both get Change mark; no role gets Rename… on the list (D-09: the edit page is the one rename place); a manager gets no mark control", async () => {
    for (const role of ["allocator", "both"] as const) {
      asRole(role);
      const { unmount } = render(
        (await renderToElement()) as React.ReactElement,
      );
      // Two rows carry a mark, so two "Change mark" controls. Rename… is gone
      // from the list for every role (Phase 200 D-09).
      expect(
        screen.getAllByRole("button", { name: "Change mark…" }).length,
        `${role}: a Change mark control per row`,
      ).toBe(2);
      expect(
        screen.queryByRole("button", { name: "Rename…" }),
        `${role}: no Rename on the list`,
      ).toBeNull();
      unmount();
    }

    asRole("manager");
    await renderPage();
    expect(screen.queryByRole("button", { name: /mark/i })).toBeNull();
    expect(screen.queryByRole("button", { name: "Rename…" })).toBeNull();
  });

  it("R-04: every role's row links read /factsheet/{id}?from=strategies", async () => {
    for (const role of ["allocator", "manager", "both"] as const) {
      asRole(role);
      const { unmount } = render(
        (await renderToElement()) as React.ReactElement,
      );
      for (const id of ["s-pub", "s-priv"]) {
        const href = screen
          .getByRole("link", { name: `Strategy ${id}` })
          .getAttribute("href");
        expect(href, `${role} ${id}`).toBe(`/factsheet/${id}?from=strategies`);
      }
      unmount();
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 199 plan 10 (D-02, CD-12, LEAN-01) - everything from /my-strategies,
// by role. The copy literals are the Phase 149 contract, pinned HERE as
// constants (independent of the copy module the page imports from) so a stray
// re-word in the one shared module reddens this file.
// ---------------------------------------------------------------------------
const mapCopy = (n: number) =>
  `Ranked against ${n} published strategies. # is the row's position in this list; Pnn compares the row against those ${n} published strategies. Private and draft rows are visible only to you and do not affect public rankings.`;
const NULL_COPY =
  "Percentile ranks appear once 5 strategies are published in the comparison set. Private and draft rows are visible only to you.";
const kSentence = (k: number) => `${k} of your keys have no strategy yet.`;

/** Sort the table by Sharpe, the column the fixture's Pnn rides on. */
function sortBySharpe() {
  const th = screen
    .getAllByRole("columnheader")
    .find((h) => /sharpe/i.test(h.getAttribute("aria-label") ?? ""));
  expect(th, "a Sharpe column header").toBeTruthy();
  fireEvent.click(within(th as HTMLElement).getByRole("button"));
}

describe("the Phase 149 ranking on the merged list (199-10 task 1, D-02)", () => {
  it("every role: the note reads the Phase 149 copy with the real population size", async () => {
    for (const role of ["allocator", "manager", "both"] as const) {
      asRole(role);
      state.ranking = "map";
      state.populationSize = 7;
      const { unmount } = render(await renderToElement());
      expect(
        screen.getByTestId("comparison-set-note").textContent,
        `${role}: note`,
      ).toBe(mapCopy(7));
      unmount();
    }
  });

  it("every role: a population under the threshold switches the note to the threshold copy", async () => {
    for (const role of ["allocator", "manager", "both"] as const) {
      asRole(role);
      state.ranking = "null";
      const { unmount } = render(await renderToElement());
      const note = screen.getByTestId("comparison-set-note").textContent;
      expect(note, `${role}: note`).toBe(NULL_COPY);
      expect(note).not.toContain("Ranked against");
      unmount();
    }
  });

  it("every role: # and Pnn render on the owner's rows", async () => {
    for (const role of ["allocator", "manager", "both"] as const) {
      asRole(role);
      const { unmount } = render(await renderToElement());
      sortBySharpe();
      expect(screen.getAllByText("P50").length, `${role}: a Pnn per ranked row`).toBe(2);
      unmount();
    }
  });

  it("CD-12: an archived row stays on the list, has no Pnn, and is not in the ranked population", async () => {
    state.strategies = [
      row("s-pub", "published"),
      row("s-priv", "private"),
      row("s-arch", "archived"),
    ];
    await renderPage();

    // Still listed.
    expect(screen.getByRole("link", { name: "Strategy s-arch" })).toBeTruthy();
    // Never handed to the ranking as a subject.
    expect(queries.getOwnRowPercentiles).toHaveBeenCalledTimes(1);
    const asked = (
      queries.getOwnRowPercentiles.mock.calls[0][0] as { id: string }[]
    ).map((r) => r.id);
    expect(asked.sort()).toEqual(["s-priv", "s-pub"]);
    // So it carries no Pnn: two ranked rows, three listed.
    sortBySharpe();
    expect(screen.getAllByText("P50").length).toBe(2);
  });

  it("no ranking read is made when no row is eligible (nothing to score)", async () => {
    state.strategies = [row("s-arch", "archived")];
    await renderPage();
    expect(queries.getOwnRowPercentiles).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Strategy s-arch" })).toBeTruthy();
  });

  it("a published composite keeps its verified check (trust_tier attached through the public signal reader)", async () => {
    state.strategies = [row("s-comp", "published"), row("s-plain", "published")];
    state.signals = new Map([
      ["s-comp", { trust_tier: "api_verified", status: "published" }],
    ]);
    await renderPage();

    // Neither row has an api_key_id, so the check can only come from trust_tier.
    expect(queries.readPublicVerificationSignals).toHaveBeenCalledTimes(1);
    const compRow = screen.getByRole("link", { name: "Strategy s-comp" }).closest("tr");
    const plainRow = screen.getByRole("link", { name: "Strategy s-plain" }).closest("tr");
    expect(within(compRow as HTMLElement).getAllByTitle("Verified via exchange API").length).toBe(1);
    expect(within(plainRow as HTMLElement).queryByTitle("Verified via exchange API")).toBeNull();
  });

  it("the copy lives in one module the page imports (no second copy to drift)", async () => {
    const copy = await import("./comparison-note");
    expect(copy.mapCopy(7)).toBe(mapCopy(7));
    expect(copy.NULL_COPY).toBe(NULL_COPY);
    expect(copy.kSentence(2)).toBe(kSentence(2));
  });
});

// ---------------------------------------------------------------------------
// Phase 199 plan 10 task 2 (D-02, CD-10, T-199-25) - the allocator rows, the
// wizard-draft rule and the empty states, by role. Each case below is a thing
// /my-strategies showed (or /strategies showed a manager) that must survive the
// merge. The `my-strategies/page.test.tsx` behaviours ported here are listed in
// 199-10-SUMMARY.md.
// ---------------------------------------------------------------------------
const PLACEHOLDER_KEYS_UNREADABLE =
  "We could not load your exchange keys, so keys without a strategy may be missing here. Reload this page to try again.";
const LIST_UNREADABLE = "We could not load your strategies. Reload this page to try again.";
const KEY_STATUS_NOTE =
  "We could not check key status right now. Open a strategy to see its keys.";
const TWO_KEYS = [
  { id: "k-1", exchange: "bybit", label: "Bybit Main" },
  { id: "k-2", exchange: "deribit", label: "Deribit Options" },
];

describe("allocator reads and the K sentence, by role (199-10 task 2, D-02)", () => {
  it("allocator and both: a placeholder row per key with no strategy, Finish setup, and the K sentence appended to the note", async () => {
    for (const role of ["allocator", "both"] as const) {
      asRole(role);
      state.bareKeys = TWO_KEYS;
      state.portfolio = { id: "pf-1" };
      const { unmount } = render(await renderToElement());

      expect(screen.getByText(/Bybit · Bybit Main/), `${role}: bybit row`).toBeTruthy();
      expect(screen.getByText(/Deribit · Deribit Options/), `${role}: deribit row`).toBeTruthy();
      expect(screen.getAllByText("Finish setup →").length, `${role}: Finish setup`).toBe(2);
      expect(screen.getByTestId("comparison-set-note").textContent).toBe(
        `${mapCopy(7)} ${kSentence(2)}`,
      );
      // Owner-scoped: the session user's id, nothing else it could have used.
      expect(queries.getStrategylessActiveKeys).toHaveBeenLastCalledWith("u-1");
      expect(queries.getRealPortfolio).toHaveBeenLastCalledWith("u-1");
      unmount();
    }
  });

  it("a manager's page makes neither allocator read and shows no placeholder or K sentence", async () => {
    asRole("manager");
    state.bareKeys = TWO_KEYS;
    await renderPage();

    expect(queries.getStrategylessActiveKeys).not.toHaveBeenCalled();
    expect(queries.getRealPortfolio).not.toHaveBeenCalled();
    expect(screen.queryByText("Finish setup →")).toBeNull();
    expect(screen.getByTestId("comparison-set-note").textContent).toBe(mapCopy(7));
  });

  it("the K sentence is omitted when every key has a strategy", async () => {
    asRole("allocator");
    state.bareKeys = [];
    await renderPage();
    const note = screen.getByTestId("comparison-set-note").textContent;
    expect(note).not.toContain("of your keys have no strategy yet");
    expect(note).toBe(mapCopy(7));
  });

  it("zero strategies but bare keys: the table section, noted with ONLY the K sentence, and no ranking read", async () => {
    asRole("allocator");
    state.strategies = [];
    state.bareKeys = TWO_KEYS;
    await renderPage();

    expect(screen.queryByText("No strategies yet.")).toBeNull();
    expect(screen.getByTestId("comparison-set-note").textContent).toBe(kSentence(2));
    expect(screen.getByText(/Bybit · Bybit Main/)).toBeTruthy();
    // Nothing to score, so no published-universe fetch is worth making.
    expect(queries.getOwnRowPercentiles).not.toHaveBeenCalled();
  });

  it("T-199-25: a failed placeholder-key read prints its line, keeps the rows that loaded, and never reads as empty or as zero keys", async () => {
    asRole("allocator");
    state.bareKeys = null;
    await renderPage();

    const line = screen.getByText(PLACEHOLDER_KEYS_UNREADABLE);
    expect(line).toBeTruthy();
    // The rows that DID load render in full, under the line (declared, not silent).
    expect(screen.getByRole("link", { name: "Strategy s-pub" })).toBeTruthy();
    expect(screen.getByTestId("comparison-set-note").textContent).toBe(mapCopy(7));
    // The line sits above the note (UI-SPEC read-failure order).
    expect(
      line.compareDocumentPosition(screen.getByTestId("comparison-set-note")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("T-199-25: a failed placeholder-key read on an otherwise empty account is NOT the empty state", async () => {
    asRole("allocator");
    state.strategies = [];
    state.bareKeys = null;
    await renderPage();

    expect(screen.getByText(PLACEHOLDER_KEYS_UNREADABLE)).toBeTruthy();
    expect(screen.queryByText("No strategies yet.")).toBeNull();
    expect(screen.queryByRole("button", { name: "Add a strategy" })).toBeNull();
  });

  it("no placeholder-key line when the read succeeded", async () => {
    asRole("both");
    await renderPage();
    expect(screen.queryByText(PLACEHOLDER_KEYS_UNREADABLE)).toBeNull();
  });
});

describe("wizard drafts by role (199-10 task 2, CD-10)", () => {
  const WIZARD_ROW = { ...row("s-wd", "draft"), source: "wizard" };
  const DRAFT = {
    id: "s-wd",
    name: "Wizard Draft",
    created_at: "2026-01-02T00:00:00.000Z",
    review_note: null,
  };

  it("allocator only: the wizard draft is a Draft row, the list read does not hide it, and there is no resume banner", async () => {
    asRole("allocator");
    state.strategies = [row("s-pub", "published"), WIZARD_ROW];
    state.wizardDraft = DRAFT;
    await renderPage();

    // The draft is listed, with its status (the read keeps wizard drafts).
    expect(screen.getByRole("link", { name: "Strategy s-wd" })).toBeTruthy();
    expect(within(tableEl()).getByText("Draft")).toBeTruthy();
    // No wizard-draft filter on the list read, and no banner. The route the
    // banner points at is manager-guarded, so it would only bounce the viewer.
    expect(state.strategyOrs).not.toContain("source.neq.wizard,status.neq.draft");
    expect(screen.queryByTestId("wizard-draft-resume-banner")).toBeNull();
    // Not a read thrown away: the companion wizard-draft read is not made either.
    expect(state.strategyEqs).not.toContainEqual(["source", "wizard"]);
  });

  it("manager and both: the draft filter on the list read and the resume banner", async () => {
    for (const role of ["manager", "both"] as const) {
      asRole(role);
      state.strategyOrs = [];
      state.strategyEqs = [];
      state.wizardDraft = DRAFT;
      const { unmount } = render(await renderToElement());
      expect(state.strategyOrs, `${role}: filter`).toContain("source.neq.wizard,status.neq.draft");
      expect(state.strategyEqs, `${role}: companion read`).toContainEqual(["source", "wizard"]);
      expect(screen.getByTestId("wizard-draft-resume-banner"), `${role}: banner`).toBeTruthy();
      unmount();
    }
  });

  it("the banner renders only when a draft exists", async () => {
    asRole("manager");
    state.wizardDraft = null;
    await renderPage();
    expect(screen.queryByTestId("wizard-draft-resume-banner")).toBeNull();
  });
});

describe("empty and unreadable branches by role (199-10 task 2, UI-SPEC States)", () => {
  it("manager and both with nothing: the manager card, no note and no allocator empty state", async () => {
    for (const role of ["manager", "both"] as const) {
      asRole(role);
      state.strategies = [];
      const { unmount } = render(await renderToElement());
      expect(screen.getByText(/^No strategies yet\./), `${role}`).toBeTruthy();
      // D-12 / LEAN-04 adjacency + empty: the header control is the ONE way to
      // start a strategy; the empty card points at it and carries no second one.
      const controls = addStrategyControls();
      expect(controls, `${role}: exactly one control`).toHaveLength(1);
      expect(controls[0].getAttribute("href"), `${role}`).toBe("/strategies/new/wizard");
      expect(screen.queryByRole("link", { name: "Create your first strategy" }), `${role}`).toBeNull();
      expect(screen.getByText(/Use Add a strategy above/), `${role}`).toBeTruthy();
      expect(screen.queryByTestId("comparison-set-note")).toBeNull();
      unmount();
    }
  });

  it("manager with nothing but a draft: Resume draft still links to the wizard, and the header stays the one Add a strategy control", async () => {
    asRole("manager");
    state.strategies = [];
    state.wizardDraft = {
      id: "s-wd",
      name: "Wizard Draft",
      created_at: "2026-01-02T00:00:00.000Z",
      review_note: null,
    };
    await renderPage();
    const controls = addStrategyControls();
    expect(controls).toHaveLength(1);
    expect(controls[0].getAttribute("href")).toBe("/strategies/new/wizard");
    expect(screen.getByRole("link", { name: "Resume draft" }).getAttribute("href")).toBe(
      "/strategies/new/wizard",
    );
    expect(screen.queryByRole("link", { name: "Create your first strategy" })).toBeNull();
  });

  it("allocator only with nothing: the moved empty state, an Add a strategy BUTTON, never a link into the manager subtree", async () => {
    asRole("allocator");
    state.strategies = [];
    await renderPage();

    expect(screen.getByText("No strategies yet.")).toBeTruthy();
    expect(
      screen.getByText(
        "Connect an exchange API key or upload a CSV to see your strategies ranked here. First metrics arrive ~10–15 minutes after a key connects.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add a strategy" }).tagName).toBe("BUTTON");
    expect(screen.queryByText("Add a Strategy")).toBeNull();
    expect(screen.queryByRole("link", { name: "Create your first strategy" })).toBeNull();
    expect(screen.queryByTestId("comparison-set-note")).toBeNull();
  });

  it("a failed list read shows the unreadable card for every role and never No strategies yet", async () => {
    for (const role of ["allocator", "manager", "both"] as const) {
      asRole(role);
      state.listError = true;
      const { unmount } = render(await renderToElement());
      expect(screen.getByText(LIST_UNREADABLE), `${role}`).toBeTruthy();
      expect(screen.queryByText("No strategies yet.")).toBeNull();
      expect(screen.queryByTestId("comparison-set-note")).toBeNull();
      unmount();
    }
  });

  it("the just-submitted line renders for every role, and is cut short when the list read failed", async () => {
    for (const role of ["allocator", "manager", "both"] as const) {
      asRole(role);
      state.listError = false;
      const ok = render(await renderToElement({ wizard_submitted: "1" }));
      expect(screen.getByTestId("wizard-submitted-status").textContent, role).toBe(
        "Strategy submitted. It is listed below as pending review.",
      );
      ok.unmount();
      state.listError = true;
      const failed = render(await renderToElement({ wizard_submitted: "1" }));
      expect(screen.getByTestId("wizard-submitted-status").textContent, role).toBe(
        "Strategy submitted.",
      );
      failed.unmount();
    }
  });

  it("a failed key-status read prints KEY_STATUS_UNREADABLE_NOTE for an allocator too", async () => {
    asRole("allocator");
    state.strategies = [{ ...row("s-pub", "published"), api_key_id: "key-1" }];
    state.keysError = true;
    await renderPage();
    expect(screen.getByText(KEY_STATUS_NOTE)).toBeTruthy();
  });
});

describe("role both: one list with the union (199-10 task 3, D-02)", () => {
  it("one row per strategy from one read, with the union of the furniture, the placeholders and the resume banner", async () => {
    asRole("both");
    state.bareKeys = TWO_KEYS;
    state.portfolio = { id: "pf-1" };
    state.wizardDraft = {
      id: "s-wd",
      name: "Wizard Draft",
      created_at: "2026-01-02T00:00:00.000Z",
      review_note: null,
    };
    await renderPage();

    // ONE read of the viewer's own strategies feeds the whole list: the owner
    // list select is the only `strategies` read besides the wizard-draft lookup,
    // so a strategy cannot arrive twice (once per role).
    const listReads = state.strategyEqs.filter(
      ([col]) => col === "user_id",
    );
    expect(listReads.length).toBe(2); // the list, and the companion wizard-draft read
    for (const id of ["s-pub", "s-priv"]) {
      expect(screen.getAllByRole("link", { name: `Strategy ${id}` }).length, id).toBe(1);
    }

    // The union on one row: manager furniture and allocator furniture together.
    const tr = screen.getByRole("link", { name: "Strategy s-pub" }).closest("tr") as HTMLElement;
    expect(within(tr).getByRole("link", { name: "Edit Strategy s-pub" })).toBeTruthy();
    expect(within(tr).getByTestId("share-s-pub")).toBeTruthy();
    expect(within(tr).getByTestId("actions-s-pub")).toBeTruthy();
    expect(within(tr).getByRole("button", { name: "Change mark…" })).toBeTruthy();
    expect(within(tr).getByTestId("simulate-s-pub")).toBeTruthy();

    // The page furniture of both roles at once.
    expect(addStrategyControls()).toHaveLength(1);
    expect(screen.getByTestId("pending-intros")).toBeTruthy();
    expect(screen.getByTestId("wizard-draft-resume-banner")).toBeTruthy();
    expect(screen.getByText(/Bybit · Bybit Main/)).toBeTruthy();
    expect(screen.getByText(/Deribit · Deribit Options/)).toBeTruthy();
    expect(screen.getByTestId("comparison-set-note").textContent).toBe(
      `${mapCopy(7)} ${kSentence(2)}`,
    );
  });
});

// ---------------------------------------------------------------------------
// Phase 199 plan 12 (D-03, SC-3, R-05): the Health column, server to cell.
// The server computes the word (`strategyHealthOf`, server clock, the row's own
// asset class); the table only renders it. Every case reads the real page over
// the Supabase double, so each is RED on a page that passes no `health`.
// ---------------------------------------------------------------------------

/** A UTC day `daysAgo` before now, as the stored `series_end` day string. */
function dayAgo(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
}

/** A computed row whose newest stored return day is `daysAgo` days old. */
function healthRow(id: string, daysAgo: number, assetClass: string) {
  return {
    ...row(id, "published"),
    asset_class: assetClass,
    strategy_analytics: { ...COMPLETE, series_end: dayAgo(daysAgo) },
  };
}

/** The text of the Health cell in a row, located by the header, never by index. */
function healthCellText(name: string): string {
  const labels = screen.getAllByRole("columnheader").map((h) => (h.textContent ?? "").trim());
  const col = labels.indexOf("Health");
  expect(col, "a Health header").toBeGreaterThan(-1);
  const tr = screen.getByRole("link", { name }).closest("tr") as HTMLElement;
  const cells = Array.from(tr.querySelectorAll<HTMLTableCellElement>(":scope > td"));
  return (cells[col].textContent ?? "").trim();
}

describe("the Health column, computed on the server (199-12, D-03)", () => {
  it("a row 40 days stale reads Stale (no data since {day}) for every role", async () => {
    for (const role of ["allocator", "manager", "both"]) {
      asRole(role);
      state.strategies = [healthRow("s-old", 40, "crypto")];
      const { unmount } = render(await renderToElement());
      const word = healthCellText("Strategy s-old");
      expect(word, role).toMatch(/^Stale \(no data since [A-Z][a-z]{2}\u00a0\d{1,2},\u00a0\d{4}\)$/);
      expect(word, role).toContain(
        String(new Date(`${dayAgo(40)}T00:00:00Z`).getUTCFullYear()),
      );
      unmount();
    }
  });

  it("a fresh row reads Healthy", async () => {
    state.strategies = [healthRow("s-new", 1, "crypto")];
    await renderPage();
    expect(healthCellText("Strategy s-new")).toBe("Healthy");
  });

  it("T-199-19: a failed key-status read turns a fresh row's Healthy into the em dash", async () => {
    // The key read only runs when a row names a key.
    state.strategies = [{ ...healthRow("s-new", 1, "crypto"), api_key_id: "key-1" }];
    state.keysError = true;
    await renderPage();
    expect(healthCellText("Strategy s-new")).toBe("—");
    // And the page says why (the shipped note), so the dash is not unexplained.
    expect(screen.getByText(KEY_STATUS_NOTE)).toBeTruthy();
  });

  it("R-05: 9 days old is Stale for a crypto row and Healthy for a traditional one (the row's own asset class)", async () => {
    state.strategies = [
      healthRow("s-crypto", 9, "crypto"),
      healthRow("s-trad", 9, "traditional"),
    ];
    await renderPage();
    expect(healthCellText("Strategy s-crypto")).toMatch(/^Stale \(no data since /);
    expect(healthCellText("Strategy s-trad")).toBe("Healthy");
  });

  it("a placeholder row prints the em dash in Health", async () => {
    asRole("allocator");
    state.bareKeys = TWO_KEYS;
    state.portfolio = { id: "pf-1" };
    state.strategies = [healthRow("s-new", 1, "crypto")];
    await renderPage();
    const labels = screen.getAllByRole("columnheader").map((h) => (h.textContent ?? "").trim());
    const col = labels.indexOf("Health");
    const placeholder = screen.getAllByText("Finish setup →")[0].closest("tr") as HTMLElement;
    const cells = Array.from(placeholder.querySelectorAll<HTMLTableCellElement>(":scope > td"));
    expect((cells[col].textContent ?? "").trim()).toBe("—");
  });
});

// ---------------------------------------------------------------------------
// Phase 199 plan 14 (D-03, SC-3): the legend mounts under the table, for every
// role, and only where there is a table to explain.
// ---------------------------------------------------------------------------
describe("the legend mount (199-14 task 1, D-03)", () => {
  it("every role: the legend renders AFTER the table, and the headings read H1 Strategies then H2 Legend", async () => {
    for (const role of ["allocator", "manager", "both"] as const) {
      asRole(role);
      const { container, unmount } = render(await renderToElement());
      const legend = container.querySelector("section#strategies-legend");
      expect(legend, `${role}: the legend`).toBeTruthy();
      const table = container.querySelector("table") as HTMLElement;
      expect(
        table.compareDocumentPosition(legend as Node) & Node.DOCUMENT_POSITION_FOLLOWING,
        `${role}: the legend follows the table`,
      ).toBeTruthy();
      const headings = Array.from(container.querySelectorAll("h1, h2")).map(
        (h) => `${h.tagName} ${(h.textContent ?? "").trim()}`,
      );
      expect(headings.filter((h) => h === "H1 Strategies" || h === "H2 Legend"), role).toEqual([
        "H1 Strategies",
        "H2 Legend",
      ]);
      unmount();
    }
  });

  it("no legend on an empty page, for any role", async () => {
    for (const role of ["allocator", "manager", "both"] as const) {
      asRole(role);
      state.strategies = [];
      const { container, unmount } = render(await renderToElement());
      expect(container.querySelector("#strategies-legend"), role).toBeNull();
      unmount();
    }
  });

  it("no legend when the list read failed (the unreadable card replaces the table)", async () => {
    state.listError = true;
    const { container } = render(await renderToElement());
    expect(container.querySelector("#strategies-legend")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Phase 199 plan 14 (D-03, SC-3): the label-coverage CONTRACT. The merged list
// is rendered for every role with one row per Health word and per chip, and
// every label the table printed must have an entry in the legend under it. The
// legend is a claim about the page; this is the test that it keeps up with it.
// ---------------------------------------------------------------------------
const VERIFIED = "verified check";

/** One row per Health word, status, mark, chip and key pill the list can print. */
function contractRows() {
  const withAnalytics = (id: string, status: string, analytics: Record<string, unknown> | null) => ({
    ...row(id, status),
    strategy_analytics: analytics,
  });
  return [
    // Healthy + Published + Own capital + the verified check (via the trust tier, below).
    { ...healthRow("s-healthy", 1, "crypto") },
    // Updating + Pending review + the Syncing chip.
    withAnalytics("s-updating", "pending_review", { computation_status: "computing" }),
    // Stale (no data since ...).
    { ...healthRow("s-stale", 40, "crypto") },
    // Stale (no data yet) + Draft + the No data chip: no analytics row, created long ago.
    withAnalytics("s-nodata", "draft", null),
    // Analytics failed.
    withAnalytics("s-failed", "published", { computation_status: "failed" }),
    // Key problem x2: one revoked key and one failed sign-in, each its own pill.
    { ...healthRow("s-revoked", 1, "crypto"), api_key_id: "key-revoked" },
    { ...healthRow("s-signin", 1, "crypto"), api_key_id: "key-signin" },
    // Private + Team review + the compact BTC chip.
    {
      ...row("s-private", "private"),
      capital_ownership: "team_review",
      strategy_analytics: { ...COMPLETE, series_end: dayAgo(1), native_unit: "BTC" },
    },
    // Archived: not judged, the em dash.
    withAnalytics("s-archived", "archived", { ...COMPLETE, series_end: dayAgo(1) }),
  ];
}

const key = (id: string, sync_status: string) => ({
  id,
  exchange: "binance",
  label: `Key ${id}`,
  sync_status,
  sync_error: null,
  last_sync_at: null,
});

/** The legend's term for a rendered Health word (the Stale words carry a per-row date). */
function healthTerm(word: string): string {
  return /^Stale \(no data since /.test(word) || word === "Stale (no data yet)"
    ? "Stale (no data since …)"
    : word;
}

/** The normalised, whitespace-collapsed text of a node. */
const text = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").trim();

/** The terms the legend defines, for the legend panel under the table. */
function legendTerms(container: HTMLElement): Set<string> {
  const terms = new Set<string>();
  for (const dt of container.querySelectorAll("#strategies-legend dt")) {
    terms.add(dt.querySelector('[title="Verified via exchange API"]') ? VERIFIED : text(dt));
  }
  return terms;
}

/**
 * Every label the TABLE printed, by family. Strategy-type badges ("options" in
 * this fixture) and the SyncBadge line are self-describing text, not status
 * chips (UI-SPEC), so they are not collected.
 */
function renderedLabels(container: HTMLElement): Map<string, string> {
  const table = container.querySelector("table") as HTMLElement;
  const labels = new Map<string, string>(); // label -> family
  const headers = Array.from(table.querySelectorAll("thead th")).map((h) => text(h));
  const colOf = (name: string) => headers.findIndex((h) => h === name || h.startsWith(name));
  const health = colOf("Health");
  const status = colOf("Status");
  expect(health, "a Health header").toBeGreaterThan(-1);
  expect(status, "a Status header").toBeGreaterThan(-1);
  for (const tr of table.querySelectorAll("tbody tr")) {
    const cells = Array.from(tr.querySelectorAll(":scope > td"));
    if (cells.length <= Math.max(health, status)) continue;
    labels.set(healthTerm(text(cells[health])), "health");
    // A placeholder row prints a dash in Status; a real row prints the Badge.
    if (text(cells[status]) !== "—") labels.set(text(cells[status]), "status");
  }
  for (const chip of table.querySelectorAll(
    '[class*="rounded-md"][class*="font-medium"], [class*="rounded-sm"][class*="font-medium"]',
  )) {
    // A control (Edit, Change mark) is an action, not a status chip.
    if (chip.closest("a, button")) continue;
    const t = text(chip);
    if (t === "options") continue; // a strategy-type badge: self-describing text
    if (t) labels.set(t, "chip");
  }
  if (table.querySelector('[title="Verified via exchange API"]')) labels.set(VERIFIED, "verified");
  return labels;
}

describe("the legend covers every label the list renders (199-14 task 2, SC-3, D-03)", () => {
  for (const role of ["allocator", "manager", "both"] as const) {
    it(`${role}: one row per Health word and chip, and every rendered label has a legend entry`, async () => {
      asRole(role);
      state.strategies = contractRows();
      state.keys = [key("key-revoked", "revoked"), key("key-signin", "sign_in_failed")];
      state.signals = new Map([["s-healthy", { trust_tier: "api_verified", status: "published" }]]);
      // Placeholder rows are the allocator's furniture (a bare key with no strategy).
      state.bareKeys = [{ id: "bare-1", exchange: "binance", label: "Bare" }];
      state.portfolio = { id: "pf-1" };
      const { container } = render(await renderToElement());

      const rendered = renderedLabels(container);
      const terms = legendTerms(container);
      const missing = [...rendered.keys()].filter((l) => !terms.has(l));
      expect(missing, `${role}: rendered labels with no legend entry`).toEqual([]);

      // Not vacuous: the fixture really did print every Health word, every status
      // and the chips the role sees, so "no missing label" means something.
      for (const word of [
        "Healthy",
        "Updating",
        "Stale (no data since …)",
        "Analytics failed",
        "Key problem",
        "—",
      ]) {
        expect(rendered.has(word), `${role}: the fixture printed the Health word ${word}`).toBe(true);
      }
      for (const label of ["Published", "Pending review", "Draft", "Private", "Archived"]) {
        expect(rendered.has(label), `${role}: the fixture printed the status ${label}`).toBe(true);
      }
      for (const label of ["Syncing", "No data", "Key revoked", "Sign-in failed", VERIFIED]) {
        expect(rendered.has(label), `${role}: the fixture printed ${label}`).toBe(true);
      }
      expect(
        [...rendered.keys()].some((l) => /BTC/.test(l)),
        `${role}: the fixture printed the BTC chip`,
      ).toBe(true);
      if (role !== "manager") {
        expect(rendered.has("Own capital"), `${role}: Own capital`).toBe(true);
        expect(rendered.has("No strategy yet"), `${role}: No strategy yet`).toBe(true);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Phase 199 plan 16 Task 1 (D-03, CD-05, CD-11): the row note's Health detail for
// Analytics failed. The day is the last computation's (the selected job's
// claimed_at, else created_at), read for EVERY failed row: an unpublished one
// reuses the read its share note already makes, a published one gets its own
// (IN-04 skips published rows' jobs for the share note, which does not need them).
// ---------------------------------------------------------------------------

/** The full-width note row under a strategy's data row, located by the row's own link. */
function noteOf(name: string): HTMLElement | null {
  const tr = screen.getByRole("link", { name }).closest("tr") as HTMLElement;
  return tr.nextElementSibling?.querySelector<HTMLElement>('[data-testid="strategy-row-footer"]') ?? null;
}

/** A row whose stored analytics FAILED, with no key and no members unless given. */
function failedRow(id: string, status: string, extra: Record<string, unknown> = {}) {
  return { ...row(id, status), strategy_analytics: { computation_status: "failed" }, ...extra };
}

/** One finished-unsuccessfully chain job: claimed on 2026-11-02 (UTC), created the hour before. */
const FAILED_JOB = {
  kind: "compute_analytics_from_csv",
  status: "failed_final",
  error_kind: "permanent",
  claimed_at: "2026-11-02T10:00:00Z",
  created_at: "2026-11-02T09:00:00Z",
};
const FAILED_SENTENCE = "The last computation, on Nov\u00a02,\u00a02026, did not produce figures.";
const UNREADABLE_SENTENCE =
  "We could not read this strategy's computation status. Reload this page to try again.";

describe("the Analytics failed detail names the failed day and the viewer's action (199-16 Task 1, D-03)", () => {
  it("a failed DRAFT row: the day from its own compute-jobs read, then the shipped remedy, registered", async () => {
    asRole("manager");
    state.strategies = [failedRow("s-fail", "draft")];
    state.jobs["s-fail"] = [FAILED_JOB];
    await renderPage();
    const note = noteOf("Strategy s-fail") as HTMLElement;
    const line = note.querySelector('[data-degrade-id="strategies.analytics-failed"]') as HTMLElement;
    expect(line.textContent).toBe(`${FAILED_SENTENCE} Use the contact form to have it resolved.`);
    // One read for the row, shared by its share note and its detail (not two).
    expect(state.rpcCalls.filter((id) => id === "s-fail")).toHaveLength(1);
  });

  it("a failed PUBLISHED row gets a read of its own and names the day too (IN-04 skips it for the share note)", async () => {
    asRole("manager");
    state.strategies = [failedRow("s-fail-pub", "published")];
    state.jobs["s-fail-pub"] = [FAILED_JOB];
    await renderPage();
    const line = noteOf("Strategy s-fail-pub")!.querySelector(
      '[data-degrade-id="strategies.analytics-failed"]',
    ) as HTMLElement;
    expect(line.textContent).toContain(FAILED_SENTENCE);
    expect(state.rpcCalls.filter((id) => id === "s-fail-pub")).toHaveLength(1);
    // The read was attempted, so the unreadable sentence is not what a published row prints.
    expect(noteOf("Strategy s-fail-pub")!.textContent).not.toContain(UNREADABLE_SENTENCE);
  });

  it("claimed_at is the day when the job has one, created_at when it never claimed (UTC day, never the client clock)", async () => {
    asRole("manager");
    state.strategies = [failedRow("s-claimed", "draft"), failedRow("s-queued-then-failed", "draft")];
    state.jobs["s-claimed"] = [{ ...FAILED_JOB, claimed_at: "2026-11-05T23:59:59Z", created_at: "2026-11-01T00:00:00Z" }];
    state.jobs["s-queued-then-failed"] = [{ ...FAILED_JOB, claimed_at: null, created_at: "2026-10-30T08:00:00Z" }];
    await renderPage();
    expect(noteOf("Strategy s-claimed")!.textContent).toContain("on Nov\u00a05,\u00a02026,");
    expect(noteOf("Strategy s-queued-then-failed")!.textContent).toContain("on Oct\u00a030,\u00a02026,");
  });

  it("an unreadable day prints the shipped KCS09-UNREADABLE sentence with its reload remedy, as a read failure, and never a day", async () => {
    asRole("manager");
    state.strategies = [failedRow("s-draft", "draft"), failedRow("s-pub", "published")];
    state.rpcError = true;
    await renderPage();
    for (const [name, id] of [
      ["Strategy s-draft", "s-draft"],
      ["Strategy s-pub", "s-pub"],
    ] as const) {
      const note = noteOf(name) as HTMLElement;
      const line = note.querySelector('[data-degrade-id="strategies.compute-status-unreadable"]') as HTMLElement;
      expect(line.textContent, id).toBe(UNREADABLE_SENTENCE);
      expect(note.textContent, id).not.toContain("did not produce figures");
      // The published row's read WAS attempted: the sentence is about a failed read, not a skipped one.
      expect(state.rpcCalls, id).toContain(id);
    }
  });

  it("a read that succeeds with no job on record is NOT unreadable: no day, no reload remedy, the failure and the shape's remedy (199 review WR-02)", async () => {
    asRole("manager");
    state.strategies = [failedRow("s-nojob", "published", { api_key_id: "key-1" })];
    state.jobs["s-nojob"] = [];
    await renderPage();
    const note = noteOf("Strategy s-nojob") as HTMLElement;
    expect(note.querySelector('[data-degrade-id="strategies.compute-status-unreadable"]')).toBeNull();
    const line = note.querySelector('[data-degrade-id="strategies.analytics-failed-undated"]') as HTMLElement;
    expect(line.textContent).toBe(
      "The last computation did not produce figures. Start a new computation with Resync on this strategy's edit page. Use the contact form if it does not complete.",
    );
    expect(line.querySelector('a[href="/strategies/s-nojob/edit"]')).not.toBeNull();
    expect(note.textContent).not.toContain("could not read");
    expect(note.textContent).not.toContain("Reload this page");
  });

  it("a row that is not Analytics failed gets no new jobs read: a healthy published row and a stale one make none", async () => {
    asRole("manager");
    state.strategies = [healthRow("s-ok", 1, "crypto"), healthRow("s-old", 40, "crypto")];
    await renderPage();
    expect(state.rpcCalls).toEqual([]);
  });

  it("order: review feedback, then the Health detail, then the share note", async () => {
    asRole("manager");
    state.strategies = [failedRow("s-ord", "draft", { review_note: "Please add a longer track record." })];
    state.jobs["s-ord"] = [FAILED_JOB];
    await renderPage();
    const note = noteOf("Strategy s-ord") as HTMLElement;
    const feedback = Array.from(note.querySelectorAll("p")).find((p) => /^Review feedback:/.test(p.textContent ?? ""))!;
    const detail = note.querySelector('[data-degrade-id="strategies.analytics-failed"]') as HTMLElement;
    const share = note.querySelector('[data-testid="strategy-row-share-note"]') as HTMLElement;
    expect(feedback && detail && share).toBeTruthy();
    expect(feedback.compareDocumentPosition(detail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(detail.compareDocumentPosition(share) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("CD-11: a transient failure on an API strategy sends a manager (and both) to the edit page and an allocator-only viewer to the Exchanges page, never the edit page", async () => {
    const transient = { ...FAILED_JOB, error_kind: "transient" };
    for (const role of ["manager", "both"] as const) {
      asRole(role);
      state.strategies = [failedRow("s-api", "published", { api_key_id: "key-1" })];
      state.jobs["s-api"] = [transient];
      const { unmount } = render(await renderToElement());
      const line = noteOf("Strategy s-api")!.querySelector('[data-degrade-id="strategies.analytics-failed"]') as HTMLElement;
      expect(line.textContent, role).toContain("Resync");
      expect(line.querySelector('a[href="/strategies/s-api/edit"]'), role).not.toBeNull();
      unmount();
    }
    asRole("allocator");
    state.strategies = [failedRow("s-api", "published", { api_key_id: "key-1" })];
    state.jobs["s-api"] = [transient];
    const { container } = render(await renderToElement());
    const line = noteOf("Strategy s-api")!.querySelector('[data-degrade-id="strategies.analytics-failed"]') as HTMLElement;
    expect(line.textContent).toBe(`${FAILED_SENTENCE} Check its key on the Exchanges page.`);
    expect(line.querySelector('a[href^="/profile?tab=exchanges"]')).not.toBeNull();
    expect(container.querySelector('a[href*="/edit"]')).toBeNull();
    expect(container.querySelector('a[href*="/strategies/new"]')).toBeNull();
  });

  it("CD-11: an allocator-only viewer of a failed CSV strategy is not sent to the manager-guarded CSV wizard either", async () => {
    asRole("allocator");
    state.strategies = [failedRow("s-csv", "published", { source: "csv" })];
    state.jobs["s-csv"] = [{ ...FAILED_JOB, error_kind: "transient" }];
    const { container } = render(await renderToElement());
    const line = noteOf("Strategy s-csv")!.querySelector('[data-degrade-id="strategies.analytics-failed"]') as HTMLElement;
    expect(line.textContent).toBe(`${FAILED_SENTENCE} Use the contact form to have it checked.`);
    expect(container.querySelector('a[href*="/strategies/new"]')).toBeNull();
  });

  it("a manager keeps the shipped CSV remedy and its link for the same failed CSV strategy", async () => {
    asRole("manager");
    state.strategies = [failedRow("s-csv", "published", { source: "csv" })];
    state.jobs["s-csv"] = [{ ...FAILED_JOB, error_kind: "transient" }];
    await renderPage();
    const line = noteOf("Strategy s-csv")!.querySelector('[data-degrade-id="strategies.analytics-failed"]') as HTMLElement;
    expect(line.textContent).toContain("upload a new CSV strategy");
    expect(line.querySelector('a[href="/strategies/new/wizard?source=csv"]')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Phase 199 plan 16 Task 2 (D-03, CD-11): the Stale and Key problem details, by role.
// ---------------------------------------------------------------------------

/** The one registered detail line of a row's note, by id, or null. */
function detailOf(name: string, id: string): HTMLElement | null {
  return noteOf(name)?.querySelector<HTMLElement>(`[data-degrade-id="${id}"]`) ?? null;
}

/** A row that has never produced analytics, created long ago: Health reads Stale (no data yet). */
function noDataRow(id: string, extra: Record<string, unknown> = {}) {
  return { ...row(id, "draft"), strategy_analytics: null, ...extra };
}

describe("the Stale detail names the day and the viewer's action (199-16 Task 2, D-03, CD-11)", () => {
  const staleDay = () =>
    new Date(`${dayAgo(40)}T00:00:00Z`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    })
      // D-04: the helpers keep a date together with U+00A0, so the independent oracle does too.
      .replace(/ /g, "\u00a0");

  it("an API strategy: a manager and both are sent to the edit page, an allocator-only viewer to the Exchanges page and never the edit page", async () => {
    for (const role of ["manager", "both"] as const) {
      asRole(role);
      state.strategies = [{ ...healthRow("s-old", 40, "crypto"), api_key_id: "key-1" }];
      const { unmount } = render(await renderToElement());
      const line = detailOf("Strategy s-old", "strategies.stale") as HTMLElement;
      expect(line.textContent, role).toBe(`No new data since ${staleDay()}. Check its key on the edit page.`);
      expect(line.querySelector('a[href="/strategies/s-old/edit"]'), role).not.toBeNull();
      unmount();
    }
    asRole("allocator");
    state.strategies = [{ ...healthRow("s-old", 40, "crypto"), api_key_id: "key-1" }];
    const { container } = render(await renderToElement());
    const line = detailOf("Strategy s-old", "strategies.stale") as HTMLElement;
    expect(line.textContent).toBe(`No new data since ${staleDay()}. Check its key on the Exchanges page.`);
    expect(line.querySelector('a[href^="/profile?tab=exchanges"]')).not.toBeNull();
    expect(container.querySelector('a[href*="/edit"]')).toBeNull();
  });

  it("a CSV strategy: the manager's action is the CSV upload; an allocator-only viewer is not sent to the manager-guarded wizard", async () => {
    asRole("manager");
    state.strategies = [{ ...healthRow("s-csv", 40, "crypto"), source: "csv" }];
    const { unmount } = render(await renderToElement());
    const line = detailOf("Strategy s-csv", "strategies.stale") as HTMLElement;
    expect(line.textContent).toBe(`No new data since ${staleDay()}. Upload a newer CSV to extend the record.`);
    expect(line.querySelector('a[href="/strategies/new/wizard?source=csv"]')).not.toBeNull();
    unmount();

    asRole("allocator");
    const { container } = render(await renderToElement());
    const other = detailOf("Strategy s-csv", "strategies.stale") as HTMLElement;
    expect(other.textContent).toBe(`No new data since ${staleDay()}. Use the contact form to have it checked.`);
    expect(container.querySelector('a[href*="/strategies/new"]')).toBeNull();
  });
});

describe("the Stale (no data yet) detail takes the never-started remedy by role (199-16 Task 2, D-03, CD-11)", () => {
  const PREFIX = "No figures yet, and no computation is running. ";

  it("a manager keeps ownerRemedy's never-started remedy for the row's shape, with its edit link", async () => {
    for (const role of ["manager", "both"] as const) {
      asRole(role);
      state.strategies = [noDataRow("s-keyed", { api_key_id: "key-1" }), noDataRow("s-bare")];
      const { unmount } = render(await renderToElement());
      const keyed = detailOf("Strategy s-keyed", "strategies.stale-no-data") as HTMLElement;
      expect(keyed.textContent, role).toBe(
        `${PREFIX}Start a new computation with Resync on this strategy's edit page. Use the contact form if it does not complete.`,
      );
      expect(keyed.querySelector('a[href="/strategies/s-keyed/edit"]'), role).not.toBeNull();
      const bare = detailOf("Strategy s-bare", "strategies.stale-no-data") as HTMLElement;
      expect(bare.textContent, role).toContain("Link a key with Change key… on this strategy's edit page");
      unmount();
    }
  });

  it("an allocator-only viewer: the Exchanges page for a key-fed strategy, the contact form for one with no key, never the edit page", async () => {
    asRole("allocator");
    state.strategies = [noDataRow("s-keyed", { api_key_id: "key-1" }), noDataRow("s-bare")];
    const { container } = render(await renderToElement());
    expect(detailOf("Strategy s-keyed", "strategies.stale-no-data")!.textContent).toBe(
      `${PREFIX}Check its key on the Exchanges page.`,
    );
    expect(detailOf("Strategy s-bare", "strategies.stale-no-data")!.textContent).toBe(
      `${PREFIX}Use the contact form to have it checked.`,
    );
    expect(container.querySelector('a[href*="/edit"]')).toBeNull();
  });
});

describe("the Stale (no data yet) detail reads the row's REAL compute state (199 review SFH-03)", () => {
  it("a failed_permanent job under a never-computed row says contact-to-resolve, not the never-started Resync remedy", async () => {
    asRole("manager");
    state.strategies = [noDataRow("s-failed-job", { api_key_id: "key-1" })];
    state.jobs["s-failed-job"] = [FAILED_JOB];
    await renderPage();
    const line = detailOf("Strategy s-failed-job", "strategies.stale-no-data") as HTMLElement;
    expect(line.textContent).toBe(
      "No figures yet, and no computation is running. Use the contact form to have it resolved.",
    );
    expect(line.textContent).not.toContain("Resync");
  });

  it("a transient failure takes the shape remedy for its state: a manager the Resync edit page, an allocator-only viewer the Exchanges page and never the edit page", async () => {
    const transient = { ...FAILED_JOB, error_kind: "transient" };
    asRole("manager");
    state.strategies = [noDataRow("s-transient", { api_key_id: "key-1" })];
    state.jobs["s-transient"] = [transient];
    const { unmount } = render(await renderToElement());
    expect(detailOf("Strategy s-transient", "strategies.stale-no-data")!.querySelector('a[href="/strategies/s-transient/edit"]')).not.toBeNull();
    unmount();
    asRole("allocator");
    const { container } = render(await renderToElement());
    expect(detailOf("Strategy s-transient", "strategies.stale-no-data")!.textContent).toBe(
      "No figures yet, and no computation is running. Check its key on the Exchanges page.",
    );
    expect(container.querySelector('a[href*="/edit"]')).toBeNull();
  });

  it("a failed jobs read says so honestly: the unreadable line, never a guessed never-started remedy", async () => {
    asRole("manager");
    state.strategies = [noDataRow("s-nodata-unread", { api_key_id: "key-1" }), { ...noDataRow("s-nodata-pub"), status: "published" }];
    state.rpcError = true;
    await renderPage();
    for (const name of ["Strategy s-nodata-unread", "Strategy s-nodata-pub"]) {
      expect(detailOf(name, "strategies.compute-status-unreadable")!.textContent, name).toBe(UNREADABLE_SENTENCE);
      expect(detailOf(name, "strategies.stale-no-data"), name).toBeNull();
    }
  });
});

describe("the Key problem line is registered and carries the shipped caption and helper (199-16 Task 2, D-03)", () => {
  it.each([
    ["revoked", "Re-add a read-only key from your exchange."],
    ["sign_in_failed", "Update this account's credentials \u2014 they may have changed."],
  ] as const)(
    "a %s key: the line carries its registry id, the caption names the key, and the pill's helper is the registry's sentence",
    async (status, helper) => {
      asRole("manager");
      state.strategies = [{ ...healthRow("s-k", 1, "crypto"), api_key_id: "key-x" }];
      state.keys = [key("key-x", status)];
      await renderPage();
      const note = noteOf("Strategy s-k") as HTMLElement;
      const line = note.querySelector('[data-degrade-id="strategies.key-problem"]') as HTMLElement;
      expect(line).not.toBeNull();
      const caption = line.querySelector("p") as HTMLElement;
      expect(caption.textContent).toMatch(/^Exchange key \u00b7 .*Key key-x$/);
      expect(line.querySelector('[data-testid="allocator-sync-helper"]')!.textContent).toBe(helper);
      // One fact, one sentence: the key is named once in the note, by the key line.
      expect((note.textContent ?? "").split("Key key-x").length - 1).toBe(1);
    },
  );
});

describe("every non-Healthy row says what happened and where to go, in one registered line (199-16 Task 2)", () => {
  it.each(["allocator", "manager", "both"] as const)(
    "%s: Stale, Stale (no data yet), Analytics failed and Key problem rows each carry one detail; Healthy, Updating and the em dash carry none",
    async (role) => {
      asRole(role);
      state.strategies = contractRows();
      state.keys = [key("key-revoked", "revoked"), key("key-signin", "sign_in_failed")];
      state.jobs["s-failed"] = [FAILED_JOB];
      await renderPage();
      const DETAIL_IDS = [
        "strategies.stale",
        "strategies.stale-no-data",
        "strategies.analytics-failed",
        "strategies.analytics-failed-undated",
        "strategies.compute-status-unreadable",
        "strategies.key-problem",
      ];
      const detailIds = (name: string) =>
        DETAIL_IDS.filter((id) => detailOf(name, id) !== null);
      expect(detailIds("Strategy s-stale")).toEqual(["strategies.stale"]);
      expect(detailIds("Strategy s-nodata")).toEqual(["strategies.stale-no-data"]);
      expect(detailIds("Strategy s-failed")).toEqual(["strategies.analytics-failed"]);
      expect(detailIds("Strategy s-revoked")).toEqual(["strategies.key-problem"]);
      expect(detailIds("Strategy s-signin")).toEqual(["strategies.key-problem"]);
      // Healthy, Updating and the em dash (archived) carry none of them.
      for (const name of ["Strategy s-healthy", "Strategy s-updating", "Strategy s-archived"]) {
        const note = noteOf(name);
        expect(note === null ? [] : detailIds(name), name).toEqual([]);
      }
    },
  );
});

// ---------------------------------------------------------------------------
// Phase 199 plan 16 Task 3 (D-04, CD-05): the rest of the list's warnings are
// registered. The shipped wording and test ids stay; each warning gains its marker.
// ---------------------------------------------------------------------------
describe("the list's read failures, share note and empty states carry their registry ids (199-16 Task 3)", () => {
  it("a failed list read: the unreadable card's sentence is the registry's, with its id", async () => {
    state.listError = true;
    await renderPage();
    const card = screen.getByTestId("strategies-list-unreadable");
    const line = card.querySelector('[data-degrade-id="strategies.list-unreadable"]') as HTMLElement;
    expect(line.textContent).toBe(LIST_UNREADABLE);
  });

  it("a failed key-status read: the page-level line keeps its test id and carries the registry id", async () => {
    state.strategies = [{ ...row("s-pub", "published"), api_key_id: "key-1" }];
    state.keysError = true;
    await renderPage();
    const wrapper = screen.getByTestId("strategies-key-status-unreadable");
    const line = wrapper.querySelector('[data-degrade-id="strategies.key-status-unreadable"]') as HTMLElement;
    expect(line.textContent).toBe(KEY_STATUS_NOTE);
  });

  it("a failed placeholder-key read (allocator): the line keeps its test id and carries the registry id", async () => {
    asRole("allocator");
    state.bareKeys = null;
    await renderPage();
    const wrapper = screen.getByTestId("strategies-placeholder-keys-unreadable");
    const line = wrapper.querySelector('[data-degrade-id="strategies.placeholder-keys-unreadable"]') as HTMLElement;
    expect(line.textContent).toBe(PLACEHOLDER_KEYS_UNREADABLE);
  });

  it("the share note carries its registry id on the shipped element", async () => {
    state.strategies = [noDataRow("s-share")];
    await renderPage();
    const note = noteOf("Strategy s-share") as HTMLElement;
    expect(
      note.querySelector('[data-testid="strategy-row-share-note"][data-degrade-id="strategies.share-note"]'),
    ).not.toBeNull();
  });

  it("the manager empty card and its draft variant carry the empty id; the allocator-only empty state carries its own", async () => {
    for (const role of ["manager", "both"] as const) {
      asRole(role);
      state.strategies = [];
      state.wizardDraft = null;
      const plain = render(await renderToElement());
      expect(document.querySelector('[data-degrade-id="strategies.empty"]')?.textContent, role).toContain("No strategies yet.");
      plain.unmount();
      state.wizardDraft = { id: "s-wd", name: "WD", created_at: "2026-01-02T00:00:00.000Z", review_note: null };
      const draft = render(await renderToElement());
      expect(document.querySelector('[data-degrade-id="strategies.empty"]')?.textContent, role).toContain("No published strategies yet");
      draft.unmount();
    }
    asRole("allocator");
    state.strategies = [];
    state.wizardDraft = null;
    await renderPage();
    expect(document.querySelector('[data-degrade-id="strategies.empty-allocator"]')?.textContent).toContain("No strategies yet.");
    expect(document.querySelector('[data-degrade-id="strategies.empty"]')).toBeNull();
  });
});
