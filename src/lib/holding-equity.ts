// ============================================================================
// Phase 167.1.1.2 AUMBASIS (D-04, D-06) — what one holding contributes to AUM
//
// ONE definition, read by the server (queries.ts re-exports it), by the client
// (live-holdings-summary.ts aliases it), by the compare panel and by the
// scenario commit route. Before this module the rule existed as an SSR helper,
// a hand-kept client copy and a third inline copy in the compare panel; the
// copies were kept in step by comments, which is how they would drift.
//
// The Python twin is `analytics-service/services/holding_equity.py`. Python
// cannot import TypeScript, so the pin between the two runtimes is the shared
// fixture `analytics-service/tests/fixtures/holding_equity_contribution_cases.json`:
// ONE hand-typed `expected` per case, replayed by vitest
// (`src/lib/holding-equity-contribution.parity.test.ts`) and by pytest.
//
// Phase 167.2.1.1.1.1 D-07 adds `holdingIsPriceGap` here. Its Python twin is
// `is_price_gap_holding` in the same module and its fixture is
// `analytics-service/tests/fixtures/holding_price_gap_cases.json` (vitest:
// `src/lib/holding-price-gap.parity.test.ts`). It decides what the screen SAYS
// about a stored 0 and never changes the AUM sum above.
//
// Pure functions, no imports — safe in server, client, and test contexts.
// ============================================================================

/**
 * The fields the rule reads. Structural, so the dashboard holding, the commit
 * route's row and the compare panel's optional-P&L holding all fit.
 * `unrealized_pnl_usd` is optional on purpose: an ABSENT field is treated like
 * null (see `holdingEquityContribution`).
 */
export type HoldingEquityInput = {
  holding_type: string;
  value_usd: number | null;
  unrealized_pnl_usd?: number | null;
};

/**
 * NEW-C03-01 / Phase 167.1.1.2 D-06: equity contribution by holding type.
 *
 *   - Spot: `value_usd` (marked fair value — this IS the equity contribution).
 *   - Derivative: `unrealized_pnl_usd` (the actual equity contribution).
 *     `value_usd` on a derivative is the NOTIONAL contract size — e.g. a 10x
 *     perp with $5M notional has ~$500k of margin/equity at stake, not $5M.
 *     Using notional inflates AUM by the leverage factor and dominates the
 *     per-holding weights used by computeScenario.
 *
 * Shorts: unrealized_pnl_usd is negative for a losing short. We return the
 * full signed value so the short's equity impact is reflected in the weight
 * (a deeply-negative short has near-zero positive weight, which is correct).
 * We don't clamp to 0 here — callers that need a non-negative weight for the
 * scenario can normalise after the fact.
 *
 * D-06, a missing P&L is WITHHELD: a derivative whose `unrealized_pnl_usd` is
 * null or absent returns `null`, never 0 and never notional. A caller that
 * SUMS skips the row and counts it (`summarizeLiveHoldings.pnlMissing`, the
 * commit route's withheld count); a caller that builds a WEIGHT reads
 * `?? 0`. The check is LOOSE (`== null`) so an absent field behaves like null.
 * A derivative P&L that is present but not a finite number still returns 0,
 * and so does a spot `value_usd` that is not finite (D-06, unchanged).
 *
 * The Python twin returns None for exactly the same input; the shared fixture
 * pins both.
 */
export function holdingEquityContribution(h: HoldingEquityInput): number | null {
  if (h.holding_type === "derivative") {
    const pnl = h.unrealized_pnl_usd;
    if (pnl == null) return null;
    return Number.isFinite(pnl) ? pnl : 0;
  }
  return Number.isFinite(h.value_usd) && h.value_usd !== null ? h.value_usd : 0;
}

/**
 * Whether `holdingEquityContribution` produced a REPORTED figure rather than a
 * withheld or defaulted one: a derivative with a null / absent / non-finite
 * `unrealized_pnl_usd`, or a spot holding with a non-finite `value_usd`, is not
 * reported. One predicate for every surface that counts a row it could not size
 * (null and a non-finite P&L are both "not reported"; adding 0 and leaving the
 * row out give the same total). It never changes a sum.
 */
export function holdingEquityIsReported(h: HoldingEquityInput): boolean {
  if (h.holding_type === "derivative") {
    return h.unrealized_pnl_usd != null && Number.isFinite(h.unrealized_pnl_usd);
  }
  return Number.isFinite(h.value_usd);
}

/**
 * The fields the price-gap rule reads. Structural, so the dashboard holding and
 * `HoldingRow` both fit; `HoldingEquityInput` is deliberately not widened.
 */
export type HoldingPriceGapInput = {
  holding_type: string;
  quantity?: number | null;
  mark_price_usd?: number | null;
};

/**
 * Phase 167.2.1.1.1.1 D-07: a stored holdings row is a PRICE GAP iff it is a
 * spot holding of a finite, positive `quantity` whose `mark_price_usd` is NOT a
 * finite number above 0. It is the `holding_marks` gap rule (a finite mark at or
 * below 0 is a gap) applied to a stored row, so no new notion of a gap exists.
 * Null, absent, 0, negative, NaN, Infinity, boolean and string marks are gaps;
 * a quantity of 0 (or one that is non-finite or negative) is not (nothing is
 * held); a derivative is never a gap.
 *
 * The surfaces read this to say "no price" where they would otherwise show a
 * stored 0 as a measured figure. It never changes `holdingEquityContribution`.
 *
 * It is row-level and pure: it carries no stable-value set and no venue rule.
 * The refresh adds its stable-value and Deribit exclusions locally (plan 12).
 *
 * The Python twin is `is_price_gap_holding`; the fixture
 * `holding_price_gap_cases.json` pins both.
 */
export function holdingIsPriceGap(h: HoldingPriceGapInput): boolean {
  if (h.holding_type !== "spot") return false;
  const quantity = h.quantity;
  if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity <= 0) return false;
  const mark = h.mark_price_usd;
  return !(typeof mark === "number" && Number.isFinite(mark) && mark > 0);
}
