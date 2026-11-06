---
phase: 170-pagecopy
plan: 15
subsystem: testing
tags: [reflow, e2e, layout-narrow, gap-closure, containing-block]
status: complete

requires:
  - phase: 170
    provides: "170-01 main-aware assertNoReflow and its three-case server-free self-test"
provides:
  - "assertNoReflow offender walk that climbs the containing-block chain (offsetParent for position:absolute, parentElement otherwise) and never names a position:fixed box"
  - "optional trailing ` also=<b2>,<b3>` on the LAYOUT-NARROW-OFFENDER Node log line"
  - "two server-free self-test fixtures: escapee (named) and contained escapee (resolves)"
affects: [170-16, 170-11]

actuals:
  tokens: 2400
  tasks: 2
  commits: 2

plan_head_before: fe0480217d9b1ee44fe270917bc736f7a24cb69b
plan_head_after: 60fd0b13e7bcd89430b9584a049f739c0c2c19ae

tech-stack:
  added: []
  patterns:
    - "Offender containment follows containing blocks, not DOM ancestry"

key-files:
  created: []
  modified:
    - e2e/helpers/reflow.ts
    - e2e/reflow.spec.ts

key-decisions:
  - "The fixed decoy sits inside #main-content under an unclipped position:absolute wrapper, so neuter (b) and the old-helper RED both discriminate"
  - "The clipping set is auto, scroll, hidden and clip; hidden and clip are pinned by no fixture"

metrics:
  duration: "~25 min"
  completed: 2026-09-30
---

# Phase 170 Plan 15: containing-block-aware reflow offender walk Summary

`assertNoReflow` now names an absolutely positioned box that escapes both an unpositioned
overflow-x scroller and `#main-content` onto the document. Before this plan it printed
`offender=<unknown>` on every composed-scenario row of CI run `36764778803`. The walker climbs
`offsetParent` from a `position:absolute` box and `parentElement` from anything else. It skips
`position:fixed` boxes and treats `auto`, `scroll`, `hidden` and `clip` as clipping. Two
server-free Chromium fixtures prove the change in both directions.

## Tasks

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 (tracer, tdd) | escapee fixtures, RED on the old helper | `9460ee7bb` | e2e/reflow.spec.ts |
| 2 (tdd) | the offender walk follows the containing-block chain | `60fd0b13e` | e2e/helpers/reflow.ts |

## Evidence

All runs are local Chromium, server-free: `CI=1 npx playwright test e2e/reflow.spec.ts -g "helper self-test"`.

**RED against the unchanged helper (Task 1, before `60fd0b13e`):**
- Failing case: `assertNoReflow helper self-test (Phase 170 T0) › escapee fixture: an absolutely positioned label escaping both scrollers onto the document is named`
- Message: `reflow: main=0 doc=247 scroller=doc offender=<unknown>`. This reproduces gap 2 (truth 18) exactly: main does not overflow, the document does, and the walker cannot name the culprit.
- The contained escapee fixture passed on the old helper as well (`LAYOUT-NARROW-CLEAN viewport=390 main=0 doc=0`). With `position:relative` the document does not overflow at all, so the walk never runs. The same reading shows that the fixed decoy at `left:400px` adds nothing to `scrollWidth`.
- 4 passed, 1 failed.

**GREEN after Task 2:** 5 passed. The escapee case logs
`LAYOUT-NARROW-OFFENDER viewport=390 main=0 doc=247 offender=LABEL#escapee`. The three
pre-existing cases keep their results; the red fixture logs `main=0 doc=410 offender=DIV` from its
document half as it did before.

**Neuter (a)**, where the `offsetParent` step is replaced by `parentElement`: the escapee case went
RED with `reflow: main=0 doc=247 scroller=doc offender=<unknown>`. Restored by hand, then `cmp`
against the scratchpad byte backup: identical.

**Neuter (b)**, where the `position:fixed` skip is removed: the escapee case went RED with
`reflow: main=0 doc=247 scroller=doc offender=DIV#fixed-decoy`. The log line read
`... offender=DIV#fixed-decoy also=LABEL#escapee`, which also shows the new `also=` field firing.
Restored by hand and checked with `cmp` against the backup: identical.

After both restores the self-test gave 5 passed again. `npx tsc --noEmit -p .` exits 0 and
`npx eslint e2e/helpers/reflow.ts e2e/reflow.spec.ts` exits 0.

Acceptance greps: `offsetParent` appears in 1 non-comment line of the helper.
`LAYOUT-NARROW-OFFENDER viewport=` appears 1 time and `LAYOUT-NARROW-CLEAN viewport=` 1 time.
The spec has 6 `setContent` calls and 9 `escapee` mentions.

## Compatibility with 170-11's census

The `LAYOUT-NARROW-OFFENDER viewport=… main=… doc=… offender=…` prefix and the thrown message are
byte-compatible with the old ones. The helper appends ` also=<b2>,<b3>` to the Node log line only
when a second offender exists. The signature, the `<= 1` px slop, the toPass frame and the overflow
measurement are all unchanged. The fix can therefore change only which element gets NAMED. It can
never turn a red row green.

## Deviations from Plan

**1. [Fixture design] The fixed decoy sits inside `#main-content`, under an unclipped
`position:absolute` wrapper.** The plan wanted the old helper to print `<unknown>` and also wanted
neuter (b) to name `DIV#fixed-decoy`. No single placement under the plan's climb rule satisfies
both:
- A decoy that is a direct child of main is "contained" by main even with the fixed skip removed, so neuter (b) would stay green.
- A decoy that is a direct child of body gets named by the old helper, so the old-helper RED would not read `<unknown>`.

The wrapper resolves this. The old helper climbs the DOM through main and gets `<unknown>`. The
new climb without the skip jumps from the wrapper to body through `offsetParent` and names the
decoy. The wrapper has zero size at x=0 and is never a candidate. This is documented in the
`escapeeFixture` JSDoc. The helper rule itself is unchanged: `offsetParent` is used only for
`position:absolute`.

**2. The list is about 800 px wide, not 850.** It holds four 200 px flex items. The escapee sits
in the fourth, starting at x=600, and `doc=247` confirms that it escapes.

**3. [Process] Branch namespace.** The worktree branch `feat/170-gap-15` is outside the
`agent-*` / `worktree-agent-*` allow-list in the executor's pre-commit assertion. The orchestrator
assigned this branch explicitly, so I committed on it and did not rename or re-home it. It is not
a protected branch.

## Known limits

- `hidden` and `clip` are in the clipping set, but no fixture pins them. Removing either would pass the self-test.
- Containing blocks created by `transform`, `filter` or `contain` are not modelled, because `offsetParent` ignores them. The JSDoc states this.
- When main overflows and an absolute box escapes main, that box can be named as main's offender even though it does not add to main's scrollWidth. It still sits past main's right edge, so naming it is informative rather than wrong. No fixture covers this case.

## Post-land check (orchestrator)

In the first e2e-seeded CI run after the gap plans land, check that no `LAYOUT-NARROW-OFFENDER`
line reads `offender=<unknown>` while `doc=` exceeds 1.

## Threat Flags

None. The change touches a test helper and inline synthetic fixtures only.

## Self-Check: PASSED

- e2e/helpers/reflow.ts and e2e/reflow.spec.ts are modified and committed.
- Commits `9460ee7bb` and `60fd0b13e` exist on `feat/170-gap-15`.
