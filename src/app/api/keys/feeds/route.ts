import { NextResponse } from "next/server";
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
import {
  compositeFeedFromRow,
  errorCodeTag,
  sortFeeds,
  type KeyFeed,
} from "@/lib/key-feeds";

/**
 * GET /api/keys/feeds — which strategies does each of my keys feed?
 *
 * Phase 200 D-01 (ROUTE-09). Every key card, wherever a key is listed, shows
 * the strategies it feeds. A per-key read cannot back a list: `userActionLimiter`
 * allows 5 calls per 60 s per user, so key 6 onward would read "could not
 * check". This route answers EVERY key the caller owns in one call.
 *
 * Both link kinds: single-key links (`strategies.api_key_id`) and composite
 * memberships (`strategy_keys`), each as a `KeyFeed`. Every owned key id is in
 * the response, `[]` when it feeds nothing. A read that fails is a 500, never an
 * empty map, because the card turns a 500 into "could not check" and an empty
 * list into "Feeds no strategy.": a manager must never be told a key is unused
 * when the app simply could not look.
 *
 * TENANT GATE. All three reads run on the SERVICE ROLE, so RLS does not apply.
 * The key read and the single-link read carry an explicit
 * `user_id = <session user>` equality; the route takes NO id from the caller,
 * so it cannot be used as an existence oracle. The composite read is scoped by
 * the owned key ids, and `enforce_strategy_keys_owner_coherence` keeps every
 * membership of an owned key pointing at an owned strategy. As defence in depth
 * the embed carries the strategy's `user_id`; a row whose strategy is not the
 * caller's (or whose embed is missing) is still LISTED, with a null id, name
 * and status, and counted to Sentry (stage `coherence`, counts only), the same
 * tripwire `[id]/memberships` runs. Only id, name and status ever leave.
 *
 * Read-only: no mutation, so no audit event. Every response is no-store.
 */

const ROUTE_TAG = "api/keys/feeds";

function lookupFailed(): NextResponse {
  return NextResponse.json(
    { error: "Lookup failed" },
    { status: 500, headers: NO_STORE_HEADERS },
  );
}

export const GET = withAuth(async (_req, user): Promise<NextResponse> => {
  const rl = await checkLimit(userActionLimiter, `key-feeds:${user.id}`);
  if (!rl.success) {
    // The card turns this deny into its "could not check" line, and the card
    // runs in the browser, where there is no Sentry. This line is the one
    // server-side trace of that cause. No user id.
    console.warn(
      "[keys/feeds] feeds read denied by the limiter; the key cards say they could not check",
      { status: isRateLimitMisconfigured(rl) ? 503 : 429 },
    );
    return rateLimitDenyJson(rl, { headers: NO_STORE_HEADERS });
  }

  const admin = createAdminClient();

  // Ownership: an explicit equality on the service role, NOT RLS.
  const { data: keyRows, error: keyErr } = await admin
    .from("api_keys")
    .select("id")
    .eq("user_id", user.id);
  if (keyErr || !Array.isArray(keyRows)) {
    console.error(
      "[keys/feeds] ownership read failed:",
      keyErr?.code,
      keyErr?.message ?? "no rows array and no error",
    );
    captureToSentry(new Error("key feeds ownership read failed"), {
      tags: { route: ROUTE_TAG, stage: "ownership", code: errorCodeTag(keyErr) },
    });
    return lookupFailed();
  }

  const ids = keyRows
    .map((row: { id?: unknown }) => row.id)
    .filter((id): id is string => typeof id === "string");
  const feeds: Record<string, KeyFeed[]> = Object.fromEntries(ids.map((id) => [id, []]));
  if (ids.length === 0) {
    return NextResponse.json({ feeds }, { status: 200, headers: NO_STORE_HEADERS });
  }

  const { data: memberRows, error: membersErr } = await admin
    .from("strategy_keys")
    .select("api_key_id, strategy_id, strategies ( name, status, user_id )")
    .in("api_key_id", ids);
  if (membersErr || !Array.isArray(memberRows)) {
    console.error(
      "[keys/feeds] membership read failed:",
      membersErr?.code,
      membersErr?.message ?? "no rows array and no error",
    );
    captureToSentry(new Error("key feeds membership read failed"), {
      tags: { route: ROUTE_TAG, stage: "memberships", code: errorCodeTag(membersErr) },
    });
    return lookupFailed();
  }

  const { data: singleRows, error: singleErr } = await admin
    .from("strategies")
    .select("id, name, status, api_key_id")
    .eq("user_id", user.id)
    .in("api_key_id", ids);
  if (singleErr || !Array.isArray(singleRows)) {
    console.error(
      "[keys/feeds] single-link read failed:",
      singleErr?.code,
      singleErr?.message ?? "no rows array and no error",
    );
    captureToSentry(new Error("key feeds single-link read failed"), {
      tags: { route: ROUTE_TAG, stage: "single-links", code: errorCodeTag(singleErr) },
    });
    return lookupFailed();
  }

  let ownerMismatches = 0;
  let danglingEmbeds = 0;
  for (const row of memberRows as Array<{ api_key_id?: unknown }>) {
    const list = typeof row.api_key_id === "string" ? feeds[row.api_key_id] : undefined;
    if (!list) continue;
    const { feed, problem } = compositeFeedFromRow(row, user.id);
    if (problem === "ownerMismatch") ownerMismatches += 1;
    if (problem === "dangling") danglingEmbeds += 1;
    list.push(feed);
  }
  if (ownerMismatches > 0 || danglingEmbeds > 0) {
    // Counts only: no key id, no user id, no strategy id or name.
    console.error(
      "[keys/feeds] owner-coherence tripwire fired: a membership's strategy is not the key owner's, or its embed is dangling",
      { ownerMismatches, danglingEmbeds },
    );
    captureToSentry(new Error("key feeds: strategy owner mismatch or dangling embed"), {
      tags: { route: ROUTE_TAG, stage: "coherence" },
      extra: { ownerMismatches, danglingEmbeds },
    });
  }

  for (const row of singleRows as Array<Record<string, unknown>>) {
    const list = typeof row.api_key_id === "string" ? feeds[row.api_key_id] : undefined;
    if (!list) continue;
    list.push({
      strategy_id: typeof row.id === "string" ? row.id : null,
      name: typeof row.name === "string" ? row.name : null,
      status: typeof row.status === "string" ? row.status : null,
      kind: "single",
    });
  }

  for (const id of ids) feeds[id] = sortFeeds(feeds[id]);
  return NextResponse.json({ feeds }, { status: 200, headers: NO_STORE_HEADERS });
});
