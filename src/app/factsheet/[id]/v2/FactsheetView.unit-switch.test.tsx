import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import type { FactsheetPayload } from "@/lib/factsheet/types";
import { buildScenarioFactsheetPayload } from "@/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload";
import { formatCloseDay } from "@/lib/factsheet/returns-unit";
import { parseUnitSwitch, type UnitSegmentsView, type UnitSwitchView } from "@/lib/factsheet/unit-segments";
import { FactsheetProvider } from "./factsheet-context";
import { FactsheetBody } from "./FactsheetView";

/**
 * Phase 256 OKXUNITSWITCH plan 05 (SC-3, UI-SPEC B) — a switched strategy's masthead says so, from
 * the payload's parsed switch and from nothing else.
 *
 * The intent behind each arm: the sentence is built from the DERIVED days (a second fixture with
 * other days and another coin proves no literal), the unpriced note names every day the USD figures
 * leave out with its count agreeing, and a payload with no switch renders today's USD factsheet with
 * no disclosure at all.
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

function sw(coin: string, last: string, first: string): UnitSwitchView {
  const v = parseUnitSwitch({ coin, last_usd_day: last, first_coin_return_day: first });
  expect(v, "fixture switch must parse").not.toBeNull();
  return v as UnitSwitchView;
}

function segmentsWithUnpriced(unpricedDays: string[], withheldDays: string[] = []): UnitSegmentsView {
  return {
    fromReturns: [{ date: "2026-11-14", value: 0.01 }],
    toReturns: [],
    baseDay: "2026-11-14",
    unpricedDays,
    withheldDays,
  };
}

function switched(unitSwitch: UnitSwitchView, unitSegments?: UnitSegmentsView): FactsheetPayload {
  return { ...BASE, unitSwitch, ...(unitSegments ? { unitSegments } : {}) } as FactsheetPayload;
}

function renderFactsheet(payload: FactsheetPayload) {
  return render(
    <FactsheetProvider payload={payload} persist={false}>
      <FactsheetBody payload={payload} hideFooter showAum />
    </FactsheetProvider>,
  );
}

const DISCLOSURE = '[data-testid="factsheet-unit-switch-disclosure"]';

describe("UnitSwitchDisclosure — the masthead switch sentence", () => {
  it("renders the sentence from the derived days, with a full stop, as the last child of the header", () => {
    const { container } = renderFactsheet(switched(sw("BTC", "2026-11-14", "2026-11-15")));
    const el = container.querySelector(DISCLOSURE) as HTMLElement;
    expect(el, "the disclosure did not render").not.toBeNull();
    const first = el.querySelector("p") as HTMLElement;
    expect(first.textContent).toBe(
      `In USD to ${formatCloseDay("2026-11-14")}, in BTC from ${formatCloseDay("2026-11-15")}.`,
    );
    expect((first.textContent ?? "").replace(/ /g, " ")).toBe("In USD to Nov 14, 2026, in BTC from Nov 15, 2026.");
    const header = el.closest("header") as HTMLElement;
    expect(header.lastElementChild).toBe(el);
  });

  it("a second fixture with other days and another coin renders its own text (label binding, no literal)", () => {
    const { container } = renderFactsheet(switched(sw("ETH", "2026-10-02", "2026-10-03"), segmentsWithUnpriced([])));
    const text = (container.querySelector(DISCLOSURE) as HTMLElement).textContent ?? "";
    expect(text.replace(/ /g, " ")).toBe("In USD to Oct 2, 2026, in ETH from Oct 3, 2026.");
    expect(text).not.toContain("BTC");
    expect(text).not.toContain("Nov");
  });

  it("uses the UsdDisclosure shell classes and neutral tone: plain wrapping text, never amber or red", () => {
    const { container } = renderFactsheet(switched(sw("BTC", "2026-11-14", "2026-11-15"), segmentsWithUnpriced(["2026-11-16"])));
    const el = container.querySelector(DISCLOSURE) as HTMLElement;
    expect(el.className).toBe("mt-4 flex max-w-3xl flex-col gap-1");
    const ps = Array.from(el.querySelectorAll("p"));
    expect(ps).toHaveLength(2);
    for (const p of ps) {
      expect(p.className).toBe("text-caption text-text-muted");
      expect(p.className).not.toMatch(/truncate|ellipsis|amber|red|warning/);
    }
  });

  it("is a masthead element, so it prints (no print-hidden ancestor)", () => {
    const { container } = renderFactsheet(switched(sw("BTC", "2026-11-14", "2026-11-15")));
    const el = container.querySelector(DISCLOSURE) as HTMLElement;
    let n: HTMLElement | null = el;
    while (n) {
      expect(n.className).not.toMatch(/print:hidden|hidden/);
      n = n.parentElement;
    }
  });

  it("has no Returns-in-unit chip, no unit toggle and no USD disclosure: a switched headline is USD", () => {
    const { container } = renderFactsheet(switched(sw("BTC", "2026-11-14", "2026-11-15")));
    expect(container.querySelector("[data-returns-unit]")).toBeNull();
    expect(container.querySelector('[data-testid="factsheet-unit-toggle"]')).toBeNull();
    expect(container.querySelector('[data-testid="factsheet-usd-disclosure"]')).toBeNull();
    expect(container.textContent).not.toContain("Returns in BTC");
  });

  it("no unpriced days: line 2 is absent", () => {
    const { container } = renderFactsheet(switched(sw("BTC", "2026-11-14", "2026-11-15"), segmentsWithUnpriced([])));
    expect(container.querySelector('[data-testid="factsheet-unit-switch-unpriced-note"]')).toBeNull();
  });

  it("one unpriced day: says day and that day", () => {
    const { container } = renderFactsheet(switched(sw("BTC", "2026-11-14", "2026-11-15"), segmentsWithUnpriced(["2026-11-17"])));
    const note = (container.querySelector('[data-testid="factsheet-unit-switch-unpriced-note"]') as HTMLElement).textContent ?? "";
    expect(note).toContain("No BTC close for 1 day:");
    expect(note).toContain(formatCloseDay("2026-11-17"));
    expect(note).toContain("The USD figures leave that day out.");
  });

  it("several unpriced days: says days and those days, and lists every run", () => {
    const { container } = renderFactsheet(
      switched(sw("BTC", "2026-11-14", "2026-11-15"), segmentsWithUnpriced(["2026-11-17", "2026-11-18", "2026-11-25"])),
    );
    const note = (container.querySelector('[data-testid="factsheet-unit-switch-unpriced-note"]') as HTMLElement).textContent ?? "";
    expect(note).toContain("No BTC close for 3 days:");
    expect(note).toContain(`${formatCloseDay("2026-11-17")} – ${formatCloseDay("2026-11-18")}`);
    expect(note).toContain(formatCloseDay("2026-11-25"));
    expect(note).toContain("The USD figures leave those days out.");
  });

  it("R3-06: withheld days get their own line, worded by their own cause and never as a missing close", () => {
    const { container } = renderFactsheet(
      switched(sw("BTC", "2026-11-14", "2026-11-15"), segmentsWithUnpriced([], ["2026-11-10", "2026-11-11"])),
    );
    const note = (container.querySelector('[data-testid="factsheet-unit-switch-withheld-note"]') as HTMLElement).textContent ?? "";
    expect(note).toContain("No stored USD value for 2 days around the move into BTC:");
    expect(note).toContain("The USD figures leave those days out.");
    expect(note).not.toContain("close");
    expect(container.querySelector('[data-testid="factsheet-unit-switch-unpriced-note"]')).toBeNull();
  });

  it("R3-06: both causes at once print two lines, each with its own days", () => {
    const { container } = renderFactsheet(
      switched(sw("BTC", "2026-11-14", "2026-11-15"), segmentsWithUnpriced(["2026-11-17"], ["2026-11-10"])),
    );
    const unpriced = (container.querySelector('[data-testid="factsheet-unit-switch-unpriced-note"]') as HTMLElement).textContent ?? "";
    const withheld = (container.querySelector('[data-testid="factsheet-unit-switch-withheld-note"]') as HTMLElement).textContent ?? "";
    expect(unpriced).toContain(formatCloseDay("2026-11-17"));
    expect(unpriced).not.toContain(formatCloseDay("2026-11-10"));
    expect(withheld).toContain(formatCloseDay("2026-11-10"));
    expect(withheld).not.toContain(formatCloseDay("2026-11-17"));
  });

  // SF-04 / IN-04: a switch whose sidecar did not read (absent, malformed, or a different
  // generation than the flag) must not pass for "no unpriced days". The unpriced list is unknown,
  // so the masthead names that instead of going silent.
  it("a switch with no sidecar states the sentence and names that the segments are unavailable, never a silent single line", () => {
    const { container } = renderFactsheet(switched(sw("ETH", "2026-11-14", "2026-11-15")));
    expect(container.querySelector(DISCLOSURE)).not.toBeNull();
    expect(container.querySelector('[data-testid="factsheet-unit-switch-unpriced-note"]')).toBeNull();
    const note = (container.querySelector('[data-testid="factsheet-unit-switch-segments-unavailable"]') as HTMLElement | null)?.textContent;
    expect(note, "the unavailable note did not render").toBe(
      "The USD and ETH lines and any days with no ETH close are not available for this record.",
    );
  });

  it("a switch whose sidecar read carries no unavailable note", () => {
    const { container } = renderFactsheet(switched(sw("BTC", "2026-11-14", "2026-11-15"), segmentsWithUnpriced([])));
    expect(container.querySelector('[data-testid="factsheet-unit-switch-segments-unavailable"]')).toBeNull();
  });

  it("an absent unitSwitch renders no disclosure and leaves the masthead as a USD strategy's", () => {
    const usd = renderFactsheet({ ...BASE } as FactsheetPayload);
    expect(usd.container.querySelector(DISCLOSURE)).toBeNull();
    expect(usd.container.textContent).not.toMatch(/In USD to/);
  });
});
