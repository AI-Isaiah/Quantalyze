---
phase: 155-parityharness-an-agent-built-harness-can-prove-our-mt5-numbe
verified: 2026-11-14T01:40:00Z
status: passed
score: 5/5 must-haves verified
verified_at_sha: 6be218dbad4254c914c8461d6a8a92ff914da852
drift_subjects:
  - analytics-service/services/mt5_parity.py
  - analytics-service/services/mt5_parity_capture.py
  - analytics-service/services/mt5_parity_findings.py
  - analytics-service/services/mt5_parity_intake.py
  - analytics-service/services/mt5_parity_proofs.py
  - analytics-service/services/mt5_parity_report.py
  - analytics-service/scripts/mt5_parity_records.py
  - analytics-service/scripts/mt5_parity_run.py
  - docs/runbooks/mt5-parity/capture-contract.json
  - docs/runbooks/mt5-parity/required-readings.json
  - src/__tests__/mt5-parity-capture-sql.test.ts
  - src/__tests__/mt5-parity-capture-sql-exec.test.ts
  - src/__tests__/mt5-parity-surfaces.test.ts
behavior_unverified: 0
overrides_applied: 0
---

# Phase 155: PARITYHARNESS Verification Report

**Phase Goal:** Before the founder sits at the terminal, an agent-built harness captures our side from PROD read-only, accepts only external oracle inputs, and returns a per-account verdict it has been shown able to fail. Every check that needs no founder (the PROD census, the MT5-09 data layer, the MT5-15 flags) is already measured, so its findings reach the fix loop early.
**Verified:** 2026-11-14
**Status:** passed (a DRESS REHEARSAL is the expected end state; the founder terminal session belongs to 155.2)
**Re-verification:** No, initial verification

Public repo: this report names account labels only. No raw value, login, server or amount from the sealed PROD capture appears here. The capture was exercised only on a scratchpad copy, now deleted.

## Goal Achievement

### Observable Truths (ROADMAP success criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | SC-1 (PARITY-04): a pre-flight census, read by SELECT only with the marker first, records for MM2, MM3 and FX-AI_V: S, open P&L at the Friday edges, flags, unit, published status, record length, `computed_at`, inception identity | VERIFIED | `155-CENSUS.md` has all three accounts with every required column (S from three stored sources and `S agree`, unit, `private` status, marks, record span, `computed_at`, flag keys, server `unmeasured (155.1 reading owns it)`, inception identity as a ratio within band) and six Friday-edge rows. I re-ran `mt5_parity_records census` on a scratchpad copy of the sealed capture and the output is byte-identical to the tracked file. `marker.sql` is the first file and `bind.sql` is run before and after (`bind-before.json`, `bind-after.json` in raw/). |
| 2 | SC-2 (PARITY-03): our side captured from persisted PROD rows by versioned SELECT-only SQL behind a write-keyword gate shown able to fail; raw figures stay untracked | VERIFIED | 14 versioned `.sql` files in `docs/runbooks/mt5-parity/`. A fresh keyword grep over them (insert, update, delete, drop, alter, create, truncate, grant, copy, call, do, into, set, lock, dblink, nextval) found nothing. `mt5-parity-capture-sql.test.ts` plus the exec test: 235 passed, including the neuter/RED/byte-restore/GREEN tests, the Unicode-escape rule and the function allowlist. `.gitignore` carries `/.mt5-parity/` and a test pins it. `git ls-files` lists no capture file. `scan --profile record` over the four records exits 0. Sealing detects tampering: a one-byte flip in a sealed slice makes `findings` exit 2 with `CaptureRefused: sealed file ... no longer matches its sha256` and write nothing. |
| 3 | SC-3 (PARITY-01): every expected value carries provenance `terminal_reading`, `terminal_report_export` or `broker_statement`; any other source is refused by name; header-based intake, fail loud on unknown header or an incomplete worksheet | VERIFIED | `PROVENANCE_VALUES` is exactly those three. I probed `require_provenance`: `gateway`, `mt5_soak.reconcile_parity`, `quantalyze`, empty, `None`, a leading-space value, `TERMINAL_READING` and an int are all refused (exact membership, no coercion). The three allowed values pass. The Report parser (`mt5_parity_report.py`) has distinct `UnknownHeader`, `MissingHeader` and `DuplicateHeader` refusals, locates columns by header text, and handles UTF-16 and UTF-8. `required-readings.json` is the single list shared by `founder-session.md` and `require_complete`, which raises `WorksheetIncomplete`. The parser is exercised on a synthetic fixture only; no real export exists yet, as the roadmap allows. |
| 4 | SC-4 (PARITY-02): RED on a reclassified BALANCE deal, a one-hour clock shift and a dropped oldest deal; GREEN after byte-backup restore; dress rehearsal against the one `MT5_PARITY_TOLERANCE = 0.01` | VERIFIED | I re-ran `mt5_parity_run red-proof --mutation all` on the committed synthetic pair myself (exit 0, 3 proofs). Each mutated verdict is RED with the expected bucket (`flow_placement`, `clock_mismatch`, `unexplained`). Each restored sha256 is equal, the restored verdict is byte-identical and restored passed is yes (GREEN). Fixture sha256s are unchanged afterwards. `MT5_PARITY_TOLERANCE` has one definition (`services/mt5_parity.py:54`); `test_mt5_parity_purity.py` pins that and the engine's transitive import closure (no gateway, DB or network). The grep over the six harness modules and two CLIs found no `mt5_client`, `mt5_read`, `mt5_soak`, enqueue or `_compute_portfolio_analytics`. `155-DRESS-REHEARSAL.md` records per-account verdicts for MM2, MM3 and FX-AI_V, bannered "synthetic oracle", with `final_green` false. |
| 5 | SC-5: MT5-09 data-layer surface matrix on the fixed surface list, cited by symbol, and every MT5-15 flag classified; every discrepancy a named finding with a root-cause lead; nothing fixed silently | VERIFIED | `mt5-parity-surfaces.test.ts` defines 9 surfaces cited by symbol (`fetchAndBuildPayloadWithReason`, `computeOgHeadline`, `toStrategyRows`, `liveBaselineMetricsFromPerKeyDailies + liveBookFigures`, `buildPerKeyStrategyForBuilderSet + computeScenario`, `shapeRowAnalytics + gateAnnualized + gatedValue` and others). Locked decisions are honoured: unpublished surfaces are recorded as `not_rendered_while_unpublished`, nothing is published. 14 synthetic tests pass, and 15 pass in real mode on the scratchpad copy. `findings` re-run on the copy is byte-identical to `155-FINDINGS.md`: 29 named findings (3 cross_store, 3 flag, 23 surface) plus observations, and proposed classes for 4 flags per account (`csv_source` unknown, three explained_acceptable). No product code changed. The diff against `origin/main` in `src/` (non-test), `supabase/` and the service entry points is empty, so nothing was fixed silently. Each finding carries a fixed-template `lead` sentence (the `Finding.lead` field) naming the surfaces, days and gap size involved; most are bucket `unexplained`, so the lead locates the discrepancy and does not diagnose it (see Advisory). |

**Score:** 5/5 truths verified, 0 present-but-behavior-unverified. Every behavior-dependent truth (RED on mutation, restore, refusal paths, the gate failing on a neutered copy) has a passing test or a command I ran myself.

### Required Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `analytics-service/services/mt5_parity.py` (engine, `MT5_PARITY_TOLERANCE`, closed taxonomy) | VERIFIED | Substantive (1310 lines), imported by the CLIs and proofs, purity pinned. |
| `mt5_parity_intake.py`, `mt5_parity_report.py` | VERIFIED | Wired into `mt5_parity_run`; refusals demonstrated. |
| `mt5_parity_capture.py` (seal, manifest v2) | VERIFIED | Sealed capture re-seals exit 0; tamper refused exit 2. |
| `mt5_parity_findings.py`, `mt5_parity_proofs.py` | VERIFIED | Their outputs reproduce byte for byte. |
| `docs/runbooks/mt5-parity/*.sql` (14), `capture-contract.json`, `required-readings.json`, `founder-session.md`, `README.md` | VERIFIED | Present, gated, executed against the baseline DDL by the exec test. |
| `src/__tests__/mt5-parity-*.test.ts` (3) | VERIFIED | 249 tests pass (235 SQL gate and exec, 14 surfaces); 15 with the real capture copy. |
| `155-CENSUS.md`, `155-DRESS-REHEARSAL.md`, `155-RED-PROOF.md`, `155-FINDINGS.md` | VERIFIED | Present, record-profile scan exits 0, census and findings regenerate identically. |

### Key Link Verification

| From | To | Status | Details |
|------|----|--------|---------|
| capture SQL, run by the orchestrator via MCP | `.mt5-parity/<run>/raw` then `sealed/` | WIRED | `seal` verifies witnesses and writes sha256 sidecars; `census` and `findings` read only sealed copies. |
| sealed capture | surface matrix, then findings | WIRED | `findings` refuses a matrix whose `capture_manifest_sha256` is not the sealed manifest's. |
| `required-readings.json` | founder script and `require_complete` | WIRED | One file, two consumers. |
| worksheet, Report | verdict | WIRED | `bind_report` binds by sha256; a synthetic bundle is refused against a real worksheet. |

### Data-Flow Trace (Level 4)

The census and findings values flow from stored PROD rows, through the sealed capture, to the tracked record. Both records regenerate identically from the sealed copy, so they are not hardcoded. The surface matrix runs the real loaders and computations on those rows.

### Behavioral Spot-Checks

| Behavior | Command (run from the worktree) | Result | Status |
|----------|---------|--------|--------|
| Phase pytest suite | `python3 -m pytest tests/test_mt5_parity_*.py tests/test_mt5_report_parser.py -q` | 330 passed | PASS |
| CI mypy strict | the CI mypy command | no issues in 138 source files | PASS |
| SQL gate and exec | `npx vitest run mt5-parity-capture-sql*.test.ts` | 235 passed | PASS |
| Surface matrix, synthetic and real copy | `npx vitest run mt5-parity-surfaces.test.ts` (with and without `MT5_PARITY_CAPTURE_DIR`) | 14 and 15 passed | PASS |
| RED proofs | `mt5_parity_run red-proof --mutation all` on the synthetic pair | exit 0, 3 of 3 met expectation | PASS |
| Records reproduce | `census` and `findings` on the copy, diffed against tracked files | byte-identical | PASS |
| Seal tamper | flip one byte of a sealed slice, run `findings` | exit 2, nothing written | PASS |

### Probe Execution

No `probe-*.sh` is declared by the phase. Step 7c skipped.

### Requirements Coverage

| Requirement | Source plans | Description | Status | Evidence |
|-------------|--------------|-------------|--------|----------|
| PARITY-01 | 01, 05, 07 | Provenance-locked expected values | SATISFIED | Truth 3 |
| PARITY-02 | 01, 06, 07, 11 | RED on three broken inputs, GREEN after restore | SATISFIED | Truth 4 |
| PARITY-03 | 01, 02, 03, 04, 08, 09, 10, 11 | SELECT-only versioned capture, write-keyword test, untracked raw | SATISFIED | Truth 2 |
| PARITY-04 | 02, 04, 08, 10 | Pre-flight census | SATISFIED | Truth 1 |

All four IDs appear in plan frontmatter and in REQUIREMENTS.md. No orphaned requirement is mapped to Phase 155. `REQUIREMENTS.md` still shows them as Pending; the orchestrator updates that bookkeeping on close.

### Anti-Patterns Found

No TBD, FIXME or XXX debt markers were added in the phase's source files. The records scan is clean. The `SUMMARY` files hit the scanner's `digit_run_5` and `long_hex` rules, because they cite commit hashes and run ids. The `sig_figs_gt_3` hits are a synthetic worksheet figure and a hypothetical `1.2` math check. These are not record-profile files and carry no real value. I confirmed the `0.105883646941` figure in plan 09's summary is a synthetic fixture value.

### Human Verification Required

None for this phase. The founder terminal session (MT5-07 final GREEN, Gate A and B against real readings), the render-layer MT5-09 gate and the MT5-15 sign-offs are Phase 155.2 by the locked scope.

## Advisory (not blocking)

1. **IN-02 stays open.** `census` still renders from a manifest that `findings` and `verdict` would refuse, a disagreement between commands. It re-hashes both census files, so no wrong record can result. The review disposition recorded it as below the fix bar.
2. **Findings' leads locate rather than diagnose.** Each of the 29 findings has a template `lead` sentence (surface, figure, days, gap in units of the tolerance), but 26 are bucket `unexplained` and carry no causal hypothesis. 155.2's MT5-10 fix loop starts from the located discrepancy and must find the cause. This matches the locked scope (nothing diagnosed or fixed in 155), so it is recorded, not a gap.
3. **Dress rehearsal Part 1 is refusal-only on real accounts.** Gate A reaches the first mark (2026-10-26) and Gate B ends on the run day, so both are `window_refused`. Part 2 (the picker's windows) exercises the evaluation legs, and the synthetic oracle does not match real magnitudes, so those breach or read `not_measurable:unit_mismatch`. The record says plainly that this proves the pipeline runs and nothing about parity. This is the stated expected outcome.
4. **Report parser is untested on a real export.** Only the synthetic UTF-16 and UTF-8 fixtures exist, as the roadmap allows. The first real export in 155.2 is the first true test of the header contract.

## Gaps Summary

No gaps. The harness exists, is wired, is shown able to fail (RED on all three mutations, the SQL gate, tamper refusal), reproduces its tracked records from the sealed PROD capture, and made no product change. The census and findings that need no founder are measured. The cleared items are the CI mypy gate, 330 pytest and 249 vitest tests (15 more with the real capture copy), all re-run by me at HEAD.

---

_Verified: 2026-11-14T01:40:00Z_
_Verifier: Claude (gsd-verifier)_
