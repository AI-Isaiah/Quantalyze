---
phase: 148-own-owner-factsheet-without-cache-disclosure
plan: 02
subsystem: api
tags: [nextjs, rsc, unstable_cache, supabase, rls, visibility-predicate, dependency-injection]

# Dependency graph
requires:
  - phase: 147-scen-01-real-series
    provides: "phase-147 series-resolution guards (Layer A select-width scan + Layer B per-surface pin on this file) — kept green by leaving the .select(...) string and the resolveDailyReturnSeries( literal byte-untouched"
provides:
  - "DI seam: fetchAndBuildPayload(id, visibility) — visibility is a REQUIRED parameter with no default, so no call site can silently make no visibility decision on the service-role admin client"
  - "type StrategyVisibility = <Q>(query: Q) => Q — local seam type, structurally compatible with withPublishedOnly and with an owner-inclusive predicate partially applied to a session user id"
  - "buildFactsheetPayloadCached keeps a visibility-FREE signature with the withPublishedOnly LITERAL wired inside the unstable_cache callback (SC2-B type-level half: an owner predicate is unrepresentable there)"
  - "export const dynamic = 'force-dynamic' on the v2 factsheet route (T-148-07 response-cache pin)"
  - "Corrected cache-key documentation: the effective unstable_cache key is id-only; lane separation can never ride the cacheKey string"
  - "TODOS.md DEF-148-A — logged staleness finding"
affects: [148-03, 148-04, factsheet-v2, owner-lane]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Injected visibility predicate (DI seam) on an admin-client builder — required param, omission is a compile error"
    - "Visibility-free cached-wrapper signature as a type-level disclosure guard"

key-files:
  created:
    - .planning/phases/148-own-owner-factsheet-without-cache-disclosure/148-02-SUMMARY.md
  modified:
    - src/app/factsheet/[id]/v2/page.tsx
    - TODOS.md

key-decisions:
  - "visibility is a REQUIRED second parameter with no default — a defaulted param would let a future call site silently inherit published-only without deciding, on a client where the predicate is the only gate"
  - "buildFactsheetPayloadCached's signature was left byte-unchanged (single cacheKey: string) so an owner predicate is a type error there, not a lint finding"
  - "withPublishedOrOwner deliberately NOT imported in this plan — keeps page.smoothed-wiring.test.tsx's partial @/lib/visibility mock green; Pitfall 2 is 148-03's same-commit obligation"
  - "Took RESEARCH §3e/A3: added force-dynamic with the tearsheet precedent's reasoning copied, since comment parity is what makes the pin survive a refactor"
  - "Corrected TWO additional in-body copies of the same false cache-key claim beyond the plan's named :32-33 site (deviation, Rule 2)"
  - "No v6->v7 cache shape bump: keyParts, revalidate and tags are byte-unchanged, so the admin revalidateTag at strategy-review/route.ts:501 keeps working untouched (P15)"

patterns-established:
  - "Pattern 1: an admin-client (BYPASSRLS) query builder takes its visibility predicate as a required injected parameter, typed <Q>(q: Q) => Q, so predicate omission is a compile error"
  - "Pattern 2: a shared-cache wrapper proves viewer-independence structurally by refusing a visibility parameter and hard-coding the public predicate as a literal"

requirements-completed: [OWN-02]

# Metrics
duration: 22min
completed: 2026-08-05
---

# Phase 148 Plan 02: DI seam on the factsheet v2 payload builder Summary

**`fetchAndBuildPayload` now takes a required injected visibility predicate while the `unstable_cache` wrapper keeps a visibility-free signature with `withPublishedOnly` hard-coded as a literal — making an owner-visible payload structurally unrepresentable in the shared cache, plus a corrected cache-key comment and a `force-dynamic` pin.**

## Performance

- **Duration:** 22 min
- **Started:** 2026-08-05T11:02:41Z
- **Completed:** 2026-08-05T11:24:30Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- **The DI seam exists.** `fetchAndBuildPayload(id, visibility)` — the second parameter is required
  with no default, and `typecheck` exit 0 proves it propagated to the only call site (the cached
  wrapper). G2 (the gate the ROADMAP never named, sitting on the service-role admin client where
  the predicate is the *only* gate) is now parameterized rather than hard-wired published-only.
  148-03's owner lane becomes a wiring change, not a refactor.
- **SC2-B's type-level half is in place.** `buildFactsheetPayloadCached` still takes a single
  `cacheKey: string`; its declaration head contains neither `visibility` nor `StrategyVisibility`.
  The callback wires `fetchAndBuildPayload(id, withPublishedOnly)` — a literal identifier, never a
  variable — so a caller cannot pass an owner predicate into the shared cache entry, and cannot
  reach the literal to change it.
- **The false cache-key comment is gone.** The header now states the verified reality: the
  `${id}::${computedAt}` string is split and `computedAt` discarded, the effective key is id-only
  (`cb.toString()` + `["factsheet-v2-payload-v6", id]` + empty args), a fresh `computed_at` does
  NOT bust the cache, and — the load-bearing corollary — lane separation can never be expressed
  through the `cacheKey` string.
- **Route pinned dynamic** (`export const dynamic = "force-dynamic"`) with the tearsheet
  precedent's reasoning adapted, closing T-148-07 at the response-cache level before 148-03 makes
  the render session-varying.
- **DEF-148-A logged, not fixed** in the single backlog, per the founder blast-radius bar.

## Task Commits

Each task was committed atomically:

1. **Task 1: Parameterize the builder; literal-wire the cached wrapper; fix the comment; pin dynamic** - `61c283dd` (refactor)
2. **Task 2: Log the staleness finding to TODOS.md + lint battery** - `fce2c428` (docs)

## Files Created/Modified

- `src/app/factsheet/[id]/v2/page.tsx` — added `type StrategyVisibility`, `export const dynamic = "force-dynamic"`, the required `visibility` parameter on `fetchAndBuildPayload` (its single `withPublishedOnly(` wrapping call became `visibility(`), the literal wiring in the `unstable_cache` callback, and three corrected cache-key comments.
- `TODOS.md` — appended `DEF-148-A` under a new "Phase 148 (OWN)" section immediately before the DON'T FIX section, matching the Phase 147 entry format.

## Decisions Made

- **Required, not defaulted.** `visibility` has no default value. On a `createAdminClient()` query
  the injected predicate is the sole gate (T-148-02); a default would restore exactly the silent
  inheritance the seam exists to prevent.
- **The cached wrapper's signature is the guard.** Rather than adding a runtime assertion or a lint
  rule, the wrapper simply has no visibility parameter. An owner predicate there is a type error.
  148-04 will pin the literal with a source-scan gate; this plan supplies the type-level half.
- **`withPublishedOrOwner` deliberately absent.** Importing it here would break
  `page.smoothed-wiring.test.tsx`'s partial `@/lib/visibility` mock (its factory returns
  `undefined` for any unmocked export). That import and the mock update are 148-03's same-commit
  obligation. `grep -c withPublishedOrOwner page.tsx` == 0, verified.
- **No cache shape-version bump.** `["factsheet-v2-payload-v6", id]`, `revalidate: 3600` and the
  `["factsheet-v2", \`factsheet-v2:${id}\`]` tags are byte-unchanged (P15), so the single
  invalidator at `api/admin/strategy-review/route.ts:501` needed no coordinated edit.
- **`force-dynamic` taken** (RESEARCH §3e was a recommendation, not a mandate). Comment copied in
  spirit from `factsheet/[id]/tearsheet/page.tsx:17-25` per PATTERNS §1g, with the RESPONSE-level
  vs DATA-level distinction stated explicitly so the two cache concerns on this file are not
  conflated by a future reader.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical correctness] Corrected two additional stale copies of the same false cache-key claim**
- **Found during:** Task 1 (comment correction)
- **Issue:** The plan named only the `:32-33` header comment. Reading the full file surfaced two
  more comments inside `fetchAndBuildPayload` carrying the same falsehood or made stale by the
  refactor: (a) `:168-169`, "The F-4 `computation_status`-DONE gate rides the
  `${id}::${computedAt}` cache key (:344) because a re-derive stamps a fresh computed_at" — the
  identical false claim the header was being corrected for; (b) `:142`, "under the SAME
  `withPublishedOnly` visibility boundary" — accurate before the refactor, wrong after it, since
  the predicate is now injected. RESEARCH §3a states the rationale for treating this as
  correctness rather than prose: *"a comment that misdescribes a cache is how the next engineer
  ships a disclosure bug."* Leaving a second verbatim copy of the exact claim being corrected 90
  lines below the correction would have defeated the correction.
- **Fix:** (a) rewritten to state that the gate does not ride a computed_at-bearing key, that the
  effective key is id-only, that the gate is still correct but drains on TTL / publish tag, and to
  point at the corrected header; (b) "the SAME `withPublishedOnly` visibility boundary" →
  "the SAME injected `visibility` predicate boundary".
- **Files modified:** `src/app/factsheet/[id]/v2/page.tsx`
- **Verification:** `npm run typecheck` exit 0; phase-147 guards green (both edits are inside
  comments, which the guards strip before matching); `grep -c "withPublishedOrOwner"` still 0.
- **Committed in:** `61c283dd` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 missing critical correctness)
**Impact on plan:** Comment-only, zero behavioural surface, no scope creep. It closes the same
defect class the plan's own edit #3 opens — a partial correction that leaves the false claim
duplicated in the file is not a correction.

## Issues Encountered

- **Worktree base drift (PATTERNS P8/P9 Pitfall 7).** The worktree spawned at `f713cf97`, not the
  orchestrator-pinned `79b64a37`. The startup `<worktree_branch_check>` caught it and
  `git reset --hard` corrected the base before any edit. `node_modules` was absent and was
  symlinked from the main checkout (no package manager run).
- No other issues. No auth gates, no checkpoints, no architectural decisions.

## Verification Evidence

| Gate | Command | Result |
|------|---------|--------|
| Typecheck | `npm run typecheck` | exit 0 (proves the required param reached the only call site) |
| Plan's named tests | `npx vitest run "src/app/factsheet/[id]/v2/page.smoothed-wiring.test.tsx" src/__tests__/phase-147-series-resolution-guards.test.ts --no-file-parallelism` | 2 files / 14 tests passed |
| Wider factsheet suite | `npx vitest run "src/app/factsheet" src/__tests__/phase-147-series-resolution-guards.test.ts --no-file-parallelism` | 33 files / 286 tests passed |
| Lint (P12 `no-raw-published-predicate`, P13 `no-owner-or-on-admin-client`) | `npm run lint` | exit 0, **0 errors**, 1 pre-existing warning in an unrelated file (`allocations/widgets/performance/EquityChart.tsx:1119`, `react-hooks/exhaustive-deps` — out of scope, untouched) |
| Backlog entry | `grep -c "factsheet-v2-payload-v6" TODOS.md` | 2 (entry present) |

**Source assertions (all from the plan's acceptance criteria):**

| Assertion | Expected | Actual |
|-----------|----------|--------|
| `grep -c 'fetchAndBuildPayload(id, withPublishedOnly)'` | 1 | 1 |
| `grep -c 'visibility: StrategyVisibility'` | 1 | 1 |
| `grep -c 'export const dynamic'` | 1 | 1 |
| `grep -c '::${computedAt}\` so a new analytics row'` | 0 | 0 |
| `grep -c 'withPublishedOrOwner'` | 0 | 0 |
| `buildFactsheetPayloadCached` declaration head (NEGATIVE check — three-line format, so no positive substring exists) | contains neither `visibility` nor `StrategyVisibility` | confirmed: `function buildFactsheetPayloadCached(\n  cacheKey: string,\n): Promise<FactsheetPayload \| null> {` |
| `git diff --stat -- page.smoothed-wiring.test.tsx` | empty (test file UNMODIFIED) | empty — the file never appeared in `git status` |
| Diff surface | `page.tsx` + `TODOS.md` only | confirmed via `git status --short` at both commits |

## Threat Model Coverage

| Threat ID | Disposition | How this plan discharges it |
|-----------|-------------|-----------------------------|
| T-148-02 (EoP / disclosure via predicate omission on the admin client) | mitigated | `visibility` required, no default — omission is a compile error. `withPublishedOrOwner` is not importable at any current call site because it is not imported. |
| T-148-01 (owner-built payload served to anon from the shared cache) | partially mitigated (type-level half) | An owner predicate is unrepresentable in `buildFactsheetPayloadCached` — no parameter to pass it through, literal predicate inside the callback. Behavioural proof is 148-03; structural source-scan pin is 148-04. |
| T-148-07 (response-level caching of a session-varying render) | mitigated | `export const dynamic = "force-dynamic"` with the reasoning comment (parity with the tearsheet pin). |
| T-148-03 (generateMetadata / OG draft leakage) | untouched by design | G3 left byte-identical: published-only query, `"Strategy"` fallback, unconditional `robots: "noindex"`. |
| T-148-SC (package installs) | vacuous | Zero packages installed; `node_modules` symlinked from the main checkout. |

**No new threat surface introduced.** No new network endpoints, no new auth paths, no schema
changes, no file access. The one new export (`dynamic`) narrows caching behaviour.

## Known Stubs

None. No placeholder values, no unwired data sources, no TODO/FIXME markers added to source. The
one deferred item (`DEF-148-A`) is a pre-existing latent defect logged to the backlog by explicit
orchestrator ruling, not a stub introduced here.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

**Ready for 148-03 (owner lane).** The seam it consumes is in place and typechecked:

- Call `fetchAndBuildPayload(id, (q) => withPublishedOrOwner(q, user.id))` directly from Lane B —
  the two-arg helper partially applied to the session id satisfies `StrategyVisibility`.
- ⚠️ **Same-commit obligation (Pitfall 2):** the moment `page.tsx` imports `withPublishedOrOwner`,
  `page.smoothed-wiring.test.tsx:32-36`'s `vi.mock("@/lib/visibility", ...)` factory returns
  `undefined` for it → `TypeError` at call time. Add `withPublishedOrOwner: (qb: unknown) => qb` to
  that factory in the same commit as the import, not as a follow-up.
- ⚠️ Lane B must **not** construct a `cacheKey` string (RESEARCH §3c) and must **not** call
  `buildFactsheetPayloadCached` — both facts are now documented in-file at the wrapper.
- ⚠️ P1/P2 (phase-147) remain live on this file: any owner-lane probe select must stay narrow
  (`id / name / codename / disclosure_tier / status / user_id`) and must not name `daily_returns`
  without `returns_series`. The builder's `.select(...)` and the `resolveDailyReturnSeries(`
  literal were left byte-untouched and both guards are green.

**Ready for 148-04 (structural gate).** The literal to pin is
`fetchAndBuildPayload(id, withPublishedOnly)` inside the `unstable_cache` callback; note that the
file's comments now name `withPublishedOnly` several times, so the gate's `stripComments` step is
load-bearing exactly as PATTERNS §6 warns.

**No blockers.** `STATE.md`, `ROADMAP.md` and `FactsheetView.tsx` were not touched (orchestrator
and sibling-executor territory respectively).

## Self-Check: PASSED

- `src/app/factsheet/[id]/v2/page.tsx` — FOUND (modified, committed)
- `TODOS.md` — FOUND (modified, committed)
- `.planning/phases/148-own-owner-factsheet-without-cache-disclosure/148-02-SUMMARY.md` — FOUND (232 lines, not truncated)
- Commit `61c283dd` — FOUND in `git log`
- Commit `fce2c428` — FOUND in `git log`
- No deletions in either task commit (`git diff --diff-filter=D HEAD~1 HEAD` empty)
- No untracked files left behind (`git status --short` clean apart from this SUMMARY pre-commit)

---
*Phase: 148-own-owner-factsheet-without-cache-disclosure*
*Completed: 2026-08-05*
