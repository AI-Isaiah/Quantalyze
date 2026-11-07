---
phase: 192-publictruth-the-public-site-and-the-demo-tell-a-visitor-one
plan: 01
subsystem: docs
tags: [evidence, tls, key-storage, factsheet, demo, prod-readings]

requires: []
provides:
  - "192-EVIDENCE.md: the measured facts every wave-2 plan reads as a precondition (TLS handshakes, HSTS, certificate, Fernet, key-storage code facts, retention, live /demo baseline, D-04, D-08, D-10 and D-09 readings)"
  - "D-09 settled: remove the founder view route and every link to it"
affects: [192-02, 192-03, 192-04, 192-05, 192-06, 192-07, 192-08, 192-09, 192-10]

actuals:
  tokens: 5700
  tasks: 3
  commits: 3
plan_head_before: b4cea75f389c8e58ac5604f850ebecebfa5555ae
commits: 3
plan_head_after: c3ad7eca0aeb455ac70e9461e7e2404893674ad3

tech-stack:
  added: []
  patterns: ["Evidence file with named single-line verdicts that later plans grep as preconditions"]

key-files:
  created:
    - .planning/phases/192-publictruth-the-public-site-and-the-demo-tell-a-visitor-one/192-EVIDENCE.md
  modified: []

key-decisions:
  - "D-09 outcome: remove (founder, 2026-11-06). The demo allocator has 0 match batches and the match cron excludes it, so nothing automatic can keep a founder-view batch current."
  - "D-08 verdict: strategies-missing. All 9 strategies the persona books are composed from are absent from PROD strategies; the three persona books hold 0 holdings rows."
  - "D-10 read inclusively: 9 labels /demo cannot name from PROD data (0 raw-id labels + 9 absent + 0 unresolvable in analytics elements)."

patterns-established:
  - "Vacuous readings are labelled as such in the evidence (firm-name=absent) so no later plan leans on them."

requirements-completed: [TRUST-01, ROUTE-03]

duration: ~85min
completed: 2026-11-07
status: complete
---

# Phase 192 Plan 01: Evidence readings Summary

**One measured evidence file (TLS 1.0/1.1 refused, 1.2/1.3 accepted; Fernet key storage; strategies-missing demo books; 9 unnameable demo labels) with D-09 settled as remove by the founder.**

## Performance

- **Tasks:** 3 (one tracer, one auto, one decision checkpoint)
- **Files modified:** 1 (new)
- **Commits:** 3 task commits, measured from the plan-head ledger

## Accomplishments

- Public-network readings taken at execution: four TLS handshakes, the served HSTS header, certificate issuer and validity, the Vercel TLS documentation (conclusion tagged `[ASSUMED]`) and the Fernet implementation line.
- Code facts at HEAD: `D-01 code facts: S-KEY clauses true`; retention at HEAD is no scheduled deletion and no window (no 30-day hard delete of raw fills exists in code).
- PROD readings (read-only, marker first, run by the orchestrator through the MCP): D-04 `published=200 random=404 firm-name=absent title=codename non-codename-titles=0`; D-08 `strategies-missing`; D-10 `9`.
- D-09 inputs recorded and the founder's `remove` written as `D-09 outcome: remove`.

## Task Commits

1. **Task 1: Public-network and code-fact readings** - `2ae4bd2f2` (docs)
2. **Task 2: PROD readings for D-04, D-08, D-09, D-10** - `ed0fb11c5` (docs)
3. **Task 3: D-09 outcome** - `c3ad7eca0` (docs)

## Files Created/Modified

- `.planning/phases/192-publictruth-the-public-site-and-the-demo-tell-a-visitor-one/192-EVIDENCE.md` - the phase's measured facts; named lines later plans read.

## Decisions Made

- D-09 `remove`, taken by the founder on 2026-11-06 via the Task 3 checkpoint. It rests on the demo allocator having 0 batches and the cron exclusion (`_DEMO_ALLOCATOR_ID`). Plans 192-05 and 192-07 take the removal path; the keep path would also have needed `is_example` strategies to exist on PROD.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] WebFetch replaced by curl for the Vercel and Fernet documentation**
- **Found during:** Task 1
- **Issue:** The plan names WebFetch for the Vercel TLS and Fernet pages; it was not available to the executor.
- **Fix:** Fetched both pages with `curl` and quoted the relevant sentences.
- **Files modified:** 192-EVIDENCE.md
- **Commit:** `2ae4bd2f2`

**2. [Process] PROD reads run by the orchestrator, not the executor**
- **Found during:** Task 2
- **Issue:** The executor session has no Supabase MCP (the Task 2 precondition). Instead of stopping at a checkpoint, the orchestrator ran the single read-only SELECTs, marker first, and passed the results through its scratchpad. The executor recorded them. No PROD write was issued by anyone, and the CLI was never used.
- **Commit:** `ed0fb11c5`

**3. [Judgment] D-10 recorded with the inclusive reading**
- **Issue:** The plan's line counts labels /demo "would label with the raw-id form or could not name from PROD data". The narrow reading (raw-id only) gives 0 and would hide that the books name nothing. The file records `9` (0 + 9 absent + 0) and states both readings. Plan 192-10's ship gate needs 0, which it reaches only once the composing strategies exist or the books stop referencing them.
- **Commit:** `ed0fb11c5`

**4. [Note] D-04 `firm-name=absent` is vacuous**
- **Issue:** No PROD owner has a company, so Q1 returned 0 rows and a substitute (newest published non-example strategy) was used. The evidence says so explicitly; the withholding of a company string rests on the code path, not this measurement.
- **Commit:** `ed0fb11c5`

## Authentication Gates

None.

## Known Stubs

None (documentation-only plan).

## Threat Flags

None. The evidence file passed the three T-192-01 greps before commit: 0 UUIDs, 0 email addresses, 0 home-directory paths.

## Verification

- `node scripts/verify-plan-anchors.mjs <plan>`: exit 0, 9 claims checked.
- Task 1 verify command: exit 0 (4 TLS rows, 4 `D-03 TLS` lines, `[ASSUMED]` present once, `Vercel cannot` absent).
- Task 2 verify command: exit 0.
- Task 3 acceptance: `grep -cE '^D-09 outcome: (remove|keep)$'` prints 1; the line sits after `## D-09 inputs`.

## Next Phase Readiness

Wave-2 plans can read: `D-03 TLS 1.0:`..`1.3:`, `D-01 code facts:`, `D-04 signed-out factsheet:` (title=codename, non-codename-titles=0, so the codename sentences are allowed), `D-08 verdict: strategies-missing` (plan 192-06 repairs data), `D-10 unresolvable labels: 9`, `D-09 outcome: remove`, `Retention at HEAD:`.

## Self-Check: PASSED

- FOUND: 192-EVIDENCE.md
- FOUND commits 2ae4bd2f2, ed0fb11c5, c3ad7eca0 (ancestors of HEAD)
