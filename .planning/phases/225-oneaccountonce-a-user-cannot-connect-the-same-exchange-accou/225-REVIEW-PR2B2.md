---
phase: 225-oneaccountonce-a-user-cannot-connect-the-same-exchange-accou
reviewed: 2026-11-25T16:52:08Z
round: 1
depth: standard
# Scope: PR-2b-2 (plans 14, 15, 16), `git diff origin/main..bb4449c5a -- . ':!.planning'`,
# read from the bb4449c5a blobs (plan 17 commits on top were not reviewed).
files_reviewed: 31
files_reviewed_list:
  - analytics-service/routers/match.py
  - analytics-service/services/allocator_equity_derive.py
  - analytics-service/services/job_worker.py
  - analytics-service/tests/fixtures/derive_refusal_rows.json
  - analytics-service/tests/fixtures/venue_server_identity.json
  - analytics-service/tests/test_derive_allocator_equity_job.py
  - analytics-service/tests/test_match_portfolio_aum_per_key.py
  - analytics-service/tests/test_venue_server_identity.py
  - scripts/mutation-floors.mjs
  - src/__tests__/api-key-runtime-guard.test.ts
  - src/__tests__/gate-family-meta.test.ts
  - src/__tests__/lint-sql-gates.test.ts
  - src/__tests__/mutation-annotation-parser.test.ts
  - src/__tests__/mutation-runner-floors.test.ts
  - src/components/exchanges/AllocatorExchangeManager.departed-history.test.tsx
  - src/components/exchanges/AllocatorExchangeManager.tsx
  - src/lib/constants.ts
  - src/lib/departed-history.ts
  - src/lib/fingerprint-venue-server-parity.test.ts
  - src/lib/latest-holdings-per-key.test.ts
  - src/lib/latest-holdings-per-key.ts
  - src/lib/queries.my-allocation.test.ts
  - src/lib/queries.test.ts
  - src/lib/queries.ts
  - src/lib/sec-005-api-keys-projection.test.ts
  - src/lib/types.ts
  - src/lib/venue-identity.test.ts
  - supabase/migrations/20261125151936_commit_scenario_batch_venue_server_identity.sql
  - supabase/migrations/down/20261125151936-rollback.sql
  - supabase/schema/functions/commit_scenario_batch.sql
  - supabase/tests/test_commit_scenario_batch_venue_server_identity.sql
findings:
  critical: 0
  warning: 2
  info: 9
  total: 11
  necessity: 1
status: issues_found
---

# Phase 225: Code Review Report, PR-2b-2

**Reviewed:** 2026-11-25T16:52:08Z
**Scope:** PR-2b-2 (plans 14, 15, 16), `git diff origin/main..bb4449c5a -- . ':!.planning'`, 31 files, one migration. Every line number below is from the `bb4449c5a` blobs.
**Depth:** standard, with cross-file traces where a finding needed one: every TS and Python caller of the identity, the commit route's AUM recompute, the derive's refusal path through the reader, and the older `commit_scenario_batch` gates.
**Files Reviewed:** 31
**Status:** issues_found

## Summary

Read against `225-CONTEXT.md` Q6, plans 14 to 16 and their SUMMARYs. `$HOME/.claude/gsd-core/references/necessity-review.md` was read and applied.

**What holds, verified rather than assumed:**

- **The three twins agree.** I compared Python `_login_identities` and `account_identity_tokens` (`analytics-service/services/allocator_equity_derive.py:499-636`), TS `loginIdentities` and `accountIdentityTokens` (`src/lib/departed-history.ts:136-270`) and SQL `owner_keys` / `login_servers` / `key_identity` / `account_edges` / `known_account` / `reach` / `key_account` (migration `:287-370`) clause by clause. They agree on all of the following:
  - The exchange is folded to lower case, and both the join and the per-login server count are partitioned by it.
  - The login is trimmed, and a blank login has no identity.
  - A server is stored bytes; empty is no server; there is no trim and no case-fold.
  - S counts distinct non-null servers per (exchange, login).
  - A key's canonical server is its own, else `''` when S is empty, else the single member, else NONE. NONE joins no login union.
  - Marker edges are unchanged in both directions and require the holder to be among the owner's keys.
  - The root is the smallest id under a byte comparison: `COLLATE "C"`, JS `<`, Python `str` comparison.
  - Union is transitive through a server-less key in all three. That key carries one canonical identity, never a pairwise wildcard, so it cannot re-merge srv-a and srv-b.
  - In SQL the CASE mixes the default collation with `"C"` from the `min(... COLLATE "C")` CTE column. That resolves to `"C"` (one non-default implicit collation), not an indeterminate collation, so `b.identity_server = a.identity_server` cannot raise.
- **The re-base is faithful.** The function body of `20261125151936` differs from `20261027120000` only in the identity CTEs and the step-3 comment (56 changed lines, all inside `owner_keys`, the two new CTEs, `account_edges` and `known_account`). Carried unchanged: SECURITY DEFINER, `SET search_path = public, pg_catalog`, the 5-argument signature, the REVOKE / GRANT pair, and every other CTE. No migration after `20261027120000` redefines the function. The rollback body is byte-identical to `20261027120000`'s. The committed schema snapshot carries the same hunk.
- **The reader key sets match.** Every reader sees the owner's full key set, departed keys included:
  - the derive's `_load_keys`;
  - the scorer's key read;
  - `fetchLatestHoldingsPerKey` and `fetchHoldings` (`KEY_IDENTITY_COLUMNS`);
  - `getUserApiKeys`, which feeds `marksIncludedKeys`, `deriveKeyDataGapsField` and the exchanges page;
  - SQL `owner_keys`.

  So S is the same set everywhere. No TS caller builds a `DepartedHistoryKey` without `venue_server`.
- **The tests can fail.** All 12 gate arms are row-for-row equal to the hand-typed `CASES` in `src/lib/fingerprint-venue-server-parity.test.ts` (login, server, live flag, day, symbol, marker). The parity test also has a login-only control (`dropServers`) that changes the literal. The Python and TS fixture replays run each case in both row orders, and the projecting fakes make a dropped `venue_server` select go RED.

**Key concerns:** a key whose server cannot be placed can block an owner's whole book, and the owner is shown a toggle that cannot clear it. This is reachable today (WR-01). The two older `commit_scenario_batch` gates were not retargeted to the re-based migration, unlike the precedent the `20261027120000` re-base set (WR-02).

## Warnings

### WR-01: An unplaceable departed key blocks the whole book, and its card offers an "Include" that cannot clear it

**Files:**
- `analytics-service/services/job_worker.py:17163-17190`: the refusal.
- `src/lib/departed-history.ts:304-306`, `:459-474` and `:495`: the card.
- `analytics-service/tests/fixtures/derive_refusal_rows.json`: the `account_server_ambiguous` row, `reader_reason` `derivation_rejected`.

**Issue:** The derive refuses the book with `account_server_ambiguous` whenever `ambiguous_server_key_ids(key_rows)` is non-empty. Two conditions do not affect that refusal: whether the key would count at all, and the owner's `history_inclusion`. Trace an ambiguous departed key with `history_inclusion` NULL through the owner's screens:

1. `departedHistoryInclusion` returns `account_unknown`, and the alternative (`include`) returns `owner_included`.
2. So `departedHistoryCard` sets `toggleTo: "include"` and renders: "History not included: we cannot tell whether this key read the same exchange account as a key you still have connected. **Include it if it was a different account.**"
3. The owner clicks Include, and `set_departed_key_history_inclusion` queues a recompose.
4. The derive refuses again, because the check runs before and regardless of `departed_decisions`.
5. An owner who picks Exclude also stays refused, so the explicit D-05 "exclude, it never counts" choice no longer takes a key out of the book.
6. The book reads `derivation_rejected` through the reader's ELSE arm: "did not pass its checks", contact form.

Nothing on any screen names the only exit in plan 14 (`:98`, delete the key with `delete_allocator_api_key`). That exit also deletes the key's history.

This contradicts the card's own contract in the doc comment above `departedHistoryCard`: "so its card names that cause instead of inviting a change that cannot take effect".

**Reachable without migration B.** `api_keys_user_exchange_venue_account_uniq` is scoped to live keys (`disconnected_at IS NULL`, migration `20260812083206`), and S counts the servers of disconnected keys. Here is one book that hits it today:
- a live key on L at srv-a;
- a disconnected key on L at srv-b, for example after a broker move;
- an older disconnected key on L with no server.

The poll backfill only reaches live keys, so a disconnected NULL-server key stays NULL. Plan 14 measured PROD at one such NULL-server MT5 key.

**Fix:** This needs a coordinator decision because CONTEXT Q6's agent decision says "refuses". Do not hand it to a fixer as a minimal edit. Two options:
- **(a) Narrow the refusal to keys that would count.** Refuse only for a live or working ambiguous key, or a departed one whose `departed_decisions[...]` is `included`. An excluded or uncountable ambiguous key then leaves the book the way any `account_unknown` key does. The TS card already says it does not count.
- **(b) Keep the refusal, and make the screens tell the truth.**
  - In `departedHistoryCard`, a key in `ambiguousServerKeyIds(keys)` gets `toggleTo: null` and a sentence naming the cause and the delete exit. `ambiguousServerKeyIds` exists already and has no caller.
  - `account_server_ambiguous` gets its own reader reason, not the ELSE → `derivation_rejected`.

Either way, add a test that drives the card for an ambiguous departed key. It must assert the card offers no change that the derive would ignore.

### WR-02: The unpriced and same-day-empty gates still mutate the superseded `20261027120000` body

**Files:**
- `supabase/tests/test_commit_scenario_batch_fingerprint_unpriced.sql:123` and `:148`, plus one further `RED-UNDER-M`. All three target `20261027120000`.
- `supabase/tests/test_commit_scenario_batch_fingerprint_sameday_empty.sql:149`, `:228` and four more. All six target `20261027120000`.
- Both files' `RED-UNDER-SETUP` lines, for example `test_commit_scenario_batch_fingerprint_sameday_empty.sql:81`, end at `20261027120000` and do not load `20261125151936`.

**Issue:** The `20261027120000` re-base set the house pattern: it retargeted the older unpriced gate's three arms to its own file. On origin/main the unpriced gate's targets name `20261027120000`, a migration newer than the gate itself. This re-base did not do the same.

The two gates' nine arms now prove they bite against a body that is no longer live. Push-to-main subsetting (D-03) selects a gate by the migrations its `RED-UNDER-SETUP` loads, so a later edit to `20261125151936` that breaks the unpriced or same-day-empty arm of the live body would not run either gate's mutations on that push.

The plain `sql-tests` lane still asserts both gates against the live body, so this is mutation-integrity drift, not a missing assertion. The arms' biting counts (`ARMS_FLOOR`) stay unchanged.

**Fix:**
1. Repoint the nine `"file"` targets to `supabase/migrations/20261125151936_commit_scenario_batch_venue_server_identity.sql`. Each `find` string is carried byte-for-byte, so each still matches once.
2. Append `supabase/migrations/20261123180000_api_keys_venue_server.sql` and the new migration to both gates' `RED-UNDER-SETUP`, as the new gate's setup does.
3. Re-run the mutation runner on both files, and confirm each arm is still its own first failure.

## Info

### IN-01: The self-verify dropped the body-shape tripwires and asserts nothing about the new CTEs

**File:** `supabase/migrations/20261125151936_commit_scenario_batch_venue_server_identity.sql:827-873`
**Issue:** The `20261027120000` verify block asserted the body still carried several things:
- the 50-diff cap and the `scenario.commit` audit PERFORM;
- the clean-poll, marker, `latest_asof`, `native_unpriced:` and `newest_meta` reads;
- the fingerprint guard and the idempotency reservation;
- no `new_weight`;
- the covering index.

The new block checks only the catalogue (overload count, arity, SECURITY DEFINER, search_path, ACL), and nothing asserts that `identity_server` is in the body. The header justifies this as asserting "nothing that a gate twin mutates", but none of the twelve mutations touches the dropped strings. The snapshot, VAC-04 and the gates cover the body today, so this is a lost defence-in-depth layer, not a live gap.
**Fix:** Carry the old block's body-text asserts and add one for `identity_server`. Alternatively, record in the header why they were removed.

### IN-02: The refusal ordering is untested and its stated reason cannot be constructed

**File:** `analytics-service/services/job_worker.py:17163-17168`; `account_identity_collisions` `:16265-16267`
**Issue:** The comment says the ambiguity check runs first so that the named cause wins over "a collision the ambiguity could also produce". `account_identity_collisions` skips a `None` token, and an ambiguous key has `None` unless a marker links it. A marked key is put in `excluded_shared` before counting, so no collision with it is constructible. `_ambiguous_book` produces no collision either, so moving the block below the collision check reddens no test.
**Fix:** Reword the comment to the actual reason, which is its own token and line. Or add a fixture where both checks fire, if one exists.

### IN-03: "No figure is persisted from the ambiguous grouping" is inexact

**File:** `src/app/api/allocator/scenario/commit/route.ts:873-884` (outside the diff; reached through `read.accountByKey`)
**Issue:** Plan 14 `:88` says nothing persists from the ambiguous grouping. The commit route's audit AUM recompute does persist one, and it counts an ambiguous key as its own `key:<id>` account, as the scorer and dashboard do. If that key really read srv-a's account, its rows are counted beside srv-a's. The three twins agree, so the fingerprint is unaffected. The plan accepts this answer; it only states the consequence too narrowly.
**Fix:** Correct the plan's rationale, or exclude a key in `ambiguousServerKeyIds` from `countedRows` if the double count matters for the audit figure.

### IN-04: There is no SQL arm for server-compared-as-stored, though one is constructible

**File:** `supabase/tests/test_commit_scenario_batch_venue_server_identity.sql:19-24`
**Issue:** The header says there is no SQL arm "beyond the by-construction fact". `api_keys_venue_server_valid` refuses only blank values and values over 128 characters, so `'SRV-A'` is storable on the lane. Mutating `server_norm` to `lower(...)` would therefore pass every arm. The Python and TS fixtures cover the case (`server-is-compared-as-stored`); SQL does not.
**Fix:** Add a thirteenth arm: srv-a and SRV-A on one login are two accounts. Move the censuses with it.

### IN-05: Impossible-state guard: `NULLIF(k.venue_server, '')`

**File:** `supabase/migrations/20261125151936_commit_scenario_batch_venue_server_identity.sql:293`
**Category:** necessity
**Issue:** `api_keys_venue_server_valid` (`btrim(venue_server, E' \t\r\n') <> ''`, migration `20261123180000:88`) makes an empty server unstorable, so the `NULLIF` never fires. It mirrors the Python and TS "empty is no server" leg, whose fixture case (`empty-server-is-no-server`) exists for in-memory rows. Whether that symmetry is worth keeping is a judgment call, hence Info.
**Fix:** Keep it for symmetry, or drop it with a comment citing the CHECK.

### IN-06: Stale comments and an overstated "pins all three"

**Files:**
- `analytics-service/routers/match.py:910-913`: still "a shared non-blank (exchange, venue_account_id) OR a marker link".
- `src/app/(dashboard)/allocations/lib/key-data-gaps.ts:59`: `accountId` is now the server-aware login identity, not "the key's known `venue_account_id`".
- `analytics-service/services/allocator_equity_derive.py:519` and `src/lib/departed-history.ts:190`: say the fixture "pins all three".

**Issue:** The SQL gate does not read `venue_server_identity.json`. It is bound to TS by fingerprint literals and to the rule by its own twelve arms, which do not include the `blank-login-is-unknown`, `login-is-stripped` or `empty-server-is-no-server` cases.
**Fix:** Update the wording.

### IN-07: `venue_server` is optional on the identity input types

**Files:** `src/lib/departed-history.ts:33` (`DepartedHistoryKey.venue_server?`); `src/lib/queries.ts:4404` (`EquityHistoryKey.venue_server?`)
**Issue:** A future caller that omits the field compiles and silently reads every key as having no server. If none of a login's keys has a server, they all join one account, which is the login-only merge this PR removes. Every current caller passes the field.
**Fix:** Make it required (`string | null`) on both types.

### IN-08: Whitespace sets differ for login and exchange (pre-existing)

**Files:** `allocator_equity_derive.py:524-532` (`str.strip`), `departed-history.ts:143-147` (`trim`), migration `:291-292` (`btrim`, spaces only)
**Issue:** A login padded with a tab or a no-break space normalises differently in each runtime. This predates the diff, and the `login-is-stripped` case uses spaces only. The `api_keys_venue_account_id_nonblank` CHECK and the stripping writers keep it theoretical.
**Fix:** None needed now. Note it beside the twin comment.

### IN-09: The cross-owner partner notice is still login-only (out of Q6 scope)

**File:** `src/lib/discovery/shared-account-partners.ts:76-83`
**Issue:** `identitiesOf` groups by `venue:<exchange>:<login>` with no server. Two managers whose MT5 logins collide on different brokers are shown to admins as partners. The notice is admin-only and informational, and Q6 covers same-owner readers only.
**Fix:** Record it for the PR-3 follow-up, or add `venue_server` when migration B lands.

---

_Reviewed: 2026-11-25T16:52:08Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

## Silent-failure hunter, round 1 (2026-11-25)

No CRITICAL or HIGH. MEDIUM findings:

- **SF-M1:** `account_server_ambiguous` reaches the owner as the generic "held back" line. It names no key and gives no remedy.
- **SF-M2:** the card of a departed key whose server is ambiguous offers an Include switch that cannot take effect.
- **SF-M3:** the refusal covers every key of the allocator, including excluded and revoked keys.
- **SF-M4:** the other readers count an ambiguous key as its own account, with no log or flag.

The SF LOWs are recorded here only.

## Orchestrator dispositions (2026-11-25)

| Finding | Disposition |
|---------|-------------|
| WR-02 | Already done by plan 17 Task 1 (826b2a4cd). This review was at bb4449c5a, before that commit. |
| WR-01 / SF-M1 / SF-M2 / SF-M3 | **Waiting on a coordinator decision.** It refines the CONTEXT Q6 agent decision. Recommendation: refuse only when the ambiguous key would count (live, or a departed key whose history is included). In every other case, the card names the cause and the delete route and offers no toggle. Then one fixer round. |
| SF-M4 | Recorded. The planned behaviour is that only the derive refuses (plan 14). PROD holds 0 such keys. |
| IN-01..IN-09 and the SF LOWs | Recorded only. |

## Round 2 (2026-11-25)

**Scope:** the fixer commits `e3c96ce25` and `2182213bd`, `git diff 629de0d4c..2182213bd -- . ':!.planning'`, 9 files.
**Tested at:** worktree HEAD `4811ea75b` on `gsd/phase-225-pr2b-2-pr`. Its source matches `2182213bd` apart from CHANGELOG.md, VERSION, package.json and the three `supabase/schema/` baseline files. I checked that by `git diff 2182213bd 4811ea75b --stat`, and the four `wizardErrors*` and `wizardKeyRosters` files are byte-equal.
**Governing decision:** CONTEXT Q6, founder ruling 2026-11-25, verbatim "Delete keys without Server, dont accept keys without Server", MT5 only, part (a): refuse an MT5 key with an empty server, in TS and in Python, and name the cause.
**Depth:** standard. I traced every MT5 write path and both client renderers of the new code, and ran 37 test files that read the touched routes.

```yaml
round: 2
files_reviewed_list:
  - analytics-service/services/allocator_equity_derive.py
  - analytics-service/services/job_worker.py
  - analytics-service/tests/test_venue_server_identity.py
  - src/app/api/keys/validate-and-encrypt/route.test.ts
  - src/app/api/keys/validate-and-encrypt/route.ts
  - src/app/api/strategies/create-with-key/route.test.ts
  - src/app/api/strategies/create-with-key/route.ts
  - src/lib/departed-history.ts
  - src/lib/venue-identity.test.ts
findings:
  critical: 2
  warning: 0
  info: 7
  total: 9
  necessity: 0
status: issues_found
```

### What holds

- **Non-MT5 keys are unaffected.** Both guards are `isMt5 && ...`. `isMt5` is `exchange.toLowerCase() === "mt5"`: see `validate-and-encrypt/route.ts:145` and `create-with-key/route.ts:1219`. An OKX passphrase never reaches `normaliseConnectedVenueServer`.
- **The refusal comes before any side effect, in both routes.** Every statement ahead of it is a pure body check or another 400: `validate-and-encrypt/route.ts:248-253` and `create-with-key/route.ts:1295-1300`. In both routes it runs before the rate limiter, `validateKey`, `encryptKey`, the holder read and the insert or RPC.
- **No other MT5 write path is open.**
  - `composite/add-key` refuses every MT5 request outright with `COMPOSITE_MT5_UNSUPPORTED` (`route.ts:185`).
  - `rotate-secret` changes only the password of an existing MT5 row and writes no `venue_server`.
  - Only the two connect routes write `api_keys.venue_server`, and the column grant migration `20261125132334` keeps `authenticated` and `anon` off INSERT and UPDATE.
- **The removals break no caller.** Nothing in `src/` or `scripts/` references `ambiguousServerKeyIds` or the `ambiguous` field. The shared fixture's `ambiguous` field is still replayed by Python (`test_venue_server_identity.py:118`). TS replays `tokens` only, which matches the deletion. `venue-identity.test.ts` and `departed-history.test.ts` pass.
- **The new route tests can fail (by reading the code, not by a run).** Source was read-only for this review, so I did not neuter the guards. Without the new guard, `"\u001f"` passes the `trim()`-based three-credential check, and a 129-character server is under the 512 cap at `create-with-key/route.ts:1336`. Both requests would then reach the mocked `validateKey`, and the `not.toHaveBeenCalled()` assertions would fail.
- Run results: the 4 changed TS test files pass 535/535, and `tests/test_venue_server_identity.py` passes 109/109.

## Critical Issues (round 2)

### CR-R2-01: The fix reddens 6 wizard-code invariant tests. CI's frontend shards fail.

**Files:**
- `src/app/api/keys/validate-and-encrypt/route.ts:248-253` and `src/app/api/strategies/create-with-key/route.ts:1295-1300`: the two new emitters.
- `src/lib/wizardErrors.invariant.test.ts`: the pins they break.
- `src/lib/wizardKeyRosters.ts:108`: `CREATE_WITH_KEY_OWN_CODES`.

**Issue:** Each new arm is a literal `NextResponse.json({ code: "KEY_MT5_WRONG_SERVER", ... }, { status: 400 })`, and the emitter scanner counts it. At `629de0d4c` neither route contained the string `KEY_MT5_WRONG_SERVER`: `git show 629de0d4c:<route> | grep -c` gives 0 for both, against 1 each at HEAD. `npx vitest run src/lib/wizardErrors.invariant.test.ts` fails these 6 tests:

1. `create-with-key: the site count is THIS ROUTE's hand-typed literal`: 14 sites against `expectedSites: 13` (`:279`).
2. `keys/validate-and-encrypt: the site count ...`: 15 against `expectedSites: 14` (`:515`).
3. `keys/validate-and-encrypt: every emitted code is admitted by THAT ROUTE's roster`: `KEY_MT5_WRONG_SERVER` is missing from `KNOWN_VALIDATE_AND_ENCRYPT_CODES` (`src/lib/wizardErrors.ts:6644`).
4. `the two KEY-VALIDATION routes emit the SAME set of codes`: `create-with-key` now emits a code that `composite/add-key` does not.
5. `the two SPLIT routes' emitted vocabulary is the hand-typed split set`: `EXPECTED_SPLIT_CODES` (`:988`) gained a member.
6. `create-with-key: the tuple is the route's contract` (`:2263`): `emittedButNotInTuple: ["KEY_MT5_WRONG_SERVER"]`.

The fixer ran only the changed test files, so it never saw these failures.

**Fix:** Each of these is a real contract change, so update each pin. Do not relax any of them.

1. Bump `expectedSites` to 14 (create-with-key) and 15 (validate-and-encrypt).
2. Add `"KEY_MT5_WRONG_SERVER"` to `CREATE_WITH_KEY_OWN_CODES` (`wizardKeyRosters.ts:108`).
3. Add it to `KNOWN_VALIDATE_AND_ENCRYPT_CODES` (`wizardErrors.ts:6644`), with a comment naming the founder ruling. This also fixes CR-R2-02.
4. Add it to `EXPECTED_SPLIT_CODES`.
5. Add it to `MIRROR_EXEMPT` (`:1338`) with a dated note. `composite/add-key` refuses MT5 outright with `COMPOSITE_MT5_UNSUPPORTED`, so it structurally cannot emit this code. That is the same reasoning as the existing `COMPOSITE_MT5_UNSUPPORTED` row, and the law above it requires exactly one side to emit an exempt code.

Then run the whole `src/lib/` invariant and roster-render set, not only the route files.

### CR-R2-02: On the validate-and-encrypt forms, "no server" renders as the UNKNOWN card with a Retry that cannot work

**Files:**
- `src/app/api/keys/validate-and-encrypt/route.ts:248-253`: the emitter.
- `src/lib/wizardErrors.ts:6768-6829` (`recogniseValidateAndEncryptCode`) and `:6644` (the roster): the reader.
- `src/components/exchanges/AllocatorExchangeManager.tsx:1522-1538` and `src/components/strategy/StrategyForm.tsx:206-229`: the renderers.

**Issue:** This is user-facing and separate from the CI red. `recogniseValidateAndEncryptCode({ code: "KEY_MT5_WRONG_SERVER" }, 400)` falls through every arm:

- It is not a key of the alias table.
- It is not a `VENUE_WIRE_CODE_TO_VERDICT` row. `MT5_WRONG_SERVER` is deliberately exempt there (`wizardErrors.ts:5521-5524`), because the classifier cascade reaches it instead, and this route has no classifier call.
- It is not in `KNOWN_VALIDATE_AND_ENCRYPT_CODES`.

So the reader returns `{ UNKNOWN, recognised: false }`, and both dashboard forms render the UNKNOWN shell: "Try the last action again", with a Retry control and the curated cause "MT5 broker server is invalid". Retrying sends the same refused request. The ruling asks for the cause to be named, and this shows a generic fault card instead. The repo's own test proves it: `src/lib/wizardErrors.roster-render.test.tsx`, `validate-and-encrypt/KEY_MT5_WRONG_SERVER renders its own code, never the UNKNOWN card`, fails at HEAD.

`create-with-key` (the wizard) does not have this problem. `KNOWN_CREATE_WITH_KEY_CODES` includes `CLASSIFIER_RETURNED_CODES`, which includes `KEY_MT5_WRONG_SERVER` (`wizardKeyRosters.ts:76`), so `ConnectKeyStep` renders the code's own card. That route is red in CI only.

**Fix:** Add `KEY_MT5_WRONG_SERVER` to `KNOWN_VALIDATE_AND_ENCRYPT_CODES`, the same edit as CR-R2-01 step 3. The roster-render test then goes green, and it is the test that proves this fix.

## Info (round 2)

### IN-R2-01: The `KEY_MT5_WRONG_SERVER` copy claims a connection attempt that never ran

**File:** `src/lib/wizardErrors.ts:1946-1959`
The cause line reads "MT5 could not connect to the broker server name you entered". For a control-character-only or over-128 server, no probe ran. The fix lines (copy the exact server, watch for stray characters) are still the right remedy, and Python's blank-server path already maps to this code. Acceptable. A dedicated sentence would be more honest.

### IN-R2-02: Error precedence moved: an MT5 server over 512 characters now gets `KEY_MT5_WRONG_SERVER`, not `KEY_INPUT_TOO_LONG`

**File:** `src/app/api/strategies/create-with-key/route.ts:1295` runs before the 512 cap at `:1336`.
No test pins the old order, and both answers are 400s that refuse the key. Recorded only.

### IN-R2-03: Comments that the guard made stale

**Files:**
- `src/app/api/keys/validate-and-encrypt/route.ts:809-815`: "returns null for an over-length value rather than letting the CHECK refuse the insert".
- `src/app/api/strategies/create-with-key/route.ts:1507-1513`: "128 cap, blank is null".
- `src/lib/venue-identity.ts:27-30`: "the key matches as a wildcard".

At these sites an MT5 `venueServer` can no longer be null. Each comment should say the early guard makes null unreachable for MT5.

### IN-R2-04: The new Python test pins a guard that already existed, and its docstring overstates TS parity

**File:** `analytics-service/tests/test_venue_server_identity.py:62-75`
The blank-server check in `parse_mt5_credentials` (`services/mt5_validation.py:187-189`) predates this round, so the test adds a regression pin, not coverage of the fix. The docstring says "The TS connect routes refuse the same set". They refuse it with a different code: spaces and NBSP get `KEY_MISSING_REQUIRED_FIELD` from the `trim()`-based three-credential check, and only `\x1f` and over-128 values get `KEY_MT5_WRONG_SERVER`. Python does not refuse a server over 128 characters at all. That gap is harmless because Python never inserts a key.

### IN-R2-05: Existing server-less MT5 keys can still be put back into service by paths with no server check

**Files:** `create-with-key/route.ts` `handleReuseExistingKey` (returns before the new guard, `:1196`), the `reconnect_allocator_api_key` RPC (`AllocatorExchangeManager.tsx:1207`), and `keys/[id]/rotate-secret`.
None of these accepts a new key, so ruling part (a) is met. They only stop mattering once part (b), the coordinator-confirmed delete of existing server-less MT5 keys, has run. Recorded so that (b) is not skipped on the strength of (a).

### IN-R2-06: `loginIdentities` now returns a one-field object

**File:** `src/lib/departed-history.ts:136-180`
With `ambiguous` gone, the `{ identities }` wrapper is noise. Both callers (`:192` and `:229`) could take the `Map` directly. Cosmetic.

### IN-R2-07: The doc comment on `loginIdentities` still describes ambiguity as a separate output

**File:** `src/lib/departed-history.ts:119-135`
"(null for an AMBIGUOUS key)" is accurate. The rest of the block still describes the ambiguous path at length even though nothing reads it in TS now. Cosmetic.

---

_Round 2 reviewed: 2026-11-25_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

### Round 2 dispositions (2026-11-25)
- CR-R2-01 and CR-R2-02 are FIXED in `fix(225): admit KEY_MT5_WRONG_SERVER to the connect-route rosters`. The fix adds the code to `KNOWN_VALIDATE_AND_ENCRYPT_CODES`, `CREATE_WITH_KEY_OWN_CODES`, `EXPECTED_SPLIT_CODES` and `MIRROR_EXEMPT`, and moves the site counts 13->14 and 14->15. The invariant and roster-render suites are green.
- IN-R2-01..07 are Info, so they are recorded here only and not fixed. IN-R2-05 confirms that ruling (b), deleting the existing server-less MT5 key, must still run.
