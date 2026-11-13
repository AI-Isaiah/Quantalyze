---
phase: 199-managerhome-each-role-lands-on-its-own-page-and-a-manager-has
plan: 18
subsystem: ui
tags: [degrade-warnings, registry, factsheet, tearsheet, share-route, recipient-privacy, scan-ledger, sc-4, vitest]
requires:
  - phase: 199-03
    provides: "the degrade-warning registry contract, DegradeLine and the scan ledger"
  - phase: 199-16
    provides: "the strategies list surface, ownerRemedyAction, the `actions` list on an entry"
provides:
  - "The factsheet's degraded-members line by audience: the owner view keeps its member names and gains the contact form; the recipient, public and tearsheet views name no key, venue or count and ask the sharer (T-199-22)"
  - "Owner state lines for failed and stalled computations open `The last computation, on {day}, ...`; without a usable day they are the shipped sentence and register as read_failure; ANALYTICS_UPDATING_LINE stays in_progress, unchanged"
  - "KCS10_PUBLIC_SENTENCE and SHARE_CARD_COPY registered as class recipient (shipped wording)"
  - "The scan walks src/app/factsheet and src/app/factsheet-share whole, and a test fails when any of the four D-04 surfaces has no scanned file (SC-4 final)"
  - "TODOS entry [199-DEPARTED-HISTORY-NAME-THE-KEY] for the analytics-service change that would let DepartedHistoryNote name the departed key (CD-09)"
affects: []
requirements-completed: [ROUTE-11]
actuals:
  tokens: 60000
  tasks: 2
  commits: 4
plan_head_before: 299032e2722a85ae8eb5ae806726a0e2e0e72f96
plan_head_after: 824863b2f4b74b78a3b39e135b6e76b8360e3af3
status: complete
completed: 2026-11-10
key-files:
  created: []
  modified:
    - "src/app/factsheet/[id]/v2/FactsheetView.tsx"
    - "src/app/factsheet/[id]/v2/page.tsx"
    - "src/app/factsheet/[id]/tearsheet/page.tsx"
    - "src/app/factsheet-share/[token]/page.tsx"
    - src/lib/degrade-warnings.ts
    - src/lib/degrade-warnings.test.tsx
    - src/lib/status-surface-copy.ts
    - src/lib/status-surface-copy.test.ts
    - src/__tests__/degrade-warning-scan.test.ts
    - TODOS.md
decisions:
  - "The degraded-members audience is derived inside FactsheetBody from render props the lane already decides (`ownerShare` presence, or the default full layout the two allocator mounts use), never from the payload; every other mount fails closed to the recipient wording"
  - "The recipient line discloses neither the member key, the venue nor how many members were excluded"
  - "Two vocabulary ids added, quoting the UI-SPEC row and the shipped KCS11-B closing sentence: A-ASK-SHARER and A-ASK-SHARER-RETRY"
  - "The owner pending page keeps its two paragraphs and its link rendering (the remedy is unchanged); the section carries the id of the matching entry and a test pins the printed words equal to the registry's"
---

# Phase 199 Plan 18: the factsheet's warnings, registered, and the four-surface scan closed Summary

The factsheet, tearsheet and share route now say what to do and never leak an owner's key to a recipient, the failed and stalled owner lines name their day, and one scan accounts for all four D-04 surfaces.

## Open decisions (recommendation given; the plan's defaults were taken)

1. **The public pending sentence now ends on an action.** UI-SPEC "Factsheet" row 3 says to add an action where one is missing, and the registry judge requires one for a `recipient` entry, so `factsheet.public-pending` prints the shipped KCS10 sentence unchanged, then `Check with the person who shared this link before trying again.` (the KCS11-B closing sentence, quoted). A visitor who did not receive a link has no sharer to ask. Recommendation: keep it (it is the UI-SPEC target and is true for anyone who followed a shared URL); if the founder wants a different public action, it is one vocabulary id and one entry. Touching it moved five test pins (see deviations).
2. **Finished, never-started and unreadable owner lines are registered as `read_failure` with no day** (`factsheet.owner-state-undated`), together with failed or stalled lines whose day could not be read. The plan only dated the failed and stalled arms. `KCS09-FINISHED-ANALYTICS-FAILED` ("Analytics couldn't be computed from this data") names no day and is a degrade in spirit; the plan did not ask for a day there, so none was added. Recommendation: a later plan may date it from the same job.

## What was built

**Task 1 (tracer), RED `cb1d0cf24`, GREEN `e1ad8e049`.**

- `factsheet.degraded-members` (degrade, scope key, A-CONTACT-CHECK): the shipped sentence with its member names (`Key {seq} ({venue})`, comma-joined as before, plain text so the existing pins still match) plus the contact form. `factsheet.degraded-members-recipient` (class recipient, scope recipient, A-ASK-SHARER): `Part of this track record could not be included -- some of its data is excluded.` and the ask-the-sharer action. Both render through `DegradeLine` inside `KpiStrip`.
- `FactsheetBody` derives `ownerView = !recipientShare && (ownerShare !== undefined || layout === "full")` and passes it to `KpiStrip`. The owner lane (`ownerShare` present) and the allocator mounts (default layout) see the named line; the public factsheet, the tearsheet and the share-link recipient (all `layout="document"` with no `ownerShare`) see the recipient line.
- Marker-only entries: `factsheet.usd-view-read-failed` (read_failure, shipped wait `It is retried within the hour.` as `shippedAction`), `factsheet.usd-view-no-priced-day` (empty), `factsheet.analytics-updating` (in_progress). `ANALYTICS_UPDATING_LINE` is untouched.
- The scan walks `src/app/factsheet` and `src/app/factsheet-share` whole. A Sentry `area` tag that looks like a registry id (`sentryArea: "factsheet.view"`, `"factsheet.advanced"`) is blanked before ids are read, with a meta test that the same string elsewhere still counts.

**Task 2, RED `4ff3f9dfc`, GREEN `824863b2f`.**

- `ownerStateLine(state, build, day)`: the six failed and stalled lines open `The last computation, on {day}, ...` (the stalled line reads `The last computation, on {day}, for this composite strategy stopped reporting progress more than 12 minutes ago.`); id and tone unchanged; an absent or malformed day gives the shipped sentence. `lastAttemptDay` (claimed_at, else created_at, UTC) and `ownerStateIsDated` are exported helpers.
- `readOwnerPendingStatus` returns `jobDay` from the same `selectFactsheetJob` selection `deriveComputeState` used. The owner pending section carries `factsheet.owner-state-working | -dated | -undated` (a literal table keyed by `ownerStateKind`), and the page test pins the printed words (state line, a space, the remedy) equal to the registry entry's words for a failed row, a stalled composite, an unparseable stamp, a failed read, a running row and a finished row.
- `factsheet.public-pending` (recipient) renders on the factsheet page and on the tearsheet through `DegradeLine`; `factsheet.share-card-in-progress` and `-not-available` (recipient, marker-only on a wrapper div around the shipped `EmptyStateCard`) are pinned to the card's own body (the in-progress wait and the KCS11-B closing sentence).
- The scan: `SCANNED_SURFACES` is now all four surfaces; `surfacesWithoutScannedFile(walkedSources(), registry)` fails when a surface has no walked file naming one of its entries. It reads the walked set, not the ledger, so removing a root bites.
- `TODOS.md`: `[199-DEPARTED-HISTORY-NAME-THE-KEY]` (dated, owner and trigger, mypy strict and pytest from `analytics-service/` named).

## Inventory, re-measured on the rebased tree (plan's command, comments included)

```
src/app/factsheet/[id]/v2/FactsheetView.tsx:1187:  <p role="status" className="text-caption text-text-secondary">     (basis caption)
src/app/factsheet/[id]/v2/FactsheetView.tsx:2348:  role="status"                                                       (what-if leverage caption)
src/app/factsheet/[id]/v2/FactsheetView.tsx:2557:  degradedMembers                                                      (degraded-members line)
src/app/factsheet/[id]/v2/FactsheetView.tsx:3116:  text-warning                                                        (USD-view note)
src/app/factsheet/[id]/v2/FactsheetView.tsx:3120:  <span role="status" ... sr-only>                                  (unit-switch announcement)
src/app/factsheet/[id]/v2/FactsheetView.tsx:3176:  role="status"                                                       (leverage clamp message)
src/app/factsheet/[id]/v2/HeatmapPanels.tsx:617:  role="status"                                                       (hover tooltip)
src/app/factsheet/[id]/v2/loading.tsx:65:  role="status"                                                            (sr-only loading)
src/app/factsheet/[id]/v2/page.tsx:78:  amber: "text-warning"                                                       (state line tone map)
```

Tearsheet and share-route files: 0 hits (their warnings are the KCS10 sentence and `SHARE_CARD_COPY`, found by the constants, and registered). The scan's own comment-stripped counts: FactsheetView 7 (two are the new `text-warning` classes on the degraded-members line), HeatmapPanels 1, loading 1, v2 page 1.

| File | Item | Class | Decision |
|---|---|---|---|
| FactsheetView.tsx | degraded members | degrade / recipient | registered, DegradeLine |
| FactsheetView.tsx | USD-view notes | read_failure / empty | registered, marker |
| FactsheetView.tsx | updating line | in_progress | registered, marker, unchanged |
| FactsheetView.tsx | basis caption, what-if caption, unit announcement, leverage clamp | not warnings | ledgered (information, an sr-only live region, feedback on the viewer's own input) |
| HeatmapPanels.tsx, loading.tsx | tooltip, sr-only loading | not warnings | ledgered |
| v2/page.tsx | owner state section, public pending sentence | degrade / read_failure / in_progress / recipient | registered |
| tearsheet/page.tsx | public pending sentence | recipient | registered |
| factsheet-share/[token]/page.tsx | pending card, two arms | recipient | registered, wrapper marker |

## Verification

All commands in the worktree.

- `node scripts/verify-plan-anchors.mjs <plan>`: OK, 7 claims, before the first edit's gate and at the tracer gate.
- RED seen first: Task 1 registry 7 failed, scan 2 failed, view 5 failed; Task 2 the new status-surface-copy cases failed (no `day` parameter yet) and the owner-state page file went 16 failed.
- Tracer gate (auto mode, re-run end to end): `npx vitest run src/lib/degrade-warnings.test.tsx src/__tests__/degrade-warning-scan.test.ts src/app/factsheet src/app/factsheet-share`: 129 files, 1846 passed. Tracer verified end-to-end, expanding.
- Task 2 gate: `npx vitest run src/lib/degrade-warnings.test.tsx src/__tests__/degrade-warning-scan.test.ts src/lib/status-surface-copy.test.ts src/app/factsheet src/app/factsheet-share src/app/api/factsheet`: 132 files, 2025 passed.
- Wider: `npx vitest run "src/app/(dashboard)/strategies" "src/app/(dashboard)/allocations" src/components src/lib`: 691 files, 14376 passed, 23 skipped, 2 failed: `src/lib/factsheet/compute.conventions.test.ts` fixture B and fixture C (the pre-existing frozen-snapshot failures; not touched, not fixed).
- Repo-wide census `npx vitest run src/__tests__`: 180 files passed, 18 skipped (273 tests skipped: the live-DB and RLS suites, no database here), 4866 passed. Same files as the base (180 / 18); no new failure (4862 to 4866 passed, the four new tests).
- `npx tsc --noEmit -p .`: exit 0 (run after Task 1 and after Task 2).
- Lint, as its parts: `npx eslint --no-cache` on every touched `.ts`/`.tsx` file (source and test): exit 0; `tsx scripts/check-admin-route-manifest.ts`, `check-route-contract.ts`, `check-planning-hygiene.ts`, `check-canonical-domain.ts`: all exit 0. **Not run:** `npm run lint`'s full-tree `eslint --cache src/` (the brief forbids it) and the plan's full `npm run test` (replaced by the targeted and `src/__tests__` runs above, which cover every file this plan touches and everything importing the changed libs).
- Acceptance greps: `grep -a -c '"factsheet\.' src/lib/degrade-warnings.ts` prints 11; `grep -a -c "DepartedHistoryNote" TODOS.md` prints 2 (HEAD 0); `grep -a -c "NOT_D04_SUBTREES" src/__tests__/degrade-warning-scan.test.ts` printed 8 at the precondition.
- Left to CI: nothing in `supabase/`, `analytics-service/` or SQL was touched, so no SQL gate, mypy or local-stack lane applies. The full-tree eslint, the e2e lanes (plan 17 owns the e2e specs) and the `frontend` aggregator ran nowhere locally.

gc-199-18-neuter: FactsheetView.tsx on a byte copy, the recipient branch's segments extended with the excluded members' `Key {seq} ({venue})` labels: 3 cases went RED (the share-link recipient, the public and tearsheet reader, and the several-members case); restored from the copy, `cmp` identical, 8/8 GREEN.

gc-199-18-neuter: degrade-warning-scan.test.ts on a byte copy, the factsheet roots removed from `WALK_ROOTS`: the four-surface assertion went RED (`expected [ 'factsheet' ] to deeply equal []`) and the factsheet-roots-walked case went RED (`src/app/factsheet/[id]/v2/page.tsx is walked`); restored, `cmp` identical, 23/23 GREEN.

gc-199-18-neuter: status-surface-copy.ts on a byte copy, the day prefix disabled (`false &&` on the dated branch): 18 cases went RED across the copy tests, the registry and the owner pending page; restored, `cmp` identical.

gc-199-18-gates: test=green tsc=clean lint=clean (test = the targeted and `src/__tests__` runs above, with only the two pre-existing `compute.conventions` failures in the wider run; lint = scoped eslint on touched files plus the four non-eslint lint scripts; the full-tree eslint and the full `npm run test` were not run, see above)

## Deviations from Plan

**1. [Rule 3 - decision] The audience of the degraded-members line comes from `layout`/`ownerShare`, not a new prop.** No prop says "owner view" today; `ownerShare` is the owner lane's documented presence predicate and the allocator mounts are the only callers using the default full layout. A new explicit prop would have meant editing the two allocator mounts (outside `files_modified`) and would default to the owner wording; this derivation fails closed. Recorded in the code and here; if a fourth mount appears, it takes the recipient wording until it opts in.

**2. [Rule 3] Test pins outside `files_modified` moved with the public pending sentence.** `page.public-cache-key.test.tsx`, `page.composite-read-error.test.tsx` and `page.owner-compute-state.test.tsx` (exact `textContent` pins) and `tearsheet/page.test.tsx` (`getByText`) now expect the sentence plus its action; `page.stale-analytics.test.tsx` reads a `DegradeLine` element's words through `degradePlainText` in its `collectText` helper (the words ride the `segments` prop, not children). `factsheet-share/[token]/page.test.tsx` gained the marker assertions. The wording pins are stricter, not looser.

**3. [Rule 3] `lastAttemptDay` lives in `status-surface-copy.ts`.** The strategies list keeps its own module-private `jobDayOf` (plan 16); the two are the same five lines. Left as is to keep this plan off `strategies/page.tsx`; unifying them is a cleanup.

**4. [Rule 3] The scan ignores `sentryArea:` values.** Two Sentry area tags under the factsheet tree (`factsheet.view`, `factsheet.advanced`) match the registry's surface-prefixed id shape and would have forced ledger rows for strings that are not warnings. A pinned, tested blanking of exactly that property is the narrowest fix; nothing else is exempt.

## Known Stubs

None.

## Threat Flags

None. T-199-22 (recipient and public notices naming an owner key) is mitigated and has neuter evidence above; no new endpoint, auth path or schema surface was added.

## Self-Check: PASSED

- Commits found on the branch: `cb1d0cf24`, `e1ad8e049`, `4ff3f9dfc`, `824863b2f`.
- `git status --short` clean before this file was written; backups and the scratch script under the scratchpad were deleted.
- STATE.md and ROADMAP.md untouched.
