/** @vitest-environment jsdom */
/**
 * STALE-01 part 2 — the allocator's portfolio breakdown is a CROSS-TENANT read.
 *
 * Every constituent of an allocator's portfolio is ANOTHER manager's published
 * strategy, so this table reads exactly the rows the production census found
 * dead on 2026-08-25: of 18 published strategies, 1 terminal-success and 17 at
 * `computation_status = 'failed'` while still carrying cagr / sharpe /
 * max_drawdown and a non-null `computed_at`.
 *
 * `getPortfolioStrategies` (lib/queries.ts) has ALWAYS projected
 * `computation_status` on this embed. This component simply never read it —
 * which is the recurring shape of the whole defect class: the column is
 * selected, and then never filtered.
 *
 * THE SYNC BADGE IS THE SHARPER HALF. B14 added the per-row `SyncBadge` so a
 * mixed-freshness portfolio could not present stale per-strategy metrics as
 * current. But on a `failed` row the SQL status bridge re-stamps `computed_at =
 * now()` (migration 20260710150000:179), so the badge read "Synced just now" at
 * the moment the sync FAILED. The honesty device was reporting the opposite of
 * the truth.
 *
 * ANTI-VACUITY: the dead row carries best-in-class values with unique rendered
 * strings and a `computed_at` of NOW, and a terminal-success control row sits
 * beside it in the SAME table asserting each of those strings IS rendered. So
 * no assertion can pass on an empty table, and none can pass by blanking
 * everything.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import React from "react";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement("a", { href }, children),
}));

import { StrategyBreakdownTable } from "./StrategyBreakdownTable";

const DEAD_ID = "51a10001-0000-4000-8000-00000000000d";
const LIVE_ID = "51a10001-0000-4000-8000-00000000000e";

/** Best-in-class stale figures — each renders a UNIQUE string. */
const STALE_TEXT = {
  twr: "+66.12%",
  sharpe: "3.77",
  max_dd: "-3.11%",
} as const;

/** The control's figures — deliberately modest, and equally unique. */
const LIVE_TEXT = {
  twr: "+5.00%",
  sharpe: "0.60",
  max_dd: "-40.00%",
} as const;

function constituent(
  id: string,
  name: string,
  status: string,
  kpis: { cagr: number; sharpe: number; max_drawdown: number },
) {
  return {
    strategy_id: id,
    current_weight: 0.5,
    strategies: {
      id,
      name,
      strategy_analytics: {
        ...kpis,
        volatility: 0.2,
        // Re-stamped to the moment of FAILURE by the SQL status bridge, which
        // is what made the badge read "Synced just now".
        computed_at: new Date().toISOString(),
        computation_status: status,
      },
    },
  };
}

const DEAD = (status = "failed") =>
  constituent(DEAD_ID, "Orpheus", status, {
    cagr: 0.6612,
    sharpe: 3.77,
    max_drawdown: -0.0311,
  });

const LIVE = (status = "complete") =>
  constituent(LIVE_ID, "Meridian", status, {
    cagr: 0.05,
    sharpe: 0.6,
    max_drawdown: -0.4,
  });

function renderTable(rows: ReturnType<typeof constituent>[]) {
  render(
    <StrategyBreakdownTable
      strategies={rows}
      attribution={[
        { strategy_id: DEAD_ID, contribution: 0.11 },
        { strategy_id: LIVE_ID, contribution: 0.02 },
      ] as never}
      portfolioId="00000000-0000-4000-8000-0000000000ff"
    />,
  );
}

/** The <tr> whose first cell links to the given strategy. */
function rowFor(name: string): HTMLElement {
  const link = screen.getByText(name);
  const tr = link.closest("tr");
  expect(tr, `no row rendered for ${name}`).not.toBeNull();
  return tr as HTMLElement;
}

describe("STALE-01 · StrategyBreakdownTable — cross-tenant constituents", () => {
  it("P1: a `failed` constituent shows em-dashes where its dead figures were", () => {
    renderTable([DEAD(), LIVE()]);
    const dead = within(rowFor("Orpheus"));

    for (const [metric, text] of Object.entries(STALE_TEXT)) {
      expect(
        dead.queryByText(text),
        `${metric} (${text}) from a failed run leaked into the breakdown`,
      ).toBeNull();
    }
    // Three em-dashes: TWR, Sharpe, Max DD. Weight and contribution keep theirs.
    expect(dead.getAllByText("—").length).toBe(3);
  });

  it("P2: the SyncBadge makes no claim — `computed_at` on a failed row dates the FAILURE", () => {
    renderTable([DEAD(), LIVE()]);

    expect(within(rowFor("Orpheus")).queryByText(/Synced/)).toBeNull();
    // …and it is not simply absent everywhere: the control still carries one.
    expect(within(rowFor("Meridian")).getByText(/Synced/)).toBeTruthy();
  });

  it("P3: weight and contribution survive — neither is a product of the strategy's analytics job", () => {
    renderTable([DEAD(), LIVE()]);
    const dead = within(rowFor("Orpheus"));

    expect(dead.getByText("+50.00%")).toBeTruthy(); // weight
    expect(dead.getByText("+11.00%")).toBeTruthy(); // persisted attribution
  });

  it("P4: a live `computing` constituent is withheld the same way", () => {
    renderTable([DEAD("computing"), LIVE()]);
    const dead = within(rowFor("Orpheus"));

    expect(dead.queryByText(STALE_TEXT.sharpe)).toBeNull();
    expect(dead.queryByText(/Synced/)).toBeNull();
  });

  it("P5: CONTROL — the `complete` constituent keeps every figure and its badge", () => {
    renderTable([DEAD(), LIVE()]);
    const live = within(rowFor("Meridian"));

    for (const [metric, text] of Object.entries(LIVE_TEXT)) {
      expect(
        live.queryByText(text),
        `${metric} (${text}) vanished from a COMPLETE row — the gate is over-broad`,
      ).not.toBeNull();
    }
    expect(live.getByText(/Synced/)).toBeTruthy();
  });

  it("P6: CONTROL — `complete_with_warnings` is a terminal SUCCESS and keeps everything", () => {
    renderTable([LIVE("complete_with_warnings")]);
    const live = within(rowFor("Meridian"));

    expect(live.getByText(LIVE_TEXT.sharpe)).toBeTruthy();
    expect(live.getByText(/Synced/)).toBeTruthy();
  });
});
