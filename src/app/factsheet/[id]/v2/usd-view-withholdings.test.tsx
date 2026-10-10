/** @vitest-environment jsdom */
/**
 * Phase 164.6.6.2.1 plan 12 (D-15, D-19, D-21; UI-SPEC rule 5, Copywriting Contract
 * "Benchmark-vs-BTC copy, USD view") — every benchmark-vs-BTC withholding of 164.6.6.2
 * stays in the USD view, in the same place with the same DOM, and only the REASON changes.
 *
 * Why the reason must change: a BTC-denominated account's USD series carries about one BTC
 * beta by construction, so the figure stays hidden. But the native view's sentence "a BTC
 * benchmark measured in BTC is a flat line" is FALSE for a USD series, and "returns are in
 * BTC" is false too (they were converted). Each arm asserts the literal, so a regression to
 * the native wording fails here rather than shipping a false claim to an LP.
 *
 * Both halves must be able to fail:
 *   USD    — each USD-view string renders, `flat line` never does, SPX still renders.
 *   NATIVE — the same panels, same payload, native fixture: the 164.6.6.2 copy byte-for-byte.
 *
 * The USD-view payload is the native fixture with `returnsUnit: "USD"` and
 * `convertedFrom: "BTC"`, the two fields plan 11's server builder sets. The withholdings
 * trigger on the SET unit (unchanged); the reason switches on `convertedFrom`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { buildFactsheetPayload } from "@/lib/factsheet/build-payload";
import type { FactsheetPayload, StressWindowPayload } from "@/lib/factsheet/types";

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
import { ComparatorPicker } from "./ComparatorPicker";
import { MetricsColumn } from "./MetricsColumn";
import { SignaturesSection } from "./SignaturePanels";
import { CrossSignaturesSection } from "./CrossSignaturePanels";
import { CorrelationStripPanel, CorrelationsMatrixPanel } from "./DistributionPanels";
import { StressWindowsPanel } from "./StressWindowsPanel";

const DAY = 86_400_000;
const START = Date.parse("2025-06-01T00:00:00Z");

/** The SAME series for every payload in this file. */
const DAILY = Array.from({ length: 200 }, (_, i) => ({
  date: new Date(START + i * DAY).toISOString().slice(0, 10),
  value: (i % 2 === 0 ? 1 : -1) * (0.004 + (i % 5) * 0.001),
}));

type Cmp = FactsheetPayload["activeComparator"];
type View = "native" | "usd";

/**
 * A native-unit (BTC) payload, or its USD view: the same fixture with the two fields the
 * USD-view builder sets. The server pins a unit's default comparator to "none"; a test picks
 * SPX the way the picker does.
 */
function makePayload(view: View, cmp: Cmp): FactsheetPayload & { ingestSource: "api" } {
  const payload = buildFactsheetPayload(
    {
      id: "p12-strategy",
      name: "Plan 12 Strategy",
      types: ["quant"],
      markets: ["crypto"],
      computedAt: "2026-09-30T00:00:00Z",
      trustTier: null,
      ingestSource: "api",
    },
    DAILY,
    { returnsUnit: "BTC" },
  );
  if (!payload || payload.ingestSource !== "api") throw new Error("fixture must build on the api arm");
  const base = { ...payload, activeComparator: cmp };
  return view === "usd" ? { ...base, returnsUnit: "USD", convertedFrom: "BTC" } : base;
}

function renderIn(payload: FactsheetPayload, node: React.ReactElement) {
  return render(
    <FactsheetProvider payload={payload} persist={false}>
      {node}
    </FactsheetProvider>,
  );
}

const sectionIV = (container: HTMLElement): HTMLElement | null => {
  const h2 = Array.from(container.querySelectorAll("h2")).find((h) => (h.textContent ?? "").startsWith("Benchmark"));
  return (h2?.closest("section") as HTMLElement | null) ?? null;
};

describe("the comparator names the right reason in each view", () => {
  it("USD view: no BTC button, the converted-from reason, SPX still offered", () => {
    const { container } = renderIn(makePayload("usd", "none"), <ComparatorPicker />);
    expect(screen.queryByRole("button", { name: /BTC/ })).toBeNull();
    expect(screen.getByRole("button", { name: /SPX/ })).toBeDefined();
    expect(container.textContent).toContain("BTC not available: returns are converted from BTC");
    expect(container.textContent).not.toContain("returns are in");
  });

  it("native view: 'returns are in BTC', unchanged", () => {
    const { container } = renderIn(makePayload("native", "none"), <ComparatorPicker />);
    expect(screen.queryByRole("button", { name: /BTC/ })).toBeNull();
    expect(container.textContent).toContain("BTC not available: returns are in BTC");
    expect(container.textContent).not.toContain("converted");
  });
});

describe("§IV Benchmark: the metrics column", () => {
  const USD_REASON =
    "Not measurable: returns are converted from BTC, so they carry the BTC price by construction.";

  it("USD view: every row '—' and the converted-from reason, never the flat-line sentence", () => {
    const { container } = renderIn(makePayload("usd", "none"), <MetricsColumn />);
    const sec = sectionIV(container);
    expect(sec, "the USD view keeps §IV exactly as the native view does").not.toBeNull();
    expect(sec!.querySelector("h2")!.textContent).toBe("Benchmark — vs BTC");
    expect(sec!.querySelector('[data-testid="joint-floor-reason"]')!.textContent).toBe(USD_REASON);
    for (const tr of Array.from(sec!.querySelectorAll("tbody tr"))) {
      expect(tr.querySelectorAll("td")[1].textContent).toBe("—");
    }
    expect(container.textContent).not.toContain("flat line");
    // α / IR vs BTC are not rendered as figures anywhere in the column.
    expect(container.textContent).not.toMatch(/(α|IR) vs BTC/);
  });

  it("native view: the 164.6.6.2 sentence, flat line included, byte-for-byte", () => {
    const { container } = renderIn(makePayload("native", "none"), <MetricsColumn />);
    expect(sectionIV(container)!.querySelector('[data-testid="joint-floor-reason"]')!.textContent).toBe(
      "Not measurable: returns are in BTC. A BTC benchmark measured in BTC is a flat line.",
    );
  });

  it("USD view with SPX active: §IV equals the native view's SPX §IV (D-15: SPX is untouched)", () => {
    const usd = renderIn(makePayload("usd", "spx"), <MetricsColumn />);
    const native = renderIn(makePayload("native", "spx"), <MetricsColumn />);
    const a = sectionIV(usd.container)!;
    expect(a.querySelector("h2")!.textContent).toBe("Benchmark — vs SPX");
    expect(a.innerHTML).toBe(sectionIV(native.container)!.innerHTML);
    expect(Array.from(a.querySelectorAll("tbody tr")).some((tr) => tr.querySelectorAll("td")[1].textContent !== "—")).toBe(
      true,
    );
    expect(a.querySelector('[data-testid="joint-floor-reason"]')).toBeNull();
  });
});

describe("Returns Signatures and Cross Signatures are BTC event studies", () => {
  for (const [name, node] of [
    ["SignaturesSection", <SignaturesSection key="s" />],
    ["CrossSignaturesSection", <CrossSignaturesSection key="c" />],
  ] as const) {
    it(`${name}, USD view: every panel is the empty form with the converted-from reason, no chart`, () => {
      const { container } = renderIn(makePayload("usd", "spx"), node);
      const empty = container.querySelectorAll("figure[data-signature-empty]");
      expect(empty).toHaveLength(8);
      expect(container.querySelectorAll("figure")).toHaveLength(8);
      expect(container.querySelectorAll("svg")).toHaveLength(0);
      for (const f of Array.from(empty)) {
        expect(f.textContent).toContain("Not measurable: returns are converted from BTC.");
        expect(f.textContent).not.toContain("returns are in");
      }
    });

    it(`${name}, native view: 'Not measurable: returns are in BTC.' as in 164.6.6.2`, () => {
      const { container } = renderIn(makePayload("native", "spx"), node);
      const empty = container.querySelectorAll("figure[data-signature-empty]");
      expect(empty).toHaveLength(8);
      for (const f of Array.from(empty)) {
        expect(f.textContent).toContain("Not measurable: returns are in BTC.");
        expect(f.textContent).not.toContain("converted");
      }
    });
  }
});

/** The strip's rows: name, the rho text, and whether a bar was drawn. */
function stripRows(container: HTMLElement) {
  const groups = [...container.querySelectorAll("svg g")].filter((g) => g.querySelectorAll("text").length === 2);
  return groups.map((g) => {
    const t = g.querySelectorAll("text");
    return { name: t[0].textContent ?? "", rho: t[1].textContent ?? "", bars: g.querySelectorAll("rect").length };
  });
}

describe("Cross-Asset Correlation strip and Correlations matrix", () => {
  const subtitle = (c: HTMLElement) => c.querySelector("figure header p")!.textContent ?? "";

  it("strip, USD view: BTC row '—' with no bar, the converted-from sentence, the other rows as native", () => {
    const usd = renderIn(makePayload("usd", "spx"), <CorrelationStripPanel />).container;
    const native = renderIn(makePayload("native", "spx"), <CorrelationStripPanel />).container;
    const btc = stripRows(usd).find((r) => r.name === "BTC")!;
    expect(btc.rho).toBe("—");
    expect(btc.bars).toBe(0);
    expect(subtitle(usd)).toContain("BTC row not measurable: returns are converted from BTC.");
    expect(subtitle(usd)).not.toContain("returns are in");
    const others = (c: HTMLElement) => stripRows(c).filter((r) => r.name !== "BTC");
    expect(others(usd)).toHaveLength(4);
    expect(others(usd)).toEqual(others(native));
    expect(others(usd).every((r) => r.rho !== "—" && r.bars === 1)).toBe(true);
  });

  it("strip, native view: 'BTC row not measurable: returns are in BTC.'", () => {
    const { container } = renderIn(makePayload("native", "spx"), <CorrelationStripPanel />);
    expect(subtitle(container)).toContain("BTC row not measurable: returns are in BTC.");
  });

  it("matrix, USD view: the caption appears once with the converted-from reason", () => {
    const { container } = renderIn(makePayload("usd", "spx"), <CorrelationsMatrixPanel />);
    const caption = "Strategy × BTC not measurable: returns are converted from BTC.";
    expect((container.textContent ?? "").split(caption)).toHaveLength(2);
    expect(container.textContent).not.toContain("returns are in");
  });

  it("matrix, native view: 'Strategy × BTC not measurable: returns are in BTC.'", () => {
    const { container } = renderIn(makePayload("native", "spx"), <CorrelationsMatrixPanel />);
    expect(container.textContent).toContain("Strategy × BTC not measurable: returns are in BTC.");
  });
});

const STRESS: StressWindowPayload = {
  windows: [
    {
      name: "Aug 2025 unwind",
      note: "a named event",
      start: "2025-08-02",
      end: "2025-08-09",
      days: 8,
      expectedCalendarDays: 8,
      coverage: "full",
      stratReturn: -0.031,
      benchReturn: -0.12,
      stratMaxDD: -0.042,
      benchMaxDD: -0.2,
    },
  ],
  benchName: "BTC",
  totalCatalogued: 1,
  droppedOutOfRange: 0,
  droppedPartial: 0,
};

const stressPayload = (view: View): FactsheetPayload => ({ ...makePayload(view, "none"), stressWindows: STRESS });

describe("Stress Windows", () => {
  const subtitle = (c: HTMLElement) => c.querySelector("figure header p")!.textContent ?? "";
  const cells = (c: HTMLElement) =>
    Array.from(c.querySelectorAll("tbody tr")).map((tr) => Array.from(tr.querySelectorAll("td")).map((td) => td.textContent ?? ""));

  it("USD view: subtitle reads 'in USD' + the converted-from reason, the BTC column cells read '—'", () => {
    const { container } = renderIn(stressPayload("usd"), <StressWindowsPanel />);
    expect(subtitle(container)).toBe(
      "strategy compounded return in USD + max drawdown during named market events · BTC column not shown: returns are converted from BTC",
    );
    expect(cells(container)[0].slice(5)).toEqual(["—", "—"]);
  });

  it("native view: the 164.6.6.2 subtitle byte-for-byte", () => {
    const { container } = renderIn(stressPayload("native"), <StressWindowsPanel />);
    expect(subtitle(container)).toBe(
      "strategy compounded return in BTC + max drawdown during named market events · BTC column not shown: returns are in BTC",
    );
  });
});

describe("the substring 'flat line' and the quote pair never render in the USD view (D-15, D-21)", () => {
  const panels: Array<[string, React.ReactElement]> = [
    ["ComparatorPicker", <ComparatorPicker key="a" />],
    ["MetricsColumn", <MetricsColumn key="b" />],
    ["SignaturesSection", <SignaturesSection key="c" />],
    ["CrossSignaturesSection", <CrossSignaturesSection key="d" />],
    ["CorrelationStripPanel", <CorrelationStripPanel key="e" />],
    ["CorrelationsMatrixPanel", <CorrelationsMatrixPanel key="f" />],
    ["StressWindowsPanel", <StressWindowsPanel key="g" />],
  ];
  for (const view of ["usd", "native"] as const) {
    for (const cmp of ["none", "spx"] as const) {
      it(`${view} view, comparator ${cmp}: no panel names a quote pair, and the USD view never says 'flat line'`, () => {
        const payload = { ...stressPayload(view), activeComparator: cmp } as FactsheetPayload;
        for (const [name, node] of panels) {
          const { container, unmount } = renderIn(payload, node);
          const text = container.textContent ?? "";
          expect(text, name).not.toMatch(/BTC\/USDT/);
          if (view === "usd") expect(text, name).not.toContain("flat line");
          unmount();
        }
      });
    }
  }
});
