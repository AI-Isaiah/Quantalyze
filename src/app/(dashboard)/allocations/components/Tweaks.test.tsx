import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Tweaks } from "./Tweaks";
import { TweaksToggle } from "./TweaksToggle";
import { TweaksProvider, useTweaks } from "../context/TweaksContext";

/**
 * PR3 (HANDOFF G5) — Tweaks panel + context tests.
 *
 * The QA-mode gate is GONE; allocators see the panel via the
 * TweaksToggle chip in the header. Tests below pin the new flow:
 *   - Panel is hidden by default.
 *   - Toggle opens / closes the panel.
 *   - Segmented Density / Accent / Bridge / Chart / Bench / Outcomes
 *     controls persist state to localStorage.
 *   - body[data-density] mirrors the selected density.
 *   - Root --color-accent flips with the Accent intensity knob.
 *   - Reset returns to TWEAK_DEFAULTS.
 *   - Malformed localStorage falls back gracefully.
 *   - Outside a TweaksProvider, useTweaks() returns defaults so widgets
 *     consuming the context render correctly in standalone tests.
 *   - Source-level invariant: Tweaks.tsx contains no postMessage bridge
 *     (the QA-only cross-window channel is permanently retired).
 */

// localStorage stub — clones useDashboardConfig P6 pattern so tests
// don't leak persisted state into one another.
const lsStore = new Map<string, string>();
const localStorageMock = {
  getItem: vi.fn((k: string) => lsStore.get(k) ?? null),
  setItem: vi.fn((k: string, v: string) => {
    lsStore.set(k, v);
  }),
  removeItem: vi.fn((k: string) => {
    lsStore.delete(k);
  }),
  clear: vi.fn(() => {
    lsStore.clear();
  }),
  key: vi.fn(() => null),
  length: 0,
};
vi.stubGlobal("localStorage", localStorageMock);

beforeEach(() => {
  lsStore.clear();
  localStorageMock.getItem.mockClear();
  localStorageMock.setItem.mockClear();
  document.body.removeAttribute("data-density");
  document.documentElement.style.removeProperty("--color-accent");
  document.documentElement.style.removeProperty("--color-accent-hover");
  document.documentElement.style.removeProperty("--color-chart-strategy");
});

function Harness() {
  return (
    <TweaksProvider>
      <TweaksToggle />
      <Tweaks />
    </TweaksProvider>
  );
}

describe("Tweaks — toggle + panel visibility", () => {
  it("hides the panel by default (no toggle clicked)", () => {
    render(<Harness />);
    expect(screen.queryByRole("dialog", { name: /tweaks/i })).toBeNull();
  });

  it("opens the panel when the header toggle is clicked", () => {
    render(<Harness />);
    fireEvent.click(
      screen.getByRole("button", { name: /toggle tweaks panel/i }),
    );
    expect(
      screen.getByRole("dialog", { name: /tweaks/i }),
    ).toBeInTheDocument();
  });

  it("closes the panel when the toggle is clicked again", () => {
    render(<Harness />);
    const toggle = screen.getByRole("button", { name: /toggle tweaks panel/i });
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    expect(screen.queryByRole("dialog", { name: /tweaks/i })).toBeNull();
  });

  it("closes the panel when the in-panel × button is clicked", () => {
    render(<Harness />);
    fireEvent.click(
      screen.getByRole("button", { name: /toggle tweaks panel/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: /close tweaks/i }));
    expect(screen.queryByRole("dialog", { name: /tweaks/i })).toBeNull();
  });
});

describe("Tweaks — segmented controls", () => {
  it("persists density change to localStorage 'allocations.tweaks'", () => {
    render(<Harness />);
    fireEvent.click(
      screen.getByRole("button", { name: /toggle tweaks panel/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: /^Tight$/i }));
    const raw = window.localStorage.getItem("allocations.tweaks");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.density).toBe("tight");
  });

  it("applies body[data-density] when density changes", () => {
    render(<Harness />);
    fireEvent.click(
      screen.getByRole("button", { name: /toggle tweaks panel/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: /^Loose$/i }));
    expect(document.body.getAttribute("data-density")).toBe("loose");
  });

  it("flips --color-accent on the document element when Accent = Full", () => {
    render(<Harness />);
    fireEvent.click(
      screen.getByRole("button", { name: /toggle tweaks panel/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: /^Full$/i }));
    expect(
      document.documentElement.style.getPropertyValue("--color-accent"),
    ).toBe("#0E9F84");
  });

  it("removes the --color-accent override when Accent = Muted", () => {
    render(<Harness />);
    fireEvent.click(
      screen.getByRole("button", { name: /toggle tweaks panel/i }),
    );
    // Flip to Full so an override is set, then back to Muted.
    fireEvent.click(screen.getByRole("button", { name: /^Full$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Muted$/i }));
    expect(
      document.documentElement.style.getPropertyValue("--color-accent"),
    ).toBe("");
  });

  it("persists bridgeVariant change", () => {
    render(<Harness />);
    fireEvent.click(
      screen.getByRole("button", { name: /toggle tweaks panel/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: /^Subtle$/i }));
    const parsed = JSON.parse(
      window.localStorage.getItem("allocations.tweaks")!,
    );
    expect(parsed.bridgeVariant).toBe("subtle");
  });

  it("persists chartStyle, showBench, and showOutcomes", () => {
    render(<Harness />);
    fireEvent.click(
      screen.getByRole("button", { name: /toggle tweaks panel/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: /^Line$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Off$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Hide$/i }));
    const parsed = JSON.parse(
      window.localStorage.getItem("allocations.tweaks")!,
    );
    expect(parsed.chartStyle).toBe("line");
    expect(parsed.showBench).toBe(false);
    expect(parsed.showOutcomes).toBe(false);
  });

  it("Reset to defaults writes TWEAK_DEFAULTS back to localStorage", () => {
    render(<Harness />);
    fireEvent.click(
      screen.getByRole("button", { name: /toggle tweaks panel/i }),
    );
    // Move off defaults first.
    fireEvent.click(screen.getByRole("button", { name: /^Tight$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Sans$/i }));
    fireEvent.click(screen.getByRole("button", { name: /reset to defaults/i }));
    const parsed = JSON.parse(
      window.localStorage.getItem("allocations.tweaks")!,
    );
    expect(parsed).toEqual({
      density: "comfortable",
      accentIntensity: "muted",
      displayFont: "serif",
      bridgeVariant: "full",
      chartStyle: "area",
      showBench: true,
      showOutcomes: true,
    });
  });
});

describe("Tweaks — hydration", () => {
  it("restores persisted state on mount", () => {
    window.localStorage.setItem(
      "allocations.tweaks",
      JSON.stringify({
        density: "loose",
        accentIntensity: "full",
        displayFont: "sans",
        bridgeVariant: "subtle",
        chartStyle: "line",
        showBench: false,
        showOutcomes: false,
      }),
    );
    render(<Harness />);
    fireEvent.click(
      screen.getByRole("button", { name: /toggle tweaks panel/i }),
    );
    // body[data-density] should reflect the persisted "loose".
    expect(document.body.getAttribute("data-density")).toBe("loose");
    // --color-accent override applied because accentIntensity was "full".
    expect(
      document.documentElement.style.getPropertyValue("--color-accent"),
    ).toBe("#0E9F84");
  });

  it("falls back to defaults when localStorage contains malformed JSON", () => {
    window.localStorage.setItem("allocations.tweaks", "not-json");
    expect(() =>
      act(() => {
        render(<Harness />);
      }),
    ).not.toThrow();
    fireEvent.click(
      screen.getByRole("button", { name: /toggle tweaks panel/i }),
    );
    // No body[data-density] means we hydrated to "comfortable" (the
    // provider only sets the attribute, never explicitly removes it on
    // the default path) — assert the persisted state below.
    expect(document.body.getAttribute("data-density")).toBe("comfortable");
  });
});

describe("Tweaks — context fallback outside provider", () => {
  function NakedProbe() {
    const { state } = useTweaks();
    return (
      <div data-testid="probe">
        {state.bridgeVariant}/{state.chartStyle}/{String(state.showBench)}
      </div>
    );
  }

  it("returns TWEAK_DEFAULTS when consumed outside a TweaksProvider", () => {
    render(<NakedProbe />);
    expect(screen.getByTestId("probe").textContent).toBe("full/area/true");
  });
});

describe("Tweaks — postMessage bridge invariant", () => {
  it("Tweaks.tsx source contains zero postMessage / message-listener references", () => {
    // Belt + suspenders. The designer bundle's prototype cross-window
    // bridge is permanently stripped; this test fails fast if anyone
    // re-introduces the channel.
    const filePath = resolve(__dirname, "Tweaks.tsx");
    const src = readFileSync(filePath, "utf8");
    expect(src).not.toMatch(/postMessage/);
    expect(src).not.toMatch(/addEventListener\([^)]*['"`]message['"`]/);
  });
});
