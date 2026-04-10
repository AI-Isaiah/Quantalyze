"use client";

/**
 * KPI metric card — reusable across My Allocation, ScenarioBuilder,
 * and any future dashboard surface.
 */
export function MetricCard({
  label,
  value,
  positive,
  negative,
}: {
  label: string;
  value: string;
  positive?: boolean;
  negative?: boolean;
}) {
  const color = positive
    ? "text-positive"
    : negative
      ? "text-negative"
      : "text-text-primary";
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium">
        {label}
      </p>
      <p
        className={`mt-1 text-xl font-bold font-metric tabular-nums ${color}`}
      >
        {value}
      </p>
    </div>
  );
}
