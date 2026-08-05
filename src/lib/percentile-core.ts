/**
 * The ONE percentile scoring core.
 *
 * FOUNDER RULING 2026-08-05 (checker B-4, recorded in 149-CONTEXT.md
 * "Post-research rulings"; refined by the W-A orchestrator ruling): the
 * percentile formula — the count-based rank, the lower-is-better inversion and
 * the max_drawdown magnitude normalisation — lives here and ONLY here. Both
 * `getPercentiles` (the discovery surface: published rows scored against each
 * other) and `getOwnRowPercentiles` (/my-strategies: the owner's OWN rows,
 * drafts included, scored against the published population WITHOUT joining it)
 * delegate to it. A second inline copy of this formula anywhere is a phase-149
 * gate failure — the two surfaces would drift and the same strategy would show
 * two different ranks.
 *
 * SCORING CONVENTION (W-A, binding): each subject is scored SELF-INCLUSIVELY —
 * against `population ∪ {subject}`, deduped BY IDENTITY. A subject that already
 * IS a population row joins nothing (its value is already counted); a subject
 * that is not a member contributes its own value to its OWN denominator only.
 *
 *   - Self-inclusion is the convention published rows already get today, so
 *     `scoreAgainstPopulation(rows, rows)` reproduces the pre-extraction
 *     `getPercentiles` map byte-identically. `queries.percentiles.test.ts` is
 *     the untouched behaviour oracle for that claim.
 *   - It also makes the /my-strategies promise literal: a draft is told "if
 *     published, this would sit at Pnn".
 *   - The security invariant is untouched: a subject's value affects ONLY its
 *     own score. The population array is never mutated and other subjects'
 *     denominators never see it — an unpublished row cannot shift a public rank.
 */

/** Metric keys we compute percentile ranks for */
export const PERCENTILE_METRICS = [
  "cagr",
  "sharpe",
  "sortino",
  "calmar",
  "max_drawdown",
  "volatility",
  "cumulative_return",
] as const;

export type PercentileMetric = (typeof PERCENTILE_METRICS)[number];

/** Metrics where lower values are better — percentile is inverted */
const LOWER_IS_BETTER: ReadonlySet<string> = new Set(["max_drawdown", "volatility"]);

export type PercentileMap = Record<string, Record<PercentileMetric, number>>;

type ScorableRow = { analytics: Record<string, number | null> };

/**
 * Normalise one metric off a row, or null when the row has no value for it.
 *
 * max_drawdown is stored as a NEGATIVE percentage (quantstats convention:
 * -0.30 = 30% peak-to-trough drop). Without Math.abs the LOWER_IS_BETTER
 * inversion ranks the WORST drawdown as the best percentile, because
 * -0.50 < -0.05 numerically. Take the magnitude so the inversion treats "small
 * drawdown" as "low value = good" the same way it does for volatility.
 */
function metricValue(row: ScorableRow, metric: PercentileMetric): number | null {
  const raw = row.analytics[metric];
  if (raw == null) return null;
  return metric === "max_drawdown" ? Math.abs(raw) : raw;
}

/**
 * Percentile-rank every subject against `population`.
 *
 * Per metric: the base population is the non-null values on `population`. Each
 * subject with a non-null value is ranked against `population ∪ {subject}`
 * (identity-deduped, see the file header):
 *
 *     percentile = (count of effective values <= v) / n_effective * 100
 *     percentile = 100 - percentile        // LOWER_IS_BETTER metrics
 *     result     = Math.round(percentile)
 *
 * Subjects with no non-null metric at all are absent from the map; a subject's
 * null metric leaves that KEY absent from its record (never 0 — a missing rank
 * and a bottom rank are different claims).
 */
export function scoreAgainstPopulation(
  subjects: readonly { id: string; analytics: Record<string, number | null> }[],
  population: readonly ScorableRow[],
): PercentileMap {
  // Identity set — reference equality, so `scoreAgainstPopulation(rows, rows)`
  // never double-adds a member's own value to its own denominator.
  const populationMembers = new Set<ScorableRow>(population);

  const result: PercentileMap = {};

  for (const metric of PERCENTILE_METRICS) {
    const populationValues: number[] = [];
    for (const row of population) {
      const v = metricValue(row, metric);
      if (v == null) continue;
      populationValues.push(v);
    }

    for (const subject of subjects) {
      const v = metricValue(subject, metric);
      if (v == null) continue;

      const isMember = populationMembers.has(subject);
      const effective = isMember ? populationValues : [...populationValues, v];
      const n = effective.length;
      if (n === 0) continue;

      const countLessOrEqual = effective.filter((x) => x <= v).length;
      let percentile = (countLessOrEqual / n) * 100;

      if (LOWER_IS_BETTER.has(metric)) {
        percentile = 100 - percentile;
      }

      if (!result[subject.id]) {
        result[subject.id] = {} as Record<PercentileMetric, number>;
      }
      result[subject.id][metric] = Math.round(percentile);
    }
  }

  return result;
}
