import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { withPublishedOnly, withPublishedOrOwner } from "@/lib/visibility";
import { captureToSentry } from "@/lib/sentry-capture";
import { displayStrategyName } from "@/lib/strategy-display";
import type { DisclosureTier } from "@/lib/types";
import { readPublicVerificationSignals } from "@/lib/queries";
import {
  isCapitalOwnership,
  type CapitalOwnership,
} from "@/lib/capital-ownership";
// Phase 164 / D-06 — the builder moved OUT of this page, verbatim, into the lib
// package beside the functions it already called, so the tokenized recipient
// lane can call the SAME builder without importing a Next.js page module. Its
// canonical home is pinned by phase-148-owner-lane-cache-isolation.test.ts.
// ⛔ `buildFactsheetPayloadCached` deliberately did NOT move: the lane decision
// that makes the cached wrapper safe lives in this file, and only here.
import { fetchAndBuildPayload } from "@/lib/factsheet/fetch-and-build-payload";
import type { FactsheetPayload, TrustTierKind } from "@/lib/factsheet/types";
import { FactsheetView, OwnerUnpublishedNotice } from "./FactsheetView";

// Pin to dynamic rendering. This route's render output already depends on the
// per-request authentication state (cookies → supabase.auth.getUser() inside
// createClient()), and it depends on it more the moment any part of the render
// varies by viewer identity. Today that dynamism is only IMPLICIT — a future
// refactor that hoisted or dropped the cookie read could silently make the
// route statically renderable, and the failure mode is fail-open: an
// authenticated-rendered HTML response (an owner's own unpublished factsheet)
// cached and served to anonymous visitors. Note this is a RESPONSE-level
// concern, distinct from the unstable_cache DATA-level concern documented
// below. force-dynamic mirrors the sibling factsheet/[id]/tearsheet/page.tsx
// pin, which carries the same reasoning for the disclosure-tier redaction.
export const dynamic = "force-dynamic";

function buildFactsheetPayloadCached(
  cacheKey: string,
): Promise<FactsheetPayload | null> {
  const [id] = cacheKey.split("::");
  // Per-id `factsheet-v2:${id}` tag lets admin status flips invalidate ONE
  // strategy's payload rather than busting every factsheet at once. The
  // global `factsheet-v2` tag is retained so a schema-level migration can
  // still wipe the whole surface with a single `revalidateTag` call.
  //
  // ⛔ This wrapper takes NO visibility parameter, and the predicate below is a
  // LITERAL, never a variable. Whatever this callback builds is shared with
  // every subsequent reader of the same id for the full TTL (the key is
  // id-only — see the CACHE KEY REALITY note in
  // `@/lib/factsheet/fetch-and-build-payload`), so a viewer-dependent predicate here
  // would be a disclosure bug. Keeping the parameter off the signature makes
  // that unrepresentable: a caller cannot pass one, and the literal cannot be
  // reached by a caller at all.
  return unstable_cache(
    async () => fetchAndBuildPayload(id, withPublishedOnly),
    // Cache key carries a shape-version suffix. Bump it (e.g. -v2 → -v3)
    // whenever FactsheetPayload adds non-optional fields, so unstable_cache
    // entries from the previous shape don't crash readers expecting the new
    // fields. The factsheet-v2:* tags below still revalidate old entries.
    // Bumped v2→v3: ingestSource field added in this PR. Stale v2 entries
    // lack the field; deserialized payload would have ingestSource=undefined,
    // which evaluates !== "api" and silently suppresses all gated panels
    // (PeerPercentile, AllocatorSection, Signatures) for legitimate API
    // strategies during the TTL drain window. (RED-TEAM-C1)
    // Bumped v3→v4 (Phase 90): composite payloads now carry five OPTIONAL
    // fields (segmentBoundaries / missingSegments / metricsByBasis / mtmGate /
    // dataQuality). Because they are optional-absent, a stale v3 entry
    // deserialized as v4 degrades gracefully (missing marker/basis fields → no
    // toggle / no markers during the TTL drain, never a crash) — the bump is
    // belt-and-suspenders. `computedAt` in the key busts on any re-stitch.
    // Bumped v4→v5 (Phase 90.5): payload carries optional periodsPerYear for the
    // client leverage recompute; stale v4 entries lack it -> leverage control
    // hidden (fail-closed) during the TTL drain, never a crash.
    // Bumped v5→v6 (Phase 103, F7): the low-N reliability warning now REQUIRES
    // `bootstrapCI.n` (the resample count). A stale v5 entry missing that field
    // deserializes with `n` undefined, so `n < 252` is false and the warning is
    // wrongly SUPPRESSED (for cash too) during the 1h TTL drain. Busting the shape
    // version forces a fresh build carrying `bootstrapCI.n` rather than silently
    // hiding the caveat.
    ["factsheet-v2-payload-v6", id],
    {
      revalidate: 3600,
      tags: ["factsheet-v2", `factsheet-v2:${id}`],
    },
  )();
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await withPublishedOnly(
    supabase
      .from("strategies")
      .select("id, name, codename, description, disclosure_tier")
      .eq("id", id),
  )
    .maybeSingle();
  // Factsheet is a full-identity context: prefer the real name in the
  // <title> tag too, not just the H1. displayStrategyName redacts
  // exploratory-tier names to "Strategy #<hex>", which is correct for
  // Match Queue surfaces but wrong here — and it diverges from the H1
  // the user already sees on the page.
  const name = data?.name ?? data?.codename ?? (data ? displayStrategyName({
    id: data.id,
    name: data.name,
    codename: data.codename,
    disclosure_tier: data.disclosure_tier as DisclosureTier | null,
  }) : "Strategy");
  const description = (data?.description ?? "Institutional strategy factsheet on Quantalyze.").slice(0, 200);
  const title = `${name} — Quantalyze Factsheet`;
  // Dynamic OG image — uses the strategy-id-derived endpoint so social shares
  // get a meaningful preview card without baking PNGs at deploy time.
  const ogImage = `/api/og/factsheet/${id}`;
  return {
    title,
    description,
    robots: "noindex",
    openGraph: {
      title,
      description,
      type: "article",
      images: [{ url: ogImage, width: 1200, height: 630, alt: name }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImage],
    },
  };
}

export default async function FactsheetV2Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  // Lightweight signature probe (id + name + computed_at) + the public trust
  // signal, in parallel. Strategy meta + dailyReturns are fetched INSIDE the
  // cached function so the cache key derivation doesn't serialize a multi-MB
  // array per hit. `name` / `codename` come along on the probe so the
  // payload-pending fallback below can name the strategy without a second query.
  //
  // Phase 126 (FACTSHEET-01, founder Option B — class closure): the trust_tier
  // read used to be an RLS-scoped strategy_verifications query on the request
  // client, which returned zero rows for every NON-owner viewer — so the
  // api_verified badge silently vanished on this PUBLIC factsheet for anon +
  // non-owner sessions. readPublicVerificationSignals sources it via the
  // published-gated SECDEF primitive get_published_trust_signals (RPC on a
  // normal client, trust_tier+status ONLY; strategy_verifications stays
  // owner-locked), consistent with the SSR factsheet + browse. Fail-soft (logs
  // to Sentry on a read error): no signal -> null tier -> badge hides, page
  // still renders.
  const [signRes, verificationSignals] = await Promise.all([
    withPublishedOnly(
      supabase
        .from("strategies")
        .select("id, name, codename, disclosure_tier, strategy_analytics ( computed_at )")
        .eq("id", id),
    )
      .maybeSingle(),
    readPublicVerificationSignals([id]),
  ]);

  // TWO-LANE SELECTION (phase 148 / OWN-02). Lane A is the published/cached
  // lane above and is byte-unchanged. Lane B exists ONLY on a Lane A miss: an
  // authenticated owner may read their OWN unpublished strategy, built directly
  // (never through the shared cache — see the header comment: the cache key is
  // id-only, so an owner-built entry would be served to anonymous readers for
  // the full TTL).
  //
  // ⛔ LANE ORDER IS LOAD-BEARING. The published probe runs FIRST and the
  // session probe only on its miss, so a public (even authed) view pays ZERO
  // extra queries. Hoisting `auth.getUser()` above the Promise.all — e.g. to
  // widen `user`'s scope — reverses that and is forbidden; `ownerUid` below is
  // the scope bridge that makes the hoist unnecessary.
  let signature = signRes.data;
  let lane: "public" | "owner" = "public";
  let ownerUid: string | null = null;
  // Phase 150 / OWN-03 — the owner's capital mark, read on the OWNER PROBE only
  // and held in a lane-local variable rather than on `signature`.
  //
  // ⛔ It must never reach the cached payload: `buildFactsheetPayloadCached` is
  // keyed id-first and its entry is served to anonymous readers for the full
  // TTL, so a mark folded into the payload would be published by the cache. The
  // mark rides the same request-scoped thread `viewerNotice` does (phase-148's
  // pins are the regression gate — T-150-27). Nothing below this point touches
  // the unstable_cache callback or its wrapper.
  let ownershipMark: CapitalOwnership | null = null;
  // Phase 164 / SHARE-04 — does a LIVE private share link exist for this
  // strategy? Read on the OWNER PROBE only, and lane-local for exactly the same
  // reason `ownershipMark` is: it is threaded to FactsheetView as a render prop
  // and must NEVER become a `FactsheetPayload` field, because the payload is the
  // object the id-keyed cache serves to anonymous readers for the full TTL
  // (T-164-01, the T-150-27 rule).
  //
  // It changes what the page may TRUTHFULLY say. With a live link the owner
  // notice's "anyone else who opens this link sees a 404" sentence is false, and
  // the revoke control has something to revoke.
  //
  // ⛔ FALSE means "no live link, as far as this render can tell" — it is the
  // fail-closed value, not a claim. A read error degrades to false with a
  // server-side log rather than crashing the owner's own factsheet.
  let hasActiveShare = false;
  if (signRes.error || !signature) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      console.warn("[factsheet/v2/page] signature gate -> notFound", {
        id,
        lane: "public",
        hasError: !!signRes.error,
        errorCode: signRes.error?.code,
        errorMessage: signRes.error?.message,
        hasSignature: !!signature,
        hint: signRes.error
          ? "supabase query errored on the PUBLISHED lane — check RLS on strategies / strategy_analytics for the calling user"
          : "no row matched (id, status='published') on the PUBLISHED lane and the request carries no session, so the owner lane was not attempted — strategy may be draft / archived or RLS-hidden",
      });
      notFound();
    }
    // LANE B probe — request-scoped client (RLS on) with the owner-inclusive
    // predicate mirroring `strategies_read`. `user.id` is SESSION-only, from the
    // getUser() call directly above in this same function — NEVER params /
    // searchParams; a caller who could name another owner would read that
    // owner's drafts (T-148-02, the T-110-05/07 class). The select list is a
    // SUPERSET of Lane A's (Lane A columns + `status`) because `signature`
    // feeds both the computed_at read below and the payload-pending fallback's
    // name/codename/disclosure_tier — a narrower list breaks that fallback on
    // the owner lane only. `status` is the extra column: the lane decision
    // below is derived from the ROW's status, never from which probe matched
    // (review WR-01 — `withPublishedOrOwner` also matches PUBLISHED rows for
    // ANY authed viewer via its `status.eq.published` arm, so "Lane B matched"
    // must not be read as "viewer owns an unpublished row").
    const { data: ownRow, error: probeError } = await withPublishedOrOwner(
      supabase
        .from("strategies")
        .select("id, name, codename, disclosure_tier, status, capital_ownership, strategy_analytics ( computed_at )")
        .eq("id", id),
      user.id,
    ).maybeSingle();
    if (probeError) {
      // error-absent ≠ legit-absent: a PostgREST error returns
      // {data:null,error} and would 404 a REAL owner-visible strategy with no
      // signal. The 404 stays (the status must never become an existence
      // oracle), but the breadcrumb is logged server-side (Rule 12).
      console.error("[factsheet/v2/page] owner probe error:", probeError);
      captureToSentry(probeError, {
        tags: { route: "factsheet/v2/page", stage: "owner-probe" },
      });
    }
    if (!ownRow) {
      // The SAME notFound() an anonymous visitor gets. A non-owner authed
      // viewer, an anonymous viewer and a genuinely missing id are
      // indistinguishable from the outside (T-148-04).
      console.warn("[factsheet/v2/page] signature gate -> notFound", {
        id,
        lane: "owner",
        hasError: !!probeError,
        errorCode: probeError?.code,
        errorMessage: probeError?.message,
        hasSignature: false,
        hint: "no row matched the OWNER lane either (status='published' OR user_id=<session user>) — the session user does not own this strategy, or it does not exist",
      });
      notFound();
    }
    signature = ownRow;
    // WR-01: the owner lane (and its "Unpublished — only you can see this"
    // banner) is gated on the ROW's status, not on which probe resolved the
    // row. A PUBLISHED row can legitimately arrive here — a transient Lane A
    // query error, or the publish race (Lane A probe before the publish
    // commit, Lane B probe after) — and for any authed viewer, owner or not.
    // Claiming "unpublished / anyone else sees a 404" on a published document
    // would be a false disclosure statement. lane stays "public" for a
    // published row: `buildFactsheetPayloadCached` serves it below and no
    // banner renders.
    if (ownRow.status !== "published") {
      lane = "owner";
      ownerUid = user.id;
      // Read through the closed-set predicate rather than casting: the column
      // is `text`, so an unrecognised value must render NO tag rather than a
      // trusted-looking one (the same fail-closed posture as isAllocatable).
      ownershipMark = isCapitalOwnership(ownRow.capital_ownership)
        ? ownRow.capital_ownership
        : null;
      // Share-link EXISTENCE, on the REQUEST-scoped client (RLS on — the owner
      // may read their own strategy's share row; nobody else's predicate can
      // reach it). Deliberately NOT the admin client: this fact is only ever
      // needed for the session user's own strategy, so the request client is
      // both sufficient and the narrower authority.
      //
      // ⛔ `revoked_at` ONLY. Do NOT add `generation` (or `nonce`): both are MAC
      // inputs to `deriveShareToken`, and key material has no business on a
      // render path. The UI needs to know THAT a link is live, never WHICH link
      // it is — the URL itself comes from the client calling the idempotent mint
      // route, which returns the same url every time (D-02's reuse payoff). This
      // is also why the token module is not imported here: deriving the url
      // server-side would put its module-load secret assertion on the entire id
      // route's import graph.
      //
      // The generated database.types.ts has not been regenerated for
      // `strategy_shares` (the table landed in plan 164-02), so the typed
      // `.from()` overload does not know it. Cast through unknown — same shape
      // and same deletion trigger as the cast in
      // `src/app/factsheet-share/[token]/page.tsx`.
      const { data: shareRow, error: shareError } = await (
        supabase.from as unknown as (table: "strategy_shares") => {
          select: (cols: string) => {
            eq: (
              col: string,
              value: string,
            ) => {
              maybeSingle: () => Promise<{
                data: { revoked_at: string | null } | null;
                error: { message?: string; code?: string } | null;
              }>;
            };
          };
        }
      )("strategy_shares")
        .select("revoked_at")
        .eq("strategy_id", id)
        .maybeSingle();
      if (shareError) {
        // error-absent ≠ legit-absent (Rule 12). A PostgREST error returns
        // {data:null,error} without throwing, and silently reading that as "no
        // link" would hide a live link from its own owner — they would see the
        // 404 sentence while a recipient is reading the factsheet. The render
        // still degrades to false (the notice's conservative variant, no revoke
        // control), but the breadcrumb is logged rather than swallowed.
        console.error("[factsheet/v2/page] share-state read failed", {
          id,
          code: shareError.code,
          message: shareError.message,
        });
        captureToSentry(shareError, {
          tags: { route: "factsheet/v2/page", stage: "share-state" },
        });
      }
      hasActiveShare = !!shareRow && shareRow.revoked_at === null;
    }
  }
  const signAnalytics = Array.isArray(signature.strategy_analytics)
    ? signature.strategy_analytics[0]
    : signature.strategy_analytics;
  const computedAt = signAnalytics?.computed_at ?? "0";

  // ⛔ The owner arm calls the builder DIRECTLY: no cache read, no cache write.
  // It cannot route through `buildFactsheetPayloadCached` — the effective
  // unstable_cache key is id-ONLY (header comment), so an owner-built payload
  // would be served to every subsequent reader of this id, anonymous ones
  // included, for the full 3600s TTL. The same applies to a `null`: unstable_cache
  // stores it unconditionally, so a draft that fails to build must not reach the
  // wrapper either. The lambda closes over `ownerUid` (the session id captured in
  // the miss branch above), never over `user`, which is out of scope here.
  const payload =
    lane === "owner"
      ? await fetchAndBuildPayload(id, (q) => withPublishedOrOwner(q, ownerUid!))
      : await buildFactsheetPayloadCached(`${id}::${computedAt}`);
  if (!payload) {
    console.warn("[factsheet/v2/page] payload pending -> rendering fallback", {
      id,
      computedAt,
      hint: "buildFactsheetPayload returned null — check (a) admin client visibility on strategies row, (b) strategy_analytics.daily_returns shape, (c) series clipped to BENCH_START/BENCH_END (2023-04-26 onward) has at least 2 points",
    });
    // The strategy passed the signature gate (published, or the viewer's own
    // draft on the owner lane) but its analytics payload couldn't be built.
    // Render a friendly placeholder rather than hard-404'ing: this is a
    // transient state (analytics service still computing) or a CSV-ingested
    // strategy whose daily_returns are not yet populated. Hard-404 only on
    // the signature gate above.
    // Full-identity context — prefer the real name, fall back to the
    // pseudonym only when the strategy genuinely has no public name.
    const pendingName =
      signature.name ??
      signature.codename ??
      displayStrategyName({
        id: signature.id,
        name: null,
        codename: null,
        disclosure_tier: (signature.disclosure_tier ?? null) as DisclosureTier | null,
      });
    return (
      <article className="mx-auto max-w-[760px] px-4 sm:px-6 lg:px-10 py-12">
        {/* WR-02: the owner lane's placeholder must carry the visibility
            notice too — a still-computing draft shows its real name and reads
            like a soon-to-be-live factsheet, and the pending state is when an
            owner is MOST likely to share the URL. Same exported component as
            the full render (single-sourced UI-SPEC copy), first child so the
            disclosure precedes any document content (UI-SPEC:97). */}
        {lane === "owner" && (
          <OwnerUnpublishedNotice hasActiveShare={hasActiveShare} />
        )}
        <p className="text-fixed-10 font-mono uppercase tracking-[0.22em] text-text-muted">
          Institutional Factsheet · Quantalyze
        </p>
        <h1 className="mt-2 font-serif text-fixed-28 sm:text-fixed-36 leading-tight text-text-primary">
          {pendingName}
        </h1>
        <p className="mt-6 text-fixed-13 text-text-secondary">
          The detailed factsheet for this strategy is still computing.
          Daily-return data hasn&apos;t been ingested yet — once the
          analytics service finishes the first compute pass, the full panel
          set will render here.
        </p>
        <p className="mt-3 text-fixed-12 text-text-muted italic">
          If this persists for more than a few minutes, the strategy may
          have insufficient observations inside the bundled benchmark
          window (2023-04-26 onward). See the dev-server console for the
          exact gate the request fell through.
        </p>
      </article>
    );
  }

  // Trust tier is per-request (not cached with payload) so verification flips
  // don't require a payload cache bust. Sourced via readPublicVerificationSignals
  // (the published-gated get_published_trust_signals SECDEF RPC on a normal
  // client — NOT service role), which fails soft + logs to Sentry on a read
  // error — a transient drop stays visible without blanking the page (FINDING-4
  // b06-silentfailure: the silent-drop logging now lives inside the helper).
  const rawTrustTier = verificationSignals.get(id)?.trust_tier ?? null;
  const trustTier: TrustTierKind | null =
    rawTrustTier === "api_verified" || rawTrustTier === "csv_uploaded" || rawTrustTier === "self_reported"
      ? rawTrustTier
      : null;
  // Trust tier is overlaid post-build (per-request, not cached with the payload).
  // Object-spread distributes over the discriminated union and PRESERVES the
  // `ingestSource` discriminant, so the result stays a valid FactsheetApiPayload |
  // FactsheetCsvPayload — both narrowing and the no-invented-data compile error
  // survive the spread (verified: tsc 0).
  const payloadWithTrust: FactsheetPayload = { ...payload, trustTier };

  // JSON-LD FinancialProduct schema — helps Google + LLMs identify the page
  // as a structured financial-product listing. Content is server-built and
  // JSON-stringified; we additionally escape `</` to defang any name/desc
  // value attempting to close the embedded script tag.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FinancialProduct",
    name: payloadWithTrust.strategyName,
    description: payloadWithTrust.description ?? undefined,
    provider: { "@type": "Organization", name: "Quantalyze" },
    feesAndCommissionsSpecification: payloadWithTrust.aum != null ? `AUM ${payloadWithTrust.aum}` : undefined,
    // FINDING-7 (b06-silentfailure): Only publish CAGR as a machine-readable
    // interestRate when it is a finite number AND the strategy is API-verified.
    // NaN/Infinity serialize to null in JSON (benign but misleading), and CSV
    // strategies with short track records should not have their annualized CAGR
    // ingested by crawlers as a verified yield figure.
    interestRate:
      Number.isFinite(payloadWithTrust.strategyMetrics.cagr) &&
      payloadWithTrust.ingestSource === "api"
        ? payloadWithTrust.strategyMetrics.cagr
        : undefined,
  };
  const jsonLdStr = JSON.stringify(jsonLd).replace(/</g, "\\u003c");

  return (
    <>
      <script type="application/ld+json">{jsonLdStr}</script>
      {/* The notice is derived from the LANE decision, never from a payload
          field — lane state must not enter the object the shared public cache
          serves (UI-SPEC:112). */}
      {/* Phase 150 / OWN-03 + OWN-05 — two more lane-derived render props,
          threaded exactly like `viewerNotice` above and for the same reason:
          they must not enter the object the shared public cache serves.

          `lane === "owner"` IS the D-17 gate, for free. That lane is reachable
          only when the published probe MISSED and the owner-inclusive probe hit
          with a non-published status — i.e. the row is unpublished AND owned by
          this session. A published own strategy resolves on the public lane, so
          `Rename…` is absent there with no second predicate to keep in sync
          (150-RESEARCH § Pattern 5). The route enforces the same restriction
          server-side regardless. */}
      <FactsheetView
        payload={payloadWithTrust}
        viewerNotice={lane === "owner" ? "owner_unpublished" : undefined}
        ownershipMark={lane === "owner" ? ownershipMark : undefined}
        // Phase 164 / SHARE-04 — a THIRD lane-derived render prop under the same
        // rule as the two above. Its PRESENCE is the "this row is unpublished and
        // the session owns it" half of the share predicate (the owner lane is
        // reachable only in that state — the same free gate `renameTarget` uses),
        // and `hasActiveShare` is the "a link is live right now" half. Absent on
        // every other mount, so the published `?share=1` lane is byte-identical
        // (D-09) and the recipient/scenario mounts are untouched.
        ownerShare={lane === "owner" ? { hasActiveShare } : undefined}
        renameTarget={
          lane === "owner"
            ? { id, name: payloadWithTrust.strategyName }
            : undefined
        }
      />
    </>
  );
}
