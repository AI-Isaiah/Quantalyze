# Phase 155: PARITYHARNESS — an agent-built harness can prove our MT5 numbers wrong before the founder sits down - Context

**Gathered:** 2026-11-13
**Status:** Ready for planning

> Public repo: account labels only (MM2, MM3, FX-AI_V). No login, server name, amount, PROD id or home path in any tracked file this phase writes.

<domain>
## Phase Boundary

Phase 155 builds the agent-side half of the MT5 parity verification, with no founder in the loop:

1. a read-only PROD pre-flight census per account (PARITY-04);
2. versioned SELECT-only capture SQL behind a write-keyword gate, which feeds an untracked capture directory (PARITY-03);
3. a provenance-locked oracle intake: the founder's worksheet plus an MT5 All-History Report, parsed by column header, against a synthetic fixture until a real export exists (PARITY-01);
4. a pure compare engine with a closed, fail-closed taxonomy and the one constant `MT5_PARITY_TOLERANCE = 0.01`, shown RED on three deliberately broken inputs and GREEN again after a byte-backup restore, plus a dress rehearsal on synthetic oracle files against a real PROD capture (PARITY-02);
5. pre-verification for 155.2: the MT5-09 surface matrix at the data layer on the surface list fixed below, and the MT5-15 flag classification from stored data. Every discrepancy is recorded as a named finding with a root-cause lead. Nothing is fixed here.

Out of this phase:
- the live server-clock reading and its migration (Phase 155.1);
- the founder session, the render-layer gate and the MT5-10 fix loop (Phase 155.2);
- any gateway call, any derive or sync enqueue, and any PROD write.

</domain>

<decisions>
## Implementation Decisions

### Founder decisions (LOCKED — AskUserQuestion, 2026-11-13, relayed by the coordinator)

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

### Harness architecture (recommended defaults, accepted in autonomous mode)

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

### Capture, redaction and PROD access

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

### RED proofs and dress rehearsal

- **Three broken inputs,** each applied to a byte copy of the synthetic oracle or the capture:
  1. a reclassified BALANCE deal (a deposit relabelled as trading P&L, or the reverse);
  2. a one-hour clock shift on deal times;
  3. the oldest deal dropped.
  Each must flip the per-account verdict to RED, with the expected bucket named. After a byte-backup restore, the verdict must be GREEN again.
  - These run as automated tests (synthetic) AND once by hand in the phase record against the dress-rehearsal inputs.
- **Dress rehearsal:** synthetic oracle files plus a REAL PROD capture produce a per-account verdict document.
  - The expected outcome is RED/`unexplained` or `pre_mark_realized_basis` wherever a synthetic oracle disagrees with real data. The rehearsal proves the pipeline runs end to end. It proves nothing about parity.
  - The tracked verdict document holds labels, buckets and ratios only.

### MT5-09 matrix and MT5-15 classification

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

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `analytics-service/services/parity_diff.py`: a pure, fail-closed delta-bucket classifier. It is the pattern precedent for the engine; reuse its shape and do not fork it.
- `docs/runbooks/marksource-okx-census/` + `src/__tests__/marksource-okx-census-sql.test.ts`: the precedent for one-statement-per-file census SQL and its test gate (now RETIRED as a live read, still the pattern).
- `analytics-service/services/broker_dailies.py::_fold_mt5_deals`, `nav_marks_apply`, `nav_twr`, `mt5_server_clock.py`, `account_unit.py`: the engine reuses these for realized-path reconstruction and day bucketing, and never re-implements them.
- `src/lib/factsheet/compute.ts`, `scenario.ts`, `portfolio-stats.ts`, `figure-gate.ts`: candidate surface computations for MT5-09. Re-locate "strategy detail" (`(dashboard)/strategies/[id]/`) and confirm the factsheet loader (`src/app/factsheet/[id]`) at research.

### Established Patterns
- Read-only PROD census: marker first, one statement per file, amounts kept to a scratch directory, tracked text limited to counts, labels and ratios.
- Data-integrity gates must be able to fail: neuter, see RED, restore from a byte backup (never git checkout).
- pytest only from `analytics-service/`. CI runs mypy strict on analytics code. Never `importlib.reload` in tests.

### Integration Points
- New: `docs/runbooks/mt5-parity/` (SQL + README + founder-session script), `analytics-service/services/mt5_parity*.py`, tests in `analytics-service/tests/` and `src/__tests__/`, and a `.gitignore` line for `/.mt5-parity/`.
- No migration, no route and no UI change in this phase.

</code_context>

<specifics>
## Specific Ideas

- `MT5_PARITY_TOLERANCE = 0.01` is ONE named constant. Tests import it; none restates it.
- Candidate Friday edges: Fri 2026-10-30 (W0) and Fri 2026-11-13 (W1, the D-E weekend reading). Gate A's window straddles the DST divergence week 2026-10-25..11-01 and includes a flow and a month-end where the record allows.
- The founder-session script (`docs/runbooks/mt5-parity/founder-session.md`) is written here, so 155.2 runs it. It lists every reading the worksheet requires, from the same source list the intake checks.

</specifics>

<deferred>
## Deferred Ideas

- Live server-clock reading and the per-server clock if the servers differ: Phase 155.1 / parked MT5SERVERLEARN.
- Render-layer MT5-09 gate, the founder session, the MT5-10 fixes and the MT5-15 sign-offs: Phase 155.2.
- Publishing MT5 strategies or a "verified" badge: out of milestone scope until 155.2 passes.

</deferred>

## Correction 2026-11-14 (code review round 3)

Plan 08 treated a `short` figure gate like `withheld` in the findings classifier. That contradicted `src/lib/figure-gate.ts` (the short window never withholds a figure) and the 2026-11-07 KPI-gate decision. Only `withheld` now exempts a cell from presence and value comparison (commit 58f3d6d21).
