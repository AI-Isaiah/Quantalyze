# Phase 233: DERIBITTRUTH - Pattern Map

**Mapped:** 2026-11-24
**Files analyzed:** 11 table rows (5 new, 5 modified, 1 optional runbook); plus 4 non-code ship files named under Shared Patterns
**Analogs found:** 11 / 11 (8 exact: freshness arm, freshness fixtures, run.mjs, wiring test, workflow, deribit_txn.py, test_deribit_txn.py, test_deribit_book_oracle.py; 3 role-match: oracle script, oracle fixtures, optional runbook; the oracle script is a composite with no whole-file stdlib-only analog, see "No Analog Found")

All paths are repo-relative and git-tracked (verified with `git ls-files` for the analog files named below). No gitignored mirror path is named. Line numbers are as read at this worktree's HEAD; the planner should cite by symbol where the file moves often (`run.mjs` is 5900 lines).

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `scripts/prod-prober/arms/freshness.mjs` (new) | prober arm (SQL read + pure judge) | request-response (psql read, judge, page) | `scripts/prod-prober/arms/cron-obs.mjs` (structure, REMEDIES, parse, ARM) + `arms/cron-drift.mjs` (out-of-band count idiom, measure-fail, no-return ordering) | exact (role), data shape differs |
| `scripts/prod-prober/fixtures/freshness/{ok,stale,partial-cover,bound-plus-one,no-scope}.json` (new) | test fixture | transform | `scripts/prod-prober/fixtures/cron-obs/ok.json`, `ledger-fanout-stuck.json` | exact |
| `scripts/prod-prober/run.mjs` (mod) | registry + self-test harness | request-response | itself, the cron-obs and cron-drift sites | exact (edit in place) |
| `src/__tests__/prod-prober-wiring.test.ts` (mod, plus one new `describe`) | test (wiring pin) | transform | itself, `describe("[164.6-R2 WR-02] cron-obs ledger fan-out constants ...")` | exact |
| `.github/workflows/prod-prober.yml` (mod, prose only) | config | event-driven (cron) | itself | exact |
| `analytics-service/services/deribit_txn.py` (mod: `correction_is_trading`, `assert_correction_classifiable` message) | utility (pure classifier) | transform | itself (`correction_is_trading` at :924, `_reason_matches_any`/`_reason_contains_any`) | exact (edit in place) |
| `analytics-service/tests/test_deribit_txn.py` (mod, new shape tests) | test | transform | `test_correction_capital_reason_fails_loud`, `test_correction_reason_gate_denylist_precedence_and_word_boundary` | exact |
| `analytics-service/scripts/deribit_book_oracle.py` (new) | read-only oracle script | batch (offline JSON in, redacted reading out) | `analytics-service/scripts/mt5_soak.py` (independent walk, vacuity floor, closed counts) + `scripts/derivegaps_probe.py` (redaction, `main(argv)`, `sig3`) + `scripts/accounttruth-census.mjs` (`--print-sql`) | role-match (composite) |
| `analytics-service/tests/test_deribit_book_oracle.py` (new) | test (AST independence scan, vacuity, RED fixtures) | transform | `analytics-service/tests/test_mt5_soak.py` (AST scan at :1173-1270, vacuity at :771) | exact |
| `analytics-service/tests/fixtures/deribit_book_oracle/*.json` (new) | test fixture | transform | `analytics-service/tests/fixtures/native_to_usd_oracle.json` (naming, JSON convention) | role-match |
| `docs/runbooks/` note for the arm (optional, planner's call) | docs | n/a | `docs/runbooks/prod-prober-cadence-go-live.md` | role-match |

---

## Pattern Assignments

### `scripts/prod-prober/arms/freshness.mjs` (prober arm, request-response)

**Primary analog:** `scripts/prod-prober/arms/cron-obs.mjs` (629 lines). **Secondary:** `scripts/prod-prober/arms/cron-drift.mjs` (`run`, `parseCronJobRows`).

**File shape to copy** (cron-obs, in file order): block header comment stating what the arm is for and what it does NOT watch (lines 1-128) -> named constants (131-138) -> exported `*_SQL` template constants (145, 161, 212) -> `REMEDIES` object (243-258) -> pure parse functions (272, 333) -> pure judge (360) -> `judge*` helpers that call `seams.sql` and `addDefect` (495, 570) -> `run(ctx)` (618) -> `ARM` (624-629).

**Constants + SQL export pattern** (cron-obs.mjs:131-145, 212):
```js
const SCAN_WINDOW_SECONDS = 3 * 60 * 60;
export const TTL_SQL = `SELECT current_setting('pg_net.ttl', true) AS ttl`;
export const LEDGER_FANOUT_MIN_RUNS = 2;
export const LEDGER_FANOUT_SQL = `WITH j AS (
  SELECT jobid FROM cron.job WHERE jobname = '${LEDGER_FANOUT_JOB}'
), recent AS ( ...
```
Apply: `export const FRESHNESS_BOUND_DAYS = 2;` (one named constant, CONTEXT "Decided autonomously"), and two exported constants named `FRESHNESS_SCOPE_SQL` and `FRESHNESS_KEYS_SQL`. The names must end in `_SQL`: the read-only scenario in `run.mjs` ranges over `Object.entries(module).filter(([k, v]) => k.endsWith("_SQL"))`, requires at least two per module, `SELECT|WITH` first, no `;`, no whole-word `INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE|GRANT|REVOKE|COPY` (comments and string literals included), no `headers` (run.mjs:1890-1918). The draft SQL in RESEARCH.md (two statements) already satisfies this; `created_at` is fine.

**Credentials and ARM export** (cron-obs.mjs:624-629, copy verbatim, change name):
```js
export const ARM = {
  name: "cron-obs",
  requiredEnv: ["PROBER_POOLER_URL", "SUPABASE_DB_PASSWORD"],
  run,
  REMEDIES,
};
```
Apply: `name: "freshness"`, same `requiredEnv`, so no new credential. Nothing in the file may read `process.env` (cron-obs header line 68: env arrives injected).

**REMEDIES pattern** (cron-obs.mjs:243-249): one string per kind, each at least 40 characters and unique, each naming a query a human runs by hand; none may contain an id. Kinds must be prefixed `freshness-` so `entryKinds()` (run.mjs:1212) finds them with no `kinds` override: `freshness-stale`, `freshness-no-scope`.

**Seam call and measure-fail pattern** (cron-obs.mjs:495-516, 598-609): a failed psql is `measureFail`, never an empty answer.
```js
const lf = await seams.sql("cron-obs", LEDGER_FANOUT_SQL);
if (lf.measureFail) {
  addDefect("measure-fail", "cron-obs", LEDGER_FANOUT_JOB,
    `the ledger fan-out read could not be performed at all: ${lf.measureFail}. An empty answer from ` +
      `a failed psql is NOT zero failed runs.`);
  return;
}
const c = parseLedgerFanoutRow(lf.stdout);
if (c === null) { addDefect("measure-fail", ... "did not return exactly five integers ..."); return; }
```
Apply to both freshness statements. The scope read parses to exactly three non-negative integers (same shape as `parseLedgerFanoutRow`, cron-obs.mjs:333-340: `f.length !== N || !f.every((x) => /^\d+$/.test(x))` returns null, caller reports measure-fail).

**Tab-separated row parser** (cron-obs.mjs:272-291): `line.split("\t")`, NULL arrives as the empty string, skip rows with too few fields. Copy for the per-key rows, but report a short row as a `measure-fail` (cron-drift pattern below), do not silently `continue`.

**Out-of-band completeness idiom** (cron-drift.mjs:2703-2711; the guard at 1998+ compares the database's own count to parsed rows):
```js
if (countMismatch !== null) {
  addDefect("measure-fail", "cron-drift", "cron.job",
    `${countMismatch} The rows this arm did judge are reported above; the ones it never saw are the point.`,
    "Read cron.job by hand (...) ...");
}
```
Apply: the scope read's `derived` count versus the number of per-key rows returned; disagreement is a `measure-fail`, not a clean read (RESEARCH "the other questions"). Also the scope guard: `derived == 0` is defect `freshness-no-scope`; `derived > 0` and `with_terminal == 0` is a `measure-fail` (Pitfall 1, field rename must not read GREEN).

**Pure judge pattern** (cron-obs.mjs:360-484): the judge takes parsed rows plus injected values and returns `Array<{kind, subject, detail}>`; `run` then loops `addDefect(d.kind, "cron-obs", d.subject, d.detail, REMEDIES[d.kind])` (cron-obs.mjs:613-615). Use the same split so fixtures drive the shipping rule. Use `judgeFreshness` from RESEARCH.md (lines 326-346) as the skeleton; keep: strict `YYYY-MM-DD` round-trip validation in Node (never cast jsonb to `date` in SQL), per-day coverage by `tiny_days`, reason (2) accepted whole, no-returns or no-inputs keys logged and not paged.

**Public-output rule:** `addDefect` detail is copied verbatim into a public GitHub issue (run.mjs:549-558 scrubs only `requiredEnv` values). Subject is `<venue>#<tag>` (tag = first 8 hex of md5, RESEARCH A7); detail carries days and counts only.

**Call ordering:** the arm runs both statements unconditionally where independent; follow `run` in cron-obs.mjs:618-622 (a failed first read must not hide the second) only if the two reads are independent. Here the scope read gates interpretation of the keys read, so an early `return` after a scope `measure-fail` is correct (cron-drift.mjs:2640-2670 "nothing has been read yet" returns).

---

### `scripts/prod-prober/fixtures/freshness/*.json` (fixtures, transform)

**Analog:** `scripts/prod-prober/fixtures/cron-obs/ok.json`, `ledger-fanout-stuck.json`.

**Shape to copy** (ok.json): a leading `_comment` string stating GREEN or RED, what the fixture proves, and "Every value here is synthetic"; then the data the `fixtureSql` branch renders.
```json
{
  "_comment": "GREEN control. now = 12:00:00Z; three hourly runs inside the 3h window ... Every value here is synthetic.",
  "now": "2026-09-05T12:00:00Z",
  "ttl": "6 hours",
  "jobCount": 1,
  "rows": [ [ ... ] ]
}
```
Rules: one cause per RED fixture so a neuter reddens exactly one scenario (cron-drift table comment at run.mjs:1145-1161); the green fixture holds every accepted shape side by side (healthy gap 1, gap equal to bound, fully stated tiny-base gap, `anchor_null_reason` key, no-returns key); fixture names: `ok.json`, `stale.json`, `partial-cover.json`, `bound-plus-one.json`, `no-scope.json`. Use `tag` not `key_tag`, low-entropy values (RESEARCH Anti-Patterns: gitleaks `generic-api-key` keys on the word `key` beside a value; the allowlist covers only `pyapi06-...`, `SENTINEL-KEY-...`, `FAKE-key-`).

---

### `scripts/prod-prober/run.mjs` (registry and self-test, edit in place)

Edit sites (all verified by reading; counts are regenerated by running the self-test, not restated):

1. **Import** (run.mjs:111-112) - add beside the cron arms:
```js
import * as CRON_OBS_MOD from "./arms/cron-obs.mjs";
import * as CRON_DRIFT_MOD from "./arms/cron-drift.mjs";
import * as FRESHNESS_MOD from "./arms/freshness.mjs";
```
2. **`SQL_ARM_MODULES`** (run.mjs:124-127): add `{ name: "freshness", module: FRESHNESS_MOD }`.
3. **`ARMS_FLOOR`** (run.mjs:148, comment 136-147): `4` -> `5`, rewrite the "FOUR" comments. **`SELF_TEST_SCENARIOS`** (run.mjs:151): new total, derived by running `node scripts/prod-prober/run.mjs --self-test`.
4. **`DEFECT_KINDS`** (run.mjs:181-215): add `freshness-stale`, `freshness-no-scope` (a group comment in the same voice as `// cron-obs + cron-drift (plan 03)`). `addDefect` throws on an unregistered kind (run.mjs:549-552).
5. **`ARMS`** (run.mjs:221): append `FRESHNESS_MOD.ARM`; fix the "FOUR" docblock at :218.
6. **`fixtureSql`** (run.mjs:945-1042): add one branch per statement, answering GREEN by default so every existing full-registry scenario stays green. Dispatch is first-substring-wins in this order: `pg_net.ttl`, `shobj_description`, `net._http_response`, (`job_run_details` and `ledger_refresh_fanout`), `public.cron_runs`, `cron.job`, else self-test measureFail. The default-GREEN idiom to copy (run.mjs:981-989):
```js
if (q.includes("job_run_details") && q.includes("ledger_refresh_fanout")) {
  const lf = data.ledgerFanout === undefined ? {} : data.ledgerFanout;
  if (typeof lf === "string") return sqlOk(lf);
  if (lf.measureFail) {
    return { status: null, stdout: "", stderr: "", timedOut: false, measureFail: lf.measureFail };
  }
  const v = { runs: 3, errored: 0, named: 0, stuck: 0, failureRows: 0, ...lf };
  return sqlOk(`${[v.runs, v.errored, v.named, v.stuck, v.failureRows].join(fieldSep)}\n`);
}
```
   The freshness SQL must not contain an earlier branch's substring (note `public.cron_runs`, `cron.job` and `net._http_response`), and each statement needs its own distinguishing token. Place the freshness branches BEFORE the `cron.job` generic branch.
7. **`ARM_FIXTURE_TABLE`** (run.mjs:1075-1209): new entry in the cron-drift voice (run.mjs:1133-1168):
```js
{
  arm: FRESHNESS_MOD.ARM,
  fixtureDir: "freshness",
  green: "ok.json",
  greenSeamCalls: 2, // FRESHNESS_SCOPE_SQL + FRESHNESS_KEYS_SQL
  makeSeams: (data) => createSeams({ sqlRunner: fixtureSql({ freshness: data }) }),
  red: {
    "stale.json": "freshness-stale",
    "partial-cover.json": "freshness-stale",
    "bound-plus-one.json": "freshness-stale",
    "no-scope.json": "freshness-no-scope",
  },
},
```
   (No `kinds` override needed: names are prefixed `freshness-`. No `clock` needed unless the judge reads `seams.now()`; the rule compares stored days and never the wall clock.)
8. **`allGreenSeams()`** (run.mjs:1226-1248): load `loadFixture("freshness", "ok.json")` with the same `if (!x.ok) return x;` guard and pass it in `sqlData` (`{ cronObs: ..., ttl: ..., cronJobRows: ..., freshness: freshness.data }`).
9. **`KIND_ASSERTIONS`** (run.mjs:1270-1296): one independently spelled literal per kind, mandatory (the loop fails without it, run.mjs:1402-1407):
```js
"freshness-stale": (d) => d.kind === "freshness-stale",
"freshness-no-scope": (d) => d.kind === "freshness-no-scope",
```
10. **FULL GREEN and CROSS-ARM scenarios** (run.mjs:4943-4990, ~5037): `slots === 10 && names.length === 8` (freshness adds 2 slots and no new name), `armsExecuted === 4` (twice), `arms: 4/4/0` (twice), titles saying FOUR. **Contact-write scenarios** (~5285): `r.armsBlocked === 4`. Read these off the failing self-test; do not hand-count.
11. **Dedicated (non-table) scenarios** to add, in the style of the cron-drift/ledger fan-out dedicated scenarios: unparsable per-key row is a `measure-fail` naming the arm; scope count vs returned rows disagree is a `measure-fail`; derived keys present with none carrying `realized_terminal_day` is a `measure-fail`; a reason on key X does not cover key Y.
12. Header comment (run.mjs:16, 22): "Registered arms (FOUR, equal to ARMS_FLOOR)" -> five, add `freshness`.

---

### `src/__tests__/prod-prober-wiring.test.ts` (wiring pins, edit plus one new describe)

**Edit in place:**
- `EXPECTED_DEFECT_KINDS` (lines 849-875): hand-typed, sorted. Insert `"freshness-no-scope"` and `"freshness-stale"` between `"floor"` and `"manifest-invalid"`. The next test (`[...DEFECT_KINDS].sort()` toEqual) fails otherwise.
- Floor test (lines 1143-1154), rewrite:
```ts
it("the arm floor is FOUR and the registry meets it", () => {
    expect(ARMS_FLOOR).toBe(4);
    expect(ARMS.length).toBe(4);
    expect(ARMS.map((a: { name: string }) => a.name).sort()).toEqual([
      "cron-drift", "cron-obs", "mt5", "pyapi06",
    ]);
```
  becomes `5`, `5`, and the sorted list `["cron-drift","cron-obs","freshness","mt5","pyapi06"]`; retitle.
- `SELF_TEST_SCENARIOS` test (lines 1909-1926): the literal `expect(SELF_TEST_SCENARIOS).toBe(91)` becomes the new count; the rest is derived by executing the self-test. Add a history comment line in the existing "83 -> 84 ..." style.

**New `describe`** (bind arm constants to their writers so a rename cannot turn the arm silently GREEN). Copy the structure of `describe("[164.6-R2 WR-02] ...")` (lines 3186-3235): module-level `readFileSync` of the source, `it` blocks that assert the source text contains the literal, plus a CALIBRATION `it` proving a drifted spelling is caught:
```ts
describe("[164.6-R2 WR-02] cron-obs ledger fan-out constants match the manifest and the SQL", () => {
  const snapshot = (fn: string) => readFileSync(join(FUNCTIONS_DIR, `${fn}.sql`), "utf8");
  ...
  it("LEDGER_FANOUT_SQL quotes every constant, and never names metadata or a status column", () => {
    for (const lit of [...]) expect(LEDGER_FANOUT_SQL).toContain(`'${lit}'`);
    expect(LEDGER_FANOUT_SQL).not.toMatch(/\bmetadata\b/);
  });
  it("CALIBRATION: a renamed function or a drifted failure literal is caught", () => { ... });
```
Sources to bind (from RESEARCH, re-verify lines before writing): `supabase/schema/baseline.sql` `compute_jobs_kind_check` lists `derive_broker_dailies`; `analytics-service/services/job_worker.py` still writes `tiny_base_days`, `nav_mark` with `mark_day`, `anchor_null_reason`, `flows`, `venue`; `analytics-service/services/allocator_equity_derive.py` still writes `realized_terminal_day`. Also bind the flow day field: the per-key SQL reads `f->>'utc_day_iso'` out of `flows`, so `job_worker.py` must still write `"utc_day_iso"` on each flow row (a rename would quietly drop the flow day from the comparison). The arm's SQL must contain each of those names as a quoted literal.

**Not to touch (checked):** `kindsMentioned` pins on the incident step and `incident.mjs` (never quote a kind there); `CI_TEXT` must not contain `prod-prober`.

---

### `.github/workflows/prod-prober.yml` (prose only)

Text sites: line 1 `name: prod-prober (four arms, hourly)`; header block lines 4-14 (add a `freshness` entry in the same column layout as `pyapi06`/`cron-obs`/`cron-drift`/`mt5`); line 20 "A four-arm production prober"; `workflow_dispatch` descriptions lines 88 and 95 (arm list `pyapi06 | cron-obs | cron-drift | mt5`); comment near line 111 "the four live arms are four HTTP calls, two short SQL reads"; step name line 252 `Probe production (all four arms, aggregate, exit at the end)`.
Constraints (from RESEARCH Pitfall 9, wiring test lines ~212-222, 3123, 3161): keep the `- name: Probe production` prefix; keep both `|| status=$?` anchors; add none of the softening tokens (`continue-on-error`, `|| true`, `exit 0`, `::warning`, `set +e`, `|| :`, `2>/dev/null`, `set +o pipefail`, `|| exit 0`) even in comments.

---

### `analytics-service/services/deribit_txn.py` (DBOOK-02, edit in place)

**Analog:** the function itself. Current body (lines 924-940) to narrow:
```python
def correction_is_trading(row: Mapping[str, Any]) -> bool:
    reason = _correction_reason_raw(row).lower()
    if _reason_contains_any(reason, _CORRECTION_CAPITAL_REASON_KEYWORDS):
        return False  # capital denylist (substring) beats ANY trading token (WR-01/BL-01)
    return _reason_matches_any(reason, _CORRECTION_TRADING_REASON_KEYWORDS)
```
**Helpers to reuse, unchanged:** `_correction_reason_raw(row)` (:889, returns "" for a non-string reason; do NOT `str()`-coerce), `_reason_contains_any` (substring, capital side, :916), `_reason_matches_any` (word boundary, trading side, :905). The module already imports `re` and `Mapping`/`Any`.

**Change (RESEARCH "Minimal change", verified against the above):** keep the denylist first; require trading word AND an instrument named by an anchored upper-case token in the RAW reason or by a structured `instrument_name`:
```python
_INSTRUMENT_TOKEN_RE: re.Pattern[str] = re.compile(
    r"(?<![A-Z0-9_-])[A-Z]{2,6}(?:_[A-Z]{3,5})?-"
    r"(?:PERPETUAL|\d{1,2}(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\d{2}(?:-\d+(?:\.\d+)?-[CP])?)"
    r"(?![A-Z0-9_-])"
)
def _names_instrument(row, reason_raw): ...   # instrument_name fullmatch OR token search on RAW reason
```
Do not use `classify_instrument` as the structural test (:160-195 is deliberately lenient: any name ending `-C`, `-P` or `-PERPETUAL` passes, so `SUB-C` would classify). Also update the `assert_correction_classifiable` message (:943-957) so it says an instrument must be named, and keep `{list(_CORRECTION_TRADING_REASON_KEYWORDS)}` in it. The new gate is strictly narrower, so no existing negative can flip. Call sites that read it and need no edit: `_row_is_cash_bearing` (:1085), `_row_is_native_cash_bearing` (:1098), USD aggregator gate (:1653), native twin (:2709), balance-identity reference set (~:1967), and `services/deribit_ingest.py` (imports `_row_is_cash_bearing`).
**Gate:** `mypy --strict` covers `services/` (CI command in RESEARCH "Pre-push gates", item 4); annotate the new pattern and helper fully.

---

### `analytics-service/tests/test_deribit_txn.py` (DBOOK-02 tests, add next to the existing ones)

**Analogs and location:** add after `test_correction_reason_gate_denylist_precedence_and_word_boundary` (:762-790). Do not edit old tests.

**Row builder to reuse** (:572-593, `_correction_row`):
```python
def _correction_row(reason: str = "2026-07-15 BTC-PERPETUAL funding calculation correction",
    *, rid: int = ..., change: float = _KEY3_CORRECTION_CHANGE_BTC, with_info: bool = True) -> dict[str, object]:
    row = {"type": "correction", "currency": "BTC", "change": change, "instrument_name": None,
           "timestamp": _ms(_DAY_A), "id": rid}
    if with_info: row["info"] = {"reason": reason}
    return row
```
Note `_correction_row` hardcodes `instrument_name: None`; shape 2 (structured `instrument_name` set) needs the row dict mutated after construction (`row["instrument_name"] = "ETH-28MAR25-3000-C"`) or a new keyword argument added to the builder (adding a keyword with a default keeps old calls unchanged).

**Parametrized negative pattern** (:671-704, `test_correction_capital_reason_fails_loud`): `@pytest.mark.parametrize("capital_reason", [...])`, then assert BOTH aggregators raise and the raise names the reason:
```python
row = _correction_row(capital_reason)
with pytest.raises(LedgerValuationError) as exc_usd:
    txn_rows_to_daily_records([row])
assert capital_reason in str(exc_usd.value)
with pytest.raises(LedgerValuationError) as exc_native:
    txn_rows_to_native_daily([row])
assert capital_reason in str(exc_native.value)
```
Apply to the new shapes: headline `"funding account correction"` (trading token, no capital word, no instrument), `BTC-PERP funding correction`, `BTC-PERPETUALS funding correction`, `SUB-C funding correction`, `BTC-PERPETUAL adjustment` (no trading word), lower-case `btc-perpetual funding correction`, blank or non-string `instrument_name` with a trading word. Positive shapes (observed reason; structured `instrument_name`; `BTC_USDC-PERPETUAL`, dated future, option token in the reason) follow the hand-derived oracle docstring style of `test_correction_funding_reason_is_cash_bearing_hand_derived_usd` (:596) and `..._native` (:624), including a `REVERT-PROOF:` sentence in each docstring (the file's house style). The "contrast" closing lines (`assert correction_is_trading(_correction_row())`, `assert not correction_is_trading(bad)`, :789-790) show how to pin the positive beside the negative.
**Each shape through `correction_is_trading` AND both aggregators.** Run: from `analytics-service/` only, `pytest tests/test_deribit_txn.py -k correction -q`. RED proof: revert `correction_is_trading` to the old body, shapes 5, 6, 7 must red.

---

### `analytics-service/scripts/deribit_book_oracle.py` (DBOOK-01, new, batch)

No single analog; three, each for one property. **Strict rule: import no production helper** (CONTEXT, PROOF-01). Stdlib only: `argparse`, `json`, `math`, `sys`, `datetime`, `re`, `collections.abc`, `typing`. Note `mt5_soak.py`, `derivegaps_probe.py`, `walletoffset_probe.py` and `navbreach_anchor_probe.py` ALL import `services.*` and `scripts.deribit_ground_truth` (the latter imports `services.deribit_txn`): copy their PATTERNS, never their imports. The only scripts with no `services` import are `record_cassettes.py`, `gen_blend07_fixture.py`, `phase12_deploy.py` (not useful analogs).

**A. Independent walk with vacuity floor and counted skips** - `analytics-service/scripts/mt5_soak.py`.
Header states why independence matters (lines 20-27): "An oracle that imports the arithmetic it judges agrees with it by construction ... so the walk re-buckets every raw deal itself and is compared with the fold day by day."
Constants are COPIES with a test-side parity pin (mt5_soak.py:274-282; test_mt5_soak.py:1283):
```python
_MIN_CHECKED_SHARE = 0.5
# SOAK-03 walk constants. Soak-owned on purpose: the walk imports nothing it judges, so these
# are COPIES of ``services.mt5_deals``' allow-lists, pinned equal by a test ...
_WALK_TRADING_TYPES: frozenset[int] = frozenset({0, 1, 7, 8, 9, 10, 11})
```
```python
assert _soak._WALK_TRADING_TYPES == mt5_deals._MT5_TRADING_DEAL_TYPES   # test_mt5_soak.py:1283
```
Apply: the oracle keeps its own literals for `TINY_BASE_FRACTION`, `TINY_BASE_WINDOW_DAYS`, `EMPTIED_FRACTION`, `EMPTIED_NEGATIVE_FRACTION`, `EMPTIED_RESTART_FLOOR_USD`, `_SELF_CHECK_ABS` (values per RESEARCH DBOOK-01), and a TEST (never the script) imports the production modules and asserts equality.
Vacuity guard (mt5_soak.py:1015-1040): `vacuous = counts["checked"] == 0`; `ok` requires `not mismatches and not vacuous and certified_share is not None and certified_share >= _MIN_CHECKED_SHARE`; counts for every excluded day class are returned, never dropped. Apply: zero explained days, or explained share of reproducible days under a declared floor, exits non-zero; every withheld day carries a member of the closed reason set.
Closed reason names (RESEARCH): `missing_return_inside_coverage`, `skipped_nonpositive_denominator`, `emptied_stretch`, plus oracle-local `no_stored_base_level`, `key_set_not_reproducible`. Annotations that never null a day: `capital_outside_base_options_cash`, `capital_outside_base_flow_day`.

**B. Redaction contract and `main(argv)` shape** - `analytics-service/scripts/derivegaps_probe.py`.
Reading emitted as labels, counts, dates and 3-significant-figure values only (header :42; `sig3` is defined in `scripts/bybit_upnl_probe.py:166-170`):
```python
def sig3(x: float) -> float | str:
    """Round to three significant figures; a non-finite value reads ``non-finite``."""
    if not math.isfinite(x):
        return "non-finite"
    return float(f"{x:.3g}")
```
Copy the function body locally (do not import `bybit_upnl_probe`). Exit-path shape (derivegaps_probe.py:1782-1796): `main(argv: Sequence[str] | None = None) -> int`, `argparse`, TYPE-only failure message on stderr (`print(f"failed: {type(exc).__name__}", file=sys.stderr)`, "a message can carry an id"), `sys.exit(main())`. Do NOT import `assert_sanitized` from `deribit_ground_truth`; write a local closed-vocabulary emitter that refuses any value outside its declared vocabulary and scans for UUID shapes and long digit runs (RESEARCH "Don't Hand-Roll").

**C. `--print-sql[=label]` read recipe** - `scripts/accounttruth-census.mjs:827-870` (`printSqlText`, `main`):
```js
const printArg = args.find((a) => a === "--print-sql" || a.startsWith("--print-sql="));
if (printArg) {
  if (args.length !== 1) { err("... --print-sql takes no other argument; it touches no database and reads no fixture."); err(USAGE); return 2; }
  const labels = printArg.includes("=") ? printArg.split("=")[1].split(",").filter(Boolean) : [];
```
Apply in Python: `--print-sql[=<label>]` prints the per-statement projections (each under a `-- label` header, `;`-terminated) for the orchestrator to run through the MCP read path, and takes no other argument; `--input <export.json>` reads the offline export and prints the reading. The script holds no connection and no DSN.

**Arithmetic to implement** (RESEARCH DBOOK-01, verified against `allocator_equity_derive.py`, `allocator_equity_compose.py`, `nav_twr.py`): roll levels back from `realized_terminal_usd` on `max(W)` with `level[t-1] = level[t] - F_t - P_t`; per-key `r = P_t / L_{t-1}`; book `r_t = sum_k P_kt / sum_k L_k,t-1` over keys defined that day; compare to stored `payload.returns` with a stated relative tolerance (about 1e-9; the repo's stamp tolerance is `RETURNS_STAMP_TOL = 1e-12`). The declared counted-key set is an INPUT and must equal `inputs.n_keys` or the whole book is `key_set_not_reproducible` (RESEARCH "Read this first" 2; Open Question O1).

---

### `analytics-service/tests/test_deribit_book_oracle.py` (new)

**Analog:** `analytics-service/tests/test_mt5_soak.py`.

**AST independence scan with a self-test proving it can fail** (test_mt5_soak.py:1173-1270). Core visitor to copy and adapt (the oracle's scan is whole-module, not only `_walk_*` functions: forbid ANY import of `services`, `routers`, `models`, `main*`, `scripts.deribit_ground_truth`):
```python
def _independence_violations(fn_node, forbidden, module_names) -> list[str]:
    found: list[str] = []
    for node in ast.walk(fn_node):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            found.append("import:" + (getattr(node, "module", None) or node.names[0].name))
            continue
        ...
```
and the self-test idiom that proves the checker bites (test_mt5_soak.py:1248-1262):
```python
fake = ast.parse("def _walk_fake(d):\n    return deal_utc_day(d, 0)\n").body[0]
assert "deal_utc_day" in _independence_violations(fake, forbidden, module_names)
local_from = ast.parse("def _walk_x(p, t):\n    from services.nav_twr import _judged_cohorts as jc\n ...").body[0]
assert "import:services.nav_twr" in _independence_violations(local_from, forbidden, module_names)
```
Include a function-local import fixture (the 226 WR-02 lesson: a function-local import binds its alias where module-level name sets never look). Guard the scan against vacuity by asserting the minimum set of oracle function names exists (test_mt5_soak.py:1234-1239).

**Vacuity test** (test_mt5_soak.py:771-790): a fixture where every day is excluded must read `vacuous is True` and exit non-zero, never green.

**Parity pin** (test_mt5_soak.py:1283 style): import production constants in the TEST only and assert the oracle's literal copies are equal.

**Docstring style:** module docstring lists numbered tests with what each is proving and "REVERT-PROOF" sentences (test_mt5_soak.py:1-58). Fixtures load from `analytics-service/tests/fixtures/deribit_book_oracle/*.json`; run only from `analytics-service/` (`pytest tests/test_deribit_book_oracle.py -q`; `pytest.ini` sets `pythonpath = .`). RED proofs must mutate the oracle's own identity (use `L_t` for `L_{t-1}`), not just its inputs (RESEARCH Pitfall 7).

---

### `analytics-service/tests/fixtures/deribit_book_oracle/*.json` (new)

**Analog:** `analytics-service/tests/fixtures/native_to_usd_oracle.json` and the other `tests/fixtures/*.json` files (flat JSON beside `.py` fixture modules). Fixtures needed (RESEARCH): an explained book, each withheld reason, a capital-outside-base annotated day whose published value is unchanged, an all-withheld (vacuity) book, a book whose declared key count differs from `inputs.n_keys`. Use letters (`k1..kN`) and synthetic numbers only.

---

## Shared Patterns

### PROOF-01: every gate seen to fail (neuter, RED, restore, GREEN)
**Source:** CONTEXT "Decided autonomously"; RESEARCH "PROOF-01 neuter for this arm".
**Apply to:** the freshness arm, the oracle, the classifier.
Procedure, recorded verbatim in each plan SUMMARY: `cp <file> <scratch>/backup`, `cmp` backup vs original; apply the neuter; run the named command and record the first RED line (`node scripts/prod-prober/run.mjs --self-test` prints `SELF-TEST FAIL:` lines; pytest prints the failing test id); restore from the byte backup (`cp`, never `git checkout`/`restore`/`stash` on uncommitted work), `cmp` again, rerun and record `SELF-TEST PASSED: N/N` or the green pytest line. Neuter list for the arm (RESEARCH): bound to a large number; per-day test replaced by "any stated day covers"; delete the `anchorNullReason` accept; drop the arm from `ARMS`; remove the scope guard.

### Read-only, no-id, no-value output
**Source:** `scripts/prod-prober/arms/cron-obs.mjs:63-69` header ("NEVER PRINTS A VALUE"), `scripts/prod-prober/run.mjs:549-558` (`addDefect` scrubs `requiredEnv` values only), `scripts/prod-prober/seams.mjs:171-200` (`realSqlRunner`: `-v ON_ERROR_STOP=1 -At -q -F <sep> -X -c <query>`, stderr redacted to one line).
**Apply to:** the freshness arm (public GitHub issue body), the oracle emitter (tracked SUMMARY). Letters for keys and books in all tracked text; no PROD id, email, home path or account number.

### Fail loud: a failed read is never an empty answer
**Source:** cron-obs.mjs:495-516 and cron-drift.mjs:2640-2709.
**Apply to:** freshness arm and the oracle (`key_set_not_reproducible`, vacuity exit).

### Census and pin edits move together
**Source:** run.mjs `ARMS_FLOOR`, `SELF_TEST_SCENARIOS`, `DEFECT_KINDS`, `KIND_ASSERTIONS`; wiring test `EXPECTED_DEFECT_KINDS`, floor test, `SELF_TEST_SCENARIOS` test (run.mjs:1075-1296; wiring test 849-875, 1143-1154, 1909-1926).
**Apply to:** one commit for the arm plus every pin (a partial landing is refused by the gates; see the run.mjs docstring at :163-169).

### Gitleaks hygiene for new identifiers
**Source:** `.gitleaks.toml:236-300`; RESEARCH Anti-Patterns.
**Apply to:** fixtures and arm. Avoid the word `key` beside a value in new identifiers; run `gitleaks detect --no-git --config .gitleaks.toml` over the new files before pushing.

### Ship hygiene (non-code, from CLAUDE.md)
CHANGELOG entry plus 4-digit VERSION and `package.json` bump in one `chore(release)` commit; delete the closed `TODOS.md` entries `[185-BOOK-CUMULATIVE-UNEXPLAINED]` and the `Deribit correction residual` bullet in the same PR and name them in the CHANGELOG; ship branch changes nothing under `.planning`; never write the skip-CI token in a commit or PR body; no AI attribution lines in commits or PR bodies (founder memory 2026-10-20, which overrides the harness attribution reminder). No migration: if one appears, stop and tell the coordinator.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `analytics-service/scripts/deribit_book_oracle.py` as a whole | oracle script | batch | No existing script is both stdlib-only (imports no `services.*`) and offline-JSON-in. Compose from the three property analogs above; the closest whole-file precedent is `mt5_soak.py`'s `_walk_*` independence discipline, whose functions are independent but whose module is not. |
| `FRESH-02` strategy-mode series | arm scope | n/a | Out of scope by recorded decision: strategy mode stores `data_quality_flags.tiny_base_days` but no flow, anchor or terminal-day counterpart (RESEARCH A2). Record in the plan SUMMARY and route (O6); do not build. |

## Metadata

**Analog search scope:** `scripts/prod-prober/` (arms, fixtures, run.mjs, seams, workflow), `scripts/accounttruth-census.mjs`, `src/__tests__/prod-prober-wiring.test.ts`, `analytics-service/scripts/`, `analytics-service/services/deribit_txn.py`, `analytics-service/tests/` (deribit, soak, probe tests, fixtures).
**Tracked-source check:** `git ls-files --error-unmatch` was run over every analog path named in this document (prober `run.mjs`, `seams.mjs`, `incident.mjs`, both arms, the two cron-obs fixtures, `mt5_soak.py`, `derivegaps_probe.py`, `bybit_upnl_probe.py`, `test_mt5_soak.py`, `test_deribit_txn.py`, `deribit_txn.py`, the wiring test, `prod-prober.yml`, `accounttruth-census.mjs`, `native_to_usd_oracle.json`, the cadence runbook); all tracked, no gitignored mirror path appears.
**Project skills:** `.claude/skills/` and `.agents/skills/` do not exist in this worktree; CLAUDE.md and AGENTS.md conventions (ship hygiene, public-repo rule, no skip-CI token, no migration) are carried under Shared Patterns.
**Files read in full or by targeted range:** CONTEXT, RESEARCH, cron-obs.mjs, cron-drift.mjs (run, parseCronJobRows), run.mjs (imports, constants, fixtureSql, ARM_FIXTURE_TABLE, allGreenSeams, KIND_ASSERTIONS, SQL scenario, FULL GREEN), wiring test (pins and the WR-02 describe), mt5_soak.py (header, constants, vacuity), test_mt5_soak.py (AST scan, vacuity), derivegaps_probe.py (main), bybit_upnl_probe.py (`sig3`), accounttruth-census.mjs (`--print-sql`), deribit_txn.py (correction gate), test_deribit_txn.py (correction tests), prod-prober.yml (header).
**Pattern extraction date:** 2026-11-24
