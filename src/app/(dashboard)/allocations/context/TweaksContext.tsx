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

function loadTweaks(): TweakState {
  if (typeof window === "undefined") return TWEAK_DEFAULTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return TWEAK_DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<TweakState>;
    return { ...TWEAK_DEFAULTS, ...parsed };
  } catch {
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
    } catch {
      // Safari private mode / quota — non-fatal.
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
