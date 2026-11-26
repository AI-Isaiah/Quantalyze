import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import type { FactsheetPayload } from "@/lib/factsheet/types";
import { NEVER_COMPUTED_STAMP } from "@/lib/factsheet/never-computed-stamp";
import { FactsheetProvider } from "./factsheet-context";
import { FactsheetView } from "./FactsheetView";
import { TermsPanel } from "./MandatePanels";
import { censusPayloadA } from "./test-fixtures/census-payloads";

/**
 * Phase 238 FACT-03 (UI-SPEC 2.2 D3, D4) — a never-computed row has no compute date.
 *
 * The server builder carries a NULL `strategy_analytics.computed_at` as the epoch stamp
 * (`NEVER_COMPUTED_STAMP`). Before this phase the Terms `Factsheet computed` cell and the footer
 * stamp printed that stamp as `Jan 1, 1970`: a fabricated compute date, presented to an
 * allocator as fact. These arms render the real view and fail if either place prints a day for
 * the sentinel, or stops printing the real day for a computed row.
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
beforeEach(() => {
  lsStore.clear();
  vi.clearAllMocks();
  vi.stubGlobal("localStorage", localStorageMock);
  Object.defineProperty(window, "localStorage", { value: localStorageMock, configurable: true });
  window.history.replaceState({}, "", "/");
});

vi.setConfig({ testTimeout: 60_000 });

function withComputedAt(computedAt: string): FactsheetPayload {
  return { ...censusPayloadA(), computedAt };
}

/** The value cell of the Terms row labelled `Factsheet computed`. */
function renderTerms(payload: FactsheetPayload) {
  return render(
    <FactsheetProvider payload={payload} persist={false}>
      <TermsPanel variant="document" />
    </FactsheetProvider>,
  );
}

function termsComputedCell(container: HTMLElement): HTMLElement {
  const label = Array.from(container.querySelectorAll("dt")).find(
    (el) => el.textContent?.trim() === "Factsheet computed",
  );
  expect(label, "Terms row 'Factsheet computed' did not render").toBeTruthy();
  const cell = label!.nextElementSibling as HTMLElement | null;
  expect(cell, "Terms row has no value cell").not.toBeNull();
  return cell!;
}

function footerStamp(container: HTMLElement): string {
  const stamp = Array.from(container.querySelectorAll("footer p")).find((el) =>
    el.textContent?.startsWith("QSF · "),
  );
  expect(stamp, "footer stamp did not render").toBeTruthy();
  return stamp!.textContent ?? "";
}

describe("never-computed factsheet: no compute date anywhere (FACT-03 D3, D4)", () => {
  it("Terms `Factsheet computed` reads the null dash for the sentinel, and the document has no 1970", () => {
    const { container } = renderTerms(withComputedAt(NEVER_COMPUTED_STAMP));
    expect(termsComputedCell(container).textContent).toBe("—");
    expect(container.textContent ?? "").not.toContain("1970");
    // the whole page, not just the panel: no surface prints the sentinel's day
    const page = render(<FactsheetView payload={withComputedAt(NEVER_COMPUTED_STAMP)} />);
    expect(page.container.textContent ?? "").not.toContain("1970");
  });

  it("the footer stamp ends in the null dash for the sentinel", () => {
    const payload = withComputedAt(NEVER_COMPUTED_STAMP);
    const { container } = render(<FactsheetView payload={payload} />);
    expect(footerStamp(container)).toBe(`QSF · ${payload.strategyId.slice(0, 8).toUpperCase()} · —`);
  });

  it("a computed row keeps its real date in both places", () => {
    const payload = withComputedAt("2026-05-12T00:00:00Z");
    const may12 = "May\u00a012,\u00a02026";
    expect(termsComputedCell(renderTerms(payload).container).textContent).toBe(may12);
    const { container } = render(<FactsheetView payload={payload} />);
    expect(footerStamp(container)).toBe(`QSF · ${payload.strategyId.slice(0, 8).toUpperCase()} · ${may12}`);
  });
});
