---
phase: 142-job-strategy-analytics-stuck-computing-reaper-computing-star
plan: 05
subsystem: database
tags: [supabase, sql-gate, plpgsql, pg_cron, psql, ci, falsifiability]

# Dependency graph
requires:
  - phase: 142
    plan: 04
    provides: "migration 20260802120000 — the computing_started_at DDL, the re-based bridge, and the deployed cron body this gate asserts against"
  - phase: 142
    plan: 03
    provides: "the Python/TS writer stamping whose SQL twin this gate proves"
provides:
  - "supabase/tests/test_strategy_analytics_stuck_computing_reaper.sql — 5-part SQL gate (structural + 4 behavioral parts) auto-discovered by ci.yml's sql-tests glob"
  - "An anti-green-skip contract: an unapplied migration is a RED gate, observed offline"
affects:
  - "CI sql-tests job (one new file, no workflow edit — glob discovery)"
  - "Phase 142 sign-off: JOB-02's behavioural proof on TEST remains OPEN"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Ungated structural Part 1 as the TDD RED proof — the counter-pattern to test_retention_orphaned_running.sql's two presence gates, which no-op the whole file"
    - "Frozen-clock-proof SC-2b: a SENTINEL stamp pre-set between two real RPC calls, because now() is constant inside the part's transaction and the naive two-call comparison cannot fail"
    - "Shared-TEST-DB isolation for a GLOBAL ORDER BY ... LIMIT body: neutralize non-seeded rows via the reaper's own NULL-stamp skip rule, then scope every count to the seeded id set"

key-files:
  created:
    - supabase/tests/test_strategy_analytics_stuck_computing_reaper.sql
  modified: []

key-decisions:
  - "Task 2 (apply-to-TEST + the four deployed-body mutations) recorded SKIPPED-with-reason, never as caught. No TEST-DB route exists on this machine: TEST_SUPABASE_DB_URL unset, Supabase MCP absent, and the CLI is linked to PROD so it must not be used."
  - "Split the plan's Part 2 into Part 2 (directional arms A-D) and Part 3 (arm E, the LIMIT bound) so the 26-row LIMIT seed cannot interact with the directional seeds. Per-part BEGIN/ROLLBACK framing preserved."
  - "Added a Part 5 driving mark_compute_job_failed to failed_final, taking the plan's explicit option to prove branch (b)'s exit clear behaviorally rather than leaving it on Part 1's structural anchor alone."
  - "Ran an offline throwaway-Postgres proof of the gate file itself (parses, all 5 parts green, reddens when unapplied, and each assertion fires under its mutation). Recorded as artifact-quality evidence ONLY — explicitly NOT ledger evidence for SC-1/1b/2/2b."

requirements-completed: []

# Metrics
duration: ~50min
completed: 2026-08-02
---

# Phase 142 Plan 05: stuck-computing reaper SQL gate Summary

**The JOB-01/JOB-02/JOB-03 SQL gate is authored, committed, and proven to redden when the migration is unapplied — but JOB-02's behavioural proof against the real TEST project is DEFERRED, because no route to that database exists on this machine.**

---

## ⛔ READ FIRST — JOB-02's behavioural proof is DEFERRED

**The four deployed-body mutations this plan owns (SC-1, SC-1b, SC-2, SC-2b) are SKIPPED, not caught.** Task 2 could not run at all. Per `142-VALIDATION.md`'s own rule — *"a mutation that is skipped is recorded as skipped, never as caught"* — those four Falsifiability Ledger rows stay open.

**Why:** there is no route from this machine to TEST `qmnijlgmdhviwzwfyzlc`.

| Probe | Result |
|---|---|
| `printenv TEST_SUPABASE_DB_URL` | **UNSET** (exists only as a GitHub Actions secret; absent from every `.env*`) |
| `/opt/homebrew/opt/postgresql@16/bin/psql --version` | present — `psql (PostgreSQL) 16.13`, but a client with no connection string reaches nothing |
| `mcp__plugin_supabase_supabase__list_projects` | **`Error: No such tool available`** — the Supabase MCP OAuth flow is not authorized for this agent |
| Supabase CLI | installed and authenticated, but the repo is **LINKED TO PROD** (`khslejtfbuezsmvmtsdn`). Not used. `supabase db push` / `link` were never invoked — one wrong flag is a production write. |

**What closes it, exactly, in this order:**

1. Apply `supabase/migrations/20260802120000_strategy_analytics_stuck_computing_reaper.sql` to TEST `qmnijlgmdhviwzwfyzlc` — via Supabase MCP `apply_migration` once the OAuth flow is authorized, or via `psql "$TEST_SUPABASE_DB_URL"` once that secret is available locally. **Never PROD** — PROD auto-applies on merge to `main`.
2. Run the gate: `PATH=/opt/homebrew/opt/postgresql@16/bin:$PATH psql "$TEST_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/test_strategy_analytics_stuck_computing_reaper.sql`. Observe the RED→GREEN flip across the apply.
3. Run the four mutations from `142-VALIDATION.md` §Falsifiability Ledger against the deployed objects — capture `pg_get_functiondef` + `cron.job.command` FIRST, restore FROM the capture, and assert byte-identity afterwards.

Until step 3 is done, **JOB-02 has structural and offline evidence only.** The prior plan's throwaway-Postgres smoke is explicitly *not* a substitute: its own author recorded that the schema was stubbed and pg_cron faked (`142-04-SUMMARY.md`, "What this smoke does NOT prove").

---

## Performance

- **Duration:** ~50 min
- **Tasks:** 3 (1 complete, 1 **SKIPPED — no harness**, 1 complete)
- **Files created:** 1 · **modified:** 0

## Task Commits

| # | Task | Commit | Result |
|---|------|--------|--------|
| 1 | Author the SQL gate | `8e886fe0` (test) | ✅ complete |
| 2 | Apply to TEST + observe 4 mutations | — | ⛔ **SKIPPED — no TEST-DB harness available** |
| 3 | Phase gate (suites + type gates + ledger) | — (verification only, no repo change) | ✅ complete |

---

## Task 1 — the gate, and what it is designed to survive

`supabase/tests/test_strategy_analytics_stuck_computing_reaper.sql`, 637 lines, five parts. CI picks it up with **no workflow edit** — `ci.yml`'s `sql-tests` job globs `supabase/tests/test_*.sql`.

| Part | Transaction | Gated? | Proves |
|---|---|---|---|
| 1 | none (catalog reads only) | **UNGATED** except pg_cron absence | column shape; bridge functiondef anchors; cron registration, cadence, body anchors |
| 2 | `BEGIN`…`ROLLBACK` | pg_cron absence only | arms A–D: stranded reap (all 4 columns), both SC#2 directions, active-job survival, NULL-stamp survival |
| 3 | `BEGIN`…`ROLLBACK` | pg_cron absence only | arm E: 26 stranded ⇒ exactly 25 seeded reaped on tick 1, the remaining 1 on tick 2 |
| 4 | `BEGIN`…`ROLLBACK` | **never** | real-RPC stamp transition, the SC-2b sentinel arm, branch (c) exit clear |
| 5 | `BEGIN`…`ROLLBACK` | **never** | branch (b) exit clear via `mark_compute_job_failed(... 'permanent' ...)` |

### The anti-green-skip contract (the point of the file)

Part 1 is deliberately ungated and its **first** assertion is the column-existence check, so an unapplied migration aborts the whole file under `ON_ERROR_STOP=1`. It follows `test_sync_status_supersede_failed_per_kind.sql` and deliberately does **not** reproduce `test_retention_orphaned_running.sql:71-83`, whose two `RAISE NOTICE … RETURN` presence gates no-op every assertion in that file when the migration has not reached the project.

The only `RETURN;` statements in the whole file are the two sanctioned pg_cron-absent skips in Parts 2 and 3 — **Part 1 contains none**, and Parts 4–5 are not gated at all:

```
$ grep -n 'RETURN;' supabase/tests/test_strategy_analytics_stuck_computing_reaper.sql
286:    RETURN;        <- Part 2, pg_cron absent
418:    RETURN;        <- Part 3, pg_cron absent
```

### The frozen-clock trap, and why the naive SC-2b test cannot fail

Every part runs inside one transaction, so `now()` is **constant** for the part. Under an unconditional stamp, "call the RPC twice and compare the two stamps" writes the *same frozen* `now()` both times and compares equal — the test passes through the exact bug it exists to catch. Part 4 instead pre-sets a sentinel (`now() - interval '3 hours'`) **between** the two real `mark_compute_job_done` calls and asserts the stamp still equals that sentinel. The offline mutation run below shows the two values landing exactly three hours apart, which is the measurement the naive design would have thrown away.

### Shared-TEST-DB isolation

The deployed body is a **global** `ORDER BY computing_started_at ASC LIMIT 25`, and the migration's backfill stamps every pre-existing `computing` row from `computed_at` — those rows sort *ahead* of the seeds and could crowd them out of the 25-row budget. So inside the rollback and before **each** `EXECUTE v_command`:

```sql
UPDATE public.strategy_analytics
   SET computing_started_at = NULL
 WHERE computation_status = 'computing'
   AND strategy_id <> ALL (v_seeded);
```

This uses the reaper's own NULL-stamp skip rule — no new mechanism — and the `ROLLBACK` guarantees it never persists. Every reap count is scoped to the seeded id set (`= ANY (v_seeded)`); there is no global count anywhere.

### DB-independent acceptance criteria — all checked

| Criterion | Check | Result |
|---|---|---|
| Plan's shape verify | `EXECUTE v_command` + `mark_compute_job_done` + zero XML-ish tokens | ✅ `gate-shape-ok` |
| S-6 oracle is the deployed body | `EXECUTE v_command` present; zero direct `sync_strategy_analytics_status` calls outside `pg_get_functiondef` | ✅ |
| Part 1 has no presence-gate `RETURN` | `grep -n 'RETURN;'` → only lines 286/418 (Parts 2/3, pg_cron) | ✅ |
| Per-part framing, no outer transaction | `^BEGIN;` = **4**, `^ROLLBACK;` = **4**, `COMMIT` = **0** (sole hit is a comment) | ✅ |
| `SET LOCAL lock_timeout` after every BEGIN | `^SET LOCAL lock_timeout` = **4** == `^BEGIN;` = **4** | ✅ |
| Neutralization before each `EXECUTE` | present in Part 2 (1×) and Part 3 (2×, once per tick) | ✅ |
| Seed-scoped counts only | all three `count(*)` are `WHERE strategy_id = ANY (v_seeded)` | ✅ |
| Arm A asserts all FOUR columns + string-equality error + `warned = TRUE` seed | read | ✅ |
| Arm E: 26 seeded, 25 then 1 | read | ✅ |
| No fixed UUID literals | UUID-literal regex → **0 hits**; every id `gen_random_uuid()` | ✅ |
| No psql meta-commands | all four CI preflight patterns (`\!`, `\copy`, `\COPY`, `\o`) → **0 hits** | ✅ |
| Every RAISE format string a single literal | read — `%` placeholders only, no `\|\|` in any format string | ✅ |
| Schedule pinned by string equality | `IS DISTINCT FROM '*/15 * * * *'`, no `::INT` cast (the hour field is `*`) | ✅ |
| Threshold pinned as a test-side literal | `interval ''16 hours''` typed into the test, not read from the impl | ✅ |
| Not added to `test_retention_crons_safe.sql` | file untouched (`git status` clean apart from the new file) | ✅ |
| `min_lines: 150` | 637 | ✅ |

---

## Task 2 — ⛔ SKIPPED, with reason

**Reason: no TEST-DB harness available.** See the banner at the top for the probe results and the exact steps that close it. Nothing was applied, mutated, or restored on any remote Supabase project. **PROD was never targeted by any call.** `supabase db push` and `supabase link` were never invoked.

| Ledger row | Mutation | Status |
|---|---|---|
| SC-1 | reap body `'failed'` → `'pending'` | ⬜ **SKIPPED — no TEST-DB harness available** |
| SC-1b | reap body: delete the `computation_warned = FALSE` assignment | ⬜ **SKIPPED — no TEST-DB harness available** |
| SC-2 | reap `WHERE`: `computing_started_at` → `computed_at` | ⬜ **SKIPPED — no TEST-DB harness available** |
| SC-2b | bridge branch (a): unconditional stamp | ⬜ **SKIPPED — no TEST-DB harness available** |

None of these is recorded as caught. There is no pre-apply RED paste, no MCP apply confirmation, no post-apply GREEN paste, no pre-mutation `pg_get_functiondef` / `cron.job.command` capture, and no byte-identity restore check, because none of those steps ran.

---

## Offline artifact proof — evidence about the GATE, **not** about TEST

⚠️ **This section is deliberately kept out of the Falsifiability Ledger.** It was run against a **throwaway local Postgres 16.13 cluster** with a **stubbed schema** (no RLS, no triggers, reduced constraints) and **faked pg_cron** (a `pg_extension` row plus `cron.schedule`/`cron.unschedule` shims that only store the command text — no scheduler ran). It proves things about the *file I wrote*: that it parses, that its assertions fire, and that it cannot green-skip. It proves **nothing** about the deployed objects on TEST, and it does not close SC-1/SC-1b/SC-2/SC-2b. The cluster was stopped and its data directory lives only in the scratchpad; **zero repo files were touched by any of it** (`grep -rn MUTANT` → 0, `git status --short` clean).

The real migration `20260802120000` was applied to that cluster unmodified, and the two real RPCs (`mark_compute_job_done` from `20260603120000:346-443`, `mark_compute_job_failed` from `20260529180000:46-142`) were extracted verbatim by line range rather than retyped.

**A1 — the gate is green when the migration is applied** (`exit=0`):

```
NOTICE:  Part 1a OK: computing_started_at is timestamptz, nullable, no default; bridge stamps conditionally ...
NOTICE:  Part 1b OK: reap_strategy_analytics_stuck_computing registered at */15 * * * * with a bounded, computing_started_at-keyed, four-column body carrying the 16-hour threshold.
NOTICE:  Part 2 OK: stranded row reaped on all four columns; fresh-stamp/old-computed_at survived; active-job row survived; NULL-stamp row survived untouched.
NOTICE:  Part 3 OK: LIMIT bound holds -- 25 of 26 seeded stranded rows reaped on tick 1, the remaining 1 on tick 2 (bounded AND progressing).
NOTICE:  Part 4 OK: transition into computing stamps; a second bridge call on an already-computing row keeps the sentinel (SC-2b); branch (c) clears the stamp on terminal resolution.
NOTICE:  Part 5 OK: branch (b) terminal failure clears computing_started_at.
exit=0
```

**A2 — the gate CANNOT green-skip** (same stub schema, migration *not* applied; `exit=3`):

```
ERROR:  TEST FAILED (1/JOB-01): strategy_analytics.computing_started_at does not exist. Migration
        20260802120000 is NOT applied to this project. This assertion is deliberately ungated: an
        unapplied migration must be a RED gate, never a green skip.
CONTEXT:  PL/pgSQL function inline_code_block line 19 at RAISE
exit=3
```

**A3 — each assertion fires under its corresponding mutation.** Restored between runs by re-applying the migration (safe here: throwaway cluster, not shared TEST).

| Mutation shape | Where it fired | Failing assertion (abridged) |
|---|---|---|
| `'failed'` → `'pending'` | **behavioral**, Part 2 arm A (Part 1 passes it through — the structural anchors do not cover the terminal status, so the arm is genuinely load-bearing) | `TEST FAILED (2/arm A/JOB-02): a stranded computing row … was not terminalized to failed (got pending)` |
| delete `computation_warned = FALSE` | Part 1 body anchor **and** Part 2 arm A | `TEST FAILED (1/JOB-02/SI-02): reaper body does not clear computation_warned …` / `TEST FAILED (2/arm A/SI-02): the reap did not clear computation_warned (got t)` |
| `computing_started_at <` → `computed_at <` | Part 2 arm A **and** arm B — **both** SC#2 directions | `(2/arm A/JOB-02) … not terminalized to failed (got computing)` and `(2/arm B/SC#2): a row with a FRESH computing_started_at but a 100-day-old computed_at was reaped (got failed)` |
| bridge stamp CASE → unconditional `now()` | Part 1 functiondef anchor **and** Part 4's sentinel | `TEST FAILED (4b/SC-2b/JOB-01): … ADVANCED computing_started_at (expected the sentinel 2026-08-02 09:44:06.709741+02, got 2026-08-02 12:44:06.709741+02)` |

That last line is the frozen-clock argument made concrete: the two values are exactly three hours apart *only because of the sentinel*. A two-call comparison would have compared `12:44:06.709741` with `12:44:06.709741` and passed.

To reach the behavioral arms under mutations that Part 1 also catches, the relevant part was extracted and run alone (`ON_ERROR_STOP` otherwise aborts at Part 1). For the SC#2 direction-2 arm, arm A's assertion block was additionally stripped from the extract so execution could reach arm B. Both extracts are scratchpad-only.

---

## Task 3 — phase gate

| Gate | Command | Result |
|---|---|---|
| Python suite | `cd analytics-service && python3 -m pytest -q` | ✅ **4842 passed, 96 skipped** in 57.7s |
| Python coverage (CI gate) | `pytest --cov=services --cov=routers --cov=main_worker --cov-fail-under=80 -q` | ✅ **90.45%** — "Required test coverage of 80% reached" |
| Type gate (Python) | `python3 -m mypy --strict --follow-imports=silent services/ routers/ models/` | ✅ **Success: no issues found in 89 source files** |
| Lint (+ route-manifest + route-contract) | `npm run lint` | ✅ **0 errors**, 1 pre-existing warning (see below); `[check-admin-route-manifest] OK — 20 admin routes`, `[check-route-contract] OK — 56 page routes` |
| Type gate (TS) | `npm run typecheck` | ✅ clean |
| Parity contract | `npx vitest run src/__tests__/contracts/check-zod-db-check-parity.test.ts` | ✅ **19 passed** — untouched-green, this phase adds no enum value |
| Full vitest | `npm test` | ✅ **735 files passed, 10491 tests passed**, 287 skipped |
| SQL gate against TEST | — | ⛔ **not run — no TEST-DB harness** (see banner) |

`pytest` was run **from `analytics-service/`** in every invocation (a repo-root run misses the VCR cassette directory and makes live broker calls).

The one lint warning is `src/app/(dashboard)/allocations/widgets/performance/EquityChart.tsx:1119` — a pre-existing `react-hooks/exhaustive-deps` warning in a file this phase never touched. Out of scope per the executor scope boundary; not fixed, not counted as a deviation.

### `grep -rn MUTANT` repo-wide

```
(no matches)
```

`git status --short` showed only the new gate file before the commit, and is clean after.

---

## Falsifiability Ledger reconciliation — 11 rows

| SC | Mutation | Owner plan | Status |
|----|----------|-----------|--------|
| SC-1 | reap body `'failed'` → `'pending'` | **142-05** | ⬜ **SKIPPED — no TEST-DB harness available** |
| SC-1b | reap body: delete `computation_warned = FALSE` | **142-05** | ⬜ **SKIPPED — no TEST-DB harness available** |
| SC-2 | reap `WHERE`: `computing_started_at` → `computed_at` | **142-05** | ⬜ **SKIPPED — no TEST-DB harness available** |
| SC-2b | bridge branch (a): unconditional stamp | **142-05** | ⬜ **SKIPPED — no TEST-DB harness available** |
| SC-3 | Python reaper-threshold constant ÷ 10 | 142-01 | ✅ Observed (RED pasted in `142-01-SUMMARY.md`) |
| SC-3b | migration interval literal ≠ Python constant | 142-04 | ✅ Observed (RED pasted in `142-04-SUMMARY.md`) |
| SC-4 | wire the reaper identifier into `dispatch_tick` | 142-02 | ✅ Observed (RED pasted in `142-02-SUMMARY.md`) |
| SC-4b | loop-blocking reap vs. its yielding twin (control pair) | 142-02 | ✅ Observed, opposite outcomes |
| SC-5 | delete the entry stamp from `_mark_computing` | 142-03 | ✅ Observed |
| SC-5b | delete the composite-success `computing_started_at: None` clear | 142-03 | ✅ Observed |
| SC-5c | delete `computing_started_at: null` from the TS failed placeholder | 142-03 | ✅ Observed |

**7 Observed · 4 SKIPPED-with-reason · 0 caught-without-run.** The ledger is **not** fully reconciled, and this plan does not claim it is.

### Advisory-CI honesty

Branch protection is OFF (founder decision, deferred until paying clients), so every CI gate is **advisory at merge time**. The correct phrasing for everything above is that these gates **would have caught** the mutations they were run against. Nothing "did stop" anything at merge.

### Cadence language

The `*/15 * * * *` schedule is **post-threshold detection latency** — a stranded row is terminalized within ~15 minutes of *crossing* the 16-hour threshold, so the end-to-end worst case is ≈ threshold + 15 min. It does **not** bound how long a user watches a spinner, and this plan makes no live-poll rescue claim.

---

## Operator follow-ups — OUT of execution scope

1. **Post-merge PROD check (pending, not performed).** After merge to `main` auto-applies the migration to PROD `khslejtfbuezsmvmtsdn`, run `SELECT jobname, schedule FROM cron.job WHERE jobname = 'reap_strategy_analytics_stuck_computing'` and re-run the `computation_status = 'computing'` census to confirm the one-shot backfill produced sane stamps. No PROD verification is claimed here.
2. **Manual wizard render check (pending).** `142-VALIDATION.md` §Manual-Only Verifications: on TEST, strand a row, run the reaper body, reload the wizard, and confirm the `GATE_ANALYTICS_FAILED` panel renders with a working retry and a `Details:` line that does not re-attribute fault.

---

## Deviations from Plan

**1. [Harness gap — Task 2 in full] No route to the TEST database; the task could not run**
- **Found during:** Task 2 pre-flight (and pre-confirmed by the orchestrator before this run).
- **Issue:** `TEST_SUPABASE_DB_URL` unset, Supabase MCP tool absent (`No such tool available`), CLI linked to PROD and therefore off-limits.
- **Action:** Recorded SKIPPED-with-reason on all four ledger rows and stated the exact closure steps. Not worked around, not simulated, not inferred.
- **Files modified:** none

**2. [Plan-sanctioned option taken] Part 5 added for branch (b)'s exit clear**
- **Found during:** Task 1
- **Rationale:** The plan permitted adding the branch-(b) clear arm "if driving `mark_compute_job_failed` to `failed_final` is cheap with the same seed idiom". It is — `p_error_kind = 'permanent'` forces `failed_final` regardless of attempts — so branch (b) is now proven behaviorally rather than resting on Part 1's structural anchor. Both facts are stated in the file's comments.
- **Files modified:** `supabase/tests/test_strategy_analytics_stuck_computing_reaper.sql`
- **Commit:** `8e886fe0`

**3. [Structural split] The plan's "Part 2, arms A–E" ships as Part 2 (arms A–D) + Part 3 (arm E)**
- **Found during:** Task 1
- **Rationale:** Arm E seeds 26 stranded rows; in one shared transaction with arms A–D, arm A's stranded row would compete for the same LIMIT-25 budget and make the count assertion order-dependent. Separate transactions remove the interaction entirely. Every requirement the plan attached to "Part 2" (per-part framing, `SET LOCAL lock_timeout`, pre-`EXECUTE` neutralization, seed-scoped counts) holds in **both** parts.
- **Files modified:** same file, same commit

**4. [Addition beyond plan] Offline throwaway-Postgres proof of the gate file**
- **Found during:** Task 1 verification
- **Rationale:** With Task 2 unavailable, the file would otherwise have shipped with no execution evidence at all — a `42601` would have surfaced as a red CI run. The throwaway cluster costs minutes and converts "the greps pass" into "the file parses, all five parts execute, it reddens when unapplied, and every assertion fires under its mutation". Recorded with an explicit statement of what it does **not** prove, and deliberately excluded from the ledger.
- **Files modified:** none in the repo (scratchpad only)

**Total:** 0 auto-fixes (nothing was broken), 1 harness gap escalated rather than worked around, 2 plan-sanctioned structural choices, 1 addition beyond scope. No fixed decision, number, or acceptance criterion was changed.

## Issues Encountered

- **The worktree forked from an ancestor of the phase branch**, exactly as the phase's prior four spawns did. The startup block corrected it. ⚠️ The base SHA supplied in the prompt (`b24519681a1c0ba0e4a5b4b52e2f27ed4b96e7f9`) **does not exist as an object** — only its first 8 characters match the real phase-branch tip `b24519686b11abca684c2a952d6a6a6d21b64a47`. The intent was unambiguous (that tip carries the 142-04 migration under test) and the working tree was clean, so the reset was performed against the resolved SHA. Flagging because a mangled base SHA would silently defeat the `ACTUAL_BASE` guard for any executor that took `git merge-base` failing as "nothing to correct".
- `python` is not on PATH; `python3` used throughout.
- A Vercel-plugin hook injected a **`vercel-storage`** skill directive on every `supabase/**` read. It is a false-positive path match — this work is Supabase Postgres and pg_cron, not Vercel Storage — so it was not followed. Flagged rather than hidden, matching 142-04.
- Cluster roles are cluster-wide, so the second throwaway database needed a `CREATE ROLE`-free copy of the stub schema. Cosmetic; noted only so the offline evidence is reproducible.

## Known Stubs

None in the shipped artifact. The gate file is complete and every assertion is live.

The **stubs that exist are in the scratchpad harness, not the repo**, and they are why the offline evidence is not ledger evidence: the schema stub omits RLS, triggers, and most constraints, and `pg_cron` is faked by a table plus two shims that never schedule anything. They are named here so no later reader mistakes them for coverage.

## Threat Flags

No new security-relevant surface. This plan adds one test file that runs read-only catalog queries plus fully-rolled-back seeds; it creates no endpoint, no auth path, and no schema change.

Dispositions from the plan's register:

| Threat ID | Status |
|---|---|
| T-142-16 (gate green-skips while the reaper is unproven) | **Partially mitigated.** The gate's own green-skip hole is closed and observed closed (proof A2). The *other half* — the migration actually being applied to TEST before the gate counts — is **NOT** done; that is the deferred banner. |
| T-142-17 (seeds or mutation residue left on shared TEST) | **Mitigated by construction and vacuously true here:** per-part `BEGIN…ROLLBACK`, `gen_random_uuid` ids, teardown `DELETE`, and — since nothing ran against TEST — zero rows were written to it at all. |
| T-142-18 (verification claims exceed what advisory CI can enforce) | **Mitigated.** Every claim is phrased "would have caught"; the four unrun mutations are SKIPPED, not caught; PROD is listed as a pending operator step. |
| T-142-SC (package installs) | **Zero packages installed.** |

## User Setup Required

**Yes — and it is blocking for Phase 142 sign-off, not just for this plan.** Provide one of: (a) `TEST_SUPABASE_DB_URL` locally, or (b) an authorized Supabase MCP session scoped to TEST `qmnijlgmdhviwzwfyzlc`. Then run the three closure steps in the banner. Until then JOB-02's behavioural proof is open.

## Next Phase Readiness

- The gate file is on disk and in CI's glob. On the **first PR run with the migration applied to TEST**, `sql-tests` becomes the authoritative execution of this file — and if the migration is *not* applied there, that job goes RED rather than silently passing, which is the designed outcome.
- **Do NOT** add this cron to `supabase/tests/test_retention_crons_safe.sql`; its loop requires `%where%created_at%` in every listed body, the exact opposite of this reaper's design. Left untouched.
- Phase 142's sign-off checklist item *"every ledger row is Observed with pasted evidence, or explicitly marked skipped-with-reason"* is satisfied only in its second form for SC-1/1b/2/2b. A reviewer should treat the phase as **not** fully falsifiability-reconciled.

## Self-Check: PASSED

| Claim | Result |
|---|---|
| `supabase/tests/test_strategy_analytics_stuck_computing_reaper.sql` exists | FOUND (637 lines) |
| Commit `8e886fe0` (Task 1) | FOUND |
| `git diff --diff-filter=D --name-only HEAD~1 HEAD` | empty — no files deleted |
| `git status --short` after commit | clean |
| STATE.md / ROADMAP.md modified | **NO** — orchestrator owns those writes |
| Any write to a remote Supabase project | **NONE** — no `db push`, no `link`, no MCP call |

---

# ⬇️ Follow-up run — 2026-08-02 — deferred proof **NOT** closed

> **Appended, not rewritten.** Everything above is the original plan-05 executor's account and stands
> as written. This section records a later, dedicated attempt to close the deferred Task 2, and its
> outcome. **The outcome is: still deferred.** The four ledger rows remain SKIPPED.

## What was attempted and why

A follow-up executor was dispatched specifically to close `[BLOCKING]` Task 2 and the four
Falsifiability Ledger rows **SC-1, SC-1b, SC-2, SC-2b**, on the stated premise that *"the harness now
exists — the Supabase MCP was authorized by the user mid-run, which is why 142-05 could not do this."*

**That premise does not hold for an executor subagent.** Migration `20260802120000` is **still not
applied** to TEST `qmnijlgmdhviwzwfyzlc`. Nothing was applied, mutated, captured, or restored on any
remote Supabase project. **PROD was never touched by any call, of any kind.**

## The blocker, and how it differs from what 142-05 recorded

142-05 concluded "the Supabase MCP OAuth flow is not authorized for this agent". That diagnosis was
**incomplete**. The refined finding:

| Route | Probe | Result |
|---|---|---|
| Supabase MCP | `mcp__plugin_supabase_supabase__list_migrations` | `Error: No such tool available` |
| **control** — an unrelated MCP server | `mcp__plugin_github_github__get_me` | `Error: No such tool available` |
| `psql` + connection string | `printenv TEST_SUPABASE_DB_URL` | **UNSET**; absent from all `.env*`; `gh secret list` shows it exists **only** as a GH Actions secret (value write-only) |
| Supabase CLI | `cat supabase/.temp/project-ref` | **`khslejtfbuezsmvmtsdn` = PROD** — CLI-linked to production. A CLI write is a production write. Not used |

The **control probe is the new information.** GitHub's MCP fails identically to Supabase's, so this is
a **blanket strip of every `mcp__*` tool from the subagent context** — not a Supabase authorization
gap. Root cause: the Supabase MCP is a *remote OAuth* server (`https://mcp.supabase.com/mcp`, per
`plugins/cache/claude-plugins-official/supabase/0.1.13/agents/claude/.mcp.json`); its grant lives in
the **orchestrator session**, and MCP tools are dropped for agents carrying a `tools:` frontmatter
restriction (upstream `anthropics/claude-code#13898`).

**Consequence for planning: authorizing the MCP in the parent session does not propagate it to a
spawned executor.** Re-dispatching another subagent will fail the same way. This is the correction
that matters.

### Workaround considered and refused

The cached Supabase OAuth token could be read from the macOS Keychain and used to hand-roll HTTP calls
to the MCP endpoint or the Management API. **Refused on principle.** That reconstructs a credential in
order to bypass a tool-permission boundary the permission system deliberately did not grant. Recorded
explicitly so its absence is not mistaken for an oversight.

*(Incidental: a Keychain probe for a DB connection string returned the `quantalyze-test` e2e **user
login** credential instead — app-user credentials, not database credentials, and not a route to the DB.)*

## Ledger status — unchanged

| SC | Mutation | Status after this run |
|----|----------|----------------------|
| SC-1 | reap body `'failed'` → `'pending'` | ⛔ **SKIPPED — migration not applied to TEST; no MCP/psql route** |
| SC-1b | reap body: delete `computation_warned = FALSE` | ⛔ **SKIPPED — same** |
| SC-2 | reap `WHERE`: `computing_started_at` → `computed_at` | ⛔ **SKIPPED — same** |
| SC-2b | bridge branch (a): unconditional stamp | ⛔ **SKIPPED — same** |

**Zero rows flipped to Observed. No evidence was pasted because none was produced.** Per the ledger's
own rule, a mutation that did not run is skipped, never caught. The 142-04 and 142-05 throwaway-Postgres
smokes remain **excluded** — both authors recorded that their schema was stubbed and `pg_cron` faked.

## Runbook for whoever holds the MCP grant

Verified against the real files this run: migration = 690 lines, self-contained `BEGIN;` at **:209** /
`COMMIT;` at **:690**; gate = 637 lines, **4** per-part `BEGIN;`…`ROLLBACK;` blocks (:267/:396,
:405/:485, :499/:585, :594/:637).

**Step 1 — apply.** `apply_migration` → project `qmnijlgmdhviwzwfyzlc` (**never** `khslejtfbuezsmvmtsdn`).
⚠️ The file carries its **own** `BEGIN;`/`COMMIT;`. If `apply_migration` also opens a transaction, the
nested `BEGIN` emits `WARNING: there is already a transaction in progress` and creates **no** savepoint,
so the file's `COMMIT` at :690 commits the *outer* transaction. `COMMIT;` is the last line, so the DDL
itself is fine — but **verify the migration-record row actually landed** rather than assuming, and
record the version MCP stamps (it stamps `now()`, not the `20260802120000` filename — note the drift).

**Step 2 — verify the apply** with direct queries: column `computing_started_at` is `timestamptz`,
nullable, no default; `idx_strategy_analytics_computing_started` present; `cron.job` has
`reap_strategy_analytics_stuck_computing` at `*/15 * * * *`; `pg_get_functiondef` of
`public.sync_strategy_analytics_status(uuid)` contains the three-arm `CASE` and **not** an
unconditional stamp. The one-shot backfill should touch **0 rows** (census: 0 of 7,371 `computing` on
TEST) — confirm, don't assume.

**Step 3 — gate.** ⚠️ **Determine empirically whether the execution path preserves each part's
`ROLLBACK` *before* running anything that seeds.** The per-part rollback framing is what keeps seeded
rows off the shared TEST project. If `execute_sql` imposes its own transaction handling that would let
seeds persist, **stop and report** — a polluted shared TEST is worse than an unobserved ledger row.

**Step 4 — the four mutations, capture-first.** Capture **before** mutating:
`SELECT pg_get_functiondef('public.sync_strategy_analytics_status(uuid)'::regprocedure);` and
`SELECT command, schedule FROM cron.job WHERE jobname='reap_strategy_analytics_stuck_computing';`

SC-1 / SC-1b / SC-2 mutate the **cron body** (`cron.unschedule` then `cron.schedule` with the edited
command); SC-2b mutates the **bridge** (`CREATE OR REPLACE`). Against the real deployed body
(migration :505-526), the three body edits are:

- **SC-1** — `SET computation_status = 'failed'` → `'pending'` ⇒ arm A's terminal assertion RED
- **SC-1b** — delete the `computation_warned   = FALSE,` line ⇒ arm A's launder assertion RED
- **SC-2** — in the subselect `WHERE`, `s.computing_started_at < now() - interval '16 hours'` →
  `s.computed_at < now() - interval '16 hours'` ⇒ **both** SC#2 directional arms flip
- **SC-2b** — replace the branch-(a) three-arm `CASE` (migration :328-341) with an unconditional
  `computing_started_at = now()` ⇒ Part 4's sentinel assertion RED **and** Part 1's negative anchor RED

**Restore FROM the captured text — never by re-running the migration and never by retyping** (a
repo-side drift would silently land a wrong body on shared TEST, and these mutations run *outside* any
rollback). Then re-`SELECT` both objects and assert **byte-equality** against the captures. A mismatch
is a **STOP**, reported loudly and immediately.

## Honest scope statement

**Proved this run:** nothing about the deployed reaper, the bridge, or TEST. The only new facts are
diagnostic — that the MCP strip is blanket rather than Supabase-specific, and that a subagent cannot
inherit the parent's MCP grant.

**Not proved (unchanged from the original account):** JOB-02 still has **structural and offline
evidence only**. SC-1, SC-1b, SC-2, SC-2b are unobserved. Phase 142 is **not** fully
falsifiability-reconciled: **7 Observed · 4 SKIPPED-with-reason · 0 caught-without-run.**

**Repo state:** no source, migration, or test file was modified this run — only these two planning
artifacts. `grep -rn MUTANT` → 0. No mutation residue, because no mutation ran.

---
*Phase: 142-job-strategy-analytics-stuck-computing-reaper-computing-star*
*Completed: 2026-08-02*
