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
