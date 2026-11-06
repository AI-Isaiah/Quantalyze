# Phase 163: HARDEN — Fail safe, closed, and loud - Pattern Map

**Mapped:** 2026-08-26
**Files analyzed:** 6 target areas (TS lib, TS/CI gate, Python gate + test, SQL fn, SQL gate test, React client)
**Analogs found:** 6 / 6 (all exact or role-match)

⚠️ All paths below are REPO-RELATIVE by policy — `.planning/` is tracked in a public repo.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/lib/ratelimit.ts` (add `bridgeComputeLimiter`) | utility/config | request-response | the six named limiters in the same file | exact (same file) |
| `src/app/api/bridge/route.ts`, `src/app/api/scenario/optimize/route.ts` (rewire) | route | request-response | `src/app/api/bridge/route.ts:94-115` | exact |
| new username source-scan gate | config/test | batch scan | `scripts/check-route-contract.ts` + `.github/workflows/ci.yml` `frontend-policy` "MT5 EA read-only static check" | exact |
| new Python module-scope `.bind()` source-scan gate | test | batch scan | `analytics-service/tests/test_redact.py:266-300` (ast walk) | exact |
| new structlog behavioral redaction test | test | event-driven | `analytics-service/tests/test_logging_config.py:63-123` (`configure_logging()` + `capsys`) | exact |
| new migration: de-STRICT 10-param `_enqueue_compute_job_internal` | migration | CRUD | `supabase/migrations/20260716090000_...sql:139-176` (7-param, already de-STRICT-ed) | exact |
| `supabase/tests/test_*.sql` audit-coverage gate | test | CRUD | `supabase/tests/test_wizard_composite_fence.sql` | exact |
| `src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.tsx` (`doRemove` abort) | component | request-response | `handleStopWaiting` in the SAME file, `:1167-1173` | exact (same file) |

---

## Pattern Assignments

### 1. `bridgeComputeLimiter` — `src/lib/ratelimit.ts`

**Analog:** the limiter block `src/lib/ratelimit.ts:96-216`. Factory at `:83-94`.

**The convention, exactly:** a `//`-comment block IMMEDIATELY above a single
`export const <name>Limiter = makeLimiter(n, "<seconds> s");`. First comment line is always
the literal form `// <n>/<unit> per <bucket subject> — <phase / finding id> <short name>.`
Then 3-15 lines of prose that must answer: (a) what the real user cadence is, (b) why it is
NOT piggybacked on an existing bucket, (c) what abuse it caps. Windows are ALWAYS
second-scale template literals typed `` `${number} s` `` — `"3600 s"`, `"86400 s"`, never
`"1 h"`.

Representative (`src/lib/ratelimit.ts:123-126`):
```typescript
// 20/hour per authenticated user — portfolio impact simulator. Caps the
// compute-intensive weighted-covariance Python endpoint at roughly one
// exploration session per hour.
export const simulatorLimiter = makeLimiter(20, "3600 s");
```

The one that most closely matches this phase's motive — a route being MOVED OFF the shared
`userActionLimiter` because the shared bucket collides — is `csvValidateLimiter`
(`src/lib/ratelimit.ts:195-206`). Copy its rhetorical structure: name the colliding surfaces,
name the upstream Python cap it must align with, name both consuming routes.

**Route wiring (`src/app/api/bridge/route.ts:88-115`)** — note the ordering comment, it is
load-bearing:
```typescript
// B15 limiter-ordering: consume the rate-limit token only AFTER input
// validation so a malformed/invalid request rejected with 400 above does
// not burn one of the caller's own tokens.
const rl = await checkLimit(userActionLimiter, `bridge:${user.id}`);
if (!rl.success) {
  if (isRateLimitMisconfigured(rl)) {
    return NextResponse.json(
      { error: "Rate limiter unavailable", code: "SEAM_MISCONFIGURED" },
      { status: 503, headers: { ...NO_STORE_HEADERS, "Retry-After": String(rl.retryAfter) } },
    );
  }
  return NextResponse.json({ error: "...", retryAfter: rl.retryAfter, code: "RATE_LIMITED" }, ...);
}
```
Identifier strings are `` `<surface>:${user.id}` `` (`"bridge:"`, `"scenario-optimize:"` at
`src/app/api/scenario/optimize/route.ts:151`). Swapping the limiter argument is a ONE-TOKEN
change at each call site; do NOT converge these bodies onto `rateLimitDenyJson` — the docblock
at `src/lib/ratelimit.ts:279-295` enumerates the six live 429 contracts that would regress.

⛔ CONTEXT LOCK: do not resize `userActionLimiter` (`src/lib/ratelimit.ts:97`). Both consumers
(`bridge`, `scenario/optimize`) currently sit on it; the new limiter takes them over.

---

### 2. The username source-scan CI gate

Two idiomatic homes exist. **Recommendation: a `scripts/check-*.ts` registered in
`npm run lint`**, because the scan target is `.planning/**` — OUTSIDE `src/`, and the
`src/__tests__/contracts/` specs are scoped to `src/`.

**Script shape** — `scripts/check-route-contract.ts` / `scripts/check-admin-route-manifest.ts`:

- Shebang `#!/usr/bin/env -S npx tsx` then a long docblock with numbered "Rules enforced",
  an "Exit codes" section, and an "Invocation" section naming the npm script and the CI job.
- Pure `node:fs` walk, no new dependency.
- Collects `violations: string[]`, each prefixed with an UPPERCASE violation code
  (`UNCLASSIFIED:`, `EXTRA-PUBLIC:`) plus a sentence saying how to fix it.
- `main()` reporting block, verbatim shape (`scripts/check-route-contract.ts` tail):
```typescript
function main(): void {
  const violations = runCheck(REPO_ROOT);
  if (violations.length > 0) {
    console.error(`[check-route-contract] ${violations.length} violation(s):\n`);
    for (const v of violations) console.error(`  - ${v}`);
    console.error("\nManifest: src/lib/routing/route-contract-manifest.ts\nPhase: 51 NAV-03 (#512 lockstep)");
    process.exit(1);
  }
  console.log(`[check-route-contract] OK — ${pageRoutes.length} page routes, all declared in the manifest.`);
}
// Only run the CLI when invoked directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}` || import.meta.url.endsWith(process.argv[1] ?? "")) {
  main();
}
```
The success path ALWAYS prints a COUNT — that is the local anti-vacuity signal (a walk that
found 0 files must not read as "OK").

**Registration** — `package.json:11,18-19`:
```json
"lint": "eslint --cache --cache-location node_modules/.cache/.eslintcache src/ && tsx scripts/check-admin-route-manifest.ts && tsx scripts/check-route-contract.ts",
"check:admin-route-manifest": "tsx scripts/check-admin-route-manifest.ts",
"check:route-contract": "tsx scripts/check-route-contract.ts",
```
i.e. BOTH a dedicated `check:<name>` script AND an `&&`-chained entry in `lint`. `lint` runs in
the `frontend-lint` CI job, which IS in the `frontend` aggregator's `needs:`.

**Alternative shape (inline shell step)** — `.github/workflows/ci.yml:560-584`, the "MT5 EA
read-only static check" in `frontend-policy`. If the planner prefers a job step, copy that
step's three habits exactly: `|| true` on the grep (a no-match must not abort under `set -e`),
verdict derived from whether output was CAPTURED not from grep's exit code, and
`echo "::error::…"` before `exit 1`.

⚠️ CONTEXT LOCK: the gate must be no-allowlist by construction. Do NOT add a path-exclusion
array — that reproduces the gitleaks blindness the gate exists to fix. If the scanner must
skip its own definition, do it by matching a split/obfuscated literal, not by a path list.

**Repo-wide-scan-inside-vitest alternative:** `src/__tests__/contracts/ci-anti-skip-gate.contract.test.ts:1-36`
is the house exemplar for "gate the gate". Its docblock explicitly rejects grep-over-YAML
("A grep pin goes green the moment someone keeps the strings and guts the logic") and instead
EXTRACTS and EXECUTES the shell. If the username gate lands as a shell step, that file is the
template for pinning it.

---

### 3. Python: `.bind()` source-scan gate + behavioral redaction test

**Source-scan gate analog — `analytics-service/tests/test_redact.py:266-300`.** The idiom is
belt-and-braces: an anchored `re.search(..., re.M)` sanity check FIRST, then an `ast.walk`
that is the real assertion, with the docstring naming why ast is used (prose in docstrings
must not produce false hits):
```python
def test_no_external_imports():
    """redact.py must import ONLY from `__future__`, `re`, `typing`.

    Adversarial revision 2026-05-06 (W4): use ast parsing so docstring prose
    mentioning the words "import sentry_sdk" ... does NOT produce false negatives.
    """
    import ast
    text = (Path(__file__).resolve().parents[1] / "services" / "redact.py").read_text()
    assert not re.search(r"^import structlog\b", text, re.M)
    tree = ast.parse(text)
    for node in ast.walk(tree):
        ...
```
For a module-scope `.bind()` scan, walk `tree.body` (top level only) for `ast.Assign` whose
value is an `ast.Call` with `func` an `ast.Attribute` named `bind` — that is the shape that
freezes the processor chain before `configure_logging()` runs.

**The repo-wide partition idiom — `analytics-service/tests/test_limiter_route_coverage.py`.**
This is the reference for a scan that must not conceal: it derives a set from source, keeps an
explicit `NO_LIMITER_QUARANTINE: frozenset[str]` roster (`:316`), and asserts
`unlimited == NO_LIMITER_QUARANTINE` — an EQUALITY, reporting both `unexpected=` and `missing=`
(`:392-416`). It also carries `test_the_walk_is_not_vacuous` (`:362-390`) asserting
`len(routes) >= MIN_API_ROUTES`, and `test_the_partition_is_total` (`:418-446`). Copy all three
tests' shape. ⚠️ CONTEXT: the SC-4 wrapper-check test must be converted to this equality form
with the quarantine list at 0.

**Behavioral redaction test analog — `analytics-service/tests/test_logging_config.py:60-123`.**
The house idiom is a class with a `configure_logging()` setup fixture and `capsys`, parsing the
rendered JSON line:
```python
def test_redact_processor_scrubs_event_dict(self, capsys):
    ...
    captured = capsys.readouterr().out.strip().splitlines()
    record = json.loads(captured[-1])
    assert record["api_key"] == "[REDACTED]"
    assert record["safe_field"] == "kept"
```
⛔ Do NOT use `structlog.testing.capture_logs` for this test. It is used widely
(`analytics-service/tests/test_mt5_client_contract.py:51`, `test_mt5_validate.py:59`) but it
REPLACES the processor chain, so `_redact_processor` never runs and the assertion cannot fail —
the exact vacuity this phase forbids. The `capsys` + `json.loads` form goes through the real
pipeline configured at `analytics-service/services/logging_config.py:216-246`.

**Where the redaction lives:** `_redact_processor` at `analytics-service/services/logging_config.py:48-86`,
inserted in the chain at `:229` immediately BEFORE `JSONRenderer`. Its docstring states the
fail-open invariant ("NEVER raises") — mirror that style. Note
`analytics-service/tests/test_logging_config.py:94-123` already demonstrates the negative
control (a monkeypatched-broken scrubber leaves `api_key` unredacted) — the house way of
proving the assertion is load-bearing.

**Where the new files go:** `analytics-service/tests/test_*.py`, discovered by
`analytics-service/pytest.ini`. ⚠️ pytest must be run FROM `analytics-service/`.

---

### 4. SQL: remove `INTO STRICT` from the 10-param overload

**Analog: the 7-param overload in `supabase/migrations/20260716090000_retire_compute_analytics_kind_rpc_guard.sql:139-176`** — already de-STRICT-ed. Copy this verbatim in structure:

```sql
  -- Lost the race. Re-read the winner's row. Plain SELECT INTO (NOT
  -- STRICT) because between the conflict and the re-read the winner
  -- may have advanced past the in-flight statuses (done / failed_*).
  -- That's a legitimate race outcome — the original SELECT INTO STRICT
  -- raised NO_DATA_FOUND with no domain-specific message and surfaced
  -- as an opaque 500 to the user-facing request. (P3)
  IF p_strategy_id IS NOT NULL THEN
    SELECT id INTO v_new_id
      FROM compute_jobs
      WHERE strategy_id = p_strategy_id
        AND kind = p_kind
        AND status IN ('pending', 'running', 'done_pending_children')
      LIMIT 1;
  ELSE
    ...
  END IF;

  IF v_new_id IS NULL THEN
    -- Winner already advanced past in-flight. Tell the caller this
    -- was a race loss with a recoverable error code so the app layer
    -- can retry the enqueue without surfacing a 500. ERRCODE
    -- 'serialization_failure' is the canonical Postgres class for
    -- "MVCC race, retry safe".
    RAISE EXCEPTION '_enqueue_compute_job_internal: enqueue race lost and winner already terminal (target strategy=%, portfolio=%, kind=%)',
      p_strategy_id, p_portfolio_id, p_kind
      USING ERRCODE = 'serialization_failure';
  END IF;

  RETURN v_new_id;
```

**The sites to change:** SAME file, `:284-311` — the 10-param overload's four lost-race
branches (`p_strategy_id` / `p_portfolio_id` / `p_allocator_id` / else `p_api_key_id`), each
currently `SELECT id INTO STRICT v_new_id`. It has FOUR arms, not two, so the `RAISE EXCEPTION`
message must name all four targets. The overload signature is at `:293-306` of the same
migration; header comment there reads "verbatim from 20260420073003:330 with ONLY the
retired-kind guard inserted" — preserve that provenance-comment habit in the new migration
header (state what is byte-unchanged and what is not).

**Migration file conventions observable in that file:** `CREATE OR REPLACE FUNCTION`
re-basing on the LATEST definition (never the original), a `-- ---…---` banner comment above
each function, and a self-verifying `DO $$ … RAISE EXCEPTION … $$` block at the END of the
migration that fails the DEPLOY if either overload's body lost a required property
(`:318-345`, "mirrors 20260710130000:110-168"). Add an arm to that DO block asserting the
10-param body no longer contains `INTO STRICT` — that is this repo's in-migration gate idiom
and it costs nothing.

⚠️ Re-base rule: `grep -rn "_enqueue_compute_job_internal" supabase/migrations/` before writing;
the current heads are 20260716090000 (both overloads).

---

### 5. SQL gate test: audit coverage for `add_wizard_composite_key`

**Measured fact for the planner:** the current head definition is
`supabase/migrations/20260814120000_wizard_rpcs_revoke_authenticated.sql:321-…` and it emits NO
`log_audit_event` — grep for `log_audit_event` in that file returns only prose comments
(`:48`, `:180`, `:184`, `:346`). The CONTEXT requires the pragma-vs-real-emission decision to
be RECORDED in the requirement.

**Analog: `supabase/tests/test_wizard_composite_fence.sql`** — same RPC, so the fixture
scaffolding is directly reusable. House structure, from its header (`:1-58`):

- Long `--` header naming the migration under test, the phase/requirement id, then a
  `-- This file asserts:` list with `Part 1 / Part 2 / …` each summarised in one sentence.
- `pgTAP is NOT installed` — plain PL/pgSQL `DO $$ … $$` blocks, `RAISE EXCEPTION` on failure,
  `RAISE NOTICE` on pass.
- ⛔ No psql backslash meta-commands — the `sql-tests` preflight
  (`.github/workflows/ci.yml:1041`) rejects them.
- Run under `psql -v ON_ERROR_STOP=1`, so a failed assertion exits non-zero and fails the job.
- Discovery: filename matching the `test_*.sql` glob under `supabase/tests/` is the ONLY
  registration needed — the `sql-tests` job auto-discovers it (`.github/workflows/ci.yml:1309`).
- Header states the PRE-migration RED behaviour explicitly ("Pre-migration (RED): Part 1 fails
  (function absent) and ON_ERROR_STOP aborts there"). Do this — it is the anti-vacuity record.
- Hygiene paragraph is mandatory: all fixture work inside an explicit transaction ending in
  `ROLLBACK`; every id `gen_random_uuid()`; every `auth.users` email derived from a fresh uuid
  so concurrent CI runs on the SHARED test DB cannot collide; no defensive pre-clean.
- Caller role is driven by `set_config` on `request.jwt.claims`; the outer block stays
  service-role so verification SELECTs bypass RLS. ⚠️ The header warns that GUC is NOT the
  database role — repeat that warning if the new test gates EXECUTE.

⛔ The anti-SKIP gate (`.github/workflows/ci.yml` step "Run SQL self-tests against test Supabase
project", pinned by `src/__tests__/contracts/ci-anti-skip-gate.contract.test.ts`) makes a file
that prints `SKIP:` and exits 0 FAIL the job. Do not add a skip path.

---

### 6. Client-side abort on wizard panel removal

**File and defect site:** `src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.tsx:1040-1043`.
`doRemove` drops the panel with no abort:
```typescript
const doRemove = useCallback((idx: number) => {
  setAnnouncement(`Key ${idx + 1} removed`);
  setPanels((prev) => prev.filter((_, i) => i !== idx));
}, []);
```
This is the gap the file's own docblock at `:905-907` names and defers: "a validating panel
breaks it too, and that one is left open deliberately (153.4 review WR-03, logged in TODOS.md)".

**Analog to copy — `handleStopWaiting`, same file `:1167-1173`:**
```typescript
const handleStopWaiting = useCallback((idx: number) => {
  const p = panelsRef.current[idx];
  if (!p) return;
  abortReasonsRef.current.set(p.id, "user");
  pendingWaitFocusRef.current = p.id;
  abortControllersRef.current.get(p.id)?.abort();
}, []);
```
So the fix is: read `panelsRef.current[idx]`, guard `if (!p) return;`, set
`abortReasonsRef.current.set(p.id, "user")` BEFORE aborting, `abort()` via the id-keyed map,
then filter. It must also `abortControllersRef.current.delete(p.id)` /
`abortReasonsRef.current.delete(p.id)` since the validate's `finally` (`:1420`) will never run
for an unmounted panel.

**Two invariants stated in that file that the fix must honour:**
1. `:860-868` — ⛔ NEVER key by index. `onMove` reorders panels, so an index captured when a
   validate started can point at a DIFFERENT panel; aborting by index would cancel a sibling's
   credential-carrying POST. Key by `panel.id`.
2. `:869-875` — the reason map exists because "an `AbortError` is ONE rejection with two
   opposite meanings". A removal is a USER action → `"user"`, never `"deadline"`, or N healthy
   requests land in the funnel as N seam failures.

**Other abort sites for reference:** unmount cleanup `:918-927` (captures both maps in the
effect BODY, not off the refs inside the cleanup); deadline arm `:1124-1126`; controller
registration `:1210-1212` and `signal: controller.signal` passed through `wizardFetch` at
`:1235`. Sibling single-key implementation:
`src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx:788,1100,1113`. Non-wizard
example of the same pattern: `src/app/(dashboard)/allocations/components/BridgeDrawer.tsx:111-113,195-204`.

---

## Shared Patterns

### Anti-vacuity: the idiom for documenting a RED proof

There are three distinct, co-existing house idioms. Use the one matching the artefact.

**(a) Python — the mutation named in the test's own docstring.** This is the most common form.
`analytics-service/tests/test_ccxt_flows.py:81`:
```python
    F_t. MUTATION: neutering the ``internal is False`` filter lets the 5000 own-
```
and `:108`: "MUTATION: neutering the filter leaks the 800 off-chain withdrawal → 900 → RED;".
Other exemplars: `analytics-service/tests/test_deribit_txn.py:1327` ("Mutation-honest:
neutering the `if row_type in INFORMATIONAL_TYPES: continue` …"),
`test_derive_broker_dailies_dualmode.py:15,97`, `test_deribit_ingest.py:1477` ("i.e. the neuter
reddens this test"), `test_basis_series.py:709` ("# neuter RED: …").
The file-level form is `analytics-service/tests/test_cash_basis_series_sc4.py:36`:
```
Each test names — in its docstring — the mutation it kills (neuter-falsifiability).
```
**Format: name the exact edit, name the observed direction (→ RED), in the docstring of the
test it belongs to.** Not in a plan file, not in a commit message.

**(b) A negative control shipped as a sibling test.** `analytics-service/tests/test_logging_config.py:94-123`
monkeypatches the scrubber to raise and asserts the UNREDACTED value survives — a test that
would go green if the redaction were silently disabled elsewhere. Ship this alongside the
positive assertion for the structlog test.

**(c) Execute-the-gate rather than grep-the-gate.**
`src/__tests__/contracts/ci-anti-skip-gate.contract.test.ts:26-36` extracts the ci.yml step's
shell body and RUNS it with a stub `psql` on PATH, asserting exit codes per injected defect,
because "a grep pin goes green the moment someone keeps the strings and guts the logic".
Additionally: `test_the_walk_is_not_vacuous` in
`analytics-service/tests/test_limiter_route_coverage.py:362-390` asserts a MINIMUM corpus size
so an empty walk cannot read as a pass, and both `scripts/check-*.ts` print a COUNT on success
for the same reason.

⚠️ Project rule from CONTEXT: gate tokens must be counted PRE-EDIT. A token chosen by reading
the finished file always passes.

⛔ For SC-1 Mode A specifically: a scan of `analytics-service/` on 2026-08-26 found NO
module-scope `.bind()` in non-test code, so the gate is PREVENTIVE. It MUST still be proven RED
by introducing a violation and observing the failure, then restoring — otherwise it is a test
that cannot fail.

### Adding a CI job/step — `.github/workflows/ci.yml`

**The aggregator that gates branch protection is `frontend`** (`.github/workflows/ci.yml:751`).
Its `needs:` list (`:802-811`) is:
`frontend-typecheck, frontend-lint, frontend-test, frontend-coverage, frontend-seam-redis,
frontend-policy, frontend-build, e2e-seeded, sql-tests`.

⚠️ The job name must be listed in BOTH the `needs:` block AND the result-verification loop at
`:815-830` — the loop re-reads `needs.<job>.result` string-by-string, and a job added to only
one of the two is silently unenforced. The loop's comment says exactly this.

**Cheapest correct integration for the username gate: add it as a step in `frontend-policy`**
(`.github/workflows/ci.yml:495-586`) or as an `&&` link in `npm run lint` (which runs in
`frontend-lint`). Both jobs are already in the aggregator. Adding a brand-new top-level job
requires the two-place registration above plus its own checkout/deps boilerplate.

⛔ Do NOT attach to `secret-scan` (`:1821`). It is NOT in the `frontend` aggregator's `needs:`,
and CONTEXT records it as already red on `workflow_dispatch` runs.

⚠️ `skipped` is a hazard, not a pass: the aggregator's own comments (`:855-885`) document that
a skipped `needs:` job SKIPS its dependents and can green-wash. If the new gate can self-skip,
the loop needs an explicit arm like the `e2e-seeded` one at `:829-845` that treats a skip on a
trusted event as a FAILURE with `::error::`.

New steps use `- name: <Sentence case description>` + `run:`, pinned third-party actions by
full SHA with a trailing `# vX.Y.Z` comment (`:1854`, `:1868`), and `echo "::error::…"` before
`exit 1`.

### Naming and comment density

**`src/lib/`** — extremely high comment density and it is the convention, not noise. Every
exported symbol carries a `/** … */` docblock. The house habits, all visible in
`src/lib/ratelimit.ts`:
- Module-level docblock with a decision MATRIX in ASCII when behaviour is conditional (`:7-48`).
- Every non-obvious constant/branch is tagged with the finding or phase id that produced it:
  `(P709, audit-2026-05-07)`, `B15 limiter-ordering`, `G15-046`, `140.4-16 / WR-06`,
  `SEAMRIM-04 / TRAP-1`, `F6 red-team`.
- Sentinel markers carry meaning: `⚠️` = a trap or a corrected claim, `⛔` = a prohibition.
  Used inline, in prose.
- When a docblock is REWRITTEN because it was wrong, the old sentence is quoted and refuted
  in place under a `── <id> — WHY THIS DOCBLOCK WAS REWRITTEN ───` banner
  (`src/lib/ratelimit.ts:259-295`). Do not silently delete a wrong comment.
- Section banners inside long docblocks use `── TITLE ─────` box-drawing rules.
- Prohibitions are justified with measurement, e.g. "measured: `grep -rnE …` finds only its own
  definition" (`:391`).

**`analytics-service/services/`** — same discipline, Python form. Module docstrings are
numbered lists of the invariants the module holds
(`analytics-service/services/logging_config.py:1-15`). Private helpers are `_`-prefixed
(`_redact_processor`, `_scrub_tree_freeform`, `_redact_log_record_factory`). Each carries a
docstring that names its FAIL MODE explicitly ("Fail-open invariant: NEVER raises. A redaction
bug here must not break the process."). Processor-order dependencies are commented AT the list
entry with the red-team id that discovered them (`:63-71`, `:224-229`). Loggers are named
hierarchically: `structlog.get_logger("quantalyze.analytics.<surface>")`
(`analytics-service/main.py:161,380,473,658`).

---

## No Analog Found

None. All six target areas have a same-role, same-data-flow analog in-tree.

## Metadata

**Analog search scope:** `src/lib/`, `src/app/api/`, `src/app/(dashboard)/strategies/new/wizard/steps/`,
`src/__tests__/contracts/`, `scripts/`, `supabase/migrations/`, `supabase/tests/`,
`analytics-service/services/`, `analytics-service/tests/`, `.github/workflows/ci.yml`, `package.json`
**Pattern extraction date:** 2026-08-26
