"use client";

import { useState } from "react";
import { ALLOCATED_FIELDS } from "@/lib/bridge-outcome-schema";
import { Button } from "@/components/ui/Button";

/**
 * Shape returned from POST /api/bridge/outcome.
 * Exported so AllocatedForm, RejectedForm, OutcomeRecordedRow, and
 * PositionsTable all share one canonical type definition.
 */
export type RecordedOutcome = {
  id: string;
  kind: "allocated" | "rejected";
  percent_allocated: number | null;
  allocated_at: string | null;         // YYYY-MM-DD
  rejection_reason: string | null;
  note: string | null;
  delta_30d: number | null;
  delta_90d: number | null;
  delta_180d: number | null;
  estimated_delta_bps: number | null;
  estimated_days: number | null;
  needs_recompute: boolean;
  created_at: string;
};

export type AllocatedFormProps = {
  strategyId: string;
  /** From Phase 2 mandate — may be null; soft-warn only (D-09). */
  maxWeight: number | null;
  onRecorded: (outcome: RecordedOutcome) => void;
  onCancel: () => void;
};

/**
 * Inline allocated-outcome form.
 *
 * Fields: percent_allocated (0.1–50%), allocated_at (date, not future, not > 365d), note (optional).
 * Client-side Zod symmetrical with route (D-09).
 * POSTs to /api/bridge/outcome with kind="allocated".
 * On success, calls onRecorded(outcome) so the parent can swap to OutcomeRecordedRow.
 *
 * DESIGN.md tokens: bg-surface, border-border, font-sans, font-mono, text-text-secondary,
 * text-text-muted, text-negative.
 *
 * Sprint 8 Phase 1 — Plan 01-03
 */
export function AllocatedForm({
  strategyId,
  maxWeight,
  onRecorded,
  onCancel,
}: AllocatedFormProps) {
  const today = new Date().toISOString().slice(0, 10);

  const [percent, setPercent] = useState<string>("");
  const [allocatedAt, setAllocatedAt] = useState<string>(today);
  const [note, setNote] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const pctNum = Number(percent);
  const softWarn =
    maxWeight !== null && !Number.isNaN(pctNum) && pctNum > maxWeight
      ? `Exceeds your max weight (${maxWeight}%) — you can still save`
      : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const parsed = ALLOCATED_FIELDS.safeParse({
      percent_allocated: pctNum,
      allocated_at: allocatedAt,
      note: note || null,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/bridge/outcome", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          strategy_id: strategyId,
          kind: "allocated",
          ...parsed.data,
        }),
        credentials: "same-origin",
      });
      const body = await res.json();
      if (!res.ok) {
        if (res.status === 429) {
          setError("Too many submissions — try again in a moment");
        } else {
          setError(body.error ?? "Couldn't record outcome — try again");
        }
        return;
      }
      onRecorded(body.outcome as RecordedOutcome);
    } catch {
      setError("Couldn't record outcome — try again");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      data-testid="allocated-form"
      onSubmit={handleSubmit}
      className="flex flex-wrap items-end gap-3 border-t border-border bg-surface px-4 py-3 text-sm font-sans"
    >
      <label className="flex flex-col gap-1">
        <span className="text-text-secondary text-xs">Percent allocated</span>
        <input
          type="number"
          min={0.1}
          max={50}
          step={0.1}
          required
          value={percent}
          onChange={(e) => setPercent(e.target.value)}
          className="font-metric w-24 rounded border border-border bg-surface px-2 py-1.5 text-sm tabular-nums text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/50 focus-visible:border-border-focus"
          aria-label="Percent allocated"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-text-secondary text-xs">Allocated on</span>
        <input
          type="date"
          required
          value={allocatedAt}
          onChange={(e) => setAllocatedAt(e.target.value)}
          className="font-metric rounded border border-border bg-surface px-2 py-1.5 text-sm tabular-nums text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/50 focus-visible:border-border-focus"
          aria-label="Allocated on"
        />
      </label>
      <label className="flex flex-1 flex-col gap-1 min-w-[180px]">
        <span className="text-text-secondary text-xs">Note (optional)</span>
        <textarea
          rows={1}
          maxLength={2000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="w-full rounded border border-border bg-surface px-2 py-1.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/50 focus-visible:border-border-focus resize-none"
          aria-label="Note (optional)"
        />
      </label>
      <div className="flex gap-2">
        <Button
          type="submit"
          size="sm"
          variant="primary"
          disabled={submitting}
          aria-busy={submitting}
        >
          {submitting ? "Recording\u2026" : "Record allocation"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onCancel}
          disabled={submitting}
        >
          Cancel
        </Button>
      </div>
      {softWarn && (
        <p className="w-full text-text-muted text-xs">{softWarn}</p>
      )}
      {error && (
        <div role="alert" aria-live="polite" className="w-full">
          <p className="text-negative text-xs">{error}</p>
        </div>
      )}
    </form>
  );
}
