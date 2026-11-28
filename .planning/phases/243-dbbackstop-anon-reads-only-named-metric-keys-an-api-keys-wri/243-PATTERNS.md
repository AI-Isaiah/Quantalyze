# Phase 243: DBBACKSTOP - Pattern Map

**Mapped:** 2026-11-26
**Files analyzed:** 23 new or modified files (grouped below by requirement)
**Analogs found:** 21 exact or role-match / 23. Two have no analog: the `ALTER ROLE ... SET` pin migration and the role-config gate.

Tracked-source check (run 2026-11-26 from the worktree): every backticked path in this file was extracted (87) and tested with `git ls-files --error-unmatch`. None is untracked. Bare filenames (for example `GRAMMAR.md`, `live-db.ts`, fixture names) were resolved by basename against `git ls-files`, one tracked match each. The only paths that do not exist yet are the new files this phase creates (marked "new"), `<ts>` placeholders and the `supabase/schema/functions/*.sql` glob (individual generated files named in the text were checked). No gitignored mirror path appears. Line anchors were re-resolved with `grep -n` on anchor strings where the first read was un-numbered; where a range is approximate the text says "by symbol". The planner should still cite by symbol where possible (`plan-anchor-verify` fails on a bad `file:line`).

## File Classification

| New / Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---------------------|------|-----------|----------------|---------------|
| `src/lib/factsheet/by-basis-projection.ts` (new) | utility (select fragment + pure rebuild) | transform | `src/lib/figure-record-scalars.ts` (`RECORD_SCALAR_ALIASES`) | exact |
| `src/lib/factsheet/by-basis-projection.test.ts` (new) | test | transform | `src/lib/figure-record-scalars.test.ts` (alias pin block) | exact |
| `src/lib/factsheet/fetch-and-build-payload.ts` (edit, select at `:321`, reads at `:532`, `:663`) | service | request-response | itself (existing `->` aliases at `:323-325`) | exact |
| `src/lib/factsheet/fetch-and-build-payload.test.ts` (edit `:1696`, `:1805`, seeds) | test | request-response | itself (`:1674-1697`) | exact |
| `src/app/api/og/factsheet/[id]/route.tsx` (edit select at `:186`) | route | request-response | `fetch-and-build-payload.ts` alias select; `RECORD_SCALAR_ALIASES` concatenation at `:186-188` | exact |
| `src/app/api/og/factsheet/[id]/route.test.tsx` (edit `:487`) | test | request-response | itself (`:355-357`, `:487`) | exact |
| `src/lib/anon-strategies-live-probe.test.ts` (edit, add analytics arms) | test (live-DB) | request-response | itself (header `:1-40`, seed at `:222`) | exact |
| `supabase/migrations/<ts>_strategy_analytics_anon_column_revoke.sql` (+ `down/`) | migration | batch (grant DDL + catalogue verify) | `20261022120000_strategies_anon_api_key_id_revoke.sql` | exact |
| `supabase/tests/test_strategy_analytics_anon_grants.sql` (new) | test (SQL gate) | request-response | `supabase/tests/test_strategies_anon_grants.sql` | exact |
| `scripts/pg-lane/fixtures/45-fixture-strategy-analytics-anon-baseline.sql` (new, REQUIRED or the gate cannot go RED; name is the planner's, 44 is the highest today) | config (pg-lane stand-in fixture) | batch | `scripts/pg-lane/fixtures/10-fixture-strategies-rls-baseline.sql` (`:31` `GRANT ALL ON strategies TO anon, authenticated, service_role;`) + `27-fixture-strategy-analytics-computation-error.sql` (additive `ALTER TABLE public.strategy_analytics ADD COLUMN`) | exact |
| `supabase/migrations/<ts>_client_role_statement_timeout_pin.sql` (+ `down/`) | migration | batch | `20261022120000` (catalogue-only `DO $verify$` shape only) | partial. No `ALTER ROLE` precedent exists. |
| `supabase/tests/test_client_role_timeouts.sql` (new) | test (SQL gate) | request-response | `test_strategies_anon_grants.sql` (arm shape) + `test_api_key_delete_atomicity.sql:68,113` (`proconfig` read) | partial |
| `supabase/migrations/<ts>_api_keys_writer_rpc_and_user_id_immutable.sql` (PR-1) | migration (SECDEF RPC + BEFORE UPDATE trigger) | CRUD (insert) + event-driven (trigger) | RPC: `20261123180000_api_keys_venue_server.sql:101-292`. Trigger: `20261117120000_mt5_server_clock_readings.sql:231-260`. | role-match |
| `supabase/migrations/<ts>_api_keys_insert_fence.sql` (PR-3) | migration (BEFORE INSERT trigger on `current_user`) | event-driven | `20260811210000_api_keys_attested_venue.sql:515-552` + `20260515114310_redact_guc_bypass_use_current_user.sql:123-171` | role-match (inverted allow-list) |
| `supabase/tests/test_api_keys_user_id_immutable.sql` (new, with fence arms) | test (SQL gate) | event-driven | `supabase/tests/test_mt5_server_clock_readings.sql` (arms 5, 9b, 9c, 9d) | exact |
| `supabase/tests/test_api_keys_insert_not_client_writable.sql` (edit, invert arm 2 `:240-300`, extend `:130`) | test (SQL gate) | request-response | itself | exact |
| `src/app/api/keys/validate-and-encrypt/route.ts` (edit persist arm `:934-961`) | route | CRUD | `src/app/api/strategies/create-with-key/route.ts:2242-2260` (`rpcAdmin.rpc("create_wizard_strategy")`) + `src/lib/venue-identity.ts:184-212` | exact |
| `src/app/api/keys/validate-and-encrypt/route.test.ts` (edit, 65 `PERSIST_STATE.inserts` refs) | test | CRUD | itself (`:77-132`, `:158-282`, `:1596-1642`) | exact |
| `src/__tests__/audit-coverage.test.ts` (edit `MUTATING_RPC_NAMES`, `:380-448`) | test | transform | itself (`swap_account_slot` entry) | exact |
| `src/lib/database.types.ts` (hand-patch RPC `Functions` entry) | config (generated types) | transform | `swap_account_slot` entry `:4478-4486` | exact |
| `e2e/helpers/seed-test-project.ts` (8 insert sites) + `e2e/axe-app-wide.spec.ts:361`, `e2e/onboarding-funnel.spec.ts:153`, `e2e/reflow-sweep-authed.spec.ts:261` | utility (seed) | CRUD | `e2e/helpers/seed-test-project.ts:456-470` (current shape to replace) | exact |
| `scripts/seed-full-app-demo.ts:1572` (upsert) | utility (seed) | batch | itself | exact (needs a new shape, see notes) |
| `src/lib/test-helpers/live-db.ts` (new shared api_keys helper) + ~15 live vitest files | utility (test helper) | CRUD | `createTestUser` at `live-db.ts:47` | role-match |

## Pattern Assignments

### `src/lib/factsheet/by-basis-projection.ts` (utility, transform)

**Analog:** `src/lib/figure-record-scalars.ts`

**Why this analog:** it is the repo's one existing "alias fragment as an exported string + a coercion function, with a pin test" module. Same job, same reason for existing (several readers need one fragment, one coercion).

**Fragment-as-`string` pattern** (`figure-record-scalars.ts:29-34`):
```typescript
// Typed `string` on purpose, NOT a literal: postgrest-js parses a select string at the type
// level and its parser cannot read the `->-1` index of the `series_end` alias, so a literal
// types every row as a `ParserError` ... Callers cast the rows they read.
export const RECORD_SCALAR_ALIASES: string =
  "series_start:returns_series->0->>date, series_end:returns_series->-1->>date, headline_since:data_quality_flags->>headline_since, record_observations:metrics_json->record_observations";
```
Copy the `: string` typing. The OG route already concatenates it (`route.tsx:186-188`: `"... metrics_json_by_basis, " + RECORD_SCALAR_ALIASES + " )"`), and the new fragment goes in the same way. Callers cast the row (OG route casts at `route.tsx:~205`: `(res.data ?? null) as unknown as OgStrategyRow | null`).

**Key list source** (`src/lib/factsheet/basis-metrics.ts:20-28`): `BASIS_KPI_MAP` carries the seven server keys (`cumulative_return, volatility, max_drawdown, cagr, sharpe, sortino, calmar`). Bases are `cash_settlement`, `mark_to_market`, `smoothed_mtm`. The module builds 3 x 7 = 21 aliases. Use `->` (jsonb), never `->>` (text makes every KPI `NaN`; RESEARCH records this).

**Rebuild rule:** RESEARCH `## Code Examples` carries the sketch (`BY_BASIS_ALIASES`, `rebuildMetricsJsonByBasis`). It is the only part with no in-repo twin. Keep it pure, no `server-only` import (the same reason `figure-record-scalars.ts` header gives: client and server callers both need it). Omit a basis only when all seven values are null/undefined. PROD census Q6 found 0 degenerate rows, so the divergent edge is accept-and-pin.

---

### `src/lib/factsheet/by-basis-projection.test.ts` (test, transform)

**Analog:** `src/lib/figure-record-scalars.test.ts:38-57` (alias pin) and `:165-169` (byte-for-byte pin).

**Pin pattern to copy** (`figure-record-scalars.test.ts:50-56`):
```typescript
it("names exactly the four scalar aliases and never a whole blob column", () => {
  const names = RECORD_SCALAR_ALIASES.split(",").map((p) => p.trim().split(":")[0]);
  expect(names).toEqual(["series_start", "series_end", "headline_since", "record_observations"]);
  for (const whole of ["returns_series,", "metrics_json,", "data_quality_flags,"]) {
    expect(RECORD_SCALAR_ALIASES.includes(whole), `${whole} projected whole`).toBe(false);
  }
});
```
Adapt: assert the parsed alias NAMES equal a HAND-TYPED list of the 21 (not derived from `BASIS_KPI_MAP`, or the pin is tautological, per RESEARCH pitfall 3), fail on an extra or a missing key, and assert no bare `metrics_json_by_basis,`. Parse the select string out of `fake.strategySelects.join(" ")` (builder) and out of `STATE.observed.select` (OG route) with one regex, and assert both equal the same literal.

**Also cover (rebuild parity table):** basis present with finite headline, basis absent, `cumulative_return` null with another scalar non-null, all seven null (basis omitted, the one documented divergence).

---

### `src/lib/factsheet/fetch-and-build-payload.ts` and `.test.ts` (service / test)

**Analog:** itself.

**Select to edit** (`fetch-and-build-payload.ts:321-325`): the bare `metrics_json_by_basis` token inside the `strategy_analytics ( ... )` embed is replaced by the alias fragment. The existing aliases there show the idiom: `figure_defs_version:metrics_json->figure_defs_version, three_month:metrics_json->three_month`.

**Reader sites that take the object and must now receive the rebuilt one** (`:532`, `:663`):
```typescript
composite = await readCompositeFactsheet(supabase, {
  strategyId: id, dqf,
  metricsJsonByBasis: analytics?.metrics_json_by_basis,   // :532 -> rebuildMetricsJsonByBasis(analytics)
  returnsDenominatorConfig: strategy.returns_denominator_config,
});
...
singleKeyOpts = await readSingleKeyBasisOpts(() => supabase, id, dqf,
  analytics?.metrics_json_by_basis,                       // :663 -> same rebuilt value
  analytics?.computation_status, analytics, ...
```
Signatures stay `metricsJsonByBasis: unknown`.

**Test pin to tighten** (`fetch-and-build-payload.test.ts:1674-1697`, twin at `:1799-1806`):
```typescript
const select = fake.strategySelects.join(" ");
...
// The payload reaches anonymous viewers: no `metrics_json` that is not `_by_basis` or an arrow path.
expect(select).not.toMatch(/metrics_json(?!_by_basis|->)/);
```
The lookahead `(?!_by_basis|->)` EXEMPTS `metrics_json_by_basis`. That is the hole. Tighten both copies to `/metrics_json(?!->)/` so a bare `metrics_json_by_basis` fails.

**Seed pattern to migrate:** about 15 tests seed `metrics_json_by_basis: { cash_settlement: FULL_CASH }` (e.g. `:326-336`, `:1339`, `:1545`) through `analyticsRow(...)` (`:203`). Tests that go through the fake must seed alias fields (`by_basis_<basis>_<key>`) instead. `composite-read-path` unit tests take the object parameter and are unaffected.

---

### `src/app/api/og/factsheet/[id]/route.tsx` and `route.test.tsx` (route / test)

**Analog:** `RECORD_SCALAR_ALIASES` concatenation already in this file (`route.tsx:186-188`).

**Edit:** replace `metrics_json_by_basis, ` in the select string with the shared fragment, and rebuild the object before `computeOgHeadline` / `storedCashHeadlineGate` read it. The only consumer question on the OG side is "is `cash_settlement` a non-null non-array object" (`headline-basis.ts:309-313`, `og-metrics.ts:121-128`), which the rebuilt object answers.

**Sequencing:** this is the ONE anon reader of the column. It must be live on PROD before the column revoke ships (see Shared Patterns, O-1).

**Test:** `route.test.tsx:487` asserts `expect(STATE.observed.select).toMatch(/\bmetrics_json_by_basis\b/)`. That assertion goes red by design once the select carries aliases; replace it with the exact-set pin. `:480` seeds `metrics_json_by_basis: { cash_settlement: { sharpe: 9 } }`, which becomes alias seeds.

---

### `src/lib/anon-strategies-live-probe.test.ts` (live-DB test, edit)

**Analog:** itself. Header `:1-40` explains the visitor construction (`createClient()` mocked to a bare anon-key client). It gates on `HAS_LIVE_DB` so `scripts/live-db-lane-corpus.mjs` derives it into the lane. Add arms: anon is refused `metrics_json_by_basis` with 42501, anon can still read the named columns, and the real OG reader renders under the revoked grant. `:222` is the existing `strategy_analytics` seed insert to reuse. Do not create a new harness.

---

### `supabase/migrations/<ts>_strategy_analytics_anon_column_revoke.sql` (+ `down/<ts>-rollback.sql`)

**Analog:** `supabase/migrations/20261022120000_strategies_anon_api_key_id_revoke.sql` (exact; same two-step shape, same reason).

**Core pattern** (`:108-143`, one `DO $verify$` block holding REVOKE, GRANT and proof):
```sql
DO $verify$
DECLARE
  v_rel     regclass := 'public.strategies'::regclass;
  v_verbs   text[]   := ARRAY['SELECT','INSERT','UPDATE','DELETE'];
  v_roles   text[]   := ARRAY['authenticated','service_role'];
  ...
BEGIN
  -- (1) record what authenticated/service_role hold before any change
  SELECT string_agg(r.rolname || '/' || v.verb, ',' ORDER BY r.rolname, v.verb) INTO v_before
    FROM unnest(v_roles) AS r(rolname) CROSS JOIN unnest(v_verbs) AS v(verb)
   WHERE has_table_privilege(r.rolname, v_rel, v.verb);
  -- (2) anon loses the table-level privileges (and, with them, every column-level grant)
  REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE public.strategies FROM anon;
  -- (3) column SELECT on every column but the hidden one, DERIVED from the catalogue
  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) INTO v_cols
    FROM pg_attribute a
   WHERE a.attrelid = v_rel AND a.attnum > 0 AND NOT a.attisdropped AND a.attname <> 'api_key_id';
  EXECUTE format('GRANT SELECT (%s) ON TABLE public.strategies TO anon', v_cols);
```
Swap `strategies`/`api_key_id` for `strategy_analytics`/`metrics_json_by_basis`.

**Self-check pattern** (`:147-179`): `has_column_privilege('anon', v_rel, '<col>', 'SELECT')` must be false; `has_table_privilege('anon', v_rel, 'SELECT')` false; a `v_missing` sweep over `has_column_privilege(..., a.attnum, 'SELECT')` for every other column; authenticated/service_role before/after equality. Each failure: `RAISE EXCEPTION 'migration <ts> failed: ...'`.

**Constraints to carry (from the analog's header):**
- Derive the column list from `pg_attribute`, never type it (the pg-lane builds a fixture-sized table).
- Catalogue only, no row read (`scripts/lint-migration-data-dependence.mjs` refuses a data-reading guard; TEST is schema-only).
- A REVOKE with a grantor mismatch is silent, hence the proof inside the same block.
- Header carries the O-1 paragraph (readers deployed first), the DEFAULT-DENY paragraph (a later column is anon-invisible until granted), and the rollback pointer.
- Decide in the plan whether to also revoke anon's INSERT/UPDATE/DELETE on `strategy_analytics` (the precedent did; RESEARCH Open Question 3). If kept, copy the `v_verbs` handling; if narrowed to SELECT only, the verbs array shrinks to `ARRAY['SELECT']`.

**Rollback file analog:** `supabase/migrations/down/20261022120000-rollback.sql` (header explains why `REVOKE SELECT ON TABLE` goes first, ledger row left in place, marker-query reminder). Copy the header structure.

---

### `supabase/tests/test_strategy_analytics_anon_grants.sql` (SQL gate)

**Analog:** `supabase/tests/test_strategies_anon_grants.sql` (exact; 216 lines, read in full).

**Skeleton to copy:**
- Header prose naming each arm, the HIDDEN_COLUMN_EXEMPTIONS rule, the fixture-grants note, and "NO SKIP-WHEN-UNAPPLIED BRANCH" (`:1-63`).
- `-- RED-UNDER-SETUP: {"apply":[...fixtures..., "<new migration path>"]}` with the migration LAST (`:73`), so `scripts/sql-gate-subset.mjs` selects the gate on a push that changes the migration.
- `BEGIN; DO $$ ... END $$; ROLLBACK;` with one `DO` block.
- Arms and their twins, verbatim shape (`:97-137`):
```sql
  -- RED-UNDER: hand the column back to anon on the live lane — ...
  -- RED-UNDER-M: {"arm":"GRANT 1","apply":[{"kind":"sql","stmt":"GRANT SELECT (api_key_id) ON public.strategies TO anon"}]}
  IF has_column_privilege('anon', v_rel, 'api_key_id', 'SELECT') THEN
    RAISE EXCEPTION 'TEST FAILED (GRANT 1): ...';
  END IF;
```
- GRANT 2 and GRANT 4 twins carry `"neuter":[{"arm":"GRANT 1"}]` because GRANT 1 fires first (`:112`, `:170`).
- GRANT 3 has a `-SETUP` guard against a vacuous sweep (`:122-124`).
- GRANT 4 behavioural probe (`:143-162`): `SET LOCAL ROLE anon;`, handlers record only state and SQLSTATE, assertions read AFTER `RESET ROLE` (lint rule R1 forbids probing inside an exception handler). Assert 42501 naming the table for the hidden column and success for a read of named columns.
- KEEP arm for authenticated and service_role.
- Closing `RAISE NOTICE '... OK ...'`. **Sentinel:** the `ci.yml` step (`:4733-4785`) is `sentinel="$(grep -aE "RAISE NOTICE '[^']*ALL [0-9]+ ARMS EXECUTED" "$f" ...)"; if [ -n "$sentinel" ]; then ...`. So it polices only files that DECLARE a sentinel: the printed notice must appear, and once declared the roster `(1, 2a, ...)` is MANDATORY and its token count must equal N. Declaring one is therefore optional per file, which is why RESEARCH's "requires the sentinel" reads stronger than the code (RESEARCH is right that a file that declares one must name the roster). The analog `test_strategies_anon_grants.sql` declares none (its last notice is `strategies anon grants OK: ...`); `test_api_key_flow_prices.sql:613` and `test_mt5_server_clock_readings.sql` (last `RAISE NOTICE`) do. **Recommendation:** declare one on each NEW multi-arm gate (this file, `test_client_role_timeouts.sql`, `test_api_keys_user_id_immutable.sql`). Without it an arm deleted in place leaves the file exiting 0; the analog's missing sentinel is a weakness not to copy.

**Fixture reality (MEASURED, not open): a NEW pg-lane fixture is required.** `grep -n` over `scripts/pg-lane/fixtures/*.sql` shows:
- `strategy_analytics` is created only by `03-fixture-compute-jobs.sql:42-47` with five columns (`strategy_id, computation_status, computed_at, computing_started_at, returns_series`). `:53` adds `data_quality_flags`; `05`, `08` (`daily_returns`), `19` and `27` add a few more. **No fixture defines `metrics_json_by_basis`** (zero matches for the string in any fixture), so on the lane the hidden column does not exist and a GRANT 3-SETUP guard would fire or an arm would pass vacuously.
- **No fixture grants anything on `strategy_analytics`** (zero matches for `GRANT.*strategy_analytics`). `07-fixture-supabase-default-privileges.sql` only sets `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES`, which is not retroactive to a table an earlier fixture already created. So without a fixture, anon holds no table SELECT on the lane, GRANT 1 is green before the migration, and the gate cannot fail.
- So add one fixture, listed in `RED-UNDER-SETUP` after 03/05/08/19/27 and before the migration, doing exactly what fixture 10 does for `strategies` plus the missing column: `ALTER TABLE public.strategy_analytics ADD COLUMN IF NOT EXISTS metrics_json_by_basis JSONB;` and `GRANT ALL ON public.strategy_analytics TO anon, authenticated, service_role;`. Copy the explanatory header style of fixture 10 (why the grant is not cosmetic). Confirm RED-without-migration on a lane run before relying on it.
- GRAMMAR rule 4 (`scripts/mutation-runner/GRAMMAR.md:361-397`): no `RED-UNDER-M` `apply` step may name a file under `scripts/pg-lane/fixtures/` (refused at parse time). The twins here are all `"kind":"sql"` steps (grant changes on the live lane), which is allowed; listing the fixture in `RED-UNDER-SETUP` is allowed.
- Row-level security is irrelevant to GRANT 1-3 and to the 42501 in GRANT 4 (the grant layer refuses before RLS), so the probe table needs no policy. For GRANT 4's positive read use columns the fixtures define (for example `strategy_id, computation_status, computed_at`), never the hidden one.
Do not take positive controls from a probe table created by the gate (the 2026-10-30 platform default-grant withdrawal affects new tables, per RESEARCH).

---

### `supabase/migrations/<ts>_client_role_statement_timeout_pin.sql` and `supabase/tests/test_client_role_timeouts.sql` (DBACC-03)

**Analog: none for the statement itself.** `grep -rln "ALTER ROLE" supabase/migrations` and `grep -rln "rolconfig\|pg_db_role_setting"` over `supabase/tests`, `scripts`, `src` both return nothing. There is also no `NOTIFY pgrst` in any migration. Planner uses RESEARCH `## DBACC-03 Findings` for the statements (`ALTER ROLE anon SET statement_timeout = '3s'`, `ALTER ROLE authenticated SET statement_timeout = '8s'`, then `NOTIFY pgrst, 'reload config'`).

**Partial analogs to copy for form only:**
- Migration verify block: catalogue-only `DO $verify$` with `RAISE EXCEPTION 'migration <ts> failed: ...'` per failure (`20261022120000:108-181`). Read `pg_roles.rolconfig` instead of `has_*_privilege`. No row of an application table.
- `SET LOCAL lock_timeout = '3s';` at the head, no explicit `BEGIN`/`COMMIT` (migration-reviewer invariant 14; precedent `20261123180000:63-78`).
- Gate arm shape and `RED-UNDER-M` twins: `test_strategies_anon_grants.sql`. For the twin, use a `kind:"edit"` on the new migration file changing `'3s'` to `'60s'` (Shape 1, `GRAMMAR.md:468-476`), not a `sql` step.
- The `pg_proc.proconfig` read for "no function executable by anon/authenticated carries `statement_timeout`": `supabase/tests/test_api_key_delete_atomicity.sql:68` and `:113` read `prosrc, proconfig` for one function. A sweep over all functions is new; if it matches function bodies, apply lint rule R2 (`scripts/lint-sql-gates.mjs:135`, strip comments with `regexp_replace(..., '--[^\n]*', '', 'g')`; see `test_wizard_composite_fence.sql:182-198` for the idiom).

**Placement (RESEARCH):** host the arm on the pg-lane (vanilla `initdb`, `scripts/pg-lane/run.sh:406` creates roles with no config, so the arm is RED unless the migration applies). A local-stack-only arm may pass vacuously. A green `rolconfig` read does not prove PostgREST applies it; only the recorded TEST REST measurement does. State that in the gate header.

---

### `supabase/migrations/<ts>_api_keys_writer_rpc_and_user_id_immutable.sql` (PR-1)

#### Part A: the writer RPC

**Analog:** `supabase/migrations/20261123180000_api_keys_venue_server.sql` (`create_wizard_strategy`, `:97-237`, the latest definition; `supabase/schema/functions/create_wizard_strategy.sql` is the generated canonical copy).

**SECDEF header, gate, normalisation** (`:101-151`, `:194-206`):
```sql
CREATE FUNCTION public.create_wizard_strategy(p_user_id UUID, p_exchange TEXT, ... , p_venue_account_id TEXT DEFAULT NULL, p_venue_server TEXT DEFAULT NULL)
RETURNS TABLE(strategy_id UUID, api_key_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
SET lock_timeout = '3s'
AS $$
DECLARE v_jwt_role TEXT; ...
BEGIN
  BEGIN
    v_jwt_role := auth.role();
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;
  IF v_jwt_role IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'create_wizard_strategy: caller role (%) may not write wizard drafts', COALESCE(v_jwt_role, '<none>')
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION '... p_user_id must not be NULL' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  ...
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, api_secret_encrypted, passphrase_encrypted,
                        dek_encrypted, nonce, kek_version, is_active, attested_venue, venue_account_id, venue_server)
  VALUES (p_user_id, p_exchange, p_label, ..., COALESCE(p_kek_version, 1), TRUE,
          p_exchange, NULLIF(btrim(p_venue_account_id, E' \t\r\n'), ''), NULLIF(lower(btrim(p_venue_server, E' \t\r\n')), ''))
  RETURNING id INTO v_key_id;
```
The new RPC mirrors the route's insert columns (`attested_venue = p_exchange`, same normalisation), returns `uuid`. Never use `current_user`/`session_user` as the gate inside a DEFINER body (the analog's `:132-133` comment says why).

**ACL pair and the one-overload rule** (`:224-237`):
```sql
REVOKE ALL ON FUNCTION public.create_wizard_strategy(uuid, text, ...) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_wizard_strategy(uuid, text, ...) TO service_role;
COMMENT ON FUNCTION ... IS '... EXACTLY ONE OVERLOAD OF THIS FUNCTION MAY EXIST: PostgREST resolves rpc() by named parameters and answers PGRST203 if a second candidate appears. ...';
```
A NEW function created with plain `CREATE FUNCTION` still gets `pg_default_acl` grants to anon/authenticated, so the REVOKE is mandatory, and any later DROP+CREATE must re-issue the pair.

**Post-verify DO block (catalogue only)** (`:247-292`): exactly one overload via `count(*)` on `pg_proc`; `to_regprocedure(...)` resolves; `prosecdef`; `has_function_privilege('service_role', ...)` true, `anon`/`authenticated` false; no PUBLIC grant via `aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner)))` with `grantee = 0`. Its comment (`:239-246`) explains why the block does NOT assert what a gate mutates.

**Second DEFINER sibling for contract parity:** `add_wizard_composite_key` (`supabase/schema/functions/add_wizard_composite_key.sql`, source `20260814120000_wizard_rpcs_revoke_authenticated.sql`) is the same gate and an `INSERT INTO api_keys` at `:97`. Its header (`:6-10`) says "ONE CONTRACT WITH TWO ENTRY POINTS". The new RPC copies the same gate.

#### Part B: the `user_id` immutability trigger (every role, BYPASSRLS included)

**Analog:** `supabase/migrations/20261117120000_mt5_server_clock_readings.sql`, STEP 4 header at `:207`, `CREATE FUNCTION` at `:231`, `REVOKE` at `:255`, `CREATE TRIGGER` at `:257-260` (`enforce_mt5_server_clock_readings_write_once`), the repo's "refuses every role, owner included" trigger. Function body at `supabase/schema/functions/enforce_mt5_server_clock_readings_write_once.sql`.

```sql
CREATE FUNCTION public.enforce_mt5_server_clock_readings_write_once()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = public, pg_temp
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'mt5_server_clock_readings is write-once: a stored reading is never updated'
      USING ERRCODE = 'check_violation';
  END IF;
  ...
$function$;
REVOKE ALL ON FUNCTION public.enforce_mt5_server_clock_readings_write_once() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER mt5_server_clock_readings_write_once
  BEFORE UPDATE OR DELETE ON public.mt5_server_clock_readings
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_mt5_server_clock_readings_write_once();
```
Adapt: `BEFORE UPDATE OF user_id ON public.api_keys FOR EACH ROW WHEN (OLD.user_id IS DISTINCT FROM NEW.user_id)` (the `WHEN` clause so an upsert's same-value assignment passes, RESEARCH pitfall 5). No role allow-list (decision: every role). `RAISE ... USING ERRCODE = 'insufficient_privilege'` or `check_violation`, a single literal message that echoes no row value. Name the trigger so it sorts before the scrub triggers (existing names: `api_keys_account_share_same_owner`, `api_keys_lock_exchange`, `api_keys_published_composite_delete_guard`, `api_keys_scrub_attested_venue`, `api_keys_scrub_venue_account_id`, `api_keys_stamp_first_added`, all at `supabase/schema/baseline.sql:17362-17398`; Postgres fires same-event triggers in name order).

**Single-column UPDATE trigger precedent (style):** `api_keys_lock_exchange BEFORE UPDATE OF "exchange"` running `prevent_api_key_venue_change` (`supabase/schema/functions/prevent_api_key_venue_change.sql`). Note that function ALLOWS `postgres, service_role, supabase_admin`; the immutability trigger must NOT copy that allow-list.

**Deletion-guard exemption:** neither new trigger fires on DELETE, and `sanitize_user` only DELETEs `api_keys` (`supabase/schema/functions/sanitize_user.sql:144`), so no `quantalyze.sanitize_in_progress` exemption is needed. The plan still needs one arm proving `sanitize_user` completes with both triggers present (RESEARCH).

---

### `supabase/migrations/<ts>_api_keys_insert_fence.sql` (PR-3)

**Analog (mechanism):** `scrub_client_supplied_attested_venue` in `supabase/migrations/20260811210000_api_keys_attested_venue.sql:515-552` and Migration 127's `guard_wizard_draft_updates` (`20260515114310_redact_guc_bypass_use_current_user.sql:123-171`).

**Why `current_user` and not a GUC** (Migration 127 header `:6-58`): any role may `SELECT set_config('quantalyze.<x>', 'on', true)` on a custom namespace, so a GUC fence is forgeable. `current_user` shifts atomically at the function-call boundary. Founder confirmed the `current_user` mechanism 2026-11-26.

**Shape to copy** (`20260811210000:515-552`; same text in `scrub_client_supplied_venue_account_id.sql`):
```sql
CREATE OR REPLACE FUNCTION public.scrub_client_supplied_attested_venue()
RETURNS TRIGGER
LANGUAGE plpgsql
-- ⛔ SECURITY INVOKER (the default — stated explicitly) is LOAD-BEARING ... under
-- SECURITY DEFINER, current_user would be this function's owner and the privileged-caller
-- check below would ALWAYS pass, making the trigger a silent no-op.
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
    RETURN NEW;
  END IF;
  NEW.attested_venue := NULL;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS api_keys_scrub_attested_venue ON public.api_keys;
CREATE TRIGGER api_keys_scrub_attested_venue BEFORE INSERT ON public.api_keys
FOR EACH ROW EXECUTE FUNCTION public.scrub_client_supplied_attested_venue();
```
**Locked rule vs recommended shape (surface, do not blend).** CONTEXT (`## DBACC-02`, mechanism correction 2026-11-26) states the rule as a REFUSED set: the BEFORE INSERT trigger "refuses when `current_user` is a client or API role (`anon`, `authenticated`, `service_role`). A postgres-owned SECDEF writer body runs as its owner and passes, and so do direct `postgres` sessions (migrations, SQL fixtures)". RESEARCH (shape B) recommends the opposite polarity: an ALLOW-list `('postgres','supabase_admin')`, deny by default. The two differ for any role named in neither (a deny-list admits it, an allow-list refuses it). Both pass every fixture on the pg-lane, because the lane's only login and fixture role is `postgres` (`scripts/pg-lane/run.sh:374` `initdb -D ... -U postgres`; `:222` `psqlq` connects `-U postgres`). `supabase_admin` does not exist on the lane, so listing it is harmless there. The plan must pick one and pin it with an arm that tries a third role; this map recommends the allow-list (fail-closed, matches "refuses any insert made outside a sanctioned SECDEF writer"), but CONTEXT's literal wording is the deny set, so confirm with the orchestrator before writing the migration.

**The fence INVERTS the existing scrub allow-list.** Both scrub triggers admit `service_role` on purpose (the `venue_account_id` sibling says so explicitly: `supabase/schema/functions/scrub_client_supplied_venue_account_id.sql:27`, "service_role is in this list ON PURPOSE"); the fence must REFUSE `service_role`, `authenticated` and `anon` (CONTEXT), and admit the owners of a SECDEF writer body, migrations and SQL fixtures (`postgres`, plus `supabase_admin` under RESEARCH's shape). Refuse with `insufficient_privilege`. Keep `SECURITY INVOKER` and `SET search_path = public, pg_catalog`, `REVOKE ALL ... FROM PUBLIC, anon, authenticated`.

**Two caveats the plan must test:**
- `BEFORE INSERT` fires on `INSERT ... ON CONFLICT DO UPDATE` before conflict resolution. The demo seed's idempotent upsert dies at the fence even for an existing id (RESEARCH pitfall 6).
- The catalogue arm pinning the exact set of functions whose body inserts into `api_keys` is new. Today that set is `create_wizard_strategy`, `add_wizard_composite_key` and the new RPC (`grep -rln "INSERT INTO \(public\.\)\?api_keys" supabase/schema/functions/` returns the first two). Apply lint rule R2 (comment strip) if it matches `prosrc` or `pg_get_functiondef` text.

**Timing:** lands only after PR-2 (callers on the RPC) is live on PROD. Collapsing PR-2 and PR-3 would 42501 every connect.

---

### `supabase/tests/test_api_keys_user_id_immutable.sql` (new SQL gate, includes fence arms)

**Analog:** `supabase/tests/test_mt5_server_clock_readings.sql` (exact for "trigger refuses every role" gates).

**Behaviour arm** (arm 5, `:582-612`): seed as the owner role, snapshot with `to_jsonb(t)`, run the refused statement in a nested block capturing `GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT`, assert SQLSTATE AND message text, re-read and assert the row image is unchanged:
```sql
  BEGIN
    UPDATE public.mt5_server_clock_readings SET symbols_visible = 99 WHERE api_key_id = v_k;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  IF v_state IS DISTINCT FROM '23514' OR v_msg NOT LIKE 'mt5_server_clock_readings is write-once: ...%' THEN
    RAISE EXCEPTION 'TEST FAILED (5): ...';
  END IF;
```
Its twin is a `kind:"edit"` replacing the RAISE with `RETURN NEW;` (`:590`).

**Catalogue arms** (`:810-851`): 9b `tgtype` compared for equality with a computed integer (not a mask), `tgenabled = 'O'`, `tgname`, function name; 9c `NOT p.prosecdef`; 9d `has_function_privilege(role, '<fn>()', 'EXECUTE')` false for anon and authenticated. Compute `tgtype` for `BEFORE UPDATE FOR EACH ROW` (1+2+16 = 19) and for `BEFORE INSERT FOR EACH ROW` (1+2+4 = 7). The `WHEN` clause shows in `pg_get_triggerdef`, not in `tgtype`.

**Arms to include (from CONTEXT/RESEARCH):** `user_id` UPDATE refused for postgres, service_role (`SET LOCAL ROLE`), and a BYPASSRLS role; a same-value assignment (upsert path) passes; direct INSERT as `service_role` and `authenticated` refused; INSERT through the writer RPC succeeds and keeps `attested_venue`; `sanitize_user` completes; the function-set pin; trigger-order arm; `ALL N ARMS EXECUTED (roster)` sentinel.

**Header line:** `RED-UNDER-SETUP` must list the fixtures and every migration the arms exercise (copy the long list at `test_api_keys_insert_not_client_writable.sql:130`, then add `20260920120000`/`20260925120000`/`20261123180000`-line migrations that the new RPC depends on, the new PR-1 and PR-3 migrations LAST). Fixtures relevant to `api_keys` columns: `11-fixture-api-keys-created-at.sql`, `21-fixture-api-keys-credential-columns.sql`, `25-fixture-api-keys-e2e-census-seed.sql`, `35-fixture-api-keys-venue-account-id.sql`, `41-fixture-api-keys-user-id-fk.sql`. Re-derive the list by running the gate on a lane, not by eye.

---

### `supabase/tests/test_api_keys_insert_not_client_writable.sql` (edit)

**Analog:** itself. Arm (2) at `:249-297`:
```sql
  SET LOCAL ROLE service_role;
  ...
    INSERT INTO public.api_keys (id, user_id, exchange, label, api_key_encrypted, attested_venue)
    VALUES (v_key_a1, v_uid, 'deribit', 'rank03-a1', 'x', 'deribit');
  ...
  IF v_err IS NOT NULL THEN
    RAISE EXCEPTION 'OUTAGE (2): a service_role INSERT into api_keys was REFUSED (%) ...
```
**Must be INVERTED in the same commit as the fence migration** (RESEARCH): a direct `service_role` INSERT is refused, and an insert through the writer RPC (called as `service_role` with `request.jwt.claims` role `service_role`, as `:176-178` shows for `authenticated`) succeeds and retains attestation.

**It needs a RE-SHAPE, not a flip.** As written, arm (2) fails with `OUTAGE (2)` and `RANK-03 REGRESSION (2)` messages and carries NO `RED-UNDER` or `RED-UNDER-M` (the file's only twins are on arms 1, 3 and 4, at `:185-191`, `:217-225`, `:392-402`; the rest are un-twinned). A bare inverted arm (2) would therefore be an arm that cannot be proven to bite. Rewrite it in the `TEST FAILED (2a)` / `TEST FAILED (2b)` idiom with a twin each, modelled on arms 1, 3 and 4 and on `test_mt5_server_clock_readings.sql` arm 5 (`:582-612`): (2a) direct `service_role` INSERT is refused, captured with `GET STACKED DIAGNOSTICS ... RETURNED_SQLSTATE` and a message match, row count unchanged; twin = `kind:"edit"` on the fence migration turning its refusal into `RETURN NEW;`. (2b) the RPC insert lands and `attested_venue` reads back equal to `exchange`; twin = an `edit` removing the `attested_venue` column from the RPC's INSERT (or a `sql` step revoking `service_role` EXECUTE on the RPC). Keep the "POSITIVE, ALWAYS ACTIVE" anti-vacuity role of the old arm (2) in (2b). Also re-check arm 3 (`:226-247`): it asserts the OLD scrub trigger is INVOKER and enabled; that stays true. Its `RED-UNDER-SETUP` list (`:130`) gains the new migrations. Assertion 3 (`:226-247`, trigger present, enabled, INVOKER) is the model for the fence's own structural control.

Other non-postgres sites: `test_api_keys_exchange_not_user_writable.sql:519,611` (as `authenticated`, expected refused, unaffected).

---

### `src/app/api/keys/validate-and-encrypt/route.ts` (route, CRUD)

**Analog:** `src/app/api/strategies/create-with-key/route.ts:2205-2260` (service-role writer RPC call from a route) and `src/lib/venue-identity.ts:184-212` (`swapAccountSlot`: a thin wrapper returning `{ ok: true } | { ok: false; error }`, passing `p_venue_server` only when non-null).

**Admin client with a fail-loud 503** (`create-with-key/route.ts:2211-2232`; `let rpcAdmin` at `:2211`): `try { rpcAdmin = createAdminClient(); } catch` → scrubbed log → `SEAM_MISCONFIGURED` 503. The validate-and-encrypt route already builds `admin` earlier; keep its existing handling.

**Call-site pattern with the audit pragma** (`create-with-key/route.ts`: pragma `:2237`, call `:2242`):
```typescript
// @audit-skip: wizard draft — create_wizard_strategy writes draft strategies + api_keys not yet user-visible. ...
const { data, error } = await rpcAdmin.rpc("create_wizard_strategy", {
  p_user_id: user.id,
  p_exchange: exchangeNormalized,
  ...
  p_kek_version: kek_version,
  ...
});
```
**Current code to replace** (`validate-and-encrypt/route.ts`: pragma at `:934`, `.insert({` at `:937`): `// @audit-skip: key connect — ...` then `admin.from("api_keys").insert({...encryptedColumns, user_id: userId, exchange: exchangeNormalized, attested_venue: exchangeNormalized, label: labelOrDefault, venue_account_id: failingHolderId === null ? venueAccountId : null, venue_server: failingHolderId === null ? venueServer : null }).select("id").single()`. The `@audit-skip` pragma must stay within 8 lines ABOVE the `.rpc(` call, and the call must carry the name as a quoted literal on the same line as `.rpc(` (`audit-coverage.test.ts:453-455` regex).

**Error handling to keep unchanged** (`:963-1015`; the 23505 test is at `:972`; the compensating DELETE pragma is at `:1059`): the 23505 branch reads `insertError?.code === "23505" && pgConstraintName(insertError) === VENUE_IDENTITY_CONSTRAINT`. `pgConstraintName` parses the error `message` (`src/lib/api/pgConstraintName.ts:93-99`), which PostgREST passes through for a raised unique violation from an RPC. The RPC result is a scalar uuid in `data`, not `{ id }`, so `typeof inserted?.id !== "string"` becomes a check on `data`. Pin the 23505 mapping with the existing route test. Omit `p_venue_account_id` / `p_venue_server` when null (the `create-with-key` comment at `:2288` explains the "omitted, not sent as null" rule).

**Compensating DELETE** (`:1061`, `.from("api_keys").delete()...`) is unaffected: the fence is BEFORE INSERT only.

---

### `src/app/api/keys/validate-and-encrypt/route.test.ts` (test)

**Analog:** itself. The mock already records RPCs:
```typescript
rpc: async (name: string, args: Record<string, unknown>) => {
  PERSIST_STATE.rpcCalls.push({ name, args });
  return PERSIST_STATE.rpcResult ?? { data: null, error: null };   // :162-165
},
...
insert: (payload) => { PERSIST_STATE.inserts.push({ ...payload, __table: table });
  return { select: () => ({ single: async () => PERSIST_STATE.insertResult ?? { data: { id: "persisted-key-id" }, error: null } }) }; },   // :267-278
```
**Migration to do:** 65 references to `PERSIST_STATE.inserts` (the RANK-03 oracle at `:1596-1642` asserts `row.exchange`, `row.attested_venue`, `row.user_id`, totality over `EncryptKeyResponseSchema.shape`) move to `PERSIST_STATE.rpcCalls.filter(c => c.name === "<new rpc>")` and the `p_*` argument names. The default rpc answer `{ data: null, error: null }` must become a uuid for the new RPC while still serving `swap_account_slot`. Keep the "empty means no write" oracle semantics (`:73-76`, `:1941`, `:1978`: `expect(PERSIST_STATE.inserts).toEqual([])` becomes an empty RPC-call list). Keep the hostile-body test (`:1596-1624`): `user_id` from the session, never the body.

---

### `src/__tests__/audit-coverage.test.ts` (edit)

**Analog:** itself. Add the new RPC name to `MUTATING_RPC_NAMES` (`:380-448`) with a comment in the established style (each entry carries a dated phase comment, e.g. `swap_account_slot`, Phase 225, `:393-396`). Without the entry the `@audit-skip` pragma at the call site is decorative (the SEC-03 lesson recorded at `:397-405`). Regex: `MUTATING_RPC_RE` at `:453-455`.

---

### `src/lib/database.types.ts` (hand-patch)

**Analog:** the `swap_account_slot` entry at `:4478-4486`:
```typescript
swap_account_slot: {
  Args: { p_new_key: string; p_old_holder: string; p_venue_account_id: string; p_venue_server?: string }
  Returns: undefined
}
```
Add the new RPC alphabetically in the `Functions` block (`Args` with optional trailing `p_venue_account_id?`, `p_venue_server?`; `Returns: string`). Optional `DEFAULT NULL` params are `?`-suffixed. Also run `npm run schema:functions` to regenerate `supabase/schema/functions/*.sql` (generated, `DO NOT EDIT BY HAND`).

---

### E2E, script and live-DB seeds (the DBACC-02 caller moves, PR-2)

**Current shape to replace** (`e2e/helpers/seed-test-project.ts:455-468`):
```typescript
const { data: key, error: kErr } = await admin
  .from("api_keys")
  .insert({
    user_id: opts.ownerUserId, exchange: "binance",
    label: `${prefix}key-${uniqueSuffix(6)}`,
    api_key_encrypted: "e2e-placeholder-ciphertext", is_active: true,
  })
  .select("id").single();
if (kErr || !key) { throw new Error(`[seed] seedWizardDraft (api_key) failed: ${kErr?.message}`); }
```
Insert sites in this file: `:456, :880, :1239, :1582, :1780, :1958, :1982, :2025` (eight; the header says seven). Extras the RPC will not set: `venue_account_id` at `:880`, `is_active: false` and `disconnected_at` at `:2025` (so a follow-up admin `.update()`, where only `user_id` is frozen), and `scripts/seed-full-app-demo.ts:1572` passes a caller-chosen `id` plus `sync_status`, `last_sync_at`, `account_balance_usdt`. Open decision for the plan: `p_id uuid DEFAULT NULL` on the RPC, or look-up-then-RPC-then-update for the demo seed. Other e2e sites: `e2e/axe-app-wide.spec.ts:361`, `e2e/onboarding-funnel.spec.ts:153` (adds `api_secret_encrypted`), `e2e/reflow-sweep-authed.spec.ts:261`. These use `getAdmin()` / `getCleanupAdmin()`, which carry `assertNotProductionSupabaseUrl` before any write.

**Shared helper for live vitest files:** `src/lib/test-helpers/live-db.ts` exports `createLiveAdminClient`, `createTestUser` (`:47`), `signInAsTestUser`, `cleanupLiveDbRow` (`:140`, whose `apiKeyIds` loop deletes only, unaffected). Add one `createTestApiKey(admin, {...})` helper beside `createTestUser` (same style: throws on failure with a message naming the helper). `grep -rlE "from\(['\"]api_keys['\"]\)\s*\.(insert|upsert)" src` lists the candidate vitest files (gdpr-export, sanitize-user, scenario-commit-*, allocator-holdings-rls, compare-holding-rls, delete-allocator-api-key-rpc, retention-crons, migration-084-trigger, wizard-rpcs-live-db, claim-dedupe-done-pending-children-guard, request-allocator-holdings-sync-queued, and others). Re-derive the list by scan and classify each by `HAS_LIVE_DB`; some are mocks.

---

## Shared Patterns

### Column-level anon revoke order (O-1) and deploy sequencing
**Source:** `supabase/migrations/20261022120000_strategies_anon_api_key_id_revoke.sql:18-27` (header).
**Apply to:** DBACC-01(b) migration, its PR, and the OG route change.
A migration applies to PROD on the merge push in parallel with the Vercel build, with no ordering. The reader (OG route on aliases) must be live on PROD BEFORE the revoke migration is merged. This conflicts with CONTEXT's "DBACC-01 and DBACC-03 in one PR": RESEARCH C2 resolves it as (a)+DBACC-03 in PR one, (b) in a later PR. The same logic splits DBACC-02 into three PRs (C4).

### Catalogue-only post-verify in the migration
**Source:** `20261022120000:108-181` and `20261123180000:247-292`.
**Apply to:** every new migration.
One `DO $verify$` block, `RAISE EXCEPTION 'migration <ts> failed: ...'` per failure, reads `pg_attribute`, `pg_proc`, `pg_roles` and `has_*_privilege` only. `scripts/lint-migration-data-dependence.mjs` refuses a `DO` block that reads an application table and raises on the result. TEST is schema-only, so a data-reading guard can block the PROD apply.

### SECDEF hardening
**Source:** `20261123180000:101-122` and `:224-237`.
**Apply to:** the new writer RPC and every new trigger function.
`SET search_path = public, pg_catalog`. (Pick: `public, pg_catalog` for every new api_keys-family function, because both wizard RPCs, `prevent_api_key_venue_change` and both scrub triggers pin exactly that. The mt5 write-once trigger pins `public, pg_temp` instead; copy its STRUCTURE, not its `search_path`. Both satisfy "pinned `search_path`" in CONTEXT; do not mix them inside one migration.) `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated;` then grant to `service_role` only for RPCs. Trigger functions: revoke only. Re-issue the pair after any DROP+CREATE because `pg_default_acl` re-grants. `COMMENT ON FUNCTION` states the contract and the one-overload rule.

### INVOKER trigger reading `current_user`
**Source:** `20260811210000:515-552` and `20260515114310:123-171`.
**Apply to:** the immutability trigger (no role test, but INVOKER by habit) and the insert fence (role test, INVOKER is load-bearing).
`SECURITY INVOKER` stated explicitly. A DEFINER form turns a `current_user` check into a silent no-op (the trap `prevent_profile_role_change` hit). Each trigger needs a structural arm in its gate (present, enabled `'O'`, INVOKER), see `test_api_keys_insert_not_client_writable.sql:226-247`.

### SQL gate harness: `RED-UNDER`, `RED-UNDER-M`, `RED-UNDER-SETUP`, sentinel
**Source:** `supabase/tests/test_strategies_anon_grants.sql:65-78` and `scripts/mutation-runner/GRAMMAR.md` (`:399-461` schema, `:468-526` shapes).
**Apply to:** all four new or edited SQL gates.
- Every arm: a prose `-- RED-UNDER:` line plus a `-- RED-UNDER-M: {...}` JSON twin on its own comment line (markers count only at comment line start, `GRAMMAR.md:44`).
- `RED-UNDER-M` kinds: `edit` (find/replace on a migration or the gate, with a MEASURED `occurrences`), `insert-after`, `sql` (live-lane DDL such as `GRANT`); `neuter` when an earlier arm would fire first.
- Pass/fail text: first failure must read `TEST FAILED (<arm>)` naming the arm; a mutation may not inject that literal.
- Assertions run after `RESET ROLE`, never inside an exception handler (lint R1); function text is comment-stripped before matching (R2). Check with `node scripts/lint-sql-gates.mjs --self-test` and the corpus run.
- Gate runs inside `BEGIN ... ROLLBACK`.
- A new file or arm moves censuses: `FILES_FLOOR`, `ARMS_FLOOR`, `WAIVED_CEILING` (read by symbol from `scripts/mutation-floors.mjs`, `WAIVED_CEILING` stays 0), `src/__tests__/mutation-runner-floors.test.ts`, `src/__tests__/gate-family-meta.test.ts`, the anti-SKIP step in `ci.yml` (sentinel and roster, `:4733-4785`), and `scripts/sql-gate-subset.mjs` (a migration must be in every exercising gate's `RED-UNDER-SETUP` or the push subset skips that gate). Grep them all with `grep -a`.

### Alias select with `->`
**Source:** `src/lib/factsheet/fetch-and-build-payload.ts:323-325` and `src/lib/figure-record-scalars.ts:34`.
**Apply to:** the by-basis fragment, the builder select, the OG route select.

### Error handling that names a constraint
**Source:** `src/lib/api/pgConstraintName.ts:93-99` (reads `error.message`) and the route's 23505 branch (`validate-and-encrypt/route.ts:963-985`).
**Apply to:** the validate-and-encrypt route after the RPC move. Scrub with `scrubSeamError(err, [api_key, api_secret, passphrase, venueAccountId, venueServer])`; the RPC error can carry the login.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `supabase/migrations/<ts>_client_role_statement_timeout_pin.sql` (the `ALTER ROLE ... SET` + `NOTIFY pgrst, 'reload config'` statements) | migration | batch | Zero `ALTER ROLE` and zero `NOTIFY pgrst` in `supabase/migrations`. Role config is not in `baseline.sql`. Use RESEARCH `## DBACC-03 Findings`; PROD read Q7/Q8 already shows `postgres` holds CREATEROLE and ADMIN OPTION on both roles. The local-stack replay (a failing replay is FATAL) is a Wave 0 check. |
| `supabase/tests/test_client_role_timeouts.sql` (the `rolconfig` read) | test (SQL gate) | request-response | No gate reads `rolconfig` or `pg_db_role_setting`. Arm shape and twins come from `test_strategies_anon_grants.sql`; only the pg-lane can make the twin bite (roles are created bare at `scripts/pg-lane/run.sh:406`). |
| The TEST REST measurement (probe object, `curl` as anon / authenticated, lock-release read) | recorded manual procedure | request-response | Not automatable in CI against shared TEST; RESEARCH `### TEST measurement procedure` is the spec. Helper `signInAsTestUser` (`live-db.ts:103-126`) gives the authenticated JWT. |
| The function-set pin arm ("exactly the functions whose body inserts into `api_keys`") | test arm | batch | No existing sweep over all function bodies for an `INSERT INTO <table>`. Closest idiom: `prosrc`/`proconfig` reads of single named functions (`test_api_key_delete_atomicity.sql:68,113`) plus the comment-strip rule (R2). |

## Metadata

**Analog search scope:** `supabase/migrations`, `supabase/migrations/down`, `supabase/schema/functions`, `supabase/schema/baseline.sql`, `supabase/tests`, `scripts/pg-lane`, `scripts/mutation-runner/GRAMMAR.md`, `src/lib/factsheet`, `src/lib`, `src/app/api/keys`, `src/app/api/strategies/create-with-key`, `src/app/api/og/factsheet`, `src/__tests__`, `e2e`, `scripts`.
**Files read in full or by targeted range:** about 28. Not read in full: `create-with-key/route.ts` (read `:2205-2300`), `validate-and-encrypt/route.ts` (read `:925-1075`), `route.test.ts` (read `:60-300`, `:1560-1650`), `audit-coverage.test.ts` (read `:355-460`).
**Pattern extraction date:** 2026-11-26
