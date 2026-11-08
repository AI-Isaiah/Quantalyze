import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { withPublishedOnly } from "@/lib/visibility";
import { captureToSentry } from "@/lib/sentry-capture";

/**
 * Phase 194 plan 07 (D-04 as superseded by D-15; T-194-19) - the strategy's TOTAL
 * record, as the five scalars `figureRecord` needs to decide whether an annualised
 * figure shows (src/lib/figure-gate.ts).
 *
 * Why a read of its own: `getFactsheetDetail` is the anon ranked projection and
 * carries neither `returns_series` nor `data_quality_flags` (internal data-quality
 * state) nor the whole of `metrics_json`. Widening it would hand those blobs to every
 * ranked-list caller to serve a verdict. So the caller makes this one request-scoped,
 * published-only read, bounded to one strategy id, and only four scalar JSON-path
 * aliases leave the database (the measured `->0->>date` / `->-1->>date` alias forms
 * the ranked list already uses for `series_end`). `returns_series`,
 * `data_quality_flags` and `metrics_json` are never projected whole, and nothing but
 * the five scalars leaves this function. No admin client: pass the caller's
 * request-scoped client.
 *
 * Called after the strategy has been fetched, so the published gate has already run;
 * `withPublishedOnly` repeats it so the guarantee does not depend on call order.
 *
 * Fails CLOSED. A read error returns `{ determined: false }` (the caller prints the
 * annualised figures as dashes). "The row is readable and a value is null" is a
 * different fact and is returned as `determined: true` with a null field, which the
 * gate itself resolves (a null span reads as `null`, a null count falls back to the
 * day bound).
 */
export const RECORD_SPAN_SELECT =
  "strategy_analytics ( series_start:returns_series->0->>date, series_end:returns_series->-1->>date, headline_since:data_quality_flags->>headline_since, record_observations:metrics_json->record_observations )";

export type RecordSpanRead =
  | {
      determined: true;
      /** First return date (ISO yyyy-mm-dd), or null. */
      seriesStart: string | null;
      /** Last return date (ISO yyyy-mm-dd), or null. */
      seriesEnd: string | null;
      /** Start of the headline window on a chain-broken row, or null. */
      headlineSince: string | null;
      /** Stored count of return observations (D-15), or null before the recompute. */
      observations: number | null;
    }
  | { determined: false };

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function asCount(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export async function readRecordSpan(
  supabase: SupabaseClient,
  strategyId: string,
): Promise<RecordSpanRead> {
  try {
    const { data, error } = await withPublishedOnly(
      supabase.from("strategies").select(RECORD_SPAN_SELECT).eq("id", strategyId),
    ).maybeSingle();
    if (error) return failed(strategyId, "read_error", error.message);
    // The page has just rendered this published strategy, so no row is an
    // anomaly (an unpublish race at worst), not "an empty record".
    if (!data) return failed(strategyId, "no_row", "no strategies row returned");
    const embed = (data as { strategy_analytics?: unknown }).strategy_analytics;
    const row = (Array.isArray(embed) ? embed[0] : embed) as Record<string, unknown> | null | undefined;
    if (row == null) return failed(strategyId, "no_analytics", "no strategy_analytics row returned");
    return {
      determined: true,
      seriesStart: asString(row.series_start),
      seriesEnd: asString(row.series_end),
      headlineSince: asString(row.headline_since),
      observations: asCount(row.record_observations),
    };
  } catch (err) {
    return failed(strategyId, "read_threw", err instanceof Error ? err.message : String(err));
  }
}

/**
 * Report a failed read to Sentry (`console.*` does not reach it in this repo) and
 * fail closed. The caller owns the single `console.error` line, so a degraded page
 * logs exactly once; this is the half that makes the failure visible to people.
 */
function failed(
  strategyId: string,
  reason: "read_error" | "no_row" | "no_analytics" | "read_threw",
  detail: string,
): RecordSpanRead {
  captureToSentry(new Error(`record span read ${reason}`), {
    tags: { stage: "record-span-read", reason, strategy_id: strategyId },
    extra: { detail },
  });
  return { determined: false };
}
