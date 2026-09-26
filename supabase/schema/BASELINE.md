# `baseline.sql` — committed full-schema snapshot

**What it is:** a byte-identical `supabase db dump` (schema only, zero data statements)
of the production catalogue. It is the schema source for the VAC-07 local-stack lane,
which cannot use `supabase db reset` because the migration chain does not replay — see
`scripts/local-stack/REPLAY-SPIKE.md` for that measurement.

## ✅ WIRED 2026-09-07 (Phase 164.5, criterion 1) — the lane reads this file

`scripts/local-stack/run.sh` sets
`BASELINE_FILE="${REPO_ROOT}/supabase/schema/baseline.sql"`, and `load_baseline()` feeds
exactly that file to `psql -v ON_ERROR_STOP=1` against the local stack's `DB_URL`. Ask the
lane rather than reading the assignment — that is what the seam is for:

```
bash scripts/local-stack/run.sh --print-baseline-path
# -> <repo>/supabase/schema/baseline.sql
```

`src/__tests__/baseline-wiring-claim.test.ts` pins this in BOTH directions: it resolves
the lane's answer and this document's prose to absolute paths and fails if either moves
without the other. This section exists because that test requires it — while the lane was
unwired the document had to say so, and the moment the repoint landed the test went RED
until this prose matched. The RED was observed, not assumed (`164.5-01-SUMMARY.md`).

**What is NOT claimed here.** Nothing in `.github/workflows/` invokes
`scripts/local-stack/run.sh up`; the boot recorded in `164.5-01-SUMMARY.md` is a dated
developer-box measurement, not a CI-enforced fact. And this wiring is not a staleness
gate — see the UNGATED section below.

### Committing a regenerated dump is a deliberate, reviewed act

**Relocated from `.gitignore` in this same commit** (Phase 164.5 P-05). A lane-local
`baseline.sql` used to be gitignored, with the reasoning carried in a comment above the
ignore line. The ignore line is gone — the lane no longer reads that path — but the
reasoning is the asset, so it lives here now:

> A schema dump can carry a DSN, a host, or a project ref. Committing one is therefore a
> deliberate, reviewed act, never a casual `git add`. Run the secret scan recorded in
> `scripts/local-stack/REPLAY-SPIKE.md` **first**, and treat any hit as **do not commit**
> (threat T-164.3-09).

⚠️ This repository is PUBLIC. The scan command and the five classes it must cover are in
the *Regenerating* section below; keep the prose claim and the grep pattern identical —
SP-M03 records what happens when they drift apart.

## ⭐ 2026-09-23 (Phase 164.4.2 DECISION F) — the lane REPLAYS the migrations this dump does not carry

**What changed.** Until now the lane's currency gate REFUSED to boot whenever a migration had
landed after this dump (Phase 164.4.2 plan 03). That made every migration merge redden every lane
job until the founder re-dumped PRODUCTION, and it left a PR unable to exercise its own migration
on the lane at all. Since plan 06, `scripts/local-stack/run.sh up` loads this file and then
REPLAYS, in filename order, exactly the `supabase/migrations/*.sql` files this dump does not
carry — each applied as authored, one psql call per file, its
`supabase_migrations.schema_migrations` row written only after it applied. The set is **named on
every boot**, the zero case included (`baseline-replay: 0 migration(s) newer than the dump (none)`),
and a migration newer than the dump is now the normal case, not a red.

**Where the carried set comes from.** `supabase/schema/baseline-carried-migrations.txt` — one
basename per line, headed by a `baseline-sha256:` line that must equal this file's sha256. It is
read by `node scripts/check-baseline-currency.mjs --replay-set` (via `run.sh --check-currency`
and `run.sh up`), never inferred from commit dates. The lane REFUSES to boot when the set cannot
be determined: marker absent, unbound (`marker-sha-absent`), bound to another dump
(`marker-sha-mismatch`), empty, malformed, naming a migration this checkout lacks
(`dump-ahead-of-checkout` — bring in the base branch), or an unclassifiable file in
`supabase/migrations/`. A replayed migration that errors is FATAL, and the ephemeral stack is torn
down. Its bootstrap content is the 273 `*.sql` basenames in the tree of merge `2091fea6` — the
merge whose PRODUCTION apply preceded the 2026-09-23 capture.

**What the marker cannot vouch for.** It records the founder's statement of which migrations had
applied to PRODUCTION when the dump was taken. It does **not** re-derive the dump's catalogue, and
nothing checks that the catalogue actually contains every listed migration's effect — that is
still the content gates' question (`baseline-content-drift-check`, function bodies only).

**Why a full list and not a frontier version.** MEASURED at planning time across
`git log --diff-filter=A` of `supabase/migrations/`: **5** timestamp-versioned migrations were
committed AFTER a migration with a higher version already existed (e.g.
`20260513094906_enable_pg_cron.sql` after `20260515210400_commit_scenario_batch_high_hardening.sql`),
and `supabase-migrate.yml` applies with `db push --include-all` precisely to apply such files. A
frontier ("everything up to version V is carried") would classify such a file as carried, never
replay it, and boot green on a schema missing it. A full list cannot make that mistake.

## Provenance

| | |
|---|---|
| Taken | 2026-09-26 |
| Source | production catalogue, read-only `supabase db dump --linked` |
| Supabase CLI | 2.84.2 (CI pins 2.98.2 — see the caveat below) |
| sha256 | `22cce9c0241f01090ff9d46208391654660c49233945364c9ba96db28a69d076` |
| Shape | 63 tables, 155 policies, 123 function statements (121 distinct names), **0 data statements** |

Secret-scanned before commit with the exact pattern recorded in
`scripts/local-stack/REPLAY-SPIKE.md`: no DSN, no `\connect`, no `ALTER DATABASE`, no JWT,
no project ref. The only matches for the words `SECRET` / `PASSWORD` / `api_key` are inside
documentation comments that already ship publicly in `supabase/migrations/**`, so this file
discloses nothing that the migration history did not already.

### Regenerated 2026-09-26 — the Phase 164.9.1 apply, three migrations, no shape change

⛔ **A SEPARATE REVIEWED ACT, taken by the founder** with a read-only `supabase db dump --linked`
(CLI 2.84.2); this checkout runs no database command against a remote. Taken AFTER Phase 164.9.1's
migrations had applied to PRODUCTION (Supabase Migrate run `36221903723`, `apply-test` and `apply`
jobs success, on merge commit `96219c04a`, the `MERGE` used to regenerate the marker). No later
merge touches `supabase/migrations/**` (`096671f2d`, #861, changes CI only).

**Which migrations the new dump now carries** — measured from the marker diff, the complete set
added since the 2026-09-24 capture:

| migration | what it adds | expected shape delta |
|---|---|---|
| `20260924230827_fanin_initial_status_10param.sql` | `CREATE OR REPLACE` + `COMMENT ON FUNCTION` of `_enqueue_compute_job_internal` | none of the counted shapes (body replacement of an existing function) |
| `20260924233749_allocator_sync_restore_inflight_prefetch.sql` | `CREATE OR REPLACE` + `COMMENT ON FUNCTION` of `request_allocator_holdings_sync` | none of the counted shapes |
| `20260925071300_bridge_outcomes_invariant_comments.sql` | `COMMENT ON TABLE` / `COMMENT ON COLUMN` on `bridge_outcomes` | none of the counted shapes |

**MEASURED:**

| | |
|---|---|
| Shape | 63 tables, 155 policies, 123 function statements — **unchanged** |
| Data statements | **0** — unchanged |
| sha256 | `b473ab7e…` → `22cce9c0…` |
| Secret scan (all five classes) | **0** matches; gitleaks over the file: no leaks |
| Home path / local username | 0 matches |
| File integrity | single `SET client_encoding`, no NUL bytes |
| Currency gate | `baseline-currency: carried=277 replay=0 marker-sha=match defects=0` |
| Function snapshot | `dump-sql-functions.ts --check`: 121 names agree, 0 ratcheted disagreements |
| Body drift | `baseline-content-drift`: compared 123 — MATCH 120, DRIFT 3 (the three allowlisted `[DRIFT-06]` rows), findings **0**. The pre-dump reading on `main` was DRIFT 5 with findings, the red `sql-gate-lint` this dump clears. |

### Regenerated 2026-09-24 — the Phase 164.6 apply, two function bodies, nothing else

⛔ **A SEPARATE REVIEWED ACT, taken by the founder** with a read-only `supabase db dump --linked`
(CLI 2.84.2); this checkout runs no database command against a remote. Taken AFTER Phase 164.6's
migration had applied to PRODUCTION (Supabase Migrate run `36040151966`, `apply` job success, on
merge commit `762c03c8`, the `MERGE` used to regenerate the marker).

**Which migrations the new dump now carries** — measured from the marker diff, the complete set
added since the 2026-09-23 capture:

| migration | what it adds | expected shape delta |
|---|---|---|
| `20260924120000_ledger_fanout_failure_count.sql` | the two fan-out bodies record a `candidate_enqueue_failed` run row and honour its cooldown | none of the counted shapes (`CREATE OR REPLACE` of existing functions) |

**MEASURED:**

| | |
|---|---|
| Shape | 63 tables, 155 policies, 123 function statements — **unchanged**, as a body replacement must leave them |
| Data statements | **0** — unchanged |
| sha256 | `efe49c15…` → `b473ab7e…` |
| Secret scan (all five classes) | **0** matches; gitleaks over the file: no leaks |
| Home path / local username | 0 matches |
| File integrity | single `SET client_encoding`, no NUL bytes |
| Currency gate | `baseline-currency: carried=274 replay=0 marker-sha=match defects=0` |

### Regenerated 2026-09-23 — the Phase 167 apply, one widened CHECK, nothing else

⛔ **A SEPARATE REVIEWED ACT, taken by the founder** with a read-only `supabase db dump --linked`
(CLI 2.84.2); this checkout runs no database command against a remote. Taken AFTER Phase 167's
migration had applied to PRODUCTION (Supabase Migrate run `35819065230`, `apply` job success, on
merge commit `2091fea6`), so the dump carries it rather than predating it.

**Which migrations the new dump now carries** — measured, not assumed, as the complete set added
since the 2026-09-22 capture:

| migration | what it adds | expected shape delta |
|---|---|---|
| `20260922120000_api_keys_sync_status_sign_in_failed.sql` | widens `api_keys_sync_status_check` to admit `sign_in_failed` | none of the counted shapes |

**MEASURED:**

| | |
|---|---|
| Diff against the prior capture | **exactly one line** — the `api_keys_sync_status_check` definition, now ending in `'sign_in_failed'`; every prior value still present |
| Shape | 63 tables, 155 policies, 123 function statements / 121 distinct names — **unchanged**, as a CHECK widening must leave them |
| Data statements | **0** — unchanged, as a schema-only dump must be |
| sha256 | `447a3a60…` → `efe49c15…` |
| Secret scan (all five classes) | **0** matches; gitleaks over the file: no leaks |
| Home path / local username | 0 matches |
| File integrity | single `SET client_encoding`, no NUL bytes; leading/trailing whitespace shape (3 / 32) byte-identical to the prior capture |

⚠️ The dump ran while a full vitest run was reading the tree. Per the 2026-09-22 hazard note
below, `-f` truncates the target for the dump's whole duration, so any baseline-reading test in
that run is re-run after the dump rather than trusted.

### Regenerated 2026-09-22 — the two migrations that landed after the 2026-09-18 capture

⛔ **A SEPARATE REVIEWED ACT, taken by the founder** — this checkout runs no database command
against a remote, so the dump itself is a founder step. Taken at the request of Phase 164.4.2
plan 03, whose currency gate had correctly REFUSED: the committed dump was 2026-09-18 while
`supabase/migrations/` had moved on 2026-09-20.

**Which migrations the new dump now carries** — measured, not assumed, as the complete set added
since the prior capture:

| migration | what it adds | expected shape delta |
|---|---|---|
| `20260919120000_strategy_sync_cursors.sql` | `strategy_sync_cursors` + RLS + a deny-all policy + a service_role grant | +1 table, +1 policy |
| `20260920120000_api_keys_venue_account_id_grant.sql` | a column-level `GRANT SELECT (venue_account_id)` | none of the counted shapes |

**MEASURED:**

| | |
|---|---|
| Shape delta | tables 62 → **63**, policies 154 → **155** — exactly the one table and one policy above |
| Functions | 123 statements / 121 distinct names — **unchanged**, as a grant-only migration must leave them |
| Data statements | **0** — unchanged, as a schema-only dump must be |
| sha256 | `d8dd1786…` → `447a3a60…` |
| Secret scan (all five classes) | **0** matches |
| Home path / local username | 0 matches |
| File integrity | single dump preamble, single `SET client_encoding`, no NUL bytes; leading/trailing whitespace shape (3 / 32) byte-identical to the prior capture, i.e. the CLI's own output shape |

⚠️ **An in-flight hazard was created and closed during this regeneration, recorded because the
next person deserves the warning.** `supabase db dump -f <path>` TRUNCATES its target before it
writes, so the file reads **0 bytes for the whole duration of the dump**. A reader who measures
the file mid-run sees an empty file and can wrongly conclude the dump failed; acting on that
reading by restoring the previous content writes into a path the running CLI still owns. That
happened here. The dump completed and overwrote the interference, and the file was then verified
intact by the structural checks in the table above — one preamble, coherent counts, and a shape
delta that maps exactly to the two migrations. ⛔ **Do not read the file while the dump is
running, and do not write to that path until the command has exited.**

### Regenerated 2026-09-18 — the Phase 164.1.1 apply, one NEW function, nothing else

⛔ **A SEPARATE REVIEWED ACT, TAKEN AFTER THE APPLY.** The apply is run **`35347643879`**
(`apply-test` success → founder-approved `Production` gate → `apply` success, all six jobs green
on merge commit `eec8a659`); the dump followed it. Taking it before would have recorded a
production that did not yet exist. The prior capture (2026-09-17, sha256 `4335f524…`) moves to
`d8dd1786…`.

**Why it was taken:** `sql-gate-lint` was RED on `main` from the moment PR #815 merged — the
committed baseline had no body at all for `public.prod_prober_cadence_check()`, which the phase's
forward migration `20260918120000` creates. That is the intended sequence, not a failure: gates
carrying applied-ness probes are red on a migration PR by construction
(`[164.8-PUSH-RACE-VAC08]`), and this regeneration is what clears them. Precedent: PR #778 merged
red and PR #782 cleared it; PR #815 merged red and this clears it.

**MEASURED, not assumed:**

| | |
|---|---|
| Function present in the new dump | yes — 6 occurrences of `prod_prober_cadence_check` |
| Shape delta | 122 → **123** function statements, 120 → **121** distinct names. Exactly one. |
| Tables / policies / data | 62 / 154 / **0** — all unchanged, as a schema-only dump must be |
| `baseline-content-drift` before | `compared 123 — MATCH 119, DRIFT 3, SNAPSHOT_MISSING 1`, findings 1 |
| `baseline-content-drift` after | `compared 123 — MATCH 120, DRIFT 3, SNAPSHOT_MISSING 0`, **findings 0, exit 0** |
| `DRIFT-06` trio | still 3, untouched — this regeneration was never expected to clear them |
| Secret scan (all five classes) | **0** matches; gitleaks over the file: no leaks |

⭐ **A ratchet row was DELETED, not added.** Phase 164.1.1 had carried a `snapshot-only`
`NAME_SET_RATCHET` row in `scripts/dump-sql-functions.ts` for this function, with its clearing
condition written into the row. This regeneration satisfied it, the gate reported it
`ratchet-stale` — *"present on BOTH sides; the disagreement is gone"* — and the row was removed.
`--check` now reads *"SQL function snapshot is current (121 functions) … 0 ratcheted
disagreement(s) carried."* The list may only shrink, and this is the shrink.

### Regenerated 2026-09-17 — the Phase 164.5.1.1 apply, one function body, nothing else

⛔ **A SEPARATE REVIEWED ACT, taken AFTER the apply and not before it.** Taking it before would
have recorded a production that did not yet exist. The apply is run **`35247369125`**
(`apply-test` success → founder-approved `Production` gate → `apply` success); the dump followed
it. The prior capture (2026-09-12, sha256 `a00b3cc5…`) moves to `4335f524…`.

**Why it was taken at all:** `sql-gate-lint` had been RED on `main` since the Phase 164.5.1.1
migration applied — the committed baseline still described PROD's pre-apply body for
`enqueue_ledger_refresh_for_strategies`. That is the intended sequence in this repo, not a
failure: gates carrying applied-ness probes are red on a migration PR by construction
(`[164.8-PUSH-RACE-VAC08]`), and the baseline regeneration is what clears them. Precedent: PR #778
merged red, PR #782 cleared it.

**MEASURED, not assumed:**

| | |
|---|---|
| shape | **UNCHANGED** — 62 tables, 154 policies, 122 function statements, 126 indexes |
| data statements | **0** |
| diff | 37 added / 9 removed, read hunk by hunk |
| hunk attribution | BOTH hunks belong to `20260917120000_ledger_fanout_admit_private.sql` — the widened lifecycle conjunct with its comment, and the check-7b comment that the same migration restored. Nothing else moved. |
| baseline-content-drift | `MATCH 118, DRIFT 4, findings 1` → **`MATCH 119, DRIFT 3, findings 0`**, exit 0 |
| secret scan | **0 hits** across all five classes, `grep -a` |

⛔ **`CONTENT_DRIFT_ALLOWLIST` NOT edited — it neither grew nor shrank.** Still exactly three rows
(`check_fan_in_ready/1`, `reject_sentinel_writes/0`, `retention_delete_guard/0`), the permanent
DRIFT-04/06 family whose own `clearedBy` says a regeneration will never clear them — and it did
not. The row this apply would have needed was never added: the drift cleared itself, which is the
only legitimate way. The list may only shrink.

⚠️ **What this regeneration could have absorbed silently, checked rather than trusted:** a `db
dump` captures whatever PROD holds, so an unrelated table, policy or body that drifted underneath
us would ride along unnoticed. The shape row above is that check — every count is identical to the
2026-09-12 capture, and the only textual movement is the two attributed hunks.

### Regenerated 2026-09-12 — the Phase 164.8.6 apply, and NOTHING else came with it

⛔ **This regeneration is a SEPARATE REVIEWED ACT, as this file requires.** It was taken only
AFTER the migrations were applied to production — dispatched run `34686331921`, whose `apply`
reported `planned 2 migration version(s); push reported 2.` with both server-side NOTICEs.
Regenerating BEFORE the apply would have recorded a PROD that did not yet exist.

**The measured shape is UNCHANGED from the 2026-09-08 capture** — 62 tables, 154 policies, 122
function statements (120 distinct names), **0 data statements** — so nothing was added or
dropped. The whole diff is **372 added / 11 removed lines**, and every hunk is attributable to
the two migrations this repository just applied:

- **`match_engine_cron_tick`** — the cardinality-guarded Vault read (`INTO STRICT`), the
  whitespace-aware `btrim(v_key) = ''` guard, and the overload census.
- **`enqueue_ledger_refresh_for_strategies`** and **`enqueue_ledger_composite_refresh`** — both
  fan-outs re-based with the dormancy instrument (`v_found` / `v_read_failed` / `v_sqlstate` /
  `v_cause`).
- ⭐ **Two ACL hunks that are the WHOLE POINT of the hardening, and are visible here as
  production fact rather than as repo intent:**
  `GRANT ALL ON FUNCTION "public"."match_engine_cron_tick"() TO "service_role"` is **GONE** —
  EXECUTE is held by the owner alone (`164.7-WR02-SERVICE-ROLE-EXECUTE`); and `cron_runs` for
  `anon`/`authenticated` narrows from `GRANT ALL` to
  `GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE`, which is exactly
  `REVOKE TRUNCATE, REFERENCES, TRIGGER` from `20260911130000`.

⚠️ **The risk this regeneration carries, checked rather than assumed:** a `db dump` captures
PROD's WHOLE catalogue, so anything else that drifted since 2026-09-07 would ride along
silently. It was read hunk by hunk before committing — there is nothing in this diff that the
two migrations do not explain.

**Effect on the gate:** `node scripts/baseline-content-drift-check.mjs` goes from
`MATCH 116, DRIFT 6, findings 3` to **`MATCH 119, DRIFT 3, findings 0`**. The three remaining
DRIFT rows are exactly the three PERMANENTLY allowlisted ones — `check_fan_in_ready/1`,
`reject_sentinel_writes/0`, `retention_delete_guard/0` — which belong to Phase 164.10 BODYDRIFT
and whose own `reason`/`clearedBy` text says a regeneration will never clear them. ⛔ The
allowlist was NOT edited: it neither grew nor shrank, and the rows this apply made stale
cleared themselves.

### Regenerated 2026-09-08 — a PURE DELETION, 91 lines, nothing else moved

The prior capture (2026-09-07, sha256 `9fad9a1b…`, 726 198 bytes, 123 function statements /
121 distinct names) differs from this one by **91 removed lines and ZERO added lines**. That
is the whole diff. It is the `create_allocator_connected_strategy` block and its attendant
`GRANT` / `REVOKE` / `COMMENT` statements, removed from PROD by migration
`20260908120000_drop_create_allocator_connected_strategy.sql` (PR #758).

⭐ **The zero-added-lines reading is itself a measurement worth keeping**: it says PROD's
catalogue moved in exactly one way since 2026-09-07 and in no other. Had any function body,
policy or table drifted underneath us, this regeneration would have silently absorbed it —
a pure-deletion diff is what rules that out. Table and policy counts are unchanged at
62 / 154; function statements fall 123 → 122 and distinct names 121 → 120, the single
overload that was dropped.

Re-secret-scanned after the dump with the FULL five-class pattern under `grep -a`
(the `-a` is not optional — this repository contains a measured NUL-bearing file and grep
reports such a file as clean with exit 1): **no matches**.

### Regenerated 2026-09-07 — what moved, and what did NOT

The prior capture (2026-08-29, sha256 `514ba9bc…`, 14 921 lines / 701 524 bytes, 61 tables /
152 policies / 121 function statements / 119 distinct names) stays here as dated lineage. It
was regenerated on a founder decision because DRIFT-05 gate (b)'s first credentialed run went
RED and was RIGHT: two functions existed in PROD and in no committed baseline.

**The diff is 449 changed lines out of 15 260 (394 added, 55 removed) across 27 hunks, and
NONE of it is cosmetic.** The same CLI (2.84.2) produced both files, and the unified diff's
first hunk starts at line 3766 — there is no header, version, ordering or quoting churn
anywhere in the file. Every hunk is content:

| Change | Origin |
|---|---|
| `system_settings` table + 2 policies + URL allow-list constraint + grants + comments | Phase 164.7 `20260907120000` |
| `match_engine_cron_tick()` + owner + grants + comment | Phase 164.7 `20260907120000` |
| `enqueue_ledger_composite_refresh` / `enqueue_ledger_refresh_for_strategies` bodies re-based off the unsettable `app.*` GUC onto `public.system_flags` | Phase 164.7 `20260907130000` |
| `strategy_analytics_drop_stale_error_provenance()` + its BEFORE UPDATE trigger + comments | Phase 164.2 `20260906120000` |
| `strategy_analytics.computation_error_source` / `.computation_error_job_id` columns, comments, and their appearance in two `sync_strategy_analytics_status` INSERT column lists | Phase 164.2 `20260906120000` |

Distinct function names went **119 → 121**, and the two additions are exactly the two names
DRIFT-05 reported as `live-only`. That gate's verdict and this dump agree number-for-number.

⛔ **The regeneration did NOT clear three drifting bodies, and that is the finding.**
`check_fan_in_ready`, `reject_sentinel_writes` and `retention_delete_guard` were all pinned in
`CONTENT_DRIFT_ALLOWLIST` with `clearedBy: "A regeneration of supabase/schema/baseline.sql
from PROD"`. The regeneration happened and **their `snapshotHash` values did not move by a
single bit** — PROD's bodies were never stale. PROD runs an EARLIER revision of each than the
migration chain renders. `retention_delete_guard` is the cleanest specimen: exactly one
migration in this repository defines it, and PROD's `RAISE` message is missing a clause that
single defining migration contains, which a live catalogue cannot lag. That is a PROD-vs-REPO
divergence of the DRIFT-04 family, not baseline staleness; it is tracked as **DRIFT-06** in
`TODOS.md` and each allowlist row now records the measurement instead of the falsified claim.

## Why it exists rather than a migration replay

`scripts/dump-sql-functions.ts` snapshots FUNCTION bodies hermetically by text-replaying the
migrations. Its own header records the boundary: tables, columns, policies and triggers evolve
via incremental `ALTER`s that text-replay cannot reconstruct, and it deferred the full-schema
case to "the Supabase local stack in CI". Phase 164.3 plan 04 measured that route and it is
closed — 69 of 262 migrations fail to replay from empty, from at least six independent causes,
one of which (`20260823120000_revoke_api_keys_insert.sql`) refuses BY DESIGN to run against a
database it cannot identify and therefore can never replay onto a fresh local DB.

So the baseline is a dump, not a replay. **Derivation is a one-time act; it is not a standing
coupling.** This file is pinned in git and reviewed in a PR, so every developer and every CI
run gets identical bytes — the same relationship a lockfile has to a registry.

⭐ **Dated note, 2026-09-23 (Phase 164.4.2 DECISION F).** The claim above about replaying the chain
**from EMPTY** stands unchanged — the lane still never does that. What is new is a **TAIL** replay:
on top of this dump, the lane applies only the migrations the dump does not carry (named by
`baseline-carried-migrations.txt`), and that is now its normal boot path. See the DECISION F
section near the top of this file.

## ✅ GATED as of 2026-09-07 (Phase 164.5) — WINDOWS.md 29 is closed

⚠️ **This section said the opposite until 2026-09-07 and the claim outlived its truth by nine
days.** It read: *"There is no staleness check on this file yet … nothing yet gates this …
Building the gate is Phase 164.5 scope."* That is exactly the defect class this phase exists to
close — a claim never compared to the thing it describes — so it is corrected here rather than
quietly overwritten.

TWO gates now cover this file, and they cover DIFFERENT things:

1. **`scripts/check-baseline-staleness.mjs`** (Phase 164.5 plan 02) — a CO-EDIT gate. It fails
   when `supabase/schema/baseline.sql`'s sha256 stops matching the value recorded in THIS file,
   and passes only when both move together. Wired into `.github/workflows/sql-function-snapshot.yml`,
   self-test first. Defect kinds: `baseline-sha-mismatch`, `baseline-sha-absent`,
   `baseline-sql-unreadable`.
2. **`scripts/baseline-content-drift-check.mjs`** (Phase 164.5 plan 03) — a CONTENT gate pinning
   this file to the MIGRATION CHAIN. The co-edit gate above cannot fire when a migration changes
   a function body and `baseline.sql` is left untouched; this one can.

⛔ **Neither gate makes the dump comprehensively current.** Gate 2 compares FUNCTION BODIES ONLY
— not tables, columns, policies, triggers, grants, indexes, defaults or extensions — and its
chain side is a hermetic text replay, not a live one (69 of 262 migrations fail to replay from
empty, so a live replay is impossible here, not merely slow). Read its own SCOPE line, which it
prints on every run. The provenance number above is still only "true on 2026-09-07" for
everything outside function bodies — the regeneration refreshes WHEN that statement was taken,
never WHAT it covers.

**Version-skew caveat for whoever writes that gate:** the local CLI is 2.84.2, CI pins 2.98.2.
If `pg_dump` output formatting differs between them, a `--check` authored against these bytes
will red on CI for cosmetic reasons. Phase 164.3 plan 02 hit this exact class — migration source
and `pg_get_functiondef` render the same function differently — and solved it by comparing
extracted bodies rather than whole statements. Normalize before diffing, or pin the dumper
version in the gate. Do not discover this as a mystery red.

## Regenerating

Read-only, from a checkout linked to production, DSN never committed or echoed:

```
supabase db dump --linked -f supabase/schema/baseline.sql
grep -anE 'postgres(ql)?://|@[a-z0-9.-]+\.supabase\.(co|com)|[a-z]{20}\.supabase|\\connect|ALTER DATABASE|eyJ[A-Za-z0-9_-]{10,}|sb_secret_[A-Za-z0-9_-]{16,}|(^|[^_A-Za-z])[Pp][Aa][Ss][Ss][Ww][Oo][Rr][Dd]("? *(:=|=| ) *[Ee]?[^ -&(-~][!-&(-~]|"? *: *"[!#-~]|=[!-&(-~])' supabase/schema/baseline.sql
```

Any hit on the second command means **do not commit**.

⛔ **Then regenerate `supabase/schema/baseline-carried-migrations.txt` in the SAME commit** (Phase
164.4.2 DECISION F). Take the list from the tree of the merge whose PRODUCTION apply preceded the
dump — not from your working tree, which may hold migrations PRODUCTION has not received — and
recompute the sha line:

```
MERGE=<the merge commit whose Production apply preceded the dump>
{ sed -n '/^#/p' supabase/schema/baseline-carried-migrations.txt
  printf 'baseline-sha256: %s\n' "$(shasum -a 256 supabase/schema/baseline.sql | cut -d' ' -f1)"
  git ls-tree --name-only "$MERGE" supabase/migrations/ | grep '\.sql$' | sed 's#.*/##' | sort
} > /tmp/carried && mv /tmp/carried supabase/schema/baseline-carried-migrations.txt
bash scripts/local-stack/run.sh --check-currency   # expect marker-sha=match defects=0
```

**If this step is skipped,** the lane refuses to boot with `marker-sha-mismatch` — the new dump's
sha256 no longer matches the marker's — rather than replaying against a list that describes a
different dump. That refusal is the point.

**Regenerate-then-shrink.** Each regeneration moves the migrations it now carries from the replay
set into the marker, so the set the lane replays shrinks back toward zero. Refreshing the dump is
therefore periodic upkeep, **not** a per-migration founder action: between regenerations a new
migration simply replays on the lane.

⭐ **AUTOMATED 2026-09-26 (Phase 164.9.5 AUTOREDUMP).** The procedure above now runs by itself.
After `supabase-migrate.yml`'s `apply` job succeeds on `main`, the `redump-dump` job re-dumps
PRODUCTION read-only with the same credential set as `apply`, and the `redump-pr` job proposes
the result as ONE pull request from the fixed branch `automation/baseline-redump`, reused across
applies. The logic lives in `scripts/baseline-redump.mjs`: `--gate-dump` runs in the credentialed
job, `--compose`, `--check-bot-branch` and `--open-or-edit-pr` in the write-token job, so the
PROD credential and the write token never share a job. It REFUSES, and proposes nothing, on any
of: a hit of the secret scan above (the five classes, a Supabase `sb_secret_` key, or a password
in a credential form, in any case: a quoted string after the word, a JSON `"password":` member,
or `password=` in a connection string, while `WHERE password = x` is not a hit; only the count and line numbers are printed, never the
line); a gitleaks finding over the dump (explicit `.gitleaks.toml`, redacted, inline allow
comments ignored, a missing or empty dump refused rather than read as clean); a NUL byte, a
`SET client_encoding` count other than one, or a home-directory path; zero tables or any data
statement; a dump that lost a `CREATE EXTENSION` name the committed dump carries (the same check
reads `CREATE SCHEMA` names too, but that half is forward-looking only: the committed dump has 0
`CREATE SCHEMA` lines, so it covers nothing today); a dump whose `CREATE TABLE`, `CREATE POLICY`,
`CREATE TRIGGER` or `GRANT` count falls below the committed dump's, which is what catches a dump
cut off mid-stream (a class that a migration the dump newly carries can lower, through a `DROP`
or `REVOKE`, is exempted and named in a `::notice::`);
a `main` that lacks a migration the merge carries (it would pair PROD with a marker that
disagrees with it; a re-run attempt is NOT refused by its number, because this listing check
already judges it, D-32); a marker not taken from the tree of the
applied merge; an artifact whose merge is not an ancestor
of `main`, or whose marker omits a migration `main`'s marker carries and `main`'s checkout still
holds (a migration renamed or deleted on `main` is exempted and named in a `::notice::`); a red currency, content-drift
or staleness gate on the composed tree; the skip trailer in the commit message or the PR text;
a proposal already on the bot branch whose marker carries a migration the composed commit lacks
and `main`'s checkout holds (a re-run of an older run's `redump-pr` never replaces a newer open
proposal); and a commit on the bot branch that the bot did not author, while an open pull request has that
branch as its head (once that pull request is merged or closed, the next run resets the branch). It writes only the six paths PR #864
changed (the dump, the marker, this file, `CHANGELOG.md`, `VERSION`, `package.json`), with
measured values only. It never writes the "what it adds" column; the PR body asks the reviewer
to add it. ⛔ **It never merges.** Its CI runs wait for a human to click
**Approve workflows to run**, and because branch protection is off, a merge with zero completed
checks is possible: read each head-SHA run's conclusion before merging. When the dump and marker
are byte-identical to the committed pair, it opens nothing and prints a `::notice::` instead.
It does the same, and leaves the baseline alone, when `main` already carries a migration the
applied merge lacks (D-31): PROD has not applied that later migration yet, so this dump would be
superseded, and that migration's own apply run re-dumps.
The manual procedure above REMAINS the fallback, for a refusal that needs a human reading of the
dump, or when the automation is unavailable.

⚠️ **SP-M03 — the CLAIM used to exceed the COMMAND.** The certification above names five
classes (DSN, `\connect`, `ALTER DATABASE`, JWT, project ref); this grep matched only three
of them. A future regeneration carrying a `\connect` line or a JWT would have passed the
documented check and landed in a PUBLIC repo. The pattern now covers all five, and `-a` is
not optional — this repository contains a MEASURED NUL-bearing file, and grep reports a
NUL-bearing file as clean with exit 1. Today's `baseline.sql` is clean under the FULL set
(re-run independently 2026-08-29, and again on the 2026-09-07 regeneration — the nine NEW
matches for those three words are two `vault.decrypted_secrets` / `decrypted_secret`
IDENTIFIERS and three `COMMENT ON` bodies, carrying no secret VALUE and already shipping
publicly in `supabase/migrations/20260907120000`), so this is forward-looking, not a live
exposure. If you
widen the prose, widen this line in the same edit — that mismatch is the defect class this
whole phase exists to remove.

## What the first use of this file found

Diffing its function names against `supabase/schema/functions/` surfaced
`create_allocator_connected_strategy`: present in production, defined by **no migration in this
repo**. Its own comment points at "migration 043", a legacy numbered file that does not exist
here. Nothing in `src/` calls it.

⚠️ **SP-I05 — this paragraph used to read as a live vulnerability, and it is not one.** It
described the function as `SECURITY DEFINER` + `OWNER TO postgres` + `GRANT ALL … TO
authenticated` writing encrypted credential material, and OMITTED the guards. All three
attributes are true, and the body — re-read from `baseline.sql` on 2026-08-29 — refuses
anything but a self-write:

| Guard | Effect |
|---|---|
| `v_auth_uid UUID := auth.uid();` then `IF v_auth_uid IS NULL THEN RAISE` | no anon caller |
| `IF v_auth_uid <> p_user_id THEN RAISE` | cannot write for another user |
| `IF v_portfolio_owner IS NULL THEN RAISE` | portfolio must exist |
| `IF v_portfolio_owner <> p_user_id THEN RAISE` | portfolio must be the caller's |

It also carries `SET search_path TO 'public', 'pg_catalog'`, which closes the usual
SECURITY DEFINER hazard. **It is not exploitable**, and triaging DRIFT-04 as a security
incident would spend the response budget in the wrong place.

The real issue is GOVERNANCE, and it is unchanged: a production function defined by no
migration, carried by no snapshot, called by nothing in `src/`, and INVISIBLE TO EVERY GATE —
so its next edit is unreviewable by construction. Disposition stays **DROP** (or adopt it
under a migration); that is a founder call, not a remediation deadline.

Neither existing gate could see it. `dump-sql-functions.ts` is hermetic, so a function absent
from the migrations is absent from its input and therefore from its diff. VAC-04 compares
committed snapshots against production bodies, and there is no snapshot to compare. Tracked as **DRIFT-04** in
`TODOS.md` (the missing gate direction is DRIFT-05); the disposition (drop it, or adopt it under a migration) is a founder call.
