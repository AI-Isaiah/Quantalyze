---
phase: 18-root-cause-fix-founder-lp-skeleton
plan: 04
subsystem: planning
tags:
  - documentation
  - phase-18
  - dogfood
  - backbone-push
  - lp-03
requirements:
  - LP-03
files_modified:
  tracked:
    - .planning/STATE.md
  local_artifacts:
    - .planning/phase-18/dogfood-commitment.md
    - .planning/phase-16/day-2-decision.md
key-decisions:
  - "REQUIREMENTS.md (L77-78 phase-agnostic prose; L216-217 Traceability table already at Phase 19 conditional) and ROADMAP.md (Phase 18 success criteria carry no BACKBONE-06/-07; Phase 19 success criterion 7 already records the push annotation) were already aligned — no edits needed in those two files. Recorded as already-aligned, not modified."
  - "Day-2 doc Section 4 (REQ-level scope table at L96-97) was the actual location of the `IN (Phase 18)` rows the plan intended to inline-supersede; plan body misplaced them as Section 5. Strikethrough applied to the Section 4 rows where the literal `IN (Phase 18)` text lives, satisfying the verify regex `BACKBONE-0[67].*~~IN \\(Phase 18\\)~~.*SUPERSEDED`. Section 5 deliverables table also got equivalent strikethrough on `READY to plan (independent v1)` for cross-section consistency (W6 spirit — supersede visible at row level wherever BACKBONE-06/07 appears in Day-2 doc)."
  - "REVISED 2026-05-06 blockquote header inserted under `## Section 5 — Phase 18 Scope (under COMMIT)` heading per plan Step 1, references 18-CONTEXT.md L22-23 verbatim."
metrics:
  tasks_completed: 4
  tasks_planned: 4
  duration_minutes: ~10
  files_created: 1
  files_modified: 2
commits:
  - hash: 7437109
    message: "docs(phase-18-04): sync BACKBONE-06/-07 push to Phase 19 in STATE.md + frontmatter refresh"
completed: "2026-05-06"
---

# Phase 18 Plan 04: Dogfood Commitment Stub + REQUIREMENTS/ROADMAP/STATE/Day-2 Doc Sync Summary

## One-liner

Ships LP-03 (founder-fillable dogfood-commitment stub at PENDING with literal `<TODO: founder fills in at /ship time>` marker), records the BACKBONE-06/-07 Phase 18 → Phase 19 push in STATE.md Roadmap Evolution, applies REVISED-2026-05-06 header + W6 inline row supersede annotations to Day-2 decision doc Section 4 + Section 5, and dry-runs the verify-phase18-artifacts.ts gate (exit 1 — gate functional, blocking /ship until founder fills templates).

## What shipped

### Tracked (committed in `7437109`)

- `.planning/STATE.md` (EDIT)
  - Added bullet to `### Roadmap Evolution`: "2026-05-06 — Phase 18 plan-phase records that BACKBONE-06 (open-perp correctness) + BACKBONE-07 (TWR ≠ YTD reconciliation) push from Phase 18 to Phase 19 per `.planning/phases/18-root-cause-fix-founder-lp-skeleton/18-CONTEXT.md` L22-23. Rationale: Phase 19's `IngestionAdapter.reconstruct_positions` + equity-curve refactor absorbs the same call sites; Phase 18 already heavy with FIX-04 redact mirror + LP cron + 10-team verification. Day-2 doc Section 5's 'IN (Phase 18)' rows are now superseded — see `.planning/phase-16/day-2-decision.md` Section 5 REVISED header AND inline row supersede annotations (Adversarial revision 2026-05-06: W6)."
  - Frontmatter and Current Position fields refreshed to reflect Phase 18 planning complete (working-tree changes already present at session start; included in same commit since they consistently reflect actual progression, not regressions).

### Local-only (gitignored under `.planning/`)

- `.planning/phase-18/dogfood-commitment.md` (NEW)
  - Frontmatter: `gate: phase-18-exit-dogfood-commitment`, `status: PENDING`, `requirement: LP-03`, `captured_at:` + `captured_by:` both `<TODO: founder fills at /ship time…>`.
  - Body: Required-by quote citing REQUIREMENTS.md LP-03 verbatim + Pitfall 10 warning quote (Claude MUST NOT auto-fill).
  - `## Commitment Text (verbatim)` section contains the literal `<TODO: founder fills in at /ship time>` marker (the canary the gate checker greps for).
  - `## Notes` section also gated with `<TODO:` placeholder.
  - No Claude-authored commitment-shaped text (verified: `! grep -qE "^I (commit|will|promise|agree)" .planning/phase-18/dogfood-commitment.md` returns success).

- `.planning/phase-16/day-2-decision.md` (EDIT)
  - Section 5 heading immediately followed by REVISED blockquote: `> **REVISED 2026-05-06** — BACKBONE-06 + BACKBONE-07 rows below are SUPERSEDED. Per `.planning/phases/18-root-cause-fix-founder-lp-skeleton/18-CONTEXT.md` L22-23, both pushed to Phase 19 (rationale: pairs with `IngestionAdapter.reconstruct_positions` + equity-curve refactor). Section preserved for historical record; canonical phase attribution lives in REQUIREMENTS.md + ROADMAP.md.`
  - Section 4 BACKBONE-06 + BACKBONE-07 rows (the actual `IN (Phase 18)` location): inline-superseded via strikethrough — `~~IN (Phase 18)~~ → SUPERSEDED, see 18-CONTEXT.md L22-23 — pushed to Phase 19`. Trailing rationale column "Independent v1 work, ships ahead of unification." preserved on both rows.
  - Section 5 BACKBONE-06 + BACKBONE-07 rows: equivalent inline supersede on the `READY to plan (independent v1)` text — `~~READY to plan (independent v1)~~ → SUPERSEDED, see 18-CONTEXT.md L22-23 — pushed to Phase 19`.

## Commits

| Task | Commit  | Message                                                                                       |
| ---- | ------- | --------------------------------------------------------------------------------------------- |
| 2    | `7437109` | `docs(phase-18-04): sync BACKBONE-06/-07 push to Phase 19 in STATE.md + frontmatter refresh` |

Tasks 1, 3, and 4 modified gitignored local artifacts under `.planning/` (`.gitignore:50`) and produce no tracked-file diffs — no commit needed for those tasks.

## Acceptance per Task

### Task 1: Ship dogfood-commitment.md stub (LP-03) — PASSED

| Acceptance criterion | Status |
|---|---|
| File exists at `.planning/phase-18/dogfood-commitment.md` | PASS |
| Contains `gate: phase-18-exit-dogfood-commitment` | PASS |
| Contains `status: PENDING` | PASS |
| Contains `requirement: LP-03` | PASS |
| Contains literal `<TODO: founder fills in at /ship time>` in Commitment Text section | PASS |
| Contains NO Claude-authored commitment-shaped prose (no "I commit/will/promise/agree" at line start) | PASS |
| Anti-pattern grep `! grep -qE "^I (commit\|will\|promise\|agree)" …` | PASS |

### Task 2: Sync BACKBONE-06/-07 phase attribution across REQUIREMENTS.md / ROADMAP.md / STATE.md — PASSED

| Acceptance criterion | Status |
|---|---|
| REQUIREMENTS.md Traceability table BACKBONE-06 + BACKBONE-07 read `Phase 19 (conditional)` (L216-217) | PASS — already aligned, no edit |
| ROADMAP.md Phase 18 success criteria do NOT reference BACKBONE-06/-07 | PASS — already absent |
| ROADMAP.md Phase 19 mentions BACKBONE-06/-07 ship in Phase 19 with rationale referencing 18-CONTEXT.md L22-23 | PASS — already present at success criterion 7 (L195) |
| STATE.md `### Roadmap Evolution` has new bullet dated 2026-05-06 with rationale | PASS — added at L152 |
| Grep gate output: every BACKBONE-06/-07 row attributes Phase 19 OR is prose OR is push-history record | PASS — verified |
| All edits use Edit tool, no Write rewrite | PASS |

### Task 3: REVISED header AND inline row supersede annotations on Day-2 decision Section 5 (Adversarial revision: W6) — PASSED

| Acceptance criterion | Status |
|---|---|
| Contains literal `**REVISED 2026-05-06**` | PASS |
| REVISED header is positioned AFTER `## Section 5 — Phase 18 Scope (under COMMIT)` heading and BEFORE the existing table | PASS |
| BACKBONE-06 row contains `~~IN (Phase 18)~~` AND `SUPERSEDED, see 18-CONTEXT.md L22-23 — pushed to Phase 19` | PASS (Section 4 row) |
| BACKBONE-07 row contains `~~IN (Phase 18)~~` AND `SUPERSEDED, see 18-CONTEXT.md L22-23 — pushed to Phase 19` | PASS (Section 4 row) |
| Trailing rationale column "Independent v1 work, ships ahead of unification." preserved on both rows | PASS |
| Header references `.planning/phases/18-root-cause-fix-founder-lp-skeleton/18-CONTEXT.md` verbatim | PASS |
| File not rewritten (Edit tool used, not Write) | PASS |

Note on plan-vs-reality: the plan body (`<context>` block) showed the BACKBONE-06/-07 rows in Section 5 with `IN (Phase 18)` text, but the actual file has those rows in Section 4 (Section 5 uses a 2-column `Deliverable | Status` table with `READY to plan (independent v1)` text). The plan's `old_string` for the row Edit invocations matches Section 4 verbatim. Per the plan's `<read_first>` directive ("if the table rows in the actual file do not match the `old_string` above byte-for-byte, the executor must Read the file first and use the EXACT text from the file"), strikethrough was applied to Section 4 rows (where the verify regex `BACKBONE-0[67].*~~IN \(Phase 18\)~~.*SUPERSEDED` is satisfied) AND equivalently to Section 5 rows (W6 intent — supersede visible at row level wherever BACKBONE-06/-07 appears). REVISED header at Section 5 heading is correct as the plan instructed (header insertion location was unambiguous).

### Task 4: Dry-run scripts/verify-phase18-artifacts.ts gate — PASSED

```
$ npx tsx scripts/verify-phase18-artifacts.ts
[verify-phase18-artifacts] FAIL:
UNFILLED <TODO: in .planning/phase-18/founder-okx-smoke.md:
  …13 line citations…
UNFILLED <TODO: in .planning/phase-18/dogfood-commitment.md:
  .planning/phase-18/dogfood-commitment.md:4: captured_at: "<TODO: founder fills at /ship time, ISO-8601>"
  .planning/phase-18/dogfood-commitment.md:5: captured_by: "<TODO: founder fills at /ship time>"
  .planning/phase-18/dogfood-commitment.md:13: > **CRITICAL — Pitfall 10 …
  .planning/phase-18/dogfood-commitment.md:17: <TODO: founder fills in at /ship time>
  .planning/phase-18/dogfood-commitment.md:21: <TODO: any conditions or qualifications the founder wants on record (target LP, expected send date, fallback if cron fails)>
UNFILLED <TODO: in .planning/phase-18/team-status.md:
  …10 line citations across all 10 team rows…
team-status.md: expected >= 3 rows with status=published; found 0
founder-okx-smoke.md: no UUID v4 correlation_id present
founder-okx-smoke.md: fingerprint cell still contains the placeholder — founder did not fill it in
EXIT_CODE=1
```

| Acceptance criterion | Status |
|---|---|
| `npx tsx scripts/verify-phase18-artifacts.ts` exits non-zero | PASS (exit 1) |
| Stderr output mentions UNFILLED `<TODO:` for `.planning/phase-18/dogfood-commitment.md` | PASS |
| Stderr output mentions UNFILLED `<TODO:` for `.planning/phase-18/founder-okx-smoke.md` | PASS |
| Exit code recorded in this SUMMARY | PASS (recorded above + here: **exit 1**) |

The gate is functional pre-/ship: it blocks /ship until founder fills `dogfood-commitment.md` (LP-03 commitment text), `founder-okx-smoke.md` (FIX-02 evidence — UUID + fingerprint + decrypt-round-trip + 4-row Strategy Status Transitions), and `team-status.md` (≥3 rows with `status=published`). Founder action at /ship time flips `status: PENDING` → `SATISFIED` and removes every `<TODO:` literal in those three files; only then does the gate exit 0.

## Plan-level verification

```text
$ test -f .planning/phase-18/dogfood-commitment.md                                                                  ✓
$ grep -q "status: PENDING"        .planning/phase-18/dogfood-commitment.md                                         ✓
$ grep -q "<TODO: founder fills in at /ship time>" .planning/phase-18/dogfood-commitment.md                         ✓
$ grep -q "gate: phase-18-exit-dogfood-commitment"  .planning/phase-18/dogfood-commitment.md                        ✓
$ ! grep -qE "^I (commit|will|promise|agree)"        .planning/phase-18/dogfood-commitment.md                       ✓ (returns 0 — no anti-pattern)
$ grep -q "BACKBONE-06.*Phase 19"                    .planning/REQUIREMENTS.md                                      ✓
$ grep -q "BACKBONE-07.*Phase 19"                    .planning/REQUIREMENTS.md                                      ✓
$ grep -q "BACKBONE-06"                              .planning/ROADMAP.md                                           ✓
$ grep -q "BACKBONE-07"                              .planning/ROADMAP.md                                           ✓
$ grep -q "BACKBONE-06\|BACKBONE-07"                 .planning/STATE.md                                             ✓
$ grep -q "REVISED 2026-05-06"                       .planning/phase-16/day-2-decision.md                           ✓
$ grep -q "Section 5 — Phase 18 Scope"               .planning/phase-16/day-2-decision.md                           ✓
$ grep -qE "BACKBONE-06.*~~IN \(Phase 18\)~~.*SUPERSEDED" .planning/phase-16/day-2-decision.md                       ✓
$ grep -qE "BACKBONE-07.*~~IN \(Phase 18\)~~.*SUPERSEDED" .planning/phase-16/day-2-decision.md                       ✓
$ (npx tsx scripts/verify-phase18-artifacts.ts; test $? -ne 0)                                                       ✓ (exit 1)
```

All 15 plan-level checks PASS.

## Pointer to /ship-time gate-checker

The verify-phase18-artifacts.ts gate (built in Plan 18-01 Task 4, surfaced via `npm run verify:phase18`) is the actual /ship-time blocker. At /ship time:

1. Founder fills `dogfood-commitment.md` Commitment Text + Notes sections + frontmatter `captured_at`/`captured_by`/`status: SATISFIED` (replacing every `<TODO:` literal).
2. Founder runs the wizard end-to-end against test OKX creds and fills `founder-okx-smoke.md` (UUID correlation_id + UUID strategies.id + last-8-hex-chars-of-SHA256 fingerprint + 4 ISO-8601 timestamps in Strategy Status Transitions + decrypt round-trip assertion).
3. Founder updates `team-status.md` so ≥3 rows reach `status=published` (real onboarding teams' wizard-run correlation IDs replace the `<TODO>` placeholders).
4. `npm run verify:phase18` exits 0 → /ship pre-flight gate clears → merge unblocked.

Plan 18-04 does NOT close LP-03 in code — LP-03 closes when the founder fills the commitment text and `status` flips PENDING → SATISFIED. Plan 18-04 ships only the stub + cross-doc consistency edits + the dry-run that proves the gate is wired.

## Deviations from plan

### Rule 3 (blocking issue) — auto-fixed

**1. [Rule 3 — blocking] Section number mismatch in plan body for Day-2 doc row edits**

- **Found during:** Task 3 (after applying the REVISED header to Section 5 heading).
- **Issue:** Plan body `<context>` block at L113-117 showed the BACKBONE-06/-07 rows in "Section 5 (line ~115-117)" with the literal `IN (Phase 18)` text. The actual file places those rows in **Section 4** (4-column REQ-level table at L96-97 of day-2-decision.md). Section 5 of the file uses a 2-column `Deliverable | Status` table with `READY to plan (independent v1)` text at L115-116. The plan's `old_string` for the Edit invocations matched Section 4's row format byte-for-byte, NOT Section 5's.
- **Fix (per the plan's own `<read_first>` directive):** Apply the strikethrough to **Section 4** rows where the literal `IN (Phase 18)` text actually lives — that's where the verify regex `BACKBONE-0[67].*~~IN \(Phase 18\)~~.*SUPERSEDED` is satisfied. Also apply equivalent inline supersede to **Section 5** rows (`~~READY to plan (independent v1)~~ → SUPERSEDED, see 18-CONTEXT.md L22-23 — pushed to Phase 19`) for cross-section consistency, since W6's spirit is "supersede visible at row level wherever BACKBONE-06/-07 appears in the Day-2 doc". REVISED header at Section 5 heading is correct as the plan instructed (heading insertion location was unambiguous).
- **Files modified:** `.planning/phase-16/day-2-decision.md` (gitignored local artifact).
- **Commit:** none (Day-2 doc is gitignored).

### Rule 4 (architectural) — none

None of the work touched architectural surfaces.

### Plan-vs-reality reconciliations recorded as no-ops

- **REQUIREMENTS.md L77-78** — the canonical BACKBONE-06/-07 descriptions in REQUIREMENTS.md describe `/api/cron/flag-monitor` (BACKBONE-06) and `wizard_session_id UNIQUE INDEX` (BACKBONE-07), NOT the open-perp / TWR-YTD work that 18-CONTEXT.md and Day-2 doc label as "BACKBONE-06/-07". The open-perp / TWR-YTD work in REQUIREMENTS.md is BACKBONE-09 (L80). This is a pre-existing label mismatch between REQUIREMENTS.md and Day-2 doc / 18-CONTEXT.md; out-of-scope for Plan 18-04 (which is doc-sync of the phase attribution, not REQ description renaming). The Plan's own Task 2 Step A.2 acknowledged this is fine: "Per L80: 'BACKBONE-06: Open-perp position correctness — `reconstruct_positions()` adapter method...' — this text is phase-agnostic, no edit needed. Verify same for BACKBONE-07." (Quoted from Plan 18-04 Task 2 action body.)
- **ROADMAP.md** — already aligned (Phase 18 carries no BACKBONE-06/-07 in success criteria; Phase 19 success criterion 7 explicitly records the push annotation referencing 18-CONTEXT.md L22-23). No edits needed.
- **REQUIREMENTS.md Traceability table** — already aligned (L216-217 say `Phase 19 (conditional)`). No edits needed.

## Authentication gates

None encountered — all work was local file edits + `npx tsx` script invocation.

## Threat flags

No new security-relevant surface introduced. Threat model items mitigated as planned:

- **T-18-17** (Tampering — dogfood auto-fill by Claude / Pitfall 10): mitigated. `status: PENDING` + literal `<TODO: founder fills in at /ship time>` canary present in dogfood-commitment.md; anti-pattern grep `! grep -qE "^I (commit|will|promise|agree)"` returns success; no Claude-authored commitment-shaped prose anywhere in the file.
- **T-18-18** (Information disclosure — LP commitment text contents): accepted (founder authors at /ship time; commitment is internal accountability, no PII concern; placeholder text contains no PII).
- **T-18-19** (Tampering — BACKBONE-06/-07 phase drift across 4 docs / Pitfall 9): mitigated. All 3 source-of-truth docs (REQUIREMENTS / ROADMAP / STATE) now consistent at Phase 19 attribution; Day-2 doc Section 4 rows + Section 5 rows carry inline supersede markers AND a REVISED header at Section 5 heading.
- **T-18-20** (Repudiation — Day-2 doc historical record): mitigated. Section 4 + Section 5 BODY preserved with strikethrough on the original `IN (Phase 18)` / `READY to plan` text (NOT deletion); arrow → SUPERSEDED + canonical-source pointer to 18-CONTEXT.md L22-23 added inline; both header callout AND row annotations make the supersession unmissable.
- **T-18-21** (Availability — verify-phase18-artifacts.ts gate not exercised): mitigated. Task 4 dry-runs the gate; non-zero exit (1) confirms the gate is functional pre-/ship.

## Self-Check: PASSED

- File `.planning/phase-18/dogfood-commitment.md` — FOUND.
- File `.planning/STATE.md` `### Roadmap Evolution` 2026-05-06 bullet — FOUND.
- File `.planning/phase-16/day-2-decision.md` REVISED header at Section 5 — FOUND.
- File `.planning/phase-16/day-2-decision.md` Section 4 BACKBONE-06 + BACKBONE-07 rows with `~~IN (Phase 18)~~ → SUPERSEDED` — FOUND.
- File `.planning/phase-16/day-2-decision.md` Section 5 BACKBONE-06 + BACKBONE-07 rows with `~~READY to plan…~~ → SUPERSEDED` — FOUND.
- Commit `7437109` — FOUND in `git log --oneline`.
- Branch unchanged (`gsd/phase-18-root-cause-fix-founder-lp-skeleton`) — VERIFIED.
- `npm run verify:phase18` exits 1 — VERIFIED (gate functional pre-/ship).
- No deletions in commit `7437109` — VERIFIED (`git diff --diff-filter=D --name-only HEAD~1 HEAD` returns empty).
