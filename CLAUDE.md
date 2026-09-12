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

- **TEST's `public` schema is a copy of PROD's catalogue.** Restore run **`34274355596`**, head
  **`88581b8bc66415bfa86b7d5a019741b1cbd0ff49`**, COMMITTED: `public` was dropped and rebuilt from
  `supabase/schema/baseline.sql` at sha256 `27826b76…` (the sha recorded in `BASELINE.md`, not a
  fresh dump), inside the held shared-TEST mutex, behind an activity gate and a backup artifact.
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
- **`scripts/vac08-ledger-baseline.txt` is EMPTY by measurement** (0 non-comment lines,
  `ENTRY_COUNT = 0`), beside an AIM and a dated lineage header. It shrinks only; it grows only by
  founder decision. VAC-08's SHA-bound reading, `sql-tests` job `102416204141` in run
  **`34335526540`** at head **`b8951132`**: `ledger presence: 0 absent, all 0 baselined (see
  scripts/vac08-ledger-baseline.txt); 0 NEW drift.`
- ⚠️ **TWO NEW COUPLINGS, both accepted at decision time, both booked as
  `[164.8-PUSH-RACE-VAC08]` and routed to Phase 164.9.** (a) On a merge push, `ci.yml`'s
  `sql-tests` and `apply-test` contend for the SAME advisory key with nothing ordering them —
  measured 2026-09-09: key `61616158` appears 7× in `supabase-migrate.yml` and 26× in `ci.yml`.
  (b) On a PR that ADDS a migration, gates carrying applied-ness probes are RED until merge, by
  construction, because apply-on-merge was chosen over apply-on-PR. A ledger-frontier exemption
  (PR #767) narrows (b) for VAC-08's own verdict and for nothing else.

⚠️ TEST is SHARED with other people's CI. A write there is not private, and a global assertion
there is NOT reliable — "no stuck jobs exist", "the table is empty" measure other people's rows
too. Assert about YOUR OWN rows.
⛔ `FANOUT-GLOBAL-01` is NOT a `TODOS.md` id (measured 2026-09-08: 0 hits). It exists only as
prose here and in the ROADMAP. **Phase 164.9 TESTISOLATION owns writing the real entry** — do not
send a planner looking for a spec that was never written.

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

### Current reading — 2026-09-07, Phase 164.7 (a DATED reading, not a constant)

⛔ **Regenerate, do not trust:** `node scripts/mutation-runner/run.mjs` prints every figure
below. If it disagrees with this block, the RUN is right and this block is stale.

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
