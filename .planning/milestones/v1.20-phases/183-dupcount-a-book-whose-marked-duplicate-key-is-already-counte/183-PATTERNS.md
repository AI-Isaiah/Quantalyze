# Phase 183: DUPCOUNT - Pattern Map

**Mapped:** 2026-11-01 (worktree `quantalyze-183`, base `8c8edc452`)
**Files analyzed:** 14 modified, 0 created (one additive JSON section, one new test arm in existing files)
**Analogs found:** 14 / 14 (this is a removal-and-flip phase: the analog for each file is the file itself, plus the sibling test idiom the new tests copy)

Every path below was checked against `git ls-files` (tracked source; no `.gsd/capabilities` mirror is involved). Line numbers are for navigation at base `8c8edc452` and will drift; each excerpt is also cited by symbol.

## File Classification

| Modified file | Role | Data flow | Closest analog | Match |
|---|---|---|---|---|
| `analytics-service/services/job_worker.py` (`derive_allocator_equity`: `duplicate_keys`, `if duplicate_keys or collisions`) | service (writer / identity gate) | batch / transform, refusal persisted | itself: the `collisions`-only branch it keeps | exact |
| `analytics-service/services/allocator_equity_derive.py` (`DeriveRefusal.ACCOUNT_DUPLICATE`) | model (closed vocabulary) | transform | sibling `DeriveRefusal` members | exact |
| `src/lib/queries.ts` (`countsAsDuplicate`, `equityHistoryReadiness`, `untrustworthyRebuildReason`, comments) | service (SSR reader) | request-response | itself: `equityHistoryReadiness` minus the key-list block | exact |
| `analytics-service/tests/fixtures/shared_account_resolution.json` | test fixture (truth table) | transform | the `inactive`/`revoked` duplicate cells in the same table | exact |
| `analytics-service/tests/fixtures/derive_refusal_rows.json` | test fixture (truth table) | transform | the `account_identity_collision` row; add `legacy_refusals` | exact |
| `analytics-service/tests/test_holder_matrix_parity.py` | test | request-response (fake Supabase) | itself (`compose` branch) | exact |
| `analytics-service/tests/test_derive_refusal_rows.py` | test | transform | itself (`test_the_fixture_has_one_refusal_row_per_derive_refusal_member`) | exact |
| `analytics-service/tests/test_derive_allocator_equity_job.py` | test | request-response (fake Supabase) | `test_duplicate_of_a_failing_holder_is_counted_once_through_the_healthy_key` + `_shared_pair` | exact |
| `src/lib/__tests__/holder-matrix-parity.test.ts` | test | transform | itself | exact |
| `src/lib/__tests__/derive-refusal-rows.test.ts` | test | transform | itself | exact |
| `src/lib/queries.test.ts` | test | transform | itself (`equityHistoryReadiness` describe) | exact |
| `src/lib/queries.my-allocation.test.ts` | test | request-response | the preceding "ready" test in the same describe | exact |
| `src/lib/queries.benchmark-feed.test.ts` | test | request-response | itself (switch the rebuilding trigger) | exact |
| `scripts/accounttruth-census.mjs` + `src/__tests__/accounttruth-census.test.ts` | tooling (SQL twin of the reader) + real-PG test | batch (read-only SQL) | itself; `(e)` arm idiom `stateFor` / `SEED_A` | exact |
| `CHANGELOG.md`, `VERSION`, `package.json` | config / docs | n/a | latest `chore(release)` commit `53f25ac3e` | role-match |

## Pattern Assignments

### `analytics-service/services/job_worker.py` (service, batch, refusal row)

**Analog:** itself. The kept branch is the collision refusal; the removed branch is `duplicate_keys`. Symbols are in `derive_allocator_equity`; the block begins with the comment `# Identity gate. A 'duplicate' is a duplicate while its holder is WORKING` (about line 14887 at base).

**Group loop that already counts once (do not touch)** (`for group in account_groups(key_rows):` through `counted_ids = eligible_ids - excluded_shared`, about lines 14775-14822):
```python
    for group in account_groups(key_rows):
        members = [row for row in group if row["id"] in eligible_ids]
        if len(members) < 2:
            continue
        group_ids = {str(row["id"]) for row in group}
        working = [row for row in members if working_holder_predicate(row)]
        if not working:
            no_working_groups += 1
        pool = working or members
        ...
        kept = min(pool, key=lambda row: (first_return_day.get(row["id"], "9999-12-31"), _is_marked_in_group(row), str(row["id"])))
        excluded_shared.update(row["id"] for row in members if row is not kept)
        ...
        duplicate_counted_once = duplicate_counted_once or "duplicate" in kinds
    counted_ids = eligible_ids - excluded_shared
    counted_rows = [row for row in key_rows if row["id"] in counted_ids]
```

**To DELETE (comment + list comprehension)**:
```python
    duplicate_keys = [
        row
        for row in key_rows
        if row["id"] in eligible_ids
        and row.get("account_share_kind") == "duplicate"
        and row.get("account_shared_with_api_key_id") != row["id"]
        and working_holder_predicate(
            rows_by_id.get(row.get("account_shared_with_api_key_id"))
        )
    ]
```
Rewrite the leading comment to say the group loop above counts a marked pair once and a real double count is two COUNTED keys on one account, seen by `account_identity_collisions` below. Keep the B4 comment and `identity_tokens = account_identity_tokens(key_rows)` + `collisions = account_identity_collisions([...])` unchanged.

**Branch to collapse** (`if duplicate_keys or collisions:` through the `logger.warning(...)`):
```python
    if collisions:
        reason = DeriveRefusal.ACCOUNT_IDENTITY_COLLISION.value
        await _persist_refusal(reason)
        # Reason token + counts only. No key id, no venue id, no USD (T-167.1.2-22).
        ...
        with sentry_sdk.new_scope() as scope:
            scope.set_tag("compute_job_id", str(job.get("id")))
            scope.set_tag("derive_refusal", reason)
            sentry_sdk.capture_message(
                f"derive_allocator_equity: {reason} — the equity curve was "
                "refused and recorded; the book shows the rebuilding panel",
                level="warning",
            )
        logger.warning(
            "derive_allocator_equity: %s for allocator %s "
            "(counted_keys=%d colliding_groups=%d) — "
            "recorded the refusal in the equity_curve row; the book shows the "
            "rebuilding panel until the keys are resolved",
            reason, allocator_id, len(counted_rows), len(collisions),
        )
        return DispatchResult(outcome=DispatchOutcome.DONE)
```
Pitfall 4: drop `duplicate_keys=%d` from the format string AND `len(duplicate_keys)` from the args in the same edit (a leftover is a NameError at the first collision). Check after the edit that `rows_by_id` and `working_holder_predicate` are still used elsewhere (the group loop uses `working_holder_predicate`; grep `rows_by_id`) so no unused local remains.

**mypy gate (verbatim, from `analytics-service/`):** `.venv/bin/mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`

### `analytics-service/services/allocator_equity_derive.py` (model, closed vocabulary)

**Analog:** the sibling members of `class DeriveRefusal(str, Enum)` (about line 214). Research recommends RETIRE `ACCOUNT_DUPLICATE` (the planner chooses; this is a Claude's Discretion item and the evidence is Research Q1).
```python
    # The allocator's daily returns exceed the read's hard cap; nothing was composed.
    RETURNS_READ_CAP = "returns_read_cap"
    # A marked duplicate behind a working holder: the account would be summed twice.
    ACCOUNT_DUPLICATE = "account_duplicate"          # <- retire (comment is false after Phase 183)
    # Two live keys read one exchange account with no marker between them.
    ACCOUNT_IDENTITY_COLLISION = "account_identity_collision"
```
Only one use exists (`job_worker.py` `duplicate_keys` branch). Alternative with less churn: keep the member and mark it "legacy, unreachable"; then every fixture pin stays. Whichever is chosen, the choice and its evidence go in the plan.

### `src/lib/queries.ts` (service, SSR reader, request-response)

**Analog:** itself. Symbols (by grep at base): import at line 16, `untrustworthyRebuildReason` (~4533), `countsAsDuplicate` (~4605), `identityStillPending` (~4632), `failingToSync`, `notSyncingIdentityPendingKeyIds`, `equityHistoryReadiness` (~4686).

**Import to trim** (line 16; `isWorkingHolder` is used only by `countsAsDuplicate`; leaving it breaks `npm run lint`, Pitfall 1):
```ts
import { isWorkingHolder, NOT_WORKING_SYNC_STATUSES } from "@/lib/account-share-note";
// becomes
import { NOT_WORKING_SYNC_STATUSES } from "@/lib/account-share-note";
```

**Delete** function `countsAsDuplicate` and its doc comment, and the early return in `equityHistoryReadiness`:
```ts
  if (apiKeys.some((key) => countsAsDuplicate(key, byId))) {
    return { state: "rebuilding", reason: "duplicate_account" };
  }
```
**Result shape to copy** (from Research Code Examples; the order becomes pending, then series):
```ts
  const byId = new Map<string, EquityHistoryKey>();
  for (const key of apiKeys) byId.set(key.id, key);
  const pending = apiKeys.filter((key) => identityStillPending(key, byId));
  if (pending.some(failingToSync)) return { state: "rebuilding", reason: "key_not_syncing" };
  if (pending.length > 0) return { state: "rebuilding", reason: "account_identity_pending" };
  if (!series) return { state: "rebuilding", reason: missingSeriesReason };
  return { state: "ready", reason: null };
```
**KEEP unchanged** (stale `account_duplicate` row, and the live collision token):
```ts
  if (tokens.includes("account_duplicate") || tokens.includes("account_identity_collision")) {
    return "duplicate_account";
  }
```
Rewrite its doc to say `account_duplicate` is a pre-Phase-183 row until the next derive replaces it. `identityStillPending` logic is unchanged (the `duplicate` + holder-with-known-id exemption stays).

**Prose to rewrite** (stale after the change): doc of `equityHistoryReadiness` ("no eligible key is a duplicate of a working holder" and the "Review C2 fix coupling" warning); the `identityStillPending` comment line "Whether the pair then blocks ready is `countsAsDuplicate`'s question"; the `notSyncingIdentityPendingKeyIds` doc ("... and no duplicate blocks first"); the comment in `derivePhase07Fields` ("no working-holder duplicate"). Grep `-a "countsAsDuplicate" src scripts analytics-service` after the edit; every remaining hit is prose to rewrite.

### `analytics-service/tests/fixtures/shared_account_resolution.json` (truth table)

**Analog:** the already-composing neighbours in the same `cells` array, e.g. `duplicate / holder working / marked inactive`. Copy exactly this value shape onto the three refusing cells (`marked` = `working`, `error`, `sign_in_failed`; `holder` = `working`):
```json
{"kind": "duplicate", "holder": "working", "marked": "working",
 "derive": {"outcome": "compose", "counted": ["H", "O"], "trustworthy": true},
 "reader": {"state": "ready", "reason": null}}
```
Also reword the top-level `notes` string (it says "a duplicate behind a WORKING holder is refused ... account_duplicate"). The Python `compose` branch asserts `n_keys == len(counted)` and terminal equity = sum of anchors of `counted`; the kept key is the holder when first-return days tie (`_is_marked_in_group` sorts marked after unmarked), hence `["H","O"]`. Research ran this: 73 passed with the gate gone.

### `analytics-service/tests/fixtures/derive_refusal_rows.json` (truth table)

**Analog:** the `account_identity_collision` row. If `ACCOUNT_DUPLICATE` is retired:
- remove the `refusals` row with `"token": "account_duplicate"` (7 members remain);
- in `precedence`, the four rows that name `account_duplicate` (with `shared_account_no_working_key`, `shared_account_history_truncated`, `shared_account_flows_disagree`, `account_identity_pending`) are checked as producible tokens by `test_every_precedence_row_names_an_existing_line_over_known_tokens`; rewrite them with `account_identity_collision`, same `reader_reason` (Pitfall 2);
- add the additive section (Research):
```json
"legacy_refusals": [ { "token": "account_duplicate", "reader_reason": "duplicate_account" } ]
```
Also update the long `notes` string (names the 8-row, one-per-member contract and the writer/reader/census trio).

### `analytics-service/tests/test_holder_matrix_parity.py` (test)

**Analog:** itself. The `refuse` branch asserts `["account_duplicate"]`:
```python
    if expected["outcome"] == "refuse":
        assert _curve_upserts(fake) == [], "the table says the curve is refused"
        refusals = _refusal_upserts(fake)
        assert [r["payload"]["refusal"] for _, r, _ in refusals] == ["account_duplicate"]
        assert _curve_deletes(fake, alloc) == []
        return
```
No table cell refuses after the flip: delete the branch (and the `_curve_deletes` / `_refusal_upserts` imports if nothing else uses them), unless a collision cell is added (then assert `["account_identity_collision"]`). The module docstring ("shows a book ready behind a duplicate whose holder is not working") needs a Phase 183 sentence. `test_the_table_covers_every_cell_once` is unchanged (cell count does not move).

### `analytics-service/tests/test_derive_refusal_rows.py` (test)

**Analog:** itself. Keep `test_the_fixture_has_one_refusal_row_per_derive_refusal_member`. Add (copy the style of the neighbours):
```python
def test_no_legacy_refusal_is_a_derive_refusal_member() -> None:
    from services.allocator_equity_derive import DeriveRefusal
    live = {m.value for m in DeriveRefusal}
    for row in TABLE["legacy_refusals"]:
        assert row["token"] not in live, row["token"]
        assert row["reader_reason"] in EXISTING_READER_LINES, row["token"]
```
(Only if the member is retired.)

### `analytics-service/tests/test_derive_allocator_equity_job.py` (test, fake Supabase)

**Helpers to reuse (do not re-implement):** `_gate_key`, `_stale_curve`, `_series_rows`, `_run_gate`, `_curve_upserts`, `_refusal_upserts`, `_assert_refusal_recorded`, `_shared_pair`, `_composed_payload`, `HOLDER_ANCHOR`, `MARKED_ANCHOR`.

**Primary analog for the flipped tests:** `test_duplicate_of_a_failing_holder_is_counted_once_through_the_healthy_key` (~line 2203):
```python
    fake = _shared_pair(alloc, "duplicate", holder={"sync_status": status})
    assert (await _run_gate(fake, alloc)).outcome.name == "DONE"
    payload = _composed_payload(fake)
    assert payload["inputs"]["n_keys"] == 1, "one account must be ONE counted key"
    terminal = payload["curve"][-1]["equity_usd"]
    assert terminal == pytest.approx(MARKED_ANCHOR, rel=1e-6)
    assert "duplicate_shared_account_counted_once" in payload["flags"]
```
Apply to:
- `test_duplicate_with_working_holder_records_refusal` -> rewrite to assert a composed curve, the flag, `is_trustworthy` true, `_refusal_upserts(fake) == []`, no `account_duplicate` in `caplog.text`, and keep the id-leak assertions (`"key-D" not in caplog.text`, `"venue-dup" not in caplog.text`). Rename (it no longer "records refusal").
- `test_duplicate_whose_marked_key_fails_behind_a_working_holder_still_refuses` (`_shared_pair(alloc, "duplicate", holder={}, marked={"sync_status": "error"})`) -> assert composed once through the holder (terminal equals `HOLDER_ANCHOR`), `_refusal_upserts == []`.
- delete the `duplicate` `pytest.param` from `test_identity_refusal_is_a_warning_not_info` and `test_identity_refusal_reaches_sentry_as_an_event`, delete `_refusal_case_duplicate` and its entry in the parametrize list of `test_every_refusal_path_persists_a_reason_row` (~line 1997). The `collision` params stay.

**New PROD-shaped test (RED first)** - copy `_shared_pair` plus `_gate_key(..., exchange="deribit", venue_account_id=None, account_share_kind="duplicate", account_shared_with_api_key_id="key-H")` and an `mt5` pair; one composed curve, `n_keys` counts each pair once, flag present, no refusal upsert. `_series_rows` hardcodes `"venue": "binance"` in `key_inputs`; if the venue matters for Deribit/MT5 specifics, override the `ki` payload `venue`.

**New marker-pair collision unit (pure, no fake)** - copy the shape of `test_account_identity_collisions_intervals` (~line 1522), but build rows from `account_identity_tokens` (import from `services.job_worker`, which delegates to `services.allocator_equity_derive`):
```python
from services.job_worker import account_identity_collisions, account_identity_tokens
keys = [
    _gate_key("key-H", "a", venue_account_id="venue-shared"),
    _gate_key("key-M", "a", account_share_kind="duplicate", account_shared_with_api_key_id="key-H"),
]
tokens = account_identity_tokens(keys)
groups = account_identity_collisions([
    {"id": k["id"], "exchange": "account", "venue_account_id": tokens.get(k["id"]),
     "first_counted_day": "2026-06-01", "last_counted_day": None} for k in keys])
assert len(groups) == 1 and groups[0].n_keys == 2
assert "venue-shared" not in repr(groups[0])   # counts only
```
This proves the retained gate covers what the removed gate guarded.

**Existing collision tests that must stay GREEN:** `test_duplicate_with_revoked_holder_is_a_collision`, `test_duplicate_with_disconnected_holder_is_a_collision`, `test_duplicate_with_revoked_holder_counts_when_alone`, `test_identity_collision_persists_its_refusal_reason`, and the `collision` params.

**Header comment** above `_gate_key` ("MUTATION-FALSIFIABLE: drop the duplicate branch ...") names the removed branch; rewrite it to name the collision branch.

### `src/lib/__tests__/holder-matrix-parity.test.ts` (test)

**Analog:** itself. Three consumers of `outcome === "refuse"`: `readerInputs` (keep; `refuse` branch becomes unreachable but harmless, or drop it and the `"refuse"` union member), the test "the reader says duplicate_account exactly where the derive refuses" (with no refusing cell this still holds; reword to "never from the key list"), and the "ready never sits over a shared account counted twice" test (unchanged). The per-cell `it.each` already compares `equityHistoryReadiness(...)` to `cell.reader`, so the fixture flip alone makes 3 cells RED against the current `countsAsDuplicate`.

### `src/lib/__tests__/derive-refusal-rows.test.ts` (test)

**Analog:** itself. `it.each(TABLE.refusals...)` loops over live tokens; add a sibling loop for `legacy_refusals` (type `Table` gets `legacy_refusals: { token: string; reader_reason: string }[]`), reusing the existing `untrusted([token])` + `readRow` helpers:
```ts
it.each(TABLE.legacy_refusals.map((r) => [r.token, r] as const))(
  "%s (a pre-Phase-183 row) -> its fixture reader_reason",
  (_t, row) => {
    expect(readRow(untrusted([row.token])).equityHistoryRebuildReason).toBe(row.reader_reason);
  },
);
```
Note `TABLE.refusals[0].payload` is used as the base for `untrusted()`; keep `returns_read_cap` first.

### `src/lib/queries.test.ts` (test)

**Analog:** itself; helpers `key()`, `holderKey()`, `series`, `call(...)` inside the `equityHistoryReadiness` describe (~line 1895). Flips:
- "a duplicate of a working holder is not ready, even with a v2 series" (~1905) -> `{ state: "ready", reason: null }`, retitle.
- IN-04 case whose last `toMatchObject` is `equityHistoryRebuildReason: "duplicate_account"` (~2087) -> `key_not_syncing` with `equityHistoryNotSyncingKeyIds: ["k-bad"]`.
- "duplicate wins over a missing account id" (~2112) -> `ready` (the marked key is identity-known through its holder's id).
**Must stay GREEN as stored-token guards:** the `untrusted(["account_duplicate"])` and `untrusted(["account_identity_collision"])` assertions (~1727-1728) and precedence assertions (~1746, 1770, 1780).

### `src/lib/queries.my-allocation.test.ts` (test)

**Analog:** the immediately preceding test in the same describe ("plan 11: ... ready", ~line 2825), whose assertions to copy:
```ts
    expect(result.equityHistoryState).toBe("ready");
    expect(result.equityHistoryRebuildReason).toBeNull();
    expect(result.equityDailyReturns).toHaveLength(3);
```
Flip "plan 11: the same row with a second key marked a duplicate of a working holder is rebuilding, reason duplicate_account" (~2837) to `ready`, 3 return points, retitle.

### `src/lib/queries.benchmark-feed.test.ts` (test)

**Analog:** itself (~line 255, "rebuilding book: btcBenchmarkPrices is null ..."). The working-holder duplicate no longer forces rebuilding, so change the trigger while keeping the assertions on `btcBenchmarkPrices` null and `state.benchCalls` empty. Copy the push-onto-`api_keys` idiom already used:
```ts
(state.tables.api_keys as Row[]).push({
  ...(state.tables.api_keys as Row[])[0],
  id: "k-unknown", label: "Binance unstamped",
  venue_account_id: null,   // account_identity_pending on okx/bybit/binance/deribit
});
```
and keep `expect(result.equityHistoryState).toBe("rebuilding")`. Adjust the comment above it.

### `scripts/accounttruth-census.mjs` + `src/__tests__/accounttruth-census.test.ts` (tooling + real-PG test)

**Analog:** itself. SQL twin of the reader; mirror inventory item 5.

`scripts/accounttruth-census.mjs` (cite by symbol):
- `SQL_B`: delete the `blocking AS (...)` CTE and the two UNION rows `'duplicate.blocking'`, `'duplicate.blocking_owners'`; keep `duplicate.marked`, `duplicate.marked_live`, composite rows. Update the comment above it ("`duplicate.blocking` mirrors queries.ts countsAsDuplicate").
- `SQL_E`: delete the `dup AS (...)` CTE and the arm `WHEN dp.user_id IS NOT NULL THEN 'rebuilding:duplicate_account'` in `state` (and its `LEFT JOIN dup dp`; grep `dp\.` to find the join). KEEP the `untrustworthy_reason` CASE arm for `account_duplicate` / `account_identity_collision`:
```sql
           WHEN cv.p -> 'degrade_reasons' @> '["account_duplicate"]'::jsonb
             OR cv.p -> 'degrade_reasons' @> '["account_identity_collision"]'::jsonb THEN 'duplicate_account'
```
- section `b` entry in `SECTIONS`: drop `"duplicate.blocking"`, `"duplicate.blocking_owners"` from `required` and set `gate` to an empty/absent gate (check how `gate: []` or an omitted `gate` is treated by the runner and by the "every gate bucket is required" test); fix the header (line ~13) and the (e) header comment that lists `duplicate_account  countsAsDuplicate`.
- `docs/runbooks/derivecron-go-live.md` renders census `e` through `__CENSUS_E__` and still names `rebuilding:duplicate_account`, which stays a valid state; re-read it, expect no edit.

`src/__tests__/accounttruth-census.test.ts` (Pitfall 3, find by grep `blocking`): drop `duplicate.blocking` from the CLI fixture run assertion (~392) and `greenFixture` `b` (~451), the "every gate bucket is required" `b: ["duplicate.blocking"]` entry (~527) and the comment at ~515, the real-PG `(b)` expectation (~896-910: remove the two `blocking` keys and rewrite the test title "only the marker with a working holder blocks"), and `expect(table.refusals.length).toBeGreaterThanOrEqual(8)` (~1010; 7 members remain if the row is retired). In the `(e)` refusals loop, also feed `legacy_refusals` as extra `cases` (same `{name, payload, reason}` shape):
```ts
...(table.legacy_refusals ?? []).map((r) => ({
  name: `legacy:${r.token}`, payload: withTokens([r.token]), reason: r.reader_reason })),
```
**New real-PG arm** (idiom: `stateFor` in test `(e)`, ~line 1020; seed with `SEED_A` + `insertKeys`): seed the owner whose M1 is a duplicate of a live holder S plus a v2 trustworthy curve row, run `counts(sqlE)`, and assert `ready` is counted, not `rebuilding:duplicate_account`. Copy the calibration style from `(e)`: a `good` payload `{version: 2, is_trustworthy: true, curve: [...], returns: [...]}` expected to read `ready`, so a "rebuilding" is the CASE speaking.

### `CHANGELOG.md`, `VERSION`, `package.json` (ship records)

**Analog:** the most recent release commit `53f25ac3e chore(release): v0.133.1.1` and the entry style of the newest `CHANGELOG.md` section (`## [X.Y.Z.B] - YYYY-MM-DD`, sections `### Fixed`, `### Root cause`, `### Tests`). `VERSION` and `package.json` must stay byte-equal 4-digit strings; never `npm version`. No PROD ids, key ids or `_usd` amounts in prose (gitleaks). A ship branch changes nothing under `.planning`.

## Shared Patterns

### Fixtures are the contract between runtimes
**Source:** `shared_account_resolution.json` (read in place by `test_holder_matrix_parity.py` and `holder-matrix-parity.test.ts`) and `derive_refusal_rows.json` (read by `test_derive_refusal_rows.py`, `derive-refusal-rows.test.ts`, `accounttruth-census.test.ts`).
**Apply to:** every file above. Edit each JSON once; both consumers read it in place.

### Counts-only logging and Sentry (T-167.1.2-22)
**Source:** `job_worker.py` collision branch (excerpt above) and tests that assert `"key-D" not in caplog.text` / `"venue-dup" not in caplog.text`.
**Apply to:** the surviving collision refusal and any new test: synthetic ids only (`key-H`, `key-M`, `venue-shared`), no PROD ids.

### Test-first RED, neuter, restore from a byte backup
**Source:** CLAUDE.md protocol and Research Q3. The RED set is: fixture flip (3 Python cells, 3 TS cells), the PROD-shaped derive test, the census `(e)` arm. After the fix, neuter one seam at a time from a byte backup (re-add the `duplicate_keys` gate; re-add `countsAsDuplicate`), see the named tests fail, restore from the backup. Never `git checkout/restore/stash` on uncommitted work.

### Gates (all verified to run in this worktree)
- Python, from `analytics-service/`: `.venv/bin/python -m pytest tests/test_derive_allocator_equity_job.py tests/test_holder_matrix_parity.py tests/test_derive_refusal_rows.py -q -p no:cacheprovider`
- mypy strict (verbatim above).
- vitest, repo root: `npx vitest run src/lib/queries.test.ts src/lib/queries.my-allocation.test.ts src/lib/queries.benchmark-feed.test.ts src/lib/__tests__/holder-matrix-parity.test.ts src/lib/__tests__/derive-refusal-rows.test.ts src/__tests__/accounttruth-census.test.ts`
- `npm run typecheck`, `npm run lint` (catches the unused `isWorkingHolder` import and planning-hygiene rules).
- `grep -a` always; grep every census a changed fixture/arm can move.

## No Analog Found

None. Two items have no pre-existing instance and copy the nearest idiom:

| Item | Role | Data flow | Reason / idiom to copy |
|---|---|---|---|
| `legacy_refusals` fixture section and its three consumers | fixture + tests | transform | New concept; copy the `blocking` list shape (`token`, `reader_reason`) and the `it.each(TABLE.blocking...)` loop |
| Marker-pair collision unit test | test | transform | Copy `test_account_identity_collisions_intervals` style, feeding `account_identity_tokens` output |

## Out of scope for the ship branch (records PR to main afterwards)

Per Research Q4: the Phase 183 ROADMAP sentence ("`TODOS.md` records these refusals ...") is wrong; the line lives in `.planning/ROADMAP.md` under `### Phase 166.5.1: SENTRYTRIAGE` ("Out of scope, owned elsewhere: ... the `account_duplicate` refusals (QUANTALYZE-23 and 2H, expected since 167.1.2.1.1 WRITERRESIDUALS)"). Correct the 183 text, append a dated "SUPERSEDED by Phase 183" note beside the 166.5.1 bullet (do not delete it), and update STATE/ROADMAP progress. All `.planning`, so a records PR, not the ship branch. `TODOS.md` needs no edit. The Exchanges-page note (`accountShareNote` in `src/lib/account-share-note.ts`) is left untouched by default (open question 1 is a founder call).

## Metadata

**Analog search scope:** `analytics-service/services/`, `analytics-service/tests/` and `tests/fixtures/`, `src/lib/`, `src/lib/__tests__/`, `src/__tests__/`, `scripts/accounttruth-census.mjs`
**Files scanned:** about 14 read in part (large files by grep then ranged reads: `job_worker.py` >16k lines, `queries.ts`, `test_derive_allocator_equity_job.py`)
**Pattern extraction date:** 2026-11-01
