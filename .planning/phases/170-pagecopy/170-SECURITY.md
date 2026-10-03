---
phase: 170
status: SECURED
threats_open: 0
audited_at_sha: 3112caa490b63cfba5d03fe241045be913587373
asvs_level: 1
block_on: high
---

# Phase 170 (LAYOUT): security threat verification

Built from the `<threat_model>` blocks of `170-01` to `170-20-PLAN.md` (no prior register).
`.planning/config.json` has no security block, so the defaults apply: ASVS L1, `block_on: high`.
Code audited: `git diff $(git merge-base origin/main HEAD)..HEAD -- src e2e` at the sha above,
plus the round-1 review-fix surface. Per the audit brief, this file reports MEDIUM and above.

**Register:** 51 threats (T-170-01 to T-170-50, plus T-170-SC). 23 are medium or high; the 28 low
ones (all `accept` or class-level `mitigate`) are not itemised here. **Blocking open: 0.**

## Threat verification (medium and above)

| Threat ID | Category | Severity | Disposition | Status | Evidence |
|-----------|----------|----------|-------------|--------|----------|
| T-170-01 | Repudiation (false-green gate) | high | mitigate | CLOSED | `e2e/helpers/reflow.ts` `assertNoReflow(page, anchorSelector)` takes no options, so there is no bypass flag. It throws on `mainSlop > 1 \|\| docSlop > 1` whatever the offender walk names. Self-test RED fixtures are in `e2e/reflow.spec.ts` ("assertNoReflow helper self-test"), and the neuter is recorded in `170-01-SUMMARY.md`. |
| T-170-04 | Tampering (shared TEST) | medium | mitigate | CLOSED | `e2e/layout-narrow.spec.ts` `NAME_PREFIX` is per worker (`TEST_PARALLEL_INDEX`), and cleanup goes only through `cleanupStrategiesByNamePrefix(NAME_PREFIX)`. As shipped, the prefix is per worker, NOT per run. Cross-run isolation comes from the `e2e-seeded` job holding the shared-TEST session advisory lock for the whole run (`ci.yml` step `Acquire shared-test-db mutex`). The prefix has no trailing delimiter, so it is unsafe at 10 or more workers. CI runs `workers: 1` (`playwright.config.ts`), so this is informational. |
| T-170-06 | Repudiation (false-green seeded spec) | high | mitigate | CLOSED | FLOW-01 place 1: `layout-narrow.spec.ts` is in the `e2e-seeded` list in `ci.yml`. Place 2: the `HAS_SEED_ENV` skip in the spec. Positive control: `/admin/match — N-MATCH` "V960: at least one write control is visible". Each row opens with an anchor `toBeVisible` gate inside `assertNoReflow`. |
| T-170-08 | DoS (UI, primary action unreachable) | medium | mitigate | CLOSED | The seeded `N-FOOT` / `N-TWEAKS` / SC2-(a) describes in `e2e/layout-narrow.spec.ts`. The `e2e-seeded` run recorded in `170-20-SUMMARY.md` passed every layout row and printed no `LAYOUT-NARROW-OFFENDER` line. |
| T-170-10 | DoS (UI, Commit unreachable) | medium | mitigate | CLOSED | `ScenarioFooter.tsx` action group with the `N-FOOT` geometry row (in viewport, 44 px, not covered). Unit cases are in `ScenarioFooter.test.tsx`. |
| T-170-14 | Repudiation (contrast gate) | medium | mitigate | CLOSED | `tests/a11y/chip-contrast.test.ts` reads `src/app/globals.css` and the real chip source pairs, and self-checks that muted-on-track stays below 4.5:1. The neuter is recorded in `170-10-SUMMARY.md` "RED and neuter". |
| T-170-16 | Elevation of privilege (viewport treated as authz) | high | mitigate | CLOSED | `src/app/api/**` is NOT in the phase diff. All 10 handlers under `src/app/api/admin/match/**` still call `isAdminUser` before any work: `[allocator_id]` GET, `allocators` GET, `decisions` POST/DELETE, `eval` GET, `kill-switch` GET/POST, `preferences/[allocator_id]` PUT, `recompute` POST and `send-intro` POST. The new `readOnly` in `AllocatorMatchQueue.tsx` and `PreferencesPanel.tsx` (`handleSubmit` early return, disabled Save) only changes the UI. It is not relied on as a control. |
| T-170-17 | Information disclosure (owner email) | medium | mitigate | CLOSED | `src/app/(dashboard)/admin/page.tsx` embeds `profiles(display_name, email)` only after the `getUser` and `isAdminUser` redirects. It reads through the existing service-role client and adds no API surface. `AdminTabs.tsx` renders it. |
| T-170-20 | Information disclosure (signed-in header in cached HTML) | high | mitigate | CLOSED | `MarketingHeaderActions.tsx` renders only `Sign in`/`Sign up` or `Go to app`, never identity. `MarketingHeaderActions.test.tsx` asserts the user's email and id are absent on both the signed-in and the error paths. No `use cache`, `revalidate` or `cacheLife` is under `src/app/(marketing)` or `src/components/marketing`. **Note:** `/demo` sits inside `(marketing)`, and `next.config.ts` already gives `/demo/:path*` `public, s-maxage=10, stale-while-revalidate=300` with `Vary: Cookie`. So the cookie-driven dynamic rendering does not by itself keep this header out of a CDN-cacheable response. The mitigation holds because the header carries no identity: the worst case is a wrong link label for up to 10 s. |
| T-170-24 | DoS (UI, Disconnect unreachable) | medium | mitigate | CLOSED | Actions wrap in `AllocatorExchangeManager.tsx`. The SC2-PROFILE seeded rows assert in-viewport and not covered. |
| T-170-26 | Repudiation (false-green axe) | medium | mitigate | CLOSED | `e2e/composer-axe.spec.ts` clicks the blend-detail summary and asserts `open === true` before the visibility gates and before `analyze()`. |
| T-170-30 | Repudiation (stale premise) | medium | mitigate | CLOSED | `170-11-SUMMARY.md` records the Phase 169 gate. The first run halted `NOT_REBASED`; the re-run after the rebase was green. |
| T-170-33 | Repudiation (pre-169 edit) | medium | mitigate | CLOSED | `170-12-SUMMARY.md` records the gate re-run (`PAGETRUTH_ON_MAIN_OK`). |
| T-170-35 | Repudiation (unnamed table wrapped) | medium | mitigate | CLOSED | `170-13-SUMMARY.md`: the census named no owning file, so no table was wrapped. No factsheet table wrapper appears in the diff. |
| T-170-36 | Information disclosure (UAT notes) | medium | mitigate | NOT YET REACHED | Plan 170-14 runs after landing by design (`170-VERIFICATION.md`). No 170-UAT.md exists yet, so the guarded surface is absent. Re-audit when 170-UAT.md is written. Not counted. |
| T-170-37 | Repudiation (unbound UAT pass) | medium | mitigate | NOT YET REACHED | Same as T-170-36. Re-audit when 170-UAT.md is written. Not counted. |
| T-170-38 | Repudiation (offender walk) | medium | mitigate | CLOSED | `reflow.ts`: the offsetParent climb and the fixed-box skip change only the naming. The throw stays keyed on the slop alone. Fixture (i) and neuters (a)/(b) are recorded in `170-15-SUMMARY.md`. |
| T-170-40 | DoS (control clipped by ResponsiveTable) | medium | mitigate | CLOSED | `170-16-SUMMARY.md` records an audit of all 11 consumers that found no visible absolute element clipped. `ResponsiveTable.test.tsx` pins the containing block. |
| T-170-41 | Repudiation (unconfirmed overflow fix) | medium | mitigate | PARTIAL, NOT YET REACHED | The walker-naming half is CLOSED (T-170-38). The post-land CI rows half cannot exist before merge: the run cited in `170-20-SUMMARY.md` is pre-land at `cdd7c3b1a`, not HEAD. Re-audit after landing. Not counted. |
| T-170-44 | Repudiation (relaxed test) | medium | mitigate | CLOSED | The `e2e/reflow.spec.ts` "geometry helper self-test (Phase 170 GC-01)" has RED fixtures for wraps and for overflows-without-scroll. `assertNoReflow` still runs on every `layout-narrow` row. |
| T-170-46 | DoS (`/admin/match/<id>` 500) | medium | mitigate | CLOSED | `src/lib/admin/match.ts` uses `castRowOrNull` on both return paths. `match.test.ts` covers the no-batch and batch paths, which both return null. |
| T-170-47 | Repudiation (error hidden as null) | medium | mitigate | CLOSED | `if (preferencesRes.error) throw preferencesRes.error` is untouched. `match.test.ts` "a preferences query error still rejects", and a missing profile still throws through `castRow`. |
| T-170-49 | Tampering (blessing a chart regression) | medium | mitigate | CLOSED | The diff changes exactly 4 PNGs, all `*-portrait-320-chromium-linux.png`. `170-20-SUMMARY.md` records `cmp` over 29 PNGs with 25 identical, including every desktop and ultrawide one, and each changed pair viewed. |

## Round-1 review-fix surface

| Item | Result | Evidence |
|------|--------|----------|
| Admin queue errors go to the error boundary | CLOSED | `admin/page.tsx` logs `{code, message}` server-side and throws `Admin dashboard: <query> query failed`, which carries no row data. `admin/error.tsx` renders `error.digest` only, never `error.message`. |
| MarketingHeaderActions session read | CLOSED | `unstable_rethrow(err)` comes first in the catch. The log is `err.message` only: no user object, token, cookie or email. The anonymous `error` return is not logged. A failed read renders the signed-out links. |
| PreferencesPanel read-only below md | CLOSED | Covered by T-170-16. `PUT /api/admin/match/preferences/[allocator_id]` still enforces `isAdminUser`, and the route is unchanged. |
| `/admin/match` `castRowOrNull` | CLOSED | Covered by T-170-46 and T-170-47. |
| Seed helper `setSeededStrategyNameAndTags` `status` param | CLOSED | Writes go through `getAdmin()`, which calls `assertNotProductionSupabaseUrl` and `assertSupabaseServiceRoleKey` before any write. The update is scoped `.eq("id", strategyId)` to a row the spec just minted under its own prefix. The only runner is the `e2e-seeded` job, under the shared-TEST mutex. |

No `dangerouslySetInnerHTML` or `innerHTML` assignment appears in any changed non-test `src` file.

## Unregistered flags

None. The `## Threat Flags` sections in 170-11, 12, 13, 15 and 16 SUMMARY all read "None" or map to registered IDs.

**threats_open:** 0
