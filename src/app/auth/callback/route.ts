import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Email-confirmation / OAuth callback landing route.
 *
 * Supabase emails (signup confirm, password recovery, email change, invite)
 * direct the user back to `${SITE_URL}/auth/callback?...`. Without this
 * route handler the link 404s and the user can never finish signup.
 *
 * Two flows are supported:
 *   - PKCE / OAuth:  /auth/callback?code=<auth_code>
 *     → exchangeCodeForSession exchanges the code for a session cookie.
 *   - OTP (email link, magic link, recovery):
 *     /auth/callback?token_hash=<hash>&type=<signup|email_change|recovery|invite>
 *     → verifyOtp validates the hash and issues a session.
 *
 * PRODUCTION CONFIGURATION (Supabase dashboard, NOT in repo):
 *   1. Authentication → Email → ensure "Confirm email" is ON.
 *   2. Authentication → URL Configuration → "Site URL" must match
 *      NEXT_PUBLIC_SITE_URL (e.g. https://quantalyze-rho.vercel.app).
 *      Add the same URL plus any preview deployment patterns to
 *      "Redirect URLs" so emailRedirectTo passes the allowlist.
 *   3. If using Resend SMTP, configure under Authentication → Emails →
 *      SMTP Settings (provider, host, port, user, password, sender).
 *      Otherwise Supabase falls back to its rate-limited shared SMTP
 *      which silently drops above a few sends/hour.
 *
 * Local dev: `supabase/config.toml` keeps `enable_confirmations = false`
 * so the seed flow doesn't require a mailbox; production toggles it on
 * via the dashboard.
 */

type OtpType = "signup" | "email_change" | "recovery" | "invite";

const VALID_OTP_TYPES: ReadonlySet<OtpType> = new Set([
  "signup",
  "email_change",
  "recovery",
  "invite",
]);

function loginRedirect(req: NextRequest, message: string): NextResponse {
  const url = new URL("/login", req.url);
  url.searchParams.set("error", message);
  return NextResponse.redirect(url);
}

/**
 * Same-origin / relative-path guard for the `next` query parameter.
 *
 * Without this an attacker could craft an email-confirm link like
 *   /auth/callback?code=...&next=https://evil.example/phish
 * and the post-confirm redirect would happily send the freshly-signed-in
 * user to attacker-controlled territory. Restrict to paths that start
 * with a single "/" (so `//evil.example/...` — protocol-relative — is
 * also rejected).
 */
function safeNextPath(raw: string | null): string {
  const fallback = "/onboarding";
  if (!raw) return fallback;
  if (!raw.startsWith("/")) return fallback;
  if (raw.startsWith("//")) return fallback;
  // Defensive: backslash tricks (some browsers normalize `\` to `/`).
  if (raw.startsWith("/\\") || raw.startsWith("\\")) return fallback;
  return raw;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const safeNext = safeNextPath(url.searchParams.get("next"));

  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return loginRedirect(req, error.message);
    }
    return NextResponse.redirect(new URL(safeNext, req.url));
  }

  if (tokenHash && type) {
    if (!VALID_OTP_TYPES.has(type as OtpType)) {
      return loginRedirect(req, "Invalid verification type");
    }
    const { error } = await supabase.auth.verifyOtp({
      type: type as OtpType,
      token_hash: tokenHash,
    });
    if (error) {
      return loginRedirect(req, error.message);
    }
    return NextResponse.redirect(new URL(safeNext, req.url));
  }

  return loginRedirect(req, "Missing verification parameters");
}
