"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { ResponsiveTable } from "@/components/ResponsiveTable";
import { formatRelativeTime } from "@/lib/utils";
import { useCrossTabStorage } from "@/lib/storage/cross-tab";
import { rawStringCodec } from "@/lib/storage/codecs";
import type { ComputeJobAdminRow } from "@/lib/types";

// ---------------------------------------------------------------------------
// Status badge color mapping (DESIGN.md semantic colors)
// ---------------------------------------------------------------------------

function statusColor(status: string): { bg: string; text: string } {
  switch (status) {
    case "done":
      return { bg: "rgba(21,128,61,0.1)", text: "#15803D" };
    case "failed_final":
      return { bg: "rgba(220,38,38,0.1)", text: "#DC2626" };
    case "failed_retry":
      return { bg: "rgba(217,119,6,0.1)", text: "#D97706" };
    default:
      // pending, running, done_pending_children
      return { bg: "rgba(113,128,150,0.1)", text: "#64748B" };
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
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded border px-2 py-1 text-xs"
          style={{ borderColor: "#E2E8F0", color: "#1A1A2E" }}
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        <select
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value)}
          className="rounded border px-2 py-1 text-xs"
          style={{ borderColor: "#E2E8F0", color: "#1A1A2E" }}
        >
          {KIND_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        <label className="flex items-center gap-1.5 text-xs" style={{ color: "#64748B" }}>
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={toggleAutoRefresh}
            className="accent-[#1B6B5A] h-3 w-3"
          />
          Auto-refresh
        </label>

        {loading && (
          <span className="text-[10px]" style={{ color: "#64748B" }}>
            Loading...
          </span>
        )}
      </div>

      {error && (
        <p className="text-sm" style={{ color: "#DC2626" }} role="alert">
          {error}
        </p>
      )}

      {/* Table */}
      <ResponsiveTable>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b" style={{ borderColor: "#E2E8F0" }}>
              {["Kind", "Target", "Status", "Attempts", "Age", "Last Error"].map(
                (h) => (
                  <th
                    key={h}
                    className="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wider"
                    style={{ color: "#64748B" }}
                  >
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => {
              const sc = statusColor(job.status);
              const target =
                job.strategy_name ?? job.portfolio_name ?? job.strategy_id ?? job.portfolio_id ?? "—";
              const errorText = job.last_error
                ? job.last_error.length > 60
                  ? job.last_error.slice(0, 60) + "..."
                  : job.last_error
                : "—";

              return (
                <tr
                  key={job.id}
                  className="border-b last:border-b-0 transition-colors"
                  style={{ borderColor: "#E2E8F0", height: 44 }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.backgroundColor = "#F8F9FA";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.backgroundColor = "";
                  }}
                >
                  <td className="px-3 py-2 font-metric text-xs" style={{ color: "#1A1A2E" }}>
                    {job.kind}
                  </td>
                  <td
                    className="px-3 py-2 text-xs truncate max-w-[180px]"
                    style={{ color: "#4A5568" }}
                    title={target}
                  >
                    {target}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className="inline-block rounded-sm px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider"
                      style={{ backgroundColor: sc.bg, color: sc.text }}
                    >
                      {job.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-metric tabular-nums text-xs" style={{ color: "#1A1A2E" }}>
                    {job.attempts}/{job.max_attempts}
                  </td>
                  <td className="px-3 py-2 text-xs" style={{ color: "#64748B" }}>
                    {formatRelativeTime(job.created_at, now)}
                  </td>
                  <td
                    className="px-3 py-2 text-xs truncate max-w-[240px]"
                    style={{ color: job.last_error ? "#DC2626" : "#64748B" }}
                    title={job.last_error ?? undefined}
                  >
                    {errorText}
                  </td>
                </tr>
              );
            })}

            {jobs.length === 0 && !loading && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-sm" style={{ color: "#64748B" }}>
                  No compute jobs found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </ResponsiveTable>

      {/* Load more */}
      {hasMore && jobs.length > 0 && (
        <button
          type="button"
          onClick={loadMore}
          disabled={loading}
          className="rounded border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-[#F8F9FA]"
          style={{ borderColor: "#E2E8F0", color: "#1B6B5A" }}
        >
          Load more
        </button>
      )}
    </div>
  );
}
