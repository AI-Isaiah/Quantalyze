import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import type { FactsheetPayload, OwnBookDeltaPayload } from "@/lib/factsheet/types";
import { buildScenarioFactsheetPayload } from "@/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload";
import { FactsheetProvider } from "./factsheet-context";
import { OwnBookDeltaPanel } from "./BatchDPanels";

/**
 * Phase 42 Plan 05 (PEER-05) — the OwnBookDeltaPanel signed-delta render contract.
 *
 * Load-bearing proofs:
 *   1. SCENARIO + delta: a "vs Your Book" panel with 3 signed rows; the sign is in
 *      the TEXT (U+2212 for negative), never color-only; Sharpe/Sortino color
 *      follows sign; Max DD color is INVERTED (a positive maxDD-delta = shallower
 *      = positive token) and shows pp; the basis note discloses BOTH observation
 *      counts (blend_n · book_n) so the window mismatch is honest (WR-02).
 *   2. NO LIVE BOOK (null/absent carve-out): the panel renders nothing (silently
 *      absent — no zeroed deltas, no CTA).
 *   3. NON-SCENARIO: null (real route byte-identical).
 *   4. A null single-ratio delta renders "—" without crashing.
 *
 * Stub block mirrors BatchDPanels.peer-scenario.test.tsx.
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

const U2212 = "−"; // Unicode minus

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

function csvPayload(scenarioOwnBookDelta: OwnBookDeltaPayload | undefined): FactsheetPayload {
  return buildScenarioFactsheetPayload({
    portfolioDaily: makeReturnsSeries(300),
    benchmark: null,
    ...(scenarioOwnBookDelta ? { scenarioOwnBookDelta } : {}),
  });
}

function renderPanel(payload: FactsheetPayload) {
  return render(
    <FactsheetProvider payload={payload} persist={false}>
      <OwnBookDeltaPanel />
    </FactsheetProvider>,
  );
}

/** Resolve the value cell <td> for a given row label inside the panel. */
function valueCellFor(container: HTMLElement, label: string): HTMLElement {
  const cells = Array.from(container.querySelectorAll("td"));
  const labelCell = cells.find((td) => td.textContent === label);
  if (!labelCell) throw new Error(`row label not found: ${label}`);
  const valueCell = labelCell.nextElementSibling as HTMLElement | null;
  if (!valueCell) throw new Error(`value cell not found for: ${label}`);
  return valueCell;
}

describe("OwnBookDeltaPanel — signed sample-basis deltas (PEER-05)", () => {
  it("scenario + delta: 'vs Your Book' with signs in text, U+2212 for negative, inverted maxDD color, dual-count basis note", () => {
    // positive Sharpe, negative Sortino, positive maxDD-delta (blend shallower).
    // blend_n != book_n so the disclosure must surface BOTH (the window mismatch).
    const delta: OwnBookDeltaPayload = {
      sharpe: 0.24,
      sortino: -0.18,
      max_dd: 0.018, // +1.8pp shallower
      blend_n: 287,
      book_n: 412,
    };
    const { getByText, container } = renderPanel(csvPayload(delta));

    expect(getByText("vs Your Book")).toBeTruthy();

    // Sharpe: positive → "+0.24", positive token.
    const sharpeCell = valueCellFor(container, "Sharpe");
    expect(sharpeCell.textContent).toBe("+0.24");
    expect(sharpeCell.getAttribute("style")).toContain("var(--color-positive)");

    // Sortino: negative → "−0.18" (U+2212 in text, never color-only), negative token.
    const sortinoCell = valueCellFor(container, "Sortino");
    expect(sortinoCell.textContent).toBe(`${U2212}0.18`);
    expect(sortinoCell.textContent).not.toContain("-0.18"); // ASCII hyphen NOT used
    expect(sortinoCell.getAttribute("style")).toContain("var(--color-negative)");

    // Max DD: positive delta = shallower = good → INVERTED to positive token; pp units.
    const maxddCell = valueCellFor(container, "Max DD (blend vs book)");
    expect(maxddCell.textContent).toBe("+1.8pp");
    expect(maxddCell.getAttribute("style")).toContain("var(--color-positive)");

    // Basis note discloses BOTH counts (blend_n · book_n) so the reader sees the
    // two legs span different windows — the delta shares the sample/252 FORMULA,
    // not necessarily the same calendar window (WR-02 honesty fix). U+2019 is the
    // rendered &rsquo; apostrophe.
    expect(
      getByText(
        `Delta = blend minus your live book · sample/252 basis · over each series’ own window (${(287).toLocaleString()} obs blend · ${(412).toLocaleString()} obs book)`,
      ),
    ).toBeTruthy();
  });

  it("negative maxDD delta (blend DEEPER) → U+2212 sign + INVERTED negative token", () => {
    const delta: OwnBookDeltaPayload = {
      sharpe: 0,
      sortino: 0,
      max_dd: -0.023, // blend's max_dd more negative = deeper = worse
      blend_n: 260,
      book_n: 90,
    };
    const { container } = renderPanel(csvPayload(delta));
    const maxddCell = valueCellFor(container, "Max DD (blend vs book)");
    expect(maxddCell.textContent).toBe(`${U2212}2.3pp`);
    expect(maxddCell.getAttribute("style")).toContain("var(--color-negative)");
  });

  it("a null single-ratio delta renders '—' without crashing (no color)", () => {
    const delta: OwnBookDeltaPayload = {
      sharpe: null,
      sortino: 0.1,
      max_dd: 0.005,
      blend_n: 252,
      book_n: 30,
    };
    const { container } = renderPanel(csvPayload(delta));
    const sharpeCell = valueCellFor(container, "Sharpe");
    expect(sharpeCell.textContent).toBe("—");
    // A null delta carries no positive/negative color token.
    expect(sharpeCell.getAttribute("style") ?? "").not.toContain("--color-");
  });

  it("no live book (absent carve-out): the panel renders nothing (silently absent)", () => {
    const { container, queryByText } = renderPanel(csvPayload(undefined));
    expect(container.querySelector("section")).toBeNull();
    expect(queryByText("vs Your Book")).toBeNull();
  });

  it("non-scenario (api arm): the panel returns null (real route byte-identical)", () => {
    const base = buildScenarioFactsheetPayload({
      portfolioDaily: makeReturnsSeries(300),
      benchmark: null,
    });
    const { scenarioPeer: _drop, ...common } = base;
    const apiPayload: FactsheetPayload = {
      ...common,
      ingestSource: "api",
      peerPercentile: null,
      allocatorPortfolios: null,
      eventSignatures: null,
      benchEventSignatures: null,
    };
    const { container, queryByText } = renderPanel(apiPayload);
    expect(container.querySelector("section")).toBeNull();
    expect(queryByText("vs Your Book")).toBeNull();
  });
});
