---
phase: 209-scrubleaks-error-reports-carry-no-raw-database-details-and-n
fixed_at: 2026-11-14T03:10:00Z
review_path: .planning/phases/209-scrubleaks-error-reports-carry-no-raw-database-details-and-n/209-REVIEW.md
iteration: 2
findings_in_scope: 5
fixed: 5
skipped: 0
status: all_fixed
---

# Phase 209: Code Review Fix Report (round 2, topic split A)

**Fixed at:** 2026-11-14
**Source review:** 209-REVIEW.md (iteration 2)
**Iteration:** 2

**Summary:**
- Findings in scope: 5 (CR-01 with IN-05, CR-02, WR-10, WR-11, WR-12)
- Fixed: 5
- Skipped: 0
- Not touched: WR-09 (the second fixer owns it), every other INFO finding.

**Commit:** `4263846b1` is ONE commit for all five findings. Their hunks interleave in the same two files (the walk context threaded for WR-11 shares signatures with the IN-05 skip), and `git add -p` is not available here, so the per-finding split was not done. The commit message lists each finding.

**Where verification ran:** the main worktree `quantalyze-209` on branch `feat/209-scrubleaks`. No temporary git worktree was created, because the caller set the worktree up.

## Fixed Issues

### CR-01 + IN-05: streamed tracing ignored `beforeSendTransaction`; the walk would touch live SDK objects

**Files modified:** `src/instrumentation.ts`, `src/instrumentation.test.ts`
**Applied fix:**
- `Sentry.init` now sets `traceLifecycle: "static"` (D-17).
- IN-05: `scrubRecordStrings` takes an optional `skip` set. The one call that descends into the root `sdkProcessingMetadata` passes `SDK_LIVE_OBJECT_KEYS` (`capturedSpanScope`, `capturedSpanIsolationScope`). The skip applies only at that path (`depth === 0 && key === "sdkProcessingMetadata"`), so an `extra.capturedSpanScope` key is still walked. `dynamicSamplingContext` is still walked.
- Status: **fixed**.

**What the walk does to those objects, measured on a real transaction before choosing the skip:**
- Probe p3b (reviewer's, `@sentry/nextjs` static): about 309 nodes visited under `sdkProcessingMetadata`; `capturedSpanScope` is a `Scope` with `_client` set; no rebuild; client intact.
- Real-SDK vitest case: with the skip removed, the walk REWROTE a share path held in the live captured scope's tags (`/factsheet-share/<token>` became `/factsheet-share/[token]` on the scope itself). So the walk does mutate live scope state, and the skip is warranted.
- Skipping `dynamicSamplingContext` too (over-skip) leaks the raw token in the envelope header's `trace` block (`trace.transaction`). That is the reason it must keep being walked, and it is pinned.

**Tests (real SDK, serialised envelope):** a `describe` block at the end of `src/instrumentation.test.ts` takes the options `register()` really passes to `Sentry.init` (read off the existing `@sentry/nextjs` mock), starts the REAL `@sentry/nextjs` (`vi.importActual`) with them and an in-memory transport, and reads the envelopes. It runs fine in the node project (about 100 ms per case). Two test-only overrides: `tracesSampleRate: 1` and the capturing `transport`; `beforeSendTransaction` is wrapped only to record `sdkProcessingMetadata`, then calls the registered hook. Cases:
- Span on `/factsheet-share/<token>`: the envelope item type is `transaction`, never `span`; the token is absent from the whole serialised envelope including the header; the placeholder is present.
- IN-05: the captured live scope still holds its raw tag and its client after the hook ran.

**Neuter-to-RED proofs** (byte backup in the scratchpad, `cmp` after each restore):
- Remove `traceLifecycle: "static"`: both CR-01 cases RED (`expected [ 'span' ] to include 'transaction'`).
- Drop the skip (pass `undefined`): the IN-05 case RED (`expected '/factsheet-share/[token]' to be '/factsheet-share/Xk3p...'`).
- Add `dynamicSamplingContext` to the skip set: the CR-01 case RED (token found in the envelope).

### CR-02: console breadcrumbs carried `details`/`hint` onto the next captured event

**Files modified:** `src/instrumentation.ts`, `src/instrumentation.test.ts`
**Applied fix:** `beforeBreadcrumb: (crumb) => (crumb.category === "console" ? null : crumb)` in `Sentry.init` (D-18). Everything else passes through as the same object.
**Tests (real SDK):**
- In an isolation scope: `console.error` of the real `scrubSeamError` output for a PostgREST-shaped object (with sentinels), a non-console `addBreadcrumb`, then `captureException`. The envelope carries no `DETAILS-SENTINEL`, `HINT-SENTINEL` or `victim@example.com`, and its breadcrumbs are exactly `["kept-breadcrumb"]`.
- A direct case: `null` for `console`, the identical object for `ui.click`, `navigation`, `http` and an absent category.
**Neuter-to-RED:** remove `beforeBreadcrumb`: both CR-02 cases RED (sentinel found in the envelope).

### WR-10: the scrub-failure catch swallowed what threw

**Files modified:** `src/instrumentation.ts`, `src/instrumentation.test.ts`
**Applied fix:** `catch (err)` passes `scrubSharePath(err instanceof Error ? err.name : typeof err)` to `buildWithheldEvent`, which carries it as tag `scrub_error` and as `error` in the `console.error` payload, for the `caught` reason only. Class name only, no message.
**Test:** the existing "a throw out of the walk" case now asserts `scrub_error: "TypeError"` in the tags and `error: "TypeError"` in the log call.
**Neuter-to-RED:** pass `undefined` instead of the name: that case RED.

### WR-11: the rebuild path dropped data silently and its log line carried no handle

**Files modified:** `src/instrumentation.ts`, `src/instrumentation.test.ts`
**Applied fix:** `rebuildScrubbed` counts omissions in a `tally` (unreadable key, depth drop, throwing `ownKeys`); an unreadable slot with nothing to rebuild counts 1. `scrub_rebuilt` is `"0"` or `"omitted=N"`. A small `WalkContext` (`event_id`, top-level `channel`) is threaded through the walk, and the rebuild line is now `console.error(msg, { event_id, channel, omitted })`. The channel goes through `scrubSharePath`.
**Tests:** the shared `REBUILT` marker in the existing SC2 cases is now `"0"`; the stuck-tag case asserts `omitted=1` and the new log payload; a new case drops a too-deep value and asserts `omitted=1`, the event id and channel `extra`.
**Neuter-to-RED:** constant `"true"` marker: 9 cases RED; remove `channel` from the log: 2 cases RED.

### WR-12: the onRequestError rebuild gate over-matched and its catch failed open

**Files modified:** `src/instrumentation.ts`, `src/instrumentation.test.ts`
**Applied fix:** the gate requires `error.constructor === Error`, `error.name === "Error"`, no `cause`, a message starting with `{`, and a parsed object with a string `code` or `message`. Only `JSON.parse` is inside the `try`; the renderer call is outside it (the renderer `scrubSeamErrorForCapture` has its own catch and cannot throw). The capture gets tag `message_rebuilt: "true"` only when it rebuilt.
**Tests:** `it.each` pass-through cases (a `RangeError` subclass, a subclass keeping the name `Error`, an Error with a cause, a JSON body with no string code or message, a body whose code and message are not strings), plus a case that the tag is present on a rebuild and absent otherwise.
**Neuter-to-RED:** each of the four gate conditions and the tag removed one at a time: each goes RED on its own named case. The `constructor` gate first went unproven because the `RangeError` case is caught by the `name` gate, so the "subclass keeping the name Error" case was added and then proven RED.

## Verification (run in `quantalyze-209`)

- `npx vitest run src/instrumentation.test.ts src/lib/scrub-share-path.test.ts src/lib/sentry-capture.test.ts src/lib/seam-redaction.test.ts`: 4 files, 162 tests, all green.
- `npm run typecheck`: clean.
- `npm run lint`: 0 errors. 4 warnings, all unused variables in files this fix did not touch (`composite-read-path.ts`, `queries.stale-analytics-detail.test.ts`).

## Notes for the orchestrator

- The old WR-06 marker value `"true"` is gone. Nothing outside `src/instrumentation.ts` and its test referenced `scrub_rebuilt` (grep).
- The `register()` init now sets `traceLifecycle` and `beforeBreadcrumb`; the docblock claim that wiring both hooks closes the tracing channel is true only because of `traceLifecycle: "static"`, and a comment next to the option says so.
- IN-04 and IN-06 are not touched.

---

_Fixed: 2026-11-14_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 2_
