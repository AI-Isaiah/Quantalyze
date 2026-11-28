# Phase 243: DBBACKSTOP - Context

**Gathered:** 2026-11-26
**Status:** Ready for planning (DBACC-02 mechanism decided by the founder 2026-11-26: candidate 1)

<domain>
## Phase Boundary

Database-level backstops, delivered by migration and by one TypeScript select. Three requirements:

- **DBACC-01 (RANK-SPLAT-01).** An anonymous request reads only the named metric keys a factsheet needs, never the whole `strategy_analytics.metrics_json_by_basis` column.
- **DBACC-02 (TODOS "ARCHITECTURE DECISION OWED: api_keys writes have left the RLS-enforced plane").** A database-level backstop refuses an `api_keys` write whose `user_id` is not the caller's, including an insert through the admin client. `FORCE RLS` on `api_keys` is not the mechanism.
- **DBACC-03 (TRIGGERREVOKE-LOCKHOLD-01).** A client role holding UPDATE or DELETE cannot keep a table-wide lock past a set timeout. A recorded TEST measurement comes first, showing PostgREST honours the timeout and that no legitimate request needs longer.

PROOF-01 applies to every gate: RED on a neutered copy with its named arm first, restored from a byte backup (`cp` back, `cmp`), GREEN, recorded verbatim in the plan SUMMARY. New SQL arms carry `RED-UNDER` twins. Every migration passes migration-reviewer and rls-policy-auditor with no MEDIUM+ finding, in the one serial migration lane.

Out of scope: Phase 244's DBACC-04..06, Phase 242's SECR-03/04.

</domain>

<decisions>
## Implementation Decisions

### DBACC-01: anon metric reads
- Measured 2026-11-26 on PROD (read only): `anon` and `authenticated` hold table-level SELECT on `public.strategy_analytics`. The `analytics_read` policy admits any role to a row whose strategy is `published` (or is the caller's own). So an anonymous REST request can read the WHOLE `metrics_json_by_basis` column of every published strategy today, directly, without touching the payload builder. The payload builder (`src/lib/factsheet/fetch-and-build-payload.ts`, `resolveFactsheetInputs`) reads through the admin client and also selects the column whole.
- Two halves, both in scope. (a) The payload builder's embed projects `metrics_json_by_basis` as a pinned set of named `->` aliases, and a test FAILS when a key outside the pinned alias set appears in the projection. This is the ROADMAP's SC-1 wording. (b) `anon` loses SELECT on the `metrics_json_by_basis` column: a table-level SELECT revoke, then a column-level GRANT of every other column, the pattern `api_keys` already uses. A SQL gate arm proves `anon` cannot read the column and can still read the columns anon readers use. — **Reversibility:** costly — a column-level grant must be extended by every later migration that adds a `strategy_analytics` column, or anon readers of that column break. Decided by the phase agent (no clients yet, founder rule "take the call, say what I did"). Founder may override at plan review.
- Before (b) is written, research proves by census that no anon-client code path reads `metrics_json_by_basis` (the readers found in the scout are the admin-client builder, the OG route and authenticated dashboard pages). If any anon reader needs it, that reader moves to the named aliases first, or (b) narrows to the keys it needs.
- `authenticated` non-owners can still read the column of a published strategy. Free sign-up makes this close to anon. It is NOT closed here, because owner-side dashboard pages read the column through the user client. The plan records it as a known limit in the SUMMARY and CHANGELOG, not as a silent gap.
- The alias shape follows the column's real nesting (by basis: `cash_settlement`, `mark_to_market`, `smoothed_mtm`, or whatever the analytics writer emits). Research reads the writer (`analytics-service`) and every TS consumer (`basis-metrics.ts`, `headline-basis.ts`, `composite-read-path.ts`, `og-metrics.ts`, `readSingleKeyBasisOpts`) to derive the exact key set before the alias list is fixed.

### DBACC-02: api_keys ownership backstop. FOUNDER DECISION 2026-11-26: candidate 1
- ⭐ **FOUNDER DECISION 2026-11-26** (AskUserQuestion answer "Two-part backstop (Recommended)", relayed by main). DBACC-02 is candidate 1. **(i)** A BEFORE UPDATE trigger makes `api_keys.user_id` immutable for every role, BYPASSRLS included. **(ii)** A BEFORE INSERT check refuses any insert made outside a sanctioned SECDEF writer function, through a transaction-local fence GUC. The founder ACCEPTS the narrowing from "the caller's user_id" to "only the audited writer path can insert, and user_id can never be repointed". The `validate-and-encrypt` insert moves into an RPC, and the e2e and seed inserts move to the same RPC. Both moves are accepted. Migration-reviewer and rls-policy-auditor must be clean before merge. Recorded per the deviation policy here, in ROADMAP's Phase 243 section and in REQUIREMENTS DBACC-02's wording. — **Reversibility:** one-way — it is a trigger on a PROD table that every connect path writes through, and the writer-path contract binds every future `api_keys` insert.
- ⛔ **MECHANISM CORRECTED 2026-11-26 (main relaying the founder: "Proceed with the current_user mechanism"):** the insert fence is a `current_user` check, NOT a transaction-local GUC. The founder approved the semantics, not the GUC mechanism. Migration `20260515114310` (Migration 127, audit-2026-05-07 red-team Findings 1/3/4/8) already removed the GUC shape as forgeable, because any role can `set_config('quantalyze.<x>', 'on', true)` on a custom namespace. It standardised on `current_user`, and the two existing `api_keys` scrub triggers already use it. The rule: the BEFORE INSERT trigger refuses when `current_user` is a client or API role (`anon`, `authenticated`, `service_role`). A postgres-owned SECDEF writer body runs as its owner and passes, and so do direct `postgres` sessions (migrations, SQL fixtures). A catalogue arm pins the exact set of functions whose body inserts into `api_keys`, so a new SECDEF inserter cannot appear silently. The GUC wording in the decision bullet above is kept as lineage. ⭐ **Polarity (phase agent, 2026-11-27, after the pattern map):** the fence is an ALLOW-list, deny by default. An insert passes only when `current_user IN ('postgres', 'supabase_admin')`, which means a postgres-owned SECDEF writer body or a direct owner session. Every other role is refused. That includes `anon`, `authenticated` and `service_role`, and any role added later. It is stricter than the deny-set wording above and delivers the same approved semantics.
- **Delivery (accepted by main 2026-11-26):** three PRs for DBACC-02. PR-1: the new writer RPC plus the `user_id` immutability trigger. PR-2: the route, seeds and tests move to the RPC. PR-3: the insert fence. DBACC-01's anon column revoke ships only after its single anon reader, the OG route, has moved to the named aliases.
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
- ⭐ **FOUNDER DECISION 2026-11-27** ("Accept the gap (Recommended)", relayed by main): the plan 01 TEST measurement's signed-in (authenticated) and service_role arms are ACCEPTED as not run. No TEST service-role credential was available, and a secret guard blocks the env file. The anon arm is the discriminating proof, because `authenticator` carries the same 8s. It ran: 3.20s and 3.87s, both 57014 (`243-01-MEASUREMENT.md`). The verifier must not treat the missing arms as a gap.
- If the TEST measurement shows PostgREST does NOT honour the role setting, stop. That falsifies the plan premise, so replan rather than patch.

### Decided autonomously
- [DBACC-01] Q: "Named PostgREST `->` aliases or an RPC returning the key set?" → Selected: "named aliases in the existing embed, matching how `metrics_json` is already projected" — TS-only, one select, undone by editing the list.
- [DBACC-01] Q: "How is the alias set pinned?" → Selected: "an exact-set test over the parsed select string that fails on an extra or missing key, beside the existing bare-`metrics_json` ban" — a test file, cheap to change.
- [Plan split] Q: "How are plans grouped?" → Selected: "one plan per requirement. DBACC-03's measurement task comes first in its plan. DBACC-02's plan carries the founder decision. Migrations are serialized in one lane in order DBACC-03, DBACC-01(b), DBACC-02" — plan files only.
- [Ship] Q: "One PR or several?" → Selected: "DBACC-01 and DBACC-03 can ship in one PR without waiting on DBACC-02. DBACC-02 ships in a follow-up PR after sign-off" — PR packaging only.
- [Migration timestamps] Q: "What timestamp floor?" → Selected: "after the PROD ledger tip and after any migration Phase 242 lands. Re-check `origin/main` and the PROD ledger before each push. Re-base any CREATE OR REPLACE on the latest definition across all migrations" — renaming a file before merge is cheap.

### Claude's Discretion
- Exact probe object names, gate file names, and which `supabase/tests` file or lane hosts each new arm.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/factsheet/fetch-and-build-payload.ts` `resolveFactsheetInputs`: the embed already projects `metrics_json->x` aliases, and its test forbids a bare `metrics_json`. Extend the same pattern.
- Column-level grant pattern on `api_keys` (e.g. `20260920120000_api_keys_venue_account_id_grant.sql`).
- Trigger precedents: `20260410225609` (`check_strategy_api_key_ownership`), `20260710120000` (`enforce_strategy_keys_owner_coherence`).
- Phase 156 header prose: auth.role() vs EXECUTE ownership, and owner-role callers (`postgres`, `supabase_admin`, psql harness) reaching in-body gates.

### Established Patterns
- SQL gates in `supabase/tests` with `RED-UNDER` annotations, mutated by `sql-mutation`. Several censuses move when a file or arm is added: grep them all.
- Migrations: house-style post-verify `DO` blocks. A NEW data-reading guard is refused by `scripts/lint-migration-data-dependence.mjs`.
- PROD migrations auto-apply after `apply-test`. There is no human stop, so every review happens before merge.

### Integration Points
- `metrics_json_by_basis` consumers: `basis-metrics.ts`, `headline-basis.ts`, `composite-read-path.ts`, `og-metrics.ts`, `src/app/api/og/factsheet/[id]/route.tsx`, `FactsheetView.tsx`, `basis-context.tsx`, dashboard `strategies/page.tsx`, `SyncPreviewStep.tsx`.
- `api_keys` writers: listed under DBACC-02 constraints.

</code_context>

<specifics>
## Specific Ideas

- Phase 225 is still open (19/21: plan 18 is a founder control, plan 21 Task 3 a post-deploy read). Neither changes `api_keys` schema, triggers or writers, so it does not block DBACC-02. Re-check at DBACC-02 execution.
- Merge window for this run: no merge to main before 23:15 UTC 2026-11-26 (a Railway probe is running). Planning and PR CI are fine.

</specifics>

<deferred>
## Deferred Ideas

- `authenticated` non-owner read of the whole `metrics_json_by_basis` column of a published strategy. It needs owner-side readers moved off the whole column first. Recorded as a known limit of DBACC-01, a candidate for a later phase.
- `GRANT ALL` residue on `api_keys` (REFERENCES, anon DELETE) is a separate TODOS Security entry, not DBACC-02.

</deferred>
