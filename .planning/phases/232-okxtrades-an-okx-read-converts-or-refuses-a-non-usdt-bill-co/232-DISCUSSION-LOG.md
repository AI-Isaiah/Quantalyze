# Phase 232: OKXTRADES - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-11-24
**Phase:** 232-okxtrades
**Areas discussed:** VREAD-06, VREAD-07, VREAD-08, Fixtures

Every question was a reversible technical choice (code only, no schema, no public contract), so none was asked. Alternatives considered: VREAD-06 conversion at a market rate (rejected: needs a price source, exposure nil); withholding only the affected day (rejected: a hole reads as zero P&L). VREAD-08 a migration changing `advance_sync_cursor` to allow a pull-back (rejected for this phase: the read clamp suffices; a one-time PROD repair goes to the coordinator).

## Decided autonomously

[auto] [VREAD-08] — Q: "What does the cursor stamp?" → Selected: "newest persisted fill timestamp, else untouched; never now" (reversible technical — decided autonomously: one RPC param)
[auto] [VREAD-08] — Q: "When may it advance?" → Selected: "gate on not phase2_failed and not phase1_failed" (reversible technical — decided autonomously: one boolean)
[auto] [VREAD-08] — Q: "How does the read seed when ahead?" → Selected: "earlier of the column and the stored fills high-water" (reversible technical — decided autonomously: read-side clamp)
[auto] [VREAD-08] — Q: "Does the refusal flag survive?" → Selected: "yes by construction, pinned by a test" (reversible technical — decided autonomously: no new state)
[auto] [VREAD-08] — Q: "231 gap 3?" → Selected: "routed to 222" (reversible technical — decided autonomously: scope note)
[auto] [VREAD-08] — Q: "Repair of the ahead columns?" → Selected: "coordinator decision after merge, no migration" (reversible technical — decided autonomously: data write outside code)
[auto] [VREAD-06] — Q: "Convert or refuse?" → Selected: "stable coins at 1.0 via price_rule; anything else refuses by a closed token" (reversible technical — decided autonomously: code only)
[auto] [VREAD-06] — Q: "Refuse the day or the read?" → Selected: "the whole read, permanent" (reversible technical — decided autonomously: local to the verdict)
[auto] [VREAD-07] — Q: "Already closed?" → Selected: "research re-measures; default fix" (reversible technical — decided autonomously: evidence step)
[auto] [VREAD-07] — Q: "Fix shape?" → Selected: "oldest-first day-aligned windows, stored prefix on deadline, cap unchanged" (reversible technical — decided autonomously: request shape inside one branch)
[auto] [Fixtures] — Q: "Test payloads?" → Selected: "recorded real OKX v5 bills shapes" (reversible technical — decided autonomously: test-only)

## Claude's Discretion

Plan split and waves.

## Deferred Ideas

Market-rate conversion; 231 gap 3 (to 222); one-time PROD cursor repair (coordinator).
