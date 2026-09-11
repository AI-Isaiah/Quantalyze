# `vault-absent` fixture function snapshot

⛔ **NOT `@generated`, and deliberately NOT the real snapshot.** Every file here is a
hand-written fixture in the SHAPE `scripts/dump-sql-functions.ts` emits, and they exist so the
self-test's `vault-absent` TRI-STATE scenario resolves against text this phase owns.

⛔ **The COUNT is not restated here.** The tri-state scenario's `REQUIRED_FIXTURE_FILES` list in
`scripts/prod-prober/run.mjs` is the roster, and a file named there and missing from disk is a
self-test FAIL. A number in this prose would be one more thing to drift.

**Why not resolve the tri-state rows against `supabase/schema/functions/`?** Because Phase
164.8.6 VAULTTICKFIX edits `match_engine_cron_tick`, and a scenario asserting "a comment-only
mention is REJECTED" must not be able to go red because a DIFFERENT phase changed a DIFFERENT
function. The one scenario that DOES use the real snapshot is the 164.5.1 collision check, and
that coupling is its entire purpose.

⚠️ **A missing file here is a self-test FAIL, never a skip** (S2). The tri-state scenario asserts
every file on that roster exists before it judges anything — otherwise a deleted fixture would silently turn
"resolvable callable is ACCEPTED" into "unknown callable is REJECTED", which passes for the wrong
reason.

| file | what it proves |
|---|---|
| `fixture_vault_reader.sql` | a committed body with an EXECUTING `FROM vault.decrypted_secrets` — ACCEPT |
| `fixture_wrapper.sql` | the TRANSITIVE edge: calls the reader, reads nothing itself — ACCEPT |
| `fixture_comment_only.sql` | names the table only in a `--` comment — REJECT |
| `fixture_literal_only.sql` | names the table only inside a string literal — REJECT |
| `fixture_nondollar_body.sql` | an `AS '…'` body the snapshot reader does not expose. It DOES read Vault, so REJECT is loud and safe — what F6 fixed is that the verdict now NAMES the callable it could not read, instead of skipping it silently |
| `fixture_chain_1..5.sql` + `fixture_shared.sql` | the F6 depth-memoisation chain. `fixture_chain_1` reaches `fixture_shared` at `CALLABLE_DEPTH_MAX`, truncating its subtree; a second, depth-0 approach must re-explore it rather than return the memoised `false`. ⚠️ Deleting ANY link shortens the chain below the cap and the control stops measuring anything |
