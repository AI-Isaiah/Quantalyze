---
phase: 13
slug: discovery-v2-polish
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-28
---

# Phase 13 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> **Authoritative source:** `13-RESEARCH.md` `## Validation Architecture` section (line 952). This file is the per-task ledger that the executor and verifier read; the rationale lives in RESEARCH.md.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Unit / component framework** | Vitest 3.x (per `package.json` `"test": "vitest run"`) |
| **E2E framework** | Playwright (per `playwright.config.ts`, `testDir: "./e2e"`) |
| **Quick run command** | `npm test` (vitest unit, ~30s) |
| **Discovery-scoped E2E** | `npm run test:e2e -- --grep "discovery"` |
| **Full suite command** | `npm test && npm run test:e2e` |
| **Estimated runtime** | ~30s unit + ~3–5 min e2e |

---

## Sampling Rate

- **After every task commit:** Run `npm test` (vitest unit suite, <30s).
- **After every plan wave:** Run `npm run test:e2e -- --grep "discovery"` (scoped Playwright).
- **Before `/gsd-verify-work`:** Full suite must be green; visual regression snapshot captured.
- **Max feedback latency:** ~30s per task (unit), ~5min per wave (e2e).

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD-01 | 13-01 | 0 | DISCO-01 | T-01 CSRF / T-02 DoS | Watchlist PUT idempotent + rate-limited | Vitest unit | `npm test -- src/app/api/watchlist` | ❌ — Wave 0 creates `route.test.ts` | pending |
| TBD-02 | 13-01 | 1 | DISCO-01 | — | Star toggle persists across reload | Playwright | `npm run test:e2e -- --grep "watchlist toggle"` | ❌ — Wave 0 creates `e2e/discovery-watchlist.spec.ts` | pending |
| TBD-03 | 13-01 | 1 | DISCO-01 | — | "All" / "My Watchlist" tabs swap visible row sets | Vitest + RTL | `npm test -- StrategyTable` | ❌ — Wave 0 creates `StrategyTable.test.tsx` | pending |
| TBD-04 | 13-02 | 0 | DISCO-02 | — | localStorage key shape is `discovery_view_preferences:{auth.uid}:{slug}`; defaults match | Vitest | `npm test -- discovery-prefs` | ❌ — Wave 0 creates `discovery-prefs.test.ts` | pending |
| TBD-05 | 13-02 | 1 | DISCO-02 | T-04 leak | Cross-account isolation: A-keys not readable in B | Playwright | `npm run test:e2e -- --grep "discovery prefs isolation"` | ❌ — Wave 0 creates `e2e/discovery-prefs-isolation.spec.ts` | pending |
| TBD-06 | 13-04 | 0 | DISCO-04 | — | Sparkline final-value-sign rule applied at the two `sparkline_returns` call sites | Vitest + RTL | `npm test -- "Sparkline call site"` | ❌ — Wave 0 creates `StrategyTable.test.tsx` | pending |
| TBD-07 | 13-04 | 1 | DISCO-04 | — | No SVG path in `/discovery/[slug]` mixes `#16A34A` and `#DC2626` strokes | Playwright | `npm run test:e2e -- --grep "sparkline single-accent"` | ❌ — Wave 0 creates `e2e/discovery-sparkline-regression.spec.ts` | pending |
| TBD-08 | 13-05 | 1 | DISCO-05 | — | Fresh allocator's first Discovery visit shows zero example strategies | Playwright | `npm run test:e2e -- --grep "fresh allocator hides examples"` | ❌ — Wave 0 creates `e2e/discovery-hide-examples-default.spec.ts` | pending |
| TBD-09 | 13-05 | 1 | DISCO-05 | — | After data backfill, all 8 seed UUIDs have `is_example=true` | SQL probe | manual / scripted at deploy time | manual | pending |

> **DISCO-03 closed (deferred):** Audit returned `count = 0` on 2026-04-28; the `organizations.is_public` migration + filter UI deferred to v0.18 per CONTEXT.md success criterion 4. No tasks generated.

> **Migration number for DISCO-05 backfill:** `091_seed_is_example_backfill.sql` — main now has `089_claim_failed_retry.sql` from PR #82 and `090_claim_dedupe_partition_keys.sql` from PR #83. Plan 13-05 references 091 throughout.

---

## Wave 0 Test File Gaps

- [ ] `src/app/api/watchlist/[strategyId]/route.test.ts` — DISCO-01 idempotency
- [ ] `src/lib/discovery-prefs.ts` + `src/lib/discovery-prefs.test.ts` — DISCO-02 hook + defaults
- [ ] `src/components/strategy/StrategyTable.test.tsx` — DISCO-04 sparkline color + scope swap
- [ ] `src/components/strategy/StarToggle.test.tsx` — DISCO-01 optimistic mirror + revert-on-failure
- [ ] `src/components/strategy/CustomizeDrawer.test.tsx` — DISCO-02 ESC close + Save/Reset
- [ ] `e2e/discovery-sparkline-regression.spec.ts` — DISCO-04
- [ ] `e2e/discovery-prefs-isolation.spec.ts` — DISCO-02
- [ ] `e2e/discovery-watchlist.spec.ts` — DISCO-01
- [ ] `e2e/discovery-hide-examples-default.spec.ts` — DISCO-05
- [ ] Test-user env vars (`E2E_USER_A_EMAIL` / `_PASSWORD` / `E2E_USER_B_EMAIL` / `_PASSWORD`) wired into Playwright CI lane — leverage macOS Keychain `service: quantalyze-test`

---

## Threat References (cross-link to RESEARCH.md `## Security Domain`)

- **T-01 CSRF** — `assertSameOrigin(req)` inside `withAuth` for non-GET methods on `PUT /api/watchlist/[strategyId]`.
- **T-02 DoS / spam** — `checkLimit(mandateAutoSaveLimiter, "watchlist:" + user.id)` — 30/min cap.
- **T-04 cross-account leak** — per-uid localStorage key shape; Playwright spec proves isolation.

---

*See `13-RESEARCH.md` `## Validation Architecture` (lines 952–1075) for full rationale, test command derivation, and Wave 0 dependency map.*
