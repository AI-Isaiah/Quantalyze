# Portfolio Intelligence Platform — Design Spec

**Date:** 2026-04-06
**Status:** Design approved, pending implementation plan
**Author:** Brainstorming session
**Scope:** Portfolio management dashboard, advanced analytics engine, landing page strategy verification

## Problem Statement

Quantalyze's allocator clients face three interconnected problems:

1. **Attribution distortion**: When allocators change allocation amounts mid-month (especially deposits), simple return calculations use total capital as the base, making performance look worse than it is. Example: depositing $200K on the last day of the month makes a +10% month look like +5%.

2. **No correlation visibility**: Allocators don't know which of their strategies are uncorrelated. A mediocre-returning strategy that's uncorrelated with everything else is worth keeping for diversification, but allocators can't see this today.

3. **No verification for off-platform strategies**: Allocators frequently find strategy managers through Telegram, Twitter, or referrals but have no technical means to verify claimed performance. They're making allocation decisions on trust.

## Solution Overview

Three interlocking features that transform Quantalyze from a strategy marketplace into a portfolio intelligence platform:

1. **Portfolio Management Dashboard (PMS)** — Allocators connect multiple API keys (one per strategy/manager), see aggregated and per-strategy performance with proper time-weighted returns, correlation analysis, attribution, and risk decomposition.

2. **Advanced Analytics Engine** — TWR, MWR, correlation matrix, attribution analysis, risk decomposition, and portfolio optimization. Runs on the existing Python analytics service.

3. **Landing Page Strategy Verification** — Anonymous users upload a read-only API key on the landing page, get real-time performance analysis in 2-5 minutes. Captures email, feeds the strategy database, triggers manager outreach.

## Data Model

### Core Assumption

Each strategy manager gets their own exchange account or sub-account. The allocator has separate API keys, one per manager/strategy. This means: **one API key = one strategy = one PnL stream**.

### New Database Tables

```sql
-- Allocation events track deposits/withdrawals over time
-- This is what makes TWR computation possible
CREATE TABLE allocation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id UUID NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  strategy_id UUID NOT NULL REFERENCES strategies(id),
  event_type TEXT NOT NULL CHECK (event_type IN ('deposit', 'withdrawal')),
  amount NUMERIC NOT NULL,
  event_date TIMESTAMPTZ NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Portfolio-level computed analytics
CREATE TABLE portfolio_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id UUID NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  computed_at TIMESTAMPTZ DEFAULT NOW(),
  computation_status TEXT DEFAULT 'pending'
    CHECK (computation_status IN ('pending', 'computing', 'complete', 'failed')),
  computation_error TEXT,

  -- Aggregate metrics
  total_aum NUMERIC,
  total_return_twr NUMERIC,       -- time-weighted (manager skill)
  total_return_mwr NUMERIC,       -- money-weighted (allocator experience)
  portfolio_sharpe NUMERIC,
  portfolio_volatility NUMERIC,
  portfolio_max_drawdown NUMERIC,
  avg_pairwise_correlation NUMERIC,

  -- Period returns (all TWR)
  return_24h NUMERIC,
  return_mtd NUMERIC,
  return_ytd NUMERIC,

  -- Rich analytics (JSONB)
  correlation_matrix JSONB,        -- {strategy_id: {strategy_id: correlation}}
  attribution_breakdown JSONB,     -- [{strategy_id, weight, twr, mwr, contribution}]
  risk_decomposition JSONB,        -- [{strategy_id, marginal_risk, component_var, standalone_vol}]
  benchmark_comparison JSONB,      -- {btc: {alpha, beta, info_ratio}, eth: {...}}
  optimizer_suggestions JSONB,     -- [{strategy_id, corr_with_portfolio, sharpe_lift, dd_improvement}]

  -- Time series
  portfolio_equity_curve JSONB,    -- [{date, value}]
  rolling_correlation JSONB        -- [{date, avg_correlation}]
);

-- Landing page verification requests
CREATE TABLE verification_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  exchange TEXT NOT NULL CHECK (exchange IN ('binance', 'okx', 'bybit')),
  api_key_encrypted BYTEA NOT NULL,
  api_secret_encrypted BYTEA NOT NULL,
  passphrase_encrypted BYTEA,      -- OKX only
  dek_encrypted BYTEA NOT NULL,
  nonce BYTEA NOT NULL,

  status TEXT DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'complete', 'failed')),
  error_message TEXT,

  -- Results (same structure as strategy_analytics)
  results JSONB,

  -- Linking
  matched_strategy_id UUID REFERENCES strategies(id),
  discovered_manager_id UUID REFERENCES profiles(id),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
```

### Modified Existing Tables

The `portfolios` table already exists with `id, user_id, name, description, created_at`. No changes needed.

The `portfolio_strategies` junction table (if it exists) needs allocation tracking:

```sql
-- Extend the portfolio-strategy relationship
ALTER TABLE portfolio_strategies ADD COLUMN allocated_amount NUMERIC;
ALTER TABLE portfolio_strategies ADD COLUMN allocated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE portfolio_strategies ADD COLUMN current_weight NUMERIC;
```

## Feature 1: Portfolio Management Dashboard

### Route Structure

| Route | Purpose |
|-------|---------|
| `/portfolios` | List all portfolios with summary metrics |
| `/portfolios/[id]` | Main portfolio dashboard |
| `/portfolios/[id]/manage` | Add/remove strategies, log allocation events |

### Dashboard Layout (`/portfolios/[id]`)

#### Top Row: Portfolio KPIs (6 metrics)

| Metric | Source | Color Logic |
|--------|--------|-------------|
| Total AUM | Sum of current allocations | Neutral |
| 24h Return (TWR) | portfolio_analytics.return_24h | Green/red on sign |
| MTD Return (TWR) | portfolio_analytics.return_mtd | Green/red on sign |
| YTD Return (TWR) | portfolio_analytics.return_ytd | Green/red on sign |
| Avg Pairwise Correlation | portfolio_analytics.avg_pairwise_correlation | Green < 0.3, Yellow 0.3-0.6, Red > 0.6 |
| Portfolio Sharpe | portfolio_analytics.portfolio_sharpe | Green > 1.5, Yellow 0.5-1.5, Red < 0.5 |

Each KPI shows value + range bar (min/max across history) + micro sparkline.

#### YTD PnL by Strategy (chart)

Multi-line chart with one equity curve per strategy, overlaid on the same axes. Toggle between PnL ($) and Return (%). Uses existing `strategy_analytics.returns_series` data for each strategy in the portfolio.

#### MTD Contribution by Strategy (bar chart)

Horizontal bar chart, ranked by contribution (largest positive at top, largest negative at bottom). Each bar shows actual $ contributed. Colors: green for positive, red for negative.

Contribution = strategy_weight * strategy_MTD_TWR * portfolio_AUM_at_month_start

#### Portfolio vs Benchmarks (chart)

Line chart overlaying portfolio equity curve against BTC, ETH, and optionally S&P500. Below the chart, a stats row:

| Benchmark | Alpha | Beta | Information Ratio | Tracking Error |
|-----------|-------|------|-------------------|----------------|
| BTC | +12.3% | 0.45 | 1.2 | 8.3% |
| ETH | +18.7% | 0.32 | 0.9 | 12.1% |

#### Correlation Matrix (heatmap)

NxN heatmap where N = number of strategies in portfolio. Color scale: dark green (-1, perfect negative correlation) to white (0) to dark red (+1, perfect positive correlation).

Click any cell to see a rolling 30-day correlation chart for that pair.

#### Risk Attribution

Stacked bar showing % of portfolio volatility contributed by each strategy. Below it, a table:

| Strategy | Weight | Standalone Vol | Contribution to Risk | MCR | Assessment |
|----------|--------|---------------|---------------------|-----|------------|
| Alpha-7 | 42% | 28% | 55% | 1.31 | Risk-concentrated |
| Beta-3 | 33% | 18% | 30% | 0.91 | Risk-neutral |
| Gamma-1 | 25% | 12% | 15% | 0.60 | Risk-efficient |

Assessment: MCR > 1.2 = "risk-concentrated", 0.8-1.2 = "risk-neutral", < 0.8 = "risk-efficient"

#### Portfolio Composition

Donut chart showing allocation weights. Table below with: strategy name, allocated amount, weight %, TWR, MWR, Sharpe.

#### Strategy Table (detailed breakdown)

Full sortable table with all strategies:

| Column | Description |
|--------|-------------|
| Strategy | Name + health score badge |
| Allocation | Current $ amount |
| Weight | % of portfolio |
| TWR | Time-weighted return (manager skill) |
| MWR | Money-weighted return (allocator experience) |
| Sharpe | Strategy-level Sharpe ratio |
| Avg Corr | Average correlation with other strategies |
| Contribution | $ and % contributed to portfolio return |
| Risk Share | % of portfolio risk attributable |

#### Strategies That Would Improve This Portfolio (optimizer)

Recommendations from the Quantalyze strategy database. For each published strategy NOT in the portfolio:
- Compute correlation with current portfolio
- Simulate adding at 10% weight
- Calculate: Sharpe improvement, correlation reduction, max DD improvement
- Rank by composite improvement score

Show top 5 suggestions with [Request Introduction] button linking to existing contact request flow.

### Manage Allocations Page (`/portfolios/[id]/manage`)

- Add strategy to portfolio (search from connected strategies or Quantalyze database)
- Set allocation amount and date
- Log allocation events (deposit/withdrawal with date and amount)
- Remove strategy from portfolio
- Timeline view of all allocation events

## Feature 2: Analytics Engine

All computation runs on the existing Python analytics service (Railway). New API endpoints.

### Time-Weighted Return (TWR)

**Formula:** Chain-link sub-period returns around each external cash flow.

```
For each strategy in portfolio:
  1. Get daily equity snapshots from exchange API
  2. Get allocation events from allocation_events table
  3. Break timeline into sub-periods at each event
  4. Sub-period return = (end_value - start_value) / start_value
  5. TWR = Π(1 + sub_period_return) - 1
```

**For portfolio-level TWR:**
- Weight each strategy's sub-period return by its allocation weight
- Chain-link the weighted sub-period returns

**Modified Dietz approximation** when daily data gaps exist:
```
R = (End - Start - Cash Flows) / (Start + Σ(CF_i × weight_i))
where weight_i = (total_days - day_of_flow) / total_days
```

### Money-Weighted Return (MWR / IRR)

Solve for r in:
```
Σ CF_i / (1 + r)^t_i = 0
```
Using Newton-Raphson method. Reflects the allocator's actual experience including timing.

### Correlation Analysis

**Input:** Daily returns for each strategy (existing `strategy_analytics.daily_returns`)

**Static correlation:**
```python
import numpy as np
returns_matrix = np.array([strategy_daily_returns for each strategy])
correlation_matrix = np.corrcoef(returns_matrix)
avg_pairwise = (correlation_matrix.sum() - N) / (N * (N - 1))
```

**Rolling correlation (30-day window):**
For each pair, compute correlation over a sliding 30-day window. Useful for detecting: strategies that correlate during drawdowns but not rallies.

### Attribution Analysis

For each period (day/week/month/YTD):
```
contribution_i = weight_i × TWR_i
allocation_effect = Σ (weight_i - equal_weight) × (TWR_i - portfolio_TWR)
```

This decomposition tells the allocator: "Your allocation decisions (overweighting Alpha-7) added +2.3% vs equal-weight."

### Risk Decomposition

**Marginal Contribution to Risk (MCR):**
```
MCR_i = weight_i × Σ_j(weight_j × cov_ij) / portfolio_volatility
```

**Component VaR** at 95% confidence:
```
CVaR_i = weight_i × beta_i × portfolio_VaR
```

### Portfolio Optimizer

For each candidate strategy (published on Quantalyze, not in portfolio):
1. Fetch candidate's daily returns
2. Compute correlation with each existing strategy and portfolio aggregate
3. Simulate adding at 10% weight (scale down existing weights proportionally)
4. Compute: new Sharpe, new avg correlation, new max drawdown
5. Improvement score = w1*(Sharpe_lift) + w2*(corr_reduction) + w3*(DD_improvement)
   Default weights: w1=0.4, w2=0.3, w3=0.3

### Benchmark Comparison

Fetch benchmark return series:
- **BTC:** CoinGecko API or exchange spot price history
- **ETH:** Same source
- **S&P500:** Yahoo Finance API (optional)

Compute alpha, beta, information ratio, tracking error for portfolio vs each benchmark.

### New API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/portfolio-analytics` | POST | Compute all portfolio analytics |
| `/api/portfolio-optimizer` | POST | Run optimizer against strategy database |
| `/api/verify-strategy` | POST | Landing page real-time analysis |
| `/api/allocation-events` | GET/POST | CRUD for allocation events |

## Feature 3: Landing Page Strategy Verification

### User Flow

1. **Entry point:** New section on landing page between "How It Works" and "Social Proof"
2. **Headline:** "Verify Any Strategy's Performance"
3. **Subhead:** "Got a read-only API key? We'll analyze the real performance in minutes. No account needed."
4. **Form fields:**
   - Exchange selector (Binance/OKX/Bybit)
   - API Key (text input)
   - API Secret (password input)
   - Passphrase (password input, shown only for OKX)
   - Email (for receiving the report)
5. **Submit:** "Analyze Performance" button
6. **Processing state:** Step-by-step progress indicator (2-5 minutes):
   - Verifying API key permissions... [checkmark]
   - Fetching account history... [checkmark]
   - Computing performance metrics... [spinner]
   - Generating report... [pending]
7. **Results shown on-page:**
   - Performance summary: Total Return, CAGR, Sharpe, Max DD, Volatility
   - Equity curve chart (mini version)
   - Monthly returns heatmap
   - Key risk metrics
8. **CTAs:**
   - "Download PDF Report" (emails to provided address)
   - "Create Free Account" (to track this strategy in a portfolio)

### Backend Logic

1. Validate read-only permissions (reuse existing `validateApiKey` logic)
2. Encrypt and store key material (reuse existing encryption with KEK)
3. Fetch account data via exchange API (reuse existing sync logic)
4. Run analytics pipeline (same as `strategy_analytics` computation)
5. Store results in `verification_requests` table
6. If API key's exchange account matches a known strategy manager on Quantalyze, link via `matched_strategy_id`
7. If unknown, flag as discovered lead for outreach

### Rate Limiting

- 3 verifications per email per day
- 10 verifications per IP per day
- API key can only be verified once per 24 hours (cache results)

### Security

- Same encryption as existing API key storage (AES-256-GCM with KEK)
- Read-only verification happens before any data fetch
- Keys for anonymous verifications are deleted after 30 days (configurable)
- Never expose raw API keys in frontend or logs

## Growth Flywheel

```
Allocator verifies strategy on landing page
  → sees impressive real-time results
  → creates account to track strategy
  → adds more strategies to portfolio
  → portfolio optimizer suggests strategies from database
  → allocator requests introductions
  → managers join Quantalyze to manage their listing
  → more strategies available
  → more allocators find value
  → more verifications on landing page...
```

Additionally: "When an allocator uploads a key linked to a strategy manager NOT on Quantalyze, the platform detects this and can reach out to that manager." This creates inbound demand from allocators pulling managers into the platform.

## UI/UX Constraints

- Follow DESIGN.md: DM Sans body, Instrument Serif display, Geist Mono for numbers
- Color: muted teal #1B6B5A accent, restrained palette
- Charts: use the project's existing chart library (check components/charts/)
- Density: comfortable but tighter than typical SaaS (per DESIGN.md)
- No decorative elements, gradients, or blobs
- Cards with 1px border, 8px radius, subtle shadow
- All numbers in Geist Mono with tabular-nums

## Error & Edge Cases

| Scenario | Handling |
|----------|----------|
| Strategy with < 30 days data | Show TWR with "Limited data" warning. Exclude from correlation/optimizer. |
| Single strategy portfolio | Skip correlation matrix and optimizer. Show strategy-level metrics only. |
| API key sync failure | Show last successful data with "Stale data" warning. Retry on next cron cycle. |
| Landing page key is invalid | Immediate error: "This key doesn't have the required permissions." |
| Landing page key already on platform | Show: "This strategy is already verified on Quantalyze" with link to factsheet. |
| Allocator logs no allocation events | Fall back to simple returns (no TWR). Prompt to log events for accurate attribution. |
| Correlation matrix with < 3 strategies | Show simplified view without heatmap. Note: "Add more strategies for correlation analysis." |
| Optimizer finds no improvement candidates | Show: "Your portfolio is well-diversified. No significant improvements found." |

## Success Criteria

1. Allocator can create a portfolio, add strategies, log allocation events, and see TWR that correctly handles mid-month deposits
2. Correlation matrix identifies uncorrelated strategies with < 0.3 average pairwise correlation flagged as "well-diversified"
3. Portfolio optimizer recommends strategies that would genuinely improve portfolio Sharpe by > 0.1
4. Landing page verification delivers results in < 5 minutes for a typical 6-month history
5. Landing page verification captures email and correctly identifies unknown strategy managers for outreach
6. All analytics match manual calculation within 0.5% tolerance
