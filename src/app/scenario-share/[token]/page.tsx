// SECURITY BOUNDARY:
// This is a PUBLIC, sessionless route. The ONLY Supabase read here is the
// token-scoped `get_shared_scenario` SECURITY DEFINER RPC, which self-scopes on
// `token_hash + revoked_at IS NULL` and returns ONLY name/draft/schema_version +
// the draft's addedStrategies[].id PUBLISHED series. The admin client is used
// purely as transport (service_role) — the RPC is the gate. NEVER add a query
// that reads an arbitrary id, NEVER call the allocator-dashboard query helper,
// and NEVER read holdings / AUM / api_keys / portfolios on this page. The
// recipient sees the scenario in return / percentage form only, never an
// allocator identity.

import { notFound } from "next/navigation";
import { headers } from "next/headers";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  publicIpLimiter,
  checkLimit,
  getClientIp,
} from "@/lib/ratelimit";
import { hashShareToken } from "@/lib/scenario-share-token";
import { computeStrategyCurve, type DailyPoint } from "@/lib/scenario";
import { methodologyLine } from "@/lib/scenario-history";
import { formatPercent, formatNumber } from "@/lib/utils";
import { Card } from "@/components/ui/Card";
import { EmptyStateCard } from "@/components/ui/EmptyStateCard";
import { CorrelationHeatmap } from "@/components/portfolio/CorrelationHeatmap";
import {
  EquityChart,
  toWealth,
} from "@/app/(dashboard)/allocations/widgets/performance/EquityChart";
import { ScenarioBenchmarkSection } from "@/app/(dashboard)/allocations/components/ScenarioBenchmarkSection";
import {
  resolveSharedScenario,
  type SharedScenarioRow,
} from "./share-resolve";

// DO NOT cache at the edge. Shared caches are keyed on the URL, not the token's
// revocation state. A cached response could be replayed after the token is
// revoked (Plan 25-03 sets `revoked_at`), resurrecting a dead link. The RPC's
// `revoked_at IS NULL` predicate makes a revoke immediate; `force-dynamic`
// guarantees no ISR/edge cache outlives that write so the next load 404s.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

/** Fetch the public BTC daily-return series for the benchmark overlay. The
 *  route is shared market data and stays cacheable — we do NOT add no-store to
 *  it. A failed / empty fetch degrades the benchmark section to its honest
 *  "unavailable" empty state ([] → benchmarkAvailable=false), never an error. */
async function fetchBtcDaily(): Promise<DailyPoint[]> {
  try {
    const res = await fetch(`${APP_URL}/api/benchmark/btc`);
    if (!res.ok) return [];
    const json = (await res.json()) as unknown;
    if (!Array.isArray(json)) return [];
    return json.filter(
      (p): p is DailyPoint =>
        p !== null &&
        typeof p === "object" &&
        typeof (p as DailyPoint).date === "string" &&
        typeof (p as DailyPoint).value === "number" &&
        Number.isFinite((p as DailyPoint).value),
    );
  } catch {
    return [];
  }
}

export default async function ScenarioSharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // 1. LIMIT FIRST — reject scrapers cheaply BEFORE any DB/crypto work
  //    (demo-pdf precedent; limiter-ordering PUBLIC_IP_EXCEPTION). A misconfig
  //    fails closed in production. We render a neutral "try again" state rather
  //    than a 404 so the rate-limit response does not leak token existence.
  const hdrs = await headers();
  const ip = getClientIp(hdrs);
  const rl = await checkLimit(publicIpLimiter, `scenario-share:${ip}`);
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

  // 2. Hash the URL token in Node (Plan 25-02) and look it up through the
  //    leak-scoped RPC via the service_role transport client (Plan 25-01).
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("get_shared_scenario", {
    p_token_hash: hashShareToken(token),
  } as never);

  // 3. No row (unknown / revoked / cross-tenant) → notFound(). Identical 404
  //    for every miss — no oracle distinguishing revoked from never-existed.
  if (error) {
    // Never echo a DB error to the recipient (schema/column leak). A transient
    // RPC failure 404s like any other miss; the detail is logged server-side.
    console.error("[scenario-share/page] get_shared_scenario error", {
      message: (error as { message?: string }).message,
    });
    notFound();
  }
  const rows = (data ?? []) as SharedScenarioRow[];
  const row = rows[0];
  if (!row) {
    notFound();
  }

  // 4. Public BTC benchmark series (cacheable — NOT no-store). 5. Resolve.
  const btcDaily = await fetchBtcDaily();
  const resolved = resolveSharedScenario(row, btcDaily);

  // DI-23-01 — a version-ahead / undecodable / dangling-ref draft is honest
  // absence, NEVER a live-book substitution and NEVER a 404 (the link IS valid).
  if (resolved.kind === "honest-absence") {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16">
        <EmptyStateCard
          heading="This shared scenario can't be displayed"
          body="The link is valid, but this scenario was saved in a newer format we can't show here."
        />
      </main>
    );
  }

  const { name, metrics, portfolioDaily, strategyNames } = resolved;
  const btcAvailable = btcDaily.length > 0;

  // EquityChart needs cumulative-WEALTH form (start ~1.0). The engine's
  // `equity_curve` is cumulative RETURN (0.18 = +18%); convert via `+1` then
  // brand with toWealth (24-RESEARCH / Pitfall 1). The benchmark overlay is the
  // BTC wealth curve (computeStrategyCurve), shown when the series is available.
  const scenarioWealth = toWealth(
    metrics.equity_curve.map((p) => ({ date: p.date, value: p.value + 1 })),
  );
  const btcWealth = btcAvailable ? computeStrategyCurve(btcDaily) : undefined;

  // KPI strip — RETURN / PERCENTAGE form only. No USD, no AUM. Null/non-finite
  // metrics render the em-dash "—" via the shared formatters (never a 0).
  const kpis: Array<{ label: string; value: string }> = [
    { label: "Total return", value: formatPercent(metrics.twr) },
    { label: "CAGR", value: formatPercent(metrics.cagr) },
    { label: "Volatility", value: formatPercent(metrics.volatility) },
    { label: "Sharpe", value: formatNumber(metrics.sharpe) },
    { label: "Sortino", value: formatNumber(metrics.sortino) },
    { label: "Max drawdown", value: formatPercent(metrics.max_drawdown) },
    { label: "Avg |ρ|", value: formatNumber(metrics.avg_pairwise_correlation) },
  ];

  return (
    <main className="mx-auto max-w-4xl px-4 py-12">
      {/* Header — scenario NAME only (Instrument Serif). NEVER the allocator
          identity. Persistent PROJECTED framing directly beneath. */}
      <header className="border-b border-border pb-6">
        <h1 className="font-serif text-[28px] leading-tight text-text-primary md:text-4xl">
          {name}
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span
            data-testid="scenario-projected-badge"
            className="inline-flex items-center rounded-sm border border-text-muted px-2 py-0.5 text-[10px] uppercase tracking-wide font-semibold text-text-muted"
          >
            PROJECTED — hypothetical, not a live book
          </span>
        </div>
        <p className="mt-2 text-sm text-text-secondary">
          Shared scenario · PROJECTED — hypothetical, not a live book
        </p>
        <p className="mt-1 text-xs text-text-muted">{methodologyLine(metrics.n)}</p>
      </header>

      {/* KPI strip — return/percentage form, em-dash on degenerate. */}
      <section className="mt-8" aria-label="Projected metrics">
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4 lg:grid-cols-7">
          {kpis.map((k) => (
            <div key={k.label} className="bg-surface px-4 py-3">
              <div className="text-[11px] uppercase tracking-wide text-text-muted">
                {k.label}
              </div>
              <div className="mt-1 font-mono text-lg font-semibold tabular-nums text-text-primary">
                {k.value}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Projected equity curve (+ BTC benchmark overlay when available). */}
      <section className="mt-8" aria-label="Projected equity curve">
        <h2 className="mb-3 text-sm font-semibold text-text-primary">
          Projected equity curve
        </h2>
        <EquityChart
          equityDailyPoints={scenarioWealth}
          scenarioSeries={scenarioWealth}
          benchmark={btcWealth}
        />
      </section>

      {/* vs BTC active-return section — its own three honest empty states +
          em-dash on degenerate; return form only. */}
      <Card className="mt-8">
        <ScenarioBenchmarkSection
          portfolioDaily={portfolioDaily}
          btcDaily={btcDaily}
          benchmarkAvailable={btcAvailable}
        />
      </Card>

      {/* Pairwise correlation — its own <2-strategy / <10-day honest empty
          states (never a 1×1 grid / fabricated number). */}
      <Card className="mt-8">
        <div className="mb-3">
          <h2 className="text-sm font-semibold text-text-primary">
            Pairwise correlation
          </h2>
          <p className="mt-0.5 text-xs text-text-muted">
            Computed from the scenario&apos;s daily returns. Teal = diversifying,
            orange = concentrated.
          </p>
        </div>
        <CorrelationHeatmap
          correlationMatrix={metrics.correlation_matrix}
          strategyNames={strategyNames}
          overlappingDays={metrics.n}
          avgAbsCorrelation={metrics.avg_pairwise_correlation}
        />
      </Card>
    </main>
  );
}
