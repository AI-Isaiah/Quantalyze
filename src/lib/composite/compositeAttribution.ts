/**
 * compositeAttribution — pure per-key attribution partition for the composite
 * preview (Phase 89, PREV-01).
 *
 * The composite finalize enqueues `stitch_composite`, and `run_stitch_composite_job`
 * (Phase 86) persists the stitched `csv_daily_returns` series plus each member's
 * inclusive coverage window under `data_quality_flags.per_key`. This module
 * PARTITIONS that already-stitched series by member window and folds each
 * member's signed contribution. It NEVER re-stitches on the client — a second
 * derivation surface would risk the exact v1.5 silent-divergence the milestone
 * is built to avoid.
 *
 * PURE: imports nothing but types, does no I/O, touches no Supabase, and uses NO
 * JS Date. All date math is LEXICOGRAPHIC 'YYYY-MM-DD' string compare (the
 * scenario-window.ts / windowOverlap.ts discipline) — string order equals
 * chronological order for this format, so there is no UTC/local off-by-one.
 */

/** One member key's contribution to the stitched composite track. */
export interface MemberAttribution {
  /** Server-derived member order (strategy_keys.seq). */
  seq: number;
  /** Count of PRESENT stitched days that fall inside this member's window. */
  days: number;
  /**
   * Signed contribution over the member's window — arithmetic Σr or geometric
   * Π(1+r)−1 per `basis`. `null` (never 0) when the member owns no present day:
   * a 0 would be an invented flat return (no-invented-data).
   */
  contribution: number | null;
}

/**
 * Resolve the attribution basis from a strategy's `returns_denominator_config`
 * jsonb — mirrors the server branch VERBATIM:
 *   analytics-service/services/job_worker.py:3250-3255
 *     if denominator_config is not None:
 *         cumulative_method = denominator_config.cumulative_method
 *     else:
 *         cumulative_method = "geometric"
 *   analytics-service/services/allocated_capital.py:241-247
 *     `cumulative_method` is an OPTIONAL key on the jsonb — ABSENT ⇒ "geometric".
 *
 * The ONLY arithmetic trigger is the literal "simple" on a non-null OBJECT
 * config (the allocated/Zavara override). Everything else — null, undefined, a
 * non-object scalar, an absent key, "geometric", or junk — defaults to the
 * geometric composite default (D-locked FLAG-1 resolution, confirmed at plan time).
 */
export function attributionBasisFromConfig(
  raw: unknown,
): "arithmetic" | "geometric" {
  if (
    raw !== null &&
    typeof raw === "object" &&
    (raw as { cumulative_method?: unknown }).cumulative_method === "simple"
  ) {
    return "arithmetic";
  }
  return "geometric";
}

interface DailyReturn {
  date: string;
  daily_return: number;
}

interface PerKeyWindow {
  seq: number;
  first_day: string | null;
  last_day: string | null;
}

/**
 * Partition the already-stitched `series` by each member's INCLUSIVE per_key
 * window `[first_day, last_day]` and fold each member's contribution.
 *
 * Pulled out of the polling/render callback so the `Σ member days == Σ present
 * days` invariant is unit-testable without mounting the wizard step or mocking
 * Supabase (the `deriveDetectedMarkets` idiom). Members are disjoint by the
 * worker's `assert_windows_disjoint` guard, so no present day double-counts.
 *
 * Slice convention (Pitfall 2): per_key windows are INCLUSIVE-both-ends actual-
 * data days — distinct from the HALF-OPEN declared `strategy_keys` windows. A
 * day is owned by a member iff `first_day <= day.date <= last_day` under
 * lexicographic string compare (NO JS Date). Gap days are simply ABSENT from
 * `series` and belong to no member; they are never zero-filled.
 *
 * @param series  stitched csv_daily_returns rows (present days only)
 * @param perKey  member windows; output is ordered by ascending seq
 * @param basis   arithmetic Σr, or geometric Π(1+r)−1
 * @returns one MemberAttribution per perKey entry, ascending seq; `[]` for empty perKey
 */
export function partitionAttribution(
  series: ReadonlyArray<DailyReturn>,
  perKey: ReadonlyArray<PerKeyWindow>,
  basis: "arithmetic" | "geometric",
): MemberAttribution[] {
  return [...perKey]
    .sort((a, b) => a.seq - b.seq)
    .map((member) => {
      const { seq, first_day, last_day } = member;

      // A member with no coverage window (no-data) owns no day → null, not 0.
      if (first_day === null || last_day === null) {
        return { seq, days: 0, contribution: null };
      }

      let days = 0;
      let arithmetic = 0;
      let geometric = 1;
      for (const day of series) {
        // Inclusive both ends, lexicographic ISO compare (per_key convention).
        if (day.date >= first_day && day.date <= last_day) {
          days += 1;
          arithmetic += day.daily_return;
          geometric *= 1 + day.daily_return;
        }
      }

      if (days === 0) {
        return { seq, days: 0, contribution: null };
      }

      const contribution =
        basis === "arithmetic" ? arithmetic : geometric - 1;
      return { seq, days, contribution };
    });
}
