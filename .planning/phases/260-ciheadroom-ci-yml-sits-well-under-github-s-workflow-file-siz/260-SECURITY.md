---
phase: 260
slug: ciheadroom
status: secured
asvs_level: 1
block_on: high
threats_total: 9
threats_closed: 9
threats_open: 0
verified_at_sha: HEAD of gsd/phase-ciheadroom at audit time (base 176501797)
---

# Phase 260 CIHEADROOM - Security Verification

Verdict: SECURED. Every `mitigate` threat has its mitigation present in shipped code; both `accept` threats are logged below.

## Threat Verification

| Threat ID | Category | Severity | Disposition | Status | Evidence |
|-----------|----------|----------|-------------|--------|----------|
| T-260-01 | Denial of service | high | mitigate | CLOSED | `.github/workflows/workflow-size.yml`: triggers push main, pull_request main, workflow_dispatch; no `paths:`, no `if:`, no `continue-on-error:`. ci.yml is 406,613 bytes (ceiling 460,800, hard limit 512,000). `wiringFindings` in `src/__tests__/workflow-size-gate.test.ts` pins `ci-yml-runs-gate`, `paths-filter`, `trigger-missing`, `skippable`, `self-test-order` (27 tests pass). |
| T-260-02 | Tampering | high | mitigate | CLOSED | `scripts/check-workflow-size.mjs`: `judge` returns MEASURE_FAIL on empty set, `evaluate` on unreadable dir (both exit 1); `--self-test` 5 legs incl. 460,801 red and 460,800 green; workflow runs self-test step before scan (pinned by `self-test-order`). Self-test and default scan re-run: OK, 18 files, largest ci.yml 406,613. |
| T-260-03 | Tampering | high | mitigate | CLOSED | Independent re-check: parsed YAML of ci.yml at phase base 176501797 and at HEAD is deep-equal. All `+` lines in the ci.yml diff are `# Rationale: docs/ci-yml-notes.md#...` comments; no non-comment, non-blank line was removed. |
| T-260-04 | Information disclosure | medium | mitigate | CLOSED | `gitleaks dir docs/ci-yml-notes.md --config .gitleaks.toml`: no leaks found. No home-directory path or email matches in the doc. Only `/private/var` appears, as a generic macOS path in prose. Numeric strings found are public GitHub Actions run ids carried over from ci.yml, not account identifiers. |
| T-260-05 | Elevation of privilege | medium | mitigate | CLOSED | `workflow-size.yml`: single top-level `permissions: contents: read`; `actions/checkout` with `persist-credentials: false`; both actions pinned to 40-char SHAs identical to contracts.yml (checkout 3d3c42e5..., setup-node 949feb24...). `workflow-size.yml` added to the workflow list in `critical-regressions.test.ts`; the 6 workflow-size cases pass. No untrusted input in `run:` (both steps are fixed `node scripts/check-workflow-size.mjs` invocations). `github.head_ref` appears only in the `concurrency.group` expression, never in a shell. |
| T-260-06 | Repudiation | low | mitigate | CLOSED | `pointerFindings` (dangling, orphan, duplicate-anchor, no-pointers) in `workflow-size-gate.test.ts`, each with a firing test; real pair passes. |
| T-260-07 | Denial of service | low | accept | CLOSED (accepted) | Accepted risk, see log. |
| T-260-08 | Repudiation | high | mitigate | CLOSED | `git log 176501797..HEAD --format=%B` scanned for the five bracketed skip tokens and `skip-checks`: 0 hits. |
| T-260-SC | Tampering | low | accept | CLOSED (accepted) | Accepted risk, see log. No dependency added: diff touches no package manifest or lockfile. |

## Accepted Risks Log

| Threat ID | Risk | Rationale | Owner / date |
|-----------|------|-----------|--------------|
| T-260-07 | A red or running `workflow-size` on a main sha blocks that sha's Railway deploy and makes the next push's predecessor proof run FULL | Intended loudness and the safe direction (RESEARCH Pitfall 6); the job takes seconds; to be named in the CHANGELOG at ship | founder-delegated, 2026-11-28 |
| T-260-SC | Supply chain from installs | The plan installs nothing and adds no dependency | 2026-11-28 |

## Unregistered Flags

None. SUMMARY.md `## Threat Flags` reports none beyond the register.

## Notes (non-blocking)

- Carry-forward: the ship step must still confirm one extra check run is bound to the head SHA (SUMMARY "Manual check left for ship"); T-260-08 is verified on the branch range only, so a squash-body token added at merge time is outside this audit.

threats_open: 0
