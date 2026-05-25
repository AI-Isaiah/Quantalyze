"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

// ---------------------------------------------------------------------------
// PR3 (HANDOFF G6) — CustomRangePicker dual-month + presets rail
//
// Pixel-faithful port of the prototype range-picker.jsx (Allocator Dashboard
// Standalone). The component still satisfies the f7 contract so existing
// EquityChart callers don't change:
//   - bound by `min` (= firstDate(equityDailyPoints)) and `max` (= today)
//   - bubbles `{ start, end }` ISO strings to the parent's `onApply`
//   - dismisses on Escape, outside click, or Cancel
//   - Apply disabled when start > end (mirrored by clamping inside the grid
//     so the user can't pick start > end via day clicks; the manual date
//     inputs still allow it and the Apply guard catches it)
//
// Layout (matches truth screenshot + prototype range-picker.jsx:103-208):
//   [ presets rail  | calendar area               ]
//   [ Last 7 / 14… | input row                    ]
//   [ Last 30 / 60 | [Start] → [End] · {N} days   ]
//   [ Last 90 days | ┌────── two month grids ────┐|
//   [ ─────────    | │ Apr 2026  │  May 2026   │ |
//   [ MTD / YTD    | └───────────────────────────┘ |
//   [ Max (180d)  | footer: range label + Apply  ]
//
// Outside-click + Esc cloned from AddWidgetModal:29-62.
// ---------------------------------------------------------------------------

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onApply: (range: { start: string; end: string }) => void;
  min: Date;
  max: Date;
  initialRange?: { start: string; end: string } | null;
};

const DAY_MS = 86_400_000;

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseISODate(s: string): Date | null {
  const [y, m, d] = s.split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  return new Date(y, m - 1, d);
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(d: Date, n: number): Date {
  const x = new Date(d);
  x.setMonth(x.getMonth() + n);
  return x;
}

function sameDay(a: Date | null, b: Date | null): boolean {
  if (!a || !b) return false;
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function clampDate(d: Date, min: Date, max: Date): Date {
  if (d < min) return min;
  if (d > max) return max;
  return d;
}

export function CustomRangePicker({
  isOpen,
  onClose,
  onApply,
  min,
  max,
  initialRange,
}: Props) {
  // Local state — start + end as Date objects so the calendar grid can
  // compare them by day. Inputs serialize to ISO via toISODate.
  const [start, setStart] = useState<Date>(() => {
    if (initialRange?.start) {
      const d = parseISODate(initialRange.start);
      if (d) return clampDate(d, min, max);
    }
    return min;
  });
  const [end, setEnd] = useState<Date>(() => {
    if (initialRange?.end) {
      const d = parseISODate(initialRange.end);
      if (d) return clampDate(d, min, max);
    }
    return max;
  });
  const [hover, setHover] = useState<Date | null>(null);
  const [pickMode, setPickMode] = useState<"start" | "end">("start");

  // Left month displayed; right month is left+1. Default to the start's
  // month so the user opens the popover and immediately sees the start
  // date in context.
  const [viewMonth, setViewMonth] = useState<Date>(() => startOfMonth(start));

  const ref = useRef<HTMLDivElement>(null);

  // Outside-click + Esc dismissal.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const t = setTimeout(() => {
      document.addEventListener("keydown", onKey);
      document.addEventListener("mousedown", onClick);
    }, 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const minIso = toISODate(min);
  const maxIso = toISODate(max);
  const startIso = toISODate(start);
  const endIso = toISODate(end);
  const invalid = start > end;
  const dayCount = Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1);
  const rangeLabel = `${startIso} → ${endIso}`;

  // Day cells for both months; computed via useMemo because the cell
  // arrays only need to recompute when the visible month changes.
  // No-op for hover/pick state.
  const leftMonth = startOfMonth(viewMonth);
  const rightMonth = addMonths(leftMonth, 1);

  function pickDay(d: Date) {
    if (d < min || d > max) return;
    if (pickMode === "start") {
      setStart(d);
      setEnd(d);
      setPickMode("end");
    } else {
      // Completing the range. If the end pick lands before the current start,
      // swap them so the result is a forward range rather than collapsing to a
      // degenerate single day.
      if (d < start) {
        setStart(d);
        setEnd(start);
      } else {
        setEnd(d);
      }
      setPickMode("start");
    }
  }

  function applyPreset(days: number) {
    const e = max;
    const s = new Date(e);
    s.setDate(s.getDate() - (days - 1));
    const sClamped = clampDate(s, min, max);
    setStart(sClamped);
    setEnd(e);
    setViewMonth(startOfMonth(sClamped));
    setPickMode("start");
  }

  function applyMTD() {
    const s = new Date(max.getFullYear(), max.getMonth(), 1);
    const sClamped = clampDate(s, min, max);
    setStart(sClamped);
    setEnd(max);
    setViewMonth(startOfMonth(sClamped));
    setPickMode("start");
  }

  function applyYTD() {
    const s = new Date(max.getFullYear(), 0, 1);
    const sClamped = clampDate(s, min, max);
    setStart(sClamped);
    setEnd(max);
    setViewMonth(startOfMonth(sClamped));
    setPickMode("start");
  }

  function applyMax() {
    setStart(min);
    setEnd(max);
    setViewMonth(startOfMonth(min));
    setPickMode("start");
  }

  function apply() {
    if (invalid) return;
    onApply({ start: startIso, end: endIso });
  }

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Custom date range"
      style={{
        position: "absolute",
        top: "calc(100% + 6px)",
        right: 0,
        zIndex: 50,
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: 8,
        boxShadow: "0 12px 32px rgba(15, 23, 42, 0.12), 0 2px 6px rgba(15, 23, 42, 0.06)",
        display: "flex",
        fontFamily: "var(--font-sans)",
        overflow: "hidden",
      }}
    >
      {/* Presets rail */}
      <div
        style={{
          width: 130,
          borderRight: "1px solid var(--color-border)",
          padding: "12px 0",
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        <PresetRow label="Last 7 days" onClick={() => applyPreset(7)} />
        <PresetRow label="Last 14 days" onClick={() => applyPreset(14)} />
        <PresetRow label="Last 30 days" onClick={() => applyPreset(30)} />
        <PresetRow label="Last 60 days" onClick={() => applyPreset(60)} />
        <PresetRow label="Last 90 days" onClick={() => applyPreset(90)} />
        <div
          aria-hidden
          style={{
            height: 1,
            background: "var(--color-border)",
            margin: "6px 12px",
          }}
        />
        <PresetRow label="Month to date" onClick={applyMTD} />
        <PresetRow label="Year to date" onClick={applyYTD} />
        <PresetRow label="Max" onClick={applyMax} />
      </div>

      {/* Calendar + input area */}
      <div
        style={{
          padding: 14,
          display: "flex",
          flexDirection: "column",
          gap: 12,
          minWidth: 520,
        }}
      >
        {/* Input row — Phase 09.1 UI-FLAG-03: align-items: flex-end so the
            arrow + day-count text naturally sit at the baseline of the
            input, replacing magic-number `paddingTop: 14` overrides that
            broke at >110% zoom (the inputs grew taller while 14px stayed
            fixed). DateInput is a flex-column label/input pair; flex-end
            on this row aligns the bottom of the input with the bottom of
            the sibling text elements. */}
        <div style={{ display: "flex", alignItems: "flex-end", gap: "var(--space-grid-gap)" }}>
          <DateInput
            label="Start"
            value={startIso}
            min={minIso}
            max={endIso}
            onChange={(v) => {
              const d = parseISODate(v);
              if (d) {
                const c = clampDate(d, min, max);
                setStart(c);
                setViewMonth(startOfMonth(c));
              }
            }}
          />
          <div
            aria-hidden
            style={{ color: "var(--color-text-muted)", paddingBottom: 6 }}
          >
            →
          </div>
          <DateInput
            label="End"
            value={endIso}
            min={startIso}
            max={maxIso}
            onChange={(v) => {
              const d = parseISODate(v);
              if (d) setEnd(clampDate(d, min, max));
            }}
          />
          <div
            style={{
              marginLeft: "auto",
              paddingBottom: 6,
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--color-text-muted)",
            }}
          >
            {dayCount} {dayCount === 1 ? "day" : "days"}
          </div>
        </div>

        {/* Two-month calendar */}
        <div style={{ display: "flex", gap: 20 }}>
          <MonthGrid
            month={leftMonth}
            start={start}
            end={end}
            hover={hover}
            earliest={min}
            latest={max}
            onHover={setHover}
            onPick={pickDay}
            onPrev={() => setViewMonth(addMonths(viewMonth, -1))}
            onNext={null}
            showPrev
            showNext={false}
          />
          <MonthGrid
            month={rightMonth}
            start={start}
            end={end}
            hover={hover}
            earliest={min}
            latest={max}
            onHover={setHover}
            onPick={pickDay}
            onPrev={null}
            onNext={() => setViewMonth(addMonths(viewMonth, 1))}
            showPrev={false}
            showNext
          />
        </div>

        {/* footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderTop: "1px solid var(--color-border)",
            marginTop: 2,
            paddingTop: 12,
          }}
        >
          <div
            style={{
              fontSize: 11,
              color: "var(--color-text-muted)",
              fontFamily: "var(--font-mono)",
            }}
          >
            {rangeLabel}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: "6px 12px",
                fontSize: 12,
                fontWeight: 500,
                background: "transparent",
                color: "var(--color-text-secondary)",
                border: "1px solid var(--color-border)",
                borderRadius: 6,
                cursor: "pointer",
                fontFamily: "var(--font-sans)",
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={apply}
              disabled={invalid}
              aria-disabled={invalid}
              style={{
                padding: "6px 14px",
                fontSize: 12,
                fontWeight: 500,
                background: invalid ? "transparent" : "var(--color-accent)",
                color: invalid ? "var(--color-text-muted)" : "#fff",
                border: `1px solid ${invalid ? "var(--color-border)" : "var(--color-accent)"}`,
                borderRadius: 6,
                cursor: invalid ? "not-allowed" : "pointer",
                fontFamily: "var(--font-sans)",
              }}
            >
              Apply
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────── primitives

function PresetRow({ label, onClick }: { label: string; onClick: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        textAlign: "left",
        padding: "6px 14px",
        background: hover
          ? "color-mix(in srgb, var(--color-accent) 8%, transparent)"
          : "transparent",
        color: hover ? "var(--color-accent)" : "var(--color-text-secondary)",
        border: "none",
        fontSize: 12,
        cursor: "pointer",
        fontFamily: "var(--font-sans)",
      }}
    >
      {label}
    </button>
  );
}

function DateInput({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: string;
  min: string;
  max: string;
  onChange: (v: string) => void;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span
        style={{
          fontSize: 10,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--color-text-muted)",
          fontWeight: 500,
        }}
      >
        {label}
      </span>
      <input
        type="date"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value)}
        style={{
          padding: "6px 8px",
          fontSize: 12,
          fontFamily: "var(--font-mono)",
          border: "1px solid var(--color-border)",
          borderRadius: 6,
          background: "var(--color-surface)",
          color: "var(--color-text-primary)",
          width: 140,
        }}
      />
    </label>
  );
}

const NAV_BTN_STYLE: CSSProperties = {
  width: 22,
  height: 22,
  border: "none",
  background: "transparent",
  color: "var(--color-text-secondary)",
  cursor: "pointer",
  fontSize: 16,
  lineHeight: "22px",
  padding: 0,
  fontFamily: "var(--font-sans)",
};

function MonthGrid({
  month,
  start,
  end,
  hover,
  earliest,
  latest,
  onHover,
  onPick,
  onPrev,
  onNext,
  showPrev,
  showNext,
}: {
  month: Date;
  start: Date;
  end: Date;
  hover: Date | null;
  earliest: Date;
  latest: Date;
  onHover: (d: Date | null) => void;
  onPick: (d: Date) => void;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
  showPrev: boolean;
  showNext: boolean;
}) {
  const cells = useMemo(() => {
    const year = month.getFullYear();
    const mIdx = month.getMonth();
    const firstOfMonth = new Date(year, mIdx, 1);
    const gridStart = new Date(firstOfMonth);
    gridStart.setDate(1 - firstOfMonth.getDay());
    const out: Date[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      out.push(d);
    }
    return out;
  }, [month]);

  const monthLabel = month.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  return (
    <div style={{ width: 240 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 8,
        }}
      >
        {showPrev && onPrev ? (
          <button
            type="button"
            aria-label="Previous month"
            onClick={onPrev}
            style={NAV_BTN_STYLE}
          >
            ‹
          </button>
        ) : (
          <div style={{ width: 22 }} />
        )}
        <div
          style={{
            fontSize: 12,
            fontWeight: 500,
            color: "var(--color-text-primary)",
            fontFamily: "var(--font-sans)",
          }}
        >
          {monthLabel}
        </div>
        {showNext && onNext ? (
          <button
            type="button"
            aria-label="Next month"
            onClick={onNext}
            style={NAV_BTN_STYLE}
          >
            ›
          </button>
        ) : (
          <div style={{ width: 22 }} />
        )}
      </div>
      <div
        style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 1 }}
      >
        {["S", "M", "T", "W", "T", "F", "S"].map((label, i) => (
          <div
            key={i}
            style={{
              textAlign: "center",
              fontSize: 10,
              color: "var(--color-text-muted)",
              fontWeight: 500,
              padding: "4px 0",
              fontFamily: "var(--font-sans)",
            }}
          >
            {label}
          </div>
        ))}
        {cells.map((d, i) => {
          const inMonth = d.getMonth() === month.getMonth();
          const disabled = d < earliest || d > latest;
          const isStart = sameDay(d, start);
          const isEnd = sameDay(d, end);
          const inRange = start && end && d >= start && d <= end;
          return (
            <DayCell
              key={i}
              d={d}
              inMonth={inMonth}
              disabled={disabled}
              isStart={isStart}
              isEnd={isEnd}
              inRange={!!inRange}
              isHover={!!hover && sameDay(d, hover)}
              onHover={onHover}
              onPick={onPick}
            />
          );
        })}
      </div>
    </div>
  );
}

function DayCell({
  d,
  inMonth,
  disabled,
  isStart,
  isEnd,
  inRange,
  isHover,
  onHover,
  onPick,
}: {
  d: Date;
  inMonth: boolean;
  disabled: boolean;
  isStart: boolean;
  isEnd: boolean;
  inRange: boolean;
  isHover: boolean;
  onHover: (d: Date | null) => void;
  onPick: (d: Date) => void;
}) {
  const isEdge = isStart || isEnd;
  const bg = isEdge
    ? "var(--color-accent)"
    : inRange
      ? "color-mix(in srgb, var(--color-accent) 10%, transparent)"
      : isHover && !disabled
        ? "color-mix(in srgb, var(--color-text-primary) 4%, transparent)"
        : "transparent";
  const color = isEdge
    ? "#fff"
    : !inMonth || disabled
      ? "var(--color-text-muted)"
      : inRange
        ? "var(--color-accent)"
        : "var(--color-text-primary)";
  return (
    <button
      type="button"
      disabled={disabled}
      onMouseEnter={() => onHover(d)}
      onMouseLeave={() => onHover(null)}
      onClick={() => !disabled && onPick(d)}
      style={{
        padding: "6px 0",
        fontSize: 11.5,
        fontFamily: "var(--font-mono)",
        border: "none",
        background: bg,
        color,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.35 : 1,
        borderRadius: isEdge ? 4 : 0,
        fontWeight: isEdge ? 600 : 400,
      }}
    >
      {d.getDate()}
    </button>
  );
}
