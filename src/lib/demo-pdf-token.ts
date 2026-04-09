import { createHmac, timingSafeEqual } from "crypto";

/**
 * Sign and verify short-lived tokens for the public demo PDF endpoint.
 *
 * The /demo page renders a `Download IC Report` button. The button URL must
 * be public (the friend forwards the link), but we can't expose
 * `/api/portfolio-pdf/[id]` directly because that route is auth-gated and
 * the friend's colleague has no account. Instead, the server component
 * generates a signed `?token=` per request that the new
 * `/api/demo/portfolio-pdf/[id]` route verifies. The token covers
 * (portfolio_id + an expiry timestamp) and is hashed with HMAC-SHA256 using
 * a server-side secret.
 *
 * Token format: `${expSeconds}.${hex_signature}`. The expiry is part of
 * the signed payload, so a stolen token still expires.
 */

const TOKEN_TTL_SECONDS = 60 * 30; // 30 minutes
const SECRET_ENV = "DEMO_PDF_SECRET";

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
 * Generate a token for `portfolioId` valid for ~30 minutes from now.
 * Throws if `DEMO_PDF_SECRET` is not configured.
 */
export function signDemoPdfToken(portfolioId: string): string {
  const secret = getSecret();
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const payload = `${portfolioId}.${exp}`;
  const sig = sign(payload, secret);
  return `${exp}.${sig}`;
}

/**
 * Verify a token against `portfolioId`. Returns true on success, false on
 * any failure (missing secret, malformed token, expired, signature mismatch).
 *
 * Uses constant-time comparison to avoid timing attacks. NEVER returns the
 * specific failure reason — callers should respond with a single 401.
 */
export function verifyDemoPdfToken(
  portfolioId: string,
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

  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp <= 0) return false;
  if (Math.floor(Date.now() / 1000) > exp) return false;

  const payload = `${portfolioId}.${exp}`;
  const expected = sign(payload, secret);
  if (sig.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}
