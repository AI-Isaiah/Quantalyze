import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/withAuth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  userActionLimiter,
  checkLimit,
  rateLimitDenyJson,
  isRateLimitMisconfigured,
} from "@/lib/ratelimit";
import { NO_STORE_HEADERS } from "@/lib/api/headers";
import { captureToSentry } from "@/lib/sentry-capture";
import { isUuid } from "@/lib/utils";
import type { User } from "@supabase/supabase-js";

/**
 * GET /api/keys/[id]/memberships — which composite strategies is this key a
 * member of? Read by the key card's Delete confirm (`ApiKeyManager`'s
 * `readKeyCompositeMemberships`) so the confirm can name every composite the
 * Delete would shrink.
 *
 * Phase 167.2.1 D-01 (ROADMAP criterion 5). The card used to read
 * `strategy_keys` in the browser, through RLS. RLS on SELECT FILTERS rather
 * than errors, so a regressed `strategy_keys_owner` policy answered an
 * error-free `[]`, the confirm showed no warning, and the Delete cascaded a
 * composite's member away. This route reads on the SERVICE ROLE instead, so
 * the answer no longer depends on a policy; a failure is an error the card
 * turns into its "could not check" warning, never a silent empty list. No
 * migration was needed; the SECURITY DEFINER RPC stays the recorded fallback.
 *
 * TENANT GATE. RLS does not apply to the admin client, so the ONLY tenant
 * gate is the explicit `api_keys.user_id = <session user>` equality, run
 * BEFORE any membership read. A key that is absent and a key that belongs to
 * someone else get the SAME 404, so the route is not an existence oracle.
 *
 * WHY THE SERVICE ROLE IS SAFE HERE. The `enforce_strategy_keys_owner_coherence`
 * trigger refuses any `strategy_keys` row whose strategy owner differs from
 * the key owner, and it fires for service-role writers too. Every membership
 * of the caller's own key therefore points at the caller's own strategy. As
 * defence in depth the embed also carries the strategy's `user_id`, and a row
 * whose strategy is not the caller's is still LISTED (never dropped, so the
 * warning still fires) but with a null name and status. Only `name` and
 * `status` ever leave this route. Such a row, or one whose strategy embed is
 * missing, is a data-integrity event: it is logged and captured (stage
 * `coherence`, counts only), so the tripwire is heard.
 *
 * ⚠️ Residual, accepted (D-10): a membership added between this read and the
 * Delete is not named. The founder decision is "warn, never block", and the
 * database guard still refuses the Delete of a PUBLISHED composite's member.
 * Closing the window needs a migration.
 *
 * Read-only: no mutation, so no audit event. Every response is no-store.
 */

const ROUTE_TAG = "api/keys/[id]/memberships";

type Membership = { name: string | null; status: string | null };

/** PostgREST can answer a to-one embed as an object or a one-element array. */
function unwrapEmbed(embed: unknown): Record<string, unknown> | null {
  const one = Array.isArray(embed) ? embed[0] : embed;
  return one !== null && typeof one === "object" ? (one as Record<string, unknown>) : null;
}

/**
 * The Sentry `code` tag for a failed read: the PostgREST/SQLSTATE code when the
 * error carries one, "none" when it does not, and "no_error" when there was no
 * error object at all (a read that answered no rows array and no error).
 */
function errorCodeTag(err: { code?: unknown } | null | undefined): string {
  if (!err) return "no_error";
  return typeof err.code === "string" && err.code.length > 0 ? err.code : "none";
}

export const GET = withAuth(
  async (req: NextRequest, user: User): Promise<NextResponse> => {
    // The id comes from the path segment after `keys`, as the sibling
    // `keys/[id]/permissions` route reads it.
    const segments = new URL(req.url).pathname.split("/");
    const keyId = segments[segments.indexOf("keys") + 1];
    if (!isUuid(keyId)) {
      return NextResponse.json(
        { error: "Invalid key id" },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    const rl = await checkLimit(userActionLimiter, `key-memberships:${user.id}`);
    if (!rl.success) {
      // 167.2.1-REVIEW-SFH M-6: the card turns this deny into its "could not
      // check" warning, and the card runs in the browser, where there is no
      // Sentry. This line is the one server-side trace that a Delete confirm
      // warned for this reason. No user id and no key id.
      console.warn(
        "[keys/memberships] membership read denied by the limiter; the Delete confirm warns it could not check",
        { status: isRateLimitMisconfigured(rl) ? 503 : 429 },
      );
      return rateLimitDenyJson(rl, { headers: NO_STORE_HEADERS });
    }

    const admin = createAdminClient();

    // Ownership: an explicit equality on the service role, NOT RLS (D-01).
    const { data: keyRow, error: keyErr } = await admin
      .from("api_keys")
      .select("id")
      .eq("id", keyId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (keyErr) {
      console.error("[keys/memberships] ownership read failed:", keyErr.code, keyErr.message);
      // Tags only: no key id, no user id. The PostgREST/SQLSTATE code is not
      // identifying, and it is what separates a timeout from a permission
      // regression (167.2.1-REVIEW-SFH L-3).
      captureToSentry(new Error("key memberships ownership read failed"), {
        tags: { route: ROUTE_TAG, stage: "ownership", code: errorCodeTag(keyErr) },
      });
      return NextResponse.json(
        { error: "Lookup failed" },
        { status: 500, headers: NO_STORE_HEADERS },
      );
    }
    if (!keyRow) {
      return NextResponse.json(
        { error: "Key not found" },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }

    const { data: rows, error: membersErr } = await admin
      .from("strategy_keys")
      .select("strategy_id, strategies ( name, status, user_id )")
      .eq("api_key_id", keyId);
    if (membersErr || !Array.isArray(rows)) {
      console.error(
        "[keys/memberships] membership read failed:",
        membersErr?.code,
        membersErr?.message ?? "no rows array and no error",
      );
      captureToSentry(new Error("key memberships read failed"), {
        tags: { route: ROUTE_TAG, stage: "memberships", code: errorCodeTag(membersErr) },
      });
      return NextResponse.json(
        { error: "Lookup failed" },
        { status: 500, headers: NO_STORE_HEADERS },
      );
    }

    // The defence-in-depth tripwire (167.2.1-REVIEW-SFH M-4). A row whose
    // strategy is not the caller's means `enforce_strategy_keys_owner_coherence`
    // regressed; a row with no strategy embed means the embed is dangling. Both
    // are data-integrity events, so they are COUNTED and made loud, not just
    // redacted. The row is still listed either way, so the warning still fires.
    let ownerMismatches = 0;
    let danglingEmbeds = 0;
    const memberships: Membership[] = rows.map((row: unknown) => {
      const strategy = unwrapEmbed(
        row !== null && typeof row === "object"
          ? (row as { strategies?: unknown }).strategies
          : null,
      );
      if (!strategy) {
        danglingEmbeds += 1;
        return { name: null, status: null };
      }
      if (strategy.user_id !== user.id) {
        ownerMismatches += 1;
        return { name: null, status: null };
      }
      return {
        name: typeof strategy.name === "string" ? strategy.name : null,
        status: typeof strategy.status === "string" ? strategy.status : null,
      };
    });
    if (ownerMismatches > 0 || danglingEmbeds > 0) {
      // Counts only: no key id, no user id, no strategy id or name.
      console.error(
        "[keys/memberships] owner-coherence tripwire fired: a membership's strategy is not the key owner's, or its embed is dangling",
        { ownerMismatches, danglingEmbeds },
      );
      captureToSentry(
        new Error("key memberships: strategy owner mismatch or dangling embed"),
        {
          tags: { route: ROUTE_TAG, stage: "coherence" },
          extra: { ownerMismatches, danglingEmbeds },
        },
      );
    }

    return NextResponse.json({ memberships }, { status: 200, headers: NO_STORE_HEADERS });
  },
);
