"use client";

import { createContext, startTransition, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { FactsheetPayload } from "@/lib/factsheet/types";

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

type PersistedState = {
  range?: string;
  cmp?: ComparatorKey;
  cb?: string | true;
  reg?: string | true;
  dark?: string | true;
};

export function FactsheetProvider({
  payload,
  children,
}: {
  payload: FactsheetPayload;
  children: ReactNode;
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
  const setXRange = useCallback(
    (next: readonly [number, number]) => {
      const maxIdx = payload.dates.length - 1;
      let [s, e] = next;
      if (s < 0) s = 0;
      if (e > maxIdx) e = maxIdx;
      if (e - s < MIN_VISIBLE_SAMPLES - 1) e = Math.min(maxIdx, s + MIN_VISIBLE_SAMPLES - 1);
      if (e - s < MIN_VISIBLE_SAMPLES - 1) s = Math.max(0, e - MIN_VISIBLE_SAMPLES + 1);
      startTransition(() => setXRangeRaw([s, e]));
    },
    [payload.dates.length],
  );

  // resetXRange is low-volume (one click), so the eager update is preferable
  // — wrapping it in startTransition risks interleaving with the URL-writer
  // debounce when a user pans then immediately resets.
  const resetXRange = useCallback(() => setXRangeRaw(fullRange), [fullRange]);

  // URL + localStorage persistence — read once on mount (client-only so SSR
  // stays deterministic), then write back on every change (debounced 250ms).
  const hydrated = useRef(false);
  // SSR-safe URL/localStorage hydration. setState in this effect is the
  // standard hydration pattern — we can't read window state during render.
  useEffect(() => {
    if (typeof window === "undefined" || hydrated.current) return;
    hydrated.current = true;
    const params = new URLSearchParams(window.location.search);
    const storageKey = `factsheet-v2:${payload.strategyId}`;
    const stored = (() => {
      try {
        const raw = window.localStorage.getItem(storageKey);
        return raw ? (JSON.parse(raw) as Partial<PersistedState>) : null;
      } catch { return null; }
    })();
    const get = (k: string) => params.get(k) ?? stored?.[k as keyof PersistedState];
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
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setComparator(cmpRaw);
    }
    const cbRaw = get("cb");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (cbRaw === "1" || cbRaw === true) setColorblind(true);
    const regRaw = get("reg");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (regRaw === "1" || regRaw === true) setRegimes(true);
    const darkRaw = get("dark");
    if (darkRaw === "1" || darkRaw === true) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDarkMode(true);
    }
    // Display defaults to "everything off" — no system-preference inference
    // for dark mode. The user opts in explicitly via the Display popover.
  }, [payload.strategyId, payload.dates.length]);

  // Debounced write-back — only fires after hydration so we don't blow away
  // URL state before we've read it.
  const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (typeof window === "undefined" || !hydrated.current) return;
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
      const storageKey = `factsheet-v2:${payload.strategyId}`;
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(state));
      } catch { /* private mode / quota */ }
    }, 250);
    return () => {
      if (writeTimer.current) clearTimeout(writeTimer.current);
    };
  }, [xRange, comparator, colorblind, regimes, darkMode, payload.strategyId, payload.dates.length, payload.activeComparator]);

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
