interface MetricCellProps {
  label: string;
  value: string | null;
  /** When true, value renders in --color-negative. Caller decides based on data semantics. */
  negative?: boolean;
}

/**
 * Shared metric-cell primitive used in Panel 6 (4 metric rows) and Panel 7
 * (Benchmark Greeks table). Pattern:
 *   - 12px DM Sans regular text-text-muted label
 *   - 18px Geist Mono semibold tabular-nums value
 *   - Em-dash (U+2014) for null
 *   - text-negative when `negative=true`
 *
 * Wrapped in <dl>/<dt>/<dd> for the project A11Y semantic-HTML rule.
 */
export function MetricCell({ label, value, negative }: MetricCellProps) {
  return (
    <dl className="space-y-1">
      <dt className="text-xs font-normal text-text-muted">{label}</dt>
      <dd
        className={
          "text-lg font-semibold tabular-nums " +
          (negative ? "text-negative" : "text-text-primary")
        }
        style={{ fontFamily: "var(--font-mono), monospace" }}
      >
        {value ?? "\u2014"}
      </dd>
    </dl>
  );
}
