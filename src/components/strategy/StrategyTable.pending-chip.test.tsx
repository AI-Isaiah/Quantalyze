/**
 * Phase 149 / Plan 149-03 / NAV-01 — the owner-surface row treatments:
 * Delta 3 (status marker), Delta 4 (honest pending chip) and Delta 5
 * (unranked placeholder rows for strategy-less keys).
 *
 * Written RED-FIRST against the post-plan-01 StrategyTable. Every fixture here
 * is a REAL pipeline state — never the impossible `computed_at: null` +
 * `computation_status: "pending"` shape:
 *
 *   - a LIVE job (`pending`/`computing`) carries a `computed_at` DEFAULT, so any
 *     chip gated on `!computed_at` never fires for the state it was meant to
 *     catch (checker defect B-2);
 *   - a NEVER-ENQUEUED strategy has NO `strategy_analytics` row at all, and
 *     plan 02's shaper substitutes `EMPTY_ANALYTICS`
 *     (`computation_status: "pending"`, `computed_at: ""`). Reading that status
 *     raw spins "Syncing" FOREVER (checker defect B-1). The absent-row signal
 *     survives as `analyticsPresent: false`; coercing it to a null status lets
 *     the 16h `MISSING_ROW_COMPUTING_WINDOW_MS` bound inside
 *     `deriveEmptySeriesState` terminate the spinner at "No data".
 *
 * `categorySlug="chip-spec"` is deliberate: StrategyTable.test.tsx documents a
 * CI flake where `discovery_view_preferences:u-1:crypto-sma` leaks across files
 * through the shared jsdom localStorage (`:122-138`). A distinct slug cannot
 * collide with that key.
 *
 * StrategyTable.test.tsx is NOT edited (it is a pinned-literal surface whose
 * factory hard-codes `status: "published"` at `:89`); its factories are cloned
 * here with ONE correction — `analytics` / `analyticsPresent` overrides are
 * merged AFTER the spread, because the original applies `...overrides` BEFORE
 * its trailing `analytics: makeAnalytics(...)` and therefore silently CLOBBERS
 * any analytics override passed in (checker note I-1).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { StrategyTable } from "./StrategyTable";
import type { Strategy, StrategyAnalytics } from "@/lib/types";
import { installFetchMock, restoreFetchMock } from "@/test/helpers/fetch";

type Row = Strategy & {
  analytics: StrategyAnalytics;
  analyticsPresent?: boolean;
};

// --- Copy literals (149-UI-SPEC Copywriting Contract) ---------------------
// Pinned as constants so a stray dash substitution in the implementation
// reddens here instead of shipping. NOTE the two DIFFERENT dashes: an EN dash
// (U+2013) inside "10–15", an EM dash (U+2014) joining the aria-label clauses.
const SYNCING_TITLE = "First metrics arrive in ~10–15 min";
const SYNCING_ARIA = "Syncing — first metrics arrive in ~10–15 min";
const EM_DASH = "—";

// --- Fixtures ------------------------------------------------------------

const ID_PRIVATE = "33333333-0000-4000-8000-000000000001";
const ID_DRAFT = "33333333-0000-4000-8000-000000000002";
const ID_PUBLISHED = "33333333-0000-4000-8000-000000000003";
const ID_SUBJECT = "33333333-0000-4000-8000-000000000004";

const NAME_PRIVATE = "Nebula One";
const NAME_DRAFT = "Quasar Two";
const NAME_PUBLISHED = "Pulsar Three";
const NAME_SUBJECT = "Vela Four";

const HOUR_MS = 60 * 60 * 1000;

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

/** Every metric null — the shape a row with no computed run really has. */
const NO_METRICS: Partial<StrategyAnalytics> = {
  cumulative_return: null,
  cagr: null,
  volatility: null,
  sharpe: null,
  sortino: null,
  calmar: null,
  max_drawdown: null,
  max_drawdown_duration_days: null,
  six_month_return: null,
  sparkline_returns: null,
  sparkline_drawdown: null,
};

/**
 * The literal `EMPTY_ANALYTICS` shape plan 02's shaper substitutes when NO
 * `strategy_analytics` row exists (src/lib/utils.ts:178). Inlined rather than
 * imported so this spec stays a falsifier: if that constant is ever "fixed" to
 * carry a null status, the B-1 case here must still red on the old behaviour.
 */
function emptyAnalytics(strategyId: string): StrategyAnalytics {
  return makeAnalytics({
    id: "",
    strategy_id: strategyId,
    computed_at: "",
    computation_status: "pending",
    ...NO_METRICS,
  });
}

function makeStrategy(
  overrides: Partial<Row> & { id: string; name: string },
): Row {
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
    // ⚠️ AFTER the spread (checker I-1): StrategyTable.test.tsx:93-94 applies
    // `...overrides` first and then unconditionally overwrites `analytics`,
    // so an analytics override passed to THAT factory is silently discarded.
    analytics: makeAnalytics({
      strategy_id: overrides.id,
      ...(overrides.analytics ?? {}),
    }),
    analyticsPresent: overrides.analyticsPresent ?? true,
  };
}

/** A row with a LIVE analytics job: real status, real computed_at default. */
function jobRunningRow(overrides?: Partial<Row>): Row {
  return makeStrategy({
    id: ID_SUBJECT,
    name: NAME_SUBJECT,
    status: "private",
    aum: null,
    analyticsPresent: true,
    analytics: makeAnalytics({
      computation_status: "computing",
      computed_at: new Date().toISOString(),
      ...NO_METRICS,
    }),
    ...overrides,
  });
}

/** A row whose analytics job was NEVER enqueued (no strategy_analytics row). */
function neverEnqueuedRow(ageMs: number): Row {
  return makeStrategy({
    id: ID_SUBJECT,
    name: NAME_SUBJECT,
    status: "private",
    aum: null,
    created_at: new Date(Date.now() - ageMs).toISOString(),
    analyticsPresent: false,
    analytics: emptyAnalytics(ID_SUBJECT),
  });
}

const privateRow = () =>
  makeStrategy({ id: ID_PRIVATE, name: NAME_PRIVATE, status: "private" });
const draftRow = () =>
  makeStrategy({ id: ID_DRAFT, name: NAME_DRAFT, status: "draft" });
const publishedRow = () =>
  makeStrategy({ id: ID_PUBLISHED, name: NAME_PUBLISHED, status: "published" });

// --- Module mocks --------------------------------------------------------

// Leaf that pulls in client-only modules; it has no bearing on the row
// treatments under test.
vi.mock("@/components/discovery/SimulateImpactButton", () => ({
  SimulateImpactButton: () => null,
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

/** The <tr> whose text contains `name`. */
function rowFor(name: string): HTMLElement {
  const row = Array.from(document.querySelectorAll("tbody tr")).find((tr) =>
    (tr.textContent ?? "").includes(name),
  );
  if (!row) throw new Error(`no rendered row for "${name}"`);
  return row as HTMLElement;
}

/** All <td> elements of a row, in DOM order. */
function cells(row: HTMLElement): HTMLTableCellElement[] {
  return Array.from(row.querySelectorAll("td"));
}

function cellText(row: HTMLElement, index: number): string {
  return (cells(row)[index]?.textContent ?? "").trim();
}

/** The visible metric cells of a 13-td row: Return, CAGR, Sharpe, Max DD, Vol, 6M, AUM. */
const METRIC_CELL_INDEXES = [2, 3, 4, 5, 6, 7, 8];

function chipIn(row: HTMLElement, label: string): HTMLElement | null {
  return (
    Array.from(row.querySelectorAll("span")).find(
      (el) => (el.textContent ?? "").trim() === label,
    ) ?? null
  );
}

// =========================================================================
// Delta 3 — status marker on non-published own rows
// =========================================================================

describe("StrategyTable Delta 3 — SC-4b status marker", () => {
  it("renders a muted 'Private' marker on a private row", () => {
    render(
      <StrategyTable
        strategies={[privateRow()]}
        categorySlug="chip-spec"
        visibility="owner-all-statuses"
      />,
    );

    const marker = within(rowFor(NAME_PRIVATE)).getByText("Private");
    expect(marker).toBeInTheDocument();
    expect(marker.className).toContain("text-text-muted");
    // Absence of publication is a FACT, not an error (DESIGN.md semantic-color
    // gate + 149-UI-SPEC Delta 3): never red, never amber.
    expect(marker.className).not.toContain("text-negative");
    expect(marker.className).not.toContain("text-warning");
  });

  it("renders a 'Draft' marker on a draft row", () => {
    render(
      <StrategyTable
        strategies={[draftRow()]}
        categorySlug="chip-spec"
        visibility="owner-all-statuses"
      />,
    );

    const marker = within(rowFor(NAME_DRAFT)).getByText("Draft");
    expect(marker).toBeInTheDocument();
    expect(marker.className).not.toContain("text-negative");
    expect(marker.className).not.toContain("text-warning");
  });

  it("renders NO marker on a published own row (absence of a marker = published)", () => {
    render(
      <StrategyTable
        strategies={[publishedRow()]}
        categorySlug="chip-spec"
        visibility="owner-all-statuses"
      />,
    );

    const row = rowFor(NAME_PUBLISHED);
    expect(within(row).queryByText("Published")).toBeNull();
    expect(within(row).queryByText("Private")).toBeNull();
    expect(within(row).queryByText("Draft")).toBeNull();
  });
});

// =========================================================================
// Delta 4 — honest pending chip
// =========================================================================

describe("StrategyTable Delta 4 — SC-4a honest pending chip", () => {
  it("shows the amber Syncing chip for a LIVE job — the falsifier for any !computed_at gate", () => {
    render(
      <StrategyTable
        strategies={[jobRunningRow()]}
        categorySlug="chip-spec"
        visibility="owner-all-statuses"
      />,
    );

    const row = rowFor(NAME_SUBJECT);
    const chip = chipIn(row, "Syncing");
    expect(chip).not.toBeNull();
    expect(chip!.getAttribute("title")).toBe(SYNCING_TITLE);
    expect(chip!.getAttribute("aria-label")).toBe(SYNCING_ARIA);
    expect(chip!.className).toContain("bg-warning-bg");
    // 147 chip BASE verbatim — rounded-sm (4px) is DELIBERATE against the
    // adjacent status Badge's rounded-md; do NOT harmonize (149-UI-SPEC).
    expect(chip!.className).toContain("rounded-sm");
    expect(chip!.className).toContain("text-fixed-11");
    expect(chip!.className).not.toContain("text-negative");

    // Never zeros — the em-dash rule is load-bearing (Numbers Contract / SC-4).
    for (const i of METRIC_CELL_INDEXES) {
      expect(cellText(row, i)).toContain(EM_DASH);
    }
    expect(row.textContent).not.toContain("0.00");
    expect(row.textContent).not.toContain("+0.0%");

    // W-B: a live job carries a computed_at DEFAULT, so the unconditional
    // SyncBadge would render "Synced just now" right beside a Syncing chip —
    // two contradictory claims in one cell. On the owner surface the badge
    // renders only for a row with computed metrics.
    expect(document.body.textContent).not.toMatch(/Synced/);
  });

  it("shows Syncing for a NEVER-ENQUEUED row inside the 16h window", () => {
    render(
      <StrategyTable
        strategies={[neverEnqueuedRow(HOUR_MS)]}
        categorySlug="chip-spec"
        visibility="owner-all-statuses"
      />,
    );

    expect(chipIn(rowFor(NAME_SUBJECT), "Syncing")).not.toBeNull();
  });

  it("shows 'No data' for a NEVER-ENQUEUED row PAST the 16h window (the B-1 falsifier)", () => {
    // EMPTY_ANALYTICS hardcodes `computation_status: "pending"`. Any derivation
    // that reads it RAW spins Syncing forever for a strategy whose job was
    // never enqueued. `analyticsPresent: false` must coerce the status to null
    // so deriveEmptySeriesState's MISSING_ROW_COMPUTING_WINDOW_MS bound applies.
    render(
      <StrategyTable
        strategies={[neverEnqueuedRow(17 * HOUR_MS)]}
        categorySlug="chip-spec"
        visibility="owner-all-statuses"
      />,
    );

    const row = rowFor(NAME_SUBJECT);
    expect(chipIn(row, "Syncing")).toBeNull();
    const chip = chipIn(row, "No data");
    expect(chip).not.toBeNull();
    expect(chip!.className).toContain("bg-track");
    expect(chip!.className).toContain("text-text-muted");
  });

  it("shows a MUTED 'No data' chip for a failed job — never red, row still clickable", () => {
    const failed = makeStrategy({
      id: ID_SUBJECT,
      name: NAME_SUBJECT,
      status: "private",
      aum: null,
      analyticsPresent: true,
      analytics: makeAnalytics({
        computation_status: "failed",
        computed_at: new Date().toISOString(),
        computation_error: "worker exploded",
        ...NO_METRICS,
      }),
    });

    render(
      <StrategyTable
        strategies={[failed]}
        categorySlug="chip-spec"
        visibility="owner-all-statuses"
      />,
    );

    const row = rowFor(NAME_SUBJECT);
    const chip = chipIn(row, "No data");
    expect(chip).not.toBeNull();
    // Absence ≠ error: DESIGN.md reserves red for permanent/negative, and a
    // failed run is retried by the system — the honest reading is "no data".
    expect(chip!.className).toContain("bg-track");
    expect(chip!.className).not.toContain("text-negative");
    expect(chip!.className).not.toContain("bg-warning-bg");

    for (const i of METRIC_CELL_INDEXES) {
      expect(cellText(row, i)).toContain(EM_DASH);
    }

    const link = row.querySelector("a");
    expect(link?.getAttribute("href")).toBe(`/factsheet/${ID_SUBJECT}`);
  });

  it("shows NO chip for a computed row", () => {
    render(
      <StrategyTable
        strategies={[privateRow()]}
        categorySlug="chip-spec"
        visibility="owner-all-statuses"
      />,
    );

    const row = rowFor(NAME_PRIVATE);
    expect(chipIn(row, "Syncing")).toBeNull();
    expect(chipIn(row, "No data")).toBeNull();
  });

  it("W-C: an OMITTED analyticsPresent means 'trust the status' — computed row keeps its SyncBadge", () => {
    // Only the EXPLICIT `false` (the absent-row signal) coerces. An omitted
    // optional field carries NO signal, so a `complete` row must behave exactly
    // as it does on the public surfaces. The owner path cannot omit it — plan
    // 04 types the section prop as RankedStrategyRow[] (required there).
    const row: Row = {
      ...privateRow(),
      id: ID_SUBJECT,
      name: NAME_SUBJECT,
    };
    delete row.analyticsPresent;

    render(
      <StrategyTable
        strategies={[row]}
        categorySlug="chip-spec"
        visibility="owner-all-statuses"
      />,
    );

    const rendered = rowFor(NAME_SUBJECT);
    expect(chipIn(rendered, "Syncing")).toBeNull();
    expect(chipIn(rendered, "No data")).toBeNull();
    expect(rendered.textContent).toMatch(/Synced/);
  });

  it("public invariance: the SAME live-job row renders NO chip under the default recipe", () => {
    // /discovery and /browse pass no visibility prop. A published row awaiting
    // a recompute must not be SHOUTED at on a public surface — no chip, no
    // marker, nothing red (the 149-UI-SPEC States invariant). That half is
    // unchanged and is what this case still guards.
    //
    // ⚠️ CORRECTED IN STALE-01 (2026-08-25). This case used to ALSO assert
    // `expect(row.textContent).toMatch(/Synced/)` under the comment "the public
    // SyncBadge render site stays UNCONDITIONAL". That assertion pinned a
    // FALSE claim, and it is now inverted below.
    //
    // Why it was wrong: "no chip" and "a Synced date" are not the same
    // invariant. 149 ruled that public surfaces must not display an ERROR
    // about a manager's strategy; it never licensed displaying a sync
    // timestamp for a computation that has not synced. The SQL status bridge
    // re-stamps `computed_at = now()` on the `computing` and `failed` branches
    // (migration 20260710150000_sync_status_supersede_failed_per_kind.sql:125
    // / :179), so on this fixture the badge printed "Synced just now" for a run
    // that had produced nothing at all. Suppressing it removes a false claim;
    // it adds no UI, so the 149 invariant survives intact — the row simply
    // says LESS, which is the honest direction.
    render(
      <StrategyTable
        strategies={[jobRunningRow({ status: "published" })]}
        categorySlug="chip-spec"
      />,
    );

    const row = rowFor(NAME_SUBJECT);
    expect(chipIn(row, "Syncing")).toBeNull();
    expect(chipIn(row, "No data")).toBeNull();
    // ...and the row makes NO sync claim it cannot support. Anonymous visitors
    // are the audience least able to check this, so the honesty rule must
    // apply to them at least as hard as it does to the owner (:348).
    expect(row.textContent).not.toMatch(/Synced/);
  });
});

// =========================================================================
// Delta 5 — unranked placeholder rows for strategy-less keys
// =========================================================================

const PLACEHOLDER_KEYS = [
  { id: "k1", exchangeLabel: "Deribit", keyLabel: "Zavara main" },
  { id: "k2", exchangeLabel: "MT5", keyLabel: "Acct 7001" },
];

const FILTER_EMPTY_COPY = "No strategies match your filters.";

/** Every rendered <tr> in the tbody, in DOM order. */
function bodyRows(): HTMLElement[] {
  return Array.from(document.querySelectorAll("tbody tr"));
}

function placeholderRows(): HTMLElement[] {
  return bodyRows().filter((tr) =>
    tr.className.includes("bg-surface-subtle"),
  );
}

function indexOfRowContaining(text: string): number {
  return bodyRows().findIndex((tr) => (tr.textContent ?? "").includes(text));
}

describe("StrategyTable Delta 5 — unranked placeholder rows for bare keys", () => {
  it("renders one subordinate placeholder row per bare key BELOW the ranked rows, outside #n numbering", () => {
    render(
      <StrategyTable
        strategies={[privateRow(), draftRow()]}
        categorySlug="chip-spec"
        visibility="owner-all-statuses"
        placeholderKeys={PLACEHOLDER_KEYS}
        onFinishSetup={() => {}}
      />,
    );

    const placeholders = placeholderRows();
    expect(placeholders).toHaveLength(2);

    // Subordination: they come AFTER every ranked row.
    const rows = bodyRows();
    const lastRankedIndex = Math.max(
      rows.indexOf(rowFor(NAME_PRIVATE)),
      rows.indexOf(rowFor(NAME_DRAFT)),
    );
    for (const p of placeholders) {
      expect(rows.indexOf(p)).toBeGreaterThan(lastRankedIndex);
    }

    // Placeholders are OUTSIDE the ranking: em-dash rank cell, never a #.
    for (const p of placeholders) {
      expect(cellText(p, 0)).toBe(EM_DASH);
      expect(cellText(p, 0)).not.toMatch(/#/);
    }

    // ...and the ranked rows above are numbered as if placeholders did not
    // exist (they never enter `filtered`, so they cannot shift #n).
    expect(cellText(rowFor(NAME_PRIVATE), 0)).toMatch(/#[12]/);
    expect(cellText(rowFor(NAME_DRAFT), 0)).toMatch(/#[12]/);
    const ranks = [
      cellText(rowFor(NAME_PRIVATE), 0),
      cellText(rowFor(NAME_DRAFT), 0),
    ].sort();
    expect(ranks).toEqual(["#1", "#2"]);
  });

  it("W-1: a placeholder row's <td> count equals the header <th> count (column-drift falsifier)", () => {
    render(
      <StrategyTable
        strategies={[privateRow()]}
        categorySlug="chip-spec"
        visibility="owner-all-statuses"
        placeholderKeys={PLACEHOLDER_KEYS}
        onFinishSetup={() => {}}
      />,
    );

    const headerCount = document.querySelectorAll("thead th").length;
    // No star column on this surface (no userId prop): rank + 8 COLUMNS +
    // Return spark + Underwater spark + Details + Actions = 13.
    expect(headerCount).toBe(13);
    // Guard against a vacuous pass: the loop below must actually iterate.
    expect(placeholderRows()).toHaveLength(2);

    for (const p of placeholderRows()) {
      expect(cells(p)).toHaveLength(13);
      // If a column is ever added to the header, this reddens instead of the
      // placeholder rows silently misaligning against the ranked rows.
      expect(cells(p).length).toBe(headerCount);
    }
    // Same skeleton as a ranked row on this surface.
    expect(cells(rowFor(NAME_PRIVATE))).toHaveLength(headerCount);
  });

  it("names the key as '{exchange} · {label}' with NO factsheet link and a muted 'No strategy yet' chip", () => {
    render(
      <StrategyTable
        strategies={[privateRow()]}
        categorySlug="chip-spec"
        visibility="owner-all-statuses"
        placeholderKeys={PLACEHOLDER_KEYS}
        onFinishSetup={() => {}}
      />,
    );

    const first = placeholderRows()[0];
    const nameCell = cells(first)[1];
    expect(nameCell.textContent).toContain("Deribit · Zavara main");
    // No strategy exists, so there is no factsheet to link to. A link here
    // would be a dead end (and, for a stranger's guessed id, an oracle).
    expect(nameCell.querySelector("a")).toBeNull();

    const chip = chipIn(first, "No strategy yet");
    expect(chip).not.toBeNull();
    expect(chip!.className).toContain("bg-track");
    expect(chip!.className).toContain("text-text-muted");
    expect(chip!.className).not.toContain("text-negative");
    expect(chip!.className).not.toContain("bg-warning-bg");

    expect(within(placeholderRows()[1]).getByText(/MT5 · Acct 7001/)).toBeInTheDocument();
  });

  it("renders em-dash, untinted metric cells — never a fabricated zero", () => {
    render(
      <StrategyTable
        strategies={[privateRow()]}
        categorySlug="chip-spec"
        visibility="owner-all-statuses"
        placeholderKeys={PLACEHOLDER_KEYS}
        onFinishSetup={() => {}}
      />,
    );

    // Guard against a vacuous pass: the loop below must actually iterate.
    expect(placeholderRows()).toHaveLength(2);

    for (const p of placeholderRows()) {
      for (const i of METRIC_CELL_INDEXES) {
        expect(cellText(p, i)).toBe(EM_DASH);
        const tinted = cells(p)[i].querySelector(
          ".text-positive, .text-negative",
        );
        expect(tinted).toBeNull();
      }
      expect(p.textContent).not.toContain("0.00");
      expect(p.textContent).not.toContain("+0.0%");
    }
  });

  it("fires onFinishSetup exactly once from a real <button>, not a link into /strategies", () => {
    const onFinishSetup = vi.fn();
    render(
      <StrategyTable
        strategies={[privateRow()]}
        categorySlug="chip-spec"
        visibility="owner-all-statuses"
        placeholderKeys={PLACEHOLDER_KEYS}
        onFinishSetup={onFinishSetup}
      />,
    );

    const buttons = screen.getAllByRole("button", { name: /Finish setup/ });
    expect(buttons).toHaveLength(2);
    // A <Link> into the manager-guarded /strategies subtree would
    // redirect-bounce an allocator; the wizard opens in place instead.
    expect(buttons[0].tagName).toBe("BUTTON");

    fireEvent.click(buttons[0]);
    expect(onFinishSetup).toHaveBeenCalledTimes(1);
  });

  it("public invariance: with placeholderKeys omitted, zero subordinate rows render", () => {
    render(
      <StrategyTable strategies={[publishedRow()]} categorySlug="chip-spec" />,
    );

    expect(placeholderRows()).toHaveLength(0);
    expect(screen.queryByText(/Finish setup/)).toBeNull();
    expect(screen.queryByText("No strategy yet")).toBeNull();
    expect(bodyRows()).toHaveLength(1);
  });

  it("a strategy-less account gets placeholders and NO misleading filter message", () => {
    render(
      <StrategyTable
        strategies={[]}
        categorySlug="chip-spec"
        visibility="owner-all-statuses"
        placeholderKeys={PLACEHOLDER_KEYS}
        onFinishSetup={() => {}}
      />,
    );

    // Nothing was filtered out — saying so would be a lie.
    expect(screen.queryByText(FILTER_EMPTY_COPY)).toBeNull();
    expect(placeholderRows()).toHaveLength(2);
  });

  it("W-5: an active filter that matches nothing shows the message ABOVE the placeholders", () => {
    render(
      <StrategyTable
        strategies={[privateRow(), draftRow(), publishedRow()]}
        categorySlug="chip-spec"
        visibility="owner-all-statuses"
        placeholderKeys={PLACEHOLDER_KEYS}
        onFinishSetup={() => {}}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("Search strategies..."), {
      target: { value: "zzz-no-such-strategy" },
    });

    // The ranked set really was filtered to nothing, so the message is honest.
    const messageIndex = indexOfRowContaining(FILTER_EMPTY_COPY);
    expect(messageIndex).toBeGreaterThanOrEqual(0);

    // Placeholders are NOT filter results — they are key-coverage rows,
    // unaffected by search/filters — so they sit BELOW the message.
    const rows = bodyRows();
    const placeholders = placeholderRows();
    expect(placeholders).toHaveLength(2);
    for (const p of placeholders) {
      expect(rows.indexOf(p)).toBeGreaterThan(messageIndex);
    }
  });
});
