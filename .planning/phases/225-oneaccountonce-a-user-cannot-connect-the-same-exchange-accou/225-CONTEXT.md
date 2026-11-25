# Phase 225: ONEACCOUNTONCE — a user cannot connect the same exchange account more than once, and one account shared across users stays allowed - Context

**Gathered:** 2026-11-23
**Status:** Ready for planning

<domain>
## Phase Boundary

One user connects one exchange account once. A second key or draft under the same owner that reads an account the owner already holds is refused by name, in the wizard and in the API. Same-owner duplicates already stored are removed (founder ruling Q5, below). One key or account shared across several users stays fully supported, and each user keeps their own factsheet. The phase also owns seam S4's identity members:
- CONN-01: a connect that matches the user's own draft is refused by name, never a silent `200 deduped`.
- CONN-03: MT5 identity includes the broker server.
- MT5D-08: a failing MT5 key never holds an account's holder slot.

CONN-02 and CONN-04 belong to sibling Phase 228 KEYANSWERS, ordered after this one. Composites are out of scope (milestone ruling F-2).

Requirements: ONCE-01, ONCE-02, ONCE-03, ONCE-04, CONN-01, CONN-03, MT5D-08.

</domain>

<decisions>
## Implementation Decisions

### Carried forward from Phase 167.1.2 CONTEXT (archived at .planning/milestones/v1.20-phases/167.1.2-*/167.1.2-CONTEXT.md)
- D-01 (founder 2026-09-24, "Refuse a second key"): the refusal reuses the partial unique index `api_keys_user_exchange_venue_account_uniq`. No second index, because a duplicate index makes `pgConstraintName` ambiguous. The worker never disconnects or deletes a key on its own. Phase 225's Q5 ruling overrides the delete half, for same-owner duplicates only, as a one-time founder-confirmed operation (see the deviation record below).
- D-04: two members of one composite whose windows do not overlap are a key rotation (`composite_member`), not a duplicate. Unchanged. Composites are out of scope here.
- D-18 (founder 2026-09-27): a WORKING key is `is_active AND disconnected_at IS NULL AND (sync_status IS NULL OR sync_status NOT IN ('revoked','sign_in_failed','error'))`.
- D-23 (founder 2026-10-11, "Say so"): a key whose account matches one of the user's OWN unfinished drafts is refused with a message naming that draft ("finish or delete it first"). It is never a silent `deduped` that drops the new key. This is CONN-01. Out of scope: the same-wizard-session resume fence, which returns the caller's own session pair.
- D-25 (founder 2026-10-11, "Fix"): an MT5 key whose sign-in keeps failing never holds its account's holder slot; a working key on the same account takes it. This is MT5D-08.

### Failing holder vs the new refusal (Q1)
- Admit the working key. The founder's 2026-11-23 answer: "Admit working key (Recommended)".
  - When the live same-owner key that holds an account is NOT working (D-18), a newly connected working key for that account is admitted and takes the slot (`venue_account_id`).
  - The failing key gives up the slot and is marked `duplicate` pointing at the working key, and is named on its key card. Nothing is auto-disconnected.
  - When the holder IS working, the new key is refused by name.
  - **Reversibility:** costly. It sets which key the per-owner index and every reader of `venue_account_id` treat as the account. Undoing it means re-deciding holder rows and the connect contract.

### MT5 identity includes the broker server (Q2, CONN-03)
- Add a separate plaintext column. The founder's 2026-11-23 answer: "Separate server column (Recommended)".
  - The new nullable column is `api_keys.venue_server`, holding the normalised broker server text. `venue_account_id` stays the bare MT5 login.
  - Uniqueness moves to (user_id, exchange, venue_account_id, coalesce(venue_server, '')). The index keeps its name `api_keys_user_exchange_venue_account_uniq` and keeps both predicates: `venue_account_id IS NOT NULL` and live-only (`disconnected_at IS NULL`).
  - A key not yet backfilled matches on login alone, as today, so the half-done state errs toward refusing.
  - Connect routes write the server from the request. The daily poll, which already decrypts the credentials, backfills older keys.
  - The backfill uses no data-reading `DO` guard; `scripts/lint-migration-data-dependence.mjs` refuses one.
  - Rollout runs in steps through the one serial migration lane: column first, then the writers and the backfill, then the index change.
  - The server name is stored in plaintext. Founder: yes, it is not a credential.
  - **Reversibility:** one-way. It is a persisted column, a changed unique index and a backfill on a live table. A separate column was chosen over rewriting `venue_account_id` because 155.2's account check (`docs/runbooks/mt5-parity/capture-keymap.sql`, `mt5_parity_report.report_account_matches`) hashes the bare login stored in `venue_account_id`.

### What the share link between two users is (Q3, ONCE-02, ONCE-04)
- Same identity is the link. The founder's 2026-11-23 answer: "Same identity is the link (Recommended)".
  - For two different users, an equal stamped identity (same exchange, same `venue_account_id`, same server for MT5) IS the share link. `src/lib/discovery/shared-account-partners.ts` already reads it that way.
  - There is no cross-owner marker. The `ACCOUNT_SHARE_HOLDER_NOT_SAME_OWNER` refusal stays, with no tenant-boundary change.
  - ONCE-04 therefore means: every live key's identity is stamped, so a shared login is always visible. A test drives the stamping in `account_identity.py` for that case.
  - **Reversibility:** costly. A cross-owner marker later would be a tenant-boundary change needing RLS review.

### Composite add-key path (Q4)
- OUT of scope, under the founder's milestone ruling F-2 ("Forget about conposites").
  - `add_wizard_composite_key` keeps writing no identity, and composite duplicates stay mark-only.
  - No edit to `src/app/api/strategies/composite/add-key/route.ts` or to the composite RPC.

### Same login on two servers: two accounts (Q6, CONN-03, PR-3 review CR-01), founder ruling 2026-11-25
- **Why this came up.** Review finding CR-01 (`225-REVIEW-PR3.md`): once migration B admits one owner's same MT5 login on two servers, the same-owner identity readers still group keys by login alone, so that owner's allocator derive refuses with ACCOUNT_IDENTITY_COLLISION. The founder was asked through the coordinator's AskUserQuestion on 2026-11-25.
- **The founder's ruling, verbatim:** "same login different server should be possible, that can only happen, if two brokers offer for example the same login like 1234, but of course on different servers. on the same broker, where it would be a problem, the same login should not connect when the server is incorrect, thus the scenario witkh same login different server should eithe be refused, because same broker, and thus incorrect server, and thus, no ability to read out anything, or should be accepted, if different broker, and thus logically different server"
- **What it means, as the coordinator relayed it:**
  1. Two keys with the same login on two different set servers are two different accounts. They never share an identity token, in Python (`account_identity_tokens`), in TS (`accountIdentityTokens`) or in SQL (`commit_scenario_batch` `account_edges`).
  2. A connect on the same broker with the wrong server must be refused at connect or validation time, because it cannot read anything. The gap plans confirm by measurement that the existing validation already refuses it (the MT5 login fails against the wrong server; the MT5 venue API docs are read too), and close any path that lets it through.
- ⛔ **SUPERSEDED 2026-11-25 by the founder ruling below; kept as lineage.** **Agent decision under this ruling (the ruling does not cover a key with no server).** A key with no server joins its login's group only when that login has at most one distinct set server across the keys the reader sees. Otherwise the derive refuses with a named reason. Recommended by the phase agent and approved by the coordinator on 2026-11-25. It is marked here as an agent decision, not a founder quote.
- **No MT5 key without a server, founder ruling 2026-11-25 (replaces the agent decision above).** Asked through the coordinator's AskUserQuestion, because PR-2b-2's reviewers found that the agent decision blocks a whole book on a key the owner cannot fix. The founder's answer, verbatim: "Delete keys without Server, dont accept keys without Server".
  - **Meaning, as the coordinator relayed it, scoped to MT5.** `venue_server` is MT5's field. Bybit, Deribit and OKX keys have no server by design, and this ruling never touches a non-MT5 key.
    - (a) MT5 connect and validation, in both TS and Python, refuse an MT5 key with an empty server and name the cause. A new key without a server is then unreachable, so the ACCOUNT_SERVER_AMBIGUOUS machinery shrinks to what this ruling still needs.
    - (b) Existing MT5 keys without a server are deleted through the product's own key-delete path. The coordinator confirms the exact scope before any PROD delete, because the delete reaches a linked strategy as well as the key.
    - **(b) scope decided, founder 2026-11-25 (UTC), through the coordinator's AskUserQuestion.** The key: "I run the reviewed delete (Recommended)". Its private strategy: "Delete it too". Meaning: PROD holds exactly one such key, and it is deleted with the reviewed `docs/runbooks/oneaccountonce/delete.sql`, filled in the session scratchpad and never committed. The only change from the reviewed script is the `[B-discovery]` census predicate: every MT5 key with no server, in place of the same-owner duplicates. Its one private strategy and that strategy's dependent rows are deleted with it, and the owner's other 9 keys are protected and proved unchanged. The founder runs it, not the agent. This is a deviation from the standing keep-data rule, as Q5 was.
    - **(b) done, 2026-11-25.** The coordinator ran the filled script on PROD after reviewing the diff. The marker named PROD first, and the script ran as one MCP call that committed. Verified afterwards: 0 manifest keys and 0 manifest strategies remain. 0 MT5 keys without a server remain on PROD. The owner holds 9 keys (was 10) and 8 strategies (was 9). 0 holdings, 0 compute jobs and 0 daily returns remain for the deleted key and strategy. The recompose `derive_allocator_equity` job was created and has completed. Expected deletes, measured before the run: holdings 4, key 1, compute jobs 24, audit 1, strategy 1, daily returns 26, analytics series 11, analytics 1, verifications 1.
  - **Reversibility:** costly. A deleted key and its data cannot be restored.
- **Order.** These reader changes merge and deploy before migration B (PR-3).
- **Reversibility:** costly. It changes which keys every same-owner reader treats as one account.
- **Owners can read their own key's server (plan 13), founder ruling 2026-11-25.** Asked through the coordinator's AskUserQuestion. The founder's answer, verbatim: "Owner-only read (Recommended)". Meaning: SELECT on `api_keys.venue_server` is granted to `authenticated`, owner-only through the existing RLS, the same way `venue_account_id` is granted. This replaces plan 01's choice to leave the column ungranted, which had been a planning choice, not a founder ruling.

### Same-owner duplicates already stored (Q5, ONCE-03) — DEVIATION FROM THE STANDING DATA RULE
- The founder's answer, 2026-11-23, verbatim: "Delete all duplicate keys. So same key in one accused twice. Delete also all associated factsheet, data etc. One key can be used over several accounts. Imagine one team sharing the key if their master account with several allocator. Of course each allocator should be able to generate a factsheet"
- Meaning, as the orchestrator relayed it:
  - Same-owner duplicates are DELETED: one exchange account connected twice under one user, meaning the duplicate key plus its associated strategies, factsheets and derived data.
  - Cross-user sharing of one key or account stays fully supported, and each user (for example each allocator on a team's master account) keeps their own factsheet.
- **Deviation record.** This explicitly overrides the standing rule "keep data; disconnect, never delete" (founder memory) and the "never deletes" half of D-01, for same-owner duplicates only. The override is the founder's quote above, dated 2026-11-23. It is recorded here and in the ROADMAP `### Phase 225` section, per the deviation policy.
- How it runs:
  1. A read-only PROD census produces an exact deletion manifest. It lists:
     - every same-owner duplicate key, and whether it is same-owner;
     - its strategies and their published status;
     - row counts per dependent table;
     - confirmation that no cross-owner key and no holder key is in the set, and that the 155.2 holder keys (MM2 on k1, MM3 on k10, FX-AI_V on k3) are untouched.
  2. The founder confirms the permanent deletion before it runs.
  3. It runs once, through existing product paths or RPCs where they exist (for example `delete_allocator_api_key`). It respects the deletion-cascade guards (`quantalyze.sanitize_in_progress` where applicable) and never runs inside a migration's data-reading `DO` block.
- **Manifest confirmed (founder, 2026-11-23, AskUserQuestion "Yes, delete all (Recommended)"):**
  - Scope: exactly 13 same-owner duplicate keys (7 deribit, 1 mt5, 5 okx; all disconnected; 5 owners; no holder, no live key, no cross-owner key, none of 155.2's k1, k10 or k3) and the 2 strategies on them (1 published okx, 1 private mt5 on 155.2's k2), with all dependent rows.
  - Key dependents at census: allocator_holdings 2470, csv_daily_returns 1599, compute_jobs 99, api_key_nav_marks 28, mt5_server_clock_readings 11, key_permission_audit 9.
  - Strategy dependents at census: strategy_analytics 2, strategy_analytics_series 24, csv_daily_returns 272, trades 125, positions 9, position_snapshots 15, funding_fees 285, match_candidates 119, compute_jobs 57, reconciliation_reports 132, strategy_verifications 2.
  - The deletion step re-runs the census immediately before deleting. If the set differs in any way (more keys, a key now live or a holder, a 155.2 key appearing), it STOPS and reports instead of deleting. The SUMMARY records before and after counts verbatim.
  - Path: `delete_allocator_api_key(p_api_key_id, p_cascade_holdings => true)` per key, in the owner's context. Then the product's strategy-delete path for the 2 strategies, because `strategies.api_key_id` is ON DELETE SET NULL. Respect any cascade guards.
- Going forward: no strategy publishes another key's numbers under its own name, because the refusal (ONCE-01) stops new same-owner duplicates and the one-time deletion removes the stored ones.
- **Reversibility:** one-way. Permanent deletion of PROD rows.

### Decided autonomously
- [Tests] Q: 'How is the per-owner refusal tested?' → Selected: 'An exchange key and an MT5 login are each refused for the same owner, and a different-owner test proves the cross-user share still connects with the identity link intact' — tests only, cheap to change.
- [MT5D-08] Q: 'Where does the working-holder rule live?' → Selected: 'In the stamper holder lookup and the stamp or marker swap in analytics-service/services/account_identity.py, using the D-18 predicate' — internal code placement.
- [Refusal copy] Q: 'How is the refusal worded and coded?' → Selected: 'Follow the existing wizardErrors.ts code and copy patterns, naming the existing key or draft by exchange plus nickname' — copy and code live in one module and change in one edit.
- [Seam] Q: 'Which connect paths carry the per-owner refusal?' → Selected: 'create-with-key (wizard, draft arm included) and validate-and-encrypt (allocator Exchanges page); the composite path is excluded by Q4' — route-level code.

### Claude's Discretion
- How the census queries are shaped and in what order the deletion runs, within the confirmed manifest.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/app/api/strategies/create-with-key/route.ts`: `resolveByVenueIdentity` and the `VenueIdentityResolution` union (draft, connected, held, orphaned, unresolved). The `venueMatch.kind === "draft"` arms answer `deduped: true`, which CONN-01 rewrites.
- `src/app/api/keys/validate-and-encrypt/route.ts`: stamps `venue_account_id` and maps a 23505 naming the identity index to a named refusal.
- `analytics-service/services/account_identity.py`: `_stamp`, `_find_live_holder` (live only today, with no D-18 working filter), `_share_kind`, `_mark_shared`, `_write_marker_and_audit`.
- `analytics-service/services/mt5_validation.py`: `mt5_venue_account_id`, the one spelling of the MT5 login identity.
- `src/lib/api/pgConstraintName.ts`: maps 23505 to a constraint name. The index name must stay the same.
- Migrations: `20260812083206_api_keys_venue_account_id.sql` (the index and its self-verify), `20260925120000_api_keys_account_identity.sql` (marker columns and trigger), `20260927180000_working_holder_rule_d18.sql`.

### Established Patterns
- Migrations carry catalogue-only self-verify and no data-reading `DO` guards. They auto-apply to TEST and then PROD on merge with no human stop.
- The identity value is never logged or put in error copy, and PostgREST error details are scrubbed with the request's secrets.
- `delete_allocator_api_key` hard-deletes a key row. The marker foreign key is `ON DELETE SET NULL`, and its trigger clears the kind.

### Integration Points
- Readers of `venue_account_id` by equality: `shared-account-partners.ts`, the `commit_scenario_batch` fingerprint (`venue_norm`), `latest-holdings-per-key.ts`, `match.py`, `allocator_equity_derive.py`, and 155.2's `capture-keymap.sql`.

</code_context>

<specifics>
## Specific Ideas

- Read-only PROD census on 2026-11-23, before discuss closed:
  - 0 live same-owner pairs: every live key is stamped and the unique index holds.
  - 13 keys marked `duplicate` (7 deribit, 5 okx, 1 mt5), all already disconnected.
  - One published okx strategy sits on a disconnected duplicate key whose holder (same owner) backs another published strategy.
  - The one MT5 marked key is 155.2's k2, confirmed from the sealed keymap and now disconnected.
  - Every same-identity group of live keys spans different owners. Those are allowed cross-user shares and stay.

</specifics>

<deferred>
## Deferred Ideas

- Composite add-key identity stamping and refusal: out, under milestone ruling F-2.
- CONN-02 (rotated-password reconnect) and CONN-04 (orphaned-key copy): Phase 228 KEYANSWERS.
- Server-qualifying the cross-user readers (`shared-account-partners.ts`, the fingerprint `venue_norm`): HOLDINGSTRUTH reads, after S4 settles. Login-only grouping across two brokers over-groups, which is the safe direction.

</deferred>
