---
phase: "190"
slug: "factsheetqueued"
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on (high) severity
threats_open: 0
asvs_level: 1
created: "2026-11-04"
---

# Phase 190 - Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> Register authored at plan time (9 PLAN threat models, 24 numbered threats plus the `T-190-SC` install row that recurs in every plan). Verified against the branch `feat/190-factsheetqueued` (it carries the shipped code of #1194, v0.133.19.0) by gsd-security-auditor, ASVS 1, block_on high. Verdict: SECURED, `threats_open: 0`.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| browser to POST /api/strategies/finalize-wizard | untrusted body, already zod-validated; this phase adds no field | wizard finalize request |
| route after() to the service-role Supabase client | reads scoped to the finalized strategy id | `strategy_analytics`, `compute_jobs`, key creation times |
| factsheet payload to every lane (anon, owner, admin) | the "updating" decision depends on row state only | stored analytics series, flags, marker |
| derive prestamp (Python) to the TS reader | `last_success_snapshot` key literal pinned on both sides | copy of the same row's earlier flags (booleans, dates, method and unit names) |
| admin approval gate to `strategy_analytics` | pending or computing passes only with stored-result evidence | status and evidence columns |
| scratch SQL and tracked artifacts | read-only PROD counts; counts, kinds and dates only | no ids, no home paths |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-190-01 | Information disclosure | plan 01 measurement SQL and SUMMARY | medium | mitigate | Uuid-literal grep prints 0 for the three `190-MEASUREMENT*.sql` files, the nine SUMMARYs and the VERIFICATION; no home path in any | closed |
| T-190-02 | Tampering | PROD database (measurement SQL) | medium | mitigate | The three SQL files hold SELECTs only; no write keyword outside comments | closed |
| T-190-03 | Tampering | `decideFinalizeRerun` inputs | medium | mitigate | `src/lib/finalize-rerun.ts` takes no request-derived hint; both call sites in `finalize-wizard/route.ts` pass the resolved id and server-derived values | closed |
| T-190-04 | Denial of service | finalize `after()` enqueue | medium | mitigate | Every uncertain branch queues the run (read error, thrown read, null-without-error, dead in-flight job, asset class change, absent echo, changed inputs); pinned by `finalize-rerun.test.ts` and the route test | closed |
| T-190-05 | Information disclosure | logs and Sentry | low | mitigate | Skip line and capture carry strategy and correlation ids in server logs and Sentry extras only; error text passes `scrubSeamError` | closed |
| T-190-06 | Information disclosure | factsheet payload, every lane | medium | mitigate | `analyticsUpdating` is derived from row state only (`isRecomputeOverStoredResult` over `hasStoredAnalyticsResult`); no lane, cookie or header input; status stays a cache keyPart | closed |
| T-190-07 | Tampering / Repudiation | stored-result evidence rule | medium | mitigate | `hasStoredAnalyticsResult` needs a stored series, a finite headline and a success marker; a snapshot is used only when its `computed_at` is the same instant as the row's | closed |
| T-190-08 | Tampering | admission of non-terminal rows | medium | mitigate | A non-terminal row without evidence is withheld; `failed` never passes; D-04 withholds a terminal-success row whose prestamp left no bound snapshot | closed |
| T-190-09 | Repudiation | the updating line | low | mitigate | Renders only from `payload.analyticsUpdating === true`; copy is the pinned `ANALYTICS_UPDATING_LINE` | closed |
| T-190-10 | Tampering | public factsheet cache | medium | mitigate | Key `factsheet-v2-payload-v20` plus `computationStatus`; pinned by `page.public-cache-key.test.tsx` | closed |
| T-190-11 | Tampering | mixed-generation figures | medium | mitigate | Implemented as `basisInFlight` (review round 3 replaced the plan's `basisDqf`): no conventions echo, no MTM or smoothed series and no composite while updating; cross-language key parity test | closed |
| T-190-12 | Elevation of privilege | admin approval gate | medium | mitigate | `hasStoredResult` passed on the first pass and on the TOCTOU re-check; `failed` still `ANALYTICS_FAILED`, null still `ANALYTICS_MISSING` | closed |
| T-190-13 | Tampering | `checkStrategyGate` input | low | mitigate | `hasStoredResult` is a required field; the wizard passes `false` | closed |
| T-190-14 | Information disclosure | ranked projection columns | low | mitigate | Scalar `->>` aliases only, never the blob; the shaper deletes the three `last_success_*` aliases | closed |
| T-190-15 | Tampering | ranking admission | medium | mitigate | `isRankableAnalyticsRow` still delegates to `isComputedAnalytics` only; the updating arm adds no rankability | closed |
| T-190-16 | Tampering | PROD database (post-deploy reading) | low | mitigate | Tracked SQL is SELECT-only. Whether the UI-only writes were honoured at run time is not provable from code | closed |
| T-190-17 | Information disclosure | plan 08 artifacts and TODOS entry | medium | mitigate | No uuid literals and no home paths in the SQL, the plan-08 SUMMARY, the VERIFICATION and `TODOS.md` | closed |
| T-190-18 | Tampering | derive prestamp snapshot | medium | mitigate | `_last_success_snapshot` copies only marker-bearing flags with a string `computed_at`, read in one statement; the prestamp key is unconditional, null included; the reader binds on same-instant | closed |
| T-190-19 | Denial of service | derive snapshot pre-read | medium | mitigate | Plan text: the pre-read never raises. Shipped: a failed read is logged, captured and re-raised so the queue retries and the carried snapshot is not overwritten with an unearned null (review round 2, SFH M1; pinned by `test_derive_last_success_snapshot.py`). See AR-190-01 | closed (mitigation superseded, AR-190-01) |
| T-190-20 | Elevation of privilege | snapshot key in guard sets | medium | mitigate | Key documented as never a member of the NAV or allocated-capital guard key sets; `test_success_rebuild_drops_the_last_success_snapshot` pins the rebuild | closed |
| T-190-21 | Information disclosure | snapshot content | low | accept | Copy of the same row's earlier flags under the same RLS and grants | closed (accepted, AR-190-02) |
| T-190-22 | Information disclosure | /compare columns | low | mitigate | Scalar aliases only; the page deletes the four `last_success_*` aliases and holds no service-role client | closed |
| T-190-23 | Tampering | /compare flag generation | medium | mitigate | One flags generation per row (live or last success); `headline_since` follows the same generation | closed |
| T-190-24 | Tampering | benchmark joint | medium | mitigate | Admits through `isRecomputeOverStoredResult` plus evidence, withholds an unbound prestamp, reads `effectiveDataQualityFlags` | closed |
| T-190-SC | Tampering | npm installs | low | mitigate (plans 02-07) / accept (plans 08, 09) | No package added: the shipped `package.json` change is the version line only, and the lockfile is unchanged | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above `workflow.security_block_on` count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-190-01 | T-190-19 | The declared mitigation (a pre-read that never raises) was replaced on purpose: a failed read now fails the job before the prestamp, so the carried snapshot is not overwritten with a null it did not earn. The residual risk is that the read fails on all three queue attempts while the prestamp upsert to the same table keeps succeeding. `190-REVIEW.md` "Judgment (1)" accepted it. | Review round 2 judgment (SFH M1), not a founder decision | 2026-11-03 |
| AR-190-02 | T-190-21 | The snapshot is a copy of the same row's earlier flags (booleans, dates, method and unit names; T-73-02) under the same RLS and grants. | Plan 09 threat model (accept) | 2026-11-03 |

*Accepted risks do not resurface in future audit runs.*

**Recorded, not fixed:** `190-09-SUMMARY.md` still describes the old never-raises pre-read; the code and `190-REVIEW.md` are authoritative. Not checked at ASVS 1: run-time PROD behaviour for T-190-16.

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-11-04 | 25 | 25 | 0 | gsd-security-auditor |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-11-04
