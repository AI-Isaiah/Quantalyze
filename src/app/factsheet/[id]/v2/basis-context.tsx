"use client";

import {
  createContext,
  useContext,
  useDeferredValue,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { FactsheetPayload, ComputeSummary, ComparatorBlock } from "@/lib/factsheet/types";
import { overlayBasisScalars, BASIS_KPI_MAP } from "@/lib/factsheet/basis-metrics";
import { deriveSeriesBundle } from "@/lib/factsheet/build-payload";
import { sanitizeLeverage } from "@/lib/leverage";
import { LeverageContext } from "./leverage-context";
import { useXRange } from "./factsheet-context";

/**
 * Phase 90 (FS-03, CONTEXT D5/D7) — the NARROW, EPHEMERAL basis context.
 *
 * Kept in a NEW file rather than the FROZEN `factsheet-context.tsx` (D7): it
 * mirrors that file's split-context template (`RegimesContext` — a narrow
 * context + memoized value + a hook that throws outside its provider) WITHOUT
 * importing any of its state internals.
 *
 * GUARD-04 (ephemeral by construction): this file contains NO browser-storage,
 * cookie, URL query, or history-API access anywhere — the cross-tab persistence
 * block (`factsheet-context.tsx:253-350`) is the anti-pattern deliberately NOT
 * copied. Basis lives in component state only, so every fresh view opens on cash
 * and toggling writes nothing to the URL or storage. Pinned by
 * `FactsheetBody.guard04-no-bleed.test.tsx` (no factsheet-keyspace write) and
 * `FactsheetBody.basis.test.tsx` (no-persistence-on-toggle).
 */
export type Basis = "cash_settlement" | "mark_to_market" | "smoothed_mtm";

/**
 * WR-01 hardening (Phase 107 review) — a BRANDED leverage value that has passed the
 * `sanitizeLeverage` + `useDeferredValue` pipeline (the value the shared view actually
 * derived its numbers from). `leverageApplies` requires this brand, so passing the RAW
 * immediate `useLeverage().leverage` (a plain `number`) into the gate is now a COMPILE
 * error — structurally closing the WR-01 immediate-vs-deferred divergence class rather
 * than relying on a convention. The brand is minted at exactly two trusted derivation
 * points: `useAppliedLeverage()` and the view's own sanitized+deferred `L`.
 */
export type AppliedLeverage = number & { readonly __applied: unique symbol };

interface BasisContextValue {
  basis: Basis;
  setBasis: (next: Basis) => void;
}

const BasisContext = createContext<BasisContextValue | null>(null);

/**
 * 169.1 review MD-01 — a range gesture in progress (a brush pan or handle drag).
 * While one is held, the windowed view keeps the range the gesture STARTED on, so
 * the strip and the rail derive once when the gesture ends instead of once per
 * pointer move (each derive runs the 2000-resample bootstrap: measured ~290 ms at
 * 3000 observations). The charts keep following the live range.
 */
type RangeGestureValue = {
  /** The range the gesture started on, or null when no gesture is held. */
  held: readonly [number, number] | null;
  begin: (startRange: readonly [number, number]) => void;
  end: () => void;
};

const RangeGestureContext = createContext<RangeGestureValue | null>(null);

const NO_GESTURE = { begin: () => {}, end: () => {} };

/**
 * MD-01 — begin / end a range gesture. `begin(range)` takes the range the gesture
 * starts on (the one the strip shows); `end()` releases it and the windowed view
 * derives the final range once. Call `end()` on every way a gesture can stop
 * (pointer up, cancel, lost capture, unmount): a gesture never ended keeps the
 * strip on its start range. Outside a BasisProvider both are no-ops.
 */
export function useRangeGesture(): Pick<RangeGestureValue, "begin" | "end"> {
  const v = useContext(RangeGestureContext);
  return v ?? NO_GESTURE;
}

/**
 * Ephemeral basis state. Renders children only (no DOM element) so wrapping the
 * FactsheetBody tree is transparent to the GUARD-02 byte-identity gate. Default
 * `cash_settlement` (D5).
 */
export function BasisProvider({ children }: { children: ReactNode }) {
  const [basis, setBasis] = useState<Basis>("cash_settlement");
  const value = useMemo<BasisContextValue>(() => ({ basis, setBasis }), [basis]);
  const [held, setHeld] = useState<readonly [number, number] | null>(null);
  // begin / end keep ONE identity for the provider's life, so a consumer's
  // unmount-cleanup effect keyed on `end` never fires (and releases the hold)
  // just because a gesture began.
  const actions = useMemo(
    () => ({ begin: (startRange: readonly [number, number]) => setHeld(startRange), end: () => setHeld(null) }),
    [],
  );
  const gesture = useMemo<RangeGestureValue>(() => ({ held, ...actions }), [held, actions]);
  return (
    <BasisContext.Provider value={value}>
      <RangeGestureContext.Provider value={gesture}>{children}</RangeGestureContext.Provider>
    </BasisContext.Provider>
  );
}

/** Subscribe to the active basis + setter. Throws outside the provider. */
export function useBasis(): BasisContextValue {
  const v = useContext(BasisContext);
  if (!v) throw new Error("useBasis must be used inside <BasisProvider>");
  return v;
}

/**
 * Non-throwing active-basis read — degrades to `cash_settlement` outside a
 * BasisProvider. Mirrors `useBasisSeriesView`'s graceful fallback so a panel that
 * only wants an additive basis-aware NOTE (never core rendering) can mount in
 * isolation (a standalone panel test) without a provider. Use `useBasis()` when the
 * SETTER is needed or a missing provider is a real bug.
 */
export function useBasisOrCash(): Basis {
  return useContext(BasisContext)?.basis ?? "cash_settlement";
}

/**
 * The display-side basis mapping hook. Takes the payload as an argument
 * (deliberate deviation from the PATTERNS colocation in `basis-metrics.ts`: the
 * hook needs React context, but `basis-metrics.ts` must stay React-free for the
 * server-side D3 overlay — payload-as-arg avoids coupling to the frozen
 * FactsheetProvider).
 *
 *   - `cash_settlement` → `payload.strategyMetrics` UNTOUCHED. build-payload
 *     already overlaid the persisted cash scalars onto it (geometric or arithmetic
 *     per `returns_denominator_config` — Round-2 C-1; arithmetic only for the
 *     "simple"/allocated-capital override): for a composite from the stitch's
 *     object, and since Phase 169 (D-10) for a rankable single-key row from its
 *     persisted top-level scalars. So this is the persisted headline the lists show.
 *   - `mark_to_market` → a shallow copy overlaying ONLY the seven mapped
 *     {@link overlayBasisScalars} scalars from the PERSISTED
 *     `metrics_json_by_basis.mark_to_market`. α/IR and every unmapped key keep
 *     their cash value — they are never displayed under an MTM label (the seven
 *     relabeled KpiStrip cells are exactly the mapped ones; D5, no-invented-data).
 *   - `smoothed_mtm` (Phase 133, SMTM-01) → the exact smoothed sibling of the MTM
 *     arm: overlay the same seven mapped scalars from the PERSISTED
 *     `metrics_json_by_basis.smoothed_mtm`, `?? {}` so an absent object renders all
 *     seven "—" (never a cash fallback under a smoothed label).
 */
export function useBasisMetrics(payload: FactsheetPayload): {
  basis: Basis;
  m: ComputeSummary;
} {
  const { basis } = useBasis();
  const m = useMemo<ComputeSummary>(() => {
    if (basis === "mark_to_market" || basis === "smoothed_mtm") {
      // F2 (no-invented-data): STRICT overlay — any of the seven mapped scalars
      // absent / non-finite in the persisted per-basis object renders "—" (NaN),
      // NEVER the cash fallback. The `?? {}` makes an entirely-absent object render
      // all-seven "—" (the strict overlay's absent-branch keeps `base` for the
      // single-key/cash path, so a non-cash basis must force a present-empty object).
      const persisted =
        basis === "mark_to_market"
          ? payload.metricsByBasis?.mark_to_market
          : payload.metricsByBasis?.smoothed_mtm;
      return overlayBasisScalars(payload.strategyMetrics, persisted ?? {});
    }
    return payload.strategyMetrics;
  }, [basis, payload]);
  return { basis, m };
}

/**
 * Phase 103 (MTM-04) + Phase 107 (LEV-BB) — the ONE shared client view hook. It
 * composes TWO layers in order: (1) the per-basis SERIES view-merge, then (2) the
 * leverage-as-a-dailies-transform. Every one of the ~12 dailies-derivable panels
 * reads this hook, so composing leverage HERE makes the ENTIRE factsheet follow L
 * with zero per-consumer wiring — "nothing bypasses the backbone".
 *
 * Layer 1 (basis merge, Phase 103): Under `cash_settlement` (or whenever the
 * payload carries no MTM series bundle — a stale cache, a not-yet-backfilled
 * strategy, or a gated book) `base` is the ORIGINAL payload object by REFERENCE.
 * Under `mark_to_market` WITH `payload.seriesByBasis.mark_to_market` present `base`
 * is a `{...payload, ...bundle}` merge carrying the MTM-basis clones of every
 * dailies-derivable field (dates axis, the three chart tracks, rolling, worst-10,
 * comparators, the two heatmaps, quantiles, streaks, calmarByYear, bootstrapCI,
 * styleDrift, stressWindows, correlations, correlationMatrix + the bundle's own
 * `strategyMetrics` + the per-basis `missingSegments` mask). The KpiStrip's seven
 * persisted headline scalars are overlaid onto the merged `strategyMetrics` (F3).
 * `segmentBoundaries` is NOT in the bundle, so the composite key-handoff seams
 * inherit the shared basis-invariant top-level value.
 *
 * Layer 2 (leverage, Phase 107 LEV-BB): at `sanitizeLeverage(L) === 1` the hook
 * returns `base` BY REFERENCE — `deriveSeriesBundle` is NEVER called at unity (SC-4;
 * the load-bearing byte-identity mechanism, not float reasoning). At L≠1 (and past
 * four fail-closed guards) it scales the ACTIVE-basis dailies `r → L·r` and RE-derives
 * the whole bundle via the exported `deriveSeriesBundle` (SC-1). Only the strategy leg
 * is levered — the benchmark legs are re-aligned un-levered inside deriveSeriesBundle,
 * so `jointMetrics(leveredStrat, unleveredBench)` makes β→L·β / α→L·α / corr-invariant
 * fall out honestly (SC-2, pinned in joint.test.ts). `comparatorAnnVol` is OMITTED so
 * the levered comparator vol-matches its OWN levered vol (mirrors the MTM arm at
 * build-payload.ts). `missingSegments` is passed through explicitly (the bundle spread
 * would otherwise clobber the base mask with undefined).
 *
 * The four guards each return `base` BY REFERENCE (no re-derive, no fabrication):
 *   1. L === 1                            — SC-4 unity short-circuit
 *   2. dataQuality.composite === true     — A2: leverage is single-key only (composites
 *                                            also hide the slider); since Phase 169 review
 *                                            round 1 (SFH M-2) also a chain-broken or
 *                                            convention-override single-key row, whose
 *                                            stored L=1 headline the re-derive cannot
 *                                            continue (see `leverageEligibleFor`)
 *   3. periodsPerYear == null             — fail-closed (stale cache with no annualization basis)
 *   4. MTM basis + no MTM bundle OR no     — no-fabrication: an unresolved MTM label falls back
 *      persisted MTM scalar cache            to cash data (levering it renders levered-cash as
 *                                            MTM); an absent persisted MTM scalar cache means the
 *                                            L=1 KPIs are the strict-overlay "—", so a levered
 *                                            re-derive would fabricate the withheld headline
 *
 * Both contexts are read directly (NOT via useBasis/useLeverage, which throw) so a
 * chart/panel mounted WITHOUT the providers degrades to cash / L=1 instead of
 * crashing — the merge + leverage transform are pure additive enhancements.
 *
 * Context + a deferred leverage read + memo — keeps the GUARD-04 no-storage
 * discipline (this file never touches storage/URL/history; pinned by
 * basis-context.test.tsx Test 7). The only non-pure element is `useDeferredValue`
 * on the leverage read (LEV-BB perf, 107-03), which is scheduler-only — no I/O.
 */
/**
 * H-1 (Phase 107/108 Fable red team) — the SHARED levered-view cache.
 *
 * `useBasisSeriesView` memoizes PER hook instance, but it is called from ~22 consumer
 * instances across 11 components that all mount on ONE factsheet page. At L≠1 each instance
 * independently ran the expensive `deriveSeriesBundle` (bootstrapCI 2000 resamples + the
 * 6×6 correlation matrix + stress windows — ~235ms median at 3000-day scale), so dragging
 * leverage 1→2 cost ~22×235ms ≈ 5s of main-thread work before React could commit; the page
 * sat on stale 1× numbers for seconds, repeating on every L change and basis flip.
 * `useDeferredValue` (107-03) fixed input-BLOCKING but not the DUPLICATION.
 *
 * The levered view is a PURE function of `(payload, basis, appliedLeverage)`, so compute it
 * ONCE and share the result object across every instance. The WeakMap keys on payload
 * IDENTITY (entries GC with the payload, never collide across factsheets); the inner Map
 * keys on `${basis}:${L}`. Returning the SAME reference is also a correctness-preserving win
 * — it stabilizes downstream memoization. The L=1 / guard paths return `base` BY REFERENCE
 * and NEVER consult this cache (SC-4 byte-identity stays first).
 */
const leveredViewCache = new WeakMap<FactsheetPayload, Map<string, FactsheetPayload>>();

/**
 * Phase 169.1 (D-27) — the ONE argument builder for every client re-derive of the
 * series bundle: the leverage arm below and the zoom-window arm (`windowView`).
 * D-27 names it the anti-drift device: both arms re-derive with the same
 * conventions, so a window and a leverage what-if cannot disagree on how a
 * figure is computed. The caller guarantees `view.periodsPerYear` is present
 * (the leverage arm through `leverageApplies`, the window arm through its
 * no-annualization-basis withhold).
 */
function rederiveArgs(view: FactsheetPayload): Parameters<typeof deriveSeriesBundle>[1] {
  return {
    periodsPerYear: view.periodsPerYear!,
    // Phase 169.1 (D-27 as amended, D-28, D-30): the strategy's own conventions,
    // read from the payload this view derives from. The window arm needs them: an
    // arithmetic composite's window is the running sum its chart draws, and an
    // active-day-basis window's vol, Sharpe and Sortino exclude the zero days.
    // For the leverage arm they are a no-op by construction, because every payload
    // carrying a non-default convention is leverage-ineligible (a composite, or a
    // single-key payload flagged `returnsConventionOverride`, 169 SFH H-2; plan
    // 169.1-04 keeps that flag, D-83).
    isArithmetic: view.cumulativeMethod === "arithmetic",
    dayBasis: view.dayBasis,
    calendarDense: view.dataQuality?.composite === true,
    markets: view.markets,
    strategyName: view.strategyName,
    // comparatorAnnVol OMITTED — a re-derived bundle vol-matches its OWN vol
    // (mirrors the MTM arm in build-payload.ts; passing the persisted cash ann_vol
    // would un-lever the comparator vol-match, or mis-match a window).
    // missingSegments passed through so the bundle spread does not clobber the base
    // mask with undefined.
    missingSegments: view.missingSegments,
    // Phase 169.5 (SC3, D-09, D-21): BTC is re-aligned from the SAME closes and
    // `dropped` list the server used, carried on the payload. A payload without
    // the field (hand-built) has no coverage information: BTC is the unavailable
    // form, never the bundled fixture.
    benchmarkPrices: view.benchmarkPrices ?? { unavailable: true },
  };
}

function readLeveredView(
  payload: FactsheetPayload,
  basis: Basis,
  appliedLeverage: AppliedLeverage,
): FactsheetPayload | undefined {
  return leveredViewCache.get(payload)?.get(`${basis}:${appliedLeverage}`);
}

function writeLeveredView(
  payload: FactsheetPayload,
  basis: Basis,
  appliedLeverage: AppliedLeverage,
  view: FactsheetPayload,
): void {
  let byKey = leveredViewCache.get(payload);
  if (!byKey) {
    byKey = new Map();
    leveredViewCache.set(payload, byKey);
  }
  byKey.set(`${basis}:${appliedLeverage}`, view);
}

export function useBasisSeriesView(payload: FactsheetPayload): FactsheetPayload {
  const basis = useContext(BasisContext)?.basis ?? "cash_settlement";
  const rawLeverage = useContext(LeverageContext)?.leverage ?? 1;
  // LEV-BB perf (107-03): the levered re-derive was MEASURED at a ~235ms median
  // at 3000-day production scale (≥100ms decision rule → debounce). Defer the
  // leverage READ so a rapid slider drag never blocks the input on the expensive
  // deriveSeriesBundle: useDeferredValue keeps the last-good bundle rendered while
  // React re-derives the new leverage in the background — the input value stays
  // immediate (no keystroke/drag lag, no skeleton flash). The DERIVE is debounced,
  // NOT the input. The unity/base short-circuits below read this deferred value, so
  // dropping back to L=1 restores the by-reference base as soon as React catches up.
  const leverage = useDeferredValue(rawLeverage);
  return useMemo<FactsheetPayload>(() => {
    // --- Layer 1: active-basis series merge (Phase 103; Phase 133 SMTM-01 adds the
    // smoothed sibling). The active bundle + persisted scalars are chosen by basis:
    // cash → none (payload by reference), mark_to_market / smoothed_mtm → their own
    // seriesByBasis bundle + metricsByBasis scalars. Additive: a cash/MTM payload
    // selects exactly what it did before (byte-identical). ---
    const bundle =
      basis === "mark_to_market"
        ? payload.seriesByBasis?.mark_to_market
        : basis === "smoothed_mtm"
          ? payload.seriesByBasis?.smoothed_mtm
          : undefined;
    const base: FactsheetPayload = ((): FactsheetPayload => {
      if (basis === "cash_settlement" || !bundle) return payload;
      // F3 (phase 103): overlay the SEVEN persisted headline scalars onto the merged
      // `strategyMetrics` so the rail's §I headline == the KpiStrip BY CONSTRUCTION
      // (both = the persisted-dense-Python cache), killing the sparse-vs-dense AND the
      // arithmetic-vs-geometric (`cumulative_method:"simple"`) divergence for every
      // cross-surface scalar. Mirrors `useBasisMetrics`: an absent per-basis object →
      // `{}` → the STRICT overlay renders all seven "—", never a bundle-TS recompute.
      // Only the seven `BASIS_KPI_MAP` scalars are overlaid — the rail-only extended /
      // series-derived metrics (skew/VaR/quantiles/best-week/…) STAY bundle-TS-derived
      // (they have no cross-surface counterpart on the KpiStrip, exactly as the rail
      // already works for cash: only the seven have a persisted authoritative cache).
      const mtmScalars =
        (basis === "mark_to_market"
          ? payload.metricsByBasis?.mark_to_market
          : payload.metricsByBasis?.smoothed_mtm) ?? {};
      // Narrow on the ingest discriminant before spreading: the bundle has no
      // `ingestSource`, so spreading over the bare union would widen the
      // discriminant and break FactsheetPayload assignability. Each arm's spread
      // preserves its `"api"`/`"csv"` literal (bundle never touches it).
      if (payload.ingestSource === "api") {
        const merged = { ...payload, ...bundle };
        return { ...merged, strategyMetrics: overlayBasisScalars(merged.strategyMetrics, mtmScalars) };
      }
      const merged = { ...payload, ...bundle };
      return { ...merged, strategyMetrics: overlayBasisScalars(merged.strategyMetrics, mtmScalars) };
    })();

    // --- Layer 2: leverage-as-a-dailies-transform (Phase 107, LEV-BB) ---
    // `signal: false` on the hot render path (LOW-1: the ControlBar pre-clamps, so a
    // read-side coercion here is not actionable owner signal).
    // Trusted mint point for the `AppliedLeverage` brand: `leverage` is already the
    // deferred read (line above), so `L` is the exact value the displayed numbers derive
    // from — the same brand `useAppliedLeverage()` produces for the gate/caption.
    const L = sanitizeLeverage(leverage, { signal: false }) as AppliedLeverage;
    // SC-4: base view BY REFERENCE at unity — deriveSeriesBundle is NEVER called at L=1.
    // This short-circuit MUST precede any deriveSeriesBundle call (byte-identity). It
    // stays an EXPLICIT first guard even though `leverageApplies` below also excludes
    // L===1: the by-reference return at unity is the load-bearing SC-4 keystone and
    // must never be refactored behind a helper call.
    if (L === 1) return base;
    // Guards 2-4 (single source of truth — IN-02): composite (leverage is single-key
    // only), fail-closed on an absent periodsPerYear (no honest annualization basis for
    // a re-derive), and no-fabrication on an unresolved MTM basis (levering the cash
    // fallback under an MTM label was the exact old failure). `leverageApplies` folds
    // all three — plus the redundant L≠1 check, already true here — into the ONE
    // predicate the KpiStrip gate + ControlBar eligibility also consume, so the three
    // sites can never drift (the WR-01 immediate-vs-deferred divergence is now
    // structurally impossible).
    if (!leverageApplies(payload, basis, L)) return base;
    // H-1: the levered view is pure in (payload, basis, L) — reuse the shared cache so the
    // ~235ms deriveSeriesBundle runs ONCE across all ~22 consumer instances (not per
    // instance), and every consumer gets the SAME reference. Consulted AFTER the SC-4 /
    // guard by-reference returns above so the cache never fronts the unity short-circuit.
    const shared = readLeveredView(payload, basis, L);
    if (shared) return shared;
    // Lever only the STRATEGY dailies on the ACTIVE-basis series. The benchmark leg
    // stays un-levered (deriveSeriesBundle re-aligns BTC/SPX/… internally) — that is
    // what makes β→L·β / α→L·α honest via jointMetrics(leveredStrat, unleveredBench).
    const levered = base.strategyReturns.map((r, i) => ({ date: base.dates[i], value: L * r }));
    // Phase 169.1 (D-27): the argument object comes from the ONE builder the window
    // arm also calls, so the two re-derives cannot drift.
    const lb = deriveSeriesBundle(levered, rederiveArgs(base));
    // WR-02 (Phase 107 review): Sharpe and Sortino are LEVERAGE-INVARIANT at rf=0 —
    // r→L·r cancels in `mean·√P/sd` and `mean·P/ddDev` (compute.ts:41,45). At L=1 the
    // MTM strip shows the PERSISTED dense-Python scalars (the F3 overlay that makes the
    // rail == the strip), but this levered arm re-derives everything fresh from the
    // client TS bundle with NO persisted overlay — so on an MTM book these two invariant
    // metrics would JUMP from the persisted value to the client recompute PURELY by
    // engaging leverage (the sparse-vs-dense / arithmetic-vs-geometric divergence F3
    // exists to hide), the exact dishonesty Phase 107 removed. Re-pin ONLY the two
    // provably-invariant scalars to the persisted authoritative MTM values so the
    // L=1 ↔ L≠1 boundary is continuous for them. The HOMOGENEOUS scalars (cum_ret /
    // cagr / ann_vol / max_dd) stay levered. Calmar is DELIBERATELY NOT pinned: it is
    // `cagr/|maxDd|` off the GEOMETRICALLY-compounded equity curve (compute.ts:39,47-49),
    // so it is genuinely leverage-VARIANT — its boundary change under leverage is honest,
    // and pinning it to the unlevered persisted value would HIDE a real effect (see the
    // Phase 107 review-fix note; the reviewer's suggested calmar pin was declined for
    // this reason). Phase 169 (D-25, SC4): cash carries a persisted overlay too now.
    // A rankable single-key payload's L=1 cash headline is the stored value from
    // `metricsByBasis.cash_settlement` (composite-read-path `readSingleKeyBasisOpts`),
    // so without this re-pin the cash Sharpe/Sortino would jump to the client
    // recompute purely by engaging leverage, exactly as MTM's did.
    //
    // B-1 (Phase 107 Fable red team): the invariance holds ONLY for L > 0. At L=0
    // (a reachable, intended state — input min="0", sanitizeLeverage keeps 0 valid)
    // the returns are all-zeros (r→0·r), so `mean·√P/sd` is 0/0 and the derive
    // honestly yields sharpe "—" (NaN, no dispersion; founder decision D7,
    // 2026-09-26) / sortino "—" (NaN, no losing day) / ann_vol=0 with flat charts. Pinning the
    // persisted non-zero Sharpe/Sortino there would render e.g. "Sharpe 1.85" next to
    // "Cum 0.0% / Ann. Vol 0.0%" and flat charts — a fresh dishonesty. So apply the
    // pin only when L > 0; at L=0 let the honest derived zeros stand.
    const strategyMetrics = ((): typeof lb.strategyMetrics => {
      // Phase 133 (SMTM-01) + Phase 169 (D-25): the re-pin applies under EVERY
      // persisted-overlay basis — mark_to_market, smoothed_mtm, and cash_settlement
      // when the payload carries a persisted cash headline — each pinning
      // Sharpe/Sortino to its OWN persisted scalar cache so the L=1↔L≠1 boundary is
      // continuous for the two invariant metrics. A cash payload with no persisted
      // cash object (a row the owner declined to overlay) keeps the client
      // recompute below.
      if (L <= 0) return lb.strategyMetrics;
      const persisted = (basis === "cash_settlement"
        ? payload.metricsByBasis?.cash_settlement
        : basis === "mark_to_market"
          ? payload.metricsByBasis?.mark_to_market
          : payload.metricsByBasis?.smoothed_mtm) as
        | Record<string, unknown>
        | undefined
        | null;
      if (!persisted) return lb.strategyMetrics;
      const out: Record<string, unknown> = { ...lb.strategyMetrics };
      for (const { tsKey, serverKey } of BASIS_KPI_MAP) {
        const pv = persisted[serverKey];
        const pvFinite = typeof pv === "number" && Number.isFinite(pv);
        if (!pvFinite) {
          // M-1 (Phase 107/108 Fable red team): the persisted MTM cache WITHHELD this
          // scalar — a degenerate per-scalar `null` (`sortino:null` on a no-losing-day
          // book, `calmar:null` on a zero-drawdown book, Python `_safe_float`). At L=1 the
          // strict overlay renders it "—". At L≠1 the client re-derive would surface a
          // fabricated value (compute()'s ddDev=0 → Sortino "0.00"), a scalar the
          // authoritative cache deliberately declined — the SAME fabrication class FIX 1
          // closed at cache granularity, now at PER-SCALAR granularity. Preserve the
          // withhold: NaN → "—" via the formatters. (cum_ret is invariance-critical and
          // always finite in an admitted cache, so it is never withheld in practice.)
          out[tsKey] = NaN;
        } else if (tsKey === "sharpe" || tsKey === "sortino") {
          // WR-02: Sharpe/Sortino are leverage-invariant at rf=0 (r→L·r cancels in
          // mean·√P/sd and mean·P/ddDev), so re-pin the FINITE persisted value → the
          // L=1 ↔ L≠1 boundary is continuous for them.
          out[tsKey] = pv;
        }
        // Homogeneous scalars (cum_ret/cagr/ann_vol/max_dd) with a FINITE persisted value
        // STAY levered — the accepted N-1 boundary tradeoff (the WR-02 comment owns it):
        // the client re-derive × L is the honest levered value.
      }
      return out as typeof lb.strategyMetrics;
    })();
    // Narrow on the ingest discriminant before spreading (same reason as Layer 1).
    const view: FactsheetPayload =
      base.ingestSource === "api"
        ? { ...base, ...lb, strategyMetrics }
        : { ...base, ...lb, strategyMetrics };
    // H-1: publish to the shared cache so sibling instances (and later renders) reuse this
    // exact object instead of re-running deriveSeriesBundle.
    writeLeveredView(payload, basis, L, view);
    return view;
  }, [basis, leverage, payload]);
}

/**
 * Phase 169.1 (SC10, D-27) — the KPI strip and the metrics rail follow the zoom window.
 *
 * Founder, 2026-09-25: "when I look at a different time, it should adjust all KPIs".
 * The MasterBrush and every chart already read the shared range (`useXRange`); the
 * three pieces below let the strip and the rail describe that range too:
 *   - `resolveRangeScope`: is the range the full history or a selection, and which
 *     dates and count does it cover (one pure rule, so the label and the figures can
 *     never disagree, T-169-43);
 *   - `windowView`: the active view with the follow-list fields re-derived on the
 *     slice through the SAME shared bundle (`deriveSeriesBundle` → compute() /
 *     jointMetrics, via `rederiveArgs`), no new formula (D-25);
 *   - `useWindowedView`: the hook every window-following consumer reads.
 */

/**
 * D-27 (as amended 2026-09-26, W2) — the ONLY fields a window replaces. Each is
 * read by a strip or rail figure that follows the window. Everything else
 * (correlations, style drift, rolling arrays, heatmaps, peer and mandate panels)
 * stays the active view's, by reference: a window never fabricates them.
 */
export const WINDOW_FOLLOW_FIELDS = [
  "dates",
  "strategyReturns",
  "strategyEquity",
  "strategyDrawdowns",
  "strategyMetrics",
  "strategyWorst10",
  "quantiles",
  "bootstrapCI",
  "comparators",
] as const satisfies ReadonlyArray<keyof FactsheetPayload>;

/** Why a window shows no figures (D-27 "Short slices"; D-82 the fail-closed guard). */
export type WindowWithheld = "short-slice" | "no-annualization-basis";

/** The active view, re-derived over a window; `withheld` set when it shows no figure. */
export type WindowedView = FactsheetPayload & { withheld?: WindowWithheld };

/**
 * The range a view's figures cover. `startIdx` / `endIdx` are the clamped indices
 * into the ACTIVE view's axis (the rail's rolling summary restricts to them).
 */
export type RangeScope = {
  kind: "full" | "selected";
  start: string;
  end: string;
  n: number;
  startIdx: number;
  endIdx: number;
};

/**
 * D-27 — the full-history rule. The range is the full history when it starts at
 * index 0 and ends at or past the SHORTER of the cash axis end and the view's
 * axis end. That covers the initial and reset range (`fullRange` is cash-sized)
 * under every basis, an MTM axis longer or shorter than cash included. A full
 * scope names the VIEW's first and last dates (W3, 2026-09-26): on an MTM axis
 * longer than cash the reset range's end index is not the view's last day. A
 * selected scope names the view's dates at the clamped indices, which bound a
 * crafted `?range` again (T-169-44).
 */
export function resolveRangeScope(
  xRange: readonly [number, number],
  cashLen: number,
  view: Pick<FactsheetPayload, "dates">,
): RangeScope {
  const viewLen = view.dates.length;
  const last = Math.max(0, viewLen - 1);
  const s = Math.min(Math.max(0, Math.floor(xRange[0])), last);
  const e = Math.min(Math.max(s, Math.floor(xRange[1])), last);
  const fullEnd = Math.min(cashLen, viewLen) - 1;
  if (s === 0 && e >= fullEnd) {
    return { kind: "full", start: view.dates[0] ?? "", end: view.dates[last] ?? "", n: viewLen, startIdx: 0, endIdx: last };
  }
  return { kind: "selected", start: view.dates[s], end: view.dates[e], n: e - s + 1, startIdx: s, endIdx: e };
}

/** The NaN-valued form of a bootstrap metric: no point, no interval, no histogram. */
const EMPTY_BOOT = { point: NaN, lo: NaN, hi: NaN, hist: { lo: NaN, hi: NaN, bins: [] as number[] } };

/**
 * Plan-check round 1 W1 (2026-09-30) — the withheld form REPLACES every follow-list
 * field, so no field keeps a full-history value under a "Selected range" eyebrow.
 * dates / returns are the window's own (they need no annualization); every figure
 * is NaN (the formatters render "—", the NaN-withhold device the leverage arm's M-1
 * comment uses); the curves, Worst 10 and every comparator's summary, joint and
 * paired-floor reason are empty. `strategyMetrics.start` / `end` are the window's
 * dates exactly as compute() sets them on a slice, because the rail's Start Date
 * and End Date rows read them off this object, and `n` is the window's count (the
 * short-track caveat reads it).
 */
function withheldWindowView(
  view: FactsheetPayload,
  s: number,
  e: number,
  withheld: WindowWithheld,
): WindowedView {
  const dates = view.dates.slice(s, e + 1);
  const n = dates.length;
  const strategyMetrics = Object.fromEntries(
    Object.entries(view.strategyMetrics).map(([k, v]) => [k, typeof v === "number" ? NaN : v === null ? null : v]),
  ) as Record<string, unknown>;
  strategyMetrics.n = n;
  strategyMetrics.start = dates[0];
  strategyMetrics.end = dates[n - 1];
  strategyMetrics.yearly = {};
  const quantiles = Object.fromEntries(Object.keys(view.quantiles).map((k) => [k, NaN])) as FactsheetPayload["quantiles"];
  const bootstrapCI: FactsheetPayload["bootstrapCI"] = {
    sharpe: { ...EMPTY_BOOT, hist: { ...EMPTY_BOOT.hist, bins: [] }, n_valid: 0 },
    sortino: { ...EMPTY_BOOT, hist: { ...EMPTY_BOOT.hist, bins: [] }, n_valid: 0 },
    max_dd: { ...EMPTY_BOOT, hist: { ...EMPTY_BOOT.hist, bins: [] } },
    n_resamples: 0,
    block_len: 0,
    n,
  };
  const blank = (b: ComparatorBlock): ComparatorBlock => ({ ...b, summary: null, joint: null, jointWithheld: null });
  const fields = {
    dates,
    strategyReturns: view.strategyReturns.slice(s, e + 1),
    strategyEquity: [] as number[],
    strategyDrawdowns: [] as number[],
    strategyMetrics: strategyMetrics as FactsheetPayload["strategyMetrics"],
    strategyWorst10: [] as FactsheetPayload["strategyWorst10"],
    quantiles,
    bootstrapCI,
    comparators: {
      btc: blank(view.comparators.btc),
      spx: blank(view.comparators.spx),
      none: blank(view.comparators.none),
    },
  };
  // Narrow on the ingest discriminant before spreading (same reason as Layer 1).
  return view.ingestSource === "api" ? { ...view, ...fields, withheld } : { ...view, ...fields, withheld };
}

/**
 * D-27 — the active view over the window `[startIdx, endIdx]` (clamped). The slice
 * is the ACTIVE view's own dates and returns (basis and leverage already applied by
 * `useBasisSeriesView`), re-derived by `deriveSeriesBundle` through `rederiveArgs`.
 * Only the follow-list fields come from the slice bundle, and its `strategyMetrics`
 * is the bundle's own: no persisted overlay and no Sharpe / Sortino re-pin, which
 * describe the WHOLE record (D-27 "No persisted value inside a window"). A
 * comparator block whose summary and joint are both null in the base view (the
 * Scenario's inert blocks, an unavailable BTC) stays the base block: a window never
 * fills a block the full history holds unavailable (W2).
 *
 * Withholds (see `withheldWindowView`) below 2 observations, and when the view has
 * no `periodsPerYear` (the leverage arm's fail-closed rule: never annualize on a
 * guessed basis; D-82 keeps it for a hand-built or pre-bump cached payload).
 */
export function windowView(view: FactsheetPayload, startIdx: number, endIdx: number): WindowedView {
  const last = Math.max(0, view.dates.length - 1);
  const s = Math.min(Math.max(0, startIdx), last);
  const e = Math.min(Math.max(s, endIdx), last);
  if (e - s + 1 < 2) return withheldWindowView(view, s, e, "short-slice");
  if (view.periodsPerYear == null) return withheldWindowView(view, s, e, "no-annualization-basis");
  const slice = view.strategyReturns.slice(s, e + 1).map((value, i) => ({ date: view.dates[s + i], value }));
  const wb = deriveSeriesBundle(slice, rederiveArgs(view));
  const keepBase = (b: ComparatorBlock) => b.summary == null && b.joint == null;
  const fields = {
    dates: wb.dates,
    strategyReturns: wb.strategyReturns,
    strategyEquity: wb.strategyEquity,
    strategyDrawdowns: wb.strategyDrawdowns,
    strategyMetrics: wb.strategyMetrics,
    strategyWorst10: wb.strategyWorst10,
    quantiles: wb.quantiles,
    bootstrapCI: wb.bootstrapCI,
    comparators: {
      btc: keepBase(view.comparators.btc) ? view.comparators.btc : wb.comparators.btc,
      spx: keepBase(view.comparators.spx) ? view.comparators.spx : wb.comparators.spx,
      none: keepBase(view.comparators.none) ? view.comparators.none : wb.comparators.none,
    },
  };
  return view.ingestSource === "api" ? { ...view, ...fields } : { ...view, ...fields };
}

/**
 * T-169-45 — one shared windowed view per base view. The strip and every rail panel
 * read the same window, so the derive runs ONCE per window across consumers (the
 * leverage arm's H-1 cache, narrowed to one entry: a pan replaces it).
 */
const windowedViewCache = new WeakMap<FactsheetPayload, { key: string; view: WindowedView }>();
// Keyed on the PAYLOAD, with the basis and applied leverage in the entry key: under
// a non-cash basis each `useBasisSeriesView` instance builds its own Layer-1 merge
// object, so keying on the view object would derive once per consumer there.

/**
 * D-27 — the window-following view. At full history it returns the active view BY
 * REFERENCE, so a reset shows exactly the stored values (the 169-01 overlay, D-10,
 * and the leverage re-pin, D-25). The range is read through `useDeferredValue`, the
 * same debounce the leverage read uses.
 *
 * 169.1 review MD-01: while a range gesture is held (`useRangeGesture`, a brush
 * drag), the view keeps the range the gesture started on, so a drag derives once,
 * on release, rather than once per pointer move. `scope` comes from that same held
 * range, so the "Selected range" eyebrow always names the range its figures
 * describe (the WR-01 caption-versus-numbers rule). The figures after release are
 * `windowView` of the final range, exactly what a drag-free zoom to it shows.
 */
export function useWindowedView(payload: FactsheetPayload): { view: WindowedView; scope: RangeScope } {
  const base = useBasisSeriesView(payload);
  const basis = useContext(BasisContext)?.basis ?? "cash_settlement";
  const appliedLeverage = useAppliedLeverage();
  const liveRange = useDeferredValue(useXRange().xRange);
  const range = useContext(RangeGestureContext)?.held ?? liveRange;
  return useMemo(() => {
    const scope = resolveRangeScope(range, payload.dates.length, base);
    if (scope.kind === "full") return { view: base, scope };
    const key = `${basis}:${appliedLeverage}:${scope.startIdx}:${scope.endIdx}`;
    const hit = windowedViewCache.get(payload);
    if (hit?.key === key) return { view: hit.view, scope };
    const view = windowView(base, scope.startIdx, scope.endIdx);
    windowedViewCache.set(payload, { key, view });
    return { view, scope };
  }, [payload, base, basis, appliedLeverage, range]);
}

/**
 * WR-01 (Phase 107 review) — the applied leverage the shared view ACTUALLY used.
 *
 * Reads the leverage through the SAME `useDeferredValue` debounce as
 * `useBasisSeriesView` (107-03), so any consumer that gates a label/caption on
 * "did the view lever?" reads the identical deferred value the displayed numbers
 * were derived from. This is the fix for the honesty regression: before it, the
 * KpiStrip gated its what-if caption on the IMMEDIATE `useLeverage()` value while
 * the numbers lagged on the deferred one, so during the ~235ms re-derive window the
 * caption could claim a levered projection the numbers had not yet applied. Reads the
 * context directly (NOT `useLeverage`, which throws) so a panel mounted without the
 * provider degrades to L=1. `signal: false` mirrors the hot-render read in the view
 * (the ControlBar owns the interactive coercion signal).
 */
export function useAppliedLeverage(): AppliedLeverage {
  const raw = useContext(LeverageContext)?.leverage ?? 1;
  // Trusted mint point: the value is sanitized + deferred exactly as the view derives it.
  return sanitizeLeverage(useDeferredValue(raw), { signal: false }) as AppliedLeverage;
}

/**
 * IN-02 (Phase 107 review) — the SINGLE source of truth for the leverage-structural
 * guards (fail-closed): single-key (not composite), an annualization basis present,
 * and a RESOLVED active basis (cash, or MTM WITH BOTH its series bundle AND its
 * persisted scalar cache). This is the "should the leverage cluster render at all"
 * predicate — true even at L=1, since the ControlBar input must show so the user can
 * engage leverage. `useBasisSeriesView`, the KpiStrip gate, and the ControlBar
 * eligibility all derive from this one function (via `leverageApplies` for the two that
 * also require L≠1), so a future guard change lands in exactly one place.
 *
 * MEDIUM-honesty (Phase 107/108 review) — the MTM resolution requires the persisted scalar
 * cache too (`metricsByBasis.mark_to_market`), not just the series bundle. This is a
 * DEFENSIVE / belt-and-braces clause: the current server path CANNOT emit a
 * bundle-without-scalars state — `composite-read-path.ts` threads `mtmSeries` and
 * `metricsByBasis` under the SAME `available` gate, so a series bundle implies the scalar
 * cache by construction (Fable red team confirmed the mid-backfill state is not reachable).
 * The guard matters anyway: IF such a state ever arose (a future partial-write path, a
 * hand-built payload), the L=1 arm renders the seven headline KPIs as "—" (the strict
 * `useBasisMetrics` overlay, F2 no-invented-data), and without this second clause the
 * levered arm would re-derive a full client-TS bundle with NO persisted overlay and
 * FABRICATE the very MTM headline scalars the L=1 arm withholds. Requiring the scalar cache
 * keeps MTM leverage-ineligible in that state → the view returns base by-reference → the
 * KPIs stay "—" at every L, symmetric with guard 4. It also proves it can never disable a
 * legitimately-leverable book (a real MTM basis always has both).
 *
 * Phase 169 review round 1 (SFH M-2): since 169-01 the single-key cash headline at
 * L=1 is the STORED value, and the levered arm re-derives the leverage-variant
 * scalars (Since Inception, CAGR, volatility, drawdown) from the displayed series.
 * D-25 (i) accepts that seam where the two agree. Two kinds of row are ineligible
 * because they do not agree by construction, so the first step off L=1 would present
 * the gap between them as the effect of leverage:
 *   - `dataQuality.twrChainBroken` (SFH H-1): the stored figure covers only the
 *     stretch after the last chain break, the re-derive the whole series;
 *   - `dataQuality.returnsConventionOverride` (SFH H-2): the stored figure was
 *     computed under a `simple` or active-day convention the re-derive cannot
 *     reproduce.
 * The view then returns `base` by reference at every L, as for a composite.
 */
export function leverageEligibleFor(payload: FactsheetPayload, basis: Basis): boolean {
  return (
    payload.dataQuality?.composite !== true &&
    payload.dataQuality?.twrChainBroken !== true &&
    payload.dataQuality?.returnsConventionOverride !== true &&
    payload.periodsPerYear != null &&
    !(
      basis === "mark_to_market" &&
      (payload.seriesByBasis?.mark_to_market == null ||
        payload.metricsByBasis?.mark_to_market == null)
    ) &&
    // Phase 133 (SMTM-01): the smoothed sibling of the MTM clause — under smoothed,
    // eligible ⇔ BOTH the smoothed series bundle AND the persisted smoothed scalar
    // cache are present. An absent-bundle smoothed view is leverage-INeligible (never
    // a re-pin against missing scalars; symmetric with guard 4), so the view returns
    // base by-reference and the KPIs stay "—" at every L.
    !(
      basis === "smoothed_mtm" &&
      (payload.seriesByBasis?.smoothed_mtm == null ||
        payload.metricsByBasis?.smoothed_mtm == null)
    )
  );
}

/**
 * IN-02 + WR-01 — "the view actually levers": the structural guards AND a non-unity
 * applied leverage. Consumed by the view hook (guards 2-4), the KpiStrip gate, and the
 * disclosure caption, ALL on the SAME deferred applied-leverage value, so caption /
 * gate / numbers cannot diverge.
 */
export function leverageApplies(
  payload: FactsheetPayload,
  basis: Basis,
  appliedLeverage: AppliedLeverage,
): boolean {
  return appliedLeverage !== 1 && leverageEligibleFor(payload, basis);
}

/**
 * H-1 (Phase 107 Fable red team) — the per-panel "not levered" honesty annotation.
 *
 * A few factsheet panels — peer percentile, allocator portfolios, event signatures —
 * are PRE-COMPUTED server-side aggregates ranked / modeled against external universes
 * (a peer cohort distribution, the allocator model, per-event trajectories) that are
 * NOT carried in the client payload. Unlike the dailies-derivable backbone, they cannot
 * be re-derived under a client leverage what-if, so at L≠1 they still reflect the base
 * 1× strategy — and the metrics they rank (peer Sharpe / Sortino / Max DD rank,
 * allocator impact, event-trajectory magnitude) ARE leverage-variant. To avoid
 * silently misleading (the strip shows a levered Max DD while the peer panel ranks the
 * UNLEVERED one), each affected panel renders this small, SPECIFIC muted note whenever
 * the rest of the page is levered. It is INSERTED only at L≠1 (never a reserved row) so
 * L=1 stays byte-identical — a targeted per-panel annotation, NOT a resurrection of the
 * deleted global BASE·1× eyebrow. Gated on the SAME `leverageApplies` predicate as the
 * KpiStrip, so it appears exactly when the page is actually levered.
 */
export function BaseLeverageNote({
  payload,
  label,
}: {
  payload: FactsheetPayload;
  label: string;
}) {
  const basis = useContext(BasisContext)?.basis ?? "cash_settlement";
  const appliedLeverage = useAppliedLeverage();
  if (!leverageApplies(payload, basis, appliedLeverage)) return null;
  return (
    <p
      className="mt-2 text-micro uppercase tracking-wider text-text-muted"
      data-leverage-note
    >
      {label}
    </p>
  );
}

/**
 * Closed-set MTM disabled-reason copy (CONTEXT D1 / UI-SPEC Copywriting),
 * character-exact. Server truth only — no client ledger predicate; a graceful
 * basis-agnostic default handles any un-enumerated reason (the TS union at
 * types.ts:500 is OPEN, so nothing mechanically requires enumerating a new
 * reason to render — the default degrades honestly).
 *
 * Phase 102 (MTM-01) rewrote every string to the honest current meaning
 * (DESIGN.md voice: factual, institutional, no contractions, never fabricating,
 * coverage-mask honesty). The dropped daily-mark smoothing framing that the
 * options-book reason used to carry is GONE — smoothing was permanently
 * retired in Phase 101. The default is
 * basis-agnostic ("for this strategy") because the old "for this composite" was
 * wrong for a single-key options strategy.
 */
export function mtmDisabledReasonCopy(reason?: string): string {
  switch (reason) {
    case "unsmoothed_options_book":
      // The live composite-gate return (stitch_composite.py `mark_to_market_
      // available`, :325) for any options-member composite — the honest CURRENT
      // meaning (the dropped daily-mark smoothing explanation is retired).
      //
      // Phase 102 reachability audit (composite-only, verified against the
      // backend): this reason is stamped ONLY on composite rows. Its sole
      // producer is `mark_to_market_available(members)`, whose sole caller
      // (job_worker.py:4195, inside run_stitch_composite_job) writes it into a
      // flags dict with `composite=True`. The single-key broker-derive path
      // stamps only the `mtm_*` structural reasons (SECOND_PASS_TIMEOUT /
      // ANCHOR_RACE / SUMMARY_COVERAGE / SERIES_UNCOMPUTABLE) — a single-key
      // options book ATTEMPTS the MTM second pass (job_worker.py:2307-2310) and
      // degrades to one of those, never to `unsmoothed_options_book`. And a
      // composite→single transition explicitly DROPS a stale composite-era
      // reason — the `if _mtm_reason and not _was_composite:` guard inside
      // `analytics_runner.run_csv_strategy_analytics` (grep `_was_composite`).
      // So the "composites…" wording is correctly attributed and never renders
      // under a single-key options factsheet.
      //
      // (140.5-04) That last reference used to carry a line range into
      // `analytics_runner.py`. The file SHRANK under its citers in a refactor, so
      // the range pointed past EOF — every past-EOF citation into that file is
      // that ONE event, not one independent rot per citer. Anchored on the symbol
      // instead: a name survives the next shrink, a coordinate does not.
      return "Mark-to-market unavailable: composites that include an options book report cash settlement only.";
    case "mtm_basis_unavailable_for_venue":
      return "Mark-to-market unavailable for this venue.";
    case "mtm_summary_coverage_incomplete":
      return "Mark-to-market unavailable: settlement history does not fully cover this book, so a mark-to-market series cannot be reconstructed.";
    case "mtm_series_uncomputable":
      return "Mark-to-market unavailable: the reconstructed mark-to-market series could not produce valid metrics.";
    case "mtm_second_pass_timeout":
      return "Mark-to-market temporarily unavailable: reconstruction exceeded its time budget and will be retried on the next data refresh.";
    case "mtm_anchor_race":
      // The reason constant ships in plan 102-02 (the vocabulary owner); the
      // "mtm_anchor_race" string literal is the cross-language contract — both
      // plans pin the same literal.
      return "Mark-to-market temporarily unavailable: the account changed during reconstruction; it will be recomputed on the next data refresh.";
    case "mtm_option_row_field_missing":
      // Phase 168 (SFH-04): stamped by the single-key MTM second pass when an
      // options ledger row lacks its commission or position
      // (`OptionRowFieldMissingError`; the constant is `MTM_REASON_OPTION_ROW_FIELD`
      // in stitch_composite.py, the vocabulary owner). Steady tone: a missing
      // field does not heal on the next refresh.
      return "Mark-to-market unavailable: an options entry in the venue ledger is missing its fee or position, so a mark-to-market series cannot be reconstructed.";
    default:
      return "Mark-to-market unavailable for this strategy.";
  }
}

/**
 * Phase 133 (SMTM-01) — the smoothed sibling of {@link mtmDisabledReasonCopy}.
 * The worker persists NO smoothed-reason column (the smoothed key is written only on
 * a completed options pass), so the gate carries a single closed-set default reason,
 * `"smoothed_basis_unavailable"`, covering "not yet computed / marks missing /
 * non-options book". DESIGN.md voice: factual, institutional, no contractions, never
 * fabricating. Always a STEADY honest-empty condition (never a self-healing transient),
 * so it renders muted — no amber, no `smoothedReasonTone` sibling needed.
 */
export function smoothedDisabledReasonCopy(reason?: string): string {
  switch (reason) {
    case "smoothed_basis_unavailable":
      return "Smoothed mark-to-market unavailable: this basis has not been computed for this strategy.";
    default:
      return "Smoothed mark-to-market unavailable for this strategy.";
  }
}

/**
 * DESIGN.md tone split for the MTM disabled-reason surface. `--color-warning`
 * amber is RESERVED for transient/recoverable states the system re-attempts on
 * its own — so ONLY the two reasons that self-heal on the next derive
 * (`mtm_second_pass_timeout`, `mtm_anchor_race`) are "transient". Every other
 * reason (coverage hole, uncomputable series, venue, options-composite, unknown/
 * default) is a steady-state honest-empty condition rendered in muted text; amber
 * there would falsely signal self-healing (RESEARCH Pitfall 4 + DESIGN.md Color:
 * "warning is reserved for transient recoverable states").
 */
export function mtmReasonTone(reason?: string): "transient" | "steady" {
  switch (reason) {
    case "mtm_second_pass_timeout":
    case "mtm_anchor_race":
      return "transient";
    default:
      return "steady";
  }
}
