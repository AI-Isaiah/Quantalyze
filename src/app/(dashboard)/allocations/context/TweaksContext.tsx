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
import {
  useCrossTabStorage,
  type DecodeResult,
  type StorageCodec,
} from "@/lib/storage/cross-tab";
import { stripPoisonKeys } from "@/lib/storage/codecs";

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
 * only re-render when the slice they read changes.
 *
 * B7 (cross-tab/cross-version storage safety) — persistence now routes
 * through the `useCrossTabStorage` primitive + {@link tweakStateCodec}. The
 * primitive owns the localStorage mechanics (SSR-safe deferred hydration,
 * cross-tab StorageEvent sync, the dirtyRef observe-without-rewrite guard that
 * replaces the old hand-rolled `fromCrossTabEventRef` write-back loop guard,
 * fail-loud console + Sentry breadcrumbs on a corrupt/failed read or write);
 * the codec owns parse + per-field validate + serialize. The persisted key
 * stays "allocations.tweaks" with the UNVERSIONED `JSON.stringify(state)` shape
 * from the v0.15.x QA-gated component, so stored preferences survive the lift
 * byte-for-byte (the codec adds no version envelope).
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
// state). The codec's decode is the single seam where runtime data crosses in.
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
  if (typeof candidate === "string" && (allowed as ReadonlySet<string>).has(candidate)) {
    return candidate as T;
  }
  return fallback;
}

/**
 * Per-field coercion of an already-poison-stripped plain record into a
 * `TweakState`. Each field independently falls back to its default when the
 * persisted value is absent or outside its union — a single drifted field (a
 * rolled-back 4th density option, a hand-edited blob) folds to that field's
 * default while every other valid field survives. Unknown extra keys are
 * dropped (the projection only reads the 7 known fields), so a stray
 * `version`/`futureKnob` cannot leak into typed state.
 */
function parseTweakFields(r: Record<string, unknown>): TweakState {
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
    chartStyle: pickUnion(r.chartStyle, CHART_STYLE_VALUES, TWEAK_DEFAULTS.chartStyle),
    showBench:
      typeof r.showBench === "boolean" ? r.showBench : TWEAK_DEFAULTS.showBench,
    showOutcomes:
      typeof r.showOutcomes === "boolean"
        ? r.showOutcomes
        : TWEAK_DEFAULTS.showOutcomes,
  };
}

/**
 * B7 cross-tab storage codec for the UNVERSIONED `allocations.tweaks` blob.
 *
 * The cross-tab primitive owns the localStorage mechanics; this codec owns
 * parse + per-field validate + serialize. The persisted shape is the bare
 * `JSON.stringify(TweakState)` the v0.15.x QA-gated component shipped (no
 * version envelope), so {@link tweakStateCodec.encode} is a plain
 * `JSON.stringify` — a round-trip is byte-identical and existing blobs load
 * unchanged (the byte-compat gate). Decode salvages field-by-field rather than
 * resetting the whole blob on one drifted field; a hard failure (non-JSON, or a
 * non-object top level) returns the defaults with a "reset" outcome so the
 * primitive emits its fail-loud console + Sentry breadcrumb.
 *
 * MUST be pure / side-effect free (the StorageCodec contract): decode runs on
 * every cross-tab StorageEvent, and during render under "lazy" hydration. The
 * per-field invalid-value console.warn the pre-B7 loader emitted (the L9
 * silent-failure audit fix) is therefore dropped here. The primitive's
 * blob-level fail-loud breadcrumb (parse_failed / schema_invalid → console.warn
 * + Sentry) is STRONGER for whole-blob corruption, but does NOT cover a single
 * drifted field on an otherwise-valid blob — that case decodes "ok" and emits
 * nothing. This is a knowing, accepted narrowing of the L9 fix's debuggability
 * intent: the field still self-heals to its default (no wrong value reaches
 * state, pinned by the union-whitelist tests), and faithfully restoring the
 * per-field signal would require the shared primitive to surface per-field
 * coercion on an "ok" decode — out of scope for this consumer, tracked.
 */
export const tweakStateCodec: StorageCodec<TweakState> = {
  decode(raw: string | null): DecodeResult<TweakState> {
    if (raw == null) return { value: TWEAK_DEFAULTS, outcome: "ok", reason: null };
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { value: TWEAK_DEFAULTS, outcome: "reset", reason: "parse_failed" };
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { value: TWEAK_DEFAULTS, outcome: "reset", reason: "schema_invalid" };
    }
    // Strip prototype-poison own keys (e.g. a hand-edited `{"__proto__":{...}}`
    // blob) before reading r.density / r.bridgeVariant so a hostile payload
    // cannot surface a value through the prototype chain.
    const r = stripPoisonKeys(parsed) as Record<string, unknown>;
    return { value: parseTweakFields(r), outcome: "ok", reason: null };
  },
  encode(value: TweakState): string {
    // Byte-compatible with the pre-B7 `JSON.stringify(state)` write — no version
    // envelope, so a round-trip is byte-identical and v0.15.x blobs survive.
    return JSON.stringify(value);
  },
};

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
  // B7 — the primitive owns SSR-safe deferred hydration, cross-tab sync, and
  // the dirtyRef observe-without-rewrite guard (cross-tab adoption + the
  // hydration load never re-persist; only a user `setValue` does). debounceMs:0
  // keeps writes synchronous, preserving the pre-B7 write-on-every-change
  // semantics (display-pref writes are infrequent enough that debounce buys
  // little, and the Tweaks panel tests pin a synchronous getItem-after-change).
  const { value: state, setValue } = useCrossTabStorage<TweakState>({
    key: STORAGE_KEY,
    initial: TWEAK_DEFAULTS,
    codec: tweakStateCodec,
    debounceMs: 0,
    sentryArea: STORAGE_KEY,
  });
  const [panelOpen, setPanelOpen] = useState(false);

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

  const set = useCallback<TweaksContextValue["set"]>(
    (key, value) => {
      setValue((prev) => ({ ...prev, [key]: value }));
    },
    [setValue],
  );

  const reset = useCallback(() => setValue(TWEAK_DEFAULTS), [setValue]);
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
