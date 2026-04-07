"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import type { CandidateRow } from "@/components/admin/AllocatorMatchQueue";

interface Props {
  allocatorId: string;
  candidate: CandidateRow;
  alreadySent: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!note.trim()) {
      setError("Note cannot be empty");
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
              {candidate.strategies?.codename || candidate.strategies?.name || "(strategy)"}
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
              disabled={alreadySent || submitting}
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
