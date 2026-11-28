---
phase: 243-dbbackstop-anon-reads-only-named-metric-keys-an-api-keys-wri
scope: PR-A (plans 243-01 to 243-05)
reviewed: 2026-11-27T00:00:00Z
depth: deep
files_reviewed: 35
files_reviewed_list:
  - .github/workflows/ci.yml
  - TODOS.md
  - scripts/baseline-content-drift-check.mjs
  - scripts/dump-sql-functions.ts
  - scripts/mutation-floors.mjs
  - src/__tests__/drift-check-scripts.test.ts
  - src/__tests__/gate-family-meta.test.ts
  - src/__tests__/lint-sql-gates.test.ts
  - src/__tests__/mutation-annotation-parser.test.ts
  - src/__tests__/mutation-runner-floors.test.ts
  - src/app/api/og/factsheet/[id]/route.cache-ttl.test.tsx
  - src/app/api/og/factsheet/[id]/route.figure-gate.test.tsx
  - src/app/api/og/factsheet/[id]/route.page-agreement.test.tsx
  - src/app/api/og/factsheet/[id]/route.public-access.test.tsx
  - src/app/api/og/factsheet/[id]/route.stale-analytics.test.tsx
  - src/app/api/og/factsheet/[id]/route.stored-parity.test.tsx
  - src/app/api/og/factsheet/[id]/route.test.tsx
  - src/app/api/og/factsheet/[id]/route.tsx
  - src/app/factsheet/[id]/v2/page.composite-read-error.test.tsx
  - src/app/factsheet/[id]/v2/page.smoothed-wiring.test.tsx
  - src/lib/factsheet/by-basis-projection.test.ts
  - src/lib/factsheet/by-basis-projection.ts
  - src/lib/factsheet/fetch-and-build-payload.single-key-conventions.test.ts
  - src/lib/factsheet/fetch-and-build-payload.test.ts
  - src/lib/factsheet/fetch-and-build-payload.ts
  - src/lib/test-helpers/by-basis-alias-row.ts
  - supabase/migrations/20261127120000_client_role_statement_timeout_pin.sql
  - supabase/migrations/20261127120100_insert_api_key_rpc_and_user_id_immutable.sql
  - supabase/migrations/down/20261127120000-rollback.sql
  - supabase/migrations/down/20261127120100-rollback.sql
  - supabase/schema/functions/enforce_api_keys_user_id_immutable.sql
  - supabase/schema/functions/insert_api_key.sql
  - supabase/tests/test_api_keys_user_id_immutable.sql
  - supabase/tests/test_client_role_timeouts.sql
  - supabase/tests/test_insert_api_key_rpc.sql
findings:
  critical: 0
  warning: 4
  info: 0
  total: 4
# Cumulative across rounds: WR-01..WR-03 (round 1, all resolved in round 2) + WR-04 (round 2, open).
round_2:
  reviewed: 2026-11-27T00:00:00Z
  head: 413cf89189187e54513422dfe0bbbcf94cd50ccd
  resolved: [WR-01, WR-02, WR-03]
  open_medium_plus: 1
  new_findings: [WR-04]
status: issues_found
---

# Phase 243: Code Review Report (PR-A, plans 01 to 05)

**Reviewed:** 2026-11-27
**Depth:** deep (cross-file: every `metrics_json_by_basis` / `metricsByBasis` consumer in `src/` and the writer in `analytics-service/`)
**Files Reviewed:** 35 (`git diff origin/main...HEAD -- . ':!.planning'`)
**Status:** issues_found
**Severity scale used:** only MEDIUM and above is reported, per the project review rule. MEDIUM maps to the `warning` count in the frontmatter, and HIGH/CRITICAL to `critical`. LOW and Info observations are left out on purpose.

## Summary

I found no HIGH or CRITICAL issue, and three MEDIUMs. Two are gate gaps: a test that claims a property it cannot fail on. The third is a fail-open path in the OG route. The route's own comment says that path fails closed.

What I traced and found sound (no MEDIUM+):

- **OG route, published-only and id-scoped.** The admin alias read runs only after the session read returned a row with an analytics embed. It is keyed by `data.id ?? id`, which comes from a published-only read of a uuid-validated id, and it is `withPublishedOnly` again. It projects only the 21 aliases, and `route.test.tsx` pins the admin select to exactly 21 comma-separated entries. An admin `error` or a throw sets `failed`, clears `data` and takes the generic no-store card (F1b pins this). P8 pins that no admin read happens for an unpublished, unknown or malformed id. I found no path that exposes an unpublished strategy or any column beyond the aliases. The only open path is the one in WR-03.
- **Rebuild semantics.** Every consumer of the per-basis object reads only the seven `BASIS_KPI_MAP` keys or checks whether the object is present. I checked `readCompositeFactsheet`, `singleKeyBasisOpts`, `shouldReadSingleKey{Mtm,Smoothed,Cash}Series`, `shouldReadCashSettlementSeries`, `storedCashHeadlineGate`, `applyHeadlineBasis`, `overlayBasisScalars`, `hasBasisHeadline`, `computeOgHeadline`, `basis-context.tsx`, `MetricsColumn.tsx` and `fetch-and-build-payload.ts:961/981`. No reader takes a non-KPI key, nesting or ordering off a basis object. Two edges diverge from the old whole-column read:
  - A present basis whose seven values are all null is now omitted. This is documented and pinned, and PROD holds 0 such rows (Q6).
  - A mapped key that is ABSENT now rebuilds as present-null, so `hasBasisHeadline`'s `serverKey in rec` arm no longer bites on this path. The writer builds each basis from a full `metrics_json` (`job_worker.py` around lines 12290 and 15124), and the 243-03 SUMMARY records this edge, so I did not raise it as a finding. But the module docblock's "ONE DIVERGENCE" is not accurate.
  - `SyncPreviewStep.tsx` still reads the whole column through the owner's user client. That is unchanged and out of PR-A scope.
- **SQL gates.**
  - Every RED-UNDER-M twin I traced reddens its own arm first: 1a, 1b, 2a, 2b, 3 and 4 in both new files, and R1 to R8.
  - No file has a skip-when-absent branch. Assertions run outside the exception handlers, which only capture SQLSTATE and message.
  - The R1, R3, R5, R6, R7 and R8 edit twins each have a `find` string that occurs exactly once in the migration.
  - Arm 3 of the timeout gate has an anti-vacuity guard (`3-SETUP`).
  - Each lane is its own `initdb` cluster, so the role-level `ALTER ROLE` twins cannot leak into other gate files.
- **Migrations.**
  - The trigger has no column list, judges the final row and sorts after every existing BEFORE UPDATE trigger on `api_keys` (baseline triggers checked).
  - `api_keys_user_id_fkey` is `ON DELETE CASCADE` with no `ON UPDATE` action, so neither deleting a profile nor running `sanitize_user` fires the freeze.
  - No repo code, seed or SQL fixture UPDATEs `api_keys.user_id`.
  - `insert_api_key` maps its columns correctly to the route's `encryptedColumns`, and the table default for `kek_version` is 1. The ACL REVOKE/GRANT pair and the self-verify block hold.
  - Both rollbacks are correct and carry the right warnings.
  - The timeout pin restates the measured values, and its self-check reads the catalogue only.
- **Census and floor moves.** These agree with each other:
  - `FILES_FLOOR` 96 -> 99 and `ARMS_FLOOR` 1079 -> 1099 (+6 +8 +6).
  - `SENTINEL_FLOOR` 38 -> 41 and `ARMS_FLOOR` (ci.yml) 589 -> 609. The listed sum matches.
  - `COMPARED_FLOOR` 148 -> 150, with two dated `snapshot-only` ratchet rows.
  - The test literals match.
  - No migration newer than `20261126180000` exists on `origin/main` (checked at review time), so the timestamps are still clear.

Necessity assessment: I did not read `necessity-review.md`, so the `necessity:` count is left out of the frontmatter.

## Warnings (MEDIUM)

### WR-01: MEDIUM: the builder's by-basis pin does not catch a whole-basis-object projection, so SC-1 has a hole

**File:** `src/lib/factsheet/fetch-and-build-payload.test.ts:1695` and `:1702` (twin at `:1825`)
**Classification:** neither user-facing nor data-integrity (a security-gate gap against the phase's own SC-1 wording)
**Issue:** SC-1 says "a test FAILS when a key outside the pinned alias set appears in the projection". The builder's select has two pins, and a two-level path such as `x:metrics_json_by_basis->cash_settlement` passes both. That path projects a whole basis object, including the series arrays the module docblock says must stay private. So does an unaliased `metrics_json_by_basis->cash_settlement`.
- The ban regex `/metrics_json(?!->|_by_basis->)/` exempts anything that starts `metrics_json_by_basis->`.
- The exact-set regex `/([a-z_]+):metrics_json_by_basis->([a-z_]+)->([a-z_]+)/g` matches only three-level paths, so the extra entry is never collected and `names` still equals the 21.

Verified with node:
```
select = "... x:metrics_json_by_basis->cash_settlement, a_b:metrics_json_by_basis->cash_settlement->sharpe ..."
ban matches: false        names: [ 'a_b' ]
```
The OG route is not affected: `route.test.tsx` also pins the admin select to exactly 21 comma-separated entries. The builder select has many other columns, so it has no such count.
**Fix:** count every occurrence of the column in the builder select:
```ts
const tokens = select.match(/metrics_json_by_basis[^,)\s]*/g) ?? [];
expect(tokens).toHaveLength(PINNED_BY_BASIS_ALIAS_NAMES.length);
// every occurrence is exactly <basis>-><key>: a whole column or a whole basis object fails
for (const t of tokens) expect(t).toMatch(/^metrics_json_by_basis->[a-z_]+->[a-z_]+$/);
```
Apply the same count at `:1825`.

### WR-02: MEDIUM: `test_insert_api_key_rpc.sql` never asserts the credential and label column mapping of the audited writer

**File:** `supabase/tests/test_insert_api_key_rpc.sql:49-58`, `:99`; migration `supabase/migrations/20261127120100_insert_api_key_rpc_and_user_id_immutable.sql:147-158`
**Classification:** data-integrity. It is latent until PR-B, which routes every key connect, seed and e2e insert through this function.
**Issue:** The gate's header says "The contract below is what those callers rely on, so each clause of it is an arm". The migration header says the function "mirrors the validate-and-encrypt route's insert column for column". Nothing in the gate tests that clause:
- Every call passes `'x'` for `p_api_key_encrypted` and NULL for `p_api_secret_encrypted`, `p_passphrase_encrypted`, `p_dek_encrypted`, `p_nonce` and `p_kek_version`.
- R1 SELECTs `label` but never compares it.

A positional swap in the INSERT's VALUES list passes all 8 arms, for example `p_api_secret_encrypted` with `p_passphrase_encrypted`, `p_dek_encrypted` with `p_nonce`, or `p_label` with `p_api_key_encrypted`. So does changing `COALESCE(p_kek_version, 1)`. All are `text`, or `integer` with a default. After PR-B such a swap stores keys that cannot be decrypted, or are mislabelled, and nothing goes red before the first sync fails. The mapping in the migration is correct today; this finding is about the gate, not the function.
**Fix:** add an arm R9 with distinct sentinel values for every parameter. Read the row back after `RESET ROLE` and compare each column. Add a twin that swaps two credential VALUES:
```sql
-- RED-UNDER-M: {"arm":"R9","apply":[{"kind":"edit","file":"supabase/migrations/20261127120100_insert_api_key_rpc_and_user_id_immutable.sql","find":"p_api_key_encrypted, p_api_secret_encrypted, p_passphrase_encrypted,\n    p_dek_encrypted, p_nonce,","replace":"p_api_key_encrypted, p_passphrase_encrypted, p_api_secret_encrypted,\n    p_nonce, p_dek_encrypted,","occurrences":1}]}
v_id := public.insert_api_key(v_owner, 'okx', 'lbl-r9', 'k-r9', 's-r9', 'p-r9', 'd-r9', 'n-r9', 7, NULL, NULL);
-- assert label='lbl-r9', api_key_encrypted='k-r9', api_secret_encrypted='s-r9',
-- passphrase_encrypted='p-r9', dek_encrypted='d-r9', nonce='n-r9', kek_version=7,
-- and a second call with p_kek_version omitted stores kek_version = 1
```
Moving the censuses with it means +1 arm in `ARMS_FLOOR` (both places), the sentinel count, and `mutation-runner-floors.test.ts`.

### WR-03: MEDIUM: OG route fails OPEN when the admin alias read returns no row, or no embed, without an error

**File:** `src/app/api/og/factsheet/[id]/route.tsx:232-252`; the test fake that treats this as normal is at `src/app/api/og/factsheet/[id]/route.public-access.test.tsx:169`
**Classification:** user-facing (the share card). The trigger is a race only.
**Issue:** The comment at `:229` says "Why a failure fails CLOSED: with the cash basis silently treated as absent, a lingering composite -> single row ... would show a stale headline". Only `adminRes.error` takes the failure branch. When the admin read answers `{ data: null, error: null }`, or a row whose `strategy_analytics` embed is null or `[]`, this happens:
- `byBasis` stays undefined, `failed` stays false and `data` is kept.
- `computeOgHeadline` gets `metrics_json_by_basis: undefined`, so `storedCashHeadlineGate` treats the cash basis as absent. That is exactly the stale-headline case the comment names.
- The card is then sent with the long `s-maxage=86400, stale-while-revalidate=604800` cache.

The admin read runs after a published-only session read that returned the embed. For a real row, the admin client answers 21 nulls, never "no row". So this path is reached only when the strategy is unpublished, or its analytics row is deleted, between the two reads. The P8b fake returns `data: null` and the test calls that "the same as a strategy with no stored by-basis values". That pins the open behaviour as correct, when a real row with no stored values answers an embed of nulls.
**Fix:** handle a missing row or missing embed in the same branch as an error:
```ts
const adminEmbed = embedOf((adminRes.data as {...} | null)?.strategy_analytics);
if (adminRes.error || !adminEmbed) {
  failed = true;
  reportOgFailure("read", id, adminRes.error ?? new Error("og: admin alias read returned no analytics row"));
  data = null;
} else {
  byBasis = rebuildMetricsJsonByBasis(adminEmbed);
}
```
Change the P8b fake so it returns an embed of 21 nulls (`byBasisAliasRow(null)`), and add a case where `data: null` expects the no-store generic card.

---

_Reviewed: 2026-11-27_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_

## Round 1: other lanes (orchestrator ruling, 2026-11-27)

- **migration-reviewer:** 0 MEDIUM+. Clean on both migrations and both rollbacks.
- **rls-policy-auditor:** 0 MEDIUM+. Clean on both migrations.
- **silent-failure-hunter:** 3 MEDIUM.
  - **SFH-F2** (OG admin read returns no row and no error, so the route fails open): the same finding as WR-03. It is fixed with WR-03.
  - **SFH-F1** (the rebuild turns "key absent" into null and drops an object with no numeric KPI): REJECTED as a defect.
    - The PROD census Q6 (RESEARCH, commit 01c3d8cc9) tests each key with `jsonb_typeof(...) = 'number'`. It found 0 present basis objects whose seven KPI keys are all non-numbers, and that count already includes `{}` and objects with no KPI keys.
    - The partial-key edge is recorded in the 243-03 SUMMARY. The writer always emits all seven keys.
    - The divergence is documented, accepted and pinned.
  - **SFH-F3** (`insert_api_key` defaults `p_dek_encrypted`, `p_nonce` and `p_kek_version`): REJECTED as a defect.
    - `api_keys.nonce` is legitimately NULL. The column comment reads "Currently NULL (Fernet handles nonce internally)".
    - The defaults copy the sibling `create_wizard_strategy` byte for byte.
    - The RPC is service_role-only, and service_role can already INSERT these columns directly. Adding NULL refusals would be a speculative defensive check, outside the minimal-fix rule.
    - The real risk is a column mix-up, and WR-02 covers it.

## Round 2

**Reviewed:** 2026-11-27, fixes `5cc1cf2ab..413cf8918` (three commits: `8f6b0c01e` WR-03, `4b0d38453` WR-01, `413cf8918` WR-02)
**Depth:** deep, MEDIUM and above only
**Result:** all three round-1 findings are resolved for what they named. One new MEDIUM is open: **WR-04**, a whole-column projection through `*` that the WR-01 pin does not catch. Status is `issues_found`.

### Per-finding verdict

| Finding | Verdict |
|---|---|
| WR-01 builder by-basis pin | **resolved** for every path that names the column. Whole column through `*` is still open, as WR-04. |
| WR-02 `insert_api_key` column mapping | **resolved** |
| WR-03 OG route fails open on no row or no embed | **resolved** |

#### WR-01: resolved

`fetch-and-build-payload.test.ts:1708-1712` (the 21-alias test) and `:1831-1835` (the 236-11 twin) now collect every `metrics_json_by_basis[^,)\s]*` token. They require exactly 21 tokens, each with the exact shape `^metrics_json_by_basis->[a-z_]+->[a-z_]+$`. The existing alias-name check (`by_basis_${basis}_${key}`) and the exact-set equality bind each of the 21 to its pinned basis and key.

I ran the three checks (token count, token shape, and the existing `metrics_json(?!->|_by_basis->)` ban) with node against the real select shape. That shape includes the newline the builder template puts in the embed. Every bypass fails at least one check, and the legitimate select passes:

| Bypass attempt | count | shape | ban |
|---|---|---|---|
| `x:metrics_json_by_basis->cash_settlement` (whole basis) | 22 | fail | - |
| `metrics_json_by_basis->cash_settlement` (unaliased basis) | 22 | fail | - |
| `metrics_json_by_basis` / `x:metrics_json_by_basis` (whole column) | 22 | fail | hit |
| `x:metrics_json_by_basis->>cash_settlement` (text arrow) | 22 | fail | - |
| `metrics_json_by_basis -> cash_settlement`, `\n->`, `\t->\t` (whitespace, which postgrest-js strips before sending) | 22 | fail | hit |
| `"metrics_json_by_basis"->...` (quoted), `y ( metrics_json_by_basis )` (parens), `::text` (cast) | 22 | fail | hit |
| `->cash_settlement->daily_returns->0` (four levels) | 22 | fail | - |
| one pinned entry REPLACED by a whole basis, so the count stays 21 | 21 | fail | - |

The `->>` case also fails the shape check at the `:1831` twin, which has no separate `->>` assertion.

⚠️ **One whole-column form gets through: `*`.** It is booked below as WR-04. Every row in the matrix NAMES the column, but a `*` inside the `strategy_analytics ( ... )` embed projects the whole column without naming it. With node, `strategy_analytics ( *, daily_returns, <the 21>, ... )` gives count 21, shape pass and ban miss, so all three checks pass.

#### WR-02: resolved

Arm R9 (`test_insert_api_key_rpc.sql:263-327`) calls the function with a distinct value for every parameter, including `p_kek_version = 7`, a padded login and a mixed-case padded server. It reads the row back after `RESET ROLE` and compares each column: `user_id`, `exchange`, `attested_venue`, `label`, the three credential columns, `dek_encrypted`, `nonce`, `kek_version`, and the normalised `venue_account_id` and `venue_server`. A second, named-parameter minimal call checks that an omitted `p_kek_version` stores 1 and every other omitted parameter stores NULL. All assertions sit outside any exception handler.

- **The twin is sound.** Its `find`, `p_api_key_encrypted, p_api_secret_encrypted, p_passphrase_encrypted,`, occurs exactly once in the migration (`grep -c` gives 1). The INSERT column list has no `p_` prefix, so it cannot collide. Under the swap, R1 to R8 still pass, because they pass `'x'` or NULL for both columns and never read either. R9 is therefore the first arm to go red, with its own `TEST FAILED (R9)` message.
- **The values cannot trip a constraint.** In `baseline.sql` the `api_keys` columns have no CHECK on `kek_version`, `dek_encrypted` or `nonce`, and no INSERT trigger reads them. The lane fixture 21 adds the five credential columns as plain `TEXT`/`INTEGER`.
- **The rows cannot collide.** R9's venue identities (`okx`/`acct-r9`, and `bybit` with a NULL login) collide with no earlier arm's row.
- **The other three swaps from round 1 are caught by R9's assertions** (dek with nonce, label with api_key, and dropping `COALESCE(p_kek_version, 1)`). Only one of them has a machine twin, and that is enough to prove the arm bites.
- **I did not run the arm on a lane.** I did not run the mutation runner's `--file` diagnostic, because it rewrites the migration file in place. The `RED (identity ok)` and `biting: 9` readings come from the fixer's MEASURED comment in `scripts/mutation-floors.mjs`. `--parse-only` here printed `arms: 0/1100/0` and `coverage: files 99/126`, and `lint-sql-gates` printed `scanned 126 file(s); 0 finding(s)`.

#### WR-03: resolved

The fix is at `route.tsx:239-257`. `adminRes.error || !adminEmbed` now takes the failure branch: it reports the failure, sets `failed`, sets `data = null`, and the card is sent no-store and generic. I checked whether this can wrongly fail a legitimate published row:

- **The embed shape.** `strategy_analytics.strategy_id` is `UNIQUE` (`strategy_analytics_strategy_id_key`, baseline `:16665`), so PostgREST returns a one-to-one embed as an object or null. `embedOf` (`route.tsx:128`) passes an object through and returns `[0]` of an array, so both shapes give the row. A real row's embed always carries the 21 alias KEYS, even when every value is null, so the object is truthy whether or not the row has stored by-basis values. Only `null`, `undefined` or `[]` reaches the fail-closed branch.
- **Whether a real row can answer no embed.** The admin read runs only after the session read returned a row with a non-empty embed (`route.tsx:232`). It uses the same `withPublishedOnly` predicate, which is the plain `status = 'published'` (`src/lib/visibility.ts:89`). It is keyed by the same id, and the admin client bypasses RLS. Anything the anon read saw, the admin read sees, unless the row is unpublished or its analytics row is deleted between the two reads. That race is the one case the branch exists for. No legitimate row is failed.
- **The tests.** `route.test.tsx` F1c is parametrised over no row, `strategy_analytics: null` and `strategy_analytics: []`. It asserts no-store, the named Sentry capture, the generic name, and no `computeOgHeadline` call. Against the pre-fix code, which kept `data` and sent the long cache, it would go red. Every OG test file's admin fake defaults to `byBasisAliasRow(null)`, the realistic all-null embed. P8b no longer pins the open behaviour.

### Census consistency

The census moves agree with each other:

| Census | Move |
|---|---|
| `scripts/mutation-floors.mjs` `ARMS_FLOOR` | 1099 -> 1100 (`FILES_FLOOR` stays 99) |
| `ci.yml` table row | `test_insert_api_key_rpc.sql` 8 -> 9 |
| `ci.yml` `ARMS_FLOOR` | 609 -> 610 (the listed sum changes one `8` to `9`; `SENTINEL_FLOOR` stays 41) |
| `drift-check-scripts.test.ts` | `ARMS_FLOOR=610` |
| `gate-family-meta.test.ts` | `ARMS_FLOOR=1100` |
| `mutation-annotation-parser.test.ts` | `armsSeen` 1100; `stepsSeen` and `needles.length` 1243 (+1 `edit` step) |
| `mutation-runner-floors.test.ts` | `totalAnchored` 1100; synthetic log 1100; per-file row 9/9/9/9; derived offsets 1099 and 1101 |

The one remaining bare `1099` (`mutation-runner-floors.test.ts:2895`, `rows sum to 1099`) is the derived "aggregate minus one" value, and it is correct.

### Regression check

I ran these at HEAD `413cf8918` and all pass:

| Check | Result |
|---|---|
| vitest, `src/app/api/og/factsheet`, `fetch-and-build-payload.test.ts`, `by-basis-projection.test.ts` | 9 files, 254 tests |
| vitest, `mutation-runner-floors`, `mutation-annotation-parser`, `gate-family-meta`, `contracts/ci-anti-skip-gate.contract`, `lint-sql-gates` | 5 files, 369 tests |
| vitest, `drift-check-scripts -t OPS-08-F9` | pass |
| `tsc --noEmit` | 0 errors |
| eslint on the changed `src/` files | clean |
| `lint-app-guc` | 0 findings |

The diff touches only the 16 files in its stat. No production code changed except `route.tsx`, and that change only narrows when the success branch runs.

**Other callers of the OG route.** Outside its own directory, only `src/lib/anon-strategies-live-probe.test.ts` (j) runs the route. It runs against a real local-stack database and skips when `HAS_ANON_PROBE` is false, so its admin read answers a real embed, never `data: null`. The other files that mention `og/factsheet` are census tests, the proxy, and helpers. None of them executes the route with an admin fake.

**R9 against the full schema.** The baseline `api_keys` CHECKs on the columns R9 writes are `api_keys_venue_account_id_nonblank` and `api_keys_venue_server_valid`, which checks only blank and length (`baseline.sql:14041-14042`). Neither ties `venue_server` to mt5: the "MT5 only" wording in the column comment is prose, not a constraint. The unique index is `(user_id, exchange, venue_account_id, COALESCE(venue_server, ''))` with `WHERE venue_account_id IS NOT NULL AND disconnected_at IS NULL` (`:16790`). R9's `okx`/`acct-r9` row matches no earlier row, so R9's `okx` row with a `venue_server` should also pass on the local-stack lane. That lane run was not observed either.

### New findings

#### WR-04: MEDIUM: a `*` in the builder's `strategy_analytics` embed projects the whole `metrics_json_by_basis` column, and no builder pin catches it

**File:** `src/lib/factsheet/fetch-and-build-payload.test.ts:1708-1712` and `:1831-1835`. The select under test is in `src/lib/factsheet/fetch-and-build-payload.ts:316-326`.
**Classification:** neither user-facing nor data-integrity. It is a gate gap in the same class as WR-01, against SC-1's "a test FAILS when a key outside the pinned alias set appears in the projection".

**Issue:** WR-01's three checks only see the column when it is NAMED, because each one keys on the substring `metrics_json_by_basis`. A `*` in the embed (`strategy_analytics ( *, daily_returns, ... )`) returns every column of `strategy_analytics`. That includes the whole `metrics_json_by_basis` object with its series arrays, and the whole `metrics_json`. Measured with node on the real select shape:
- the token count stays 21;
- every token keeps the exact shape;
- the `metrics_json(?!->|_by_basis->)` ban does not match.

The builder reads through `createAdminClient()`, so the DBACC-01 column revoke on `anon` does not stop it. These pins are the only guard. The OG route's admin select is not affected: `route.test.tsx` pins it to exactly 21 comma-separated entries, so a `*` would be a 22nd entry and fail. The same `*` also gets past the older Phase 194 `metrics_json` ban at `:1695`.

**Fix:** reject a star projection in the builder's strategies select, next to the token checks in both tests:
```ts
// A `*` projects every column, metrics_json_by_basis and metrics_json included, without naming either.
expect(select).not.toMatch(/(^|[\s,(])\*(?=\s*[,)]|\s*$)/);
```
A tighter alternative is to pin the `strategy_analytics ( ... )` field list as an exact set, the way `route.test.tsx` pins the admin select.

_Round 2 reviewed: 2026-11-27_
_Reviewer: Claude (gsd-code-reviewer)_

## Orchestrator ruling after round 2 (2026-11-27)

- **WR-04 (MEDIUM, open):** BOOKED, not fixed.
  - It is a gap in a test pin. It is neither user-facing nor data-integrity, and the builder reads through the admin client.
  - The repo review rule gives a non-user-facing MEDIUM no fixer round. The suggested fix is recorded above for whoever picks it up.
- **silent-failure-hunter round 2:** clean at MEDIUM+.
- **migration-reviewer and rls-policy-auditor:** not re-run. The fixes touch no migration, so their round-1 clean verdicts stand.
- **R9 measured by the orchestrator at 413cf8918:** `node scripts/mutation-runner/run.mjs --file supabase/tests/test_insert_api_key_rpc.sql` printed `arms: 9/9/0`, `biting: 9`, `lane-invocations: 9` and `No defects in the narrowed scope.`
