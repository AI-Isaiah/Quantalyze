# Phase 130: GOLIVE — Railway static-egress whitelist + sFOX flag flip + live proof - Context

**Gathered:** 2026-07-19
**Status:** Ready (milestone culmination — buildable = the go-live runbook; the ops themselves are founder LIVE ops)
**Mode:** Auto-generated (autonomous; the 5 EGRESS/GOLIVE reqs are all ⚠️ founder-gated live ops)

<domain>
## Phase Boundary

sFOX becomes offerable and LIVE on native Railway static egress — the full 3-IP
static-outbound set (Amsterdam/NL) is whitelisted at sFOX (NO Fly, NO proxy),
the `SFOX_ENABLED` + `NEXT_PUBLIC_SFOX_ENABLED` flags flip ONLY once every gate
is green, and a real user connects a live IP-whitelisted key that renders
`api_verified` across every surface (factsheet + discovery + edit), E2E across
roles. Absorbs EGRESS (founder 2026-07-19: Railway Pro static outbound, ZERO
build work — `WORKER_EGRESS_PROXY_URL` stays UNSET; native static egress covers
BOTH sFOX AND ccxt).

**Depends on:** Phase 126 (factsheet e2e green in the blocking gate) + Phase 127
(E2 ground-truth green — E2GT-01 live run still human_needed) + the sFOX IP-bind
whitelist (⚠️ external founder long-pole, started day 1 in parallel). The
milestone culmination — LAST. The milestone ships FLAG-OFF (as v1.12 did); this
phase DELIVERS the go-live execution path and the explicit gate, not the flip.
</domain>

<decisions>
## Implementation Decisions

### ⭐This phase has ZERO code/build work (founder 2026-07-19)
Railway Pro static outbound = the egress solution (NOT Fly, NOT a proxy). The
real Fly-egress path (~$6–7.60/mo, `fly-egress-proxy/`) is UNUSED; Vercel
static-IP is moot (the sFOX/ccxt calls run in the Railway worker, not Vercel).
`WORKER_EGRESS_PROXY_URL` stays UNSET. Nothing to install, wire, or migrate.

### The ONE buildable deliverable = the sFOX go-live runbook (GOLIVE-RB)
No `docs/runbooks/sfox-go-live.md` exists yet — the existing
`flipretry-derived-equity-go-live.md` covers only the derived-curve FLIP, NOT
egress or the sFOX flag flip. Write a NEW runbook that is the founder's
step-by-step execution path for all 5 ops, in order, with the explicit gate
checklist and a trivial rollback. This is buildable, verifiable (grep gates on
the required sections/commands), and does NOT touch prod. Structure:
- **Step 0 — EGRESS-01:** confirm Railway `quantalyze-analytics` is on Pro with
  static outbound ACTIVE; read the FULL 3-IP set from service → Settings →
  Networking (redeploy the worker if the dashboard says static outbound
  activates on next deploy). ⭐Whitelist the WHOLE dashboard set, never one
  observed IP.
- **Step 1 — EGRESS-02:** VERIFY realized egress with REPEATED
  `railway ssh … curl -s ipinfo.io` probes (assert country NL, collect the
  distinct IPs) — a single probe misses load-balanced sibling IPs. Cross-check
  the observed set ⊆ the dashboard set.
- **Step 2 — EGRESS-03:** whitelist all 3 static IPs at sFOX
  (security@quantalyze.com / sFOX dashboard) and prove an IP-whitelisted sFOX
  key authenticates end-to-end from the worker's NATIVE egress — no proxy
  (`WORKER_EGRESS_PROXY_URL` UNSET). This gates the flag flip.
- **Step 3 — GOLIVE-01 GATE (explicit, never assumed):** a checklist that ALL
  are green before the flip — EGRESS (1–3) + FACTSHEET (Phase 126 blocking e2e
  green, verified via `gh pr checks` on the milestone PR) + E2GT
  (Phase 127 E2GT-01 exit 0 AND within_same_day_tolerance===true). Only then
  flip `SFOX_ENABLED` + `NEXT_PUBLIC_SFOX_ENABLED` on (LIVE env ops: Railway
  worker + Vercel prod — NOT migrations). Redeploy so the env takes.
- **Step 4 — GOLIVE-02 live proof:** a user connects a live IP-whitelisted sFOX
  key through the wizard; its `api_verified` strategy renders LIVE across
  factsheet + discovery + edit, proven E2E across owner / allocator / admin —
  the full flow, not one surface.
- **Step 5 — ROLLBACK (trivial):** both flags back to empty restores the
  proven-safe DORMANT v1.12 state, zero user impact.

### EGRESS-01/02/03 + GOLIVE-01/02 = FOUNDER `human_needed` live ops
Every requirement here needs founder-provisioned LIVE access the autonomous run
does not hold: the Railway Pro dashboard (read the static IP set), `railway ssh`
into the running prod worker (egress probes), the sFOX dashboard / security@
handoff (whitelist), the Railway + Vercel prod env toggles (the flip), and a
real IP-whitelisted sFOX key + multi-role session (the live proof). They are
also gated on the EXTERNAL sFOX IP-bind turnaround (outside our control).
Model them as `autonomous: false` — the runbook IS the delivered execution
path. NEVER claim any leg done without the live evidence (observed NL IP set /
authenticating key / healthz / api_verified render). No simulation, no
CI-derived claim, no partial credit.

### Claude's Discretion
Runbook wording, section order, and the exact probe/gate commands, guided by the
existing `flipretry-derived-equity-go-live.md` conventions (Step-N structure,
abort paths, explicit gate assertions) and the Railway ops memory
(`railway ssh "cd /app && …"`, env key `SUPABASE_SERVICE_KEY` not `_ROLE_KEY`).
</decisions>

<code_context>
## Existing Code Insights
- `docs/runbooks/flipretry-derived-equity-go-live.md` — the FLIP runbook; mirror
  its Step-N + explicit-gate + Step-8-rollback structure. GOLIVE-RB is a sibling.
- `docs/runbooks/railway-worker.md` — Railway worker ops reference.
- The sFOX flags: `SFOX_ENABLED` (worker/server) + `NEXT_PUBLIC_SFOX_ENABLED`
  (Vercel client) — both empty today (dormant, shipped v1.12 flag-off).
- `WORKER_EGRESS_PROXY_URL` — stays UNSET (native static egress, no proxy).
- sFOX is NOT in ccxt → custom adapter (founder). Live API read = ground truth.

### Conventions
- Fail-loud + explicit gate. Whitelist the WHOLE dashboard set, never one probe
  IP. Rollback = both flags→empty (trivial, proven v1.12 dormant state).
</code_context>

<specifics>
## Specific Ideas
Deliver `docs/runbooks/sfox-go-live.md` (Steps 0–5 above, explicit GOLIVE-01
gate checklist, trivial rollback). Record all 5 EGRESS/GOLIVE reqs
human_needed-OPEN with the runbook as the execution path; the milestone ships
FLAG-OFF. This is the honest culmination — the go-live path is fully documented
and gated, the flip awaits the external sFOX whitelist + the founder's live run.
</specifics>

<deferred>
## Deferred Ideas
- `allocator_equity_snapshots` legacy-store retirement (STITCH-02/BACKBONE-03) —
  unblocked only AFTER the FLIP (Phase 129) is live + the derived surface proven;
  explicitly out of scope for v1.13.
- Fly-egress-proxy path — UNUSED (Railway Pro static outbound chosen); keep the
  `fly-egress-proxy/` dir dormant, do not wire it.
</deferred>
