# Phase 209: SCRUBLEAKS - Research

**Researched:** 2026-11-14 (HEAD `b8cc9adc6`, worktree branch `feat/209-scrubleaks`)
**Domain:** Sentry capture-boundary scrubbing, `beforeSend` robustness, one public OG route, one coded 400, one audit-law gap
**Confidence:** HIGH for S1, S3, S4, S5 (each edit was prototyped and the neighbouring suites run; every prototype was reverted from a byte backup, `git status` clean afterwards). S2 (`beforeSend`) is **design-only**: its "current behaviour" table is measured on the unmodified code, but the recommended mechanism was not prototyped.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01..D-05: Capture-boundary scrub (SC1, `204-SENTRY-RAW-SUPABASE-ERRORS`)**
- **D-01. Gate on "non-Error object", as the ROADMAP says.** The TODOS fix direction said "a non-`Error` object carrying `code`". SC1 is broader, so the ROADMAP wording governs. A `{ message, details }` object without `code` must not pass `details` through either.
- **D-02. The cause chain is in scope.** `scrubCaptureInput` folds an `Error`'s `cause` through `scrubSeamError` (`sentry-capture.ts` around line 108), and `describeThrown` renders `details=` / `hint=` for a plain-object cause. Fixing only the top-level branch would leave `new Error("x", { cause: pgError })` leaking. The fix and the test cover three cases: a plain object, an `Error` with a plain-object cause, and a nested cause (Error → Error → plain object).
- **D-03. Do NOT remove `details` / `hint` from `PLAIN_OBJECT_DIAGNOSTIC_KEYS`.** `describeThrown` is shared with the seam logs (Vercel console), where those fields are deliberately kept for operators (its comment names the A-10 harm). The Sentry path gets its own opt-out instead. Suggested shape: an exported capture-specific variant in `src/lib/seam-redaction.ts` (or an option on `scrubSeamError`) whose key list omits `details` and `hint`, used for the top-level non-Error branch and for the cause fold. `src/lib/sentry-capture.ts` must keep importing only `./seam-redaction` (it is imported by `"use client"` components).
- **D-04. Keep the current rendered string shape, minus the two fields** (`code=… message=…`). Do not switch to a rebuilt `Error`: that would change Sentry issue grouping for existing issues.
- **D-05. The no-named-field fallback must not dump a plain object on the capture path.** `describeThrown`'s fallback (custom `toString`, else a capped serialisation) can carry arbitrary row values. On the capture path, a plain object with no allowlisted field renders a fixed placeholder, not a serialisation. The planner checks existing `sentry-capture` tests for any reliance on the serialised fallback and adjusts them on purpose, saying why.

**D-06..D-09: `beforeSend` that cannot throw (SC2, `SHARE-QA-07`)**
- **D-06. Assign only when `scrubSharePath` changed the string,** the TODOS entry's own recommended remedy. This shrinks writes to the rare token match.
- **D-07. That alone is not enough.** A frozen, sealed or getter-only property that DOES hold a share token still throws on write, and a throwing getter throws on read. Every read and every write in the walk is guarded.
- **D-08. The conflict case (a token that cannot be removed in place): deliver the event, carry no original content for that field.** TODOS rules out shipping the event unscrubbed. The ROADMAP goal rules out losing the report. The precedent is `scrubCaptureInput`'s own fallback: still deliver, withhold the content. Concretely: when the in-place write fails, replace the containing value at the nearest writable parent with a fixed placeholder. If no writable ancestor exists (the whole event is frozen), return a minimal replacement event carrying no original strings and a marker message, rather than `null`. The planner picks the minimal mechanism that meets both halves; the test decides.
- **D-09. The whole of `scrubSentryEvent` is covered, not just `scrubRecordStrings`.** It also has unconditional direct assignments (`request.url`, `transaction`, crumb `message`, span `description`, trace `description`) and iterates `breadcrumbs` / `spans` without guards (a non-iterable value throws). The contract comment at `instrumentation.ts` (the "never to a throw inside `beforeSend`" sentence) is corrected to describe what the code now delivers.
- **D-09a. The RED test uses the conflict case.** A frozen object that contains a token: assert the event is delivered (not null, no throw) AND the token is absent from the delivered event. A frozen object with no token is a second, weaker case, not the gate. Also a getter that throws.

**D-10..D-12: OG route malformed id (SC3, `170.3-OG-MALFORMED-ID`)**
- **D-10. Check `isUuid(id)` (from `@/lib/utils`) before the read,** as `src/app/api/factsheet/[id]/tearsheet.pdf/route.ts` already does. A malformed id is treated as not-found: no DB read, generic card, the normal (long) cache, no log line as a failure, no `shouldCaptureNow` call, no capture.
- **D-11. Test changes, per the TODOS entry:** change test P3 in `route.public-access.test.tsx`, and add a separate valid-uuid read-error case that keeps the `no-store` plus one-capture behaviour pinned. The malformed-id test asserts the throttle slot is NOT spent (for example: a malformed hit, then a valid-uuid read error in the same window still captures).
- **D-12. `170.3-OG-P3-STATUS-VACUOUS` is taken in.** Its entry says "fixed together with 170.3-OG-MALFORMED-ID", and it lives in the P3 test this phase must change anyway. Give the ImageResponse mock a status, or assert the response type, then neuter to RED.

**D-13..D-14: validate-and-encrypt malformed JSON (SC4)**
- **D-13. Copy the `strategies/create-with-key` sibling exactly:** `await req.json().catch(() => null)`, then `if (!body || typeof body !== "object")` → `400` with `{ code: "KEY_MISSING_REQUIRED_FIELD", error: "Invalid request body" }` and `NO_STORE_HEADERS`. This also covers a literal `null` body. No new error code, so the wizard code catalogue does not grow.
- **D-14. A census moves.** `src/lib/wizardErrors.invariant.test.ts` pins per-route emission counts (it records `KEY_MISSING_REQUIRED_FIELD ×2` for this route). The planner updates that census on purpose in the same plan and greps for any other census that counts this route's emissions.

**D-15..D-16: `create_scenario_share` under the audit law (`SHARE-D-164-C`)**
- **D-15. Adding the name alone is decorative.** `MUTATING_RPC_RE` in `src/__tests__/audit-coverage.test.ts` anchors on a literal `.rpc("…"`, and `allocator/scenario/share/route.ts` calls through a cast-through-unknown (`(supabase.rpc as unknown as …)("create_scenario_share"`), the same gap recorded for `finalize_csv_strategy_with_returns`. `src/lib/database.types.ts` now carries `create_scenario_share` (`Args: { p_scenario_id: string; p_token_hash: string }`, `Returns: string`), so the cast is deleted and the call becomes a plain typed `supabase.rpc("create_scenario_share", …)`. The route comment that justifies the cast ("types not regenerated") is removed with it.
- **D-16. RED proof:** with the name listed and the call literal, removing the route's `logAuditEvent` (and adding no pragma) must turn `audit-coverage` RED. `src/__tests__/phase-29-frozen-spine-guards.test.ts` lists `create_scenario_share` but scans `supabase/migrations/` only, so a route edit does not trip it; the planner confirms that.

### Claude's Discretion
- Test file placement and names, helper names, and how the capture-specific key list is threaded through `seam-redaction.ts`.
- Plan split. Suggested: one plan per surface, or two plans (Sentry scrub + beforeSend; routes + audit) if that reads cleaner. All are independent.

### Deferred Ideas (OUT OF SCOPE)
Measured 2026-11-14 at `7a229d27f`, recorded rather than fixed (outside the ROADMAP success criteria):
- **Direct `Sentry.captureException` sites bypass `captureToSentry`'s scrub.** The Sentry SDK serialises a plain-object exception (including `details`/`hint`) into the event. Sites seen: `src/app/api/alert-digest/route.ts` (two PostgREST errors, `fetchError` and `updateError`), `src/lib/admin.ts` (`reportNonRlsError`), `src/app/api/cron/founder-lp-report/route.ts` (`captureSentry`), `src/app/api/cron/ops-alert/route.ts`, `src/app/api/for-quants-lead/route.ts`, and the error boundaries `src/app/error.tsx` / `src/app/global-error.tsx`. The `sentry-capture.ts` docblock already records that this helper is the seam's chokepoint, not the repo's. Candidate follow-up: route those sites through `captureToSentry`, or have `scrubSentryEvent` drop `details`/`hint` from serialised exception extras. Route to a follow-up entry or phase at ship.
- `src/app/api/cron/flag-monitor/route.ts` puts `scrubSeamError(err)` into `extra`; `err` there is a Sentry-API fetch failure, not a PostgREST object, so no `details`/`hint` today. Noted only.
- **`170.3-OG-NOTFOUND-CACHE`** (a not-yet-published strategy's blank card is cached for a day). Its trigger ("the next phase touching `src/app/api/og/`") fires with this phase, but the ROADMAP does not list it and the cache policy for a genuine not-found is a separate decision. Stays open; reported at ship.
</user_constraints>

<phase_requirements>
## Phase Requirements

The phase carries no requirement IDs (`**Requirements**: TBD` in ROADMAP). The five ROADMAP success criteria are the contract; they map as follows.

| ID | Description | Research Support |
|----|-------------|------------------|
| SC1 | `scrubCaptureInput` scrubs non-Error objects | Section S1: measured leak (3 shapes), capture-mode design, census and RED matrix |
| SC2 | `scrubRecordStrings` survives frozen / getter-only objects | Section S2: measured throw matrix, Sentry 11.11 drop semantics, guarded-walk design |
| SC3 | Malformed OG id returns early without spending the Sentry slot | Section S3: exact test shape, measured census movement (P3, P5) |
| SC4 | Malformed JSON on validate-and-encrypt returns a coded 400 | Section S4: measured census movement (two tests), swallow-don't-log pitfall |
| SC5 | Each fix has a test that goes RED when reverted | Validation Architecture: per-fix neuter matrix |
</phase_requirements>

## Summary

All five surfaces are small, independent edits. Measured by prototyping S1, S3, S4 and S5 in turn and running the neighbouring suites (for S1: all 281 test files that import or mock `sentry-capture`, `seam-redaction`, `@sentry/nextjs` or `captureToSentry`, 7787 tests): exactly **four existing assertions move** (two for validate-and-encrypt, two in the OG public-access test) plus **one export-surface pin** if the capture variant is added as a new export of `seam-redaction.ts`. S2 was not prototyped, so no census claim is made for it beyond "nothing reads `instrumentation.ts` as text". The audit-law edit moves nothing (no pinned count) but has a trap: adding the RPC name alone is *decorative* and removing the cast alone is also not enough to be *protected*, because nothing in `audit-coverage.test.ts` fails if the call becomes invisible again. A positive-control pin (modelled on the existing Phase 191 pin) is the missing RED for that half.

The Sentry facts that shape the design were read from the installed SDK (`@sentry/core` 11.11.0): a `beforeSend` that throws is caught by `safeCallback` and the event is **dropped** (`callback_error`), not forwarded and not re-sent. A returned replacement must satisfy `isPlainObject` and an error event is recognised by `event.type === undefined`. That makes "return a minimal replacement error event" a legal move, and "return null" a legal but report-losing one.

The current `beforeSend` is more fragile than the TODOS entry claims: measured, it throws on a frozen sub-object **even when no token is present** (it assigns every string unconditionally), on a throwing getter, and on a non-iterable `breadcrumbs`. Only a sealed object survives.

**Primary recommendation:** (1) thread a `"capture"` mode through `describeThrown` in `seam-redaction.ts` and expose one new export `scrubSeamErrorForCapture` (update the hand-typed export-set pin on purpose); (2) rewrite `scrubSentryEvent` around two guarded helpers (a slot-scrub that assigns only on change and verifies by read-back, and a recursive walk that escalates an unwritable subtree to its nearest writable parent as a shape-preserving placeholder, with a minimal replacement error event as the last resort); (3) guard the OG read behind `isUuid(id)`; (4) copy the create-with-key body guard; (5) un-cast the scenario-share RPC call, list the name, and add a positive-control pin.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Scrub error values before they leave the process | API / Backend (server runtime: route handlers, `after()`) | Browser (6 `"use client"` importers of `sentry-capture.ts`) | `captureToSentry` is the chokepoint; it must stay import-free of `next/server` because browser bundles import it |
| Final-hop event scrub (`beforeSend`) | API / Backend (Sentry init in `register()`, server-only in this repo) | none | No client `Sentry.init` exists (per `instrumentation.ts` docblock) |
| OG card id validation | API / Backend (route handler) | CDN / Static (cache header decides CDN behaviour) | A malformed id must not reach the DB and must keep the long CDN cache |
| Request-body validation (validate-and-encrypt) | API / Backend | none | Coded envelope with `NO_STORE_HEADERS` |
| Audit-law enforcement for a mutating RPC | API / Backend (route emits `logAuditEvent`) | Test tier (`audit-coverage.test.ts` is the gate) | The gate reads route source text, so call shape is part of the contract |

## Standard Stack

No package is added, removed or upgraded. The phase edits first-party code and tests only.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@sentry/nextjs` | declared `^11.8.0`, installed 11.11.0 (`@sentry/core` 11.11.0) | `captureException`, `beforeSend` host | Already the project's SDK [VERIFIED: package.json:33; node_modules/@sentry/core/package.json read via `node -e`] |
| `vitest` | 5.0.5 | Test runner | Run header printed `RUN  v5.0.5` this session [VERIFIED: `npx vitest run` output] |
| `zod` 4 | repo-pinned | Already used by scenario-share route body schema | Unchanged |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| New export `scrubSeamErrorForCapture` | Third positional/option arg on `scrubSeamError` | Option avoids moving the export-set pin, but a flag on the shared entry point is easier to forget at a call site; the new export is greppable and self-documenting. Either satisfies D-03. |
| Walk only the named event fields (current) | One generic guarded walk over the whole event | Generic is a strict superset (also scrubs `exception.values`, `contexts.*`), which is a behaviour change nobody asked for. Keep the named fields; make each op guarded. |

**Installation:** none.

**Version verification:** no new packages, so no registry lookup applies.

## Package Legitimacy Audit

No external packages are installed by this phase. **Packages removed due to [SLOP] verdict:** none. **Packages flagged [SUS]:** none.

## Architecture Patterns

### System Architecture Diagram

```
 call site (route / lib / client component)
   captureToSentry(err, { tags, extra, secrets })      src/lib/sentry-capture.ts
        |
        v
   scrubCaptureInput(err)  ----  try/catch fail-safe -> placeholder Error (still captured)
        |   Error?  --yes--> rebuild Error(message + " [cause: <chain>]")   <-- cause chain rendered by describeThrown
        |   no -------------> render string
        |
        |   BOTH render paths must use the CAPTURE MODE of describeThrown (seam-redaction.ts):
        |        key list = name, code, message, errno, syscall      (no details, no hint)
        |        object with no allowlisted field = fixed placeholder (no toString, no JSON dump)
        v
   scrubRecord(tags), scrubRecord(extra)  (string values only; secrets removed)
        |
        v
   import("@sentry/nextjs") -> Sentry.captureException(payload, { tags, extra, level })
        |
        v   (SDK builds the event)
   beforeSend = scrubSentryEvent        src/instrumentation.ts   (error events, type === undefined)
   beforeSendTransaction = scrubSentryEvent                       (type === "transaction")
        |   guarded walk: assign only on change; read-back check;
        |   unwritable subtree -> placeholder at nearest writable parent;
        |   root unwritable    -> minimal replacement ERROR event (never null)
        v
   safeCallback: a throw here = event DROPPED (callback_error)      [the failure this phase removes]
        v
   Sentry ingest

 OG route GET(id)  : isUuid(id)? --no--> generic card, LONG cache, no read, no log, no shouldCaptureNow
                          --yes--> existing read -> error? -> reportOgFailure -> shouldCaptureNow("og-factsheet:read")
 validate-and-encrypt POST : req.json().catch(() => null) -> not an object? -> coded 400 -> (existing flow)
 scenario share POST : supabase.rpc("create_scenario_share", ...) literal -> logAuditEvent -> audit-coverage sees both
```

### Recommended Project Structure
No new files are required. Edits land in: `src/lib/seam-redaction.ts`, `src/lib/sentry-capture.ts`, `src/instrumentation.ts`, `src/app/api/og/factsheet/[id]/route.tsx`, `src/app/api/keys/validate-and-encrypt/route.ts`, `src/app/api/allocator/scenario/share/route.ts`, plus comment-only edit in `src/app/api/strategies/[id]/share/route.ts` (see S5), and the tests named in the census table.

### Pattern 1 (S1): capture mode through `describeThrown`

**What:** add a `mode: "log" | "capture"` parameter to the private `describeThrown` (default `"log"`, so the seam logs are byte-identical), thread it through its own recursive `cause` call, and in the plain-object branch use a capture key list and the placeholder in capture mode. Expose a single new entry point and use it in both places `sentry-capture.ts` renders. Current code, verbatim:

`src/lib/seam-redaction.ts:178-186`:
```ts
const PLAIN_OBJECT_DIAGNOSTIC_KEYS: readonly string[] = [
  "name",
  "code",
  "message",
  "details",
  "hint",
  "errno",
  "syscall",
];
```
`src/lib/sentry-capture.ts:102-117` (the two call sites to change; the first is the cause fold, the second the top-level non-Error branch at `:117`):
```ts
      let message = scrubSeamString(err.message ?? "", secrets);
      const cause = (err as { cause?: unknown }).cause;
      if (cause !== undefined && cause !== null) {
        ...
        message += ` [cause: ${scrubSeamError(cause, secrets)}]`;
      }
      ...
    return scrubSeamError(err, secrets);
```

**Measured current behaviour (the leak), payload actually handed to `Sentry.captureException`:**

| Input | Dispatched payload today |
|-------|--------------------------|
| `{ code, message, details: "SENTINEL_DETAILS", hint: "SENTINEL_HINT" }` | the string `code=42501 message=permission denied details=SENTINEL_DETAILS hint=SENTINEL_HINT` |
| `new Error("x", { cause: pg })` | `Error(x [cause: code=42501 message=permission denied details=SENTINEL_DETAILS hint=SENTINEL_HINT])` |
| `Error` -> `Error` -> `pg` | `Error(x [cause: Error: y [cause: code=… details=SENTINEL_DETAILS hint=SENTINEL_HINT]])` |
| `{ message: "m", details: "SENTINEL_DETAILS" }` (no `code`) | `message=m details=SENTINEL_DETAILS` (so D-01's "no `code` gate" is real) |
| `{ status: 503, row: { email: "a@b.c" } }` (no allowlisted field) | the serialisation `{"status":503,"row":{"email":"a@b.c"}}` (so D-05 is real) |
| `Object.assign(new Error("pgmsg"), { code, details, hint })` (a thrown `PostgrestError` shape) | `Error(pgmsg)`: **safe already**, the Error branch reads `message` only [VERIFIED: measured by a scratch vitest, deleted] |

**Design points the planner must pin down:**
- Capture-mode key list is `name, code, message, errno, syscall`. Because `details`/`hint` are *absent from the list*, a throwing `details` getter is never even read.
- D-05 reading: render the fixed placeholder for **any** non-Error object that yields no allowlisted field, which includes arrays and custom-`toString` objects (`URL`, `Date`). D-05's text says "a plain object"; skipping `toString` on the capture path too is the safe reading because a class instance with a custom `toString` can print row values. This drops the useful-`toString` rendering on the capture path only. Flagged A2 below for confirmation.
- Keep the string shape `code=… message=…` (D-04). Do not rebuild an Error (grouping).
- `seam-redaction.ts` has a purity guard: no `import`, no `export … from`, no `require(`, no `import(`, no module-scope `process.env` capture, and a **hand-typed export-set pin**. Pure edits inside the file satisfy all of it [VERIFIED: src/lib/seam-redaction.test.ts:504-677].

**Prototype result (S1 exactly as in Code Examples, reverted afterwards):** the same seven inputs now dispatch `code=42501 message=permission denied` (plain), `Error(x [cause: code=42501 message=permission denied])`, `Error(x [cause: Error: y [cause: code=42501 message=permission denied]])`, `message=m` (no `code`), and the placeholder string for the no-field object, an array and a `URL`. Running all 281 test files that import or mock the touched modules (including `vi.doMock` users) gave 280 passed and **one failure: `seam-redaction.test.ts` "pins the exported surface as a hand-typed SET"**. So D-05 changes no other existing test and the nine real-`captureToSentry` route suites are green with S1 applied.

**Do NOT** rename or edit `PLAIN_OBJECT_DIAGNOSTIC_KEYS` (D-03); add a second constant.

### Pattern 2 (S2): guarded `scrubSentryEvent`

**Sentry 11.11.0 semantics, read from source:**

`node_modules/@sentry/core/build/cjs/client.js:756-776` (`processBeforeSend`), verbatim fragments:
```js
  if (isErrorEvent(processedEvent) && beforeSend) {
    const errorEvent = processedEvent;
    return safeCallback.safeCallback(
      debugBuild.DEBUG_BUILD ? "The `beforeSend` callback threw an error, dropping the event:" : "",
      () => beforeSend(errorEvent, hint),
      () => {
        onDrop("callback_error");
        return null;
      }
```
`client.js:821-826`:
```js
function isErrorEvent(event) {
  return event.type === void 0;
}
function isTransactionEvent(event) {
  return event.type === "transaction";
}
```
`client.js:644-660` rejects a non-null non-plain result (`${beforeSendLabel} must return \`null\` or a valid event.`) and `node_modules/@sentry/core/build/cjs/utils/is.js:36-38` defines `isPlainObject(wat) { return isBuiltin(wat, "Object"); }`.

Consequences, all [VERIFIED] by the lines above:
1. **A throw in `beforeSend` silently drops the event** (no replacement is sent). SHARE-QA-07's concern is real in this SDK version.
2. A returned replacement is sent as the event if it is a plain object. A replacement **without** a `type` field is routed as an error event.
3. `beforeSend` may return a promise (`safeCallback` handles thenables), not needed here.

**Measured current behaviour of `scrubSentryEvent` (scratch vitest, deleted):**

| Input | Today |
|-------|-------|
| `contexts.trace.data` = frozen object holding a token | THROWS `Cannot assign to read only property 'http.target'` |
| `extra` = frozen object, **no token** | THROWS (unconditional assignment) |
| whole event frozen, no token | THROWS |
| frozen array inside `breadcrumbs[].data` | THROWS |
| frozen crumb / frozen `request` | THROWS |
| throwing getter in `extra` | THROWS |
| `breadcrumbs: 5` or `breadcrumbs: {a:1}` | THROWS `is not iterable` |
| sealed `tags` object | OK (writes to existing keys are allowed) |

**Recommended mechanism (minimal that meets D-06..D-09a):**
1. **Slot helper:** read the slot (guarded); if it is a string, compute `next = scrubSharePath(s)`; if `next === s` do nothing (no write, so a frozen no-token object is fine, D-06); else write (guarded) then **read back** and require `holder[key] === next` (catches a setter or Proxy that swallows the write; D-07). Return whether the slot is clean.
2. **Walk helper:** `Array.isArray` / `typeof === "object"` guards, `Object.keys` inside the guard (a Proxy `ownKeys` can throw), depth cap 8 kept. It returns `false` when a subtree contains something it could neither clean nor verify (token that cannot be rewritten, unreadable getter). The parent then tries `parent[key] = placeholder`; if that write also fails it returns `false` upward (escalation = "nearest writable parent", D-08).
3. **Placeholder shape:** shape-preserving is safer for ingest than a bare string: string slot -> a fixed marker string, object -> `{}` (or one marker key), array -> `[]`. Flagged A3.
4. **Root last resort (D-08 literally, for BOTH hooks, never `null`):** when the escalation reaches the event itself, return a **new** plain object carrying a constant marker `message` and only allow-listed non-content scalars copied across with guarded reads (`event_id`, `timestamp`, `level`, `platform`, `environment`, `release`; each string passed through `scrubSharePath`). **Preserve the routing field:** copy `type` as read (guarded), because the SDK derives the envelope item type from the returned object, verbatim `node_modules/@sentry/core/build/cjs/envelope.js:37`: `const eventType = event.type && event.type !== "replay_event" ? event.type : "event";`. A replacement from `beforeSend` therefore has no `type` and ships as an error event; a replacement from `beforeSendTransaction` keeps `type: "transaction"` (and may copy `start_timestamp` and the two id fields `contexts.trace.trace_id` / `span_id`, which are content-free). Dropping `type` on a transaction would instead ship it as a spurious error issue. Whether ingest accepts the minimal transaction shape is unverified (A4); the fallback if it does not is `null` for transactions only (Open Question 4).
5. **D-09 direct assignments and iteration:** `request.url`, `transaction`, crumb `message`, span `description`, trace `description` all go through the slot helper; `breadcrumbs` and `spans` are iterated only after `Array.isArray`.
6. Correct the contract sentence at `src/instrumentation.ts:41` (`never to a throw inside \`beforeSend\`, which would drop the`) so it states what is delivered: unwritable content is withheld and the event is still delivered (a placeholder in place, or a minimal replacement event when nothing is writable).

Keep `scrubSentryEvent<T>(event: T): T` signature; the replacement is `as unknown as T`. Existing tests read the **mutated input object** back through the returned value, so in-place success must still return the same object.

### Pattern 3 (S3): OG route

`src/app/api/og/factsheet/[id]/route.tsx` GET: the read is `try { const supabase = await createClient(); … .eq("id", id) … }` and the failure path is `failed = true; reportOgFailure("read", id, …)`. Wrap the read in `if (isUuid(id))`; `data` stays `null`, `failed` stays `false`, so the existing tail yields the generic card with `LONG_CACHE_CONTROL`. Strings from the repo that tests rely on, verbatim:

`route.tsx:41-45`:
```ts
const LONG_CACHE_CONTROL = "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800";
...
const FAILURE_CACHE_CONTROL = "no-store";
```
`route.tsx:53`: `if (shouldCaptureNow(\`og-factsheet:${stage}\`)) {`; `src/lib/utils.ts:108-110`: `export function isUuid(value: unknown): value is string { return typeof value === "string" && UUID_RE.test(value); }`; sibling precedent `src/app/api/factsheet/[id]/tearsheet.pdf/route.ts:163`: `if (!isUuid(id)) {`.

Do **not** add a second `displayStrategyName(` call or change the existing `visible: true` count (`src/lib/strategy-display.test.ts` pins `"app/api/og/factsheet/[id]/route.tsx": 1`), and keep the `const FAILURE_CACHE_CONTROL = "…"` literal (the public-access test regex-reads it by symbol).

### Pattern 4 (S4): validate-and-encrypt

`src/app/api/keys/validate-and-encrypt/route.ts:144` is `const body = await req.json();` (no catch; a literal `null` body then throws on destructuring at `:145`). Sibling, verbatim (`src/app/api/strategies/create-with-key/route.ts:915-921`):
```ts
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { code: "KEY_MISSING_REQUIRED_FIELD", error: "Invalid request body" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
```
`NextResponse` and `NO_STORE_HEADERS` are already imported in the target file (`:41`, and used at `:225`). The guard sits before the limiter (`:362` region), so a malformed body burns no limiter token, consistent with B15; `limiter-ordering.test.ts` stayed green with the edit applied.

### Pattern 5 (S5): scenario-share audit law

Current cast, `src/app/api/allocator/scenario/share/route.ts:231-246` region (cast head at `:237`):
```ts
    const { data: shareId, error } = await (
      supabase.rpc as unknown as (
        fn: "create_scenario_share",
        args: { p_scenario_id: string; p_token_hash: string },
      ) => Promise<{ data: string | null; error: { code?: string; message?: string } | null }>
    )("create_scenario_share", {
      p_scenario_id: scenarioId,
      p_token_hash: hash,
    });
```
Replacement (measured to type-check, `npx tsc --noEmit -p .`, exit clean, ~35 s):
```ts
    const { data: shareId, error } = await supabase.rpc("create_scenario_share", {
      p_scenario_id: scenarioId,
      p_token_hash: hash,
    });
```
`src/lib/database.types.ts:3920-3923`: `create_scenario_share: {` / `Args: { p_scenario_id: string; p_token_hash: string }` / `Returns: string` [VERIFIED: read]. The literal `"create_scenario_share"` must stay on the **same line** as `.rpc(`: the detector is per-line (see Pitfall 4).

### Anti-Patterns to Avoid
- **Removing `details`/`hint` from `PLAIN_OBJECT_DIAGNOSTIC_KEYS`:** locked out by D-03; breaks the log-path test `preserves the SQLSTATE, message, details and hint of a PostgREST-shaped object` (`seam-redaction.test.ts:420`).
- **Returning `null` from `beforeSend` on any trouble:** loses the report, the thing SC2 forbids.
- **Returning the event unscrubbed on catch:** ships the token (TODOS rules it out).
- **Logging or capturing the `req.json()` rejection in validate-and-encrypt:** the V8 `SyntaxError` message can echo a fragment of the body, and this body carries raw exchange credentials. Swallow it exactly as the sibling does.
- **Adding the RPC name without un-casting the call** (decorative, measured below).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| UUID check | a new regex | `isUuid` from `@/lib/utils` | the canonical `UUID_RE`, already used by the sibling route |
| Cache headers on the 400 | inline header literal | `NO_STORE_HEADERS` from `@/lib/api/headers` | every key route uses it, a census (`no-store-coverage.test.ts`) reads it |
| Frozen-object handling | `structuredClone` / deep copy of the event | in-place guarded walk with escalation | a clone cannot restore Sentry's own object identity expectations and copies large events per error; `scrubSentryEvent` documents in-place mutation as deliberate |
| Error-code vocabulary | a new `BODY_INVALID`-style code | existing `KEY_MISSING_REQUIRED_FIELD` | D-13; the wizard code catalogue and its censuses must not grow |

**Key insight:** every one of these has a repo-local mechanism with a census attached; inventing a parallel one creates a second thing to keep in sync.

## Runtime State Inventory

Not a rename/refactor/migration phase: omitted by instruction. (No stored data, service config, OS registration, secret name or build artifact carries a string this phase changes. Verified by reading the five surfaces: all are source and tests.)

## Census, guard and pin inventory (the planner's main need)

### Moves ON PURPOSE (each measured by applying the edit and running the suite)

| # | Where | Today | After | Why / how measured |
|---|-------|-------|-------|--------------------|
| 1 | `src/lib/wizardErrors.invariant.test.ts`, `ROUTES` row `label: "keys/validate-and-encrypt"` (`:478`), `expectedSites: 12,` (`:483`) | 12 | **13** | Failure printed: `keys/validate-and-encrypt has 13 rejection-emitting sites under the predicate in this file's header; 12 were measured`. The new arm is `{ code, error }`-ordered and under `EMITTER_BODY_MAX_CHARS`, so it is visible. Update the prose in that row's comment block (it lists the 12 emitters and `KEY_MISSING_REQUIRED_FIELD ×2`) too. Second row at `:2541` (rate-limit census) stayed green. |
| 2 | `src/app/api/keys/validate-and-encrypt/route.test.ts:2221` `expect(src.match(/code:\s*"KEY_MISSING_REQUIRED_FIELD"/g)?.length).toBe(2);` | 2 | **3** | Printed `expected 3 to be 2`. The adjacent `KEY_VENUE_NOT_ENABLED` `toBe(2)` (`:2220`) is unaffected. |
| 3 | `src/app/api/og/factsheet/[id]/route.public-access.test.tsx` P3 (`:279-290`) | asserts the failure-path header for `"not-a-uuid"` | rewrite: generic card, **long** cache, no read, no capture, status 200 | RED when the guard is applied |
| 4 | same file, P5 `it.each` row `["malformed", MALFORMED_ID, "published"]` (`:305-318`) | asserts a `strategies` read with `["id", id]` | remove the row or assert the opposite (`STATE.observed.tables` stays `[]`) | RED when the guard is applied; the other three rows stay green |
| 5 | `src/lib/seam-redaction.test.ts:624` `pins the exported surface as a hand-typed SET` | six exports | add `scrubSeamErrorForCapture` (or whatever name is chosen) | only if S1 uses a new export; skipped if an option arg is used |

Also update the stale docblock lines at `route.public-access.test.tsx:36-37` (matrix text for P3 says "failure-path cache header").

### Must stay GREEN (guards; measured green with the relevant edit applied)

- `src/lib/seam-redaction.test.ts` log-path cases `:405-495` (details and hint kept, serialised fallback kept, `[truncated]` bound): they are the **D-03 non-regression oracle**; do not edit them.
- `src/lib/sentry-capture.test.ts` (read in full): none asserts a rendered `details=`/`hint=`/serialised string on the capture path; the only object inputs are in `never throws, for any thrown shape` (`circular`, hostile `toString`), which stay total. **No existing capture-path test relies on the serialised fallback**, so D-05 changes none of them [VERIFIED: file read in full; and the 281-file run in the S1 prototype above, in which no capture-path test failed other than the export-set pin].
- The nine route suites that mock `@sentry/nextjs` and run the **real** `captureToSentry` (csv-validate, admin match eval and recompute, keys permissions, portfolio-optimizer, scenario optimize, composite add-key, create-with-key, verify-strategy seam) plus `src/app/api/intro/route.test.ts`: run them after S1 as regression (they were not individually asserted to depend on the fallback).
- `src/app/api/og/factsheet/[id]/route.{test,figure-gate,page-agreement,stored-parity,stale-analytics}.test.tsx`: all use uuid-shaped ids (`22222222-…`, `55555555-…`, `33333333-…`, `44444444-…`, `51a10001-0000-4000-8000-00000000000b`), so the guard does not short-circuit them [VERIFIED: read]. `route.test.tsx` `F1` (`:566`) already pins no-store plus one `captureToSentry` call for a valid-uuid read error; D-11's "separate valid-uuid read-error case" can be a thin duplicate in the public-access file (needed there for the throttle-slot test), not a new coverage need.
- `src/__tests__/phase-147-series-resolution-guards.test.ts`, `figure-gate-census.test.ts`, `display-sign-single-source.test.ts`, `src/lib/strategy-display.test.ts`, `src/app/factsheet/[id]/v2/page.public-cache-key.test.tsx`: read OG route source text; stayed green with the guard applied (measured).
- `tests/integration/process-key-thin-adapters.test.ts` (outside `src`; vitest INCLUDEs `tests/**` and `tools/**`, so both were searched): it POSTs a valid JSON body to validate-and-encrypt, so S4 cannot reach it; 21 tests green at HEAD and again with S4 applied. The OG route and the scenario-share route have no test under `tests/` or `tools/`.
- `src/__tests__/no-store-coverage.test.ts`, `src/lib/api/limiter-ordering.test.ts`, `seam-*` invariants, `analytics-upstream-error.parity`, `resilient-fetch.wiring`, `critical-regressions.test.ts`, `StrategyForm.test.tsx`: stayed green with the validate-and-encrypt edit (measured, 19 files, only the one assertion in row 2 failed).
- `src/__tests__/audit-coverage.test.ts`: `expect(H_0001_UNCOVERED_ALLOWLIST).toHaveLength(6)` (`:1847`) and `detectedMutationSites >= 60` (`:1866`) are unaffected by listing the name [VERIFIED: green with name listed + literal call].
- `src/__tests__/phase-29-frozen-spine-guards.test.ts`: lists `create_scenario_share` (`:154`) but its scan is `supabase/migrations/`-only (`:329-330`); green with the route edited [VERIFIED].
- `src/app/api/allocator/scenario/share/route.test.ts`: T_SH5..T_SH9 assert `rpcSpy` called with `"create_scenario_share"`; green with the typed call [VERIFIED].
- `src/lib/seam-log-coverage.test.ts` (roster): green with the validate-and-encrypt edit [VERIFIED].
- No test reads `src/instrumentation.ts` or `src/lib/sentry-capture.ts` source text [inferred: the repo-wide reference list for those two paths contained imports and mocks only; the list was skimmed, not exhaustively read]. `contracts-registry.test.ts` pins that registered guard files exist; new test cases inside existing files need no registry entry.

## How `audit-coverage.test.ts` decides a call is audited

[VERIFIED: read `src/__tests__/audit-coverage.test.ts:380-476, 591-640`]

1. **Detection** (`findRpcMutations`, `:451-476`): per **raw source line**, `stripLineComment` (removes `//…` and same-line `/* … */` only) then `MUTATING_RPC_RE.test(line)`. The regex, verbatim (`:439-441`):
   ```ts
   const MUTATING_RPC_RE = new RegExp(
     `\\.rpc\\(\\s*['"](?:${MUTATING_RPC_NAMES.join("|")})['"]`,
   );
   ```
   `\s*` cannot cross a newline, so `.rpc(` and the quoted name must be on the same line. A cast (`(supabase.rpc as unknown as …)("name"`) never matches.
2. **Covered** (`isCovered`, `:591-640`): (a) an `@audit-skip:` pragma within 8 lines above `chainStart`; (b) `logAuditEvent(`/`logAuditEventAsUser(` within 3 lines above `chainStart`; (c) the same call anywhere from the mutation line forward, brace-balanced to the end of the enclosing function, capped at 200 lines. `chainStart` is the nearest previous non-empty, non-`.`-leading line (for the scenario route that is the comment line above the call).
3. **Measured on this route** (scratch copy of the test with the name added; route restored byte-for-byte after each step):

   | State | Result |
   |-------|--------|
   | name unlisted, literal call, `logAuditEvent` removed | GREEN (the gate never sees the call) |
   | name listed, **original cast kept**, `logAuditEvent` removed | GREEN (**decorative**: the call is invisible) |
   | name listed, literal call, `logAuditEvent` present | GREEN |
   | name listed, literal call, `logAuditEvent` removed | **RED**: `Found 1 uninstrumented mutation(s) NOT in the H-0001 allowlist: src/app/api/allocator/scenario/share/route.ts:236 > const { data: shareId, error } = await supabase.rpc("create_scenario_share", {` |

   So the D-16 RED proof is the 4th row, and **both** edits (list the name, un-cast the call) are required for it.
4. **The missing guard (recommend adding):** nothing fails if the cast ever comes back (row 2 is green). Add a positive-control pin in `audit-coverage.test.ts`, modelled on `:1034-1040` (`retractInheritedRefreshMarker counts as a mutator`): read the scenario-share route source, assert `findRpcMutations(file, src)` returns exactly one hit and `isCovered(hit, lines).reason === "audit-call"`. Neuter by re-introducing the cast: RED. Without it, SC5 is unmet for the "call stays literal" half.
5. **Landmine in a sibling file:** `src/app/api/strategies/[id]/share/route.ts:153-154` is a JSDoc that says `(supabase.rpc as unknown as …)("create_scenario_share", …)` and, on line 154, `literal \`.rpc("create_scenario_share"\` in the source`. That line **matches the detector once the name is listed** (the scan is not block-comment aware), and passes today only because a `logAuditEvent(` sits at `:342`, 188 lines ahead, inside the 200-line forward cap, with ~12 lines of margin. Reword that comment (it is also false after the un-cast: it claims the scenario route casts) so no `.rpc("create_scenario_share"` literal remains in a comment. Same rule for any new comment in the scenario route.

## Exact shape of the OG route tests

[VERIFIED: read `route.public-access.test.tsx` in full]

- **ImageResponse mock** (`:71-77`): `ImageResponse: class { headers = new Headers(); constructor(element, options) { ogCalls.push({ element, options }); } }`. There is **no `status`** property, which is why `expect(res.status ?? 200).toBe(200)` (`:285`) can never fail (`170.3-OG-P3-STATUS-VACUOUS`). Fix: add `status: number` set from `options.status ?? 200`, then assert `expect(res.status).toBe(200)` (also usable on P1, P2, P4). Neuter: add `status: 404` to the route's `ImageResponse` options, see P3 RED, restore.
- **Throttle:** `@/lib/sentry-capture` is mocked with `importActual` and only `captureToSentry` replaced, so **`shouldCaptureNow` is the real function** and the 60 s window is real; `beforeEach` calls `__resetCaptureThrottleForTests()`. `after` is mocked as `afterSpy`, running the callback at once.
- **Supabase fake:** `maybeSingle()` returns `{ data: null, error: { code: "22P02", … } }` for a non-uuid `id` filter, else the fixture row if every `eq` matched. It has **no knob for a read error on a valid uuid**; add `readError: null as { code: string; message: string } | null` to `STATE` and return it from `maybeSingle` (the `route.test.tsx` fake already has one: `STATE.readError`, `:50`).
- **"Throttle slot not spent" assertion** (recommended: behavioural, with the direct oracle as a secondary):
  1. GET the malformed id. Assert `STATE.observed.tables` is `[]` (no read), `afterSpy` not called, `captureToSentry` not called, `console.error` (already spied in `beforeEach`) not called, `Cache-Control` equals the long cache, `res.status` is 200, `expectGenericCard()` holds.
  2. Set `STATE.readError = { code: "57014", message: "canceling statement due to statement timeout" }` and GET `PUBLISHED_ID`. Assert `captureToSentry` called **once**, with `STATE.readError` and `extra` containing `strategy_id: PUBLISHED_ID`, and `Cache-Control` equals `failureCacheControl()`.
  3. Pre-fix behaviour: the malformed hit spends `og-factsheet:read`, the second capture is throttled, so the single `captureToSentry` call carries the 22P02 error and `strategy_id: "not-a-uuid"`: RED on the `toHaveBeenCalledWith` assertion.
  4. Secondary direct oracle: after the malformed hit, `shouldCaptureNow("og-factsheet:read")` returns `true` (it spends the slot as a side effect, so put it last). It couples the test to the key string, so keep the behavioural check as the primary.
- Neuter proof: delete the `isUuid` guard, see P3 and the new slot test RED, restore from the byte backup.

## Common Pitfalls

### Pitfall 1: Hash-checking only the top-level branch of S1
**What goes wrong:** the plain-object case is fixed but `new Error("x", { cause: pg })` still leaks, because the cause fold is a separate `scrubSeamError` call at `sentry-capture.ts:108`.
**How to avoid:** the capture mode must reach the recursive `describeThrown(cause, depth + 1, seen)` call inside the Error branch, not just the object branch. Test all three D-02 shapes and neuter each call site separately (a per-site neuter shows each case bites).
**Warning signs:** the plain-object test goes green while the nested test stays red.

### Pitfall 2: A frozen object with no token still throws today
**What goes wrong:** a fix that only wraps the token write in try/catch still fails the weaker D-09a case, because the unconditional write is on every string.
**How to avoid:** D-06 first (assign only on change). Measured: frozen no-token currently THROWS.

### Pitfall 3: Silent write failure
**What goes wrong:** a getter with a no-op setter, or a Proxy `set` trap that returns true, makes the write succeed without changing anything, so the token is delivered.
**How to avoid:** read back after writing and treat a mismatch as a failed write (escalate). Modules here are ESM, so a frozen write throws (strict mode); the read-back covers the non-throwing cases.

### Pitfall 4: Per-line detector and block comments
**What goes wrong:** a comment containing `.rpc("create_scenario_share"` is "a mutation" to `findRpcMutations` (see the audit section, item 5), and a multi-line `.rpc(\n  "name"` is invisible.
**How to avoid:** keep `.rpc("create_scenario_share",` on one line in code, never write that literal in a comment, and add the positive-control pin.

### Pitfall 5: Echoing the body parse error
**What goes wrong:** logging or capturing the `req.json()` rejection in validate-and-encrypt can put a fragment of raw credentials into a log or into Sentry.
**How to avoid:** `.catch(() => null)` with no logging, as in create-with-key.

### Pitfall 6: Replacement event that Sentry mis-routes
**What goes wrong:** the envelope item type comes from the returned object's `type` (`envelope.js:37`). A typeless replacement returned from `beforeSendTransaction` ships as an *error* item (a spurious issue); omitting `event_id` leaves the envelope header without one.
**How to avoid:** copy `type` (guarded) so each hook's replacement keeps its own routing; copy `event_id`/`timestamp`/`level`/`platform`/`environment`/`release` with guarded reads only.

### Pitfall 7: Editing the leaf and tripping its purity guard
**What goes wrong:** adding an import (even to share a constant) into `seam-redaction.ts` fails four purity tests, and the module-scope `process.env` capture test.
**How to avoid:** the capture key list, placeholder and mode flag live inside the file as plain constants/params.

### Pitfall 8: Process traps from the project instructions
`grep -a`, quoted zsh globs, neuter via byte backup (never `git checkout`/`restore`/`stash` on uncommitted work), no skip-ci tokens in any commit or PR text (even to deny them), a ship branch must change nothing under `.planning`, every ship writes a CHANGELOG entry plus a byte-equal `VERSION`/`package.json` bump (never `npm version`), no AI authorship trailers per the user's memory note (the system attribution reminder for this session says otherwise; the memory rule is the user's own and takes precedence).

## Code Examples

### S1: capture mode (proposed shape; names are proposals)
```ts
// seam-redaction.ts (no imports; constants stay in-file)
const CAPTURE_OBJECT_DIAGNOSTIC_KEYS: readonly string[] = ["name", "code", "message", "errno", "syscall"];
const CAPTURE_OPAQUE_OBJECT = "[non-Error object withheld from the capture]";

function describeThrown(err: unknown, depth: number, seen: Set<object>, capture = false): string { /* … */ }

export function scrubSeamErrorForCapture(err: unknown, extraSecrets: readonly unknown[] = []): string {
  try {
    return scrubSeamString(describeThrown(err, 0, new Set<object>(), true), extraSecrets);
  } catch {
    return "[seam-redaction: unrepresentable thrown value]";
  }
}
// in the object branch: const keys = capture ? CAPTURE_OBJECT_DIAGNOSTIC_KEYS : PLAIN_OBJECT_DIAGNOSTIC_KEYS;
// if (parts.length > 0) return parts.join(" ");  if (capture) return CAPTURE_OPAQUE_OBJECT;   // before the toString / JSON fallbacks
// recursion in the Error branch: describeThrown(cause, depth + 1, seen, capture)
```
```ts
// sentry-capture.ts: only two call sites change
message += ` [cause: ${scrubSeamErrorForCapture(cause, secrets)}]`;
...
return scrubSeamErrorForCapture(err, secrets);
```

### S2: guarded slot and walk (sketch)
```ts
const WITHHELD = "[withheld: share token could not be removed]";   // proposed constant

function scrubSlot(holder: Record<string, unknown>, key: string | number): boolean {
  try {
    const value = (holder as Record<string | number, unknown>)[key];
    if (typeof value !== "string") return true;
    const next = scrubSharePath(value);
    if (next === value) return true;                     // D-06: no write when unchanged
    (holder as Record<string | number, unknown>)[key] = next;
    return (holder as Record<string | number, unknown>)[key] === next;   // read-back
  } catch {
    return false;                                        // unreadable or unwritable: caller escalates
  }
}
// walk(node, depth): false when a child could not be cleaned AND `parent[key] = placeholder` also failed.
// scrubSentryEvent: if the root escalates -> minimal replacement event (marker message; `type` copied as read so each hook keeps its routing).
```

### S4 test seam (route.test.ts has only an object-body `makeReq`; add a raw-body request)
```ts
new NextRequest("http://localhost:3000/api/keys/validate-and-encrypt", {
  method: "POST",
  headers: { "content-type": "application/json", ...VALID_ORIGIN },
  body: "{not json",          // second case: body "null"
});
```
Assert `status` 400, `body.code === "KEY_MISSING_REQUIRED_FIELD"`, `body.error === "Invalid request body"`, `cache-control` contains `no-store`, `mockValidateKey` and `mockEncryptKey` not called. Neuter: restore `await req.json()`; the handler rejects, RED.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Sentry `beforeSend` throw handling | `safeCallback` swallows the throw and drops the event (`callback_error`) | present in 11.11.0 [VERIFIED: client.js] | a throwing scrub silently loses the report; hence D-08 |
| `captureToSentry` rendering a PostgREST object through the shared log renderer | capture-mode renderer without `details`/`hint` | this phase | closes `204-SENTRY-RAW-SUPABASE-ERRORS` for the seam helper only |

**Deprecated/outdated:** the comment at `src/instrumentation.ts:41` (promises "never a throw"); the cast justification comment in the scenario-share route (`:231-236`, "types not regenerated"); the JSDoc at `strategies/[id]/share/route.ts:153-154` (claims the scenario route casts).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | (withdrawn) An earlier draft proposed `null` for transactions; D-08 is followed literally for both hooks instead. Kept as a row so the planner sees the carve-out was considered. | S2 | none |
| A2 | On the capture path, **any** non-Error object with no allowlisted field renders the placeholder, including arrays and custom-`toString` objects (D-05 says "plain object"). | S1 | A useful `URL`/`Date` rendering is lost on Sentry captures only |
| A3 | Shape-preserving placeholders (`{}`/`[]`/marker string) are safe for Sentry ingest; a bare string in an object slot might be flagged by Relay as invalid data (event still stored). Not verified against Relay. | S2 | Cosmetic "invalid data" notes on a rare event |
| A4 | A minimal replacement event (`event_id`, `message`, `level`, a few scalars; for a transaction also `type`, `start_timestamp` and the two trace ids) is accepted by Sentry ingest. Verified from the SDK source only that any plain object is sent and that the item type follows `event.type`; ingest acceptance was not tested against a live DSN. | S2 | The rare replacement event could be rejected upstream (still no token leak, still no thrown scrub) |
| A5 | Three further direct `captureException` calls exist beyond CONTEXT's deferred list (`src/lib/audit.ts:222`, `src/lib/for-quants-leads-admin.ts:152`, `src/lib/preferences.ts:273`); they were not triaged for plain-object inputs. | Deferred list | Under-sized follow-up entry |
| A6 | No capture site passes a raw error object inside `extra`. Inferred from a single-line search plus reading one candidate (`supabase_err: read.markerReadError`, typed `string \| null`); multi-line `extra` blocks were not enumerated. | Open Q2 | An `extra` object carrying `details`/`hint` would still reach Sentry |
| A7 | The JSDoc line `strategies/[id]/share/route.ts:154` is matched by the detector once the name is listed. Inferred by applying the detector's regex with a repo search and observing the scratch audit test pass (so that line is covered by the forward walk); `findRpcMutations` was not run on that file in isolation. | S5 / audit item 5 | Wording of the pitfall only; rewording the comment is harmless either way |

## Open Questions (RESOLVED)

1. **New export vs option arg for the capture variant (S1).**
   - Known: a new export moves the hand-typed export-set pin (`seam-redaction.test.ts:624`); an option does not.
   - Recommendation: new export `scrubSeamErrorForCapture`, update the pin with a one-line reason. Planner may choose the option if it prefers zero census movement.
   - RESOLVED: plan 01 adds the new export `scrubSeamErrorForCapture` and moves the export-set pin on purpose.
2. **Should the `extra` channel be in scope?** `scrubValue` copies nested objects wholesale, so an `extra` value that is itself a raw PostgREST object still ships `details`/`hint`. No capture site was found passing a raw error object in `extra` (A6; the one candidate, `supabase_err: read.markerReadError`, is typed `string | null`, `src/lib/latest-holdings-per-key.ts:348`). CONTEXT scopes S1 to `scrubCaptureInput`; record the `extra` residual at ship rather than fixing it.
   - RESOLVED: out of scope per CONTEXT; recorded as a residual at ship.
3. **Minimal transaction replacement vs `null` (S2).** Default is D-08 literal (replacement for both hooks, `type` preserved). If a live check shows ingest rejects the minimal transaction shape, the fallback is `null` for `type === "transaction"` only, with the contract comment saying so. Decide at plan review; cheap to flip because it is one branch.
   - RESOLVED: plan 02 follows D-08 literally for both hooks; the `null`-for-transactions fallback is not taken, and A3/A4 stay recorded assumptions in its SUMMARY.
4. **TODOS closure edits** (`204-SENTRY-RAW-SUPABASE-ERRORS`, `SHARE-QA-07`, `170.3-OG-MALFORMED-ID`, `170.3-OG-P3-STATUS-VACUOUS`, the validate-and-encrypt entry, `SHARE-D-164-C`) belong to the ship/records step, not the research or plans.
   - RESOLVED: handled at ship/records.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node + npm | all | yes | present (vitest and tsc ran) | none needed |
| vitest | all tests | yes | 5.0.5 | none needed |
| `tsc` | typecheck of the un-cast RPC call | yes | ran clean, ~35 s | none needed |
| Live Sentry DSN / database | none (all measured with mocks/fakes) | not needed | n/a | n/a |

No missing dependencies. No database is touched, so the project's "which database am I on" marker query does not apply.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 5.0.5 (jsdom default project; `src/instrumentation.test.ts` and `src/lib/seam-redaction.test.ts` run in the node project via `vitest.node-env.ts`) |
| Config file | `vitest.config.ts` (+ `vitest.node-env.ts`, `vitest.local-stack-files.ts`) |
| Quick run command | `npx vitest run src/lib/sentry-capture.test.ts src/lib/seam-redaction.test.ts src/instrumentation.test.ts src/lib/scrub-share-path.test.ts src/app/api/og src/app/api/keys/validate-and-encrypt src/lib/wizardErrors.invariant.test.ts src/lib/wizardErrors.test.ts src/__tests__/audit-coverage.test.ts src/app/api/allocator/scenario/share src/__tests__/phase-29-frozen-spine-guards.test.ts src/app/api/intro src/app/api/strategies/create-with-key` (baseline at HEAD: 21 files, 911 tests, 3 s, all green) |
| Full suite command | `npx vitest run` (full), plus `npm run typecheck` (`tsc --noEmit`, ~35 s) and `npm run lint` (eslint + route manifest + planning hygiene) |

### Phase Requirements -> Test Map
| Req | Behavior | Test Type | Automated Command | File Exists? |
|-----|----------|-----------|-------------------|-------------|
| SC1 | plain object with `details`/`hint` sentinels, `Error` with plain cause, nested cause: no sentinel in payload/tags/extra; placeholder for no-field object; `code=… message=…` kept | unit | `npx vitest run src/lib/sentry-capture.test.ts src/lib/seam-redaction.test.ts` | extend existing (new `describe` in `sentry-capture.test.ts`; export-set pin edit in `seam-redaction.test.ts`) |
| SC1 (non-regression) | log path still shows `details`/`hint` and the serialised fallback | unit | same | existing cases `seam-redaction.test.ts:420, :453, :464` |
| SC2 | frozen sub-object holding a token in `contexts.trace.data`, `extra`, `tags`: no throw, non-null, token absent from `JSON.stringify`; throwing getter; frozen no-token; non-iterable `breadcrumbs`; whole-event-frozen -> replacement with marker; getter-only holding token | unit | `npx vitest run src/instrumentation.test.ts src/lib/scrub-share-path.test.ts` | extend existing (`describe` at `:90`; import `scrubSentryEvent` directly or use the registered `beforeSend`) |
| SC3 | malformed id: no read, generic card, long cache, status 200, no `afterSpy`/`captureToSentry`/`console.error`; then valid-uuid read error still captures once | unit | `npx vitest run src/app/api/og` | extend `route.public-access.test.tsx` (P3, P5, new case, mock `status`, `readError` knob) |
| SC4 | malformed JSON and literal `null` body -> 400 coded envelope with no-store, no key probe | unit | `npx vitest run src/app/api/keys/validate-and-encrypt src/lib/wizardErrors.invariant.test.ts` | extend `route.test.ts` + move two censuses |
| SC5 / S5 | listed name + literal call + removed `logAuditEvent` -> RED; positive-control pin keeps the call literal | unit (source scan) | `npx vitest run src/__tests__/audit-coverage.test.ts src/app/api/allocator/scenario/share` | extend `audit-coverage.test.ts` (list name, add pin) |

### Neuter-to-RED matrix (record each in the SUMMARY; restore from a byte backup, never git checkout/restore/stash)
| Fix | Neuter | Expected RED |
|-----|--------|--------------|
| S1 top-level | call log-mode `scrubSeamError` at `sentry-capture.ts:117` | plain-object sentinel test (cause tests stay green) |
| S1 cause fold | call log-mode `scrubSeamError` at `:108` | Error-with-cause and nested tests |
| S1 key list | add `details`/`hint` to the capture list | all three |
| S1 placeholder | fall through to serialisation in capture mode | no-field-object test |
| S2 | restore unconditional assignment in the slot helper | frozen no-token and frozen-with-token cases |
| S2 escalation | make the slot helper fail without escalating | delivered-event token-absent assertion |
| S2 iteration | iterate `breadcrumbs` without `Array.isArray` | non-iterable case |
| S3 | delete the `isUuid` guard | P3 and the slot-not-spent test |
| S3 status | add `status: 404` to the route's `ImageResponse` options | P3 `res.status` assertion |
| S4 | restore `await req.json()` | malformed-JSON and `null` tests |
| S5 | delete the route's `logAuditEvent(` block | `audit-coverage` corpus test, naming `scenario/share/route.ts` |
| S5 | re-introduce the cast | the new positive-control pin |

### Sampling Rate
- **Per task commit:** the quick run command (3 s).
- **Per wave merge:** quick run + `npm run typecheck` + the nine real-`captureToSentry` route suites + the OG census readers listed above.
- **Phase gate:** full `npx vitest run`, `npm run typecheck`, `npm run lint` green before `/gsd-verify-work`.

### Wave 0 Gaps
None. Existing infrastructure covers every requirement; no new test file, framework or fixture is required (all new cases extend existing files; optionally add new `.test.ts` files to `vitest.node-env.ts` only if they use no DOM token).

## Security Domain

`security_enforcement` is not set to `false` in `.planning/config.json` (the key is absent from the file), so it is treated as enabled.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | (validate-and-encrypt keeps its `withAuth`; no change) |
| V3 Session Management | no | n/a |
| V4 Access Control / audit | yes | `logAuditEvent` on every mutating RPC, enforced by `audit-coverage.test.ts` |
| V5 Input Validation | yes | `isUuid` for the OG path id; body-shape guard with a coded 400 |
| V6 Cryptography | no | n/a (no crypto touched) |
| V7 Error handling and logging | yes | scrub at the capture boundary; fail-safe (still deliver, withhold content) |
| V8 Data protection (third-party disclosure) | yes | `details`/`hint` can hold failing-row values (requester data); never forwarded to Sentry |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| PostgREST `details`/`hint` row values reach a third party | Information Disclosure | capture-mode renderer without those keys; placeholder for opaque objects |
| Share capability token in an event field that cannot be rewritten | Information Disclosure | withhold at the nearest writable parent; replacement event as last resort |
| Throwing scrub silently drops an alert | Denial of Service (of observability) | guarded reads/writes, escalation instead of throw |
| Malformed public id exhausts the one-per-minute Sentry slot (masking real read failures) | Denial of Service (of alerting) | reject malformed id before the read, before `shouldCaptureNow` |
| Body parse error echoes raw credentials | Information Disclosure | swallow the parse error, never log or capture it |
| Mutating RPC without an audit trail | Repudiation | listed in `MUTATING_RPC_NAMES`, literal call, positive-control pin |

## Project Constraints (from CLAUDE.md)

Extracted directives that bind this phase (project `CLAUDE.md`, `AGENTS.md`, and the user's global `CLAUDE.md`):
- **Next.js differs from training data** (`AGENTS.md`): read `node_modules/next/dist/docs/` before any Next-API change. This phase uses no new Next API (`after()`, `ImageResponse`, `NextRequest` are already in use); do not introduce one.
- **Tests verify intent:** every fix needs a test that can fail; neuter, see RED, restore from a byte backup (never `git checkout`/`restore`/`stash` on uncommitted work). Always `grep -a`. A new `supabase/tests` file or arm moves several censuses (not applicable: no SQL here).
- **Surgical changes / match conventions:** touch only the listed surfaces; the only adjacent edit justified is the stale JSDoc at `strategies/[id]/share/route.ts:153-154` (it becomes false and, once the name is listed, is matched by the detector).
- **CHANGELOG discipline:** every ship writes a CHANGELOG entry (this repo's section vocabulary, grouped by theme, every commit mapped) and a `VERSION`/`package.json` byte-equal 4-digit bump in the same `chore(release)` commit; never `npm version`.
- **CI skip trailer:** never write the skip tokens in any commit message or PR body, not even to deny them.
- **Ship branch changes nothing under `.planning`**; bookkeeping goes to main afterwards.
- **No AI authorship attribution** in commits or PRs (user memory note, 2026-10-20).
- **Public repo with tracked `.planning/`:** no secrets, PROD ids, home paths or account numbers in tracked text; never quote a credential-shaped fixture literal in CHANGELOG prose (the push-to-main gitleaks scan).
- **Completion is historical:** verification frontmatter uses `verified_at_sha` + `drift_subjects`, never `covered_digest`/`covered_files`.
- **Agents:** never hand-dispatch `gsd-*` agents; no more than 7 concurrent agents; give agents separate worktrees and explicit `git add` paths.
- **Database:** none is touched here; if that changes, run the `COMMENT ON DATABASE` marker query before any write.

## Sources

### Primary (HIGH confidence)
- Repo source read this session (cited with paths and line ranges inline): `src/lib/sentry-capture.ts`, `src/lib/seam-redaction.ts`, `src/instrumentation.ts`, `src/lib/scrub-share-path.ts`, `src/app/api/og/factsheet/[id]/route.tsx`, `src/app/api/keys/validate-and-encrypt/route.ts`, `src/app/api/strategies/create-with-key/route.ts`, `src/app/api/allocator/scenario/share/route.ts`, `src/app/api/strategies/[id]/share/route.ts`, `src/__tests__/audit-coverage.test.ts`, `src/lib/wizardErrors.invariant.test.ts`, `src/lib/database.types.ts`, and the test files named in the census section.
- `node_modules/@sentry/core/build/cjs/client.js` (lines 620-715, 756-826), `utils/safeCallback.js`, `utils/is.js` (installed 11.11.0).
- Measurements: scratch vitest runs (deleted) for current capture and `beforeSend` behaviour; scratch copy of `audit-coverage.test.ts` (deleted) for the audit matrix; temporary edits to the OG, validate-and-encrypt and scenario-share routes (each restored from a byte backup; `git status` clean after each step); `npx tsc --noEmit -p .` clean with the typed RPC call.

### Secondary (MEDIUM confidence)
- TODOS.md entries `204-SENTRY-RAW-SUPABASE-ERRORS`, `SHARE-QA-07`, `170.3-OG-MALFORMED-ID`, `170.3-OG-P3-STATUS-VACUOUS`, `SHARE-D-164-C`, "Two guard gaps on `keys/validate-and-encrypt`" (the heading says two gaps; only the bare `req.json()` gap is recorded under it at HEAD).

### Tertiary (LOW confidence)
- Sentry Relay/ingest acceptance of a minimal replacement event and of shape-preserving placeholders (A3, A4): not tested against a live DSN.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH, no change, versions read from the installed tree.
- Architecture: HIGH for S1, S3, S4, S5 (prototyped); MEDIUM for S2 (design-only; replacement-event details A3, A4).
- Pitfalls: HIGH, each traced to a measurement or a read of the detector.

**Research date:** 2026-11-14
**Valid until:** 30 days for the code facts, or until `src/__tests__/audit-coverage.test.ts`, `seam-redaction.ts` or `@sentry/core` changes (re-measure rather than trust the line numbers; cite by symbol).
