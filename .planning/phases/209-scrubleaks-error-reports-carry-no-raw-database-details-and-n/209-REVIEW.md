---
phase: 209-scrubleaks-error-reports-carry-no-raw-database-details-and-n
reviewed: 2026-11-14T03:10:00Z
iteration: 3
depth: standard
files_reviewed: 18
files_reviewed_list:
  - src/instrumentation.ts
  - src/instrumentation.test.ts
  - src/lib/scrub-share-path.ts
  - src/lib/scrub-share-path.test.ts
  - src/app/PlausibleScript.tsx
  - src/app/PlausibleScript.test.tsx
  - src/lib/seam-redaction.ts
  - src/lib/seam-redaction.test.ts
  - src/lib/sentry-capture.ts
  - src/lib/sentry-capture.test.ts
  - src/app/api/og/factsheet/[id]/route.tsx
  - src/app/api/og/factsheet/[id]/route.public-access.test.tsx
  - src/app/api/keys/validate-and-encrypt/route.ts
  - src/app/api/keys/validate-and-encrypt/route.test.ts
  - src/app/api/allocator/scenario/share/route.ts
  - src/app/api/strategies/[id]/share/route.ts
  - src/lib/wizardErrors.invariant.test.ts
  - src/__tests__/audit-coverage.test.ts
findings:
  critical: 0
  warning: 0
  info: 11
  total: 11
  necessity: 1
status: clean
---

# Phase 209: Code Review Report (iteration 3, final)

**Reviewed:** 2026-11-14T03:10:00Z
**Depth:** standard
**Files Reviewed:** 18
**Status:** clean

## Summary

This is the final re-review, after round-2 fixes. I read the iteration-2 review (including the appended WR-10..WR-12), decisions D-01..D-18 in `209-CONTEXT.md`, both round-2 fix reports, and the round-2 commits `4263846b1` (`src/instrumentation.ts` and its test) and `8d520ceaf` (`PlausibleScript` and `scrub-share-path`). I re-read the full phase diff `7a229d27f..HEAD -- src`.

**Status rule.** The caller's rule is: `clean` unless a CRITICAL or WARNING remains that is either fix-introduced or a phase-goal gap. **That count is 0.** Every iteration-2 CRITICAL and WARNING is resolved. No round-2 fix introduced a MEDIUM-or-higher issue. Four LOW items are fix-introduced: IN-04, IN-06, IN-09 and IN-10. Each finding below carries an **Origin** line.

**How I checked:**
- `src/instrumentation.test.ts`: 66/66 green in about 0.4 s. The four real-SDK cases take about 101, 11, 10 and 3 ms.
- Each real-SDK case alone (`-t`): green. The whole file under `--sequence.shuffle` with seeds 1-5: green every time.
- The whole `node` vitest project, which shares worker processes with this file: 269 files, 4,583 tests, green in 13.6 s.
- Throwaway probes in the session scratchpad drove the installed `@sentry/nextjs` with an in-memory transport. They are not committed.
- I did **not** re-run the neuter-to-RED proofs, because this review is read-only and does not edit source. I rely on fix report A's recorded neuters, the iteration-2 probes, and the fact that the test spreads the registered options object (below).

**Limits:**
- These runs used local Node v25.8.1. CI's lanes pin `node-version: 22`. Starting the real SDK under Node 22 is **not verified here**.
- The CR-01 test drives a manual span, not Next's own `BaseServer.handleRequest` span. Post-deploy check: the SDK's init warning "`beforeSendTransaction` and `ignoreTransactions` are ignored with `traceLifecycle: 'stream'`" must be **absent** from the production function log.

Necessity was assessed with `~/.claude/gsd-core/references/necessity-review.md`. No `.claude/skills` or `.agents/skills` directory exists in this worktree.

### Iteration-2 CRITICAL and WARNING: status

| ID | Verdict | Evidence |
|---|---|---|
| CR-01 | **Resolved** | `traceLifecycle: "static"` at `src/instrumentation.ts:542`. In `@sentry/node`, `getTraceLifecycle` returns the explicit option before it reads `SENTRY_TRACE_LIFECYCLE`, so an env value cannot override it. `@sentry/vercel-edge` uses `options.traceLifecycle ?? env`, same precedence. The real-SDK case asserts the item type is `transaction`, not `span`, and that the token is absent from the whole serialised envelope, header `trace` block included. |
| CR-02 | **Resolved** | `beforeBreadcrumb` drops `category === "console"` (`:549`). I scanned every non-test `src` call to `captureToSentry`, `addSentryBreadcrumb`, `captureMessage`, `captureException` and `addBreadcrumb`, directly and through a local bound to the renderer. None carries `scrubSeamError` output. The one `extra` that does is `cron/flag-monitor` (through `monitorReadFailed`), which is already in `<deferred>`, and its value is a Sentry-API fetch error. Sentry Logs are not enabled (no `enableLogs`), so console lines have no other route into Sentry. |
| WR-09 | **Resolved** for the Plausible tracker | `PlausibleScript` returns `null` on `isScenarioSharePath` (`src/app/PlausibleScript.tsx:89`). The pins cover the token path, the bare prefix and the `/scenario-shared/abc` boundary. Residuals of the pre-existing channel are in IN-11. |
| WR-10 | **Resolved** | `catch (err)` passes the class name into the `scrub_error` tag and the log payload (`:459-469`). The test asserts `TypeError`. A LOW side effect is in IN-10. |
| WR-11 | **Resolved** | The `tally` counts omissions. The marker is `"0"` or `"omitted=N"`. The log line carries `event_id`, `channel` and `omitted` (`:161-187`). Tests pin both `omitted=1` paths. |
| WR-12 | **Resolved** | The gate is a plain `Error` with no subclass, no `cause` and a string `code` or `message` (`:632-654`). Only `JSON.parse` is inside the `try`. The renderer outside it, `scrubSeamErrorForCapture` (`src/lib/seam-redaction.ts:501-513`), has its own catch-all and returns a fixed string, so the report cannot be lost and cannot fall back to the raw error. The gate matches Next's `getProperError` output (`new Error(safeStringifyLite(obj))`, no cause, `node_modules/next/dist/lib/is-error.js`). A LOW narrowing is in IN-09. |
| IN-05 (coupled to CR-01) | **Resolved** | The skip applies only when `depth === 0 && key === "sdkProcessingMetadata"`, and only to that node's direct children. It does not spread deeper, and `dynamicSamplingContext` is still walked. `rebuildScrubbed` ignores the skip. I measured that path: a rebuild of a real transaction's `sdkProcessingMetadata` copies about 1,364 nodes and only reads the live scopes. The SDK reads `capturedSpanScope` before `beforeSend` (`@sentry/core` `client.js:213-219`) and deletes the key before serialising (`envelope.js:40`). Nothing to report. |

### Answers to the specific questions

- **Real-SDK envelope tests.**
  - *Do they exercise the registered options?* Yes. `register()` runs against the mock, then `real.init({...registered, tracesSampleRate: 1, beforeSendTransaction: wrap(registered.beforeSendTransaction), transport})` runs. `traceLifecycle`, `beforeBreadcrumb`, `beforeSend`, `dsn` and `environment` are the registered values.
  - *Can they fail?* Yes. The anti-vacuity checks are real: `toContain("transaction")` / `not.toContain("span")`, the live-scope tag still raw, and `kept-breadcrumb` present. Fix report A records a RED for each neuter.
  - *One gap.* The CR-02 envelope case has no in-test positive control showing that a console crumb would be recorded without the filter. If a future SDK drops the Console integration from its defaults, the case passes vacuously, but the leak would then be closed too.
  - *Stable and fast?* Yes on local Node 25: about 125 ms for the block, green under shuffle and when run alone, and harmless to the rest of the node project. Node 22 is unverified (see Limits).
- **Do `beforeBreadcrumb` and `traceLifecycle: "static"` break anything?**
  - No caller emits an explicit `category: "console"` breadcrumb. `addSentryBreadcrumb` callers choose their own categories.
  - The `src` comments that mention a "console + Sentry breadcrumb" are client-side, and Sentry is server-only here (`src/instrumentation.ts:408-414`).
  - With static, the scrub now rewrites transaction names that carry a token. The SDK then sets `transaction_info.source = "custom"` on those transactions (`client.js`, after `processBeforeSend`). That costs grouping only, and only on token-bearing names.
- **IN-05 skip scope:** correct as built (table above).
- **WR-12 gate:** correct for the production producer. One LOW pass-through is in IN-09.
- **`isScenarioSharePath` and Plausible:** correct, fail-closed, PATHNAME-only, and the pins prove both directions. Residuals are in IN-11 and IN-12.
  - Fix report B says PostHog still captures on the scenario lane through `factsheet-analytics.ts` inside `FactsheetView`. **I could not confirm this.** A static import walk from `src/app/scenario-share/[token]/page.tsx`, type-only imports excluded, reaches 101 files and none of them is `factsheet-analytics.ts`. `EquityChart` names `ScenarioFactsheetChart` only in a comment (`:813`). Do not book a follow-up on that claim without a fresh trace.

## Deferred channel, re-measured (not a finding against this diff; not counted)

**Direct `Sentry.captureException(plainPostgrestError)` ships `details`/`hint` (severity as a leak: HIGH).**
- **Origin:** pre-existing channel. It is already the first entry of `209-CONTEXT.md` `<deferred>`, so it does not affect `status`.
- **Measured** through the installed SDK with this repo's init options: the plain object `{ code, message, details, hint }` is delivered with `exception.values[0].value = "dup"` and **`extra.__serialized__` carrying `details` and `hint` verbatim**.
- **Sites:** `src/app/api/alert-digest/route.ts:73` and `:206`, which receive the plain `{ data, error }` objects of postgrest-js 2.118. The other sites are the ones the deferred entry lists.
- **For the follow-up:** a `scrubSentryEvent` arm that strips `details`/`hint` from `extra.__serialized__` would close every such site at once.

## Info

### IN-01: The `depth > 8` cut-off reports "clean" without looking (carried)

**File:** `src/instrumentation.ts:264`
**Origin:** pre-existing (the Phase 164 walk). Not a fix in this phase.
**Issue:** Past depth 8, `scrubRecordStrings` returns `true` without inspecting the subtree. The CONTRACT (`:425-427`) says every key is walked. This cannot be reached for channels the SDK normalises (`normalizeDepth` 3).
**Fix:** Return `false` past the cap, or state the cap in the contract.

### IN-02: Impossible-state guard (partial). Frozen or getter-only objects cannot reach most walked channels after SDK normalisation (carried)

**File:** `src/instrumentation.ts:51-306`
**Category:** necessity
**Origin:** introduced by this phase (plan 02). Not a channel.
**Issue:** `prepareEvent` rebuilds `breadcrumbs`, `user`, `contexts`, `extra` and span `data`. Only references the SDK owns (`request`, `contexts.trace`, `sdkProcessingMetadata`) can arrive frozen. This rests on judgement, and the criterion is ROADMAP-locked.
**Fix:** None required.

### IN-03: `captureToSentry` `extra`/`tags` are scrubbed for secrets only, not for `details`/`hint` (carried)

**File:** `src/lib/sentry-capture.ts:134-152`
**Origin:** pre-existing channel.
**Issue:** No current site puts a PostgREST object in `extra`. The one seam-rendered `extra` is flag-monitor, which is deferred.
**Fix:** As in iteration 1.

### IN-04: The WR-01 rebuild keeps the original stack, whose header line holds the full PostgREST JSON (carried)

**File:** `src/instrumentation.ts:660`
**Origin:** introduced by a fix in this phase (`d491a47b4`).
**Issue:** Delivery is safe today, because Sentry's stack parser skips the `Error: {...}` header line. Any raw `.stack` reader would still ship `details`/`hint`.
**Fix:** `rebuilt.stack = \`Error: ${rebuilt.message}\n\` + (error.stack ?? "").split("\n").slice(1).join("\n")`, then add `stack` to the test's anti-sentinel check.

### IN-06: The whole-event walk rewrites stack-frame paths for `factsheet-share/gone` (carried)

**File:** `src/instrumentation.ts:455`, interacting with `src/lib/scrub-share-path.ts:88-89`
**Origin:** introduced by a fix in this phase (`775fac401`).
**Issue:** Frames from `app/factsheet-share/gone/route.js` get rewritten to `.../factsheet-share/[token]/route.js`, a path that does not exist. This costs diagnostics only.
**Fix:** Skip `stacktrace` subtrees in the walk, or record the behaviour in the contract.

### IN-07: Object keys are never scrubbed (carried)

**File:** `src/instrumentation.ts:129-141`, `:304`
**Origin:** pre-existing channel. `scrubSharePath` has applied to values only since Phase 164. The WR-06 rebuild (`a587c15fe`) carries the same gap.
**Issue:** A share path used as an object key ships intact. No producer was found.
**Fix:** `out[scrubSharePath(key)]` in `rebuildScrubbed`. In the walk, treat a key that changes under the scrub as unclean.

### IN-08: Two comments contradict the code (carried)

**Files:**
- `src/app/api/og/factsheet/[id]/route.tsx:113` says the malformed path "logs nothing", and `:119` logs. Introduced by a fix in this phase (`3819b98f1` added the log under the old sentence).
- `src/lib/scrub-share-path.ts:94-95` says the placeholder "matches the pattern and maps to itself". It does not match, because `[` is outside the class. Pre-existing text.

**Fix:** Correct both sentences.

### IN-09: The WR-12 gate passes a JSON wrapper through untouched when `code` and `message` are both non-strings, even if it carries `details`/`hint`

**File:** `src/instrumentation.ts:653-654`, pinned by the `it.each` case "a JSON body whose code and message are not strings" (`src/instrumentation.test.ts`, the `[209 WR-01]` block)
**Origin:** introduced by a fix in this phase (`4263846b1`).
**Issue:** `{ code: 500, message: {...}, details: "...", hint: "..." }`, or a body with `details` and no `code`/`message`, is now captured with its full JSON message. PostgREST always sends a string `message`, so no producer exists. LOW.
**Fix (optional):** Also take the rebuild branch when the parsed object has a `details` or `hint` key.

### IN-10: The WR-10 catch arm is not itself total

**File:** `src/instrumentation.ts:465-469`
**Origin:** introduced by a fix in this phase (`4263846b1`).
**Issue:** The catch arm reads `err.name` without a guard and passes it to `scrubSharePath`. An `Error` whose `name` is a non-string, or whose `name` getter throws, makes the catch arm throw. The SDK then drops the event as `callback_error`, which loses the report. Today the only throws that escape the guarded walk are native `TypeError`s (`Array.isArray` on a revoked Proxy), so this is contrived. LOW.
**Fix (optional):** `const name = guardedRead(err, "name"); const thrown = name.ok && typeof name.value === "string" ? scrubSharePath(name.value) : typeof err;`

### IN-11: Scenario-lane residuals after WR-09: no `no-referrer` header, and the load-time invariant still scans the factsheet lane only

**Files:** `next.config.ts:363-364` (`source: "/factsheet-share/:path*"` only), and `src/app/PlausibleScript.test.tsx:125-151`, whose WR-02 scan matches `/factsheet-share` only
**Origin:** pre-existing channel. These are residuals that WR-09 did not extend, not regressions.
**Issue:**
- **Referrer.** `/scenario-share/<token>` keeps the global `strict-origin-when-cross-origin` policy. Same-origin subresource requests and link clicks from that page therefore carry the full token path as `Referer`, which reaches this app's own request logs. That is the gap the factsheet lane's `no-referrer` block exists to close.
- **Navigation.** The Plausible gate is load-time only. The invariant that makes that sufficient, no client navigation into the lane, is not enforced for the scenario lane.
- **Today.** The mint URL is used only through the clipboard (`SavedScenariosList.tsx:209`), and I found no in-app `href` or `router.push` into `/scenario-share`.

**Fix:** Book a follow-up:
- add a `/scenario-share/:path*` `no-referrer` block;
- widen the WR-02 scan regex to `\/(factsheet|scenario)-share`;
- update the `PlausibleScript` docblock's WR-02 paragraph, which names the factsheet lane only.

### IN-12: The scenario prefix now has a third hand-typed spelling

**File:** `src/lib/scrub-share-path.ts:137-140`, beside `SHARE_PATH_RE` (`:88-89`) and `src/proxy.ts:138`
**Origin:** introduced by a fix in this phase (`8d520ceaf`).
**Issue:** The module's own docblock (`:36-46`) argues for one prefix constant so spellings cannot drift. The factsheet lane has `SHARE_ROUTE_PREFIX`. The scenario lane now spells `"/scenario-share"` literally in three places. LOW.
**Fix (optional):** Add `SCENARIO_SHARE_ROUTE_PREFIX` and use it in `isScenarioSharePath` and the regex alternation.

---

_Reviewed: 2026-11-14T03:10:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
_Iteration: 3_
