---
phase: 13
slug: discovery-v2-polish
audit_type: nyquist
audit_date: 2026-04-28
verdict: NYQUIST COMPLETE
gaps: 0
auditor: gsd-nyquist-auditor
---

# Phase 13 — Nyquist Validation Audit

> Validates the Per-Task Verification Map in `13-VALIDATION.md` (TBD-01..TBD-09) against the actual test files, implementation, threat model, and Wave 0 RED→GREEN commit ordering.

## Coverage Table

| TBD | Plan | Requirement | Test File | Cases | Implementation | Status |
|-----|------|-------------|-----------|-------|----------------|--------|
| TBD-01 | 13-01 | Watchlist PUT idempotent + rate-limited (T-01/T-02) | `src/app/api/watchlist/[strategyId]/route.test.ts` | 12 | `route.ts` (PUT handler) | COVERED |
| TBD-02 | 13-01 | Star toggle persists across reload | `e2e/discovery-watchlist.spec.ts` | 1 (8 steps) | `StarToggle.tsx` + route | COVERED |
| TBD-03 | 13-01 | All / My Watchlist scope swap | `src/components/strategy/StrategyTable.test.tsx` | 8 (Cases 1–8) | `StrategyTable.tsx` | COVERED |
| TBD-04 | 13-02 | localStorage key shape + defaults | `src/lib/discovery-prefs.test.ts` | 12 | `src/lib/discovery-prefs.ts` | COVERED |
| TBD-05 | 13-02 | Cross-account isolation (T-04) | `e2e/discovery-prefs-isolation.spec.ts` | 1 (skip-when-env) | `discovery-prefs.ts` keyFor | COVERED-WITH-SKIP |
| TBD-06 | 13-04 | Sparkline final-value-sign rule | `StrategyTable.test.tsx` (4 cases) + `StrategyGrid.test.tsx` (3) + `sparkline-color.test.ts` (6) | 13 | `sparkline-color.ts` + 2 call sites | COVERED |
| TBD-07 | 13-04 | No mixed strokes on `/discovery/[slug]` | `e2e/discovery-sparkline-regression.spec.ts` | 3 (no-mix, ≤1 stroke, drawdown=neg) | call-site wiring | COVERED |
| TBD-08 | 13-05 | Fresh allocator hides examples | `e2e/discovery-hide-examples-default.spec.ts` | 1 (skip-when-env) | migration 091 + DEFAULTS | COVERED-WITH-SKIP |
| TBD-09 | 13-05 | 8 seed UUIDs flagged `is_example=true` | `091_seed_is_example_backfill.sql` + `RAISE NOTICE` probe | n/a (SQL DML) | migration file | DOCUMENTED-MANUAL |

## Detailed Findings

### TBD-01 — Watchlist route Vitest (12 cases)

`route.test.ts` covers every demand from VALIDATION:
- 401 unauth (`getUser`→null) — line 121
- 403 origin mismatch (CSRF) — line 127
- 400 bad action / missing key / non-JSON — lines 137, 142, 147
- 429 rate-limit + `Retry-After: 30` header — line 152
- Idempotency: `add` twice → 200/200 with `onConflict:'user_id,strategy_id', ignoreDuplicates:true` — line 190
- 500s on supabase error paths — lines 205, 211
- Rate-limit key shape `watchlist:{user.id}` asserted exactly — line 159

Maps to `route.ts` PUT handler. CSRF + rate-limit + IDOR (`.eq("user_id", user.id)`) all enforced.

### TBD-02 — Watchlist Playwright

`e2e/discovery-watchlist.spec.ts:20` — single test "watchlist toggle persists across reload": login → goto crypto-sma → pre-clean → click star → wait `/api/watchlist/` 200 → reload → assert star still filled (`aria-label*="from watchlist"`) → assert tab badge "1" → click My Watchlist → assert exactly 1 row → cleanup unstar. All required behaviors present. Uses `matratzentester24` shared fixture.

### TBD-03 — StrategyTable Vitest+RTL (8 cases)

Cases 1–8 in `StrategyTable.test.tsx:119–262`: WatchlistTabs render gating on `userId`, leading star column gating, scope=watchlist+empty→`<EmptyWatchlist>`, scope=watchlist+set-of-2→only those, click-star→badge increments, browse-back-compat. Comprehensive.

### TBD-04 — discovery-prefs Vitest (12 cases)

`discovery-prefs.test.ts` literal key assertion: `expect(keyFor("user-1","crypto-sma")).toBe("discovery_view_preferences:user-1:crypto-sma")` — line 89. DEFAULTS shape locked including `hide_examples:true` (DISCO-05 lock) — line 77. SSR safety, partial-merge tolerance, JSON parse error fallback, hydration gate, undefined-uid no-write — all covered.

### TBD-05 — Cross-account isolation Playwright

`e2e/discovery-prefs-isolation.spec.ts` — login-as-A → save grid pref via cog drawer → capture A's keys → sign out → login-as-B → assert `Object.keys(localStorage).filter(k=>k.startsWith("discovery_view_preferences:"+aUid+":"))===[]` (line 137). Uses `seedTestAllocator()` fallback when `E2E_USER_*` env vars absent; `test.skip` when neither path is wired (TODOS Q4 RESOLVED). Spec listable.

### TBD-06 — Sparkline color rule (3 fixtures × 3 sites)

- `sparkline-color.test.ts` — pure-fn: `>0→accent`, `<0→negative`, `===0→benchmark`, `[]→benchmark`, single-element, intermediate-value-ignored. 6 cases, 7 assertions.
- `StrategyTable.test.tsx:299–346` — 4 RTL cases including the **Pitfall 7 invariant** (drawdown stays `var(--color-negative)` even when returns ends positive).
- `StrategyGrid.test.tsx` — 3 RTL cases on card sparkline.

Verified at call sites: `StrategyTable.tsx:468` returns spark uses `sparklineColor(...)`; `:474` drawdown uses static `var(--color-negative)`; `StrategyGrid.tsx:112` uses `sparklineColor(...)`. Sparkline.tsx untouched.

### TBD-07 — Sparkline regression Playwright (3 tests)

`e2e/discovery-sparkline-regression.spec.ts`: (1) no-mix invariant with explicit `#16A34A` AND `#DC2626` regex match — `expect(hasGreen && hasRed).toBe(false)`; (2) `≤1 stroke per SVG`; (3) drawdown stroke is `#DC2626` or `var(--color-negative)` — proves negative-color render path lights up under all-positive seed data. All three required behaviors present.

### TBD-08 — Fresh-allocator Playwright

`e2e/discovery-hide-examples-default.spec.ts` — seeds fresh allocator → strips any `discovery_view_preferences:*` keys → loads `/discovery/crypto-sma` → asserts seed-strategy names absent (`SEED_NAMES_REGEX` covers all 8 names) → toggles "Hide examples" off → asserts row count grows. `test.skip` when `TEST_SUPABASE_*` env missing. Listable; CI-skip per Plan 13-02/13-05 fallback pattern.

### TBD-09 — 8 seed UUIDs flagged (manual/deploy-time)

Migration `091_seed_is_example_backfill.sql` is data-only DML, idempotent, with all 8 UUIDs literal in both `WHERE id IN (...)` and a post-update `DO $$ ... RAISE NOTICE '... flagged % seed rows ...' $$` probe. Per `autonomous: false` + Plan 13-05 Task 2 [BLOCKING] checkpoint, push is **operator-gated** — TODOS.md `## DISCO-05 backfill (Plan 13-05)` records pre-push audit_count=0, seed_uuid_count=0 (mechanical no-op until reseed), and three operator paths (A defer/B push-with-repair/C accept-no-op). Status correctly **DOCUMENTED-MANUAL**, not a coverage gap.

## Threat-Model Coverage (13-01-PLAN STRIDE register)

| Threat | Disposition | Test Coverage |
|--------|-------------|---------------|
| T-13-01-01 CSRF | mitigate | `route.test.ts` "returns 403 when assertSameOrigin returns…" |
| T-13-01-02 DoS | mitigate | `route.test.ts` 429 + `Retry-After` + key-shape `watchlist:{user.id}` |
| T-13-01-03 IDOR | mitigate | `route.test.ts` `.eq("user_id", user.id).eq("strategy_id", …)` deletion path |
| T-13-01-04 Info disclosure | accept | RLS + server-side uid; documented in 13-01-SUMMARY |
| T-13-01-05 Repudiation | accept | `@audit-skip: T-13-01-05` pragma at upsert+delete sites |
| T-13-01-06 Input validation | mitigate | `route.test.ts` 400 cases (3) |
| T-13-02-01 Cross-account leak | mitigate | `e2e/discovery-prefs-isolation.spec.ts` |
| T-13-02-02 Tampering | mitigate | `discovery-prefs.test.ts` partial-merge case |
| T-13-02-03 / T-13-02-04 | accept | rationale in plan |
| T-13-04-01 / T-13-04-02 | accept / mitigate | regression spec |
| T-13-05-01..04 | mitigate / accept | hard-coded UUIDs + RAISE NOTICE probe |

All 6 STRIDE entries in 13-01 register have either a passing test or an explicit `accept` rationale. Same for 13-02, 13-04, 13-05.

## Wave 0 RED → GREEN Discipline

Verified via `git log` ordering: every plan with a Vitest layer has `test(13-XX)` strictly preceding `feat(13-XX) GREEN`.

| Plan | RED commit | GREEN commit | OK |
|------|-----------|--------------|-----|
| 13-01 | `4de6393 test(13-01)` | `25bb0e0 feat(13-01) Task 2 GREEN` | ✓ |
| 13-02 | `5089502 test(13-02)` | `48ce8ec feat(13-02) Task 2 GREEN` | ✓ |
| 13-04 | `3273382 test(13-04)` | `56e2b53 feat(13-04) Task 2 GREEN` | ✓ |
| 13-05 | n/a (DML, e2e-only) | `7976ea3 feat(13-05) migration` then `e6741d2 test(13-05) e2e` | n/a |

## Build / Test Health

- vitest = 2372 pass (per prompt; consistent with 13-01-SUMMARY's 2329 + Plan 13-02/04 additions)
- build = exit 0
- e2e = 6 tests across 4 spec files listable (1 watchlist + 1 prefs-isolation + 3 sparkline-regression + 1 hide-examples = 6 ✓)

## Verdict

**NYQUIST COMPLETE — 0 gaps.**

Every TBD-XX entry maps to a real test file referencing the actual production code path. Required behaviors are asserted with explicit, behaviorally-meaningful expectations (key-shape literals, sign-rule fixtures across all three branches, no-mix DOM-walk regex, idempotency dual-call). Threat model fully covered. Wave 0 RED→GREEN ordering preserved across all 4 shipped plans. The only "manual" item (TBD-09 SQL audit) is correctly classified as operator-gated per `autonomous:false` and TODOS.md records the deploy posture explicitly.

No remediation required.
