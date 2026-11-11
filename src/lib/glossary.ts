/**
 * Phase 201 plan 01 (D-01, D-02, D-03): the ONE registry of specialist terms.
 *
 * A term's label and definition live here and nowhere else. A surface renders a
 * term through `Term` (`@/components/ui/Term`) or, for a label that is already a
 * control, through `Tooltip` with `termDefinition(key)`. A key is a member of the
 * closed `TermKey` union derived from `GLOSSARY`, so an unregistered key is a type
 * error and never an empty bubble.
 *
 * Copy rules (201-UI-SPEC Interaction contract 2): one or two sentences, at most 200
 * characters, a formula only where the code computes it, no retired word. All three
 * are pinned by `glossary.test.ts`.
 *
 * The discovery header tooltips live here as a `discovery` context, moved
 * byte-identical from `DISCOVERY_COLUMNS` with `FULL_RECORD_BASIS` and
 * `SIX_MONTH_WINDOW_DAYS` kept as interpolations.
 *
 * Pure data: no React and no client directive, so server pages and client
 * components both import it (copy-module convention, as `degrade-warnings.ts`).
 */

import { SIX_MONTH_WINDOW_DAYS } from "@/lib/factsheet/compute";

/** Where a term's wording differs from its generic definition. */
export type TermContext = "discovery" | "last12m";

export interface GlossaryEntry {
  /** The printed label. */
  label: string;
  /** Other printed forms of the same term; no two keys may share a label or alias. */
  aliases?: readonly string[];
  /** The generic definition: one or two sentences, at most 200 characters. */
  definition: string;
  /** Context-specific definitions, picked by `termDefinition(key, context)`. */
  contexts?: Partial<Record<TermContext, string>>;
}

/**
 * The clause every full-record discovery figure's tooltip ends on. Copied from
 * `discovery-columns.ts`, whose private copy plan 201-16 deletes in favour of this
 * export; until then `glossary.test.ts` pins the two equal.
 */
export const FULL_RECORD_BASIS =
  "From the first return day, or from the last break in the record.";

// Discovery-only terms: the generic definition IS the discovery string, so each
// is declared once and used for both slots.
const TRACK =
  "How long the record is, in whole months. Counted over the days its returns cover.";
const RETURN_FULL = `Total return over the whole record. ${FULL_RECORD_BASIS}`;
const RETURN_6M = `Return over the ${SIX_MONTH_WINDOW_DAYS} calendar days that end on the record's last day.`;
const AUM =
  "Assets under management as the manager states it. It is not measured from the exchange.";
const RETURN_CURVE = "Cumulative return over the whole record.";
const UNDERWATER = "Distance below the previous peak over the whole record.";

export const GLOSSARY = {
  omega: {
    label: "Omega",
    aliases: ["Omega (θ=0)"],
    definition:
      "Sum of daily gains divided by the absolute sum of daily losses, with 0% as the threshold (θ=0). At this threshold it equals the profit factor.",
  },
  profit_factor: {
    label: "Profit Factor",
    definition:
      "Sum of daily gains divided by the absolute sum of daily losses. Above 1.00, the record gained more than it lost.",
  },
  ulcer_index: {
    label: "Ulcer Index",
    definition:
      "Root mean square of the daily drawdown from the running peak, in percent. Deep drawdowns raise it more than shallow ones.",
  },
  pain_index: {
    label: "Pain Index",
    definition:
      "Average daily drawdown from the running peak, in percent. It grows with both the depth and the length of drawdowns.",
  },
  tail_ratio: {
    label: "Tail ratio",
    aliases: ["Tail Ratio (P95/|P5|)"],
    definition:
      "The 95th-percentile daily return divided by the absolute 5th-percentile daily return. Above 1.00, the best days are larger than the worst days.",
  },
  common_sense_ratio: {
    label: "Common-sense ratio",
    aliases: ["Common-sense Ratio"],
    definition:
      "Tail ratio multiplied by profit factor. It combines how large the best days are against the worst with how much was gained against what was lost.",
  },
  recovery_factor: {
    label: "Recovery Factor",
    definition:
      "Cumulative return divided by the absolute maximum drawdown: how many times the record has earned back its worst fall.",
  },
  avg_win_loss: {
    label: "Avg Win / Avg Loss",
    definition:
      "Average return on winning days divided by the absolute average return on losing days.",
  },
  kolmogorov_smirnov: {
    label: "Kolmogorov-Smirnov",
    aliases: ["Two-sample Kolmogorov-Smirnov"],
    definition:
      "Tests whether the first and second halves of the record share one distribution of daily returns. D is the largest gap between them; p below 0.05 means they differ.",
  },
  sharpe: {
    label: "Sharpe",
    definition:
      "Annualized return divided by annualized volatility, with a 0% risk-free rate.",
    contexts: {
      discovery: `Annualized return divided by annualized volatility over the whole record. ${FULL_RECORD_BASIS}`,
    },
  },
  sortino: {
    label: "Sortino",
    definition:
      "Annualized return divided by downside deviation, which counts only losing days as risk. A 0% risk-free rate is used.",
  },
  calmar: {
    label: "Calmar",
    definition: "CAGR divided by the absolute maximum drawdown.",
  },
  cagr: {
    label: "CAGR",
    definition:
      "Compound annual growth rate: the constant yearly return that turns the starting value into the ending value.",
    contexts: {
      discovery: `Compound annual growth rate over the whole record. ${FULL_RECORD_BASIS}`,
    },
  },
  max_drawdown: {
    label: "Max DD",
    aliases: ["Max Drawdown", "Max DD 12m", "MaxDD"],
    definition: "The largest fall from a peak to a later low, in percent.",
    contexts: {
      discovery: `The largest fall from a peak over the whole record. ${FULL_RECORD_BASIS}`,
      last12m:
        "The largest fall from a peak to a later low in the last 12 months, in percent.",
    },
  },
  dd_duration: {
    label: "Longest DD (days)",
    aliases: ["DD Duration"],
    definition: "The longest run of days spent below a previous peak.",
  },
  volatility: {
    label: "Volatility",
    aliases: ["Ann. Volatility", "Ann. Vol"],
    definition:
      "Standard deviation of daily returns, annualized. It is never negative, so it carries no sign.",
    contexts: {
      discovery:
        "How much daily returns vary, annualized over the whole record. It is never negative, so it carries no sign.",
    },
  },
  skew: {
    label: "Skew",
    definition:
      "Asymmetry of daily returns around their mean. Negative means large losses outnumber large gains of the same size.",
  },
  kurtosis: {
    label: "Kurtosis",
    aliases: ["Kurtosis (excess)"],
    definition:
      "Excess kurtosis of daily returns: how heavy the tails are against a normal distribution, which scores 0.",
  },
  var_95: {
    label: "VaR 95%",
    definition:
      "Value at risk: the daily return that 95% of days in the record beat, read from the record's own returns.",
  },
  cvar_95: {
    label: "CVaR 95%",
    definition:
      "Conditional value at risk: the average daily return on the worst 5% of days in the record.",
  },
  percentile: {
    label: "P5",
    aliases: ["P25", "P75", "P95", "P5 (daily)", "P95 (daily)"],
    definition:
      "A percentile of daily returns: P5 is the return 5% of days fell below; P95 the return 95% of days fell below.",
  },
  bootstrap_ci: {
    label: "Bootstrap 95% Confidence",
    definition:
      "A range built by resampling the record's daily returns in blocks many times. 2.5% of the resampled values fall below it and 2.5% above.",
  },
  correlation: {
    label: "Correlation",
    aliases: ["ρ"],
    definition:
      "Pearson correlation of two daily return series, from −1 to 1. Near 0, the two move independently.",
  },
  avg_abs_correlation: {
    label: "Avg |ρ|",
    definition:
      "Average of the absolute correlations between each pair of holdings' daily returns, from 0 to 1. Lower means the holdings move more independently.",
  },
  alpha: {
    label: "Alpha (ann)",
    aliases: ["α vs {comparator}"],
    definition:
      "Annualized return not explained by the comparator once beta is taken out.",
  },
  beta: {
    label: "Beta",
    aliases: ["β"],
    definition:
      "How much daily returns move with the comparator's daily returns. 1.00 moves one for one; 0 means no linear link.",
  },
  r_squared: {
    label: "R²",
    definition:
      "Share of the variance in daily returns that the comparator explains, from 0 to 1.",
  },
  information_ratio: {
    label: "Information Ratio",
    aliases: ["IR vs {comparator}"],
    definition:
      "Annualized return over the comparator divided by tracking error.",
  },
  treynor: {
    label: "Treynor",
    definition:
      "Annualized return divided by beta: return per unit of comparator risk.",
  },
  tracking_error: {
    label: "Tracking Error",
    definition:
      "Annualized standard deviation of the daily difference between the strategy's and the comparator's returns.",
  },
  up_capture: {
    label: "Up Capture",
    definition:
      "The strategy's return on the comparator's up days divided by the comparator's return on those days. Above 1.00, it gained more.",
  },
  down_capture: {
    label: "Down Capture",
    definition:
      "The strategy's return on the comparator's down days divided by the comparator's return on those days. Below 1.00, it lost less.",
  },
  twr: {
    label: "TWR",
    aliases: ["YTD TWR"],
    definition:
      "Time-weighted return: daily returns compounded over the period, so money moved in or out does not change the figure.",
  },
  returns_signature: {
    label: "Returns Signatures",
    aliases: ["Returns Cross Signatures"],
    definition:
      "How BTC and the strategy's own capital moved from 14 days before to 14 days after each win or loss event, rebased to 0% at the event. Shown as the mean, the median and percentile bands.",
  },
  volatility_matched: {
    label: "Volatility Matched",
    definition:
      "The comparator's returns rescaled so its volatility equals the strategy's, so the two curves compare return per unit of risk.",
  },
  scenario: {
    label: "Scenario",
    definition:
      "Scenario models changes to your allocation before you make them and shows ranked replacements for holdings outside your mandate. It was formerly called Bridge.",
  },
  mandate: {
    label: "Mandate",
    aliases: ["mandate"],
    definition:
      "The criteria you set for what you hold: preferred strategy types, excluded exchanges, the largest weight one strategy may take and the worst drawdown you accept. Recommendations and Scenario read it.",
  },
  sharpe_lift: {
    label: "Sharpe lift",
    definition:
      "Modeled change in your allocation's Sharpe ratio if this strategy were added — a unitless delta, not a percentage. Positive means better risk-adjusted return in backtest.",
  },
  corr_with_allocation: {
    label: "Corr w/ allocation",
    definition:
      "Correlation of this strategy's daily returns with your current allocation, from -1 to 1 (not a percentage). Lower means more diversification benefit.",
  },
  dd_improve: {
    label: "DD improve",
    definition:
      "Modeled reduction in your allocation's maximum drawdown from adding this strategy, as a percentage of NAV.",
  },
  // Discovery-only terms (render on the discovery table and grid only).
  track: {
    label: "Track",
    definition: TRACK,
    contexts: { discovery: TRACK },
  },
  return_full: {
    label: "Return (full record)",
    definition: RETURN_FULL,
    contexts: { discovery: RETURN_FULL },
  },
  return_6m: {
    label: "Return (last 6 months)",
    definition: RETURN_6M,
    contexts: { discovery: RETURN_6M },
  },
  aum: {
    label: "AUM",
    definition: AUM,
    contexts: { discovery: AUM },
  },
  return_curve: {
    label: "Return curve",
    definition: RETURN_CURVE,
    contexts: { discovery: RETURN_CURVE },
  },
  underwater: {
    label: "Underwater",
    definition: UNDERWATER,
    contexts: { discovery: UNDERWATER },
  },
} as const satisfies Record<string, GlossaryEntry>;

export type TermKey = keyof typeof GLOSSARY;

/** The definition for `key`: the context string when that key has one, else the generic one. */
export function termDefinition(key: TermKey, context?: TermContext): string {
  const entry: GlossaryEntry = GLOSSARY[key];
  return (context && entry.contexts?.[context]) || entry.definition;
}

/** The printed label for `key`. */
export function termLabel(key: TermKey): string {
  return GLOSSARY[key].label;
}
