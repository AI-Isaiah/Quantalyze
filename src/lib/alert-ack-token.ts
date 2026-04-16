import { createHmac, timingSafeEqual } from "crypto";

/**
 * Sign and verify one-time-use tokens for the email-digest ack link.
 *
 * Per alert-routing-v1.md (docs/notes/alert-routing-v1.md):
 *   - HMAC-SHA256 over `${alertId}.${expSeconds}`.
 *   - Token format `${expSeconds}.${hex_signature}` — same shape as
 *     `demo-pdf-token.ts` so the verifier reuses the battle-tested hex
 *     regex guard.
 *   - TTL = 48 hours (longer than demo-pdf: the allocator may open the
 *     email a day or two after receipt).
 *   - One-time-use is enforced at the route layer via `used_ack_tokens`
 *     (migration 047b). This module only signs and verifies — replay
 *     protection is not its concern.
 *
 * Token format: `${expSeconds}.${hex_signature}`. The expiry is part of
 * the signed payload, so a stolen token still expires.
 */

const TOKEN_TTL_SECONDS = 60 * 60 * 48; // 48 hours
const SECRET_ENV = "ALERT_ACK_SECRET";

function getSecret(): string {
  const s = process.env[SECRET_ENV];
  if (!s || s.length < 16) {
    throw new Error(
      `${SECRET_ENV} environment variable must be set to a string >= 16 chars`,
    );
  }
  return s;
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * Generate a token for `alertId` valid for 48 hours from now.
 * Throws if `ALERT_ACK_SECRET` is not configured.
 */
export function signAlertAckToken(alertId: string): string {
  const secret = getSecret();
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const payload = `${alertId}.${exp}`;
  const sig = sign(payload, secret);
  return `${exp}.${sig}`;
}

const HEX_64_CHAR = /^[0-9a-f]{64}$/;

/**
 * Verify a token against `alertId`. Returns true on success, false on
 * any failure (missing secret, malformed token, expired, signature mismatch).
 *
 * Uses constant-time comparison to avoid timing attacks. NEVER returns the
 * specific failure reason — callers should collapse all failures into a
 * single redirect to `/allocations?ack=expired`.
 *
 * Hex validation: the signature portion MUST match `/^[0-9a-f]{64}$/` before
 * we try to `Buffer.from(sig, 'hex')` — without this, Node silently skips
 * invalid hex chars and produces a truncated buffer.
 */
export function verifyAlertAckToken(
  alertId: string,
  token: string | null | undefined,
): boolean {
  if (!token) return false;
  let secret: string;
  try {
    secret = getSecret();
  } catch {
    return false;
  }

  const idx = token.indexOf(".");
  if (idx <= 0 || idx === token.length - 1) return false;
  const expStr = token.slice(0, idx);
  const sig = token.slice(idx + 1);

  if (!HEX_64_CHAR.test(sig)) return false;

  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp <= 0) return false;
  if (Math.floor(Date.now() / 1000) > exp) return false;

  const payload = `${alertId}.${exp}`;
  const expected = sign(payload, secret);
  try {
    return timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}
