import { MetricCell } from "./MetricCell";

interface BenchmarkGreeksTableProps {
  alpha: number | null;
  beta: number | null;
  ir: number | null;
  treynor: number | null;
}

/**
 * Phase 14b-05 / KPI-21 — Benchmark Greeks 4-cell strip.
 *
 * Composes MetricCell (Plan 14b-04 primitive) into a grid-cols-4 strip.
 * Cells in order: alpha / beta / IR / Treynor (UI-SPEC §10.4 case-sensitive
 * label convention — alpha/beta lowercase Greek; IR uppercase acronym;
 * Treynor title-case proper noun).
 *
 * Values render to 3 decimals via toFixed(3); null/NaN/Infinity render as
 * em-dash via MetricCell. Alpha/beta/Treynor receive negative=true when
 * < 0 (text-negative); IR is never sign-flagged because IR's
 * sign-convention varies by benchmark — we leave the visual to the value
 * itself rather than encode a contested rule here.
 */
export function BenchmarkGreeksTable({
  alpha,
  beta,
  ir,
  treynor,
}: BenchmarkGreeksTableProps) {
  return (
    <div className="grid grid-cols-4 gap-3">
      <div className="p-3"><MetricCell label="alpha" value={fmt(alpha)} negative={isNeg(alpha)} /></div>
      <div className="p-3"><MetricCell label="beta" value={fmt(beta)} negative={isNeg(beta)} /></div>
      <div className="p-3"><MetricCell label="IR" value={fmt(ir)} /></div>
      <div className="p-3"><MetricCell label="Treynor" value={fmt(treynor)} negative={isNeg(treynor)} /></div>
    </div>
  );
}

function fmt(v: number | null): string | null {
  if (v == null || !Number.isFinite(v)) return null;
  return v.toFixed(3);
}

function isNeg(v: number | null): boolean {
  return v != null && Number.isFinite(v) && v < 0;
}
