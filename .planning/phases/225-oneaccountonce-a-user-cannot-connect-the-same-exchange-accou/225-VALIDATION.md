---
phase: "225"
slug: "oneaccountonce"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-23"
---

# Phase 225 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

Seeded from 225-RESEARCH.md `## Validation Architecture` (verbatim below); the per-task map is filled by the planner's `<verify>` blocks.

## Validation Architecture (from research)

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest (TS routes, libs, exec-SQL tests), pytest 9.0.2 (analytics-service), pg-lane + `psql` gates (`supabase/tests/*.sql`), mutation runner (`scripts/mutation-runner/run.mjs`), mypy strict |
| Config files | `vitest.config.ts`, `analytics-service/pytest.ini`, `analytics-service/pyproject.toml` (`[tool.mypy]`), `scripts/mutation-floors.mjs` |
| Quick run (route + libs) | `npx vitest run src/app/api/strategies/create-with-key/route.test.ts src/app/api/keys/validate-and-encrypt/route.test.ts src/lib/account-share-note.test.ts src/lib/wizardKeyRosters.test.ts src/lib/wizardErrors.invariant.test.ts` |
| Quick run (stamper) | `cd analytics-service && python3 -m pytest tests/test_account_identity_stamper.py -x -q` (130 passed at HEAD) |
| Types | `cd analytics-service && mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` (from `.github/workflows/ci.yml`; the Makefile `typecheck` target runs the same set) |
| One SQL gate | `bash scripts/pg-lane/run.sh --workdir <scratch> --apply <the gate's RED-UNDER-SETUP files> --gate supabase/tests/test_api_keys_venue_identity_uniq.sql` (the apply list is the file's own `RED-UNDER-SETUP` JSON; the new migrations must be appended to it and to every other gate whose behaviour reads the new column or function) |
| Full suite | `npx vitest run`; `cd analytics-service && python3 -m pytest`; `node scripts/mutation-runner/run.mjs`; `npm run lint`; `npm run schema:functions:check` |

Environment notes measured: the Docker daemon is DOWN on the research machine, so the local-stack lane (`scripts/local-stack/run.sh`, used by `sql-tests`) cannot boot; the pg-lane and the exec-on-fixture vitest pattern need only PostgreSQL 16 server binaries, which are installed. Executors that need `supabase gen types --local` need Docker started first.

### Phase Requirements → Test Map

| Req | Behaviour | Test type | Command | Exists | Neuter target for PROOF-01 (named arm first) |
|-----|-----------|-----------|---------|--------|----------------------------------------------|
| ONCE-01 (exchange) | OKX key whose uid a same-owner live key holds is refused 409 `KEY_VENUE_ALREADY_CONNECTED`, uid in no body/log | vitest | `route.test.ts` (existing arm at `:2006`) + new owner-vs-owner arm | partial | drop `.eq("user_id", userId)` in the resolver, expect the cross-owner arm RED |
| ONCE-01 (MT5) | same-owner MT5 login + same server refused by name before `validateKey`, zero writes | vitest | `route.test.ts` new arm beside `:2067` | no (Wave 0) | make the pre-validation arm fall through |
| CONN-01 | own draft on the same account answers the new named 409 with `strategy_name`; session fence still answers `deduped` | vitest | `route.test.ts` flips at `:1675 :1692 :2084 :2193 :2692`, keeps `:1544 :4647` | flips needed | restore `deduped: true` in D2 and D3 |
| ONCE-01 (wizard copy) | new code recognised, copy present, rosters/invariants consistent | vitest | `wizardKeyRosters.test.ts`, `wizardErrors.invariant.test.ts`, `wizardErrors.roster-render.test.tsx`, `ConnectKeyStep.test.tsx` | edits | remove the code from `CREATE_WITH_KEY_OWN_CODES` (UNKNOWN render) |
| ONCE-02 | different owners, same exchange/login/server both connect; each owner's resolver sees only its own rows | vitest + SQL | route test with two user ids; SQL arm inserting for two users | no | weaken the index to drop `user_id` (SQL arm RED), drop the resolver owner filter (route arm RED) |
| ONCE-02 (strategy-linked key in an allocator book) | a key with `strategies.api_key_id` and allocator holdings stays unaffected by a same-owner connect on another account | vitest | route test: second account connects, first untouched | no | n/a (assert zero writes to the first key) |
| ONCE-04 | two keys of different owners with the same login and server both stamp with no marker; same-owner second key marks | pytest | `test_account_identity_stamper.py` new arms | no | remove the `user_id` filter in the holder lookup / drop the server write |
| CONN-03 (index) | same owner + login, servers A and B both live; same server refused 23505 naming the index; NULL vs NULL refused | SQL gate | `test_api_keys_venue_identity_uniq.sql` rewritten arm 2 + new arms | edit | recreate the old login-only index (live `sql` step) |
| CONN-03 (column) | CHECK refuses blank and over-length server; column not in `API_KEY_USER_COLUMNS_ARR`; column ungranted to `authenticated` | SQL gate + vitest | new SQL arm; `sec-005-api-keys-projection.test.ts` | no | drop the CHECK / add the column to the allowlist |
| CONN-03 (writers) | connect writes the normalised server into the same INSERT; routes pass it | vitest | `route.test.ts` for both routes asserting the RPC args / insert row | no | stop sending `p_venue_server` |
| CONN-03 (backfill) | stamped MT5 key with NULL server gets its server written once from the session; unstamped key gets login and server in one UPDATE; no data-reading DO block | pytest + lint | `test_account_identity_stamper.py`; `node scripts/lint-migration-data-dependence.mjs` | no | skip the backfill write |
| CONN-03 (normalisation parity) | TS and Py produce identical bytes for an ASCII+whitespace fixture list | vitest + pytest | one fixture file read by both | no | change one side's fold |
| MT5D-08 (stamper) | failing holder beside working key: working key holds the slot, old holder marked `duplicate`, dependents re-pointed, audit once, recompose enqueued; working holder keeps its slot; both failing leave the incumbent | pytest | `test_account_identity_stamper.py` | no | make `working_holder_predicate` constant, or skip the swap call |
| MT5D-08 (function) | `swap_account_slot` ordering against the real trigger and index: marked new key, holder with dependents, wrong owner, working holder, composite pair each behave per the Pattern; service_role-only ACL | SQL gate | new `supabase/tests/test_swap_account_slot.sql` with `RED-UNDER-M` twins | no | edit the function (drop the re-point UPDATE: `ACCOUNT_SHARE_KEY_IS_A_HOLDER`; drop the marker clear: `ACCOUNT_SHARE_HOLDER_IS_MARKED`) |
| MT5D-08 (connect) | failing same-owner holder: key admitted unstamped then swapped; working holder: refused | vitest | `route.test.ts` for both routes | no | resolver returns "working" always |
| D-18 parity | SQL (including the new function), TS and Py tuples agree | vitest + pytest | `account-share-note.test.ts`; `test_derive_allocator_equity_job.py` | extend | change one tuple member |
| F-9 card sentence | failing marked key with a working holder names the holder; WR-02 otherwise unchanged | vitest | `account-share-note.test.ts`, `AllocatorExchangeManager*.test.tsx` | extend | return null |
| ONCE-03 | census/delete script deletes exactly the manifest on a fixture; aborts untouched on any difference | vitest exec-on-fixture | new `src/__tests__/*-exec.test.ts` modelled on `mt5-parity-capture-sql-exec.test.ts` | no | delete the equality assertion in the script: the "extra key" arm goes RED |
| ONCE-03 (live) | before/after counts and holder fingerprints recorded verbatim | manual, orchestrator | marker query then `census.sql`, `delete.sql` | n/a | n/a (checkpoint, not a gate) |

### Sampling Rate
- **Per task commit:** the quick run lines above for the touched layer, plus `mypy` when Python changed.
- **Per wave merge:** full vitest, full pytest, the touched SQL gates via pg-lane, `npm run lint`, `npm run schema:functions:check`.
- **Phase gate:** the migration PRs pass migration-reviewer and rls-policy-auditor with no MEDIUM+ finding; `sql-mutation` runs every new `RED-UNDER-M` (the push to `main` takes a subset, the nightly takes FULL; a migration no gate lists forces a FULL fallback, so append the new migrations to the relevant `RED-UNDER-SETUP` lists); `node scripts/mutation-runner/run.mjs` exits 0 with `WAIVED_CEILING` untouched.

### Wave 0 Gaps
- [ ] New SQL gate file or arms for the column CHECK, the rewritten index arm and the swap function, with `RED-UNDER` prose plus `RED-UNDER-M` twins.
- [ ] Update every gate that pins the 12-argument `create_wizard_strategy` signature (list in F-6, item 5).
- [ ] The doubled-language normalisation fixture file and its two readers.
- [ ] The census/delete SQL files and their executed-on-fixture vitest.
- [ ] Grep every census a new `supabase/tests` file or arm moves (`scripts/mutation-floors.mjs` symbols, `src/__tests__/mutation-runner-floors.test.ts`, `docs/sql-gate-lineage.md`, any file-count pin) and move them in the same commit; read floors by symbol, never restate.
- [ ] `database.types.ts` regeneration path (needs the Docker local stack, or a documented hand edit).

### PROOF-01 protocol (per gate)
Back up the file to be neutered with `cp <file> <scratch>/<name>.bak`; apply the neuter edit; run the gate and record the RED line with the named arm first; restore with `cp <scratch>/<name>.bak <file>`; `cmp <file> <scratch>/<name>.bak` must print nothing; rerun and record GREEN. Record the edit, command, RED line and GREEN line verbatim in the plan SUMMARY. Never `git checkout`, `git restore` or `git stash` on uncommitted work.


---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|---|---|---|---|
| Live ONCE-03 deletion on PROD | ONCE-03 | PROD writes run by the orchestrator via MCP; executors have no PROD access | Marker query, census re-run that STOPS on any difference from the confirmed manifest, delete, before/after counts recorded verbatim |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 225s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** {pending / approved YYYY-MM-DD}
