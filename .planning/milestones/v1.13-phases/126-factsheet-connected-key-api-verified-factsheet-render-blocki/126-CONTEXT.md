# Phase 126: FACTSHEET — connected-key api_verified factsheet render + blocking e2e - Context

**Gathered:** 2026-07-19
**Status:** Ready for planning
**Mode:** Auto-generated (autonomous smart-discuss; grey areas decided per founder autonomous policy)

<domain>
## Phase Boundary

The `/strategy/[id]` factsheet must render (or degrade gracefully with an honest
state) for an `api_verified` + api_key-linked sFOX strategy, and the proof is a
BLOCKING e2e gate — a hard prerequisite for the Phase 130 flag flip.

Scope: (1) ROOT-CAUSE the SSR throw that fires ONLY on the connected-key
`api_verified` factsheet render path (the SAME strategy's edit-page tag + browse
badge render fine → seed/tier are correct, so the bug is in the factsheet render
path, not the data); (2) fix at source (never suppress) AND add graceful
degradation so a transient analytics failure degrades to an honest state instead
of throwing the whole page; (3) make `e2e/sfox-badge.spec.ts` GREEN across all
roles (owner/allocator/admin) incl. axe, and wire it into the BLOCKING `frontend`
branch-protection gate (no longer advisory).

Out of scope: the flag flip itself (Phase 130), new visual design (this is a
render bug-fix on an existing page — no new UI-SPEC).
</domain>

<decisions>
## Implementation Decisions

### Root-cause discipline (FACTSHEET-01)
- The SSR throw MUST be root-caused via a seeded LOCAL repro before any fix —
  the same strategy renders fine on the edit-page tag + browse badge, so the
  fault is isolated to the factsheet `/strategy/[id]` connected-key provenance
  render path. No suppression, no try/catch-swallow, no workaround (Rule 6).
- A regression test must fail without the fix.

### Graceful degradation (FACTSHEET-01) — DECIDED (autonomous)
- When the connected-key provenance render legitimately cannot complete (e.g. a
  transient analytics-service outage or missing derived data), the page must
  DEGRADE to an honest state for that panel — NOT throw and 500 the whole
  factsheet. The rest of the factsheet renders; the provenance/verification panel
  shows an honest "verification temporarily unavailable" state (no invented data,
  per the no-invented-data principle). This doubles as prod hardening against a
  transient analytics outage.
- Fail-loud where the input is genuinely wrong (a real data/seed error still
  surfaces), fail-soft where the dependency is transiently unavailable — the
  root-cause investigation must distinguish which case the current throw is.

### Blocking e2e gate (FACTSHEET-02) — DECIDED (autonomous)
- `e2e/sfox-badge.spec.ts` must pass for owner / allocator / admin roles,
  include an axe accessibility check, and be wired into the BLOCKING `frontend`
  aggregator gate (the real e2e gate per v1.10 lesson) so it gates
  branch-protection — no longer RED/advisory.
- Seed fixtures must be OWNED BY the logged-in test user (v1.9.1 durable).

### Claude's Discretion
Exact render-path fix, the degraded-state component/copy, and test structure are
at Claude's discretion, guided by DESIGN.md, the existing factsheet surfaces, and
project conventions.
</decisions>

<code_context>
## Existing Code Insights

### Known repro (from deferred-bug memory, 2026-07-19 PR #623)
- `/strategy/[id]` SSR errors ONLY for the `api_verified` + connected-key sfox
  strategy; the edit-page tag + browse badge for the SAME strategy render fine →
  the seed is correct, the bug is in the factsheet render path.
- The seed-gated e2e spec `e2e/sfox-badge.spec.ts` landed at v1.12 122-04 and is
  currently RED/advisory.

### Integration points
- `/strategy/[id]` SSR page + its data-loading (`src/lib/queries.ts` factsheet
  path) and the connected-key provenance / `api_verified` badge render.
- `e2e/sfox-badge.spec.ts` + `.github/workflows/ci.yml` `frontend` aggregator
  branch-protection gate.
- DESIGN.md governs any visible degraded-state styling.

### Conventions
- Read DESIGN.md before any visual decision. No-invented-data for CSV-ingested /
  unavailable panels. e2e must cover all user roles, never just one.
</code_context>

<specifics>
## Specific Ideas

Reproduce the exact throw first (seeded local `api_verified`+connected-sfox-key
strategy, dev server, real render). The fix distinguishes transient-unavailable
(degrade) from genuinely-wrong (fail-loud).
</specifics>

<deferred>
## Deferred Ideas

The flag flip (Phase 130). Any broader factsheet redesign — out of scope; this is
a render-correctness + gating phase.
</deferred>
