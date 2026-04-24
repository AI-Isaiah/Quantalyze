"use client";

/**
 * Phase 09.1 Plan 09 / D-16 + R2 accepted.
 *
 * Right slide-over drawer (width 620, maxWidth 96vw) opened from
 * BridgeWidget's Review CTA. Two-stage state machine:
 *   - browse  → MANDATE GATES FAILED card + ranked candidates
 *   - confirm → From → To row + Send intro
 *
 * "Send intro" routes through the SHARED `sendBridgeIntro` helper
 * (`src/lib/bridge/send-intro.ts`) — the same helper now consumed by
 * ScenarioFlaggedHoldingsList. NO string-literal fetch URL appears in this
 * file; the acceptance-criterion grep
 *   `! grep -qE '"/api/match/decisions/holding"|"/api/bridge'`
 * locks this. D-16 forbids parallel bridge APIs.
 *
 * Dismissal: Esc key, backdrop click, and the close button (×) all fire
 * `onClose`. Drawer remounts to `browse` stage on next open.
 */

import { useEffect, useRef, useState } from "react";
import { sendBridgeIntro } from "@/lib/bridge/send-intro";
import {
  buildHoldingRef,
  type FlaggedHolding,
} from "../lib/holding-outcome-adapter";

type Stage = "browse" | "confirm";

export interface BridgeDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  flaggedHoldings: FlaggedHolding[];
  matchDecisionsByHoldingRef: Record<string, { id: string } | null>;
}

export function BridgeDrawer({
  isOpen,
  onClose,
  flaggedHoldings,
  // matchDecisionsByHoldingRef accepted for API parity with the existing
  // ScenarioFlaggedHoldingsList contract — Plan 09 doesn't yet branch on it
  // (the helper handles the "decision exists" / "create decision" split
  // server-side). Declared for forward-compat per D-16.
  matchDecisionsByHoldingRef: _matchDecisionsByHoldingRef,
}: BridgeDrawerProps) {
  const [stage, setStage] = useState<Stage>("browse");
  const [selectedRef, setSelectedRef] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  // Reset transient state when the drawer closes; install Esc handler
  // when open. Mirrors AddWidgetModal:29-62.
  useEffect(() => {
    if (!isOpen) {
      setStage("browse");
      setSelectedRef(null);
      setError(null);
      setSubmitting(false);
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const selected = selectedRef
    ? flaggedHoldings.find((h) => buildHoldingRef(h) === selectedRef)
    : null;

  async function handleSendIntro() {
    if (!selected) return;
    setSubmitting(true);
    setError(null);
    const result = await sendBridgeIntro({
      holdingRef: buildHoldingRef(selected),
      topCandidateStrategyId: selected.top_candidate_strategy_id,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onClose();
  }

  const candidates = flaggedHoldings.filter(
    (h) => h.top_candidate_strategy_id,
  );

  return (
    <>
      {/* Backdrop — click dismisses */}
      <div
        onClick={onClose}
        aria-hidden="true"
        data-testid="bridge-drawer-backdrop"
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(15,23,42,0.32)",
          zIndex: 100,
          animation: "bd-fade 160ms ease",
        }}
      />
      {/* Drawer panel */}
      <div
        ref={drawerRef}
        role="dialog"
        aria-label="Bridge review"
        aria-modal="true"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: 620,
          maxWidth: "96vw",
          background: "var(--surface, white)",
          boxShadow: "-8px 0 20px rgba(0,0,0,0.08)",
          zIndex: 101,
          animation: "bd-slide 220ms ease",
          overflowY: "auto",
          padding: 24,
        }}
      >
        <div className="flex items-center justify-between">
          <div className="text-lg font-semibold text-text-primary">
            {stage === "browse" ? "Review candidates" : "Confirm intro"}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close drawer"
            className="text-text-muted hover:text-text-primary"
          >
            ×
          </button>
        </div>

        {stage === "browse" && (
          <div className="mt-4 grid gap-3">
            {/* Mandate gates failed card — designer screenshot 13.51.27 */}
            <div
              className="rounded-md border p-3"
              style={{ borderColor: "#FED7AA", background: "#FFFBF4" }}
            >
              <div
                className="text-xs"
                style={{
                  color: "#D97706",
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                }}
              >
                Mandate gates failed
              </div>
              {flaggedHoldings.length === 0 ? (
                <div className="mt-2 text-sm text-text-secondary">
                  No flagged holdings.
                </div>
              ) : (
                <ul className="mt-2 grid gap-1 text-sm text-text-primary">
                  {flaggedHoldings.map((h) => (
                    <li key={buildHoldingRef(h)}>
                      • {h.symbol} ({h.venue}):{" "}
                      {h.breach_reasons.length > 0
                        ? h.breach_reasons.join(", ")
                        : "composite threshold"}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="mt-2 text-sm font-medium text-text-primary">
              Ranked candidates
            </div>
            {candidates.length === 0 ? (
              <div className="text-sm text-text-muted">
                No candidates available.
              </div>
            ) : (
              <ul className="grid gap-2">
                {candidates.map((h) => {
                  const ref = buildHoldingRef(h);
                  return (
                    <li key={ref}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedRef(ref);
                          setStage("confirm");
                        }}
                        className="w-full rounded-md border border-border p-3 text-left hover:border-accent"
                        data-testid={`bridge-candidate-${ref}`}
                      >
                        <div className="text-sm font-medium text-text-primary">
                          {h.symbol} ({h.venue})
                        </div>
                        <div className="text-xs text-text-muted">
                          candidate: {h.top_candidate_name}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {stage === "confirm" && selected && (
          <div className="mt-4 grid gap-4">
            {/* From → To row — designer screenshot 13.51.40 */}
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-md border border-border p-4">
              <div>
                <div className="text-xs uppercase text-text-muted">From</div>
                <div className="text-base font-medium text-text-primary">
                  {selected.symbol} ({selected.venue})
                </div>
                <div
                  className="text-sm text-text-secondary"
                  style={{
                    fontFamily: "var(--font-mono, 'Geist Mono', monospace)",
                  }}
                >
                  composite {selected.top_candidate_composite}
                </div>
              </div>
              <div aria-hidden="true" className="text-2xl text-text-muted">
                →
              </div>
              <div>
                <div className="text-xs uppercase text-text-muted">To</div>
                <div className="text-base font-medium text-text-primary">
                  {selected.top_candidate_name}
                </div>
                <div className="text-xs text-text-muted">
                  {selected.top_candidate_strategy_id}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={handleSendIntro}
              disabled={submitting}
              className="self-start rounded-md bg-accent px-4 py-2 text-sm text-white hover:bg-accent/90 disabled:opacity-50"
            >
              {submitting ? "Sending…" : "Send intro"}
            </button>
            {error && (
              <div role="alert" className="text-xs text-negative">
                {error}
              </div>
            )}
            <button
              type="button"
              onClick={() => setStage("browse")}
              className="self-start text-xs text-text-muted hover:text-text-primary"
            >
              ← Back to candidates
            </button>
          </div>
        )}
      </div>

      <style jsx>{`
        @keyframes bd-fade {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
        @keyframes bd-slide {
          from {
            transform: translateX(100%);
          }
          to {
            transform: translateX(0);
          }
        }
      `}</style>
    </>
  );
}
