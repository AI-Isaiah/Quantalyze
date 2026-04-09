"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * "Save as Test Portfolio" modal for the My Allocation page.
 *
 * Triggered from the Favorites panel when the allocator has toggled some
 * watchlist strategies on and wants to persist the what-if combination
 * to come back to later. Minimum friction: auto-fills a name derived
 * from the active favorites, accepts optional notes, one click to save.
 *
 * On save:
 *   1. POST to /api/test-portfolios with {name, description, strategyIds}
 *   2. Close the modal, show a toast (caller handles)
 *   3. Router refresh so the Test Portfolios list picks up the new row
 *   4. The favorites stay toggled ON behind the modal so the allocator
 *      can keep exploring without losing their state
 *
 * Failure: display inline error, keep the modal open, keep the form
 * populated. The partial unique index from migration 023 does NOT block
 * this insert because is_test = true bypasses it — any other failure
 * (auth, RLS, network) surfaces as an error message.
 */

interface SaveAsTestModalProps {
  open: boolean;
  onClose: () => void;
  /**
   * Ordered list of strategy IDs that should be copied into the new test
   * portfolio. The API builds portfolio_strategies rows from this list.
   */
  strategyIds: string[];
  /**
   * Suggested default name assembled from the real portfolio + active
   * favorites. Displayed pre-filled in the name input, editable.
   */
  defaultName: string;
  /**
   * Optional callback after a successful save, with the new portfolio
   * id. Typically the parent uses this to show a toast with a [View]
   * link to /portfolios/<id>.
   */
  onSaved?: (portfolioId: string) => void;
}

export function SaveAsTestModal({
  open,
  onClose,
  strategyIds,
  defaultName,
  onSaved,
}: SaveAsTestModalProps) {
  const [name, setName] = useState(defaultName);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Reset state when the modal opens (fresh form each save).
  useEffect(() => {
    if (open) {
      setName(defaultName);
      setNotes("");
      setError(null);
      // Autofocus the name input after the modal mounts.
      setTimeout(() => nameInputRef.current?.focus(), 50);
    }
  }, [open, defaultName]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    if (strategyIds.length === 0) {
      setError("Toggle at least one favorite to save a test portfolio");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/test-portfolios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: notes.trim() || null,
          strategyIds,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Save failed (${res.status})`);
      }
      const body = (await res.json()) as { id: string };
      router.refresh();
      onClose();
      if (onSaved) onSaved(body.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="save-test-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-text-primary/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md bg-surface border border-border rounded-lg shadow-lg">
        <form onSubmit={handleSubmit}>
          <div className="flex items-start justify-between p-5 border-b border-border">
            <h2
              id="save-test-modal-title"
              className="text-lg font-semibold text-text-primary"
            >
              Save as Test Portfolio
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="text-text-muted hover:text-text-primary"
              aria-label="Close"
            >
              ×
            </button>
          </div>
          <div className="p-5 space-y-4">
            <label className="block">
              <span className="text-[10px] uppercase tracking-wider text-text-muted font-medium">
                Name
              </span>
              <input
                ref={nameInputRef}
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:border-border-focus"
                required
              />
            </label>
            <label className="block">
              <span className="text-[10px] uppercase tracking-wider text-text-muted font-medium">
                Notes (optional)
              </span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:border-border-focus resize-none"
              />
            </label>
            <p className="text-xs text-text-muted">
              This saves the current toggled favorites as a hypothetical
              portfolio. It will not affect your real book.
            </p>
            {error && (
              <p className="text-xs text-negative bg-negative/5 rounded px-2 py-1 border border-negative/10">
                {error}
              </p>
            )}
          </div>
          <div className="flex items-center justify-end gap-2 p-5 border-t border-border">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center rounded-md border border-border px-4 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-secondary transition-colors"
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {submitting ? "Saving…" : "Save test"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
