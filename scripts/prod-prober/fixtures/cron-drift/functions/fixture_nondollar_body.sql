-- FIXTURE, hand-written in the shape `scripts/dump-sql-functions.ts` emits.
-- Not @generated. See README.md in this directory.
--
-- ⛔ THE F6 SKIP, MADE VISIBLE. `resolveCallable` filters definitions to
-- `bodyKind === "dollar"`, so a SINGLE-QUOTED body like this one contributes NO
-- body to the Vault search — and before 164.8.5-REVIEW F6 it contributed no
-- entry to `unresolved` either, so the violation sentence could not say it had
-- skipped anything. The operator read "this command reaches no Vault read" when
-- the truth was "this arm did not read one definition".
--
-- ⚠️ The body below DOES read Vault. That is the point: the answer is still
-- `vault-absent` (loud, and in the safe direction), but the sentence must now
-- NAME this callable so the reader knows the verdict rests on a body nobody
-- read. `AS '…'` is ordinary PostgreSQL, not obfuscation — the same spelling
-- variant CR-03 found a `DO` block can take.

-- source migration: (none — fixture)
CREATE OR REPLACE FUNCTION public.fixture_nondollar_body()
RETURNS text
LANGUAGE sql
AS 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ''analytics_service_key''';
