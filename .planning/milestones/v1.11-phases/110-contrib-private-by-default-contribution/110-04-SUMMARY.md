---
phase: 110-contrib-private-by-default-contribution
plan: 04
subsystem: api-routes
tags: [status-lifecycle, contrib-private, finalize-routes, secdef-rpc]
status: complete
requires:
  - "finalize_wizard_strategy + finalize_csv_strategy accept a guarded p_terminal_status (pending_review|private) — plan 110-01"
  - "strategies.status admits an owner-only 'private' terminal value — plan 110-01"
provides:
  - "A finalize request with entry_context='contribution' terminates the strategy at status='private' on BOTH the API-key path (single-key + composite) and the CSV path — never 'pending_review'"
  - "Manager finalize (entry_context absent/='manager') is byte-identical (status='pending_review')"
  - "Contribution suppresses the admin review-notify but KEEPS the analytics enqueue (allocator needs KPIs)"
  - "Whole-repo 'private' status-consumer audit — every public/verify surface excludes it; Strategy.status TS union widened"
affects:
  - "the allocator contribution overlay (110-03) — its finalize POSTs now terminate 'private' end-to-end"
  - "the composer Browse drawer (110-02) — owner's private contributions are discoverable there"
tech-stack:
  added: []
  patterns:
    - "entry_context context-flag → terminalStatus derivation → p_terminal_status RPC arg (server-side enforced; RPC RAISEs on any other value)"
    - "contribution CSV path calls finalize_csv_strategy DIRECTLY on the user-scoped client (unified Python backbone can only write 'pending_review')"
    - "cast-through-unknown .rpc() for the un-regenerated p_terminal_status param (clone of persist_csv_daily_returns idiom)"
key-files:
  created:
    - src/app/api/strategies/csv-finalize/route.test.ts
  modified:
    - src/app/api/strategies/finalize-wizard/route.ts
    - src/app/api/strategies/finalize-wizard/route.test.ts
    - src/app/api/strategies/csv-finalize/route.ts
    - src/lib/types.ts
    - src/__tests__/contracts/contracts-registry.test.ts
decisions:
  - "Contribution API-key + composite finalize route through runLegacyFinalize (honors p_terminal_status + enqueues analytics); the unified arm is NEVER used for a contribution because it does not promote strategies.status (W1 note, 110-01)"
  - "Contribution CSV finalize calls finalize_csv_strategy directly on the user-scoped client with p_terminal_status='private' — the unified Python backbone defaults 'pending_review' and cannot be changed without out-of-scope Python edits"
  - "entry_context hand-validated in the routes' existing validation gauntlet (Rule 11 conformance) rather than a new zod import; behavior identical to the plan's 'zod enum' (400 on garbage, default 'manager')"
  - "Unified-arm 'pending_review' response literals KEPT — contributions divert to legacy BEFORE that arm, so it is manager-only-reachable and always terminates 'pending_review' by construction (documented, not a missed branch)"
requirements: [CONTRIB-02]
metrics:
  tasks_completed: 3
  tasks_total: 3
  files_created: 1
  files_modified: 5
  commits: 3
  duration_min: 12
  completed: 2026-07-16
---

# Phase 110 Plan 04: Contribution finalize private-by-default Summary

**Threaded the `entry_context='contribution'` branch through BOTH finalize routes so an allocator contribution terminates at owner-only `status='private'` (never the publish-candidate `pending_review`) — routing the API-key/composite path through `runLegacyFinalize` and the CSV path through a direct user-scoped `finalize_csv_strategy` call, both with `p_terminal_status='private'` — while suppressing the admin review-notify but KEEPING analytics, and completing a whole-repo `'private'` status-consumer audit.** This is the server half of CONTRIB-02; plan 110-01 gave the RPCs the guarded terminal-status parameter and this plan makes the routes select it.

## Status: COMPLETE (all 3 tasks)

| Task | Name | Status | Commit |
| ---- | ---- | ------ | ------ |
| 1 | entry_context branch in finalize-wizard (legacy + unified arms) | done | `fef04677` |
| 2 | same contribution branch on csv-finalize | done | `ffdfe756` |
| 3 | whole-repo 'private' status-consumer audit | done | `8a7bf0a5` |

## What was built

### Task 1 — finalize-wizard (`src/app/api/strategies/finalize-wizard/route.ts`)
- `entry_context` added to the `validatePayload` gauntlet as a closed set `{manager, contribution}`, absent/null → `manager` (back-compat), garbage → hard 400 before the RPC. `ValidatedPayload` gains `entryContext`.
- `terminalStatus` derived once in the POST handler (`contribution → 'private'`, else `'pending_review'`).
- **Routing (the load-bearing W1 resolution):** a contribution NEVER rides the unified arm — that arm delegates to `process_key_long`, which enqueues analytics but never promotes `strategies.status` (only `strategy_verifications` advances). Instead:
  - **Composite contribution** — already routed through `runLegacyFinalize` in the composite hoist; now passes `terminalStatus` (so a composite contribution finalizes `private`, no per-source fork).
  - **Single-key API contribution** — a new branch diverts to `runLegacyFinalize` with `terminalStatus` BEFORE the unified arm (after the scope-broadening probe, so the contribution key is re-checked identically).
- `runLegacyFinalize` gains a `terminalStatus` param (default `'pending_review'`), threads `p_terminal_status` to the `finalize_wizard_strategy` RPC (cast-through-unknown — types not yet regenerated), returns the ACTUAL terminal status, and **suppresses the `notify_founder_new_strategy` side effect when `'private'`** (a private row is never a review candidate) while KEEPING the `last_sync_at` touch and the analytics enqueue (`sync_trades`/`stitch_composite`).
- Unified-arm `pending_review` literals kept + documented as manager-only-reachable.
- 6 new tests (private single-key, private composite, notify-suppressed/analytics-kept, manager-neutrality proving suppression is contribution-specific, default→pending_review, garbage→400). Suite: **54 passed**.

### Task 2 — csv-finalize (`src/app/api/strategies/csv-finalize/route.ts`)
- `entry_context` validated (mirrors Task 1; garbage → 400 `CSV_INVALID_FORMAT` before the RPC).
- **New `contributionCsvFinalizeHandler`** calls `finalize_csv_strategy` DIRECTLY on the user-scoped `createClient()` with `p_terminal_status='private'`. This is required because the unified Python backbone (`process_key.py`) calls `finalize_csv_strategy` WITHOUT `p_terminal_status` (defaults `pending_review`) and hardcodes its response status — it cannot produce a `private` row, and Python is out of this plan's file scope. The user-scoped client natively satisfies the SECDEF RPC's `auth.uid()=p_user_id` guard (no INTERNAL_API_TOKEN / JWT-forwarding needed).
- Reuses the IDENTICAL shared post-finalize fan-out (`applyCsvMetadataUpdate` + `persistDailyReturnsOrErrorResponse` + `enqueueCsvAnalyticsAfter`) so the manager and contribution paths cannot drift. No review-notify exists on the CSV path to suppress.
- Stale header comment + the WR-04 orphan comment refreshed to document both terminal statuses.
- New co-located `route.test.ts`: 5 tests (private branch + `p_terminal_status='private'`, manager neutrality via `postProcessKey`, persist+enqueue kept, RPC-error→422, garbage→400). Suite: **5 passed**; pre-existing CSV tests (c14 + after-failloud, 35) still green.

### Task 3 — whole-repo audit
- `Strategy.status` TS union (`src/lib/types.ts`) widened to include `'private'` — the one closed enumeration that claimed completeness; tsc clean afterward (no exhaustive-switch consumer broke).
- Full audit table below; every grep hit classified, zero unclassified.

## Task 3 — `'private'` status-consumer audit table

Audit command (v1.10 grep-scope lesson — scans `src/ e2e/ supabase/ analytics-service/ tools/`):
`grep -rn "pending_review|status IN (|\.eq(\"status\"|status.eq." … --include=*.ts --include=*.tsx --include=*.py --include=*.sql`
Classes: **(a)** public/verify surface — must EXCLUDE 'private'; **(b)** owner surface — must INCLUDE it; **(c)** status-set enumeration — widen if it claims completeness; **(d)** irrelevant/safe.

| File:line | Consumer | Class | Verdict / Action |
|-----------|----------|-------|------------------|
| src/app/(dashboard)/admin/page.tsx:40 | `.eq("status","pending_review")` admin review queue | (a) | EXCLUDES 'private' by construction (lists only pending_review) — a private row never appears in the publish queue. No change. |
| src/app/api/admin/strategy-review/route.ts:333 | `.eq("status","pending_review")` promotion UPDATE filter | (a) | A 'private' row CANNOT be promoted to published — the status-pinning filter matches only pending_review. No change. |
| src/lib/queries.ts:419 | `getPublicStrategyDetail` `status='published'` gate | (a) | Public `/strategy/[id]` excludes 'private'. No change. |
| src/lib/queries.ts:498 | `getStrategyReturns` `status='published'` gate | (a) | Returns endpoint excludes 'private'. No change. |
| src/app/strategy/[id]/page.tsx:97 | public detail `status='published'` predicate | (a) | Excludes 'private'. No change. |
| src/app/factsheet/[id]/v2/page.tsx:369 | factsheet `status='published'` | (a) | Excludes 'private'. No change. |
| src/app/api/factsheet/[id]/pdf/route.ts:325 | factsheet PDF `status='published'` | (a) | Excludes 'private'. No change. |
| src/app/api/admin/match/send-intro/route.ts:395 | intro PII gate — reject unless `status='published'` | (a) | A 'private' row can never trigger an intro/PII disclosure. No change. |
| src/lib/notes/ownership.ts:104 | notes ownership `.eq("status","published")` | (a) | Excludes 'private'. No change. |
| analytics-service/routers/simulator.py:281 | simulator `status='published'` | (a) | Excludes 'private'. No change. |
| analytics-service/routers/match.py:391 | match `status='published'` | (a) | Excludes 'private'. No change. |
| analytics-service/services/strategy_matching.py:83 | matching `status='published'` | (a) | Excludes 'private'. No change. |
| analytics-service/routers/portfolio.py:1741 | portfolio marketplace `status='published'` | (a) | Excludes 'private'. No change. |
| src/app/api/strategies/browse/route.ts:129 | `withPublishedOrOwner(query, user.id)` | (b) | INCLUDES the owner's own 'private' rows (published OR user_id=session) — the composer discovery surface (plan 110-02). Correct. No change. |
| src/lib/visibility.ts:89-123 | `withPublishedOrOwner` / `withPublishedOnly` helpers | (a)/(b) | The SoT predicates; owner-inclusive one already added by 110-02. No change. |
| **src/lib/types.ts:170** | `Strategy.status` closed TS union (4 values) | **(c)** | **WIDENED to add `'private'`** — the one enumeration claiming completeness. tsc clean; no exhaustive-switch broke. |
| src/components/ui/Badge.tsx:13-35 | `statusMap` / `statusLabelMap` (status→style/label) | (c/d) | Safe-by-fallback: `statusMap[label] ?? statusMap.draft`, `statusLabelMap[label] ?? label` — no crash on 'private'. Does NOT claim completeness → no widening required. |
| src/components/strategy/StrategyActions.tsx:53-162 | sequential `if (status===…)` render branches | (d) | Falls through to `return null` for 'private' (safe). Manager surface — not reached for an allocator's private contribution. No change. |
| src/app/(dashboard)/strategies/page.tsx:46 | drafts list `.eq("status","draft")` | (d) | Excludes 'private'. Irrelevant. |
| src/app/(dashboard)/strategies/new/wizard/page.tsx:86 | draft fetch `.eq("status","draft")` | (d) | Irrelevant. |
| src/app/api/strategies/draft/[id]/route.ts:157,177 | draft-only guard `.eq("status","draft")` | (d) | Excludes 'private'. Irrelevant. |
| e2e/csv-upload-flow.spec.ts:327 | `.eq("status","pending_review")` manager-CSV assertion | (d) | Manager path (no entry_context) is unchanged — still finalizes pending_review. No change. |
| e2e/discovery-hide-examples-default.spec.ts:186, svg-chart-parity.spec.ts:36 | seed `status='published'` rows | (d) | Seed fixtures; unaffected. |
| src/app/api/admin/intro-request+intro-response `.eq("status","pending")` | different table (intro/contact requests, not strategies) | (d) | Not strategies.status. Irrelevant. |
| src/__tests__/strategy-verifications-rls, AdminTabs `status:"pending_review"` | `strategy_verifications` status (separate lifecycle) | (d) | Verification row status ≠ strategies.status; the verification insert is kept on both terminal statuses per 110-01 (owner-facing trust label, not a publish signal). No change. |
| src/lib/routing/route-contract-manifest.ts, benchmark/btc, factsheet pdf test — `"private"` | Cache-Control `private` / `RouteClass "private"` (session-gated routes) | (d) | Unrelated to strategy status. Irrelevant. |

**Result:** no public/verify surface leaks 'private'; the owner surface (browse) includes it; the single completeness-claiming enumeration (`Strategy.status`) was widened. Zero category-(a)/(b) production gaps found.

## Deviations from Plan

### Auto-fixed / documented adjustments

**1. [Rule 3 - Blocking, cross-plan] Completed the CONTRIB-04 lint-rule registry**
- **Found during:** Task 3 (`npm run test` gate).
- **Issue:** `src/__tests__/contracts/contracts-registry.test.ts` failed — sibling plan **110-02** (commit `0e22fe17`) registered the `no-owner-or-on-admin-client` ESLint rule in the plugin and wired it to `error` (eslint.config.mjs) but did NOT add it to the test's `EXPECTED_RULES`. Verified pre-existing (fails with my `types.ts` change stashed) — not caused by 110-04.
- **Fix:** added `no-owner-or-on-admin-client` to `REPO_WIDE_ERROR_RULES`. Verified the test's second probe (`calculateConfigForFile("src/lib/visibility.ts")` must resolve to `error`) holds — the rule is config-level `error` on `src/**`; visibility.ts is exempted inside the rule's AST logic, not via a config-`off`. Contracts test: 34 passed.
- **Files modified:** `src/__tests__/contracts/contracts-registry.test.ts`. **Commit:** `8a7bf0a5`.
- **Rationale for fixing vs deferring:** blocks the shared-branch full-suite gate (this plan's Task 3 acceptance) and is a provably-correct completion of phase-110's own CONTRIB-04 wiring. Flagged here for 110-02 attribution.

**2. [Rule 11 conformance] entry_context hand-validated, not a new zod enum**
- The plan text says "zod enum"; both routes hand-validate their payloads (no zod import). Added `entry_context` to each route's existing validation gauntlet instead of introducing zod — behavior is identical (400 on garbage, default 'manager'). Matches codebase convention.

**3. [W1 resolution] Unified arm NOT threaded with terminalStatus**
- The plan's Task-1 action (c) said to thread terminalStatus through the unified arm. Per the load-bearing W1 note (110-01), the unified arm does NOT write `strategies.status`, so there is no writer to thread. Correct resolution: divert contributions to `runLegacyFinalize` BEFORE the unified arm. The unified arm's `pending_review` literals are kept (manager-only-reachable by construction) with a documenting comment. This satisfies the acceptance intent (no contribution returns pending_review) while staying honest (the arm cannot produce 'private').

**4. [Plan/source discrepancy] CSV path calls finalize_csv_strategy directly**
- The plan's interface note implied the CSV route calls `finalize_csv_strategy` server-side. In source, the TS route delegates entirely to the unified Python backbone (which owns the RPC call and defaults `pending_review`). Per the W1 note ("CSV path through finalize_csv_strategy with p_terminal_status='private'") and the plan's TS-only scope, the contribution branch calls the RPC directly on the user-scoped client. Manager path unchanged (still unified).

## Threat model coverage

- **T-110-12** (contribution reaching publish queue): terminalStatus branch + Test-2 per route; admin queue filters pending_review only (Task 3 confirmation). Covered.
- **T-110-13** (client forcing publication via entry_context): hand-validation 400 on garbage + RPC RAISE guard on the terminal status (110-01) + by-construction comment. Covered.
- **T-110-14** ('private' leaking onto public detail/factsheet/match): Task 3 per-surface exclusion evidence (all 'published'-gated). Covered.
- **T-110-15** (contribution silently skipping analytics): Test-3/Task-1 (`sync_trades` enqueue survives) + Test-3/Task-2 (`persist_csv_daily_returns` + after() enqueue survive). Covered.

## Threat Flags

None — this plan adds no new network endpoint, auth path, or trust-boundary schema change. The one new writer (direct `finalize_csv_strategy` call) runs on the user-scoped client behind the same SECDEF `auth.uid()=p_user_id` guard as every other finalize, and the RPC RAISEs on any terminal status outside ('pending_review','private').

## Verification

- `npx vitest run src/app/api/strategies/finalize-wizard` → 54 passed.
- `npx vitest run src/app/api/strategies/csv-finalize` → 5 passed; c14 + after-failloud (35) still green.
- `npx vitest run src/__tests__/contracts/contracts-registry.test.ts` → 34 passed.
- Full suite (`npm run test`) → 8232 passed / 287 skipped, 0 failed (the single contracts-registry failure fixed under Deviation 1).
- `npx tsc --noEmit` → clean. `npm run lint` → 0 errors (1 pre-existing frozen-chart warning, unrelated).

## Self-Check: PASSED

- `src/app/api/strategies/csv-finalize/route.test.ts` — FOUND
- Commit `fef04677` — FOUND
- Commit `ffdfe756` — FOUND
- Commit `8a7bf0a5` — FOUND
- Branch `gsd/v1.11-scenario-composer-v2` — unchanged
