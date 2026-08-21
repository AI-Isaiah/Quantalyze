---
phase: 148-own-owner-factsheet-without-cache-disclosure
plan: 03
subsystem: api
tags: [nextjs, rsc, unstable_cache, supabase, rls, visibility-predicate, two-lane, vitest]

# Dependency graph
requires:
  - phase: 148-01
    provides: "FactsheetView({ payload, viewerNotice }) — the additive default-off render prop this plan's owner lane feeds"
  - phase: 148-02
    provides: "fetchAndBuildPayload(id, visibility) DI seam + visibility-free buildFactsheetPayloadCached + force-dynamic pin"
  - phase: 147-scen-01-real-series
    provides: "series-resolution guards (Layer A select-width scan + Layer B pin on page.tsx) — kept green; the Lane B probe select names neither daily_returns nor returns_series"
provides:
  - "Lane B on /factsheet/[id]/v2: published/cached lane FIRST, owner probe ONLY on its miss, payload built DIRECTLY (no cache read, no cache write)"
  - "ownerUid scope-bridge idiom: session id captured inside the miss branch and closed over at the payload site, so auth.getUser() never has to be hoisted above the published lane"
  - "page.owner-lane.test.tsx — the SC1/SC2-A/SC4 behaviour proofs with unstable_cache as a countable SPY and the REAL visibility predicates via importActual"
  - "page.smoothed-wiring.test.tsx @/lib/visibility factory extended with withPublishedOrOwner (same commit as the page import)"
  - "148-VALIDATION.md ledger rows SC-1 / SC-2A / SC-4 flipped to Observed with pasted failures"
affects: [148-04, factsheet-v2, owner-lane]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two-lane RSC: one lane cached and viewer-independent, the other uncached and viewer-scoped, selected on a published-probe miss"
    - "unstable_cache as a SPY (vi.fn((fn) => fn)) — identity behaviour preserved, invocation count assertable"
    - "vi.importActual + spread so the REAL query-shaping predicates run against a recording builder stub"

key-files:
  created:
    - "src/app/factsheet/[id]/v2/page.owner-lane.test.tsx"
    - ".planning/phases/148-own-owner-factsheet-without-cache-disclosure/148-03-SUMMARY.md"
  modified:
    - "src/app/factsheet/[id]/v2/page.tsx"
    - "src/app/factsheet/[id]/v2/page.smoothed-wiring.test.tsx"
    - ".planning/phases/148-own-owner-factsheet-without-cache-disclosure/148-VALIDATION.md"

key-decisions:
  - "Lane order LOCKED as published-first: auth.getUser() lives INSIDE the published-miss branch, so a public authed view pays zero extra queries; test 10 pins getUser call-count 0 on the published lane and reddens the 'hoist getUser to widen user's scope' repair"
  - "ownerUid (a widened `let`) is the scope bridge instead of hoisting getUser — the lambda closes over ownerUid!, never user.id"
  - "Test 8 asserts the non-owner authed path is rejected BY the probe (one .or filter recorded), not short-circuited before it — that is what makes 'same notFound as anon' non-vacuous"
  - "The Lane B probe select string is character-identical to Lane A's, asserted in-test, because signature feeds the payload-pending fallback on BOTH lanes"
  - "Acceptance greps re-run against comment-stripped source (the repo's own stripComments convention) — prose naming buildFactsheetPayloadCached is not a code reference"

patterns-established:
  - "Lane state is derived at the branch and threaded as a render prop; it never enters the payload the shared cache serves"
  - "A behaviour test for a cache-isolation property must count invocations, not stub behaviour — an identity stub makes the whole claim vacuous"

requirements-completed: [OWN-02]

# Metrics
duration: 18min
completed: 2026-08-05
---

# Phase 148 Plan 03: Owner lane on the v2 factsheet Summary

**An authenticated owner now renders their OWN unpublished factsheet through a second, uncached lane that fires only on a published-probe miss — the shared `unstable_cache` entry is invoked 0 times on that lane and 1 time on the public lane, proven by a spy with literal counts, with the session-keyed predicate and the uniform 404 pinned by three observed mutations.**

## Performance

- **Duration:** ~18 min
- **Started:** 2026-08-05T11:31:00Z
- **Completed:** 2026-08-05T11:49:00Z
- **Tasks:** 3
- **Files modified:** 4 (1 created, 3 modified)

## Accomplishments

- **OWN-02's behaviour half is live.** `page.tsx` now selects between two lanes.
  Lane A (published → `buildFactsheetPayloadCached`) is untouched and still runs first.
  Lane B fires only on its miss: `auth.getUser()` → `withPublishedOrOwner` probe on the
  **request-scoped** client → `fetchAndBuildPayload(id, (q) => withPublishedOrOwner(q, ownerUid!))`
  **directly**, and `FactsheetView` receives `viewerNotice="owner_unpublished"`.
- **The disclosure property is now falsifiable, not asserted.** `unstable_cache` is a spy;
  an owner render records **0** invocations, a public render exactly **1**, and the
  owner→anon sequence still 404s. The null-is-cached trap has its own test: a draft whose
  build returns `null` reaches the payload-pending placeholder with the count still **0**.
- **The lane ORDER is pinned by a literal.** Test 10 renders a *published* id with an authed
  session and asserts `getUserSpy` was called **0** times and zero `.or` filters were recorded.
  The obvious repair for `user`'s narrow scope — hoisting `auth.getUser()` above the published
  probe — reddens it. `ownerUid` exists so that repair is never needed.
- **The 404 is not an existence oracle, and that is proven both ways.** Test 7 pins that anon
  issues **no** probe; test 8 pins that a non-owner authed session **does** get probed, is
  rejected by it, and 404s identically. Asserting only "both 404" would have passed against a
  page that never probes at all.
- **Three mutations observed RED**, each reverted by re-editing; `git diff --quiet` on
  `page.tsx` exits 0 afterwards.

## Task Commits

1. **Task 1 (RED): `page.owner-lane.test.tsx`** — `167add4b` (test)
2. **Task 2 (GREEN): Lane B + smoothed-wiring mock, SAME COMMIT** — `d96ce41e` (feat)
3. **Task 3: falsifiability mutations + VALIDATION ledger** — `241d6da8` (docs)

### RED evidence (Task 1, before Lane B existed)

```
Tests  7 failed | 3 passed (10)

FAIL > SC1 > 1. owner + unpublished id → real payload and viewerNotice='owner_unpublished'
Error: notFound() called
 ❯ Module.FactsheetV2Page src/app/factsheet/[id]/v2/page.tsx:420:5

FAIL > SC4 > 8. non-owner authed + unpublished id → the owner probe RUNS, finds no row, and 404s identically
AssertionError: a non-owner session must be REJECTED BY the probe, not short-circuited
before it: expected [] to have a length of 1 but got +0
```

RED profile: tests **1, 3, 4, 5, 6, 8, 9** red; **2, 7, 10** green *by design*
(2 = the published lane, 7 = anon 404s at Lane A either way, 10 = the lane-order lock, which
must be green before and after). The plan predicted 1/4/5/6/8/9 red; test 3 (owner-lane trust
tier) reddened too, which is the same cause — it is an owner-lane render — so the observed set
is a benign superset of the prediction, not a divergence.

## Files Created/Modified

- `src/app/factsheet/[id]/v2/page.tsx` — added the `withPublishedOrOwner` + `captureToSentry`
  imports, the `let signature` / `let lane` / `let ownerUid` declarations, the Lane B block
  (session probe, owner-inclusive probe, fail-loud-but-non-oracular error arm, uniform
  `notFound()`), the two-lane payload ternary, and the `viewerNotice` prop on `FactsheetView`.
  Both existing 404 hints were rewritten to name **which lane** fell through (S6).
- `src/app/factsheet/[id]/v2/page.smoothed-wiring.test.tsx` — `@/lib/visibility` factory gains
  `withPublishedOrOwner: (qb: unknown) => qb`, with a comment stating why it must stay listed
  even though Lane B never runs in that file.
- `src/app/factsheet/[id]/v2/page.owner-lane.test.tsx` (new, 493 lines, 10 tests).
- `.planning/.../148-VALIDATION.md` — SC-1 / SC-2A / SC-4 ledger rows, the 148-03 rows of the
  Per-Task Verification Map, and two Wave 0 checkboxes.

## Decisions Made

See `key-decisions` in the frontmatter. The two load-bearing ones:

- **`ownerUid` instead of hoisting `getUser`.** The destructured `user` is scoped inside the
  miss branch and is out of scope at the payload site. The tempting fix is to hoist
  `auth.getUser()` above the `Promise.all` — which puts a session probe on *every* public
  request and inverts the locked lane order. The widened `let ownerUid` costs one line and
  keeps the order intact. Test 10 is the enforcement, and the forbidden repair is stated in
  a code comment at the branch so the next reader does not have to rediscover it.
- **Test 8 asserts the probe RAN.** "Non-owner and anon both 404" is satisfied by a page that
  never probes at all — i.e. by the pre-Lane-B code. Requiring exactly one recorded `.or`
  filter *and* the right predicate string is what makes the uniform-404 claim mean
  "rejected by the gate" rather than "never gated".

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — blocking verification issue] Acceptance greps re-run against comment-stripped source**

- **Found during:** Task 2 verification
- **Issue:** The plan's criteria are `grep -c "buildFactsheetPayloadCached" page.tsx == 2` and
  `grep -n "searchParams" returns nothing`. Raw counts were **4** and **1**. Inspection showed
  every extra occurrence is inside a **comment**: `:61` is the cache-key header 148-02 wrote,
  `:493` is this plan's own "⛔ Lane B cannot route through the cached wrapper" note, and the
  single `searchParams` is the in-code prohibition *"NEVER params / searchParams"*. The raw
  criterion was unsatisfiable the moment 148-02 landed its header comment, and satisfying it
  literally would have meant deleting the very warnings the phase exists to leave behind.
- **Fix:** Counted against comment-stripped source using the repo's own `stripComments`
  convention (PATTERNS §6 / `phase-147-series-resolution-guards.test.ts`) — the same strip the
  148-04 structural gate will apply. Code-only: `buildFactsheetPayloadCached` **2**,
  `ownerUid` **3**, `searchParams` **0**, `auth.getUser` **1**. The plan's *intent* (Lane B
  never references the cached wrapper; no param ever reaches the predicate) is met exactly.
- **Files modified:** none — verification method only.
- **Committed in:** n/a (no source change).

---

**Total deviations:** 1 (verification-method correction; zero source impact)
**Impact on plan:** None on behaviour or diff surface.

## Issues Encountered

- **Worktree base drift (PATTERNS P8/P9, Pitfall 7 — same as 148-02).** The worktree spawned at
  `f713cf97`; the orchestrator-pinned base was `3b26dbb2`. The startup `<worktree_branch_check>`
  caught it and `git reset --hard` corrected it before any edit. `node_modules` was absent and
  was symlinked from the main checkout (no package manager run).
- No auth gates, no checkpoints, no architectural decisions.

## Verification Evidence

| Gate | Command | Result |
|------|---------|--------|
| Plan's Task 1 verify (RED) | `npx vitest run "…/page.owner-lane.test.tsx" --no-file-parallelism; test $? -ne 0` | 7 failed \| 3 passed — non-zero exit, RED confirmed |
| Plan's Task 2 verify | `npx vitest run "…/page.owner-lane.test.tsx" "…/page.smoothed-wiring.test.tsx" src/__tests__/phase-147-series-resolution-guards.test.ts --no-file-parallelism` | 3 files / **24 tests passed** |
| Wider factsheet suite | `npx vitest run "src/app/factsheet" --no-file-parallelism` | 34 files / **288 tests passed** |
| GUARD-02 (PERMANENT, unmodified) | included in the post-revert battery | green — 4 files / 30 tests |
| Types | `npm run typecheck` | exit 0 |
| Lint (P12 `no-raw-published-predicate`, P13 `no-owner-or-on-admin-client`) | `npm run lint` | **0 errors**, 1 pre-existing warning in the unrelated `allocations/widgets/performance/EquityChart.tsx` (untouched) |
| Plan's Task 3 verify | `npx vitest run …owner-lane… …smoothed-wiring… && git diff --quiet -- "…/page.tsx"` | tests green; `git diff --quiet` **exit 0** |

**Source assertions (comment-stripped, per the deviation above):**

| Assertion | Expected | Actual |
|-----------|----------|--------|
| `buildFactsheetPayloadCached` code references | 2 (declaration + single Lane A call) | 2 |
| `ownerUid` code references | ≥ 3 | 3 (declaration, miss-branch assignment, lambda closure) |
| lambda 2nd arg | `ownerUid!`, never `user.id` | `fetchAndBuildPayload(id, (q) => withPublishedOrOwner(q, ownerUid!))` |
| `searchParams` in code | 0 | 0 (single occurrence is the prohibition comment) |
| `auth.getUser` call sites | 1, inside the miss branch | 1 (`page.tsx:427`, inside `if (signRes.error \|\| !signature)`) |
| smoothed-wiring mock extended in the SAME commit as the page import | yes | `d96ce41e` contains both files |
| Test file harness | `vi.fn((fn` present, `importActual` present, admin `or:` present | 2 / 3 / 2 occurrences |

**Lane A vs Lane B select strings (character-identical, as required):**

```
page.tsx:402  .select("id, name, codename, disclosure_tier, strategy_analytics ( computed_at )")   ← Lane A
page.tsx:454  .select("id, name, codename, disclosure_tier, strategy_analytics ( computed_at )")   ← Lane B
```

Asserted in-test too (test 9): `expect(STATE.observed.requestSelects).toEqual([SIGNATURE_SELECT, SIGNATURE_SELECT])`.

## Falsifiability (Task 3 — all three OBSERVED, none asserted)

| SC | Mutation | Observed |
|----|----------|----------|
| SC-1 | Lane B probe `withPublishedOrOwner(q, user.id)` → `withPublishedOnly(q)` | `7 failed \| 3 passed` — tests 1 & 9 red (`Error: notFound() called ❯ Module.FactsheetV2Page page.tsx`); the owner is 404'd by their own draft and no `.or` is recorded |
| SC-2A | owner payload arm → `buildFactsheetPayloadCached(\`${id}::${computedAt}\`)` | `3 failed \| 7 passed` — **exactly** tests 4/5/6, zero collateral. `expected "vi.fn()" to be called +0 times, but got 1 times`, incl. the null-is-cached test 6 |
| SC-4 | probe 2nd arg `user.id` → `id` | `2 failed \| 8 passed` — test 9: `expected 'status.eq.published,user_id.eq.444444…' to be 'status.eq.published,user_id.eq.111111…'` — the mutated predicate names the **strategy id**, not the session uuid |

Each was reverted by re-editing the mutated line (never `git checkout --`); `page.tsx` is
byte-identical to `d96ce41e`. The SC-2A output is also recorded in the test file's
neuter-check header, which is where the repo convention puts it.

## Threat Model Coverage

| Threat ID | Disposition | How this plan discharges it |
|-----------|-------------|-----------------------------|
| T-148-01 (owner-populated cache entry served to anon) | **mitigated (behaviour layer)** | Lane B calls `fetchAndBuildPayload` directly. Spy counts: 0 on owner, 1 on public, 0 on the draft-null case; the owner→anon sequence test proves the anon request still 404s. Structural layer is 148-04. |
| T-148-02 (wrong predicate on the BYPASSRLS admin builder) | **mitigated** | Probe-first ordering on the RLS request client (S1) makes the admin-side predicate the SECOND gate; the injected lambda closes over the session-derived `ownerUid`; test 9 pins the predicate literal. ⚠️ As PATTERNS P13 states, the `no-owner-or-on-admin-client` rule cannot catch `withPublishedOrOwner(createAdminClient()…)` — the probe-first ordering is the control, and it is now stated in-code at the branch. |
| T-148-04 (existence oracle via differentiated 404) | **mitigated** | Anon (test 7), non-owner authed (test 8) and missing all reach the same `notFound()`. Probe errors log + `captureToSentry` and then still 404 — the status never varies with the error. |
| T-148-03 (draft leakage via generateMetadata / OG) | **untouched by design** | `generateMetadata` is byte-identical: published-only query, `"Strategy"` fallback, unconditional `robots: "noindex"`. Structural pin is 148-04. |
| T-148-07 (response-level caching of a session-varying render) | **mitigated (inherited)** | `export const dynamic = "force-dynamic"` landed in 148-02 and is untouched — it now protects a render that genuinely varies by session. |
| T-148-SC (package installs) | vacuous | Zero packages installed; `node_modules` symlinked from the main checkout. |

## Threat Flags

None. No new endpoint, no schema change, no file access, no writes of any kind
(`grep` for `.insert(` / `.update(` / `.upsert(` additions in the diff: none). The one new
auth path — `supabase.auth.getUser()` on the published-miss branch — is server-side JWT
validation on the request-scoped client, is covered by tests 7/8/9/10, and is exactly the
surface the phase's threat register anticipated.

## Known Stubs

None. No placeholders, no TODO/FIXME added to source, no unwired data.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

**Ready for 148-04 (structural gate).** Notes it will need:

- The literal to pin inside the `unstable_cache` callback is still
  `fetchAndBuildPayload(id, withPublishedOnly)` — unchanged by this plan.
- ⚠️ `page.tsx` now names `buildFactsheetPayloadCached` **twice in comments** (`:61`, `:493`)
  and `withPublishedOrOwner` in prose as well as code. The gate's `stripComments` step is
  therefore load-bearing exactly as PATTERNS §6 warns — a naive `toContain` scan will
  self-invalidate. Code-only counts today: `buildFactsheetPayloadCached` 2,
  `withPublishedOrOwner` 3, `unstable_cache(` 1.
- The anti-vacuity assertion should confirm the extractor genuinely sees the ONE
  `unstable_cache` occurrence, per the 147 precedent.
- SC-2B-a's expected asymmetry is real and worth recording when 148-04 runs it: dropping the
  predicate inside the cached callback (`fetchAndBuildPayload(id, (q) => q)`) does **not**
  redden `page.owner-lane.test.tsx`, because the admin stub does not filter. That is precisely
  why the structural layer exists.

**No blockers.** `STATE.md`, `ROADMAP.md`, `FactsheetView.tsx` and `TODOS.md` were not touched
(orchestrator / sibling-plan territory).

## Self-Check: PASSED

- `src/app/factsheet/[id]/v2/page.owner-lane.test.tsx` — FOUND (493 lines)
- `src/app/factsheet/[id]/v2/page.tsx` — FOUND (modified)
- `src/app/factsheet/[id]/v2/page.smoothed-wiring.test.tsx` — FOUND (modified)
- `.planning/phases/148-own-owner-factsheet-without-cache-disclosure/148-VALIDATION.md` — FOUND (modified)
- Commit `167add4b` — FOUND in `git log`
- Commit `d96ce41e` — FOUND in `git log`
- Commit `241d6da8` — FOUND in `git log`
- Zero file deletions across all three commits (`git diff --diff-filter=D 3b26dbb2..HEAD` empty)
- No untracked files left behind (`git status --short` clean apart from this SUMMARY pre-commit)

---
*Phase: 148-own-owner-factsheet-without-cache-disclosure*
*Completed: 2026-08-05*
