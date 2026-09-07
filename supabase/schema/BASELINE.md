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
prints on every run. The provenance number above is still "true on 2026-08-29" for everything
outside function bodies.

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
