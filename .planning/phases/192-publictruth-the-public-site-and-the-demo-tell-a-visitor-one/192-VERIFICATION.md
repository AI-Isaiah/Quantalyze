---
phase: 192-publictruth-the-public-site-and-the-demo-tell-a-visitor-one
verified: 2026-11-07T04:20:00Z
status: passed
score: 7/7 must-haves verified
verified_at_sha: b59f1d11c0130e1ee3af60d49061dfac7b9466b8
drift_subjects:
  - src/app/(marketing)/page.tsx
  - src/app/(marketing)/security/page.tsx
  - src/app/(marketing)/for-quants/page.tsx
  - src/app/(marketing)/legal/terms/page.tsx
  - src/lib/status-surface-copy.ts
  - src/proxy.ts
  - src/proxy.test.ts
  - src/lib/routing/route-contract-manifest.ts
  - src/__tests__/public-truth-census.test.tsx
  - src/__tests__/public-truth-copy.test.tsx
  - src/__tests__/security-packet-date-drift.test.ts
  - scripts/build-security-packet.html
  - public/security-packet.pdf
  - lighthouserc.json
  - .github/workflows/ci.yml
behavior_unverified: 2
behavior_unverified_items:
  - truth: "The home sign-up band shows no horizontal overflow and keeps a 44px CTA target at the reflow sweep's 390px floor (plan 192-03, verification: backstop)"
    test: "Open / at 390px and at desktop width, signed out. Read the 'Verify your track record' band."
    expected: "No horizontal scroll; the EXCHANGE_LIST sentence and the key-storage sentence wrap inside the max-w-2xl measure; the 'Create an account' link is at least 44px tall; the band reads as finished on both widths."
    why_human: "Layout is not provable by grep or jsdom. The only automated backstop is the existing reflow-sweep public rows (e2e), which did not run here (Playwright needs a build and CI)."
  - truth: "/security's at-a-glance table, with the longer At Rest control string, wraps inside its cell with no horizontal page scroll at 390px (plan 192-04, verification: backstop)"
    test: "Open /security at 390px and at desktop width. Read the at-a-glance table rows In Transit and At Rest."
    expected: "'Fernet (AES-128-CBC + HMAC-SHA256)' and 'Per-row DEK wrapped by a KEK held by the analytics service' wrap inside their cells; no horizontal page scroll."
    why_human: "Same reason: layout. The reflow-sweep public row for /security is the backstop and it has not run on this branch."
human_verification:
  - test: "Home sign-up band, 390px and desktop (see behavior_unverified_items)"
    expected: "No overflow, CTA at least 44px, copy wraps, reads finished"
    why_human: "Visual layout"
  - test: "/security At Rest cell, 390px and desktop (see behavior_unverified_items)"
    expected: "Wraps inside its cell, no horizontal page scroll"
    why_human: "Visual layout"
  - test: "Read the lighthouse-mobile job on this phase's own PR run before merge (floor now 0.82)"
    expected: "Per-route performance medians for /, /security, /for-quants and /browse are at or above 0.82 (best-of-3, lhci optimistic aggregation). If a route misses, re-derive the floor from the measurement; do not widen the route list."
    why_human: "Needs a CI run. lighthouserc.json records that the 0.82 floor was derived from 17 main runs and NOT measured on this branch's code. The job is advisory, but a red one on an unmeasured floor is exactly what the derivation was meant to prevent."
  - test: "Playwright and seeded e2e lanes on the PR (no-clip, axe, reflow, reflow-authed, marketing-shell, smoke)"
    expected: "All green with no /demo test collected; every e2e path a workflow names resolves (verified on disk here, but the lanes themselves did not run)."
    why_human: "Needs a built app and a seeded Supabase env."
overrides_applied: 0
gaps: []
---

# Phase 192: PUBLICTRUTH Verification Report

**Phase Goal:** A first-time visitor reading the home page, `/security`, `/for-quants`, the Terms and `/demo` gets one consistent, true account of how API keys are stored and encrypted, which TLS versions are accepted, who can view a factsheet, what listing costs and how many exchanges are supported, and sees a demo that looks finished. The home page no longer asks an anonymous visitor for a key and secret.
**Amended by:** founder override 2026-11-07 (D-11): the public demo is retired in code, not repaired. Success criterion 5 reads "`/demo` and every link to it are gone, and no public page links to a retired route." Judged against the amended criterion.
**Verified:** 2026-11-07
**Status:** passed (was human_needed at issue; the four human items were resolved by UAT on 2026-11-07, see 192-UAT.md)
**Re-verification:** No, initial verification
**Verified at:** `b59f1d11c0130e1ee3af60d49061dfac7b9466b8` (worktree `quantalyze-192`, branch `feat/192-publictruth`)

## Goal Achievement

Every roadmap success criterion is met in the code at HEAD. The status is `human_needed`, not `passed`, because two layout truths are declared `verification: backstop` (their only evidence is an e2e lane that has not run here) and two items need CI (Lighthouse floor, Playwright lanes). No gap was found.

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC1 | Key storage and encryption are described once, the same way, on home, `/security`, `/for-quants` and Terms, and match the credential code path | ✓ VERIFIED | One constant, `KEY_STORAGE_SENTENCE` in `src/lib/status-surface-copy.ts:697`, with `KEY_STORAGE_LINK` (`/security#key-handling`). Rendered by home (`page.tsx:221`), `/for-quants` (`page.tsx:317-318`) and Terms (`legal/terms/page.tsx:37-42`). `/security` holds the one full explanation (`page.tsx:146-160`, id `key-handling` at `:132`): Fernet = AES-128-CBC + HMAC-SHA256, DEK per credential, KEK held by the analytics service, per-row KEK version, column-grant revoke. 192-EVIDENCE.md records the code facts at HEAD (`analytics-service/services/encryption.py` imports Fernet, `generate_dek()` per call, KEK from the service's own env; no Vault, no AES-256-GCM in the key path; no SELECT grant on the five encrypted columns to anon or authenticated) and judges the sentence clause by clause. Repo grep over `src/app/(marketing)`, `src/components/landing` (only the orphaned form), the packet HTML and the packet PDF text finds no `AES-256`, `Supabase Vault`, `qualified allocators`, `disable TLS` or `30-day` claim. The packet PDF text carries the same cipher, KEK and TLS facts and the same "Last reviewed 2026-11-07" as `/security`. |
| SC2 | `/security`'s TLS sentence matches a recorded handshake per version; `/for-quants`' factsheet-visibility sentence matches what a signed-out request returns | ✓ VERIFIED | TLS: 192-EVIDENCE.md records four lines, `D-03 TLS 1.0: refused`, `1.1: refused` (alert 70), `1.2: accepted` (ECDHE-RSA-AES128-GCM-SHA256), `1.3: accepted`, against the production host with OpenSSL 3.6.4, plus the served HSTS header and certificate window. `/security` now says "TLS 1.3 or TLS 1.2. The edge refuses TLS 1.0 and 1.1" (`page.tsx:116-117`) and the table row says the same (`:284-286`); the packet and PDF agree. The false "disable TLS 1.0, 1.1, and 1.2" is gone. Factsheet: `/factsheet` is in `PUBLIC_ROUTES` (`src/proxy.ts:18`); the evidence records a signed-out published factsheet = 200, random id = 404, title = codename, firm name absent. `/for-quants` says "A published factsheet is listed on Browse and opens for anyone, without signing in. It shows your codename, never your firm name." (`page.tsx:325-326`); `/browse` is also in `PUBLIC_ROUTES`. The founder chose sentence over behaviour (SC-2 note); no TLS, HSTS or visibility behaviour changed. I did not re-run the handshakes (they are network facts recorded at execution, 2026-11-06). |
| SC3 | The listing cost reads the same on `/for-quants` and Terms §7, and every page that states an exchange count reads one shared value | ✓ VERIFIED | `LISTING_COST_SENTENCE` (`status-surface-copy.ts:710`) rendered at `/for-quants` hero (`page.tsx:103`) and Terms (`terms/page.tsx:90`); no fee figure. Exchange count: home reads `EXCHANGES.length` twice (`page.tsx:149`, `:271`); every exchange list is `EXCHANGE_LIST`, a `Intl.ListFormat` over `EXCHANGES` (`status-surface-copy.ts:719`), used on home (`:217`) and `/for-quants` (`:342`). Grep of the marketing tree finds no typed count or venue list; the packet HTML lists "Binance, OKX, Bybit, or Deribit", which `security-packet-date-drift.test.ts` pins to `EXCHANGES` (default flags). Flag-split limit is booked as `[192-SFOX-FLAG-SPLIT]`. |
| SC4 | The home page shows an anonymous visitor no form asking for an API key or secret | ✓ VERIFIED | `src/app/(marketing)/page.tsx` has no `<form>`, `<input>` or `<textarea>`, no `VerificationSection` import, no "never stored". The `#verify` section is one "Create an account" `Link` to `/signup` plus the shared sentences (`page.tsx:208-240`). `VerificationSection`/`VerificationForm` have no non-test importer (orphaned, booked as `[192-ORPHANED-LANDING-VERIFY]`; their copy "Your keys are never stored" is rendered nowhere). The public-truth census renders home and asserts no input or form. |
| SC5 (amended D-11) | `/demo` and every link to it are gone, and no public page links to a retired route | ✓ VERIFIED | `src/app/(marketing)/demo` and `src/app/api/demo` do not exist. `src/proxy.ts` has no `/demo` or `/api/demo`. `check-route-contract.ts`: "56 page routes, all declared" (57 before). Grep of `src`, `public`, `e2e`, `scripts` for a `/demo` link target outside tests finds none (remaining `/demo` hits are comments: `IN-03` of the review). No `sitemap`, `robots` or `vercel.json` entry names it. `lighthouserc.json` URL list and every workflow e2e path resolve (checked on disk, 0 MISSING). I planted `href="/demo?persona=active"` in a new component: the census failed naming `src/components/zz-plant.tsx:1`; removed, tree clean. I added `"/demo"` to `PUBLIC_ROUTES` with a byte backup: 4 `proxy.test.ts` rows went RED; restored, `cmp` silent. A signed-out request for `/demo`, `/demo/founder-view` or `/api/demo` gets the same 307 to `/login` as `/no-such-page-192` (192-EVIDENCE.md `D-11 /demo anon answer: matches control`, `D-11 /api/demo anon answer: matches control`, from a placeholder build). PROD demo rows untouched (no PROD access used here; the plans recorded none). REQUIREMENTS ROUTE-03 carries the dated amendment. |
| P1 | The home sign-up band shows no horizontal overflow and a 44px CTA at 390px (plan 192-03, backstop) | ✓ VERIFIED (UAT 2026-11-07) | Classes are right (`py-3 text-body`, `max-w-2xl` wrap, class string equal to the Get Started link). UAT on the PR preview: desktop link right of the heading, 390px left-aligned with the link below, document width 390, no horizontal scroll. |
| P2 | `/security`'s at-a-glance table wraps the longer At Rest string at 390px with no horizontal scroll (plan 192-04, backstop) | ✓ VERIFIED (UAT 2026-11-07) | Table text is present (`page.tsx:284-300`). UAT on the PR preview at 390px: the At Rest cell wraps inside the table (cell 120px wide, table ends at x366, document width 390); desktop fine. |

**Score:** 7/7 truths verified. P1 and P2 were backstops by the plans' own declaration; UAT on 2026-11-07 resolved both.

### Plan must-have cross-check (executed plans)

Plans 192-02, 192-05, 192-07 and 192-09 were written to repair `/demo`. D-11 superseded their demo-facing truths; the code they built was then deleted by plans 192-11 to 192-17. I judged them against the retired state, not the original wording:

| Plan | Truth that survives D-11 | Status |
|------|--------------------------|--------|
| 192-01 | Evidence rows: four TLS lines, HSTS and cert, Vercel-doc ASSUMED tag, Fernet and code facts, D-04 line, D-09 line, retention, no PROD id | ✓ in 192-EVIDENCE.md (read; marker query recorded first; `D-10 unresolvable labels: 9` kept as a dated PROD fact, not a gate) |
| 192-02, 05, 07, 09 | Demo hero, demo reads, founder view, demo e2e sweeps | Superseded in effect: files deleted (`EditorialHero`, `demo/page.tsx`, founder-view, `/api/demo/match`, sweeps). Their loud-failure and null-cell code left with the page, as D-08 amendment says. |
| 192-03 | One key-storage sentence, one cost sentence, one exchange list, factsheet sentence, no home form | ✓ (SC1, SC3, SC4 above) |
| 192-04 | `/security`, packet HTML and PDF, same facts and date | ✓ (SC1, SC2) |
| 192-10 | Census gate, retired-route link check, TODOS bookings | ✓ census passes and bites; TODOS carries `192-WIZARD-KEY-STORAGE-COPY`, `192-ORPHANED-LANDING-VERIFY`, `192-SFOX-FLAG-SPLIT`, `192-DEMO-RETIRE-RESIDUE`, `193-DEMO-PAYLOAD-PRODUCERS`; `170.1.2-DEMO-MATCH-PAYLOAD-EMAIL` marked CLOSED; two `158-OPS-03` items ticked. Exactly one `D-08 repair:` line, reading `not needed (demo retired, founder 2026-11-07)`. |
| 192-11 | `/demo` not public, proxy rows RED-proven, manifest entry gone, 56 routes, no `s-maxage` rule | ✓ |
| 192-12 | Admin match queue demo mode gone | ✓ `src/components/admin` tests pass |
| 192-13 | Demo-only components and readers gone, display-sign census moved | ✓ files absent; `display-sign-single-source` passes |
| 192-14 | No demo e2e, baselines or CI plumbing; Lighthouse audits four routes | ✓ no `*demo*` spec in `e2e/`; no missing workflow e2e path; `lighthouserc.json` carries no `/demo` URL |
| 192-15 | `/api/demo` endpoint, token module, persona constants gone; `DEMO_PDF_SECRET` stays for the portfolio PDF token | ✓ `src/lib/demo.ts`, `personas.ts` absent; `pdf-render-token.ts` keeps `SECRET_ENV` |
| 192-16 | Nightly canary retired, apt census 18 to 17 | ✓ `ci-apt-bounded` contract passes |
| 192-17 | Demo-page warmer deleted, seam censuses moved, daily cron kept | ✓ `seam-budgets.invariant` passes; cron route still present, docblock updated |
| 192-06, 192-08 | Superseded (DEFERRED markers, `status: superseded`) | Not counted as missing, per instruction |

### Required Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `src/lib/status-surface-copy.ts` (`KEY_STORAGE_SENTENCE`, `KEY_STORAGE_LINK`, `LISTING_COST_SENTENCE`, `EXCHANGE_LIST`) | ✓ VERIFIED | Substantive, imported by home, `/for-quants`, Terms; `EXCHANGE_LIST` derives from `EXCHANGES` |
| `src/app/(marketing)/security/page.tsx` | ✓ VERIFIED | Fernet text, TLS text, anchor `key-handling`, retention sentences match the evidence |
| `scripts/build-security-packet.html` and `public/security-packet.pdf` | ✓ VERIFIED | `pdftotext` on the committed PDF shows the same cipher, KEK, TLS, retention and deletion text as the HTML; date 2026-11-07 on page, packet and PDF |
| `src/__tests__/public-truth-census.test.tsx` | ✓ VERIFIED | 33 tests pass; the retired-link test failed on a planted link and passed after removal |
| `src/__tests__/public-truth-copy.test.tsx` | ✓ VERIFIED | Passes |
| `src/proxy.ts` and `src/proxy.test.ts` | ✓ VERIFIED | 107 tests pass; 4 rows go RED if `/demo` returns to `PUBLIC_ROUTES` |
| `src/lib/routing/route-contract-manifest.ts` | ✓ VERIFIED | `check-route-contract`: 56 routes OK |
| `lighthouserc.json` | ✓ present, ⚠ floor unmeasured | `minScore: 0.82`, derivation recorded; no `/demo` URL |
| `TODOS.md` bookings | ✓ VERIFIED | Entries present with owners and closing conditions |

### Key Link Verification

| From | To | Status | Details |
|------|----|--------|---------|
| Home, `/for-quants`, Terms | `status-surface-copy.ts` | ✓ WIRED | All three import and render `KEY_STORAGE_SENTENCE` and the link |
| `KEY_STORAGE_LINK.href` | `/security` `id="key-handling"` | ✓ WIRED | Anchor present at `page.tsx:132` |
| `EXCHANGE_LIST` | `EXCHANGES` | ✓ WIRED | `Intl.ListFormat` over `EXCHANGES` |
| Packet exchange list | `EXCHANGES` | ✓ WIRED | Pinned by `security-packet-date-drift.test.ts` |
| `PUBLIC_ROUTES` | retired routes | ✓ NOT PRESENT | Shown RED when re-added |
| Census | marketing sources and packet | ✓ WIRED | Anti-vacuity assertion on the scanned list; rendered half checks home, `/security`, `/for-quants`, Terms |

### Data-Flow Trace (Level 4)

| Artifact | Data | Source | Real data | Status |
|----------|------|--------|-----------|--------|
| Home `EXCHANGES.length`, `EXCHANGE_LIST` | exchange set | `UI_EXCHANGE_CODES` through `EXCHANGE_DISPLAY` in `closed-sets.ts` (flag-aware) | Yes | ✓ FLOWING |
| Home social-proof stats | counts | Supabase reads, errored stat becomes `null` and Sentry | Yes | ✓ FLOWING (unchanged by this phase) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Census, proxy, seed-integrity | `npx vitest run src/__tests__/public-truth-census.test.tsx src/proxy.test.ts src/__tests__/seed-integrity.test.ts` | 3 files, 165 tests passed | ✓ PASS |
| Copy, packet drift, marketing pages, critical-regressions, contracts, seam budgets, display-sign, limiter-ordering, admin | `npx vitest run` over those paths | 34 files, 921 tests passed | ✓ PASS |
| Route contract | `npx tsx scripts/check-route-contract.ts` | 56 page routes OK | ✓ PASS |
| Census bites on a planted `/demo` link | plant `src/components/zz-plant.tsx`, run census, remove | 1 failed, named the file; tree clean after | ✓ PASS |
| Proxy bites on `/demo` re-added to `PUBLIC_ROUTES` | byte backup, edit, run, restore, `cmp` | 4 RED, restored | ✓ PASS |
| Every workflow e2e path resolves | grep paths in `.github/workflows/*.yml`, test `-f` | 0 missing | ✓ PASS |
| Full vitest, tsc, lint | taken from the orchestrator's measurement | 2 failures in `src/lib/factsheet/compute.conventions.test.ts` (FROZEN snapshots B and C), identical on main `ba3c90128`, inside the Phase 193 fence; tsc and lint clean | not re-run by me |

### Probe Execution

Step 7c: no probe is declared by any plan of this phase. SKIPPED.

### Requirements Coverage

| Requirement | Source plans | Description | Status | Evidence |
|-------------|--------------|-------------|--------|----------|
| TRUST-01 | 192-01, 192-03, 192-04, 192-10 (and 192-01 lists both) | One consistent, true account of key storage, TLS, factsheet visibility, listing cost and exchange count; no key form for an anonymous visitor on home | ✓ SATISFIED | SC1 to SC4 above |
| ROUTE-03 (amended 2026-11-07, D-11) | 192-01, 192-02, 192-05, 192-07, 192-09, 192-11 to 192-17 (192-06 and 192-08 superseded) | `/demo` and every link to it gone; an unknown-URL answer for it; no public page links to a retired route | ✓ SATISFIED | SC5 above |

Every requirement ID in the plan frontmatter (`TRUST-01`, `ROUTE-03`) is accounted for. REQUIREMENTS.md maps both to Phase 192 and no other ID to this phase, so there are no orphaned requirements. The Traceability table still reads `Pending` for both; the orchestrator updates it at phase close.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (phase-modified files) | n/a | `TBD`, `FIXME`, `XXX` markers | none found in the files read | No debt-marker blocker |
| `src/components/landing/VerificationForm.tsx` | 219 | "Your keys are never stored." | ℹ️ Info | Component is orphaned (no non-test importer). Booked as `[192-ORPHANED-LANDING-VERIFY]`. Not visible to any visitor; its endpoint `/api/verify-strategy` remains public (booked) |
| `src/app/(marketing)/for-quants/page.tsx` | 271 | "Sample Strategy (Demo Data)" label | ℹ️ Info | An honest label on an illustrative sample block, not a route or link. Booked in `[192-DEMO-RETIRE-RESIDUE]` |
| Comments naming `/demo` (`CardShell.tsx:9`, `security/page.tsx:14`, `portfolio-pdf/[id]/page.tsx:123`, `portfolio-insights.ts`, `e2e` helper comments, seeders) | various | Stale lineage | ℹ️ Info | Comments, not links. Review IN-03; residue is booked |
| `docs/architecture/adr-0014-secret-handling.md` | 37, 124 | Names `HMAC_SECRET`; code reads `DEMO_PDF_SECRET` | ℹ️ Info | Review IN-01, open |
| `src/__tests__/public-truth-census.test.tsx` | 173 | Link census does not scan `src/lib` | ℹ️ Info | Review IN-02, open |
| `lighthouserc.json` | 30 | `_ratchet` says the first check comes after merge, but `lighthouse-mobile` runs on every PR | ℹ️ Info | Review IN-05; see human item 3 |

None is a blocker. Review round 3: 0 MEDIUM+.

### Notes that bear on trust in the copy

- **"A published factsheet shows your codename, never your firm name."** The 2026-11-06 PROD reading of `firm-name=absent` is vacuous, as the evidence says itself: no PROD owner has a company. The claim rests on the code path. At HEAD that path holds: `strategies.name` is constrained to the `STRATEGY_NAMES` allow-list by the wizard and the edit form's select; the one free-text path (`/api/strategies/[id]/name`) is restricted to private or draft rows, and publication is admin-gated (`guard_strategies_publish_transition`), a residual risk the route's own comment accepts (T-150-15). The factsheet page titles with `name ?? codename`, so the copy is true given that gate. This is a precondition the copy depends on and not a defect in this phase. Phase 200's rename work should keep it. Flagged, not counted against the score.
- **Retired `/demo` for a signed-in user** gets Next's 404 (the proxy leaves it alone, pinned by `proxy.test.ts`); for a signed-out visitor, the login redirect. Both are what an unknown URL gets. REQUIREMENTS ROUTE-03's "same answer as an unknown URL" holds in both states. Review IN-04 records that an old shared `/demo` link therefore lands a signed-out visitor on the login form; the founder accepted that.
- The orchestrator's two known failing tests (`compute.conventions` FROZEN B and C) are outside this phase's fence (Phase 193) and fail the same way on main.

### Human Verification Required

#### 1. Home sign-up band layout

**Test:** Open `/` signed out at 390px and at desktop width. Read the "Verify your track record" band.
**Expected:** No horizontal scroll; the exchange list and the key-storage sentence wrap inside the band; "Create an account" is at least 44px tall; the band looks finished.
**Why human:** Layout, and the e2e reflow backstop has not run on this branch.

#### 2. `/security` At Rest cell layout

**Test:** Open `/security` at 390px and at desktop width. Read the At a glance table.
**Expected:** The In Transit and At Rest cells wrap inside their cells; no horizontal page scroll.
**Why human:** Layout.

#### 3. Lighthouse floor on this branch's code

**Test:** Read this PR's own `lighthouse-mobile` run (floor 0.82).
**Expected:** Medians for `/`, `/security`, `/for-quants`, `/browse` at or above 0.82.
**Why human:** Needs CI. Not measured on this branch.

#### 4. Playwright and seeded e2e lanes

**Test:** Let the PR's e2e jobs run.
**Expected:** Green, with no `/demo` test collected.
**Why human:** Needs a built app and a seeded env.

### Gaps Summary

No gap. Every roadmap success criterion, as amended by D-11, is met in code and pinned by a gate that I saw fail when its input was broken. The phase stays `human_needed` until a person or CI has looked at the layout and the Lighthouse floor. A passed verdict stays historical per the repo rule; drift is read from `scripts/verification-drift-report.mjs`.

---

_Verified: 2026-11-07_
_Verifier: Claude (gsd-verifier)_
