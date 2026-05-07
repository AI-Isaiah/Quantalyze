/**
 * Platform branding defaults — one place to change "Quantalyze" /
 * "notifications@quantalyze.com" if branding ever shifts. Defensively
 * mirrored from `.env.example`. Server-side only.
 *
 * Function-form (vs module-load consts) so test setup that mutates
 * `process.env.PLATFORM_NAME` / `PLATFORM_EMAIL` lands AFTER the import
 * is honored. Consts captured at module-load would freeze the default and
 * silently mask a regression that hard-coded the brand. (Claude
 * adversarial 2026-05-07.)
 *
 * `getPlatformName()` / `getPlatformEmail()` are pure reads of
 * `process.env`; they cost nothing and are not on a hot path.
 */

export function getPlatformName(): string {
  return process.env.PLATFORM_NAME ?? "Quantalyze";
}

export function getPlatformEmail(): string {
  return process.env.PLATFORM_EMAIL ?? "notifications@quantalyze.com";
}
