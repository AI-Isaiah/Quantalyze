# Runbook — shared TEST's analytics destination row

Phase 164.9 TESTISOLATION / plan 10, closing `[164.8.1-TEST-ANALYTICS-URL-PROD]`.

Shared TEST's `public.system_settings` row `analytics_service_url` is **seeded
with the production analytics host**, and that row is the destination
`public.match_engine_cron_tick()` POSTs a **Vault-held service key** to. So a
scheduled tick on TEST can reach the production compute service, carrying a real
key in an outbound header. This page is how that is measured, how it is
repointed, and — just as importantly — what the repointing does **not** prove.

> **⚠️ Every value below is named, never printed.** This repository is PUBLIC and
> the value in question is a **host**. The gate, the script and this page all
> report a *shape* — a length, a scheme, a classification. **A proof that the
> hazard is gone must not publish the hazard.**

Related: [`shared-test-db-mutex.md`](./shared-test-db-mutex.md) (the advisory key
this operation takes), [`match-engine.md`](./match-engine.md) (the tick itself).

## 1. ⛔ The two traps. Read these before anything else.

**Trap 1 — THE TICK IS ASYNCHRONOUS, so a green scheduled-job row proves
nothing.** `net.http_post` is fire-and-forget: the scheduler records the run as
`succeeded` whether the request got a 200, a 401, or never resolved at all.
Seven days of silent authentication failures once hid behind exactly such a
green history (`CRON-DRIFT-01`). **Nothing on this page is a claim about what any
request did.** The claim is about the ROW.

**Trap 2 — THE DATABASE MARKER CONFIRMS WHICH _DATABASE_ YOU ARE ON. It never
confirms which _SERVICE_ a tick calls.** The two questions sit next to each other
and the first does not answer the second. The marker is what stops you writing to
production; the destination row is what says where a tick would go. Do not let
one stand in for the other.

## 2. Why the destination matters

`system_settings_admin_all` is `FOR ALL TO authenticated` with an `is_admin`
conjunct, so an app-admin can PATCH that row through PostgREST entirely inside
the policy. One tick later the Vault-held key arrives at whatever host it names.
Two independent layers bound this, and neither is touched by the operation below:

- the **CHECK constraint** `system_settings_analytics_service_url_allowed`, which
  refuses to STORE a destination outside the allow-list; and
- the callable's own **re-test** of the same allow-list immediately before it
  builds the header — the layer that is still standing after someone runs one
  `ALTER TABLE … DROP CONSTRAINT`.

⛔ **The allow-list is never weakened.** The remedy changes **which allowed value**
the row holds, and nothing else.

## 3. The remedy, and why it is this one

Point TEST's row at the **loopback discard sink**, `http://127.0.0.1:9` —
loopback, the IANA DISCARD port. The allow-list **already permits it**
(migration `20260907120000`, the *⚠️ THE ONE NON-RAILWAY VALUE* note), so the
change needs no new infrastructure and no constraint edit, and an outbound
attempt lands on a closed local port and is refused harmlessly.

The alternative — standing up a TEST-scoped analytics service — was rejected: it
would make Trap 1 load-bearing and would demand service-side observability this
phase has no way to build.

⛔ **It is NOT a migration and must never become one.** Every merge touching
`supabase/migrations/**` auto-applies to **PRODUCTION**, so a migration here
would repoint production's own destination row at a closed local port.

⛔ **It is NOT closed by editing the reference-data replay allowlist**
(`scripts/restore-test-refdata-allowlist.txt`). That file replays this row
faithfully by an explicit founder decision, and editing it would make the restore
*silently normalise* the hazard — removing the signal instead of the hazard.

## 4. The command

```bash
# 1. DRY RUN — the default. Reads, reports a SHAPE, writes NOTHING.
NORMALIZE_DB_URL="<the shared TEST session-mode DSN>" \
  bash scripts/test-only-normalize-analytics-url.sh --run

# 2. COMMITTING — the one mode that writes. Explicit by design.
NORMALIZE_DB_URL="<the shared TEST session-mode DSN>" \
  bash scripts/test-only-normalize-analytics-url.sh --run --commit

# 3. CONFIRM — re-run the DRY RUN. It must now REFUSE.
NORMALIZE_DB_URL="<the shared TEST session-mode DSN>" \
  bash scripts/test-only-normalize-analytics-url.sh --run
```

⛔ **A founder action.** TEST is shared with other people's CI, so a write there
is not private. The credential is entered by the founder; no agent reads,
decrypts, echoes or logs it. **Reference the secret `TEST_SUPABASE_DB_URL` by
name — never a DSN, host, user or password, here or in any log line.**

⛔ **Do not reach for the Supabase CLI instead.** This checkout's CLI is linked to
**PRODUCTION**; `db push`, `--project-ref` and `--db-url` from this directory all
target prod.

### What runs, in order, all before any write

1. **The database identity marker.** `shobj_description(oid,'pg_database')` on
   the current database, as the **first statement**. `current_database()` is
   `postgres` on both hosted projects and proves nothing. An **absent** marker is
   a **STOP** — an unmarked database is not TEST, it is unknown, and on a hosted
   project a missing marker means the marker was lost. A marker naming
   **production** is refused loudly.
2. **The shared-TEST advisory mutex** (`61616158`), taken as a *transaction*
   lock so a killed run cannot leave it held by a dead holder, and taken with
   `try` rather than a blocking wait so this never queues behind another job's
   apply and then writes into whatever that job left.
3. **Is there anything to do.** No row at all is a refusal (that row is supposed
   to exist; its absence is its own finding). A row that already holds the sink
   is a refusal — a no-op write is still a write against a shared database.
4. **Dry run is the default.** Committing takes an explicit `--commit`.

The write itself is a single targeted `UPDATE` of that one row. It touches
nothing else and it does not alter the constraint.

## 5. What a green verdict means — and what it does not

| Line | What it means |
|---|---|
| `VERDICT: … length N character(s) whose scheme is …` | The row was read. The value is reported by SHAPE and is deliberately not printed. |
| `DRY RUN: nothing was written` | Guards all passed; the write was withheld. |
| `COMMITTED: …` | The row now holds the loopback discard sink. **A claim about the ROW and nothing else.** |
| `REFUSED: … ALREADY holds the loopback discard sink` | ⭐ **This is the post-condition.** |

⭐ **Step 3 is the measurement, not step 2.** The committing run reporting success
is that run's own account of itself. The follow-up **dry run refusing on an
already-correct value** is read from the **LIVE row**, and that is what closes the
claim.

⛔ **No claim is made about HTTP.** See Trap 1. The closure is exactly *"the
destination row on shared TEST no longer names the production host"*, and no
more.

## 6. The gate that keeps measuring it

`supabase/tests/test_analytics_service_settings_and_vault_tick.sql` carries
**arm D1**, a second transaction whose first statement is the marker query and
which then branches — and **no branch is a skip**:

- marker names **TEST** → READ the live row; it must hold the sink;
- **no hand-set marker** (a disposable pg-lane) → the allow-list must exist, must
  **admit** the sink, and must still **refuse** a foreign host;
- marker names **production** → refuse outright;
- **no branch taken at all** → raise.

⚠️ **On shared TEST that arm is RED until step 2 above has been run**, and that red
IS the hazard being reported. ⛔ Do not weaken it to green a board.

## 7. The loop, stated rather than glossed

The reference-data replay reseeds this row **faithfully**, on purpose, and the
allow-list is not edited to change that.

⭐ **Since 2026-09-25 (Phase 164.9.1) a restore re-normalises the row inside its own
transaction.** `scripts/restore-test-from-baseline.sh` appends the fragment that
`scripts/test-only-normalize-analytics-url.sh --emit-restore-sql` prints, after the
reference-data gate and before the ledger DDL. The fragment re-reads the identity
marker, rewrites the one row to the loopback discard sink and checks the read-back,
so the sink commits only if the restore commits. A **preflight** runs the same
fragment and rolls it back, so it writes nothing. A restore whose emitter refuses
assembles no transaction and fails loud.

⚠️ **A hand run of this runbook is still the remedy in two cases:** a **migration**
re-seeds the row (the restore is not involved, so nothing re-normalises it), or the
restore **refuses** and leaves the row as it was. Arm D1 stays the durable
measurement in both, and it stays RED until the row holds the sink. Booked in
`TODOS.md` as `[164.9-TEST-ANALYTICS-URL-REARM]`.

## 8. Proving the guards still bite

```bash
bash scripts/test-only-normalize-analytics-url.sh --self-test
```

Boots its own throwaway cluster on a free loopback port — **it never connects to a
hosted project** — and drives every refusal: absent credential, absent marker, a
marker naming production, a marker naming neither, a mutex held by another
session, a missing row, dry-run-writes-nothing, the verdict withholding the
value, the committing write landing exactly one row, and the follow-up dry run
refusing. It prints a derived check count.

⚠️ **Killing a psql client is not killing its backend.** The self-test's
mutex arm learned this the expensive way: `kill` reaps the client while the
backend sits inside `pg_sleep` still holding the lock, and every later arm then
refuses on a mutex nobody is holding any more — failing for reasons that have
nothing to do with what they were asking. It terminates the backend by the lock
it holds and waits for the lock to go.
