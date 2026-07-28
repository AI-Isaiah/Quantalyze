---
phase: 140-seam-shared-resilience-core-circuit-breaker
plan: 07
subsystem: infra
tags: [seam, eslint-rule, source-scan-invariant, maxDuration, phase-gate, mutation-testing, test-isolation]

# Dependency graph
requires:
  - phase: 140-01
    provides: "SEAM_BUDGETS / SEAM_ROUTE_BUDGETS (15 routes) / SEAM_EXCLUSIONS (3) / SEAM_RETRIES tables; ANALYTICS_URL homed in the core"
  - phase: 140-03
    provides: "first maxDuration pins + the grep-gate hygiene lesson (prose must not defeat its own guard)"
  - phase: 140-04
    provides: "wizard Class-2 pins; the same grep-hygiene lesson, hit a second time"
  - phase: 140-05
    provides: "five Class-3 pins; last route-local seam budget removed"
  - phase: 140-06
    provides: "third seam routed through the core; final 5 pins, so all 15 SEAM_ROUTE_BUDGETS routes were pinned before this plan ran"
provides:
  - "src/lib/seam-budgets.invariant.test.ts — SC-4a + SC-4b, the CI teeth for SEAM-02: maxDuration read from route files ON DISK, summed retry-aware headroom formula"
  - "quantalyze/no-raw-analytics-fetch — the ESLint rule that keeps SEAM-01 true AFTER merge, registered at error for src/** with a CLOSED four-path allowlist"
  - "SEAM_ALLOWLIST_EXEMPT in contracts-registry.test.ts — the allowlist frozen at four and asserted to actually resolve (T-140-26)"
  - "globalThis.AsyncLocalStorage installed deterministically in src/test-setup.ts — removes an order-dependent, silent full-suite flake"
  - "Phase 140 gate: 8859 tests / typecheck / lint / build / coverage green on Node 25 AND Node 22"
affects: [141 retry (SEAM_RETRIES raise is already invariant-guarded), any future seam call site (now fails lint)]

# Tech tracking
tech-stack:
  added: []  # ZERO new dependencies — locked constraint honoured
  patterns:
    - "Two-sided invariant: the asserted quantity's halves must come from DIFFERENT sources (budget table vs route file on disk), or the test compares the implementation to itself"
    - "INIT-TRACKING ESLint detection: taint a binding by what its initializer READS, never by what the binding is NAMED — resolved at Program:exit so declaration order cannot hide a violation"
    - "Allowlist integrity asserted in BOTH directions: each exemption must resolve to non-error (proving the glob matches) and the set size is frozen (proving it cannot be widened to silence a finding)"
    - "An async vi.hoisted block that awaits a dynamic import is a RACE against the file's own imports, not an ordering fix — host globals belong in setupFiles, which vitest fully awaits"

key-files:
  created:
    - src/lib/seam-budgets.invariant.test.ts
    - tools/eslint-plugin-quantalyze/rules/no-raw-analytics-fetch.mjs
    - tools/eslint-plugin-quantalyze/tests/no-raw-analytics-fetch.test.ts
  modified:
    - tools/eslint-plugin-quantalyze/index.mjs
    - eslint.config.mjs
    - src/__tests__/contracts/contracts-registry.test.ts
    - src/__tests__/contracts/REGISTRY.md
    - src/test-setup.ts
    - src/app/api/keys/[id]/permissions/route.seam.test.ts

key-decisions:
  - "SC-4b re-reads maxDuration from DISK rather than reusing expectedMaxDurationS, so the headroom assertion is grounded in the route file even if SC-4a were deleted"
  - "The rule has NO in-file sanctioned-exception escape hatch — a deliberate departure from the sibling B-series rules, because the legitimate call sites are a closed enumerated set and an in-file comment would let a new seam be minted by editing only the file that introduces it"
  - "No test-file off-block was added: neutralising the allowlist and linting all of src/ proved test files never trip the rule, so the allowlist is exactly four paths as the plan froze it"
  - "The permissions-seam flake was root-caused (async vi.hoisted race), not retried away or quarantined"

patterns-established:
  - "Prove an allowlist is BOTH load-bearing and minimal by neutralising it and linting the whole tree — the flagged set must equal the allowlist exactly"
  - "A lint rule that passes CI proves nothing until a probe file demonstrates it actually fires"

requirements-completed: [SEAM-01, SEAM-02]

# Metrics
duration: 35min
completed: 2026-07-25
---

# Phase 140 Plan 07: SC-4 Budget Invariant + ONE-Core Lint Rule + Phase Gate Summary

**Phase 140 is now permanent rather than merely done: a source-scan invariant reads every seam route's `maxDuration` off disk and fails loud on a missing or drifted pin, and an init-tracking ESLint rule makes a tenth seam a lint error instead of a code-review hope — with the whole phase gate green on both Node 25 and CI's Node 22, and a silent one-in-three full-suite flake root-caused and removed along the way.**

## Performance

- **Duration:** ~35 min
- **Tasks:** 3/3
- **Files created:** 3 · **Files modified:** 6

## Accomplishments

- **SC-4 is CI-enforced with real teeth.** `seam-budgets.invariant.test.ts` reads `export const maxDuration` from all fifteen `SEAM_ROUTE_BUDGETS` route files with `readFileSync` and an `^`-anchored regex. The budget side comes from the table, the ceiling side from disk — never both from the table (Pitfall 5). A missing export FAILS; nothing is substituted for it (Pitfall 8).
- **The invariant was mutation-checked in three directions**, not merely observed green. See "Mutation Verification" — the third mutant is the interesting one: raising `SEAM_RETRIES` to 2 breaches `validate-and-encrypt` at 360 000 ms vs 300 000 ms, which proves the formula is genuinely retry-aware and will tighten by itself when Phase 141 lands rather than needing to be rewritten then.
- **The summed formula matters for a third of the surface.** Four routes spend more than one budget (`validate-and-encrypt` reaches three; `create-with-key`, `composite/add-key` and `finalize-wizard` two each). A per-call assertion would have passed while the real worst case was double or triple.
- **SEAM-01 now holds after the merge, not just at it.** `quantalyze/no-raw-analytics-fetch` tracks bindings by what their initializer READS — `process.env.ANALYTICS_SERVICE_URL` through `??`/`||` chains, destructuring and computed access — and flags fetches of them whatever the binding is called. Name-matching would have failed the plan's own fixture 3, which is the shape an author is most likely to write by accident.
- **`npm run lint` green on the whole tree is itself the SEAM-01 proof.** Zero violations survive waves 1-3 outside the allowlist. The third seam existed for months because routing through the client was a convention; it is now a mechanism.
- **The allowlist was proven minimal AND load-bearing, not asserted.** Neutralising the off-block and linting all of `src/` flags **exactly** the four allowlisted files and nothing else. No test file trips the rule, so no test off-block was needed and the allowlist stayed frozen at four as the plan required.
- **A silent full-suite flake was root-caused and killed.** It cost the phase gate a real failure and is described in full below — the fix is one static import in `src/test-setup.ts`.
- **Phase gate green on both Node versions**, including the coverage ratchet with headroom on all four metrics.

## Task Commits

1. **Task 1: SC-4a + SC-4b source-scan invariant** — `eef2c2aa` (test, 37 cases + 3 mutants)
2. **Task 2 (TDD): `no-raw-analytics-fetch` rule + registration** — `faf1c614` (test, RED: 8 invalid fixtures reporting 0) → `b7391112` (feat, GREEN: 14/14 + probe + allowlist mutant)
3. **Task 3: phase gate + the two failures it surfaced** — `95d987eb` (fix)

**Plan metadata:** not committed — `.planning/**` is gitignored (`.gitignore:52`); this SUMMARY lives in the working tree only, per the main-tree execution mode for this run.

## Files Created

- `src/lib/seam-budgets.invariant.test.ts` — 37 cases. Header states the two-sided-invariant rationale, the no-default rule, an **honest reading of the headroom slack** (worst route 120 000 ms vs 300 000 ms at retries=0, so a reader must not mistake SC-4b for a tight guard today), and the CEILING: this file scans only the enumerated route files, not the import graph, so a sixteenth route is the ESLint rule's job, not this test's.
- `tools/eslint-plugin-quantalyze/rules/no-raw-analytics-fetch.mjs` — init-tracking detection resolved at `Program:exit`, identifiers in non-reference position ignored, `globalThis.fetch` covered. Documents its one-hop-taint ceiling rather than implying completeness.
- `tools/eslint-plugin-quantalyze/tests/no-raw-analytics-fetch.test.ts` — 8 invalid + 6 valid fixtures, chosen to pin the detection STRATEGY (renamed binding, declaration order, destructuring, computed access) rather than just the outcome.

## Files Modified

- `tools/eslint-plugin-quantalyze/index.mjs` — rule registered (ninth) + inventory comment.
- `eslint.config.mjs` — `"error"` for `src/**`, plus the four-path off-block with per-entry reasoning.
- `src/__tests__/contracts/contracts-registry.test.ts` — rule added to `REPO_WIDE_ERROR_RULES`; new `SEAM_ALLOWLIST_EXEMPT` block.
- `src/__tests__/contracts/REGISTRY.md` — rule row added to the plugin table.
- `src/test-setup.ts` — deterministic `globalThis.AsyncLocalStorage` install.
- `src/app/api/keys/[id]/permissions/route.seam.test.ts` — racy async `vi.hoisted` block removed; header now records the race and the guarantee that replaced it.

## Mutation Verification

Nothing here was accepted on a passing first run. Each mutant was reverted from a pre-mutation copy; `grep -c MUTANT` is 0 in every touched file and `git status` shows no modified tracked files.

| # | Mutation | Where | Result |
|---|---|---|---|
| 1 | `maxDuration` 300 → 299 | `keys/sync/route.ts` | exactly 1 case fails, naming the route (`expected 299 to be 300`) |
| 2 | `maxDuration` export commented out | `keys/sync/route.ts` | SC-4a **and** SC-4b fail with the no-export message — proves the `^` anchor rejects prose and that no default is substituted |
| 3 | `SEAM_RETRIES` 0 → 2 | `resilient-fetch.ts` | `validate-and-encrypt` breaches: 360 000 ms vs 300 000 ms — the formula is genuinely retry-aware |
| 4 | allowlist off-block neutralised | `eslint.config.mjs` | all four allowlisted files error; linting **all** of `src/` flags exactly those four and nothing else |
| 5 | `globalThis.AsyncLocalStorage` install removed | `src/test-setup.ts` | reproduces the observed full-suite failure exactly — same 3 tests, `PROBE_FAILED` vs `PROBE_TIMEOUT`, 502 vs 503, 502 vs 200 |

A **probe file** (`src/lib/__seam-lint-probe.ts`, since deleted) was also used to confirm the new rule actually fires on a fresh violation — a green lint is otherwise indistinguishable from a rule that never ran.

## Phase Gate Results

All commands run from a clean tree at `95d987eb`.

| Gate | Command | Result |
|---|---|---|
| Full suite | `npm test` | **696 files, 8859 passed, 287 skipped, 0 failed** |
| Typecheck | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | **0 errors** (1 pre-existing `EquityChart.tsx` warning, untouched) + both check-scripts OK |
| Build | `npm run build` | exit 0; **16 routes carry `maxDuration:300`** in `.next/server/functions-config-manifest.json` (all 15 budgeted + `debug-key-flow`) |
| Coverage | `npm run test:coverage` | exit 0 — lines **86.48**/82 · statements **84.36**/80 · functions **81.45**/74 · branches **78.38**/72 |
| Node 22 parity | `PATH=/opt/homebrew/opt/node@22/bin npm test` | v22.22.1 — **8859 passed, 0 failed** (full suite, not a subset) |

### Per-SC Verification Map (140-VALIDATION.md)

| SC | Command | Status |
|----|---------|--------|
| SC-1a | `keys/sync/route.seam.test.ts` | ✅ green |
| SC-1b | `admin/match/recompute/route.seam.test.ts` | ✅ green |
| SC-1c | `resilient-fetch.wiring.test.ts` | ✅ green |
| SC-2 / SC-2-neg / SC-3a/b/c / SC-4c | `resilient-fetch.test.ts` | ✅ green |
| **SC-4a / SC-4b** | `seam-budgets.invariant.test.ts` | ✅ **green (new — this plan)** |
| SC-5a | `admin/match/{eval,recompute}/route.test.ts` | ✅ 22/22 |
| SC-5b | `wizardErrors.test.ts` + `create-with-key/route.test.ts` | ✅ 123/123 |
| SC-5c | 5 Class-3 route tests | ✅ 109/109 |
| SC-5d / REG-1 | `process-key-client.test.ts` + `analytics-client.test.ts` | ✅ 40/40 |
| **REG-2** | `no-raw-analytics-fetch.test.ts` | ✅ **14/14 (new — this plan)** |

Every SC row now has a passing automated proof. The single Manual-Only row (breaker trip against a genuinely degraded live Railway) remains post-merge observation, as designed.

## Decisions Made

1. **SC-4b re-reads the ceiling from disk** rather than reusing `expectedMaxDurationS`, even though SC-4a already pins the two equal. It costs one function call and makes the headroom assertion independently grounded — if SC-4a were ever deleted, SC-4b would still not be self-referential.
2. **No in-file escape hatch on the rule**, deliberately departing from the sibling `B<n> sanctioned-exception:` convention. The legitimate call sites are a closed, enumerated set; a greppable in-file comment would let a new seam be minted by editing only the file that introduces it — the exact failure the rule exists to prevent (T-140-26). Path allowlisting keeps the decision visible in review.
3. **No test-file off-block was added.** The other eight rules have one, so this looks like an omission — it is not. Neutralising the allowlist and linting all of `src/` showed no test file trips the rule (they set env vars and stub `fetch`; none fetches the env-derived URL). Adding one would have widened the allowlist past the four paths the plan froze, and would have exempted the `*.seam.test.ts` files, which are precisely the files that must not bypass the core.
4. **`SEAM_ALLOWLIST_EXEMPT` added to the contracts registry** (beyond the plan's `files_modified`). Registering the rule there was forced — the registry asserts the exact rule set — but the *exemption* assertion is an addition, mirroring the existing `FROZEN_EXEMPT` precedent. It pins both directions: an off-glob that stopped matching would red-CI the core itself, and a fifth entry fails the frozen-at-four count.
5. **The flake was root-caused rather than retried away.** Quarantining it, or adding a retry, would have left a silent failure mode in the one file that proves the breaker survives the real Next cache boundary.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] Adding a ninth plugin rule reddened the contracts registry**

- **Found during:** Task 3 (first full-suite run)
- **Issue:** `src/__tests__/contracts/contracts-registry.test.ts` asserts the plugin exports *exactly* the expected rule set and that every rule resolves to `"error"`. A new rule is a deliberate red there — that is the guard working as designed, not a defect.
- **Fix:** Registered `no-raw-analytics-fetch` in `REPO_WIDE_ERROR_RULES` (it resolves to `error` on the representative non-exempt file), documented it in `REGISTRY.md`, and added `SEAM_ALLOWLIST_EXEMPT` asserting the four exemptions resolve to non-error and the set is frozen at four.
- **Files modified:** `src/__tests__/contracts/contracts-registry.test.ts`, `src/__tests__/contracts/REGISTRY.md`
- **Verification:** 34/34 green; the exemption half is backed by mutant 4, which showed those files erroring without the off-block.
- **Committed in:** `95d987eb`

**2. [Rule 1 - Bug] A silent, order-dependent flake in 140-06's real-cache seam test**

- **Found during:** Task 3 (first full-suite run — 4 failures, of which 3 were this)
- **Issue:** `keys/[id]/permissions/route.seam.test.ts` failed in roughly one full-suite run in three while passing 5/5 in isolation and 83/83 across its own directory. The cause is **not** worker contention as such. `next/dist/server/app-render/async-local-storage.js` captures `globalThis.AsyncLocalStorage` **once**, into a module-scope const, and substitutes a `FakeAsyncLocalStorage` whose `run()` throws the E504 invariant when it is absent — jsdom does not provide it. The file installed the global from an **async** `vi.hoisted` block whose `await import("node:async_hooks")` resolves on a later microtask, so the install raced the file's own imports. When it lost, `unstable_cache` threw the invariant, the route's catch classified it as a generic upstream failure, and all three cases reported a *plausible wrong status* (`PROBE_FAILED` for `PROBE_TIMEOUT`, 502 for 503, 502 for 200) rather than an obvious harness error. 140-06 correctly diagnosed the capture-once hazard but its per-file fix was itself racy.
- **Fix:** Install the global with a **static import in `src/test-setup.ts`**. Setup files are fully awaited before any test module is imported, so it is deterministic in every worker; the racy block was removed and the file's header now records the race and what replaced it.
- **Files modified:** `src/test-setup.ts`, `src/app/api/keys/[id]/permissions/route.seam.test.ts`
- **Verification:** Mutant 5 reproduces the original failure exactly (same 3 tests, same messages). Post-fix the full suite ran green **four consecutive times**, including twice under coverage and once under Node 22.
- **Committed in:** `95d987eb`

---

**Total deviations:** 2 auto-fixed (1× Rule 3, 1× Rule 1). No Rule 4 architectural decisions. No package installs. No scope creep beyond the two files the gate proved were broken.

## Issues Encountered

- **The phase gate earned its keep.** Both issues above were invisible to per-file runs and to `npm run lint`/`typecheck`/`build`. Only the full suite surfaced them, and the second one only intermittently — the exact class of defect that reaches CI and gets dismissed as a flake.
- **The grep-gate hygiene trap was avoided this time.** Three prior plans in this phase (140-03, 140-04, 140-05) had their own explanatory comments trip their acceptance greps. Every acceptance criterion here was verified against the **finished** file: `readFileSync` 3, `SEAM_RETRIES` 7, fallback-default patterns 0, `no-raw-analytics-fetch` 2 in `eslint.config.mjs` and 3 in `index.mjs`. The invariant test's own `^`-anchored regex is the same lesson applied structurally — a commented-out export cannot satisfy it, which mutant 2 proves.
- **The `[resilient-fetch] Upstash not configured` notice now also appears in `seam-budgets.invariant.test.ts` stderr.** Expected: the file imports the real core for its tables. One notice per module load, `redis === null`, no network call.
- **Coverage moved in the right direction.** 86.48 / 84.36 / 81.45 / 78.38 against the 82 / 80 / 74 / 72 ratchet — the new `src/lib` test adds covered lines rather than sinking any metric.

## Threat Flags

None. All security-relevant surface is enumerated in the plan's `<threat_model>`:

- **T-140-25** (self-referencing invariant, green forever) — mitigated and **mutation-demonstrated**: `maxDuration` from disk, `timeoutMs` from the table, and three mutants prove the test can fail.
- **T-140-26** (allowlist widened to silence lint) — mitigated at two levels: the allowlist is frozen at four paths in `eslint.config.mjs` with per-entry reasoning, and `contracts-registry.test.ts` now asserts the count is exactly 4 and that each entry resolves. The rule's message directs authors to the core and explicitly says "never to the allowlist"; the rule has no in-file escape hatch.
- **T-140-27** (a future dashboard `maxDuration` change silently invalidating budgets) — mitigated: fifteen explicit exports plus the disk-read invariant convert the platform assumption into a CI-checked fact, and the build manifest confirms the pins reach the deployment adapter.
- **T-140-SC** (package installs) — accepted: **zero installs**.

No new endpoint, auth path, file-access pattern or schema change. This plan adds one test file, one lint rule and its fixtures, and touches only test/config files plus two registry documents — **no production runtime code was modified**.

## Known Stubs

None. Both artifacts are fully implemented and mutation-proven.

Two limits are documented in the source rather than left implicit, and are deliberate scope boundaries rather than stubs:

- The invariant test scans the **enumerated route files only**, not the transitive import graph — a sixteenth route calling the seam clients is the ESLint rule's job, not this test's. Stated in the file's CEILING block.
- The lint rule's taint tracking is **one hop**: `const a = env; const b = a;` taints `a`, not `b`. A fixed-point alias pass would close it; the shape has never appeared in this repo, and an order-dependent half-measure would be worse than a documented limit. Stated in the rule's CEILING note.

## Next Phase Readiness

**Ready. Phase 140 is complete — all five ROADMAP success criteria have passing automated proofs.**

- **Phase 141 (retry)** inherits a guard that is already waiting for it: raising `SEAM_RETRIES` above 0 automatically tightens SC-4b, and mutant 3 shows the arithmetic is real (retries=2 breaches `validate-and-encrypt` today). If 141 raises retries, the invariant will name the offending route before the change can merge — which is exactly why the constant was introduced in 140-01 rather than after the fact.
- **A tenth seam now fails `npm run lint`**, and reviving the dormant `_unifiedValidateAndEncryptHandler` raw would too.
- **Carry-over for a reviewer (unchanged from 140-05):** the eight `CIRCUIT_OPEN` copy constants across the phase are byte-identical by convention only. A shared export, or an assertion that they match, remains the cheap follow-up — it touches files across four completed plans, so it was not taken here.
- **Carry-over from 140-02, still open:** `resilient-fetch.ts`'s `deadlineExceeded` log classifier retains an `instanceof Error`-only narrowness. It selects a log string only; widening it to `(Error || DOMException)` is a one-line freebie for whoever next edits that file.

---
*Phase: 140-seam-shared-resilience-core-circuit-breaker*
*Completed: 2026-07-25*

## Self-Check: PASSED

- All 9 artifacts exist on disk (3 created, 6 modified).
- All 4 task commits exist in git (`eef2c2aa`, `faf1c614`, `b7391112`, `95d987eb`) on `feat/v1.16-production-resilience`.
- `git diff --diff-filter=D --name-only e213c2db HEAD` → empty: **no file deletions** in this plan.
- `grep -rl MUTANT src/ tools/ eslint.config.mjs` → no matches. The temporary lint probe (`src/lib/__seam-lint-probe.ts`) is ABSENT. All five mutation sites restored byte-identical from pre-mutation copies.
- Working tree clean apart from one pre-existing untracked file (`analytics-service/scripts/nautilus_factsheet.py`) that predates this phase and was not touched.
- Branch unchanged throughout (`feat/v1.16-production-resilience`); no branch created, switched or deleted, no reset, no `git clean`.
- Phase gate: `npm test` 8859/0 · `npm run typecheck` exit 0 · `npm run lint` 0 errors · `npm run build` exit 0 with 16 `maxDuration:300` manifest entries · `npm run test:coverage` exit 0, all four thresholds cleared · Node 22 full-suite parity 8859/0.
- `.planning/**` intentionally NOT staged (gitignored, `.gitignore:52`; main-tree execution mode). STATE.md / ROADMAP.md left to the orchestrator.
