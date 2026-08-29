# `baseline.sql` — committed full-schema snapshot

**What it is:** a byte-identical `supabase db dump` (schema only, zero data statements)
of the production catalogue. It is the schema source for the VAC-07 local-stack lane,
which cannot use `supabase db reset` because the migration chain does not replay — see
`scripts/local-stack/REPLAY-SPIKE.md` for that measurement.

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
grep -nE 'postgres(ql)?://|@[a-z0-9.-]+\.supabase\.(co|com)|[a-z]{20}\.supabase' supabase/schema/baseline.sql
```

Any hit on the second command means **do not commit**.

## What the first use of this file found

Diffing its function names against `supabase/schema/functions/` surfaced
`create_allocator_connected_strategy`: present in production, defined by **no migration in this
repo**, `SECURITY DEFINER`, `OWNER TO postgres`, and `GRANT ALL ... TO authenticated` — an
authenticated-reachable RPC that writes encrypted credential material into `api_keys`,
`strategies` and `portfolio_strategies`. Its own comment points at "migration 043", a legacy
numbered file that does not exist here. Nothing in `src/` calls it.

Neither existing gate could see it. `dump-sql-functions.ts` is hermetic, so a function absent
from the migrations is absent from its input and therefore from its diff. VAC-04 compares
committed snapshots against production bodies, and there is no snapshot to compare. Tracked as **DRIFT-04** in
`TODOS.md` (the missing gate direction is DRIFT-05); the disposition (drop it, or adopt it under a migration) is a founder call.
