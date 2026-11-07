# Phase 192 PUBLICTRUTH: Evidence

Measured at execution, plan 192-01 Task 1 (public-network and code-fact readings).

- Execution date: 2026-11-06 (UTC)
- HEAD short sha: b4cea75f3
- `openssl version`: OpenSSL 3.6.4 25 Aug 2026 (Library: OpenSSL 3.6.4 25 Aug 2026)
- Production host: quantalyze.xyz (port 443, SNI set)

Every row below is a reading taken at execution, not copied from RESEARCH. RESEARCH's readings of the same date agree with these.

## TLS handshakes (D-03)

Command shape: `openssl s_client -connect quantalyze.xyz:443 -servername quantalyze.xyz -<version> [-cipher 'DEFAULT:@SECLEVEL=0']` with stdin from /dev/null. The `-cipher` option was passed for `-tls1`, `-tls1_1` and `-tls1_2` so the client could offer the old versions; `-tls1_3` was run without it.

| Version | Verdict | Decisive output line |
|---------|---------|----------------------|
| TLS 1.0 | refused | `error:0A00042E:SSL routines:ssl3_read_bytes:tlsv1 alert protocol version` ... `SSL alert number 70`; `New, (NONE), Cipher is (NONE)` |
| TLS 1.1 | refused | `error:0A00042E:SSL routines:ssl3_read_bytes:tlsv1 alert protocol version` ... `SSL alert number 70`; `New, (NONE), Cipher is (NONE)` |
| TLS 1.2 | accepted | `New, TLSv1.2, Cipher is ECDHE-RSA-AES128-GCM-SHA256` |
| TLS 1.3 | accepted | `New, TLSv1.3, Cipher is TLS_AES_128_GCM_SHA256` |

D-03 TLS 1.0: refused
D-03 TLS 1.1: refused
D-03 TLS 1.2: accepted
D-03 TLS 1.3: accepted

Consequence for copy: the server accepts TLS 1.2 and 1.3 and refuses 1.0 and 1.1. A sentence that says TLS 1.2 is disabled is false against these handshakes. Behaviour is not changed by this phase (D-03).

## HSTS and certificate (D-03)

- `curl -sI https://quantalyze.xyz/` returned `HTTP/2 200` and `server: Vercel`.
- Served header, verbatim: `strict-transport-security: max-age=31536000; includeSubDomains`
- That value is set by `next.config.ts`, in the headers entry whose `key` is `Strict-Transport-Security` (cited by key, not by line number). A one-year max-age is therefore what is served; `preload` is not sent.
- Served certificate (from the s_client certificate, through `openssl x509 -noout -issuer -startdate -enddate`):
  - issuer: `C=US, O=Let's Encrypt, CN=YR1` (issuer CN: YR1)
  - notBefore: Oct  9 20:25:25 2026 GMT
  - notAfter: Jan  7 20:25:24 2027 GMT
  - validity window: 90 days

## Vercel TLS documentation (D-03)

Source: https://vercel.com/docs/security/encryption, fetched with `curl -sL` at execution (HTTP 200; the page footer reads "Last updated September 15, 2026").

Quoted sentences:

- Under "Supported TLS versions": "Vercel supports TLS version 1.2 and TLS version 1.3."
- Under "Supported ciphers": "To protect data integrity, Vercel only supports strong ciphers with forward secrecy." The page then lists three TLS 1.3 suites and six TLS 1.2 suites, among them `ECDHE-RSA-AES128-GCM-SHA256`, which is the suite the TLS 1.2 handshake above negotiated.
- Under "Support for HSTS": custom domains get `Strict-Transport-Security: max-age=63072000` by default, and "You can modify the Strict-Transport-Security header by configuring custom response headers in your project." The repo's header, not the Vercel default, is what the live response carries (see the HSTS section above).
- The page contains no setting, control or instruction for choosing a minimum TLS version, and no sentence about dropping TLS 1.2.

Conclusion: [ASSUMED] Vercel documents TLS 1.2 and 1.3 as supported and documents no per-project minimum-version control. The second half rests on the absence of such a control on the page I read, so it is an assumption and not a measurement. Behaviour is not changed (D-03).

## Fernet (D-01)

Source: https://cryptography.io/en/latest/fernet/, fetched with `curl -sL` at execution (HTTP 200).

Quoted implementation line, closing RESEARCH assumption A1: "Fernet is built on top of a number of standard cryptographic primitives. Specifically it uses: AES in CBC mode with a 128-bit key for encryption; using PKCS7 padding. HMAC using SHA256 for authentication. Initialization vectors are generated using a CSPRNG."

Result: the docs agree with the UI-SPEC. Fernet is AES-128 in CBC mode, authenticated with HMAC-SHA256. It is not AES-256-GCM. Plan 192-04 copies this line.

## Key-storage code facts (D-01)

From `analytics-service/services/encryption.py` at HEAD:

- Imports `Fernet, InvalidToken` from `cryptography.fernet`. Every cipher in the module is a `Fernet` instance.
- `generate_dek()` returns `Fernet.generate_key()`. `encrypt_credentials` calls it on every call, so each credential pair gets a fresh data key (DEK).
- The credentials JSON (api_key, api_secret, passphrase) is encrypted under that DEK, and the DEK is encrypted under the KEK (`kek_cipher.encrypt(dek)`).
- `get_kek()` reads `os.getenv("KEK")` and raises when it is unset. `get_kek_version()` reads `os.getenv("KEK_VERSION", "1")`. The returned dict carries `kek_version`, `dek_encrypted`, `api_key_encrypted`, and `None` for `api_secret_encrypted`, `passphrase_encrypted` and `nonce`. The comment on `nonce` reads "Fernet handles nonce internally".
- So the KEK is read from the analytics service's own process environment. No Supabase Vault read and no AES-256-GCM primitive appear in the module.
- `decrypt_credentials` and `rotate_kek` exist only in this module. Callers of `decrypt_credentials` and `get_kek` outside it are the analytics service's own routers (`routers/cron.py`, `routers/exchange.py`, `routers/internal.py`).

Greps over the checked-out tree (HEAD b4cea75f3):

- `grep -rn "process.env.KEK" src`: 0 matches.
- `grep -rlE "createDecipheriv|fernet" src`: 0 files.
- Case-sensitive `KEK` / `kek_version` / `get_kek` in non-test `src` code: the only hits are the two marketing pages' copy (`/for-quants`, `/security`) and routes that pass the returned `kek_version` number into a database RPC argument (`create-with-key`, `composite/add-key`). No route reads a KEK or decrypts.
- Vault and AES-256-GCM in code: `grep` of `analytics-service` Python files for `AESGCM` and Vault reads finds none in the key path; the only Vault reference in `supabase/migrations` is the prober's own `vault.decrypted_secrets` read (`20260918120000_prod_prober_cadence.sql`), which is unrelated to `api_keys`. The words "Supabase Vault" and "AES-256-GCM" still appear as copy in `src/app/(marketing)/security/page.tsx`, `src/app/(marketing)/for-quants/page.tsx`, the two wizard steps `ConnectKeyStep.tsx` and `MultiKeyConnectStep.tsx`, and in the migration `20260410225608_api_keys_column_revoke.sql` as a header comment ("KEK (stored in Supabase Vault)"), which the code does not match.
- Web-tier role (stated so the S-KEY wording is not read as "the web tier never touches the key"): `src/app/api/keys/validate-and-encrypt/route.ts` calls `encryptKey(...)` in `src/lib/analytics-client.ts`, which posts the plaintext key to the analytics service's `/encrypt-key` endpoint over the service-to-service hop, then persists the returned ciphertext through a database RPC. The web tier holds ciphertext and `kek_version`; it holds no KEK and has no decrypt code.

Encrypted-column grants (`api_key_encrypted`, `api_secret_encrypted`, `passphrase_encrypted`, `dek_encrypted`, `nonce`):

- `supabase/migrations/20260410225608_api_keys_column_revoke.sql` revokes table-level SELECT on `api_keys` from `anon` and `authenticated`, grants back an allowlist of nine metadata columns to `authenticated` only, and ends with two self-verifying `DO` blocks.
- `supabase/schema/baseline.sql`, api_keys GRANT block: table-level grants to `anon` and `authenticated` are `REFERENCES,DELETE` only (grep for a table-level SELECT or ALL grant to either role: 0); column-level `GRANT SELECT(...)` lines on `api_keys`: 21, all to `authenticated`, none on any of the five encrypted columns (grep: 0).
- Migrations, excluding `down/`: grants of SELECT on any of the five columns to `anon` or `authenticated`: 0.
- Result: none of the five encrypted columns holds a SELECT grant to `anon` or `authenticated`.

Clause-by-clause judgment of the UI-SPEC S-KEY sentence ("We store your read-only API key encrypted, under a data key of its own, and only our analytics service can decrypt it."):

- "encrypted": true (Fernet, above).
- "under a data key of its own": true (`generate_dek` per credential, wrapped by the KEK).
- "only our analytics service can decrypt it": true at HEAD (the KEK is read only from the analytics service environment; `src` holds no KEK and no decrypt code; no user-facing role can SELECT the ciphertext columns). It says nothing about the database host or the service-role client, which can read the ciphertext but not decrypt it.
- "read-only API key": true as a statement about what the product accepts at validation. In `analytics-service/services/exchange.py` the validate result sets `read_only` to `has_read and not has_trade and not has_withdraw`, and a key with withdrawal permission is refused with "Key has withdrawal permissions. Please use a read-only key." For sFOX and MT5 `routers/exchange.py` asserts read-only structurally and refuses an MT5 master-password login (`master_rejected`). It is a product claim and not a storage claim; this reading did not probe it against a live key per venue.

D-01 code facts: S-KEY clauses true

## Retention at HEAD

What the code does, from the checked-out migrations, `analytics-service/` and `src/`:

- Scheduled deletions (pg_cron, `cron.schedule`): `audit_log` (hot to cold at 2 years, cold purge at 7 years), `notification_dispatches` (180 days), `compute_jobs` (done 30 days, failed 90 days), plus reapers for orphaned or stuck compute jobs and analytics rows. A search of every `cron.schedule` body in `supabase/migrations` (excluding `down/`) for a `DELETE FROM` on `trades`, `strategy_analytics`, `positions`, `funding_fees` or `portfolio_analytics` finds none. `analytics-service` has no scheduled deletion of strategy trades or aggregates either.
- `trades` deletions in code are not retention: the `sync_trades` RPC (latest definition `20260510180535_sync_trades_date_range_scoped_delete.sql`, which follows `20260510172558_sync_trades_preserve_fills.sql`) replaces legacy daily-summary rows inside the window being re-synced and expressly protects raw fills (`is_fill`).
- On deletion of a strategy row, `trades`, `strategy_analytics`, `strategy_analytics_series`, `positions`, `funding_fees` and `portfolio_strategies` rows are removed by `ON DELETE CASCADE` foreign keys on `strategy_id` (baseline.sql). Deleting an API key does not remove them: `strategies.api_key_id` is `ON DELETE SET NULL`, and `trades` has no foreign key to `api_keys`. Deleting an API key does cascade to per-key tables such as `compute_jobs`, `strategy_keys`, `csv_daily_returns`, `api_key_nav_marks` and the allocator trade-read tables.
- Account closure (`sanitize_user`, latest definition `20260827130000_sanitize_user_revoke_strategy_shares.sql`): deletes the user's `api_keys`, overwrites strategy `name`, `description`, `codename`, contact email and notes, and sets `trades.raw_data`, `exchange_order_id` and `exchange_fill_id` to NULL. It does not delete the `trades` rows or the aggregate analytics.
- Allocator per-fill read store (`analytics-service` `trade_read_store.purge_expired`, run from the worker watchdog): rows expire 7 days after their last write and are removed at most one sweep interval later, or earlier on completion or when the key is removed. This is a working cache of allocator reads, not the strategy `trades` table.

Retention at HEAD: strategy trade fills and aggregate analytics have no scheduled deletion and no retention window; they live as long as their strategy row, a key disconnect does not remove them, and account closure blanks identifying fields on fills without deleting the rows. No 30-day hard-delete of raw fills exists in code.

Note for plan 192-04: the security packet's "Raw fills retention: 30 days; hard-deleted by daily job" is not supported by anything above. The `/security` Data handling sentence "When you disconnect an exchange key or close your account, fills and aggregates for that connection are removed" is also not supported as written: disconnecting a key leaves the strategy's fills in place, and closure blanks fields rather than removing rows.

## Live /demo baseline (public GET)

`curl -s "https://quantalyze.xyz/demo?persona=<p>"`, signed out, at execution. Booleans only.

| Persona | HTTP status | Loading heading ("Demo data is loading") | `BTC TWR` | `BTC drawdown` | `Founder view` |
|---------|-------------|-------------------------------------------|-----------|----------------|----------------|
| active | 200 | present | present | present | present |
| cold | 200 | absent | present | present | present |
| stalled | 200 | absent | present | present | present |

Reading note: on `active` the loading card renders after the hero and analytics blocks (the page body carries the card's text beside the hero figures), so the visitor sees a half-seeded page; `cold` and `stalled` do not render that card. This baseline is the "before" for plans 192-05 and 192-07; it does not name a cause (Task 2 does).

## PROD readings (plan 192-01 Task 2)

Every reading below is a single read-only SELECT through the Supabase MCP connected to the PROD project, one statement per call, run on 2026-11-06 by the orchestrator and recorded here by the executor from the orchestrator's scratchpad of readings (the executor session has no PROD access). Nothing was written to PROD. The two signed-out requests are plain `curl` against the public host. This file records counts, booleans, ages in days and present/absent only; no id, name, email or company is written.

### Database marker (first reading of this task)

Marker query (`SELECT shobj_description(oid, 'pg_database') AS which_database FROM pg_database WHERE datname = current_database();`): the database comment names PRODUCTION ("PRODUCTION - real customer data"). The marker named PROD, so every reading below was taken on the right database. The marker was run first, before any other statement.

### D-04: signed-out factsheet

- No strategy owner on PROD has a non-empty company, in any strategy status (archived, pending review, private, published non-example: with-company count 0 in every group). `is_example` rows: 0. The plan's Q1 (a published, non-example strategy whose owner has a company) therefore returned 0 rows.
- Substitute used for the signed-out test: the newest published non-example strategy (the name is not recorded here). Its page title and first heading both equal one of the `STRATEGY_NAMES` presets in `src/lib/constants.ts`, so the title class is `codename`. The owner's display name does not appear in the body (0 hits).
- Signed-out `curl` of that published factsheet: HTTP 200. Signed-out `curl` of a random v4 uuid: HTTP 404.
- Q1b: published, non-example strategies whose factsheet title is NULL or neither the row's `codename` nor a `STRATEGY_NAMES` preset: 0 (of 3 published non-example strategies; all three are titled with a preset).
- VACUOUS READING, stated so no later plan leans on it: `firm-name=absent` is true only vacuously. No owner on PROD has a company, so there was no company string that could have leaked. The reading does not show that the page withholds a company string when one exists; that rests on the code path (the published lane in `src/app/factsheet/[id]/v2/page.tsx`), not on this measurement.

D-04 signed-out factsheet: published=200 random=404 firm-name=absent title=codename non-codename-titles=0

### D-08: why the demo's persona books are empty

Persona names only (active, cold, stalled). Q2 counts the `portfolio_strategies` rows (holdings) per persona portfolio; Q3 resolves the distinct strategies the seeder's `PERSONA_DEFS` composes the books from.

| Reading | active | cold | stalled |
|---------|--------|------|---------|
| Q2 persona portfolio exists | 1 | 1 | 1 |
| Q2 holdings rows (`portfolio_strategies`) | 0 | 0 | 0 |
| Q2 strategies the persona is composed from (seeder) | 3 | 6 | 2 |
| Q2 of those that exist in `strategies` | 0 | 0 | 0 |

- Q3: the three books are composed from 9 distinct strategies in total. Of those 9, 0 exist in `strategies`. No `strategies` row with the seeder's id prefix exists at all, while `strategies` holds 46 rows in total. So the published, `is_example`, exploratory-with-NULL-codename and has-`strategy_analytics` counts over the composing set are all 0 (nothing to count).
- Q4: foreign keys `portfolio_strategies` to `strategies`: 1. Foreign keys `strategy_analytics` to `strategies`: 1. Columns named by the page's holdings select that are missing: none. The embedded select is structurally sound (C2 ruled out).
- Q5 (latest `portfolio_analytics` row, all three personas): a row exists, `computation_status` is `complete`, age 126 days. `benchmark_comparison` has the `benchmark_return` key (true) and not the `benchmark_twr` key (false). `optimizer_suggestions` is NULL (not an array, so 0 unnamed elements). `portfolio_equity_curve` is non-empty. `attribution_breakdown` length: active 3, cold 6, stalled 2; elements without a non-empty `strategy_name`: 0 in each persona.
- Q6: non-internal triggers on `portfolio_strategies` (names only, all enabled): `portfolio_strategies_seed_weight_snapshot_trigger`, `trg_portfolio_strategies_own_capital_on_repoint`, `trg_portfolio_strategies_own_capital_only`.
- Q7 (best effort): `audit_log` rows recording a deletion of any of the 9 composing strategy ids: 0. The log does not show what removed them (it may never have recorded it).

cause of row loss: undeterminable

Per-persona lines:

- active: holdings=0 composing=3 existing=0 unnamed-attribution=0 unnamed-optimizer=0 (optimizer_suggestions NULL)
- cold: holdings=0 composing=6 existing=0 unnamed-attribution=0 unnamed-optimizer=0 (optimizer_suggestions NULL)
- stalled: holdings=0 composing=2 existing=0 unnamed-attribution=0 unnamed-optimizer=0 (optimizer_suggestions NULL)

Reading of the verdict: every persona book has 0 holdings rows and every strategy a book is composed from is absent from `strategies`, with the relationship and column facts clean. That is the fixed-vocabulary case `strategies-missing` (a book has 0 rows and at least one composing strategy is absent), not `repair-needed` (which needs the composing strategies to exist) and not `code-only` (which needs a foreign-key or column defect). The stored analytics rows are 126 days old and complete, so the persona analytics outlived the strategies and holdings they describe. The cause of the loss is not recoverable from the audit log.

D-08 verdict: strategies-missing

### D-10: labels /demo cannot name from PROD data

Q5b components (distinct strategy ids plan 192-05's `strategy-name` stage would fail on, judged by `displayStrategyName` in `src/lib/strategy-display.ts`):

- (a) strategies in any persona book on PROD now, plus the Q3 composing set, that would get the raw-id label: `a_raw_id_label=0`.
- (a') composing strategies that are absent from `strategies`, so no name can be read for them from PROD data: `a_absent=9`.
- (b) strategy ids in the latest persona `attribution_breakdown` and `optimizer_suggestions` elements, outside any persona book, whose stored `strategy_name` is empty, equals the id or matches the raw-id pattern, and whose `strategies` row is absent or would get the raw-id label: `b_unresolvable=0`. 11 attribution and optimizer elements were examined.

Reading used for the line below: the INCLUSIVE reading, `n = a_raw_id_label + a_absent + b_unresolvable = 0 + 9 + 0 = 9`. The plan's must-have truth counts strategies /demo would label with the raw-id form OR could not name from PROD data, and the 9 absent composing strategies are exactly the second kind. The narrow reading (raw-id label only) would give 0, which would hide that the books name nothing today. Plan 192-10's ship gate needs the line to read 0; it reaches 0 only once the 9 composing strategies exist and can be named, or the books no longer reference them (plan 192-06 and the demo reader plans decide which).

D-10 unresolvable labels: 9

## D-09 inputs

What the founder view is, and what keeps it alive (code facts at HEAD, `analytics-service/routers/match.py`, cited by the `_DEMO_ALLOCATOR_ID` symbol):

- The public demo endpoint behind the founder view hard-locks to the seeded active demo allocator (`ALLOCATOR_ACTIVE_ID` in `src/lib/demo.ts`, the same value as `_DEMO_ALLOCATOR_ID`), and the candidate universe for that allocator is filtered to `is_example` strategies (the `demo_only` flag of the universe loader and the post-filter in `_score_one_allocator`).
- The match cron's allocator page loader carries `.neq("id", _DEMO_ALLOCATOR_ID)` (comment tag D-01, QUANTALYZE-Z). The cron never scores the demo allocator. The only producer of a batch for it is the manual admin recompute.

Q8, per persona allocator (`match_batches` and the latest batch's ranked, non-excluded `match_candidates`):

| Persona allocator | `match_batches` | Latest batch age (days) | Ranked non-excluded candidates in it |
|-------------------|-----------------|-------------------------|--------------------------------------|
| active (the demo allocator the cron excludes) | 0 | n/a | 0 |
| cold | 7 | 0 | 3 |
| stalled | 7 | 0 | 3 |

Reading: the founder view reads the active allocator, which has 0 batches and 0 ranked candidates, and the cron excludes it, so nothing automatic can ever produce one (input (b) of the rule is false). The cold and stalled allocators have fresh batches only because the cron does score them; those batches are not what the founder view reads. A further measured fact bears on the keep path: the D-04 readings found 0 `is_example` rows (the strategies the seeder would flag as examples are among the 9 absent ones), and the active allocator's candidate universe is restricted to `is_example` strategies. If that holds at recompute time, a manual recompute would find an empty universe and the code raises `No eligible strategies in the directory` (HTTP 400) before it writes a batch. This is an inference from the 0 reading and the code, not a separate PROD measurement. The keep path would then also need `is_example` strategies to exist on PROD, a data repair beyond a recompute.

The D-09 decision itself was Task 3's, taken by the founder on 2026-11-06.

D-09 outcome: remove

The founder chose `remove` on 2026-11-06. It rests on two measured inputs above: the demo allocator has 0 `match_batches` and 0 ranked non-excluded candidates (input (a) false), and the match cron excludes it through the `_DEMO_ALLOCATOR_ID` filter in `analytics-service/routers/match.py` (input (b) false), so nothing automatic can ever produce a batch for the founder view to read.

## D-08 probe baseline

Plan 192-06 Task 1, run 2026-11-07 (UTC) before any repair decision. Verdict branch followed: `strategies-missing` (draft nothing; prepare facts).

Public probe: `curl -s "https://quantalyze.xyz/demo?persona=<p>"`, signed out, at execution. Booleans and counts only. The "holding name present" column asks whether any of the persona's composing strategy names (from `PERSONA_DEFS` through `ARCHETYPES` in `scripts/seed-full-app-demo.ts`) appears in the body.

| Persona | HTTP status | Loading heading ("Demo data is loading") | Composing names present (of composing count) | Holdings rows (`portfolio_strategies`, PROD) |
|---------|-------------|------------------------------------------|----------------------------------------------|----------------------------------------------|
| active | 200 | present | 3 of 3 | 0 |
| cold | 200 | absent | 6 of 6 | 0 |
| stalled | 200 | absent | 2 of 2 | 0 |

How the holdings counts were taken: through the PROD Supabase MCP, one read-only SELECT, run by the orchestrator on 2026-11-07, marker query first (the database comment names PRODUCTION). The executor session has no PROD access and recorded the result from the orchestrator's scratchpad. Nothing was written to PROD. The three public requests are the executor's own `curl` calls.

Reading note, so no later plan leans on the name column: the names in the body do NOT come from holdings. In the active page the three names sit in a list of per-strategy figures with a signed percentage beside each, which the stored `portfolio_analytics` attribution (126 days old, complete, 3, 6 and 2 elements per persona) supplies; the holdings count is 0 for all three. So "holding name present" is true on all three rows while no holding exists, and the probe cannot tell restored holdings from stale analytics by names alone. The rows that do discriminate are the loading heading and the holdings count. Cold and stalled show no loading card because the page's card condition is "no portfolio holdings AND no recommendations", and those two allocators have fresh match batches (7 each, 3 ranked candidates in the latest), so their empty books are masked by the recommendations section. The active allocator has 0 batches and 0 holdings, so it alone shows the card.

## D-08 facts prepared for the founder checkpoint (strategies-missing)

Which personas: all three. Each persona portfolio exists, has 0 holdings rows, and every strategy it is composed from is absent from `strategies`.

| Persona | Composing strategies (seeder count) | Absent from `strategies` |
|---------|-------------------------------------|--------------------------|
| active | 3 | 3 |
| cold | 6 | 6 |
| stalled | 2 | 2 |

Distinct strategies absent: 9 (the books share two of them, so 11 holdings over 9 strategies). No `strategies` row carries the seeder's id prefix at all, while `strategies` holds 46 other rows. Cause of the loss: undeterminable (plan 192-01 Q7).

Why no statement is drafted: restoring a holding needs its strategy row to exist first (`portfolio_strategies` references `strategies`, one foreign key, Q4). Restoring the 9 strategies is a larger write than this plan's narrow holdings-only repair: each strategy needs its manager, `strategy_analytics`, the example and published flags and its series, all defined by the full-app seeder, which refuses PROD by design. This plan drafts nothing for it.

What the founder weighs, in the plan's words: phase 192 does not ship while no `D-08 repair:` line reads `applied` or `not needed`, because plan 192-05's code would render the error page on public /demo for each emptied persona. The demo cannot look finished until the data exists. The default for `strategies-missing` is a new phase that restores the 9 strategies and the three books through a path that is allowed to touch PROD.

Task 2 (founder decision) is pending. No `D-08 repair:` line is written yet; Task 3 and the SUMMARY are not run.

## D-08 repair decision

The founder decided this on 2026-11-07, at the plan 192-06 Task 2 checkpoint. He first answered "delete demo", then clarified it as "Page only", then wrote: "retire the whole demo part". The public demo is retired in code (192-CONTEXT.md D-11). No PROD write or delete was made, and the PROD demo rows stay as they are. Plan 192-06 Task 3 does not run.

D-08 repair: not needed (demo retired, founder 2026-11-07)

## D-08-SCREENSHOT decision (plan 192-08 Task 2)

The founder decided this on 2026-11-07: "Retire it (Recommended)". The pixel spec, its 3 PNGs and the bake plumbing are retired. With the demo gone, no seeded-render baseline is booked.

## D-11 /demo retirement probe

Plan 192-11 Task 1, run on a placeholder production build of the phase branch.

- Execution date: 2026-11-07 (UTC)
- Base HEAD short sha (before this plan's commit): 40574c28a
- Build: `npm run build` with the placeholder env of the `frontend-build` job in `ci.yml`, under a temporary `turbopack.root` for the worktree's symlinked `node_modules` (restored from a byte backup before the commit; the committed `next.config.ts` carries no `turbopack` key).
- Server: `npx next start -p 3197`, the same env, signed-out requests with `curl`, stopped afterwards (port confirmed free).
- Control: `/no-such-page-192`, a URL that never existed.

| Path | Status | Location path | cache-control header present | contains s-maxage |
|------|--------|---------------|------------------------------|-------------------|
| `/demo` | 307 | `/login` | no | no |
| `/demo?persona=active` | 307 | `/login` | no | no |
| `/demo/founder-view` | 307 | `/login` | no | no |
| `/no-such-page-192` (control) | 307 | `/login` | no | no |

Reading: `.next/app-path-routes-manifest.json` lists `/security` and no path equal to or under `/demo`; the only route naming demo in the build is the API PDF route, which plan 192-15 owns. A signed-out request for a retired path gets the same redirect as a URL that never existed, because `src/proxy.ts` sends every signed-out request outside `PUBLIC_ROUTES` to `/login` before Next routes it. A signed-in request passes the proxy and reaches Next, which has no route for it (404); `src/proxy.test.ts` pins that proxy leaves it alone.

D-11 /demo: build-route=absent
D-11 /demo anon answer: matches control

## D-11 /api/demo retirement probe

Plan 192-15 Task 1, run on a placeholder production build of the plan's working tree (the demo PDF route, its token module and the `/api/demo` PUBLIC_ROUTES entry already removed).

- Execution date: 2026-11-07 (UTC)
- Base HEAD short sha (before this plan's commit): 64bc7c266
- Build: `npm run build` with the placeholder env of the `frontend-build` job in `ci.yml`, under a temporary `turbopack.root` for the worktree's symlinked `node_modules` (restored from a byte backup before the commit, `cmp` silent; the committed `next.config.ts` carries no `turbopack` key).
- Server: `npx next start -p 3199`, the same env, signed-out requests with `curl`, stopped afterwards (port confirmed free).
- Control: `/api/no-such-route-192`, an API path that never existed.

| Path | Status | Location path |
|------|--------|---------------|
| an allowlisted persona portfolio id (not recorded), under the old `/api/demo/portfolio-pdf/` prefix | 307 | `/login` |
| `/api/demo` | 307 | `/login` |
| `/api/no-such-route-192` (control) | 307 | `/login` |

Reading: `.next/app-path-routes-manifest.json` lists `/security`, lists `/api/portfolio-pdf/[id]` (the authed portfolio PDF route, which stays) and no path starting with `/api/demo`. A signed-out request for the retired endpoint gets the same redirect as an API path that never existed, because `src/proxy.ts` sends every signed-out request outside `PUBLIC_ROUTES` to `/login` before Next routes it. `src/proxy.test.ts` now carries `/api/demo` and `/api/demo/portfolio-pdf/abc-123` as anonymous redirect rows; both were shown RED (expected 307, received 200) while `PUBLIC_ROUTES` still listed `/api/demo`.

D-11 /api/demo: build-route=absent
D-11 /api/demo anon answer: matches control
