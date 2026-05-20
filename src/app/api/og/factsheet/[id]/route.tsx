import { ImageResponse } from "next/og";
import { createClient } from "@/lib/supabase/server";

/**
 * Dynamic OG card for the v2 factsheet. Renders strategy name + headline
 * Sharpe / CAGR / Max DD as an institutional-looking 1200×630 PNG so
 * social shares (Slack, LinkedIn, Twitter) get a meaningful preview.
 *
 * Renders even if analytics aren't ready — falls back to name-only.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  let data: {
    id?: string;
    name?: string;
    codename?: string;
    description?: string | null;
    strategy_analytics?: { daily_returns?: unknown } | { daily_returns?: unknown }[] | null;
  } | null = null;
  try {
    const supabase = await createClient();
    const res = await supabase
      .from("strategies")
      .select(
        "id, name, codename, description, strategy_analytics ( daily_returns )",
      )
      .eq("id", id)
      .eq("status", "published")
      .maybeSingle();
    data = res.data ?? null;
  } catch (err) {
    // Log for production debugging; OG image still renders with the fallback.
    // (deliberately doesn't throw — broken OG image must not 500 the deploy)
    console.error("[og:factsheet] failed to load strategy", id, err);
  }

  const name = data?.name ?? data?.codename ?? "Strategy";
  const description = (data?.description ?? "").slice(0, 140);

  // Quick headline metrics from the daily-returns array, computed inline so
  // we don't pull the full buildFactsheetPayload heavy path on every OG hit.
  // Wrap in try/catch — schema drift (analytics column becomes object instead
  // of array) must not 500 the route, per the promise made above.
  let sharpe = NaN;
  let cagr = NaN;
  let maxDd = NaN;
  try {
    const analytics = Array.isArray(data?.strategy_analytics)
      ? data.strategy_analytics[0]
      : (data?.strategy_analytics as { daily_returns?: unknown } | null | undefined);
    const dailyRaw = analytics?.daily_returns;
    if (Array.isArray(dailyRaw)) {
      const values: number[] = dailyRaw
        .map(d => Number((d as { value?: unknown } | null)?.value))
        .filter(v => Number.isFinite(v));
      // Sharpe only needs ~30 obs to be meaningful; CAGR requires ≥252 since
      // annualizing a 30-day return × 8.4 ships nonsense on social cards.
      if (values.length >= 30) {
        const m = values.reduce((a, x) => a + x, 0) / values.length;
        const v = values.reduce((a, x) => a + (x - m) ** 2, 0) / values.length;
        const s = Math.sqrt(v);
        sharpe = s > 0 ? (m * 252) / (s * Math.sqrt(252)) : NaN;
        let cum = 1;
        let peak = 1;
        let dd = 0;
        for (const r of values) {
          cum *= 1 + r;
          if (cum > peak) peak = cum;
          const cur = cum / peak - 1;
          if (cur < dd) dd = cur;
        }
        maxDd = dd;
        // CAGR only when we have a full year — and when cum stayed positive.
        if (values.length >= 252 && cum > 0) {
          cagr = Math.pow(cum, 252 / values.length) - 1;
        }
      }
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
          <div style={{ fontSize: 18, color: "#64748B" }}>quantalyze.com</div>
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
