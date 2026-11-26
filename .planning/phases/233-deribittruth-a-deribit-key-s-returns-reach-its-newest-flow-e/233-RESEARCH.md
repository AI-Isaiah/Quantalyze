# Phase 233: DERIBITTRUTH - Research

**Researched:** 2026-11-24
**Domain:** prod-prober arm (node, psql read of PROD), Deribit book attribution oracle (python), Deribit correction classifier (python)
**Confidence:** HIGH for the prober census and the classifier (read in this session); MEDIUM for the oracle's key-set boundary (see A3, A4, O1)

**Method note.** Every claim below is from the repo at this worktree's HEAD. No external source was needed, so the init, graph and research-plan seam steps were skipped on purpose. No PROD or TEST database was touched. A pre-existing baseline run of `tests/test_deribit_txn.py` (192 passed) used another checkout's venv by mistake; do not repeat it, the executor builds its own venv (see Environment Availability). Paths are repo-relative. No PROD id, email, account number or home path is written here; keys and books are letters.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

### FRESH-01: the diagnosis verdict (founder ruling 2026-11-24, Q1, "recommended")
- No writer change and no backfill. FRESH-01 is three things together:
  - the diagnosis record `.planning/debug/deribit-stale-returns.md`;
  - the 2026-11-26 PROD confirmation reading: 2026-11-25 is the first counted day on the three logins, and no rows exist for 2026-10-27..2026-11-24;
  - FRESH-02 accepting the derive's stated left-out days as a named reason.
- **Reversibility:** costly. Making the series reach its newest flow would overturn Phase 188 D-02 and D-08, which are founder decisions.
- The 155.2 freeze condition does not apply. No shared key-mode exit changes, so no MM2, MM3 or FX-AI_V figure moves. Candidate cause (a), the `<2-day` key-mode exit, is eliminated: each key stores 1155 rows, so the derive takes the `>=2` path.
- The ROADMAP's success criterion 1 wording ("The diagnosis names the cause, and the fix lands at it") is read through this ruling. The cause is the missing reader, and the fix lands in FRESH-02's arm. A dated deviation note records this in ROADMAP.

### Compose `out_of_window_flow` on a left-out tail day (founder ruling 2026-11-24, Q2, "recommended")
- 233 does not touch S2. For this account the flag clears by itself once 2026-11-25 has a stored return, because the 2026-11-09 flow is then inside the window.
- The general case goes to Phase 234 NOCAPITAL's scope, with a dated note in the ROADMAP: a flow dated on a stated left-out tail day, after the key's last stored return, is counted as `out_of_window_flow`.
- **Reversibility:** costly, because S2 is owned by 234, and touching it out of order breaks the seam rule.

### FRESH-02: where the check lives and what it accepts (founder ruling 2026-11-24, Q3, "recommended")
- **Where it lives.** A fifth arm, `freshness`, in `scripts/prod-prober/`.
  - It runs in the prober's own workflow, `.github/workflows/prod-prober.yml`. That workflow is outside `ci.yml` and outside the `frontend` aggregator, so the check never blocks CI.
  - It reads PROD read-only.
  - It pages through the prober's existing incident path (`incident.mjs`: a new GitHub issue per incident, which emails a human).
  - It has a RED held-back fixture in the prober's self-test.
  - `ARMS_FLOOR` goes from 4 to 5.
  - **Reversibility:** costly. The census pins, the floor and the workflow header all move together. This choice keeps S5 untouched, so v1.23's 242 and 246 do not re-base on 233, and Phase 238 PR-2 is not held behind a 233 migration.
- **The check rule, as stated to the founder and accepted.**
  - Scope: a "daily-derived key" is one with a `derive_broker_dailies` job in recent nights. Revoked keys that are no longer derived drop out.
  - The comparison is the key's newest stored return day (`csv_daily_returns`, key mode) against max(newest flow day, realized terminal or NAV-mark day) from its `key_inputs`.
  - A key pages when that gap exceeds the stated bound, unless one of two named reasons covers it:
    - (1) every day of the gap is in `key_inputs.tiny_base_days`; or
    - (2) the key carries `anchor_null_reason`.
  - No other reason is accepted. A reason that exists but does not cover the gap day by day does not count.
- Today's PROD reading under this rule is clean: 0 uncovered days on every key, as recorded in the diagnosis census. So the check is GREEN on PROD and RED only on the held-back fixture.

### DBOOK-01: the attribution oracle (founder ruling 2026-11-24, Q4, option (a))
- **What it is.** An independent per-day attribution oracle that imports no production helper. It recomputes each stored book return for the founder's Deribit book from the stored per-key booked P&L, flows and levels in `key_inputs`.
- **Which days are withheld.** A day the oracle cannot reproduce, or a day with no stored base level, is withheld under a reason name. The reason names are a closed set, and the book's existing flags (`missing_return_inside_coverage`, `skipped_nonpositive_denominator`, `emptied_stretch`) are candidates.
- **Capital outside the base.** Days whose base is known to exclude capital at work (open options on a cash basis, flow-adjacent days) are named in the reading but not nulled. The published history does not change on that basis.
- **No plausibility bound** (Phase 194 D-05). The close is an attribution reading, not a tolerance.
- **Reversibility:** costly. The oracle and its withhold names become the book's published explanation.
- **Measured 2026-11-24, for scale.** Book A compounds x3270 over its whole history, and x298 without its 6 days above 30%. 2025 dominates: key B gives x44 over its 255 days as the dominant key (x5.9 without its 5 big days), and key D gives x31 over 56 days with no day above 30%.

### DBOOK-02: the correction classifier (decided by the phase agent, accepted by the founder 2026-11-24)
- A correction is trading only when its reason has a structural trading shape that names an instrument, as the one observed reason does (`<date> BTC-PERPETUAL funding calculation correction`). Matching a trading word is not enough. Every other correction fails loud through `assert_correction_classifiable`.
- One fixture per correction shape, including a capital reason that carries a trading token and no capital word (for example "funding account correction").

### Claude's Discretion
- How the prober arm reads PROD. Match the existing arms (`cron-obs`, `cron-drift`), so no new credential is introduced.

Decided autonomously (CONTEXT): bound = 2 calendar days as one named constant in the arm; strategy-mode series are included only if the planner measures an equivalent stated-days field, else the gap is recorded and routed; the oracle lives in an analytics-service script or test module with its own arithmetic, run against a PROD reading for the SUMMARY and against fixtures in pytest; the classifier reads either an instrument token in the reason or a non-null row `instrument_name`, with the capital denylist keeping precedence; PROOF-01 means neuter the named arm, record the RED line, restore from a byte backup (`cp`, then `cmp`), record the GREEN line, all verbatim in the plan SUMMARY.

### Deferred Ideas (OUT OF SCOPE)
- The compose counting a flow on a stated left-out tail day as `out_of_window_flow` goes to Phase 234 NOCAPITAL (seam S2), per the founder ruling on Q2.
- Nulling capital-outside-base days (options on a cash basis, flow-adjacent days): not chosen (DBOOK-01 options (b) and (c)). They are named in the reading only.

Out of scope (CONTEXT, Phase Boundary): any change to the derive writer (seam S1), the compose `allocator_equity_derive.py` (seam S2), `ops_staleness_check()` (seam S5), any backfill, any migration. If a migration appears, stop and tell the coordinator before opening a PR.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FRESH-01 | The stale-returns account is diagnosed read-only; its series reaches its newest flow or the gap carries a stored named reason; no backfill. | Diagnosis already written (`.planning/debug/deribit-stale-returns.md`). No code. Remaining work: the 2026-11-26 PROD reading (section "FRESH-01 confirmation reading") and FRESH-02 accepting stated left-out days. |
| FRESH-02 | A check outside the derive job compares each daily-derived key's newest return day with its newest flow and anchor day, reports and pages above a bound without a named reason, never blocks CI. | Fifth prober arm `freshness`: SQL, judge, fixtures, census of every pin that moves, incident path, PROOF-01 neuter. |
| DBOOK-01 | Every day of the founder's Deribit book cumulative return is explained by booked P&L and flows, or withheld by name; no plausibility bound. | Independent oracle script plus pytest; exact per-day arithmetic, stored fields, by-design unreproducible classes, run recipe. |
| DBOOK-02 | A correction row with a capital reason never classifies as trading P&L, including one with a trading token and no capital word; one fixture per shape. | Minimal change to `correction_is_trading`; shapes to fixture; call sites; existing tests. |
</phase_requirements>

## Read this first (three loud findings)

1. **DBOOK-01 naming days is a reading. Removing a published day is an S2 change and a founder question.** The compose omits some days from `payload.returns` and raises only book-level flags; it stores no per-day reason. [VERIFIED: analytics-service/services/allocator_equity_compose.py:319-371, 1111-1137] The oracle can name every day in its own output. It cannot make the compose stop publishing a day it cannot reproduce. If the first PROD reading shows one or more days that are published in `equity_curve.returns` and that the oracle cannot reproduce, DBOOK-01's "withheld" can only be satisfied inside the reading unless S2 changes. S2 is out of scope (CONTEXT, owner 234). The planner must put a `checkpoint:decision` before DBOOK-01 is closed and send the count of such days to the coordinator. The recommended reading of "withheld" for 233: excluded from the oracle's explained cumulative and named in the SUMMARY; the published history is unchanged.
2. **The book's counted key set is not stored.** The payload holds `inputs.n_keys` only; which login of a shared account counts, which keys are stitched, and which are departed are decided in the job from `api_keys` state at compose time. [VERIFIED: analytics-service/services/job_worker.py:16991-17113; allocator_equity_compose.py:1156-1160] So the oracle takes the counted set as a declared input and refuses (names the whole book `key_set_not_reproducible`) when the declared count differs from `inputs.n_keys`. See O1.
3. **A renamed `key_inputs` field would turn the arm silently GREEN.** The arm reads fields by name out of jsonb; a missing field reads as NULL, and a NULL comparison day is "nothing to compare". Guard it (Pitfall 1): the scope read counts keys that carry `realized_terminal_day`, and zero such keys with derived keys present is a defect, never green.

## Summary

233 is three independent changes plus one reading. FRESH-02 adds a fifth arm to the existing prober: one SQL read of PROD through the credentials the two SQL arms already use (`PROBER_POOLER_URL`, `SUPABASE_DB_PASSWORD`), a pure Node judge so the fixtures drive the real rule day by day, and a registry move (floor 4 to 5) that touches `run.mjs`, one vitest file and the workflow header. The incident path needs no change: `incident.mjs` is kind-independent and the workflow slices the log from the first defect line verbatim. [VERIFIED: scripts/prod-prober/incident.mjs:46-64] The output goes into a public GitHub issue, so the SQL must return no key id or allocator id.

DBOOK-02 is one pure function. `correction_is_trading` is the single gate; both aggregators, both cash-bearing predicates and `deribit_ingest.py` read it. The change is a conjunction (capital denylist first, then a trading word AND a structurally anchored instrument token or a structured `instrument_name`), strictly narrower than today, so no existing negative can flip and the existing positive keeps its meaning. [VERIFIED: analytics-service/services/deribit_txn.py:924-940] The money risk is unobserved shapes on PROD: raw ledgers are not stored, so "the one observed reason is the only correction shape on PROD" is an assumption (A1).

DBOOK-01 is a self-checking oracle built on the writer-basis identity the derive and the compose already obey: `equity_{t-1} = equity_t - F_t - P_t`, stored return `r = P / L_{t-1}`, book return `r_t = sum_k P_kt / sum_k L_k,t-1` over the keys with a defined return that day. Everything it needs is in `key_inputs` plus the book's `returns`, so it can run offline on a JSON export taken by the orchestrator through the MCP read path.

**Primary recommendation:** build in this order, each behind its own RED proof: (1) DBOOK-02 (smallest, pure, unblocks nothing else), (2) FRESH-02 arm with fixtures and the census edits in one commit, (3) the DBOOK-01 oracle and its fixtures, (4) the PROD readings (oracle reading, then the 2026-11-26 FRESH-01 reading) as the last tasks.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Freshness check (read PROD, judge, page) | Ops tooling (GitHub Actions prober, node) | Database (read-only SELECT) | Must run outside the derive job and outside `ci.yml`; paging is the prober's existing incident issue. |
| Day-by-day coverage judgement | Node judge in the arm | - | Pure so self-test fixtures drive the shipping rule; SQL only reads stored facts. |
| Stored reasons the check accepts | Database (`allocator_equity_derived` key_inputs jsonb) | Analytics worker (writer, unchanged) | The derive already states left-out days; 233 reads them and writes nothing. |
| Attribution oracle | Analytics-service script (python, offline) | Orchestrator MCP read | Independent arithmetic; input is a JSON export, output is a redacted reading. |
| Correction classification | Analytics service (`deribit_txn.py`, pure) | - | The one gate both ingest paths share. |
| PROD confirmation readings | Orchestrator via MCP | - | Reads, marker query first, letters in tracked text. |

## Standard Stack

No external package is added. Everything is Node built-ins (`node:*`, as every prober file) and the Python standard library for the oracle.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| scripts/prod-prober seams (`createSeams`, `realSqlRunner`) | in repo | psql read of PROD, tally, scrubber | Same transport the `cron-obs` and `cron-drift` arms use; no new credential. [VERIFIED: scripts/prod-prober/seams.mjs:171-248] |
| vitest | in repo (`package.json` `"test": "vitest run"`) | wiring pins | Existing `src/__tests__/prod-prober-wiring.test.ts`. |
| pytest | pinned by analytics-service requirements | oracle and classifier tests | Existing suite. |
| Python stdlib (`json`, `math`, `argparse`, `datetime`) | CPython 3.12 (CI) | the oracle | The oracle imports no production helper (PROOF-01, CONTEXT). |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Node judge over raw stored facts | Whole rule in SQL | Fixtures could not drive the day-by-day rule; the SQL would be untestable offline. Rejected. |
| Oracle reading PROD itself via psql | Offline JSON input plus `--print-sql` | The founder's rule is PROD reads via MCP; an offline oracle also makes the fixtures and the PROD reading the same code path. Recommended: offline. |

**Installation:** none.

**Version verification:** not applicable (no registry package).

## Package Legitimacy Audit

No external package is installed by this phase. No `npm install`, `pip install` or `cargo` step appears in any task. Banned packages from CLAUDE.md are not involved. **Packages removed due to [SLOP]:** none. **Flagged [SUS]:** none.

## Architecture Patterns

### System Architecture Diagram

```
FRESH-02 (hourly, prod-prober.yml, outside ci.yml)
  workflow step: supabase link -> PROBER_POOLER_URL (masked) ; SUPABASE_DB_PASSWORD
        |
        v
  run.mjs  ARMS = [pyapi06, cron-obs, cron-drift, mt5, freshness]   (all run, exit decided once)
        |
        v
  arms/freshness.mjs
     seams.sql(FRESHNESS_SCOPE_SQL) -> counts: derived keys, keys with inputs, keys with a comparison day
        |-- derived == 0                 -> defect freshness-no-scope
        |-- derived > 0, none comparable -> measure-fail (field names moved)
     seams.sql(FRESHNESS_KEYS_SQL)  -> one row per recently derived key (venue, tag, newest_return,
        |                              anchor_null_reason, newest_flow, terminal_day, mark_day, tiny_days json)
        v
     judgeFreshness(rows)  (pure)
        per key: reason (2)? -> covered
                 refDay = max(flow, terminal, mark) ; gap = refDay - newest_return
                 gap <= BOUND(2)? -> fresh
                 every day in (newest_return, refDay] in tiny_days? -> covered (1)
                 else -> defect freshness-stale (subject venue#tag, days only)
        |
        v
  runProber table "❌ N defect(s)" in log -> workflow greps ^❌ -> incident.mjs decideIncidentAction
        -> new GitHub issue (emails a human) / comment / close on first clean full run
  scheduled path exits 0 (POSTURE LINE) so a red prober never blocks a deploy

DBOOK-01 (offline, on demand)
  orchestrator MCP reads (marker query first, one statement per call) -> JSON export in scratchpad (untracked)
        -> analytics-service/scripts/deribit_book_oracle.py --input <json>
             per key: roll levels back from realized terminal; per day: P, F, L(t-1)
             per book day: r_oracle = sum P / sum L(t-1) over defined keys
             classify: explained | withheld(<closed reason>) ; annotate: capital_outside_base(<name>)
        -> redacted reading (labels, dates, 3-sig-fig ratios, counts; no ids, no USD) -> plan SUMMARY

DBOOK-02 (every Deribit derive)
  ledger rows -> txn_rows_to_daily_records / txn_rows_to_native_daily
     type == correction -> correction_is_trading(row)
         capital denylist (substring)  -> not trading -> assert_correction_classifiable raises
         trading word AND instrument named (anchored token in reason, or structured instrument_name)
                                       -> realized cash (summed)
         anything else                 -> raises (fail loud)
```

### Recommended Project Structure
```
scripts/prod-prober/
├── arms/freshness.mjs                 # new: SQL constants, parse, judge, REMEDIES, ARM
├── fixtures/freshness/*.json          # new: ok + red fixtures
├── run.mjs                            # edited: registry, floor, kinds, table entry, fixtureSql branch, counts
analytics-service/
├── services/deribit_txn.py            # edited: correction_is_trading (+ one helper, one pattern)
├── tests/test_deribit_txn.py          # edited: new correction-shape tests
├── scripts/deribit_book_oracle.py     # new: stdlib-only oracle
└── tests/test_deribit_book_oracle.py  # new: fixtures-driven tests + independence scan
```
Oracle fixtures: `analytics-service/tests/fixtures/deribit_book_oracle/*.json` (matches the existing `tests/fixtures/*.json` convention, e.g. `native_to_usd_oracle.json`).

### Pattern 1: arm registration (what an arm is)
**What:** an arm is `{ name, requiredEnv, run(ctx), REMEDIES }`. `run` receives `{ env, seams, log, addDefect, manifestPath, functionsDir }`; every kind goes through `addDefect(kind, arm, subject, detail, remedy)`, which throws on a kind not in `DEFECT_KINDS`. [VERIFIED: scripts/prod-prober/run.mjs:549-558, 613]
**Credentials:** the two SQL arms declare `requiredEnv: ["PROBER_POOLER_URL", "SUPABASE_DB_PASSWORD"]`; copy it. The seam spawns `psql` with `-v ON_ERROR_STOP=1 -At -q -F <tab> -X -c <query>`, password only in the child env, stderr redacted to one line; a failed psql is `measureFail`, never an empty answer. [VERIFIED: scripts/prod-prober/arms/cron-obs.mjs:624-629; seams.mjs:171-248]
**Parse:** tab-separated, NULL prints as the empty string, one record per line. [VERIFIED: cron-obs.mjs:264-291]
**Never printing a value:** `runProber` scrubs every `requiredEnv` value from every log line and defect row; arms print only names, counts, days and machine codes. [VERIFIED: run.mjs:287-303]

### Pattern 2: the self-test table entry
A table entry names `arm`, `fixtureDir`, one `green` fixture, `greenSeamCalls`, optional `kinds` (default: defect kinds prefixed `<arm.name>-`), `makeSeams(data)` and `red: { fixtureFile: kind }`. The loop asserts the green fixture exits 0 with all seam calls attributed to the arm, every `REMEDIES` key is a registered kind, every remedy is a string of at least 40 characters and unique, then each red fixture yields exactly one defect of exactly its kind with that arm's remedy and no other kind. A kind needs an independently spelled literal `kind === "<k>"` in `KIND_ASSERTIONS`, or the loop fails. [VERIFIED: run.mjs:1075-1209, 1270-1296, 1327-1448]

### Anti-Patterns to Avoid
- **Casting jsonb text to `date` in SQL.** One malformed stored day would raise and blind the whole arm. Return text, validate in Node.
- **An INNER join from `key_inputs`.** A recently derived key with no `key_inputs` row would vanish. Start from the recent-derive set and LEFT JOIN.
- **Restating a count in prose.** The repo's own rule (CLAUDE.md, floors section). Cite symbols; the planner reads counts from the run.
- **Naming a kind with the word `key` in the identifier beside a value.** gitleaks `generic-api-key` is keyed on that word; the prober allowlist is scoped to `pyapi06-...`, `SENTINEL-KEY-...` and `FAKE-key-` only. [VERIFIED: .gitleaks.toml:236-300] Draft shapes (kinds `freshness-stale`, `freshness-no-scope`, a fixture field `key_tag` with an 8-hex value, a KIND_ASSERTIONS-shaped line) were scanned with gitleaks 8.30.1 against this repo's config in a scratch directory: no leak. Prefer `tag` over `key_tag` and low-entropy fixture values anyway, and run gitleaks over the new files before pushing.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Paging | A new notifier or workflow | The existing incident issue (`incident.mjs`, workflow step `Open, update or close the prod-prober incident issue`) | Kind-independent by design; a kind-keyed path would hide a new kind behind an old issue (pinned by `[164.8.3-01]`). |
| PROD transport | A second DSN or secret | `realSqlRunner` with the two existing names | D-06 (absent credential is a hard failure), scrubber and tally are already wired. |
| Self-test harness | A separate script | `ARM_FIXTURE_TABLE` entry plus `fixtureSql` branch | The absurdity floor and the arm-count assertions only count arms in the registry. |
| Day arithmetic | Date libraries | `Date.UTC` plus integer day counts, strict `YYYY-MM-DD` round-trip | No dependency; matches the repo's strict ISO-day habit (`_strict_iso_day` round-trip). |
| Oracle redaction | Importing `scripts.deribit_ground_truth` | A local closed-vocabulary emitter | That module imports `services.deribit_txn`; importing it would break "imports no production helper". [VERIFIED: analytics-service/scripts/deribit_ground_truth.py header comment on lifted helpers; services/deribit_txn.py:117-119] |
| Instrument-token test | `classify_instrument` as the structural test | An anchored regex | `classify_instrument` is deliberately lenient: any name ending `-C`, `-P` or `-PERPETUAL` passes. [VERIFIED: services/deribit_txn.py:160-195] |

**Key insight:** every rule here already exists in the repo as a stored fact or a pure function. 233 adds readers and a stricter gate; it must not add a second source of truth.

## FRESH-02: census of everything that moves

All greps were `grep -a` over the tree excluding `node_modules`, `.git`, `.planning`, CHANGELOG and TODOS. Regenerate before trusting; counts are not restated.

### `scripts/prod-prober/run.mjs` (every site, by symbol)
| Site | What must change |
|------|------------------|
| header comment "Registered arms (FOUR, equal to ARMS_FLOOR)" (line 16) and "floor is now MET BY THE REGISTRY (4 arms / floor 4)" (line 22) | five arms, name `freshness` |
| `import` block (lines 103-112) | `import * as FRESHNESS_MOD from "./arms/freshness.mjs"` |
| `SQL_ARM_MODULES` (lines 124-127) | add `{ name: "freshness", module: FRESHNESS_MOD }`. The read-only scenario ranges over it. |
| `export const ARMS_FLOOR = 4;` (line 148) and its comment block (136-147) | 5; rewrite the "FOUR" comments |
| `export const SELF_TEST_SCENARIOS = 91;` (line 151) | new total; derive by running the self-test, which asserts printed headers equal the constant |
| `DEFECT_KINDS` (lines 181-215) | add the freshness kinds |
| `export const ARMS = [PYAPI06_ARM, CRON_OBS_MOD.ARM, CRON_DRIFT_MOD.ARM, MT5_MOD.ARM];` (line 221) and its comment (218) | append `FRESHNESS_MOD.ARM` |
| `fixtureSql` (lines 945-1042) | add a branch for each freshness query, answering GREEN by default so every existing full-registry scenario stays green without opting in. Without it each such scenario becomes a measure-fail. Dispatch is by substring in order (`pg_net.ttl`, `shobj_description`, `net._http_response`, `job_run_details`+`ledger_refresh_fanout`, `public.cron_runs`, `cron.job`, else a self-test measureFail); the freshness SQL must not contain an earlier branch's substring and each of its two statements needs a distinct token. |
| `ARM_FIXTURE_TABLE` (lines 1075-1209) | new entry: `fixtureDir: "freshness"`, `green`, `greenSeamCalls: 2`, `makeSeams`, `red` map |
| `allGreenSeams()` (lines 1226-1248) | load `freshness/ok.json` and pass it in `sqlData` (explicit, even though the default is green) |
| `KIND_ASSERTIONS` (lines 1270-1296) | one literal `(d) => d.kind === "<kind>"` per new kind |
| credential scenario (line ~1583) | derives names from `ARMS`; no edit, but its counts change by themselves |
| read-only SQL scenario (lines 1890-1918) | no edit; it forbids `INSERT UPDATE DELETE ALTER CREATE DROP TRUNCATE GRANT REVOKE COPY` as whole words (case-insensitive) anywhere in a `*_SQL` constant, requires `SELECT`/`WITH` first, forbids `headers`, `job_run_details.status` and any `;`, and requires at least two `*_SQL` constants per listed module |
| FULL GREEN scenario (lines 4943-4990) | `slots === 10 && names.length === 8` becomes 12 and 8 (freshness adds two slots, no new name); `armsExecuted === 4` (twice, here and in the CROSS-ARM scenario ~5037), `arms: 4/4/0` (twice, ~4977 and ~5039), titles saying FOUR |
| CROSS-ARM scenario (lines 4995-5060) | its hand-built `fixtureSql({ cronObs, ttl, cronJobRows })` needs no edit if the default is green; counts move as above |
| contact-write scenarios (lines ~5190-5290) | `r.armsBlocked === 4` (line ~5285) becomes 5; the ok and error variants also build `fixtureSql` data without freshness and rely on the default |
| `main()` banner uses `ARMS.length` (line 5863) | none |

### `src/__tests__/prod-prober-wiring.test.ts`
| Site | Change |
|------|--------|
| `"the arm floor is FOUR and the registry meets it"` (lines 1143-1154) | `toBe(5)` twice, name list adds `"freshness"` (sorted), title |
| `EXPECTED_DEFECT_KINDS` (lines 849-875), hand-typed and sorted | add the two kinds in sort order (`floor`, then the freshness kinds, then `manifest-invalid`) |
| `SELF_TEST_SCENARIOS is ...` (lines 1909-1926) | literal `toBe(91)` becomes the new count; the test derives the rest by executing the self-test |
| new `describe` | bind the arm's constants to their sources so a rename cannot go silent: `compute_jobs_kind_check` lists `derive_broker_dailies` (`supabase/schema/baseline.sql:2038`), and `analytics-service/services/job_worker.py` still writes the payload keys the SQL reads (`tiny_base_days` at :10209, `nav_mark` with `mark_day` at :10345-10350, `anchor_null_reason`/`flows`/`venue` at :10143-10155) and `allocator_equity_derive.py` still writes `realized_terminal_day` (:1768) |

Not moved, checked: the kind-independence pins (`kindsMentioned` over the auto-issue step and `incident.mjs`; do not quote a kind there), the credential-assert step (names unchanged), the arm `requiredEnv` vs workflow-env pin (it scopes to `RAILWAY_*`, which freshness does not use), `CI_TEXT` must not contain `prod-prober` (line 698: the arm is not referenced from `ci.yml`).

### `.github/workflows/prod-prober.yml` (text only, no logic)
Line 1 `name: prod-prober (four arms, hourly)`; the header block lists the four arms (add a `freshness` entry in the same voice); lines ~88 and ~91 (`workflow_dispatch` descriptions: "run all four arms" and the arm list `pyapi06 | cron-obs | cron-drift | mt5`); the timeout comment "four live arms" and the step name at line ~252 `Probe production (all four arms, aggregate, exit at the end)`. Keep the prefix `- name: Probe production` (the wiring test anchors on it at lines 3123 and 3161). New workflow prose must avoid the softening tokens the wiring test scans for (`continue-on-error`, `|| true`, `exit 0`, `::warning`, `set +e`, `|| :`, `2>/dev/null`, `set +o pipefail`, `|| exit 0`). [VERIFIED: src/__tests__/prod-prober-wiring.test.ts:212-222] The existing `exit 0` in the posture block is guarded separately; do not add another.

### Not enumerating the arms (checked, no edit)
Other files that mention `cron-obs`/`cron-drift`/`pyapi06` are runbooks, migrations and service docs that cross-reference one arm; none lists the registry. `src/__tests__/adr-0008.test.ts` and the ADR only name `scripts/prod-prober/cron-manifest.json`. `.gitleaks.toml` allowlist keys on `pyapi06-[a-z0-9-]+`, `SENTINEL-KEY-[0-9a-f]{4,}` and one fake JWT header, plus `FAKE-key-`; it does not enumerate kinds, so a new kind or fixture directory moves nothing **provided** no new identifier looks like a credential (see Anti-Patterns). `docs/runbooks/prod-prober-cadence-go-live.md` is the nearest runbook; a short `docs/runbooks/` note for the arm's remedy is optional and planner's call.

### The arm's SQL (draft; two statements, each one `SELECT`/`WITH`, no `;`)

The scope read. It counts recently derived keys and what they carry, so an empty or field-less scope is a defect, never green.
```sql
WITH recent AS (
  SELECT DISTINCT j.api_key_id
    FROM public.compute_jobs j
   WHERE j.kind = 'derive_broker_dailies'
     AND j.api_key_id IS NOT NULL
     AND j.created_at > now() - interval '3 days'
)
SELECT (SELECT count(*) FROM recent) AS derived,
       (SELECT count(DISTINCT r.api_key_id) FROM recent r
          JOIN public.allocator_equity_derived d ON d.kind = 'key_inputs:' || r.api_key_id::text) AS with_inputs,
       (SELECT count(DISTINCT r.api_key_id) FROM recent r
          JOIN public.allocator_equity_derived d ON d.kind = 'key_inputs:' || r.api_key_id::text
         WHERE d.payload ? 'realized_terminal_day') AS with_terminal
```
The per-key read. Newest `key_inputs` row per key (a key can sit under more than one allocator), text out, nothing cast, no id out:
```sql
WITH recent AS (
  SELECT DISTINCT j.api_key_id
    FROM public.compute_jobs j
   WHERE j.kind = 'derive_broker_dailies'
     AND j.api_key_id IS NOT NULL
     AND j.created_at > now() - interval '3 days'
), ki AS (
  SELECT DISTINCT ON (d.kind) d.kind, d.payload
    FROM public.allocator_equity_derived d
   WHERE d.kind LIKE 'key_inputs:%'
   ORDER BY d.kind, d.computed_at DESC
), nr AS (
  SELECT r.api_key_id, max(r.date) AS newest_return
    FROM public.csv_daily_returns r
   WHERE r.api_key_id IS NOT NULL
   GROUP BY r.api_key_id
)
SELECT coalesce(ki.payload->>'venue', 'unknown') AS venue,
       left(md5(rc.api_key_id::text), 8) AS tag,
       coalesce(to_char(nr.newest_return, 'YYYY-MM-DD'), '') AS newest_return,
       coalesce(ki.payload->>'anchor_null_reason', '') AS anchor_null_reason,
       coalesce((SELECT max(f->>'utc_day_iso')
                   FROM jsonb_array_elements(CASE WHEN jsonb_typeof(ki.payload->'flows') = 'array'
                                                  THEN ki.payload->'flows' ELSE '[]'::jsonb END) f), '') AS newest_flow,
       coalesce(ki.payload->>'realized_terminal_day', '') AS terminal_day,
       coalesce(ki.payload->'nav_mark'->>'mark_day', '') AS mark_day,
       (CASE WHEN jsonb_typeof(ki.payload->'tiny_base_days') = 'array'
             THEN ki.payload->'tiny_base_days' ELSE '[]'::jsonb END)::text AS tiny_days,
       (ki.kind IS NOT NULL) AS has_inputs
  FROM recent rc
  LEFT JOIN ki ON ki.kind = 'key_inputs:' || rc.api_key_id::text
  LEFT JOIN nr ON nr.api_key_id = rc.api_key_id
 ORDER BY 1, 2
```
Facts these read (all [VERIFIED] by reading the line quoted):
- `compute_jobs.kind` admits `'derive_broker_dailies'` and `api_key_id` is a column: `baseline.sql:2038` quotes `'derive_broker_dailies'::"text"` inside `compute_jobs_kind_check`; `:2029` `"api_key_id" "uuid"`. Status values: `'pending', 'running', 'done', 'done_pending_children', 'failed_retry', 'failed_final'` (`:2043`). The scope is deliberately **any status**: a key whose derive keeps failing is still derive-scheduled and must stay in scope.
- `allocator_equity_derived (allocator_id, kind, payload jsonb, computed_at)`, primary key `(allocator_id, kind)`: `baseline.sql:13389-13394`.
- `csv_daily_returns` has `"date" "date"`, `"api_key_id" "uuid"`, `"allocator_id" "uuid"`, and the check `num_nonnulls(strategy_id, api_key_id) = 1`: `baseline.sql:14444-14455`.
- Payload keys: `"flows": _flows_payload` rows `{"utc_day_iso": ..., "usd_signed": ...}` (`job_worker.py:10006-10008, 10143-10155`), `"anchor_null_reason"` (`:10148`), `"venue": venue` (`:10154`), `tiny_base_days` present-only (`:10207-10209`, a list of ISO days), `nav_mark` `{mark_day, nav_usd, open_pnl_usd, marked_at}` (`:10345-10350`), `realized_terminal_day` / `realized_terminal_usd` (`allocator_equity_derive.py:1766-1768`).
- `anchor_null_reason` words written: `"native_unit"`, `"native_unpriced"`, `"balance_error"`, `"nonfinite"`, `"nonpositive"`, `"dust"`, `"flow_drop"` (`job_worker.py:10097-10115`). Any non-empty one is reason (2) under the ruling.
- The prober role reads these tables: `scripts/accounttruth-census.mjs` reads `csv_daily_returns` and `allocator_equity_derived` over the same pooler DSN and asserts the role bypasses RLS (`RLS_PROBE_SQL`: `SELECT CASE WHEN r.rolsuper OR r.rolbypassrls ...`, line 83). [VERIFIED: scripts/accounttruth-census.mjs:83, 195-206] `allocator_equity_derived` has `FORCE ROW LEVEL SECURITY` (`baseline.sql:13396`); the BYPASSRLS role is what makes the read work. **Not proven for the prober's session by a run in this session (A5).**

Judge (pure; the fixtures drive this exact function). Skeleton, values taken from the verified reads above:
```js
export const FRESHNESS_BOUND_DAYS = 2; // one line to change; nightly derive marks the previous UTC day

export function judgeFreshness(rows, log = () => {}) {
  const defects = [];
  for (const r of rows) {
    if (!r.hasInputs) { log(`freshness: ${r.venue}#${r.tag} has no key_inputs row (not judged)`); continue; }
    if (r.anchorNullReason !== "") continue;                       // reason (2)
    const newest = isoDay(r.newestReturn);                          // strict YYYY-MM-DD or null
    const ref = maxDay([r.newestFlow, r.terminalDay, r.markDay]);   // invalid text => measure-fail upstream
    if (newest === null || ref === null) continue;                  // no series yet / nothing to compare: log, never page
    const gap = dayDiff(ref, newest);
    if (gap <= FRESHNESS_BOUND_DAYS) continue;
    const stated = new Set(r.tinyDays);                             // JSON.parse of tiny_days, strings only
    const uncovered = daysAfterThrough(newest, ref).filter((d) => !stated.has(d)); // reason (1), day by day
    if (uncovered.length > 0) defects.push({ kind: "freshness-stale", subject: `${r.venue}#${r.tag}`, uncovered, gap });
  }
  return defects;
}
```
Rules the judge must keep: a reason that covers only some gap days does not count (the partial-cover fixture); a key with no `key_inputs` row, or with no returns, is logged and not paged (the rule has no flow or anchor to compare; O3); the defect detail carries days and counts only, never an id or an amount.

## FRESH-02: the other questions

**How output reaches a page.** The arm calls `addDefect`; `runProber` prints `❌ N defect(s):` and a table; the workflow's probe step writes the log to a file, `cat`s it, and `incident.mjs.parseLog` slices from the first `❌` line verbatim into the issue body; `decideIncidentAction` opens an issue when none is open (the email), comments while open, closes on the first clean full run. [VERIFIED: .github/workflows/prod-prober.yml incident step; scripts/prod-prober/incident.mjs:30-64] On the scheduled path the step exits 0 so a red prober never blocks a deploy; the page is the issue. [VERIFIED: prod-prober.yml posture block] **Nothing in `incident.mjs` or the issue step may name a kind** (`kindsMentioned` pin).

**How it goes RED in self-test.** A fixture whose newest return is held back by more than the bound with an uncovered day yields exactly one `freshness-stale` defect, exit 1, with `arm.REMEDIES["freshness-stale"]`. The fixture set (one cause each, so a neuter reddens exactly one scenario, the cron-drift pattern):
- GREEN `ok.json`: a healthy key (gap 1); the D1 shape (gap longer than the bound, every gap day stated in `tiny_days`); a key carrying `anchor_null_reason` with an old newest return; a no-returns key with a reason; a key whose gap equals the bound exactly.
- RED `stale.json`: gap longer than the bound, no reason, no stated days, one key only (the held-back series end).
- RED `partial-cover.json`: every gap day stated but one (proves day-by-day, not "any tiny day").
- RED `bound-plus-one.json`: gap exactly bound+1, no reason (proves the bound is a boundary, paired with the green equal-to-bound key).
- RED `no-scope.json`: scope read answers zero derived keys, kind `freshness-no-scope`.
Plus dedicated scenarios (not table-driven): an unparsable per-key row is a `measure-fail` naming the arm; scope count versus returned rows disagreeing is a `measure-fail` (the cron-drift out-of-band count idiom: a vanished row is not a clean one); derived keys present but none carrying `realized_terminal_day` is a `measure-fail` (the silent-GREEN guard); a reason on key X does not cover key Y. `SELF_TEST_SCENARIOS` = current constant + 1 (green) + red-fixture count + dedicated count; run the self-test to read the printed total.

**Kinds and remedies.** Two kinds with a prefix equal to the arm name so `entryKinds` needs no `kinds` override: `freshness-stale` and `freshness-no-scope`. Each remedy at least 40 characters, unique, and names a query a human runs by hand (the key's `key_inputs` row and the newest `csv_daily_returns` day, read through the MCP path with the marker query first). A remedy must not contain an id.

**Strategy-mode series: record and route, do not include.** Strategy mode does carry a stated-days field: `strategy_analytics.data_quality_flags.tiny_base_days`, present-only. [VERIFIED: analytics-service/services/analytics_runner.py:2316-2319] But the other side of the comparison does not exist for strategies: `key_inputs` (flows, `realized_terminal_day`, `nav_mark`, `anchor_null_reason`) is written only by the key-mode epilogue (`_run_key_mode_compose_epilogue`, `job_worker.py:9974` onward, `_persist_key_inputs` at :10400-10417), and the `strategy_analytics` table definition has no flow, anchor or terminal-day column (`baseline.sql`, table `strategy_analytics`). That is an absence claim, so it is `[ASSUMED]` (A2) beyond what was read. A strategy comparison against the linked key's NAV marks would be a new rule with its own false-positive profile and no founder ruling. Recommendation: exclude, write the gap in the plan SUMMARY, and route it as a one-line item to v1.23 HARDEN (planner's call whether it also earns a `TODOS.md` line; the TODOS rule says LOW and Info survivors are not booked, this is a recorded scope boundary).

**Not watched (state it in the arm header).** A derive that stops entirely freezes both sides of the comparison (inputs and returns age together), so the arm cannot see it; the job-failure and staleness alerts own that. Following the cron-obs precedent, an empty derived-key scope is a defect, not a pass.

**PROOF-01 neuter for this arm.** Back up with `cp` and verify with `cmp` before and after. Neuters, one per gate: (a) set `FRESHNESS_BOUND_DAYS` to a large number: `stale.json` and `bound-plus-one.json` stop firing, RED names `freshness-stale fires on stale.json`; (b) replace the per-day test by "any stated day covers": RED on `partial-cover.json`; (c) delete the `anchorNullReason` accept: the green control exits 1; (d) drop the arm from `ARMS`: the `floor` defect and the FULL GREEN scenario go RED, and `prod-prober-wiring.test.ts` reds on the registry pin; (e) remove the scope guard: `no-scope.json` reds. Command for every one: `node scripts/prod-prober/run.mjs --self-test` (RED line is the first `SELF-TEST FAIL:`), then restore, `cmp`, rerun to `SELF-TEST PASSED: N/N`. Record each neuter edit, command, RED line and GREEN line verbatim in the plan SUMMARY.

## DBOOK-01: the attribution oracle

### The arithmetic it must reproduce (all [VERIFIED] by reading the code named)

Per key `k` in writer-basis mode (Deribit and MT5 are the writer-basis venues, `WRITER_BASIS_VENUES = frozenset({"deribit", "mt5"})`, `job_worker.py:374`):
- Stored per-key inputs: `composed_day_pnl` rows `{utc_day_iso, pnl_usd}` (every NAV day, the set W), `composed_flows` rows `{utc_day_iso, flow_usd}` (non-zero days only), `realized_terminal_day` and `realized_terminal_usd`, `dropped_day_pnl` rows `{utc_day_iso, pnl_usd}` (days the writer left out of the stored returns), `returns_stamp` rows `{utc_day_iso, return}` (the exact returns written), `tiny_base_days`, `anchor_usd`, `anchor_null_reason`, `options_cash_basis`, `options_activity`, `options_basis`. [VERIFIED: allocator_equity_derive.py:1718, 1766-1768, 1815, 1824-1825, 1955-1956; job_worker.py:10207-10209, 10373, 10391]
- **Levels.** Days replayed = union of return days, composed-flow days, dropped days and W. With `L_T = realized_terminal_usd` on `T = max(W)`: `equity[t-1] = equity[t] - F_t - P_t` (the writer's identity, no return factor). [VERIFIED: allocator_equity_derive.py:1509-1514] A day with no entry carries the prior listed day's level. [VERIFIED: allocator_equity_compose.py:294-307]
- **Stored return.** `r_t = (cur - prev - F_t) / prev = P_t / L_{t-1}` on a day that passes the writer's guards. [VERIFIED: analytics-service/services/nav_twr.py `returns[t] = (cur - prev - flow_t) / prev`, and the docstring `pnl_t = cur - prev - flow_t`] Deribit measures a flow day at day level (D-07), so no timed-cohort return applies to a Deribit key. [VERIFIED: services/native_nav.py:721-731 comment]
- **Writer guards (the days a stored return is absent).** `negative_nav_guard`, `dust_nav_guard`, `pnl_dominated_guard` (`|pnl| >= PNL_DOM_RATIO * prev`) and `tiny_base_guard` (Phase 188: base positive and under 5% of the 30-day peak). Each such day has no return row but keeps its P&L in `dropped_day_pnl`; tiny days are also listed in `tiny_base_days`. [VERIFIED: nav_twr.py guard block; services/tiny_base.py:35-37 `TINY_BASE_FRACTION = 0.05`, `TINY_BASE_WINDOW_DAYS = 30`]
- **Marked era.** After `marks_since`, one return per mark day covers the gap: `base = level(p) + sum(F_g over the gap)`, `r(d) = (M_d - base - F_d) / base`, `writer_day_pnl = M_d - base - F_d`, and `0.0` for gap days. [CITED: analytics-service/services/nav_marks_apply.py:47-67] So `r = P / L_{t-1}` still holds on a mark day with `L_{t-1}` the carried-plus-flows level, and gap days carry `P = 0`, `r = 0`. That `composed_day_pnl` in `key_inputs` already carries the marked P&L is `[ASSUMED]` (A4); the oracle's own per-day equality check measures it, and a day failing it inside `marks_since` is named, not guessed.
- **Emptied stretch.** Levels in an emptied band are zeroed (`EMPTIED_FRACTION = 0.01`, `EMPTIED_NEGATIVE_FRACTION = 1e-4`, `EMPTIED_RESTART_FLOOR_USD = 100.0`, `_SELF_CHECK_ABS = 1e-6`); a zeroed level has no weight. [VERIFIED: allocator_equity_derive.py:1092, 1109, 1122, 1133, 1545-1568, 1612-1613] The oracle keeps its own literal copies of these constants and a TEST (not the script) pins them equal to the production module, so independence at import time holds while drift is still caught.
- **Live anchor.** The curve's last level on a key's last day is the live equity (`anchor_usd`), a step on that one day. [VERIFIED: allocator_equity_derive.py:1644-1655] It matters for the oracle only as the carried base of a key whose own series ended before the book's last day.
- **Book return.** `r_t = sum_k E_{k,t-1} r_{k,t} / sum_k E_{k,t-1}` over keys with a level on both `t-1` and `t`; a key's first day is a join (excluded); a key whose day is in its dropped set sits out of both sums and the key-day is counted as `undefined_return_days` (flag `missing_return_inside_coverage`); a non-rotated key whose series ended keeps its last level with `r = 0`; a departed key leaves both sums after its end day; a day with `denom <= 0` is omitted (flag `skipped_nonpositive_denominator`); a non-finite level, return or sum omits the day under the blocking `nonfinite_return`. [VERIFIED: allocator_equity_compose.py:230-371, 1101-1137] Output rows are `{"date": day, "r": value}` inside `payload.returns` (line 370; the payload is built at :1144-1156).
- **Oracle identity.** Because `E_{k,t-1} r_{k,t} = P_{k,t}`, the oracle recomputes `r_t = sum_k P_kt / sum_k L_k,t-1` from `composed_day_pnl` and the rolled-back levels, independently of the stored per-key returns, and also checks per key-day `returns_stamp[t] == P_t / L_{t-1}`. Compare to the stored book return with a relative tolerance in the order of 1e-9 (the stamp tolerance in the repo is `RETURNS_STAMP_TOL = 1e-12`, allocator_equity_derive.py:1939; use a looser book-level one and record it). Persisted curve rows exist even when `is_trustworthy` is false: a compose with a non-empty curve is upserted as composed; only an empty curve becomes a refusal row. [VERIFIED: job_worker.py:18246-18289 comment and branch]

### Closed reason set for withheld days
Prefer the compose's existing names; add oracle-local names only where no existing name fits. Planner finalises the set and a test asserts every withheld day carries a member of it.
| Reason | Meaning | Origin |
|--------|---------|--------|
| `missing_return_inside_coverage` | a key-day inside coverage with no return (writer-dropped or tiny-base day, or a gap day) sat out of that day's sums | compose flag `_MISSING_RETURN_INSIDE_COVERAGE`, allocator_equity_compose.py:67 |
| `skipped_nonpositive_denominator` | the day's summed base is not positive; the compose omitted it | compose flag, :63 |
| `emptied_stretch` | a key's level is in an emptied band and zeroed | replay flag, allocator_equity_derive.py:1659-1663 |
| `no_stored_base_level` (oracle-local) | no key has a stored base level for `t-1` (the book's first day, a key's join day, a row without a writer basis) | new |
| `key_set_not_reproducible` (oracle-local) | the declared counted set does not match `inputs.n_keys`, or a day sits on a key's exit, stitch or segment boundary the stored payload does not state | new (O1) |
`window_truncated` and `out_of_window_flow` are book-level degrade reasons, not per-day names; the oracle reports them beside the reading and does not use them as day reasons. [VERIFIED: allocator_equity_derive.py:109, 121]

### Days it cannot reproduce by design
1. Any day whose counted key set it cannot pin (shared-account choice, stitch, departed, no-capital exit, failing-key exit, interior unpriced hole). The compose picks the counted login by `account_groups`, `working_holder_predicate`, first return day and read-incomplete markers; none of that is in the payload. [VERIFIED: job_worker.py:16991-17049, 17107-17113] Mitigation: the export carries the allocator's key rows' share/active/sync fields and the payload's `no_capital_exited_keys`, `failing_key_exits`, `unpriced_native_keys`; the oracle takes the counted set and each exit day as declared inputs recorded in the reading, and checks `len(counted) == inputs.n_keys`.
2. A row written before the writer basis (no `composed_day_pnl`): no base level, `no_stored_base_level`.
3. A key whose row carries `writer_basis_withheld` or a stale `returns_stamp`: not reproducible, named.

### Capital outside the base: named, never nulled
- `key_inputs.options_cash_basis` is present-only `True` when options are measured at cash value (the open option book is outside the base); `options_activity` is stamped on every Deribit key-mode row; `options_basis` names the basis when options are at market. [VERIFIED: job_worker.py:6145-6155, 6739-6742, 10373, 10386-10391] These are key-level, not per-day: when `options_cash_basis` is true the oracle annotates every day of that key `capital_outside_base_options_cash`.
- Flow-adjacent: a day with a non-zero composed flow on `t` for a key in the day's set (the formula counts a day-level flow at the end of its day, so capital that arrived intraday earned P&L it is not in `L_{t-1}` for). Name `capital_outside_base_flow_day`. This definition is `[ASSUMED]` (A5b); CONTEXT only says "flow-adjacent".
- These annotations never change `explained` or the published value. They appear in the reading, with the largest contributing key (label) and the day's share, so the x3270 and x298 figures are decomposed by name.

### Where it lives and how it is run
- `analytics-service/scripts/deribit_book_oracle.py` (stdlib only) and `analytics-service/tests/test_deribit_book_oracle.py`, fixtures under `analytics-service/tests/fixtures/deribit_book_oracle/`. `analytics-service/scripts/` already holds read-only reading scripts (`derivegaps_probe.py`, `mt5_soak.py`, `deribit_ground_truth.py`). [VERIFIED: directory listing] CI mypy does not cover `scripts/` or `tests/` (its path set is `services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`, ci.yml:5740), but write annotated code anyway.
- Independence is enforced mechanically: a test parses the script's AST and fails on any import of `services`, `routers`, `models`, `main*` or on `scripts.deribit_ground_truth` (which itself imports `services.deribit_txn`). PROOF-01 neuter: add `from services.nav_twr import ...`; the scan reds by name.
- Vacuity guard, from `scripts/mt5_soak.py`'s precedent (`_MIN_CHECKED_SHARE = 0.5`): a run that explains zero days, or whose explained share of reproducible days is below a stated floor, exits non-zero; an oracle that withholds everything must not read green. [VERIFIED: scripts/mt5_soak.py:276, 1027]
- Run recipe for the SUMMARY reading (read-only, no connection in the script): the orchestrator takes the marker query first (see FRESH-01 reading), then reads through the MCP path one statement per call, using projections the script prints with `--print-sql[=<label>]` (the `scripts/accounttruth-census.mjs` `--print-sql` pattern): the book's `payload->'returns'` and `payload->'flags'`/`degrade_reasons`/`inputs`/exit lists; per key, only the listed fields. Large arrays are fetched by year with `jsonb_path_query_array(payload, '$.composed_day_pnl[*] ? (@.utc_day_iso >= "2025-01-01" && @.utc_day_iso < "2026-01-01")')`. The export lands in the session scratchpad, never in the repo. `python scripts/deribit_book_oracle.py --input <export.json>` prints the reading. Redaction contract (from `derivegaps_probe.py`): labels `k1..kN`, dates, counts and 3-significant-figure ratios only; no id, no USD amount, no venue text; the emitter refuses any value outside its declared vocabulary and a local scan refuses UUID shapes and long digit runs. Do not import `deribit_ground_truth.sanitize_evidence`.

### Does any published number change?
Not in 233 as scoped. The oracle changes no code path of the derive or the compose. See "Read this first" item 1 for the one case that would need a founder decision.

## DBOOK-02: the correction classifier

### Current code (read)
`correction_is_trading(row)` lowers `info.reason`, returns False if any capital keyword is a SUBSTRING (`deposit, withdrawal, transfer, wallet, capital, network, on-chain, onchain, reward, rebate, bonus, airdrop, insurance, subaccount, sub-account`), else returns True if any trading keyword matches on a WORD BOUNDARY (`funding, settlement, session, pnl, p&l, delivery, trade, liquidation, premium, expiry`). [VERIFIED: services/deribit_txn.py:842-859, 875-886, 924-940] `"funding account correction"` has no capital keyword and contains `funding`, so it is trading today: the defect.

### Minimal change
Keep the denylist first and the trading word required; add a third conjunct: the reason names an instrument by an ANCHORED token, or the row's `instrument_name` is a structured instrument. Sketch (new names are suggestions; values are the verified repo constants and examples):
```python
# Deribit names seen in this module: BTC-PERPETUAL, BTC_USDC-PERPETUAL, BTC_USDC-27MAR26, BTC_USDC-27MAR26-50000-C
_INSTRUMENT_TOKEN_RE: re.Pattern[str] = re.compile(
    r"(?<![A-Z0-9_-])[A-Z]{2,6}(?:_[A-Z]{3,5})?-"
    r"(?:PERPETUAL|\d{1,2}(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\d{2}(?:-\d+(?:\.\d+)?-[CP])?)"
    r"(?![A-Z0-9_-])"
)

def _names_instrument(row: Mapping[str, Any], reason_raw: str) -> bool:
    name = row.get("instrument_name")
    if isinstance(name, str) and _INSTRUMENT_TOKEN_RE.fullmatch(name.strip()):
        return True
    return _INSTRUMENT_TOKEN_RE.search(reason_raw) is not None   # RAW reason: tokens are upper-case

def correction_is_trading(row):
    raw = _correction_reason_raw(row)
    reason = raw.lower()
    if _reason_contains_any(reason, _CORRECTION_CAPITAL_REASON_KEYWORDS):
        return False
    return _reason_matches_any(reason, _CORRECTION_TRADING_REASON_KEYWORDS) and _names_instrument(row, raw)
```
Why an anchored pattern and not `classify_instrument`: that function returns `option` for any name ending `-C` or `-P` (so `SUB-C` passes) and `linear_perpetual`/`inverse_perpetual` for anything ending `-PERPETUAL`. [VERIFIED: deribit_txn.py:160-195] It is a lenient classifier for market data, not a structural test on free text. The pattern above accepts exactly the shapes the module documents and rejects `BTC-PERP`, `BTC-PERPETUALS`, `FOO-C`.
Upper-case is required on purpose (the observed token is upper-case): a lower-case instrument fails loud, the safe direction.

### Shapes to fixture (one test per shape; each through `correction_is_trading` AND both aggregators `txn_rows_to_daily_records`, `txn_rows_to_native_daily`)
1. observed: `2026-07-15 BTC-PERPETUAL funding calculation correction`, `instrument_name` null: trading.
2. trading word, structured `instrument_name` set (`ETH-28MAR25-3000-C`), reason without a token: trading.
3. token variants in the reason: linear perpetual `BTC_USDC-PERPETUAL`, dated future, option: trading.
4. capital word plus instrument token (`transfer ... BTC-PERPETUAL funding ...`): not trading (denylist precedence kept).
5. **new headline**: capital reason with a trading token and no capital word, no instrument (`funding account correction`): not trading; both aggregators raise `LedgerValuationError` naming the reason.
6. trading word, no instrument, null `instrument_name`: not trading.
7. near-miss tokens (`BTC-PERP funding correction`, `BTC-PERPETUALS funding correction`, `SUB-C funding correction`): not trading. The last proves why `classify_instrument` is not enough.
8. instrument token, no trading word (`BTC-PERPETUAL adjustment`): not trading (conjunction; choice A6).
9. lower-case token (`btc-perpetual funding correction`): not trading.
10. blank or non-string `instrument_name` with a trading word: not trading; a non-string `info.reason` stays "" and not trading (existing test).
11. zero-change form of any non-trading shape is harmlessly ignored (existing convention).

### Existing tests that move
None changes expectation. Every existing negative stays negative (the new gate only narrows). The positive default `_correction_row()` carries `2026-07-15 BTC-PERPETUAL funding calculation correction` and stays trading. The existing capital, RT-01, non-string, unrecognized, and no-broadening tests keep their assertions. [VERIFIED: tests/test_deribit_txn.py:572-593, 596-860 read] Add new cases next to `test_correction_reason_gate_denylist_precedence_and_word_boundary`; do not edit old ones.

### Call sites (all in `services/deribit_txn.py` unless noted; read each)
`correction_is_trading` defined :924; `assert_correction_classifiable` :943-957 (message lists `_CORRECTION_TRADING_REASON_KEYWORDS`: update it to also say an instrument must be named); `_row_is_cash_bearing` :1085-1095 and `_row_is_native_cash_bearing` :1098-1108; the USD aggregator gate :1653-1659 and the native twin :2709-2715; the reference-set builder for `assert_balance_identity` :1967-1973 (a funding correction sits on both sides; a non-trading one is excluded). Outside the module: `services/deribit_ingest.py:55, 1602-1606` imports `_row_is_cash_bearing`. No other production caller (`grep` over `services routers scripts main*.py`). [VERIFIED by grep this session]

### Risk
Raw Deribit ledgers are not stored, so whether any PROD key holds a correction whose reason lacks an instrument token is `[ASSUMED]` false (A1). If wrong, that key's nightly derive fails permanently with `LedgerValuationError` after deploy and the new freshness arm (and the job-failure alerts) page. Founder accepted fail-loud (CONTEXT). Planner decision: whether to run a worker-side read-only census of correction reasons across Deribit keys before deploy (the pattern is `derivegaps_probe.py`) or accept; recommend a `checkpoint:decision`.

## FRESH-01: the 2026-11-26 PROD confirmation reading

A reading, run by the orchestrator through MCP after the 2026-11-26 nightly derive (the cron fires at `40 0 * * *` since the 2026-10-26 move, per `docs/runbooks/derivecron-go-live.md`; allow the backfill worker's latency before reading). Marker query first, one statement per call, letters for keys and books in everything tracked:
```sql
SELECT shobj_description(oid, 'pg_database') AS which_database
  FROM pg_database WHERE datname = current_database();
```
It must name PRODUCTION (CLAUDE.md). Then check, for the three logins D1, D2, D3 (identified by the orchestrator privately) with D4, the sibling account's key, as control:
1. `csv_daily_returns` (key mode): exactly one new row, dated 2026-11-25, per key; **no row** for any day 2026-10-27 through 2026-11-24; newest write after the 2026-11-26 nightly.
2. The `derive_broker_dailies` job for each key on 2026-11-26: `done`, `attempts` 1, `last_error` null.
3. `key_inputs`: `realized_terminal_day` is 2026-11-25; `tiny_base_days` still lists 2026-10-27 through 2026-11-24 and does **not** list 2026-11-25; `dropped_day_pnl` still holds those days; the 2026-11-09 flow is unchanged.
4. The three books' `equity_curve`: `computed_at` after the derive; `out_of_window_flow` no longer in `degrade_reasons`; if the remaining reasons are benign (`window_truncated`, `classified_rotation`) `is_trustworthy` flips to true. [prediction from the diagnosis: the flow dated 2026-11-09 is then inside the window]
5. The freshness arm: dispatch `prod-prober.yml` once (mode `probe`, no `arm` input) after the PR is deployed, or run its two statements by hand; expect 0 uncovered days on every key.
**Falsification:** if the 2026-11-25 row is absent, the diagnosis's tiny-base prediction failed (the 30-day window or a new flow moved the base), and FRESH-01 reopens, not closes. If a new deposit lands before 2026-11-26, record it and re-derive the prediction rather than reading it as a pass.

## Common Pitfalls

### Pitfall 1: field rename turns the arm silently green
**What goes wrong:** the writer renames or drops `realized_terminal_day` (or `tiny_base_days`); the SQL reads NULL; the judge sees "nothing to compare" for every key and reports GREEN forever.
**How to avoid:** the scope read counts keys that carry `realized_terminal_day`; `derived > 0` with none carrying it is a `measure-fail`; the new wiring `describe` binds each field name to the source line that writes it.
**Warning signs:** a green run whose log line says every key was "not judged".

### Pitfall 2: SQL guard scenario trips on harmless-looking text
The read-only scenario matches whole words anywhere in a `*_SQL` constant, comments and string literals included, and rejects any `;`. A column alias or comment containing `UPDATE`, `COPY` or `CREATE` as a word, or a trailing semicolon, fails the self-test. `created_at`/`updated_at` are fine (no word boundary after the verb).

### Pitfall 3: a missing `fixtureSql` default turns every full-registry scenario into a measure-fail
Seven scenarios build their own `fixtureSql` data with no freshness entry. The default branch must answer a valid GREEN reading for both statements.

### Pitfall 4: public output
The defect table is copied verbatim into a public GitHub issue. Return no `api_key_id`, no allocator id, no amount. The `tag` is the first eight hex characters of an md5 of the key id: it lets an operator match a row with a one-line query and is not an identifier. Subject shape `<venue>#<tag>`. [A7: the tag is a design choice; planner may prefer venue plus ordinal only.]

### Pitfall 5: non-atomic writes
`key_inputs` and `csv_daily_returns` are two writes with no transaction (the compose documents it: allocator_equity_derive.py:1926-1930). A read between them shows inputs one derive newer than returns, by at most one day. The bound of 2 absorbs it; do not tighten it without re-reading this.

### Pitfall 6: a reason that exists but does not cover
`anchor_null_reason` is accepted whole by the ruling, including `balance_error`, which is a transient read failure and can persist for as long as the read keeps failing. That is the founder's rule as written; O2 records the question.

### Pitfall 7: oracle self-reference
An oracle that imports the arithmetic it judges agrees by construction (the `mt5_soak.py` header says so). Keep the independence scan, keep the constants as literals with a test-side parity pin, and make the RED proofs mutate the oracle's own identity, not just its inputs.

### Pitfall 8: unreproducible-and-published days
See "Read this first" item 1. Do not widen tolerance or add a plausibility bound to make days "explained".

### Pitfall 9: workflow text pins
Editing the workflow header must keep the softening-token scan clean and must not touch the step-name prefix or the probe-step status-capture lines (`|| status=$?` appears twice in code; both anchors are pinned).

## Code Examples

### Self-test table entry (shape from the existing entries)
```js
// Source: scripts/prod-prober/run.mjs:1133-1168 (the cron-drift entry), adapted
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
### fixtureSql default-green branch (shape)
```js
// Resolved by the table a statement reads; distinct tokens per statement; GREEN when data.freshness is absent.
if (q.includes("compute_jobs") && q.includes("key_inputs:")) { /* render rows with the same separators the arm asked for */ }
```
### Oracle core (shape; stdlib only; values from the verified identity)
```python
def roll_levels(pnl, flows, terminal_day, terminal_usd, days):  # days: sorted ISO list
    level = {days[-1]: terminal_usd}                     # terminal sits on max(W)
    for i in range(len(days) - 1, 0, -1):
        t = days[i]
        level[days[i - 1]] = level[t] - flows.get(t, 0.0) - pnl.get(t, 0.0)
    return level

def book_return(day, prev_day, keys):                    # keys: per-key dicts of level, pnl, dropped
    num = den = 0.0
    for k in keys:
        if day in k["dropped"] or prev_day not in k["level"] or day not in k["level"]:
            continue                                      # sits out: named missing_return_inside_coverage
        num += k["pnl"].get(day, 0.0); den += k["level"][prev_day]
    return (num / den) if den > 0.0 else None             # None: skipped_nonpositive_denominator
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Blanket `correction` as cash-bearing | Per-row on `info.reason` with a capital denylist first | Phase 128, 2026-07-19 | 233 adds the instrument-naming conjunct |
| Freshness inferred from derive job status | Compare stored returns with stored inputs | this phase | A job can read `done` while a held tail sits behind it (the diagnosis) |
| Prober of four arms | Five, floor 5 | this phase | pins listed above |

**Deprecated/outdated in this repo's own text:** the `prod-prober.yml` header and `run.mjs` comments that say FOUR; `docs/runbooks` mentions of the arm list are cross-references only.

## Project Constraints (from CLAUDE.md)

- **CHANGELOG discipline:** every ship writes an entry before the push, in the same commit as the VERSION bump (`chore(release): vX.Y.Z.B ...`); VERSION and `package.json` byte-equal 4-digit strings; never run `npm version`. Map every commit to a bullet. Name the closed `TODOS.md` entries.
- **TODOS.md holds open work only:** the ship deletes the entries it closes in the same PR: `[185-BOOK-CUMULATIVE-UNEXPLAINED]` (TODOS.md:1326) and the `Deribit correction residual` bullet (TODOS.md:1941). Fix any pointer to them in the same PR. LOW and Info review survivors are not booked.
- **Never write a skip-CI token** (the five bracketed forms and `skip-checks:true`) in any commit message or PR body, not even to deny it.
- **gitleaks:** never quote a credential-shaped literal in CHANGELOG prose; a push-to-main scan sees one squash commit.
- **Completion is historical:** a VERIFICATION uses `verified_at_sha` and `drift_subjects`; `covered_digest` and `covered_files` are banned. Never list `TODOS.md`, `CHANGELOG.md`, `VERSION` or `package.json` in `drift_subjects`. After any verifier run, convert the pair.
- **Ship branch changes nothing under `.planning`** (ship-planning guard); the SUMMARY lives on the planning side.
- **Public repo with tracked `.planning/`:** no secrets, PROD ids, home paths or account numbers in tracked text; letters for keys and books; never quote a search pattern as proof of absence.
- **No AI authorship attribution trailers** in commits or PR bodies (founder memory 2026-10-20).
- **Marker query before any PROD statement**; PROD reads via MCP first, one query per call, never chained.
- **Money-math oracles import no production helper; every gate must be seen to fail** (neuter, RED, restore from a byte backup, GREEN).
- **No migration here.** If one appears, stop and tell the coordinator.
- **AGENTS.md:** "This is NOT the Next.js you know" applies to app code; no app code is touched in 233.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | PROD Deribit ledgers hold no correction whose reason lacks an instrument token other than rows that already fail loud. Raw ledgers are not stored, so this was not measured. | DBOOK-02 Risk | After deploy a key's nightly derive fails permanently; the freshness arm and job alerts page. Needs founder confirmation or a worker-side census (`checkpoint:decision`). |
| A2 | `strategy_analytics` and the strategy-mode derive store no per-strategy flow day, anchor day or terminal day. Read: the `strategy_analytics` column list and the key-mode-only epilogue; not read: every strategy-mode writer. | FRESH-02 strategy mode | If a stored field exists, strategy series could be covered now instead of routed. Low cost: reversible arm logic. |
| A3 | The compose's counted key set cannot be recovered from the stored payload beyond `inputs.n_keys` and the three named exit lists. | DBOOK-01 | If a field exists the oracle could drop its declared-input fallback. |
| A4 | `composed_day_pnl` in `key_inputs` already includes the marked-era P&L (`M_d - base - F_d`, zero on gap days), so `r = P / L_{t-1}` holds after `marks_since`. The mark apply rules were read; the stored array's marked content was not measured. | DBOOK-01 | Marked-era days would be unreproducible; they would be named, which raises the withheld count and may widen O1. |
| A5 | The prober's session role bypasses RLS on `allocator_equity_derived` and reads `compute_jobs`, as the account-truth census role does. Not exercised here. | FRESH-02 SQL | The first live run reads zero rows and the scope guard reports `freshness-no-scope` (loud, not green). Verify by one prober run (dispatched or scheduled) after merge. Corrected at plan time: an MCP read runs under another role and cannot prove the prober role's read, so it never counts for A5; plan 233-06 step 6a and its ship handoff own the proof. |
| A5b | "Flow-adjacent" means a non-zero composed flow on day `t` for a key in that day's set. | DBOOK-01 | Naming differs from the founder's intent; annotation only, nothing is nulled. |
| A6 | A correction is trading only if a trading word AND an instrument are both present (conjunction), not an instrument alone. | DBOOK-02 | If the founder meant instrument alone, `BTC-PERPETUAL adjustment` would also classify trading. CONTEXT says "Matching a trading word is not enough", which does not say whether a word is still needed. Narrower is the safe direction. |
| A7 | The `tag` (first eight hex of an md5 of the key id) is acceptable in a public issue. | FRESH-02 | If not, use venue plus ordinal only. |
| A8 | `compute_jobs` `done` rows survive at least 3 days (retention deletes `done` rows older than 30 days: `supabase/migrations/20260515113853_retention_crons_safe.sql:188-199`); a 3-day window is therefore safe. Read. Marked [VERIFIED] for the retention, [ASSUMED] that no later migration shortened it. | FRESH-02 | An empty scope reads as `freshness-no-scope`. |

## Open Questions (RESOLVED)

Each question below is settled by the plan named on its RESOLVED line (dispositions recorded 2026-11-24 at plan time; the question text is kept as written).

1. **O1: the oracle's counted-key set.** The compose picks one login per shared account and applies stitch, departed and exit rules from `api_keys` state at compose time. What is unclear: how many of those cases occur in the founder's book. Recommendation: first export the keys' share/active fields and the payload's exit lists; if the declared set equals `inputs.n_keys` and no stitch or exit boundary falls on a book day, the oracle is exact; otherwise name the affected days `key_set_not_reproducible` and report the count to the coordinator before closing DBOOK-01.
   **RESOLVED (plans 233-03 and 233-05):** the counted set is a declared input checked against `inputs.n_keys`; a mismatch, or an unreproduced day on a declared departure or stitch boundary, is withheld `key_set_not_reproducible` and the verdict is STOP (233-03 Task 2); the reading (233-05 Task 3) turns a STOP into a founder question and DBOOK-01 closes only on CLEAN or the founder's Accept.
2. **O2: should `anchor_null_reason = balance_error` cover a stale gap?** The ruling says any non-null reason covers. A persistent transient read failure would silence a stale series for as long as it lasts. Not changed (locked). Recommend recording it in the SUMMARY as a known limit.
   **RESOLVED (plan 233-02):** accepted as a known limit under the locked rule; recorded in `233-02-SUMMARY.md` `## Known limits` and carried into the CHANGELOG entry by plan 233-06's ship handoff.
3. **O3: keys with no returns, or with no `key_inputs` row.** The rule has nothing to compare for a brand-new key (fewer than two history days stores inputs and no returns). Recommendation: log and do not page; the scope read still counts them.
   **RESOLVED (plan 233-02):** such keys are counted and logged, never paged (`judgeFreshness` and the outcome log line; the GREEN control holds both shapes); recorded in `## Known limits`.
4. **O4: unreproducible-and-published days (Read this first, item 1).** Founder question if any appear.
   **RESOLVED (plans 233-03 and 233-05):** any withheld published day makes the verdict STOP (233-03 Task 2); plan 233-05 Task 3 turns a STOP into an AskUserQuestion (Accept, or Route to Phase 234 as a seam S2 change) and records the answer in CONTEXT.md and the ROADMAP; published history is unchanged either way.
5. **O5: pre-deploy correction census (A1).** Run it or accept.
   **RESOLVED (plan 233-01):** accepted, not run (the census needs a founder go for a Railway start-command swap); an unobserved instrument-less correction fails that key's derive loud after deploy and surfaces on the job-failure path; recorded in `233-01-SUMMARY.md` `## Known risk (A1)` and carried into the CHANGELOG entry.
6. **O6: strategy-mode routing.** Where the recorded gap is routed (v1.23 HARDEN line, TODOS line, or SUMMARY only).
   **RESOLVED (plans 233-02 and 233-06):** strategy-mode series stay outside the arm (its header and `## Known limits`); the ship step adds the TODOS entry `[233-STRATEGY-FRESHNESS-UNWATCHED]`, text verbatim in plan 233-06's ship handoff.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| node | prober self-test, vitest | yes | v25.8.1 (CI uses 22; the self-test and arms use `node:` built-ins only) | - |
| npm / `node_modules` | vitest wiring tests, `npm run lint` | node_modules **absent** in this worktree | npm 11.11.1 | executor runs `npm ci` |
| psql | arm SQL by hand, MCP fallback | yes | present at /opt/homebrew/bin | MCP read path |
| gitleaks | pre-push scan of new files | yes | 8.30.1 (the version the repo config was measured with) | - |
| Python for analytics-service | pytest, mypy | **no repo venv in this worktree**; system python3 3.14.3, ccxt 4.5.64 | CI uses 3.12; the pin is `ccxt==4.5.89` (`analytics-service/requirements.txt:33`) | executor builds a venv from `requirements.txt` plus `requirements-dev.txt`; another checkout's venv holds ccxt 4.5.85 and must not be used |
| PROD database | readings | not reachable from this agent | - | orchestrator MCP reads |

**Missing with no fallback:** none. **Missing with fallback:** `node_modules` (npm ci), the Python venv (build with ccxt 4.5.89).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | prober self-test (node, fixtures); vitest (wiring); pytest (analytics-service) |
| Config file | `scripts/prod-prober/run.mjs --self-test`; `package.json` `"test": "vitest run"`; `analytics-service/pytest.ini` (`testpaths = tests`, `pythonpath = .`) |
| Quick run command | `node scripts/prod-prober/run.mjs --self-test`; from `analytics-service/`: `pytest tests/test_deribit_txn.py tests/test_deribit_book_oracle.py -q` |
| Full suite command | `npx vitest run`; from `analytics-service/`: `pytest -n auto --dist loadgroup --cov=services --cov=routers --cov=main_worker --cov-report=term-missing --cov-fail-under=80` (Makefile `test`; some tests need the local-stack lane, CI runs the full suite) |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? | RED-first proof |
|--------|----------|-----------|-------------------|-------------|-----------------|
| FRESH-02 | held-back series end pages; gap <= bound, stated days, reason all pass | prober self-test | `node scripts/prod-prober/run.mjs --self-test` | new fixtures, Wave 0 | neuters (a)-(e) above, RED names `freshness-stale fires on <fixture>` |
| FRESH-02 | registry has 5 arms, floor 5, kinds roster, scenario count | vitest | `npx vitest run src/__tests__/prod-prober-wiring.test.ts` | exists, edited | set `ARMS_FLOOR` back to 4: `toBe(5)` reds |
| FRESH-02 | arm never blocks CI | vitest | same file, `D-18` test | exists | add `prod-prober` text to a `ci.yml` copy in a calibration: the pin reds |
| FRESH-02 | field names bound to their writers | vitest (new describe) | same file | new, Wave 0 | rename a payload key in a source copy: reds by name |
| DBOOK-01 | oracle reproduces stored book returns from P&L and flows | pytest | `pytest tests/test_deribit_book_oracle.py -q` | new, Wave 0 | neuter the identity (use `L_t` for `L_{t-1}`): the explained fixtures red |
| DBOOK-01 | every unexplained day carries a closed-set reason | pytest | same | new | return `explained` for all: the withheld fixtures red |
| DBOOK-01 | capital-outside-base days are annotated, never nulled, published value unchanged | pytest | same | new | null the annotated day: the unchanged-cumulative assertion reds |
| DBOOK-01 | imports no production helper | pytest (AST scan) | same | new | add `from services...` import: scan reds |
| DBOOK-01 | vacuity guard (zero or tiny explained share exits non-zero) | pytest | same | new | remove the guard: the all-withheld fixture exits 0 and reds |
| DBOOK-02 | each correction shape classifies as designed; both aggregators raise on non-trading | pytest | `pytest tests/test_deribit_txn.py -k correction -q` | exists, edited | revert `correction_is_trading` to the old body: shape 5, 6, 7 reds |
| FRESH-01 | the 2026-11-26 reading | manual reading (not code) | MCP, see reading section | - | falsification clause |

### Sampling Rate
- **Per task commit:** the quick run for the file touched.
- **Per wave merge:** vitest for the prober wiring plus the touched pytest files.
- **Phase gate:** everything under "Pre-push gates" green before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `scripts/prod-prober/fixtures/freshness/*.json` and `arms/freshness.mjs`: covers FRESH-02
- [ ] `analytics-service/scripts/deribit_book_oracle.py`, `tests/test_deribit_book_oracle.py`, `tests/fixtures/deribit_book_oracle/*.json`: covers DBOOK-01
- [ ] new correction-shape tests in `tests/test_deribit_txn.py`: covers DBOOK-02
- [ ] `npm ci` and a Python venv with ccxt 4.5.89 in the worktree

## Pre-push gates the executor must run

1. `node scripts/prod-prober/run.mjs --self-test` (prints `SELF-TEST PASSED: N/N`; N equals `SELF_TEST_SCENARIOS`).
2. `npx vitest run src/__tests__/prod-prober-wiring.test.ts src/__tests__/prod-prober-incident.test.ts src/__tests__/gitleaks-allowlist.test.ts src/__tests__/critical-regressions.test.ts` (the last asserts VERSION and `package.json` are byte-equal 4-digit strings), plus the whole-tree invariants: `src/lib/*.invariant.test.ts` and `src/__tests__/*invariant*`, `src/lib/seam-log-coverage.test.ts`, `src/__tests__/contracts/ci-mypy-strict-surface.contract.test.ts`, `src/__tests__/check-planning-hygiene.test.ts`. None of these touch Python or the prober, but they are the repo's standing whole-tree gates.
3. From `analytics-service/` with ccxt 4.5.89 installed: `pytest tests/test_deribit_txn.py tests/test_deribit_book_oracle.py -q`; then the CI-shaped run `pytest -n auto --dist loadgroup --cov=services --cov=routers --cov=main_worker --cov-report=term-missing --cov-fail-under=80` as far as the lane-free subset allows (CI runs it against the local-stack lane).
4. Strict mypy, exact CI command from `analytics-service/`: `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`. It covers `services/deribit_txn.py`; it does not cover `scripts/` or `tests/`.
5. `npm run lint` (ends with `tsx scripts/check-planning-hygiene.ts`; ESLint covers `src/` only).
6. `gitleaks detect --no-git --config .gitleaks.toml` over the new fixture and arm files, then the CI range scan form for the branch.
7. Before the PR: CHANGELOG entry and VERSION bump per the CHANGELOG discipline; `TODOS.md` deletions named; confirm the ship branch changes nothing under `.planning`.

## Security Domain

`security_enforcement` is absent in config, so it is treated as enabled.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | no auth surface added; the arm reuses the existing DB credential |
| V3 Session Management | no | - |
| V4 Access Control | yes | arm reads with the existing prober role; SQL is SELECT-only and the self-test scenario enforces it |
| V5 Input Validation | yes | the arm validates every stored day as strict ISO and every venue as a short token before use; the classifier validates `info.reason` and `instrument_name` types |
| V6 Cryptography | no | `md5` is used only to derive a non-secret display tag, not for any security purpose |
| V7 Error handling and logging | yes | defect text carries days and counts only; no id, amount or credential; the scrubber redacts credential values |
| V8 Data protection | yes | public issue body: no key id, allocator id, amount; oracle output uses letters, dates and 3-significant-figure ratios |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Identifier leak into a public GitHub issue or tracked SUMMARY | Information disclosure | no id in SQL output; letters in tracked text; redaction contract on the oracle emitter |
| Credential echoed through psql stderr | Information disclosure | existing seam redaction to one line |
| Write through the prober's connection | Tampering | SELECT/WITH-only constants, no `;`, enforced by the read-only self-test scenario |
| Capital adjustment summed as trading P&L | Tampering (money integrity) | capital denylist first, then trading word AND structural instrument; fail loud otherwise |
| Silent-green monitor | Repudiation / integrity | scope guard, out-of-band count, a RED fixture per rule, PROOF-01 neuters |
| Credential-shaped fixture or identifier tripping gitleaks | - | no `key` identifier beside a value; scan before push |

## Sources

### Primary (HIGH confidence; all in this repo, read this session)
- `.planning/phases/233-.../233-CONTEXT.md`, `.planning/debug/deribit-stale-returns.md`, `.planning/REQUIREMENTS.md` (DBOOK/FRESH/PROOF-01), `.planning/ROADMAP.md` (Phase 233 incl. the deviation note, Phase 234 Q2 note), `CLAUDE.md`, `AGENTS.md`, `.planning/config.json`.
- `scripts/prod-prober/run.mjs`, `arms/cron-obs.mjs`, `arms/cron-drift.mjs` (registration, marker, SQL parsing), `seams.mjs`, `incident.mjs`, `fixtures/**` (layout), `.github/workflows/prod-prober.yml`.
- `src/__tests__/prod-prober-wiring.test.ts` (pins), `.gitleaks.toml`, `scripts/accounttruth-census.mjs`.
- `analytics-service/services/allocator_equity_compose.py`, `allocator_equity_derive.py`, `job_worker.py` (derive epilogue, compose job), `nav_twr.py`, `nav_marks_apply.py`, `native_nav.py`, `tiny_base.py`, `deribit_txn.py`, `analytics_runner.py`, `tests/test_deribit_txn.py`, `scripts/mt5_soak.py`, `scripts/derivegaps_probe.py`.
- `supabase/schema/baseline.sql` (table definitions), `supabase/migrations/20260515113853_retention_crons_safe.sql`, `docs/runbooks/derivecron-go-live.md`, `TODOS.md` (the two entries), `.github/workflows/ci.yml:5739-5740`, `analytics-service/Makefile`, `analytics-service/pytest.ini`, `analytics-service/pyproject.toml`.

### Secondary / Tertiary
- None. No web source was used.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new dependency; every seam read.
- Architecture (arm, pins, classifier): HIGH - each site read; counts regenerated by the executor.
- DBOOK-01 oracle: MEDIUM - arithmetic verified against the code; the counted-key boundary (A3, A4, O1) and the PROD data are not.
- Pitfalls: HIGH for the prober and classifier, MEDIUM for the oracle.

**Research date:** 2026-11-24
**Valid until:** the next change to `scripts/prod-prober/run.mjs`, `allocator_equity_compose.py` or `deribit_txn.py` on main (re-read the cited symbols before planning if any of them moved); otherwise 30 days.
