---
phase: 138-mt5ui-addkey-badge-e2e
plan: 02
subsystem: ui
tags: [mt5, feature-flag, security-page, setup-guide, subanchor, vitest, server-flag]

# Dependency graph
requires:
  - phase: 135-mt5-server-seam
    provides: "isMt5EnabledServer() server gate (closed-sets.ts:150); KEY_MT5_MASTER_PASSWORD / KEY_MT5_WRONG_SERVER honesty copy the guide must agree with"
  - phase: 138-01
    provides: "wizard's derived /security#mt5-readonly deep-link whose stable target this plan provides"
provides:
  - "Flag-gated #mt5-readonly SubAnchor on /security nested under #readonly-key (renders iff MT5_ENABLED === 'true')"
  - "Investor-password steer + broker-server-exactly guidance in muted DESIGN.md-conformant voice, honest to the 135 refusal contract"
  - "Renders-iff-server-flag describe blocks (on / off / non-exact it.each) + content-honesty + negative-IP pins"
affects: [138-03, 139-golive]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Server-flag-gated SubAnchor cloned verbatim from #sfox-readonly (isMt5EnabledServer() gate, per-request server env read, never the client NEXT_PUBLIC flag)"
    - "Direct process.env set/delete env hygiene in the describe (no vi.stubEnv) — the page reads env per-render"

key-files:
  created: []
  modified:
    - src/app/(marketing)/security/page.tsx
    - src/app/(marketing)/security/page.test.tsx

key-decisions:
  - "Gate on the SERVER flag isMt5EnabledServer() exactly as the sfox block calls isSfoxEnabledServer() — never the client NEXT_PUBLIC_MT5_ENABLED (RESEARCH Pitfall 3): the guide is a Server Component and a client-flag gate would desync the guide from backend availability"
  - "Refusal-honesty copy phrased 'refuse it at connect time and store nothing' to agree with KEY_MT5_MASTER_PASSWORD; no 'we verify scope' hedge needed (MT5 read-only is server-enforced by the investor login + 135 rejection, unlike sfox)"
  - "No IP / gateway / hosting / whitelist claim — that surface is Phase 139 founder ops and not real yet (no-invented-data); negative regexes pin its absence"

patterns-established:
  - "MT5 setup-guide SubAnchor mirrors the sfox precedent for placement, gating seam, env hygiene, and muted voice"

requirements-completed: [MT5UI-01]

# Metrics
duration: 8min
completed: 2026-07-24
---

# Phase 138 Plan 02: MT5 investor-password setup guide Summary

**Flag-gated `#mt5-readonly` SubAnchor on /security that steers MT5 users to the investor (read-only) password in muted tone, honest to the 135 refusal contract, and byte-identically absent while `MT5_ENABLED` is off.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-07-24T00:42:00Z
- **Completed:** 2026-07-24T00:46:00Z
- **Tasks:** 1 (TDD: RED → GREEN)
- **Files modified:** 2

## Accomplishments
- New `#mt5-readonly` SubAnchor nested under `#readonly-key`, mirroring the shipped `#sfox-readonly` block, gated on the SERVER flag `isMt5EnabledServer()`.
- Prominent up-front steer: connect with the investor (read-only) password, never the master password — a master password can trade, so it is refused at connect time with nothing stored (agrees with `KEY_MT5_MASTER_PASSWORD`).
- Broker-server guidance: copy the server name exactly from the MT5 terminal login window, with the region / Demo-Live suffix caveat (agrees with `KEY_MT5_WRONG_SERVER`).
- Muted DESIGN.md voice (`text-body text-text-secondary`, no amber/red, no `⚠` glyph); no IP / gateway / hosting claim (Phase 139 ops).
- Renders-iff-flag proven both directions: ON block present; ABSENT for unset + 5 non-exact values (`"1"`, `"on"`, `""`, `"false"`, `"TRUE"`); sibling `#deribit-readonly` and the sfox gating untouched.

## Task Commits

Each task was committed atomically (TDD):

1. **Task 1 (RED): failing tests for #mt5-readonly** - `f3116d20` (test)
2. **Task 1 (GREEN): flag-gated #mt5-readonly guide** - `c1be3644` (feat)

## Files Created/Modified
- `src/app/(marketing)/security/page.tsx` - Added `isMt5EnabledServer` import; new gated `#mt5-readonly` SubAnchor (4-step ordered list) after the sfox block inside the `#readonly-key` wrapper, with a gating comment mirroring the sfox precedent.
- `src/app/(marketing)/security/page.test.tsx` - Two describe blocks cloned from the sfox suite: renders-iff-`MT5_ENABLED` (heading + nesting + content honesty pins + negative IP/infra regexes) and founder-gated-off (absent unset + non-exact `it.each` + sibling/sfox untouched).

## Decisions Made
- Gated on the SERVER flag `isMt5EnabledServer()`, not the client `NEXT_PUBLIC_MT5_ENABLED` (RESEARCH Pitfall 3 — a Server Component page tied to backend availability).
- Chose the refusal-honesty phrasing "refuse it at connect time and store nothing" to satisfy the test pins `/refuse/i` + `/store nothing/i` and stay verbatim-consistent with the 135 `KEY_MT5_MASTER_PASSWORD` cause copy.
- No IP / egress / gateway mention (no-invented-data; that infra is Phase 139) — pinned by negative regexes.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required. (The guide only renders in production once the founder sets `MT5_ENABLED=true` at Phase 139 go-live — no action needed this phase.)

## Next Phase Readiness
- The wizard's `/security#mt5-readonly` deep-link (plan 138-01) now has a real, flag-gated target.
- Plan 138-03 (e2e) can proceed; the guide is dark until `MT5_ENABLED` flips in Phase 139.

## Self-Check: PASSED

---
*Phase: 138-mt5ui-addkey-badge-e2e*
*Completed: 2026-07-24*
