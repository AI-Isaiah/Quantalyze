/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import type { FactsheetPayload } from "@/lib/factsheet/types";
import { buildFactsheetPayload } from "@/lib/factsheet/build-payload";
import { FactsheetProvider } from "./factsheet-context";
import { FactsheetBody } from "./FactsheetView";

/**
 * Phase 170.1.2 (LABELS) D-01 — the degraded-member data-quality line names the
 * venue in words.
 *
 * THE REQUIREMENT: when a composite member is excluded from the stitch, the
 * factsheet says which key and which venue, as `Key {seq} ({venue display name})`.
 * The producer writes the raw venue code (`bybit`); a reader should never see it.
 * A code outside the closed display set reads "Other venue" rather than echoing
 * an unexpected producer string.
 *
 * Strings are hand-typed, never imported from display-labels, so a change to the
 * label map moves a user-visible sentence and this file turns RED.
 *
 * Harness mirrors FactsheetView.venue-label.test.tsx.
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

function payloadWithDegraded(
  degradedMembers: Array<{ seq: number; venue: string }>,
): FactsheetPayload {
  const built = buildFactsheetPayload(
    {
      id: "s-170-1-2-degraded",
      name: "Degraded Fixture",
      types: [],
      markets: [],
      computedAt: "2025-06-01T00:00:00Z",
      trustTier: null,
      ingestSource: "api",
      source: null,
      assetClass: "crypto",
      description: null,
      subtypes: [],
      supportedExchanges: [],
      leverageRange: null,
      aum: null,
      maxCapacity: null,
      avgDailyTurnover: null,
      startDate: "2025-01-01",
      benchmark: "BTC",
    },
    series(200),
  );
  if (!built) throw new Error("buildFactsheetPayload returned null in test");
  return { ...built, dataQuality: { composite: true, degradedMembers } } as FactsheetPayload;
}

/** The amber data-quality line: the `<p>` that carries the exclusion sentence. */
function degradedLine(payload: FactsheetPayload): string {
  const view = render(
    <FactsheetProvider payload={payload} persist={false}>
      <FactsheetBody payload={payload} hideAllocatorSection hideFooter />
    </FactsheetProvider>,
  );
  const line = Array.from(view.container.querySelectorAll("p")).find((p) =>
    (p.textContent ?? "").includes("could not be included"),
  );
  expect(line, "degraded-member line not found").toBeDefined();
  return (line!.textContent ?? "").replace(/\s+/g, " ").trim();
}

describe("D-01 — factsheet degraded-member line names the venue", () => {
  it("one excluded key reads 'Key 2 (Bybit)', never the raw code", () => {
    const text = degradedLine(payloadWithDegraded([{ seq: 2, venue: "bybit" }]));
    expect(text).toContain("Key 2 (Bybit)");
    expect(text).not.toContain("(bybit)");
    expect(text).toContain("its data is excluded from this track record");
  });

  it("several excluded keys read 'Key 1 (OKX), Key 3 (sFOX)' with the plural wording", () => {
    const text = degradedLine(
      payloadWithDegraded([
        { seq: 1, venue: "okx" },
        { seq: 3, venue: "sfox" },
      ]),
    );
    expect(text).toContain("Key 1 (OKX), Key 3 (sFOX)");
    expect(text).toContain("their data is excluded from this track record");
  });

  it("a venue code outside the closed set reads 'Other venue' and is not echoed", () => {
    const text = degradedLine(payloadWithDegraded([{ seq: 4, venue: "kraken" }]));
    expect(text).toContain("Key 4 (Other venue)");
    expect(text).not.toContain("kraken");
  });
});
