---
phase: 65-authed-prod-canary
plan: 01
status: complete
completed: 2026-07-04
requirements: [GUARD-04]
files_modified: []
---

# Phase 65 Plan 01 — Authed Prod Canary — SUMMARY

Live verification of the purified scenario surfaces on authed prod
(quantalyze.xyz @ v0.36.0.0, squash `f78f036b`), qa-demo via service-role
magic link in the Playwright MCP browser, Atlas book. **All checklist items
passed; zero bugs found; zero code changes.**

- **SC1** — book blend ("Mean of 4 strategies", per-key rows), blank-slate
  honesty (no holdings resurrection), mixed keys+added ("Mean of 5
  strategies", weight moves the blend), KPI strip return-form only (4 cells,
  0 "AUM" hits). 0 unexpected console errors.
- **SC2** — save→reopen membership round-trip verified at the persisted-draft
  layer (`schema_version: 4`, all 4 `memberKeyIds` intact after
  Update-from-blank-session — the red-team F-1 fix verified live); compare
  computes on persisted membership (saved column Sharpe == composer Sharpe);
  mixed share mints, public page carries the verbatim honesty caption, leak
  grep 0 hits for all member UUIDs logged-out; book-only mint 409s with the
  honest message verbatim.
- **SC3** — C2b fallback (no v3 draft survived, as expected): fresh book-only
  compare column Cum +0.05% / Sharpe 0.11 @ 40-day window, Live book 155
  overlapping days — Sharpe/window/day-count match the P61 goldens exactly;
  Mean-of-5 golden reproduced.
- **Cleanup** — both canary scenarios deleted (API list back to []), share
  link 404s post-delete.

Evidence: `65-VERIFICATION.md` (per-item, P61 format) + screenshots
`p65-a1-a2-book-blend-kpi.png`, `p65-a4-mean-of-5-mixed.png`,
`p65-b3-mixed-share-caption.png` (`.playwright-mcp/` session dir).

Deviations from plan: none. One observational note (not a bug): draft
`weightOverrides` carries `holding:*`-keyed book-composition weights — draft
data, not engine unit ids; ENGINE-05 unaffected.
