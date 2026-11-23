# Phase 209: SCRUBLEAKS — error reports carry no raw database details and never get lost - Context

**Gathered:** 2026-11-14
**Status:** Ready for planning
**Mode:** autonomous smart discuss, run by the phase agent. Every grey area below had a recommended default that needed no founder judgement, so the default was taken and recorded here. No founder question was asked.

<domain>
## Phase Boundary

From ROADMAP `### Phase 209`: error reports never carry raw PostgREST `details`/`hint` and are never lost. Scrub at the capture boundary, give `beforeSend` a body that cannot throw, put a UUID guard on the signed-out OG route, and return a coded 400 for malformed JSON on validate-and-encrypt.

Closes these TODOS entries:
- `204-SENTRY-RAW-SUPABASE-ERRORS` (`scrubCaptureInput`, `src/lib/sentry-capture.ts`)
- `SHARE-QA-07` (`scrubRecordStrings` / `scrubSentryEvent`, `src/instrumentation.ts`)
- `170.3-OG-MALFORMED-ID` (`src/app/api/og/factsheet/[id]/route.tsx`)
- the validate-and-encrypt bare `req.json()` entry (TODOS "Two guard gaps on `keys/validate-and-encrypt`")
- `SHARE-D-164-C` rides along: `create_scenario_share` goes into `MUTATING_RPC_NAMES`, in a form the audit law actually reaches.

Success criteria (ROADMAP, verbatim):
1. `scrubCaptureInput` scrubs non-Error objects, so no capture site can forward `details`/`hint`.
2. `scrubRecordStrings` survives frozen and getter-only objects without losing the report.
3. A malformed id on the OG route returns early without spending the Sentry slot.
4. Malformed JSON on validate-and-encrypt returns a coded 400.
5. Each fix has a test that goes RED when it is reverted.

</domain>

<decisions>
## Implementation Decisions

### D-01..D-05: Capture-boundary scrub (SC1, `204-SENTRY-RAW-SUPABASE-ERRORS`)
- **D-01: Gate on "non-Error object", as the ROADMAP says.** The TODOS fix direction said "a non-`Error` object carrying `code`". SC1 is broader, so the ROADMAP wording governs. A `{ message, details }` object without `code` must not pass `details` through either.
- **D-02: The cause chain is in scope.** `scrubCaptureInput` folds an `Error`'s `cause` through `scrubSeamError` (`sentry-capture.ts` around line 108), and `describeThrown` renders `details=` / `hint=` for a plain-object cause. Fixing only the top-level branch would leave `new Error("x", { cause: pgError })` leaking. The fix and the test cover three cases: a plain object, an `Error` with a plain-object cause, and a nested cause (Error → Error → plain object).
- **D-03: Do NOT remove `details` / `hint` from `PLAIN_OBJECT_DIAGNOSTIC_KEYS`.** `describeThrown` is shared with the seam logs (Vercel console), where those fields are deliberately kept for operators (its comment names the A-10 harm). The Sentry path gets its own opt-out instead. Suggested shape: an exported capture-specific variant in `src/lib/seam-redaction.ts` (or an option on `scrubSeamError`) whose key list omits `details` and `hint`, used for the top-level non-Error branch and for the cause fold. `src/lib/sentry-capture.ts` must keep importing only `./seam-redaction` (it is imported by `"use client"` components).
- **D-04: Keep the current rendered string shape, minus the two fields** (`code=… message=…`). Do not switch to a rebuilt `Error`: that would change Sentry issue grouping for existing issues.
- **D-05: The no-named-field fallback must not dump a plain object on the capture path.** `describeThrown`'s fallback (custom `toString`, else a capped serialisation) can carry arbitrary row values. On the capture path, a plain object with no allowlisted field renders a fixed placeholder, not a serialisation. The planner checks existing `sentry-capture` tests for any reliance on the serialised fallback and adjusts them on purpose, saying why.

### D-06..D-09: `beforeSend` that cannot throw (SC2, `SHARE-QA-07`)
- **D-06: Assign only when `scrubSharePath` changed the string,** the TODOS entry's own recommended remedy. This shrinks writes to the rare token match.
- **D-07: That alone is not enough.** A frozen, sealed or getter-only property that DOES hold a share token still throws on write, and a throwing getter throws on read. Every read and every write in the walk is guarded.
- **D-08: The conflict case (a token that cannot be removed in place): deliver the event, carry no original content for that field.** TODOS rules out shipping the event unscrubbed. The ROADMAP goal rules out losing the report. The precedent is `scrubCaptureInput`'s own fallback: still deliver, withhold the content. Concretely: when the in-place write fails, replace the containing value at the nearest writable parent with a fixed placeholder. If no writable ancestor exists (the whole event is frozen), return a minimal replacement event carrying no original strings and a marker message, rather than `null`. The planner picks the minimal mechanism that meets both halves; the test decides.
- **D-09: The whole of `scrubSentryEvent` is covered, not just `scrubRecordStrings`.** It also has unconditional direct assignments (`request.url`, `transaction`, crumb `message`, span `description`, trace `description`) and iterates `breadcrumbs` / `spans` without guards (a non-iterable value throws). The contract comment at `instrumentation.ts` (the "never to a throw inside `beforeSend`" sentence) is corrected to describe what the code now delivers.
- **D-09a: The RED test uses the conflict case.** A frozen object that contains a token: assert the event is delivered (not null, no throw) AND the token is absent from the delivered event. A frozen object with no token is a second, weaker case, not the gate. Also a getter that throws.

### D-10..D-12: OG route malformed id (SC3, `170.3-OG-MALFORMED-ID`)
- **D-10: Check `isUuid(id)` (from `@/lib/utils`) before the read,** as `src/app/api/factsheet/[id]/tearsheet.pdf/route.ts` already does. A malformed id is treated as not-found: no DB read, generic card, the normal (long) cache, no log line as a failure, no `shouldCaptureNow` call, no capture.
- **D-11: Test changes, per the TODOS entry:** change test P3 in `route.public-access.test.tsx`, and add a separate valid-uuid read-error case that keeps the `no-store` plus one-capture behaviour pinned. The malformed-id test asserts the throttle slot is NOT spent (for example: a malformed hit, then a valid-uuid read error in the same window still captures).
- **D-12: `170.3-OG-P3-STATUS-VACUOUS` is taken in.** Its entry says "fixed together with 170.3-OG-MALFORMED-ID", and it lives in the P3 test this phase must change anyway. Give the ImageResponse mock a status, or assert the response type, then neuter to RED.

### D-13..D-14: validate-and-encrypt malformed JSON (SC4)
- **D-13: Copy the `strategies/create-with-key` sibling exactly:** `await req.json().catch(() => null)`, then `if (!body || typeof body !== "object")` → `400` with `{ code: "KEY_MISSING_REQUIRED_FIELD", error: "Invalid request body" }` and `NO_STORE_HEADERS`. This also covers a literal `null` body. No new error code, so the wizard code catalogue does not grow.
- **D-14: A census moves.** `src/lib/wizardErrors.invariant.test.ts` pins per-route emission counts (it records `KEY_MISSING_REQUIRED_FIELD ×2` for this route). The planner updates that census on purpose in the same plan and greps for any other census that counts this route's emissions.

### D-15..D-16: `create_scenario_share` under the audit law (`SHARE-D-164-C`)
- **D-15: Adding the name alone is decorative.** `MUTATING_RPC_RE` in `src/__tests__/audit-coverage.test.ts` anchors on a literal `.rpc("…"`, and `allocator/scenario/share/route.ts` calls through a cast-through-unknown (`(supabase.rpc as unknown as …)("create_scenario_share"`), the same gap recorded for `finalize_csv_strategy_with_returns`. `src/lib/database.types.ts` now carries `create_scenario_share` (`Args: { p_scenario_id: string; p_token_hash: string }`, `Returns: string`), so the cast is deleted and the call becomes a plain typed `supabase.rpc("create_scenario_share", …)`. The route comment that justifies the cast ("types not regenerated") is removed with it.
- **D-16: RED proof:** with the name listed and the call literal, removing the route's `logAuditEvent` (and adding no pragma) must turn `audit-coverage` RED. `src/__tests__/phase-29-frozen-spine-guards.test.ts` lists `create_scenario_share` but scans `supabase/migrations/` only, so a route edit does not trip it; the planner confirms that.

### D-17..D-18: Review round 2 additions (recorded by the phase agent 2026-11-14, from 209-REVIEW.md iteration 2)
- **D-17: Turn off streamed tracing.** Sentry 11's default `traceLifecycle: "stream"` never calls `beforeSendTransaction`, so streamed spans shipped the raw share token (review CR-01, measured through the real SDK with tracing sampled at 10%). `Sentry.init` sets `traceLifecycle: "static"`, so transactions pass through `scrubSentryEvent`. The root walk then skips the live SDK objects under `sdkProcessingMetadata` (IN-05) and keeps walking `dynamicSamplingContext`.
- **D-18: Drop console breadcrumbs.** Sentry's default Console integration copied seam log lines, which keep `details`/`hint` by D-03, onto the next captured event as breadcrumbs (review CR-02, measured). `Sentry.init` gets `beforeBreadcrumb` returning `null` for `category === "console"`. The cost: Sentry events lose their console trail, which still lives in the Vercel logs. A message-pattern filter was rejected because console breadcrumbs can carry the raw arguments under `data`.
- **Test rule for both:** each one is proven through the real SDK with an in-memory transport, reading the serialised envelope. A fixture-only test missed both leaks.

### Claude's Discretion
- Test file placement and names, helper names, and how the capture-specific key list is threaded through `seam-redaction.ts`.
- Plan split. Suggested: one plan per surface, or two plans (Sentry scrub + beforeSend; routes + audit) if that reads cleaner. All are independent.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `scrubSeamError` / `scrubSeamString` / `describeThrown` / `PLAIN_OBJECT_DIAGNOSTIC_KEYS` in `src/lib/seam-redaction.ts`.
- `scrubCaptureInput`, `scrubRecord`, `captureToSentry`, `shouldCaptureNow`, `__resetCaptureThrottleForTests` in `src/lib/sentry-capture.ts`.
- `scrubSharePath` (used by `scrubSentryEvent`) and `scrubSentryEvent` exported from `src/instrumentation.ts`.
- `isUuid` in `src/lib/utils.ts`.
- `CreateShareRpcClient` pattern in `src/app/api/strategies/[id]/share/route.ts` (the literal-call shape for a mutating RPC).
- The per-site assertion shape in `src/app/api/intro/route.test.ts` (Phase 204) for a `details`/`hint` sentinel.

### Established Patterns
- Fail-safe scrubbing: a scrub failure must neither throw into the caller nor cancel the capture; it degrades to content-free output.
- Non-throwing PostgREST path: `{ data, error }` returns a PLAIN object, not a `PostgrestError` instance (postgrest-js 2.118 constructs the class only under `throwOnError`).
- Coded error envelopes: `{ code, error }` with `NO_STORE_HEADERS` on key routes.
- Neuter-to-RED discipline: neuter the fix, see RED, restore from a byte backup (never git checkout/restore/stash on uncommitted work).

### Integration Points
- `Sentry.init({ beforeSend: scrubSentryEvent, beforeSendTransaction: scrubSentryEvent })` in `src/instrumentation.ts`.
- `reportOgFailure` in the OG route spends the `og-factsheet:read` throttle slot.
- `MUTATING_RPC_NAMES` / `MUTATING_RPC_RE` in `src/__tests__/audit-coverage.test.ts`.

</code_context>

<specifics>
## Specific Ideas

- SC1 gate test: a plain-object error with `details` and `hint` sentinels passed to `captureToSentry` must not put either sentinel anywhere in what `Sentry.captureException` receives (payload, tags, extra). Same for an `Error` with that object as `cause`, and for a nested cause.
- SC2 gate test: a frozen sub-object holding a share token inside `contexts.trace.data` (and inside `extra`/`tags`): `scrubSentryEvent` does not throw, returns a non-null event, and the token is absent from `JSON.stringify` of the result.
- Every fix gets a neuter-to-RED proof recorded in its SUMMARY.

</specifics>

<deferred>
## Deferred Ideas

Measured 2026-11-14 at `7a229d27f`, recorded rather than fixed (outside the ROADMAP success criteria):
- **Direct `Sentry.captureException` sites bypass `captureToSentry`'s scrub.** The Sentry SDK serialises a plain-object exception (including `details`/`hint`) into the event. Sites seen: `src/app/api/alert-digest/route.ts` (two PostgREST errors, `fetchError` and `updateError`), `src/lib/admin.ts` (`reportNonRlsError`), `src/app/api/cron/founder-lp-report/route.ts` (`captureSentry`), `src/app/api/cron/ops-alert/route.ts`, `src/app/api/for-quants-lead/route.ts`, and the error boundaries `src/app/error.tsx` / `src/app/global-error.tsx`. The `sentry-capture.ts` docblock already records that this helper is the seam's chokepoint, not the repo's. Candidate follow-up: route those sites through `captureToSentry`, or have `scrubSentryEvent` drop `details`/`hint` from serialised exception extras. Route to a follow-up entry or phase at ship.
- `src/app/api/cron/flag-monitor/route.ts` puts `scrubSeamError(err)` into `extra`; `err` there is a Sentry-API fetch failure, not a PostgREST object, so no `details`/`hint` today. Noted only.
- **`170.3-OG-NOTFOUND-CACHE`** (a not-yet-published strategy's blank card is cached for a day). Its trigger ("the next phase touching `src/app/api/og/`") fires with this phase, but the ROADMAP does not list it and the cache policy for a genuine not-found is a separate decision. Stays open; reported at ship.

</deferred>
