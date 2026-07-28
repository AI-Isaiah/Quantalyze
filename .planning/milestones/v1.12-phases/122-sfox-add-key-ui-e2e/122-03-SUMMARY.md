---
phase: 122-sfox-add-key-ui-e2e
plan: 03
subsystem: ui
tags: [sfox, onboarding-copy, security-page, frontend]

# Dependency graph
requires:
  - phase: 122
    plan: 02
    provides: "ConnectKeyStep derives the setup-guide href /security#${exchange}-readonly — this plan supplies the sfox target"
  - phase: 121
    provides: "Fly.io static egress proxy — the IP the founder whitelists (provisioned in 121-03; never hardcoded in copy)"
provides:
  - "/security#sfox-readonly SubAnchor — F3-honest sFOX setup guide (mint a READ-ONLY single API token; no per-key scope endpoint so scope is unverifiable server-side; whitelist the static egress IP via the security@ contact, no hardcoded IP)"
  - "Live deep-link target for ConnectKeyStep's derived /security#sfox-readonly setup-guide href"
affects: [122-04, sfox-add-key-e2e]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-exchange SubAnchor block inside the readonly-key Section — verbatim reuse of the deribit precedent markup (id + ordered 3-step list, DM Sans body voice)"
    - "F3 honesty: state the limit with the reason attached (DESIGN.md Voice) — 'sFOX does not expose a per-key scope endpoint, so we cannot probe scope'; never a false verified-scope claim"
    - "No-hardcoded-IP disclosure: the security@quantalyze.com contact channel gates the egress-IP set (mirrors the #egress-ips precedent), so IP rotation never stales the copy"

key-files:
  created: []
  modified:
    - "src/app/(marketing)/security/page.tsx — added the sfox-readonly SubAnchor after the deribit block; three F3-honest steps (mint read-only single token / no-scope-endpoint limit / whitelist static egress IP via security@ contact)"
    - "src/app/(marketing)/security/page.test.tsx — 5 render tests: anchor exists + titled sFOX + nested in readonly-key; read-only single-token instruction; the F3 no-scope-endpoint + no-order/withdraw limit; egress-IP whitelist via the security@ mailto with a no-literal-IP guard; negative — no false verified-scope claim leaks into the block"

decisions:
  - "Setup guide shipped as a /security page section (deribit precedent) over wizard-inline — ConnectKeyStep already derives the /security#sfox-readonly href with zero edits, and the founder needs this runbook for their own pre-flag key-mint + IP-whitelist ops. Content-only, ships UNCONDITIONALLY (a doc section is not an offer; the offer stays flag-gated in 122-02)."
  - "F3 wording basis (LOCKED from 122-CONTEXT): the adapter uses the token read-only with no order/withdraw path, AND sFOX exposes no per-key scope endpoint — so the honest claim is 'mint a READ-ONLY token; we cannot probe scope', never 'we verified read-only scope'. Confirmed against the code: sFOX auth is a single Bearer token (exchange.py:52, ApiKeyForm isSfox token-only)."
  - "No hardcoded egress IP — the copy points to security@quantalyze.com for the current IP, mirroring the existing #egress-ips section, so the founder's 121-03 static-egress provisioning and any rotation never stale the page."

# Metrics
metrics:
  duration: ~10m
  completed: 2026-07-19
  tasks: 1
  files: 2
---

# Phase 122 Plan 03: sFOX read-only setup guide (/security#sfox-readonly) Summary

Added the `/security#sfox-readonly` SubAnchor mirroring the `#deribit-readonly` precedent: mint a READ-ONLY single sFOX API token, the F3-honest scope limit (sFOX exposes no per-key scope endpoint so scope is unverifiable server-side; the adapter has no order/withdraw path), and whitelist the static egress IP via the `security@quantalyze.com` contact — with no hardcoded IP. This is the live deep-link target for ConnectKeyStep's derived `/security#sfox-readonly` href (plan 122-02).

## What shipped

- A `SubAnchor id="sfox-readonly" title="sFOX"` block inside the existing `readonly-key` Section, immediately after the deribit block, reusing the precedent markup verbatim (DM Sans body, ordered 3-step list).
- Three steps: (1) generate a single read-only API token in the sFOX dashboard (no separate secret); (2) the F3 honest limit stated with its reason — no per-key scope endpoint, so scope cannot be probed server-side; the adapter has no order/withdraw path, but the read-only guarantee starts with the token you mint; (3) whitelist the static egress IP by emailing `security@quantalyze.com` for the current IP, then paste the token into the wizard.
- 5 render tests pinning the anchor, the honest copy, the no-hardcoded-IP contact step (with a literal-IPv4/IPv6 guard), and the absence of any false verified-scope claim.

## Verification

- `npx vitest run "src/app/(marketing)/security/page.test.tsx" --no-file-parallelism` — 16 passed (5 new + 11 existing byte-identical).
- `npx tsc --noEmit` — clean (exit 0).
- `npm run lint` — 0 errors (1 pre-existing warning in `EquityChart.tsx`, unrelated / out of scope).
- Anchor/link contract: `ConnectKeyStep.tsx:335` derives `href={`/security#${exchange}-readonly`}` → `/security#sfox-readonly`, which now resolves to `page.tsx:487 id="sfox-readonly"`. The 122-02 test (`ConnectKeyStep.test.tsx:296`) pins that href; this plan supplies the target.

## Full-story verification (F3 honesty + no-IP)

- Story: an onboarding user (or the founder pre-flag) opens the wizard sFOX card → clicks "sFOX setup guide →" → lands on `/security#sfox-readonly` → reads how to mint a read-only token and whitelist the egress IP.
- Honest scope claim: the block says "sFOX does not expose a per-key scope endpoint, so we cannot probe or confirm the token's scope server-side" and "our adapter uses the token read-only — there is no order or withdraw path in our sFOX integration". It makes NO "verified read-only scope" claim (negative test T-122-08 green). This matches the code: sFOX auth is a single Bearer token, no scope endpoint (`analytics-service/routers/exchange.py:52`).
- No hardcoded IP: the copy names no IP address; disclosure is gated by `mailto:security@quantalyze.com` (negative literal-IP test T-122-09 green), so the founder's 121-03 static egress and any rotation never stale the page.

## Deviations from Plan

None — plan executed as written. No refactor step was needed (the block mirrors the precedent verbatim). No Rule 1-4 deviations triggered.

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: `src/app/(marketing)/security/page.tsx` (id="sfox-readonly" at line 487)
- FOUND: `src/app/(marketing)/security/page.test.tsx` (Phase 122 describe block)
- FOUND commit baf6e883 (test/RED)
- FOUND commit b36aed77 (feat/GREEN)

## TDD Gate Compliance

- RED: `baf6e883` test(122-03) — 5 sfox tests failing (block absent).
- GREEN: `b36aed77` feat(122-03) — 16/16 passing.
- REFACTOR: none required (verbatim precedent reuse).
