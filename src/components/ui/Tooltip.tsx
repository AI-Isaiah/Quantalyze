"use client";

import {
  useState,
  useId,
  useRef,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

/**
 * Lightweight accessible tooltip — no external dependency.
 *
 * Renders a 2-sentence narrative on hover/focus with a 150ms enter delay
 * (matching DESIGN.md short motion). Uses `role="tooltip"` + `aria-describedby`
 * for screen readers.
 *
 * Positioning (UIFIX-01): the bubble is portaled to `document.body` and
 * `position: fixed` at coordinates derived from the trigger's
 * `getBoundingClientRect()`, so it renders FULLY outside any `overflow-*`
 * ancestor (KPI strips, tables) instead of being clipped. It is centered on the
 * trigger, then CLAMPED horizontally so an edge-adjacent bubble stays on-screen,
 * and placed ABOVE the trigger by default, FLIPPING below when there is
 * insufficient room above. At `z-[210]` it clears the `z-[200]` body-portaled
 * Dialog/drawer overlays it can appear within. Scroll/resize listeners keep it
 * pinned while open and are torn down on close/unmount (SSR-safe: the portal is
 * gated behind the open flag + a `typeof document` guard, so nothing touches the
 * DOM on the server).
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

// Bubble geometry constants (fixed-width bubble → a horizontal clamp is a
// degenerate flip; either keeps the full bubble inside the viewport).
const BUBBLE_WIDTH = 224; // w-56
const VIEWPORT_MARGIN = 8; // keep this gutter from each viewport edge
const TRIGGER_GAP = 8; // gap between trigger and bubble
// Conservative bubble-height estimate used only to decide the above/below flip
// (the exact rendered height is not needed — anchoring the bubble's BOTTOM edge
// covers the default placement without it).
const ESTIMATED_BUBBLE_HEIGHT = 80;

type BubblePos = { left: number; top?: number; bottom?: number };

export function Tooltip({ content, children, className }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<BubblePos | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The component owns this ref; the trigger wrapper is attached through the
  // `setTriggerEl` callback ref below (never a returned RefObject — the
  // react-compiler-safe idiom from useTapPin.ts).
  const triggerRef = useRef<HTMLElement | null>(null);
  const setTriggerEl = useCallback((el: HTMLElement | null) => {
    triggerRef.current = el;
  }, []);
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

  // Compute fixed-position coordinates from the trigger rect. `getBoundingClientRect`
  // returns VIEWPORT coords — exactly what `position: fixed` consumes, no scroll math.
  const reposition = useCallback(() => {
    const el = triggerRef.current;
    if (!el || typeof window === "undefined") return;
    const rect = el.getBoundingClientRect();
    // Horizontal: center on the trigger, then clamp the full 224px bubble inside
    // [VIEWPORT_MARGIN, innerWidth - width - VIEWPORT_MARGIN].
    const rawLeft = rect.left + rect.width / 2 - BUBBLE_WIDTH / 2;
    const maxLeft = window.innerWidth - BUBBLE_WIDTH - VIEWPORT_MARGIN;
    const left = Math.min(Math.max(rawLeft, VIEWPORT_MARGIN), maxLeft);
    // Vertical: above by default (anchor the bubble's bottom edge above the
    // trigger top); flip below when there is not enough room above.
    if (rect.top < ESTIMATED_BUBBLE_HEIGHT + TRIGGER_GAP + VIEWPORT_MARGIN) {
      setPos({ left, top: rect.bottom + TRIGGER_GAP });
    } else {
      setPos({ left, bottom: window.innerHeight - rect.top + TRIGGER_GAP });
    }
  }, []);

  // Listener discipline (ContributionWizardOverlay shape): register on open,
  // reposition on scroll/resize, tear down on close AND unmount. `capture: true`
  // on scroll so an ancestor overflow-container scroll also repositions.
  useEffect(() => {
    if (!open) return;
    reposition();
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open, reposition]);

  return (
    <span
      ref={setTriggerEl}
      className={className ?? "relative inline-flex"}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      <span aria-describedby={open ? id : undefined}>
        {children}
      </span>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <span
            id={id}
            role="tooltip"
            className="fixed z-[210] w-56 rounded-md border bg-white px-3 py-2 text-fixed-13 leading-snug shadow-sm pointer-events-none"
            style={{
              left: pos?.left,
              top: pos?.top,
              bottom: pos?.bottom,
              color: "#1A1A2E",
              borderColor: "#E2E8F0",
              fontFamily: "var(--font-body)",
              boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
            }}
          >
            {content}
          </span>,
          document.body,
        )}
    </span>
  );
}
