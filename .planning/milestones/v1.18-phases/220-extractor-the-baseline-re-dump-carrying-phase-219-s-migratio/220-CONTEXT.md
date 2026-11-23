# Phase 220: EXTRACTOR — the baseline re-dump carrying the 219 migration can land and main goes green - Context

**Gathered:** 2026-11-20
**Status:** Ready for planning

<domain>
## Phase Boundary

CI-only. The local-stack non-public extractor, `scripts/local-stack/nonpublic-objects.mjs`, accepts an `AFTER UPDATE OF <columns>` trigger on `auth.users`, records its columns, and compares them against the lane's catalogue so that column drift is a finding. With that fix on main, the bot re-dump PR #1294 (`automation/baseline-redump`), which carries migration `20261119120000_sync_profile_email_from_auth.sql`, can land without making every lane boot FATAL, and main's `sql-gate-lint` goes green once #1294 merges. This phase owns `TODOS.md` `[219-EXTRACTOR-UPDATE-OF]` and deletes that entry when it ships.

Out of scope: the re-dump itself (#1294 lands it after this phase), and the `sync_profile_email_from_auth` NAME_SET_RATCHET row in `scripts/dump-sql-functions.ts` (the re-dump's own concern).

Measured 2026-11-20 at the phase branch base: running `--emit` with the re-dump's carried set (`origin/automation/baseline-redump:supabase/schema/baseline-carried-migrations.txt`) exits 2 with `20261119120000_sync_profile_email_from_auth.sql statement 11: a CREATE TRIGGER shape this module does not parse (WHEN, UPDATE OF, REFERENCING and CONSTRAINT are refused)`.

</domain>

<decisions>
## Implementation Decisions

### Fix direction (from TODOS.md `[219-EXTRACTOR-UPDATE-OF]`, which the ROADMAP goal binds this phase to)
- Accept `UPDATE OF <column list>` in `CREATE_SHAPE`. The column list attaches to the `UPDATE` event inside the `OR` event list (for example `INSERT OR UPDATE OF a, b OR DELETE`).
- Record the declared columns in the fold record.
- Add the trigger's tgattr column names to the `nonpublic-catalogue.sql` trigger row, and parse them in `check()`.
- Compare the declared and lane column sets so column drift is a DRIFT finding. tgtype is 17 for both a plain `AFTER UPDATE` row trigger and `AFTER UPDATE OF email`, so the column set is the only thing that tells them apart.
- `WHEN`, `REFERENCING` and `CONSTRAINT` stay refused (MEASURE_FAIL, exit 2).
- A regex-only relaxation that folds `UPDATE OF` without comparing columns is rejected: it would silently accept column drift.

### Gate (from TODOS.md `[219-EXTRACTOR-UPDATE-OF]`)
- Red and green cases in the existing `nonpublic-objects.mjs — the auth.users trigger class (D-G)` block of `src/__tests__/local-stack-lane-wiring.test.ts`, one `it(` per arm with its own migrations directory (the block's own rule).
- Red: the catalogue's columns differ from the declared ones. Green: an exact match, and `--emit` writes the `UPDATE OF` statement's own bytes.

### Decided autonomously
- [Catalogue] Q: "How does the trigger row carry the columns?" → Selected: "a 7th `|` field, the column names comma-joined, empty for a trigger with no column list; read via `unnest(t.tgattr::int2[])` joined to `pg_attribute`" — the row format is private to this module and its test; verified on shared TEST 2026-11-20 (read-only): `on_auth_user_email_updated|17|O|public.sync_profile_email_from_auth()|email` and `on_auth_user_created|5|O|public.handle_new_user()|` (empty).
- [Parse] Q: "Is a 6-field trigger row still accepted?" → Selected: "no: a trigger row must have exactly 7 fields; a 6-field row is an unrecognised line (MEASURE_FAIL)" — otherwise a stale catalogue would read as 'no columns' and pass column drift silently.
- [Compare] Q: "Is column order significant?" → Selected: "no: both sides are normalised (declared names through `ident()`), sorted, and compared as sets" — `UPDATE OF a, b` and `UPDATE OF b, a` fire identically.
- [Compare] Q: "Which directions count as drift?" → Selected: "both: declared columns the lane lacks, lane columns not declared, and a declared plain UPDATE where the lane has columns (and the reverse)" — a one-sided check would let a trigger narrowed or widened on the lane pass.
- [Docs] Q: "What else moves with the shape?" → Selected: "the refusal message and the module header comments that list `UPDATE OF` as refused" — comments only.

### Claude's Discretion
- Exact wording of the new DRIFT finding line, following the existing `DIFFERS  auth.users trigger <name>: <field> lane=<x> declared=<y>` form.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ident()` folds identifiers the way the catalogue spells them; `tgtypeOf()` decodes tgtype bits.
- `nonpublicGate(files, carried, catalogue)` in the test file drives `--emit` and `--check` with synthetic migrations and catalogues (no Docker).

### Established Patterns
- Anything the module cannot prove safe is MEASURE_FAIL (exit 2), never folded or skipped. Findings print as `MISSING` / `EXTRA` / `DIFFERS` lines; verdict line `nonpublic-fidelity: ... verdict OK|DRIFT|MEASURE_FAIL`.
- The catalogue SQL reads everything and names no trigger or job (a test pins this).

### Integration Points
- `scripts/local-stack/run.sh` `load_nonpublic_objects` (runs `--emit`) and `check_nonpublic_fidelity` (reads `nonpublic-catalogue.sql` through the superuser DSN, runs `--check`). Every lane job boots through these: `sql-tests`, `frontend-local-stack`, `frontend-live-db-lane`, `python`, `e2e-seeded`.

</code_context>

<specifics>
## Specific Ideas

- Prove the real path once, not just the synthetic cases: on this phase's own PR the 219 migration is still replayed, not folded, so CI does not exercise the new branch until #1294 lands. Boot the lane locally on the re-dump's `baseline.sql` and carried marker with this fix applied, or at minimum run `--emit` with the re-dump's carried set and `--check` against real `psql` catalogue output.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
