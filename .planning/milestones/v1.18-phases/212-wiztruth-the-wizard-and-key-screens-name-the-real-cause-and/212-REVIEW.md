---
phase: 212-wiztruth-the-wizard-and-key-screens-name-the-real-cause-and
reviewed: 2026-11-14T00:00:00Z
depth: standard
diff_base: 4c4fa1993
files_reviewed: 50
files_reviewed_list:
  - analytics-service/services/mt5_probe.py
  - analytics-service/tests/test_mt5_concurrency.py
  - analytics-service/tests/test_mt5_validate_parity.py
  - src/__tests__/gdpr-export-route.test.ts
  - src/__tests__/no-email-in-copy.test.ts
  - src/__tests__/redteam-b02-regressions.test.ts
  - src/app/(dashboard)/allocations/components/ScenarioCommitDrawer.test.tsx
  - src/app/(dashboard)/allocations/components/ScenarioCommitDrawer.tsx
  - src/app/(dashboard)/allocations/components/WeightOptimizerSection.test.tsx
  - src/app/(dashboard)/allocations/components/WeightOptimizerSection.tsx
  - src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.composite.render.test.tsx
  - src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx
  - src/app/api/account/export/route.ts
  - src/app/api/admin/match/send-intro/route.ts
  - src/app/api/admin/partner-import/route.ts
  - src/app/api/keys/[id]/rotate-secret/route.test.ts
  - src/app/api/keys/[id]/rotate-secret/route.ts
  - src/app/api/keys/validate-and-encrypt/route.test.ts
  - src/app/api/keys/validate-and-encrypt/route.ts
  - src/app/api/strategies/composite/add-key/route.test.ts
  - src/app/api/strategies/create-with-key/route.bare-401.test.ts
  - src/app/api/strategies/create-with-key/route.test.ts
  - src/app/api/strategies/create-with-key/route.ts
  - src/app/api/strategies/csv-finalize/route.test.ts
  - src/app/api/strategies/csv-finalize/route.ts
  - src/app/api/strategies/finalize-wizard/route.test.ts
  - src/app/api/strategies/finalize-wizard/route.ts
  - src/components/auth/ProfileForm.role-lock.test.tsx
  - src/components/auth/ProfileForm.tsx
  - src/components/auth/SignupForm.repeated-signup.test.tsx
  - src/components/auth/SignupForm.role-lock.test.tsx
  - src/components/auth/SignupForm.tsx
  - src/components/exchanges/AllocatorExchangeManager.test.tsx
  - src/components/exchanges/AllocatorExchangeManager.tsx
  - src/components/strategy/ApiKeyForm.test.tsx
  - src/components/strategy/ApiKeyForm.tsx
  - src/components/strategy/ApiKeyManager.test.tsx
  - src/components/strategy/ApiKeyManager.tsx
  - src/components/strategy/StrategyForm.test.tsx
  - src/components/strategy/StrategyForm.tsx
  - src/components/strategy/SyncProgress.contact-pointer.test.tsx
  - src/components/strategy/SyncProgress.tsx
  - src/components/ui/EmptyStateCard.tsx
  - src/lib/dialog-envelope.invariant.test.ts
  - src/lib/strategyGate.test.ts
  - src/lib/strategyGate.ts
  - src/lib/wizardErrors.invariant.test.ts
  - src/lib/wizardErrors.roster-render.test.tsx
  - src/lib/wizardErrors.test.ts
  - src/lib/wizardErrors.ts
findings:
  critical: 0
  warning: 4
  info: 10
  total: 14
  necessity: 0
severity_breakdown:
  critical: 0
  high: 0
  medium: 4
  low: 5
  info: 5
status: clean
fix_round_1: applied
fixed_in_round_1: [WR-01, WR-02, WR-03, WR-04, IN-01]
fix_report: 212-REVIEW-FIX.md
round_2: issues_found
round_2_findings: { critical: 0, high: 0, medium: 1, low: 3, info: 3 }
round_2_open_medium: []
---

# Phase 212: Code Review Report

**Reviewed:** 2026-11-14
**Depth:** standard (and cross-file where a finding needed it: classifier callers, the analytics-client seam, and the Python emitters behind each wire code)
**Files Reviewed:** 50 (`git diff 4c4fa1993..HEAD -- . ':!.planning'`)
**Status:** issues_found

## Summary

I reviewed the phase against its own standard: every refusal names the cause that was actually established, and every remedy it offers can work.

Most of the phase holds up when traced:

- **SC2.** The MT5 arm-3 sentence matches the founder-approved bytes exactly. The parity oracle is still hand-typed.
- **SC1.** The composite verdict branch (`isSeriesExaminedButRefused` → `gateFailureToWizardError`) reads the gate's own map. It feeds the rendered code and the telemetry from one variable.
- **SC5.** The early MT5 orphan refusal is user-scoped (`resolveByVenueIdentity` filters on `user_id`). It leaks no identity, because `keyOrphanedResponse()` takes no parameters. ccxt still validates first.
- **Bare 401/403.** The classifier branch reads `status` with `typeof`, never `instanceof`. It runs only for a null `seamCode`, and it does not echo the upstream status. A1 holds: there is no venue-meaning 401/403 on the validate/encrypt or `/internal` rotate hops.
- **Contact pointers.** `ContactPointerText` renders text nodes only and adds `rel="noopener noreferrer"` with `newTab`. `/contact` is public in `src/proxy.ts`, so the pointers on SignupForm (shown before sign-in) work.
- **Census.** The `contact support` census now returns comments only.

The defects sit in the new dashboard code channel (SC3) and in one alerting side effect of the bare-401 branch:

1. The correlation id both forms mint, send and print is never read or logged by the live `validate-and-encrypt` handler. So the "send the correlation id below through the contact form" remedy cannot work there (WR-01).
2. The curated-sentence fallback runs at every status, against UI-SPEC SC3 rule 5. On a 5xx that carries a forwarded operator-fault code, it replaces UNKNOWN's honest cause with "Key validation failed. Please try again." (WR-02).
3. The most common failure on both forms, wrong credentials, now renders as "Something went wrong." with "Try the last action again." and a support pointer. Before this phase, the forms showed the precise sentence alone. 212-04 records this, but 212-08's truth audit grades those bullets "true" (WR-03).
4. On `keys/[id]/rotate-secret`, a stale `INTERNAL_API_TOKEN` used to page through the UNKNOWN capture. Now it pages nowhere: the recorded "Python still captures it" premise holds only on the service-key hop (WR-04).

Severity scale used here: CRITICAL / HIGH / MEDIUM / LOW / INFO. The four MEDIUMs are listed under Warnings (WR-). The LOW and INFO items are listed under Info (IN-), each with its own level. Necessity rubric: read. No necessity finding met its evidence rule, so `necessity: 0`. There is no `.claude/skills` or `.agents/skills` in the worktree.

## Warnings

### WR-01: [MEDIUM, user-facing] The envelope's correlation id is never read or logged by the live validate-and-encrypt handler, so the "send the correlation id" remedy cannot be joined

**File:** `src/app/api/keys/validate-and-encrypt/route.ts:566`, `:582`, `:952-967`, `:426`; `src/components/strategy/StrategyForm.tsx:139-141`; `src/components/exchanges/AllocatorExchangeManager.tsx:1546-1548`
**Issue:**
- Both forms mint `newCorrelationId("key-validate")`, send it as `X-Correlation-Id`, and print it in the envelope's Diagnostics. `ErrorEnvelope` also puts it in the contact link as `ref=`.
- The route's only `getCorrelationId()` call is at `:426`, inside the dormant `_unifiedValidateAndEncryptHandler`. The live `legacyValidateAndEncryptHandler` never reads the header.
- It calls `validateKey(…, { userId })` and `encryptKey(…, { userId })`. `analyticsRequest` then mints its own fresh `crypto.randomUUID()` per call (`src/lib/analytics-client.ts:403-408`, and the wrappers do not thread one through).
- Neither the `console.error` nor the `captureToSentry` in the catch (`:952-967`) carries any correlation id.
- So the id the user is told to send through the contact form appears in no Vercel log, no Sentry event and no Python log.

This breaks the phase's own remedy standard on every code whose copy says "send the correlation id below through the contact form": `SEAM_MISCONFIGURED` bullet 1 (the bare-401 code this phase routes here), `VALIDATION_FAILED`, `SERVICE_UNAVAILABLE_RETRY`, `SERVICE_UNREACHABLE`, `STALE_CLIENT` and `UNKNOWN`. Several sentences claim otherwise and are false:

- StrategyForm's comment: "the id the envelope prints is one the route logged (`getCorrelationId()` prefers this header)".
- AllocatorExchangeManager's twin comment.
- UI-SPEC SC3 rule 2: "The route reads that header through `getCorrelationId()`".

The "X-Correlation-Id equals the envelope id" tests cover only the client half, so nothing catches this.
**Fix:** In `legacyValidateAndEncryptHandler`, read the id once, carry it on both seam calls, and attach it at both log sinks:
```ts
const correlationId = await getCorrelationId();
// analytics-client: let validateKey/encryptKey accept an optional correlationId in
// their tenant/options arg and pass it to analyticsRequest({ ..., correlationId })
const validation = await validateKey(exchange, api_key, api_secret, passphrase, { userId, correlationId });
...
console.error("[keys/validate-and-encrypt] validation failed:", { correlationId }, scrubSeamError(err, perRequestSecrets));
captureToSentry(err, { tags: { route: "api/keys/validate-and-encrypt", correlation_id: correlationId }, secrets: perRequestSecrets });
```
Add a route test that sends `X-Correlation-Id: <id>` on a failing request and asserts the id reaches the `console.error` / `captureToSentry` call and the outbound seam header. Correct the two component comments.

### WR-02: [MEDIUM, user-facing] The curated-sentence fallback runs on 5xx too, so a forwarded operator-fault code renders "Key validation failed. Please try again." instead of UNKNOWN's honest cause

**File:** `src/components/strategy/StrategyForm.tsx:197-208`; `src/components/exchanges/AllocatorExchangeManager.tsx:1602-1608`; `src/app/api/keys/validate-and-encrypt/route.ts:993-1001`; docblock `src/lib/wizardErrors.ts:~6360-6368`
**Issue:**
- Both forms use the body's `error` as the envelope `cause` whenever `!recognised`, at any status. 212-08 says so ("at any status").
- UI-SPEC SC3 rule 5 limits that fallback to "a 4xx with an unrecognised code". Its last bullet says "A 5xx, or a body with no code and no curated string: render the `UNKNOWN` envelope. 5xx `error` sentences are static and generic, and the code is the signal."
- CONTEXT allows a 5xx only "its specific static sentence where one exists (the persist-INSERT 500)".

Here is what happens. The route's terminal 500 arm forwards the service's own code (`code: seamCode ?? "UNKNOWN"`) with the generic sentence "Key validation failed. Please try again." The Python side emits `SERVICE_KEY_UNCONFIGURED` (`analytics-service/main.py:862-867`, 500), `KEK_UNAVAILABLE` (`routers/exchange.py:1692`, 500), `EGRESS_PROXY_MISCONFIGURED` (`routers/exchange.py:301`, 500) and `MT5_VALIDATION_UNCONFIGURED`, all on this hop. `recogniseValidateAndEncryptCode` resolves none of them, because it consults `VENUE_WIRE_CODE_TO_VERDICT` only for `RATE_LIMITED`. So the user sees:

- the title "Something went wrong.";
- the cause "Key validation failed. Please try again.", which reads as their key failing validation;
- the bullet "Try the last action again."

These are operator faults that no retry clears. For the same codes, `create-with-key` and `composite/add-key` answer `SEAM_MISCONFIGURED` through the classifier, and since this phase a bare 401 on this very route does too.

The roster docblock accepted these ~15 forwarded ≥500 codes "resolve to UNKNOWN copy — the accepted unrecognized case, not a false sentence". With the cause overwritten, that acceptance no longer describes what renders. 212-04's disposition table measured only the 4xx-forward arm, so this 5xx set was never dispositioned.

The bytes match what the forms showed before the phase, so this is not a regression. But it is the misattribution class the phase exists to close, on the render path this phase rewired.
**Fix:** The minimal fix, matching rule 5: do not overwrite the cause when a 5xx carries a forwarded service code. The persist-INSERT 500 (code `UNKNOWN` with its specific sentence) keeps its sentence:
```ts
const wireCode = typeof body?.code === "string" ? body.code : null;
const curatedAllowed = res.status < 500 || wireCode === null || wireCode === "UNKNOWN";
setApiEnvelope(!recognised && curatedAllowed && typeof curated === "string" && curated.length > 0
  ? { ...base, cause: curated } : base);
```
Apply the same change in AllocatorExchangeManager, and update the `KNOWN_VALIDATE_AND_ENCRYPT_CODES` docblock sentence. Do NOT resolve these 5xx codes to `SEAM_MISCONFIGURED` copy on this route without a per-code truth audit. That copy says "the request never left our servers", which is false for an encrypt-arm `KEK_UNAVAILABLE` after `validateKey` has already reached the venue (the docblock's WIZERR-06 W1 hazard).

### WR-03: [MEDIUM, user-facing; recorded in 212-04, escalated] Wrong credentials and the venue verdicts now render "Something went wrong." with "Try the last action again." and a support pointer

**File:** `src/lib/wizardErrors.ts:6519-6548` (`recogniseValidateAndEncryptCode`); `src/app/api/keys/validate-and-encrypt/route.ts:973-988` (4xx-forward arm); both forms' `!ok` arms
**Issue:** These are the most common refusals on both dashboard key forms:

- a bare 400 `AUTH_FAILED_DETAIL` ("Authentication failed. Check your API key and secret.", `analytics-service/services/exchange.py:30`, raised as `HTTPException(400, …)` with no seam code);
- the 424 validator verdicts `AUTH_FAILED`, `MISSING_SCOPE`, `PERMISSION_DENIED`, `WITHDRAW_SCOPE` and `TRADE_SCOPE`;
- `MT5_WRONG_SERVER_DETAIL` and `MT5_MASTER_PASSWORD_DETAIL`.

All of them resolve `{UNKNOWN, recognised:false}`. The route deliberately answers code `UNKNOWN` for a bare 400 (`UPSTREAM_STATUS_TO_SEAM_CODE` has no 400 row), and the recogniser does not consult `VENUE_WIRE_CODE_TO_VERDICT` for the 424 codes. So a user with a mistyped secret sees:

- the title "Something went wrong.";
- the curated sentence as the cause;
- UNKNOWN's bullets: "Try the last action again." (the same credentials cannot succeed) and "If it keeps failing, send the correlation id below through the contact form." (this sends a user-fixable error to support, with an id that cannot be joined; see WR-01).

Before Phase 212 both forms showed only the curated sentence. 212-04 records the rows as a finding, but 212-08's truth audit grades UNKNOWN's bullets "true" for these forms, and for these causes they are not. The other three key routes already name these causes: `classifyKeyValidationError` maps the same sentence to `KEY_AUTH_FAILED` and the same 424 codes through `VENUE_WIRE_CODE_TO_VERDICT`. Only this route, the one this phase moved onto the code channel, discards them.
**Fix:** Resolve 4xx venue verdicts through the typed table the classifier already uses. These are 4xx codes, so the WIZERR-06 5xx hazard does not apply. Truth-audit each target entry's bullets without `surface` context, the same way 212-08 audited the rostered codes.
```ts
// in recogniseValidateAndEncryptCode, after the RATE_LIMITED split, before the alias table:
if (status >= 400 && status < 500) {
  const verdict = VENUE_WIRE_CODE_TO_VERDICT.get(wire);
  if (verdict !== undefined) return { code: verdict.code, recognised: true };
}
```
For the bare 400 with no seam code, have the route's 4xx arm call `classifyKeyValidationError(err)` and emit its code when that code is not `UNKNOWN`, instead of the literal `"UNKNOWN"`. The specific sentence still rides in `error`. If neither is taken, at minimum stop UNKNOWN's "Try the last action again." bullet from rendering beside a curated 4xx cause.

### WR-04: [MEDIUM, observability, neither user-facing nor data-integrity] A stale `INTERNAL_API_TOKEN` on rotate-secret now pages nowhere

**File:** `src/lib/wizardErrors.ts:5760-5769` (status branch) and `:5897-5906` (recorded decision); `src/app/api/keys/[id]/rotate-secret/route.ts:393` and `:429-435`; `analytics-service/routers/internal.py:170-184`
**Issue:**
- `rotate-secret` calls `/internal/keys/{id}/rotate-secret` with `X-Internal-Token`. `/internal/*` skips the service-key middleware (`analytics-service/main.py:801-806`).
- A mismatched token raises `HTTPException(403, "Forbidden")` in `_verify_internal_token`, with no log line and no Sentry capture (`internal.py:182-184`).
- Before 212, that 403 reached `classifyKeyValidationError` with only the message "Forbidden" and landed on `UNKNOWN`. `UNKNOWN` is in `OUR_DEFECT_KEY_ERROR_CODES`, so the route paged (`:429`).
- 212-04 now stamps `status = res.status` (`:393`), and the status branch answers `SEAM_MISCONFIGURED`. That code is deliberately absent from the set, so the capture stops.
- The recorded justification says "The Python middleware's `_capture_secret_misconfig` still captures it at the source". That is true only for the service-key hop (`main.py:905-927`), not for the internal-token hop.

Net effect: a rotated or stale internal token breaks every MT5 "Update secret" attempt and alerts nobody. The `create-with-key` and `add-key` hops are unaffected; they use the service key, whose mismatch Python captures.
**Fix:** Either fix is minimal:
- **(a)** Add the mismatch capture at the source, mirroring the service-key arm:
  ```py
  if not secrets.compare_digest(provided, expected):
      if provided:
          logger.warning("internal_token.mismatch path=%s", request.url.path)
          _capture_secret_misconfig("mismatched", "INTERNAL_API_TOKEN")  # throttled, as main.py
      raise HTTPException(status_code=403, detail="Forbidden")
  ```
- **(b)** On `rotate-secret` only, also capture when the error carried `status` 401/403. That keeps the shared set unchanged.

Correct the `OUR_DEFECT_KEY_ERROR_CODES` docblock sentence to say which hop the Python capture covers.

## Info

### IN-01: [MEDIUM, user-facing; escalated from LOW by silent-failure-hunter M1 — wrong correlation id sends triage to the wrong log line; AllocatorExchangeManager already clears its envelope on close] StrategyForm keeps a stale envelope (and its correlation id) after Cancel

**File:** `src/components/strategy/StrategyForm.tsx:443`
**Issue:** `apiEnvelope` is cleared only at the start of the next submit. Cancel (`setShowApiModal(false)`) leaves it set, so reopening the connect modal shows the previous refusal and its old correlation id before the user has done anything. `AllocatorExchangeManager` clears `formEnvelope` on close and on Cancel; StrategyForm does not. (`apiError` had the same behaviour before the phase.)
**Fix:** Clear `apiEnvelope` (and `apiError`) in the Cancel handler and wherever the modal is opened.

### IN-02: [LOW, test-weakening] The dialog-envelope law now excludes two whole host files

**File:** `src/lib/dialog-envelope.invariant.test.ts:143-166`
**Issue:** `COVERED_BY_WIZARD_ROSTER` removes `StrategyForm.tsx` and `AllocatorExchangeManager.tsx` from the population by file path. The anti-stale case proves only that each file still matches the predicate. If a future per-route dialog that builds an envelope is added inside either host, it escapes every dialog-envelope law with no RED. The roster-render fifth surface drives only `StrategyForm`. AllocatorExchangeManager's code channel is held by a regex detector and its own component tests.
**Fix:** Exclude by the recogniser call rather than by file. For example, require that every `buildEnvelope(` call in an excluded file sits in a handler that calls `recogniseValidateAndEncryptCode`. Or pin the excluded files' `buildEnvelope(` call count (one each today).

### IN-03: [LOW, user-facing] On the composite arm, "Connect a Deribit key instead" does not clear the verdict unless the gapped member is removed

**File:** `src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx:1692-1708`; `analytics-service/services/job_worker.py:13854-13950`
**Issue:** The composite stitch stamps `sampled_gapped` whenever any member's verdict is gapped (`_GAPPED_MEMBER_VERDICT`). So adding a Deribit member through "Review your keys" leaves the verdict unchanged until the gapped (sFOX) member is removed. 212-02's truth check marked the bullet TRUE because `add-key` accepts Deribit. "Instead" implies a replacement, and the review step does support Remove, so the remedy can work. But the copy does not say a member must go or which one.
**Fix:** Record it for the next copy pass. A composite-only bullet (behind a composite `fixRequires`) could say "remove the member whose series has gaps, then add a Deribit key".

### IN-04: [LOW, user-facing; recorded F2/F3 in 212-08] Two remedies on the dashboard forms cannot work

**File:** `src/lib/wizardErrors.ts` (`KEY_VENUE_ALREADY_CONNECTED`, `KEY_RATE_LIMIT` entries); both forms call `buildEnvelope(code, correlationId)` with no ctx
**Issue:**
- F2: StrategyForm shows "use the key you already have" with no saved-key control.
- F3: "try a different exchange account" fails open for sFOX, which cannot be substituted.

Both are recorded as the UI-SPEC allows. Accept F2. Escalate-lite F3: both forms already know the selected exchange, so the fix is one argument.
**Fix:** `buildEnvelope(code, correlationId, { venue: exchangeCanonical })` in StrategyForm and `{ venue: exchange }` in AllocatorExchangeManager. Re-check that no venue-gated bullet becomes false with venue set.

### IN-05: [LOW, admin-only] "Add the audit entry by hand" names no path the admin UI offers

**File:** `src/app/api/admin/match/send-intro/route.ts:627`; `src/app/api/admin/partner-import/route.ts:1039`
**Issue:** The new admin remedy needs a direct database write. No admin screen inserts an audit row. That is acceptable for a founder-only surface, but it is the one remedy in the phase that depends on out-of-band access.
**Fix:** Name the table, or link the runbook that shows the insert, so the sentence is actionable.

### IN-06: [INFO] The `flat` fallback in `recogniseValidateAndEncryptCode` is dead code

**File:** `src/lib/wizardErrors.ts:6525-6529`
**Issue:** `seamErrorCode(body)` already returns a flat `body.code` for any plain object (`src/lib/seam-discriminator.ts:259-263`). A JSON-parsed body is always a plain object, so `flat` can never supply a value `nested` did not.
**Fix:** Drop `flat` and use `const wire = seamErrorCode(body);`.

### IN-07: [INFO, recorded founder-pending default; accept] The csv-finalize oracle is now a hand copy of the route literal, and the SQL arms keep the legacy pointer

**File:** `src/app/api/strategies/csv-finalize/route.test.ts:716`; `supabase/schema/functions/computation_error_copy.sql:44,77`
**Issue:** `CURATED_DEFAULT_COPY` is now the same hand-typed sentence as `ENQUEUE_LOST_RACE_USER_COPY`. The test still catches a route that invents a new sentence, but it is no longer independent of the project's SQL copy. The SQL `computation_error_copy` arms (ELSE and the permanent arm among them) still say "contact support". `SyncProgress` renders those through `ContactPointerText`, which finds no "contact form" phrase in them and leaves them as plain text.
**Fix:** Accept as recorded. Make sure the ship books the survivor entry (`212-09-SUMMARY.md` "For ship") naming the SQL arms and the Python strings.

### IN-08: [INFO, recorded founder-pending default] `KEY_MT5_TERMINAL_BUSY` still says "Try again in a minute."

**File:** `src/lib/wizardErrors.ts` (`KEY_MT5_TERMINAL_BUSY` copy)
**Issue:** Research found no truthful static number (about 285 s at code defaults, up to 30 minutes on the worker path). So the shipped sentence states an unmeasured duration, which UI-SPEC principle 3 forbids. It is kept only until the founder answers.
**Fix:** None until the founder decides. Keep it on the pending list in the ship notes.

### IN-09: [INFO] The no-email sweep's two new allowlist rows are sound

**File:** `src/__tests__/no-email-in-copy.test.ts:151-160`
**Issue:** None. `you@example.com` is an input placeholder, and `local@host.tld` is a format description in a comment. Recorded so a later reviewer does not re-open them.
**Fix:** None.

### IN-10: [INFO, test gap] No test found pinning that an MT5 `held` key still reaches `validateKey` after the new early return

**File:** `src/app/api/strategies/create-with-key/route.ts:1297-1303`; `src/app/api/strategies/create-with-key/route.test.ts`
**Issue:** The new pre-validation return keys on `venueMatch.kind === "orphaned"`. The orphan cases and the ccxt-unchanged case are pinned. I found no case (by grep for `held` and `strategy_keys` in the MT5 pre-fence tests) asserting that an MT5 key with a composite membership (`held`) still calls `validateKey` and resolves through the race arm. A regression that widened the early return to `held` would answer `KEY_ORPHANED`, which is false for a composite member, and might not go RED. The `unresolved` direction is covered by the dark-read cases.
**Fix:** Add an MT5 case in which `keyMembershipLookupMock` returns a row and the test asserts `validateKeyMock` was called and the response is not `KEY_ORPHANED`.

---

_Reviewed: 2026-11-14_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

## Silent-failure-hunter pass (2026-11-14)

No CRITICAL or HIGH. MEDIUM: M1 = IN-01 (escalated above). M2 confirms WR-04 and widens it: the classifier's new 401/403 branch reads `status` off ANY thrown object, not only `AnalyticsUpstreamError`, so a non-upstream throw with status 401/403 would also be reported as SEAM_MISCONFIGURED and stop paging.

LOW, recorded here only (not fixed, not booked):
- L1: dialog-envelope invariant exclusion is whole-file (same as IN-02).
- L2: csv-finalize sentence diverges from SQL `computation_error_copy` ELSE arm with no gate on the SQL side (same class as IN-07).
- L3: admin audit_warning strings name no id or target (same as IN-05).
- L4: MT5 validation and job endpoint pairs being equal is not refused at startup (same class as the SC4 premise note).
- L5: a 2xx non-JSON body shows "verified but not saved" in AllocatorExchangeManager, and StrategyForm's unguarded 2xx `res.json()` can surface a raw SyntaxError message.

## Round 2 re-review (after fix round 1, 2026-11-14)

**Scope:** `git diff 9add3ed7d..HEAD -- . ':!.planning'` (fix commits dfef8a5e8 WR-03, 845f2510d WR-02, eb0a1feef WR-01, 38c16ed78 WR-04, f95a91bb8 IN-01), read against the whole phase diff from `4c4fa1993`. Files: `src/lib/wizardErrors.ts`, `src/app/api/keys/validate-and-encrypt/route.ts`, `src/app/api/keys/[id]/rotate-secret/route.ts`, `src/components/strategy/StrategyForm.tsx`, `src/components/exchanges/AllocatorExchangeManager.tsx`, and their tests.
**Depth:** standard, plus cross-file where a fix needed it (the analytics-client throw paths, the Python 400 producers on `/api/validate-key` and `/api/encrypt-key`, the copy entries the new recogniser arm reaches, and `getCorrelationId`).
**Tests run:** 18 affected vitest files (wizardErrors unit, invariant and roster-render; the dialog-envelope law; every `src/app/api/keys` suite; `composite/add-key`; `create-with-key`; both form suites). 1285 passed. A passing suite is not taken as evidence below; every verdict was traced through the code path.

### Verdict per round-1 finding

| id | verdict | evidence |
|---|---|---|
| WR-01 | **Fixed on the paths it listed; one arm missed** (see R2-WR-01) | `getCorrelationId()` is read once at `route.ts:574` and appears on the admin-unavailable, persist-INSERT, breaker, 504, 4xx-forward and terminal-500 logs, and on their Sentry tags. `getCorrelationId` (`src/lib/correlation-id.ts:32`) shape-checks the inbound header against `^[A-Za-z0-9._:-]{1,128}$` and otherwise mints a UUID, so the value cannot inject a log line. The new `console.warn` (`:959-963`) carries `{correlationId, status, code}` only. No message, request body or credential reaches it. `code` is the upstream's closed-vocabulary token or a wizard code. `next/headers` `headers()` is valid in this route handler. |
| WR-02 | **Fixed** | Both forms gate the curated fallback on `status < 500 \|\| typeof code !== "string" \|\| code === "UNKNOWN"` (`StrategyForm.tsx:221-228`, `AllocatorExchangeManager.tsx:1609-1615`). The persist-INSERT 500 (`route.ts:839`, `code: "UNKNOWN"`) keeps its sentence. A forwarded `KEK_UNAVAILABLE` / `SERVICE_KEY_UNCONFIGURED` / `EGRESS_PROXY_MISCONFIGURED` / `MT5_VALIDATION_UNCONFIGURED` 500 now renders UNKNOWN's own cause. Every other route 5xx (`SEAM_MISCONFIGURED` 503 ×2, `CIRCUIT_OPEN` 503, `UPSTREAM_TIMEOUT` 504) is recognised, so the gate does not touch it. A non-JSON 5xx has no curated string. See R2-IN-01 for the one residual. |
| WR-03 | **Fixed** | The 424 forward of `AUTH_FAILED` / `MISSING_SCOPE` / `PERMISSION_DENIED` / `WITHDRAW_SCOPE` / `TRADE_SCOPE` resolves through `VENUE_WIRE_CODE_TO_VERDICT.get(wire)`. The `verdict.status === 400` filter admits exactly those five rows. Every other row is 424, 5xx or 503/502. `RATE_LIMITED` is still handled before the filter, by the split and the alias table. The bare 400 `AUTH_FAILED_DETAIL` (`analytics-service/routers/exchange.py:281,311,387`) reaches `classifyKeyValidationError` → `KEY_AUTH_FAILED` (status 400). The route forwards that wizard code, and the dual-lookup loop resolves it. The loop runs over `Map.values()`, so an attacker-shaped wire string (`__proto__`, `constructor`) cannot match. Only the five 400-status `row.code`s can. The alias table maps none of the five wire names, so the new arm is not shadowed. The five target entries render true on these forms: `KEY_AUTH_FAILED`'s Deribit bullet is `venueIs`-gated, and an absent venue suppresses it (`wizardErrors.ts:4602-4615`). MT5 is outside `UI_EXCHANGE_CODES`, so no MT5 credential reaches this copy from either form. `KEY_PERMISSION_DENIED`'s "egress IP status" phrase is linked by `ErrorEnvelope` (`EGRESS_IP_STATUS_LINK`). Classifier misfire check: the only Python bare-400 details on this hop are `AUTH_FAILED_DETAIL`, `MT5_*_DETAIL`, `SFOX/MT5_DISABLED_DETAIL` and `Unsupported exchange: …`. None hits the `trading`/`withdraw` substring arm, so no false `KEY_HAS_TRADING_PERMS` has a producer today. |
| WR-04 | **Fixed** | `SEAM_MISCONFIGURED` is in `OUR_DEFECT_KEY_ERROR_CODES`, so all three classifier routes capture it (`rotate-secret:418`, `create-with-key:1883`, `add-key:711`). The `error.name === "AnalyticsUpstreamError"` restriction keeps every real thrower. On `create-with-key` and `add-key` the only throwers inside the classified `try` are `validateKey` and `encryptKey` → `analyticsRequest`. All four of its `!ok` / unusable-body throws construct the real class (`analytics-client.ts:607,656,679,695`), and the constructor sets `this.name` (`:205`). `rotate-secret` stamps the name on its plain `Error` (`:396`), and nothing else in `src` reads that name. The bare-401/403 branch therefore still fires on all three routes, and the stale `INTERNAL_API_TOKEN` 403 now pages (pinned in `rotate-secret/route.test.ts`). The paging widening (`KEK_UNAVAILABLE`, `SERVICE_KEY_UNCONFIGURED`, `EGRESS_PROXY_MISCONFIGURED` forwards; double events on the service-key hop) is recorded in the docblock and as a decision to confirm in `212-REVIEW-FIX.md`. |
| IN-01 | **Fixed** | `closeApiModal()` clears `apiEnvelope` and `apiError` and is wired to both `Modal.onClose` and Cancel (`StrategyForm.tsx:140-144,423,466`). The success path clears both at submit start. See R2-IN-02 for an in-flight race. |

### New or still-open MEDIUM+

#### R2-WR-01: [MEDIUM, user-facing; residual of WR-01] The venue-identity collision log carries no correlation id, but `KEY_VENUE_ALREADY_CONNECTED` tells the user to send it

**File:** `src/app/api/keys/validate-and-encrypt/route.ts:804-807`; copy `src/lib/wizardErrors.ts` (`KEY_VENUE_ALREADY_CONNECTED` fix bullet 3)
**Issue:**
- The 23505 venue-identity arm returns `KEY_VENUE_ALREADY_CONNECTED` (409). That code is in `KNOWN_VALIDATE_AND_ENCRYPT_CODES`, so both forms render it.
- Its third bullet is ungated: "If you believe this account should be free to connect fresh, send the correlation id below through the contact form before disconnecting anything".
- The arm's only log line is `console.error("[keys/validate-and-encrypt] persist INSERT failed — venue-identity collision:", scrubSeamError(...))`. It has no `{ correlationId }` and no user id.
- `correlationId` is already in scope (read at `:574`). The fix added it to the generic persist-INSERT log a few lines below (`:830`) but skipped this one.
- So on this code the id the user is told to send still joins to nothing. That is exactly the WR-01 defect, on one arm the fix's list did not reach. `212-REVIEW-FIX.md` reports WR-01 as fixed without naming the gap.

**Fix:** a one-line change, matching the sibling arm:
```ts
console.error(
  "[keys/validate-and-encrypt] persist INSERT failed — venue-identity collision:",
  { correlationId },
  scrubSeamError(insertError, [api_key, api_secret, passphrase, venueAccountId]),
);
```
Extend the WR-01 route test, or add a case: a 23505 on `VENUE_IDENTITY_CONSTRAINT` with `X-Correlation-Id: <id>` asserts the id reaches `console.error`.

No other new MEDIUM+ was found. Here is what I checked and found clean:
- the `status === 400` filter and the dual loop: no wrong code, no prototype read, no shadowing;
- the `classifiedCode` third `??`: it cannot override a seam code or a mapped 401/403, because the classifier returns status 500 for those and the code is dropped;
- WR-02 on both forms;
- the restriction's thrower coverage;
- the leak surface of `console.warn` and `getCorrelationId`.

### LOW / INFO (recorded here only; not booked)

- **R2-IN-01 [LOW]:** WR-02's `code === "UNKNOWN"` exemption cannot tell the persist-INSERT 500 apart from the terminal unclassified 500 (`route.ts:1036-1042`). Both answer `UNKNOWN`. So an unclassified 5xx still shows "Key validation failed. Please try again." as the cause. The bytes are the same as before the phase, the condition is the one round 1 proposed, and the cause really is unknown there, so this is not misattribution of a known fault. If UI-SPEC rule 5 is to hold to the letter, give the persist-INSERT arm a distinguishing marker the forms can key on.
- **R2-IN-02 [LOW]:** On StrategyForm, closing the modal while a submit is in flight lets the late response re-set `apiEnvelope`. Reopening then shows that refusal. Cancel is not disabled during `apiLoading`.
- **R2-IN-03 [LOW]:** The limiter-misconfigured arm (`route.ts:365-372`, `SEAM_MISCONFIGURED` 503 via `rateLimitDenyJson`) logs no correlation id, and `SEAM_MISCONFIGURED` bullet 1 says to send it. The fault is global and observable elsewhere, so the impact is small.
- **R2-IN-04 [INFO, doc drift]:** The route now forwards wizard codes on the 4xx arm (`KEY_AUTH_FAILED`, `KEY_INVALID_SIGNATURE`, `KEY_MT5_MASTER_PASSWORD`, `KEY_MT5_WRONG_SERVER`, `KEY_HAS_TRADING_PERMS`), and the recogniser renders five codes that are not in `KNOWN_VALIDATE_AND_ENCRYPT_CODES`. Three docblocks are now stale:
  - the roster docblock's "what the roster admits = what a client renders" and its "~21 codes" paragraph;
  - the recogniser's (a)–(e) order list, which omits the new step;
  - the `KEY_RATE_LIMIT` note, which names it as the only off-roster code the reader answers.

  The roster-render law does not drive the five new codes. Their copy was truth-checked above.
- **R2-IN-05 [INFO]:** For a 424 `MISSING_SCOPE`, the Python `detail` may name the specific scope. The recognised entry's generic cause now replaces it. That is acceptable, but the specific scope name is lost.
- **R2-IN-06 [INFO]:** The Sentry tag `step: "unclassified-key-error"` now also labels the classified `SEAM_MISCONFIGURED` capture on the three routes. That is cosmetic, but it misnames the fault in triage.

**Round-2 status:** issues_found. 1 MEDIUM (R2-WR-01, user-facing, a one-line residual of WR-01), 0 HIGH/CRITICAL, 3 LOW, 3 INFO.

_Re-reviewed: 2026-11-14_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

### Round 2 resolution (2026-11-14)

R2-WR-01 fixed inline (one line plus one route test): the venue-identity collision `console.error` now carries `{ correlationId }`. Proof: test "the venue-identity collision arm (409) logs the inbound correlation id" RED with the line removed (byte backup restored), GREEN after; route test file 123/123. No MEDIUM+ open. R2-IN-01..06 stay recorded here only.

### Silent-failure re-review of the fix round (2026-11-14)

No CRITICAL, HIGH or MEDIUM. LOW, recorded here only:
- R3-L1: `classifiedCode` in validate-and-encrypt keys on the classifier's verdict status, so an unrelated upstream 4xx (404/405/409/413) whose bare text says "signature" would forward `KEY_INVALID_SIGNATURE`. Hardening: add `err.status === 400 &&`.
- R3-L2: Cancel is not disabled while `apiLoading`; a late response re-sets the envelope (same window as R2-IN-02).
- R3-L3: the WR-02 5xx tests feed codes the route does not emit on a 5xx today; the gate is defensive and the tests still fail if it is removed.
