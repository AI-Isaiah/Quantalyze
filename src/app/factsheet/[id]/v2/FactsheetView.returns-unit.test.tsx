import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import type { FactsheetPayload } from "@/lib/factsheet/types";
import { buildScenarioFactsheetPayload } from "@/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload";
import { FactsheetProvider } from "./factsheet-context";
import { FactsheetBody } from "./FactsheetView";

/**
 * Phase 164.6.6.2 plan 05 (D-08, D-09, D-21) — the factsheet says, from ONE
 * payload field, that a strategy's returns are in a native unit.
 *
 * The gate is `payload.returnsUnit`. `null`/absent is the USD family and must
 * render the pre-phase DOM; a unit adds the masthead chip, two KPI labels, the
 * chart and table titles, and an honest `—` AUM. Every string composes from the
 * unit: the ETH arms prove there is no hard-coded "BTC" in copy (UI-SPEC
 * one-many).
 */

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
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
// Installed PER TEST: `vitest.config.ts` sets `unstubGlobals: true` (DEF-16-1).
beforeEach(() => {
  vi.stubGlobal("localStorage", localStorageMock);
});
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

const BASE: FactsheetPayload = buildScenarioFactsheetPayload({
  portfolioDaily: makeReturnsSeries(300),
  benchmark: null,
});

/** The USD payload carries no `returnsUnit` key, as the server emits it. */
function usdPayload(over: Partial<FactsheetPayload> = {}): FactsheetPayload {
  return { ...BASE, ...over } as FactsheetPayload;
}
function unitPayload(unit: string, over: Partial<FactsheetPayload> = {}): FactsheetPayload {
  return { ...BASE, returnsUnit: unit, ...over } as FactsheetPayload;
}

function renderFactsheet(
  payload: FactsheetPayload,
  extra: { renameTarget?: { id: string; name: string } } = {},
) {
  return render(
    <FactsheetProvider payload={payload} persist={false}>
      <FactsheetBody payload={payload} hideAllocatorSection hideFooter {...extra} />
    </FactsheetProvider>,
  );
}

function kpiLabels(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-testid="factsheet-kpi-label"]'));
}
function labelByText(container: HTMLElement, text: string): HTMLElement | undefined {
  return kpiLabels(container).find((el) => el.textContent === text);
}
/** The AUM chip's root: the parent of the `AUM` eyebrow paragraph in the masthead. */
function aumChip(container: HTMLElement): HTMLElement {
  const eyebrow = Array.from(container.querySelectorAll("header p")).find((p) =>
    (p.textContent ?? "").startsWith("AUM"),
  );
  expect(eyebrow, "the AUM chip did not render").toBeDefined();
  return eyebrow!.parentElement as HTMLElement;
}

describe("A1 — the masthead chip", () => {
  it("a BTC payload renders exactly one chip, with the DOM text, inside the flex-wrap row beside the h1", () => {
    const { container } = renderFactsheet(unitPayload("BTC"));
    const chips = container.querySelectorAll('[data-returns-unit="BTC"]');
    expect(chips.length).toBe(1);
    expect(container.querySelectorAll("[data-returns-unit]").length).toBe(1);
    expect(chips[0].textContent).toBe("Returns in BTC");
    const h1 = container.querySelector("h1") as HTMLElement;
    const row = h1.parentElement as HTMLElement;
    expect(row.className).toBe("flex flex-wrap items-baseline gap-3");
    expect(row).toBe(chips[0].parentElement);
    // H1 first, then the chip.
    expect(Array.from(row.children).indexOf(h1)).toBeLessThan(Array.from(row.children).indexOf(chips[0]));
  });

  it("the chip sits in the masthead, never on the trust-tier row below it", () => {
    const { container } = renderFactsheet(unitPayload("BTC"));
    const chip = container.querySelector("[data-returns-unit]") as HTMLElement;
    expect(chip.closest("header")).not.toBeNull();
    expect(chip.parentElement!.className).not.toContain("gap-2 sm:gap-3");
  });

  it("the owner arm orders H1, then the chip, then Rename", () => {
    const { container } = renderFactsheet(unitPayload("BTC"), {
      renameTarget: { id: "s-1", name: BASE.strategyName },
    });
    const h1 = container.querySelector("h1") as HTMLElement;
    const row = h1.parentElement as HTMLElement;
    const kids = Array.from(row.children);
    expect(kids.length).toBe(3);
    expect(kids[0].tagName).toBe("H1");
    expect(kids[1].getAttribute("data-returns-unit")).toBe("BTC");
    expect(kids[2].textContent).toContain("Rename");
  });

  it("a USD payload's public arm emits the bare h1, with no wrapper and no chip", () => {
    const { container } = renderFactsheet(usdPayload());
    expect(container.querySelector("[data-returns-unit]")).toBeNull();
    const h1 = container.querySelector("h1") as HTMLElement;
    expect(h1.parentElement!.className).not.toContain("flex-wrap items-baseline");
    expect(h1.parentElement!.className).toBe("max-w-3xl");
  });

  it("at 320px the chip wraps below the H1: the row wraps, the chip never breaks and has no fixed width", () => {
    const { container } = renderFactsheet(unitPayload("BTC"));
    const chip = container.querySelector("[data-returns-unit]") as HTMLElement;
    expect(chip.parentElement!.className).toContain("flex-wrap");
    expect(chip.className).toContain("whitespace-nowrap");
    expect(chip.className).not.toMatch(/\b(w-|min-w-|max-w-)/);
  });

  it("takes the unit it is given: ETH reads Returns in ETH", () => {
    const { container } = renderFactsheet(unitPayload("ETH"));
    expect(container.querySelector('[data-returns-unit="ETH"]')!.textContent).toBe("Returns in ETH");
    expect(container.querySelector('[data-returns-unit="BTC"]')).toBeNull();
  });
});

// The wrap-vs-clip contract (UI-SPEC "Label wrap rule"). The shared prefix is the
// label's own token string, which no label ever changes.
const LABEL_BASE = "text-micro font-mono uppercase tracking-[0.14em] sm:tracking-[0.18em]";
const LABEL_CLIP = `${LABEL_BASE} whitespace-nowrap overflow-hidden text-ellipsis`;
const LABEL_WRAP = `${LABEL_BASE} whitespace-normal break-words`;

describe("A2/A3 — the KPI strip's return labels", () => {
  it("a BTC strip labels exactly the two return cells in BTC, and they wrap instead of clipping", () => {
    const { container } = renderFactsheet(unitPayload("BTC"));
    const cum = labelByText(container, "Cum. Return in BTC");
    const cagr = labelByText(container, "CAGR in BTC");
    expect(cum, "Cum. Return in BTC").toBeDefined();
    expect(cagr, "CAGR in BTC").toBeDefined();
    for (const el of [cum!, cagr!]) {
      expect(el.className).toBe(LABEL_WRAP);
      expect(el.className).not.toContain("text-ellipsis");
    }
    // The bare labels are gone, not duplicated.
    expect(labelByText(container, "Cum. Return")).toBeUndefined();
    expect(labelByText(container, "CAGR")).toBeUndefined();
  });

  it("every other label keeps the clip classes byte-for-byte", () => {
    const { container } = renderFactsheet(unitPayload("BTC"));
    const others = kpiLabels(container).filter(
      (el) => el.textContent !== "Cum. Return in BTC" && el.textContent !== "CAGR in BTC",
    );
    expect(others.map((el) => el.textContent)).toContain("Sharpe");
    expect(others.length).toBe(kpiLabels(container).length - 2);
    for (const el of others) expect(el.className).toBe(LABEL_CLIP);
  });

  it("a USD strip is unchanged: bare labels, every one on the clip classes", () => {
    const { container } = renderFactsheet(usdPayload());
    const labels = kpiLabels(container);
    expect(labels.map((el) => el.textContent)).toEqual(
      expect.arrayContaining(["Cum. Return", "CAGR", "Sharpe"]),
    );
    for (const el of labels) expect(el.className).toBe(LABEL_CLIP);
    expect(labels.some((el) => /\bin [A-Z]{2,10}$/.test(el.textContent ?? ""))).toBe(false);
  });

  it("takes the unit it is given: ETH reads CAGR in ETH and names no BTC", () => {
    const { container } = renderFactsheet(unitPayload("ETH"));
    expect(labelByText(container, "CAGR in ETH")).toBeDefined();
    expect(labelByText(container, "Cum. Return in ETH")).toBeDefined();
    expect(container.textContent).not.toContain("in BTC");
  });
});

describe("A12 / D-21 — the AUM chip never shows a USD figure as if it were BTC", () => {
  const AUM = { aum: 2_000_000, maxCapacity: 10_000_000 };

  it("a BTC strategy's AUM reads a bare dash: no capacity span, no utilization bar, no dollar sign", () => {
    const { container } = renderFactsheet(unitPayload("BTC", AUM));
    const chip = aumChip(container);
    const value = chip.querySelectorAll("p")[1] as HTMLElement;
    expect(value.textContent).toBe("—");
    expect(value.querySelector("span")).toBeNull();
    expect(chip.querySelector('[aria-label^="Capacity utilization"]')).toBeNull();
    expect(chip.textContent).not.toContain("$");
    expect(chip.textContent).not.toContain("/");
  });

  it("a USD strategy still shows $2M, / $10M and the bar", () => {
    const { container } = renderFactsheet(usdPayload(AUM));
    const chip = aumChip(container);
    expect(chip.querySelectorAll("p")[1].textContent).toBe("$2M/ $10M");
    expect(chip.querySelector('[aria-label="Capacity utilization 20%"]')).not.toBeNull();
  });

  it("a unit with no AUM at all still draws no chip, as today", () => {
    const { container } = renderFactsheet(unitPayload("BTC", { aum: null }));
    expect(Array.from(container.querySelectorAll("header p")).some((p) => (p.textContent ?? "").startsWith("AUM"))).toBe(false);
  });
});

describe("A8-A10, A13, A20 — chart and table titles", () => {
  it("a BTC factsheet titles the equity charts and tables in BTC, and the aria-label follows the title", () => {
    const { container, queryByText, getAllByText } = renderFactsheet(unitPayload("BTC"));
    expect(queryByText("Cumulative Returns in BTC")).not.toBeNull();
    expect(queryByText("Cumulative Returns")).toBeNull();
    expect(container.querySelector('[aria-label^="Cumulative Returns in BTC:"]')).not.toBeNull();
    expect(queryByText("drawdown from running peak, in BTC")).not.toBeNull();
    expect(
      queryByText("strategy equity in BTC · shaded bands mark the deepest 10 drawdowns"),
    ).not.toBeNull();
    expect(getAllByText("Cumulative Return in BTC").length).toBeGreaterThan(0);
    expect(getAllByText("CAGR in BTC", { selector: "td, span, div, th" }).length).toBeGreaterThan(0);
    expect(getAllByText("EOY Returns in BTC", { selector: "h3" }).length).toBeGreaterThan(0);
  });

  it("a USD factsheet keeps every one of those strings as it is today", () => {
    const { container, queryByText, getAllByText } = renderFactsheet(usdPayload());
    expect(queryByText("Cumulative Returns")).not.toBeNull();
    expect(container.querySelector('[aria-label^="Cumulative Returns:"]')).not.toBeNull();
    expect(queryByText("drawdown from running peak")).not.toBeNull();
    expect(queryByText("strategy equity · shaded bands mark the deepest 10 drawdowns")).not.toBeNull();
    expect(getAllByText("Cumulative Return").length).toBeGreaterThan(0);
    expect(getAllByText("EOY Returns", { selector: "h3" }).length).toBeGreaterThan(0);
    expect(container.textContent).not.toMatch(/\bin (BTC|ETH)\b/);
  });

  it("takes the unit it is given: an ETH factsheet says ETH in every title, and never BTC", () => {
    const { container, queryByText } = renderFactsheet(unitPayload("ETH"));
    expect(queryByText("Cumulative Returns in ETH")).not.toBeNull();
    expect(queryByText("drawdown from running peak, in ETH")).not.toBeNull();
    expect(container.textContent).not.toContain("in BTC");
  });
});
