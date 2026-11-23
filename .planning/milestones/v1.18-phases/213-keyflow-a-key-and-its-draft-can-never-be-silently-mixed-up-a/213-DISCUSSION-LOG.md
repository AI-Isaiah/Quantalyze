# Phase 213: KEYFLOW - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-11-14
**Phase:** 213-keyflow
**Areas discussed:** none asked — the four product decisions were taken by the founder on 2026-11-14 and are recorded in the ROADMAP entry. Smart discuss ran in a phase agent that cannot ask the founder; remaining questions were classified and decided as below, with two discretion items flagged for founder review at hand-back.

---

## Manager-only placeholder rows (decision b)

| Option | Description | Selected |
|--------|-------------|----------|
| Render placeholder rows + Disconnect for every role that creates keys | Matches SC2 "a manager can disconnect"; supersedes the `isAllocator` read gate | ✓ |
| Keep placeholder rows allocator/both only | Leaves manager-only accounts with no way out, contradicting the phase goal | |

**Choice:** first option, on SC2's plain reading; Phase 199 D-02 states no reason for the exclusion. Flagged in hand-back.

## Decided autonomously

[auto] [Decision a] — Q: "Which value distinguishes unknown from keyless?" → Selected: "the existing `source` argument" (reversible technical — decided autonomously: internal contract, one call site)
[auto] [Decision a] — Q: "Show a notice when the stored session is declined?" → Selected: "no new notice" (reversible technical — decided autonomously: no draft is on screen in the unknown case)
[auto] [Decision b] — Q: "New endpoint or existing RPC for Disconnect?" → Selected: "existing `disconnect_allocator_api_key` RPC" (reversible technical — decided autonomously: no schema change)
[auto] [Decision c] — Q: "Where else must MT5 be refused?" → Selected: "add-key, set-members, enterMulti carry-over" (reversible technical — decided autonomously: TS-only guards)
[auto] [Decision d] — Q: "What ends pending on a failed probe?" → Selected: "settled-with-null counts as resolved" (reversible technical — decided autonomously: keeps the existing RANK-06 nullish rule)

## Claude's Discretion

- New MT5 composite refusal copy and rewritten `KEY_ORPHANED` fix lines.
- Whether `wizard-dedup-notice` shows on the session-fence `deduped` arm (default: shows).
- Visual form of Disconnect and pending (reuse existing components).

## Deferred Ideas

None.
