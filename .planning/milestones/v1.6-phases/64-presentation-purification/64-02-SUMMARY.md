---
phase: 64
plan: 02
subsystem: public share page / presentation
tags: [PRESENT-03, share-page, mixed-share, honesty-caption, no-invented-data, phase-gate]
requires:
  - Phase 62 MEMBER-01 (ScenarioDraft.memberKeyIds v4 field + tolerant codec)
  - Phase 64 Plan 01 (PRESENT-01/02 — AUM out of the scenario KPI strip)
provides:
  - ResolvedOk.isMixed boolean (null-safe from decoded draft JSONB, no RPC/SQL change)
  - scenario-mixed-caption <p> in the share page's note register (mixed shares only)
affects:
  - src/app/scenario-share/[token]/share-resolve.ts
  - src/app/scenario-share/[token]/page.tsx
tech-stack:
  added: []
  patterns:
    - "Render condition threaded as a boolean on the resolved-ok object — page never re-reads the draft"
    - "Null-safe `(draft.memberKeyIds ?? []).length > 0` (Phase-62 isBookOnlyDraft precedent) for pre-v4 undefined-membership"
    - "Entity-tolerant caption assertion (React escapes apostrophe as &#x27; in static markup)"
key-files:
  created: []
  modified:
    - src/app/scenario-share/[token]/share-resolve.ts
    - src/app/scenario-share/[token]/share-resolve.test.ts
    - src/app/scenario-share/[token]/page.tsx
    - src/app/scenario-share/[token]/page.test.tsx
decisions:
  - "isMixed reads ONLY the already-decoded draft JSONB — no new RPC/SQL/query; the addedStrategies-non-empty half of MIXED is guaranteed by construction (the :214 book-only guard), so the ok-branch gate is exactly the membership check."
  - "Caption copy LOCKED VERBATIM ('computed from this scenario's catalog strategies only', &apos; escape), muted register only (text-text-muted), no role — honesty-color rule."
  - "RED tests assert isMixed === false for catalog-only + pre-v4 (not merely kind:'ok'), so all three conditions are pinned RED-first rather than 2/3 being green-by-vacuity — stronger coverage, honest RED."
metrics:
  duration: ~19 min
  tasks: 3
  commits: 2
  files_modified: 4
  completed: 2026-07-03
---

# Phase 64 Plan 02: PRESENT-03 — Mixed-Share Honesty Caption Summary

The public share page now renders a quiet one-line honesty caption —
**"computed from this scenario's catalog strategies only"** — iff the shared
draft is MIXED (persisted `memberKeyIds` non-empty AND catalog adds present),
threaded through `ResolvedOk.isMixed` from the already-decoded draft JSONB with
zero new private-data reads. This plan also carried the **Phase 64 gate** green
(full suite + coverage ratchet + lint + tsc + GUARD-03).

## What shipped

- **share-resolve.ts:** `ResolvedOk` gains `isMixed: boolean` (documented:
  red-team F3 — the draft blends the owner's persisted book members with catalog
  adds; only the catalog legs are publicly computable, so the projection is the
  renormalized added legs). The `kind:"ok"` return computes
  `isMixed: (draft.memberKeyIds ?? []).length > 0` — null-safe (Phase-62
  `isBookOnlyDraft` precedent: a pre-v4 decode leaves membership undefined at
  runtime → falsy → false → no caption). The `:214` book-only guard, the
  SECURITY BOUNDARY, and everything else are byte-untouched; the addedStrategies-
  non-empty half of MIXED is guaranteed by construction (a zero-added draft
  honest-absences at :214 before the ok branch), so the ok-branch live gate is
  exactly the membership check.
- **page.tsx:** `isMixed` surfaced from the resolved-ok destructure; the caption
  renders as the sibling `<p>` immediately after the `methodologyLine`
  paragraph inside `<header>`, in the exact register classes
  `mt-1 text-xs text-text-muted`, `data-testid="scenario-mixed-caption"`, no
  role, no accent/emphasis color. Copy is verbatim with the `&apos;` escape. No
  new Supabase read, no client-module import — the SECURITY BOUNDARY is intact
  (`page-server-boundary.test.ts` stays green).

## Tasks & commits

| Task | Name | Commit |
| ---- | ---- | ------ |
| 1 | RED — isMixed + caption-condition tests (mixed / catalog-only / pre-v4) | `297e666a` |
| 2 | GREEN — thread isMixed through ResolvedOk; render the caption in the note register | `4cc2b0a2` |
| 3 | Phase gate — full suite + coverage ratchet + lint + tsc + GUARD-03 | (verification-only, no commit) |

## TDD gate compliance

- **RED (`297e666a`):** exactly **4 failures** against the pre-implementation
  code — resolve Test 1 (mixed → `isMixed === true`, got undefined), resolve
  Test 2 (catalog-only → `false`, got undefined), resolve Test 3 (pre-v4
  omitted-membership → `false`, got undefined), and page Test 4 (mixed row →
  `scenario-mixed-caption` testid absent). No other new failures; all 22
  pre-existing tests in the two files still passed. Page Test 5 (catalog-only +
  pre-v4 render no caption) was green-by-vacuity pre-impl, as designed. The RED
  diff is additive-only (150 insertions, 0 deletions) — existing book-only /
  no-USD / WR-05 / PERSIST-02 test bodies byte-unchanged.
- **GREEN (`4cc2b0a2`):** the three suites (share-resolve + page +
  page-server-boundary) → **28 passed**; `tsc --noEmit` 0 errors; eslint 0
  errors on the two touched source files.

## Phase 64 gate (all recorded green)

- **Full suite:** `npx vitest run --coverage --no-file-parallelism` →
  **7453 passed | 288 skipped | 0 failed** (exit 0).
- **Coverage actuals (above the 82/80/74/72 ratchet):**
  - Lines **85.46%** (18682/21860)
  - Statements **83.32%** (20440/24531)
  - Functions **79.8%** (3501/4387)
  - Branches **76.31%** (13894/18206)
- **lint:** `npm run lint` → 0 errors, 1 warning (the known pre-existing
  frozen-EquityChart `useMemo` exhaustive-deps warning — documented baseline);
  admin-route-manifest + route-contract checks OK.
- **tsc:** `npx tsc --noEmit` → 0 errors.
- **GUARD-03:** `git diff` vs `merge-base origin/main HEAD` on `src/lib/scenario.ts`
  + `src/lib/scenario-window.ts` → **empty** (frozen engine zero-diff).
- **Requirement greps:**
  - PRESENT-01: `grep 'label: "AUM"' KpiStrip.tsx` → empty; `@lg:grid-cols-4` = 1.
  - PRESENT-02: composer commit-modal blocks green within the full run;
    `ScenarioComposer.test.tsx` has **zero diff** introduced by Plan 02 (Plan 02
    touched exactly the 4 share files: page.tsx / page.test.tsx /
    share-resolve.ts / share-resolve.test.ts).
  - PRESENT-03: `grep 'scenario-mixed-caption' page.tsx` = 1.

## Security / threat mitigations realized

- **T-64-03 (I):** `isMixed` is a boolean computed from the already-decoded,
  leak-scoped draft JSONB — no new query. The page test's admin `from()`
  throw-guard proves no arbitrary table read; DI-23-01 outcome-branching
  untouched (isMixed only on the ok return).
- **T-64-04 (I):** caption copy is a static locked literal naming no
  member/key/identity/USD; the existing no-USD pin (`not.toMatch(/\$\d/)`) is
  re-asserted on the mixed render, and the caption's opening tag is pinned to
  carry no `role` attribute.

## Deviations from Plan

None — plan executed exactly as written. Two minor judgement calls, both within
the plan's stated freedom:
1. RED Tests 2/3/5 were written to assert `isMixed === false` (not merely
   `kind:"ok"`), making them genuinely RED pre-impl rather than green-by-vacuity
   — stronger, honest coverage. The plan explicitly permitted either.
2. A single word in the new caption comment was reworded ("emphasis/warning
   color" instead of "accent/positive/negative") so the PRESENT-03 acceptance
   grep `text-positive|text-negative|accent` adds no new match vs pre-edit — the
   caption itself uses `text-text-muted` only.

## Known Stubs

None. The caption renders real, honest data (the isMixed condition), and
catalog-only / pre-v4 shares render nothing (honest absence of a caption, never
an invented one).

## Land-step note (NOT in these commits)

VERSION + package.json bump lands with the whole phase at /ship (all Phase-64
plans land together on `v1.6-membership-schema-v4`).

## Self-Check: PASSED

- FOUND: src/app/scenario-share/[token]/share-resolve.ts
- FOUND: src/app/scenario-share/[token]/share-resolve.test.ts
- FOUND: src/app/scenario-share/[token]/page.tsx
- FOUND: src/app/scenario-share/[token]/page.test.tsx
- FOUND commit: `297e666a` (RED)
- FOUND commit: `4cc2b0a2` (GREEN)
