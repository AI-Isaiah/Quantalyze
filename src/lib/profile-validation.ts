/**
 * Audit-2026-05-07 P325: insert-time validator for `profiles.display_name`.
 *
 * Why this exists
 * ---------------
 * Several call sites write `display_name` into `profiles` (partner-import,
 * test seed helpers, future admin tools). Pre-fix, none of them validated
 * the input — a CSV with an embedded CR/LF or a 4 KB blob would land in
 * the table verbatim. That's a header-injection / log-injection / UI-clip
 * footgun waiting for the wrong upstream caller.
 *
 * Rules (enforced here, NOT just at the form layer):
 *  - Must be non-empty after trim. Empty / whitespace-only is rejected.
 *  - Must NOT contain CR (\r), LF (\n), or NUL (\0) — these are the
 *    log-injection / header-injection / C-string-truncation characters.
 *    Other whitespace (tabs, spaces) is allowed because display names
 *    legitimately have spaces.
 *  - Must be ≤ 200 characters after the strip. Cap is enforced as a
 *    HARD reject rather than a silent truncate so callers can't smuggle
 *    a long blob and lose the tail without noticing.
 *
 * Returns the cleaned name on success, or throws `ProfileValidationError`
 * with a structured `field` + `reason` so callers can map to a 400 with
 * a useful message.
 *
 * NOTE: this is NOT a substitute for HTML-escaping at the render site.
 * The render site (DM-Sans email templates, React UI) still needs to
 * `escapeHtml()`. This validator is only about preventing the *write*
 * of a payload that is dangerous to handle anywhere downstream.
 */

export class ProfileValidationError extends Error {
  readonly field: string;
  readonly reason: string;
  constructor(field: string, reason: string) {
    super(`profile validation failed: ${field}: ${reason}`);
    this.name = "ProfileValidationError";
    this.field = field;
    this.reason = reason;
  }
}

/** Max characters allowed for `display_name`. Hard reject, not truncate. */
export const DISPLAY_NAME_MAX_LENGTH = 200;

/**
 * Validate and normalize a `display_name` value at the boundary BEFORE
 * any insert/upsert into `profiles`. See module-level comment for rules.
 *
 * Throws `ProfileValidationError` for any rule violation. On success
 * returns the trimmed string (leading/trailing whitespace stripped).
 */
export function validateDisplayName(input: string | null | undefined): string {
  if (input === null || input === undefined) {
    throw new ProfileValidationError("display_name", "missing");
  }
  if (typeof input !== "string") {
    throw new ProfileValidationError("display_name", "not_a_string");
  }
  // Reject the three injection/truncation characters BEFORE trim so we
  // catch payloads where the dangerous character is sandwiched between
  // legitimate whitespace.
  if (/[\r\n\0]/.test(input)) {
    throw new ProfileValidationError(
      "display_name",
      "control_characters_not_allowed",
    );
  }
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new ProfileValidationError("display_name", "empty_or_whitespace");
  }
  if (trimmed.length > DISPLAY_NAME_MAX_LENGTH) {
    throw new ProfileValidationError(
      "display_name",
      `exceeds_max_length_${DISPLAY_NAME_MAX_LENGTH}`,
    );
  }
  return trimmed;
}
