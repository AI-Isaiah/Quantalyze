import { formatCurrency, formatPercent, metricColor } from "@/lib/utils";

/**
 * Fund-level KPI strip for the My Allocation dashboard.
 *
 * Renders four metrics for the allocator's single real portfolio as a
 * SHARED PANEL with hairline column dividers — NOT four separate Card
 * components. This is the explicit DESIGN.md pattern: "Data density >
 * card density. If 3+ cards share a row, ask whether it should be one
 * panel with 3 columns instead."
 *
 * Intentionally does NOT reuse PortfolioKPIRow (which still renders four
 * center-aligned Card components with independent borders). That
 * component violates the data density rule and is flagged as tech debt
 * in TODOS.md for a follow-up refactor. Keeping both components in the
 * tree until that refactor lands is acceptable scope management.
 */

interface FundKPIStripProps {
  aum: number | null;
  return24h: number | null;
  returnMtd: number | null;
  returnYtd: number | null;
}

export function FundKPIStrip({
  aum,
  return24h,
  returnMtd,
  returnYtd,
}: FundKPIStripProps) {
  const cells: Array<{
    label: string;
    value: string;
    color: string;
  }> = [
    {
      label: "Fund AUM",
      value: aum != null ? formatCurrency(aum) : "—",
      color: "text-text-primary",
    },
    {
      label: "24h",
      value: formatPercent(return24h),
      color: metricColor(return24h),
    },
    {
      label: "MTD",
      value: formatPercent(returnMtd),
      color: metricColor(returnMtd),
    },
    {
      label: "YTD",
      value: formatPercent(returnYtd),
      color: metricColor(returnYtd),
    },
  ];

  return (
    <section
      aria-label="Fund-level metrics"
      className="bg-surface border border-border rounded-lg overflow-hidden"
    >
      <div className="grid grid-cols-2 md:grid-cols-4 divide-y md:divide-y-0 md:divide-x divide-border">
        {cells.map((cell) => (
          <div key={cell.label} className="p-5 md:p-6">
            <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium">
              {cell.label}
            </p>
            <p
              className={`mt-1 text-2xl md:text-3xl font-bold font-metric tabular-nums ${cell.color}`}
            >
              {cell.value}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
