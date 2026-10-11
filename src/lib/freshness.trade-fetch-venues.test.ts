import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TRADE_FETCH_VENUES } from "./freshness";

/**
 * Phase 167.1.2.2.2 / TRADESYNC, T-167.1.2.2.2-28: `TRADE_FETCH_VENUES` is the
 * set of venues the cron fetches trades for, and the only venues for which a
 * null `trades_fetched_at` may read "No trade fetch recorded yet". It must be
 * the venues `fetch_daily_pnl` has a branch for. This test reads the Python
 * source so adding or removing a venue branch there fails here, instead of the
 * badge silently claiming a gap on a venue the cron never touches (or staying
 * silent on one it does).
 */
const EXCHANGE_PY = join(
  process.cwd(),
  "analytics-service",
  "services",
  "exchange.py",
);

function fetchDailyPnlBody(source: string): string {
  const start = source.search(/^async def fetch_daily_pnl\b/m);
  if (start === -1) return "";
  const rest = source.slice(start);
  // Skip the signature line itself, then stop at the next top-level def.
  const afterSignature = rest.indexOf("\n") + 1;
  const next = rest.slice(afterSignature).search(/^(?:async def|def) /m);
  return next === -1
    ? rest
    : rest.slice(0, afterSignature + next);
}

describe("TRADE_FETCH_VENUES is pinned to fetch_daily_pnl", () => {
  const body = fetchDailyPnlBody(readFileSync(EXCHANGE_PY, "utf8"));
  const found = [
    ...new Set([...body.matchAll(/exchange\.id\s*==\s*"([a-z0-9_]+)"/g)].map((m) => m[1])),
  ].sort();

  it("guard-the-guard: the fetcher body was sliced and at least one venue literal found", () => {
    // A renamed or moved function must fail here, never pass vacuously.
    expect(body.length).toBeGreaterThan(0);
    expect(body).toContain("async def fetch_daily_pnl");
    expect(found.length).toBeGreaterThan(0);
  });

  it("the slice stops at the next top-level def (it does not swallow later venue branches)", () => {
    // fetch_raw_trades, validate_key_permissions and fetch_mark_prices all test
    // `exchange.id == "deribit"` or carry other branches; none may leak in.
    expect(body).not.toMatch(/^(?:async def|def) (?!fetch_daily_pnl)/m);
    expect(found).not.toContain("deribit");
  });

  it("equals the venues fetch_daily_pnl branches on", () => {
    expect([...TRADE_FETCH_VENUES].sort()).toEqual(found);
  });
});
