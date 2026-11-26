# Phase 229: MT5DERIVE2 - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-11-24
**Phase:** 229-mt5derive2
**Areas discussed:** D-15 band, timed MT5 key with no writer basis

---

## D-15 band (MT5D-06)

| Option | Description | Selected |
|--------|-------------|----------|
| Accept the band as recorded (1.0) | No code change; acceptance and reason recorded in CONTEXT; closes `[164.6.6.2.3-D15-THRESHOLD-BAND]` | ✓ |
| Lower the annotation ratio (e.g. 0.5) | Annotation only; changes factsheet copy and payload cache version; needs a measured PROD rationale | |

**User's choice:** "Keep 1.0, accept band (Recommended)" (founder 2026-11-24)

---

## Timed MT5 key with no writer basis (MT5D-07)

| Option | Description | Selected |
|--------|-------------|----------|
| Block as the holed key does | Compose raises blocking `key_inputs_mismatch`; counts-only log names the branch | ✓ |
| Counted warning only | Key keeps composing on the legacy roll with a counted log | |

**User's choice:** "Block it (Recommended)" (founder 2026-11-24). PROD 2026-11-24: 11 of 11 MT5 key_inputs rows carry a basis.

---

## Decided autonomously

[auto] [Empty cohort 0] — Q: "Which cohort-0 rule closes MT5D-04?" → Selected: "skip an empty cohort 0 whenever a later cohort is judged; 188 tiny-base keeps precedence" (reversible technical — decided autonomously: one function, pinned by a RED-first test)
[auto] [Inception day-0 P&L] — Q: "Book or flag?" → Selected: "flag by name as a counted annotation" (reversible technical — decided autonomously: no base exists to book against; class is a one-line change)
[auto] [Writer-basis values] — Q: "What does HOLD-03 guarantee?" → Selected: "the invariant; research picks the comparison so no healthy timed or guard day is refused" (reversible technical — decided autonomously: comparison choice is internal)
[auto] [Proof] — Q: "How is each gate proved?" → Selected: "PROOF-01 per ROADMAP SC-5" (reversible technical — decided autonomously: ROADMAP-mandated)
[auto] [Soak] — Q: "How is 226's soak recorded?" → Selected: "run mt5_soak.py against the changed derive and record its verdict" (reversible technical — decided autonomously: ROADMAP-mandated)

## Claude's Discretion

Plan split, test placement, annotation key names, HOLD-03 tolerance value.

## Deferred Ideas

None
