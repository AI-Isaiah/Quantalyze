// Phase 17 / DESIGN-02 — file moved to src/components/error/ErrorEnvelope.tsx.
// This shim preserves the existing import path used by ConnectKeyStep,
// SyncPreviewStep, and SubmitStep so Phase 17 ships zero call-site churn.
// Phase 19 may delete this file once those steps are rewritten by the
// unified backbone.
export { ErrorEnvelope as WizardErrorEnvelope } from "@/components/error/ErrorEnvelope";
export type { ErrorEnvelopeProps as WizardErrorEnvelopeProps } from "@/components/error/ErrorEnvelope";
export type { ErrorEnvelope } from "@/lib/envelope";
