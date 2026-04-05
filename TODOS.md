# TODOS

## Discovery & Analytics
- **P1** Correlation/overlap analysis for portfolios (quants.space has this)
- **P2** Real-time monitoring dashboard for strategies
- **P2** Monte Carlo simulation chart
- **P3** MAE/MFE analysis (FXBlue feature)
- **P3** Visual gauge scales for metrics (TradeLink feature)

## Organizations
- **P1** Organizations feature: teams sharing strategies, API keys, portfolios
  - `organizations`, `organization_members`, `organization_invites` tables (migration 006 drafted)
  - Profile page "Organizations" tab with create/invite/accept UI
  - Strategies become org-scoped
  - Shared API keys within org
- **P2** Organization billing/permissions tiers

## Strategy Management
- **P2** Embeddable "Verified by Quantalyze" widget for external sites
- **P2** Leaderboard / ratings system
- **P3** Multi-account strategy aggregation
- **P3** Automated accreditation checks (KYC/AML)

## Infrastructure & Security
- **P1** Deploy analytics service to Railway (required for API key validation + analytics computation)
- **P1** Enable RLS on `benchmark_prices` table (prevents price data poisoning)
- **P2** Redis / BullMQ for heavy compute jobs (when compute >30s)
- **P2** Billing / pricing tiers (free tier first, monetize after PMF)
- **P3** Real-time WebSocket data sync

## UX & Design
- **P1** Dark mode toggle
- **P1** Mobile strategy card layout fix (cramped on 375px)
- **P2** /design-review visual polish pass
- **P2** Accessibility audit (WCAG AA)
- **P3** White-label verification API
- **P3** Mobile app / PWA

## Marketing
- **P2** Aggregate social proof stats on landing page ($X AUM, N+ teams)
- **P2** Speed-to-allocation SLA messaging ("20 days avg")
- **P3** Landing page / marketing site

## Completed
