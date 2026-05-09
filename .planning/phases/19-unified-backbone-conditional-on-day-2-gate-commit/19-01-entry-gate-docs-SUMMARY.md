---
phase: 19-unified-backbone-conditional-on-day-2-gate-commit
plan: 01
subsystem: infra
tags: [phase-19, ci-guards, route-inventory, migration-plan, view-shim, kill-switch, rollback-runbook, backbone-04, backbone-10]

# Dependency graph
requires:
  - phase: 18-root-cause-fix-founder-lp-skeleton
    provides: phase-19 entry condition (Day-2 = COMMIT verdict in .planning/phase-16/day-2-decision.md; BACKBONE-06/-07 push to phase-19 recorded in STATE.md)
provides:
  - .planning/phase-19/route-inventory.md — BACKBONE-10 entry-gate route inventory with 14 mapped rows (5 unification targets to flow_type=teaser|onboard|csv|resync; 9 explicit out-of-scope rationales)
  - .planning/phase-19/migration-plan.md — slot reservation 103-107 with role + rollback semantics + C-8 paired down-migrations
  - scripts/check-route-inventory.sh — Theme 6 / Pitfall 1 CI guard with C-6 method-label parity check
  - scripts/check-phase-19-shim-commits.sh — Pitfall 10 / BACKBONE-04 4-PR commit-message guard with H-7 168h delta check
  - .planning/phase-19/rollback-runbook.md — per-stage rollback runbook (Stage A / B / D distinct paths per MC-7 + transactional DROP VIEW + RENAME recovery per C-4)
  - .planning/phase-19/customer-feedback.md — Theme 4 exit-gate stub
  - .planning/phase-19/stability-log.md — BACKBONE-04 7-day stability window log stub
affects:
  - 19-02 (migrations 103-107) — consumes the slot reservation table
  - 19-04 (process-key router) — consumes the route-inventory map
  - 19-05 (next.js thin adapters + 4-PR shim) — guarded by check-phase-19-shim-commits.sh
  - 19-07 (flag-monitor cron + drain) — referenced from rollback runbook

# Tech tracking
tech-stack:
  added: []  # entry-gate plan ships docs + bash CI scripts only; no library or framework additions
  patterns:
    - "Route-inventory completeness CI guard with method-label parity (route file `export METHOD` declarations cross-checked against the inventory's Method column — catches the kind of mistake C-6 caught for keys/[id]/permissions)"
    - "Per-stage rollback runbook for VIEW-shim sequences — Stage A (write-only repoint), Stage B (flag flip, legacy table still real), Stage D (VIEW + INSTEAD OF triggers active) each get their own rollback path because the failure modes differ"
    - "Squash-merge protection via commit-message convention regex (phase-19-shim-step-{a|b|c|d}:) + git-history order assertion + monotonic-time delta floor between commits (b) and (d)"

key-files:
  created:
    - .planning/phase-19/route-inventory.md
    - .planning/phase-19/migration-plan.md
    - .planning/phase-19/rollback-runbook.md
    - .planning/phase-19/customer-feedback.md
    - .planning/phase-19/stability-log.md
    - scripts/check-route-inventory.sh
    - scripts/check-phase-19-shim-commits.sh
  modified: []

key-decisions:
  - "Renumber Phase 19 migrations 093-097 -> 103-107 (slots 093/094/098-102 are shipped; 095-097 consumed in absentia by Phase 16 prep migration-drift-resolution.md)"
  - "Primary auto-rollback path is the Supabase feature_flags kill-switch row flip, NOT a vercel env-var mutation — env-var rm/add leaves a 30s gap where the legacy fallback raises SQLSTATE 42501 after PR-D ships INSTEAD OF triggers on the VIEW (C-4)"
  - "Route inventory's keys/[id]/permissions row labeled GET (not POST) per ground-truth verification at src/app/api/keys/[id]/permissions/route.ts:97 (C-6)"
  - "C-6 method-label parity check (extension of check-route-inventory.sh) cross-checks every inventory row's Method column against the actual `export (const|async function) METHOD` declarations in the corresponding route file — catches the kind of mistake C-6 caught and surfaced 3 additional drift cases in this very plan (see Deviations)"
  - "H-7 168h delta enforced inside check-phase-19-shim-commits.sh — anyone landing all 4 shim commits in one day fails the guard; the 7-day BACKBONE-04 stability window is now a CI-enforced hard gate"

patterns-established:
  - "Pattern: Inventory documents NOT the only-non-GET routes but ALL routes touching sentinel tables (with documented method label) so the CI guard's parity check has a complete map. GET-only rows like strategies/draft/route.ts are kept for documentation completeness."
  - "Pattern: Rollback runbooks sliced by deploy stage (Stage A/B/D), not by trigger source. The same kill-switch flip behaves differently depending on which migration has shipped; documenting per-stage avoids the 'naive vercel env rm produces 500s' trap."
  - "Pattern: VIEW-shim 4-PR sequence ships as 4 distinct commits with prefix phase-19-shim-step-{a|b|c|d}: — squash-merge protection via prefix grep + order assertion + 168h time-delta floor. Plan-checker rejects Phase 19 exit if the convention is violated."

requirements-completed: [BACKBONE-04, BACKBONE-10]

# Metrics
duration: 14min
completed: 2026-05-08
---

# Phase 19 Plan 01: Entry-Gate Docs Summary

**Phase 19 entry-gate satisfied — route-inventory.md + migration-plan.md + 2 CI guard scripts (check-route-inventory.sh with C-6 method-label parity; check-phase-19-shim-commits.sh with H-7 168h delta enforcement) + per-stage rollback runbook (Stage A/B/D) + 2 founder-fillable exit-gate stubs.**

## Performance

- **Duration:** ~14 min
- **Started:** 2026-05-08T10:46:24Z
- **Completed:** 2026-05-08T10:59:47Z
- **Tasks:** 3
- **Files created:** 7
- **Files modified:** 0

## Accomplishments

- BACKBONE-10 entry gate satisfied: route-inventory.md maps every Next.js non-GET handler under `src/app/api/**` touching the 6 sentinel tables (api_keys, strategies, strategy_analytics, verification_requests, strategy_verifications, compute_jobs) to either `flow_type=teaser|onboard|csv|resync` (5 unification targets) or `out of scope, rationale: …` (9 explicit refusals).
- C-6 fix landed end-to-end: keys/[id]/permissions row labeled GET (not POST per the original RESEARCH.md sketch — verified at route.ts:97), and `scripts/check-route-inventory.sh` extended with a method-label parity check that cross-references inventory Method labels against actual `export (const|async function) METHOD` declarations. The parity check immediately caught 3 additional drift cases in this very plan (see Deviations).
- Migration slots 103-107 reserved with explicit role + rollback semantics (renumbered from REQUIREMENTS.md's 093-097 because 093/094/098-102 are shipped). Each forward migration has a paired `down/{N}-rollback.sql` line in the plan (C-8 fix).
- C-4 / MC-7 fix: `rollback-runbook.md` documents three distinct rollback regimes (Stage A post-PR-A; Stage B post-PR-B / pre-PR-D; Stage D post-PR-D) with the Supabase kill-switch row flip as the primary path and a transactional `DROP TRIGGER + DROP VIEW + RENAME verification_requests_legacy -> verification_requests` recovery for post-PR-D state.
- H-7 fix: `scripts/check-phase-19-shim-commits.sh` enforces the 168h (604800s) delta between shim commits (b) and (d), turning the 7-day BACKBONE-04 stability window into a CI-blocking gate.
- BACKBONE-04 commit-message convention guard armed: 4 prefixes (a/b/c/d) + git-history order assertion + monotonic-time floor.
- Theme 4 (`customer-feedback.md`) and BACKBONE-04 / BACKBONE-09 (`stability-log.md`) exit-gate stubs created with capture format ready for founder fill-in.

## Task Commits

Each task was committed atomically:

1. **Task 1: Write `.planning/phase-19/route-inventory.md` (BACKBONE-10 entry gate)** — `c1ec9d1` (docs)
2. **Task 2: Write `.planning/phase-19/migration-plan.md` (Phase 19 entry gate)** — `ee02b58` (docs)
3. **Task 3: Write CI guard scripts + 3 phase-exit stub files** — `16280bc` (feat)

The Task 3 commit also folded the Rule 1 fix to `route-inventory.md` (3 method-label corrections caught by the parity check on first run — see Deviations).

## Files Created

- `.planning/phase-19/route-inventory.md` — 14-row Phase 19 route inventory, 37 lines (BACKBONE-10 entry gate); maps every non-GET handler touching the 6 sentinel tables to `flow_type=` or `out of scope, rationale:`.
- `.planning/phase-19/migration-plan.md` — 5-row slot reservation table 103-107 with role + rollback semantics + C-8 paired down-migrations, 52 lines.
- `.planning/phase-19/rollback-runbook.md` — Stage A / Stage B / Stage D rollback procedures, 80 lines; primary path is Supabase kill-switch row flip; Stage D includes the transactional `DROP TRIGGER + DROP VIEW + RENAME` recovery.
- `.planning/phase-19/customer-feedback.md` — Theme 4 exit-gate template (founder fills with verbatim feedback from 1-2 onboarding teams).
- `.planning/phase-19/stability-log.md` — BACKBONE-04 7-day stability window log template (Sentry error envelope rate per day; vcrpy + `repro-key-flow.sh` cassette refresh per day).
- `scripts/check-route-inventory.sh` — executable; greps `src/app/api/**/route.ts` for non-GET handlers touching the 6 sentinel tables, asserts each appears in the inventory, then runs the C-6 method-label parity check against the inventory's Method column. Exits 0 against the current branch (verified end-to-end on this commit).
- `scripts/check-phase-19-shim-commits.sh` — executable; asserts 4 commits with prefix `phase-19-shim-step-{a|b|c|d}:` exist and are in order, plus the H-7 168h delta between commits (b) and (d). Syntactically valid (`bash -n`); the order check + 168h floor only fire after Wave 3 P5 lands.

## Decisions Made

- Migration slot renumber 093-097 -> 103-107 (REQUIREMENTS.md's original FINGERPRINT-01 reference to "Migration 096" is impossible because 093/094/098-102 are shipped; 095-097 are consumed in absentia by Phase 16 prep `migration-drift-resolution.md`).
- Primary auto-rollback target is the Supabase `feature_flags` kill-switch row, NOT a Vercel env var flip. Avoids redeploy churn AND avoids the 30s window where post-PR-D state's INSTEAD OF triggers raise SQLSTATE 42501 on legacy fallback writes (C-4).
- C-6 GET label for `keys/[id]/permissions` instead of the original POST sketch — verified at route.ts:97. Plus the C-6 fix in `scripts/check-route-inventory.sh` makes this kind of drift impossible to ship undetected going forward.
- `rollback-runbook.md` is sliced by deploy stage rather than trigger source — Stage A (write-only repoint) / Stage B (flag flip, legacy table still real) / Stage D (VIEW + INSTEAD OF triggers active) each get a dedicated section because the kill-switch flip alone is insufficient post-PR-D.
- 4 separate sequential PRs for the VIEW-shim sequence enforced via commit-message convention + 168h time-delta floor; `check-phase-19-shim-commits.sh` makes the squash-merge collapse case (Pitfall 10) impossible without bypassing CI.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] C-6 method-label parity check caught 3 additional method-label drift cases in route-inventory.md on first run**

- **Found during:** Task 3 (running `scripts/check-route-inventory.sh` end-to-end against the Task-1 inventory).
- **Issue:** The inventory authored in Task 1 (per the verbatim PLAN.md table) had method labels that disagreed with the actual route file exports for 3 rows beyond the C-6 keys/[id]/permissions row already in the plan:
  - `src/app/api/strategies/draft/route.ts` was labeled `POST/PUT` — actual file exports only `GET = withAuth(...)` at line 27.
  - `src/app/api/strategies/draft/[id]/route.ts` was labeled `PATCH/DELETE` — actual file exports `GET` at line 42 and `DELETE` at line 81; no PATCH.
  - `src/app/api/portfolio-strategies/alias/route.ts` was labeled `POST` — actual file exports only `PATCH` at line 30.
- **Fix:** Updated each row's Method column to match the actual exports + extended the rationale text to cite the verifying line number. The "out of scope" disposition for each is unchanged (these are still pre-validation drafts / allocator-side aliases / not key submissions). All 5 ground-truth-required token greps from the Task 1 acceptance criteria still pass after the fix.
- **Files modified:** `.planning/phase-19/route-inventory.md` (3 row updates).
- **Verification:** `bash scripts/check-route-inventory.sh` exits 0 with the new message `OK: route inventory complete + every non-GET row mapped + method-label parity verified (C-6).`. Task 1 automated check still passes (`flow_type=teaser|onboard|csv|resync` all present; `out of scope, rationale:` present; `keys/[id]/permissions` row still labeled GET).
- **Committed in:** `16280bc` (folded into the Task 3 commit alongside the script + rollback runbook + stubs because the parity check is the surfacing mechanism).

---

**Total deviations:** 1 auto-fixed (1 Rule 1 — bug)
**Impact on plan:** The fix is a positive validation of the plan's own C-6 mitigation. The parity check fired on its first end-to-end run and prevented 3 method-label discrepancies from shipping into the Phase 19 entry gate. No scope creep; the inventory's structure and disposition for each row are unchanged.

## Issues Encountered

- **Worktree base predates Phase 19 directory:** the worktree branch is based on `e9439e5` (v0.22.5.0), which predates the local-only creation of `.planning/phases/19-unified-backbone-conditional-on-day-2-gate-commit/` in the main checkout. Resolved by copying the phase-19 plan/context/research files into the worktree's `.planning/phases/` mirror at session start so the Read tool could resolve them. The actual planned files (`route-inventory.md`, `migration-plan.md`, etc.) under `.planning/phase-19/` are created from scratch by this plan — no overlap.
- **`.planning/` gitignored but tracked-by-precedent:** `.gitignore` line 50 ignores `.planning/`, but `.planning/STATE.md`, `.planning/ROADMAP.md`, `.planning/REQUIREMENTS.md`, and `.planning/phases/**/*PLAN.md` are tracked because earlier phases force-added them. Followed the established convention: `git add -f` for all `.planning/phase-19/*.md` and `.planning/phases/19-…/19-01-entry-gate-docs-SUMMARY.md`.

## User Setup Required

None — no external service configuration required. The kill-switch row, INSTEAD OF triggers, feature_flags table, and Sentry alerts are wired in later Phase 19 plans (P2 + P7); this plan ships entry-gate docs + CI guard scripts only.

## Next Phase Readiness

- Phase 19 entry-gate plan-checker greps satisfied: `route-inventory.md` (BACKBONE-10) + `migration-plan.md` (slots 103-107) both present and grep-passing.
- Wave 1 P2 (migrations 103-107) is unblocked and can start as soon as the Wave 1 orchestrator dispatches it — slots reserved upfront with role + rollback semantics documented.
- Wave 3 P5 (Next.js thin adapters + 4-PR shim) is gated on `scripts/check-phase-19-shim-commits.sh` — the H-7 168h delta + commit-prefix order assertion are armed and waiting.
- Founder fill-in tasks queued: `customer-feedback.md` (≥1 verbatim entry before milestone close) + `stability-log.md` (daily entries during the 7-day stability window post-flag-flip).

## Self-Check: PASSED

- File `.planning/phase-19/route-inventory.md` — FOUND (37 lines).
- File `.planning/phase-19/migration-plan.md` — FOUND (52 lines).
- File `.planning/phase-19/rollback-runbook.md` — FOUND (80 lines).
- File `.planning/phase-19/customer-feedback.md` — FOUND (22 lines).
- File `.planning/phase-19/stability-log.md` — FOUND (35 lines).
- File `scripts/check-route-inventory.sh` — FOUND, executable, exits 0 against current branch.
- File `scripts/check-phase-19-shim-commits.sh` — FOUND, executable, syntactically valid.
- Commit `c1ec9d1` (Task 1) — FOUND in branch history.
- Commit `ee02b58` (Task 2) — FOUND in branch history.
- Commit `16280bc` (Task 3) — FOUND in branch history.

---
*Phase: 19-unified-backbone-conditional-on-day-2-gate-commit*
*Completed: 2026-05-08*
