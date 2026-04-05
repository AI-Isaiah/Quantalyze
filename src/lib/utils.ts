export function formatPercent(value: number | null | undefined): string {
  if (value == null) return "—";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(2)}%`;
}

const numberFormatters = new Map<number, Intl.NumberFormat>();
function getNumberFormatter(decimals: number) {
  let fmt = numberFormatters.get(decimals);
  if (!fmt) {
    fmt = new Intl.NumberFormat("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    numberFormatters.set(decimals, fmt);
  }
  return fmt;
}

export function formatNumber(value: number | null | undefined, decimals = 2): string {
  if (value == null) return "—";
  return getNumberFormatter(decimals).format(value);
}

export function formatCurrency(value: number | null | undefined): string {
  if (value == null) return "—";
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

export function metricColor(value: number | null | undefined): string {
  if (value == null) return "text-text-muted";
  return value >= 0 ? "text-positive" : "text-negative";
}

export function cn(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(" ");
}
