---
phase: 138-mt5ui-addkey-badge-e2e
reviewed: 2026-07-23T23:09:46Z
depth: standard
files_reviewed: 7
files_reviewed_list:
  - src/lib/closed-sets.ts
  - src/lib/utils.ts
  - src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx
  - src/app/(marketing)/security/page.tsx
  - src/components/strategy/ApiKeyManager.tsx
  - src/components/exchanges/AllocatorExchangeManager.tsx
  - e2e/mt5-badge.spec.ts
  - e2e/helpers/seed-test-project.ts
findings:
  critical: 0
  warning: 1
  info: 2
  total: 3
status: fixed
fix_status:
  WR-01: fixed-whole-class
  IN-01: skipped-acknowledged
  IN-02: fixed
fixed_at: 2026-07-24
fix_commits:
  WR-01: 43ca1073
  IN-02: 566da075
---

# Phase 138: Code Review Report

**Reviewed:** 2026-07-23T23:09:46Z
**Depth:** standard
**Files Reviewed:** 7 (+ ci.yml, seed helper)
**Status:** issues_found (no blockers)

## Summary

Reviewed the MT5 dark-launch UI additions across the add-key wizard, the two
provenance-tag maps, the closed-set flag registry, the `/security` setup guide,
the seed helper, and the all-roles badge e2e spec. This is a flag-gated-DARK
phase (MT5 ships OFF behind `NEXT_PUBLIC_MT5_ENABLED` client + `MT5_ENABLED`
server; flip is Phase 139).

I hunted specifically for flag-leak, credential-slot mislabel, silent-widening,
and false-green-test defects. **I found no blockers.** The high-risk items all
check out:

- **Flag correctness.** `MT5_UI_ENABLED` is strict `=== "true"`, a single static
  `process.env.NEXT_PUBLIC_MT5_ENABLED` member access read once at module load
  (closed-sets.ts:124), re-exported from utils.ts. `isMt5EnabledServer()` is a
  per-request function reading the non-public `MT5_ENABLED` (closed-sets.ts:178).
  Flag OFF ⇒ the MT5 card spread is `[]` (ConnectKeyStep.tsx:119-139) — the
  `EXCHANGES` array is byte-identical to today, no MT5 pixel, no leaked type.
- **Credential-slot mapping is correct.** MT5 card maps login→`api_key`
  (keyLabel "MT5 login" → `apiKey` → `body.api_key`), investor pw→`api_secret`
  (`requiresSecret` defaults true → `body.api_secret = apiSecret`), broker
  server→`passphrase` (`passphraseLabel` "Broker server", `requiresPassphrase:true`
  → `body.passphrase = passphrase`). Broker server is REQUIRED: the passphrase
  `<Input required>` (ConnectKeyStep.tsx:469) and submit-gate
  `(requiresPassphrase && !passphrase)` (line 504) both enforce it. The
  "what we reject" atom checks `mt5` FIRST (line 248) before the sfox
  `!requiresSecret` branch, which is correct and defensive (MT5 requires a secret
  so the sfox branch could never fire for it anyway).
- **No silent widening.** `mt5` stays OUT of `UI_EXCHANGE_CODES` / `EXCHANGES` /
  `FUNDING_EXCHANGES` / `CRYPTO_EXCHANGES` (correctly excluded from crypto as
  forex/CFD √252). The two tag entries (`exchangeIcon.mt5`,
  `EXCHANGE_TAGS.mt5`) are keyed lookups against an existing `key.exchange` —
  provenance-only, never an offer/selectable surface.
- **Seed helper is genuine.** `seedMt5VerifiedStrategy` inserts `api_keys.exchange='mt5'`,
  `strategies.source='mt5'` + `status='published'` + linked `api_key_id`, and a
  `strategy_verifications` row `{ source:'mt5', trust_tier:'api_verified',
  status:'validated' }`. The badge is a real api_verified projection, not a
  hardcoded false-green.
- **Badge assertion is real (not false-green).** `VerifiedBadge` renders
  "Verified" text ONLY when `trustTier === "api_verified"` (VerifiedBadge.tsx:26),
  so the spec's `getByText("Verified", { exact: true })` OR
  `[data-trust-tier="api_verified"]` locator genuinely fails RED if the tier
  projection breaks — the anti-mask net holds across owner/allocator/admin/anon.
- **Error copy.** `KEY_MT5_MASTER_PASSWORD` / `KEY_MT5_WRONG_SERVER` already
  exist in wizardErrors.ts (from Phase 135) — no new strings, no duplication;
  ConnectKeyStep just forwards `data.code`.

## Warnings

### WR-01: MT5 wizard "setup guide" deep link is dead in the card-visible / guide-dark half-state

**STATUS: FIXED (whole-class) — commit 43ca1073.** `guideAnchor` derived in
ConnectKeyStep.tsx points the server-flag-gated venues (mt5 AND sfox — the same
latent bug confirmed at security/page.tsx:499 `isSfoxEnabledServer()`) at the
UNCONDITIONAL `#readonly-key` Section anchor; other venues keep their
per-exchange anchor. Component tests for both venues updated to pin the new
target. `npx tsc --noEmit` clean; ConnectKeyStep vitest 29/29 green.

**File:** `src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx:401` (link) and `src/app/(marketing)/security/page.tsx:544` (gate)
**Issue:** The wizard's per-exchange help link renders
`href={`/security#${exchange}-readonly`}` whenever the exchange card is visible —
i.e. gated on the CLIENT flag `MT5_UI_ENABLED`. For MT5 that resolves to
`/security#mt5-readonly`. But the `#mt5-readonly` SubAnchor on the security page
is gated on the SERVER flag `isMt5EnabledServer()` (MT5_ENABLED). These two flags
are independent env vars. In the half-state `NEXT_PUBLIC_MT5_ENABLED=true` +
`MT5_ENABLED` unset (client card shown, server connect fails closed — an
explicitly documented "SAFE half-state"), the MT5 card and its "MT5 setup guide →"
link render, but the anchor they target does not exist, so the link lands on
`/security` top with no guide. This is exactly the client/server flag mismatch
the phase set out to avoid, and it mirrors the same latent behavior already
shipped for sFOX (sfox card on client flag, sfox guide on server flag).

Severity is WARNING not BLOCKER because: (a) both flags flip together in Phase
139 per the go-live runbook, (b) it is a documented transient half-state, (c) it
matches the accepted sFOX precedent, and (d) the wizard *error* envelopes point
at the unconditional `#readonly-key` anchor, not the per-exchange one, so a user
who fails validation still gets a live link.

**Fix:** Either gate the per-exchange guide anchors on the same signal on both
ends, or point the "setup guide" link at the always-rendered `#readonly-key`
anchor for the flag-gated venues (sfox/mt5) until their anchors are
unconditional. Minimal option:
```tsx
// ConnectKeyStep.tsx — fall back to the always-present anchor for
// server-flag-gated venues whose per-exchange guide may be dark.
const guideAnchor =
  exchange === "mt5" || exchange === "sfox" ? "readonly-key" : `${exchange}-readonly`;
// href={`/security#${guideAnchor}`}
```

## Info

### IN-01: Two exchange-tag maps still drift independently

**STATUS: SKIPPED (acknowledged).** Consolidation is deferred under locked
decision D5 (in-code comment ApiKeyManager.tsx:302-305). No change this pass.

**File:** `src/components/strategy/ApiKeyManager.tsx:298-317` and `src/components/exchanges/AllocatorExchangeManager.tsx:122-144`
**Issue:** `exchangeIcon` (ApiKeyManager, label-only) and `EXCHANGE_TAGS`
(AllocatorExchangeManager, label + colors) both hand-maintain the `mt5: "MT5"`
tag. They agree today, but nothing enforces lockstep — a future venue added to
one and not the other silently renders the `"?"` / sliced fallback on the other
surface. The in-code comment (ApiKeyManager.tsx:302-305) already acknowledges
this drift risk and defers consolidation under "locked decision D5", so this is
recorded as informational only.
**Fix:** When D5 is unlocked, derive both maps from a single
`EXCHANGE_TAGS`-style source of truth keyed by `SupportedExchange` so a missing
tag is a compile error (same pattern as `EXCHANGE_DISPLAY satisfies
Record<SupportedExchange, string>`).

### IN-02: e2e "no ? tag" assertion is page-global, not scoped to the key card

**STATUS: FIXED — commit 566da075.** Added a stable `data-testid` to the
ApiKeyManager avatar span and scoped the owner-leg assertion to
`getByTestId("api-key-avatar-mt5")` asserting `toHaveText("MT5")` (proves NOT
"?" without a page-global count). `npx tsc --noEmit` clean; ApiKeyManager vitest
10/10 green; `playwright test e2e/mt5-badge.spec.ts --list` still shows all 5
specs.

**File:** `e2e/mt5-badge.spec.ts:132`
**Issue:** `await expect(page.getByText("?", { exact: true })).toHaveCount(0)`
asserts that NO element anywhere on `/strategies/[id]/edit` has text exactly
"?". It is intended to prove the `exchangeIcon[key.exchange] ?? "?"` fallback did
not fire, but because it is not scoped to the ApiKeyManager card avatar, any
unrelated lone "?" glyph elsewhere on the edit page (e.g. a help affordance added
later) would false-RED this test rather than catch a real tag regression. The
paired positive assertion (`getByText("MT5", { exact: true }).first()` visible)
is the load-bearing one; empirically the global "?" check passes because the sfox
clone runs green on the same surface. Recorded as informational (test robustness,
not a correctness defect).
**Fix:** Scope the negative assertion to the key card, e.g. locate the avatar
span within the ApiKeyManager row and assert its text is `"MT5"` (which
simultaneously proves it is not `"?"`), rather than a page-wide `"?"` count.

---

_Reviewed: 2026-07-23T23:09:46Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
