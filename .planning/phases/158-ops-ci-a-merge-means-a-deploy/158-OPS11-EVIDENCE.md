# OPS-11 — `MultiKeyConnectStep` order-sensitive flake: reproduction evidence

**Phase:** 158-ops-ci-a-merge-means-a-deploy (plan 04)
**Measured:** 2026-08-20
**HEAD at measurement:** `35c74149e215b6c6117d3905297d602491a67dce`
**Requirement:** OPS-11 — *"fix the unrestored `vi.stubGlobal`/`vi.mock` root cause … not retried away"*

---

## 1. The dated claim under test

TODOS.md:1011, verbatim (recorded 2026-07-30, in the v1.16 ship findings):

> **Genuinely separate, still-open: the `MultiKeyConnectStep` WIZ-02 frontend test-isolation flake**
> (44/44 in isolation, order/shard-sensitive) — did NOT hit PR6's `frontend-test` shard; left as
> tracked test-hygiene, fix if it reddens a future shard.

This is a **dated claim, not a standing fact**. Two things changed after it was written, and both
had to be re-measured before any code was touched:

1. Phase 140.5-01 / SEAMPROSE-04 landed the config-level state fence (`vitest.config.ts:68-69`),
   the `process.env` snapshot-restore (`src/test-setup.ts`), and a falsifiable leak canary
   (`src/test-setup.leak-canary.test.ts`) — at or after the flake's record date.
2. The spec itself grew 44 → 72 cases (80 including `MultiKeyConnectStep.payload.test.ts`).

**Reproduction-first protocol:** no test or production code is changed until the sweep below
either reproduces the failure or honestly fails to.

---

## 2. Environment fingerprint

| Property | Value |
|---|---|
| Repo tree | `…/.claude/worktrees/agent-ab3e3337cefc682a7` (GSD phase worktree) |
| Git SHA | `35c74149e215b6c6117d3905297d602491a67dce` |
| Local node (`node -v`) | `v25.8.1` |
| CI-parity node (`/opt/homebrew/opt/node@22/bin/node -v`) | `v22.22.1` (CI pins `node-version: 22`, `ci.yml:236`) |
| vitest | `4.1.10` |
| `node_modules` | installed via `npm ci` (GSD worktrees fork WITHOUT `node_modules` — measured) |
| **`.env.test.local`** | **ABSENT** — `ls -a` shows only `.env.example` |

The absent-`.env` condition is load-bearing and is why this tree is a valid local gate: with
`.env.test.local` present, `HAS_LIVE_DB` un-skips ~274 live-DB tests that red BY DESIGN. Every run
below reports **`281 skipped`**, which is that suppression working — not tests being dodged.

### Node-22 PATH variant

CI is Node 22, local default is Node 25, and this repo has a recorded class of CI-only reds that
reproduce locally only under the Node-22 PATH. All Node-22 runs below were invoked with:

```bash
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
```

---

## 3. What counts as a reproduction

> A run is a REPRODUCTION **only if** a `MultiKeyConnectStep` case FAILS while the same case passes
> in isolation. Unrelated reds are recorded but are NOT a reproduction, and each is classified.

Detector (applied to every run log):

```bash
grep -E '^ FAIL ' "$log" | grep -q "MultiKeyConnectStep"
```

**The detector is falsifiable, and was proven so rather than assumed** (founder rule: a test that
cannot fail is worse than none). `MultiKeyConnectStep` appears 8× in the seed-1 log as *stderr from
passing tests* (`[wizard:MultiKeyConnectStep] members GET non-ok: 500`), so a naive substring grep
would have reported a false reproduction on every run. Both polarities measured:

| Probe | Command | Result |
|---|---|---|
| Synthetic target FAIL line | `grep -E '^ FAIL ' 158-04-detector-probe.log \| grep -c MultiKeyConnectStep` | **1** (fires) |
| Real seed-1 log (8 stderr mentions, 0 FAILs) | `grep -E '^ FAIL ' 158-04-seed1-n25.log \| grep -c MultiKeyConnectStep` | **0** (silent) |

---

## 4. Baseline — the two target files in isolation

```bash
npx vitest run "src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.test.tsx" \
               "src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.payload.test.ts" \
               --reporter=dot
```

> ` Test Files  2 passed (2)` / `      Tests  80 passed (80)` / `   Duration  5.15s`

**GREEN**, as expected — the recorded flake was full-suite-context only. This is the control the
"passes in isolation" half of the reproduction definition is measured against.

---

## 5. Sweep matrix — 15 full-suite / CI-shard runs

`mode` legend:
- **`shuffle-all`** = `--sequence.shuffle` — shuffles file order **and test order within each file**.
  This is the plan-specified command and the *most aggressive* instrument.
- **`shuffle-files-only`** = `--sequence.shuffle.files` — shuffles **file order only**, leaving
  within-file declaration order intact. This is the instrument that actually models the recorded
  defect (a cross-file leak / "order/shard-sensitive") **and models what CI does**: CI never
  shuffles tests within a file.

| # | Run | Node | Mode | Seed | Exit | Dur | Test files | Tests | **Target failed?** |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `seed1-n25` | 25.8.1 | shuffle-all | `--sequence.seed=1` | 1 | 238s | 2 failed / 784 passed / 19 skipped | 92 failed / 11891 passed / 281 skipped | **no** |
| 2 | `seed2-n25` | 25.8.1 | shuffle-all | `--sequence.seed=2` | 1 | 208s | 6 failed / 780 passed / 19 skipped | 47 failed / 11936 passed / 281 skipped | **no** |
| 3 | `seed3-n25` | 25.8.1 | shuffle-all | `--sequence.seed=3` | 1 | 200s | 8 failed / 778 passed / 19 skipped | 85 failed / 11898 passed / 281 skipped | **no** |
| 4 | `seed4-n25` | 25.8.1 | shuffle-all | `--sequence.seed=4` | 1 | 210s | 2 failed / 784 passed / 19 skipped | 72 failed / 11911 passed / 281 skipped | **no** |
| 5 | `seed5-n25` | 25.8.1 | shuffle-all | `--sequence.seed=5` | 1 | 210s | 3 failed / 783 passed / 19 skipped | 83 failed / 11900 passed / 281 skipped | **no** |
| 6 | `seed6-n22` | **22.22.1** | shuffle-all | `--sequence.seed=6` | 1 | 226s | 2 failed / 784 passed / 19 skipped | 22 failed / 11961 passed / 281 skipped | **no** |
| 7 | `seed7-n22` | **22.22.1** | shuffle-all | `--sequence.seed=7` | 1 | 218s | 3 failed / 783 passed / 19 skipped | 39 failed / 11944 passed / 281 skipped | **no** |
| 8 | `seed8-n22` | **22.22.1** | shuffle-all | `--sequence.seed=8` | 1 | 214s | 6 failed / 780 passed / 19 skipped | 94 failed / 11889 passed / 281 skipped | **no** |
| 9 | `seed9-n22` | **22.22.1** | shuffle-all | `--sequence.seed=9` | 1 | 216s | 10 failed / 776 passed / 19 skipped | 168 failed / 11815 passed / 281 skipped | **no** |
| 10 | `seed10-n22` | **22.22.1** | shuffle-all | `--sequence.seed=10` | 1 | 238s | 5 failed / 781 passed / 19 skipped | 25 failed / 11958 passed / 281 skipped | **no** |
| 11 | `seed11-n22-files` | **22.22.1** | shuffle-files-only | `--sequence.seed=11` | **0** | 221s | **786 passed** / 19 skipped | **11983 passed** / 281 skipped | **no** |
| 12 | `seed12-n22-files` | **22.22.1** | shuffle-files-only | `--sequence.seed=12` | **0** | 223s | **786 passed** / 19 skipped | **11983 passed** / 281 skipped | **no** |
| 13 | `seed13-n22-files` | **22.22.1** | shuffle-files-only | `--sequence.seed=13` | **0** | 229s | **786 passed** / 19 skipped | **11983 passed** / 281 skipped | **no** |
| 14 | `cishard1-n22` | **22.22.1** | CI `--shard=1/2` exact | n/a | **0** | 136s | all passed | all passed | **no** (target PRESENT in shard) |
| 15 | `cishard2-n22` | **22.22.1** | CI `--shard=2/2` exact | n/a | **0** | 129s | all passed | all passed | **no** (target absent from shard) |

**13 distinct shuffle seeds (1–13), 8 of them under Node 22** — the plan required ≥10 seeds with ≥5
under Node 22. Plus both exact CI shard invocations. **Zero reproductions.**

### Verbatim commands (re-runnable)

```bash
# Runs 1–10 — plan-specified aggressive shuffle (files AND tests)
npx vitest run --sequence.shuffle --sequence.seed=1  --reporter=dot   # node 25
npx vitest run --sequence.shuffle --sequence.seed=2  --reporter=dot   # node 25
npx vitest run --sequence.shuffle --sequence.seed=3  --reporter=dot   # node 25
npx vitest run --sequence.shuffle --sequence.seed=4  --reporter=dot   # node 25
npx vitest run --sequence.shuffle --sequence.seed=5  --reporter=dot   # node 25
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
npx vitest run --sequence.shuffle --sequence.seed=6  --reporter=dot   # node 22
npx vitest run --sequence.shuffle --sequence.seed=7  --reporter=dot   # node 22
npx vitest run --sequence.shuffle --sequence.seed=8  --reporter=dot   # node 22
npx vitest run --sequence.shuffle --sequence.seed=9  --reporter=dot   # node 22
npx vitest run --sequence.shuffle --sequence.seed=10 --reporter=dot   # node 22

# Runs 11–13 — FILE-ORDER-ONLY shuffle (models the recorded defect AND CI)
npx vitest run --sequence.shuffle.files --sequence.seed=11 --reporter=dot   # node 22
npx vitest run --sequence.shuffle.files --sequence.seed=12 --reporter=dot   # node 22
npx vitest run --sequence.shuffle.files --sequence.seed=13 --reporter=dot   # node 22

# Runs 14–15 — the EXACT CI frontend-test shard invocation (ci.yml:290-299), node 22
npx vitest run --shard=1/2 --reporter=dot --reporter=blob --coverage --test-timeout=20000 \
  --coverage.thresholds.lines=0 --coverage.thresholds.statements=0 \
  --coverage.thresholds.functions=0 --coverage.thresholds.branches=0
npx vitest run --shard=2/2 --reporter=dot --reporter=blob --coverage --test-timeout=20000 \
  --coverage.thresholds.lines=0 --coverage.thresholds.statements=0 \
  --coverage.thresholds.functions=0 --coverage.thresholds.branches=0
```

Driver scripts and per-run logs: `158-04-sweep.sh`, `158-04-cishard.sh`, `158-04-results.tsv`,
`158-04-<run_id>.log` (session scratchpad — not committed; the tables above are the durable record).

---

## 6. Honest classification of every red

**No red in any of the 15 runs was a `MultiKeyConnectStep` case.** The reds fall into exactly two
buckets, and neither is the OPS-11 defect.

### Bucket A — intra-file test-order dependence (`shuffle-all` only). NOT the OPS-11 defect.

Every red in runs 1–10 is a file whose tests depend on their own **declaration order**, surfaced by
`--sequence.shuffle` reordering tests *within* a file. Distinct files observed across the sweep:

| File | Symptom |
|---|---|
| `src/app/api/strategies/create-with-key/route.test.ts` | 401 where 400/429/503 expected (every seed) |
| `src/lib/auth.test.ts` | order-dependent (8 of 10 seeds) |
| `src/app/api/admin/users/[id]/roles/route.test.ts` | order-dependent |
| `src/app/(dashboard)/allocations/components/OptimizerPanel.test.tsx` | order-dependent |
| `src/app/(dashboard)/allocations/widgets/performance/EquityChart.boundary.test.tsx` | order-dependent |
| `src/app/(dashboard)/strategies/new/wizard/steps/MetadataStep.test.tsx` | order-dependent |
| `src/app/api/alert-digest/route.test.ts` | order-dependent |
| `src/app/api/admin/match/allocators/route.test.ts` | order-dependent |
| `src/app/api/admin/strategy-review/route.test.ts` | order-dependent |
| `src/proxy.test.ts` | order-dependent |

**Root mechanism, identified (not guessed)** — `create-with-key/route.test.ts:2374-2385`, the H-0306
"unmocked withAuth boundary" describe:

```ts
beforeEach(() => { vi.resetModules(); … });
afterEach(()  => { vi.resetModules(); });          // ← no vi.doUnmock
…
vi.doMock("@/lib/api/withAuth", …actual…);          // real withAuth
vi.doMock("@/lib/supabase/server", …no user…);      // getUser → null
```

`vi.resetModules()` clears the module *cache*; it does **not** deregister a `vi.doMock`. In
declaration order this block runs last-ish and nothing re-imports afterwards, so the file is green.
Shuffled, it runs early, and every later test that does `await import("./route")` picks up the real
`withAuth` over a user-less Supabase client → **401**. That is genuinely the DEF-16-1 *class* (an
unrestored mock crossing a test boundary) — but it is **intra-file**, in a different file, and
cannot affect `MultiKeyConnectStep.test.tsx`, which does no `vi.doMock` and imports its component
statically.

**Why this is not a CI defect and was not "fixed" here:** CI runs tests in declaration order —
`vitest.config.ts` sets no `sequence.shuffle`, and neither does the `ci.yml` shard command. Nothing
in CI can currently reach this. It is a real latent hygiene debt discovered *by* this sweep, is
out of OPS-11's scope (10 files, unrelated to the target), and is logged to
`deferred-items.md` with the remedy rather than fixed as scope creep.

### Bucket B — worker-contention timeouts. A measurement artifact.

`src/__tests__/contracts/contracts-registry.test.ts` — *"Test timed out in 5000ms"* on the
ESLint-severity-resolution case, run 1 only. This is the documented worker-contention class
(`vitest.config.ts:6-16`); the machine was concurrently running sibling GSD phase agents. **CI is
immune by construction:** the shard command passes `--test-timeout=20000`. It did not recur in the
14 later runs, including both `--test-timeout=20000` CI-shard runs.

---

## 7. The target's behaviour, stated plainly

`MultiKeyConnectStep.test.tsx` passed in **15 of 15** runs — including 10 runs under an instrument
(`--sequence.shuffle`) *strictly more aggressive than anything CI does*, an instrument that broke
**10 other files**. It was green in all 8 Node-22 runs and in the exact CI shard that contains it
(run 14, `target-present`, exit 0).

Its hygiene at HEAD, re-verified this session:

| Property | Site | Status |
|---|---|---|
| File-level `vi.mock` (analytics only) | `:37` | single, module-scope, no registry churn |
| `vi.restoreAllMocks()` + `cleanup()` in `afterEach` | `:93-96` | present |
| `vi.stubGlobal` | — | **zero calls** |
| `vi.doMock` | — | **zero calls** |
| Defensive `vi.unstubAllGlobals()` | `:1276`, `:1598` | present |
| `fetch` interception | `routeFetch()` `:56-78` | **`vi.spyOn(globalThis,"fetch")`** — already the DEF-16-1 remedy pattern |
| `MultiKeyConnectStep.payload.test.ts` | whole file | no mocks/stubs at all |

The spec already *is* the pattern OPS-11 would have prescribed. There is no leak to fix in it.

---

## 8. Closure — **BRANCH B: closed on MECHANISM**, carried by reproduction-attempt evidence

The sweep did not reproduce. Per the plan's two-branch contract, OPS-11 therefore closes on the
**identified, in-tree, falsifiable mechanism** that landed *after* the flake was recorded — not on a
green rerun.

### The mechanism, cited

| # | Mechanism | Location | Covers |
|---|---|---|---|
| 1 | `unstubGlobals: true`, `unstubEnvs: true` | `vitest.config.ts:68-69` | globals via `vi.stubGlobal`, env via `vi.stubEnv`. Deliberately **config-level**: it runs BEFORE each test and *cannot be shadowed by a file-local `afterEach`* (`vitest.config.ts:58-60`) |
| 2 | `process.env` snapshot-restore (`restoreEnv`, two scopes: test→test in `afterEach`, file→file in `afterAll`) | `src/test-setup.ts:88-117` | the 54 files that assign `process.env.X =` **directly** — which `unstubEnvs` does **not** cover |
| 3 | Falsifiable leak canary, ledger rows **SC-HARNESS-1** / **SC-ENV-1** | `src/test-setup.leak-canary.test.ts` | makes 1 and 2 *visible when removed* — "a row-1 mechanism nobody can see fail is indistinguishable from no mechanism" |

Mechanisms 1 and 2 are **not redundant with each other**, and the canary is what proves it.

### The mechanism, RE-MEASURED at HEAD (not inherited as a dated claim)

The canary's falsifiability is itself a claim from Phase 140.5. This session re-derived it at HEAD
rather than citing `140.5-VALIDATION.md` — neuter → observe RED → restore, both polarities:

| Ledger row | Neuter applied | Canary result | Which assertion reddened |
|---|---|---|---|
| — | *(none — control)* | **GREEN** 2 passed | — |
| **SC-HARNESS-1** | `vitest.config.ts:68` → `unstubGlobals: false` | **RED** 1 failed \| 1 passed | *"A global stubbed in the previous test survived into this one"* (`leak-canary.test.ts:86`), `expected true to be false` |
| **SC-ENV-1** | `src/test-setup.ts` → drop `restoreEnv(testBaselineEnv)` from `afterEach` | **RED** 1 failed \| 1 passed | *"An env var assigned directly in the previous test survived into this one"* (`leak-canary.test.ts:95`), `expected 'leaked-env' to be undefined` |
| — | both restored | **GREEN** 2 passed, `git status --short` empty | — |

Each neuter reddened **exactly one, and a different, assertion** — so the two fences are
independently live at `35c74149`, and neither is silently carrying the other. Both edits were
reverted; the working tree was verified clean before the closure commit.

### Why a green rerun alone would NOT have sufficed

A green rerun asserts only *"it passed this time"* — which is precisely the "it passed when we
reran it" repudiation risk logged as **T-158-15** in this plan's threat register, and is
indistinguishable from a flake that simply did not fire. This closure is stronger on three counts,
each measured rather than argued:

1. **The instrument was proven able to find the defect class it was hunting.** The same sweep that
   cleared the target reddened **10 other files** on exactly this class of state leakage. A sweep
   that finds nothing anywhere is evidence of a blind instrument; this one is demonstrably not.
2. **The detector was proven able to report a reproduction.** Falsified in both polarities (§3)
   *before* the sweep was trusted — the naive grep would have produced false positives on all 15 runs.
3. **The mechanism was proven live, not asserted.** Both fences reddened the canary on removal at
   HEAD today (table above), so the standing regression guard is known-falsifiable rather than
   assumed.

The load-bearing measurement is run 11–13: under **file-order-only** shuffling — the instrument that
actually models "order/shard-sensitive" and models what CI does — the **entire suite** is green
across 3 seeds (786 files, 11,983 tests, exit 0). The recorded defect's own mechanism no longer
produces a failure anywhere in the repo, not merely in the target file.

### Standing regression guard

`src/test-setup.leak-canary.test.ts` runs in every suite run like any other test (it is deliberately
*not* registered in `CONTRACT_GUARDS`). If either fence is removed or turned off, it reddens. That is
the guard that keeps OPS-11 closed; no retry, no reordering, and no timeout change was introduced
anywhere.

### Code changed by this closure

**None.** Branch B ships zero production and zero test code changes — the target spec is already
hygienic at HEAD (§7) and already uses the DEF-16-1 remedy pattern (`vi.spyOn` + `restoreAllMocks`)
for its `fetch` interception. The two neuters above were temporary measurements, reverted and
verified.

### Owed elsewhere (NOT part of this closure)

The Bucket-A intra-file order dependence in **10 files** (§6) is a real, separate hygiene debt that
this sweep discovered. It is unreachable from CI today (CI never shuffles tests within a file) and is
out of OPS-11's scope. Logged to `deferred-items.md` in this phase directory and to `.planning/WINDOWS.md`,
with the identified mechanism and remedy, rather than fixed here as scope creep.

---

## 9. Verdict

> **OPS-11 is CLOSED on MECHANISM.** The 2026-07-30 claim was re-measured at HEAD `35c74149` across
> 15 runs (13 shuffle seeds, 8 under Node 22, both exact CI shards) and did not reproduce. The
> closure is the Phase 140.5 fence — `vitest.config.ts:68-69`, the `src/test-setup.ts` env snapshot,
> and the `SC-HARNESS-1` / `SC-ENV-1` leak canary — each re-verified falsifiable at HEAD this
> session. `MultiKeyConnectStep` passes under every ordering tested, including orderings strictly
> more aggressive than any CI performs. Not retried away; nothing was reordered, retried, or
> timeout-bumped.

