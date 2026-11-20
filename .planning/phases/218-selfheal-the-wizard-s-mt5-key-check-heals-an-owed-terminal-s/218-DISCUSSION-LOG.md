# Phase 218: SELFHEAL - Discussion Log

> Audit trail only. Decisions live in 218-CONTEXT.md.

**Date:** 2026-11-19
**Mode:** smart discuss, run by the phase agent (no founder questions available in-session; hard-to-reverse questions took the recommended answer, per the phase-agent rule "take the (Recommended) default, else stop and report")

## Inline scrub time budget

| Option | Description | Selected |
|---|---|---|
| Fit the scrub inside the existing 105 s / 120 s budget, probe deadline = remainder | No cross-seam contract moves | ✓ (recommended) |
| Raise D-26's client ceiling to add a scrub term | Touches Phase 153.4's seam-budget gate, routes and the wizard timeout | |

## Answer when the inline scrub fails

| Option | Description | Selected |
|---|---|---|
| New wire code + wizard key, recoverable per scrub kind | Names the real cause; MT5_TERMINAL_BUSY narrows to the held-lease emitter | ✓ (recommended) |
| Reuse MT5_TERMINAL_BUSY with new copy | Copy could not be true at both emitters | |

## Wizard resume banner

Specified by the founder in the ROADMAP entry (hold the step until a choice; copy by key type; silent same-browser resume stays). Implementation shape decided autonomously.

## Decided autonomously

[auto] [Server] — Q: "Where does the healed path live?" → Selected: "In place at the owed gate, reusing the scrub-under-lease machinery" (reversible technical — decided autonomously: local to one function)
[auto] [Server] — Q: "Does the scheduled-scrub path stay?" → Selected: "Yes for post-check scrubs; the owed gate pays inline" (reversible technical — decided autonomously: internal control flow)
[auto] [Server] — Q: "Does report_scrub_owed_refusal stay?" → Selected: "Only on a real refusal; a healed check logs INFO" (reversible technical — decided autonomously: logging only)
[auto] [Tests] — Q: "How is the heal proven?" → Selected: "pytest per scrub kind + budget ordering test + vitest for key and banner, each neutered once" (reversible technical — decided autonomously: tests only)
[auto] [Wizard] — Q: "How is 'hold the step' implemented?" → Selected: "Render the banner alone while a choice is pending" (reversible technical — decided autonomously: component-local state)
