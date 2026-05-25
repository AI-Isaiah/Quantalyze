import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { OverviewPanel } from "./OverviewPanel";
import type { StrategyV2Detail } from "@/lib/queries";

/**
 * M-1148 (audit-2026-05-07) — OverviewPanel.fmtNumber MA-6 locale pin.
 *
 * PR #86 (v0.17.1.3) changed `value.toLocaleString()` to
 * `value.toLocaleString("en-US")` so SSR (Node default locale) and the
 * client (user browser locale) emit identical group separators — a
 * non-US client would otherwise hydrate with "1.234.567" vs "1,234,567"
 * and trip React's hydration warning. OverviewPanel had no test file, so
 * reverting the locale arg would silently regress. These pin it two ways:
 * a render assertion on the grouped output and a source-grep so a missing
 * locale arg fails fast.
 */

function panel1(
  overrides: Partial<StrategyV2Detail["panel1"]> = {},
): StrategyV2Detail["panel1"] {
  return {
    supported_exchanges: ["binance"],
    strategy_types: ["trend"],
    subtypes: ["momentum"],
    markets: ["BTC"],
    leverage_range: "1x–3x",
    avg_daily_turnover: null,
    ...overrides,
  };
}

describe("OverviewPanel — en-US locale pin (M-1148)", () => {
  it("formats avg_daily_turnover with en-US grouping (commas, not periods)", () => {
    render(
      <OverviewPanel
        panel1={panel1({ avg_daily_turnover: 1_234_567 })}
        history_days={365}
      />,
    );
    // en-US grouping → "1,234,567". A de-DE locale would render
    // "1.234.567"; pinning to en-US guarantees the comma form on both SSR
    // and client so hydration matches.
    expect(screen.getByText("1,234,567")).toBeInTheDocument();
    expect(screen.queryByText("1.234.567")).toBeNull();
  });

  it("renders the Avg DTO cell with a fractional value grouped en-US", () => {
    render(
      <OverviewPanel
        panel1={panel1({ avg_daily_turnover: 1234.5 })}
        history_days={365}
      />,
    );
    // en-US: "1,234.5" (comma group, dot decimal). de-DE would be
    // "1.234,5" — the inverse — so this distinguishes the locale.
    expect(screen.getByText("1,234.5")).toBeInTheDocument();
  });

  it("renders em-dash for a null avg_daily_turnover", () => {
    render(
      <OverviewPanel
        panel1={panel1({ avg_daily_turnover: null })}
        history_days={365}
      />,
    );
    // The Avg DTO <dd> falls back to the em-dash sentinel.
    const dto = screen.getByText("Avg DTO").closest("div");
    expect(dto?.textContent).toContain("—");
  });

  it("source pins toLocaleString to the en-US locale (MA-6 second-tier defense)", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/components/strategy-v2/OverviewPanel.tsx"),
      "utf-8",
    );
    // Reverting to a bare `toLocaleString()` (no locale arg) re-introduces
    // the SSR/client hydration mismatch — fail loudly if the arg is gone.
    expect(src).toMatch(/toLocaleString\(["']en-US["']\)/);
  });

  it("replaces the body with the partial-data banner when history_days < 1", () => {
    render(
      <OverviewPanel
        panel1={panel1({ avg_daily_turnover: 1_234_567 })}
        history_days={0}
      />,
    );
    expect(screen.getByText("Awaiting more data")).toBeInTheDocument();
    // The grouped number must NOT render — the grid is replaced.
    expect(screen.queryByText("1,234,567")).toBeNull();
  });
});
