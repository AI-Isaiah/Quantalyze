---
phase: 118
slug: sfox-research-adapter-contract
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-18
---

# Phase 118 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest 7.x (analytics-service) |
| **Config file** | `analytics-service/pytest.ini` / `pyproject.toml` |
| **Quick run command** | `cd analytics-service && python -m pytest tests/test_sfox_client.py -q` |
| **Full suite command** | `cd analytics-service && python -m pytest -q` |
| **Estimated runtime** | ~2s (unit contract test); smoke test skipIf-gated |

---

## Sampling Rate

- **After every task commit:** Run the quick command
- **After every plan wave:** Run the full suite
- **Before `/gsd:verify-work`:** Full suite green (smoke test may be skipped absent sandbox key)
- **Max feedback latency:** ~5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 118-01-* | 01 | 1 | SFOX-01 | — | Read-only client; no order/withdraw methods exist | unit | `pytest tests/test_sfox_client.py -q` | ❌ W0 | ⬜ pending |
| 118-01-smoke | 01 | 1 | SFOX-01 (SC-3) | — | Auth succeeds + ≥1 read endpoint returns real payload vs `api.staging.sfox.com` | live-smoke | `pytest tests/test_sfox_client_live.py -q` (skipIf no `SFOX_SANDBOX_KEY`) | ❌ W0 | ⬜ pending (founder-gated) |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `analytics-service/tests/test_sfox_client.py` — contract/unit test for `SfoxClient` (auth header shape, endpoint URLs, read-only surface, pagination cursor handling) using mocked aiohttp responses
- [ ] `analytics-service/tests/test_sfox_client_live.py` — skipIf(`not SFOX_SANDBOX_KEY`) live smoke test (SC-3)

*pytest infrastructure already exists; no framework install needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live sandbox smoke GREEN | SFOX-01 (SC-3) | Requires founder-minted sFOX sandbox key (mint at `beta.sfox.com`; `SFOX_SANDBOX_KEY` env) — credential unavailable in CI/session | Set `SFOX_SANDBOX_KEY`, run `pytest tests/test_sfox_client_live.py -q`; expect auth 200 + non-error payload from `get_balances()` |

*The reconstruction-feasibility verdict (SC-1) and adapter contract (SC-2) are validated by RESEARCH.md evidence + the unit contract test; only SC-3's live green is founder-gated.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
