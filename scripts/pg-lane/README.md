# `scripts/pg-lane` — the disposable-PostgreSQL lane

One command boots a throwaway PostgreSQL cluster, applies SQL files, runs a gate
file, and removes everything it created — on success, on failure, and on
interrupt. It never touches TEST or PROD.

Promoted (VAC-02 / D-03) from the mid-phase harness at
`.planning/phases/164-share-copy-link-always-works-and-never-discloses/pg-harness/run.sh`,
with its three measured defects fixed. Read [Why it exists](#why-it-exists)
before changing the CLI: the mutation runner, the CI job and Phase 164.4's
backfill oracle all stand on this contract.

## CLI contract

⚠️ **This block is pasted VERBATIM into `ci.yml`.** Local and CI invocations must
be byte-identical in *mode*, not merely equivalent in intent — a wrapper that
changes the invocation changes the result (see
`reference_gstack_evidence_wrapper_reddens_suite`).

```bash
bash scripts/pg-lane/run.sh \
     --workdir <scratch-dir> \
     --apply <file.sql> [<file.sql> ...] \
     [--post-apply <file.sql>] \
     --gate <gate.sql>
```

| Flag | Meaning |
|---|---|
| `--workdir <dir>` | scratch dir. The cluster lives at `<dir>/pgd` and is removed on exit; **the workdir itself belongs to the caller** and is never removed. |
| `--apply <f...>` | SQL files applied in order, quietly, before the gate — **the order given is the order applied**. Stand-in fixtures usually come first, then migrations, but that is a default and not an invariant: a stand-in that PATCHES a table a migration creates must follow that migration. Live example: `fixtures/04-fixture-compute-jobs-targets.sql` adds columns to `compute_jobs`, so it is applied *after* `20260411144407_compute_jobs_queue.sql`. |
| `--post-apply <f>` | optional, runs after `--apply` and before `--gate`. This hook exists for the mutation runner's **live-DB `GRANT`-shape mutations** (D-14 shape 2), which are not file edits. |
| `--gate <g>` | the file under test. Its psql output streams to stdout/stderr. |

Exit codes:

| Code | Meaning |
|---|---|
| `0` | the gate passed |
| `2` | **port collision — refused.** Something was already listening; the lane will not attach to a cluster it did not create. |
| `130` / `143` | SIGINT / SIGTERM (routed through the EXIT trap, so cleanup still runs) |
| other | the failing step's own status (psql returns `3` on a gate `RAISE EXCEPTION` under `ON_ERROR_STOP=1`) |

Environment overrides: `PGBIN` (server-binaries dir) and `PORT` (pin a port
instead of auto-allocating). `PGD` is **not** overridable — it is derived from
`--workdir` so cleanup owns exactly what this run made.

## The other three entry points

```bash
bash scripts/pg-lane/run.sh                 # legacy demo — fixtures + the two
                                            # Phase 164 migrations + the 103-arm gate
bash scripts/pg-lane/run.sh --self-test     # prove the guard and the cleanup CAN fail
bash scripts/pg-lane/run.sh --tracer-proof  # SHAPE 1c: mutate -> RED -> pristine -> GREEN
```

### `--tracer-proof`

The phase's thinnest end-to-end slice (D-02, D-14). It copies the fixtures, the
two migrations and `supabase/tests/test_strategy_shares_rls.sql` into a scratch
dir, mutates **only the copy**, and asserts:

1. the mutated run exits non-zero, **and the FIRST `TEST FAILED (…)` line names
   `SHAPE 1c`** — first-failure identity, not red-anywhere. "The file went red"
   is satisfied by a mutation that breaks something else entirely, which would be
   a vacuous check inside the vacuity detector;
2. the pristine run exits 0.

⚠️ **Measured byte deviation from the arm's prose annotation.** `SHAPE 1c`'s
`RED-UNDER` reads *"change `generation BIGINT` back to `generation INTEGER` in
the STEP 1 CREATE TABLE"*. The literal single-space string `generation BIGINT`
occurs **exactly once** in that migration and it is **not** the CREATE TABLE
column — it is `RETURNS TABLE (generation BIGINT, nonce UUID)` at line 828.
Mutating that one instead trips the migration's own verification block (line
1181) and **aborts the apply**, so the gate never runs and no arm can be the
first failure. The column declaration at line 170 carries two spaces. The tracer
therefore pins the real bytes and refuses any occurrence count other than 1
(`MEASURE_FAIL`). This is the prose-locator hazard RESEARCH §Q3 predicted, and it
is why the structured `RED-UNDER-M` annotation must carry executable bytes rather
than a prose locator.

### `--self-test`

Four checks, in order. It exists because a control that cannot fail is worse than
no control:

1. **occupied-port refusal** — stands up a real cluster, then points a second
   lane run at the same port and requires exit `2` plus the refusal message, and
   that no data dir was created before refusing;
2. **kill mid-run leaves no orphan** — launches a run in its own process group,
   signals it (`SIGTERM`, then `SIGINT`) once the cluster is up, and requires that
   nothing is listening on the run's port and the data dir is gone. This is the
   check that discharges D-04's *"including on failure and on interrupt"*;
3. **failure-path cleanup** — a deliberately failing gate: non-zero exit **and**
   full cleanup;
4. **success-path cleanup** — a passing gate: exit 0 **and** full cleanup.

**Anti-vacuity evidence (2026-08-29).** The trap registration was neutered in a
scratch copy of the script and the copy's self-test was observed **RED**:
`SELF-TEST FAIL: SIGTERM mid-run: a postgres is STILL listening on
127.0.0.1:59794 — orphaned cluster`. The neutered copy was discarded; nothing
neutered is committed.

## Why it exists

Phase 164's red-team synthesis (`PROC-01`) found a 456-line migration and a
536-line gate authored, committed, declared done and reviewed by three
specialists with **zero executions**. This is the missing oracle. Run it before
asking anyone to review a migration.

### The three defects fixed in the promotion

| Defect in `pg-harness/run.sh` | Fix |
|---|---|
| `PGBIN=${PGBIN:-/opt/homebrew/opt/postgresql@16/bin}` — macOS-only; would not start on an ubuntu runner (D-07) | resolution chain: `pg_ctl` on PATH → `pg_config --bindir` → `/usr/lib/postgresql/*/bin` → `/opt/homebrew/opt/postgresql@*/bin` → fail loud |
| `PORT=${PORT:-55432}` — a fixed port serialised concurrent agents (D-07) | bind port 0 via node and let the OS choose; the `pg_isready` guard still covers the TOCTOU window |
| **no `pg_ctl stop`, no `trap`, no `rm` anywhere** — measured 2026-08-28: 27 orphaned Postgres volumes (904 MB) and a container up 10 days, contributing to a disk-exhaustion incident (D-04) | `cleanup()` on `EXIT`, registered **before** `initdb`, with `INT`→130 and `TERM`→143 routed through it; a `CREATED` flag set only after this run makes its own data dir; original exit status preserved |
| `sleep 2` after `pg_ctl start` — a race | `pg_ctl -w` plus a bounded `pg_isready` loop |

### What survived the promotion verbatim

The collision guard (D-03 requires it), the `psqlq()` wrapper with
`-v ON_ERROR_STOP=1`, `-k ''` (TCP only — a unix socket under a scratch path
blows the 103-byte path limit), and the fixture STAND-IN disclaimer below.

> ⛔ **Never reuse a cluster we did not create.** `01-fixture-core.sql` opens with
> `DROP SCHEMA public CASCADE`, so attaching to a port another agent is already
> using destroys their database underneath them. Measured 2026-08-28: a reviewer
> lost an entire session this way and only noticed because `sanitize_user`
> vanished from `pg_proc` after it had already called it.

## ⚠️ What the fixtures do and do not prove

**Every file under `fixtures/` is a STAND-IN** — the rule is scoped to the
*directory*, not to a list of filenames, so a fixture added later is covered on
the day it lands. Stand-ins carry only the columns the migrations' FKs, policies,
RPCs and function bodies actually name. The objects *under test* —
`strategy_shares`, its trigger, its grants, its policies, both RPCs — are the
**real** ones from the real migration files.

So the lane proves the DDL applies, the self-verification blocks bite, and the
gate's arms pass and can fail. It does **not** prove behaviour against the real
schema's own RLS, constraints or triggers. That still belongs to the TEST
hand-apply.

**The directory holds four fixtures** (measured on disk 2026-09-02):

| Fixture | Provenance |
|---|---|
| `01-fixture-core.sql` | promoted **byte-identical** from `pg-harness/` (verified with `cmp`) |
| `02-fixture-sanitize-tables.sql` | promoted **byte-identical** from `pg-harness/` (verified with `cmp`) |
| `03-fixture-compute-jobs.sql` | authored for the **164.4 backfill** — additive stand-ins for the relations the compute-jobs queue migrations name as dependencies |
| `04-fixture-compute-jobs-targets.sql` | authored for the **164.4 backfill** — additive `compute_jobs` TARGET columns; **applied after** the migration that creates the table (see the `--apply` row above) |

The 103-arm `strategy_shares` gate needed nothing added to `01`/`02`; `03` and
`04` exist only for the gates the 164.4 backfill annotates.

## pg_cron on the lane (Phase 164.4.1)

Every lane preloads `pg_cron`. This is substrate, not an option: `pg_cron`
refuses to load outside `shared_preload_libraries`, and that GUC can only be set
at postmaster start — which the lane performs exactly once per invocation.

**Why the lane needs it at all.** Five idiom gate files probe `pg_extension` for
`pg_cron`, and **three of them read `cron.job.command` as an ORACLE** for the
deployed job body. Without the extension those files cannot be falsified at all;
they were parked as `lane-blocked:` for exactly that reason (`[REDUNDER-PGCRON]`)
until this phase retired the deferral. A shim providing just a `cron` schema was
costed and rejected **by measurement**: to satisfy those oracles it would have to
reimplement `cron.schedule()` faithfully enough to persist a command body
verbatim — an oracle written by the same hand as the claim — while the real
extension costs nothing measurable (below).

**The three GUCs on the single `pg_ctl -o` string**, each with its measured
reason:

| Setting | Why |
|---|---|
| `shared_preload_libraries=pg_cron` | the only way pg_cron loads; the lane starts its postmaster once, so `-o` needs no restart and no `postgresql.conf` edit |
| `cron.database_name=postgres` | the lane's database IS `postgres`, which is also pg_cron's current default — **stated rather than defaulted**, so an upstream default change cannot move the worker's target with nothing here to notice |
| `cron.max_running_jobs=0` | the GUC's minimum is `0` in pg_cron 1.6.7 and at `0` the launcher never starts a job. Without it, a lane whose apply list schedules a `*/15 * * * *` reaper and happens to straddle `:00/:15/:30/:45` would run that job body concurrently with the gate. The gates read `cron.job` **rows**; no gate needs a tick |

**⛔ The lane does NOT run `CREATE EXTENSION`.** A gate declares that need itself
by listing `supabase/migrations/20260513094906_enable_pg_cron.sql` in its
`RED-UNDER-SETUP` apply list — the corpus discipline is that a gate declares what
it needs, and the repo already carries the platform's real enabling migration, so
a fixture standing in for it would be a stand-in for something real. The preload
is the one half that *cannot* live in an apply list, so it is the only half that
is substrate. Both halves are required: preload without `CREATE EXTENSION` leaves
`pg_extension` empty and the gates still RAISE; `CREATE EXTENSION` without the
preload fails outright.

**What "absent" looks like.** The lane FAILS; it never degrades and never
installs anything itself. Two layers produce one message — a pre-start check
(where `pg_config` is available) that refuses before `initdb`, and a read of the
postmaster's own `could not access file "pg_cron"` out of `pg.log` (the path an
ubuntu runner with no `pg_config` takes):

```
ERROR: pg_cron is NOT available to the PostgreSQL server binaries this lane booted.
  missing:         /opt/homebrew/opt/postgresql@16/lib/postgresql/pg_cron.so (and pg_cron.dylib) — neither exists
  server binaries: /opt/homebrew/opt/postgresql@16/bin
  ...
  ubuntu: sudo apt-get install -y postgresql-$(pg_config --version | awk '{print $2}' | cut -d. -f1)-cron   # 16 on ubuntu-latest
  macOS:  bash scripts/pg-lane/install-pg-cron-macos.sh
```

**Provisioning is the host's job, and it has two routes:**

| Host | Route | Version |
|---|---|---|
| macOS | `bash scripts/pg-lane/install-pg-cron-macos.sh` — builds the pinned upstream tag `v1.6.7` from source against the `postgresql@16` keg, sha256-verified before `make` | read it from the script's own `default_version:` print |
| ubuntu CI | the `Provision pg_cron for the lane's PostgreSQL (Phase 164.4.1)` step in `.github/workflows/ci.yml` — `sudo apt-get install -y --no-install-recommends postgresql-16-cron` | read it from that step's `dpkg -s … Version:` print |

⚠️ **A MINOR-version skew between the two hosts is expected** (macOS builds
1.6.7 from source; ubuntu takes whatever apt serves for PG16). Both provide
`cron.job`, `cron.schedule`, `cron.unschedule` and the `pg_extension` row, which
is everything the gates read, and both are PostgreSQL major **16** — the property
that matters. ⭐ Read each version from its own print above; neither is restated
here, because a version in prose is a dated claim and these two move
independently.

⛔ Homebrew's `pg_cron` formula is not a route: it declares `postgresql@17` and
`postgresql@18` only, so it emits no `@16` artifact, and a library built for
another server major fails to load with a message byte-identical to "not
installed at all".

**Measured preload cost (2026-09-04, this box, macOS 16.13, `run.sh` end to end,
3 samples each side):**

| Arm | Samples (s) | Mean |
|---|---|---|
| BEFORE the preload | 0.98 / 0.84 / 0.93 | **0.917** |
| AFTER the preload | 0.98 / 0.94 / 0.88 | **0.933** |

**+0.016 s/lane with fully overlapping ranges**, and no AFTER sample above the
slowest BEFORE — indistinguishable from noise, and consistent with the isolated
5×2 A/B that measured +0.009 s. ⚠️ These are macOS numbers. The preload delta is
a property of the postmaster and should transfer, but the ubuntu figure is the
`per-arm lane time:` line the corpus run prints on CI — read that, not this
table, before projecting a CI wall clock.

## Measured runtime (2026-08-29, macOS, postgresql@16)

| Run | Wall clock |
|---|---|
| one full lane run (boot + 2 fixtures + 2 migrations + 103-arm gate) | **~2 s** |
| `--tracer-proof` (two full lane runs + copy/mutate) | ~5 s |
| `--self-test` (four checks, two of which wait on a signalled run) | ~39 s |

Budgeting note for the corpus run: the cost is one lane per annotated arm, so
the total is (arms + 2) x the per-lane figure above — a baseline and a restore
leg on top of the arms. No arm COUNT is restated here on purpose: the runner
prints `per-arm lane time: mean <t>s over <n> arm run(s)` on every run and that
line is the current measurement. Minutes, not hours — measured 0.9 s/arm over
45 arms on 2026-09-03 (plan 164.4-02).
