"use client";

import { useState, useCallback } from "react";
import type { BridgeCandidate, BridgeFitLabel, Improvement } from "@/lib/types";
import { asImprovement } from "@/lib/types";
import { cn } from "@/lib/utils";

const FIT_STYLES: Record<BridgeFitLabel, string> = {
  "Strong fit": "bg-positive/10 text-positive",
  "Good fit": "bg-positive/10 text-positive",
  "Moderate fit": "bg-warning/10 text-warning",
  "Weak fit": "bg-badge-other/10 text-badge-other",
};

// NEW-C21-02: color driven by Improvement brand — positive = improvement = green,
// regardless of which field this is. No invertedBetter table needed.
function deltaColor(improvement: Improvement): string {
  return improvement >= 0 ? "text-positive" : "text-negative";
}

// Format for display using the RAW delta value (for correct magnitude/sign in label)
// and label for unit formatting. The Improvement brand is for coloring only.
function formatDelta(raw: number, label: string): string {
  const sign = raw >= 0 ? "+" : "";
  if (label === "MaxDD" || label === "Corr") {
    return `${sign}${(raw * 100).toFixed(1)}% ${label}`;
  }
  return `${sign}${raw.toFixed(2)} ${label}`;
}

interface ReplacementCardProps {
  candidate: BridgeCandidate;
  /** Strategy this candidate would replace. Sent in the intro request metadata. */
  replacementFor: string;
}

/**
 * A single replacement candidate card inside the ReplacementPanel.
 * Shows strategy name, fit label badge, metric deltas (Sharpe, MaxDD, Corr),
 * and a "Request Intro" button that calls POST /api/intro.
 */
export function ReplacementCard({ candidate, replacementFor }: ReplacementCardProps) {
  const [introState, setIntroState] = useState<"idle" | "loading" | "done" | "error">("idle");

  const handleIntro = useCallback(async () => {
    setIntroState("loading");
    try {
      const res = await fetch("/api/intro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strategy_id: candidate.strategy_id,
          message: `[Bridge] Replacement candidate for strategy ${replacementFor}. Composite score: ${candidate.composite_score.toFixed(2)}.`,
          source: "bridge",
          replacement_for: replacementFor,
        }),
      });
      if (res.status === 409) {
        // Already requested — treat as success
        setIntroState("done");
        return;
      }
      if (!res.ok) {
        throw new Error(`${res.status}`);
      }
      setIntroState("done");
    } catch {
      setIntroState("error");
    }
  }, [candidate, replacementFor]);

  // NEW-C21-02 / H-1065: backend deltas are all oriented positive=improvement
  // (sharpe_delta = new-old; corr_delta = current-new, i.e. correlation reduced;
  // dd_delta = new-old on <=0 drawdowns, i.e. shallower). So every axis is
  // "higher-better" — asImprovement keeps the sign and deltaColor greens positive.
  const deltas: { label: string; raw: number; improvement: Improvement }[] = [
    { label: "Sharpe", raw: candidate.sharpe_delta, improvement: asImprovement(candidate.sharpe_delta, "higher-better") },
    { label: "MaxDD",  raw: candidate.dd_delta,     improvement: asImprovement(candidate.dd_delta, "higher-better") },
    { label: "Corr",   raw: candidate.corr_delta,   improvement: asImprovement(candidate.corr_delta, "higher-better") },
  ];

  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-3">
      {/* Header: name + fit badge */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-sm font-medium text-text-primary truncate">
          {candidate.strategy_name}
        </p>
        <span
          className={cn(
            "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider",
            FIT_STYLES[candidate.fit_label],
          )}
        >
          {candidate.fit_label}
        </span>
      </div>

      {/* Metric deltas */}
      <div className="flex items-center gap-4 mb-3">
        {deltas.map((d) => (
          <span
            key={d.label}
            className={cn(
              "font-metric text-xs tabular-nums",
              deltaColor(d.improvement),
            )}
          >
            {formatDelta(d.raw, d.label)}
          </span>
        ))}
      </div>

      {/* Intro button */}
      {introState === "done" ? (
        <p className="text-xs text-text-muted">Intro Requested</p>
      ) : (
        <button
          type="button"
          onClick={handleIntro}
          disabled={introState === "loading"}
          className={cn(
            "rounded-md border border-accent bg-accent px-3 py-1 text-xs font-medium text-white transition-colors duration-150",
            introState === "loading"
              ? "cursor-wait opacity-60"
              : "hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
          )}
        >
          {introState === "loading" ? "Requesting..." : introState === "error" ? "Retry Intro" : "Request Intro"}
        </button>
      )}
    </div>
  );
}
