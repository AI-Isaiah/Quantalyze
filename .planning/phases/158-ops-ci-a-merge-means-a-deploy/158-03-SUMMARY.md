---
phase: 158-ops-ci-a-merge-means-a-deploy
plan: 03
subsystem: testing
tags: [supabase, compute-jobs, pytest, tsx, ops, shared-test-db]

requires:
  - phase: 158-ops-ci-a-merge-means-a-deploy
    provides: 158-RESEARCH.md §OPS-04 (reaper predicate, backlog mechanism, PR #674 correction) and 158-PATTERNS.md (seed-demo-data.ts interlock analog)
provides:
  - "claimed_at stamps on the two direct running-flip UPDATEs in test_compute_jobs_fencing.py — a mid-test death can no longer strand a permanently-unreapable row"
  - "scripts/drain-test-compute-backlog.ts — guarded, re-runnable, TEST-only compute_jobs drain (five interlocks, terminalize-never-destroy, zero scheduler references)"
  - "158-OPS04-DRAIN-EVIDENCE.md — the measurement protocol plus an HONEST not-measured record"
affects: [shared-test-db hygiene, compute queue ops, any future OPS-04 closure attempt]

actuals:
  tokens: 9700
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Interlock-before-import: all target guards evaluate before the DB client module is dynamically imported, so a misrouted target cannot emit a packet — and the refusals are observable without any network or node_modules"
    - "Fixture-derived allowlist parsed from the seeder's own source at runtime (single source of truth); a parse failure REFUSES rather than silently allowlisting nothing"

key-files:
  created:
    - scripts/drain-test-compute-backlog.ts
    - .planning/phases/158-ops-ci-a-merge-means-a-deploy/158-OPS04-DRAIN-EVIDENCE.md
  modified:
    - analytics-service/tests/test_compute_jobs_fencing.py
    - TODOS.md

key-decisions:
  - "Terminal status is failed_final, NOT the plan's 'failed' — the compute_jobs.status CHECK admits no 'failed', and failed_retry is re-claimable (not terminal)"
  - "Terminalize, never destroy: WR-02 doctrine applied on TEST; enforced by a negative source grep rather than by discipline"
  - "Staleness anchor is the conjunction created_at AND updated_at AND claimed_at older than 24h, so a concurrent CI run's rows are structurally out of the target set"
  - "The drain was NOT executed and the evidence tables were left empty rather than populated with invented or carried-forward numbers — OPS-04 stays open"

patterns-established:
  - "Interlock-before-import: guards run before the client module is imported; refusals are observable offline"
  - "Non-vacuity control for a guard suite: prove the guards ACCEPT a legitimate target (unresolvable TEST-ref host) as well as refusing bad ones"

requirements-completed: []

coverage:
  - id: D1
    description: "Both direct running-flip UPDATEs in test_compute_jobs_fencing.py stamp claimed_at with a current-time expression, so a row stranded by a dying test is reapable by reset_stalled_compute_jobs"
    requirement: OPS-04
    verification:
      - kind: other
        ref: "awk region-scope over tests/test_compute_jobs_fencing.py | grep '\"claimed_at\": datetime.now(timezone.utc).isoformat()' → 1 per target function; the same grep returns 0 against the pre-change revision"
        status: pass
      - kind: integration
        ref: "analytics-service/tests/test_compute_jobs_fencing.py#test_defer_compute_job_token_fence, #test_defer_compute_job_null_token_backcompat"
        status: unknown
    human_judgment: true
    rationale: "Both target tests SKIPPED locally (no TEST Supabase project configured in the worktree) — 16 passed, 28 skipped. The stamps are grep-proven but never executed here; CI is their first real run and a human must confirm it went green."
  - id: D2
    description: "Guarded TEST-only drain tool whose unsafe invocations were observed to refuse, with terminalize-never-destroy and scheduler-untouched encoded in code"
    requirement: OPS-04
    verification:
      - kind: other
        ref: "5 observed refusals (missing env / prod-word regex / PROD-ref deny / TEST-ref required / DRAIN_CONFIRM_TEST) all exit 3 before any network call, plus an unknown-flag refusal"
        status: pass
      - kind: other
        ref: "negative source gates: grep -c 'delete(' → 0; grep -ic 'cron\\.' → 0; git diff --stat over supabase/migrations → empty"
        status: pass
      - kind: other
        ref: "tsc --strict --noEmit (typescript 6.0.3, @types/node) on scripts/drain-test-compute-backlog.ts → clean; demonstrably red earlier in the same session"
        status: pass
    human_judgment: false
  - id: D3
    description: "OPS-04 closed on measured before/after row counts on TEST, drain proven idempotent, MODE 2 outcome recorded"
    requirement: OPS-04
    verification: []
    human_judgment: true
    rationale: "NOT DONE. No TEST service-role credentials were available and live-DB execution was barred from this worktree; the evidence tables are marked NOT MEASURED rather than fabricated. A human must run the 5-step protocol in 158-OPS04-DRAIN-EVIDENCE.md from a credentialed checkout."

duration: 42min
completed: 2026-08-20
status: halted
---

# Phase 158 Plan 03: OPS-04 drain + `claimed_at` stamps Summary

**The fencing tests can no longer strand unreapable `running` rows, and a five-interlock TEST-only drain tool now exists and was observed refusing every unsafe target — but the drain itself was never run, so OPS-04 stays open on missing measurements rather than closed on invented ones.**

## Performance

- **Duration:** ~42 min
- **Completed:** 2026-08-20T16:14:10Z
- **Tasks:** 3 executed (Task 3's acceptance criteria NOT met — see Deviations)
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments

- **Both defective UPDATEs stamped.** `test_defer_compute_job_token_fence` (`:1148`) and
  `test_defer_compute_job_null_token_backcompat` (`:1200`) now write
  `claimed_at: datetime.now(timezone.utc).isoformat()`. `reset_stalled_compute_jobs` reclaims
  only rows matching `claimed_at IS NOT NULL AND claimed_at < now() - threshold`
  (migration `20260516104201:667-668`), so before this change a test dying between its
  running-flip and its `finally` cleanup left a row the watchdog could never see. Current time,
  not backdated — the row ages into the reaper window only if the test dies.
- **Whole-class audit, not a point fix.** Every one of the nine direct `compute_jobs` UPDATEs in
  the file was classified (table below). There is no third instance of the same defect.
- **The drain tool exists and its guards are proven, not asserted.** Five independent interlocks,
  each with its own message, all evaluated *before* `@supabase/supabase-js` is imported. All five
  were OBSERVED refusing with exit 3, and a non-vacuity control proved they still ACCEPT a
  legitimate TEST target.
- **The failure to measure is recorded loudly**, in the evidence artifact, in `TODOS.md`, and in
  this SUMMARY's `status: halted`.

## Task Commits

1. **Task 1: Stamp `claimed_at` in the two direct running-flip UPDATEs** — `5ed93964` (test)
2. **Task 2: Build the guarded TEST-only drain script** — `2c747d62` (feat)
3. **Task 3: Execute the drain and record measured evidence** — `dc9b5692` (docs) — *authored the
   artifact and the deferral; the drain was NOT executed*

## Files Created/Modified

- `scripts/drain-test-compute-backlog.ts` *(new, 525 lines)* — MODE 1 terminalizes stale
  `derive_broker_dailies` rows to `failed_final` with a provenance note in `last_error`;
  MODE 2 (`--flip-eligibility`, second confirm env) narrows the fan-out's own `api_keys`
  eligibility predicate. Header doc doubles as the operating runbook.
- `analytics-service/tests/test_compute_jobs_fencing.py` — two payloads stamped, each with a
  comment explaining why the stamp is current-time rather than backdated.
- `.planning/phases/158-ops-ci-a-merge-means-a-deploy/158-OPS04-DRAIN-EVIDENCE.md` *(new)* —
  semantics decisions, interlock transcript, the 5-step measurement protocol, and empty
  BEFORE/AFTER tables explicitly marked NOT MEASURED.
- `TODOS.md` — three `[158-OPS-04]` deferral entries.

## Direct-UPDATE audit (Task 1 acceptance criterion)

| Site | Classification |
|------|----------------|
| `:1108` | Deliberate backdate (`2020-01-01`) on a row already claimed via `_claim_one` — correct as-is |
| `:1148` | **DEFECT — fixed.** Flipped to `running` with no `claimed_at` |
| `:1200` | **DEFECT — fixed.** Flipped to `running` with no `claimed_at` |
| `:1277`, `:1361`, `:1726`, `:1807` | Deliberate backdates on already-claimed rows — correct as-is |
| `:2914` | Rotates `claim_token` only, on a row claimed via `_claim_one` (`claimed_at` already set) |
| `:2924` | Flips status to `pending`, not `running` — outside the reaper predicate entirely |
| `:840`, `:952`, `:962` | In-memory `_StubQueueAdmin` dicts, never touch a database |

**Result: no third same-class omission.** The class is closed.

## Decisions Made

- **`failed_final`, not `failed`.** The plan's action text said "set status to `'failed'`". The
  `compute_jobs.status` CHECK (migration `20260411144407:113-120`) admits only
  `pending / running / done / done_pending_children / failed_retry / failed_final`. Writing
  `'failed'` would have been rejected by the constraint at runtime, and `failed_retry` is
  re-claimable so it is not terminal. `failed_final` is additionally what the 90-day retention
  sweep already purges, so terminalized rows self-clean.
- **Terminalize, never destroy** (WR-02 symmetry), enforced by a negative source grep.
- **Staleness = the conjunction of `created_at`, `updated_at` and `claimed_at` older than 24h.**
  The plan suggested "claimed_at for running rows when present, else created_at". A row created
  25h ago but claimed a minute ago is live work, so the conjunction is used instead;
  `updated_at` is trigger-maintained (`compute_jobs_set_updated_at_trigger`) and is the honest
  last-touched anchor. This is what makes threat T-158-12 (racing concurrent CI rows)
  structurally impossible rather than merely unlikely.
- **MODE 2 allowlist is parsed from `scripts/seed-full-app-demo.ts`'s `API_KEY_IDS` at runtime**
  rather than copied. That fixture calls `main()` at module scope, so it cannot be imported —
  a regex parse of its source keeps one source of truth without triggering a live seed. Parse
  failure refuses. The e2e badge/wizard fixtures mint a fresh key per run with a
  `uniqueSuffix()` label and have no stable id to enumerate; the 7-day age cutoff covers them.
- **Empty tables over invented ones.** See below.

## Deviations from Plan

### 1. [Rule 1 — Bug] Plan specified a status value the schema rejects

- **Found during:** Task 2
- **Issue:** The plan's action text instructed "set status to `'failed'`". `compute_jobs.status`
  has a CHECK constraint that does not include `'failed'`; the UPDATE would have failed at
  runtime against every targeted row.
- **Fix:** Terminalize to `failed_final` (with `error_kind: 'permanent'`), verified against the
  migration's CHECK list.
- **Files modified:** `scripts/drain-test-compute-backlog.ts`
- **Committed in:** `2c747d62`

### 2. [Rule 3 — Blocking] Task 3's precondition was UNMET — the drain was not executed

- **Found during:** Task 3 (precondition check)
- **Issue:** The precondition requires TEST service-role credentials under
  `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`. Both are unset in this worktree and
  the only env file present is `.env.example` (gitignored env files do not propagate into a
  `git worktree`). The executor was additionally barred by phase constraint from running the
  drain against any live database from this worktree, and from improvising access.
- **Handling:** Per the explicit spawning instruction ("if credentials are unavailable, record
  that in SUMMARY.md as a deviation rather than improvising access"), this was recorded rather
  than raised as a checkpoint — a checkpoint could not have unblocked it, since execution is
  out of scope by constraint.
- **Consequence:** Task 3's acceptance criteria are **NOT met**. The evidence file carries empty
  BEFORE/AFTER tables explicitly marked NOT MEASURED, plus the exact 5-step protocol to close
  it. No number was estimated, and the dated 2026-08-11 ledger figures (2320 pending / 2325
  running) were deliberately NOT carried forward as if they were a measurement.
- **Tracked in:** `TODOS.md` → *Phase 158 — recorded deferrals* (3 entries), and
  `status: halted` in this SUMMARY's frontmatter.

### 3. [Rule 3 — Blocking] MODE 2 eligibility flip deferred (same root cause)

- No eligible-key measurement, no flip. Recorded explicitly in both the evidence file and
  `TODOS.md` — never silence, per the plan's own instruction.

---

**Total deviations:** 3 (1 schema-correctness auto-fix, 2 blocking-precondition deferrals)
**Impact on plan:** The tooling half of OPS-04 is complete and verified. The measurement half is
untouched, so **OPS-04 is not closed and ROADMAP 158 SC-4 does not yet hold.**

## Issues Encountered

- **The two stamped tests never executed.** `python3 -m pytest tests/test_compute_jobs_fencing.py -q`
  from `analytics-service/` reports `16 passed, 28 skipped`; both targets are among the skips
  (`test Supabase project not configured (local dev)`). The plan's own verification called the
  payload greps "the floor" — that floor was met, and it was proven falsifiable (the same
  region-scoped grep returns 0 against the pre-change revision). CI hard-fails rather than
  skipping when the `TEST_SUPABASE_*` secrets are wired, so CI is the first real execution.
- **No `node_modules` in a GSD worktree** (a known measured constraint). Verification used the
  main checkout's pinned binaries by absolute path (`tsx` 4.x, `typescript` 6.0.3) against the
  worktree's source — read-only tool use, no cross-worktree writes, no git operations outside
  this worktree.
- **Verifying guards without a database.** The interlock-before-import structure made this
  possible offline: unsafe targets refuse before any module load, and the accept path was proven
  with an unresolvable TEST-ref host (`https://qmnijlgmdhviwzwfyzlc.invalid`) that reaches the
  first `SELECT` and dies on DNS. The real TEST project was never contacted.
- **An auto-suggested `vercel-storage` skill fired** on the `@supabase/supabase-js` import
  pattern. Not invoked: it covers Vercel Blob / Edge Config / Marketplace storage, none of which
  are in play; the repo's own `scripts/seed-demo-data.ts` is the governing analog and was
  followed.

## Prohibition checks (plan frontmatter)

| Prohibition | Verification | Result |
|---|---|---|
| Never a migration | `git diff --stat HEAD~3 HEAD -- supabase/migrations` | ✅ empty |
| Never touch the scheduler | `grep -ic 'cron\.' scripts/drain-test-compute-backlog.ts` | ✅ 0 |
| Never destroy a row | `grep -c 'delete(' scripts/drain-test-compute-backlog.ts` | ✅ 0 |
| No secrets in the public evidence artifact | manual read; counts and project refs only (both refs already appear in `ci.yml`) | ✅ |

## User Setup Required

**Yes — OPS-04 cannot close without a human run.** From a checkout with TEST service-role
credentials, run the 5-step protocol in
`.planning/phases/158-ops-ci-a-merge-means-a-deploy/158-OPS04-DRAIN-EVIDENCE.md`, paste the real
BEFORE/AFTER tables and the idempotency zero-delta into that file, and only then close OPS-04.
⚠️ Do not close it on green fencing tests — PR #674 (`c726a250`, 2026-08-12) already made those
green independently of any drain.

## Next Phase Readiness

- The tool and the stamps are landed and independently verifiable; nothing else in phase 158
  depends on this plan (`depends_on: []`).
- **Blocker carried forward:** the TEST backlog is still growing daily. `status: halted` is
  deliberate — resolve it by running the measurement, not by re-summarizing.

---
*Phase: 158-ops-ci-a-merge-means-a-deploy*
*Completed: 2026-08-20*
