---
phase: 154-wizcont-stale-wizard-continuity-no-stale-screens
plan: 02
subsystem: api
tags: [nextjs, route-handler, supabase, postgrest, wizard, rls, contract-test]

# Dependency graph
requires:
  - phase: 110
    provides: "ContributionWizardOverlay + its initialDraft={null} deferral — the defect site this plumbing unblocks"
  - phase: 94
    provides: "src/app/api/strategies/composite/members/route.ts — the GET-route conventions cloned here"
provides:
  - "src/lib/wizard/draft-query.ts — THE single-sourced latest-wizard-draft read (query + InitialDraft type + WizardDraftKind discriminator + draftMatchesSource rule)"
  - "GET /api/strategies/wizard-draft — the client-callable read of the caller's OWN latest draft"
  - "src/__tests__/wizard-draft-query-single-source.test.ts — machine enforcement of the one-shape rule"
  - "REQUIREMENTS.md WIZCONT-01 diagnosis corrected to match HEAD"
affects: [154-05, 154-06, wizard-resume, ContributionWizardOverlay, WizardClient]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "One query module imported by both a server component and a route handler (sync-progress.ts precedent)"
    - "Type-only imports keep a server-used helper client-importable so pure rules can be shared with client components"
    - "Frozen-set source scan (Scan B) beside a broad allow-list scan (Scan A)"

key-files:
  created:
    - src/lib/wizard/draft-query.ts
    - src/lib/wizard/draft-query.test.ts
    - src/app/api/strategies/wizard-draft/route.ts
    - src/app/api/strategies/wizard-draft/route.test.ts
    - src/__tests__/wizard-draft-query-single-source.test.ts
  modified:
    - src/app/(dashboard)/strategies/new/wizard/page.tsx
    - src/__tests__/no-store-coverage.test.ts
    - .planning/REQUIREMENTS.md
    - TODOS.md

key-decisions:
  - "Membership count uses the second head:true query, NOT the PostgREST embedded aggregate — appending strategy_keys(count) to the select would have broken the byte-identity of the moved query string, which is the plan's own acceptance criterion"
  - "readLatestWizardDraft RETURNS the draft-select error instead of throwing, so the SSR wizard page keeps its existing degrade-to-'start fresh' posture; only the route escalates it to a 500"
  - "An unknowable membership count (null count, or a failed probe) THROWS — the route turns that into a fail-closed 500 rather than offering a draft on a guessed branch"
  - "The contract test's allow-list carries three entries, each with a written reason; the pre-existing /strategies Resume-CTA reader is recorded as a residual rather than absorbed silently"
  - "WIZCONT-01 is NOT marked complete in REQUIREMENTS.md — this plan is plumbing; the overlay still passes initialDraft={null} until 154-05"

patterns-established:
  - "Grep-gate hygiene: a route's own docblock must not spell a symbol its acceptance grep forbids (the createAdminClient mention would have satisfied the gate while proving nothing)"
  - "Absence-is-not-a-value extended to the CSV-vs-composite discriminator: `?? 0` on a membership count would route a composite draft to the CSV step"

requirements-completed: []

# Metrics
duration: 22min
completed: 2026-08-12
---

# Phase 154 Plan 02: WIZCONT-01 draft-query plumbing Summary

**One wizard-draft query module now serves both entry paths — the SSR page and a new authenticated `GET /api/strategies/wizard-draft` — with the CSV-vs-composite discriminator resolved inside it and a source scan that reddens if a second shape appears.**

## Performance

- **Duration:** ~22 min
- **Started:** 2026-08-12T08:33:00Z
- **Completed:** 2026-08-12T08:55:00Z
- **Tasks:** 3
- **Files modified:** 9 (5 created, 4 modified)

## Accomplishments

- `src/lib/wizard/draft-query.ts` owns the query VERBATIM from `wizard/page.tsx:79-89`, the `InitialDraft` type, the `WizardDraftKind` discriminator and the `draftMatchesSource` rule 154-05 will apply on both paths.
- PATTERNS open item **A4 / Pitfall W-2 is resolved**: `api_key_id !== null` → `"api"`; otherwise a `strategy_keys` head-count > 0 → `"composite"`, 0 → `"csv"`, and an unknowable count throws. A composite draft can no longer be mistaken for a CSV draft.
- `GET /api/strategies/wizard-draft` gives the client-only overlay a sanctioned, RLS-bounded, secretless read of **its own** latest draft — no id parameter, no enumeration surface, no service-role client.
- The single-source rule is machine-enforced and **demonstrated falsifiable** (RED/GREEN transcript below), not merely asserted.
- REQUIREMENTS.md's WIZCONT-01 diagnosis now matches HEAD, with a dated correction note.

## Task Commits

1. **Task 1: Extract the single-sourced draft-query helper** — `2e1eca1e` (refactor)
2. **Task 2: GET /api/strategies/wizard-draft route** — `303eb1b2` (feat)
3. **Task 3: Single-source contract test + REQUIREMENTS.md correction** — `ed66be6e` (test)

## Files Created/Modified

- `src/lib/wizard/draft-query.ts` — the one query shape, the type, the kind discriminator, the branch-matching rule.
- `src/lib/wizard/draft-query.test.ts` — 17 cases: the composite-vs-csv boundary, the null-count throw, the 6-row `draftMatchesSource` truth table, and the query's columns/predicates/ordering/limit hand-typed (never imported from the module under test).
- `src/app/api/strategies/wizard-draft/route.ts` — `withAuth` + user-scoped client, field-by-field projection, `NO_STORE_HEADERS` on every arm, `{code:"UNKNOWN"}` 500s with the correlation id logged.
- `src/app/api/strategies/wizard-draft/route.test.ts` — 10 cases driving the REAL helper through a mocked postgrest client (the wiring, not the helper alone), including planted sentinel ciphertext, the 200-null arm, the fail-closed 500 and the per-arm cache header.
- `src/__tests__/wizard-draft-query-single-source.test.ts` — Scan A (broad tripwire) + Scan B (frozen latest-reader set) + a structural check that the by-id DELETE fence earns its allow-list entry.
- `src/app/(dashboard)/strategies/new/wizard/page.tsx` — imports the helper; the local `InitialDraft` interface and the inline query are gone. `grep -c 'eq("source", "wizard")'` → 0.
- `src/__tests__/no-store-coverage.test.ts` — new route added to the audited tenant-data allowlist (36 → 37).
- `.planning/REQUIREMENTS.md` — WIZCONT-01 entry-path correction (1308 → 1313 lines, surrounding entries intact).
- `TODOS.md` — the recorded residual (see Deviations #3).

## Falsifiability demonstration (required by Task 3, donor discipline `strategies-published-sole-writer-guard.test.ts:62-68`)

A throwaway `src/lib/wizard/__falsify-throwaway.ts` carrying the predicate pair plus the ordering + limit was added, the guard run, then the file removed and the guard re-run.

**RED (throwaway present):**

```
 × Scan A: no unsanctioned src/ file carries the source='wizard' + status='draft' pair 177ms
 × Scan B: the set of LATEST-wizard-draft readers is frozen 37ms
AssertionError: Unsanctioned wizard-draft query/queries: src/lib/wizard/__falsify-throwaway.ts. ...
+   "src/lib/wizard/__falsify-throwaway.ts",
AssertionError: The latest-wizard-draft read set changed. A NEW entry means a second shape of the read this phase single-sourced ...
+   "src/lib/wizard/__falsify-throwaway.ts",
 Test Files  1 failed (1)
      Tests  2 failed | 3 passed (5)
```

**GREEN (throwaway removed):**

```
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

Both scans name the offending file, so the failure is actionable rather than merely red.

## Decisions Made

1. **Second head-count query, not the PostgREST embedded aggregate.** The plan preferred `strategy_keys(count)` appended to the select, with the second query as fallback. Appending anything to that select string would violate the plan's own byte-identity acceptance criterion for the moved query — and the embed's behaviour against the live schema could not be verified from here. The fallback form is therefore the chosen form, mirroring the existing `compositeMemberCount` probe at `keys/sync/route.ts:547-580` (including its fail-closed posture on a null count).
2. **Asymmetric error handling inside the helper, deliberately.** The draft SELECT's error is *returned* (`{draft:null, kind:null, error}`) because the SSR page has always degraded to "start fresh" on a failed read; throwing would turn a transient `strategies` hiccup into a 500 on the whole wizard page — a regression, not a fix. The membership probe *throws*, because a draft whose branch is unknown must not be offered on a guessed branch. Both halves are documented in the helper and asserted in tests.
3. **WIZCONT-01 left unchecked in REQUIREMENTS.md.** The plan's frontmatter lists it, but the requirement is "re-entering continues where you left off", and the overlay still passes `initialDraft={null}` until 154-05. Marking it complete here would be a false green (Rule 12).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — Missing critical] The new route was not covered by the repo-wide no-store gate**

- **Found during:** Task 2
- **Issue:** `src/__tests__/no-store-coverage.test.ts` locks the audited tenant-data surface via an explicit **allowlist**, so a new route is not covered merely by existing. The route's body carries the caller's draft (name, description, AUM, capacity, linked `api_key_id`) — exactly the class the gate exists for, and the same class as the sibling `strategies/draft/[id]/route.ts` already on the list.
- **Fix:** Added `strategies/wizard-draft/route.ts` to `MUST_STAMP_NO_STORE` with a written rationale, and bumped the vacuity guard 36 → 37 (the Phase 150 precedent, which added three routes the same way).
- **Files modified:** `src/__tests__/no-store-coverage.test.ts`
- **Verification:** `npx vitest run src/__tests__/no-store-coverage.test.ts` green with the new count.
- **Committed in:** `303eb1b2`

**2. [Rule 1 — Bug in the deliverable] The route's own docblock defeated its acceptance grep**

- **Found during:** Task 2
- **Issue:** The docblock wrote "NEVER `createAdminClient()`", which made the plan's gate `grep -c "createAdminClient" route.ts` return **1**. Worse than a failed gate: had the criterion been "prose mentions it", a comment could satisfy a security gate while the code did the opposite.
- **Fix:** Reworded to "never the service-role admin client", with an inline note explaining that the symbol is named obliquely *because* the gate is a literal grep.
- **Files modified:** `src/app/api/strategies/wizard-draft/route.ts`
- **Verification:** `grep -c "createAdminClient"` → 0; `grep -c "readLatestWizardDraft"` → 2.
- **Committed in:** `303eb1b2`

**3. [Rule 3 — Blocking] The planned allow-list ("the helper only") was falsified by the tree**

- **Found during:** Task 3
- **Issue:** The plan (and 154-PATTERNS) assumed the `source='wizard'` + `status='draft'` pair existed only at `wizard/page.tsx`. A scan found **two more** production carriers: `src/app/api/strategies/draft/[id]/route.ts` (the DELETE handler's by-id ownership + TOCTOU fence — no ordering, no limit, materially not a latest-draft read) and `src/app/(dashboard)/strategies/page.tsx:41-49` (a genuine second **latest**-draft read, different columns — `review_note` drives the rejected-draft notice — different consumer: the Resume CTA on the strategies list). A helper-only allow-list would have been red at HEAD, and neither file can adopt the helper inside this plan's scope without widening `InitialDraft` for a page outside the phase.
- **Fix:** The guard now has two scans. **Scan A** is the broad tripwire with a 3-entry allow-list, each entry carrying a written reason. **Scan B** freezes the set of *latest*-draft readers to exactly `{draft-query.ts, strategies/page.tsx}`, so adding a name to Scan A's allow-list cannot quietly buy a second latest-read — a third one still reddens. A fourth test asserts structurally that the DELETE fence has no ordering/limit, so its allow-list entry is earned rather than trusted. The `/strategies` reader is recorded as a **residual** in `TODOS.md` (the project's single backlog), naming the drift it can still cause.
- **Files modified:** `src/__tests__/wizard-draft-query-single-source.test.ts`, `TODOS.md`
- **Verification:** Guard green at HEAD; RED/GREEN falsifiability transcript above.
- **Committed in:** `ed66be6e`

---

**Total deviations:** 3 auto-fixed (1 missing critical, 1 bug, 1 blocking)
**Impact on plan:** No scope creep. Deviation 3 makes the gate *stronger* than specified (a frozen set beside the allow-list) and surfaces a pre-existing divergence the plan did not know about rather than hiding it behind an allow-list entry.

## Issues Encountered

- **The worktree had no `node_modules`.** `npx vitest` / `tsc` / the AGENTS.md docs read were all impossible. Resolved by symlinking the main checkout's `node_modules` into the worktree (`/node_modules` is gitignored, so nothing was staged). The AGENTS.md gate was then discharged first-hand: `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` Version History confirms "The default caching for `GET` handlers was changed from static to dynamic" (v15.0.0-RC), so the new route needs no `export const dynamic`; `next@^16.2.11`, no `cacheComponents` in `next.config.ts`.

## Verification

- `npx vitest run src/lib/wizard src/app/api/strategies/wizard-draft src/__tests__/wizard-draft-query-single-source.test.ts --no-file-parallelism` → **8 files, 313 tests passed**
- `npx vitest run src/__tests__ src/lib/wizard "src/app/api/strategies/wizard-draft" --no-file-parallelism` → **103 passed | 17 skipped (1426 tests passed)**
- `npx vitest run "src/app/(dashboard)/strategies/new/wizard" --no-file-parallelism` → **29 files, 555 tests passed** (the SSR page's neighbours are unchanged by the refactor)
- `npx tsc --noEmit` → clean; `npx eslint` on every new/changed file → clean
- Grep gates: `eq("source", "wizard")` in `wizard/page.tsx` → **0**; `createAdminClient` in the new route → **0**; `readLatestWizardDraft` in the new route → **2**; `"branch chooser with no draft awareness"` in REQUIREMENTS.md → **0**; `ContributionWizardOverlay.tsx:146` → **1**; REQUIREMENTS.md 1308 → 1313 lines.

## Known Stubs

None. Nothing in this plan renders UI; `page.tsx` behaviour is unchanged and the new route returns real data on every arm.

## Threat Flags

None. The new surface is exactly the register's `browse → GET /api/strategies/wizard-draft` boundary, and every `mitigate` disposition is implemented and pinned:

| Threat | Disposition | Where it is enforced |
|--------|-------------|----------------------|
| T-154-02-A (enumeration) | mitigate | no id parameter; `withAuth`; `user_id = caller` predicate + owner RLS — pinned by the `eqCalls` assertion in `route.test.ts` |
| T-154-02-B (raw seam error) | mitigate | `{code:"UNKNOWN"}` + correlation-id log — pinned by three error-arm tests asserting `"boom"` never reaches the body |
| T-154-02-C (privilege) | mitigate | user-scoped `createClient()` only — grep gate returns 0 |
| T-154-02-D (limiter) | accept | rationale recorded in the route docblock, matching the `composite/members` precedent |

## User Setup Required

None.

## Next Phase Readiness

- **154-05 is unblocked.** It can `fetch("/api/strategies/wizard-draft")` from the overlay and apply `draftMatchesSource(kind, source)` to decide whether to offer the draft on the branch the user opened — both already exported and tested.
- ⚠️ **For 154-05:** the route answers `{draft, kind}` where `kind` may be `"composite"`. The overlay must not treat "not `api`" as "csv" — that is the exact A4 trap this helper exists to close.
- ⚠️ **Hydration discipline still applies** (`WizardClient.tsx:178-196`): the fetched draft arrives *after* mount, and `WizardClient`'s `useState` initializers read `initialDraft` once. 154-PATTERNS Pitfall W-1 gives the two conformant shapes (defer the mount until the read settles, or extend the `key`).
- **Residual carried forward:** `/strategies` still runs its own latest-draft read (logged in `TODOS.md`); Scan B will redden if anyone adds a third.

---
*Phase: 154-wizcont-stale-wizard-continuity-no-stale-screens*
*Completed: 2026-08-12*
