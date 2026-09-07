# Phase 164.7 — deferred items

Discovered during execution, OUT of the discovering plan's scope, recorded rather
than fixed. Each carries the measurement that found it.

---

## D-164.7-05-1 — ⛔ `npm run lint` is RED on this branch, and it is the PHASE'S OWN planning artifacts

**Found:** 2026-09-07, plan 05 Task 3, running the plan's own final verify leg
(`npx tsx scripts/check-planning-hygiene.ts`).

**Measured:** **86 violations across 13 files**, of three kinds —
`ABSOLUTE-HOME-PATH`, `SCRATCH-HOME-PATH` and `LOCAL-USERNAME`. Every one of the
13 is a `.planning/phases/164.7-…/` artifact written by the PLANNER or by plans
01-04:

    164.7-01-PLAN.md   164.7-01-SUMMARY.md   164.7-01-NEUTER.log
    164.7-02-PLAN.md   164.7-02-SUMMARY.md
    164.7-03-PLAN.md   164.7-03-SUMMARY.md   164.7-03-NEUTER.log
    164.7-04-PLAN.md   164.7-04-SUMMARY.md
    164.7-05-PLAN.md   164.7-06-PLAN.md      164.7-07-PLAN.md

**Two sources, both mechanical:**

1. Every plan's `<automated>` verify block opens with a hardcoded
   `cd /Users/<user>/claude-projects/quantalyze` — the PRIMARY checkout, not
   the worktree an executor runs in. Already booked as `[PLANVERIFY-CD-01]`; all
   four prior executors deviated from it identically and said so.
2. The NEUTER logs and some plans quote the agent scratchpad directory, whose
   name is the dash-mangled home path.

**It PREDATES this plan, proven not asserted:**
`git diff --stat d193e4cd HEAD -- <the 13 files>` is EMPTY — plan 05 modified
none of them. The gate was already failing at the branch tip this plan started
from, i.e. through all four merged plans.

**Why plan 05 did not fix it.** The remediation edits three PENDING plans
(05, 06, 07) whose `<automated>` blocks two future executors are about to read,
plus four other plans' committed records. That is a scope decision about other
agents' inputs, not a bug in this plan's work — deviation Rule 4, not Rule 3. The
mechanical substitution is lossless (username → `<user>`), but changing what a
pending PLAN.md instructs is the orchestrator's call.

**It matters, twice over:**
- `check-planning-hygiene.ts` is the last leg of `npm run lint` (`package.json:11`),
  so the branch's lint gate is RED. eslint itself is clean at this commit:
  `0 errors, 2 warnings`, both pre-existing and in files this phase never touched.
- The gate's own message: *"The repo is public and `.planning/` is tracked — every
  committed byte is world-readable."* This leaks the founder's local machine
  username in 13 tracked files.

**Owner:** plan 06, whose must-have truth is that "nothing else is red for a
reason this phase introduced" — this is red for exactly such a reason. Remedy:
substitute `<user>` for the username segment and the scratchpad directory name
across the 13 files, in one reviewed commit, and re-run
`npx tsx scripts/check-planning-hygiene.ts` to 0.

⚠️ **A MEASUREMENT HAZARD, recorded because it caught this executor once.** The
checker prints roughly the first 50 violations and then `… and N more`. Grepping
that printed output for a filename and getting zero hits does NOT mean the file is
clean — it may simply be in the truncated tail. This file's own first draft
tripped `ABSOLUTE-HOME-PATH` by writing a home-path prefix followed by a
placeholder spelled `<username>` rather than the exact token the rule exempts; it
was read as clean off a truncated report and was only caught when the count moved
86 → 87. The exemption is a VALUE test on the matched text: the prefix must be
followed by exactly `<user>`, and no near-miss spelling of it counts. ⛔ Read the
COUNT on the first line, not the printed list.

---

## D-164.7-05-2 — the plan's `<automated>` chains use BSD-incompatible `wc -l` output

**Found:** 2026-09-07, plan 05 Task 3.

Plan 05 Task 3's verify contains
`test "$(… | wc -l)" = "1"`. On macOS (BSD `wc`) the output is padded to
`       1`, so the comparison fails against `"1"` even when the count IS one —
MEASURED here. On GNU `wc` (ubuntu/CI) it prints `1` unpadded and passes. The leg
was re-run with `| tr -d "[:space:]"` and passed; its INTENT (the falsified
`ALTER DATABASE … app.admin_email` statement must SURVIVE somewhere in
`docs/runbooks/match-engine.md`, quoted inside its correction) is satisfied —
`grep -c` returns 1.

Not fixed in the plan file for the same reason as D-164.7-05-1. Worth a one-token
change (`| wc -l | tr -d "[:space:]"`) in any future plan template that runs on
both platforms.
