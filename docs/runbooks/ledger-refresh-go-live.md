# Runbook — Ledger-Refresh Go-Live (LEDGER, Phase 161.1)

**Owner:** founder (both activation ops are LIVE ops — no autonomous run may execute them) ·
**Audience:** whoever activates the recurring ledger refresh ·
**Risk:** activating against a venue that cannot serve the refresh. The cost is NOT what an
earlier draft of this phase assumed — see [Blast radius](#blast-radius--read-this-before-the-pre-flight-not-after-it),
which states the measured cost, the paths that are guarded, and the paths that are not.

## What this activates

After onboarding, a ledger-backed strategy (mt5 / sfox / deribit) was never recomputed. Both daily
strategy crons gate on ccxt-only closed sets, so `strategy_analytics` for these venues went stale
and stayed stale while every status badge stayed green. This runbook registers an **hourly,
staleness-gated, bounded fan-out** that enqueues the **chain tail** (`derive_broker_dailies`,
strategy-mode) for stale ledger strategies. Nothing else changes.

Two migrations carry the mechanism:

| Migration | What it defines |
|---|---|
| `supabase/migrations/20260825120000_ledger_refresh_staleness_view.sql` | `public.ledger_refresh_staleness` — the read-only freshness surface. The measuring instrument for every verification below. |
| `supabase/migrations/20260825130000_ledger_refresh_fanout_dormant.sql` | `public.enqueue_ledger_refresh_for_strategies()` — the zero-argument fan-out, shipped DORMANT. ⚠️ **Lineage since 2026-09-07:** the record of what applied on 2026-08-25, carrying a dated `-- APP-GUC-LINEAGE:` header. The live body is the row below. |
| `supabase/migrations/20260907130000_ledger_refresh_switch_to_system_flags.sql` | ⭐ **Where BOTH fan-out bodies now live.** `CREATE OR REPLACE` of `enqueue_ledger_refresh_for_strategies()` AND `enqueue_ledger_composite_refresh()`, each re-based on its committed snapshot, with Lock B rewritten as a fail-CLOSED read of `public.system_flags` and kept as the FIRST statement. Seeds `('ledger_refresh_enabled', FALSE)`. |

⚠️ **POINTER MOVED 2026-09-07 — this is the case the warning below was written for, and it has now
happened once.** The Step-2 registration statement invokes the body defined in
`20260907130000_ledger_refresh_switch_to_system_flags.sql`, **not** in `20260825130000`. Phase
164.7 moved the switch off an `app.*` GUC because that GUC cannot be set on this platform at all —
both the database-level and the role-level `ALTER … SET` return `42501`, measured on PROD
2026-09-05 — so the activation this runbook exists to perform was, until that migration,
impossible.

⚠️ **The Step-2 registration statement invokes the function body defined in the migration named in
the last row above.** If that migration is ever superseded by a later `CREATE OR REPLACE`, **this
pointer must move with it.** This is not pedantry: this phase's own research found a stale file
pointer keeping a gate green while the body it guarded was one nobody ran. A pointer that has
quietly stopped naming the live body is worse than no pointer, because it is still trusted.

---

## Blast radius — read this BEFORE the pre-flight, not after it

Every gate below only makes sense once the real cost is known. What follows is **measured at
HEAD**, by reading the code, not recalled.

### The stamp that does the damage

When a derive job fails terminally through `_stamp_strategy_analytics_failed`
(`analytics-service/services/job_worker.py:2601`), the destructive branch
(`:2711-2733`) upserts onto that strategy's `strategy_analytics` row:

| Column | Written |
|---|---|
| `computation_status` | `'failed'` |
| `computation_warned` | `false` |
| `computing_started_at` | `NULL` |
| `computation_error` | the scrubbed message |
| `data_quality_flags` | `{"csv_source": true}` |
| `metrics_json_by_basis` | `NULL` |

…and then calls `_heal_delete_basis_series()` (`:2733`, defined `:2573-2593`), which DELETEs both
the `cash_settlement` and `mark_to_market` rows from `strategy_analytics_series`.

That is an authoritative clear of a live row. `computation_status = 'failed'` un-publishes.

**One thing survives, and the whole recovery hangs off it: the stamp never writes
`returns_series`.** The historical daily series stays on the row. That is why the damage is
confined to the status columns, `metrics_json_by_basis` and the two basis-series rows — all of
which a later successful run rewrites wholesale — and it is what the detection query in
[Rollback part 2](#rollback-part-2-of-2--remediation-find-and-repair-what-a-tick-already-downgraded)
keys on.

### ⚠️ What a mis-ordered activation actually costs — CORRECTED by measurement

An earlier draft of this phase stated that activating with `MT5_ENABLED` false would "downgrade the
whole MT5 cohort at once, on the FIRST tick". **Measured at HEAD, that is false, on two independent
counts.** It is corrected here rather than repeated, because a founder-facing runbook that states a
catastrophe a reader can disprove in five minutes teaches that reader to discard its real
constraints along with the false one.

1. **A disabled venue writes nothing to the analytics row.** The derive arm's MT5 kill-switch
   (`job_worker.py:3685-3690`) returns a permanent `FAILED` **before any stamp**. The
   `process_key_long` mirror (`services/ingestion/long_fetch.py:285-291`) does the same. A
   flag-off tick mints failed `compute_jobs` rows and touches `strategy_analytics` not at all.

2. **A wedged gateway is classified transient, and transient does not stamp.** The `-10005` IPC
   timeout class surfaces as an `Mt5ClientError` that `classify_mt5_login_error` does NOT call
   `auth` → transient return, **no terminal stamp** (`:3962-3969`); a hung read surfaces as
   `asyncio.TimeoutError` → transient, no stamp (`:3790-3815`); a handed-on session
   (`Mt5SessionAbandoned`, `:3816-3870`) and a mismatched terminal (`Mt5AccountMismatchError`,
   `:3871-3902`) likewise. Each is explicitly commented "no user-blame analytics row for a fault
   of ours." Only a genuine credential rejection (`_kind == "auth"`, `:3950`) stamps at all — and
   that path is the one the guard below covers.

3. **On top of both, the D-15 guard.** `job_worker.py:2606-2709` intercepts the stamp when the job
   carries `metadata.source = 'ledger-refresh'` **and** the row's existing `computation_status` is
   in `STRATEGY_ANALYTICS_TERMINAL_SUCCESS_STATUSES` (`:576-578` — the PAIR `complete` and
   `complete_with_warnings`). On that path it writes only `computation_error` and
   `computing_started_at = NULL`, skips `_heal_delete_basis_series()`, and returns. Status,
   `computation_warned`, `metrics_json_by_basis`, `returns_series` and both basis-series rows all
   survive.

### ⛔ The residual is real, and it is NOT where the earlier draft looked

Do not read the above as "activation is safe." The guard covers **one** of the terminal-failure
stamps a refresh tick can reach. These are outside it, all measured at HEAD:

| Unguarded destructive stamp | Where | Reachable how |
|---|---|---|
| `_dispose_broker_nav_error` | `job_worker.py:2490-2510` | a structurally unre-priceable NAV input |
| `_mark_insufficient` | `job_worker.py:4671-4697` (+ heal-delete) | fewer than 2 daily-return days reconstructed |
| `_stamp_verdict_failed` | `job_worker.py:4754-4773` | MT5-12 series-completeness verdict refusal |
| **every stamp in the chain tail** | `analytics_runner.py:1316, :1682, :1725, :1778, :1814` | **`compute_analytics_from_csv`, which carries NO marker** |
| the guard's own fallback | `job_worker.py:2669-2678` | the existing-status read raises ⇒ deliberately takes the LOUD path |

**The chain tail is the one that matters most.** `derive_broker_dailies` auto-chains to
`compute_analytics_from_csv`, and `_enqueue_csv_analytics` (`job_worker.py:5344-5348`) passes
`p_strategy_id` and `p_kind` **and nothing else** — no metadata, so no marker, so no guard. This is
threat `T-161.1-21`, recorded ACCEPTED in plan 02: extending metadata propagation there touches a
path every strategy uses and was not done as a drive-by. Consequence for this runbook: **a refresh
whose derive SUCCEEDS and whose analytics hop then fails terminally downgrades a healthy row with
no guard in the way.**

So: the venue-flag gate below is still blocking, because a flag-off tick is pure waste and because
the gate costs nothing; and the remediation procedure is a **required section, not an appendix**,
because the paths it repairs are ones no gate closes.

### The cohort

Per the phase census (`.planning/phases/161.1-.../161.1-CONTEXT.md`, re-measured 2026-08-25):

- **5 ledger strategies visible in the staleness view** — 4 mt5 single-key, 1 deribit composite,
  0 sfox. All 5 read `complete_with_warnings`, a **success** status. There is no already-broken
  ledger row to fail; every strategy a tick touches is one it can only downgrade.
- **4 of those are what the fan-out selects.** The function excludes composites by an explicit
  `is_composite = FALSE` conjunct, so the deribit composite is skipped deliberately; its coverage
  is owed to the separate composite arm on `stitch_composite`. Do not read "5" as the tick size.

These are funded, published strategies.

---

## Pre-flight — ALL BLOCKING

**Any item that does not return its expected answer is an ABORT, not a note-and-continue.** Abort
means: do not run Step 1, do not run Step 2.

### P0 — which database is this? (BLOCKING, and FIRST in every session)

⛔ `current_database()` is `postgres` on BOTH projects and proves nothing. Neither does a green
query or a familiar-looking table. Before any statement in this runbook that WRITES — Step 1,
Step 2, either rollback — run this in the same session:

```sql
SELECT shobj_description(oid, 'pg_database') AS which_database
  FROM pg_database WHERE datname = current_database();
```

- **Expected:** the hand-set marker naming **PROD** (see `CLAUDE.md`, "Which database am I on?").
- **Abort if:** it names anything else, or comes back NULL. A NULL marker means the `COMMENT ON
  DATABASE` was lost; re-set it before writing rather than proceeding on a guess. The Supabase CLI
  and the browser SQL editor have **no** automated production guard — this marker is the only one,
  and this checkout's CLI is linked to production.

### P1 — the A7 tracer passed

The recurring `derive_broker_dailies` → `strategy_analytics` path must have been proven end-to-end
on one real strategy before anything is scheduled. **Executed on PROD 2026-08-25: PASS** —
`last_return_date` moved 2026-08-21 → 2026-08-25 (+4 real bars), status held
`complete_with_warnings`, derive `done` in 35 s, auto-chained `compute_analytics_from_csv` `done`,
44 s total.

If you are re-running this runbook against a materially changed worker, re-run the tracer first
(recipe: `161.1-01-SUMMARY.md`, "A7 MEASUREMENT RECIPE"). Do not schedule an unproven path.

- **Expected:** a recorded tracer PASS.
- **Abort if:** no tracer record, or a tracer whose job went green **without** `last_return_date`
  moving. A green job that changes nothing is not a workaround case — it means the chain tail does
  not reach `strategy_analytics` and the phase must stop and re-plan.

### P2 — both migrations are applied to PROD

```sql
SELECT to_regclass('public.ledger_refresh_staleness')          AS view_present,
       to_regprocedure('public.enqueue_ledger_refresh_for_strategies()') AS fn_present;
```

- **Expected:** both columns non-NULL.
- **Abort if:** either is NULL — the merge did not carry the migration.

⚠️ **ADDED 2026-09-07 — `to_regprocedure` non-NULL is no longer enough.** The function has existed
since 2026-08-25; what Phase 164.7 changed is its BODY. Assert the MECHANISM, not the name:

```sql
SELECT pg_get_functiondef('public.enqueue_ledger_refresh_for_strategies()'::regprocedure) ~ 'system_flags'
         AS guard_is_table_backed;
SELECT key, enabled, updated_at FROM public.system_flags WHERE key = 'ledger_refresh_enabled';
SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'ledger_refresh_fanout';
```

- **Expected:** `guard_is_table_backed = t`; exactly one flag row, `enabled = f` (the seed — the
  switch ships OFF); **zero** cron rows, because Step 2 has not run yet.
- **Abort if:** `guard_is_table_backed = f` — the merge carried `20260825130000` but not
  `20260907130000`, so the body still reads a GUC nobody can set and Step 1 would change nothing
  while every other check read green.
- **Abort if:** the flag row is absent — see Step 1a. Do not INSERT it by hand.

### P3 — ⛔ venue enable flags — THE HARD GATE

A refresh tick for a venue whose flag is off is pure waste and mints failed jobs on funded
accounts. Assert the flag **before** any strategy of that venue can be fanned.

**Part A — the declared value.** From `analytics-service/` with the worker service linked:

```bash
railway variables | grep -E '^\s*│?\s*MT5_ENABLED'
```

- **Expected:** `MT5_ENABLED` present with the exact value `true`. The server-side gate is
  `mt5_enabled_server()` (`analytics-service/services/closed_sets.py:108-109`) and it compares
  `(os.getenv("MT5_ENABLED") or "").strip().lower() == "true"` — fail-closed, so unset, empty,
  `1`, `on` and `yes` are all OFF.
- Likewise `SFOX_ENABLED` before any sfox strategy exists. Today the census has **0** sfox
  strategies, so its arm is unexercised; the assertion becomes load-bearing the day one is
  onboarded.

**Part B — the value the RUNNING worker actually holds.** ⛔ Part A alone does not satisfy this
gate. A variable set without the redeploy that publishes it is a dashboard value the running
process has never seen, and Railway silently SKIPS a deploy when the merge commit's CI check-suite
is red. For the redeploy requirement and the `/health` `git_sha` convergence check, cross-reference
`docs/runbooks/mt5-go-live.md` (Step 6, Pitfall 5) and `docs/runbooks/railway-worker.md`; for the
sFOX equivalent, `docs/runbooks/sfox-go-live.md` (Step 3).

**Part C — the behavioural probe, which is the one that actually proves it.** A declared flag plus
a fresh deploy still does not prove the venue gateway answers. The authoritative evidence is
mt5-keyed jobs **completing recently**, because those only complete when the running worker has the
flag AND the terminal serves the read:

```sql
SELECT cj.kind,
       count(*)          AS done_jobs,
       max(cj.completed_at) AS newest
  FROM compute_jobs cj
  JOIN api_keys ak ON ak.id = cj.api_key_id
 WHERE ak.exchange = 'mt5'
   AND cj.kind IN ('refresh_allocator_equity_daily', 'poll_allocator_positions')
   AND cj.status = 'done'
   AND cj.completed_at > now() - INTERVAL '3 days'
 GROUP BY cj.kind;
```

- **Expected:** both kinds present, each with a healthy count and a `newest` within hours. The
  2026-08-25 pre-tracer reading was **12 `done` of each within 3 days, newest 5 h old**.
- **Abort if:** either kind is absent, or `newest` is stale by more than a day. A stale reading
  means the gateway is wedged (it is on record wedging into `-10005` IPC timeouts three times in a
  single day) or the flag never reached the running process. Clear the wedge per
  `docs/runbooks/mt5-go-live.md` before proceeding.

⚠️ **DATED 2026-09-07 — read this, then run the probe anyway.** Issue **#747** (MT5
`initialize()` → `-6 authorization failed`, raised 2026-09-06 by the Phase 164.1 prober's first
live run) was **CLOSED the same day**: the founder re-logged the terminal over VNC and prober run
**34027776532** read `initialize=true`. ⛔ That does **not** discharge this gate. P3-C is a
BEHAVIOURAL probe over `compute_jobs`, and a closed issue is a statement about the past — the MT5
gateway is on record wedging three times in a single day. **Run the query at activation time and
read its answer.** If the reading is stale, the ABORT rule above applies as written: criterion 3
is then blocked by an operational fault outside this activation, and the honest outcome is to say
so, not to activate around it.

### P4 — the BEFORE census

```sql
SELECT strategy_id, exchanges, is_composite, computation_status,
       last_return_date, days_since_last_return, is_stale, stale_reason
  FROM ledger_refresh_staleness
 ORDER BY exchanges, days_since_last_return DESC;
```

**Record this output somewhere outside the SQL session** — a file, a note, anywhere durable. It is
two things at once: the number you watch drain, and the pre-incident snapshot the remediation step
diffs against. A remediation with no BEFORE cannot tell a row a tick broke from a row that was
already failing. Record at minimum: the row count, the per-venue counts, **each row's
`computation_status`**, and the maximum `days_since_last_return`.

- **Expected (2026-08-25 shape):** 5 rows — 4 mt5 single-key, 1 deribit composite; all
  `complete_with_warnings`; all `is_stale = true` with `stale_reason = series_behind`.

### P5 — worker health and claim role

Confirm the worker is live and consuming (`/health` per `docs/runbooks/railway-worker.md`:
`status: "ok"`, a fresh `worker_last_tick_at`, `git_sha` equal to `main` HEAD), and note the
`WORKER_CLAIM_ROLE` value on the service.

- If it is the default all-kinds value, **the ledger batch and interactive onboarding share one
  queue.** A refresh tick can therefore sit in front of a user's onboarding job. That is a wait,
  not a crash, and it is the shape the v1.11 incident took
  (`docs/runbooks/flipretry-derived-equity-go-live.md`, "Why this document exists").
- ⚠️ State this as a **known condition of activation**, never as a mitigation already in place.
  Nothing in this phase isolates the ledger fan-out onto a dedicated worker. With the measured
  44 s chain cost and a 2-job tick the exposure is small, but it is not zero and it is not
  structurally prevented.

⚠️ **This item's two halves differ, and the difference is deliberate — do not treat them alike.**

- **Worker health is BLOCKING.** **Expected:** `status: "ok"`, `worker_last_tick_at` fresh,
  `git_sha` equal to `main` HEAD. **Abort if:** any of the three fails. A schedule against a dead
  or stale worker is the v1.11 wedge; and a `git_sha` behind `main` is also how a set-but-never-
  published `MT5_ENABLED` slips past P3.
- **The claim-role note is INFORMATIONAL and does not abort.** There is no value of
  `WORKER_CLAIM_ROLE` that blocks activation. Record what it is so that, if onboarding latency is
  reported afterwards, you already know whether the queues were shared.

---

## Step 1 — the activation flag (LIVE op 1 of 2)

The fan-out's first statement is a fail-CLOSED read of `public.system_flags` (migration
`20260907130000_ledger_refresh_switch_to_system_flags.sql`, Lock B in **both** bodies). It opens on
exactly one state: a row with `key = 'ledger_refresh_enabled'` and `enabled = TRUE`. A **missing
row**, a row with `enabled = FALSE`, and a read that **RAISES** (permission denied, table absent,
connection fault) are all dormant — the last logs a `WARNING` carrying its SQLSTATE and returns 0
rather than propagating.

**Op 1 comes first on purpose.** A failure discovered here costs nothing, because nothing can tick
yet: Step 2 has not registered the schedule.

### ⚠️ Steps 1a–1d were REWRITTEN 2026-09-07 — the old ones could not execute

What this runbook used to print, and what those statements actually do on this platform:

| Statement the earlier revision instructed | Measured result on PROD |
|---|---|
| `ALTER DATABASE postgres SET app.ledger_refresh_enabled = 'true'` (old 1a) | **`ERROR: 42501: permission denied to set parameter`** |
| `ALTER ROLE <role> SET app.ledger_refresh_enabled = 'true'` (old 1c) | **`ERROR: 42501: permission denied to set parameter`** |
| `SET app.ledger_refresh_enabled = 'true'` (session-scoped) | ✅ returns `true` |

**Measured 2026-09-05 in the Supabase SQL editor as `postgres`**, all three forms, and recorded in
`.planning/ROADMAP.md` under Phase 164.7. A custom placeholder GUC needs superuser to persist and
`postgres` is not one here. Anyone following the old Step 1 stalled at 1a and then again at 1c.

The third row is why a session GUC can **never** be the out-of-band switch this runbook needs: it
dies with the session that set it, so no operator action outside the tick can reach the tick. That
is the whole reason Phase 164.7 re-based Lock B on a table.

⚠️ **The old 1c's pg_cron-username trap is gone with the mechanism, not merely unmentioned.** It
warned that a role-level GUC applies only to that role's sessions while pg_cron runs each job as
`cron.job.username`, so setting it on the wrong role left the fan-out permanently dormant behind
green checks. A table row is visible to every session and every role that can read
`public.system_flags` — there is no role left to get wrong.

### 1a — throw it

```sql
UPDATE public.system_flags SET enabled = TRUE, updated_at = now() WHERE key = 'ledger_refresh_enabled';
```

(One line on purpose: it is pasted into a SQL editor, and a statement split across lines is a
statement half of which can be pasted.)

- **Expected:** `UPDATE 1`.
- **Abort if:** `UPDATE 0`. The seed row is missing, i.e. `20260907130000` did not apply (it seeds
  `('ledger_refresh_enabled', FALSE)` with `ON CONFLICT DO NOTHING`). ⛔ **Do not INSERT the row by
  hand under incident pressure** — re-check P2 instead. A row no migration owns is a row the next
  apply will not reconcile.

### 1b — verify, in the SAME session

```sql
SELECT key, enabled, updated_at, updated_by
  FROM public.system_flags
 WHERE key = 'ledger_refresh_enabled';
```

- **Expected:** exactly one row, `enabled = t`, `updated_at` within seconds of now.
- **Abort if:** zero rows, or `enabled = f`.

⚠️ **Why the old "disconnect and reconnect" rule no longer applies.** The old database-level form
only reached sessions opened *after* it, so reading it back in the session that ran it proved
nothing — which is why the old 1b insisted on a new session. A **table read is not
session-cached**: the committed row is visible to this session and to every later one, including
every pg_cron tick. Same-session verification is now the correct check, not a weaker one.

### 1c — (deleted)

The role-level fallback and its `cron.job.username` trap are gone; see the correction table above.
There is no fallback to reach for, because on this platform there was never a form of
`ALTER … SET` that worked — which is what made the old fallback dangerous rather than merely
redundant.

### 1d — the execution record (OQ-3 is CLOSED)

⭐ **Open question OQ-3 — "which form persisted the setting?" — is closed by measurement, and the
answer is NEITHER.** The 2026-09-05 table above settles it, so nothing is owed to this runbook's
own execution any more.

What the execution record takes instead:

- the `updated_at` and `updated_by` returned by 1b, and
- the P0 which-database marker output, from the same session.

---

## Step 2 — the schedule (LIVE op 2 of 2)

⛔ **MEASURED 2026-09-07: the schedule is NOT REGISTERED on PROD, so activation is TWO live ops —
not one.** `scripts/prod-prober/cron-manifest.json`, captured from production by the Phase 164.1
prober, holds **14 jobnames and none of them is `ledger_refresh_fanout`**; `161.1-VERIFICATION.md`
measured the same absence on 2026-08-28. Throwing the flag in Step 1 therefore changes nothing on
its own — the body is dormant because no job calls it as well as because the flag was off. Both
ops are required, in this order, and both are LIVE.

```sql
SELECT cron.schedule(
  'ledger_refresh_fanout',
  '25 * * * *',
  $$SELECT public.enqueue_ledger_refresh_for_strategies();$$
);
```

**Minute 25 is chosen, not arbitrary.** It clears the `*/15` reaper grid
(`reap_strategy_analytics_stuck_computing`, minutes 0/15/30/45), the hourly
`match_engine_cron` at `:00`, the `reconcile_dropped_enqueue_sweep` at `:35`, the
`retention_compute_jobs_orphaned_running` terminalizer at `:50`, and every occupied daily slot
(03:00, 03:05, 03:10, 03:15, 03:20, 03:30, 04:00, 04:15, 05:00, 05:30 UTC).

**Verify:**

```sql
SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'ledger_refresh_fanout';
```

- **Expected:** one row, `25 * * * *`, `active = t`.

### ⛔ **This statement lives HERE and NEVER in a migration.**

**Migrations auto-apply to PROD on merge.** A merge whose worker deploy is then silently skipped —
Railway skips the deploy when the merge commit's CI check-suite is red — starts a schedule against
a worker that cannot serve it. That is the v1.11 wedge recreated verbatim, and it is the standing
rule at `docs/runbooks/flipretry-derived-equity-go-live.md:169`. Both ledger-refresh migrations
were verified at merge to contain **zero** pg_cron registration verbs, and a static gate keeps them
that way. Live pg_cron state and git therefore diverge **on purpose**.

### 2e — re-capture the cron manifest, IMMEDIATELY after registering

⚠️ **ADDED 2026-09-07 — this is part of the operation, not follow-up.** The Phase 164.1
`cron-drift` prober arm compares live `cron.job` against the committed manifest by **jobname set
equality first**. The moment Step 2 succeeds, PROD carries a 15th job the manifest does not, and
the arm reports drift on every run until the manifest is re-captured. That is not a false positive
to wait out — it is the arm doing its job, and leaving it red teaches the next reader to ignore it.

```bash
node scripts/prod-prober/run.mjs --capture-manifest --out scripts/prod-prober/cron-manifest.json
```

Then **read the `command` text of every job in the resulting diff before committing.** The manifest
is a committed, world-readable file in a public repository, and each command string was
individually approved for publication when it was first captured. Commit it as its own reviewed
change.

- **Expected:** the diff ADDS exactly one job — `ledger_refresh_fanout`, `25 * * * *`, active — and
  changes nothing else.
- **Abort if:** any other job moved. A second unexplained difference means PROD drifted somewhere
  this runbook is not looking, and committing the manifest would bless it.

---

## First tick — what to expect

The function returns the number of jobs **actually inserted** (not called — it pre-counts, see
`20260825130000:365-378`).

Bounds: **per-tick LIMIT 4, per-venue rank cap 2, 20-hour attempt cooldown.** The cooldown is the
binding bound; the LIMIT is a burst/smoothing cap.

**For the current backlog:** all 4 fan-out-eligible strategies share one venue, so the **per-venue
cap of 2 binds** — the tick enqueues **2**, and the 20-hour cooldown excludes those 2 from the next
tick. The backlog therefore clears in **2 ticks ≈ 2 hours**. In general, a single-venue backlog of
B strategies takes `ceil(B / 2)` hours; a multi-venue backlog takes `ceil(B / min(4, 2 × venues))`
hours.

**Say the trade honestly:** a slow, observable catch-up was chosen over a fast one because a fast
one is the wedge. The measured chain cost is 44 s against a 1500 s ceiling — about 34× conservative
— so the bounds are far larger than this cohort needs. They are a ceiling, not an estimate, and
they are not retuned on one measurement.

---

## Watching it

Re-run the P4 census query. Then:

```sql
SELECT cj.kind, cj.status, cj.created_at, cj.completed_at,
       cj.completed_at - cj.claimed_at AS duration,
       cj.error_message
  FROM compute_jobs cj
 WHERE cj.metadata ->> 'source' = 'ledger-refresh'
    OR (cj.kind = 'compute_analytics_from_csv'
        AND cj.created_at > now() - INTERVAL '4 hours')
 ORDER BY cj.created_at DESC
 LIMIT 20;
```

**Success is the stale count going down and the maximum `days_since_last_return` going down.**

⚠️ **A job reaching a green terminal status is NOT success.** The defect this phase fixes wore a
green badge for weeks — re-enqueuing `process_key_long` returns `DONE` on a published strategy and
leaves `strategy_analytics` untouched. **Check the view, not the job.**

### Did the tick itself run, and how much did it enqueue?

```sql
SELECT d.start_time, d.status, d.return_message
  FROM cron.job_run_details d JOIN cron.job j ON j.jobid = d.jobid
 WHERE j.jobname = 'ledger_refresh_fanout'
 ORDER BY d.start_time DESC LIMIT 3;

SELECT count(*) AS enqueued_this_tick
  FROM compute_jobs
 WHERE metadata ->> 'source' = 'ledger-refresh'
   AND created_at > now() - INTERVAL '65 minutes';
```

- **Expected:** `succeeded`, and `enqueued_this_tick = 2` for the four-strategy single-venue
  backlog (the per-venue cap of 2 binds — see "First tick"). The count the function returns is a
  NOTICE and does not reach `return_message`, which is why the second query exists at all.
- ⚠️ Neither of these is success. They tell you the mechanism fired; the census above tells you it
  worked.

### Proving the kill switch — with the schedule still firing

This is the property the rejected `SET app.… ; SELECT …` workaround would have destroyed: a caller
that sets the flag on itself can never be switched off from outside.

```sql
UPDATE public.system_flags SET enabled = FALSE, updated_at = now() WHERE key = 'ledger_refresh_enabled';
SELECT key, enabled, updated_at FROM public.system_flags WHERE key = 'ledger_refresh_enabled';
```

Record that `updated_at` — it is the flip timestamp the next query needs. Then, after the next
`:25` tick, **with the schedule STILL registered**:

```sql
SELECT d.start_time, d.status
  FROM cron.job_run_details d JOIN cron.job j ON j.jobid = d.jobid
 WHERE j.jobname = 'ledger_refresh_fanout' ORDER BY d.start_time DESC LIMIT 1;

SELECT count(*) AS enqueued_since_flip
  FROM compute_jobs
 WHERE metadata ->> 'source' = 'ledger-refresh'
   AND created_at > '<the updated_at recorded above>';
```

- **Expected:** the tick `succeeded` (it RAN) **and** `enqueued_since_flip = 0` (it did nothing).
  ⛔ Both halves are the assertion. A tick that did not run proves nothing about the switch.

---

## Rollback, part 1 of 2 — stop the bleeding

Two levels, fastest first.

### FAST — flip the activation flag off

```sql
UPDATE public.system_flags SET enabled = FALSE, updated_at = now() WHERE key = 'ledger_refresh_enabled';
```

- **Expected:** `UPDATE 1`.

Verify in the **same session** — a table read is not session-cached:

```sql
SELECT key, enabled, updated_at FROM public.system_flags WHERE key = 'ledger_refresh_enabled';
```

- **Expected:** `enabled = f`.

Then confirm the next tick enqueues nothing. The schedule keeps firing, Lock B reads `FALSE` and
the function returns 0. **No schedule operation, no deploy, no migration** — and, unlike the
mechanism this replaced, effective for the very next tick rather than only for sessions opened
afterwards.

⚠️ **REWRITTEN 2026-09-07, and this was the more dangerous half.** This section used to instruct `ALTER DATABASE postgres SET app.ledger_refresh_enabled = 'false'`, which returns **`42501: permission denied to set parameter`**, followed by a role-level reset with the identical result (both measured 2026-09-05 in the SQL editor as `postgres`; the table is in Step 1's correction block). A rollback that cannot execute is discovered under incident pressure, which is why it was corrected in the same commit as Step 1 rather than after it. There is no role-level reset left to remember: the flag is one row, visible to every session.

### FULL — unschedule the job

```sql
SELECT cron.unschedule('ledger_refresh_fanout');
```

**Verify:**

```sql
SELECT count(*) AS still_scheduled FROM cron.job WHERE jobname = 'ledger_refresh_fanout';
```

- **Expected:** `0`.

### Already-queued jobs

Neither rollback cancels jobs already enqueued. Inspect them:

```sql
SELECT id, kind, status, created_at
  FROM compute_jobs
 WHERE metadata ->> 'source' = 'ledger-refresh'
   AND status IN ('pending', 'running', 'done_pending_children', 'failed_retry')
 ORDER BY created_at;
```

The existing orphan-terminalizer (`retention_compute_jobs_orphaned_running`, hourly at `:50`) and
the stuck-row reaper (`reap_strategy_analytics_stuck_computing`, `*/15`) own these rows from here.
**Do not add a third mechanism racing them.**

### ⛔ Hand-off

**Stopping the schedule stops FUTURE damage and repairs nothing.** If any tick already ran, part 2
is mandatory.

---

## Rollback, part 2 of 2 — remediation: find and repair what a tick already downgraded

This section is the reason the rollback is a rollback.

### 1. Detect

⚠️ **Do not filter on the fan-out marker alone.** Per the blast-radius section, the marker-carrying
derive job is the path that is **guarded** — a marked derive failing on a terminal-success row
leaves no downgrade to find. The damage that does occur comes overwhelmingly from the **unmarked
chain-tail** `compute_analytics_from_csv` job, which carries no metadata at all. A detection query
keyed only on `metadata ->> 'source' = 'ledger-refresh'` would return zero rows on exactly the
incident you are investigating.

⛔ **If what you observe contradicts the blast-radius section, believe the observation.** That
section is a reading of the code at one commit; a later change can move any of those citations. If
you see a downgrade on a path the section calls impossible — a flag-off tick that DID clear statuses,
say — do not dismiss it because the runbook says it cannot happen. Proceed with the remediation
below exactly as written (it keys on damage, not on cause, so it works regardless), and then
re-measure the cited line ranges and correct this document.

Detect on the **damage**, and attribute with the job history:

```sql
SELECT sa.strategy_id,
       sa.computation_status,
       sa.computation_error,
       sa.metrics_json_by_basis IS NULL AS by_basis_cleared,
       jsonb_array_length(sa.returns_series) AS series_len,
       tail.kind        AS attributing_kind,
       tail.status      AS attributing_status,
       tail.completed_at
  FROM strategy_analytics sa
  JOIN LATERAL (
         SELECT cj.kind, cj.status, cj.completed_at
           FROM compute_jobs cj
          WHERE cj.strategy_id = sa.strategy_id
            AND cj.kind IN ('derive_broker_dailies', 'compute_analytics_from_csv')
            AND cj.created_at > now() - INTERVAL '48 hours'
          ORDER BY cj.created_at DESC
          LIMIT 1
       ) AS tail ON TRUE
 WHERE sa.computation_status = 'failed'
   AND jsonb_typeof(sa.returns_series) = 'array'
   AND jsonb_array_length(sa.returns_series) > 0
   AND EXISTS (
         SELECT 1 FROM compute_jobs m
          WHERE m.strategy_id = sa.strategy_id
            AND m.metadata ->> 'source' = 'ledger-refresh'
            AND m.created_at > now() - INTERVAL '48 hours'
       )
 ORDER BY tail.completed_at DESC NULLS LAST;
```

Each conjunct, and why none may be dropped:

- **`computation_status = 'failed'`** — the downgrade itself. This is the damage.
- **`returns_series` is a NON-EMPTY array** — ⛔ **this is the one a reader drops, and it is
  load-bearing.** The failure stamp never writes `returns_series`, so a surviving series is what
  distinguishes *a row a tick knocked down* from *a row that never had analytics at all*. Drop it
  and you sweep in every never-computed strategy and "repair" rows that were never damaged.
- **an `EXISTS` on a marked job within the window** — attribution. It proves the fan-out ran
  against this strategy at all. It is deliberately an `EXISTS` on the *marked derive*, not a filter
  on the *failing* job, because the failing job is usually the unmarked chain tail enqueued by that
  derive.
- **the `LATERAL` most-recent job** — shows you *which* hop failed, which tells you whether you are
  looking at a guarded path that fell through or the unguarded tail.
- **the 48-hour windows** — widen them to cover however long the schedule was live.

**Then diff against the P4 BEFORE census.** Treat a row as tick damage **only** if its recorded
BEFORE `computation_status` was in the success pair (`complete` / `complete_with_warnings`). The
census is what makes this a diff rather than a guess. A row that was already `failed` before
activation is not yours to repair here.

### 2. Repair — cause FIRST, then one strategy at a time

⛔ **Correct the cause before enqueuing anything.** Set the venue flag true and redeploy the worker,
or clear the wedged gateway per `docs/runbooks/mt5-go-live.md`. Then **re-assert pre-flight P3 in
full — Parts A, B and C.** A repair run against an uncorrected cause is just another tick.

Then, for **each** affected strategy, re-run the chain by hand exactly as the A7 tracer did — one
job, one strategy, with a repair-specific marker:

```sql
SELECT enqueue_compute_job(
         p_strategy_id := '<one affected strategy id>',
         p_kind        := 'derive_broker_dailies',
         p_metadata    := jsonb_build_object('source', 'ledger-refresh-repair'));
```

- ⛔ `p_strategy_id` **ALONE**. `enqueue_compute_job` enforces exactly-one-of
  `{p_strategy_id, p_allocator_id, p_api_key_id}` and raises SQLSTATE `22023` otherwise — measured
  on PROD during the A7 tracer.
- The marker `ledger-refresh-repair` is deliberately distinct from the fan-out's `ledger-refresh`
  and from the tracer's `ledger-refresh-tracer`, so repair jobs can never be swept into either
  population. ⚠️ Note the consequence: because it is not `ledger-refresh`, the D-15 non-destructive
  guard does **not** apply to a repair job. That is correct — a repair either succeeds or you want
  to see it fail loudly — but it means a failed repair on an already-`failed` row is a no-op, not a
  fresh injury.
- **Do not batch.** One at a time, watched to completion. MT5 serialises on a single shared
  terminal.
- **Do not re-enable the schedule to do the repair for you.**

### 3. Verify the repair — per row, all three assertions

For each repaired strategy:

```sql
SELECT computation_status,
       metrics_json_by_basis IS NOT NULL AS by_basis_present,
       last_return_date, days_since_last_return, is_stale, stale_reason
  FROM ledger_refresh_staleness
 WHERE strategy_id = '<that id>';
```

Assert **all three**:

1. `computation_status` is back in the success pair — `complete` or `complete_with_warnings`.
2. `metrics_json_by_basis` is **non-null** again.
3. `last_return_date` **advanced**.

⛔ **All three, not just the first.** A status alone flipping green is the exact shape of defect
this phase exists to eliminate — the whole phase started because a green badge sat over a strategy
that had not recomputed in weeks. And `metrics_json_by_basis` is the column the failure stamp
cleared, so a green status over a still-null by-basis column is a half-repair that looks whole.

⚠️ On assertion 2, one honest caveat: `metrics_json_by_basis` was measured **already NULL on all 4
production mt5 rows** before any of this ran. For that cohort a null by-basis column is the normal
state, not evidence of damage — so compare against **that row's P4 BEFORE value**, not against
"non-null" as an absolute. Assertions 1 and 3 carry the weight for those rows.

### 4. When the repair cannot succeed

If the venue is still down, the row stays `failed`. **That is an accepted, recorded state.**

⛔ **Do NOT hand-edit `strategy_analytics` to restore a success status or to re-populate
`metrics_json_by_basis`.** A status not produced by a real run is a fabricated green badge, which is
the precise failure mode this phase was opened to remove. Writing one by hand would make this
runbook the cause of the defect it exists to repair.

Instead: record the affected **count** and the **date** in `TODOS.md`, and re-run the repair when
the venue returns.

---

## What this runbook deliberately does not cover

- **The deribit composite.** The fan-out excludes composites by an explicit conjunct; deribit's
  sole live strategy is a composite, so it gets zero coverage from *this* mechanism. Its coverage
  is owed to the separate composite arm on `stitch_composite`. See `TODOS.md` item **0.3**.
- **The ccxt sibling defect.** ccxt strategies with no new fills also never recompute — a different
  venue class and a different mechanism, out of scope here. See `TODOS.md` item **0.2**.
