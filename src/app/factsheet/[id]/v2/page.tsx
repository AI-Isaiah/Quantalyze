import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { withPublishedOnly, withPublishedOrOwner } from "@/lib/visibility";
import { captureToSentry } from "@/lib/sentry-capture";
import { displayStrategyName, publicNamePreview } from "@/lib/strategy-display";
import type { DisclosureTier } from "@/lib/types";
import { readPublicVerificationSignals } from "@/lib/queries";
import { canViewAum, withViewerAum } from "@/lib/factsheet/viewer-aum";
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
import {
  fetchAndBuildPayloadWithReason,
  type NotBuildableDetail,
  type NotBuildableReason,
} from "@/lib/factsheet/fetch-and-build-payload";
import type { FactsheetPayload, PeerRanks, TrustTierKind } from "@/lib/factsheet/types";
import { parseReturnsUnit } from "@/lib/factsheet/returns-unit";
import { OG_CARD_VERSION } from "@/lib/factsheet/og-metrics";
import { provenanceFingerprint } from "@/lib/factsheet/provenance-fingerprint";
import { withTrustTier } from "@/lib/factsheet/with-trust-tier";
import { readPeerRanks, withPeerRanks } from "@/lib/factsheet/peer-ranks";
import { buildFactsheetJsonLd } from "@/lib/factsheet/json-ld";
import {
  deriveComputeState,
  recipientArm,
  selectFactsheetJob,
  type ComputeState,
} from "@/lib/compute-state";
import { DegradeLine } from "@/components/degrade/DegradeLine";
import {
  degradeSegments,
  ownerStateKind,
  type DegradeId,
  type OwnerStateKind,
} from "@/lib/degrade-warnings";
import {
  readOwnerComputeJobs,
  readOwnerCompositeHistory,
} from "@/lib/compute-jobs-read";
import {
  lastAttemptDay,
  ownerRemedy,
  ownerStateLine,
  probeUnreadableShareNote,
  recipientShareNoteFor,
  unbuildableNoteKindOf,
  type StateLineTone,
  type UnbuildableNoteKind,
} from "@/lib/status-surface-copy";
import {
  countCompositeMembers,
  resolveStrategyShape,
  shouldPreferStitch,
  type CompositeHistory,
  type StrategyShape,
} from "@/lib/strategy-shape";
import { isAuthSessionMissingError, type SupabaseClient } from "@supabase/supabase-js";
import { FactsheetView, OwnerUnpublishedPanel } from "./FactsheetView";
import type { ReactNode } from "react";
import { ViewerBar } from "@/components/factsheet/ViewerBar";
import { SignUpLine, VisitorHeader } from "@/components/factsheet/VisitorHeader";
import { StrategyNoteCard } from "@/components/notes/StrategyNoteCard";
import { backTargetFor, parseOrigin } from "@/lib/factsheet/origin";
import { resolveFactsheetViewer } from "@/lib/factsheet/viewer";
import { ContactPointerText } from "@/components/contact/ContactPointerText";
import { contactHref } from "@/lib/contact";

/**
 * Phase 167.2 / KCS-09 — the owner state line's colour, by the tone its copy
 * row carries (DESIGN.md § Semantic-color gates): muted for steady or in
 * progress, amber for recoverable, red for a permanent failure only.
 */
const STATE_LINE_TONE_CLASS = {
  muted: "text-text-secondary",
  amber: "text-warning",
  red: "text-negative",
} as const satisfies Record<StateLineTone, string>;

/**
 * Phase 199 plan 18 (D-04, SC-4) — the registry entry each kind of owner state line is. A literal
 * table so the degrade scan sees the ids where they render; `satisfies` makes a renamed or removed
 * entry a compile error here.
 */
const OWNER_STATE_ENTRY = {
  working: "factsheet.owner-state-working",
  dated: "factsheet.owner-state-dated",
  undated: "factsheet.owner-state-undated",
} as const satisfies Record<OwnerStateKind, DegradeId>;

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

/**
 * 167.2.1-REVIEW-R2 WR-02 / SFH-R2 N-4 — the public build's admin read failed
 * (`read_error`). Thrown from inside the `unstable_cache` callback so a
 * transient outage is never stored as the answer for this analytics run.
 * Module-private: the page catches it and renders the placeholder, uncached.
 */
class FactsheetReadError extends Error {
  constructor() {
    super("public factsheet build: the admin read failed");
    this.name = "FactsheetReadError";
  }
}

/**
 * 169.1 review round 1 (SFH HIGH-1) — the public build succeeded, but its
 * `cash_settlement` conventions read failed, so the payload was built on the
 * config tier (D-30) and may draw its curve on a method the stored headline was
 * not computed under. Thrown from inside the `unstable_cache` callback, exactly
 * like `FactsheetReadError`, so that build is never stored for the analytics
 * run. Unlike a `read_error` it CARRIES the payload: a blip must not blank a
 * factsheet (D-30), so the page renders it, uncached. The resolve stage has
 * already captured the failed read once. Module-private.
 */
class FactsheetDegradedBuildError extends Error {
  readonly payload: FactsheetPayload;
  constructor(payload: FactsheetPayload) {
    super("public factsheet build: built on the config tier after a failed conventions read");
    this.name = "FactsheetDegradedBuildError";
    this.payload = payload;
  }
}

function buildFactsheetPayloadCached(
  id: string,
  computedAt: string,
  tradesFetchedAt: string | null,
  provenanceKey: string,
  computationStatus: string,
): Promise<FactsheetPayload | null> {
  // 167.2.1-REVIEW WR-02 (closes DEF-148-A): the key is the shape version, the
  // id AND `computed_at`, as real `keyParts` members; 167.1.2.2.2 plan 10 adds
  // the two trade-fact members and 166.3.1 D-05 adds the row's
  // `computation_status` as the last one (below). Before, the page passed
  // `${id}::${computedAt}` and this wrapper split the suffix off, so the
  // effective key was the id only, and an entry (a `null` included, which
  // unstable_cache stores unconditionally) outlived the analytics run it was
  // built from for the full TTL. /strategies decides its "right now" share
  // notes with a FRESH probe, so for up to an hour it could say "no note" while
  // this lane served a cached placeholder, or "not available" while it served
  // a cached payload. Nothing else can revalidate on a compute: the writer is
  // the Python worker, which cannot reach Next's cache.
  //
  // What moves the key, member by member (merged 166.3.1 NAVBREACH + 167.1.2.2.2):
  //   - `computed_at` moves ONLY on a successful write (`complete`,
  //     `complete_with_warnings`). Before 166.3.1 the status bridge
  //     `sync_strategy_analytics_status` stamped `computed_at = now()` on every
  //     transition it resolved, so the key moved when a compute started AND
  //     when it ended. That is no longer true: since the D-05 trigger on
  //     `strategy_analytics` (plan 166.3.1-02) holds `computed_at` on entry
  //     into `computing` and on a write to `failed`, and since Phase 166.5 the
  //     bridge writes no date at all: the analytics runner stamps it on its
  //     success write only, so a failed or computing row carries the date of
  //     its last good compute.
  //   - `computation_status` (D-05, founder 2026-10-07, "Add status to cache
  //     key") moves it on entry into `computing` and on a failure, which
  //     `computed_at` no longer does. Without it, a complete payload cached at
  //     T0 would be served for the 3600 s TTL to readers of a row that is
  //     `computing` or `failed` at the same T0, undoing STALE-01's withholding
  //     (which lives inside the cached builder and never runs on a hit). An
  //     absent status keys on the fixed string "none", chosen by the caller:
  //     `undefined` would be dropped from the key.
  //   - `trades_fetched_at` and a fingerprint of `series_provenance` (plan 10)
  //     move it on a daily tick or a runbook provenance write, neither of which
  //     moves `computed_at`.
  // All of these are properties of the ROW, never of the viewer, so the key
  // stays viewer-independent (the corollary below still holds).
  //
  // Per-id `factsheet-v2:${id}` tag lets admin status flips invalidate ONE
  // strategy's payload rather than busting every factsheet at once. The
  // global `factsheet-v2` tag is retained so a schema-level migration can
  // still wipe the whole surface with a single `revalidateTag` call.
  //
  // ⛔ This wrapper takes NO visibility parameter, and the predicate below is a
  // LITERAL, never a variable. Whatever this callback builds is shared with
  // every subsequent reader of the same id and run for the full TTL (the key
  // carries nothing about the viewer — see the CACHE KEY REALITY note in
  // `@/lib/factsheet/fetch-and-build-payload`), so a viewer-dependent predicate here
  // would be a disclosure bug. Keeping the parameter off the signature makes
  // that unrepresentable: a caller cannot pass one, and the literal cannot be
  // reached by a caller at all.
  //
  // 167.2.1-REVIEW-R2 WR-02 / SFH-R2 N-4: a `read_error` THROWS instead of
  // returning null. Measured in the bundled Next (16.2.11,
  // `next/dist/server/web/spec-extension/unstable-cache.js`, `unstable_cache`):
  // on a miss the callback is awaited BEFORE `cacheNewResult`, so a throw
  // propagates and nothing is stored; on a stale entry the background
  // revalidation's `.catch` returns the cached value and does not call
  // `cacheNewResult`, so the last good entry survives. A one-request read blip
  // therefore can no longer pin a placeholder under this `computed_at` for the
  // TTL while /strategies' fresh probe shows no note. Every OTHER reason is a
  // fact about the stored row and is cached as `null`, as before.
  // The composite residual of D-07 is closed by Phase 169 plan 169-07 (169
  // D-41): the composite reader throws on a failed `csv_daily_returns` read and
  // the resolve stage answers `read_error`, so the throw below covers it.
  return unstable_cache(
    async () => {
      const built = await fetchAndBuildPayloadWithReason(id, withPublishedOnly);
      if (built.reason === "read_error") throw new FactsheetReadError();
      // SFH HIGH-1: a degraded build is rendered, never stored (see the class).
      if (built.payload && built.conventionsDegraded) throw new FactsheetDegradedBuildError(built.payload);
      return built.payload;
    },
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
    // belt-and-suspenders. (Its claim that `computedAt` in the key busted on
    // a re-stitch was false until 167.2.1-REVIEW WR-02 made it a keyParts
    // member below.)
    // Bumped v4→v5 (Phase 90.5): payload carries optional periodsPerYear for the
    // client leverage recompute; stale v4 entries lack it -> leverage control
    // hidden (fail-closed) during the TTL drain, never a crash.
    // Bumped v5→v6 (Phase 103, F7): the low-N reliability warning now REQUIRES
    // `bootstrapCI.n` (the resample count). A stale v5 entry missing that field
    // deserializes with `n` undefined, so `n < 252` is false and the warning is
    // wrongly SUPPRESSED (for cash too) during the 1h TTL drain. Busting the shape
    // version forces a fresh build carrying `bootstrapCI.n` rather than silently
    // hiding the caveat.
    // Bumped v6→v7 (Phase 166.2 review round 2, IN-03): the shape is unchanged
    // but the VALUES are not. A ratio that does not exist (Sharpe, Sortino,
    // Calmar, a peer rank) is now NaN, "—", where a v6 entry holds a fabricated
    // 0; bumping serves the fix at deploy instead of after the 1h TTL drain.
    // Bumped v7→v8 (Phase 169 FACTSHEETTRUTH, 169 D-62, 2026-09-27): the shape
    // AND the values change. 169-04: the MTD / YTD / 3M / 6M / 1Y windows are
    // nullable (a window the record does not cover is null) and `p3y` / `p5y`
    // are added; 169-01: the single-key headline reads the persisted analytics
    // scalars instead of the TypeScript recompute. A v7 entry lacks `p3y` /
    // `p5y`, and 169-05's row gates omit a null row, so serving one would HIDE
    // correct 3 Year / 5 Year rows on a long record: a wrong page, not an old
    // figure. `revalidate` and the admin route's tag bust are both
    // stale-while-revalidate, so only a key move stops a pre-deploy entry being
    // served after the deploy. Phase 169.5 moves the key again (169.5-01).
    // Review round 1 (2026-09-29) changed the payload again before any v8 entry
    // existed (v8 was not on origin/main): optional `dataQuality` fields
    // (`twrChainBroken`, `headlineCoversFrom`, `returnsConventionOverride`), an
    // arithmetic curve for a single-key `simple` config, and an MTM / smoothed /
    // cash-series read outage that now throws instead of building a degraded
    // payload. They ride this one v8 bump; no second move was needed.
    // Bumped v8→v9 (Phase 169.5 BENCHCOMPARE, 169 D-48 as amended by 169 D-62):
    // comparator blocks carry `through`, null windows past it and covered-day
    // summaries (169.5-01); the payload carries the bounded BTC prices, their
    // `through` and `dropped` for the browser re-derive, and comparator chart
    // series (cumulative, cumVsBench, volMatched) are null past coverage with
    // rolling statistics on the comparator's own basis (169.5-02); comparator
    // `dailyReturns` are null where uncovered (169.5-04). A stale v8 entry lacks
    // them, so during the 1 h TTL drain it would show +0.00% benchmark windows and
    // feed the MTM / leverage re-derive no prices; one bump covers Phase 169.5
    // because its plans deploy in one PR. Phase 169's own payload changes are
    // covered by its v7→v8 bump (169 D-62) and are not v9 content.
    // Bumped v9→v10 (Phase 169.4 D-71): 169.4-05 and 169.4-06 changed the api-arm panels (null-honest signatures and allocator blends).
    // Bumped v10→v11 (Phase 169.1 D-80): 169.1-03 to 169.1-07 changed the payload's conventions fields and the per-basis, bucket, rolling, bootstrap and stress values.
    // Bumped v11→v12 (Phase 164.6.6.2 BTCNATIVE, 2026-10-07): the payload gained `returnsUnit` (the unit the strategy's returns are measured in, from `data_quality_flags.native_unit`). A v11 entry lacks it, so for the 1 h TTL drain a BTC account's factsheet would read as USD with no chip and bare return labels.
    // Bumped v12→v13 (Phase 164.6.6.2.1 BTCUSDVIEW, 2026-10-09): the payload gained `usdView` / `usdViewUnavailable` (the server-built USD view of a native-unit strategy). A v12 entry lacks them, so for the 1 h TTL drain a BTC account's factsheet could not toggle to USD and would show no reason why.
    // Bumped v12→v13 (Phase 170.2 PROBEFIXES SC-4, D-09): payload gains the optional source field
    // Bumped v13→v14 (Phase 164.6.6.2.1 BTCUSDVIEW, 2026-10-10, on merging main): 170.2 shipped v13 with `source` but without `usdView` / `usdViewUnavailable`, so this branch's payload is a different shape under the same key. A v13 entry written by main would hide the USD toggle for the 1 h TTL drain.
    // Bumped v14→v15 (re-keyed on merging main, 2026-10-10; originally drafted as v12→v13) (Phase 164.6.6.3.3 FACTSHEETTRUTH, 2026-10-09): the payload's `dataQuality` gains `headlineWithheld` and `headlineGuardReasons`, a composite now carries `twrChainBroken` and `headlineCoversFrom`, and a legacy chain-broken row's seven stored scalars are withheld; a stale entry would show mixed-basis figures under the new one-span note during the 1 h drain.
    // Bumped v15→v16 (Phase 167.1.2.2.2 TRADESYNC plan 10, 2026-10-10, re-keyed on merging main: it was drafted as v12→v13 and main shipped v15 meanwhile): the payload gained `tradesFetchedAt`, `tradeFetchVenue` and `unrecoveredGaps` (the header's trade-fetch line and the named-gap record), and the key gained `trades_fetched_at` plus a fingerprint of `series_provenance`. The daily tick stamps `trades_fetched_at`, and a runbook provenance write sets `series_provenance`, with neither moving `computed_at`, so under the v15 key the line would have stayed frozen for the 1 h TTL. A v15 entry lacks the three fields, which read as undefined (no line), not as an error.
    // Bumped v16→v17 (Phase 164.6.6.2.3 FLOWTIMING, 2026-10-13, on merging main): the payload's `dataQuality` gains the optional `flowTimingDayLevel` and `flowTimingDayLevelLarge` (the day-level flow-timing note and the "returns can be extreme" caveat), and the retired `flow_dominated_guard` no longer names a guard reason, so `headlineGuardReasons` is absent where a v16 entry could carry it. A v16 entry lacks the two new fields, so for the 1 h TTL drain a day-level account would show no note and a stored flow-dominance row would still name its retired reason.
    // Not a payload-shape bump (166.3.1 NAVBREACH D-05, merged with origin/main): the key gained a
    // sixth member, `computationStatus` (`computation_status ?? "none"`), and the payload shape was
    // unchanged, so the version stayed v17 at that merge (the v17→v18 bump below is a later,
    // separate change). A longer keyParts array already separated every entry built under the
    // five-member v17 key.
    // Bumped v17→v18 (Phase 170.6 DISPLAYPOLISH SFH-2, 2026-10-14): the values inside `comparators.*.summary`, `summarySince` and the windowed comparator views change without a shape change. Below the 90-day overlap floor (D-07) the comparator's Sharpe, Sortino, Calmar, CAGR and annualized volatility are NaN, not the figures a v17 entry holds (SPX over 5 days read a Sharpe of 10.24). The key's other members (`computedAt`, `tradesFetchedAt`, provenance, status) do not move at deploy, so under v17 an entry built before the deploy would keep serving the old figures for the 1 h TTL drain, beside a fresh build and the OG card that show "—".
    // Bumped v18→v19 (Phase 167.1.2.2.2.1 OKXHISTORY plan 05, 2026-10-15): the payload gains the required `reconstructedRanges` (the spans of days rebuilt from the venue's bills archive, read from `series_provenance.reconstructed_ranges`, which feeds the "rebuilt from the OKX archive" line on both surfaces). A v18 entry lacks the field, so for the 1 h TTL drain a rebuilt strategy's page would show no reconstructed line. A provenance write already busts the key through `provenanceKey`; this bump is for the new payload shape.
    // Not a payload-shape bump (Phase 167.1.2.2.2.1 OKXHISTORY review round 1, F5 / IN-01): the payload gained the OPTIONAL `reconstructedRangesUnavailable` (true when `series_provenance.reconstructed_ranges` was present but malformed, so the header says the record is unavailable). v19 is unreleased (main is at v18, so no deployed cache holds a v19 entry), the field is optional, and a v19 entry without it reads as false, the same render as before, so the version stays v19. If v19 ever ships before this phase does, bump to v20 here.
    // Bumped v19→v20 (Phase 190 FACTSHEETQUEUED, 2026-11-03): the payload gains the required `analyticsUpdating`, and a pending or computing row over a stored success result now builds where a v19 entry under the same key holds the withheld null (`unstable_cache` stores it); under v19 that placeholder would outlive the deploy for the 1 h TTL.
    // Bumped v20→v21 (Phase 194 FIGURETRUTH, 2026-11-07, one bump for the phase): the payload gains fields a v20 entry lacks. Plan 04: the `figureRecord` and the figure overlay on the headline scalars. Plan 14: `rollingWindow.annualization` and the `rollingWindow1y` / `strategyRollingVol1y` / `strategyRollingSharpe1y` / `strategyRollingSortino1y` keys (`null` under 365 days). Plan 21: the comparator `jointAnnualization` and `rollingVol1y` / `rollingSharpe1y` / `rollingSortino1y`. Plan 23: `rollingCalendarStats`, which computes those 365-day series from the stored `rolling_metrics` `*_1y` keys the recompute writes. All four ship before any deploy, so one version covers them; under v20 a cached entry would draw the factsheet with no record verdict for the 1 h TTL drain.
    // Bumped v21→v22 (Phase 194.2 FIGURERESIDUALS D-02, 2026-11-10): the values inside `payload.figureRecord` change for a strategy whose series is derived from the stored `returns_series` curve, without a shape change. The curve inversion never emits day 0, so a v21 entry starts the record at the SECOND curve date and prints one day fewer than discovery, the percentile ranks and SQL (193 against 194 on PROD); a v22 build starts it at the stored curve's first point. The key's other members do not move at deploy, so under v21 an entry built before the deploy would keep printing the old N for the 1 h TTL drain.
    // Bumped v22→v23 (Phase 205 ONEVERDICT, 2026-11-10): for the same inputs the payload's values change, without a shape change. The USD view's record verdict now follows the native build's, the stress block is withheld whenever the record is unreadable, and the api arm's `allocatorPortfolios` is null on an unreadable record (it used to throw for an unparseable first date and carried blends for any other unreadable record). The key's other members do not move at deploy, so under v22 an entry built before the deploy would keep serving the old form for the 1 h TTL drain.
    ["factsheet-v2-payload-v23", id, computedAt, tradesFetchedAt ?? "none", provenanceKey, computationStatus],
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
  const { data, error } = await withPublishedOnly(
    supabase
      .from("strategies")
      // Phase 164.6.6.2 plan 07: `data_quality_flags` joins the probe for ONE
      // reason, the share card's cache key below. The same published-only read
      // the OG route itself makes of this column; only the parsed unit leaves
      // this function.
      .select("id, name, codename, description, disclosure_tier, strategy_analytics ( data_quality_flags )")
      .eq("id", id),
  )
    .maybeSingle();
  if (error) {
    captureToSentry(new Error(error.message), {
      tags: { route: "factsheet/[id]/v2/page", stage: "generate-metadata" },
    });
  }
  // Factsheet is a full-identity context: prefer the real name in the
  // <title> tag too, not just the H1. displayStrategyName redacts
  // exploratory-tier names to "Strategy #<hex>", which is correct for
  // Match Queue surfaces but wrong here — and it diverges from the H1
  // the user already sees on the page.
  // Phase 200 / D-11: the rename place states this same name, so both read
  // `publicNamePreview(...).factsheet` rather than two copies of the chain.
  const name = data ? publicNamePreview({
    id: data.id,
    name: data.name,
    codename: data.codename,
    disclosure_tier: data.disclosure_tier as DisclosureTier | null,
  }).factsheet : "Strategy";
  const description = (data?.description ?? "Institutional strategy factsheet on Quantalyze.").slice(0, 200);
  const socialTitle = `${name} — Quantalyze Factsheet`;
  // Dynamic OG image — uses the strategy-id-derived endpoint so social shares
  // get a meaningful preview card without baking PNGs at deploy time.
  //
  // Phase 164.6.6.2 plan 07 (D-12, UI-SPEC D, "the OG cache key must include the
  // unit"): the CDN keeps a card by URL for a day and unfurl caches keep their
  // own copy for longer, so a card rendered before the unit existed must not be
  // served under a URL that looks like a USD one. A unit therefore moves the URL.
  // The route NEVER reads `u` as data; it re-reads the unit from the database,
  // so a hand-edited `?u=` can change which cache entry answers but not what the
  // card says. 194.1 plan 06: every URL also carries `v=OG_CARD_VERSION`, so cards cached before
  // the card's figure rules changed are not answered under the new URL; the route ignores it too.
  const analytics = Array.isArray(data?.strategy_analytics)
    ? data.strategy_analytics[0]
    : data?.strategy_analytics;
  const unit = parseReturnsUnit(
    (analytics?.data_quality_flags as { native_unit?: unknown } | null | undefined)?.native_unit,
  );
  const ogImage = `/api/og/factsheet/${id}?v=${OG_CARD_VERSION}${unit == null ? "" : `&u=${encodeURIComponent(unit)}`}`;
  return {
    title: `${name} factsheet`,
    description,
    // Phase 196 D-07 (LEAN-02): only a PUBLISHED factsheet is indexable. `data`
    // comes from the published-only probe above, so a returned row IS the
    // published proof; a miss and a probe error both leave `data` unusable and
    // stay noindex (fail closed). The owner lane and the share-token route never
    // reach this branch as indexable: the owner's draft misses the probe, and
    // `/factsheet-share/[token]` carries its own noindex.
    //
    // WR-02: the indexable lane also names its one canonical URL, the bare
    // `/factsheet/<id>`, so the `?from=` / `?cat=` / `?share=1` variants the
    // redirects and the share link produce, and the `/v2` alias, do not index
    // as duplicates. No metadataBase is set anywhere, so the URL is absolute on
    // the origin the build asserts as canonical (`assertCanonicalAppUrl`); the
    // noindex lanes carry none.
    ...(data && !error
      ? {
          alternates: {
            canonical: `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/factsheet/${encodeURIComponent(id)}`,
          },
        }
      : { robots: "noindex" as const }),
    openGraph: {
      title: socialTitle,
      description,
      type: "article",
      images: [{ url: ogImage, width: 1200, height: 630, alt: name }],
    },
    twitter: {
      card: "summary_large_image",
      title: socialTitle,
      description,
      images: [ogImage],
    },
  };
}

export default async function FactsheetV2Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  // Optional so a caller that passes only `params` still type-checks. The
  // route's `from` / `cat` origin pair is read only through the closed-set
  // `parseOrigin`, never used as a raw value (196 D-01, T-196-open-redirect).
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const backTarget = backTargetFor(parseOrigin((await searchParams) ?? {}));
  const supabase = await createClient();

  // Lightweight signature probe (id + name + computed_at + computation_status) + the public trust
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
        .select("id, user_id, name, codename, disclosure_tier, strategy_analytics ( computed_at, computation_status, trades_fetched_at, series_provenance )")
        .eq("id", id),
    )
      .maybeSingle(),
    readPublicVerificationSignals([id]),
  ]);

  // TWO-LANE SELECTION (phase 148 / OWN-02). Lane A is the published/cached
  // lane above and is byte-unchanged. Lane B exists ONLY on a Lane A miss: an
  // authenticated owner may read their OWN unpublished strategy, built directly
  // (never through the shared cache — see the header comment: the cache key
  // carries no viewer, only the id, `computed_at` and `computation_status`, so an owner-built entry
  // would be served to anonymous readers for the full TTL).
  //
  // ⛔ LANE ORDER IS LOAD-BEARING. The published probe runs FIRST and the
  // session probe only on its miss, so a public (even authed) view pays no
  // session read BEFORE the lane decision. Hoisting the session read above the
  // Promise.all — e.g. to widen `user`'s scope — reverses that and is
  // forbidden; `ownerUid` below is the scope bridge that makes the hoist
  // unnecessary.
  //
  // Phase 196 (D-01, D-02): the viewer's chrome needs the session on the
  // published lane too, so exactly ONE session read now runs per render,
  // AFTER the lane decision. `sessionUser` carries the answer: the Lane B block
  // below sets it when the published probe missed, and the published render
  // reads it once otherwise (`undefined` = not read yet, `null` = no session).
  // The viewer is a render-prop input only, never a payload field and never a
  // cache-key member (T-196-10).
  let sessionUser: { id: string } | null | undefined = undefined;
  // The published-lane session read, shared by the pending fallback and the
  // full render so both run it AFTER the lane decision and at most once.
  const readViewerSession = async (): Promise<{ id: string } | null> => {
    // SF-01: anonymous is the safe fallback and stays the fallback, but a read
    // that FAILED (anything but the normal no-session answer) is reported, so an
    // approved signed-in reader shown the visitor chrome leaves a Sentry signal.
    try {
      const { data, error } = await supabase.auth.getUser();
      if (error && !isAuthSessionMissingError(error)) {
        captureToSentry(error, { tags: { area: "factsheet-viewer-session", stage: "get-user" } });
      }
      return !error && data?.user != null ? { id: data.user.id } : null;
    } catch (err) {
      console.error("[factsheet/v2/page] viewer session lookup failed:", err);
      captureToSentry(err, { tags: { area: "factsheet-viewer-session", stage: "get-user" } });
      return null;
    }
  };
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
  // Phase 167.2 / KCS-21 — the shape inputs of the owner pending page's remedy
  // (CSV upload, linked key or not), read on the OWNER PROBE only and
  // lane-local for the same reason as the two facts above. `signature` is
  // typed by Lane A's column list, which does not carry them.
  let ownerSource: string | null = null;
  let ownerApiKeyId: string | null = null;
  if (signRes.error || !signature) {
    const {
      data: { user },
      error: ownerProbeAuthError,
    } = await supabase.auth.getUser();
    // SF-01 (round 2): a failed session read is not the normal no-session answer. The
    // 404 below stays (anonymous is the safe direction), but an owner who gets it on an
    // auth blip leaves a Sentry signal, as `readViewerSession` does.
    if (ownerProbeAuthError && !isAuthSessionMissingError(ownerProbeAuthError)) {
      captureToSentry(ownerProbeAuthError, {
        tags: { area: "factsheet-viewer-session", stage: "owner-probe-get-user" },
      });
    }
    sessionUser = user;
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
    // Phase 167.2 / KCS-21 adds `source, api_key_id`, the shape inputs of the
    // owner's pending-page remedy. They are read on THIS probe only (Lane A's
    // list is unchanged) and held lane-locally below, never on the payload.
    const { data: ownRow, error: probeError } = await withPublishedOrOwner(
      supabase
        .from("strategies")
        .select("id, user_id, name, codename, disclosure_tier, status, capital_ownership, source, api_key_id, strategy_analytics ( computed_at, computation_status, trades_fetched_at, series_provenance )")
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
      ownerSource = ownRow.source;
      ownerApiKeyId = ownRow.api_key_id;
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
  // Phase 167.1.2.2.2 (plan 10): the two trade-fact key members, from the same
  // signature probe as `computed_at`, so a tick or a provenance write that does
  // not move `computed_at` still moves the cache key (PATTERNS correction 3).
  const tradesFetchedAtKey: string | null = signAnalytics?.trades_fetched_at ?? null;
  const provenanceKey = provenanceFingerprint(signAnalytics?.series_provenance);
  // 166.3.1 D-05: the row's status is a cache keyPart beside `computed_at`. An
  // absent analytics row or a NULL status keys on a fixed sentinel, never on
  // `undefined`, which JSON would drop from the key.
  const computationStatus = signAnalytics?.computation_status ?? "none";

  // ⛔ The owner arm calls the builder DIRECTLY: no cache read, no cache write.
  // It cannot route through `buildFactsheetPayloadCached` — the effective
  // unstable_cache key carries no viewer (the id, `computed_at` and
  // `computation_status` only, header comment), so an owner-built payload would be served to every subsequent
  // reader of this id and run, anonymous ones
  // included, for the full 3600s TTL. The same applies to a `null`: unstable_cache
  // stores it unconditionally, so a draft that fails to build must not reach the
  // wrapper either. The lambda closes over `ownerUid` (the session id captured in
  // the miss branch above), never over `user`, which is out of scope here.
  //
  // 167.2.1-REVIEW WR-03: the owner arm takes the build's own reason with its
  // payload (`fetchAndBuildPayloadWithReason`, the SAME resolve-and-build), so
  // its S7 share note below needs no second resolve and cannot disagree with
  // the payload.
  const ownerBuild =
    lane === "owner"
      ? await fetchAndBuildPayloadWithReason(id, (q) => withPublishedOrOwner(q, ownerUid!))
      : null;
  // 167.2.1-REVIEW-R2 WR-02: a public build whose admin read failed throws
  // `FactsheetReadError` out of the cache (uncached, see the wrapper). It
  // renders the same public placeholder as any null payload: KCS10's one
  // sentence is true in every state, an outage included, and it is not a 500.
  // The resolve stage has already captured the read error once, with its code,
  // so it is not captured again here. Any other throw stays the error
  // boundary's.
  let publicReadFailed = false;
  let payload: FactsheetPayload | null;
  if (ownerBuild) {
    payload = ownerBuild.payload;
  } else {
    try {
      payload = await buildFactsheetPayloadCached(id, computedAt, tradesFetchedAtKey, provenanceKey, computationStatus);
    } catch (err) {
      // SFH HIGH-1: a degraded build renders its payload, uncached (D-30).
      if (err instanceof FactsheetDegradedBuildError) {
        payload = err.payload;
      } else {
        if (!(err instanceof FactsheetReadError)) throw err;
        publicReadFailed = true;
        payload = null;
      }
    }
  }
  if (!payload) {
    console.warn("[factsheet/v2/page] payload pending -> rendering fallback", {
      id,
      computedAt,
      publicReadFailed,
      hint: "buildFactsheetPayload returned null — check (a) admin client visibility on strategies row, (b) strategy_analytics.daily_returns shape, (c) series clipped to BENCH_START/BENCH_END (2023-04-26 onward) has at least 2 points",
    });
    // The strategy passed the signature gate (published, or the viewer's own
    // draft on the owner lane) but its analytics payload couldn't be built.
    // Render a placeholder rather than hard-404'ing: the computation may be
    // in progress, may have failed, or may never have run (KCS-09 states which
    // on the owner lane; the public lane says one neutral sentence). Hard-404
    // only on the signature gate above.
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

    // Phase 167.2 / KCS-09 — on the OWNER lane, say what is actually happening
    // to this strategy's computation instead of a fixed "still computing". The
    // measured trigger was a composite whose stitch had failed permanently
    // while this page promised a compute that was not coming.
    //
    // ⛔ D-04: the read runs on the REQUEST-scoped client (the RPC is SECURITY
    // DEFINER and auth.uid()-scoped, and it nulls last_error), and its result is
    // a lane-local value handed only to the JSX below, exactly like
    // `ownershipMark` and `hasActiveShare`. It never enters the payload, the
    // builder or the id-keyed cached wrapper. The public lane reads nothing.
    //
    // A read that cannot answer derives `unreadable` (see
    // `readOwnerPendingStatus` at the end of this file), which never renders an
    // in-progress claim. The remedy is keyed on the strategy's SHAPE (KCS-21),
    // so it names only a control this strategy's edit page actually paints.
    const ownerStatus =
      lane === "owner"
        ? await readOwnerPendingStatus(supabase, signature.id, {
            source: ownerSource,
            apiKeyId: ownerApiKeyId,
          })
        : null;
    // Phase 167.2.1 (D-05, D-06) — the S7 share note is derived the way the
    // /strategies list derives it: the builder's own resolve stage says why
    // this payload is null, and the same selection rule and error mapping pick
    // the note. 167.2.1-REVIEW WR-03: that reason is the one the build above
    // already produced, so nothing is resolved twice (IN-04, the two sequential
    // reads, goes with it). It is lane-local like `ownerStatus` and never
    // reaches the payload or the cached wrapper.
    const ownerBuildability =
      ownerBuild && ownerBuild.reason !== null
        ? ownerBuildabilityOf(id, ownerBuild.reason, {
            analyticsFailed: ownerBuild.analyticsFailed,
            // 170.1 D-08 / R-1: jobs that finished without a built factsheet
            // give the banner the body's instruction (finished_not_built)
            // instead of a "once a computation succeeds" wait that will not
            // end. A running or pending job keeps the arm-derived note.
            jobsFinished: ownerStatus?.state.state === "finished",
          })
        : null;
    // 167.2.1-REVIEW-R2 WR-03: the state line is about the compute JOBS, the
    // share note about the owner BUILD. When the build could not read the row,
    // KCS09-FINISHED ("could not be built from its results") would claim a
    // build outcome the page never learned, beside a note that says it could
    // not check. The build's facts go to the copy module so that line becomes
    // KCS09-FINISHED-UNREADABLE with the read-again remedy.
    //
    // 164.6.6.3.3 D-08: the same facts object carries `analyticsFailed`, set
    // only when the build's own resolve stage read `computation_status` as
    // `failed`, so KCS09-FINISHED becomes KCS09-FINISHED-ANALYTICS-FAILED. A
    // boolean from the build result: the lane's gate and every `select` are
    // unchanged.
    const ownerBuildFacts = {
      buildUnreadable: ownerBuildability?.unreadable === true,
      analyticsFailed:
        ownerBuild !== null && ownerBuild.reason !== null && ownerBuild.analyticsFailed === true,
    };
    // Phase 199 plan 18 (SC-4): a failed or stalled line names the day of the last attempt,
    // taken from the same factsheet job the state was derived from (`readOwnerPendingStatus`).
    const ownerLine =
      ownerStatus &&
      ownerStateLine(ownerStatus.state, ownerBuildFacts, ownerStatus.jobDay);
    const ownerRemedyLine =
      ownerStatus &&
      ownerRemedy(ownerStatus.state, ownerStatus.shape, signature.id, ownerBuildFacts);
    // Phase 164.6.6.3.5 (AD-05): the remedy's "contact form" phrase links the
    // support topic with this strategy's id. Same tab: this page holds no
    // unsaved state.
    const supportContactHref = contactHref({
      topic: "support",
      strategy: signature.id,
    });
    // Phase 196 (ROUTE-02, D-02): the pending page carries the chrome on both
    // lanes (WR-01), so a reader whose payload is not built yet still has a way
    // back and a next step: the viewer bar for a signed-in reader (the owner lane
    // always holds a session), the visitor header for one with no session. The
    // published lane reads its session here, after the lane decision.
    if (sessionUser === undefined) sessionUser = await readViewerSession();
    const pendingViewer = await resolveFactsheetViewer(
      supabase as unknown as SupabaseClient,
      sessionUser,
      signature.user_id,
    );
    return (
      <>
      {pendingViewer.kind === "signed_in" ? (
        <ViewerBar backTarget={backTarget} viewer={pendingViewer} strategyId={signature.id} />
      ) : (
        <VisitorHeader showSignUp />
      )}
      {/* Phase 196 (LEAN-02, ROUTE-04): the page renders its own `<main>`. It lived in
          `v2/layout.tsx` until this phase, but `/factsheet/[id]` re-exports this page
          without that layout, so the canonical route had no main landmark. The chrome
          above is a `<header>` banner and stays outside it; the `/v2` alias gets its
          one main from this element too, so the layout is gone. */}
      <main>
      {/* `data-testid="factsheet-pending"` is the marker the LP report PDF route reads to tell a
          factsheet that is not built yet (a 409 there, retrying cannot help) from an error or
          not-found render (a 503). It is on no other render, and not on a failed read: that one
          can clear on retry, so it must reach the PDF route's retryable 503 (R3-01). */}
      <article
        data-testid={publicReadFailed ? undefined : "factsheet-pending"}
        className="mx-auto max-w-[760px] px-4 sm:px-6 lg:px-10 py-12"
      >
        {/* WR-02: the owner lane's placeholder must carry the visibility
            notice too — a still-computing draft shows its real name and reads
            like a soon-to-be-live factsheet, and the pending state is when an
            owner is MOST likely to share the URL. Same exported component as
            the full render (single-sourced UI-SPEC copy), first child so the
            disclosure precedes any document content (UI-SPEC:97). */}
        {lane === "owner" && (
          <OwnerUnpublishedPanel
            strategyId={signature.id}
            hasActiveShare={hasActiveShare}
            // KCS-12 (S7): what a recipient of the private link sees right
            // now. This lane is reachable only for an UNPUBLISHED strategy,
            // so the share mode is always mint-token.
            // 167.2.1-REVIEW-SFH H-2 (D-06: the list's mapping): when the
            // build could not read the row, what a recipient sees is not
            // known, so the note says the check failed rather than claiming a
            // placeholder, exactly as /strategies does for a failed probe.
            shareNote={
              ownerStatus
                ? ownerBuildability?.unreadable
                  ? probeUnreadableShareNote("mint-token")
                  : recipientShareNoteFor(
                      "mint-token",
                      recipientArm(ownerStatus.state),
                      ownerBuildability?.kind ?? null,
                    )
                : undefined
            }
          />
        )}
        <p className="text-fixed-10 font-mono uppercase tracking-[0.22em] text-text-muted">
          Institutional Factsheet · Quantalyze
        </p>
        <h1 className="mt-2 font-serif text-fixed-28 sm:text-fixed-36 leading-tight text-text-primary">
          {pendingName}
        </h1>
        {ownerLine && ownerRemedyLine ? (
          // KCS-09: one state line and one remedy line, read together. The
          // remedy is an instruction, not an aside, so it is not italic.
          <section
            aria-label="Computation status"
            data-degrade-id={
              OWNER_STATE_ENTRY[ownerStateKind(ownerStatus!.state, ownerStatus!.jobDay)]
            }
          >
            <p
              className={
                "mt-6 text-fixed-13 " + STATE_LINE_TONE_CLASS[ownerLine.tone]
              }
            >
              {ownerLine.text}
            </p>
            <p className="mt-3 text-fixed-12 text-text-muted">
              <ContactPointerText text={ownerRemedyLine.before} href={supportContactHref} />
              {ownerRemedyLine.link && (
                <Link
                  href={ownerRemedyLine.link.href}
                  className="text-accent underline underline-offset-4"
                >
                  {ownerRemedyLine.link.text}
                </Link>
              )}
              <ContactPointerText text={ownerRemedyLine.after} href={supportContactHref} />
            </p>
          </section>
        ) : (
          // KCS-10 (S8) and criterion 9 (phase 164.2): the PUBLIC lane reads
          // no job state, so it says one neutral sentence that is true in
          // every state and promises no timing. It names no gate and no
          // internal state: a visitor has no developer console, and the gate
          // detail stays in the `console.warn` hint above, which is the
          // developer's channel.
          // Phase 199 plan 18 (D-04): registered as `factsheet.public-pending` (class recipient):
          // the shipped sentence, then the one action a visitor has.
          <DegradeLine
            id="factsheet.public-pending"
            element="p"
            className="mt-6 text-fixed-13 text-text-secondary"
            segments={degradeSegments("factsheet.public-pending", undefined)}
          />
        )}
      </article>
      </main>
      </>
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
  // 164.6.6.2.1 review CR-02: `withTrustTier` is that same spread, and it also
  // reaches `usdView.payload` (built with a null tier like its parent), so the
  // tier does not vanish when the viewer toggles to the USD view.
  const payloadWithTrust: FactsheetPayload = withTrustTier(payload, trustTier);

  // Phase 196 plan 16 (LEAN-02): the tear sheet's peer-relative ranks, on the PUBLISHED lane only.
  // ⛔ Read here, per request, AFTER the cached build and never inside the `unstable_cache`
  // callback: `getPercentiles` uses the request client and its answer moves with the cohort, so a
  // cached copy would serve every later reader of this id a stale or another request's cohort.
  // Started now and awaited after the viewer decisions below so it overlaps them; `readPeerRanks`
  // never rejects (a failed read is null and reported). The owner lane, the share-token route and
  // the allocator mounts carry none, and the JSON-LD below is built from `payloadWithTrust`, so it
  // is unchanged.
  const peerRanksRead: Promise<PeerRanks | null> =
    lane === "owner" ? Promise.resolve(null) : readPeerRanks(supabase as unknown as SupabaseClient, id);

  // 194 D-22: AUM follows D-06 on the public factsheet. Only a signed-in allocator or the
  // strategy's own manager sees the AUM chip, and the JSON-LD (which a crawler reads
  // anonymously) carries it only for them. Decided per request here, never on the cached
  // payload. The roles lookup is asked only when the strategy has an AUM at all, so the common
  // no-AUM render pays nothing for it; it reuses this request's client and the one
  // server-validated `getUser()` below, and fails closed. The owner lane is the owner by construction (`ownerUid`).
  //
  // Phase 196: the session is read ONCE per render and shared by the viewer
  // chrome and this decision. The Lane B block already holds it when the
  // published probe missed; otherwise it is read here, after the lane decision
  // and the payload build, so the published-first lane order is untouched.
  if (sessionUser === undefined) sessionUser = await readViewerSession();
  const viewer = await resolveFactsheetViewer(
    supabase as unknown as SupabaseClient,
    sessionUser,
    signature.user_id,
  );
  let showAum = false;
  if (payloadWithTrust.aum != null) {
    if (lane === "owner") {
      showAum = true;
    } else {
      showAum = await canViewAum(supabase, sessionUser?.id ?? null, signature.user_id, "[factsheet/v2/page]");
    }
  }

  const payloadForView: FactsheetPayload =
    lane === "owner" ? payloadWithTrust : withPeerRanks(payloadWithTrust, await peerRanksRead);

  // Phase 196 (D-05, OQ-6): what renders between the document and its footer.
  // A reader with no session gets the sign-up line. A signed-in viewer on the
  // published lane gets their OWN note card, read exactly as the retired
  // /strategy/[id] page read it (same request client, same three filters, RLS on
  // `user_notes` unchanged). The owner's unpublished lane gets neither.
  //
  // ⛔ A failed read OMITS the card. A card seeded with an empty note is one the
  // viewer can type into and save over the note they already wrote, so a missing
  // card (recoverable on reload) is the safe failure, never an empty one. Both
  // values are render props built here, never payload fields (T-196-10).
  let beforeFooterSlot: ReactNode = undefined;
  if (viewer.kind === "anon") {
    beforeFooterSlot = <SignUpLine />;
  } else if (lane === "public") {
    try {
      const { data: noteRow, error: noteError } = await supabase
        .from("user_notes")
        .select("content, updated_at")
        .eq("user_id", viewer.userId)
        .eq("scope_kind", "strategy")
        .eq("scope_ref", signature.id)
        .maybeSingle();
      if (noteError) {
        console.error("[factsheet/v2/page] strategy note read failed:", noteError);
        captureToSentry(noteError, {
          tags: { route: "factsheet/v2/page", stage: "user-note" },
        });
      } else {
        beforeFooterSlot = (
          <div className="factsheet-v2-no-print mt-12">
            <StrategyNoteCard
              strategyId={signature.id}
              initialContent={(noteRow?.content as string | undefined) ?? ""}
              initialLastSavedAt={noteRow?.updated_at ? new Date(noteRow.updated_at as string) : null}
            />
          </div>
        );
      }
    } catch (err) {
      console.error("[factsheet/v2/page] strategy note read threw:", err);
      captureToSentry(err, { tags: { route: "factsheet/v2/page", stage: "user-note" } });
    }
  }

  // JSON-LD FinancialProduct schema — helps Google + LLMs identify the page
  // as a structured financial-product listing. Content is server-built and
  // JSON-stringified; we additionally escape `</` to defang any name/desc
  // value attempting to close the embedded script tag.
  // 194 plan 16: the object is built by the pure `buildFactsheetJsonLd` (src/lib/factsheet/json-ld.ts),
  // which gates `interestRate` on the record verdict; the `</` escaping stays here.
  const jsonLd = buildFactsheetJsonLd(payloadWithTrust, { showAum });
  const jsonLdStr = JSON.stringify(jsonLd).replace(/</g, "\\u003c");

  return (
    <>
      <script type="application/ld+json">{jsonLdStr}</script>
      {/* The chrome is chosen from the session, so a signed-in viewer is never
          shown "Sign up" (ROUTE-02) and a reader with no session gets no owner
          or allocator action. Render props only, never the payload. */}
      {viewer.kind === "signed_in" ? (
        <ViewerBar backTarget={backTarget} viewer={viewer} strategyId={id} />
      ) : (
        <VisitorHeader showSignUp />
      )}
      {/* The notice is derived from the LANE decision, never from a payload
          field — lane state must not enter the object the shared public cache
          serves (UI-SPEC:112). */}
      {/* Phase 150 / OWN-03 — another lane-derived render prop, threaded exactly
          like `viewerNotice` above and for the same reason: it must not enter
          the object the shared public cache serves.

          `lane === "owner"` is reachable only when the published probe MISSED and
          the owner-inclusive probe hit with a non-published status — i.e. the row
          is unpublished AND owned by this session. (Phase 200 D-09: the factsheet
          no longer offers `Rename…`; the edit page is the one rename place.) */}
      <main>
      <FactsheetView
        payload={withViewerAum(payloadForView, showAum)}
        // 194 D-22 — a per-request render prop like the lane props below: the cached payload
        // carries `aum` for everyone, and this viewer decision is what shows the chip.
        showAum={showAum}
        viewerNotice={lane === "owner" ? "owner_unpublished" : undefined}
        ownershipMark={lane === "owner" ? ownershipMark : undefined}
        // Phase 164 / SHARE-04 — a lane-derived render prop under the same
        // rule as the ones above. Its PRESENCE is the "this row is unpublished and
        // the session owns it" half of the share predicate (the owner lane is
        // reachable only in that state),
        // and `hasActiveShare` is the "a link is live right now" half. Absent on
        // every other mount, so the published `?share=1` lane is byte-identical
        // (D-09) and the recipient/scenario mounts are untouched.
        ownerShare={lane === "owner" ? { hasActiveShare } : undefined}
        beforeFooterSlot={beforeFooterSlot}
      />
      </main>
    </>
  );
}

/**
 * Phase 167.2 / KCS-09 + KCS-21 — the owner pending page's two facts: the
 * strategy's compute state and its shape. Called only from the owner `!payload`
 * branch above (a function declaration, hoisted), so neither read runs on the
 * full render or on the public lane.
 *
 * Both reads use the REQUEST-scoped client: the compute jobs through the
 * owner-scoped SECURITY DEFINER RPC (it resolves auth.uid() from the session
 * and returns last_error as NULL), and the member head count under the
 * `strategy_keys_owner` policy. A module-level function rather than inline in
 * the page: the server clock is read here (`nowMs`), never in the component.
 *
 * ⛔ error-absent ≠ legit-absent (Rule 12). An RPC error, an answer that is not
 * a rows array, or a throw (a client with no rpc member included) derives
 * `unreadable`; a member count that cannot be read leaves the shape
 * `unknown`, so no control is guessed. Each is logged server-side, and none
 * derives an in-progress state.
 */
async function readOwnerPendingStatus(
  supabase: Awaited<ReturnType<typeof createClient>>,
  strategyId: string,
  shapeInputs: { source: string | null; apiKeyId: string | null },
): Promise<{
  state: ComputeState;
  shape: StrategyShape | "unknown";
  /** Phase 199 plan 18: the last attempt's UTC day (`YYYY-MM-DD`), or null when no job could be read. */
  jobDay: string | null;
}> {
  let shape: StrategyShape | "unknown" = "unknown";
  try {
    const [jobsRead, memberCount] = await Promise.all([
      // 167.2-REVIEW-SFH M-5: the shared bounded read (re-asks once at the RPC
      // cap when the first window is full of non-chain rows). A throw lands in
      // the catch below. Precondition (SFH L-3): the owner lane is reached only
      // with a resolved session user, so an empty answer is not a missing one.
      readOwnerComputeJobs(supabase as unknown as SupabaseClient, strategyId),
      // The generated types predate `strategy_keys`; the cast is type-only and
      // RLS still applies to this request client (see strategy-shape.ts).
      countCompositeMembers(supabase as unknown as SupabaseClient, strategyId),
    ]);
    if (!memberCount.ok) {
      console.error("[factsheet/v2/page] strategy-shape read failed", {
        id: strategyId,
        message: memberCount.message,
      });
      captureToSentry(new Error(memberCount.message), {
        tags: { route: "factsheet/v2/page", stage: "strategy-shape" },
      });
    }
    // 167.2-REVIEW-SFH M-7: the same cross-check the edit page makes, so the
    // remedy never names a link control the edit page withholds.
    // 167.2-REVIEW-R2 CR-01: through the SAME history read the edit page uses
    // (`readOwnerCompositeHistory`, which re-asks at the RPC cap when the job
    // read at hand is not exhaustive and holds no stitch), reusing that job
    // read. It runs only where the history decides anything: a zero count,
    // no linked key, not CSV. It never throws.
    let compositeHistory: CompositeHistory = "none";
    if (
      shapeInputs.source !== "csv" &&
      memberCount.ok &&
      memberCount.count === 0 &&
      !shapeInputs.apiKeyId
    ) {
      const history = await readOwnerCompositeHistory(
        supabase as unknown as SupabaseClient,
        strategyId,
        jobsRead,
      );
      compositeHistory = history.history;
      // SFH-R2 R2-M2: a history that is not "none" leaves the shape
      // "unknown". A failed job read is captured below as `compute-state`
      // (the same fault); every other case is captured here.
      if (history.message !== null && jobsRead.ok) {
        console.error("[factsheet/v2/page] composite history is not clean; no control is named", {
          id: strategyId,
          history: history.history,
          message: history.message,
        });
        captureToSentry(new Error(history.message), {
          tags: { route: "factsheet/v2/page", stage: "composite-history" },
        });
      }
    }
    shape = resolveStrategyShape({
      source: shapeInputs.source,
      apiKeyId: shapeInputs.apiKeyId,
      memberCount,
      compositeHistory,
    });
    if (!jobsRead.ok) {
      const readFailure = { code: jobsRead.code, message: jobsRead.message };
      console.error("[factsheet/v2/page] compute-state read failed", {
        id: strategyId,
        code: readFailure.code,
        message: readFailure.message,
      });
      captureToSentry(readFailure, {
        tags: { route: "factsheet/v2/page", stage: "compute-state" },
      });
      return { state: deriveComputeState({ readError: true }), shape, jobDay: null };
    }
    if (jobsRead.windowFull) {
      // Deterministic, and "reload" cannot fix it, so it is logged and
      // captured as its own case rather than folded silently into unreadable.
      console.error("[factsheet/v2/page] compute-state window full", {
        id: strategyId,
        rows: jobsRead.rows.length,
      });
      captureToSentry(
        new Error("compute job window full at the RPC cap with no factsheet-chain job"),
        { tags: { route: "factsheet/v2/page", stage: "compute-state-window-full" } },
      );
    }
    // 167.2-REVIEW IN-03: an old stitch answers only while the strategy
    // has members (or the count could not be read).
    // 167.2-REVIEW-R2 IN-05: and a zero count drops it only for a proven
    // single-key strategy (linked key, or no stitch on record).
    const preferStitch = shouldPreferStitch({
      apiKeyId: shapeInputs.apiKeyId,
      memberCount,
      compositeHistory,
    });
    const nowMs = Date.now();
    return {
      state: deriveComputeState({
        rows: jobsRead.rows,
        readExhaustive: jobsRead.readExhaustive,
        nowMs,
        preferStitch,
      }),
      shape,
      // Phase 199 plan 18 (SC-4): the day of the SAME factsheet job the state was derived from
      // (the selection `deriveComputeState` makes, with the same inputs), as the strategies list
      // does. Null when there is no such job or its stamp does not parse.
      jobDay: lastAttemptDay(selectFactsheetJob(jobsRead.rows, { preferStitch, nowMs })),
    };
  } catch (err) {
    console.error("[factsheet/v2/page] compute-state read failed", {
      id: strategyId,
      code: undefined,
      message: err instanceof Error ? err.message : String(err),
    });
    captureToSentry(err, {
      tags: { route: "factsheet/v2/page", stage: "compute-state" },
    });
    return { state: deriveComputeState({ readError: true }), shape, jobDay: null };
  }
}

/**
 * Phase 167.2.1 (D-05, D-06) — why the owner lane's payload is null, in the
 * two facts the S7 share note needs: an unbuildable note kind, and whether the
 * answer is unreadable. Called only from the owner `!payload` branch above, so
 * the public lane and the full owner render never ask.
 *
 * 167.2.1-REVIEW WR-03: the reason is the one the owner build itself produced
 * (`fetchAndBuildPayloadWithReason`), not a second resolve, so the old race
 * arms (`buildable: true` on a null payload, SFH M-5) cannot occur.
 * `too_few_points` and `composite_unbuildable` give their D-02 kind;
 * `not_computed` keeps today's arm-derived note. `read_error` and
 * `not_visible` are unreadable, exactly as on /strategies (D-05), and since
 * 167.2.1-REVIEW-SFH H-2 an unreadable answer renders the "could not check"
 * line (`probeUnreadableShareNote`), never a recipient-view claim. The resolve
 * stage itself logs and captures a `read_error`, once, with its code
 * (167.2.1-REVIEW-SFH M-2), so it is not captured a second time here.
 * `not_visible` is logged with the id and captured with tags only: this lane
 * passed the owner signature gate, so an admin read finding no row under the
 * same predicate is a race or a predicate mismatch. A builder THROW is outside
 * this function's domain: the page's error handling owns it.
 */
function ownerBuildabilityOf(
  id: string,
  reason: NotBuildableReason,
  detail?: Pick<NotBuildableDetail, "analyticsFailed"> & { jobsFinished?: boolean },
): { unreadable: boolean; kind: UnbuildableNoteKind | null } {
  if (reason === "read_error") return { unreadable: true, kind: null };
  if (reason === "not_visible") {
    console.error("[factsheet/v2/page] owner build found no row under the owner predicate", {
      id,
      reason,
    });
    captureToSentry(new Error(`factsheet owner build answered ${reason}`), {
      tags: { route: "factsheet/v2/page", stage: "factsheet-owner-build" },
    });
    return { unreadable: true, kind: null };
  }
  return { unreadable: false, kind: unbuildableNoteKindOf(reason, detail) };
}
