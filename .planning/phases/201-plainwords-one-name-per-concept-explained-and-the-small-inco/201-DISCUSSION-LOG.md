# Phase 201: PLAINWORDS - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-11-11
**Phase:** 201-PLAINWORDS
**Mode:** `--auto` (founder unavailable; the phase agent took the recommended option for every question)
**Areas discussed:** Term explanations, Canonical names, Retired-word census, Strategy name, Date format, Egress-IP link, Routed residuals

---

## Term explanations

| Option | Description | Selected |
|--------|-------------|----------|
| Tooltips from one registry | One definitions module, rendered through the existing Tooltip primitive | ✓ |
| Glossary page + links | A `/glossary` page and a link per term | |
| Both | Registry renders tooltips and a page | |

**Choice:** [auto] Tooltips from one registry (recommended default; SC-1 allows either).

## Canonical names

| Concept | Options | Selected |
|---------|---------|----------|
| Allocator's holdings | allocation / portfolio / book | allocation (matches sidebar, 196 D-02, 198 D-03) |
| Followed strategy | watchlist / favorites / starred | watchlist (matches the panel and discovery tab) |
| Investment criteria | mandate / preferences / profile | mandate; Profile = account page only |

**Choice:** [auto] recommended defaults above.

## Retired-word census

| Option | Description | Selected |
|--------|-------------|----------|
| Static scan of user-visible strings with a count-pinned exception list | vitest, no browser | ✓ |
| Render-based census of key pages | jsdom renders | |

## Strategy name

| Option | Description | Selected |
|--------|-------------|----------|
| One resolver: name, then codename, then `Strategy #id` | Applies the founder's "Real name everywhere" | ✓ |
| Patch only the three named surfaces | Leaves two resolvers | |

## Date format

| Option | Description | Selected |
|--------|-------------|----------|
| `Oct 9, 2026` (and `Oct 2026` for months) | Already the most common explicit format in `src` | ✓ |
| `2026-10-09` | ISO, used by the manager table | |
| `9 Oct 2026` | Day-first | |

## Egress-IP link

| Option | Description | Selected |
|--------|-------------|----------|
| Remove the link; point to the contact form for the current IP set | The IPs are not published | ✓ |
| Publish the IPs on /security | No published IP set exists yet | |

## Routed residuals

| Item | Selected |
|------|----------|
| `[197-VOL-SIGN-TEARSHEET-COMPARE]` | Folded (TODOS names Phase 201 as owner) |
| 195 UC-10 custody sentence | Folded, conditional on the researcher finding a live non-api caller |
| 199 D-06 / `[197-SYNCBADGE-SERIES-LADDER]` | Not folded (threshold logic, not wording; founder to confirm) |

## Claude's Discretion

- Definition wording, term wrapper API, census verb/job-title handling, plan split, the new name for the factsheet constituent "Mandate" heading.

## Deferred Ideas

- SyncBadge series ladder vs `listSeriesVerdict` (199 D-06 residual).
- Percentile cohort including stale peers.
