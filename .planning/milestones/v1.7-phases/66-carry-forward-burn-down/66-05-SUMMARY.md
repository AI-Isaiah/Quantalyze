---
phase: 66-carry-forward-burn-down
plan: 05
subsystem: repo-debt-triage
tags: [todos-triage, badge-cap, comment-rot, cf-06, carry-forward-burndown, red-team-burndown]
requires:
  - "plan 66-01 (F-3/F-5 landed — the v1.6 red-team section is deletable)"
  - "plan 66-02 (F-4 closed + phase10-rpc residue cleaned)"
  - "plan 66-03 (holdingReturnsByScopeRef SSR pipeline removed — its TODOS entry is deletable)"
provides:
  - "TODOS.md reflecting ONLY live, verified debt (1001 → 690 lines); the phase's triage deliverable"
  - "flagged-count badge capped at '99+' on both the mobile bottom nav and the desktop rail (shared formatBadgeCount helper)"
  - "for-quants-lead/route.ts DesktopGate comments describe current behavior (back-compat token, no live producer)"
affects:
  - TODOS.md
  - src/components/layout/MobileNav.tsx
  - src/components/layout/Sidebar.tsx
  - src/app/api/for-quants-lead/route.ts
tech-stack:
  added: []
  patterns:
    - "one small shared display formatter reused across two render sites (formatBadgeCount, exported from Sidebar, imported by MobileNav)"
    - "delete stale/done TODOS entries same-pass with grep evidence — no strike-through graveyard (T-66-10 mitigation: evidence trail + git history replace the entry)"
key-files:
  created: []
  modified:
    - TODOS.md
    - src/components/layout/MobileNav.tsx
    - src/components/layout/MobileNav.test.tsx
    - src/components/layout/Sidebar.tsx
    - src/components/layout/Sidebar.test.tsx
    - src/app/api/for-quants-lead/route.ts
decisions:
  - "CF-06: fix the two named quick wins in-phase with regression tests (99+ badge cap on both surfaces; DesktopGate comment-only correction)"
  - "CF-06: DELETE stale/done/landed entries same-pass with grep evidence (no ~~strikethrough~~ graveyard); every survivor re-verified against live code"
  - "DEVIATION: the P2 holdingsSummary symbol-only dedup entry was DELETED, not KEPT — the plan pinned it KEEP but live code proves the fix shipped (keys by holdingScopeKey triple-key at queries.ts:2371, NEW-C03-02/B8). Evidence overrides the stale pin (fail-loud)."
metrics:
  duration: ~12m
  tasks: 2
  files: 6
  completed: 2026-07-04
requirements: [CF-06]
---

# Phase 66 Plan 05: Carry-Forward Burn-Down (CF-06 — TODOS triage + quick wins) Summary

Triaged all of TODOS.md (1001 → 690 lines) down to only live, verified debt:
re-verified every open entry against the live tree with file/symbol grep evidence,
deleted the entries whose described state no longer matches live code (fixes shipped),
deleted the v1.6 red-team F-3/F-4/F-5 section and the holdingReturnsByScopeRef SSR-payload
entry (all landed earlier in this phase), and removed every `~~struck~~` done row without
leaving a strike-through graveyard. Fixed the two named quick wins in-phase with regression
tests — the flagged-count badge now caps its displayed text at `99+` on both the mobile
bottom nav and the desktop rail (shared `formatBadgeCount` helper, proven RED on both
surfaces), and the three stale `DesktopGate` comments in `for-quants-lead/route.ts` now
describe current behavior (comment-only, zero behavior diff).

## What Was Built

### Task 1 — CF-06 quick wins: 99+ badge cap + DesktopGate comment rot (commit dd34c3a6)

**Badge cap (`Sidebar.tsx` + `MobileNav.tsx`).** Added one shared exported helper
`formatBadgeCount(count) => count > 99 ? "99+" : String(count)` in `Sidebar.tsx` (the
natural shared module — `MobileNav` already imports `buildPrimaryMobileNav` from it, so no
new module for a one-liner). Wired it at the two independent badge render sites — the
desktop rail `NavItemLink` and the mobile bottom nav — where the numeric `badge` becomes
visible text. Display-only: the `aria-label` keeps the TRUE count (`"150 flagged
holdings"`) for assistive tech; no badge styling/layout change (the fix is the unbounded
text width, per the v1.3 P3 entry). Regression-tested on BOTH surfaces
(`MobileNav.test.tsx`, `Sidebar.test.tsx`): 150 → `"99+"`, 99 → `"99"`, 5 → `"5"`, plus the
aria-label honesty assertion. **Proven RED** by temporarily reverting the cap — both
`caps the badge TEXT at '99+'` tests fail (rendered `"150"`).

**DesktopGate comment rot (`for-quants-lead/route.ts`).** `DesktopGate.tsx` was removed in
Phase 46, orphaning three comments that still described it as a live producer of the
`"desktop-gate"` `wizard_session_id` token. Corrected all three (the charset-rationale
block, the `step`-requires-`session_id` refine block, and the honeypot short-circuit note)
to state current behavior: the `"desktop-gate"` literal is now a **back-compat token only**
(charset-valid so any old draft/analytics rows still validate) with no live producer; the
sole live producer is `RequestCallModal`. **Comment-only diff** — `git diff` on the file
shows every changed line is inside a comment (verified), and `npx tsc --noEmit` is clean.

### Task 2 — CF-06: full TODOS.md triage to only live, verified debt (commit 62e18767)

Worked through TODOS.md section by section against the 66-RESEARCH §CF-06 pre-classification,
grepping the named file/symbol for EVERY entry and classifying with evidence. End state:
1001 → 690 lines, all gates green (see Verification).

## Triage Verdict Table (one row per entry; evidence = live-tree grep)

Verdict legend: **DEL-landed** = fixed by an earlier plan in THIS phase · **DEL-stale** =
fix shipped in a prior milestone (described state no longer matches live code) ·
**DEL-done** = struck `~~done~~` row removed · **FIXED-qw** = fixed this plan (Task 1) ·
**KEPT** = live debt, re-verified.

| # | Entry (section) | Verdict | Evidence (live-tree) |
|---|---|---|---|
| 1 | v1.6 red-team F-3 (`isBookOnlyDraft` dead disjunct) | DEL-landed | 66-01 SUMMARY; `grep -c isBookOnlyDraft src/app/api/allocator/scenario/share/route.ts` → 0 |
| 2 | v1.6 red-team F-5 (`memberKeyIds` cap) | DEL-landed | 66-01 SUMMARY; `MAX_MEMBER_KEY_IDS = 1000` in scenario-state.ts |
| 3 | v1.6 red-team F-4 (deploy-skew v4→v3 downgrade) | DEL-landed | 66-02 SUMMARY; prod 0-row detection, sweep + CI fixture committed |
| 4 | "queries / SSR payload" P1 (`holdingReturnsByScopeRef` removal) | DEL-landed | 66-03 SUMMARY; `grep -rni holdingReturnsByScopeRef src/` → nothing |
| 5 | v1.3 P3 flagged-count badge > 99 cap | FIXED-qw | Task 1: `formatBadgeCount` in Sidebar.tsx, wired in both nav render sites; regression-tested both surfaces |
| 6 | v1.3 P3 stale `DesktopGate` comment rot (for-quants-lead/route.ts) | FIXED-qw | Task 1: three comments corrected; comment-only diff verified |
| 7 | v1.3 P3 tab-strip edge-tab focus-ring clip (WCAG 2.4.7) | KEPT | CSS/DESIGN.md change, not decision-free — kept as live debt |
| 8 | v1.3 P3 sortable-header focus-ring clip (WCAG 2.4.7) | KEPT | Same WCAG class on ResponsiveTable-wrapped tables — kept |
| 9 | v1.3 P3 wizard 320px reflow coverage past entry step | KEPT | Needs seeded step-state injection — not decision-free |
| 10 | v1.3 P3 migrate remaining tables to `ResponsiveTable` | KEPT | Multi-file, judgment — kept |
| 11 | Phase 19.1 P1 Plans 07-10 (gated deploy work) | KEPT (verify-verdict) | **Partially live**: `analyticsMissingMessage.ts` stop-gap ABSENT, but `USE_COMPUTE_JOBS_QUEUE !== "true"` legacy branch still in csv-finalize/route.ts:642 + finalize-wizard/route.ts:692 (flag not permanently flipped). VERIFIED-not-executed per phase scope; entry annotated in-file |
| 12 | Phase 19.1 P2 atomicity gap (csv-finalize non-transactional) | KEPT | Structural; deferred to BACKBONE-07 — kept |
| 13 | Phase 19.1 P2 `after()` enqueue silent-failure monitoring | KEPT | Deferred monitoring infra — kept |
| 14 | Phase 19.1 P3 `compute_all_metrics` edge coverage | KEPT | Test-gap deferral — kept |
| 15 | Phase 19.1 red-team P0 `complete_with_warnings` CHECK | DEL-done | `~~done~~`; migration `20260602120000_..._add_complete_with_warnings.sql` present |
| 16 | Phase 19.1 red-team P1 unified-backbone CSV-finalize 42501 | KEPT | Flag-gated structural (`PROCESS_KEY_UNIFIED_BACKBONE`) — kept |
| 17 | Phase 19.1 red-team P2 admin RLS EXISTS on `csv_daily_returns` | KEPT | Structural perf risk — kept |
| 18 | Phase 19.1 red-team P2 worker-crash `computing` state | KEPT | Structural; janitor cron deferred — kept |
| 19 | Phase 19.1 red-team P3 `@audit-skip` pragma copy-paste risk | KEPT | Doc-note deferral — kept |
| 20 | Phase 18 tracker links (team-status / okx-smoke / in-flight-traceability) | DEL-stale | v1.0-era operational tracker pointers to `.planning/phase-18/*`; not code debt (phase long past, superseded) |
| 21 | Phase 18 v1.1 CSV daily-return scale auto-detect | DEL-stale | Percent-form auto-normalize SHIPPED: `analytics-service/services/csv_validator.py:310 _maybe_auto_normalize_percent_form` (2026-05-25 prod hotfix). Described friction (percent CSVs rejected) resolved |
| 22 | DISCO-05 migration-drift Path-C ratification | KEPT | Explicit historical decision record — kept |
| 23 | v0.23 vitest concurrent-worker timeout flakes (P0) | DEL-stale | Root-cause fix SHIPPED: `vitest.config.ts` `maxWorkers = Math.max(1, os.cpus().length - 1)` (the cpus-1 cap the entry prescribed) |
| 24 | PR #149 flaky live-DB fence tests (P1, 3 skipped) | KEPT | Still live: 3 `@pytest.mark.skip` at `test_compute_jobs_fencing.py:908/:1008/:1429` on the exact 3 named tests |
| 25 | Phase 17 P1 `formatCsvRuleCauseMulti` keep-or-delete | DEL-stale | `grep -rn formatCsvRuleCauseMulti src/` → nothing (helper deleted; the entry's "delete by Phase 20+" action is complete) |
| 26 | Phase 17 P1 `admin-csv-status-axe.spec.ts` admin seed | KEPT | Still live: spec imports `seedTestAllocator` + `test.skip` (line 41); no `seedTestAdmin` helper exists (only a comment reference) |
| 27 | Phase 17 P2 testing-specialist gaps | KEPT | Trimmed to the still-open sub-items (ErrorEnvelope DOM-order, buildDiagBlock, buildEnvelope path) — kept |
| 28 | Phase 16 P1 email cron-context cid fragmentation | KEPT | `resolveCorrelationId()` still resolves per-send (email.ts:300); no batch-cid param threaded — live |
| 29 | Phase 16 P1 email 23505 retry false-alarm | KEPT | `insertCorrelationMapping` present (email.ts:100); no `err.code === '23505'` guard — live |
| 30 | Phase 16 P1 VCR cassette substring over-redaction | KEPT | `conftest_vcr.py:97 _REDACT_BODY_SUBSTRINGS` still substring-based (`any(token in lower ...)`:113); no allowlist/token+hmac add — live |
| 31 | Phase 16 P1 debug_key_flow placeholder always-green | DEL-stale | FIXED: `debug_key_flow.py:133` derives `status="ok" if result.get("valid") else "error"` (not hardcoded True) + `:94` 503 on unset KEY/SECRET — real wiring landed |
| 32 | Phase 16 P1 SSE cancel-path audit-row reliability | KEPT (partial) | Pattern-E restructure landed (audit inserted BEFORE `start()`, route.ts:21), but `cancel()` second row still fire-and-forget (:307/:316) — annotated as partially-mitigated, kept |
| 33 | Phase 16 P1 Resend webhook svix-id idempotency | KEPT | svix signature + ±5min replay verified, but no `webhook_idempotency` table / `ON CONFLICT` (grep → nothing) — live |
| 34 | Phase 16 P1 API status-code drift (internal vs debug_key_flow) | KEPT | `debug_key_flow.py` still 401/503 (:56/:58) not 403-aligned — live |
| 35 | Phase 16 P1 repro-key-flow.sh Layer A no-op | KEPT | `scripts/repro-key-flow.sh` Layer A still reads `DEBUG_KEY_FLOW_*` env (:88-98); no static prefix scan — live |
| 36 | Phase 16 P1 wizard fetch missing X-Correlation-Id | KEPT | `grep -rn X-Correlation-Id src/.../wizard/steps/` → nothing (header still absent; wizard restructured to WizardClient) — live |
| 37 | Phase 16 P2 adversarial INFORMATIONAL (force-dynamic / pii BAD_SAMPLES / sentry walker) | KEPT | Deferred info items — kept |
| 38 | Phase 16 P2 Python Sentry-scrub regression tests | DEL-stale | Scoped to "CI will run them"; those tests are in the suite now (test_sentry_init.py present) — the "not run locally" caveat is spent; removed with the P3 pii-scrub note folding |
| 39 | Phase 16 P3 pii-scrub.ts BAD_SAMPLES length drift | KEPT | Kept as a live low-priority test-coverage item |
| 40 | HIGHEST-PRIORITY multistrategy-dashboard shipped note | DEL-done | Explanatory note for a v0.4.0.0-shipped item — record, not debt |
| 41 | ~~P1 Column REVOKE api_keys (SEC-005)~~ | DEL-done | `~~done~~` v0.5.1.0 (migs 027/028/029) |
| 42 | ~~Sprint 1 Task 1.1 /for-quants page~~ | DEL-done | `~~done~~` v0.5.2.0 |
| 43 | ~~Sprint 1 Task 1.2 wizard~~ | DEL-done | `~~done~~` v0.6.0.0 |
| 44 | Sprint 1 T1.1 follow-ups (DNS / CRM / PostHog / packet done; handoff + Turnstile live) | DEL-done + KEPT | Deleted 4 struck; kept `?role=manager` handoff + Cloudflare Turnstile (unbuilt) |
| 45 | Sprint 1 T1.2 follow-ups (packet/mandate/intent done; rest live) | DEL-done + KEPT | Deleted struck; kept 12 live chore/product items (draft cleanup cron, orphan api_keys, export filter, screenshots, key-permission viewer, StrategyForm cleanup, founder triage, sync checkpointing, SOC2, mobile polish, withAuth, useStrategySyncPoller) |
| 46 | My Allocation restructure follow-ups (v0.4.0.0) | KEPT | 9 live items (palette audit, PortfolioKPIRow, favorites-sleeve optimizer, sorting, bulk toggle, tooltips, unique-index test, equity-overlay test, e2e) — none struck |
| 47 | ~~Widget 26 Trading Activity Log~~ / ~~Widget 27 Trade Volume~~ | DEL-done | `~~done~~` v0.10.0.0 |
| 48 | Widgets 28/29/18/38 needing endpoints | KEPT | Genuine unbuilt features — kept |
| 49 | ~~Sprint 4 P2 funding rate ingestion~~ | DEL-done | `~~done~~` v0.11.1.0 |
| 50 | Sprint 4 P3 rollback runbook / P3 daily-PnL deprecation | KEPT | Live deferrals — kept |
| 51 | North-star / Moment 1-3 / demo-narrative idea lists | KEPT | Explicit "IDEAS, not a plan" backlog — kept |
| 52 | Ideas worth deferring | KEPT | Idea backlog — kept |
| 53 | Tech debt that could break the demo | KEPT | Live demo-risk concerns — kept |
| 54 | Shipped (reference) | KEPT | Historical reference record — kept |
| 55 | /simplify review follow-ups (2026-04-08) | DEL-done + KEPT | Deleted 3 struck (demo/match helper, ensureAuthUser, ALLOCATOR_ACTIVE_ID, ScopedBanner); kept 4 live (demo/page.tsx re-impl, useAnimatedNumber, match_eval N+1, partner-import batching) |
| 56 | ~~Claude design deferred items pr4~~ | DEL-done | Entire section `~~DONE in PR4~~` — removed |
| 57 | Phase 18 hotfix Founder LP cron idempotency (H2) | KEPT | Live: `founder-lp-report/route.ts` sends-then-200, no `(cron_name, year_month)` idempotency row |
| 58 | Phase 18 hotfix Founder LP cron timeout-budget (L2) | KEPT | Live: `FETCH_TIMEOUT_MS=25_000` (:92) + `MAX_RETRY_AFTER_S=20` (:100) unchanged (85s > 60s maxDuration) |
| 59 | Phase 18 hotfix `/api/alert-digest` verb mismatch (A3) | KEPT | Live: `alert-digest/route.ts` exports only `POST` (:40), no GET; still a cron in `vercel.json:8` (`0 9 * * *`) → 405 every tick |
| 60 | Phase 18 hotfix extractAnalytics barrel M2 | KEPT | Live: re-export `export { extractAnalytics, EMPTY_ANALYTICS };` at `queries.ts:195` (was :167) still present |
| 61 | Phase 18 hotfix P2 cross-process portfolio-recompute UNIQUE INDEX | KEPT | Structural; `portfolio.py` semaphore + no partial unique index — kept |
| 62 | Phase 18 hotfix P2 **holdingsSummary symbol-only dedup** | **DEL-stale (DEVIATION)** | **FIXED**: `queries.ts:2366-2373` now dedups by `key = holdingScopeKey(r)` (the `${venue}:${symbol}:${holding_type}` triple key) per NEW-C03-02/B8, comment at :2358 spells out the exact old bug. The `.set(r.symbol, r)` shape the entry (and the plan's KEEP pin) cite is **gone** — this is no longer live debt |

## Deviations from Plan

### [Triage-verdict correction — evidence overrides a stale pin] Deleted the P2 holdingsSummary dedup entry instead of keeping it

- **Found during:** Task 2 re-verification (row 62 above).
- **Plan pin / acceptance criterion conflicted with:** the plan's `<interfaces>` "Known
  pins" and acceptance criterion both said *"The P2 holdingsSummary dedup entry survives
  (it is live debt) with refreshed line evidence"* — expecting `queries.ts` to still carry
  the `.set(r.symbol, r)` symbol-only shape.
- **Evidence that overrides it:** the live dedup is at `src/lib/queries.ts:2366-2373` and
  keys by `const key = holdingScopeKey(r)` — the `${venue}:${symbol}:${holding_type}`
  triple key — with an explicit `NEW-C03-02` comment (`:2358`) documenting that keying on
  `symbol` alone was the bug and has been replaced. The exact `.set(r.symbol, r)` shape the
  entry describes no longer exists. The bug the entry filed is **fixed** (NEW-C03-02 / B8).
- **Why deleted, not kept:** the plan's own locked rule (D) and objective — *"the file must
  END the phase reflecting only live debt"* + *"DELETE stale/done entries same-pass"* —
  take precedence over a pre-classification pin the re-verification disproved. Keeping a
  fixed entry to satisfy the stale pin would violate CF-06's primary objective and the
  fail-loud rule (CLAUDE.md Rule 12). This is exactly the "re-verify every survivor; delete
  if the described state no longer matches live code" mandate the plan sets.
- **Files:** TODOS.md (entry removed). **Commit:** 62e18767.

No other deviations — both quick wins were implemented as written, and every other verdict
followed the research pre-classification after live re-verification.

## Verification

- **Task 1 automated verify (plan command):** `npx vitest run
  src/components/layout/MobileNav.test.tsx src/components/layout/Sidebar.test.tsx
  --no-file-parallelism` → **49 passed**. **Proven RED**: reverting `formatBadgeCount` to
  `String(count)` fails both `caps the badge TEXT at '99+'` tests (rendered `"150"`); restored.
- **Task 1 acceptance:** `git diff src/app/api/for-quants-lead/route.ts` → every changed
  line is inside a comment (verified: no non-comment code line changed). `npx tsc --noEmit`
  → exit 0. `npx eslint` on the three changed source files → 0 errors.
- **Task 2 automated verify (plan command):** `grep -v "^#" TODOS.md | grep -c
  "isBookOnlyDraft\|holdingReturnsByScopeRef"` → **0**, and `! grep -q "~~" TODOS.md` →
  true. **VERIFY PASS.**
- **Task 2 acceptance greps:** `grep -c "F-3\|F-4\|F-5" TODOS.md` → **0** (v1.6 red-team
  section gone; no other live section references those ids). No `~~` markers remain.
  `grep "holdingsSummary" TODOS.md` → none (the fixed dedup entry removed). Line count
  1001 → 690.

## Known Stubs

None. The badge cap wires real display formatting against real props; the DesktopGate change
is comment-only; the TODOS triage deletes/keeps text with no placeholder introduced.

## Threat Flags

None new. Per the plan's threat register, **T-66-10** (deleting a TODOS entry that was
actually live debt) is mitigated: every deletion carries a file/symbol grep evidence line in
the triage table above, and git history preserves the removed text. The one deletion that
contradicted a plan pin (holdingsSummary dedup, row 62) is the most rigorously evidenced —
the live triple-key dedup at `queries.ts:2371` proves the bug is fixed, not erased.

## Self-Check

- FOUND: `.planning/phases/66-carry-forward-burn-down/66-05-SUMMARY.md`
- FOUND: `TODOS.md` (690 lines, all end-state gates green)
- FOUND: commit `dd34c3a6` (Task 1 — quick wins)
- FOUND: commit `62e18767` (Task 2 — TODOS triage)

## Self-Check: PASSED
