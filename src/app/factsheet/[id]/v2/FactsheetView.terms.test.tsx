import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act, within } from "@testing-library/react";
import { termDefinition, type TermKey } from "@/lib/glossary";
import { FactsheetView } from "./FactsheetView";
import { censusPayloadA } from "./test-fixtures/census-payloads";

/**
 * Phase 201 plan 09 (D-01, D-03, D-20, U-03) — the factsheet's KPI strip explains its
 * specialist terms on screen and the tearsheet's print view renders none of that.
 *
 * WHY these arms exist: `Term` is the one focusable trigger that shows a registry
 * definition, and the factsheet mounts it inside labels other gates read as plain text
 * (the 196 factsheet census, six `getByText("α vs ...")` locators). Two regressions are
 * silent in a screenshot-free review: a strip label that lost its `Term` (the allocator
 * never meets the definition), and a print view that kept its trigger (a dotted underline
 * and a tab stop on paper). Each arm below fails on exactly one of them, and the strip arm
 * also pins that the label keeps its test id and its text, so a Term can never move a
 * label's own text out from under `readText`.
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
  lsStore.clear();
  vi.useFakeTimers();
  vi.stubGlobal("localStorage", localStorageMock);
  Object.defineProperty(window, "localStorage", { value: localStorageMock, configurable: true });
  window.history.replaceState({}, "", "/");
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

function kpiLabel(container: HTMLElement, text: string): HTMLElement {
  const el = Array.from(
    container.querySelectorAll<HTMLElement>('[data-testid="factsheet-kpi-label"]'),
  ).find((l) => l.textContent === text);
  expect(el, `no factsheet-kpi-label reads "${text}"`).toBeDefined();
  return el!;
}

describe("the KPI strip's terms (D-03)", () => {
  // label printed in the strip -> registry key it opens
  const STRIP: Array<[string, TermKey]> = [
    ["CAGR", "cagr"],
    ["Sharpe", "sharpe"],
    ["Sortino", "sortino"],
    ["Calmar", "calmar"],
    ["Max DD", "max_drawdown"],
    ["Ann. Vol", "volatility"],
  ];

  it.each(STRIP)("%s carries a Term inside its original factsheet-kpi-label", (label, key) => {
    const { container } = render(<FactsheetView payload={censusPayloadA()} />);
    const p = kpiLabel(container, label);
    // The test id stays on the original <p>, and the Term is INSIDE it, around the label.
    expect(p.tagName).toBe("P");
    const trigger = p.querySelector<HTMLElement>("[data-term]");
    expect(trigger, `${label} has no Term`).not.toBeNull();
    expect(trigger!.getAttribute("data-term")).toBe(key);
    expect(trigger!.textContent).toBe(label);
  });

  it("the Sharpe label opens the registry definition on keyboard focus after 150 ms", () => {
    const { container } = render(<FactsheetView payload={censusPayloadA()} />);
    const trigger = kpiLabel(container, "Sharpe").querySelector<HTMLElement>('[data-term="sharpe"]')!;
    fireEvent.focus(trigger);
    expect(within(document.body).queryByRole("tooltip")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(within(document.body).getByRole("tooltip").textContent).toBe(termDefinition("sharpe"));
  });

  it("a label with no registry term stays plain (Cum. Return)", () => {
    const { container } = render(<FactsheetView payload={censusPayloadA()} />);
    expect(kpiLabel(container, "Cum. Return").querySelector("[data-term]")).toBeNull();
  });
});

describe("the print view (D-20, U-03)", () => {
  it("renders no data-term and no Term tab stop, and still prints the Sharpe label", () => {
    const { container } = render(<FactsheetView payload={censusPayloadA()} printView />);
    expect(container.querySelectorAll("[data-term]")).toHaveLength(0);
    // A Term is the only element here that carries both; under PlainTerms there is none.
    expect(container.querySelectorAll("[data-term][tabindex]")).toHaveLength(0);
    expect(kpiLabel(container, "Sharpe").textContent).toBe("Sharpe");
  });

  it("the same view on screen does render triggers (the print arm is not vacuous)", () => {
    const { container } = render(<FactsheetView payload={censusPayloadA()} />);
    expect(container.querySelectorAll("[data-term]").length).toBeGreaterThan(0);
  });
});

describe("the panels' terms (D-01, D-02, D-19)", () => {
  // Advanced holds every panel below; it opens from its persisted state, so the arms read the
  // same tree an allocator who opened it reads.
  function openAdvanced(): HTMLElement {
    lsStore.set("factsheet-collapse:advanced", "open");
    const { container } = render(<FactsheetView payload={censusPayloadA()} />);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    return container;
  }

  function trigger(container: HTMLElement, key: TermKey, text: string): HTMLElement {
    const el = Array.from(container.querySelectorAll<HTMLElement>(`[data-term="${key}"]`)).find(
      (t) => t.textContent === text,
    );
    expect(el, `no [data-term="${key}"] reads "${text}"`).toBeDefined();
    return el!;
  }

  function opensRegistryText(el: HTMLElement, key: TermKey) {
    fireEvent.focus(el);
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(within(document.body).getByRole("tooltip").textContent).toBe(termDefinition(key));
    fireEvent.blur(el);
  }

  // label as printed -> registry key it opens; one row per panel family this plan owns.
  const PANELS: Array<[string, string, TermKey]> = [
    ["Style Drift row", "Ann. Volatility", "volatility"],
    ["Style Drift row", "Kurtosis", "kurtosis"],
    ["the Kolmogorov-Smirnov name inside its sentence", "Two-sample Kolmogorov-Smirnov", "kolmogorov_smirnov"],
    ["a Distribution percentile label", "P5", "percentile"],
    ["the bootstrap label", "Bootstrap 95% Confidence", "bootstrap_ci"],
    ["a Calmar by Year column", "Calmar", "calmar"],
  ];

  it.each(PANELS)("%s (%s) opens its own registry text", (_what, text, key) => {
    const container = openAdvanced();
    opensRegistryText(trigger(container, key, text), key);
  }, 20_000);

  it("the K-S Term wraps the test's name only, not the statistic that follows", () => {
    const container = openAdvanced();
    const ks = trigger(container, "kolmogorov_smirnov", "Two-sample Kolmogorov-Smirnov");
    expect(ks.closest("p")!.textContent).toMatch(/Two-sample Kolmogorov-Smirnov.*D = /);
    expect(ks.textContent).not.toMatch(/D = /);
  }, 20_000);

  it("Returns Signatures opens its registry text from the section title (Form B, no nested trigger)", () => {
    const container = openAdvanced();
    const title = container.querySelector<HTMLElement>("details#factsheet-signatures summary h2")!;
    expect(title.textContent).toBe("Returns Signatures");
    // The title sits in a <summary>: nothing focusable may be added inside it.
    expect(title.querySelector("[tabindex], button, a, [data-term]")).toBeNull();
    fireEvent.mouseEnter(title.firstElementChild as HTMLElement);
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(within(document.body).getByRole("tooltip").textContent).toBe(termDefinition("returns_signature"));
  }, 20_000);

  it("Returns Signatures opens its registry text on keyboard focus of the summary, and names it as the summary's description (F-10)", () => {
    const container = openAdvanced();
    const details = container.querySelector<HTMLElement>("details#factsheet-signatures")!;
    const summary = details.querySelector<HTMLElement>(":scope > summary")!;
    // The browser reads the first <summary> CHILD of <details>: a wrapper between them would
    // silently swap the section's control for a default "Details" label.
    expect(summary).not.toBeNull();
    expect(summary.parentElement).toBe(details);
    expect(summary.getAttribute("aria-describedby")).toBeNull();

    fireEvent.focus(summary);
    act(() => {
      vi.advanceTimersByTime(150);
    });
    const bubble = within(document.body).getByRole("tooltip");
    expect(bubble.textContent).toBe(termDefinition("returns_signature"));
    expect(summary.getAttribute("aria-describedby")).toBe(bubble.id);

    fireEvent.blur(summary);
    expect(within(document.body).queryByRole("tooltip")).toBeNull();
    expect(summary.getAttribute("aria-describedby")).toBeNull();
  }, 20_000);

  // R2-01: Chrome and Firefox focus a <summary> on a mouse click, so a click on the row outside
  // the title opens the bubble through onFocus. Only a blur used to close it; the pointer leaving
  // the summary must close it too (the Tooltip wrapper's semantics).
  it("Returns Signatures: a bubble opened by focus closes when the pointer leaves the summary", () => {
    const container = openAdvanced();
    const summary = container.querySelector<HTMLElement>("details#factsheet-signatures > summary")!;
    fireEvent.focus(summary);
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(within(document.body).getByRole("tooltip")).toBeTruthy();

    fireEvent.mouseLeave(summary);
    expect(within(document.body).queryByRole("tooltip")).toBeNull();
    expect(summary.getAttribute("aria-describedby")).toBeNull();
  }, 20_000);
});
