"use client";

import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyStateCard } from "@/components/ui/EmptyStateCard";
import { cn } from "@/lib/utils";

/**
 * Plan 23-05 (PERSIST-03) — the saved-scenarios list on the Scenario tab.
 *
 * One row per saved scenario: a name-labeled selection checkbox + the name +
 * a saved/updated timestamp, with Open (ghost) · Rename (inline edit → PATCH) ·
 * Delete (small inline danger confirm → DELETE) affordances. A "Live book"
 * pseudo-row participates in selection; the "Compare selected" CTA enables at
 * >= 2 selections (incl. the live book) and raises the selected rows +
 * includeLiveBook flag to the parent (which mounts ScenarioComparePanel).
 *
 * Honesty + UI-SPEC invariants:
 *   - Empty list → EmptyStateCard whose heading MATCHES its body (the #509
 *     lesson) — "No saved scenarios yet".
 *   - Rename / Delete are INLINE (no modal): Rename reveals a text input that
 *     PATCHes the trimmed name (1..120, else the validation copy + no PATCH);
 *     Delete reveals a small "Delete "{name}"?" danger confirm.
 *   - List rows do NOT stamp N / overlap — N is a per-COLUMN stamp in the
 *     compare table (the list GET returns metadata only).
 *   - Only UI-SPEC tokens/copy; no new icons.
 */

/** A row from GET /api/allocator/scenario/saved, carrying its draft for Open/Compare. */
export interface SavedScenarioListRow {
  id: string;
  name: string;
  schema_version: number;
  created_at: string;
  updated_at: string;
  /** The persisted draft JSONB — decoded by the composer's codec on Open. */
  draft: unknown;
}

/** The shape the composer's imperative Open handler consumes (Plan 04). */
export interface SavedScenarioOpenRow {
  id: string;
  name: string;
  draft: unknown;
}

export interface CompareSelection {
  /** The selected SAVED rows (excludes the live-book pseudo-row). */
  rows: SavedScenarioListRow[];
  /** Whether the "Live book" pseudo-row is part of the selection. */
  includeLiveBook: boolean;
}

interface SavedScenariosListProps {
  rows: SavedScenarioListRow[];
  /** Delegates a row to the composer's codec-trichotomy Open handler (Plan 04). */
  onOpen: (row: SavedScenarioOpenRow) => void;
  /** Raises the >= 2 compare selection to the parent (mounts the compare panel). */
  onCompare: (selection: CompareSelection) => void;
  /** Called after a rename/delete mutation succeeds so the parent can refetch. */
  onMutated?: () => void;
}

const LIVE_BOOK_KEY = "__live_book__";

function timestampLabel(row: SavedScenarioListRow): string {
  // Updated time when it differs from created (a real edit), else "saved".
  const created = new Date(row.created_at);
  const updated = new Date(row.updated_at);
  const fmt = (d: Date) =>
    d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  return updated.getTime() > created.getTime()
    ? `Updated ${fmt(updated)}`
    : `Saved ${fmt(created)}`;
}

function validateName(raw: string): { name: string | null; error: string | null } {
  const trimmed = raw.trim();
  if (trimmed.length < 1)
    return { name: null, error: "Enter a name to save this scenario." };
  if (trimmed.length > 120)
    return {
      name: null,
      error: "Scenario names are limited to 120 characters.",
    };
  return { name: trimmed, error: null };
}

export function SavedScenariosList({
  rows,
  onOpen,
  onCompare,
  onMutated,
}: SavedScenariosListProps) {
  // Local mirror of the rows so an optimistic rename/delete reflects without a
  // round-trip; the parent still refetches via onMutated for consistency.
  const [localRows, setLocalRows] = useState<SavedScenarioListRow[]>(rows);
  // Keep the mirror in sync when the parent passes a fresh list (refetch). The
  // "derive state during render on a key change" pattern (React docs: storing
  // information from previous renders) avoids an effect round-trip.
  const rowsKey = useMemo(
    () => rows.map((r) => `${r.id}:${r.updated_at}`).join("|"),
    [rows],
  );
  const [lastRowsKey, setLastRowsKey] = useState(rowsKey);
  if (rowsKey !== lastRowsKey) {
    setLastRowsKey(rowsKey);
    setLocalRows(rows);
  }

  // Selection: a set of row ids (real rows) plus the live-book pseudo-row.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Inline rename state: the row id being renamed + its draft input + error.
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  // Inline delete-confirm state: the row id awaiting confirmation.
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(
    null,
  );
  // A hard mutation failure → the canonical error copy.
  const [mutationError, setMutationError] = useState<string | null>(null);

  const toggleSelected = useCallback((key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const beginRename = useCallback((row: SavedScenarioListRow) => {
    setConfirmingDeleteId(null);
    setRenamingId(row.id);
    setRenameValue(row.name);
    setRenameError(null);
  }, []);

  const submitRename = useCallback(
    async (row: SavedScenarioListRow) => {
      const { name, error } = validateName(renameValue);
      if (error || name === null) {
        setRenameError(error);
        return;
      }
      setMutationError(null);
      try {
        const res = await fetch(`/api/allocator/scenario/saved/${row.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        if (!res.ok) {
          setMutationError("Couldn't rename this scenario. Try again.");
          return;
        }
        setLocalRows((prev) =>
          prev.map((r) => (r.id === row.id ? { ...r, name } : r)),
        );
        setRenamingId(null);
        setRenameValue("");
        onMutated?.();
      } catch {
        setMutationError("Couldn't rename this scenario. Try again.");
      }
    },
    [renameValue, onMutated],
  );

  const confirmDelete = useCallback(
    async (row: SavedScenarioListRow) => {
      setMutationError(null);
      try {
        const res = await fetch(`/api/allocator/scenario/saved/${row.id}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          setMutationError("Couldn't delete this scenario. Try again.");
          return;
        }
        setLocalRows((prev) => prev.filter((r) => r.id !== row.id));
        setSelected((prev) => {
          const next = new Set(prev);
          next.delete(row.id);
          return next;
        });
        setConfirmingDeleteId(null);
        onMutated?.();
      } catch {
        setMutationError("Couldn't delete this scenario. Try again.");
      }
    },
    [onMutated],
  );

  // Compare gating: live book + selected real rows, enabled at >= 2.
  const includeLiveBook = selected.has(LIVE_BOOK_KEY);
  const selectedRows = localRows.filter((r) => selected.has(r.id));
  const selectionCount = selectedRows.length + (includeLiveBook ? 1 : 0);
  const compareEnabled = selectionCount >= 2;

  const raiseCompare = useCallback(() => {
    if (!compareEnabled) return;
    onCompare({ rows: selectedRows, includeLiveBook });
  }, [compareEnabled, onCompare, selectedRows, includeLiveBook]);

  return (
    <section className="space-y-3" aria-labelledby="saved-scenarios-heading">
      <h2
        id="saved-scenarios-heading"
        className="text-base font-semibold text-text-primary"
      >
        Saved scenarios
      </h2>

      {localRows.length === 0 ? (
        <EmptyStateCard
          heading="No saved scenarios yet"
          body={
            'Compose a draft above, then choose "Save scenario" to keep it here. ' +
            "Saved scenarios reopen into the composer and can be compared side-by-side."
          }
        />
      ) : (
        <>
          <ul className="space-y-2">
            {/* Live book pseudo-row — participates in selection only. */}
            <li className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-border text-accent focus:ring-2 focus:ring-accent/50"
                  checked={includeLiveBook}
                  onChange={() => toggleSelected(LIVE_BOOK_KEY)}
                  aria-label="Live book"
                />
                <span className="text-sm text-text-primary">Live book</span>
                <span className="text-xs text-text-muted">
                  (your current actual blend)
                </span>
              </label>
            </li>

            {localRows.map((row) => {
              const isRenaming = renamingId === row.id;
              const isConfirmingDelete = confirmingDeleteId === row.id;
              return (
                <li
                  key={row.id}
                  data-testid="saved-scenario-row"
                  className="flex items-center justify-between gap-3 rounded-md border border-border p-3"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-border text-accent focus:ring-2 focus:ring-accent/50"
                      checked={selected.has(row.id)}
                      onChange={() => toggleSelected(row.id)}
                      aria-label={row.name}
                    />
                    {isRenaming ? (
                      <div className="flex flex-col gap-1">
                        <input
                          type="text"
                          aria-label={`Rename scenario ${row.name}`}
                          value={renameValue}
                          onChange={(e) => {
                            setRenameValue(e.target.value);
                            setRenameError(null);
                          }}
                          className="rounded-md border border-border px-2 py-1 text-sm focus:border-focus focus:outline-none focus:ring-2 focus:ring-accent/50"
                        />
                        {renameError && (
                          <span className="text-xs text-negative">
                            {renameError}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="flex flex-col min-w-0">
                        <span className="truncate text-sm text-text-primary">
                          {row.name}
                        </span>
                        <span className="text-xs text-text-muted">
                          {timestampLabel(row)}
                        </span>
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {isRenaming ? (
                      <>
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => submitRename(row)}
                        >
                          Save
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setRenamingId(null);
                            setRenameError(null);
                          }}
                        >
                          Cancel
                        </Button>
                      </>
                    ) : isConfirmingDelete ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-text-secondary">
                          Delete &quot;{row.name}&quot;?
                        </span>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => confirmDelete(row)}
                        >
                          Delete
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setConfirmingDeleteId(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            onOpen({
                              id: row.id,
                              name: row.name,
                              draft: row.draft,
                            })
                          }
                        >
                          Open
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => beginRename(row)}
                        >
                          Rename
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-negative hover:bg-page"
                          onClick={() => {
                            setRenamingId(null);
                            setConfirmingDeleteId(row.id);
                          }}
                        >
                          Delete
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          {mutationError && (
            <p role="alert" className="text-xs text-negative">
              {mutationError}
            </p>
          )}

          <div className="flex flex-col gap-1">
            <Button
              variant="secondary"
              size="sm"
              disabled={!compareEnabled}
              onClick={raiseCompare}
              className="self-start"
            >
              Compare selected
            </Button>
            {!compareEnabled && (
              <p className={cn("text-xs text-text-muted")}>
                Select 2 or more scenarios (or the live book) to compare.
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
