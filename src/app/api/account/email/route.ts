import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { User } from "@supabase/supabase-js";
import { createClient as createVerifierClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withAuthLimited } from "@/lib/api/withAuthLimited";
import { userActionLimiter } from "@/lib/ratelimit";
import { NO_STORE_HEADERS } from "@/lib/api/headers";

/**
 * POST /api/account/email
 *
 * Phase 219 gap closure (GD-01, GD-02, GD-03, GD-05a). Changes the signed-in
 * account's sign-in email, but only after the CURRENT password is proven.
 *
 * Why a server route and not a client `updateUser`:
 *  - GD-01: a stolen browser session must not be able to re-point the sign-in
 *    email through the app's form, so the current password is verified by
 *    Supabase Auth itself (`signInWithPassword`) BEFORE `updateUser` runs.
 *  - GD-02: `withAuthLimited` consumes `userActionLimiter` (5 per 60 s, keyed
 *    by user id) after body validation and BEFORE the password check, so the
 *    route cannot be used as a password-guessing oracle (B15 canonical order).
 *  - GD-05a: GoTrue answers `invalid_credentials` for a wrong password AND for
 *    an account that has no password at all (magic-link / admin-created). To
 *    tell them apart without lying "wrong password" to a password-less user,
 *    an `invalid_credentials` answer triggers one service-role read,
 *    `public.auth_user_has_password`, about the caller's OWN id (from
 *    `getUser()`, never the request body).
 *  - GD-03: `emailRedirectTo` carries `email_change=confirmed` through
 *    `/auth/callback?next=`. The email-change link is a PKCE link whose flow
 *    state expires; the callback (plan 219-05) reads the marker so a failed
 *    exchange lands the user on the Account tab instead of a dead end.
 *
 * The password check runs on a SEPARATE supabase-js client built inside the
 * handler with no persistence, no refresh timer and no URL detection, and no
 * cookie adapter, so the user's own session cookies are never read, swapped,
 * refreshed or cleared. The throwaway session it opens is closed with
 * `signOut({ scope: "local" })` only: the default scope is global and would
 * sign the user out of the browser as well.
 *
 * GD-06a (accepted risk, founder 2026-11-20): this gate guards the app's form.
 * Supabase Auth's own `PUT /user` still accepts an email change from any valid
 * session token; nothing in this route changes that.
 *
 * The password is never logged, returned, or placed in an error: no `console`
 * call here receives the body, and no thrown message is built from it.
 *
 * D-11: this route never writes `auth.users` or `public.profiles`; the only
 * change path is `supabase.auth.updateUser`.
 */

const BODY_SCHEMA = z.object({
  email: z.string().trim().max(254).pipe(z.email()),
  password: z.string().min(1).max(1024),
});

/** The marker-bearing destination plan 219-05's callback understands (GD-03). */
const EMAIL_CHANGE_NEXT = "/profile?tab=account&email_change=confirmed";

const UPDATE_FAILED_FALLBACK =
  "Could not send the confirmation link. Please try again.";

function jsonNoStore(body: Record<string, unknown>, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}

function verifyUnavailable(): NextResponse {
  return jsonNoStore(
    {
      code: "verify_unavailable",
      error: "Could not check your password. Please try again.",
    },
    502,
  );
}

/**
 * Origin for `emailRedirectTo`. Same trusted pattern as `resolveAppUrl` in
 * src/app/api/strategies/[id]/share/route.ts (D-16): the origin of
 * `Origin ?? Referer`, which the wrapper's `assertSameOrigin` already
 * validated against the allow-list, then `NEXT_PUBLIC_APP_URL`, then
 * localhost. Never `Host`, `x-forwarded-host` or `req.nextUrl`. A local copy,
 * not an extracted helper: that refactor is outside this gap.
 */
function resolveAppUrl(req: NextRequest): string {
  const source = req.headers.get("origin") ?? req.headers.get("referer");
  if (source) {
    try {
      return new URL(source).origin;
    } catch {
      // Unreachable after assertSameOrigin (it 403s an unparseable source).
    }
  }
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured) return configured;
  return "http://localhost:3000";
}

export const POST = withAuthLimited(
  {
    limiter: userActionLimiter,
    key: (user) => `email_change:${user.id}`,
    schema: BODY_SCHEMA,
    maxBytes: 4096,
  },
  async (
    req: NextRequest,
    user: User,
    body: z.infer<typeof BODY_SCHEMA>,
  ): Promise<NextResponse> => {
    // 1. Same address (trim, case-insensitive) is refused before any password
    //    check: nothing to change, and no reason to spend a sign-in.
    if (
      user.email &&
      body.email.trim().toLowerCase() === user.email.trim().toLowerCase()
    ) {
      return jsonNoStore(
        {
          code: "same_address",
          error: "That is already your sign-in email.",
        },
        400,
      );
    }

    // 2. Verify the current password on a throwaway client. A null account
    //    email leaves nothing to sign in with, so go straight to step 3.
    const accountEmail = user.email;
    let invalidCredentials = !accountEmail;
    if (accountEmail) {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!url || !anonKey) {
        console.error("[api/account/email] supabase env is not configured");
        return verifyUnavailable();
      }
      // Per request, inside the handler, with no cookie adapter or storage:
      // the user's own session cookies are never read or written here.
      const verifier = createVerifierClient(url, anonKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      });
      const { error: signInError } = await verifier.auth.signInWithPassword({
        email: accountEmail,
        password: body.password,
      });
      if (!signInError) {
        // Close ONLY the throwaway session. Best effort: its failure does not
        // change the answer, and only its message is logged.
        const { error: signOutError } = await verifier.auth.signOut({
          scope: "local",
        });
        if (signOutError) {
          console.warn(
            "[api/account/email] verifier signOut failed:",
            signOutError.message,
          );
        }
      } else if (signInError.code === "invalid_credentials") {
        invalidCredentials = true;
      } else {
        // Rate limit, unconfirmed email, network failure: never "wrong
        // password". Code and status only; never the message or the body.
        console.error(
          "[api/account/email] sign-in verification failed:",
          signInError.code ?? "unknown",
          signInError.status ?? "no-status",
        );
        return verifyUnavailable();
      }
    }

    // 3. GD-05a: told apart from a wrong password by the caller's OWN id.
    if (invalidCredentials) {
      // SFH-M3: createAdminClient() throws on a missing service-role key, which
      // would otherwise escape as an unstructured 500. Construction and call
      // share one try/catch; only the message is logged.
      let rpcAnswer;
      try {
        rpcAnswer = await createAdminClient().rpc("auth_user_has_password", {
          p_user_id: user.id,
        });
      } catch (err) {
        console.error(
          "[api/account/email] has-password check threw:",
          err instanceof Error ? err.message : "unknown",
        );
        return verifyUnavailable();
      }
      const { data: hasPassword, error: rpcError } = rpcAnswer;
      if (rpcError || typeof hasPassword !== "boolean") {
        console.error(
          "[api/account/email] has-password check failed:",
          rpcError?.message ?? "non-boolean answer",
        );
        return verifyUnavailable();
      }
      if (hasPassword === false) {
        return jsonNoStore(
          {
            code: "password_not_set",
            error:
              "This account has no password yet. Set a password first, then change your email.",
          },
          409,
        );
      }
      return jsonNoStore(
        {
          code: "wrong_password",
          error: "That password is not right. Nothing was sent.",
        },
        400,
      );
    }

    // 4. Password proven: ask Auth to change the email on the user's own
    //    cookie-bound client, so the PKCE verifier cookie is set as before.
    const supabase = await createClient();
    const emailRedirectTo = `${resolveAppUrl(req)}/auth/callback?next=${encodeURIComponent(EMAIL_CHANGE_NEXT)}`;
    const { data, error } = await supabase.auth.updateUser(
      { email: body.email },
      { emailRedirectTo },
    );
    if (error) {
      // SFH-M2: code and status only; never the body or the password.
      console.error(
        "[api/account/email] updateUser failed:",
        error.code ?? "unknown",
        error.status ?? "no-status",
      );
      const message = error.message?.trim();
      // 429 stays 429 and a GoTrue 5xx is an upstream failure (502); the rest
      // are the caller's to fix (400).
      const status =
        error.status === 429
          ? 429
          : error.status !== undefined && error.status >= 500
            ? 502
            : 400;
      return jsonNoStore(
        { code: "update_failed", error: message || UPDATE_FAILED_FALLBACK },
        status,
      );
    }
    return jsonNoStore(
      { ok: true, pending_email: data.user?.new_email ?? null },
      200,
    );
  },
);
