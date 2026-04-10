# My Allocation Widget-Grid Dashboard — Design Spec

## Core Concept
A portfolio of quant strategies IS a quant strategy. The allocator's portfolio
deserves the same quantstats analytical depth as any individual strategy page.
Every panel is a draggable, resizable widget tile. Allocators build their own view.

## Approved Visual Direction
- **Source**: design-shotgun rounds 1+2, approved A+C remix → refined variant A (Dense Grid)
- **Prototype**: `~/.gstack/projects/AI-Isaiah-Quantalyze/designs/my-allocation-refined-20260410/finalized.html`
- **Widget catalog**: 39 tile mockups at `~/.gstack/projects/AI-Isaiah-Quantalyze/designs/widget-catalog-20260410/`
- **Adversarial reviews**: 3 rounds (Grok x2 + OpenAI x1). Final score: 0 CRITICAL, 0 HIGH remaining.

## Layout

### Sidebar
- 48px wide, dark navy `#0F172A`, icon-only
- 6 section icons: Overview, Performance, Contribution, Positions, Activity, Directional
- Hover: `rgba(255,255,255,0.08)` background, 150ms transition
- Active: teal `#1B6B5A` left border indicator
- `aria-label` on each button, SVGs `aria-hidden="true"`

### Header
- "My Allocation" in Instrument Serif 32px, `letter-spacing: -0.02em`
- Right side: timeframe pill buttons (1D, 1W, 1M, 3M, YTD, ALL) + "+Add Widget" teal button

### KPI Strip
- Single row, 10 metrics in Geist Mono
- Grouped with wider dividers between groups:
  - Returns: AUM, TWR, CAGR
  - Risk-adjusted: Sharpe, Sortino, Calmar
  - Risk: Max DD, Alpha, Beta, Vol
- Green `#16A34A` for positive, red `#DC2626` for negative
- `title` tooltips on each metric with institutional definitions
- "As of" timestamp right-aligned in muted 11px

### Widget Grid
- 12-column CSS grid, 8px gap
- Tiles snap to: 1/4 (span 3), 1/3 (span 4), 1/2 (span 6), full (span 12)
- Free-form height resize (120px min, no max)
- Independent tile sizing — resizing one tile does not affect others
- `grid-auto-flow: row` (not dense) — freed space stays empty with placeholder

## Tile Interactions

### Resize
- **Width**: snap to 1/4, 1/3, 1/2, full via both buttons AND edge-drag
- **Height**: free-form via bottom-edge drag, no snapping
- Charts redraw via ResizeObserver on any resize

### Drag and Drop
- Drag via header handle → tile follows cursor with 0.4 opacity
- Drop on another tile → they SWAP positions (both keep their sizes)
- Drop on empty space → tile fills available columns
- Visual feedback: 3px dashed teal outline + `rgba(27,107,90,0.08)` bg on drop targets

### Close
- × button removes tile with undo toast (10s, `role="alert"`, `aria-live="assertive"`)
- "Recently Closed" section at top of Add Widget modal for recovery

### Placeholder Zones
- When tile narrows, freed columns show dashed-border "+" div labeled with column count ("6-col")
- Clicking placeholder opens Add Widget modal
- New widget fills the placeholder's exact space

## Implementation Stack

| Concern | Library | Why |
|---------|---------|-----|
| Grid layout + drag + resize | `react-grid-layout` | Handles reflow, collision detection, responsive breakpoints, touch support out of the box |
| Tile swapping | `@dnd-kit/core` | For swap-on-drop behavior (RGL does push/shift, not swap) |
| Positions table | `@tanstack/react-table` | Column visibility, column reorder, column resize, sorting, virtual scrolling |
| Charts | `lightweight-charts` + `recharts` (existing) | Already in the project, proven |
| State persistence | Supabase `user_preferences` or `localStorage` | Tile layout config (which tiles, positions, sizes) |

## Default Tile Layout

| Tile | Default Span | Default Height | Content |
|------|-------------|----------------|---------|
| Equity Curve | 12 (full) | 300px | Multi-strategy + composite lines, legend chips, benchmark overlay |
| Drawdown | 12 (full) | 300px | Underwater chart, max DD label |
| Allocation Donut | 4 (1/3) | 180px | SVG donut, center AUM, legend |
| Correlation Matrix | 4 (1/3) | 180px | Heatmap table, color legend bar |
| Monthly Returns | 4 (1/3) | 180px | Year×Month table, green/red cells |
| Positions Table | 6 (1/2) | 300px | Responsive columns by width, column chooser, sortable |

## Widget Catalog (39 tiles)

### Performance (10)
1. Equity Curve — multi-strategy + composite + benchmark
2. Drawdown / Underwater Chart
3. Monthly Returns Heatmap
4. Annual Returns Bar Chart
5. Cumulative Returns vs Benchmark
6. Rolling Sharpe (30d/90d/180d)
7. Rolling Volatility
8. Return Distribution (histogram)
9. Best/Worst Periods Table
10. Win Rate & Profit Factor

### Risk (6)
11. Correlation Matrix (with color legend)
12. Correlation Change Over Time
13. VaR / Expected Shortfall
14. Risk Decomposition
15. Tail Risk Chart
16. Tracking Error vs Benchmark

### Allocation (5)
17. Allocation Donut/Pie
18. Allocation Over Time (stacked area)
19. Weight Drift Monitor
20. Rebalance Suggestions Table
21. Strategy Comparison Table

### Attribution (3)
22. Attribution Waterfall
23. Performance Attribution by Period
24. Alpha/Beta Decomposition

### Positions & Activity (5)
25. Positions Table (responsive columns, column chooser, TanStack Table)
26. Trading Activity Log (filterable)
27. Trade Volume Over Time
28. Exposure by Asset Class
29. Net Exposure Over Time

### Monitoring (4)
30. Portfolio Alerts Panel
31. Exchange Connection Status
32. Strategy Health Scores
33. Data Freshness Indicators

### Intelligence (3)
34. Morning Briefing (AI narrative)
35. Regime Change Detector
36. Concentration Risk Warning

### Meta (3)
37. Custom KPI Strip (configurable metrics)
38. Notes Widget (markdown, editable)
39. Quick Actions (recompute, export PDF, share)

## Positions Table Detail

The positions table uses TanStack Table with these features:

### Responsive Columns by Tile Width
- 1/4 width: Strategy, Weight
- 1/3 width: Strategy, Weight, CAGR
- 1/2 width: Strategy, Weight, Allocated, CAGR, Sharpe
- Full width: all 12 columns (Strategy, Weight, Allocated, CAGR, Sharpe, Max DD, Sortino, Vol, Win Rate, Calmar, Alpha, Beta)

### Column Features
- Gear icon column chooser (dropdown checklist, Strategy locked visible)
- Draggable column borders to resize width (min 60px)
- Sortable column headers (click to toggle asc/desc)
- Monospace numbers in Geist Mono

## Data Requirements

### Already available (portfolio_analytics + strategy_analytics)
- AUM, returns, sharpe, volatility, max_drawdown, avg_pairwise_correlation
- correlation_matrix, attribution_breakdown, narrative_summary
- Per-strategy: daily_returns, cagr, sharpe, volatility, max_drawdown

### Needs new Python analytics endpoints
- Monthly returns matrix (year × month breakdown)
- Rolling metrics (rolling Sharpe, rolling volatility, rolling beta)
- Trade log aggregation (recent trades across strategies)
- Position/exposure breakdown (current holdings per strategy)
- Directional metrics (net exposure, long/short breakdown)
- Risk decomposition (per-strategy contribution to total risk)
- VaR / Expected Shortfall calculation
- Regime detection signal

## Design Constraints (from DESIGN.md)
- Industrial/Utilitarian aesthetic, no gradients, no decorative elements
- Instrument Serif (display), DM Sans (body 14px min), Geist Mono (all numbers 13px min)
- Muted teal `#1B6B5A` accent, warm off-white `#F8F9FA` bg
- Data density > card density
- 44px touch targets, WCAG 2.1 AA accessibility
- `focus-visible` outlines on all interactive elements

## Accessibility Requirements (from adversarial reviews)
- `aria-label` on all interactive elements (sidebar, resize, close, drag)
- `role="img"` + descriptive `aria-label` on canvas charts
- `aria-modal="true"` + focus trap on Add Widget modal
- Skip-nav link to main content
- Toast: `role="alert"`, `aria-live="assertive"`
- Keyboard: Enter/Space on buttons, Shift+Arrow for tile reorder, Escape to close modal

## State Persistence
Tile layout config stored per user:
```ts
interface DashboardConfig {
  tiles: Array<{
    widgetId: string;    // e.g. "equity-curve", "positions-table"
    x: number;           // grid column position
    y: number;           // grid row position  
    w: number;           // width in grid columns (3, 4, 6, 12)
    h: number;           // height in grid rows
    config?: Record<string, unknown>; // widget-specific config (visible columns, etc.)
  }>;
  kpiOrder?: string[];   // custom KPI strip ordering
  timeframe?: string;    // last selected timeframe
}
```
Storage: `localStorage` for MVP, migrate to `user_preferences` Supabase table later.

## File Structure (proposed)
```
src/app/(dashboard)/allocations/
  page.tsx                          # server component, auth + data fetch
  AllocationDashboard.tsx           # client component, grid + state
  components/
    DashboardGrid.tsx               # react-grid-layout wrapper
    TileWrapper.tsx                 # tile chrome (header, drag handle, resize, close)
    AddWidgetModal.tsx              # modal with 39-widget catalog
    KpiStrip.tsx                    # 10-metric strip with tooltips
    UndoToast.tsx                   # toast with undo + aria-live
    PlaceholderZone.tsx             # dashed "+" zones in freed space
  widgets/
    performance/
      EquityCurve.tsx
      DrawdownChart.tsx
      MonthlyReturns.tsx
      AnnualReturns.tsx
      CumulativeVsBenchmark.tsx
      RollingSharpe.tsx
      RollingVolatility.tsx
      ReturnDistribution.tsx
      BestWorstPeriods.tsx
      WinRateProfitFactor.tsx
    risk/
      CorrelationMatrix.tsx
      CorrelationOverTime.tsx
      VarExpectedShortfall.tsx
      RiskDecomposition.tsx
      TailRisk.tsx
      TrackingError.tsx
    allocation/
      AllocationDonut.tsx
      AllocationOverTime.tsx
      WeightDriftMonitor.tsx
      RebalanceSuggestions.tsx
      StrategyComparison.tsx
    attribution/
      AttributionWaterfall.tsx
      PerformanceByPeriod.tsx
      AlphaBetaDecomposition.tsx
    positions/
      PositionsTable.tsx            # TanStack Table
      TradingActivityLog.tsx
      TradeVolume.tsx
      ExposureByAsset.tsx
      NetExposure.tsx
    monitoring/
      PortfolioAlerts.tsx
      ExchangeStatus.tsx
      StrategyHealth.tsx
      DataFreshness.tsx
    intelligence/
      MorningBriefing.tsx
      RegimeDetector.tsx
      ConcentrationRisk.tsx
    meta/
      CustomKpiStrip.tsx
      NotesWidget.tsx
      QuickActions.tsx
  hooks/
    useDashboardConfig.ts           # localStorage + state management
    useWidgetData.ts                # data fetching per widget type
    useTimeframe.ts                 # shared timeframe state
  lib/
    widget-registry.ts              # catalog metadata (name, icon, category, default size)
    dashboard-defaults.ts           # default tile layout
```

## Testing Strategy
- Unit tests: each widget component renders with mock data
- Integration test: DashboardGrid renders default layout, resize/close work
- E2E: add widget, resize, close + undo, verify persistence on reload
