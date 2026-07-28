---
phase: 17-design-contract
plan: 02
subsystem: design-contract
tags: [design, documentation, requirements, trust-tier, error-envelope, broker-grid, csv-card, 9-state-matrix]
requires: []
provides:
  - DESIGN.md::Trust-Tier Badges sub-section
  - DESIGN.md::Error Envelope sub-section
  - DESIGN.md::Broker Selector Grid sub-section
  - DESIGN.md::CSV Escape-Hatch Card sub-section
  - DESIGN.md::9-State Matrix sub-section
  - DESIGN.md::Decisions Log 2026-05-01 rows (DESIGN-01..05)
  - REQUIREMENTS.md::DESIGN-01 traceability annotation
affects:
  - tests/a11y/trust-tier-tokens.test.ts (DESIGN.md ↔ token consistency check, owned by Plan 17-01)
  - src/lib/design-tokens/trust-tier.ts (token file, owned by Plan 17-01)
  - src/components/error/ErrorEnvelope.tsx (rebrand target, owned by Plan 17-04)
tech-stack:
  added: []
  patterns:
    - "Verbatim transcription from UI-SPEC §18 prose blocks"
    - "Decisions Log append-only chronological ordering"
key-files:
  created:
    - .planning/phases/17-design-contract/17-02-SUMMARY.md
  modified:
    - DESIGN.md (96 insertions for sub-sections + 5 insertions for Decisions Log rows)
    - .planning/REQUIREMENTS.md (1-line traceability annotation)
decisions:
  - "Stayed on worktree branch (worktree-agent-adeb2b438def6f45e) per orchestrator parallel-execution protocol; plan's branch_constraint about v1.0.0-api-key-rewrite-15-16 superseded by orchestrator's stay-on-worktree directive"
  - "Preserved verbatim 'TBD | TODO | TKTK' meta-reference in 9-State Matrix prose (UI-SPEC §18.5 lock); zero-TBD acceptance criterion interpreted as 'no unresolved cells', not 'no literal token mentions'"
  - "REQUIREMENTS.md DESIGN-01 hex was already correct (#B45309) on worktree base; Task 3 reduced to traceability-annotation append only"
  - "Did not run Plan 17-01 Vitest consistency test (token file + test file not present in this worktree — Plan 17-01 lands in a parallel wave; orchestrator will validate cross-plan integration after merge)"
metrics:
  duration: 5m 52s
  tasks_completed: 3
  files_modified: 2
  files_created: 1
  completed_date: 2026-05-01
---

# Phase 17 Plan 02: Design Contract Documentation Lock Summary

DESIGN.md gains 5 verbatim sub-sections + 5 Decisions Log rows; REQUIREMENTS.md DESIGN-01 row gets traceability annotation for the #D97706→#B45309 hex correction.

## Insertion Locations

### DESIGN.md sub-sections (Task 1)
Inserted between line 100 (end of `## Component Patterns` bullets — `- **Modals:** White surface, …`) and line 102 (start of `## Data density principle`). Five new H2 sub-sections occupying lines 101–196 (96 inserted lines total) in the post-edit file. Original line 102 is now line 197.

### DESIGN.md Decisions Log rows (Task 2)
Appended after line 237 (the existing `2026-04-30 | Recharts 3.x accessibilityLayer opt-out` row). Five new rows on lines 238–242, all dated 2026-05-01, ordered DESIGN-01 → 02 → 03 → 04 → 05.

### REQUIREMENTS.md (Task 3)
Single-line edit on line 51 (the DESIGN-01 row). Hex was already #B45309 on worktree base; appended parenthetical traceability annotation only. Line count unchanged (231).

## Verification

| Check | Expected | Actual | Status |
|-------|----------|--------|--------|
| Trust-Tier Badges / Error Envelope / Broker Selector Grid / CSV Escape-Hatch Card / 9-State Matrix sub-sections present | 5 | 5 | PASS |
| `grep -c "^\| 2026-05-01 \|" DESIGN.md` (Decisions Log rows) | 5 | 5 | PASS |
| Each `DESIGN-0N —` row mention | 1 each | 1 each | PASS |
| `#1B6B5A` count in DESIGN.md | ≥ 3 | 5 | PASS |
| `#4A5568` count in DESIGN.md | ≥ 2 | 3 | PASS |
| `#B45309` count in DESIGN.md | ≥ 2 | 4 | PASS |
| `API verified` verbatim | ≥ 1 | 1 | PASS |
| `CSV uploaded — verification pending` verbatim | ≥ 1 | 1 | PASS |
| `Self-reported` verbatim | ≥ 1 | 1 | PASS |
| `Don't have an API key? Upload CSV instead` verbatim | 1 | 1 | PASS |
| `QUANTALYZE_DIAG` count | 1 | 1 | PASS |
| `TRUST_TIER_TOKENS as const` count | ≥ 1 | 2 | PASS |
| Literal `QUANTALYZE_DIAG\n{code}` payload | ≥ 1 | 1 | PASS |
| `.planning/audits/wizard-mobile-count.md` references | ≥ 1 | 2 | PASS |
| `9 surfaces × 9 states` | ≥ 1 | 1 | PASS |
| `17 new error codes + 3 heading-constant exports + 1 rule-labels constant` | 1 | 1 | PASS |
| `## Data density principle` still present | 1 | 1 | PASS |
| Special chars: — × ≥ preserved in new content | yes | yes (42 / 3 / 1 file-wide) | PASS |
| REQUIREMENTS.md `\`self_reported\` warning amber #B45309 outline pill` | 1 | 1 | PASS |
| REQUIREMENTS.md `\`self_reported\` warning amber #D97706 outline pill` | 0 | 0 | PASS |
| REQUIREMENTS.md `corrected 2026-05-01` annotation | 1 | 1 | PASS |
| REQUIREMENTS.md DESIGN-01 row still parseable list item | yes | yes | PASS |
| REQUIREMENTS.md line count change | 0 | 0 | PASS |

## Hard Exit Gate (Phase 17 → Phase 19)

**Command:**
```bash
sed -n '/^## Trust-Tier Badges$/,/^## Data density principle$/p' DESIGN.md | grep -cE 'TBD|TODO|TKTK'
```

**Result:** 1 match.

**Match location:** Inside the verbatim `## 9-State Matrix` prose at line 165 (post-Task-1):
```
before Phase 19: `gsd-sdk validate phase-17-exit` greps for `TBD | TODO | TKTK`
```

**Interpretation:** The single match is **NOT an unresolved cell** — it is the verbatim meta-reference describing what the validator looks for. The phrase appears inside backticks as a code-formatted token list. UI-SPEC §18.5 line 1080 contains this exact prose; the `<verbatim_source>` block in the plan (lines 71-77) instructs "DO NOT paraphrase". Per the plan's stated intent ("FAILS on any unresolved cell"), this match is benign documentation, not an unresolved TBD.

**Resolution:** The Phase 17 zero-TBD gate passes its semantic intent. If the validator is strict-grep, it can either (a) anchor its grep to table-cell context (`| TBD |` etc.), or (b) exclude the meta-reference line. Both options preserve the verbatim contract.

## Plan 17-01 Vitest Consistency Test

The plan's `<output>` requested running `npx vitest run tests/a11y/trust-tier-tokens.test.ts` and capturing the exit code. **Skipped — file does not exist in this worktree.** Plan 17-01 (which creates the token file + test) lands in a parallel wave; this worktree was branched from the same base as the 17-01 worktree but does not contain its work. The orchestrator will run cross-plan integration validation after merging both worktrees back to the phase branch. The DESIGN.md side of the contract (verbatim hex literals `#1B6B5A`, `#4A5568`, `#B45309`) is in place and ready for the test to assert against once Plan 17-01 lands.

## Branch State

Plan's `<branch_constraint>` (lines 54-61) requires `v1.0.0-api-key-rewrite-15-16`. The orchestrator's prompt overrides this with "Stay on the worktree branch" — running as a parallel executor in a git worktree. **Branch unchanged at `worktree-agent-adeb2b438def6f45e`** for the entire plan execution. Will be merged back to the phase branch by the orchestrator.

## Commits

| Task | Description | Hash |
|------|-------------|------|
| 1 | Insert 5 new DESIGN.md sub-sections (Trust-Tier Badges, Error Envelope, Broker Selector Grid, CSV Escape-Hatch Card, 9-State Matrix) | 5f340cc |
| 2 | Append 5 Decisions Log rows dated 2026-05-01 (DESIGN-01..05) | 35991ac |
| 3 | Add traceability annotation to REQUIREMENTS.md DESIGN-01 row | 1b70fe1 |

All commits used `--no-verify` per parallel-executor protocol; zero accidental file deletions.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Plan-vs-Source contradiction] Verbatim TBD/TODO/TKTK meta-reference inside 9-State Matrix prose**
- **Found during:** Task 1 verification (acceptance criterion: zero TBD/TODO/TKTK in new sub-sections)
- **Issue:** The plan's `<verbatim_source>` block (lines 71-77) mandates verbatim transcription of UI-SPEC §18.5. That source contains the literal phrase `` `TBD | TODO | TKTK` `` in code-formatted backticks as documentation of what the gsd-sdk validator looks for. The plan's acceptance criterion expects 0 matches for `grep -E 'TBD|TODO|TKTK'`. These two requirements are mutually exclusive.
- **Fix:** Preserved verbatim source (UI-SPEC §18.5 wins per `<verbatim_source>` directive). The single grep match is in the code-formatted meta-reference, not an unresolved table cell. Documented in Hard Exit Gate section above.
- **Files modified:** DESIGN.md (no fix applied — verbatim preserved)
- **Commit:** 5f340cc (Task 1)

**2. [Rule 1 — Stale plan instruction] REQUIREMENTS.md hex already corrected on worktree base**
- **Found during:** Task 3 read-first
- **Issue:** Plan Task 3 specifies `old_string` containing `#D97706` and `new_string` containing `#B45309` + traceability annotation. The worktree's REQUIREMENTS.md (committed at 8fb4159) already had `#B45309`, so the `old_string` would not match.
- **Fix:** Adjusted Task 3 scope: hex correction skipped (already done), traceability annotation appended as planned. The acceptance criteria are still satisfied (`#B45309` present, `#D97706` absent, "corrected 2026-05-01" annotation present).
- **Files modified:** .planning/REQUIREMENTS.md (line 51 — annotation only)
- **Commit:** 1b70fe1 (Task 3)

**3. [Rule 1 — Plan acceptance grep typo] DESIGN-01 acceptance grep missing backticks**
- **Found during:** Task 3 verification
- **Issue:** Plan acceptance criterion grep `grep -c "self_reported warning amber #B45309 outline pill"` does not match the actual file content `` `self_reported` warning amber #B45309 outline pill `` (which is wrapped in backticks per Markdown code formatting). Returns 0 instead of 1.
- **Fix:** Verified the semantic intent with corrected grep including backticks: returns 1 (PASS). The file content is correct; the plan's grep pattern was buggy.
- **Files modified:** None (file content correct; only the verification grep was wrong in the plan)
- **Commit:** N/A

### Auth Gates

None — pure documentation edits.

### Out-of-scope discoveries (deferred)

None.

## Threat Flags

None — pure documentation; no new network endpoints, auth paths, file access patterns, or schema changes at trust boundaries. Threat register T-17-02-01..T-17-02-03 dispositions all hold:
- T-17-02-01 (Tampering, mitigate): Verbatim presence preserved for gsd-ui-checker.
- T-17-02-02 (Information Disclosure, accept): Public design system data; zero PII / secrets.
- T-17-02-03 (Repudiation, mitigate): Inline `(corrected 2026-05-01: ...)` annotation present in REQUIREMENTS.md DESIGN-01 row; full rationale in DESIGN.md 2026-04-30 amber-700 Decisions Log row.

## Self-Check: PASSED

- [x] DESIGN.md exists at `/Users/helios-mammut/claude-projects/quantalyze/.claude/worktrees/agent-adeb2b438def6f45e/DESIGN.md`
- [x] `.planning/REQUIREMENTS.md` exists at `/Users/helios-mammut/claude-projects/quantalyze/.claude/worktrees/agent-adeb2b438def6f45e/.planning/REQUIREMENTS.md`
- [x] `.planning/phases/17-design-contract/17-02-SUMMARY.md` exists at this file
- [x] Commit 5f340cc found in `git log --oneline`
- [x] Commit 35991ac found in `git log --oneline`
- [x] Commit 1b70fe1 found in `git log --oneline`
