# DB-types drift — recorded decision (Phase 158 / OPS-03)

**Status:** DECIDED, 2026-08-20 · **Plan:** 158-06 · **Requirement:** OPS-03
**Scope:** `src/lib/database.types.ts` (the Supabase-generated `Database` type) only.

---

## DECISION

**No DB-types regeneration gate is added to CI.** OPS-03 offers two ways to close
("a drift gate **OR** an explicitly recorded decision not to"); this is the second, taken
deliberately and with the reasons measured rather than assumed.

A regeneration gate is not merely unbuilt here — at HEAD it is **unsound**, and the honest
shapes it could take are all worse than the compensating control that already exists. The
three reasons below were each measured this session; the revisit trigger names exactly what
would have to change for the decision to flip.

This is a decision record, **not** a promise of future work. Nothing downstream is blocked
on it, and no TODOS item is opened saying "build the gate later".

---

## Reason 1 — the generated file contains HAND-PATCHED blocks that a regen silently reverts

`src/lib/database.types.ts` opens with `GENERATED FILE — do not hand-edit. Produced by
` `npx supabase gen types typescript` ` (`:2-4`). That header is not the whole truth: the file
carries hand-maintained regions that the generator cannot reproduce.

`src/lib/database.types.test.ts:28-32` (PERSIST-01) states the mechanism verbatim:

> *scenarios is a HAND-PATCHED block in database.types.ts (added by migration
> **20260621120000**; cannot be regenerated without prod DB access, and a regen linked to a
> project missing the migration silently reverts it).*

**Census of hand-patched regions measured at HEAD** (this is wider than 158-RESEARCH.md
recorded — it named only `scenarios`):

| Block | Migration | In-file tripwire comment | Type-level pins |
|---|---|---|---|
| `for_quants_leads` (`notify_attempted_at`, `notify_succeeded_at`, `notify_error`) | 115 (`20260510182439`-era) | ✅ `database.types.ts:1072-1081` | ❌ none |
| `scenarios` | `20260621120000` | ✅ `database.types.ts:2375-2382` | ✅ `database.types.test.ts:34-71` |
| `scenario_shares` | `20260622120000` | ❌ **absent** (block at `:2326`, no comment) | ✅ `database.types.test.ts:82+` |

Why this kills a naive gate: a CI job that runs `supabase gen types` against a target and
diffs has exactly two available behaviours, and **both are wrong**. It either reds forever
(the hand-patch is a permanent diff against any target missing those migrations), or — the
worse branch — it "resolves" the diff by committing the reversion, deleting the very columns
the type pins exist to protect.

**This is not hypothetical.** `database.types.ts:1080-1081` records a real occurrence:

> *2026-08-12: regenerated from PROD …, which HAS 115 — the three columns survived; only this
> comment needed re-applying.*

A regen against the *correct* target still stripped the tripwire comment; a human re-applied
it by hand. The `scenario_shares` row above is the same event with no one re-applying — its
tripwire comment is simply gone, while its siblings' survived. So the in-file comments are
themselves regen-fragile and cannot serve as a gate's ground truth.

## Reason 2 — there is no schema-authoritative, CI-reachable target to generate against

A diff gate needs a target that is *definitionally* correct. Neither candidate is:

- **PROD is schema-authoritative but not a safe CI target.** Migrations auto-apply to PROD on
  merge to main (`supabase-migrate.yml`), so PROD is the schema of record. Generating against
  it from CI means every PR run touches the production database with an access token.
- **TEST is CI-reachable but not authoritative.** TEST is caught up manually / via MCP, so it
  lags. Generating against TEST would make the gate red on the *lag*, not on drift — and,
  per Reason 1, would silently propose the hand-patch reversion whenever TEST is missing one
  of those three migrations.
- **Local replay is broken.** `P156-IN-01` records that the migration chain cannot be replayed
  from scratch locally, so there is no third, hermetic target to synthesize one from.

There is therefore no target against which "the generated types are stale" is a
decidable question in CI today.

## Reason 3 — the drift the ledger complained about does not exist

The backlog entry motivating this work described the file as roughly four months stale.
Measured at HEAD, it is not: `computation_warned` and `metrics_json_by_basis` are **present**
(`database.types.ts:2576-2656`, 6 hits), landed by the regen in commit `a6a2dee8`
(Phase 146.1, 2026-08-19 — the most recent commit to touch the file). The ledger entry
predates that regen.

Building a gate to catch a drift that had already been closed by the ordinary
regen-when-touched workflow would be paying a permanent cost for a solved problem.

**Scope note (do not conflate these two files):** `src/lib/types.ts` is a **separate,
hand-written** interface file. It still has 0 hits for both columns above. That is
outside this decision's scope — this decision governs the *generated* types only. Its
staleness, if it matters, is a different question with a different fix (it is not generated,
so no regeneration gate could ever have covered it).

---

## Compensating controls (standing, already in force)

These are what actually catch the failure mode. Neither is new work proposed by this
decision; both are existing practice this decision commits to keeping.

1. **Type-level pins in `src/lib/database.types.test.ts`.** Each pinned block asserts its
   column set and nullability through `expectTypeOf`, so *a stale regen that drops a pinned
   column or flips its nullability fails the build* (`:31-32`). This is the real gate: it
   catches the dangerous direction (silent removal) without needing a generation target.
   **The convention this decision makes explicit: when a migration adds columns that source
   code reads, extend these pins in the same change** — the C-0156 / PERSIST-01 pattern.
   C-0156 (`:4-11`) exists precisely because `positions.duration_seconds` was added in a
   migration and the generated type was never re-synced; the pin makes the next such omission
   fail loudly instead of staying invisible.
2. **Regen-when-touched.** The file is regenerated as part of the change that alters the
   schema, by the author who has the context to re-apply the hand-patched blocks and verify
   the linked project actually has the relevant migrations.

**Honest limit of this control, stated rather than hidden:** the pins catch drift-by-*omission*
on columns someone thought to pin. A brand-new column that no test pins and no code reads is
still invisible. That residual is accepted — it is a coverage gap, not a correctness hazard,
because a column nothing reads cannot break anything, and the moment code does read it, tsc
fails against the un-regenerated type.

---

## Revisit trigger

Re-open this decision when **both** hold — not before, because either alone reproduces one of
the two failure branches in Reason 1:

1. A **schema-authoritative, CI-reachable** generation target exists (e.g. local migration
   replay is repaired per `P156-IN-01`, or a dedicated always-current shadow project is
   provisioned that is not PROD), **and**
2. The hand-patched blocks are **reconciled into regenerable state** — i.e. every migration
   backing them is present in that target, so a regen reproduces them instead of reverting
   them.

If a gate is ever built anyway without (1) and (2), the only honest shape is path-triggered
(on `supabase/migrations/**`), generating against PROD via the existing `SUPABASE_ACCESS_TOKEN`
secret, with the hand-patched blocks **carved out of the diff** — and the PROD-touching risk
and per-PR cost weighed explicitly at that time.

## Residual gap surfaced while recording this (not fixed here)

`scenario_shares` (`database.types.ts:2326`) is hand-patched per its own test docblock
(`database.types.test.ts:75-81`, migration `20260622120000`) but carries **no** in-file
HAND-PATCHED tripwire comment, unlike `for_quants_leads` and `scenarios`. Its type-level pins
are intact, so the load-bearing control still holds — what is missing is the warning to the
next person who regenerates. Deliberately **not** patched in this plan: the fix edits a
generated file that is outside this plan's declared scope, and doing it silently inside a
CI-wiring commit is how such edits get lost. Tracked in `TODOS.md` under `[158-OPS-03]`.

---

## Prohibition compliance

| Prohibition (plan frontmatter) | Evidence |
|---|---|
| This phase creates no `supabase/migrations/**` file | `git diff --stat` for this plan shows zero paths under `supabase/migrations/`; the artifact you are reading is the recorded decision that replaces a gate |
| No workflow/script created for DB-types | No file added under `.github/workflows/` or `scripts/` by this plan's Task 2; verified by the plan's own acceptance gate |
| Public repo — no secrets, no usernames | This artifact names migration ids, file paths and line numbers only. Secrets are referenced by NAME (`SUPABASE_ACCESS_TOKEN`); no project ref, token or credential value is reproduced here |

---

*Phase: 158-ops-ci-a-merge-means-a-deploy · Plan: 158-06 · Recorded: 2026-08-20*
