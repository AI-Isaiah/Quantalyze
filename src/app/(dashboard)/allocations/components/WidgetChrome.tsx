"use client";

import { useEffect, useRef, useState } from "react";
import { SizeStepper } from "./SizeStepper";

/**
 * Phase 09.1 Plan 05 — WidgetChrome
 *
 * Floating top-right hover/focus-within chrome wrapper around each tile in
 * the V2 widget grid. Renders SizeStepper + drag-handle (with V1 keyboard-
 * reorder mode) + close button + always-present overflow menu (screen-
 * reader path for reorder + remove per D-04).
 *
 * D-04 accessibility contract:
 *   - Chrome is `opacity: 0` by default and revealed by the parent
 *     `.widget-cell:hover` OR `.widget-cell:focus-within` rule (CSS in
 *     WidgetGrid). This means a screen-reader user tabbing into any
 *     control inside a tile reveals chrome, not just mouse hover.
 *   - Drag handle is a real `<button>` with `aria-label="Reorder widget"`
 *     and `aria-pressed={kbdMode}`. Enter/Space toggles keyboard-reorder
 *     mode; ArrowUp/ArrowDown then call onMove(k, "prev"|"next") and
 *     the parent (AllocationDashboardV2) resolves the sentinel to the
 *     real adjacent tile key. Esc exits the mode.
 *   - The `⋯` overflow menu is ALWAYS present alongside the rest of the
 *     chrome. It opens a role="menu" popover with three role="menuitem"
 *     buttons (Move up / Move down / Remove). This guarantees a non-
 *     hover screen-reader path for every reorder operation, so there is
 *     no hover-only escape hatch.
 *   - Phase A4 a11y additions:
 *       * Home / End on the drag handle traverse focus across all widget
 *         drag handles (outside kbdMode) or move the widget to the first /
 *         last position (inside kbdMode). The "first" / "last" sentinels
 *         are resolved by AllocationDashboardV2's onMoveWrapper.
 *       * A polite aria-live region inside the chrome announces reorder-
 *         mode toggles, moves, and resizes so screen-reader users hear
 *         state changes without polling the DOM.
 */

const DRAG_HANDLE_SELECTOR = ".widget-chrome .drag-handle";

/** Focus the drag handle of the first or last widget cell in document
 *  order. Returns true if focus moved (i.e., a sibling existed). The
 *  selector pinned in DRAG_HANDLE_SELECTOR is scoped to widget chrome so
 *  it never traverses sibling pickers / modals that might also render
 *  drag-styled buttons. */
function focusEndpointHandle(end: "first" | "last"): boolean {
  if (typeof document === "undefined") return false;
  const handles = document.querySelectorAll<HTMLButtonElement>(
    DRAG_HANDLE_SELECTOR,
  );
  if (handles.length === 0) return false;
  const target = end === "first" ? handles[0] : handles[handles.length - 1];
  if (!target) return false;
  target.focus();
  return true;
}

type Props = {
  k: string;
  w: 1 | 2 | 3 | 4;
  onResize: (k: string, w: 1 | 2 | 3 | 4) => void;
  onRemove: (k: string) => void;
  /**
   * Move callback. The parent (AllocationDashboardV2) supplies a wrapper
   * that resolves the sentinel strings "prev" / "next" to the actual
   * adjacent tile key before delegating to moveWidget. This keeps the
   * keyboard-reorder + overflow-menu code paths agnostic of the tiles
   * array order.
   */
  onMove: (fromK: string, toK: string) => void;
};

export function WidgetChrome({ k, w, onResize, onRemove, onMove }: Props) {
  const [kbdMode, setKbdMode] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);

  function announce(message: string) {
    // Setting the same string twice would be deduped by aria-atomic
    // re-render, so append a zero-width space to force a fresh
    // announcement when the same action fires repeatedly (e.g., user
    // presses ArrowDown twice and both announcements need to surface).
    setAnnouncement((prev) => (prev === message ? `${message} ` : message));
  }

  function handleDragKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      // Compute next mode from the closed-over kbdMode (the handler is
      // re-created each render, so this read is fresh). Fire side effects
      // OUTSIDE the setState updater — React's rules say updaters must be
      // pure, and Strict Mode double-invokes them in dev.
      const next = !kbdMode;
      announce(
        next
          ? `Reorder mode active for ${k}. Use arrow keys to move, Home or End to jump to the first or last position, Escape to exit.`
          : `Reorder mode exited for ${k}.`,
      );
      setKbdMode(next);
      return;
    }
    // Home / End are available outside kbdMode for focus traversal across
    // sibling widgets, so the keyboard-only user can jump to either end of
    // the grid without holding Tab.
    if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      if (kbdMode) {
        const end = e.key === "Home" ? "first" : "last";
        onMove(k, end);
        announce(`Moved ${k} to ${end} position.`);
      } else {
        const moved = focusEndpointHandle(e.key === "Home" ? "first" : "last");
        if (moved) announce(`Focused ${e.key === "Home" ? "first" : "last"} widget.`);
      }
      return;
    }
    if (!kbdMode) return;
    if (e.key === "ArrowUp") {
      e.preventDefault();
      onMove(k, "prev");
      announce(`Moved ${k} up.`);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      onMove(k, "next");
      announce(`Moved ${k} down.`);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setKbdMode(false);
      announce(`Reorder mode exited for ${k}.`);
    }
  }

  function handleResizeWithAnnouncement(next: 1 | 2 | 3 | 4) {
    onResize(k, next);
    announce(`Resized ${k} to width ${next}.`);
  }

  // Outside-click dismiss for the overflow menu (matches AddWidgetModal:29-62
  // dismissal idiom, scoped to the menu ref instead of focus-trapping).
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      setMenuOpen(false);
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [menuOpen]);

  return (
    <div
      className="widget-chrome"
      style={{
        position: "absolute",
        top: 6,
        right: 6,
        display: "flex",
        gap: 4,
        alignItems: "center",
        opacity: 0,
        transition: "opacity 150ms ease",
        zIndex: 5,
        pointerEvents: "auto",
      }}
    >
      {/* A4 — visually-hidden polite aria-live region. Sits inside the
          chrome so the assertive technology surface stays scoped to this
          widget instead of competing with sibling widgets' announcements. */}
      <div
        className="widget-chrome-live-region"
        aria-live="polite"
        aria-atomic="true"
        data-testid={`widget-chrome-live-${k}`}
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: "hidden",
          clip: "rect(0 0 0 0)",
          whiteSpace: "nowrap",
          border: 0,
        }}
      >
        {announcement}
      </div>
      <SizeStepper current={w} onChange={handleResizeWithAnnouncement} />
      <button
        type="button"
        aria-label="Reorder widget"
        aria-pressed={kbdMode}
        onKeyDown={handleDragKeyDown}
        className="chrome-btn drag-handle"
        style={{
          width: 22,
          height: 22,
          padding: 0,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 12,
          background: kbdMode ? "var(--accent, #1B6B5A)" : "#fff",
          color: kbdMode ? "#fff" : "var(--text-muted, #718096)",
          border: "1px solid var(--border, #E2E8F0)",
          borderRadius: 4,
          cursor: "grab",
          boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
        }}
      >
        <span aria-hidden="true">&#x2807;</span>
      </button>
      <button
        type="button"
        aria-label={`Remove ${k} widget`}
        onClick={() => onRemove(k)}
        className="chrome-btn close-btn"
        style={{
          width: 22,
          height: 22,
          padding: 0,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 11,
          background: "#fff",
          color: "var(--text-muted, #718096)",
          border: "1px solid var(--border, #E2E8F0)",
          borderRadius: 4,
          cursor: "pointer",
          boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
        }}
      >
        <span aria-hidden="true">&times;</span>
      </button>

      {/* D-04 always-present overflow menu — screen-reader path for reorder + remove. */}
      <div ref={menuRef} style={{ position: "relative" }}>
        <button
          type="button"
          aria-label="Widget options"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
          className="chrome-btn overflow-btn"
          style={{
            width: 22,
            height: 22,
            padding: 0,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 13,
            background: "#fff",
            color: "var(--text-muted, #718096)",
            border: "1px solid var(--border, #E2E8F0)",
            borderRadius: 4,
            cursor: "pointer",
            boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
          }}
        >
          <span aria-hidden="true">&#x22EF;</span>
        </button>
        {menuOpen && (
          <div
            role="menu"
            aria-label="Widget actions"
            style={{
              position: "absolute",
              top: "calc(100% + 4px)",
              right: 0,
              background: "#fff",
              border: "1px solid var(--border, #E2E8F0)",
              borderRadius: 4,
              padding: 4,
              minWidth: 132,
              zIndex: 6,
              boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
            }}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onMove(k, "prev");
                setMenuOpen(false);
              }}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "4px 8px",
                fontSize: 12,
                background: "transparent",
                border: "none",
                cursor: "pointer",
                color: "var(--text-primary, #1A1A2E)",
              }}
            >
              Move up
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onMove(k, "next");
                setMenuOpen(false);
              }}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "4px 8px",
                fontSize: 12,
                background: "transparent",
                border: "none",
                cursor: "pointer",
                color: "var(--text-primary, #1A1A2E)",
              }}
            >
              Move down
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onRemove(k);
                setMenuOpen(false);
              }}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "4px 8px",
                fontSize: 12,
                background: "transparent",
                border: "none",
                cursor: "pointer",
                color: "var(--danger, #DC2626)",
              }}
            >
              Remove
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
