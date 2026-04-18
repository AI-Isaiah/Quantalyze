"use client";

import { useEffect, useId, useRef } from "react";
import type { KeyboardEvent, PointerEvent, TouchEvent } from "react";

interface Props {
  label: string;
  helper: string;
  value: number | null;
  min: number;
  max: number;
  step: number;
  formatValue: (v: number) => string;
  onCommit: (v: number) => void;
  onReset?: () => void;
  error?: string;
  saving?: boolean;
}

/**
 * Native <input type="range"> with:
 *   - `onPointerUp`/`onTouchEnd` → immediate commit (one save per gesture)
 *   - `onKeyUp` → debounced 300ms commit (coalesce rapid arrow-key events)
 *
 * W-09 fix: keyboard debounce uses `useRef<ReturnType<typeof setTimeout> | null>`
 * at component top — NOT a `let` inside the body. A `let` local resets on each
 * render, leaking stale timers and defeating the debounce under rapid key
 * events; the `useRef` reference persists across re-renders so cleanup can
 * access the current timer.
 */
export function MandateSlider({
  label,
  helper,
  value,
  min,
  max,
  step,
  formatValue,
  onCommit,
  onReset,
  error,
  saving,
}: Props) {
  const id = useId();
  const displayValue = value !== null ? formatValue(value) : null;
  // When unset, render the thumb at the midpoint but do not show a value pill.
  const renderValue = value !== null ? value : (min + max) / 2;
  const fillPct = ((renderValue - min) / (max - min)) * 100;

  const keyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (keyTimerRef.current) clearTimeout(keyTimerRef.current);
    };
  }, []);
  function handleKeyUp(e: KeyboardEvent<HTMLInputElement>) {
    if (keyTimerRef.current) clearTimeout(keyTimerRef.current);
    const v = Number((e.currentTarget as HTMLInputElement).value);
    keyTimerRef.current = setTimeout(() => onCommit(v), 300);
  }

  function handlePointerUp(e: PointerEvent<HTMLInputElement>) {
    onCommit(Number((e.currentTarget as HTMLInputElement).value));
  }

  function handleTouchEnd(e: TouchEvent<HTMLInputElement>) {
    onCommit(Number((e.currentTarget as HTMLInputElement).value));
  }

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-sm font-medium text-text-primary">
          {label}
        </label>
        <div className="flex items-center gap-3">
          {saving && (
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse"
            />
          )}
          {value !== null && onReset && (
            <button
              type="button"
              onClick={onReset}
              className="text-xs text-text-muted hover:text-text-primary transition-colors rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/20"
            >
              Reset
            </button>
          )}
        </div>
      </div>
      <div className="mandate-slider flex items-center gap-4 pt-1">
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={renderValue}
          onChange={() => {}}
          onPointerUp={handlePointerUp}
          onTouchEnd={handleTouchEnd}
          onKeyUp={handleKeyUp}
          aria-valuetext={displayValue ?? "unset"}
          aria-busy={saving ? true : undefined}
          style={{ ["--slider-fill" as string]: `${fillPct}%` }}
          className="flex-1"
        />
        {displayValue !== null ? (
          <span className="font-metric text-[13px] tabular-nums text-text-primary min-w-[52px] text-right tracking-tight">
            {displayValue}
          </span>
        ) : (
          <span
            aria-hidden="true"
            className="font-metric text-[13px] tabular-nums text-text-muted min-w-[52px] text-right tracking-tight"
          >
            —
          </span>
        )}
      </div>
      <p className="text-sm text-text-secondary">{helper}</p>
      {error && <p role="alert" className="text-xs text-negative">{error}</p>}
    </div>
  );
}
