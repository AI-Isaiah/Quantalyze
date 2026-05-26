"use client";

/**
 * ScenarioCommitDrawer — 720px right slide-over with grouped diff sections
 * (Holdings removed / Strategies added / Weight changes), per-row inline
 * RejectedForm / AllocatedForm, Submit-all gesture with portal'd pre-flight
 * modal, and full-success / full-failure terminal states.
 *
 * Single-tx semantics. The route's RPC either commits the WHOLE batch
 * (success: drawer collapses to green confirmation card, onSubmitSuccess
 * fires after a 1.5s timer, drawer auto-closes) OR rolls back the WHOLE
 * batch (failure: drawer stays open, per-row errors render inline beneath
 * each diff row, onSubmitSuccess does NOT fire). Partial-commit responses
 * (recorded < diffs.length) violate that contract and surface to the user
 * with explicit "do NOT retry" copy — retrying would double-commit the rows
 * the server already accepted.
 *
 * Pre-flight modal a11y: the confirmation is rendered via React `createPortal`
 * to `document.body` so the DOM at submit-time has exactly ONE element with
 * role="dialog" + aria-modal="true" (the pre-flight). The drawer's `role`
 * is swapped to `region` while the pre-flight is open. The portal stays
 * mounted through the `submitting` transition so the disabled Submit button
 * remains in the DOM (the disable gate, not unmount, blocks double-clicks).
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  REJECTION_REASONS,
  REJECTION_REASON_LABELS,
  type RejectionReason,
} from "@/lib/bridge-outcome-schema";
import type { ScenarioCommitDiff } from "./ScenarioComposer";
import { captureToSentry } from "@/lib/sentry-capture";

// pr189-followup M13 (type-design-analyzer MED/8) — narrow
// `rejection_reason` from `string?` to the `RejectionReason` enum so the
// drawer can't write a non-enum value. The runtime check in allFilled()
// at REJECTION_REASONS.some(...) re-validates the same invariant, but
// the type narrowing makes a future regression a compile error rather
// than relying on the imperative re-check to catch it.
//
// PerRowState remains a 3-key bag for all four diff kinds (a fuller
// discriminated-union refactor mirroring ScenarioCommitDiff was
// considered but the runtime kind-switch at buildSubmitDiffs covers
// the safety question and the refactor would be invasive). The
// narrowing here closes the most-likely drift surface.
interface PerRowState {
  rejection_reason?: RejectionReason;
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

interface SubmitResponse {
  recorded: number;
  results?: Array<{
    index: number;
    match_decision_id: string;
    bridge_outcome_id: string;
    kind: string;
  }>;
  errors?: Array<{ index: number; error: string }>;
  error?: string;
}

/**
 * Drawer state machine. Discriminated union so the success / failure variants
 * carry the response payload — `kind === "success"` narrows `state.response`
 * to non-null at compile time and forbids the "success without payload" pair
 * that two independent useState cells used to allow.
 *
 * `failureReason` distinguishes user-visible error copy: "partial" means the
 * server returned ok with a partial-recorded count (do NOT retry — some rows
 * landed); "generic" is everything else (network error, top-level error,
 * per-row error list — retry is safe).
 */
type SubmitState =
  | { kind: "idle" }
  | { kind: "preflight" }
  | { kind: "submitting" }
  | { kind: "success"; response: SubmitResponse }
  | {
      kind: "failure";
      response: SubmitResponse | null;
      failureReason: "partial" | "generic";
    };

function generateIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function ScenarioCommitDrawer({
  isOpen,
  onClose,
  diffs,
  onSubmitSuccess,
}: ScenarioCommitDrawerProps) {
  const [state, setState] = useState<SubmitState>({ kind: "idle" });
  const [perRow, setPerRow] = useState<Record<number, PerRowState>>({});
  const drawerRef = useRef<HTMLDivElement>(null);
  const errorBannerRef = useRef<HTMLDivElement>(null);
  const preflightModalRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Stable across retries WITHIN a single drawer-open lifetime. Minted on
  // the first submit attempt; reused on retries from the failure state so
  // the server's dedup treats them as the SAME logical request. Reset on
  // close (a brand-new batch gets a fresh key) and on full success. Caveat:
  // if the parent unmounts mid-submit (route change), the abort effect
  // cancels the in-flight fetch but can't tell whether the server already
  // committed; a subsequent re-open with the same draft content would get
  // a fresh key, so the server's own dedup window is the only safety net
  // for that narrow edge case.
  const idempotencyKeyRef = useRef<string | null>(null);

  // Reset transient state on close; install Esc handler when open.
  useEffect(() => {
    if (!isOpen) {
      /* eslint-disable react-hooks/set-state-in-effect */
      setState({ kind: "idle" });
      setPerRow({});
      /* eslint-enable react-hooks/set-state-in-effect */
      idempotencyKeyRef.current = null;
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Esc must be a no-op while the batch is in-flight. The backend has a
      // single-tx contract: silently closing the drawer mid-submit leaves
      // the allocator wondering whether their commit landed. Force the user
      // to wait for the terminal state.
      if (state.kind === "submitting") return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, onClose, state.kind]);

  // Abort any in-flight fetch on unmount so the response handler does not
  // setState on a destroyed component.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // 1.5s success auto-close.
  useEffect(() => {
    if (state.kind !== "success") return;
    const t = setTimeout(() => {
      onSubmitSuccess();
      onClose();
    }, 1500);
    return () => clearTimeout(t);
  }, [state.kind, onSubmitSuccess, onClose]);

  // Focus trap inside the pre-flight portal. The portal is mounted for
  // `preflight` and `submitting` states. While mounted, Tab must cycle
  // within the modal — otherwise keyboard users escape to the drawer
  // beneath the backdrop. Initial focus lands on the first focusable.
  useEffect(() => {
    if (state.kind !== "preflight" && state.kind !== "submitting") return;
    const container = preflightModalRef.current;
    if (!container) return;
    const focusableSelector =
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const firstFocusable = container.querySelector<HTMLElement>(focusableSelector);
    if (firstFocusable && state.kind === "preflight") {
      firstFocusable.focus();
    }
    const onTab = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const fs = container.querySelectorAll<HTMLElement>(focusableSelector);
      if (fs.length === 0) return;
      const first = fs[0];
      const last = fs[fs.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onTab);
    return () => document.removeEventListener("keydown", onTab);
  }, [state.kind]);

  // Focus restoration on failure. When the pre-flight portal unmounts on
  // a submitting → failure transition, the previously focused Submit
  // button disappears and focus falls to <body>. Move focus to the new
  // error banner so keyboard / screen-reader users have an anchor.
  useEffect(() => {
    if (state.kind === "failure" && errorBannerRef.current) {
      errorBannerRef.current.focus();
    }
  }, [state.kind]);

  if (!isOpen) return null;

  const removed = diffs.filter((d) => d.kind === "voluntary_remove");
  const added = diffs.filter(
    (d) => d.kind === "voluntary_add" || d.kind === "bridge_recommended",
  );
  const modified = diffs.filter((d) => d.kind === "voluntary_modify");
  const response = state.kind === "success" || state.kind === "failure" ? state.response : null;
  // Errors whose `index` doesn't match a real diff row (e.g. index === -1
  // for network/parse failures) would otherwise be invisible — the per-row
  // sections only render entries for valid 0..diffs.length-1 indices. Lift
  // those to the top-level banner.
  const orphanErrorMessages = (response?.errors ?? [])
    .filter((e) => e.index < 0 || e.index >= diffs.length)
    .map((e) => e.error);
  const rowMatchedErrors = new Map(
    (response?.errors ?? [])
      .filter((e) => e.index >= 0 && e.index < diffs.length)
      .map((e) => [e.index, e.error] as const),
  );

  // Single source of truth for the user-visible error banner.
  //   - partial: server returned ok with a recorded count != diffs.length
  //     (single-tx contract violation, both under- and over-counts).
  //   - orphan errors: network / parse failures keyed at index -1.
  //   - generic top-level error string (Zod 400 etc) with no errors list.
  //   - row-only failures: rowMatchedErrors carry per-row copy; no banner.
  const topLevelError = (() => {
    if (state.kind !== "failure") return null;
    if (state.failureReason === "partial") {
      const recorded = state.response?.recorded ?? 0;
      const overRecorded = recorded > diffs.length;
      const direction = overRecorded ? "over-recorded" : "partial";
      // Under-recorded: some rows landed; remediation is to review the
      // Outcomes timeline and record what's missing.
      // Over-recorded: server claims to have committed MORE rows than were
      // submitted (off-by-one / double-count bug); there is nothing
      // "missing" to record, so the user needs support to investigate.
      const remediation = overRecorded
        ? "Contact support — the server reported committing more decisions than were submitted, which needs investigation."
        : "Review the Outcomes timeline and record any missing decisions there, or contact support.";
      return (
        `Server reported ${recorded} of ${diffs.length} recorded (${direction} — single-transaction contract violated). ` +
        "Do NOT retry from this drawer — retrying would compound the discrepancy. " +
        remediation
      );
    }
    if (orphanErrorMessages.length > 0) return orphanErrorMessages.join(" ");
    if (rowMatchedErrors.size > 0) return null;
    return (
      state.response?.error ??
      "Couldn't record decisions. Check the inputs above and try again."
    );
  })();

  // Submit-all is enabled only when every diff has the user-input fields the
  // route schema requires. Inline (not useMemo) so it sits below the
  // `if (!isOpen) return null` early return without breaking hooks order.
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
    }
    return true;
  })();

  function setRow(idx: number, patch: PerRowState) {
    setPerRow((prev) => ({ ...prev, [idx]: { ...prev[idx], ...patch } }));
  }

  function buildSubmitDiffs(): ScenarioCommitDiff[] {
    return diffs.map((d, i) => {
      const r = perRow[i] ?? {};
      const note = r.note && r.note.length > 0 ? r.note : undefined;
      // retro audit (type-design-analyzer): branch on kind so the
      // discriminated union narrows correctly. Pre-narrowing the assigns
      // would have left `merged: ScenarioCommitDiff` un-narrowed and
      // TypeScript couldn't know which optional field is valid on each
      // shape. The kind-switch carries the narrowing through.
      //
      // pr189-followup M7 (silent-failure-hunter MED/9) + red-team MED/8 —
      // exhaustive switch on `kind` with an `assertNever` default so a
      // future 5th union member produces a compile-time error in this
      // function. Pre-followup, the trailing `else` was labeled
      // 'voluntary_modify' but actually matched ANY unknown kind, silently
      // shipping partial-shape diffs for new kinds with no kind-specific
      // input field. The discriminated-union work's whole value
      // proposition was undermined by this single non-exhaustive fallthrough.
      switch (d.kind) {
        case "voluntary_remove":
          return {
            ...d,
            ...(r.rejection_reason
              ? { rejection_reason: r.rejection_reason }
              : {}),
            ...(note !== undefined ? { note } : {}),
          };
        case "voluntary_add":
        case "bridge_recommended":
          return {
            ...d,
            ...(r.percent_allocated !== undefined
              ? { percent_allocated: r.percent_allocated }
              : {}),
            ...(note !== undefined ? { note } : {}),
          };
        case "voluntary_modify":
          // voluntary_modify — only `note` is a per-row drawer input.
          return note !== undefined ? { ...d, note } : { ...d };
        default: {
          const _exhaustive: never = d;
          throw new Error(
            `[ScenarioCommitDrawer] buildSubmitDiffs — unhandled diff kind: ${
              (_exhaustive as { kind: string }).kind
            }`,
          );
        }
      }
    });
  }

  // Gate all three close paths (Esc, backdrop, X). The Esc handler also
  // checks this internally, but routing every close gesture through one
  // helper makes the invariant impossible to forget on a new close path.
  function safeClose() {
    if (state.kind === "submitting") return;
    onClose();
  }

  async function handleSubmit() {
    // Supersede any prior in-flight request. The Submit button is disabled
    // while submitting (so this is defense-in-depth), but unmount during an
    // in-flight retry could otherwise leak a setState-after-unmount.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // Mint once per batch, reuse on user-initiated retry. The server
    // dedups on this header so two retries of the same batch are seen as
    // ONE logical request.
    if (idempotencyKeyRef.current === null) {
      idempotencyKeyRef.current = generateIdempotencyKey();
    }
    const idempotencyKey = idempotencyKeyRef.current;

    setState({ kind: "submitting" });
    let res: Response;
    try {
      res = await fetch("/api/allocator/scenario/commit", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({ diffs: buildSubmitDiffs() }),
        signal: controller.signal,
      });
    } catch (err) {
      if (
        (err instanceof DOMException && err.name === "AbortError") ||
        controller.signal.aborted
      ) {
        return;
      }
      setState({
        kind: "failure",
        failureReason: "generic",
        response: {
          recorded: 0,
          errors: [{ index: -1, error: "Network error — no decisions were recorded." }],
        },
      });
      return;
    }

    // Parse the response body separately so that a 5xx returning HTML, an
    // edge-cached empty 200, or any other non-JSON payload surfaces as a
    // proper failure rather than as the catch branch's "network error"
    // (which would be wrong — the request did reach the server).
    //
    // pr189-followup M11 (type-design-analyzer MED/8) — guard against
    // unstructured payloads BEFORE lifting into state. Pre-followup, the
    // `as SubmitResponse` cast accepted any shape (an edge-cached `{}`,
    // a future server change to a new envelope, an HTML error page that
    // somehow parsed as JSON). The defensive `?? 0` further down in
    // partial-render then masked the dishonesty. Validate the minimum
    // structural shape — `recorded` must be a finite number — and
    // surface a clear failure when it isn't.
    let raw: unknown;
    try {
      raw = await res.json();
    } catch {
      if (controller.signal.aborted) return;
      setState({
        kind: "failure",
        failureReason: "generic",
        response: {
          recorded: 0,
          errors: [
            {
              index: -1,
              error: res.ok
                ? "Server returned an empty response — no decisions were recorded."
                : `Server returned an invalid response (status ${res.status}) — no decisions were recorded.`,
            },
          ],
        },
      });
      return;
    }
    const isValidShape =
      raw !== null &&
      typeof raw === "object" &&
      typeof (raw as { recorded?: unknown }).recorded === "number" &&
      Number.isFinite((raw as { recorded: number }).recorded);
    if (!isValidShape) {
      if (controller.signal.aborted) return;
      setState({
        kind: "failure",
        failureReason: "generic",
        response: {
          recorded: 0,
          errors: [
            {
              index: -1,
              error: res.ok
                ? "Server returned a malformed response — no decisions were recorded."
                : `Server returned a malformed response (status ${res.status}) — no decisions were recorded.`,
            },
          ],
        },
      });
      return;
    }
    const json = raw as SubmitResponse;

    // Strict success gate: the route's single-tx RPC commits the WHOLE batch
    // or rolls back the WHOLE batch. `recorded === diffs.length` is the only
    // signal that all rows landed.
    const noErrors = !json.errors || json.errors.length === 0;

    // NEW-C18-12: also verify structural match — the result set must cover
    // every submitted index exactly once with the matching kind. A right-count
    // / wrong-index response is accepted as success by a count-only check but
    // silently skips one diff and double-records another.
    const resultsStructurallyMatch = (() => {
      if (!json.results || json.results.length !== diffs.length) return false;
      const expectedIndices = new Set(diffs.map((_, i) => i));
      for (const r of json.results) {
        if (!expectedIndices.has(r.index)) return false;
        if (r.kind !== diffs[r.index]?.kind) return false;
        expectedIndices.delete(r.index);
      }
      return expectedIndices.size === 0;
    })();

    const fullSuccess =
      res.ok &&
      json.recorded === diffs.length &&
      noErrors &&
      // Only apply the structural check when the route returns a results array.
      // If results is absent (older route version or external call) fall back
      // to the count-only check to avoid false failures on a count-matching
      // response with no per-row detail.
      (json.results === undefined || resultsStructurallyMatch);

    if (fullSuccess) {
      idempotencyKeyRef.current = null;
      setState({ kind: "success", response: json });
      return;
    }

    // Single-tx contract violation: server returned 2xx with a recorded
    // count that does not equal diffs.length. Both directions are dangerous:
    //   - recorded < length: some rows landed; retrying double-commits them.
    //   - recorded > length: server over-reported (off-by-one / double-count
    //     bug); retrying compounds the over-recording.
    // Either way the user MUST NOT retry from this drawer.
    const isContractViolation =
      res.ok && json.recorded !== diffs.length && noErrors;

    // F-07: a structural mismatch (right count, wrong indices or kinds) is also
    // unsafe to retry — the server may have committed rows under wrong identifiers.
    // Previously this fell through to failureReason:"generic" which tells the user
    // "retry is safe." Route it to "partial" instead, which carries the same
    // "do NOT retry" copy path as a count mismatch.
    const isStructuralMismatch =
      res.ok &&
      json.results !== undefined &&
      !resultsStructurallyMatch &&
      json.recorded === diffs.length;

    // F-03: server contract violations (structural mismatch + count mismatch)
    // are bugs the server should never produce. Capture to Sentry so engineers
    // see these events in production rather than only hearing about them via
    // user support escalations.
    if (!fullSuccess) {
      if (isStructuralMismatch) {
        captureToSentry(
          new Error("ScenarioCommitDrawer: structural mismatch in commit results"),
          {
            tags: { component: "ScenarioCommitDrawer", check: "C18-12" },
            extra: {
              submitted_count: diffs.length,
              results_count: json.results?.length,
              recorded: json.recorded,
            },
          },
        );
      } else if (isContractViolation) {
        captureToSentry(
          new Error("ScenarioCommitDrawer: recorded count violates single-tx contract"),
          {
            tags: { component: "ScenarioCommitDrawer", check: "C18-12" },
            extra: { submitted: diffs.length, recorded: json.recorded },
          },
        );
      }
    }

    setState({
      kind: "failure",
      failureReason: isStructuralMismatch || isContractViolation ? "partial" : "generic",
      response: json,
    });
  }

  // The drawer's role swaps to "region" while the pre-flight is open so the
  // DOM at preflight time contains exactly ONE role="dialog" + aria-modal=
  // "true" element (the pre-flight). Kept through `submitting` too so the
  // still-mounted pre-flight portal remains the single role="dialog".
  const drawerRoleProps =
    state.kind === "preflight" || state.kind === "submitting"
      ? { role: "region" as const, "aria-label": "Commit scenario" }
      : {
          role: "dialog" as const,
          "aria-label": "Commit scenario",
          "aria-modal": true as const,
        };

  return (
    <>
      <div
        onClick={safeClose}
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
            onClick={safeClose}
            aria-label="Close drawer"
            disabled={state.kind === "submitting"}
            className="text-text-muted hover:text-text-primary disabled:opacity-50"
          >
            ×
          </button>
        </div>

        {state.kind === "success" && (
          <div
            role="status"
            className="mt-6 rounded-lg border border-positive bg-[rgba(21,128,61,0.08)] p-4 text-sm text-text-primary"
            data-testid="commit-drawer-success"
          >
            <strong>{state.response.recorded} decisions recorded.</strong>{" "}
            Scenario draft reset to new live state.
          </div>
        )}

        {state.kind !== "success" && (
          <>
            {topLevelError && (
              <div
                ref={errorBannerRef}
                role="alert"
                tabIndex={-1}
                data-testid="commit-drawer-error"
                data-failure-reason={
                  state.kind === "failure" ? state.failureReason : undefined
                }
                className="mt-6 rounded-md border border-negative bg-[rgba(220,38,38,0.05)] p-3 text-sm text-negative focus:outline-none focus:ring-2 focus:ring-negative/50"
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
                    const err = rowMatchedErrors.get(idx);
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
                              onChange={(e) => {
                                // pr189-followup M13 — value comes from the
                                // REJECTION_REASONS-derived <option> list
                                // below, so the runtime value is always a
                                // member of the union. The cast bridges the
                                // string-typed event payload to the narrowed
                                // PerRowState.rejection_reason type. The
                                // allFilled() check at L260 re-validates the
                                // invariant defensively.
                                const next = e.target.value as RejectionReason;
                                setRow(idx, { rejection_reason: next });
                              }}
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
                    const err = rowMatchedErrors.get(idx);
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
                    const err = rowMatchedErrors.get(idx);
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
                onClick={() => setState({ kind: "preflight" })}
                disabled={
                  diffs.length === 0 ||
                  state.kind === "submitting" ||
                  state.kind === "preflight" ||
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

      {/* Pre-flight modal lives OUTSIDE the drawer's role="dialog" via
          createPortal to document.body. At preflight time the drawer's role
          is swapped to "region", so the DOM has exactly ONE element with
          role="dialog" + aria-modal="true" (this portal). Stays mounted
          through `submitting` so the disabled Submit button remains in DOM
          and a rapid double-click can't bypass the gate by firing the click
          handler twice before React commits the disable. */}
      {(state.kind === "preflight" || state.kind === "submitting") &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={preflightModalRef}
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
                  onClick={() => setState({ kind: "idle" })}
                  disabled={state.kind === "submitting"}
                  className="rounded-md border border-border px-3 py-1.5 text-xs disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={state.kind === "submitting"}
                  className="rounded-md bg-accent px-4 py-1.5 text-sm text-white hover:bg-accent/90 disabled:opacity-50"
                >
                  {state.kind === "submitting" ? "Submitting…" : "Submit"}
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
