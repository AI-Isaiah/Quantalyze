# Phase 234: NOCAPITAL - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-11-24
**Phase:** 234-nocapital
**Areas discussed:** none asked. Smart discuss ran inside a phase agent that cannot ask the founder. Every product question was already settled by a prior decision (166.3.1 A2, D-02, D-10) or by the founder ruling of 2026-11-24 on 233's Q2, cited in CONTEXT.md. The one open product risk (the two live MT5 exits) is a research gate that returns to the founder if it bites.

---

## NOCAP-01 approach (considered, settled by 166.3.1 A2)

| Option | Description | Selected |
|--------|-------------|----------|
| Independent ledger proof, refuse otherwise | Exit only when the stored ledger from inception also reaches dust; else dropped_key, named | ✓ |
| Never exit an MT5 key | Venue gate; every emptied MT5 key stays dropped_key | |
| Require two consecutive derive reads | Needs state across runs; nothing stores it today | |

## Decided autonomously

[auto] [Shape] — Q: "Where does the NOCAP-03 field live in the payload?" → Selected: "Beside the existing counts-only fields" (reversible technical — decided autonomously: Python-only field, no TS reader)
[auto] [Shape] — Q: "How does the compose report its in-compose fall-backs?" → Selected: "The compose writes its own reasons; the job adds its own" (reversible technical — decided autonomously: internal contract)
[auto] [Out-of-window] — Q: "How is tiny_base_days passed to the replay?" → Selected: "New optional keyword argument" (reversible technical — decided autonomously: internal signature)
[auto] [Tests] — Q: "Where do the tests live?" → Selected: "Existing no-capital, job and replay suites" (reversible technical — decided autonomously: test layout)
[auto] [Plans] — Q: "How many plans?" → Selected: "Planner's call; one PR" (reversible technical — decided autonomously: planning layout)

## Claude's Discretion

- The exact MT5 independent-proof formula, after research reads the MT5 writer.

## Deferred Ideas

None.
