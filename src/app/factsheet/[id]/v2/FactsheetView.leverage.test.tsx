import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import type { FactsheetPayload } from "@/lib/factsheet/types";
import { buildScenarioFactsheetPayload } from "@/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload";
import { FactsheetProvider } from "./factsheet-context";
import { FactsheetBody } from "./FactsheetView";

/**
 * Phase 90.5 (LEV-01, D1/D2 + UI-SPEC) — the factsheet leverage control surface.
 *
 * The one NEW user-visible surface of the phase: a single-key-only leverage
 * number input in the ControlBar that live-recomputes every KPI, plus the amber
 * MODELED eyebrow + cost-free caveat + Reset-1× affordance, all INSERTED only at
 * L!=1 so L=1 stays byte-identical to today (GUARD-02).
 *
 * The eligibility gate is FAIL-CLOSED (UI-SPEC "Eligibility gate"): the control
 * renders IFF `dataQuality?.composite !== true` AND `periodsPerYear != null`. A
 * composite OR a periodsPerYear-absent (stale v4) payload renders NO control —
 * so a modeled recompute can never reach a composite (WI-1, plan-checker
 * defense-in-depth) and the frozen v4-shaped byte-identity pins stay green by
 * construction.
 *
 * localStorage + sentry are stubbed because FactsheetProvider's persistence
 * primitive touches them on mount (even at persist={false}). Stub block mirrors
 * FactsheetBody.scenario-mode.test.tsx verbatim.
 */

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

const lsStore = new Map<string, string>();
const localStorageMock = {
  getItem: vi.fn((k: string) => lsStore.get(k) ?? null),
  setItem: vi.fn((k: string, v: string) => {
    lsStore.set(k, v);
  }),
  removeItem: vi.fn((k: string) => {
    lsStore.delete(k);
  }),
  clear: vi.fn(() => lsStore.clear()),
  key: vi.fn(() => null),
  length: 0,
};
vi.stubGlobal("localStorage", localStorageMock);
Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
  configurable: true,
});

function makeReturnsSeries(n: number, drift = 0.0015): DailyPoint[] {
  const pts: DailyPoint[] = [];
  const d = new Date(Date.UTC(2023, 0, 1));
  for (let i = 0; i < n; i++) {
    pts.push({
      date: d.toISOString().slice(0, 10),
      value: drift + Math.sin(i * 0.27) * 0.005,
    });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return pts;
}

// v5 single-key: the ONLY shape that renders the control (composite !== true AND
// periodsPerYear present). #597 crypto basis (365) so the leverage recompute has
// a concrete annualization basis.
function v5SingleKey(): FactsheetPayload {
  const p = buildScenarioFactsheetPayload({
    portfolioDaily: makeReturnsSeries(300),
    benchmark: null,
  });
  return { ...p, periodsPerYear: 365 } as FactsheetPayload;
}

// v4-shaped single-key (no periodsPerYear) — fail-closed: control hidden.
function v4SingleKey(): FactsheetPayload {
  return buildScenarioFactsheetPayload({
    portfolioDaily: makeReturnsSeries(300),
    benchmark: null,
  });
}

// WR-01 fixture — a single-key v5 payload with an ACTIVE comparator carrying a
// populated `joint` (α / IR), so the KpiStrip renders the two benchmark-relative
// cells. The scenario builder's comparator block is inert (joint === null), so we
// inject a real joint the same way the production route's build-payload does. A
// benchmark series is passed so `activeComparator` flips to "btc" and the
// comparator's cumulative line is populated (no null-series chart crash).
function v5SingleKeyWithComparator(): FactsheetPayload {
  const p = buildScenarioFactsheetPayload({
    portfolioDaily: makeReturnsSeries(300),
    benchmark: makeReturnsSeries(300, 0.001),
  });
  return {
    ...p,
    periodsPerYear: 365,
    comparators: {
      ...p.comparators,
      btc: {
        ...p.comparators.btc,
        joint: {
          alpha: 0.1234,
          beta: 1.1,
          corr: 0.6,
          r2: 0.36,
          info_ratio: 0.85,
          treynor: 0.1,
          tracking_error: 0.05,
          up_capture: 1.05,
          down_capture: 0.95,
        },
      },
    },
  } as FactsheetPayload;
}

const KP_CASH = {
  cumulative_return: 0.6266,
  volatility: 0.12,
  max_drawdown: -0.041,
  cagr: 0.31,
  sharpe: 1.4,
  sortino: 2.1,
  calmar: 3.0,
};

// Composite WITH periodsPerYear present — the WI-1 fixture. Must render NO
// control despite periodsPerYear, and its KpiStrip must be byte-identical to the
// same composite WITHOUT periodsPerYear (proving the render-gate + composite-
// agnostic L=1 identity both hold; a composite can never reach a recompute).
function v5Composite(): FactsheetPayload {
  const p = buildScenarioFactsheetPayload({
    portfolioDaily: makeReturnsSeries(300),
    benchmark: null,
  });
  p.strategyMetrics.cum_ret = KP_CASH.cumulative_return;
  return {
    ...p,
    periodsPerYear: 365,
    dataQuality: { composite: true },
    metricsByBasis: { cash_settlement: KP_CASH },
    mtmGate: { available: false },
  } as unknown as FactsheetPayload;
}

function v4Composite(): FactsheetPayload {
  const p = buildScenarioFactsheetPayload({
    portfolioDaily: makeReturnsSeries(300),
    benchmark: null,
  });
  p.strategyMetrics.cum_ret = KP_CASH.cumulative_return;
  return {
    ...p,
    dataQuality: { composite: true },
    metricsByBasis: { cash_settlement: KP_CASH },
    mtmGate: { available: false },
  } as unknown as FactsheetPayload;
}

function renderBody(payload: FactsheetPayload) {
  return render(
    <FactsheetProvider payload={payload} persist={false}>
      <FactsheetBody payload={payload} scenarioMode hideAllocatorSection />
    </FactsheetProvider>,
  );
}

const CAVEAT_PREFIX = "Modeled leverage: daily returns scaled r → L·r";
const REALIZED_CLAUSE = "not the strategy's realized track record";
const CLAMP_MAX_MSG = "Leverage clamped to 10× — the maximum modeled leverage.";
const CLAMP_NEG_MSG =
  "Leverage can't be negative — shorting isn't modeled in this projection. Clamped to 0.";
const NON_FINITE_MSG =
  "Invalid leverage — enter a number between 0 and 10. The previous value was kept.";

const levInput = (c: HTMLElement) =>
  c.querySelector<HTMLInputElement>("#leverage-factsheet");

function kpiGrid(c: HTMLElement): HTMLElement {
  return Array.from(c.querySelectorAll<HTMLElement>("div.grid")).find((el) =>
    /@[\w[\]-]*:grid-cols-\d/.test(el.className),
  )!;
}

function readCell(c: HTMLElement, label: string): string | null {
  const grid = kpiGrid(c);
  if (!grid) return null;
  for (const tile of Array.from(grid.children) as HTMLElement[]) {
    const ps = Array.from(tile.querySelectorAll("p"));
    if (ps.length === 2 && ps[0].textContent?.trim() === label) {
      return ps[1].textContent?.trim() ?? null;
    }
  }
  return null;
}

describe("FactsheetView — LEV-01 leverage control eligibility gate (fail-closed)", () => {
  it("renders a labeled LEVERAGE input on a single-key v5 payload (composite !== true AND periodsPerYear present)", () => {
    const { container } = renderBody(v5SingleKey());
    const input = levInput(container);
    expect(input).not.toBeNull();
    // Visible, associated <label> (self-describing in the ControlBar).
    const label = container.querySelector<HTMLLabelElement>(
      'label[for="leverage-factsheet"]',
    );
    expect(label?.textContent?.trim()).toBe("LEVERAGE");
    // Native number input, min 0, max = MAX_LEVERAGE (10).
    expect(input!.getAttribute("type")).toBe("number");
    expect(input!.getAttribute("max")).toBe("10");
  });

  it("renders NO leverage input on a composite payload (D1 — composites hide it)", () => {
    const { container } = renderBody(v4Composite());
    expect(levInput(container)).toBeNull();
  });

  it("renders NO leverage input on a single-key payload WITHOUT periodsPerYear (fail-closed, D2)", () => {
    const { container } = renderBody(v4SingleKey());
    expect(levInput(container)).toBeNull();
  });
});

describe("FactsheetView — LEV-01 WI-1: a composite with periodsPerYear can never reach a recompute", () => {
  it("composite v5 (composite===true AND periodsPerYear present) renders NO control AND a KpiStrip byte-identical to the no-leverage composite render", () => {
    const withPPY = renderBody(v5Composite());
    const withoutPPY = renderBody(v4Composite());

    // (a) the render-gate holds even WITH periodsPerYear present.
    expect(levInput(withPPY.container)).toBeNull();

    // (b) the composite-agnostic L=1 identity branch holds: the KpiStrip is
    // byte-identical whether or not periodsPerYear is present, so adding the
    // annualization basis to a composite changes nothing (no recompute path).
    expect(kpiGrid(withPPY.container).outerHTML).toBe(
      kpiGrid(withoutPPY.container).outerHTML,
    );
  });
});

describe("FactsheetView — LEV-01 L=1 baseline byte-identity (no eyebrow/caveat/reset)", () => {
  it("at L=1 the view contains NO 'MODELED', NO caveat, NO 'Reset 1×'", () => {
    const { container } = renderBody(v5SingleKey());
    const html = container.innerHTML;
    expect(html).not.toContain("MODELED");
    expect(html).not.toContain(CAVEAT_PREFIX);
    expect(html).not.toContain("Reset 1×");
  });
});

describe("FactsheetView — LEV-01 modeled state (L != 1)", () => {
  it("entering 2.5 shows the amber 'MODELED · 2.5×' eyebrow (role=status), the caveat, the Reset pill, and recomputes the strip", () => {
    const { container, getByText } = renderBody(v5SingleKey());
    const before = readCell(container, "Ann. Vol");

    act(() => {
      fireEvent.change(levInput(container)!, { target: { value: "2.5" } });
    });

    const eyebrow = getByText(/MODELED · 2\.5×/);
    expect(eyebrow.getAttribute("role")).toBe("status");
    expect(eyebrow.getAttribute("aria-live")).toBe("polite");

    // Cost-free caveat (UI-SPEC copy verbatim), visible as a persistent line.
    const caveat = getByText(new RegExp(CAVEAT_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    expect(caveat.textContent).toContain(REALIZED_CLAUSE);

    // Reset affordance.
    expect(getByText("Reset 1×")).toBeTruthy();

    // The recompute reached the strip — vol scales with leverage.
    const after = readCell(container, "Ann. Vol");
    expect(after).not.toBe(before);

    // The controlled input reflects the entered multiplier.
    expect(levInput(container)!.value).toBe("2.5");
  });

  it("Reset 1× removes the eyebrow/caveat/reset and restores the L=1 KPI values", () => {
    const { container, getByText, queryByText } = renderBody(v5SingleKey());
    const baseline = readCell(container, "Ann. Vol");

    act(() => {
      fireEvent.change(levInput(container)!, { target: { value: "3" } });
    });
    expect(queryByText(/MODELED · 3×/)).not.toBeNull();

    act(() => {
      fireEvent.click(getByText("Reset 1×"));
    });

    expect(container.innerHTML).not.toContain("MODELED");
    expect(container.innerHTML).not.toContain(CAVEAT_PREFIX);
    expect(queryByText("Reset 1×")).toBeNull();
    expect(readCell(container, "Ann. Vol")).toBe(baseline);
    expect(levInput(container)!.value).toBe("1");
  });
});

describe("FactsheetView — WR-01: α / IR are suppressed under a modeled leverage (mislabel guard)", () => {
  it("at L=1 the α/IR cells show the real values; at L≠1 they render '—' (benchmark-relative stats stay on the 1× track); Reset restores them byte-identically", () => {
    const { container, getByText } = renderBody(v5SingleKeyWithComparator());

    // Baseline (L=1): the two comparator cells render REAL series-derived values.
    const alphaBase = readCell(container, "α vs BTC");
    const irBase = readCell(container, "IR vs BTC");
    expect(alphaBase).not.toBeNull();
    expect(irBase).not.toBeNull();
    expect(alphaBase).not.toBe("—");
    expect(irBase).not.toBe("—");

    // Modeled (L≠1): α (α → L·α) and IR sit beside a LEVERED Sharpe/Vol but the
    // strip only carries the un-levered payload values → mislabel. Render "—".
    act(() => {
      fireEvent.change(levInput(container)!, { target: { value: "3" } });
    });
    expect(readCell(container, "α vs BTC")).toBe("—");
    expect(readCell(container, "IR vs BTC")).toBe("—");

    // Reset to 1× restores the exact baseline values (byte-identical) — the
    // suppression is display-only and fully recoverable.
    act(() => {
      fireEvent.click(getByText("Reset 1×"));
    });
    expect(readCell(container, "α vs BTC")).toBe(alphaBase);
    expect(readCell(container, "IR vs BTC")).toBe(irBase);
  });
});

describe("FactsheetView — M-3: right-rail MetricsColumn labeled BASE · 1× under a modeled leverage", () => {
  const baseTrackEyebrow = (c: HTMLElement) =>
    c.querySelector('[data-testid="metricscolumn-base-track-eyebrow"]');

  it("no BASE·1× eyebrow at L=1 (byte-identical rail); the eyebrow appears at L≠1", () => {
    const { container } = renderBody(v5SingleKey());
    // L=1 — the right rail is bare, exactly as before (GUARD-02 shape).
    expect(baseTrackEyebrow(container)).toBeNull();

    act(() => {
      fireEvent.change(levInput(container)!, { target: { value: "3" } });
    });
    // Modeled — the rail is flagged as the base 1× track (the strip is levered).
    expect(baseTrackEyebrow(container)).not.toBeNull();
  });

  it("the caveat discloses the rolling panels + right-rail metrics stay on the base track (no exhaustive-looking list)", () => {
    const { container, getByText } = renderBody(v5SingleKey());
    act(() => {
      fireEvent.change(levInput(container)!, { target: { value: "2" } });
    });
    const caveat = getByText(
      new RegExp(CAVEAT_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
    expect(caveat.textContent).toContain("rolling panels");
    expect(caveat.textContent).toContain("right-rail metrics");
  });
});

describe("FactsheetView — L-1: clearing the leverage input keeps the previous value (no MODELED · 0×)", () => {
  it("emptying the field mid-edit does NOT snap to a flat 0× — the previous multiplier is kept", () => {
    const { container, queryByText } = renderBody(v5SingleKey());
    act(() => {
      fireEvent.change(levInput(container)!, { target: { value: "3" } });
    });
    expect(levInput(container)!.value).toBe("3");

    // Clear the field (Number("") === 0 pre-fix → MODELED · 0×).
    act(() => {
      fireEvent.change(levInput(container)!, { target: { value: "" } });
    });
    expect(queryByText(/MODELED · 0×/)).toBeNull();
    // The controlled input keeps the prior multiplier — nothing snapped to 0.
    expect(levInput(container)!.value).toBe("3");
  });
});

describe("FactsheetView — LEV-01 fail-loud clamp messaging (UI-SPEC error copy verbatim)", () => {
  it("input 11 → value clamped to 10 + over-max message", () => {
    const { container, getByText } = renderBody(v5SingleKey());
    act(() => {
      fireEvent.change(levInput(container)!, { target: { value: "11" } });
    });
    expect(levInput(container)!.value).toBe("10");
    expect(getByText(CLAMP_MAX_MSG)).toBeTruthy();
  });

  it("input -1 → value clamped to 0 + negative message", () => {
    const { container, getByText } = renderBody(v5SingleKey());
    act(() => {
      fireEvent.change(levInput(container)!, { target: { value: "-1" } });
    });
    expect(levInput(container)!.value).toBe("0");
    expect(getByText(CLAMP_NEG_MSG)).toBeTruthy();
  });

  it("non-numeric (non-finite) → previous value kept + non-finite message", () => {
    const { container, getByText } = renderBody(v5SingleKey());
    const input = levInput(container)!;
    // jsdom sanitizes a non-numeric <input type=number> value to "" before React
    // reads it (Number("") = 0 → happy path), so force a non-finite value through
    // the controlled-input bridge by patching the value getter — mirrors the
    // ScenarioComposer non-finite leverage test.
    const original = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    );
    Object.defineProperty(input, "value", {
      configurable: true,
      get: () => "Infinity",
    });
    act(() => {
      fireEvent.change(input);
    });
    expect(getByText(NON_FINITE_MSG)).toBeTruthy();
    if (original) Object.defineProperty(input, "value", original);
    // The rejected paste left the displayed multiplier at the 1× default.
    expect(input.value).toBe("1");
  });

  it("entering a valid value clears a prior clamp message", () => {
    const { container, getByText, queryByText } = renderBody(v5SingleKey());
    act(() => {
      fireEvent.change(levInput(container)!, { target: { value: "11" } });
    });
    expect(getByText(CLAMP_MAX_MSG)).toBeTruthy();
    act(() => {
      fireEvent.change(levInput(container)!, { target: { value: "2" } });
    });
    expect(queryByText(CLAMP_MAX_MSG)).toBeNull();
  });
});
