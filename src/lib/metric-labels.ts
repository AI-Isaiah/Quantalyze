type QualLabel = { label: string; color: "positive" | "negative" | "warning" | "muted" };

interface Threshold {
  max: number;
  label: string;
  color: QualLabel["color"];
}

function classify(value: number | null | undefined, thresholds: Threshold[]): QualLabel | null {
  if (value == null) return null;
  for (const t of thresholds) {
    if (value < t.max) return { label: t.label, color: t.color };
  }
  // Fallback: last threshold (unreachable when last max is Infinity, but safe guard)
  const last = thresholds[thresholds.length - 1];
  return { label: last.label, color: last.color };
}

// Calibrated to crypto benchmarks (Sharpe 1.5+ is top-decile in crypto)
const SHARPE: Threshold[] = [
  { max: 0, label: "Poor", color: "negative" },
  { max: 1, label: "Below avg", color: "warning" },
  { max: 1.5, label: "Good", color: "muted" },
  { max: 2.5, label: "Excellent", color: "positive" },
  { max: Infinity, label: "Outstanding", color: "positive" },
];

const SORTINO: Threshold[] = [
  { max: 0, label: "Poor", color: "negative" },
  { max: 1, label: "Below avg", color: "warning" },
  { max: 2, label: "Good", color: "muted" },
  { max: Infinity, label: "Excellent", color: "positive" },
];

const CALMAR: Threshold[] = [
  { max: 0.5, label: "Poor", color: "negative" },
  { max: 1, label: "Fair", color: "warning" },
  { max: 3, label: "Good", color: "muted" },
  { max: Infinity, label: "Excellent", color: "positive" },
];

const MAX_DD: Threshold[] = [
  { max: -0.5, label: "Severe", color: "negative" },
  { max: -0.3, label: "High", color: "negative" },
  { max: -0.1, label: "Moderate", color: "warning" },
  { max: Infinity, label: "Low", color: "positive" },
];

const WIN_RATE: Threshold[] = [
  { max: 0.4, label: "Low", color: "negative" },
  { max: 0.55, label: "Average", color: "warning" },
  { max: 0.65, label: "Good", color: "muted" },
  { max: Infinity, label: "Excellent", color: "positive" },
];

const VOLATILITY: Threshold[] = [
  { max: 0.15, label: "Low", color: "positive" },
  { max: 0.3, label: "Moderate", color: "muted" },
  { max: 0.5, label: "High", color: "warning" },
  { max: Infinity, label: "Very high", color: "negative" },
];

const PROFIT_FACTOR: Threshold[] = [
  { max: 1, label: "Losing", color: "negative" },
  { max: 1.5, label: "Marginal", color: "warning" },
  { max: 2, label: "Good", color: "muted" },
  { max: Infinity, label: "Strong", color: "positive" },
];

const CAGR: Threshold[] = [
  { max: 0, label: "Negative", color: "negative" },
  { max: 0.1, label: "Low", color: "warning" },
  { max: 0.3, label: "Good", color: "muted" },
  { max: Infinity, label: "Strong", color: "positive" },
];

const METRIC_THRESHOLDS: Record<string, Threshold[]> = {
  sharpe: SHARPE,
  sortino: SORTINO,
  calmar: CALMAR,
  max_drawdown: MAX_DD,
  volatility: VOLATILITY,
  cagr: CAGR,
  smart_sharpe: SHARPE,
  smart_sortino: SORTINO,
  profit_factor: PROFIT_FACTOR,
  win_rate: WIN_RATE,
};

export function getMetricLabel(metricKey: string, value: number | null | undefined): QualLabel | null {
  const thresholds = METRIC_THRESHOLDS[metricKey];
  if (!thresholds) return null;
  return classify(value, thresholds);
}

export const LABEL_COLORS: Record<QualLabel["color"], string> = {
  positive: "text-positive bg-positive/10",
  negative: "text-negative bg-negative/10",
  warning: "text-badge-market-neutral bg-badge-market-neutral/10",
  muted: "text-text-secondary bg-page",
};
