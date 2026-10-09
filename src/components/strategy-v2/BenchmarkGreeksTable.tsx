import { MetricCell } from "./MetricCell";
import { fmtNum2, fmtSignedPct2 } from "./format";

interface BenchmarkGreeksTableProps {
  alpha: number | null;
  beta: number | null;
  /** Optional so callers that do not carry it keep compiling; absent reads as a dash. */
  correlation?: number | null;
  ir: number | null;
  treynor: number | null;
  /** One line naming why a cell is a dash (`greeksReason`); omitted when no cell is. */
  reason?: string | null;
}

/**
 * Benchmark greeks 5-cell strip (Phase 170.5, D-07).
 *
 * The five figures are the factsheet's own (the same TypeScript joint, so both
 * pages print one number): alpha (ann), beta, correlation, IR, Treynor, in the
 * factsheet's order. Correlation is a cell here, not a line in the
 * "Correlation with BTC" sub-section, because that sub-section draws the 90-day
 * ROLLING series, a different quantity.
 *
 * Digits come from `format.ts`: alpha as a signed percent to 2 dp, the others
 * to 2 dp, the factsheet's digits. A null, NaN or infinite value is `null`, which
 * MetricCell prints as the em dash (never 0). The tone is taken from the ROUNDED
 * printed value (DESIGN Numbers Contract): -0.004 prints 0.00 and is neutral.
 * IR is never sign-flagged because its sign convention varies by benchmark.
 *
 * `reason` renders as one line under the strip so no dash stands alone. The grid
 * stays the first child; the line is its sibling.
 */
export function BenchmarkGreeksTable({
  alpha,
  beta,
  correlation,
  ir,
  treynor,
  reason,
}: BenchmarkGreeksTableProps) {
  const a = fmtSignedPct2(alpha);
  const b = fmtNum2(beta);
  const c = fmtNum2(correlation);
  const i = fmtNum2(ir);
  const t = fmtNum2(treynor);
  return (
    <>
      <div className="grid grid-cols-5 gap-3 max-md:grid-cols-3">
        <div className="p-3"><MetricCell label="alpha (ann)" value={a?.text ?? null} negative={a?.negative ?? false} /></div>
        <div className="p-3"><MetricCell label="beta" value={b?.text ?? null} negative={b?.negative ?? false} /></div>
        <div className="p-3"><MetricCell label="correlation" value={c?.text ?? null} negative={c?.negative ?? false} /></div>
        <div className="p-3"><MetricCell label="IR" value={i?.text ?? null} /></div>
        <div className="p-3"><MetricCell label="Treynor" value={t?.text ?? null} negative={t?.negative ?? false} /></div>
      </div>
      {reason ? (
        <p className="mt-2 text-xs font-normal text-text-muted" data-testid="greeks-reason">
          {reason}
        </p>
      ) : null}
    </>
  );
}
