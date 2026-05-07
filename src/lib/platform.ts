/**
 * Platform branding defaults — one place to change "Quantalyze" /
 * "notifications@quantalyze.com" if branding ever shifts. Defensively
 * mirrored from `.env.example`. Server-side only.
 */

export const PLATFORM_NAME = process.env.PLATFORM_NAME ?? "Quantalyze";
export const PLATFORM_EMAIL =
  process.env.PLATFORM_EMAIL ?? "notifications@quantalyze.com";
