---
phase: 208-uiquick-alert-digest-link-browse-error-state-and-share-link
plan: 04
subsystem: testing
tags: [webkit, playwright, share-link, vitest, d-09, d-11]
requires: ["208-03"]
provides:
  - "D-09 one-off WebKit iPhone 15 reading of the copy-failed dialog (open-time selection, reselection after a failed Copy link, Public link lane, in-dialog execCommand copy)"
  - "D-11 binding reading: ShareableLink.test.tsx green 3 quiet and 3 under 24 busy loops after the last edit to the file"
affects: []
actuals:
  tokens: 6000
  tasks: 2
  commits: 1
plan_head_before: 916fc36018566096165fd9cff0b34a63ade1887d
plan_head_after: 916fc36018566096165fd9cff0b34a63ade1887d
commits: 1
key-files:
  created: []
  modified: []
key-decisions:
  - "No tracked source file changed. plan_head_after is the code head every reading was taken at; the one commit counted above is this SUMMARY, which cannot carry its own hash."
requirements-completed: [SC-3, SC-4]
status: complete
---

# Phase 208 Plan 04: WebKit iPhone reading and the binding D-05 reading Summary

In Playwright WebKit on the iPhone 15 profile the copy-failed dialog's URL is fully selected on open and again after a failed Copy link, the published lane opens its own `Public link` dialog, the in-dialog `execCommand` fallback really copies (`Copied`), and nothing overflows a 393 px page; the D-05 arm and its file passed 6 of 6 runs, 3 quiet and 3 under 24 busy loops.

All readings were taken at head `916fc3601` (plan 03's SUMMARY commit). The last edit to `src/components/strategy/ShareableLink.test.tsx` is `6cc6b1598` (plan 03), so every D-11 run below is after it.

## Task 1: D-09 WebKit reading (one-off, local, no CI project)

Setup: `next dev --port 3208` against a closed-port Supabase URL with placeholder keys; temporary public page `src/app/browse/harness-208/page.tsx` rendering both lanes; `**/api/strategies/*/share` fulfilled with a 125-character fake URL; every context is `devices["iPhone 15"]` (393 px wide) driven by real taps.

**Before (pre-fix, measured at `65f8e4998`, from the plan):**

```
{"active":true,"tag":"INPUT","start":0,"end":125,"len":125,"dialogOpen":true,"scrollW":924,"clientW":303}
```

**Context A, mint lane, `clipboard.writeText` rejects and `execCommand` returns false (value elided to its length):**

```
A {"open":{"active":true,"tag":"INPUT","start":0,"end":125,"len":125,"dialogOpen":true,"scrollW":924,"clientW":202},"afterFailedCopy":{"active":true,"tag":"INPUT","start":0,"end":125,"len":125,"dialogOpen":true,"scrollW":924,"clientW":188},"geo":{"vw":393,"fieldRight":233.875,"btnRight":349,"pageScrollW":393,"pageClientW":393},"valueLenFull":125}
```

- Selection is 0..125 of 125 on open and after the tap on `Copy link` ends in `Copy failed`.
- The 125-character value sits in a field 202 px wide (188 px after the button reads `Copy failed`): `scrollW` 924 against `clientW` 202 means the URL scrolls inside the field and is never truncated in its value.
- Field right edge 233.9 and button right edge 349 are both inside the 393 px viewport; `documentElement.scrollWidth` equals `clientWidth` (393), so no horizontal page overflow.
- The "after" line differs from the plan's pre-fix 303 px field only in width, which is the Copy link button now sharing the row.

**Context B, published lane, same forced failures:**

```
B {"active":true,"tag":"INPUT","start":0,"end":68,"len":68,"dialogOpen":true,"scrollW":514,"clientW":202,"titles":["Public link"],"buttons":["","Copy link"],"value":"http://localhost:3208/factsheet/11111111-1111-4111-8111-111111111111","expected":"http://localhost:3208/factsheet/11111111-1111-4111-8111-111111111111"}
```

- Title `Public link`, field value equals the expected public URL, selection 0..68 of 68.
- The dialog holds no `Create share link` and no `Copy share link` button. The one nameless button is the modal's icon-only close control.

**Context C, in-dialog fallback lands (D-15):** `writeText` rejects; `execCommand` fails on its first call only and is the real one afterwards.

```
C {"copiedButton":true,"execCommandCalls":2}
```

- Call 1 failed, so the dialog opened. Call 2, made from the dialog's `Copy link` through a temporary input placed inside the open dialog, succeeded and the button read `Copied` in WebKit.

Script result: `FAILURES []`. No expectation was loosened.

### Honest limit

Playwright WebKit on the iPhone 15 profile is the WebKit engine with an iPhone viewport, user agent and touch emulation, not iOS Safari. It shows that the selection API and the in-dialog `execCommand` fallback work in that engine. It cannot reproduce iOS's rule that `focus()` and `select()` outside a user gesture are ignored; the gesture-driven Copy link button is the real mitigation. TODOS `170.6.1-R2-IOS-SELECT` and D-09 both accept this check as written.

### Teardown

- `src/app/browse/harness-208` deleted; `git log --all --format=%H -- src/app/browse/harness-208` prints nothing (never committed).
- The dev server on port 3208 was stopped (no listener on the port, no `next dev --port 3208` process).
- `next dev` had rewritten `AGENTS.md` (RESEARCH Pitfall 7); it was restored from the byte backup and `cmp` exits 0.
- `git status --short` printed nothing before this SUMMARY was written.

## Task 2: D-11 binding reading of the D-05 arm

`npx vitest run src/components/strategy/ShareableLink.test.tsx` under Node 22, file includes the arm "D-05: a confirmed live link reads Manage private link and opens the Private link Modal without a fetch".

Quiet, 3 runs:

```
Tests  53 passed (53)
Tests  53 passed (53)
Tests  53 passed (53)
```

Loaded, 3 runs under 24 `yes > /dev/null` busy loops (one `bash -c` command, so the PID list word-splits):

```
Tests  53 passed (53)
Tests  53 passed (53)
Tests  53 passed (53)
left: 0
```

`pgrep -x yes | wc -l` also printed `0` afterwards.

**No neuter-RED is claimed for D-11.** The CI failure does not reproduce locally (ROADMAP SC-4 carve-out). The closing evidence is the cited mechanism (the `next/dynamic` loadable singleton), the file-level warm-up, the explicit per-call `{ timeout: 5000 }` awaits and these six green runs. No global timeout was raised. TODOS `170.6.2-SHAREABLELINK-D05-RED` can close on that evidence.

## Deviations from Plan

None. The plan was executed as written. Two operational notes:

- The first teardown attempt was refused by the auto-mode classifier because it included a broad `pkill -f next-server`. It was redone narrowly: only the three PIDs that listened on or launched the port-3208 server (`npm exec`, `next dev`, the server child) were killed, so no other worktree's dev server was touched.
- `scripts/verify-plan-anchors.mjs` on this plan: `claims: 6 checked`, `OK`.

## Known Stubs

None. This plan wrote no code.

## Threat Flags

None. The only new surface, the temporary public harness page (T-208-12), existed for the length of Task 1, was never staged or committed, and is gone.

## Self-Check: PASSED

- `src/app/browse/harness-208` absent, port 3208 free, `AGENTS.md` byte-identical to its backup: confirmed.
- Six D-11 `Tests` lines and `left: 0` present above.
