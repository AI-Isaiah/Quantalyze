# Phase 157: FOUNDER-CONFIRM - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-11-23
**Phase:** 157-founder-confirm
**Areas discussed:** Staging FCONF-02/03, Reaching each surface, FCONF-01, FCONF-04 rotation, Plan shape

The phase agent ran as a background subagent and could not ask the founder. Every selection below is the agent's default, recorded so the founder can override it before the observation session.

---

## Staging FCONF-02 and FCONF-03

| Option | Description | Selected |
|--------|-------------|----------|
| Browser-side response stub on the PROD wizard | Real deployed bundle, exact route envelopes, no request leaves the browser, no PROD writes | ✓ |
| Provoke the real fault on PROD | Unset the MT5 gateway env (breaks every MT5 key) or delete a strategy's trades mid-job | |
| Local dev server against TEST | Real fault reachable by unsetting env locally, but the founder needs a local sign-in, and it is not the deployed wizard | |

**User's choice:** not asked (agent default).
**Notes:** 153.7's human item already names "stubbing the route response".

## Reaching each surface

| Option | Description | Selected |
|--------|-------------|----------|
| Overlay with the draft read stubbed to none (connect step), resume for Submit and Sync | Keeps the founder's only live draft | ✓ |
| "Start fresh" | Deletes the draft | |

**User's choice:** not asked (agent default).

## FCONF-01

| Option | Description | Selected |
|--------|-------------|----------|
| Treat as done from the 2026-11-19 notes | Notes say the banner leg was pending; the Resume landing is unrecorded | |
| Short private-window re-observation | Banner, Resume, lands on the draft's step | ✓ |

**User's choice:** not asked (agent default).

## FCONF-04 rotation

| Option | Description | Selected |
|--------|-------------|----------|
| MM2 investor password at the broker, then every PROD key on MM2's account through "Update password", then the gate-1 read | Per 155.1-SPIKE-RUNBOOK's MM2 login | ✓ |
| Rotate now | 155.2's live reads still need the current password | |

**User's choice:** not asked (agent default).

## Claude's Discretion

- The exact stub shapes for the draft-save, kickoff and poll requests.

## Decided autonomously

[auto] [Kit location] — Q: "Where does the staging kit live?" → Selected: "phase directory" (reversible technical — decided autonomously: a one-commit move)
[auto] [Tests] — Q: "Add render tests?" → Selected: "No" (reversible technical — decided autonomously: an observation phase, not a code ship)
[auto] [Public repo] — Q: "How does the kit match routes?" → Selected: "path patterns, no ids" (reversible technical — decided autonomously: local to two files)
[auto] [Rehearsal] — Q: "Rehearse in the founder's Chrome?" → Selected: "No" (reversible technical — decided autonomously: avoids colliding with another session's UAT)

## Deferred Ideas

- Render tests for the four 153.7 copy members (their own phase).
