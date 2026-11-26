/** @vitest-environment jsdom */
/**
 * Phase 236 FIG-03 (SFH #8): a CVaR the total-record floor nulled prints a dash while VaR shows
 * beside it, so the CVaR cell says why. The note is derived from CVAR_MIN_OBS, appears only for
 * the floor cause (a record under the floor, whole record shown), and never for another NaN cause
 * (a record at or over the floor whose stored CVaR is null) or for a selected window (which
 * always shows CVaR).
 */
import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { buildFactsheetPayload } from "@/lib/factsheet/build-payload";
import { buildScenarioFactsheetPayload } from "@/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload";
import type { DailyReturn, FactsheetPayload } from "@/lib/factsheet/types";
import { CVAR_MIN_OBS } from "@/lib/figure-conventions";
import { FIGURE_DEFS_VERSION } from "@/lib/figure-gate";
import { FactsheetProvider, useXRange } from "./factsheet-context";
import { MetricsColumn } from "./MetricsColumn";

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

const NOTE = `Needs ${CVAR_MIN_OBS} observations`;

function payloadOf(n: number, opts?: Parameters<typeof buildFactsheetPayload>[2]): FactsheetPayload {
  const start = Date.UTC(2025, 2, 15);
  const rows: DailyReturn[] = Array.from({ length: n }, (_, i) => ({
    date: new Date(start + i * 86_400_000).toISOString().slice(0, 10),
    value: i % 5 === 0 ? -0.02 - 0.0001 * i : 0.003,
  }));
  const built = buildFactsheetPayload(
    {
      id: "cvar-note",
      name: "Cvar Note",
      types: ["test"],
      markets: ["crypto"],
      computedAt: "2026-09-29T00:00:00Z",
      trustTier: null,
      ingestSource: "api",
    },
    rows,
    opts,
  );
  if (!built) throw new Error("buildFactsheetPayload returned null in test");
  return built;
}

function Zoom({ range }: { range: readonly [number, number] }) {
  const { setXRange } = useXRange();
  return <button data-testid="zoom" onClick={() => setXRange(range)}>zoom</button>;
}

function mount(payload: FactsheetPayload, range: readonly [number, number] = [0, 29]) {
  return render(
    <FactsheetProvider payload={payload} persist={false}>
      <Zoom range={range} />
      <MetricsColumn />
    </FactsheetProvider>,
  );
}

const notes = () => screen.queryAllByTestId("cvar-floor-note");

describe("the CVaR cell names the floor, and only the floor (SFH #8)", () => {
  it("a record one under the floor: the cell is a dash and carries the note derived from CVAR_MIN_OBS", () => {
    const payload = payloadOf(CVAR_MIN_OBS - 1);
    expect(Number.isNaN(payload.strategyMetrics.cvar95)).toBe(true);
    mount(payload);
    expect(notes().length).toBeGreaterThan(0);
    for (const n of notes()) expect(n.textContent).toBe(NOTE);
  });

  it("a record at the floor shows its CVaR and no note", () => {
    mount(payloadOf(CVAR_MIN_OBS));
    expect(notes()).toHaveLength(0);
  });

  it("a record over the floor whose stored CVaR is null is a dash for another cause: no note", () => {
    const payload = payloadOf(400, {
      storedFigureDefs: { figureDefsVersion: FIGURE_DEFS_VERSION, sixMonth: null, threeMonth: null, var95: -0.02, cvar95: null },
    });
    expect(Number.isNaN(payload.strategyMetrics.cvar95)).toBe(true);
    mount(payload);
    expect(notes()).toHaveLength(0);
  });

  it("a selected window inside a record under the floor shows CVaR and no note", async () => {
    mount(payloadOf(CVAR_MIN_OBS - 1));
    expect(notes().length).toBeGreaterThan(0);
    await act(async () => {
      fireEvent.click(screen.getByTestId("zoom"));
    });
    expect(notes()).toHaveLength(0);
  });

  it("a window withheld for want of an annualization basis dashes CVaR for that cause: no floor note on a long record", async () => {
    // `windowView` withholds every metric (NaN) for a slice under 2 observations ("short-slice") and
    // for a view with no `periodsPerYear` ("no-annualization-basis"); both keep the short or long
    // slice in `strategyReturns` and carry `withheld`. The setter clamps a range to 5 observations,
    // so the basis arm is the one a user reaches by zooming.
    const noBasis = { ...payloadOf(400) } as FactsheetPayload;
    delete (noBasis as { periodsPerYear?: number }).periodsPerYear;
    const { container } = mount(noBasis, [10, 40]);
    await act(async () => {
      fireEvent.click(screen.getByTestId("zoom"));
    });
    const cvarRows = Array.from(container.querySelectorAll("tr")).filter((r) => r.textContent?.includes("CVaR 95%"));
    expect(cvarRows.length).toBeGreaterThan(0);
    for (const r of cvarRows) expect(r.querySelectorAll("td")[1]?.textContent).toBe("—");
    expect(notes()).toHaveLength(0);
  });
});

// WR-05: the strategy page builds its payload through `unstable_cache`, which stores JSON.stringify
// and returns JSON.parse on a hit, so a floored `cvar95: NaN` reaches the client as `null`. An
// in-memory payload cannot see that, so these arms render the payload after the same round trip.
const viaJsonCache = (p: FactsheetPayload): FactsheetPayload => JSON.parse(JSON.stringify(p)) as FactsheetPayload;

describe("the note survives the JSON cache round trip (WR-05)", () => {
  it("a strategy record under the floor: cvar95 is null after the round trip and the note still shows", () => {
    const cached = viaJsonCache(payloadOf(CVAR_MIN_OBS - 1));
    expect(cached.strategyMetrics.cvar95).toBeNull();
    mount(cached);
    expect(notes().length).toBeGreaterThan(0);
    for (const n of notes()) expect(n.textContent).toBe(NOTE);
  });

  it("a cached record over the floor whose stored CVaR is null: no note", () => {
    const cached = viaJsonCache(
      payloadOf(400, {
        storedFigureDefs: { figureDefsVersion: FIGURE_DEFS_VERSION, sixMonth: null, threeMonth: null, var95: -0.02, cvar95: null },
      }),
    );
    expect(cached.strategyMetrics.cvar95).toBeNull();
    mount(cached);
    expect(notes()).toHaveLength(0);
  });

  it("the Scenario composer's blend under the floor shows the note, and at the floor shows CVaR and none (CR-04)", () => {
    const blend = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        date: new Date(Date.UTC(2025, 2, 15) + i * 86_400_000).toISOString().slice(0, 10),
        value: i % 5 === 0 ? -0.02 - 0.0001 * i : 0.003,
      }));
    const under = buildScenarioFactsheetPayload({ portfolioDaily: blend(CVAR_MIN_OBS - 1) });
    expect(Number.isNaN(under.strategyMetrics.cvar95)).toBe(true);
    const { unmount } = mount(under);
    expect(notes().length).toBeGreaterThan(0);
    for (const n of notes()) expect(n.textContent).toBe(NOTE);
    unmount();
    mount(buildScenarioFactsheetPayload({ portfolioDaily: blend(CVAR_MIN_OBS) }), [0, CVAR_MIN_OBS - 1]);
    expect(notes()).toHaveLength(0);
  });
});
