---
status: awaiting_human_verify
trigger: "14 live keys keep venue_account_id NULL although position polls run (167.1.2-08 census)"
created: 2026-10-03
updated: 2026-10-03
---

# Debug: live keys whose venue_account_id is never stamped

## Trigger (verbatim, data only)

DATA_START
Phase 167.1.2-08 census on PROD (read-only, marker-checked): census (a) reads all.live_keys 32, all.live_keys_venue_account_id_null 14 (deribit 7 of 16, okx 5 of 11, mt5 2 of 4, bybit 0 of 1) on 2026-10-02 ~22:00Z and again unchanged on 2026-10-03 ~10:30Z, although poll_allocator_positions / poll_positions jobs ran DONE in between (admin Compute Jobs list, 2026-10-03). Census (b) unchanged: duplicate.blocking 12 across 4 owners. The 167.1.2 plans expected "the stamp runs on the next scheduled poll" (plan 08 Task 2 context; RECOMPUTE-RUNBOOK step "stamp"). Find which code path writes api_keys.venue_account_id (and account_share_kind), why it skips these 14 keys (venue not supported by the stamper? key role? sync_status? the poll path not calling the stamper? an exception swallowed?), with evidence. Then propose the fix; no PROD writes, no data backfill without founder approval.
DATA_END

## Symptoms

- expected: every live ccxt/MT5 key gets venue_account_id stamped by the next scheduled poll after PR C (167.1.2) deployed.
- actual: 14 of 32 live keys stay NULL across at least one poll cycle.
- errors: none observed yet.
- timeline: measured 2026-10-02 22:00Z and 2026-10-03 10:30Z.
- reproduction: re-run `node scripts/accounttruth-census.mjs --print-sql=a` and submit via read-only linked CLI.

## Constraints

- Work in the 167 worktree (branch feat/167.1.2-08-census); prefix every shell command with `cd` to it.
- PROD access: read-only SELECTs only, via `supabase db query --linked` from the main checkout, marker query FIRST (`SELECT shobj_description(oid,'pg_database') ...` must name PRODUCTION). Never write. Counts and ids only in tracked files (public repo); never print keys, secrets, labels, emails or account numbers.
- Railway logs may be read (railway CLI) for the poll handlers; no variable changes, no redeploys.
- No pushes. No fix applied to PROD data. A code fix may be prepared and committed on the branch with tests.

## Current Focus

bug_class: Bohrbug (deterministic; no flake)
hypothesis: CONFIRMED. MT5 keys connected before 2026-08-12 stay NULL because services/account_identity.py `_stamp` returns `skipped_not_ccxt` for mt5 and no other path backfills them; the poll already holds the decrypted login (Mt5Session built by job_worker._make_mt5_session) but drops its TEXT form (only `int(login)` survives).
reasoning_checkpoint:
  hypothesis: "Two live MT5 keys on one broker account are summed twice because neither carries venue_account_id; the poll stamper skips mt5 (`venue not in VENUES_WITH_ACCOUNT_ID`), so the unique index never sees them."
  confirming_evidence:
    - "account_identity._stamp returns skipped_not_ccxt for mt5 (code read; existing test test_non_ccxt_venues_are_skipped pinned it)"
    - "PROD: the 2 NULL MT5 keys predate the column; tolerance comparison shows the two pre-column MT5 keys move as one account"
    - "Red tests: an MT5 key driven through the real poll DONE path writes no venue_account_id (only the poll's own status write)"
  falsification_test: "After the fix, an MT5 key with NULL id driven through run_poll_allocator_positions_job must write the stripped login; a colliding one must be marked duplicate with exactly one audit. If either stays red, the hypothesis or wiring is wrong."
  fix_rationale: "Stamp from the login text carried on the session (no terminal call), through the SAME _stamp UPDATE / 23505 / _mark_shared / _audit_duplicate path; one helper (mt5_validation.mt5_venue_account_id) used by the session constructor and the rotate route so poll and connect/rotate write the same bytes."
  blind_spots: "JS String.trim (connect) and Python str.strip (rotate, poll) disagree on a handful of exotic code points (U+FEFF, U+001C-001F); parse_mt5_credentials' int() rejects/accepts some of them differently. Logins are ASCII digits in practice; poll mirrors rotate, which already has this exact divergence from connect."
  candidate_causes:
    - "code: mt5 excluded from the poll stamper venue gate"
    - "data: keys connected before the column existed (2026-08-04 < 2026-08-12), never backfilled"
    - "config/docs: runbook attributed MT5 NULL to D-10, which covers sFOX only, so nobody booked it"
  and_gate: "yes: pre-column MT5 keys (data) AND no MT5 poll-time writer (code) together; either alone would not leave a NULL forever"
tdd_checkpoint:
  test_file: "analytics-service/tests/test_account_identity_stamper.py"
  test_name: "MT5 section at end of file (11 tests incl. parametrized), e.g. test_mt5_null_identity_key_is_stamped_from_its_login_without_touching_the_terminal, test_poll_stamps_an_mt5_key_on_its_done_path"
  status: "green"
  failure_output: "11 failed, 68 passed. assert 'skipped_not_ccxt' == 'stamped'; assert [] == ['0080000017']; AttributeError: module 'services.mt5_validation' has no attribute 'mt5_venue_account_id' (the one AttributeError red, the shared-helper pin); assert 0 == 1 (escalation)"
next_action: "HUMAN VERIFY (post-deploy, PROD read-only): after the fix commit 09c1be0fb ships and one poll_allocator_positions cycle runs for the 4 live MT5 keys, run the marker query, then census (a) and (b) via `node scripts/accounttruth-census.mjs --print-sql=a` / `=b`. Expect mt5.live_keys_unstamped_unmarked = 0, exactly one of the two pre-column MT5 keys carrying account_share_kind='duplicate' with the other as holder, exactly one new api_key.account_duplicate_detected audit event for it, and duplicate.blocking up by 1 (12 -> 13, unless step-4 cleanup moved it; census (b) has no venue filter but counts a marker only while its holder is `working`). DISPROVING READING: if BOTH keys come back stamped with DIFFERENT values and neither is marked, the fix worked but its premise did not hold: either the tolerance comparison's one-account conclusion was wrong, or the two login slots differ as text. That is a new finding for the founder, not a failed fix (the logins are in ciphertext, so this cannot be checked from SQL beforehand). If either key is still unstamped and unmarked after any poll attempt (the MT5 stamp runs BEFORE the fetch since the 167.1.2-08 review fix round, so a failing poll stamps too), the fix did not run: check Railway logs for `account_identity: ... (venue mt5) outcome=`. Do NOT archive before that reading."

## Evidence

- timestamp: 2026-10-03
  checked: writers of api_keys.venue_account_id in analytics-service
  found: the ONLY poll-time writer is services/account_identity.py `_stamp` via `stamp_account_identity`, called from ONE site, job_worker.run_poll_allocator_positions_job, on the DONE path after persist. `_stamp` returns `skipped_not_ccxt` for any venue outside VENUES_WITH_ACCOUNT_ID = {okx, bybit, binance, deribit}; MT5 and sFOX are deliberately absent. On a 23505 against api_keys_user_exchange_venue_account_uniq it writes account_shared_with_api_key_id + account_share_kind and LEAVES venue_account_id NULL by design (_mark_shared docstring). MT5 identity is written only at connect/rotate by the Next route (routers/internal.py rotate returns login as venue_account_id; migration 20260812083206 introduced the column on 2026-08-12).
  implication: a NULL venue_account_id is the EXPECTED end state for a key marked duplicate, and the permanent state for any MT5 key connected before 2026-08-12.

- timestamp: 2026-10-03
  checked: PROD read-only (marker = PRODUCTION), the 14 eligible keys with NULL venue_account_id, per key
  found: 12 of 14 (deribit 7, okx 5) carry account_share_kind='duplicate' with a holder; all 12 are allocator keys (0 strategy_keys rows), sync_status complete, 3 poll_allocator_positions jobs each in the last 3 days, all done (last done 2026-10-03 04:04-04:11Z). The other 2 are MT5 (share kind NULL, same poll history).
  implication: the 12 ccxt keys were reached by the stamper and marked; they equal census (b) duplicate.blocking 12. Census (a) counts them as "unstamped", which is the misreading.

- timestamp: 2026-10-03
  checked: audit_log action api_key.account_duplicate_detected
  found: 18 events, exactly 1 per key (18 distinct keys, 1 holder each), 15 on 2026-09-29 and 3 on 2026-10-02; 4 of those keys have since been disconnected. All 9 distinct holders of the current duplicates are live and stamped.
  implication: the stamper ran on the first polls after deploy and audited each transition once, as designed. No swallowed exception path is implicated for the ccxt keys.

- timestamp: 2026-10-03
  checked: PROD live MT5 keys
  found: 4 live MT5 keys, all one owner, all allocator keys. The 2 NULL ones were created 2026-08-04 (before the 2026-08-12 column migration); the 2 stamped ones were created 2026-08-13 and 2026-09-01.
  implication: the 2 NULL MT5 keys were connected before any MT5 writer existed, and nothing backfills them. Their duplicate check therefore cannot run: if either shares a broker login with a stamped MT5 key, that account is summed twice and nothing can see it.

- timestamp: 2026-10-03
  checked: 167.1.2-RECOMPUTE-RUNBOOK.md step 3 and 167.1.2-CONTEXT.md D-10
  found: the runbook says sFOX and MT5 "stay NULL by design (D-10)", but D-10 covers sFOX ONLY ("no stable account id is known in the sFOX balance"). MT5 has a known source: the login, held in the encrypted credentials the poll already decrypts.
  implication: MT5's NULL is an unbooked residual mis-attributed to D-10, not a decision.

- timestamp: 2026-10-03
  checked: MT5 backfill paths that already exist; booked residuals
  found: src/app/api/keys/[id]/rotate-secret/route.ts backfills venue_account_id when the row's value is NULL, but on a 23505 against the identity index it RETRIES WITHOUT the backfill and returns 200 (WR-02), so a duplicate found that way is not marked or audited and the key stays NULL. No TODOS.md or deferred-items entry books "pre-2026-08-12 MT5 keys are never backfilled". TODOS.md A-3 (login unique only within a broker server) is adjacent and still open.
  implication: option A (founder rotates the 2 keys) stamps a distinct account but silently hides a duplicate.

- timestamp: 2026-10-03
  checked: PROD read-only, whether the 2 NULL MT5 keys double-count a stamped MT5 key today: md5 over sorted (symbol, holding_type, side, quantity[, value_usd]) allocator_holdings rows at the latest asof 2026-10-03, pairwise over the 4 live MT5 keys (booleans only)
  found: each key has 1 holdings row; all 6 pairs differ on both fingerprints.
  implication: SUPERSEDED by the next entry. Exact md5 over rows polled minutes apart cannot tell "distinct accounts" from "one account read at two moments"; this measured only that the rows are not byte-identical.

- timestamp: 2026-10-03
  checked: added census (a) buckets `<venue>.live_keys_unstamped_unmarked` / `all.…` (eligible AND NOT venue_known AND holder_id IS NULL), ran the printed statement read-only on PROD after the marker
  found: all.live_keys_unstamped_unmarked 2 (mt5 2); binance/okx/bybit/deribit/sfox 0. Raw NULL buckets unchanged (14; deribit 7, okx 5, mt5 2).
  implication: the stamper has resolved every ccxt key. The runbook gate now reads a bucket that can reach 0.

- timestamp: 2026-10-03
  checked: PROD read-only, tolerance comparison over the 4 live MT5 keys' allocator_holdings (counts/booleans only). The MT5 holdings `symbol` is `ACCOUNT-<api_key_id prefix>`, so symbol equality is meaningless and was discarded.
  found: the pair formed by the two pre-column MT5 keys (BOTH the NULL ones, created 3 h apart on 2026-08-04): value within 1% on 10 of 10 shared days in 14; over 30 days, 14 shared days, 11 with IDENTICAL values, ratio band 0.9977-1.0008, 7 of 7 moves in the same direction. Every other pair: 0-1 of 10 days within 1%.
  implication: the two pre-column MT5 keys are almost certainly ONE broker account behind two live keys, which the founder's allocator book sums twice today. The duplicate check cannot see it because neither key carries a venue_account_id. This is a live data-integrity defect, not a latent gap.

- timestamp: 2026-10-03
  checked: where the MT5 poll decrypts credentials and whether it reaches the stamper
  found: job_worker._allocator_key_preflight decrypts (decrypt_credentials) and builds an Mt5Session via _make_mt5_session -> parse_mt5_credentials, which keeps only `login: int`. run_poll_allocator_positions_job calls account_identity.stamp_account_identity(ctx.supabase, ctx.key_row, ctx.exchange, ...) for EVERY venue on the DONE path, so MT5 already reaches the stamper and is turned away by the venue gate in _stamp. No second call site is needed.
  implication: the fix lives in _stamp plus carrying the login TEXT on the session; no new wiring in the handler.

- timestamp: 2026-10-03
  checked: MT5 identity form at connect and rotate
  found: src/app/api/keys/validate-and-encrypt/route.ts writes `api_key.trim()` (the raw login slot, trimmed); create-with-key does the same; routers/internal.py rotate returns `(login or "").strip() or None` from the decrypted slot. Neither caps at 128 nor converts through int. parse_mt5_credentials accepts "007" and "8000_0017" via int(), so str(int(login)) would differ from the stored text.
  implication: poll must write the stripped login TEXT, not str(session.login). Shared helper in mt5_validation (leaf module) used by session constructor and rotate.

- timestamp: 2026-10-03
  checked: whether an MT5 duplicate marker actually de-duplicates the book, and whether the DB accepts an MT5 stamp/marker
  found: allocator_equity_derive.account_groups (used by equity_reconstruction and job_worker writers) groups by account_share_kind/holder with NO venue filter; TS countsAsDuplicate has no venue filter either (ACCOUNT_IDENTITY_EXCHANGES only gates the "identity pending" reason, MT5 exempt). Migration 20260925120000: CHECKs on account_share_kind / holder pairing and the api_keys_account_share_same_owner trigger check owner/live/marked only, no venue restriction; api_keys_scrub_venue_account_id is BEFORE INSERT only (the stamp is a service-role UPDATE). Column comment allows a value "derived ... by decrypting the stored ciphertext already on this same row".
  implication: an MT5 marker will collapse the pre-column MT5 pair in both writers, and PROD will accept the write. No migration needed.

- timestamp: 2026-10-03
  checked: TODOS.md A-3 (login unique only within a broker server) vs the poll path
  found: connect, create-with-key and rotate all store the login ALONE; the unique index is (user_id, exchange, venue_account_id).
  implication: DELIBERATE POSITION: the poll stamps the login alone, no server qualification, and adds no server check. A server-qualified value would never collide with a connect-stamped key (breaking requirement 2). The poll's collision set is therefore EXACTLY connect's, no new false-duplicate class. The consequence differs: connect REFUSES the second key (409); the poll MARKS it 'duplicate' and the book counts that account once through the holder. For the A-3 case (same owner, same login, two different brokers) that under-counts one genuinely separate account, the same mis-attribution A-3 already describes for connect. A-3 remains open and owns the fix (server-qualifying the stored value is a migration + backfill decision).

- timestamp: 2026-10-03
  checked: RED phase, analytics-service/tests/test_account_identity_stamper.py with TEST_* env unset
  found: 11 failed, 68 passed. Two existing tests edited in the same change (test_non_ccxt_venues_are_skipped now sfox only; test_no_escalation_where_no_duplicate_check_is_missing drops the mt5 param); both still green. The 11 new MT5 tests fail on assertions (skipped_not_ccxt vs stamped/marked_duplicate/skipped_already_stamped, no stamp write on the poll DONE path, no escalation) and one AttributeError (mt5_validation.mt5_venue_account_id absent).
  implication: bug reproduced by test; ready for green.

- timestamp: 2026-10-03
  checked: GREEN phase, fix applied (commit 09c1be0fb) and verified, TEST_* env unset, pytest from analytics-service/
  found: tests/test_account_identity_stamper.py 79 passed (was 11 failed / 68 passed at 99f97eaa6). Broader set (stamper, test_account_identity, all 20 tests/test_mt5_*.py incl. test_mt5_rotate_secret_internal, test_allocator_positions_non_ccxt, all tests/test_job_worker*.py): 1325 passed, 2 skipped (test_mt5_validate.py:685 empty parameter set; test_job_worker.py:4078 TEST_SUPABASE_DB_URL unset). Full analytics suite: 7593 passed, 90 skipped, 0 failed; every skip is environmental (TEST_* / live DB / HAS_PY_ENV / founder-gated cassettes and sandbox keys). mypy --strict exactly as CI: no issues in 102 files. ruff: 5 findings in the touched files, identical at baseline (pre-existing, not a CI gate).
  implication: the fix makes the red tests green without weakening them and regresses nothing measured.

- timestamp: 2026-10-03
  checked: mutation guardrail, each mutant applied with Edit and restored with Edit (no git checkout)
  found: M1 `_stamp` gate back to VENUES_WITH_ACCOUNT_ID -> 9 red (all MT5 stamp/collision/already-stamped/log/poll tests). M2 escalation gate back to VENUES_WITH_ACCOUNT_ID -> 1 red (test_an_mt5_key_unstamped_for_days_escalates_like_a_ccxt_key). M3 session value `str(login)` instead of the helper -> 3 red (leading-zeros, underscore, rotate-form). All restored, 79 green after; `grep MUTANT` over services/ routers/ empty.
  implication: each fix component is pinned by a test that bites when it is removed.

- timestamp: 2026-10-03
  checked: MT5_ENABLED-off arm (services/allocator_positions.py kill switch) vs the stamp
  found: with MT5_ENABLED off the holdings arm returns ([], MT5_DISABLED_DETAIL) and the handler still reaches the DONE path, so stamp_account_identity runs. For MT5 it reads only Mt5Session.venue_account_id, which comes from the row's own decrypted ciphertext; no terminal read. The session itself (Mt5Client transport connect) is built by the preflight regardless, as WR-08 already documents.
  implication: RESIDUAL, booked, not fixed: the poll stamps on ANY done poll, including while MT5 is disabled. The write is identity-only (venue_account_id or the duplicate marker) and derived from data already on the row, so the kill switch's purpose (no broker/terminal reads) holds.

## Founder Decision

DATA_START
2026-10-03, founder, via AskUserQuestion in the orchestrator session:
- Option B chosen: stamp MT5 keys at poll time from the login in the already-decrypted credentials, reusing the existing collision -> `account_share_kind='duplicate'` marker -> `api_key.account_duplicate_detected` audit path in `analytics-service/services/account_identity.py`.
- Interim: no manual disconnect; wait for B.
- Duplicate cleanup is owned by the orchestrator separately; NOT this session's job.
- Constraints on the fix: failing-first test, then fix. Pin (1) non-MT5 behaviour unchanged, (2) the MT5 identity form written at poll matches what the connect/rotate path writes (poll and connect agree), (3) TODOS A-3 (login unique only per broker server) is not made worse. Commit on branch, no push. No writes to shared TEST or PROD. pytest only from `analytics-service/` with TEST_* env unset.
DATA_END

## Eliminated

- hypothesis: the poll path does not call the stamper for these keys
  evidence: all 14 are allocator keys with done poll_allocator_positions jobs; 12 were marked by the stamper (audit events dated to the first post-deploy polls).
  timestamp: 2026-10-03
- hypothesis: an exception inside the stamp is swallowed for the 12 ccxt keys
  evidence: each carries a duplicate marker + exactly one audit event, the stamper's successful 'marked_duplicate' outcome.
  timestamp: 2026-10-03

## Corrected 2026-10-03 (167.1.2-08 review round 2, IN-R2-06 / SFH L-4)

Two facts below were superseded by the 167.1.2-08 review fix round and are corrected where they appear;
the Evidence entries stay as measured at the time.
- `Mt5Session.venue_account_id` is a REQUIRED field (no default) since SFH M-1. The `field(default=None, ...)`
  shape in `fix` is the 09c1be0fb state.
- The MT5 stamp runs BEFORE the holdings fetch since SFH H-1, so a failing MT5 poll stamps too. "After a DONE
  poll" in the Evidence and residuals describes 09c1be0fb.
- The two PROD api-key id prefixes this file used to name are replaced with "the two pre-column MT5 keys".
  Git history still carries them; it was not rewritten.

## Resolution

root_cause: "Two causes, two layers. (1) Census misreading (fixed in 3fbdad866): 12 of 14 NULL keys (deribit 7, okx 5) are keys the stamper MARKED duplicate, whose NULL is by design; census (a)'s raw NULL bucket counted them as unstamped. (2) AND-gate for MT5 (fixed in 09c1be0fb): data, 2 MT5 keys connected 2026-08-04, before the venue_account_id column (2026-08-12); AND code, the poll stamper's `_stamp` turned MT5 away at its venue gate (`skipped_not_ccxt`) and no other path backfills a pre-column MT5 key. With NULL ids the unique index could not see that the two pre-column MT5 keys measure as one broker account, so the allocator book sums it twice. The runbook mis-attributed the MT5 NULL to D-10 (sFOX only)."
fix: "3fbdad866: census (a) gains `<venue>.live_keys_unstamped_unmarked` + `all.…`; runbook step 3 reads it. 09c1be0fb (founder Option B): services/mt5_validation.mt5_venue_account_id(login_slot) = stripped login TEXT or None, the one spelling used by the rotate route and by job_worker._make_mt5_session; Mt5Session gains `venue_account_id: str | None = field(default=None, repr=False)` (CORRECTED 2026-10-03, 167.1.2-08 review fix round, SFH M-1: the field is now REQUIRED, `field(repr=False)` with no default, so a constructor that omits it fails at construction); account_identity._stamp gets an MT5 arm that reads the session value (no terminal call) and then shares the existing UPDATE -> 23505 -> _find_live_holder -> _mark_shared -> _audit_duplicate path (no second marking path); `_unstamped_for_too_long` covers MT5; VENUES_WITH_ACCOUNT_ID unchanged (ccxt set, read by the validator drift log and equity_reconstruction); docstrings (module, _stamp, handler, constructor, session field) updated; RECOMPUTE-RUNBOOK step 3 records the resolution and the expected post-deploy reading. Duplicate cleanup stays with the orchestrator (founder decision)."
verification: "signal 1 red->green: stamper file 11 failed/68 passed -> 79 passed. signal 2 regression: broader set 1325 passed / 2 skipped (environmental, named in Evidence); full analytics suite 7593 passed / 90 skipped (all environmental) / 0 failed; mypy --strict as CI clean. signal 3 mutation: M1 9 red, M2 1 red, M3 3 red, all restored by Edit. signal 4 minimality: 5 source files, +96/-10, identity-only write set unchanged (_assert_write_set_is_identity_only passes for MT5). signal 5 PENDING human verify on PROD after deploy (see next_action). guardrail_verdict: accepted (pending PROD reading)."
oracle_type: specified (connect/rotate identity form + the existing ccxt collision contract)
residuals:
  - "The poll stamps an MT5 key on ANY done poll, including the MT5_ENABLED-off arm; the value comes from the row's own ciphertext, no terminal read. Booked, not fixed. CORRECTED 2026-10-03 (167.1.2-08 review fix round, SFH H-1): the MT5 stamp now runs BEFORE the fetch, so it runs on ANY poll attempt that builds a session, failing ones included, not only on a DONE poll. The kill-switch reasoning is unchanged: it is still identity-only and reads no terminal."
  - "TODOS.md A-3 (login unique only per broker server) unchanged and still open: the poll's collision set equals connect's; where connect would refuse (409), the poll marks 'duplicate'."
  - "PII scrub: `venue_account_id` is NOT on the redact.py / pii-scrub.ts key denylist, by design (it is a legitimate response field). No new exposure class: the MT5 login already reached frames as the `login` local, the ccxt `account_id` local in _stamp predates this fix, and the new Mt5Session field is repr=False."
  - "JS String.trim vs Python str.strip differ on a few exotic code points; poll mirrors rotate, which already had that divergence from connect."
human_verify: "After deploy + one poll cycle, PROD read-only (marker first): mt5.live_keys_unstamped_unmarked -> 0; one of the two pre-column MT5 keys marked 'duplicate' with the other as holder and exactly one api_key.account_duplicate_detected audit event for it. Both stamped with different values and neither marked = the premise (one account) did not hold; new finding, not a failed fix. See next_action."
files_changed: [scripts/accounttruth-census.mjs, src/__tests__/accounttruth-census.test.ts, analytics-service/tests/test_account_identity_stamper.py, analytics-service/services/mt5_validation.py, analytics-service/services/mt5_client.py, analytics-service/services/job_worker.py, analytics-service/services/account_identity.py, analytics-service/routers/internal.py, .planning/phases/167.1.2-.../167.1.2-RECOMPUTE-RUNBOOK.md]
