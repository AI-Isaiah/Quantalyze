"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { scrubPii } from "@/lib/admin/pii-scrub";
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

// Sensitive substring patterns to redact in freeform debug_context lines BEFORE
// clipboard write. The existing scrubPii() utility from src/lib/admin/pii-scrub
// is object-key-name based + JWT-shape based for strings; freeform strings of
// the form `apikey: VALUE` slip through. The following key-prefix patterns
// match UI-SPEC §16.2's contract: "Masks values whose key matches
// /^.*(key|secret|pass|token|credential|cookie|session|auth|bearer)$/i".
//
// The regex is anchored on a key-shaped substring (one of the listed words)
// followed by `=`, `:`, `=>`, or whitespace, then captures the value up to
// the next whitespace/quote/end-of-string.
const SENSITIVE_KEY_VALUE = new RegExp(
  // word boundary, key-shaped name, optional non-greedy suffix until separator
  "\\b((?:api[-_]?key|api[-_]?secret|x-mbx-apikey|ok-access-sign|secret|passphrase|password|token|credential|cookie|session|authorization|bearer))\\s*[:=]+\\s*['\"]?([^\\s'\"]+)['\"]?",
  "gi",
);

function redactSensitiveSubstrings(value: string): string {
  return value.replace(SENSITIVE_KEY_VALUE, (_match, keyName) => {
    return `${keyName}: [REDACTED]`;
  });
}

export function buildDiagBlock(envelope: ErrorEnvelopeType): string {
  const lines = [
    "QUANTALYZE_DIAG",
    envelope.code,
    envelope.correlation_id,
    new Date().toISOString(),
    typeof navigator !== "undefined" ? navigator.userAgent : "unknown-ua",
    ...envelope.debug_context.map((step) => {
      // Two-pass scrub: first redact key:value substring patterns
      // (apikey/secret/etc.), then run scrubPii() to catch JWT-shape tokens.
      const subRedacted = redactSensitiveSubstrings(step);
      const scrubbed = scrubPii(subRedacted);
      const asString =
        typeof scrubbed === "string" ? scrubbed : String(scrubbed ?? "");
      return ` - ${asString}`;
    }),
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

  async function copyDiagnostics() {
    try {
      await navigator.clipboard.writeText(buildDiagBlock(envelope));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
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
      {envelope.debug_context.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-text-muted">
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
              aria-label="Cancel"
            >
              Cancel
            </Button>
          )}
        </div>
      )}

      <details className="mt-3 text-xs text-text-secondary">
        <summary className="cursor-pointer">Diagnostics</summary>
        <p className="mt-2">
          code: <code className="font-mono">{envelope.code}</code>
        </p>
        <p>
          correlation_id:{" "}
          <code className="font-mono">{envelope.correlation_id}</code>
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
