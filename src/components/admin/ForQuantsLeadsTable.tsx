"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import {
  formatAbsoluteDate,
  formatRelativeTime,
  minuteBucket,
} from "@/lib/utils";
import type { ForQuantsLeadRow } from "@/lib/for-quants-leads-admin";

/**
 * Clock state lifted to the table so all rows share one interval
 * and one re-render per minute instead of N intervals × N commits.
 * The updater gates on minuteBucket so no-op ticks (3m → 3m) don't
 * cascade into a render. Initial value is `null` until mount, so
 * server-rendered output uses the SSR-safe absolute date and React
 * never sees a hydration mismatch.
 */
function useSharedMinuteClock(): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    // Deferred via setTimeout(0) to stay clean on React Compiler's
    // react-hooks/set-state-in-effect rule.
    const tick = setTimeout(() => setNow(Date.now()), 0);
    const interval = setInterval(() => {
      setNow((prev) => {
        const next = Date.now();
        if (prev !== null && minuteBucket(prev) === minuteBucket(next)) {
          return prev;
        }
        return next;
      });
    }, 60_000);
    return () => {
      clearTimeout(tick);
      clearInterval(interval);
    };
  }, []);
  return now;
}

export function ForQuantsLeadsTable({
  leads,
  showAll,
  hitCap,
  fullViewCap,
}: {
  leads: ForQuantsLeadRow[];
  showAll: boolean;
  hitCap: boolean;
  fullViewCap: number;
}) {
  const router = useRouter();
  const now = useSharedMinuteClock();
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggleProcessed(id: string, currentlyProcessed: boolean) {
    setLoadingId(id);
    setError(null);
    try {
      const res = await fetch("/api/admin/for-quants-leads/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, unprocess: currentlyProcessed }),
      });
      if (!res.ok) {
        setError(
          currentlyProcessed
            ? "Could not unmark this lead. Try again."
            : "Could not mark as processed. Try again.",
        );
        return;
      }
      router.refresh();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setLoadingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 text-xs text-text-muted">
        <span>
          {showAll
            ? `Showing newest ${leads.length}${hitCap ? ` of up to ${fullViewCap}` : ""}`
            : `${leads.length} unprocessed`}
        </span>
        <Link
          href={showAll ? "/admin/for-quants-leads" : "/admin/for-quants-leads?show=all"}
          className="text-accent hover:underline"
        >
          {showAll ? "Show unprocessed only" : "Show all"}
        </Link>
      </div>

      {hitCap && (
        <Card
          padding="sm"
          className="border-badge-market-neutral/30 text-xs text-text-secondary"
        >
          Showing the newest {fullViewCap} leads. Older leads exist in the
          database but pagination is not wired yet. Filter in the Supabase
          dashboard if you need an older record.
        </Card>
      )}

      {error && (
        <Card padding="sm" className="border-negative/30 text-sm text-negative">
          {error}
        </Card>
      )}

      {leads.length === 0 ? (
        <Card className="text-center py-8 text-text-muted">
          {showAll ? "No leads yet." : "All caught up. No unprocessed leads."}
        </Card>
      ) : (
        <div className="space-y-3">
          {leads.map((lead) => {
            const wizard = lead.wizard_context;
            const isProcessed = lead.processed_at !== null;
            const isLoading = loadingId === lead.id;
            const timeLabel =
              now === null
                ? formatAbsoluteDate(lead.created_at)
                : formatRelativeTime(lead.created_at, now);
            return (
              <Card key={lead.id} padding="md">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <h3 className="font-semibold text-text-primary">
                        {lead.name}
                      </h3>
                      <span className="text-sm text-text-secondary">
                        {lead.firm}
                      </span>
                      <span
                        className="text-xs text-text-muted"
                        suppressHydrationWarning
                      >
                        {timeLabel}
                      </span>
                      {wizard?.step && (
                        <span className="inline-flex items-center rounded-md bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">
                          from wizard · {wizard.step}
                        </span>
                      )}
                      {isProcessed && (
                        <span className="inline-flex items-center rounded-md bg-positive/10 px-2 py-0.5 text-[10px] font-medium text-positive">
                          processed
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-sm">
                      <a
                        href={`mailto:${lead.email}`}
                        className="text-accent hover:underline"
                      >
                        {lead.email}
                      </a>
                    </div>
                    {lead.preferred_time && (
                      <div className="mt-1 text-xs text-text-muted">
                        Preferred: {lead.preferred_time}
                      </div>
                    )}
                    {lead.notes && (
                      <p className="mt-2 text-sm text-text-secondary whitespace-pre-wrap">
                        {lead.notes}
                      </p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant={isProcessed ? "ghost" : "primary"}
                    onClick={() => toggleProcessed(lead.id, isProcessed)}
                    disabled={isLoading}
                  >
                    {isLoading
                      ? "Saving..."
                      : isProcessed
                      ? "Unmark"
                      : "Mark processed"}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
