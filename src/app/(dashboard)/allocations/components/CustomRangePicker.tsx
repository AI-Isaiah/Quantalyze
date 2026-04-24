"use client";

import { useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Phase 09.1 Plan 07 — CustomRangePicker (date-range popover)
//
// Minimum-viable two-input + Apply/Cancel implementation. The designer's
// full source (designer-bundle/project/src/range-picker.jsx) ships a dual
// month-grid + presets rail + hover-preview calendar. That polish is
// deferred to a future Tweaks-panel iteration; this minimum implementation
// covers the f7 contract:
//   - bound by `min` (= firstDate(equityDailyPoints)) and `max` (= today)
//   - bubbles `{ start, end }` ISO strings to the parent's `onApply`
//   - dismisses on Escape, outside click, or Cancel
//   - disables Apply when start > end
//
// Outside-click + Esc cloned from AddWidgetModal.tsx:29-62. Dismissal is
// non-modal (no focus trap) — the popover is anchored to the trigger and
// keyboard users can Tab back to the trigger to dismiss.
// ---------------------------------------------------------------------------

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onApply: (range: { start: string; end: string }) => void;
  min: Date;
  max: Date;
  initialRange?: { start: string; end: string } | null;
};

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function CustomRangePicker({
  isOpen,
  onClose,
  onApply,
  min,
  max,
  initialRange,
}: Props) {
  const [start, setStart] = useState<string>(
    initialRange?.start ?? toISODate(min),
  );
  const [end, setEnd] = useState<string>(initialRange?.end ?? toISODate(max));
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    // Delay so the click that opened the popover doesn't immediately close it
    // (clones the designer-bundle range-picker.jsx:54-58 pattern).
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
  const invalid = start > end;

  function apply() {
    if (invalid) return;
    onApply({ start, end });
    // onApply is expected to call onClose; we don't double-close here in
    // case the parent wants to keep the popover open while it processes.
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
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: 12,
        boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
        minWidth: 280,
        fontFamily: "DM Sans, sans-serif",
      }}
    >
      <div style={{ display: "flex", gap: 8, flexDirection: "column" }}>
        <label style={{ fontSize: 11, color: "var(--text-muted)" }}>
          <span
            style={{
              display: "block",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              fontWeight: 500,
              marginBottom: 4,
            }}
          >
            Start
          </span>
          <input
            type="date"
            value={start}
            min={minIso}
            max={maxIso}
            onChange={(e) => setStart(e.target.value)}
            style={{
              padding: "6px 8px",
              fontSize: 12,
              fontFamily: "Geist Mono, monospace",
              border: "1px solid var(--border)",
              borderRadius: 6,
              background: "var(--surface)",
              color: "var(--text-primary)",
              width: "100%",
            }}
          />
        </label>
        <label style={{ fontSize: 11, color: "var(--text-muted)" }}>
          <span
            style={{
              display: "block",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              fontWeight: 500,
              marginBottom: 4,
            }}
          >
            End
          </span>
          <input
            type="date"
            value={end}
            min={minIso}
            max={maxIso}
            onChange={(e) => setEnd(e.target.value)}
            style={{
              padding: "6px 8px",
              fontSize: 12,
              fontFamily: "Geist Mono, monospace",
              border: "1px solid var(--border)",
              borderRadius: 6,
              background: "var(--surface)",
              color: "var(--text-primary)",
              width: "100%",
            }}
          />
        </label>
      </div>
      <div
        style={{
          display: "flex",
          gap: 6,
          marginTop: 12,
          justifyContent: "flex-end",
        }}
      >
        <button
          type="button"
          onClick={onClose}
          style={{
            padding: "6px 12px",
            fontSize: 12,
            fontWeight: 500,
            background: "transparent",
            color: "var(--text-secondary)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            cursor: "pointer",
            fontFamily: "DM Sans, sans-serif",
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
            background: invalid ? "transparent" : "var(--accent)",
            color: invalid ? "var(--text-muted)" : "#fff",
            border: `1px solid ${invalid ? "var(--border)" : "var(--accent)"}`,
            borderRadius: 6,
            cursor: invalid ? "not-allowed" : "pointer",
            fontFamily: "DM Sans, sans-serif",
          }}
        >
          Apply
        </button>
      </div>
    </div>
  );
}
