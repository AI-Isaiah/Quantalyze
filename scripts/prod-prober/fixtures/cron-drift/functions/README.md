# `vault-absent` fixture function snapshot

⛔ **NOT `@generated`, and deliberately NOT the real snapshot.** These four files are
hand-written fixtures in the SHAPE `scripts/dump-sql-functions.ts` emits, and they exist so the
self-test's `vault-absent` TRI-STATE scenario resolves against text this phase owns.

**Why not resolve the tri-state rows against `supabase/schema/functions/`?** Because Phase
164.8.6 VAULTTICKFIX edits `match_engine_cron_tick`, and a scenario asserting "a comment-only
mention is REJECTED" must not be able to go red because a DIFFERENT phase changed a DIFFERENT
function. The one scenario that DOES use the real snapshot is the 164.5.1 collision check, and
that coupling is its entire purpose.

⚠️ **A missing file here is a self-test FAIL, never a skip** (S2). The tri-state scenario asserts
all four exist before it judges anything — otherwise a deleted fixture would silently turn
"resolvable callable is ACCEPTED" into "unknown callable is REJECTED", which passes for the wrong
reason.

| file | what it proves |
|---|---|
| `fixture_vault_reader.sql` | a committed body with an EXECUTING `FROM vault.decrypted_secrets` — ACCEPT |
| `fixture_wrapper.sql` | the TRANSITIVE edge: calls the reader, reads nothing itself — ACCEPT |
| `fixture_comment_only.sql` | names the table only in a `--` comment — REJECT |
| `fixture_literal_only.sql` | names the table only inside a string literal — REJECT |
