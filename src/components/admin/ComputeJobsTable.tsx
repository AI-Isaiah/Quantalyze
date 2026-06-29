"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { ResponsiveTable } from "@/components/ResponsiveTable";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui/Table";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/utils";
import { useCrossTabStorage } from "@/lib/storage/cross-tab";
import { rawStringCodec } from "@/lib/storage/codecs";
import type { ComputeJobAdminRow } from "@/lib/types";

// ---------------------------------------------------------------------------
// Status badge color mapping (DESIGN.md semantic tokens)
//
// UI-03 (Phase 50): the prior inline `rgba(...)`/`#hex` pairs are replaced by
// the semantic token utilities (`bg-positive/10 text-positive`, …) — the SAME
// status→semantic-tier mapping, now on the design tokens (matches the page's
// own StatusBadge convention). `failed_retry`/`failed_final` keep their
// distinct warning vs negative tiers; everything else is the muted tier.
// ---------------------------------------------------------------------------

function statusBadgeClass(status: string): string {
  switch (status) {
    case "done":
      return "bg-positive/10 text-positive";
    case "failed_final":
      return "bg-negative/10 text-negative";
    case "failed_retry":
      return "bg-warning/10 text-warning";
    default:
      // pending, running, done_pending_children
      return "bg-text-muted/10 text-text-muted";
  }
}

// ---------------------------------------------------------------------------
// Filter options
// ---------------------------------------------------------------------------

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "pending", label: "Pending" },
  { value: "running", label: "Running" },
  { value: "done", label: "Done" },
  { value: "failed_retry", label: "Retry" },
  { value: "failed_final", label: "Failed" },
];

const KIND_OPTIONS = [
  { value: "", label: "All kinds" },
  { value: "sync_trades", label: "sync_trades" },
  { value: "compute_analytics", label: "compute_analytics" },
  { value: "compute_portfolio", label: "compute_portfolio" },
  { value: "poll_positions", label: "poll_positions" },
];

const AUTO_REFRESH_KEY = "admin-compute-jobs-auto-refresh";

// B7 — the auto-refresh preference persists as the literal "true"/"false"
// string (no JSON envelope), byte-compatible with the pre-B7
// `localStorage.setItem(KEY, String(next))` write so an existing stored
// preference loads unchanged.
const autoRefreshCodec = rawStringCodec<boolean>({
  parse: (raw) => raw === "true",
  serialize: (v) => String(v),
});

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ComputeJobsTable() {
  const [jobs, setJobs] = useState<ComputeJobAdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [kindFilter, setKindFilter] = useState("");
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  // B7 — auto-refresh preference routes through the cross-tab primitive
  // (SSR-safe deferred hydration, cross-tab StorageEvent sync, fail-loud
  // read/write). Deferred hydration trades the prior lazy sync-read (one extra
  // render on mount) for SSR safety + the hardened storage path; the auto-
  // refresh interval keys off the hook's `value`.
  const { value: autoRefresh, setValue: setAutoRefresh } = useCrossTabStorage<boolean>({
    key: AUTO_REFRESH_KEY,
    initial: false,
    codec: autoRefreshCodec,
    hydration: "deferred",
    sentryArea: "admin.compute-jobs.auto-refresh",
  });
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchJobs = useCallback(
    async (newOffset: number, append: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ limit: "50", offset: String(newOffset) });
        if (statusFilter) params.set("status", statusFilter);
        if (kindFilter) params.set("kind", kindFilter);

        const res = await fetch(`/api/admin/compute-jobs?${params.toString()}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error((body as Record<string, string>).error ?? `HTTP ${res.status}`);
        }

        const data: ComputeJobAdminRow[] = await res.json();
        setJobs((prev) => (append ? [...prev, ...data] : data));
        setHasMore(data.length === 50);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Fetch failed");
      } finally {
        setLoading(false);
      }
    },
    [statusFilter, kindFilter],
  );

  // Initial fetch + filter change
  useEffect(() => {
    setOffset(0);
    fetchJobs(0, false);
  }, [fetchJobs]);

  // Auto-refresh interval
  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(() => fetchJobs(0, false), 10_000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [autoRefresh, fetchJobs]);

  function toggleAutoRefresh() {
    // setValue persists through the primitive (debounced + cross-tab flush).
    setAutoRefresh((prev) => !prev);
  }

  function loadMore() {
    const next = offset + 50;
    setOffset(next);
    fetchJobs(next, true);
  }

  const now = Date.now();

  return (
    <div className="space-y-4" data-testid="compute-jobs-table">
      {/* Filters + auto-refresh */}
      <div className="flex flex-wrap items-end gap-3">
        {/* Status filter — Field-wrapped native Select primitive. The visible
            label IS the prior "All statuses" placeholder option, so the control
            stays self-describing; Field adds the htmlFor/id a11y wiring. */}
        <Field label="Status">
          <Select
            options={STATUS_OPTIONS}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="min-h-0 px-2 py-1 text-caption"
          />
        </Field>

        <Field label="Kind">
          <Select
            options={KIND_OPTIONS}
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value)}
            className="min-h-0 px-2 py-1 text-caption"
          />
        </Field>

        <label className="flex items-center gap-1.5 pb-1.5 text-caption text-text-muted">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={toggleAutoRefresh}
            className="accent-accent h-3 w-3"
          />
          Auto-refresh
        </label>

        {loading && (
          <span className="pb-1.5 text-micro text-text-muted">Loading...</span>
        )}
      </div>

      {error && (
        <p className="text-small text-negative" role="alert">
          {error}
        </p>
      )}

      {/* Table */}
      <ResponsiveTable label="Compute jobs">
        <Table aria-label="Compute jobs" className="text-small">
          <TableHead>
            <TableRow className="hover:bg-transparent">
              {["Kind", "Target", "Status", "Attempts", "Age", "Last Error"].map(
                (h) => (
                  <TableHeaderCell
                    key={h}
                    scope="col"
                    className="px-3 py-2 text-micro uppercase tracking-wider"
                  >
                    {h}
                  </TableHeaderCell>
                ),
              )}
            </TableRow>
          </TableHead>
          <TableBody>
            {jobs.map((job) => {
              const target =
                job.strategy_name ?? job.portfolio_name ?? job.strategy_id ?? job.portfolio_id ?? "—";
              const errorText = job.last_error
                ? job.last_error.length > 60
                  ? job.last_error.slice(0, 60) + "..."
                  : job.last_error
                : "—";

              return (
                <TableRow key={job.id} className="h-11">
                  <TableCell className="px-3 py-2 font-metric text-caption text-text-primary">
                    {job.kind}
                  </TableCell>
                  <TableCell
                    className="px-3 py-2 text-caption text-text-secondary truncate max-w-[180px]"
                    title={target}
                  >
                    {target}
                  </TableCell>
                  <TableCell className="px-3 py-2">
                    <span
                      className={cn(
                        "inline-block rounded-sm px-1.5 py-0.5 text-micro font-medium uppercase tracking-wider",
                        statusBadgeClass(job.status),
                      )}
                    >
                      {job.status}
                    </span>
                  </TableCell>
                  <TableCell
                    numeric
                    className="px-3 py-2 text-left text-caption text-text-primary"
                  >
                    {job.attempts}/{job.max_attempts}
                  </TableCell>
                  <TableCell className="px-3 py-2 text-caption text-text-muted">
                    {formatRelativeTime(job.created_at, now)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "px-3 py-2 text-caption truncate max-w-[240px]",
                      job.last_error ? "text-negative" : "text-text-muted",
                    )}
                    title={job.last_error ?? undefined}
                  >
                    {errorText}
                  </TableCell>
                </TableRow>
              );
            })}

            {jobs.length === 0 && !loading && (
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={6}
                  className="px-3 py-8 text-center text-small text-text-muted"
                >
                  No compute jobs found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </ResponsiveTable>

      {/* Load more */}
      {hasMore && jobs.length > 0 && (
        <Button variant="secondary" size="sm" onClick={loadMore} disabled={loading}>
          Load more
        </Button>
      )}
    </div>
  );
}
