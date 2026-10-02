# Phase 1: Outcome Tracker - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-17
**Phase:** 01-outcome-tracker
**Areas discussed:** Banner UX, Recording form mode, Estimated delta labels
**Areas skipped:** Cron + needs_recompute (user opted out; defaults captured as D-15/D-16)

---

## Banner UX

### Banner appearance
| Option | Description | Selected |
|--------|-------------|----------|
| Row-integrated strip | Subtle inline strip above/below row with CTA buttons | ✓ |
| Card above table | Batched card listing all pending outcomes | |
| Inline-expandable | Small chip that expands a form on click | |

### Dismiss behavior
| Option | Description | Selected |
|--------|-------------|----------|
| Client-only session dismiss | sessionStorage only, no DB | |
| Server-side snooze with TTL | New `bridge_outcome_dismissals` table, 24h TTL | ✓ |
| Soft dismiss (no close button) | No X; banner stays until recorded | |

### Placement
| Option | Description | Selected |
|--------|-------------|----------|
| My Allocation → Holdings widget | Existing allocations dashboard | ✓ |
| Standalone Bridge Outcomes page | New dedicated route | |
| Both | Holdings + separate outcomes page | |

### Blocked case (OUTCOME-04)
| Option | Description | Selected |
|--------|-------------|----------|
| Banner never appears | Strict server-side filter; no UI error path | ✓ |
| Banner + error toast | Client filter; server 403 + toast | |
| Silent ignore | Server no-ops on invalid | |

---

## Recording form mode

### Form mode
| Option | Description | Selected |
|--------|-------------|----------|
| Two separate flows | [Allocated] and [Rejected] each open their own compact form | ✓ |
| Single toggle form | One form, status toggle swaps fields | |

### Rejection reason
| Option | Description | Selected |
|--------|-------------|----------|
| Preset chips + optional note | Enum reasons + textarea | ✓ |
| Freetext only | Single textarea, no structure | |
| Chips only (no note) | Enum only, no freetext | |

### Allocated fields
| Option | Description | Selected |
|--------|-------------|----------|
| % + date, strict validation | Required % + date, no note | |
| % + date + optional note | Adds optional note textarea | ✓ |
| % only, date defaults to today | Minimal, loses backdating | |

### Save UX
| Option | Description | Selected |
|--------|-------------|----------|
| Inline replace + toast | Row updates in place, toast confirms | ✓ |
| Modal form | Dedicated modal | |
| Inline form, no toast | Silent inline update | |

---

## Estimated delta labels

### Label progression
| Option | Description | Selected |
|--------|-------------|----------|
| Exact days available | "Estimated: +X.X% (Nd)" → "30-day:" → "90-day:" → "180-day:" | ✓ |
| Window-only labels | Just "Estimated" / "30-day" / ... | |
| Tooltip for detail | Concise label + tooltip for day count | |

### Color treatment
| Option | Description | Selected |
|--------|-------------|----------|
| Green/red only on realized | Estimated/Pending neutral; color only ≥30d | ✓ |
| Color from day 1 | All deltas colored | |
| Color + icon | Green/red + ▲/▼ icons | |

### Pending state
| Option | Description | Selected |
|--------|-------------|----------|
| 'Pending' pill | Neutral pill matching DASHBOARD-06 naming | ✓ |
| '—' placeholder | Em-dash | |
| 'Awaiting returns data' | Full text | |

### Row error (cron failure)
| Option | Description | Selected |
|--------|-------------|----------|
| Show 'Pending' + admin alert | User-facing stays Pending; admin logs error | ✓ |
| Show 'Error' with retry | Surface row-level error + manual retry | |
| Hide the row | Skip rendering | |

---

## Claude's Discretion

Noted in CONTEXT.md:
- DB column names, indexes, constraint naming — follow existing migration style
- React component decomposition inside allocations widget
- Toast library selection (reuse existing)
- Error copy refinements
- Banner/form animation specifics
- Banner visual styling details (following DESIGN.md)

## Deferred Ideas

- Standalone Bridge Outcomes page (Phase 5 covers history surface)
- Client-only sessionStorage dismiss
- User-facing retry button on cron failure
- Full column-level RLS on bridge_outcomes
- Cron observability dashboard
