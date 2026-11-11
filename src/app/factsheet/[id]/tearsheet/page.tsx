import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFactsheetDetail, getPercentiles, readPublicVerificationSignals } from "@/lib/queries";
import { displayStrategyName } from "@/lib/strategy-display";
import { ANALYTICS_ONLY_TEXT } from "@/components/ui/Disclaimer";
import { buttonClassName } from "@/components/ui/Button";
import { ManagerIdentityPanel } from "@/components/strategy/ManagerIdentityPanel";
import { PeerRanksSection } from "@/components/strategy/PeerRanksSection";
import { PrintButton } from "@/components/ui/PrintButton";
import { createClient } from "@/lib/supabase/server";
import { formatDay } from "@/lib/utils";
import { canViewAum, withViewerAum } from "@/lib/factsheet/viewer-aum";
import { fetchAndBuildPayloadWithReason } from "@/lib/factsheet/fetch-and-build-payload";
import { DegradeLine } from "@/components/degrade/DegradeLine";
import { degradeSegments } from "@/lib/degrade-warnings";
import { withTrustTier } from "@/lib/factsheet/with-trust-tier";
import { buildFactsheetHref } from "@/lib/factsheet/origin";
import type { TrustTierKind } from "@/lib/factsheet/types";
import { withPublishedOnly } from "@/lib/visibility";
import { FactsheetView } from "../v2/FactsheetView";

const PLATFORM_NAME = process.env.NEXT_PUBLIC_PLATFORM_NAME ?? "Quantalyze";

// Pin to dynamic rendering. The disclosure-tier redaction depends on the
// per-request authentication state (cookies → supabase.auth.getUser()).
// A future caching PR or `use cache` wrapper that introduced
// `revalidate > 0` here would be a fail-open vulnerability: an
// authenticated-rendered HTML response (full institutional identity) could
// be cached and served to anonymous visitors. force-dynamic mirrors the
// /discovery/layout.tsx pin that gates the rest of the disclosure-tier
// system on attestation.
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const result = await getFactsheetDetail(id);
  // Visibility fact (Phase 201 D-17): `getFactsheetDetail` reads published-only
  // (`withPublishedOnly`), so every row it returns is visible in discovery and the
  // title prints the same name discovery prints.
  const name = result ? displayStrategyName(result.strategy, { visible: true }) : "Strategy";
  return {
    title: `${name} institutional tear sheet`,
    robots: "noindex",
  };
}

/**
 * Institutional-lane tear sheet = the factsheet's PRINT VIEW (Phase 196 D-03,
 * LEAN-02, LEAN-05). Print-first layout (8.5 × 11 portrait, 1" margins ≈ 6.5 × 9"
 * of content). Primary user flow is `window.print()`. The PDF wrapper at
 * `/api/factsheet/[id]/tearsheet.pdf` renders this same page with Puppeteer for an
 * emailable version.
 *
 * ONE DATA PATH, ONE LAYOUT. The opening view (masthead, KPI strip with its one
 * note, equity curve with drawdown, Main metrics table) is the factsheet's own
 * `FactsheetView` in `printView`, fed by the SAME payload builder the factsheet's
 * published lane uses, so a figure, a label and a gate cannot differ between the
 * two. Advanced never renders here. After the opening view come the tear sheet's own
 * kept blocks, in this order: the Generated date line, the peer-relative ranks, the
 * manager identity panel, the contact block, and the Risk Disclosure as the page's
 * one disclaimer. Every figure the HEAD tear sheet printed has a named home (see
 * 196-13-SUMMARY.md).
 *
 * Two redaction layers cooperate to keep institutional identity off the
 * exploratory-tier panel:
 *
 *   1. `getFactsheetDetail()` only loads manager identity when the
 *      strategy's `disclosure_tier === 'institutional'`. Exploratory-tier
 *      strategies always come back with `manager = null`.
 *   2. This page (since audit-2026-05-07 C-0189) downgrades the effective
 *      tier to `exploratory` for unauthenticated callers, so the
 *      institutional identity loaded in (1) is never rendered to anonymous
 *      traffic — see the SECURITY GATE block below.
 *
 * SECURITY GATE (audit-2026-05-07 C-0189, red-team closure 2026-05-17):
 * The tearsheet route lives in `PUBLIC_ROUTES` (src/proxy.ts) so cap-intro
 * partners can open a tearsheet link without a login redirect. That
 * intentional public access means an unauthenticated visitor could
 * otherwise harvest institutional bio / years_trading / aum_range /
 * linkedin via this surface — bypassing the /discovery/* attestation gate
 * that exists precisely to wall off institutional disclosure from
 * anonymous traffic. To close the bypass without breaking the cap-intro
 * flow, we downgrade the rendered tier to `exploratory` for any caller
 * who is NOT both logged in AND has a row in `investor_attestations` —
 * exactly the predicate enforced by /discovery/layout.tsx. Anonymous
 * traffic, brand-new accounts, strategy managers logged into their own
 * console, and link recipients who haven't signed the attestation all see
 * the pseudonymous-manager card (it names the strategy, never the manager).
 * Performance metrics stay public (they're also on the non-tearsheet
 * factsheet). Admins are auto-attested
 * via migration 20260408113028 backfill, so the founder sees institutional
 * identity during demos. The PDF wrapper at
 * /api/factsheet/[id]/tearsheet.pdf inherits this fix automatically
 * because Puppeteer fetches this page without session cookies, putting
 * every PDF in the anonymous-redacted lane.
 *
 * Variable naming invariant (red-team C-9, 2026-05-17): the gate predicate
 * is named `isAttested`, NOT `isAuthenticated`. An auth-only gate is a
 * half-closure — it blocks anonymous visitors but exposes institutional
 * identity to any logged-in-but-never-attested user. Future edits MUST
 * keep the variable name aligned with the enforcement (logged in AND row
 * in `investor_attestations`) so the comment can't drift past the code.
 */
export default async function TearSheetPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Kept (not replaced by the payload): the manager identity for the panel, the
  // disclosure tier, the owner id the AUM gate compares against, and the category slug
  // the peer ranks are scoped to (`strategy.discovery_categories?.slug`, as before).
  // The factsheet payload carries none of these.
  const result = await getFactsheetDetail(id);

  // A missing, unpublished or not-yet-computed strategy is a 404, never a 200 text page.
  if (!result || !result.analytics) notFound();

  // Authoritative gate — must match /discovery/layout.tsx (the other
  // disclosure-tier wall) so the public tearsheet route can't be used to
  // bypass the accredited-investor attestation that /discovery/* enforces.
  //
  //   1. getUser() validates the JWT server-side (unlike getSession()
  //      which only reads the cookie). Anonymous callers → user == null.
  //   2. If logged in, require a row in `investor_attestations` with a
  //      non-null `attested_at`. Admins are backfilled by migration
  //      20260408113028 so they pass implicitly.
  //
  // We tolerate ALL read errors as "not attested" (fail-closed default:
  // a Supabase blip should redact, never leak). The try/catch + the
  // explicit `isAttested = false` initialization are load-bearing — a
  // future refactor that destructures differently (or a typo) must not
  // silently open the leak again. Run AFTER getFactsheetDetail so the
  // 404 path skips this lookup.
  let isAttested = false;
  // 194 D-06 (T-194-12): AUM is shown ONLY to a signed-in allocator or to the
  // strategy's own manager. Default false; every failure path leaves it false and
  // the row is absent from the DOM (no placeholder). The per-viewer page stays
  // `force-dynamic`, and the cookie-less PDF render is anonymous, so it never
  // carries the row.
  let showAum = false;
  // The server-validated user id from the one `getUser()` below; null for anonymous.
  let viewerId: string | null = null;
  // Hoisted so the AUM gate below shares this request's client.
  let supabase: Awaited<ReturnType<typeof createClient>> | null = null;
  try {
    supabase = await createClient();
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (!userError && userData?.user != null) {
      viewerId = userData.user.id;
      const { data: attestation, error: attError } = await supabase
        .from("investor_attestations")
        .select("attested_at")
        .eq("user_id", userData.user.id)
        .maybeSingle();
      if (!attError && attestation?.attested_at != null) {
        isAttested = true;
      }
    }
  } catch (err) {
    console.error("[tearsheet] attestation lookup failed:", err);
    // Stay redacted — the safer default.
  }

  // D-06: the AUM gate. A separate try so an attestation-lookup failure never
  // decides AUM and an AUM-lookup failure never decides attestation. Reuses the
  // request-scoped client and `getUser()` (JWT validated server-side), never
  // `getSession()`. Ownership compares the server-read user id to the id on the
  // server-read strategy row (T-194-14): no client input is involved.
  if (supabase) {
    showAum = await canViewAum(supabase, viewerId, result.strategy.user_id, "[tearsheet]");
  }

  const { strategy, manager, disclosureTier } = result;
  // For non-attested callers (anonymous OR logged-in-but-unattested), force
  // the panel into the exploratory (redacted) lane regardless of the
  // strategy's actual disclosure tier. This is the C-0189 closure:
  // institutional identity is never rendered to anonymous or unattested
  // traffic from the public tearsheet route — mirroring /discovery/*.
  const effectiveDisclosureTier = isAttested ? disclosureTier : "exploratory";
  const effectiveManager = isAttested ? manager : null;
  // Same published-only fact as `generateMetadata`: `getFactsheetDetail` (and the
  // `withPublishedOnly` payload read below) only return a published strategy, which
  // discovery shows under its real name (Phase 201 D-09, D-17).
  const displayName = displayStrategyName(strategy, { visible: true });
  const categorySlug: string | undefined =
    (strategy as { discovery_categories?: { slug?: string } | null }).discovery_categories?.slug ??
    undefined;

  // The factsheet's own payload, built exactly as its published lane builds it:
  // `fetchAndBuildPayloadWithReason` directly (never the id-keyed cached wrapper, whose
  // key carries no viewer), published-only on the service-role client, then the trust
  // tier overlaid per request. The reason says what a null payload means (SF-04): only a
  // strategy that is not visible is a 404; a failed read goes to the error boundary (the
  // resolve stage has already reported it); every other reason is a fact about a row
  // that is not built yet and gets the pending state the factsheet shows.
  const [built, verificationSignals, percentileMap] = await Promise.all([
    fetchAndBuildPayloadWithReason(id, withPublishedOnly),
    readPublicVerificationSignals([id]),
    getPercentiles(categorySlug),
  ]);
  if (built.payload === null) {
    if (built.reason === "not_visible") notFound();
    if (built.reason === "read_error") throw new Error("tearsheet payload read failed");
    return (
      <main className="mx-auto max-w-2xl px-6 py-16" data-testid="tearsheet-pending">
        <h1 className="font-serif text-fixed-28 leading-tight text-text-primary">{displayName}</h1>
        {/* Phase 199 plan 18 (D-04): the factsheet's own public pending sentence, registered
            (`factsheet.public-pending`, class recipient): the shipped KCS10 wording, then the one
            action a visitor has. */}
        <DegradeLine
          id="factsheet.public-pending"
          element="p"
          className="mt-6 text-fixed-13 text-text-secondary"
          segments={degradeSegments("factsheet.public-pending", undefined)}
        />
        <Link
          href={buildFactsheetHref(id)}
          className={buttonClassName({ variant: "secondary", size: "md", className: "mt-6" })}
        >
          Back to factsheet
        </Link>
      </main>
    );
  }
  const builtPayload = built.payload;
  const rawTrustTier = verificationSignals.get(id)?.trust_tier ?? null;
  const trustTier: TrustTierKind | null =
    rawTrustTier === "api_verified" || rawTrustTier === "csv_uploaded" || rawTrustTier === "self_reported"
      ? rawTrustTier
      : null;
  const payload = withTrustTier(builtPayload, trustTier);

  // Phase 201 D-11: the one UI date, read in UTC so the server render and the printed PDF agree.
  const generated = formatDay(new Date().toISOString());

  // Phase 201 D-24 (folding D-16): the exchange-API monitoring sentence is true only of an
  // api_verified record. A CSV upload or a self-reported series is not monitored through an
  // exchange API, so every other tier (and a missing one) states custody alone. Mirrors the
  // `Disclaimer` `strategy-page` tier rule.
  const custodyClause =
    trustTier === "api_verified"
      ? "Strategies are monitored via read-only exchange APIs; managers retain asset custody."
      : "Managers retain asset custody.";

  return (
    // `id="tearsheet-main"` is the positive marker of the FULL tear sheet: the pending,
    // not-found and error renders do not carry it, and `tearsheet.pdf` refuses to print a
    // page without it (R2-01), so an error or placeholder page is never cached as a PDF.
    <main
      id="tearsheet-main"
      className="tearsheet mx-auto my-0 bg-white text-text-primary print:m-0 print:p-0"
    >
      <style>{`
        /* Screen: wide enough for the factsheet's own two-column opening view.
           Print: Letter portrait, 1" (96px) margins, 6.5" of content. */
        @page {
          size: Letter portrait;
          margin: 1in;
        }
        .tearsheet {
          width: 100%;
          max-width: 72rem;
          padding: 1rem;
          font-family: var(--font-dm-sans), sans-serif;
        }
        @media print {
          .tearsheet {
            max-width: none;
            padding: 0;
          }
          .print\\:hidden { display: none !important; }
        }
        .tearsheet section {
          page-break-inside: avoid;
        }
      `}</style>

      {/* The factsheet's opening view in print form: no ControlBar, no Advanced,
          no footer stamp. The AUM chip follows 194 D-22 through the same two calls
          the factsheet makes, and the payload handed down is the stripped copy. */}
      <FactsheetView payload={withViewerAum(payload, showAum)} showAum={showAum} printView />

      <p className="mb-6 mt-2 text-caption text-text-muted">Generated {generated}</p>

      {/* Peer-relative ranks: the same getPercentiles source, the same 194 gate, the
          record read from the payload (one record, one verdict). */}
      <PeerRanksSection
        percentiles={percentileMap?.[strategy.id] ?? null}
        categoryLabel={categorySlug}
        record={payload.figureRecord ?? null}
      />

      {/* Manager identity (non-attested callers see the redacted exploratory block — see SECURITY GATE comment above) */}
      <section className="mb-6">
        <ManagerIdentityPanel
          disclosureTier={effectiveDisclosureTier}
          manager={effectiveManager}
          strategyName={displayName}
        />
      </section>

      {/* Contact: the tear sheet's own copy, left-aligned under a hairline with no
          accent tint (UI-SPEC closing-line treatment). It carries only the display
          name the H1 shows: no manager identity and no AUM. The link is screen-only. */}
      <section className="mb-6 border-t border-border pt-4">
        <p className="text-caption font-semibold text-text-primary">
          Interested in {displayName}?
        </p>
        <p className="mt-1 text-caption text-text-secondary">
          Request an introduction through {PLATFORM_NAME}. The manager will be
          notified and will respond directly.
        </p>
        <Link
          href={buildFactsheetHref(strategy.id)}
          className="mt-2 inline-block text-caption text-accent underline underline-offset-4 print:hidden"
        >
          Open the factsheet
        </Link>
      </section>

      {/* Risk disclosure */}
      <section className="mb-2 border-t border-border pt-4">
        <h2 className="mb-2 text-sm font-semibold text-text-primary">Risk Disclosure</h2>
        <p className="text-fixed-10 text-text-muted leading-relaxed">
          Past performance does not guarantee future results. Cryptocurrency
          trading involves substantial risk of total loss. This tear sheet is
          for informational purposes only and does not constitute investment,
          legal, or tax advice. {custodyClause} {ANALYTICS_ONLY_TEXT} Read the
          full risk disclaimer at{" "}
          <Link
            href="/legal/disclaimer"
            className="underline hover:text-text-primary"
          >
            /legal/disclaimer
          </Link>
          .
        </p>
      </section>

      {/* Screen-only controls — hidden in print/PDF output. Primary last, rightmost. */}
      <div className="mt-6 flex flex-wrap items-center gap-2 print:hidden">
        <Link
          href={buildFactsheetHref(id)}
          className={buttonClassName({ variant: "secondary", size: "md" })}
        >
          Back to factsheet
        </Link>
        <PrintButton />
        <a
          href={`/api/factsheet/${id}/tearsheet.pdf`}
          target="_blank"
          className={buttonClassName({ variant: "primary", size: "md" })}
        >
          Download PDF
        </a>
      </div>
    </main>
  );
}
