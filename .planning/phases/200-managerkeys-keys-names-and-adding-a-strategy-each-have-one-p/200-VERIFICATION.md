---
phase: 200-managerkeys
verified: 2026-11-11T20:30:00Z
status: human_needed
score: 9/9 must-haves verified (6 original truths re-checked, 3 gap truths closed)
verified_at_sha: 31aec2b150d217a28dadb4e69a098e89ff58f0da
drift_subjects:
  - src/components/strategy/ApiKeyManager.tsx
  - src/components/strategy/ConfirmKeyChangeDialog.tsx
  - src/components/strategy/StrategyNameBlock.tsx
  - src/components/strategy/StrategyForm.tsx
  - src/components/strategy/StrategyTable.tsx
  - src/components/exchanges/AllocatorExchangeManager.tsx
  - src/components/exchanges/ExchangesTabContent.tsx
  - src/components/auth/ProfileTabs.tsx
  - src/components/ui/Modal.tsx
  - src/app/api/keys/feeds/route.ts
  - src/app/api/keys/[id]/memberships/route.ts
  - src/lib/key-feeds.ts
  - src/lib/strategy-display.ts
  - src/lib/status-surface-copy.ts
  - src/app/(dashboard)/strategies/page.tsx
  - src/app/(dashboard)/strategies/[id]/edit/page.tsx
  - src/app/(dashboard)/profile/page.tsx
  - src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx
  - src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.tsx
  - src/app/factsheet/[id]/v2/FactsheetView.tsx
  - src/__tests__/key-storage-census.test.ts
  - src/__tests__/manager-keys-e2e-wiring.test.ts
  - src/__tests__/tap-target-minimums.test.ts
  - e2e/manager-keys.spec.ts
  - e2e/helpers/seed-test-project.ts
  - .github/workflows/ci.yml
behavior_unverified: 0
re_verification:
  previous_status: gaps_found
  previous_score: "6/6 code truths, 3 gaps from the 2026-11-11 measurement"
  gaps_closed:
    - "Panel e2e tests run in a blocking job (plan 200-13): moved to e2e/manager-keys.spec.ts, in the e2e-seeded list, logged in, no self-skip, pinned by manager-keys-e2e-wiring.test.ts"
    - "320px key row legible (plan 200-15, then review rounds 2 and 3: container query @4xl)"
    - "Every ConfirmKeyChangeDialog control meets the target minimum (plan 200-14): shared Modal Close is 44x44"
  gaps_remaining: []
  regressions: []
advisory:
  - finding: "WR-13 (200-REVIEW round 3, MEDIUM, user-facing, pre-dates Phase 200): in the single-line key-row layout (row at or above 56rem), a row in a failed state with a long status helper can squeeze the label column to a few px; the 1280 test's 200px floor measures only a healthy helper-free manager row. The orchestrator is routing it to a follow-up after the 3-round review cap."
    category: other
    reason: "Does not break a Phase 200 truth: the 320px, 768px and 1024px wrapped layouts are measured, the squeeze existed before the phase (the label column was a bare flex-1 min-w-0), and the phase narrowed where it can occur. Evidence is a static harness, not a run of the app."
    evidence_status: "static harness in 200-REVIEW.md, no app measurement"
human_verification:
  - test: "First GitHub Actions run bound to the PR head SHA: confirm the e2e-seeded job ran e2e/manager-keys.spec.ts (14 tests, 0 skipped) and is green, and that the frontend aggregator counted it"
    expected: "14 passed in the e2e-seeded log, aggregator green. A deliberate break of one panel test turns e2e-seeded red"
    why_human: "The PR is not open yet, so the spec has only run on a local seeded stack (14 passed, per plan 200-15). Whether it passes in the CI environment is the confirmation gap 1 still lacks; the wiring (list entry, no continue-on-error, no skip) is verified statically here"
  - test: "UAT at 320px and desktop: /strategies/<id>/edit (Change key..., Rename..., name block with public-name lines) and /profile?tab=exchanges as a manager-only user (feeds lines, Delete key dialog, could-not-check state), plus a dialog header on a phone width after the Modal Close resize"
    expected: "Layout holds, copy reads correctly, feeds lines and dialogs are visible and operable, the Close glyph and header height look unchanged"
    why_human: "No browser on this host; 200-VALIDATION.md lists this as manual-only. Plan 200-14 records that no test compares the glyph position against the old layout"
  - test: "Founder review of defaults recorded as 'orchestrator default, founder may revisit' (D-01..D-15) and D-R1"
    expected: "Founder accepts or revisits, in particular D-06 (merging the key managers onto Profile) and D-R1 (an unchecked feeds read holds Delete key, not Disconnect)"
    why_human: "The founder was unavailable during discuss and review; these are decisions, not code facts"
---

# Phase 200: MANAGERKEYS Verification Report

**Phase Goal:** A manager can see which strategies each key feeds, and nothing re-points a strategy's key without an explicit confirmation. Renaming happens in one place that shows which name is public. Adding a strategy and managing keys each have one entry point, and the security explanation lives in one place.
**Verified:** 2026-11-11, at HEAD `31aec2b15` on `feat/200-gaps` (working tree clean at start and end; byte-copy neuters restored with `cmp`)
**Status:** human_needed (all three gaps closed in code; the first CI run, the manual UAT and the founder-default review remain)
**Re-verification:** Yes, after gap closure (plans 200-13, 200-14, 200-15, plus review fix rounds WR-07..WR-12)

## Gap closure (re-verification)

| Gap | Verdict | Evidence at `31aec2b15` |
|-----|---------|-------------------------|
| 1. Panel e2e tests never run in a blocking job | CLOSED in code; first CI run pending | `.github/workflows/ci.yml:7086` lists `e2e/manager-keys.spec.ts` in the `e2e-seeded` Playwright list (the job the `frontend` aggregator gates on, `ci.yml:3819`); the step range 6502-7226 has no `continue-on-error` (the only hit in that range is a comment at `:6680`). The spec has no `test.skip`, `.skip(`, `.fixme(` or `process.env` (my grep), signs in through `loginAs` with a seeded manager-only user (`seedManagerKeyPanel`), reads `strategies.api_key_id` with the service role, and carries a sibling test proving that read sees a write. The unauthenticated contract tests stay in the old specs, which carry no `storageState`. The old specs' remaining env gate (`PLAYWRIGHT_TEST_STRATEGY_ID`) covers only the 6 analytics tests, not the panel. Gate integrity: I removed the list line from `ci.yml` on a byte copy, `manager-keys-e2e-wiring.test.ts` went RED (`is not in the e2e-seeded list`, 1 failed, 3 passed), restored with `cmp` exit 0. Local seeded run per plan 200-15 SUMMARY: 14 passed. NOT yet run in GitHub Actions (no PR); see Human Verification 1. TODOS.md `[158-OPS-03]` and the ci.yml comment carry the dated CORRECTED note. |
| 2. 320px key row cramped | CLOSED in code; geometry measured locally only | `AllocatorExchangeManager.tsx:1777` and `:1928`: each key list is an `@container`; label column `flex-1 min-w-0 basis-[calc(100%_-_3.5rem)] @4xl:basis-0` (`:1817`, `:1948`), Last sync `@4xl:text-right` (`:1855`, `:1978`). Below 56rem of row width the label takes the line beside the tag and Last sync, status and actions wrap beneath. `e2e/manager-keys.spec.ts` measures real boxes at 320, 768 and 1024 (`:439`, label column reaches the content-box right edge, label not truncated, Last sync below) and at 1280 (`:469`, one line, label column at least 200px). RED proofs are in the 200-15 SUMMARY (45px column at 320px on the old layout) and in review rounds 2 and 3. 204 unit tests on the component pass unchanged. |
| 3. Modal Close 20x20 | CLOSED | `src/components/ui/Modal.tsx:37` is `-my-3 -mr-3 inline-flex h-11 w-11 shrink-0 items-center justify-center ...` (44x44, fixed in the shared primitive, so every dialog). `src/__tests__/tap-target-minimums.test.ts:100-105` pins the class contract. **My own neuter:** replaced the class literal with `inline-flex` on a byte copy, the test went RED (`Modal header Close ... carries its min-tap-size class contract`, 1 failed, 7 passed), restored with `cmp`. `manager-keys.spec.ts` measures the open confirm dialog at 320 and 1280px and the open Rename dialog at 320px with `assertTargetSizes` (the 44px bar), with pre-fix RED output (`BUTTON 20x20 "Close"`) recorded in the 200-14 SUMMARY. |

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Each key shows which strategies it feeds (SC-1, ROUTE-09) | VERIFIED | `GET /api/keys/feeds` (`src/app/api/keys/feeds/route.ts`) answers every owned key in one read, both link kinds (`strategies.api_key_id` and `strategy_keys`), ownership by explicit `user_id` equality on the service role, 500 on any failed read (never an empty map), no-store, limiter first. Rendered as a feeds line in `ApiKeyManager` (card and `Change key…` picker), in `AllocatorExchangeManager` (both key lists, Profile), and in the wizard's preselected-key summary (`ConnectKeyStep` `PreselectFeedsLine`). A failed read renders "Could not check which strategies this key feeds.", never "feeds nothing". |
| 2 | No control changes a strategy's key without a confirm naming the strategy and both keys; a test goes RED on today's one-click re-point (SC-1, ROUTE-09) | VERIFIED | `handleLinkKey` is the only browser writer of `strategies.api_key_id` (grep over `src`: one `.update({ api_key_id })`, `ApiKeyManager.tsx:906`). Callers of `handleSyncTrades`: Resync `(key.id, key.id)` (writes nothing, `keyId === expectedCurrent` returns early), the dialog's `onConfirm`, and the panel Retry, which replays the stored `expectedCurrent` pair, never the live prop (R2-01). The write is conditional on the key the dialog named (`.is`/`.eq` on `api_key_id`), and a zero-row answer throws. The per-card `Use & Sync` and `Add Key` are gone (no `Use & Sync` string left outside tests). `ConfirmKeyChangeDialog` names strategy, next key and current key (or "No key is linked yet"), focus starts on Cancel. `StrategyForm` edit mode writes neither `name` nor `api_key_id` (`mode === "create"` guards both). Other server writers (`create-with-key`, `composite/*`, `finalize-wizard`, `wizard-draft`) act on new or draft strategies in the wizard, outside D-03. **My own neuter:** on a scratchpad byte copy I made the picker option call `handleSyncTrades` directly; `ApiKeyManager.test.tsx` went RED (D-05 NO-WRITE-BEFORE-CONFIRM, CONFIRM-WRITES-ONCE, CANCEL-WRITES-NOTHING, CLOSE-WRITES-NOTHING, DEFAULT-IS-REFUSE and others); restored with `cp`, `cmp` exit 0, `git status` clean. |
| 3 | A manager renames a strategy in one place, and that place shows which name is public (SC-2, ROUTE-10) | VERIFIED | `StrategyNameBlock` on the edit page is the only mount of `RenameStrategyDialog` (grep: no other `<RenameStrategyDialog`; the `Rename…` controls on the factsheet header and the strategies list are removed, only comments remain). It shows the name, the factsheet line and the discovery line from `publicNamePreview` (computed server-side in `edit/page.tsx`, the same helper the factsheet `<title>` uses), gates `Rename…` to `private`/`draft` by an `includes` check (150 D-17 not widened) and shows the lock sentence otherwise. The dialog hint no longer quotes the old name (WR-05). `StrategyForm` edit mode has no name picker and sends no `name`, so the route's gate is the only rename writer. |
| 4 | Adding a strategy has exactly one entry point (SC-3, LEAN-04) | VERIFIED | `/strategies` header `Add a strategy` links straight to `/strategies/new/wizard` for managers (`page.tsx:1352`). The manager empty-state create button is gone (sentence points at the header). `Resume draft`, `Revise & resubmit` and `Resume your draft` continue an existing draft. `/strategies/new` stays a redirect. Allocators use `ContributionWizardOverlay`, which mounts the same `WizardClient` (route is manager-guarded, CD-10). Label is `Add a strategy` in the header, allocator empty state and both Sidebar entries; no `New Strategy` or `Create your first strategy` left. `StrategyForm` mode `create` has no mounter (only `mode="edit"` at `edit/page.tsx:176`). |
| 5 | Managing keys has exactly one entry point (SC-3, LEAN-04) | VERIFIED | Profile tab `exchanges` is labelled `API keys` and is shown to every role (`ProfileTabs`, `profile/page.tsx` loads keys for all roles). `AllocatorExchangeManager` is the only mounter of `ApiKeyForm` and `UpdateMt5SecretDialog` and the only caller of `delete_allocator_api_key`. The edit page's `ApiKeyManager` lists only the strategy's own key (`listedKeys`), offers Resync and `Change key…`, and links to `/profile?tab=exchanges`; add and delete are gone from it. The wizard's connect step stays part of adding a strategy (D-08). Manager-only Delete always sends `p_cascade_holdings: false`; the cascade box is not rendered for managers. |
| 6 | The security explanation lives in one place, matches 192's account, and every other surface links to it (SC-4, LEAN-04) | VERIFIED | `/security#key-handling` (id present) states Fernet, per-row DEK wrapped by an analytics-service KEK. `KEY_STORAGE_SENTENCE` plus `KEY_STORAGE_LINK` are rendered by `AllocatorExchangeManager` (both former "per-user KEK" sites), `ConnectKeyStep` and `MultiKeyConnectStep` `TRUST_ATOMS`, home, `/for-quants` and Terms. My grep for `KEK`, `DEK`, `AES`, `Fernet`, `Vault`, `per-user`, `envelope encryption` over `src/**/*.tsx` outside `/security`: only code comments remain. `src/__tests__/key-storage-census.test.ts` enforces it (empty allowlist, anti-vacuity population, planted-file self-test). |
| 7 | The one-key panel e2e tests run in a blocking CI job, logged in, and cannot pass by skipping (gap 1) | VERIFIED (wiring); first CI run pending | See the gap table. Static pin plus my neuter RED. |
| 8 | At 320px the `/profile?tab=exchanges` key row shows the key label and metadata legibly (gap 2) | VERIFIED | See the gap table; no regression to 1280px one-line layout (test at `:469`). |
| 9 | Every control in `ConfirmKeyChangeDialog` (and every `Modal`) meets the target minimum (gap 3) | VERIFIED | See the gap table. |

**Score:** 9/9 truths verified (6 original roadmap truths re-checked for regression, 3 gap truths closed); ROUTE-09, ROUTE-10 and LEAN-04 covered; 0 present-but-behavior-unverified.

Regression re-check of truths 1-6: the diff since the first verification (`git diff d8b2df29e..HEAD`, non-planning) touches only `AllocatorExchangeManager.tsx` (row classes only, 21 lines), `Modal.tsx` (Close classes), the e2e specs and helper, `ci.yml`, `TODOS.md` and four `src/__tests__` files. The feeds route, the memberships route, `ApiKeyManager`, `ConfirmKeyChangeDialog`, `StrategyNameBlock`, `StrategyForm`, `ProfileTabs`, the edit and strategies pages and the wizard steps are untouched by the gap-closure plans. The targeted vitest run (below) covers them.

### Deferred / known items (not phase gaps)

| # | Item | Disposition |
|---|------|-------------|
| 1 | WR-13: failed-state allocator key row with a long status helper can squeeze the label to a few px in the single-line layout (row at or above 56rem) | Pre-dates Phase 200 (the label column was a bare `flex-1 min-w-0` before; `git show 19353fd1f^`). The phase narrowed where it occurs and measures 320, 768, 1024 and 1280 on healthy rows. It breaks no Phase 200 truth (truth 8 is about 320px). MEDIUM, user-facing, found by a static harness in round 3 after the 3-round cap. Routed by the orchestrator to a follow-up phase; no deferred-phase ID existed to cite at verification time, so it sits in `advisory`. |
| 2 | `src/lib/factsheet/compute.conventions.test.ts` fails 2 snapshot tests | Pre-existing on `main`, unrelated to Phase 200 (orchestrator measurement; not re-run here). |

### Required Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `e2e/manager-keys.spec.ts` | VERIFIED | 14 tests (per SUMMARY), in the e2e-seeded list, no skip, no env read |
| `e2e/helpers/seed-test-project.ts` (`seedManagerKeyPanel`, `readStrategyApiKeyId`, `cleanupManagerKeyPanel`) | VERIFIED | Used by the spec, throws without seed env |
| `src/__tests__/manager-keys-e2e-wiring.test.ts` | VERIFIED | 4 tests, bites (my neuter) |
| `src/components/ui/Modal.tsx` Close | VERIFIED | 44x44, pinned |
| `AllocatorExchangeManager.tsx` key rows | VERIFIED | Container-query layout in both lists |
| `src/app/api/keys/feeds/route.ts`, `src/lib/key-feeds.ts` | VERIFIED | Unchanged since first verification |
| `ConfirmKeyChangeDialog.tsx`, `StrategyNameBlock.tsx`, `key-storage-census.test.ts` | VERIFIED | Unchanged; census passes at HEAD |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Types | `npx tsc --noEmit -p .` | exit 0 | PASS |
| Phase test surface | `npx vitest run` on `manager-keys-e2e-wiring`, `tap-target-minimums`, `e2e-seeded-hydration-guard`, `observ12-fixtures-presence`, `key-storage-census`, `ProfileTabs`, and the directories `src/components/ui`, `src/components/exchanges`, `src/components/strategy`, `src/app/api/keys` | 98 files, 1911 tests passed, 0 failed | PASS |
| Modal Close gate can fail | neuter the class literal, run `tap-target-minimums.test.ts` | RED, restored byte-equal | PASS |
| e2e wiring gate can fail | delete the spec's line from the `e2e-seeded` list, run `manager-keys-e2e-wiring.test.ts` | RED, restored byte-equal | PASS |
| e2e spec itself | not run (needs the local stack, which this verification was told not to boot) | relies on SUMMARY: 14 passed locally | SKIPPED |

### Probe Execution

No phase-declared probes. Step 7c: not applicable.

### Requirements Coverage

| Requirement | Status | Evidence |
|-------------|--------|----------|
| ROUTE-09 | SATISFIED | Truths 1, 2, 7, 9 |
| ROUTE-10 | SATISFIED | Truth 3 (the Rename dialog's Close now clears the minimum, truth 9) |
| LEAN-04 | SATISFIED | Truths 4, 5, 6, 8 |

All three IDs appear in plan frontmatter (200-13: ROUTE-09, LEAN-04; 200-14: ROUTE-09, ROUTE-10; 200-15: LEAN-04, ROUTE-09). No orphaned requirements. REQUIREMENTS.md and ROADMAP bookkeeping is the orchestrator's.

### Anti-Patterns Found

None blocking. No `TBD`, `FIXME` or `XXX` in lines added by the gap-closure commits (grep over the non-planning diff). Informational, carried forward: marketing CTAs lead to the same wizard with other labels.

### Review history

Gap-closure review rounds 1 to 3 (WR-07..WR-12, SFH-G1..G3, R-G1) were fixed; round 3 left only WR-13 open (see deferred items). Round 3's last fix (`b43def9f3`, the container query) was reviewed in round 3 itself, and no fourth round ran (cap).

### Human Verification Required

1. **First CI run for the new e2e spec.** Open the PR, bind the run to the head SHA (`gh api repos/.../actions/runs?head_sha=<sha>` and count the checks), confirm `e2e-seeded` ran `e2e/manager-keys.spec.ts` with 0 skipped and is green. Until then the claim "a failing panel test turns a blocking job red" is wiring-verified and locally exercised, not CI-proven.
2. **UAT at 320px and desktop** as a manager-only user, including a dialog header on a phone width (the Close box is bigger; the glyph position is argued by margins, not measured against the old layout).
3. **Founder decisions** D-01..D-15 and D-R1 (still open, unchanged).

### Gaps Summary

No open gaps. The three gaps from the 2026-11-11 measurement are closed in code with gates that I confirmed can fail (Modal Close pin, e2e wiring pin) and geometry tests whose RED proofs are recorded in the plan SUMMARYs. Status is `human_needed` because the spec has not yet run in GitHub Actions, the visual UAT is manual, and the founder defaults are unreviewed. WR-13 is a known pre-existing item routed to a follow-up.

---

_Verified: 2026-11-11 (re-verification)_
_Verifier: Claude (gsd-verifier)_
