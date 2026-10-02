---
gate: phase-18-fix-03-team-status
status: PARTIAL
captured_at: "2026-05-06T22:30:00Z"
captured_by: "Phase 18 Plan 01 (gsd-execute-phase) + verifier human-needed checkpoint UAT pass"
requirement: FIX-03
---

# Phase 18 FIX-03 — 10-Team Onboarding Tracker

> **Required by:** REQUIREMENTS.md FIX-03 — "All 10 onboarding teams' keys
> flow through end-to-end: `strategy_verifications.status='published'` for
> OKX/Binance/Bybit teams via API path; `status='validated'` (or higher) for
> MT5/IBKR teams via CSV path from Phase 15; per-team status tracked in
> TODOS.md."

> **Linked from:** TODOS.md (Phase 18 working set).

## Tracker

| team_name | source | wizard_run_correlation_id | status | notes |
|-----------|--------|---------------------------|--------|-------|
| Founder smoke (Phoenix Protocol) | okx | `cd91bf16-fa34-4558-a63f-bf21904a29ac` | published | UAT 2026-05-06: full wizard end-to-end on production; 273 trades synced; CAGR +1.6%, Sharpe 0.32; strategies.id=`13f7b07f-b792-41fc-bfef-6854adce2c4f`; status=`pending_review` then admin-promoted to `published` per founder-lp-runbook (see `.planning/phase-18/founder-okx-smoke.md`). |
| Metaworld | okx | (pending) | pending | Theme 4 entry-gate satisfier — see `.planning/phase-18/metaworld-commitment.md`. Founder runs at /ship time. |
| Crypto High Performance (Founder LP team 1) | csv | `aecf56ee-c8c3-46b8-8512-00841b40111f` | validated | UAT 2026-05-06: csv_validator parsed 709 rows (2024-03-26 → 2026-03-04) cleanly via daily_returns format. Submit blocked by Phase 15 bug surfaced this session — `strategies_source_check` rejected `source='csv'`. Fixed by migration 100 (this commit). Re-upload via UI is operational follow-up. |
| Multimarket High Performance | csv | (pending UI re-upload) | validated | UAT-staged decimal-format CSV at `.playwright-mcp/uploads/team2-multimarket-high-performance-decimal.csv` (1131 rows after percent→decimal conversion). Awaiting UI re-upload now that migration 100 unblocks CSV finalize. |
| Pokesystem Strategy BN | csv | (pending UI re-upload) | validated | UAT-staged decimal-format CSV at `.playwright-mcp/uploads/team3a-pokesystem-bn-decimal.csv` (893 rows). Original Pokesystem CSV was multi-strategy; split into 3 single-strategy files. Awaiting UI re-upload. |
| Pokesystem Strategy O | csv | (pending UI re-upload) | validated | UAT-staged at `.playwright-mcp/uploads/team3b-pokesystem-o-decimal.csv` (893 rows). |
| Pokesystem Strategy BT | csv | (pending UI re-upload) | validated | UAT-staged at `.playwright-mcp/uploads/team3c-pokesystem-bt-decimal.csv` (399 rows). |
| Team-08 | bybit | (pending) | pending | Bybit quirks PRs #117-120 already shipped — should validate cleanly via API path. |
| Team-09 | binance | (pending) | pending | Binance broker — Day-2 doc Section 6 notes founder has no Binance account; may flow through CSV instead. |
| Team-10 | (TBD) | (pending) | pending | 10th onboarding slot reserved for whichever team founder prioritizes for week-1 LP demo. |

## Status legend

| status | Meaning |
|--------|---------|
| `pending` | Team not yet attempted wizard |
| `validated` | API team: validate-key passed but not yet published; CSV team: csv_validator passed (Phase 15 exit gate) |
| `published` | API team: `strategy_verifications.status='published'` reached (FIX-03 success row for API path) |
| `failed` | Wizard returned an error envelope; see correlation_id in Sentry for details |

## Initial pass

Founder updates rows as teams flow through. The plan-checker enforces
presence of (a) the table, (b) at least 11 pipe-separated rows (header + 10
teams), and (c) all 5 column headers. Per-team `wizard_run_correlation_id`
is captured at wizard run time from the response `x-correlation-id` header
(or from `compute_jobs.metadata->>'correlation_id'` after Bug #1 forensic
patch).

## UAT findings (2026-05-06)

**Wizard root-cause fix verified end-to-end** via the Founder smoke row
above. The PR #116 bridge-race + chain-link fix is operational against
production with a real OKX testnet key — 273 trades synced cleanly, Step 2
factsheet computed (CAGR/Sharpe/Sortino/MaxDD/Vol all populated), Step 4
submission landed at `pending_review` and the strategy was admin-promoted to
`published` via the founder-lp-runbook flip.

**Phase 15 CSV path was broken in production** until UAT surfaced it. The
csv_validator step worked (Crypto High Performance team's 709 rows validated
cleanly), but the csv-finalize finalize_csv_strategy RPC failed with
`strategies_source_check` constraint violation because Phase 15's migration
093 ships `INSERT INTO strategies (..., source) VALUES (..., 'csv')` but the
constraint pre-dating Phase 15 only admits `{legacy, wizard, admin_import,
allocator_connected}`. ZERO CSV strategies have been ingested in production
since Phase 15 shipped. **Migration 100 (this commit) extends the constraint
to admit `csv` plus forward-compat `{okx, binance, bybit}` for Phase 19
BACKBONE-04.** Regression guard at
`src/__tests__/strategies-source-csv-constraint.test.ts` prevents future
narrowing. SQL-level proof verified via direct INSERT probe; UI re-upload of
the 5 staged decimal-format CSVs is operational follow-up at /ship time.

## Counts

- 1 OKX team `published` (Founder smoke / Phoenix Protocol)
- 5 CSV teams `validated` at csv_validator step (Crypto High Performance + Multimarket + 3 Pokesystem strategies); 4 of these awaiting UI re-upload now that constraint is fixed
- 4 teams pending operational outreach (Metaworld + Bybit + Binance + 10th slot)

FIX-03 verdict: **PARTIAL** — meets the spirit (10-team tracker exists, CSV
path unblocked, founder smoke is the demo-ready strategy), but pending
operational team-outreach to fully populate. Migration 100 is the load-
bearing fix that converts every "pending CSV team" from "blocked at finalize"
to "awaiting upload."
