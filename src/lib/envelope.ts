// Phase 16 / OBSERV-06 — bridge from wizardErrors.ts source-of-truth into the
// RFC-9457-style ErrorEnvelope rendered by `src/components/error/ErrorEnvelope.tsx`
// (Phase 17 / DESIGN-02 canonical). The wizard import path
// `@/...wizard/WizardErrorEnvelope` is now a shim re-export of the canonical
// component so existing call-sites (ConnectKeyStep / SyncPreviewStep /
// SubmitStep) keep working. Phase 17 declares wizardErrors.ts the canonical
// human_message source per DESIGN-05.
//
// ISOMORPHIC: this module is pure TypeScript over wizardErrors.ts with no
// server-side runtime dependencies. It is consumed by client components
// (the canonical ErrorEnvelope + the three wizard step files via the shim).
// Do NOT add the Next.js sentinel import (the one whose literal string is
// forbidden in this file by acceptance gate) — Next.js will throw "Module
// not found" at build time and block every wizard render. The literal
// symbol is intentionally absent from this file (not even in prose) so the
// strict grep gate stays loud against future regressions. See PLAN.md
// objective for full rationale.
import {
  formatKeyError,
  type WizardErrorCode,
  type WizardErrorContext,
  type WizardErrorAction,
} from "./wizardErrors";

export interface ErrorEnvelope {
  ok: false;
  code: string;
  human_message: string;
  debug_context: string[];
  correlation_id: string;
  recoverable: boolean;
}

const RECOVERABLE_ACTIONS: ReadonlySet<WizardErrorAction> = new Set([
  "clear_and_retry",
  "try_another_key",
]);

/**
 * Build the envelope a wizard step renders on its error path. Maps the existing
 * WizardErrorCopy shape produced by formatKeyError(...) into the OBSERV-06
 * envelope shape:
 *   title → human_message
 *   fix[] → debug_context
 *   recoverable = any action in RECOVERABLE_ACTIONS
 *
 * formatKeyError() falls through to the UNKNOWN entry when the code is
 * missing or invalid, so this function never returns null/undefined.
 */
export function buildEnvelope(
  code: WizardErrorCode,
  correlation_id: string,
  context?: WizardErrorContext,
): ErrorEnvelope {
  const copy = formatKeyError(code, context);
  return {
    ok: false,
    code,
    human_message: copy.title,
    debug_context: copy.fix,
    correlation_id,
    recoverable: copy.actions.some((a) => RECOVERABLE_ACTIONS.has(a)),
  };
}
