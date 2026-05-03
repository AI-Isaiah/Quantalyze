/**
 * Phase 17 Plan 04 / DESIGN-02 — WizardErrorEnvelope shim smoke-test.
 *
 * The component logic (DOM order, typography, newline-delimited copy
 * payload, pii-scrub pass, aria-labels, etc.) lives at
 * src/components/error/ErrorEnvelope.test.tsx — that is the canonical
 * test surface for the renderer. This file only proves the shim at the
 * old wizard path resolves to the same Function reference, so the three
 * step consumers (ConnectKeyStep / SyncPreviewStep / SubmitStep) keep
 * working without any code changes.
 *
 * Per UI-SPEC §15.1-15.2 — Option A migration (smoke-test, not
 * duplicate-deep-test).
 */

import { describe, it, expect } from "vitest";
import { WizardErrorEnvelope } from "./WizardErrorEnvelope";
import { ErrorEnvelope as CanonicalErrorEnvelope } from "@/components/error/ErrorEnvelope";
import { buildEnvelope } from "@/lib/envelope";
import { WIZARD_ERROR_COPY } from "@/lib/wizardErrors";

describe("[Phase 17 / DESIGN-02] WizardErrorEnvelope shim", () => {
  it("re-exports the canonical ErrorEnvelope component (same Function reference)", () => {
    expect(WizardErrorEnvelope).toBe(CanonicalErrorEnvelope);
  });
});

// Preserve the [OBSERV-06] buildEnvelope contract tests at this path —
// they assert the wizardErrors.ts → envelope mapping which Phase 17
// declares the canonical bridge per DESIGN-05. No DOM rendering; pure
// function unit tests live independently of the component rebrand.
describe("[OBSERV-06] buildEnvelope (Phase 17 contract preserved)", () => {
  it("maps a known code to a recoverable envelope with human_message + debug_context", () => {
    // KEY_INVALID_SIGNATURE actions include clear_and_retry → recoverable=true
    const env = buildEnvelope("KEY_INVALID_SIGNATURE", "cid-x");
    expect(env.code).toBe("KEY_INVALID_SIGNATURE");
    expect(env.correlation_id).toBe("cid-x");
    expect(env.ok).toBe(false);
    expect(env.recoverable).toBe(true);
    expect(env.human_message).toBe(
      WIZARD_ERROR_COPY.KEY_INVALID_SIGNATURE.title,
    );
    expect(env.debug_context).toEqual(
      WIZARD_ERROR_COPY.KEY_INVALID_SIGNATURE.fix,
    );
  });

  it("UNKNOWN fallback returns a valid envelope (never null)", () => {
    const env = buildEnvelope("UNKNOWN", "cid-y");
    expect(env.code).toBe("UNKNOWN");
    expect(env.correlation_id).toBe("cid-y");
    expect(env.human_message).toBeTruthy();
    expect(Array.isArray(env.debug_context)).toBe(true);
    expect(env.debug_context.length).toBeGreaterThan(0);
  });

  it("derives recoverable=false when the actions array contains no recoverable verbs", () => {
    // SUBMIT_NOTIFY_FAILED actions = ["request_call"] — no recoverable verb → false
    const env = buildEnvelope("SUBMIT_NOTIFY_FAILED", "cid-z");
    expect(env.recoverable).toBe(false);
  });
});
