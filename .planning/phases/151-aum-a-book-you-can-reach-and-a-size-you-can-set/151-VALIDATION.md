---
phase: 151
slug: aum-a-book-you-can-reach-and-a-size-you-can-set
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-07
---

# Phase 151 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Details in 151-RESEARCH.md `## Validation Architecture` — this file is the
> execution-time sampling contract; the planner fills the per-task map.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (TS) + pytest (analytics-service) |
| **Config file** | `vitest.config.ts` / `analytics-service/pyproject.toml` |
| **Quick run command** | `npx vitest run <touched-test-file> --no-file-parallelism` / `cd analytics-service && python -m pytest tests/<touched> -q` |
| **Full suite command** | `npm test` / `cd analytics-service && python -m pytest -q` (MUST run from analytics-service/ — VCR cassette dir) |
| **Estimated runtime** | quick ~10-30s; full vitest ~5min, pytest ~3min |

---

## Sampling Rate

- **After every task commit:** Run the quick command for the touched surface
- **After every plan wave:** Run the full suite for the touched language(s); `mypy --strict` on analytics-service before any ship
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~300 seconds

---

## Per-Task Verification Map

*(Planner fills task rows; oracle rules below are binding.)*

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD by planner | — | — | AUM-01..05 | — | — | unit/route | — | — | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Binding Oracle Rules (economic invariants, not self-referential)

- **AUM-01 sizing:** oracle is the ECONOMIC identity `dollar = weight × AUM` and
  `weight = dollar / AUM` round-trip on composed state — not the implementation's own
  formula. Dollar edit MUST route through `setWeightOverride` (test the wiring: neuter the
  route and the test must fail). Sole-unit weight edit REFUSES, never renormalizes.
- **AUM-02/05 class:** parametrized test shape over venues — the SAME test parametrizes
  mt5 (`account_info`, never `fetch_balance`) AND sfox (`get_balances`) AND asserts an
  unknown non-ccxt venue yields honest skip `(rows=[], human warning)` — never a raw
  Python identifier in `sync_error` (greppable invariant per UI-SPEC).
- **AUM-04 gate:** additive field — assert the EXISTING `perKeyDailiesGateSatisfied`
  consumers (liveBaselineMetrics, usePerKeySources, MEMBER-04 stamp) are UNCHANGED, and
  the new gate excludes strategy-linked (manager) keys via BOTH link forms
  (`strategies.api_key_id` + `strategy_keys`).
- **AUM-03 copy:** grep-gate: old string "toggle on a live holding" absent repo-wide in
  src/ (excluding tests pinning the NEW copy); refusal copy names only real affordances.
- **Commit audit:** blank-mode manual-AUM commit audits via additive `manual_aum_usd`
  sentinel — never silently `_size_source: "no_holdings_snapshot"`/size 0.

---

## Wave 0 Requirements

- [ ] Existing infrastructure covers all phase requirements (vitest + pytest present);
      new test files land beside their surfaces per repo convention.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Founder's real book reaches "From my book" (8 keys, 3 deribit + 3 mt5 zero-dailies) | AUM-04 | PROD data state | Founder account: composer shows "From my book" segment; partial-book note lists non-contributing keys |
| MT5 holdings row appears after sync on PROD | AUM-02 | Live terminal + cron | After 04:00 cron or "Sync now": mt5 key shows holdings row, `sync_status` ≠ error, no AttributeError in `sync_error` |
