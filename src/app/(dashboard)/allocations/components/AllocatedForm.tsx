"use client";

import { useState } from "react";
import {
  ALLOCATED_FIELDS,
  postBridgeOutcome,
  type BridgeOutcome,
} from "@/lib/bridge-outcome-schema";
import { Button } from "@/components/ui/Button";

export type AllocatedFormProps = {
  strategyId: string;
  /** Allocator's Phase 2 max_weight — soft-warn only (D-09). */
  maxWeight: number | null;
  onRecorded: (outcome: BridgeOutcome) => void;
  onCancel: () => void;
};

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
    const result = await postBridgeOutcome({
      strategyId,
      kind: "allocated",
      values: parsed.data,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onRecorded(result.outcome);
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
