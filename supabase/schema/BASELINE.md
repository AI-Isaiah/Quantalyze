# `baseline.sql` — committed full-schema snapshot

**What it is:** a byte-identical `supabase db dump` (schema only, zero data statements)
of the production catalogue. It exists to become the schema source for the VAC-07
local-stack lane, which cannot use `supabase db reset` because the migration chain does
not replay — see `scripts/local-stack/REPLAY-SPIKE.md` for that measurement.

## ⛔ NOT WIRED YET — this file currently has NO consumer

**Nothing reads it.** `scripts/local-stack/run.sh:50` sets
`BASELINE_FILE="${LANE_DIR}/baseline.sql"` — that is `scripts/local-stack/baseline.sql`,
a *different* path, which `.gitignore:138` ignores and which does not exist in a fresh
checkout. MEASURED 2026-08-29: `bash scripts/local-stack/run.sh up` exits 1 with
`FATAL: no schema baseline at .../scripts/local-stack/baseline.sql`. A grep across
`scripts/`, `.github/`, `package.json` and `src/` for `supabase/schema/baseline.sql`
returns only this document.

This section replaces a sentence that read *"It **is** the schema source for the VAC-07
local-stack lane"* — present tense, about a wiring that does not exist. That is this
phase's own defect class (a claim never compared to the thing) inside an artifact this
phase shipped, so it is corrected here rather than papered over.

**The wiring is deliberately NOT done in 164.3.** VAC-07 was deferred by founder decision
on 2026-08-29 (`.planning/phases/164.3-…/164.3-07-DEFERRED.md`), and repointing `run.sh`
now would change plan 04's shipped behaviour without plan 04's gates being re-run.

**Phase 164.5 (BASELINE-SNAPSHOT) owns all three steps**, together:

1. repoint `BASELINE_FILE` at `supabase/schema/baseline.sql` (or add it as the fallback);
2. drop `.gitignore:138`, which is what makes the lane-local path invisible;
3. add the staleness gate below, including an assertion that the loaded baseline's
   sha256 matches the one recorded here — so a silently-swapped baseline is a failure
   rather than a load.

Until then the lane fails loud, which is the correct behaviour for a lane with no schema.
It is not, and must not be described as, a lane that reads this file.

## Provenance

| | |
|---|---|
| Taken | 2026-08-29 |
| Source | production catalogue, read-only `supabase db dump --linked` |
| Supabase CLI | 2.84.2 (CI pins 2.98.2 — see the caveat below) |
| sha256 | `514ba9bccd3181d925860576479e1d9ed623e429b3cb8d135f70a031e24a37fb` |
| Shape | 61 tables, 152 policies, 121 function statements (119 distinct names), **0 data statements** |

Secret-scanned before commit with the exact pattern recorded in
`scripts/local-stack/REPLAY-SPIKE.md`: no DSN, no `\connect`, no `ALTER DATABASE`, no JWT,
no project ref. The only matches for the words `SECRET` / `PASSWORD` / `api_key` are inside
documentation comments that already ship publicly in `supabase/migrations/**`, so this file
discloses nothing that the migration history did not already.

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

## ⚠️ UNGATED as of this commit — see WINDOWS.md 29

There is **no staleness check on this file yet**. `sql-function-snapshot.yml` gates
`supabase/schema/functions/`; nothing yet gates this. A snapshot with no drift gate is exactly
the artifact that diverges quietly and then gets trusted, so treat the number above as "true on
2026-08-29" and nothing more. Building the gate is Phase 164.5 scope.

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
grep -anE 'postgres(ql)?://|@[a-z0-9.-]+\.supabase\.(co|com)|[a-z]{20}\.supabase|\\connect|ALTER DATABASE|eyJ[A-Za-z0-9_-]{10,}' supabase/schema/baseline.sql
```

Any hit on the second command means **do not commit**.

⚠️ **SP-M03 — the CLAIM used to exceed the COMMAND.** The certification above names five
classes (DSN, `\connect`, `ALTER DATABASE`, JWT, project ref); this grep matched only three
of them. A future regeneration carrying a `\connect` line or a JWT would have passed the
documented check and landed in a PUBLIC repo. The pattern now covers all five, and `-a` is
not optional — this repository contains a MEASURED NUL-bearing file, and grep reports a
NUL-bearing file as clean with exit 1. Today's `baseline.sql` is clean under the FULL set
(re-run independently 2026-08-29), so this is forward-looking, not a live exposure. If you
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
