import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Phase 09.1 Plan 11 / V3 — Tweaks panel tests.
 *
 * The QA-mode gate is mocked via `vi.mock("@/lib/qa-mode", ...)` and
 * NEVER via `vi.stubEnv`. The constant is read once at module import,
 * so we use a `let` whose value is captured by the hoisted mock factory
 * and toggle it between the false-gate and true-gate describe blocks.
 *
 * Tests cover (≥ 8 cases):
 *   1. Hide when QA_MODE is false (returns null).
 *   2. Show floating ⚙ trigger when QA_MODE is true.
 *   3. Click trigger → panel opens.
 *   4. Changing density → localStorage["allocations.tweaks"] persists.
 *   5. Reload simulation → state restored from localStorage.
 *   6. Reset to defaults → localStorage matches TWEAK_DEFAULTS.
 *   7. Malformed localStorage → loads defaults without throwing.
 *   8. postMessage invariant — Tweaks.tsx source contains zero
 *      `postMessage` / `addEventListener("message"...)` references
 *      (belt + suspenders with the grep acceptance criterion).
 */

// Hoisted by vi.mock — factory captures `qaModeValue` by reference.
let qaModeValue = true;
vi.mock("@/lib/qa-mode", () => ({
  get QA_MODE() {
    return qaModeValue;
  },
}));

// localStorage stub — codebase idiom (clones useDashboardConfig P6 pattern).
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
  // Each test starts from a clean localStorage so persistence assertions
  // don't see leftover state from a sibling test.
  lsStore.clear();
  localStorageMock.getItem.mockClear();
  localStorageMock.setItem.mockClear();
});

afterEach(() => {
  // Reset to true (the common case) so a missed setter in one test
  // doesn't leak into the next.
  qaModeValue = true;
});

describe("Tweaks — QA-mode gate hidden", () => {
  it("renders nothing when QA_MODE is false", async () => {
    qaModeValue = false;
    const { Tweaks } = await import("./Tweaks");
    const { container } = render(<Tweaks />);
    expect(container.firstChild).toBeNull();
  });
});

describe("Tweaks — QA-mode gate visible", () => {
  it("shows the floating trigger when QA_MODE is true", async () => {
    qaModeValue = true;
    const { Tweaks } = await import("./Tweaks");
    render(<Tweaks />);
    expect(
      screen.getByRole("button", { name: /open tweaks panel/i }),
    ).toBeInTheDocument();
  });

  it("opens the panel when the trigger is clicked", async () => {
    qaModeValue = true;
    const { Tweaks } = await import("./Tweaks");
    render(<Tweaks />);
    fireEvent.click(
      screen.getByRole("button", { name: /open tweaks panel/i }),
    );
    expect(screen.getByRole("dialog", { name: /tweaks/i })).toBeInTheDocument();
  });

  it("persists density change to localStorage 'allocations.tweaks'", async () => {
    qaModeValue = true;
    const { Tweaks } = await import("./Tweaks");
    render(<Tweaks />);
    fireEvent.click(
      screen.getByRole("button", { name: /open tweaks panel/i }),
    );
    const select = screen.getByRole("combobox", { name: /density/i });
    fireEvent.change(select, { target: { value: "compact" } });
    const raw = window.localStorage.getItem("allocations.tweaks");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.density).toBe("compact");
  });

  it("restores persisted state on remount (simulated reload)", async () => {
    qaModeValue = true;
    window.localStorage.setItem(
      "allocations.tweaks",
      JSON.stringify({
        density: "spacious",
        accentIntensity: "loud",
        displayFont: "sans",
        bridgeVariant: "subtle",
        chartStyle: "line",
        showOutcomes: false,
        showBench: false,
      }),
    );
    const { Tweaks } = await import("./Tweaks");
    render(<Tweaks />);
    fireEvent.click(
      screen.getByRole("button", { name: /open tweaks panel/i }),
    );
    const densitySelect = screen.getByRole("combobox", {
      name: /density/i,
    }) as HTMLSelectElement;
    expect(densitySelect.value).toBe("spacious");
    const fontSelect = screen.getByRole("combobox", {
      name: /font/i,
    }) as HTMLSelectElement;
    expect(fontSelect.value).toBe("sans");
  });

  it("reset-to-defaults writes TWEAK_DEFAULTS back to localStorage", async () => {
    qaModeValue = true;
    const { Tweaks } = await import("./Tweaks");
    render(<Tweaks />);
    fireEvent.click(
      screen.getByRole("button", { name: /open tweaks panel/i }),
    );
    // Move off defaults first.
    fireEvent.change(screen.getByRole("combobox", { name: /density/i }), {
      target: { value: "compact" },
    });
    // Now click "Reset to defaults".
    fireEvent.click(
      screen.getByRole("button", { name: /reset to defaults/i }),
    );
    const raw = window.localStorage.getItem("allocations.tweaks");
    const parsed = JSON.parse(raw!);
    expect(parsed).toEqual({
      density: "comfortable",
      accentIntensity: "muted",
      displayFont: "serif",
      bridgeVariant: "full",
      chartStyle: "area",
      showOutcomes: true,
      showBench: true,
    });
  });

  it("falls back to defaults when localStorage contains malformed JSON", async () => {
    qaModeValue = true;
    window.localStorage.setItem("allocations.tweaks", "not-json");
    const { Tweaks } = await import("./Tweaks");
    // The render call must not throw even though the parse fails.
    expect(() =>
      act(() => {
        render(<Tweaks />);
      }),
    ).not.toThrow();
    fireEvent.click(
      screen.getByRole("button", { name: /open tweaks panel/i }),
    );
    const densitySelect = screen.getByRole("combobox", {
      name: /density/i,
    }) as HTMLSelectElement;
    // Default density is "comfortable".
    expect(densitySelect.value).toBe("comfortable");
  });

  it("invokes onChange after every state mutation", async () => {
    qaModeValue = true;
    const onChange = vi.fn();
    const { Tweaks } = await import("./Tweaks");
    render(<Tweaks onChange={onChange} />);
    fireEvent.click(
      screen.getByRole("button", { name: /open tweaks panel/i }),
    );
    fireEvent.change(screen.getByRole("combobox", { name: /bridge/i }), {
      target: { value: "subtle" },
    });
    // onChange called at least once with the new bridgeVariant.
    expect(onChange).toHaveBeenCalled();
    const last = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(last.bridgeVariant).toBe("subtle");
  });
});

describe("Tweaks — postMessage bridge invariant", () => {
  it("Tweaks.tsx source contains zero postMessage / message-listener references", () => {
    // Belt + suspenders with the grep acceptance criterion. The designer
    // bundle's prototype bridge is permanently stripped per D-19; this
    // test fails fast if anyone re-introduces the cross-window channel.
    const filePath = resolve(__dirname, "Tweaks.tsx");
    const src = readFileSync(filePath, "utf8");
    expect(src).not.toMatch(/postMessage/);
    expect(src).not.toMatch(/addEventListener\([^)]*['"`]message['"`]/);
  });
});
