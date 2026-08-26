---
phase: 156-connect-refactor-the-venue-the-server-validated-is-the-venue
plan: 02
subsystem: testing
tags: [vitest, supabase, service-role, rls, wizard, connect-a-key, tdd-red]

# Dependency graph
requires:
  - phase: 156-01
    provides: "A1/A2 measured — auth.role()='service_role' and auth.uid() IS NULL under a service-key client, which is why the ownership binding must live at the route and why these route tests are load-bearing"
provides:
  - "The post-156 contract of both wizard writes, as executable assertions that were OBSERVED failing against the unchanged routes"
  - "A client-attribution harness (rpcCallSites / userScopedRpc / adminRpc) that can tell a rewired route from an unchanged one — rpcMock alone cannot"
  - "The @/lib/supabase/admin mock the composite twin has never had (G11), landed BEFORE plan 04 can red the whole file for the wrong reason"
  - "The inverted expectation at create-with-key/route.test.ts — the docblock sentence Phase 156 falsifies is scoped to the fence and contradicted for the RPC"
affects: ["156-04", "156-05", "156-09", "156-10"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Client-attribution recording: each `.rpc` double stamps its own client name into a shared array before delegating to the verdict mock, so WHICH client reached the RPC is assertable"
    - "Armed-fatal wrong-door double: the throw is switched on by the one case whose subject it is, so the RED window does not drown the signal it exists to produce"

key-files:
  created: []
  modified:
    - src/app/api/strategies/create-with-key/route.test.ts
    - src/app/api/strategies/composite/add-key/route.test.ts

key-decisions:
  - "The user-scoped `rpc` double DELEGATES by default and throws only when armed by the case under test — an unconditional throw would have reddened ~40 pre-existing single-key cases and every composite case for the width of the RED window, which is G11's failure mode pointed the other way and is incompatible with Task 2's 'pre-existing composite cases still pass' acceptance"
  - "Each of the five cases asserts the CLIENT first and its own claim behind it, because the route already passes p_user_id=user.id and the normalised exchange — those claims are true today and cannot red on their own account, so the client assertion is the only honest source of RED for them"
  - "The pre-existing case 'a MISSING service-role credential degrades to a dark fence, never to a failed submit' was INVERTED in place to 503/SEAM_MISCONFIGURED rather than preserved — its subject is the missing credential, not the fence, and after 156 there is no client left to submit with"
  - "The supabase mocks are NOT importActual-extended, unlike @/lib/ratelimit — createAdminClient is the module's only export and its whole body opens a live service-role connection from two env vars; there is no pure helper to preserve"

patterns-established:
  - "Twin-pairing under test: the composite gets both halves of the CONNECT-02 binding (three-way identity AND the literal anchor), not the weaker oracle"
  - "Every new case name carries the literal token `156` so intended failures are grepped by NAME, never inferred from an exit code"

requirements-completed: [CONNECT-02, CONNECT-03]

# Metrics
duration: 24min
completed: 2026-08-13
---

# Phase 156 Plan 02: RED-first route contracts for the service-role writer — Summary

**Both wizard route test files re-cut to the post-156 service-role-writer contract and observed failing against the unchanged routes — 6 named reds in the single-key twin, 5 in the composite, every one grepped out of the failure list by test name rather than read from an exit code.**

## Performance

- **Duration:** ~24 min
- **Started:** 2026-08-13T16:00:30Z
- **Completed:** 2026-08-13T16:24:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- The single-key route's post-156 contract exists as failing tests, and the two outcomes that would otherwise ship silently — a surviving user-scoped fallback and a body-supplied uid — are each independently detectable.
- The composite twin now has the `@/lib/supabase/admin` mock it has never had, landed in the same wave as the assertions rather than in the same commit as the route change, so plan 04 cannot red the whole file for a reason none of its cases assert.
- All 74 pre-existing composite cases still pass, for their original reasons — measured against the pre-change run, not asserted.
- Verified under **Node 22** (CI's version, local is Node 25): the identical 11-red / 182-green split, so nothing here is a Node-version artefact.

## Task Commits

1. **Task 1: Re-cut the single-key route test to the service-role-writer contract** — `12df73cd` (test)
2. **Task 2: Give the composite twin the admin mock it has never had, and the same three contracts** — `c0e71e5c` (test)

**Plan metadata:** see the final commit on `feat/phase-156-connect-refactor`.

## Files Created/Modified

- `src/app/api/strategies/create-with-key/route.test.ts` — client-attribution harness; `rpc` added to the admin mock's returned object; the server mock's `rpc` re-labelled as the wrong door; the `:215-238` docblock re-cut; the missing-service-key fence case inverted in place; five new `156` cases.
- `src/app/api/strategies/composite/add-key/route.test.ts` — the same harness ported verbatim in shape; the file's first-ever `@/lib/supabase/admin` mock; the server mock's "calls ONLY supabase.rpc" claim moved to the admin client; the same five `156` cases against `add_wizard_composite_key` / `p_wizard_session_id`.

⛔ No route file, no migration, no SQL gate, and nothing under `supabase/` was touched. `git diff --name-only` showed exactly one test file before each of the two commits.

## RED evidence

### Baseline, measured on the untouched tree

```
$ npx vitest run src/app/api/strategies/create-with-key/route.test.ts --no-file-parallelism
      Tests  109 passed (109)

$ npx vitest run src/app/api/strategies/composite/add-key/route.test.ts --no-file-parallelism
      Tests  74 passed (74)
```

### Task 1 — `create-with-key/route.test.ts`

```
$ npx vitest run src/app/api/strategies/create-with-key/route.test.ts --no-file-parallelism
      Tests  6 failed | 108 passed (114)
```

108 = 109 baseline − the one pre-existing case whose expectation Phase 156 inverts. The six failing
**names**, grepped out of the run rather than inferred:

```
FAIL … > [154-06 / WIZCONT-02] create-with-key — the venue-identity fence > [156 / CONNECT-03] a MISSING service-role credential fails CLOSED on the MT5 path too — 503, nothing submitted
FAIL … > [156 / CONNECT-02 + CONNECT-03] create-with-key — the service-role writer contract > 156 — create_wizard_strategy is reached through the ADMIN (service-role) client
FAIL … > [156 / CONNECT-02 + CONNECT-03] create-with-key — the service-role writer contract > 156 — the USER-SCOPED client is never the one that reaches it (armed, not inferred)
FAIL … > [156 / CONNECT-02 + CONNECT-03] create-with-key — the service-role writer contract > 156 — the venue WRITTEN is the venue VALIDATED: three-way identity, anchored on the literal "binance"
FAIL … > [156 / CONNECT-02 + CONNECT-03] create-with-key — the service-role writer contract > 156 — p_user_id is withAuth's user.id, and NO request-body field can reach it
FAIL … > [156 / CONNECT-02 + CONNECT-03] create-with-key — the service-role writer contract > 156 — a MISSING SUPABASE_SERVICE_ROLE_KEY answers 503 SEAM_MISCONFIGURED and submits NOTHING
```

Failure bodies, verbatim:

```
[1] 156 — create_wizard_strategy is reached through the ADMIN (service-role) client
AssertionError: CONNECT-02: after Phase 156 `authenticated` holds no EXECUTE on create_wizard_strategy,
so the ONLY client that can perform this write is createAdminClient(). Recorded call sites::
expected [ 'user-scoped' ] to deeply equal [ 'admin' ]
  [
-   "admin",
+   "user-scoped",
  ]
 ❯ src/app/api/strategies/create-with-key/route.test.ts:2228:7

[2] 156 — the USER-SCOPED client is never the one that reaches it (armed, not inferred)
AssertionError: CONNECT-02: the user-scoped supabase client must never carry this write. Every entry
below is a call that went through the wrong door.: expected [ 'user-scoped' ] to deeply equal []
- []
+ [
+   "user-scoped",
+ ]
 ❯ src/app/api/strategies/create-with-key/route.test.ts:2249:7

[3] 156 — the venue WRITTEN is the venue VALIDATED: three-way identity, anchored on the literal "binance"
AssertionError: CONNECT-02: the venue coupling is only a guarantee if the writer is the service-role
client — a user-scoped call carries the same three values and proves nothing about the door they went
through.: expected [ 'user-scoped' ] to deeply equal [ 'admin' ]
 ❯ src/app/api/strategies/create-with-key/route.test.ts:2264:7

[4] 156 — p_user_id is withAuth's user.id, and NO request-body field can reach it
AssertionError: CONNECT-03b: the ownership binding is only meaningful on the writer that actually
holds EXECUTE.: expected [ 'user-scoped' ] to deeply equal [ 'admin' ]
 ❯ src/app/api/strategies/create-with-key/route.test.ts:2317:7

[5] 156 — a MISSING SUPABASE_SERVICE_ROLE_KEY answers 503 SEAM_MISCONFIGURED and submits NOTHING
AssertionError: expected 200 to be 503 // Object.is equality
- 503
+ 200
 ❯ src/app/api/strategies/create-with-key/route.test.ts:2353:24

[6] [156 / CONNECT-03] a MISSING service-role credential fails CLOSED on the MT5 path too — 503, nothing submitted
AssertionError: expected 200 to be 503 // Object.is equality
- 503
+ 200
 ❯ src/app/api/strategies/create-with-key/route.test.ts:1555:24
```

### Task 2 — `composite/add-key/route.test.ts`

```
$ npx vitest run src/app/api/strategies/composite/add-key/route.test.ts --no-file-parallelism
      Tests  5 failed | 74 passed (79)
```

⭐ **74 passed against a 74-pass baseline** — every pre-existing composite case still passes, for its
original reason. The five failing **names**:

```
FAIL … > [156 / CONNECT-02 + CONNECT-03] composite/add-key — the service-role writer contract > 156 — add_wizard_composite_key is reached through the ADMIN (service-role) client
FAIL … > [156 / CONNECT-02 + CONNECT-03] composite/add-key — the service-role writer contract > 156 — the USER-SCOPED client is never the one that reaches it (armed, not inferred)
FAIL … > [156 / CONNECT-02 + CONNECT-03] composite/add-key — the service-role writer contract > 156 — the venue WRITTEN is the venue VALIDATED: three-way identity, anchored on the literal "binance"
FAIL … > [156 / CONNECT-02 + CONNECT-03] composite/add-key — the service-role writer contract > 156 — p_user_id is withAuth's user.id, and NO request-body field can reach it
FAIL … > [156 / CONNECT-02 + CONNECT-03] composite/add-key — the service-role writer contract > 156 — a MISSING SUPABASE_SERVICE_ROLE_KEY answers 503 SEAM_MISCONFIGURED and submits NOTHING
```

Failure bodies, verbatim:

```
[1] 156 — add_wizard_composite_key is reached through the ADMIN (service-role) client
AssertionError: CONNECT-02: after Phase 156 `authenticated` holds no EXECUTE on
add_wizard_composite_key, so the ONLY client that can perform this write is createAdminClient().
Recorded call sites:: expected [ 'user-scoped' ] to deeply equal [ 'admin' ]
 ❯ src/app/api/strategies/composite/add-key/route.test.ts:1575:7

[2] 156 — the USER-SCOPED client is never the one that reaches it (armed, not inferred)
AssertionError: CONNECT-02: the user-scoped supabase client must never carry this write. Every entry
below is a call that went through the wrong door.: expected [ 'user-scoped' ] to deeply equal []
 ❯ src/app/api/strategies/composite/add-key/route.test.ts:1597:7

[3] 156 — the venue WRITTEN is the venue VALIDATED: three-way identity, anchored on the literal "binance"
AssertionError: CONNECT-02: the venue coupling is only a guarantee if the writer is the service-role
client … : expected [ 'user-scoped' ] to deeply equal [ 'admin' ]
 ❯ src/app/api/strategies/composite/add-key/route.test.ts:1612:7

[4] 156 — p_user_id is withAuth's user.id, and NO request-body field can reach it
AssertionError: CONNECT-03b: the ownership binding is only meaningful on the writer that actually
holds EXECUTE.: expected [ 'user-scoped' ] to deeply equal [ 'admin' ]
 ❯ src/app/api/strategies/composite/add-key/route.test.ts:1670:7

[5] 156 — a MISSING SUPABASE_SERVICE_ROLE_KEY answers 503 SEAM_MISCONFIGURED and submits NOTHING
AssertionError: expected 200 to be 503 // Object.is equality
- 503
+ 200
 ❯ src/app/api/strategies/composite/add-key/route.test.ts:1705:24
```

### ⚠️ There is no GREEN evidence in this plan, and there must not be

This plan lands RED **on purpose**. The route belongs to plan 04; making anything here green would
require exactly the change plan 02 exists to precede, and a green run would prove only that the test
was written after the route it describes. CI on the phase branch is expected to fail between this
wave and wave 3. The green counterpart of every red pasted above is plan 04's acceptance.

**Nothing was skipped.** No `it.skip`, no `it.todo`, no `skipIf` was added or encountered in either
file; the totals below account for every case.

| File | Baseline | After | Failed | Passed | Skipped |
|---|---|---|---|---|---|
| `create-with-key/route.test.ts` | 109 passed | 114 total | 6 | 108 | 0 |
| `composite/add-key/route.test.ts` | 74 passed | 79 total | 5 | 74 | 0 |

### Environment honesty

⛔ Executed in the **main checkout** at `<repo-root>` on
`feat/phase-156-connect-refactor` — **no worktree was created**, so `node_modules` is real and a
non-zero exit means a failing assertion rather than `MODULE_NOT_FOUND`. Confirmed by the baseline
runs, which exited **0 with 183 passing tests** before any edit: a broken environment cannot produce
that. Every red above is additionally identified by test **name** and by assertion **message**, not
by exit code.

CI-parity check under Node 22 (`/opt/homebrew/opt/node@22/bin`, `v22.22.1`; local is Node 25):

```
 Test Files  2 failed (2)
      Tests  11 failed | 182 passed (193)
```

Identical split — the reds are the contract, not a Node-version artefact.

### Other gates

- `npx tsc --noEmit` → **exit 0**. A red test is expected here; a type error is not.
- `npm run lint` → **0 errors**, 2 warnings, both pre-existing and in files this plan never opened
  (`ContributionWizardOverlay.tsx:91`, `EquityChart.tsx:1119`).

## Decisions Made

**1. The wrong-door double delegates by default and throws only when armed.**
The plan asks for a `rpc` on the `@/lib/supabase/server` mock that "throws a distinctive error naming
the wrong client if it is ever called." Implemented literally — unconditionally — that throw reds
~40 pre-existing single-key cases and **every** composite case for the width of the RED window,
because both routes call the user-scoped client *today*. That is G11's own failure mode pointed the
other way: noise that hides the signal the window exists to produce. It is also directly incompatible
with Task 2's acceptance criterion that pre-existing composite cases still pass against the
pre-change count. Resolution: `rpcCallSites` **always** records which client dialled the RPC (so the
discrimination never depends on the throw), and `userScopedRpcIsFatal` arms the throw inside the one
case whose subject it is. Both twins use the identical shape.

**2. Each case asserts the client first, its own claim second.**
`p_user_id: user.id` and `p_exchange: exchangeNormalized` are **already correct** in both routes —
the plan says so ("no new plumbing is needed for the identity — only a new assertion"). Those claims
therefore cannot red on their own account, and a case written without the client precondition would
have landed GREEN in a plan whose acceptance requires every named case to fail. The client assertion
carries a named message so the red says why. In the green window all assertions run, and the ledger's
SC2 Mutation C (corrupt `exchangeNormalized` before all three consumers) reds the literal anchor
while the identity assertion stays green — which is the whole reason both halves exist.

**3. The `binance` body, not `okx`, for the fail-closed case.**
`binance` has no venue-identity fence (`venueAccountId` is non-null only for mt5), so the *only*
thing the service key is needed for on that path is the **write**. A 200 there means a user-scoped
fallback survived somewhere, with no fence to blame it on. The MT5 case is kept as its twin, so the
pair also proves the fail-closed arm is not venue-specific.

## Deviations from Plan

### 1. [Documented interpretation] The pre-existing missing-service-key case was INVERTED, not preserved

- **Found during:** Task 1
- **Issue:** The plan's behaviour block says "The existing venue-identity-fence cases that rely on
  `adminClientThrows` keeping the fence dark are preserved as-is where they still describe the fence."
  One such case — `"a MISSING service-role credential degrades to a dark fence, never to a failed
  submit"` (`route.test.ts:1463`) — asserted **200 + one RPC call** under `adminClientThrows.value =
  true`. That is the *same input* as the plan's new fail-closed case with the *opposite* expected
  outcome; both cannot stand.
- **Resolution:** Inverted in place to `503` / `SEAM_MISCONFIGURED` / `rpcMock` not called, renamed
  with the `156` token, and annotated with why. Its subject was never the fence — it was the missing
  credential, and after 156 a missing credential means there is no client left to submit with. The
  fence's own dark degradation **is** still tested, by the read-fault cases above it, which reach the
  fence with a healthy admin client and a failing SELECT. That is the qualifier "where they still
  describe the fence" doing its work.
- **Verification:** the case is red for the named reason (`expected 200 to be 503`), pasted above.
- **Committed in:** `12df73cd`

### 2. [Rule 7 — conflicting conventions, pick one and say why] The supabase mocks are not `importActual`-extended

- **Found during:** Task 1, carried into Task 2
- **Issue:** The plan's action says "Mock-hygiene convention: extend via `importActual` rather than
  replacing, matching `composite/add-key/route.test.ts:87-98`, so a mock cannot drift from real
  behaviour." That convention is right for `@/lib/ratelimit`, which exports **pure helpers**
  (`rateLimitDenyJson`, `isRateLimitMisconfigured`) whose real behaviour the mock must not
  re-implement — and both files keep using it there, untouched.
- **Resolution:** Not applied to `@/lib/supabase/admin` or `@/lib/supabase/server`. `createAdminClient`
  is the module's only export and its entire body reads two env vars and opens a live service-role
  connection; there is no pure helper to preserve, and `importActual` would either throw on the
  missing env or open a real client against a real Supabase project from a unit test. The reasoning
  is written into both docblocks so the next reader does not "restore" the convention.
- **Files modified:** both test files (comment only)
- **Committed in:** `12df73cd`, `c0e71e5c`

### 3. [Bookkeeping] Two line references in the plan have drifted

- `EXPECTED_TABLE_SIZE` is pinned at `wizardErrors.test.ts:1531` and `:1845`, not `:1486` and `:1750`
  as the plan states. **Both pins verified unchanged** (`= 76`, and `git diff` shows no change under
  `src/lib/` at all), so the constraint the plan expresses holds; only its coordinates are stale.
- The docblock the plan cites as `route.test.ts:215-238` and the case at `:1463` are at their stated
  positions in the pre-change file; they moved after this plan's own insertions, as expected.

---

**Total deviations:** 3 (1 documented interpretation of a contradictory instruction, 1 Rule-7
convention call, 1 bookkeeping note).
**Impact on plan:** No scope creep. No route file, no SQL, no wizard-code-union member, no package
installed. The plan's intent — a contract observed failing before the route exists — is delivered
exactly.

## ⚠️ On `requirements-completed`, stated rather than assumed

The frontmatter carries `requirements-completed: [CONNECT-02, CONNECT-03]` because those are the IDs
on this plan's `requirements` field. ⛔ **They were deliberately NOT checked off in
`REQUIREMENTS.md`** (`:936`, `:952`, and the traceability rows at `:1378-1379` are left `Pending`).
Nothing in this plan makes either requirement true: CONNECT-02 becomes true when plan 04 puts the
write behind the service-role client, and CONNECT-03 is not closed until PR B. Checking them off on
the strength of a suite that is currently **red** would be precisely the overstatement
`156-VALIDATION.md` exists to prevent. Plans 04 and 10 own those boxes.

## Ledger side-effects worth knowing about

`gsd-sdk query roadmap.update-plan-progress 156` and `state.record-session` each damaged prose they
were not asked to touch, and both were repaired in the same turn:

- **ROADMAP.md** — the helper replaced the sentence *"10 plans in 8 waves, shipping as TWO PRs
  (`156-RESEARCH.md` "Deploy order": both …"* with *"2/10 plans executed"*, leaving the rest of the
  sentence dangling and destroying the two-PR deploy-order rationale. Restored, with the progress
  count prefixed instead of substituted.
- **STATE.md** — `record-session` ignored the arguments passed to it and instead re-derived the
  frontmatter from the file body, REGRESSING `stopped_at` ("Phase 154 COMPLETE (8/8 plans,
  verified)" → "Phase 154 UI-SPEC approved"), regressing `last_activity` to 2026-08-11, and blanking
  the resume pointer to `None`. All three restored to true values.
- `state.advance-plan` and `state.update-progress` were **not** run: STATE.md's Current Position
  still read `Phase 153.6 … Plan 1 of 6` (153.6 shipped on `main` as PR #675 / `54a0d26d`), so
  advancing it would have incremented a stale counter for the wrong phase. The block was corrected
  to Phase 156 by hand, with the correction annotated in place.
- Two `state.add-decision` entries landed labelled `[Phase ?]`; relabelled `[Phase 156]`.

## Issues Encountered

**The five cases cannot all red for five distinct reasons, and pretending otherwise would be the
defect this plan exists to prevent.** Two of the five (CONNECT-02's argument identity and
CONNECT-03b's `p_user_id`) describe behaviour the routes **already** exhibit correctly, so their RED
necessarily comes from the client-routing precondition rather than from their own claim. This is
stated in the file's own prose, in the assertion messages, and here — rather than manufactured away
by weakening the cases. The claims become independently falsifiable in the green window, where the
ledger's SC2 Mutation C and `156-09` Task 2's Mutation C are the oracles that exercise them.

**A Vercel plugin hook repeatedly flagged "long-running or polling logic detected in a serverless
handler" against these test files.** False positive — these are vitest unit tests, not route
handlers, and the flagged lines are pre-existing test content. Not acted on. (The hook also asked for
a `Skill(next-cache-components)` load; no `Skill` tool exists in this agent's toolset, and nothing in
this plan touches caching directives or page components.)

## User Setup Required

None — no external service configuration required. ⛔ No database was touched: no migration, no
`supabase db push`, nothing created or edited under `supabase/`. Those belong to plan 03.

## Next Phase Readiness

- **Plan 03 (migration A)** is unblocked and independent of this work.
- **Plan 04 (the routes)** now has its acceptance written down: making these 11 named cases green,
  without weakening any of them, IS the definition of done. A plan-04 delivery that fixes only
  `create-with-key` will leave five named composite reds standing — which is the instance-not-class
  failure this phase was convened to end, now mechanically detectable.
- **Plan 05** inherits an oracle it can lean on: `156-VALIDATION.md` SC2 Mutation A ("re-point the
  `.rpc` receiver at the user-scoped binding") now reds a *runtime* case in both twins, independently
  of Scan B's source-text heuristic.
- **Plan 09** should point `test_wizard_composite_fence.sql` Part 3b's replacement prose at the case
  named `156 — p_user_id is withAuth's user.id, and NO request-body field can reach it`, in **both**
  files. That is the pointer Finding B requires, and it is live rather than decorative.

⚠️ **CI on `feat/phase-156-connect-refactor` is RED from here until plan 04 lands, by design.** Do
not "fix" it by changing a route in this wave.

## Self-Check: PASSED

- Both modified files exist on disk; this SUMMARY exists.
- Both commits exist in `git log`: `12df73cd` (1 file, +318/−6), `c0e71e5c` (1 file, +300/−3).
- `git diff --name-only HEAD~2 HEAD -- supabase/` → **0 files**. No database artefact touched.
- `git diff --diff-filter=D --name-only HEAD~2 HEAD` → **0 files**. Nothing deleted.
- Every count, test name and failure body pasted above was copied from a run captured in
  `/tmp/156-02-t1.txt` and `/tmp/156-02-t2.txt`, not reconstructed.

---
*Phase: 156-connect-refactor-the-venue-the-server-validated-is-the-venue*
*Completed: 2026-08-13*
