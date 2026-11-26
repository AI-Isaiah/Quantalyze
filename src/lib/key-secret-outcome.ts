/**
 * THE PASSWORD OUTCOME OF A SAME-ACCOUNT RECONNECT, as one wire field and one set
 * of sentences (Phase 228 KEYANSWERS, CONN-02).
 *
 * WIRE CONTRACT. The create-with-key 409 refusals carry, beside the existing
 * refusal code, one nested field:
 *
 *     key_secret: { outcome: "updated" | "unchanged"; name?: string }
 *
 * `updated`: the seam accepted the typed password and the stored key was
 * rewritten. `unchanged`: the seam accepted it and it equals the stored one, so
 * nothing was written. `name` is the nickname of the caller's own key, trimmed,
 * and OMITTED when blank (like `strategy_name`), never null and never "".
 * Plan 03's route is the producer (`keySecretField`); the browser is the
 * consumer (`parseKeySecretOutcome`, `keySecretNoticeText`).
 *
 * ⛔ NO login, broker server, key id or venue account id ever rides this field
 * (T-154-06-C). It carries an outcome and the caller's own nickname, nothing a
 * second person could use to identify the account.
 *
 * ⭐ CLIENT-SAFE ON PURPOSE. This module imports nothing at runtime.
 * `own-account-holder.ts` pulls Sentry and Supabase types, which is why this is
 * its own file rather than a sibling export there.
 *
 * ⭐ THE FOUR SENTENCES ARE BUILT HERE AND ONLY HERE (TWIN-8). The visible notice
 * and its screen-reader `LiveRegion` both read `keySecretNoticeText`, so the two
 * channels cannot drift. The `unchanged` sentence says "and it signs in"
 * because the seam compares AFTER the broker probe accepted the password (Plan
 * 01); if that order ever flips, the clause stops being true and must go.
 */

export type KeySecretOutcomeKind = "updated" | "unchanged";

export interface KeySecretOutcome {
  outcome: KeySecretOutcomeKind;
  name?: string;
}

function cleanName(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Server side: the response-body fragment. `{}` when there is no outcome, so a
 * body without one is byte-identical to today's. A blank name is omitted.
 */
export function keySecretField(
  outcome: KeySecretOutcome | null | undefined,
): { key_secret?: KeySecretOutcome } {
  if (!outcome) return {};
  const name = cleanName(outcome.name);
  return {
    key_secret: name
      ? { outcome: outcome.outcome, name }
      : { outcome: outcome.outcome },
  };
}

/**
 * Browser side: read `key_secret` off a response body. Shape-checked, never
 * trusted as typed. An unknown or missing outcome, or a non-object, is `null`
 * ("we were not told", so no notice). A non-string or blank name is dropped and
 * the outcome kept; a string name is trimmed.
 */
export function parseKeySecretOutcome(raw: unknown): KeySecretOutcome | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.outcome !== "updated" && r.outcome !== "unchanged") return null;
  const name = cleanName(r.name);
  return name ? { outcome: r.outcome, name } : { outcome: r.outcome };
}

/** The ONLY builder of the four notice sentences (straight double quotes). */
export function keySecretNoticeText(o: KeySecretOutcome): string {
  const name = cleanName(o.name);
  if (o.outcome === "updated") {
    return name
      ? `We updated the password on your key "${name}". No new key or strategy was created.`
      : "We updated the password on your stored key for this account. No new key or strategy was created.";
  }
  return name
    ? `Your key "${name}" already uses this password and it signs in, so we changed nothing.`
    : "Your stored key for this account already uses this password and it signs in, so we changed nothing.";
}
