/**
 * Phase 149 / Plan 149-01 / NAV-01 — StrategyTable `visibility` prop.
 *
 * The blocking defect this file falsifies (RESEARCH Pitfall 1): StrategyTable
 * filters to `status === "published"` INSIDE the component, in the first line of
 * its `filtered` useMemo. That predicate is invisible to `withPublishedOnly`, to
 * the `no-raw-published-predicate` AST lint rule, and — critically — to every
 * one of the 912 lines of StrategyTable.test.tsx, whose row factory hard-codes
 * `status: "published"` (`StrategyTable.test.tsx:89`, a pinned literal). An
 * owner-scoped surface that reuses this component therefore renders
 * "No strategies match your filters." for every private/draft row.
 *
 * This spec is written RED-FIRST against today's source and deliberately does
 * NOT edit StrategyTable.test.tsx — new statuses arrive through `overrides` in a
 * NEW file (149-PATTERNS.md §11 + Pinned Literals).
 *
 * The spec measures a DELTA, not the world: every case that uses the DEFAULT
 * prop recipe (i.e. what /discovery/[slug] and /browse/[slug] pass today) is
 * green before and after the implementation. Only the `visibility="owner-all-
 * statuses"` arm, the hidden view toggle, and the Simulate gate go red first.
 *
 * `categorySlug="vis-spec"` is deliberate: StrategyTable.test.tsx documents a CI
 * flake where `discovery_view_preferences:u-1:crypto-sma` leaks across files via
 * the shared jsdom localStorage (`:122-138`). A distinct slug cannot collide
 * with that key.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { StrategyTable } from "./StrategyTable";
import type { Strategy, StrategyAnalytics } from "@/lib/types";
import { installFetchMock, restoreFetchMock } from "@/test/helpers/fetch";

type StrategyWithAnalytics = Strategy & { analytics: StrategyAnalytics };

// --- Fixtures ------------------------------------------------------------
//
// Cloned from StrategyTable.test.tsx:35-102 rather than imported: that file is
// a pinned-literal surface and exports nothing. Cloning keeps this spec free to
// vary `status` without touching the 912-line suite.

const ID_PRIVATE = "22222222-0000-4000-8000-000000000001";
const ID_DRAFT = "22222222-0000-4000-8000-000000000002";
const ID_PUBLISHED = "22222222-0000-4000-8000-000000000003";

const NAME_PRIVATE = "Private Nebula";
const NAME_DRAFT = "Draft Quasar";
const NAME_PUBLISHED = "Published Pulsar";

function makeAnalytics(
  overrides?: Partial<StrategyAnalytics>,
): StrategyAnalytics {
  return {
    id: "an-1",
    strategy_id: "s-1",
    computed_at: "2026-01-01T00:00:00Z",
    computing_started_at: null,
    computation_status: "complete",
    computation_error: null,
    benchmark: null,
    cumulative_return: 0.42,
    cagr: 0.18,
    volatility: 0.22,
    sharpe: 1.5,
    sortino: 1.9,
    calmar: 1.1,
    max_drawdown: -0.12,
    max_drawdown_duration_days: 30,
    six_month_return: 0.21,
    sparkline_returns: [0, 1, 2, 3, 4],
    sparkline_drawdown: [0, -0.1, -0.2, -0.05, 0],
    metrics_json: null,
    returns_series: null,
    drawdown_series: null,
    monthly_returns: null,
    daily_returns: null,
    rolling_metrics: null,
    return_quantiles: null,
    trade_metrics: null,
    volume_metrics: null,
    exposure_metrics: null,
    data_quality_flags: null,
    ...overrides,
  };
}

function makeStrategy(
  overrides: Partial<Strategy> & { id: string; name: string },
): StrategyWithAnalytics {
  return {
    user_id: "u-1",
    category_id: "cat-1",
    api_key_id: null,
    description: null,
    strategy_types: ["Long-Only"],
    subtypes: ["Trend Following"],
    markets: ["Spot"],
    supported_exchanges: ["Binance"],
    leverage_range: null,
    avg_daily_turnover: null,
    aum: 1_000_000,
    max_capacity: 10_000_000,
    start_date: "2024-01-01",
    status: "published",
    is_example: false,
    benchmark: "BTC",
    created_at: "2024-01-01T00:00:00Z",
    ...overrides,
    analytics: makeAnalytics({ strategy_id: overrides.id }),
  };
}

/** Full PercentileMap entry (all seven metric keys required) with overrides. */
function makePercentiles(
  id: string,
  overrides: Partial<Record<string, number>>,
): Record<string, Record<string, number>> {
  return {
    [id]: {
      cagr: 50,
      sharpe: 50,
      sortino: 50,
      calmar: 50,
      max_drawdown: 50,
      volatility: 50,
      cumulative_return: 50,
      ...overrides,
    },
  };
}

const privateRow = () =>
  makeStrategy({ id: ID_PRIVATE, name: NAME_PRIVATE, status: "private" });
const draftRow = () =>
  makeStrategy({ id: ID_DRAFT, name: NAME_DRAFT, status: "draft" });
const publishedRow = () =>
  makeStrategy({ id: ID_PUBLISHED, name: NAME_PUBLISHED, status: "published" });

// --- Module mocks --------------------------------------------------------

// SimulateImpactButton is a leaf that pulls in client-only modules. Unlike the
// `() => null` stub in StrategyTable.test.tsx this one renders a PROBE, because
// the Simulate gate case below has to count how many render — a null stub would
// make the assertion unfalsifiable.
vi.mock("@/components/discovery/SimulateImpactButton", () => ({
  SimulateImpactButton: () => <span data-testid="simulate-probe" />,
}));

beforeEach(() => {
  installFetchMock();
  try {
    window.localStorage.clear();
  } catch {
    // jsdom may not implement clear in some configurations; non-fatal.
  }
});

afterEach(() => {
  restoreFetchMock();
});

// --- Helpers -------------------------------------------------------------

/** The sortable column-header labels, arrow glyph stripped. */
function headerLabels(): string[] {
  return Array.from(document.querySelectorAll("thead th button")).map((b) =>
    (b.textContent ?? "").replace(/[↑↓]/g, "").trim(),
  );
}

/** The <tr> whose text contains `name`. */
function rowFor(name: string): HTMLElement {
  const row = Array.from(document.querySelectorAll("tbody tr")).find((tr) =>
    (tr.textContent ?? "").includes(name),
  );
  if (!row) throw new Error(`no rendered row for "${name}"`);
  return row as HTMLElement;
}

/** Text of the nth <td> in a row (0 = the leading rank cell). */
function cellText(row: HTMLElement, index: number): string {
  const cells = Array.from(row.querySelectorAll("td"));
  return (cells[index]?.textContent ?? "").trim();
}

// -------------------------------------------------------------------------

describe("StrategyTable visibility — SC-1c: the owner arm renders non-published rows", () => {
  it("visibility='owner-all-statuses' renders private, draft AND published rows", () => {
    render(
      <StrategyTable
        strategies={[privateRow(), draftRow(), publishedRow()]}
        categorySlug="vis-spec"
        visibility="owner-all-statuses"
      />,
    );

    expect(screen.getByText(NAME_PRIVATE)).toBeInTheDocument();
    expect(screen.getByText(NAME_DRAFT)).toBeInTheDocument();
    expect(screen.getByText(NAME_PUBLISHED)).toBeInTheDocument();
  });

  it("the DEFAULT recipe (no visibility prop) still drops every non-published row", () => {
    render(
      <StrategyTable
        strategies={[privateRow(), draftRow(), publishedRow()]}
        categorySlug="vis-spec"
      />,
    );

    // This is the invariant /discovery/[slug] and /browse/[slug] have relied on
    // since 2eef614a. It is green BEFORE and AFTER the implementation — the
    // default must not widen anything.
    expect(screen.queryByText(NAME_PRIVATE)).toBeNull();
    expect(screen.queryByText(NAME_DRAFT)).toBeNull();
    expect(screen.getByText(NAME_PUBLISHED)).toBeInTheDocument();
  });

  it("the owner arm hands the memo a COPY — the caller's array is never re-ordered", () => {
    // `result.sort(...)` in the filtered memo mutates in place. If the owner arm
    // returned the prop array itself, this input would come back re-ordered.
    const rows = [
      makeStrategy({ id: ID_PRIVATE, name: NAME_PRIVATE, status: "private" }),
      makeStrategy({ id: ID_DRAFT, name: NAME_DRAFT, status: "draft" }),
    ];
    rows[0].analytics.sharpe = 0.1;
    rows[1].analytics.sharpe = 9.9;

    render(
      <StrategyTable
        strategies={rows}
        categorySlug="vis-spec"
        visibility="owner-all-statuses"
      />,
    );

    // Sharpe-desc would put the 9.9 row first if the prop array were sorted.
    expect(rows[0].name).toBe(NAME_PRIVATE);
    expect(rows[1].name).toBe(NAME_DRAFT);
  });
});

describe("StrategyTable visibility — SC-2a: column parity with the discovery recipe", () => {
  it("renders an identical column-header set and a leading #1 rank cell under both recipes", () => {
    const fixture = [publishedRow()];

    // Discovery recipe — exactly what /discovery/[slug] passes today.
    const discovery = render(
      <StrategyTable strategies={fixture} categorySlug="vis-spec" />,
    );
    const discoveryHeaders = headerLabels();
    const discoveryFirstRow = (
      document.querySelector("tbody tr")?.textContent ?? ""
    );
    discovery.unmount();

    // Owner recipe.
    render(
      <StrategyTable
        strategies={fixture}
        categorySlug="vis-spec"
        visibility="owner-all-statuses"
      />,
    );
    const ownerHeaders = headerLabels();
    const ownerFirstRow = document.querySelector("tbody tr")?.textContent ?? "";

    // Literal expectation (Oracle Independence — never imported from COLUMNS).
    const EXPECTED = [
      "Strategy",
      "Return %",
      "CAGR",
      "Sharpe",
      "Max DD",
      "Volatility",
      "6 Month",
      "AUM",
    ];
    expect(discoveryHeaders).toEqual(EXPECTED);
    expect(ownerHeaders).toEqual(EXPECTED);

    // Every header is a real sort button under both recipes (8 of them).
    expect(document.querySelectorAll("thead th button")).toHaveLength(8);

    // The leading rank cell is present in both — ranking is inherited, not
    // re-implemented for the owner surface.
    expect(discoveryFirstRow).toContain("#1");
    expect(ownerFirstRow).toContain("#1");
  });
});

describe("StrategyTable visibility — SC-2b: percentile suffix on the owner surface", () => {
  it("shows P82 on the mapped row under the default sharpe sort and nothing on an unmapped row", () => {
    render(
      <StrategyTable
        strategies={[privateRow(), publishedRow()]}
        categorySlug="vis-spec"
        visibility="owner-all-statuses"
        percentiles={makePercentiles(ID_PRIVATE, { sharpe: 82 })}
      />,
    );

    // The mapped row is the PRIVATE one — peer ranking reaches own unpublished
    // rows exactly as it reaches discovery rows.
    expect(screen.getByText("P82")).toBeInTheDocument();
    expect(screen.getByText("P82").closest("td")?.textContent).toContain("1.50");

    // The unmapped published row gets no fabricated rank.
    expect(rowFor(NAME_PUBLISHED).textContent).not.toMatch(/P\d+/);
    // Exactly one suffix in the whole table.
    expect(screen.queryAllByText(/^P\d+$/)).toHaveLength(1);
  });

  it("renders NO suffix anywhere when percentiles are undefined (honest absence)", () => {
    render(
      <StrategyTable
        strategies={[privateRow(), publishedRow()]}
        categorySlug="vis-spec"
        visibility="owner-all-statuses"
      />,
    );
    expect(screen.queryByText(/^P\d+$/)).toBeNull();
  });
});

describe("StrategyTable visibility — SC-4c: own private rows get the full metric set", () => {
  it("formats a private row's metric cells identically to a published row with the same analytics", () => {
    render(
      <StrategyTable
        strategies={[privateRow(), publishedRow()]}
        categorySlug="vis-spec"
        visibility="owner-all-statuses"
      />,
    );

    const priv = rowFor(NAME_PRIVATE);
    const pub = rowFor(NAME_PUBLISHED);

    // Cell order: 0 = rank, 1 = Strategy, 2 = Return %, 3 = CAGR, 4 = Sharpe,
    // 5 = Max DD, 6 = Volatility, 7 = 6 Month, 8 = AUM. No star column (no
    // userId), so the indices match the COLUMNS order after the rank cell.
    // Literal expectations, from the fixture analytics (0.42 / 0.18 / 1.5 /
    // -0.12 / 0.22 / 0.21) through the honest-null formatters.
    expect(cellText(priv, 2)).toBe("+42.00%");
    expect(cellText(priv, 3)).toBe("+18.00%");
    expect(cellText(priv, 4)).toBe("1.50");
    expect(cellText(priv, 5)).toBe("-12.00%");
    expect(cellText(priv, 6)).toBe("+22.00%");
    expect(cellText(priv, 7)).toBe("+21.00%");

    // …and no reduced column set: the private row's metrics equal the published
    // row's, cell for cell.
    for (const i of [2, 3, 4, 5, 6, 7, 8]) {
      expect(cellText(priv, i)).toBe(cellText(pub, i));
    }
  });
});

describe("StrategyTable visibility — SC-5a: the name cell links to the owner-safe factsheet", () => {
  it("links a private row to /factsheet/{id} (not the category-detail dead end)", () => {
    render(
      <StrategyTable
        strategies={[privateRow()]}
        categorySlug="vis-spec"
        visibility="owner-all-statuses"
      />,
    );

    const link = within(rowFor(NAME_PRIVATE)).getByRole("link", {
      name: NAME_PRIVATE,
    });
    expect(link).toHaveAttribute("href", `/factsheet/${ID_PRIVATE}`);
  });
});

describe("StrategyTable visibility — the grid view is unreachable on the owner surface", () => {
  it("hides BOTH view-toggle buttons under visibility='owner-all-statuses'", () => {
    render(
      <StrategyTable
        strategies={[privateRow(), publishedRow()]}
        categorySlug="vis-spec"
        visibility="owner-all-statuses"
      />,
    );

    // Grid cards link to `${basePath}/${categorySlug}/${id}`, which resolves
    // through getStrategyDetail → withPublishedOnly → notFound() for an own
    // unpublished row (RESEARCH Pitfall 3). Founder ruling 2026-08-05: keep
    // grid discovery-only rather than adding a rowLinkMode.
    expect(screen.queryByLabelText("Grid view")).toBeNull();
    expect(screen.queryByLabelText("Table view")).toBeNull();
    // The table itself still renders — hiding the toggle is not hiding the view.
    expect(document.querySelector("tbody tr")).not.toBeNull();
  });

  it("keeps BOTH view-toggle buttons under the default discovery recipe", () => {
    render(
      <StrategyTable strategies={[publishedRow()]} categorySlug="vis-spec" />,
    );
    expect(screen.getByLabelText("Grid view")).toBeInTheDocument();
    expect(screen.getByLabelText("Table view")).toBeInTheDocument();
  });
});

describe("StrategyTable visibility — Phase 150: the ownership tag is OWNER-ONLY (T-150-39)", () => {
  // The failure this pair forbids is not hypothetical. Public rows reach this
  // component with `capital_ownership` POPULATED — `getStrategiesByCategory`
  // shapes them through `shapeRankingRows`, which spreads the whole strategy
  // row — so an UNGATED `<OwnershipTag>` mount renders the owner's private
  // capital declaration to anonymous /browse and /discovery readers. UI-SPEC
  // invariant 3: public surfaces show zero pixels of this phase for non-owners.
  //
  // Both labels are typed here as literals (oracle independence), never
  // imported from OwnershipTag.tsx.
  const OWN_CAPITAL_LABEL = "Own capital";
  const TEAM_REVIEW_LABEL = "Team review";

  /** The SAME row under both recipes: published AND marked own-capital. */
  const markedPublishedRow = () =>
    makeStrategy({
      id: ID_PUBLISHED,
      name: NAME_PUBLISHED,
      status: "published",
      capital_ownership: "own_capital",
    });

  it("the DEFAULT (public-shape) mount of a published + own_capital row renders NO ownership tag", () => {
    render(
      <StrategyTable strategies={[markedPublishedRow()]} categorySlug="vis-spec" />,
    );

    // The row itself must still render — otherwise this assertion is vacuous
    // for the wrong reason (a dropped row also has no tag).
    expect(screen.getByText(NAME_PUBLISHED)).toBeInTheDocument();
    expect(screen.queryByText(OWN_CAPITAL_LABEL)).toBeNull();
    expect(screen.queryByText(TEAM_REVIEW_LABEL)).toBeNull();
  });

  it("the OWNER mount of the SAME row renders it (the gate is not just 'never render')", () => {
    render(
      <StrategyTable
        strategies={[markedPublishedRow()]}
        categorySlug="vis-spec"
        visibility="owner-all-statuses"
      />,
    );

    const tag = screen.getByText(OWN_CAPITAL_LABEL);
    expect(tag).toBeInTheDocument();
    // It lands in the name cell, beside the status marker — not in some other
    // column that happens to contain the string.
    expect(within(rowFor(NAME_PUBLISHED)).getByText(OWN_CAPITAL_LABEL)).toBe(tag);
  });

  it("a team-review row shows the muted tag on the owner mount and nothing on the public one", () => {
    const teamRow = () =>
      makeStrategy({
        id: ID_PUBLISHED,
        name: NAME_PUBLISHED,
        status: "published",
        capital_ownership: "team_review",
      });

    const owner = render(
      <StrategyTable
        strategies={[teamRow()]}
        categorySlug="vis-spec"
        visibility="owner-all-statuses"
      />,
    );
    expect(screen.getByText(TEAM_REVIEW_LABEL)).toBeInTheDocument();
    owner.unmount();

    render(<StrategyTable strategies={[teamRow()]} categorySlug="vis-spec" />);
    expect(screen.queryByText(TEAM_REVIEW_LABEL)).toBeNull();
  });

  it("an UNMARKED row renders no tag even on the owner mount — absence is honest", () => {
    render(
      <StrategyTable
        strategies={[publishedRow()]}
        categorySlug="vis-spec"
        visibility="owner-all-statuses"
      />,
    );

    expect(screen.getByText(NAME_PUBLISHED)).toBeInTheDocument();
    expect(screen.queryByText(OWN_CAPITAL_LABEL)).toBeNull();
    expect(screen.queryByText(TEAM_REVIEW_LABEL)).toBeNull();
  });
});

describe("StrategyTable visibility — Phase 150: the owner row actions are prop-gated", () => {
  // Copy typed as literals (UI-SPEC Copywriting Contract).
  const MARK = "Mark ownership…";
  const CHANGE = "Change mark…";
  const RENAME = "Rename…";

  it("the DEFAULT public recipe passes neither callback and renders ZERO action nodes", () => {
    render(
      <StrategyTable strategies={[publishedRow()]} categorySlug="vis-spec" />,
    );

    expect(screen.queryByRole("button", { name: MARK })).toBeNull();
    expect(screen.queryByRole("button", { name: CHANGE })).toBeNull();
    expect(screen.queryByRole("button", { name: RENAME })).toBeNull();
  });

  it("an UNMARKED private row offers `Mark ownership…` and `Rename…`", () => {
    render(
      <StrategyTable
        strategies={[privateRow()]}
        categorySlug="vis-spec"
        visibility="owner-all-statuses"
        onMarkOwnership={() => {}}
        onRename={() => {}}
      />,
    );

    const row = rowFor(NAME_PRIVATE);
    expect(within(row).getByRole("button", { name: MARK })).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: RENAME })).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: CHANGE })).toBeNull();
  });

  it("a MARKED row offers `Change mark…` instead — the retro label names the act", () => {
    render(
      <StrategyTable
        strategies={[
          makeStrategy({
            id: ID_DRAFT,
            name: NAME_DRAFT,
            status: "draft",
            capital_ownership: "team_review",
          }),
        ]}
        categorySlug="vis-spec"
        visibility="owner-all-statuses"
        onMarkOwnership={() => {}}
        onRename={() => {}}
      />,
    );

    const row = rowFor(NAME_DRAFT);
    expect(within(row).getByRole("button", { name: CHANGE })).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: MARK })).toBeNull();
  });

  it("D-17 — a PUBLISHED own row keeps the mark action but the rename affordance is ABSENT, not disabled", () => {
    render(
      <StrategyTable
        strategies={[publishedRow()]}
        categorySlug="vis-spec"
        visibility="owner-all-statuses"
        onMarkOwnership={() => {}}
        onRename={() => {}}
      />,
    );

    const row = rowFor(NAME_PUBLISHED);
    expect(within(row).getByRole("button", { name: MARK })).toBeInTheDocument();
    // ABSENT is the contract: a disabled rename would promise a remedy that
    // does not exist (published rename is deferred), and the route answers 404.
    expect(within(row).queryByRole("button", { name: RENAME })).toBeNull();
  });

  /**
   * 151 review A1 — the ghost row actions' focus ring.
   *
   * WHY (Rule 9 — intent, not behaviour): these are borderless, underline-less
   * text buttons, so the focus ring is the ENTIRE keyboard affordance. They
   * shipped with `focus-visible:ring-accent/20`, which measures ≈1.3:1 against
   * the row — far under the WCAG 1.4.11 ≥3:1 non-text-contrast floor — so a
   * keyboard user tabbing the owner surface saw NOTHING move. Worse, they sit
   * inside the table's `overflow-x-auto` scroll container, where an outset
   * indicator is clipped at the scroll edge (WCAG 2.4.7); the in-repo Phase-117
   * / UIFIX-02 fix is an INSET ring, which paints inside the element bounds.
   *
   * The token list and the `/20` forbid are the same ones
   * `src/app/factsheet/[id]/v2/focus-ring-clipproof.test.tsx` and
   * `src/app/(dashboard)/allocations/AllocationsTabs.test.tsx` already assert —
   * this extends that pin to the Phase-150 row actions so the low-alpha ring
   * cannot come back.
   */
  const RING_TOKENS = [
    "focus-visible:outline-none",
    "focus-visible:ring-2",
    "focus-visible:ring-inset",
    "focus-visible:ring-accent",
  ] as const;

  it("[UIFIX-02] every owner row action carries the clip-proof inset ring at FULL opacity", () => {
    render(
      <StrategyTable
        strategies={[privateRow()]}
        categorySlug="vis-spec"
        visibility="owner-all-statuses"
        onMarkOwnership={() => {}}
        onRename={() => {}}
      />,
    );

    const row = rowFor(NAME_PRIVATE);
    const actions = [
      within(row).getByRole("button", { name: MARK }),
      within(row).getByRole("button", { name: RENAME }),
    ];
    // Non-vacuity: both actions really rendered, so the loop below is not
    // asserting over an empty set.
    expect(actions).toHaveLength(2);

    for (const action of actions) {
      for (const token of RING_TOKENS) {
        expect(action.className).toContain(token);
      }
      // A 20%-alpha accent ring fails WCAG 1.4.11 (≥3:1) — full opacity only.
      expect(action.className).not.toContain("ring-accent/20");
      // No OUTSET outline idiom may be reintroduced (only `-none` is allowed):
      // it paints outside the box and the scroll container clips it.
      expect(action.className).not.toMatch(
        /focus-visible:outline-(?!none)(offset|2|4|accent|\[)/,
      );
      // The ring needs a radius to follow, or it draws a square inside a
      // rounded row and reads as a rendering artefact rather than focus.
      expect(action.className).toContain("rounded-sm");
    }
  });

  it("clicking an action hands the callback the ROW it belongs to", () => {
    const onMarkOwnership = vi.fn();
    render(
      <StrategyTable
        strategies={[privateRow(), publishedRow()]}
        categorySlug="vis-spec"
        visibility="owner-all-statuses"
        onMarkOwnership={onMarkOwnership}
      />,
    );

    within(rowFor(NAME_PRIVATE))
      .getByRole("button", { name: MARK })
      .click();

    expect(onMarkOwnership).toHaveBeenCalledTimes(1);
    expect(onMarkOwnership.mock.calls[0][0]).toMatchObject({
      id: ID_PRIVATE,
      name: NAME_PRIVATE,
    });
  });
});

describe("StrategyTable visibility — Simulate Impact is gated on status", () => {
  it("renders the Simulate button ONLY on the published row of an owner-scoped table", () => {
    render(
      <StrategyTable
        strategies={[privateRow(), publishedRow()]}
        categorySlug="vis-spec"
        visibility="owner-all-statuses"
        portfolioId="p-1"
      />,
    );

    // analytics-service/routers/simulator.py:287-290 fetches the candidate with
    // `.eq("status","published")` and rejects anything else — a button on an own
    // draft row would fail on every click (no-disabled-buttons UAT direction).
    expect(screen.getAllByTestId("simulate-probe")).toHaveLength(1);
    expect(
      within(rowFor(NAME_PUBLISHED)).getByTestId("simulate-probe"),
    ).toBeInTheDocument();
    expect(
      within(rowFor(NAME_PRIVATE)).queryByTestId("simulate-probe"),
    ).toBeNull();
  });

  it("still renders the Simulate button on every row of the default discovery recipe", () => {
    render(
      <StrategyTable
        strategies={[publishedRow(), makeStrategy({ id: ID_DRAFT, name: NAME_DRAFT })]}
        categorySlug="vis-spec"
        portfolioId="p-1"
      />,
    );
    // Both rows are published here (the second uses the factory default), so the
    // gate is behavior-invariant on the public surfaces.
    expect(screen.getAllByTestId("simulate-probe")).toHaveLength(2);
  });
});
