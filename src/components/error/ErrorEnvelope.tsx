"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { scrubFreeformString } from "@/lib/admin/pii-scrub";
import type { ErrorEnvelope as ErrorEnvelopeType } from "@/lib/envelope";

// Phase 17 / DESIGN-02 — canonical surface-agnostic error envelope renderer.
//
// Used by every error surface in v1.0.0:
//   - wizard steps (via re-export shim at the wizard path)
//   - CSV upload errors
//   - factsheet load failures
//   - admin status page
//   - future error.tsx route boundaries
//
// All <button> elements MUST be type="button" (Pitfall 9 — prevents accidental
// form submission when the envelope renders inside a parent <form>, e.g.
// ConnectKeyStep's <form>).
//
// Visual contract is UI-SPEC §15-§16. Title typography lock (16px DM Sans
// semibold #1A1A2E) is REQ DESIGN-02; the title's destructive identity is
// carried by the shell border-negative/30 + bg-negative/5, not the title
// colour.
//
// Copy-diagnostics format is the newline-delimited QUANTALYZE_DIAG block
// (UI-SPEC §16.1). pii-scrub.ts is applied to every debug_context line BEFORE
// navigator.clipboard.writeText — clipboard is the user-controlled
// exfiltration surface; Sentry captures the raw envelope server-side via the
// existing _redact_before_send hook.

// NOTE: The `ErrorEnvelope` data-shape type is NOT re-exported from this file
// because it would collide with the `function ErrorEnvelope` declared below
// (TS2323). Consumers needing the type should import it from `@/lib/envelope`
// directly, OR via the shim at the wizard path which re-exports it under the
// alias `ErrorEnvelope` from `@/lib/envelope`.

export interface ErrorEnvelopeProps {
  envelope: ErrorEnvelopeType;
  onRetry?: () => void;
  onCancel?: () => void;
}

export function buildDiagBlock(envelope: ErrorEnvelopeType): string {
  const lines = [
    "QUANTALYZE_DIAG",
    envelope.code,
    envelope.correlation_id,
    new Date().toISOString(),
    typeof navigator !== "undefined" ? navigator.userAgent : "unknown-ua",
    // Three-pass scrub via the canonical helper at
    // `@/lib/admin/pii-scrub` (CR-01 — Authorization: Bearer JWT regression).
    // Adding a new denylist key requires editing one file (pii-scrub.ts),
    // not two.
    ...envelope.debug_context.map((step) => ` - ${scrubFreeformString(step)}`),
    "--- pii-scrubbed ---",
  ];
  return lines.join("\n");
}

export function ErrorEnvelope({
  envelope,
  onRetry,
  onCancel,
}: ErrorEnvelopeProps) {
  const [copied, setCopied] = useState(false);
  // Phase-16 IN-01: track the 2s "Copied" flash so we can clear it if the
  // component unmounts mid-flash (e.g. user navigates away after clicking
  // Copy). Without this the timer fires on an unmounted tree and React 19
  // tolerates it but holds the stale closure.
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Adversarial follow-up to IN-01: `navigator.clipboard.writeText` is async,
  // so the resolution can land AFTER the cleanup effect has already run.
  // Track mounted-ness so the post-await `setCopied`/`setTimeout` short-
  // circuits when the tree is gone (otherwise the timer-cleanup guard above
  // never sees the timer because it was registered post-unmount).
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (copiedTimerRef.current !== null) {
        clearTimeout(copiedTimerRef.current);
        copiedTimerRef.current = null;
      }
    };
  }, []);

  async function copyDiagnostics() {
    try {
      await navigator.clipboard.writeText(buildDiagBlock(envelope));
      if (!isMountedRef.current) return;
      setCopied(true);
      if (copiedTimerRef.current !== null) {
        clearTimeout(copiedTimerRef.current);
      }
      copiedTimerRef.current = setTimeout(() => {
        setCopied(false);
        copiedTimerRef.current = null;
      }, 2000);
    } catch {
      if (!isMountedRef.current) return;
      setCopied(false);
    }
  }

  const showRetry = envelope.recoverable && Boolean(onRetry);
  const showCancel = Boolean(onCancel);

  return (
    <div
      role="alert"
      className="rounded-md border border-negative/30 bg-negative/5 px-4 py-3"
      data-testid="error-envelope"
      data-testid-legacy="wizard-error-envelope"
      data-error-code={envelope.code}
    >
      <p className="text-base font-semibold text-text-primary">
        {envelope.human_message}
      </p>
      {envelope.cause && (
        // Phase 21 — surface WizardErrorCopy.cause so the user sees WHY,
        // not just WHAT. Was being silently dropped by buildEnvelope before
        // this commit (only title/fix made it through). Same a11y-aware
        // text-text-secondary token used for debug_context, so contrast
        // ratios on bg-negative/5 stay above 4.5:1.
        <p className="mt-1.5 text-sm text-text-secondary">{envelope.cause}</p>
      )}
      {envelope.debug_context.length > 0 && (
        // Phase 17 / DESIGN-05: text-text-secondary (#4A5568) on bg-negative/5
        // (~#FDF4F4) yields ~7.81:1, comfortably above WCAG 2.0 AA (≥4.5:1).
        // Earlier Phase 17 plans rendered text-text-muted (#64748B) here, which
        // resolved to ~4.45:1 and was tracked as a deferred AA gap. Phase 17 is
        // the a11y-minimums phase, so the gap is closed in-phase rather than
        // deferred.
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-text-secondary">
          {envelope.debug_context.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ul>
      )}

      {(showRetry || showCancel) && (
        <div className="mt-3 flex gap-2">
          {showRetry && onRetry && (
            <Button
              type="button"
              size="sm"
              onClick={onRetry}
              aria-label="Retry"
            >
              Retry
            </Button>
          )}
          {showCancel && onCancel && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onCancel}
              aria-label="Cancel and return"
            >
              Cancel
            </Button>
          )}
        </div>
      )}

      <details className="mt-3 text-xs text-text-secondary">
        <summary className="cursor-pointer">Diagnostics</summary>
        <p className="mt-2">
          code: <code className="font-metric tabular-nums">{envelope.code}</code>
        </p>
        <p>
          correlation_id:{" "}
          <code className="font-metric tabular-nums">{envelope.correlation_id}</code>
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={copyDiagnostics}
          className="mt-2"
        >
          {copied ? "Copied" : "Copy diagnostics"}
        </Button>
        <span className="ml-2" role="status" aria-live="polite">
          {copied ? "Copied to clipboard" : ""}
        </span>
      </details>
    </div>
  );
}
