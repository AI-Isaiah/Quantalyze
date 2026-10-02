---
phase: 145-job-csv-finalize-atomicity
plan: 02
subsystem: infra
tags: [census, live-verification, measurement, founder-decision, csv-finalize, supabase-mcp]
status: complete

# Dependency graph
requires:
  - phase: 145-01
    provides: "arms 1-3 executed (auth-guard CI gate, call-site grep, Python wiring gates) + 145-REPRODUCTION.md draft with the pre-registered oracle"
provides:
  - "SC#1 FINAL VERDICT: CANNOT REPRODUCE — the GUARD is live, the PATH is closed (all four arms GREEN; committed in 145-REPRODUCTION.md)"
  - "The four-query census on BOTH projects, per-row; STOP-rule 3 FIRED (18 PROD candidates, all incident-era fossils) → Plan 06 terminalize gets a real list"
  - "145-MEASUREMENT.md — payload 280,260 B; parse 3.1-4.4 ms; full-cap persist delta ≤ noise; latency argument RETIRED; plus the falsified-precondition record (NO TEST Railway exists)"
  - "145-DECISION.md — founder selected (i-b): route calls the fold directly; 106 Stage B consciously reversed for this flow; Python branch deletion obligated"
  - "SC#3 measured before-state (five-relation baseline for strategy 824b0fe8) + two minted TEST strategy ids for Plan 06's archive step"
  - "TODOS 42501 bullet CLOSED citing forward-JWT (Phase 19.1) per D-03"
affects: [145-03 (fold migration), 145-04 (reads 145-DECISION.md as branch key), 145-05 (TODOS deferrals), 145-06 (terminalize list + SC#3 diff)]

# Tech tracking
tech-stack:
  added: []
  patterns: ["zero-DB measurement harness importing the real pydantic model (no secrets, no worker risk)", "routers-only uvicorn app to exercise a route path without main.py's lifespan worker loops", "launcher loads guarded env files into child-process env only — secret values never enter the session transcript"]

key-files:
  created:
    - .planning/phases/145-job-csv-finalize-atomicity/145-MEASUREMENT.md
    - .planning/phases/145-job-csv-finalize-atomicity/145-DECISION.md
  modified:
    - .planning/phases/145-job-csv-finalize-atomicity/145-REPRODUCTION.md
    - TODOS.md

key-decisions:
  - "Founder: (i-b) — route calls the folded RPC directly (blocking checkpoint, fed by the numbers; D-06 honored end-to-end)"
  - "Step A re-scoped to a local zero-DB harness after the TEST-Railway precondition was FALSIFIED by measurement (Railway API: one project, one production environment); the network leg is recorded as UNMEASURED, never estimated"
  - "Arm 4 ran routers-only: main.py's lifespan (main.py:271-273) unconditionally starts dispatch_loop — a full local app would have violated TEST's no-worker invariant (the JOB-08 argument rests on it)"

patterns-for-future-work:
  - "The e2e-seeded local topology (next dev + TEST Supabase) needs: allowed Origin header (csrf.ts allowlist via NEXT_PUBLIC_SITE_URL), an approved profile (role=manager + manager_status='verified', display_name NOT NULL), and @supabase/ssr-minted cookies"
  - "Sequence live-TEST work behind CI's shared-test-db group — arm 4 waited for the e2e-seeded rerun to drain"

# Metrics
duration: ~2.5h wall clock (census earlier in session; arm 4 + measurement + decision 19:03-19:45 UTC)
completed: 2026-08-17
---

# Phase 145 Plan 02: census + arm 4 + measurement + the founder decision

**SC#1 is a committed pass/fail fact (CANNOT REPRODUCE, four arms GREEN, live confirmation),
and the founder chose (i-b) on NUMBERS at a blocking checkpoint — both founder rulings from
CONTEXT are now discharged with evidence attached.**

## Task outcomes

| Task | Outcome |
|---|---|
| 1 — census | Done (earlier this session, commit 45880985): STOP-rule 3 FIRED — 18 PROD csv-orphan candidates, every one dated 2026-05-07/05-21 (incident-era, pre-dating the Phase 19.1 fix); TEST csv population zero; the 8107 TEST non-csv rows are the first-hop/e2e-residue class, EXCLUDED from 145 |
| 2 — arm 4 + measurement + verdict + TODOS | Done: arm 4 GREEN (200 + UUID `824b0fe8…`, `csv_finalize_ok` in the Python layer, zero 42501); Step B 5000-row delta ≤ noise; verdict line written; TODOS bullet closed with the D-03 citation |
| 3 — founder checkpoint | Done: **(i-b)** selected via AskUserQuestion; 145-DECISION.md committed — Plans 03-06 read it as the branch key |

## The two claim-falsifications this plan surfaced (measured, not argued)

1. **"TEST Railway URL" does not exist** — the Railway workspace has one project, one
   `production` environment. Step A was re-scoped to a zero-DB local harness on the REAL
   `_ProcessKeyBody` model; the cross-provider network leg is recorded UNMEASURED. The only
   option that needed that number to be small — (i-a) — was not chosen.
2. **The full local analytics app is not safe against TEST** — `main.py:271-273` starts
   `dispatch_loop` unconditionally. Arm 4 ran routers-only; recorded in the artifact as a
   topology deviation with its reasoning.

## Commit trail (worktree `feat/v1.19-phase-145`)

- `45880985` census (Task 1, earlier)
- measurement §0 (falsified precondition) — committed before any timing ran
- Step A numbers (zero-DB harness, raw lines + medians)
- `docs(145-02): SC#1 verdict (arm 4 GREEN + census) + (i-a)/(i-b) measurement + TODOS closure`
- `docs(145-02): founder caller decision — (i-b), route calls the fold directly`

## Verification hooks (from the plan)

- `grep -c "CANNOT REPRODUCE" 145-REPRODUCTION.md` ≥ 1 ✓ (verdict header + final block)
- `145-MEASUREMENT.md` exists with `time_total`/`median` lines ✓ (20 verbatim timing lines, two medians tables)
- 145-DECISION.md records option + table + rationale ✓
