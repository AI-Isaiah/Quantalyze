# VAC-07 replay spike — does the migration chain replay from scratch?

**Phase 164.3, plan 04, Task 1. Measured 2026-08-29. This file records a MEASUREMENT,
not a plan.** RESEARCH A4 rated this HIGH risk and D-15 ordered it spiked before anything
was built on it. It was spiked. It failed. This is what failed and why.

## Answer, up front

**NO. The chain does not replay from scratch — not under the Supabase CLI, and not under
`psql` either.** 262 migration files; **69 fail**, 193 apply. The failure is not a single
unlucky migration and not an artifact of one applier: there are **at least six independent
root causes**, one of which is a migration that *deliberately refuses* to run against a
database it cannot identify.

`supabase db reset` therefore **cannot** be the schema source for this lane.

## Environment measured

| Item | Value |
|------|-------|
| Supabase CLI (local) | **2.84.2** |
| Supabase CLI (CI, pinned) | **2.98.2** — `.github/workflows/supabase-migrate.yml:171,205` |
| Docker server | 29.5.3 |
| Postgres (stack) | 17 (`supabase/config.toml:36`) |
| psql client | 16.x (`/opt/homebrew/opt/postgresql@16/bin/psql`) |
| Migration files | **262** (`20260405061911_initial_schema.sql` … `20260827130000_…`) |
| Target | LOCAL stack only — `127.0.0.1:54421` / `127.0.0.1:54422`. This worktree is **unlinked** (`supabase/.temp/` holds only `cli-latest`; no `project-ref`, no `linked-project.json`). No remote was contacted at any point. |

## Timings

| Run | Wall clock | Outcome |
|-----|-----------|---------|
| `supabase start` (cold — image pull included) | **11m 02s** | **FAILED** at migration 51 |
| `supabase start` (warm images, migrations skipped) | **50.8s** | OK |
| `psql` replay of all 262 files, stop-on-first-error | 3.6s | FAILED at migration 51 (a *different* one) |
| `psql` replay of all 262 files, continue-on-error | **16.8s** | 193 OK / **69 FAIL** |

The 11m cold start is one-time image-pull cost, not chain cost. The chain itself replays in
**seconds** — speed was never the problem. Correctness is.

## Finding 1 — the CLI applier cannot run `CREATE INDEX CONCURRENTLY`

`supabase start` / `supabase db reset` died at:

```
Applying migration 20260416125432_rebalance_drift_weekly_index.sql...
ERROR: CREATE INDEX CONCURRENTLY cannot be executed within a pipeline (SQLSTATE 25001)
```

The CLI sends each migration's statements in a **libpq pipeline**, which is an implicit
transaction boundary, and Postgres forbids `CREATE INDEX CONCURRENTLY` there for the same
reason it forbids it inside `BEGIN/COMMIT`. The migration is not wrong — it documents this
constraint in its own header and is deliberately the repo's single non-transactional file.
**The applier is the mismatch.**

This is not a one-off: **20 migrations use `CONCURRENTLY`.**

Under `psql` (simple query protocol, no pipeline) this migration **applies cleanly** — proving
the diagnosis. So Finding 1 alone would have been survivable by changing applier. Findings 2+
are not.

⚠️ **Version skew, unresolved and deliberately not papered over:** local CLI is 2.84.2; CI pins
**2.98.2**. Finding 1 *may* behave differently on 2.98.2. It was **not** tested there — installing
a CLI version is out of scope for this plan (and package installs are not auto-fixable). It does
not change the verdict, because Findings 2–6 are `psql`-level and no CLI version fixes them.

## Findings 2–6 — the SQL itself does not replay

Measured under `psql`, i.e. with the pipeline problem removed entirely.

| # | Root-cause migration | Error | Why |
|---|---------------------|-------|-----|
| 2 | `20260416201929_audit_log_hardening.sql` | `syntax error at or near "TO"` | `SAVEPOINT` / `ROLLBACK TO SAVEPOINT` inside a `DO $$` block. PL/pgSQL rejects explicit savepoints at compile time. |
| 3 | `20260417031851_user_app_roles.sql` | `syntax error at or near "TO"` | Same savepoint-in-`DO` pattern. **Highest-impact root cause** — it creates `user_app_roles` and `current_user_has_app_role()`, so ~20 later failures are its cascade. |
| 4 | `20260515113637_resend_message_correlation.sql` | `syntax error at or near "DELETE"` | Same class: a statement not legal inside PL/pgSQL. |
| 5 | `20260510181440_trades_side_check_constraint.sql` | self-verify `RAISE`: "does not constrain side to {buy,sell}. Got definition: `CHECK ((side = ANY (ARRAY['buy'::text, 'sell'::text])))`" | The probe **text-matches** a constraint definition. The definition it got is correct; the probe's expected string is format/version-coupled. A self-verifying migration whose verification is environment-dependent. |
| 6 | `20260515114555_compute_jobs_claim_token_fencing.sql` | `function name "claim_compute_jobs_with_priority" is not unique` | Overload resolution depends on which earlier overloads exist — order/state coupled. |
| 7 | `20260823120000_revoke_api_keys_insert.sql` | `ABORT: unidentified database — neither the PROD census signature … nor an e2e seed signature is present` | **Refuses by design** to run on a database it cannot identify. This migration can *never* replay onto a fresh local DB. |

Finding 7 is decisive on its own: it is not a bug to be fixed, it is an intentional guard.
Any "make the chain replayable" effort must answer it explicitly.

The remaining ~62 failures are cascades of 2–7 (`relation "strategy_verifications" does not
exist`, `function public.current_user_has_app_role(text[]) does not exist`, `column
"api_key_id" does not exist`, …). Cascades are reported as failures rather than hidden,
because a partially-applied schema that "mostly worked" is exactly the vacuity this phase exists
to eliminate.

## A5 — does the stack serve the app's protocols? YES (measured, not assumed)

RESEARCH A5 was an assumption. It is now a measurement, taken against the running local stack:

| Probe | Result |
|-------|--------|
| `GET {API_URL}/rest/v1/` with anon key | **200** (PostgREST answers) |
| `GET {API_URL}/auth/v1/health` | **200** — `{"version":"v2.188.1","name":"GoTrue",…}` |

So D-15's premise holds: the CLI local stack **does** serve PostgREST + GoTrue, which a bare
`initdb` cluster structurally cannot. The two-lane design is correct. Only the *schema source*
for this lane is in question.

## What this rules out

- ❌ `supabase db reset` as schema source — Finding 1, and Findings 2–7 underneath it.
- ❌ Switching the applier to `psql` — clears Finding 1 only; 69 files still fail.
- ❌ Editing the offending migrations — **migrations are immutable history here**; merging
  `supabase/migrations/**` to main auto-applies to PRODUCTION. Not on the table, and this plan
  changed no migration file.
- ❌ Accepting the 193-of-262 partial schema — a silently-wrong baseline is the exact defect
  class this phase exists to catch. The lane fails loud instead.

## MODE: baseline

The lane loads a **pre-built schema baseline**, not a migration replay. `scripts/local-stack/run.sh`
implements this mode and **fails loud** when the baseline file is absent — it never degrades to
"replay what it can".

## ✅ SUPERSEDED 2026-08-29 — the baseline artifact now EXISTS and is committed

The BLOCKING-HUMAN block below was written before the artifact existed and is kept for
its reasoning, not its instructions. **Do not follow its command.** The baseline was
subsequently taken from **production** (read-only `supabase db dump --linked`) and
committed at **`supabase/schema/baseline.sql`**, with its provenance, sha256, shape and
secret-scan recorded in `supabase/schema/BASELINE.md`.

Two things the block below gets wrong at HEAD:

- it names `scripts/local-stack/baseline.sql`, the **gitignored** lane-local path
  (`.gitignore:138`). The committed artifact is at `supabase/schema/baseline.sql`;
- it dumps from **TEST**, which its own closing paragraph warns re-couples a disposable
  lane to a shared environment's drift. The committed dump is from PROD, which settles
  that open question.

⚠️ **The lane still does not read either file.** `run.sh:50` points at the gitignored
lane path, so `run.sh up` exits 1 FATAL. Repointing it is Phase 164.5's, together with
dropping `.gitignore:138` and adding the staleness gate — see `supabase/schema/BASELINE.md`.

## ⛔ BLOCKING-HUMAN (HISTORICAL — see the block above before acting on any of this)

D-15's fallback was "generate the baseline with a read-only `supabase db dump` against TEST".
**That action was not taken, deliberately.** Every remaining source of a real, complete schema is
a remote database (TEST or PROD), and this executor operates under a hard constraint that forbids
pointing any Supabase command at a non-local host — TEST is shared with other people's CI. The
measurement above is exactly what makes the decision informed; the privileged action is left to a
human rather than taken silently.

**What a human must decide and run**, from a checkout linked to TEST, with the TEST DSN sourced
from the local environment (never committed, never echoed):

```
supabase db dump --db-url "$TEST_DB_URL" -f scripts/local-stack/baseline.sql
```

Then, before any commit of that file, prove it carries no secrets:

```
grep -nE 'postgres(ql)?://|@[a-z0-9.-]+\.supabase\.(co|com)|[a-z]{20}\.supabase' scripts/local-stack/baseline.sql
```

Any hit ⇒ **do not commit**; regenerate per run into the gitignored path instead. Schema DDL is
already public via `supabase/migrations/`, so a clean dump is committable — a dump carrying a DSN,
host, or project ref is not (threat T-164.3-09).

**Open question for plan 07:** a TEST-derived baseline pins the lane to whatever TEST currently is,
which re-couples a disposable lane to a shared environment's drift. Worth weighing against fixing
Findings 2–7 so the chain replays for real. That is a phase, not a footnote — and Finding 7 means
it needs a decision, not just a patch.
