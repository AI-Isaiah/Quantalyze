"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { DEFAULTS, type DiscoveryViewPreferences } from "@/lib/discovery-prefs";
import type { SortKey, SortDir } from "./StrategyFilters";

interface CustomizeDrawerProps {
  open: boolean;
  onClose: () => void;
  draft: DiscoveryViewPreferences;
  setDraft: (next: DiscoveryViewPreferences) => void;
  persisted: DiscoveryViewPreferences;
  onSave: () => void;
}

const SORT_KEY_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "sharpe", label: "Sharpe" },
  { value: "cagr", label: "CAGR" },
  { value: "cumulative_return", label: "Return" },
  { value: "max_drawdown", label: "Max Drawdown" },
  { value: "volatility", label: "Volatility" },
  { value: "aum", label: "AUM" },
  { value: "computed_at", label: "Last Synced" },
];

const SORT_DIR_OPTIONS: { value: SortDir; label: string }[] = [
  { value: "desc", label: "High to Low" },
  { value: "asc", label: "Low to High" },
];

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function CustomizeDrawer({
  open,
  onClose,
  draft,
  setDraft,
  persisted,
  onSave,
}: CustomizeDrawerProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const [entered, setEntered] = useState(false);

  // ESC closes.
  //
  // F9 H-1253: this listener lives on `document` — the SAME boundary as the Tab
  // trap below. The prior split (ESC on `window`, Tab on `document`) was the
  // worst of both worlds: in plain React DOM both fire, but a portal/dialog that
  // installs a stopPropagation at the document boundary would let ESC and the
  // Tab trap disagree about which events they see.
  //
  // F9 M-0061: cooperate with any nested modal/popover's own ESC handler. A
  // handler that already acted marks the event (`preventDefault`); we skip a
  // pre-handled ESC and claim the ones we act on so a single Escape doesn't
  // collapse multiple stacked layers at once.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (e.defaultPrevented) return;
      e.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Body scroll-lock while open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Initial focus + return-focus on close. Capture the active element
  // before moving focus into the drawer, restore it on cleanup so a
  // keyboard user lands back on the cog button that opened it.
  useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current =
      (document.activeElement as HTMLElement | null) ?? null;
    headingRef.current?.focus();
    return () => {
      const prev = previouslyFocusedRef.current;
      if (prev?.isConnected) prev.focus?.();
    };
  }, [open]);

  // Tab focus trap — cycles between first and last focusable. Also catches
  // any Tab fired before initial focus has landed and pulls it back inside.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const drawer = drawerRef.current;
      if (!drawer) return;
      const focusables = drawer.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (active && !drawer.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
        return;
      }
      if (e.shiftKey) {
        if (active === first || active === headingRef.current) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  // Slide-in: paint at translate-x-full on first render after open=true,
  // then rAF to translate-x-0 so the transition fires.
  useEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEntered(false);
      return;
    }
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, [open]);

  if (!open) return null;

  const dirty =
    draft.view !== persisted.view ||
    draft.hide_examples !== persisted.hide_examples ||
    draft.sort.key !== persisted.sort.key ||
    draft.sort.dir !== persisted.sort.dir;

  return (
    <div
      ref={drawerRef}
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-labelledby="customize-heading"
    >
      <div
        className={`absolute inset-0 bg-black/40 transition-opacity duration-300 ease-out motion-reduce:transition-none ${
          entered ? "opacity-100" : "opacity-0"
        }`}
        onClick={onClose}
        aria-hidden="true"
        data-testid="customize-backdrop"
      />
      <aside
        className={`relative z-10 w-full max-w-md bg-surface border-l border-border shadow-elevated overflow-y-auto transition-transform duration-300 ease-out motion-reduce:transition-none ${
          entered ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <header className="sticky top-0 bg-surface border-b border-border px-6 py-4 flex items-center justify-between">
          <h2
            ref={headingRef}
            id="customize-heading"
            tabIndex={-1}
            className="text-lg font-semibold text-text-primary rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Customize
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close customize panel"
            className="text-text-muted hover:text-text-primary transition-colors"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path
                d="M15 5L5 15M5 5l10 10"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>

        <div className="p-6 space-y-6">
          <p className="text-sm text-text-secondary">
            Set your default view, sort, and visibility on this category. Saved per device.
          </p>

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-text-secondary mb-3">
              Default view
            </h3>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setDraft({ ...draft, view: "table" })}
                className={`px-4 h-9 rounded border text-sm transition-colors ${
                  draft.view === "table"
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-border bg-surface text-text-secondary hover:bg-page"
                }`}
              >
                Table
              </button>
              <button
                type="button"
                onClick={() => setDraft({ ...draft, view: "grid" })}
                className={`px-4 h-9 rounded border text-sm transition-colors ${
                  draft.view === "grid"
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-border bg-surface text-text-secondary hover:bg-page"
                }`}
              >
                Grid
              </button>
            </div>
          </section>

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-text-secondary mb-3">
              Default sort
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <select
                value={draft.sort.key}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    sort: { ...draft.sort, key: e.target.value as SortKey },
                  })
                }
                className="h-9 px-3 rounded border border-border bg-surface text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                aria-label="Default sort key"
              >
                {SORT_KEY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <select
                value={draft.sort.dir}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    sort: { ...draft.sort, dir: e.target.value as SortDir },
                  })
                }
                className="h-9 px-3 rounded border border-border bg-surface text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                aria-label="Default sort direction"
              >
                {SORT_DIR_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </section>

          <section>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.hide_examples}
                onChange={(e) =>
                  setDraft({ ...draft, hide_examples: e.target.checked })
                }
                className="h-4 w-4 rounded border-border accent-accent focus-visible:ring-accent"
              />
              <span className="text-sm text-text-secondary">
                Hide example strategies
              </span>
            </label>
          </section>
        </div>

        <footer className="sticky bottom-0 bg-surface border-t border-border px-6 py-4 flex items-center gap-3">
          <Button
            variant="primary"
            onClick={onSave}
            disabled={!dirty}
            className="flex-1"
            aria-label="Save preferences"
          >
            Save preferences
          </Button>
          <Button variant="ghost" onClick={() => setDraft(DEFAULTS)}>
            Reset to defaults
          </Button>
        </footer>
      </aside>
    </div>
  );
}
