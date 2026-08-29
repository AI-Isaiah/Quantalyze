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
| `--apply <f...>` | SQL files applied in order, quietly, before the gate. Fixtures first, then migrations. |
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

## The other two entry points

```bash
bash scripts/pg-lane/run.sh                 # legacy demo — fixtures + the two
                                            # Phase 164 migrations + the 103-arm gate
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

`fixtures/01-fixture-core.sql` and `fixtures/02-fixture-sanitize-tables.sql` are
**STAND-INS**: they carry only the columns the migrations' FKs, policies, RPCs and
`sanitize_user` body actually name. The objects *under test* — `strategy_shares`,
its trigger, its grants, its policies, both RPCs — are the **real** ones from the
real migration files.

So the lane proves the DDL applies, the self-verification blocks bite, and the
gate's arms pass and can fail. It does **not** prove behaviour against the real
schema's own RLS, constraints or triggers. That still belongs to the TEST
hand-apply.

**Fixture extensions made for the gate file: none.** Both fixtures were promoted
byte-identical from `pg-harness/`; the 103-arm gate needed nothing added.

## Measured runtime (2026-08-29, macOS, postgresql@16)

| Run | Wall clock |
|---|---|
| one full lane run (boot + 2 fixtures + 2 migrations + 103-arm gate) | **~2 s** |
| `--tracer-proof` (two full lane runs + copy/mutate) | ~5 s |

Budgeting note for the corpus run: ~2 s per arm, so 30 arms ≈ 1 minute of lane
time. Minutes, not hours.
