---
phase: "195"
slug: "trim-leftover-and-duplicate-surfaces-are-gone"
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
block_on: high
created: "2026-11-07"
audited_at_sha: 03170d5b2
---

# Phase 195 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> Register built from the `<threat_model>` blocks of plans 195-01..07 (register authored at plan time) plus the SUMMARY `## Threat Flags` sections (all "None"). Audited by gsd-security-auditor against `e2fb131de..HEAD`, including the review-fix commits.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Browser to Next config redirects | `/portfolios/:path*`, `/decks`, `/api/portfolio-pdf/:id` rewritten before the auth proxy | Request path and query string (untrusted) |
| Anonymous visitor to public routes | `/portfolio-pdf/:id` retired page, `/browse/**` pages | Path params; no tenant data on the retired page |
| Stored client state to UI | Stored `allocations.tweaks`, factsheet `dark` key, `?dark=1` | Browser storage / URL params (untrusted) |
| Repo to PROD data | Surfaces removed while `portfolios` / `portfolio_strategies` rows are kept | No schema or data change in this phase |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-195-01 | Tampering | `next.config.ts` `/api/portfolio-pdf/:id` rule | medium | mitigate | Fixed same-origin destination `/portfolio-pdf/:id`, `permanent: true`; pinned by `trim-removed-surfaces.test.tsx` and `e2e/route-redirects.spec.ts` | closed |
| T-195-02 | Information disclosure | Old admin-client renderer and render-token verifier | high | mitigate | `pdf-render-token.ts` and `api/portfolio-pdf` deleted; `portfolio-pdf/[id]/page.tsx` is data-free (no admin/server client), pinned by `page.test.tsx:76-77` and the guard; `DEMO_PDF_SECRET` removed from `.env.example` | closed |
| T-195-03 | Elevation of privilege | `src/proxy.ts` PUBLIC_ROUTES | medium | mitigate | Comment-only diff; `/portfolio-pdf` stays public, `/api/portfolio-pdf` not added; route contract OK (52 routes) | closed |
| T-195-04 | Tampering | Stored `portfolios` / `portfolio_strategies` rows | high | mitigate | No `supabase/**` or SQL change; no added write calls; `c575d1f51` deleted handler code only | closed |
| T-195-05 | Tampering | Phase-150 OWN-03 trigger pins | high | mitigate | Only deleted writers removed from the census; trigger assertions and the `capital_ownership=` pin retained; test passes | closed |
| T-195-06 | Elevation of privilege | `/portfolios/:path*` to `/allocations` for a non-allocator | low | accept | Destination keeps `requireRolePage(..., "allocator")` (`allocations/page.tsx:62`), pinned by `requireRolePage-wiring.test.tsx` | closed |
| T-195-07 | Tampering | Stored `allocations.tweaks` altering what an allocator sees | low | mitigate | No reader left; `AllocationsTabs.test.tsx` and `EquityChart.fixed-defaults.test.tsx` seed a stale value and assert nothing changes | closed |
| T-195-08 | Tampering | `?dark=1` / stored view state | low | mitigate | `parsePersistedFields` drops `dark`; codec and provider tests plus the guard's dark-key needle | closed |
| T-195-09 | Repudiation | Combined disclaimer / tearsheet disclosure | high | mitigate | `strategy-page` variant composed of existing constants; exchange-API sentence only for `api_verified` (`e587587cd`); literal-string tests; tearsheet single Risk Disclosure test; disclaimer-count guard | closed |
| T-195-10 | Denial of service | `/browse` redirect on a failed read | low | mitigate | `browse-categories.ts` redirects only on a non-empty single-category read from the fixed list; failed/empty read renders fallback cards; `browse/page.test.tsx`, `breadcrumb-root.test.tsx` | closed |
| T-195-11 | Denial of service | `/allocations` shared portfolio components | medium | mitigate | Seven shared components present; no import of deleted components; tsc 0; 369 files / 6121 tests pass | closed |
| T-195-12 | Tampering | Guard bypass via comments, allowlist widening, loosened matcher | medium | mitigate | Comment stripping, matcher self-tests, case-insensitive matchers and pinned redirect permanence (`7ffdba541`), pinned 4-file allowlist, >500-file vacuity floor | closed |
| T-195-SC | Tampering | npm/pip/cargo installs (all 7 plans) | low | accept | No dependency manifest changed in the diff | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-195-01 | T-195-06 | `/portfolios/:path*` 308s to `/allocations` for every visitor, before the proxy session gate, forwarding the query string. The destination keeps its own allocator role gate and unauthenticated visitors still reach `/login`, so nothing is disclosed. | Plan 195-02 threat model (accept); premise verified by gsd-security-auditor | 2026-11-07 |
| AR-195-02 | T-195-SC | Phase 195 adds no package, pip or cargo installs; dependency manifests are unchanged in the diff. | All seven plan threat models (accept); verified by gsd-security-auditor | 2026-11-07 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-11-07 | 13 | 13 | 0 | gsd-security-auditor (sonnet), ASVS L1, block_on high |

Non-blocking notes from the audit: the new data-free `/portfolio-pdf/:id` surface is covered by T-195-02/03; `getBrowseCategories()` adds an RLS-bound published-only read on the two `/browse` child pages (covered by T-195-10); the "Strategy not found." branch of `/browse/<slug>/<id>` carries no disclaimer since D-09 (no figures shown).

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-11-07
