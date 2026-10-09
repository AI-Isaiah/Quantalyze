/**
 * scripts/seed-portfolio-benchmark-local.ts
 *
 * Phase 166.4.1 D-07 — seed ONE portfolio and a BTC price cache on the
 * runner-private local-stack lane, so the REAL Python
 * `_compute_portfolio_analytics` can be run against it and `/portfolios/[id]`
 * can be walked in a browser.
 *
 * ⛔ LOCAL STACK ONLY. Never run this against shared TEST or PROD. The first
 * thing it does is refuse any Supabase URL whose host is not 127.0.0.1 or
 * localhost, before a client exists; `assertNotProductionSupabaseUrl` is a
 * second, independent guard behind it.
 *
 * What it seeds, and why each piece is shaped the way it is:
 *   - one allocator (`seedTestAllocator`) and one real `portfolios` row
 *     (reusing the allocator's existing row when one exists: the partial unique
 *     index `portfolios_one_real_per_user` allows at most one `is_test = false`
 *     portfolio per user);
 *   - strategy A, `asset_class = 'crypto'`, keeping the helper's seven-calendar-
 *     day series (weekend days included);
 *   - strategy B, `asset_class = 'traditional'`, whose
 *     `strategy_analytics.daily_returns` is replaced by its own weekday-only
 *     subset, so the portfolio pairs a weekend-bearing leg with a weekday-only
 *     leg;
 *   - two `portfolio_strategies` rows (60000 / 0.6 and 40000 / 0.4);
 *   - 1101 contiguous UTC days of BTC `benchmark_prices` ending yesterday. The
 *     cache answers `get_benchmark_returns` only when the newest 1000 completed
 *     days are contiguous and end yesterday or later (`_cache_miss_reason`);
 *     anything less would make the compute fetch over the network. Weekend
 *     closes move +1.5 percent and weekday closes -0.2 percent, so weekend
 *     moves are non-zero and distinct from weekday moves.
 *
 * Usage (from the repo root; the main checkout's tsx, the lane variables
 * mapped as the plan's <context> says):
 *   TEST_SUPABASE_URL=<lane API_URL> \
 *   TEST_SUPABASE_SERVICE_ROLE_KEY=<lane SERVICE_ROLE_KEY> \
 *   tsx scripts/seed-portfolio-benchmark-local.ts --out <path outside the repo>
 *
 * The handoff JSON (mode 600) carries credentials, so `--out` must resolve
 * OUTSIDE the repository root. Only the portfolio id and the handoff path are
 * printed; no key is ever printed.
 */

import { chmodSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { assertNotProductionSupabaseUrl } from "../src/lib/test-safety";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BTC_DAYS = 1101;
const DAY_MS = 86_400_000;

function refuse(message: string): never {
  console.error(message);
  process.exit(2);
}

/** Pull `--out <path>` from argv; undefined when absent or valueless. */
function parseOut(argv: string[]): string | undefined {
  const i = argv.indexOf("--out");
  const value = i >= 0 ? argv[i + 1] : undefined;
  return value && !value.startsWith("--") ? value : undefined;
}

/** True for Saturday and Sunday in UTC. */
function isWeekendUtc(isoDate: string): boolean {
  const dow = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6;
}

async function main(): Promise<void> {
  // 1. Loopback guard FIRST: nothing below this block may create a client.
  const rawUrl = process.env.TEST_SUPABASE_URL ?? "";
  let host = "";
  try {
    host = new URL(rawUrl).hostname;
  } catch {
    // an unparseable URL has no loopback host; refused below
  }
  if (host !== "127.0.0.1" && host !== "localhost") {
    refuse(
      "refusing: seed-portfolio-benchmark-local writes only to a loopback Supabase",
    );
  }
  assertNotProductionSupabaseUrl(rawUrl, "seed-portfolio-benchmark-local");

  // 2. The handoff holds credentials: it must land outside the tracked tree.
  const outArg = parseOut(process.argv.slice(2));
  if (!outArg) {
    refuse("usage: seed-portfolio-benchmark-local --out <path outside the repo>");
  }
  const outPath = resolve(outArg);
  if (outPath === REPO_ROOT || outPath.startsWith(REPO_ROOT + sep)) {
    refuse(
      "refusing: --out resolves inside the repository; the handoff carries credentials",
    );
  }

  // Past both guards: only now load anything that can create a client.
  const { createClient } = await import("@supabase/supabase-js");
  const { seedTestAllocator, seedStrategyWithHistory } = await import(
    "../e2e/helpers/seed-test-project"
  );
  const serviceKey = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY ?? "";
  const admin = createClient(rawUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 3. Allocator, two strategies, the portfolio and its members.
  const allocator = await seedTestAllocator();
  const strategyA = await seedStrategyWithHistory({
    days: 120,
    withDailyReturns: true,
    name: "Local benchmark check A (crypto)",
  });
  const strategyB = await seedStrategyWithHistory({
    days: 120,
    withDailyReturns: true,
    name: "Local benchmark check B (traditional)",
  });

  const classA = await admin
    .from("strategies")
    .update({ asset_class: "crypto" })
    .eq("id", strategyA);
  if (classA.error) throw new Error(`strategy A asset_class: ${classA.error.message}`);
  const classB = await admin
    .from("strategies")
    .update({ asset_class: "traditional" })
    .eq("id", strategyB);
  if (classB.error) throw new Error(`strategy B asset_class: ${classB.error.message}`);

  // Strategy B keeps only its weekdays, in the element shape the helper wrote.
  const bRow = await admin
    .from("strategy_analytics")
    .select("daily_returns")
    .eq("strategy_id", strategyB)
    .single();
  if (bRow.error || !Array.isArray(bRow.data?.daily_returns)) {
    throw new Error(`strategy B daily_returns read: ${bRow.error?.message ?? "not an array"}`);
  }
  const weekdayOnly = (bRow.data.daily_returns as { date: string; value: number }[]).filter(
    (p) => !isWeekendUtc(p.date.slice(0, 10)),
  );
  const bWrite = await admin
    .from("strategy_analytics")
    .update({ daily_returns: weekdayOnly })
    .eq("strategy_id", strategyB);
  if (bWrite.error) throw new Error(`strategy B daily_returns write: ${bWrite.error.message}`);

  // One real portfolio per user (portfolios_one_real_per_user): reuse, else insert.
  const existing = await admin
    .from("portfolios")
    .select("id")
    .eq("user_id", allocator.userId)
    .eq("is_test", false)
    .limit(1);
  if (existing.error) throw new Error(`portfolio lookup: ${existing.error.message}`);
  let portfolioId: string;
  if (existing.data && existing.data.length > 0) {
    portfolioId = existing.data[0].id as string;
  } else {
    const inserted = await admin
      .from("portfolios")
      .insert({ user_id: allocator.userId, name: "Local benchmark check", is_test: false })
      .select("id")
      .single();
    if (inserted.error || !inserted.data) {
      throw new Error(`portfolio insert: ${inserted.error?.message ?? "no row"}`);
    }
    portfolioId = inserted.data.id as string;
  }
  const members = await admin.from("portfolio_strategies").insert([
    { portfolio_id: portfolioId, strategy_id: strategyA, allocated_amount: 60000, current_weight: 0.6 },
    { portfolio_id: portfolioId, strategy_id: strategyB, allocated_amount: 40000, current_weight: 0.4 },
  ]);
  if (members.error) throw new Error(`portfolio_strategies insert: ${members.error.message}`);

  // 4. BTC cache: BTC_DAYS contiguous UTC days ending yesterday.
  const todayUtc = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z").getTime();
  const btc: Record<string, number> = {};
  let close = 30000;
  for (let i = BTC_DAYS; i >= 1; i--) {
    const date = new Date(todayUtc - i * DAY_MS).toISOString().slice(0, 10);
    if (i !== BTC_DAYS) close *= isWeekendUtc(date) ? 1.015 : 0.998;
    close = Number(close.toFixed(6));
    btc[date] = close;
  }
  const cacheRows = Object.entries(btc).map(([date, close_price]) => ({
    date,
    symbol: "BTC",
    close_price,
  }));
  for (let i = 0; i < cacheRows.length; i += 500) {
    const up = await admin
      .from("benchmark_prices")
      .upsert(cacheRows.slice(i, i + 500), { onConflict: "date,symbol" });
    if (up.error) throw new Error(`benchmark_prices upsert: ${up.error.message}`);
  }

  // 5. Handoff, mode 600. Only the portfolio id and the path are printed.
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        portfolioId,
        email: allocator.email,
        password: allocator.password,
        strategyIds: [strategyA, strategyB],
        btc,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  chmodSync(outPath, 0o600);
  console.log(`portfolio ${portfolioId}`);
  console.log(`handoff ${outPath}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
