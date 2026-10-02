---
phase: 148-own-owner-factsheet-without-cache-disclosure
plan: 04
subsystem: factsheet-v2 / cache-isolation guards
tags: [OWN-02, SC2, structural-gate, source-scan, rule-9, cache-disclosure]
requires:
  - 148-02 (visibility predicate injected into fetchAndBuildPayload; cached wrapper visibility-free)
  - 148-03 (Lane B owner arm on page.tsx; page.owner-lane.test.tsx behaviour spec)
provides:
  - "SC2 structural layer: repo-wide CI invariant that the shared factsheet cache can only ever be populated by the published-only builder"
  - "T-148-03 pin: generateMetadata is permanently owner-predicate-free"
  - "T-148-07 pin: force-dynamic export cannot be silently dropped"
  - "'No third factsheet-payload resolution mechanism' clause (phase-147 'no fifth reader' restated)"
affects:
  - src/app/factsheet/[id]/v2/page.tsx (guarded, not modified — net-zero diff)
tech-stack:
  added: []
  patterns:
    - "phase-147-series-resolution-guards architecture cloned wholesale: fail-loud readSource, stripComments-before-match, productionSources walk, anti-vacuity tests, in-file Rule-9 mutation ledger"
    - "Negative-clause type-seam assertion (absence of `visibility` / `StrategyVisibility` in a declaration head) instead of a positive signature substring — formatting-independent"
key-files:
  created:
    - src/__tests__/phase-148-owner-lane-cache-isolation.test.ts
  modified:
    - .planning/phases/148-own-owner-factsheet-without-cache-disclosure/148-VALIDATION.md
decisions:
  - "Assertion 3 pins the cached wrapper's seam as a NEGATIVE (no `visibility`, no `StrategyVisibility` token in the declaration head) rather than a positive `(cacheKey: string)` substring — the shipped declaration spans three lines, so the positive literal does not exist in the source and would have pinned formatting, reddening on any reflow"
  - "generateMetadata body extraction required a paren-balanced parameter-list skip: the naive 'first `{` after the function name' grabbed the destructuring pattern `({ params }: { … })`, not the body"
  - "The Rule-9 ledger was committed as an explicit PENDING placeholder in Task 1 and only filled with pasted output after the mutations actually ran — a pre-written ledger would have been an unobserved claim"
metrics:
  duration: ~15 min
  completed: 2026-08-05
  tasks: 2
  commits: 2
---

# Phase 148 Plan 04: Owner-Lane Cache Isolation Guard Summary

A repo-wide source-scan CI invariant proving the shared `unstable_cache` factsheet entry can only
ever be filled by the published-only builder — with both falsifiability mutations observed RED at
two independent sites, and the measured proof that the 148-03 behaviour spec cannot catch either.

## What Was Built

`src/__tests__/phase-148-owner-lane-cache-isolation.test.ts` (349 lines, 9 tests), a wholesale
clone of the phase-147 guard architecture. Seven assertion groups:

| # | Property pinned | Why it is load-bearing |
|---|-----------------|------------------------|
| 1 | `unstable_cache(` occurs exactly once in `page.tsx` | a second cache site is a second disclosure policy |
| 2 | the cache callback names `withPublishedOnly` as a **literal**, never `withPublishedOrOwner`, and calls `fetchAndBuildPayload(id, withPublishedOnly)` | the key is id-only, so an owner-inclusive predicate here serves one owner's draft to every later reader for the full TTL |
| 3 | `buildFactsheetPayloadCached`'s declaration head contains no `visibility` / `StrategyVisibility` | the 148-02 type-level unrepresentability claim, as a formatting-independent negative |
| 4 | repo-wide walk: no production source outside `page.tsx` names either builder | an allowlist cannot catch a brand-new offender file; a walk can |
| 5 | `generateMetadata` never reaches `withPublishedOrOwner` | T-148-03 — draft name/description must never enter `<title>`/OG, which unauthenticated crawlers fetch and third parties cache |
| 6 | `export const dynamic = "force-dynamic"` survives | T-148-07 — the RESPONSE-level pin, distinct from the DATA-level `unstable_cache` concern |
| 7 | anti-vacuity ×3 | extractor found a real callback body; `withPublishedOrOwner` still present on Lane B; `types.ts` proves `stripComments` is load-bearing for the walk |

`stripComments` runs before every match and is load-bearing for two independent reasons, both
verified against the shipped tree: `page.tsx`'s own prose names **both** predicates and **both**
builders (it documents the very hazard being guarded), and `src/lib/factsheet/types.ts:545` is a
comment naming `fetchAndBuildPayload` that an un-stripped walk would report as an offender. The
third anti-vacuity test asserts exactly that: `types.ts` raw contains the token, stripped does not.

A missing `page.tsx` is an explicit failure via `readSource`, never a skip.

## Falsifiability — Both Mutations Observed RED

**SC-2B-a, payload-build site.** `fetchAndBuildPayload(id, withPublishedOnly)` →
`fetchAndBuildPayload(id, (q) => q)`. The builder runs on the service-role admin client where the
injected predicate is the *only* gate, so an identity predicate caches unfiltered rows and hands a
draft strategy to anonymous readers for the full 3600s TTL. Gate: **2 failed | 7 passed**.

**The asymmetry is real, verified, and is the rationale for this plan — not a miss.** Under the
identical mutation, `page.owner-lane.test.tsx` stayed **10 passed (10)**. Its supabase double does
not apply the injected predicate, so no behavioural assertion can observe the drop. For this edit
the structural gate is the sole control. (The 148-03 handoff predicted this; it is now measured.)

**SC-2B-b, signature-gate site** — a different member of the class, not a repeat.
`buildFactsheetPayloadCached(cacheKey: string)` widened to
`(cacheKey: string, visibility: StrategyVisibility)`, `visibility` threaded into the callback, Lane
A's call site updated. Gate: **3 failed | 6 passed**, with `npm run typecheck` still at **0
errors** — the type system cannot object once the seam is re-opened, which is precisely why
assertion 3's negative clause has to exist.

Both reverted by re-editing the mutated lines (never `git checkout --`).
`git diff --quiet -- "src/app/factsheet/[id]/v2/page.tsx"` exits 0 — the production file is
byte-identical to its 148-03 state.

## Verification

| Check | Result |
|-------|--------|
| `npx vitest run src/__tests__/phase-148-owner-lane-cache-isolation.test.ts` | 9/9 green |
| targeted battery (guard + `page.owner-lane.test.tsx`) | 19/19 green |
| `npm run typecheck` | 0 errors |
| `npm run lint` | 0 errors (1 pre-existing warning in `EquityChart.tsx`, unrelated — out of scope) |
| `git diff --quiet -- page.tsx` | exit 0 (net-zero production diff) |
| `grep -c stripComments` in the guard | 11 (≥ 3 required) |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Worktree forked from the wrong base**

- **Found during:** startup `<worktree_branch_check>`
- **Issue:** the worktree HEAD was at `f713cf97` (the phase-147 merge), missing all of waves 1–2 —
  no phase-148 directory, no Lane B, no DI seam. The orchestrator's `EXPECTED_BASE` full hash
  (`7bba3769d362…`) is **not a valid object**: its `7bba3769` prefix is correct but the remaining
  32 characters are corrupted, so `git merge-base`/`git cat-file` both errored and the guard's
  reset block could not fire.
- **Fix:** resolved the unambiguous prefix — `git rev-parse 7bba3769` →
  `7bba3769273adfdb170bf6c6849597e70ce0e9c0`, which is exactly `feat/v1.17-148-own-cache-disclosure`
  HEAD and matches the prompt's description ("merge executor worktree", includes waves 1–2).
  Confirmed the current HEAD was a strict ancestor, then `git reset --hard` to it.
- **Files modified:** none (git state only)
- ⚠️ **For the orchestrator:** the full-hash suffix passed to executors is being corrupted. Had the
  prefix been ambiguous, this would have been an unrecoverable halt. This is the documented
  "worktrees fork from the default branch" hazard, and the guard that exists to catch it was
  disarmed by the bad hash.

**2. [Rule 3 - Blocking] `node_modules` absent in the worktree**

- **Found during:** startup
- **Fix:** symlinked the main repo's install (per prompt instruction — no package manager run).
- **Files modified:** none tracked

**3. [Rule 1 - Bug] `generateMetadata` body extractor grabbed the parameter destructuring**

- **Found during:** Task 1, first test run
- **Issue:** taking the first `{` after `function generateMetadata` returned `\n params,\n` — the
  destructuring pattern in `({ params }: { params: Promise<{ id: string }> })`, not the body.
  Assertion 5 was therefore scanning three characters of parameter list, which would have made the
  T-148-03 pin vacuous (a `withPublishedOrOwner` in the real body would never have been seen).
- **Fix:** added `bodyBraceIndex`, which paren-balances the parameter list first and only then
  finds the body brace. `declarationHead` shares it. Assertion 5 now also positively requires
  `withPublishedOnly` in the body, so a gutted `generateMetadata` cannot false-green.
- **Files modified:** `src/__tests__/phase-148-owner-lane-cache-isolation.test.ts`
- **Commit:** `26cc391a`

### Planned-and-honoured constraints

- Assertion 3 was written with **no** positive `(cacheKey: string)` clause, as the plan explicitly
  required — the shipped declaration spans three lines and that substring does not exist.
- SC-2B-b was mutated at the **signature** site, not a second pass at the payload-build site.
- The Rule-9 ledger shipped as an explicit `PENDING` placeholder in the Task-1 commit and was only
  filled with pasted output after the mutations ran. Committing the pre-written narrative would
  have been an unobserved claim (Rule 12).

## Notes for the Verifier

- `src/app/factsheet/[id]/v2/STREAMING.md` names `buildFactsheetPayloadCached` twice. It is a
  `.md` file and the walk is `.tsx?`-only, so it is out of scope by construction rather than by
  exception — worth knowing if the walk is ever widened to docs.
- The guard reads source text only: no network, no DB, no fixtures, sub-second runtime. It adds no
  coverage-threshold pressure.
- Next.js skill injection fired on the `page.tsx` read. Not invoked: this plan authors zero
  Next.js API surface — the only production edits were the two transient mutations, both reverted,
  and the deliverable is a filesystem source-scan test.

## Known Stubs

None.

## Threat Flags

None — no new network endpoint, auth path, file-access pattern, or schema change. The only
production file touched was mutated transiently and reverted to byte-identical.

## Self-Check: PASSED

- `src/__tests__/phase-148-owner-lane-cache-isolation.test.ts` — FOUND on disk
- `.planning/phases/148-own-owner-factsheet-without-cache-disclosure/148-VALIDATION.md` — FOUND, rows SC-2B-a/b flipped to ✅ Observed
- commit `26cc391a` (Task 1) — FOUND in `git log`
- commit `e80c192e` (Task 2) — FOUND in `git log`
- `src/app/factsheet/[id]/v2/page.tsx` — absent from `git status`, `git diff --quiet` exit 0 (net-zero)
- STATE.md / ROADMAP.md — untouched, as instructed (orchestrator owns those writes)
