# SQL gate integrity — dated lineage (Phases 164.3 → 164.7)

Moved out of `CLAUDE.md` on 2026-09-08. **This file is HISTORY, not instructions.**

`CLAUDE.md` was carrying ~300 lines of dated `CURRENCY` paragraphs — 69% of the file, about
5,500 tokens loaded into every session — of which all but the last were superseded by
construction: each one says some version of *"every paragraph above stays as dated lineage;
this one is the current reading."*

⛔ **Every arm count, file count and run id below is a DATED READING, not a live constant.**
The live values are `export const FILES_FLOOR`, `export const ARMS_FLOOR` and
`export const WAIVED_CEILING` in `scripts/mutation-floors.mjs` (moved there from
`scripts/mutation-runner/run.mjs` on 2026-10-03, Phase 164.9.6 D-10). Read them by SYMBOL.

The `CORRECTION 2026-09-07` paragraph in here is the worked example of why: the prose said
`ARMS_FLOOR` 369 → 380 while the shipped constant was 384. The prose and the constant had
already diverged, inside the very file that warns against restating numbers in prose. That is
the argument for this split, in its own words.

Nothing here was deleted; it is also all in git history.

---

⚠️ `sql-mutation` and `sql-gate-lint` were first observed green on ubuntu on
2026-09-02 (workflow_dispatch run 33620169220 at 89cbef8b, self-test 12/12,
`arms: 30/30/0`, tallies agree — closes `.planning/WINDOWS.md` entry 28);
`plan-anchor-verify` was skipped in that run. ⚠️ CURRENCY 2026-09-03: that
`30/30/0` is the run-33620169220 quote and stays as lineage; so do plan 02's
`45/45/0`, plan 04's `86/86/0`, plan 05's `134/134/0` and plan 06's `163/163/0`
(the last two both confirmed on ubuntu — run 33785233457 at PR #735 head
`f0d19bf7`, 232 s, and run 33794810067 at PR #736 head `ba6fe1e2`, 278 s).
Plan 07's `189/189/0` at `files 17/71` also stays as lineage — and so does its
ubuntu wall clock, run 33804312706 at PR #737 head `4a9f33da`, **458 s**, which
is the one run that reported `per-arm lane time: mean 1.7s` where every other
ubuntu run and every local run measured 1.0 s. Plan 08's `219/219/0` at
`files 23/71` stays as lineage too. ⚠️ CURRENCY 2026-09-04: Phase 164.4 plan 09
then annotated five NEW gate files — the wizard-session tenant-scope index, the
wizard composite fence, the weight-snapshot seed SECDEF trigger, the
csv-finalize auth guard and the resync-retry single-job substrate —
5 + 5 + 4 + 3 + 3 = 20 sections, so the measured corpus is now
`coverage: files 28/71`, `arms: 239/239/0`, `biting: 239`,
`lane-invocations: 239`, tallies agree, `FILES_FLOOR` is pinned at 28 and
`ARMS_FLOOR` at 239, with `pending: 12` idiom files still to go. That batch was
REDUCED from the six files it planned: `test_compute_jobs_error_kind_copy_parity
.sql` is un-baselineable until the pg-lane can host pg_cron, and the founder
chose to retire `[REDUNDER-PGCRON]` by putting pg_cron ON the lane as its own
plan rather than work around it — so that file stays in `pending:` alongside the
four already-deferred ones.
⚠️ CURRENCY 2026-09-04: plan 10 then annotated the LAST FOUR non-mixed idiom
files — the allocator pre-terminus equity flag, the enqueue_compute_job
non-terminal dedupe, the metrics_json_by_basis write shape and the
set_compute_job_progress claim fence — 2 + 2 + 2 + 2 = 8 sections, so the
measured corpus is now `coverage: files 32/71`, `arms: 247/247/0`,
`biting: 247`, `lane-invocations: 247`, tallies agree, `FILES_FLOOR` is pinned
at 32 and `ARMS_FLOOR` at 247, with `pending: 8` idiom files still to go: the
SEVEN ⚠️ mixed files plan 11 takes, plus the pg_cron-deferred one above.
⚠️ The phase's end state is therefore `files 39/71`, NOT the `40/71` of SCOPE
AMENDMENT #2 — that amendment predates plan 09's deferral. Note also that
`lane-blocked:` still names only FOUR files: the deferred fifth is blocked by a
migration in its APPLY LIST rather than by its own text, which `gateNeedsPgCron`
cannot see (TODOS `[REDUNDER-LANEBLOCKED-BLIND]`), so it is reported under
`pending:` and is pinned there as a tripwire.
⚠️ CURRENCY 2026-09-04: plan 11 then annotated the SEVEN ⚠️ mixed files — the
api_keys exchange lock, the strategy-keys publish-integrity delete guard, the
api_keys client-INSERT revoke, the sync-status protected marked refresh, the
wizard-draft update guard, the profiles privileged-column lock and the
wizard-session idempotency fence — 4 + 4 + 3 + 1 + 1 + 1 + 1 = 15 sections, so
the measured corpus is `coverage: files 39/71`, `arms: 262/262/0`,
`biting: 262`, `lane-invocations: 262`, tallies agree, `FILES_FLOOR` pinned at
39 and `ARMS_FLOOR` at 262, with **`pending: 1`** — exactly
`test_compute_jobs_error_kind_copy_parity.sql`, owed to Phase 164.4.1
PGCRON-LANE. That is Phase 164.4's END STATE on today's lane: every idiom gate
file the pg-lane can reach is annotated and proven, and the 32 files outside it
are printed by name on every run (27 `unreachable:` + 4 `lane-blocked:` +
that 1 `pending:`). ⛔ `pending:` is NOT empty and must not be made to look
empty — the parser test pins it as a one-name SET so an attestation of
completeness cannot be shipped ahead of 164.4.1.
⚠️ CURRENCY 2026-09-05: Phase **164.4.1 PGCRON-LANE** is now under way and the
paragraph above is 164.4's dated end state, not the current reading. Plan 01 put
pg_cron ON the pg-lane (`shared_preload_libraries` on the single `pg_ctl -o`
start, +0.009 s/lane); plan 02 then annotated the two files that were blocked in
the two DIFFERENT ways — `test_compute_jobs_error_kind_copy_parity.sql` (3
sections, blocked only through its APPLY LIST) and
`test_derive_allocator_keys_fanout.sql` (7 sections, blocked through its own
text). MEASURED at plan 02: `coverage: files 41/71`, `arms: 272/272/0`,
`biting: 272`, `lane-invocations: 272`, tallies agree, `FILES_FLOOR` 41 and
`ARMS_FLOOR` 272, `WAIVED_CEILING` still 0 (nine arms moves, zero waivers).
⛔ The `pending:` prohibition above is SUPERSEDED and its second clause is no
longer true: `pending:` is now measured EMPTY, deliberately, as CONTEXT decision
D-04's own task, and the parser test's pin is the empty set BESIDE an AIM (`it`
title `pending AIM (D-04)`) that proves the class is still computed by
classifying a stripped copy of a real gate. Do NOT "restore" the one-name pin.
⚠️ **Every `node scripts/mutation-runner/run.mjs` in this interval EXITS 1** with
exactly one defect, `lane-blocked-stale` — pg_cron is available while three
files (`test_reconcile_dropped_enqueue_sweep.sql`,
`test_retention_orphaned_running.sql`,
`test_strategy_analytics_stuck_computing_reaper.sql`) are still classified
`lane-blocked`. That is success criterion 3's tripwire doing its job, not a
regression; it clears when plan 05 lands. A run showing any OTHER defect kind IS
a regression.
✅ **CURRENCY 2026-09-05: THAT INTERVAL IS OVER — plan 05 landed and the full
corpus EXITS 0.** The paragraph above stays as the dated record of plans 01-04.
Measured at `b6b830cf`: `coverage: files 44/71`, `lane-blocked: 0 file(s)`,
`lane-probe: pg_cron AVAILABLE`, `  pending: 0`, `arms: 363/363/0`,
`biting: 363`, `lane-invocations: 363`, tallies agree, `✅ No defects`.
`FILES_FLOOR` is pinned at 44 and `ARMS_FLOOR` at 363 (not the 365 the plan
projected — 324 + 39, read off the run).
⚠️ SUPERSEDED 2026-09-05 by the phase REVIEW (`164.4.1-REVIEW.md`, CR-01/CR-02): `ARMS_FLOOR`
is **361**, not 363. Three arms of `test_reconcile_dropped_enqueue_sweep.sql` were found either
unfalsifiable or mutating the gate's own text where a production mutation reaches them; two were
reclassified as named INVARIANTs (never waived). `FILES_FLOOR` stays 44 and `WAIVED_CEILING`
stays 0. The floor moved DOWN because two arms had never been proven against a production
regression — read `run.mjs` for the live constants, never a number restated in prose.
The last file was
`test_reconcile_dropped_enqueue_sweep.sql`, 39 sections, all 39 biting on the
first proof run. The class was emptied BY ANNOTATION: `parse.mjs`, the probe
fixture and the probe/defect code in `run.mjs` are untouched and SELF-TEST 17/17
still passes, so the tripwire stays live for any future unannotated pg_cron gate.
⚠️ The runner still PRINTS `lane-probe: pg_cron AVAILABLE — lane-blocked class is
STALE` while the class is empty; that sentence is now false-reading and plan 06
corrects it at the source. From here, a run that exits NON-ZERO is a regression.
`WAIVED_CEILING` is still 0, now through TWO founder decisions that both took
the root-cause fix over an exception: plan 08's trust-signal anon-EXECUTE
assertion was resolved by a REORDER putting the precondition ahead of its
dependants (TODOS `[REDUNDER-WAIVER-01]`), and plan 09's resync-retry assertion
(b) by wrapping its INSERT in the exception idiom the SAME FILE already used, so
that a narrowed unique index reports `TEST FAILED (b)` instead of a raw 23505
naming no arm. Read the run's own `coverage:` and `arms:` lines rather than any
number restated in prose.
✅ **CURRENCY 2026-09-05 (Phase 164.4.1 plan 06) — THE PHASE'S CLOSING READING.
Every paragraph above stays as dated lineage; this one is the current state.**
* **HOW pg_cron got onto the lane.** `scripts/pg-lane/run.sh` carries
  `shared_preload_libraries=pg_cron` (with `cron.database_name` and
  `cron.max_running_jobs=0` — the lane schedules nothing, it needs the catalog
  to exist) on its SINGLE `pg_ctl -o` start, and each affected gate's
  `RED-UNDER-SETUP` apply list carries migration
  `20260513094906_enable_pg_cron.sql`. **No migration was edited anywhere in
  this phase.** Cost measured, not assumed: +0.009 s/lane isolated,
  `per-arm lane time: mean 1.1s` at corpus scale.
* **What was annotated: five files, 103 sections** — the four that were
  `lane-blocked:` plus `test_compute_jobs_error_kind_copy_parity.sql`, the
  apply-list-blind fifth that had been sitting in `pending:`.
* **END STATE, read off the run:** `coverage: files 44/71`,
  `lane-blocked: 0 file(s)`, `lane-probe: pg_cron AVAILABLE`, `  pending: 0`,
  `arms: 363/363/0`, `biting: 363`, `lane-invocations: 363` (tallies agree),
  `✅ No defects`, **exit 0**. `FILES_FLOOR` 44, `ARMS_FLOOR` 363,
  `WAIVED_CEILING` still **0** — nine files' worth of arms moved, zero waivers
  added. 44 + 0 + 27 + 0 + 0 = 71; the 27 are `unreachable:`
  (`[REDUNDER-NONIDIOM]`, still open and still printed by name every run).
* ⛔ **Both `lane-blocked: 0` and `pending: 0` are pinned as MEASURED EMPTY SETS
  BESIDE AIMs, never as bare empty assertions.** The `pending` pin has
  `it("pending AIM (D-04)…")`, which classifies a stripped copy of a real gate
  to prove the class is still computed; the `lane-blocked` class stays DERIVED
  and its tripwire is proven by SELF-TEST 17/17 on a synthetic corpus. This
  **SUPERSEDES the ⛔ `pending:` is NOT empty sentence above** — do not "restore"
  the old one-name pin, and do not replace either AIM with a bare `toEqual([])`.
* **The tripwire fired and cleared, both observed.** FIRED on the
  pre-annotation tree (`164.4.1-TRIPWIRE-FIRED.log`), and SHA-bound on ubuntu in
  workflow run 33938272686 at `f04ce51b`, whose provisioning step answered
  RESEARCH's open question by measurement: `postgresql-16-cron` comes from
  **noble/universe, not PGDG**, major 16, `.so` and `.control` both present.
  CLEARED locally at plan 05 — exit 0, class empty — with nothing in the
  classifier, the probe fixture or the defect code touched to clear it.
* **Message honesty, plan 06:** the runner used to print "which the pg-lane
  cannot host … (deferred 2026-09-03)" unconditionally and "lane-blocked class
  is STALE" over an EMPTY class. Both were corrected at the source; each arm now
  says what it means for that run, and the grep prefixes ci.yml depends on are
  byte-identical. `[REDUNDER-PGCRON]` and `[REDUNDER-LANEBLOCKED-BLIND]` are
  both closed in `TODOS.md` with their reasoning — the second DELIBERATELY: its
  proposed fix would have classified UNANNOTATED files by a line only ANNOTATED
  files carry, i.e. dead code behind a passing test, so the limit is documented
  and pinned by a hand-built calibration instead.
* ⭐ **MEASURED 2026-09-05 — the SHA-bound ubuntu run of the FINISHED tree
  exists.** workflow_dispatch run **33961609382**, head sha
  **1aa8bb7088e978320041b6a97d187b8247b8fe3d**, `sql-mutation` **success in
  567 s (9.45 min)**. Ubuntu read IDENTICAL to the authoring box:
  `coverage: files 44/71`, `arms: 363/363/0`, `biting: 363`,
  `lane-invocations: 363`, `lane-blocked: 0`, `lane-probe: pg_cron AVAILABLE`,
  `✅ No defects`, `per-arm lane time: mean 1.1s`; pg_cron came from
  noble/universe at **1.6.2-1**. LEGS: 363 arms + 44 baseline + 44 restore =
  **451 legs**. `sql-mutation`'s `timeout-minutes` therefore **stays 15** by
  applying the rule literally — 9.45 min does not reach the ~10 min trigger,
  and when it is crossed the raise is to 20 ONCE (`ci.yml:933-953` carries this
  derivation). The 445 s of run 33938272686 is the PRE-annotation tree at 262
  arms and must not be read as a figure for this corpus.
  ⚠️ Every arm/file count in this bullet is that run's DATED reading at
  `1aa8bb70`, not a live constant: read `FILES_FLOOR` and `ARMS_FLOOR` off
  `scripts/mutation-runner/run.mjs` itself, since an arm reclassified after
  this date moves the floor without moving this paragraph.
  ⛔ From here, a run that exits NON-ZERO is a regression, not the tripwire.
Read the run's own `coverage:` and `arms:` lines rather than any number
restated in prose.
VAC-04 and VAC-08 have still not run against their real credential; see entries
25 and 26.

⭐ **CURRENCY 2026-09-06 (Phase 164.2 CURATED-COPY plan 07) — the corpus grew by
one gate file.** Every paragraph above stays as dated lineage; this one is the
current reading. Plan 07 added `supabase/tests/test_sync_status_curated_sentence
_survives.sql` — 7 arms proving the runner's curated `computation_error` sentence
SURVIVES the status transition, plus an applied-ness probe — 8 sections, 8 twins,
all 8 biting on the proof run. Read off `node scripts/mutation-runner/run.mjs` at
the final tree, **exit 0**: `coverage: files 45/72`, `arms: 369/369/0`,
`biting: 369`, `lane-invocations: 369` (the two independent tallies AGREE),
`lane-blocked: 0 file(s)`, `lane-probe: pg_cron AVAILABLE`, `  pending: 0`,
`per-arm lane time: mean 1.1s`, `✅ No defects`. 45 annotated + 0 lane-blocked +
27 `unreachable:` + 0 pending = 72. `FILES_FLOOR` moved 44 → **45** and
`ARMS_FLOOR` 361 → **369**; `WAIVED_CEILING` is still **0**. Both floors were
SEPARATED in both directions on real full-corpus lane runs before being pinned —
at +1 each the runner named both regressions and exited 1; at the pinned values,
0 defects. ⚠️ **These are that run's DATED readings, not live constants: read
`FILES_FLOOR` and `ARMS_FLOOR` off the constants themselves in
`scripts/mutation-runner/run.mjs` (cited by SYMBOL, not by line — this file's
earlier line cites drifted the moment the runner grew).** The ubuntu SHA-bound confirmation for THIS corpus has not been taken —
the 567 s / 363-arm figure above is the 164.4.1 tree and must not be read as a
figure for 45 files. ⛔ `sql-tests` is expected RED on the 164.2 PR for exactly
two named arms until the provenance migration reaches shared TEST — see TODOS
`[164.2-TEST-APPLY-PROVENANCE]`; that is a missing apply, not a coupling
regression.
Read the run's own `coverage:` and `arms:` lines rather than any number restated
in prose.

⭐ **CURRENCY 2026-09-07 (Phase 164.7 APPSETTINGS plan 05) — the corpus grew by
one gate file AND by four arms inside two existing ones.** Every paragraph above
stays as dated lineage; this one is the current reading. Plan 02 added
`supabase/tests/test_analytics_service_settings_and_vault_tick.sql` (7 arms — the
two RAISE paths of the Vault/`system_settings` tick asked for BY NAME, the
discriminator that refuses a callable which raises unconditionally, and three
RLS/grant arms). Plan 04 then added arms K and L to EACH ledger gate (row-FALSE
and read-RAISES, beside the existing missing-row arm A) and RE-POINTED all 27
pre-existing edit-kind twins in those two files at the superseding migration
`20260907130000_ledger_refresh_switch_to_system_flags.sql`, every one re-observed
biting AFTER the re-point — a twin left mutating a body that `CREATE OR REPLACE`
overwrites has silently stopped being a test. Read off
`node scripts/mutation-runner/run.mjs` at the final tree, **exit 0**:
`coverage: files 46/73`, `arms: 384/384/0`, `biting: 384`,
`lane-invocations: 384` (the two independent tallies AGREE), `lane-blocked: 0
file(s)`, `lane-probe: pg_cron AVAILABLE`, `  pending: 0`,
`per-arm lane time: mean 1.1s`, `✅ No defects`. 46 annotated + 0 lane-blocked +
27 `unreachable:` + 0 pending = 73. `FILES_FLOOR` moved 45 → **46** and
`ARMS_FLOOR` 369 → **384**; `WAIVED_CEILING` is still **0**.

⚠️ **The two floors are separated in DIFFERENT LAYERS, and this plan MEASURED
that rather than inheriting the earlier paragraphs' wording.** A full-corpus run
with the floors left stale-low at 45/369 on this 46-file tree exits **0** with
`✅ No defects` — `run.mjs`'s gate paths are `annotatedFiles < filesFloor` and
`bitingArms < armsFloor`, so a floor BELOW the corpus is invisible to it by
construction. The stale direction is caught one layer up, by
`src/__tests__/mutation-runner-floors.test.ts`, which failed on that same tree
with `RATCHET STALE: 46 of 73 gate files are now annotated but FILES_FLOOR is
still 45` and the paired ARMS_FLOOR message. At +1 each (47/381) the runner named
both regressions and exited 1; at the pinned values it exits 0. ⛔ So "separated
in both directions" means **the runner for the upper direction and the vitest
ratchet for the lower**. An earlier plan's expectation that `run.mjs` alone
reports a stale ratchet is FALSE, was falsified by measurement here, and is
recorded in `164.7-05-FLOORS.log` with all three runs' exit codes.

⚠️ **New in this phase: `sql-gate-lint` now ALSO runs `scripts/lint-app-guc.mjs`**
— self-test first, then the corpus scan, both pasted verbatim as a developer runs
them. It is a SIBLING of `lint-sql-gates.mjs`, not an eighth rule of it, because
that linter masks comments and string-literal contents while decision D-05
requires this gate to COUNT comments. Its corpus step was RED BY DESIGN at 12
findings across 5 files between plans 01 and 05; plan 05 drove it to **0 findings
with the five annotated files named**, by ANNOTATION — a dated
`-- APP-GUC-LINEAGE:` header AND an agreeing, count-pinned `LINEAGE_ALLOWLIST`
entry, two edits in two files, whose five counts still SUM TO the same 12 sites.
⛔ A red corpus step from here is a regression and is never cleared by widening
the allowlist or relaxing `DETECT_RE`.

⚠️ **CORRECTION 2026-09-07 (Phase 164.5 planning):** the paragraph above originally read `ARMS_FLOOR` 369 → **380** with `arms: 380/380/0`. That was the reading BEFORE 164.7 plan 04 added arms K and L to each ledger gate; the shipped value is **384**, read by symbol from `export const ARMS_FLOOR` in `scripts/mutation-runner/run.mjs`. The prose and the constant had already diverged, which is exactly why this file says to read the constants by SYMBOL and never a number restated in prose. `FILES_FLOOR` is **46** and `WAIVED_CEILING` is still **0**.

⛔ **`sql-tests` and VAC-08 are expected RED on the 164.7 PR** for exactly the
arms named in `TODOS.md` `[164.7-TEST-APPLY-APPSETTINGS]`, until the founder
hand-applies `20260907120000` and `20260907130000` to shared TEST. That is a
missing apply, not a coupling regression.

⚠️ **Every number above is a DATED reading of one macOS box on 2026-09-07** (472
legs = 380 arms + 46 baseline + 46 restore; 531 s and 528 s at mean 1.1 s/arm,
plus one 614 s run contaminated by a busy-wait loop beside it), **not a live
constant.** Read `FILES_FLOOR` and `ARMS_FLOOR` off the constants themselves in
`scripts/mutation-runner/run.mjs`, cited by SYMBOL. No SHA-bound ubuntu run of a
46-file / 380-arm corpus exists; the 567 s and 646 s figures above are the
164.4.1 tree at 363 and 361 arms and must not be read as figures for this one.
`sql-mutation`'s `timeout-minutes` stays **20**, unchanged — the rule's one
permitted raise was taken on 2026-09-05 and 20 is a declared CEILING, so a future
crossing is answered by `[REDUNDER-SUBSET-SPLIT]`, never by raising again.
Read the run's own `coverage:` and `arms:` lines rather than any number restated
in prose.


⚠️ CURRENCY 2026-10-10 (Phase 164.6.6.2.1 BTCUSDVIEW, plan 01): the gate file
`supabase/tests/test_btcusdview_native_balance.sql` (migration 20261010120000: the owner-only
column GRANT on three `api_keys` columns, the `account_balance_usdt_close_date` and
`quantity_unit` columns, the unit CHECK) arrived with five arms, each on a `sql` step, none
waived. A DATED reading of one full `node scripts/mutation-runner/run.mjs` on that branch
alone, no file edited during it: `coverage: files 62/89`, `arms: 615/615/0`, `biting: 615`,
`lane-invocations: 615` plus 62 baseline / 62 restore legs, `unreachable: 27`, `lane-blocked: 0`,
`No defects.`, exit 0. Not a live constant: read `FILES_FLOOR` and `ARMS_FLOOR` by SYMBOL.

⚠️ CURRENCY 2026-10-11 (Phase 170.4 ALLOCHOLDINGS, plans 09 and 13): two gate files arrived,
`supabase/tests/test_allocator_holdings_per_key_unique.sql` (migration 20261011120000: the
five-column per-key unique index on `allocator_holdings`, six arms) and
`supabase/tests/test_commit_scenario_batch_fingerprint_unpriced.sql` (migration 20261011120100:
the native-unpriced marker rule in `commit_scenario_batch`'s fingerprint recompute, two arms), each
arm on a `sql` or `edit` step, none waived. A DATED reading of one full
`node scripts/mutation-runner/run.mjs` on that branch, no file edited during it:
`scope: FULL 66/66 annotated files`, `coverage: files 66/93`, `arms: 638/638/0`, `biting: 638`,
`lane-invocations: 638` plus 66 baseline / 66 restore legs, `unreachable: 27`, `lane-blocked: 0`,
`No defects.`, exit 0. Plan 13 re-measured it independently of plan 09 and read the same figures.
Not a live constant: read `FILES_FLOOR` and `ARMS_FLOOR` by SYMBOL.

⚠️ CURRENCY 2026-10-13 (Phase 167.1.2.1 RECONMARKER, plan 01, decisions D-04, D-05, D-12, D-13,
D-15): the gate file `supabase/tests/test_api_keys_history_reconstruct_marker.sql` (migration
20261014120000: the per-key `api_keys.history_reconstructed_at` / `history_reconstruct_attempts`
marker, its column grants and CHECK, `backfill_api_keys_history_reconstructed_at()`, and
`request_allocator_holdings_sync` counting `failed_retry` and a set marker) arrived with
twenty-three arms, C1, B1-B8, A1-A3, K1, F1, D1-D5, R3, R1, R2, R4 (file order; D1-D5 pin the
second migration 20261014120100, D-18: `log_audit_event` refuses the worker-only audit actions to a
non-service_role caller), each on an `edit` or `sql` step, none waived. A DATED reading of one full
`node scripts/mutation-runner/run.mjs` on that branch, no file edited during it:
`scope: FULL 67/67 annotated files`, `coverage: files 67/94`,
`arms: 661/661/0`, `biting: 661`, `lane-invocations: 661` plus 67 baseline / 67 restore legs,
`unreachable: 27`, `lane-blocked: 0`, `No defects.`, exit 0. Not a live constant: read `FILES_FLOOR`
and `ARMS_FLOOR` by SYMBOL.

⚠️ CURRENCY 2026-10-13 (Phase 167.1.2.1 RECONMARKER, PR 1 review round): the same gate file
`supabase/tests/test_api_keys_history_reconstruct_marker.sql` grew from twenty-three to THIRTY arms,
C1, B1-B12, A1-A3, K1, F1, D1-D4, D6, D7, D5, R3, R1, R2, R4, R5 (file order): B9-B12 pin the
backfill's evidence filters (SFH-2 transient-failure rows, WR-01 the 2026-04-24 heal bound, WR-02
the `days_written` shape), D6-D7 pin the O-1 entity-type refusal of `log_audit_event` (and D4 also
asserts service_role still writes both), R5 pins the O-2 marker-authoritative reconstruct gate of
`request_allocator_holdings_sync`. A DATED reading of one full `node scripts/mutation-runner/run.mjs`
on that branch, no file edited during it: `scope: FULL 67/67 annotated files`,
`coverage: files 67/94`, `arms: 668/668/0`, `biting: 668`, `lane-invocations: 668` plus 67 baseline /
67 restore legs, `unreachable: 27`, `lane-blocked: 0`, `No defects.`, exit 0; per-file row
`sections 30 / judged 30 / annotated 30 / waived 0 / biting 30`. It supersedes the 661 reading above
as the latest dated one and is itself not a live constant: read `FILES_FLOOR` and `ARMS_FLOOR` by SYMBOL.
Merge order (CR-01) is untouched by this round: after NAVBREACH merges, every pin is re-measured again.

⚠️ CURRENCY 2026-10-14 (Phase 167.1.2.1 RECONMARKER, merge of origin/main, CR-01 / O-3): the merge
order recorded above happened. NAVBREACH (#1020, with FLOWTIMING and TRADESYNC) merged first, so the
census was re-measured on the merged tree instead of added by hand: each branch had counted ONE new
gate file against main's 66 and each said 67, the union is 68 (`test_api_keys_history_reconstruct_marker.sql`
30 arms, `test_strategy_analytics_computed_at_success_only.sql` 5 arms). A DATED reading of one full
`node scripts/mutation-runner/run.mjs`, no file edited during it, exit 0: `scope: FULL 68/68 annotated
files`, `coverage: files 68/95`, `arms: 673/673/0`, `biting: 673`, `lane-invocations: 673` plus 68
baseline / 68 restore legs, `unreachable: 27`, `lane-blocked: 0`, `per-arm lane time: mean 3.2s over
673 arm run(s)`, `No defects.`. The lint corpus reads `scanned 95 file(s)` and
`scripts/baseline-content-drift-check.mjs` compares 128 functions (`COMPARED_FLOOR` 127 -> 128). It
supersedes the 668 reading above as the latest dated one and is itself not a live constant: read
`FILES_FLOOR` and `ARMS_FLOOR` by SYMBOL.

⚠️ CURRENCY 2026-10-14 (Phase 167.1.2.1 RECONMARKER, plan 07): two gate files moved for migration
`20261021120000`, which re-bases `enqueue_refresh_allocator_equity_for_all` so the daily fan-out
reconstructs every OWED key (marker NULL, attempts under 5, nothing in flight) on a book with
snapshots as well as without. (1) NEW gate `supabase/tests/test_refresh_fanout_owed_key_reconstruct.sql`
(plan 04), twelve arms, O1-O10, O6t and G, each on an `edit` or `sql` step, none waived. (2) The
167.1.2 gate `supabase/tests/test_refresh_fanout_zero_snapshot_bootstrap.sql` was REPOINTED to the
new body in the same PR, because `sql-tests` applies every migration and the old file went RED at
arm N4d on any lane that applied it, while `sql-mutation`'s explicit apply list kept it green and
hid that. Its header now holds one machine-checked `CLASS` row per original arm (32): 30 KEEP, one
RE-EXPRESSED (N4d: the done-row guard became a marked-key guard on the `bk` copy; the `bq` and `rk`
marker terms are arm O4's), and one MOVED (N5 -> O1: N5 asserted that a book WITH snapshots is never
sent a reconstruct, the exact inverse of SC-2, so its assertion and twin were removed and O1 holds
the inverse). The status-list finds of N4, N4r and F were re-derived because the lists lost `'done'`.
A DATED reading of one full `node scripts/mutation-runner/run.mjs`, tree committed and frozen, exit
0: `scope: FULL 69/69 annotated files`, `coverage: files 69/96`, `arms: 684/684/0`, `biting: 684`,
`lane-invocations: 684` plus 69 baseline / 69 restore legs, `unreachable: 27`, `lane-blocked: 0`,
`per-arm lane time: mean 2.8s over 684 arm run(s)`, `No defects.`; per-file rows
`test_refresh_fanout_owed_key_reconstruct.sql: sections 11 / judged 12 / annotated 12 / waived 0 /
biting 12` and `test_refresh_fanout_zero_snapshot_bootstrap.sql: sections 26 / judged 31 / annotated
31 / waived 0 / biting 31` (was 27 / 32). The lint corpus reads `scanned 96 file(s)`. It supersedes
the 673 reading above as the latest dated one and is itself not a live constant: read `FILES_FLOOR`
and `ARMS_FLOOR` by SYMBOL. An earlier first full run of the same tree reported one defect, a
`dirty-checkout` (files edited while it ran); it was rerun on a committed tree, which is the run
recorded here.

⚠️ CURRENCY 2026-10-14 (Phase 167.1.2.1 RECONMARKER, PR 2 fix round, SFH F2 + F3): migration
`20261021120000` (unmerged, edited in place) gained two guarded handlers and the owed-key gate
`supabase/tests/test_refresh_fanout_owed_key_reconstruct.sql` gained five arms, none waived. F3: the
per-book handler of the bootstrap loop rolled back a failing book's attempt increments with the book,
so a book that raised every day never reached the cap; it now counts one attempt on the one key that
was being enqueued, after the rollback (O11 the count, O11i the innocent sibling is not charged, O11g a
count that itself raises is contained to its own book). F2: the capped-key count's handler wrote a
WARNING only; it now writes a `history_reconstruct_capped_trace_failed` cron_runs row (O12), nested and
guarded so a sink that refuses it too never cancels the refresh (O12g). O11 and O12 were seen RED on
the unfixed migration body; O11i, O11g and O12g are regression guards on the new handlers and are
RED only under their own twins. A DATED reading of one full `node scripts/mutation-runner/run.mjs`,
tree committed and frozen, exit 0: `scope: FULL 69/69 annotated files`, `coverage: files 69/96`,
`arms: 689/689/0`, `biting: 689`, `lane-invocations: 689` plus 69 baseline / 69 restore legs,
`unreachable: 27`, `lane-blocked: 0`, `per-arm lane time: mean 2.1s over 689 arm run(s)`, `No defects.`;
per-file rows `test_refresh_fanout_owed_key_reconstruct.sql: sections 13 / judged 17 / annotated 17 /
waived 0 / biting 17` (was 11 / 12) and the 167.1.2 gate unchanged at 26 / 31. The lint corpus still
reads `scanned 96 file(s)`. It supersedes the 684 reading above as the latest dated one and is itself
not a live constant: read `FILES_FLOOR` and `ARMS_FLOOR` by SYMBOL.

⚠️ CURRENCY 2026-10-14 (Phase 167.1.2.1 RECONMARKER, PR 2 fix round 2, SFH R2-1): migration
`20261021120000` (unmerged, edited in place) narrowed the per-book handler's attempt count and the
owed-key gate `supabase/tests/test_refresh_fanout_owed_key_reconstruct.sql` gained three arms, none
waived. The round-1 handler counted one attempt for ANY error that escaped the per-key handler, so a
deadlock, a lock timeout or an error raised away from the key's enqueue could cap a key that never had a
job, and a key capped without a job has no worker-side Sentry event. The handler now counts only while
`v_boot_in_enqueue` is TRUE (the key's own enqueue section) and only for a SQLSTATE outside class 40,
class 53 and 55P03. O13 (40P01), O13l (55P03) and O13r (53200) each assert the key keeps its seeded
attempts, has no job, and still leaves its `bootstrap_book_skipped` trace row; each was seen RED on the
previous body (5 attempts, expected 4) and GREEN here, with its own edit mutation. The attribution flag
has NO gate arm: the per-key query ends in a blocking Sort, so every predicate runs before the first
row and a later cursor advance can raise system errors only, which the class clauses already exclude;
that limit is recorded in the migration header. A DATED reading of one full
`node scripts/mutation-runner/run.mjs`, tree committed and frozen, exit 0: `scope: FULL 69/69 annotated
files`, `coverage: files 69/96`, `arms: 692/692/0`, `biting: 692`, `lane-invocations: 692` plus 69
baseline / 69 restore legs, `unreachable: 27`, `lane-blocked: 0`, `per-arm lane time: mean 2.3s over 692
arm run(s)`, `No defects.`; per-file rows `test_refresh_fanout_owed_key_reconstruct.sql: sections 14 /
judged 20 / annotated 20 / waived 0 / biting 20` (was 13 / 17) and the 167.1.2 gate unchanged at 26 / 31.
It supersedes the 689 reading above as the latest dated one and is itself not a live constant: read
`FILES_FLOOR` and `ARMS_FLOOR` by SYMBOL.

⚠️ CURRENCY 2026-10-14 (Phase 170.6.1 DISCOVERYPHONE, plan 03): the gate file
`supabase/tests/test_get_published_trade_venues.sql` (migration 20261019120000: the published-only
SECURITY DEFINER function `get_published_trade_venues(uuid[])` that names the venue a published
strategy's trades come from) arrived with ten arms, each on a `sql` or `edit` step, none waived.
A DATED reading of one full `node scripts/mutation-runner/run.mjs` on the tree merged with
origin/main (v0.131.4.1), no file edited during it, exit 0, constants then at 68 / 673: `scope: FULL
69/69 annotated files`, `coverage: files 69/96`, `arms: 683/683/0`, `biting: 683`,
`lane-invocations: 683` plus 69 baseline / 69 restore legs, `unreachable: 27`, `lane-blocked: 0`,
`per-arm lane time: mean 2.2s over 683 arm run(s)`, `No defects.`. The lint corpus reads `scanned 96
file(s)` and `scripts/baseline-content-drift-check.mjs` compares 129 functions (`COMPARED_FLOOR` 128
-> 129). The migration stamp was re-picked from 20261016120000 to 20261019120000 at release time
because an in-flight branch held 20261018120000. It supersedes the 673 reading above as the latest
dated one and is itself not a live constant: read `FILES_FLOOR` and `ARMS_FLOOR` by SYMBOL.

⚠️ CURRENCY 2026-10-14 (Phase 164.6.8 OUTAGEALERT, merge with origin/main): two gate files met
on one corpus, `supabase/tests/test_ops_staleness_check.sql` (migration 20261020120000, fourteen
arms, LANE-ONLY on the pg-net stand-in) and main's
`supabase/tests/test_strategy_analytics_computed_at_success_only.sql` (migration 20261013120000,
five arms). Each branch had raised `FILES_FLOOR` 66 to 67 for its own gate, so git kept the shared
67 without a conflict. A DATED reading of one full `node scripts/mutation-runner/run.mjs` on the
merged tree, no file edited during it, run with the pre-merge constants in place:
`scope: FULL 68/68 annotated files`, `coverage: files 68/95`, `arms: 657/657/0`, `biting: 657`,
`lane-invocations: 657` plus 68 baseline / 68 restore legs, `unreachable: 27`, `lane-blocked: 0`,
`No defects.`, exit 0. `node scripts/lint-sql-gates.mjs` printed `scanned 95 file(s); 0
finding(s)`; `scripts/baseline-content-drift-check.mjs` compared 128 functions (MATCH 124, DRIFT 3,
SNAPSHOT_MISSING 1, the one being `ops_staleness_check/0` until its migration applies to PROD and
the baseline is re-dumped). `ci.yml`'s `SENTINEL_FLOOR` 17 and `ARMS_FLOOR` 299 did not move
(the NAVBREACH gate declares no sentinel). Not a live constant: read `FILES_FLOOR`, `ARMS_FLOOR`
and `COMPARED_FLOOR` by SYMBOL.

⚠️ CURRENCY 2026-10-14 (Phase 164.6.8 OUTAGEALERT plan 08, release merge with origin/main
v0.131.5.1): the branch met main's DISCOVERYPHONE gate
(`supabase/tests/test_get_published_trade_venues.sql`, migration 20261019120000, ten arms) on one
corpus beside `supabase/tests/test_ops_staleness_check.sql` (migration 20261020120000, fourteen
arms). A DATED reading of one full `node scripts/mutation-runner/run.mjs` on the COMMITTED merged
tree, no file edited during it, run with main's constants (69 / 683) in place: `scope: FULL 70/70
annotated files`, `coverage: files 70/97`, `arms: 697/697/0`, `biting: 697`, `lane-invocations:
697` plus 70 baseline / 70 restore legs, `unreachable: 27`, `lane-blocked: 0`, `per-arm lane time:
mean 4.9s over 697 arm run(s)`, `No defects.`, exit 0. `node scripts/lint-sql-gates.mjs` printed
`scanned 97 file(s); 0 finding(s)`; `scripts/baseline-content-drift-check.mjs` compared 130
functions (MATCH 126, DRIFT 3, SNAPSHOT_MISSING 1, the one being `ops_staleness_check/0` until its
migration applies to PROD and the baseline is re-dumped). It supersedes the 657 reading above as
the latest dated one and is itself not a live constant: read `FILES_FLOOR`, `ARMS_FLOOR` and
`COMPARED_FLOOR` by SYMBOL.

⚠️ CURRENCY 2026-10-14 (Phase 167.1.2.1 RECONMARKER PR 2, first merge of origin/main, SUPERSEDED by the later reading below, kept as lineage): the two branches'
new gate files meet. RECONMARKER's owed-key fan-out gate
(`supabase/tests/test_refresh_fanout_owed_key_reconstruct.sql`, migration
`20261021120000_refresh_fanout_owed_key_reconstruct.sql`) and DISCOVERYPHONE's
`supabase/tests/test_get_published_trade_venues.sql` each counted one new annotated file against
main's 68 and said 69, so the union is 70 of 97. M2 was re-stamped from 20261018120000 to
20261021120000 in the same step, so it sorts after DISCOVERYPHONE (20261019120000) and OUTAGEALERT
(20261020120000). A DATED reading of one full `node scripts/mutation-runner/run.mjs` on the committed,
re-stamped tree, no file edited during it, exit 0: `scope: FULL 70/70 annotated files`,
`lane-concurrency: 4`, `coverage: files 70/97`, `arms: 702/702/0`, `biting: 702`,
`lane-invocations: 702` plus 70 baseline / 70 restore legs, `unreachable: 27`, `lane-blocked: 0`,
`per-arm lane time: mean 2.2s over 702 arm run(s)`, `No defects.`; per-file rows unchanged for both
(`test_refresh_fanout_owed_key_reconstruct.sql: sections 14 / judged 20 / annotated 20 / waived 0 /
biting 20`, the 167.1.2 gate 26 / 31). The lint corpus reads `scanned 97 file(s)`; `COMPARED_FLOOR`
stays 129 (M2 redefines a function that already existed). `baseline-content-drift-check.mjs` reads
DRIFT 4 and SNAPSHOT_MISSING 1 until the post-apply re-dump: the extra DRIFT is
`enqueue_refresh_allocator_equity_for_all`, whose snapshot is M2's body while the committed dump still
carries the previous one. It supersedes the 683 reading above as the latest dated one and is itself
not a live constant: read `FILES_FLOOR` and `ARMS_FLOOR` by SYMBOL.

⚠️ CURRENCY 2026-10-14 (Phase 167.1.2.1 RECONMARKER PR 2, pre-ship merge of origin/main v0.131.7.0):
main now carries DISCOVERYPHONE's and OUTAGEALERT's gate files (70 annotated of 97, 697 arms), and
this branch adds the owed-key fan-out gate on top. A DATED reading of one full
`node scripts/mutation-runner/run.mjs` on the COMMITTED merge, no file edited during it, run with
main's constants (70 / 697) in place, exit 0: `scope: FULL 71/71 annotated files`,
`lane-concurrency: 4`, `coverage: files 71/98`, `arms: 716/716/0`, `biting: 716`,
`lane-invocations: 716` plus 71 baseline / 71 restore legs, `unreachable: 27`, `lane-blocked: 0`,
`lane-probe: pg_cron AVAILABLE`, `per-arm lane time: mean 1.4s over 716 arm run(s)`,
`No defects.`. Per-file rows: `test_refresh_fanout_owed_key_reconstruct.sql: sections 14 / judged 20 /
annotated 20 / waived 0 / biting 20`, `test_refresh_fanout_zero_snapshot_bootstrap.sql: 26 / 31 / 31 / 0
/ 31`, `test_ops_staleness_check.sql: 14 / 14 / 14 / 0 / 14`, `test_get_published_trade_venues.sql:
10 / 10 / 10 / 0 / 10`. `FILES_FLOOR` 70 -> 71 and `ARMS_FLOOR` 697 -> 716 (+19 net: the owed-key
gate's 20 arms less N5, moved out of the 167.1.2 gate); `WAIVED_CEILING` stays 0. Every dependent
pin was seen RED at main's value first (the ratchet read `RATCHET STALE: 71 of 98 gate files are now
annotated but FILES_FLOOR is still 70`; the parser file read `expected 716 to be 697`, `809 to be
788` and `98 to be 97`; the lint corpus pin read `scanned 98` against 97). `lint-sql-gates` scans 98
files; `COMPARED_FLOOR` stays 130. After the second merge of origin/main (v0.131.7.1, the baseline
re-dump after the PROD apply of OUTAGEALERT's migration, which carries no gate or migration change
so the run above stands) the drift check reads `functions compared 130 - MATCH 126, DRIFT 4,
SNAPSHOT_MISSING 0`, findings 1: `enqueue_refresh_allocator_equity_for_all`, whose snapshot is M2's
body, until M2 applies to PROD and the baseline is re-dumped again; the other three DRIFT rows are
the allowlisted ones. M2's stamp `20261021120000` sorts above
OUTAGEALERT's `20261020120000`, the highest on `origin/main`. It supersedes the 702 reading above as
the latest dated one and is itself not a live constant: read `FILES_FLOOR`, `ARMS_FLOOR` and
`COMPARED_FLOOR` by SYMBOL.

⚠️ CURRENCY 2026-10-15 (Phase 170.6.1.1 ANONKEYID, plan 07, PR-B part 3, merge of origin/main
1cde77edf): one gate file arrived, `supabase/tests/test_strategies_anon_grants.sql` (migration
`20261022120000_strategies_anon_api_key_id_revoke.sql`: anon loses its table-level SELECT, INSERT,
UPDATE and DELETE on `public.strategies` and keeps column SELECT on every column but `api_key_id`;
seven arms, GRANT 1-4, WRITE 1-2 and KEEP 1, every twin a `sql` grant change, none waived). A DATED
reading of one full `node scripts/mutation-runner/run.mjs` on the COMMITTED merge, no file edited
during it, run with main's constants (71 / 716) in place, exit 0: `scope: FULL 72/72 annotated
files`, `lane-concurrency: 4`, `coverage: files 72/99`, `arms: 723/723/0`, `biting: 723`,
`lane-invocations: 723` plus 72 baseline / 72 restore legs, `unreachable: 27`, `lane-blocked: 0`,
`lane-probe: pg_cron AVAILABLE`, `per-arm lane time: mean 2.4s over 723 arm run(s)`,
`No defects.`. Per-file row: `test_strategies_anon_grants.sql: sections 7 / judged 7 / annotated 7 /
waived 0 / biting 7`. `FILES_FLOOR` 71 -> 72 and `ARMS_FLOOR` 716 -> 723; `WAIVED_CEILING` stays 0.
Every dependent pin was seen RED at main's value first (the ratchet read `RATCHET STALE: 72 of 99
gate files are now annotated but FILES_FLOOR is still 71`; the floors file read `expected 723 to be
716`; the parser file read `expected 723 to be 716`, `99 to be 98` and `72 to be 71`; the lint
corpus pin read `scanned 99` against 98). `stepsSeen` stays 809: the gate's twins are `sql` steps,
not file steps. `lint-sql-gates` scans 99 files; `COMPARED_FLOOR` stays 130 and `CORPUS_FLOOR` stays
48 (the migration redefines no function and adds no file to the live-DB lane corpus, which reads 51 files; the tests that pin them passed unmoved);
`NAME_SET_RATCHET` is untouched. The baseline-content-drift check reads `MATCH 127, DRIFT 3`, the
three allowlisted rows, findings 0. The stamp `20261022120000` sorts above `origin/main`'s highest,
`20261021120000`. It supersedes the 716 reading above as the latest dated one and is itself not a
live constant: read `FILES_FLOOR` and `ARMS_FLOOR` by SYMBOL.
