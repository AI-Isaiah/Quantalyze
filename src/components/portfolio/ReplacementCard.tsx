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

// H-1067: distinct, actionable message per failure mode. The /api/intro route
// returns 401 (unauthorized), 403 (not an allocator / not approved), 429 (rate
// limit), 400 (bad body) and 500 (insert/select failure); the network/parse
// path (no status) and programming errors (e.g. a thrown TypeError) land here
// too. Collapsing all of these into a bare "Retry Intro" hid which were
// retryable and which were permanent — and masked client bugs as network blips.
function humanizeIntroError(status: number | null): string {
  if (status === 429) return "Too many requests — try again in a minute.";
  if (status === 401 || status === 403) return "You don't have permission to request this intro.";
  if (status === 400) return "Couldn't request intro — please reload and retry.";
  return "Couldn't reach the server — retry shortly.";
}

/**
 * A single replacement candidate card inside the ReplacementPanel.
 * Shows strategy name, fit label badge, metric deltas (Sharpe, MaxDD, Corr),
 * and a "Request Intro" button that calls POST /api/intro.
 */
export function ReplacementCard({ candidate, replacementFor }: ReplacementCardProps) {
  const [introState, setIntroState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [introError, setIntroError] = useState<string | null>(null);

  const handleIntro = useCallback(async () => {
    setIntroState("loading");
    setIntroError(null);
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
        // H-1067: surface WHICH failure happened instead of one opaque retry.
        console.error("[bridge.intro] request failed:", res.status, {
          strategy_id: candidate.strategy_id,
          replacement_for: replacementFor,
        });
        setIntroError(humanizeIntroError(res.status));
        setIntroState("error");
        return;
      }
      setIntroState("done");
    } catch (err) {
      // H-1067: never swallow — a network/parse failure or a programming error
      // (e.g. composite_score not a number) must be observable, not disguised
      // as a generic retry.
      console.error("[bridge.intro] request threw:", err, {
        strategy_id: candidate.strategy_id,
        replacement_for: replacementFor,
      });
      setIntroError(humanizeIntroError(null));
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
        <>
          {/* H-1067: distinct, actionable error — not a silent generic retry. */}
          {introState === "error" && introError && (
            <p className="mb-2 text-xs text-negative" role="alert">
              {introError}
            </p>
          )}
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
        </>
      )}
    </div>
  );
}
