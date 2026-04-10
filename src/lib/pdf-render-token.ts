import { createHmac, timingSafeEqual } from "crypto";

/**
 * Short-lived HMAC token for the Puppeteer PDF render page.
 *
 * The `/portfolio-pdf/[id]` page is a Server Component that reads portfolio
 * data via the admin client (bypassing RLS). It is intentionally in
 * PUBLIC_ROUTES because Puppeteer navigates to it without cookies. Without
 * a token gate, anyone who knows a portfolio UUID can view the full report
 * HTML — an IDOR vulnerability.
 *
 * The API routes (`/api/portfolio-pdf/[id]` and `/api/demo/portfolio-pdf/[id]`)
 * generate a render token and append it to the Puppeteer URL. The page verifies
 * the token before rendering. TTL is 2 minutes (enough for Puppeteer to load).
 */

const RENDER_TTL_SECONDS = 120; // 2 minutes
const SECRET_ENV = "DEMO_PDF_SECRET"; // reuse the existing PDF secret

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

export function signPdfRenderToken(portfolioId: string): string {
  const secret = getSecret();
  const exp = Math.floor(Date.now() / 1000) + RENDER_TTL_SECONDS;
  const payload = `render:${portfolioId}.${exp}`;
  const sig = sign(payload, secret);
  return `${exp}.${sig}`;
}

const HEX_64_CHAR = /^[0-9a-f]{64}$/;

export function verifyPdfRenderToken(
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

  if (!HEX_64_CHAR.test(sig)) return false;

  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp <= 0) return false;
  if (Math.floor(Date.now() / 1000) > exp) return false;

  const payload = `render:${portfolioId}.${exp}`;
  const expected = sign(payload, secret);
  try {
    return timingSafeEqual(
      Buffer.from(sig, "hex"),
      Buffer.from(expected, "hex"),
    );
  } catch {
    return false;
  }
}
