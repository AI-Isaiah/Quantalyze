/**
 * Phase 170.6.2 / Plan 02 / D-06 (SC-3) — the anonymous /browse example flash.
 *
 * WHY THIS FILE EXISTS. `showExamples` used to start `true`. For a mount with
 * no `userId`, `useDiscoveryPrefs` hydrates at once, so the prefs-mirror effect
 * fired on the first mount and set `showExamples` from `DEFAULTS.hide_examples`
 * (true => examples hidden). The server HTML and the first client paint
 * therefore carried example rows that vanished one commit later: an anonymous
 * visitor watched the list change under them. The fix starts the state where
 * the effect would land, so SSR, the first paint and every later commit agree.
 *
 * What a reader would be hurt by losing, in order:
 *   A. FIRST PAINT. `renderToString` runs render but no effects, exactly as
 *      Next's SSR pass does. The HTML of an anonymous mount holds no example
 *      row (and does hold the ordinary one, so the render is not blank).
 *   B. EVERY COMMIT. A Profiler `onRender` fires once per commit with the DOM
 *      already mutated. The example-row count must never go from >0 to 0. This
 *      catches a flash that SSR alone cannot see (a client-only first commit).
 *   C. THE INVERSE GUARD. A `managerRows` mount (170.7 SFH-1) is the owner's
 *      own list: every row is theirs, so their `is_example` row must still show
 *      on first paint. This bites a fix that forgets the `managerRows` arm.
 *
 * Names are SINGLE WORDS on purpose: the table renders each word of a name as
 * its own span, so a multi-word name is not a plain substring of the HTML.
 * `categorySlug` values are distinct from every sibling file because the prefs
 * key reads the shared jsdom localStorage.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Profiler, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { act, render } from "@testing-library/react";
import { StrategyTable } from "./StrategyTable";
import type { Strategy, StrategyAnalytics } from "@/lib/types";
import { installFetchMock, restoreFetchMock } from "@/test/helpers/fetch";

type Row = Strategy & { analytics: StrategyAnalytics };

const NAME_PLAIN = "Plainrow";
const NAME_EXAMPLE = "Exampleonly";

vi.mock("@/components/discovery/SimulateImpactButton", () => ({
  SimulateImpactButton: () => <span data-testid="simulate-probe" />,
}));

function makeAnalytics(overrides?: Partial<StrategyAnalytics>): StrategyAnalytics {
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
    trades_fetched_at: null,
    ...overrides,
  };
}

function makeStrategy(
  overrides: Partial<Strategy> & { id: string; name: string },
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
    analytics: makeAnalytics({ strategy_id: overrides.id }),
  };
}

const ROWS: Row[] = [
  makeStrategy({ id: "ef-0000-0001", name: NAME_PLAIN }),
  makeStrategy({ id: "ef-0000-0002", name: NAME_EXAMPLE, is_example: true }),
];

const managerRows = Object.fromEntries(
  ROWS.map((r) => [
    r.id,
    {
      editHref: `/strategies/${r.id}/edit`,
      actions: <span data-testid={`slot-${r.id}`}>slot</span>,
    },
  ]),
);

function count(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

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

/**
 * Mounts `ui` under a Profiler and records, per commit, how many times the
 * example name occurs in the live DOM. `onRender` fires inside the first
 * commit, before `render()` returns, so the container is created and attached
 * first and read through the closure (never through render's return value).
 */
async function exampleCountPerCommit(ui: ReactNode): Promise<{
  counts: number[];
  finalText: string;
}> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const counts: number[] = [];
  try {
    await act(async () => {
      render(
        <Profiler
          id="probe"
          onRender={() => {
            counts.push(count(container.textContent ?? "", NAME_EXAMPLE));
          }}
        >
          {ui}
        </Profiler>,
        { container },
      );
    });
    return { counts, finalText: container.textContent ?? "" };
  } finally {
    container.remove();
  }
}

function neverFlashesAway(counts: number[]): boolean {
  return counts.every((c, i) => !(i > 0 && counts[i - 1] > 0 && c === 0));
}

describe("StrategyTable examples first paint (170.6.2 D-06)", () => {
  it("A: an anonymous mount's server HTML carries no example row", () => {
    const html = renderToString(
      <StrategyTable strategies={ROWS} categorySlug="flash-spec" />,
    );
    // Positive control: the render produced rows at all.
    expect(count(html, NAME_PLAIN)).toBeGreaterThan(0);
    expect(count(html, NAME_EXAMPLE)).toBe(0);
  });

  it("B: an anonymous mount never shows an example row that then vanishes (per commit)", async () => {
    const { counts, finalText } = await exampleCountPerCommit(
      <StrategyTable strategies={ROWS} categorySlug="flash-spec-b" />,
    );
    expect(counts.length).toBeGreaterThan(0);
    expect(
      neverFlashesAway(counts),
      `example count per commit: ${JSON.stringify(counts)}`,
    ).toBe(true);
    expect(count(finalText, NAME_EXAMPLE)).toBe(0);
    // Non-vacuity: the table did render its ordinary row.
    expect(count(finalText, NAME_PLAIN)).toBeGreaterThan(0);
  });

  it("B: a signed-in /discovery mount with no saved preference settles hidden and never flashes", async () => {
    const { counts, finalText } = await exampleCountPerCommit(
      <StrategyTable strategies={ROWS} categorySlug="flash-spec-c" userId="u-1" />,
    );
    expect(counts.length).toBeGreaterThan(0);
    expect(
      neverFlashesAway(counts),
      `example count per commit: ${JSON.stringify(counts)}`,
    ).toBe(true);
    expect(count(finalText, NAME_EXAMPLE)).toBe(0);
    expect(count(finalText, NAME_PLAIN)).toBeGreaterThan(0);
  });

  it("C: a managerRows mount still shows the owner's own example row on first paint and after effects", async () => {
    const html = renderToString(
      <StrategyTable
        strategies={ROWS}
        categorySlug="mgr-spec-flash"
        visibility="owner-all-statuses"
        managerRows={managerRows}
      />,
    );
    expect(count(html, NAME_EXAMPLE)).toBeGreaterThan(0);
    expect(count(html, NAME_PLAIN)).toBeGreaterThan(0);

    const { finalText } = await exampleCountPerCommit(
      <StrategyTable
        strategies={ROWS}
        categorySlug="mgr-spec-flash-b"
        visibility="owner-all-statuses"
        managerRows={managerRows}
      />,
    );
    expect(count(finalText, NAME_EXAMPLE)).toBeGreaterThan(0);
  });
});
