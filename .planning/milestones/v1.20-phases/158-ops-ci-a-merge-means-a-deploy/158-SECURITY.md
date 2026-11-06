---
phase: 158
slug: ops-ci-a-merge-means-a-deploy
status: secured
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: 2026-08-20
---

# Phase 158 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| CI runner ↔ shared TEST Postgres | mutex acquire (session advisory lock), seed/spec traffic | TEST DSN (secret, name-only in files), TEST rows |
| CI runner ↔ GitHub API | cancelled-conclusion watcher, dedup'd issue writes | workflow_run payload (untrusted), GITHUB_TOKEN (contents:read + issues:write only) |
| Fork PR ↔ repository secrets | fork runs get no secrets; mutex/DB steps must no-op | none (by construction) |
| Local operator ↔ TEST project | drain script service-role writes | TEST service-role key (env-only, never in repo/transcripts) |
| Public repo ↔ world | workflows, runbook, evidence and decision artifacts, e2e specs | prose, counts, migration ids — no secrets, no credentials |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-158-01 | Information Disclosure | mutex acquire steps / probe (DSN in logs) | high | mitigate | DSN env→psql only; no `set -x`; only error text names the secret (ci.yml:1142 verified value-free) | closed |
| T-158-02 | Denial of Service | wedged lock holder blocks all DB jobs | medium | mitigate | `timeout-minutes` TTL; session auto-release; `pg_terminate_backend` runbook (docs/runbooks/shared-test-db-mutex.md) | closed |
| T-158-03 | Elevation of Privilege | fork PR reaching mutex/secret | medium | mitigate | acquire no-ops on empty secret; no unauthenticated retry | closed |
| T-158-04 | Tampering | probe red check on main HEAD | high | mitigate | probe push trigger restricted to `ci-probe/**` (verified); drill doctrine in runbook | closed |
| T-158-05 | Elevation of Privilege | watcher github-script expression injection | high | mitigate | 0 `${{ }}` inside script bodies (verified by block-scoped scan); payload via env: | closed |
| T-158-06 | Denial of Service | watcher redding main-HEAD check | high | mitigate | exit-0-on-detection; 0 failure-exit paths in file (verified) | closed |
| T-158-07 | Elevation of Privilege | watcher GITHUB_TOKEN scope | low | mitigate | contents:read + issues:write only | closed |
| T-158-08 | Information Disclosure | runbook DSN/username leak (public repo) | high | mitigate | secret names only; 0 credentialed-DSN patterns (verified) | closed |
| T-158-09 | Tampering | drain aimed at PROD | critical | mitigate | four-guard interlock (TEST-ref required, PROD-ref reject, prod-word regex, confirm env) — refusals observed in both build and measurement sessions | closed |
| T-158-10 | Repudiation | drain destroying audit trail | medium | mitigate | terminalize-only with provenance note; 0 deletion calls | closed |
| T-158-11 | Denial of Service | eligibility flip breaking live seeded specs | medium | mitigate | flip NOT executed (measured, deferred with pagination caveat recorded in evidence) | closed |
| T-158-12 | Tampering | drain racing concurrent CI fresh rows | medium | mitigate | 24h age guard; quiet-window check before both runs (0 in-flight) | closed |
| T-158-13 | Information Disclosure | evidence artifact secrets (public repo) | high | mitigate | counts/refs only; 0 secret patterns (verified); secret scan on commit clean | closed |
| T-158-14 | Tampering | cross-file test-state leakage (OPS-11) | low | mitigate | not present at HEAD (0/15 reproductions); 140.5 fences re-proven live by neuter drill | closed |
| T-158-15 | Repudiation | flake closure without falsifiable evidence | medium | mitigate | reproduction-first protocol executed; detector falsified both polarities; evidence artifact committed | closed |
| T-158-16 | Tampering | seeded spec polluting shared TEST state | low | mitigate | unique NAME_PREFIX + cleanup verified (0 leftover prefixed strategies) | closed |
| T-158-17 | Information Disclosure | credentials in spec files (public repo) | high | mitigate | seeded/env-gated identity; hardcoded pairs scrubbed repo-wide incl. two prose republications (commits e69c53e1, 11041327) — see note in Accepted Risks on git history | closed |
| T-158-18 | Spoofing | ownership-boundary regression on /my-strategies | medium | mitigate | non-owner-absent assertion pins the RLS-scoped read; both polarities observed | closed |
| T-158-19 | Denial of Service | wiring rotten specs reds frontend aggregator | medium | mitigate | wiring consumed only 158-05's measured verdicts; backstop truth re-checks on the phase PR | closed |
| T-158-20 | Tampering | accidental job-graph edits in ci.yml | medium | mitigate | diff-scope gate held (0 needs:/concurrency:/if:/runs-on:/timeout lines in 06's diff); C-0293 pins 140/140 green | closed |
| T-158-21 | Information Disclosure | decision artifacts leaking non-public detail | low | mitigate | migration ids, paths, reasoning only (verified) | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-158-1 | T-158-SC (plans 01, 02) | Supply chain: zero packages installed this phase; only already-in-repo SHA-pinned actions reused; the [SUS] fallback action was never adopted (gated behind a blocking human checkpoint that never fired) | orchestrator (autonomous run) | 2026-08-20 |
| AR-158-2 | csrf-allowlist-widening (158-06 threat flag) | Unseeded e2e CI job admits `http://localhost:3000` into the runtime CSRF allowlist — scoped to an ephemeral CI runner serving a placeholder-Supabase build; mirrors the identical landed line on the seeded job; production unaffected (prod sets NEXT_PUBLIC_SITE_URL, never this var) | orchestrator (autonomous run) | 2026-08-20 |
| AR-158-3 | T-158-17 (residual) | The scrubbed credential pairs remain in git HISTORY of this public repo (pre-existing exposure, documented before this phase). History rewrite out of scope; if any scrubbed account's password is live elsewhere, rotation is the real remediation — surfaced to the founder in the phase report | orchestrator (autonomous run) | 2026-08-20 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-08-20 | 21 (+2 accepted SC) | 21 | 0 | secure-phase L1 (orchestrator grep-verification; register plan-time authored) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
