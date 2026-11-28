# Phase 243: DBBACKSTOP - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-11-26
**Phase:** 243-dbbackstop
**Areas discussed:** DBACC-01 anon metric reads, DBACC-02 api_keys ownership, DBACC-03 client lock hold

Run as a background phase agent, which cannot prompt the founder. Hard-to-reverse calls were taken by the agent under the founder rule "no clients yet: take the call, say what I did", except DBACC-02. ROADMAP requires architecture sign-off for DBACC-02, so it was sent to main for the founder.

## DBACC-01 anon metric reads

| Option | Description | Selected |
|--------|-------------|----------|
| Payload select aliases only | ROADMAP SC-1 wording; leaves the direct anon REST read of the column open | |
| Aliases + anon column revoke | Also closes the direct REST read measured on PROD | ✓ |
| Aliases + revoke for anon and authenticated | Breaks owner-side dashboard reads through the user client | |

**Choice:** agent-decided, founder may override at plan review.

## DBACC-02 api_keys ownership

| Option | Description | Selected |
|--------|-------------|----------|
| Immutable user_id + writer-only insert fence | Narrows "the caller's"; keeps Phase 156's service_role writers | recommended |
| Verified identity (user JWT + server secret) | Literal; partly reverses Phase 156, adds a vault secret | |
| UPDATE immutability only | Drops the INSERT half | |

**Choice:** founder sign-off owed (sent to main 2026-11-26).

## DBACC-03 client lock hold

| Option | Description | Selected |
|--------|-------------|----------|
| Pin measured role timeouts by migration + gate | Platform defaults already exist (anon 3s, authenticated 8s); prove PostgREST honours them on TEST first | ✓ |
| Rely on platform defaults, no migration | Bound can drift silently with no repo record | |

## Decided autonomously

[auto] [DBACC-01] — Q: "Aliases or RPC?" → Selected: "named aliases in the existing embed" (reversible technical — decided autonomously: one select)
[auto] [DBACC-01] — Q: "How pinned?" → Selected: "exact-set test over the select" (reversible technical — decided autonomously: one test file)
[auto] [Plan split] — Q: "Plan grouping?" → Selected: "one plan per requirement, migrations serialized" (reversible technical — decided autonomously: plan files only)
[auto] [Ship] — Q: "PR packaging?" → Selected: "DBACC-01 + 03 first, DBACC-02 after sign-off" (reversible technical — decided autonomously: packaging only)
[auto] [Migration timestamps] — Q: "Floor?" → Selected: "after PROD ledger tip and Phase 242's migration" (reversible technical — decided autonomously: rename before merge)

## Deferred Ideas

- authenticated non-owner whole-column read of metrics_json_by_basis
- GRANT ALL residue on api_keys
