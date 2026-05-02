"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import type { ErrorEnvelope } from "@/lib/envelope";

// Phase 16 / OBSERV-06 — wizard error envelope component.
// Visual contract mirrors the locked CsvValidationEnvelope analog:
//   role=alert + className="rounded-md border border-negative/30 bg-negative/5 px-4 py-3"
//   data-testid + data error code attributes
//   <details>/<summary> for diagnostics; correlation_id rendered inside.
//
// Phase 17 owns the global redesign per UC-D (route-level error.tsx +
// global-error.tsx fallback H1 is OUT OF SCOPE for this plan — that surface
// stays as-is until Phase 17).
//
// All <button> elements MUST be type="button" (Pitfall 9 — prevents accidental
// form submission when the envelope is rendered inside ConnectKeyStep's <form>).

export type { ErrorEnvelope };

interface Props {
  envelope: ErrorEnvelope;
  onRetry?: () => void;
  onCancel?: () => void;
}

export function WizardErrorEnvelope({ envelope, onRetry, onCancel }: Props) {
  const [copied, setCopied] = useState(false);

  async function copyDiagnostics() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(envelope, null, 2));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  const showActions =
    (envelope.recoverable && Boolean(onRetry)) || Boolean(onCancel);

  return (
    <div
      role="alert"
      className="rounded-md border border-negative/30 bg-negative/5 px-4 py-3"
      data-testid="wizard-error-envelope"
      data-error-code={envelope.code}
    >
      <p className="text-sm font-semibold text-negative">{envelope.human_message}</p>
      {envelope.debug_context.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-text-muted">
          {envelope.debug_context.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ul>
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

      {showActions && (
        <div className="mt-3 flex gap-2">
          {envelope.recoverable && onRetry && (
            <Button type="button" size="sm" onClick={onRetry}>
              Retry
            </Button>
          )}
          {onCancel && (
            <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
              Cancel
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
