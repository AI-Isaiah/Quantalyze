"use client";

export function ModeBadge({ mode }: { mode: "personalized" | "screening" }) {
  if (mode === "personalized") {
    return (
      <span className="inline-flex items-center rounded-sm border border-accent px-2 py-0.5 text-[11px] font-mono uppercase tracking-wider text-accent">
        Personalized
      </span>
    );
  }
  return (
    <div>
      <span className="inline-flex items-center rounded-sm border border-text-secondary px-2 py-0.5 text-[11px] font-mono uppercase tracking-wider text-text-secondary">
        Screening
      </span>
      <p className="mt-1 text-[11px] text-text-muted text-right">
        No portfolio context — score reflects preference fit only.
      </p>
    </div>
  );
}

export function ScoreCell({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(1, score / 100));
  return (
    <div className="inline-flex flex-col items-end gap-1">
      <span className="font-mono tabular-nums text-sm text-text-primary">
        {score.toFixed(0)}
      </span>
      <div className="h-[2px] w-[32px] bg-border">
        <div className="h-full bg-accent" style={{ width: `${pct * 100}%` }} />
      </div>
    </div>
  );
}
