# Match Engine Runbook

Operational guide for the Perfect Match Engine (founder-amplifier). See the
implementation plan at `docs/superpowers/plans/2026-04-07-perfect-match-engine.md`.

## Overview

- **What it does:** scores quant strategies for each allocator and surfaces a
  ranked candidate list to the founder in `/admin/match/[allocator_id]`.
- **Who sees it:** the founder only. Allocators never see the score.
- **How the founder uses it:** open the match queue, pick 3 candidates per
  allocator, send an intro via the existing `contact_requests` flow.
- **Ground truth:** `match_decisions` records every thumbs-up / thumbs-down /
  sent-as-intro decision. The eval dashboard measures algorithm hit rate
  against the founder's actual picks.

## Deploy checklist

1. Migration 011 applied to staging:
   - ⚠️ **CORRECTED 2026-09-07 — the statement this step used to instruct cannot run here.** It said: `ALTER DATABASE postgres SET app.admin_email = 'founder@quantalyze.io';` (persist via `ALTER DATABASE` so restores remain idempotent). **Measured on PROD 2026-09-05 in the Supabase SQL editor as `postgres`: `ERROR: 42501: permission denied to set parameter`** — a custom placeholder GUC needs superuser and `postgres` is not one on this platform. The role-level form returns the same. Only a session-scoped `SET` succeeds, and a session GUC dies with the session, so it can never survive a restore. Anyone following the old step stalled on it.
   - **There is nothing to set.** `app.admin_email` is read exactly ONCE, by the one-shot `DO $$ … END $$` block in `20260407164606_perfect_match.sql` that ran when the migration applied on 2026-04-07 and can never run again — no function body, no cron command, no view, and no second definition anywhere in `supabase/migrations/`. It has **no live reader**. That is disposition **D-04**, the SCOPE AMENDMENT recorded in ROADMAP criterion 2 and `164.7-CONTEXT.md`: the file carries a dated `-- APP-GUC-LINEAGE:` header rather than being migrated (a block that already ran) or deleted (an applied migration is the record of what ran against PROD).
   - **To grant admin on a fresh database,** run the `UPDATE profiles SET is_admin = true WHERE …` by hand after the migration applies — exactly what the migration's own comment already says to do when the setting is absent, which from 2026-09-07 is always.
   - Run `20260407164606_perfect_match.sql`
   - Verify: `SELECT id, is_admin FROM profiles WHERE email = 'founder@...';` → is_admin = true
1a-bis. The match-engine cron's mechanism — same correction, same cause:
   - The hourly `match_engine_cron` job no longer resolves anything from `app.*`. PROD's jobid 1 was hand-repaired on 2026-09-01 onto a `DO` block reading the key from `vault.decrypted_secrets`, and the repo now describes that mechanism as `public.match_engine_cron_tick()` in `20260907120000_analytics_service_settings_and_vault_tick.sql` — key from Vault, URL from `public.system_settings`, a loud `RAISE` on either absence.
   - ⚠️ **The LIVE `cron.job` row is not yet pointed at that function.** Repointing it is Phase 164.5 item (7), against the captured `scripts/prod-prober/cron-manifest.json`. Until then the repo and the live row agree in MECHANISM but not in TEXT, and the Phase 164.1 `cron-drift` arm is the instrument that says so. Phase 164.5 item 7 was SPLIT OUT to Phase 164.5.1 CRONREPOINT on 2026-09-07 by founder decision — not renamed, not dropped; see Phase 164.5.1 CRONREPOINT for the live repoint.
   - ↳ **The procedure that changes it is below, in this same file:** see "## Go-live: repoint `match_engine_cron` + ledger-refresh activation (Phase 164.5.1 Wave B)".
   - ✅ **`[A1]` MEASURED 2026-09-09 on shared TEST — the assumption HELD, and it no longer gates the repoint.** The question was whether a `SECURITY DEFINER` function owned by `postgres` may read the real encrypted `vault.decrypted_secrets` view on a hosted Supabase project. Read in the TEST SQL editor by the founder:

     ```sql
     SELECT has_schema_privilege('postgres','vault','USAGE')                   AS usage,      -- true
            has_table_privilege('postgres','vault.decrypted_secrets','SELECT') AS can_select; -- true
     ```

     Conditions that make the reading load-bearing rather than incidental, measured in the same session: `supabase_vault` is installed, `vault.decrypted_secrets` is owned by **`supabase_admin`** (not by `postgres`), and `postgres` is **NOT** a superuser there — i.e. the hosted-platform constraint the assumption was about is genuinely present, not bypassed by an over-privileged role. `SECURITY DEFINER` executes as the function's OWNER, so `postgres` holding both privileges is exactly what the callable needs.
     ⭐ Independent corroboration, different instrument: PROD's live jobid 1 already performs this same Vault read hourly as `username: postgres` and succeeds (`net._http_response` id 3485 → 200, 2026-09-01). ACL and runtime therefore agree.
     ⚠️ **What is still NOT proven, stated so nobody upgrades it by retelling:** no `SECURITY DEFINER` wrapper was actually executed against the real Vault — the ACL was read, the function was not called. Calling the shipped `public.match_engine_cron_tick()` would fire a real `net.http_post` at the production analytics service, which is why it was not called. The wrapper is expected to be a no-op on role (definer `postgres`, caller `postgres`), but that is an argument, not a measurement.
     ⛔ The pg-lane cannot answer this class at all — its vault is a plaintext stand-in by construction. Do not "confirm" A1 from a lane run.
   - To change the analytics URL without touching secrets, behind the which-database marker from `CLAUDE.md`: `UPDATE public.system_settings SET value = '<host>', updated_at = now() WHERE key = 'analytics_service_url';`
1a. Migration 014 applied to staging:
   - Run `20260408155411_strategy_codename.sql` (adds nullable `strategies.codename`).
   - Verify: `SELECT column_name FROM information_schema.columns WHERE table_name = 'strategies' AND column_name = 'codename';` → returns one row.
   - Without this column the match engine recompute 500s with `column strategies.codename does not exist` and `/admin/match/[allocator_id]` returns 500.
2. Python service deployed with the new `routers/match.py` registered in `main.py`
3. Next.js deployed with the new admin API routes
4. Environment variables confirmed: `ADMIN_EMAIL`, `ANALYTICS_SERVICE_URL`, `ANALYTICS_SERVICE_KEY`
5. Smoke test (as founder):
   - Visit `/admin/match` → allocator list loads
   - Click "Recompute all" → progress shows
   - Open one allocator → shortlist strip + two-pane renders
   - Click "Send intro →" → modal opens, submit → verify `contact_requests` row created

## Common issues

### Engine returning empty queues for everyone
1. **Kill switch?** Check `system_flags.enabled` where `key = 'match_engine_enabled'`. If false, flip it back on via the admin UI.
2. **Migration not applied?** `SELECT COUNT(*) FROM match_batches;` — if the table doesn't exist, migration 011 hasn't run.
3. **Python service down?** `curl $ANALYTICS_SERVICE_URL/health`
4. **No strategies in universe?** `SELECT COUNT(*) FROM strategies WHERE status = 'published';` — if 0, the engine has nothing to score.
5. **All candidates excluded?** Check `/admin/match/[id]` → excluded list. Adjust preferences.

### Recompute fails with RLS error
- Verify service role token is being used: `SELECT auth.role();` in the failing query context. Should be `service_role`.
- Check policies: `SELECT * FROM pg_policies WHERE tablename IN ('match_candidates', 'match_batches', 'match_decisions');`
- Both `_service_insert` and `_admin_select` policies must exist per table.

### Send Intro returns "already sent" but the founder expected a new one
- By design: `contact_requests` has `UNIQUE (allocator_id, strategy_id)` from migration 001. The RPC respects this constraint and surfaces `was_already_sent = true`.
- If the founder needs to re-pitch, they should message the allocator directly via Telegram/email, not through the engine.

### Cron takes > 5 minutes
- Check concurrency: the semaphore is 3, so increasing helps only up to CPU saturation.
- Benchmark per-allocator latency: `SELECT allocator_id, latency_ms FROM match_batches ORDER BY computed_at DESC LIMIT 50;`
- If p95 latency > 10s per allocator, the universe caching isn't working or the pandas alignment loop is pathological. Profile with `py-spy` on the analytics service.

### Consecutive `partial` cron runs — batching working, or stuck?
Phase 164.5.1 criterion 9: `cron_recompute()` stops at a batch boundary (a
count bound OR an elapsed-time bound, whichever comes first) rather than
performing its whole unit of work inside one gateway-bounded request.
- **Normal:** consecutive ticks returning `status="partial"` with an
  ADVANCING `next_cursor` is the engine working through a large allocator
  set in bounded slices — not a stall.
- **The actual alarm signal:** a `next_cursor` that does NOT advance between
  ticks, or `partial` persisting across a full day. Either means a tick is
  failing to make progress on its slice, not merely taking several ticks to
  finish the whole set.
- The cursor lives in `system_settings.key = 'match_engine_cron_cursor'`.
  It is ENGINE-INTERNAL BOOKKEEPING — an operator should not hand-edit this
  row except to deliberately restart a pass (setting `value` to the empty
  string, or deleting the row, makes the next tick start from the
  beginning). A mid-run kill-switch flip never advances this cursor: the
  founder flipping the switch off mid-batch does not cause the in-flight
  slice to be silently skipped on the next tick.

### `is_admin` is false for the founder
- Manual backfill:
  ```sql
  UPDATE profiles SET is_admin = true
  WHERE id = (SELECT id FROM auth.users WHERE lower(email) = lower('founder@quantalyze.io'));
  ```
- The email-based gate in `lib/admin.ts` is still active as a fallback, so the founder should still be able to access `/admin/match` even if `is_admin = false`. But RLS won't let them SELECT from `match_*` tables without `is_admin = true`.

### Hit rate is 0%
- Expected in the first week: the founder doesn't have enough decisions yet for the eval dashboard to be meaningful.
- Graduation gate: 20+ intros + 40% top-3 hit rate + 5+ conversions. Check the eval dashboard at `/admin/match/eval`.

## Manual operations

### Disable the engine immediately
- Click the **Engine: ON** pill in `/admin/match` → toggles to OFF
- OR directly: `UPDATE system_flags SET enabled = false WHERE key = 'match_engine_enabled';`

### Reset a bad batch for an allocator
```sql
DELETE FROM match_batches WHERE allocator_id = 'ALLOCATOR_UUID' ORDER BY computed_at DESC LIMIT 1;
-- Then click Recompute now in the admin UI.
```

### Re-enable for new allocator
Any profile with `role IN ('allocator', 'both')` is automatically included in the next cron run. No manual opt-in needed.

## Go-live: repoint `match_engine_cron` + ledger-refresh activation (Phase 164.5.1 Wave B)

**Owner:** founder (every LIVE op below is a founder gate — no autonomous run may execute them) ·
**Risk:** production DDL on `cron.job` jobid 1, which carries a credential-bearing command, plus
the SAME live write `docs/runbooks/ledger-refresh-go-live.md` documents on its own. This section
is the ONE session that performs both, in the fixed order below, ending in exactly one manifest
re-capture — running the two sessions separately means two re-captures, and two re-captures means
two red prober runs (the Phase 164.1 `cron-drift` arm reports drift on every run between a live
change and its re-capture).

⛔ **Do this in ONE sitting, in this order and no other.** Splitting it across sessions or
re-ordering the steps is exactly the ordering `164.5.1-CONTEXT.md` fixes and the DEFER branch below
budgets for.

### Decisions this section implements (D1, D2, D3 — settled 2026-09-09, not re-opened here)

These were DECIDED on 2026-09-09 and are transcribed here with the measurement or precedent each
rests on. They are ANSWERS, not open questions — this section records them, it does not re-derive
them.

- **D1 — Registration lives in the RUNBOOK, never in a migration.** Basis: the 164.7 rule shipped
  in `20260907120000` (*"A migration that schedules is a scope violation"*), plus two in-tree
  precedents already following it — `docs/runbooks/ledger-refresh-go-live.md:412` and
  `docs/runbooks/flipretry-derived-equity-go-live.md:162`. Step 2 and Step 3's fan-out registration
  above both follow it.
- **D2 — what a rebuild-from-migrations produces: NO `match_engine_cron` job at all, plus one loud
  row.** MEASURED, not assumed: migration `20260408215026` skips scheduling whenever the two
  `app.*` GUCs (`app.analytics_service_url`, `app.analytics_service_key`) are empty, and they are
  ALWAYS empty here because setting either one returns `42501: permission denied to set parameter`
  on this platform (measured on PROD **2026-09-05**). So a rebuilt database has no hourly job and
  one `cron_runs` row reading `error = 'GUC unset at migration 015'` — the exact string the
  migration's `RAISE NOTICE` / `INSERT INTO cron_runs` branch writes — and the registration in
  Step 2 above is what creates the job. This is the runbook convention working **as designed**: the
  migration fails CLOSED and leaves a trace, not a gap to be patched.

  **The window, named in the exact words this criterion requires:** *from a rebuild until the
  registration step is run, the hourly recompute does not fire, and `cron_runs` says why.*
- **D3 — the manifest re-capture (Step 4 above) is a SCRIPT, not hand work.** `captureManifest`
  (`scripts/prod-prober/run.mjs`) already exists; Step 4 consumes it unchanged rather than
  describing a hand-edited manifest, which the drift arm's `command_sha256` check would refuse
  anyway.

⛔ **The losing convention is flagged, not left to disagree silently.** Phase 164.5's old
criterion 7 said: *"Write ONE forward migration re-scheduling `match_engine_cron` to the achievable
Vault-backed command."* **D1 supersedes it** — the registration this section performs in Step 2 is
a runbook-hosted LIVE op, never a migration. The old wording is not deleted anywhere it survives as
lineage; this is an additive flag, matched by a line in `TODOS.md`'s `[CRON-DRIFT-01]` entry.

### P0 — which database is this? (BLOCKING, and FIRST in this session — repeat CLAUDE.md's rule)

```sql
SELECT shobj_description(oid, 'pg_database') AS which_database
  FROM pg_database WHERE datname = current_database();
```

- **Expected:** the hand-set marker naming **PROD**. RECORD THE OUTPUT into the execution record —
  not the fact that the query was run, the actual row it returned.
- **Abort if:** it names anything else, or comes back NULL.

⛔ `current_database()` reads `postgres` on **both** PROD and TEST and proves nothing. Neither does
a green query or a familiar-looking table. The Supabase CLI and the browser SQL editor have **no**
automated production guard — this marker is the only one, and this checkout's CLI is linked to
production. **Pasting the query text is not evidence; only its recorded output is.** This is the
exact vacuity booked as `[164.7-P3C-PRESENCE-ORACLE]` — a verify leg that was satisfied once by the
query's text rather than its answer. Do not repeat it here.

### Step 0 — deploy Wave A first (Areas 1 and 2: kill switch, timeout, batching)

The repointed job calls into `public.match_engine_cron_tick()`, which posts to the analytics
service's `/api/match/cron-recompute` route — the same route Wave A's fail-closed kill switch, the
`service_role` `statement_timeout`, and the batched `cron_recompute()` all harden. Repointing jobid
1 before Wave A is live would repoint it at a route with the SAME gateway-ceiling and fail-open
exposure this phase exists to close. Confirm Wave A (plans 02, 03, 05, 06) is merged and deployed
before proceeding — do not restate what those plans do; see their SUMMARYs.

- **Expected:** the Railway worker's `/health` (`docs/runbooks/railway-worker.md`) reports
  `git_sha` at or after Wave A's merge commit.
- **Abort if:** `git_sha` predates Wave A — the deploy was silently skipped (Railway skips a deploy
  when the merge commit's CI check-suite is red) and the repoint below would run against a worker
  that cannot yet serve it safely.

### Step 1 — the pre-flight, and it can abort the whole session

```bash
node scripts/prod-prober/run.mjs --preflight-repoint [--manifest scripts/prod-prober/cron-manifest.json]
```

`preflightCronRepoint` (plan 04) reads the committed manifest, the P0 marker and live `cron.job`,
and compares them with the SAME `compareManifest` the live `cron-drift` arm uses — no second notion
of drift. It **writes nothing**, proven by a self-test scenario that hashes the manifest fixture
before and after every invocation leg.

- **Expected:** exit **0** — compared, clean. Record the marker the verb itself prints on success.
- **Abort if:** exit **1** (compared, found a mismatch — PROD's `cron.job` has drifted from the
  committed manifest somewhere this session is not looking) or exit **3** (nothing was measured —
  an unreadable manifest, a P0-marker failure, or a malformed `cron.job` read). **ANY non-zero exit
  stops the session here.** Do not proceed to Step 2 on a hunch that the mismatch is benign.

### Step 2 — the repoint (LIVE op 1)

```sql
SELECT cron.schedule(
  'match_engine_cron',
  '0 * * * *',
  $$SELECT public.match_engine_cron_tick();$$
);
```

⛔ **This statement lives HERE and NEVER in a migration.** Migrations auto-apply to PROD on merge;
a merge whose worker deploy is then silently skipped (Railway skips the deploy when the merge
commit's CI check-suite is red) would start a schedule against a worker that cannot serve it — the
v1.11 wedge, recreated verbatim. Both `docs/runbooks/ledger-refresh-go-live.md:412` and
`docs/runbooks/flipretry-derived-equity-go-live.md:162` follow the same rule for the same reason;
this is the third instance of a house convention, not a one-off.

**Verify-back:**

```sql
SELECT jobid, jobname, schedule, command, active FROM cron.job WHERE jobname = 'match_engine_cron';
```

- **Expected:** one row, **jobid UNCHANGED** (the row this UPSERT touches is `cron.job` jobid 1 —
  `cron.schedule` UPSERTs on `(jobname, username)` and PRESERVES the jobid, it does not create a
  second row or renumber the existing one), `schedule = '0 * * * *'` (unchanged), `active = t`, and
  `command` is the one-line `SELECT public.match_engine_cron_tick();` call.
- **Abort if:** a second row appears, the jobid changed, or `active` is not `t`.

### Step 2b — the `[VAULTTICK-EMPTYKEY-01]` side-effect check

A post-repoint reading, not an argument: the repoint is what closes `[VAULTTICK-EMPTYKEY-01]` —
before this step the guard was live in the repo and UNREACHED in production, because jobid 1's
command contained no `btrim` call at all.

```sql
SELECT command FROM cron.job WHERE jobname = 'match_engine_cron';
```

- **Expected:** the command is `SELECT public.match_engine_cron_tick();` — i.e. it now reaches the
  callable carrying `IF v_key IS NULL OR btrim(v_key) = '' THEN RAISE EXCEPTION …` (see
  `supabase/schema/functions/match_engine_cron_tick.sql`). Record this reading; it is what closes
  the item.
- **Abort if:** the command does not match, or `match_engine_cron_tick`'s own guard has changed
  since this section was written — re-read the callable before trusting this line.

⚠️ **State the residual honestly, in the callable's own words:** `btrim()` with no character set
trims **spaces only**, not tabs or newlines. A vault secret that is pure tabs or newlines still
passes this guard and still produces a header the analytics service answers 401 to. That residual
is explicitly OUT OF SCOPE here — widening the guard to `E' \t\r\n'` is a decision with its own
evidence, tracked separately, not a silent improvement folded into this step.

### Step 3 — the activation (LIVE op 2), only if Step 1 and Step 2 both cleared

Re-run the repaired P3-C from `docs/runbooks/ledger-refresh-go-live.md` § "P3 — venue enable flags"
Part C (reference it; do not paste a third copy here that can rot independently of the other two).

- **Expected:** both mt5-keyed kinds present, healthy counts, `newest` within hours (see that
  section's `Abort if:` bar). Record the OUTPUT.
- **Abort if:** either kind is absent or `newest` is stale by more than a day — in which case skip
  the rest of Step 3 and go to **Step 3-DEFER** below.

If P3-C clears: run the sibling runbook's **Step 1 — the activation flag** (1a throw it, 1b verify
in the SAME session, 1d execution record — `docs/runbooks/ledger-refresh-go-live.md:350`) and then
its **Step 2 — the schedule** (`:412`), which registers:

```sql
SELECT cron.schedule(
  'ledger_refresh_fanout',
  '25 * * * *',
  $$SELECT public.enqueue_ledger_refresh_for_strategies();$$
);
```

- **Expected:** `system_flags.ledger_refresh_enabled` reads `enabled = t` (1b's verify-back), and
  `SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'ledger_refresh_fanout';` returns
  one row, `25 * * * *`, `active = t`.
- **Abort if:** either verify-back fails its sibling section's own bar — do not re-derive a
  different bar here.

**The deliberate exercise.** `enqueue_ledger_refresh_for_strategies()`'s per-candidate handler
(`supabase/migrations/20260907130000_ledger_refresh_switch_to_system_flags.sql`) wraps each
candidate's `enqueue_compute_job` call in its own `EXCEPTION WHEN OTHERS` — one poisoned candidate
logs a `WARNING` and the loop continues rather than aborting. **This whole branch is UNREACHABLE
while the flag is FALSE** (the function returns before ever reaching the candidate loop) and
**becomes reachable only from this moment** — it has never run, on any real candidate, until this
activation. Deliberately fabricating a PROD failure to trigger it was considered and rejected: it
would mean forcing a real `enqueue_compute_job` call to fail against funded strategies, which is
exactly the invented-failure-state this repo's own rules forbid. Instead:
1. **Invoke the fan-out manually once, in this same session, BEFORE Step 2's schedule fires it on
   its own** — `SELECT public.enqueue_ledger_refresh_for_strategies();` run interactively in the SQL
   editor. This is a genuine LIVE op (it can enqueue real jobs), not a dry run — treat it as part of
   the activation, not a rehearsal. Read BOTH the returned integer and the interactive session's
   `NOTICE`/`WARNING` panel — the SQL editor surfaces both live, unlike `cron.job_run_details`,
   whose `return_message` never carries a function's `RAISE NOTICE` output.
2. **If any `WARNING` naming `'one candidate failed to enqueue'` appears**, the branch has been
   genuinely exercised on real data — record the SQLSTATE it carried and confirm the tick still
   returned a non-error result and the advisory lock was released (`pg_try_advisory_lock`/
   `pg_advisory_unlock` pair one level up from the per-candidate handler).
3. **If no `WARNING` appears** (the expected/happy case — none of the current cohort should fail),
   the branch remains formally unexercised on live data. Confirm its SAFETY instead by reading the
   code: the `EXCEPTION WHEN OTHERS` inside the loop catches without re-raising and does not touch
   the advisory lock (the lock is released by the OUTER `EXCEPTION WHEN OTHERS … PERFORM
   pg_advisory_unlock(...); RAISE;` wrapper, one level up), so a poisoned candidate cannot leak the
   lock or abort the tick for the rest of the cohort. Record that this was a code-read confirmation,
   not a live exercise, so a future reader does not mistake it for one.

### Step 3-DEFER — the branch that is expected, not a failed session

If P3-C fails its bar in Step 3: **STOP after Step 2b.** The repoint half is complete; the
activation half defers. This leaves: jobid 1 repointed at `match_engine_cron_tick()` and verified,
`[VAULTTICK-EMPTYKEY-01]` closed, no `ledger_refresh_fanout` row, `system_flags.ledger_refresh_enabled`
still `FALSE`. **Step 4's re-capture still runs** — for the repoint alone. Use the DEFER template in
`164.7-ACTIVATION-PREFLIGHT.md` § 5 to record it: criterion 3 BLOCKED by an operational fault outside
this phase, re-entry condition MT5 terminal authorized and P3-C re-run clean. A DEFER here is a
**legitimate outcome**, not a failure of this session — its last real reading (2026-09-12) FAILED the
freshness bar, so budget for this outcome rather than assume the gate opens.

### Step 4 — ONE re-capture, at the end, whichever branch above was taken

```bash
node scripts/prod-prober/run.mjs --capture-manifest --out scripts/prod-prober/cron-manifest.json
```

Then **read the `command` text of every job in the resulting diff before committing** — the
manifest is a committed, world-readable file in a **public** repository, and each command string
was individually approved for publication when first captured.

- **Expected:** the diff changes jobid 1's `command` and its `command_sha256`, and — only if Step 3
  ran — ADDS exactly one job, `ledger_refresh_fanout`, `25 * * * *`, active.
- **Abort if:** any OTHER job moved. A second unexplained difference means PROD drifted somewhere
  this section is not looking, and committing the manifest would bless it.

⚠️ **Standing warning:** clearing `manifest-invalid` re-animates `compareManifest`'s manifest-side
hygiene loop, which has been dead on every production run for weeks (the committed manifest and the
arm's exported normalization disagreed). Expect manifest-side `cron-secret-in-command` findings
nobody has seen before — measured, a valid manifest yields **1** — and do NOT read them as new
leaks; they are the loop waking back up, not a new credential exposure.

⛔ This repository is **PUBLIC**. Never paste a secret, an MT5 account number, or a broker server
name into the execution record — the manifest re-capture above already covers what is safe to
commit.

## Metrics to watch

- `match_engine_recompute_total{status}` — cron status. Discrete values:
  `ok` (failures don't outnumber successes), `degraded` (`failed > processed`,
  majority-failure but at least one row through), `total_failure`
  (`processed=0, failed>0` — structural fault, alert immediately),
  `disabled`, `skipped` (recent batch), `no_allocators`, `empty_universe`,
  `partial` (Phase 164.5.1 criterion 9: this run stopped at its batch
  boundary — a NORMAL completion of one slice, orthogonal to the
  processed/failed ratio above and never conflated with `degraded` or
  `total_failure`; the `next_cursor` field on the response names where the
  next tick resumes), `kill_switch_unavailable` (Phase 164.5.1 criterion 8:
  the kill-switch read could not be completed after exhausting retries, so
  the engine stopped FAIL-CLOSED — this is NOT the founder pressing the
  switch, which is `disabled`, and the two must never be conflated).
  Pre-v0.22.37.0 this label was binary `ok`/`failed` and `total_failure` was
  masked as a green 200; alert on `degraded` or `total_failure` going forward.
  These status values are documented HERE and NOWHERE ELSE in the repo, and
  `match_engine_recompute_total` has no wired emitter in the repo today —
  this bullet is aspirational documentation; a future dashboard reading it
  should treat `partial` as a success, never as a failure.
- `match_engine_candidates_generated_total` — should tick up each cron run
- `match_engine_recompute_latency_seconds` — p95 < 30s
- Eval dashboard hit rate — the single most important metric for v2 graduation
