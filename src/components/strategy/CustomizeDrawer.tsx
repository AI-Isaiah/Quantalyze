"use client";

/**
 * Phase 13 / Plan 13-02 / DISCO-02 — CustomizeDrawer.
 *
 * Right-edge slide-out drawer that edits the allocator's per-category
 * Default view / Default sort / Hide examples preferences. Mirrors the
 * existing All-Filters slide-out at `StrategyFilters.tsx:411-575` for
 * visual consistency, but is bespoke (no `<Modal>` primitive — UI-SPEC
 * mandates an edge drawer).
 *
 * State machine (from 13-UI-SPEC.md State Matrix):
 *   - open=false → returns null
 *   - open=true → role="dialog" + aria-modal=true, ESC closes,
 *     backdrop click closes, body scroll locked
 *   - Save disabled until JSON.stringify(draft) !== JSON.stringify(persisted)
 *   - Reset replaces draft with DEFAULTS but does NOT close
 *   - Save click delegates to parent's onSave (commits to localStorage
 *     via useDiscoveryPrefs.setPrefs and closes the drawer)
 *
 * Copywriting contract (UI-SPEC):
 *   - heading: "Customize"
 *   - description: "Set your default view, sort, and visibility on this
 *     category. Saved per device."
 *   - primary CTA visible text + aria-label both = "Save preferences"
 *     (WCAG 2.5.3 — Label in Name)
 *   - secondary action: "Reset to defaults"
 *   - close-X aria-label: "Close customize panel"
 */

import { useEffect } from "react";

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

export function CustomizeDrawer({
  open,
  onClose,
  draft,
  setDraft,
  persisted,
  onSave,
}: CustomizeDrawerProps) {
  // ESC closes
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
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

  if (!open) return null;

  const dirty = JSON.stringify(draft) !== JSON.stringify(persisted);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-labelledby="customize-heading"
    >
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside className="relative z-10 w-full max-w-md bg-surface border-l border-border shadow-elevated overflow-y-auto">
        <header className="sticky top-0 bg-surface border-b border-border px-6 py-4 flex items-center justify-between">
          <h2
            id="customize-heading"
            className="text-lg font-semibold text-text-primary"
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

          {/* Default view */}
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

          {/* Default sort */}
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

          {/* Hide examples toggle */}
          <section>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.hide_examples}
                onChange={(e) =>
                  setDraft({ ...draft, hide_examples: e.target.checked })
                }
                className="h-4 w-4 rounded border-border text-accent focus-visible:ring-accent"
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
