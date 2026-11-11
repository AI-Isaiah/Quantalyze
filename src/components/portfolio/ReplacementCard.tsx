"use client";

import { useState, useCallback, useEffect } from "react";
import type { BridgeCandidate, BridgeFitLabel, Improvement } from "@/lib/types";
import { asImprovement } from "@/lib/types";
import { cn } from "@/lib/utils";
import { formatFixedSigned, signTone } from "@/lib/factsheet/display-sign";
import {
  SHORT_TRACK_MARKER,
  gatedValue,
  shortTrackMarkerTitle,
  widenedWithheldReason,
  type FigureState,
} from "@/lib/figure-gate";
import { captureToSentry } from "@/lib/sentry-capture";
import { parseLiftState, parseWireFigureRecord } from "@/lib/portfolio-analytics-adapter";
import { Modal } from "@/components/ui/Modal";
import { AccreditedInvestorGate } from "@/components/legal/AccreditedInvestorGate";
import {
  INTRO_ATTESTATION_CHECK_FAILED,
  INTRO_ATTESTATION_REQUIRED,
} from "@/lib/intro/refusal-codes";

const FIT_STYLES: Record<BridgeFitLabel, string> = {
  "Strong fit": "bg-positive/10 text-positive",
  "Good fit": "bg-positive/10 text-positive",
  "Moderate fit": "bg-warning/10 text-warning",
  "Weak fit": "bg-badge-other/10 text-badge-other",
};

// 170.6 D-02/D-03/D-05: the printed precision of each delta, shared by the text and the tone
// so the colour is read from the same rounded value the label prints. MaxDD and Corr are
// fractions shown as a 1 dp percent; Sharpe is a unitless 2 dp delta.
function deltaPrecision(label: string): { dp: number; scale: number; suffix: string } {
  return label === "MaxDD" || label === "Corr"
    ? { dp: 1, scale: 100, suffix: "%" }
    : { dp: 2, scale: 1, suffix: "" };
}

// NEW-C21-02: color driven by Improvement brand — positive = improvement = green,
// regardless of which field this is. No invertedBetter table needed.
// 166.1 D7 (founder 2026-09-26): a null delta does not exist, so it carries no
// semantic color (DESIGN.md: a "—" cell never carries a semantic color).
// 170.6 D-03: the tone follows the sign of the ROUNDED delta, so a delta printed "0.00" or
// "0.0%" is neutral rather than green or red.
function deltaColor(improvement: Improvement | null, label: string): string {
  if (improvement === null) return "text-text-muted";
  const { dp, scale } = deltaPrecision(label);
  const tone = signTone(improvement, dp, scale);
  if (tone === "positive") return "text-positive";
  if (tone === "negative") return "text-negative";
  return "text-text-primary";
}

// Format for display using the RAW delta value (for correct magnitude/sign in label)
// and label for unit formatting. The Improvement brand is for coloring only.
// A null delta renders "— {label}", never "+0.00" (166.1 D7; round-1 SFH HIGH-2:
// a flat leg's undefined delta used to arrive as 0.0 and read as "unchanged").
// 170.6 D-02: a delta that rounds to zero prints unsigned ("0.00 Sharpe", "0.0% MaxDD").
function formatDelta(raw: number | null, label: string): string {
  if (raw === null) return `— ${label}`;
  return `${formatFixedSigned(raw, { ...deltaPrecision(label), plus: true })} ${label}`;
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
//
// 194.2 D-03: a 500 whose body names `attestation_check_failed` gets its own copy; the
// 403 `attestation_required` refusal never reaches here (it opens the attest step instead).
function humanizeIntroError(status: number | null, code: string | null = null): string {
  if (code === INTRO_ATTESTATION_CHECK_FAILED) {
    return "We could not check your attestation. Try again in a minute.";
  }
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
  // 194.2 D-04: an unattested allocator gets the attest step in place of a dead button.
  const [attestOpen, setAttestOpen] = useState(false);

  const handleIntro = useCallback(async () => {
    setIntroState("loading");
    setIntroError(null);
    try {
      const res = await fetch("/api/intro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strategy_id: candidate.strategy_id,
          message: `Suggested replacement for strategy ${replacementFor}. Composite score: ${formatFixedSigned(candidate.composite_score, { dp: 2 })}.`,
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
        // 194.2 D-03: the route names the attestation refusals with a `code`. Read it
        // BEFORE the generic 401/403 copy, which stays for every other refusal.
        const code = await res
          .json()
          .then((b: { code?: unknown } | null) => (typeof b?.code === "string" ? b.code : null))
          .catch(() => null);
        if (res.status === 403 && code === INTRO_ATTESTATION_REQUIRED) {
          // Not a failure: open the attest step. The click's action resumes after it.
          setIntroState("idle");
          setAttestOpen(true);
          return;
        }
        // H-1067: surface WHICH failure happened instead of one opaque retry.
        console.error("[bridge.intro] request failed:", res.status, {
          strategy_id: candidate.strategy_id,
          replacement_for: replacementFor,
        });
        setIntroError(humanizeIntroError(res.status, code));
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
  const improvementOf = (raw: number | null): Improvement | null =>
    raw === null ? null : asImprovement(raw, "higher-better");

  // 194.1 D-11 / D-15: the producer's verdict on the two records the Sharpe delta compares.
  // Read, never re-derived. An ABSENT state (an analytics deploy older than this change) shows the
  // delta as before. A PRESENT state outside the closed set is not unknown: it fails closed to
  // withheld (194 R2-M2). MaxDD and Corr are not annualized figures and are never gated.
  const rawDeltaState = candidate.sharpe_delta_state;
  const parsedDeltaState = parseLiftState(rawDeltaState);
  const stateUnrecognised = rawDeltaState != null && parsedDeltaState === null;
  const deltaState: FigureState = stateUnrecognised ? "withheld" : (parsedDeltaState ?? "null");
  const failingRecord = parseWireFigureRecord(candidate.sharpe_delta_failing_record);
  const recordUnreadable = deltaState === "withheld" && failingRecord === null;
  // 194 R2-M1 / R2-M2: report a malformed wire value once per value, not once per render.
  const deltaStateText = String(rawDeltaState);
  useEffect(() => {
    if (!stateUnrecognised && !recordUnreadable) return;
    captureToSentry(
      new Error(
        stateUnrecognised
          ? "the bridge candidate carried an unrecognised sharpe_delta_state"
          : "the bridge candidate's withheld Sharpe delta carried an unreadable failing record",
      ),
      {
        level: "warning",
        tags: {
          component: "ReplacementCard",
          stage: stateUnrecognised ? "delta-state-unrecognised" : "delta-record-unreadable",
        },
        extra: { state: deltaStateText },
      },
    );
  }, [stateUnrecognised, recordUnreadable, deltaStateText]);
  const deltaSpan =
    typeof candidate.sharpe_delta_span_days === "number" &&
    Number.isFinite(candidate.sharpe_delta_span_days)
      ? candidate.sharpe_delta_span_days
      : null;
  // A withheld chip with no readable record carries no reason text (nothing true to say).
  const withheldReason =
    deltaState === "withheld" && failingRecord !== null
      ? widenedWithheldReason("delta", failingRecord)
      : null;
  const shortTitle =
    deltaState === "short" && deltaSpan !== null ? shortTrackMarkerTitle(deltaSpan) : null;
  const sharpeDelta = gatedValue(candidate.sharpe_delta, deltaState);

  const deltas: { label: string; raw: number | null; improvement: Improvement | null }[] = [
    { label: "Sharpe", raw: sharpeDelta, improvement: improvementOf(sharpeDelta) },
    { label: "MaxDD",  raw: candidate.dd_delta,     improvement: improvementOf(candidate.dd_delta) },
    { label: "Corr",   raw: candidate.corr_delta,   improvement: improvementOf(candidate.corr_delta) },
  ];

  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-3">
      {/* Header: name + fit badge */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-small font-medium text-text-primary truncate">
          {candidate.strategy_name}
        </p>
        <span
          className={cn(
            "shrink-0 rounded px-1.5 py-0.5 text-micro font-medium uppercase tracking-wider",
            FIT_STYLES[candidate.fit_label],
          )}
        >
          {candidate.fit_label}
        </span>
      </div>

      {/* Metric deltas */}
      <div className="flex items-center gap-4 mb-3">
        {deltas.map((d) => {
          const isSharpe = d.label === "Sharpe";
          return (
            <span
              key={d.label}
              title={isSharpe && withheldReason ? withheldReason : undefined}
              className={cn(
                "font-metric text-caption tabular-nums",
                deltaColor(d.improvement, d.label),
              )}
            >
              {formatDelta(d.raw, d.label)}
              {isSharpe && withheldReason && (
                <span className="sr-only"> {withheldReason}</span>
              )}
              {isSharpe && shortTitle && (
                <span
                  title={shortTitle}
                  className="ml-1 inline-block min-w-[3ch] text-right align-baseline text-micro font-mono tabular-nums text-text-muted"
                >
                  {SHORT_TRACK_MARKER}
                  <span className="sr-only"> {shortTitle}</span>
                </span>
              )}
            </span>
          );
        })}
      </div>

      {/* Intro button */}
      {introState === "done" ? (
        <p className="text-caption text-text-muted">Intro Requested</p>
      ) : (
        <>
          {/* H-1067: distinct, actionable error — not a silent generic retry. */}
          {introState === "error" && introError && (
            <p className="mb-2 text-caption text-negative" role="alert">
              {introError}
            </p>
          )}
          <button
            type="button"
            onClick={handleIntro}
            disabled={introState === "loading"}
            className={cn(
              "rounded-md border border-accent bg-accent px-3 py-1 text-caption font-medium text-white transition-colors duration-150",
              introState === "loading"
                ? "cursor-wait opacity-60"
                : "hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
            )}
          >
            {introState === "loading" ? "Requesting..." : introState === "error" ? "Retry Intro" : "Request Intro"}
          </button>
        </>
      )}

      {/* 194.2 D-04: the attest step. The gate mounts only while open, so each open starts
          with an unchecked box. Close (x, Escape, "Close without confirming") leaves the card
          idle with no error line: the POST was refused and nothing was recorded. */}
      <Modal
        open={attestOpen}
        onClose={() => setAttestOpen(false)}
        title="Attest to request introductions"
      >
        {attestOpen && (
          <AccreditedInvestorGate
            variant="modal"
            confirmLabel="Confirm and send intro request"
            onDismiss={() => setAttestOpen(false)}
            onAttested={() => {
              setAttestOpen(false);
              void handleIntro();
            }}
          />
        )}
      </Modal>
    </div>
  );
}
