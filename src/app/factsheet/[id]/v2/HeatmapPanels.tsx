"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { usePayload, useToggles } from "./factsheet-context";
import { useBasisSeriesView } from "./basis-context";
import { resolvePalette } from "./palette";
import { useBreakpoint } from "@/hooks/useBreakpoint";
import { useTapPin } from "@/hooks/useTapPin";
import type { DailyHeatmapYear, MonthlyReturnsRow } from "@/lib/factsheet/types";

/** Resolve the heatmap mixing trio from the central palette. */
function useHeatmapBase(): { base: string; accent: string; negative: string } {
  const { darkMode, colorblind } = useToggles();
  const p = resolvePalette({ darkMode, colorblind });
  return { base: p.base, accent: p.accent, negative: p.negative };
}

/**
 * Two return-distribution heatmaps:
 *
 *   - MonthlyReturnsHeatmap: dense year × month grid with a YTD trailing column.
 *     Color-coded cells with the percentage label inside. 9px Geist Mono, weight
 *     500, tight padding — readable for screen + photographs-of-screen alike.
 *
 *   - DailyReturnsHeatmap: GitHub-contributions style 7-row × 53-col mini-calendar
 *     per year, stacked vertically. Each cell colored by daily-return magnitude.
 *     No text in cells — density is the message. Hover title for the raw value.
 *
 * Both share `tintFor()` for the diverging color scale (teal positives,
 * negative-red negatives, neutral surface around zero). Magnitude clamps to the
 * 5th/95th percentile so a single outlier day doesn't wash the scale.
 */

const MONTH_HEADERS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/* -------------------- Monthly heatmap -------------------- */

export function MonthlyReturnsHeatmap() {
  // Phase 103 (MTM-04): the monthly grid is a pure function of the strategy's own
  // daily series → follows the active basis. Cash view === payload (byte-identical).
  const view = useBasisSeriesView(usePayload());
  const rows = view.monthlyReturns;
  const maxAbs = useMemo(() => percentileOfAbs(rows), [rows]);
  const palette = useHeatmapBase();
  if (rows.length === 0) return null;

  return (
    <figure
      className="flex flex-col gap-2"
      style={{ contentVisibility: "auto", containIntrinsicSize: `auto ${rows.length * 28 + 100}px` }}
    >
      <header>
        <h3 className="text-sm font-semibold uppercase tracking-wider text-text-primary">
          Monthly Returns
        </h3>
        <p className="text-micro text-text-muted">
          compounded monthly returns · YTD on the right · color scale clamped to ±{(maxAbs * 100).toFixed(0)}%
        </p>
      </header>

      {/* Focusable labeled scroll region (ResponsiveTable idiom) — same
          scrollable-region-focusable class as the daily calendar below. */}
      <div
        className="overflow-x-auto"
        role="region"
        aria-label="Monthly returns: table scrolls horizontally. Swipe or use arrow keys to see more columns."
        tabIndex={0}
      >
        <table className="w-full border-separate" style={{ borderSpacing: 2, fontFamily: "var(--font-mono)" }}>
          <colgroup>
            <col style={{ width: 44 }} />
            {MONTH_HEADERS.map(m => <col key={m} />)}
            <col style={{ width: 56 }} />
          </colgroup>
          <thead>
            <tr>
              <th className="text-left py-1 px-1 text-micro uppercase tracking-[0.18em] font-medium text-text-muted">
                Year
              </th>
              {MONTH_HEADERS.map(m => (
                <th
                  key={m}
                  className="text-center py-1 text-micro uppercase tracking-[0.12em] font-medium text-text-muted"
                >
                  {m}
                </th>
              ))}
              <th className="text-right py-1 px-1 text-micro uppercase tracking-[0.18em] font-medium text-text-muted">
                YTD
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => <MonthlyRow key={r.year} row={r} maxAbs={maxAbs} palette={palette} />)}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

function MonthlyRow({ row, maxAbs, palette }: { row: MonthlyReturnsRow; maxAbs: number; palette: { base: string; accent: string; negative: string } }) {
  return (
    <tr>
      <td className="text-left text-micro tabular-nums text-text-primary pr-1">{row.year}</td>
      {row.byMonth.map((v, i) => {
        if (v == null) {
          return (
            <td
              key={i}
              className="text-center text-micro"
              style={{
                background: "var(--color-surface-subtle, #FBFCFD)",
                color: "var(--color-text-muted)",
                height: 22,
                fontWeight: 500,
              }}
              title={`${row.year}-${String(i + 1).padStart(2, "0")}: no data`}
            >
              ·
            </td>
          );
        }
        const tint = tintFor(v, maxAbs, palette);
        return (
          <td
            key={i}
            className="text-center text-micro tabular-nums"
            style={{
              background: tint.bg,
              color: tint.fg,
              height: 22,
              fontWeight: 500,
            }}
            title={`${row.year}-${String(i + 1).padStart(2, "0")}: ${formatPct(v, 2)}`}
          >
            {formatPctShort(v)}
          </td>
        );
      })}
      <td
        className="text-right text-micro tabular-nums pl-1 pr-1"
        style={{
          color: row.ytd >= 0 ? "var(--color-positive)" : "var(--color-negative)",
          fontWeight: 600,
        }}
      >
        {formatPct(row.ytd, 1)}
      </td>
    </tr>
  );
}

/* -------------------- Daily heatmap -------------------- */

const CELL = 12;
const CELL_GAP = 2;
const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"] as const;
const SHOW_DAY_LABEL = [true, false, true, false, true, false, false] as const;

export function DailyReturnsHeatmap() {
  // Phase 103 (MTM-04): per-basis daily calendar (own daily series). Cash === payload.
  const view = useBasisSeriesView(usePayload());
  const years = view.dailyHeatmap;
  const palette = useHeatmapBase();
  const maxAbs = useMemo(() => {
    const vals: number[] = [];
    for (const y of years) for (const week of y.cells) for (const v of week) if (v != null && Number.isFinite(v)) vals.push(Math.abs(v));
    if (vals.length === 0) return 0.01;
    vals.sort((a, b) => a - b);
    return Math.max(0.0001, vals[Math.floor(0.95 * vals.length)]);
  }, [years]);
  if (years.length === 0) return null;

  return (
    <figure
      className="flex flex-col gap-3"
      style={{ contentVisibility: "auto", containIntrinsicSize: `auto ${years.length * 200 + 100}px` }}
    >
      <header>
        <h3 className="text-sm font-semibold uppercase tracking-wider text-text-primary">
          Daily Returns Calendar
        </h3>
        <p className="text-micro text-text-muted">
          one cell per trading day · color scale clamped to ±{(maxAbs * 100).toFixed(1)}% · hover or tap any cell for value
        </p>
      </header>

      {/* overflow-x-auto on the year stack: on narrow viewports cells stay
          legible (each row keeps its natural ≥530px width) and the user
          horizontally scrolls. -webkit-overflow-scrolling for smooth iOS.
          Focusable labeled region (the ResponsiveTable idiom): a genuinely
          scrollable box with no focusable children fails axe
          scrollable-region-focusable (serious) — first hit in CI run
          28609918423 once a real seeded series made the stack overflow. */}
      <div
        className="flex flex-col gap-4 -mx-2 px-2 overflow-x-auto"
        style={{ WebkitOverflowScrolling: "touch" }}
        role="region"
        aria-label="Daily returns calendar: scrolls horizontally. Swipe or use arrow keys to see more days."
        tabIndex={0}
      >
        {years.map(y => <YearCalendar key={y.year} year={y} maxAbs={maxAbs} palette={palette} />)}
      </div>

      <DailyHeatmapLegend maxAbs={maxAbs} palette={palette} />
    </figure>
  );
}

function YearCalendar({ year, maxAbs, palette }: { year: DailyHeatmapYear; maxAbs: number; palette: { base: string; accent: string; negative: string } }) {
  const cols = year.cells.length;
  const labelW = 14;
  const monthLabelH = 14;
  const w = labelW + cols * (CELL + CELL_GAP);
  const h = monthLabelH + 7 * (CELL + CELL_GAP);

  // Month labels — place each at the first column where that month appears.
  const monthLabels = useMemo(() => {
    const out: { col: number; label: string }[] = [];
    let lastMonth = -1;
    for (let w = 0; w < year.cells.length; w++) {
      for (let d = 0; d < 7; d++) {
        // Reverse-engineer the date from week+day+firstWeekOffset.
        const doy = w * 7 + d - year.firstWeekOffset + 1;
        if (doy < 1 || doy > 366) continue;
        const dt = new Date(Date.UTC(parseInt(year.year, 10), 0, doy));
        const m = dt.getUTCMonth();
        if (m !== lastMonth) {
          out.push({ col: w, label: MONTH_HEADERS[m] });
          lastMonth = m;
          break;
        }
      }
    }
    return out;
  }, [year]);

  return (
    <YearCalendarCanvas
      year={year}
      maxAbs={maxAbs}
      palette={palette}
      w={w}
      h={h}
      labelW={labelW}
      monthLabelH={monthLabelH}
      monthLabels={monthLabels}
    />
  );
}

/**
 * Canvas-rendered year calendar. Draws ~250 colored cells in a single
 * 2D-context loop instead of mounting ~250 SVG <rect> nodes per year.
 * Month + weekday labels stay as an SVG overlay so they get var-fonts +
 * CSS-token colors for free.
 *
 * Hover handling: pointermove → compute (week, weekday) from x/y → set
 * the React `hovered` state. A small floating div renders the tooltip
 * positioned at the cell's pixel center. Native `<title>` tooltips don't
 * exist on canvas so we own this surface.
 */
function YearCalendarCanvas({
  year,
  maxAbs,
  palette,
  w,
  h,
  labelW,
  monthLabelH,
  monthLabels,
}: {
  year: DailyHeatmapYear;
  maxAbs: number;
  palette: { base: string; accent: string; negative: string };
  w: number;
  h: number;
  labelW: number;
  monthLabelH: number;
  monthLabels: { col: number; label: string }[];
}) {
  const isMobile = useBreakpoint() === "mobile";
  // Mobile legibility (CHART-02): bump the month/weekday overlay label font from
  // its desktop literals (9 / 8) so it clears the floor at 320px. Desktop arm =
  // today's literals → desktop render byte-identical.
  const monthFont = isMobile ? 13 : 9;
  const dayFont = isMobile ? 12 : 8;

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scale, setScale] = useState(1); // CSS px per logical viewBox unit
  const [hovered, setHovered] = useState<{ cx: number; cy: number; iso: string; v: number } | null>(null);

  // Track wrapper width via ResizeObserver so the canvas scales responsively
  // while keeping crisp pixels at any devicePixelRatio.
  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const cssW = entry.contentRect.width;
        if (cssW > 0) setScale(cssW / w);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [w]);

  // Pre-compute fillStyle per cell so the redraw effect on every resize
  // doesn't run hex parse + RGB mix (tintFor) on ~378 × N years cells.
  const tintGrid = useMemo(() => {
    const grid: (string | null)[][] = [];
    for (let wk = 0; wk < year.cells.length; wk++) {
      const row: (string | null)[] = [];
      for (let d = 0; d < 7; d++) {
        const v = year.cells[wk][d];
        row.push(v == null ? null : tintFor(v, maxAbs, palette).bg);
      }
      grid.push(row);
    }
    return grid;
  }, [year, maxAbs, palette]);

  // Draw whenever year data, palette, scale, or tintGrid change.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const cssW = w * scale;
    const cssH = h * scale;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr * scale, dpr * scale);
    ctx.clearRect(0, 0, w, h);
    const missingFill = palette.base === "#FFFFFF" ? "#FBFCFD" : "#243044";
    const missingStroke = palette.base === "#FFFFFF" ? "#E2E8F0" : "#334155";
    for (let wk = 0; wk < tintGrid.length; wk++) {
      const row = tintGrid[wk];
      for (let d = 0; d < 7; d++) {
        const bg = row[d];
        const x = labelW + wk * (CELL + CELL_GAP);
        const y = monthLabelH + d * (CELL + CELL_GAP);
        if (bg == null) {
          ctx.fillStyle = missingFill;
          ctx.fillRect(x, y, CELL, CELL);
          ctx.strokeStyle = missingStroke;
          ctx.lineWidth = 0.5;
          ctx.strokeRect(x + 0.25, y + 0.25, CELL - 0.5, CELL - 0.5);
          continue;
        }
        ctx.fillStyle = bg;
        ctx.fillRect(x, y, CELL, CELL);
      }
    }
  }, [tintGrid, palette, scale, w, h, labelW, monthLabelH]);

  // Map a pointer position (relative to the wrapper rect) to its (week, weekday)
  // grid coordinate. The single source of the coord→grid math, shared by the
  // hover lookup (cellAt) AND the touch tap path (pointerToIndex) so they can't
  // drift on the gutter/scale arithmetic.
  const coordToCell = (clientX: number, clientY: number, rect: DOMRect): { wk: number; d: number } => {
    const xPx = (clientX - rect.left) / scale;
    const yPx = (clientY - rect.top) / scale;
    return {
      wk: Math.floor((xPx - labelW) / (CELL + CELL_GAP)),
      d: Math.floor((yPx - monthLabelH) / (CELL + CELL_GAP)),
    };
  };

  // Map a (week, weekday) coordinate to the cell's tooltip payload, reading the
  // value straight from the precomputed `year.cells` (NEVER recomputed) and
  // deriving the pixel center + ISO date. The single source of the grid→payload
  // math, shared by BOTH the desktop mouse hover (cellAt) AND the touch tap-pin
  // path (pinnedCell) so they reveal identical content and can't drift.
  const cellPayload = (
    wk: number,
    d: number,
  ): { cx: number; cy: number; iso: string; v: number } | null => {
    if (wk < 0 || wk >= year.cells.length || d < 0 || d >= 7) return null;
    const v = year.cells[wk]?.[d];
    if (v == null) return null;
    const doy = wk * 7 + d - year.firstWeekOffset + 1;
    const dt = new Date(Date.UTC(parseInt(year.year, 10), 0, doy));
    if (Number.isNaN(dt.getTime())) return null;
    const iso = dt.toISOString().slice(0, 10);
    const cx = (labelW + wk * (CELL + CELL_GAP) + CELL / 2) * scale;
    const cy = (monthLabelH + d * (CELL + CELL_GAP) + CELL / 2) * scale;
    return { cx, cy, iso, v };
  };

  // Desktop mouse hover path: pointer position → grid coord → payload.
  const cellAt = (clientX: number, clientY: number, rect: DOMRect) => {
    const { wk, d } = coordToCell(clientX, clientY, rect);
    return cellPayload(wk, d);
  };

  // Pointer hover → cell lookup (desktop mouse path, unchanged behaviour).
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = wrapRef.current;
    if (!el) return;
    setHovered(cellAt(e.clientX, e.clientY, el.getBoundingClientRect()));
  };

  const onPointerLeave = () => setHovered(null);

  // Touch tap-reveal/pin (CHART-01a): the shared hook owns slop/time/touch-only/
  // re-tap/leave; `pointerToIndex` returns the flat cell index (wk*7+d) so the
  // hook can clamp/round it. The reveal reuses the existing floating tooltip
  // content. `selectedIdx` un-pins (null) on a tap off-grid. Desktop mouse hover
  // is untouched (the hook only fires for pointerType "touch").
  const COLS = year.cells.length;
  // The hook's pointer handlers are aliased (tap*) because this component already
  // owns local mouse onPointerMove/onPointerLeave that it composes with the touch
  // ones; setChartEl (a callback ref) is attached to the wrapper div via setWrap.
  const {
    selectedIdx,
    setChartEl,
    onPointerDown: tapPointerDown,
    onPointerMove: tapPointerMove,
    onPointerUp: tapPointerUp,
    onPointerLeave: tapPointerLeave,
  } = useTapPin({
    count: COLS * 7,
    pointerToIndex: (clientX, clientY, rect) => {
      // Reuse the shared coord→grid math; return the flat index only for a real
      // (populated, in-range) cell so the hook's re-tap/clamp logic operates on
      // a valid index. An off-grid tap returns null (un-pins).
      const { wk, d } = coordToCell(clientX, clientY, rect);
      return cellPayload(wk, d) == null ? null : wk * 7 + d;
    },
  });

  // Resolve the pinned cell's tooltip payload from the hook's selectedIdx via
  // the SAME cellPayload derivation as the hover path (no recompute, no drift).
  const pinnedCell =
    selectedIdx == null
      ? null
      : cellPayload(Math.floor(selectedIdx / 7), selectedIdx % 7);

  // Point both refs at the wrapper div: wrapRef (this component's own, for the
  // ResizeObserver + mouse-hover rect) and the hook's chart element (via its
  // setChartEl callback ref, so the tap path reads getBoundingClientRect off the
  // same node). Memoised so the ref doesn't detach/reattach every render. The
  // div is runtime-safe — the hook only calls getBoundingClientRect, which divs
  // expose.
  const setWrap = useCallback(
    (el: HTMLDivElement | null) => {
      wrapRef.current = el;
      setChartEl(el);
    },
    [setChartEl],
  );

  // Compose: run the existing mouse handler AND the hook handler.
  const asSvg = (h: (e: ReactPointerEvent<SVGSVGElement>) => void) =>
    h as unknown as (e: React.PointerEvent<HTMLDivElement>) => void;
  const composedMove = (e: React.PointerEvent<HTMLDivElement>) => {
    onPointerMove(e);
    asSvg(tapPointerMove)(e);
  };
  const composedLeave = (e: React.PointerEvent<HTMLDivElement>) => {
    onPointerLeave();
    asSvg(tapPointerLeave)(e);
  };

  // The reveal shows the pinned cell (touch) when present, else the transient
  // mouse-hover cell. Identical tooltip content either way.
  const reveal = pinnedCell ?? hovered;

  return (
    <div className="flex items-start gap-3">
      <div className="font-mono text-micro tabular-nums text-text-primary pt-[14px] flex-shrink-0" style={{ minWidth: 38 }}>
        {year.year}
      </div>
      <div
        ref={setWrap}
        // minWidth = w forces the canvas to render at natural size; the
        // parent <div className="overflow-x-auto"> on the year stack lets the
        // user pan when the viewport is too narrow. Floors cell size at the
        // 12px design value instead of shrinking to ~6px on mobile.
        // The whole calendar is the touch tap surface; a tap maps to the
        // nearest cell via `pointerToIndex`/`coordToCell` (Math.floor over the
        // 14px grid; `cellAt` is the desktop mouse-hover path). On
        // pointer-coarse the interaction layer is floored at ≥44px (WCAG 2.5.5)
        // — it already exceeds that via `h*scale` (7 rows × 14px + gutter), the
        // class makes the touch-target contract explicit without resizing cells.
        className="flex-1 relative pointer-coarse:min-h-[44px]"
        style={{ height: h * scale, minWidth: w, touchAction: "pan-y" }}
        onPointerDown={asSvg(tapPointerDown)}
        onPointerMove={composedMove}
        onPointerUp={asSvg(tapPointerUp)}
        onPointerLeave={composedLeave}
        role="img"
        aria-label={`Daily-return calendar for ${year.year}`}
      >
        <canvas ref={canvasRef} style={{ display: "block", position: "absolute", top: 0, left: 0 }} />
        {/* SVG overlay for labels — light DOM (just text nodes), so var-fonts and tokens work. */}
        <svg
          viewBox={`0 0 ${w} ${h}`}
          preserveAspectRatio="xMidYMid meet"
          aria-hidden
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
        >
          {monthLabels.map(ml => (
            <text
              key={`m-${ml.col}-${ml.label}`}
              x={labelW + ml.col * (CELL + CELL_GAP)}
              y={10}
              fontSize={monthFont}
              fontFamily="var(--font-mono)"
              fill="var(--color-text-muted)"
            >
              {ml.label}
            </text>
          ))}
          {DAY_LABELS.map((d, i) => SHOW_DAY_LABEL[i] && (
            <text
              key={`d-${i}`}
              x={0}
              y={monthLabelH + i * (CELL + CELL_GAP) + 8}
              fontSize={dayFont}
              fontFamily="var(--font-mono)"
              fill="var(--color-text-muted)"
            >
              {d}
            </text>
          ))}
        </svg>
        {/* Reveal tooltip — positioned in CSS px so it tracks the scaled canvas.
            Renders the touch-pinned cell when present, else the transient
            mouse-hover cell. Identical content + styling either way (no new
            accent surface). */}
        {reveal && (
          <div
            role="status"
            className="pointer-events-none absolute z-10 px-2 py-1 text-micro font-mono tabular-nums rounded-sm border whitespace-nowrap"
            style={{
              left: reveal.cx + 8,
              top: reveal.cy - 24,
              background: "var(--color-surface)",
              borderColor: "var(--color-border)",
              color: "var(--color-text-primary)",
              boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
            }}
          >
            <span className="text-text-muted mr-1">{reveal.iso}</span>
            <span style={{ color: reveal.v >= 0 ? "var(--color-positive)" : "var(--color-negative)", fontWeight: 600 }}>
              {formatPct(reveal.v, 2)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function DailyHeatmapLegend({ maxAbs, palette }: { maxAbs: number; palette: { base: string; accent: string; negative: string } }) {
  const stops = [-1, -0.5, -0.25, 0, 0.25, 0.5, 1];
  return (
    <div className="mt-2 flex items-center gap-2 text-micro font-mono uppercase tracking-wider text-text-muted">
      <span>{formatPct(-maxAbs, 1)}</span>
      <div className="flex">
        {stops.map(s => {
          const tint = tintFor(s * maxAbs, maxAbs, palette);
          return <span key={s} className="inline-block" style={{ width: 14, height: 10, background: tint.bg }} />;
        })}
      </div>
      <span>{formatPct(maxAbs, 1)}</span>
    </div>
  );
}

/* -------------------- Shared color/format helpers -------------------- */

/**
 * Diverging color scale: teal for positives, red for negatives, near-white at
 * zero. `maxAbs` is the clamping magnitude (typically the 95th-percentile |v|
 * of the dataset, so a single outlier doesn't wash everything else).
 *
 * Returns both background and a foreground chosen by COMPUTED WCAG contrast
 * (not an intensity threshold): the mid-saturation band of the mix curve
 * (a ≈ 0.55–0.95 toward #DC2626) is too light for white text at 4.5:1 —
 * axe measured 3.62:1 on a −19% month cell (CI run 28608544275), a latent
 * violation the golden fixtures' near-zero cells never exercised. When
 * NEITHER candidate passes (a narrow luminance dead zone), the cell deepens
 * toward the full palette color until one does, so pixels only change where
 * AA was already being violated.
 *
 * Exported for the colocated contrast-sweep regression test only.
 */
export function tintFor(
  v: number,
  maxAbs: number,
  palette: { base: string; accent: string; negative: string } = { base: "#FFFFFF", accent: "#1B6B5A", negative: "#DC2626" },
): { bg: string; fg: string } {
  if (maxAbs <= 0 || !Number.isFinite(v)) return { bg: "var(--color-surface-subtle, #FBFCFD)", fg: "var(--color-text-muted)" };
  const t = Math.max(-1, Math.min(1, v / maxAbs));
  // Foreground candidates: text-primary-ish for low-intensity cells (legible
  // on near-base bg), base color (white in light, slate in dark) for
  // high-intensity cells.
  const isDark = palette.base !== "#FFFFFF";
  const lowFg = isDark ? "#F1F5F9" : "#1A1A2E";
  const highFg = palette.base === "#FFFFFF" ? "#FFFFFF" : "#0F172A";
  if (t === 0) return { bg: palette.base, fg: "var(--color-text-muted)" };
  const target = t > 0 ? palette.accent : palette.negative;
  let a = Math.pow(Math.abs(t), 0.75);
  // AA floor (heatmap labels are text-micro/normal → 4.5:1 required). Deepen
  // the mix — bounded, terminal: at a=1 the full accent/negative passes with
  // at least one candidate in both light and dark palettes — until the
  // better-contrast candidate clears the floor, then use that candidate.
  for (let i = 0; i < 8; i++) {
    const bg = mixHex(palette.base, target, a);
    const cLow = contrastRatio(bg, lowFg);
    const cHigh = contrastRatio(bg, highFg);
    const fg = cHigh >= cLow ? highFg : lowFg;
    if (Math.max(cLow, cHigh) >= 4.5 || a >= 1) return { bg, fg };
    a = Math.min(1, a + 0.08);
  }
  // Unreachable (a hits 1 within the loop), kept for type-narrowing honesty.
  return { bg: mixHex(palette.base, target, 1), fg: highFg };
}

/** WCAG 2.x relative luminance of an sRGB color ("#RRGGBB" or "rgb(r, g, b)"). */
function relativeLuminance(color: string): number {
  const [r, g, b] = color.startsWith("rgb")
    ? (color.match(/\d+/g)?.map(Number) as [number, number, number])
    : parseHex(color);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 2.x contrast ratio between two sRGB colors. */
function contrastRatio(c1: string, c2: string): number {
  const l1 = relativeLuminance(c1);
  const l2 = relativeLuminance(c2);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

function mixHex(a: string, b: string, t: number): string {
  const pa = parseHex(a);
  const pb = parseHex(b);
  const r = Math.round(pa[0] + (pb[0] - pa[0]) * t);
  const g = Math.round(pa[1] + (pb[1] - pa[1]) * t);
  const bl = Math.round(pa[2] + (pb[2] - pa[2]) * t);
  return `rgb(${r}, ${g}, ${bl})`;
}

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function percentileOfAbs(rows: MonthlyReturnsRow[]): number {
  const vals: number[] = [];
  for (const r of rows) for (const v of r.byMonth) if (v != null && Number.isFinite(v)) vals.push(Math.abs(v));
  if (vals.length === 0) return 0.05;
  vals.sort((a, b) => a - b);
  const p = vals[Math.floor(0.95 * vals.length)];
  // Always at least 2% so a calm month doesn't show full saturation.
  return Math.max(0.02, p);
}

function formatPct(v: number, dp: number): string {
  if (!Number.isFinite(v)) return "—";
  const x = v * 100;
  const sign = x >= 0 ? "+" : "";
  return `${sign}${x.toFixed(dp)}%`;
}

function formatPctShort(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const x = v * 100;
  const sign = x >= 0 ? "+" : "−";
  const abs = Math.abs(x);
  if (abs >= 10) return `${sign}${abs.toFixed(0)}`;
  return `${sign}${abs.toFixed(1)}`;
}
