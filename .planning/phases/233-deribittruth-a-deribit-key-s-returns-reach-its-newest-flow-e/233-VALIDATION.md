---
phase: "233"
slug: "deribittruth"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-24"
---

# Phase 233 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Filled at plan time from `233-RESEARCH.md` "Validation Architecture". Counts are read from runs, never restated here.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | prober self-test (node built-ins, fixtures); vitest (wiring and whole-tree pins); pytest (analytics-service) |
| **Config file** | `scripts/prod-prober/run.mjs --self-test`; `package.json` `"test": "vitest run"`; `analytics-service/pytest.ini` (`testpaths = tests`, `pythonpath = .`) |
| **Quick run command** | `node scripts/prod-prober/run.mjs --self-test`; from `analytics-service/`: `.venv/bin/python -m pytest tests/test_deribit_txn.py tests/test_deribit_book_oracle.py -q -p no:cacheprovider` |
| **Full suite command** | `npx vitest run src/__tests__/prod-prober-wiring.test.ts` plus the plan 233-04 Task 3 reader list; from `analytics-service/`: `.venv/bin/python -m pytest -n auto --dist loadgroup -q -rfE -p no:cacheprovider` (CI runs it against the local-stack lane) and CI's strict mypy command |
| **Estimated runtime** | self-test under 1 s (0.2 s measured at HEAD); targeted pytest about 10 to 30 s; full pytest several minutes under load (run in background) |

Environment: each plan builds its own in its own worktree (`npm ci`; a `python3.13` venv at `analytics-service/.venv` from the committed requirements, ccxt 4.5.89 checked). Never the system `python3` or another checkout's venv.

---

## Sampling Rate

- **After every task commit:** the quick run for the file touched (self-test for prober files; the touched pytest module for Python files).
- **After every plan wave:** `npx vitest run src/__tests__/prod-prober-wiring.test.ts` plus the touched pytest modules and CI's strict mypy command.
- **Before `/gsd-verify-work`:** every plan's pre-push gates green (or a failure proven pre-existing at the base commit and quoted).
- **Max feedback latency:** 60 seconds for the quick runs (the full pytest suite runs in background and is not part of the per-task loop).

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 233-01-01 | 01 | 1 | DBOOK-02 | T-233-01 | A capital reason with a trading token and no capital word is not trading P&L; both aggregators fail loud | unit (tracer) | `cd analytics-service && .venv/bin/python -m pytest "tests/test_deribit_txn.py::test_correction_capital_reason_with_trading_token_and_no_capital_word_fails_loud" -q` | ✅ module exists, test new | ⬜ pending |
| 233-01-02 | 01 | 1 | DBOOK-02, PROOF-01 | T-233-01, T-233-02 | Each correction shape classifies as designed through the classifier and both aggregators | unit | `cd analytics-service && .venv/bin/python -m pytest tests/test_deribit_txn.py -k correction -q` | ✅ | ⬜ pending |
| 233-02-01 | 02 | 1 | FRESH-02, FRESH-01 | T-233-03, T-233-04 | A held-back series end pages; stated left-out days cover; a failed or unparsable read is measure-fail; no id in output; SELECT-only SQL; floor, registry, pins and workflow text move in one commit | prober self-test (tracer) | `node scripts/prod-prober/run.mjs --self-test` and `npx vitest run src/__tests__/prod-prober-wiring.test.ts` | ❌ W0: `arms/freshness.mjs`, `fixtures/freshness/ok.json`, `stale.json` | ⬜ pending |
| 233-02-02 | 02 | 1 | FRESH-02, PROOF-01 | T-233-05, T-233-06 | Every reader of the prober registry and the workflow is green at floor 5 | vitest | `npx vitest run src/__tests__/prod-prober-wiring.test.ts src/__tests__/prod-prober-incident.test.ts src/__tests__/critical-regressions.test.ts` | ✅ | ⬜ pending |
| 233-03-01 | 03 | 1 | DBOOK-01 | T-233-09 | The oracle reproduces a hand-derived book and imports no production helper | unit (tracer) | `cd analytics-service && .venv/bin/python -m pytest tests/test_deribit_book_oracle.py -q` | ❌ W0: oracle, test, first fixture | ⬜ pending |
| 233-03-02 | 03 | 1 | DBOOK-01, PROOF-01 | T-233-08, T-233-09 | Each withheld class, the key-set STOP and the VACUOUS verdict fire on their own fixtures; the oracle cannot go green by withholding everything | unit | `cd analytics-service && .venv/bin/python -m pytest tests/test_deribit_book_oracle.py -q` | ❌ W0 (created by 233-03-01) | ⬜ pending |
| 233-04-01 | 04 | 2 | FRESH-02, PROOF-01 | T-233-05 | An empty scope pages; truncated, renamed, malformed or failed reads are measure-fail, never green; the scope log line A5 reads is pinned | prober self-test | `node scripts/prod-prober/run.mjs --self-test` | ✅ (created by 233-02-01) | ⬜ pending |
| 233-04-02 | 04 | 2 | FRESH-02 | T-233-05 | Partial cover and bound+1 page; an anchor reason on one key never covers another | prober self-test | `node scripts/prod-prober/run.mjs --self-test` | ✅ | ⬜ pending |
| 233-04-03 | 04 | 2 | FRESH-02, PROOF-01 | T-233-05, T-233-03 | The arm's SQL field names stay bound to their writers; every prober and workflow reader green | vitest | `npx vitest run src/__tests__/prod-prober-wiring.test.ts -t "233 FRESH-02"` | ✅ file exists, describe new | ⬜ pending |
| 233-05-01 | 05 | 2 | DBOOK-01, PROOF-01 | T-233-09 | Emptied, omitted, annotated, carried and rotated days each on a fixture; every day in one closed class; annotations never null; copied constants pinned | unit | `cd analytics-service && .venv/bin/python -m pytest tests/test_deribit_book_oracle.py -q` | ✅ (created by 233-03-01) | ⬜ pending |
| 233-05-02 | 05 | 2 | DBOOK-01, PROOF-01 | T-233-08, T-233-10 | Redaction, export-id refusal, read-only `--print-sql` | unit | `cd analytics-service && .venv/bin/python -m pytest tests/test_deribit_book_oracle.py -q` | ✅ | ⬜ pending |
| 233-05-03 | 05 | 2 | DBOOK-01 | T-233-08, T-233-11 | PROD reading through MCP, marker first, letters only; STOP becomes a founder question | manual (orchestrator checkpoint) + SUMMARY grep | Task 3 verify (prints `DBOOK01_OK`) | n/a | ⬜ pending |
| 233-06-01 | 06 | 3 | FRESH-01 | T-233-12, T-233-13, T-233-14 | 2026-11-25 first counted day on D1..D3, no gap rows, stated days cover, arm sees 0 uncovered; A5 proven by a prober run or recorded unproven with a post-merge owner | manual (orchestrator checkpoint, date-gated) + SUMMARY grep | Task 1 verify (prints `FRESH01_OK`) | n/a | ⬜ pending |
| 233-06-02 | 06 | 3 | FRESH-01 | T-233-13 | The diagnosis record carries the dated verification, letters only | file grep | Task 2 verify (prints `RECORD_OK`) | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `scripts/prod-prober/arms/freshness.mjs` and `scripts/prod-prober/fixtures/freshness/*.json`: FRESH-02 (created by 233-02-01; fixtures added by 233-04-01 and 233-04-02)
- [ ] `analytics-service/scripts/deribit_book_oracle.py`, `analytics-service/tests/test_deribit_book_oracle.py`, `analytics-service/tests/fixtures/deribit_book_oracle/*.json`: DBOOK-01 (created by 233-03-01; fixtures added by 233-03-02 and 233-05-01)
- [ ] new correction-shape tests in `analytics-service/tests/test_deribit_txn.py`: DBOOK-02 (233-01-01 and 233-01-02)
- [ ] `npm ci` and a `python3.13` venv with ccxt 4.5.89 in each plan's worktree (first step of each code plan)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| The founder's Deribit book reading (every day explained, withheld or omitted by name) | DBOOK-01 | Executors have no PROD access; the reading is an orchestrator MCP read (orchestrator decisions O1/O4) | 233-05 Task 3: marker query, `--print-sql`, MCP reads one per call, export in the scratchpad, `--input`, verbatim reading in the SUMMARY; STOP becomes a founder question |
| The 2026-11-26 confirmation that 2026-11-25 is the first counted day | FRESH-01 | Date-gated PROD reading, orchestrator only | 233-06 Task 1: five checks plus the arm reading; falsification reopens FRESH-01 |
| The prober role reads the tables the arm needs (A5) | FRESH-02 | Only a run of the prober proves the prober role's read; an MCP read runs under another role and never counts; a denied read is loud (`freshness-no-scope` or the terminal `measure-fail`), and an RLS denial shows as zero counts on the scope line | 233-06 Task 1 step 6a: `fresh02-a5: proven` with the run id and non-zero scope counts, or `unproven` with the post-merge item in 233-06's ship handoff (owner: the phase orchestrator after the merge); an unproven A5 stays human_needed, never passed |

---

## PROOF-01 arms (each recorded verbatim in its plan SUMMARY)

| Plan | Arms |
|------|------|
| 01 | dbook02-headline, dbook02-structured-name, dbook02-near-miss |
| 02 | fresh-a-bound, fresh-c-anchor, fresh-d-unregistered |
| 03 | oracle-identity, oracle-independence, oracle-withheld-closed, oracle-vacuity, oracle-key-set |
| 04 | fresh-b-per-day, fresh-e-scope, fresh-f-terminal, fresh-g-count, fresh-h-binding |
| 05 | oracle-annotation-not-null, oracle-omission, oracle-parity, oracle-redaction, oracle-export-id |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s for the quick runs
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
