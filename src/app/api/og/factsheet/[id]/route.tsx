import { ImageResponse } from "next/og";
import { createClient } from "@/lib/supabase/server";
import { withPublishedOnly } from "@/lib/visibility";
import { computeOgHeadline } from "@/lib/factsheet/og-metrics";
// Phase 147 / SCEN-01 — the LEAF import. `resolveDailyReturnSeries` lives in
// its own module precisely so this route (and the public share page) can share
// the ONE series-resolution mechanism without dragging in the factsheet
// build-payload graph on every unfurl hit.
import { resolveDailyReturnSeries } from "@/lib/factsheet/resolve-series";

/**
 * Dynamic OG card for the v2 factsheet. Renders strategy name + headline
 * Sharpe / CAGR / Max DD as an institutional-looking 1200×630 PNG so
 * social shares (Slack, LinkedIn, Twitter) get a meaningful preview.
 *
 * Renders even if analytics aren't ready — falls back to name-only.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The `strategy_analytics` embed shape this card reads (PostgREST returns an
 *  object for a to-one embed and an array for a to-many one — both handled). */
type AnalyticsEmbed = { daily_returns?: unknown; returns_series?: unknown };

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  let data: {
    id?: string;
    name?: string | null;
    codename?: string | null;
    description?: string | null;
    asset_class?: string | null;
    strategy_analytics?: AnalyticsEmbed | AnalyticsEmbed[] | null;
  } | null = null;
  try {
    const supabase = await createClient();
    const res = await withPublishedOnly(
      supabase
        .from("strategies")
        .select(
          // Phase 147 / SCEN-01: `returns_series` joins the embed. The
          // analytics-service writes the cumprod equity curve there and leaves
          // `daily_returns` NULL (CSV ingest only), so reading `daily_returns`
          // alone rendered the BLANK card — name, then three em-dashes — for
          // every service-computed strategy on every social unfurl. Disclosure
          // is unchanged: withPublishedOnly below still gates the read, so the
          // column is only ever read for a published row, and the raw series
          // never leaves the server (the response is an image).
          "id, name, codename, description, asset_class, strategy_analytics ( daily_returns, returns_series )",
        )
        .eq("id", id),
    )
      .maybeSingle();
    data = res.data ?? null;
  } catch (err) {
    // Log for production debugging; OG image still renders with the fallback.
    // (deliberately doesn't throw — broken OG image must not 500 the deploy)
    console.error("[og:factsheet] failed to load strategy", id, err);
  }

  const name = data?.name ?? data?.codename ?? "Strategy";
  const description = (data?.description ?? "").slice(0, 140);

  // Quick headline metrics from the daily-returns array, computed via the
  // extracted pure helper (og-metrics.ts) so we don't pull the full
  // buildFactsheetPayload heavy path on every OG hit — and so the clock/gate
  // semantics are unit-tested in isolation. Wrap in try/catch — schema drift
  // (analytics column becomes object instead of array) must not 500 the route,
  // per the promise made above.
  let sharpe = NaN;
  let cagr = NaN;
  let maxDd = NaN;
  try {
    // The embed unwrap stays — this route reads strategy_analytics as an EMBED
    // (unlike the lazy-returns route, which queries the table directly).
    const analytics = Array.isArray(data?.strategy_analytics)
      ? data.strategy_analytics[0]
      : (data?.strategy_analytics as AnalyticsEmbed | null | undefined);
    // Phase 147 / SCEN-01 — resolve through the ONE shared mechanism instead of
    // the old array-shape gate plus hand-rolled row coercion. It strictly
    // subsumes both: it normalizes all three stored `daily_returns` shapes
    // (array / flat dict / nested year-keyed record), validates every point,
    // AND falls back to differencing the `returns_series` wealth curve when the
    // daily column is null. That fallback is the fix — the old gate tested the
    // daily column for array-ness, a null column failed it, and the metrics
    // were never computed at all, so the card rendered blank.
    const rows = resolveDailyReturnSeries(
      analytics?.daily_returns,
      analytics?.returns_series,
    );
    // Two points is the floor for any of the three metrics to mean anything
    // (computeOgHeadline enforces its own stricter gates above that and returns
    // NaN — the "—" sentinel — when they are not met).
    if (rows.length >= 2) {
      ({ sharpe, cagr, maxDd } = computeOgHeadline(rows, data?.asset_class));
    }
  } catch (err) {
    console.error("[og:factsheet] headline metric compute failed", id, err);
  }

  const fmtPct = (x: number) => (Number.isFinite(x) ? `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%` : "—");
  const fmtNum = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : "—");

  const response = new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#F8F9FA",
          padding: 64,
          display: "flex",
          flexDirection: "column",
          fontFamily: "sans-serif",
          color: "#1A1A2E",
        }}
      >
        <div style={{ fontSize: 18, letterSpacing: 4, textTransform: "uppercase", color: "#64748B" }}>
          Quantalyze · Institutional Factsheet
        </div>
        <div style={{ marginTop: 24, fontSize: 80, fontWeight: 700, lineHeight: 1, fontFamily: "serif" }}>
          {name}
        </div>
        {description && (
          <div style={{ marginTop: 16, fontSize: 22, lineHeight: 1.3, color: "#4A5568", maxWidth: 1000 }}>
            {description}
          </div>
        )}
        <div style={{ marginTop: 48, display: "flex", gap: 56 }}>
          <Stat label="Sharpe" value={fmtNum(sharpe)} />
          <Stat label="CAGR" value={fmtPct(cagr)} tone={cagr >= 0 ? "pos" : "neg"} />
          <Stat label="Max DD" value={fmtPct(maxDd)} tone="neg" />
        </div>
        <div style={{ marginTop: "auto", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 18, color: "#64748B" }}>quantalyze.xyz</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#1B6B5A", fontSize: 18, letterSpacing: 2 }}>
            <div style={{ width: 12, height: 12, background: "#1B6B5A", borderRadius: 2 }} />
            verified
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
  // OG card is amortised across many unfurl hits (LinkedIn, Slack, Twitter
  // each fetch on share). 1h browser TTL + 24h CDN TTL with stale-while-
  // revalidate so a refresh after computed_at change picks up the new card
  // within the SWR window without stampeding the underlying compute.
  response.headers.set(
    "Cache-Control",
    "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
  );
  return response;
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "pos" | "neg" }) {
  const color = tone === "pos" ? "#15803D" : tone === "neg" ? "#DC2626" : "#1A1A2E";
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ fontSize: 16, letterSpacing: 3, textTransform: "uppercase", color: "#64748B" }}>
        {label}
      </div>
      <div style={{ marginTop: 8, fontSize: 56, fontWeight: 700, color, fontFamily: "monospace" }}>
        {value}
      </div>
    </div>
  );
}
