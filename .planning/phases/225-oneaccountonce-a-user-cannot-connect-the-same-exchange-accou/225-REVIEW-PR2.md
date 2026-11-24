---
phase: 225-oneaccountonce-a-user-cannot-connect-the-same-exchange-accou
reviewed: 2026-11-24T12:42:05Z
depth: standard
files_reviewed: 27
files_reviewed_list:
  - analytics-service/services/account_identity.py
  - analytics-service/tests/fixtures/venue_server_identity.json
  - analytics-service/tests/test_account_identity_stamper.py
  - analytics-service/tests/test_venue_server_identity.py
  - docs/runbooks/venue-server-backfill/README.md
  - docs/runbooks/venue-server-backfill/census.sql
  - src/__tests__/audit-coverage.test.ts
  - src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.test.tsx
  - src/app/api/keys/[id]/rotate-secret/route.test.ts
  - src/app/api/keys/[id]/rotate-secret/route.ts
  - src/app/api/keys/validate-and-encrypt/route.test.ts
  - src/app/api/keys/validate-and-encrypt/route.ts
  - src/app/api/strategies/create-with-key/route.test.ts
  - src/app/api/strategies/create-with-key/route.ts
  - src/components/exchanges/AllocatorExchangeManager.test.tsx
  - src/components/strategy/ApiKeyManager.test.tsx
  - src/lib/account-share-note.test.ts
  - src/lib/account-share-note.ts
  - src/lib/database.types.ts
  - src/lib/venue-identity.test.ts
  - src/lib/venue-identity.ts
  - src/lib/wizardErrors.invariant.test.ts
  - src/lib/wizardErrors.roster-render.test.tsx
  - src/lib/wizardErrors.test.ts
  - src/lib/wizardErrors.ts
  - src/lib/wizardKeyRosters.test.ts
  - src/lib/wizardKeyRosters.ts
findings:
  critical: 0
  warning: 5
  info: 11
  total: 16
  necessity: 1
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
   - Deleting a row created by the same failed request is allowed. The "keep data" rule protects the user's existing data, not a half-done write from that request.
   - An atomic SQL version (`p_swap_from_holder`) is NOT built now.
2. **SF-M1 / IN-11: fail closed.** A failed same-login read in validate-and-encrypt and rotate-secret answers a retryable 503-class error before any write, captured to Sentry, instead of continuing. create-with-key's equivalent fence read gets the same treatment.
3. **WR-02: answer the session fence's deduped body.** The post-validation draft read also selects `wizard_session_id`. When it equals the request's session, the route answers the same body as the existing session fence.
4. **WR-03: both runtimes normalise from the same parse.** TS strips the raw server the same way Python's validator does (`str.strip()` semantics) before `normaliseVenueServer`. An end-to-end parity case with an NBSP-padded server is added to the shared fixture and both suites.
5. **SF-M2 and WR-04 (Python):**
   - The three contract tokens log at ERROR.
   - `sync_status='syncing'` is not treated as working for the swap decision only.
6. **WR-05: drop Census 2** from `docs/runbooks/venue-server-backfill/census.sql` and its README pass table, because it cannot return a row.
