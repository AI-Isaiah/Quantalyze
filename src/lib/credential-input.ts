import type React from "react";

/**
 * Phase 169.3 D-76: the one client-side rule for exchange credential inputs.
 *
 * Pure and client-safe on purpose: no "use client" directive and no imports
 * beyond a type-only React import. Do NOT import `analytics-client.ts` (or
 * anything server-only) here; it pulls `node:crypto` in through
 * `tenant-claim.ts`, which a client component cannot load.
 *
 * Consumers: `ApiKeyForm.tsx`, the wizard's `ConnectKeyStep.tsx` and
 * `MultiKeyConnectStep.tsx`, `StrategyForm.tsx`'s Connect Exchange API Key
 * modal, the landing page's `VerificationForm.tsx`, and
 * `UpdateMt5SecretDialog.tsx` (the secret attribute set only; it never
 * normalizes, because its rotate path stores the password exactly as sent).
 */

/**
 * One leading run and one trailing run of JS `\s` or U+200B. JS `\s` covers
 * space, tab, CR, LF, NBSP, U+2028/2029 and U+FEFF; U+200B (zero-width space)
 * is not ECMAScript whitespace, so it is named explicitly.
 */
const LEADING_RUN = /^[\s​]+/;
const TRAILING_RUN = /[\s​]+$/;

/**
 * Strip leading/trailing whitespace, line breaks and zero-width characters
 * from a pasted credential. Interior characters are left alone.
 *
 * The server rule is `trimCredential` in `src/lib/analytics-client.ts`
 * (`value.trim()`), and D-76 leaves it unchanged. This rule is a superset of
 * it: the only character stripped here that `String.prototype.trim()` keeps is
 * U+200B.
 */
export function normalizeCredentialInput(value: string): string {
  return value.replace(LEADING_RUN, "").replace(TRAILING_RUN, "");
}

/**
 * The `inputType`s that deliver text in bulk: paste, drop, and autofill or a
 * password manager replacing the field (`insertReplacementText`).
 */
const BULK_INPUT_TYPES: ReadonlySet<string> = new Set([
  "insertFromPaste",
  "insertFromPasteAsQuotation",
  "insertFromDrop",
  "insertReplacementText",
]);

function isBulkInputType(inputType: string | undefined): boolean {
  // An absent or empty inputType is autofill or a programmatic change.
  return !inputType || BULK_INPUT_TYPES.has(inputType);
}

/**
 * Read a credential input's value from its change event, normalizing text
 * that arrives in bulk (paste, drop, autofill/replacement, or a change with no
 * `inputType`) and returning every other `inputType` raw: keystrokes,
 * deletions, undo/redo, and any type not listed, including future ones.
 *
 * Why an allow-list of bulk types (D-76, round-3 review WR-01): the strip acts
 * on the whole field, not on the inserted text. An interior space the user
 * types, say into an MT5 investor password in the secret slot, is momentarily
 * trailing, and so is one restored by undo (`pass w` + undo = `pass `).
 * Normalizing such a change would silently delete it. The server still trims
 * the typed leading/trailing case on the routes that trim.
 */
export function readCredentialInput(event: React.ChangeEvent<HTMLInputElement>): string {
  const value = event.target.value;
  const inputType = (event.nativeEvent as InputEvent | undefined)?.inputType;
  return isBulkInputType(inputType) ? normalizeCredentialInput(value) : value;
}

/**
 * Password-manager ignore attributes carried by every credential input (D-76,
 * sources read 2026-09-30):
 * - `data-1p-ignore`: 1Password developer docs
 *   (1password.dev/web/compatible-website-design).
 * - `data-bwignore`: Bitwarden `bitwarden/clients`
 *   apps/browser/src/autofill/services/collect-autofill-content.service.ts.
 * - `data-lpignore`: an UNVERIFIED vendor hint. LastPass's support pages could
 *   not be read; it is kept because it is inert everywhere else.
 * - `data-form-type="other"`: Dashlane SAWF (dashlane.github.io/SAWF).
 */
const VENDOR_IGNORE_PROPS = {
  "data-1p-ignore": "true",
  "data-bwignore": "true",
  "data-lpignore": "true",
  "data-form-type": "other",
} as const;

/**
 * Key inputs (type=text). `autocomplete="off"` stays: with no login-form
 * password field beside it, no browser pairs a key field as a username.
 */
export const CREDENTIAL_KEY_INPUT_PROPS = {
  autoComplete: "off",
  ...VENDOR_IGNORE_PROPS,
} as const;

/**
 * Masked credential inputs (API secret, OKX passphrase, MT5 password).
 * `autocomplete="new-password"` because many browsers ignore `off` on password
 * fields (MDN, "Turning off form autocompletion"):
 * - Chromium `form_data_parser.cc` parses a `new-password` field as a sign-up
 *   `new_password`, not the `password` a saved login is filled into (the parse
 *   was read; the fill behaviour is inferred from it).
 * - Firefox `LoginManagerChild.sys.mjs`: "Not filling form, password field has
 *   the autocomplete new-password value".
 * Accepted cost (D-76): a browser may offer a generated password or to save
 * the submitted values.
 */
export const CREDENTIAL_SECRET_INPUT_PROPS = {
  autoComplete: "new-password",
  ...VENDOR_IGNORE_PROPS,
} as const;
