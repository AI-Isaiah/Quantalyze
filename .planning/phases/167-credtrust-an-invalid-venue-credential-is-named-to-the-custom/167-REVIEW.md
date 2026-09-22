---
phase: 167-credtrust-an-invalid-venue-credential-is-named-to-the-custom
reviewed: 2026-09-22T19:55:55Z
depth: standard
files_reviewed: 32
files_reviewed_list:
  - analytics-service/docs/STATUS_CONTRACT.md
  - analytics-service/routers/exchange.py
  - analytics-service/services/allocator_positions.py
  - analytics-service/services/exchange.py
  - analytics-service/services/job_worker.py
  - analytics-service/tests/fixtures/validate_key_venue_transient_contract.json
  - analytics-service/tests/test_allocator_positions.py
  - analytics-service/tests/test_allocator_positions_non_ccxt.py
  - analytics-service/tests/test_mt5_validate.py
  - analytics-service/tests/test_validate_key_venue_transient.py
  - scripts/mutation-runner/run.mjs
  - src/__tests__/gate-family-meta.test.ts
  - src/__tests__/lint-sql-gates.test.ts
  - src/__tests__/mutation-annotation-parser.test.ts
  - src/__tests__/mutation-runner-floors.test.ts
  - src/app/(dashboard)/allocations/components/HoldingsTable.test.tsx
  - src/app/(dashboard)/allocations/components/HoldingsTable.tsx
  - src/app/(dashboard)/allocations/components/OpenPositionsTable.tsx
  - src/app/(dashboard)/allocations/components/untrusted-key-status.surfaces.test.tsx
  - src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx
  - src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.tsx
  - src/components/exchanges/AllocatorSyncStatus.test.tsx
  - src/components/exchanges/AllocatorSyncStatus.tsx
  - src/lib/closed-sets.ts
  - src/lib/closed-sets.untrusted-key-status.test.ts
  - src/lib/dialog-envelope.invariant.test.ts
  - src/lib/seam-venue-vocabulary.invariant.test.ts
  - src/lib/wizardErrors.test.ts
  - src/lib/wizardErrors.ts
  - supabase/migrations/20260922120000_api_keys_sync_status_sign_in_failed.sql
  - supabase/tests/test_api_keys_sync_status_sign_in_failed.sql
  - tests/lib/validate-key-venue-transient-parity.test.ts
findings:
  critical: 1
  warning: 6
  info: 4
  total: 11
status: issues_found
---

# Phase 167: Code Review Report

**Reviewed:** 2026-09-22T19:55:55Z
**Depth:** standard
**Files Reviewed:** 32
**Status:** issues_found

## Summary

All 32 files in scope were reviewed at standard depth. Where a claim depended on a callee, the callee was read too (`services/mt5_client.py` `Mt5Client.login` / `account_info` / `_guarded_read` / `_raise_last`, `services/mt5_probe.py` `run_probe`, `services/mt5_validation.py` `classify_mt5_login_error`, `services/job_worker.py` `classify_exception`, `components/strategy/UpdateMt5SecretDialog.tsx`, `components/exchanges/AllocatorExchangeManager.tsx`, `app/api/keys/[id]/rotate-secret/route.ts`). Citations are by symbol, not by line number.

**The mechanics hold.** The cross-language mint works end to end: the wire code, the `VENUE_WIRE_CODE_TO_VERDICT` row, both wizard rosters and the dashboard-dialog roster are wired, and `recoverable` agrees on the wire and in the envelope. The handler-arm order in `run_poll_allocator_positions_job` is correct and is pinned by behaviour, not by source text. `SYNC_ERROR_COPY_BY_STATUS` has its row, with a pin written specifically against the fallback. All seven former `revoked` equalities now go through `isUntrustedKeySyncStatus` / `untrustedKeyChipLabel`.

**The defect is in scope, not in wiring.** Both new "sign-in failed" arms (the wizard's `SIGN_IN_FAILED` tail in `_validate_mt5_key_probe` and the holdings poll's `except Mt5ClientError` in `_fetch_mt5_account_rows`) catch every `Mt5ClientError` their `try` block produces. Those blocks also contain calls that run after a successful login, and transport calls where no credential has been sent yet. I checked this by running two throwaway probes against this worktree's code (kept in the session scratchpad; no source file was touched):

- **Holdings poll.** A failure in `account_info()` after a successful `login()`, and an RPyC stream drop inside `initialize()` before any credential is sent, both raise `AllocatorHoldingsSignInFailedError`. The owner therefore sees `sign_in_failed`, "Reconnect this account — its credentials may have changed.", and that account's holdings are hidden by default.
- **Wizard.** With `login()` and `account_info()` succeeding, a probe `order_check` failing with an IPC timeout returns `424 SIGN_IN_FAILED` with `recoverable=False`.

This is the exact wrong-cause harm the phase exists to remove, and D-03's premise names it: a key with good credentials must not be told to fix itself.

**Test runs** (read-only, from this worktree):
- pytest over the 4 changed Python test files: 225 passed, 1 skipped, collection non-empty.
- vitest over the 12 changed TS test files: 11 files green (695 tests passed). `src/__tests__/lint-sql-gates.test.ts` has 4 red cases. All 4 are pre-existing `EXECUTION ORACLE` cases this phase did not modify, each timing out at about 6.5 s against the 5 s default, and they failed the same way when run alone. This looks like local load, not something the phase caused. I did not verify it on `origin/main`, so treat it as unconfirmed rather than cleared.

Out of scope as instructed: the migration and its SQL gate (closed by two prior review rounds and founder-approved), D-07's copy stance, D-08's Retry suppression, and the `HoldingsTabPanel` / `ApiKeyManager` exclusions. The findings below do not reopen D-07 or D-08. They concern which faults reach the arms those decisions govern.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: The holdings poll's sign-in arm catches post-login read failures and pre-credential transport drops, and stamps them `sign_in_failed`

**File:** `analytics-service/services/allocator_positions.py` — `_fetch_mt5_account_rows`, the `except Mt5ClientError` arm around `_mt5_read`
**Issue:** `_mt5_read` runs `session.client.login(...)` and then `session.client.account_info()` inside one `try`, and the `except Mt5ClientError` arm raises `AllocatorHoldingsSignInFailedError` for every `Mt5ClientError` either call produces. The arm's own comment gives its justification as "This is the arm where a LOGIN WAS ATTEMPTED AND DID NOT SUCCEED". That is true for only one of the ways into the arm:
- `Mt5Client.account_info()` raises `Mt5ClientError` through `_raise_last()` when it gets `None`. That happens after `login()` has returned successfully, for example on an IPC detach, a wedged pipe or a `-10004` / `-10005` mid-read.
- `Mt5Client._guarded_read` turns any raw transport exception into `Mt5ClientError(0, …)`.
- `Mt5Client.login()` itself turns an `initialize()` transport exception (for example an RPyC `EOFError` while the gateway redeploys) into `Mt5ClientError(0, …)`. No credential has been sent at that point.

Measured with a throwaway probe against this worktree:
- A transport where `initialize` and `login` succeed and `account_info` returns `None` (`last_error` = IPC detach) produced `AllocatorHoldingsSignInFailedError`, with calls `initialize → login → account_info`.
- A transport whose `initialize` raises `EOFError` produced `AllocatorHoldingsSignInFailedError`, with calls `initialize` only.

What the user gets: `api_keys.sync_status='sign_in_failed'`, an amber "Sign-in failed" pill, the helper "Reconnect this account — its credentials may have changed.", and a `sync_error` reading "Couldn't sign in to MT5 with these credentials — reconnect this account…". Through the D-16 predicate, that key's holdings are also hidden from `HoldingsTable` by default and struck through on `OpenPositionsTable`. Before this phase the same faults read "MT5 terminal unreachable", which was true for them.

A gateway redeploy or a terminal wedge hits every MT5 key on that terminal at once. So this tells every MT5 owner to fix a credential that is fine, which is the case D-03 says must not happen.

The new end-to-end test `test_mt5_refused_sign_in_writes_sign_in_failed_end_to_end` avoids this path on purpose ("`initialize()` succeeds … this is deliberately NOT a transport fault"). Nothing pins what should happen when `initialize()` or `account_info()` fails. The class docstring on `AllocatorHoldingsSignInFailedError` also says auth and wrong-server are "indistinguishable at that boundary". Yet `classify_mt5_login_error`, which the wizard applies to the same boundary, does separate `auth`, `wrong_server` and `transient`. The poll throws that signal away.
**Fix:** Mark only a failure of the `login()` stage as a sign-in failure, and let a post-login read failure keep its existing transport disposition. For example:
```python
class _Mt5LoginRefused(Exception):
    def __init__(self, cause: Mt5ClientError) -> None:
        super().__init__("login refused")
        self.cause = cause

def _mt5_read() -> dict[str, Any]:
    try:
        session.client.login(session.login, session.investor_password, session.server)
    except Mt5ClientError as exc:
        raise _Mt5LoginRefused(exc) from exc
    info = session.client.account_info()   # a failure here is NOT a sign-in verdict
    _assert_expected_login(info)
    return info
...
except _Mt5LoginRefused as wrapped:
    if _must_reach_handler_unwrapped(wrapped.cause):
        raise wrapped.cause
    raise AllocatorHoldingsSignInFailedError(
        SIGN_IN_FAILED_NOTE.format(venue=_venue_display(exchange_name))
    ) from wrapped.cause
except Mt5ClientError as exc:   # post-login read: unchanged pre-167 posture
    if _must_reach_handler_unwrapped(exc):
        raise
    raise AllocatorHoldingsSyncTransientError(MT5_UNREACHABLE_NOTE) from exc
```
Also stop the `initialize()` transport-raise path inside `Mt5Client.login` from counting as a login refusal. Either expose the failing stage (the client already brackets `initialize` and `login` separately in `_timed`), or check `classify_mt5_login_error` and treat only `auth` / `wrong_server` (plus whichever transient codes the founder decides count as credential-caused under D-08's `-10005` modal-dialog finding) as sign-in failures. Add behavioural cases for "account_info fails after a successful login" and "initialize raises" that assert `sync_status == 'error'`.

## Warnings

### WR-01: The wizard's `SIGN_IN_FAILED` tail also catches failures after a successful login, and removes Retry for them

**File:** `analytics-service/routers/exchange.py` — `_validate_mt5_key_probe`, the `except Mt5ClientError` arm around `run_probe`
**Issue:** `services/mt5_probe.py` `run_probe` runs `login` → `account_info` → `read_terminal` → `order_check` → `account_info`, all in the one `try` whose `except Mt5ClientError` now answers `SIGN_IN_FAILED` / `recoverable=False` whenever `classify_mt5_login_error` returns `transient`. `transient` is the classifier's default for any text it does not recognise. So a failed `order_check` or post-login `account_info`, after the credential has already been accepted, reaches the arm too.

Measured with a throwaway probe through the router test harness: `login` and `account_info` succeed, the terminal reports connected with trading permitted, and `order_check` raises `Mt5ClientError(-10005, "IPC timeout")`. The result is `424`, `code=SIGN_IN_FAILED`, `recoverable=False`, with `login.called=True` and `order_check.called=True`.

The user is told "We could not sign in to this account." and gets no Retry, after a sign-in that succeeded. The arm's comment, the S-27 row in `STATUS_CONTRACT.md`, the fixture's C5 note and the `KEY_SIGN_IN_FAILED` docblock all say "a login was attempted and did not succeed / the ONE arm where a sign-in was actually tried", and none of them hold for these paths. This does not reopen D-07 or D-08. Those decisions govern what the arm says and whether it offers Retry, and both rest on a sign-in actually failing. This finding is about faults that reach the arm without one.
**Fix:** Same shape as CR-01. Split `run_probe`'s `login` stage from its post-login reads, either by letting `run_probe` tag the stage or by wrapping `client.login` in a marker exception. Send only login-stage transients to `SIGN_IN_FAILED`, and keep the pre-167 `NETWORK_UNAVAILABLE` / `recoverable=True` answer for post-login read failures. Add a C5-sibling wire case, "order_check raises after a successful login", pinned to `NETWORK_UNAVAILABLE`. Land it together with CR-01 so the two surfaces keep one definition of "sign-in failed".

### WR-02: The MT5 investor-password bullet never renders on the MT5-only "Update password" dialog

**File:** `src/lib/wizardErrors.ts` — `WIZARD_ERROR_COPY.KEY_SIGN_IN_FAILED.fixRequires` (`REQUIRES_MT5`), consumed by `src/components/strategy/UpdateMt5SecretDialog.tsx`
**Issue:** `fix[1]` ("For MT5 that is the investor (read-only) password…") depends on `REQUIRES_MT5`, a `venueIs` requirement that is suppressed whenever `context.venue` is missing (`requirementMet`). `UpdateMt5SecretDialog` builds its envelope as `buildEnvelope(recogniseDashboardDialogCode(ROUTE, body?.code), correlationId)` with no context. The route behind it (`keys/[id]/rotate-secret`) is MT5-only by construction (`.eq("exchange", "mt5")`), and `KEY_SIGN_IN_FAILED` was added to its roster in this phase. So the one surface guaranteed to be MT5 is the one that never shows the MT5-specific remedy. `dialog-envelope.invariant.test.ts` counts the roster (32 → 33) but never renders the bullets.
**Fix:** Pass the venue the dialog already knows: `buildEnvelope(code, correlationId, { venue: "mt5" })`. Add a case asserting that the dialog's `KEY_SIGN_IN_FAILED` envelope includes the investor-password bullet.

### WR-03: The owner-surface remedy says "Reconnect", which names a different control that retries the stored credential

**File:** `src/components/exchanges/AllocatorSyncStatus.tsx` — `CREDENTIAL_FAILED_HELPER`; `analytics-service/services/allocator_positions.py` — `SIGN_IN_FAILED_NOTE`
**Issue:** Both strings tell the owner to "Reconnect this account". On the card where the pill renders (`AllocatorExchangeManager`, active keys), the controls are "Sync now", "Update password" (MT5) and "Disconnect". A control labelled **Reconnect** exists only in the Disconnected section. `AllocatorExchangeManager` documents it as distinct from Update password: that dialog exists because "this credential is WRONG and needs re-validation, not a retry of the stored one". An owner who follows the copy literally will either find nothing called Reconnect, or disconnect and then Reconnect, which re-runs the same stored credential the sign-in arm just failed. That is the one action that cannot fix the condition the copy describes. The fix that does work, `rotate-secret` via "Update password", writes `sync_status: "idle"` unconditionally.
**Fix:** Name the control that exists and fixes the problem. For MT5, something like "Update this account's password — its credentials may have changed." (the helper can stay venue-agnostic with "Update this account's credentials"). Apply the same wording to `SIGN_IN_FAILED_NOTE`, and update the LOCKED pins in `AllocatorSyncStatus.test.tsx` in the same commit.

### WR-04: The poll keeps re-running a failing MT5 login against the shared terminal, which contradicts D-08's own premise

**File:** `analytics-service/services/job_worker.py` — `run_poll_allocator_positions_job`, `except AllocatorHoldingsSignInFailedError` (`error_kind="transient"`)
**Issue:** D-08, the router comment and the `KEY_SIGN_IN_FAILED` docblock all say that repeating a validate against the one shared terminal, after a wrong password, is "the operation implicated in wedging and account eviction (164.6.5 / 164.6.6), so … the Retry is … the harmful action". The new poll arm now knows it is looking at a failed sign-in, yet it deliberately keeps `error_kind="transient"`. That sends the job up the full 30 s → 6 h backoff ladder, and every rung re-runs `login()` with the same stored password against the same shared terminal, on top of the daily cron re-enqueue (which excludes only `revoked`). The arm's comment justifies this as "a rotated credential is precisely what a later poll should pick up". But a rotation already resets the key: `rotate-secret` writes `sync_status: "idle"` and fresh ciphertext, and the daily cron re-enqueues the key anyway. The ladder adds only repeated wrong-password logins. This behaviour predates the phase, but the phase is where it became knowable and is now written down as correct.
**Fix:** Once CR-01 is fixed and the arm only sees real login-stage refusals, classify this arm `permanent` for the job (`error_kind="permanent"`). That stops the in-job ladder, and the daily cron plus `rotate-secret` still guarantee pickup. If that is judged out of scope, record it as a routed decision rather than a correct-by-construction claim, and remove "which is correct" from the arm's comment.

### WR-05: The two-arm design creates the silent ordering hazard it then documents; one arm would remove it structurally

**File:** `analytics-service/services/job_worker.py` — `run_poll_allocator_positions_job`, `except AllocatorHoldingsSignInFailedError` / `except AllocatorHoldingsSyncTransientError`
**Issue:** The new arm is a line-for-line copy of the parent arm (same `human_copy`, same update shape, same audit call, same `DispatchResult`). The only difference is the `sync_status` literal. The subclass relationship is what makes the ordering matter and fail silently, as the file's own comment says ("an arm placed BELOW the parent's is DEAD CODE … Nothing about the failure is visible"). A behavioural test pins it today. The hazard itself is a structural choice, though, and the duplicated body is a second copy that can drift (a later fix to one arm's audit metadata or cap will miss the other). Under Rule 6 this is a band-aid (a pin) where the root cause (two arms for one disposition) could be removed.
**Fix:** Carry the status on the exception and collapse the two arms into one:
```python
class AllocatorHoldingsSyncTransientError(Exception):
    sync_status: ClassVar[str] = "error"

class AllocatorHoldingsSignInFailedError(AllocatorHoldingsSyncTransientError):
    sync_status: ClassVar[str] = SIGN_IN_FAILED_SYNC_STATUS

# job_worker — ONE arm; order is no longer load-bearing
except AllocatorHoldingsSyncTransientError as exc:
    status = exc.sync_status
    human_copy = str(exc)[:500]
    ...update({"sync_status": status, "sync_error": human_copy})...
```
The roster test `test_every_status_this_module_can_write_has_its_own_copy_row` still works if derivation (2) also reads `sync_status` class attributes.

### WR-06: The re-written T4/T5/T6 pins check the copy against itself, so the "locked" filter wording is no longer locked

**File:** `src/app/(dashboard)/allocations/components/HoldingsTable.test.tsx` — T4, T5, T6; `src/lib/closed-sets.ts` — `UNTRUSTED_KEY_SET_NOUN`
**Issue:** T4, T5 and T6 now build their expected text from `UNTRUSTED_KEY_SET_NOUN`, the same constant the component renders, and a repository-wide search found no other pin of that constant's value. T6 used to be an "exactly" pin on the literal label. Now any rewording of the constant passes all three, as long as it is not empty (T6's exact match catches an empty noun) and is not literally "revoked keys" (T4's anti-vacuity `queryByText(/hidden from revoked keys/)` catches that one). That includes a cause-specific noun such as "failed sign-ins", which brings back the exact "names a narrower set than it hides" defect the constant's own comment describes. The T6 comment says the pin was "never relaxed to a substring match" and "still fails if the label is … reworded by hand". The second claim is false for a rewording made in the constant, which is the only place the wording now lives. A secondary problem: the noun is put into `new RegExp(...)` without escaping, so a future noun containing regex metacharacters silently changes what T4 and T5 match.
**Fix:** Pin the literal once, in `src/lib/closed-sets.untrusted-key-status.test.ts`:
```ts
it("UNTRUSTED_KEY_SET_NOUN is the cause-neutral set noun, verbatim", () => {
  expect(UNTRUSTED_KEY_SET_NOUN).toBe("keys needing attention");
});
```
Keep T4, T5 and T6 deriving from the constant (they prove it is wired up), and escape the noun before building the RegExp.

## Info

### IN-01: The STATUS_CONTRACT raise-site census double-counts S-27, and the §7 tally contradicts its own legend

**File:** `analytics-service/docs/STATUS_CONTRACT.md` — the "`VenueTransientHTTPException`'s seven raise sites" paragraph and §7 "Tally"
**Issue:** "Plus an eighth (… S-27)" adds a raise site that is already one of the seven listed just above it ("MT5 transient client error"). The phase narrowed that existing site; it did not add one. The S-27 row's own "Before" column (`424 NETWORK_UNAVAILABLE`) shows this. §7's legend was updated to "24 explicit sites", but the Tally paragraph still reads "26 rows = 23 explicit editable sites" even though the table now has 27 rows.
**Fix:** Change "Plus an eighth" to say that one of the seven was narrowed, and correct the Tally line (or remove its numbers, following the repo's cite-by-symbol rule).

### IN-02: The handler's docstring vocabulary is stale

**File:** `analytics-service/services/job_worker.py` — `run_poll_allocator_positions_job` docstring
**Issue:** It still says the handler maps failures to "('revoked' / 'rate_limited' / 'error')". `sign_in_failed` is now written by this handler.
**Fix:** Add `sign_in_failed` and point to `AllocatorHoldingsSignInFailedError`.

### IN-03: `PILL_STYLES` is exported from a `"use client"` component module only so a test can reach it

**File:** `src/components/exchanges/AllocatorSyncStatus.tsx` — `export const PILL_STYLES`
**Issue:** A non-component export from a component module takes that module out of React Fast Refresh's component-only boundary, so an edit forces a full reload. It also leaves an importable client-reference value that a future server component could pick up by mistake.
**Fix:** Move `PILL_STYLES` (and ideally the label switch) into a plain module, for example next to `closed-sets.ts`, and import it from both the component and the roster test.

### IN-04: The `revoked` names now carry the wider untrusted meaning

**File:** `src/app/(dashboard)/allocations/components/OpenPositionsTable.tsx` — local `isRevoked`; `HoldingsTable.tsx` — `showRevoked`, `onShowRevokedChange`, `revokedStatusByHoldingId`, `HoldingNoteIconButton revoked={isUntrusted}`
**Issue:** `isRevoked = untrustedLabel !== null` is now true for `sign_in_failed` too. The rename was deferred for the shared component, but `OpenPositionsTable`'s `isRevoked` is a local variable inside this phase's own diff.
**Fix:** Rename the local to `isUntrusted` (as `HoldingsTable` already did) and route the prop and state renames to a follow-up.

---

_Reviewed: 2026-09-22T19:55:55Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
