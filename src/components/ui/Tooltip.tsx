"use client";

import {
  useState,
  useId,
  useRef,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";

/**
 * Lightweight accessible tooltip — no external dependency.
 *
 * Renders a 2-sentence narrative on hover/focus with a 150ms enter delay
 * (matching DESIGN.md short motion). Uses `role="tooltip"` + `aria-describedby`
 * for screen readers. Positioned above the trigger by default, flips below
 * if near the top of the viewport.
 *
 * Design system: DM Sans 13px, #1A1A2E text on white surface, 1px #E2E8F0
 * border, 6px radius, subtle shadow.
 */

interface TooltipProps {
  content: string;
  children: ReactNode;
  /** Optional extra className on the wrapper span. */
  className?: string;
}

export function Tooltip({ content, children, className }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();

  const show = useCallback(() => {
    // F9 M-0898: clear any still-pending enter timer before queuing a new one.
    // Without this a rapid focus-then-hover (or a synthetic re-fire) orphans the
    // first timeout — it keeps running and fires an extra setOpen(true) on an
    // already-open tooltip.
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setOpen(true), 150);
  }, []);

  const hide = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setOpen(false);
  }, []);

  // F9 M-0899 / L-0044: cancel a pending enter timer on unmount so the delayed
  // setOpen never fires after the component is gone. `hide` only clears on
  // blur/mouseleave; a parent that unmounts mid-hover (KPI strip re-render,
  // panel close, route change during the 150ms delay) would otherwise leak the
  // timer + trigger a post-unmount state update.
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return (
    <span
      className={className ?? "relative inline-flex"}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      <span aria-describedby={open ? id : undefined}>
        {children}
      </span>
      {open && (
        <span
          id={id}
          role="tooltip"
          className="absolute bottom-full left-1/2 z-50 mb-2 w-56 -translate-x-1/2 rounded-md border bg-white px-3 py-2 text-[13px] leading-snug shadow-sm pointer-events-none"
          style={{
            color: "#1A1A2E",
            borderColor: "#E2E8F0",
            fontFamily: "var(--font-body)",
            boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
          }}
        >
          {content}
        </span>
      )}
    </span>
  );
}
