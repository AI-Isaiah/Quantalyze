---
phase: 121
slug: sfox-static-ip-egress
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-19
---

# Phase 121 — Validation Strategy

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest (analytics-service) |
| **Quick run** | `cd analytics-service && .venv/bin/python -m pytest tests/test_egress_proxy_wiring.py -q` |
| **Full suite** | `cd analytics-service && .venv/bin/python -m pytest -q` |

## Per-Task Verification Map

| Task | Requirement | Correct Behavior | Test | Status |
|------|-------------|------------------|------|--------|
| sfox proxy factory | SFOX-07 | env SET → SfoxClient(proxy=url) at all 4 sites; UNSET → proxy=None (byte-identical) | unit | ⬜ |
| ccxt aiohttp_proxy | SFOX-07 | env SET → create_exchange sets exchange.aiohttp_proxy; UNSET → unchanged | unit | ⬜ |
| fly proxy config | SFOX-07 | Dockerfile+fly.toml(region ams)+tinyproxy.conf (BasicAuth, no Via/forwarded leak, deny-default) exist + are internally consistent | file-assert | ⬜ |
| egress-verify gate | SFOX-07 | probe prints egress IP + fails loud if != expected dedicated egress ip | unit(mockable) | ⬜ (live founder) |

## Wave 0

- [ ] `analytics-service/tests/test_egress_proxy_wiring.py` — env-set threads proxy into ccxt + SfoxClient; env-unset byte-identical

## Manual-Only (founder ops)

| Behavior | Why Manual | Instructions |
|----------|------------|--------------|
| `fly deploy` + `fly ips allocate-v4` (inbound) + `fly ips allocate-egress` (static, ~$3.60/mo) | flyctl not local | Founder runs the runbook in fly-egress-proxy/README |
| Verify egress == static egress IP, THEN whitelist at sFOX | live infra | `railway ssh "... probe_exchange_egress --expect <egress-ip>"` must pass before whitelisting |

## Validation Sign-Off

- [ ] env UNSET = byte-identical direct egress (safe pre-deploy merge) — proven by test
- [ ] proxy auth via BasicAuth-in-URL; no open relay
- [ ] credential safety: HTTPS CONNECT (token never seen by tinyproxy)
- [ ] `nyquist_compliant: true`

**Approval:** pending
