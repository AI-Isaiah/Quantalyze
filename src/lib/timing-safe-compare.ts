import { timingSafeEqual } from "crypto";

/**
 * Constant-time string comparison. Prevents an attacker from probing
 * secret values one byte at a time via timing differences. JS `!==`
 * short-circuits at the first differing byte, leaking length + prefix.
 *
 * Returns `false` when lengths differ (this leaks length, but not content;
 * acceptable for HMAC tokens where length is already known/public).
 */
export function safeCompare(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
