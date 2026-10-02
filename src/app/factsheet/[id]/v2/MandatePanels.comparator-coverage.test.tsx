/** @vitest-environment jsdom */
/**
 * Phase 169.5 BENCHCOMPARE (SC3, the W6 finding, 169 D-54 / D-64) — the Mandate
 * panels describe how a comparator is measured the way the numbers now do it.
 *
 * Why this matters: the comparator is no longer carried across a date it has no
 * close for. Each comparator's return is taken over the strategy's own interval
 * from the comparator's own closes (D-54), and nothing is measured past its last
 * close (D-09). A factsheet that still told an allocator every benchmark is
 * "forward-filled" would describe a fill the page no longer performs, in the two
 * places a reader checks method: the Strategy Thesis sentence and the Terms
 * panel's "Bench frequency" Term. Both sites are pinned by literal here.
 *
 * The D-64 trap the wording avoids: it claims no zero first day, no fill across a
 * missing benchmark date, and not that every interval enters alpha / beta (an
 * interval with a benchmark date missing at an endpoint or inside it does not).
 *
 * The record-length parenthesis and the "Sample size" Term are plan 169-05's
 * (169 D-12). They are pinned unchanged beside the new wording so an edit to the
 * comparator sentence cannot move them.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { buildFactsheetPayload } from "@/lib/factsheet/build-payload";
import type { FactsheetPayload } from "@/lib/factsheet/types";
import { FactsheetProvider } from "./factsheet-context";
import { StrategyThesisPanel, TermsPanel } from "./MandatePanels";

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

const lsStore = new Map<string, string>();
beforeEach(() => {
  lsStore.clear();
  vi.stubGlobal("localStorage", {
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
  });
});

const DAY = 86_400_000;
const START = Date.UTC(2024, 0, 1);

/** 166 consecutive calendar days from 2024-01-01. */
function payload166(): FactsheetPayload {
  const points = Array.from({ length: 166 }, (_, i) => ({
    date: new Date(START + i * DAY).toISOString().slice(0, 10),
    value: Math.sin(i / 7) * 0.01,
  }));
  const built = buildFactsheetPayload(
    {
      id: "comparator-coverage-test",
      name: "Comparator Coverage Test",
      types: ["test"],
      markets: ["crypto"],
      computedAt: "2026-09-30T00:00:00Z",
      trustTier: null,
      ingestSource: "api",
    },
    points,
  );
  if (!built) throw new Error("buildFactsheetPayload returned null in test");
  return built;
}

function renderPanels() {
  return render(
    <FactsheetProvider payload={payload166()} persist={false}>
      <StrategyThesisPanel />
      <TermsPanel />
    </FactsheetProvider>,
  );
}

function section(container: HTMLElement, title: string): HTMLElement {
  const h = [...container.querySelectorAll("h3")].find((el) => el.textContent === title);
  if (!h) throw new Error(`no panel titled "${title}"`);
  return h.closest("section") as HTMLElement;
}

function term(container: HTMLElement, label: string): string {
  const dt = [...container.querySelectorAll("dt")].find((el) => el.textContent === label);
  if (!dt) throw new Error(`no Term "${label}"`);
  return dt.nextElementSibling?.textContent ?? "";
}

const flat = (el: HTMLElement) => (el.textContent ?? "").replace(/\s+/g, " ");

describe("MandatePanels state the comparator interval rule at both sites (SC3, W6)", () => {
  it("the Strategy Thesis measures each comparator over the strategy's own intervals, never past its last close", () => {
    const { container } = renderPanels();
    const thesis = flat(section(container, "Strategy Thesis"));
    expect(thesis).toContain(
      "Each comparator's return is taken over the strategy's own intervals from the comparator's own closes, and is not measured past its last close.",
    );
    expect(thesis).not.toMatch(/forward-fill/i);
    expect(thesis).not.toContain("aligned to the same calendar");
  });

  it("the Terms panel's Bench frequency Term says the same in Term length", () => {
    const { container } = renderPanels();
    const value = term(section(container, "Terms"), "Bench frequency");
    expect(value).toBe("Daily close, over each strategy interval");
    expect(value).not.toMatch(/forward-fill/i);
  });

  it("the record-length parenthesis and the Sample size Term (169-05, D-12) are unchanged", () => {
    const { container } = renderPanels();
    expect(flat(section(container, "Strategy Thesis"))).toContain(
      "observation window (0.45 years, 166 daily observations).",
    );
    expect(term(section(container, "Terms"), "Sample size")).toBe(
      "0.45 years, 166 daily observations",
    );
  });
});
