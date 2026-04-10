"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { WIDGET_REGISTRY } from "../lib/widget-registry";
import { WIDGET_CATEGORIES } from "../lib/widget-registry";
import type { WidgetMeta } from "../lib/types";

interface AddWidgetModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (widgetId: string) => void;
  activeWidgetIds: string[];
  recentlyClosed: string[];
}

export function AddWidgetModal({
  isOpen,
  onClose,
  onAdd,
  activeWidgetIds,
  recentlyClosed,
}: AddWidgetModalProps) {
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const overlayRef = useRef<HTMLDivElement>(null);
  const firstFocusRef = useRef<HTMLInputElement>(null);

  // Focus trap + escape
  useEffect(() => {
    if (!isOpen) return;

    // Focus search input on open
    firstFocusRef.current?.focus();

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }

      // Simple focus trap
      if (e.key === "Tab" && overlayRef.current) {
        const focusable = overlayRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  const toggleCategory = useCallback((catId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId);
      else next.add(catId);
      return next;
    });
  }, []);

  if (!isOpen) return null;

  const activeSet = new Set(activeWidgetIds);
  const lowerSearch = search.toLowerCase();

  // All widgets grouped by category
  const allWidgets = Object.values(WIDGET_REGISTRY);

  // Filter by search
  const matchesSearch = (w: WidgetMeta) =>
    !search ||
    w.name.toLowerCase().includes(lowerSearch) ||
    w.description.toLowerCase().includes(lowerSearch);

  const filteredWidgets = allWidgets.filter(matchesSearch);
  const noResults = filteredWidgets.length === 0 && search.length > 0;

  // Recently closed widgets that still exist in registry
  const recentlyClosedWidgets = recentlyClosed
    .map((id) => WIDGET_REGISTRY[id])
    .filter((w): w is WidgetMeta => w != null && matchesSearch(w));

  // Highlight matched text
  function highlightMatch(text: string): React.ReactNode {
    if (!search) return text;
    const idx = text.toLowerCase().indexOf(lowerSearch);
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <mark className="bg-yellow-100 rounded-sm">{text.slice(idx, idx + search.length)}</mark>
        {text.slice(idx + search.length)}
      </>
    );
  }

  return (
    // Overlay
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.3)" }}
      aria-modal="true"
      role="dialog"
      aria-label="Add widget"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Content */}
      <div
        className="flex flex-col rounded-lg bg-white"
        style={{
          width: 480,
          maxHeight: "70vh",
          border: "1px solid #E2E8F0",
          boxShadow: "0 8px 32px rgba(0,0,0,0.12)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#E2E8F0] px-5 py-3">
          <h2 className="font-sans text-base font-semibold" style={{ color: "#1A1A2E" }}>
            Add Widget
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="rounded p-1 text-[#718096] hover:bg-[#F8F9FA] hover:text-[#1A1A2E] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1B6B5A]"
          >
            <span aria-hidden="true" style={{ fontSize: 18 }}>
              &times;
            </span>
          </button>
        </div>

        {/* Search */}
        <div className="border-b border-[#E2E8F0] px-5 py-2.5">
          <input
            ref={firstFocusRef}
            type="search"
            placeholder="Search widgets..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-md border border-[#E2E8F0] px-3 py-1.5 text-sm focus:border-[#1B6B5A] focus:outline-none"
            style={{ borderRadius: 6 }}
          />
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {/* Empty state */}
          {noResults && (
            <p className="py-8 text-center text-sm" style={{ color: "#718096" }}>
              No widgets match &ldquo;{search}&rdquo;
            </p>
          )}

          {/* Recently Closed */}
          {recentlyClosedWidgets.length > 0 && (
            <div className="mb-4">
              <h3
                className="mb-2 text-[11px] font-semibold uppercase tracking-wider"
                style={{ color: "#718096" }}
              >
                Recently Closed
              </h3>
              <div className="space-y-1.5">
                {recentlyClosedWidgets.map((w) => (
                  <WidgetRow
                    key={w.id}
                    widget={w}
                    isActive={activeSet.has(w.id)}
                    onAdd={onAdd}
                    highlightMatch={highlightMatch}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Category sections */}
          {!noResults &&
            WIDGET_CATEGORIES.map((cat) => {
              const catWidgets = filteredWidgets.filter((w) => w.category === cat.id);
              if (catWidgets.length === 0) return null;
              const isCollapsed = collapsed.has(cat.id);

              return (
                <div key={cat.id} className="mb-3">
                  <button
                    type="button"
                    onClick={() => toggleCategory(cat.id)}
                    className="mb-1.5 flex w-full items-center gap-1.5 rounded py-1 text-left hover:bg-[#F8F9FA] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1B6B5A]"
                  >
                    <span
                      className="text-[10px] transition-transform"
                      style={{ transform: isCollapsed ? "rotate(-90deg)" : "rotate(0)" }}
                    >
                      &#9660;
                    </span>
                    <span className="text-xs" aria-hidden="true">
                      {cat.icon}
                    </span>
                    <span
                      className="text-[12px] font-semibold uppercase tracking-wider"
                      style={{ color: "#4A5568" }}
                    >
                      {cat.name}
                    </span>
                    <span
                      className="ml-1 text-[11px]"
                      style={{ color: "#718096" }}
                    >
                      ({catWidgets.length})
                    </span>
                  </button>
                  {!isCollapsed && (
                    <div className="space-y-1.5 pl-1">
                      {catWidgets.map((w) => (
                        <WidgetRow
                          key={w.id}
                          widget={w}
                          isActive={activeSet.has(w.id)}
                          onAdd={onAdd}
                          highlightMatch={highlightMatch}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
        </div>

        {/* Footer */}
        <div className="border-t border-[#E2E8F0] px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-md px-4 py-2 text-sm font-medium text-white transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1B6B5A]"
            style={{ backgroundColor: "#1B6B5A" }}
            onMouseEnter={(e) => ((e.target as HTMLElement).style.backgroundColor = "#155A4B")}
            onMouseLeave={(e) => ((e.target as HTMLElement).style.backgroundColor = "#1B6B5A")}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Widget row inside the modal
// ---------------------------------------------------------------------------

function WidgetRow({
  widget,
  isActive,
  onAdd,
  highlightMatch,
}: {
  widget: WidgetMeta;
  isActive: boolean;
  onAdd: (id: string) => void;
  highlightMatch: (text: string) => React.ReactNode;
}) {
  return (
    <div
      className="flex items-center gap-2.5 rounded-md px-2.5 py-2 hover:bg-[#F8F9FA]"
      style={{ border: "1px solid transparent" }}
    >
      <span className="text-sm flex-shrink-0" aria-hidden="true">
        {widget.icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium truncate" style={{ color: "#1A1A2E" }}>
          {highlightMatch(widget.name)}
        </p>
        <p className="text-[11px] truncate" style={{ color: "#718096" }}>
          {highlightMatch(widget.description)}
        </p>
      </div>
      <button
        type="button"
        disabled={isActive}
        onClick={() => onAdd(widget.id)}
        aria-label={isActive ? `${widget.name} already active` : `Add ${widget.name}`}
        className="flex-shrink-0 rounded-md px-2 py-0.5 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1B6B5A] disabled:cursor-not-allowed disabled:opacity-40"
        style={{
          color: isActive ? "#718096" : "#1B6B5A",
          backgroundColor: isActive ? "transparent" : "rgba(27,107,90,0.08)",
        }}
      >
        +
      </button>
    </div>
  );
}
