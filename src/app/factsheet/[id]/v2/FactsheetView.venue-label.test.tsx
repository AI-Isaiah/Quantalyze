import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import type { FactsheetPayload, TrustTierKind } from "@/lib/factsheet/types";
import { buildFactsheetPayload } from "@/lib/factsheet/build-payload";
import { FactsheetProvider } from "./factsheet-context";
import { FactsheetBody } from "./FactsheetView";

/**
 * Phase 170.2 (PROBEFIXES) SC-4, D-09 — the masthead venue label.
 *
 * THE REQUIREMENT: a CSV-ingested strategy with a declared venue shows
 * `{venue} · self-reported` in the factsheet masthead; one with no declared
 * venue shows no venue label (Phase 170 copy row, 169-routed (b)).
 *
 * WHY the fixtures are PROD-shaped. The marker is `strategies.source = 'csv'`,
 * carried as the payload field `source`. `ingestSource` is derived from
 * `strategy_analytics.daily_returns`, which is SQL NULL on every PROD strategy,
 * so it reads "api" for a real CSV strategy. A fixture that sets
 * `ingestSource: "csv"` would pass while PROD shows no label (research Finding
 * F-1). So every "renders" case here is `source: "csv"` + `ingestSource: "api"`,
 * built through the production `buildFactsheetPayload`, and the composite case
 * (ingestSource "csv", no source) pins that the OTHER marker does not render it.
 *
 * Neutering the label condition back to `payload.ingestSource === "csv"` turns
 * the PROD-shaped cases RED (the neuter proof is recorded in the SUMMARY).
 *
 * Harness mirrors FactsheetView.chip-honesty.test.tsx (same masthead).
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
// Installed PER TEST: `vitest.config.ts` sets `unstubGlobals: true`.
beforeEach(() => {
  vi.stubGlobal("localStorage", localStorageMock);
});
Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
  configurable: true,
});

const PILL_TITLE_WITH_LABEL =
  "These fields (leverage, markets) are author-declared and have not been verified by Quantalyze";
const PILL_TITLE_UNCHANGED =
  "These fields (exchanges, leverage, markets) are author-declared and have not been verified by Quantalyze";

function series(n: number) {
  const out: { date: string; value: number }[] = [];
  const t0 = Date.UTC(2025, 0, 1);
  for (let i = 0; i < n; i++) {
    out.push({
      date: new Date(t0 + i * 86_400_000).toISOString().slice(0, 10),
      value: 0.001 + Math.sin(i * 0.31) * 0.006,
    });
  }
  return out;
}

interface Fixture {
  source?: string | null;
  ingestSource?: "api" | "csv";
  exchanges?: string[];
  trustTier?: TrustTierKind | null;
  leverage?: string | null;
  markets?: string[];
  types?: string[];
}

function payloadFor(f: Fixture): FactsheetPayload {
  return buildFactsheetPayload(
    {
      id: "s-170-2-venue",
      name: "Venue Fixture",
      types: f.types ?? [],
      markets: f.markets ?? [],
      computedAt: "2025-06-01T00:00:00Z",
      trustTier: f.trustTier ?? null,
      ingestSource: f.ingestSource ?? "api",
      source: f.source ?? null,
      assetClass: "crypto",
      description: null,
      subtypes: [],
      supportedExchanges: f.exchanges ?? [],
      leverageRange: f.leverage ?? null,
      aum: null,
      maxCapacity: null,
      avgDailyTurnover: null,
      startDate: "2025-01-01",
      benchmark: "BTC",
    },
    series(200),
  )!;
}

function renderHeader(payload: FactsheetPayload) {
  const view = render(
    <FactsheetProvider payload={payload} persist={false}>
      <FactsheetBody payload={payload} hideAllocatorSection hideFooter />
    </FactsheetProvider>,
  );
  const header = view.container.querySelector("header") as HTMLElement;
  expect(header, "masthead not found").not.toBeNull();
  return header;
}

/** The chip line is the tier row's `text-caption text-text-secondary` span that is not the venue label. */
function chipLine(header: HTMLElement): HTMLElement | null {
  const spans = Array.from(
    header.querySelectorAll<HTMLElement>('span.text-caption.text-text-secondary'),
  ).filter((s) => s.dataset.testid !== "masthead-venue-label");
  return spans[0] ?? null;
}

function pill(header: HTMLElement): HTMLElement | null {
  return header.querySelector<HTMLElement>('span[title^="These fields ("]');
}

describe("SC-4 — masthead venue label (UI-SPEC M-1 to M-7)", () => {
  it("PROD-shaped csv strategy with a declared venue: exactly one label, 'Binance · self-reported', venue not repeated in the chip line", () => {
    const payload = payloadFor({
      source: "csv",
      ingestSource: "api", // what PROD reads for a csv strategy (daily_returns is NULL)
      exchanges: ["Binance"],
      trustTier: "csv_uploaded",
    });
    expect(payload.ingestSource).toBe("api");
    expect(payload.source).toBe("csv");
    const header = renderHeader(payload);
    const labels = header.querySelectorAll('[data-testid="masthead-venue-label"]');
    expect(labels).toHaveLength(1);
    // U+00B7 between two single spaces, one text node.
    expect(labels[0].textContent).toBe("Binance · self-reported");
    expect(labels[0].childNodes).toHaveLength(1);
    const chips = chipLine(header);
    // The venue was the only declared chip: the chip line is omitted, not '—'.
    expect(chips).toBeNull();
    // No element is the bare em-dash fallback (TrustTierLabel's own copy has an
    // em-dash inside a longer sentence, so match whole elements, not header text).
    const bareDash = Array.from(header.querySelectorAll("span")).filter(
      (el) => el.textContent?.trim() === "—",
    );
    expect(bareDash).toHaveLength(0);
    expect((header.textContent ?? "").match(/Binance/g)).toHaveLength(1);
  });

  it("several venues are joined with ', ' in stored order (M-2)", () => {
    const header = renderHeader(
      payloadFor({ source: "csv", exchanges: ["Binance", "OKX"], trustTier: "csv_uploaded" }),
    );
    expect(header.querySelector('[data-testid="masthead-venue-label"]')?.textContent).toBe(
      "Binance, OKX · self-reported",
    );
  });

  it("the venue is printed verbatim, exactly as the chip line prints exchanges (M-2)", () => {
    const header = renderHeader(
      payloadFor({ source: "csv", exchanges: ["coinbase"], trustTier: "csv_uploaded" }),
    );
    expect(header.querySelector('[data-testid="masthead-venue-label"]')?.textContent).toBe(
      "coinbase · self-reported",
    );
  });

  it("source 'csv' with no declared venue: no label and no em-dash standing in for it (M-4)", () => {
    const header = renderHeader(payloadFor({ source: "csv", exchanges: [], trustTier: "csv_uploaded" }));
    expect(header.querySelector('[data-testid="masthead-venue-label"]')).toBeNull();
    expect(header.textContent).not.toContain("self-reported ·");
    // The chip line keeps today's em-dash for an empty chip list (it is not the label's stand-in).
    expect(chipLine(header)?.textContent).toBe("—");
  });

  it("a wizard/API strategy (no source) with a venue: no label, chip line keeps the venue, pill title unchanged", () => {
    const header = renderHeader(
      payloadFor({ source: "wizard", exchanges: ["Binance"], trustTier: "self_reported" }),
    );
    expect(header.querySelector('[data-testid="masthead-venue-label"]')).toBeNull();
    expect(chipLine(header)?.textContent).toContain("Binance");
    const p = pill(header);
    expect(p).not.toBeNull();
    expect(p!.getAttribute("title")).toBe(PILL_TITLE_UNCHANGED);
  });

  it("a composite (ingestSource 'csv', no source) renders no label; chip line and pill unchanged", () => {
    const payload = payloadFor({
      ingestSource: "csv",
      exchanges: ["Binance"],
      trustTier: "csv_uploaded",
    });
    expect("source" in payload).toBe(false);
    const header = renderHeader(payload);
    expect(header.querySelector('[data-testid="masthead-venue-label"]')).toBeNull();
    expect(chipLine(header)?.textContent).toContain("Binance");
    expect(pill(header)?.getAttribute("title")).toBe(PILL_TITLE_UNCHANGED);
  });

  it("label + only-declared-fact-is-the-venue: no amber pill renders (M-6a)", () => {
    const header = renderHeader(
      payloadFor({ source: "csv", exchanges: ["Binance"], trustTier: "csv_uploaded" }),
    );
    expect(pill(header)).toBeNull();
  });

  it("label + other declared chips: the pill renders with the title that drops 'exchanges' (M-6b)", () => {
    const header = renderHeader(
      payloadFor({
        source: "csv",
        exchanges: ["Binance"],
        trustTier: "csv_uploaded",
        leverage: "2x",
        markets: ["crypto"],
      }),
    );
    expect(header.querySelector('[data-testid="masthead-venue-label"]')?.textContent).toBe(
      "Binance · self-reported",
    );
    const chips = chipLine(header);
    expect(chips?.textContent).toBe("crypto · leverage 2x");
    expect(chips?.textContent).not.toContain("Binance");
    const p = pill(header);
    expect(p).not.toBeNull();
    expect(p!.getAttribute("title")).toBe(PILL_TITLE_WITH_LABEL);
  });

  it("the label sits in the tier row, after the tier label and before the chip line, in the chip line's ink (M-1, M-7)", () => {
    const header = renderHeader(
      payloadFor({
        source: "csv",
        exchanges: ["Binance"],
        trustTier: "csv_uploaded",
        leverage: "2x",
      }),
    );
    const label = header.querySelector<HTMLElement>('[data-testid="masthead-venue-label"]')!;
    expect(label.className).toContain("text-caption");
    expect(label.className).toContain("text-text-secondary");
    const chips = chipLine(header)!;
    // DOCUMENT_POSITION_FOLLOWING: the chip line follows the label.
    expect(label.compareDocumentPosition(chips) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(label.parentElement).toBe(chips.parentElement);
  });
});
