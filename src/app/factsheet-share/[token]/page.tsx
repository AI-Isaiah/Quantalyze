// SECURITY BOUNDARY:
// This is a PUBLIC, sessionless route and the ONLY tokenized factsheet surface
// (ruling D-04 — the tearsheet and PDF routes are deliberately OUT of scope and
// still 404 for a recipient). Two reads happen here, both on the admin
// (service_role) transport:
//   (1) `strategy_shares(strategy_id, generation, nonce)` filtered to
//       `revoked_at IS NULL` — the candidate set for the constant-time scan.
//       ⛔ `nonce` joined the MAC pre-image at the founder ruling of
//       2026-08-27 and is a MAC INPUT ONLY: it must never be rendered, logged,
//       put in a URL, or passed into the payload. It derives nothing without
//       SHARE_TOKEN_SECRET, but it is also the one column whose secrecy makes a
//       destroyed-and-recreated share row unforgeable, so leaking it hands an
//       attacker the only database-side value they cannot otherwise obtain;
//   (2) `fetchAndBuildPayload(strategy_id, <identity predicate>)` — the SAME
//       builder the owner lane calls, invoked DIRECTLY.
//
// ⛔ THE CONSTANT-TIME HMAC MATCH IS THE AUTHORIZATION. There is no session, no
// RLS gate, and no status predicate on the payload read — deliberately, because
// the whole point is that an UNPUBLISHED strategy renders for the holder of a
// valid capability. If you are about to add a query here, ask what bounds it:
// (1) is bounded by `revoked_at IS NULL`, (2) is bounded by the matched
// strategy id. NEVER read an arbitrary id, never widen the projection to owner
// identity / api_keys / holdings / AUM.
//
// ⛔ SL-1 — THIS MODULE HAS NO CACHE REACH, AND THAT IS THE STRUCTURAL ARGUMENT.
// It imports `@/lib/factsheet/fetch-and-build-payload` and does NOT import
// `factsheet/[id]/v2/page.tsx`, so `buildFactsheetPayloadCached` is not
// reachable from here at all. That matters because the effective
// `unstable_cache` key on the id route is id-ONLY: a viewer-dependent payload
// routed through that wrapper would be served to every subsequent ANONYMOUS
// visitor to `/factsheet/<id>` for the full 3600s TTL, silently, with the
// poisoning request being the owner's own and therefore rendering correctly.
// ⛔ Do not "reuse the cache for speed" here. Do not generalise the wrapper.

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import type { Metadata } from "next";

import { createAdminClient } from "@/lib/supabase/admin";
import { publicIpLimiter, checkLimit, getClientIp } from "@/lib/ratelimit";
import { verifyShareToken } from "@/lib/strategy-share-token";
import {
  fetchAndBuildPayload,
  type StrategyVisibility,
} from "@/lib/factsheet/fetch-and-build-payload";
import { EmptyStateCard } from "@/components/ui/EmptyStateCard";
import { FactsheetView } from "@/app/factsheet/[id]/v2/FactsheetView";

// DO NOT cache at the edge. Shared caches are keyed on the URL, not on the
// token's revocation state, so a cached response could be replayed after a
// revoke and resurrect a dead link. The `revoked_at IS NULL` filter below makes
// a revoke immediate; `force-dynamic` guarantees no ISR/edge entry outlives
// that write. (Same reasoning as `/scenario-share/[token]`.)
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Where every miss class on this lane ends up (D-08). */
const GONE_PATH = "/factsheet-share/gone";

/** 32-byte base64url digest, no padding — the shape `deriveShareToken` emits. */
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/**
 * ⛔ SL-1d — STATIC metadata, and deliberately threadbare.
 *
 * There is NO `generateMetadata` here and NO OG image reference, which is a
 * decision and not an oversight. `/api/og/factsheet/[id]` is CDN-cached,
 * URL-keyed and un-revocable behind a 7-day `stale-while-revalidate`; pointing
 * this page at it would publish a permanent public image of a private strategy
 * that no revoke could withdraw. The metadata also carries no strategy name —
 * a title is fetched by unauthenticated crawlers and cached by third parties,
 * so naming the strategy here would leak it outside the capability.
 *
 * (The sibling `/scenario-share/[token]` page exports no metadata at all. That
 * is a gap in it, not a pattern to copy: without `robots: "noindex"` a shared
 * link is indexable by default.)
 */
export const metadata: Metadata = {
  title: "Factsheet — Quantalyze",
  description: "A privately shared strategy factsheet.",
  robots: "noindex",
};

/**
 * One active share row. Projection is exactly what the scan needs — and no more.
 *
 * ⛔ `nonce` IS PART OF THE MAC PRE-IMAGE (founder ruling 2026-08-27) and must
 * be selected, or nothing verifies. It is a MAC INPUT, never a credential and
 * never rendered: it derives nothing without SHARE_TOKEN_SECRET, it does not
 * appear in the URL, and it must not reach the payload, the DOM or a log line.
 * The active index carries `INCLUDE (nonce)` so reading it costs no heap fetch.
 */
type ShareCandidate = {
  strategy_id: string;
  generation: number;
  nonce: string;
};

/**
 * ⛔ THE IDENTITY PREDICATE, NAMED AND COMMENTED SO IT CANNOT BE MISREAD.
 *
 * `fetchAndBuildPayload` runs on the SERVICE-ROLE admin client, where the
 * injected predicate is the ONLY visibility gate — which is exactly why the
 * parameter is required with no default. Passing identity here is not a missing
 * gate: authorization ALREADY happened, via the constant-time HMAC match below.
 * The token IS the authorization, and the entire feature is that an unpublished
 * strategy renders for its holder, so a `status='published'` predicate here
 * would make every share link 404 for precisely the strategies it exists for.
 *
 * ⛔ Scope: this constant is LOCAL to the recipient lane. Do not export it, do
 * not move it into `@/lib/visibility` beside `withPublishedOnly`, and above all
 * do not pass it — or anything like it — to `buildFactsheetPayloadCached`,
 * which is unreachable from this module by construction (see the header).
 */
const withTokenBearer: StrategyVisibility = (query) => query;

/**
 * Read every ACTIVE share row and constant-time-compare the presented token
 * against each candidate's derived token (D-07).
 *
 * WHY A SCAN AT ALL: the token is a pure MAC, and nothing token-derived is
 * stored (D-02 forbids a token at rest, raw or hashed), while D-01 keeps the
 * strategy id out of the URL. Together those leave the server with no lookup
 * key, so there is nothing to index on. `UNIQUE(strategy_id)` caps the
 * candidate set at one active row per strategy.
 *
 * EARLY EXIT IS FINE, and the reason is worth stating because "constant-time"
 * and "early exit" look contradictory. The timing signal an early exit could
 * leak is a byte-prefix oracle against ONE secret; here each comparison is
 * against a DIFFERENT candidate's derived token, so an attacker learns at most
 * how far down an ordering they matched — and to reach a comparison at all they
 * must already hold a token that verifies. `timingSafeEqual` inside
 * `verifyShareToken` is what closes the per-comparison oracle.
 *
 * ⚠️ REVISIT THRESHOLD: above ~1,000 active share rows (recorded in
 * `strategy-share-token.ts`). The O(1) alternative extends the token format and
 * needs founder sign-off — do not adopt it silently.
 */
async function findShareMatch(token: string): Promise<ShareCandidate | null> {
  const admin = createAdminClient();
  // The generated database.types.ts has not been regenerated for
  // `strategy_shares` (the table lands in plan 164-02), so the typed `.from()`
  // overload does not know it. Cast through unknown — the single place to
  // delete once the types regeneration lands (mirrors the
  // flip_capital_ownership_to_team_review cast in
  // src/app/api/strategies/[id]/ownership/route.ts).
  const { data, error } = await (
    admin.from as unknown as (table: "strategy_shares") => {
      select: (cols: string) => {
        is: (
          col: string,
          value: null,
        ) => Promise<{
          data: ShareCandidate[] | null;
          error: { message?: string } | null;
        }>;
      };
    }
  )("strategy_shares")
    .select("strategy_id, generation, nonce")
    .is("revoked_at", null);

  if (error) {
    // error-absent ≠ legit-absent. A PostgREST error returns {data:null,error}
    // WITHOUT throwing, and a silent empty candidate set would 410 a LIVE link
    // with no signal at all. The recipient still gets the uniform miss response
    // (echoing a DB error would leak schema), but the breadcrumb is logged
    // server-side, redacted to the message.
    console.error("[factsheet-share/page] active share read failed", {
      message: error.message,
    });
    return null;
  }

  for (const candidate of data ?? []) {
    if (
      verifyShareToken(
        token,
        candidate.strategy_id,
        candidate.nonce,
        candidate.generation,
      )
    ) {
      return candidate;
    }
  }
  return null;
}

export default async function FactsheetSharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // 1. LIMIT FIRST — before any DB read and before any HMAC work (D-07). This
  //    ordering is the enumeration defence: without it, an attacker gets a free
  //    scan of every active share row per request. The denial renders a NEUTRAL
  //    "try again" card rather than the 410, so being rate-limited cannot be
  //    read as a signal about whether the token exists.
  const hdrs = await headers();
  const ip = getClientIp(hdrs);
  const rl = await checkLimit(publicIpLimiter, `factsheet-share:${ip}`);
  if (!rl.success) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16">
        <EmptyStateCard
          heading="Please try again shortly"
          body="Too many requests from your network right now. Wait a moment and reload this page."
        />
      </main>
    );
  }

  // 2. Format guard. A malformed token takes the SAME path as an unknown one —
  //    uniform WITHIN this lane — and does so without touching the database.
  if (!TOKEN_RE.test(token)) {
    console.warn("[factsheet-share/page] malformed token -> 410", {
      length: token.length,
    });
    redirect(GONE_PATH);
  }

  // 3. Bounded constant-time scan over ACTIVE rows only.
  const match = await findShareMatch(token);
  if (!match) {
    // Unknown, revoked, and read-failed all converge here. A holder of a dead
    // link learns only that it is dead — which they already knew by trying it.
    console.warn("[factsheet-share/page] no active share matched -> 410");
    redirect(GONE_PATH);
  }

  // 4. The SAME builder the owner lane calls, invoked DIRECTLY — never through
  //    the cached wrapper, which this module cannot reach (see the header).
  const payload = await fetchAndBuildPayload(match.strategy_id, withTokenBearer);

  if (!payload) {
    // ⛔ NOT the 410. The token is VALID; the analytics payload simply is not
    // built yet (still computing, or a CSV strategy whose daily returns have
    // not been ingested). Telling the recipient the link is dead would be a
    // false statement about a live link, and "still computing" is exactly when
    // an owner is most likely to have shared it. Content-free: no strategy
    // name, no metrics, no owner chrome.
    console.warn("[factsheet-share/page] valid token, payload pending", {
      strategyId: match.strategy_id,
    });
    return (
      <main className="mx-auto max-w-3xl px-4 py-16">
        <EmptyStateCard
          heading="This factsheet isn't ready yet"
          body="The link works — the strategy's performance data is still being computed. Try again in a few minutes."
        />
      </main>
    );
  }

  // 5. Recipient render. `recipientShare` suppresses the Copy-Link control and
  //    the outbound navigation STRUCTURALLY: there is no `?share=1` on this URL
  //    to sniff, and `useShareMode()` (which serves the id route, D-09) is left
  //    byte-unchanged. Both props are REQUEST-scoped render props — they are
  //    never folded into FactsheetPayload, because the payload is the object the
  //    shared public cache serves and lane state inside it would be published to
  //    everyone (the T-150-27 rule).
  return (
    <FactsheetView
      payload={payload}
      viewerNotice="shared_privately"
      recipientShare
    />
  );
}
