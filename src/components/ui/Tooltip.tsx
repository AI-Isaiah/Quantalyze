"use client";

import {
  useState,
  useId,
  useRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

// SSR-safe layout effect. Measuring must happen BEFORE paint on the client
// (useLayoutEffect) so the bubble never mispaints on open (WR-01), but
// useLayoutEffect warns during server render — fall back to useEffect on the
// server, where this "use client" component's effects never run anyway (open
// starts false, so the portal is not emitted on the server).
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

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
 * and placed ABOVE the trigger by default, TOP-anchored, FLIPPING below when the
 * bubble's REAL measured height would overflow the viewport top (WR-02) — the
 * top edge is therefore always clamped on-screen. The measurement runs in a
 * layout effect so the first paint is already correct (WR-01: no one-frame
 * top-left / stale-coordinate flash), and the bubble stays `visibility:hidden`
 * until it has been measured & positioned. At `z-[210]` it clears the `z-[200]`
 * body-portaled Dialog/drawer overlays it can appear within. Scroll/resize
 * listeners keep it pinned while open and are torn down on close/unmount
 * (SSR-safe: the portal is gated behind the open flag + a `typeof document`
 * guard, so nothing touches the DOM on the server).
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
// Fallback bubble-height estimate, used ONLY before the real bubble has been
// laid out (offsetHeight === 0). Once the bubble is in the DOM its measured
// height drives the flip decision (WR-02), so this never underestimates real
// wrapped 2-sentence content after the first layout pass.
const ESTIMATED_BUBBLE_HEIGHT = 80;

type BubblePos = { left: number; top: number };

export function Tooltip({ content, children, className }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<BubblePos | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The component owns these refs; the trigger wrapper and the portaled bubble
  // are attached through the `setTriggerEl` / `setBubbleEl` callback refs below
  // (never a returned RefObject — the react-compiler-safe idiom from useTapPin.ts).
  const triggerRef = useRef<HTMLElement | null>(null);
  const setTriggerEl = useCallback((el: HTMLElement | null) => {
    triggerRef.current = el;
  }, []);
  const bubbleRef = useRef<HTMLElement | null>(null);
  const setBubbleEl = useCallback((el: HTMLElement | null) => {
    bubbleRef.current = el;
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
    // [VIEWPORT_MARGIN, clientWidth - width - VIEWPORT_MARGIN]. Use
    // documentElement.clientWidth (excludes the classic scrollbar) — the same
    // width `position: fixed` resolves against — so a right-clamped bubble never
    // sits a few px under the scrollbar / off-screen.
    const viewportW = document.documentElement.clientWidth;
    const rawLeft = rect.left + rect.width / 2 - BUBBLE_WIDTH / 2;
    const maxLeft = viewportW - BUBBLE_WIDTH - VIEWPORT_MARGIN;
    const left = Math.min(Math.max(rawLeft, VIEWPORT_MARGIN), maxLeft);
    // Vertical (WR-02): drive the above/below flip with the REAL measured bubble
    // height (not a fixed 80px estimate that underestimates a wrapped 2-sentence
    // narrative). TOP-anchor BOTH placements so the top edge is explicitly
    // clamped on-screen. Prefer above — the bubble's top there is
    // `rect.top - gap - height`; if that would render above the viewport top
    // (< VIEWPORT_MARGIN), flip below (`rect.bottom + gap`) so the first lines
    // are never clipped at the viewport edge.
    const bubbleH = bubbleRef.current?.offsetHeight || ESTIMATED_BUBBLE_HEIGHT;
    const aboveTop = rect.top - TRIGGER_GAP - bubbleH;
    let top: number;
    if (aboveTop >= VIEWPORT_MARGIN) {
      top = aboveTop;
    } else {
      // Flip below, top-anchored at `rect.bottom + gap`, then clamp the BOTTOM
      // edge on-screen (symmetric with the above placement's top clamp) so a
      // trigger near the top of a SHORT viewport can't push the bubble past the
      // viewport bottom. Use documentElement.clientHeight (the height a
      // position:fixed frame resolves against), not window.innerHeight.
      const belowTop = rect.bottom + TRIGGER_GAP;
      const maxTop =
        document.documentElement.clientHeight - VIEWPORT_MARGIN - bubbleH;
      top = Math.min(belowTop, maxTop);
    }
    setPos({ left, top });
  }, []);

  // Listener discipline (ContributionWizardOverlay shape): register on open,
  // reposition on scroll/resize, tear down on close AND unmount. `capture: true`
  // on scroll so an ancestor overflow-container scroll also repositions. A LAYOUT
  // effect (WR-01) so the measure + setPos commit BEFORE the browser paints —
  // otherwise the portal paints one frame at the body's top-left (undefined
  // insets) or the previous open's stale coordinates, then snaps.
  useIsomorphicLayoutEffect(() => {
    if (!open) {
      // WR-01: drop stale coordinates on close so a reopen starts from an
      // unmeasured (hidden) state and never flashes the previous position.
      setPos(null);
      return;
    }
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
            ref={setBubbleEl}
            id={id}
            role="tooltip"
            className="fixed z-[210] w-56 rounded-md border bg-white px-3 py-2 text-fixed-13 leading-snug shadow-sm pointer-events-none"
            style={{
              left: pos?.left,
              top: pos?.top,
              // WR-01: keep the bubble unpainted until it has been measured &
              // positioned (the layout effect above measures before paint), so
              // it never flashes at the body's top-left or a stale position.
              visibility: pos ? undefined : "hidden",
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
