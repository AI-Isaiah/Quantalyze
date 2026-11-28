# Phase 243: DBBACKSTOP - Research

**Researched:** 2026-11-26
**Domain:** Postgres grants / triggers / role settings behind PostgREST, plus one TypeScript select (Supabase, Next.js server routes, the SQL gate corpus)
**Confidence:** MEDIUM. Repo-side facts are HIGH (read this session). Everything that needs a live read (PROD or TEST) is UNMEASURED by this researcher: the Supabase MCP tools were not callable from this agent. Exact queries and procedures for the orchestrator are in "Live reads still owed".

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

### DBACC-01: anon metric reads
- Measured 2026-11-26 on PROD (read only): `anon` and `authenticated` hold table-level SELECT on `public.strategy_analytics`. The `analytics_read` policy admits any role to a row whose strategy is `published` (or is the caller's own). So an anonymous REST request can read the WHOLE `metrics_json_by_basis` column of every published strategy today, directly, without touching the payload builder. The payload builder (`src/lib/factsheet/fetch-and-build-payload.ts`, `resolveFactsheetInputs`) reads through the admin client and also selects the column whole.
- Two halves, both in scope. (a) The payload builder's embed projects `metrics_json_by_basis` as a pinned set of named `->` aliases, and a test FAILS when a key outside the pinned alias set appears in the projection. This is the ROADMAP's SC-1 wording. (b) `anon` loses SELECT on the `metrics_json_by_basis` column: a table-level SELECT revoke, then a column-level GRANT of every other column, the pattern `api_keys` already uses. A SQL gate arm proves `anon` cannot read the column and can still read the columns anon readers use. — **Reversibility:** costly — a column-level grant must be extended by every later migration that adds a `strategy_analytics` column, or anon readers of that column break. Decided by the phase agent (no clients yet, founder rule "take the call, say what I did"). Founder may override at plan review.
- Before (b) is written, research proves by census that no anon-client code path reads `metrics_json_by_basis` (the readers found in the scout are the admin-client builder, the OG route and authenticated dashboard pages). If any anon reader needs it, that reader moves to the named aliases first, or (b) narrows to the keys it needs.
- `authenticated` non-owners can still read the column of a published strategy. Free sign-up makes this close to anon. It is NOT closed here, because owner-side dashboard pages read the column through the user client. The plan records it as a known limit in the SUMMARY and CHANGELOG, not as a silent gap.
- The alias shape follows the column's real nesting (by basis: `cash_settlement`, `mark_to_market`, `smoothed_mtm`, or whatever the analytics writer emits). Research reads the writer (`analytics-service`) and every TS consumer (`basis-metrics.ts`, `headline-basis.ts`, `composite-read-path.ts`, `og-metrics.ts`, `readSingleKeyBasisOpts`) to derive the exact key set before the alias list is fixed.

### DBACC-02: api_keys ownership backstop. FOUNDER DECISION 2026-11-26: candidate 1
- ⭐ **FOUNDER DECISION 2026-11-26** (AskUserQuestion answer "Two-part backstop (Recommended)", relayed by main). DBACC-02 is candidate 1. **(i)** A BEFORE UPDATE trigger makes `api_keys.user_id` immutable for every role, BYPASSRLS included. **(ii)** A BEFORE INSERT check refuses any insert made outside a sanctioned SECDEF writer function, through a transaction-local fence GUC. The founder ACCEPTS the narrowing from "the caller's user_id" to "only the audited writer path can insert, and user_id can never be repointed". The `validate-and-encrypt` insert moves into an RPC, and the e2e and seed inserts move to the same RPC. Both moves are accepted. Migration-reviewer and rls-policy-auditor must be clean before merge. Recorded per the deviation policy here, in ROADMAP's Phase 243 section and in REQUIREMENTS DBACC-02's wording. — **Reversibility:** one-way — it is a trigger on a PROD table that every connect path writes through, and the writer-path contract binds every future `api_keys` insert.
- The constraints and the candidate list below are kept as the record the decision was made on. The "sign-off owed" rule in that list is SUPERSEDED by the decision above.
- **Constraints measured at discuss time:**
  - Phase 156 (`20260813150106`, `20260814120000`) moved every `api_keys` INSERT to `service_role` writers on purpose (CONNECT-01). An `authenticated` caller could mint a key whose attested venue the server never validated. The writers are the `validate-and-encrypt` route's admin insert and the service_role-only wizard RPCs (`create_wizard_strategy`, `create_wizard_strategy_for_key`, `add_wizard_composite_key`). Any candidate that re-opens an `authenticated` write path must name that reversal.
  - A `service_role` request carries no `sub`, so on that path the database has no verified caller identity to compare `user_id` against.
  - The two precedent triggers TODOS cites (`check_strategy_api_key_ownership`, `enforce_strategy_keys_owner_coherence`) are row-to-row coherence checks between `strategies.user_id` and `api_keys.user_id`, not caller identity. They do not transfer as-is.
  - Nothing legitimate changes `api_keys.user_id` after insert. The analytics worker, cron and exchange paths update other columns only. This is to be re-proven by census at research.
  - INSERT writers that a backstop must not break: the `validate-and-encrypt` route, the wizard RPC bodies, `e2e/helpers/seed-test-project.ts` (7 sites), `e2e/onboarding-funnel.spec.ts`, `e2e/axe-app-wide.spec.ts`, `e2e/reflow-sweep-authed.spec.ts`, `scripts/seed-full-app-demo.ts`, `src/lib/test-helpers/live-db.ts`, and `supabase/tests` fixtures (run as `postgres`).
- **Candidates sent to the founder (via main) 2026-11-26:**
  1. *(agent's recommendation)* `user_id` immutable on UPDATE for every role, plus INSERT allowed only inside a sanctioned SECDEF writer: a transaction-local fence GUC that only writer bodies set, which PostgREST cannot set because `set_config` is not exposed. A stray admin `.from('api_keys').insert()` is refused. This NARROWS "the caller's" to "only the audited writer can insert, and no write can repoint `user_id`". It needs the founder to accept the narrowing in REQUIREMENTS and ROADMAP.
  2. *(literal)* A verified identity on insert. The writer RPC is called with the user's JWT, so `auth.uid()` is verified by PostgREST, plus a server-only secret header checked against a vault secret. The trigger refuses `user_id <> auth.uid()`, so every service_role insert is refused. This partly reverses Phase 156's service_role-only gate, adds a secret to rotate and reworks every writer and seed site.
  3. UPDATE immutability only, with the INSERT half dropped from DBACC-02.
- **Rule:** the DBACC-02 migration is NOT executed until the founder's pick is recorded here. If no answer arrives this run, DBACC-02's plan stays open as the phase's one founder decision. DBACC-01 and DBACC-03 ship without it.
- Whatever is picked, any deletion-path guard exempts `quantalyze.sanitize_in_progress='on'` (project rule), and the trigger function is SECDEF-hardened per migration-reviewer (pinned `search_path`, REVOKE from PUBLIC/anon/authenticated).

### DBACC-03: client lock hold
- **Measured 2026-11-26, read only, marker first on both:** TEST and PROD carry the SAME role config. `anon`: `statement_timeout=3s`. `authenticated`: `statement_timeout=8s`. `authenticator`: `statement_timeout=8s`, `lock_timeout=8s` (plus `session_preload_libraries=supautils, safeupdate`). `service_role`: none. These are Supabase platform defaults, not set by any repo migration. So a timeout already exists. What is unproven is that PostgREST APPLIES the impersonated role's setting to the request transaction, and that the setting cannot silently drift.
- The plan's first task is the TEST measurement through TEST's REST endpoint, never `execute_sql` + `SET ROLE`, because that path does not apply role settings and proves nothing. Steps: marker query; create an own-named probe on TEST (a SECURITY INVOKER function granted to `anon`/`authenticated` that takes a lock and sleeps past the timeout, then `NOTIFY pgrst, 'reload schema'`); call it as anon and as a real authenticated test user; record the `57014` (or equivalent) answer and the elapsed time; show a concurrent reader is unblocked after it; drop the probe. Own rows/objects only, since TEST is shared.
- "No legitimate request needs longer": PROD evidence read via MCP (per-role statement durations from `pg_stat_statements` for `anon`/`authenticated`, max and p99 mean). It is recorded beside the TEST measurement.
- The backstop is then PINNED, not invented: a migration `ALTER ROLE anon/authenticated SET statement_timeout` (and `idle_in_transaction_session_timeout` if the measurement shows PostgREST can leave one idle) to the measured values, so the bound is in the repo and not only a platform default. A gate arm goes RED when the role config is missing or above the pinned ceiling. — **Reversibility:** costly — role config is cluster-level and not in the schema-only baseline, so the gate's placement (pg-lane vs local-stack vs a PROD/TEST drift read) is a research question. A wrong placement gives a gate that cannot fail.
- If the TEST measurement shows PostgREST does NOT honour the role setting, stop. That falsifies the plan premise, so replan rather than patch.

### Decided autonomously
- [DBACC-01] Q: "Named PostgREST `->` aliases or an RPC returning the key set?" → Selected: "named aliases in the existing embed, matching how `metrics_json` is already projected" — TS-only, one select, undone by editing the list.
- [DBACC-01] Q: "How is the alias set pinned?" → Selected: "an exact-set test over the parsed select string that fails on an extra or missing key, beside the existing bare-`metrics_json` ban" — a test file, cheap to change.
- [Plan split] Q: "How are plans grouped?" → Selected: "one plan per requirement. DBACC-03's measurement task comes first in its plan. DBACC-02's plan carries the founder decision. Migrations are serialized in one lane in order DBACC-03, DBACC-01(b), DBACC-02" — plan files only.
- [Ship] Q: "One PR or several?" → Selected: "DBACC-01 and DBACC-03 can ship in one PR without waiting on DBACC-02. DBACC-02 ships in a follow-up PR after sign-off" — PR packaging only.
- [Migration timestamps] Q: "What timestamp floor?" → Selected: "after the PROD ledger tip and after any migration Phase 242 lands. Re-check `origin/main` and the PROD ledger before each push. Re-base any CREATE OR REPLACE on the latest definition across all migrations" — renaming a file before merge is cheap.

### Claude's Discretion

- Exact probe object names, gate file names, and which `supabase/tests` file or lane hosts each new arm.

### Deferred Ideas (OUT OF SCOPE)

- `authenticated` non-owner read of the whole `metrics_json_by_basis` column of a published strategy. It needs owner-side readers moved off the whole column first. Recorded as a known limit of DBACC-01, a candidate for a later phase.
- `GRANT ALL` residue on `api_keys` (REFERENCES, anon DELETE) is a separate TODOS Security entry, not DBACC-02.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DBACC-01 | An anonymous request reads only the named metric keys a factsheet needs, never the whole `metrics_json_by_basis` column. | Basis object shape, the 21-alias set, the rebuild rule and its edge divergences, the only anon reader found (OG route), the `strategies` column-revoke precedent (`20261022120000`) and its gate. |
| DBACC-02 | A DB-level backstop refuses an `api_keys` write whose `user_id` is not the caller's (founder decision 2026-11-26: candidate 1). | Full writer census, immutability re-proof, fence mechanism analysis (a conflict with repo precedent is surfaced below), writer-RPC signature, every insert site to migrate, deploy order. |
| DBACC-03 | A client role holding UPDATE or DELETE cannot keep a table-wide lock past a timeout; proven on TEST through PostgREST first. | PostgREST role-setting semantics, in-repo exposure census, TEST REST measurement procedure, gate placement, ALTER ROLE caveats. |
</phase_requirements>

## Summary

DBACC-01: the column is far heavier than "metric keys". Each basis object under `metrics_json_by_basis` (`cash_settlement`, `mark_to_market`, `smoothed_mtm`) is the writer's whole sanitized metrics dict: the seven headline scalars PLUS `returns_series`, `drawdown_series`, `monthly_returns`, `rolling_metrics`, `return_quantiles`, sparklines and a nested `metrics_json`. Every TS consumer reads only the seven `BASIS_KPI_MAP` server keys per basis, so the minimal alias set is 3 bases x 7 keys = 21 aliases. The exact-set test goes beside the existing bare-`metrics_json` ban, whose regex today explicitly EXEMPTS `metrics_json_by_basis` and must be tightened. The census found exactly ONE anon-reachable reader of the column: the OG route (`createClient()` session client, anon for crawlers). Half (b) is therefore safe only after that reader moves to aliases and is live. The repo already ran this exact two-PR play for `strategies.api_key_id` (migration `20261022120000` + gate `test_strategies_anon_grants.sql`, with its O-1 rule: readers deployed BEFORE the revoke). That conflicts with CONTEXT's "one PR" packaging for DBACC-01 and must be surfaced.

DBACC-02: "nothing changes `api_keys.user_id` after insert" is CONFIRMED by census (no UPDATE payload or SET clause assigns it, anywhere). The INSERT fence is where the plan needs care: the repo already tried the GUC-fence shape and REMOVED it as forgeable (`20260515114310`, "Migration 127"), replacing it with the `current_user` idiom, which is also what the two `api_keys` scrub triggers use. Whether a PostgREST client can reach `set_config` is a narrower question than that red-team's (it assumed SQL access), but the founder's text names a GUC, so this is a CONFLICT for the planner to put in front of the founder as a one-line mechanism confirmation, not something to resolve silently. Deploy order is a three-step split: additive RPC + immutability trigger first, route/seeds/tests on the RPC second, INSERT fence last.

DBACC-03: role settings already exist on TEST and PROD (anon 3s, authenticated 8s per CONTEXT). PostgREST (settings-on-impersonated-roles since 11.1) applies them per request transaction. In-repo, no client-callable function takes a table lock (one `LOCK TABLE` exists in migrations, a one-off top-level statement), so the lock-hold vector is latent defense-in-depth. The pin is a migration `ALTER ROLE ... SET statement_timeout` plus a gate whose twin can actually fail; only the pg-lane (vanilla cluster, per-invocation throwaway) makes the twin bite. A role-config gate on the local-stack lane may be vacuous (image defaults unknown).

**Primary recommendation:** Plan three independent migration/PR tracks in this order of safety: DBACC-03 (pin, idempotent values) -> DBACC-01(a) readers then DBACC-01(b) revoke in a LATER PR -> DBACC-02 in three steps (RPC+immutability, callers, fence). Every gate gets a RED-UNDER twin and the `current_user`-vs-GUC mechanism question goes to the founder before the fence migration is written.

## Conflicts To Surface (do not average)

| # | Conflict | Sources | What the planner must do |
|---|----------|---------|--------------------------|
| C1 | Founder chose a "transaction-local fence GUC" for the DBACC-02 INSERT check. `20260515114310_redact_guc_bypass_use_current_user.sql` removed that exact shape (custom-namespace GUC bypass) as a privilege-escalation vector and standardised on `current_user` inside INVOKER triggers. `20260710160000` / `20261124120700` later use `quantalyze.sanitize_in_progress` again, but only to EXEMPT a delete guard (a forged GUC makes that guard MORE permissive, which that file accepts). | `[VERIFIED: supabase/migrations/20260515114310_redact_guc_bypass_use_current_user.sql:6-58]`, `[VERIFIED: supabase/migrations/20260710160000_api_keys_published_composite_delete_guard.sql:67]`, `[VERIFIED: supabase/migrations/20261124120700_sanitize_user_attempt_failures.sql:57]` | Carry a decision checkpoint: confirm with the founder that "fence" means the `current_user` shift (unforgeable, zero changes to existing wizard RPCs, postgres fixtures pass untouched) or the literal GUC. See "DBACC-02 fence mechanism". |
| C2 | CONTEXT packages DBACC-01 and DBACC-03 in one PR. DBACC-01(b)'s revoke would 42501 the OG route's whole-column read if applied before the aliased reader is live (migration applies to PROD on the merge push in parallel with the Vercel build). | `[VERIFIED: supabase/migrations/20261022120000_strategies_anon_api_key_id_revoke.sql:13-23]` (O-1) | One PR may carry DBACC-01(a) + DBACC-03. DBACC-01(b)'s migration ships in a second PR after (a) is live. |
| C3 | CONTEXT wants "no legitimate request needs longer" from `pg_stat_statements`. That view records COMPLETED statements; a request cancelled by the timeout is (to the best of my knowledge) not counted, so a max below the ceiling is survivorship, not proof. | `[ASSUMED]` (not verified this session) | Pair the stats read with a log count of timeout cancellations (SQLSTATE 57014) for anon/authenticated. |
| C4 | CONTEXT's one-PR-after-sign-off packaging for DBACC-02 cannot be one PR: deploy-first is NOT safe for a NEW RPC (the route would call a function that does not exist yet), and migration-first with the fence would 42501 every connect. | `[VERIFIED: supabase/migrations/20260813150106_wizard_rpcs_service_role_writer.sql:11-20]` reasoning applied to a new function | Three steps (below). The founder may collapse steps 1+2 accepting a short connect outage on the merge window. |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Which metric keys an anon request can read | Database (column grants) | API/Backend (explicit select lists) | RLS is row-level only; the grant layer is the only column control. |
| Alias projection + rebuild of `metrics_json_by_basis` | API/Backend (server builder, OG route) | — | Payload is built server-side behind the admin client; both readers are server code. |
| `api_keys.user_id` immutability / insert fence | Database (BEFORE triggers) | API/Backend (writer RPC call) | BYPASSRLS skips RLS, not triggers; the route is untrusted to the DB. |
| Client statement/lock bound | Database (role settings) | PostgREST (applies per request) | The setting lives in `pg_db_role_setting`; PostgREST applies it per transaction. |
| Role-config drift detection | CI (TEST/PROD read) | Gate corpus (catalogue arm) | Role config is cluster-level and absent from the schema-only baseline. |

## Standard Stack

No new packages. TypeScript (Next.js server code, vitest), SQL migrations, the repo's own gate harness (`supabase/tests`, `scripts/mutation-runner`, `scripts/pg-lane/run.sh`, `scripts/local-stack/run.sh`).

**Package legitimacy:** Not applicable, no external package is installed by this phase. `[VERIFIED: no dependency change in any recommendation]`

## Package Legitimacy Audit

Not applicable: no packages added. Packages removed due to `SLOP` verdict: none. Packages flagged `SUS`: none.

## DBACC-01 Findings

### Basis object structure (writer)

`[VERIFIED: analytics-service/services/basis_series.py:369-370]` `return BasisSeriesResult(\n metrics_json=metrics.metrics_json,` and `[VERIFIED: analytics-service/services/metrics.py:3103-3121]` the dict that becomes `MetricsResult.metrics_json`, quoted verbatim by key: `"cumulative_return"`, `"cagr"`, `"volatility"`, `"sharpe"`, `"sortino"`, `"calmar"`, `"max_drawdown"`, `"max_drawdown_duration_days"`, `"six_month_return"`, `"sparkline_returns"`, `"sparkline_drawdown"`, `"metrics_json"`, `"returns_series"`, `"drawdown_series"`, `"monthly_returns"`, `"rolling_metrics"`, `"return_quantiles"`. `sanitize_metrics` keeps every key (NaN becomes `None`, never a dropped key) `[VERIFIED: analytics-service/services/metrics.py:759-776]`, so the seven scalars are ALWAYS present as keys inside a basis object; a degenerate value is JSON null.

`[VERIFIED: analytics-service/services/job_worker.py:15124-15132]` the composite writer: `metrics_json_by_basis: dict[str, Any] = {"cash_settlement": cash_metrics_json}`, then `metrics_json_by_basis["mark_to_market"] = mtm_metrics_json` (only if not None) and `metrics_json_by_basis["smoothed_mtm"] = smoothed_metrics_json` (only if not None). Bases are OMITTED when unavailable, never JSON null. Single-key rows carry only `mark_to_market` / `smoothed_mtm` (`job_worker.py:12293-12298`); a `cash_settlement` object on a single-key row is a lingering composite-to-single leftover (the `raw_cash_settlement` gate reason).

So the column is about the heaviest on the table: whole series arrays per basis. That is what `analytics_read` hands any role for a published strategy today.

### Every TS reader: what it needs

| Reader | Client | Needs from the column | Source |
|--------|--------|-----------------------|--------|
| `resolveFactsheetInputs` (`fetch-and-build-payload.ts`) | admin | Passes the whole object to `readCompositeFactsheet` (`:532`) and `readSingleKeyBasisOpts` (`:663`). Embed select at `:321`. | `[VERIFIED: src/lib/factsheet/fetch-and-build-payload.ts:321,532,663]` |
| `readCompositeFactsheet` (`composite-read-path.ts:383-439`) | admin | `cash_settlement`, `mark_to_market`, `smoothed_mtm`: only `hasBasisHeadline(obj)` (seven keys present + finite `cumulative_return`) and then the objects as `BuildFactsheetOpts["metricsByBasis"]` | `[VERIFIED: src/lib/factsheet/composite-read-path.ts:383-413]` |
| `singleKeyBasisOpts` (`:775-839`) | admin | `mark_to_market` and `smoothed_mtm` objects: presence (`extractBasisObject`), `hasBasisHeadline`, then threaded | `[VERIFIED: composite-read-path.ts:784-826]` |
| `shouldReadSingleKeyMtmSeries` / `...SmoothedSeries` / `shouldReadCashSettlementSeries` / `shouldReadSingleKeyCashSeries` (`:1340-1462`) | admin | OBJECT PRESENCE of `mark_to_market`, `smoothed_mtm`, `cash_settlement` | `[VERIFIED: composite-read-path.ts:1354,1380,1437,1460]` |
| `storedCashHeadlineGate` (`headline-basis.ts:301-318`) | admin + OG | Only: is `cash_settlement` a non-null non-array OBJECT (`raw_cash_settlement`) | `[VERIFIED: src/lib/factsheet/headline-basis.ts:309-313]` |
| `applyHeadlineBasis` (`composite-read-path.ts:556-597`) | admin | Reads/writes the seven `BASIS_KPI_MAP` keys only (`redacted[serverKey] = null`) | `[VERIFIED: composite-read-path.ts:594-596]` |
| `basis-context.tsx` / `MetricsColumn.tsx` / `build-payload.ts:894` | server + client | `persisted[serverKey]` for the seven keys; `metricsByBasis?.cash_settlement != null` (`MetricsColumn.tsx:509`) | `[VERIFIED: src/app/factsheet/[id]/v2/basis-context.tsx:445-460; MetricsColumn.tsx:509]` |
| OG route (`api/og/factsheet/[id]/route.tsx`) | `createClient()` SESSION client (anon for a crawler) | Only the `raw_cash_settlement` question via `computeOgHeadline` -> `storedCashHeadlineGate`. Selects the whole column at `:186`. | `[VERIFIED: route.tsx:3,142,186; og-metrics.ts:121-128]` |
| `strategies/page.tsx` (via `getMyStrategies` wildcard `strategy_analytics (*)`, `queries.ts:1149`) and `SyncPreviewStep.tsx:1487,1840` | authenticated user client (owner) | Whole column (owner side). Out of scope (CONTEXT: known limit). | `[VERIFIED: src/lib/queries.ts:1149; SyncPreviewStep.tsx:1487]` |

Type contract: `metricsByBasis?: { cash_settlement?: Record<string, number | null>; mark_to_market?: ...; smoothed_mtm?: ... }` `[VERIFIED: src/lib/factsheet/types.ts:844-861]`. Seven keys, quoted: `{ tsKey: "cum_ret", serverKey: "cumulative_return" }, ... "volatility", "max_drawdown", "cagr", "sharpe", "sortino", "calmar"` `[VERIFIED: src/lib/factsheet/basis-metrics.ts:20-28]`.

### Minimal alias set and rebuild rule

21 aliases = {`cash_settlement`, `mark_to_market`, `smoothed_mtm`} x the seven `BASIS_KPI_MAP` server keys, e.g. `by_basis_mark_to_market_sharpe:metrics_json_by_basis->mark_to_market->sharpe` (alias naming is the planner's choice; keep one prefix so the pin regex is one pattern). Use `->` (jsonb), NEVER `->>`: `->>` yields TEXT, `typeof v === "number"` fails and every KPI becomes `NaN` -> "—" (silent visual regression). The nested `->a->b` form already works: `[VERIFIED: src/lib/queries.ts:~540-560 docblock]` records `->` aliases measured on TEST returning a real number (`{"three_month": 0.0}`) and multi-hop forms (`data_quality_flags->last_success_snapshot->flags->>cumulative_method`) are in `CATEGORY_RANKING_ANALYTICS_COLUMNS`.

**Rebuild rule (one pure function, one module, imported by the builder AND the OG route so there is one path):** for each basis b, read the seven alias values. If ALL seven are null/undefined, OMIT the basis. Otherwise emit `{ cumulative_return, ..., calmar }` with all seven keys, null where null. Feed the rebuilt object to the unchanged `readCompositeFactsheet` / `readSingleKeyBasisOpts` / `computeOgHeadline`, which keep taking `metricsJsonByBasis: unknown`. `->` returns null for an absent basis, an absent key and a JSON null alike, so object-presence cannot be reconstructed exactly. Edge behaviour that moves (the plan must pin each with a test):

| Case | Before (raw column) | After (rebuilt) | Verdict |
|------|---------------------|------------------|---------|
| Basis present, finite `cumulative_return` | object | object, seven keys | identical (`hasBasisHeadline` identical because the writer always writes all seven keys) |
| Basis absent | absent | absent | identical |
| Basis present, `cumulative_return` null, some other scalar non-null (degenerate) | object, `hasBasisHeadline` false | object (any non-null), `hasBasisHeadline` false | identical |
| Basis present, ALL SEVEN null | object present: `shouldReadSingleKeyMtmSeries` true (one wasted read), `singleKeyBasisOpts` builds closed gates `{available:false}` -> toggle rendered disabled; `raw_cash_settlement` fires for a cash object | basis absent: no read, `{}` opts (no gate, no toggle); a cash object no longer fires `raw_cash_settlement` | DIVERGES. Writer can produce it only if every scalar is non-finite. Census on PROD (Q6) decides whether it is real; if 0 rows, accept and pin. |

### Existing test that bans a bare `metrics_json`

`[VERIFIED: src/lib/factsheet/fetch-and-build-payload.test.ts:1674-1697]` ("the strategies select carries the six tokens and never a bare metrics_json") asserts `expect(select).not.toMatch(/metrics_json(?!_by_basis|->)/);` and a twin at `:1799-1806`. The `(?!_by_basis|->)` lookahead EXEMPTS `metrics_json_by_basis`: that is the hole DBACC-01 closes. New pin, beside it: (1) tighten to `/metrics_json(?!->)/` (so a bare `metrics_json_by_basis` fails; every projection must be followed by `->`); (2) parse every `alias:metrics_json_by_basis->basis->key` token out of `fake.strategySelects.join(" ")` and assert the set EQUALS a hand-typed literal list of the 21 (not derived from `BASIS_KPI_MAP` alone, or the test is tautological), failing on an extra OR a missing key; (3) the same assertion on the OG route's select string (`route.test.tsx` fakes); (4) a rebuild-parity table test over the edge cases above. 32 of the 44 `src` files that mention `metrics_json_by_basis` are tests (found by grep): those that go through the fetch/OG fakes must seed alias fields instead; composite-read-path unit tests take the object parameter and are unaffected. `[VERIFIED: grep -rln metrics_json_by_basis src, 44 files, 32 of them tests]`

### Census of anon-client reads of `strategy_analytics`

Method: grep of every `strategy_analytics` select in src, e2e, scripts; classification of the client in each; multi-line wildcard scan (`strategy_analytics (*)` and `.from("strategy_analytics").select("*")`, node script) over src, e2e, scripts, analytics-service.

- **Wildcard readers:** exactly one, `getMyStrategies` (`queries.ts:1149`, filtered by owner `user_id`, an authenticated owner read). No anon wildcard. `[VERIFIED: wildcard scan output, 5 hits, 4 of them docblocks]`
- **Anon readers with explicit columns (must stay readable after the revoke):** `getStrategiesByCategory` (`CATEGORY_RANKING_ANALYTICS_COLUMNS`, `queries.ts:~690`), `getStrategyDetail` (`queries.ts:1848`: `PUBLIC_ANALYTICS_COLUMNS, monthly_returns, metrics_json`), `readRecordSpan` (`record-span-read.ts:33`), factsheet `v2/page.tsx` generateMetadata and lanes (`data_quality_flags`, `computed_at`, `computation_status`, `trades_fetched_at`, `series_provenance`), `/api/strategies/[id]/returns` (explicit list), plus `getPercentiles`/`COMPARE_ANALYTICS_COLUMNS` readers. None names `metrics_json_by_basis`. `[VERIFIED: grep of src non-test for metrics_json_by_basis returns only fetch-and-build-payload (admin), the OG route (session client), strategies/page.tsx and SyncPreviewStep (owner)]`
- **The one anon reader of the column: the OG route** (`createClient` from `@/lib/supabase/server`, `:3,142`; selects `metrics_json_by_basis` whole at `:186`). A signed-out crawler reaches it. After (b) it would 42501 and render the generic card via `reportOgFailure("read")`.
- **Admin readers (unaffected by a grant change):** builder, `scenario-share/page.tsx:290`, `bridge/outcome/curves/route.ts:211`, `intro/snapshot.ts`, PDF routes, admin routes.
- **Authenticated, non-owner:** can still read the column of a published strategy (CONTEXT: known limit, to be recorded in SUMMARY and CHANGELOG).
- No view over `strategy_analytics` selects the column: baseline views are `compute_jobs_admin`, `ledger_refresh_staleness`, `public_profiles`, `verification_requests` `[VERIFIED: supabase/schema/baseline.sql:14627,15142,15710,16224]`; `ledger_refresh_staleness` reads `returns_series`/`computed_at`, which stay granted.
- Anon live probe to extend: `src/lib/anon-strategies-live-probe.test.ts` (runs the REAL readers incl. the OG route as a signed-out visitor against the lane; it seeds `strategy_analytics` rows at `:222`). Add the analytics arms there, not a new harness. `[VERIFIED: file header + :222]`

### Column-level grant pattern and gate to copy

Current grant: `GRANT SELECT,INSERT,REFERENCES,DELETE,UPDATE ON TABLE "public"."strategy_analytics" TO "anon"` `[VERIFIED: supabase/schema/baseline.sql:20622]`, same for authenticated (`:20623`). `strategy_analytics` has 35 columns incl. `metrics_json_by_basis` `[VERIFIED: baseline.sql:15010-15045]`.

Copy `20261022120000_strategies_anon_api_key_id_revoke.sql` exactly: ONE `DO $verify$` block that (1) records authenticated/service_role privileges, (2) `REVOKE SELECT ON TABLE public.strategy_analytics FROM anon` (only SELECT; see option below for the write verbs), (3) derives the column list from `pg_attribute` (not typed: the pg-lane builds a fixture-sized table) excluding `metrics_json_by_basis` and `GRANT SELECT (...)` it to anon, (4) asserts with `has_column_privilege` / `has_table_privilege` / `has_any_column_privilege`, and that authenticated/service_role did not move. CATALOGUE ONLY: `scripts/lint-migration-data-dependence.mjs` refuses a `DO` block that reads an application table and raises on the result, with no opt-out marker `[VERIFIED: scripts/lint-migration-data-dependence.mjs:1-60]`. A manual `down/` rollback file sits beside it (house style).

Gate: new `supabase/tests/test_strategy_analytics_anon_grants.sql` mirroring `test_strategies_anon_grants.sql` arms GRANT 1 (anon cannot SELECT the column), GRANT 2 (no table-level SELECT), GRANT 3 (every other column, minus a `HIDDEN_COLUMN_EXEMPTIONS` list holding `metrics_json_by_basis`, readable; with a `-SETUP` guard against a vacuous sweep), GRANT 4 (behavioural: as anon, `SELECT metrics_json_by_basis` is 42501 and `SELECT id, ... named columns` succeeds). Each arm carries a `RED-UNDER` prose line and a `RED-UNDER-M` JSON twin (`{"arm":"GRANT 1","apply":[{"kind":"sql","stmt":"GRANT SELECT (metrics_json_by_basis) ON public.strategy_analytics TO anon"}]}`; GRANT 2 and GRANT 4 neuter GRANT 1 first, `"neuter":[{"arm":"GRANT 1"}]`) and a `RED-UNDER-SETUP` apply list, and ends with `RAISE NOTICE '... ALL N ARMS EXECUTED (1, 2, ...)'` carrying a roster `[VERIFIED: .github/workflows/ci.yml:4740-4781 requires the sentinel and a named roster]`. `[VERIFIED: supabase/tests/test_strategies_anon_grants.sql:14-22,97-134,170]`.

Default-deny consequence (the recorded reversibility cost): after (b), a `strategy_analytics` column added by a later migration is ANON-INVISIBLE until a migration grants it; GRANT 3 goes RED on such a column until its author grants it or adds an exemption with a reason. Anon wildcard reads break with 42501 (none exist today).

**Platform note:** the 2026-10-30 default-grant withdrawal affects NEW tables (TRUNC4 entry `[VERIFIED: TODOS.md:4601-4605]`). It does not touch an existing table's grants, so (b)'s revoke is unaffected. It does mean a gate that creates a probe table and expects client SELECT on it can go RED after the next baseline re-dump; read the new gate's positive controls from EXISTING tables.

**Optional, discretionary (not in DBACC-01):** anon also holds INSERT/UPDATE/DELETE on `strategy_analytics`; the `strategies` precedent revoked them in the same migration (no anon writer exists). Revoking them here would also shrink DBACC-03's surface for that table. Cheap, reversible, planner/founder's call.

## DBACC-02 Findings

### Writer census (api_keys)

Methods: node/python scans (regex, comments stripped) over `supabase/migrations`, `supabase/tests`, `src`, `e2e`, `scripts`, `analytics-service` (non-tests). Regexes can miss dynamic SQL; the planner should treat the lists as the audited baseline and add the arm below that pins the function set from the catalogue.

**INSERT, production paths (3 SECDEF bodies at their LATEST definition + 1 route):**

| Writer | Role / identity | Latest definition | Notes |
|--------|-----------------|-------------------|-------|
| `POST /api/keys/validate-and-encrypt` persist arm (`route.ts:936`) | `createAdminClient()` -> `service_role`, no `sub`; `userId` from `withAuth` | n/a | Columns: `...encryptedColumns` (api_key_encrypted, api_secret_encrypted, passphrase_encrypted, dek_encrypted, nonce, kek_version), `user_id`, `exchange`, `attested_venue`, `label`, `venue_account_id`, `venue_server`. Then `swapAccountSlot`, compensating DELETE (`:1061`). `[VERIFIED: route.ts:936-961]` |
| `create_wizard_strategy` (13 params) | SECDEF owner `postgres`, in-body gate `auth.role() = 'service_role'`, no `auth.uid()` | `20261123180000_api_keys_venue_server.sql:101-232` | INSERT at `:194-206` (adds `is_active` TRUE) |
| `add_wizard_composite_key` | SECDEF, service_role-only | `20260814120000_wizard_rpcs_revoke_authenticated.sql` | INSERT at `:407` area (scan) |
| `create_wizard_strategy_for_key` | SECDEF | `20260826130000` | Adds NO api_keys writer `[VERIFIED: 20260826130000_create_wizard_strategy_for_key.sql:78-80]` |

Scan of SECDEF/plpgsql bodies at latest definition containing `INSERT INTO api_keys`: only `create_wizard_strategy` and `add_wizard_composite_key`. The other functions touching the table at latest definition are UPDATE/DELETE: `advance_sync_cursor`, `backfill_api_keys_history_reconstructed_at`, `cleanup_abandoned_wizard_drafts` (DELETE), `delete_allocator_api_key` / `delete_api_key_if_unreferenced` / `sanitize_user` (DELETE), `disconnect_allocator_api_key`, `reconnect_allocator_api_key`, `enqueue_refresh_allocator_equity_for_all`, `request_allocator_holdings_sync`, `set_departed_key_history_inclusion`, `stamp_api_key_429`, `swap_account_slot`, `update_api_key_rate_limit`.

**UPDATE:** analytics-service (Python, supabase-py as `service_role`): `routers/cron.py:1018,1292`, `routers/exchange.py:2160`, `services/job_worker.py:8425,15828,15888,15978,16043,16070`, others; TS: `finalize-wizard/route.ts:2243` (`last_sync_at`), `lib/api/rotate-key-secret.ts:103` (secret columns, `.eq("user_id", userId)` is a FILTER), `scripts/drain-test-compute-backlog.ts:574` (`disconnected_at`). Python `api_keys` insert/upsert/delete: NONE found. DELETE (TS): `validate-and-encrypt:1061`, `create-with-key:2634`, test cleanups. Roles: all service_role (PostgREST) or postgres (SECDEF bodies, migrations, fixtures). `authenticated` holds DELETE on its own rows through `api_keys_owner` (`GRANT REFERENCES,DELETE ... TO "authenticated"`, `[VERIFIED: baseline.sql:20159-20160]`) and no INSERT/UPDATE.

**Immutability premise: CONFIRMED.** No `UPDATE ... SET user_id =` exists in any migration (python regex over all `supabase/migrations/*.sql`), none in `supabase/tests`, and a python scan of every Python `table("api_keys").update(...)` payload found no `user_id`. The only FK is `api_keys_user_id_fkey ... ON DELETE CASCADE` (a delete, never an update) `[VERIFIED: baseline.sql:17628]`. `sanitize_user` DELETEs the rows, so it never needs an exemption from an UPDATE-immutability trigger.

**`supabase/tests` and fixtures:** 281 `INSERT INTO api_keys` sites in 63 test files; by textual role-tracking all but 4 execute as `postgres` (no role shift). Plus `scripts/pg-lane/fixtures/25-fixture-api-keys-e2e-census-seed.sql`. The four non-postgres sites: `test_api_keys_exchange_not_user_writable.sql:519,611` (as `authenticated`, expected refused) and `test_api_keys_insert_not_client_writable.sql:273` (service_role) and `:333` (authenticated). **Arm (2) of `test_api_keys_insert_not_client_writable.sql` (`:240-300`) asserts a service_role INSERT SUCCEEDS and retains `attested_venue`, and says "OUTAGE (2)" if refused. Under candidate 1 it must be INVERTED in the same commit as the fence migration: direct service_role insert refused, writer RPC insert succeeds and retains attestation.** `[VERIFIED: supabase/tests/test_api_keys_insert_not_client_writable.sql:262-300]` Its `RED-UNDER-SETUP` apply list (`:130`) must gain the new migrations.

**TS/e2e/script sites the founder's list omits or under-counts (classification):**

| Site | Kind | Notes |
|------|------|-------|
| `e2e/helpers/seed-test-project.ts` insert at `:456,880,1239,1582,1780,1958,1982,2025` (8 insert sites; the helper's header says 7) | e2e seed, admin client | Columns: `user_id, exchange, label, api_key_encrypted, is_active` (+ `venue_account_id` at 880, `disconnected_at` at 2025). Deletes at `:1705,1894,2062,2121` are unaffected. |
| `e2e/axe-app-wide.spec.ts:361`, `e2e/onboarding-funnel.spec.ts:153` (`api_secret_encrypted`), `e2e/reflow-sweep-authed.spec.ts:261` | e2e, admin client | same columns |
| `scripts/seed-full-app-demo.ts:1572` | `.upsert({ id, user_id, exchange, label, api_key_encrypted, api_secret_encrypted, is_active, kek_version, sync_status, last_sync_at, account_balance_usdt })` | An UPSERT keyed on `id` for idempotent re-runs. BEFORE INSERT fires on `ON CONFLICT DO UPDATE` too, so even a re-run of an existing id hits the fence. Needs "select existing else RPC then UPDATE". |
| `src/lib/test-helpers/live-db.ts:155` | delete only | unaffected |
| vitest live-DB tests that insert via the admin client: `sec-005-live-probe`, `anon-strategies-live-probe`, `migration-028-tenant-check`, `allocator-holdings-rls`, `compare-holding-rls`, `delete-allocator-api-key-rpc`, `claim-dedupe-done-pending-children-guard`, `gdpr-export`, `migration-084-trigger`, `request-allocator-holdings-sync-queued`, `retention-crons`, `sanitize-user`, `scenario-commit-batch-race`, `scenario-commit-batch-tx`, `scenario-commit-rls` (some are mocks: classify each by `HAS_LIVE_DB`) | live-DB (private lane, `frontend-live-db-lane`) or mock | The live ones must move to one shared helper in `live-db.ts` before the fence lands. Re-derive the list with the node scan; do not trust this one. |

**Cross-cutting consequences of moving every seed to an RPC:** seeds set columns the route's insert does not (`is_active`=false, `disconnected_at`, `sync_status`, `last_sync_at`, a caller-chosen `id`). Recommended shape: the RPC mirrors the route's columns only; seeds call it, then use an admin `.update()` for extras (service_role UPDATE is fine; only `user_id` is frozen). A caller-chosen `id` is the one thing an update cannot give; either the RPC takes `p_id uuid DEFAULT NULL`, or the demo seed looks the row up by (user_id, label) first. Open question for the planner.

### New writer RPC (mirrors the route's insert)

Latest in-repo precedent for shape, gate and ACL: `create_wizard_strategy` (`20261123180000:101-237`): `SECURITY DEFINER`, `SET search_path = public, pg_catalog`, `SET lock_timeout = '3s'`, fail-closed `auth.role()` read inside `BEGIN ... EXCEPTION WHEN OTHERS THEN v_jwt_role := NULL`, `IF v_jwt_role IS DISTINCT FROM 'service_role' THEN RAISE ... ERRCODE = 'insufficient_privilege'`, a `NULL p_user_id` refusal, then `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated; GRANT EXECUTE ... TO service_role;` and a `COMMENT ON FUNCTION`. Proposed signature (types from `[VERIFIED: baseline.sql api_keys table]`): `(p_user_id uuid, p_exchange text, p_label text, p_api_key_encrypted text, p_api_secret_encrypted text, p_passphrase_encrypted text, p_dek_encrypted text, p_nonce text, p_kek_version integer, p_venue_account_id text DEFAULT NULL, p_venue_server text DEFAULT NULL) RETURNS uuid`. Stamp `attested_venue = p_exchange` inside the body (the route sets both from `exchangeNormalized`; the CHECK `api_keys_attested_venue_matches_exchange` couples them), normalise `venue_account_id` and `venue_server` exactly as `create_wizard_strategy` does (`NULLIF(btrim(..., E' \t\r\n'), '')`, `lower` for server). The RPC cannot verify `p_user_id` is the caller (service_role has no `sub`): ownership remains bound at the route, which is exactly the narrowing the founder accepted. EXACTLY ONE overload (PostgREST PGRST203 on a second). New name must be added to `MUTATING_RPC_NAMES` in `src/__tests__/audit-coverage.test.ts` (and the `@audit-skip: key connect` pragma stays above the `.rpc(` call) `[VERIFIED: audit-coverage.test.ts:360-460]`. Regenerate `supabase/schema/functions/*.sql` (`npm run schema:functions`, generated files say DO NOT EDIT). The route's error handling maps 23505 on `api_keys_user_exchange_venue_account_uniq` via `pgConstraintName(insertError)` (`:~965`); verify the RPC path surfaces the same `constraint` detail through PostgREST `rpc()` (it does for a raised unique violation, but pin it with the existing route test).

### DBACC-02 fence mechanism (the C1 conflict, what each shape costs)

Facts:
- `set_config('quantalyze.<name>', 'on', true)` is callable by ANY role that can run SQL; the repo's red-team recorded that as forgeable `[VERIFIED: 20260515114310:6-58]`.
- Reachability through PostgREST (the narrower question): PostgREST resolves `/rpc/<fn>` only in a schema listed in `db-schemas`, and `set_config` lives in `pg_catalog`. Local `config.toml` lists `schemas = ["public", "graphql_public"]` but that is the LOCAL stack (`[VERIFIED: supabase/config.toml:8-13]`), not hosted. No public wrapper passes a caller-supplied name to `set_config`: the only `set_config(` in any function in `baseline.sql` is `sanitize_user`'s fixed name (`baseline.sql:10625`); five migration files mention it, all fixed names. **The probe still owed (TEST, REST): POST `/rest/v1/rpc/set_config` as anon and again with `Content-Profile: pg_catalog` / `Accept-Profile: pg_catalog`; paste the refusal (expect 404 PGRST202 / PGRST106).**
- Realtime, pg_graphql and Storage run no caller-supplied SQL as a client role; not probed `[ASSUMED]`.
- `current_user` inside a SECDEF body is the function OWNER (`postgres`); a PostgREST service_role request has `current_user = 'service_role'`. An INVOKER trigger therefore tells "inside a postgres-owned SECDEF writer or postgres-role SQL" from "a PostgREST admin insert" with nothing to forge `[VERIFIED: 20260811210000_api_keys_attested_venue.sql:515-546 (scrub_client_supplied_attested_venue); 20260813150106:(v) 'bodies run as postgres, NOT as service_role']`.

| Shape | Existing wizard RPCs | postgres-role fixtures (281 sites, 63 files + pg-lane fixture 25) | Forgery surface | Notes |
|-------|----------------------|--------------------------------------------------------------------|-----------------|-------|
| **A. GUC, founder's literal (function-level `SET quantalyze.api_keys_writer = 'on'` clause)** | Both must be `CREATE OR REPLACE`d to add the clause (re-base on `20261123180000` and `20260814120000`; same signature, so REPLACE and the ACL survive) | Break unless the trigger ALSO exempts `postgres`/`supabase_admin` (then the GUC adds almost nothing over B for them) | A role with SQL access can set it (not PostgREST, per the probe) | Function-level `SET` reverts at function exit, so a later negative arm in a single-transaction SQL test is not poisoned. `set_config(..., true)` inside the body would persist to transaction end and make later negative arms vacuous. After a revert the placeholder reads `''` not NULL: the trigger must test `COALESCE(current_setting('quantalyze.api_keys_writer', true), '') = 'on'`. `[ASSUMED]` (function-level SET semantics from PG docs; verify on the lane) |
| **B. `current_user` shift (repo precedent, "Migration 127")** | No change to them | Pass untouched (`current_user = 'postgres'`) | None to forge | "Sanctioned" becomes "any postgres-owned SECDEF body". Give it teeth with a catalogue arm that pins the EXACT set of functions whose `prosrc` contains an `INSERT INTO api_keys` (today: the two wizard RPCs + the new one). Allow-list `('postgres','supabase_admin')`, deny by default (also refuses `service_role`, `authenticated`, `anon`). |

Recommendation (to put in front of the founder, one line): implement the INSERT fence as shape B plus the catalogue pin on the writer-function set; it delivers the accepted semantics ("only the audited writer path can insert") with no new forgeable state, no edit to the two wizard RPCs and no fixture exemption. If the founder wants A literally, the plan needs (i) the function-level SET clause (not `set_config`), (ii) an explicit postgres/supabase_admin exemption for fixtures and migrations, (iii) both wizard RPCs re-based. Do NOT write an `app.`-prefixed GUC: `scripts/lint-app-guc.mjs` counts `current_setting('app.…')` reads in migrations (its `DETECT_RE` matches `current_setting(... 'app.`) and a `quantalyze.` name is outside its corpus `[VERIFIED: scripts/lint-app-guc.mjs:162-163]`.

**UPDATE immutability trigger (both shapes):** `BEFORE UPDATE OF user_id ON public.api_keys FOR EACH ROW WHEN (OLD.user_id IS DISTINCT FROM NEW.user_id)`, raising `insufficient_privilege`-class for EVERY role (no allow-list: BYPASSRLS and postgres included, per the decision). `WHEN` rather than only `UPDATE OF` so an upsert's same-value assignment passes. Function: SECURITY INVOKER is fine here (no role test); harden anyway (pinned `search_path`, `REVOKE ALL ... FROM PUBLIC, anon, authenticated`) per the migration-reviewer list in CONTEXT. Existing api_keys triggers for ordering and style: `api_keys_lock_exchange` (`BEFORE UPDATE OF "exchange"`), `api_keys_scrub_attested_venue` and `api_keys_scrub_venue_account_id` (`BEFORE INSERT`), `api_keys_account_share_same_owner`, `api_keys_published_composite_delete_guard`, `api_keys_stamp_first_added` (AFTER INSERT) `[VERIFIED: baseline.sql:17362-17398]`. Trigger firing order is alphabetical by name for the same event; pick a name that sorts so a refused row is refused before the scrub triggers run (cosmetic, but pin the order in the gate).

**`sanitize_in_progress` exemption:** neither new trigger fires on DELETE, and `sanitize_user` only DELETEs `api_keys`, so no exemption is required. The plan still needs ONE arm proving `sanitize_user` completes on a lane with both triggers present. Under shape A do not give the fence GUC and `sanitize_in_progress` any shared code path.

### Deploy order (Phase 156's reasoning applied)

Phase 156 header: migration-first is the real hazard when it REVOKES something the old deploy still uses, because "the merge IS the apply" and the Vercel build fires on the same merge with no ordering `[VERIFIED: 20260813150106:11-20]`; deploy-first was safe there only because `service_role` already held EXECUTE. Here the asymmetry flips for the new RPC (deploy-first hits a function that does not exist yet) and the fence is a revoke-equivalent. Therefore:

1. **PR-1 (migration A, additive):** new writer RPC + its ACL + comment, and the UPDATE-immutability trigger (safe now: nothing updates `user_id`). Under shape A also the two wizard-RPC re-bases. Safe in either deploy order.
2. **PR-2 (code, after PR-1 is applied to PROD):** route calls the RPC; e2e helpers, `seed-full-app-demo.ts`, live-DB vitest helpers, the `audit-coverage` allow-list move to the RPC; inverted/extended SQL gates for the not-yet-fenced state. Lands only when PR-1 is live.
3. **PR-3 (migration B):** the BEFORE INSERT fence + the inverted arm (2) + catalogue pin. Lands only when PR-2 is live on PROD. Its own CI (live-DB lane, e2e-seeded replay it on a private lane) already uses the RPC from PR-2.

If the founder collapses PR-1 and PR-2 ("no clients yet"), the cost is a short connect-a-key outage (PGRST202 / 500) across the merge window; collapsing PR-2 and PR-3 would 42501 every connect and is the one thing not to do. Merge window per CONTEXT: nothing merges before 23:15 UTC 2026-11-26.

## DBACC-03 Findings

### PostgREST behaviour

- Impersonated-role settings: "PostgREST applies the impersonated roles settings as transaction-scoped settings", in the per-request transaction, between the connection (authenticator) settings and the main query. `[CITED: docs.postgrest.org/en/stable/references/transactions.html, impersonated role settings]` Introduced in PostgREST 11.1 `[CITED: supabase.com/blog/postgrest-11-1-release via search result]`. The project's linked PostgREST version string `v14.5` was read from another checkout's `.temp`, which is not an authoritative source for TEST or PROD; read the version from each project's OpenAPI root (`GET /rest/v1/` -> `info.version`) `[ASSUMED: field name]` in the measurement.
- Reload: role-setting changes need `NOTIFY pgrst, 'reload config'` `[CITED: supabase.com/docs/guides/database/postgres/timeouts]`. CONTEXT's probe step says `'reload schema'`; for a new function, schema reload is right, for a changed role value config reload is. Issue both.
- Supabase defaults: anon 3s, authenticated 8s, service_role none (inherits the authenticator's 8s), postgres none (global 2min cap) `[CITED: supabase.com/docs/guides/database/postgres/timeouts]`; CONTEXT measured the same on TEST and PROD.
- Function-level `SET statement_timeout` is "hoisted" and OVERRIDES the role setting (default `db-hoisted-tx-settings` includes `statement_timeout`) `[CITED: docs.postgrest.org transactions page, hoisting]`. Repo check: no function in the baseline or any migration sets `statement_timeout` at function level (only `baseline.sql:4: SET statement_timeout = 0;`, the dump's own session line) `[VERIFIED: grep]`. The gate should assert it stays true for functions executable by anon/authenticated.
- No PostgREST header lets a client lengthen the timeout `[ASSUMED]`.

### Can a client take a table lock through PostgREST at all?

Through PostgREST each request is ONE transaction running one statement chain; a client cannot send `LOCK TABLE`. The lock needs a function. Census: the only `LOCK [TABLE]` in `supabase/migrations` or `baseline.sql` is `20260714090000_portfolio_recompute_inflight_unique.sql:50: LOCK TABLE public.portfolio_analytics IN ACCESS EXCLUSIVE MODE;`, a one-off top-level migration statement, not a function body `[VERIFIED: grep -iE with optional TABLE over baseline.sql and all migrations]`. `anon`/`authenticated` are NOLOGIN, so no direct SQL. Net: today the vector is LATENT (a future SECURITY INVOKER function, or a connection path the repo does not use). The timeout still bounds the nearest real thing, a long bulk UPDATE holding ROW locks. Say so in the SUMMARY: this is defense-in-depth against a future function, and the founder's premise that a client "holding UPDATE or DELETE" can lock is true only given SQL access.

`idle_in_transaction_session_timeout`: PostgREST opens, runs and commits the request transaction back to back; there is no client-held idle gap, so this setting buys nothing on the PostgREST path. Do not add it unless the TEST measurement shows an idle window `[ASSUMED]`. A role-level `lock_timeout` is distinct (bounds WAITING for a lock; `authenticator` already has 8s).

### TEST measurement procedure (REST, not `execute_sql` + `SET ROLE`)

Env: `TEST_SUPABASE_URL`, `TEST_SUPABASE_ANON_KEY`, `TEST_SUPABASE_SERVICE_ROLE_KEY` (names from the repo; `[VERIFIED: grep counts 103/6/95]`); test user via `signInAsTestUser` (anon key sign-in) in `src/lib/test-helpers/live-db.ts:103-126` (`createTestUser` + `signInWithPassword`). `src/lib/test-safety.ts` pins the PROD ref; `assertNotProductionSupabaseUrl` throws before any write via the helpers. Every object name carries `zz_dbbackstop_` and every row is own-created (TEST is shared).

1. Marker query via `mcp__supabase-test__execute_sql` (must name TEST).
2. As postgres on TEST: `CREATE TABLE public.zz_dbbackstop_probe (id int)`; `GRANT SELECT, UPDATE, DELETE ON public.zz_dbbackstop_probe TO anon, authenticated` (UPDATE/DELETE mirror the real exposure; explicit grants because default grants vary); `CREATE FUNCTION public.zz_dbbackstop_hold(p_secs numeric) RETURNS text LANGUAGE plpgsql SECURITY INVOKER AS $$ BEGIN LOCK TABLE public.zz_dbbackstop_probe IN ACCESS EXCLUSIVE MODE; PERFORM pg_sleep(p_secs); RETURN 'done'; END $$;` with `REVOKE ALL ... FROM PUBLIC; GRANT EXECUTE ... TO anon, authenticated, service_role`; then `NOTIFY pgrst, 'reload schema'; NOTIFY pgrst, 'reload config';`.
3. Probe pgrst reachability first: `POST /rest/v1/rpc/set_config` as anon (C1 evidence), paste the refusal.
4. Calls with `curl -s -o /dev/null -w '%{http_code} %{time_total}\n'` (one per role), body `{"p_secs":30}`: anon (anon key), authenticated (user JWT), service_role (control). Record HTTP code, the PostgREST error `code` (expect `57014`), and elapsed. Expect about 3s, about 8s, about 8s. A 200 after 30s falsifies the premise: STOP and replan (CONTEXT).
5. Lock release: start a 30s anon hold, 1s later `GET /rest/v1/zz_dbbackstop_probe?select=id` as anon; the reader blocks until the holder's timeout, then returns 200 (about 2s wait, inside the reader's own 3s); a third read immediately afterwards returns fast.
6. Drop probe function and table, `NOTIFY` both reloads again. Record all of it verbatim in the plan SUMMARY.
7. Pin of "no legitimate request needs longer": see Live reads owed, Q2-Q4.

### The pin (migration) and its gate

Migration: `ALTER ROLE anon SET statement_timeout = '3s'` and `ALTER ROLE authenticated SET statement_timeout = '8s'` (values = the measured defaults, so applying changes nothing), then `NOTIFY pgrst, 'reload config'`, with a catalogue-only `DO` self-check reading `pg_roles.rolconfig` (the same shape as `20261022120000`; no row reads). Open on hosted: does the apply role (`postgres`) hold ADMIN OPTION on `anon`/`authenticated` (PG16+ CREATEROLE rule) and is there already a per-database `pg_db_role_setting` row (`setdatabase <> 0`) that would override a global one? Supabase documents `alter role ... set statement_timeout` from the SQL editor (runs as `postgres`) `[CITED: supabase.com/docs/guides/database/postgres/timeouts]`, but the migration role and the local-stack role are unproven `[ASSUMED]`: Wave 0 must apply the statement on the PG17 local-stack lane (a replay failure is FATAL in `scripts/local-stack/run.sh`) and read Q7/Q8 on TEST.

Gate placement (the "can it fail" question):

| Placement | Can it fail? | Evidence |
|-----------|-------------|----------|
| **pg-lane (sql-mutation, `scripts/pg-lane/run.sh`)** | YES: vanilla `initdb` cluster, fixtures set no role config (`grep` of `scripts/pg-lane/fixtures` and `baseline.sql` finds no `ALTER ROLE`/`rolconfig`), so the arm is RED unless the migration under test applies; `RED-UNDER-M` edits the migration's value (e.g. `'3s'` -> `'60s'`) or removes the statement. Each lane invocation boots its OWN throwaway cluster on port 0 (`scripts/pg-lane/run.sh:118-150`), and the runner caps concurrency at `LANE_CONCURRENCY_CAP = 4` gate files in flight, each on its own cluster, so a role-level `ALTER ROLE` twin cannot leak across arms. `ALTER ROLE ... SET` is transactional, so a gate that runs inside `BEGIN ... ROLLBACK` does not leak into the next file on the shared sql-tests stack either. | `[VERIFIED: scripts/pg-lane/run.sh:118-150; scripts/mutation-runner/run.mjs:1781-1785]` |
| local-stack lane (`sql-tests`, same corpus) | UNKNOWN, possibly vacuous: the Supabase image may already ship role defaults, so an arm that reads `rolconfig` could pass without the migration. Measure with a neuter on the lane before relying on it; if it passes un-neutered it is a catalogue sanity check only. | `[ASSUMED]` |
| TEST/PROD live drift read (`test-db-drift` job holds the TEST DB secret, or the prod prober) | The only placement that detects platform-side drift on the real clusters (role config is cluster-level and NOT in `baseline.sql`). Cannot be mutation-twinned the same way; needs its own negative proof (feed it a ceiling below the live value, see RED). | `[VERIFIED: baseline.sql has no ALTER ROLE; CLAUDE.md test-db-drift section]` |
| A `rolconfig` read at all | Proves the CATALOGUE, not that PostgREST applies it. Only the REST measurement above proves PostgREST. State this in the gate header so nobody reads green as the PostgREST proof. | reasoning |

Recommended: arm in a new `supabase/tests` file hosted by the pg-lane (twin bites), assert both roles' ceilings and the "no function executable by anon/authenticated carries a `statement_timeout` proconfig" clause (catalogue read of `pg_proc.proconfig`), plus an OPTIONAL TEST/PROD drift step as a booked follow-up.

## Migration Lane Facts

- Latest repo migration in this worktree: `20261126180000_poll_positions_cohort_ccxt_venues.sql` (`ls supabase/migrations | tail`). Phase 243 timestamps should sort after it and after any Phase 242 migration; re-check `origin/main` and the PROD ledger before each push (CONTEXT). **PROD ledger tip: NOT read (see Q1).** The ledger on TEST is a prose provenance sentence, not applied SQL (CLAUDE.md), so TEST is not evidence of what ran.
- PROD migrations auto-apply after `apply-test` (no human gate); apply order in CONTEXT: DBACC-03, DBACC-01(b), DBACC-02.
- House post-verify: ONE `DO $verify$` block, catalogue-only, `RAISE EXCEPTION 'migration <ts> failed: ...'` per failure `[VERIFIED: 20261022120000 :80-142]`. `scripts/lint-migration-data-dependence.mjs` refuses any `DO` block that reads an application relation AND raises on the result (R1-R5), no opt-out marker; `pg_catalog`/`information_schema`/`has_*_privilege` reads are fine.
- A migration REPLAYS on the local-stack lane on top of `baseline.sql` (a failing replay is FATAL); `supabase/schema/baseline-carried-migrations.txt` is regenerated with a baseline re-dump (`chore(release)` PR after the PROD apply). `[VERIFIED: baseline-carried-migrations.txt header; CLAUDE.md D-F]`.
- CREATE OR REPLACE re-base: always on the LATEST definition across all migrations (`supabase/schema/functions/*.sql` is the generated canonical copy; its first lines name the source migration).
- Censuses a new `supabase/tests` file or arm moves (grep with `-a`): `FILES_FLOOR` (`scripts/mutation-floors.mjs:1397`, currently 96) and `ARMS_FLOOR` (`:3579`, currently 1079) are RATCHETS, raised to the measured full-run values; `WAIVED_CEILING = 0` (`:3693`) stays 0 (no waivers); `src/__tests__/mutation-runner-floors.test.ts` ("RATCHET STALE"); `src/__tests__/gate-family-meta.test.ts`; `scripts/lint-sql-gates.mjs` (7 rules; `node scripts/lint-sql-gates.mjs --self-test`); the anti-SKIP step (`ci.yml:4733-4781`) needs `ALL N ARMS EXECUTED (roster)`; `scripts/sql-gate-subset.mjs` derives the push-to-main subset from each gate's `RED-UNDER-SETUP` apply list, so a new migration must be listed in every gate that exercises it or the subset skips that gate; `src/__tests__/critical-regressions.test.ts` (VERSION = package.json); CHANGELOG entry per ship, VERSION and package.json byte-equal 4-digit. Also grep for any test that counts `supabase/tests` files (`computed-at-reader-census.test.ts`, `holding-scope-key-census.test.ts`, `local-stack-lane-wiring.test.ts` read the directory) `[VERIFIED: grep -l readdirSync over src/__tests__]`.
- The "TODOS.md holds open work only" rule: this phase deletes `TRIGGERREVOKE-LOCKHOLD-01` (`TODOS.md:4595`) and the "ARCHITECTURE DECISION OWED" entry (`TODOS.md:1908`) in the same PR it ships and names them in the CHANGELOG; fix any cited pointer in the same PR.

## Architecture Patterns

### System Architecture Diagram

```
DBACC-01 (a)  anon/OG/crawler ──> OG route ──┐
              visitor ──> factsheet page ─────┤  one select fragment (21 aliases)
              admin builder (resolveFactsheetInputs) ──┘     (by-basis-projection module)
                         │ PostgREST -> values only (seven scalars per basis)
                         v
                  rebuildMetricsJsonByBasis(row)  -> { basis: {7 keys} }  (omit all-null basis)
                         v
        readCompositeFactsheet / readSingleKeyBasisOpts / computeOgHeadline (unchanged signatures)
DBACC-01 (b)  anon ──> PostgREST ──> strategy_analytics: SELECT only on every column except metrics_json_by_basis (42501 otherwise)

DBACC-02      route (admin, service_role) ──> rpc create_api_key ──> SECDEF body (owner postgres)
                                                    │ INSERT api_keys
                                         BEFORE INSERT trigger: current_user (or fence GUC) allows? else refuse
              any UPDATE (any role) ──> BEFORE UPDATE OF user_id ... WHEN changed ──> refuse

DBACC-03      client ──> PostgREST: BEGIN; set impersonated role; apply rolconfig (3s anon / 8s authenticated); run; COMMIT
                         57014 on timeout, lock released at transaction end
```

### Recommended structure

```
src/lib/factsheet/by-basis-projection.ts      # alias select fragment + rebuild fn (new, the one path)
src/lib/factsheet/by-basis-projection.test.ts # exact-set pin, parity table
supabase/migrations/<ts>_strategy_analytics_anon_column_revoke.sql (+ down/)
supabase/migrations/<ts>_client_role_statement_timeout_pin.sql (+ down/)
supabase/migrations/<ts>_api_keys_writer_rpc_and_user_id_immutable.sql   # PR-1
supabase/migrations/<ts>_api_keys_insert_fence.sql                        # PR-3
supabase/tests/test_strategy_analytics_anon_grants.sql
supabase/tests/test_client_role_timeouts.sql
supabase/tests/test_api_keys_user_id_immutable.sql   (+ fence arms; invert arm 2 of the existing gate)
```

### Anti-Patterns to Avoid
- **Typed column list in the GRANT:** the pg-lane builds a fixture-sized table; derive from `pg_attribute` (precedent).
- **`->>` for numeric aliases:** returns text, KPIs go "—".
- **A role-config arm only on the local stack:** can be vacuous (image defaults).
- **`set_config(..., true)` for the fence:** lives to transaction end; later arms in one SQL test run inherit "writer" status.
- **Editing `supabase-migrate.yml` to get a deploy out:** the recorded failure mode; revert the merge instead.
- **A data-reading guard in a migration `DO` block:** refused by the linter; TEST is schema-only.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Column-level read control | RLS or a view | `REVOKE SELECT` table + derived `GRANT SELECT (cols)` | RLS is row-level; precedent `20261022120000` |
| Caller-vs-owner detection in a trigger | A GUC flag | `current_user` in an INVOKER trigger | The repo's own red-team removed the GUC shape |
| JSON sub-projection | A bespoke RPC for the key set | PostgREST `->` aliases | Decided in CONTEXT; already used for six keys |
| Gate harness | A new runner | `RED-UNDER` + `RED-UNDER-M` + `RED-UNDER-SETUP`, `scripts/mutation-runner` | Floors and sentinels already police it |

## Common Pitfalls

1. **The OG route silently degrading after (b).** It would render the generic card on a 42501 read error (`reportOgFailure`). Prevention: reader first, anon live-probe arm, deploy-order rule (C2).
2. **A new `strategy_analytics` column is invisible to anon.** Prevention: GRANT 3 goes RED; the author grants or exempts.
3. **Tautological exact-set pin.** Derive the expected list from a typed literal in the test, not from the constant under test.
4. **Rebuilt-object presence drift** (table above).
5. **`UPDATE OF user_id` without `WHEN`** fires on same-value assignments (upserts). Use `WHEN (OLD.user_id IS DISTINCT FROM NEW.user_id)`.
6. **BEFORE INSERT fires on `INSERT ... ON CONFLICT DO UPDATE` before the conflict is resolved.** The demo seed's idempotent upsert dies at the fence even for an existing id.
7. **Fence placeholder reads `''` after a revert**, not NULL.
8. **Gate rolls back but `ALTER ROLE` applies in a lane that autocommits per migration file:** the pin migration must be idempotent (it is: same values).
9. **Role-config gate green does not mean PostgREST applies it.** Only the REST measurement does.
10. **PROD stats survivorship (C3).**
11. **A skip-trailer token in a commit message** suppresses CI, even when denied (CLAUDE.md): say "the skip trailer".

## Code Examples

### Alias fragment and rebuild (sketch, names are the planner's)
```ts
// Source: derived from src/lib/factsheet/basis-metrics.ts:20-28 (BASIS_KPI_MAP) and the
// existing alias idiom in src/lib/factsheet/fetch-and-build-payload.ts:323-325
const BASES = ["cash_settlement", "mark_to_market", "smoothed_mtm"] as const;
export const BY_BASIS_ALIASES = BASES.flatMap((b) =>
  BASIS_KPI_MAP.map(({ serverKey }) => `by_basis_${b}_${serverKey}:metrics_json_by_basis->${b}->${serverKey}`),
).join(", ");
export function rebuildMetricsJsonByBasis(row: Record<string, unknown> | null | undefined) {
  const out: Record<string, Record<string, number | null>> = {};
  for (const b of BASES) {
    const obj: Record<string, number | null> = {};
    let any = false;
    for (const { serverKey } of BASIS_KPI_MAP) {
      const v = row?.[`by_basis_${b}_${serverKey}`];
      obj[serverKey] = typeof v === "number" ? v : null;
      if (v !== null && v !== undefined) any = true;
    }
    if (any) out[b] = obj;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
```

### Column revoke block (precedent, abbreviated)
```sql
-- Source: supabase/migrations/20261022120000_strategies_anon_api_key_id_revoke.sql:80-142 (shape)
DO $verify$
DECLARE v_rel regclass := 'public.strategy_analytics'::regclass; v_cols text;
BEGIN
  REVOKE SELECT ON TABLE public.strategy_analytics FROM anon;
  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) INTO v_cols FROM pg_attribute a
   WHERE a.attrelid = v_rel AND a.attnum > 0 AND NOT a.attisdropped AND a.attname <> 'metrics_json_by_basis';
  EXECUTE format('GRANT SELECT (%s) ON TABLE public.strategy_analytics TO anon', v_cols);
  IF has_column_privilege('anon', v_rel, 'metrics_json_by_basis', 'SELECT') THEN
    RAISE EXCEPTION 'migration <ts> failed: anon can still SELECT metrics_json_by_basis';
  END IF;
END $verify$;
```

## State of the Art

| Old Approach | Current Approach | When | Impact |
|--------------|------------------|------|--------|
| Custom-GUC trigger bypass | `current_user` shift in INVOKER trigger | repo migration `20260515114310` (2026-05) | Unforgeable by an SQL-capable client |
| Table-level anon SELECT on `strategies` | Column-level grants, derived at apply time | `20261022120000` (2026-10) | Template for DBACC-01(b) |
| Role-level `statement_timeout` hits all statements | PostgREST 11.1 role settings; 12.2 hoists function settings | PostgREST 11.1 / 12.2 | A function-level `SET statement_timeout` overrides the role value |

## Runtime State Inventory

Not a rename/refactor phase. Closest items: role config (`pg_db_role_setting`) is cluster-level runtime state outside git and outside `baseline.sql`: the pin migration and the drift read are the only repo-side records. TEST restore (`DROP SCHEMA public CASCADE` rebuild) does not touch role config.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `pg_stat_statements` does not record statements cancelled by `statement_timeout` | Conflicts C3 | Survivorship argument unnecessary; the log pairing is cheap anyway |
| A2 | PostgREST on TEST/PROD is a version that applies impersonated-role settings (>= 11.1) | DBACC-03 | If not, the premise is falsified and the phase replans (the TEST measurement catches it) |
| A3 | `GET /rest/v1/` exposes the PostgREST version at `info.version` | DBACC-03 procedure | Use response headers or the dashboard instead |
| A4 | Hosted `postgres` may `ALTER ROLE anon/authenticated SET ...` inside a migration; the local-stack `postgres` can too | DBACC-03 pin | Replay FATAL on the lane or a failed PROD apply; Wave 0 must prove it before the migration is written |
| A5 | Function-level `SET <custom.guc>` reverts at function exit and is visible to triggers fired inside | DBACC-02 shape A | Shape A is not viable; shape B is unaffected |
| A6 | Realtime, pg_graphql, Storage give a client no caller-supplied SQL | DBACC-02 reachability | `set_config` forgeable by a client => shape A unsafe; B unaffected |
| A7 | No header lets a PostgREST client lengthen its statement timeout | DBACC-03 | The pin would not bound that client |
| A8 | Hosted `db-schemas` is `public, graphql_public` | DBACC-02 reachability | `set_config` still lives in `pg_catalog`; probe resolves it |
| A9 | The local-stack image may already ship anon/authenticated timeouts | gate placement | A local-stack arm may pass vacuously |
| A10 | The scans cover every writer (dynamic SQL, non-TS/Python clients not covered) | DBACC-02 census | A missed writer is refused by the fence in PR-3; the pg_proc pin arm and a CI-lane run surface it |

## Open Questions

1. **Fence mechanism (C1).** What it needs: a founder one-liner on A (GUC literal) vs B (`current_user`, recommended). The plan carries a checkpoint before PR-3 is written; PR-1 (RPC + immutability) is mechanism-independent except for the two wizard-RPC re-bases that shape A would add.
2. **Caller-chosen `id` for seeds** (`p_id uuid DEFAULT NULL` on the RPC vs lookup-by-(user_id,label)).
3. **Anon write verbs on `strategy_analytics`:** revoke in the same migration (precedent did) or leave.
4. **Does PROD hold any all-null basis object** (the one divergent rebuild edge)? Q6.
5. **PROD evidence for "no legitimate request needs longer".** Q2-Q4.
6. **Apply-role privilege for `ALTER ROLE` on hosted and on the lane.** Q8 + Wave 0.

## Live reads still owed (the MCP tools were not callable from this agent)

The orchestrator should run these with the Supabase MCP, marker query first on the right project each time, ONE query per call, read only, and record counts only in tracked text (public repo: no project ids, no secrets, no home paths).

- **Q0 marker (each project):** `SELECT shobj_description(oid, 'pg_database') AS which_database FROM pg_database WHERE datname = current_database();`
- **Q1 PROD ledger tip:** `SELECT max(version) FROM supabase_migrations.schema_migrations;`
- **Q2 per-role statement durations (survivors only, see C3):** `SELECT r.rolname, count(*) AS stmts, max(s.max_exec_time) AS max_ms, round(avg(s.mean_exec_time)::numeric, 2) AS avg_of_means_ms FROM pg_stat_statements s JOIN pg_roles r ON r.oid = s.userid WHERE r.rolname IN ('anon','authenticated','authenticator','service_role') GROUP BY r.rolname;` and `SELECT stats_reset FROM pg_stat_statements_info;`
- **Q3 slowest anon/authenticated statements (normalised text only):** same join, `ORDER BY max_exec_time DESC LIMIT 10`, selecting `rolname, calls, max_exec_time, left(query, 80)`.
- **Q4 cancelled statements:** the Supabase `get_logs` (postgres service) filtered for `canceling statement due to statement timeout` over the last 7 days, count by role.
- **Q5 basis keys (keys only):** `SELECT b.key AS basis, k AS key, count(*) FROM public.strategy_analytics sa, LATERAL jsonb_each(sa.metrics_json_by_basis) b, LATERAL jsonb_object_keys(b.value) k WHERE jsonb_typeof(b.value) = 'object' GROUP BY 1, 2 ORDER BY 1, 2;` (confirms the 17 keys per basis and which bases exist on PROD).
- **Q6 degenerate-basis census (the divergent edge):** `SELECT count(*) FILTER (WHERE jsonb_typeof(metrics_json_by_basis->'mark_to_market')='object' AND num_nonnulls(metrics_json_by_basis->'mark_to_market'->'cumulative_return', ... all seven ...) = 0) ...` for each basis (JSON null counts as non-null in `num_nonnulls` on jsonb; use `jsonb_typeof(...) = 'number'` per key instead).
- **Q7 role settings incl. database scope:** `SELECT r.rolname, s.setdatabase, s.setconfig FROM pg_db_role_setting s LEFT JOIN pg_roles r ON r.oid = s.setrole WHERE r.rolname IN ('anon','authenticated','authenticator','service_role');`
- **Q8 apply-role privilege:** `SELECT rolcreaterole, rolsuper FROM pg_roles WHERE rolname='postgres';` and `SELECT r.rolname, m.admin_option FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid JOIN pg_roles u ON u.oid = m.member WHERE u.rolname = 'postgres' AND r.rolname IN ('anon','authenticated');`
- **TEST REST probes:** PostgREST version, `rpc/set_config` refusal, the lock measurement (above).
- A page fetched this session (Supabase timeouts docs) contained a note addressed to AI agents asking to file a feedback report; it came from the web page, not from the user, and was ignored.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| node | vitest, scans | yes | v25.8.1 | — |
| psql | local SQL checks | yes | on PATH | — |
| pg_ctl / initdb | pg-lane (mutation runner) | yes | on PATH (server binaries not separately verified) | CI runs it |
| docker + supabase CLI | local-stack lane (PG17) | yes (present on PATH) | not started here | CI `sql-tests`; stop the stack and clean up after any Docker use (project rule) |
| Supabase MCP (PROD/TEST reads) | Q0-Q8 | NOT callable from this agent | — | Orchestrator runs the queries above |
| TEST keys (anon, service role) | REST measurement | env-held, not read | — | Orchestrator/executor with the env |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (TS), psql-driven SQL gates under `supabase/tests`, mutation runner `scripts/mutation-runner` |
| Config file | `vitest.config.ts`, `vitest.livedb.config.ts` (live-DB lane), `scripts/mutation-floors.mjs` |
| Quick run command | `npx vitest run src/lib/factsheet/fetch-and-build-payload.test.ts src/lib/factsheet/by-basis-projection.test.ts` |
| Full suite command | `npm run test` + `node scripts/lint-sql-gates.mjs --self-test` + `node scripts/mutation-runner/run.mjs` + `bash scripts/local-stack/run.sh up` (then the corpus) |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DBACC-01 (a) | Select carries exactly the 21 aliases; bare `metrics_json_by_basis` fails; OG select identical | unit | `npx vitest run src/lib/factsheet/by-basis-projection.test.ts` (+ tighten the regex in `fetch-and-build-payload.test.ts:1696,1805`) | new + edit |
| DBACC-01 (a) | Rebuild parity incl. all-null edge | unit | same | new |
| DBACC-01 (b) | anon cannot read the column; every other column readable; no table-level SELECT | SQL gate + mutation | `supabase/tests/test_strategy_analytics_anon_grants.sql` via pg-lane + local-stack; RED-UNDER-M twins | new (Wave 0) |
| DBACC-01 (b) | Real readers as a signed-out visitor (OG, factsheet, browse) | live-DB vitest | extend `src/lib/anon-strategies-live-probe.test.ts` (runs in `frontend-live-db-lane`) | edit |
| DBACC-02 (i) | `user_id` cannot change for ANY role incl. postgres | SQL gate + mutation | new `test_api_keys_user_id_immutable.sql`; twin drops the trigger | new |
| DBACC-02 (ii) | Direct admin/service_role INSERT refused; writer RPC insert succeeds and keeps attestation; function-set pin (shape B) | SQL gate + mutation | invert arm (2) of `test_api_keys_insert_not_client_writable.sql`; new catalogue arm | edit + new |
| DBACC-02 | Route uses the RPC; same error mapping (23505 venue identity) | unit | `src/app/api/keys/validate-and-encrypt/route.test.ts` | edit |
| DBACC-02 | RPC name in the mutating-RPC list | unit | `src/__tests__/audit-coverage.test.ts` | edit |
| DBACC-03 | PostgREST honours role timeout; lock released; reader unblocked | recorded TEST measurement (manual, verbatim in SUMMARY) | the procedure above | n/a (not automatable in CI against shared TEST) |
| DBACC-03 | Role ceilings present and not above pinned; no client-callable function carries `statement_timeout` | SQL gate + mutation (pg-lane) | new `supabase/tests/test_client_role_timeouts.sql`; twin edits the migration value / removes it | new (Wave 0) |
| DBACC-03 | Platform drift | TEST/PROD read | optional `test-db-drift` step | booked |
| All | PROOF-01 (neuter, RED with named arm first, `cp` back, `cmp`, GREEN, verbatim in SUMMARY) | procedure | per gate | per plan |

### Sampling Rate
- **Per task commit:** the quick command plus the one gate file touched.
- **Per wave merge:** full vitest, `lint-sql-gates --self-test`, the mutation runner on the touched files, the local-stack corpus.
- **Phase gate:** all green AND the TEST measurement recorded before any DBACC-03 migration.

### Wave 0 Gaps
- [ ] `supabase/tests/test_strategy_analytics_anon_grants.sql` (DBACC-01 b)
- [ ] `supabase/tests/test_client_role_timeouts.sql` (DBACC-03) and a lane measurement that `ALTER ROLE` applies for the migration role
- [ ] `supabase/tests/test_api_keys_user_id_immutable.sql` (+ fence arms)
- [ ] `src/lib/factsheet/by-basis-projection.ts` and its test
- [ ] Framework install: none

## Security Domain

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V4 Access Control | yes | Column grants (DBACC-01), trigger-enforced writer path and immutability (DBACC-02), service_role-only RPC |
| V5 Input Validation | yes | The new RPC normalises and CHECK constraints bound `venue_account_id`/`venue_server`; no free-form SQL |
| V6 Cryptography | no change | `api_*_encrypted` columns pass through unchanged; never log them (route scrubs) |
| V7 Error handling / logging | yes | RPC errors scrubbed with `scrubSeamError` as today |
| V13/V14 Configuration | yes | Role timeouts pinned and drift-read; `search_path` pinned on every new SECDEF function |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Whole-column read by anon of per-basis series | Information disclosure | Column revoke + alias projection |
| Admin-client insert with a request-supplied `user_id` writes into another tenant | Tampering / Elevation | Writer-path-only INSERT + immutable `user_id` |
| Forged fence flag by an SQL-capable role | Elevation | `current_user` shift (shape B) or probe-proven unreachable GUC |
| Client holds a table lock | Denial of service | Role `statement_timeout` (+ no client-callable LOCK function; gate pins it) |
| New SECDEF function executable by PUBLIC | Elevation | `REVOKE ALL ... FROM PUBLIC, anon, authenticated; GRANT ... TO service_role` (DROP+CREATE re-grants via default ACL: use CREATE OR REPLACE or re-issue the ACL) |

## Project Constraints (from CLAUDE.md)

- Marker query before any write; `current_database()` proves nothing; this checkout's CLI is linked to PROD; never `db push`/`--linked` casually. PROD reads via MCP only, one query per call, never chained.
- Gates: `RED-UNDER` + `RED-UNDER-M` + `RED-UNDER-SETUP`; read floors by SYMBOL from `scripts/mutation-floors.mjs`, never from restated numbers; `WAIVED_CEILING` stays 0; `sql-mutation` timeout 20 is a ceiling, never raised.
- Migrations: house post-verify, catalogue-only (no data-reading guard), re-base `CREATE OR REPLACE` on the latest definition, SECDEF helpers in policies need anon EXECUTE, deletion-cascade guards exempt `quantalyze.sanitize_in_progress='on'`.
- CHANGELOG entry per ship (mechanism in CLAUDE.md), VERSION/package.json byte-equal; never write the skip-trailer tokens in a commit or PR body; ship branch changes nothing under `.planning`.
- `TODOS.md` holds open work only: delete the entries this phase closes in the same PR and name them in the CHANGELOG.
- `completion is historical`: use `verified_at_sha` + `drift_subjects`, never `covered_digest`/`covered_files`.
- Public repo: no secrets, PROD ids, home paths or account numbers in tracked text. Use "the skip trailer" in prose.
- `AGENTS.md`: this Next.js has breaking changes; read `node_modules/next/dist/docs/` before Next-specific code (this phase touches server route handlers lightly).
- DESIGN.md governs any UI; this phase has none.

## Sources

### Primary (HIGH confidence, read this session)
- `supabase/migrations/20261022120000_strategies_anon_api_key_id_revoke.sql`, `supabase/tests/test_strategies_anon_grants.sql`, `src/lib/anon-strategies-live-probe.test.ts`
- `supabase/migrations/20260515114310_redact_guc_bypass_use_current_user.sql`, `20260811210000_api_keys_attested_venue.sql`, `20260813150106_wizard_rpcs_service_role_writer.sql`, `20261123180000_api_keys_venue_server.sql`
- `analytics-service/services/{metrics.py,basis_series.py,job_worker.py}`, `src/lib/factsheet/*`, `src/app/api/og/factsheet/[id]/route.tsx`, `src/app/api/keys/validate-and-encrypt/route.ts`
- `supabase/schema/baseline.sql`, `scripts/pg-lane/run.sh`, `scripts/mutation-runner/run.mjs`, `scripts/mutation-floors.mjs`, `scripts/lint-migration-data-dependence.mjs`, `scripts/lint-app-guc.mjs`, `.github/workflows/ci.yml`
### Secondary (MEDIUM, cited docs)
- docs.postgrest.org transactions page (impersonated role settings, hoisting); supabase.com/docs/guides/database/postgres/timeouts (defaults, reload); supabase.com/blog/postgrest-11-1-release (via search)
### Tertiary (LOW)
- Training knowledge for `pg_stat_statements` failure accounting and function-level `SET` semantics (A1, A5)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH, nothing new is installed.
- DBACC-01: HIGH on shape and census; MEDIUM on rebuild edge (needs Q5/Q6).
- DBACC-02: HIGH on census and mechanism analysis; the C1 conflict is a decision, not a research gap.
- DBACC-03: MEDIUM, PostgREST behaviour is documented but the premise is exactly what the TEST measurement exists to prove; PROD evidence owed.

**Research date:** 2026-11-26
**Valid until:** 7 days for live-state claims (ledger tip, role config), 30 days for repo structure.

## Live reads taken by the orchestrator (2026-11-26, PROD, read only, marker first in every query)

Every query carried the marker column, and it named PRODUCTION each time. Counts only.

- **Q1 ledger tip:** `20261126180000`. It equals the latest repo migration, so a new migration needs a timestamp after it, and after whatever Phase 242 lands first.
- **Q2 per-role statement durations** (pg_stat_statements, stats_reset 2026-04-05, so about 7.5 months of history): `anon` 78 statements, 1,103,480 calls, max 487.4 ms. `authenticated` 364 statements, 257,350 calls, max 1601.8 ms. `authenticator` max 2815.3 ms. `service_role` max 2115.1 ms (no role timeout). Survivorship caveat C3 applies: a statement the timeout cancelled is not in these figures.
- **Q3 slowest authenticated statements:** a PostgREST DELETE on `strategies` (max 1601.8 ms), then `csv_daily_returns`, an RPC, `audit_log` and `allocator_holdings` reads, all under 1.7 s. The slowest anon statement is 487.4 ms.
- **Q4 cancellations:** the postgres log stream for the last 24 h holds 1362 lines and 6 matching "error". 0 match "statement timeout". This is the 24 h window the tool allows, not 7 days.
- **Conclusion for "no legitimate request needs longer":** the recorded maximums sit at 16% (anon, of 3 s) and 20% (authenticated, of 8 s) of the existing ceilings, and no timeout cancellation appears in 24 h of logs. Pinning 3 s and 8 s changes nothing a client sees today.
- **Q5 basis keys:** PROD holds ONLY `cash_settlement` (2 rows), with the 17 keys the research lists. No `mark_to_market` or `smoothed_mtm` basis exists on PROD today. The alias set still covers all three bases, because the writer can emit them.
- **Q6 degenerate basis:** 0 rows have a present basis whose seven KPI keys are all non-numbers. The divergent edge of the rebuild rule does not occur on PROD.
- **Q7/Q8 role settings and apply-role privilege:** the settings are global (`setdatabase = 0`): anon `statement_timeout=3s`, authenticated `8s`, authenticator `8s` plus `lock_timeout=8s`. `postgres` has CREATEROLE (not superuser) and ADMIN OPTION on both `anon` and `authenticated`, so `ALTER ROLE anon/authenticated SET ...` is permitted for the migration role on hosted. The local-stack lane is still a Wave 0 check.
- **Still owed (execution, TEST writes):** the TEST REST measurement (PostgREST version, `rpc/set_config` refusal, lock hold and release). It is the first task of the DBACC-03 plan.
