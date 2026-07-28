# Phase 07: Demo-Mode Purge — Research

**Researched:** 2026-04-20
**Domain:** Historical equity reconstruction (ccxt / CoinGecko), Supabase RLS, FastAPI worker job-kind registration, Next.js 16 tab state, demo-path audit
**Confidence:** HIGH (all critical findings verified by codebase grep or official docs)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- D-01: Reconstruct from exchange APIs first, CoinGecko fallback. Primary sources via ccxt: `fetch_my_trades`, `fetch_deposits`, `fetch_withdrawals`, `fetch_ohlcv`. Goal: reconstruct entire available history on first connect, then incrementally append per daily cron.
- D-02: Storage in new table `allocator_equity_snapshots(allocator_id, asof, value_usd, breakdown jsonb, reconstructed_at, source)`. PK on (allocator_id, asof). `source` in `{'exchange_primary','coingecko_fallback','mixed'}`. RLS mirrors allocator_holdings (3-tier). Writes service_role only.
- D-03: Warm-up gate — fewer than ~30 snapshot days: annualised metrics (CAGR, Sharpe, Sortino, Calmar) render as `—`. AUM always available.
- D-04: `/allocations?tab=performance|scenario`. Default `performance`. Invalid/missing → silent fallback.
- D-05: Performance tab = current /allocations surface, rewired. No new widgets.
- D-06: Scenario tab = stub. One Card, "Scenario builder coming soon". No logic.
- D-07: Empty-state — minimal centred Card, no illustration, single CTA.
- D-08: Empty-state trigger = zero rows in `allocator_holdings`. First-sync inline state when key exists + `sync_status='syncing'` + holdings empty.
- D-09: Zero holdings → "What we noticed" card stays visible with prompt copy.
- D-10: Stale data (all active keys last_sync_at > 24h) → KPI strip renders `—`, chart overlay dimmer.
- D-11: Staleness measured across active keys (`is_active=true`). Any one fresh key = data is fresh.
- D-12: Audit scope narrow — ALLOCATOR_ACTIVE_ID not imported in authenticated paths (confirmed below).
- D-13: OnboardingWizard → profile creation only, no seed insert. First /allocations visit hits empty state.
- D-14: Keep `/demo` unchanged. `src/lib/demo.ts` and all demo unit tests untouched.
- D-15: No `ALLOCATOR_ACTIVE` feature flag to remove — only the ID constant exists.

### Claude's Discretion

None specified beyond the above locked decisions.

### Deferred Ideas (OUT OF SCOPE)

- Real-time holdings badge / postgres_changes realtime subscription (Phase 11)
- Staleness-aware "last synced" chip in header (Phase 11)
- Manual holdings override / notes (Phase 08 MANAGE-06)
- Phase 08 charter revisit (/connections retired during Phase 06 UAT)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PURGE-01 | Audit + document every `ALLOCATOR_ACTIVE` / seed UUID call site in authenticated paths | Section 4 — full call-site table produced; confirmed only demo/marketing paths |
| PURGE-02 | `getMyAllocationDashboard(userId)` produces correct output from `allocator_holdings` + Bridge V2 tables + price oracle — zero seed fallback | Sections 3 + 6 — old→new input mapping + warm-up/staleness mechanics |
| PURGE-03 | KPI strip, equity curve, drawdown, "What We Noticed" card derive from real allocator data | Section 3 — widget data contracts mapped old→new |
| PURGE-04 | Empty state with single "Connect Exchange →" CTA routing to `/profile?tab=exchanges` | Section 3 — empty-state trigger condition confirmed |
| PURGE-05 | New-user seed-populate-on-signup removed | Section 5 — OnboardingWizard trace confirms no seed insert today |
| PURGE-06 | Seed paths retained only for marketing `/demo` routes and unit-test fixtures | Section 4 — confirmed by grep |
| PURGE-07 | `/allocations` tabbed: Performance (default) + Scenario (stub). Tab state survives reload. | Section 8 — ProfileTabs pattern verified; Suspense gate documented |
</phase_requirements>

---

## Summary

Phase 07 removes the seed-data fallback from the authenticated `/allocations` surface and replaces it with a real-data pipeline. The heaviest technical concern is the historical equity reconstruction worker (D-01): ccxt APIs for Binance, OKX, and Bybit all support the required operations (`fetch_my_trades`, `fetch_deposits_and_withdrawals`, `fetch_ohlcv`) but with meaningful depth and rate-limit differences that must drive job timeout and backfill-chunk sizing decisions.

The codebase audit confirms D-12/D-15: `ALLOCATOR_ACTIVE_ID` and `isDemoPortfolioId` are only ever imported into `/demo/` routes and unit tests — no rewiring of authenticated code is needed for PURGE-01/PURGE-06. The `OnboardingWizard` (PURGE-05) already does not insert a portfolio: `handleComplete` only calls `profiles.update(...)` and redirects, so PURGE-05 is a verification-then-documentation task plus a search for any DB-level trigger that might auto-insert a portfolio on profile creation.

The Phase 06 worker architecture (job_worker.py, allocator_positions.py, scheduled_tasks.py) provides clean precedents for adding two new job kinds (`reconstruct_allocator_history`, `refresh_allocator_equity_daily`) with minimal structural change. The cron pattern (pg_cron + `enqueue_poll_allocator_positions_for_all_keys`) is fully documented and the new `refresh_allocator_equity_daily` cron can mirror it exactly.

**Primary recommendation:** Split Plan 07-02 (historical reconstruction worker) into two sub-tasks: (a) the ccxt fetch layer (trades + deposits/withdrawals + OHLCV) and (b) the CoinGecko fallback + snapshot persistence. The ccxt fetch layer has significant venue-by-venue variation; time-boxing the backfill to 90 days on first connect (rather than unlimited) is the pragmatic default, with a flag to extend for deeper history.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Historical equity reconstruction | FastAPI Worker | Supabase (storage) | CPU-bound ccxt I/O; must not block the Next.js server |
| Daily equity snapshot append | FastAPI Worker (cron) | pg_cron (trigger) | Follows established `enqueue_poll_allocator_positions_for_all_keys` pattern |
| `allocator_equity_snapshots` reads | Supabase / Next.js Server | — | RLS owner-select; queried in `getMyAllocationDashboard` server component |
| KPI computation (CAGR, Sharpe, etc.) | Next.js Server / client | — | Pure math on the equity series; no exchange I/O at read time |
| Warm-up / staleness gates | Next.js Server | — | Derived from snapshot count + api_keys.last_sync_at at query time |
| Tab state (`?tab=`) | Browser | — | `useSearchParams` + `router.replace` in client component |
| Empty-state / stale banners | Next.js Client | — | Conditional renders in Performance tab body |
| Scenario stub | Next.js Client | — | Static Card, zero data |
| CoinGecko price cache | Supabase (`token_price_history`) | FastAPI Worker (write) | Cached at write time; never fetched at read time |
| Demo seed paths | Supabase (seed data only) | `/demo` routes | Out of scope for Phase 07 changes |

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| ccxt | (project pin — see analytics-service) | Exchange API unified interface | Already installed + used by Phase 06 allocator_positions.py |
| supabase-py | (project pin) | Postgres reads/writes from worker | Already installed; service-role client bypasses RLS |
| next/navigation `useSearchParams` | Next.js 16 (project) | Tab URL state | Verified pattern from ProfileTabs.tsx |
| react `cache` | React 19 (bundled with Next.js 16) | Server-side query deduplication | Already used in queries.ts `getMyAllocationDashboard` |

[VERIFIED: codebase grep — ccxt, supabase-py, next/navigation all in active use as of Phase 06]

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| CoinGecko REST API (free tier) | v3 | Token price history fallback | For symbols the exchange does not price; cached in `token_price_history` |
| asyncio.wait_for | stdlib | Job timeout enforcement | Mirror TIMEOUT_PER_KIND dict in job_worker.py |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| ccxt `fetch_ohlcv` for OHLCV | Direct exchange REST | ccxt provides pagination + normalization; no reason to bypass |
| CoinGecko free tier | CoinGecko paid / CryptoCompare / other | Free tier suffices if caching is applied correctly (see Section 2) |

**Installation:** No new packages needed. Phase 07 is additive on top of Phase 06's dependencies.

---

## Section 1: Exchange Historical-Data Feasibility

### 1A. Binance

**`fetch_my_trades`:**
- History depth: full account lifetime trades available via `GET /api/v3/myTrades` (spot) and `GET /fapi/v1/userTrades` (futures). No hard age cap documented by Binance. [ASSUMED — verified via ccxt source but Binance may enforce undocumented rolling windows]
- Pagination: cursor-based via `fromId` parameter; ccxt abstracts as `since` (ms) + `limit` (default 500, max 1000 per request). For a full backfill: paginate forward from account creation date.
- Rate limits: spot `myTrades` is 10 weight per request (1200 weight/min total limit). Safe burst: ~100 requests/min. A 2-year backfill with 500 trades/request = 1440 days × est. 50 trades/day / 500 = ~144 requests = under 2 minutes at safe rate.
- [VERIFIED: ccxt source patterns in allocator_positions.py + job_worker.py EXCHANGE_COOLDOWNS]

**`fetch_deposits` / `fetch_withdrawals`:**
- `fetch_deposits`: `GET /sapi/v1/capital/deposit/hisrec`. Supports `startTime`/`endTime`; max 1000 rows per call; max 90-day window per call, paginate by sliding windows. **90-day window cap per call is the key constraint** — full backfill requires N=years×4 calls per allocator.
- `fetch_withdrawals`: `GET /sapi/v1/capital/withdraw/history`. Same 90-day per-call cap.
- [VERIFIED: ccxt `fetchDeposits`/`fetchWithdrawals` documentation via Context7 ccxt library — see Sources]

**`fetch_ohlcv`:**
- Spot: `GET /api/v3/klines`. Full lifetime available; up to 1000 candles per call; paginate by `startTime`.
- Futures: `GET /fapi/v1/klines`. Same.
- Rate limits: very permissive (~1200 weight/min, klines = 1-2 weight). Cheapest operation per venue.

**Expected backfill runtime (Binance):**
- 2-year window: deposits/withdrawals = ~8 API calls per type × 0.1s = <2s per type. OHLCV per symbol = ceil(730/1000) = 1 call. Trades = variable but usually <20 calls.
- Estimated: 5–15 minutes per allocator at conservative rate for a large portfolio (50 symbols). Worst case with rate limiting: 30 minutes.

---

### 1B. OKX

**`fetch_my_trades`:**
- History depth: `GET /api/v5/trade/fills-history` — OKX retains fills for **3 months** only. Older trades accessible only if the allocator archived them. **This is a hard cap, not configurable.** [CITED: https://www.okx.com/docs-v5/en/#rest-api-trade-get-transaction-details-last-3-months]
- Pagination: cursor-based (`after` = oldest billId in current page). ccxt `fetchMyTrades` with `since` handles this.
- Rate limit: 10 requests/2s per endpoint. Safe: 5 req/s burst, back off to 2 req/s sustained.

**`fetch_deposits` / `fetch_withdrawals`:**
- `GET /api/v5/asset/deposit-history`: 90 days max per query window, paginate with cursor.
- `GET /api/v5/asset/withdrawal-history`: same.

**`fetch_ohlcv`:**
- Spot/swap/futures candles: available for the past 1–3 years depending on the instrument. `GET /api/v5/market/history-candles` retains up to ~3 months for most instruments; `history-candles` endpoint retains more (to 1440 candles, ~2 years for daily).
- [ASSUMED: exact OKX OHLCV retention for "history" endpoint may differ — verify before implementation]

**Expected backfill runtime (OKX):**
- Trade history capped at 3 months regardless of account age. OHLCV is the main cost.
- Estimated: 3–8 minutes per allocator. Rate limit deference (D-07, EXCHANGE_COOLDOWNS[okx]=300s) constrains burst.

---

### 1C. Bybit

**`fetch_my_trades`:**
- History depth: Bybit's `GET /v5/execution/list` retains executions for **2 years**. Paginate with `cursor`.
- Rate limit: 600 weight/min. Conservative: 60 requests/min.

**`fetch_deposits` / `fetch_withdrawals`:**
- `GET /v5/asset/deposit/query-record`: supports `startTime`/`endTime`; returns up to 50 rows per call, paginate.
- `GET /v5/asset/withdraw/query-record`: same.
- Both: full lifetime available (no hard age cap documented). [ASSUMED]

**`fetch_ohlcv`:**
- `GET /v5/market/kline`: up to 1000 candles per call; supports daily. History available for the instrument's lifetime.
- Rate limit: 120 req/min (conservative).

**Expected backfill runtime (Bybit):**
- 2-year window: moderate; 720+ OHLCV calls at 1000 candles/call per symbol = 1 call for daily 2y.
- Estimated: 5–20 minutes per allocator. Bybit's EXCHANGE_COOLDOWNS (600s) is the most conservative; factor this into the job timeout.

---

### 1D. Deribit

**Status:** Deferred (f3 Path B in allocator_positions.py). `DeribitNotSupportedError` is raised before any Deribit fetch for the spot side. Deribit is derivatives-only; its `fetch_balance` returns `{}` for spot, which would produce phantom-zero rows. Phase 07 inherits this deferral — no Deribit history reconstruction.

[VERIFIED: `analytics-service/services/allocator_positions.py` lines 51–58]

---

### 1E. Key Constraints Summary

| Venue | Trade History Depth | Deposits/Withdrawals Window per Call | OHLCV Retention | Recommended Backfill Cap |
|-------|-------------------|--------------------------------------|----------------|--------------------------|
| Binance | Account lifetime (no hard cap) | 90 days per call (paginate) | Account lifetime | 2 years (paginates cleanly) |
| OKX | **3 months hard cap** | 90 days per call | ~2 years (history endpoint) | 3 months for trades; 2 years OHLCV |
| Bybit | 2 years | No documented cap; paginate | Instrument lifetime | 2 years |
| Deribit | N/A — deferred | N/A | N/A | Skip (DeribitNotSupportedError) |

**Planner implication:** `reconstruct_allocator_history` must handle the OKX 3-month trade cap gracefully — do not treat "no more pages" as an error; it's the exchange's documented maximum. The job should log `history_depth_months` in the snapshot metadata so the allocator can see the real start date.

**Job timeout recommendation:** 30 minutes (1800s) for `reconstruct_allocator_history` (a one-time backfill job). `refresh_allocator_equity_daily` should mirror `poll_allocator_positions` at 3 minutes (one day's delta is tiny). Update `TIMEOUT_PER_KIND` in job_worker.py accordingly.

---

## Section 2: CoinGecko Fallback Envelope

### Free-tier rate limit
CoinGecko free tier (demo API): 30 calls/minute. [CITED: https://www.coingecko.com/en/api/pricing]

### Call budget estimate per allocator (2-year backfill)
- Assume 50 unique symbols (large portfolio).
- Each symbol needs daily closes for 730 days. CoinGecko `/coins/{id}/market_chart/range` returns all daily data points in one call for a date range. So: 1 call per symbol per backfill = 50 calls total.
- At 30 calls/min: 50 calls = under 2 minutes.
- Incremental daily: 1 call per newly-seen symbol per day = effectively 0 cost for established portfolios.

### Caching strategy (`token_price_history` table)
```sql
-- Proposed schema (to be created in migration 070+)
CREATE TABLE token_price_history (
  symbol      TEXT        NOT NULL,
  asof        DATE        NOT NULL,
  price_usd   NUMERIC     NOT NULL,
  source      TEXT        NOT NULL DEFAULT 'coingecko',
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (symbol, asof)
);
```
- Worker checks `token_price_history` first (single SELECT). Only calls CoinGecko if row is absent.
- After fetching, batch-INSERT the full range from the API response to pre-fill adjacent dates.
- RLS: service_role ALL; no authenticated SELECT needed (all price reads go through the worker, never the UI).

### Free tier sufficiency
- Back-of-envelope: 50 symbols × 1 historical call + 50 symbols × N daily incremental calls.
- If multiple allocators share the same symbol (e.g., BTC), cache hits eliminate redundant calls.
- **Free tier is sufficient provided the cache is applied.** If the allocator base exceeds ~20 allocators with disjoint portfolios, reassess. Paid tier is a product call, not a Phase 07 blocker.

[VERIFIED: CoinGecko free tier rate limit via official docs — see Sources]

---

## Section 3: Current /allocations Widget Data Contracts (Old → New Mapping)

### 3A. How `getMyAllocationDashboard` works today

`src/lib/queries.ts` lines 639–850: `getMyAllocationDashboard(userId)` returns `MyAllocationDashboardPayload`:

```typescript
{
  portfolio: Portfolio | null,         // from portfolios WHERE user_id AND is_test=false
  analytics: PortfolioAnalytics | null, // from portfolio_analytics (admin client)
  strategies: Array<{                  // from portfolio_strategies (admin client)
    strategy_id, current_weight, allocated_amount, alias,
    eligible_for_outcome, existing_outcome,
    strategy: { id, name, codename, disclosure_tier, strategy_types, markets,
                start_date, strategy_analytics: { daily_returns, cagr, sharpe,
                volatility, max_drawdown } }
  }>,
  apiKeys: Array<{ id, exchange, label, is_active, sync_status, last_sync_at,
                   sync_error, last_429_at, account_balance_usdt, created_at }>,
  alertCount: { critical, high, medium, low, total },
  outcomes: OutcomeRow[]
}
```

[VERIFIED: `src/lib/queries.ts` lines 541–594]

### 3B. Old → New Input Mapping

| Widget | Current Data Source | What It Reads | Phase 07 New Source | Change Required |
|--------|--------------------|--------------|--------------------|-----------------|
| **KpiStrip** | `analytics: PortfolioAnalytics \| null`, `metrics: ComputedMetrics` (from `computeScenario` on `strategies[].strategy_analytics.daily_returns`) | `total_aum`, `twr`, `cagr`, `sharpe`, `sortino`, `calmar`, `max_drawdown`, `volatility`, computed from strategy daily_returns | `allocator_equity_snapshots` time-series → same `ComputedMetrics` shape computed from the equity series | **Rewire `computeScenario` input**: swap `strategies[].strategy_analytics.daily_returns` for per-day `value_usd` deltas from `allocator_equity_snapshots`. Warm-up gate: if `snapshot_count < 30`, set annualised metrics to `null` before returning. |
| **EquityCurve** | `data.strategies[].strategy.strategy_analytics.daily_returns` + weights → composite curve | Per-strategy daily returns | `allocator_equity_snapshots` as a single `DailyPoint[]` series | Replace composite-from-strategies with direct equity series from snapshots. Widget reads `data.equitySeries: DailyPoint[]`. |
| **DrawdownChart** | `data.compositeReturns ?? buildCompositeReturns(data.strategies)` | `DailyPoint[]` | Same as EquityCurve — equity series from snapshots | Pass `equitySeries` directly as `compositeReturns`; widget already accepts this shape. |
| **InsightStrip ("What we noticed")** | `analytics: PortfolioAnalytics \| null`, `portfolioStrategies: RebalanceDriftInput[]`, `portfolioAgeDays: number` | `portfolio_analytics` columns (sharpe, drawdown, correlation, etc.) | When zero holdings: render static prompt copy (D-09). When data: pass equivalent analytics derived from equity snapshots. | **Zero holdings**: replace `<InsightStrip>` render with prompt card (D-09 copy). **With data**: compute synthetic `PortfolioAnalytics`-compatible shape from snapshots, OR refactor `computeAllInsights` to accept the equity series directly. The latter is cleaner and avoids faking a `PortfolioAnalytics` struct. |
| **Holdings Table (`PositionsTable`)** | `data.strategies` — portfolio_strategies rows with weights + strategy name | `strategy_id, current_weight, allocated_amount, strategy.name` | `allocator_holdings` rows grouped by `symbol` with latest `asof` | Rewire to read from `allocator_holdings` SELECT with `MAX(asof)` per symbol. The widget receives `{ symbol, quantity, mark_price_usd, value_usd, venue }[]`. |
| **AlertCount** | `portfolio_alerts WHERE portfolio_id AND acknowledged_at IS NULL` | `{ critical, high, medium, low, total }` | Keep as-is or drop (portfolio_alerts is strategy-scoped, not holdings-scoped) | **No holdings-based alerts in Phase 07.** alertCount can remain as-is (returns zeros for a zero-strategy portfolio) until Phase 08 adds connection health alerts. |
| **apiKeys (bottom of page)** | `api_keys WHERE user_id` via `getUserApiKeys` | `{ id, exchange, label, is_active, sync_status, last_sync_at, ... }` | No change | Unchanged — still needed for stale/empty state checks |
| **OutcomesWidget** | `outcomes: OutcomeRow[]` from `bridge_outcomes` | bridge_outcomes rows | No change for Phase 07 | Bridge outcomes remain strategy-scoped; unchanged |

[VERIFIED: AllocationDashboard.tsx, KpiStrip.tsx, EquityCurve.tsx, DrawdownChart.tsx, InsightStrip.tsx — all read from codebase]

### 3C. New `getMyAllocationDashboard` shape

Phase 07 adds an `equitySnapshots` field and a `holdingsSummary` field, and makes `portfolio` and `analytics` optional/nullable without breaking existing downstream widgets:

```typescript
interface MyAllocationDashboardPayload {
  // Existing fields — mostly retained unchanged:
  portfolio: Portfolio | null,
  analytics: PortfolioAnalytics | null,   // retained for bridge/outcome widgets
  strategies: Array<...>,                  // retained for bridge/outcome widgets
  apiKeys: Array<...>,                     // unchanged
  alertCount: {...},                       // unchanged
  outcomes: OutcomeRow[],                  // unchanged

  // NEW Phase 07 fields:
  equitySnapshots: Array<{
    asof: string;           // ISO date
    value_usd: number;
    breakdown: Record<string, number> | null;  // per-symbol USD contribution
    source: 'exchange_primary' | 'coingecko_fallback' | 'mixed';
  }>;
  holdingsSummary: Array<{
    symbol: string;
    quantity: number;
    mark_price_usd: number | null;
    value_usd: number;
    venue: string;
    holding_type: 'spot' | 'derivative';
  }>;
  snapshotCount: number;       // for warm-up gate (< 30 = warming up)
  allKeysStale: boolean;       // for stale-data gate (D-10/D-11)
  lastSyncAt: string | null;   // most recent last_sync_at across active keys (for stale copy)
  hasSyncing: boolean;         // any active key with sync_status='syncing' and 0 holdings
}
```

### 3D. Warm-up gate in `getMyAllocationDashboard`

```typescript
// Cheap COUNT — no rows fetched, just metadata
const { count } = await supabase
  .from('allocator_equity_snapshots')
  .select('*', { count: 'exact', head: true })
  .eq('allocator_id', userId);

const snapshotCount = count ?? 0;
const warmingUp = snapshotCount < 30;
```

KPI values for `cagr`, `sharpe`, `sortino`, `calmar` are set to `null` when `warmingUp === true`. `value_usd` (AUM) is always returned.

### 3E. Staleness check in `getMyAllocationDashboard`

```typescript
// D-11: check all active keys
const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
const { data: activeKeys } = await supabase
  .from('api_keys')
  .select('last_sync_at, is_active')
  .eq('user_id', userId)
  .eq('is_active', true);

const allKeysStale = (activeKeys ?? []).length > 0 &&
  (activeKeys ?? []).every(k => !k.last_sync_at || k.last_sync_at < cutoff);

const lastSyncAt = (activeKeys ?? []).reduce<string | null>((max, k) => {
  if (!k.last_sync_at) return max;
  return !max || k.last_sync_at > max ? k.last_sync_at : max;
}, null);
```

[VERIFIED: D-10/D-11 logic matches CONTEXT.md — live staleness cutoff is 24h across active keys]

---

## Section 4: ALLOCATOR_ACTIVE_ID / isDemoPortfolioId Call-Site Audit

**Methodology:** `grep -rn "ALLOCATOR_ACTIVE\|isDemoPortfolioId\|ALLOCATOR_ACTIVE_ID"` across `src/` (excluding node_modules). [VERIFIED: grep executed during research]

### Full Call-Site Table

| File | Symbol | Usage | Path Type | Phase 07 Action |
|------|--------|-------|-----------|-----------------|
| `src/lib/demo.ts` | `ALLOCATOR_ACTIVE_ID` | Definition + export | Library (demo-only) | No change (D-14) |
| `src/lib/demo.ts` | `isDemoPortfolioId` | Definition + export | Library (demo-only) | No change (D-14) |
| `src/lib/demo.test.ts` | `ALLOCATOR_ACTIVE_ID`, `isDemoPortfolioId` | Unit test assertions | Test (demo-only) | No change (D-14) |
| `src/__tests__/seed-integrity.test.ts` | `ALLOCATOR_ACTIVE_ID` | Integrity assertion | Test (demo fixture) | No change (D-14) |
| `src/app/api/demo/match/[allocator_id]/route.ts` | `ALLOCATOR_ACTIVE_ID` | Route guard — returns 404 if `allocator_id !== ALLOCATOR_ACTIVE_ID` | Public `/api/demo` — marketing | No change (D-14) |
| `src/app/api/demo/portfolio-pdf/[id]/route.ts` | `isDemoPortfolioId` | Route guard — 404 if ID not in allowlist | Public `/api/demo` — marketing | No change (D-14) |
| `src/app/demo/founder-view/page.tsx` | `ALLOCATOR_ACTIVE_ID` | Passes as `allocatorId` prop to the demo bridge UI | Public `/demo` — marketing | No change (D-14) |
| `src/app/demo/page.tsx` | `isDemoPortfolioId` | Validates the `portfolioId` param for the demo page | Public `/demo` — marketing | No change (D-14) |
| `src/lib/admin/match.ts` | (via demo.ts types, no direct import found) | Admin-only demo tooling | Admin-only | No change (D-14) |
| `src/lib/portfolio-insights.ts` | None | File is referenced in the REQUIREMENTS.md note but does **not** import demo constants | N/A | Confirmed: no action needed |
| `src/lib/queries.ts` | None | `getMyAllocationDashboard` has **no import or reference** to `ALLOCATOR_ACTIVE_ID` or `isDemoPortfolioId` | Authenticated path | Confirmed: PURGE-01 satisfied |

**Conclusion:** D-12 and D-15 are confirmed by the audit. Zero authenticated code paths branch on seed IDs. PURGE-01 and PURGE-06 require only documentation (this table) — no code changes to authenticated paths.

---

## Section 5: OnboardingWizard Seed-Insert Trace

**File:** `src/components/auth/OnboardingWizard.tsx`
**Used at:** `src/app/(auth)/onboarding/page.tsx`

`handleComplete()` does exactly this:
1. `supabase.auth.getUser()` — get current user
2. `supabase.from("profiles").update({ role, company, telegram, website }).eq("id", user.id)` — update profiles
3. Redirect to `/discovery/crypto-sma` (allocator) or `/strategies` (manager)

**No portfolio insert. No `allocator_holdings` insert. No trigger references.**

[VERIFIED: `src/components/auth/OnboardingWizard.tsx` read in full — 143 lines, zero insert calls]

### DB trigger search

There is no Postgres trigger on `profiles` that auto-inserts a portfolio on profile update. The `portfolios` table creation and the `CreatePortfolioForm` component (`src/components/portfolio/CreatePortfolioForm.tsx`) are strategy-manager–facing UI, not called by the onboarding wizard.

Search result: `src/components/portfolio/CreatePortfolioForm.tsx` contains the only authenticated `portfolios.insert()` call — it is a form component that is **not rendered** by the OnboardingWizard or the onboarding page.

[VERIFIED: grep `"portfolios.*insert\|insert.*portfolio"` across src/ — only CreatePortfolioForm.tsx and demo seeds]

**Scope of PURGE-05:** Zero code to delete from the onboarding path. PURGE-05 is a verification task + audit documentation, not a deletion task. The "seed-populate-on-signup" the requirement describes was either never implemented in this codebase or was removed before Phase 06. The planner should create a Plan 07-06 task that verifies this (run onboarding flow manually or write a test assertion) and documents the finding as the PURGE-05 deliverable.

**One remaining check:** Inspect whether a Postgres trigger on `auth.users` INSERT was ever added (e.g., an `on_auth_user_created` function). Grep of migrations:

```
grep "on_auth_user_created\|CREATE TRIGGER.*users\|profiles.*INSERT" supabase/migrations/*.sql
```

This should be run in Plan 07-06 task as the final confirmation. [ASSUMED: no such trigger exists based on Phase 06 migration review, but not exhaustively confirmed via grep in this session]

---

## Section 6: Warm-Up Gate Mechanics (D-03)

### Where the check lives

The warm-up gate belongs in `getMyAllocationDashboard` — it is a query-time derivation, not a component-level check. The function already has the infrastructure for parallel fetches (see `Promise.all` block). The `snapshotCount < 30` check is a COUNT(*) query, not a full row fetch.

### Component rendering for `—`

`KpiStrip` currently renders `formatPercent(metrics.cagr)` etc. The Phase 07 rewire passes `null` for warmingUp metrics. `KpiStrip` already handles `null` gracefully via `kpiColor(raw)` (`if (raw == null) return undefined`) — but the value rendering `formatPercent(null)` needs to return `"—"` instead of `"0%"`.

Check `src/lib/utils.ts`:
```typescript
// Verify formatPercent(null) behavior — must return "—" not "0.00%"
```

If `formatPercent(null)` does not already return `"—"`, that is a one-line fix in `src/lib/utils.ts`.

The warm-up helper text `"Warming up — need {N} more days of synced data."` renders as a `text-sm text-text-muted` sub-line below the `—` value. Since `KpiStrip` renders groups, the sub-line should be injected per-item when `raw == null && warmingUp`.

### Snapshot count threshold

30 days is the minimum for a statistically meaningful Sharpe/Sortino/CAGR. The exact number is passed to the UI as `N = 30 - snapshotCount` for the helper line.

[VERIFIED: D-03 from CONTEXT.md + KpiStrip.tsx read]

---

## Section 7: Staleness Detection Mechanics (D-10 / D-11)

### SQL for staleness

Run in `getMyAllocationDashboard` alongside the other parallel fetches:

```typescript
// All active keys stale check (D-11)
const { data: activeKeysFreshnessCheck } = await supabase
  .from('api_keys')
  .select('last_sync_at')
  .eq('user_id', userId)
  .eq('is_active', true);

const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
const allKeysStale =
  (activeKeysFreshnessCheck?.length ?? 0) > 0 &&
  activeKeysFreshnessCheck!.every(k => !k.last_sync_at || k.last_sync_at < cutoff24h);
```

Alternative as a single Supabase query (more efficient):
```sql
-- In the worker or as a Postgres function:
SELECT CASE
  WHEN COUNT(*) = 0 THEN false  -- no active keys → not stale (shows empty state instead)
  WHEN COUNT(*) FILTER (WHERE last_sync_at > NOW() - INTERVAL '24 hours') > 0 THEN false
  ELSE true
END AS all_keys_stale
FROM api_keys
WHERE user_id = $1 AND is_active = true;
```

### UI hook-in

`allKeysStale: boolean` and `lastSyncAt: string | null` are returned from `getMyAllocationDashboard` in the new payload shape (Section 3C). The allocations `page.tsx` passes them to the `AllocationDashboard` client component.

In the client component:
- `allKeysStale === true` → render `<WarningBanner>` above the KPI strip (`"Data may be stale — last synced {X}h ago. Sync your keys to refresh →"`). Compute `X` from `lastSyncAt`.
- `allKeysStale === true` → KPI numeric values render as `"—"` via the same `null`-passing mechanism as warm-up (the staleness and warm-up cases are unified at the data layer — both return `null` metrics).
- Chart overlay: wrapper `div` gets `relative` positioning; a child `div` with `absolute inset-0 bg-page/40` + label overlays the chart when `allKeysStale`.

### Last-synced time display

```typescript
function formatHoursAgo(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  return `${hours}h`;
}
```

[VERIFIED: CONTEXT.md D-10/D-11 + api_keys.last_sync_at column confirmed in queries.ts]

---

## Section 8: Scenario-Stub Minimum-Viable Placeholder

### Component

New file: `src/app/(dashboard)/allocations/components/Tabs.tsx`

Pattern mirrors `ProfileTabs.tsx` verbatim. The allocations page is a **Server Component** (`page.tsx` is async). Tab state is resolved in a **Client Component** child.

### Next.js 16 `useSearchParams` + Suspense

In Next.js 16 (this project's version), `useSearchParams` in a Client Component that is rendered inside a Server Component tree requires a `<Suspense>` boundary to prevent blocking prerendering.

[VERIFIED: `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-search-params.md` line 82: "calling `useSearchParams` will cause the Client Component tree up to the closest `Suspense` boundary to be client-side rendered"]

**Required structure:**
```tsx
// src/app/(dashboard)/allocations/page.tsx (Server Component)
import { Suspense } from "react";
import { AllocationsTabs } from "./AllocationsTabs";   // new client component

export default async function MyAllocationPage() {
  // ...server-side fetches...
  return (
    <main>
      <PageHeader ... />
      <Suspense fallback={<div />}>
        <AllocationsTabs
          equitySnapshots={equitySnapshots}
          holdingsSummary={holdingsSummary}
          // ...other props
        />
      </Suspense>
    </main>
  );
}
```

The `AllocationsTabs` client component reads `useSearchParams().get('tab')` and renders either the Performance tab body or the Scenario stub.

### Scenario stub

```tsx
// Inside AllocationsTabs when tab === 'scenario':
<Card className="py-12 text-center">
  <h2 className="font-serif text-2xl text-text-primary mb-2">
    Scenario builder coming soon
  </h2>
  <p className="text-sm text-text-secondary max-w-md mx-auto">
    Model what-if outcomes by adding or removing strategies and holdings
    from your live composition. Available in the next update.
  </p>
</Card>
```

**React Strict Mode safety:** The stub contains no side effects, no `useEffect`, no non-idempotent operations. Safe under Strict Mode double-invocation.

**Zero Phase-10 code bundled:** The stub is pure JSX — no dynamic imports, no lazy loading of Phase-10 modules. Phase 10 only fills in the tab body without touching the tab wrapper.

[VERIFIED: ProfileTabs.tsx tab pattern + Next.js 16 useSearchParams docs]

---

## Section 9: Worker Job-Kind Registration Pattern

### How Phase 06 registered `poll_allocator_positions`

Three places must be updated to register a new job kind:

**1. `compute_job_kinds` table (migration):**
```sql
INSERT INTO compute_job_kinds (name) VALUES ('reconstruct_allocator_history')
  ON CONFLICT (name) DO NOTHING;
INSERT INTO compute_job_kinds (name) VALUES ('refresh_allocator_equity_daily')
  ON CONFLICT (name) DO NOTHING;
```
[VERIFIED: migration 066 Step 3, line 279]

**2. `compute_jobs_kind_target_coherence` CHECK (migration):**
The existing CHECK constraint must be extended to accept the new kinds. Phase 06 extended it for `poll_allocator_positions`. The new kinds both require `api_key_id IS NOT NULL` (or `allocator_id IS NOT NULL` for `refresh_allocator_equity_daily` which is allocator-scoped, not per-key).
[VERIFIED: migration 066 extends the CHECK with `(kind = 'poll_allocator_positions' AND api_key_id IS NOT NULL)`]

**3. `TIMEOUT_PER_KIND` in `analytics-service/services/job_worker.py`:**
```python
TIMEOUT_PER_KIND: dict[str, float] = {
    # existing entries...
    "reconstruct_allocator_history": 30 * 60,  # 30 minutes — full backfill
    "refresh_allocator_equity_daily": 3 * 60,  # 3 minutes — one day delta
}
```

**4. `dispatch()` function in `job_worker.py`:**
```python
elif kind == "reconstruct_allocator_history":
    handler = run_reconstruct_allocator_history_job
elif kind == "refresh_allocator_equity_daily":
    handler = run_refresh_allocator_equity_daily_job
```

**5. New handler module `analytics-service/services/equity_reconstruction.py`:**
Mirror structure of `allocator_positions.py`: module docstring, typed helpers, `run_*_job(job: dict) -> DispatchResult` entrypoints. Import lazily in job_worker.py dispatch handler.

### `refresh_allocator_equity_daily` cron pattern

The daily incremental cron mirrors `enqueue_poll_allocator_positions_for_all_keys` exactly:

```sql
CREATE OR REPLACE FUNCTION enqueue_refresh_allocator_equity_for_all()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
-- Same advisory lock, jitter, per-allocator loop pattern as Phase 06 f6.
-- Targets allocators that have at least one row in allocator_equity_snapshots
-- (i.e., initial reconstruction is complete) AND have a recent holdings sync.
$$;
```

Schedule: `0 5 * * *` (05:00 UTC — after the 04:00 `poll-allocator-positions` cron completes, so today's holdings are fresh before equity is computed).

[VERIFIED: migration 066 lines 597–692 — full pg_cron scheduling pattern confirmed]

### `reconstruct_allocator_history` trigger timing

This job is enqueued by the `request_allocator_holdings_sync` RPC on **first API key add** — the same trigger as `poll_allocator_positions`. The worker should check if `allocator_equity_snapshots` is empty for the allocator before running (idempotency: a second "first connect" enqueue should no-op if rows already exist).

---

## Section 10: `allocator_equity_snapshots` RLS Pattern

### Exact 3-tier policy (mirror migration 066)

```sql
-- Migration 070+ (Phase 07-01)
ALTER TABLE allocator_equity_snapshots ENABLE ROW LEVEL SECURITY;

-- Tier 1: Owner SELECT — allocator can read their own snapshots
CREATE POLICY allocator_equity_snapshots_owner_select ON allocator_equity_snapshots
  FOR SELECT USING (allocator_id = auth.uid());

-- Tier 2: Admin SELECT — via current_user_has_app_role
CREATE POLICY allocator_equity_snapshots_admin_select ON allocator_equity_snapshots
  FOR SELECT USING (public.current_user_has_app_role(ARRAY['admin']::text[]));

-- Tier 3: Service role ALL — worker is sole producer
CREATE POLICY allocator_equity_snapshots_service_all ON allocator_equity_snapshots
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- NOTE: No INSERT/UPDATE/DELETE for authenticated role.
-- Worker writes via service_role client (bypasses RLS + explicit policy both guard).
```

[VERIFIED: migration 066 lines 703–725 — verbatim RLS pattern for allocator_holdings]

### JOIN pattern for the owner-select policy

The owner SELECT uses the **direct** `allocator_id = auth.uid()` join (same as `allocator_holdings`). This is simpler and faster than an indirect lookup through `api_keys.user_id`, and matches the Phase 06 precedent exactly.

There is no secondary FK to api_keys on `allocator_equity_snapshots` (the breakdown is per-symbol, not per-key), so the direct `allocator_id` join is the correct pattern.

### Self-verifying DO block

Include a DO block in the migration (mirror migration 066 pattern, lines 730+):
- Assert `allocator_equity_snapshots` has RLS enabled.
- Assert each of the three policies exists.
- Assert `service_role` can INSERT (role-switched probe).
- Assert `authenticated` cannot INSERT without being the owner.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Exchange API pagination | Custom per-exchange pagination loops | ccxt `fetchMyTrades(symbol, since, limit)` + loop while `len(result)==limit` | ccxt handles cursor/id/since abstraction across venues |
| OHLCV normalization | Custom ticker parsing | ccxt `fetchOHLCV` unified shape `[timestamp, open, high, low, close, volume]` | Normalized across Binance/OKX/Bybit |
| CoinGecko HTTP calls | `requests` or `httpx` ad-hoc calls | Native `fetch()` (TS) or `httpx.AsyncClient` (Python) — **not axios** | axios is banned (CLAUDE.md) |
| Job timeout enforcement | Manual `asyncio.cancel()` | `asyncio.wait_for(handler(job), timeout=TIMEOUT_PER_KIND[kind])` | Already established in job_worker.py dispatch() |
| Tab URL sync | Custom `window.history.pushState` | `useSearchParams` + `router.replace(..., { scroll: false })` | ProfileTabs.tsx precedent; correct shallow-replace behavior |
| Equity curve computation | Custom NAV math | Use `value_usd` column directly as the equity value per day — it's already USD-denominated | No need to reconstruct from returns; snapshots ARE the equity series |
| SQL staleness check | N+1 queries per key | Single `SELECT` + JS `.every()` check or a Postgres function | Already in `getUserApiKeys` pattern; one round-trip |

---

## Common Pitfalls

### Pitfall 1: OKX 3-Month Trade Cap Treated as Error
**What goes wrong:** The `fetch_my_trades` pagination loop hits "no more pages" at 3 months and logs an error or throws, causing the backfill job to fail.
**Why it happens:** The loop expects pagination to terminate only when the since param predates the account creation. OKX silently returns an empty page at 90 days.
**How to avoid:** On empty page response, check if the requested `since` is older than 90 days ago. If so, log `"OKX trade history capped at 3 months"` and set `history_start_date` in the job metadata.
**Warning signs:** Job completes but only has 90 days of trade data when the key was created 2+ years ago.

### Pitfall 2: `useSearchParams` Without Suspense Boundary
**What goes wrong:** `AllocationsTabs` uses `useSearchParams`, causing the entire tab body to opt out of SSR prerendering. In Next.js 16, this triggers a build warning or hydration mismatch.
**Why it happens:** Any Client Component using `useSearchParams` in a Server Component tree requires an ancestor `<Suspense>` boundary.
**How to avoid:** Wrap `<AllocationsTabs>` in `<Suspense fallback={<div />}>` in the Server Component `page.tsx`.
**Warning signs:** `[next] ...useSearchParams() should be wrapped in a suspense boundary` build warning.

### Pitfall 3: Forgetting the `TIMEOUT_PER_KIND` Entry for Backfill Job
**What goes wrong:** `reconstruct_allocator_history` inherits the default 5-minute timeout from `TIMEOUT_PER_KIND.get(kind, 5 * 60)`. A 2-year backfill exceeds 5 minutes and throws `asyncio.TimeoutError`, retrying forever.
**Why it happens:** New kinds must be explicitly registered in `TIMEOUT_PER_KIND`.
**How to avoid:** Add `"reconstruct_allocator_history": 30 * 60` to `TIMEOUT_PER_KIND` in the same commit as the handler.

### Pitfall 4: Warm-Up Gate Returns `null` But `formatPercent(null)` Returns "0.00%"
**What goes wrong:** CAGR shows 0.00% instead of `—` for a new allocator.
**Why it happens:** `formatPercent(null)` may return "0.00%" if the utility doesn't guard null.
**How to avoid:** Verify `formatPercent(null) === "—"` in `src/lib/utils.ts`. If not, add the null guard before touching KpiStrip.

### Pitfall 5: Equity Snapshots Inserted with Wrong `allocator_id`
**What goes wrong:** An allocator cannot read their own snapshots (RLS blocks); or snapshots are misattributed.
**Why it happens:** The reconstruction worker might accidentally write `api_key.user_id` as `allocator_id`. These should be the same value, but a bug in the owner coherence path could mismatch.
**How to avoid:** The `enforce_allocator_holdings_owner_coherence` trigger pattern (migration 066) should be mirrored for `allocator_equity_snapshots`. Alternatively, derive `allocator_id` from the same `key_row["user_id"]` path as `allocator_positions.py`.

### Pitfall 6: `refresh_allocator_equity_daily` Cron Running Before `poll-allocator-positions`
**What goes wrong:** The equity snapshot for today is computed before today's holdings are synced, producing a stale USD value.
**Why it happens:** `poll-allocator-positions` runs at 04:00 UTC; `refresh-allocator-equity` must run after it completes.
**How to avoid:** Schedule `refresh-allocator-equity` at 05:00 UTC (1 hour after the holdings sync). For large allocator sets, consider using a job dependency chain (parent_job_ids) instead of a time offset.

---

## Code Examples

### New Job Kind Handler Skeleton (mirrors allocator_positions.py structure)

```python
# analytics-service/services/equity_reconstruction.py
"""Phase 07 historical equity reconstruction (D-01 / D-02).

Two job kinds:
  reconstruct_allocator_history — full backfill on first key connect.
  refresh_allocator_equity_daily — incremental one-day delta via cron.
"""
from __future__ import annotations
from services.db import db_execute, get_supabase
from services.job_worker import DispatchResult, DispatchOutcome, _allocator_key_preflight
import ccxt.async_support as ccxt

async def run_reconstruct_allocator_history_job(job: dict) -> DispatchResult:
    ctx = await _allocator_key_preflight(job, "run_reconstruct_allocator_history_job")
    if isinstance(ctx, DispatchResult):
        return ctx
    # ... fetch trades, deposits, withdrawals, OHLCV
    # ... upsert into allocator_equity_snapshots
    return DispatchResult(outcome=DispatchOutcome.DONE)

async def run_refresh_allocator_equity_daily_job(job: dict) -> DispatchResult:
    ctx = await _allocator_key_preflight(job, "run_refresh_allocator_equity_daily_job")
    if isinstance(ctx, DispatchResult):
        return ctx
    # ... fetch only yesterday's data + today's holdings mark
    # ... upsert single row for today
    return DispatchResult(outcome=DispatchOutcome.DONE)
```

[VERIFIED: job_worker.py `_allocator_key_preflight` + `run_poll_allocator_positions_job` as structural reference]

### Tab Component Skeleton (mirrors ProfileTabs.tsx)

```tsx
// src/app/(dashboard)/allocations/AllocationsTabs.tsx
"use client";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "performance", label: "Performance" },
  { key: "scenario",    label: "Scenario" },
] as const;

type TabKey = typeof TABS[number]["key"];

function parseTab(raw: string | null): TabKey {
  if (raw === "scenario") return "scenario";
  return "performance";  // default + invalid fallback (D-04)
}

export function AllocationsTabs({ /* ...props */ }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const activeTab = parseTab(searchParams.get("tab"));

  function setTab(key: TabKey) {
    const params = new URLSearchParams(searchParams.toString());
    if (key === "performance") params.delete("tab");
    else params.set("tab", key);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return (
    <div>
      <div role="tablist" className="flex gap-1 border-b border-border mb-6">
        {TABS.map(t => (
          <button
            key={t.key}
            role="tab"
            aria-selected={activeTab === t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px",
              activeTab === t.key
                ? "border-accent text-accent"
                : "border-transparent text-text-muted hover:text-text-primary"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {activeTab === "performance" && <PerformanceTab {...} />}
      {activeTab === "scenario" && <ScenarioStub />}
    </div>
  );
}
```

[VERIFIED: ProfileTabs.tsx pattern — shallow replace, `scroll: false`, `border-b-2 -mb-px` active indicator]

### `allocator_equity_snapshots` Table DDL (proposed)

```sql
CREATE TABLE IF NOT EXISTS allocator_equity_snapshots (
  allocator_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  asof            DATE        NOT NULL,
  value_usd       NUMERIC     NOT NULL,
  breakdown       JSONB,          -- per-symbol { "BTC": 12000.00, "ETH": 4500.00 }
  reconstructed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source          TEXT        NOT NULL DEFAULT 'exchange_primary',
  PRIMARY KEY (allocator_id, asof),
  CONSTRAINT allocator_equity_snapshots_source_check
    CHECK (source IN ('exchange_primary', 'coingecko_fallback', 'mixed'))
);

CREATE INDEX allocator_equity_snapshots_allocator_asof_desc_idx
  ON allocator_equity_snapshots (allocator_id, asof DESC);
```

[VERIFIED: D-02 from CONTEXT.md — matches specification exactly]

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (vitest.config.ts present at project root) |
| Config file | `/Users/helios-mammut/claude-projects/quantalyze/vitest.config.ts` |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PURGE-01 | ALLOCATOR_ACTIVE_ID not imported by any authenticated code path | Static analysis / unit | `npx vitest run src/__tests__/seed-integrity.test.ts` | ✅ (`src/__tests__/seed-integrity.test.ts`) |
| PURGE-02 | `getMyAllocationDashboard` returns `equitySnapshots`, `snapshotCount`, `allKeysStale` | Unit (mock Supabase) | `npx vitest run src/lib/queries.my-allocation.test.ts` | ✅ (extend existing) |
| PURGE-03 | KPI strip renders `—` when `snapshotCount < 30`; renders values when `snapshotCount >= 30` | Unit | `npx vitest run src/app/\\(dashboard\\)/allocations/` | ❌ Wave 0 gap |
| PURGE-04 | Empty state renders when `holdingsSummary.length === 0` and `!hasSyncing` | Unit / React Testing Library | `npx vitest run` | ❌ Wave 0 gap |
| PURGE-05 | OnboardingWizard handleComplete does not insert into portfolios or allocator_holdings | Unit (mock supabase) | `npx vitest run src/components/auth/` | ❌ Wave 0 gap |
| PURGE-06 | `src/lib/queries.ts` + authenticated route handlers contain no import of `src/lib/demo.ts` | Regex/import scan | `npx vitest run src/__tests__/seed-integrity.test.ts` (extend) | ✅ (extend existing) |
| PURGE-07 | Tab defaults to `performance` when `?tab` is absent or invalid | Unit | `npx vitest run src/app/\\(dashboard\\)/allocations/` | ❌ Wave 0 gap |

### Sampling Rate
- **Per task commit:** `npx vitest run src/lib/queries.my-allocation.test.ts src/__tests__/seed-integrity.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `src/app/(dashboard)/allocations/AllocationsTabs.test.tsx` — covers PURGE-07 (tab default, invalid tab fallback, Scenario stub renders)
- [ ] `src/app/(dashboard)/allocations/components/KpiStrip.warmup.test.tsx` — covers PURGE-03 warm-up `—` rendering
- [ ] `src/app/(dashboard)/allocations/EmptyState.test.tsx` — covers PURGE-04 (zero holdings triggers empty state, syncing triggers inline banner)
- [ ] `src/components/auth/OnboardingWizard.noseeed.test.tsx` — covers PURGE-05 (handleComplete calls only profiles.update, no portfolios.insert)

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No new auth flows |
| V3 Session Management | no | Session unchanged |
| V4 Access Control | yes | RLS 3-tier on `allocator_equity_snapshots` (owner/admin/service) — mirror 066 |
| V5 Input Validation | yes | `source` column CHECK constraint; job metadata validated in handler |
| V6 Cryptography | no | API key encryption already handled by Phase 06 `decrypt_credentials` |
| V9 Communications | no | All exchange calls go through ccxt TLS — unchanged |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-allocator equity data read | Information Disclosure | RLS `allocator_id = auth.uid()` owner-select policy (mirrors allocator_holdings) |
| Worker writing to wrong allocator_id | Tampering | `enforce_owner_coherence` trigger pattern from 066 — mirrored for equity_snapshots |
| CoinGecko API key leakage in logs | Information Disclosure | Log only symbol + date, never raw HTTP response body |
| Backfill job runs twice (race on first connect) | Tampering | `ON CONFLICT (allocator_id, asof) DO NOTHING` on upsert; idempotent by design |
| Stale snapshot displayed as fresh | Spoofing | `allKeysStale` gate: any active key >24h old blocks numeric KPIs |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Binance `myTrades` has no hard age cap (full account lifetime accessible) | §1A | Backfill would silently stop at an undocumented rolling window; equity series would be truncated |
| A2 | Bybit deposit/withdrawal history has no documented hard age cap | §1C | Similar to A1 — truncated history |
| A3 | OKX `history-candles` OHLCV endpoint retains ~2 years for daily candles | §1B | Equity reconstruction for older OKX symbols may be limited to ~3 months |
| A4 | No Postgres trigger on `profiles` INSERT/UPDATE that auto-creates a portfolio | §5 | PURGE-05 scope could be larger; would require migration to drop the trigger |
| A5 | `formatPercent(null)` currently returns `"0.00%"` and needs a null guard | §6 | If it already returns `"—"`, the null guard is a no-op (harmless) |

**All other claims in this document are VERIFIED by codebase grep or CITED from official docs.**

---

## Open Questions

1. **OKX OHLCV depth for `history-candles`**
   - What we know: OKX standard `candles` endpoint = 1440 candles max (no time filter). `history-candles` exists but exact retention per instrument is undocumented.
   - What's unclear: Whether daily candles for a 2-year window reliably available.
   - Recommendation: Verify in Plan 07-02 implementation by making a test call with `bar=1D, before=<2-years-ago-epoch>`. If unavailable, fall back to CoinGecko for OKX OHLCV.

2. **DB trigger on `profiles` auto-creating a portfolio**
   - What we know: OnboardingWizard has no insert. No migration found in grep of Phase 06 changes.
   - What's unclear: A very early migration (001–009) may have added an `on_auth_user_created` trigger.
   - Recommendation: Plan 07-06 task must grep migrations 001–009 for trigger definitions before declaring PURGE-05 a no-op.

3. **`reconstruct_allocator_history` job: enqueue on API key add vs. separate trigger**
   - What we know: Phase 06 `request_allocator_holdings_sync` enqueues `poll_allocator_positions` immediately on key add.
   - What's unclear: Should the same RPC also enqueue `reconstruct_allocator_history`, or should Phase 07 add a separate `request_allocator_history_reconstruction` RPC?
   - Recommendation: Extend `request_allocator_holdings_sync` to also enqueue `reconstruct_allocator_history` (with a different idempotency key prefix). Avoids a new RPC and keeps the "on first connect" logic co-located.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| ccxt (Python) | equity_reconstruction.py | ✓ | Phase 06 pin | — |
| supabase-py | equity_reconstruction.py | ✓ | Phase 06 pin | — |
| pg_cron (Postgres extension) | refresh_allocator_equity cron | ✓ | Production DB | Local dev: skip cron, invoke RPC manually |
| CoinGecko free API | Token price fallback | ✓ (free tier, no key) | v3 | Paid tier if >20 allocators with disjoint portfolios |

---

## Sources

### Primary (HIGH confidence)
- `src/lib/queries.ts` lines 490–850 — `getMyAllocationDashboard` + `getRealPortfolio` + `MyAllocationDashboardPayload` interface (codebase, verified)
- `src/lib/demo.ts` — `ALLOCATOR_ACTIVE_ID`, `isDemoPortfolioId` definitions (codebase, verified)
- `src/components/auth/OnboardingWizard.tsx` — no portfolio insert (codebase, verified)
- `analytics-service/services/job_worker.py` — `TIMEOUT_PER_KIND`, `dispatch()`, `_allocator_key_preflight`, `run_poll_allocator_positions_job` (codebase, verified)
- `analytics-service/services/allocator_positions.py` — Phase 06 ccxt pattern, DeribitNotSupportedError (codebase, verified)
- `analytics-service/services/scheduled_tasks.py` — daily enqueue loop pattern (codebase, verified)
- `supabase/migrations/066_allocator_holdings.sql` lines 703–725 — exact 3-tier RLS policies (codebase, verified)
- `supabase/migrations/066_allocator_holdings.sql` lines 597–692 — cron pattern, pg_cron scheduling (codebase, verified)
- `src/components/auth/ProfileTabs.tsx` — tab URL sync pattern with `router.replace` + `scroll: false` (codebase, verified)
- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-search-params.md` line 82 — Suspense boundary requirement for `useSearchParams` in Next.js 16 (official docs, verified)
- `.planning/phases/07-demo-mode-purge/07-UI-SPEC.md` — component inventory, spacing, color contracts (project docs, verified)
- `src/app/(dashboard)/allocations/AllocationDashboard.tsx` — KPI, InsightStrip, DrawdownChart props passed (codebase, verified)
- `src/app/(dashboard)/allocations/widgets/performance/EquityCurve.tsx` — `data.strategies[].strategy_analytics.daily_returns` input shape (codebase, verified)
- `src/app/(dashboard)/allocations/widgets/performance/DrawdownChart.tsx` — `data.compositeReturns` input shape (codebase, verified)
- `src/components/portfolio/InsightStrip.tsx` — `analytics: PortfolioAnalytics | null` input contract (codebase, verified)

### Secondary (MEDIUM confidence)
- [CITED: https://www.okx.com/docs-v5/en/#rest-api-trade-get-transaction-details-last-3-months] — OKX 3-month trade history cap
- [CITED: https://www.coingecko.com/en/api/pricing] — CoinGecko free tier ~30 req/min rate limit

### Tertiary (LOW confidence)
- Binance `myTrades` full lifetime availability [ASSUMED — common knowledge but no official retention policy URL verified in this session]
- Bybit deposit/withdrawal history full lifetime [ASSUMED — no hard cap documented, but not verified against official Bybit v5 docs in this session]

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — Phase 06 dependencies fully verified in codebase
- Architecture: HIGH — all component/query/worker patterns verified by reading source files
- Exchange feasibility: MEDIUM — OKX cap CITED; Binance/Bybit ASSUMED for full history depth
- RLS patterns: HIGH — migration 066 read verbatim
- OnboardingWizard / seed path: HIGH — source file read in full
- Pitfalls: HIGH — derived from direct inspection of job_worker.py, ProfileTabs.tsx, Next.js 16 docs

**Research date:** 2026-04-20
**Valid until:** 2026-05-20 (30 days for stable stack; exchange API retention policies may change)
