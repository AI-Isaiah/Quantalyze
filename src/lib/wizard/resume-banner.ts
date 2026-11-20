import { venueSecretIsVerbatim } from "@/lib/closed-sets";
import type { WizardStepKey } from "@/lib/wizard/localStorage";

/**
 * Phase 218 / 218-SC-7 — the body line of the wizard's "We saved your
 * progress" resume banner, chosen by key type and by the step Resume lands on.
 *
 * The founder was told to "paste your API secret again" on a banner whose
 * Resume lands on `sync_preview`, a step with no secret input (2026-11-19).
 * The sentence was true of an earlier wizard shape and stayed on screen.
 *
 * The re-entry sentence therefore appears ONLY when the resumed step is
 * `connect_key`, the one step with a secret input. Today a banner resumes
 * onto `sync_preview` (api/composite) or `csv_upload` (csv), so the API/MT5
 * sentence is dormant until a resumed step needs a secret.
 */

export type ResumeSecretKind = "api_secret" | "investor_password";

const CSV_BODY =
  "A CSV upload draft from an earlier session is ready. Re-select the file and continue.";
const API_BODY = "A draft from an earlier session is ready.";
const SECRETS_NOTE = "Secrets are never stored in your browser, so you will need to";

/**
 * Which secret the draft's key needs. An MT5 key carries an investor password
 * (verbatim, never an API secret). Read through the capability predicate, never
 * a hand-typed venue name, so a second such venue is picked up for free.
 */
export function resumeSecretKind(
  supportedExchanges: readonly string[] | null | undefined,
): ResumeSecretKind {
  return (supportedExchanges ?? []).some((venue) =>
    venueSecretIsVerbatim(venue),
  )
    ? "investor_password"
    : "api_secret";
}

export function resumeBannerBody(input: {
  source: "api" | "csv";
  secretKind: ResumeSecretKind;
  resumeStep: WizardStepKey;
}): string {
  if (input.source === "csv") return CSV_BODY;
  if (input.resumeStep !== "connect_key") return API_BODY;
  const noun =
    input.secretKind === "investor_password"
      ? "enter your investor password"
      : "paste your API secret";
  return `${API_BODY} ${SECRETS_NOTE} ${noun} again.`;
}
