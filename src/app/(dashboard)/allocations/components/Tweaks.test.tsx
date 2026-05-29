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
  document.body.removeAttribute("data-display-font");
  document.body.removeAttribute("data-show-outcomes");
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

  it("sets data-accent-intensity=full on the document element when Accent = Full (NEW-C22-03)", () => {
    render(<Harness />);
    fireEvent.click(
      screen.getByRole("button", { name: /toggle tweaks panel/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: /^Full$/i }));
    // NEW-C22-03: accent override now driven via CSS attribute, not inline
    // style properties, so dark factsheet can re-scope the custom properties.
    expect(
      document.documentElement.getAttribute("data-accent-intensity"),
    ).toBe("full");
  });

  it("removes the data-accent-intensity attribute when Accent = Muted (NEW-C22-03)", () => {
    render(<Harness />);
    fireEvent.click(
      screen.getByRole("button", { name: /toggle tweaks panel/i }),
    );
    // Flip to Full so an override is set, then back to Muted.
    fireEvent.click(screen.getByRole("button", { name: /^Full$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Muted$/i }));
    expect(
      document.documentElement.getAttribute("data-accent-intensity"),
    ).toBeNull();
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

  it("sets body[data-show-outcomes='false'] when the Outcomes tab is hidden", () => {
    render(<Harness />);
    fireEvent.click(
      screen.getByRole("button", { name: /toggle tweaks panel/i }),
    );
    // Default Outcomes tab is "Show" — attribute absent.
    expect(document.body.hasAttribute("data-show-outcomes")).toBe(false);
    // Open the panel and toggle Outcomes tab to Hide.
    fireEvent.click(screen.getByRole("button", { name: /^Hide$/i }));
    expect(document.body.getAttribute("data-show-outcomes")).toBe("false");
    // Flip back to Show — attribute removed (clean DOM in the common case).
    fireEvent.click(screen.getByRole("button", { name: /^Show$/i }));
    expect(document.body.hasAttribute("data-show-outcomes")).toBe(false);
  });

  it("sets body[data-display-font='sans'] when Display font flips to Sans", () => {
    render(<Harness />);
    fireEvent.click(
      screen.getByRole("button", { name: /toggle tweaks panel/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: /^Sans$/i }));
    expect(document.body.getAttribute("data-display-font")).toBe("sans");
    fireEvent.click(screen.getByRole("button", { name: /^Serif$/i }));
    expect(document.body.getAttribute("data-display-font")).toBe("serif");
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
    // NEW-C22-03: accent attribute applied because accentIntensity was "full".
    expect(
      document.documentElement.getAttribute("data-accent-intensity"),
    ).toBe("full");
  });

  // M-1079 — the displayFont knob's body[data-display-font] effect
  // (TweaksContext.tsx:243-248) must restore the persisted value on mount,
  // mirroring the body[data-density] hydration coverage above. The existing
  // "restores persisted state on mount" test persists displayFont:'sans' but
  // only asserts data-density + --color-accent — the parallel displayFont
  // attribute assertion was missing, so a regression that drops the
  // displayFont effect (the exact bug PR4 #3 fixed) would not fail any test.
  it("restores persisted displayFont='sans' to body[data-display-font] on mount (M-1079)", () => {
    window.localStorage.setItem(
      "allocations.tweaks",
      JSON.stringify({
        density: "comfortable",
        accentIntensity: "muted",
        displayFont: "sans",
        bridgeVariant: "full",
        chartStyle: "area",
        showBench: true,
        showOutcomes: true,
      }),
    );
    render(<Harness />);
    // The provider's displayFont effect runs post-hydration and writes the
    // restored value to the body attribute.
    expect(document.body.getAttribute("data-display-font")).toBe("sans");
  });

  it("restores the default displayFont='serif' to body[data-display-font] when nothing is persisted (M-1079)", () => {
    // No persisted blob → hydrates to TWEAK_DEFAULTS.displayFont='serif'.
    render(<Harness />);
    expect(document.body.getAttribute("data-display-font")).toBe("serif");
  });

  // M-1085 (pr-test-analyzer) — the original bug was a persist effect that
  // fired on the FIRST render and wrote TWEAK_DEFAULTS before hydration read
  // localStorage, clobbering a concurrent cross-tab write. B7 routes
  // persistence through useCrossTabStorage, whose `dirtyRef` makes hydration
  // (and cross-tab adoption) observe-without-rewrite: NOTHING is persisted
  // until the user actually mutates a knob. That is strictly stronger than the
  // old single-default-write-on-mount — there is no default write to clobber
  // with. These pin the contract by counting `allocations.tweaks` setItem
  // writes:
  //   - clean mount → ZERO writes (nothing persisted until a user change).
  //   - first user knob change → exactly ONE write (carrying the change).
  function tweaksSetItemCount(): number {
    return (
      localStorageMock.setItem.mock.calls as unknown as Array<[string, string]>
    ).filter(([k]) => k === "allocations.tweaks").length;
  }

  it("M-1085: clean mount writes 'allocations.tweaks' zero times (observe-without-rewrite)", () => {
    // localStorage is clean (beforeEach clears the store + the setItem spy).
    act(() => {
      render(<Harness />);
    });
    // Zero writes — deferred hydration loads defaults but the primitive's
    // dirtyRef keeps the load observe-without-rewrite, so the dashboard never
    // persists TWEAK_DEFAULTS just by mounting (no key to clobber another tab).
    expect(tweaksSetItemCount()).toBe(0);
  });

  it("M-1085: first user knob change writes 'allocations.tweaks' exactly once", () => {
    act(() => {
      render(<Harness />);
    });
    expect(tweaksSetItemCount()).toBe(0);
    fireEvent.click(
      screen.getByRole("button", { name: /toggle tweaks panel/i }),
    );
    // Opening the panel changes only panelOpen (not persisted state), so no
    // tweaks write is triggered by the toggle itself.
    expect(tweaksSetItemCount()).toBe(0);
    // A real knob change flips persisted state → exactly one write.
    fireEvent.click(screen.getByRole("button", { name: /^Tight$/i }));
    expect(tweaksSetItemCount()).toBe(1);
    const lastWrite = (
      localStorageMock.setItem.mock.calls as unknown as Array<[string, string]>
    )
      .filter(([k]) => k === "allocations.tweaks")
      .at(-1)![1];
    expect(JSON.parse(lastWrite).density).toBe("tight");
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

  it("NEW-C22-01: cross-tab storage event updates density in the mounted provider", () => {
    // Start with "comfortable" (default).
    act(() => {
      render(<Harness />);
    });
    expect(document.body.getAttribute("data-density")).toBe("comfortable");

    // Simulate another tab writing a new blob with density="tight".
    const newBlob = JSON.stringify({ ...{
      density: "tight",
      accentIntensity: "muted",
      displayFont: "serif",
      bridgeVariant: "full",
      chartStyle: "area",
      showBench: true,
      showOutcomes: true,
    } });
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "allocations.tweaks",
          newValue: newBlob,
        }),
      );
    });

    // Provider should have updated body[data-density] to "tight".
    expect(document.body.getAttribute("data-density")).toBe("tight");
  });
});

/**
 * Retroactive audit on PR #183 — pr-test-analyzer flagged three HIGH
 * test gaps that left silent-revert risk:
 *
 *   L17 c9: parseTweakState field-by-field validation has no tests for
 *           the invalid-value-falls-back-to-default branch. A revert to
 *           the pre-PR `{ ...TWEAK_DEFAULTS, ...parsed }` spread would
 *           pass every existing test even though invalid values would
 *           silently smuggle through.
 *   L18 c8: loadTweaks console.warn on corrupt JSON is never asserted.
 *           A revert to bare `catch {}` would not fail any test.
 *   L19 c8: persist effect console.warn on setItem failure (quota /
 *           SecurityError) is never asserted. Same revert risk.
 *
 * These tests pin all three contracts so the audit-2026-05-07 fix
 * survives future cleanup passes.
 */
// B7: the field-by-field union whitelist these cases pin now lives in
// tweakStateCodec.decode (parseTweakFields); they run through the provider so
// they exercise the codec end-to-end via useCrossTabStorage.
describe("Tweaks — retroactive audit-2026-05-16 — tweakStateCodec union whitelist (pr-test L17 c9)", () => {
  it("density:'ultra-tight' falls back to TWEAK_DEFAULTS.density='comfortable'", () => {
    window.localStorage.setItem(
      "allocations.tweaks",
      JSON.stringify({
        density: "ultra-tight",
        accentIntensity: "muted",
        displayFont: "serif",
        bridgeVariant: "full",
        chartStyle: "area",
        showBench: true,
        showOutcomes: true,
      }),
    );
    render(<Harness />);
    expect(document.body.getAttribute("data-density")).toBe("comfortable");
  });

  it("bridgeVariant:99 (non-string) falls back to TWEAK_DEFAULTS.bridgeVariant='full'", () => {
    window.localStorage.setItem(
      "allocations.tweaks",
      JSON.stringify({
        density: "tight",
        accentIntensity: "muted",
        displayFont: "serif",
        bridgeVariant: 99,
        chartStyle: "area",
        showBench: true,
        showOutcomes: true,
      }),
    );
    // density:'tight' IS valid, so it hydrates; bridgeVariant 99 must
    // fall back to 'full' (TWEAK_DEFAULTS).
    render(<Harness />);
    expect(document.body.getAttribute("data-density")).toBe("tight");
    // Probe through useTweaks via context after hydration to assert
    // bridgeVariant fell back.
    function Probe() {
      const { state } = useTweaks();
      return <div data-testid="probe-bridge">{state.bridgeVariant}</div>;
    }
    // Re-render same Harness with a probe nested in the provider.
    render(
      <TweaksProvider>
        <Probe />
      </TweaksProvider>,
    );
    expect(screen.getByTestId("probe-bridge").textContent).toBe("full");
  });

  // M-0111 — existing cases cover malformed JSON + single-field-invalid
  // fallbacks, but NOT (1) a partial-shape blob (object present, some keys
  // simply absent) or (2) a valid blob carrying EXTRA unknown fields. The
  // field-by-field parse (parseTweakState) must keep present valid keys,
  // default the absent ones, and silently ignore unknown keys.
  it("M-0111: partial-shape blob — present valid key retained, absent keys default", () => {
    // Only `density` is present (and valid); everything else is absent.
    window.localStorage.setItem(
      "allocations.tweaks",
      JSON.stringify({ density: "loose" }),
    );
    function Probe() {
      const { state } = useTweaks();
      return (
        <div>
          <span data-testid="p-density">{state.density}</span>
          <span data-testid="p-accent">{state.accentIntensity}</span>
          <span data-testid="p-font">{state.displayFont}</span>
          <span data-testid="p-bridge">{state.bridgeVariant}</span>
          <span data-testid="p-chart">{state.chartStyle}</span>
          <span data-testid="p-bench">{String(state.showBench)}</span>
          <span data-testid="p-outcomes">{String(state.showOutcomes)}</span>
        </div>
      );
    }
    render(
      <TweaksProvider>
        <Probe />
      </TweaksProvider>,
    );
    // Present valid key retained.
    expect(screen.getByTestId("p-density").textContent).toBe("loose");
    // Absent keys fall to TWEAK_DEFAULTS.
    expect(screen.getByTestId("p-accent").textContent).toBe("muted");
    expect(screen.getByTestId("p-font").textContent).toBe("serif");
    expect(screen.getByTestId("p-bridge").textContent).toBe("full");
    expect(screen.getByTestId("p-chart").textContent).toBe("area");
    expect(screen.getByTestId("p-bench").textContent).toBe("true");
    expect(screen.getByTestId("p-outcomes").textContent).toBe("true");
  });

  it("M-0111: valid blob with EXTRA unknown fields — extras ignored, known fields retained", () => {
    window.localStorage.setItem(
      "allocations.tweaks",
      JSON.stringify({
        density: "tight",
        accentIntensity: "full",
        displayFont: "sans",
        bridgeVariant: "card",
        chartStyle: "line",
        showBench: false,
        showOutcomes: false,
        // Unknown keys a future schema version / hand-edit might smuggle in:
        futureKnob: "experimental",
        nested: { whatever: true },
        version: 99,
      }),
    );
    function Probe() {
      const { state } = useTweaks();
      // Surface the full state as JSON so we can assert it equals exactly the
      // known-key projection (no extra keys leaked into typed state).
      return <div data-testid="p-json">{JSON.stringify(state)}</div>;
    }
    render(
      <TweaksProvider>
        <Probe />
      </TweaksProvider>,
    );
    const parsed = JSON.parse(screen.getByTestId("p-json").textContent!);
    expect(parsed).toEqual({
      density: "tight",
      accentIntensity: "full",
      displayFont: "sans",
      bridgeVariant: "card",
      chartStyle: "line",
      showBench: false,
      showOutcomes: false,
    });
    // Extra keys must NOT have leaked into the typed state object.
    expect(Object.keys(parsed)).not.toContain("futureKnob");
    expect(Object.keys(parsed)).not.toContain("version");
  });

  it("accentIntensity:null falls back to TWEAK_DEFAULTS.accentIntensity='muted'", () => {
    window.localStorage.setItem(
      "allocations.tweaks",
      JSON.stringify({
        density: "comfortable",
        accentIntensity: null,
        displayFont: "serif",
        bridgeVariant: "full",
        chartStyle: "area",
        showBench: true,
        showOutcomes: true,
      }),
    );
    render(<Harness />);
    // accentIntensity='muted' means the --color-accent override is NOT applied.
    expect(
      document.documentElement.style.getPropertyValue("--color-accent"),
    ).toBe("");
  });

  it("showBench:'yes' (non-boolean) falls back to TWEAK_DEFAULTS.showBench=true", () => {
    window.localStorage.setItem(
      "allocations.tweaks",
      JSON.stringify({
        density: "comfortable",
        accentIntensity: "muted",
        displayFont: "serif",
        bridgeVariant: "full",
        chartStyle: "area",
        showBench: "yes",
        showOutcomes: true,
      }),
    );
    function Probe() {
      const { state } = useTweaks();
      return <div data-testid="probe-show-bench">{String(state.showBench)}</div>;
    }
    render(
      <TweaksProvider>
        <Probe />
      </TweaksProvider>,
    );
    expect(screen.getByTestId("probe-show-bench").textContent).toBe("true");
  });
});

describe("Tweaks — retroactive audit-2026-05-16 — corrupt-JSON warn (pr-test L18 c8)", () => {
  it("emits a fail-loud console.warn when localStorage contains malformed JSON", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    window.localStorage.setItem("allocations.tweaks", "not-json");
    render(<Harness />);
    // B7: tweakStateCodec returns outcome "reset" (parse_failed); the
    // useCrossTabStorage primitive surfaces the fail-loud breadcrumb (and a
    // Sentry breadcrumb tagged area="allocations.tweaks").
    expect(
      warnSpy.mock.calls.some(
        (c) => typeof c[0] === "string" && c[0].includes("[cross-tab] storage reset"),
      ),
    ).toBe(true);
    warnSpy.mockRestore();
  });
});

describe("Tweaks — retroactive audit-2026-05-16 — persist setItem failure warn (pr-test L19 c8)", () => {
  it("persist effect emits console.warn when localStorage.setItem throws", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Make the FIRST persist write throw. The mount itself is now
    // observe-without-rewrite (zero writes — B7), so the mockOnce throw lands
    // on the first user knob change below, where the primitive's persist
    // catch surfaces the fail-loud warn. The hydrate read still succeeds
    // (returns null → defaults) so the provider mounts cleanly.
    localStorageMock.setItem.mockImplementationOnce(() => {
      throw new Error("storage unavailable");
    });
    render(<Harness />);
    fireEvent.click(
      screen.getByRole("button", { name: /toggle tweaks panel/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: /^Tight$/i }));
    expect(
      warnSpy.mock.calls.some(
        (c) =>
          typeof c[0] === "string" &&
          c[0].includes("[cross-tab] localStorage write failed"),
      ),
    ).toBe(true);
    warnSpy.mockRestore();
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

describe("Tweaks — red-team C1: cross-tab write-back loop prevention", () => {
  // WHY this matters: a provider that re-persists on every state change would
  // loop — Tab B receives a storage event → setState → persist effect fires →
  // writes the same JSON back → fires a storage event in Tab A → onStorage →
  // setState → … until a tab closes. The pre-B7 provider guarded this with a
  // hand-rolled `fromCrossTabEventRef`; B7 deletes that guard and relies on the
  // primitive's `dirtyRef`: cross-tab adoption sets state via setValueState (not
  // setValue), so dirtyRef stays false and the persist effect early-returns,
  // never writing the adopted value back.
  it("cross-tab storage event updates in-memory state but does NOT write back to localStorage", () => {
    act(() => {
      render(<Harness />);
    });
    // Under B7 a clean mount is observe-without-rewrite, so the baseline is ZERO
    // writes (M-1085). Pin that here too, then prove the cross-tab event adds none.
    const writesBefore = (
      localStorageMock.setItem.mock.calls as unknown as Array<[string, string]>
    ).filter(([k]) => k === "allocations.tweaks").length;
    expect(writesBefore).toBe(0);

    const newBlob = JSON.stringify({
      density: "loose",
      accentIntensity: "muted",
      displayFont: "serif",
      bridgeVariant: "full",
      chartStyle: "area",
      showBench: true,
      showOutcomes: true,
    });
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "allocations.tweaks",
          newValue: newBlob,
        }),
      );
    });

    // In-memory state MUST have updated (cross-tab sync works).
    expect(document.body.getAttribute("data-density")).toBe("loose");

    // localStorage.setItem MUST NOT have been called — the primitive's dirtyRef
    // keeps cross-tab adoption observe-without-rewrite (the persist effect
    // early-returns on !dirtyRef), so no write-back fires.
    const writesAfter = (
      localStorageMock.setItem.mock.calls as unknown as Array<[string, string]>
    ).filter(([k]) => k === "allocations.tweaks").length;
    expect(writesAfter).toBe(writesBefore);
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
