---
phase: 192-publictruth-the-public-site-and-the-demo-tell-a-visitor-one
plan: 10
subsystem: testing
tags: [census, public-truth, demo-retirement, ship-gate, todos]
status: complete

requires:
  - phase: 192-publictruth
    provides: "Plans 02 to 09 and 11 to 17 made the public pages tell one story and retired the public demo (D-11)"
provides:
  - "src/__tests__/public-truth-census.test.tsx: a source census (13 banned phrases, raw id, retired-route links, retired directories, anti-vacuity) and a rendered census of home, /security, /for-quants and Terms"
  - "The D-11 ship gate read and quoted: nothing of the public demo survives"
  - "TODOS.md: four 192 entries, the 193 payload-producer entry, and the closures the retirement resolved"
affects: [phase 192 verification, Phase 193 QUIETVIEW, Phase 200 MANAGERKEYS]

actuals:
  tokens: 14000
  tasks: 3
  commits: 3
plan_head_before: a32c711877e781243f5dd61d2c2c5b938eb47db3
plan_head_after: b3c08dea66714a523e975b98469ebe2a3a1d9fad

tech-stack:
  added: []
  patterns:
    - "Census on comment-stripped source with two anti-vacuity file lists; every matcher self-tested in both polarities; each gate shown RED on a planted regression and restored from a byte backup"

key-files:
  created:
    - src/__tests__/public-truth-census.test.tsx
  modified:
    - TODOS.md

key-decisions:
  - "The census is test-only: no production file changed, so the TDD cycle is RED-by-mutation of the surface, not a feat commit"
  - "src/components/landing is not source-scanned and not rendered by any page, so its false line is booked (192-ORPHANED-LANDING-VERIFY) rather than hidden"

requirements-completed: [TRUST-01, ROUTE-03]

duration: 12 min
completed: 2026-11-07
---

# Phase 192 Plan 10: Public-truth census, ship gate and bookings Summary

A census that fails on any old claim or retired link across the public tree, the security packet and every app link, with the D-11 ship gate read first and every found-but-unfixed item routed in TODOS.md.

## Ship gate

Read before any edit. Every check passed, so the census was written.

`192-EVIDENCE.md` lines, quoted verbatim:

```
D-08 repair: not needed (demo retired, founder 2026-11-07)
D-11 /demo: build-route=absent
D-11 /demo anon answer: matches control
D-11 /api/demo: build-route=absent
D-11 /api/demo anon answer: matches control
```

`grep -cE '^D-08 repair: '` printed `1`. The dated PROD reading `D-10 unresolvable labels: 9` stays in the evidence and nothing reads it as a gate.

| Check | Result |
|-------|--------|
| `src/app/(marketing)/demo` absent | pass |
| `src/app/api/demo` absent | pass |
| `"/demo"` or `"/api/demo"` literal in `src/proxy.ts` | none (grep rc=1) |
| `route: "/demo"` in the route-contract manifest | none (grep rc=1) |
| SUMMARYs for 192-11 to 192-17 | all seven exist |
| 192-06-PLAN.md and 192-08-PLAN.md `status: superseded` | both carry it |
| 192-06-DEFERRED.md and 192-08-DEFERRED.md | both exist |
| `node scripts/verify-plan-anchors.mjs` on this plan | `OK: 1 plan file(s), no stale claims` (6 claims) |

## What was built

### Task 1 (tracer): source census, commit `6d1543472`

`src/__tests__/public-truth-census.test.tsx`, describe "public-truth source census (192)", 19 cases:

- one case per banned phrase (13: the UI-SPEC's ten strings, plus "Free to list", "accept an intro" and "Real product on production"), one for `RAW_ID_PATTERN`, one for `RETIRED_ROUTE_LINK` over `src/app` and `src/components`, one for `RETIRED_DIRS`;
- two anti-vacuity cases (`CENSUS_FILES` inside the banned-phrase population, `LINK_CENSUS_FILES` inside the link population);
- one matcher self-test in both polarities, so a regex that cannot fire cannot pass the others.

Comments are stripped with `stripCommentsPreserveLines` (HTML read raw), so a docblock quoting a banned phrase cannot red a clean tree. All constants are typed as literals in this file.

RED, each from a `cp` byte backup in the scratchpad, restored with `cmp` silent:

(a) HEAD's "Listed to qualified allocators only" title planted in `src/app/(marketing)/for-quants/page.tsx`:

```
FAIL ... > no public marketing source carries "qualified allocators only"
AssertionError: "qualified allocators only" is banned (TRUST-01); remove it at the surface
+   "src/app/(marketing)/for-quants/page.tsx:356",
```

(b) the old cipher line planted in `scripts/build-security-packet.html`:

```
FAIL ... > no public marketing source carries "AES-256-GCM"
+   "scripts/build-security-packet.html:202",
```

(c) a `Link` to the retired demo path added to `src/components/legal/LegalFooter.tsx`:

```
FAIL ... > no app or component source links to a retired route (/demo, /api/demo) (ROUTE-03, D-11)
+   "src/components/legal/LegalFooter.tsx:20",
```

Each time exactly one case failed (18 of 19 passed) and the restored tree was green. Plant (a) was the old title as a one-line constant, not the whole HEAD row.

### Task 2: rendered census, commit `82d3f6d06`

Describe "public-truth rendered census (192)", 11 cases, reusing plan 192-03's mock set. It renders home, /security, /for-quants and Terms and asserts:

- no banned phrase, no raw id and no anchor under a retired route in any rendered page, and that each page rendered more than 200 characters;
- no input, textarea or form on home;
- the key-storage sentence and the `/security#key-handling` link on home, /for-quants and Terms, and the `key-handling` element on /security;
- the listing-cost sentence on /for-quants and Terms.

The sentences are literals in the file, not imports.

RED: the key-storage sentence and its link were cut from `src/app/(marketing)/legal/terms/page.tsx` (HEAD's paragraph), restored from a byte backup:

```
FAIL ... > public-truth rendered census (192) > Terms: says how keys are stored and links to /security#key-handling (D-02)
AssertionError: Terms lacks the key-storage sentence
Tests  1 failed | 29 passed (30)
```

After restore: `Tests 30 passed (30)`.

Task 2 verify command (census, copy test, status-surface-copy, `src/app/(marketing)`, `src/components/portfolio`, security-packet date drift, proxy test): 28 files, 595 tests passed.

### Task 3: TODOS.md, commit `b3c08dea6`

Appended to "FIX MID-TERM": `[192-WIZARD-KEY-STORAGE-COPY]` (owner Phase 200 MANAGERKEYS, LEAN-04), `[192-ORPHANED-LANDING-VERIFY]`, `[192-SFOX-FLAG-SPLIT]`, `[192-DEMO-RETIRE-RESIDUE]` and `[193-DEMO-PAYLOAD-PRODUCERS]` (owner Phase 193 QUIETVIEW, TRUST-03; it had no entry, `grep -c` printed 0 before). Added a CLOSED sub-bullet under `[170.1.2-DEMO-MATCH-PAYLOAD-EMAIL]`. Ticked the two `[158-OPS-03]` items for `bridge-flow.spec.ts` and `portfolio-pdf-demo.spec.ts`, each with a dated closure line.

Plan verify greps: `grep -c '^- \*\*\[192-' TODOS.md` printed `4` (baseline 0); the wizard, residue, 193 and both 158-OPS-03 greps all matched. The wizard claims were re-measured before booking: both steps still carry "AES-256-GCM envelope encryption" bodies; `src/components/landing` has no importer outside itself; `/api/verify-strategy` is still in `PUBLIC_ROUTES`; `NEXT_PUBLIC_SFOX_ENABLED` and `SFOX_ENABLED` are both live.

## Residue grep, classified (D-11)

Command, as the plan gave it: `git grep -n -i -E "/demo\b|api/demo|demo-pdf|lib/demo|personas|warmup-analytics|DEMO_ALLOCATOR|dek" -- src e2e scripts .github analytics-service next.config.ts eslint.config.mjs vitest.node-env.ts lighthouserc.json README.md DESIGN.md docs/demos`. It returns 281 lines. About 230 are the unrelated token `dek` (data-encryption key: `encryption.py`, route tests, `database.types.ts` and similar), which is noise. Only `MorningBriefing`'s `dek` variant is demo residue. The remainder, read line by line:

**Live wiring to a deleted route or module: none.** No hit in `e2e`, `next.config.ts`, `eslint.config.mjs`, `vitest.node-env.ts`, `lighthouserc.json` or `.github` outside one comment. `tsc` is clean, so no import of a deleted module remains. No checkpoint needed.

**Comment-only lineage:**
- Comments citing the deleted `demo-pdf-token.ts` or `src/lib/demo.ts` as a precedent: `src/lib/alert-ack-token.ts`, `scenario-share-token.ts`, `strategy-share-token.ts`, `scrub-share-path.ts`, `src/app/scenario-share/[token]/page.tsx`, `src/app/api/allocator/scenario/share/route.ts`.
- `.github/workflows/sql-mutation-nightly.yml:28` (names the retired canary), `README.md:57` ("personas" in a directory listing), the `src/proxy.test.ts` audit-history header and its deleted-path fixtures, `src/__tests__/seed-integrity.test.ts` (says the module was retired), `src/__tests__/phase-150-capital-ownership-invariant.test.ts:708` (the word "personas").
- Comments naming the deleted `/api/demo/match` endpoint in `analytics-service/routers/match.py` and `analytics-service/tests/test_match_router.py`.

**Left in place, unsure (all booked in `[192-DEMO-RETIRE-RESIDUE]`):**
- `MorningBriefing`'s `dek` variant; `CandidateDetail` `isReadOnly` and `ShortlistCard` `readOnly` props.
- The three seeders' persona steps (`seed-full-app-demo.ts` step 12 with its `benchmark_comparison` drift and hard-coded benchmark value, `seed-demo-data.ts`, `seed-demo-profiles.ts`).
- The analytics-service `_DEMO_ALLOCATOR_ID` branches (cron exclusion is load-bearing while the PROD demo rows stay; `demo_only` universe).
- DESIGN.md meeting-hero rule (line 426) and its decisions-log row; `docs/demos/friend-meeting-script.md:156` (tells the founder to send the `/demo` URL).
- The /for-quants "Sample Strategy (Demo Data)" label; the name `DEMO_PDF_SECRET`.
- Other plans' lists (SUMMARYs 12, 13, 15, 16, 17) were read and merged. Sales-demo prose in `partner-import/route.ts`, "Demo Allocator" fixture strings and dated historical docs under `docs/superpowers/plans` are not the retired feature and were left unbooked.

**Fence (D-11):** `src/app/factsheet/[id]/v2/BatchDPanels.tsx` (and its peer-scenario test) names "api/demo-cohort" in a comment and renders "Demo portfolios". Not touched; booked as `[193-DEMO-PAYLOAD-PRODUCERS]`.

## Dropped bookings

- `[192-DEMO-POSTDEPLOY-PROBE]`: the page it would read on PROD no longer exists. The retired state is proven before merge by the two placeholder-build probes (192-EVIDENCE.md) and this gate. On PROD the URL takes the proxy path every unknown URL takes.
- `[192-DEMO-ERROR-BOUNDARY-COPY]`: no `/demo` outage path remains, so the error boundary is never shown to an anonymous demo visitor.
- `[192-MATCHQUEUE-DEMO-RESIDUE]`: removed by plan 192-12 (the demo cases and the email-heading fallback in `AllocatorMatchQueue`).
- `[192-BRIDGE-FLOW-DEMO-SPEC]`: the spec was deleted by plan 192-14.
- `[192-DEMO-PIXEL-REBASELINE]`: D-11, not booked. There is no demo page whose seeded pixels could drift.
- `[192-SEED-BENCHMARK-KEY-DRIFT]`: folded into `[192-DEMO-RETIRE-RESIDUE]`, because the drift lives in the demo persona step of `seed-full-app-demo.ts`.
- Plan 192-08's 500-page caching finding: its only source was the `/demo/:path*` header block in `next.config.ts`, deleted by plan 192-11. `grep -c s-maxage next.config.ts` prints `0`.

## Gates (real numbers)

- Plan verify commands: Task 1's ship-gate chain exited 0 (quoted above), the census run is 19 then 30 tests, Task 2's phase test set is 28 files and 595 tests, all passed.
- `npx tsc --noEmit`: exit 0.
- `npm run lint`: exit 0 (eslint 0 errors, 2 pre-existing unused-var warnings in `MetricsColumn.tsx` and `composite-read-path.ts`, files this plan did not touch; admin manifest, route contract 56 routes, planning hygiene rules 1, 6 and 7, canonical domain all OK).
- `npm run test:coverage`: exit 1, and the only failures are the two pre-existing ones below. Full run: 1205 files, 1184 passed, 1 failed, 20 skipped; 23627 tests passed, 2 failed, 309 skipped. A plain run writes no coverage report when tests fail, so I re-ran `vitest run --coverage --coverage.reportOnFailure` (same two failures, same counts) to read the totals: lines 91.96, statements 90.31, functions 87.94, branches 86.37, against the `vitest.config.ts` thresholds of 82, 80, 74 and 72. No threshold error was printed. `vitest.config.ts` is not edited. The gate as CI runs it (green suite) could not be observed here for the reason below.

## Pre-existing failures (not caused by this phase, not fixed)

Two FROZEN inline snapshots in `src/lib/factsheet/compute.conventions.test.ts` (fixture B and fixture C) fail with a last-digit float difference, for example `"skew": 0.036844507138639` expected against `0.036844507138638946` received. The orchestrator measured the same two failures on main (`ba3c90128`) before this phase, and the file sits inside the Phase 193 factsheet fence. Not touched. Until they are fixed, `npm run test:coverage` exits 1 on this branch and on main.

## Deviations from Plan

**1. [Rule 3 - blocking] Coverage totals read with `--coverage.reportOnFailure`**
- **Found during:** verification
- **Issue:** `npm run test:coverage` writes no report when any test fails, so the four totals the plan asks for could not be recorded. The two failures are the pre-existing Phase 193 fence tests.
- **Fix:** re-ran the same command with `--coverage.reportOnFailure` and recorded the totals. No config file edited.
- **Files modified:** none

**2. [Rule 1 - stale comment] Census docblock said the landing components are covered by the rendered census**
- **Found during:** Task 3 residue grep (no page imports `src/components/landing`)
- **Fix:** the docblock now says nothing renders them, so neither half reaches them, and names the booking as the closing condition.
- **Files modified:** `src/__tests__/public-truth-census.test.tsx`
- **Commit:** `b3c08dea6`

**Total deviations:** 2 (one process, one comment-only). **Impact:** none on behaviour.

## TDD Gate Compliance

This plan adds only a test file and TODOS.md; no production code changed, so there is no GREEN production commit. Task 1 and Task 2 are `test(192-10)` commits. Each gate was proven RED by mutating the surface (three times for the source census, once for the rendered census) and restored byte-for-byte, which is the failing-then-passing evidence for a test that guards existing behaviour. There is no `feat(192-10)` commit by design.

## Known Stubs

None.

## Threat Flags

None. No endpoint, auth path or schema changed. No TODOS.md entry carries a PROD id, email, company name or home path (planning hygiene rule 1 passed on the commit).

## Task Commits

1. Task 1 (tracer): `6d1543472` test(192-10): source census over the public tree, packet and every app link
2. Task 2: `82d3f6d06` test(192-10): rendered census of home, security, for-quants and Terms
3. Task 3: `b3c08dea6` docs(192-10): route what Phase 192 found and did not fix, close what the retirement resolved

## Self-Check: PASSED

- `src/__tests__/public-truth-census.test.tsx`: FOUND (30 tests, passing)
- `TODOS.md` entries: FOUND (`grep -c '^- \*\*\[192-'` prints 4; `193-DEMO-PAYLOAD-PRODUCERS` present)
- Commits `6d1543472`, `82d3f6d06`, `b3c08dea6`: ancestors of HEAD
- Acceptance greps: `stripCommentsPreserveLines` and `build-security-packet.html` both present (5 hits together), `RETIRED_ROUTE_LINK` 4 hits, "public-truth rendered census (192)" 1 hit
- `.planning/STATE.md`, `.planning/ROADMAP.md`, `vitest.config.ts`, `next.config.ts`: unchanged
- Ready for phase 192 verification. Not run here and said so plainly: Playwright and any seeded-environment gate.
