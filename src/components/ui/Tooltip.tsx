"use client";

import { useState, useId, useRef, useCallback, type ReactNode } from "react";

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
    timerRef.current = setTimeout(() => setOpen(true), 150);
  }, []);

  const hide = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setOpen(false);
  }, []);

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
