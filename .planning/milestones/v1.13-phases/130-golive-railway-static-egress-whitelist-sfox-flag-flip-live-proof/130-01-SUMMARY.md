---
phase: 130-golive-railway-static-egress-whitelist-sfox-flag-flip-live-proof
plan: 01
subsystem: infra / go-live ops
tags: [sfox, go-live, egress, railway, vercel, runbook, flag-flip, human_needed]
requires:
  - Phase 126 FACTSHEET (blocking e2e-seeded green via gh pr checks)
  - Phase 127 E2GT-01 (live anchor-consistency run — still human_needed-OPEN)
  - external sFOX IP-bind whitelist turnaround (founder long-pole)
provides:
  - docs/runbooks/sfox-go-live.md (founder Steps 0-5 go-live execution path + explicit GOLIVE-01 gate + trivial rollback)
affects:
  - sFOX flags SFOX_ENABLED (Railway) + NEXT_PUBLIC_SFOX_ENABLED (Vercel) — flip delivered as a gated path, NOT performed
tech-stack:
  added: []
  patterns:
    - mirror flipretry-derived-equity-go-live.md Step-N + explicit-gate + rollback structure
    - env-only, never-committed secret rule (creds live in Railway/Vercel/sFOX dashboards)
key-files:
  created:
    - docs/runbooks/sfox-go-live.md
  modified: []
decisions:
  - "ZERO code/build work — Railway Pro static outbound is the egress path (founder 2026-07-19, locked); NO Fly, NO proxy; WORKER_EGRESS_PROXY_URL stays UNSET; fly-egress-proxy/ dormant"
  - "All 5 EGRESS/GOLIVE requirements dispositioned human_needed-OPEN (DEFER, pre-decided) — the runbook IS the delivered execution path; milestone ships FLAG-OFF (as v1.12 did)"
metrics:
  duration: "~10 min"
  completed: 2026-07-20
  tasks_completed: 3
  files_created: 1
  files_modified: 0
---

# Phase 130 Plan 01: sFOX Go-Live Runbook + honest FLAG-OFF culmination Summary

Delivered `docs/runbooks/sfox-go-live.md` — the founder's complete, explicitly-gated,
rollback-safe sFOX go-live execution path (Steps 0–5) — and dispositioned all 5
EGRESS/GOLIVE requirements human_needed-OPEN. The milestone ships FLAG-OFF: the
go-live path is fully documented and gated; the flip awaits the external sFOX IP-bind
whitelist + the founder's live run. Zero code/build/prod work.

## What Was Built

**Task 1 (BUILDABLE — the ONE deliverable):** `docs/runbooks/sfox-go-live.md`
(189 lines, new tracked file, commit `19a9b690`). Mirrors the sibling
`flipretry-derived-equity-go-live.md` structure (title/Owner/Risk header,
why-this-exists framing, `## Step N —` ordering, per-step Verify + Abort-path
bullets, explicit gate, standing "abort → Step 5 ROLLBACK" rule):

- **Step 0 — EGRESS-01:** read the FULL Railway 3-IP static-outbound set (service →
  Settings → Networking; redeploy if it activates on next deploy, cross-ref
  `railway-worker.md`). ⭐ Whole-set whitelist rule stated in bold — never one
  observed IP.
- **Step 1 — EGRESS-02:** ≥5 repeated `railway ssh "cd /app && curl -s ipinfo.io"`
  probes; assert country NL; gate = observed set ⊆ dashboard set.
- **Step 2 — EGRESS-03:** `security@quantalyze.com` 3-IP whitelist handoff +
  native-egress key-auth proof with `WORKER_EGRESS_PROXY_URL` UNSET verified; the
  only proxy mention is the single-IP fallback, explicitly "NOT Fly".
- **Step 3 — GOLIVE-01:** the EXPLICIT 5-row gate table (EGRESS 1-3 + FACTSHEET via
  `gh pr checks` + two-part E2GT `within_same_day_tolerance===true`, cross-ref FLIP
  runbook Step 4), then flip `SFOX_ENABLED` + `NEXT_PUBLIC_SFOX_ENABLED` + redeploy
  BOTH sides (NEXT_PUBLIC baked at build time — un-redeployed = silent no-op).
- **Step 4 — GOLIVE-02:** live `api_verified` proof across factsheet + discovery +
  edit × owner / allocator / admin — the full flow (v1.10 lesson).
- **Step 5 — ROLLBACK:** both flags → empty + redeploy → dormant v1.12; env-only, no
  SQL/migration/code revert.

Verification: the single chained grep gate prints **RUNBOOK-GATES-GREEN** (structure,
all required commands/rules/cross-refs present, zero Fly-deploy content). Zero-build
invariant confirmed: `git status --porcelain` excluding the runbook returns nothing
tracked-changed; no source/migration/manifest/`fly-egress-proxy/` touched.

## Requirement Dispositions (Tasks 2 & 3 — PRE-DECIDED: DEFER, human_needed-OPEN)

Tasks 2 (EGRESS-01/02/03) and 3 (GOLIVE-01/02) are founder LIVE ops requiring
prod-only access (Railway Pro dashboard, `railway ssh` into the prod worker, sFOX
dashboard / security@ handoff, Railway + Vercel prod env toggles, a real
IP-whitelisted sFOX key + multi-role session) plus the EXTERNAL sFOX IP-bind
turnaround — none of which the autonomous run holds. Disposition was pre-decided
DEFER; recorded in REQUIREMENTS.md traceability with `docs/runbooks/sfox-go-live.md`
named as the delivered execution path:

| Req | Status | Execution path | Live-evidence contract (never claimed done without it) |
|-----|--------|----------------|--------------------------------------------------------|
| EGRESS-01 | human_needed-OPEN | runbook Step 0 | recorded FULL 3-IP dashboard set |
| EGRESS-02 | human_needed-OPEN | runbook Step 1 | ≥5 probes, all NL, observed ⊆ dashboard set |
| EGRESS-03 | human_needed-OPEN | runbook Step 2 | authenticating whitelisted key from native egress (`WORKER_EGRESS_PROXY_URL` unset) |
| GOLIVE-01 | human_needed-OPEN | runbook Step 3 | flags-observed set + both redeploys verified (blockers: EGRESS-01/02/03, E2GT-01) |
| GOLIVE-02 | human_needed-OPEN | runbook Step 4 (+5) | `api_verified` render on all 3 surfaces × 3 roles |

No simulation, no CI-derived claim, no partial credit. No prod command was run against
Railway, Vercel, sFOX, or Supabase by the executor. The founder did not supply live
evidence during this session, so all 5 remain OPEN — the honest culmination.

## Deviations from Plan

None — plan executed exactly as written. The checkpoint tasks (2 & 3) carried a
pre-decided DEFER disposition in the plan (and the milestone-level FLAG-OFF decision),
so no checkpoint pause was warranted; both recorded human_needed-OPEN per spec.

## Known Stubs

None. The deliverable is a documentation runbook with no data-wired components.

## Threat Flags

None — no new security surface introduced. The runbook carries zero secret material
(creds live only in the Railway/Vercel/sFOX dashboards, mirroring the FLIP runbook's
env-only rule — threat register T-130-03 mitigated). No network endpoints, auth paths,
schema changes, or file-access patterns added.

## Self-Check: PASSED

- FOUND: docs/runbooks/sfox-go-live.md (189 lines, RUNBOOK-GATES-GREEN)
- FOUND commit: 19a9b690 (docs(130-01): add sFOX go-live runbook)
- REQUIREMENTS.md: EGRESS-01/02/03 + GOLIVE-01/02 all recorded human_needed-OPEN with
  runbook execution path named
- Zero-build invariant: git status shows only the runbook; no source/migration/proxy
  changes
