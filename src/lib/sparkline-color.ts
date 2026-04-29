export function sparklineColor(data: number[]): string {
  if (!data || data.length === 0) return "var(--color-chart-benchmark)";
  const final = data[data.length - 1];
  if (final > 0) return "var(--color-accent)";
  if (final < 0) return "var(--color-negative)";
  return "var(--color-chart-benchmark)";
}
