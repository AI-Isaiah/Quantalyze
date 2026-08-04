---
gsd_state_version: 1.0
milestone: v1.17
milestone_name: MT5 — usable end-to-end, not merely ingested
status: planning
last_updated: "2026-08-04T17:10:00.000Z"
last_activity: 2026-08-04
progress:
  total_phases: 9
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State — Quantalyze

> ⚠️ **2026-07-16 recovery note (standing):** `ROADMAP.md`, `STATE.md`, `REQUIREMENTS.md` (gitignored local ledgers) were once deleted during a `git checkout` flake-test and reconstructed. Never `git checkout` between commits with live `.planning` ledgers — `git stash -u` / isolated worktree / `git show` instead. Also (v1.15 close lesson): never rewrite these ledgers with `head|sed` pipes — BSD sed truncation destroyed ROADMAP.md once.

## Project Reference

**Core value:** Allocators act on Bridge recommendations and see whether those suggestions actually worked — and can model the impact of composition changes before they make them.

**Milestone v1.17 — MT5: usable end-to-end, not merely ingested, Phases 147–155.**
Founder verbatim (2026-08-04, minutes after MT5-05 was discharged on PROD): *"The goal is that
MT5 works. And at the moment, maybe it ingests the data, but I cannot use it in the scenario,
and I can still not produce a factsheet."* Scope = **SCEN** (the series actually reaches the
engine — SCEN-01 is a silent money-path bug: `strategy_analytics.daily_returns` has NO
production writer, 0/27 real strategies vs 15/15 demo seeds; fix the READER via the existing
`resolveDailyReturnSeries`, difference the wealth-index `returns_series`, never backfill against
migration 087), **OWN/NAV** (owner factsheet without cache disclosure — adversarial anon-404
acceptance — plus "my strategies" nav, preview link, and the own-capital-vs-verifying-a-team
wizard question, money-path reviewed — THREE phases 148/149/150 since the 2026-08-04 revision: NAV-01 was sharpened to a RANKING at discovery parity and split out, OWN-03's money-path write isolated), **AUM** (direct AUM input; non-ccxt holdings-sync crash
fixed as a CLASS incl. latent sFOX; all-or-nothing book gate + cross-role contamination; honest
copy), **WIZ** (inline field errors, honest codes, absorbed transient failures, continuity,
token-less dedup, MT5 declarable + preselected), **STALE** (root cause NOT established —
investigate before fixing), **MT5-VERIFY** (live trading-day external-oracle verification,
MT5-10 UNCAPPED, `complete_with_warnings` explained; MT5-GOAL-01 umbrella acceptance gate).
⭐ Almost NONE of this is an MT5 defect — MT5 is the first venue through the whole path from a
cold start; a fix scoped to `exchange === 'mt5'` is the wrong fix for nearly all of it.
Research SKIPPED (every requirement already root-caused with PROD evidence + file:line).

Requirements: `.planning/REQUIREMENTS.md` (29 in-scope IDs — SCEN-01..05, AUM-01..05, NAV-01,
OWN-02..04, MT5-06..10, MT5-14, MT5-15, WIZFORM-01..04, WIZCONT-01..02, STALE-01 + MT5-GOAL-01
umbrella — 29/29 mapped to Phases 147–155, Traceability updated; OWN-01 excluded, already met).
Roadmap: `.planning/ROADMAP.md` (v1.17 section, Phases 147–155).

⏸️ **v1.16 Production Resilience & Reliability is PARKED at 68%** (13/19 phases, 119/127 plans)
— NOT shipped, NOT complete. Outstanding: 143 (dropped-enqueue sweep), 144 (WR-02 — carries the
LIVE TEST-DELETE/PROD-reset founder decision, same migration), 145 (csv-finalize,
reproduce-first), 146 (RATE). **Resume at Phase 143 after v1.17.** All 29 phase directories
preserved (`phases.clear` skipped by founder call). Phase 142.3's scope (MT5-06..10) and MT5-14
are re-homed into v1.17 (Phases 155 / 153); 142.3 will not run as a v1.16 phase.

## Current Position

Phase: 147 of 147–155 (not started)
Plan: —
Status: Roadmap revised — 9 phases (approved Phase 148 split into 148/149/150 after NAV-01 was sharpened to ranking parity), 29/29 in-scope requirement IDs mapped; ready to plan Phase 147
Last activity: 2026-08-04 — v1.17 roadmap revised to Phases 147–155 (148 split three ways); v1.16 parked at 68% (resume at Phase 143)

### Phase 142.1 scope (inserted 2026-08-02)

Sources — THREE independent passes, deliberately not cross-fed:

- **Pass A** — high-effort workflow code review (35 agents; 31 candidates verified,
  17 refuted, 10 reported) → items 1–10.

- **Pass B** — `gsd-code-reviewer`, blind to Pass A → 0 blockers, 4 warnings.
  WR-01/03/04 re-derived items 1, 5 and a Pass-A-refuted item; WR-02 was new.

- **Pass C** — `gsd-verifier` on Phase 142, the goal-backward pass that had never
  run. Verdict **`gaps_found`, 9/10 must-haves**. It did NOT trust SUMMARY claims:
  it stood up a throwaway PostgreSQL 16, extracted the real `$cron$` body and the
  real re-based bridge from the migration, and executed them. **The phase goal IS
  achieved** — all four ROADMAP SCs hold behaviourally. Gaps → items 11–14, 16.

**Sixteen items in scope.** Convergence is itself signal: item 1 was found
independently by all three passes.

1. **CONFIRMED — `analytics_runner.py:1238`.** `_mark_computing` re-stamps
   `computing_started_at` on a row that is ALREADY `computing`, so the reap clock
   restarts at the LAST chain hop instead of chain start. Worst-case stranded
   spinner ≈28 h, not the 16 h the threshold derivation and migration header
   promise. Note the shape: the migration's Arm 3 and the SQL gate's Part 4
   sentinel correctly forbid a *bridge* call from advancing the stamp — verified
   live on TEST — but the Python writer sets the column DIRECTLY, outside that
   boundary. The cross-language census passed because it checks that writers
   stamp, not that they stamp ONLY on transition.

2. **`analytics_runner.py:1238`.** The `computing_started_at` payload ships ahead
   of its own migration. Merging `supabase/migrations/**` auto-applies to PROD
   while Railway/Vercel redeploy independently; a worker that restarts first gets
   PGRST204, and the catch-all recovery write carries the SAME unknown key, so the
   job cannot even stamp `failed`.

3. **`csv-finalize/route.ts:769`.** The lone terminal-`failed` writer missing
   `computation_warned: false`; the bridge's branch (c) then resolves the row back
   to `complete_with_warnings` and shows a green factsheet built from the prior
   run's stale metrics. Money-surface false success.

4. **`test_computing_started_at_stamp.py:631`.** The TS half of the census globs
   only `src/app/api/**/*.ts` (and pins `EXPECTED_TOTAL = 4` to that same narrow
   set), so a writer added in a `.tsx` server action or `src/lib` passes silently
   and re-creates the exact permanent spinner 142 exists to kill.

5. **`test_strategy_analytics_stuck_computing_reaper.sql:339/340/343`.** Three
   unqualified table-wide neutralizing UPDATEs row-lock other tenants' in-flight
   rows on the SHARED TEST project under a 5 s `lock_timeout` — the same
   shared-DB contention class already fixed once for `e2e-seeded`.

6. **`test_job07_reaper_off_worker_loop.py:550`.** The yielding control arm pins
   REAL wall-clock latency (`< 0.1 s`) plus a `0.2 s` staleness threshold against a
   real asyncio server, while pytest shards run in parallel on a shared runner. A
   200 ms GC pause reddens `analytics` on an unrelated PR, and the message ("a
   yielding reap must not delay healthz") misdirects the next engineer to the
   reaper instead of runner contention. The property is ALREADY proven
   deterministically by the `tick_before_work` / `tick_after_work` pair — delete
   the wall-clock budget rather than loosen it.

7. **`test_computing_started_at_stamp.py:375`.** The AST gate raises on any
   `strategy_analytics` write payload it cannot statically resolve
   (`.upsert(base | extra)`, `{**base, …}` bound through two names, a dict
   comprehension, a payload returned from a helper). It is a static analyser
   masquerading as a test: an unrelated refactor into a payload-builder helper
   forces the developer to abandon the refactor or add AST arms to a 785-line test
   file. ⚠️ **Decide this one before touching 4 or 7 in isolation** — it is the
   strongest argument for relocating the whole invariant into a BEFORE
   INSERT/UPDATE trigger, where payload shape and call-site language are both
   irrelevant. A trigger would subsume findings 1, 4 and 7 at once.

8. **`test_main_worker.py:1295`.** `assert len(TIMEOUT_PER_KIND) == 15` couples
   every future job-kind addition to the reaper suite. The cheapest way to green it
   is to bump the literal WITHOUT the re-derivation the assertion message demands —
   the trip-wire trains the exact behaviour it exists to prevent. Replace with:
   assert the chain map covers every kind that can hold a `strategy_analytics` row
   at `computing` (every kind with a `strategy_id`), which does not move when a
   strategy-less kind is added.

9. **`test_job07_reaper_off_worker_loop.py:346`.** `backlog_rows=5_000` builds
   15,000 dicts across three invocations that no code under test reads (`dispatch`
   is patched; the reaper is in pg_cron and never touches the mock). The real cost
   is not cycles — the number implies backlog size is load-bearing for the healthz
   outcome, which it is not. Pass `0` or drop the parameter.

10. **`test_computing_started_at_stamp.py:107`.** `_repo_root` is copy-pasted
    verbatim into four test files, the comment-detection helper into five under two
    names, and `_py_scan_files` into three with three DIFFERENT file lists. That
    last divergence is the actual risk: on a repo-layout change one gate keeps
    covering the surface while another silently narrows and still reports green —
    the same silent-narrowing failure mode as finding 4. Extract to
    `tests/_scan_helpers.py` (or conftest) once.

11. **`migration:514` + `:103-107,165-168` (Pass B WR-02 = Pass C gap 3).** Rows
    already at `(computing, NULL)` are invisible to the reaper AND to the gate, and
    the migration CLAIMS the static CI invariant is the detection mechanism for
    them. That claim is a category error — a source scan cannot see DB rows.
    Distinct from item 4: item 4 is "the gate has a hole"; this is "no gate of any
    kind could cover it, because the rows already exist." Reachable with no source
    bug at all, via the migration-auto-applies-before-Railway-deploy window
    (item 2). Suggested remedy: a non-destructive companion cron arm that STARTS
    the clock rather than terminalizing.

12. **⛔ `supabase/schema/functions/sync_strategy_analytics_status.sql` IS STALE —
    CI IS RED (Pass C gap 1).** `npx tsx scripts/dump-sql-functions.ts --check`
    **exits 1**; ORCHESTRATOR-VERIFIED 2026-08-02, not taken on the agent's word.
    The declared canonical body is the PRE-142 function with no stamp maintenance
    at all. This is wired into a real CI job — `sql-function-snapshot.yml:84`,
    path-triggered on migrations — so the branch is red on a gate nobody ran
    locally. **Fix: `npm run schema:functions` + commit.** Do this FIRST; it is a
    one-command fix and it is currently the only hard-red gate on the branch.

13. **`.planning/REQUIREMENTS.md:53` (Pass C gap 7).** JOB-03 still specifies the
    threshold as `batch_size × max_per_kind_timeout` — ORCHESTRATOR-VERIFIED, the
    text is still there. That is the exact formula research collision C-6 proved
    would yield 9,000 s (≈4.9× too small) and reap healthy in-flight chains. The
    shipped code correctly uses the 43,920 s chain-inclusive derivation, so the
    REQUIREMENT now contradicts the implementation and would mislead anyone who
    re-derives from it. Fix the requirement text to match the shipped derivation.

14. **`142-VALIDATION.md` — 7 of 11 Falsifiability Ledger rows are `⬜ pending`
    (Pass C gap 6).** ORCHESTRATOR-VERIFIED: only SC-1, SC-1b, SC-2, SC-2b carry
    `✅ Observed`; SC-3, SC-3b, SC-4, SC-4b, SC-5, SC-5b, SC-5c were never run at
    execution time. Pass C has now RUN all seven and reports each goes RED under
    its mutation, but did NOT write them into the file. Frontmatter also still says
    `status: planned`. Backfill the seven rows from Pass C's table and fix the
    frontmatter. ⚠️ See the correction note below — this ledger was previously
    reported as fully closed, and it was not.

15. **`long_fetch.py:588-592` (Pass B WR-04 = Pass C gap 5) — LOWEST TIER, and
    included with a caveat.** The `JOB_CHAIN_FOLLOW_ON` late import and fixed-arity
    2-tuple unpack sit OUTSIDE the `try:` at `:599` whose own comment says this
    block must never crash the handler. ⚠️ **Pass A raised this THREE times and
    independent verifiers REFUTED it all three times** — correctly: the map is a
    module-level literal 2-tuple, so the unpack cannot fail at runtime today. It is
    latent, biting only after a topology edit. In scope ONLY because it is a
    two-line hoist. Do NOT let anyone record this as "Pass A missed it."

16. **The 637-line SQL gate has NEVER been run end-to-end against TEST by anyone
    (Pass C human-verification item).** Pass C proved it COMPILES (all 5 `DO`
    blocks, zero syntax errors) and reddens when the migration is unapplied, but
    Parts 2–5 need real `auth.users` / `profiles` / `compute_jobs` constraints.
    ⚠️ Orchestrator-only (MCP stripped from subagents). Settling command is in
    `142-VERIFICATION.md`, along with three more human items: cron registration,
    the PROD backfill census, and the live wizard render.

Tiering (do NOT flatten):

- **Hard-red now:** (12) — CI is failing on it.
- **Clear the founder stopping rule on their own:** (1)–(3) — user-facing or
  data-integrity. Plus (11), which is the same permanent-spinner class.

- **Evidence integrity:** (14), (16) — the phase's own proof is incomplete.
- **Do NOT clear the bar; in scope only because the phase exists:** (4)–(10),
  (13), (15). If 142.1 is cut for time, cut from here.

Sequencing notes:

1. Item 12 first — one command, unblocks CI.
2. Settle item 7's trigger-vs-static-gate question BEFORE fixing 1, 4 or 7
   separately. If the invariant moves to a BEFORE INSERT/UPDATE trigger, items 1,
   4, 7 and much of 11 collapse into that single change, and separate fixes would
   be wasted work. Pass B's cheaper alternative for item 1 alone: split
   `_mark_computing` into two statements guarded by
   `.is_("computing_started_at", "null")`.

3. Item 1's real cost is now quantified by two passes independently: worst-case
   reap ≈25.8 h (≈28 h with retries) against the migration header's advertised
   `~16h15m` — under a heading titled "CADENCE HONESTY". `TestReaperThresholdInvariant`'s
   premise no longer matches the code.

⚠️ **CORRECTION (2026-08-02, orchestrator).** Phase 142's ledger was previously
reported in-session as "11 Observed / 0 SKIPPED". That was WRONG. Four rows were
closed (the four that had been marked SKIPPED); the remaining seven were never
SKIPPED — they were `⬜ pending` and had never been run. "No SKIPPED rows remain"
was conflated with "all rows observed". Pass C caught it. Item 14 closes it.

⚠️ **Orchestrator-only work:** (1) and (2) need TEST-DB confirmation, and MCP
tools are stripped from subagents (upstream `anthropics/claude-code#13898`), so
those runs must happen in the orchestrator session, not in a gsd-executor.

✅ **Resolved (was "carried from 142"):** `142-VERIFICATION.md` now EXISTS —
status `gaps_found`, 9/10 — and 142.1 is the phase that closed its findings.
The line that used to sit here claimed no such file existed; it was stale.

Prior phase: 141.1 (seambackoff-…) — COMPLETE and verified, merged, NOT pushed
Plan: 8 of 8 (142.1 executed; verification `human_needed`, 7 UAT items open)
Status: Ready to execute

Prior-phase 141.1 close-out detail (retained; NOT about 142.1):
        `feat/v1.16-141-jobs-rate-retry`. Post-merge gate after Wave 2 GREEN: tsc clean,
        FULL vitest 735 files / 10450 passed / 287 skipped, tsc + lint clean.
        Wave 4 (09) merged. FINAL GATE GREEN: tsc clean, lint 0 errors, vitest
        735 files / 10450 passed / 287 skipped, pytest 4824 passed / 96 skipped.
        VERSION+package.json bumped in lockstep to 0.51.0.0.
        VERIFIED: 0 BLOCKER / 3 WARNING, 19/20 decision IDs (D-06 partial), 16/16 SC.
        The verifier re-traced 20 registry/runbook claims against live source — all
        held. All 3 warnings CLOSED: stale D-06 coordinate replaced with a symbol
        anchor; the two deferred-item ledgers reconciled; the falsifiability ledger
        transcribed 20/20 with three mutations recorded as explicitly UN-RUN
        (SC-C' green-polarity only, SC-G' 2 of 5 anchors un-mutated, SC-K jitter
        constant never mutated alone). Approval: CLOSED 2026-07-31.
        ⚠️ 4 items stay OPEN in TODOS.md: DEF-141.1-02-A/02-B/06-A/09-A.
        ⚠️ FOUNDER ACTION: RESEND_API_KEY + FOUNDER_LP_REPORT_TO must be set in
        Vercel prod or the repaired flag-monitor alert computes correctly and pages
        nobody. The numerator is correctly scoped but has NEVER been observed firing.
        ⭐ SC-E RESOLVED. Precise history (corrected at verification — the earlier
        wording here was itself an over-claim): PRE-D-08 the row fallback WAS
        reachable (the validator was wrapped in `!== undefined`), so 141.1-04's D-08
        change closed a REAL hole. What was wrong was only 04's follow-up
        MEASUREMENT — having closed it, 04 re-added `?? SEAM_BUDGETS[budgetKey].retries`
        as a mutation, saw green, and booked its own already-closed hole as still
        open. Post-D-08 the validator is unguarded, so `undefined` throws
        SeamConfigError first and that mutation is a no-op by construction. 141.1-06
        established this and closed the axis at three independent points via the
        semantically live form. Verified: 04's false framing did NOT propagate into
        the runbook, CHANGELOG, or TODOS.
        ⚠️ ORCHESTRATOR ERROR: `isolation:"worktree"` forks from the DEFAULT BRANCH
        (#2015) — 3/3 spawns came up on `origin/main` 56–67 commits stale, missing
        their `depends_on` commits. GSD prevents this via the `EXPECTED_BASE` +
        `<worktree_branch_check>` block (`execute-phase.md:519,573`); hand-written
        executor prompts OMITTED it. All merged worktrees were verified to contain
        their dependencies, so landed work is sound. Wave 4 uses the verbatim block
        and one-Agent-per-message dispatch (`.git/config.lock` race, `:531`).
        ⚠️ Wave 1 was interrupted by a host restart on 2026-07-31 and resumed in the
        original worktrees. Lesson recorded in `141.1-WAVE-MANIFEST.md`: an
        uncommitted diff left by a killed executor may be an acceptance MUTATION
        mid-probe, not progress — 141.1-08's orphaned `route.ts` diff was exactly
        that (it re-added the dead `path:` term) and was correctly discarded.
        ---- 140.2-05 (wave 5, 2026-07-27) ----
        **ROADMAP SC1 CLOSED.** The classification window now covers the response-body
        read and excludes caller/config faults. A stalling upstream (headers fast, body
        slow) records exactly ONE breaker failure and throws a typed `SeamBodyReadError`;
        a malformed `ANALYTICS_SERVICE_URL` or an invalid `timeoutMsOverride` throws
        `SeamConfigError` BEFORE the window and records ZERO. `redirect: "error"` is on
        every seam call, after the spread so a call site cannot re-enable following.
        A-21+A-22+A-23+A-28 landed in ONE commit (`8322bec4`) after an observed RED
        (15 failing cases). All nine body-read sites instrumented; **zero new catch arms
        outside the two clients** and `postProcessKey` still never throws (its `try` was
        extended over the body read; the new class maps onto the EXISTING 504/502
        envelopes — zero new user-facing copy). M26/M31/M36/M37 observed and reverted.
        ⚠️ **`SEAMCORE-11` is HALF closed and deliberately NOT marked complete:** A-22 /
        A-23 / A-28 are done here; A-15 and A-27 (rows M49, M50, M58) belong to 140.2-11.
        ⚠️ Deferred, real: the `>= 500` arm and the body-read arm can DOUBLE-record for
        one request — closes when 140.2-06 replaces the `>= 500` branch.
        (reconciles `4743 + 4 + 5 + 19 + 1`), mypy 89 files clean, **zero TypeScript in the
        phase diff**, 0 new `# type: ignore`, `grep -rn MUTANT` → 0.
        ⚠️ **PYAPIFIX2-01 is HALF closed on purpose: PYTHON HALF CLOSED (7/7 sites carry
        code+recoverable); RENDER HALF → OB-1 / ledger row TS-35, owner 140.3.** ROADMAP SC1
        and REQUIREMENTS both carry that clause; `/gsd:verify-work` must mirror it verbatim
        into `140.1.2-VERIFICATION.md`, which does NOT yet exist (no stub was created —
        a `status:` field would be a verdict the executor has no authority to give).
        `140.1.1-VERIFICATION.md` was flipped to `status: gaps_found` by this phase.
        ---- historical (Phase 140.1.1) ----
        **PYAPIFIX-05 batch 2 CLOSED (plan 07) → 13/13 survivors phase-wide.**
        8 more mutation runs, **every RED OBSERVED FIRST-HAND**, zero
        "asserted only", zero non-reddening findings. ⭐ **slowapi synced
        0.1.9 → the CI pin 0.1.10 BEFORE any #3/#4/#5 cycle and LEFT there**
        (both dependent internals re-confirmed on 0.1.10: the `if all(args)`
        empty-key skip at `extension.py:506-527`, and `view_rate_limit` =
        `(limit, [key, scope])` at `:530`). #3 `default_platform_key` →
        `return ""` ⇒ 3 failed incl. **`never answered 429 within 4 calls`**;
        #4 → per-request uuid ⇒ 3 failed incl. the stability assertion. The
        old oracle asserted function IDENTITY (true for any body), so the new
        gate drives REAL HTTP requests through a route declaring no
        `key_func`; the `:483` identity assertion is retained. #5
        `_retry_after_seconds` → `return 1` ⇒ 2 failed — `0 < 1 <= 3600`
        passed the old bound, so a `> window * 0.9` band was added at BOTH
        weak sites. New file `tests/test_tenant_claim_parsing.py` (14 tests):
        the four claim-parser guards had **NO test at all**. #8 ⇒ 2 failed
        (⚠️ fixture is a VALID-but-oversized 513-char claim; junk would not
        redden), #9 ⇒ 3 failed, #10 ⇒ 3 failed (mutant bucket literally
        `'claimtest:t:'`), **#11 closed 2 of 2** — `:333` and `:417` each
        reddened a *different single test* with the other green, which is the
        proof of independent coverage. **Phase-wide gate, all five first-hand:**
        pytest **4743/96/0** (4724 + 5 + 14, reconciles exactly) · collection
        4837, 0 errors (the 4837-vs-4839 delta traced to 2 PRE-EXISTING
        module-level skips, not assumed) · mypy 89 files clean · tsc 0 ·
        full vitest+coverage **8878 passed / 0 failed**, all four thresholds
        clear · lint 0 errors · **0** new `# type: ignore` phase-wide ·
        `grep -rn MUTANT` → 0 · **zero production files modified**.

        **PYAPIFIX-05 batch 1 CLOSED** (plan 06 — survivors #1/#2/#6/#7/#12 + the
        M-15 fold-in). 6 mutation cycles / 8 runs, **every RED (and the two
        required GREENs) OBSERVED FIRST-HAND**, zero "asserted only" rows:
        #1 `except ccxt.BaseError`→`NetworkError` ⇒ 3 failed; #2 →
        `ExchangeNotAvailable` ⇒ 6 failed (both `assert 500 == 424`); #6
        `"supabase": 15`→`900` ⇒ 4 failed `assert '900' == '15'`; #7
        `_KEK_ALERT_WINDOW_S 300.0`→`1e18` ⇒ 1 failed `assert 1 == 2`; #12 junk
        copy ⇒ 1 failed. M-15's self-referential `len(_SHAPES) == 6` **DELETED**
        (with its false docstring) and replaced by an **AST-fingerprint SET**
        read from the router's own source; all three probes observed — a 7th 200
        shape ⇒ 1 failed naming `dict:code,mutant,ok`, a pure line shift ⇒ green,
        an added `status_code=418` return ⇒ green. Wave-3 gate: pytest **4724
        passed / 96 skipped / 0 failed** (4716 + 7 + 1, reconciles exactly),
        mypy --strict 89 files clean, 0 new `# type: ignore`,
        `grep -rn MUTANT` → 0, **zero production files modified**.
        ~~**Still open for plan 07:** slowapi survivors #3/#4/#5 and
        claim-parser #8–#11.~~ → **ALL CLOSED by plan 07 (above).**
        **PYAPIFIX-01 CLOSED** (plan 05 — the TS half, and the wave-2 vitest gate):
        the mixed-envelope rejection is DELETED and the union widened in
        `src/lib/process-key-onboard-contract.ts`, with THREE compensating invariants
        (non-empty `code`; `idempotent` present ⇒ `true` AND `code ===
        "WIZARD_DUPLICATE"`; `verification_id` string retained on the `queued:true` arm).
        **The cross-process oracle is BIDIRECTIONAL, observed first-hand:** neutering
        `_wizard_duplicate_reply` (`"code"`→`"codes"`) reddens the pytest (2 failed,
        key-set assertion); neutering the predicate (`return true` first) reddens the
        vitest (4 failed — every negative wrongly accepted). Both restored from scratch
        copies OUTSIDE the repo, tree clean, `grep -rn MUTANT` → 0.
        `route.test.ts:1474` REWRITTEN not deleted (59 → **61** tests, 0 deleted) with
        TWO retained negatives. Wave-2 vitest gate PAID: **8878 passed / 0 failed**,
        coverage 84.36/78.37/81.43/86.49 vs thresholds 80/72/74/82, tsc 0, lint 0 errors.
        Python re-verified after the neuter cycles: **4716/96/0**, mypy 89 files clean.
        `140.1-TS-OBLIGATIONS.md` reconciled (TS-01/TS-03 **DONE**, TS-02 sharpened,
        TS-23 **UNBLOCKED**, TS-32/TS-33 added; count 31 → 33; TS-04..22/24..31
        untouched). **M-11 DECIDED and RECORDED, not implemented:** onboard's dedupe is
        **UNWIRED, not broken** — the remedy is ONE payload field (`wizard_session_id`
        at `finalize-wizard/route.ts:840-851`), now ledger row TS-33; its "strictly
        after PYAPIFIX-01" ordering is now **SATISFIED**.
        2 WARNING gaps, no BLOCKER. See `140.1-VERIFICATION.md`. Not transitioned (`--no-transition`).
Last activity: 2026-08-02 -- Phase 142 execution started

Progress: [░░░░░░░░░░] 0% (v1.17 — 0/9 phases)

### Phase 140.1 close-out — open items (do NOT lose these)

- **Gap 1 (SC-6 / PYAPI-08, warning):** two in-handler throttle sites raise a plain
  `HTTPException(429)` and cannot reach the app-global `RateLimitExceeded` handler —
  `analytics-service/routers/simulator.py:249`, `analytics-service/routers/match.py:1742`.
  Both pre-date the phase. Two 429 shapes coexist (FINDING-12).

- **Gap 2 (PYAPI-03, warning):** `analytics-service/routers/simulator.py:92` is a TENTH
  IP-keyed route (`f"simulator:ip:{get_remote_address(request)}"`). PYAPI-03 is **9/9,
  not 10/10**. Quarantined behind an `IP_KEYED_QUARANTINE` equality assertion.

- **⚠️ Ownership gap (most likely to be silently dropped):** obligation **TS-04** —
  `src/lib/analytics-client.ts` must mint `X-Tenant-Claim`. Until it does, the nine
  rekeyed routes run `platform:<path>`, NOT per-tenant. Python side is complete; the
  flip needs ZERO Python changes. TS-04 appears in `140.1-TS-OBLIGATIONS.md` but in
  **none** of Phase 140.2's ROADMAP success criteria — nobody is contractually obliged
  to land it. Add it to 140.2's criteria at plan time.

- **Known regression:** `_scope_rejected` (`analytics-service/routers/process_key.py:1295-1299`)
  is a three-arm OR behind one return, so ordinary `not val.valid` failures answer 403
  where 422 would be sharper.

- **Carried:** `analytics-service/main.py` sits OUTSIDE the mypy gate paths (5 standalone
  errors, all pre-dating baseline `43449cc6`); exclusion determined NOT deliberate.

- **4 human-verification items** in `140.1-VERIFICATION.md` (two new supabase/tests SQL
  gates unexecutable without TEST-DB credentials, PROD migration watch, two product
  judgments on the 200→403 move).

- **Cross-phase inputs:** `140.1-TS-OBLIGATIONS.md` — 31 obligations
  (140.2→16, 140.3→4, 146→3, 145→2, ops→4, needs-own-plan→2). 140.2/140.3/145/146
  planners MUST read it instead of re-deriving from `140-FINDINGS-CONSOLIDATED.md`.

## Current Focus

**Next: `/gsd:plan-phase 147`.** v1.17 phase order 147 → 148 → 149 → 150 → 151 → 152 → 153 → 154 → 155.
Load-bearing sequencing (real dependencies, do not reorder):

- **SCEN-01 (147) FIRST** — silent money-path bug AND it blocks meaningful verification of every
  other scenario surface; the READER is wrong (reuse `resolveDailyReturnSeries`, difference the
  wealth index, never backfill against migration 087).
- **OWN-02 (148) before NAV-01 (149) / OWN-04 (same phase) / SCEN-03 (152)** — they link to a
  factsheet that today 404s. 148/149/150 split 2026-08-04: 149 = NAV-01 as a RANKING at discovery
  parity (reuse the existing ranking component/query — the visibility predicate is the only
  difference); 150 = OWN-03 wizard question (first OWN write — money-path review isolated).
  ⛔ Adversarial acceptance: after an owner views their draft, anon must still 404 (the route is
  public and `unstable_cache`d).
- **AUM (151) after SCEN-01** — its zeros-on-screen symptom is entangled with SCEN-01's; fix the
  non-ccxt holdings-sync CLASS (sFOX latent, close before its go-live flip), not the MT5 instance.
- **MT5-06..10 (155) LAST** — live funded account, real trading day, stable surface; human- and
  calendar-gated; MT5-10 UNCAPPED by founder decision; ⛔ no MT5-07 tolerance number exists —
  founder call at discuss-phase. MT5-GOAL-01 (umbrella) closes there.
- ⏸️ **v1.16 PARKED at 68%** — resume at Phase 143 after v1.17; Phase 144 carries the live WR-02
  TEST-DELETE/PROD-reset founder decision. 142.3's scope re-homed to 155; MT5-14 to 153.
## Performance Metrics

| Phase | Plan | Duration | Tasks | Files | Completed |
|-------|------|----------|-------|-------|-----------|
| 140.1 | 01 | ~38 min | 2 | 2 created | 2026-07-26 |
| 140.1 | 02 | ~71 min | 3 | 1 created, 2 modified | 2026-07-26 |
| 140.1 | 03 | ~55 min | 3 | 3 created, 3 modified | 2026-07-26 |
| 140.1 | 04 | ~50 min | 3 | 9 modified | 2026-07-26 |
| 140.1 | 05 | ~48 min | 2 | 1 created, 2 modified | 2026-07-26 |
| 140.1 | 06 | ~22 min | 3 | 1 created, 6 modified | 2026-07-26 |
| 140.1 | 07 | ~55 min | 2 | 2 created, 14 modified | 2026-07-26 |
| 140.1 | 08 | ~70 min | 3 | 3 created, 3 modified | 2026-07-26 |
| 140.1.1 | 01 | ~35 min | 3 | 4 created, 2 modified | 2026-07-26 |
| Phase 140.1.1 P02 | 40m | 3 tasks | 4 files |
| 140.1.1 | 03 | ~35 min | 2 | 3 created, 1 modified | 2026-07-26 |
| 140.1.1 | 04 | ~40 min | 3 | 2 created, 6 modified | 2026-07-26 |
| Phase 140.1.1 P05 | ~25 min | 3 tasks | 3 files |
| 140.1.1 | 06 | ~45 min | 3 | 5 modified | 2026-07-26 |
| 140.1.1 | 07 | ~70 min | 3 | 1 created, 2 modified | 2026-07-26 |
| Phase 140.2 P01 | 44 min | 4 tasks | 5 files |
| Phase 140.2 P02 | 35 min | 3 tasks | 9 files |
| Phase 140.2 P05 | 47 min | 3 tasks | 14 files |
| Phase 140.2 P09 | 33 min | 3 tasks | 17 files |
| Phase 140.2 P10 | 23 min | 2 tasks | 6 files |
| Phase 140.2 P11 | 25 min | 3 tasks | 7 files |
| Phase 140.3 PG4 | 28 min | 2 tasks | 4 files |
| Phase 140.3 PG5 | 18 min | 2 tasks | 4 files |
| Phase 140.3 PG6 | ~15 min | 2 tasks | 4 files |
| Phase 140.3 PG7 | ~12 min | 2 tasks | 1 file |
| Phase 140.3 PG8 | ~15 min | 2 tasks | 5 files |
| Phase 140.3 PG9 | ~18 min | 2 tasks | 2 files |

## Accumulated Context

### Roadmap Evolution

- Phase 140.1 inserted after Phase 140: PYAPI — Python service contract, status attributability & limiter identity (URGENT)
- Phase 140.2 inserted after Phase 140: SEAMCORE — Seam core & breaker correctness + harness integrity (URGENT)
- Phase 140.3 inserted after Phase 140: SEAMUX — Client & wizard seam error surface (URGENT)
- Phase 141.1 inserted after Phase 141: 8-agent review campaign: Retry-After built by 140.5 never consumed; breaker threshold uncalibrated for per-attempt counting; SEAM-05 evidence wrong in 4 places. Zero user-facing/data-integrity defects. (URGENT)
- Phase 142.1 inserted after Phase 142: Close 142 code-review findings: chain-start stamp preservation, deploy sequencing, terminal-writer parity, census boundary, SQL gate lock scope (URGENT)
- Phase 142.2 inserted after Phase 142: Get MetaTrader 5 running end to end on the unified backbone (URGENT)
- v1.17 roadmap created 2026-08-04 (Phases 147–153); v1.16 PARKED at 68% (13/19 phases, 119/127 plans; resume at Phase 143). Phase 142.3's scope (MT5-06..10) re-homed to Phase 153, MT5-14 to Phase 151. Ordering locked: SCEN-01 first, OWN-02 before NAV-01/OWN-04/SCEN-03, AUM after SCEN-01, MT5 numeric verification last
- v1.17 roadmap REVISED 2026-08-04 (Phases 147–155): the approved Phase 148 (OWN-02/03/04 + NAV-01) split into 148 OWN-02/04 (owner factsheet, adversarial cache acceptance), 149 NAV-01 (my-strategies ranking at DISCOVERY PARITY — founder sharpened the ask from 'an overview' to ranking parity over every uploaded key incl. private/draft), 150 OWN-03 (own-capital-vs-verifying wizard question, money-path review isolated); later phases renumbered +2 (AUM→151, SCEN→152, WIZFORM+MT5-14→153, WIZCONT/STALE→154, MT5-VERIFY→155). All ordering constraints unchanged and now structural (149 cannot start before 148)

### Decisions (requirements-time, from research Open Decisions 1–8)

- Janitor targets BOTH tables as two DISTINCT mechanisms: `strategy_analytics.computation_status='computing'` (new reaper, JOB-02/Phase 142) AND `compute_jobs.status='running'` (extend WORKER-04, JOB-05/Phase 144).
- Fence-flake "two birds" claim: observation-only, never an acceptance criterion.
- ONE shared breaker key `breaker:railway` (both clients hit the same physical deployment); breaker fails OPEN on Redis error (deliberate divergence from the rate limiter's fail-closed).
- Rate-limit wiring = `withRateLimit` HOF composing with `withAuth`/`withRole`; NOT global middleware.
- csv-finalize fold-vs-compensate deferred to after the Phase 145 reproduction pass.
- `cron/warm-analytics` OUT of RATE scope; Python limiters beyond `match.py` OUT of scope.
- Roadmap kept research's 7-phase shape; 143/144 NOT merged (different tables/mechanisms, 143 has a design-pass flag, 144 is the founder's WR-02 call). JOB-07 mapped to Phase 142 only; constrains 143–145 (pg_cron by construction).

### Decisions (execution-time, Phase 140.2)

- **140.2-08 (SEAMCORE-06 — `MIN_REDACTABLE_SECRET_LENGTH` = 12 is DERIVED, not picked):**
  the shortest members of the preserve list (`ENOTFOUND`, `ETIMEDOUT`, `EAI_AGAIN`) are
  **9 characters**, so any secret candidate at or near that length cannot be told apart
  from prose and substring-replacing it destroys the syscall token — TRAP-1's
  over-redaction half. A candidate below the floor is **REFUSED** and the refusal is
  SIGNALLED in the line (naming the env var, never its value), because a line that may
  be under-redacted must say so. Ledger row **M33** lowers it to 3 and the message body
  becomes `code: 'E<redacted>REFUSED'`.

- **140.2-08 (the redaction leaf is the ONLY scrubber):** `finalize-wizard`'s route-local
  pair is DELETED, not kept alongside. It knew exactly one env secret, was unreachable
  from the core and both clients (where undici actually produces the leak), and had no
  minimum-length refusal. Its replacement comment deliberately **does not name the
  deleted identifiers** — the acceptance grep would otherwise match its own prose.

- **140.2-08 (scrubbing lives at the chokepoint, not at N call sites):** folded into
  `captureToSentry`, closing all 10 seam captures **and every other capture repo-wide**
  by one edit. Ten sites each remembering to scrub is TRAP-5's "3 of 5" shape, and
  Sentry is a THIRD PARTY — "the caller will remember" is not a control. ⚠️ The Sentry
  clause is **ADDITIVE**: a `captureException`/`captureMessage` grep across the core,
  both clients and all three seam route files returns **ZERO**.

- **140.2-08 (the breaker's transition event):** exactly four fields
  (`breakerKey`, `failures`, `cooldownS`, `correlationId`), asserted as an EXACT key set
  so a future field carrying a path or a header reddens rather than ships. `breakerKey`
  comes from the **verdict** (meaningful only because 140.2-06 made keys per-dependency);
  `correlationId` is `<key>@<armedAtMs>`, derived from the LOCK so the OPEN and CLOSE of
  one lock share it — a request-scoped id could not, because the request that trips a
  circuit is never the request that observes it heal. **CLOSE** fires on the first
  observed tombstone read, deduped per lock per instance; **no half-open state machine
  and no probe scheduler were built** (TTL expiry IS the transition — locked decision 3).

- **140.2-08 (a preserve assertion must read the LINE, not the scrubber's report about
  it):** found while observing M33. The collision notice NAMES the tokens it destroyed,
  so `toContain("ECONNREFUSED")` passed on a body mangled to `E<redacted>REFUSED` — a
  self-referential oracle wearing a different hat. Preserve assertions now strip the
  notices and assert the token IN SITU.

- **140.2-08 (finding, closed):** three error-derived console sites in `finalize-wizard`
  that **no predecessor SUMMARY accounts for** — the body JSON parse, the strategy
  lookup and the finalize RPC. Five structurally identical Supabase `.message` reads in
  the same file were already scrubbed and these three were not. All closed, and the
  log-coverage guard's `*Err`/`error` naming half now stops a fourth appearing.

- **140.2-08 (correction to the plan's premise):** `keys/[id]/permissions` carries **NO**
  per-request credential — the exchange credentials are decrypted inside the Python
  service, never in that route. Recorded rather than invented.

- **140.2-09 (TS-04 / SC7 — ROADMAP SC7's "all nine" is FALSE; corrected in place):** the
  behaviour-derived answer is **6 reachable from `analytics-client`, 5 live, 1 dead, 3
  unreachable by construction**. Re-derived independently: `grep -rn
  "key_func=partial(tenant_or_platform_key" analytics-service/routers/` → 9 sites, each
  route path then grepped across `src/` and the hit READ. `fetch-trades` is reached only
  by an eslint-allowlisted debug raw fetch; `csv/validate` and `verify-strategy` have
  their TS routes re-targeted to `/process-key`, so the Python routes of those names have
  ZERO TS callers. **Those three now have no owner** — whether to flip them or retire
  them as dead is a real open question this plan did not answer.

- **140.2-09 (the cheap pass was available and REFUSED):** SC7's own test clause ("prove
  tenant A cannot consume tenant B's allowance on at least one of the nine") is
  satisfiable with **zero signature changes** via `runPortfolioOptimizer` /
  `findReplacementCandidates`, both of which already carried an actor id. Taking it would
  have satisfied the letter while leaving key-connect (which spends TWO tokens per
  attempt) and the 20/minute optimizer on a platform bucket. Delivered on all five LIVE
  routes instead.

- **140.2-09 (`tenantId` is REQUIRED on `analyticsRequest`, so ALL NINE wrappers mint):**
  optional would permit an identity-less tenth wrapper — the instance-not-class defect.
  Required forced `evalMatch`, the one wrapper with no identity of any kind, to gain one,
  giving an **eighth** route call site beyond the plan's seven. The claim is INERT on
  `match/recompute`, `match/eval` (no Python limiter — TS-21) and `simulator` (still
  IP-keyed — TS-30); minted there anyway rather than special-cased, with a comment saying
  do not optimise it away.

- **140.2-09 (`TenantIdentity` is a one-field OBJECT, not a bare string):** on
  `validateKey`/`encryptKey` a bare `userId: string` sits directly beside `passphrase` —
  a transposition COMPILES and mints the tenant claim over a user-chosen secret, putting
  a credential in an outbound header and collapsing every caller into one bucket keyed on
  it. The object makes it a type error. The five wrappers that already carried
  `actorId`/`userId` keep their string params (no adjacent secret; churn = scope creep).

- **140.2-09 (fail-loud on a missing secret CHANGES the production consequence):**
  `INTERNAL_API_TOKEN` is read at CALL time (never module scope) and its absence THROWS —
  an empty secret still produces a syntactically valid claim that fails `compare_digest`,
  so silence would have made SC7 a production no-op with a fully green suite. The mint
  therefore sits **OUTSIDE** both clients' transport `try`: inside, a refusal would be
  rewritten as "not reachable"/502, i.e. a config fault wearing a dead-Railway costume.
  `process-key-client` returns its existing 503 shape rather than throwing, because
  `postProcessKey` has never thrown at its five caller routes and none has a catch.

- **140.2-09 (the claim is deliberately NOT on the seam-redaction secret list):**
  considered and rejected. It is a derived MAC over a public user id with a 300 s life —
  a short-lived public credential, not a secret — and 140.2-08's leaf redacts by env-var
  NAME, which a per-request value cannot have. Recorded so the omission does not read as
  an oversight.

- **140.2-09 (the plan's own done-criterion was unsatisfiable):** `grep -rn "createHmac"
  src/` cannot return one site — `alert-ack-token.ts`, `demo-pdf-token.ts` and
  `pdf-render-token.ts` are three PRE-EXISTING, unrelated HMAC token systems. Satisfied
  the honest criterion instead: exactly one **tenant-claim** mint
  (`grep -rn 'createHmac("sha256", secret).update(signed)' src/` → 1).

### Decisions (execution-time, Phase 140.1.1)

- **140.1.1-06 (survivors #1/#2 — pin the CLASS by its HIERARCHY, never one member):**
  the old S-06a oracle raised exactly `ccxt.ExchangeNotAvailable`, which in ccxt 4.5.49
  is a `NetworkError` — so BOTH narrowings kept it inside the 424 arm and both mutations
  shipped green while `RateLimitExceeded`/`PermissionDenied` answered **500**. The
  parametrisation deliberately **straddles both ccxt roots** (`ExchangeError`:
  `PermissionDenied`/`AuthenticationError`/`ExchangeError`; `NetworkError`:
  `RateLimitExceeded`/`RequestTimeout`/`DDoSProtection`/`ExchangeNotAvailable`), so no
  single narrowing can satisfy it. The **non-ccxt `RuntimeError` control lives INSIDE
  the parametrisation** on purpose: a "fix" widening the arm to `except Exception` would
  satisfy all seven venue rows and fail that one — the SPLIT is what is pinned, not the

  424. The pre-existing detailed 500 test is left byte-unchanged (TRAP-9 cuts both ways).

- **140.1.1-06 (survivor #7 — a suppression window needs OBSERVED EXPIRY):** asserting
  `capture_message.call_count == 1` against a **free-running** clock is satisfied by any
  window at least as long as the test's own runtime, which is why `300.0 → 1e18` shipped
  green. Rewritten onto a **driven clock** in three phases (fire ⇒ 1; +299 s inside ⇒
  still 1; **+301 s past ⇒ 2**) with `300` as a literal typed into the test. Phase 3 is
  the half a never-expiring window silences, and it is the assertion the mutation reddens.
  The clock is injected by substituting `routers.internal`'s **`time` module attribute**
  (a `_FakeClock`), not by patching stdlib `time.monotonic` globally — `internal.py` uses
  `time.monotonic` and nothing else, so the stand-in is complete and scoped.

- **140.1.1-06 (survivor #12 — an inequality against a DIFFERENT constant is not an
  oracle):** `!= AUTH_FAILED_DETAIL` is satisfied by junk copy, by `""` and by a stack
  trace. The MT5-unconfigured sentence is now pinned by **equality against a string
  literal typed into the test** (never imported from `routers.exchange`), with the
  inequality KEPT as a second guard.

- **140.1.1-06 (M-15 — the fence compares SETS and NEVER counts):** RESEARCH C-20 proves
  the "six" was a **coincidence** — two returns collapse onto one shape (both
  `_wizard_duplicate_reply` call sites) while one expands into two (`_run_validate_only`),
  and one collapse cancelling one expansion is what made six look meaningful. A
  count-based replacement would have looked right and meant something else. The new fence
  walks `routers/process_key.py`'s AST and asserts a **set of 8 fingerprints** (5 wire
  shapes + 2 delegation edges + 1 delegated error envelope) — sorted top-level key names
  for a dict, callee name for a delegation, and a bare-`Name` return resolved to **every
  key ever assigned to that local** (dict literal + conditional subscript adds, so
  `_run_validate_only`'s optional `preview`/`daily_returns_series` are inside the
  fingerprint). Direction: **source-derived ACTUAL vs pinned-literal EXPECTED** — the
  opposite of the deleted literal-vs-literal-in-one-file form.

- **140.1.1-06 (M-15 — the 200-capable filter is load-bearing, checker W-4):** a return is
  200-capable iff it has NO `status_code=` keyword or a literal `200`, applied BEFORE
  fingerprinting. The same handler returns `JSONResponse(status_code=…)` at six error
  sites (401 `:1081`, 422 `:1108`/`:1131`, **403** `:1160`/`:1467`, **424** `:1439` — plan
  02's venue-transient arm). A naive walk would either redden on a legitimate error arm or
  **silently widen** the pinned set, reintroducing the exact defect class the fence exists
  to catch. A companion test names 403 and 424 as excluded (**membership, not equality** —
  so the W-4 probe's added 418 does not redden it) and **fails loud** on a computed
  `status_code=`. Nested `def`s are skipped (`process_key` defines `_write_audit_sync`
  inline; a closure's return never reaches the wire).

- **140.1.1-07 (survivors #3/#4 — pin a key function by its CONSEQUENCE, never its
  IDENTITY):** `assert limiter._key_func is default_platform_key` holds for **any body**.
  `return ""` then ships green AND is silent — slowapi's `__evaluate_limits` builds
  `args = [limit_key, limit_scope]` and only counts a hit `if all(args)`, so an empty key
  takes the `else` branch, logs one `"Skipping limit"` line, and the route is **unlimited
  forever**. The module documented this hazard in prose at `rate_limit.py:152-154` and
  nothing enforced it. The fix is a **driven trip**: real HTTP requests through a route
  declaring NO `key_func`, asserting a 429 actually arrives. Two structural
  requirements — (a) a **throwaway** `FastAPI()`, because every production route declares
  an explicit `key_func` and therefore **no production route exercises the singleton
  default at all**; (b) decorate **once at module scope**, because slowapi APPENDS to
  `_route_limits` on every decoration and all copies share one bucket. Also pin the probe
  itself (its limit value and that its `key_func is default_platform_key`), or the probe
  can silently become vacuous evidence.

- **140.1.1-07 (survivor #8 — an oversize guard needs a WORK spy, and the fixture must be
  VALID-but-oversized):** the obvious fixture — 513 chars of junk — **would not have
  reddened**, because without the length bound `rsplit(".", 2)` raises `ValueError`, the
  never-raise `except` swallows it, and `is None` holds either way. The survivor would have
  been recorded closed on a test that could never fail for it. Use a **correctly minted,
  fully valid, merely oversized** claim (437-char payload + `.` + 10-digit exp + `.` +
  64-hex MAC = exactly 513): with the guard it is refused before the MAC; without it, it
  is **accepted**. And because the guard's purpose is refusing *work*, the oracle needs an
  `hmac.new` spy asserting **zero** calls — substituting the module's `hmac` MODULE
  attribute (plan 06's `_FakeClock` idiom), with a negative control asserting an ordinary
  claim reaches the MAC exactly once.

- **140.1.1-07 (survivor #5 — a bound satisfied by the degenerate value is not an
  oracle):** `assert 0 < seconds <= 3600` passes for `1`. A wrong-but-small `Retry-After`
  is the **retry-storm shape** — the header that exists to prevent a stampede causes one.
  Replace with a **tight band** (`> window * 0.9`) on a freshly-reset bucket, its
  arithmetic derived from the route's **declared limit string typed into the test**, never
  from the function under test. Per §9-M8 the mutation targets the computation
  (`main.py:458-487`) while the oracle reads the **header** (`:526`) — different lines on
  purpose, so the oracle observes the wire.

- **140.1.1-07 (survivor #11 — when one survivor has TWO sites, the RED ASYMMETRY is the
  proof):** the same `==`→`startswith` mutation at `rate_limit.py:333`
  (`tenant_rate_limit_key`, `/process-key`) and `:417` (`tenant_or_platform_key`, the nine
  ex-IP-keyed routes) reddened a **different single test each time**, with the other green.
  A single "covers the anon arm" test would have reddened for both and proved nothing about
  the second site. The review named only `:333`; testing it alone is 1 of 2. Run
  `grep -n` inside each cycle to prove exactly one line was mutated.

- **140.1.1-07 (reconcile collection vs run counts rather than assuming):** `--collect-only`
  reported 4837 while the run accounted for 4839. Traced, not waved through: two
  **module-level** collection skips (`pytest.skip(..., allow_module_level=True)` at
  `test_equity_reconstruction_integration.py:38` and `test_equity_reconstruction_live.py:34`)
  are counted as skips by the runner but are not test ITEMS, so `--collect-only` never lists
  them. 4837 items = 4743 passed + 94 item-skips; +2 module-skips = 96. Pre-existing, proved
  by re-running `--collect-only --ignore=<the new file>` → 4823 = 4837 − the plan's own 14.

- **140.1.1-05 (PYAPIFIX-01 direction — the TYPESCRIPT consumer changed, not Python):**
  `queued` (a job fact) and `code`/`idempotent` (a submission fact) are **orthogonal**, and
  `_resume_duplicate_job` exists precisely to produce the state where both are true — the guard
  encoded a mutual exclusion the domain does not have. The rejection is **deleted** and the union
  widened; the SAME edit bought the teeth back with three invariants (non-empty `code` on either
  arm; `idempotent` present ⇒ `true` **and** `code === "WIZARD_DUPLICATE"`; `verification_id`
  string retained on the `queued:true` arm), each pinned by a negative fixture case in BOTH
  languages. ⚠️ The pairing is enforced **one-directionally by design**: `code ===
  "WIZARD_DUPLICATE"` **without** `idempotent` was legal before 140.1 and nothing retired it, so
  enforcing the converse would reject a shape the contract still permits. The `ok` + `job_state`
  discriminant TS-01 suggested was **NOT** adopted — both TS forward arms still drop `job_state`;
  that is 140.2's call and `route.test.ts` now pins the current forwarding.

- **140.1.1-05 (M-11 — record and defer; now ledger row TS-33, NOT implemented):** onboard's
  double-submit protection is **UNWIRED, not broken** — protection is job-level only, and it is
  unreachable because no live caller sends `wizard_session_id`. **CHOSEN:** wire the mechanism that
  already exists — ONE payload field at `finalize-wizard/route.ts:840-851`. **REJECTED:** porting
  `Idempotency-Key` from `allocator/scenario/commit/route.ts` — needs a migration, and M-19 records
  that migrations auto-apply to PROD with no branch protection; building a second mechanism before
  wiring the first is the point-fix-a-class antipattern this programme exists to stop. **REJECTED:**
  hardening the Python dedupe as dead code — produces a green diff while the real gap stays open.
  **Ordering (binding): strictly AFTER PYAPIFIX-01** — adding the field first converts H-5 from
  latent into a live 502. TS-01 is now DONE, so the constraint is **satisfied**.

- **140.1.1-04 (OQ-2, the code string):** `ADAPTER_INIT_FAILED` — **not**
  `EXCHANGE_INIT_FAILED` (semantically names the venue, contradicting a
  SERVICE-PERMANENT verdict in the one field 140.2 discriminates on) and **not**
  `INTERNAL` (the S-06b analog's code — PATTERNS said copy the shape, not the string;
  collapsing a distinct greppable class into the generic bucket destroys the
  discriminator's value). Registered in `STATUS_CONTRACT.md` §7 for 140.2.
  `EXCHANGE_INIT_FAILED` is **retired** at zero raise sites repo-wide.

- **140.1.1-04 (PYAPIFIX-03 is a 3-SITE CLASS):** closed at `internal.py:421` (B1, the
  review's only named site), `exchange.py:447` (B2), `portfolio.py:2269` (B3 — named by
  NOBODY; found only by the pattern-mapper because British "initiali**s**e" defeats the
  grep). One code, one copy, three sites. B4 (`portfolio.py:2513`, the SAME function's
  second `create_exchange`, already 500) is the in-repo proof the class was real and is
  **byte-unchanged**. **Durable lesson recorded in `STATUS_CONTRACT.md`: the enumeration
  predicate is "an `except` arm around a callee that performs no network I/O" — a
  BEHAVIOURAL property, never a copy string.**

- **140.1.1-04 (`ValueError` → 400 preserved at all three sites):** an exchange name
  absent from `EXCHANGE_CLASSES` IS caller input. All three arms byte-unchanged and now
  pinned by tests, so the remap cannot later widen into "every escape is a 500". No dead
  `ValueError` arms were added — all three already had one.

- **140.1.1-04 (M-14, and why the ZERO case is the load-bearing test):** the
  `service_key.mismatch` line MUST stay inside `if provided:`. Proved falsifiable by a
  neuter probe rather than assumed: dedenting it one level turns **only** the
  absent-header 0-event test RED (1 failed / 3 passed) — all three positive tests stay
  green. A suite without that assertion would have accepted a log line firing on every
  unauthenticated prober, burying the signal exactly as C-11 was buried.

- **140.1.1-03 (PYAPIFIX-01 mechanism):** the guard predicate was **extracted to a pure
  leaf** (`src/lib/process-key-onboard-contract.ts`, **zero import statements**, both
  symbols exported) rather than exported in place. Exporting in place is legal on Next
  16.2.11 but unusable: `route.ts`'s import graph needs **10 `vi.mock` blocks**
  (`next/server`, `server-only`, supabase, ratelimit, email, …), and a contract test
  wrapped in ten mocks is the "second pair of mocks" PYAPIFIX-01 forbids. `route.ts`
  imports the predicate back — **exactly one implementation exists repo-wide**. Logic
  byte-identical (diff vs origin = two hunks, both the word `export`); the
  mixed-envelope rejection is intact, plan 05 owns inverting it.

- **140.1.1-03 (route.ts import shape, Rule 3):** `route.ts` imports **only the
  predicate**, not the type — the type applies via the `body is` narrowing, so naming
  it produced a NEW eslint `no-unused-vars` warning. Comment at `route.ts:19-21`
  records why.

- **140.1.1-03 (fixture is COMMITTED, never generated):**
  `analytics-service/tests/fixtures/process_key_onboard_contract.json` is tracked in
  git because `ci.yml`'s `python` (`:933`) and `frontend-test` (`:206`) jobs are
  **siblings with no `needs:` edge** — a generated golden file is invisible to the
  other job. 5 cases: 2 positive (the real emitted shapes) + 3 negative; N3
  (`queued:true` + `code:"OTHER"`) is the anti-degradation case that stops plan 05's
  widening collapsing to `() => true`.

- **140.1.1-03 (contract-test harness, OQ-1):** the pytest drives the **FULL
  `main.app`** stack (so `verify_service_key`/`_gate_process_key` run), not the bare
  router — a contract test that bypasses the auth middleware is not proving the wire
  shape. The **only** patched symbol is `routers.process_key.get_supabase`; the reply
  builder and handler are never patched, and nothing is imported from
  `routers.process_key`. Both duplicate arms are selected **by DB state alone**
  (`draft` → `queued:true`/`enqueued`; `published` → `queued:false`/`not_applicable`)
  from a byte-identical request body.

- **140.1.1-03 (equality split by intent):** key set exact + the five discriminant
  values (`ok`, `code`, `idempotent`, `queued`, `job_state`) exact +
  `verification_id`/`correlation_id`/`status`/`trust_tier` by **type only** — they are
  per-request identifiers, and pinning their values would pin the fake rather than the
  contract.

- **140.1.1-02 (PYAPIFIX-02 fix shape):** an **ALLOW-LIST of PERMANENT codes defaulting
  to transient** — `PERMANENT_VALIDATION_ERROR_CODES` in `services/exchange.py`, next to
  the assignment sites it classifies. An unknown future venue code fails SAFE (retryable);
  a caller-fault code must be NAMED to become permanent. `MISSING_SCOPE` is allow-listed
  (reachable via the deribit `scope_detail` arm) or a permanently-missing read scope would
  be retried forever.

- **140.1.1-02 (`_envelope_error` shape):** the `recoverable` derivation reads BOTH
  universes — the shared permanent allow-list AND the route's own
  `_ROUTE_TERMINAL_ERROR_CODES` — because they fail safe in OPPOSITE directions (unknown
  venue code → recoverable; unknown route code → terminal). A new
  `recoverable: bool | None = None` parameter lets an arm STATE a verdict the callee cannot
  derive; the 424 arm does, which is the only way an adapter-set `VALIDATION_UNEXPECTED`
  can carry `true` while our own fallback carries `false`.

- **140.1.1-02 (W-3, long_fetch):** `services/ingestion/long_fetch.py` is left
  **byte-unchanged**. Its local `permanent_codes` omits `MISSING_SCOPE`, so re-pointing it
  at the shared constant would silently flip the worker retry path transient→permanent — a
  production behaviour change named in no requirement. Divergence recorded in the
  constant's docstring and in `140.1.1-02-SUMMARY.md`, deferred not overlooked.

- **140.1.1-02 (M-4 carve-out):** `routers/exchange.py:145`, `:152`, `:505` are ENUMERATED
  and DEFERRED as **BLOCKED-BY: TS-05** (migrating them to `service_error(424)` turns
  `body.detail` scalar→object → `"[object Object]"` dead-end render until TS-05 lands).
  Both 400 and 424 are 4xx ⇒ breaker-inert ⇒ no attributability change today.
  `.planning/REQUIREMENTS.md:89` amended to say so; plan 140.1.1-05 owns the
  TS-OBLIGATIONS pairing row.

- **140.1.1-01 (PYAPIFIX-04 placement):** the scalar-`detail` guard lands in
  `service_error_body`, NOT `_validate`. Both entry points (`service_error`,
  `service_error_response`) call BOTH functions, so either location gives complete
  coverage — but `_validate` has no `detail` parameter, so putting it there means
  widening a private signature and threading a sixth argument through two call sites.
  Consequence: PYAPIFIX-06 lands in `_validate` and PYAPIFIX-04 in `service_error_body`,
  so they cannot collide in one hunk despite CONTEXT calling them "the same function".

- **140.1.1-01 (OQ-4b, 429 retryability):** a `429` carries `retryable: true` rather than
  exempting 429 from the `retry_after` ⇒ `retryable` rule. The alternative emits
  `retryable:false` in the body beside a `Retry-After` header on the wire — the
  self-contradicting response R-1 forbids. The 424 arm is the in-file precedent for a
  retryable 4xx. `STATUS_CONTRACT.md` §1 gained a dedicated **CALLER, THROTTLED** row in
  the same plan (C-21: the arm ships already-falsified otherwise).

- **140.1.1-01 (C4(a) form, checker W-2):** the 503 `Retry-After` source guard uses
  `RETRY_AFTER_SECONDS.get(dependency)`, never a bare index. `kek` and `egress-proxy`
  pass the arm's `SERVICE_DEPENDENCIES` membership check but are deliberately absent from
  the table, so a bare index would raise `KeyError` — contradicting the module's
  documented "the guards raise `ValueError`" posture. Pinned by a test asserting
  `pytest.raises(ValueError)` for exactly those two.

- **140.1.1-01 (C3 form):** the 500-`dependency` guard is **MEMBERSHIP**
  (`dependency is not None and dependency not in SERVICE_DEPENDENCIES`), never
  PROHIBITION. Six live sites legitimately name one of ours and seven pass `None`; a
  prohibition reading reddens all thirteen. The four permitted-dependency cases plus the
  `None` case in `test_error_contract_500_dependency.py` exist only to fail if someone
  later "tightens" it.

- **140.1.1-01 (C4 scope, deviation Rule 2):** `STATUS_CONTRACT.md` §3 carried the same
  unqualified "never inlines a number" claim as the code docstring, which the new
  Retry-After-required 429 row would have contradicted. Narrowed alongside the two
  mandated edits, naming the same two helper-bypassing sites (`internal.py:227`,
  `main.py:526`). C4's unguardable half is **documented, not declared closed**.

### Decisions (execution-time, Phase 140.1)

- **140.1-01 (PYAPI-01 SQL half):** uniqueness on `strategy_verifications` is tenant-scoped via
  `UNIQUE (strategy_id, wizard_session_id)` — Option A. The table has NO `user_id` column
  (16 columns verified against the live catalog), so `strategy_id` is the tenant key, matching
  the owner RLS policy's own derivation. Option B (add `user_id` + partial unique) rejected:
  backfill + a write-path change at every SV insert site.

- **140.1-01:** single transactional migration, NOT `CONCURRENTLY`. Measured PROD row count = 20
  (TEST = 0), ~5,000× under the ~100k rule from `20260510173005:75-82`. New index name
  `strategy_verifications_strategy_wizard_session_uniq`; the old name is never reused (would make
  `CREATE UNIQUE INDEX IF NOT EXISTS` a silent no-op). Migration
  `20260726000225_strategy_verifications_tenant_scope_uniq.sql`, applied to TEST with the
  filename timestamp stamped in `schema_migrations`.

- **⚠️ PYAPI-01 is NOT closed by 140.1-01.** The SQL gate A1–A5 all pass with the Python query
  half unfixed. BOTH unscoped service-role read sites — `routers/process_key.py:722-728` and
  `:895-901` — must be scoped by Plan 140.1-02 or the cross-tenant class stays open.
  → **RESOLVED by 140.1-02 (`ca9a9235`).** Both sites now scoped (`:930`, `:1009`); PYAPI-01
  ticked in REQUIREMENTS.md. The PROD deploy-skew window noted below is closed by that commit.

- **140.1-02 (PYAPI-01 Python half):** the pre-check had to **MOVE** below the `strategy_id is
  None` branch before it could be scoped at all — at its old position `strategy_id` did not
  exist yet. That one move also un-shadowed the csv-finalize branch (C-20). A scoped read is
  necessary-not-sufficient because `strategy_id` is caller-supplied, so a `strategies` id+user_id
  ownership gate runs ahead of the first read. **Missing `context.user_id` on a non-teaser flow
  fails CLOSED (403 `STRATEGY_NOT_OWNED`)** — a row cannot be owned by nobody, and treating
  absence as a skip would make the gate opt-out by omission. Blast radius verified zero: every
  non-teaser caller that sends a `strategy_id` already forwards `user_id` (`keys/sync:417`,
  `finalize-wizard:1310`, `validate-and-encrypt:210`, `csv-finalize:1183`); there is no
  `internal_report` caller in `src/`.

- **140.1-02 (PYAPI-09):** `queued` redefined from "this call reached the enqueue" (unobservable,
  and false by construction on the duplicate path) to **"a non-terminal `compute_job` exists for
  this verification at the moment of reply"**, and the duplicate path now MAKES it true by
  re-calling `enqueue_compute_job`. New `job_state` discriminator with three literals —
  `not_applicable` / `running` / `enqueued` — on BOTH `WIZARD_DUPLICATE` emitters, which now
  share one reply builder. Re-enqueue is gated on the SV row still being `draft`: the shared RPC
  dedupes only over non-terminal JOB statuses, so an ungated replay of a finished session would
  mint a job per refresh. That shared-RPC behaviour is pinned by
  `supabase/tests/test_enqueue_compute_job_dedupe_non_terminal.sql`.
  ⚠️ Discovered while fencing it: the dedupe has **TWO** layers — the RPC's optimistic SELECT
  *and* the partial unique index `compute_jobs_one_inflight_per_kind_strategy`.

- **140.1-03 (PYAPI-05 contract):** the four-class contract is a committed artifact at
  `analytics-service/docs/STATUS_CONTRACT.md` with the executable half in
  `services/error_contract.py`. **The R-2 envelope always lives at `body.detail`** — FastAPI's
  default handler serialises `HTTPException` to `{"detail": <detail>}`, and
  `service_error_response()` (for `BaseHTTPMiddleware` sites that must RETURN) nests it
  identically, so 140.2 has ONE envelope location regardless of mechanism. Precedent:
  `routers/simulator.py:453` already raises a dict `detail`.

- **140.1-03:** **on a `424`, `dependency` names the caller's VENUE**, not one of ours — the
  envelope's key set is fixed, so this is how Q2.2's "venue name in the body" is satisfied
  without adding a key. `error_contract._validate` REFUSES a `424` whose `dependency` is one of
  our service dependencies, so the two vocabularies cannot collide by accident.
  `RETRY_AFTER_SECONDS` holds only dependencies with a genuinely transient arm
  (`mt5-gateway: 30`, `supabase: 15`); `kek` / `egress-proxy` are absent on purpose because
  advertising a wait for a permanent fault contradicts R-1.

- **⚠️ 140.2 OBLIGATION (140.1-03) — `body.detail` is now an OBJECT on deliberate 4xx/5xx from
  `service_error`.** The three Class-5 TS sites doing `err.detail ?? "..."`
  (`analytics-client.ts:179`, `keys/[id]/permissions/route.ts:147`,
  `ScenarioCommitDrawer.tsx:622`) will render `"[object Object]"` until 140.2 reads
  `body.detail.detail` / `body.detail.code`. This does NOT apply to the 422/429 handlers
  (140.1-08), which keep a scalar top-level `detail`. Nine numbered obligations O-1…O-9 are
  written into `STATUS_CONTRACT.md` §6 so they survive without this file.

- **⚠️ 140.2 OBLIGATION — the `queued`/`WIZARD_DUPLICATE` contract changed.** Two TS readers are
  now stale and must be fixed in 140.2 (NOT edited in 140.1): `keys/sync/route.ts:438` branches
  on `queued === false && code === 'WIZARD_DUPLICATE'`, a combination resync can no longer
  produce at all; `finalize-wizard/route.ts:1419-1420` documents `{queued:true,
  code:WIZARD_DUPLICATE}` as *illegal* when it is now the normal resumed-wedge reply. Safe
  pre-merge — nothing reaches `main` until 140.2/140.3 land on the same branch.

- **140.1-02 flagged, NOT done:** `/process-key` still passes no `p_idempotency_key` to
  `enqueue_compute_job` (fresh path or duplicate path), so dedupe is purely
  `(strategy_id, kind, non-terminal status)`-based. Cheap tightening, deliberately out of scope.
  Also: existing PROD wedges (`status='draft'` with no `compute_jobs` row) are repaired by the
  user's next retry but are NOT swept — RESEARCH Q4's read-only blast-radius count was not taken.

- **140.1-04 — the PYAPI-05 EMIT SIDE IS COMPLETE.** All **21 explicit** S-table sites are now
  classified (plan 03: S-01..S-12; plan 04: S-13..S-20 **+ S-23**), plus S-21/S-22 implicit and
  S-24 (`/health`) deliberately unchanged ⇒ **21 + 2 + 1 = 24**. S-23 is counted explicitly
  because it is a `JSONResponse` literal and does NOT appear in a `grep "status_code=5"`
  `HTTPException` sweep — the off-by-one the plan-checker found in the count gate itself.

- **140.1-04:** three sites changed CLASS, not just attribution — **S-16 503→400**
  (`EVAL_WINDOW_TOO_LARGE`: an oversized caller `lookback_days` window is a caller fault and must
  never be a breaker input), **S-19 500→503** (a Supabase insert returning no row is a blip, not a
  permanent fault), **S-23 503→500 `retryable:false`** (an unset `SERVICE_KEY` is operator-only, so
  a 503 there flaps the breaker forever). S-23 uses `service_error_response`, so it is still
  RETURNED, never raised (QUANTALYZE-4), and 140.2 has ONE envelope location.

- **140.1-04:** `routers/match.py` no longer interpolates exceptions into `detail` (the S-15/S-17
  `{err}` leaks). The message + traceback move to a structured `logger.error` under a minted
  `uuid4` correlation_id that the response envelope ALSO carries, so the operator diagnostic is
  moved, not deleted. Two canary oracles (`CANARY_ERR`) bite if the interpolation returns.

- **140.1-04 hands Phase 146 a live gap:** `/api/match/recompute` and `/api/match/eval` have **NO
  rate limiter at all** (the only throttle in the file is the per-allocator 30 s `force=True`
  floor, a duplicate-work guard). `/eval` is an unbounded aggregation, and the accidental
  back-pressure its old 503 gave via the breaker is now gone by design.

- **140.1-05 (PYAPI-10a) — the 200 surface has ONE discriminator.** All **six** shapes carry
  `ok: bool` (shapes 1, 2 and 5 gained it; shape 1's two emitters share one builder so they cannot
  drift), and `code` is a non-empty string whenever `ok` is false. Shape 5 — the synchronous
  success, the shape consumers actually sniff (`verify-strategy/route.ts:197-198`,
  `csv-finalize/route.ts:1213-1214` key on `verification_id` being *present*) — gets an explicit
  **`code: null`** rather than a synthetic success code: it names no sub-condition, and the explicit
  null means a consumer reading `body.code` never gets `undefined` on exactly that shape. Diff is
  additive: **zero** response keys removed. `job_state` (140.1-02) rides these shapes, not a 7th key.

- **140.1-05 (PYAPI-10b) — no security verdict under a success status.** The write-capable-key
  rejection answers **403**, using the route's **OWN** top-level DESIGN-05 envelope
  (`ok`/`code`/`human_message`/`debug_context`/`correlation_id`/`recoverable`), **not**
  `error_contract`'s `body.detail` envelope. `/process-key` is **S-22** — zero explicit 5xx sites —
  so it is not on the PYAPI-05 emit surface, and all four of its sibling 4xx refusals already use
  `_envelope_error`; a second body shape for one of five refusals would be the parallel envelope the
  plan forbids. The status still obeys PYAPI-05: 403 is CALLER-class, breaker-inert, non-retryable.
  Bare `_envelope_error` returns that are security verdicts: **0**.

- **⚠️ 140.1-05 FINDING — the rejection gate is UNIFIED, so more than the scope arms moved.**
  `_scope_rejected` (`process_key.py:1245-1249`) is a three-arm OR — `not val.valid` **or**
  `read_only is False` **or** `error_code in {TRADE_SCOPE, WITHDRAW_SCOPE}` — behind **one** return.
  Moving that return therefore also moves ordinary validation failures (`AUTH_FAILED`, a malformed
  CSV on the synchronous path) off 200. Executed literally per plan: the plan cited the three-arm
  predicate by line, and its acceptance criterion ("zero bare `_envelope_error` returns outside the
  validate-only arm") is unsatisfiable if the gate is split. All three arms are CALLER-class.
  **Residual, recorded not fixed:** a malformed CSV answers 403 where **422** would be sharper.
  Splitting into 403 (authorization) + 422 (malformed input) is a clean follow-up for the phase's
  consolidation plan — deliberately NOT taken unilaterally.

- **140.1-05 scope fence, proven not asserted:** `_run_validate_only`'s failure arm
  (`process_key.py:686`) deliberately **stays 200 + `ok:false`**, and the csv-finalize 401/422
  envelopes deliberately stay put. Both are pinned by their own tests, so a fix applied to
  `_envelope_error` itself instead of to one return site is caught. `routers/csv.py`'s
  200-with-`ok:false` is a **different route** with its own documented design intent and consumer —
  restated OUT of scope so a later sweep does not "find the third site".

- **140.1-06 (PYAPI-04) — `/process-key` is auth-first.** Gate order was pydantic 422 → slowapi
  429 → handler 403; it is now **bearer 500/401 → 422 → 429 → 403**. The middleware carve-out in
  `main.verify_service_key` became a GATE (`main.py:_gate_process_key`) because middleware is the
  only layer that runs before pydantic. **Unset `INTERNAL_API_TOKEN` ⇒ 500
  `INTERNAL_TOKEN_UNCONFIGURED` `retryable:false`, checked BEFORE any comparison** — the naive
  `compare_digest(provided, getenv(...) or "")` matches empty-vs-empty and ADMITS the request
  (plan-check blocker B4); 500 not 401 because it is OUR misconfiguration (R-1). Missing/wrong
  bearer ⇒ **401 `UNAUTHENTICATED`**. Both use `service_error_response` (the middleware envelope,
  nested at `body.detail` — the sibling of S-23 six lines below), NOT the route's top-level
  `_envelope_error`; both RETURN, never raise (QUANTALYZE-4), pinned by an `ast.Raise` assertion
  over both functions. `_verify_internal_token` STAYS in the handler as defence-in-depth.
  Mutation M3 (restore the bare skip) ⇒ 8 tests RED, reverted.

- **140.1-06 (PYAPI-02) — per-tenant throttling on an HMAC claim.** `X-Tenant-Claim` =
  `<payload>.<exp>.<hmac-sha256>` keyed on `INTERNAL_API_TOKEN` — **no new secret, no new
  library** (the endpoint already authenticates with it, so zero new trust surface). Buckets:
  `process_key:t:<user_id>` 100/hour · `process_key:anon` 30/hour · `process_key:unverified:<hash>`
  100/hour + WARN · stacked ceiling `process_key:ceiling:<hash>` 500/hour. The key functions
  **never raise** (a raising `key_func` escapes slowapi as a bodyless 500 `text/plain`). A forged,
  wrong-secret, or expired claim falls to **unverified**, never to a tenant bucket or anon;
  `X-User-Id` alone can never select a tenant bucket (PR#241, pinned permanently). Per-bucket
  sizing uses slowapi's **callable limit provider** (`exempt_when()` takes no args and cannot see
  the request). **No new IP-derived key.**
  → **Hand-off to 140.1-07:** `services/rate_limit.py` exports scope-parameterised
  `tenant_rate_limit_key` / `platform_ceiling_key` / `verify_tenant_claim` / `credential_hash`;
  adopt with `functools.partial(..., scope="<route>")` (safe — slowapi looks for a param named
  `request`, which `partial` preserves). `_credential` already falls back to `X-Service-Key`, so
  the nine routes hash the right credential with no second change.
  → **140.2 obligation:** `src/lib/analytics-client.ts` mints NO claim; its routes land in the
  unverified bucket after 07 re-keys them. That is safe but not per-tenant. It is 140.2's file.

- **140.1-06 TRAP-9 — a FOURTH test casualty found by reading source, not listed in the plan.**
  `test_process_key_skipped_by_verify_service_key_middleware` **still passed** while asserting a
  contract that no longer exists ("the middleware MUST skip /process-key"). Renamed, restated,
  and strengthened with a `_gate_process_key` delegation assertion. Plan-check blocker B2 is
  exactly this class and found four; this is the fifth. **A silently-passing test whose prose is
  wrong is worse than no test** — future plans must enumerate invalidated tests by BEHAVIOUR,
  not by "will it go red".

- **PROD-apply watch obligation (140.1-01):** the index swap auto-applies to PROD at merge while
  Railway redeploys the Python service on its own schedule. In that window the OLD unscoped
  `.maybe_single()` pre-check can see 2 rows and error — accepted, because it requires a
  cross-tenant `uuid4` collision (~2^122). Window closes when 140.1-02 lands.

- **140.1-07 (PYAPI-03) — the IP-keyed class is CLOSED at 9/9.** 3 private `Limiter()` deleted;
  all 9 decorators carry `key_func=partial(tenant_or_platform_key, scope=<literal>)`; claimless
  callers land in the DOCUMENTED `platform:<route-path>` ceiling, which flips to per-tenant with
  zero further code changes the moment 140.2 mints `X-Tenant-Claim` on `analytics-client.ts`.
  Limit VALUES untouched (RATE-04 / Phase 146). 63 oracles in `tests/test_limiter_identity.py`.

- **140.1-07 — the singleton's DEFAULT key is no longer IP-derived.** `get_remote_address` is gone
  from `services/rate_limit.py` entirely; the default is `default_platform_key`. L-9 was acquired
  **by omission** (optimizer.py imported the shared limiter correctly and never overrode its key),
  so a comment marking the old default deprecated would not have prevented the next omission. The
  new default is deliberately the CONSERVATIVE platform bucket, never per-tenant: a route must NAME
  its scope to get isolation.

- **⚠️ 140.1-07 FINDING-10 — a TENTH IP-keyed route the plan did not predict.**
  `routers/simulator.py:92` returns `f"simulator:ip:{get_remote_address(request)}"`. The plan's
  do-not-touch list calls it "correctly user-keyed"; the PR#241 follow-up reverted that (its own
  docstring records it, and its MODULE docstring is now stale too, still claiming the key function
  reads `X-User-Id`). Reported, NOT folded in, quarantined by an EQUALITY gate
  (`IP_KEYED_QUARANTINE = frozenset({"simulator.py"})`) so the exemption cannot grow and goes red
  when it is repaired. **Needs its own plan.**

- **140.1-07 TRAP-9 — 60 casualties, none predicted by the plan; and 2 latent test-infra defects.**
  (a) Consolidating onto one `Limiter` RELOCATED the stub target: 7 files stubbed
  `slowapi.Limiter` (a *class* the routers no longer construct) → 58 reds. `tests/limiter_stub.py`
  now stubs the INSTANCE. (b) Shared storage now persists across a pytest session → 2 reds on a
  real 5/hour limit; reset per call, the `test_simulator_router` idiom.
  (c) **`sys.modules.pop("routers.X")` never re-imported anything** — importlib's
  `_handle_fromlist` skips the import while the parent package keeps the attribute, so fixtures
  silently got the STALE module. Latent for years; exposed only because a new file imported the
  router first. (d) `test_process_key.py` re-popped `services.rate_limit` at collection, minting a
  SECOND singleton and breaking the API-5 invariant now that 4 routers bind it at import — removed,
  and its cause removed (siblings import the module BEFORE swapping `slowapi.Limiter`).

- **140.1-07 vacuous-test finding.** `test_simulator_router.py::
  test_main_app_state_limiter_is_same_singleton` says it checks `app.state.limiter`; its body is a
  verbatim copy of its sibling and never touches `app.state`. Passes, covers nothing. Pre-existing;
  the real invariant is now asserted in `test_limiter_identity.py`. The misleading test still exists.

- **140.1-07 plan-vs-source contradiction, resolved explicitly.** Task 2's "zero `get_remote_address`
  under routers/" criterion and critical-warning-2's do-not-touch list cannot both hold (simulator
  legitimately uses the symbol). Honoured the MORE SPECIFIC instruction (the do-not-touch list) and
  made the gate an equality against a literal one-file allow-list rather than reinterpreting the
  count. Gate uses `tokenize` NAME tokens, not `grep -v '#'` — the grep form is both too weak (drops
  any line containing `#`) and too strong (docstrings naming the symbol count as references).

- **140.1-08 (PYAPI-06/07/08) — three app-global contracts in `main.py`.** A `RequestValidationError`
  handler builds a SCALAR `detail` from `type` + `loc` ONLY (dropping `input`, `ctx`, `msg`, `url`),
  so a caller-supplied `api_secret` can no longer reach any 422 on any route (C-13). A
  `RateLimitExceeded` handler replaces slowapi's `{"error": ...}` with `code:"RATE_LIMITED"` + a
  scalar `detail` + `Retry-After` (C-14/C-15). `REQUIRED_PLATFORM_SECRETS` +
  `assert_platform_secrets_configured()` (lifespan, never `sys.exit`) + rate-limited Sentry captures
  on all four secret arms + `/health` `config_ok`/`config_degraded_secrets` at HTTP 200 (C-11).

- **140.1-08 — the 422 and 429 need ZERO TypeScript change, and that is deliberate.** `body.detail`
  is an OBJECT for `service_error()` 4xx/5xx but a SCALAR STRING for these two handlers
  (STATUS_CONTRACT §2). `analytics-client.ts:179` / `permissions/route.ts:147` /
  `ScenarioCommitDrawer.tsx:622` all render it correctly as-is. **X-6's one-line 429 TS fix is
  unnecessary — do not schedule it in 140.2.** Do NOT "unify" the two handlers onto the object
  envelope: that reintroduces `"[object Object]"` on the two most common error statuses.

- **⚠️ 140.1-08 — `main.py`'s mypy count went 6 → 5, by instruction not by cleanup.** The eliminated
  error WAS `add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)`, whose
  `(Request, RateLimitExceeded)` signature fails Starlette's overloads. Task 2's action is to replace
  that registration; the correctly-typed `(Request, Exception) -> Response` replacement adds zero
  errors. None of the six pre-existing errors was "fixed". `type: ignore` count in `main.py` = 0.

- **140.1-08 TRAP-9 — ONE casualty, not predicted by the plan, and it was a contract INVERSION.**
  `test_process_key_auth_order.py::test_authenticated_invalid_body_still_422_naming_the_flag`
  asserted `"SFOX_ENABLED" in resp.text` for an AUTHENTICATED caller. Dropping `msg` makes that
  FALSE BY DESIGN, so the assertion was inverted (all four `_FLAG_SUBSTRINGS` now asserted ABSENT on
  both the 401 and the 422) and its anti-vacuity role re-carried by the literal
  `"body.source: value_error"`. Renamed to `..._reaches_validation_and_422s`.

- **⚠️ 140.1-08 FINDING-11 — a coverage hole, not a vacuous test.** Six test modules mount a bare
  `FastAPI()` + `include_router` (`test_match_router.py:37`, `test_process_key.py:103,516`,
  `test_simulator_router.py:115,851`, `test_status_contract_exchange_internal.py:391`,
  `test_process_key_200_discriminator.py:58`, `test_sfox_internal_probe.py:42`), so the app-global
  422/429 handlers are INVISIBLE to them and their 422s still render FastAPI's leaking default.
  No assertion in any of the six is falsified today, but PYAPI-07 is gated by exactly ONE file
  (`test_validation_error_contract.py`, which drives the real `main.app`). A shared app-factory
  fixture would close it. Reported, not fixed — outside the plan's fence.

- **140.1-08 FINDING-12 — two 429 SHAPES now coexist.** `routers/match.py`'s force-throttle and
  `routers/simulator.py`'s per-user window raise plain `HTTPException(429, detail="<string>")`, so a
  140.2 discriminator keying on `body.code` finds none on those two. Pre-existing, not in the S-table
  (which enumerates 5xx-capable sites). `service_error()` migration candidates.

- **140.1-08 — neither `VALIDATION_FAILED` nor `RATE_LIMITED` exists in the TS `WizardErrorCode`
  union.** `src/lib/wizardErrors.ts` has `KEY_RATE_LIMIT` and `CSV_VALIDATION_FAILED`, not these;
  `RATE_LIMITED` has ZERO hits anywhere in `src/`. Critical warning 6 is true PYTHON-side
  (`process_key.py:359`'s recoverable set) but does NOT imply a TS consumer exists. 140.2 obligation.

- **140.1-08 — C-11 residual for ops.** The Vercel-side stale `ANALYTICS_SERVICE_KEY` now leaves a
  `config_fault=mismatched` Sentry trail per 401 (rate-limited, 1 per 5 min per process — so up to
  N per window with N Railway replicas). That is detection AFTER the fact; proactive detection needs
  a credential-carrying probe, which belongs with the `warm-analytics` warmer. A-12/O-7 forbid
  routing `/health` through the seam core, so it cannot be a `/health` extension.

- **140.1-08 — ASSUMPTION-1 CLOSED.** slowapi v0.1.10's `_rate_limit_exceeded_handler`
  (`extension.py:76-87`) and `headers_enabled: bool = False` default (`:135`) are byte-identical to
  the installed 0.1.9. Read from the GitHub tag via `curl` into the scratchpad — no package installed.

- **140.1-08 — a fixed-call-count limiter trip loop is WRONG in a full-suite run.** slowapi APPENDS
  to `limiter._route_limits[endpoint]` on every decoration and sibling suites reload
  `routers.portfolio`, so N duplicate limits share one bucket key and ONE request costs N tokens.
  `test_rate_limit_contract.py` passed in isolation and failed in the suite until the loops became
  bounded-and-driven. Same class as plan 07's "iterate, don't index `[0]`".

### Load-bearing carry-forwards

- **WEDGE-01 (PR#632):** heavy pandas on the worker's shared loop froze `healthz` → container killed mid-job. No reaper/sweep on the worker loop — pg_cron only; JOB-07 regression test (Phase 142) proves it.
- **106-janitor revert:** a reaper keyed on `updated_at`/`computed_at` reaps mid-compute rows. Needs writer-stamped `computing_started_at` set in the SAME statement as the `computing` transition (JOB-01).
- **WORKER-04 2h→4h:** reaper thresholds come from batch-tail math (`batch_size × max_per_kind_timeout`), never intuition; the 4h `compute_jobs` number does NOT transfer to `strategy_analytics` (JOB-03).
- **Teaser is deliberately NON-idempotent** — a retry mints a duplicate verification + `public_token` + lead. Retry allowlist per `flow_type`, gated on the SEAM-05 audit.
- **Supabase migration ops:** new migrations MCP-apply to TEST (`qmnijlgmdhviwzwfyzlc`) before merge; merging to main AUTO-applies to PROD — watch + verify. Never edit shipped migration `20260720120000`; layer a new one.
- **Railway ops:** deploys silently SKIP on red main CI (verify commitHash + `/health`; `railway up` from repo root to force); env key `SUPABASE_SERVICE_KEY`.
- **Review policy:** per-phase = `gsd-code-reviewer` + `gsd-verifier` ONLY; one BIG review at milestone end.
- **Money-math/economic oracles pin ECONOMICS not the impl's own formula** (P115) — applies to any invariant tests here (threshold math, idempotency proofs).

### Blockers / Concerns

- **⏳ PR #656 is OPEN and unmerged** (`feat/v1.16-141-jobs-rate-retry`, 131 commits ahead of `origin/main`, MERGEABLE). 141 / 141.1 / 141.2 are all verified `passed` but NOT shipped. Founder call — everything else in the SEAM group is closed.
- **⚠️ Phase 140's `human_verification` item was never dispositioned — still owed as live ops.** "Watch Sentry during the next real Railway degradation window: confirm `CIRCUIT_OPEN` 503 envelopes appear and that no cascade-500s occur in the same window." It cannot be closed from the repo (no live Upstash in CI/local — 20+ test files delete the env vars — and no controllable Railway failure injection); it was declared manual-only in `140-VALIDATION.md`. `140-VERIFICATION.md` still reads `human_needed` for this one reason. Mirrored into TODOS.md.
- **📋 Close-out lesson (2026-08-01):** the SEAM group's phase-close bookkeeping went un-run because the phases were hand-driven per-phase rather than under `/gsd-autonomous`, so nothing owned **autonomous step 3d (post-execution routing)**. Consequences found and fixed in one pass: 141.1 sat at `gaps_found` for a day after all three of its gaps were closed in the tree (`22332e34` + the ledger reconciliation) simply because the VERIFICATION was never re-run; 141.2 sat at `human_needed` with four probes nobody had been asked to run (three were dischargeable read-only in minutes); 141.1/141.2 had **no milestone-list entry at all**; and 41 plan checkboxes across 140.4, 140.5, 141, 141.1 and 141.2 were never ticked, plus 8 missing G-series rows under 140.3. See memory `feedback_hand_driving_gsd_skips_orchestrator_gates`. **If a phase is hand-driven, run the close-out explicitly — the verifier flags these as "orchestrator-owned" and then nothing owns them.**
- **SEAM-05 audit is the Phase 141 long pole** — retry-safety of `recomputeMatch` / `computePortfolioAnalytics` / optimizer / simulator / bridge is UNAUDITED; `_get_recompute_lock` may be process-local, not distributed. Default everything unproven to no-retry.
- **Phase 143 needs a short design pass** — "what counts as orphaned" per strategy source (csv vs wizard vs resync) before it becomes one migration.
- **⚠️ OPS (140.2-09 / SC7) — confirm `INTERNAL_API_TOKEN` in the Vercel PRODUCTION env, and that it MATCHES the analytics service's value.** RESEARCH A3 could not verify it, and 140.2-09 changed the consequence: an ABSENT token now 500s every `analytics-client` route and 503s `/process-key` (intended fail-loud, better than an invisible platform bucket). A **MISMATCHED** token is the one state that still degrades silently — every claim fails `compare_digest` and every route sits on `platform:<path>` with no error anywhere. Likely present (`process-key-client` and `keys/[id]/permissions` already read it and `/process-key` works in prod), but unverified. `vercel env ls production | grep INTERNAL_API_TOKEN`.
- **The cross-language parity gate for `X-Tenant-Claim` is HALF-BUILT (owed as TS-36, owner 146).** `tests/fixtures/tenant-claim-parity.json` is read by two TS suites; NO pytest reads it. Until one does, the only thing pinning the Python verifier to the TS mint is a single hand-copied literal in `test_process_key.py`.
- **Phase 145 scope is unsettled by design** — reproduction result decides fold-RPCs vs compensating cleanup; CONTRIB-02 `p_terminal_status` owner-only variant must survive any RPC fold.

### Deferred / open items carried from prior milestones (unchanged by v1.16)

- **v1.13 founder LIVE ops recorded human_needed at close (2026-07-22):** WORKER-01/03 cutover/reschedule; E2GT-01 live E2 anchor run; FLIP-01 prod backfill enqueue; sFOX EGRESS/GOLIVE items — per memory, sFOX flags flipped ON in prod 2026-07-22; the Nautilus-DD-API reframe supersedes parts of that spine — reconcile in TODOS.md, not here.
- **v1.14 deferred:** LIVE acceptance of `smoothed_mtm` on a real Deribit options key (no such key in prod; founder action).
- **v1.15 open non-blocking:** MT5 server-UTC offset confirm on a TRADING day; DST edge founder VNC-confirm.
- **Standing latent bugs (TODOS.md):** quantstats price-detection Sharpe sign-flip (strategy-analytics path — v2 MONEY-03); blend unknown-asset_class annualization (v2 MONEY-04); `allocator_equity_snapshots` retirement (post-FLIP only).
- **Backlog ground truth = root TODOS.md** — add/close items ONLY there.

## Session Continuity

**Last activity:** 2026-08-03
**Stopped at:** Phase 142.2 context gathered
**Next step:** run `/gsd:verify-work` on Phase 140.1.1. Nothing is left to execute.

⚠️ **Env changed and LEFT changed:** `slowapi` was synced **0.1.9 → 0.1.10** (the CI pin at `analytics-service/requirements.txt:226`) and deliberately NOT restored — matching CI is the point, and every #3/#4/#5 mutation row is version-stamped against it. A verifier re-running those cycles on 0.1.9 would not be reproducing this evidence.

**Gates at `39688d69`:** pytest **4743 passed / 96 skipped / 0 failed** · `mypy --strict` **89 files clean** · `npx tsc --noEmit` **0** · full `npm run test:coverage` **8878 passed / 287 skipped / 0 failed** (697 files, all four thresholds clear) · `npm run lint` **0 errors** · **0** new `# type: ignore` across `56fb7167..HEAD` · `grep -rn MUTANT` → 0 · tree clean (only the orchestrator's `TODOS.md` and the pre-existing untracked `scripts/nautilus_factsheet.py`, neither touched).

**Open items the verifier inherits (not this plan's):** the two Phase 140.1 `gaps_found` warnings (`simulator.py:92` IP-keying → PYAPI-03 is 9/9 not 10/10; the two in-handler `HTTPException(429)` sites), O-1..O-4 in the repair programme, and the 12 non-environmental pytest skips.
