# Phase 155: PARITYHARNESS - Research

**Researched:** 2026-11-13 (repo HEAD `731ab87eb`, worktree of `main`)
**Domain:** a read-only parity harness for an existing MT5 ingestion pipeline: SELECT-only PROD census and capture, provenance-locked oracle intake, a pure fail-closed compare engine, a data-layer surface matrix
**Confidence:** MEDIUM. Repo facts are HIGH (opened this session). The MT5 Report format is LOW (undocumented, nothing measured). Nothing in PROD was queried.

> Public repo: account labels only (MM2, MM3, FX-AI_V). No login, server name, amount, PROD id or home path appears here. Code is cited as `path::symbol`, never by line number.
>
> **Provenance note (deviation from the role rule, stated once).** Most definition sites below were first read with `cat`/`sed`; the discrete values that feed skeletons (table columns, bucket constants, guard keys, `WRITE_WORDS`, deal-type sets, venue sets) were then re-opened with `Read`. `[VERIFIED]` below carries `path::symbol` plus the quoted value at HEAD `731ab87eb`, not a line range, because the brief says to cite by symbol.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Founder decisions (LOCKED — AskUserQuestion, 2026-11-13, relayed by the coordinator)**

- **MT5-09 surface list: "All live surfaces."** The matrix covers every live surface that renders these strategies' performance:
  - the **factsheet**, including its **share card** and the **factsheet PDF**;
  - the **allocations book** that includes these strategies;
  - the **scenario composer**, where these strategies are included;
  - **browse/list cards**.
  The planner cites each surface **by symbol** (the function or loader that computes what it renders), never by line number. Already dropped as dead: the portfolio PDF (retired in Phase 195 TRIM) and `scenario-blend-panels.ts` (deleted).
- **Clock mismatch: "Refuse + alert."** In the product (155.1), the account's update is refused with a named error plus an `ops_alert`, and a mis-bucketed day is never written. **In this harness**, a clock mismatch, or a one-hour shift of an input, is a RED verdict carrying a named finding. The harness never auto-corrects a clock.
- **Shared server: "Not sure — measure it."** The census and the clock reading record each account's server as a **hashed label only**, never the name. If the servers differ, a per-server clock comes before parity.
  - Consequence for 155: the server travels inside the encrypted credential, so SELECT cannot read it. The 155 census records the server field as `unmeasured (155.1 reading owns it)` and never guesses.
  - If any stored column does expose a server identity, the census hashes it (sha256, truncated) and records only the hash.
- **Publishing: "No change."** MT5 strategies stay unpublished and not advertised until 155.2 passes. Surface checks use only the views the signed-in founder can already see: the owner's own factsheet and allocations views.
  - Where a surface shows only published strategies (browse cards, the catalog side of the composer), the matrix records it as **"not rendered while unpublished"**. That is an observation, not a failure, and the surface is never published to get a reading.
- **D-A..D-E in REQUIREMENTS.md stay binding:**
  - D-A: pre-`S` days are judged on a closed-P&L basis by Gate A; the open-P&L 1% applies from `S` on (Gate B); the harness never invents marks.
  - D-B: the 1% is a return gap in points, `|ΔE_ours − ΔE_oracle| / E(window start)`. It is checked separately for cumulative return, start level and end level, in ONE constant `MT5_PARITY_TOLERANCE = 0.01`.
  - D-C: broker statements are the historical-equity oracle.
  - D-D: the narrow clock read belongs to 155.1, not here.
  - D-E: the weekend reading is one Gate B edge.

**Harness architecture (recommended defaults, accepted in autonomous mode)**

- **Capture once, compare offline.** Following research and ARCH:
  - versioned capture SQL lives in `docs/runbooks/mt5-parity/`, one read-only statement per file, with `marker.sql` first (the marksource census precedent);
  - a vitest write-keyword gate asserts that no file contains a write or DDL keyword. It is shown RED by neutering a copy, then restored from a byte backup;
  - the compare engine is a **pure** Python module (`analytics-service/services/mt5_parity.py`, the `parity_diff.py` precedent): no DB, no socket, no gateway import;
  - a test pins that the module imports nothing from `mt5_client`, `mt5_read`, `mt5_soak` or any DB client.
- **Closed taxonomy, fail-closed:** `within_tolerance`, `pre_mark_realized_basis`, `edge_instant_mismatch`, `flow_placement`, `annualization_convention`, `withheld_by_gate`, `clock_mismatch`, `unexplained`.
  - `unexplained` is reached only by explicit non-match, never by fallthrough.
  - Only `within_tolerance`, and a `withheld_by_gate` applied consistently on every surface, pass on their own. Every other bucket is RED until a founder ruling is recorded (in 155.2).
- **Provenance enum** on every expected value: exactly `terminal_reading`, `terminal_report_export` or `broker_statement`.
  - The intake refuses any other value by name. Refusal tests use at least `gateway`, `mt5_soak.reconcile_parity`, `quantalyze` and an empty value.
- **Gate A / Gate B split** per D-A and research C5:
  - Gate A: pre-`S`, realized-balance basis, against the Report's deal ledger.
  - Gate B: from `S`, equity at two edges, Friday-close, flow-free preferred, against statements or weekend readings.
  - The window picker refuses an edge before `S` for Gate B, and refuses any window that ends on or after the run day.
- **Report parser:** stdlib `html.parser` + `codecs` (research C4), no XLSX.
  - It detects the UTF-16 BOM and parses columns by header text.
  - It fails loud on an unknown header, a missing required header, or a duplicate header.
  - It is tested on a synthetic UTF-16 fixture committed under the test tree. The fixture holds no real account data.
- **Worksheet:** a YAML or JSON file the founder fills in. The intake fails loud if any reading the founder-session script asks for is missing.
  - The script and the worksheet schema share ONE list of required readings, so they cannot drift.
- **Inception identity:** the ledger, rolled back past the first deal, comes to about 0. It is reported as a ratio to the first deposit, never as an amount.

**Capture, redaction and PROD access**

- **PROD reads only through the Supabase MCP**, run by the phase orchestrator, with the marker query first in every session.
  - Executor subagents have no MCP access and must not use the CLI or Keychain against PROD.
  - So every plan that needs PROD figures splits into two parts: the executor writes and tests the SQL and the loader, and an orchestrator checkpoint task runs the SQL via MCP and drops the raw result into the capture directory.
- **Capture directory:** `/.mt5-parity/` at the repo root, gitignored. This phase adds the `.gitignore` line, and a test pins it.
  - Raw figures (amounts, timestamps tied to amounts, ids) never leave it.
  - Each capture is sealed with canonical JSON (`allow_nan=False`) plus a sha256.
- **Tracked record:** account labels, ordinals, day counts, ratios to 3 significant figures, verdicts and taxonomy buckets only.
  - Not tracked: logins, servers, amounts, PROD UUIDs or `key_id`s.
  - Accounts map to labels through a gitignored mapping file in the capture directory.
- **No gateway call, no derive or sync enqueue, no `_compute_portfolio_analytics` call**, from any code or task in this phase.

**RED proofs and dress rehearsal**

- **Three broken inputs,** each applied to a byte copy of the synthetic oracle or the capture:
  1. a reclassified BALANCE deal (a deposit relabelled as trading P&L, or the reverse);
  2. a one-hour clock shift on deal times;
  3. the oldest deal dropped.
  Each must flip the per-account verdict to RED, with the expected bucket named. After a byte-backup restore, the verdict must be GREEN again.
  - These run as automated tests (synthetic) AND once by hand in the phase record against the dress-rehearsal inputs.
- **Dress rehearsal:** synthetic oracle files plus a REAL PROD capture produce a per-account verdict document.
  - The expected outcome is RED/`unexplained` or `pre_mark_realized_basis` wherever a synthetic oracle disagrees with real data. The rehearsal proves the pipeline runs end to end. It proves nothing about parity.
  - The tracked verdict document holds labels, buckets and ratios only.

**MT5-09 matrix and MT5-15 classification**

- **The data layer only in 155:** for each account, the matrix runs each surface's own TS or Python computation, cited by symbol, on its own stored input column, and compares the headline figures across surfaces.
  - The render layer (founder Chrome) is 155.2.
  - A surface that cannot render an unpublished strategy is recorded as such (see Publishing).
- **MT5-15:** every `data_quality_flags` value these accounts carry is read from stored rows and classified into one of three: explained-and-acceptable (needs founder sign-off in 155.2), a defect (becomes a named finding with a root-cause lead), or unknown (also a finding).
- **Findings** go into one tracked findings ledger in the phase directory, for MT5-10 in 155.2. Each finding has an id, the surface or flag, the account label, the bucket and the root-cause lead. Nothing is fixed in 155.

### Claude's Discretion

- The exact module and file split for the intake, engine, picker and capture loader.
- The worksheet format (YAML or JSON), as long as stdlib or an already-locked dependency parses it.
- The test framework placement: pytest from `analytics-service/` for Python, and vitest for the SQL keyword gate and the `.gitignore` pin.
- How the data-layer surface matrix invokes the TS computations: a vitest harness reading the sealed capture is the default.

### Deferred Ideas (OUT OF SCOPE)

- Live server-clock reading and the per-server clock if the servers differ: Phase 155.1 / parked MT5SERVERLEARN.
- Render-layer MT5-09 gate, the founder session, the MT5-10 fixes and the MT5-15 sign-offs: Phase 155.2.
- Publishing MT5 strategies or a "verified" badge: out of milestone scope until 155.2 passes.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PARITY-01 | Every expected value carries provenance exactly `terminal_reading`, `terminal_report_export` or `broker_statement`; any other source (our gateway, `mt5_soak.reconcile_parity`) is refused by name | Pattern 2 (intake, synthetic flag), Pattern 3 (parser contract), Report slice B, `## Validation Architecture` PARITY-01 rows |
| PARITY-02 | Harness RED on a reclassified BALANCE deal, a one-hour clock shift, a dropped oldest deal; GREEN after byte-backup restore, proven in the phase record | Pattern 4 (legs, counterfactual explainers, fixture designed backward from the three mutations), Pitfalls 1-3, engine-reuse slice D |
| PARITY-03 | Our side captured read-only from persisted PROD rows by versioned SELECT-only SQL behind a write-keyword test; raw figures untracked | Capture slice C (file set, real-DDL exec test, superset keyword gate), PROD-access slice E, Pattern 1 |
| PARITY-04 | Pre-flight census per account: first mark day `S`, open P&L at Friday edges, stored flags, unit, published status, record length, `computed_at`, inception identity | Capture slice C census files, `S` has three stored sources, inception identity from `key_inputs:<api_key_id>` rows |
</phase_requirements>

## Project Constraints (from CLAUDE.md, AGENTS.md, memory)

- **Public repo with `.planning/` tracked:** no secrets, PROD ids, home paths or account numbers in tracked text (CLAUDE.md, memory). A repo-owned redaction scan is recommended (Pitfall 9).
- **PROD:** the CLI in the main checkout is linked to PROD; marker query first, every time; the executor never touches PROD (CONTEXT). PROD reads go through the Supabase MCP, one query per call, never chained (memory).
- **Data-integrity gates must be able to fail:** neuter, see RED, restore from a byte backup, never `git checkout`/`restore`/`stash` on uncommitted work (memory).
- **Analytics:** pytest only from `analytics-service/`; never `importlib.reload` in tests; CI mypy strict over `services/` (so `services/mt5_parity*.py` is inside the strict surface); a brief for any analytics-touching task must carry the mypy gate (memory).
- **Always `grep -a`** (the UTF-16 fixture holds NUL bytes); a new `supabase/tests` file is NOT created here (no migration, no SQL test corpus change).
- **Every ship writes a CHANGELOG entry and moves `VERSION` and `package.json` byte-equal** (CLAUDE.md). The phase touches non-planning paths (`docs/`, `analytics-service/`, `src/__tests__/`, `.gitignore`), so it is a ship with a version bump.
- **Never write the CI-skip trailer tokens in a commit or PR body**, not even to deny them (CLAUDE.md).
- **No AI authorship trailers** in commits or PRs (memory, founder 2026-10-20); that rule takes precedence over the attribution reminder.
- **A ship branch must change nothing under `.planning/`** (memory); the findings ledger, census record and verdict document live under the phase directory and travel on the records PR, not the ship branch.
- **Plans cite code by symbol:** the `plan-anchor-verify` CI job re-resolves `file:line` anchors in pending PLAN.md files and fails on a miss (`scripts/verify-plan-anchors.mjs`).
- AGENTS.md (Next.js version note) does not bind this phase: no route, page or component is touched.
- No banned package (CLAUDE.md table) is involved; no package is added.

## Summary

Phase 155 builds no product. It builds a tool that tries to prove the MT5 numbers wrong, and it must be shown able to fail. The shape the milestone research chose holds up against the code read this session: capture once from persisted PROD rows with SELECT-only SQL (orchestrator runs it through the MCP), compare offline in a pure Python engine, keep raw figures in a gitignored directory, track only labels, ordinals, 3-significant-figure ratios and buckets. No new package is needed; the Python stdlib, the already-pinned pandas/numpy, and the existing vitest/pg-lane machinery cover everything.

Six findings from this research change what the planner would otherwise assume, and each is stated as a decision below:

1. **Two of the "published only" claims in the milestone ARCHITECTURE.md are wrong at HEAD, and one is imprecise.** The composer's lazy route (`GET /api/strategies/[id]/returns`) uses `withPublishedOrOwner`, so the owner's unpublished MT5 strategy IS readable there. The owner's own `/strategies` list renders unpublished strategies through `getMyStrategies` and `StrategyTable`; only the Discovery list (`getStrategiesByCategory`, `withPublishedOnly`) is published-only. The share card (`/api/og/factsheet/[id]`) and both factsheet PDFs are `withPublishedOnly`. Ignore ARCH Pattern 5 on these points; the matrix table in slice A is the corrected list.
2. **"Strategy detail" no longer exists as a page.** `(dashboard)/strategies/[id]/` holds `edit/` and a guard `layout.tsx` only; `/factsheet/[id]` is `export { default, generateMetadata } from "./v2/page"`. Record it as re-located to the factsheet, not as a separate row.
3. **The deal ledger is not stored, but our side's inception identity and per-day P&L are.** A key-mode derive upserts `allocator_equity_derived` with `kind = "key_inputs:" + api_key_id`, carrying `composed_day_pnl`, `composed_flows`, `realized_terminal_usd/day`, `anchor_usd`, `marks_since`, `nav_mark` (all quoted in slice C). That row exists only for keys that had a key-mode derive (`is_key_mode = bool(job.get("api_key_id"))`), so the census must report its presence per key and never assume it.
4. **The RED proofs cannot be bolted on after the fact; the fixture must be designed backward from the three mutations.** The terminal-anchored roll means a dropped oldest deal moves no later level, so a window-return or level compare stays GREEN. RED for it must come from the inception identity being a verdict input. A one-hour shift only bites if a fixture deal sits within an hour of a UTC midnight inside the window. The taxonomy has no truncation bucket; recommendation: `unexplained` with a reason code (Open Question 1).
5. **Two importable-looking modules are not importable by the engine.** `services.nav_marks` and `services.allocator_equity_derive` reach `services.db` and `services.mt5_client` transitively (AST closure measured this session). `broker_dailies`, `nav_twr`, `nav_marks_apply`, `mt5_deals`, `mt5_server_clock`, `account_unit`, `wealth_returns` and `parity_diff` are clean.
6. **The capture SQL can run against the REAL baseline DDL, not hand-typed stand-ins.** Verified: the ten `CREATE TABLE` blocks the capture touches, extracted verbatim from `supabase/schema/baseline.sql`, apply cleanly on a bare `initdb` PostgreSQL 16.13 cluster. A column-contract test then costs nothing and cannot drift from the schema.

**Primary recommendation:** build the engine around three legs (cumulative return, start level, end level) plus an inception-identity precondition and a per-day placement diagnostic, classify any breach only by an explicit counterfactual re-run (flip a BALANCE row, shift the clock, swap the DST rule, add the open P&L), and design the synthetic fixture so each of the three mutations flips exactly one named leg.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Census and capture SQL (SELECT only) | Database / Storage (PROD, read via MCP by the orchestrator) | Local FS (gitignored capture dir) | Our side is persisted rows; nothing is recomputed or enqueued |
| Write-keyword gate, `.gitignore` pin, redaction scan | CI (vitest, static) | — | The only automated guard on a runbook the orchestrator runs under standing PROD-read authorization |
| Capture exec test | CI (vitest + throwaway local PostgreSQL via pg-lane binaries) | — | Executes the committed statements on real baseline DDL; never TEST, never PROD |
| Report parser, worksheet intake, provenance refusal | API / Backend tier (Python `services/`, pure, mypy strict) | — | Stdlib-only; shares the deal-dict shape with `mt5_deals` |
| Compare engine, window picker, taxonomy, verdict renderer | API / Backend tier (Python `services/`, pure) | — | `parity_diff.py` precedent; reuses the MT5 fold rather than re-implementing it |
| Surface matrix (data layer) | Frontend Server / lib tier (TS, run under vitest with the admin client mocked) | — | Each surface's own loader or function is run on its own stored column |
| Render layer, founder session, fixes | Browser (founder's Chrome) | — | Phase 155.2, out of scope |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Python stdlib (`html.parser`, `codecs`, `json`, `hashlib`, `dataclasses`, `decimal`, `ast`) | CI Python 3.12 | Report parser, canonical JSON seal, sha256, purity AST scan | Zero new dependency; `[VERIFIED: ci.yml]` the python job sets `python-version: "3.12"` |
| pandas / numpy | `pandas==3.0.3`, `numpy==2.5.4` (lock) | Series shapes the MT5 fold already returns | `[VERIFIED: analytics-service/requirements.txt]` both pinned; already imported by the reuse targets |
| pytest | `pytest<9.2` (dev) | Engine, intake, parser, purity tests | `[VERIFIED: requirements-dev.txt]` |
| mypy | `mypy==2.4.0` (dev), `strict = true` | Type gate over `services/` | `[VERIFIED: requirements-dev.txt, pyproject.toml::[tool.mypy]]` `strict = true`, `follow_imports = "silent"` |
| vitest | `^5.0.3` | SQL gate, exec test, surface matrix | `[VERIFIED: package.json]` |
| tsx | `^4.23.15` | Optional CLI runner for TS helpers | `[VERIFIED: package.json]` (the `scripts/factsheet-census/run.ts` precedent) |
| PostgreSQL server binaries via `scripts/pg-lane/run.sh --print-pgbin` | 16.13 locally; CI picks its own | Exec test cluster | `[VERIFIED]` ran `--print-pgbin` and a bare initdb this session |

### Supporting

| Item | Purpose | When to use |
|------|---------|-------------|
| `services.broker_dailies::mt5_day_pnl`, `reconstruct_mt5_nav_levels`, `combine_mt5_deal_ledger` | Fold parsed Report deals under a clock and an anchor | Engine's oracle fold and per-day diagnostic |
| `services.mt5_server_clock::server_clock_for_rule`, `Mt5ServerClock` | The ONE broker-time-to-UTC conversion | Counterfactual clocks (`eu`, `us`, ±3600 s) |
| `services.mt5_deals::classify_deal`, `deal_utc_day`, `deal_utc_instant_ms` | Deal classification and day bucketing | Parser output validation, per-day placement |
| `services.wealth_returns::curve_to_daily_returns`, `curve_method_from_flags` | Stored cumulative curve to daily returns | Our side's `returns_series` |
| `services.account_unit::classify_account_currency` | Unit and floors | Census unit, worksheet currency assertion |
| `services.parity_diff` (`BUCKET_LABELS` shape) | Pattern precedent, not a dependency | Engine taxonomy shape; do not fork |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| JSON worksheet | YAML | `pyyaml==6.0.3` is in the lock only transitively (`# via uvicorn, vcrpy`), the same trap as the milestone's C4 for `bs4`; YAML would add a direct import of a transitive dependency and mypy-strict stubs. Use JSON (stdlib) `[VERIFIED: requirements.txt]` |
| stdlib `html.parser` | `beautifulsoup4==4.15.0` | `bs4` is transitive-only (`# via yfinance`); a yfinance bump could drop it. `[VERIFIED: requirements.txt]` |
| Real-DDL extraction for the exec test | Hand-typed stand-in DDL (the marksource precedent) | Stand-ins can drift from the schema; extraction from `baseline.sql` cannot. Extraction verified to work (below) |

**Installation:** none. `npm ci` (or running from the main checkout) is needed for vitest in a fresh worktree because `node_modules` is absent here; see Environment Availability.

**Version verification:** versions above are read from the lock files, not from the registry, because nothing is installed.

## Package Legitimacy Audit

No external package is installed or added by this phase, so no `gsd-tools query package-legitimacy check` run applies.

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
ORCHESTRATOR CHECKPOINTS (Supabase MCP, marker first, one query per call)
   marker.sql ──► census-*.sql ──► (tracked: ordinals, counts, ratios)
   bind.sql ► capture-*.sql ► bind.sql (computed_at unchanged?) ──► /.mt5-parity/<run>/raw/*.json
                                                                        │ seal: canonical JSON (allow_nan=False) + sha256
                                                                        ▼
EXECUTOR-BUILT, CI-TESTED CODE (pure)                          sealed capture (our side)
   founder worksheet (JSON, per-value provenance) ─┐                    │
   Report HTML (UTF-16/UTF-8 sniffed) ──► parser ──┤                    │
        └ refuses unknown/missing/duplicate header │                    │
   provenance gate (3 values; refuses by name) ────┘                    │
                          oracle (deals, balances, readings, synthetic?) │
                                      │                                  │
                                      ▼                                  ▼
                       window picker ──► engine legs: cum return | start level | end level
                       (edge >= S, end < run day,        + inception identity + per-day placement
                        no deal in edge gap)                    │
                                      ▼                         ▼
                      taxonomy: within_tolerance | withheld_by_gate pass alone;
                      any breach tried against explicit counterfactuals
                      (flip BALANCE row, shift clock, swap DST rule, add open P&L, day-level vs timed)
                      no match ──► unexplained  (never by fallthrough)
                                      ▼
                  per-account verdict (code-rendered markdown: labels, buckets, 3 s.f. ratios)
                                      ▼
   DATA-LAYER SURFACE MATRIX (vitest, admin client faked from the sealed capture)
   factsheet | OG card | owner list | allocations book | composer  ──► findings ledger (tracked)
   MT5-15: stored flag keys ──► closed classification table ──► findings
```

### Recommended Project Structure

```
docs/runbooks/mt5-parity/
├── README.md                    # names exactly the .sql files (pinned by test)
├── marker.sql                   # byte-equal to the marksource marker
├── census-accounts.sql          # PARITY-04: one row per MT5 key ordinal
├── census-edges.sql             # one row per (key ordinal, Friday mark day)
├── census-inception.sql         # our-side identity ratio from key_inputs
├── census-flags.sql             # MT5-15: flag keys + status per strategy
├── bind.sql                     # computed_at witnesses, run before and after the capture
├── capture-*.sql                # raw (amounts): analytics, series siblings, marks, key_inputs, per-key csv rows, BTC closes
├── required-readings.json       # the ONE list the worksheet schema and founder-session.md share
└── founder-session.md           # names every reading id; a test pins it to the JSON
analytics-service/services/
├── mt5_parity.py                # engine, taxonomy, MT5_PARITY_TOLERANCE, picker, verdict renderer
├── mt5_parity_intake.py         # provenance enum, worksheet loader, Report parser (stdlib only)
└── mt5_parity_capture.py        # seal/load sealed capture, our-side adapters (curve, marks, key_inputs)
analytics-service/tests/
├── test_mt5_parity_engine.py  test_mt5_parity_intake.py  test_mt5_report_parser.py
├── test_mt5_parity_capture.py  test_mt5_parity_purity.py
└── fixtures/mt5_parity/         # report_synthetic.utf8.html, report_synthetic.utf16le.html, worksheet_synthetic.json, capture_synthetic/
src/__tests__/
├── mt5-parity-capture-sql.test.ts        # static gate + RED proof + .gitignore pin + redaction scan
├── mt5-parity-capture-sql-exec.test.ts   # run on a throwaway cluster against real baseline DDL
└── mt5-parity-surfaces.test.ts           # data-layer matrix on the synthetic capture (env override for real)
analytics-service/scripts/mt5_parity_run.py   # thin CLI; logic stays in services/ (scripts/ is outside the mypy gate)
.gitignore                                    # + /.mt5-parity/
```

Rationale: `services/` is inside the mypy strict surface `[VERIFIED: ci.yml "mypy --strict ... services/ routers/ models/ main.py ..."]`, and the parser and intake are data-integrity code, so they belong there rather than in `scripts/` (ungated, the milestone ARCH proposed `scripts/mt5_parity/`). The CLI is a thin wrapper.

### Pattern 1: Capture once, compare offline, bind to `computed_at`

**What:** The orchestrator runs `bind.sql` (a witness row per strategy and key: `computed_at`, `max(created_at)` of marks, row counts), then the capture files, then `bind.sql` again. A changed witness voids the capture (a nightly derive moved a row mid-capture; freshness is `computed_at`, memory rule). Every capture file also returns completeness witnesses computed in SQL (`jsonb_array_length`, first and last date, a count) that the loader asserts against the loaded array, so an MCP truncation fails loud instead of reading as a shorter record.
**When to use:** every PROD read in this phase.
**Why:** the census and capture are several calls; a derive between them silently mixes two runs.

### Pattern 2: Provenance-locked intake with a synthetic marker

**What:** Every expected value is `{value, provenance}`. `PROVENANCE_VALUES = frozenset({"terminal_reading", "terminal_report_export", "broker_statement"})`; anything else raises a named refusal (`gateway`, `mt5_soak.reconcile_parity`, `quantalyze`, empty, `None`, case and whitespace variants). A worksheet or Report file carrying a file-level `"synthetic": true` marks the whole oracle `synthetic`, which propagates to the verdict as `rehearsal: true` and can never satisfy 155.2.
**Why:** a synthetic oracle cannot truthfully claim a real provenance, and the dress rehearsal (real capture plus synthetic oracle) must not be mistakable for a parity pass (PITFALLS 1, the tautological oracle).

### Pattern 3: The Report parser as a fail-loud header contract

**What:** see slice B. Parse by header text only, allow-list of known headers, fail on unknown, missing-required and duplicate; sniff the BOM; map Type text to the integer codes `mt5_deals` already uses through a closed table that raises on anything else.

### Pattern 4: Legs, counterfactual explainers, and the RED proofs designed backward

**What:** per account and window the engine computes, in the account's own unit:

| Leg | Quantity | Passes when |
|-----|----------|-------------|
| `cum_return` | ours: stored curve level ratio over the window; oracle: realized TWR from the Report's per-day closing balances and flows | `gap <= MT5_PARITY_TOLERANCE` (return gap in points, D-B) |
| `start_level`, `end_level` | ours: level rolled from the stored `key_inputs` writer basis; oracle: Report balance (Gate A) or statement/reading equity (Gate B) | same, divided by E(window start) |
| `inception_identity` (precondition, verdict input) | oracle: `balance_terminal − Σ(trading cash effects) − Σ(flows)` over the whole Report, as a ratio to the first deposit; ours: `realized_terminal_usd − Σ composed_day_pnl − Σ composed_flows` over the stored rows | within the identity band (Open Question 2 on the constant) |
| `day_placement` (diagnostic that can break the verdict) | per UTC day: ours (`composed_day_pnl`) vs the oracle fold's `mt5_day_pnl`, as a gap in points of E(window start) | `gap <= MT5_PARITY_TOLERANCE` per day; exact mismatches also listed as ordinals |

A breach is classified only by an explicit counterfactual that is re-run and found to clear the tolerance, evaluated in a fixed priority and recording every explainer that also matched:

| Bucket | Positive match required |
|--------|-------------------------|
| `clock_mismatch` | re-fold the oracle under the other DST rule and under a ±3600 s shift; the per-day gap clears |
| `flow_placement` | flip each BALANCE/CREDIT/BONUS row individually between flow and trading, or re-fold with the day-level rule instead of the timed rule; the gap clears |
| `pre_mark_realized_basis` | Gate A window on realized basis against an equity-basis edge; the gap minus the open-P&L ratio at the edge clears |
| `edge_instant_mismatch` | the edge mark's `marked_at` lies outside the closed-market interval the oracle reading is attested for |
| `annualization_convention` | a ratio metric differs by exactly `REANNUALIZATION_FACTOR` (reuse `parity_diff`'s 365/252) |
| `withheld_by_gate` | our figure is `None` on every surface for the same `figure-gate` reason (passes only in the matrix) |
| `unexplained` | every explainer was evaluated and none matched; never a default branch |

**RED proofs, designed backward (each mutation must flip a named leg):**
1. **Dropped oldest deal.** The roll is anchored at the terminal, and the Report's Balance column is untouched by dropping its first row, so `cum_return`, `start_level` and `end_level` stay GREEN. Only `inception_identity` moves (the residual becomes about −1 times the first deposit). The proof must name that leg. Bucket: `unexplained` with reason code `inception_identity` (Open Question 1).
2. **One-hour clock shift.** Cumulative return over a window containing both days is unchanged by a shift; only `day_placement` moves, and only if a fixture deal's UTC time is within one hour before a UTC midnight inside the window. Server wall 01:00-02:00 under +2 h (or 02:00-03:00 under +3 h) is that region; server midnight is not. Fixture rule: at least one deal at server wall about 01:30 (standard time) and one at about 02:30 inside 2026-10-25..11-01 (the `eu`/`us` divergence). Bucket: `clock_mismatch`.
3. **Reclassified BALANCE deal.** A deposit relabelled as trading P&L enters the day's P&L, so the day return and the cumulative return jump; relabelling P&L as a deposit removes it. The per-row Balance identity (`Δbalance == profit+swap+commission+fee`) holds for either label, so only the classification counterfactual can attribute it. Apply the break to the parsed oracle deal JSON (a byte copy), not to the HTML: an HTML relabel of a deposit row as `buy` with an empty symbol and volume would be refused by the parser, which is a refusal, not a verdict flip. Bucket: `flow_placement`.

Each proof: write the byte backup and its sha256, apply the byte-level edit to a copy, assert the bytes changed in the intended field (vacuity guard), run the engine, assert RED with the named leg and bucket, restore from the backup, assert the sha256 equals the original, run the engine, assert GREEN.

### Pattern 5: Surface matrix by running each surface's own function on its own column

See slice A. The mock pattern already exists in `src/lib/factsheet/fetch-and-build-payload.test.ts` (a `vi.mock("@/lib/supabase/admin", ...)` whose `createAdminClient().from(table)` serves canned rows, honouring `eq`, `or`, `gte`, `order`, `limit`).

### Pattern 6: The tracked verdict is rendered by code

`render_verdict_markdown(verdict)` takes a typed object that structurally has no money field (labels, ordinals, day counts, `ratio_3sf`, bucket, leg name, reason code). A test asserts the rendered text carries no number with more than three significant figures except ordinals and day counts, and the object constructor refuses extra keys. This makes the redaction rule a type, not a review habit.

### Anti-Patterns to Avoid

- **Importing the gateway read or `mt5_soak.reconcile_parity` as an oracle.** Refused by name at intake (PARITY-01).
- **A real-capture test inside the default shards that skips without its capture.** Rule 12: a skip reads as a pass. The surface test runs on a committed synthetic capture by default and takes `MT5_PARITY_CAPTURE_DIR` to point at a real sealed one; when the variable is set and the directory is missing or fails its seal, the test THROWS. There is no `skipIf`.
- **Restating `0.01`.** One definition, `MT5_PARITY_TOLERANCE`; a test AST-scans `services/mt5_parity*.py` for a second float literal `0.01` and the test files import the constant.
- **A second tolerance constant for the exact-equality identity band** without recording it as a decision (Open Question 2).
- **A `withheld_by_gate` pass on one surface.** It passes only when every surface withholds for the same reason.
- **A synthetic oracle generated from the real capture.** That is tautological (PITFALLS 1); the dress-rehearsal oracle is generated independently (hand-computed Balance column) and marked `synthetic`.

## Slice A: Surface matrix (MT5-09 data layer)

Verified at HEAD this session. "Visible" means the signed-in founder can see an unpublished MT5 strategy on it.

| Surface | Function that computes what it renders (by symbol) | Stored input column(s) | Visible while unpublished? |
|---------|-----------------------------------------------------|------------------------|-----------------------------|
| Factsheet page `/factsheet/[id]` ("strategy detail" is this page) | `fetchAndBuildPayloadWithReason` (`src/lib/factsheet/fetch-and-build-payload.ts`) → `buildFactsheetPayload` (`build-payload.ts`) → `compute` (`compute.ts`); headline gating via `gateAnnualized`, `headlineVerdict`, `storedCashHeadlineGate` | `strategy_analytics`: `daily_returns`, `returns_series`, `data_quality_flags`, `metrics_json_by_basis`, `computed_at`, `computation_status`, the stored scalars and `record_observations:metrics_json->record_observations`; `strategy_analytics_series` rows read by `readSingleKeyBasisOpts` (`mtm_daily_returns`, `smoothed_mtm_daily_returns`, `cash_settlement`, service-role only); `benchmark_prices` BTC via `readFactsheetBenchmark` | **Yes**, owner lane (Lane B, `withPublishedOrOwner`) |
| Share card `/api/og/factsheet/[id]` | `computeOgHeadline` (`src/lib/factsheet/og-metrics.ts`) on `resolveDailyReturnSeries` output | `strategy_analytics`: `returns_series`/`daily_returns`, `sharpe`, `cagr`, `max_drawdown`, `data_quality_flags`, `metrics_json_by_basis`, `computation_status`, record scalars | **No**: route reads through `withPublishedOnly`. Compute it at the data layer anyway and record "computed; not rendered while unpublished" |
| Factsheet PDF `/api/factsheet/[id]/pdf`, `tearsheet.pdf` | Puppeteer `page.goto` of `/factsheet/[id]`; no separate computation. Tearsheet page uses `fetchAndBuildPayloadWithReason(id, withPublishedOnly)` | same payload as the factsheet | **No** (`withPublishedOnly` in both routes and the tearsheet page). One matrix row, "not rendered while unpublished" |
| Private share lane `/factsheet-share/[token]` | `fetchAndBuildPayload(strategy_id, <identity predicate>)`, the SAME builder | same as factsheet | n/a: computes nothing new; not on the founder's fixed list; mention only |
| Allocations book, strategies panel | `getOwnCapitalStrategies` (`src/lib/queries.ts`) → `toStrategyRows`, `computeMtd`, `gatedSharpe` (`allocations/lib/strategies-row-adapter.ts`) | `strategy_analytics`: `daily_returns`, `returns_series`, `cagr`, `sharpe`, `volatility`, `max_drawdown`, `data_quality_flags`, `record_observations` (own-capital strategies only) | **Yes** (owner-scoped, `.neq("status","archived")`) |
| Allocations book, live baseline and glance | `getMyAllocationDashboard` → `liveBaselineMetricsFromPerKeyDailies` (exported, "@internal ... unit testing") and `liveBookFigures` (`allocations/lib/book-figures.ts`) | per-key `csv_daily_returns` (`api_key_id`, `date`, `daily_return`, window 730 days), `allocator_holdings` weights, `allocator_equity_derived` `kind='equity_curve'` | **Yes**, if the MT5 key is connected under the allocator |
| Scenario composer | `computeScenario` (`src/lib/scenario.ts`) fed by two supply lines: the per-key book set (`buildPerKeyStrategyForBuilderSet`, `allocations/lib/scenario-adapter.ts`) and `GET /api/strategies/[id]/returns` (`resolveDailyReturnSeries`, `convertNativeReturnsToUsd` for native units) | per-key `csv_daily_returns` for the book line; `strategy_analytics` `daily_returns`/`returns_series`/`data_quality_flags`/record scalars for the route; `benchmark_prices` BTC for a native-unit leg | **Yes** for the owner: the route uses `withPublishedOrOwner` (ARCH said published only; that is wrong) |
| List cards, owner list `/strategies` | `getMyStrategies` → `shapeRowAnalytics` → `StrategyTable` helpers `rowRecord`, `gatedMetric`, `gateAnnualized` | `strategy_analytics (*)` scalars, sparklines, record scalars | **Yes** (owner-scoped read) |
| List cards, public Discovery `/discovery/[slug]` | `getStrategiesByCategory` → same row shaping | same | **No** (`withPublishedOnly`) |

`[VERIFIED]` visibility facts: `src/lib/visibility.ts::withPublishedOnly` = `.eq("status", "published")`; `withPublishedOrOwner` = `.or(\`status.eq.published,user_id.eq.${authUserId}\`)` (fail-closed to published-only on a non-UUID); `strategies_status_check` allows `draft`, `pending_review`, `published`, `archived`, `private` (`supabase/schema/baseline.sql`, `strategies` table).

**Recommended harness (decision):**
- One vitest file, `src/__tests__/mt5-parity-surfaces.test.ts`, with the same `vi.mock("@/lib/supabase/admin", ...)`, `vi.mock("server-only", () => ({}))` and `vi.mock("@/lib/supabase/server", ...)` set the existing tests use (`fetch-and-build-payload.test.ts`, `scenario-tiny-base.test.ts`). The fake client serves the sealed capture's rows, so `fetchAndBuildPayloadWithReason` runs end to end on real stored columns (the highest-fidelity data-layer call) instead of a re-implementation.
- The pure ones (`computeOgHeadline`, `toStrategyRows`, `computeScenario`, `liveBaselineMetricsFromPerKeyDailies`, `liveBookFigures`, `rowRecord`/`gatedMetric`) are called directly on rows shaped like the stored columns.
- The route handler (`/api/strategies/[id]/returns`) is a handler over a request client; run its core steps (`resolveDailyReturnSeries`, `curveMethodFromFlags`, `convertNativeReturnsToUsd`, `recordFromScalars`) rather than the handler, and record that choice.
- Headline tuple per surface per account: cumulative return over the full record, last return date, CAGR, Sharpe, max drawdown, and the figure-gate state. Cells: value, `withheld (reason)`, or `not rendered while unpublished`.
- **Cross-store check that only this matrix can make:** the factsheet and composer read the strategy's `strategy_analytics` series, while the allocations book reads per-key `csv_daily_returns`. They are meant to be one persisted series. Compare them day for day; a difference is a finding with root-cause lead "two stores".
- Native-unit accounts (`data_quality_flags.native_unit`): the composer reads `daily_returns_usd` (priced through BTC closes) while the others read native returns. Compare in the account's native unit first; the USD view is a separate labelled cell (PITFALLS 10). The capture must then include `benchmark_prices` BTC rows.
- The matrix binds every cell to the capture's `computed_at`.
- A CI run on the committed synthetic capture proves the matrix reports a discrepancy: neuter one surface's input column in a byte copy (change one `csv_daily_returns` day), see the matrix name that surface, restore from the byte backup, see agreement.

## Slice B: Report parser (what is knowable and what is not)

**Knowable (cited):**
- The HTML report is generated from a template `ReportHistory.htm`; sections are Orders, Deals, Positions, Working Orders, Summary, Details; the header carries brokerage name, account number, account owner, deposit currency and report date; the Deals table "features all the information fields available" in the Deals tab; Summary has Balance, Credit Facility, Floating P/L, Equity. `[CITED: metatrader5.com/en/terminal/help/trading_advanced/history_report]`
- The MQL5 article on HTML reports says the report keeps "all data in one table" with `<th>` heading cells beside `<td>` cells. `[CITED: mql5.com/en/articles/5436]`

**Not documented anywhere found (all `[ASSUMED]`, planned for, not relied on):** the encoding (the one third-party parser found reads UTF-8 and has no BOM handling; the milestone STACK said UTF-16, unmeasured); exact Deals header strings; whether a per-deal Balance column exists (a third-party parser reads a 13-cell row with `balance` as cell 12 and a `<th colspan="13">Deals</th>` section marker, and has no Fee column, so the cell count can differ by build); thousands and decimal separators; the Type text vocabulary; time format. `[CITED: huggingface.co/algorembrant/mt5-analyzer parser.js, LOW]`

**Design the parser as a contract that fails loud on anything it did not predict:**
- **Encoding:** read bytes; BOM `FF FE` → `utf-16-le`, `FE FF` → `utf-16-be`, `EF BB BF` → `utf-8-sig`; no BOM → try strict `utf-8`, then refuse (never guess `utf-16` without a BOM). Test all three BOMs plus a no-BOM refusal. Cap the file size.
- **Section location:** find the `<th>` whose text, whitespace-collapsed and case-folded, is `deals`; the table is its enclosing `<table>` (one-table layout: rows between that section row and the next section row). The header row is the row of `<th>` cells that follows. Stop at the next section marker or a footer row (the Deals footer is a closed-profit total).
- **Header contract (recommended, pinned by tests):** known set `{Time, Deal, Symbol, Type, Direction, Volume, Price, Order, Commission, Fee, Swap, Profit, Balance, Comment}`; required `{Time, Deal, Type, Commission, Swap, Profit, Balance}`; `Fee` optional (absent means 0, stated in the parse result); anything outside the known set raises `UnknownHeader`, a missing required raises `MissingHeader`, a repeat raises `DuplicateHeader`. A row whose cell count differs from the header count raises. Non-English terminal headers fall out as unknown; the founder script pins an English terminal.
- **Balance column required for Gate A.** It is the one independent realized-path oracle (and the check on assumption A3: `Δbalance == profit+swap+commission+fee` per row). If a real export lacks it, that is a recorded decision, not a silent fallback (Open Question 4).
- **Type text to code:** a closed table `buy→0, sell→1, balance→2, credit→3, bonus→6`, with the commission family (7..11) and the fail-loud types (charge 4, correction 5, interest 12, canceled 13/14, dividend 15/16, tax 17) mapped to their codes, so `classify_deal` raises exactly as in the worker. Unknown text raises. Case-folded exact match only.
- **Direction to entry:** `in→0`, `out→1`, `in/out→2`, `out by→3` (`MT5_DEAL_ENTRY_*`), else `None`; absent `position_id` and `time_msc` are `None`. Consequence: `_mt5_flow_day_timing` returns `None` for any flow day with a trading deal, so the oracle fold uses the day-level rule on flow days while PROD used the timed rule (`combine_mt5_deal_ledger` passes `timing` and `full_history=True`). **Compare money (day P&L, levels, ΔE), not `r_t`, on flow days**, and expect `flow_placement` there until a position id can be derived (Open Question 3).
- **Numbers:** strip ASCII space, NBSP and thin space as thousands separators; one `.` decimal; a `,` decimal raises; assert finite; refuse a bool-like or empty money cell on a trading row. Negative as `-1 234.56`. Money errors name the column only, never the value (the `mt5_deals._coerce_money` leak-safe convention).
- **Time:** `YYYY.MM.DD HH:MM:SS` parsed as a naive wall time and encoded as epoch seconds as if UTC. That is the same encoding as the gateway's deal `time` per `mt5_server_clock` ("A deal's `time` is the broker's server clock encoded as if it were UTC") `[VERIFIED: mt5_server_clock.py module docstring]`; that the terminal display equals the API value is itself unverified (155.1's reading owns it).
- **Header block:** never returned (name, account number, owner are PII). Currency comes from the worksheet (`terminal_reading`), asserted equal to the stored account unit, not parsed from the header.
- **Fixture (decision):** commit a reviewable `report_synthetic.utf8.html` and a binary `report_synthetic.utf16le.html` (BOM plus UTF-16-LE), plus a test asserting `utf16le == b"\xff\xfe" + utf8_text.encode("utf-16-le")` so the opaque binary can never drift from the readable source. Fake header text only ("Synthetic Account", all-zero numbers). The fixture contains: a first BALANCE deposit; BUY/SELL deals with IN and OUT direction; a Wednesday triple-swap; a commission-family row; a mid-window deposit; a withdrawal; a deal at server wall about 01:30 and one at about 02:30 inside 2026-10-25..11-01; a month-end; and a hand-computed Balance column (by hand, written as literals; a fixture-integrity test folds it through `mt5_day_pnl` and asserts agreement so the fixture is its own cross-check, not generated by the system under test).
- **Search the repo as `grep -a`:** the UTF-16 file holds NUL bytes.

## Slice C: Capture SQL and census (PARITY-03, PARITY-04)

**Mapping chain** `[VERIFIED: baseline.sql, strategies/api_keys/strategy_keys tables]`: strategy → key by `strategies.api_key_id`; MT5 keys by `api_keys.exchange = 'mt5'` (`api_keys_exchange_check` lists `binance, okx, bybit, deribit, sfox, mt5`); `strategy_keys(strategy_id, api_key_id, owner_id, window_start, window_end, seq)` carries multi-key windows; `api_key_nav_marks(api_key_id, allocator_id, mark_day, marked_at, venue, nav_usd, open_pnl_usd, nav_native, open_pnl_native, native_unit, price_day, native_detail, created_at)` with `api_key_nav_marks_label_chk`: `"mark_day" = ((("marked_at" AT TIME ZONE 'UTC'::"text"))::"date" - 1)`.

**Account labels:** select all `exchange='mt5'` keys with `row_number() OVER (ORDER BY k.created_at, k.id)` ordinals `k1..kN` (the marksource a-label precedent), never by uuid literal. The orchestrator maps ordinal to MM2/MM3/FX-AI_V by reading `api_keys.label` once into the gitignored mapping file. `venue_account_id` is the MT5 LOGIN text (`mt5_validation.mt5_venue_account_id`), so it is never selected, never hashed (a login is low-entropy and brute-forceable); at most a `keys_sharing_login` count. `api_keys.label` is likewise capture-directory-only. The v1.15 soak key may also be an `mt5` key: ordinal selection plus the mapping file filters it out.

**`S` has three stored sources, and the gate must use the applied one.** `min(api_key_nav_marks.mark_day)` per key (raw marks); `allocator_equity_derived.payload.marks_since` on `key_inputs:<id>`; `strategy_analytics.data_quality_flags.marks_since`. The `queries.ts` read of `marks_since` documents that "The derive writes `marks_since` into a key's row only after `apply_marks` succeeded, so a key whose apply was refused names no start; the raw marks table would name one the drawn curve does not contain". Census all three; gate on the applied one; a disagreement is a finding, not a pick.

**What a derive persists for an MT5 key (verified, `job_worker.py`):**
- `_persist_key_inputs` upserts `{"allocator_id", "kind": "key_inputs:" + api_key_id, "payload", "computed_at"}` with `on_conflict="allocator_id,kind"`, inside `_run_key_mode_compose_epilogue`, which runs on both the ≥2-day path and the <2-day short-circuit.
- The payload carries `flows`, `anchor_usd`, `anchor_null_reason`, `anchor_asof`, `venue`, plus (MT5, key mode) `realized_terminal_usd` and `realized_terminal_day` via `realized_terminal_payload`, `composed_flows` and `composed_day_pnl` via `writer_basis_payload` because `WRITER_BASIS_VENUES = frozenset({"deribit", "mt5"})`, `nav_mark` (`mark_day`, `nav_usd`, `open_pnl_usd`, `marked_at`), `marks_since`, `mark_gap_days`, `marks_trailing_since`.
- After marks apply, the realized terminal is the last mark's NAV on the last mark day and the writer basis is the pre-start P&L joined with `apply_marks`' post-start P&L, so the compose's backward roll telescopes to the writer's own level at S-1.
- `is_key_mode = bool(job.get("api_key_id"))`: the `key_inputs` row exists only for a key that had a key-mode derive. A key that only backs a strategy has marks and a strategy row but may have no `key_inputs` row. **The census reports `key_inputs_present` per key; an absent row makes our-side levels and our-side identity "not measurable", which the engine treats as a failed leg (fail closed), never a pass.**
- A native-unit (BTC) key stores the USD-converted `composed_*` (D-03) while `strategy_analytics.returns_series` is in the native unit. Our-side USD levels and the Report's native balances are not comparable; compare returns natively and levels in the unit the payload states.

**Inception identity from stored rows.** `NAV_{-1} = realized_terminal_usd − Σ composed_day_pnl − Σ composed_flows` (the identity `P_t = NAV_t − NAV_{t−1} − F_t` rolled back past day 0). Report it as `|NAV_{-1}| / |first flow|`. Our pipeline already runs a related zero-start check inside `replay_key_equity` (`_INCEPTION_ZERO_START_BAND = 1e-4`, denominator the level on the first return day); PARITY-04's denominator is the first deposit, a different quantity, so state both and do not import `allocator_equity_derive` (it reaches `services.db`).

**File set (all one statement, `WITH`/`SELECT`, one `;` last, no `--`, no uuid literal):**

| File | Output | Tracked? |
|------|--------|----------|
| `marker.sql` | which database | yes (the answer, not data) |
| `census-accounts.sql` | per key ordinal: `account_currency`, `native_unit` flag, `strategies.status` and `asset_class`, `S` (three sources), mark count, last mark day, first and last return date, `jsonb_array_length` of the series, `record_observations`, `computed_at`, `computation_status`, `series_completeness`, `keys_sharing_login`, `key_inputs_present`, `server` = the literal `unmeasured (155.1 reading owns it)` | counts, dates as day counts, ordinals |
| `census-edges.sql` | per key ordinal and each Friday mark day ≥ the key's first mark: present, `open_pnl/nav` ratio, hours from the preceding UTC midnight to `marked_at` | ratios to 3 s.f. |
| `census-inception.sql` | per key ordinal: `key_inputs_present`, first-flow present, identity ratio, day and flow-day counts | ratios, counts |
| `census-flags.sql` | per strategy: `computation_status`, `computation_warned`, `jsonb_object_keys(data_quality_flags)` array | key names only |
| `bind.sql` | witnesses | no |
| `capture-*.sql` | raw rows (amounts, ids): the strategy's `strategy_analytics` row and its `strategy_analytics_series` rows, `api_key_nav_marks`, the `key_inputs:<id>` payload, per-key and per-strategy `csv_daily_returns`, `allocator_holdings` for the key, `allocator_equity_derived` `kind='equity_curve'`, `benchmark_prices` BTC (only when a native unit exists), and a key map | **no**, capture dir only |

Census enumerates ALL Fridays since `S` instead of hard-coding 2026-10-30 and 2026-11-13, so the picker can re-pick without editing SQL. **The two candidate edges may not both be usable:** NAVMTM and the marks chain were moved late October 2026, so 2026-10-30 may precede a key's `S` (refused for Gate B), and the 2026-11-13 mark is labelled by the read on Saturday 2026-11-14, so it does not exist until that nightly derive has run. The census records presence and the picker proposes any Friday pair at or after `S` with marks present.

**Write-keyword gate (decision: superset of the precedent).** The precedent `WRITE_WORDS` in `src/__tests__/marksource-okx-census-sql.test.ts` is `["INSERT","UPDATE","DELETE","DROP","ALTER","CREATE","TRUNCATE","GRANT","COPY","CALL"]` (whole word, case-insensitive). It misses `INTO` (so `SELECT ... INTO` creating a table passes), `MERGE`, `DO`, `REVOKE`, `VACUUM`, `REFRESH`, `COMMENT`, `LOCK`, `PREPARE`, `EXECUTE`. Add them, plus a function denylist (`nextval`, `setval`, `pg_advisory`, `pg_notify`, `set_config`, `dblink`, `lo_`, `pg_sleep`) and `SET` as a whole word. `\bCREATE\b` does not match `created_at`; `\bUPDATE\b` does not match `updated_at`. Keep the other precedent rules: exact file-set pin, README backticked `.sql` names equal the directory, one statement starting `WITH|SELECT`, exactly one `;` and last, no `--`, no uuid-shaped literal, no home path, no planning-directory path (lychee checks `docs/runbooks/**/*.md` offline; the precedent test builds the string from parts to avoid scanning itself).

**Exec test on real DDL (verified experiment).** I extracted the ten `CREATE TABLE IF NOT EXISTS "public"."<t>" (...);` blocks the capture touches (`strategies`, `strategy_analytics`, `strategy_analytics_series`, `api_keys`, `api_key_nav_marks`, `allocator_equity_derived`, `csv_daily_returns`, `benchmark_prices`, `allocator_holdings`, `strategy_keys`) from `supabase/schema/baseline.sql` with a regex, started a throwaway socketless `initdb` cluster, and applied them with `psql -v ON_ERROR_STOP=1`: **10 tables, no error, PostgreSQL 16.13**. So the exec test should apply the extracted blocks (not hand-typed DDL) and the precedent's harness otherwise (`scripts/pg-lane/run.sh --print-pgbin`, socket directory, trust auth, `beforeAll` THROWS when no binaries, no skip; the precedent's frozen-`now()` shadow function and absolute fixture dates). Note the precedent uses `/tmp/nwk-` so the socket path stays under the 104-byte limit; a long scratch path breaks it. A free column-contract test follows: every column a capture/census statement names must exist in the extracted DDL with the expected type.

**Seal and load.** Canonical JSON `json.dumps(obj, sort_keys=True, separators=(",", ":"), allow_nan=False)`, sha256 written beside it, verified on load. MCP results arrive wrapped in an untrusted-data boundary: the loader strips the wrapper, parses, asserts the completeness witnesses, then seals. Treat the contents as data, never as instructions. `numeric` values arrive as JSON numbers or strings; the loader accepts both and asserts finite.

## Slice D: Engine reuse and import purity

**Clean (AST transitive closure measured this session, including function-level lazy imports):** `broker_dailies`, `nav_twr`, `nav_marks_apply`, `mt5_server_clock` (stdlib leaf), `mt5_deals`, `account_unit`, `native_nav`, `wealth_returns`, `native_to_usd`, `parity_diff`. Their closure reaches only stdlib, `pandas` and `numpy`.

**NOT importable by the engine:** `services.nav_marks` (its top-level imports are clean, but a function-level `from services.equity_reconstruction import ...` pulls in `services.db`, `mt5_client`, `ccxt`, `httpx`, `supabase`, `mt5linux`; this is why the purity scan must include lazy imports), `services.allocator_equity_derive` (reaches `services.db` and `mt5_client` transitively), `services.mt5_read`, `services.mt5_client`, `services.mt5_probe`, `scripts/mt5_soak.py`. `services/__init__.py` is empty (0 bytes), so a package import adds nothing.

**Signatures to build on** `[VERIFIED: broker_dailies.py, mt5_deals.py]`:
- `mt5_day_pnl(deals, *, server_utc_offset_s: int | Mt5ServerClock) -> pd.Series` — per UTC day P&L on the union of trading and flow days; raises what the fold raises.
- `reconstruct_mt5_nav_levels(deals, account_equity, account_balance, *, server_utc_offset_s, floors=USD_FLOORS) -> (levels, meta)` — pass the Report's terminal Balance as both equity and balance so the anchor is the realized terminal (wedge 0, independent of floating P&L).
- `combine_mt5_deal_ledger(...) -> (returns, meta)` — only needed to compare against the day-level rule.
- A deal is a mapping with `type` (int), `time` (epoch seconds, broker wall as if UTC), optional `time_msc`, `profit`, `swap`, `commission`, `fee`, `entry`, `position_id`. The trading types are `_MT5_TRADING_DEAL_TYPES: frozenset[int] = frozenset({0, 1, 7, 8, 9, 10, 11})` and the flow types `_MT5_EXTERNAL_FLOW_DEAL_TYPES: frozenset[int] = frozenset({2, 3, 6})`.
- `deal_cash_effect` sums `profit + swap + commission + fee` once (`[ASSUMED A3]` in the module header; the Report's Balance column is the independent check).
- `NAV_TWR_GUARD_KEYS` = `("dust_nav_guard", "negative_nav_guard", "pnl_dominated_guard", "flow_coverage_incomplete", "unrealized_pnl_in_anchor", "unrealized_pnl_unreadable", "twr_chain_broken", "pre_summary_rollout_option_dailies", "pre_mark_retention_option_dailies", "tiny_base_guard")` is the closed key list the MT5-15 table must cover; the annotation keys are `NAV_TWR_ANNOTATION_KEYS` (`small_base_measured*`, `flow_timing_day_level*`, `tiny_base_days`, `tiny_base_day_pnl`); the marks keys are `marks_since`, `marks_covered_from`, `marks_trailing_since`, `mark_gap_days`.

**Purity pin (decision):** walk the TRANSITIVE local import closure of `services/mt5_parity*.py` with `ast`, including imports inside functions (`transforms.py` imports `nav_twr` lazily), and assert the closure contains none of `mt5_client`, `mt5_read`, `mt5_soak`, `mt5_probe`, `mt5_concurrency`, `db`, `nav_marks`, `allocator_equity_derive`, and no external module among `supabase`, `postgrest`, `httpx`, `aiohttp`, `ccxt`, `mt5linux`, `rpyc`, `socket`, `subprocess`, `requests`. Add an anti-vacuity assert that the closure includes `mt5_deals`, `mt5_server_clock` and `broker_dailies`. The existing `test_the_clock_module_is_a_stdlib_leaf` in `test_mt5_server_clock.py` is direct-imports-only and is the style to extend, not copy.

**mypy strict constraints:** `strict = true`, `follow_imports = "silent"`, pandas is `ignore_missing_imports` (Any at the boundary, `pandas-stubs` deliberately not installed); use `from __future__ import annotations`, `Literal` for the taxonomy, frozen dataclasses with `slots=True`, `Final` constants; run exactly `cd analytics-service && mypy --strict --follow-imports=silent --config-file=pyproject.toml services/mt5_parity.py services/mt5_parity_intake.py services/mt5_parity_capture.py` locally and the CI line over the whole surface.

## Slice E: PROD access and orchestrator checkpoints

Executors have no Supabase MCP and must not use the CLI or Keychain against PROD. Every plan that needs PROD figures splits:

1. **Executor task:** write and test the SQL (static gate, exec test on real DDL), the loader and the engine against synthetic fixtures.
2. **Orchestrator checkpoint task** (marked so an executor cannot run it): run `marker.sql` first and continue only if it names PRODUCTION (NULL or any other answer: stop and re-set the marker, never proceed on a guess); run `bind.sql`, the census files, the capture files, `bind.sql` again, one query per call; write results into `/.mt5-parity/<run>/raw/`; run the loader to seal; write the ordinal-to-label mapping file; then run the engine for the dress rehearsal and the by-hand RED proofs.

Output volume risk: a two-year `returns_series` and `csv_daily_returns` per key can be large for one MCP result. Return one jsonb per call per account, and let the completeness witnesses catch truncation. The checkpoint tasks are the only PROD touch; nothing in them enqueues, syncs or calls the gateway.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| MT5 deal classification, day bucketing, instants | a second classifier or a tz library | `mt5_deals::classify_deal`, `deal_utc_day`, `deal_utc_instant_ms`; `mt5_server_clock::Mt5ServerClock` | The hardened fail-loud half; a copy drifts. No `zoneinfo`/`pytz`/`dateutil` at runtime |
| Per-day P&L, levels, TWR from deals | a bespoke `r_t` loop | `broker_dailies::mt5_day_pnl`, `reconstruct_mt5_nav_levels`, `combine_mt5_deal_ledger` | `broker_dailies` says a bespoke loop is forbidden; levels and returns agree by construction |
| Stored curve to daily returns | an inline `w[k]/w[k-1]-1` | `wealth_returns::curve_to_daily_returns` with `curve_method_from_flags` | Pinned to a shared oracle fixture with the TS twin; a bad level leaves the day absent, never 0 |
| Account unit and floors | currency string compares | `account_unit::classify_account_currency` | USD family and BTC only; others raise `AccountCurrencyUnsupported` |
| Figure withholding | restated 60/90/365 | `figure-gate.ts::gateAnnualized`, `recordClears`, `gatedValue`, `figureRecord` | One verdict every surface uses (`MIN_ANNUALIZATION_DAYS = 90`, `MIN_ANNUALIZATION_OBS = 60`) |
| HTML table parsing | regex over markup | `html.parser.HTMLParser` | stdlib, handles `<th>`/`<td>` mixes |
| Encoding sniff | guess | `codecs` BOM constants | Explicit and testable |
| Seal | a custom hash format | canonical `json.dumps(sort_keys=True, separators=(",", ":"), allow_nan=False)` + `hashlib.sha256` | Deterministic; NaN fails loud |
| Postgres test cluster | a Docker lane | `scripts/pg-lane/run.sh --print-pgbin` + a socket-only `initdb` | The precedent; no network |
| Bucket-classifier shape | a new pattern | `parity_diff.py` (a closed `frozenset`, an explicit-non-match default) | Do not fork it |

**Key insight:** every number in this harness already has one owner. The harness's value is the comparison and its proof of being able to fail, so any re-implementation of an owner's arithmetic makes the comparison tautological.

## Common Pitfalls

### Pitfall 1: A RED proof that cannot go RED
**What goes wrong:** the dropped-oldest-deal test passes the window legs because the terminal-anchored roll and the Balance column are unchanged below the dropped row.
**Why:** error accrues backward from the anchor; nothing later moves.
**How to avoid:** the inception identity is a verdict input and the proof names it (Pattern 4). Vacuity guard: assert the identity residual changed and the three window legs did not, in the same test.
**Warning signs:** a "RED" that is really a parser refusal; a GREEN after the break.

### Pitfall 2: A clock-shift test that cannot bite
**What goes wrong:** cumulative return over a window containing both adjacent days is unchanged by a one-hour shift.
**How to avoid:** a fixture deal within one UTC hour of a UTC midnight inside the window, and the `day_placement` leg in the verdict. On real data a near-midnight deal under 1 point of equity passes the 1% constant; exact placement on a real near-midnight deal is 155.1's test, not this one.

### Pitfall 3: A reclassify break the parser refuses
**What goes wrong:** relabelling a deposit row `buy` in the HTML leaves an empty Symbol and Volume; a strict parser refuses it and the "verdict flip" is a refusal.
**How to avoid:** apply the break to the parsed oracle deal JSON; add a separate parser test that the HTML-level inconsistent relabel is refused.

### Pitfall 4: Edges before `S`, and an edge that does not exist yet
**What goes wrong:** assuming Fri 2026-10-30 and Fri 2026-11-13 are both Gate B edges.
**How to avoid:** census every Friday since `S`; the picker refuses an edge before `S`, an edge without a mark, and any window ending on or after the run day; the 2026-11-13 mark exists only after the Saturday UTC derive. Weekend-quoted symbols (crypto CFDs) void the Friday-close alignment for that account (PITFALLS 2, LOW).

### Pitfall 5: The dress rehearsal read as a parity pass
**What goes wrong:** a synthetic oracle plus a real capture produces a verdict that looks like a result.
**How to avoid:** `rehearsal: true` on the verdict, the document title says so, and a test pins that a rehearsal verdict can never carry a final GREEN. Never build the synthetic oracle from the capture.

### Pitfall 6: Public-repo leakage through convenient fields
**What goes wrong:** `venue_account_id` is the login; `api_keys.label` and the Report `Comment` column are free text; the Report header carries name and account number.
**How to avoid:** never select them into tracked output; the parser drops the header block and keeps `Comment` out of its result unless a census needs a pattern class; the verdict is rendered by code (Pattern 6); a redaction test scans `docs/runbooks/mt5-parity/**`, the fixtures and the phase-directory tracked artifacts for uuid-shaped strings, home-directory path prefixes, and long digit runs.

### Pitfall 7: Gates that new files will trip
- `src/__tests__/self-referential-oracle.test.ts` AST-scans every `*.test.ts` under `src/__tests__` for a `const` bound to a literal and asserted by the same block; write the new tests with computed or hand-derived oracles, not a banner string asserted against itself.
- The README must name every `.sql` file and no other (precedent pin).
- `docs/runbooks/**/*.md` is link-checked offline by lychee; no planning paths, no dead links.
- `plan-anchor-verify` fails a PLAN that cites a `file:line` that has drifted: cite symbols.
- `check-planning-hygiene` (`npm run lint`) guards `.planning` shape; do not hand-edit ROADMAP/STATE shapes.
- A ship branch must change nothing under `.planning/`.

### Pitfall 8: Guessing which guard fired (MT5-15)
**How to avoid:** read the stored `data_quality_flags` keys and classify each against the closed list above; an unknown key is an `unknown` finding, never a guess (PITFALLS 12). Flags are rewritten every derive; bind the classification to `computed_at`.

### Pitfall 9: Versions that differ between a worktree and CI
Local Python is 3.14.3 (CI 3.12), local pandas 3.0.1 (lock 3.0.3), local mypy 2.0.0 (dev pin 2.4.0). A passing local run is evidence, the CI run is the verdict. `node_modules` is absent in a fresh worktree; earlier phases ran pytest and tsx from the main checkout by absolute path with cwd in the worktree, and verified module resolution pointed at the worktree.

### Pitfall 10: Native-unit accounts compared across units
Compare returns natively, levels in the payload's stated unit, and the USD view as a separately labelled check naming its price source (BTC closes from `benchmark_prices`). An EUR account raises `AccountCurrencyUnsupported` upstream, which the census must record rather than crash on.

## Code Examples

### Canonical seal

```python
# stdlib only; allow_nan=False makes a NaN fail loud (STACK 2.3)
import hashlib, json

def seal(obj: object) -> tuple[bytes, str]:
    raw = json.dumps(obj, sort_keys=True, separators=(",", ":"), allow_nan=False, ensure_ascii=True).encode("ascii")
    return raw, hashlib.sha256(raw).hexdigest()
```

### Transitive purity scan (extends the direct-imports precedent)

```python
# Source pattern: tests/test_mt5_server_clock.py::test_the_clock_module_is_a_stdlib_leaf (direct only)
import ast
from pathlib import Path

def closure(root: Path, start: str) -> tuple[set[str], set[str]]:
    seen: set[str] = set(); ext: set[str] = set(); stack = [start]
    while stack:
        mod = stack.pop()
        if mod in seen: continue
        seen.add(mod)
        path = root / (mod.replace(".", "/") + ".py")
        if not path.exists(): continue
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):  # includes lazy imports
            names = [node.module] if isinstance(node, ast.ImportFrom) and node.module else \
                    [a.name for a in node.names] if isinstance(node, ast.Import) else []
            for n in names:
                (stack.append(n) if n.startswith("services") else ext.add(n.split(".")[0]))
    return seen, ext
```

### Write-keyword gate with a byte-backup neuter proof (vitest)

```ts
// Superset of marksource-okx-census-sql.test.ts::WRITE_WORDS (INSERT UPDATE DELETE DROP ALTER CREATE TRUNCATE GRANT COPY CALL)
const WRITE_WORDS = ["INSERT","UPDATE","DELETE","DROP","ALTER","CREATE","TRUNCATE","GRANT","COPY","CALL",
  "INTO","MERGE","DO","REVOKE","VACUUM","REFRESH","COMMENT","LOCK","PREPARE","EXECUTE","SET"] as const;
function violations(name: string, text: string): string[] { /* whole-word, case-insensitive; also fn denylist */ return []; }

it("the gate goes RED on a neutered copy and GREEN after a byte-backup restore", () => {
  const dir = mkdtempSync(join(tmpdir(), "mt5p-")); const src = join(DIR, "census-accounts.sql");
  const backup = readFileSync(src); const backupSha = sha256(backup);       // byte backup
  const copy = join(dir, "census-accounts.sql"); writeFileSync(copy, backup);
  writeFileSync(copy, Buffer.concat([backup.slice(0, -1), Buffer.from(" INTO scratch;")]));  // neuter the COPY only
  expect(sha256(readFileSync(copy))).not.toBe(backupSha);                   // vacuity: the neuter applied
  expect(violations("census-accounts.sql", readFileSync(copy, "utf8")).join()).toMatch(/INTO/);  // RED, named
  writeFileSync(copy, backup);                                               // restore from the byte backup
  expect(sha256(readFileSync(copy))).toBe(backupSha);
  expect(violations("census-accounts.sql", readFileSync(copy, "utf8"))).toEqual([]);            // GREEN again
});
```

### Extract real DDL for the exec test

```ts
// Verified this session on PostgreSQL 16.13: 10 tables apply with ON_ERROR_STOP=1
const baseline = readFileSync("supabase/schema/baseline.sql", "utf8");
const ddl = TABLES.map((t) => {
  const m = baseline.match(new RegExp(`^CREATE TABLE IF NOT EXISTS "public"\\."${t}" \\(\\n[\\s\\S]*?^\\);\\n`, "m"));
  if (!m) throw new Error(`baseline.sql has no CREATE TABLE for ${t}`);   // fail loud, never skip
  return m[0];
}).join("\n");
```

### Surface harness mock (existing precedent)

```ts
// Source: src/lib/factsheet/fetch-and-build-payload.test.ts (vi.mock of createAdminClient serving canned rows)
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => fakeAdminFromCapture() }));
const result = await fetchAndBuildPayloadWithReason(STRATEGY_ID, ownerVisibility /* withPublishedOrOwner */);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Open P&L spread across history | Realized basis before `S`, stored equity marks from `S` | NAVMTM, closed 2026-11-02 | Two gates (A pre-`S`, B from `S`); the harness never invents marks (D-A) |
| `MT5_SOAK_SERVER_OFFSET_MIN` | `MT5_SERVER_TIME_RULE` (`eu`/`us`) read by `resolve_mt5_server_clock` | Phase 175, 2026-11-03 | Counterfactual clocks use `server_clock_for_rule` |
| Legacy allocator equity snapshots | `allocator_equity_derived` rows (`key_inputs:<id>`, `equity_curve`) | Phase 176, 2026-10-31 | Our-side per-day P&L and identity are stored per key |
| Portfolio PDF, `scenario-blend-panels.ts` | Retired / deleted | Phase 195, v0.43.0.0 | Dropped from MT5-09 (CONTEXT) |

**Deprecated/outdated:** milestone ARCH Pattern 5's "published only" for the composer route, browse and the owner list; its "inferred" strategy-detail row; its YAML worksheet and `bs4` suggestions; STACK's Oracle A (gateway snapshot), already overruled by the milestone summary (C1).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The Report is UTF-16-LE with a BOM (a third-party parser reads UTF-8) | Slice B | Parser refuses a real file; mitigated by BOM sniffing for all three encodings and a loud no-BOM refusal |
| A2 | Deals headers are Time, Deal, Symbol, Type, Direction, Volume, Price, Order, Commission, Fee, Swap, Profit, Balance, Comment (13 or 14 columns by build) | Slice B | An unknown or renamed header halts intake; that is the designed behaviour |
| A3 | A per-deal Balance column exists in the Deals table | Slice B, Pattern 4 | Gate A loses its independent realized-path oracle; falls to the fold-only path by an explicit decision (Open Question 4) |
| A4 | Type text vocabulary is `buy`, `sell`, `balance`, `credit`, `bonus`, plus commission and fail-loud names | Slice B | Unknown text raises; no silent mapping |
| A5 | Number format uses space or NBSP thousands separators and a `.` decimal; time is `YYYY.MM.DD HH:MM:SS` | Slice B | Parse refusal; fixture and parser updated once a real export exists |
| A6 | Report `Time` equals the gateway's `deal.time` (server wall as if UTC) | Slice B | Systematic day mis-bucketing seen as `clock_mismatch`; 155.1 reading owns the real check |
| A7 | The Report has no `position_id` and no `time_msc` | Slice B | If it does, the oracle fold can use the timed rule and `flow_placement` on flow days shrinks |
| A8 | Production's configured clock is `us` (founder readings, 175) | Pattern 4 | Counterfactual priority order is unaffected; the base clock is a harness input |
| A9 | CI frontend shards carry PostgreSQL binaries (the marksource README says its exec test "runs in the ordinary vitest shards") | Slice C | The new exec test would throw in CI; `beforeAll` throws loudly, never skips |
| A10 | Each MT5 key's first mark day is late October 2026 or later | Pitfall 4 | Only the census measures it; the picker handles any value |
| A11 | A Supabase MCP result for a two-year series can be returned in one call | Slice E | Truncation caught by the completeness witnesses; split per account or per slice |
| A12 | The Report Summary labels (`Balance:`, `Equity:`, `Floating P/L:`, `Credit Facility:`) are as the help page lists them | Slice B | Not parsed in this phase except as a fixture check; readings come from the worksheet |

## Open Questions

1. **Which bucket does a truncated ledger land in?**
   - Known: the taxonomy is locked at eight names with no truncation bucket; a dropped oldest deal moves only the inception identity.
   - Unclear: whether `unexplained` plus a reason code is acceptable, or a ninth bucket is wanted.
   - Recommendation: `unexplained` with `reason = "inception_identity"`, because `unexplained` is RED until a ruling and adding a bucket re-opens a locked decision. Record the choice in the plan.
2. **What band applies to the inception identity and to exact per-day placement?**
   - Known: `MT5_PARITY_TOLERANCE` is defined for cumulative return, start level and end level only; the pipeline's own zero-start band is `1e-4` of the first-return-day level.
   - Unclear: whether the identity and `day_placement` legs reuse the 1% constant or take a second named constant.
   - Recommendation: `day_placement` reuses `MT5_PARITY_TOLERANCE` (gap in points of E(window start), no second constant), exact placement mismatches reported as ordinals; the identity band is a second, explicitly named constant defined once beside the first, because "about 0" is an equality, not a 1% question. Needs the planner's or founder's confirmation.
3. **Can the oracle fold use the timed flow rule?** Needs a `position_id` per deal; the Deals table likely lacks it (the Positions table may carry it). Until a real export is seen, compare money on flow days and expect `flow_placement`.
4. **If the real Report has no Balance column**, is Gate A allowed to run on the fold path alone (weaker, partly self-referential), or does intake refuse? Recommendation: refuse by default; allow only by a recorded decision.
5. **Which of the three MT5 keys have a `key_inputs:<id>` row?** Unknown until the census. A key without one has no our-side levels or identity; the engine fails that leg closed. If a key lacks the row, the plan may need a census-time note and the identity falls to the oracle side only.
6. **Do the 2026-10-30 and 2026-11-13 marks exist, and is 2026-10-30 at or after each key's `S`?** Measured by `census-edges.sql`; the picker re-picks.
7. **Real-capture run wiring.** The recommended single-test-file design (synthetic by default, `MT5_PARITY_CAPTURE_DIR` for real, throw on a bad dir) avoids a third vitest config. If the planner prefers a separate config like `test:local-stack`, it must add a wiring pin so the file cannot run nowhere.
8. **Credit.** A non-zero `credit` sits in the `equity − balance` wedge; the capture has no `account_info()` read. It can only come from the worksheet (`terminal_reading`). Add it to `required-readings.json`.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Python | pytest, mypy | yes | 3.14.3 local (CI 3.12) | CI is authoritative |
| pandas / numpy | reuse of the MT5 fold | yes (default interpreter; hidden by `python3 -I`) | 3.0.1 / 2.4.3 local (lock 3.0.3 / 2.5.4) | run from the main checkout or a venv |
| pytest | Python tests | yes | 9.0.2 (observed: `tests/test_parity_diff.py` and `tests/test_mt5_server_clock.py`, 69 passed) | — |
| mypy | strict gate | yes | 2.0.0 local (dev pin 2.4.0) | CI is authoritative |
| Node | vitest, tsx | yes | v25.8.1 local (CI 22) | — |
| `node_modules` | vitest | **no** in this worktree | — | `npm ci`, or run vitest/tsx from the main checkout by absolute path |
| PostgreSQL server binaries | exec test | yes | `postgresql@16` (16.13); `--print-pgbin` works | CI selects its own |
| Supabase MCP | PROD census and capture | orchestrator only | — | executors never have it; no fallback |
| MT5 gateway | none | never used | — | forbidden by CONTEXT |

**Missing dependencies with no fallback:** none for the executor work. A real MT5 Report export does not exist yet (155.2 provides it).
**Missing dependencies with fallback:** `node_modules` (install or run from the main checkout).

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | pytest (Python engine, intake, parser, capture loader, purity) and vitest ^5.0.3 (SQL gate, exec, surfaces) |
| Config file | `analytics-service/pytest.ini`, `analytics-service/pyproject.toml::[tool.mypy]`; `vitest.config.ts` (new `src/__tests__/*.test.ts` are collected by the `src/**/*.test.{ts,tsx}` glob; no config change) |
| Quick run command | `cd analytics-service && python3 -m pytest tests/test_mt5_parity_engine.py tests/test_mt5_parity_intake.py tests/test_mt5_report_parser.py tests/test_mt5_parity_capture.py tests/test_mt5_parity_purity.py -x -q -p no:cacheprovider` and `npx vitest run src/__tests__/mt5-parity-capture-sql.test.ts` |
| Full suite command | `cd analytics-service && make test` ; `npm test` ; `cd analytics-service && mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` |

### Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PARITY-01 | enum is exactly three values; refusals for `gateway`, `mt5_soak.reconcile_parity`, `quantalyze`, `""`, `None`, case/space variants name the value | unit | `pytest tests/test_mt5_parity_intake.py -x` | no, Wave 0 |
| PARITY-01 | parser: BOM sniff for UTF-16-LE/BE and UTF-8, no-BOM refusal; unknown, missing-required and duplicate header each raise a named error; relabelled-HTML refused; Type text allow-list; UTF-16 fixture equals BOM + UTF-8 twin | unit | `pytest tests/test_mt5_report_parser.py -x` | no, Wave 0 |
| PARITY-01 | worksheet missing any reading in `required-readings.json` fails naming it; `founder-session.md` names every id | unit + vitest | `pytest tests/test_mt5_parity_intake.py -x`; `npx vitest run src/__tests__/mt5-parity-capture-sql.test.ts` | no, Wave 0 |
| PARITY-02 | one test per bucket; `BUCKET_LABELS` equals the eight names exactly; `unexplained` only after every explainer evaluated; picker refusals (edge < `S`, no mark, window end ≥ run day, deal in the edge gap) | unit | `pytest tests/test_mt5_parity_engine.py -x` | no, Wave 0 |
| PARITY-02 | three RED proofs with byte backup and restore, each naming leg and bucket; vacuity guards | unit | `pytest tests/test_mt5_parity_engine.py -k red_proof -x` | no, Wave 0 |
| PARITY-02 | `MT5_PARITY_TOLERANCE` defined once (AST scan for a second `0.01`); engine purity (transitive closure, anti-vacuity) | unit | `pytest tests/test_mt5_parity_purity.py -x` | no, Wave 0 |
| PARITY-02 | rehearsal verdict is flagged and can never be final GREEN | unit | `pytest tests/test_mt5_parity_engine.py -k rehearsal -x` | no, Wave 0 |
| PARITY-03 | exact `.sql` file-set pin; README names them; one statement; no `--`; no uuid literal; superset write-keyword gate | vitest static | `npx vitest run src/__tests__/mt5-parity-capture-sql.test.ts` | no, Wave 0 |
| PARITY-03 | gate goes RED on a neutered copy, GREEN after byte-backup restore | vitest static | same file | no, Wave 0 |
| PARITY-03 | every statement executes on a throwaway cluster loaded with the extracted real baseline DDL; column-contract test | vitest exec | `npx vitest run src/__tests__/mt5-parity-capture-sql-exec.test.ts` | no, Wave 0 |
| PARITY-03 | `/.mt5-parity/` is in `.gitignore` (literal line) and `git check-ignore` agrees; no tracked file under it; redaction scan clean | vitest static | same static file | no, Wave 0 |
| PARITY-03 | seal: canonical JSON, NaN raises, tamper detected and restored from byte backup, completeness witnesses fail loud on truncation | unit | `pytest tests/test_mt5_parity_capture.py -x` | no, Wave 0 |
| PARITY-04 | census SQL against hand-computed oracles on a seeded fixture: `S` (three sources, a disagreement), Friday open-P&L ratio, flag key list, unit, published status, record length, `computed_at`, inception ratio (a complete ledger near 0 and a truncated one near −1) | vitest exec | `npx vitest run src/__tests__/mt5-parity-capture-sql-exec.test.ts` | no, Wave 0 |
| MT5-09 data layer | surface matrix on the synthetic capture: agreement GREEN; one neutered input column makes the named surface differ; "not rendered while unpublished" cells | vitest | `npx vitest run src/__tests__/mt5-parity-surfaces.test.ts` | no, Wave 0 |
| MT5-15 | classification table covers every `NAV_TWR_GUARD_KEYS`, annotation key and marks key; an unseen key lands in `unknown` | unit | `pytest tests/test_mt5_parity_engine.py -k flags -x` | no, Wave 0 |
| redaction | the rendered verdict has no number over 3 s.f. except ordinals and day counts; refuses extra keys | unit | `pytest tests/test_mt5_parity_engine.py -k render -x` | no, Wave 0 |

**RED-proof mechanics, uniformly:** (1) write the byte backup and its sha256; (2) apply the neuter or break to a COPY; (3) assert the bytes changed in the intended place (a neuter that does not apply reads as GREEN); (4) run the check, assert RED naming the file, leg or bucket; (5) restore from the byte backup; (6) assert sha256 equals the original; (7) run the check, assert GREEN. Never `git checkout`, `restore` or `stash` on uncommitted work. For code-level mutants (a closed set widened, a tolerance relaxed), apply them with `monkeypatch` to the checker under test and assert the suite's own check function returns RED; do not use `importlib.reload`.
The hand-run copy of the three proofs in the phase record uses the dress-rehearsal inputs the same way and records only buckets and ratios.

### Sampling Rate

- **Per task commit:** the quick run command for the files touched.
- **Per wave merge:** all five pytest files, the three vitest files, and `mypy` over the three new `services/` modules.
- **Phase gate:** full suite and the full mypy surface green; `node scripts/lint-sql-gates.mjs --self-test` and the SRO test untouched and green; the by-hand dress rehearsal recorded.

### Wave 0 Gaps

- [ ] `analytics-service/tests/test_mt5_parity_engine.py`, `test_mt5_parity_intake.py`, `test_mt5_report_parser.py`, `test_mt5_parity_capture.py`, `test_mt5_parity_purity.py`
- [ ] `analytics-service/tests/fixtures/mt5_parity/` (UTF-8 and UTF-16-LE synthetic Reports, a synthetic worksheet, a synthetic capture) designed backward from the three mutations
- [ ] `src/__tests__/mt5-parity-capture-sql.test.ts`, `mt5-parity-capture-sql-exec.test.ts`, `mt5-parity-surfaces.test.ts`
- [ ] `docs/runbooks/mt5-parity/` (SQL set, README, `required-readings.json`, `founder-session.md`)
- [ ] `.gitignore` line `/.mt5-parity/`
- [ ] Framework install: none; `npm ci` in a fresh worktree

## Security Domain

`security_enforcement` is absent from `.planning/config.json`, so this section is required.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | no login surface is added; PROD access is the orchestrator's existing MCP session |
| V3 Session Management | no | — |
| V4 Access Control | yes | PROD is read-only through the MCP by the orchestrator only; executors have no MCP; the write-keyword gate and the marker query are the only guards |
| V5 Input Validation | yes | the Report parser and the worksheet intake are the untrusted-input boundary: closed header allow-list, closed Type table, strict number and time parsing, finite-only, size cap, no execution of content |
| V6 Cryptography | no | sha256 is an integrity seal for a local file, not a security control; no key handling |
| V7 Error Handling and Logging | yes | fixed-sentence errors that name a column or leg, never a value (the `mt5_deals` leak-safe convention); no amount in any log or message |
| V8 Data Protection | yes | public repo: raw capture and oracle files stay in the gitignored `/.mt5-parity/`; the tracked record is code-rendered from a no-money type |
| V12 Files and Resources | yes | the loader reads only inside the capture directory (no path from file content), refuses symlinks, caps size |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| A census or capture file that writes (`SELECT ... INTO`, `MERGE`, `DO`) rides the standing PROD-read authorization | Tampering | superset write-keyword gate, one-statement rule, exec test on a throwaway cluster, marker first |
| Account identity leaks into tracked text (login, label, server, uuid, comment text, header block) | Information disclosure | ordinals only, `venue_account_id` and `label` never selected into tracked output, parser drops the header block, redaction scan, code-rendered verdict |
| An oracle that is secretly our own pipeline | Spoofing | provenance enum with named refusals; the synthetic marker; the dress rehearsal flagged |
| A hostile or malformed Report file | Tampering / DoS | `html.parser` (no entity expansion of external resources), size cap, closed vocabularies, refuse rather than coerce |
| MCP result text treated as instructions (prompt injection through a database string) | Spoofing | the orchestrator strips the untrusted-data wrapper and the loader treats results as data only |
| Markdown injection into the verdict document | Tampering | the renderer emits only fixed words, ordinals and numbers; escapes any free text (there is none by construction) |
| Mid-capture derive mixes two runs | Tampering | `bind.sql` before and after; any change voids the capture |

## Sources

### Primary (HIGH confidence, repo at HEAD `731ab87eb`, read this session)
- `analytics-service/services/`: `parity_diff.py`, `broker_dailies.py` (`_fold_mt5_deals`, `mt5_day_pnl`, `reconstruct_mt5_nav_levels`, `combine_mt5_deal_ledger`), `mt5_deals.py`, `mt5_server_clock.py`, `nav_marks_apply.py`, `nav_twr.py` (`NAV_TWR_GUARD_KEYS`, annotation keys), `account_unit.py`, `wealth_returns.py`, `allocator_equity_derive.py` (`_INCEPTION_ZERO_START_BAND`, `realized_terminal_payload`, `writer_basis_payload`), `job_worker.py` (`_persist_key_inputs`, `WRITER_BASIS_VENUES`, `is_key_mode`, `_run_key_mode_compose_epilogue`), `analytics_runner.py` (`marks_since` flags)
- `analytics-service/pyproject.toml`, `requirements.txt`, `requirements-dev.txt`, `Makefile`, `tests/test_mt5_server_clock.py`, `tests/fixtures/mt5/` (EA CSVs, unrelated)
- `supabase/schema/baseline.sql` (`strategies`, `strategy_analytics`, `strategy_analytics_series`, `api_keys`, `api_key_nav_marks`, `allocator_equity_derived`, `csv_daily_returns`, `benchmark_prices`, `allocator_holdings`, `strategy_keys`); a bare-cluster apply of those blocks
- `docs/runbooks/marksource-okx-census/` (`README.md`, `marker.sql`, `okx-nonworking-keys.sql`), `src/__tests__/marksource-okx-census-sql.test.ts`, `src/__tests__/marksource-okx-nonworking-keys-exec.test.ts`, `scripts/pg-lane/run.sh`
- `src/lib/visibility.ts`, `src/lib/queries.ts` (`getMyStrategies`, `getStrategiesByCategory`, `getOwnCapitalStrategies`, `getMyAllocationDashboard`, `liveBaselineMetricsFromPerKeyDailies`), `src/lib/factsheet/` (`fetch-and-build-payload.ts`, `build-payload.ts`, `resolve-series.ts`, `og-metrics.ts`, `composite-read-path.ts::readSingleKeyBasisOpts`), `src/lib/figure-gate.ts`, `src/app/factsheet/[id]/page.tsx`, `src/app/api/strategies/[id]/returns/route.ts`, `src/app/api/og/factsheet/[id]/route.tsx`, `src/app/api/factsheet/[id]/pdf/route.ts`, `src/app/(dashboard)/allocations/`, `vitest.config.ts`, `vitest.local-stack.config.ts`
- `.planning/phases/155-*/155-CONTEXT.md`, `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md` (Phase 155), `.planning/research/SUMMARY.md`, `ARCHITECTURE.md`, `PITFALLS.md`, `STACK.md`

### Secondary (MEDIUM confidence)
- [MetaTrader 5 Help, Trading Report](https://www.metatrader5.com/en/terminal/help/trading_advanced/history_report): sections, template name, Summary fields; no column names, no encoding statement
- [MQL5 article 5436, analyzing HTML reports](https://www.mql5.com/en/articles/5436): one table with `<th>` and `<td>` cells

### Tertiary (LOW confidence)
- a third-party MT5 report parser (`huggingface.co/algorembrant/mt5-analyzer`, `parser.js`): UTF-8 read, 13-cell Deals rows, Balance at cell 12, no Fee column; evidence of variation, not a specification

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH, read from the lock files; no package added.
- Architecture and engine reuse: HIGH for import graphs, signatures and stored-row shapes (opened and measured); MEDIUM for the counterfactual explainer design (a recommendation to be tested, not an existing component).
- Surface slice: HIGH for visibility and loaders (opened); MEDIUM for how cleanly the real-capture rows fake through `createAdminClient`.
- Report parser: LOW, nothing measured; the contract is built to refuse rather than assume.
- Pitfalls: HIGH for the RED-proof mechanics (derived from the code), MEDIUM for broker behaviour.

**Research date:** 2026-11-13
**Valid until:** 2026-11-20 for the Report format (the first real export in 155.2 supersedes it); 30 days for the repo facts, provided `broker_dailies`, `mt5_deals`, `queries.ts` and the baseline do not change (re-grep the symbols cited above before planning).
