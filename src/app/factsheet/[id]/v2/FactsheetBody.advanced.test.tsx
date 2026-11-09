import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor, within, act } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import type { FactsheetPayload } from "@/lib/factsheet/types";
import { COLLAPSIBLE_OPEN_ALL_EVENT } from "@/components/ui/CollapsibleSection";
import { FactsheetProvider } from "./factsheet-context";
import { FactsheetBody, FactsheetView } from "./FactsheetView";
import { AdvancedDisclosure } from "./AdvancedDisclosure";
import { censusPayloadA } from "./test-fixtures/census-payloads";

/**
 * Phase 196 plan 10 (D-04, LEAN-05) — the factsheet opens as a summary strip, ONE equity
 * figure (curve plus drawdown) and ONE Main metrics table; everything else waits behind a
 * collapsed "Advanced" disclosure.
 *
 * WHY these arms exist: the opening view is a product decision, and the cheap way to break
 * it is invisible in a screenshot-free review: a chart creeps back into the opening grid,
 * or Advanced stops deferring and a closed disclosure quietly pays for every chart on the
 * page. The arms below fail on exactly those two regressions, and on the section list in the
 * "contents" line drifting from the sections actually mounted.
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
  vi.clearAllMocks();
  vi.stubGlobal("localStorage", localStorageMock);
  Object.defineProperty(window, "localStorage", { value: localStorageMock, configurable: true });
  window.history.replaceState({}, "", "/");
});

const ADVANCED_KEY = "factsheet-collapse:advanced";

const ADVANCED_SECTION_IDS = [
  "factsheet-perf",
  "factsheet-dist",
  "factsheet-heatmaps",
  "factsheet-stress",
  "factsheet-streak",
];

function mountView(payload: FactsheetPayload = censusPayloadA(), props: Record<string, unknown> = {}) {
  return render(<FactsheetView payload={payload} {...props} />);
}

function advanced(container: HTMLElement): HTMLDetailsElement {
  const el = container.querySelector<HTMLDetailsElement>("details#factsheet-advanced");
  expect(el, "details#factsheet-advanced did not render").not.toBeNull();
  return el!;
}

function openAdvanced(container: HTMLElement) {
  fireEvent.click(advanced(container).querySelector("summary")!);
}

describe("the opening view (D-04)", () => {
  it("renders no SectionNav: its anchors would point into the collapsed disclosure", () => {
    const { container } = mountView();
    expect(container.querySelector('nav[aria-label="Factsheet sections"]')).toBeNull();
  });

  it("holds exactly two charts in the equity section: the curve and the drawdown", () => {
    const { container } = mountView();
    const equity = container.querySelector('[data-census-section="equity"]')!;
    expect(equity).not.toBeNull();
    expect(equity.querySelectorAll("figure")).toHaveLength(2);
  });

  it("holds the one Main metrics table in the main-metrics section", () => {
    const { container } = mountView();
    const main = container.querySelector('[data-census-section="main-metrics"]')!;
    expect(main).not.toBeNull();
    expect(main.textContent).toContain("Main metrics");
  });

  it("shows no chart outside the equity pair while Advanced is closed", () => {
    const { container } = mountView();
    expect(container.querySelectorAll("figure")).toHaveLength(2);
    expect(advanced(container).querySelector("[data-advanced-contents]")).toBeNull();
    // Not one of the six sections is in the DOM, closed or not.
    for (const id of ADVANCED_SECTION_IDS) expect(container.querySelector(`#${id}`), id).toBeNull();
  });
});

describe("Advanced (D-04)", () => {
  it("is a native details element, collapsed on the server render", () => {
    const { container } = mountView();
    expect(advanced(container).open).toBe(false);
  });

  it("mounts its contents on the first open: every section and the Detailed metrics rail", () => {
    const { container } = mountView();
    openAdvanced(container);
    return waitFor(() => {
      const contents = advanced(container).querySelector("[data-advanced-contents]");
      expect(contents).not.toBeNull();
      for (const id of ADVANCED_SECTION_IDS) expect(contents!.querySelector(`#${id}`), id).not.toBeNull();
      expect(contents!.textContent).toContain("Detailed metrics");
    });
  });

  it("keeps the contents mounted after a close", async () => {
    const { container } = mountView();
    openAdvanced(container);
    await waitFor(() => expect(advanced(container).open).toBe(true));
    openAdvanced(container);
    await waitFor(() => expect(advanced(container).open).toBe(false));
    expect(advanced(container).querySelector("[data-advanced-contents]")).not.toBeNull();
  });

  it("names exactly the sections it mounts in its contents line", async () => {
    const { container } = mountView();
    const line = advanced(container).querySelector("summary")!.textContent ?? "";
    openAdvanced(container);
    await waitFor(() => expect(advanced(container).querySelector("[data-advanced-contents]")).not.toBeNull());
    const mounted = Array.from(
      advanced(container).querySelectorAll<HTMLElement>("[data-advanced-contents] details[id^='factsheet-']"),
    ).map((d) => d.querySelector("summary h2")!.textContent!.trim());
    expect(line).toContain([...mounted, "Detailed metrics"].join(" · "));
    expect(line.startsWith("Advanced")).toBe(true);
  });
});

describe("the full layout is the default (OQ-4)", () => {
  it("FactsheetBody with no layout prop keeps SectionNav, the sections in the grid and no Advanced", () => {
    const payload = censusPayloadA();
    const { container } = render(
      <FactsheetProvider payload={payload} persist={false}>
        <FactsheetBody payload={payload} />
      </FactsheetProvider>,
    );
    expect(container.querySelector('nav[aria-label="Factsheet sections"]')).not.toBeNull();
    expect(container.querySelector("#factsheet-perf")).not.toBeNull();
    expect(container.querySelector("details#factsheet-advanced")).toBeNull();
  });
});

describe("Advanced remembers the reader (D-04, T-196-22, T-196-23)", () => {
  it("server-renders closed with no contents, whatever storage holds", () => {
    lsStore.set(ADVANCED_KEY, "open");
    const html = renderToString(
      <AdvancedDisclosure sections={[{ id: "factsheet-perf", title: "Performance" }]}>
        <p data-probe>inside</p>
      </AdvancedDisclosure>,
    );
    expect(html).not.toMatch(/<details[^>]*\sopen/);
    expect(html).not.toContain("data-probe");
  });

  it("adopts a stored 'open' after hydration and mounts the contents", async () => {
    lsStore.set(ADVANCED_KEY, "open");
    const { container } = mountView();
    await waitFor(() => expect(advanced(container).open).toBe(true));
    expect(advanced(container).querySelector("[data-advanced-contents]")).not.toBeNull();
  });

  it("writes 'open' and 'closed' under the registered factsheet-collapse: key on a toggle", async () => {
    const { container } = mountView();
    await waitFor(() => expect(localStorageMock.getItem).toHaveBeenCalledWith(ADVANCED_KEY));
    openAdvanced(container);
    await waitFor(() => expect(lsStore.get(ADVANCED_KEY)).toBe("open"));
    openAdvanced(container);
    await waitFor(() => expect(lsStore.get(ADVANCED_KEY)).toBe("closed"));
  });

  it("adopts an 'open' written by another tab", async () => {
    const { container } = mountView();
    await waitFor(() => expect(localStorageMock.getItem).toHaveBeenCalledWith(ADVANCED_KEY));
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: ADVANCED_KEY, newValue: "open" }));
    });
    await waitFor(() => expect(advanced(container).open).toBe(true));
  });

  it("ignores garbage from another tab or a stored garbage value: closed, no error", async () => {
    lsStore.set(ADVANCED_KEY, "yes please");
    const { container } = mountView();
    await waitFor(() => expect(localStorageMock.getItem).toHaveBeenCalledWith(ADVANCED_KEY));
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: ADVANCED_KEY, newValue: "{\"open\":true}" }));
    });
    expect(advanced(container).open).toBe(false);
    expect(advanced(container).querySelector("[data-advanced-contents]")).toBeNull();
  });

  it("with storage throwing on read and write renders closed and still opens and closes in-session", async () => {
    const boom = () => {
      throw new Error("storage denied");
    };
    Object.defineProperty(window, "localStorage", {
      value: { getItem: boom, setItem: boom, removeItem: boom, clear: boom, key: () => null, length: 0 },
      configurable: true,
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = mountView();
    expect(advanced(container).open).toBe(false);
    openAdvanced(container);
    await waitFor(() => expect(advanced(container).open).toBe(true));
    expect(advanced(container).querySelector("[data-advanced-contents]")).not.toBeNull();
    openAdvanced(container);
    await waitFor(() => expect(advanced(container).open).toBe(false));
  });
});

describe("Reset view and print leave Advanced alone (UI-SPEC Advanced Disclosure, Print)", () => {
  it("the open-all event, and the Reset view button that sends it, never open Advanced", () => {
    const { container } = mountView();
    act(() => {
      window.dispatchEvent(new Event(COLLAPSIBLE_OPEN_ALL_EVENT));
    });
    expect(advanced(container).open).toBe(false);
    fireEvent.click(within(container).getByRole("button", { name: "Reset view" }));
    expect(advanced(container).open).toBe(false);
    expect(advanced(container).querySelector("[data-advanced-contents]")).toBeNull();
  });

  it("beforeprint leaves a closed Advanced closed, forces the other details open, afterprint restores", () => {
    const { container } = mountView();
    const others = Array.from(container.querySelectorAll<HTMLDetailsElement>("details:not(#factsheet-advanced)"));
    expect(others.length, "the fixture must carry another details element (the Display menu)").toBeGreaterThan(0);
    expect(others.every((d) => !d.open)).toBe(true);
    act(() => {
      window.dispatchEvent(new Event("beforeprint"));
    });
    expect(advanced(container).open).toBe(false);
    expect(others.every((d) => d.open)).toBe(true);
    act(() => {
      window.dispatchEvent(new Event("afterprint"));
    });
    expect(advanced(container).open).toBe(false);
    expect(others.every((d) => !d.open)).toBe(true);
  });

  it("beforeprint keeps an Advanced the reader closed after opening it closed", async () => {
    const { container } = mountView();
    openAdvanced(container);
    await waitFor(() => expect(advanced(container).open).toBe(true));
    openAdvanced(container);
    await waitFor(() => expect(advanced(container).open).toBe(false));
    act(() => {
      window.dispatchEvent(new Event("beforeprint"));
    });
    expect(advanced(container).open).toBe(false);
  });

  it("inside an open Advanced a section the reader closed is forced open for print, then restored", async () => {
    const { container } = mountView();
    openAdvanced(container);
    await waitFor(() => expect(container.querySelector("#factsheet-dist")).not.toBeNull());
    const dist = container.querySelector<HTMLDetailsElement>("#factsheet-dist")!;
    fireEvent.click(dist.querySelector("summary")!);
    await waitFor(() => expect(dist.open).toBe(false));
    act(() => {
      window.dispatchEvent(new Event("beforeprint"));
    });
    expect(dist.open).toBe(true);
    expect(advanced(container).open).toBe(true);
    act(() => {
      window.dispatchEvent(new Event("afterprint"));
    });
    expect(dist.open).toBe(false);
    expect(advanced(container).open).toBe(true);
  });
});

describe("the Print view link (D-09, T-196-24)", () => {
  const printLink = (c: HTMLElement) => within(c).queryByRole("link", { name: "Print view" });

  it("links a published strategy's factsheet to its tearsheet", () => {
    const { container } = mountView();
    expect(printLink(container)?.getAttribute("href")).toBe("/factsheet/census-fixture-a/tearsheet");
  });

  it("is absent for the owner lane (unpublished, the tearsheet route would 404)", () => {
    const { container } = mountView(undefined, { ownerShare: { hasActiveShare: false } });
    expect(printLink(container)).toBeNull();
  });

  it("is absent for a share-token recipient", () => {
    const { container } = mountView(undefined, { recipientShare: true });
    expect(printLink(container)).toBeNull();
  });

  it("is absent in ?share=1 share mode, like every outbound link", async () => {
    window.history.replaceState({}, "", "/?share=1");
    const { container } = mountView();
    await waitFor(() => expect(within(container).queryByRole("link", { name: "Compare strategies" })).toBeNull());
    expect(printLink(container)).toBeNull();
  });

  it("is absent in scenario mode and in the full layout", () => {
    const payload = censusPayloadA();
    const scenario = render(
      <FactsheetProvider payload={payload} persist={false}>
        <FactsheetBody payload={payload} layout="document" scenarioMode />
      </FactsheetProvider>,
    );
    expect(printLink(scenario.container)).toBeNull();
    scenario.unmount();
    const full = render(
      <FactsheetProvider payload={payload} persist={false}>
        <FactsheetBody payload={payload} />
      </FactsheetProvider>,
    );
    expect(printLink(full.container)).toBeNull();
  });
});

describe("printView (consumed by the tearsheet page)", () => {
  it("renders the opening view with no ControlBar, Advanced, slot or footer", () => {
    const { container } = mountView(undefined, {
      printView: true,
      beforeFooterSlot: <p data-testid="slot-probe">slot</p>,
    });
    expect(within(container).queryByRole("button", { name: "Reset view" })).toBeNull();
    expect(container.querySelector("details#factsheet-advanced")).toBeNull();
    expect(container.querySelector('[data-census-section="advanced"]')).toBeNull();
    expect(container.querySelector('[data-testid="slot-probe"]')).toBeNull();
    expect(container.querySelector("footer")).toBeNull();
    // ...and keeps the figures the print view exists for.
    expect(container.querySelector('[data-census-section="equity"]')!.querySelectorAll("figure")).toHaveLength(2);
    expect(container.querySelector('[data-census-section="main-metrics"]')!.textContent).toContain("Main metrics");
    expect(container.textContent).toContain("Sharpe");
  });

  it("without printView the slot and the footer render, in that order", () => {
    const { container } = mountView(undefined, { beforeFooterSlot: <p data-testid="slot-probe">slot</p> });
    const slot = container.querySelector('[data-testid="slot-probe"]')!;
    const footer = container.querySelector("footer")!;
    expect(slot).not.toBeNull();
    expect(footer).not.toBeNull();
    expect(slot.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
