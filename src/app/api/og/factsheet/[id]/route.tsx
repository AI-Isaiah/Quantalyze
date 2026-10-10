import { ImageResponse } from "next/og";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { captureToSentry, shouldCaptureNow } from "@/lib/sentry-capture";
import { withPublishedOnly } from "@/lib/visibility";
import { computeOgHeadline } from "@/lib/factsheet/og-metrics";
import { isComputedAnalytics } from "@/lib/closed-sets";
// Phase 147 / SCEN-01 — the LEAF import. `resolveDailyReturnSeries` lives in
// its own module precisely so this route (and the public share page) can share
// the ONE series-resolution mechanism without dragging in the factsheet
// build-payload graph on every unfurl hit.
import {
  curveMethodFromFlags,
  resolveDailyReturnSeries,
} from "@/lib/factsheet/resolve-series";
// Phase 164.6.6.2 plan 07 (D-12) — the one validator and label composer every
// unit surface shares.
import { parseReturnsUnit, withUnit } from "@/lib/factsheet/returns-unit";
// Phase 164.6.6.3.3 (B7, B8, D-07): the sign and the tone of CAGR and Max DD come
// from the value rounded to the printed precision, so a dash or a rounded zero is
// never printed with a sign nor coloured.
import { formatSignedPercent, formatUnsignedPercent, percentTone } from "@/lib/factsheet/display-sign";

/**
 * Dynamic OG card for the v2 factsheet. Renders strategy name + headline
 * Sharpe / CAGR / Max DD as an institutional-looking 1200×630 PNG so
 * social shares (Slack, LinkedIn, Twitter) get a meaningful preview.
 *
 * Renders even if analytics aren't ready — falls back to name-only.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A healthy card, or a genuine not-found: amortised across many unfurl hits. */
const LONG_CACHE_CONTROL = "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800";
/** Review round 1 SFH-02: a card rendered from a FAILURE is never cached, so
 *  the next unfurl retries instead of freezing the failure for a day at the
 *  CDN (the precedent is the BTC benchmark route's `ERROR_CACHE_CONTROL`). */
const FAILURE_CACHE_CONTROL = "no-store";

/** Log a failure, then report it to Sentry after the response (throttled per
 *  stage, so an incident does not burn the quota). Never throws: a broken OG
 *  image must not 500 the route. */
function reportOgFailure(stage: "read" | "compute", id: string, err: unknown): void {
  console.error(`[og:factsheet] ${stage} failed`, id, err);
  try {
    if (shouldCaptureNow(`og-factsheet:${stage}`)) {
      after(() =>
        captureToSentry(err, {
          tags: { route: "api/og/factsheet", stage },
          extra: { strategy_id: id },
        }),
      );
    }
  } catch {
    // Scheduling the capture failed; the console.error above still stands.
  }
}

/** The `strategy_analytics` embed shape this card reads (PostgREST returns an
 *  object for a to-one embed and an array for a to-many one — both handled).
 *  STALE-01 widened it by `computation_status` — see the gate at the compute.
 *  169.4.1 OGSHARPE widened it by the stored `cagr` / `sharpe` / `max_drawdown`,
 *  and review round 1 (CR-01) by `data_quality_flags`. Round 2 (SFH-R2-01) widened
 *  it by `metrics_json_by_basis` and the four stored scalars the page's headline
 *  also needs, so the card asks the page's own applicability question. */
type AnalyticsEmbed = {
  daily_returns?: unknown;
  returns_series?: unknown;
  computation_status?: unknown;
  cagr?: unknown;
  sharpe?: unknown;
  max_drawdown?: unknown;
  data_quality_flags?: unknown;
  metrics_json_by_basis?: unknown;
  cumulative_return?: unknown;
  volatility?: unknown;
  sortino?: unknown;
  calmar?: unknown;
};

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
  // SFH-02: set on any failure path, so the card is sent no-store (see below).
  let failed = false;
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
          // STALE-01: `computation_status` joins the embed. It is the ONLY
          // column that distinguishes a series belonging to a run that
          // FINISHED from one left behind by a run that failed — every
          // `IS NOT NULL` test passes on both. Read-only widening of a
          // published row's projection; nothing new leaves the server (this
          // response is a PNG).
          // Phase 169.4.1 OGSHARPE (SC4, D-10): the stored `cagr`, `sharpe` and
          // `max_drawdown` join the embed, so the card shows the values the
          // factsheet headline and every list show instead of a recomputation.
          // They are already public on the discovery projection; nothing new
          // leaves the server.
          // Review round 1 (CR-01): `data_quality_flags` joins the embed. On a
          // chain-broken row the stored `cagr` covers only the suffix after the
          // break, so computeOgHeadline hides it (see its docblock). Read-only;
          // the flags never leave the server (this response is a PNG).
          // Round 2 (SFH-R2-01): `metrics_json_by_basis`, `cumulative_return`,
          // `volatility`, `sortino` and `calmar` join the embed, so the card can
          // ask the page's own question (is the stored cash headline applicable?)
          // and withhold a chain-broken row the page withholds. Same published-
          // gated read of the same row; the columns are already public on the
          // factsheet page and never leave the server (this response is a PNG).
          "id, name, codename, description, asset_class, strategy_analytics ( daily_returns, returns_series, computation_status, cumulative_return, volatility, cagr, sharpe, sortino, calmar, max_drawdown, data_quality_flags, metrics_json_by_basis )",
        )
        .eq("id", id),
    )
      .maybeSingle();
    // SFH-02: supabase-js does not throw on a query error, it returns
    // `{ data: null, error }`. Without this check a statement timeout or a
    // column error rendered the generic card as if the row were not found.
    // A genuine not-found (`data === null`, `error === null`) is not a failure.
    if (res.error) {
      failed = true;
      reportOgFailure("read", id, res.error);
    }
    data = res.data ?? null;
  } catch (err) {
    // OG image still renders with the fallback.
    // (deliberately doesn't throw — broken OG image must not 500 the deploy)
    failed = true;
    reportOgFailure("read", id, err);
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
  // Phase 164.6.6.2 plan 07 (D-12, T-164.6.6.2-22): the unit this card's CAGR is
  // in. It comes from the row's own `data_quality_flags.native_unit`, through the
  // one validator, and from NOTHING the caller sent: the page links the card as
  // `?u=<unit>` purely so the CDN does not answer a BTC strategy with a card
  // cached before the unit existed (see the factsheet page's `ogImage`), and
  // this route never reads that param. A malformed value parses to null and
  // renders the USD card. Assigned inside the try below, so a bad read still
  // cannot 500.
  let unit: string | null = null;
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
    unit = parseReturnsUnit(
      (analytics?.data_quality_flags as { native_unit?: unknown } | null | undefined)
        ?.native_unit,
    );
    const rows = resolveDailyReturnSeries(
      analytics?.daily_returns,
      analytics?.returns_series,
      // 164.6.6.2.2 D-05: the curve is read by the row's own method.
      curveMethodFromFlags(analytics?.data_quality_flags),
    );
    // STALE-01 — the SERIES is a job output too, so a run that did not finish
    // leaves the previous run's track sitting in these columns and nothing
    // about the array says which run wrote it. This card recomputes Sharpe /
    // CAGR / Max DD from that array IN-ROUTE, so the ranked-list shaper never
    // sees it; the gate has to live here.
    //
    // ⚠️ It matters more here than anywhere else in this fix, for two reasons.
    // The response carries `s-maxage=86400, stale-while-revalidate=604800`, so
    // one render of a dead figure is served from CDN for a day and revalidated
    // against for a week — long after the row is fixed. And its readers are
    // Slack / LinkedIn / Twitter unfurl caches, which keep their own copy and
    // show it to people who never open the page and never see a correction.
    //
    // Not computing is ALREADY this card's designed answer to "analytics
    // aren't ready" — the docblock says so and `fmtNum` and the display-sign formatters render the
    // NaN sentinel as "—". A non-terminal row is the same answer to the same
    // question, so it reuses the same path: name + description + three
    // em-dashes. No new layout, no error card, and the route still cannot 500.
    const computationStatus =
      typeof analytics?.computation_status === "string"
        ? analytics.computation_status
        : null;
    const analyticsComputed = isComputedAnalytics(computationStatus);
    // Two points is the floor for any of the three metrics to mean anything
    // (computeOgHeadline returns NaN — the "—" sentinel — for a figure it cannot
    // support).
    // Phase 169.4.1 OGSHARPE (SC4, D-10, D-25): the stored scalars travel with
    // the status, so a rankable row shows its PERSISTED figures, the values the
    // factsheet shows (164.6.6.3.3 D-06), with CAGR's two named exceptions
    // (computeOgHeadline's docblock); only a key the embed did not carry falls
    // back to the computation, and a stored null hides.
    if (analyticsComputed && rows.length >= 2) {
      // SFH-R2-01: the embed row itself, so a key PostgREST did not answer is
      // ABSENT from it (the page's `missing_keys` gate reads presence), not
      // undefined-valued as a picked literal would make it.
      ({ sharpe, cagr, maxDd } = computeOgHeadline(rows, data?.asset_class, analytics));
    }
  } catch (err) {
    failed = true;
    reportOgFailure("compute", id, err);
  }

  const fmtNum = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : "—");

  // CAGR: signed, tone from the rounded value. Max DD: unsigned, and only a real
  // (rounded below zero) drawdown is `neg`; a drawdown is never "good", so it has
  // no positive tone. NaN and rounded zeros carry no tone (D-07).
  const cagrTone = percentTone(cagr, 1);
  const maxDdTone = percentTone(maxDd, 1);

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
          {unit == null
            ? "Quantalyze · Institutional Factsheet"
            : `Quantalyze · Institutional Factsheet · Returns in ${unit}`}
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
          <Stat
            label={withUnit("CAGR", unit)}
            value={formatSignedPercent(cagr, 1)}
            tone={cagrTone === "positive" ? "pos" : cagrTone === "negative" ? "neg" : undefined}
          />
          <Stat
            label="Max DD"
            value={formatUnsignedPercent(maxDd, 1)}
            tone={maxDdTone === "negative" ? "neg" : undefined}
          />
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
  // SFH-02: a card rendered from a failed read or a failed compute is sent
  // no-store instead, so one bad request is not served for a day.
  response.headers.set("Cache-Control", failed ? FAILURE_CACHE_CONTROL : LONG_CACHE_CONTROL);
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
