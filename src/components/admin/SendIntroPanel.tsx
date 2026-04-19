"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import { displayStrategyName } from "@/lib/strategy-display";
import type { CandidateRow } from "@/components/admin/AllocatorMatchQueue";

interface Props {
  allocatorId: string;
  candidate: CandidateRow;
  alreadySent: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

type Holding = { id: string; name: string };

// Phase 5 D-20c Option A — admin selects the underperformer being replaced from
// the allocator's current holdings. Required for every intro: the resulting
// `original_strategy_id` is captured on match_decisions via the 6-arg RPC.
export function SendIntroPanel({
  allocatorId,
  candidate,
  alreadySent,
  onClose,
  onSuccess,
}: Props) {
  const [note, setNote] = useState(candidate.reasons[0] || "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Phase 5 — holdings dropdown state
  const [holdings, setHoldings] = useState<Holding[] | null>(null);
  const [holdingsError, setHoldingsError] = useState<string | null>(null);
  const [originalStrategyId, setOriginalStrategyId] = useState<string>("");

  useEffect(() => {
    let aborted = false;
    const controller = new AbortController();

    async function fetchHoldings() {
      try {
        const res = await fetch(
          `/api/admin/allocators/${allocatorId}/holdings`,
          { signal: controller.signal, credentials: "same-origin" },
        );
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const body = (await res.json()) as { holdings: Holding[] };
        if (!aborted) {
          const list = Array.isArray(body.holdings) ? body.holdings : [];
          // Filter out any holding that equals the candidate strategy itself —
          // allocator can't be "replacing" something with itself.
          const filtered = list.filter((h) => h.id !== candidate.strategy_id);
          setHoldings(filtered);
          // Default to the most-heavily-allocated holding (first, already
          // ordered by current_weight DESC in the route).
          if (filtered.length > 0) {
            setOriginalStrategyId(filtered[0].id);
          }
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (!aborted) {
          setHoldingsError(
            err instanceof Error ? err.message : "Failed to load holdings",
          );
          setHoldings([]);
        }
      }
    }
    void fetchHoldings();

    return () => {
      aborted = true;
      controller.abort();
    };
  }, [allocatorId, candidate.strategy_id]);

  const holdingsEmpty = holdings !== null && holdings.length === 0;
  const holdingsLoading = holdings === null && holdingsError === null;
  const canSubmit =
    !alreadySent &&
    !submitting &&
    !holdingsEmpty &&
    !holdingsLoading &&
    originalStrategyId.length > 0 &&
    note.trim().length > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!note.trim()) {
      setError("Note cannot be empty");
      return;
    }
    if (!originalStrategyId) {
      setError("Select the underperformer being replaced");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/match/send-intro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          allocator_id: allocatorId,
          strategy_id: candidate.strategy_id,
          original_strategy_id: originalStrategyId,
          candidate_id: candidate.id,
          admin_note: note.trim(),
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error || "Failed to send intro");
      }
      if (body.was_already_sent) {
        setError("Intro already exists for this allocator × strategy pair. No new message sent.");
      } else {
        onSuccess();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-label="Close"
      />
      {/* Slide-out panel */}
      <div className="relative z-10 w-full max-w-md bg-surface border-l border-border shadow-elevated overflow-y-auto">
        <div className="sticky top-0 bg-surface border-b border-border px-6 py-4 flex items-center justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium">
              Send intro
            </p>
            <h2 className="mt-0.5 text-lg font-display text-text-primary">
              {displayStrategyName(candidate.strategies)}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary transition-colors"
            aria-label="Close"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path
                d="M15 5L5 15M5 5l10 10"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {/* Already-sent banner */}
        {alreadySent && (
          <div className="px-6 py-4 border-b border-border bg-negative/5">
            <p className="text-sm text-negative font-semibold">Intro already sent</p>
            <p className="mt-1 text-xs text-text-secondary">
              There&apos;s already a contact request for this allocator ×
              strategy pair. You can still close this panel and send a new
              message through your usual channel.
            </p>
          </div>
        )}

        {/* Empty-holdings banner — blocks submit per D-20c Option A contract. */}
        {holdingsEmpty && !alreadySent && (
          <div className="px-6 py-4 border-b border-border bg-negative/5">
            <p className="text-sm text-negative font-semibold">
              Cannot send intro
            </p>
            <p className="mt-1 text-xs text-text-secondary">
              Allocator has no current holdings — cannot send intro without an
              underperformer reference. Have them connect a portfolio first, or
              record at least one position.
            </p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium mb-2">
              Reasons (edit if you want a different angle)
            </p>
            <ul className="space-y-1">
              {candidate.reasons.map((reason) => (
                <li key={reason} className="flex items-start gap-2 text-sm text-text-secondary">
                  <span className="mt-[6px] h-1 w-1 rounded-full bg-accent shrink-0" />
                  {reason}
                </li>
              ))}
            </ul>
          </div>

          {/* Underperformer-being-replaced dropdown (Phase 5 D-20c Option A). */}
          <div>
            <label
              htmlFor="original-strategy-select"
              className="block text-[10px] uppercase tracking-wider text-text-muted font-medium mb-2"
            >
              Underperformer being replaced
            </label>
            {holdingsLoading ? (
              <p className="text-xs text-text-muted">Loading holdings…</p>
            ) : holdingsError ? (
              <p className="text-xs text-negative">
                Failed to load holdings: {holdingsError}
              </p>
            ) : holdingsEmpty ? (
              <p className="text-xs text-text-muted">
                No current holdings on this allocator&apos;s portfolio.
              </p>
            ) : (
              <select
                id="original-strategy-select"
                value={originalStrategyId}
                onChange={(e) => setOriginalStrategyId(e.target.value)}
                disabled={alreadySent || submitting}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
                required
              >
                {(holdings ?? []).map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <Textarea
            label="Your note (1-line intro message)"
            placeholder="Write the note you'll send with this intro..."
            rows={4}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            disabled={alreadySent || submitting}
          />

          {error && (
            <p className="text-sm text-negative">{error}</p>
          )}

          <div className="flex items-center gap-2">
            <Button
              type="submit"
              variant="primary"
              disabled={!canSubmit}
            >
              {submitting ? "Sending..." : "Send intro"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
