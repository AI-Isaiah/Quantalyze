# Phase 150: OWN-03 — The wizard asks whose capital this is - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-06
**Phase:** 150-own-03-the-wizard-asks-whose-capital-this-is
**Areas discussed:** Cull list, Retro mark affordance, Holdings add interaction, Rename rules (OWN-05)

Pre-context: the core model (mark at key-add, allocate in Holdings, team keys never
allocatable, retro path required, cull mandate, OWN-05 rename) was given verbatim by the
founder on 2026-08-05 during live dogfooding and is recorded in REQUIREMENTS.md OWN-03/OWN-05
and the ROADMAP Phase 150 section. This discussion covered only the four remaining
implementation choices. The founder briefly delegated the answers to Fable, then reversed and
answered personally; all four selections matched Fable's recommendations.

---

## Cull list — what survives

| Option | Description | Selected |
|--------|-------------|----------|
| Keep 3, collapse rest | codename + description + category visible; 7 fields behind optional "More details" disclosure | ✓ |
| Keep 3, delete rest | Same essentials, other fields removed entirely | |
| Trio + markets, collapse rest | Also keeps Markets visible for browse filters | |

**User's choice:** Keep 3, collapse rest (with approved ASCII form mock incl. capital question first).

---

## Retro mark affordance

| Option | Description | Selected |
|--------|-------------|----------|
| /my-strategies row action | Row action sets mark; tag on row; factsheet read-only; no wizard shortcut | ✓ |
| Owner factsheet banner | Mark set from factsheet banner | |
| Both surfaces | Settable in both places | |

**User's choice:** /my-strategies row action.

---

## Holdings add interaction

| Option | Description | Selected |
|--------|-------------|----------|
| USD amount, edit-on-repeat | Allocate… asks USD amount; repeat opens EDIT of existing position | ✓ |
| Weight %, edit-on-repeat | Target weight instead of amount | |
| Amount + optional weight | Amount with live implied weight | |

**User's choice:** USD amount, edit-on-repeat (with approved Holdings mock).

---

## Rename rules (OWN-05)

| Option | Description | Selected |
|--------|-------------|----------|
| Private/draft only, both surfaces | my-strategies row + owner factsheet header; codename contract untouched | ✓ |
| Private/draft only, my-strategies only | One surface | |
| Also published-own | Rename after publication too | |

**User's choice:** Private/draft only, both surfaces.

## Claude's Discretion

Question copy, disclosure styling, mark-tag styling and placement, Allocate dialog vs inline,
amount validation, structural-gate mechanics for the never-allocatable invariant.

## Deferred Ideas

- Published-own rename (trust surface) — post-v1.17.
- Wizard-side "allocate now" shortcut — only if two-step proves annoying.
- Role-gated form variants beyond the capital question.
