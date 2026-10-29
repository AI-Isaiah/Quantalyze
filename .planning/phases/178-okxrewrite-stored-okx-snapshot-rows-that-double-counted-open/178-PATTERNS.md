# Phase 178: OKXREWRITE - Pattern Map

**Mapped:** 2026-10-28
**Files analyzed:** 14 (9 modified, 5 new)
**Analogs found:** 14 / 14 (every file has a same-file or sibling analog; no file is left to RESEARCH snippets alone)

All analog paths below were checked as git-TRACKED source (the seven code/doc/test files and the census directory return from `git ls-files`; the 173-03 plan and summary are tracked). No gitignored capability mirror is named. The MARKSOURCE plan 14 / plan 10 analogs live only on branch `feat/167.2.1.1.1.1-marksource` (read with `git show <branch>:<path>`), so they are cited by plan number, not by a main-tree path.

Line numbers are as of this worktree's HEAD and are a starting point only. Re-grep by symbol before editing (project rule: cite by symbol, lines drift).

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `analytics-service/services/equity_reconstruction.py` (`_select_account_crawl_keys`, `_AccountCrawl`, `_crawl_whole_account`, completion audit metadata) | service (pure selection rule + audit) | transform | the same function's Deribit `zero_contribution` counter | exact (same file, same shape) |
| `analytics-service/scripts/allocator_history_probe.py` (`ACCOUNT_RECORD_KEYS`, `_ACCOUNT_VALIDATORS`, `_account_record`, `_probe_account`, `summarize` comment) | utility (read-only probe, whitelist emitter) | batch / request-response | the `zero_contribution_members` key wiring; `okx_chain_record.CHAIN_KEYS` as the additive-key precedent | exact |
| `analytics-service/tests/test_reconstruct_whole_account.py` | test | transform + event-driven (fake job) | its own selection tests and `test_an_exchange_account_the_rebuild_cannot_read_refuses_before_any_venue_call` | exact |
| `analytics-service/tests/test_allocator_history_probe.py` | test | batch | `test_a_selection_refusal_is_a_token_and_that_accounts_keys_are_never_decrypted`, `test_a_deribit_exchange_account_counts_as_zero_and_does_not_block_the_comparison` | exact |
| `analytics-service/tests/test_reconstruct_force_rebuild.py` (no edit expected; a constraint on the code edit) | test | transform | itself (`test_forced_rebuild_refusal_reasons_are_a_closed_set`) | exact |
| `docs/runbooks/marksource-okx-history-correction.md` (B'1 rule, 16 tokens, new P7, `crosswalk` form, `audit` form column, B'5 check, "Where this stands") | config (operator runbook + SQL forms) | request-response (read-only SQL) | the same runbook's `pollafter` / `inflight` / `audit` forms and P0-P6 list | exact |
| `docs/runbooks/marksource-okx-census/okx-nonworking-keys.sql` (NEW) | utility (read-only census SQL) | batch | `okx-rebuild-feasibility.sql` | role-match (same CTE shape, new join to holdings span) |
| `docs/runbooks/marksource-okx-census/README.md` | config (doc table) | n/a | its own table | exact |
| `src/__tests__/marksource-okx-census-sql.test.ts` | test (static guard) | file-I/O | itself (`EXPECTED_FILES`, `EXPECTED_FORMS`, `FORMS_WITH_ACCOUNT_CTE`, token parity is NEW) | exact |
| Plan 178-03 (operator: deploy confirm, full probe, crosswalk, dead-key census, predicted-outcome table, founder checkpoint) | operator plan | event-driven | `173-03-PLAN.md` Task 1 and Task 2 | exact |
| Plan 178-04 (operator: gates, per-target ordering reading, B'3a-B'6, records) | operator plan | event-driven | `173-03-PLAN.md` Task 3 + MARKSOURCE plan 14 Tasks 1 and 3 | exact |
| Plan 178-01 / 178-02 (autonomous code plan; docs+SQL plan) | plan | n/a | `173-01/02-PLAN.md` frontmatter shape | role-match |
| `TODOS.md` dated readings (operator records PR, not the ship branch) | config (ledger) | n/a | `173-03-PLAN.md` Task 3 step 3 (a-e) | exact |
| `CHANGELOG.md` / `VERSION` / `package.json` (ship) | config | n/a | CLAUDE.md "CHANGELOG discipline" mechanism | exact |

## Pattern Assignments

### `analytics-service/services/equity_reconstruction.py` (service, transform) - D-05 root-cause fix

**Analog:** the same function, `_select_account_crawl_keys` (`~2668-2731`). The Deribit zero-contribution counter is the template for the new dead-group counter: a counted-and-skipped group, returned to the caller, written to the audit.

**Current defect, the one raise site to change** (`~2713-2715`):
```python
working = [member for member in group if working_holder_predicate(member)]
if not working:
    raise ForcedRebuildRefusedError("account_key_not_working")
```

**Counter template to copy** (`~2701-2710`, Deribit):
```python
selected: list[Mapping[str, Any]] = []
zero_contribution = 0
for group in account_groups(account_keys):
    ...
    if venue in _ACCOUNT_ZERO_CONTRIBUTION_VENUES:
        zero_contribution += 1
        continue
```

**Target shape** (skip and count; all-dead still refuses with the same token):
```python
if not working:
    non_working_excluded += 1      # D-05: a dead key is relevant to that key only
    continue
...
if not selected:
    if non_working_excluded:
        raise ForcedRebuildRefusedError("account_key_not_working")
    raise ForcedRebuildRefusedError("account_sum_empty")
```

**HARD CONSTRAINT (found in this mapping, not in RESEARCH):** `test_forced_rebuild_refusal_reasons_are_a_closed_set` (`tests/test_reconstruct_force_rebuild.py`, raise-site scan) reads the module source with `re.findall(r'ForcedRebuildRefusedError\(\s*"([a-z_]+)"\s*\)', source)` and asserts the set of raised literals EQUALS the 16 tokens. RESEARCH Pattern 1 sketches `raise ForcedRebuildRefusedError("account_key_not_working" if x else "account_sum_empty")`. A conditional expression inside the call does NOT match that regex, so `account_key_not_working` and `account_sum_empty` would lose their raise sites and the closed-set pin goes RED. Use two separate raises with literal tokens, as in the target shape above. The same docstring of the pin says "every raise names its token as a literal".

**Return-shape choice (planner decides, both are analogs of existing code):**
- 3-tuple `(selected, zero_contribution, non_working_excluded)`: touches 6 unpack sites in `tests/test_reconstruct_whole_account.py` (`_refusal` at ~120, and ~144, 150, 166, 190, 201), the crawl at `~6269` (`selected, zero_contribution = _select_account_crawl_keys(account_keys, own_key_id)`) and the probe at `~1583`.
- Separate pure helper: leaves all signatures alone. If the probe calls a new `er._...` name it MUST be added to `DEPLOYED_ER_NAMES` (a tuple pinned sorted, `tests/test_allocator_history_probe.py` ~1316-1317 asserts `read == set(DEPLOYED_ER_NAMES)` and `sorted`).

**Docstring to update** (`~2690`): the bullet `a group with no working member refuses account_key_not_working` becomes "is skipped and COUNTED; the token is raised only when no group is left to crawl".

**Dataclass + plumbing to copy** (`_AccountCrawl`, `~6095-6110`; construction `~6408-6418`; audit `~7025-7037`):
```python
exchange_accounts: int
zero_contribution_accounts: int
days_incomplete: int
...
exchange_accounts=len(selected),
zero_contribution_accounts=zero_contribution,
...
"account_exchange_accounts": account.exchange_accounts,
"account_zero_contribution_accounts": account.zero_contribution_accounts,
```
Add `non_working_accounts_excluded: int` to the dataclass, pass it at construction, and add `"account_non_working_accounts_excluded"` beside `account_zero_contribution_accounts` in the completion metadata. Counts only, never an id (the comment `# ACCTREBUILD: counts and booleans only, never an id or an amount.` stands).

**Keep unchanged:** `account_key_ids=frozenset(str(key.get("id")) for key in account_keys)` (all keys, so `account_key_count` still equals census `keys_total`), the `account_identity_pending` check, and `FORCED_REBUILD_ACCOUNT_REASONS` membership of `account_key_not_working` (all-dead case).

**Gate (project memory "Agent gates include mypy"):** from `analytics-service/`: `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`. `services/` is on that line; `scripts/` is not.

---

### `analytics-service/scripts/allocator_history_probe.py` (utility, batch)

**Analog:** the `zero_contribution_members` wiring (four touch points) plus the Phase 179 additive keys (`*okx_chain_record.CHAIN_KEYS` appended last in `ACCOUNT_RECORD_KEYS`, `**okx_chain_record.CHAIN_VALIDATORS`, `**okx_chain_record.chain_defaults()`).

**Four places an additive count key must appear (miss one and `validate_record` or the parity test raises):**

1. `ACCOUNT_RECORD_KEYS` tuple (`~264`): insert `"non_working_accounts_excluded"` next to `"zero_contribution_members"` (`~272`).
2. `_ACCOUNT_VALIDATORS` (`~395`): `"non_working_accounts_excluded": _is_count,` (copy `"zero_contribution_members": _is_count,` at `~403`).
3. `_account_record` defaults (`~1493`): `"non_working_accounts_excluded": 0,` (copy `"zero_contribution_members": 0,` at `~1502`).
4. `_probe_account` record build (`~1623-1630`): pass the count (copy `zero_contribution_members=zero_contribution,`).

**Selection call to adapt** (`~1581-1586`):
```python
job_key_id = choose_job_key(account_rows)
try:
    account_keys = await er._read_account_keys(supabase, allocator_id, job_key_id)
    selected, zero_contribution = er._select_account_crawl_keys(account_keys, job_key_id)
except er.ForcedRebuildRefusedError as exc:
    # An out-of-vocabulary reason is refused by the emitter, loudly, not mapped.
    return _account_record(label, run_date, selection=exc.reason)
```
The refusal path stays; after D-05 only an all-dead account (and `account_identity_pending`, `account_key_venue_unsupported`) reaches it.

**Stale comment to rewrite** (`summarize`, `~1713-1717`): "An account refused at selection is `not-applicable` and does not shut it (the rebuild refuses that account at the same selection ...)". After D-05 the four formerly refused accounts are read; the roll-up logic is unchanged, only the comment (and the `bybit-transfers-unread:` meaning) changes.

**No change needed for D-02:** per-target ordering fields already exist (`okx_order_readings`, `okx_members_with_trades`, `okx_order_violations`, `okx_passes_ended_full`, `okx_order_failure_class`) and `okx_order_verdict` is global. Do not add a probe field for D-02. `choose_job_key` (`~1464`) already picks the working OKX key when the Bybit key is dead; leave it.

**Emitter safety to preserve:** `emit_record` -> `validate_record` -> `assert_sanitized`; `_check_keys` demands the exact whitelist, so tuple/validators/defaults must move together. Note `scripts/` is outside the CI mypy line; the test suite is the gate there.

---

### `analytics-service/tests/test_reconstruct_whole_account.py` (test, transform)

**Analog:** its own helpers, imported shapes at lines 98-122 (`_key`, `_ids`, `_refusal`) and the job-level helpers `_seed_two_account_book` (~813), `_sibling_bybit_exchange` (~822), `_assert_account_rebuild_refused` (~846), `_run_forced_two_account_job` (~901).

**Pin to INVERT** (`~231-251`, 5 params: inactive, disconnected, revoked, sign-in-failed, error). Keep the five `overrides` params; change the assertion from `_refusal(keys) == "account_key_not_working"` to the skip result:
```python
keys = [
    _key("key-1", "bybit", venue_account_id="fixture-acct-1"),
    _key("key-2", "bybit", venue_account_id="fixture-acct-2", **overrides),
]
selected, skipped, excluded = er._select_account_crawl_keys(keys, "key-1")   # shape per the chosen return
assert _ids(selected) == ["key-1"]
assert excluded == 1
```
Add a sibling all-dead test: every group dead -> `_refusal(keys) == "account_key_not_working"` (use `_refusal` as is).

**Assert the new count stays 0 in the unchanged tests** (a covered duplicate and a Deribit group are not "excluded dead groups", RESEARCH Pitfall 5): `test_select_covers_a_departed_key_through_a_working_member` (~155) and `test_select_counts_a_deribit_exchange_account_as_zero_whatever_its_state` (~180).

**Job-level pin to SPLIT** (`~1473-1502`, params `("sfox","ok","account_key_venue_unsupported")` and `("bybit","revoked","account_key_not_working")`): keep the sfox param on `_assert_account_rebuild_refused`; move the revoked param to a new test that runs the forced job and expects DONE:
```python
fake = _MarkerFake()
_seed_two_account_book(fake)
fake.store[("api_keys", (API_KEY_ID_2,))]["sync_status"] = "revoked"
exchange_1 = await _bybit_exchange()
exchange_2 = await _sibling_bybit_exchange()
result, audit, before, calls = await _run_forced_two_account_job(monkeypatch, fake, exchange_1, exchange_2)
assert result.outcome == DispatchOutcome.DONE, result
assert [c["api_key_id"] for c in calls] == [API_KEY_ID_1], "a dead sibling's session was opened"
(complete,) = _audit_metadata(audit, COMPLETE)
assert complete["account_key_count"] == 2
assert complete["account_exchange_accounts"] == 1
assert complete["account_non_working_accounts_excluded"] == 1
```
Model the in-window row assertions on `test_a_deribit_exchange_account_is_counted_as_zero` (~1505-1538): `expected = round(_usdt_equity(BYBIT_UNIFIED_WALLET_BALANCE), 2)`, every in-window row equals the working account alone, `value_usd != SENTINEL_VALUE`. Also assert the older-than-window row is untouched (`fake.store[older_key] == older_before`, pattern at ~661).

**RED-proof (project rule, "gates must be able to fail"):** copy the file to a byte backup outside the repo, restore the `raise` in place of the skip, run the new/inverted tests and see RED, restore from the byte backup (never `git checkout`/`stash`).

---

### `analytics-service/tests/test_allocator_history_probe.py` (test, batch)

**Analog (unchanged and must stay green, the all-dead case):** `test_a_selection_refusal_is_a_token_and_that_accounts_keys_are_never_decrypted` (`~1742-1763`): Bybit-only allocator, only key revoked -> `a1["selection"] == "account_key_not_working"`, `services.decrypt_calls == [_KEY_OKX]`.

**New sibling test to add (copy the structure of that test and `_two_user_book`):** one user holds an OKX key (working) and a Bybit key with `sync_status="revoked"`:
```python
book = {
    "api_keys": [
        _key_row(_KEY_BYBIT, _USER_ONE, "bybit", "2026-01-01T00:00:00Z", sync_status="revoked"),
        _key_row(_KEY_OKX, _USER_ONE, "okx", "2026-02-01T00:00:00Z"),
    ],
    "allocator_equity_snapshots": [],
}
services = _Services(book, [_StubVenue([_trade_page("ok", 5, newest_ms=_ms(_TODAY))])])
services.install(monkeypatch)
assert await hp.run() == 0
a1, _summary = _stdout_records(capsys)
assert a1["selection"] == "ok" and a1["non_working_accounts_excluded"] == 1
assert (a1["okx_members"], a1["bybit_members"], a1["window_days"]) == (1, 0, 90)
assert services.decrypt_calls == [_KEY_OKX]   # the revoked key is never decrypted
```
Fixtures: `_key_row(key_id, user_id, exchange, created_at, **overrides)` (`~68`) already gives each key its own `venue_account_id` so they form separate groups. The existing parity test `test_the_declared_vocabulary_is_the_rebuilds_own_refusal_tokens` (~1530) asserts `set(ACCOUNT_RECORD_KEYS) == set(_account_record(...))`, which will RED if the four probe touch points drift apart. The Deribit counterpart `test_a_deribit_exchange_account_counts_as_zero_...` (~1675-1707) is the template for asserting the count and the not-decrypted rule.

---

### `analytics-service/tests/test_reconstruct_force_rebuild.py` (test, no edit expected)

Pin: `test_forced_rebuild_refusal_reasons_are_a_closed_set` (`~756-846`): 6 anchor + 10 account = 16 tokens; `account_key_not_working` stays in `FORCED_REBUILD_ACCOUNT_REASONS`; raise-site scan (see the HARD CONSTRAINT above). If it goes RED after the edit, the fix is in the production code (literal raises), not the test. The same file's docstring is the lineage for the runbook's 16-token parity.

---

### `docs/runbooks/marksource-okx-history-correction.md` (config, operator runbook)

**Analog:** itself. Edits, each with the exact local pattern to copy:

1. **B'1 prediction rule** (`~338`): replace the single line `- An exchange account with no working key: \`account_key_not_working\`.` with the group rule (a group with no working member is skipped and counted; the token is predicted only when EVERY group is dead). Keep the bullet-list style of the surrounding rules (`- \`keys_on_a_venue_the_rebuild_refuses\` above 0: ...`).
2. **Token count** (`~602-613`): "15 tokens" -> 16; add `account_key_read_stalled` to the **re-enqueue ONCE** list (count 7 -> 8; the record-only list stays 8; the code comment places it with the re-enqueue-once tokens). The test below pins this.
3. **New pre-flight P7** after P6, in the same bold-label style as P0-P6 (`- **P7 - dead-key contribution census ...** ... **Abort if** ...`). Blocking, read-only, runs before any enqueue; decides per target "rebuild" or "not recomputed (D-06)".
4. **New `crosswalk` form** (probe label -> census label with fingerprint counts). Copy the form wrapper and CTE verbatim from `pollafter`:
```
<!-- form: pollafter -->
```sql
WITH m AS (
  SELECT coalesce((SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = current_database()) = __MARKER__, false)::int AS marker_is_prod
),
okx_account AS (
  SELECT k.user_id AS allocator_id,
         row_number() OVER (ORDER BY min(k.created_at), k.user_id) AS label_no
    FROM public.api_keys k
   WHERE lower(k.exchange) = 'okx'
   GROUP BY k.user_id
),
```
   Rules the test enforces on a form: no `--` comment; no write word; exactly ONE `SELECT` at line start (CTE selects stay indented) and it is `SELECT m.marker_is_prod, ...`; the `okx_account` CTE byte for byte (`includes` check, so an extra `probe_account` CTE is fine); ends in `;`; must render with `__MARKER__`/`__LABELS__` only (no unresolved `__X__`). The probe's own label rule to mirror is in `run()` (`~1766-1800`): active `okx`/`bybit` keys ordered by `created_at`, bucketed by first-seen `user_id`.
5. **`audit` form** (`~517-590`): add one column in the exact style of `account_key_count` (`~551`):
   `CASE WHEN jsonb_typeof(tm.metadata -> 'account_non_working_accounts_excluded') = 'number' THEN (tm.metadata ->> 'account_non_working_accounts_excluded')::int END AS account_non_working_accounts_excluded,`
6. **B'5** (`~592-636`): add to the rule 5 "RECOMPUTED only when ALL of these hold" list that `account_non_working_accounts_excluded` equals P7's predicted dead-group count for the label; a mismatch is a STOP-and-ask (rule 6 style).
7. **"Where this stands"** (`~27-39`): update for D-09 satisfied (ordering gate closed 2026-10-28) and D-05/D-06; keep older paragraphs as lineage per this repo's correction convention ("kept as lineage").
8. **Never** write a planning-directory path, uuid, home path or an absolute home-directory path in this file (the vitest "carries no uuid, no home path and no planning-directory path" test); name planning files in prose.

---

### `docs/runbooks/marksource-okx-census/okx-nonworking-keys.sql` (NEW, utility, batch)

**Analog:** `okx-rebuild-feasibility.sql` (CTE chain, working predicate, `snapshot_counts` with the bulk-written test, `ORDER BY label_no`). Census files carry NO `marker_is_prod` column (the operator runs `marker.sql` first; README says so) and NO comments.

**Pieces to copy verbatim:**
```sql
WITH okx_account AS (
  SELECT k.user_id AS allocator_id,
         row_number() OVER (ORDER BY min(k.created_at), k.user_id) AS label_no
    FROM public.api_keys k
   WHERE lower(k.exchange) = 'okx'
   GROUP BY k.user_id
),
keys AS (
  SELECT a.label_no, k.id, lower(k.exchange) AS exchange,
         (k.is_active
            AND k.disconnected_at IS NULL
            AND (k.sync_status IS NULL OR k.sync_status NOT IN ('revoked', 'sign_in_failed', 'error'))) AS working,
```
and, for the bulk-written test: `(count(*) OVER (PARTITION BY x.allocator_id, x.reconstructed_at) > 5) AS bulk_written` and the window predicate `s.asof >= (now() AT TIME ZONE 'UTC')::date - 89`.

**New logic (RESEARCH Finding 1c):** per a-label, per dead key not covered by a working marked sibling (mirror `account_groups`: a key whose `account_share_kind` is `duplicate`/`composite_member` and whose `account_shared_with_api_key_id` points at a working key is covered; see `account_groups` in `services/allocator_equity_derive.py` `~384`): venue, sync-status class, `is_active`/`disconnected_at` flags, first/last `allocator_holdings.asof` of the key as AGE IN DAYS (not dates), and `in_window_days_overlapping_dead_key_holdings` = non-bulk stored in-window days D with `first_asof - 1 <= D <= last_asof + 7` (7 = `CARRY_AGE_CAP_DAYS`). Carry `in_window_days_written_in_bulk` per label as well.

**Static guard it must pass (`describe.each(EXPECTED_FILES)`):** starts with `WITH`/`SELECT`; exactly one `;`, last character; no `--`; no uuid literal; none of INSERT/UPDATE/DELETE/DROP/ALTER/CREATE/TRUNCATE/GRANT/COPY/CALL as a whole word (`updated_at`/`created_at` are fine, whole-word match only). Output is counts and ages only: no `_usd`.

---

### `docs/runbooks/marksource-okx-census/README.md` (config)

**Analog:** its table at lines 12-20. Add one row for `okx-nonworking-keys.sql` in the same `| File | What it measures | Decision |` format with a backticked `.sql` name (the vitest "README backticked .sql names equal the directory listing" test regex-extracts every `` `x.sql` `` token, so any new backticked `.sql` name in the README must exist as a file and vice versa). Update the "How to run" / "What may be written down" sentences only if the new file changes them (it carries no amounts; ages are day counts).

---

### `src/__tests__/marksource-okx-census-sql.test.ts` (test, static guard)

**Analog:** itself. Edits:
```ts
const EXPECTED_FILES = [ "marker.sql", "okx-holdings-census.sql", "okx-nonworking-keys.sql", ... ] as const;   // keep the list sorted
const EXPECTED_FORMS: readonly string[] = [ "audit", "crosswalk", "enqueue", ... ];                          // add "crosswalk"
const FORMS_WITH_ACCOUNT_CTE: readonly string[] = [ "audit", "crosswalk", "enqueue", ... ];                  // crosswalk selects accounts by a-label
```
The generic `describe.each([...EXPECTED_FILES])`, `it.each(EXPECTED_FORMS...)` and renderer `renders %s with no placeholder left` blocks then cover the new file and form for free.

**New test to add (RESEARCH Wave 0, token parity, RED today):** parse the token sets from `analytics-service/services/equity_reconstruction.py` and assert each appears in the runbook text. Build on existing helpers `runbookText()` and `read()`; use the raise-site regex that the Python pin uses so TS and Python agree:
```ts
const src = readFileSync(join(process.cwd(), "analytics-service", "services", "equity_reconstruction.py"), "utf8");
const tokens = new Set([...src.matchAll(/ForcedRebuildRefusedError\(\s*"([a-z_]+)"\s*\)/g)].map((m) => m[1]));
for (const t of tokens) expect(runbookText().includes(t), `the runbook must name refusal token ${t}`).toBe(true);
```
(Also add `[...src.matchAll(/_refusal = "([a-z_]+)"/g)]` as the Python pin does. This is RED today for `account_key_read_stalled`.) Add a second small test that the runbook states the group rule and no longer contains the stale line `An exchange account with no working key: ` (use `anchorIndex`-style named failure; project rule: a miss must throw by name). Add a test that the runbook states "16 tokens" and not "15 tokens". `node_modules` is absent in this worktree: `npm ci` is needed before vitest runs (no new package).

---

### Operator plan 178-03 (read-only measurement, founder checkpoint) - analog `173-03-PLAN.md` Tasks 1-2

**Frontmatter/structure to copy:** `type: execute`, `autonomous: false`, `depends_on`, `must_haves.truths` with PROHIBITION bullet, `checkpoint:human-action gate="blocking-human"` task with `<precondition>`, `<read_first>`, `<instructions>`, `<verification>`, `<verify><automated>` grep chain over a SUMMARY ending `echo GATES_OK`, `<fails_when>`, `<acceptance_criteria>`, `<resume-signal>`; then a `checkpoint:decision` task with `<options>` (recommendation first, marked "(Recommended)"), a `<threat_model>` with a STRIDE table (T-id, category, component, severity, disposition, mitigation).

**Steps to reuse verbatim from 173-03 Task 1:**
- Step 1 preconditions (merged, CI green bound to head SHA with expected check count via `gh api "repos/AI-Isaiah/Quantalyze/actions/runs?head_sha=<sha>" -q '.workflow_runs | length'`, Railway deployed; clock outside 23:30-00:30 UTC).
- Step 2 import check, BUT update the expected line: 173-03 printed `0 16 True True True True`; add one boolean for the new record key, e.g. `"non_working_accounts_excluded" in p.ACCOUNT_RECORD_KEYS`, so the expected line becomes `0 16 True True True True True`. Do not edit the line to pass.
- Step 3-4: probe in a temporary start-command wrapper run in the background, `probe-exit: <code>`, `railway redeploy --from-source`, restore at once, `worker-restored: yes` BEFORE any gate line. Never `railway ssh`.
- Step 10: delete scratch (`$RG_SP`-style) and `test ! -e` it.

**New for 178:** run the `crosswalk` form in the same session as the probe; match probe a-labels to census a-labels by arithmetic identity AND fingerprint (`okx_members`, `bybit_members`, `window_days`, `non_working_accounts_excluded`, `zero_contribution_members` equal the crosswalk's predicted counts); run `okx-nonworking-keys.sql` (P7); per-target D-02 line from the probe record, using the grep style of 173-03 rather than `jq`: `selection` is `ok`, `okx_members_with_trades >= 1`, `okx_order_readings == okx_members_with_trades`, `okx_order_violations == 0`, `okx_passes_ended_full == 0`, `okx_order_failure_class == none`. Verify-chain style to copy from 173-03: per-label cross-checks of SUMMARY lines against the pasted JSON records (`grep -aF '"record":"summary"'`, `grep -aF "{\"account\":\"$lbl\","`), uuid gate (`grep -acE '[0-9a-f]{8}-[0-9a-f]{4}-'` = 0), ten-plus-digit gate outside the commit line, always `grep -a`.
- The founder checkpoint (D-01 measure-first, D-06 per-target rebuild vs not recomputed, zero-trades target flagged per CONTEXT discretion) copies Task 2's AskUserQuestion shape.

---

### Operator plan 178-04 (gates + rebuild + records) - analogs `173-03-PLAN.md` Task 3 and MARKSOURCE plan 14 Tasks 1 and 3

**Source of the procedure:** `docs/runbooks/marksource-okx-history-correction.md` P0-P7, B'1-B'6 (rendered with its own `form.mjs`; `QZ_MAIN`/`q()` helper pattern at runbook lines 67-71). Reuse MARKSOURCE plan 14's shape: Task 1 pre-flight with a `preflight.log` and a grep-chain verify ending `echo OK`; a decision task; Task 3 rebuild + after-census + record with `record.log`, `test ! -e <scratch>` and a uuid gate.

**Gates to encode (CONTEXT/RESEARCH Finding 4, each as a recorded answer):** marker names PRODUCTION (P0); SC-1 cite by run from `173-03-SUMMARY.md` (`okx-order: ok`, `okx-order-reading: readings=1 members_with_trades=1 violations=0 passes_ended_full=0 failure_class=none`, `sc1-met: yes`); D-02 per-target reading from 178-03; D-03 (Phase 179's close fix on the deployed worker SHA via `git grep -n -F 'close_agrees' <sha> -- analytics-service/services/okx_opening_balance.py` printing a hit, plus 179-05's recorded tolerance decision); D-04 (not within the 00:00-02:15Z hold; read the live `cron.job` slots rather than trusting 02:15Z; first night after plan 08's cut-over read); P7 zero for every target or a founder ruling; one forced job per target through the `enqueue` form behind the `DO $guard$`; re-read the latest `enqueue_compute_job` definition first; B'3c new-job proof; B'5 classification with the new excluded-count check; B'6 rows changed before the seam = 0 or STOP; SC-3 counts of rows kept and named.

**Records to copy from 173-03 Task 3 step 3 (a-e):** dated `**Measured <date> (Phase 178 OKXREWRITE, counts only).**` paragraphs under `167.2.1.1.1.1-OKX-DOUBLE-COUNT-BEYOND-REBUILD-WINDOW` and a narrowing note under TODOS ACCTREBUILD (D-05), `Edit` only with scoped replacements, `git diff "$(git merge-base HEAD origin/main)" -- TODOS.md` checked for added-line uuids. SUMMARY and TODOS edits reach main in the orchestrator's records PR, never on the ship branch.

**Constraints inherited by both operator plans (from the 173-03 and plan 14 context blocks):** live PROD/Railway steps are orchestrator-only; no executor runs `supabase` with `--linked`; no hand SQL INSERT into `compute_jobs`; amounts and row sets stay in scratch and are deleted; tracked text is counts, tokens, a-labels, 3-significant-figure ratios; no CI skip trailer; no AI-attribution lines; explicit `git add <path>`; never `git checkout`/`restore`/`stash` on uncommitted work.

---

## Shared Patterns

### Counted-and-skipped group (single source of truth)
**Source:** `analytics-service/services/equity_reconstruction.py`, `_select_account_crawl_keys` (Deribit branch).
**Apply to:** the production edit, the audit metadata, the probe record, the runbook B'5 check, and every test that unpacks the selection.
The rule is: a group is counted (never silently dropped) and the count travels as an additive integer through three surfaces: the function return, the completion audit (`account_*` keys, counts only), and the probe record (whitelisted key + validator + default).

### Closed vocabulary moves together
**Source:** `FORCED_REBUILD_REFUSAL_REASONS` (16 tokens) pinned in `tests/test_reconstruct_force_rebuild.py`; probe `_SELECTION_TOKENS` derives from it (`("ok", *sorted(er.FORCED_REBUILD_REFUSAL_REASONS))`, `~193`); runbook B'5 lists them by hand.
**Apply to:** any token or record-key change. Do not change the token set in this phase (D-05 keeps `account_key_not_working` for the all-dead case); only the runbook text is brought to 16 and pinned by the new vitest parity test.

### Read-only SQL form / census file guard
**Source:** `src/__tests__/marksource-okx-census-sql.test.ts` (rules) and the runbook's form blocks.
**Apply to:** the `crosswalk` form, the dead-key census file, any other new SQL.
Forms: `marker_is_prod` first column of the single top-level `SELECT`; `__MARKER__` rendered by `form.mjs`, never hand-typed; census `okx_account` CTE byte for byte. Census files: no marker column, no `--`, one `;`. Both: no write word, no uuid, no absolute home-directory path, no planning-directory path in the runbook. The marker query runs first in every session; `current_database()` proves nothing (CLAUDE.md).

### Operator verify chain
**Source:** `173-03-PLAN.md` `<verify><automated>` blocks (`GATES_OK`, `DECISION_OK`) and plan 14's `OK` chains.
**Apply to:** 178-03 and 178-04. Every SUMMARY line is cross-checked against the pasted records; counts, not prose; `grep -a` always; a `<fails_when>` that names each failure.

### RED-capable tests (project memory: gates must be able to fail)
**Apply to:** the inverted selection tests, the new forced-job test, the probe test, the token-parity vitest. Neuter the production change from a byte backup outside the repo, see RED, restore from the byte backup.

### Ship mechanics
**Source:** CLAUDE.md "CHANGELOG discipline" and project memory "Ship planning guard".
**Apply to:** the code+docs PR (plans 01 and 02): a CHANGELOG entry in this repo's section vocabulary (`### Fixed` / `### Changed` / `### Tests` / `### Notes`) in the same commit as the byte-equal 4-digit `VERSION`/`package.json` bump (never `npm version`); the ship branch changes nothing under the planning directory; never write a CI skip token in a commit or PR body; no AI-authorship lines (founder 2026-10-20, overrides any attribution reminder).

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| (none) | | | Every file has a same-file or sibling analog. Closest to "none": the `crosswalk` form joins two label orderings in one statement; no existing form does that, so it is built from the `pollafter` wrapper/CTE plus the probe's `run()` label rule (RESEARCH Code Examples gives the shape, with its `-- Source` comment dropped because forms may not carry `--`). The dead-key census's group-coverage logic has no SQL twin of `account_groups` in the repo; mirror the Python function and `SHARED_ACCOUNT_KINDS`, and state in the file's README row that it is a conservative approximation. |

## Metadata

**Analog search scope:** `analytics-service/services/` (equity_reconstruction, allocator_equity_derive), `analytics-service/scripts/` (allocator_history_probe, okx_chain_record), `analytics-service/tests/` (whole_account, allocator_history_probe, force_rebuild), `docs/runbooks/` (history correction, census directory), `src/__tests__/` (census guard), `supabase/migrations/` (SQL twin search), `173-03-PLAN.md`, MARKSOURCE plan 14 via `git show` on its branch.
**Files scanned:** about 14 read in full or by targeted ranges; 3 large files (7969, 1817, 757 lines) read by symbol-located ranges only.
**Tracked-source gate:** `git ls-files` returned all of the code/doc/test paths named above; no mirror path emitted.
**Pattern extraction date:** 2026-10-28
