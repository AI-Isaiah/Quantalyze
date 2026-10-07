/**
 * Thrown by `email.ts` `send()` when a send is SKIPPED for want of
 * configuration (no Resend client, or no PLATFORM_EMAIL sender), as opposed to
 * attempted and rejected by Resend.
 *
 * Lives in its own module so a caller can `instanceof`-check it without
 * importing `email.ts` (which pulls in `server-only` and the Resend client),
 * and so tests that mock `@/lib/email` wholesale still see the real class.
 *
 * Extends Error with the same message `send()` threw before this class
 * existed, so callers that already pass `throwOnFailure` see no difference.
 */
export class EmailSkippedError extends Error {
  readonly reason: "resend_not_configured" | "platform_email_not_configured";

  constructor(
    reason: "resend_not_configured" | "platform_email_not_configured",
    message: string,
  ) {
    super(message);
    this.name = "EmailSkippedError";
    this.reason = reason;
  }
}
