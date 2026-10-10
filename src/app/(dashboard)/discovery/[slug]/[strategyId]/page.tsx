import { Breadcrumb } from "@/components/layout/Breadcrumb";
import { RequestIntroButton } from "@/components/strategy/RequestIntroButton";
import { BookIntroCall } from "@/components/strategy/BookIntroCall";
import { ShareableLink } from "@/components/strategy/ShareableLink";
import { AddToPortfolio } from "@/components/portfolio/AddToPortfolio";
import { FactsheetView } from "@/app/factsheet/[id]/v2/FactsheetView";
import { DISCOVERY_CATEGORIES } from "@/lib/constants";
import { getStrategyDetail } from "@/lib/queries";
import { displayStrategyName } from "@/lib/strategy-display";
import { KCS10_PUBLIC_SENTENCE } from "@/lib/status-surface-copy";
import { createClient } from "@/lib/supabase/server";
import { fetchAndBuildPayloadWithReason } from "@/lib/factsheet/fetch-and-build-payload";
import type { FactsheetPayload, TrustTierKind } from "@/lib/factsheet/types";
import { withTrustTier } from "@/lib/factsheet/with-trust-tier";
import { withPublishedOnly } from "@/lib/visibility";
import { notFound, redirect } from "next/navigation";

/**
 * 169-REVIEW-SFH H-3: what this page says when a factsheet series read FAILS.
 * KCS-10's "not available yet" describes the row as not ready, which is false
 * for an outage: the row may be fine and the next request reads again. Active
 * voice with the owner lane's retry remedy (KCS09-UNREADABLE, "Reload this
 * page to try again."). The public v2 lane has no counterpart: it renders
 * KCS-10 on a `read_error` by design, so this sentence lives here, next to its
 * one caller.
 *
 * Phase 169.1 plan 01 (D-81): the outage is now named by the SHARED resolve
 * stage, as the `read_error` reason `fetchAndBuildPayloadWithReason` returns
 * (a failed admin read of the strategy row, or a failed `csv_daily_returns`,
 * MTM, smoothed MTM or stored cash series read). The resolve stage also
 * captures a build's `read_error` once (`seriesReadError`), so this page
 * captures nothing itself: a second capture here would double-report.
 */
const SERIES_READ_FAILED_SENTENCE =
  "We could not load this strategy's factsheet right now. Reload this page to try again.";

export default async function StrategyDetailPage({
  params,
}: {
  params: Promise<{ slug: string; strategyId: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { slug, strategyId } = await params;
  const cat = DISCOVERY_CATEGORIES.find((c) => c.slug === slug);
  // Audit 2026-05-07 G11.E.7: unknown slug → 404 immediately. Avoids
  // even firing the strategy fetch for slugs not on the published list.
  if (!cat) notFound();

  // Audit 2026-05-07 G11.E.7: pass the slug to getStrategyDetail so the
  // `discovery_categories!inner(slug)` filter rejects strategy/slug
  // mismatches at the SQL layer (returns null → not-found UI). Without
  // this, /discovery/<wrong-slug>/<strategyId> renders the full chart
  // suite + RSC payload for any published strategy.
  // Phase 169.1 plan 01 (D-26): this read serves the header, the breadcrumb,
  // `disclosureTier`, the slug guard, the published gate and the trust tier.
  // The factsheet itself is built below by the shared path, so the default
  // projection is enough; the discovery-only projection it used to request
  // existed only for the assembly that plan removed.
  const result = await getStrategyDetail(strategyId, slug);
  if (!result) notFound();

  const { strategy, disclosureTier } = result;
  // Breadcrumb still uses the pseudonym-safe label (it shows in the
  // sidebar context above the factsheet). The factsheet body itself is a
  // full-identity context and uses the real name when present.
  const breadcrumbName = displayStrategyName(strategy);
  const factsheetName =
    strategy.name ?? strategy.codename ?? breadcrumbName;
  const displayName = factsheetName;

  // Phase 169.1 plan 01 (D-23 as amended 2026-09-25, D-25, D-26, D-81): the
  // factsheet is built by the ONE shared resolve-and-build, the same uncached
  // call the v2 factsheet page's lanes make, so every number here (CAGR,
  // Sharpe, the BTC block, the record length) is the number that path
  // produces, and nothing on this page can drift from it. It is never the v2
  // page's id-keyed cached wrapper: this page was uncached and stays so.
  // `withPublishedOnly` is passed explicitly (the parameter is REQUIRED): this
  // page shows published strategies only, to every signed-in viewer, the
  // owner included. A null payload carries the resolve stage's reason;
  // `read_error` is an outage and says so, every other reason is a row that
  // cannot build and says KCS-10.
  const built = await fetchAndBuildPayloadWithReason(strategy.id, withPublishedOnly);
  // The trust tier is overlaid after the build, exactly as the v2 page
  // overlays it (`payloadWithTrust`): the shared builder passes null, and the
  // tier comes from the published-gated verification signal `getStrategyDetail`
  // already read. The spread keeps the `ingestSource` discriminant.
  // 164.6.6.2.1 review CR-02: `withTrustTier` also reaches `usdView.payload`, so
  // the tier survives the toggle to the USD view.
  const factsheetPayload: FactsheetPayload | null = built.payload
    ? withTrustTier(built.payload, (strategy.trust_tier ?? null) as TrustTierKind | null)
    : null;
  const seriesReadFailed = built.reason === "read_error";

  return (
    <>
      <Breadcrumb
        items={[
          { label: "Discovery", href: "/discovery/crypto-sma" },
          { label: cat?.name ?? slug, href: `/discovery/${slug}` },
          { label: breadcrumbName },
        ]}
      />
      <div className="mb-4 flex flex-wrap items-center justify-end gap-3">
        {/* Phase 164 (SHARE-04) — `published` is a literal true here, and that
            is a claim this page can actually make: `getStrategyDetail` wraps its
            query in `withPublishedOnly` and returns null otherwise, so an
            unpublished strategy `notFound()`s above and never reaches this JSX.
            The projection deliberately omits `status` (see the comment on
            `getStrategyDetail`), so reading `strategy.status` here would yield
            `undefined` and fail CLOSED into the mint lane — a token link for a
            strategy that already has a public URL. Behaviour is unchanged; the
            site now consumes the same component contract as the other two,
            which is the whole point of the task. */}
        <ShareableLink strategyId={strategy.id} published variant="primary" />
        {disclosureTier === "institutional" && (
          <a
            href={`/factsheet/${strategy.id}/tearsheet`}
            target="_blank"
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-page transition-colors"
          >
            Tear Sheet
          </a>
        )}
        <AddToPortfolio strategyId={strategy.id} />
        <BookIntroCall strategyName={displayName} />
        <RequestIntroButton strategyId={strategy.id} />
      </div>

      {factsheetPayload ? (
        <FactsheetView payload={factsheetPayload} />
      ) : (
        <article className="mx-auto max-w-[760px] px-4 sm:px-6 lg:px-10 py-12">
          <p className="text-micro font-mono uppercase tracking-[0.22em] text-text-muted">
            Institutional Factsheet · Quantalyze
          </p>
          <h1 className="mt-2 font-serif text-page-title leading-tight text-text-primary">
            {displayName}
          </h1>
          {/* Phase 167.2 review-fix (167.2-REVIEW WR-01): the one KCS-10
              sentence, imported from where it is authored, so this surface and
              the v2 public lane cannot diverge. The sentence it replaces
              promised a compute that may never come (a failed chain, or a
              series that cannot build, does not resolve on its own) and named
              an internal pipeline to allocators (phase 164.2 criterion 9). */}
          <p className="mt-6 text-small text-text-secondary">
            {seriesReadFailed ? SERIES_READ_FAILED_SENTENCE : KCS10_PUBLIC_SENTENCE}
          </p>
        </article>
      )}

      <div className="fixed bottom-0 left-0 right-0 md:left-[260px] z-10 border-t border-border bg-white/95 backdrop-blur-sm px-6 py-3 flex items-center justify-between">
        <p className="text-sm text-text-secondary hidden sm:block">
          Interested in{" "}
          <span className="font-medium text-text-primary">{displayName}</span>?
        </p>
        <RequestIntroButton strategyId={strategy.id} />
      </div>
    </>
  );
}
