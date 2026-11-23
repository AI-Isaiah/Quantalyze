# Phase 155: PARITYHARNESS - Pattern Map

**Mapped:** 2026-11-13
**Files analyzed:** 27 (new) plus 1 modified (`.gitignore`)
**Analogs found:** 22 exact or role-match / 28. The other 6 have no code analog and use RESEARCH.md.

> Public repo: account labels only. No login, server name, amount, PROD id or home path appears here. Analogs are cited as `path::symbol`, never by line number. Every analog below was confirmed git-tracked with `git ls-files`.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `docs/runbooks/mt5-parity/marker.sql` | config (SQL) | request-response | `docs/runbooks/marksource-okx-census/marker.sql` | exact (byte-equal) |
| `docs/runbooks/mt5-parity/census-accounts.sql`, `census-edges.sql`, `census-inception.sql`, `census-flags.sql` | config (SQL) | batch read | `docs/runbooks/marksource-okx-census/okx-snapshot-census.sql`, `okx-nonworking-keys.sql` | role-match |
| `docs/runbooks/mt5-parity/bind.sql`, `capture-*.sql` | config (SQL) | batch read | `docs/runbooks/marksource-okx-census/okx-snapshot-rows.sql` | role-match |
| `docs/runbooks/mt5-parity/README.md` | docs | n/a | `docs/runbooks/marksource-okx-census/README.md` | exact |
| `docs/runbooks/mt5-parity/required-readings.json`, `founder-session.md` | config + docs | n/a | none | no analog |
| `src/__tests__/mt5-parity-capture-sql.test.ts` | test (static gate) | file-I/O | `src/__tests__/marksource-okx-census-sql.test.ts` | exact |
| `src/__tests__/mt5-parity-capture-sql-exec.test.ts` | test (exec on throwaway PG) | request-response | `src/__tests__/marksource-okx-nonworking-keys-exec.test.ts` | exact |
| `src/__tests__/mt5-parity-surfaces.test.ts` | test (data-layer matrix) | request-response | `src/lib/factsheet/fetch-and-build-payload.test.ts` | role-match |
| `analytics-service/services/mt5_parity.py` | service (pure engine) | transform | `analytics-service/services/parity_diff.py` | exact |
| `analytics-service/services/mt5_parity_intake.py` | service (parser/intake) | file-I/O, transform | `analytics-service/services/mt5_deals.py` (deal shape, fail-loud) | role-match |
| `analytics-service/services/mt5_parity_capture.py` | service (seal/load) | file-I/O | none in repo (RESEARCH "Canonical seal") | no analog |
| `analytics-service/scripts/mt5_parity_run.py` | utility (thin CLI) | batch | any thin script under `analytics-service/scripts/` | partial |
| `analytics-service/tests/test_mt5_parity_engine.py` | test | transform | `analytics-service/tests/test_parity_diff.py` | exact |
| `analytics-service/tests/test_mt5_parity_intake.py`, `test_mt5_report_parser.py`, `test_mt5_parity_capture.py` | test | transform | `analytics-service/tests/test_mt5_server_clock.py` | role-match |
| `analytics-service/tests/test_mt5_parity_purity.py` | test (AST) | transform | `analytics-service/tests/test_mt5_server_clock.py::test_the_clock_module_is_a_stdlib_leaf` | exact (extend to transitive) |
| `analytics-service/tests/fixtures/mt5_parity/*` | fixture | file-I/O | none | no analog |
| `.gitignore` (+ `/.mt5-parity/`) | config | n/a | existing root-anchored lines (`/.vitest-reports`, `/.next/`) | exact |
| `.planning/phases/155-.../` findings ledger, census record, verdict document | docs | n/a | none | no analog |

## Pattern Assignments

### `docs/runbooks/mt5-parity/*.sql` (config, read-only batch)

**Analog:** `docs/runbooks/marksource-okx-census/` (`marker.sql`, `okx-snapshot-census.sql`).

**Marker (copy byte-for-byte):**
```sql
SELECT shobj_description(oid, 'pg_database') AS which_database
  FROM pg_database WHERE datname = current_database();
```

**File rules the gate enforces (copy):** one statement starting `WITH|SELECT`, exactly one `;` and it is last, no `--` comment, no uuid-shaped literal, no write word. Select accounts by `row_number() OVER (ORDER BY k.created_at, k.id)` ordinals (`k1..kN`), never by id literal. Never select `venue_account_id` (the login) or `api_keys.label`.

### `src/__tests__/mt5-parity-capture-sql.test.ts` (test, static gate)

**Analog:** `src/__tests__/marksource-okx-census-sql.test.ts` (symbols: `EXPECTED_FILES`, `WRITE_WORDS`, `UUID_RE`, `sqlFiles`, `read`, the two `describe` blocks).

**Directory and README pins** (copy shape, change `DIR` and `EXPECTED_FILES`):
```typescript
const DIR = join(process.cwd(), "docs", "runbooks", "mt5-parity");
function sqlFiles(): string[] {
  return readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
}
it("README backticked .sql names equal the directory listing", () => {
  const readme = read("README.md");
  const named = new Set([...readme.matchAll(/`([A-Za-z0-9._-]+\.sql)`/g)].map((m) => m[1]));
  expect([...named].sort()).toEqual(sqlFiles());
});
```

**Per-file gate** (`describe.each([...EXPECTED_FILES])`): the four `it` blocks (one statement, no `--`, no uuid, no write word) copy as written.

**Deviation (superset, per RESEARCH):** the precedent `WRITE_WORDS` is `INSERT UPDATE DELETE DROP ALTER CREATE TRUNCATE GRANT COPY CALL`. Add `INTO MERGE DO REVOKE VACUUM REFRESH COMMENT LOCK PREPARE EXECUTE SET`, plus a function denylist (`nextval setval pg_advisory pg_notify set_config dblink lo_ pg_sleep`). Build the list from an array so the test file does not read as SQL. Keep whole-word, case-insensitive matching (`\b` keeps `created_at`/`updated_at` clean).

**Also in this file:** the `.gitignore` pin for `/.mt5-parity/`, the redaction scan (uuid-shaped, home-path prefix, long digit runs) over `docs/runbooks/mt5-parity/**`, fixtures and phase tracked artifacts, and the RED proof (neuter a copy, assert RED, restore from byte backup and compare sha256). Build the planning-directory string from parts, as the precedent does (`PLANNING_DIR = [".plan", "ning/"].join("")`), so lychee and the scan do not flag this file.

### `src/__tests__/mt5-parity-capture-sql-exec.test.ts` (test, executes SQL on a throwaway cluster)

**Analog:** `src/__tests__/marksource-okx-nonworking-keys-exec.test.ts` (symbols: `LOCAL_MARKER`, `TODAY`, `STAND_IN_DDL`, the `beforeAll`/`afterAll` cluster boot via `scripts/pg-lane/run.sh --print-pgbin`).

**Copy:** socket-only `initdb` cluster, trust auth, scratch path short (`/tmp/nwk-` style so the socket path stays under 104 bytes), `beforeAll` THROWS when no binaries (no skip), frozen `public.now()` shadow with absolute fixture dates plus a vacuity test proving the shadow is live, hand-computed oracles.

**Deviation:** replace `STAND_IN_DDL` with the ten `CREATE TABLE IF NOT EXISTS "public"."<t>" (...);` blocks extracted by regex from `supabase/schema/baseline.sql` (`strategies`, `strategy_analytics`, `strategy_analytics_series`, `api_keys`, `api_key_nav_marks`, `allocator_equity_derived`, `csv_daily_returns`, `benchmark_prices`, `allocator_holdings`, `strategy_keys`). Apply with `psql -v ON_ERROR_STOP=1`. Add the column-contract test (every column a statement names exists with the expected type).

### `src/__tests__/mt5-parity-surfaces.test.ts` (test, data-layer matrix)

**Analog:** `src/lib/factsheet/fetch-and-build-payload.test.ts` (symbols: `fake` via `vi.hoisted`, the `vi.mock("@/lib/supabase/admin", ...)` builder with `select/eq/order/limit/or`).

**Mocks to copy:**
```typescript
vi.mock("server-only", () => ({}));
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => { /* builder(table) serving canned rows */ });
```
The fake serves the sealed capture's rows so `fetchAndBuildPayloadWithReason` (`src/lib/factsheet/fetch-and-build-payload.ts`) runs end to end. Call the pure surfaces directly: `computeOgHeadline` (`src/lib/factsheet/og-metrics.ts`), `computeScenario` (`src/lib/scenario.ts`), `toStrategyRows`, `liveBaselineMetricsFromPerKeyDailies`, `liveBookFigures`, `rowRecord`/`gatedMetric`.

**Deviation:** include a CONTROL row proving the harness can build at all (the precedent's own technique). No `skipIf`: with `MT5_PARITY_CAPTURE_DIR` set and the directory missing or failing its seal, THROW. Use computed or hand-derived oracles, not a literal asserted against itself (`src/__tests__/self-referential-oracle.test.ts` AST-scans for that).

### `analytics-service/services/mt5_parity.py` (service, pure transform)

**Analog:** `analytics-service/services/parity_diff.py` (symbols: `BUCKET_LABELS`, `UNEXPLAINED`, `REANNUALIZATION_FACTOR`, `classify_delta`). Reuse its shape; import `REANNUALIZATION_FACTOR` rather than restating 365/252. Do not fork it.

**Closed taxonomy and fail-closed default (copy the idea):**
```python
UNEXPLAINED = "unexplained"
BUCKET_LABELS = frozenset({UNCHANGED, REANNUALIZATION, FLOW_MOVED, UNEXPLAINED})
# "unexplained" is never reached by silent fallthrough, only by explicit non-match.
```
**Deviations:**
- Taxonomy is the 8 buckets in CONTEXT. Use `Literal`, frozen `dataclass(slots=True)`, `Final`, `from __future__ import annotations` (mypy strict, `follow_imports = "silent"`, `services/` is inside the strict surface).
- `parity_diff.py` has no `from __future__` and uses `Optional`; do not copy that style.
- `MT5_PARITY_TOLERANCE = 0.01` is defined once. Tests import it. A test AST-scans `services/mt5_parity*.py` for a second `0.01` float literal.
- A breach is classified only by an explicit counterfactual re-run (flip BALANCE row, shift clock, swap DST rule, add open P&L), never by default branch.
- Reuse, never re-implement: `broker_dailies::mt5_day_pnl`, `reconstruct_mt5_nav_levels`, `combine_mt5_deal_ledger`, `mt5_server_clock::server_clock_for_rule`/`Mt5ServerClock`, `mt5_deals::classify_deal`/`deal_utc_day`/`deal_utc_instant_ms`, `wealth_returns::curve_to_daily_returns`, `account_unit::classify_account_currency`.
- Do NOT import `services.nav_marks` or `services.allocator_equity_derive` (their closure reaches `services.db` and `mt5_client`).

### `analytics-service/services/mt5_parity_intake.py` (service, parser and intake)

**Analog:** `analytics-service/services/mt5_deals.py` for the deal-dict shape (`type` int, `time` epoch seconds as if UTC, optional `time_msc`, `profit`, `swap`, `commission`, `fee`, `entry`, `position_id`) and its leak-safe `_coerce_money` convention (error names the column, never the value).

**Contract (no code analog, follow RESEARCH Slice B):** stdlib `html.parser` + `codecs` BOM sniff (`FF FE`, `FE FF`, `EF BB BF`, then strict utf-8, else refuse). Header allow-list with `UnknownHeader`, `MissingHeader`, `DuplicateHeader`. `PROVENANCE_VALUES = frozenset({"terminal_reading", "terminal_report_export", "broker_statement"})` and a named refusal for anything else. Worksheet is JSON (stdlib), not YAML (`pyyaml` is transitive only).

### `analytics-service/tests/test_mt5_parity_purity.py` (test, AST)

**Analog:** `analytics-service/tests/test_mt5_server_clock.py::test_the_clock_module_is_a_stdlib_leaf`.

```python
source = Path(__file__).resolve().parents[1] / "services" / "mt5_server_clock.py"
tree = ast.parse(source.read_text(encoding="utf-8"))
imported: set[str] = set()
for node in ast.walk(tree):
    if isinstance(node, ast.Import):
        imported.update(alias.name for alias in node.names)
    elif isinstance(node, ast.ImportFrom):
        assert node.level == 0, "a relative import would reach another services module"
        assert node.module is not None
        imported.add(node.module)
```
**Deviation:** the precedent checks direct imports only. Extend to the TRANSITIVE closure (use RESEARCH "Transitive purity scan"; `ast.walk` already sees function-level lazy imports). Assert the closure contains none of `mt5_client mt5_read mt5_soak mt5_probe mt5_concurrency db nav_marks allocator_equity_derive`, no `supabase postgrest httpx aiohttp ccxt mt5linux rpyc socket subprocess requests`, and (anti-vacuity) that it does include `mt5_deals`, `mt5_server_clock`, `broker_dailies`.

### `analytics-service/tests/test_mt5_parity_engine.py` and the other pytest files

**Analog:** `analytics-service/tests/test_parity_diff.py` (one test per bucket plus fail-closed and tolerance edges; imports the bucket constants from the module, never restates literals). Run pytest only from `analytics-service/`. Never `importlib.reload`.

**RED-proof tests (new technique, per CONTEXT):** byte backup + sha256, byte-level edit to a copy, vacuity assert (bytes changed in the intended field), RED with named leg and bucket, restore, sha256 equals original, GREEN. Apply the reclassify break to the parsed oracle JSON, not the HTML (parser would refuse it). The dropped-oldest-deal proof must name `inception_identity`.

### `.gitignore`

**Analog:** the root-anchored entries already present (`/.vitest-reports`, `/.next/`). Add `/.mt5-parity/` in the same style; the vitest pin reads the file and asserts the exact line.

## Shared Patterns

### Read-only PROD census, marker first
**Source:** `docs/runbooks/marksource-okx-census/marker.sql` and its `README.md`.
**Apply to:** every `.sql` file and every orchestrator checkpoint. Marker first in every session; stop on NULL or a non-PROD answer. Executors never touch PROD.

### Neuter, see RED, restore from byte backup
**Source:** the project rule (memory) and the precedent test files.
**Apply to:** the SQL write gate, the three RED proofs, the surface-matrix discrepancy proof. Never `git checkout`/`restore`/`stash` on uncommitted work.

### Fail-closed taxonomy
**Source:** `analytics-service/services/parity_diff.py::classify_delta`.
**Apply to:** `mt5_parity.py` verdicts and the MT5-15 flag classification (an unknown `data_quality_flags` key is an `unknown` finding, never a guess).

### Redaction by type
**Source:** none in repo (RESEARCH Pattern 6). The verdict object has no money field and refuses extra keys, so the rendered markdown cannot leak.
**Apply to:** the verdict renderer, findings ledger, census record.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `mt5_parity_capture.py` (seal and load) | service | file-I/O | No canonical-JSON-plus-sha256 loader exists; use RESEARCH "Canonical seal" (`json.dumps(sort_keys=True, separators=(",", ":"), allow_nan=False)` + `hashlib.sha256`) |
| `required-readings.json` + `founder-session.md` | config/docs | n/a | One shared list of readings is new; add a test pinning the script to the JSON |
| `tests/fixtures/mt5_parity/*` (UTF-8 and UTF-16LE Report, worksheet, synthetic capture) | fixture | file-I/O | No Report fixture exists; hand-compute the Balance column and assert `utf16le == b"\xff\xfe" + utf8_text.encode("utf-16-le")` |
| Findings ledger, census record, verdict document | docs | n/a | New artefacts; planning-tree files, never on the ship branch |
| `analytics-service/scripts/mt5_parity_run.py` | utility | batch | Thin wrapper only; `scripts/` is outside the mypy gate so keep logic in `services/` |

## Gotchas the planner must carry

- `grep -a` on the UTF-16 fixture (NUL bytes).
- Cite symbols, not `file:line`, in PLAN.md (`plan-anchor-verify`).
- CI mypy strict covers `services/mt5_parity*.py`; include the mypy command in every analytics-touching brief.
- Local Python, pandas and mypy versions differ from CI; the CI run is the verdict.
- `docs/runbooks/**/*.md` is lychee-checked offline: no planning paths or dead links.
- Ship branch must change nothing under `.planning/`; ship needs a CHANGELOG entry and byte-equal `VERSION`/`package.json` bump; never write the CI-skip tokens.

## Metadata

**Analog search scope:** `docs/runbooks/marksource-okx-census/`, `src/__tests__/`, `src/lib/factsheet/`, `analytics-service/services/`, `analytics-service/tests/`, `.gitignore`.
**Files scanned:** about 14 (reads plus greps).
**Pattern extraction date:** 2026-11-13
