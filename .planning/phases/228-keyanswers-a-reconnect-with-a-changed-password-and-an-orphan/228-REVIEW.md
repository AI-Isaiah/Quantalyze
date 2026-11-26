---
phase: 228-keyanswers-a-reconnect-with-a-changed-password-and-an-orphan
reviewed: 2026-11-26T16:24:31Z
depth: deep
files_reviewed: 22
files_reviewed_list:
  - analytics-service/routers/internal.py
  - analytics-service/tests/test_mt5_rotate_secret_internal.py
  - src/app/(dashboard)/strategies/new/wizard/WizardClient.test.tsx
  - src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx
  - src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.test.tsx
  - src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx
  - src/app/api/keys/[id]/rotate-secret/route.ts
  - src/app/api/strategies/create-with-key/route.test.ts
  - src/app/api/strategies/create-with-key/route.ts
  - src/lib/analytics-client.ts
  - src/lib/analytics-schemas.test.ts
  - src/lib/analytics-schemas.ts
  - src/lib/api/rotate-key-secret.test.ts
  - src/lib/api/rotate-key-secret.ts
  - src/lib/key-secret-outcome.test.ts
  - src/lib/key-secret-outcome.ts
  - src/lib/resilient-fetch.ts
  - src/lib/resilient-fetch.wiring.test.ts
  - src/lib/seam-budgets.invariant.test.ts
  - src/lib/wizardErrors.invariant.test.ts
  - src/lib/wizardErrors.test.ts
  - src/lib/wizardErrors.ts
findings:
  critical: 0
  warning: 1
  info: 10
  total: 11
  necessity: 0
status: issues_found
---

# Phase 228: Code Review Report

**Reviewed:** 2026-11-26T16:24:31Z
**Depth:** deep (cross-file: route → `rotateKeySecret` → `resilientFetch` → Python `rotate_key_secret` → `_validate_mt5_key`; route → `persistRotatedMt5Secret`; classifier; audit census; wiring census; client roster)
**Files Reviewed:** 22 (`git diff 0e6ebeedbc HEAD -- . ':!.planning'`)
**Status:** issues_found

**Severity mapping.** The task's five levels map onto the schema's three. CRITICAL and HIGH map to `critical`, MEDIUM maps to `warning`, and LOW and INFO map to `info`. The review has **one MEDIUM** (WR-01, user-facing copy) and **no CRITICAL or HIGH**. Under the repo rule (CLAUDE.md, "TODOS.md holds open work only" (a)), the LOW and INFO items are recorded here and nowhere else.

## Summary

The phase adds a new write path to PROD key secrets: the MT5 same-account rotate leg in `create-with-key`. It also extracts the seam call and the owner-scoped UPDATE out of `PATCH /api/keys/[id]/rotate-secret` into shared code. I traced every mandated question to source.

1. **Authz parity: holds.** Owner scoping is applied at every step:
   - The pre-validation fence picks only from `readLiveSameLoginKeys(admin, { userId })`, where the owner filter is mandatory.
   - `rotate` is set only on the WORKING-holder path, exact server tier (`create-with-key/route.ts:425-427`). That is after the failing-holder early returns, which start at `:384`, so a failing holder with a composite dependent never carries it.
   - The re-read (`:1911-1918`) is user-scoped through RLS and filters `id` + `user_id` + `exchange='mt5'` + `disconnected_at IS NULL`. Every selected column is on the authenticated allowlist: `label` (20260410225608), `disconnected_at` (20260422101911) and `venue_account_id` (20260920120000).
   - The seam receives `userId: user.id` (`:1934-1939`). Python filters its row load on it (`internal.py`, `if req.user_id: query.eq("user_id", ...)`).
   - The UPDATE filters on `id` + `user_id` + `exchange='mt5'` (`rotate-key-secret.ts:126-128`).
   - `withAuth` composes the CSRF, session and approval-gate stack that rotate-secret hand-rolls.
   - The wizard leg is stricter than rotate-secret, which allows rotating a disconnected key, but see IN-04.
2. **A refused password writes nothing: holds on both routes.**
   - `_validate_mt5_key_probe` is fail-closed: "every arm 400s and NEVER returns `{"valid": true}`" (`routers/exchange.py:568-570`). `rotate_key_secret` re-asserts the success shape before it encrypts.
   - `rotateKeySecret` throws on every non-ok answer (`analytics-client.ts:961-978`), so the wizard leg leaves for the outer catch before `persistRotatedMt5Secret` is called. Rotate-secret's catch returns before the admin client exists.
   - Test-fidelity limits: IN-07.
3. **Sync race: the recorded limit is real, and its population is wider than recorded (IN-02, LOW).** IN-02 corrects the premise of a recorded founder deferral (CONTEXT Deferred, "the next sync clears it"):
   - The wizard leg's UPDATE resets a *healthy* status on a working key every time, not only in a race.
   - Recovery from the race goes through the daily poll.
   - Every consumer I read is either a display or gated elsewhere.
4. **Wiring-census regex: yes, it opens a narrow, provable gap (IN-01, LOW).** A second *variable-keyed* chokepoint still reddens. Three call shapes in the two client modules are now invisible to both scanners.
5. **`@audit-skip` pragmas: legitimate, not a bypass (IN-05, INFO).** The test's own header prescribes this shape for a cross-file audit. The audit lands in the helper, in the same function as its UPDATE, and is pinned both ways.
6. **409 body and copy.**
   - On the success and write-fault paths, no false claim:
     - `updated` is emitted only on `persisted.kind === "ok"`, which needs at least one matched row.
     - `unchanged` is emitted only on an explicit `secret_changed === false`.
     - An absent field from an old seam takes the write and answers `updated`, which is true because the row was rewritten.
     - Every write fault answers `UNKNOWN`, never `updated`.
     - The rewritten F6 fallback strip is true on both arms that reach it.
   - **On transport failures, the new surface renders the wrong code (WR-01, MEDIUM).** A stale-notice state is IN-03.
7. **Python `secret_changed`: holds.**
   - It is computed after `_validate_mt5_key` succeeds and after the result-shape assertion (probe, then compare).
   - It is `secrets.compare_digest` over UTF-8 bytes, so a non-ASCII pair cannot raise.
   - Nothing is logged, and only the boolean is returned. The early return on a length mismatch reveals only whether the lengths differ, after a live sign-in with the same password, so it adds no oracle.

Necessity: I read `necessity-review.md`. The wizard leg's `holder_read_failed` and `venue_collision` arms are effectively unreachable: the exact-tier holder was matched on a non-null `venue_account_id`, so the helper's backfill never runs. They are switch arms over a shared typed result. Under the rubric, unreachable code is category 3, not necessity. No necessity finding.

## Warnings

### WR-01 (MEDIUM, user-facing): Transport failures on the rotate leg are unwrapped. A hung seam renders "We could not reach the exchange", and a down seam renders `UNKNOWN` and pages Sentry. The `validateKey` arm answers `SERVICE_UNREACHABLE` for the same hop.

**File:** `src/lib/analytics-client.ts:943-990` (`rotateKeySecret`), reached from `src/app/api/strategies/create-with-key/route.ts:1934` and the outer catch at `:2773`
**Issue:** `resilientFetch` rethrows a transport failure UNWRAPPED. Its own comment says "both clients map `err.name` onto their own typed errors (AnalyticsTimeoutError / UPSTREAM_TIMEOUT)" (`resilient-fetch.ts:~2765-2770`). `analyticsRequest` does that mapping (`analytics-client.ts:543-589`). `rotateKeySecret` calls the core directly and does not. I measured the two raw shapes in node and traced each through `classifyKeyValidationError` (`wizardErrors.ts:6038-6236`):

| Hop failure | Raw throw (`resilientFetch`, measured) | Rotate leg answers | `validateKey` arm answers |
|---|---|---|---|
| 120 s deadline (`AbortSignal.timeout`, `resilient-fetch.ts:2677`) | `TimeoutError: The operation was aborted due to timeout` | `KEY_NETWORK_TIMEOUT` 502, from the cascade's `"timeout"` substring: "We could not reach the exchange." | `SERVICE_UNREACHABLE` 502, via `seamTransportCode`: "This is on our side, not your key or your exchange." |
| Connection refused, Railway restarting | `TypeError: fetch failed` | `UNKNOWN` 500, plus a `captureToSentry` page (`OUR_DEFECT_KEY_ERROR_CODES` holds `UNKNOWN`) | `SERVICE_UNREACHABLE` 502, no page |

Before this phase the four same-account arms refused instantly with no seam call. They now make one on every MT5 reconnect of a working key, so each Railway redeploy window turns those reconnects into an `UNKNOWN` envelope and a Sentry event. The classifier's own comment names the first row as the defect class: "it would still answer `KEY_NETWORK_TIMEOUT` — copy that blames the EXCHANGE for a failure of our own hop" (`wizardErrors.ts`, the B-02 block). The behaviour is inherited byte-for-byte from rotate-secret, where it has existed since 164.5.3. This phase moved the call into `analytics-client.ts`, next to the wrapper that fixes it, and widened its reach to the wizard. No write is at risk: the persist runs in Next after the seam returns, so a transport failure always means nothing was saved.
**Fix (minimal):** Give `rotateKeySecret` the same catch `analyticsRequest` has, around its `resilientFetch` call:
```ts
let res: SeamResponse;
try {
  res = await resilientFetch("keys-rotate-secret", /* unchanged */);
} catch (err) {
  if (err instanceof CircuitOpenError || err instanceof SeamConfigError) throw err;
  if ((err instanceof Error || err instanceof DOMException) &&
      (err.name === "AbortError" || err.name === "TimeoutError")) {
    throw new AnalyticsTimeoutError("/internal/keys/{id}/rotate-secret", SEAM_BUDGETS["keys-rotate-secret"].timeoutMs);
  }
  throw notReachableError();
}
```
⚠️ This also changes PATCH rotate-secret's answer from `KEY_NETWORK_TIMEOUT`/`UNKNOWN` to `SERVICE_UNREACHABLE`. Confirm first that `UpdateMt5SecretDialog`'s roster admits `SERVICE_UNREACHABLE`, or the dialog falls back to `UNKNOWN`. If it does not, either add the roster row in the same change, or apply the mapping only at the create-with-key call site so rotate-secret stays byte-identical. Pin it with a route test that rejects the seam with a real `DOMException("…", "TimeoutError")` and a `TypeError("fetch failed")`.

## Info

### IN-01 (LOW): The chokepoint lookahead and the literal-site regex are asymmetric, so three call shapes in the two client modules are invisible to the census

**File:** `src/lib/resilient-fetch.wiring.test.ts:675` (and `:876`)
**Issue:** `chokepointRetry` now skips any call matching `resilientFetch\s*\((?!\s*")`. That is safe only if `discoverLiteralCallSites` picks the call up, but that function uses the stricter `resilientFetch\(\s*"([^"]+)"\s*,`. I measured both in a scratchpad node probe:

| shape | counted as chokepoint | discovered as literal |
|---|---|---|
| `resilientFetch("k", …)` | 0 | 1 |
| `resilientFetch(options.budgetKey, …)` | 1 | 0 |
| `resilientFetch ("k", …)` | 0 | 0 (**invisible**) |
| `resilientFetch("k" as SeamKey, …)` | 0 | 0 (**invisible**) |
| `resilientFetch("a" + b, …)` | 0 | 0 (**invisible**) |

Before the change, any second call in `analytics-client.ts` or `process-key-client.ts` made the count read `<NOT A SINGLE CHOKEPOINT>` and turned the test red. Now a cast-keyed or concatenated call is in neither population: its retry verdict goes unpinned, and no roster row is demanded. The roster equality itself is two-way (`:1131`, `:1165`, `:1176`), but it can only compare what discovery finds.
**Fix:** Make the skip the exact inverse of what the literal scanner discovers:
```ts
// chokepointRetry
const calls = [...code.matchAll(/resilientFetch\s*\((?!\s*"[^"]+"\s*,)/g)];
// discoverLiteralCallSites
for (const m of code.matchAll(/resilientFetch\s*\(\s*"([^"]+)"\s*,/g)) {
```

### IN-02 (LOW, corrects a recorded deferral's premise): The rotate UPDATE's unconditional `sync_status: 'idle'` / `sync_error: null` now lands on WORKING keys every time, and the recorded race recovers only through the daily poll

**File:** `src/lib/api/rotate-key-secret.ts:111-112`, reached from `src/app/api/strategies/create-with-key/route.ts:1948`
**Issue:** The two routes reach different populations. PATCH rotate-secret fixes a failing key, where the reset is the point (CR-01). The wizard leg only reaches a key `isWorkingHolder` accepts, so its status is one of `idle`, `syncing`, `computing`, `complete`, `complete_with_warnings` or `rate_limited` (the CHECK in 20260922120000). On that population, the write deterministically does the following:
- An in-flight `syncing`/`computing` becomes `idle`. The allocator poll's success path writes its own status at the end, with no condition on the current status (`job_worker.py`, the "Persist + success status update" block at `~15977`), so the effect is a missing spinner until the job finishes.
- `complete`/`complete_with_warnings`/`rate_limited` becomes `idle`, and `sync_error` is wiped until the next sync. That is the text explaining those states on the key card.

What does NOT break, read rather than assumed:
- The in-flight gate in `request_allocator_holdings_sync` counts `compute_jobs` rows (`status IN ('pending','running','done_pending_children')`, 20261103120000), not `sync_status`.
- `account_identity.py:714` treats `syncing` as not-yet-proven, for the swap decision only. A key the rotate just reset to `idle` was in fact proven, by the rotate's own probe, so that reading is correct.

The recorded race is real for the same population, and probable. The CONN-02 user has just changed the password at the broker, so a sync already running with the old password fails and writes `sign_in_failed` after the rotate lands. "The next sync clears it" holds only through the daily `enqueue_poll_allocator_positions_for_all_keys`. Its newest definition (20260422101911, about `:192-197`) enqueues every active, non-revoked, connected key, `sign_in_failed` and strategy-linked keys included, so recovery is within about a day. In the meantime:
- The reconstruct fan-out skips the key (`NOT IN ('sign_in_failed','error')`, 20261021120000).
- A further reconnect takes the 225-07 `failing_holder` swap and mints a new key beside the one that already holds the correct password.

The founder deferred the guard to the 225-21 poll writers (CONTEXT Deferred), and every consumer above is a display, transient, or gated elsewhere. So this is LOW, but the recorded limit understates both halves.
**Fix:** Keep the race deferred to the poll-writer owner, and correct the recorded limit (helper docblock and CHANGELOG): recovery is the daily poll, and the wizard leg resets healthy statuses too. For the deterministic half, the minimal direction is to leave the status and error reset out of the payload when the caller is the wizard's working-holder leg, for example an opt-in `resetSyncState: false`. ⛔ Do NOT add a status filter to the UPDATE's WHERE clause: that would withhold the ciphertext too, and a validated password would go unsaved whenever a sync happened to be running.

### IN-03 (LOW): The password notice survives an exchange switch, beside a form it does not describe

**File:** `src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx:1087-1090` (render at `:1919-1932`)
**Issue:** `onSelectExchange` clears `errorCode` but not `keyOutcome`, and the notice renders independently of the envelope (`{keyOutcome && <p …>}`). After an `updated` answer, switching from MT5 to OKX removes the refusal and leaves "We updated the password on your key "K". No new key or strategy was created." above the OKX form. The sentence is still historically true, but UI-SPEC §4.1 declares that the `stale` state "cannot occur".
**Fix:**
```ts
const onSelectExchange = useCallback((next: ExchangeId) => {
  setExchange(next);
  setErrorCode(null);
  setKeyOutcome(null);
}, []);
```

### IN-04 (LOW): A Disconnect that lands during the probe is written through and reported `updated`

**File:** `src/lib/api/rotate-key-secret.ts:126-128`; `src/app/api/strategies/create-with-key/route.ts:1911-1931`
**Issue:** The wizard leg re-reads with `.is("disconnected_at", null)`, but the shared UPDATE has no liveness filter. If the owner presses Disconnect during the up-to-120 s probe:
- the write still lands on the now-disconnected key, with `sync_status: idle`;
- `history_inclusion: null` is written, because `returnsKeyToLive` came from the live pre-read;
- the answer is "We updated the password…".

The helper records this as limit (2). It is new here only in that this caller asserts liveness at the re-read and then does not hold it at the write. Relatedly, a re-read that finds no row (`:1931`) answers the verdict computed before the disconnect, for example `VENUE_ALREADY_CONNECTED` for a key that is no longer connected.
**Fix:** Add an opt-in `requireLive: true` from the wizard caller that appends `.is("disconnected_at", null)` to `attemptPersist`. Zero rows then maps to `write_zero_rows`, which already answers `UNKNOWN`. Rotate-secret stays byte-identical.

### IN-05 (INFO): The `@audit-skip` pragmas are the census's prescribed shape: confirmed legitimate, not a bypass

**File:** `src/app/api/keys/[id]/rotate-secret/route.ts:344`; `src/app/api/strategies/create-with-key/route.ts:1947`
**Issue:** Plan 01 forbade the pragma on the premise that the census would accept an audit that lives in the helper. It does not.
- `findImportedMutatorCalls` (`audit-coverage.test.ts:812-862`) flags every call to a local export that mutates.
- The header (`:52-56`) says a cross-file audit "must … pragma-skip the mutation with a reason explaining where the audit lands".
- The repo already carries the same shape at `create-with-key/route.ts:2667` (afterSlotSwap).

Is the pragma load-bearing at each site?
- Measured at rotate-secret only: plan 01's summary records the red when the pragma was absent.
- At create-with-key it is derived, not measured: `route.ts` contains no `logAuditEvent` call anywhere, so nothing else in the POST body could satisfy the same-function walk.

The audit lands: `logAuditEvent(supabase, { action: "api_key.rotate_secret" })` runs in the same function as the UPDATE, only on `ok`, through `after()`. It is pinned both ways:
- `rotate-key-secret.test.ts:234` asserts one audit on a landed write, and zero on every failure kind.
- The route test asserts one on `updated` (`route.test.ts:4758`), and none on `unchanged` or a refusal (`:4911`, `:4985`).

**Fix:** None. Recorded as a deviation confirmed by review.

### IN-06 (INFO): The seam's own per-key 429 renders `KEY_RATE_LIMIT` ("the exchange asked us to slow down") on the wizard leg

**File:** `src/lib/wizardErrors.ts:5251` (reached via the `create-with-key/route.ts` outer catch)
**Issue:** `rotate_key_secret`'s `_consume_rate_limit(key_id)` caps the key at 10 calls per 60 s (`internal.py:123-124`). The bucket is shared with `get_key_permissions`. A refusal answers wire `RATE_LIMITED`, which the verdict table maps to `KEY_RATE_LIMIT`, whose cause calls the throttle "exchange-side". It is our own cap. The mapping pre-exists on PATCH rotate-secret. The wizard cannot realistically reach it: its own bucket allows 5 calls per 60 s, and probes are serialized. Recorded only because this leg is a new surface for it.
**Fix:** None now. If it is ever observed, answer the route's own `RATE_LIMITED` for a seam-side 429 on this leg.

### IN-07 (INFO): The O3 test exercises a shape the real seam never throws

**File:** `src/app/api/strategies/create-with-key/route.test.ts:4966-4980`
**Issue:**
- `rotateKeySecretMock.mockRejectedValue(new Error(detail))` throws a bare `Error`, with no `seamCode`, `status` or `name`.
- Two of the three detail strings are invented ("MT5 master password detected. Use the investor password.", "Broker server not found. Check the server name."). The real constants are `MT5_MASTER_PASSWORD_DETAIL` and `MT5_WRONG_SERVER_DETAIL` (`services/closed_sets.py:100-106`).
- The plan's must-have names `KEY_MT5_SIGN_IN_REFUSED`, which comes from wire `MT5_SIGN_IN_REFUSED` (424) through `seamCode`. No test drives it on this route.
- Every transport failure (WR-01) is likewise untested here.

The zero-writes property still holds by construction, because every throw exits before the persist. Only the code assertions are weakly grounded.
**Fix:** Build the rejections the way `rotateKeySecret` does (`Object.assign(new Error(realDetail), { name: "AnalyticsUpstreamError", status, seamCode })`), and add a `MT5_SIGN_IN_REFUSED` row.

### IN-08 (INFO): A successful password update fires a `wizard_error` analytics event

**File:** `src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx:1230-1234`
**Issue:** The rotate leg answers through a 409, so `trackForQuantsEventClient("wizard_error", { code })` fires for an `updated` or `unchanged` outcome. The funnel then counts a verified write as an error.
**Fix:** Add the outcome to the payload, or skip the event when one is present.

### IN-09 (INFO): The Python compare would raise after a successful probe if the stored secret were ever not a `str`

**File:** `analytics-service/routers/internal.py` (`secret_changed = not secrets.compare_digest(old_password.encode("utf-8"), ...)`)
**Issue:** `decrypt_credentials` returns `payload["api_secret"]` untyped from JSON. A non-`str` value would now raise `AttributeError` after a successful sign-in, an unhandled 500, and so regress PATCH rotate-secret, which used to discard the old password. Every writer goes through `encrypt_credentials` with a `str`, so this is unreachable at HEAD.
**Fix:** None required. If hardened, treat a non-`str` as `secret_changed = True`.

### IN-10 (INFO): The F6 strip wording departs from the CONTEXT spec, and is more accurate for it

**File:** `src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx:1410`
**Issue:** CONTEXT asked the strip to say that the credentials "were not checked or saved". The shipped sentence is "The details you just entered did not change that key." The fallback is also reached from the post-validation same-session draft arm (`create-with-key/route.ts:~2075-2085`), where the credentials *were* checked, so "not checked" would have been false there. Recorded so nobody "fixes" it back.
**Fix:** None.

---

_Reviewed: 2026-11-26T16:24:31Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
