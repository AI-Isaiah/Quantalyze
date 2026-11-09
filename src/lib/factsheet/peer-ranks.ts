import type { SupabaseClient } from "@supabase/supabase-js";
import { getPercentiles } from "@/lib/queries";
import { captureToSentry } from "@/lib/sentry-capture";
import { withPublishedOnly } from "@/lib/visibility";
import type { FactsheetPayload, PeerRanks } from "./types";

/**
 * Phase 196 plan 16 (LEAN-02): the tear sheet's peer-relative ranks, carried onto the
 * strategy's one page. The source is the one the tear sheet, `/browse/[slug]` and
 * `/discovery/[slug]` already read per request, `getPercentiles(categorySlug)`; nothing is
 * re-derived here.
 *
 * ⛔ PER REQUEST, NEVER CACHED. `getPercentiles` uses the request-scoped server client, so it
 * must not run inside the factsheet's `unstable_cache` callback, and its answer moves with the
 * cohort, not with this strategy's analytics run. The page calls this AFTER the cached build and
 * overlays the result with `withPeerRanks`, exactly as the trust tier is overlaid.
 *
 * Fail soft: a failed read returns null (the section is absent, the page renders). The category
 * read reports to Sentry here; `getPercentiles` reports its own errors.
 *
 * `supabase` is the request client the page already holds. Both reads are published-only.
 */
export async function readPeerRanks(
  supabase: SupabaseClient,
  strategyId: string,
): Promise<PeerRanks | null> {
  try {
    const { data, error } = await withPublishedOnly(
      supabase.from("strategies").select("discovery_categories(slug)").eq("id", strategyId),
    ).maybeSingle();
    if (error) {
      captureToSentry(error, {
        tags: { area: "factsheet-peer-ranks", step: "category_read" },
        level: "error",
      });
      return null;
    }
    if (!data) return null;

    // PostgREST returns the embed as an object for a to-one relation; tolerate an array.
    const raw = (data as { discovery_categories?: unknown }).discovery_categories;
    const cat = Array.isArray(raw) ? raw[0] : raw;
    const slug = (cat as { slug?: unknown } | null | undefined)?.slug;
    const categorySlug = typeof slug === "string" && slug.length > 0 ? slug : null;

    // An undefined slug ranks against every published strategy, as the tear sheet does today.
    const map = await getPercentiles(categorySlug ?? undefined);
    const percentiles = map?.[strategyId];
    if (!percentiles) return null;
    return { categorySlug, percentiles };
  } catch (err) {
    // A throw (a client that cannot be built, a network fault) must not take the page down.
    captureToSentry(err, {
      tags: { area: "factsheet-peer-ranks", step: "read" },
      level: "error",
    });
    return null;
  }
}

/**
 * Overlay the per-request peer ranks onto a built factsheet payload (the `withTrustTier` shape).
 * The ranks are a fact about the strategy, not about the unit on screen, so they go onto the
 * native payload and, when present, the server-built `usdView.payload` too. The input is not
 * mutated, and the spread keeps the `ingestSource` discriminant.
 */
export function withPeerRanks(
  payload: FactsheetPayload,
  peerRanks: PeerRanks | null,
): FactsheetPayload {
  if (!payload.usdView) return { ...payload, peerRanks };
  return {
    ...payload,
    peerRanks,
    usdView: {
      ...payload.usdView,
      payload: { ...payload.usdView.payload, peerRanks },
    },
  };
}
