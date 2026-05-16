"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * PR3 (HANDOFF G5) — TweaksProvider
 *
 * Centralizes the 7-knob design-variation state for the allocator
 * dashboard, lifted out of QA mode so allocators can pick:
 *
 *   density          tight | comfortable | loose   → body[data-density]
 *   accentIntensity  muted | full                  → root style --accent
 *   displayFont      serif | sans                  → consumed by displayClass
 *   bridgeVariant    subtle | card | full          → BridgeWidget variant prop
 *   chartStyle       line | area                   → EquityChart fill mode
 *   showBench        boolean                       → EquityChart benchmark line
 *   showOutcomes     boolean                       → outcomes tile visibility
 *
 * Side effects flow through useEffect inside the provider so consumers
 * only re-render when the slice they read changes. Persistence is in
 * localStorage under "allocations.tweaks" (keeps the v0.15.x key from
 * the QA-gated component so stored preferences survive the lift).
 */

export type TweakState = {
  density: "tight" | "comfortable" | "loose";
  accentIntensity: "muted" | "full";
  displayFont: "serif" | "sans";
  bridgeVariant: "subtle" | "card" | "full";
  chartStyle: "line" | "area";
  showBench: boolean;
  showOutcomes: boolean;
};

export const TWEAK_DEFAULTS: TweakState = {
  density: "comfortable",
  accentIntensity: "muted",
  displayFont: "serif",
  bridgeVariant: "full",
  chartStyle: "area",
  showBench: true,
  showOutcomes: true,
};

const STORAGE_KEY = "allocations.tweaks";

// Field-by-field guards keep persisted blobs from smuggling values outside
// the declared unions through the JSON.parse cast. Mirrors the schema-less
// parse anti-pattern flagged on useDashboardConfig.loadV2Config — the load
// path is the single seam where runtime data crosses into typed state.
const DENSITY_VALUES: ReadonlySet<TweakState["density"]> = new Set([
  "tight",
  "comfortable",
  "loose",
]);
const ACCENT_VALUES: ReadonlySet<TweakState["accentIntensity"]> = new Set([
  "muted",
  "full",
]);
const DISPLAY_FONT_VALUES: ReadonlySet<TweakState["displayFont"]> = new Set([
  "serif",
  "sans",
]);
const BRIDGE_VARIANT_VALUES: ReadonlySet<TweakState["bridgeVariant"]> = new Set([
  "subtle",
  "card",
  "full",
]);
const CHART_STYLE_VALUES: ReadonlySet<TweakState["chartStyle"]> = new Set([
  "line",
  "area",
]);

function pickUnion<T extends string>(
  candidate: unknown,
  allowed: ReadonlySet<T>,
  fallback: T,
): T {
  return typeof candidate === "string" && (allowed as ReadonlySet<string>).has(candidate)
    ? (candidate as T)
    : fallback;
}

function parseTweakState(raw: unknown): TweakState {
  if (!raw || typeof raw !== "object") return TWEAK_DEFAULTS;
  const r = raw as Record<string, unknown>;
  return {
    density: pickUnion(r.density, DENSITY_VALUES, TWEAK_DEFAULTS.density),
    accentIntensity: pickUnion(
      r.accentIntensity,
      ACCENT_VALUES,
      TWEAK_DEFAULTS.accentIntensity,
    ),
    displayFont: pickUnion(
      r.displayFont,
      DISPLAY_FONT_VALUES,
      TWEAK_DEFAULTS.displayFont,
    ),
    bridgeVariant: pickUnion(
      r.bridgeVariant,
      BRIDGE_VARIANT_VALUES,
      TWEAK_DEFAULTS.bridgeVariant,
    ),
    chartStyle: pickUnion(
      r.chartStyle,
      CHART_STYLE_VALUES,
      TWEAK_DEFAULTS.chartStyle,
    ),
    showBench:
      typeof r.showBench === "boolean" ? r.showBench : TWEAK_DEFAULTS.showBench,
    showOutcomes:
      typeof r.showOutcomes === "boolean"
        ? r.showOutcomes
        : TWEAK_DEFAULTS.showOutcomes,
  };
}

function loadTweaks(): TweakState {
  if (typeof window === "undefined") return TWEAK_DEFAULTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return TWEAK_DEFAULTS;
    return parseTweakState(JSON.parse(raw));
  } catch (err) {
    // Surfacing the failure (corrupt JSON, Safari SecurityError, quota exceeded
    // on a stale browser, etc.) gives ops a console signal — the prior bare
    // catch coerced every failure mode into 'defaults' indistinguishably.
    if (typeof console !== "undefined") {
      console.warn("[TweaksContext] loadTweaks failed; falling back to defaults", err);
    }
    return TWEAK_DEFAULTS;
  }
}

type TweaksContextValue = {
  state: TweakState;
  set: <K extends keyof TweakState>(key: K, value: TweakState[K]) => void;
  reset: () => void;
  panelOpen: boolean;
  togglePanel: () => void;
  closePanel: () => void;
};

const TweaksContext = createContext<TweaksContextValue | null>(null);

export function TweaksProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<TweakState>(TWEAK_DEFAULTS);
  const [panelOpen, setPanelOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate post-mount to avoid SSR mismatch.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(loadTweaks());
    setHydrated(true);
  }, []);

  // Persist whenever state changes (after hydration so we never overwrite
  // the stored value with TWEAK_DEFAULTS on the initial render).
  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      // Safari private mode / quota errors are non-fatal for the in-memory
      // state, but they DO mean the user's preferences won't survive reload —
      // surface that to the console so a support ticket can be diagnosed.
      if (typeof console !== "undefined") {
        console.warn(
          "[TweaksContext] localStorage write failed; preferences will not persist",
          err,
        );
      }
    }
  }, [state, hydrated]);

  // Apply density via body[data-density] so the truth file's
  // body[data-density="tight"] / "loose" CSS rules can swap --row-h
  // and --density-pad globally without prop-drilling.
  useEffect(() => {
    document.body.setAttribute("data-density", state.density);
    return () => {
      document.body.removeAttribute("data-density");
    };
  }, [state.density]);

  // Apply displayFont via body[data-display-font]. The default ("serif")
  // leaves .font-display resolving to Instrument Serif via --font-serif;
  // the "sans" choice swaps every display heading to DM Sans through a
  // single CSS rule in globals.css. Body-attribute approach avoids touching
  // every consumer's className.
  useEffect(() => {
    document.body.setAttribute("data-display-font", state.displayFont);
    return () => {
      document.body.removeAttribute("data-display-font");
    };
  }, [state.displayFont]);

  // Accent intensity — swap --color-accent + --color-accent-hover at the
  // root so all DESIGN.md token consumers (border-accent, text-accent,
  // bg-accent, var(--color-accent-hover) etc.) flip in lock-step.
  useEffect(() => {
    const root = document.documentElement;
    if (state.accentIntensity === "full") {
      root.style.setProperty("--color-accent", "#0E9F84");
      root.style.setProperty("--color-accent-hover", "#0B8870");
      root.style.setProperty("--color-chart-strategy", "#0E9F84");
    } else {
      // Reset to globals.css defaults.
      root.style.removeProperty("--color-accent");
      root.style.removeProperty("--color-accent-hover");
      root.style.removeProperty("--color-chart-strategy");
    }
  }, [state.accentIntensity]);

  const set = useCallback<TweaksContextValue["set"]>((key, value) => {
    setState((prev) => ({ ...prev, [key]: value }));
  }, []);

  const reset = useCallback(() => setState(TWEAK_DEFAULTS), []);
  const togglePanel = useCallback(() => setPanelOpen((v) => !v), []);
  const closePanel = useCallback(() => setPanelOpen(false), []);

  const value = useMemo(
    () => ({ state, set, reset, panelOpen, togglePanel, closePanel }),
    [state, set, reset, panelOpen, togglePanel, closePanel],
  );

  return (
    <TweaksContext.Provider value={value}>{children}</TweaksContext.Provider>
  );
}

export function useTweaks(): TweaksContextValue {
  const ctx = useContext(TweaksContext);
  if (!ctx) {
    // Tests / standalone widgets that render outside the provider get the
    // defaults. This is intentional — every widget must function with
    // factory defaults regardless of whether tweaks are active.
    return {
      state: TWEAK_DEFAULTS,
      set: () => {},
      reset: () => {},
      panelOpen: false,
      togglePanel: () => {},
      closePanel: () => {},
    };
  }
  return ctx;
}

/**
 * Read a single knob from the context. Same defaults-fallback as
 * useTweaks() so widgets render correctly outside the provider.
 */
export function useTweakValue<K extends keyof TweakState>(key: K): TweakState[K] {
  return useTweaks().state[key];
}
