# Plan 139-03 — SUMMARY

**Status:** human_needed (NOT executed — 3 blocking founder LIVE-ops checkpoints; parked with the runbook)
**Date:** 2026-07-24
**Autonomous:** false

## Outcome

Plan 139-03 is the milestone's founder LIVE-ops culmination — three
`checkpoint:human-verify gate="blocking-human"` legs. It was **not executed** in the autonomous
run because each requires resources/decisions only the founder can provide. Recorded as
`human_needed`, **not** done — a skipped go-live gate is never claimed passed.

| Checkpoint | Requirement | Why deferred | Founder action (from the runbook) |
|-----------|-------------|--------------|-----------------------------------|
| 139-03/T1 — gateway stand-up | MT5GW-01, MT5GOLIVE-01 | Hosting decision (Railway co-locate PRIMARY vs VPS+Tailscale vs Fly) + the A2 "is the worker Railway env dual-stack (post-2025-10-16)?" check + one-time VNC install + investor login + private-network binding — all LIVE infra | `docs/runbooks/mt5-go-live.md` Steps 0–3 + `deploy/mt5-gateway/` templates |
| 139-03/T2 — broker onboard + soak | MT5GOLIVE-02 | Needs a REAL broker investor account (login + investor password + exact server) + an N-day soak (5–10 business days) proving reconstructed-equity-vs-`account_info().equity` parity on prod data. Folds in the 136-05 DEAL_TYPE-middle + WR-03 master-rejection-retcode live confirmations. | Runbook Step 4 + `python -m scripts.mt5_soak` (139-01) logging into `mt5-spike-gonogo.md` |
| 139-03/T3 — gate-check + flag flip | MT5GOLIVE-02 | Explicit GATE-CHECK (134–138 CI gates + soak parity + CI/net/deploy green) then Railway `MT5_ENABLED`+`MT5_GATEWAY_HOST/PORT` + Vercel `MT5_ENABLED`+`NEXT_PUBLIC_MT5_ENABLED` LIVE env flip + redeploy + prod verify across roles | Runbook Steps 5–8 (flip commands + rollback) |

## What is ready for the founder (buildable half — DONE)

- **Soak runner:** `analytics-service/scripts/mt5_soak.py` (+ 13 offline tests) — composes the 134
  spike + 136 reconciliation; INCONCLUSIVE-on-empty; $2-drift negative control; fail-loud; sanitized.
- **Go-live runbook:** `docs/runbooks/mt5-go-live.md` — Steps 0–8 with the explicit GATE-CHECK,
  exact Railway/Vercel flip commands, the "Wait for CI" SKIP gotcha, and trivial rollback.
- **Gateway configs:** `deploy/mt5-gateway/` — Railway (primary, dual-stack, private), docker-compose
  (VPS+Tailscale, 127.0.0.1-bound), fly.toml (secondary, no public ports). Image
  `gmag11/metatrader5_vnc:2.3` pinned by tag+digest (auto-update NOT disableable → soak detects drift).
- **Flag mechanics** (138): `NEXT_PUBLIC_MT5_ENABLED` (client) + `MT5_ENABLED` (server) both dark;
  138 flag-OFF byte-identity makes rollback safe.

## Milestone-close honesty

MT5 is **code-complete and gated dark**. It is NOT "usable live" yet — the go-live requirements
(MT5GW-01, MT5GOLIVE-01, MT5GOLIVE-02) remain ⚠️ `human_needed` pending the founder LIVE ops above.
The milestone's engineering scope (134–138 + the 139 buildable half) is DONE and green; the LIVE
finish line is a founder session driven entirely by the committed runbook.

## Resume

`/gsd:execute-phase 139 --wave 3` when the founder is ready, or follow `docs/runbooks/mt5-go-live.md`
directly. Rollback at any point: both flags to empty + redeploy.
