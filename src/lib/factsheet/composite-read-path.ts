import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DailyReturn } from "./types";
import { deriveSegmentMarkers } from "./build-payload";
import type { BuildFactsheetOpts } from "./build-payload";
import { hasBasisHeadline } from "./basis-metrics";
import { attributionBasisFromConfig } from "@/lib/composite/compositeAttribution";

/**
 * Round-2 H-2 — the ONE composite read-path (D6, the milestone's "one path"
 * lesson). BOTH surfaces that render the composite factsheet — the canonical
 * `/factsheet/[id]/v2` route AND the discovery detail page
 * (`/discovery/[slug]/[strategyId]`) — route a composite through THIS helper so
 * they can't diverge. Before this existed, the discovery page had no composite
 * branch: a composite (daily_returns NULL, returns_series populated) fell through
 * `deriveIngestSource` → "api" → invented PeerPercentile / AllocatorSection /
 * EventSignatures panels + a dense-0.0-gap-filled series drawing flat-zero gap
 * lines (the exact D6 failure the factsheet route already fixed).
 *
 * Responsibilities (identical to the factsheet route's former inline block):
 *   - Read the honest SPARSE cash series from `csv_daily_returns` (gap days
 *     ABSENT, never zero-filled). A read failure logs at ERROR (→ Sentry) and
 *     degrades to the still-computing placeholder — never the api arm.
 *   - F1/H-1 gate: refuse to render when the persisted `cash_settlement` lacks a
 *     trustworthy headline (returns null → placeholder); a degenerate-but-valid
 *     composite renders (strict overlay shows null scalars as "—").
 *   - C-1: resolve the cumulative method from `returns_denominator_config`
 *     (arithmetic only for the "simple"/allocated-capital override; geometric
 *     mainline).
 *   - F2/M-1 MTM gate + FS-01/FS-02 markers threading.
 *
 * Data-access: `admin` MUST be the service-role handle. `csv_daily_returns` has
 * service_role/owner/admin RLS only (migration 20260522111839), so the admin
 * handle is the ONLY client that can read it. The CALLER is responsible for the
 * upstream published-factsheet visibility gate (the factsheet route's RLS
 * signature probe; the discovery page's `discovery_categories!inner` + auth) —
 * this helper does NOT widen visibility, it only reads the sparse series for a
 * strategy the caller already authorized.
 *
 * The caller MUST force `ingestSource: "csv"` on the buildFactsheetPayload call
 * (composites never take the invented api arm) and pass the returned `buildOpts`.
 *
 * @returns `{ dailyReturns, buildOpts }`, or `null` when the composite is a data
 *          defect (missing/untrusted cash headline) → caller renders placeholder.
 */
export async function readCompositeFactsheet(
  admin: SupabaseClient,
  input: {
    strategyId: string;
    dqf:
      | {
          composite?: unknown;
          mtm_gated_reason?: unknown;
          per_key?: unknown;
          gap_spans?: unknown;
          insufficient_window?: unknown;
        }
      | null
      | undefined;
    metricsJsonByBasis: unknown;
    returnsDenominatorConfig: unknown;
  },
): Promise<{ dailyReturns: DailyReturn[]; buildOpts: BuildFactsheetOpts } | null> {
  const { strategyId, dqf, metricsJsonByBasis, returnsDenominatorConfig } = input;

  const { data: sparseRows, error: sparseErr } = await admin
    .from("csv_daily_returns")
    .select("date, daily_return")
    .eq("strategy_id", strategyId)
    .order("date", { ascending: true })
    .limit(20000); // Flat safety ceiling, T-36-03-03 precedent.
  if (sparseErr) {
    // F3: a composite depends ENTIRELY on this sparse read — a real DB failure
    // hides the whole published factsheet behind the placeholder. Log at ERROR
    // (→ Sentry). Fail-SAFE: below, an empty series returns null → placeholder,
    // never the api arm / flat-zero line.
    console.error("[factsheet] readCompositeFactsheet — composite csv_daily_returns read failed", {
      strategyId,
      errorMessage: sparseErr.message,
    });
  }
  const dailyReturns: DailyReturn[] = (sparseRows ?? []).map(
    (r): DailyReturn => ({ date: r.date as string, value: r.daily_return as number }),
  );

  const metricsByBasis = (metricsJsonByBasis ?? undefined) as
    | BuildFactsheetOpts["metricsByBasis"]
    | undefined;

  // F1/H-1: refuse an untrusted headline (still-computing placeholder). A
  // degenerate-but-valid composite (finite cumulative_return, some scalar null)
  // passes and renders with an honest "—".
  if (!hasBasisHeadline(metricsByBasis?.cash_settlement)) {
    console.error(
      "[factsheet] composite missing persisted cash_settlement headline — refusing to render an untrusted headline",
      { strategyId },
    );
    return null;
  }

  // C-1: cumulative method follows the persisted config (arithmetic only for the
  // "simple"/allocated-capital override), NOT a hardcoded arithmetic.
  const cumulativeMethod = attributionBasisFromConfig(returnsDenominatorConfig);
  // F2/M-1: MTM enabled iff the mark_to_market basis is present with a finite
  // headline (locked D1 intent); the strict overlay renders degenerate scalars "—".
  const mtmAvailable = hasBasisHeadline(
    (metricsByBasis as { mark_to_market?: unknown } | undefined)?.mark_to_market,
  );
  const markers = deriveSegmentMarkers(dqf);

  return {
    dailyReturns,
    buildOpts: {
      cumulativeMethod,
      segmentBoundaries: markers.segmentBoundaries,
      missingSegments: markers.missingSegments,
      metricsByBasis,
      // HARD-04 (#67): server-truth short-window flag. Strict `=== true`
      // coercion so a malformed dqf value (string/object) can never render the
      // caveat (T-92-05).
      dataQuality: { composite: true, insufficientWindow: dqf?.insufficient_window === true },
      mtmGate: {
        available: mtmAvailable,
        reason: typeof dqf?.mtm_gated_reason === "string" ? dqf.mtm_gated_reason : undefined,
      },
    },
  };
}
