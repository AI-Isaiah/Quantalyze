---
phase: 200-managerkeys
verified: 2026-11-11T02:00:00Z
status: human_needed
score: 4/4 roadmap success criteria verified in code (0 failed)
verified_at_sha: f531e3600b056927f36be437df2d4343ff6b72fa
drift_subjects:
  - src/components/strategy/ApiKeyManager.tsx
  - src/components/strategy/ConfirmKeyChangeDialog.tsx
  - src/components/strategy/StrategyNameBlock.tsx
  - src/components/strategy/StrategyForm.tsx
  - src/components/strategy/StrategyTable.tsx
  - src/components/exchanges/AllocatorExchangeManager.tsx
  - src/components/exchanges/ExchangesTabContent.tsx
  - src/components/auth/ProfileTabs.tsx
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
behavior_unverified: 0
human_verification:
  - test: "Run the Playwright specs e2e/api-key-flow.spec.ts and e2e/sync-analytics-flow.spec.ts in the e2e lane"
    expected: "They pass against the one-key edit-page panel (Change key… opens the picker, a pick opens the confirm, no write before Change key)"
    why_human: "Playwright was not run on this host and both specs are env-gated; the review rounds also did not run them (WR-04, R2-02 are 'FIXED (not run)')"
  - test: "UAT at 320px and desktop: /strategies/<id>/edit (Change key…, Rename…, name block with public-name lines) and /profile?tab=exchanges as a manager-only user (feeds lines, Delete key dialog, could-not-check state)"
    expected: "Layout holds, copy reads correctly, feeds lines and dialogs are visible and operable"
    why_human: "No browser on this host; 200-VALIDATION.md lists this as manual-only"
  - test: "Founder review of defaults recorded as 'orchestrator default, founder may revisit' (D-01..D-15) and D-R1"
    expected: "Founder accepts or revisits, in particular D-06 (merging the key managers onto Profile) and D-R1 (an unchecked feeds read holds Delete key, not Disconnect)"
    why_human: "The founder was unavailable during discuss and review; these are decisions, not code facts"
---

# Phase 200: MANAGERKEYS Verification Report

**Phase Goal:** A manager can see which strategies each key feeds, and nothing re-points a strategy's key without an explicit confirmation. Renaming happens in one place that shows which name is public. Adding a strategy and managing keys each have one entry point, and the security explanation lives in one place.
**Verified:** 2026-11-11, at HEAD `f531e3600` on `feat/200-managerkeys` (working tree clean)
**Status:** human_needed (every roadmap truth holds in code; e2e and layout checks were not run)
**Re-verification:** No, initial verification

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

**Score:** 6/6 truths verified (covering all 4 roadmap success criteria and ROUTE-09, ROUTE-10, LEAN-04); 0 present-but-behavior-unverified.

### Required Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `src/app/api/keys/feeds/route.ts`, `src/lib/key-feeds.ts` | VERIFIED | Substantive, wired from three clients, data from real DB reads |
| `src/components/strategy/ConfirmKeyChangeDialog.tsx` | VERIFIED | Mounted only while a re-point is pending, `onConfirm` is the only path to the write |
| `src/components/strategy/StrategyNameBlock.tsx` | VERIFIED | Mounted on the edit page with a server-computed preview |
| `src/__tests__/key-storage-census.test.ts` | VERIFIED | Passes at HEAD |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Types | `npx tsc --noEmit -p .` | exit 0 | PASS |
| 16 phase test files (ApiKeyManager, poll, AEM, AEM.feeds, ExchangesTabContent, StrategyNameBlock, StrategyForm, key-storage-census, feeds route, memberships route, ProfileTabs, strategies page.merged, ConnectKeyStep.preselect-feeds, edit page, strategy-display, status-surface-copy) | targeted `npx vitest run` | 630 passed, 0 failed, 0 `it.skip` in the two big suites | PASS |
| D-05 gate can fail | neuter picker to write directly, run `ApiKeyManager.test.tsx` | RED, then restored byte-equal | PASS |
| `npx eslint` on ApiKeyManager, AllocatorExchangeManager, feeds route | | no output | PASS |

### Requirements Coverage

| Requirement | Status | Evidence |
|-------------|--------|----------|
| ROUTE-09 | SATISFIED | Truths 1 and 2 |
| ROUTE-10 | SATISFIED | Truth 3 |
| LEAN-04 | SATISFIED | Truths 4, 5, 6 (the requirement also names renaming having one entry point: truth 3) |

No orphaned requirements. REQUIREMENTS.md and ROADMAP still show Pending and `[ ]` for the phase; that bookkeeping is the orchestrator's.

### Anti-Patterns Found

None blocking. No `TBD`, `FIXME` or `XXX` in lines added by the phase. Informational: marketing CTAs lead to the same wizard but carry other labels (`/for-quants` logged-in "Connect your strategy", landing "List Your Strategy"). They are entry points that lead to the one flow (SC-3 satisfied) but not the in-app label `Add a strategy`.

### Review history

The three review rounds found and fixed a CR-01 and an R2-01 (re-point on a stale page and on a Retry after a refresh), plus Delete/Disconnect hold behaviour (D-R1, R3-01). I re-read the final write path and the dialog wiring; the fixes are present at HEAD. The 200-REVIEW.md claim "Open MEDIUM+ survivors: none" is consistent with what I found, though round 3's last fix (`1fb1bc033`) was not re-reviewed (cap reached); its test was neutered to RED by the orchestrator per the review record, and the AEM suites pass here.

### Human Verification Required

1. **e2e specs not run.** `e2e/api-key-flow.spec.ts` and `e2e/sync-analytics-flow.spec.ts` were rewritten for the one-key panel and have never been executed. Run them in the e2e lane.
2. **UAT at 320px and desktop** for the edit page and the Profile `API keys` tab as a manager-only user (no browser available).
3. **Founder decisions.** D-01..D-15 were orchestrator defaults and D-R1 a review-time default (hold `Delete key`, not `Disconnect`, on an unchecked feeds read). D-06 (merging key management onto Profile) is recorded as costly to reverse.

### Gaps Summary

No gaps. Every roadmap success criterion is delivered and wired in the code at HEAD. Status is `human_needed` solely because e2e and visual checks could not be run here and several decisions are unconfirmed defaults.

---

_Verified: 2026-11-11_
_Verifier: Claude (gsd-verifier)_
