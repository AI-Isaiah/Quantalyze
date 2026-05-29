"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
// the declared unions through the JSON.parse cast — guarding the schema-less
// parse anti-pattern (a raw cast that lets unvalidated values into typed
// state). The load path is the single seam where runtime data crosses in.
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
  fieldName?: string,
): T {
  if (typeof candidate === "string") {
    if ((allowed as ReadonlySet<string>).has(candidate)) {
      return candidate as T;
    }
    // retro audit (silent-failure-hunter L9 c9): distinguish "never
    // set" (skip log) from "set to invalid value" (warn). A persisted
    // ultra-tight density (from a feature flag that shipped a 4th
    // option and was rolled back, or hand-edited localStorage)
    // previously snapped to the fallback with no breadcrumb — exactly
    // the silent-drift the audit said this fix was supposed to close.
    if (candidate.length > 0 && typeof console !== "undefined") {
      console.warn(
        "[TweaksContext] parseTweakState — discarding unknown value, falling back to default",
        { field: fieldName ?? "unknown", value: candidate, fallback },
      );
    }
  }
  return fallback;
}

function parseTweakState(raw: unknown): TweakState {
  if (!raw || typeof raw !== "object") return TWEAK_DEFAULTS;
  // retro audit (red-team L12 c7): rebase the input through
  // Object.create(null) so a hostile `__proto__` payload in
  // localStorage cannot smuggle a value through the prototype chain
  // when we read r.density / r.bridgeVariant / etc. Without this,
  // a hand-edited blob like `{"__proto__":{"density":"tight"}}`
  // could surface "tight" via prototype lookup even though the own-
  // property is absent.
  const r = Object.assign(
    Object.create(null) as Record<string, unknown>,
    raw as Record<string, unknown>,
  );
  return {
    density: pickUnion(r.density, DENSITY_VALUES, TWEAK_DEFAULTS.density, "density"),
    accentIntensity: pickUnion(
      r.accentIntensity,
      ACCENT_VALUES,
      TWEAK_DEFAULTS.accentIntensity,
      "accentIntensity",
    ),
    displayFont: pickUnion(
      r.displayFont,
      DISPLAY_FONT_VALUES,
      TWEAK_DEFAULTS.displayFont,
      "displayFont",
    ),
    bridgeVariant: pickUnion(
      r.bridgeVariant,
      BRIDGE_VARIANT_VALUES,
      TWEAK_DEFAULTS.bridgeVariant,
      "bridgeVariant",
    ),
    chartStyle: pickUnion(
      r.chartStyle,
      CHART_STYLE_VALUES,
      TWEAK_DEFAULTS.chartStyle,
      "chartStyle",
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

  // retro audit (red-team L6 c8): the persist effect re-enters on every
  // state change. In Safari private mode / quota-exhausted contexts the
  // catch fires per keystroke (chip click flips state, persist effect
  // runs, throws, warns). A user dragging the density slider could emit
  // 3-4 warnings in <100ms; Sentry capture-console converts each to a
  // separate event. The audit's "support paper trail" becomes a flood
  // that buries the actual signal. Dedupe with a ref so we warn at most
  // once per session.
  const persistWarnedRef = useRef(false);
  // red-team C1: guard to break the cross-tab write-back loop.
  // When Tab B's onStorage listener fires, it sets this ref to true
  // BEFORE calling setState so the persist effect can check it and
  // skip the redundant re-write that would fire the storage event
  // back at Tab A (and thus loop indefinitely). The ref is reset to
  // false inside the persist effect after the check, once per render.
  const fromCrossTabEventRef = useRef(false);

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
    // red-team C1: if this render was triggered by a cross-tab storage event,
    // skip the write-back — writing the same JSON would fire storage in the
    // other tab, which would setState here again, looping indefinitely.
    if (fromCrossTabEventRef.current) {
      fromCrossTabEventRef.current = false;
      return;
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      // Safari private mode / quota errors are non-fatal for the in-memory
      // state, but they DO mean the user's preferences won't survive reload —
      // surface that to the console so a support ticket can be diagnosed.
      // Dedupe so a quota-exhausted browser doesn't flood console / Sentry.
      if (!persistWarnedRef.current && typeof console !== "undefined") {
        persistWarnedRef.current = true;
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

  // Outcomes-tile visibility — surfaces body[data-show-outcomes] so the
  // single CSS rule in globals.css can hide the Outcomes tab button +
  // tabpanel without prop-drilling. Default `true` is rendered as the
  // attribute being absent (cleaner DOM than data-show-outcomes="true"
  // attached to every page).
  useEffect(() => {
    if (state.showOutcomes) {
      document.body.removeAttribute("data-show-outcomes");
    } else {
      document.body.setAttribute("data-show-outcomes", "false");
    }
    return () => {
      document.body.removeAttribute("data-show-outcomes");
    };
  }, [state.showOutcomes]);

  // Accent intensity — swap --color-accent + --color-accent-hover at the
  // root so all DESIGN.md token consumers (border-accent, text-accent,
  // bg-accent, var(--color-accent-hover) etc.) flip in lock-step.
  //
  // NEW-C22-02: return a cleanup that removes the three inline properties so
  // they don't survive onto other routes after the allocations route unmounts.
  //
  // NEW-C22-03: use a data attribute instead of inline style properties so the
  // dark factsheet palette can re-declare --color-accent* inside its own scope
  // (see globals.css) and win the cascade for dark-mode consumers. An inline
  // style.setProperty on <html> wins over any class rule (including !important
  // class rules for custom properties); writing only an attribute lets the
  // dark factsheet CSS block override the custom properties within its subtree.
  useEffect(() => {
    const root = document.documentElement;
    if (state.accentIntensity === "full") {
      root.setAttribute("data-accent-intensity", "full");
    } else {
      root.removeAttribute("data-accent-intensity");
    }
    return () => {
      root.removeAttribute("data-accent-intensity");
    };
  }, [state.accentIntensity]);

  // NEW-C22-01: cross-tab sync. Without this listener, Tab A toggles density
  // → Tab B's in-memory state stays stale → Tab B's next knob change persists
  // its stale snapshot, overwriting Tab A's edit (last-writer-wins). Re-parse
  // + setState on same-key storage events, wrapped in the same try/catch as
  // loadTweaks so Safari private-mode failures stay silent.
  //
  // red-team C1 fix: set fromCrossTabEventRef BEFORE calling setState so the
  // persist effect (keyed on [state, hydrated]) knows this state change came
  // from another tab and must not write back to localStorage. Without this
  // guard, Tab B receives storage → setState → persist effect fires → writes
  // same JSON → fires storage in Tab A → onStorage → setState → ... loop.
  useEffect(() => {
    if (typeof window === "undefined") return;
    function onStorage(e: StorageEvent) {
      if (e.key !== STORAGE_KEY) return;
      if (e.newValue === null) return; // ignore clears
      try {
        fromCrossTabEventRef.current = true;
        setState(parseTweakState(JSON.parse(e.newValue)));
      } catch (err) {
        // Parse failed — reset the flag so the next local user change
        // does persist normally.
        fromCrossTabEventRef.current = false;
        if (typeof console !== "undefined") {
          console.warn("[TweaksContext] cross-tab storage event parse failed", err);
        }
      }
    }
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
    };
  }, []);

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
