import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The set of Supabase auth error codes that mean "this user already exists".
 * We swallow these specifically — every other auth.admin.createUser error
 * must propagate.
 */
const KNOWN_USER_EXISTS_CODES = /^(email_exists|user_already_exists|phone_exists)$/;

/**
 * Policy for what `ensureAuthUser` should do when the auth.users row
 * already exists for the given email.
 *
 * `create_only` — refuse to bind. Throws if the email already exists.
 *   Use when the caller MUST be creating a fresh user (registration flows,
 *   admin-issued invites with anti-collision intent).
 *
 * `create_or_resolve_pilot` — resolve the existing profile only if its
 *   `partner_tag` matches `partnerTag` AND is non-null. This is the
 *   partner-import semantic: re-running an import against the same CSV
 *   should be idempotent against pilot rows the caller previously
 *   staged, but must NEVER bind to a real Quantalyze user (untagged
 *   profile) or a different partner's pilot (different tag). Both of
 *   those cases throw.
 *
 * C-0181 (audit-2026-05-07): without this gate, the email-conflict
 * fallback was a profile-clobber primitive. An attacker who could
 * influence a partner-import CSV (`manager_email: victim@example.com`)
 * could rebind the victim's user_id under the attacker's partner_tag,
 * because the upsert at the call site does `onConflict: 'id'` and
 * overwrites partner_tag/role/display_name from the import row. The
 * library-level gate refuses to return the existing user_id unless the
 * caller has proven the same-pilot binding via matching partner_tag.
 */
export type EnsureAuthUserPolicy =
  | { mode: "create_only" }
  | { mode: "create_or_resolve_pilot"; partnerTag: string };

/**
 * Create a Supabase auth user, or resolve the existing profile id if one
 * already exists for the given email AND the policy allows it. Returns
 * the user id in both cases (or throws).
 *
 * Why this helper exists
 *   The partner-import route stages a pilot from CSVs; re-runs against
 *   the same rows must be idempotent without silently dropping any rows
 *   AND without binding across partners. The library-level policy gate
 *   makes the cross-partner / real-user defense reusable.
 *
 *   The optional `id` parameter lets a caller pin deterministic UUIDs
 *   when creating fresh users (used by tests that want stable ids);
 *   production use sites pass just `email` and let Supabase generate
 *   the id.
 *
 *   Callers MUST specify `policy`. There is no default — leaving the
 *   policy implicit was the C-0181 root cause.
 */
export async function ensureAuthUser(
  admin: SupabaseClient,
  params: { email: string; id?: string; policy: EnsureAuthUserPolicy },
): Promise<string> {
  const { email, id, policy } = params;
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

  // ============================================================
  // Email-conflict path. The policy decides what happens next.
  // ============================================================

  if (policy.mode === "create_only") {
    // C-0181: caller required a fresh user. The auth.users row already
    // exists — refuse and surface the collision explicitly so the
    // caller can decide (notify operator, suggest password reset, etc.).
    throw new Error(
      `ensureAuthUser: policy=create_only but ${email} already has an auth user — refusing to bind`,
    );
  }

  // policy.mode === "create_or_resolve_pilot"
  //
  // Look up by email AND select partner_tag so we can verify the
  // existing profile is in fact the SAME pilot we are re-staging. Do
  // NOT silently skip — every caller needs the id, and a NULL
  // partner_tag (real user) or different partner_tag (cross-partner
  // collision) must throw.
  const { data: existing, error: lookupErr } = await admin
    .from("profiles")
    .select("id, partner_tag")
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

  const existingTag = (existing as { partner_tag?: string | null })
    .partner_tag;

  // C-0181 (audit-2026-05-07): refuse to claim a real (untagged) user.
  // If partner_tag is null/empty, the existing profile is a real
  // Quantalyze user — NOT a pilot row the caller previously staged.
  // Returning the id here would let the call site's upsert overwrite
  // role / partner_tag / display_name on the victim's profile.
  if (typeof existingTag !== "string" || existingTag.length === 0) {
    throw new Error(
      `ensureAuthUser: refusing to bind ${email} — existing profile has no partner_tag (would claim a real user under partner_tag=${policy.partnerTag})`,
    );
  }

  // C-0181: refuse to bind across partners. If the existing profile is
  // already tagged for a DIFFERENT partner, this is either a CSV
  // typo or a takeover attempt. Either way, refuse and surface.
  if (existingTag !== policy.partnerTag) {
    throw new Error(
      `ensureAuthUser: refusing to bind ${email} — existing partner_tag=${existingTag} differs from caller's partner_tag=${policy.partnerTag}`,
    );
  }

  return existing.id as string;
}
