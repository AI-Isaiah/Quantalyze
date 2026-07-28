---
phase: 13-discovery-v2-polish
verified: 2026-04-29T01:10:00Z
status: human_needed
score: 10/10 must-haves verified (code) + 1 deferred (DISCO-05 remote push)
overrides_applied: 0
---

# Phase 13: Discovery v2 Polish — Verification Report

**Phase Goal (ROADMAP.md):** ship DISCO-01 (Watchlist), DISCO-02 (per-user-keyed Customize prefs), DISCO-04 (single-accent sparkline rule), DISCO-05 (default Hide-examples + seed backfill). DISCO-03 deferred to v0.18 per audit-count=0.
**Verified:** 2026-04-29T01:10Z, branch `feature/v0.17-sprint-13` @ HEAD `be6a867…`
**Status:** human_needed (code complete; remote DB push + Playwright execution outstanding)
**Re-verification:** No — initial verification.

## Goal Achievement Per Sub-Requirement

### DISCO-01 Watchlist — PASS

| # | Truth | Evidence | Status |
|---|-------|----------|--------|
| 1 | Allocator stars from a row → leading-column StarToggle flips | `src/components/strategy/StrategyTable.tsx:330` (`showStarColumn = userId !== undefined`), `:377` (leading `<th>`), `:408-410` (leading `<td>` renders `<StarToggle>`); userId-conditional via `:330` | PASS |
| 2 | Star renders on grid cards top-right | `src/components/strategy/StrategyGrid.tsx:139-145` (`{userId !== undefined && onToggleStar && (<StarToggle …/>)}`) — sibling of `<Link>`, not child (avoids invalid HTML) | PASS |
| 3 | All / My Watchlist tabs swap row sets | `StrategyTable.tsx:136` `useState<"all" \| "watchlist">`, `:229-230` `if (scope === "watchlist") result = result.filter((s) => watchedSet.has(s.id))` | PASS |
| 4 | Server-side idempotent under double-click | `src/app/api/watchlist/[strategyId]/route.ts:84-87` `upsert(..., { onConflict: "user_id,strategy_id", ignoreDuplicates: true })`; remove path `:100-103` `.delete().eq("user_id", user.id).eq("strategy_id", strategyId)` | PASS |
| 5 | Discovery page wires `getMyWatchlist` | `src/app/(dashboard)/discovery/[slug]/page.tsx:9` import, `:37` `getMyWatchlist(user.id)` in 3-way `Promise.all`, `:56-57` threads `userId` + `initialWatchedSet` to `<StrategyTable>` | PASS |

**Threat-model controls (all live in code):**
- T-13-01-01 CSRF — `route.ts:40` `assertSameOrigin(req)` ✓
- T-13-01-02 Rate-limit — `route.ts:56` `checkLimit(mandateAutoSaveLimiter, \`watchlist:${user.id}\`)` ✓
- T-13-01-03 IDOR — `route.ts:102` `.eq("user_id", user.id)` (redundant with RLS) ✓
- T-13-01-06 Input validation — `route.ts:71` `if (body.action !== "add" && body.action !== "remove")` returns 400 ✓

### DISCO-02 Customize Prefs — PASS

| # | Truth | Evidence | Status |
|---|-------|----------|--------|
| 1 | localStorage key shape `discovery_view_preferences:{auth.uid}:{slug}` | `src/lib/discovery-prefs.ts:47` `return \`discovery_view_preferences:${uid}:${slug}\`` | PASS |
| 2 | Defaults: view=table, sort=sharpe-desc, hide_examples=true | `discovery-prefs.ts:39-43` `DEFAULTS = { view: "table", sort: { key: "sharpe", dir: "desc" }, hide_examples: true }` | PASS |
| 3 | Cog button replaces Customize text-button; legacy CustomizeModal removed | `StrategyFilters.tsx:389-390` `aria-label="Customize discovery view"` + `aria-haspopup="dialog"`; `grep "function CustomizeModal\|<CustomizeModal" StrategyFilters.tsx` returns 0 hits | PASS |
| 4 | StrategyTable wires `useDiscoveryPrefs` + `<CustomizeDrawer>` | `StrategyTable.tsx:155` hook call, `:537` `<CustomizeDrawer>` render | PASS |

### DISCO-04 Single-Accent Sparkline — PASS

| # | Truth | Evidence | Status |
|---|-------|----------|--------|
| 1 | `sparklineColor` helper exists with sign-driven branches | `src/lib/sparkline-color.ts:20-26` — empty/null → `var(--color-chart-benchmark)`; final>0 → `var(--color-accent)` (#1B6B5A); final<0 → `var(--color-negative)` (#DC2626); zero → `var(--color-chart-benchmark)` (#94A3B8) | PASS |
| 2 | Wired at StrategyTable returns sparkline (not drawdown) | `StrategyTable.tsx:467-468` returns col uses `color={sparklineColor(...)}`; `:473-474` drawdown col still `color="var(--color-negative)"` static | PASS |
| 3 | Wired at StrategyGrid card sparkline | `StrategyGrid.tsx:111-112` `color={sparklineColor(s.analytics.sparkline_returns ?? [])}` | PASS |
| 4 | Sparkline.tsx itself untouched | `git diff --quiet src/components/charts/Sparkline.tsx` exits 0 (no changes) | PASS |

### DISCO-05 Hide Examples + Seed Backfill — PARTIAL (file shipped; remote push deferred)

| # | Truth | Evidence | Status |
|---|-------|----------|--------|
| 1 | Migration 091 file exists with 8 hard-coded seed UUIDs | `supabase/migrations/091_seed_is_example_backfill.sql` exists; `grep -c "cccccccc-0001-4000-8000"` returns **16** (8 UUIDs × 2 occurrences — UPDATE + DO probe) | PASS |
| 2 | Idempotent UPDATE, no DDL | `grep -cE "ALTER TABLE\|CREATE TABLE\|DROP TABLE\|ADD COLUMN"` returns **0**; `set is_example=true` is naturally idempotent | PASS |
| 3 | Cross-plan integration seam (DEFAULTS.hide_examples=true × backfill) | E2E spec `e2e/discovery-hide-examples-default.spec.ts:76` exists; uses `seedTestAllocator` (`:29`) + clears `discovery_view_preferences:*` (`:104`) + asserts no seed-name regex match in rendered rows | PASS |
| 4 | Remote push applied | **NOT applied** — TODOS.md "DISCO-05 backfill" section documents pre-push audit_count=0 (no seed UUIDs in remote), 11 unapplied local + 8 unaccounted-for remote migrations; operator gate raised (Path A/B/C decision); per user prompt this is "documented and acceptable for the verifier to record as 'file shipped, push deferred'" | DEFERRED |

### Tests + Build — PASS

| Check | Result |
|-------|--------|
| `npm test` | **2372 passed | 148 skipped** in 26.6s (matches user's claim of 2372) ✓ |
| `npm run build` | **Compiled successfully in 5.4s**; all 73 routes generated; exit 0 ✓ |
| Playwright catalog (4 phase-13 specs) | 6 tests in 4 files: `discovery-watchlist.spec.ts:20`, `discovery-prefs-isolation.spec.ts:79`, `discovery-sparkline-regression.spec.ts:42/80/108`, `discovery-hide-examples-default.spec.ts:76` ✓ |

### Anti-Patterns Found — NONE

No TODO/FIXME/placeholder markers introduced. No empty implementations. No icon-library leak (`! grep "lucide-react\|@heroicons\|react-icons"` on StarToggle/WatchlistTabs/CustomizeDrawer/sparkline-color/discovery-prefs returned clean per plan acceptance criteria). No axios import. No `<Modal>` leak in CustomizeDrawer.

### Human Verification Required

| # | Test | Expected | Why Human |
|---|------|----------|-----------|
| 1 | Manual visual smoke on `/discovery/crypto-sma` filter row | Search → All Filters → All / My Watchlist tabs → Hide examples → Sort → cog → view toggle, drawer slides in from right, Save persists across reload | Visual layout + animation cannot be verified by grep; Plan 13-02 Task 4 was an `autonomous: true`-overridden checkpoint |
| 2 | Run 4 Playwright specs against live dev server | All 6 tests GREEN | Specs are authored + listable; CI dev-server execution still pending (e2e_executed=false; spec_authored=true documented in 13-01 SUMMARY) |
| 3 | Operator-gated `supabase db push` for migration 091 + post-push audit | `audit_count = 8` after seeder reseed (or `1..8` degraded acceptable) | Two-sided migration drift requires operator decision (Path A/B/C in TODOS.md); migration file is correct + idempotent + reusable |
| 4 | Cross-account isolation Playwright spec runs GREEN against seeded test users | Login-as-A → login-as-B → zero `discovery_view_preferences:{A.uid}:*` keys readable | Requires `TEST_SUPABASE_URL` + `TEST_SUPABASE_SERVICE_ROLE_KEY` env wiring; spec auto-`test.skip`s otherwise |

## Overall Verdict

**PHASE COMPLETE — code-level. Awaiting operator gates: (a) live Playwright run on dev server; (b) remote `supabase db push` for migration 091.**

All four in-scope plans (13-01/02/04/05) shipped working code that satisfies every must-have truth in the PLAN frontmatter and every ROADMAP success criterion. DISCO-03 was correctly deferred per audit-count=0 (TODOS.md). Threat-model controls (CSRF / rate-limit / RLS / input validation) live in route.ts as documented. Cross-plan integration seam (DEFAULTS.hide_examples=true × seed-row is_example=true backfill) is wired in code and gated by the e2e spec.

The two outstanding items are operator-driven, not code-driven, and were explicitly anticipated by the plan (`autonomous: false` flag on Plan 13-05 Task 2; `test.skip` env-fallback on cross-account spec). Per the user's prompt: "the remote push is gated (Path A/B/C operator decision) — this is documented and acceptable for the verifier to record as 'file shipped, push deferred'" — recorded as DEFERRED, not FAIL.

### Remediation List (Optional — Operator Gates)

1. Decide Path A/B/C from `TODOS.md ## DISCO-05 backfill` (coordinated migration sweep recommended). Run `supabase db push` once drift is resolved; record `audit_count` in TODOS.md.
2. Wire `TEST_SUPABASE_URL` + `TEST_SUPABASE_SERVICE_ROLE_KEY` env vars (or `E2E_USER_A_*`/`E2E_USER_B_*`) and run `npx playwright test e2e/discovery-watchlist.spec.ts e2e/discovery-prefs-isolation.spec.ts e2e/discovery-sparkline-regression.spec.ts e2e/discovery-hide-examples-default.spec.ts` against a live dev server.
3. Manual visual smoke per Plan 13-02 Task 4 `<how-to-verify>` steps 1-19 (3-min check; cog drawer + reload persistence + filter row order).

---

_Verified: 2026-04-29T01:10:00Z_
_Verifier: Claude (gsd-verifier)_
