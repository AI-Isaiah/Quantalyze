"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

// ─── Types ──────────────────────────────────────────────────────────────

interface AllocatorRow {
  id: string;
  display_name: string;
  company: string | null;
  email: string | null;
  role: string;
  mandate_archetype: string | null;
  has_founder_notes: boolean;
  latest_batch: {
    id: string;
    computed_at: string;
    mode: "personalized" | "screening";
    candidate_count: number;
    filter_relaxed: boolean;
  } | null;
  hours_since_recompute: number | null;
  days_since_last_intro: number | null;
  needs_attention: boolean;
  is_stale: boolean;
  zero_decisions: boolean;
  triage_score: number;
}

type Filter = "needs_attention" | "new_candidates" | "snoozed" | "all";

// ─── Component ──────────────────────────────────────────────────────────

export function MatchQueueIndex() {
  const [allocators, setAllocators] = useState<AllocatorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("needs_attention");
  const [killSwitch, setKillSwitch] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [allocatorsRes, killSwitchRes] = await Promise.all([
        fetch("/api/admin/match/allocators"),
        fetch("/api/admin/match/kill-switch"),
      ]);
      if (!allocatorsRes.ok) throw new Error("Failed to load allocators");
      if (!killSwitchRes.ok) throw new Error("Failed to load kill switch");
      const { allocators: rows } = await allocatorsRes.json();
      const { enabled } = await killSwitchRes.json();
      setAllocators(rows ?? []);
      setKillSwitch(enabled);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    let rows = allocators;
    if (filter === "needs_attention") {
      rows = rows.filter((r) => r.needs_attention || r.is_stale || r.zero_decisions);
    } else if (filter === "new_candidates") {
      rows = rows.filter(
        (r) => r.latest_batch !== null && r.latest_batch.candidate_count > 0,
      );
    } else if (filter === "snoozed") {
      // Placeholder: snoozed = no recent batch and no recent intro
      rows = rows.filter((r) => !r.needs_attention);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(
        (r) =>
          r.display_name?.toLowerCase().includes(q) ||
          (r.company ?? "").toLowerCase().includes(q) ||
          (r.email ?? "").toLowerCase().includes(q) ||
          (r.mandate_archetype ?? "").toLowerCase().includes(q),
      );
    }
    return rows;
  }, [allocators, filter, search]);

  const attentionCount = useMemo(
    () => allocators.filter((r) => r.needs_attention).length,
    [allocators],
  );

  // ─── Render ───────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Kill switch banner when disabled */}
      {killSwitch === false && (
        <Card className="border-negative/40 bg-negative/5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-negative">Engine: OFF</p>
              <p className="mt-0.5 text-xs text-text-secondary">
                New recomputes are blocked. Existing candidates remain visible.
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={async () => {
                await fetch("/api/admin/match/kill-switch", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ enabled: true }),
                });
                load();
              }}
            >
              Re-enable engine
            </Button>
          </div>
        </Card>
      )}

      {/* Controls row: filter chips + search + engine status pill */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          <FilterChip
            label="Needs attention"
            active={filter === "needs_attention"}
            onClick={() => setFilter("needs_attention")}
            count={attentionCount}
          />
          <FilterChip
            label="New candidates"
            active={filter === "new_candidates"}
            onClick={() => setFilter("new_candidates")}
          />
          <FilterChip
            label="Snoozed"
            active={filter === "snoozed"}
            onClick={() => setFilter("snoozed")}
          />
          <FilterChip
            label="All"
            active={filter === "all"}
            onClick={() => setFilter("all")}
            count={allocators.length}
          />
        </div>
        <input
          type="text"
          placeholder="Search allocators..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="ml-auto w-[260px] rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-border-focus focus:outline-none focus:ring-2 focus:ring-accent/20"
        />
        <EngineStatusPill
          enabled={killSwitch}
          onToggle={async () => {
            if (killSwitch === null) return;
            const newState = !killSwitch;
            if (newState === false) {
              const ok = confirm(
                "Disable the match engine? New recomputes will be blocked. Existing candidates remain visible.",
              );
              if (!ok) return;
            }
            await fetch("/api/admin/match/kill-switch", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ enabled: newState }),
            });
            load();
          }}
        />
      </div>

      {/* Allocator list */}
      {loading && (
        <Card className="text-center py-10">
          <p className="text-sm text-text-muted">Loading allocators...</p>
        </Card>
      )}
      {error && !loading && (
        <Card className="border-negative/40">
          <p className="text-sm text-negative">{error}</p>
        </Card>
      )}
      {!loading && !error && filtered.length === 0 && (
        <Card className="text-center py-10">
          <p className="text-sm text-text-muted">No allocators match this filter.</p>
        </Card>
      )}
      {!loading && !error && filtered.length > 0 && (
        <Card className="p-0">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                  Allocator
                </th>
                <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                  Mandate
                </th>
                <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-muted font-mono-tabular text-right">
                  Candidates
                </th>
                <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-muted text-right">
                  Last intro
                </th>
                <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-muted text-right">
                  Recomputed
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-border hover:bg-page transition-colors"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {row.needs_attention && (
                        <span
                          className="h-2 w-2 shrink-0 rounded-full bg-accent"
                          title="Needs attention"
                        />
                      )}
                      <div>
                        <p className="text-sm font-medium text-text-primary">
                          {row.display_name || row.email || "(unknown)"}
                        </p>
                        {row.company && (
                          <p className="text-xs text-text-secondary">{row.company}</p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-text-secondary max-w-[260px] truncate">
                    {row.mandate_archetype || <span className="text-text-muted">—</span>}
                  </td>
                  <td className="px-4 py-3 text-sm text-right font-mono tabular-nums text-text-primary">
                    {row.latest_batch?.candidate_count ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-sm text-right">
                    {row.days_since_last_intro === null ? (
                      <span className="text-text-muted">never</span>
                    ) : row.days_since_last_intro > 14 ? (
                      <span className="font-mono tabular-nums text-negative">
                        {row.days_since_last_intro}d ago
                      </span>
                    ) : (
                      <span className="font-mono tabular-nums text-text-secondary">
                        {row.days_since_last_intro}d ago
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-right">
                    {row.hours_since_recompute === null ? (
                      <span className="text-text-muted">never</span>
                    ) : row.is_stale ? (
                      <span className="font-mono tabular-nums text-negative">
                        {Math.floor(row.hours_since_recompute / 24)}d ago
                      </span>
                    ) : (
                      <span className="font-mono tabular-nums text-text-muted">
                        {row.hours_since_recompute}h ago
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/admin/match/${row.id}`}
                      className="text-sm font-medium text-accent hover:text-accent-hover"
                    >
                      Open →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

// ─── Subcomponents ──────────────────────────────────────────────────────

function FilterChip({
  label,
  active,
  onClick,
  count,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  count?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[13px] font-medium transition-colors ${
        active
          ? "border-accent bg-accent/10 text-accent"
          : "border-border bg-surface text-text-secondary hover:border-border-focus"
      }`}
    >
      {label}
      {count !== undefined && count > 0 && (
        <span className="rounded-full bg-text-muted/20 px-1.5 text-[11px] font-mono tabular-nums">
          {count}
        </span>
      )}
    </button>
  );
}

function EngineStatusPill({
  enabled,
  onToggle,
}: {
  enabled: boolean | null;
  onToggle: () => void;
}) {
  if (enabled === null) return null;
  return (
    <button
      onClick={onToggle}
      className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[11px] font-mono font-semibold uppercase tracking-wider transition-colors ${
        enabled
          ? "border-border text-text-secondary hover:border-border-focus"
          : "border-negative text-negative hover:bg-negative/5"
      }`}
      title={enabled ? "Click to disable the engine" : "Click to enable the engine"}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${enabled ? "bg-positive" : "bg-negative"}`} />
      Engine: {enabled ? "ON" : "OFF"}
    </button>
  );
}
