---
phase: "199"
slug: "managerhome-each-role-lands-on-its-own-page-and-a-manager-has"
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 2
block_on: high
created: "2026-11-10"
---

# Phase 199 - Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> Verified against code at worktree HEAD `4e24cfa90` (phase base `9bc83f894`), diff scope
> `git diff 9bc83f894..HEAD -- . ':!.planning'`. Every mitigation below was found in code, not in
> a SUMMARY. `asvs_level` and `security_block_on` are not set in `.planning/config.json`, so this
> audit used L2 depth (the mitigation must sit at the right boundary) and the default `block_on: high`.

**Verdict: SECURED. 34 of 34 threat rows closed (33 STRIDE threats plus the repeated T-199-SC), 0 open, `threats_open: 0`.**

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| query string / props to navigation | `?redirect=`, `?next=`, the `redirectTo` prop and `?from=` become navigation targets or link hrefs | untrusted strings |
| session cookie to `/home` | the proxy sees only a cookie; `/home` reads `profiles` under RLS and redirects by role | role, approval, admin flag |
| signed-in allocator to manager routes | the `/strategies` index widened to every owner; `/strategies/new/**` and `/strategies/[id]/**` must not | role-gated surfaces |
| signed-in non-admin to admin pages | guards keep `isAdminUser`; only the bounce target changed | admin surfaces |
| server props to client table | manager furniture (Edit, actions, intro requests) is decided by props the server builds per role | per-role controls |
| owner data to recipient / public views | share and public factsheet pages must not reveal owner key identity | key label, seq, venue |
| DB key columns to page | key-status read is an explicit column allowlist | `api_keys` columns |

---

## Threat Register

Severity is the PLAN.md value. Status is `closed` for every row.

| Threat ID | Category | Severity | Disp. | Evidence (file:line, verified in code) | Status |
|-----------|----------|----------|-------|----------------------------------------|--------|
| T-199-01 | Spoofing (open redirect, CWE-601) | high | mitigate | One sanitiser `safeRedirectPath` = string, `/`, lowercase letter (`src/lib/routing/role-home.ts:45`). Used on all three paths: login page (`src/app/(auth)/login/page.tsx:25`, `:32` covers the `?code=` exchange branch that used to be `params.redirect \|\| "/onboarding"`), LoginForm re-check (`src/components/auth/LoginForm.tsx:38`), proxy bounce (`src/proxy.ts:171`). Hostile-value matrices (`//host`, absolute URL, `/\host`, uppercase, array) in `role-home.test.ts`, `LoginForm.test.tsx`, `proxy.test.ts`; e2e `role-home.spec.ts` asserts the off-origin value lands on `/allocations`. Strictly tighter than the pre-existing `/auth/callback` `safeNextPath` (which is unchanged and also sound). | closed |
| T-199-02 | Elevation of privilege | medium | mitigate | `requireRolePage` now calls `roleSurfaceHome(role)` (`src/lib/auth/requireRolePage.ts:~118`). The map is identical for every reachable input: manager to `/strategies`, allocator to `/allocations`, anything else to `/pending-approval`. `both` is added to the map but `owns` is true for `both` on either surface, so it never redirects. The `owns` predicate (`:101-104`) is untouched; redirect stays outside any try/catch. | closed |
| T-199-03 | Repudiation (misleading status) | low | mitigate | `src/lib/strategy-health.ts:105` makes the one `listSeriesVerdict` call (no threshold typed in the file); first-match order; last row `keyStatusUnreadable ? not_judged : healthy` (`:111`), so an unreadable key never claims Healthy. The 8-10 day non-crypto residual is documented in the file header and was accepted in the plan. | closed |
| T-199-04 | Information disclosure | low | mitigate | Key labels are built only by `apiKeyLabelById` over the owner's keys (`strategies/page.tsx` key-label block after the owner-scoped `api_keys` read); DegradeLine renders labels as text nodes (no `dangerouslySetInnerHTML` anywhere in the phase's `.tsx` diff). | closed |
| T-199-05 | Repudiation (silent unregistered warning) | medium | mitigate | `src/__tests__/degrade-warning-scan.test.ts` carries `SCAN_LEDGER` (`:93`): per-file hit count and ids; unledgered file, changed count and orphan registry entry each fail; vacuity floor present. | closed |
| T-199-06 | Repudiation (scope hidden) | low | mitigate | `WHOLE_HISTORY_IDS` count-pinned at 10 (`src/lib/degrade-warnings.test.tsx:371`), only ids on it may carry `whole_history` scope (`:337`). | closed |
| T-199-07 | Repudiation (unregistered warning) | medium | mitigate | The ledger walks the whole `src/app/(dashboard)/allocations` tree (scan-test header `:29-38`); the named 196 deferral set was emptied by 199-15. | closed |
| T-199-08 | Denial of service (redirect loop) | high | mitigate | `/home` is in `PUBLIC_ROUTES` (`src/proxy.ts:19`) and in `isAuthBounceExempt` (`:124`, `:160`), so a signed-in GET is never bounced to its own fallback. `/home` decides admin with the same `isAdminUser` call the admin guards make (`src/app/home/page.tsx:80`), with no separate `is_admin` short-circuit. Terminal fallback `/pending-approval` is unguarded. Proxy test pins both the exemption and the literal. | closed |
| T-199-09 | Information disclosure | medium | mitigate | `/home` throws on a profile read error (`page.tsx:62`), on a missing row (`:75`), and on an admin read error (`:89`); it never redirects on a guess. Review-round fix confirmed: `isAdminUser(..., { strict: true })` (`src/lib/admin.ts:296-310`; `if (strict) throw error` at `:191`, `:231`) so a DB blip cannot be read as "not admin". RLS rejection (42501) and absent profile still answer false. Signed-out visit only redirects to `/` and renders nothing. | closed |
| T-199-10 | Elevation of privilege | medium | mitigate | All 13 admin server `page.tsx` files keep `if (!user) redirect("/login")` then `if (!(await isAdminUser(supabase, user))) redirect(ROLE_HOME_ROUTE)` (e.g. `src/app/(dashboard)/admin/page.tsx:22-23`, `users/[id]/page.tsx:69-70`); predicate unchanged, fail-closed default kept. Only the bounce target changed. | closed |
| T-199-11 | Information disclosure | medium | mitigate | `editHref` and `actions` exist only when `isManager` (`strategies/page.tsx:1303-1304`); the New Strategy CTA, wizard-draft banner and intro list are all `isManager`-gated; an allocator-only viewer makes no `contact_requests` read (`:644`). `StrategyTable` renders furniture only from `managerRows` entries. | closed |
| T-199-12 | Elevation of privilege | high | mitigate | Own guard layouts: `strategies/new/layout.tsx` and `strategies/[id]/layout.tsx` each call `requireRolePage(supabase, user, "manager")` at top level outside any try/catch, with `force-dynamic`. They cover `new/page.tsx`, `new/wizard/page.tsx`, `[id]/edit/page.tsx` (the only three non-index pages, measured). `src/__tests__/strategies-guard-coverage.test.ts` walks every non-index page and fails naming it when no own manager layout exists; MIN floor of 3 prevents a vacuous walk. | closed |
| T-199-13 | Information disclosure | high | mitigate | Widened index read is owner-scoped: `.eq("user_id", user.id)` (`strategies/page.tsx:539`, wizard-draft read `:581`); analytics join uses the explicit `CATEGORY_RANKING_ANALYTICS_COLUMNS` allowlist, never `(*)`. Page and layout are `force-dynamic`; merged test asserts the user_id predicate per role (`page.merged.test.tsx:384`). RLS is the backstop. | closed |
| T-199-14 | Information disclosure | medium | mitigate | Same build site as T-199-11: Edit target, actions and intros are built only when `isManager`; `role` comes from a `profiles.role` read keyed on `user.id` (`:478-480`). Per-role tests in `page.merged.test.tsx` and `StrategyTable.owner-list.test.tsx`. | closed |
| T-199-15 | Spoofing (role guess) | medium | mitigate | A `profiles` read error is logged, captured and thrown (`strategies/page.tsx:493`); a missing row throws (`:505`); an unknown role is denied by default via `redirect(roleSurfaceHome(role))` (`:510-511`). No path defaults a role. | closed |
| T-199-16 | Spoofing (origin param) | medium | mitigate | `parseOrigin` maps a `from` value through the closed `LEGACY_ORIGIN_KEYS` using own-property membership (`src/lib/factsheet/origin.ts:64`, `:101`), then requires `isOriginKey` membership in `FACTSHEET_ORIGINS` (`:102`); hrefs come only from the map. `__proto__`, `constructor`, near-miss values pinned in `origin.test.ts`. | closed |
| T-199-17 | Tampering (route contract drift) | low | mitigate | `next.config.ts` `/my-strategies` to `/strategies` (permanent) with manifest `redirectFrom` byte-equal; `scripts/check-route-contract.ts` Rule 3 enforces the match (`:423`); the page directory is deleted (verified absent). 308 runs before the proxy but only moves to a session-gated destination; query string passes through, no data is served. | closed |
| T-199-18 | Information disclosure | medium | mitigate | `KEY_STATUS_COLUMNS = "id, exchange, label, sync_status, sync_error, last_sync_at"` (`strategies/page.tsx:94`): `label`, `sync_status`, `sync_error`, `last_sync_at` are all in `API_KEY_USER_COLUMNS_ARR` (`src/lib/constants.ts`); no encrypted column. Key ids come from the owner's own strategies; request-scoped client under RLS. | closed |
| T-199-19 | Repudiation (false status) | low | mitigate | Server clock passed in (`nowMs`); `keyStatusUnreadable` set on any failed `strategy_keys` or `api_keys` read (`page.tsx:~700-725`) and fed to the health derivation, which then returns `not_judged`, never Healthy. | closed |
| T-199-20 | Repudiation (false definition) | low | mitigate | Legend thresholds interpolate `SERIES_STALE_DAYS` and `SERIES_STALE_DAYS_TRADITIONAL` imported from `@/lib/freshness` (`StrategiesLegend.tsx:47-88`), so the copy cannot drift from the ladder. | closed |
| T-199-21 | Repudiation (surfaces disagree) | low | mitigate | Scenario and My allocation share registry entries; `scenario-factsheet-parity-guard.test.ts` is the parity case. | closed |
| T-199-22 | Information disclosure | high | mitigate | `FactsheetBody` computes `ownerView = !recipientShare && (ownerShare !== undefined \|\| layout === "full")` (`FactsheetView.tsx:500`). `FactsheetView` hard-codes `layout="document"` (`:418`), and `ownerShare` is passed only when `lane === "owner"` (`v2/page.tsx:1098`). The only `layout="full"` mounts are `AllocationDashboardV2` and `ScenarioFactsheetChart`, both under the role-guarded `/allocations` over the viewer's own data; `/scenario-share` mounts neither. Non-owner views get registry entry `factsheet.degraded-members-recipient`, which takes no arguments and names no key, venue or count (`degrade-warnings.ts:1114-1125`). Privacy arm in `degrade-warnings.test.tsx:334` and `:1034`. Net effect versus base: the old line named `Key N (venue)` to every viewer; it now names it to the owner lane only. | closed |
| T-199-23 | Repudiation (unproven landing) | medium | mitigate | `e2e/role-home.spec.ts` is in the seeded Playwright list (`.github/workflows/ci.yml:7061`) and bound by the count pin in `src/__tests__/e2e-seeded-hydration-guard.test.ts`. | closed |
| T-199-24 | Spoofing (open redirect regression) | medium | mitigate | e2e deep-link case asserts the exact same-origin pathname `/compare` (`role-home.spec.ts:73`) and the off-origin case asserts `/allocations` with hostname not the attacker's (`:85-87`). | closed |
| T-199-25 | Repudiation (read failure shown as empty) | medium | mitigate | `placeholderKeysUnreadable = bareKeys === null` (`strategies/page.tsx:946`) renders the failure line (`:1433`) and suppresses the empty state (`:1461`). | closed |
| T-199-26 | Repudiation (unregistered warning) | medium | mitigate | Same scan test: list-surface walk, pinned exclusions, unledgered file fails. | closed |
| T-199-27 | Information disclosure | low | mitigate | `readOwnerComputeJobs` is called only with the session client and the viewer's own row ids (`strategies/page.tsx:231`, `:1046`); the RPC resolves `auth.uid()` server-side. A failed read yields the unreadable arm with `jobDay: null`, never another row's day. | closed |
| T-199-28 | Denial of service (redirect loop) | high | mitigate | Guard side of T-199-08: guards and `/home` share `isAdminUser`; census/role-home call-site tests (`src/__tests__/role-home-call-sites.test.ts`) pin the home sites. Role surfaces never redirect to each other (`both` owns both). | closed |
| T-199-29 | Elevation of privilege | high | mitigate | The parent `strategies/layout.tsx` now only checks the session (`redirect("/login?redirect=/strategies")`), calls no `requireRolePage`, and is `force-dynamic`; the removal happened only after plan 04's own layouts existed. Negative arm in `strategies-guard-coverage.test.ts` fails if the parent or the index page calls `requireRolePage` again. | closed |
| T-199-30 | Information disclosure | high | mitigate | Same as T-199-13: new reads (`getStrategylessActiveKeys(user.id)`, `getRealPortfolio(user.id)`, own-row percentiles) take only the session user id (`page.tsx:944`); owner scope and RLS backstop unchanged. | closed |
| T-199-31 | Repudiation (false statement on the page) | medium | mitigate | `D10_FORBIDDEN = /\b(return\|risk)\b/i` judge over every `whole_history` book-level sample (`degrade-warnings.test.tsx:264-275`, `:401`), with a vacuity guard (`:272`) and a negative self-test (`:659`). | closed |
| T-199-32 | Repudiation (a link whose label lies) | low | mitigate | Discovery-labelled links (`BackLink.tsx`, `BrowseDiscoveryLink.tsx`, `origin.ts:119`) now import `DISCOVERY_LANDING_ROUTE`; home sites import `ROLE_HOME_ROUTE` (`src/lib/routing/default-route.ts`); census in `role-home-call-sites.test.ts`. Review-round fix confirmed: error-boundary escape links on `error.tsx`, `admin/error.tsx` and `allocations/error.tsx` leave the failing surface via `DISCOVERY_LANDING_ROUTE`, and `strategies/error.tsx` goes to `/profile`, so no boundary links back into the surface that threw. | closed |
| T-199-33 | Repudiation (wrong back link) | low | mitigate | `StrategiesSection` takes `origin: FactsheetOrigin` as a required prop (`StrategiesSection.tsx:75`); the page sets `origin={{ key: "strategies" }}` (`strategies/page.tsx:1520`). | closed |
| T-199-SC | Tampering (npm installs, 18 plans) | low | accept | `git diff 9bc83f894..HEAD --stat -- package.json package-lock.json analytics-service/requirements*.txt` is empty: no manifest or lockfile changed in the phase. | closed |

*Status: open, closed, open - below high threshold (non-blocking)*
*Severity: critical > high > medium > low. Only open threats at or above `block_on` count toward `threats_open`.*
*Disposition: mitigate (implementation required), accept (documented risk), transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-199-01 | T-199-SC | No dependency or lockfile change in the phase, so there is no supply-chain surface | all 18 plan threat registers | 2026-11-10 |
| AR-199-02 | T-199-03 (residual) | The factsheet chip's 3d/7d ladder can still call an 8-10 day non-crypto row stale while the list reads Healthy; display-honesty only, no data or access effect | plan 199-02 threat register | 2026-11-10 |
| AR-199-03 | T-199-17 (residual) | A 308 is cached by browsers, so reverting the `/my-strategies` rule does not reach visitors who already followed it; the destination is session-gated and nothing sensitive is in the redirect | founder, CONTEXT D-01 | 2026-11-10 |
| AR-199-04 | T-199-08 (residual) | A DB read that flaps between two requests can still bounce a user between `/home` and a refused admin page, one wrong landing at a time; a sustained failure ends at the error boundary. Documented in the `/home` docblock | review round fix | 2026-11-10 |

*Accepted risks do not resurface in future audit runs.*

---

## Unregistered Flags (informational, none blocking, none counted in `threats_open`)

SUMMARY `## Threat Flags` sections across all 18 summaries: every one reads "None" or maps to a registered threat. The diff scan found no open redirect, no fail-open guard and no wrong-role data exposure. Observations the register did not name:

| Flag | Severity | Observation | Disposition |
|------|----------|-------------|-------------|
| UR-199-01 | low (advisory) | The manager role gate on `/strategies/new`, `/strategies/new/wizard` and `/strategies/[id]/edit` lives only in layouts. The Next version's own docs (`node_modules/next/dist/docs/01-app/02-guides/authentication.md`) warn that layouts are not re-checked on every navigation and "do not control whether the rest of the route renders". The base layout guard had the same shape (Phase 109), so this is not a regression, and it is exactly the posture T-199-12 specified. Backstops seen: the edit page re-checks `.eq("user_id", user.id)`; reads run under RLS. Whether each manager-only write API route enforces its own role was NOT re-audited in this pass (the plans state they do). | Advisory: a future phase could add an in-page `requireRolePage` call on the three pages; not required to ship. |
| UR-199-02 | info | `admin/partner-import` and `admin/partner-roi` are client pages with no page-level `isAdminUser` guard. Not in the phase diff. The only data path (`/api/admin/partner-import`) enforces `isAdminUser` (`route.ts:389`); `partner-roi` makes no fetch. | Pre-existing, out of scope. |
| UR-199-03 | info | `redirect(redirectTo)` in the login page and `router.push(...)` in LoginForm accept any string that starts with `/` plus a lowercase letter, with no control-character strip. This cannot leave the origin (the first two characters fix a same-origin path), so it is not an open redirect; header-character handling is the runtime's. | Hardening note only. |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-11-10 | 34 | 34 | 0 | gsd-security-auditor (ASVS 2, block_on high): SECURED. Read-only audit of the merged tree; no build, test run or stack was started, so test-file evidence is by presence and content, not by execution. |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-11-10
