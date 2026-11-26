---
phase: 225-oneaccountonce-a-user-cannot-connect-the-same-exchange-accou
reviewed: 2026-11-25T11:15:04Z
round: 1
depth: standard
# Round 1 scope: PR-3 (plan 10, migration B), `git diff origin/main...HEAD -- . ':!.planning'` at e8d4d9991.
# Cross-file traces went past the diff where a finding needed them: the derive's identity gate
# (analytics-service/services/job_worker.py, allocator_equity_derive.py), the stamper
# (analytics-service/services/account_identity.py), commit_scenario_batch and swap_account_slot.
files_reviewed: 11
files_reviewed_list:
  - supabase/migrations/20261125083433_api_keys_venue_server_index.sql
  - supabase/migrations/down/20261125083433-rollback.sql
  - supabase/schema/functions/reconnect_allocator_api_key.sql
  - supabase/tests/test_api_keys_venue_identity_uniq.sql
  - supabase/tests/test_api_keys_account_identity.sql
  - scripts/accounttruth-census.mjs
  - src/__tests__/accounttruth-census.test.ts
  - scripts/mutation-floors.mjs
  - src/__tests__/gate-family-meta.test.ts
  - src/__tests__/mutation-runner-floors.test.ts
  - src/__tests__/mutation-annotation-parser.test.ts
findings:
  critical: 1
  warning: 1
  info: 6
  total: 8
  necessity: 0
status: issues_found
---

# Phase 225: Code Review Report, PR-3 (plan 10, migration B)

**Reviewed:** 2026-11-25T11:15:04Z
**Scope:** PR-3, `git diff origin/main...HEAD -- . ':!.planning'`, 11 files, one migration plus its rollback
**Depth:** standard. Cross-file traces where a finding needed them (listed in the frontmatter).
**Files Reviewed:** 11
**Status:** issues_found

## Summary

I read the change set against `225-10-PLAN.md` (must_haves, threat model T-225-31..35), `225-CONTEXT.md` (Q2, Q3, D-01, Deferred Ideas), the repo CLAUDE.md migration rules and the PR-2 contract it builds on. I read `$HOME/.claude/gsd-core/references/necessity-review.md` and applied it. No necessity finding survived the evidence rule.

There is **one BLOCKER and one MEDIUM**.

- **CR-01 (BLOCKER, data integrity, user-facing).** Migration B makes two LIVE same-owner keys on one MT5 login (on two servers) reachable for the first time. Every same-owner account-identity reader still groups by `(exchange, venue_account_id)` alone. The allocator derive's identity gate then sees two counted keys on one account and **refuses the owner's whole equity book**, with no end date. That is the exact state CONN-03 exists to admit. CONTEXT defers only the cross-user readers and calls login-only grouping "the safe direction". Refusing the whole book is not over-grouping, and nothing in the phase directory or the ROADMAP rules on it. Migrations apply to PROD on merge with no human stop, so this has to be decided **before** the merge.
- **WR-01 (MEDIUM, test gap on a user-facing path).** No arm pins the both-servers-equal leg of the reconnect wildcard. Once the backfill finishes this is the normal MT5 reconnect refusal. A mutation that drops it falls through to the index's 23505, which the client cannot map to the named copy, and every arm stays green.

### Verified clean (cited, not assumed)

- **Faithful re-base.** I diffed the reconnect body in migration B (`:89-157`) against `20260925120000_api_keys_account_identity.sql:674-747`. It differs only by the `v_venue_server TEXT` declaration, `venue_server` in the SELECT/INTO, the three-line comment and the one EXISTS line (`:139`). SECURITY DEFINER, `SET search_path = public, pg_temp`, the 42501 owner check, the idempotent `RETURN false`, the UPDATE and `history_inclusion = NULL` are byte-identical.
- **No later definition.** No migration after 20260925120000 redefines `reconnect_allocator_api_key`. Six files mention it. `20260927180000` names it only in a COMMENT string (`:538`). `20260422101911` and `20260810120000` are older.
- **ACL.** The REVOKE/GRANT pair (`:163-166`) is the 20260925120000 pair verbatim. The self-verify asserts authenticated EXECUTE, no anon EXECUTE and no PUBLIC EXECUTE (it reads `acldefault` when `proacl` is NULL), plus prosecdef, a pinned search_path and one overload.
- **Index DDL.** The name, both predicates and the `(COALESCE(venue_server, ''))` member match CONTEXT Q2 and RESEARCH F-3. The new key is strictly finer than the old one, so the build cannot fail on stored rows. DROP and CREATE run in one migration transaction, per the house invariant the migration header cites (Supabase wraps each migration; migration-reviewer invariant 14). I did not check the applier itself. The DROP's ACCESS EXCLUSIVE lock covers the gap, `lock_timeout` is 3s, and `DROP INDEX` without IF EXISTS fails loud on a missing index. `DROP INDEX` also drops the old COMMENT, and a new one is written.
- **Nothing infers the index by column list.** Every `onConflict`/`ON CONFLICT` in `src/`, `analytics-service/services`, `analytics-service/routers` and `supabase/migrations` targets another table. App code maps the index by NAME (`pgConstraintName`), and the name is unchanged (D-01).
- **No other gate pins the old shape.** Only the two gate files in scope name the index or the reconnect function among `supabase/tests/*.sql`.
- **Wildcard agreement.** Reconnect's `s.venue_server IS NULL OR v_venue_server IS NULL OR s.venue_server = v_venue_server` is `sameVenueServer` (`src/lib/venue-identity.ts:86-88`), `same_venue_server` (`account_identity.py:154`) and the `swap_account_slot` wildcard (`20261123180100:213`). Stored servers are normalised at every writer (`create_wizard_strategy`, `swap_account_slot`, `_mt5_session_server`), so raw equality is right.
- **Rollback.** The rollback body is byte-equal to 20260925120000 apart from its section header. It has a catalogue-only precondition (`indnkeyatts = 4`) and verify, warns that the coarser index can refuse, and documents the ledger row.
- **Data-dependence and snapshot.** I ran `node scripts/lint-migration-data-dependence.mjs` (`83 refusal(s), 83 allowlisted, 0 NEW`) and `npm run schema:functions:check` (`SQL function snapshot is current (142 functions)`). The migration's DO block reads `pg_catalog` only.
- **RECON find strings.** Each retargeted twin's `find` occurs exactly once in migration B. The header's copy of the server line starts `--   AND`, not `\n       AND`, so it does not count as a second occurrence.
- **Twins, traced by reading.**
  - 6s-null-null (NULLIF member), 6s-two-servers (`venue_server IS NULL` member), 6s-same-server (extra `AND venue_server IS NULL` conjunct), 6s-null-vs-set (`COALESCE(..., 'srv-a')`) and 6s-two-owners (an extra global index scoped to non-null servers): each keeps section 2 green and reddens its own arm first. The 6v arms and 6a-6f use distinct synthetic logins, so none of them trips these twins first.
  - RECON-server-other: its twin deletes the server line, so the login-only EXISTS refuses the reconnect and the arm goes RED on the refusal. RECON-server-null and RECON-server-keynull: with the wildcard leg mutated away, the EXISTS is false and the UPDATE reaches the index, which admits a null beside a set server. The reconnect returns true, so each arm goes RED.
  - Not run here, because the runner's `edit` steps rewrite migration files in place. "Every arm RED (identity ok)" and the 19/19 and 44/44 tallies come from 225-10-SUMMARY / the `mutation-floors.mjs` RAISED comment.
- **Census moves.** ARMS_FLOOR 1020 -> 1028 (+5, +3), `armsSeen`, `totalAnchored`, the per-file synthetic lines, and `stepsSeen`/`needles.length` +3 (the three RECON-server `edit` steps; the 6s twins are `sql` steps) are internally consistent. WAIVED_CEILING stays 0.

## Critical Issues

### CR-01 (BLOCKER, data integrity, user-facing): migration B admits a same-owner, same-login, two-server pair that the derive's identity gate refuses, so that owner's equity book is refused with no end

**File:** `supabase/migrations/20261125083433_api_keys_venue_server_index.sql:77-81` (the enabler). The readers it breaks:
- `analytics-service/services/allocator_equity_derive.py:428-492` (`account_identity_tokens`, login-only `pair = (exchange_key, venue_id.strip())` at `:472-477`)
- `analytics-service/services/job_worker.py:16245-16310` (`account_identity_collisions`) and `:17113-17185` (the derive's refusal)
- `src/lib/departed-history.ts:121-154` (`accountIdentityTokens`, login-only `pair` at `:149`)
- `supabase/schema/functions/commit_scenario_batch.sql:215-235` (`owner_keys` / `account_edges` join on `venue_norm` only)

**Issue:**
1. Before B, `api_keys_user_exchange_venue_account_uniq` made two live keys of one owner on one `(exchange, venue_account_id)` impossible. After B, two live MT5 keys of one owner on login L with servers `a` and `b` both stand. That is plan 10's must-have truth 2 and the point of CONN-03.
2. Neither key gets marked. The stamper's MT5 pre-check calls `_find_live_holder(..., after_index_refusal=False)` (`account_identity.py:840-844`). In fence mode `pick_same_account_holder` returns no holder for a different server, so the key is stamped, and the stamp clears any marker in the same write (`:847-850`). On the connect side, `validate-and-encrypt/route.ts:846` calls `pickSameAccountHolder(rows, venueServer, "fence")`, and `create-with-key/route.ts:328` takes the mode as an argument (I did not trace which mode each call site of that helper passes). The stamper path alone proves the state is reachable.
3. The derive loads `venue_account_id` and no `venue_server` (`job_worker.py:16827-16832`). `account_groups` (`allocator_equity_derive.py:384-425`) unions on markers only, so the two keys are two groups and both are counted (`job_worker.py:17049-17050`).
4. The identity gate then calls `account_identity_tokens(key_rows)`. It unions any two keys with the same `(exchange, venue_account_id)` and gives both keys one token (`:17125-17150`).
5. `account_identity_collisions` finds two counted keys on that token with open, overlapping intervals (`:16291-16304`). The derive then runs `_persist_refusal(ACCOUNT_IDENTITY_COLLISION)` and returns DONE (`:17151-17185`).

The book shows the "rebuilding" panel. Nothing clears it while both keys stay live, and the only way out is to disconnect one of two genuinely different accounts.

The TypeScript twin `accountIdentityTokens` and the `commit_scenario_batch` fingerprint group the same pair as one account. I traced those two only as far as their grouping, not to every consumer's on-screen effect. They are the same defect class and must move together with the Python helper (the three are declared twins: `commit_scenario_batch.sql:192-200`, `allocator_equity_derive.py:446-450`).

**Prior rulings.** CONTEXT Deferred Ideas (`225-CONTEXT.md:132`) defers "Server-qualifying the cross-user readers (`shared-account-partners.ts`, the fingerprint `venue_norm`) … Login-only grouping across two brokers over-groups, which is the safe direction". That ruling names cross-user readers and argues over-grouping is safe. The derive's identity gate does not over-group safely. It refuses the book. I grepped the phase directory, both earlier REVIEW files and ROADMAP's Phase 225 section for `ACCOUNT_IDENTITY_COLLISION`, `over-group`, `HOLDINGSTRUTH` and `account_identity_tokens`. Nothing records a decision on the same-owner derive gate. Gate A5 does not cover it either: it counts null servers and same-owner equal-login groups before the merge, and this state is created after it.

**Why it blocks this PR.** The merge applies B to TEST and then PROD with no human stop (CLAUDE.md, 2026-09-23 correction). From the first post-merge connect of a second server on an existing login, that owner's book is refused.

**Fix (pick one before merge):**
- (a) **Server-qualify the same-owner identity token in all three twins, in this PR or a PR that merges first.** The Python `account_identity_tokens`, the TS `accountIdentityTokens` and `commit_scenario_batch`'s `account_edges`/`reach` must move together. Every row type and select that feeds them must carry `venue_server`; the derive's `_load_keys` (`job_worker.py:16827-16832`) does not select it today. **The constraint the fix must hold: two keys whose servers are both set and different never share a token.**
  - ⚠️ A naive "union when `same_venue_server` holds" is WRONG. The fence wildcard is pairwise, but union-find (and the SQL `reach` recursion) is transitive. Take three keys of one owner on login L with servers `a`, `b` and NULL. The NULL key unions with both, so `a` and `b` share a token again and the refusal comes back. The NULL key need not be live: all three readers take EVERY key of the owner, and a key disconnected before the column existed keeps its login with no server.
  - So the fix must DEFINE what a null-server key joins when its login carries two or more set servers. One choice is that it joins none and stays its own unknown account. Another is that it joins only when exactly one set server exists on that login. Whichever is chosen, it must be identical in all three twins.
  - Required tests, each able to fail: (i) two live same-owner MT5 keys on one login and servers `a`/`b` compose with no ACCOUNT_IDENTITY_COLLISION; (ii) the same plus a third key on that login with a NULL server (live and disconnected variants) still composes, with `a` and `b` on different tokens; (iii) a NULL-server key beside a single set server still shares that key's token (today's conservative behaviour). The `commit_scenario_batch` change is a function re-base with a VAC-04 ack and its own SQL arm.
- (b) **Hold PR-3** until (a) ships, and record the hold in CONTEXT and the ROADMAP.

Recording a founder acceptance of a refused book instead is a scope decision for the orchestrator, not a fix.

**Not run.** I established CR-01's chain by reading the code at e8d4d9991. No derive, stamper or route test was executed for it.

## Warnings

### WR-01 (MEDIUM, test gap on a user-facing path): the both-servers-equal leg of the reconnect wildcard is not pinned, so losing the named refusal for stamped MT5 keys stays green

**File:** `supabase/tests/test_api_keys_account_identity.sql:1009-1012` (RECON fixture, both servers NULL), `:1108-1173` (the three RECON-server arms); body `supabase/migrations/20261125083433_api_keys_venue_server_index.sql:139`

**Issue:**
- Every RECON arm that expects `KEY_VENUE_ALREADY_CONNECTED` reaches the refusal through a NULL leg:
  - RECON-twin: both servers NULL (`:1010-1011`);
  - RECON-server-null: sibling NULL;
  - RECON-server-keynull: key NULL.
- No arm covers a disconnected key on `(L, 'srv-a')` beside a live sibling on `(L, 'srv-a')`, both stamped. Once the backfill completes (gate A5: no live MT5 key with a null server), that is the ordinary MT5 reconnect refusal.
- Take a mutation that drops only `OR s.venue_server = v_venue_server`. For that pair the EXISTS is false. The UPDATE then reaches the index and fails 23505 with the INDEX's message, which, as RECON-twin's own RED-UNDER note says (`:1021-1023`), the client cannot map to the named copy.
- Under that mutation every current arm still passes. RECON-server-other wants no refusal, and the three refusing arms each match through a NULL leg.

**Fix:** add one arm after RECON-server-keynull on its own login. Then move ARMS_FLOOR, `armsSeen`, `totalAnchored`, `stepsSeen`, `needles.length` and the per-file synthetic line by the measured +1.
```sql
-- ----- RECON-server-same: a live sibling on the SAME server blocks by name ---------------
-- RED-UNDER: drop the equality leg from the server line in migration 20261125083433; the
--            UPDATE then reaches the index and fails 23505 with the index's message.
-- RED-UNDER-M: {"arm":"RECON-server-same","apply":[{"kind":"edit","file":"supabase/migrations/20261125083433_api_keys_venue_server_index.sql","find":"\n       AND (s.venue_server IS NULL OR v_venue_server IS NULL OR s.venue_server = v_venue_server)","replace":"\n       AND (s.venue_server IS NULL OR v_venue_server IS NULL)","occurrences":1}]}
-- fixture: (k_dis, uid_a, 'okx', ..., 'acct-identity-s4', 'srv-a', now()), (k_live, uid_a, 'okx', ..., 'acct-identity-s4', 'srv-a', NULL)
-- assert v_err = '23505' AND v_msg = 'KEY_VENUE_ALREADY_CONNECTED' AND the key stays disconnected
```

## Info

### IN-01: the re-based reconnect still claims the index backstops a race past its check, which is no longer true for the two wildcard legs

**File:** `supabase/migrations/20261125083433_api_keys_venue_server_index.sql:126-127` and the function COMMENT `:160`
**Issue:**
- "A concurrent race past this check still hits the index and raises the SAME SQLSTATE." That holds for equal-server and null-null pairs. For a null beside a set server, the index admits the pair: two concurrent reconnects of two disconnected same-login keys, one of them without a server, both pass the EXISTS and both land.
- Reachability is low. It needs a null-server key, and A5 counts live keys only. The app fences have the same accepted design limit (RESEARCH finding (a)).
**Fix:** correct the comment and COMMENT ("…for an equal or doubly-null server; the wildcard legs have no index backstop"). If a backstop is wanted, use a `pg_advisory_xact_lock` keyed on (uid, exchange, login).

### IN-02: the stamper's server backfill can now meet a 23505 that its docstring says only A5 would have caught

**File:** `analytics-service/services/account_identity.py:762-764` (outside the diff; B makes it reachable)
**Issue:** After B, a live `(L, NULL)` key beside a live `(L, 'srv')` key can exist (via the IN-01 race, or any fence race). Backfilling the NULL key to `'srv'` then raises 23505 and propagates to the boundary's ERROR line. The docstring says such a 23505 "would mean two live same-login same-server keys, which census gate A5 must have caught". After B it can also arise after A5 ran.
**Fix:** update the docstring. Optionally route a 23505 on the backfill into the existing holder look-up and marker path.

### IN-03: the new index COMMENT drops most of the 20260925120000 contract text

**File:** `supabase/migrations/20261125083433_api_keys_venue_server_index.sql:83-84`
**Issue:** `DROP INDEX` discarded the old COMMENT (`20260925120000:815-835`), so the new COMMENT is now the only in-database record. It omits why `sync_status = 'revoked'` is deliberately not in the predicate, the sFOX "UNKNOWABLE" note, and the reconnect-refuses-by-name contract.
**Fix:** carry the old text forward and append the Phase 225 sentences.

### IN-04: the rollback writes a new index COMMENT and not the one it is restoring

**File:** `supabase/migrations/down/20261125083433-rollback.sql:68-69`
**Issue:** After a rollback the index carries neither the 20260925120000 COMMENT nor the migration B COMMENT.
**Fix:** restore the 20260925120000 COMMENT text verbatim.

### IN-05: the census note describes a case the census cannot see

**File:** `scripts/accounttruth-census.mjs:141-147`
**Issue:**
- The note says "a marker whose holder sits on ANOTHER server still reads as marked against a live holder". The census does not select `venue_server`. A marked key's own server is NULL (cleared by `swap_account_slot` step (c)) or unknown, so the census cannot tell this case from a real same-account marker.
- Plan 10 calls the login-level test "the conservative side". For `live_keys_unstamped_unmarked` it errs toward reading "resolved", which is the lenient direction, until the key's next poll restamps it.
**Fix:** reword the note to say the census cannot distinguish the case and that it can under-report the bucket until the next poll.

### IN-06: 6s-same-server's constraint-name assertion under the 6s-two-owners twin depends on index OID order

**File:** `supabase/tests/test_api_keys_venue_identity_uniq.sql:1125` (twin) and `:1073-1100` (6s-same-server)
**Issue:**
- Under the 6s-two-owners twin, both the identity index and the added global index refuse 6s-same-server's second insert. The reported `CONSTRAINT_NAME` is that of the first index checked, in OID order.
- It is the identity index today only because the twin's index is created after migration B. The arm is "identity ok" by that ordering and by nothing in the arm.
**Fix:** none required. Note the coupling in the arm's RED-UNDER comment, or scope the twin's index to a predicate that 6s-same-server's rows do not meet.

---

_Reviewed: 2026-11-25T11:15:04Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

## Silent-failure hunter, round 1 (2026-11-25)

Ran in parallel with this review. No CRITICAL or HIGH. MEDIUM findings:

- **SF-M1:** no arm covers the equal-server leg of the reconnect wildcard. This is the same gap as WR-01.
- **SF-M2:** the rollback is atomic only under `psql --single-transaction`. Without that flag, `DROP INDEX` autocommits, and a failed rebuild leaves `api_keys` with no identity index.

LOW findings, recorded here only:

- the self-verify is partly tautological;
- the census note is unpinned by any fixture with a set server;
- the rollback header does not warn about the VAC-04/VAC-08 drift a rollback causes;
- the refusal text for an unstamped key reads the same as for a true duplicate.

## Orchestrator dispositions (2026-11-25)

| Finding | Disposition |
|---------|-------------|
| CR-01 | **HELD for a founder decision. PR-3 does not open.** Confirmed by measurement. A scratch pytest against the real `account_identity_tokens` and `account_identity_collisions` gave two unmarked live MT5 keys, with the same login on `srv-a` and `srv-b`, one token (`account:a` for both) and `AccountIdentityCollision(n_keys=2)`. So after migration B such an owner's derive refuses with ACCOUNT_IDENTITY_COLLISION. Before B, the same connect is refused by name at the login-only index. No decided rule covers how a NULL-server key groups when its login has two or more set servers: `same_venue_server` is pairwise and grouping is transitive. That rule is needed before the three readers can be made server-aware: the Python token, the TS `accountIdentityTokens` and the SQL `commit_scenario_batch` `account_edges`. PROD sizing, read-only, marker first: 0 owner/exchange/login groups with two or more distinct set servers; 1 of 12 MT5 keys has a NULL server, and it is disconnected. |
| WR-01 / SF-M1 | Fixed in 817e6f00b (`RECON-server-same`, with a twin; `ARMS_FLOOR` 1028 -> 1029). |
| SF-M2 | Fixed in 2fbe7cc5d (the rollback now carries its own `BEGIN; ... COMMIT;`). |
| IN-01..IN-06 and the SF LOWs | Recorded only (LOW/Info are never fixed). |
