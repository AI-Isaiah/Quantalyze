---
phase: 139-mt5golive-gateway-soak-flip
verified: 2026-07-24T02:40:00Z
status: human_needed
score: 4/4 buildable must-haves verified (3 LIVE go-live legs human_needed)
overrides_applied: 0
human_verification:
  - test: "Stand up the prod MT5 gateway (MT5GW-01) per docs/runbooks/mt5-go-live.md Steps 0-2"
    expected: "gmag11/metatrader5_vnc:2.3 running on a Railway dual-stack co-locate service (PRIMARY) or VPS+Tailscale fallback; :8001 reachable ONLY over the private network (gateway.railway.internal / tailnet); one-time VNC :3000 install done then torn down; investor login saved to /config and survives restart; image sha256 digest recorded in the runbook provenance line; A2 dual-stack env confirmed."
    why_human: "Live infra stand-up + hosting decision + one-time interactive VNC install + investor login — no autonomous coding can execute a LIVE deploy or type into a VNC session."
  - test: "Onboard a real broker investor account + credential isolation + broker allowlisting (MT5GOLIVE-01), runbook Step 3"
    expected: "Gateway holds ONLY the one investor login; broker IP-allowlisting (if required) keys off the GATEWAY egress IP (whole Railway rotating set), NOT the worker egress; server-time offset recorded to feed MT5_SOAK_SERVER_OFFSET_MIN."
    why_human: "Requires a real broker investor account (login + investor password + exact server string) and live broker-side allowlisting — resources only the founder holds."
  - test: "Run the soak to parity + GATE-CHECK + flag flip + prod verify (MT5GOLIVE-02), runbook Steps 4-7"
    expected: "python -m scripts.mt5_soak run daily over a 5-10 business-day window, EVERY run within tolerance (parity_ok=true, exit 0, no INCONCLUSIVE/error) logged to analytics-service/docs/mt5-spike-gonogo.md; the explicit GATE-CHECK (134-138 + SOAK + CI + NET + DEPLOY) all green; then Railway MT5_ENABLED+MT5_GATEWAY_HOST/PORT and Vercel MT5_ENABLED+NEXT_PUBLIC_MT5_ENABLED flipped LIVE with redeploys at SUCCESS; api_verified MT5 strategy renders across factsheet/discovery/edit for owner/allocator/admin/anon on prod."
    why_human: "Requires REAL prod data over a multi-day soak window, a LIVE env-var flip on Railway + Vercel, and a prod end-to-end verification across roles — a founder LIVE op; a skipped go-live gate is never claimed passed."
---

# Phase 139: MT5GOLIVE (Gateway + Soak + Flip) Verification Report

**Phase Goal:** MT5 is USABLE LIVE at milestone close — the prod gateway runs isolated and reachable, a real broker investor account is onboarded and soaked to parity, and the flags flip only after every gate is green.
**Verified:** 2026-07-24T02:40:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

The phase goal ("USABLE LIVE at milestone close") is a **founder LIVE operation** that cannot be autonomously completed: standing up the prod gateway, onboarding a real broker account, running the multi-day soak on prod data, and flipping the flags LIVE all require the founder and live resources. 139-03-SUMMARY correctly records these three legs as `human_needed` (parked with the runbook), NOT done.

The **buildable half** — the soak/parity runner, the go-live runbook, and the gateway deploy templates — is fully delivered, in-repo, and green. This is what a verifier CAN confirm, and it all passes.

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Soak runner composes 134 `run_spike` + 136 `combine_mt5_deal_ledger` + reconciliation at max($1, 1e-6·\|equity\|); offline test green with $2-drift negative control, INCONCLUSIVE-on-empty, fail-loud, secret sanitize | ✓ VERIFIED | `pytest tests/test_mt5_soak.py` → **13 passed**. Imports at mt5_soak.py:94 (`from scripts.mt5_spike import _default_client_factory, run_spike`), :105 (`from services.broker_dailies import combine_mt5_deal_ledger`), :97-102 (sanitize primitives). `_parity_tolerance` = `max(1.0, 1e-6*abs(equity))` (:126-128) — exact 136-03 gate. `test_two_dollar_drift_reddens_parity` + `test_two_dollar_drift_exits_nonzero` (teeth), `test_empty_ledger_is_inconclusive` (parity_ok None), `test_read_error_records_code_never_empty` (None≠()), `test_written_record_is_sanitized`, `test_source_composes_not_reimplements` (asserts imports present + `order_send(` absent). BALANCE-anchored initial avoids self-referential oracle. |
| 2 | Runbook has PRIVATE NETWORK ONLY (literal), explicit GATE-CHECK (134-138 + soak), exact Railway+Vercel flip commands, trivial rollback, Railway-co-locate-PRIMARY (dual-stack, NOT Fly), and NO "disable auto-update" instruction (tag+digest pin only) | ✓ VERIFIED | `docs/runbooks/mt5-go-live.md`: "PRIVATE NETWORK ONLY" literal 2× (Step 1 HARD CONSTRAINT + header) plus many private-net mentions. GATE-CHECK checklist Step 5 covers 134/135/136/137/138 + SOAK + CI + NET + DEPLOY. Step 6 has exact `railway variables --set MT5_ENABLED=true...` + `vercel env add MT5_ENABLED/NEXT_PUBLIC_MT5_ENABLED` + redeploy. Step 8 rollback = both flags empty + redeploy (env-only, no migration). Step 0 matrix marks Railway co-locate dual-stack **PRIMARY**, Fly **secondary**, and explicitly says "Do NOT regress to the superseded 'Fly reuse-ops vs Railway co-locate' framing." Auto-update: states it **cannot be disabled** ("NO auto-update switch to disable"), tag+digest pin only — the research correction, NOT a disable instruction. |
| 3 | deploy/mt5-gateway/ templates grounded in verified facts (gmag11/metatrader5_vnc:2.3, :8001, :3000, /config), private-only binding (docker-compose 127.0.0.1; fly.toml no [[services.ports]]) | ✓ VERIFIED | `docker-compose.yml`: image `gmag11/metatrader5_vnc:2.3`, `mt5server_port: 8001`, ports `127.0.0.1:3000` + `127.0.0.1:8001` (3 loopback bindings), volume `/config`. `fly.toml`: image :2.3, "NO public port handlers and NO [http_service] section AT ALL" (grep confirms no `[[services.ports]]`/`[http_service]` handler). `railway-gateway.md`: PRIMARY, image :2.3, `:8001` internal-only, dual-stack A2 requirement, `/config` volume. All 3 carry the terminal-self-update-cannot-be-frozen note (research-grounded). |
| 4 | All artifacts committed in-repo (docs/runbooks, deploy/, analytics-service/scripts), NOT in gitignored .planning | ✓ VERIFIED | `git ls-files` tracks all 6: `analytics-service/scripts/mt5_soak.py`, `analytics-service/tests/test_mt5_soak.py`, `docs/runbooks/mt5-go-live.md`, `deploy/mt5-gateway/{docker-compose.yml,fly.toml,railway-gateway.md}`. `git status --porcelain` clean (committed, not untracked). Soak-log section present at `analytics-service/docs/mt5-spike-gonogo.md:189` (`## Soak log (MT5GOLIVE-02)`). |

**Buildable score:** 4/4 truths verified

### Live Go-Live Legs (human_needed — NOT gaps)

| Requirement | Leg | Why not autonomous |
|-------------|-----|--------------------|
| MT5GW-01 | Gateway stand-up + VNC install + investor login | LIVE infra deploy + interactive VNC session |
| MT5GOLIVE-01 | Prod hosting + credential isolation + broker allowlisting | Hosting decision + real broker account + broker-side allowlisting |
| MT5GOLIVE-02 | Real-broker soak to parity + GATE-CHECK + LIVE flag flip + prod verify | Multi-day prod-data soak + LIVE Railway/Vercel env flip + cross-role prod verify |

These are NOT gaps: no autonomous coding can close them. They are surfaced in the `human_verification` frontmatter above and fully driven by the committed runbook.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Soak offline suite green | `.venv/bin/python -m pytest tests/test_mt5_soak.py -x -q` | 13 passed in 1.43s | ✓ PASS |
| Runner composes (not reimplements) | `test_source_composes_not_reimplements` | asserts `from scripts.mt5_spike import`, `combine_mt5_deal_ledger`, `sanitize_evidence` present; `order_send(` absent | ✓ PASS |
| $2-drift negative control has teeth | `test_two_dollar_drift_reddens_parity` + `_exits_nonzero` | parity_ok False + main exits nonzero | ✓ PASS |
| Empty ledger INCONCLUSIVE (never green) | `test_empty_ledger_is_inconclusive` + `_exits_nonzero` | parity_ok None + exit nonzero | ✓ PASS |
| Secret hygiene on written log | `test_written_record_is_sanitized` | investor pw + server absent from written JSON; assert_sanitized passes | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| MT5GW-01 | 139-03 | Self-hosted MT5 gateway stood up, private-net reachable | ? NEEDS HUMAN | Buildable configs/runbook ready; LIVE stand-up is founder op |
| MT5GOLIVE-01 | 139-03 | Prod gateway + credential isolation + broker allowlisting | ? NEEDS HUMAN | Runbook Step 3 + railway-gateway.md ready; LIVE onboard is founder op |
| MT5GOLIVE-02 | 139-01/03 | Real-broker soak to parity + LIVE flag flip + prod verify | ? NEEDS HUMAN | Buildable half (soak runner + tests + go/no-go log section) DONE; LIVE soak RUN + flip human_needed |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | No debt markers (TBD/FIXME/XXX) in modified files; "disable auto-update" appears ONLY as the research correction ("cannot be disabled"), not an instruction | ℹ️ Info | None |

**Info note (not a gap):** `REQUIREMENTS.md:41` (MT5GOLIVE-01) still carries the superseded "hosting decided: Fly reuse-ops vs Railway co-locate" prose. The deliverable (runbook Step 0 + railway-gateway.md) correctly applies the 2026-07-24 research correction (Railway co-locate PRIMARY, dual-stack) and explicitly warns against regressing to that framing. This is stale requirement-text, not a deliverable regression — worth a one-line REQUIREMENTS.md tidy at flip, does not affect goal achievement.

### Gaps Summary

No gaps in the buildable half. The soak runner (13/13 offline tests green, composed not reimplemented, teeth-bearing negative control, fail-loud, sanitized), the go-live runbook (all required gates: PRIVATE NETWORK ONLY, explicit GATE-CHECK, exact flip commands, trivial rollback, Railway-PRIMARY dual-stack, correct auto-update framing), and the three deploy templates (private-only bindings, grounded facts) are complete and committed in-repo.

The phase goal ("USABLE LIVE") is not yet met because the three LIVE go-live legs (MT5GW-01, MT5GOLIVE-01, MT5GOLIVE-02) are genuinely `human_needed` — founder LIVE operations that no autonomous run can execute. Status is `human_needed`, not `gaps_found` (buildable half is complete) and not `passed` (the live goal is unmet). The runbook drives the founder session end-to-end.

---

_Verified: 2026-07-24T02:40:00Z_
_Verifier: Claude (gsd-verifier)_
