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
