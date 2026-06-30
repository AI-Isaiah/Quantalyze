"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent, PointerEvent, TouchEvent } from "react";

// M-0421: the only keys that move a native range input's value. A keyUp for any
// other key (Tab/Escape/Shift/screen-reader nav) must NOT arm a commit, else it
// schedules a redundant same-value PUT of an unchanged mandate.
const COMMIT_KEYS = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

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
 *
 * Controlled-input drag fix (2026-04-19): a prior version bound
 * `value={renderValue}` with `onChange={() => {}}`. React 19 treats that as a
 * read-only controlled input — every native `input` event the slider fires
 * during a drag or arrow-key press gets reset to the parent state on the
 * next commit, so the thumb appears frozen and the user believes the slider
 * is broken. The fix tracks a local `draftValue` that the native input
 * mutates via a REAL `onChange`; the parent state syncs back only when it
 * changes externally (props → effect → draft), preventing drag resets.
 * Committed values still flow through `onCommit` as before.
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
  // When unset, render the thumb at the midpoint but do not show a value pill.
  const renderValue = value !== null ? value : (min + max) / 2;
  const [draftValue, setDraftValue] = useState<number>(renderValue);
  // Sync local draft when the parent value prop changes (commits, resets,
  // external updates). Intentionally re-runs only on renderValue change —
  // drag-induced draft changes do not feed back into this effect.
  useEffect(() => {
    setDraftValue(renderValue);
  }, [renderValue]);
  const displayValue =
    value !== null || draftValue !== (min + max) / 2
      ? formatValue(draftValue)
      : null;
  const fillPct = ((draftValue - min) / (max - min)) * 100;

  const keyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (keyTimerRef.current) clearTimeout(keyTimerRef.current);
    };
  }, []);

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    setDraftValue(Number(e.currentTarget.value));
  }

  function handleKeyUp(e: KeyboardEvent<HTMLInputElement>) {
    // M-0421: only arm the debounced commit for keys that actually change the
    // slider value; ignore Tab/Escape/modifiers so they don't trigger a
    // redundant same-value save.
    if (!COMMIT_KEYS.has(e.key)) return;
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
          value={draftValue}
          onChange={handleChange}
          onPointerUp={handlePointerUp}
          onTouchEnd={handleTouchEnd}
          onKeyUp={handleKeyUp}
          aria-label={label}
          aria-valuetext={displayValue ?? "unset"}
          aria-busy={saving ? true : undefined}
          style={{ ["--slider-fill" as string]: `${fillPct}%` }}
          className="flex-1"
        />
        {displayValue !== null ? (
          <span className="font-metric text-fixed-13 tabular-nums text-text-primary min-w-[52px] text-right tracking-tight">
            {displayValue}
          </span>
        ) : (
          <span
            aria-hidden="true"
            className="font-metric text-fixed-13 tabular-nums text-text-muted min-w-[52px] text-right tracking-tight"
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
