---
phase: "196"
slug: "onestrategypage-a-strategy-has-one-page-the-factsheet-and-it"
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: "2026-11-09"
---

# Phase 196 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| request query → factsheet back link | `from` / `cat` read from the URL | untrusted strings, resolved only through a closed allowlist (`src/lib/factsheet/origin.ts`) |
| viewer session → cached public lane | the viewer is resolved after the `unstable_cache` read and never enters the key or the payload | session identity, role, attestation |
| share token → recipient page | constant-time HMAC match, then one boolean session read for chrome only | bearer token, `no-referrer` |
| PDF routes → headless Chromium | cookieless render of the published lane, URL built from the id alone, Advanced opened server-side | published figures only |
| retired routes → factsheet | config-level 308s with no database read | none |

---

## Threat Register

Every row is from a 196-NN-PLAN.md `<threat_model>`; evidence per row is in the audit below. T-196-SC appears once in each of the 21 plans and is listed once.

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-196-06 | Spoofing / Tampering (open redirect) | `parseOrigin`, `backTargetFor` | high | mitigate | exact hasOwnProperty membership in `FACTSHEET_ORIGINS` and `DISCOVERY_CATEGORIES`; hrefs come only from the map; adversarial arms (absolute, protocol-relative, `__proto__`, traversal, arrays) with neuter evidence | closed |
| T-196-07 | Spoofing | `BackLink` history branch | medium | mitigate | `history.back()` only when the referrer origin equals `window.location.origin`; otherwise a fixed same-origin link | closed |
| T-196-SC | Tampering | npm/pip/cargo installs | low | accept | no package installs in this plan | closed |
| T-196-03 | Information disclosure | `next.config.ts` four rules | high | mitigate | rules are DB-free and unconditional; unit test asserts no `has`/`missing`; the factsheet's identical not-found answers unpublished and missing ids alike | closed |
| T-196-04 | Tampering | `:slug` substituted into `cat=` | low | mitigate | destination host is fixed same-origin; `from`/`cat` are closed-set validated by plan 03 before any use; raw value never becomes an href | closed |
| T-196-05 | Denial of service (availability) | old shared links | medium | mitigate | e2e first-hop canary asserts 308 and never `/login` for anon; query passthrough asserted | closed |
| T-196-01 | Information disclosure | `run.ts` output, `196-CENSUS.md` | medium | mitigate | ids only via env; output guard exits 2 on any env id or UUID-shaped substring; grep gate on the tracked file | closed |
| T-196-02 | Denial of service | production site | low | accept | three strategies, two renders each, sequential; no write path is touched | closed |
| T-196-08 | Tampering (duplicate writes) | `RequestIntroButton.handleSubmit` | medium | mitigate | in-flight ref blocks a click burst; server unique violation returns 409 which maps to the sent state; neuter evidence on the double-click arm | closed |
| T-196-09 | Elevation of privilege | `/api/intro` | low | accept | unchanged: the route keeps its approval and role checks; the button is a UI affordance, never the authorization | closed |
| T-196-16 | Tampering | link sites | low | mitigate | every href built by `buildFactsheetHref` (closed sets, encoded id); corpus guard rule B with a stale-checked allow-list | closed |
| T-196-17 | Information disclosure | `from`/`cat` leaking into a shared URL | low | accept | `ShareableLink` builds the share URL from the path only (UI-SPEC); the params name an app surface, never a user or strategy | closed |
| T-196-15 | Tampering | `StrategyTable` / `StrategyGrid` hrefs | low | mitigate | hrefs built only by `buildFactsheetHref`, which re-applies the closed sets; strategy id is `encodeURIComponent`ed | closed |
| T-196-18 | Information disclosure | session-dependent `/browse` header served from a shared cache | medium | mitigate | the pages already render per request (confirmed and recorded in Task 1); the helper reads only a boolean and renders nothing user-specific | closed |
| T-196-19 | Spoofing | `hasBrowseSession` | low | mitigate | server-validated `auth.getUser()`, never `getSession()` or a cookie presence check; errors fall back to the visitor view | closed |
| T-196-27 | Information disclosure | session read on the token lane (OQ-3, flagged for the phase security review) | medium | mitigate | read only after the match, one boolean, no profile or owner read, never passed to the builder, `withViewerAum(payload, false)` for everyone; static and behavioural arms; neuter evidence | closed |
| T-196-28 | Information disclosure | token in the Referer when following the header links | high | mitigate | `next.config.ts` sends `Referrer-Policy: no-referrer` for `/factsheet-share/:path*`; a test pins it | closed |
| T-196-29 | Information disclosure (enumeration) | ordering of the session read | medium | mitigate | rate limit and token checks run first and do not read the session; arm asserts createClient is not called on those paths | closed |
| T-196-30 | Information disclosure (cache) | token lane reaching the public cache | high | mitigate | no next/cache import, no cache primitive, `force-dynamic`; the existing no-cache-reach arms stay and gain the new static arms | closed |
| T-196-25 | Tampering (figure integrity) | KPI comparator line | medium | mitigate | values come from the exported `headlineBenchSource` with the rail's arguments and the cell's own formatter and gate; non-finite prints a dash; arms on fixtures A and C | closed |
| T-196-26 | Repudiation (silent omission) | section content predicates | low | mitigate | each predicate is named and listed with its data field in the SUMMARY; the census open-state positive control proves Advanced still holds its charts | closed |
| T-196-22 | Information disclosure | Advanced storage key outliving a session | low | mitigate | key under the registered `factsheet-collapse:` prefix, so the sign-out purge removes it; listed in `KNOWN_APP_KEYS` | closed |
| T-196-23 | Tampering | stored or cross-tab value | low | mitigate | codec accepts only "open"/"closed"; anything else reads closed; throwing storage renders closed | closed |
| T-196-24 | Information disclosure | print view link on an unpublished or shared factsheet | low | mitigate | link shown only when published and not a token recipient; the tearsheet route itself stays published-only (plan 13) | closed |
| T-196-38 | Denial of service (availability) | deleted discovery detail tree | medium | mitigate | `depends_on` plan 02, whose 308s run before routing; the precondition asserts the manifest exception row exists; `check:route-contract` runs after the deletion | closed |
| T-196-40 | Information disclosure | rank read on the factsheet | medium | mitigate | published-only reads (`withPublishedOnly`, `getPercentiles`); read on the published lane only; overlaid after the shared cache and never stored in it (not-in-cache arm with neuter evidence); JSON-LD unchanged | closed |
| T-196-41 | Tampering (integrity) | an annualised rank beside a withheld figure | medium | mitigate | one component, gate on the payload's `figureRecord`, the tearsheet's four arms on the factsheet mount, neuter evidence on both mounts | closed |
| T-196-42 | Denial of service | per-request cohort read | low | accept | the same read the tearsheet and `/browse/[slug]` make per request; a failure returns null and reports to Sentry, and the page renders without the section | closed |
| T-196-10 | Information disclosure | `page.tsx` viewer resolution vs `unstable_cache` | high | mitigate | viewer resolved after the probe and passed as render props; tests assert cache args and payload carry no user, role or owner; the public-cache-key and owner-lane suites stay green; neuter evidence on lane order | closed |
| T-196-11 | Elevation of privilege | `ViewerBar` actions | low | mitigate | affordance only: `/api/intro` and `/allocations` keep their own server checks; the bar fails closed on a profile read error | closed |
| T-196-13 | Information disclosure | note read in `page.tsx` | medium | mitigate | read filtered by the server-validated `user.id`, RLS on `user_notes` unchanged; card omitted on read error so no empty card can overwrite a saved note | closed |
| T-196-14 | Spoofing | owner check | medium | mitigate | `isOwner` compares the server-validated user id to the strategy's `user_id` from the server read; no client value is consulted | closed |
| T-196-20 | Tampering (figure integrity) | moved `Row` value expressions | medium | mitigate | rows are moved with their existing `gv`/`wr` wrappers and formatters; the parts test renders censusPayloadB/C (short and withheld records) and asserts withheld figures still read withheld in the main part | closed |
| T-196-21 | Information disclosure | Terms panel | low | accept | only removes rows; adds no data | closed |
| T-196-12 | Information disclosure | `generateMetadata` robots | medium | mitigate | noindex dropped only when the published-only probe finds the row; miss and error keep noindex; three metadata arms with neuter evidence | closed |
| T-196-43 | Denial of service (availability) | deleted browse detail tree | medium | mitigate | `depends_on` plan 02, whose 308s run before routing; the precondition asserts the manifest exception row exists; `check:route-contract` runs after the deletion | closed |
| T-196-45 | Tampering | My allocation link sites | low | mitigate | hrefs built only by `buildFactsheetHref` (closed origin set, `encodeURIComponent`ed id); plan 07's guard rule B reports any raw factsheet template that comes back | closed |
| T-196-31 | Elevation of privilege | D-08 print-all mode | medium | mitigate | the mode is unconditional inside the server route; no parameter, header or cookie is read for it; the page has no print-all input; arm proves a query string changes nothing | closed |
| T-196-32 | Repudiation / integrity | short LP report | medium | mitigate | 503 with Sentry on a failed Advanced mount, never a partial PDF; neuter evidence | closed |
| T-196-33 | Information disclosure | tearsheet manager identity | high | mitigate | attestation gate kept verbatim; anonymous, unattested and read-error arms; neuter evidence | closed |
| T-196-34 | Information disclosure | AUM on tearsheet and PDF | medium | mitigate | `canViewAum` and `withViewerAum` unchanged; the PDF render is cookieless, so anonymous | closed |
| T-196-35 | Information disclosure | unpublished strategy on tearsheet | medium | mitigate | published-only builder; null → `notFound()` | closed |
| T-196-39 | Information disclosure | kept ranks and contact block | low | mitigate | the ranks come from the published-only `getPercentiles` cohort an anonymous visitor already reads on `/browse`; the contact block carries only the display name the H1 shows, no manager identity and no AUM | closed |
| T-196-46 | Denial of service (availability) | orphan sweep deleting a live module | medium | mitigate | each candidate re-checked for non-test importers before `git rm`; `npx tsc --noEmit` and the vitest run after every task; only declared paths deleted; kept candidates named with their importer | closed |
| T-196-47 | Information disclosure | removal of `getStrategyDetail` / `getPublicStrategyDetail` (manager-identity redaction readers) | low | mitigate | removed only when no non-test importer remains, so no surface loses its redaction; the factsheet's own payload path is untouched; recorded in the SUMMARY for the phase security review | closed |
| T-196-44 | Denial of service (availability) | deleted `/strategy/[id]` and `/strategy/[id]/v2` trees | medium | mitigate | `depends_on` plan 02, whose 308s run before routing; the precondition asserts the manifest exception row exists; `check:route-contract` runs after each deletion; `PUBLIC_ROUTES` in `src/proxy.ts` is left unchanged so the redirect is never preceded by a login bounce | closed |
| T-196-36 | Information disclosure | `196-CENSUS.md`, `TODOS.md`, `196-KNIP-BASELINE.txt` | medium | mitigate | names, profiles, file paths and export names only; UUID grep gate returns 0; command shapes use placeholders | closed |
| T-196-37 | Repudiation | dropped surfaces | low | mitigate | every loss is in the SUMMARY's must-carry list for the CHANGELOG and booked in TODOS.md | closed |

*Status: open · closed · open — below high threshold (non-blocking)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-196-01 | T-196-02 | The census driver is read-only and visits pages one at a time. | plan 01 threat model; auditor confirmed | 2026-11-09 |
| AR-196-02 | T-196-09 | `/api/intro` is byte-identical to the phase base and keeps its approval and role checks. | plan 05 threat model; auditor confirmed | 2026-11-09 |
| AR-196-03 | T-196-17 | `ShareableLink` builds the bare `/factsheet/<id>` with no origin params. | plan 06 threat model; auditor confirmed | 2026-11-09 |
| AR-196-04 | T-196-21 | The Terms panel only lost rows (pinned by the parts test). | plan 09 threat model; auditor confirmed | 2026-11-09 |
| AR-196-05 | T-196-42 | `readPeerRanks` returns null and reports to Sentry on an error. | plan 16 threat model; auditor confirmed | 2026-11-09 |
| AR-196-06 | T-196-SC (×21) | No dependency manifest changed between the phase base and HEAD. | every plan's threat model; auditor confirmed | 2026-11-09 |
| AR-196-07 | CR-01 residual | The factsheet buttons require the investor attestation (`resolveFactsheetViewer`, fail-closed), but `/api/intro` does not, exactly as before the phase. Enforcing it in the route would block the Bridge intro. Not a regression; founder call booked as TODOS `196-INTRO-API-ATTESTATION-01`. | Phase 196 review rounds 1-2; routed to founder | 2026-11-09 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-11-09 | 68 | 68 | 0 | gsd-security-auditor at 21107f354 (623 pinning tests green, tsc 0, route contract OK) |

Notes from the audit (not threats): the `/factsheet/<id>/v2` alias still sits under `v2/loading.tsx`, so its not-found answers a soft 200 with the same card for unpublished and missing ids plus `noindex` (no existence oracle; the canonical route answers real statuses). Stale comments still name the deleted readers (`ManagerIdentityPanel.tsx`, `StrategyTable.tsx`, `admin/csv-status/page.tsx`). 196-04 and 196-15 SUMMARYs have no Threat Flags section.

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-11-09
