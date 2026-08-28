# Phase 164 — deferred items (out of scope for the plan that found them)

## D-164-A — `scripts/**/*.test.ts` is invisible to vitest, so `scripts/check-gdpr-export-coverage.test.ts` never runs

**Found during:** plan 164-02, Task 1 (while adding a `strategy_shares` entry to the GDPR export manifest).

**Measured 2026-08-27:** `vitest.config.ts:22-42` defines `INCLUDE` as
`src/**/*.test.{ts,tsx}`, `tests/a11y/**`, `tests/visual/**`, `tests/lib/**`,
`tests/integration/**`, `tools/eslint-plugin-quantalyze/tests/**`. There is no
`scripts/**` glob. Passing the path explicitly confirms it:

```
$ ./node_modules/.bin/vitest run ... scripts/check-gdpr-export-coverage.test.ts
Test Files  3 passed (3)        # 4 paths given, 3 files collected
```

`scripts/check-gdpr-export-coverage.test.ts` is 20 KB of assertions that has
never executed in this repo's CI. Its sibling
`src/__tests__/gdpr-export-coverage-hook.test.ts` DOES run and shells out to the
script, so the surface is not wholly untested — but whatever the scripts-side
file asserts beyond that is unverified.

**Why not fixed here:** out of the 164-02 blast radius (plan scope is the
`strategy_shares` migration, the phase-29 guard narrowing, and the SQL gate).
Adding `scripts/**/*.test.ts` to `INCLUDE` would pull an unknown number of
never-run test files into the suite in the middle of a phase whose own gates are
deliberately red; that belongs in its own change with its own green run. Likely
home: Phase 164.1 (which already owns "gates that no longer bite") or root
`TODOS.md`.

**Remedy when picked up:** add `"scripts/**/*.test.ts"` to `INCLUDE` in
`vitest.config.ts`, run the full suite once, and triage whatever it surfaces.
Check for the same blind spot in other top-level directories.

## D-164-B — TENANT 5d/5e/5f/5g are post-rejection mutation probes behind a PL/pgSQL subtransaction, so they cannot fail

**Found during:** plan 164-02 round-3 review (2026-08-27), while removing
TRIGGER 1c and TRIGGER 2c from `supabase/tests/test_strategy_shares_rls.sql`
for this exact defect. Reported independently by `migration-reviewer` and
`silent-failure-hunter`.

**The class.** An arm that probes "did the REJECTED write still mutate the row?"
is unreachable when the rejected statement sat inside a nested
`BEGIN … EXCEPTION`. PL/pgSQL runs such a block as an implicit
**subtransaction**, so catching the error rolls back every database change the
block made. The probe downstream is reading its own rollback and reporting it as
a security property. And in the one configuration where a write *could* survive
— the guard deleted, so nothing raises — the block's own `a` arm fires first and
the probe never runs. There is no configuration in which it is the first
failure, which is the standard this file already applied when it deleted
`TENANT 5h` (see the note at the end of the TENANT 5 block) and which its header
states as "an arm that cannot fail is worse than no arm".

**The four affected arms**, all downstream of the `BEGIN … EXCEPTION` around
`PERFORM public.create_strategy_share(strat_b)` that TENANT 5b/5c assert on:

| Arm | Probes |
|---|---|
| `TENANT 5d` | tenant B's `generation` moved by A's rejected conflict-write |
| `TENANT 5e` | tenant B's `revoked_at` set by A's rejected attempt |
| `TENANT 5f` | tenant B's `created_by` rewritten by A's rejected attempt |
| `TENANT 5g` | a second share row exists for tenant B's strategy |

**Why not fixed here:** out of the round-3 blast radius, which was the
still-unapplied `20260827120000` migration plus the arms covering it. These four
are pre-existing, they are counted in the file's declared arm total and in
`ARMS_FLOOR` in `.github/workflows/ci.yml`, and removing them moves the arm count
a second time in the same phase — a churn the orchestrator is already
hand-landing once. They are *inert*, not wrong: they assert true things, they
just cannot detect the falsehood.

**Remedy when picked up.** Do NOT simply delete them and drop the count — the
property they name (a cross-tenant rejection must be TOTAL against a real victim
row) is worth asserting, it is just asserted in the wrong place. Re-express it
the way `TRIGGER 3` in this same file now does: issue the attack's follow-up
request **for real, outside the exception block**, and assert the observable end
state. Concretely, after A's rejected conflict-write, re-read B's row in a fresh
statement and — more usefully — have **B** mint again and assert the returned
generation is unchanged and the row is still live. That assertion sits downstream
of nothing that was rolled back and is the first failure when either policy wall
is loosened. If no such reformulation is found, delete the four, drop them from
the roster, and lower the declared count and `ARMS_FLOOR` in the same diff.

## D-164-C — the mutating-RPC audit detector is disarmed by a LINE WRAP, and nothing says so

**Found during:** plan 164-03, Task 1 (2026-08-28), while checking that
`create_strategy_share`'s entry in `MUTATING_RPC_NAMES` actually reaches the new
mint route.

**Measured.** `findRpcMutations`
(`src/__tests__/audit-coverage.test.ts:264-269`) tests `MUTATING_RPC_RE`
— `\.rpc\(\s*['"]<name>['"]` — against **one line at a time**. The `\s*` looks
like it spans a newline, and in a whole-file match it would; against a single
line it cannot. So a call written the way Prettier would wrap it:

```ts
const { data, error } = await shareRpc.rpc(
  "create_strategy_share",
  { p_strategy_id: id },
);
```

is INVISIBLE to the gate. MEASURED both ways on the 164-03 mint route: with the
call wrapped, deleting its `logAuditEvent` left the whole audit-coverage suite
GREEN; with the call on one line, the same deletion turned it RED. 164-03 keeps
both of its RPC calls on one line with a comment saying why, and pins the shape
in each route test — but that is a local fix for two files.

**This is the second disarming mechanism in the same detector.** The first is
already recorded in that file: casting `supabase.rpc` (rather than the client)
erases the literal entirely, which is why
`finalize_csv_strategy_with_returns`'s entry is decorative and is noted as
deferred-items #3. A third, smaller finding alongside it:
**`create_scenario_share` is not in `MUTATING_RPC_NAMES` at all**, so
`src/app/api/allocator/scenario/share/route.ts` has never been under the audit
law. That route does emit `scenario.share`, so there is no audit HOLE today —
only an unenforced one.

**Why not fixed here:** the fix belongs to the gate, not to a route, and it
would change the mutation population across the whole `src/app/api` corpus
mid-phase. 164-03's blast radius is two routes.

**Remedy when picked up.** Make the detector see the call rather than the line:
run `MUTATING_RPC_RE` against the whole file (recording the matched offset's
line) instead of per-line, and add a `\.rpc\s+as\s+unknown` /
`rpc:\s*\(` shaped detector — or, more robustly, match the RPC NAME literal
anywhere in the file and then locate its enclosing statement, which catches both
the wrap and the method-cast in one rule. Add `create_scenario_share` to
`MUTATING_RPC_NAMES` in the same change. Verify each addition the way SEC-03
prescribes: delete the corresponding `logAuditEvent` and confirm the suite goes
RED. Likely home: Phase 164.1 ("gates that no longer bite"), which already owns
D-164-A.
