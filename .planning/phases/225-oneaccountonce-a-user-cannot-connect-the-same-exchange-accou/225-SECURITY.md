---
phase: "225"
slug: "oneaccountonce"
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
block_on: high
created: "2026-11-27"
verified_at_sha: 8567885d5
---

# Phase 225 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> Produced retroactively by `/gsd-secure-phase 225` on 2026-11-27, after the phase closed. The run was State B: every plan carried a `<threat_model>`, so the register is the plans' own (74 threats, T-225-01 to T-225-74, plus the supply-chain row T-225-SC that each of the 21 plans repeats).
> Verdict: **SECURED.** 72 of 74 are closed. Two are open below the `high` block threshold, so they do not block (see below). Evidence was read at origin/main `8567885d5` by the gsd-security-auditor, at ASVS L1 and grep depth. No database or Docker was used.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| browser -> connect routes (`/api/keys/validate-and-encrypt`, `/api/strategies/create-with-key`) | untrusted credentials, session id and broker-server text | exchange keys, MT5 login, investor password, server |
| route (service role) -> `api_keys`, `swap_account_slot` | crosses RLS by design; the owner filter is the tenant boundary, and the function re-checks every fact itself | key ids, owner id |
| browser (authenticated) -> PostgREST / `api_keys` | column allowlist plus owner-only RLS; must never reach `create_wizard_strategy` or `swap_account_slot` | `venue_server` (owner read only, never write) |
| authenticated -> SECURITY DEFINER RPCs (`commit_scenario_batch`, `reconnect_allocator_api_key`) | scope proved equal to `auth.uid()` | owner's keys and strategies |
| MT5 terminal -> validation probe and poll reads | `account_info()` comes from another process that may hold another broker's session on the same login; its `login` and `server` are untrusted | account numbers, balances, deals |
| service-role worker / stamper -> `api_keys`, derived tables | every read scoped by `user_id`; what a poll stamps becomes this key's numbers | identity tokens, equity, holdings |
| logs / Sentry / tracked SUMMARYs (public repo) | operator- and public-visible text: no login, server, password, key id or PROD id | counts, static messages, synthetic labels |
| merge -> TEST -> PROD migration lane | auto-applies with no human stop, so every review happens before merge | migrations A1, A2, the grant, B, the `commit_scenario_batch` re-base |
| orchestrator MCP session -> PROD | one destructive ONCE-03 delete, run as the owner; the other reads are read-only and record counts only | owners' duplicate keys |

---

## Threat Register

Mitigation is the plan's own text. Evidence is what the 2026-11-27 audit found at HEAD.

| Threat ID | Plan | Category | Component | Severity | Disposition | Mitigation | Evidence | Status |
|-----------|------|----------|-----------|----------|-------------|------------|----------|--------|
| T-225-01 | 01 | Elevation of privilege | create_wizard_strategy DROP + CREATE | high | mitigate | REVOKE ALL FROM PUBLIC, anon, authenticated and GRANT EXECUTE TO service_role in the same migration; catalogue self-verify; gate arm 4 and assertion 5h (plan 03) pin the ACL | `20261123180000_api_keys_venue_server.sql` REVOKE/GRANT pair and catalogue verify; arm `4` RED-UNDER-M twin in `test_api_keys_venue_identity_uniq.sql`; assertion 5h in `test_api_keys_exchange_not_user_writable.sql` | closed |
| T-225-02 | 01 | Information disclosure | api_keys.venue_server | low | mitigate | no column grant to authenticated; not added to API_KEY_USER_COLUMNS_ARR; arm `6v-no-grant` and the sec-005 assertion pin it | Superseded by plan 13 / T-225-39 (founder "Owner-only read", CONTEXT Q6): `venue_server` is now in `API_KEY_USER_COLUMNS_ARR` (`src/lib/constants.ts`, pinned by `sec-005-api-keys-projection.test.ts`); no INSERT/UPDATE grant (self-verify in `20261125132334`, arm `6v-no-grant`) | closed |
| T-225-03 | 01 | Denial of service | migration apply on TEST/PROD | medium | mitigate | catalogue-only verify, no data-reading DO block (linter 0 NEW), SET LOCAL lock_timeout 3s; DEFAULT NULL keeps every current caller resolving | `SET LOCAL lock_timeout = '3s'`; `p_venue_server` DEFAULT NULL; catalogue-only verify; linter 0 NEW (225-01-SUMMARY) | closed |
| T-225-04 | 02 | Tampering | delete.sql on the wrong database | high | mitigate | marker query first (README step 1) and again inside the transaction against the pasted expected marker | `docs/runbooks/oneaccountonce/delete.sql` `[A-marker]` check against the pasted marker; README step 1 marker query first | closed |
| T-225-05 | 02 | Tampering | cascade into another owner's rows (portfolio, favourites) | high | mitigate | pg_constraint-driven off-manifest count before any write; pg_stat_xact check before COMMIT; both proven by abort arms | `delete.sql` `[F-off-manifest]` (pg_constraint-driven, vacuity guard) and `[H-pre-write]`/`[H-post-write]`; abort arms in `src/__tests__/oneaccountonce-delete-sql-exec.test.ts` | closed |
| T-225-06 | 02 | Elevation of privilege | bypassing the published-composite delete guard | high | mitigate | the GDPR sanitize bypass is never set (acceptance gate counts the name in delete.sql); deletes run under SET LOCAL ROLE authenticated with the owner's claims | `sanitize_in_progress` appears 0 times in `delete.sql`; deletes run under `SET LOCAL ROLE authenticated` with the owner's claims | closed |
| T-225-07 | 02 | Repudiation | an unrecorded destructive act on PROD | medium | mitigate | before and after census outputs recorded verbatim in the SUMMARY; one transaction, so the run either happened whole or not at all | one `BEGIN ... COMMIT`; before/after censuses recorded (counts only) in 225-02-SUMMARY | closed |
| T-225-08 | 02 | Information disclosure | ids or marker text committed to the public repo | medium | mitigate | placeholder tokens only; the acceptance gate refuses any uuid in delete.sql; the SUMMARY records counts only | placeholder tokens only; no uuid- or e-mail-shaped strings in the runbook or any 225 SUMMARY | closed |
| T-225-09 | 03 | Elevation of privilege | create_wizard_strategy ACL after the signature change | high | mitigate | assertion 5h and Part 3a-2b move to the 13-type signature and keep their twins biting, so a re-grant to authenticated fails CI | assertion 5h on the 13-type signature; Part 3a-2b 13-type twin in `test_wizard_composite_fence.sql`; 0 twelve-type pins left (225-03-SUMMARY) | closed |
| T-225-10 | 04 | Elevation of privilege | cross-tenant slot takeover | high | mitigate | same-owner asserted inside the function (SWAP-owner arm); EXECUTE only to service_role (SWAP-acl arm); the marker trigger refuses a cross-owner holder as a second line | `20261123180100_swap_account_slot.sql` `ACCOUNT_SLOT_NOT_SAME_OWNER`, service_role-only ACL, SECURITY DEFINER + pinned search_path; arms `SWAP-owner`, `SWAP-acl` | closed |
| T-225-11 | 04 | Tampering | a swap that trusts the caller's "failing" read | medium | mitigate | D-18 evaluated inside the function on locked rows (SWAP-holder-working, SWAP-new-failing, SWAP-inactive-holder arms) | D-18 evaluated on rows locked FOR UPDATE inside the function; arms `SWAP-holder-working`, `SWAP-new-failing`, `SWAP-inactive-holder` | closed |
| T-225-12 | 04 | Information disclosure | identity in error text | low | mitigate | token messages and static DETAIL sentences carry no login or server | bare tokens with static DETAIL; no login/server interpolation | closed |
| T-225-13 | 04 | Denial of service | lock contention on api_keys | low | accept | two rows locked for the duration of a four-statement function; SET LOCAL lock_timeout 3s on the migration | accepted (see log) | closed |
| T-225-14 | 05 | Information disclosure | refusal body naming a draft | medium | mitigate | the draft read is owner-scoped (RLS plus the user_id filter); the builder takes only the caller's own draft name, no identity parameter; tests assert the login and uid are absent | `venueDraftInProgressResponse(draftName)` takes only the draft name; draft read owner-scoped (`create-with-key/route.ts`) | closed |
| T-225-15 | 05 | Tampering | silent drop of a user's credential | medium | mitigate | the two silent arms now refuse by name; the new key is never stored on this path and the user is told | `VENUE_DRAFT_IN_PROGRESS` / `KEY_ORPHANED` refusals; never-silent-deduped arm shown RED (225-05-SUMMARY) | closed |
| T-225-16 | 06 | Information disclosure | readLiveSameLoginKeys on the admin client | high | mitigate | the user_id filter is mandatory in the helper's signature and pinned by a test; a cross-owner row can never be returned, so no other tenant's key is ever named or swapped (Q3: no cross-owner marker) | `readLiveSameLoginKeys` takes a mandatory `userId` and filters on it (`src/lib/venue-identity.ts`); pinned in `venue-identity.test.ts` | closed |
| T-225-17 | 06 | Tampering | swapAccountSlot called on a key of another owner | high | mitigate | the RPC refuses ACCOUNT_SLOT_NOT_SAME_OWNER (plan 04 arm SWAP-owner); the helper only forwards ids the caller read under its own owner filter | `swapAccountSlot` forwards owner-filtered ids; RPC refuses `ACCOUNT_SLOT_NOT_SAME_OWNER` | closed |
| T-225-18 | 06 | Information disclosure | audit metadata and logs | medium | mitigate | metadata is venue + holder key id only; no login, server or user id; the helper never logs the raw error | `afterSlotSwap` audit metadata `{venue, holder_api_key_id}` only; only the error code is logged | closed |
| T-225-19 | 07 | Elevation of privilege | admission path taking a slot with unproven credentials | high | mitigate | the admission runs only after validateKey succeeds, and the swap re-checks D-18 on the new key (ACCOUNT_SLOT_NEW_KEY_NOT_WORKING) | `validateKey` precedes the holder read and the swap in `validate-and-encrypt/route.ts`; RPC re-checks `ACCOUNT_SLOT_NEW_KEY_NOT_WORKING` | closed |
| T-225-20 | 07 | Tampering | crafted server text to dodge the refusal | medium | mitigate | the server is normalised (trim, lower-case, cap) and a null server is a wildcard; the index is the backstop for equal servers | `normaliseConnectedVenueServer` (trim, lower-case, 128 cap); `pickSameAccountHolder` null-is-wildcard; index backstop | closed |
| T-225-21 | 07 | Information disclosure | login or server echoed by a PostgREST error | medium | mitigate | venueServer joins every scrubSeamError secrets array; tests assert neither value is in a response or a log line | `venueServer` in every secrets array of `validate-and-encrypt/route.ts`; errors through `scrubSeamError` | closed |
| T-225-23 | 08 | Spoofing | naming or swapping another owner's key | high | mitigate | the read is filtered by the caller's user_id (pinned by the cross-owner tests); the swap refuses ACCOUNT_SLOT_NOT_SAME_OWNER | same owner filter in validate-and-encrypt | closed |
| T-225-24 | 08 | Elevation of privilege | a failing-holder admission with unproven credentials | high | mitigate | the admission runs only after validateKey succeeds; the swap re-checks D-18 on the new key | `validateKey` before `swapAccountSlot` in both routes; create-with-key re-derives the failing holder after validation | closed |
| T-225-25 | 08 | Information disclosure | login or server in a log or body | medium | mitigate | venueServer joins every secrets array; tests assert neither value appears | `venueServer` in every create-with-key secrets array | closed |
| T-225-26 | 08 | Information disclosure | card sentence content | low | accept | the sentence names only the owner's own holder label from the owner's own key list (T-167.1.2-17 rule unchanged) | accepted (see log) | closed |
| T-225-27 | 09 | Tampering | slot moved to a key that is not working | high | mitigate | the swap runs only when working_holder_predicate(key) is True, and the RPC re-checks D-18 (ACCOUNT_SLOT_NEW_KEY_NOT_WORKING) | `account_identity.py` swaps only when `working_holder_predicate` holds for the key and not the holder; predicate imported, not copied; RPC re-checks D-18 | closed |
| T-225-28 | 09 | Spoofing | a holder of another owner | high | mitigate | the holder read keeps the user_id filter (asserted in the tracer test); the RPC refuses ACCOUNT_SLOT_NOT_SAME_OWNER | `_find_live_holder` filters `user_id`; asserted in `test_account_identity_stamper.py` | closed |
| T-225-31 | 10 | Tampering | index rebuild on a live table | high | mitigate | one transaction, lock_timeout 3s, strictly finer key so no stored row can violate it; gate A5 first; migration-reviewer clean before merge | `20261126140500_api_keys_venue_server_index.sql` lock_timeout 3s, DROP+CREATE in one wrap, verify of attributes/expression/predicate; gate-A5 census; migration-reviewer clean (225-REVIEW-PR3, PR3-R2) | closed |
| T-225-32 | 10 | Elevation of privilege | reconnect re-base dropping its ACL or search_path | high | mitigate | CREATE OR REPLACE on the same signature, ACL pair re-issued verbatim, self-verify asserts prosecdef, proconfig and ACL; rls-policy-auditor clean before merge | `reconnect_allocator_api_key` SECURITY DEFINER, pinned search_path, ACL re-issued and verified; rls-policy-auditor clean (225-REVIEW-PR3-R2) | closed |
| T-225-33 | 10 | Spoofing | reconnect EXISTS reaching another owner | medium | mitigate | the s.user_id = v_uid line is unchanged and RECON-tenant keeps biting against B | `AND s.user_id = v_uid` kept; arm `RECON-tenant` with twin | closed |
| T-225-34 | 10 | Denial of service | migration refusing on TEST and blocking PROD | medium | mitigate | catalogue-only self-verify, no data-reading DO guard (linter run in Task 1) | catalogue-only self-verify; linter 0 NEW (225-19-SUMMARY) | closed |
| T-225-35 | 10 | Information disclosure | census results in a tracked file | medium | mitigate | counts and cause classes only; no ids, logins, servers or emails | counts only in SUMMARYs | closed |
| T-225-22 | 11 | Spoofing | naming or swapping another owner's key | high | mitigate | the read is filtered by the caller's user_id (pinned by the ONCE-02 cases); the swap refuses ACCOUNT_SLOT_NOT_SAME_OWNER | create-with-key same-login read and composite-dependent read carry `userId`; swap refusal from the RPC | closed |
| T-225-36 | 11 | Tampering | a second slot holder slipping past the index after plan 10 | high | mitigate | the post-validation resolve refuses a working held holder before the write, so a null-server holder is never left to an index that no longer collides with it | create-with-key post-validation resolve refuses `held`/`connected`/`orphaned`/`draft` before any write; validate-and-encrypt refuses a working holder before insert | closed |
| T-225-29 | 12 | Tampering | a server backfilled from a different login's session | medium | mitigate | the backfill runs only when the session login equals the stored login, guarded by venue_server null | `_backfill_mt5_server` guarded by login equality, `venue_server IS NULL` and the stored login; `test_a_backfill_never_uses_a_session_of_another_login` | closed |
| T-225-30 | 12 | Information disclosure | login or server in a log | medium | mitigate | tokens and classes only; caplog tests assert both values are absent | log lines carry ids and tokens only; caplog tests `test_the_mt5_login_never_reaches_the_log`, `test_neither_the_mt5_login_nor_the_server_reaches_the_log` | closed |
| T-225-37 | 12 | Spoofing | the MT5 pre-check reaching another owner's key | high | mitigate | the pre-check reuses plan 09's user_id-filtered lookup; the ONCE-04 case asserts the filter | stamper MT5 pre-check uses the owner-filtered `_find_live_holder`; `test_two_owners_keys_on_one_mt5_login_each_stamp_their_own_identity` | closed |
| T-225-38 | 12 | Tampering | a census that writes | medium | mitigate | the verify command refuses any write or DDL keyword outside a comment in census.sql | `docs/runbooks/venue-server-backfill/census.sql` has 0 write keywords outside comments (re-measured at audit) | closed |
| T-225-39 | 13 | Information disclosure | GRANT SELECT (venue_server) to authenticated | low | mitigate | column grant only; RLS limits rows to the owner (unchanged); arm 6v-owner-read pins the grant and 6v-no-grant pins anon-nothing; rls-policy-auditor and migration-reviewer clean at MEDIUM+ before merge; founder decision recorded in Task 1 | `20261125132334` column grant only; arm `6v-owner-read` with twin; founder decision recorded (225-13-SUMMARY). Record gap: no written migration-reviewer verdict for this grant (low) | closed |
| T-225-40 | 13 | Tampering | a browser role writing venue_server | medium | mitigate | no INSERT/UPDATE grant; self-verify asserts both false; arm 6v-no-grant bites under a live GRANT UPDATE twin | self-verify refuses INSERT/UPDATE for authenticated and any anon privilege; arm `6v-no-grant` with a `GRANT UPDATE` twin | closed |
| T-225-41 | 13 | Denial of service | code selecting venue_server before the GRANT is on PROD | high | mitigate | this plan ships alone as PR-2b-1; plans 15-17 carry a precondition and a pre-merge checkpoint that read the PROD grant first | PR-2b-1 merged alone (v0.133.77.0) before PR-2b-2 (v0.133.79.0); PROD apply recorded in v0.133.77.1; grant present in `supabase/schema/baseline.sql` | closed |
| T-225-42 | 13 | Denial of service | migration refusing on TEST and blocking PROD | medium | mitigate | catalogue-only self-verify, no data-reading DO guard; linter run in Task 2 | catalogue-only verify; linter 0 NEW | closed |
| T-225-43 | 14 | Tampering | account_identity_tokens merging two accounts (double count, or the CR-01 refused book) | high | mitigate | canonical (exchange, login, server) identity, never a pairwise wildcard; hand-typed shared fixture replayed in both orders; end-to-end derive test RED under the login-only key | `allocator_equity_derive.py` `_login_identities` / `account_identity_tokens` key on `(exchange, login, server)`; shared fixture `tests/fixtures/venue_server_identity.json` | closed |
| T-225-44 | 14 | Information disclosure | the ambiguity refusal log and Sentry event | medium | mitigate | token, allocator id and a count only; one static Sentry message per token, as the collision arm | `job_worker.py` refusal: one static Sentry message; log carries token, allocator id and a count only | closed |
| T-225-45 | 14 | Denial of service | an owner's book refused by account_server_ambiguous | medium | accept | PROD has 0 such owners (dispositions 2026-11-25; re-measured in plan 17 Task 3 before merge); the reader line is true and its contact-form action works; exits documented in the objective | accepted (see log) | closed |
| T-225-46 | 14 | Tampering | a select that silently drops venue_server (CR-01 step 3) | high | mitigate | projecting fakes in the derive and scorer tests, RED when the column is dropped | derive key select reads `venue_server` (asserted in `test_derive_allocator_equity_job.py`); scorer select asserted in `test_match_portfolio_aum_per_key.py` | closed |
| T-225-47 | 15 | Information disclosure | venue_server in the owner's key payloads | low | accept | founder: the server is not a credential (CONTEXT Q2) and plan 13 Task 1 records the grant decision; RLS keeps rows owner-only; the key card renders nothing new | accepted (see log) | closed |
| T-225-48 | 15 | Denial of service | code selecting venue_server before the PROD grant (42501 on every key list) | high | mitigate | Task 2 precondition; PR-2b-2 merges only after plan 17 Task 3 reads the PROD grant | ordering evidenced by the CHANGELOG (grant applied in v0.133.77.1 before v0.133.79.0) and the PROD baseline; the plan 17 Task 3 checkpoint read itself is unrecorded | closed |
| T-225-49 | 15 | Tampering | the TS twin drifting from Python or SQL | high | mitigate | one hand-typed fixture replayed by both runtimes in both orders; plan 16's parity test binds TS to the SQL recompute | one fixture replayed by both runtimes; `src/lib/fingerprint-venue-server-parity.test.ts` binds TS to the SQL `PARITY-FINGERPRINT` literals | closed |
| T-225-50 | 15 | Denial of service | the strict zod schema dropping every key row that carries the new column | high | mitigate | Task 2 adds the field to ApiKey and the schema together; the runtime-guard neuter proves the drop | `venue_server` in the `ApiKey` type, zod schema and projection; pinned in `src/__tests__/api-key-runtime-guard.test.ts` | closed |
| T-225-51 | 16 | Elevation of privilege | re-base dropping SECURITY DEFINER, search_path or the ACL | high | mitigate | CREATE OR REPLACE on the same signature, ACL pair re-issued verbatim, self-verify asserts prosecdef, proconfig and ACL; acceptance guard on SECURITY DEFINER; rls-policy-auditor clean before merge | `20261125151936_commit_scenario_batch_venue_server_identity.sql` SECURITY DEFINER, pinned search_path, ACL pair, self-verify | closed |
| T-225-52 | 16 | Information disclosure | the identity CTEs reaching another owner's keys | high | mitigate | owner_keys keeps `WHERE k.user_id = p_allocator_id` unchanged; login_servers is computed from owner_keys only | `WHERE k.user_id = p_allocator_id`; `login_servers` computed from `owner_keys` only | closed |
| T-225-53 | 16 | Denial of service | TEST apply refused, blocking PROD | medium | mitigate | catalogue-only self-verify; data-dependence linter in Task 1 | catalogue-only verify; linter 0 NEW | closed |
| T-225-54 | 16 | Tampering | TS and SQL disagreeing, refusing commits | high | mitigate | PARITY-FINGERPRINT literals reproduced by the TS path in a test that goes RED when the TS rows lose venue_server | 12 `PARITY-FINGERPRINT` literals in the gate; TS test has a `dropServers` neuter and a name-match test | closed |
| T-225-55 | 17 | Tampering | existing fingerprint arms proving a superseded body | medium | mitigate | Task 1 re-points every twin; the runner proves each still bites | fingerprint twins re-pointed to `20261125151936` | closed |
| T-225-56 | 17 | Information disclosure | PROD census results in a tracked file | medium | mitigate | counts and booleans only | counts and booleans only in 225-17/225-19 SUMMARYs | closed |
| T-225-57 | 17 | Denial of service | the mixed deploy window changing a book | low | mitigate | Task 3 measures zero multi-server groups and zero ambiguous keys immediately before the merge | The "immediately before the PR-2b-2 merge" PROD read (plan 17 Task 3) was never recorded. The same counts were read later, in plan 19 Task 3 step 4 on 2026-11-26: 0 multi-server groups, 0 ambiguous keys. So the harm did not occur, but the wording of the mitigation is not met | open — below high threshold (non-blocking) |
| T-225-58 | 18 | Spoofing | a key stored with a server its session did not prove (a second live key on one real account after migration B) | high | mitigate | assert_expected_server in run_probe on both paths; tests (a)-(d); route tests pin that the stored server is the validated one | `assert_expected_server` in `mt5_probe.py`, called PRE and POST in `run_probe`, one snapshot per bracket; neuter turned 11 tests red (225-18-SUMMARY); short-circuit POST site pinned by the 2026-11-27 validation test (SF-M4) | closed |
| T-225-59 | 18 | Information disclosure | the server in an exception or log line | medium | mitigate | Mt5ServerMismatchError carries a fixed message and only the login int; no new log line names a server | `Mt5ServerMismatchError` uses a fixed message and keeps only the login int; the router logs a static line | closed |
| T-225-60 | 18 | Denial of service | the bracket refusing correct sessions | medium | mitigate | casefold-normalised compare (the pre-check's own normaliser); transient disposition, never a permanent blame. Plan 20's poll verdicts, through the same predicate and over every live server's keys, are the pre-merge evidence (Task 3 step 1); the post-deploy correct-server control in Task 3 is the proof, and a failed control reverts PR-2c | Code mitigations are present: the casefold normaliser and the transient disposition (`routers/exchange.py`). The post-deploy correct-server control on the VALIDATION path is not recorded: 225-18-SUMMARY says PASS in one place and "still not recorded" in another, and 225-VERIFICATION lists it as a pending human item. The poll path uses the same predicate and read 22 True / 0 refused over 11 of 11 keys on 2026-11-27 | open — below high threshold (non-blocking) |
| T-225-61 | 19 | Tampering | B applied before the readers are server-aware (CR-01 regression) | high | mitigate | Task 1's precondition requires plans 13, 16 and 18 on main; Task 3 reads the live bodies and the deploy SHAs before merge | 225-19-SUMMARY Task 3 record: live bodies and deploy SHAs read before merge | closed |
| T-225-62 | 19 | Repudiation | a backdated B gap-filled by `--include-all` | high | mitigate | Task 1 renames B to honest UTC; Task 3 compares it with the PROD ledger tip; the allowlist is never used | migration B renamed to `20261126140500`, later than the PROD ledger tip; allowlist never used | closed |
| T-225-63 | 19 | Denial of service | stale census floors hide a lost arm, or block CI | medium | mitigate | Task 2 sets every floor from `--parse-only` on the merged tree; WAIVED_CEILING stays 0 | `scripts/mutation-floors.mjs` floors set from `--parse-only` (225-19-SUMMARY); `WAIVED_CEILING` 0 | closed |
| T-225-64 | 19 | Information disclosure | PROD identifiers in the SUMMARY of a public repo | medium | mitigate | Task 3 records counts and verdicts only | counts and verdicts only | closed |
| T-225-69 | 19 | Spoofing | after B, a poll proving only the login reads the same login's account on another server and stamps it (PR-2c review WR-01) | medium | mitigate | Task 3 step 6b refuses PR-3 unless the poll-path server refusal is shipped on origin/main or booked with a named owner (plan 20 Task 3) | booked in 225-19-SUMMARY Task 3 step 6b with an owner; shipped by plan 21 | closed |
| T-225-65 | 20 | Information disclosure | the verdict line | medium | mitigate | static message; only site, `normalize_mt5_holder(holder)` and a three-valued verdict; Task 1's tests assert neither server (case-folded), nor the login, nor the password appears | `log_mt5_poll_server_verdict` (`mt5_read.py`) logs static text + site + holder + verdict only | closed |
| T-225-66 | 20 | Tampering | a verdict that changes what a poll returns or stamps, or raises into the balance read's swallow-all arm (which would silently drop a snapshot) | high | mitigate | the helper is total over every `server` shape; the read tests pin equal returns for True, False and not_captured at all three sites | helper total over every `server` shape and returns `info` unchanged; equal-returns tests in `test_mt5_read.py`, `test_mt5_sync_path.py` | closed |
| T-225-67 | 20 | Denial of service | PR-2c's bracket refusing correct sessions on a server whose spelling differs | high | mitigate | Task 3 measures every live server through the same predicate before PR-2c merges; False or not_captured stops PR-2c | plan 20 PROD read 2026-11-26: 28/28 True, 11/11 keys, 4/4 servers (225-18-SUMMARY, 225-VERIFICATION) | closed |
| T-225-68 | 20 | Spoofing | a poll reading another broker's account on the same login and stamping it (WR-01) | medium | transfer | log-only here by construction (the refusal type is PR-2c's); Task 3 books the follow-up owner, and plan 19 refuses PR-3 until it is shipped or booked | transfer documented at 225-20-SUMMARY `## Poll-path server enforcement: owner` (plan 21), and shipped | closed |
| T-225-70 | 21 | Spoofing | a poll reading another broker's account on the same login and stamping it as this key's (WR-01; closes T-225-68, which plan 20 transferred to this plan) | medium | mitigate | `assert_expected_server` after the login check at the four poll sites; four site tests, each RED with its own bracket neutered; PRE and POST isolated by the fake's second snapshot | `assert_expected_server` at all four poll sites (`mt5_read.py` PRE and POST, `job_worker.py`, `allocator_positions.py`); site tests in `test_mt5_read.py`, `test_mt5_derive_branch.py`, `test_mt5_sync_path.py` | closed |
| T-225-71 | 21 | Denial of service | the bracket refusing correct sessions on a broker that reports another name for an accepted server: derive `failed_final` with no stamp, holdings `sync_status='error'` (not working under D-18), no balance snapshot | high | mitigate | plan 20 measured 28 of 28 polls True over 11 of 11 keys and 4 of 4 servers through the same predicate; the casefold normaliser admits case and space differences; the verdict line stays beside the bracket so a refusal is attributed to its key; Task 3 reads one post-deploy cycle and any recurring refusal reverts this PR | casefold normaliser; ERROR line class + key id only; post-deploy read PASS 2026-11-27 (22 True, 0 False, 0 refused, 11/11 keys; 225-21-SUMMARY) | closed |
| T-225-72 | 21 | Denial of service | a bounded terminal restart per refused attempt on the one shared terminal (derive and holdings arms, inherited from the login-mismatch disposition), disturbing other keys' polls | medium | accept | inherited unchanged by the booked scope; restarts are bounded, a derive job retries at most `max_attempts` times and the holdings poll runs daily; Task 3 counts refusals, and each refusal is one restart | accepted (see log) | closed |
| T-225-73 | 21 | Information disclosure | a server value or login number in a refusal log line, `compute_jobs.error_message` or `api_keys.sync_error` | medium | mitigate | `Mt5ServerMismatchError`'s message is fixed and carries neither; `sync_error` is the fixed `MT5_UNREACHABLE_NOTE`; the site tests assert neither server (casefolded) nor the login digits appear in any record or message | fixed message without login or server; `sync_error` is the fixed `MT5_UNREACHABLE_NOTE`; `_assert_refused_poll_stored_nothing` in `test_mt5_derive_branch.py` | closed |
| T-225-74 | 21 | Tampering | a derive refusal message that a later classifier reads as a wrong-server or auth verdict, blaming the user's working credential | medium | mitigate | the derive site tests run `classify_mt5_login_error` over the error message and demand "transient" | `classify_mt5_login_error(...) == "transient"` asserted by the same helper | closed |
| T-225-SC | all 21 | Tampering | npm/pip/cargo installs | low | accept | none of the 21 plans installs a package | each plan states it; see log | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

### The two open threats below the threshold

- **T-225-60 (medium): the validation-path correct-server control is unrecorded.** The code mitigations are in place. Plan 18 Task 3's post-deploy positive control was supposed to send the same working account with the correct server and get the 409 already-connected answer. No record of that run exists: `225-18-SUMMARY.md` contradicts itself, and the stricter reading is the one used here. `225-VERIFICATION.md` carries it as a pending human item. The poll path runs the same `session_server_matches` predicate and read 22 True verdicts, with 0 refused, over 11 of 11 live keys on 2026-11-27. That same evidence is the grounds on which SF-M1 keeps the transient answer (see the Notes below). **Owner:** the founder's open human-verification item in `225-VERIFICATION.md`.
- **T-225-57 (low): the "immediately before merge" multi-server read is missing.** Plan 17 Task 3's PROD read was never recorded. The same two counts were read in plan 19 Task 3 step 4 on 2026-11-26: 0 multi-server groups and 0 ambiguous keys. The harm the read guarded against did not occur. It is recorded here only, because it is low and the event it guarded is in the past.

### Process-record gaps (code verified, record missing)

- T-225-39 (low): no migration-reviewer or rls-policy-auditor verdict is written down for plan 13's grant migration `20261125132334`. The code checks pass.
- T-225-41 and T-225-48 (high): plan 17 Task 3's PROD read of the grant before PR-2b-2 is unrecorded. These are closed on other evidence: the CHANGELOG shows the grant applied in v0.133.77.1, before v0.133.79.0, and `supabase/schema/baseline.sql` carries the grant.

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-225-13 | T-225-13 (accept) | two rows locked for the duration of a four-statement function; SET LOCAL lock_timeout 3s on the migration (plan 04) | plan 04 threat model | 2026-11 |
| AR-225-26 | T-225-26 (accept) | the sentence names only the owner's own holder label from the owner's own key list (T-167.1.2-17 rule unchanged) (plan 08) | plan 08 threat model | 2026-11 |
| AR-225-45 | T-225-45 (accept) | PROD has 0 such owners (dispositions 2026-11-25; re-measured in plan 17 Task 3 before merge); the reader line is true and its contact-form action works; exits documented in the objective (plan 14) | plan 14 threat model | 2026-11 |
| AR-225-47 | T-225-47 (accept) | founder: the server is not a credential (CONTEXT Q2) and plan 13 Task 1 records the grant decision; RLS keeps rows owner-only; the key card renders nothing new (plan 15) | plan 15 threat model | 2026-11 |
| AR-225-68 | T-225-68 (transfer) | log-only here by construction (the refusal type is PR-2c's); Task 3 books the follow-up owner, and plan 19 refuses PR-3 until it is shipped or booked (plan 20) | plan 20 threat model | 2026-11 |
| AR-225-72 | T-225-72 (accept) | inherited unchanged by the booked scope; restarts are bounded, a derive job retries at most `max_attempts` times and the holdings poll runs daily; Task 3 counts refusals, and each refusal is one restart (plan 21) | plan 21 threat model | 2026-11 |
| AR-225-SC | T-225-SC | no plan installs a package | each plan's threat model | 2026-11 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-11-27 | 74 | 72 | 2 (below threshold; 0 blocking) | gsd-security-auditor via /gsd-secure-phase 225, at origin/main 8567885d5 |

## Notes

- **Superseded mitigation.** T-225-02 was "no column grant to authenticated". Plan 13 (T-225-39) deliberately replaced it, on the founder's "Owner-only read" ruling of 2026-11-25 (CONTEXT Q6). The write and anon halves still hold.
- **Unregistered flags:** none. Every SUMMARY `## Threat Flags` section is "None" or maps to a registered id.
- **SF-M1 / SF-M4** (225-REVIEW-PR2C.md) are review findings, not register items. Their disposition is recorded in `225-VALIDATION.md` and in the CHANGELOG entry for this pass.

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-11-27

## Security Audit 2026-11-27

| Metric | Count |
|---|---|
| Threats found | 74 |
| Closed | 72 |
| Open | 2 |
