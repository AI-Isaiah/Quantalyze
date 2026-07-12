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
          degraded_members?: unknown;
          cumulative_method?: unknown;
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

  // C-1 / HARD-03 (#69, Phase-90 LOW-2): cumulation basis precedence —
  //   1. the PERSISTED method frozen into `data_quality_flags.cumulative_method`
  //      at stitch (Task 1), which matches the headline compute BY CONSTRUCTION;
  //   2. else the LIVE re-derive from returns_denominator_config (older composites
  //      with no persisted key — self-heals on next re-stitch, HARD-04 precedent).
  // Preferring the persisted value kills the chart↔headline drift an owner could
  // trigger by editing the config after publish without re-stitching. The
  // "simple"→"arithmetic" map is the SAME single rule `attributionBasisFromConfig`
  // encodes, applied to the RAW worker vocabulary — persisted and fallback can't
  // diverge. Strict-literal coercion (only the exact strings "simple"/"geometric"
  // honored; anything else falls back) mirrors the `=== true` server-truth
  // discipline in this file (T-92-05).
  const persisted = dqf?.cumulative_method;
  // HARD-03 hardening (Phase 93.1): an UNEXPECTED persisted value — PRESENT but
  // neither "simple" nor "geometric" — silently re-derives below, re-opening the
  // exact chart↔headline drift HARD-03 closes, with ZERO signal. It is unreachable
  // for correctly-written current data (the worker persists only the two RAW
  // literals at :3868), so surface it LOUD before the (preserved) live fallback.
  // Absent/null stays SILENT — that is the legitimate older-composite fallback
  // (no persisted key), not a defect. Warn-level per the sibling malformed-input
  // convention in build-payload.ts (deriveSegmentMarkers): recoverable, not Sentry.
  if (
    persisted !== null &&
    persisted !== undefined &&
    persisted !== "simple" &&
    persisted !== "geometric"
  ) {
    console.warn(
      "[factsheet] readCompositeFactsheet — unexpected persisted cumulative_method; falling back to live re-derive",
      { strategyId, persisted },
    );
  }
  const cumulativeMethod =
    persisted === "simple"
      ? "arithmetic"
      : persisted === "geometric"
        ? "geometric"
        : attributionBasisFromConfig(returnsDenominatorConfig);
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
      dataQuality: {
        composite: true,
        insufficientWindow: dqf?.insufficient_window === true,
        // HARD-05 (Phase 93): strict-coerce the degraded-member records. Malformed
        // jsonb (string / non-object entries / missing seq/venue) yields [] so junk
        // renders nothing (T-92-05 / T-93-03-02). The server `reason` enum is dropped
        // — the components own the user copy.
        degradedMembers: parseDegradedMembers(dqf?.degraded_members),
      },
      mtmGate: {
        available: mtmAvailable,
        reason: typeof dqf?.mtm_gated_reason === "string" ? dqf.mtm_gated_reason : undefined,
      },
    },
  };
}

/**
 * HARD-04 (#67) — the SINGLE-KEY counterpart of the composite `dataQuality` opt
 * built in `readCompositeFactsheet` above. A single-key strategy persists
 * `insufficient_window` at the analytics_runner CAGR site
 * (analytics_runner.py :1839 stored-trades / :2367 CSV-broker) exactly like a
 * composite, but has NO composite read-path to thread it. Finding B: because the
 * factsheet route (`/factsheet/[id]/v2`) and the discovery detail page
 * (`/discovery/[slug]/[strategyId]`) each assigned `buildOpts` ONLY on their
 * composite arm, a single-key sub-90-day track record built `buildOpts=undefined`
 * → `payload.dataQuality` undefined → the FactsheetView :876 caveat NEVER rendered
 * single-key, despite the server truth being persisted (with a passing lift test).
 *
 * Both surfaces now derive the single-key opt from THIS ONE owner — mirroring the
 * composite "one path" lesson (this file's header) so the two FactsheetView
 * consumers can't diverge on a future DQ flag. `composite: false` is behaviorally
 * identical to an absent `dataQuality` for every `=== true` composite reader
 * (FactsheetView :331/:393/:724/:1048), so this adds the caveat WITHOUT touching
 * the composite branch. Strict `=== true` server-truth coercion mirrors the
 * composite path so a malformed dqf value can never render the caveat (T-92-05).
 */
export function singleKeyDataQuality(
  dqf: { insufficient_window?: unknown } | null | undefined,
): NonNullable<BuildFactsheetOpts["dataQuality"]> {
  return { composite: false, insufficientWindow: dqf?.insufficient_window === true };
}

/**
 * Phase 102 (MTM-01) — the SINGLE-KEY counterpart of the composite `mtmGate`
 * assembly built inline in {@link readCompositeFactsheet} (:167-170). A single-key
 * options strategy persists its MTM basis into `metrics_json_by_basis.mark_to_market`
 * (Phase 101) plus a surviving `data_quality_flags.mtm_gated_reason` on honest
 * degrade, but — like the Finding-B `insufficient_window` flag — the single-key arm
 * of both factsheet surfaces never threaded it. This is the ONE owner both surfaces
 * (the `/factsheet/[id]/v2` route + the discovery detail page) delegate to, so they
 * can't diverge (the "one path" lesson, this file's header).
 *
 * Two load-bearing invariants (falsifiable in composite-read-path.test.ts):
 *   - F-4 (T-102-01): `available` is gated on `computationStatus ∈ {complete,
 *     complete_with_warnings}` — the EXACT terminal-success literals the runner
 *     writes (analytics_runner.py:1938-1940 stored-trades, :2392 CSV-broker; the
 *     same pair the PDF route admits at pdf/route.ts:231-232). A failed/computing
 *     row NEVER exposes a live-looking MTM object: `metricsByBasis` is threaded
 *     ONLY when `available`, so the payload is structurally MTM-free otherwise.
 *   - SC-4 (T-102-SC keystone): thread ONLY the `mark_to_market` key, NEVER the raw
 *     `metrics_json_by_basis` column. A lingering `cash_settlement` key (a composite→
 *     single stale window; 101-01 "Observed-but-out-of-scope #1") would activate the
 *     build-payload.ts:243 cash overlay and perturb the byte-identical cash headline.
 *
 * Returns `{}` for every non-options single-key strategy (no MTM key AND no reason)
 * so the toggle never renders and the payload stays byte-identical to today.
 * Defensive on unknown jsonb, mirroring the strict-coercion style of this file.
 */
export function singleKeyBasisOpts(
  dqf: { mtm_gated_reason?: unknown } | null | undefined,
  metricsJsonByBasis: unknown,
  computationStatus: unknown,
): Pick<BuildFactsheetOpts, "metricsByBasis" | "mtmGate"> {
  // 1. Extract the persisted mark_to_market object iff the raw jsonb is a non-null
  //    non-array object AND its `mark_to_market` value is a non-null non-array object.
  let mtm: Record<string, number> | undefined;
  if (
    metricsJsonByBasis !== null &&
    typeof metricsJsonByBasis === "object" &&
    !Array.isArray(metricsJsonByBasis)
  ) {
    const cand = (metricsJsonByBasis as Record<string, unknown>).mark_to_market;
    if (cand !== null && typeof cand === "object" && !Array.isArray(cand)) {
      mtm = cand as Record<string, number>;
    }
  }
  // 2. Extract the reason iff a string (same server-truth coercion as :169).
  const reason = typeof dqf?.mtm_gated_reason === "string" ? dqf.mtm_gated_reason : undefined;
  // 3. Neither present → {} : every non-options single-key strategy hits this,
  //    renders no toggle, and is byte-identical to today.
  if (mtm === undefined && reason === undefined) return {};
  // 4. F-4 DONE gate — exact runner terminal-success literals (no third success
  //    literal exists; verified against analytics_runner.py).
  const done = computationStatus === "complete" || computationStatus === "complete_with_warnings";
  // 5. Available iff DONE and the MTM object carries a trustworthy headline. A
  //    degraded-MTM row still reports "complete" (Phase 101-02), so BOTH gates.
  const available = done && hasBasisHeadline(mtm);
  // 6. Thread ONLY the mark_to_market key, and ONLY when available. This makes F-4
  //    structural (a failed row's payload carries NO MTM object) and closes the
  //    stale-cash_settlement-key hazard by construction (SC-4).
  return {
    metricsByBasis: available && mtm ? { mark_to_market: mtm } : undefined,
    mtmGate: { available, reason },
  };
}

/**
 * HARD-05 (Phase 93) — strict coercion of the server `degraded_members` DQ list
 * into the closed render shape `{ seq, venue }[]`. A degraded member is a composite
 * member EXCLUDED from the stitch (a ccxt venue not yet reconstructed). ONLY an
 * array whose entries are objects carrying a finite numeric `seq` and a non-empty
 * string `venue` survive; anything else (a string, a number entry, a `{}`, a
 * non-finite seq) is dropped so malformed jsonb renders nothing (T-92-05 /
 * T-93-03-02). The server `reason` enum is intentionally DROPPED here — it is
 * server vocabulary; the render surfaces own the user-facing copy.
 */
export function parseDegradedMembers(raw: unknown): Array<{ seq: number; venue: string }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ seq: number; venue: string }> = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const { seq, venue } = entry as { seq?: unknown; venue?: unknown };
    if (typeof seq !== "number" || !Number.isFinite(seq)) continue;
    if (typeof venue !== "string" || venue.length === 0) continue;
    out.push({ seq, venue });
  }
  return out;
}
