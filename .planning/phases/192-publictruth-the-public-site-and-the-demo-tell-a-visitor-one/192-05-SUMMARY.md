---
phase: 192-publictruth-the-public-site-and-the-demo-tell-a-visitor-one
plan: 05
subsystem: ui
tags: [nextjs, supabase, sentry, vitest, demo, public-route]

requires:
  - phase: 192-01
    provides: "evidence readings: D-08 verdict strategies-missing, D-09 outcome remove, D-10 unresolvable labels 9"
  - phase: 192-02
    provides: "EditorialHero removes a null cell, label and all"
provides:
  - "/demo reads fail loudly (log, Sentry, throw to the root error boundary) instead of a loading card"
  - "/demo labels are name or codename only, resolved through displayStrategyName"
  - "/demo headline, descriptor and strips claim only what stored figures support"
  - "fetchCandidatesForBatch throws on a read error or a candidate with no strategy row"
affects: [192-06, 192-08, 192-10]

actuals:
  tokens: 12300
  tasks: 3
  commits: 4
plan_head_before: 86a118d9c76e9a4e497f2ba4ee2f3decfb2496d6
plan_head_after: 31e622d1481b65c4a6ec234561aeac8e3a40397b

tech-stack:
  added: []
  patterns:
    - "failDemoRead(stage, err, personaKey): never, with thrown message 'demo read failed: <stage>' and no row data"
    - "public strategy labels are only ever what displayStrategyName returns; a raw-id result fails the page"

key-files:
  created:
    - src/app/(marketing)/demo/page.truth.test.tsx
  modified:
    - src/app/(marketing)/demo/page.tsx
    - src/app/(marketing)/demo/layout.tsx
    - src/lib/demo-recommendations.ts
    - src/lib/demo-recommendations.test.ts

key-decisions:
  - "Throw to the root error boundary, not an in-page card (UI-SPEC); the boundary copy is signed-in-user copy, accepted for an outage path and booked by plan 192-10"
  - "Unheld attribution/optimizer labels are never taken from the stored strategy_name (security review: disclosure-tier bypass); one batched strategies read through displayStrategyName instead"
  - "Batch date line renders whenever recommendations render and the shown batch is found, not only on fallback"
  - "Counterfactual window uses formatIsoDay (year-bearing); batch date uses formatAbsoluteDate"
  - "D-08 verdict is strategies-missing, so the holdings select is left as is (no code-only fix)"

requirements-completed: [ROUTE-03]

coverage:
  - id: D1
    description: "Every /demo read error, a missing strategy row and an empty persona are logged, captured to Sentry and thrown; the loading card is deleted"
    requirement: ROUTE-03
    verification:
      - kind: unit
        ref: "src/app/(marketing)/demo/page.truth.test.tsx#/demo fails loudly instead of falling through (D-08)"
        status: pass
    human_judgment: false
  - id: D2
    description: "No invented reason, no dash rank, no computing line, no founder-view link, honest banner, dated batch"
    requirement: ROUTE-03
    verification:
      - kind: unit
        ref: "src/app/(marketing)/demo/page.truth.test.tsx#/demo shows no invented text and no founder-view link (UI-SPEC, D-09)"
        status: pass
    human_judgment: false
  - id: D3
    description: "No raw strategy id on /demo, including the disclosure-tier case for unheld ids"
    requirement: ROUTE-03
    verification:
      - kind: unit
        ref: "src/app/(marketing)/demo/page.truth.test.tsx#/demo never shows a raw strategy id (D-10)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Headline, descriptor, counterfactual window and winners/losers strip claim only what the stored figures support"
    requirement: ROUTE-03
    verification:
      - kind: unit
        ref: "src/app/(marketing)/demo/page.truth.test.tsx#/demo verdict block claims only what its figures support (D-08)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Seeded-build look of /demo?persona=active, cold and stalled (headline matches visible cells, dated counterfactual window)"
    verification: []
    human_judgment: true
    rationale: "The plan's human-check; not run here (no seeded build, and no PROD access in this worktree)"

duration: 40min
completed: 2026-11-07
status: complete
---

# Phase 192 Plan 05: /demo tells one true story Summary

**/demo now fails loudly (log, Sentry, throw) instead of showing a loading card, labels every strategy by name or codename only, and makes headline, descriptor and strips claim only what stored figures support.**

## Performance

- **Tasks:** 3 (plus one orchestrator-directed security fix, committed separately)
- **Files modified:** 5 (1 created)
- **Commits:** 4 (measured from the plan ledger)

## Accomplishments

- `failDemoRead` covers eight stages (profile, batches, portfolio, holdings, analytics, recommendations, strategy-row, empty) plus strategy-name; one Sentry capture each with `tags {op: "demo", stage, persona}`, level `error`; thrown message is only `demo read failed: <stage>`.
- Loading card, "Recommendations computing", "Strong fit for this allocator", `#—` rank, "(latest computing)" and the founder-view footer link are gone. Batch is dated ("Showing the batch computed Nov 1"). Banner reads "Live demo — simulated allocator data."
- Held, recommended and unheld labels never fall back to a raw id; a raw-id result, a read error or a missing row fails the page with stage `strategy-name`.
- Active headline from `activeHeadline` (way-down claim needs both drawdowns, way-up both TWRs, else "Allocator portfolio review"); BTC drawdown stays null (not persisted). Descriptor counts read from the holdings list; "manager recommendations" only when one renders. Counterfactual strip names its window (`on YYYY-MM-DD`) or is not rendered; winners/losers strip renders only with attribution.
- `fetchCandidatesForBatch` throws on a read error or a candidate with no strategy row (the blank-name stub is removed).

## Task Commits

1. **Task 1 (tracer): fail-loud reads** - `7c7af3507` (feat)
2. **Task 2: no invented text, raw ids, founder-view link** - `58e4327a5` (feat)
3. **Task 3: verdict block claims only its figures** - `b595a9944` (feat)
4. **Orchestrator-directed security fix: disclosure tier** - `31e622d14` (fix)

Tracer gate: auto mode on; `<verify>` re-run after Task 1 passed end to end, so expansion continued.

## RED evidence

Each task's tests were run against the unfixed code before the implementation (byte backups of page, layout and recommendations files are in the executor scratchpad):

- Task 1: 11 failed / 22 passed. 9 page cases failed with `promise resolved ... instead of rejecting` (the planned assertion), the recommendations-rejection case failed with the unwrapped message, and the two `fetchCandidatesForBatch` cases resolved instead of rejecting. Semantic assessment: every target failed on the planned assertion, no import or fixture fault. After GREEN, a neutered copy of the page with the holdings error check removed was run: the `holdings` case and the "message carries the stage only" case went RED (2 failed / 10 passed); the page was restored byte-for-byte (`cmp` identical) and the run returned to 33 passed.
- Task 2: 11 failed / 15 passed (computing line, strong-fit fallback, missing batch date, founder-view link, banner sentence, raw-id rejects, attribution holding label, optimizer batched read).
- Task 3: 10 failed / 28 passed (headline, counterfactual period and gating, descriptor counts, recommendation-gated descriptor, attribution gating).
- Security fix: new case "an unheld row's stored real name never reaches the page: the codename does" failed with `expected 'Real Manager Name' to be 'ALPHA-7'`, passed after the fix.

## Gate results (worktree root, real numbers)

- `npx vitest run "src/app/(marketing)/demo" src/lib/demo-recommendations.test.ts src/components/portfolio src/__tests__/display-sign-single-source.test.ts`: 27 files, 391 tests passed, 0 failed. `page.max-dd-tone.test.tsx` unchanged and passing.
- `npx tsc --noEmit`: exit 0.
- `npx eslint "src/app/(marketing)/demo" src/lib/demo-recommendations.ts`: exit 0.
- `npm run lint`: 0 errors, 2 pre-existing warnings (unused vars in two factsheet files not touched here), and one `check-planning-hygiene` violation I did not cause: `ABSOLUTE-HOME-PATH` in `192-01-SUMMARY.md:110` (plan 192-01's file). Out of scope; surfaced for the orchestrator.
- Acceptance greps: `failDemoRead(` 14 (min 9); `captureToSentry` 2; "Demo data is loading", "Recommendations computing", "Strong fit for this allocator", "latest computing", `founder-view` all 0 in page.tsx; `founder-view` and "Real product on production" 0 in layout.tsx; `searchParams` 4 (HEAD count); `period=` 1; "Allocator portfolio review" 1.

## Decisions Made

- Thrown error, not an in-page card, per UI-SPEC. The root boundary's copy is for a signed-in user; accepted for an outage path (planner assumption, booked by plan 192-10).
- D-08 verdict is `strategies-missing`, so the holdings select is unchanged and no select-string pin was added.
- On PROD this code renders the error page for any persona whose book is empty or whose labels cannot resolve (EVIDENCE: 0 holdings, `D-10 unresolvable labels: 9`). It must not ship until plan 192-06's repair lands; plan 192-10's precondition gates that. The throw stays unconditional.

## Deviations from Plan

### Orchestrator-directed

**1. [Rule 2 - Security] Dropped the stored-name fallback in unheld label resolution**
- **Source:** orchestrator course correction after an automated security review (MEDIUM).
- **Issue:** The plan's literal resolution order was holding label, then stored `strategy_name`, then the batched `strategies` read. The analytics service writes `strategy_name` as the raw `strategies.name`, so trusting it for unheld ids bypasses the disclosure tier: an exploratory strategy's real name could reach a public page, against D-10 and the codename rule.
- **Fix:** Held ids keep the holding's label; every unheld id goes through the one batched `strategies` read (`id, name, codename, disclosure_tier`) and `displayStrategyName`. `usableStoredName` is deleted; the read runs whenever any id is unheld. Missing row, read error or raw-id result still fails with stage `strategy-name`. The earlier test "a usable stored name is kept and needs no extra read" was replaced by the disclosure-tier test, since it asserted the behaviour now removed.
- **Files modified:** `src/app/(marketing)/demo/page.tsx`, `src/app/(marketing)/demo/page.truth.test.tsx`
- **Commit:** `31e622d14`

### Auto-fixed Issues

None otherwise. A UUID pattern was added beside the plan's `RAW_ID_PATTERN` in `isRawIdLabel` so a label containing a UUID also fails (UI-SPEC: "or contains a UUID"); `RAW_ID_PATTERN` itself is as specified.

**Total deviations:** 1 orchestrator-directed security fix. **Impact:** strictly tighter than the plan; costs one extra read on pages whose analytics mention unheld strategies.

## Issues Encountered

- `e2e/demo-public.spec.ts` and `e2e/demo-screenshot.spec.ts` still describe the old "Demo data is loading" fall-through in comments (and may assert it). Not in this plan's files; plans 192-08 and 192-10 own them.
- Pre-existing `check-planning-hygiene` violation noted above.

## Known Stubs

None.

## Threat Flags

None. T-192-09 (message carries stage only, asserted by test), T-192-10 (no read takes input from searchParams; count unchanged at 4) and T-192-11 (labels never raw ids, now also never the stored raw name) are mitigated.

## Next Phase Readiness

- Plan 192-06 (PROD data repair) must make the three persona books and the 9 composing strategies exist before this code ships; plan 192-08's unseeded spec can assert the `demo read failed: ` prefix never reaches the client.
- Human check outstanding: look at `/demo?persona=active|cold|stalled` on a seeded build.

## Self-Check: PASSED

- FOUND: src/app/(marketing)/demo/page.truth.test.tsx, page.tsx, layout.tsx, src/lib/demo-recommendations.ts and its test
- FOUND commits in HEAD ancestry: 7c7af3507, 58e4327a5, b595a9944, 31e622d14
