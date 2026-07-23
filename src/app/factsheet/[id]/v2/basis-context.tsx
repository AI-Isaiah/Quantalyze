"use client";

import {
  createContext,
  useContext,
  useDeferredValue,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { FactsheetPayload, ComputeSummary } from "@/lib/factsheet/types";
import { overlayBasisScalars, BASIS_KPI_MAP } from "@/lib/factsheet/basis-metrics";
import { deriveSeriesBundle } from "@/lib/factsheet/build-payload";
import { sanitizeLeverage } from "@/lib/leverage";
import { LeverageContext } from "./leverage-context";

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
 * Ephemeral basis state. Renders children only (no DOM element) so wrapping the
 * FactsheetBody tree is transparent to the GUARD-02 byte-identity gate. Default
 * `cash_settlement` (D5).
 */
export function BasisProvider({ children }: { children: ReactNode }) {
  const [basis, setBasis] = useState<Basis>("cash_settlement");
  const value = useMemo<BasisContextValue>(() => ({ basis, setBasis }), [basis]);
  return <BasisContext.Provider value={value}>{children}</BasisContext.Provider>;
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
 *   - `cash_settlement` → `payload.strategyMetrics` UNTOUCHED. For composites,
 *     build-payload already overlaid the persisted cash scalars onto it (geometric
 *     or arithmetic per `returns_denominator_config` — Round-2 C-1; arithmetic
 *     only for the "simple"/allocated-capital override), so this is coherent with
 *     the persisted headline and byte-identical to today for single-key.
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
 *   2. dataQuality.composite === true     — A2: leverage is single-key only (arithmetic
 *                                            is composite-only; composites also hide the slider)
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
    const lb = deriveSeriesBundle(levered, {
      periodsPerYear: base.periodsPerYear!,
      isArithmetic: false,
      markets: base.markets,
      strategyName: base.strategyName,
      // comparatorAnnVol OMITTED — the levered bundle vol-matches its OWN levered vol
      // (mirrors the MTM arm at build-payload.ts:437-438; passing the persisted cash
      // ann_vol would un-lever the comparator vol-match). missingSegments passed
      // through so the bundle spread does not clobber the base mask with undefined.
      missingSegments: base.missingSegments,
    });
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
    // this reason). Only MTM carries a persisted per-basis overlay; cash's `basisM`
    // already equals the client recompute, so there is no cash jump to reconcile.
    //
    // B-1 (Phase 107 Fable red team): the invariance holds ONLY for L > 0. At L=0
    // (a reachable, intended state — input min="0", sanitizeLeverage keeps 0 valid)
    // the returns are all-zeros (r→0·r), so `mean·√P/sd` is 0/0 and the derive
    // honestly yields sharpe=0 / sortino=0 / ann_vol=0 with flat charts. Pinning the
    // persisted non-zero Sharpe/Sortino there would render e.g. "Sharpe 1.85" next to
    // "Cum 0.0% / Ann. Vol 0.0%" and flat charts — a fresh dishonesty. So apply the
    // pin only when L > 0; at L=0 let the honest derived zeros stand.
    const strategyMetrics = ((): typeof lb.strategyMetrics => {
      // Phase 133 (SMTM-01): the re-pin applies under BOTH persisted-overlay bases
      // (mark_to_market and smoothed_mtm) — each pins Sharpe/Sortino to its OWN
      // persisted scalar cache so the L=1↔L≠1 boundary is continuous for the two
      // invariant metrics. Cash carries no persisted per-basis overlay, so it is
      // excluded (its L=1 KPIs already equal the client recompute).
      if (basis === "cash_settlement" || L <= 0) return lb.strategyMetrics;
      const persisted = (basis === "mark_to_market"
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
 * legitimately-leverable book (a real MTM basis always has both). Cash is unaffected — it
 * carries no persisted-overlay-or-dash contract.
 */
export function leverageEligibleFor(payload: FactsheetPayload, basis: Basis): boolean {
  return (
    payload.dataQuality?.composite !== true &&
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
      // reason (analytics_runner.py:2387-2390, `not _was_composite`). So the
      // "composites…" wording is correctly attributed and never renders under a
      // single-key options factsheet.
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
