import { parseIsoDay, utcEpoch } from "@/lib/dateday";
import { cn } from "@/lib/utils";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import type { CoverageSpan, CoverageWindow } from "@/lib/scenario-window";

/**
 * CoverageTimeline (COVERAGE-01) — the collapsed-by-default mini-gantt.
 *
 * Presentation-only, tertiary disclosure surface (58-UI-SPEC §Interaction: the
 * BlendHeader is primary, chips secondary, this gantt tertiary). One horizontal
 * bar per SELECTED strategy plotted against the UNION date axis, with the active
 * `[winStart,winEnd]` window drawn as a shaded band overlay so "why did X drop?"
 * and "how much history keeps it?" read visually.
 *
 * Membership is threaded in (`inBlend` per row) from the SINGLE engine axis
 * (`coverageEligible`) — this component NEVER calls `covers()` locally, so the
 * gantt can never desync from the blend divisor (the coverageEligible↔
 * member_ids dev cross-check in ScenarioComposer reconciles the same axis).
 * Bars agree with the row chips by construction.
 *
 * Timezone rule (Pitfall 2 / H-1224): the date→x scale is built with
 * `utcEpoch(parseIsoDay(...))` ONLY — never a raw JS Date from an ISO string,
 * which reintroduces the UTC/local off-by-one `dateday.ts` exists to kill. A
 * single-day union is guarded against divide-by-zero (`span || 1`).
 *
 * WCAG-AA: color is never the sole signal — every bar carries an `aria-label`
 * restating coverage dates + membership as TEXT, and each row shows the strategy
 * name. Auto-excluded bars use the amber DESIGN.md warning tokens (transient-
 * recoverable), NEVER negative/red. No icons, no charting dependency, and NO
 * motion — the bars are static positioned divs (a static div-bar timeline needs
 * none of the three — Rule 2).
 */
export interface CoverageTimelineRow {
  id: string;
  name: string;
  /** The strategy's data coverage span, or null when it has no data. */
  span: CoverageSpan | null;
  /** In-blend (accent) when true; auto-excluded (amber) when false. */
  inBlend: boolean;
}

export interface CoverageTimelineProps {
  rows: CoverageTimelineRow[];
  /** The union of the selected set's spans — the x-axis extent. */
  unionWindow: CoverageWindow | null;
  /** The active `[winStart,winEnd]` window — drawn as a shaded band overlay. */
  activeWindow: CoverageWindow | null;
}

/** Clamp a percent to [0, 100] so a stray bound never overflows the track. */
function clampPct(p: number): number {
  if (!Number.isFinite(p)) return 0;
  return Math.max(0, Math.min(100, p));
}

export function CoverageTimeline({
  rows,
  unionWindow,
  activeWindow,
}: CoverageTimelineProps) {
  // Nothing to plot without rows or a union axis — render no panel (not an empty
  // collapsible shell) so the composer stays uncluttered.
  if (rows.length === 0 || !unionWindow) return null;

  const x0Day = parseIsoDay(unionWindow.start);
  const x1Day = parseIsoDay(unionWindow.end);
  if (!x0Day || !x1Day) return null;

  const x0 = utcEpoch(x0Day);
  const x1 = utcEpoch(x1Day);
  // Guard a single-day union (x1 === x0) against divide-by-zero (Pitfall 2).
  const span = x1 - x0 || 1;

  // Map an ISO day to a percent offset on the shared union axis. Returns null
  // for a malformed/absent day so the caller can skip a bad bound.
  const pctOf = (iso: string): number | null => {
    const day = parseIsoDay(iso);
    if (!day) return null;
    return ((utcEpoch(day) - x0) / span) * 100;
  };

  // The active-window band overlay position (accent-framed), if a window is set
  // and its bounds are plottable.
  let bandLeft: number | null = null;
  let bandWidth: number | null = null;
  if (activeWindow) {
    const l = pctOf(activeWindow.start);
    const r = pctOf(activeWindow.end);
    if (l != null && r != null) {
      bandLeft = clampPct(l);
      bandWidth = clampPct(r - l);
    }
  }

  return (
    <CollapsibleSection
      id="scenario-coverage-timeline"
      title="Coverage timeline"
      defaultOpen={false}
    >
      <div data-testid="scenario-coverage-timeline-body">
        <ul className="grid gap-1.5">
          {rows.map((row) => {
            const first = row.span?.first ?? null;
            const last = row.span?.last ?? null;
            const leftRaw = first != null ? pctOf(first) : null;
            const rightRaw = last != null ? pctOf(last) : null;
            const left =
              leftRaw != null ? clampPct(leftRaw) : 0;
            const width =
              leftRaw != null && rightRaw != null
                ? clampPct(rightRaw - leftRaw)
                : 0;

            // Each bar renders as ONE solid block — accent when in-blend,
            // amber when auto-excluded. The active window is conveyed by the
            // separate band overlay on the track, NOT by splitting the bar
            // into in-window/out-of-window slices.
            const membershipWord = row.inBlend ? "in blend" : "auto-excluded";
            const coverage =
              first != null && last != null
                ? `covers ${first}–${last}`
                : "no data";
            const ariaLabel = `${row.name}: ${coverage}, ${membershipWord}`;

            return (
              <li key={row.id} className="flex items-center gap-2">
                <span
                  className="w-32 shrink-0 truncate text-fixed-12 text-text-primary"
                  title={row.name}
                >
                  {row.name}
                </span>
                <div className="relative h-2 flex-1 rounded-sm bg-track">
                  {/* Active-window band overlay — a 1px accent frame at
                      [winStart,winEnd] on the shared axis. aria-hidden: the
                      band is decorative; membership is on the bar aria-label. */}
                  {bandLeft != null && bandWidth != null && (
                    <div
                      aria-hidden
                      className="absolute inset-y-0 rounded-sm border border-accent bg-accent/5"
                      style={{ left: `${bandLeft}%`, width: `${bandWidth}%` }}
                    />
                  )}
                  {/* The strategy's coverage bar. role="img" makes the div a
                      real accessibility node so the aria-label is actually
                      announced (a role-less div's label is ignored — the text
                      restatement would otherwise be color-only in practice).
                      The auto-excluded bar borders with the SOLID `warning`
                      amber (#B45309, ≥3:1 against the bg-track rail) — the
                      pale warning-border token is ~1:1 vs the rail there. */}
                  <div
                    data-testid={`coverage-bar-${row.id}`}
                    role="img"
                    aria-label={ariaLabel}
                    className={cn(
                      "absolute inset-y-0 rounded-sm",
                      row.inBlend
                        ? "bg-accent"
                        : "border border-warning bg-warning-bg",
                    )}
                    style={{ left: `${left}%`, width: `${width}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
        {/* Union axis endpoint date labels only (no interior ticks —
            58-RESEARCH Open Question 1). Timezone-free raw ISO strings. The
            leading spacer (w-32 + gap-2) aligns the labels under the bar track,
            matching the per-row name column. */}
        <div className="mt-2 flex items-center gap-2 text-fixed-11 font-mono tabular-nums text-text-muted">
          <span className="w-32 shrink-0" aria-hidden />
          <span className="flex flex-1 justify-between">
            <span>{unionWindow.start}</span>
            <span>{unionWindow.end}</span>
          </span>
        </div>
      </div>
    </CollapsibleSection>
  );
}
