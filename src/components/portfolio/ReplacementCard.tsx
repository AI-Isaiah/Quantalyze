"use client";

import { useState, useCallback } from "react";
import type { BridgeCandidate, BridgeFitLabel } from "@/lib/types";
import { cn } from "@/lib/utils";

const FIT_STYLES: Record<BridgeFitLabel, string> = {
  "Strong fit": "bg-positive/10 text-positive",
  "Good fit": "bg-positive/10 text-positive",
  "Moderate fit": "bg-warning/10 text-warning",
  "Weak fit": "bg-badge-other/10 text-badge-other",
};

function deltaColor(value: number, invertedBetter: boolean): string {
  // For MaxDD and Correlation, negative delta = improvement
  if (invertedBetter) {
    return value <= 0 ? "text-positive" : "text-negative";
  }
  // For Sharpe, positive delta = improvement
  return value >= 0 ? "text-positive" : "text-negative";
}

function formatDelta(value: number, label: string): string {
  const sign = value >= 0 ? "+" : "";
  if (label === "MaxDD" || label === "Corr") {
    return `${sign}${(value * 100).toFixed(1)}% ${label}`;
  }
  return `${sign}${value.toFixed(2)} ${label}`;
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

  const deltas: { label: string; value: number; invertedBetter: boolean }[] = [
    { label: "Sharpe", value: candidate.sharpe_delta, invertedBetter: false },
    { label: "MaxDD", value: candidate.dd_delta, invertedBetter: true },
    { label: "Corr", value: candidate.corr_delta, invertedBetter: true },
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
              deltaColor(d.value, d.invertedBetter),
            )}
          >
            {formatDelta(d.value, d.label)}
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
