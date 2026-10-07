/** @vitest-environment jsdom */
/**
 * Phase 164.6.6.2 plan 06 (D-10, D-17; UI-SPEC A5, A11, A14-A22) — a strategy whose
 * returns are in BTC is never compared with BTC, and nothing else is hidden.
 *
 * Two halves, and both must be able to fail:
 *   WITHHELD  — every figure that pairs the strategy with BTC (a BTC benchmark in
 *               BTC is a flat line; the USD-priced one mixes units) reads "—",
 *               untoned, under a line that says `returns are in BTC`.
 *   UNCHANGED — D-17 narrowed D-10 to ONLY those figures. Every SPX-dependent
 *               figure, every non-BTC correlation, the demo blends and the peer
 *               percentile render the SAME text and DOM as the no-unit build of
 *               the same series. A comparison that goes `—` "because of the unit"
 *               is the over-reach D-17 forbids.
 *
 * The no-unit payload below is built from the SAME `dailyReturns` as the unit
 * payload, so the unchanged half is a measurement against the current build, not
 * against a hand-typed expectation.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { buildFactsheetPayload } from "@/lib/factsheet/build-payload";
import type { FactsheetPayload } from "@/lib/factsheet/types";

vi.mock("@/hooks/useBreakpoint", () => ({
  useBreakpoint: vi.fn(() => "desktop" as const),
}));
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
  lsStore.clear();
});
Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
  configurable: true,
});

import { FactsheetProvider } from "./factsheet-context";
import { FactsheetBody } from "./FactsheetView";
import { MetricsColumn } from "./MetricsColumn";
import { SignaturesSection } from "./SignaturePanels";
import { CrossSignaturesSection } from "./CrossSignaturePanels";

const DAY = 86_400_000;
const START = Date.parse("2025-06-01T00:00:00Z");

/** The SAME series for every payload in this file, unit or not. */
const DAILY = Array.from({ length: 200 }, (_, i) => ({
  date: new Date(START + i * DAY).toISOString().slice(0, 10),
  value: (i % 2 === 0 ? 1 : -1) * (0.004 + (i % 5) * 0.001),
}));

type Cmp = FactsheetPayload["activeComparator"];

function makePayload(unit: string | null, cmp: Cmp): FactsheetPayload & { ingestSource: "api" } {
  const payload = buildFactsheetPayload(
    {
      id: "p06-strategy",
      name: "Plan 06 Strategy",
      types: ["quant"],
      markets: ["crypto"],
      computedAt: "2026-09-30T00:00:00Z",
      trustTier: null,
      ingestSource: "api",
    },
    DAILY,
    unit === null ? undefined : { returnsUnit: unit },
  );
  if (!payload || payload.ingestSource !== "api") throw new Error("fixture must build on the api arm");
  // The server pins a unit's default to "none"; a test picks SPX the way the picker does.
  return { ...payload, activeComparator: cmp };
}

function renderIn(payload: FactsheetPayload, node: React.ReactElement) {
  return render(
    <FactsheetProvider payload={payload} persist={false}>
      {node}
    </FactsheetProvider>,
  );
}

function renderBody(payload: FactsheetPayload) {
  return renderIn(payload, <FactsheetBody payload={payload} hideAllocatorSection hideFooter />);
}

/** The §IV `Benchmark` section, or null when the rail does not render one. */
function sectionIV(container: HTMLElement): HTMLElement | null {
  const h2 = Array.from(container.querySelectorAll("h2")).find((h) => (h.textContent ?? "").startsWith("Benchmark"));
  return (h2?.closest("section") as HTMLElement | null) ?? null;
}

/** Every row's value cell (the second `td`) in a section. */
function valueCells(section: HTMLElement): HTMLElement[] {
  return Array.from(section.querySelectorAll("tbody tr")).map((tr) => tr.querySelectorAll("td")[1] as HTMLElement);
}

const kpiLabels = (c: HTMLElement) =>
  Array.from(c.querySelectorAll<HTMLElement>('[data-testid="factsheet-kpi-label"]')).map((el) => el.textContent ?? "");

/** The unit label the no-unit build does not carry. Stripping it leaves the rest comparable. */
const stripUnit = (html: string) => html.replaceAll(" in BTC", "");

describe("preconditions: the fixture measures something", () => {
  it("SPX has a real joint on the shared series, so an SPX figure that went '—' would be a visible change", () => {
    const p = makePayload(null, "spx");
    expect(p.comparators.spx.joint).not.toBeNull();
    expect(Number.isFinite(p.comparators.spx.joint!.alpha)).toBe(true);
  });

  it("the unit payload carries the same SPX joint as the no-unit payload (the builder does not touch SPX)", () => {
    expect(makePayload("BTC", "spx").comparators.spx.joint).toEqual(makePayload(null, "spx").comparators.spx.joint);
  });
});

describe("A15 §IV Benchmark", () => {
  it("BTC unit, no comparator: 'Benchmark — vs BTC', every row '—', untoned, with the stated reason", () => {
    const { container } = renderIn(makePayload("BTC", "none"), <MetricsColumn />);
    const sec = sectionIV(container);
    expect(sec, "a BTC strategy must still show its Benchmark section").not.toBeNull();
    expect(sec!.querySelector("h2")!.textContent).toBe("Benchmark — vs BTC");
    const cells = valueCells(sec!);
    expect(cells.length).toBe(9);
    for (const td of cells) {
      expect(td.textContent).toBe("—");
      expect(td.className).not.toContain("text-accent");
      expect(td.className).toContain("text-text-primary");
    }
    expect(sec!.querySelector('[data-testid="joint-floor-reason"]')!.textContent).toBe(
      "Not measurable: returns are in BTC. A BTC benchmark measured in BTC is a flat line.",
    );
  });

  it("the reason composes from the unit, so another unit reads its own code", () => {
    const { container } = renderIn(makePayload("ETH", "none"), <MetricsColumn />);
    expect(sectionIV(container)!.querySelector('[data-testid="joint-floor-reason"]')!.textContent).toBe(
      "Not measurable: returns are in ETH. A BTC benchmark measured in ETH is a flat line.",
    );
  });

  it("BTC unit, SPX active: 'Benchmark — vs SPX' and the §IV text and DOM equal the no-unit build (D-17)", () => {
    const unit = renderIn(makePayload("BTC", "spx"), <MetricsColumn />);
    const plain = renderIn(makePayload(null, "spx"), <MetricsColumn />);
    const a = sectionIV(unit.container)!;
    const b = sectionIV(plain.container)!;
    expect(a.querySelector("h2")!.textContent).toBe("Benchmark — vs SPX");
    expect(a.textContent).toBe(b.textContent);
    expect(a.innerHTML).toBe(b.innerHTML);
    // Not vacuous: the SPX joint is a number, not a row of dashes.
    expect(valueCells(a).some((td) => td.textContent !== "—")).toBe(true);
    expect(a.querySelector('[data-testid="joint-floor-reason"]')).toBeNull();
  });

  it("the whole SPX rail of a BTC strategy equals the no-unit rail, apart from the unit in its labels (D-17, A14)", () => {
    const unit = renderIn(makePayload("BTC", "spx"), <MetricsColumn />);
    const plain = renderIn(makePayload(null, "spx"), <MetricsColumn />);
    expect(stripUnit(unit.container.innerHTML)).toBe(plain.container.innerHTML);
  });

  it("a USD strategy with no comparator renders no §IV at all, as today", () => {
    const { container } = renderIn(makePayload(null, "none"), <MetricsColumn />);
    expect(sectionIV(container)).toBeNull();
  });
});

describe("A16 Returns Signatures are BTC event studies, so they stay withheld", () => {
  const REASON = "Not measurable: returns are in BTC.";

  for (const cmp of ["none", "spx"] as const) {
    it(`SignaturesSection, comparator ${cmp}: every panel is the empty form with the reason, no chart`, () => {
      const { container } = renderIn(makePayload("BTC", cmp), <SignaturesSection />);
      const empty = container.querySelectorAll("figure[data-signature-empty]");
      expect(empty).toHaveLength(8);
      expect(container.querySelectorAll("figure")).toHaveLength(8);
      expect(container.querySelectorAll("svg")).toHaveLength(0);
      for (const f of Array.from(empty)) {
        expect(f.textContent).toContain("—");
        expect(f.textContent).toContain(REASON);
      }
    });

    it(`CrossSignaturesSection, comparator ${cmp}: every panel is the empty form with the reason, no chart`, () => {
      const { container } = renderIn(makePayload("BTC", cmp), <CrossSignaturesSection />);
      const empty = container.querySelectorAll("figure[data-signature-empty]");
      expect(empty).toHaveLength(8);
      expect(container.querySelectorAll("figure")).toHaveLength(8);
      expect(container.querySelectorAll("svg")).toHaveLength(0);
      for (const f of Array.from(empty)) {
        expect(f.textContent).toContain(REASON);
      }
    });
  }

  it("a USD strategy still charts both sections (the gate is the unit)", () => {
    const sig = renderIn(makePayload(null, "spx"), <SignaturesSection />);
    expect(sig.container.querySelectorAll("figure[data-signature-empty]")).toHaveLength(0);
    expect(sig.container.querySelectorAll("svg").length).toBeGreaterThan(0);
    const cross = renderIn(makePayload(null, "spx"), <CrossSignaturesSection />);
    expect(cross.container.querySelectorAll("figure[data-signature-empty]")).toHaveLength(0);
    expect(cross.container.querySelectorAll("svg").length).toBeGreaterThan(0);
  });

  it("the section is mounted and in the nav for a BTC strategy with NO comparator, but not for a USD one", () => {
    const unit = renderBody(makePayload("BTC", "none"));
    expect(unit.container.querySelector("#factsheet-signatures")).not.toBeNull();
    expect(unit.container.querySelector('a[href="#factsheet-signatures"]')).not.toBeNull();
    const plain = renderBody(makePayload(null, "none"));
    expect(plain.container.querySelector("#factsheet-signatures")).toBeNull();
    expect(plain.container.querySelector('a[href="#factsheet-signatures"]')).toBeNull();
  });
});

describe("A5 KPI strip never carries a BTC-relative cell", () => {
  it("SPX active: 9 cells, α vs SPX and IR vs SPX, nothing vs BTC", () => {
    const labels = kpiLabels(renderBody(makePayload("BTC", "spx")).container);
    expect(labels).toHaveLength(9);
    expect(labels).toContain("α vs SPX");
    expect(labels).toContain("IR vs SPX");
    expect(labels.some((l) => l.includes("vs BTC"))).toBe(false);
  });

  it("no comparator: 7 cells, nothing vs anything", () => {
    const labels = kpiLabels(renderBody(makePayload("BTC", "none")).container);
    expect(labels).toHaveLength(7);
    expect(labels.some((l) => l.includes(" vs "))).toBe(false);
  });

  it("the SPX α and IR values equal the no-unit strip's (D-17)", () => {
    const value = (c: HTMLElement, label: string) => {
      const el = Array.from(c.querySelectorAll<HTMLElement>('[data-testid="factsheet-kpi-label"]')).find(
        (e) => e.textContent === label,
      )!;
      return el.parentElement!.textContent!.replace(label, "");
    };
    const unit = renderBody(makePayload("BTC", "spx")).container;
    const plain = renderBody(makePayload(null, "spx")).container;
    for (const label of ["α vs SPX", "IR vs SPX"]) {
      expect(value(unit, label)).toBe(value(plain, label));
      expect(value(unit, label)).not.toBe("—");
    }
  });
});
