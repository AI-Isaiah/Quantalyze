/**
 * Partner pilot tag regex — lowercase letters, digits, hyphens only.
 * Matches the validation in migration 016 and the /admin/partner-import
 * server-side validator. Used in every code path that reads/writes a
 * partner_tag value from user input or a URL segment.
 */
export const PARTNER_TAG_RE = /^[a-z0-9-]+$/;

/**
 * Type-guard predicate that enforces both "is a non-empty string" AND
 * "matches PARTNER_TAG_RE". Using this helper instead of inline regex
 * checks means a future tweak to the allowed character set only has
 * to touch this file.
 */
export function isValidPartnerTag(tag: unknown): tag is string {
  return typeof tag === "string" && tag.length > 0 && PARTNER_TAG_RE.test(tag);
}
