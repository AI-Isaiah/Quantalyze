---
phase: 167-credtrust-an-invalid-venue-credential-is-named-to-the-custom
round: 2
reviewed: 2026-09-22T20:50:22Z
reviewed_at_sha: b52b6032
diff_base: b12dd05c
depth: standard
files_reviewed: 26
files_reviewed_list:
  - analytics-service/docs/STATUS_CONTRACT.md
  - analytics-service/routers/exchange.py
  - analytics-service/services/allocator_positions.py
  - analytics-service/services/job_worker.py
  - analytics-service/services/mt5_client.py
  - analytics-service/services/mt5_validation.py
  - analytics-service/tests/fixtures/validate_key_venue_transient_contract.json
  - analytics-service/tests/test_allocator_positions.py
  - analytics-service/tests/test_allocator_positions_non_ccxt.py
  - analytics-service/tests/test_mt5_client_contract.py
  - analytics-service/tests/test_mt5_read.py
  - analytics-service/tests/test_mt5_validate.py
  - analytics-service/tests/test_raw_5xx_census.py
  - analytics-service/tests/test_validate_key_venue_transient.py
  - src/__tests__/contracts/check-zod-db-check-parity.test.ts
  - src/app/(dashboard)/allocations/components/HoldingsTable.test.tsx
  - src/app/(dashboard)/allocations/components/OpenPositionsTable.tsx
  - src/app/(dashboard)/allocations/components/untrusted-key-status.surfaces.test.tsx
  - src/components/exchanges/AllocatorSyncStatus.test.tsx
  - src/components/exchanges/AllocatorSyncStatus.tsx
  - src/components/exchanges/allocator-sync-pill-styles.ts
  - src/components/strategy/UpdateMt5SecretDialog.test.tsx
  - src/components/strategy/UpdateMt5SecretDialog.tsx
  - src/lib/closed-sets.ts
  - src/lib/closed-sets.untrusted-key-status.test.ts
  - tests/lib/validate-key-venue-transient-parity.test.ts
findings:
  critical: 1
  warning: 1
  info: 4
  total: 6
status: issues_found
---

# Phase 167: Code Review Report, Round 2 (fix round)

**Reviewed:** 2026-09-22T20:50:22Z
**Depth:** standard, with call sites traced
**Files Reviewed:** 26 (the `b12dd05c..b52b6032` diff, `.planning/` excluded)
**Status:** issues_found

## Summary

This round reviewed the 26-file fix-round diff and the call sites it touches:
- `Mt5Client.login`, `_raise_last`, `_guarded_read` and `account_info`
- `services/mt5_probe.py` `run_probe`
- `classify_mt5_login_error` and `_IPC_TRANSPORT_CODES`
- the holdings `_mt5_read` and its `except` ladder
- `run_poll_allocator_positions_job` and the dispatcher's use of `error_kind`
- the latest `mark_compute_job_failed` and `enqueue_poll_allocator_positions_for_all_keys` definitions
- the `rotate-secret` and manual-sync routes
- the `KEY_SIGN_IN_FAILED` docblocks in `src/lib/wizardErrors.ts`

All citations are by symbol.

**The mechanical fixes hold.**
- **The marker cannot leak onto another path.** `Mt5LoginRefusedError` is constructed in exactly one place: the last raise of `_raise_last`, and only when `login`'s falsy arm passes `answered_type`. The two earlier raises (`last_error` round trip died, or returned nothing) stay the base class. The `initialize()` arms and the transport-raise arm are untouched.
- **Redaction is unchanged.** The same `_redact_with_optional_credentials(text, credentials)` call feeds whichever class is raised.
- **Nothing drops the type.** No code in `services/` or `routers/` catches the marker and re-raises it as a plain `Mt5ClientError`, and no code checks for the exact type or class name.
- **The permanent disposition works as intended.**
  - `mark_compute_job_failed` sends `p_error_kind = 'permanent'` straight to `failed_final`.
  - The daily `enqueue_poll_allocator_positions_for_all_keys` filters only `revoked`, `is_active` and `disconnected_at`, so a `sign_in_failed` key is re-polled once a day.
  - The manual "Sync now" route is still available.
- **The one-arm handler is sound.** WR-05's single arm is correct, and the H2 fallback does what its commit says.
- **Both moved census pins are justified by real new sites or cases, not by blanket bumps:**
  - `TOTAL_CASES` 14 → 15: one new fixture case, `mt5_post_login_client_error`. It is recoverable and reuses an existing code, so the distinct-code and non-recoverable counts correctly stay where they were.
  - `EXPECTED_SUBCLASS_CONSTRUCTION_SITES` 12 → 13: `raise VenueTransientHTTPException` in `routers/exchange.py` is 11 on `main`, 11 at `b12dd05c` and 12 at HEAD, plus 1 in `routers/portfolio.py`.

**The regression is in a decision, not in the wiring.** To narrow the sign-in arm, the fix round had to decide which login-stage codes count as "sign-in failed". Its answer contradicts D-07 and D-08, even though the fix commit says it does not reopen them (CR-01 below). Separately, the predicate's IPC gate is narrower than this repo's own list of IPC faults (WR-01).

Evidence: one read-only probe, run with the worktree's interpreter, that evaluated `classify_mt5_login_error` and `is_mt5_login_refusal` over MT5 `last_error` codes. No source file was touched and no test suite was re-run (the orchestrator's full runs at this SHA are the suite evidence).

## Round 1 disposition

| Round-1 finding | Verdict at `b52b6032` | Note |
|---|---|---|
| CR-01 holdings poll stamps transport and post-login faults `sign_in_failed` | **Closed for the paths named**, with a residual | `initialize()` falsy or raising, transport raising mid-login, `account_info()` failing after login, and a `last_error` round trip that died or answered nothing all stay the base type. This is pinned at the client level and end to end. Residual: WR-01 below. |
| WR-01 wizard `SIGN_IN_FAILED` catches post-login failures | **Closed** | A post-login `order_check` or `account_info` failure goes back to `NETWORK_UNAVAILABLE` / `recoverable=true`, with a wire case and a router case. The same commit introduced CR-01 below. |
| WR-02 dialog envelope built without venue | **Closed** | `{ venue: "mt5" }` is passed. Two dialog cases were added, with expected text typed literally. |
| WR-03 copy names "Reconnect" | **Closed** | Both the TS helper and the Python note were reworded. A literal pin and a no-"reconnect" guard were added on each side. The helper is 58 characters, inside the 60-character budget. |
| WR-04 sign-in failure climbs the retry ladder | **Closed** for the codes that now reach the type | The residual for the `-10005` class is part of CR-01 below. |
| WR-05 duplicated, order-sensitive handler arms | **Closed** | One arm reads `sync_status` / `error_kind` off the class. The roster pin gained runtime derivation (3). |
| WR-06 set-noun pins check the constant against itself | **Closed** | A literal pin was added, and the noun is regex-escaped in T4/T5. |
| IN-01 STATUS_CONTRACT census / tally | **Closed**, with a leftover | See IN-01 below. |
| IN-02 handler docstring vocabulary | **Closed** | |
| IN-03 `PILL_STYLES` in a `"use client"` module | **Closed** | Moved to a plain module. The component's only remaining exports are the component and a type. |
| IN-04 local `isRevoked` | **Closed** | |
| SFH H1 | **Closed with CR-01 (round 1)** | This is the overlap the orchestrator noted. |
| SFH H2 rejected `sign_in_failed` write swallowed | **Closed** | Logged at ERROR, then falls back to `'error'` and keeps the sign-in copy. A narrow follow-up is IN-04 below. |
| SFH M1 unknown status defaults to trusted, unguarded | **Closed** | `TRUSTED_OR_NEUTRAL_KEY_SYNC_STATUSES` was added, with a B9 CHECK-parity row that resolves the latest named `api_keys_sync_status_check` and a disjointness case. I checked that the resolver's regex captures the 9-value list in the 167 migration. |
| SFH M2 false AUM claim | **Closed** | The false sentence was corrected in all three places. The AUM change is booked as a follow-up. |
| SFH M3 / M4 | **Not independently dispositioned** | These IDs appear in no in-tree artifact or fix commit. The orchestrator reports they overlap CR-01, WR-01 and WR-04, and those are dispositioned above. |
| SFH L1 classifier raise logged at WARNING | **Closed** | Now logged at ERROR with `exc_info`, pinned by a caplog case. |

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: The fix round took the `-10004`/`-10005` login-stage class off `SIGN_IN_FAILED`, which reverses D-07/D-08 as they are recorded. The commits say the opposite.

**File:** `analytics-service/services/mt5_validation.py` — `is_mt5_login_refusal` (condition 2). Consumed by `routers/exchange.py` `_validate_mt5_key_probe` (`except Mt5ClientError` transient tail) and `services/allocator_positions.py` `_fetch_mt5_account_rows` (`except Mt5ClientError`).

**Issue:** `is_mt5_login_refusal` returns False for a login-stage refusal carrying `-10004` or `-10005`. Both surfaces then give the pre-167 answer:
- **Wizard:** `424 NETWORK_UNAVAILABLE`, `recoverable=true`, and a Retry is rendered.
- **Holdings poll:** `sync_status='error'`, `MT5_UNREACHABLE_NOTE` ("…sync will retry automatically."), `error_kind='transient'`, so the job climbs the full backoff ladder and re-runs `login()` on every rung.

The new router, holdings and wire cases (`login-stage-ipc-10004`, `login-stage-ipc-10005`) pin this. The fix commit says "D-07/D-08 are not reopened. -10004/-10005 stay on NETWORK_UNAVAILABLE, as before 167."

That claim is contradicted by the phase's own recorded decisions and by texts still shipped at HEAD:
- **D-08** says the Retry suppression is correct *because* "the measured mechanism for a wrong MT5 password is a MODAL LOGIN DIALOG blocking IPC (the `-10005` class)".
- The **`KEY_SIGN_IN_FAILED` union-member docblock** in `src/lib/wizardErrors.ts` says:
  - "The measured mechanism for a genuinely wrong MT5 password is a MODAL LOGIN DIALOG blocking IPC (the -10004/-10005 class)".
  - "A wrong MT5 password and an unreachable bridge both land here, on purpose (D-07)".
- The **router comment** that justifies `recoverable=False` on the `SIGN_IN_FAILED` raise still cites "a terminal a wrong password may have wedged behind a modal login dialog (the -10004/-10005 class)". That class can no longer reach the raise.
- The **fixture's C5 note** makes the same modal-dialog argument for `recoverable: false`.

Consequences, by the repo's own record of how a wrong MT5 password presents:
1. If a real wrong password arrives as `-10005`, the phase's headline MT5 case now gets exactly the pre-phase defect on both surfaces: a transport-sounding note, a retry promise, and a Retry control. D-08 calls that Retry "the harmful action".
2. WR-04's `permanent` disposition was justified by "every rung re-runs `login()` … against the ONE shared MT5 terminal (the D-08 harm)". It does not reach the one code class D-08 names, and that class still climbs the ladder.
3. Whether the phase delivers for MT5 at all now depends on which code a real wrong password produces:
   - `-6` (RES_E_AUTH_FAILED, the code the prober measured for an unauthorized terminal) classifies `transient` and does reach `SIGN_IN_FAILED`.
   - `-10005` does not.

   RESEARCH assumption A1 records that the `-10005` mechanism was never re-derived. So the fix round made the phase's outcome hinge on an unmeasured assumption, and recorded it as "not reopened".

Excluding `-10004` is defensible. Round 1's CR-01 is right that a detached bridge before any answer is not a sign-in verdict. `-10005` at the login stage is the case the locked decisions were written about, and the fix round decided it alone. Round 1 routed that choice to the founder ("whichever transient codes the founder decides count as credential-caused under D-08's -10005 modal-dialog finding").

**Fix:** This needs a decision, then all the code and docs made to agree. Pick one:
- **(a) Keep IPC codes on transport.** Record the reversal as a decision in `167-CONTEXT.md` **and** the ROADMAP (per the deviation policy). Rewrite the three texts that now contradict the code:
  - the `KEY_SIGN_IN_FAILED` docblock in `wizardErrors.ts`
  - the `recoverable=False` comment in `_validate_mt5_key_probe`
  - the fixture's C5 note

  Book the missing measurement (what a wrong investor password returns from `login()` on the gateway) as a routed item.
- **(b) Honour D-08.** Keep `-10004` (bridge detached) on transport, and let a login-stage `-10005` through as a sign-in refusal:

```python
# services/mt5_validation.py
_LOGIN_STAGE_TRANSPORT_CODES: tuple[int, ...] = (-10004,)  # bridge detached: no answer

def is_mt5_login_refusal(err: Mt5ClientError) -> bool:
    return (
        isinstance(err, Mt5LoginRefusedError)
        and err.code not in _LOGIN_STAGE_TRANSPORT_CODES
    )
```

With (b), flip the `login-stage-ipc-10005` cases (router, holdings, end to end) to expect `SIGN_IN_FAILED` / `sign_in_failed` / `permanent`. Either way, the commit text "D-07/D-08 are not reopened" must not stand.

## Warnings

### WR-01: `is_mt5_login_refusal`'s IPC gate is narrower than this repo's own list of IPC faults, so a login-stage IPC send, receive or init failure becomes a permanent `sign_in_failed`

**File:** `analytics-service/services/mt5_validation.py` — `_IPC_TRANSPORT_CODES` (`(-10004, -10005)`) as used by `is_mt5_login_refusal`

**Issue:** MT5's `last_error` internal-failure family is `-10000` … `-10005` (internal fail, send, receive, init, connect, timeout). This repo already treats `-10003` as an IPC fault in two places: `Mt5Client.assert_session_authorized`'s docstring ("`-10003` / `-10004` / `-10005` — IPC faults") and `services/mt5_relogin.py` (`_MT5_NO_AUTHORIZED_ACCOUNT_CODE`'s comment). The predicate only excludes two of them. Measured with a read-only probe over `Mt5LoginRefusedError(code, …)`:
- **`True` (reported as a sign-in refusal):** `-10000`, `-10001`, `-10002`, `-10003`. So is `1` (`RES_S_OK`, "success"), and so is `0` from `_raise_last`'s malformed-`last_error`-shape fallback (the "unknown (malformed last_error shape)" path).
- **`False`:** only `-10004` and `-10005`.

So a pipe that fails to send, receive or initialise during `login()` produces:
- **Holdings:** `sign_in_failed`, the key's holdings hidden by the D-16 filter, and, since WR-04, a `failed_final` job.
- **Wizard:** `SIGN_IN_FAILED` with no Retry.

This is the round-1 CR-01 harm, reached through the codes the fix did not list. The malformed-shape case also contradicts `_raise_last`'s new docstring ("when the terminal told us nothing … a transport drop must never be reported as a refused sign-in").

**Fix:** Gate the predicate on the whole internal range rather than two members, and do not let the malformed-shape fallback carry the marker:

```python
# services/mt5_validation.py
_MT5_INTERNAL_FAILURE_FLOOR = -10005  # RES_E_INTERNAL_FAIL_TIMEOUT
_MT5_INTERNAL_FAILURE_CEIL = -10000   # RES_E_INTERNAL_FAIL

def _is_internal_ipc_code(code: int) -> bool:
    return _MT5_INTERNAL_FAILURE_FLOOR <= code <= _MT5_INTERNAL_FAILURE_CEIL

def is_mt5_login_refusal(err: Mt5ClientError) -> bool:
    return (
        isinstance(err, Mt5LoginRefusedError)
        and not _is_internal_ipc_code(err.code)   # (adjust per CR-01's decision on -10005)
        and err.code not in (0, 1)                # no-answer / "success" is not a refusal
    )
```

In `Mt5Client._raise_last`, raise the base class from the malformed-shape arm. For example, set `answered_type = Mt5ClientError` inside the `except (TypeError, IndexError, KeyError, ValueError)` coercion. Add `-10001`, `-10002`, `-10003` and the malformed-shape case to the parametrized negatives in `test_mt5_client_contract.py` and to the holdings `test_mt5_client_error_that_is_not_a_login_refusal_keeps_the_transport_note`.

⚠️ Do not widen `_IPC_TRANSPORT_CODES` itself without checking `classify_mt5_login_error`'s locked 164.5.4 contract. Widening it only moves verdicts toward `transient`, which is the safe direction, but it is a separate decision.

## Info

### IN-01: A sentence in STATUS_CONTRACT §7 still refers to a number the rewritten Tally no longer states, and the new text cites a line number

**File:** `analytics-service/docs/STATUS_CONTRACT.md` — §7 "Tally" paragraph, and the "A second raise in the MT5 transient-client-error arm" paragraph

**Issue:**
- The Tally now reads "27 rows = 24 explicit editable sites …", and the following sentence still says "The `23` is the number that an `HTTPException` grep sweep under-counts by one". No `23` remains for it to refer to.
- The new paragraph points at "the `:409` entry above", a line-number anchor. The same section says these anchors have already rotted.
- The Tally calls S-27 a raise "added by Phase 167". The paragraph above says it "SPLITS that existing arm rather than adding a new failure". Both can be true, but the two descriptions read as if they disagree.

**Fix:** Recompute or drop the orphaned sentence. Say what grep over-counts or under-counts against the current 24. Replace `:409` with the symbol (`_validate_mt5_key_probe`'s `except Mt5ClientError` arm).

### IN-02: `_must_reach_handler_unwrapped`'s docstring still says the handler "hardcodes `error_kind='transient'`"

**File:** `analytics-service/services/allocator_positions.py` — `_must_reach_handler_unwrapped` docstring, reason 1

**Issue:** Since WR-05 and WR-04, the handler's single arm returns `exc.error_kind`, and the sign-in subclass declares `permanent`. The sentence "The handler's transient arm hardcodes `error_kind='transient'` … so a downgrade here is FINAL" is still true for the parent type, but it misstates the mechanism.

**Fix:** "The handler's transient arm returns the exception's declared `error_kind` (`transient` for the parent type) and never re-reads the `__cause__` chain, so a downgrade here is FINAL."

### IN-03: A guard in `AllocatorSyncStatus.test.tsx` cannot fail, because it targets wording that never shipped

**File:** `src/components/exchanges/AllocatorSyncStatus.test.tsx` — the `sign_in_failed` helper case, `expect(helper.textContent).not.toContain("credentials - the saved")`

**Issue:** This hyphen-minus guard was written for the intermediate wording "…the saved ones may have changed." A later commit replaced that wording before it shipped. The shipped text contains no "the saved", so the assertion is true whatever the dash is. The exact `toBe` pin beside it already catches a hyphen-minus substitution, so no coverage is lost, but the line is dead weight that reads as a guard.

**Fix:** Retarget it to the shipped text (`not.toContain("credentials - they")`), or delete it and rely on the exact pin.

### IN-04: The SFH-H2 fallback fires on any write failure, including one whose outcome is ambiguous, and the audit event does not say which status was written

**File:** `analytics-service/services/job_worker.py` — `run_poll_allocator_positions_job`, the single `except AllocatorHoldingsSyncTransientError` arm, `else:` branch of the write `try`

**Issue:** The fallback to `'error'` runs for every exception from the first write, not only a CHECK rejection. A transport error raised after PostgREST committed the `sign_in_failed` write would be followed by an `'error'` write that overwrites the committed status. The result is a red "Sync failed" pill instead of the amber sign-in pill, and the holdings shown as trusted. The `allocator.holdings.sync_failed` audit carries `error_kind` but not the status actually persisted, so the downgrade cannot be seen afterwards. The impact is narrow, because the copy stays truthful.

**Fix:** Restrict the fallback to a constraint rejection (match SQLSTATE `23514` or the constraint name `api_keys_sync_status_check` on the PostgREST error), and add `"sync_status_written": <final status>` to the audit metadata.

---

_Reviewed: 2026-09-22T20:50:22Z_
_Reviewer: Claude (gsd-code-reviewer), round 2_
_Depth: standard_
