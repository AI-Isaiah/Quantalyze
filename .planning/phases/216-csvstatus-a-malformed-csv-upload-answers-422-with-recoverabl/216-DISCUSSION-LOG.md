# Phase 216: CSVSTATUS - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-11-17
**Phase:** 216-csvstatus
**Areas discussed:** Which CSV codes count, validate-only arm

Run by a phase agent with no channel to the founder. The status contract itself is the founder's (ROADMAP Phase 216, 215-CONTEXT Option A, 2026-11-15). The two areas below apply that decision's own test ("a file that will fail again") and are flagged to the coordinator.

---

## Which CSV codes count

| Option | Description | Selected |
|--------|-------------|----------|
| Rule family + CSV_VALIDATION_FAILED + CSV_TOO_LARGE + CSV_FORMAT_UNSUPPORTED → 422; CSV_UPSTREAM_FAIL stays 424 | Every deterministic input fault moves; our internal fault stays retryable | ✓ |
| Rule family + CSV_VALIDATION_FAILED only | Narrowest reading of "malformed"; leaves oversize and unsupported-format files saying retry can succeed | |
| Every CSV adapter code including CSV_UPSTREAM_FAIL | Would tell a user whose file is fine that retry cannot help | |

**Choice:** first option, by the founder's stated test.

---

## Validate-only arm

| Option | Description | Selected |
|--------|-------------|----------|
| Unchanged (200 ok:false) | Out of the founder's scope per the 215 pin; the live upload path keeps its per-row rendering | ✓ |
| Move to 422 | Would route real verdicts into CsvUploadStep's transport branch and render CSV_UPSTREAM_FAIL | |

---

## Decided autonomously

[auto] [Gate shape] — Q: "How does the gate recognise a CSV validator verdict?" → Selected: "source == csv with a non-null code other than CSV_UPSTREAM_FAIL, before the 424 pre-gate; permanent-code set untouched" (reversible technical — decided autonomously: one local condition)
[auto] [Gate shape] — Q: "Is recoverable derived or stated?" → Selected: "Stated False" (reversible technical — decided autonomously: one keyword argument)
[auto] [Gate shape] — Q: "What else does the new arm keep?" → Selected: "Same envelope, log line and draft transition as the neighbouring arms" (reversible technical — decided autonomously: mirrors neighbours)
[auto] [Pins] — Q: "How are the 215 pins updated?" → Selected: "In place with literals, plus TOO_LARGE, FORMAT_UNSUPPORTED, UPSTREAM_FAIL and non-CSV-source cases" (reversible technical — decided autonomously: test edits only)
[auto] [Pins] — Q: "How do we prove the pins can fail?" → Selected: "Neuter, see RED, restore from byte backup" (reversible technical — decided autonomously: repo rule)
[auto] [Comments] — Q: "Which stale comments move?" → Selected: "Only those stating the CSV arm's status" (reversible technical — decided autonomously: comments only)
[auto] [Censuses] — Q: "Which censuses are checked?" → Selected: "Grep and update only what states this arm's status" (reversible technical — decided autonomously: read-and-update)

## Claude's Discretion

None.

## Deferred Ideas

None.
