# Phase 244: ACCESSGUARDS - Discussion Log

**Date:** 2026-11-26
**Mode:** smart discuss (autonomous, phase agent; no direct founder channel)

## DBACC-05 per-site exemptions

| Option | Description | Selected |
|---|---|---|
| Exempt sites 2-6 by founder decision, site 1 covered by its roll-up row | Proposed in-window pragmas citing the founder exemption | Recommended, sent to main for founder answer |
| Real audit rows for sites 2-6 | New AuditAction values, likely a migration (PROD auto-apply) | |

Answer: founder, 2026-11-26, "Approve as proposed" (relayed by the coordinating session).

## Decided autonomously

[auto] [DBACC-04] — Q: "How is the compile guard shaped?" → Selected: "required api_key_id plus PublicStrategy = Omit<Strategy,'api_key_id'> for public readers" (reversible technical — decided autonomously: local type edit)
[auto] [DBACC-04] — Q: "How is the guard tested?" → Selected: "@ts-expect-error type test gated by tsc --noEmit" (reversible technical — decided autonomously: test-only)
[auto] [DBACC-05] — Q: "How does the ratchet end?" → Selected: "delete discharged entries and lower the literal in the same commit" (reversible technical — decided autonomously: test edit)
[auto] [DBACC-05] — Q: "PROOF-01 for the audit gate?" → Selected: "remove one new pragma, see the named site red, byte-restore" (reversible technical — decided autonomously: proof procedure)
[auto] [DBACC-06] — Q: "How is the watchlist spec wired?" → Selected: "e2e-seeded list plus a wiring pin test" (reversible technical — decided autonomously: CI list edit)
[auto] [DBACC-06] — Q: "What about the RLS arm's silent skip?" → Selected: "remove the if (anonKey) guard" (reversible technical — decided autonomously: spec edit)
[auto] [DBACC-06] — Q: "Where is the neutered-policy proof run?" → Selected: "local-stack lane only, Docker cleaned up after" (reversible technical — decided autonomously: local procedure)
[auto] [DBACC-06] — Q: "Run-and-repair?" → Selected: "run against local stack before wiring, repair inside the spec" (reversible technical — decided autonomously: spec-local)
