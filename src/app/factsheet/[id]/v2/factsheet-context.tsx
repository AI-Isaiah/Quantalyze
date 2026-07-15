"use client";

import { createContext, startTransition, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { FactsheetPayload } from "@/lib/factsheet/types";
import {
  useCrossTabStorage,
  type DecodeResult,
  type StorageCodec,
} from "@/lib/storage/cross-tab";
import { stripPoisonKeys } from "@/lib/storage/codecs";

type ComparatorKey = FactsheetPayload["activeComparator"];

/**
 * Split context architecture — four narrow contexts instead of one bloated
 * provider. Consumers subscribe only to the slice they actually read, so
 * pan/zoom (high churn) doesn't re-render metrics tables or signature
 * panels (which only care about comparator + payload).
 *
 *   - PayloadContext: static; never changes after mount.
 *   - XRangeContext: high churn (every pan/zoom frame).
 *   - ComparatorContext: medium churn (picker swap).
 *   - TogglesContext: low churn (display preferences).
 *
 * Persistence: xRange + comparator + toggles round-trip through the URL
 * query string and localStorage so refresh and link-sharing preserve view.
 */

interface XRangeContextValue {
  xRange: readonly [number, number];
  setXRange: (next: readonly [number, number]) => void;
  resetXRange: () => void;
}

interface ComparatorContextValue {
  comparator: ComparatorKey;
  setComparator: (next: ComparatorKey) => void;
}

interface TogglesContextValue {
  colorblind: boolean;
  setColorblind: (next: boolean) => void;
  regimes: boolean;
  setRegimes: (next: boolean) => void;
  darkMode: boolean;
  setDarkMode: (next: boolean) => void;
}

/**
 * RegimesContext is split out from TogglesContext because regimes drives
 * chart compute (overlay bands) while dark/colorblind only affect CSS vars
 * on the shell. Charts that subscribe to RegimesContext alone don't
 * re-render on dark-mode toggles, which is the whole point of the split.
 */
interface RegimesContextValue {
  regimes: boolean;
}

/**
 * DisplayContext = colorblind + darkMode (the two flags that flow into the
 * shell's CSS-variable injection). Peeled out so FactsheetShell can subscribe
 * without re-rendering on regimes flips or every xRange pan frame.
 */
interface DisplayContextValue {
  colorblind: boolean;
  darkMode: boolean;
}

const PayloadContext = createContext<FactsheetPayload | null>(null);
const XRangeContext = createContext<XRangeContextValue | null>(null);
const ComparatorContext = createContext<ComparatorContextValue | null>(null);
const TogglesContext = createContext<TogglesContextValue | null>(null);
const RegimesContext = createContext<RegimesContextValue | null>(null);
const DisplayContext = createContext<DisplayContextValue | null>(null);

const MIN_VISIBLE_SAMPLES = 5;

/**
 * The persisted factsheet view-state shape. Both the URL query string and the
 * localStorage blob carry these five fields:
 *   range  — `"${startIdx}-${endIdx}"` (the x-axis window; absent ⇒ full range)
 *   cmp    — the active comparator key ("btc" | "spx" | "none")
 *   cb     — colorblind toggle: the string "1" when on (or `true` from a URL
 *            param's bare presence), absent when off
 *   reg    — regimes overlay toggle: same "1"/`true`/absent domain as `cb`
 *   dark   — dark-mode toggle: same "1"/`true`/absent domain as `cb`
 */
type PersistedState = {
  range?: string;
  cmp?: ComparatorKey;
  cb?: string | true;
  reg?: string | true;
  dark?: string | true;
};

const COMPARATOR_VALUES: ReadonlySet<ComparatorKey> = new Set([
  "btc",
  "spx",
  "none",
]);

/**
 * Per-field coercion of an already-poison-stripped plain record into a
 * `PersistedState`. Each field independently drops to "absent" (undefined)
 * when the persisted value is missing or outside its domain, so a single
 * drifted field (a rolled-back comparator key, a hand-edited blob) folds away
 * while every valid field survives. Unknown extra keys are dropped (the
 * projection only reads the five known fields).
 *
 * `cb`/`reg`/`dark` are stored as the literal string "1" (the write effect
 * below only ever writes "1"); we keep `=== true` too so a URL param's bare
 * presence (`?cb`) read back from a prior URL-only session still coerces. Any
 * other value folds to undefined (off).
 */
function parsePersistedFields(r: Record<string, unknown>): PersistedState {
  const out: PersistedState = {};
  if (typeof r.range === "string") out.range = r.range;
  if (typeof r.cmp === "string" && (COMPARATOR_VALUES as ReadonlySet<string>).has(r.cmp)) {
    out.cmp = r.cmp as ComparatorKey;
  }
  if (r.cb === "1" || r.cb === true) out.cb = r.cb;
  if (r.reg === "1" || r.reg === true) out.reg = r.reg;
  if (r.dark === "1" || r.dark === true) out.dark = r.dark;
  return out;
}

/**
 * B7 — UNVERSIONED cross-tab storage codec for the `factsheet-v2:${strategyId}`
 * blob. The cross-tab primitive owns the localStorage mechanics; this codec
 * owns parse + per-field validate + serialize. The persisted shape is the bare
 * `JSON.stringify(state)` the pre-B7 hand-rolled persist effect wrote (no
 * version envelope), so {@link factsheetViewStateCodec.encode} is a plain
 * `JSON.stringify` — a round-trip is byte-identical and existing users' saved
 * factsheet views load unchanged (the byte-compat gate; adding a version field
 * would reset every stored view exactly once). Mirrors `tweakStateCodec`.
 *
 * MUST be pure / side-effect free (the StorageCodec contract): decode runs on
 * every cross-tab StorageEvent and during render under "lazy" hydration. Decode
 * salvages field-by-field rather than resetting the whole blob on one drifted
 * field; a hard failure (non-JSON ⇒ "parse_failed", or a non-object top level
 * ⇒ "not_object") returns the empty default with a "reset" outcome so the
 * primitive emits its fail-loud console + Sentry breadcrumb.
 */
const EMPTY_PERSISTED: PersistedState = {};

export const factsheetViewStateCodec: StorageCodec<PersistedState> = {
  decode(raw: string | null): DecodeResult<PersistedState> {
    if (raw == null) return { value: EMPTY_PERSISTED, outcome: "ok", reason: null };
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { value: EMPTY_PERSISTED, outcome: "reset", reason: "parse_failed" };
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { value: EMPTY_PERSISTED, outcome: "reset", reason: "not_object" };
    }
    // Strip prototype-poison own keys before reading r.range / r.cmp so a
    // hand-edited `{"__proto__":{...}}` blob cannot surface a value through the
    // prototype chain.
    const r = stripPoisonKeys(parsed) as Record<string, unknown>;
    return { value: parsePersistedFields(r), outcome: "ok", reason: null };
  },
  encode(value: PersistedState): string {
    // Byte-compatible with the pre-B7 `JSON.stringify(state)` write — no
    // version envelope, so a round-trip is byte-identical and existing blobs
    // survive. The write effect below constructs `state` with the same field
    // order (range, cmp, cb, reg, dark) the pre-B7 effect used.
    return JSON.stringify(value);
  },
};

export function FactsheetProvider({
  payload,
  children,
  persist = true,
}: {
  payload: FactsheetPayload;
  children: ReactNode;
  /**
   * Additive opt-out (default `true`) that gates BOTH the view-state WRITE
   * effects (the URL `history.replaceState` half AND the `setStoredView`
   * localStorage half) AND the hydration READ effect. The factsheet never
   * passes it, so its link-sharing round-trip is byte-identical. The composer
   * mount (Phase 38) passes `persist={false}` so a scenario pan on the dashboard
   * tab never rewrites the allocator's dashboard URL (`?range=`) nor writes a
   * `factsheet-v2:` blob. The READ effect is ALSO gated (RT2 review fix): the
   * scenario chart shares the `/allocations` URL with the Overview factsheet,
   * which DOES write `?range/?cmp/?dark` there, so an ungated read would let
   * that sibling-tab view-state bleed into the ephemeral scenario chart. The
   * hooks still fire unconditionally (Rules of Hooks); the gate is an early
   * no-op INSIDE each effect body, after `hydrated.current` is latched.
   */
  persist?: boolean;
}) {
  const fullRange = useMemo<readonly [number, number]>(
    () => [0, Math.max(0, payload.dates.length - 1)],
    [payload.dates.length],
  );
  const [comparator, setComparator] = useState<ComparatorKey>(payload.activeComparator);
  const [xRange, setXRangeRaw] = useState<readonly [number, number]>(fullRange);
  const [colorblind, setColorblind] = useState(false);
  const [regimes, setRegimes] = useState(false);
  const [darkMode, setDarkMode] = useState(false);

  // setXRange fires 60+ times/sec during pan/zoom. Wrapping the write in a
  // transition lets React interrupt expensive chart-stack reconciliations
  // when a newer pan frame arrives — keeps dragging smooth on long pages.
  // Phase 103 (MTM-follow, F2.3): the upper clamp sizes to the LONGER of the cash
  // axis and any present mark_to_market series bundle. This provider sits ABOVE
  // BasisProvider so it cannot read the active basis, but it does not need to: a
  // cash consumer (MasterBrush/TimeSeriesChart) reads the cash `view.dates` and so
  // never emits an index beyond `payload.dates.length - 1`, making the widened
  // bound a NO-OP under cash (SC-4 byte-identity — the clamp is never exercised by
  // a cash-space index). Only under an MTM axis LONGER than cash does a brush drag
  // emit indices in `(cashLen-1, mtmLen-1]`; without this widening the old
  // cash-sized clamp clipped them, leaving the recent MTM days PERMANENTLY
  // unreachable (the reported harm). `fullRange` below deliberately STAYS
  // cash-sized so the initial/reset window and the URL full-range sentinel are
  // byte-identical under cash.
  const setXRange = useCallback(
    (next: readonly [number, number]) => {
      const maxIdx =
        Math.max(
          payload.dates.length,
          payload.seriesByBasis?.mark_to_market?.dates.length ?? 0,
        ) - 1;
      let [s, e] = next;
      if (s < 0) s = 0;
      if (e > maxIdx) e = maxIdx;
      if (e - s < MIN_VISIBLE_SAMPLES - 1) e = Math.min(maxIdx, s + MIN_VISIBLE_SAMPLES - 1);
      if (e - s < MIN_VISIBLE_SAMPLES - 1) s = Math.max(0, e - MIN_VISIBLE_SAMPLES + 1);
      startTransition(() => setXRangeRaw([s, e]));
    },
    [payload.dates.length, payload.seriesByBasis?.mark_to_market?.dates.length],
  );

  // resetXRange is low-volume (one click), so the eager update is preferable
  // — wrapping it in startTransition risks interleaving with the URL-writer
  // debounce when a user pans then immediately resets.
  const resetXRange = useCallback(() => setXRangeRaw(fullRange), [fullRange]);

  // B7 — the localStorage half of view-state persistence now routes through the
  // cross-tab primitive + `factsheetViewStateCodec` (SSR-safe deferred
  // hydration, the dirtyRef observe-without-rewrite guard, fail-loud console +
  // Sentry on a corrupt/failed read or write, and sign-out-purge coverage via
  // the registered `factsheet-v2:` prefix). The URL query-string half stays a
  // `history.replaceState` write below — the primitive only owns localStorage.
  // The 250ms debounce that preserved the pre-B7 write cadence lives on the
  // OUTER write effect (it has to, because it also debounces the URL
  // replaceState); the primitive itself writes synchronously (debounceMs:0) when
  // that already-debounced effect fires `setStoredView`, so the total
  // localStorage cadence stays ~250ms rather than stacking two debounces.
  //
  // crossTab:false — unlike the discovery/scenario/tweaks consumers, factsheet
  // view-state is ALSO mirrored in the URL query string (the co-source-of-truth
  // for link-sharing), and hydration is intentionally one-shot: the read effect
  // below latches on `hydrated.current` and reconciles URL-wins-over-storage
  // exactly once. Live-adopting a cross-tab StorageEvent into the already-mounted
  // view would have to re-reconcile against the URL and the five split view
  // states without clobbering an in-progress pan — complexity with no real payoff
  // for two tabs of the same factsheet. So this consumer takes the primitive's
  // hardened persist + fail-loud + SSR-safe load and opts OUT of the live
  // listener (rather than wiring an inert one whose events nothing consumes).
  //
  // The key stays `factsheet-v2:${strategyId}` with the UNVERSIONED
  // `JSON.stringify(state)` shape so existing stored views survive byte-for-byte.
  const { value: storedView, setValue: setStoredView, isHydrated: storageHydrated } =
    useCrossTabStorage<PersistedState>({
      key: `factsheet-v2:${payload.strategyId}`,
      initial: EMPTY_PERSISTED,
      codec: factsheetViewStateCodec,
      debounceMs: 0,
      crossTab: false,
      hydration: "deferred",
      sentryArea: "factsheet.view",
    });

  // URL + localStorage hydration — read once after the primitive's deferred
  // load completes (client-only so SSR stays deterministic). URL params win
  // over the stored blob (link-sharing precedence), matching the pre-B7 `get`.
  const hydrated = useRef(false);
  // SSR-safe URL/storage hydration. setState in this effect is the standard
  // hydration pattern — we can't read window/storage state during render, and
  // we must wait for the primitive's deferred load (storageHydrated) so
  // `storedView` carries the persisted blob rather than the empty initial.
  useEffect(() => {
    if (typeof window === "undefined" || hydrated.current || !storageHydrated) return;
    hydrated.current = true;
    // RT2 review fix — when persistence is OFF (the composer's ephemeral
    // scenario chart), do NOT hydrate from the shared URL/localStorage. This
    // chart lives on the /allocations route alongside the Overview factsheet,
    // which DOES write ?range/?cmp/?dark to that SAME URL; adopting them would
    // bleed the sibling tab's view-state (dark-mode, comparator, a foreign-axis
    // range index) into the scenario chart. An ephemeral chart starts from its
    // own defaults — there is nothing legitimate for it to hydrate.
    if (!persist) return;
    const params = new URLSearchParams(window.location.search);
    const get = (k: keyof PersistedState) =>
      params.get(k) ?? storedView[k];
    const maxIdx = payload.dates.length - 1;

    const rangeRaw = get("range");
    if (typeof rangeRaw === "string") {
      const [s, e] = rangeRaw.split("-").map(n => parseInt(n, 10));
      if (Number.isFinite(s) && Number.isFinite(e) && s >= 0 && e <= maxIdx && e - s >= MIN_VISIBLE_SAMPLES - 1) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setXRangeRaw([s, e] as const);
      }
    }
    const cmpRaw = get("cmp");
    if (cmpRaw === "btc" || cmpRaw === "spx" || cmpRaw === "none") {
      setComparator(cmpRaw);
    }
    const cbRaw = get("cb");
    if (cbRaw === "1" || cbRaw === true) setColorblind(true);
    const regRaw = get("reg");
    if (regRaw === "1" || regRaw === true) setRegimes(true);
    const darkRaw = get("dark");
    if (darkRaw === "1" || darkRaw === true) {
      setDarkMode(true);
    }
    // Display defaults to "everything off" — no system-preference inference
    // for dark mode. The user opts in explicitly via the Display popover.
  }, [payload.strategyId, payload.dates.length, storageHydrated, storedView, persist]);

  // Debounced write-back — only fires after hydration so we don't blow away
  // URL/stored state before we've read it. The URL half is a synchronous
  // `replaceState` here; the localStorage half is delegated to the primitive's
  // own debounced persist via `setStoredView`.
  const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    // `!persist` gates BOTH write halves (URL replaceState + setStoredView): the
    // hook still registers (Rules of Hooks) but performs no write, so a composer
    // mount (persist={false}) never touches the dashboard URL or localStorage.
    if (typeof window === "undefined" || !hydrated.current || !persist) return;
    if (writeTimer.current) clearTimeout(writeTimer.current);
    writeTimer.current = setTimeout(() => {
      const state: PersistedState = {
        range: `${xRange[0]}-${xRange[1]}`,
        cmp: comparator,
        cb: colorblind ? "1" : undefined,
        reg: regimes ? "1" : undefined,
        dark: darkMode ? "1" : undefined,
      };
      const params = new URLSearchParams(window.location.search);
      const fullRangeStr = `0-${payload.dates.length - 1}`;
      if (state.range && state.range !== fullRangeStr) params.set("range", state.range);
      else params.delete("range");
      if (state.cmp && state.cmp !== payload.activeComparator) params.set("cmp", state.cmp);
      else params.delete("cmp");
      if (state.cb) params.set("cb", "1"); else params.delete("cb");
      if (state.reg) params.set("reg", "1"); else params.delete("reg");
      if (state.dark) params.set("dark", "1"); else params.delete("dark");
      const qs = params.toString();
      const next = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
      window.history.replaceState(null, "", next);
      // localStorage persist routes through the primitive (its own debounce +
      // cross-tab flush). Byte-compat: encode is a bare JSON.stringify(state).
      setStoredView(state);
    }, 250);
    return () => {
      if (writeTimer.current) clearTimeout(writeTimer.current);
    };
  }, [xRange, comparator, colorblind, regimes, darkMode, payload.strategyId, payload.dates.length, payload.activeComparator, setStoredView, persist]);

  // Identity-stable value objects so each context only re-emits when its
  // own slice changes. The lower-churn contexts can stay shallow-equal
  // across high-churn xRange updates.
  const xRangeValue = useMemo<XRangeContextValue>(
    () => ({ xRange, setXRange, resetXRange }),
    [xRange, setXRange, resetXRange],
  );
  const comparatorValue = useMemo<ComparatorContextValue>(
    () => ({ comparator, setComparator }),
    [comparator],
  );
  const togglesValue = useMemo<TogglesContextValue>(
    () => ({ colorblind, setColorblind, regimes, setRegimes, darkMode, setDarkMode }),
    [colorblind, regimes, darkMode],
  );
  const regimesValue = useMemo<RegimesContextValue>(() => ({ regimes }), [regimes]);
  const displayValue = useMemo<DisplayContextValue>(() => ({ colorblind, darkMode }), [colorblind, darkMode]);

  return (
    <PayloadContext.Provider value={payload}>
      <TogglesContext.Provider value={togglesValue}>
        <DisplayContext.Provider value={displayValue}>
          <RegimesContext.Provider value={regimesValue}>
            <ComparatorContext.Provider value={comparatorValue}>
              <XRangeContext.Provider value={xRangeValue}>
                {children}
              </XRangeContext.Provider>
            </ComparatorContext.Provider>
          </RegimesContext.Provider>
        </DisplayContext.Provider>
      </TogglesContext.Provider>
    </PayloadContext.Provider>
  );
}

/** Subscribe to the immutable payload only. Free re-render on any other change. */
export function usePayload(): FactsheetPayload {
  const v = useContext(PayloadContext);
  if (!v) throw new Error("usePayload must be used inside <FactsheetProvider>");
  return v;
}

/** Subscribe to xRange + setters. Re-renders on every pan/zoom — use sparingly. */
export function useXRange(): XRangeContextValue {
  const v = useContext(XRangeContext);
  if (!v) throw new Error("useXRange must be used inside <FactsheetProvider>");
  return v;
}

/** Subscribe to the comparator + setter. Re-renders on picker swap only. */
export function useComparator(): ComparatorContextValue {
  const v = useContext(ComparatorContext);
  if (!v) throw new Error("useComparator must be used inside <FactsheetProvider>");
  return v;
}

/** Subscribe to display toggles. Re-renders only on toggle change. */
export function useToggles(): TogglesContextValue {
  const v = useContext(TogglesContext);
  if (!v) throw new Error("useToggles must be used inside <FactsheetProvider>");
  return v;
}

/** Subscribe to the regimes flag only. Re-renders only when regimes flips. */
export function useRegimes(): boolean {
  const v = useContext(RegimesContext);
  if (!v) throw new Error("useRegimes must be used inside <FactsheetProvider>");
  return v.regimes;
}

/** Subscribe to colorblind + darkMode (CSS-var flags). Re-renders only on those flips. */
export function useDisplay(): DisplayContextValue {
  const v = useContext(DisplayContext);
  if (!v) throw new Error("useDisplay must be used inside <FactsheetProvider>");
  return v;
}

/** Convenience: active comparator block — only subscribes to comparator + payload. */
export function useActiveComparator() {
  const payload = usePayload();
  const { comparator } = useComparator();
  return { key: comparator, block: payload.comparators[comparator] };
}

/**
 * Compatibility shim — flat-shape view that subscribes to ALL four contexts.
 * Defeats the split's perf benefit; only acceptable for cold-path consumers.
 *
 * @deprecated Prefer `usePayload`, `useXRange`, `useComparator`, `useToggles`.
 */
export function useFactsheet() {
  const payload = usePayload();
  const xr = useXRange();
  const cmp = useComparator();
  const tog = useToggles();
  return { payload, ...xr, ...cmp, ...tog };
}
