/**
 * Platform branding — one place to read the display name and the sender
 * address. Mirrored from `.env.example`. Server-side only.
 *
 * Function-form (vs module-load consts) so test setup that mutates
 * `process.env.PLATFORM_NAME` / `PLATFORM_EMAIL` lands AFTER the import
 * is honored. Consts captured at module-load would freeze the value and
 * silently mask a regression that hard-coded the brand. (Claude
 * adversarial 2026-05-07.)
 *
 * `getPlatformName()` / `getPlatformEmail()` are pure reads of
 * `process.env`; they cost nothing and are not on a hot path.
 *
 * SENDER (founder decision D-12, DOMAINONE): there is NO sender fallback.
 * `getPlatformEmail()` returns `null` when `PLATFORM_EMAIL` is unset or blank,
 * and every caller must treat `null` as "do not send": skip with a logged
 * warning, exactly as mail without a Resend key is skipped. A default that
 * names a domain we do not own would spoof that domain, and its DMARC policy
 * would reject the mail.
 */

export function getPlatformName(): string {
  return process.env.PLATFORM_NAME ?? "Quantalyze";
}

export function getPlatformEmail(): string | null {
  const value = process.env.PLATFORM_EMAIL?.trim();
  return value ? value : null;
}
