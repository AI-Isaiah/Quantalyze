# My Allocation Dashboard Redesign

## Core Concept
A portfolio of quant strategies IS a quant strategy. The allocator's portfolio
deserves the same quantstats analytical depth as any individual strategy page.

## Navigation: Left sub-nav (GenieAI-style)
Nested sidebar within the allocations route. Each section gets full content width.
Timeframe selector is global (shared across all sections).

## Sections

### 1. Overview (enhanced current page)
- **KPI strip** (2 rows x 5): AUM, TWR, CAGR, Sharpe, Sortino, Max DD, Calmar, Alpha, Beta, Volatility
- **Composite equity curve**: multi-strategy + portfolio composite + benchmark overlay
- **Monthly returns heatmap**: quantstats-style, color-coded cells
- **Drawdown chart**: underwater equity curve
- **Allocation donut** + **Correlation matrix** (side by side)

### 2. Performance (quantstats deep dive)
- Rolling Sharpe (30d, 90d, 180d windows)
- Rolling volatility
- Return distribution histogram
- Win rate, profit factor, best/worst periods
- Risk-adjusted returns comparison table

### 3. Contribution by Strategy
- Attribution breakdown: which strategy contributed what to total return
- Strategy comparison table (KPIs side by side)
- Diversification ratio
- Correlation changes over time

### 4. Positions
- Per-strategy current positions (from exchange API data)
- Asset-level breakdown across all strategies
- Exposure summary (long/short, by asset class)

### 5. Trading Activity
- Recent trades across all strategies
- Trade log with date/strategy/asset/side/size/price filters
- Volume chart over time

### 6. Directional Dashboard
- Net exposure over time (line chart)
- Long/short breakdown (stacked bar)
- Sector/asset class exposure treemap

## Data Requirements
- **Already available**: portfolio_analytics (AUM, returns, sharpe, volatility, max_dd,
  correlation_matrix, attribution_breakdown), strategy_analytics (daily_returns, cagr, sharpe)
- **Needs new analytics endpoints**: monthly returns matrix, rolling metrics,
  trade log aggregation, position/exposure breakdown, directional metrics

## Design Constraints (from DESIGN.md)
- Industrial/Utilitarian aesthetic
- Instrument Serif for section headers, DM Sans body, Geist Mono for numbers
- Muted teal #1B6B5A accent
- Data density > card density: prefer tables and shared-axis panels
- Hairline dividers between sections
- 44px touch targets on all interactive elements

## References
- GenieAI Multistrategy Dashboard (primary inspiration for layout + nav)
- getquin portfolio dashboard (holdings table pattern, asset class breakdown)
- parqet portfolio view (performance charts, allocation visualization)

## Implementation Notes
- Current implementation: ~1000 LoC in MyAllocationClient + sub-components
- Refactor into route-based sections: `/allocations/overview`, `/allocations/performance`, etc.
- Or use client-side routing within the allocations page (URL search params for section)
- Python analytics service needs new endpoints for rolling metrics and trade logs
