"use client";

import { useEffect, useRef, useState } from "react";
import { WIDGET_REGISTRY } from "../lib/widget-registry";
import type { WidgetMeta } from "../lib/types";

/**
 * Phase 09.1 Plan 05 — WidgetPicker
 *
 * Popover (NOT modal) anchored to a trigger button. Lists every entry in
 * WIDGET_REGISTRY (currently 39 + future plans bring it past 50) grouped
 * by category, with a search box and active-widget disabling.
 *
 * Structural reference: designer-bundle/project/src/widget-grid.jsx:237-319
 * (popover shape + outside-click + categorized list).
 *
 * Dismissal pattern: outside-click (anchor-aware so the trigger button
 * doesn't immediately re-close the popover when it opens) + Escape key.
 * Cloned from AddWidgetModal.tsx:29-62.
 *
 * D-08: registry entries previously badged "soon" for correlation /
 * funding / flows are real widgets — the picker no longer differentiates
 * them. We render every entry whose status === "ready"; "todo" entries
 * are excluded from the available list (none in the current registry).
 */

type Props = {
  isOpen: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  /** Set of WIDGET_REGISTRY ids currently on the dashboard. */
  activeKeys: Set<string>;
  /** Pick callback — receives a WIDGET_REGISTRY id (never a designer short key). */
  onPick: (k: string) => void;
};

export function WidgetPicker({ isOpen, onClose, anchorRef, activeKeys, onPick }: Props) {
  const [query, setQuery] = useState("");
  const popoverRef = useRef<HTMLDivElement>(null);

  // Outside-click dismiss (matches designer widget-grid.jsx:243-249).
  // Anchor-aware: clicks on the trigger button don't immediately re-close
  // the popover that the same click just opened.
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (popoverRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    };
    // Defer one tick so the same click that opened the popover doesn't
    // immediately close it (designer uses setTimeout 0 for the same reason).
    const timer = window.setTimeout(() => {
      document.addEventListener("click", handler);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("click", handler);
    };
  }, [isOpen, onClose, anchorRef]);

  // Esc dismiss (clone of AddWidgetModal.tsx:35-38 idiom).
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const entries = Object.values(WIDGET_REGISTRY).filter(
    (e) => e.status === "ready",
  );
  const lowerQ = query.toLowerCase();
  const filtered = query
    ? entries.filter(
        (e) =>
          e.name.toLowerCase().includes(lowerQ) ||
          e.id.toLowerCase().includes(lowerQ) ||
          e.description.toLowerCase().includes(lowerQ),
      )
    : entries;
  const byCategory: Record<string, WidgetMeta[]> = {};
  for (const e of filtered) {
    (byCategory[e.category] ||= []).push(e);
  }

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label="Add widget"
      style={{
        position: "absolute",
        top: "calc(100% + 6px)",
        right: 0,
        width: 360,
        maxHeight: 480,
        overflowY: "auto",
        background: "var(--surface, #fff)",
        border: "1px solid var(--border, #E2E8F0)",
        borderRadius: 8,
        boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
        padding: 12,
        zIndex: 50,
      }}
    >
      <input
        type="search"
        placeholder="Search widgets…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search widgets"
        autoFocus
        style={{
          width: "100%",
          padding: "6px 8px",
          marginBottom: 8,
          border: "1px solid var(--border, #E2E8F0)",
          borderRadius: 4,
          fontSize: 13,
        }}
      />
      {filtered.length === 0 && (
        <p
          style={{
            padding: "16px 8px",
            textAlign: "center",
            fontSize: 12,
            color: "var(--text-muted, #718096)",
          }}
        >
          No widgets match &ldquo;{query}&rdquo;
        </p>
      )}
      {Object.entries(byCategory).map(([cat, items]) => (
        <section key={cat} aria-label={cat}>
          <h4
            style={{
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "var(--text-muted, #718096)",
              margin: "12px 0 4px",
            }}
          >
            {cat}
          </h4>
          {items.map((w) => {
            const active = activeKeys.has(w.id);
            return (
              <button
                key={w.id}
                type="button"
                disabled={active}
                onClick={() => {
                  onPick(w.id);
                  onClose();
                }}
                aria-label={
                  active
                    ? `Already on dashboard — ${w.name}`
                    : `Add ${w.name}`
                }
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "6px 8px",
                  marginBottom: 2,
                  fontSize: 12,
                  opacity: active ? 0.5 : 1,
                  cursor: active ? "default" : "pointer",
                  background: "transparent",
                  border: "1px solid transparent",
                  borderRadius: 4,
                  color: "var(--text-primary, #1A1A2E)",
                }}
              >
                <span style={{ marginRight: 6 }}>{active ? "✓ " : "  "}</span>
                <strong style={{ fontWeight: 500 }}>{w.name}</strong>
                <span
                  style={{
                    color: "var(--text-muted, #718096)",
                    fontSize: 10,
                    marginLeft: 6,
                  }}
                >
                  {w.description}
                </span>
              </button>
            );
          })}
        </section>
      ))}
    </div>
  );
}
