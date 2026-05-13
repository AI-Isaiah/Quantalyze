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
import {
  REJECTION_REASONS,
  REJECTION_REASON_LABELS,
} from "@/lib/bridge-outcome-schema";
import type { ScenarioCommitDiff } from "./ScenarioComposer";

interface PerRowState {
  rejection_reason?: string;
  percent_allocated?: number;
  note?: string;
}

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
  // Per-row form state: index → { rejection_reason, percent_allocated, note }.
  // The composer's diff shape carries the kind + ref + size, but the route
  // schema also requires user-collected fields per kind:
  //   - voluntary_remove → rejection_reason (enum) + optional note
  //   - voluntary_add / bridge_recommended → percent_allocated + optional note
  // Drawer holds these as a controlled-input map; Submit-all merges them
  // into the diffs at POST time so the wire shape matches the schema.
  const [perRow, setPerRow] = useState<Record<number, PerRowState>>({});
  const drawerRef = useRef<HTMLDivElement>(null);
  // P1934 (audit-2026-05-07 Block C / C.2) — AbortController so an
  // unmount or a repeat submit click cancels the in-flight POST and the
  // post-fetch setState calls don't fire against an unmounted component.
  const abortRef = useRef<AbortController | null>(null);

  // Reset transient state on close; install Esc handler when open.
  useEffect(() => {
    if (!isOpen) {
      /* eslint-disable react-hooks/set-state-in-effect */
      setState("idle");
      setResponse(null);
      setPerRow({});
      /* eslint-enable react-hooks/set-state-in-effect */
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // P1934 — Esc must be a no-op while the batch is in-flight. The
      // backend has a single-tx contract: silently closing the drawer
      // mid-submit leaves the allocator wondering whether their commit
      // landed. Force the user to wait for the terminal state (success
      // collapses + auto-closes; failure leaves the drawer open with
      // per-row errors so they can edit and retry).
      if (state === "submitting") return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, onClose, state]);

  // P1934 — on unmount, abort any in-flight fetch so we don't leak a
  // setState-after-unmount when the response comes back to a destroyed
  // component. Empty deps so the cleanup fires exactly once on unmount.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // 1.5s success auto-close.
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

  // Top-level (non-per-row) failure message. The route returns Zod-shape
  // errors as `{ error, issues }` with no per-row index, so errorByIndex
  // is empty. Without this surface, a 400 leaves the drawer silent.
  const topLevelError =
    state === "failure" && errorByIndex.size === 0
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ((response as any)?.error as string | undefined) ??
        "Couldn't record decisions. Check the inputs above and try again."
      : null;

  // Validation: Submit-all is enabled only when every diff has the
  // user-input fields the route schema requires. Inline (not useMemo) so it
  // sits below the `if (!isOpen) return null` early return without breaking
  // hooks order; the computation is O(diffs.length) and runs once per render.
  const allFilled = (() => {
    for (let i = 0; i < diffs.length; i++) {
      const d = diffs[i];
      const r = perRow[i];
      if (d.kind === "voluntary_remove") {
        if (
          !r?.rejection_reason ||
          !REJECTION_REASONS.some((x) => x === r.rejection_reason)
        )
          return false;
      } else if (
        d.kind === "voluntary_add" ||
        d.kind === "bridge_recommended"
      ) {
        if (
          r?.percent_allocated === undefined ||
          !Number.isFinite(r.percent_allocated) ||
          r.percent_allocated < 0 ||
          r.percent_allocated > 100
        )
          return false;
      }
      // voluntary_modify needs no extra user input — new_weight is on the diff.
    }
    return true;
  })();

  function setRow(idx: number, patch: PerRowState) {
    setPerRow((prev) => ({ ...prev, [idx]: { ...prev[idx], ...patch } }));
  }

  // Merge the user-collected per-row state into the diffs at submit time so
  // the wire shape matches the route's discriminated zod union.
  function buildSubmitDiffs(): ScenarioCommitDiff[] {
    return diffs.map((d, i) => {
      const r = perRow[i] ?? {};
      const merged: ScenarioCommitDiff = { ...d };
      if (d.kind === "voluntary_remove" && r.rejection_reason) {
        merged.rejection_reason = r.rejection_reason;
      }
      if (
        (d.kind === "voluntary_add" || d.kind === "bridge_recommended") &&
        r.percent_allocated !== undefined
      ) {
        merged.percent_allocated = r.percent_allocated;
      }
      if (r.note && r.note.length > 0) merged.note = r.note;
      return merged;
    });
  }

  async function handleSubmit() {
    // P1934 — supersede any prior in-flight request and arm a fresh
    // AbortController so unmount / repeat-submit can cancel cleanly.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState("submitting");
    try {
      const res = await fetch("/api/allocator/scenario/commit", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          // P1934 — Block D server honors Idempotency-Key for safe replay.
          // If Block D hasn't shipped yet the header is silently ignored
          // (no deserialization gate on the server side).
          "Idempotency-Key":
            typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
              ? crypto.randomUUID()
              : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        },
        body: JSON.stringify({ diffs: buildSubmitDiffs() }),
        signal: controller.signal,
      });
      const json = (await res.json()) as SubmitResponse;
      setResponse(json);
      // P1934 — strict success gate: the route's single-tx RPC commits the
      // WHOLE batch or rolls back the WHOLE batch. `recorded === diffs.length`
      // is the only signal that all rows landed. A `recorded:1` reply for
      // a 3-row diff is a partial-state leak from the backend and must
      // surface as failure on the client so onSubmitSuccess does NOT fire
      // and the draft is NOT cleared.
      const fullSuccess =
        res.ok &&
        json.recorded === diffs.length &&
        (!json.errors || json.errors.length === 0);
      setState(fullSuccess ? "success" : "failure");
    } catch (err) {
      // AbortError on user-initiated cancel / unmount — swallow silently
      // so the destroyed component does not setState. Any other error is
      // a true network failure and surfaces as failure state.
      if (
        err instanceof DOMException &&
        err.name === "AbortError"
      ) {
        return;
      }
      // Also catch the AbortController.abort() signal-thrown error in
      // environments where it isn't a DOMException (some polyfills).
      if (controller.signal.aborted) return;
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
      {/* Drawer panel — width 720. */}
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
            className="mt-6 rounded-lg border border-positive bg-[rgba(21,128,61,0.08)] p-4 text-sm text-text-primary"
            data-testid="commit-drawer-success"
          >
            <strong>{response.recorded} decisions recorded.</strong> Scenario
            draft reset to new live state.
          </div>
        )}

        {state !== "success" && (
          <>
            {topLevelError && (
              <div
                role="alert"
                aria-live="polite"
                data-testid="commit-drawer-error"
                className="mt-6 rounded-md border border-negative bg-[rgba(220,38,38,0.05)] p-3 text-sm text-negative"
              >
                {topLevelError}
              </div>
            )}
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
                    const row = perRow[idx] ?? {};
                    return (
                      <li
                        key={`r-${idx}`}
                        className="rounded-lg border border-border p-3"
                        data-diff-index={idx}
                      >
                        <div className="text-sm font-medium text-text-primary">
                          {d.holding_ref}
                        </div>
                        <div className="mt-2 flex flex-wrap items-end gap-3 border-t border-border pt-3 text-sm font-sans">
                          <label className="flex flex-col gap-1">
                            <span className="text-text-secondary text-xs">
                              Why not?
                            </span>
                            <select
                              required
                              value={row.rejection_reason ?? ""}
                              onChange={(e) =>
                                setRow(idx, {
                                  rejection_reason: e.target.value,
                                })
                              }
                              className="rounded border border-border bg-surface px-2 py-1.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
                              aria-label={`Why not? (${d.holding_ref})`}
                              data-testid={`commit-rejection-${idx}`}
                            >
                              <option value="" disabled>
                                Select…
                              </option>
                              {REJECTION_REASONS.map((r) => (
                                <option key={r} value={r}>
                                  {REJECTION_REASON_LABELS[r]}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="flex flex-1 min-w-[180px] flex-col gap-1">
                            <span className="text-text-secondary text-xs">
                              Note (optional)
                            </span>
                            <textarea
                              rows={1}
                              maxLength={2000}
                              value={row.note ?? ""}
                              onChange={(e) =>
                                setRow(idx, { note: e.target.value })
                              }
                              className="w-full rounded border border-border bg-surface px-2 py-1.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/50 resize-none"
                            />
                          </label>
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
                    const row = perRow[idx] ?? {};
                    return (
                      <li
                        key={`a-${idx}`}
                        className="rounded-lg border border-border p-3"
                        data-diff-index={idx}
                      >
                        <div className="text-sm font-medium text-text-primary">
                          {d.strategy_id}
                        </div>
                        <div className="mt-2 flex flex-wrap items-end gap-3 border-t border-border pt-3 text-sm font-sans">
                          <label className="flex flex-col gap-1">
                            <span className="text-text-secondary text-xs">
                              Percent allocated
                            </span>
                            <input
                              type="number"
                              min={0}
                              max={100}
                              step={0.1}
                              required
                              value={row.percent_allocated ?? ""}
                              onChange={(e) => {
                                const v = e.target.value;
                                setRow(idx, {
                                  percent_allocated:
                                    v === "" ? undefined : Number(v),
                                });
                              }}
                              className="font-metric w-24 rounded border border-border bg-surface px-2 py-1.5 text-sm tabular-nums text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
                              aria-label={`Percent allocated (${d.strategy_id})`}
                              data-testid={`commit-percent-${idx}`}
                            />
                          </label>
                          <label className="flex flex-1 min-w-[180px] flex-col gap-1">
                            <span className="text-text-secondary text-xs">
                              Note (optional)
                            </span>
                            <textarea
                              rows={1}
                              maxLength={2000}
                              value={row.note ?? ""}
                              onChange={(e) =>
                                setRow(idx, { note: e.target.value })
                              }
                              className="w-full rounded border border-border bg-surface px-2 py-1.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/50 resize-none"
                            />
                          </label>
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
                    const row = perRow[idx] ?? {};
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
                        <div className="mt-2 border-t border-border pt-3 text-sm font-sans">
                          <label className="flex flex-1 min-w-[180px] flex-col gap-1">
                            <span className="text-text-secondary text-xs">
                              Note (optional)
                            </span>
                            <textarea
                              rows={1}
                              maxLength={2000}
                              value={row.note ?? ""}
                              onChange={(e) =>
                                setRow(idx, { note: e.target.value })
                              }
                              className="w-full rounded border border-border bg-surface px-2 py-1.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/50 resize-none"
                            />
                          </label>
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
              {!allFilled && (
                <p className="mb-2 text-xs text-text-muted">
                  Fill in a reason for each removal and a percent allocated for
                  each addition before submitting.
                </p>
              )}
              <button
                type="button"
                onClick={() => setState("preflight")}
                disabled={
                  diffs.length === 0 ||
                  state === "submitting" ||
                  state === "preflight" ||
                  !allFilled
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
