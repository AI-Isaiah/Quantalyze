---
phase: 156-connect-refactor-the-venue-the-server-validated-is-the-venue
plan: 05
subsystem: wizard-connect
tags: [connect, service-role, source-scan-guard, falsifiability, release-paperwork]
requires:
  - "156-04 (both routes rewired onto createAdminClient())"
provides:
  - "CONNECT-02b — a source-scan guard that reds on any third wizard-RPC call site under src/**"
  - "CONNECT-02b — a per-file receiver-binding check proving each call site runs on the admin client"
  - "the two deliberately-out-of-scope items written into TODOS.md"
  - "PR A's version bump and an honest 'landing 1 of 2' changelog entry"
affects:
  - "src/__tests__/phase-156-wizard-rpc-writer-guard.test.ts"
  - "src/__tests__/wizard-rpcs-live-db.test.ts"
  - "TODOS.md"
  - "CHANGELOG.md"
  - "VERSION"
  - "package.json"
tech-stack:
  added: []
  patterns:
    - "source-scan sole-writer guard with a RECORDED red-under-mutation proof (analog: strategies-published-sole-writer-guard)"
    - "receiver-identifier pairing, not file-level mention matching — the file that binds BOTH clients is the sharp case"
    - "hand-typed per-file call-site count as anti-vacuity, so a blind regex reds instead of passing"
key-files:
  created:
    - "src/__tests__/phase-156-wizard-rpc-writer-guard.test.ts"
  modified:
    - "src/__tests__/wizard-rpcs-live-db.test.ts"
    - "TODOS.md"
    - "CHANGELOG.md"
    - "VERSION"
    - "package.json"
decisions:
  - "The binding regex accepts `let x: T; x = createAdminClient()` as well as `const x = createAdminClient()` — the plan prescribed const-only, which would have redded the tree, because both routes' 503 SEAM_MISCONFIGURED try/catch forces the split declaration"
  - "The Scan B mutation was run on create-with-key (which binds BOTH clients) rather than the composite twin — it is the sharper proof, since a guard keyed on 'the file mentions createAdminClient' would have stayed green"
  - "wizard-rpcs-live-db.test.ts keeps every case; the one that becomes a FALSE GREEN post-Migration-B is labelled in its own test name rather than deleted"
  - "Version bumped 0.59.0.2 -> 0.60.0.0 (feat), matching the repo's minor-bump-for-feature history (0.57.0.0, 0.58.0.0)"
metrics:
  duration: "~35 min"
  completed: 2026-08-13
  tasks: 2
  commits: 3
requirements: [CONNECT-02]
---

# Phase 156 Plan 05: The guard that makes plan 04 irreversible, and PR A's paperwork — Summary

A source-scan guard now reds a normal `npm run test` run if any third file under `src/**` calls
either wizard RPC, or if either sanctioned call site's receiver stops being bound from
`createAdminClient()` — and it was **watched to red twice** before being trusted. PR A closes out at
`0.60.0.0` with a changelog that says "landing 1 of 2" and does not claim CONNECT-01 is done.

## Commits

| Commit | Task | What |
|---|---|---|
| `69c1720a` | 1 | `phase-156-wizard-rpc-writer-guard.test.ts` — Scans A/B/C + both falsifiability proofs |
| `fc245da6` | 2 | TODOS.md's two logged-not-fixed entries; live-DB test docblock + affected cases |
| `56963811` | 2 | VERSION + package.json -> 0.60.0.0 in ONE commit, with the CHANGELOG entry |

## GREEN evidence — named tests, not an exit code

### The new guard (`npx vitest run src/__tests__/phase-156-wizard-rpc-writer-guard.test.ts --no-file-parallelism --reporter=verbose`)

`Test Files 1 passed (1)` / `Tests 10 passed (10)`. By full name, all under
`Phase 156 CONNECT-02b — wizard RPCs are service-role writers with exactly two call sites`:

1. `> the walker covers .tsx and src/lib/** (not just the two route dirs)`
2. `> anti-vacuity: src/app/api/strategies/composite/add-key/route.ts still contains its hand-typed number of wizard-RPC call sites`
3. `> anti-vacuity: src/app/api/strategies/create-with-key/route.ts still contains its hand-typed number of wizard-RPC call sites`
4. `> no unsanctioned file under src/** calls a wizard RPC`
5. `> Scan B — src/app/api/strategies/composite/add-key/route.ts > imports createAdminClient from @/lib/supabase/admin`
6. `> Scan B — src/app/api/strategies/composite/add-key/route.ts > every wizard-RPC receiver is resolvable (no member-expression receivers)`
7. `> Scan B — src/app/api/strategies/composite/add-key/route.ts > every wizard-RPC receiver is bound from createAdminClient(), not createClient()`
8. `> Scan B — src/app/api/strategies/create-with-key/route.ts > imports createAdminClient from @/lib/supabase/admin`
9. `> Scan B — src/app/api/strategies/create-with-key/route.ts > every wizard-RPC receiver is resolvable (no member-expression receivers)`
10. `> Scan B — src/app/api/strategies/create-with-key/route.ts > every wizard-RPC receiver is bound from createAdminClient(), not createClient()`

### Plan-04 route baseline — NOT regressed

`npx vitest run src/app/api/strategies/create-with-key/ src/app/api/strategies/composite/add-key/ --no-file-parallelism`
→ **`Test Files 3 passed (3)` / `Tests 203 passed (203)`**, identical to the pre-plan baseline of
3 files / 203 tests measured on `a2a247f6`.

### `critical-regressions.test.ts` (the VERSION/package.json drift gate, CRITICAL-02)

`Test Files 1 passed (1)` / `Tests 128 passed (128)`, including
`[CRITICAL-02] VERSION / package.json drift > VERSION file must equal package.json version`.

### `wizard-rpcs-live-db.test.ts` — proof it is NOT a gate

`Test Files 1 passed (1)` / `Tests 1 passed | 7 skipped (8)`. The single non-skipped case is
`live-db skip reason > advertises skip reason when live DB is unavailable`. **All 7 substantive
cases skipped** — which is exactly the claim now written into its docblock: this file has never run
in CI and may not be counted toward any success criterion.

### Full suite / typecheck / lint

| Gate | Result |
|---|---|
| `npx vitest run` (full) | **`Test Files 781 passed \| 19 skipped (800)`**, **`Tests 11816 passed \| 287 skipped (12103)`**, 170.22s — zero failures |
| `npx tsc --noEmit` | exit 0, no output |
| `npm run lint` | `0 errors, 2 warnings` — both pre-existing and in files this plan never touched (`ContributionWizardOverlay.tsx:91`, `EquityChart.tsx:1119`); both manifest checks OK |
| `git diff --name-only a2a247f6..HEAD -- supabase/ src/lib/database.types.ts` | **empty** |

## The falsifiability proof — recorded, because a guard nobody watched fail cannot fail

Both mutations were actually run against the post-plan-04 tree. The verbatim failure messages are
pasted into the guard's own docblock (`:54-111`), which is where the next reader will look.

### Mutation 1 → Scan A (a third writer)

Added a throwaway NON-test file `src/lib/wizard/__falsify_probe.ts` holding
`await supabase.rpc("create_wizard_strategy", { p_user_id: userId })` with
`const supabase = await createClient();` — deliberately placed in `src/lib/**` rather than a route
directory, since that is the Phase 142.1 finding-4 hole this scan exists to close.

Result: `Tests 1 failed | 9 passed (10)` —

```
AssertionError: Unsanctioned wizard-RPC call site(s): src/lib/wizard/__falsify_probe.ts.
`create_wizard_strategy` / `add_wizard_composite_key` are service-role writers as of Phase 156 —
they may be called ONLY from src/app/api/strategies/composite/add-key/route.ts,
src/app/api/strategies/create-with-key/route.ts, through a createAdminClient() client. A new call
site re-opens CONNECT-02.: expected [ 'src/lib/wizard/__falsify_probe.ts' ] to deeply equal []
```

`rm src/lib/wizard/__falsify_probe.ts` → back to `10 passed (10)`; `git status --porcelain` showed
only the untracked guard file, no leftover probe.

### Mutation 2 → Scan B (a user-scoped receiver)

In `src/app/api/strategies/create-with-key/route.ts:820` the receiver was re-pointed from
`rpcAdmin.rpc("create_wizard_strategy"` to `supabase.rpc("create_wizard_strategy"` — `supabase`
being that file's **existing** `const supabase = await createClient();` binding at `:540`. This is
the sharp case on purpose: the file still imports `createAdminClient` and still binds it as
`rpcAdmin`, so a guard keyed on "does this file mention createAdminClient" would have stayed green.

Result: `Tests 1 failed | 9 passed (10)` —

```
AssertionError: src/app/api/strategies/create-with-key/route.ts calls a wizard RPC on `supabase`,
which is NOT bound from createAdminClient() in this file. The wizard RPCs are service-role writers
(Phase 156 / CONNECT-02); a user-scoped receiver puts the write back on the caller's JWT.:
expected false to be true // Object.is equality
```

`git checkout -- src/app/api/strategies/create-with-key/route.ts` → back to `10 passed (10)`,
working tree clean.

## What the guard can and cannot see — stated, not implied

It resolves **lexical bindings**, not runtime. It cannot follow a client passed as a function
parameter, stored on an object, or returned from a factory. Rather than let those pass silently,
each is turned into an explicit failure:

- a member-expression receiver (`ctx.db.rpc(…)`) FAILS as "unresolvable receiver";
- a call whose receiver the regex cannot capture at all (`(await createClient()).rpc(…)`) makes the
  per-file receiver count diverge from the per-file call-site count, which FAILS;
- the anti-vacuity test pins a **hand-typed 1 call site per allowlisted file**, so a regex that
  quietly stops matching reds instead of turning Scan A green forever — the SKIP-trap lesson.

A named successor obligation is written into the docblock: if either route is restructured so the
RPC moves into a helper, the allowlist must be widened **and the mutations re-run** in the same
change.

## Acceptance criteria — item by item

| Criterion | Status |
|---|---|
| Guard passes against the post-plan-04 tree | ✅ 10/10 |
| Docblock contains TWO pasted failing messages, each from an actually-run mutation | ✅ `:54-111` |
| Scan C's hand-typed per-file expected count present | ✅ `ALLOWED_WRITERS` maps each path to `1` |
| Walker includes `.tsx` and `src/lib/**` | ✅ asserted by test 1, not merely coded |
| `git status --porcelain` shows no leftover probe | ✅ empty |
| `npx tsc --noEmit` clean; `npm run lint` no new errors | ✅ |
| TODOS.md gains exactly two entries, each naming a file:line + why not fixed here | ✅ `TODOS.md:2280-2307` |
| `src/__tests__/audit-coverage.test.ts` unmodified | ✅ absent from `git diff --name-only a2a247f6..HEAD` |
| `finalize-wizard/route.ts:1275-1285` unmodified | ✅ same |
| Live-DB docblock states it never runs in CI and names the follow-up migration | ✅ names `supabase/migrations/20260814120000_wizard_rpcs_revoke_authenticated.sql` |
| `cat VERSION` equals `package.json` version, both changed in ONE commit | ✅ `0.60.0.0`, commit `56963811` |
| CHANGELOG states "landing 1 of 2" and does NOT claim `authenticated` EXECUTE withdrawn | ✅ "**This is landing 1 of 2 … It does not close it**" and "`authenticated` still holds EXECUTE on both, deliberately" |
| `critical-regressions.test.ts` passes | ✅ 128/128 |

## Deviations from Plan

**1. [Rule 3 — blocking] The prescribed `const <ident> = createAdminClient(` binding regex would have redded the tree.**

- **Found during:** Task 1, reading the two routes before writing the scan.
- **Issue:** The plan specified "require a `const <that identifier> = createAdminClient(` binding in
  the same file". Neither route uses that form. Both declare and assign separately —
  `let rpcAdmin: ReturnType<typeof createAdminClient>;` then `rpcAdmin = createAdminClient();`
  inside a `try` — because plan 04's fail-closed 503 `SEAM_MISCONFIGURED` arm needs the binding to
  outlive the `catch`. A `const`-only regex would have reported both sanctioned routes as
  unbound: a guard that fails on the correct tree.
- **Fix:** `bindsIdentFrom()` matches an **assignment** of the identifier from the factory —
  covering `const`/`let`/`var` declarations-with-init, bare re-assignment, and `await`-ed factories
  — anchored by `(?:^|[^.\w$])` so `other.rpcAdmin = …` does not count. The intent the plan
  specified (receiver-keyed, not file-keyed) is unchanged and is what Mutation 2 proves.
- **Files modified:** `src/__tests__/phase-156-wizard-rpc-writer-guard.test.ts`
- **Commit:** `69c1720a`

**2. [Scope, deliberate] Mutation 2 was run on `create-with-key`, not the composite twin.**

- **Plan text:** "temporarily re-point **one route's** `.rpc` receiver to a `createClient()`
  binding" — either route satisfies it.
- **Choice:** `create-with-key`, because it is the file that legitimately binds **both** clients.
  Mutating the composite twin would have required first *adding* a `createClient` import, making the
  probe less like a realistic regression and, more importantly, failing to demonstrate the one thing
  the pairing heuristic exists for. The chosen mutation proves the guard reds even when the file
  still imports and binds the admin client.

**3. [Orchestrator fence] Version bumped from 0.59.0.2, and no `.planning/` state files were touched.**

- The plan's `read_first` says VERSION is "currently `0.59.0.0`". It was `0.59.0.2` at dispatch
  (the branch was rebased onto `origin/main`, which carried the MT5DEAL-01 hotfixes). Bumped
  `0.59.0.2 -> 0.60.0.0`.
- ⚠️ Per the dispatching orchestrator's explicit fence, the GSD state-update step of
  `execute-plan.md` was **NOT** run: `STATE.md`, `ROADMAP.md` and `REQUIREMENTS.md` are unmodified
  and no `state.advance-plan` / `roadmap.update-plan-progress` / `requirements.mark-complete` was
  issued. The orchestrator owns those. `CONNECT-02` is therefore **not** yet checked off in
  `REQUIREMENTS.md` by this plan.
- No git worktree was created; all work is on `feat/phase-156-connect-refactor` in the main
  checkout. Nothing was pushed and no PR was opened.

## Known Stubs

None. The guard is fully wired: it walks the real tree, reads the real route sources, and its
assertions were each observed to fail under mutation.

## Threat Flags

None. This plan adds no network endpoint, auth path, file-access pattern, or schema change; it adds
one test file and edits release paperwork. The threat register's four mitigations for this plan
(T-156-22 second call site, T-156-23 regex drift, T-156-24 leftover probe, T-156-25 overclaiming
changelog) are each realised and evidenced above.

## Self-Check: PASSED

Files claimed created/modified, verified present on disk:

- `FOUND: src/__tests__/phase-156-wizard-rpc-writer-guard.test.ts` (325 lines, min_lines 80 ✅)
- `FOUND: src/__tests__/wizard-rpcs-live-db.test.ts`
- `FOUND: TODOS.md`, `FOUND: CHANGELOG.md`, `FOUND: VERSION`, `FOUND: package.json`

Commits claimed, verified in `git log`:

- `FOUND: 69c1720a` test(156-05): guard the wizard RPCs' two service-role call sites
- `FOUND: fc245da6` docs(156-05): log the two items Phase 156 deliberately does not fix
- `FOUND: 56963811` chore(156-05): v0.60.0.0 — PR A close-out, landing 1 of 2

Scope fences, verified:

- `git diff --name-only a2a247f6..HEAD -- supabase/ src/lib/database.types.ts` → **empty**
- `git diff --name-only a2a247f6..HEAD` → exactly the six files in the plan's `files_modified`
