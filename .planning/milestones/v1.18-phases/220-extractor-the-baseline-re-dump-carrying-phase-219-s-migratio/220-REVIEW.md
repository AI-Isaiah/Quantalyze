---
phase: 220-extractor-the-baseline-re-dump-carrying-phase-219-s-migratio
reviewed: 2026-11-20T00:00:00Z
depth: standard
diff_range: 76620528f..HEAD
files_reviewed: 3
files_reviewed_list:
  - scripts/local-stack/nonpublic-objects.mjs
  - scripts/local-stack/nonpublic-catalogue.sql
  - src/__tests__/local-stack-lane-wiring.test.ts
findings:
  critical: 0
  high: 0
  medium: 2
  low: 1
  info: 4
  total: 7
  necessity: 1
status: issues_found
---

# Phase 220: Code Review Report

**Reviewed:** 2026-11-20
**Depth:** standard (diff `76620528f..HEAD`, 3 files)
**Files Reviewed:** 3
**Status:** issues_found (LOW and INFO only; nothing at MEDIUM or above)

## Summary

The phase changes three things. The extractor now folds `UPDATE OF <columns>` on `auth.users` triggers. The catalogue SQL emits a 7th trigger field holding the tgattr column names. `--check` compares the two column lists as sorted sets, and treats a 6-field row as an unrecognised line (MEASURE_FAIL).

I looked hardest for a false OK, where real drift passes the gate silently. I found none that a real migration can reach. What I did:

- **Ran the test file at HEAD.** `npx vitest run src/__tests__/local-stack-lane-wiring.test.ts`: 73 of 73 passed.
- **Ran a real `--emit` over all 325 repo migrations.** It folds `on_auth_user_email_updated` from `20261119120000_sync_profile_email_from_auth.sql` and emits its `AFTER UPDATE OF email` bytes. This is the exact case that exited 2 at the phase base.
- **Ran the module directly on 13 edge-case inputs**, each with its own throwaway migrations directory and catalogue:
  - These fold to OK when the catalogue matches: lowercase keywords with an unquoted mixed-case column (`update of Email,phone`, folded to `email`), a block comment and a line comment inside the column list, quoted columns spelling keywords (`"x OR DELETE"`, `"INSERT"`), and `TRUNCATE OR UPDATE OF a ... FOR EACH STATEMENT` (tgtype 48).
  - These are MEASURE_FAIL: `WHEN` combined with `UPDATE OF`, `UPDATE OF` with an empty list, and a catalogue row with a trailing comma.
  - A duplicate column (`UPDATE OF a, a`) is DRIFT. PostgreSQL rejects that statement anyway.
  - `UPDATE OF a OR UPDATE OF b` folds to OK. PostgreSQL's grammar rejects it ("duplicate trigger events specified"), so no lane can carry it.
- **Read the event-list scan.** `EVENT_ITEM` runs only over `c[4]`, which `CREATE_SHAPE` has already validated. Its `IDENT` list pattern is the same greedy pattern `EVENT` uses, and the column list must be joined by commas. So a keyword inside an identifier, quoted or unquoted, is always consumed as part of the list and never read as an event.
- **Read the SQL tgattr expression.** `unnest(t.tgattr::int2[])` is valid, because `int2vector` is binary-coercible to `int2[]`. `coalesce(..., '')` keeps the row non-NULL for a trigger with no column list. The inner join to `pg_attribute` cannot lose a row: an `UPDATE OF` column carries a dependency that stops a plain `DROP COLUMN`, and `CASCADE` drops the trigger with it.

**Can each new test arm fail?** I checked each arm against the code it pins:

- **Column comparison:** remove it and the four DRIFT arms exit 0.
- **The `f.length === 7` gate:** relax it and the 6-field arm stops failing.
- **Declared-side sort:** remove it and the different-order OK arm fails.
- **Mixed-list arm:** fails if tgtype ignores `UPDATE` (15, not 31) or if a quoted column's case is lost (`email`, not `Email`).
- **Comma-column arm:** remove the comma refusal and the arm exits 0 (`a,b` matches `a,b`).

One gap: no arm pins the catalogue-side re-sort (IN-02).

Necessity rubric read from `~/.claude/gsd-core/references/necessity-review.md`.

## Medium (silent-failure-hunter, same diff range)

### SFH-01: The SQL half of the change has no pin and no unit exercise
**Status: FIXED in 18521d1b0** (test-only; module and SQL untouched).
**File:** `scripts/local-stack/nonpublic-catalogue.sql:28-31`
**Issue:** Every new unit arm feeds a hand-written catalogue row, and nothing asserts that the catalogue SQL emits the 7th field from `tgattr`. If someone replaced the subquery with `|| '|'` (always empty), `local-stack-lane-wiring.test.ts` would stay green. Until the re-dump #1294 carries `20261119120000`, no real lane boot folds an `UPDATE OF` trigger either. A declared plain `AFTER UPDATE` against a lane trigger narrowed to `UPDATE OF email` would then pass OK.
**Fix:** a wiring pin on the catalogue's 7th-field expression (`t.tgattr`, `pg_attribute`, `string_agg`, the `coalesce(..., '')` empty default), in the style of the existing catalogue pins in the D-G wiring `it(`, shown RED by a neuter.

### SFH-02: The lane-side re-sort in `parseCatalogue` has no arm that can go RED
**Status: FIXED in 18521d1b0** (test-only; module and SQL untouched).
**File:** `scripts/local-stack/nonpublic-objects.mjs` (`parseCatalogue`, the `f[6].split(",").sort().join(",")` re-sort)
**Issue:** The "different order" arm passes the lane row already sorted (`email,phone`) and the declared side unsorted, so only the declared-side sort is proven. Neutering the lane-side `.sort()` leaves every arm green. This is the same point as IN-02 below, raised to MEDIUM because the repo rule requires a data-integrity gate to be shown able to fail.
**Fix:** one arm: declared `UPDATE OF email, phone` with lane field `phone,email` expects OK, shown RED by neutering the lane-side sort.

## Low

### LR-01: Collapsing whitespace changes a quoted UPDATE OF column, so it reads as false DRIFT

**File:** `scripts/local-stack/nonpublic-objects.mjs:221` (the `stmt` normalisation), consumed at `:244-246`
**Issue:** The code builds `stmt` with `.replace(/\s+/g, " ")` over the whole statement, including the inside of double-quoted identifiers. A quoted column whose name contains a run of whitespace (`"a  b"`) folds to `a b`, while the catalogue reports `a  b`. Measured: `DIFFERS auth.users trigger t: update-of columns lane=a  b declared=a b`, exit 1. This fails loud, not silent, and no `auth.users` column has such a name. The trigger-name path already did this before the phase; the phase extends it to columns.
**Fix:** Take the column list from the original-spacing text of the same span (`L.code.slice(m.index, end)`), not from the collapsed `stmt`. Or refuse a quoted identifier that contains whitespace, the same way the comma/pipe refusal works.

## Info

### IN-01: A comma inside a lane-side column name is ambiguous in the catalogue field

**File:** `scripts/local-stack/nonpublic-catalogue.sql:29-31`, `scripts/local-stack/nonpublic-objects.mjs:491-494`
**Issue:** The declared side refuses a column name containing a comma (`:250-254`), but the catalogue side cannot tell one lane column named `a,b` from two columns `a` and `b`. Measured: declared `UPDATE OF a, b` against the lane row `a,b` gives OK. A real lane cannot reach this, because the lane's trigger is created from the same emitted bytes, so its columns are exactly `a` and `b`. It is recorded because the declared-side comment claims an unambiguity that holds on one side only.
**Fix:** Optional. Emit `quote_ident(a.attname)` in the SQL and parse the field as an IDENT list, or hex-encode the field the way the cron free-text fields are.

### IN-02: No test pins the catalogue-side re-sort

**File:** `scripts/local-stack/nonpublic-objects.mjs:493`; `src/__tests__/local-stack-lane-wiring.test.ts:779-857`
**Issue:** Every catalogue row in the new arms is already in sorted order (`email,phone`, `Email,phone`, `a,b`). Removing `.sort()` from `parseCatalogue` would leave all 73 tests green. Today the SQL sorts by `attname`, whose `name` type uses C collation, and that matches JS code-unit order for ASCII. So the re-sort is defence against a future change to the SQL, and nothing proves it works.
**Fix:** Add one OK arm whose catalogue row is out of order (for example `phone,email` against declared `email, phone`).

### IN-03: The event grammar is written twice (`EVENT` and `EVENT_ITEM`)

**File:** `scripts/local-stack/nonpublic-objects.mjs:164-166`
**Issue:** `EVENT` validates the event list and `EVENT_ITEM` re-walks it, with the keyword set and the IDENT-list shape copied by hand. If one changes without the other (a keyword added to one only), the module would validate one grammar and fold another. That could fold a column list or event set different from the one validated.
**Fix:** Build both from shared fragments: one `KW` constant and one `IDENT_LIST` constant, used by both regexes.

### IN-04: The pipe half of the comma/pipe refusal can never fire on its own (necessity)

**Category:** necessity
**File:** `scripts/local-stack/nonpublic-objects.mjs:250-254`
**Issue:** If a declared column contains `|`, the matching lane attname contains `|` too. `parseCatalogue` then splits that row into more than 7 fields and MEASURE_FAILs as an unrecognised line (`:487-499`). The verdict is already MEASURE_FAIL without the pipe test, so the pipe half only changes which message the user sees. No test covers it. Judgment call: it does give a clearer message.
**Fix:** Keep it for the message, or drop `|` from the character class. No behaviour change either way.

---

_Reviewed: 2026-11-20_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

## SFH-01 / SFH-02 fix record (commit 18521d1b0)

Both changes are in `src/__tests__/local-stack-lane-wiring.test.ts`. File: 74 tests, all green after restore (was 73).

- **SFH-01:** four pins on the live (comment-stripped) catalogue SELECT, added to the D-G wiring `it(` beside the existing catalogue pins: `unnest(t.tgattr`, the `pg_attribute` join, `string_agg(a.attname::text, ','`, and a `coalesce((SELECT string_agg(...), '')` wrapper directly before `FROM pg_trigger`.
- **SFH-02:** one arm, `OK when the lane lists its UPDATE OF columns unsorted (phone,email against declared email, phone)`, in the auth.users trigger class describe block, using `nonpublicGate`.

Neuter evidence (byte backup with `cp`, restored with `cp`, `cmp` clean both times):

SFH-02, lane-side `.sort()` removed in `parseCatalogue` (`f[6].split(",").sort().join(",")` became `f[6]`):

```
 × OK when the lane lists its UPDATE OF columns unsorted (phone,email against declared email, phone) 641ms
AssertionError: a lane column order the SQL does not sort was read as drift — the lane-side re-sort in parseCatalogue is gone:
 Tests  1 failed | 73 passed (74)
```

SFH-01, the `coalesce((SELECT string_agg ...), '')` 7th-field subquery in `nonpublic-catalogue.sql` replaced with `''`:

```
 × load_baseline() loads the non-public objects after reference data and gates them before the replay, through the superuser for the trigger and the catalogue and the loading role for cron
AssertionError: the catalogue's 7th field no longer reads the trigger's UPDATE OF columns from t.tgattr: expected 'SET search_path TO pg_catalog; -- so …' to match /\bunnest\(t\.tgattr\b/
 Tests  1 failed | 73 passed (74)
```

Each SFH-01 element also checked on its own against a text-level mutation of the live SQL: dropping the coalesce turns only the coalesce pin RED, dropping the `pg_attribute` join only the join pin, dropping `string_agg` the `string_agg` and coalesce pins, and swapping out `t.tgattr` only the `tgattr` pin.

IN-02 (the same point as SFH-02) is closed by the SFH-02 arm. LR-01 and the other Info items were not touched, per scope.

## SFH-01 round 2 fix record (commit 573457fc6)

Round 1's four textual pins stayed green against three dead-expression mutants that keep the pinned text: `... a.attnum = u.attnum WHERE false), '')`, `... AND false), '')` and `... = u.attnum + 1), '')`. The first two empty the 7th field, so a narrowed lane trigger would pass OK. Test-only fix in `src/__tests__/local-stack-lane-wiring.test.ts`:

- The join pin now ends at the subquery's close: `JOIN pg_attribute a ON a\.attrelid = t\.tgrelid AND a\.attnum = u\.attnum\), ''\)`.
- A new pin asserts the FROM clause runs straight into the join: `FROM unnest\(t\.tgattr::int2\[\]\) AS u\(attnum\)\s+JOIN pg_attribute`.
- The coalesce pin's message now says the declared trigger would then read as MISSING.

Evidence (byte backup with `cp`, restored with `cp`, `cmp` clean; file 74 passed (74) after restore). Vitest run with `WHERE false` applied to `nonpublic-catalogue.sql`:

```
 × load_baseline() loads the non-public objects after reference data and gates them before the replay, through the superuser for the trigger and the catalogue and the loading role for cron 20ms
AssertionError: the catalogue's 7th field no longer resolves tgattr numbers to column names through pg_attribute, or carries a filter after the join that can empty it: expected 'SET search_path TO pg_catalog; -- so …' to match /JOIN pg_attribute a ON a\.attrelid = …/
 Tests  1 failed | 73 passed (74)
```

Node regex check against the comment-stripped live SQL (the same text `sqlLive` holds):

```
real           from:ok join:ok
WHERE false    from:ok join:RED
AND false      from:ok join:RED
attnum + 1     from:ok join:RED
```

