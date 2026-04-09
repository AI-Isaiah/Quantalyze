import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The set of Supabase auth error codes that mean "this user already exists".
 * We swallow these specifically — every other auth.admin.createUser error
 * must propagate.
 */
const KNOWN_USER_EXISTS_CODES = /^(email_exists|user_already_exists|phone_exists)$/;

/**
 * Create a Supabase auth user, or resolve the existing profile id if one
 * already exists for the given email. Returns the user id in both cases.
 *
 * Why this helper exists
 *   Two callers need the exact same "create or resolve" semantics:
 *     1. /api/admin/partner-import — staging a pilot from CSVs; re-runs
 *        against the same rows must be idempotent without silently dropping
 *        any rows.
 *     2. scripts/seed-demo-data.ts — hydrating a staging Supabase instance;
 *        re-runs must be byte-identical without throwing on the second run.
 *
 *   The shared helper guarantees both paths handle the "422 email_exists"
 *   response the same way: fall through to a profiles-by-email lookup and
 *   return the existing id. Never silently skip — either return the id or
 *   throw with a useful message.
 *
 *   The optional `id` parameter lets the seed script pin deterministic
 *   UUIDs for its fixtures; production use sites pass just `email` and
 *   let Supabase generate the id.
 */
export async function ensureAuthUser(
  admin: SupabaseClient,
  params: { email: string; id?: string },
): Promise<string> {
  const { email, id } = params;
  const { data: created, error } = await admin.auth.admin.createUser({
    ...(id ? { id } : {}),
    email,
    email_confirm: true,
  });

  if (!error) {
    const userId = created.user?.id;
    if (!userId) {
      throw new Error(
        `ensureAuthUser: createUser returned no user id for ${email}`,
      );
    }
    return userId;
  }

  const errCode = (error as { code?: string }).code ?? "";
  const errStatus = (error as { status?: number }).status;
  const isKnownConflict =
    (errStatus === 422 && KNOWN_USER_EXISTS_CODES.test(errCode)) ||
    // Defensive: some older Supabase releases return 422 with a human-readable
    // message but an empty `code`. Fall back to the message check so we don't
    // mis-classify a real "user exists" as a fatal error.
    (errStatus === 422 && /exist/i.test(error.message ?? ""));

  if (!isKnownConflict) {
    throw error;
  }

  // User already exists — look up by email so the caller can continue with
  // its upserts / inserts. Do NOT silently skip: every caller needs the id.
  const { data: existing, error: lookupErr } = await admin
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  if (lookupErr) {
    throw new Error(
      `ensureAuthUser: failed to resolve existing user for ${email}: ${lookupErr.message}`,
    );
  }
  if (!existing?.id) {
    throw new Error(
      `ensureAuthUser: user with email ${email} exists in auth but has no profile row.`,
    );
  }
  return existing.id as string;
}
