---
phase: 225-oneaccountonce-a-user-cannot-connect-the-same-exchange-accou
reviewed: 2026-11-24T14:26:45Z
round: 3
round_2_reviewed: 2026-11-24T14:00:36Z
round_1_reviewed: 2026-11-24T12:42:05Z
depth: standard
# Round 3 scope: the third fixer diff 9ff8e21b9..HEAD (non-planning), at b46ed833a.
# Round 2 covered 15 files (629260a5c..HEAD); round 1 covered 27 files.
files_reviewed: 4
files_reviewed_list:
  - src/app/api/keys/validate-and-encrypt/route.test.ts
  - src/app/api/keys/validate-and-encrypt/route.ts
  - src/app/api/strategies/create-with-key/route.test.ts
  - src/app/api/strategies/create-with-key/route.ts
# Counts are OPEN after round 3: WR-06, WR-07, WR-08 and IN-12 (SF2-N1) are fixed.
# Open = IN-01, IN-03..IN-10, IN-13..IN-24 (IN-18..IN-24 new in round 3, all LOW/Info).
# Round 2 was critical 0, warning 3, info 15, total 18, necessity 0.
# Round 1 was critical 0, warning 5, info 11, total 16, necessity 1.
findings:
  critical: 0
  warning: 0
  info: 21
  total: 21
  necessity: 0
status: issues_found
---

# Phase 225: Code Review Report, PR-2

**Reviewed:** 2026-11-24T12:42:05Z
**Scope:** PR-2 (plans 05-09, 11, 12), `git diff 79fb73978..HEAD -- . ':!.planning'`, 27 files, no migrations
**Depth:** standard. Cross-file traces were done where a finding needed them: the SQL contract, the poll preflight, `parse_mt5_credentials` and the sync-request RPC.
**Files Reviewed:** 27
**Status:** issues_found

## Summary

Scope: the PR-2 change set, read against `225-CONTEXT.md` (Q1-Q5, D-18, D-23, D-25), plans and SUMMARYs 05-12, and the live SQL contract in `supabase/migrations/20261123180100_swap_account_slot.sql`. `$HOME/.claude/gsd-core/references/necessity-review.md` was read and applied.

There are no BLOCKER/critical findings and five MEDIUM warnings.

- **Two are user-facing.**
  - WR-01: the failing-holder admission inserts the new key with no identity, so the unique index no longer backstops it. A swap that fails or is refused still answers 200 and leaves a second live same-owner key (with its own draft) on one account. That is the 155.2 shape this phase exists to stop.
  - WR-02: the new post-validation resolve refuses the caller's OWN same-session draft. A resubmit during the up-to-120 s MT5 validation is told to "finish or delete" the draft it is creating.
- **WR-03 is latent and must be fixed before PR-3.** The connect route and the poll feed different strings into the "same" server normaliser. Python pre-strips Unicode whitespace in `parse_mt5_credentials`. The shared fixture pins the functions, not their inputs, so it is green over this drift.
- **WR-04 is non-user-facing.** The stamper and `swap_account_slot` read a user-triggered `syncing` status as working, so a key that last failed to sign in can take a slot from another failing key, and the slot can then move back and forth between them.
- **WR-05 (necessity).** Census 2 of gate A5 cannot return a row.

### Verified clean (cited, not assumed)

- **Owner-filtered reads.** Every same-login read filters by owner:
  - `readLiveSameLoginKeys` (`src/lib/venue-identity.ts`, `.eq("user_id", ...)`), used by all three TS call sites (`create-with-key` `resolveByVenueIdentity`, `validate-and-encrypt` :804, `rotate-secret` :570), always on a service-role client;
  - `_find_live_holder` (`analytics-service/services/account_identity.py`, `.eq("user_id", key_row["user_id"])`).
  - `swap_account_slot` re-checks same-owner on locked rows, and EXECUTE is revoked from anon and authenticated.
- **Refusals write nothing.** Every refusal arm in the post-validation resolve returns before `encryptKey`, the RPC and the swap. The `validate-and-encrypt` working-holder refusal returns before the insert.
- **Logs and Sentry.** No login or server reaches a log line:
  - Python logs key id, venue and the `ACCOUNT_SLOT_*` token only.
  - TS scrubs with `venueServer` added to every secrets array.
  - `captureToSentry` sends only name/code/message for a PostgREST error (`src/lib/sentry-capture.ts`), and the swap's DETAIL is static.
- **The cross-owner tests can fail.** The route mocks (`create-with-key`, `validate-and-encrypt`, `rotate-secret`) apply the `user_id` filter or return every row when it is absent, and the stamper's `_table_responder` applies eq/neq.
- **No gate was loosened.** The edits to `audit-coverage`, `wizardErrors.invariant`, `roster-render` and `wizardKeyRosters` only add the new code or RPC.
- **What was read in full and what was sampled.**
  - Read in full (diff): every non-test source file, both runbook files, the fixture, `test_venue_server_identity.py`, the per-owner block (ONCE-01/ONCE-02) of `create-with-key/route.test.ts`, the card-test diffs (`ApiKeyManager`, `account-share-note`) and the four small gate-test diffs.
  - Sampled (test names, mock harness and the cross-owner cases): `test_account_identity_stamper.py`, `validate-and-encrypt/route.test.ts`, `rotate-secret/route.test.ts`, the rest of `create-with-key/route.test.ts`, `ConnectKeyStep.test.tsx`, `wizardErrors.test.ts`, `venue-identity.test.ts`, `AllocatorExchangeManager.test.tsx`.
  - Not run: no test suite was executed for this review.
  - On the two vacuity flags in the SUMMARYs:
    - 225-07 deviation 4 (the race-arm `failing_holder` test was green on first run): 225-11's PROOF-01 record, neuter E, shows that removing the branch turns two cases RED.
    - 225-11 deviation 1 (nine tests passed vacuously until re-seeded): those tests are covered by neuters B, D and H.
    - Both are taken from the SUMMARY record and were not re-run here.
- **No double swap.** `db_execute` does not retry (`services/db.py`), so a committed swap is never re-sent.

## Warnings

### WR-01 (MEDIUM, data integrity, user-facing): the failing-holder admission bypasses the unique index, and a failed or refused swap leaves a second live same-owner key that answers 200

**File:** `src/app/api/strategies/create-with-key/route.ts:1598`, `:1805`, `:2073-2102`; `src/app/api/keys/validate-and-encrypt/route.ts:823`, `:851-852`, `:922-948`

**Issue:** On `failing_holder`, both routes insert the new key with `venue_account_id` and `venue_server` NULL, so `api_keys_user_exchange_venue_account_uniq` cannot refuse it. Only then do they call `swapAccountSlot`. If the swap does not land, the route logs at ERROR, sends to Sentry and answers success. Before this phase, the index gave a 409 here. The `swap_account_slot` refusals reachable on this path are:

- (a) **A concurrent admission.** Two tabs, or the wizard plus the Exchanges page, admit beside one failing holder. Both inserts succeed with no identity. The first swap wins and the second is refused `ACCOUNT_SLOT_IDENTITY_MISMATCH`, because the old holder's login is now NULL.
- (b) **A composite dependent.** `ACCOUNT_SLOT_COMPOSITE_DEPENDENT` is deterministic whenever the failing holder has a `composite_member` dependent: every such connect is admitted, then refused, then sent to Sentry.
- (c) **The holder recovered.** If the holder recovers between the post-validation read and the swap, the result is `ACCOUNT_SLOT_HOLDER_WORKING`. The new key now sits beside a WORKING holder, which is exactly what the refusal exists for.

**What the user is left with.** In every case the owner has two live keys on one account, and in the wizard a draft on the second one. The daily stamper then marks the new key `duplicate`, so the allocator derive counts the account once. The strategy side reads its own key, though, so the new draft can publish the same account's numbers under a second name. That is the 155.2 MM2/MM3 incident Q5 just deleted.

**The SUMMARYs claim the opposite.** 225-08 ("the unique index … remains the backstop") and 225-11 ("Edge notes: Concurrency (ONCE-01)") both say the index catches this. It does not on this path, because the admitted insert carries no identity. The route docblock's "the daily poll retries" does not hold either:

- in (a) and (c), the holder the poll then finds is WORKING, so `_settle_with_holder` marks the new key directly and never attempts a swap;
- only in (b) does the poll's own swap get refused the same way before it falls back to the marker.

No path ever turns the second key into a refusal.

Traced from the code and the SQL contract, not executed.

**Fix:** make insert and swap one transaction, so that a refused swap rolls back the insert and the route answers a named refusal. In the PR-3 migration lane:

- add `p_swap_from_holder uuid DEFAULT NULL` to `create_wizard_strategy`, which runs the `swap_account_slot` body after its INSERT in the same transaction;
- add a service-role twin for the allocator insert in `validate-and-encrypt`.

On a refusal token, the route then answers `keyVenueAlreadyConnectedResponse()` (or re-resolves and answers by kind).

**Interim, without a migration:**

- before admitting, read whether the holder has a `composite_member` dependent, and refuse with `KEY_VENUE_ALREADY_CONNECTED` instead of admitting, which removes the deterministic case (b);
- downgrade (b) from Sentry ERROR, because it is expected.

### WR-02 (MEDIUM, user-facing): the post-validation resolve refuses the caller's OWN same-session draft with VENUE_DRAFT_IN_PROGRESS

**File:** `src/app/api/strategies/create-with-key/route.ts:1589-1601` (with the session fence at `:1326-1356` and `resolveStrategiesForKey`'s draft read)

**Issue:** The session fence runs once, BEFORE validation. Its own comment says that two first-time submits can race past it and that `create_wizard_strategy`'s advisory-lock replay then dedups them. 225-11 put a venue resolve between validation and the RPC, and its `draft` arm does not compare the draft's `wizard_session_id` with the request's.

**How it happens.** Take a resubmit in the same session while the first request is still validating. MT5 validation can take up to 120 s. The trigger can be a reload and resubmit (`wizard_session_id` lives in localStorage and survives the reload), a second tab, or a double submit.

- The second request passes the session fence, because nothing is committed yet.
- By the time it finishes its own validation, the first request has committed its draft.
- The resolve then returns `draft`, and the user gets "This exchange account is already in one of your unfinished drafts … Finish that draft, or delete it", naming the draft they are creating right now.

Before 225-11 that request reached the RPC and got the replayed pair (`200 deduped`). D-23 explicitly carves out the same-session resume. The admission variant has the same root: request A has swapped, so request B's resolve sees A's working key with A's draft.

Traced from the code (session fence, post-validation resolve, `create_wizard_strategy`'s advisory-lock replay), not executed. The wizard sends the broker server and every field untrimmed and keeps `wizard_session_id` in localStorage (`ConnectKeyStep.tsx`, the submit body at :1145-1155).

**Fix:** carry `wizard_session_id` in the draft read inside `resolveStrategiesForKey`, so that `.select("id, name, wizard_session_id")` is still one query. When the post-validation resolve's `draft` belongs to the request's own `wizard_session_id`, return the same `{ ok, strategy_id, api_key_id, deduped: true }` body as the session fence. A simpler alternative is to re-run the session-fence read immediately before the post-validation resolve. Add a test that seeds a same-session draft for the post-validation read only.

### WR-03 (MEDIUM, latent until PR-3, then data integrity): TS and Python normalise different inputs, so the server rule drifts on Unicode whitespace

**File:** `src/app/api/strategies/create-with-key/route.ts:1419`, `src/app/api/keys/validate-and-encrypt/route.ts:786` (`normaliseVenueServer(passphrase)`, which trims only space, tab, CR and LF; `src/lib/venue-identity.ts:48`). Also `analytics-service/services/account_identity.py:717` (`_mt5_session_server(session)`) and `analytics-service/services/mt5_validation.py:187` (`server = (passphrase or "").strip()`, reached through `job_worker._make_mt5_session`).

**Issue:** The three normalisers agree, but their inputs do not. The connect routes normalise the raw passphrase. The poll normalises `Mt5Session.server`, which `parse_mt5_credentials` has already stripped with `str.strip()`. That strip removes NBSP, VT, FF, U+2028 and the like, which the TS and SQL forms deliberately keep. A server pasted with a trailing NBSP:

- validates at connect, because the Python seam strips it (both routes destructure `passphrase` raw from the JSON body, `validate-and-encrypt/route.ts:120`, and the wizard posts the input field untrimmed, `ConnectKeyStep.tsx:1152`);
- is stored by the route as `srv<NBSP>`;
- is read as `srv` by every poll.

**Consequences:**

- (i) For an unstamped key, the stamper's tier-1 match against a route-written server fails, so the two are treated as different accounts. While the login-only index is live, the index catches it. After PR-3's server-qualified index it does not, and two live same-owner keys can hold one broker account.
- (ii) The equal-identity share link (Q3) breaks between rows written by different writers.
- (iii) The shared fixture `venue_server_identity.json` pins only the functions, so both parity suites stay green over the drift.

The `venue-identity.ts` docblock's claim, "NORMAL FORM, agreed by three implementations", is true of the functions only.

**Fix:** derive the stored server from one parse.

- Either have the validate-key seam return the parsed server and store that, or make the TS routes apply the same edge strip as `parse_mt5_credentials` before `normaliseVenueServer`. Pick one rule and state it once.
- Add an end-to-end parity case: raw passphrase with trailing NBSP → route-stored value == poll-captured value.
- Land this before PR-3 opens. Gate A5 Census 1 cannot see it.

### WR-04 (MEDIUM, non-user-facing): a user-triggered `syncing` status reads as working, so a key that last failed can take a slot from another failing key

**File:** `analytics-service/services/account_identity.py:697` (`_settle_with_holder`), with the MT5 stamp running before the fetch (`services/job_worker.py`, the `identity_attempted = True` arm in the allocator poll). The SQL twin is the D-18 expression in `swap_account_slot`.

**Issue:** `request_allocator_holdings_sync` (`20261103120000`) sets `sync_status = 'syncing'` before it enqueues the poll. The preflight loads `key_row` with `select("*")`, so a key whose last real poll was `sign_in_failed` arrives as `syncing`, and D-18 counts that as working. The MT5 stamp runs BEFORE the fetch, so nothing in this poll has proven the key yet. `swap_account_slot` reads the same `syncing` on the locked row and does not refuse.

**Result:** with two failing keys on one account, each user "Sync now" on the demoted one swaps it in. The next sync on the other key swaps it back. Each flip:

- writes an `api_key.account_duplicate_detected` audit row;
- enqueues a recompose;
- moves the demoted-key sentence from one card to the other.

A WORKING holder is never displaced, because the SQL re-check refuses that, so the account count is unaffected. Traced from `20261103120000` (the `syncing` UPDATE), the preflight's `select("*")` and the poll's MT5 stamp ordering; not executed.

**Fix:** for the swap decision only, do not treat `syncing` as proof of working. For example, in `_settle_with_holder` require `key_row.get("sync_status") != "syncing"` before swapping and fall back to the marker otherwise, or run the MT5 swap after a DONE fetch. Leave the D-18 reader rule (and its tuple parity) unchanged, and add a stamper test with `sync_status='syncing'`.

### WR-05 (WARNING, necessity): impossible-state guard. Gate A5 Census 2 cannot return a row

**File:** `docs/runbooks/venue-server-backfill/census.sql:33-55`, `docs/runbooks/venue-server-backfill/README.md` ("What passes", row 2)
**Category:** necessity
**Issue:** Census 2 groups live, stamped keys by `(user_id, exchange, venue_account_id)` with `HAVING count(*) > 1`. That is exactly the key and predicate of the live unique index:

```sql
CREATE UNIQUE INDEX api_keys_user_exchange_venue_account_uniq ON api_keys (user_id, exchange, venue_account_id) WHERE venue_account_id IS NOT NULL AND disconnected_at IS NULL
```

The index is defined in `supabase/migrations/20260812083206_api_keys_venue_account_id.sql:465` and confirmed in `supabase/schema/baseline.sql`. The backfill writes only `venue_server`, so it cannot create such a pair either. The README admits "The login-only index guarantees it today". A gate listed as able to block PR-3 cannot fail, and it reads as evidence it is not.

**Fix:** drop Census 2, or replace it with a check PR-3 actually needs. One candidate: live same-owner, same-login pairs where one key is marked `duplicate` against the other and both servers are known and differ. That is the set the server index will let stamp separately. Do not count Census 2 as a pass.

## Info (LOW / Info, brief, not for TODOS.md)

### IN-01: The pre-validation `failingHolderId` assignment is dead
**File:** `src/app/api/strategies/create-with-key/route.ts:1445`. `failingHolderId` is always overwritten at `:1598` before its only readers (`:1805`, `:2073`), because `venueAccountId` is non-null for MT5 on both paths. Drop the assignment and keep the fall-through.

### IN-02: A same-session double submit beside a failing holder sends a spurious `holder-swap` Sentry ERROR
**File:** `create-with-key/route.ts:2073`. The RPC replays request A's pair to request B, so B calls `swapAccountSlot` on a key that already holds the account. The SQL refuses it ("new key already holds an account"), and B logs an ERROR. Harmless noise.

### IN-03: The interim tier-3 settle marks a holder on a DIFFERENT broker server as `duplicate`
**File:** `account_identity.py`, `_stamp`'s 23505 arm with `after_index_refusal=True`. Two different broker accounts that share a login number are counted once by the allocator derive until PR-3. The behaviour is unchanged from before the phase (it never had servers), but the TS routes refuse this case instead. Recorded as an interim divergence.

### IN-04: `KEY_VENUE_ALREADY_CONNECTED` does not name the holding key
**File:** `validate-and-encrypt/route.ts` (`keyVenueAlreadyConnectedResponse`) and the `held` arms in `create-with-key/route.ts`. ONCE-01's "named reason" is met by the code. CONTEXT "Decided autonomously [Refusal copy]" says "naming the existing key or draft by exchange plus nickname", and only the draft arm does that.

### IN-05: The named VENUE_DRAFT_IN_PROGRESS copy says the same thing twice
**File:** `src/lib/wizardErrors.ts` (`formatKeyError` arm). The lead "Your unfinished X draft "N" already uses this account." is followed by the cause "…an account that one of your own unfinished drafts already uses…".

### IN-06: Two Sentry captures leave `venueAccountId` out of their secrets
**File:** `create-with-key/route.ts` (`draft-rpc-error`, `unclassified-key-error`). The console twin includes it. The risk is low, because `captureToSentry` sends only name/code/message for a PostgREST error and never the DETAIL. Add it anyway for parity.

### IN-07: A ccxt swap is decided on the pre-poll `sync_status`
**File:** `account_identity.py:697`. A ccxt key that recovered in this poll is still read as failing, so it is marked now and swapped one poll later. A one-poll delay.

### IN-08: The failing-holder decision runs before the draft read
**File:** `create-with-key/route.ts` (`resolveByVenueIdentity`). A failing holder that carries the caller's own unfinished draft is swapped rather than refused by name (D-23), which leaves two drafts on one account. This follows Q1 ("whether or not it carries a strategy"). It is founder-visible, so it is recorded here.

### IN-09: Census 3 is a weak signal
**File:** `census.sql`, Census 3. It proves one MT5 key synced after the deploy, not that the backfill ran. `last_sync_at` advances on a completed poll, while the MT5 stamp runs before the fetch. Census 1 carries the real proof. The README already says this.

### IN-10: A `validate-and-encrypt` test asserts an outcome the live index makes impossible
**File:** `src/app/api/keys/validate-and-encrypt/route.test.ts:3045`, "an MT5 add beside a same-login owner key on a DIFFERENT server is inserted (the fence admits it)". The mock accepts the insert, while the live login-only index answers 23505 and then `KEY_VENUE_ALREADY_CONNECTED`. Label it as asserting the PR-3 behaviour so a reader does not take it for today's.

### IN-11: The fail-open fence log sentence becomes false once PR-3 ships
**File:** `create-with-key/route.ts` (`resolveByVenueIdentity`'s read-error arm: "DB index still dedups"), `validate-and-encrypt/route.ts:811` ("relying on the unique index") and `rotate-secret/route.ts:577` ("relying on the unique index"). On a dark same-login read, all three proceed. Once the server-qualified index ships, it no longer refuses a write beside a null-server holder, so after PR-3 a read fault silently admits a same-owner duplicate. The docblocks beside these lines already say this read is what refuses that case. Decide fail-open versus fail-closed in PR-3, and correct the log text then.

---

_Reviewed: 2026-11-24T12:42:05Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

## Silent-failure hunter (PR-2 round 1, 2026-11-24): MEDIUM findings merged in by the orchestrator

- **SF-M1 (MEDIUM, data-integrity once PR-3 ships): holder-read errors fail open.** In `validate-and-encrypt/route.ts` (the holderReadError branch) and `rotate-secret/route.ts`, a failed same-login read logs to console only and continues "relying on the unique index". Once PR-3's server-aware index ships, a null-server holder no longer collides, so a transient read error lets a second live holder in. This is the same finding as IN-11.
- **SF-M2 (MEDIUM): every ACCOUNT_SLOT_ refusal is absorbed at WARNING.** In `account_identity.py`, NOT_FOUND, NOT_SAME_OWNER and IDENTITY_MISMATCH mean the caller built a wrong request, and should log at ERROR. HOLDER_WORKING, NEW_KEY_NOT_WORKING, COMPOSITE_DEPENDENT and NOT_LIVE stay at WARNING.
- **SF-M3 (MEDIUM, user-facing): after a failed swap the user is told "connected".** This is the same path as WR-01.

### Orchestrator decisions (2026-11-24)

1. **WR-01 + SF-M3: compensating rollback, code-only.** PR-2 stays migration-free.
   - When the swap after a failing-holder admission is refused, the route deletes the key it just inserted in the same request. For create-with-key it also deletes the draft it just created.
   - It then answers `409 KEY_VENUE_ALREADY_CONNECTED`, the same builder as the held arm. It does not answer 200.
   - The compensating delete is logged with codes only.
   - If the compensating delete itself fails, that is a Sentry ERROR, and the response is still 409.
     ⛔ **SUPERSEDED 2026-11-24 (round-3 decision 2, IN-19, Rule 7; coordinator confirmed).** "Still 409" now holds only for an `ACCOUNT_SLOT_*` token refusal. A transient swap fault whose compensating delete also fails answers 503 `UNKNOWN`. The original sentence is kept as lineage.
   - Deleting a row created by the same failed request is allowed. The "keep data" rule protects the user's existing data, not a half-done write from that request.
   - An atomic SQL version (`p_swap_from_holder`) is NOT built now.
2. **SF-M1 / IN-11: fail closed.** A failed same-login read in validate-and-encrypt and rotate-secret answers a retryable 503-class error before any write, captured to Sentry, instead of continuing. create-with-key's equivalent fence read gets the same treatment.
3. **WR-02: answer the session fence's deduped body.** The post-validation draft read also selects `wizard_session_id`. When it equals the request's session, the route answers the same body as the existing session fence.
4. **WR-03: both runtimes normalise from the same parse.** TS strips the raw server the same way Python's validator does (`str.strip()` semantics) before `normaliseVenueServer`. An end-to-end parity case with an NBSP-padded server is added to the shared fixture and both suites.
5. **SF-M2 and WR-04 (Python):**
   - The three contract tokens log at ERROR.
   - `sync_status='syncing'` is not treated as working for the swap decision only.
6. **WR-05: drop Census 2** from `docs/runbooks/venue-server-backfill/census.sql` and its README pass table, because it cannot return a row.

## Round 2 (2026-11-24)

**Reviewed:** 2026-11-24T14:00:36Z, at HEAD `269ac4ff8` (branch `gsd/phase-225-oneaccountonce`)
**Scope:** the fixer round, `git diff 629260a5c..HEAD -- . ':!.planning'`: 8 commits and 15 files. Each file was read in full around every hunk.
**Depth:** standard, with cross-file traces where a finding needed them: the `swap_account_slot` SQL, the `create_wizard_strategy` replay, the FKs and triggers on `api_keys` and `strategies` in `supabase/schema/baseline.sql`, the `syncing` writers, the wizard copy table and how the wizard maps codes.
**Tests:** run this round, at HEAD. 6 vitest files passed with 581 tests: the three route suites, `venue-identity`, `wizardErrors.invariant` and `audit-coverage`. 2 pytest files passed with 231 tests: `test_account_identity_stamper.py` and `test_venue_server_identity.py`. No neuter was run. "Can fail" below is judged by reading each assertion against what the fix would do without it.
**Necessity:** not reassessed this round. `necessity-review.md` was not re-read. WR-05, the only necessity finding, is resolved.
**Frontmatter:** the counts now show what is still OPEN after round 2. The round-1 figures are kept in this section.

### Status of the round-1 findings and the binding decisions

| Finding | Status | Evidence at HEAD |
|---|---|---|
| WR-01 + SF-M3 | **FIXED.** The residuals are WR-06, IN-12 and IN-13 below | `create-with-key/route.ts:2155-2233`, `validate-and-encrypt/route.ts:952-1011`. A swap that fails or is refused deletes this request's key, scoped by `id`, `user_id` and `venue_account_id IS NULL`. In create-with-key it then deletes the draft, scoped by `id`, `user_id`, `source='wizard'` and `status='draft'`. It answers `keyVenueAlreadyConnectedResponse()` (409), and 200 is no longer reachable on this path. A rollback delete that itself fails is logged with its code only and captured with the step `holder-swap-rollback`. |
| WR-02 | **FIXED** | `create-with-key/route.ts:1649-1668`. The draft read selects `wizard_session_id` in the same query (`:475`). A same-session draft answers `{ok, strategy_id, api_key_id, deduped: true}` with `NO_STORE_HEADERS` and status 200. That is the session fence at `:1394-1407` byte for byte: same key order, headers and status, and the same values, because the draft's `api_key_id` is the live key (`:503`). The test has a positive case and a negative control (`route.test.ts`, the block `[WR-02]`), and it goes RED without the fix. |
| WR-03 | **FIXED** | `src/lib/venue-identity.ts:51-83`. `PYTHON_EDGE_WHITESPACE` matches Python's `isspace()` set: 9-13, 0x1C-0x20, 0x85, 0xA0, 0x1680, 0x2000-0x200A, 0x2028, 0x2029, 0x202F, 0x205F and 0x3000, which is 29 code points. Both connect routes call `normaliseConnectedVenueServer` (`create-with-key/route.ts:1467`, `validate-and-encrypt/route.ts:786`). The fixture's `connect` cases go through the REAL `parse_mt5_credentials` and then `_mt5_session_server` in Python, and through the new function in TS. The U+0085 and U+FEFF cases tell this strip apart from JS `trim()`. Both route suites carry an NBSP case. No other TS writer stores a server: `swapAccountSlot` re-normalises an already-normal value. |
| WR-04 | **FIXED** | `account_identity.py:713-716`. A `syncing` key is not counted as proven working for the swap decision, and the D-18 reader rule is unchanged. Checked for a regression: the only writer of `syncing` is `request_allocator_holdings_sync` (`20261103120000:148`, `baseline.sql:9629`). The scheduled `enqueue_poll_allocator_positions_for_all_keys` does not write it, so the daily poll still swaps. The new test goes RED without the fix. |
| WR-05 | **FIXED** | Census 2 has been dropped. The old Census 3 is renumbered to 2, the README token step and pass table follow it, and no other source file cites the old numbering. |
| SF-M1 / IN-11 | **FIXED for the same-login `api_keys` read in all three routes; PARTIAL in create-with-key, see WR-07** | `rotate-secret/route.ts:577-594`, `validate-and-encrypt/route.ts:811-833`, `create-with-key/route.ts:303-326` (the `read_failed` kind), `:1486` and `:1648`. Each answers 503 before any write and captures with the step `holder-read`. `readLiveSameLoginKeys` returns an error only for a PostgREST error or a throw (`venue-identity.ts`, `readLiveSameLoginKeys`). An EMPTY read returns `rows: []` with `error: null` and proceeds, so a legitimate connect is never blocked by an empty answer. In the race arm (`:1921`), `read_failed` falls through like `unresolved` did, as its comment says. |
| SF-M2 | **FIXED.** LOW residual IN-14 | `account_identity.py:607-611`, `:728-733`. NOT_FOUND, NOT_SAME_OWNER and IDENTITY_MISMATCH log at ERROR, and the others stay at WARNING. Pinned both ways by the stamper tests. |
| IN-01, IN-03 to IN-10 | Not in the decision set, unchanged, still LOW | — |
| IN-02 | **SUPERSEDED by IN-12.** The same race now answers the user a 409 instead of only logging a spurious ERROR | — |

### Regressions checked, with answers

- **Can the rollback delete a row it did not create?**
  - In validate-and-encrypt it cannot. The delete targets `inserted.id` only, which comes from this request's own INSERT.
  - In create-with-key it can only in one shape. `row.api_key_id` can be a pair that `create_wizard_strategy` replayed (`20261123180000`, the select-existing fence). The `venue_account_id IS NULL` scope limits the delete to a key minted on a failing-holder admission whose swap has not landed.
  - The one foreign row that matches is a concurrent same-session request's key, still in flight. That happens only when this request's swap fails, and the other request's swap uses the same arguments. Its swap then gets NOT_FOUND, its own delete removes nothing, and it also answers 409. The end state holds: nothing is left and the holder is untouched.
  - PR-2 has not shipped, so no pre-fix leftover exists: no key admitted under the old answer-200 code whose swap failed.
  - Verdict: no real data the user had is deleted. The cost of the zero-row arm is IN-12.
- **Draft delete cascade.** Safe for a draft this request just created.
  - No DELETE trigger exists on `strategies`. Every FK that references `strategies` is CASCADE or SET NULL except `allocation_events_strategy_id_fkey` (NO ACTION), and a fresh draft has no allocation events.
  - Deleting the key first fires `strategies_api_key_id_fkey ON DELETE SET NULL`, which is an UPDATE. `guard_wizard_draft_updates` lets it through, because source and status are unchanged.
  - `api_keys_published_composite_delete_guard` cannot match a fresh key.
  - The ordering leaves an orphan only when the second delete fails, which is IN-13.
- **Does 503 UNKNOWN mislead?** Mildly, and the remedy it gives is right. See IN-15.
- **Does a fail-closed read block a legitimate connect when the read is merely empty?** No, as described above.
- **Is the WR-02 body byte-equal to the session fence?** Yes, as described above.
- **Tests that cannot fail.** The create-with-key rollback mock cannot catch two regressions that matter to data integrity. See WR-08.

### Warnings (new in round 2)

#### WR-06 (MEDIUM, user-facing): the rollback answers a 409 whose copy says the existing key "keeps working" and steers the user away from the fix, while on this path the holder is failing

**File:** `src/app/api/strategies/create-with-key/route.ts:2232`, `src/app/api/keys/validate-and-encrypt/route.ts:1011`, and the copy at `src/lib/wizardErrors.ts:2928-2936` (`KEY_VENUE_ALREADY_CONNECTED`)

**Issue:** This follows from binding decision 1, which says "the same builder as the held arm". That builder's wizard copy assumes a WORKING holder:

- "another of your connected keys already reads [this account]";
- "Use the key you already have";
- "send the correlation id … before disconnecting anything — the existing key keeps working until you do."

The rollback path is only reached beside a holder that was FAILING at the post-validation read. Of the three refusal causes from round 1:

- (a) **A concurrent admission** (IDENTITY_MISMATCH): the holder is still failing, so the copy is false.
- (b) **A composite dependent** (COMPOSITE_DEPENDENT): the holder is failing, so the copy is false. This cause is deterministic, so the affected user meets it on every attempt. Each attempt costs a validation of up to 120 s plus an encrypt, and sends a Sentry ERROR (`holder-swap`).
- (c) **The holder recovered** (HOLDER_WORKING): the copy is true.

A transient swap error goes down the same arm and gets the same copy. Examples are the function-level `lock_timeout` of 3 s (55P03) and a network fault. There, a plain retry would succeed.

The real remedy for (a) and (b) is to disconnect the failing key and connect again. The copy tells the user to keep the failing key and not to disconnect anything. The reach is small: a rare population for (b), a narrow race for (a). Recorded for the orchestrator to decide, because the builder was chosen in the decision.

**Fix (pick one, smallest first):**
1. Branch on the refusal before answering. Read the `ACCOUNT_SLOT_*` token from `swap.error.message`, with the same regex as `_SLOT_REFUSAL` in `account_identity.py`.
   - `HOLDER_WORKING` keeps `keyVenueAlreadyConnectedResponse()`.
   - An error that is not `ACCOUNT_SLOT_*` answers the retryable `holderReadFailedResponse()`-style 503. The rollback has run, so nothing is left behind.
   - `COMPOSITE_DEPENDENT` and `IDENTITY_MISMATCH` get a copy that names a failing key: either a new roster code, or a variant of the existing entry that drops "keeps working".
2. If no new code is wanted, add the round-1 interim at least. Before admitting, refuse when the holder has a `composite_member` dependent, and downgrade the expected (b) capture from ERROR. This removes the deterministic case, but the copy stays false for (a).

#### WR-07 (MEDIUM, latent until PR-3, then data integrity): in create-with-key, a strategies or `strategy_keys` read fault AFTER a working holder was picked still fails OPEN

**File:** `src/app/api/strategies/create-with-key/route.ts:351-361` (the tail of `resolveByVenueIdentity`), with `resolveStrategiesForKey` `:490-496` and `:544-550`, `resolveOtherKeyUse` `:405-412`, and the post-validation fall-through `:1679`. The test that pins it is `route.test.ts:1988` ("the SECOND read faulting degrades the same way … still submits").

**Issue:** Decision 2 says "create-with-key's equivalent fence read gets the same treatment". The fix gave the `api_keys` read the `read_failed` kind. But once that read has SUCCEEDED and `pickSameAccountHolder` has picked a WORKING holder, the code resolves what uses that holder: the draft read, the owner read and the `strategy_keys` read. A fault in any of them still returns `UNRESOLVED`.

At the post-validation fence, `unresolved` goes to the normal RPC with `p_venue_account_id` and `p_venue_server` attached (`failingHolderId` is null). Today the login-only index refuses that INSERT, so the effect is invisible.

After PR-3's server-aware index, a picked holder on tier 2 (holder server NULL, or the new key's server NULL) no longer collides. A strategies read that blips on RLS or PostgREST then admits a second live same-owner key on a WORKING holder's account. That is exactly the SF-M1 failure, one read later.

The pre-validation fence has the same shape, but the post-validation fence re-reads, so the post-validation arm is the one that matters.

**Fix:** in the tail of `resolveByVenueIdentity`, the holder is already known to be working. The fence then refuses on every use except the caller's own-session draft. So when `byStrategy.kind === "unresolved"`, or `resolveOtherKeyUse` answers `unresolved`, return `{ kind: "read_failed" }` instead of `UNRESOLVED`. The callers' existing `read_failed` arms then answer 503 before any write.

`handleReuseExistingKey` calls `resolveStrategiesForKey` directly and is unaffected. The race arm treats `read_failed` like `unresolved`.

Invert the test at `route.test.ts:1988` to expect 503 with no RPC, and add a post-validation twin.

#### WR-08 (MEDIUM, test reliability of a data-integrity fix): the create-with-key rollback mock cannot fail on the two filters that make the rollback replay-safe

**File:** `src/app/api/strategies/create-with-key/route.test.ts:360-386`, which is the `delete` chain in `makeWriteVerbs`. Also `src/app/api/keys/validate-and-encrypt/route.test.ts`, the `delete` builder in the persist harness.

**Issue:** The rollback's safety rests on two calls: `.is("venue_account_id", null)` and `.select("id")`.

- **`.eq` and `.is` are recorded the same way.** In the create-with-key mock, both write `filters[col] = val`. A regression to `.eq("venue_account_id", null)` stays green. In PostgREST that becomes `venue_account_id=eq.null`, which matches no row, so the rollback would silently delete nothing and leave the second live key: WR-01 back again, with every test green.
- **`.select()` is a no-op.** The mock resolves `data: [{id}]` whether or not `select` was called. Drop `.select("id")` and the real `delete()` returns `data: null`. The route then reads that as "removed no key" (`:2203-2207`) and skips the draft delete, even though the key was deleted. The result is an orphan draft (`api_key_id` NULL), which wedges the session as IN-13 describes, while the test stays green.

The validate-and-encrypt mock records `.is` apart from `.eq` (`"venue_account_id:is"`), but its `select` is a no-op too. There, a dropped `select` changes only a log line.

**Fix:**
- In the create-with-key mock, record `is` under a distinct key, as the validate-and-encrypt mock does (`filters[\`${col}:is\`] = val`), and update the expected filters.
- In both mocks, return `data: null` unless `select` was called. Then the happy-path rollback test (key and draft both deleted) goes RED when `.select("id")` is dropped.
- Neuter each filter once and confirm RED, per the repo's rule that data-integrity gates must be able to fail.

### LOW and Info (new in round 2, brief, not for TODOS.md)

- **IN-12 (LOW, user-facing, narrow):** the zero-row arm answers 409 "Your new key was not saved" when the key IS saved and holds the slot. The arm is at `create-with-key/route.ts:2203-2207` and then `:2232`, with the same shape in `validate-and-encrypt/route.ts:999-1011`. Zero rows deleted means the key is already stamped, so a swap landed on it. The cause is either a same-session replay that raced (`swap_account_slot` refuses the second swap with IDENTITY_MISMATCH, "The new key already holds an account of its own", SQL `:227-229`) or a swap that committed and then lost its answer. In create-with-key, the honest answer there is the deduped body of the session fence, which is decision 3's own rule. A retry heals it, because the session fence then dedups. This replaces IN-02.
- **IN-13 (LOW):** the key is deleted first, so a draft delete that then fails leaves an orphan draft with `api_key_id` NULL. Every retry in that session then misses the session fence (`:1394` needs `api_key_id`), and `create_wizard_strategy` skips an orphan in its replay (`20261123180000`, "Only replay a COMPLETE draft"). The result is `DRAFT_ALREADY_EXISTS` until the session changes. Sentry pages it (`holder-swap-rollback`). The wedge can be recovered from, and it needs a second fault.
- **IN-14 (LOW):** IDENTITY_MISMATCH is not purely a contract refusal. The SQL also raises it for a race: "The old holder does not hold the account the caller named" (SQL `:208-210`) when a concurrent TS connect has already swapped. That rare race now pages at ERROR, and the comment at `account_identity.py:603-606` ("which no later poll repairs") overstates it. `ACCOUNT_SLOT_NOT_LIVE` has no WARNING pin in the parametrised test at `test_account_identity_stamper.py:2510-2516`.
- **IN-15 (LOW):** the wizard (`ConnectKeyStep.tsx`, which maps by `code`; H-0305) and `UpdateMt5SecretDialog.tsx` (`recogniseDashboardDialogCode`) both drop the 503 body's sentence. They render the generic `UNKNOWN` entry (`wizardErrors.ts:4598-4608`): "we cannot tell you … whether your last action took effect". The server does know: nothing was written. The remedy, "Try the last action again", is correct, so this is imprecise rather than harmful.
- **IN-16 (LOW, decision-bound):** `rotate-secret/route.ts:577-594` now refuses a password correction on a holder-read fault. Saving the password without the login backfill (`shouldBackfillVenueAccountId = false`) writes no identity, so it cannot admit a duplicate, and would be the narrower fail-closed. Decision 2 named this route, so this is recorded only.
- **IN-17 (Info):** the WR-02 comparison (`:1657`) compares strings, while the session fence compares `uuid` values in the database. An upper-case `wizard_session_id` from a client would pass the fence's equality and fail this one, and fall back to the named refusal. `isUuid` was not checked for case. The wizard's own generator was not traced this round.

### Round 2 summary

All the round-1 MEDIUMs are fixed as the orchestrator decided. Not one fix is merely cosmetic, and every new test goes RED without its fix, except where WR-08 says otherwise. Three new MEDIUMs remain:

- **WR-06**, user-facing, low reach. It follows from the builder that decision 1 chose.
- **WR-07**, latent until PR-3. SF-M1's fail-closed stops one read short.
- **WR-08**, test reliability. The rollback mock cannot fail on its two load-bearing filters.

There is no BLOCKER and no critical finding. Under the repo's review rule, only WR-06 is user-facing.

_Round 2 reviewed: 2026-11-24T14:00:36Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

## Silent-failure hunter round 2 + orchestrator decisions for round 3 (2026-11-24)

The silent-failure hunter closed SF-M1, SF-M2 and SF-M3 in round 2. It raised one new finding:

- **SF2-N1 (MEDIUM, user-facing; the same case as IN-12).** On the rollback path, a delete that removes zero rows answers 409 "not saved" and logs only at WARNING. That is wrong when the key is in fact live and has taken the slot, because the swap landed but its answer was lost.

Round-3 decisions. The fixer implements exactly these.

1. **SF2-N1 / IN-12: re-read before answering.**
   - When the compensating delete removes zero rows, re-read the key's `venue_account_id`.
   - If it is stamped, the swap landed. Answer the success body: create-with-key uses its normal success or deduped body, and validate-and-encrypt uses its normal success body.
   - Otherwise answer 409 as now.
   - Capture the zero-row case to Sentry with its own step tag, `holder-swap-rollback-noop`.
2. **WR-06: split swap failures by kind.**
   - A swap failure that carries no `ACCOUNT_SLOT_` token is transient: lock timeout, network or similar. Roll back (the delete is already guarded `IS NULL`, so it is safe), then answer the retryable `503 UNKNOWN`, not 409.
   - Token refusals keep `409 KEY_VENUE_ALREADY_CONNECTED`.
   - Add a pre-admission check: when the failing holder has a `composite_member` dependent, refuse with `409 KEY_VENUE_ALREADY_CONNECTED` before validation and insert. The swap would always refuse that case anyway.
   - Change no copy.
3. **WR-07: return `read_failed`.** In create-with-key `resolveByVenueIdentity`, a failed `strategies` or `strategy_keys` read after a holder has been picked returns `read_failed`, so the route answers 503. Invert the test that pins the old fall-through.
4. **WR-08: make the route-test mocks able to fail.**
   - The mocks must tell `.is(col, null)` apart from `.eq(col, null)`.
   - A delete must return rows only when `.select(...)` was called.
   - Prove it: neuter `.is` to `.eq` and the WR-01 rollback test goes RED; drop `.select("id")` and the orphan-draft test goes RED.

The remaining items stay recorded and are not fixed, as LOW/Info: IN-13 to IN-17, and the WR-04 syncing log line.

## Round 3 (2026-11-24)

**Reviewed:** 2026-11-24T14:26:45Z, at HEAD `b46ed833a` (branch `gsd/phase-225-oneaccountonce`)
**Scope:** the third fixer round, `git diff 9ff8e21b9..HEAD -- . ':!.planning'`: 4 commits plus a merge, 4 files (the two routes and their two test suites). Each file was read in full around every hunk. The callees were read too: `swapAccountSlot` (`src/lib/venue-identity.ts`), the `swap_account_slot` SQL body (`20261123180100`), the `api_keys` share-marker trigger and CHECK in `baseline.sql`, and the race arm.
**Depth:** standard, with cross-file traces where a finding needed them.
**Tests:** all run at HEAD.
- The two route suites passed, 357 tests.
- Round 2's other four suites passed, 238 tests: `venue-identity`, `wizardErrors.invariant`, `audit-coverage` and `rotate-secret`. The two source-scanning gates are still green over the new route text.
**Neuters:** 17, run in a throwaway worktree (since removed), each restored from a byte backup. Every one went RED:
- create-with-key:
  - `.is` changed to `.eq` on the rollback delete;
  - `.select("id")` dropped;
  - `swapLanded` never set;
  - the split always answers 409;
  - the split never matches a token;
  - the composite refusal removed;
  - the pre-validation `held` return removed;
  - each of the two WR-07 `read_failed` conversions removed;
  - the `holder-swap-rollback-noop` tag renamed;
  - the re-read's `id` filter dropped.
- validate-and-encrypt: `.is` changed to `.eq`, `.select` dropped, `swapLanded` never set, always 409, never a token, and the composite refusal removed.

The round-3 tests can fail.
**Necessity:** `necessity-review.md` was read this round. No round-3 change guards an impossible state. The composite read's `user_id` filter repeats `enforce_api_keys_account_share_same_owner`, but it is defense in depth, which the rubric excludes.

### Status of the round-3 decisions and the open round-2 findings

| Finding | Status | Evidence at HEAD |
|---|---|---|
| SF2-N1 / IN-12 | **FIXED** in both routes | `create-with-key/route.ts:2252-2279`, `validate-and-encrypt/route.ts:1049-1083`. When the delete removes zero rows, the route captures `holder-swap-rollback-noop`, then re-reads `venue_account_id` for this key and this owner. Stamped → `swapLanded`, and the request falls through to the normal success (`{ok, strategy_id, api_key_id}` and `{api_key_id, valid, read_only}` respectively). Not stamped, or the re-read fails → the 409/503 split. The fall-through is checked below. The residual is IN-18. |
| WR-06 | **FIXED as decided** | Split: `create-with-key/route.ts:2311-2318`, `validate-and-encrypt/route.ts:1097-1104`. A message carrying an `ACCOUNT_SLOT_` token answers 409, and anything else answers `holderReadFailedResponse()` (503 UNKNOWN) after the same rollback. Pre-admission: `create-with-key/route.ts:343-362` sits inside `resolveByVenueIdentity`, so the pre-validation fence refuses before `validateKey` (`:1573-1575`), and the post-validation fence and the race arm get it too. `validate-and-encrypt/route.ts:860-887` refuses before the insert. The predicate matches the SQL (`swap_account_slot` step 3: `account_shared_with_api_key_id = p_old_holder AND account_share_kind = 'composite_member'`). The extra `user_id` filter is equivalent, because the marker trigger refuses a cross-owner holder. A read fault fails closed with 503 (`holder-read`). No copy changed. The residual copy issue is recorded as IN-23 and was accepted by the decision. |
| WR-07 | **FIXED** | `create-with-key/route.ts:394-397`. Once a WORKING holder is picked, an `unresolved` from `resolveStrategiesForKey` (draft or owner read) or from `resolveOtherKeyUse` (`strategy_keys`) becomes `read_failed`, and both fences answer 503 before any write. The race arm has no `read_failed` branch, so it falls through to the `DRAFT_ALREADY_EXISTS` 409 exactly as `unresolved` did (`:2060-2066`). `handleReuseExistingKey` calls `resolveStrategiesForKey` directly and is unaffected. The pinning test at the old `:1988` is inverted, and a post-validation twin and a `strategy_keys` twin were added. |
| WR-08 | **FIXED** | Both mocks now resolve delete rows only after `.select(...)`, and the create-with-key mock records `.is` under `${col}:is`. Proven by neuter: `.is`→`.eq` turns the WR-01 rollback test RED in both routes. Dropping `.select("id")` turns 3 create-with-key tests RED (the draft delete is skipped) and 2 validate-and-encrypt tests RED (an extra `holder-swap-rollback-noop` capture). |
| IN-01, IN-03 to IN-10, IN-13, IN-14, IN-16, IN-17 | Unchanged, still LOW/Info | IN-01's dead assignment is now at `create-with-key/route.ts:1530`. |
| IN-15 | Unchanged, and it now also covers the transient-swap 503 | The wizard renders the generic `UNKNOWN` entry for the new 503 as well. The remedy, "try again", is correct there. |

### Regressions checked, with answers

- **Can the early pre-validation `held` return refuse a connect that was legitimate before?** No. `held` comes from two places.
  - **(a) A failing holder with a composite dependent.** Before round 3 this was admitted, then the swap refused it (`COMPOSITE_DEPENDENT`, deterministic), then the route rolled back and answered the same 409.
  - **(b) A working holder used only through `strategy_keys`.** The post-validation fence already refused this since 225-11 (`:1718-1720`). Before PR-2 the login-only index refused it and the race arm answered the same 409.
  - So the final answer is unchanged in both shapes. Two things differ:
    - Validation no longer runs first. A user with wrong credentials now hears "already connected" before the credential error, which is Phase 212 SC5's accepted trade for `orphaned` (IN-23).
    - A state change during the up-to-120 s validation can no longer rescue the connect: a composite unlinked in that window. That is negligible.
- **The IN-12 fall-through into the success flow.** It is correct in both shapes that reach it.
  - **Same-session replay race.** Request A's swap stamped the replayed key. B's swap is refused (`IDENTITY_MISMATCH`, "new key already holds an account"), B's delete removes zero rows (it waits on A's `FOR UPDATE` lock, then re-evaluates `IS NULL` as false), the re-read finds the key stamped, and B answers success with A's pair.
  - **A swap that committed and lost its answer.** The success body is honest.
  - **Why a stamped key cannot be a second holder.** Two live stamped same-login keys are impossible under the login-only index. So a stamped key means this key holds the account, and the old holder was demoted or departed.
  - **The asset-class update on the replayed draft** is idempotent.
  - **Not covered.** The success path does NOT replay `swapAccountSlot`'s post-RPC tail: the audit row and the recompose (IN-18).
- **The token regex.** `/ACCOUNT_SLOT_[A-Z_]+/` is case-sensitive.
  - The function name in a PostgREST error (`swap_account_slot`, PGRST202, a permission error) is lower-case and does not match.
  - Every refusal in the SQL raises one of 7 upper-case tokens as the whole message.
  - A lock timeout (55P03), a statement timeout, a deadlock or a fetch throw carries no token, so it answers 503.
  - It is unanchored (`.test`), while Python's `_SLOT_REFUSAL.match` is anchored at the start of the message. Harmless today (IN-22).
- **Tests that cannot fail.** None found among the round-3 tests: all 17 neuters above went RED. The create-with-key `refusedSwap` fixture uses a token the SQL never raises (IN-22).
- **Other callers of the swap.** `swapAccountSlot(` has exactly two callers, the two routes reviewed here. `rotate-secret` does not swap.

### LOW and Info (new in round 3, brief, not for TODOS.md)

- **IN-18 (LOW, pre-existing, not introduced by round 3): a swap that committed and lost its answer now answers 200, but the demotion audit row and the recompose never run.**
  - **File:** `create-with-key/route.ts:2278`, `validate-and-encrypt/route.ts:1082`, with `src/lib/venue-identity.ts:204-236`.
  - **Why.** `swapAccountSlot` writes `api_key.account_duplicate_detected` and enqueues `derive_allocator_equity` only after a clean RPC answer.
  - **The heal.** For MT5, `run_derive_broker_dailies_job` enqueues a compose (`analytics-service/services/job_worker.py:5233`, `:10197`). For ccxt the heal is unverified, and `swapAccountSlot`'s own comment says "nothing else enqueues a compose for it". The audit row is never written.
  - **Reach.** A double rarity: the RPC committed and the client still saw an error. Before round 3 the same path answered 409 and also skipped both.
  - **Fix, if wanted.** On `swapLanded`, re-run the audit and the enqueue. The replay-race shape then audits twice, because request A already did, so prefer the enqueue alone. It is deduped while a job for that allocator is in flight (allocator-scoped in-flight dedup).
- **IN-19 (LOW): a transient swap failure whose compensating key delete ALSO fails answers 503 "try again" while the unstamped key, and in create-with-key the draft, is still live.**
  - **File:** `create-with-key/route.ts:2244-2252` then `:2311-2318`, `validate-and-encrypt/route.ts:1035-1048` then `:1097-1104`.
  - **Conflicting decisions (Rule 7).** Round-2 decision 1 says "if the compensating delete itself fails … the response is still 409". Round-3 decision 2 sends a token-less failure to 503 with no carve-out for this case. The code follows round 3. A token refusal plus a failed delete still answers 409 and is tested; this combination is not tested.
  - **What follows.** In create-with-key, the retry hits the session fence and gets `deduped` 200 on the leftover pair. In both routes, the next allocator poll's stamper (`_settle_with_holder`) swaps the working unstamped key into the failing holder's slot, unless a composite dependent appeared in between. So it heals.
  - **Reach.** A network fault can fail both calls at once, so the faults are correlated.
  - **Fix, if wanted.** Make the decisions agree: either answer 409 whenever `keyDeleteErr` is set, or record that 503 is right here. Add the missing test.
- **IN-20 (Info): extra Sentry noise.** The zero-row arm now sends two events: `holder-swap` at ERROR, logged as "rolling back", then `holder-swap-rollback-noop`. This includes the benign replay race and a landed swap that answers 200. Decision 1 required the noop capture, so this is recorded only.
- **IN-21 (Info): stale docblocks in `create-with-key/route.ts`.**
  - `:156-160` says every read fault answers `unresolved` and "a dark fence costs correctness nothing".
  - `:201-202`, the `unresolved` bullet, still lists "a strategy-read fault … Fall through".
  - `:204-208`, the `read_failed` bullet, names only the same-login `api_keys` read. It now also covers the composite-dependent, strategies and `strategy_keys` reads past a picked holder.
  - `:1611-1612` still says "`held` keeps the latency … out of scope here", which the new `:1573` return contradicts.
- **IN-22 (Info): token match and fixture.**
  - TS `.test` is unanchored, while Python's `_SLOT_REFUSAL.match` (`account_identity.py:601`, `:624`) is anchored. The comments at `:2305` and `:1092` call it "the same token".
  - create-with-key's `refusedSwap` (`route.test.ts:3507`) raises `ACCOUNT_SLOT_REFUSED`, which the SQL never raises. So no create-with-key test pins a real token (for example `COMPOSITE_DEPENDENT` or `IDENTITY_MISMATCH`) to the 409, and an allow-list narrowing of the regex would turn these tests RED for the wrong reason. validate-and-encrypt uses the real `ACCOUNT_SLOT_HOLDER_WORKING`.
  - The validate-and-encrypt mock routes every admin `maybeSingle` without `account_share_kind` to the stamp re-read. A future admin `maybeSingle` read would be answered with stamp data without anyone noticing.
- **IN-23 (LOW, decision-bound): the composite-dependent refusal answers `KEY_VENUE_ALREADY_CONNECTED`, whose copy says the existing key "keeps working".**
  - **File:** `create-with-key/route.ts:362` → `:1573-1575`, `validate-and-encrypt/route.ts:886`.
  - **What is wrong.** On this path the holder is failing, so WR-06's copy complaint holds for this cause and for the `IDENTITY_MISMATCH` race. The refusal also now comes before validation, so wrong credentials are not reported first.
  - **Why it stays.** Decision 2 said "Change no copy", so this is recorded and not reopened.
- **IN-24 (Info): a throw is still fail-open.** A throw, as opposed to an error value, from the new composite read in `resolveByVenueIdentity` lands in the outer `catch (adminErr)` and returns `UNRESOLVED`. supabase-js returns errors as values, so this is not reachable in practice, and the post-validation `unresolved` attaches the identity, so today's login-only index still refuses. It is the same class as the existing service-role `catch`.

### Round 3 summary

All four round-3 decisions are implemented as written, in both routes where they apply:

- SF2-N1 / IN-12: the re-read before answering.
- WR-06: the token split and the composite pre-admission refusal.
- WR-07: `read_failed` past a picked holder.
- WR-08: mocks that can fail.

All 17 neuters went RED. The early `held` return does not refuse anything the code did not already refuse after validation. The IN-12 fall-through answers success only when this key holds the slot. The token regex cannot mistake a non-refusal error for a refusal.

There are **no new BLOCKER, critical or MEDIUM findings.** The new items are LOW or Info: IN-18 to IN-24. Under the repo's rule they are recorded here and not booked in `TODOS.md`. IN-19 records a conflict between round-2 decision 1 and round-3 decision 2 for the orchestrator to settle.

**Open after round 3:** 0 warnings and 21 info: IN-01, IN-03 to IN-10, IN-13 to IN-24.

_Round 3 reviewed: 2026-11-24T14:26:45Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

### Orchestrator decisions after round 3 (2026-11-24, final round)

- **IN-18 / SFH N3-1: the two reviewers disagree on severity.** The reviewer rated it LOW, and the silent-failure hunter rated it MEDIUM as a data-correctness issue. I take **MEDIUM, data-integrity**: for ccxt, nothing confirmed enqueues the recompose. It is a survivor of the 3 allowed rounds, so it gets **no fourth fixer round**. It is booked in `TODOS.md` as `[225-SWAPLANDED-NO-RECOMPOSE]` and goes to the coordinator for routing. The fix is one enqueue on the `swapLanded` arm, with no audit replay, because the replay race already audited once.
- **IN-19: round-2 decision 1 and round-3 decision 2 conflict. Under Rule 7, the more recent decision, round-3 decision 2, wins.** A transient swap failure answers 503 even when the compensating delete also failed. The leftover pair heals either way: through the session fence's deduped retry, or through the next poll's stamper swap. Round-2 decision 1's "still 409" now holds only for a token refusal. This is recorded and not fixed (LOW).
- Recorded only, as LOW and Info: IN-20, IN-21, IN-22, IN-23 (bound by the decision) and IN-24. SFH N3-2 to N3-5 duplicate IN-22 and IN-23 or are hardening notes.
- **PR-2 review is closed at round 3.** 0 MEDIUM+ remain open in the code. The one MEDIUM survivor is booked.

- **Coordinator routing, 2026-11-24.** `[225-SWAPLANDED-NO-RECOMPOSE]` stays in Phase 225. On the phase branch, the `swapLanded` arm of both routes gets the `derive_allocator_equity` enqueue and the audit row, plus a test that goes RED when neutered. It ships in its own small PR with no migration, after #1324 and before PR-3, and deletes the TODOS entry. The coordinator also confirmed the IN-19 resolution, and round-2 decision 1 is flagged superseded at its source.
