---
phase: 142-job-strategy-analytics-stuck-computing-reaper-computing-star
verified: 2026-08-02T14:00:53Z
status: gaps_found
score: 9/10 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: none
  previous_score: none
  note: "First verification of this phase. It was executed with --no-transition and hand-driven wave orchestration; no verifier had run on it before."
gaps:
  - truth: "A migration that changes a SQL function body ships with the regenerated canonical function snapshot (repo convention, CONTRIBUTING.md:89 + README.md:113, enforced by the blocking 'SQL Function Snapshot — Drift Gate' workflow)"
    status: failed
    reason: "Migration 20260802120000 re-bases sync_strategy_analytics_status but supabase/schema/functions/sync_strategy_analytics_status.sql was never regenerated. VERIFIED BY EXECUTION: `npx tsx scripts/dump-sql-functions.ts --check` exits 1 with 'stale: supabase/schema/functions/sync_strategy_analytics_status.sql'. The snapshot still carries the 20260710150000 body, i.e. the repo's declared canonical body of this function shows the PRE-142 definition with no computing_started_at maintenance at all — exactly the stale-body class (G23-187) that this gate was created to prevent. The next author who re-bases this function from the snapshot silently reverts the entire JOB-01 stamp semantics. Two sibling migrations on this same branch DID regenerate their snapshots (supabase/schema/functions/finalize_csv_strategy.sql is in the branch diff), so this is an omission by phase 142 specifically, not a repo-wide lapse."
    artifacts:
      - path: "supabase/schema/functions/sync_strategy_analytics_status.sql"
        issue: "Stale — header says 'source migration: 20260710150000_sync_status_supersede_failed_per_kind.sql'; missing the branch-(a) three-arm computing_started_at CASE and the branch (b)/(c) NULL clears."
    missing:
      - "Run `npm run schema:functions` and commit the regenerated supabase/schema/functions/sync_strategy_analytics_status.sql"
      - "Re-run `npx tsx scripts/dump-sql-functions.ts --check` and confirm exit 0"
  - truth: "The 'never advance an existing computing_started_at' invariant holds ACROSS ALL WRITERS, not only in the SQL bridge"
    status: partial
    reason: "The SQL bridge enforces it (Arm 3) and is falsifiable. The Python writer does NOT. analytics-service/services/analytics_runner.py:1227-1242 (_mark_computing) writes computing_started_at = datetime.now(timezone.utc).isoformat() unconditionally, and its inline comment at :1236-1237 asserts 'Unconditional here is correct — every invocation of this writer genuinely transitions the row INTO computing.' That claim is FALSE on the only live caller: run_csv_strategy_analytics is reached exclusively from the compute_analytics_from_csv job handler (job_worker.py:1997-1999), which is the LAST hop of process_key_long -> sync_trades -> derive_broker_dailies -> compute_analytics_from_csv. By then the row has been at computation_status='computing' since hop 1 and the bridge's Arm 3 deliberately KEPT the hop-1 stamp across hops 2 and 3. The Python writer then advances it anyway. NO gate anywhere can fail on this: tests/test_computing_started_at_stamp.py:446-454 only asserts the key is present and not None for an entry write; supabase/tests/test_strategy_analytics_stuck_computing_reaper.sql Part 4 drives only the SQL RPCs; the migration's STEP 7 negative anchor inspects pg_get_functiondef of the SQL bridge only. NOTE ON SCOPE: this does NOT falsify ROADMAP SC-2, whose clause is 'set in the SAME statement that sets computation_status=computing' — both writers do co-locate the stamp in one statement. What it invalidates is (a) the migration's own CADENCE HONESTY claim at lines 32-36 that worst case end-to-end is '~= threshold + 15 min (~16h15m)' — the shipped code produces ~25.8h, and ~28h across the 3 retries — and (b) the premise of TestReaperThresholdInvariant, which derives 16h > 12.2h on the assumption that the stamp measures the WHOLE chain. Direction is conservative (later, never earlier), so it cannot mis-reap a healthy chain; the cost is user-visible spinner duration ~1.75x the advertised bound."
    artifacts:
      - path: "analytics-service/services/analytics_runner.py"
        issue: ":1238 unconditional stamp; :1236-1237 comment states a false premise about the caller"
      - path: "supabase/migrations/20260802120000_strategy_analytics_stuck_computing_reaper.sql"
        issue: ":32-36 CADENCE HONESTY block states a ~16h15m worst case the shipped code does not produce"
      - path: "analytics-service/tests/test_computing_started_at_stamp.py"
        issue: ":446-454 the entry rule accepts any non-None stamp expression — it structurally cannot detect an advance"
    missing:
      - "Either: make _mark_computing stamp only on the transition in (a second .update(...).eq(strategy_id).is_('computing_started_at','null') call preserves the NULL-stamp closure without advancing an existing stamp), OR correct the migration's ~16h15m claim and TestReaperThresholdInvariant's docstring to state the real bound"
      - "A gate that can fail on a Python re-advance — the current Python gate provably cannot"
  - truth: "A 'computing' row with a NULL computing_started_at is detectable by something this phase ships"
    status: failed
    reason: "The reaper's `computing_started_at IS NOT NULL` conjunct (migration :514) makes a NULL-stamp computing row permanently invisible. The migration argues at :103-107 and :165-168 that 'Detection of that writer bug is the STATIC CI stamp invariant, not a runtime alert'. That argument does not hold: a static source scan detects source omissions in two scanned surfaces; it detects nothing about rows that already exist in the database. Concrete producer with no source bug at all: merging supabase/migrations/** auto-applies to PROD, but the Railway worker only redeploys after main CI is green — during that window the OLD _mark_computing runs against the NEW schema, and when compute_analytics_from_csv is the FIRST job for a strategy (no prior bridge call) it leaves (computing, NULL). The STEP 2 backfill covers only rows already computing AT APPLY TIME. Verified by execution: I ran the real deployed cron body against Postgres 16 with a NULL-stamp computing row present — it was neither reaped nor mutated, and produced no signal. For that subset the permanent-spinner class the phase exists to close remains fully open, silently."
    artifacts:
      - path: "supabase/migrations/20260802120000_strategy_analytics_stuck_computing_reaper.sql"
        issue: ":514 IS NOT NULL conjunct with no companion arm; :103-107 and :165-168 claim a detection mechanism that structurally cannot detect rows"
    missing:
      - "Either a non-destructive companion arm in the same cron body that STARTS the clock on (computing, NULL, no-active-job) rows, or removal of the claim that the static CI gate is the detection mechanism for this state plus a named backlog item"
  - truth: "The SQL gate cannot redden an innocent PR on the shared TEST project"
    status: partial
    reason: "supabase/tests/test_strategy_analytics_stuck_computing_reaper.sql:340-343 performs the only UNSCOPED write in supabase/tests/: `UPDATE public.strategy_analytics SET computing_started_at = NULL WHERE computation_status='computing' AND strategy_id <> ALL (v_seeded)`. Every other assertion in this file and in the sibling gates is scoped to its own seeded id set. The sql-tests job in .github/workflows/ci.yml:830 carries NO concurrency group, while the python job carries one explicitly because the TEST project qmnijlgmdhviwzwfyzlc is shared across concurrent runs. Two concurrent PR runs can therefore collide on a committed 'computing' row, hit SET LOCAL lock_timeout='5s', and raise 55P03 on an innocent PR. This is the repo's known shared-test-DB flake class ([[project_shared_testdb_concurrent_ci_flake]], [[project_e2e_seeded_shared_db_pollution_global_emptystate]])."
    artifacts:
      - path: "supabase/tests/test_strategy_analytics_stuck_computing_reaper.sql"
        issue: ":340-343 unscoped cross-tenant UPDATE inside the rollback"
      - path: ".github/workflows/ci.yml"
        issue: ":830 sql-tests job has no concurrency: group despite writing to the shared TEST project"
    missing:
      - "Add `concurrency: {group: shared-test-supabase-sql, cancel-in-progress: false}` to the sql-tests job"
      - "Optionally narrow the neutralization to `AND computing_started_at < now() - interval '16 hours'` — the only subset that can consume the LIMIT 25 budget"
  - truth: "The JOB_CHAIN_FOLLOW_ON rewire did not move raising code outside a guard whose comment forbids it"
    status: failed
    reason: "analytics-service/services/ingestion/long_fetch.py:588-592 performs a dict lookup and a FIXED-ARITY 2-tuple unpack (`ledger_tail, trade_tail = JOB_CHAIN_FOLLOW_ON['process_key_long']`) ABOVE the try: at :599, whose own comment states 'therefore we must NOT let an enqueue blip crash the handler.' The replaced code was a self-contained conditional expression that could not raise. Adding a third follow-on edge to process_key_long — a natural edit the constant's docstring invites, and one that TestReaperThresholdInvariant's 'Coverage (i)' does NOT catch because it only checks membership in TIMEOUT_PER_KIND, never arity — raises ValueError outside the guard, propagating out of run_process_key_long_job. Because the verification is already 'published' the worker retry short-circuits on the idempotency check and never re-runs the tail, so the strategy is left published with NO analytics chain enqueued and no strategy_analytics write at all — strictly worse than the enqueue blip the guard was written for."
    artifacts:
      - path: "analytics-service/services/ingestion/long_fetch.py"
        issue: ":588-592 lookup + fixed-arity unpack sit outside the try: at :599"
    missing:
      - "Move the import + lookup inside the try: block and index explicitly (`_tails[0] if is_ledger_backed else _tails[1]`) instead of a fixed-arity unpack"
  - truth: "The phase's own Falsifiability Ledger contract is discharged — every row Observed with pasted evidence, or explicitly marked skipped-with-reason"
    status: partial
    reason: "142-VALIDATION.md leaves 7 of 11 ledger rows at '⬜ pending' with empty Evidence: SC-3, SC-3b, SC-4, SC-4b, SC-5, SC-5b, SC-5c. All seven are cheap, local, no-DB mutations; none was blocked by the MCP-strip that legitimately deferred SC-1/1b/2/2b. The file's own rule reads 'Observed means run. The test covers it is not evidence.' Its frontmatter still reads status: planned, wave_0_complete: false, and 'Approval: pending', and every Validation Sign-Off checkbox is unchecked. I closed all seven independently during this verification (evidence in the Behavioral Spot-Checks table below), so the capability is real and the gates do fail — the ARTIFACT is stale, not the code."
    artifacts:
      - path: ".planning/phases/142-job-strategy-analytics-stuck-computing-reaper-computing-star/142-VALIDATION.md"
        issue: "7 of 11 ledger rows unobserved; frontmatter and sign-off block never updated after execution"
    missing:
      - "Backfill the 7 pending ledger rows with the observations recorded in this VERIFICATION.md, and update the frontmatter + sign-off block"
  - truth: "REQUIREMENTS.md JOB-03 states a derivation the phase can actually satisfy"
    status: partial
    reason: "REQUIREMENTS.md:53 defines JOB-03 as 'derived from strategy_analytics's own batch-tail math (`batch_size × max_per_kind_timeout`)'. Research collision C-6 established — and the shipped code agrees — that `batch_size × max_per_kind_timeout` IS the compute_jobs formula, copied verbatim from 20260720120000:24-25, and that re-applying it under-counts a multi-hop chain by ~4x (it yields 2.5h against a 12.2h chain ceiling, which would reap healthy in-flight chains). The phase correctly refused it and derived a chain-inclusive ceiling instead. ROADMAP SC-3 does not carry the bad formula, so the phase satisfies its ROADMAP contract; but REQUIREMENTS.md still instructs future readers to use a formula this phase proved would mis-reap live money-path rows."
    artifacts:
      - path: ".planning/REQUIREMENTS.md"
        issue: ":53 JOB-03 parenthetical names the compute_jobs formula as the required derivation"
    missing:
      - "Correct REQUIREMENTS.md:53 to name the chain-inclusive derivation, citing C-6, so 143/144/145 do not re-import the wrong formula"
human_verification:
  - test: "Run the 637-line SQL gate end-to-end against the TEST project: `psql \"$TEST_SUPABASE_DB_URL\" -v ON_ERROR_STOP=1 -f supabase/tests/test_strategy_analytics_stuck_computing_reaper.sql`"
    expected: "Exit 0, with NOTICEs from Parts 1-5. Parts 2/3 must NOT print 'SKIP ... pg_cron not installed' against TEST — a skip there means the gate is a no-op on the only project it is trusted on."
    why_human: "No TEST_SUPABASE_DB_URL and no Supabase MCP in this runtime (MCP tools are stripped from subagents). The gate file has NEVER been run end-to-end against the real schema by anyone: 142-05 recorded it SKIPPED, and the orchestrator's DEPLOYED-RUN section explicitly states 'They are not a run of the 637-line gate file end-to-end — that remains CI's job.' I proved the file compiles (all 5 DO blocks, zero syntax errors) and that Parts 1/4/5 redden loudly on an unapplied schema, but Parts 2-5 need auth.users, public.profiles, the real compute_jobs constraints and the real mark_compute_job_done/_failed RPCs."
  - test: "Confirm the reaper cron is registered and active on TEST: `SELECT jobname, schedule, active FROM cron.job WHERE jobname='reap_strategy_analytics_stuck_computing';` and that migration 20260802120000 (or its MCP-recorded twin 20260802111053) is in supabase_migrations.schema_migrations"
    expected: "One row, schedule '*/15 * * * *', active = true"
    why_human: "Requires DB access. The ledger's DEPLOYED-RUN records this as done on 2026-08-02, but the version was stamped 20260802111053 (MCP now()) rather than the filename's 20260802120000 — worth re-confirming before merge, since PROD auto-applies the FILE timestamp on merge."
  - test: "PROD backfill safety census (VALIDATION.md Manual-Only row 2): read-only `SELECT count(*) FROM strategy_analytics WHERE computation_status='computing'` on PROD (khslejtfbuezsmvmtsdn) immediately before merge"
    expected: "0 rows, matching the migration header's authoring-time census at lines 92-101. A non-zero count means the one-shot computed_at backfill will actually stamp live rows and its anchor semantics need a second look before merge."
    why_human: "Read-only DB access; the header itself says 'Re-run the census before merge; the number above is a snapshot, not a guarantee.'"
  - test: "Live render of a reaped row (VALIDATION.md Manual-Only row 1): on TEST, strand a strategy_analytics row (computing, computing_started_at 20h old, no compute_jobs row), let the reaper tick, then reload the wizard"
    expected: "The GATE_ANALYTICS_FAILED panel renders with a working Retry button and a 'Details: Analytics was interrupted before it could finish and did not recover. Retry the sync.' line that does not re-attribute fault"
    why_human: "Requires a live browser session plus a real stranded row. I verified the full source path (poller reads computation_status+computation_error -> onTerminal -> setErrorCode('GATE_ANALYTICS_FAILED') -> formatKeyError appends the Details line -> actions include clear_and_retry -> kickoffRetryCanChangeTheOutcome true -> onRetry passed), but the rendered result is a visual claim."
---

# Phase 142: JOB — strategy_analytics stuck-computing reaper + computing_started_at DDL — Verification Report

**Phase Goal:** "A mid-job worker crash can no longer strand a `strategy_analytics` row on `computing` forever — a wizard poll or page refresh sees a real terminal outcome"
**Verified:** 2026-08-02T14:00:53Z
**Status:** gaps_found
**Re-verification:** No — initial verification (phase was executed with `--no-transition`; no verifier had run on it)

## Method note

I did not accept any SUMMARY.md claim. Every conclusion below is re-derived from source, and where a claim was behavioural I **executed** it: I stood up a throwaway PostgreSQL 16 cluster, extracted the real `$cron$` body and the real re-based `sync_strategy_analytics_status` from the migration file, and ran them against a minimal schema. I also re-ran all seven mutations the phase's own Falsifiability Ledger left `⬜ pending`, applying each to a **copy** in a temp tree — no repo file was modified at any point (`git status` shows only pre-existing dirty planning files).

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | **ROADMAP SC-1** — a `strategy_analytics` row stuck `computing` past the threshold with NO active `compute_jobs` row is transitioned by a recurring pg_cron reaper to a TERMINAL `failed` carrying a user-recoverable message, superseding `reset_stuck_computing_rows.py` | ✓ VERIFIED | `cron.schedule('reap_strategy_analytics_stuck_computing','*/15 * * * *', …)` at migration :501-528. **Executed the real body against Postgres 16**: stranded row → `computation_status='failed'`, `computation_warned=FALSE`, `computation_error='Analytics was interrupted before it could finish and did not recover. Retry the sync.'`, `computing_started_at IS NULL` — all four columns, exactly as specified. Message reaches the user: `useStrategySyncPoller.ts:229-233` reads status+error → `SyncPreviewStep.tsx:901` sets `GATE_ANALYTICS_FAILED` → `wizardErrors.ts:1457-1463` appends `Details: {computation_error}` → `wizardErrors.ts:672` actions include `clear_and_retry` → `SyncPreviewStep.tsx:1655,1679` passes `onRetry`. Script deleted (`ls` confirms absent) with a stays-absent gate. |
| 2 | **ROADMAP SC-2** — fresh `computed_at` + old `computing_started_at` IS reaped; old `computed_at` + fresh `computing_started_at` is NOT; the reaper keys on the writer-stamped column set in the SAME statement, never `computed_at`/`updated_at` | ✓ VERIFIED (see gap 2 for a scoped caveat) | **Executed both directions against Postgres 16 using the real deployed body**: arm A (`computed_at=now()`, stamp 20h old) → `failed`; arm B (`computed_at` 100 days old, stamp 5 min old) → `computing`. Body never mentions `computed_at`/`updated_at` (migration :505-526; pinned at source-text level by `TestReaperThresholdDriftGate::test_cron_body_never_keys_on_computed_at`). Confirmed independently that `strategy_analytics` has **no** `updated_at` column (20260405061911:70-96 + no later ADD COLUMN), so research C-1 is correct and the directional tests correctly read against `computed_at`. Both writers co-locate the stamp in one statement: SQL bridge :312-341 (INSERT…VALUES + ON CONFLICT three-arm CASE) and `analytics_runner.py:1228-1241` (one upsert payload). |
| 3 | **ROADMAP SC-3** — a CI invariant beside `test_every_kind_has_watchdog_headroom` fails when a handler's batch-inclusive worst case exceeds the threshold; the threshold is re-derived from `strategy_analytics`'s own batch-tail math, never the `compute_jobs` 4h number | ✓ VERIFIED | `TestReaperThresholdInvariant` at `test_main_worker.py:1212`, immediately after `TestWatchdogInvariant`. Ceiling computed live = **43,920 s (12.20 h)** on `process_key_long → sync_trades → derive_broker_dailies → compute_analytics_from_csv`; threshold `'16 hours'` = 57,600 s (1.31x). Derivation is per-hop `(batch-1)×max_handler + handler×attempts + backoff` — **not** `batch_size × max_per_kind_timeout`. The three oracle inputs are local literals and I verified each against production: `p_batch_size: 5` (`main_worker.py:470,511`), `max_attempts` default 3 (`job_worker.py:8237`), backoff 30s/2min/8min (`20260505115047:180-182`). Topology constant is load-bearing — read at `job_worker.py:1907`, `job_worker.py:4943`, `long_fetch.py:591`. |
| 4 | **ROADMAP SC-4** — a large synthetic backlog does not stall worker `healthz` past `STALE_THRESHOLD`; a JOB-07 regression test proves no reaper/sweep work runs on the worker's shared asyncio event loop | ✓ VERIFIED | `test_job07_reaper_off_worker_loop.py` (596 lines). Structural absence gate + scanner self-test + a blocking/yielding **control pair** driven through one shared driver differing in exactly one token, plus a forced-stale 503 proof. All 8 tests pass. The file's own docstring correctly states that the naive backlog-only form cannot fail and must not be cited as evidence — the teeth are the structural gate and the control pair, both of which I independently made go RED. |
| 5 | The broken one-off `scripts/reset_stuck_computing_rows.py` (42703 on a non-existent `updated_at`) is DELETED with a resurrection gate | ✓ VERIFIED | File absent; `test_superseded_one_off_stays_deleted` passes and I made it RED by planting the file in a temp tree. |
| 6 | Every exit from `computing` clears the stamp to NULL across all 17 application+SQL sites (11 Python + 2 SQL + 4 TS) | ✓ VERIFIED | `test_computing_started_at_stamp.py` passes with exact anti-vacuity counts (12 status dicts = 1 entry + 11 exits; 6 runner / 6 worker; 2 via the n1 Name arm; 1 via the n2 parameter-default arm; exactly 1 `'computing'` literal). TS: 4 payload keys across 3 route files, all carrying `computing_started_at: null`. SQL branches (b)/(c) clear — **executed and confirmed** on Postgres 16. |
| 7 | `sync_strategy_analytics_status` is re-based on the true latest definition with F-3/PUB-02 and SI-02 anchors intact and the stamp as the ONLY semantic delta | ✓ VERIFIED | Independently confirmed 20260710150000 is the last of the four defining migrations (grep across all 231). Programmatic diff of the two function bodies: the only changes are the stamp maintenance plus one comment back-reference. `d.kind = f.kind`, `d.created_at > f.created_at`, both `computation_warned` marker reads, SECURITY DEFINER, `SET search_path`, and `REVOKE ALL` all survive. |
| 8 | The SQL gate `EXECUTE`s the REAL deployed `cron.job.command` and reddens — never green-skips — when the migration is unapplied | ✓ VERIFIED (structure); end-to-end run routed to human | `EXECUTE v_command` at :346, :449, :471 after `SELECT command INTO v_command FROM cron.job`. Part 1 is ungated with no `RETURN`. Ran the file against an empty Postgres 16: **all five DO blocks compile with zero syntax errors**, Part 1 fails loudly with `relation "public.strategy_analytics" does not exist`, Parts 4/5 fail loudly on `auth.users`, and only Parts 2/3 take the single documented pg_cron skip. Auto-discovered by CI (`ci.yml:959` globs `supabase/tests/test_*.sql`). |
| 9 | `StrategyAnalytics` carries `computing_started_at: string \| null` (required, never optional) and the whole blast radius compiles | ✓ VERIFIED | `src/lib/types.ts:296`; `src/lib/utils.ts:182` `EMPTY_ANALYTICS`; 7 fixture files. `npm run typecheck` exits 0. All 7 blast-radius vitest files pass (74 tests). `grep -cF 'computing_started_at?'` = 0. |
| 10 | A migration that changes a SQL function body ships with the regenerated canonical function snapshot (repo convention + blocking drift gate) | ✗ FAILED | `npx tsx scripts/dump-sql-functions.ts --check` → **exit 1**, "stale: supabase/schema/functions/sync_strategy_analytics_status.sql". See gap 1. |

**Score:** 9/10 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/migrations/20260802120000_strategy_analytics_stuck_computing_reaper.sql` | DDL + backfill + partial index + re-based bridge + cron.schedule + self-verify | ✓ VERIFIED | 690 lines; 4 self-verify DO blocks; body executed and behaviourally correct |
| `supabase/tests/test_strategy_analytics_stuck_computing_reaper.sql` | 5-part gate, ungated Part 1, `EXECUTE`-the-deployed-body oracle | ✓ VERIFIED (compiles + reddens; end-to-end run pending) | 637 lines; zero syntax errors; single documented skip |
| `analytics-service/services/job_worker.py` | `JOB_CHAIN_FOLLOW_ON` + `STRATEGY_ANALYTICS_REAP_THRESHOLD` beside `TIMEOUT_PER_KIND` | ✓ VERIFIED | :509-517, :540; read at :1907, :4943 |
| `analytics-service/services/ingestion/long_fetch.py` | tail selection reads the topology | ⚠️ WIRED but fragile | :588-592 reads it, but outside the guard (gap 5) |
| `analytics-service/services/analytics_runner.py` | stamp at entry; clear at 5 exits | ⚠️ PRESENT, semantics diverge | :1238 stamps unconditionally (gap 2) |
| `analytics-service/tests/test_computing_started_at_stamp.py` | two-runtime stamp/clear invariant | ✓ VERIFIED | 786 lines; 4 tests; RED under all 4 mutations I applied |
| `analytics-service/tests/test_job07_reaper_off_worker_loop.py` | JOB-07 structural + behavioural + controls | ✓ VERIFIED | 596 lines; ≥120 min_lines met; 8 tests pass |
| `analytics-service/tests/test_main_worker.py` | `TestReaperThresholdInvariant` + `TestReaperThresholdDriftGate` | ✓ VERIFIED | :1212, :2220 |
| `src/lib/types.ts`, `src/lib/utils.ts` + 7 fixtures | required field propagated | ✓ VERIFIED | typecheck 0; 74 tests pass |
| `supabase/schema/functions/sync_strategy_analytics_status.sql` | regenerated canonical body | ✗ MISSING (stale) | drift gate exits 1 |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `long_fetch.py:591` | `job_worker.JOB_CHAIN_FOLLOW_ON` | function-scoped import | ✓ WIRED | real tail selection, not decorative |
| `job_worker.py:1907`, `:4943` | `JOB_CHAIN_FOLLOW_ON` | enqueue kind lookup | ✓ WIRED | drives `enqueue_compute_job` |
| migration `$cron$` body | `job_worker.STRATEGY_ANALYTICS_REAP_THRESHOLD` | embedded literal + drift gate | ✓ WIRED | RED under literal change and under conjunct deletion |
| cron body | `public.compute_jobs` non-terminal set | `NOT EXISTS` with the byte-identical branch-(a) status list | ✓ WIRED | executed: active-job row survives |
| `analytics_runner._mark_computing` | `strategy_analytics.computing_started_at` | upsert payload key | ⚠️ WIRED, wrong condition | advances an existing stamp (gap 2) |
| reaper `failed` + `computation_error` | wizard retry panel | poller → `SyncPreviewStep` → `wizardErrors` | ✓ WIRED | already-shipped affordance verified, not rebuilt |
| migration function body | `supabase/schema/functions/` snapshot | `npm run schema:functions` | ✗ NOT WIRED | never regenerated (gap 1) |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| pg_cron reaper body | `computing_started_at` | writer-stamped by the SQL bridge and `_mark_computing` | Yes — both writers observed populating it | ✓ FLOWING |
| `SyncPreviewStep` gate panel | `computation_error` | reaper's fixed literal → poller → `formatKeyError` context | Yes — non-empty literal, rendered as `Details:` | ✓ FLOWING |
| `TestReaperThresholdInvariant` | `ceiling_s` | walk over `JOB_CHAIN_FOLLOW_ON` × `TIMEOUT_PER_KIND` | Yes — 43,920 s, non-degenerate, inside the pinned 6-24 h band | ✓ FLOWING |
| `StrategyAnalytics.computing_started_at` (TS) | row field | Supabase row | Type-only; no TS consumer reads it yet | ⚠️ STATIC by design (142-06 scope was the type + fixtures) |

### Behavioral Spot-Checks

All commands run by me during this verification. The seven rows marked **[ledger row closed]** correspond to Falsifiability Ledger entries left `⬜ pending` by execution.

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Phase's own Python suites | `pytest tests/test_computing_started_at_stamp.py tests/test_job07_reaper_off_worker_loop.py -k Reaper …` | 18 passed | ✓ PASS |
| Whole analytics suite (no regression from the topology rewire) | `cd analytics-service && pytest -q` | 4842 passed, 96 skipped | ✓ PASS |
| CI-gated type gate | `mypy --strict --follow-imports=silent services/ routers/ models/` | Success, 89 files | ✓ PASS |
| Frontend types | `npm run typecheck` | exit 0 | ✓ PASS |
| Blast-radius fixtures | `vitest run` on the 7 plan-06 files | 7 files, 74 tests passed | ✓ PASS |
| DB↔Zod closed-set parity | `vitest run src/__tests__/contracts/check-zod-db-check-parity.test.ts` | 19 passed | ✓ PASS |
| Lint on changed TS | `npx eslint` on the 5 changed src files | clean | ✓ PASS |
| **Real cron body, 4 directional arms** | extracted `$cron$` body → Postgres 16 minimal schema | stranded→`failed`/`warned=f`/message/stamp NULL; fresh-stamp kept; NULL-stamp kept **and unmutated**; active-job kept | ✓ PASS |
| **SC-2 direction A** | fresh `computed_at` + 20h-old stamp | → `failed` | ✓ PASS |
| **SC-2 direction B** | 100-day-old `computed_at` + 5-min-old stamp | → `computing` | ✓ PASS |
| **LIMIT-25 bound + drain** | 26 stranded rows, body run twice | tick 1 → `UPDATE 25` (25 failed / 1 computing); tick 2 → `UPDATE 1` (26 failed) | ✓ PASS |
| **Bridge Arm 2** (transition in stamps) | real function body on Postgres 16 | `computing`, stamp non-NULL | ✓ PASS |
| **Bridge Arm 3** (no advance) | fixed sentinel `2020-01-02 03:04:05.678901+00`, second bridge call while computing | sentinel **kept** | ✓ PASS |
| **Bridge Arm 1** (cww exit clears) | `computation_warned=true`, bridge call | → `complete_with_warnings`, stamp NULL | ✓ PASS |
| **Bridge branch (b)/(c) clears** | failed_final / all-done | → `failed`+error / `complete`, stamp NULL both | ✓ PASS |
| **SC-2b mutation** (C-3 trap) | CASE → unconditional `now()`, same driver | sentinel **lost** (advanced) AND cww exit no longer clears ⇒ RED | ✓ PASS (falsifiable) |
| SQL gate compiles / reddens unapplied | `psql -f test_strategy_analytics_stuck_computing_reaper.sql` on empty DB | all 5 DO blocks compile; Part 1 RED on missing relation | ✓ PASS |
| **[ledger row closed] SC-3** | threshold ÷ 10 → 5,760 s vs 43,920 s ceiling | headroom assert False ⇒ RED | ✓ PASS |
| **[ledger row closed] SC-3 upper** | threshold × 10 → ratio 13.11x vs cap 2.0 | upper-bound assert False ⇒ RED | ✓ PASS |
| **[ledger row closed] SC-3b** | migration literal `16 hours`→`4 hours` (temp copy) | drift gate RED, names both sides | ✓ PASS |
| **[ledger row closed] SC-3b-b** | delete the threshold conjunct entirely | "carries NO interval literal at all" ⇒ RED | ✓ PASS |
| **[ledger row closed] SC-4** | plant the cron jobname in a copy of `main_worker.py` | structural gate RED with file:line | ✓ PASS |
| **[ledger row closed] SC-4 (script)** | recreate `scripts/reset_stuck_computing_rows.py` in a copy | stays-deleted gate RED | ✓ PASS |
| **[ledger row closed] SC-4b** | blocking vs yielding control pair | both arms pass as designed (blocking arm asserts starvation) | ✓ PASS |
| **[ledger row closed] SC-5** | delete the stamp key from `_mark_computing` (copy) | "do NOT co-locate computing_started_at" ⇒ RED | ✓ PASS |
| **[ledger row closed] SC-5 variant** | set the entry stamp to `None` (copy) | "carry computing_started_at with the WRONG value" ⇒ RED | ✓ PASS |
| **[ledger row closed] SC-5b** | delete the clear at `job_worker.py:6704` (copy) | RED via the n1 Name-resolution arm | ✓ PASS |
| **[ledger row closed] SC-5c** | delete `computing_started_at: null` from `keys/sync/route.ts` (copy) | TS half RED, Python half stays green | ✓ PASS |
| **SQL function snapshot drift** | `npx tsx scripts/dump-sql-functions.ts --check` | **exit 1 — stale** | ✗ FAIL (gap 1) |

### Probe Execution

| Probe | Command | Result | Status |
|-------|---------|--------|--------|
| n/a | — | This repo has no `scripts/*/tests/probe-*.sh` convention and neither the PLANs nor the SUMMARYs declare one. | SKIPPED (no probes declared or discovered) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| JOB-01 | 142-03, 142-04, 142-06 | dedicated writer-stamped `computing_started_at`, set in the SAME statement as `computation_status='computing'` | ✓ SATISFIED (with gaps 2 + 3) | Column DDL (timestamptz, nullable, no default) + self-verify STEP 6; both writers co-locate; 17 exit clears; two-runtime CI gate. Deviation: the "never advance" half is Python-unenforced (gap 2); NULL-stamp rows undetectable (gap 3). |
| JOB-02 | 142-02, 142-04, 142-05 | recurring pg_cron reaper → terminal `failed` with a user-recoverable message; supersedes the one-off | ✓ SATISFIED | cron registered `*/15`; body executed with the exact four-column outcome; message renders with a working retry; script deleted + gated |
| JOB-03 | 142-01, 142-04 | threshold re-derived from `strategy_analytics`'s own math + a CI headroom invariant | ✓ SATISFIED (REQUIREMENTS text needs correction — gap 7) | 43,920 s ceiling, 16 h threshold, invariant + drift gate, both falsified by me |
| JOB-07 | 142-02 | no reaper/sweep work on the worker's shared asyncio loop; regression test | ✓ SATISFIED | structural gate + scanner self-test + blocking/yielding control pair; pg_cron satisfies the property by construction |

**Orphaned requirements:** none. REQUIREMENTS.md:268-274 maps exactly JOB-01/02/03/07 to Phase 142, and all four appear in plan frontmatter. JOB-04/05/06 are correctly mapped to Phases 143/144/145 and were held out of scope by 142-CONTEXT.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | `TODO`/`FIXME`/`XXX`/`TBD`/`HACK` in the phase diff | ℹ️ Info | **Zero.** The only match across the entire non-planning diff is the word "PLACEHOLDER" inside a comment describing terminal-`failed` *placeholder rows* — domain vocabulary, not a debt marker. Debt-marker gate: PASS. |
| `analytics-service/services/analytics_runner.py` | 1236-1237 | Comment asserts a false premise about its own caller | ⚠️ Warning | The comment justifies the unconditional stamp with a claim the call graph contradicts (gap 2). A future reader will trust it. |
| `supabase/migrations/20260802120000_…sql` | 32-36 | "CADENCE HONESTY" block states a worst case the code does not produce | ⚠️ Warning | ~16h15m advertised vs ~25.8-28h actual (gap 2). |
| `supabase/migrations/20260802120000_…sql` | 103-107, 165-168 | Names a detection mechanism that structurally cannot detect the state | ⚠️ Warning | A source scan cannot see DB rows (gap 3). |
| `analytics-service/services/ingestion/long_fetch.py` | 588-592 | Raising code hoisted outside a guard whose comment forbids it | ⚠️ Warning | Latent; requires a topology edit (gap 5). |

### Deferred Items

None. I checked the later phases of this milestone (143 JOB-04 dropped-enqueue re-enqueue, 144 JOB-05 `compute_jobs` orphaned-running, 145 JOB-06 csv-finalize atomicity, 146 RATE) against each gap above. None of them covers the SQL-function-snapshot regeneration, the Python re-stamp, the NULL-stamp blind spot, the `sql-tests` concurrency group, or the `long_fetch` unpack. Phase 144 is explicitly the *generator* of the reapable condition, not a fix for any of these; 142-CONTEXT §Known coupling states the reaper remains required after 144 lands. All seven gaps are genuinely Phase-142.1 work.

### Human Verification Required

See the `human_verification` block in frontmatter. Summary:

#### 1. Run the SQL gate end-to-end against TEST
**Test:** `psql "$TEST_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/test_strategy_analytics_stuck_computing_reaper.sql`
**Expected:** exit 0, Parts 1-5 NOTICEs, and Parts 2/3 must **not** print the pg_cron skip.
**Why human:** No DB route in this runtime (MCP stripped from subagents; `TEST_SUPABASE_DB_URL` unset; the CLI is linked to PROD). The 637-line file has never been executed end-to-end by anyone — 142-05 recorded it SKIPPED and the orchestrator's DEPLOYED-RUN section says so explicitly.

#### 2. Confirm the reaper is registered and active on TEST
**Test:** `SELECT jobname, schedule, active FROM cron.job WHERE jobname='reap_strategy_analytics_stuck_computing';`
**Expected:** one row, `*/15 * * * *`, `active = true`.
**Why human:** DB access. Also re-confirm the recorded migration version — MCP stamped `20260802111053`, the file is `20260802120000`.

#### 3. PROD backfill census before merge
**Test:** read-only `SELECT count(*) FROM strategy_analytics WHERE computation_status='computing'` on `khslejtfbuezsmvmtsdn`.
**Expected:** 0, matching the header's authoring-time census.
**Why human:** DB access; the header itself demands a re-run before merge.

#### 4. Live render of a reaped row
**Test:** strand a row on TEST, let the reaper tick, reload the wizard.
**Expected:** `GATE_ANALYTICS_FAILED` panel with a working Retry and the `Details:` line.
**Why human:** visual claim; the source path is fully verified but the render is not.

### Gaps Summary

**The phase goal is achieved.** A mid-job worker crash can no longer strand a `strategy_analytics` row on `computing` forever: I executed the real deployed reaper body against a real PostgreSQL 16 and watched a stranded row transition to a terminal `failed` with `computation_warned=FALSE`, the shipped user-recoverable message, and a cleared stamp — while a fresh-stamp row, a NULL-stamp row and a row with an active `compute_jobs` row all correctly survived. The message reaches the user through an already-shipped, verified-not-rebuilt retry affordance. All four ROADMAP success criteria hold, and I independently falsified every gate the phase ships, including the seven mutations its own ledger left unobserved.

Seven gaps remain, none of which falsifies a ROADMAP criterion, but one of which is a deterministic red build.

**The blocker is gap 1, and it is trivially fixable.** Migration 20260802120000 re-bases `sync_strategy_analytics_status` but nobody ran `npm run schema:functions`. `npx tsx scripts/dump-sql-functions.ts --check` exits 1. Beyond the red gate, the consequence is exactly the failure class that gate exists to prevent: `supabase/schema/functions/sync_strategy_analytics_status.sql` — which CONTRIBUTING.md declares "the canonical current body" — currently shows the **pre-142** definition, with no `computing_started_at` maintenance at all. The next author who re-bases this function from the snapshot silently reverts every JOB-01 guarantee this phase built. Two sibling migrations on the same branch regenerated their snapshots, so this is a 142-specific omission.

**On SC-2, stated plainly, as asked.** The clause "set in the SAME statement that sets `computation_status='computing'`" **is** satisfied across all writers — the SQL bridge (migration :312-341) and `_mark_computing` (`analytics_runner.py:1228-1241`) both co-locate the stamp in a single statement, and both SC-2 directional tests hold behaviourally (I ran them). What is **not** satisfied across all writers is the stronger property the phase designed for the bridge and documented at length: *never advance a stamp on a row that is already `computing`*. That property is enforced and falsifiable in the SQL bridge only (Arm 3 — I proved both the keep and the mutant advance). `analytics_runner.py:1238` violates it unconditionally, on the last hop of every multi-hop chain, and its own comment at :1236-1237 justifies this with a claim about the call graph that is false — `run_csv_strategy_analytics` is reached only from the `compute_analytics_from_csv` handler (`job_worker.py:1997-1999`), by which time the row has been `computing` since hop 1. No gate in the repo can fail on this: the Python AST gate only checks presence-and-not-`None`; the SQL gate drives only the SQL RPCs; the migration's negative anchor reads only `pg_get_functiondef`. The blast radius is bounded and conservative — later, never earlier, so no healthy chain is mis-reaped — but it silently invalidates two shipped claims: the migration's "CADENCE HONESTY" `~16h15m` worst case (actual ~25.8h, ~28h across retries) and the premise under which `TestReaperThresholdInvariant` proves its headroom.

**Gap 3 is the one worth arguing about.** The reaper's `IS NOT NULL` skip is correct — destructively terminalizing a writer bug would be worse. But the migration then claims the static CI gate is the detection mechanism for that state, and it structurally is not: a source scan finds source omissions, never rows. The deploy-ordering window (migrations auto-apply to PROD; the Railway worker redeploys only after green `main` CI) produces `(computing, NULL)` with no source bug at all. For that subset the permanent-spinner class stays fully open with zero observability. Either add the non-destructive clock-start companion arm, or delete the claim and log it.

Gaps 4, 5, 6 and 7 are lower-severity: a shared-TEST-DB flake vector on an unscoped neutralization UPDATE with no `concurrency:` group on `sql-tests`; a fixed-arity tuple unpack hoisted outside a guard whose comment forbids exactly that; a Falsifiability Ledger left 7-of-11 unobserved with its sign-off block untouched (the code is fine — I closed all seven — the artifact is stale); and `REQUIREMENTS.md:53` still instructing future phases to use the `batch_size × max_per_kind_timeout` formula that this phase proved would reap healthy in-flight chains.

Gaps 2, 3, 4 and 5 correspond to WR-01..WR-04 in the independent `142-REVIEW.md`; I derived 2 and 5 before reading it and confirm all four against source. Gaps 1, 6 and 7 are additional and are not in that review.

---

_Verified: 2026-08-02T14:00:53Z_
_Verifier: Claude (gsd-verifier)_
