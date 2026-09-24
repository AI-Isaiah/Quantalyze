@AGENTS.md

## Which database am I on? (ask FIRST, every time)

⛔ **This checkout's Supabase CLI is linked to PRODUCTION.** `supabase/.temp/project-ref` holds
the same ref `src/lib/test-safety.ts:26` pins as prod. So `supabase db push`, `db reset --linked`,
`--project-ref` and `--db-url` from this directory all target prod. The link is deliberate — the
pre-flight migration gates diff against PROD on purpose — so do not "fix" it by unlinking.

⛔ **`current_database()` is `postgres` on BOTH projects.** It proves nothing. Neither does a
green query, a familiar-looking table, or the dashboard's own chrome. Before any statement that
writes, run:

```sql
SELECT shobj_description(oid, 'pg_database') AS which_database
  FROM pg_database WHERE datname = current_database();
```

Each project carries a hand-set `COMMENT ON DATABASE` naming itself. If it comes back NULL, the
marker was lost — re-set it before writing, do not proceed on a guess.

Guard coverage, measured 2026-09-01: the TS/e2e path is safe (`assertNotProductionSupabaseUrl`
throws before any write via `getAdmin()`), and CI's `sql-tests` uses its own `TEST_SUPABASE_DB_URL`.
⛔ **CORRECTED 2026-09-23 (Phase 164.4.2):** `sql-tests` uses **no secret** now. It runs
the `supabase/tests` corpus on a local Supabase stack private to its runner
(`scripts/local-stack/run.sh up`, loopback-only DSN), so it cannot reach TEST or PROD. The
CI job that reads `TEST_SUPABASE_DB_URL` for VAC-08 is **`test-db-drift`**. The sentence
before this note is kept as lineage.
The **CLI** and the **browser SQL editor** have no automated guard at all. The marker above is the
only thing standing between a dashboard tab and production.
⭐ **ADDENDUM 2026-09-09 (Phase 164.8) — that last sentence is now narrower, and only there.** The
two CI jobs that WRITE to shared TEST both run the marker query themselves and abort on a NULL or
non-TEST answer: `supabase-migrate.yml`'s `apply-test` and `test-restore-from-baseline.yml`. In
both it is the first statement after the mutex acquire and before any dry-run, push or drop —
run `34367135073` printed it verbatim as `which_database: OK — the marker names TEST and not
PROD.` The **developer CLI** and the **browser SQL editor** still have NO automated guard. Nothing
about them changed; the set of unguarded writers simply got smaller.

### Currency 2026-09-09 — what shared TEST IS now (Phase 164.8 TESTPREPROD)

⛔ **Regenerate rather than trust: every figure below is bound to a run id or a sha.** The
paragraphs above stay as lineage; they describe the world before the restore and are still true
about the CLI link and the marker.

- **TEST's `public` schema is a copy of PROD's catalogue.** ⛔ **CORRECTED 2026-09-12 — TEST's
  CURRENT state was NOT set by run `34274355596`, and this paragraph said it was.** Two FURTHER
  dispatches of `test-restore-from-baseline.yml` ran on 2026-09-09 at head `a622df27`:
  **`34329459044`** (preflight, 08:30Z) and **`34330741339`** (`mode=restore`, confirm token
  enforced, 08:44Z), the latter reporting `restore: tables=62 policies=154 functions=120
  ledger_rows=266 survivors=2/2 filtered=1 mode=restore`. **The 08:44Z restore is what left TEST
  as it stands.** A second full `DROP SCHEMA public CASCADE` on a database other people's CI uses
  was, until this correction, recorded in the phase log and NOWHERE ELSE — not here, not in the
  ROADMAP. Found by Phase 164.8's own verifier under its non-negotiable premise *"a destructive
  act on shared TEST is auditable"*; this file was the last place still carrying the old
  attribution, and it is the file every session reads.
  **What both runs did, and it is the same mechanism:** `public` was dropped and rebuilt from
  `supabase/schema/baseline.sql` at sha256 `27826b76…` (the sha recorded in `BASELINE.md`, not a
  fresh dump), inside the held shared-TEST mutex, behind an activity gate and a backup artifact.
  ⚠️ Run `34274355596` (head `88581b8bc66415bfa86b7d5a019741b1cbd0ff49`, 2026-09-08) remains the
  run that moved the ledger 243 → 266 and it committed — but it concluded `failure`, exiting 1
  on a post-COMMIT extension guard that reports a GAIN (`pg_net`, which TEST lacked and PROD has)
  as a LOSS. Cite it for the LEDGER MOVE; cite `34330741339` for the SCHEMA STATE.
- **Its migration ledger holds ONE ROW PER REPO MIGRATION FILE** (243 → 266 at the restore).
  ⚠️ **`supabase_migrations.schema_migrations.statements` on TEST is a PROSE PROVENANCE SENTENCE,
  not the SQL that ran.** The re-seed TRUNCATEd the table and wrote that sentence into every row.
  This is the opposite of PROD, whose ledger stores the APPLIED SQL and is therefore usable as
  evidence of execution — never read TEST's `statements` that way. The pre-restore TEST column
  survives only inside the restore's backup artifact, which expires after 90 days.
- ⚠️ **TEST mirrors PROD's CATALOGUE — never its DATA, and the distinction is load-bearing.** The
  dump is schema-only (`BASELINE.md`: **0 data statements**), so every `public` table came back
  EMPTY at the restore and holds only what CI has written since. **Consequence, by design and not
  by accident:** a migration in this repo's house style — a data-reading `DO` block that
  `RAISE EXCEPTION`s on an unexpected count — can apply cleanly to PROD and REFUSE on TEST, and
  because a failed TEST apply blocks the PROD apply, that refusal blocks a production deploy.
  Booked as `[164.8-DATA-DEPENDENT-MIGRATION-ESCAPE]`, routed to **Phase 164.9 TESTISOLATION**.
  **Interim remedy: REVERT THE MERGE.** ⛔ Never edit `supabase-migrate.yml` to get a deploy out;
  that is the failure mode the entry exists to prevent.
  ⚠️ Since PR #767 (Phase 164.8.1 REFDATA, merged AFTER the restore above) a FUTURE restore
  replays allowlisted migration-seeded reference data, so "every public table comes back empty"
  describes the 2026-09-08 restore and will not describe the next one. Re-read the allowlist
  rather than this sentence.
- **Every merge touching `supabase/migrations/**` now applies to TEST FIRST.**
  `supabase-migrate.yml`'s `apply-test` (`environment: Test`, no reviewers, and on
  `workflow_dispatch` ref-guarded to `main` by a `dispatch-ref-guard` job whose `if:` is the exact
  inverse of its own) runs `db push --include-all` against TEST holding advisory key `61616158`
  across marker → dry-run → push → post-verify. PROD's `apply` carries
  `needs.apply-test.result == 'success'` AND the `Production` environment's HUMAN reviewer gate —
  both were approved by the founder in the GitHub UI on 2026-09-08. A skipped TEST apply is
  turned into a named red check by `apply-test-verdict` rather than passing as grey.
  ⛔ **CORRECTED 2026-09-23 (Phase 164.4.2):** the `Production` environment's HUMAN reviewer
  gate is GONE. On 2026-09-23 the founder removed the environment's required reviewer ("it
  should just apply. I want to develop fast"). **PROD migrations now auto-apply once
  `apply-test` succeeds.** `needs.apply-test.result == 'success'` is still the ordering between
  them. There is no human stop between a merge that touches `supabase/migrations/**` and its
  PROD apply, so every review a migration needs must happen BEFORE the merge. Do not cite the
  reviewer gate as a stop. The sentence above is kept as lineage.
- **`scripts/vac08-ledger-baseline.txt` is EMPTY by measurement** (0 non-comment lines,
  `ENTRY_COUNT = 0`), beside an AIM and a dated lineage header. It shrinks only; it grows only by
  founder decision. VAC-08's SHA-bound reading, `sql-tests` job `102416204141` in run
  **`34335526540`** at head **`b8951132`**: `ledger presence: 0 absent, all 0 baselined (see
  scripts/vac08-ledger-baseline.txt); 0 NEW drift.`
  ⛔ **CORRECTED 2026-09-23 (Phase 164.4.2):** that reading is historical and stays true
  as lineage. VAC-08 was then a step of `sql-tests`. It now runs in the **`test-db-drift`**
  job (step `VAC-08 - repo-vs-TEST ledger and function body drift`), so take any FUTURE
  SHA-bound VAC-08 reading from `test-db-drift`, never from `sql-tests`.
- ⚠️ **TWO NEW COUPLINGS, both accepted at decision time, both booked as
  `[164.8-PUSH-RACE-VAC08]` and routed to Phase 164.9.** (a) On a merge push, `ci.yml`'s
  `sql-tests` and `apply-test` contend for the SAME advisory key with nothing ordering them —
  measured 2026-09-21: key `61616158` appears 7× in `supabase-migrate.yml` and 27× in `ci.yml`
  (⛔ CORRECTED, superseding the 2026-09-09 reading of 26× for `ci.yml`). ⭐ The key is ALSO
  taken by `test-restore-from-baseline.yml`, `mutex-probe.yml` and `analytics-deploy-verify.yml`,
  so a reader planning a key change is not working from a two-file picture.
  (b) On a PR that ADDS a migration, gates carrying applied-ness probes are RED until merge, by
  construction, because apply-on-merge was chosen over apply-on-PR. A ledger-frontier exemption
  (PR #767) narrows (b) for VAC-08's own verdict and for nothing else.
  ⛔ **CORRECTED 2026-09-23 (Phase 164.4.2) — both halves, originals kept as lineage.**
  (a) The `ci.yml` job that contends with `apply-test` is now **`test-db-drift`**, not
  `sql-tests`. `sql-tests` holds no key. The `ci.yml` jobs that do hold it are `python`,
  `e2e-seeded` and `test-db-drift`, and each runs the schema-apply wait before its acquire
  step. Re-measured 2026-09-23 with `grep -c 61616158`: **29×** in `ci.yml` (`test-db-drift`
  12, `python` 9, `e2e-seeded` 8, `sql-tests` 0), **7×** in `supabase-migrate.yml`. This
  supersedes the 27× reading above.
  (b) **Narrowed for `sql-tests`** by DECISION F. Its lane replays a PR's own new migration
  on top of the committed dump BEFORE merge (see the D-F note below), so its corpus gates
  run against the PR's schema instead of being red until merge. Nothing else about (b)
  changed. Gates that probe SHARED TEST's applied-ness — VAC-08 in `test-db-drift` among
  them — still see the migration only after apply-on-merge.
- ⭐ **D-F, 2026-09-23 (Phase 164.4.2 DECISION F, founder) — the local-stack lane REPLAYS
  migrations newer than its dump.** `scripts/local-stack/run.sh up` (the lane behind
  `sql-tests`, `frontend-local-stack` and `frontend-live-db-lane`) loads
  `supabase/schema/baseline.sql`. It then applies, in filename order, exactly the
  `supabase/migrations/*.sql` files the dump does not already carry, and writes a
  migration-ledger row after each one applies. **The carried set is recorded in
  `supabase/schema/baseline-carried-migrations.txt`**, bound to the dump's sha256.
  `scripts/check-baseline-currency.mjs --replay-set` reads that marker. It prints the replay
  set on a `baseline-replay:` line every run, and fails loud when the set cannot be
  determined: marker absent or bound to another dump, or a dump carrying a migration the
  checkout lacks. A replayed migration that errors is FATAL. Each lane job runs that seam
  as its own step, `Baseline currency - name the migrations the lane replays on top of the
  dump`, before booting. ⚠️ This is the LANE only. The shared-TEST restore path
  (`restore-test-from-baseline.sh`) still REFUSES a dump older than the migrations, through
  the gate's default mode. ⚠️ A re-dump must regenerate the marker in the SAME commit
  (`supabase/schema/BASELINE.md`, `## Regenerating`).
- ⭐ **2026-09-23 (Phase 164.4.2) — the local-stack lane PINS its Postgres image to
  `17.6.1.113`, and the pin is load-bearing.** `LANE_PG_VERSION` in `scripts/local-stack/run.sh`
  is written into the lane's `.temp/postgres-version`, and the boot asserts the running image
  matches it. Without the pin, each Supabase CLI release picks its own image. Images
  `17.6.1.104` through `.112` ship supautils 3.2.0, which kills the backend (signal 11) when a
  `postgres` session `SET ROLE`s to anon/authenticated/service_role and is refused EXECUTE on a
  function. That is the SQL self-test corpus's own idiom. supautils 3.2.2 fixed it upstream, and
  `.113` is the first image that ships it. Every boot also runs a function-denial probe of that
  exact shape before anything loads, so the crash shows up as a named FATAL, never as a
  mid-corpus `server closed the connection`. ⛔ Do not move the pin below `.113`, or unpin it
  to follow the CLI. ⚠️ Whether PROD's own image (`.104` per the drift-check log) crashes the
  same way is UNMEASURED; `TODOS.md` `[164.4.2-PROD-SUPAUTILS-FUNCTION-DENIAL-CRASH]` owns it.

⚠️ TEST is SHARED with other people's CI. A write there is not private, and a global assertion
there is NOT reliable — "no stuck jobs exist", "the table is empty" measure other people's rows
too. Assert about YOUR OWN rows.
⛔ `FANOUT-GLOBAL-01` is NOT a `TODOS.md` id (measured 2026-09-08: 0 hits). It exists only as
prose here and in the ROADMAP. **Phase 164.9 TESTISOLATION owns writing the real entry** — do not
send a planner looking for a spec that was never written.
⛔ **CORRECTED 2026-09-21 (Phase 164.9 plan 01) — the entry now EXISTS; the sentence above is kept
as lineage.** The "0 hits" reading was stale in the letter and correct in the substance: all three
hits measured on 2026-09-21 were PROSE references to `FANOUT-GLOBAL-01` as a failure-mode family
("same shape", "this failure mode"), never as an entry id, so it still had no owner, no date and
no gate until this correction. `TODOS.md` now carries a real `FANOUT-GLOBAL-01` entry in its
`## 🟡 FIX MID-TERM` section, with an owner, a trigger and its five family members named. **The
name was KEPT, not retired** — it is cited by name here, in the `### Phase 164.9` `ROADMAP.md`
entry, and in at least two other `TODOS.md` entries as a family label, and retiring it would
orphan those citations for no gain.

## Test Coverage

`npm run test:coverage` → v8 report (text + HTML + JSON summary in `coverage/`).

**Blocking CI gate.** The vitest shards in `.github/workflows/ci.yml` run with `--coverage` and
emit blob reports; `frontend-coverage` merges them (`vitest run --merge-reports --coverage`) and
enforces the thresholds on full-suite numbers. The `frontend` aggregator gates on it.

⛔ **Read the live thresholds from `vitest.config.ts`, never from a number restated here.** They
are a RATCHET, set a few points under measured actual so a real regression fails CI but noise
does not. When actual climbs durably, raise them to match. Target is 80%, matching the
`--cov-fail-under=80` the `analytics-service/` Python suite enforces (`.github/workflows/ci.yml:3819`).

## SQL gate integrity jobs (v0.77.0.0, Phase 164.3)

The `frontend` aggregator gates more than coverage now. Three jobs in
`.github/workflows/ci.yml` are in both its `needs:` list and its result loop, so
a failure fails the aggregate rather than passing quietly:

- **`sql-mutation`** — mutates every SQL gate arm carrying a `RED-UNDER` annotation, asserts
  the file goes RED with that arm named, restores, asserts GREEN. Exits 1 on an annotation that
  does not bite, on coverage below a ratchet floor pinned at the measured value, on more waived
  arms than `WAIVED_CEILING` in `scripts/mutation-runner/run.mjs`, and when the runner's two
  independent arm tallies (`arms:` vs `lane-invocations:`) disagree. Runs on its own throwaway
  PostgreSQL cluster (`scripts/pg-lane/run.sh`), never against shared TEST — the lane carries
  `shared_preload_libraries=pg_cron` (Phase 164.4.1, +0.009 s/lane), so pg_cron gates run there.
  It prints, and MEASURE_FAILs on the absence of, a `lane-blocked:` line beside a `lane-probe:`
  line measured on the lane itself; pg_cron AVAILABLE with a NON-EMPTY lane-blocked class raises
  `lane-blocked-stale` and exits 1. That tripwire stays live for any future unannotated pg_cron
  gate even though the class is currently empty — it has been observed both firing and clearing.
- **`sql-gate-lint`** — **seven** static rules over `supabase/tests` (`R1-exception-handler-probe`,
  `R2-functiondef-comment-strip`, `R3-additive-diagnostic-narrow`, `R4-tgtype-bitmask-completeness`,
  `R5-fixture-shadows-migration-table`, `R6-fixture-shadows-fixture-table`, `R7-fixture-shadows-policy`),
  each shipped with a red and a green fixture proving the rule can fire.
  ⛔ Do not restate that count from memory — `node scripts/lint-sql-gates.mjs --self-test` prints
  it (`lint-sql-gates self-test OK: 7 rules, red+green each.`). This file said "four" until
  2026-09-08, while a paragraph below it already called the app-GUC linter "not an EIGHTH rule",
  so the file contradicted itself for three rules' worth of drift.
- **`plan-anchor-verify`** — re-resolves every `file:line` anchor and named
  symbol a pending PLAN.md asserts, and fails loud on a miss.

Two more gates live outside the aggregator: **VAC-04** (repo-vs-PROD function
body diff) is a step in `migration-drift-check.yml` on migration PRs, and
**VAC-08** (repo-vs-TEST ledger + body drift) runs in `sql-tests`. Both exit 1
when their credential is absent — neither ever skips.
⛔ **CORRECTED 2026-09-23 (Phase 164.4.2):** VAC-08 runs in the **`test-db-drift`** job
now, not `sql-tests`. `sql-tests` moved to a database private to its own runner, and a
private database has no drift to measure. `test-db-drift` keeps the secret, the
schema-apply wait, the mutex and the `needs: python` stagger. Its `frontend` aggregator
row tolerates only a skip on a fork PR or a `workflow_dispatch`. The original sentence is
kept as lineage.

### Current reading — ⛔ SUPERSEDED. The block below is the 2026-09-07 reading and it is STALE.

⛔ **THE NUMBERS ARE NOT WRITTEN HERE ANY MORE, AND THAT IS THE FIX.** Run this:

```bash
grep -nE '^export const (FILES_FLOOR|ARMS_FLOOR|WAIVED_CEILING)' scripts/mutation-runner/run.mjs
```

**Why the table that stood here was deleted rather than corrected a fourth time.** This section
carried a `constant | shipped value | line` table, and it went stale FOUR times:

| when | prose said | shipped was |
|---|---|---|
| (recorded in `docs/sql-gate-lineage.md`) | 380 | 384 |
| 2026-09-11 → 2026-09-17, six days | 384 | 392 |
| corrected 2026-09-17 morning | 392 | 392 ✅ |
| **same day, hours later** | 392 @ `:1866` | **394 @ `:1909`** |

The fourth one is the argument. The table was written by someone who had just finished writing
the boxed rule two paragraphs below — *"Read `FILES_FLOOR`, `ARMS_FLOOR` and `WAIVED_CEILING` by
SYMBOL … never from a number restated in this file"* — and it was stale again within hours,
because a phase moved the floor and prose does not move with a floor. A restated constant beside
a rule forbidding restated constants is not a documentation slip; it is the defect the rule
describes, sitting inside the rule. The line numbers rot faster still: `:1866` and `:1980` were
both wrong by the next commit, which is the `[164.7-CITATION-DRIFT-01]` class this file already
records elsewhere and answers the same way — cite by symbol, do not re-number prose that will
drift again.

⚠️ **NO arm tally, and now no floor either, is stated here.** A floor implies the corpus holds
at least 392 biting arms, but the tally, the `lane-blocked` class and the `unreachable:` count are
RUN OUTPUTS — inventing them from the floor would be exactly the fabrication this section exists
to prevent. Run `node scripts/mutation-runner/run.mjs` and read them off it.

⛔ **Regenerate, do not trust:** `node scripts/mutation-runner/run.mjs` prints every figure
below. If it disagrees with this block, the RUN is right and this block is stale.

**📜 The 2026-09-07 reading, kept as LINEAGE and superseded as of 2026-09-11:**
`coverage: files 46/73` · `arms: 384/384/0` · `biting: 384` · `lane-invocations: 384` (the two
independent tallies AGREE) · `lane-blocked: 0 file(s)` · `lane-probe: pg_cron AVAILABLE` ·
`pending: 0` · `per-arm lane time: mean 1.1s` · `✅ No defects` · exit 0.
46 annotated + 0 lane-blocked + 27 `unreachable:` (`[REDUNDER-NONIDIOM]`, printed by name every
run) + 0 pending = 73.

⛔ **Read `FILES_FLOOR`, `ARMS_FLOOR` and `WAIVED_CEILING` by SYMBOL from
`scripts/mutation-runner/run.mjs` — never from a number restated in this file.** Prose and
constant have diverged here before (`ARMS_FLOOR` prose said 380, shipped value was 384); the
dated record of that correction is in `docs/sql-gate-lineage.md`.

⛔ **A run that exits NON-ZERO is a regression.** `WAIVED_CEILING` is **0** and has stayed 0
through two founder decisions that each took the root-cause fix over an exception — a REORDER
putting a precondition ahead of its dependants (`[REDUNDER-WAIVER-01]`), and wrapping an INSERT
in the exception idiom its own file already used, so a narrowed unique index reports a named arm
instead of a raw 23505. Do not add a waiver; fix the cause.

⛔ **Two floors, two layers.** `scripts/mutation-runner/run.mjs` gates on `annotatedFiles < filesFloor` and
`bitingArms < armsFloor`, so a floor set BELOW the corpus is invisible to it by construction.
The stale-low direction is caught one layer up by `src/__tests__/mutation-runner-floors.test.ts`
(`RATCHET STALE: … but FILES_FLOOR is still …`). Separating a floor "in both directions" means
the runner for the upper and the vitest ratchet for the lower.

**`sql-gate-lint` also runs `scripts/lint-app-guc.mjs`** — self-test first, then the corpus scan,
both pasted verbatim as a developer runs them. It is a SIBLING of `lint-sql-gates.mjs`, not an
eighth rule of it, because that linter masks comments and string-literal contents while this gate
must COUNT comments (decision D-05). The corpus step is at **0 findings** with five files
annotated (regenerate with `node scripts/lint-app-guc.mjs --self-test` then `node scripts/lint-app-guc.mjs`; do not
trust this count) via a dated `-- APP-GUC-LINEAGE:` header AND an agreeing, count-pinned
`LINEAGE_ALLOWLIST` entry. ⛔ A red corpus step is a regression and is NEVER cleared by widening
the allowlist or relaxing `DETECT_RE`.

**Timeout.** `sql-mutation`'s `timeout-minutes` is **20** — cited BY SYMBOL, not by line: the `sql-mutation:` job key in `.github/workflows/ci.yml` and its own `timeout-minutes:` entry (`grep -n '^  sql-mutation:' .github/workflows/ci.yml`). ⛔ Do not re-introduce line numbers here: this sentence cited `:1259`/`:1069` until 2026-09-11, by which point the job had moved to `:1196` and the timeout to `:1386` — the `[164.7-CITATION-DRIFT-01]` class, whose recorded remedy is to cite by symbol rather than re-number prose that will drift again. It stays there: the rule's one
permitted raise was taken on 2026-09-05 and 20 is a declared CEILING. A future crossing is
answered by `[REDUNDER-SUBSET-SPLIT]`, never by raising again (`ci.yml` carries the derivation).

📜 **Dated lineage for Phases 164.3 → 164.7 — every historical arm tally, ubuntu run id and
superseded CURRENCY paragraph — now lives in `docs/sql-gate-lineage.md`.** It is history; nothing
in it is a live constant.

## Completion is HISTORICAL; drift is a SEPARATE signal (founder decision 2026-09-18)

⛔ **`covered_digest` is BANNED in this repo, and so is `covered_files`.** A verification that
passed STAYS passed. Use `verified_at_sha` + `drift_subjects`, and read drift from
`node scripts/verification-drift-report.mjs`.

**THE DEFECT THIS REPLACES, measured before the decision.** GSD demotes a `passed` verification
to `stale` the moment ANY file in `covered_files` changes. Measured 2026-09-18 across all 28
verifications in this repo:

| | count | behaviour |
|---|---|---|
| carried a `covered_digest` | **7** | **5 were stale** |
| carried none | **21** | read `passed` unconditionally, forever |

The rule was backwards. Listing the files your verdict rested on is what got the verdict revoked;
listing nothing bought permanent trust. And in a repo whose phases deliberately layer on the same
prober, CI and migration files, that is structural: Phase 164.1.1 was `passed` and went `stale`
two hours later because a bug fix touched two files it had listed, with nothing about its verdict
in question. ⛔ **A milestone could never close, because the more carefully a phase was verified
the less likely it was to count as done.** Founder call: completion is a historical fact about a
verdict validly issued; drift is a prompt to re-decide, not a demotion. Recomputed immediately
after: 20/45 → **24/45**.

**THE MECHANISM.** `readVerificationStatus` opts a report into the fingerprint check by seeing
`covered_files` OR `covered_digest` in frontmatter. Declaring NEITHER falls back to the narrow
legacy check — is one of this phase's OWN SUMMARYs newer than its VERIFICATION — which is the
right trigger: the phase's own artifacts moving means re-verify; shared source moving does not.
So the fix is repo-owned and survives `/gsd-update`, rather than being a patch to a global file
that gets wiped.

```yaml
status: passed                  # never demoted by drift
verified_at_sha: <full sha>     # the commit the verdict was issued at
drift_subjects:                 # what the verdict rested on; NOT a gate
  - scripts/prod-prober/run.mjs
```

⚠️ **The global `gsd-verifier.md` still writes `covered_files` + `covered_digest`, and
`/gsd-update` overwrites that file.** After ANY verifier run, convert the pair: drop
`covered_digest`, rename `covered_files` → `drift_subjects`, add `verified_at_sha`. This is why
the rule lives here and not only in the workflow.

⛔ **`scripts/verification-drift-report.mjs` ALWAYS EXITS 0 and must never gate a merge.**
Anything that makes drift blocking re-creates the exact defect this section exists to remove.

⛔ **`TODOS.md`, `CHANGELOG.md`, `VERSION` and `package.json` NEVER belong in `drift_subjects`**
(the rule that used to say `covered_files`, and it still holds). They are repo-global ledgers that
every phase touches, so covering one makes an unrelated backlog edit report drift that says
nothing about the phase. MEASURED 2026-09-18: 164.8.3 carried `TODOS.md`; stripped.
⚠️ Grepping for the STRING `TODOS.md` in a verification over-counts badly — 163, 164.3 and
164.8.6 merely name it in prose.

⚠️ **This is NOT a reason to strip real source files from `drift_subjects`.** If
`analytics-service/routers/match.py` changes, a phase that verified it SHOULD show drift — that is
the signal doing its job. What changed is the CONSEQUENCE: a report, not a revoked verdict.

## CHANGELOG discipline (founder instruction, 2026-09-09)

⛔ **EVERY ship writes a CHANGELOG entry. No exceptions, and this OVERRIDES the three-sentence
CHANGELOG step in `gsd-core/workflows/ship.md`.** That step is taste guidance with no mechanism —
whether a commit reaches the entry depends on the model's attention. MEASURED 2026-09-09: commit
`8677c790` shipped 672 changed lines, two rebuilt gates and a new routed deferral with **no entry
and no version bump**, while a smaller commit the same day got both. A step that cannot fail did
not fail; it was simply skipped.

**THE MECHANISM — adopted from `~/.claude/skills/gstack/ship/sections/changelog.md`, which has
one and is therefore the better instruction. Run it in this order:**

1. `git log <base>..HEAD --oneline` — enumerate EVERY commit on the branch. **Count them.**
   This list is a CHECKLIST, not background reading.
2. `git diff <base>...HEAD` — read the full diff. What a commit *says* and what it *changed*
   diverge, and this repo has a dated record of that class.
3. **Group by theme BEFORE writing a line.** New capability · behaviour change · bug fix ·
   removal · infrastructure/tooling/tests · refactor.
4. Write ONE unified entry per version, newest first, `## [X.Y.Z.B] - YYYY-MM-DD`. If entries
   for earlier commits on the same branch already exist, REPLACE them with the unified one.
5. ⛔ **CROSS-CHECK, and treat a miss as a defect:** every commit from step 1 must map to at
   least one bullet. N commits over K themes ⇒ all K themes present. An unrepresented commit is
   not "minor", it is an unshipped fact.
6. Never ask the founder to describe the changes. Infer them from the diff and the history.

**Section vocabulary — this repo's own, NOT keep-a-changelog's four.** Measured across
`CHANGELOG.md`: `### Fixed` (205), `### Added` (141), `### Changed` (140), `### Removed` (24),
`### Tests` (20), `### Notes` (17), `### Security` (11), `### Root cause` (6), `### Why` (4).
Use the one that fits; do not flatten a root-cause note into "Fixed".

⚠️ **ONE gstack rule deliberately NOT adopted, so the divergence is a decision and not drift.**
gstack says *"lead with what the user can now do … never mention TODOS.md, internal tracking, or
contributor-facing details."* That fits a product changelog and fights this one: the entries here
are largely infrastructure — SQL gates, mutation runners, restore lanes — with no end-user verb,
and they deliberately name phases, TODOS ids and routed deferrals so the release notes and the
ledger agree. Keep THIS repo's voice: say what changed, what it means for whoever reads it next,
and carry the known limits and anything recorded-rather-than-fixed. Import gstack's MECHANISM,
not its audience.

⛔ **The entry is written BEFORE the push, in the same commit as the VERSION bump**
(`chore(release): vX.Y.Z.B — <name>`), so a filtered `-pr` branch cherry-picks it: VERSION,
package.json and CHANGELOG.md are non-planning paths and always survive the filter.
⚠️ `VERSION` and `package.json` must be BYTE-EQUAL 4-digit strings — `src/__tests__/critical-regressions.test.ts`
asserts it. Never run `npm version` (it rewrites the lockfile and can normalise to 3 digits).

⚠️ **Nothing in CI enforces any of this yet**, which is why it lives HERE rather than only in the
global workflow file — `/gsd-update` overwrites `~/.claude/gsd-core/workflows/ship.md` and has
already eaten one edit to it. The durable backstop is a repo-owned gate that fails a PR touching
non-planning paths without moving `VERSION`; until that exists, this section is the rule.

## CI gate integrity — two traps that both cost this repo a session (measured 2026-09-17)

Both were already known and written down OUTSIDE the repo. Both recurred anyway. That is the
argument for this section existing here: a rule that lives only in a model's memory or a global
workflow file is not a gate, and `/gsd-update` overwrites the global file.

### 1. The skip trailer suppresses CI even inside a sentence DENYING it, and it survives a squash

GitHub honours these tokens **anywhere** in a commit message — subject, body, a quotation, a
sentence explaining that you are not using them:

```
[skip ci]   [ci skip]   [no ci]   [skip actions]   [actions skip]   skip-checks:true
```

⛔ **Never write one in a commit message or a PR body, not even to deny it.** Say "the skip
trailer" in prose. MEASURED 2026-09-17: a ship-note commit whose message read *"No [token]
trailer: the token wedges a PR…"* produced **zero** workflow runs for its SHA.

⛔ **The board does not say "absent", it says "clean".** With CI suppressed, the PR showed its two
Vercel checks and nothing else. Two green checks read as a healthy board. Do not count "no red";
**count the checks and bind them to the head SHA**:

```bash
gh api "repos/AI-Isaiah/Quantalyze/actions/runs?head_sha=<sha>" -q '.workflow_runs | length'
```

⛔ **Pushing a token-free commit on top repairs the PR BRANCH ONLY.** A squash merge concatenates
**every** branch commit message into the merge commit body, so the offending text rides into
`main`. MEASURED: it landed at line 1143 of merge commit `5b6b7886` and `main` got zero runs.
The fix is to not write the token at all; once it is in a branch commit, the squash body carries it.

⚠️ **Railway deploys anyway.** "No CI at all" is not "CI red", so the skip-if-red guard never
engages. The 2026-09-17 deploy was safe only because `tree(5b6b7886) == tree(4c93a23c)` — the
merge carried the exact tree that had passed 27 green checks. That was a measurement taken after
the fact, not a control.

### 2. `workflow_dispatch` on `main` scans a DIFFERENT scope than a push, and goes red on history

⛔ **There is no working way to re-trigger a lost push-to-`main` gate set today.** `gh workflow run
CI --ref main` carries no commit range, so `gitleaks-action` walks the **full history** at
`fetch-depth: 0`, while a genuine push scans only the pushed squash commit. Measured side by side:

```bash
gitleaks git . --config .gitleaks.toml --log-opts=de66d1b0..5b6b7886   # 1 commit   → no leaks found
gitleaks git . --config .gitleaks.toml                                  # 4491 commits → 37 leaks
```

The 37 are pre-existing credential-**shaped** fixture literals quoted in CHANGELOG prose, all from
2026-09-11 (Phase 164.8.5). They are latent and would surface in any future full-scope scan.
Booked as `.planning/WINDOWS.md` entry **61**, which owns both halves.

⛔ **Do not read that red as a verdict on the SHA.** Re-measure a specific commit with the RANGE
form above. And per the standing gitleaks rule: never quote a credential-shaped fixture literal
verbatim in CHANGELOG prose — the push-to-`main` scan sees one squash commit whose diff includes
`CHANGELOG.md`, which the branch-scoped allowlist does not cover.

## Design System
Always read DESIGN.md before making any visual or UI decisions.
All font choices, colors, spacing, and aesthetic direction are defined there.
Do not deviate without explicit user approval.
In QA mode, flag any code that doesn't match DESIGN.md.

## GSD orchestration rules (measured 2026-09-08 — both of these cost time this session)

⛔ **Never dispatch a `gsd-*` agent yourself. Run the WORKFLOW'S dispatch step, preamble
included.** Invoking the Skill is NOT sufficient — you can invoke it and then hand-dispatch from
inside it, which is what happened. In `execute-phase` the preamble resolves isolation via
`gsd_run query dispatch-isolation`, and that call's SIDE EFFECT is writing
`.gsd/dispatch-isolation-sentinel.json`, which the isolation guard hooks read. Skip it and the
guard refuses the dispatch with a message that looks like a config bug and is not.
Recovery: `worktree.reap-orphans`, honour `worktree.base-check` (it auto-degrades to `none` when
`origin/HEAD` has diverged from `HEAD` — correct, since a harness worktree forks from
`origin/HEAD` and would lack the branch's work), then
`record-dispatch-isolation --isolation <verdict> --phase <n>`.
⚠️ `inspect-dispatch-isolation` reports the HOST CAPABILITY, not the recorded verdict — read the
sentinel FILE to confirm.

⛔ **`gsd-tools` state handlers CLOBBER `STATE.md` and `ROADMAP.md`.** `state.advance-plan`
returns an error AND WRITES ANYWAY; `roadmap.update-plan-progress` injects stray bullets into
unrelated phase sections. Both were hit in this repo. Prefer hand-editing those two files; if you
use a handler, `git diff` the result and revert every collateral change before committing.
Note `state.add-roadmap-evolution` also recomputes the `progress:` block from local disk as an
undocumented side effect — that count under-reports phases whose `.planning/phases/` artifacts the
`-pr` filter stripped from `main`.
