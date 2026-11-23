---
phase: "155"
slug: "parityharness-an-agent-built-harness-can-prove-our-mt5-numbers-wrong-before-the-founder-sits-down"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
status: validated
nyquist_compliant: true
wave_0_complete: true
created: "2026-11-13"
---

# Phase 155 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Source: `155-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest (engine, intake, parser, capture loader, purity) + vitest (SQL gate, SQL exec, surface matrix) |
| **Config file** | `analytics-service/pytest.ini`, `analytics-service/pyproject.toml` (mypy); `vitest.config.ts` (no change) |
| **Quick run command** | `cd analytics-service && python3 -m pytest tests/test_mt5_parity_*.py tests/test_mt5_report_parser.py -x -q -p no:cacheprovider` ; `npx vitest run src/__tests__/mt5-parity-*.test.ts` |
| **Full suite command** | `cd analytics-service && make test` ; `npm test` ; mypy strict over `services/` as CI runs it |
| **Estimated runtime** | ~60 seconds (quick), several minutes (full) |

---

## Sampling Rate

- **After every task commit:** quick run command for the files touched
- **After every plan wave:** all new pytest + vitest files and mypy over the new `services/` modules
- **Before `/gsd-verify-work`:** full suite green; dress rehearsal recorded by hand
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

Filled by the planner per task (`<automated>` in each PLAN). Requirement-level map:

| Requirement | Behavior | Test Type | Automated Command | File Exists | Status |
|-------------|----------|-----------|-------------------|-------------|--------|
| PARITY-01 | provenance enum exactly three values; named refusals | unit | `pytest tests/test_mt5_parity_intake.py -x` | ✅ | ✅ green |
| PARITY-01 | Report parser BOM sniff, header contract fail-loud | unit | `pytest tests/test_mt5_report_parser.py -x` | ✅ | ✅ green |
| PARITY-01 | worksheet completeness vs shared required-readings list | unit + vitest | intake test; capture-sql vitest | ✅ | ✅ green |
| PARITY-02 | closed taxonomy, fail-closed, picker refusals | unit | `pytest tests/test_mt5_parity_engine.py -x` | ✅ | ✅ green |
| PARITY-02 | three RED proofs with byte-backup restore | unit | `pytest tests/test_mt5_parity_red_proofs.py -x` | ✅ | ✅ green |
| PARITY-02 | single tolerance constant; engine purity (transitive) | unit | `pytest tests/test_mt5_parity_purity.py -x` | ✅ | ✅ green |
| PARITY-03 | write-keyword gate (superset), RED on neutered copy | vitest | `npx vitest run src/__tests__/mt5-parity-capture-sql.test.ts` | ✅ | ✅ green |
| PARITY-03 | SQL executes on extracted baseline DDL | vitest exec | `npx vitest run src/__tests__/mt5-parity-capture-sql-exec.test.ts` | ✅ | ✅ green |
| PARITY-03 | `/.mt5-parity/` gitignored; seal + tamper detection | vitest + unit | capture-sql vitest; `pytest tests/test_mt5_parity_capture.py -x` | ✅ | ✅ green |
| PARITY-04 | census SQL against hand-computed oracles | vitest exec | capture-sql-exec vitest | ✅ | ✅ green |
| SC-5 (MT5-09 data layer / MT5-15) | surface matrix + flag classification | vitest + unit | `npx vitest run src/__tests__/mt5-parity-surfaces.test.ts`; `pytest tests/test_mt5_parity_findings.py -x` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**RED-proof mechanics:** byte backup + sha256 → break a COPY → assert bytes changed → assert RED naming leg/bucket → restore from byte backup → sha256 equal → assert GREEN. Never git checkout/restore/stash.

---

## Wave 0 Requirements

- [x] the five pytest files and the three vitest files above
- [x] `analytics-service/tests/fixtures/mt5_parity/` synthetic Reports (UTF-8 + UTF-16-LE), worksheet, capture
- [x] `docs/runbooks/mt5-parity/` SQL set, README, `required-readings.json`, `founder-session.md`
- [x] `.gitignore` line `/.mt5-parity/`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| PROD census + real capture | PARITY-04, PARITY-03 | PROD reads only via the orchestrator's Supabase MCP | marker query first, run each SQL file via MCP, write raw rows to `/.mt5-parity/`, seal |
| Dress rehearsal + hand-run RED proofs | PARITY-02 | uses the real PROD capture | run engine on synthetic oracle + real capture; record buckets/ratios only |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 120s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** validated 2026-11-14 (all requirements COVERED; 330 pytest + 249 vitest green at HEAD)

---

## Validation Audit 2026-11-14

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |

Every requirement row maps to a committed test file that runs green: phase pytest 330 passed, vitest 3 files / 249 passed. Two map commands were corrected to where the tests actually live (RED proofs in `test_mt5_parity_red_proofs.py`, flag classification in `test_mt5_parity_findings.py`). The two manual-only rows were done in plans 10 and 11 (records `155-CENSUS.md`, `155-DRESS-REHEARSAL.md`, `155-RED-PROOF.md`).
