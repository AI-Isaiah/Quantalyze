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

/**
 * Drawer state machine as a discriminated union (audit M-0058). The
 * previous four orthogonal `useState`s (`stage` / `selectedRef` /
 * `submitting` / `error`) carried implicit invariants TS could not check:
 * in `browse` there is no selection and nothing in flight; `confirm`
 * always has a ref. Encoding those as a union makes "confirm without a
 * ref" and "submitting/error while browsing" unrepresentable.
 */
type DrawerState =
  | { stage: "browse" }
  | {
      stage: "confirm";
      ref: string;
      submitting: boolean;
      error: string | null;
    };

const INITIAL_STATE: DrawerState = { stage: "browse" };

/**
 * Phase 10 Plan 05 / D-05. Candidate-strategy payload delivered to
 * onAddToScenario. The shape matches Plan 01's `AddedStrategy` contract
 * — id + name + markets + strategy_types — so the composer (Plan 06) can
 * forward this directly to scenario-state.ts `addStrategyBridge`.
 *
 * markets and strategy_types are best-effort client-side approximations:
 * markets defaults to `[holding.venue]` (the strategy is necessarily live
 * on the holding's venue to be a valid swap candidate); strategy_types
 * defaults to []. The composer can refine these from `payload.strategies`
 * before passing to the scenario-state mutator if higher-fidelity metadata
 * is available.
 */
export interface BridgeAddToScenarioCandidate {
  id: string;
  name: string;
  markets: string[];
  strategy_types: string[];
}

export interface BridgeDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  flaggedHoldings: FlaggedHolding[];
  matchDecisionsByHoldingRef: Record<string, { id: string } | null>;
  /**
   * Phase 10 D-05. When provided, the confirm stage renders an
   * "Add to scenario" CTA alongside the existing "Send intro". This is a
   * CLIENT-ONLY action — no POST happens. The callback receives the
   * flagged-holding's scope_ref + an AddedStrategy-shaped candidate
   * payload; the composer (Plan 06) wires this to scenario-state.ts
   * addStrategyBridge.
   */
  onAddToScenario?: (
    holdingScopeRef: string,
    candidate: BridgeAddToScenarioCandidate,
  ) => void;
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
  onAddToScenario,
}: BridgeDrawerProps) {
  const [state, setState] = useState<DrawerState>(INITIAL_STATE);
  const drawerRef = useRef<HTMLDivElement>(null);

  // 09.1-REVIEW IN-04: split the previous combined effect into two so
  // the eslint-disable scope only wraps the reset path, not the unrelated
  // keydown listener. Mirrors AddWidgetModal:29-62. A cleaner alternative
  // is key-based remount at the call site, but every existing caller
  // depends on stable identity + internal reset semantics.

  // Reset transient state when the drawer closes. The union collapses the
  // four prior resets (stage/selectedRef/error/submitting) into one.
  useEffect(() => {
    if (isOpen) return;
    setState(INITIAL_STATE);
  }, [isOpen]);

  // Esc-to-close handler — only attached while the drawer is open.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const selected =
    state.stage === "confirm"
      ? flaggedHoldings.find((h) => buildHoldingRef(h) === state.ref)
      : null;

  async function handleSendIntro() {
    if (state.stage !== "confirm" || !selected) return;
    setState({ ...state, submitting: true, error: null });
    try {
      const result = await sendBridgeIntro({
        holdingRef: buildHoldingRef(selected),
        topCandidateStrategyId: selected.top_candidate_strategy_id,
      });
      if (!result.ok) {
        setState((prev) =>
          prev.stage === "confirm"
            ? { ...prev, submitting: false, error: result.error }
            : prev,
        );
        return;
      }
      onClose();
    } catch (e) {
      // A rejected helper (network failure, thrown error) must surface like
      // the resolved {ok:false} path: re-enable the button and show an error
      // so the allocator can retry. Without this, the await rejection escapes
      // as an unhandled promise rejection and the button strands on "Sending…".
      const message = e instanceof Error ? e.message : "Failed to send intro";
      setState((prev) =>
        prev.stage === "confirm"
          ? { ...prev, submitting: false, error: message }
          : prev,
      );
    }
  }

  /**
   * Phase 10 D-05. Client-only "Add to scenario" — no POST. The composer
   * (Plan 06) consumes the callback to mutate the client-side scenario draft
   * via scenario-state.ts addStrategyBridge. markets/strategy_types are
   * best-effort approximations from the holding's venue + an empty list;
   * the composer can refine from `payload.strategies` if richer metadata
   * is available before forwarding to the scenario-state mutator.
   */
  function handleAddToScenario() {
    if (state.stage !== "confirm" || !selected || !onAddToScenario) return;
    // Audit H-0085 / Rule 12 (Fail loud): if the host mutator throws
    // SYNCHRONOUSLY, surface the message into the confirm stage's existing
    // role="alert" and KEEP the drawer open (a bare try/finally that always
    // `onClose()`d would dismiss the drawer while the add silently failed).
    // Only close on success. NOTE: the production callback
    // (scenario-state.ts `addStrategyBridge`) mutates through a `setState`
    // updater, so a throw THERE is a render-phase error handled by the route
    // error boundary — NOT by this synchronous catch. This catch is a
    // defensive net for a callback that throws on the spot.
    try {
      onAddToScenario(buildHoldingRef(selected), {
        id: selected.top_candidate_strategy_id,
        name: selected.top_candidate_name,
        markets: [selected.venue],
        strategy_types: [],
      });
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Failed to add to scenario";
      setState((prev) =>
        prev.stage === "confirm" ? { ...prev, error: message } : prev,
      );
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
            {state.stage === "browse" ? "Review candidates" : "Confirm intro"}
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

        {state.stage === "browse" && (
          <div className="mt-4 grid gap-3">
            {/* Mandate gates failed card — designer screenshot 13.51.27 */}
            <div
              className="rounded-md border p-3"
              style={{
                borderColor: "var(--color-bridge-border-100)",
                background: "var(--color-bridge-bg-50)",
              }}
            >
              <div
                className="text-xs"
                style={{
                  color: "var(--color-warning)",
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
                          setState({
                            stage: "confirm",
                            ref,
                            submitting: false,
                            error: null,
                          });
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

        {state.stage === "confirm" && selected && (
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

            <div
              className={onAddToScenario ? "flex items-stretch gap-3" : ""}
            >
              <button
                type="button"
                onClick={handleSendIntro}
                disabled={state.submitting}
                className={`${
                  onAddToScenario ? "flex-1" : "self-start"
                } rounded-md bg-accent px-4 py-2 text-sm text-white hover:bg-accent/90 disabled:opacity-50`}
              >
                {state.submitting ? "Sending…" : "Send intro"}
              </button>
              {onAddToScenario && (
                <button
                  type="button"
                  onClick={handleAddToScenario}
                  className="flex-1 rounded-md bg-accent px-4 py-2 text-sm text-white hover:bg-accent/90"
                  data-testid="bridge-add-to-scenario"
                >
                  Add to scenario
                </button>
              )}
            </div>
            {state.error && (
              <div role="alert" className="text-xs text-negative">
                {state.error}
              </div>
            )}
            <button
              type="button"
              onClick={() => {
                // Returning to browse drops the confirm variant entirely, so
                // any prior Send-intro / Add-to-scenario error is discarded —
                // a stale alert never re-appears when the allocator re-enters
                // the confirm stage.
                setState({ stage: "browse" });
              }}
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
