"use client";

import { usePayload } from "./factsheet-context";

/**
 * Named market-stress windows — how the strategy fared during specific
 * catastrophes (FTX, SVB, COVID, TerraLuna, etc.). Allocators want to see
 * tail-event behavior, not just headline DDs. Windows outside the observed
 * series are dropped server-side.
 */
export function StressWindowsPanel() {
  const payload = usePayload();
  const { windows, benchName, totalCatalogued, droppedOutOfRange, droppedPartial } = payload.stressWindows;
  // Honest empty state when nothing in our catalogue overlaps the observation
  // window — better to render a one-liner than silently disappear.
  if (windows.length === 0) {
    if (totalCatalogued === 0) return null;
    return (
      <figure className="flex flex-col gap-2">
        <header>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-text-primary">
            Stress Windows
          </h3>
          <p className="text-[11px] text-text-muted">
            All {totalCatalogued} catalogued stress windows for this asset class occurred outside this
            strategy&apos;s observation period — none can be evaluated.
          </p>
        </header>
      </figure>
    );
  }
  return (
    <figure
      className="flex flex-col gap-2"
      style={{ contentVisibility: "auto", containIntrinsicSize: `auto ${windows.length * 36 + 100}px` }}
    >
      <header>
        <h3 className="text-sm font-semibold uppercase tracking-wider text-text-primary">
          Stress Windows
        </h3>
        <p className="text-[11px] text-text-muted">
          strategy vs {benchName} compounded return + max drawdown during named market events
          {(droppedOutOfRange > 0 || droppedPartial > 0) && (
            <>
              {" "}· evaluating {windows.length} of {totalCatalogued} catalogued events
              {droppedOutOfRange > 0 && `; ${droppedOutOfRange} outside observation period`}
              {droppedPartial > 0 && `; ${droppedPartial} dropped (coverage too partial to label honestly)`}
            </>
          )}
        </p>
      </header>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-b border-text">
            <th className="py-1.5 pr-2 text-left font-mono text-[9px] uppercase tracking-[0.14em] text-text-muted">
              Event
            </th>
            <th className="py-1.5 px-2 text-left font-mono text-[9px] uppercase tracking-[0.14em] text-text-muted">
              Window
            </th>
            <th className="py-1.5 px-2 text-right font-mono text-[9px] uppercase tracking-[0.14em] text-text-muted">
              Days
            </th>
            <th className="py-1.5 px-2 text-right font-mono text-[9px] uppercase tracking-[0.14em] text-text-muted">
              Strategy
            </th>
            <th className="py-1.5 px-2 text-right font-mono text-[9px] uppercase tracking-[0.14em] text-text-muted">
              Strat DD
            </th>
            <th className="py-1.5 px-2 text-right font-mono text-[9px] uppercase tracking-[0.14em] text-text-muted">
              {benchName}
            </th>
            <th className="py-1.5 pl-2 text-right font-mono text-[9px] uppercase tracking-[0.14em] text-text-muted">
              {benchName} DD
            </th>
          </tr>
        </thead>
        <tbody>
          {windows.map(w => (
            <tr key={w.name} className="border-b border-border/30 last:border-0">
              <td className="py-1.5 pr-2">
                <div className="font-medium text-text-primary">
                  {w.name}
                  {w.coverage === "partial" && (
                    <span
                      className="ml-1.5 inline-block px-1 py-px text-[9px] uppercase font-mono tracking-wider rounded-sm"
                      style={{ backgroundColor: "var(--color-surface-subtle)", color: "var(--color-warning)" }}
                      title={`Observed ${w.days} of ${w.expectedCalendarDays} expected days`}
                    >
                      partial
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-text-muted">{w.note}</div>
              </td>
              <td className="py-1.5 px-2 font-mono tabular-nums text-text-2 whitespace-nowrap">
                {w.start.slice(0, 10)} → {w.end.slice(0, 10)}
              </td>
              <td className="py-1.5 px-2 text-right font-mono tabular-nums text-text-2">
                {w.days}d{w.coverage === "partial" && <span className="text-text-muted">/{w.expectedCalendarDays}</span>}
              </td>
              <td
                className="py-1.5 px-2 text-right font-mono tabular-nums"
                style={{ color: w.stratReturn >= 0 ? "var(--color-positive)" : "var(--color-negative)" }}
              >
                {pctSigned(w.stratReturn)}
              </td>
              <td className="py-1.5 px-2 text-right font-mono tabular-nums" style={{ color: "var(--color-negative)" }}>
                {pct(w.stratMaxDD)}
              </td>
              <td
                className="py-1.5 px-2 text-right font-mono tabular-nums"
                style={{ color: w.benchReturn >= 0 ? "var(--color-positive)" : "var(--color-negative)" }}
              >
                {pctSigned(w.benchReturn)}
              </td>
              <td className="py-1.5 pl-2 text-right font-mono tabular-nums" style={{ color: "var(--color-negative)" }}>
                {pct(w.benchMaxDD)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

function pctSigned(v: number): string {
  if (!Number.isFinite(v)) return "—";
  return (v >= 0 ? "+" : "") + (v * 100).toFixed(1) + "%";
}
function pct(v: number): string {
  if (!Number.isFinite(v)) return "—";
  return (v * 100).toFixed(1) + "%";
}
