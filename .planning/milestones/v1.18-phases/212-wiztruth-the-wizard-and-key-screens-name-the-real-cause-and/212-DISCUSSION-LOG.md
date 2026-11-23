# Phase 212: WIZTRUTH - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-11-14
**Phase:** 212-wiztruth
**Areas discussed:** MT5 cause-unknown copy, contact-support pointers, MT5 connect during a derive

Questions were relayed to the founder by the coordinating session (AskUserQuestion, 2026-11-14).

---

## MT5 cause-unknown copy (SC2)

| Option | Description | Selected |
|--------|-------------|----------|
| A, names no cause | "The MT5 gateway would not let us prove read-only capability, and it did not report why. This needs an operator, not a retry — see docs/runbooks/mt5-go-live.md." | ✓ |
| B, keeps the trading claim | "The MT5 gateway does not allow automated trading, and it did not say which setting causes that, ..." — first clause unproven on the degradation path | |

**User's choice:** Option A. Satisfies SC2's founder-approval clause.

---

## Contact-support pointers (SC6)

| Option | Description | Selected |
|--------|-------------|----------|
| Plain-text "use the contact form" in server strings, admin strings name the admin action, in-app strings via ContactPointerText | No new response field | ✓ |
| Structured `contact` field on JSON responses | New response shape, every screen renders it | |

**User's choice:** The recommendation. Admin `audit_warning` strings e.g. "Add the audit entry by hand; do not re-send."

---

## MT5 connect during a running derive (SC4)

| Option | Description | Selected |
|--------|-------------|----------|
| Measure, then decide | Railway `mt5.stage` hold times; raise the env-var wait if p95 hold plus our check fits 120 s, else keep busy refusal with measured retry time | ✓ |
| Always refuse fast with measured retry time | Never makes the user wait | |
| Always wait | Risks the 120 s budget | |

**User's choice:** Measure, then decide.

---

## Decided autonomously

[auto] [Composite verdict] — Q: "How does the composite arm pick its code?" → Selected: "Branch on the real verdict via gateFailureToWizardError; sampled_gapped and fill_derived_unproven render GATE_SERIES_EXAMINED_REFUSED" (reversible technical — decided autonomously: local branch plus test)
[auto] [Code channel] — Q: "How do the three validate-and-encrypt consumers render?" → Selected: "Read code and look up copy via a roster, as recogniseCreateWithKeyCode does" (reversible technical — decided autonomously: client render change)
[auto] [Bare 401/403] — Q: "Where does a bare upstream 401/403 get its code?" → Selected: "Shared UPSTREAM_STATUS_TO_SEAM_CODE consulted in the classifier's null-seamCode branch" (reversible technical — decided autonomously: internal mapping)
[auto] [Orphan refusal] — Q: "When is an orphaned MT5 key refused?" → Selected: "Before the 120 s validate where identity is known first" (reversible technical — decided autonomously: reorder within one route)
[auto] [Scope] — Q: "Migration?" → Selected: "None" (reversible technical — decided autonomously: nothing written)
[auto] [Tests] — Q: "Proof standard" → Selected: "Each fix RED when reverted" (reversible technical — decided autonomously: test-only)

## Claude's Discretion

Exact code names, file splits and test placement.

## Deferred Ideas

None.
