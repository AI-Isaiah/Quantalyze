import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import { buildScenarioFactsheetPayload } from "@/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload";
import { FactsheetProvider } from "@/app/factsheet/[id]/v2/factsheet-context";
import { FactsheetBody } from "@/app/factsheet/[id]/v2/FactsheetView";
import { CONSTANT_YIELDS, navConstantYield } from "@/__tests__/fixtures/dispersion-nav";

/**
 * Phase 166.2 review round 1 (CR-01 / SFH-H1), founder decision D7 (2026-09-26,
 * "Show — everywhere"): the factsheet page and the OG share card must say the
 * SAME thing about a series whose Sharpe does not exist.
 *
 * Before the fix the page's KPI strip and Main Metrics read `compute()`'s Sharpe,
 * which answered "no dispersion" with 0 ("0.00"), while the OG card answered it
 * with NaN ("—"). One strategy, two public surfaces, two answers: "no
 * risk-adjusted return" and "cannot be measured". This file renders BOTH
 * surfaces from one compounding constant-yield series and asserts "—" on both.
 *
 * The OG route is driven through its real handler with the same `next/og` and
 * Supabase doubles as `route.test.tsx`; the page is the real `FactsheetBody`
 * built from the scenario payload builder, which calls the same `compute()` the
 * strategy factsheet uses.
 */

vi.mock("server-only", () => ({}));
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

const ID = "33333333-3333-4333-8333-333333333333";

const STATE = vi.hoisted(() => ({
  strategyRow: null as Record<string, unknown> | null,
}));

/** Every ImageResponse element the route constructed, newest last. */
const ogCalls = vi.hoisted(() => [] as unknown[]);

vi.mock("next/og", () => ({
  ImageResponse: class {
    headers = new Headers();
    constructor(element: unknown) {
      ogCalls.push(element);
    }
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () => ({ data: STATE.strategyRow, error: null }),
      };
      return builder;
    },
  }),
}));

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
beforeEach(() => {
  vi.stubGlobal("localStorage", localStorageMock);
  ogCalls.length = 0;
});
afterEach(() => {
  vi.clearAllMocks();
});
Object.defineProperty(window, "localStorage", { value: localStorageMock, configurable: true });

/** 400 dated daily returns from 2024-01-01: clears the OG card's 30-observation gate. */
function dated(values: number[]): DailyPoint[] {
  const start = Date.UTC(2024, 0, 1);
  return values.map((value, i) => ({
    date: new Date(start + i * 86_400_000).toISOString().slice(0, 10),
    value,
  }));
}

const N = 400;
const CONSTANT = dated(navConstantYield(CONSTANT_YIELDS["apy_5pct"], N));
const NOISY = dated(Array.from({ length: N }, (_, i) => 0.0006 + 0.004 * Math.sin(i)));

/** The `value` prop of the OG card's `<Stat label="Sharpe" />`. */
function ogSharpe(node: unknown): string | undefined {
  if (Array.isArray(node)) {
    for (const c of node) {
      const v = ogSharpe(c);
      if (v !== undefined) return v;
    }
    return undefined;
  }
  if (node && typeof node === "object") {
    const props = (node as { props?: Record<string, unknown> }).props;
    if (!props) return undefined;
    if (props.label === "Sharpe" && typeof props.value === "string") return props.value;
    return ogSharpe(props.children);
  }
  return undefined;
}

async function renderOgCard(series: DailyPoint[]): Promise<string | undefined> {
  STATE.strategyRow = {
    id: ID,
    name: "Agreement Fixture",
    codename: null,
    description: null,
    asset_class: "crypto",
    strategy_analytics: [{ daily_returns: series, returns_series: null, computation_status: "complete" }],
  };
  const { GET } = await import("./route");
  await GET(new Request(`http://localhost:3000/api/og/factsheet/${ID}`), {
    params: Promise.resolve({ id: ID }),
  });
  expect(ogCalls.length, "the route must construct a card").toBeGreaterThan(0);
  return ogSharpe(ogCalls[ogCalls.length - 1]);
}

/**
 * The page's Sharpe (the KPI-strip tile and the Main Metrics row), the KPI
 * strip's Sortino and Calmar tiles, and the whole body text.
 */
function renderPage(series: DailyPoint[]): {
  kpi: string;
  row: string;
  sortino: string;
  calmar: string;
  body: string;
} {
  const payload = buildScenarioFactsheetPayload({ portfolioDaily: series, benchmark: null });
  const { container, unmount } = render(
    <FactsheetProvider payload={payload} persist={false}>
      <FactsheetBody payload={payload} scenarioMode hideAllocatorSection />
    </FactsheetProvider>,
  );
  const kpiGrid = Array.from(container.querySelectorAll<HTMLElement>("div.grid")).find((el) =>
    /@[\w[\]-]*:grid-cols-\d/.test(el.className),
  );
  expect(kpiGrid, "the KPI strip must render").toBeDefined();
  const kpiTile = (label: string): string => {
    const tile = Array.from(kpiGrid!.children).find(
      (el) => el.querySelector("p")?.textContent?.trim() === label,
    );
    expect(tile, `the KPI strip must carry a ${label} tile`).toBeDefined();
    return (tile!.textContent ?? "").replace(label, "").trim();
  };
  const kpi = kpiTile("Sharpe");
  const sortino = kpiTile("Sortino");
  const calmar = kpiTile("Calmar");
  const rowLabel = Array.from(container.querySelectorAll("td, span, div")).find(
    (el) => el.children.length === 0 && el.textContent === "Sharpe" && !kpiGrid!.contains(el),
  );
  expect(rowLabel, "Main Metrics must carry a Sharpe row").toBeDefined();
  const row = (rowLabel!.nextElementSibling?.textContent ?? "").trim();
  const body = container.textContent ?? "";
  unmount();
  return { kpi, row, sortino, calmar, body };
}

describe("the factsheet page and the OG card agree on a Sharpe that does not exist (D7)", () => {
  it("a compounding constant yield reads '—' on the OG card AND on the page, never 0.00", async () => {
    const og = await renderOgCard(CONSTANT);
    const page = renderPage(CONSTANT);
    expect(og).toBe("—");
    expect(page.kpi).toBe("—");
    expect(page.row).toBe("—");
    // Review round 2 HI-02: a constant yield has no losing day and no drawdown,
    // so it has no Sortino and no Calmar either. The tearsheet reads "—" for
    // both (the analytics service persists None); the KPI strip beside the
    // Sharpe "—" must not read "0.00".
    expect(page.sortino).toBe("—");
    expect(page.calmar).toBe("—");
    // No absent value leaks onto the page as a literal NaN (the bootstrap
    // histogram's point, interval and "all resamples produced" line included).
    expect(page.body).not.toContain("NaN");
  });

  it("control: a dispersing series reads a number on both surfaces, so the dash is not universal", async () => {
    const og = await renderOgCard(NOISY);
    const page = renderPage(NOISY);
    expect(og).toMatch(/^-?\d+\.\d{2}$/);
    expect(page.kpi).toMatch(/^-?\d+\.\d{2}$/);
    expect(page.row).toMatch(/^-?\d+\.\d{2}$/);
    expect(page.sortino).toMatch(/^-?\d+\.\d{2}$/);
    expect(page.calmar).toMatch(/^-?\d+\.\d{2}$/);
  });
});
