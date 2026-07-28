# Phase 69: Onboarding UX — Wizard Card & Setup Guide - Context

**Gathered:** 2026-07-04
**Status:** Ready for planning
**Mode:** Smart discuss (`--auto` — recommendations auto-accepted per the user's standing decide-autonomously directive)

<domain>
## Phase Boundary

A strategy manager can self-serve Deribit onboarding on the USER-FACING surfaces: the strategy-creation wizard offers a Deribit exchange card with the right credential shape (Client ID + Client Secret, NO passphrase), and `/security#deribit-readonly` renders a scope-checklist setup guide that includes `account:read`. This is the conscious "offer Deribit to users" flip that Phase 68 earmarked (the `UI_EXCHANGE_CODES` gate comment names Phase 69 explicitly). Requirements: UX-01, UX-02.

**OUT of scope:** trades ingestion / dailies / funding (Phase 70), allocator positions (Phase 71), live LTP account onboarding + rotation (Phase 72). No new design primitives — reuse existing components verbatim.
</domain>

<decisions>
## Implementation Decisions

### Wizard exchange card (UX-01)
- **D-01:** Add a `deribit` entry to the **local** `EXCHANGES` array in `ConnectKeyStep.tsx:55–74` (the wizard has its OWN hardcoded 3-exchange list — it does NOT consume `UI_EXCHANGE_CODES`, so it must be edited directly). Shape: `{ id: "deribit", name: "Deribit", caption: <inverse perps + options + spot; read-only>, requiresPassphrase: false }`. Add `data-testid="wizard-exchange-deribit"` (auto-derived by the existing render loop).
- **D-02:** `requiresPassphrase: false` — Deribit uses OAuth Client ID/Secret, no passphrase. The existing conditional (`ConnectKeyStep.tsx:122–123, 296–312`) hides the passphrase field automatically when `requiresPassphrase` is false; NO passphrase field renders for Deribit (SC-1). The deep-link `href={/security#${exchange}-readonly}` (line ~249) is already generic → resolves to `#deribit-readonly` for free.
- **D-03 (credential field labels):** SC-1 requires "Client ID + Client Secret fields". The wizard's key/secret `Input`s are generically labeled ("API Key"/"API Secret"). Extend `ExchangeOption` (ConnectKeyStep.tsx:48–53) with an optional `credentialLabels?: { key: string; secret: string }`, default "API Key"/"API Secret", set `{ key: "Client ID", secret: "Client Secret" }` for deribit. Storage stays the generic key/secret columns — labels are presentational only. Placeholder text updated to match ("Paste the Deribit Client ID/Secret").

### Server-side credential validation
- **D-04:** The server passphrase gate (`create-with-key/route.ts:67–75`) is OKX-only and correct as-is — Deribit requires NO passphrase, so NO deribit branch is added. Confirm at plan time the `api_keys.passphrase` column is nullable (it already must be — binance/bybit save without one). No server change expected beyond deribit already being accepted by the Phase-68 boundary; verify the route's exchange-allowlist path admits deribit end-to-end.

### Security setup guide (UX-02)
- **D-05:** Add a `<SubAnchor id="deribit-readonly" title="Deribit">` block inside the existing `<Section id="readonly-key">` in `src/app/(marketing)/security/page.tsx` (after the bybit block, ~line 466), matching the exact prose/ordered-list style of the binance/okx/bybit SubAnchors. Steps must instruct: create an OAuth API key (Client ID + Client Secret, no passphrase), and grant ONLY read scopes — explicitly listing **`account:read`** (SC-2 hard requirement) plus `trade:read` (and `wallet:read`), and NOT granting any `:read_write` / Trade / Withdraw. Scope wording is grounded in `analytics-service/docs/deribit-ground-truth.md` (validated live: `account:read trade:read wallet:read …`, zero `:read_write`) and the Phase-68 DRB-03 scope gate.
- **D-06 (anchor convention):** id = `deribit-readonly` (matches the `#{exchange}-readonly` convention the wizard deep-link already produces).

### UI_EXCHANGE_CODES flip + auto-widening consumers (SC-3)
- **D-07:** Add `"deribit"` to `UI_EXCHANGE_CODES` (`closed-sets.ts:64–68`) — this is the conscious flip Phase 68's gate comment reserved for Phase 69. `EXCHANGE_DISPLAY` already carries `deribit: "Deribit"` (no change). Then verify EVERY `UI_EXCHANGE_CODES` consumer renders Deribit correctly with NO "unsupported exchange" fallback (SC-3): the public `VerificationForm` dropdown (imports it at line ~7) and any marketing "N exchanges" count. If a consumer needs per-exchange credential-shape handling (e.g. VerificationForm passphrase field), apply the same passphrase-less treatment as binance/bybit.
- **D-08 (scope boundary check):** Confirm the flip does NOT leak Deribit into surfaces that must stay gated until later phases — `PERP_EXCHANGES` / `RECONCILABLE_EXCHANGES` cron sets and `FUNDING_EXCHANGES` stay 3-value (Phase 70 concerns). Only user-facing OFFER surfaces flip here.

### Testing
- **D-09:** Wizard test (extend the ConnectKeyStep test): Deribit card renders; selecting Deribit shows NO passphrase field and shows "Client ID"/"Client Secret" labels; `wizard-exchange-deribit` testid present; setup-guide link resolves to `#deribit-readonly`. Security-page test (extend `security/page.test.tsx`): `deribit-readonly` anchor renders and its scope checklist text includes `account:read`. Add a guard that FAILS if `deribit` is missing from `UI_EXCHANGE_CODES` or the wizard `EXCHANGES` array (revert-proven, per the memory wiring-invocation rule).

### Claude's Discretion
- Exact caption copy for the Deribit card and the exact ordered-list wording of the security SubAnchor (must name `account:read`; otherwise match existing voice + DESIGN.md).
- Whether `credentialLabels` is a new `ExchangeOption` field vs a small per-exchange lookup — either is fine as long as labels are per-exchange, not global.
- Whether VerificationForm needs any change at all (depends on whether it renders passphrase/credential shape per exchange) — planner determines from the component.
- Whether to run a standalone `/gsd:ui-phase` UI-SPEC: NOT needed — the phase reuses existing `Card`/`Input`/`Section`/`SubAnchor` primitives verbatim with zero new visual design; DESIGN.md conformance folds into planning/review.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Wizard onboarding surface
- `src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx` — local `EXCHANGES` array (55–74), `ExchangeOption` interface (48–53), passphrase conditional (122–123, 296–312), card render loop + setup-guide deep-link (220–256).
- `src/app/api/strategies/create-with-key/route.ts` §67–75 — OKX-only passphrase gate (Deribit needs none; stays as-is).

### Security setup-guide surface
- `src/app/(marketing)/security/page.tsx` — `Section id="readonly-key"` (411–468), per-exchange `SubAnchor` blocks (binance 420 / okx 438 / bybit 454), `Section`/`SubAnchor` helper components (567–614). Add `deribit-readonly` here.
- `src/app/(marketing)/security/page.test.tsx` — extend for the deribit anchor + `account:read` assertion.

### Closed-set / display source of truth
- `src/lib/closed-sets.ts` — `UI_EXCHANGE_CODES` (60–68, the gate comment naming Phase 69) + `EXCHANGE_DISPLAY` (48–53, already has deribit) + `SUPPORTED_EXCHANGES` (39, already 4-value).
- `src/components/**/VerificationForm.tsx` — public consumer of `UI_EXCHANGE_CODES`; verify deribit renders without fallback.

### Scope semantics (for the guide copy + tests)
- `analytics-service/docs/deribit-ground-truth.md` — live-validated read-only scope string (`account:read trade:read wallet:read …`, zero `:read_write`); source of truth for the guide's scope checklist.
- `.planning/phases/68-boundary-wiring-key-validation/68-CONTEXT.md` — Phase 68 OQ4 UI-exposure GATE (why UI_EXCHANGE_CODES was decoupled and reserved for this phase) + DRB-03 scope-gate semantics.

### Design
- `DESIGN.md` — MANDATORY per CLAUDE.md before any visual/UI decision. The card + guide reuse existing primitives; no deviation without approval.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Wizard `EXCHANGES` array + render loop already generate a styled card + testid + setup-guide deep-link per exchange — adding one array entry gets the card, the `#deribit-readonly` link, and the testid for free.
- `EXCHANGE_DISPLAY` already maps `deribit: "Deribit"` — no display-name work.
- `Section` / `SubAnchor` components already provide the anchored guide layout — one more `<SubAnchor>` matches the pattern.
- `AllocatorExchangeManager` already has a Deribit `EXCHANGE_TAGS` entry (`DRB`, blue) — allocator-side tag rendering is already covered.

### Established Patterns
- Per-exchange credential shape is expressed via the local `requiresPassphrase` flag, NOT a global — so a passphrase-less Deribit is a natural fit (mirrors binance/bybit).
- User-facing OFFER surfaces are gated by `UI_EXCHANGE_CODES` (decoupled from the key-save boundary `SUPPORTED_EXCHANGES` on purpose); flipping it is the intended Phase-69 action.

### Integration Points
- Wizard card → generic key/secret (+ optional passphrase) inputs → `create-with-key` route → Phase-68 boundary (already admits deribit) → key-save. Phase 69 touches only the presentation layer; the save path was wired in Phase 68.
- `UI_EXCHANGE_CODES` → `VerificationForm` dropdown + marketing count (the "auto-widening TS consumers" of SC-3).
</code_context>

<specifics>
## Specific Ideas

- Field labels for Deribit are "Client ID" / "Client Secret" (SC-1 wording + matches Deribit's own console), not "API Key"/"API Secret".
- The security guide's Deribit scope checklist MUST literally include `account:read` (SC-2), and steer users away from any write/trade/withdraw scope (grounds the DRB-03 rejection errors in user-facing docs).
</specifics>

<deferred>
## Deferred Ideas

- Trades ingestion, instrument-kind classification, inverse coin→USD, funding native-id dedup, dailies through the ONE compute path — Phase 70 (RISKY; must iterate the 2 subaccounts per key — see the ground-truth CRITICAL finding).
- Allocator-side Deribit positions (lift f3 Path-B `DeribitNotSupportedError`) — Phase 71.
- Live LTP onboarding of the 3 accounts + secret rotation — Phase 72.

None — discussion stayed within phase scope.
</deferred>

---

*Phase: 69-onboarding-ux-wizard-card-setup-guide*
*Context gathered: 2026-07-04*
