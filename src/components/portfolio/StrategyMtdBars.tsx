import { formatPercent } from "@/lib/utils";

/**
 * MTD Return by Strategy — horizontal bar chart for the My Allocation
 * dashboard.
 *
 * Pure CSS/flex implementation (no Recharts dependency). Each row is a
 * strategy name + a bar whose width is proportional to the absolute MTD
 * return, plus the formatted percentage on the right. Positive bars are
 * teal (accent #1B6B5A / 70% opacity), negative bars are muted red
 * (#DC2626 / 60% opacity). A single shared center line anchors both
 * sides on the same scale so the allocator can eyeball "biggest winner
 * vs biggest loser" without squinting at axis labels.
 *
 * Hairline divider pattern to match the rest of the dashboard — no card
 * border, no drop shadow. The section header sits above the bars with
 * the DESIGN.md uppercase-micro-label treatment.
 */

interface StrategyMtdBarsRow {
  strategy_id: string;
  strategy_name: string;
  return_mtd: number | null;
}

interface StrategyMtdBarsProps {
  rows: StrategyMtdBarsRow[];
}

export function StrategyMtdBars({ rows }: StrategyMtdBarsProps) {
  // Scale bars to the largest absolute return in the row set so the
  // biggest mover anchors the visual.
  const maxAbs =
    rows.reduce((max, r) => {
      if (r.return_mtd == null) return max;
      const abs = Math.abs(r.return_mtd);
      return abs > max ? abs : max;
    }, 0) || 0.01; // avoid div-by-zero on empty / all-null rows

  // Sort by return_mtd DESC so winners are on top, losers on the bottom.
  // null returns fall to the bottom.
  const sorted = [...rows].sort((a, b) => {
    if (a.return_mtd == null && b.return_mtd == null) return 0;
    if (a.return_mtd == null) return 1;
    if (b.return_mtd == null) return -1;
    return b.return_mtd - a.return_mtd;
  });

  if (sorted.length === 0) {
    return (
      <section aria-label="MTD return by strategy" className="space-y-3">
        <h2 className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">
          MTD Return by Strategy
        </h2>
        <p className="text-sm text-text-muted">No strategies in your book.</p>
      </section>
    );
  }

  return (
    <section aria-label="MTD return by strategy" className="space-y-3">
      <h2 className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">
        MTD Return by Strategy
      </h2>
      <div className="bg-surface border border-border rounded-lg p-5 md:p-6">
        <div className="space-y-3">
          {sorted.map((row) => {
            const r = row.return_mtd;
            const absPct = r != null ? Math.abs(r) / maxAbs : 0;
            const widthPct = Math.min(100, absPct * 50); // half-width each side of center
            const isPositive = r != null && r >= 0;
            return (
              <div
                key={row.strategy_id}
                className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_5rem] items-center gap-3"
              >
                <p className="text-sm text-text-primary truncate" title={row.strategy_name}>
                  {row.strategy_name}
                </p>
                <div className="relative h-5 flex items-center">
                  {/* center axis line */}
                  <div className="absolute inset-y-0 left-1/2 w-px bg-border" aria-hidden="true" />
                  {r != null && (
                    <div
                      className={`absolute top-1 bottom-1 rounded-sm ${
                        isPositive ? "bg-accent/70" : "bg-negative/60"
                      }`}
                      style={{
                        left: isPositive ? "50%" : `${50 - widthPct}%`,
                        width: `${widthPct}%`,
                      }}
                      aria-hidden="true"
                    />
                  )}
                </div>
                <p
                  className={`text-sm font-metric tabular-nums text-right ${
                    r == null
                      ? "text-text-muted"
                      : isPositive
                        ? "text-positive"
                        : "text-negative"
                  }`}
                >
                  {formatPercent(r)}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
