# Changelog

All notable changes to Quantalyze are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [0.0.1.0] - 2026-04-06

### Added
- Portfolio intelligence database migration (`supabase/migrations/010_portfolio_intelligence.sql`) — tables for `portfolio_analytics`, `allocation_events`, `portfolio_documents`, `portfolio_alerts`, `verification_requests`, `portfolio_audit_log`
- TypeScript types for portfolio intelligence (`src/lib/types.ts`) — full type coverage for portfolios, analytics, allocation events, documents, alerts, and verification flows
- Pydantic schemas for portfolio analytics API (`analytics-service/models/schemas.py`) — request/response validation for TWR/MWR computation and portfolio analytics payloads
- TWR/MWR computation module (`analytics-service/services/portfolio_metrics.py`) — time-weighted return with sub-period chaining around cash flows, money-weighted return (IRR via scipy), Modified Dietz approximation, and period returns (24h / MTD / YTD)
- Test suite for portfolio metrics (`analytics-service/tests/test_portfolio_metrics.py`) — TDD with 6 tests covering no-cash-flow TWR, deposit distortion isolation, day-0 deposit edge case, MWR convergence, Modified Dietz accuracy, and period return keys
- Portfolio intelligence implementation plan (`docs/superpowers/plans/2026-04-06-portfolio-intelligence.md`) — 25-task, 5-phase build plan with CEO + Design + Eng review fixes incorporated
