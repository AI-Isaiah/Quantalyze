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
 * Email change (Phase 219): the change request's `next` carries the marker
 * `email_change=confirmed`; a failed PKCE exchange honours it (GD-03), and the
 * first link of the two-link flow replaces it with `email_change=partial`.
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
  // audit-2026-05-07 specialist red-team HIGH: WHATWG URL parser strips
  // leading tab/LF/CR from path segments, so `/	//evil.com` (URL-
  // encoded `%09//evil.com`) defeats the startsWith("//") guard because
  // the literal string starts with "/\t//" but `new URL(...)` resolves
  // it to `//evil.com`. Reject any path whose char[1+] is whitespace,
  // slash, or backslash — those compositions are never legitimate next-
  // targets on this app and are the canonical open-redirect vectors.
  if (/^\/[\s\\/]/.test(raw)) return fallback;
  return raw;
}

/**
 * Phase 219 GD-03: does the ALREADY safeNextPath-filtered `next` carry the
 * email-change marker `email_change=confirmed`?
 *
 * Root cause (PROD auth logs 2026-11-20): GoTrue's PKCE flow state, created by
 * the change request, lives only minutes. A link clicked later fails the code
 * exchange (422 flow_state_expired) AFTER Auth already completed the change,
 * and the `/login?error` landing made the proxy bounce the signed-in user to
 * the role home page. The code branch uses this to land that click on the
 * Account tab instead.
 *
 * Why it is safe: the failed exchange minted no session and this only chooses
 * the redirect target; the target is a same-origin path safeNextPath already
 * accepted (the argument is its return value, never the raw parameter); the
 * proxy still sends a signed-out user to /login; and the Account tab reads the
 * truth from auth.getUser(), never the marker alone. Used by the code branch
 * only. The value must be exactly `confirmed`, the one the app itself sends.
 */
function carriesEmailChangeConfirmed(
  safeNext: string,
  req: NextRequest,
): boolean {
  return (
    new URL(safeNext, req.url).searchParams.get("email_change") === "confirmed"
  );
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
      // GD-03: an expired PKCE flow state on the final email-change link still
      // lands on the Account tab; any other failed exchange goes to /login.
      if (carriesEmailChangeConfirmed(safeNext, req)) {
        // Code and status only: never the code, verifier or tokens.
        console.error(
          "[auth/callback] email-change exchange failed:",
          error.code ?? "unknown",
          error.status ?? "no-status",
        );
        return NextResponse.redirect(new URL(safeNext, req.url));
      }
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

  // "Secure email change": the FIRST of the two confirmation links is a partial
  // confirmation. GoTrue's /verify answers it with a `message` and neither a
  // `code` nor a `token_hash` (Phase 219 MD-01). Nothing was verified here, so
  // nobody is signed in; send the user back to `next` with a marker the Account
  // tab turns into a note, instead of an error page for a click that worked.
  if (url.searchParams.get("message")) {
    const dest = new URL(safeNext, req.url);
    dest.searchParams.set("email_change", "partial");
    return NextResponse.redirect(dest);
  }

  // GR1-MD-01: when GoTrue's /verify itself fails (expired, already used or
  // scanner-consumed token) it redirects here with `error` / `error_code` and no
  // code, token_hash or message. With the email-change marker in the accepted
  // `next`, land on the Account tab WITHOUT the marker, so the tab shows Auth's
  // real state instead of a success claim; /login would bounce a signed-in user
  // to the role home.
  if (
    (url.searchParams.get("error") || url.searchParams.get("error_code")) &&
    carriesEmailChangeConfirmed(safeNext, req)
  ) {
    const dest = new URL(safeNext, req.url);
    dest.searchParams.delete("email_change");
    return NextResponse.redirect(dest);
  }

  return loginRedirect(req, "Missing verification parameters");
}
