# Phase 139: MT5GOLIVE — Prod gateway stand-up + real-broker soak + flag flip LIVE - Context

**Gathered:** 2026-07-24
**Status:** Ready for planning
**Mode:** Autonomous smart-discuss (founder LIVE-ops phase — runbooks/configs/scripts land buildable; the live execution legs are `human_needed`)

<domain>
## Phase Boundary

The milestone culmination: MT5 is USABLE LIVE at close. All THREE requirements (MT5GW-01,
MT5GOLIVE-01, MT5GOLIVE-02) are ⚠️ FOUNDER LIVE OPS — they require a hosting decision, a running
gmag11 gateway, a real broker investor account, a soak window, and LIVE env-flag flips that an
autonomous agent CANNOT perform. Per the milestone design (and the standing pattern from 134's
live spike + 136-05): **the code/runbook/config/scripts LAND now; the live execution legs are
`human_needed` checkpoints — a skipped gate is NEVER claimed done.**

**Buildable now (autonomous):**
- The prod gateway DEPLOYMENT CONFIG (gmag11 v2.3 image; docker-compose + Fly and Railway config
  templates; persistent `/config` volume; PRIVATE-network binding; terminal auto-update pinned).
- The GO-LIVE RUNBOOK: hosting decision matrix (Fly reuse-ops vs Railway co-locate vs cheap VPS —
  amd64-only ~4GB image, AVOID ARM), one-time VNC install + investor login steps, credential
  isolation, broker IP-allowlisting off the GATEWAY/VPS IP (NOT worker egress), the soak
  procedure, the explicit 135–138 + soak GATE-CHECK, the flag-flip sequence, trivial rollback.
- The SOAK / parity verification SCRIPT (reuse the Phase-134 `mt5_spike.py` harness + the Phase-136
  reconstructed-equity-vs-`account_info().equity` parity gate) the founder runs against the real
  account over the soak window.
- The flag-flip CHECKLIST (Railway `MT5_ENABLED` + Vercel `NEXT_PUBLIC_MT5_ENABLED`, LIVE env ops
  NOT migrations; both-to-empty rollback).

**`human_needed` (founder LIVE ops — land as checkpoints, execution deferred):**
- Standing up the prod gateway (hosting decision + VNC install + investor login + private network).
- Onboarding a real broker investor account + running the soak to parity.
- Flipping the flags LIVE after every gate is green + verifying end-to-end across roles in prod.
</domain>

<decisions>
## Implementation Decisions

### Gateway deployment config + runbook (MT5GW-01 / MT5GOLIVE-01)
- gmag11 `MetaTrader5-Docker` v2.3 (Wine + Windows-Python + MT5 terminal + RPyC bridge, Linux
  container). Deployment config templates for BOTH candidate hosts (Fly `fly.toml` + Railway
  config) + a docker-compose for a cheap-VPS fallback — the founder picks. Persistent `/config`
  volume; the RPyC/HTTP bridge bound to a PRIVATE network only (NEVER publicly open — the RPyC
  RCE finding from Phase 134); terminal auto-update disabled/pinned.
- **Credential isolation:** the gateway sees ONLY the secret it is syncing; broker IP-allowlisting
  (if the broker requires it) keys off the GATEWAY/VPS IP, NOT the worker egress IPs
  ([[project_v1_13_infra_milestone]] — worker egress is Railway static; the gateway IP is separate).
- The Windows dependency stays OUT of the Linux worker process (the worker is a pure `mt5linux`
  network client — Phase 134 contract).

### Soak / parity verification (MT5GOLIVE-02)
- A soak verification procedure + script: reconstructed equity vs live `account_info().equity`
  parity (the Phase-136 gate) holds over the soak window on REAL prod data. Reuse `mt5_spike.py`
  (134) for the connectivity/go-no-go legs + the 136 reconciliation for parity. The founder runs
  it against the real investor account; results recorded in the go/no-go doc + a soak log.

### Flag flip (MT5GOLIVE-02)
- **Explicit GATE-CHECK, never assumed:** the runbook enumerates the 135–138 CI gates + the soak
  parity as a checklist that MUST be green BEFORE the flip. Flip = set `MT5_ENABLED` (Railway) +
  `NEXT_PUBLIC_MT5_ENABLED` (Vercel) to `"true"` + REDEPLOY (LIVE env ops, NOT migrations —
  mirror the sFOX enable mechanics [[project_v1_13_founder_flags_and_sfox_enable_mechanics]]).
- **Trivial rollback:** both flags back to empty + redeploy → byte-identical dark state (the
  138 flag-OFF byte-identity guarantee makes rollback safe).
- Post-flip: a user connects an MT5 key end-to-end and its `api_verified` strategy renders live
  across factsheet/discovery/edit, proven across roles (the 138 all-roles e2e is the automated
  proxy; the live prod verification is the founder's post-flip check).

### Claude's Discretion
The exact runbook structure, which host template is primary vs fallback, and the soak-window
length recommendation are engineering-discretion, grounded in the STATE blocker (amd64/4GB/volume)
+ the sFOX/Railway infra precedents.
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets / Analogs
- `analytics-service/scripts/mt5_spike.py` (134) — the connectivity/go-no-go harness the soak reuses.
- `analytics-service/docs/mt5-spike-gonogo.md` (134) — the founder-fillable go/no-go doc the soak
  extends.
- The Phase-136 reconciliation gate (reconstructed equity vs `account_info().equity`) — the parity
  the soak proves on real data.
- The 138 flag mechanics (`MT5_UI_ENABLED`/`isMt5EnabledServer`) + the sFOX enable precedent
  ([[project_v1_13_founder_flags_and_sfox_enable_mechanics]], [[project_sfox_verified_integration_milestone]]).
- Railway/Fly infra precedents ([[project_railway_analytics_deploy_wait_for_ci]],
  [[project_v1_13_infra_milestone]]) — worker egress is Railway static; the gateway IP is separate.

### Established Patterns
- Founder LIVE ops as `human_needed` checkpoints (134 live spike, 136-05); runbooks/configs land,
  execution deferred; a skipped gate is never claimed done.

### Integration Points
- The gateway host (Fly/Railway/VPS); Railway `MT5_ENABLED` + Vercel `NEXT_PUBLIC_MT5_ENABLED`
  LIVE env; the worker `mt5linux` client (points at the gateway host:port over private network).
</code_context>

<specifics>
## Specific Ideas
- Gateway image is amd64-only, ~4GB, needs a persistent volume — AVOID ARM instances (STATE blocker).
- The RPyC bridge is an unauthenticated RCE channel (134 finding) — PRIVATE network binding is a
  HARD constraint, non-negotiable in the runbook.
- Broker IP-allowlisting (if required) is off the GATEWAY IP, not worker egress — a common
  misconfiguration to call out.
</specifics>

<deferred>
## Deferred Ideas
- The ACTUAL live execution (gateway stand-up, broker onboarding, soak run, flag flip) —
  `human_needed`, founder-gated. Runbook + config + script land now.
- Portable-mode terminal pool / multi-broker sharding (Future Requirements — v1 is one serial
  terminal).
- The DEAL_TYPE ambiguous-middle (136-05) + master-rejection retcode (WR-03) live confirmations —
  fold into the same founder soak session (the live spike reveals both).
</deferred>
