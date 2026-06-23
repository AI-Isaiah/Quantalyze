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
 * Phase 29 (UNIFY-05) — the UI copy surfaces the noun "portfolio" while the
 * persistence (the `scenarios` table + `/api/allocator/scenario/saved*` routes)
 * and all code/route/state names stay "scenario". Copy-only relabel; the
 * fetch URLs, the codec-trichotomy Open delegation, the Share affordance and
 * the Compare gate are byte-identical.
 *
 * Honesty + UI-SPEC invariants:
 *   - Empty list → EmptyStateCard whose heading MATCHES its body (the #509
 *     lesson) — "No saved portfolios yet".
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
  /**
   * Whether the row currently has an active (non-revoked) share link. Derived
   * from the saved-scenarios payload — the Share affordance reads this rather
   * than firing a per-row probe fetch (Plan 25-03). Absent → treated as no
   * active share. A successful generate/revoke transitions the per-row local
   * state immediately; the parent's onMutated refetch reconciles it.
   */
  has_active_share?: boolean;
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
  /**
   * True when the list GET failed (non-2xx or threw) AND no prior rows are
   * cached. When set with an empty `rows`, the list renders an honest ERROR
   * state ("Couldn't load…") instead of the "No saved portfolios yet" empty card
   * — an unloaded list must never masquerade as an empty list (a fabricated
   * fact, the #509 lesson). If `rows` is non-empty (a prior load succeeded),
   * the cached rows stay rendered and this flag is ignored.
   */
  listLoadError?: boolean;
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
  const c = created.getTime();
  const u = updated.getTime();
  const fmt = (d: Date) =>
    d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  // WR-04 (Phase 29 review): a malformed/empty timestamp column yields a NaN
  // getTime(); `NaN > NaN` is false, so the pre-fix code silently fell through
  // to `Saved <Invalid Date>` (fmt of an invalid Date renders the literal
  // string "Invalid Date" to the user). Guard explicitly: if neither timestamp
  // is finite, fall back to a bare "Saved" rather than printing "Invalid Date".
  if (!Number.isFinite(c) && !Number.isFinite(u)) return "Saved";
  // Prefer "Updated" only when BOTH are finite and updated is genuinely later;
  // otherwise show "Saved" off whichever timestamp is finite.
  if (Number.isFinite(u) && Number.isFinite(c) && u > c) {
    return `Updated ${fmt(updated)}`;
  }
  return `Saved ${fmt(Number.isFinite(c) ? created : updated)}`;
}

function validateName(raw: string): { name: string | null; error: string | null } {
  const trimmed = raw.trim();
  if (trimmed.length < 1)
    return { name: null, error: "Enter a name to save this portfolio." };
  if (trimmed.length > 120)
    return {
      name: null,
      error: "Portfolio names are limited to 120 characters.",
    };
  return { name: trimmed, error: null };
}

export function SavedScenariosList({
  rows,
  listLoadError = false,
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

  // --- Share affordance (Plan 25-03) ---
  // Per-row local override of the active-share state (keyed by row id). The
  // initial active-share state is DERIVED from row data (has_active_share); a
  // successful generate sets `true`, a successful revoke sets `false`. Reading
  // this map with the row default avoids a per-row probe fetch.
  const [shareActiveById, setShareActiveById] = useState<
    Record<string, boolean>
  >({});
  // The row id whose Share is currently generating (button disabled).
  const [generatingShareId, setGeneratingShareId] = useState<string | null>(
    null,
  );
  // The row id showing the transient "Link copied!" badge (role=status).
  const [copiedShareId, setCopiedShareId] = useState<string | null>(null);
  // The row id showing the transient "Copy failed" alert (clipboard failure;
  // the link IS still generated — audit-#43 honest failure).
  const [copyFailedShareId, setCopyFailedShareId] = useState<string | null>(
    null,
  );
  // The row id awaiting the inline Revoke confirmation.
  const [confirmingRevokeId, setConfirmingRevokeId] = useState<string | null>(
    null,
  );
  // The row id awaiting the inline "replace link" confirmation (the cache-miss
  // arm of Copy link — see copyExistingShare / WR-03).
  const [confirmingReplaceId, setConfirmingReplaceId] = useState<string | null>(
    null,
  );
  // Per-row cache of the raw share URL captured at generation (keyed by row id).
  // The generate route externalises the raw token EXACTLY ONCE (only its hash is
  // persisted, T-25-12), so the URL can never be re-fetched. Caching it for the
  // session lets "Copy link" hand out the SAME link without re-minting — which
  // would rotate the token and silently kill the recipient's existing link
  // (WR-03). Empty after a reload / for a share generated in a prior session.
  const [shareUrlById, setShareUrlById] = useState<Record<string, string>>({});

  // Whether a row currently has an active share: the local override wins, else
  // the row-data default. A row with no override and no row flag has none.
  const hasActiveShare = useCallback(
    (row: SavedScenarioListRow): boolean =>
      shareActiveById[row.id] ?? row.has_active_share ?? false,
    [shareActiveById],
  );

  // Clipboard discipline mirrors ShareableLink.tsx (audit-#43): try
  // navigator.clipboard, fall back to execCommand, and report success ONLY on a
  // real copy. Returns whether the copy actually succeeded.
  const copyToClipboard = useCallback(async (url: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(url);
      return true;
    } catch {
      // Fall through to the legacy execCommand path.
    }
    let fallbackSucceeded = false;
    const input = document.createElement("input");
    try {
      input.value = url;
      document.body.appendChild(input);
      input.select();
      fallbackSucceeded = document.execCommand("copy");
    } catch {
      fallbackSucceeded = false;
    } finally {
      if (input.parentNode) input.parentNode.removeChild(input);
    }
    return fallbackSucceeded;
  }, []);

  // Copy a URL and fire the transient copied (role=status) / copy-failed
  // (role=alert) badge for the row. The success badge fires ONLY on a real
  // clipboard success (audit-#43). Shared by generate and Copy link.
  const copyUrlWithBadge = useCallback(
    async (rowId: string, url: string | undefined) => {
      const copied = url ? await copyToClipboard(url) : false;
      if (copied) {
        setCopiedShareId(rowId);
        setCopyFailedShareId(null);
        setTimeout(() => setCopiedShareId(null), 2000);
      } else {
        setCopyFailedShareId(rowId);
        setTimeout(() => setCopyFailedShareId(null), 4000);
      }
    },
    [copyToClipboard],
  );

  const generateShare = useCallback(
    async (row: SavedScenarioListRow) => {
      setMutationError(null);
      setCopyFailedShareId(null);
      setGeneratingShareId(row.id);
      try {
        const res = await fetch("/api/allocator/scenario/share", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scenario_id: row.id }),
        });
        if (!res.ok) {
          // Honest failure — onMutated NOT fired (T_SL7b/T_SL7c contract).
          setMutationError("Couldn't create a share link. Try again.");
          return;
        }
        const { url } = (await res.json()) as { url?: string };
        // The link is now generated → the row is active regardless of whether
        // the clipboard write lands (audit-#43: never block the link on copy).
        setShareActiveById((prev) => ({ ...prev, [row.id]: true }));
        // Cache the raw URL for the session so a subsequent "Copy link" hands
        // out THIS link without re-minting (WR-03). The token is only returned
        // here once, so this is the only chance to capture it.
        if (url) setShareUrlById((prev) => ({ ...prev, [row.id]: url }));
        await copyUrlWithBadge(row.id, url);
        onMutated?.();
      } catch {
        setMutationError("Couldn't create a share link. Try again.");
      } finally {
        setGeneratingShareId(null);
      }
    },
    [copyUrlWithBadge, onMutated],
  );

  const copyExistingShare = useCallback(
    async (row: SavedScenarioListRow) => {
      setMutationError(null);
      const cachedUrl = shareUrlById[row.id];
      if (cachedUrl) {
        // Copy the SAME link generated this session — no re-mint, no token
        // rotation, so a recipient's existing link keeps working (WR-03 fix).
        setCopyFailedShareId(null);
        await copyUrlWithBadge(row.id, cachedUrl);
        return;
      }
      // Cache miss (active share from a prior session / after a reload): the raw
      // token was externalised exactly once at generation and is never
      // re-fetchable (hash-only storage, T-25-12), so the existing link cannot
      // be reproduced. Minting a new one is the only way to hand out a working
      // URL — but that revokes the old link, so it must be EXPLICIT, never
      // silent. Surface the replace-confirm instead of regenerating.
      setRenamingId(null);
      setConfirmingDeleteId(null);
      setConfirmingRevokeId(null);
      setConfirmingReplaceId(row.id);
    },
    [shareUrlById, copyUrlWithBadge],
  );

  const confirmRevoke = useCallback(
    async (row: SavedScenarioListRow) => {
      setMutationError(null);
      try {
        const res = await fetch("/api/allocator/scenario/share/revoke", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scenario_id: row.id }),
        });
        // 404 is CONVERGENCE-to-revoked, not a failure: the revoke route returns
        // 404 when there is no active share to revoke (a benign double-revoke
        // across two tabs, a stale has_active_share flag, or an already-expired
        // share). The share IS gone — the end-state matches a 200, so transition
        // the row to no-active-share, clear the confirm, fire onMutated, and
        // suppress the misleading error toast. The route's 404 contract is
        // unchanged (it preserves the no-existence-oracle posture); the client
        // simply stops treating "already revoked" as "revoke failed".
        if (!res.ok && res.status !== 404) {
          // Honest failure — the share stays active, onMutated NOT fired.
          // Dismiss the inline confirm so the still-active Copy link + Revoke
          // controls surface alongside the role=alert error.
          setMutationError("Couldn't revoke this link. Try again.");
          setConfirmingRevokeId(null);
          return;
        }
        setShareActiveById((prev) => ({ ...prev, [row.id]: false }));
        // Drop the cached URL — the link is dead; a stale entry must never let
        // "Copy link" hand out a revoked URL.
        setShareUrlById((prev) => {
          if (!(row.id in prev)) return prev;
          const next = { ...prev };
          delete next[row.id];
          return next;
        });
        setConfirmingRevokeId(null);
        onMutated?.();
      } catch {
        setMutationError("Couldn't revoke this link. Try again.");
        setConfirmingRevokeId(null);
      }
    },
    [onMutated],
  );

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
          setMutationError("Couldn't rename this portfolio. Try again.");
          return;
        }
        setLocalRows((prev) =>
          prev.map((r) => (r.id === row.id ? { ...r, name } : r)),
        );
        setRenamingId(null);
        setRenameValue("");
        onMutated?.();
      } catch {
        setMutationError("Couldn't rename this portfolio. Try again.");
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
          setMutationError("Couldn't delete this portfolio. Try again.");
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
        setMutationError("Couldn't delete this portfolio. Try again.");
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
    <section className="space-y-3" aria-labelledby="saved-portfolios-heading">
      <h2
        id="saved-portfolios-heading"
        className="text-base font-semibold text-text-primary"
      >
        Saved portfolios
      </h2>

      {listLoadError && localRows.length === 0 ? (
        // Hard load failure with nothing cached → honest ERROR state (canonical
        // error path, role="alert"), NOT the "No saved portfolios yet" empty card
        // (which would fabricate "you have no portfolios" from a transport
        // failure — the #509 heading/body honesty lesson).
        <div
          role="alert"
          className="rounded-md border border-negative/40 bg-surface px-4 py-3 text-sm text-negative"
        >
          Couldn&apos;t load your saved portfolios. Try again.
        </div>
      ) : localRows.length === 0 ? (
        <EmptyStateCard
          heading="No saved portfolios yet"
          body={
            'Compose a draft above, then choose "Save portfolio" to keep it here. ' +
            "Saved portfolios reopen into the composer and can be compared side-by-side."
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
              const isConfirmingRevoke = confirmingRevokeId === row.id;
              const isConfirmingReplace = confirmingReplaceId === row.id;
              const rowShareActive = hasActiveShare(row);
              const isGenerating = generatingShareId === row.id;
              const isCopied = copiedShareId === row.id;
              const isCopyFailed = copyFailedShareId === row.id;
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
                          aria-label={`Rename portfolio ${row.name}`}
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
                    ) : isConfirmingRevoke ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-text-secondary">
                          Revoke this share link? Anyone with the link will lose
                          access.
                        </span>
                        <Button
                          variant="danger"
                          size="sm"
                          autoFocus
                          onClick={() => confirmRevoke(row)}
                        >
                          Revoke
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setConfirmingRevokeId(null)}
                        >
                          Keep link
                        </Button>
                      </div>
                    ) : isConfirmingReplace ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-text-secondary">
                          This link&apos;s URL can&apos;t be shown again.
                          Generate a new link? The previous link will stop
                          working.
                        </span>
                        <Button
                          variant="primary"
                          size="sm"
                          autoFocus
                          disabled={isGenerating}
                          onClick={() => {
                            setConfirmingReplaceId(null);
                            generateShare(row);
                          }}
                        >
                          {isGenerating ? "Generating…" : "Generate new link"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setConfirmingReplaceId(null)}
                        >
                          Keep current link
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
                        {/* Share affordance (Plan 25-03). State machine:
                            none → Share; active → Copy link + Revoke. The
                            transient copied (role=status) / copy-failed
                            (role=alert) badges sit ALONGSIDE the controls so a
                            just-generated share settles straight to its active
                            controls (the badge fades on its timer). */}
                        {rowShareActive ? (
                          <>
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={isGenerating}
                              onClick={() => copyExistingShare(row)}
                            >
                              {isGenerating ? "Generating…" : "Copy link"}
                            </Button>
                            <Button
                              variant="danger"
                              size="sm"
                              onClick={() => {
                                setRenamingId(null);
                                setConfirmingDeleteId(null);
                                setConfirmingRevokeId(row.id);
                              }}
                            >
                              Revoke
                            </Button>
                          </>
                        ) : (
                          <Button
                            variant="primary"
                            size="sm"
                            disabled={isGenerating}
                            onClick={() => generateShare(row)}
                          >
                            {isGenerating ? "Generating…" : "Share"}
                          </Button>
                        )}
                        {isCopied && (
                          <span
                            role="status"
                            aria-live="polite"
                            className="inline-flex items-center gap-1 px-1 text-xs text-positive"
                          >
                            <svg
                              className="h-3.5 w-3.5"
                              viewBox="0 0 16 16"
                              fill="currentColor"
                              aria-hidden="true"
                            >
                              <path
                                fillRule="evenodd"
                                d="M8 15A7 7 0 108 1a7 7 0 000 14zm3.28-8.72a.75.75 0 00-1.06-1.06L7 8.44 5.78 7.22a.75.75 0 00-1.06 1.06l1.75 1.75a.75.75 0 001.06 0l3.75-3.75z"
                                clipRule="evenodd"
                              />
                            </svg>
                            Link copied!
                          </span>
                        )}
                        {isCopyFailed && (
                          <span
                            role="alert"
                            className="inline-flex items-center gap-1 px-1 text-xs text-negative"
                          >
                            <svg
                              className="h-3.5 w-3.5"
                              viewBox="0 0 16 16"
                              fill="currentColor"
                              aria-hidden="true"
                            >
                              <path
                                fillRule="evenodd"
                                d="M8 15A7 7 0 108 1a7 7 0 000 14zm0-10a.75.75 0 01.75.75v3a.75.75 0 01-1.5 0v-3A.75.75 0 018 5zm0 6.5a.75.75 0 100-1.5.75.75 0 000 1.5z"
                                clipRule="evenodd"
                              />
                            </svg>
                            Copy failed — copy the link manually
                          </span>
                        )}
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
                Select 2 or more portfolios (or the live book) to compare.
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
