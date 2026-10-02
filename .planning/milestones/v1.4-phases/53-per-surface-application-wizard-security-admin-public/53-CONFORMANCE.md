---
phase: 53-per-surface-application-wizard-security-admin-public
plan: 07
artifact: per-surface-conformance-record
requirement: BP-02
status: PASS
generated: 2026-06-29
---

# Phase 53 — Per-Surface DESIGN.md Conformance Record (BP-02)

> The phase exit gate. Certifies that every Phase-53 surface conforms to the same evolved system
> (DESIGN.md refreshed P49 + the fluid `--text-*` spine + the fixed 4px ladder + the P50 primitives) —
> the "no two apps" guard against legacy-vs-evolved drift. Each surface passes the 7-point conformance
> check (53-UI-SPEC §Per-Surface Conformance Exit). Evidence is a test name, a grep result, or a SUMMARY
> row — never an assertion without a backing fact.

## Gate Suite Results (run 2026-06-29, branch v1.4-p53-54-frontend-excellence @ 29393c89)

| Gate | Command | Result |
|------|---------|--------|
| Full unit suite | `npm run test` (= `vitest run`) | **605 files / 7164 tests passed, 288 skipped, 0 failed** (exit 0) |
| Coverage ratchet (BLOCKING `frontend-coverage`) | `npm run test:coverage` | **PASS** — stmts 82.94 ≥ 80 · branches 75.62 ≥ 72 · functions 79.21 ≥ 74 · lines 85.11 ≥ 82 (exit 0, no threshold violation) |
| Lint + route guards | `npm run lint` | **0 errors**, 263 warnings (all repo-wide `warn`, **zero on any P53 `error`-ratcheted glob**); `[check-route-contract] OK — 56 page routes`; `[check-admin-route-manifest] OK — 20 admin routes` |
| Frozen-spine guard | `npx vitest run src/__tests__/phase-52-frozen-spine-guards.test.ts` | **9/9 passed** — scenario.ts / compute.ts / EquityChart math islands zero-diff |
| E2E (wizard-axe + reflow-sweep-authed) | `npx playwright test` | **Deferred-to-CI** — sandbox is network-free + the specs are `HAS_SEED_ENV`-gated (Supabase service-role + seeded test project). Verified: `--list` enumerates 3 wizard-axe cases incl. the new CSV-branch Review-step walk; a run of the api-branch case **skips** (env-gated), not fails. The CI `frontend-coverage`/playwright job is the authoritative e2e gate. |

Coverage actuals (82.94 / 75.62 / 79.21 / 85.11) sit at or above the prior measured baseline; the per-surface
route-state + test co-commits (every new `loading.tsx`/`error.tsx` shipped with a render test) held the ratchet.

## 7-Point Per-Surface Conformance

Points: **1 Type** (named tiers, glob `error`, ≤4 tiers/2 weights) · **2 No-clip** (audit clips recovered,
none relocated, legit clips intact) · **3 Color** (no hex in JSX, accent reserved-for, empty=neutral) ·
**4 Spacing** (4px ladder + documented exceptions, 44px targets) · **5 State** (loading/error where required,
honest degenerate, no blank flash, no fabricated data) · **6 Responsiveness** (320→2560 no clip/overlap/
h-scroll, `@container` parent/child, `tabular-nums`) · **7 Boundaries** (no frozen island RSC-ified,
PUBLIC_ROUTES + route-contract green, coverage green).

### Surface 1 — Manager API-key Wizard (`strategies/new/wizard/**`, `strategies/new`, `strategies`)

| # | Point | Verdict | Evidence |
|---|-------|---------|----------|
| 1 | Type | **PASS** | 13 files migrated to form-category tiers (page-title/h3/body/caption + micro badge); `no-raw-font-px` `error` on `strategies/new/**`; `grep text-[Npx]/named-scale strategies/new/ = 0` (53-02 SUMMARY) |
| 2 | No-clip | **PASS** | Wizard surface carries no audit accidental-clip site; review recap wraps entered values; no clip relocated |
| 3 | Color | **PASS** | Accent restricted to primary CTA + focus border + active broker card (reserved-for list); inline field errors `text-negative`; per-field NOT `role="alert"` (envelope is the lone alert) — `ReviewStep.test.tsx`/`MetadataStep.test.tsx` |
| 4 | Spacing | **PASS** | WizardChrome ladder unchanged; 44px touch targets preserved on form fields |
| 5 | State | **PASS** | `wizard/loading.tsx` (WizardChrome-shaped skeleton + `role=status`) + `wizard/error.tsx` (digest-only, `unstable_retry`, never `error.message`) + `strategies/error.tsx`; review recap shows ONLY entered values, em-dash only for absent OPTIONAL fields (no fabricated zero) — 53-01 + 53-02 SUMMARYs, 12 + 10 tests |
| 6 | Responsiveness | **PASS** | Narrow readable measure preserved (does NOT fluid-fill); v1.3 single-column stepper reflow intact; DashboardChrome keeps `/strategies` narrow (`max-w-7xl`) — `DashboardChrome.test.tsx` not-widened negative case retargeted onto `/strategies`. Live 320→2560 row deferred-to-CI (reflow-sweep). |
| 7 | Boundaries | **PASS** | WizardClient state machine / autosave / `finalize-wizard` POST FROZEN: `git diff finalize-wizard = EMPTY`; 71-test behavioral baseline green; `WizardStepKey` extension additive + safe-degrading (localStorage.test.ts); no frozen island RSC-ified |

### Surface 2 — /security + Marketing Bodies (`(marketing)/security`, `(marketing)/**` bodies, `(auth)/**`)

| # | Point | Verdict | Evidence |
|---|-------|---------|----------|
| 1 | Type | **PASS** | /security 31 raw tokens → 4 prose tiers (page-title/h2/body/caption); 6 marketing bodies migrated; `no-raw-font-px` `error` per-file on the 8 bodies + `(auth)/**`; tier census ≤4 + hero(landing)/micro(badge) exceptions (53-03 SUMMARY) |
| 2 | No-clip | **PASS** | Two accidental `/demo` `line-clamp-2` description clips recovered via `break-words` wrap; no clip relocated; static scan found no overflow class (`whitespace-nowrap`/fixed width) introduced |
| 3 | Color | **PASS** | Pure token swaps; the 6 `/security` persistent-underline accent links (WCAG 1.4.1, P48) preserved; no new hex |
| 4 | Spacing | **PASS** | Prose bodies on the existing ladder; P51 shell measure untouched |
| 5 | State | **PASS** | Static/RSC prose — no async data gap → no route-state files needed (53-UI-SPEC matrix); `(auth)` reuses `(auth)/error.tsx` |
| 6 | Responsiveness | **PASS** | P51 shell owns the outer measure; body conforms within it; change is type-token swaps on static prose (overflow risk reduced by the clip→wrap). Live 320px row deferred-to-CI. |
| 7 | Boundaries | **PASS** | P51 shell/masthead/LegalFooter + nested `legal/layout.tsx`/`demo/layout.tsx` byte-unchanged (git diff = page bodies + eslint only); PUBLIC_ROUTES unchanged + `proxy.ts` byte-unchanged; route-contract green |

### Surface 3 — Admin (`(dashboard)/admin/**` page + sub-pages, `components/admin/**`)

| # | Point | Verdict | Evidence |
|---|-------|---------|----------|
| 1 | Type | **PASS** | Admin page tree (~11 files) + `components/admin` (~13 files) migrated to data-category tiers (h3/body/small/caption + micro); `no-raw-font-px` `error` on `admin/**` + `components/admin/**` (P06 flip, injection-probe-verified); `grep = 0` (53-05/53-06 SUMMARYs) |
| 2 | No-clip | **PASS** | partner-pilot allocator name / **email (mid-clip unrecoverable)** / staged-strategy / status·manager all gain `title=`; dense-table clips (mandate, reason, founder-note) `title=`-recovered inline during the @container restructure; legitimate `ComputeJobsTable`/`compute-jobs` clips kept their recovery affordance (53-05 SUMMARY) |
| 3 | Color | **PASS** | Token-only; access-gated staff surface; empty branches via `EmptyStateCard` (neutral, no red/warning); no new hex |
| 4 | Spacing | **PASS** | `--row-h`/`--density-pad` dense-table tokens preserved; 44px action-button targets intact |
| 5 | State | **PASS** | Shared `admin/loading.tsx` (data-table-anchored skeleton + `role=status`) + `admin/error.tsx` (digest-only, `unstable_retry`, message-never-rendered T-53-09); honest empties preserved (no fabricated rows) — 8 render tests green |
| 6 | Responsiveness | **PASS** | Falsifiable parent/child `@container` reshape on all three admin tables (ComputeJobsTable, MatchQueueIndex, AllocatorMatchQueue) — host is a **strict ancestor** of every `@`-variant cell (mutation-verified RED when moved onto a cell, #551 guard), `tabular-nums` preserved; fluid-fill → `max-w-[1920px]` via `DashboardChrome.isWide` (`admin` in the regex). **Admin ultra-wide e2e gap documented below.** |
| 7 | Boundaries | **PASS** | No frozen island RSC-ified; access gate (`redirect("/login")` → `isAdminUser`) intact; `isFullBleed` match-detail carve-out regex byte-unchanged (T-53-15); route-contract + admin-route-manifest green; coverage green |

### Surface 4 — /portfolios (`(dashboard)/portfolios/**`, `components/portfolio/**`)

| # | Point | Verdict | Evidence |
|---|-------|---------|----------|
| 1 | Type | **PASS** | `components/portfolio/**` (29 files / 133 sites) + portfolios page tree migrated to data tiers (h3/body/small/caption + micro); `no-raw-font-px` `error` on `portfolios/**` + `components/portfolio/**` (P06); `grep = 0` (53-04/53-06 SUMMARYs) |
| 2 | No-clip | **PASS** | Card name + manage strategy name → `break-words min-w-0`; DocumentList title → single-line `title=` (preserves Badge+Download row alignment); MorningBriefing dek `line-clamp-3` → `title=` recovery; `PortfolioOptimizer` strategy_id legit clip preserved; list-description `line-clamp-2` kept (whole card is a Link, detail one click away — audit rec #3) |
| 3 | Color | **PASS** | Token-only; empty states (`no portfolios`/`no strategies`/`no documents`) via `EmptyStateCard` (neutral); no new hex |
| 4 | Spacing | **PASS** | Card/table ladder unchanged; dense-table density tokens preserved |
| 5 | State | **PASS** | 4 routes × (`loading.tsx` + `error.tsx`): list SkeletonCard-grid, `[id]`/`[id]/manage` name-header+KPI anchor, `[id]/documents` two-column; all `error.tsx` digest-only (T-53-13); access gate intact — 7 render tests + 175-test portfolio suite green |
| 6 | Responsiveness | **PASS** | Fluid-fill → `max-w-[1920px]` via `DashboardChrome.isWide` (`portfolios` in the regex, asserted incl. `/portfolios/abc/manage`); cards/holdings reshape; `tabular-nums` preserved. Live 320→2560 row deferred-to-CI (reflow-sweep). |
| 7 | Boundaries | **PASS** | No frozen island RSC-ified; server-fetch stays in `page.tsx` (so `loading.tsx` renders); route-contract green; coverage green |

### Surface 5 — (auth) Pages (`(auth)/**` — login, signup, forgot/reset-password, onboarding, pending-approval)

| # | Point | Verdict | Evidence |
|---|-------|---------|----------|
| 1 | Type | **PASS** | `(auth)/**` confirmed 0 raw `text-[Npx]`/`fontSize:px` then ratcheted to `no-raw-font-px` `error` (53-03 SUMMARY) |
| 2 | No-clip | **PASS** | Centered-card prose/form; no audit accidental-clip site on the auth surface |
| 3 | Color | **PASS** | Accent on focus border + primary CTA only; no new hex |
| 4 | Spacing | **PASS** | Centered-card ladder unchanged; 44px form-field targets preserved |
| 5 | State | **PASS** | `(auth)/error.tsx` present (reused); per-page `loading.tsx` only where a real async gap exists (most auth pages are static/instant — 53-UI-SPEC matrix) |
| 6 | Responsiveness | **PASS** | Existing centered narrow-card pattern preserved; no fluid-fill (DashboardChrome doesn't widen auth/`/strategies`) |
| 7 | Boundaries | **PASS** | No frozen island; PUBLIC_ROUTES/route-contract green; coverage green |

## Admin Ultra-Wide E2E Gap (documented — Pitfall 7)

Admin ≥1920 responsiveness is **proven via component Vitest + this conformance check, NOT an e2e reflow row**:

- **Why no e2e:** the `reflow-sweep-authed` seed stamps `role='allocator'`; `/admin` redirects non-admins, so an
  allocator-seeded sweep would either redirect away (no admin DOM scanned) or false-green (Pitfall 7). The
  milestone's falsifiability discipline (the #551 false-pass lesson) rejects a class-string/false-green proof.
- **What proves it instead:** (a) `DashboardChrome.test.tsx` asserts `/admin` (+ `/admin/compute-jobs`) resolve
  to `max-w-[1920px]` (fluid-fill wiring); (b) the three falsifiable parent/child `@container` structural tests
  (host strict-ancestor of `@`-variant cells, `tabular-nums` preserved, mutation-verified) prove the tables
  reshape without same-element `@container` freeze; (c) this 7-point record.
- **Deferral:** an **admin-seeded** e2e reflow row requires a hermetic admin seed and is a **Phase-54** concern
  (BP-03 / app-wide verification), not a Phase-53 gap.

## Verdict

**ALL FIVE SURFACES PASS the 7-point DESIGN.md-conformance check.** Full unit suite (7164 tests) +
coverage ratchet (82.94/75.62/79.21/85.11, all ≥ threshold) + lint (0 errors, P53 globs at `error` and clean)
+ frozen-spine guard (9/9, math islands zero-diff) are GREEN. PUBLIC_ROUTES + route-contract + admin-route-
manifest green. E2E (wizard-axe + reflow-sweep-authed) is deferred-to-CI by the network-free + seed-gated
sandbox; the admin ultra-wide e2e gap is documented and Phase-54-deferred. No FAIL papered over.

This certifies the milestone-wide invariants held through the per-surface work: **math frozen** (frozen-spine
9/9), **WCAG-AA floor** (axe specs in the CI suite + per-surface a11y tests), **no-invented-data** (honest
degenerate states, review recap shows only entered values), **PUBLIC_ROUTES** (byte-unchanged). Ready for the
human-verify checkpoint and `/gsd:verify-work`.
