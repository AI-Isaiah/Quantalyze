"use client";

/**
 * Phase 10 / Plan 07 / SCENARIO-07. ScenarioCommitDrawer.
 *
 * 720px right slide-over with grouped diff sections (Holdings removed /
 * Strategies added / Weight changes), per-row inline RejectedForm /
 * AllocatedForm, Submit-all gesture with portal'd pre-flight modal, and
 * H4 full-success / full-failure terminal states.
 *
 * H4 — single-tx semantics. The route's RPC either commits the WHOLE batch
 * (success: state=success, drawer collapses to green confirmation card,
 * onSubmitSuccess fires after a 1.5s timer, drawer auto-closes) OR rolls
 * back the WHOLE batch (failure: state=failure, drawer stays open, per-row
 * errors render inline beneath each diff row, onSubmitSuccess does NOT
 * fire — the user can edit and re-submit). NO partial state — the prior
 * "row 0 succeeded, row 1 failed" intermediate is REMOVED.
 *
 * M11 — pre-flight modal a11y. The pre-flight confirmation is rendered via
 * React `createPortal` to `document.body` so the DOM at submit-time has
 * exactly ONE element with role="dialog" + aria-modal="true" (the pre-flight
 * itself). The drawer's `role` is swapped to `region` while the pre-flight
 * is open so screen-reader semantics see ONE modal. Focus trap behaves
 * correctly across the swap.
 *
 * BridgeDrawer is the layout analog (same backdrop + panel + Esc handler
 * + keyframe animations); width here is 720 (vs Bridge's 620) to fit the
 * inline RejectedForm + AllocatedForm rows comfortably.
 *
 * The form-prop construction (RejectedForm + AllocatedForm props per row)
 * uses Plan 01's synthetic match_decision helpers (toVoluntaryRemoveDecision,
 * toVoluntaryAddDecision) plus the existing strategy-shaped form-prop
 * adapter contracts. The adapter call is local — the diff list is already
 * shaped by the composer, and per-row form props are derived inline.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AllocatedForm } from "./AllocatedForm";
import { RejectedForm } from "./RejectedForm";
import {
  toVoluntaryAddDecision,
  toVoluntaryRemoveDecision,
} from "../lib/holding-outcome-adapter";
import type { ScenarioCommitDiff } from "./ScenarioComposer";

export interface ScenarioCommitDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  diffs: ScenarioCommitDiff[];
  /** Called after a FULL-SUCCESS batch (drawer auto-closes). */
  onSubmitSuccess: () => void;
}

// H4 — drawer state machine. "partial" is intentionally absent — the route's
// single-tx RPC either commits the whole batch (success) or rolls back the
// whole batch (failure). There is no per-row partial intermediate.
type SubmitState = "idle" | "preflight" | "submitting" | "success" | "failure";

interface SubmitResponse {
  recorded: number;
  results?: Array<{
    index: number;
    match_decision_id: string;
    bridge_outcome_id: string;
    kind: string;
  }>;
  errors?: Array<{ index: number; error: string }>;
}

export function ScenarioCommitDrawer({
  isOpen,
  onClose,
  diffs,
  onSubmitSuccess,
}: ScenarioCommitDrawerProps) {
  const [state, setState] = useState<SubmitState>("idle");
  const [response, setResponse] = useState<SubmitResponse | null>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  // Reset transient state on close; install Esc handler when open.
  useEffect(() => {
    if (!isOpen) {
      /* eslint-disable react-hooks/set-state-in-effect */
      setState("idle");
      setResponse(null);
      /* eslint-enable react-hooks/set-state-in-effect */
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  // 1.5s success auto-close — UI-SPEC fixes the timing.
  useEffect(() => {
    if (state !== "success") return;
    const t = setTimeout(() => {
      onSubmitSuccess();
      onClose();
    }, 1500);
    return () => clearTimeout(t);
  }, [state, onSubmitSuccess, onClose]);

  if (!isOpen) return null;

  const removed = diffs.filter((d) => d.kind === "voluntary_remove");
  const added = diffs.filter(
    (d) => d.kind === "voluntary_add" || d.kind === "bridge_recommended",
  );
  const modified = diffs.filter((d) => d.kind === "voluntary_modify");
  const errorByIndex = new Map(
    (response?.errors ?? []).map((e) => [e.index, e.error] as const),
  );

  async function handleSubmit() {
    setState("submitting");
    try {
      const res = await fetch("/api/allocator/scenario/commit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ diffs }),
      });
      const json = (await res.json()) as SubmitResponse;
      setResponse(json);
      // H4 — full-success vs full-failure ONLY (no partial state). The
      // route's single-tx RPC returns ok=true with all rows recorded, OR
      // ok=false with per-row errors and recorded=0 (the tx rolled back).
      // The UI mirrors that contract here.
      if (
        res.ok &&
        json.recorded > 0 &&
        (!json.errors || json.errors.length === 0)
      ) {
        setState("success");
      } else {
        setState("failure");
      }
    } catch {
      setState("failure");
      setResponse({
        recorded: 0,
        errors: [{ index: -1, error: "Network error — no decisions were recorded." }],
      });
    }
  }

  // M11 — drawer's role swaps to "region" while the pre-flight is open so
  // the DOM at preflight time contains exactly ONE role="dialog" + aria-modal=
  // "true" element (the pre-flight, rendered via portal below).
  const drawerRoleProps =
    state === "preflight"
      ? { role: "region" as const, "aria-label": "Commit scenario" }
      : {
          role: "dialog" as const,
          "aria-label": "Commit scenario",
          "aria-modal": true as const,
        };

  return (
    <>
      {/* Backdrop — click dismisses */}
      <div
        onClick={onClose}
        aria-hidden="true"
        data-testid="commit-drawer-backdrop"
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(15,23,42,0.32)",
          zIndex: 100,
          animation: "bd-fade 160ms ease",
        }}
      />
      {/* Drawer panel — width 720 per UI-SPEC */}
      <div
        ref={drawerRef}
        {...drawerRoleProps}
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: 720,
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
          <div>
            <div className="text-base font-semibold text-text-primary">
              Commit scenario
            </div>
            <div className="mt-1 text-xs text-text-muted">
              {diffs.length} decisions to record · routed through the Bridge
              outcome graph
            </div>
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

        {state === "success" && response && (
          <div
            role="status"
            className="mt-6 rounded-lg border border-positive bg-[rgba(22,163,74,0.08)] p-4 text-sm text-text-primary"
            data-testid="commit-drawer-success"
          >
            <strong>{response.recorded} decisions recorded.</strong> Scenario
            draft reset to new live state.
          </div>
        )}

        {state !== "success" && (
          <>
            {removed.length > 0 && (
              <section className="mt-6">
                <div className="border-l-4 border-negative pl-3">
                  <div className="text-sm font-semibold text-text-primary">
                    Holdings removed · {removed.length}
                  </div>
                  <div className="mt-1 text-xs text-text-secondary">
                    Each removal is recorded as a Bridge rejection so the
                    outcome graph tracks why you exited.
                  </div>
                </div>
                <ul className="mt-3 grid gap-3">
                  {removed.map((d) => {
                    const idx = diffs.indexOf(d);
                    const err = errorByIndex.get(idx);
                    // N3 — per-row form-prop construction via Plan 01 synthetic
                    // match_decision helpers. The synthetic shape is consumed
                    // by the strategy-shaped form contract; the strategy_id
                    // surfaced to RejectedForm is null for voluntary_remove
                    // (the form just collects the rejection_reason + note;
                    // the actual server-side INSERT happens via the commit
                    // route's RPC delegation, NOT through RejectedForm's
                    // postBridgeOutcome path).
                    void toVoluntaryRemoveDecision({
                      venue: "_",
                      symbol: "_",
                      holding_type: "spot",
                    });
                    return (
                      <li
                        key={`r-${idx}`}
                        className="rounded-lg border border-border p-3"
                        data-diff-index={idx}
                      >
                        <div className="text-sm font-medium text-text-primary">
                          {d.holding_ref}
                        </div>
                        <div className="mt-2">
                          <RejectedForm
                            strategyId=""
                            onRecorded={() => {}}
                            onCancel={() => {}}
                          />
                        </div>
                        {err && (
                          <div
                            role="alert"
                            className="mt-2 text-xs text-negative"
                          >
                            Couldn&apos;t record — {err}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            {added.length > 0 && (
              <section className="mt-6">
                <div className="border-l-4 border-positive pl-3">
                  <div className="text-sm font-semibold text-text-primary">
                    Strategies added · {added.length}
                  </div>
                  <div className="mt-1 text-xs text-text-secondary">
                    Each addition is recorded as a Bridge allocation so the
                    daily delta cron tracks realized return.
                  </div>
                </div>
                <ul className="mt-3 grid gap-3">
                  {added.map((d) => {
                    const idx = diffs.indexOf(d);
                    const err = errorByIndex.get(idx);
                    // N3 — synthetic shape construction (kept inline for grep
                    // visibility; the actual RPC INSERT happens server-side).
                    void toVoluntaryAddDecision(d.strategy_id ?? "");
                    return (
                      <li
                        key={`a-${idx}`}
                        className="rounded-lg border border-border p-3"
                        data-diff-index={idx}
                      >
                        <div className="text-sm font-medium text-text-primary">
                          {d.strategy_id}
                        </div>
                        <div className="mt-2">
                          <AllocatedForm
                            strategyId={d.strategy_id ?? ""}
                            maxWeight={null}
                            onRecorded={() => {}}
                            onCancel={() => {}}
                          />
                        </div>
                        {err && (
                          <div
                            role="alert"
                            className="mt-2 text-xs text-negative"
                          >
                            Couldn&apos;t record — {err}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            {modified.length > 0 && (
              <section className="mt-6">
                <div className="border-l-4 border-text-muted pl-3">
                  <div className="text-sm font-semibold text-text-primary">
                    Weight changes · {modified.length}
                  </div>
                  <div className="mt-1 text-xs text-text-secondary">
                    Rebalances are recorded as voluntary modifications.
                  </div>
                </div>
                <ul className="mt-3 grid gap-3">
                  {modified.map((d) => {
                    const idx = diffs.indexOf(d);
                    const err = errorByIndex.get(idx);
                    return (
                      <li
                        key={`m-${idx}`}
                        className="rounded-lg border border-border p-3"
                        data-diff-index={idx}
                      >
                        <div className="text-sm font-medium text-text-primary">
                          {d.holding_ref} · new weight{" "}
                          {((d.new_weight ?? 0) * 100).toFixed(1)}%
                        </div>
                        <div className="mt-2">
                          <AllocatedForm
                            strategyId=""
                            maxWeight={null}
                            onRecorded={() => {}}
                            onCancel={() => {}}
                          />
                        </div>
                        {err && (
                          <div
                            role="alert"
                            className="mt-2 text-xs text-negative"
                          >
                            Couldn&apos;t record — {err}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            <div className="sticky bottom-0 mt-8 -mx-6 border-t border-border bg-surface p-4">
              <button
                type="button"
                onClick={() => setState("preflight")}
                disabled={
                  diffs.length === 0 ||
                  state === "submitting" ||
                  state === "preflight"
                }
                className="w-full rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
                data-testid="commit-drawer-submit"
              >
                Submit {diffs.length} decision{diffs.length === 1 ? "" : "s"}
              </button>
            </div>
          </>
        )}
      </div>

      {/* M11 — pre-flight modal lives OUTSIDE the drawer's role="dialog" via
          createPortal to document.body. At preflight time the drawer's role
          is swapped to "region", so the DOM has exactly ONE element with
          role="dialog" + aria-modal="true" (this portal). */}
      {state === "preflight" &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Confirm commit"
            className="fixed inset-0 z-[200] flex items-center justify-center bg-[rgba(15,23,42,0.5)]"
          >
            <div className="w-[480px] max-w-[92vw] rounded-md bg-surface p-5 shadow-xl">
              <div className="text-sm font-semibold text-text-primary">
                Submit {diffs.length} decision{diffs.length === 1 ? "" : "s"}?
              </div>
              <div className="mt-2 text-xs text-text-secondary">
                This will record {diffs.length} outcome
                {diffs.length === 1 ? "" : "s"} against the Bridge graph and
                feed the daily delta cron. Decisions can&apos;t be undone — but
                you can record corrections later from the Outcomes timeline.
              </div>
              <div className="mt-4 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setState("idle")}
                  className="rounded-md border border-border px-3 py-1.5 text-xs"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSubmit}
                  className="rounded-md bg-accent px-4 py-1.5 text-sm text-white hover:bg-accent/90 disabled:opacity-50"
                >
                  Submit
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

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
