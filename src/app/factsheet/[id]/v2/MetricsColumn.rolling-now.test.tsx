/** @vitest-environment jsdom */
/**
 * Phase 166.2 round 2, SFH-R2-H1: the Rolling Metrics "Now" column is the CURRENT
 * window, never the most recent window that happened to have a value.
 *
 * Why this matters: since D7 ("Show — everywhere") `rollingSharpe` answers null for
 * a window with no dispersion. A strategy that went flat for its last rolling
 * window therefore ends its Sharpe series in nulls. A "Now" that walks back to the
 * last non-null value reports a window that closed months ago, and prints it as a
 * confident current Sharpe beside a 0.0% current volatility. "Now" must read "—"
 * for a current window with no ratio; avg / min / max still summarise every
 * window that has one.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { buildFactsheetPayload } from "@/lib/factsheet/build-payload";
import type { FactsheetPayload } from "@/lib/factsheet/types";

import { FactsheetProvider } from "./factsheet-context";
import { MetricsColumn } from "./MetricsColumn";

function isoDay(i: number): string {
  return new Date(Date.UTC(2022, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);
}

/** `active` dispersing days (both signs), then `flat` days of exactly 0. */
function payloadFor(active: number, flat: number): FactsheetPayload {
  const dailyReturns = Array.from({ length: active + flat }, (_, i) => ({
    date: isoDay(i),
    value: i < active ? Math.sin(i / 7) * 0.01 + 0.0004 : 0,
  }));
  const payload = buildFactsheetPayload(
    {
      id: "rolling-now-test",
      name: "Rolling Now Test",
      types: ["test"],
      markets: ["crypto"],
      computedAt: "2026-09-26T00:00:00Z",
      trustTier: null,
      ingestSource: "api",
    },
    dailyReturns,
  );
  if (!payload) throw new Error("buildFactsheetPayload returned null in test");
  return payload;
}

/**
 * Renders the column once and returns a reader for the four value cells
 * (Now, Avg, Min, Max) of a Rolling Metrics row.
 */
function renderRolling(payload: FactsheetPayload): (label: string) => string[] {
  const { getByText } = render(
    <FactsheetProvider payload={payload}>
      <MetricsColumn />
    </FactsheetProvider>,
  );
  const section = getByText(/Rolling Metrics/).closest("section") as HTMLElement;
  return (label: string) => {
    const row = [...section.querySelectorAll("tbody tr")].find(
      tr => tr.querySelector("td")?.textContent === label,
    );
    if (!row) throw new Error(`no Rolling Metrics row "${label}"`);
    return [...row.querySelectorAll("td")].slice(1).map(td => td.textContent ?? "");
  };
}

describe("MetricsColumn Rolling Metrics: 'Now' is the current window (SFH-R2-H1)", () => {
  it("a trailing flat window reads Sharpe Now '—', not a stale earlier window", () => {
    const payload = payloadFor(300, 200);
    const sharpe = payload.strategyRollingSharpe;
    // Precondition, measured on the real builder: the current window has no Sharpe,
    // and an earlier window does (the value the old backward walk would surface).
    expect(sharpe[sharpe.length - 1]).toBeNull();
    const lastFinite = [...sharpe].reverse().find(v => v != null && Number.isFinite(v));
    expect(lastFinite).toBeDefined();
    const stale = (lastFinite as number).toFixed(2);

    const [now, avg] = renderRolling(payload)("Sharpe");
    expect(now).toBe("—");
    expect(now).not.toBe(stale);
    // The history still has windows with a Sharpe, so Avg is a number.
    expect(avg).not.toBe("—");
  });

  it("the current window's volatility is reported as measured (0.0%), never walked back", () => {
    const payload = payloadFor(300, 200);
    const [now] = renderRolling(payload)("Volatility");
    expect(now).toBe("0.0%");
  });

  it("control: an active current window reads its own last value in every row", () => {
    const payload = payloadFor(500, 0);
    const last = (a: Array<number | null>) => a[a.length - 1] as number;
    const rollingRow = renderRolling(payload);
    expect(rollingRow("Sharpe")[0]).toBe(last(payload.strategyRollingSharpe).toFixed(2));
    expect(rollingRow("Sortino")[0]).toBe(last(payload.strategyRollingSortino).toFixed(2));
    expect(rollingRow("Volatility")[0]).toBe(
      `${(last(payload.strategyRollingVol) * 100).toFixed(1)}%`,
    );
  });
});
