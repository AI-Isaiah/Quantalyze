"use client";

import { displayStrategyName } from "@/lib/strategy-display";
import type { CandidateRow } from "@/components/admin/AllocatorMatchQueue";

export function ShortlistCard({
  candidate,
  selected,
  alreadySent,
  readOnly = false,
  onSelect,
  onSendIntro,
}: {
  candidate: CandidateRow;
  selected: boolean;
  alreadySent: boolean;
  readOnly?: boolean;
  onSelect: () => void;
  onSendIntro: () => void;
}) {
  // Using a <div> with role="button" instead of a native <button> so that
  // we can nest a real <button> (the "Send intro" action) inside without
  // DOM nesting violations. Keyboard activation is handled via onKeyDown.
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={`text-left rounded-lg border bg-surface p-4 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent/40 ${
        selected
          ? "border-accent"
          : "border-border hover:border-border-focus"
      } ${alreadySent ? "opacity-50" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-text-primary truncate">
            {displayStrategyName(candidate.strategies)}
          </p>
          {candidate.reasons[0] && (
            <p className="mt-1 text-xs text-text-secondary line-clamp-2">
              {candidate.reasons[0]}
            </p>
          )}
        </div>
        <div className="shrink-0">
          <span className="font-mono tabular-nums text-[24px] text-text-primary">
            {candidate.score.toFixed(0)}
          </span>
        </div>
      </div>
      <div className="mt-3">
        <div
          className="h-[2px] bg-border"
          aria-label={`Score ${candidate.score.toFixed(0)} out of 100`}
        >
          <div
            className="h-full bg-accent"
            style={{ width: `${Math.min(100, candidate.score)}%` }}
          />
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <span className="text-[10px] font-mono uppercase tracking-wider text-text-muted">
          Rank {candidate.rank}
        </span>
        {!readOnly && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (!alreadySent) onSendIntro();
            }}
            disabled={alreadySent}
            className={`inline-flex items-center text-xs font-medium ${
              alreadySent ? "text-text-muted" : "text-accent hover:text-accent-hover cursor-pointer"
            }`}
          >
            {alreadySent ? "Sent" : "Send intro \u2192"}
          </button>
        )}
        {readOnly && alreadySent && (
          <span className="inline-flex items-center text-xs font-medium text-text-muted">
            Sent
          </span>
        )}
      </div>
    </div>
  );
}
