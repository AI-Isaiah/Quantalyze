/**
 * Phase 09 / finding g4 + LIVE-03. Holding-side factsheet card for /compare.
 *
 * Rendered by CompareTable when item.kind === 'holding'. Parity with
 * FactsheetPreview.tsx (strategy side): DM Sans labels, Geist Mono
 * numerics, 1px border, 8px radius per DESIGN.md.
 *
 * Four institutional metrics: cumulative_return, sharpe, max_drawdown, vol.
 * Missing metrics render "—" (em-dash) per institutional convention —
 * explicit-missing, never zero.
 *
 * Phase 167.1.1 / D-03 replaces 167.1.2 / D-13's withholding for spot: the four
 * metrics are computed from the daily mark price, so a spot item is "ready"
 * and the card says where the numbers come from (State R) or, with fewer than
 * HOLDING_COMPARE_MIN_PRICED_DAYS priced days (`priced_days < MIN`, not "all
 * four null"), shows em-dashes and the threshold (State R0). At or above the
 * minimum, a null vol adds one muted sentence naming why (State R2, SFH-02).
 * Phase 167.1.1.1 / D-02: a derivative takes the same grid from its direction-signed
 * mark price (State RD), and its caption says the sign rule in words: a price rise is
 * a gain while the position was long and a loss while it was short. A derivative with
 * priced days and no established direction (State ND) and an option (State OP) are
 * withheld with a named note. A spot holding whose recorded price is a writer constant
 * (stablecoin, MT5 account, sFOX) is withheld with a named note (State F); any
 * other holding_type fails closed (State X).
 * Fail-closed: only an explicit `historyState === "ready"` with analytics
 * present renders numbers.
 */
import {
  HOLDING_COMPARE_MIN_PRICED_DAYS,
  type HoldingCompareItem,
} from "@/app/(dashboard)/compare/lib/holding-compare-adapter";
import { formatRatio, formatUnsignedPercent } from "@/lib/factsheet/display-sign";
import { formatNumber } from "@/lib/utils";

function fmtPct(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  return formatUnsignedPercent(v, 2);
}

function fmtNum(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  return formatRatio(v, 2);
}

function dayCount(n: number): string {
  return n === 1 ? "1 day" : `${formatNumber(n, 0)} days`;
}

function pricedDayCount(n: number): string {
  return n === 1 ? "1 priced day" : `${formatNumber(n, 0)} priced days`;
}

// CR-01 / SFH-01 (167.1.1 round 1) and M-R2-01 (round 2): a spot holding whose
// recorded price is not a market price has rows and an owner but no metric, so it
// shows a named note (State F). One sentence per cause, because the false cause is
// the defect: an MT5 account balance must never read "a fixed value".
function withheldNote(
  symbol: string,
  reason: Extract<HoldingCompareItem, { historyState: "withheld" }>["withheld_reason"],
): string {
  const lead = `Return, Sharpe, max drawdown and volatility are not shown for ${symbol}:`;
  switch (reason) {
    case "account_balance":
      return `${lead} it is an account balance, not a traded asset.`;
    case "fixed_price":
      return `${lead} its recorded price is a fixed value, not a market price.`;
    case "no_price":
      return `${lead} no market price has been recorded for it.`;
    case "no_direction":
      return `${lead} its long or short direction could not be established from the recorded positions.`;
    case "option_premium":
      return `${lead} it is an option, and these figures are not computed from option premiums.`;
  }
}

// SFH-02: vol and Sharpe are over one-day returns, taken only between two
// ADJACENT priced calendar days, so they are null with fewer than two such pairs
// even when return and drawdown (level metrics) are numbers.
const ADJACENCY_NOTE =
  "Volatility and Sharpe need at least two pairs of consecutive priced days.";

// 167.1.1.1 D-02: the derivative basis line. "while" is neutral about which day's direction
// governs an interval, and "opening, closing or resizing" is the consequence that matters.
function derivativePriceBasis(n: number, symbol: string): string {
  return `Computed from ${dayCount(n)} of ${symbol}'s daily mark price. A price rise counts as a gain while the position was long and as a loss while it was short, so opening, closing or resizing the position does not count as a gain or loss.`;
}

// The signed series compounds adjacent-day returns only, so a move across a missing day
// (or across a day with no established direction, which is a missing day of that series)
// is dropped. Spot reads a price LEVEL ratio and does not drop it, so only a derivative
// says so.
const DERIVATIVE_GAP_NOTE = "A price move across a missing day is not counted.";

const NOT_SPOT_NOTE =
  "Return, Sharpe, max drawdown and volatility are computed for spot holdings only, and this holding is not recorded as spot.";

export function HoldingFactsheet({ item }: { item: HoldingCompareItem }) {
  const { venue, symbol, holding_type } = item;
  const analytics =
    item.historyState === "ready" && item.analytics != null
      ? item.analytics
      : null;
  // SFH-02: the adapter's own rule is the single source of truth (not "all four
  // metrics null", which disagrees the moment a partial null shows up).
  const tooFewPricedDays =
    analytics !== null &&
    analytics.priced_days < HOLDING_COMPARE_MIN_PRICED_DAYS;
  // At or above the minimum, vol and Sharpe still need two adjacent-day returns:
  // priced days with gaps between them give a numeric return and drawdown but
  // null vol, and the card must say why instead of printing two bare em-dashes.
  const needsAdjacentDays =
    analytics !== null && !tooFewPricedDays && analytics.vol === null;
  return (
    <div
      data-testid="holding-factsheet"
      // An unbroken symbol (an MT5 `ACCOUNT-<hex>` row, a long contract name)
      // must wrap inside the card at 375px instead of pushing past it.
      // `overflow-wrap` inherits, so it covers the heading and every note.
      className="min-w-0 [overflow-wrap:anywhere] rounded-lg border border-border bg-surface p-6 flex flex-col gap-4"
    >
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <span className="inline-block text-fixed-10 uppercase tracking-wider text-text-muted font-medium px-2 py-0.5 rounded-sm bg-page mb-2">
            Holding
          </span>
          <h3 className="font-display text-2xl text-text-primary">{symbol}</h3>
          <p className="text-sm text-text-secondary">
            {venue} · {holding_type}
          </p>
        </div>
      </div>

      {analytics === null ? (
        <p
          data-testid="holding-factsheet-rebuilding"
          className="max-w-prose text-sm text-text-secondary"
        >
          {item.historyState === "withheld"
            ? withheldNote(symbol, item.withheld_reason)
            : NOT_SPOT_NOTE}
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-4">
            <div>
              <dt className="text-fixed-10 uppercase tracking-wider text-text-muted">
                Cumulative return
              </dt>
              <dd className="font-mono text-lg text-text-primary">
                {fmtPct(analytics.cumulative_return)}
              </dd>
            </div>
            <div>
              <dt className="text-fixed-10 uppercase tracking-wider text-text-muted">
                Sharpe
              </dt>
              <dd className="font-mono text-lg text-text-primary">
                {fmtNum(analytics.sharpe)}
              </dd>
            </div>
            <div>
              <dt className="text-fixed-10 uppercase tracking-wider text-text-muted">
                Max drawdown
              </dt>
              <dd className="font-mono text-lg text-text-primary">
                {fmtPct(analytics.max_drawdown)}
              </dd>
            </div>
            <div>
              <dt className="text-fixed-10 uppercase tracking-wider text-text-muted">
                Vol (annualized)
              </dt>
              <dd className="font-mono text-lg text-text-primary">
                {fmtPct(analytics.vol)}
              </dd>
            </div>
          </dl>
          <p
            data-testid="holding-factsheet-price-basis"
            className="max-w-prose text-sm text-text-muted"
          >
            {tooFewPricedDays
              ? `Only ${pricedDayCount(analytics.priced_days)} of ${symbol} so far. These four figures need at least ${HOLDING_COMPARE_MIN_PRICED_DAYS} priced days.`
              : holding_type === "derivative"
                ? `${derivativePriceBasis(analytics.priced_days, symbol)} ${DERIVATIVE_GAP_NOTE}`
                : `Computed from ${dayCount(analytics.priced_days)} of ${symbol}'s daily price, so buying, selling or moving more of it does not count as a gain or loss.`}
          </p>
          {needsAdjacentDays && (
            <p
              data-testid="holding-factsheet-adjacency-note"
              className="max-w-prose text-sm text-text-muted"
            >
              {ADJACENCY_NOTE}
            </p>
          )}
        </>
      )}
    </div>
  );
}
