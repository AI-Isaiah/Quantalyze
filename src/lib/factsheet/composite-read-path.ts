import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DailyReturn } from "./types";
import { MTM_DAILY_RETURNS_SERIES_KIND, SMOOTHED_MTM_DAILY_RETURNS_SERIES_KIND } from "@/lib/types";
import { deriveSegmentMarkers } from "./build-payload";
import type { BuildFactsheetOpts } from "./build-payload";
import { hasBasisHeadline } from "./basis-metrics";
import { attributionBasisFromConfig } from "@/lib/composite/compositeAttribution";
import { isComputedAnalytics } from "@/lib/closed-sets";

/** The parsed, defensively-coerced form of an `mtm_daily_returns` series row. */
export type ParsedMtmSeries = {
  dailyReturns: DailyReturn[];
  gapSpans: Array<{ start: string; end: string }>;
};

/**
 * Phase 103 (MTM-04, T-103-05) — strict coercion of the untrusted
 * `mtm_daily_returns` JSONB payload (DB → RSC trust boundary) into a
 * {@link ParsedMtmSeries}, or `null` when the shape can't yield an MTM bundle.
 *
 * Mirrors the strict-coercion discipline of {@link singleKeyBasisOpts} /
 * {@link parseDegradedMembers} / `deriveSegmentMarkers`: a malformed/failed
 * series row degrades to "no MTM bundle → charts stay cash" (V5), NEVER a crash
 * or fabricated data. Returns null for:
 *   - a non-object / null / array payload,
 *   - a missing / non-array `rows`,
 *   - fewer than 2 VALID rows (mirrors the build-payload dedup<2 null guard —
 *     the MTM bundle needs ≥2 dated observations, same as cash).
 * Per-row: keep only `{date: string, return: finite number}`, mapping the
 * persisted `return` key to the `DailyReturn.value` field; drop invalid rows.
 * `gap_spans` is coerced defensively (non-array → [], junk entries dropped) — a
 * bad mask never invents interior gaps.
 */
export function parseMtmSeriesPayload(raw: unknown): ParsedMtmSeries | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.rows)) return null;

  const dailyReturns: DailyReturn[] = [];
  for (const row of obj.rows) {
    if (row === null || typeof row !== "object" || Array.isArray(row)) continue;
    const { date, return: ret } = row as { date?: unknown; return?: unknown };
    if (typeof date !== "string" || date.length === 0) continue;
    if (typeof ret !== "number" || !Number.isFinite(ret)) continue;
    dailyReturns.push({ date, value: ret });
  }
  // FIX 4 (IN, mirrors deriveSegmentMarkers build-payload.ts:105-114): a present
  // `rows` array whose entries partially dropped is a malformed persist (the
  // Python writer always emits well-formed rows). Silently coercing loses the
  // signal, so warn — the drop behavior itself is unchanged (recoverable: charts
  // still render the surviving rows / degrade to cash).
  if (dailyReturns.length < obj.rows.length) {
    console.warn("[factsheet] parseMtmSeriesPayload — dropped malformed mtm_daily_returns rows", {
      total: obj.rows.length,
      kept: dailyReturns.length,
      dropped: obj.rows.length - dailyReturns.length,
    });
  }
  // Fewer than 2 valid rows can't build a bundle (build-payload's own dedup<2
  // guard would return null anyway) — degrade to no-bundle here so the gate is
  // structural on the read side.
  if (dailyReturns.length < 2) return null;

  const gapSpans: Array<{ start: string; end: string }> = [];
  if (Array.isArray(obj.gap_spans)) {
    for (const span of obj.gap_spans) {
      if (span === null || typeof span !== "object" || Array.isArray(span)) continue;
      const { start, end } = span as { start?: unknown; end?: unknown };
      if (typeof start !== "string" || typeof end !== "string") continue;
      gapSpans.push({ start, end });
    }
    // Same signal for a present-but-partially-dropped gap_spans array — a bad mask
    // silently losing spans would under-report interior coverage gaps.
    if (gapSpans.length < obj.gap_spans.length) {
      console.warn("[factsheet] parseMtmSeriesPayload — dropped malformed gap_spans entries", {
        total: obj.gap_spans.length,
        kept: gapSpans.length,
        dropped: obj.gap_spans.length - gapSpans.length,
      });
    }
  }
  return { dailyReturns, gapSpans };
}

/**
 * Phase 103 (MTM-04, T-103-06) — read the persisted `mtm_daily_returns` series row
 * for a strategy. `admin` MUST be the service-role handle: `strategy_analytics_series`
 * is deny-all RLS (migration 20260428120919), so ONLY the admin handle reads it —
 * the SAME visibility gate the scalar MTM object already rides (no widening; the
 * caller owns the upstream published/owner gate, exactly as the `csv_daily_returns`
 * read above). A read error or a missing/malformed row degrades to `null` (charts
 * stay cash, V5) — NEVER a throw.
 */
export async function readMtmSeries(
  admin: SupabaseClient,
  strategyId: string,
): Promise<ParsedMtmSeries | null> {
  const { data, error } = await admin
    .from("strategy_analytics_series")
    .select("payload")
    .eq("strategy_id", strategyId)
    .eq("kind", MTM_DAILY_RETURNS_SERIES_KIND)
    .maybeSingle();
  if (error) {
    // Degrade (never throw): a failed series read must yield "charts stay cash",
    // not hide the whole published factsheet. Log at ERROR (→ Sentry).
    console.error("[factsheet] readMtmSeries — mtm_daily_returns read failed", {
      strategyId,
      errorMessage: error.message,
    });
    return null;
  }
  return parseMtmSeriesPayload((data as { payload?: unknown } | null)?.payload);
}

/**
 * Phase 133 (SMTM-01) — the smoothed sibling of {@link parseMtmSeriesPayload}.
 * Reuses the exact rows/gap_spans coercion (so the optional Phase-105 `nan_dates`
 * key is TOLERATED — extra keys are ignored, never a rejection), adding ONE
 * smoothed-specific guard: a PRESENT-but-wrong `basis` literal (e.g. a
 * `mark_to_market` row mistakenly stored under the smoothed kind) → null + warn,
 * so a mislabeled series can never render under the smoothed label (T-131-08).
 */
export function parseSmoothedSeriesPayload(raw: unknown): ParsedMtmSeries | null {
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    const basis = (raw as Record<string, unknown>).basis;
    // A present basis MUST be the smoothed literal; anything else is a mislabel we
    // refuse to render (absent basis is tolerated — the shared coercion still applies).
    if (basis !== undefined && basis !== "smoothed_mtm") {
      console.warn("[factsheet] parseSmoothedSeriesPayload — wrong/malformed basis literal; refusing to render a mislabeled series", {
        basis,
      });
      return null;
    }
  }
  return parseMtmSeriesPayload(raw);
}

/**
 * Phase 133 (SMTM-01) — the smoothed sibling of {@link readMtmSeries}: read the
 * persisted `smoothed_mtm_daily_returns` series row. SAME service-role handle +
 * deny-all RLS posture + degrade-to-null-never-throw discipline; parses through
 * {@link parseSmoothedSeriesPayload} (wrong-basis defensive).
 */
export async function readSmoothedSeries(
  admin: SupabaseClient,
  strategyId: string,
): Promise<ParsedMtmSeries | null> {
  const { data, error } = await admin
    .from("strategy_analytics_series")
    .select("payload")
    .eq("strategy_id", strategyId)
    .eq("kind", SMOOTHED_MTM_DAILY_RETURNS_SERIES_KIND)
    .maybeSingle();
  if (error) {
    console.error("[factsheet] readSmoothedSeries — smoothed_mtm_daily_returns read failed", {
      strategyId,
      errorMessage: error.message,
    });
    return null;
  }
  return parseSmoothedSeriesPayload((data as { payload?: unknown } | null)?.payload);
}

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
  // Phase 133 (SMTM-01): the smoothed sibling of the MTM gate — available iff the
  // persisted `smoothed_mtm` basis carries a trustworthy headline. On an options book
  // this OPENS what the MTM gate honestly keeps closed (unsmoothed_options_book).
  const smoothedAvailable = hasBasisHeadline(
    (metricsByBasis as { smoothed_mtm?: unknown } | undefined)?.smoothed_mtm,
  );
  const markers = deriveSegmentMarkers(dqf);

  // MTM-04 (Phase 103): read the persisted MTM daily series ONLY when the scalar
  // MTM basis is available (skip the extra roundtrip for every non-MTM composite);
  // thread it so buildFactsheetPayload emits the per-basis bundle. Gated exactly
  // like the scalar MTM object — the series rides the SAME published/owner + F2/M-1
  // gate, no visibility widening. A failed/malformed row degrades to no-bundle.
  // Phase 133 (SMTM-01): read the persisted smoothed series ONLY when the scalar
  // smoothed gate is available (skip the roundtrip otherwise) — same gating as MTM.
  // The two reads are independent; fire them concurrently (each still gated so a
  // skipped read stays skipped — resolves to null without a roundtrip).
  const [mtmSeries, smoothedSeries] = await Promise.all([
    mtmAvailable ? readMtmSeries(admin, strategyId) : Promise.resolve(null),
    smoothedAvailable ? readSmoothedSeries(admin, strategyId) : Promise.resolve(null),
  ]);

  return {
    dailyReturns,
    buildOpts: {
      cumulativeMethod,
      segmentBoundaries: markers.segmentBoundaries,
      missingSegments: markers.missingSegments,
      metricsByBasis,
      ...(mtmSeries ? { mtmSeries } : {}),
      ...(smoothedSeries ? { smoothedSeries } : {}),
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
      // Phase 133 (SMTM-01): the smoothed gate. There is no persisted smoothed-reason
      // column (the worker only persists the smoothed key on a completed pass), so the
      // disabled reason is the single closed-set default — never a per-row invention.
      smoothedGate: {
        available: smoothedAvailable,
        reason: smoothedAvailable ? undefined : "smoothed_basis_unavailable",
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
  mtmSeries?: ParsedMtmSeries | null,
  smoothedSeries?: ParsedMtmSeries | null,
): Pick<BuildFactsheetOpts, "metricsByBasis" | "mtmGate" | "mtmSeries" | "smoothedGate" | "smoothedSeries"> {
  // Extract a non-null non-array by-basis object under `key` from the untrusted jsonb.
  const extractBasisObject = (key: string): Record<string, number> | undefined => {
    if (
      metricsJsonByBasis !== null &&
      typeof metricsJsonByBasis === "object" &&
      !Array.isArray(metricsJsonByBasis)
    ) {
      const cand = (metricsJsonByBasis as Record<string, unknown>)[key];
      if (cand !== null && typeof cand === "object" && !Array.isArray(cand)) {
        return cand as Record<string, number>;
      }
    }
    return undefined;
  };
  // 1. Extract the persisted mark_to_market + smoothed_mtm objects.
  const mtm = extractBasisObject("mark_to_market");
  const smoothed = extractBasisObject("smoothed_mtm");
  // 2. Extract the reason iff a string (same server-truth coercion as :169).
  const reason = typeof dqf?.mtm_gated_reason === "string" ? dqf.mtm_gated_reason : undefined;
  // 3. MEDIUM-2 (plan-check): the early return now checks ALL THREE by-basis signals.
  //    Returning {} ONLY when mtm, reason, AND smoothed are absent keeps every
  //    non-options single-key path byte-identical (such rows have none of the three),
  //    while a {smoothed_mtm}-only row (MTM degraded reason-lessly) is NO LONGER
  //    silently dropped — it flows through to a constructed gate/metrics/series.
  if (mtm === undefined && reason === undefined && smoothed === undefined) return {};
  // Structural consequence: past this point the gates are ALWAYS constructed, so a
  // payload with ANY by-basis story carries mtmGate — which is what lets
  // FactsheetView's toggle-availability predicate (`payload.mtmGate != null`) stay
  // unwidened while still rendering the toggle for the {smoothed_mtm}-only edge.
  //
  // 4. F-4 DONE gate — exact runner terminal-success literals (no third success
  //    literal exists; verified against analytics_runner.py).
  const done = isComputedAnalytics(computationStatus as string | null | undefined);
  // 5. Available iff DONE and the object carries a trustworthy headline. A degraded
  //    row still reports "complete" (Phase 101-02), so BOTH gates apply per basis.
  const available = done && hasBasisHeadline(mtm);
  const smoothedAvailable = done && hasBasisHeadline(smoothed);
  // 6. Thread ONLY the available by-basis keys (F-4 structural: a failed row's payload
  //    carries NO by-basis object), and NEVER a lingering cash_settlement key (SC-4).
  const metricsByBasis: NonNullable<BuildFactsheetOpts["metricsByBasis"]> = {};
  if (available && mtm) metricsByBasis.mark_to_market = mtm;
  if (smoothedAvailable && smoothed) metricsByBasis.smoothed_mtm = smoothed;
  const hasAnyBasisScalars = Object.keys(metricsByBasis).length > 0;
  // 7. Thread the persisted daily series ONLY when the matching basis is available AND
  //    the reader returned a parsed series (each rides its own F-4 gate). Omitted (not
  //    undefined) when absent so the SILENT-1 empty-result path stays byte-identical.
  return {
    metricsByBasis: hasAnyBasisScalars ? metricsByBasis : undefined,
    mtmGate: { available, reason },
    // No persisted smoothed-reason column exists (see FactsheetCommon.smoothedGate) —
    // the disabled reason is the single closed-set default.
    smoothedGate: {
      available: smoothedAvailable,
      reason: smoothedAvailable ? undefined : "smoothed_basis_unavailable",
    },
    ...(available && mtmSeries ? { mtmSeries } : {}),
    ...(smoothedAvailable && smoothedSeries ? { smoothedSeries } : {}),
  };
}

/**
 * Phase 133 review (WR-01/WR-02) — the ONE single-key basis ASSEMBLY both
 * FactsheetView surfaces (`/factsheet/[id]/v2` + `/discovery/[slug]/[strategyId]`)
 * call. It owns the WHOLE single-key basis story end-to-end: the cheap
 * should-read predicates → the gated `mtm_daily_returns` / `smoothed_mtm_daily_returns`
 * roundtrips → the {@link singleKeyBasisOpts} gate/scalar/series threading.
 *
 * Why it exists: {@link singleKeyBasisOpts} alone is only the LAST step; each page
 * used to inline the predicate+read steps itself, and when Phase 133 added the
 * smoothed sibling the discovery page's inline copy silently kept the old 4-arg
 * call — the Smoothed segment rendered ENABLED there while its charts stayed cash
 * PERMANENTLY (WR-01). With the assembly hoisted here, a page cannot thread the
 * scalars without the series: the two surfaces are identical by construction, and
 * a future fourth basis lands on both pages automatically.
 *
 * `getAdmin` is a thunk (not a client) so the hot non-options path — no by-basis
 * object, or not DONE — never even CONSTRUCTS the service-role handle (preserving
 * the discovery page's lazy `createAdminClient()` posture, byte-identical). It is
 * memoized: at most ONE handle is created per call regardless of how many basis
 * series are read. The handle MUST be service-role: `strategy_analytics_series` is
 * deny-all RLS (see {@link readMtmSeries}); the caller owns the upstream
 * published/owner visibility gate, exactly as before the hoist.
 */
export async function readSingleKeyBasisOpts(
  getAdmin: () => SupabaseClient,
  strategyId: string,
  dqf: { mtm_gated_reason?: unknown } | null | undefined,
  metricsJsonByBasis: unknown,
  computationStatus: unknown,
): Promise<Pick<BuildFactsheetOpts, "metricsByBasis" | "mtmGate" | "mtmSeries" | "smoothedGate" | "smoothedSeries">> {
  let admin: SupabaseClient | undefined;
  const resolveAdmin = () => (admin ??= getAdmin());
  // MTM-04 (Phase 103): read the persisted MTM series only when the SHARED cheap
  // predicate holds — a failed/malformed row degrades to no-bundle (charts stay cash).
  // Phase 133 (SMTM-01): the smoothed sibling read, identically gated. The two reads
  // are independent; fire them concurrently (each still gated so a skipped read stays
  // skipped — resolves to null without a roundtrip). resolveAdmin memoizes
  // synchronously, so a shared client is created at most once.
  const [mtmSeries, smoothedSeries] = await Promise.all([
    shouldReadSingleKeyMtmSeries(metricsJsonByBasis, computationStatus)
      ? readMtmSeries(resolveAdmin(), strategyId)
      : Promise.resolve(null),
    shouldReadSingleKeySmoothedSeries(metricsJsonByBasis, computationStatus)
      ? readSmoothedSeries(resolveAdmin(), strategyId)
      : Promise.resolve(null),
  ]);
  return singleKeyBasisOpts(dqf, metricsJsonByBasis, computationStatus, mtmSeries, smoothedSeries);
}

/**
 * Phase 103 (MTM-04) — the cheapest honest predicate deciding whether a single-key
 * strategy should incur the `mtm_daily_returns` DB roundtrip. Mirrors
 * {@link singleKeyBasisOpts}' F-4 gate: the raw `metrics_json_by_basis` carries a
 * `mark_to_market` OBJECT AND `computation_status` is DONE. Both factsheet surfaces
 * (the `/factsheet/[id]/v2` route + the discovery detail page) call THIS one
 * predicate so they can't diverge on when to read (the "one path" lesson).
 *
 * It is deliberately CHEAPER than the full `hasBasisHeadline` gate: a degenerate
 * mark_to_market object (present key, no finite headline) may pass here and waste
 * ONE read — but `singleKeyBasisOpts` still applies the full `available` gate
 * before threading, so a false-positive here NEVER leaks a bundle. This keeps the
 * hot non-options path (no mark_to_market key, or not DONE) roundtrip-free.
 */
export function shouldReadSingleKeyMtmSeries(
  metricsJsonByBasis: unknown,
  computationStatus: unknown,
): boolean {
  const done = isComputedAnalytics(computationStatus as string | null | undefined);
  if (!done) return false;
  if (
    metricsJsonByBasis === null ||
    typeof metricsJsonByBasis !== "object" ||
    Array.isArray(metricsJsonByBasis)
  ) {
    return false;
  }
  const mtm = (metricsJsonByBasis as Record<string, unknown>).mark_to_market;
  return mtm !== null && typeof mtm === "object" && !Array.isArray(mtm);
}

/**
 * Phase 133 (SMTM-01) — the smoothed sibling of {@link shouldReadSingleKeyMtmSeries}:
 * the cheap DONE + `smoothed_mtm`-object predicate deciding whether to incur the
 * `smoothed_mtm_daily_returns` DB roundtrip. Same cheaper-than-hasBasisHeadline
 * posture — a false positive wastes ONE read but `singleKeyBasisOpts` still applies
 * the full `available` gate before threading. Keeps the hot non-options path
 * roundtrip-free.
 */
export function shouldReadSingleKeySmoothedSeries(
  metricsJsonByBasis: unknown,
  computationStatus: unknown,
): boolean {
  const done = isComputedAnalytics(computationStatus as string | null | undefined);
  if (!done) return false;
  if (
    metricsJsonByBasis === null ||
    typeof metricsJsonByBasis !== "object" ||
    Array.isArray(metricsJsonByBasis)
  ) {
    return false;
  }
  const smoothed = (metricsJsonByBasis as Record<string, unknown>).smoothed_mtm;
  return smoothed !== null && typeof smoothed === "object" && !Array.isArray(smoothed);
}

/**
 * MED-1 (Phase 105, D3) — the cash twin of {@link shouldReadSingleKeyMtmSeries}
 * and the SINGLE read-side choke point that decides whether a persisted
 * `cash_settlement` series row may be trusted. It returns true ONLY when
 * `computation_status ∈ {complete, complete_with_warnings}` (the exact
 * terminal-success literals the runner writes) AND `metrics_json_by_basis`
 * carries a non-null non-array `cash_settlement` OBJECT.
 *
 * Why this exists NOW with no production caller: a pre-seam terminal-failure arm
 * nulls the scalars (`metrics_json_by_basis=None`, `computation_status='failed'`)
 * and `return`s BEFORE the persist seam, so a stale `cash_settlement` series row
 * can OUTLIVE its authoritative-NULL scalar — the `<2-interpretable-days` arm
 * (`job_worker.py:2790-2821`), `_stamp_deribit_analytics_failed` (`:2096`), NAV-error
 * arms, and a `BROKER_DAILIES_VIA_FUNDING=false` rollback orphan (LOW-3). A
 * DONE-gate at the READ point is a single choke point that refuses EVERY such
 * arm — including future ones — whereas arm-by-arm heal-deletes silently regress
 * the instant a new arm is added and one is missed (the exact MED-1 bug class).
 *
 * Contract (locked in 105-FOLD-DECISION.md, D3 caveat a): the Phase-106 cash
 * reader — the FIRST caller — MUST route through the `shouldReadCashSettlementSeries`
 * predicate family (this fn + its MTM twin) before trusting a cash series row. No caller exists in Phase 105 by design (the
 * predicate + status-gate is the guarantee; per LOW-4 the INERT-read grep
 * tripwire is NOT — it misses a reader imported via a constant).
 *
 * Deliberately CHEAPER than the full `hasBasisHeadline` gate, mirroring the MTM
 * twin: a degenerate cash_settlement object may pass here; the eventual reader
 * still applies its own trust gate before surfacing a number.
 */
export function shouldReadCashSettlementSeries(
  metricsJsonByBasis: unknown,
  computationStatus: unknown,
): boolean {
  const done = isComputedAnalytics(computationStatus as string | null | undefined);
  if (!done) return false;
  if (
    metricsJsonByBasis === null ||
    typeof metricsJsonByBasis !== "object" ||
    Array.isArray(metricsJsonByBasis)
  ) {
    return false;
  }
  const cash = (metricsJsonByBasis as Record<string, unknown>).cash_settlement;
  return cash !== null && typeof cash === "object" && !Array.isArray(cash);
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
