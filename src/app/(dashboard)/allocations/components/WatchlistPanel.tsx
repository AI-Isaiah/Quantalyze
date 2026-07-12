"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { TrustTierLabel } from "@/components/strategy/TrustTierLabel";
import { TRUST_TIER_TOKENS, type TrustTier } from "@/lib/design-tokens/trust-tier";
import { cn } from "@/lib/utils";
import type { FavoriteRow } from "../lib/watchlist-read";

/**
 * PI-05 (favorites half) — the /allocations Watchlist panel. Renders the
 * allocator's real `user_favorites` rows as a dense table (UI-SPEC W2), with
 * recency/name sort, an optional real trust-tier grouping, and a bulk-remove
 * that loops the EXISTING idempotent `PUT /api/watchlist/[strategyId]`
 * (one call per id, per-row rollback on partial failure). No page wiring here
 * (that is plan 100-04) — this is a self-contained client component.
 *
 * Honesty invariants (UI-SPEC / no-invented-data):
 *   - Honest-empty copy, zero ghost rows.
 *   - Grouping is ONLY by real `trust_tier`; no invented asset-class/style groups.
 *   - Bulk remove is a reversible action → plain secondary button (no red).
 */

type SortMode = "recency" | "name";
type GroupMode = "none" | "tier";

/** Group order for the trust-tier grouping; null tier falls into "Unverified". */
const TIER_ORDER: TrustTier[] = ["api_verified", "csv_uploaded", "self_reported"];

function tierLabel(tier: TrustTier | null): string {
  return tier == null ? "Unverified" : TRUST_TIER_TOKENS[tier].label;
}

async function putRemove(strategyId: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/watchlist/${strategyId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "remove" }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function WatchlistPanel({
  favorites,
  suggestedIds,
}: {
  favorites: FavoriteRow[];
  suggestedIds: string[];
}) {
  const [rows, setRows] = useState<FavoriteRow[]>(favorites);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<SortMode>("recency");
  const [group, setGroup] = useState<GroupMode>("none");
  const [status, setStatus] = useState("");
  const suggested = useMemo(() => new Set(suggestedIds), [suggestedIds]);

  const sorted = useMemo(() => {
    const list = [...rows];
    if (sort === "name") {
      list.sort((a, b) => a.name.localeCompare(b.name));
    } else {
      // Recency: most-recently favorited first (server already orders desc,
      // re-sort defensively so a post-rollback merge keeps the order).
      list.sort((a, b) => b.created_at.localeCompare(a.created_at));
    }
    return list;
  }, [rows, sort]);

  const heading = (
    <div className="mb-4">
      <h3 className="text-h3 font-semibold text-text-primary">Watchlist</h3>
      <p className="mt-0.5 text-caption text-text-muted">
        Strategies you&apos;re tracking but haven&apos;t allocated to.
      </p>
    </div>
  );

  // Red-team F-3: the live region is hoisted OUT of the table branch and mounted
  // by the always-rendered Card, so it survives a bulk-remove that empties the
  // list (`rows.length === 0`). If it lived only in the table branch, emptying
  // the list would unmount it and the "Removed N…" announcement — set AFTER the
  // optimistic row removal — would never reach a screen reader.
  const liveRegion = (
    <p role="status" aria-live="polite" className="sr-only">
      {status}
    </p>
  );

  // Honest-empty — heading kept, verbatim copy, browse link; NO table.
  const emptyState = (
    <>
      <p className="text-small text-text-secondary">
        No favorites yet. Star strategies in Discovery to build your watchlist.
      </p>
      <Link
        href="/discovery"
        className="mt-4 inline-flex items-center justify-center rounded-lg border border-border bg-white px-3 py-1.5 text-caption font-medium text-text-primary transition-colors hover:bg-page"
      >
        Browse strategies →
      </Link>
    </>
  );

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allSelected = sorted.length > 0 && sorted.every((r) => selected.has(r.strategy_id));
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(sorted.map((r) => r.strategy_id)));
  }

  /**
   * Remove `ids` optimistically, then reconcile: issue one idempotent PUT per
   * id, roll back only the rows whose PUT failed, and announce the count that
   * actually removed. Successes stay removed (partial-failure safe).
   */
  async function removeIds(ids: string[]) {
    const snapshot = rows.filter((r) => ids.includes(r.strategy_id));
    setRows((prev) => prev.filter((r) => !ids.includes(r.strategy_id)));
    setSelected(new Set());

    const failed: FavoriteRow[] = [];
    let success = 0;
    for (const id of ids) {
      const ok = await putRemove(id);
      if (ok) success += 1;
      else {
        const row = snapshot.find((r) => r.strategy_id === id);
        if (row) failed.push(row);
      }
    }

    if (failed.length > 0) {
      setRows((prev) =>
        [...prev, ...failed].sort((a, b) => b.created_at.localeCompare(a.created_at)),
      );
    }
    // Red-team F-3: announce failures too — a silent partial rollback left the
    // user believing every selected row was removed.
    setStatus(
      failed.length > 0
        ? `Removed ${success}, ${failed.length} failed — restored to list`
        : `Removed ${success} from watchlist`,
    );
  }

  const controls = (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-4">
        <Segmented
          label="Sort"
          value={sort}
          options={[
            { value: "recency", label: "Recently added" },
            { value: "name", label: "Name A–Z" },
          ]}
          onChange={(v) => setSort(v as SortMode)}
        />
        <Segmented
          label="Group"
          value={group}
          options={[
            { value: "none", label: "None" },
            { value: "tier", label: "Verification tier" },
          ]}
          onChange={(v) => setGroup(v as GroupMode)}
        />
      </div>
      {selected.size > 0 && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => removeIds(Array.from(selected))}
        >
          Remove {selected.size} from watchlist
        </Button>
      )}
    </div>
  );

  const header = (
    <thead>
      <tr className="border-b border-border text-left">
        <th className="w-11 py-2 pl-1">
          <input
            type="checkbox"
            className="h-5 w-5 accent-accent"
            aria-label="Select all"
            checked={allSelected}
            onChange={toggleAll}
          />
        </th>
        <th className="py-2 text-micro font-medium uppercase tracking-wider text-text-muted">
          Strategy
        </th>
        <th className="py-2 text-micro font-medium uppercase tracking-wider text-text-muted">
          Added
        </th>
        <th className="py-2 text-micro font-medium uppercase tracking-wider text-text-muted">
          Suggested
        </th>
        <th className="py-2 pr-1 text-right text-micro font-medium uppercase tracking-wider text-text-muted">
          <span className="sr-only">Watchlist toggle</span>
        </th>
      </tr>
    </thead>
  );

  const renderRow = (row: FavoriteRow) => (
    <tr key={row.strategy_id} className="border-b border-border/60 hover:bg-page">
      <td className="py-2.5 pl-1">
        <input
          type="checkbox"
          className="h-5 w-5 accent-accent"
          aria-label={row.name}
          checked={selected.has(row.strategy_id)}
          onChange={() => toggleRow(row.strategy_id)}
        />
      </td>
      <td className="py-2.5 pr-3">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/factsheet/${row.strategy_id}`}
            data-testid="watchlist-name"
            className="text-small font-medium text-accent hover:text-accent-hover hover:underline"
          >
            {row.name}
          </Link>
          <TrustTierLabel trustTier={row.trust_tier} />
        </div>
      </td>
      <td className="py-2.5 pr-3 font-mono text-caption tabular-nums text-text-muted">
        {row.created_at.slice(0, 10)}
      </td>
      <td className="py-2.5 pr-3">
        {suggested.has(row.strategy_id) && (
          <span
            data-testid="suggested-chip"
            className="inline-flex items-center rounded-sm border border-accent px-1.5 py-0.5 text-micro font-medium uppercase tracking-wider text-accent"
          >
            Suggested
          </span>
        )}
      </td>
      <td className="py-2.5 pr-1 text-right">
        <button
          type="button"
          aria-pressed
          aria-label={`Remove ${row.name} from watchlist`}
          onClick={() => removeIds([row.strategy_id])}
          className="inline-flex h-11 w-11 items-center justify-center text-accent transition-colors hover:text-accent-hover"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden="true">
            <path d="M10 1.5l2.472 5.008 5.528.803-4 3.898.944 5.505L10 14.115l-4.944 2.599.944-5.505-4-3.898 5.528-.803L10 1.5z" />
          </svg>
        </button>
      </td>
    </tr>
  );

  const body =
    group === "tier" ? (
      // One <tbody> per real trust tier (role="rowgroup", aria-labelled) so the
      // grouping is keyboard/AT-navigable — real trust_tier only, never invented.
      [...TIER_ORDER, null].map((tier) => {
        const groupRows = sorted.filter((r) => r.trust_tier === tier);
        if (groupRows.length === 0) return null;
        const label = tierLabel(tier);
        return (
          <tbody key={label} aria-label={label}>
            <tr>
              <td
                colSpan={5}
                className="pt-4 pb-1 text-micro font-semibold uppercase tracking-wider text-text-muted"
              >
                {label}
              </td>
            </tr>
            {groupRows.map(renderRow)}
          </tbody>
        );
      })
    ) : (
      <tbody>{sorted.map(renderRow)}</tbody>
    );

  return (
    <Card>
      {heading}
      {/* Stable across both states so bulk-remove announcements survive an
          empty transition (F-3). */}
      {liveRegion}
      {rows.length === 0 ? (
        emptyState
      ) : (
        <>
          {controls}
          <table className="w-full border-collapse">
            {header}
            {body}
          </table>
        </>
      )}
    </Card>
  );
}

function Segmented({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-micro font-medium uppercase tracking-wider text-text-muted">
        {label}
      </span>
      <div className="inline-flex rounded-md border border-border p-0.5">
        {options.map((opt) => {
          const active = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(opt.value)}
              className={cn(
                "rounded px-2 py-1 text-caption font-medium transition-colors",
                active
                  ? "bg-accent text-white"
                  : "text-text-secondary hover:bg-page",
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
