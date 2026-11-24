# MT5 broker-server backfill census (gate A5)

Phase 225 plan 12 (CONN-03). The daily poll now captures an MT5 key's broker server and backfills it for keys
stamped before the column existed. The server cannot be backfilled by SQL: it lives only in the encrypted
credentials, so the poll is the only thing that can read it. CONTEXT Q2 puts the index change last ("column
first, then the writers and the backfill, then the index change"), and this census is what proves the backfill
is done. Plan 10 Task 4 runs it before PR-3 (the index change) opens.

The orchestrator runs this on PROD through the Supabase MCP. An executor has no MCP and no PROD access.
Every statement in `census.sql` is read-only.

## Run order (one statement per MCP call, never chained)

1. `docs/runbooks/oneaccountonce/marker.sql`. **STOP** if the answer is NULL or does not name PROD. Never
   proceed on a guess, and never on a database that merely looks familiar.
2. Fill the `{{PR2_DEPLOYED_AT}}` token in Census 3 by hand with the PR-2 deploy time (UTC), keeping the quotes.
3. Run Census 1, Census 2 and Census 3 from `census.sql` as three separate calls.
4. Paste each result into the plan 10 SUMMARY under "Gate A5" with counts and cause classes only. No id,
   login, server or email goes into tracked text (public repo).

## What passes

| Census | Passes when |
|--------|-------------|
| 1. Live active MT5 keys with no server, by cause class and last sync status | zero rows, or every remaining key class is named by cause in the orchestrator's report and judged acceptable (for example a key whose session cannot be built) |
| 2. Same-owner live groups on one account with more than one key | zero rows. The login-only index guarantees it today, so a row means the backfill created a pair |
| 3. Newest MT5 `last_sync_at` against the PR-2 deploy time | `a_poll_ran_after_deploy` is true |

Any non-pass blocks PR-3. Do not edit a workflow, a migration or the census to get past a non-pass.

## Reading a non-zero Census 1

| Cause class | Meaning | Usual cause |
|-------------|---------|-------------|
| `unstamped` | the poll never stamped the login | the session cannot be built, or the polls keep failing |
| `marked_against_a_holder` | the stamp was refused, so the key carries a same-account marker | a same-owner duplicate that still holds its marker |
| `stamped_not_backfilled` | the login is stamped, the server is still null | not polled since the deploy, or the session's login differs from the stored login (the poll logs a WARNING naming that cause, with no value) |

An inactive key (`is_active` false) is outside this census because the poll refuses it before any stamp; it keeps
a null server and relies on the wildcard rule. A disconnected key is outside the index and keeps a null server.

## Files

| File | What it does |
|------|--------------|
| `census.sql` | Census 1, 2 and 3. Read-only. |
