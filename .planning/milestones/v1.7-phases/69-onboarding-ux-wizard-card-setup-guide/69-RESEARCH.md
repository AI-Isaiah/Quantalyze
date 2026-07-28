# Phase 69: Onboarding UX — Wizard Card & Setup Guide - Research

**Researched:** 2026-07-04
**Domain:** Frontend presentation layer (React/Next.js) — exchange-offer surfaces + static setup-guide copy
**Confidence:** HIGH (every surface verified against live code this session)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Add a `deribit` entry to the **local** `EXCHANGES` array in `ConnectKeyStep.tsx:55–74` (the wizard has its OWN hardcoded list; does NOT consume `UI_EXCHANGE_CODES`). Shape `{ id:"deribit", name:"Deribit", caption:<inverse perps + options + spot; read-only>, requiresPassphrase:false }`. Testid `wizard-exchange-deribit` is auto-derived by the render loop.
- **D-02:** `requiresPassphrase:false` — no passphrase field renders for Deribit (SC-1). Deep-link `href={/security#${exchange}-readonly}` is already generic → resolves to `#deribit-readonly` for free.
- **D-03:** SC-1 field labels "Client ID"/"Client Secret". Extend `ExchangeOption` (48–53) with optional `credentialLabels?:{key,secret}` default "API Key"/"API Secret"; set `{key:"Client ID",secret:"Client Secret"}` for deribit. Storage stays generic key/secret columns — labels presentational only. Update placeholder text too.
- **D-04:** Server passphrase gate (`create-with-key/route.ts:67–75`) is OKX-only and correct as-is — NO deribit branch. Confirm `api_keys.passphrase` nullable (it is — binance/bybit save without one). No server change.
- **D-05:** Add `<SubAnchor id="deribit-readonly" title="Deribit">` inside `<Section id="readonly-key">` in `security/page.tsx` after the bybit block (~466), matching binance/okx/bybit voice. Steps: create an OAuth API key (Client ID + Client Secret, no passphrase); grant ONLY read scopes — explicitly listing **`account:read`** (SC-2 hard requirement) plus `trade:read`/`wallet:read`; NO `:read_write`/Trade/Withdraw. Grounded in `deribit-ground-truth.md`.
- **D-06:** anchor id = `deribit-readonly`.
- **D-07:** Add `"deribit"` to `UI_EXCHANGE_CODES` (`closed-sets.ts:64–68`) — the conscious Phase-68-reserved flip. `EXCHANGE_DISPLAY` already has `deribit:"Deribit"`. Verify EVERY consumer renders Deribit with NO "unsupported exchange" fallback (SC-3).
- **D-08:** Confirm the flip does NOT leak into gated surfaces — `FUNDING_EXCHANGES` (and Python `PERP_EXCHANGES`/`RECONCILABLE`/`_FUNDING_BUCKET_HOURS`) stay 3-value (Phase 70).
- **D-09:** Extend wizard + security-page tests; add a revert-proof guard that FAILS if `deribit` is missing from `UI_EXCHANGE_CODES` or the wizard `EXCHANGES` array.

### Claude's Discretion
- Exact Deribit card caption + exact ordered-list wording of the security SubAnchor (must name `account:read`; else match existing voice + DESIGN.md).
- `credentialLabels` as a new `ExchangeOption` field vs a small per-exchange lookup — either, as long as per-exchange not global.
- Whether VerificationForm needs any change — planner determines from the component. **(Answered below: YES — see "Scout Gap 1".)**
- Standalone `/gsd:ui-phase` UI-SPEC: NOT needed.

### Deferred Ideas (OUT OF SCOPE)
- Trades ingestion / instrument classification / inverse coin→USD / funding dedup / dailies — Phase 70.
- Allocator-side Deribit positions (`DeribitNotSupportedError`) — Phase 71.
- Live LTP onboarding + secret rotation — Phase 72.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| UX-01 | Wizard shows a Deribit card — Client ID + Client Secret fields, no passphrase field | `ConnectKeyStep.tsx` local `EXCHANGES` array + `requiresPassphrase` conditional (296) + generic key/secret `Input`s (259, 284) confirmed; adding an array entry + `credentialLabels` delivers the card, testid, deep-link, and no-passphrase behavior. |
| UX-02 | `/security#deribit-readonly` setup guide — scope checklist including `account:read` | `Section`/`SubAnchor` helpers (567–614) + existing readonly-key block (411–468) confirmed; scope string grounded in `deribit-ground-truth.md` (`account:read trade:read wallet:read …`, zero `:read_write`). |
</phase_requirements>

## Summary

Phase 69 is a small, presentation-only phase. The Phase-68 boundary already admits Deribit end-to-end at the key-save path (`SUPPORTED_EXCHANGES` includes `deribit`; `create-with-key/route.ts` gates via `isSupportedExchange`; the passphrase check is OKX-only; `api_keys.passphrase` is nullable). What remains is to (a) add a Deribit card to the wizard's LOCAL `EXCHANGES` array with passphrase-less Client ID/Secret labels, (b) add a `deribit-readonly` SubAnchor to the security page naming `account:read`, and (c) flip `UI_EXCHANGE_CODES` to include `deribit` so the public offer surfaces auto-widen.

Every scout finding is confirmed against live code. **Two items the scout under-specified matter for correctness:** (1) `VerificationForm.tsx` uses a LOCAL `EXCHANGE_LABELS` record `{binance,okx,bybit}` — adding `deribit` to `UI_EXCHANGE_CODES` makes the dropdown render an **`undefined` label** unless that map gains a deribit entry (or is repointed at `EXCHANGE_DISPLAY`); (2) `closed-sets.test.ts` contains three Phase-68 **inverted gate pins** that assert `deribit` is ABSENT — these WILL FAIL on the flip and must be inverted (not deleted) as part of this phase, while the `FUNDING_EXCHANGES` pins stay 3-value.

**Primary recommendation:** Treat the flip as a "gate inversion": update `closed-sets.test.ts` pins to expect the 4-value UI set in the SAME commit as the `UI_EXCHANGE_CODES` edit, fix `VerificationForm`'s label map, and lean on the existing chip-surface guard (`closed-sets.test.ts:58–74`) as the SC-3 revert-proof. The wizard change is a single array entry + a `credentialLabels` field; the security change is one `<SubAnchor>`. No new packages, no server changes, no new design primitives.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Deribit wizard card + credential labels | Browser / Client (`"use client"` ConnectKeyStep) | — | Pure presentation; storage stays generic key/secret cols; no server contract change |
| No-passphrase credential shape | Browser / Client | API (unchanged) | `requiresPassphrase:false` hides the field; server OKX-only gate already permits a null passphrase |
| Security setup guide (scope checklist) | Frontend Server (marketing RSC) | — | `security/page.tsx` is a server component rendering static JSX; adding a SubAnchor is static content |
| Offer-surface widening (`UI_EXCHANGE_CODES`) | Shared lib (`closed-sets.ts`) | Browser consumers (VerificationForm, RequestIntroButton, marketing count) | One const flip auto-widens TS consumers; label maps that don't derive from it are the risk |
| Key-save acceptance of Deribit | API / Backend (Phase 68, DONE) | — | Already wired; this phase must NOT touch it |

## Scout Verification (all CONFIRMED)

| Scout claim | Status | Evidence |
|-------------|--------|----------|
| Wizard uses LOCAL `EXCHANGES` array (3 entries), not `UI_EXCHANGE_CODES` | ✅ CONFIRMED | `ConnectKeyStep.tsx:55–74` |
| Passphrase field conditionally rendered from `requiresPassphrase` | ✅ CONFIRMED | `:122–123` (derive) + `:296–312` (render) + `:337` (submit-disable) + `:144` (payload sends `null` when false) |
| Deep-link `/security#${exchange}-readonly` is generic | ✅ CONFIRMED | `:249` |
| Key/secret `Input`s generically labeled "API Key"/"API Secret" | ✅ CONFIRMED | `:260` (`Input label="API Key"`) + `:274` (hand-rolled secret label) — **NOTE: the secret field is NOT an `Input` component, it's a raw `<input>` with a sibling `<label>` at 270–293; the `credentialLabels.secret` swap must target that `<label>` text, not an `Input` prop** |
| Server passphrase gate OKX-only; no deribit branch needed | ✅ CONFIRMED | `create-with-key/route.ts:67–75`; allowlist `isSupportedExchange` at `:46` admits deribit (SUPPORTED_EXCHANGES 4-value) |
| `SUPPORTED_EXCHANGES` already 4-value; `EXCHANGE_DISPLAY` has deribit | ✅ CONFIRMED | `closed-sets.ts:39, 48–53` |
| `UI_EXCHANGE_CODES` is 3-value with the Phase-69 gate comment | ✅ CONFIRMED | `closed-sets.ts:56–68` |
| `SubAnchor`/`Section` pattern; add after bybit ~466 | ✅ CONFIRMED | `security/page.tsx:454–466` (bybit block) + `567–614` (helpers) |
| Ground-truth scope string includes `account:read`, zero `:read_write` | ✅ CONFIRMED | `deribit-ground-truth.md:8–12` (`account:read trade:read wallet:read custody:read block_trade:read`) |
| `FUNDING_EXCHANGES` stays 3-value (D-08) | ✅ CONFIRMED | `closed-sets.ts:80–84` — decoupled const, not touched by the UI flip; Python funding/perp sets are separate |

## Scout Gaps (things to add to the plan)

### Gap 1 — `VerificationForm` REQUIRES a change (answers the open discretion item)
`src/components/landing/VerificationForm.tsx:13–24` builds its dropdown from a **local** `EXCHANGE_LABELS: Record<string,string>` hardcoded to `{binance, okx, bybit}`, then maps `UI_EXCHANGE_CODES.map(v => ({value:v, label: EXCHANGE_LABELS[v]}))`. Adding `deribit` to `UI_EXCHANGE_CODES` makes `EXCHANGE_LABELS["deribit"] === undefined` → the `<Select>` renders an option with an **undefined label** (blank text). This is exactly the "unsupported exchange fallback" SC-3 forbids.
- **Fix (recommended):** replace the local `EXCHANGE_LABELS` with `EXCHANGE_DISPLAY` from `@/lib/closed-sets` (single source of truth; can never drift again). Minimal alternative: add `deribit:"Deribit"` to the local map.
- Passphrase: `VerificationForm` gates the passphrase input on `exchange === "okx"` (`:104`) and the payload spread on `okx` (`:49`) → Deribit correctly shows NO passphrase. No change needed there. **[VERIFIED: codebase]**

### Gap 2 — a SECOND `UI_EXCHANGE_CODES` consumer the scout didn't name
`src/components/strategy/RequestIntroButton.tsx:24` builds `EXCHANGE_OPTIONS = UI_EXCHANGE_CODES.map(e => e==="okx" ? "OKX" : capitalize(e))`. This auto-widens correctly (`deribit → "Deribit"`), needs **no change**, and adds a "Deribit" chip to the allocator's preferred-exchange picker — an acceptable user-facing offer. Flag it in the plan's SC-3 verification checklist so it's consciously confirmed, not silently widened. **[VERIFIED: codebase]**

### Gap 3 — `closed-sets.test.ts` inverted gate pins WILL FAIL on the flip (must invert, same commit)
`src/lib/closed-sets.test.ts` has three assertions that pin the PRE-flip state and break the moment `deribit` enters `UI_EXCHANGE_CODES`:
- `:36` `expect(EXCHANGES).toEqual(["Binance","OKX","Bybit"])` — `EXCHANGES` derives from `UI_EXCHANGE_CODES` (`closed-sets.ts:97`) → becomes `[...,"Deribit"]`. **UPDATE to 4-value.**
- `:44` `expect(UI_EXCHANGE_CODES).toEqual(["binance","okx","bybit"])` — **UPDATE to include "deribit".**
- `:46` `expect(UI_EXCHANGE_CODES.includes("deribit")).toBe(false)` — **INVERT to `.toBe(true)`.**
- KEEP unchanged (Phase 70 gate): `:45` + `:47` `FUNDING_EXCHANGES` stays `["binance","okx","bybit"]` / excludes deribit. Do NOT touch.
- KEEP GREEN (this IS the SC-3 revert-proof): `:58–74` chip-surface guard asserts `RequestIntroButton` + `VerificationForm` import `UI_EXCHANGE_CODES` and NOT `SUPPORTED_EXCHANGES`. Both still satisfy it after the flip.
- The marketing-count test comment (`closed-sets.ts:90`) says "stays at 3" — that comment is now stale; update it to reflect the conscious 4-value flip when touched.

### Gap 4 — stale hardcoded "Binance, OKX, Bybit" prose (NON-BLOCKING; planner discretion)
These prose strings mention only 3 exchanges and do NOT derive from `UI_EXCHANGE_CODES`, so they will NOT auto-update and are NOT required by UX-01/UX-02:
- `src/app/(marketing)/for-quants/page.tsx:317` — FAQ answer "Binance, OKX, or Bybit."
- `src/components/exchanges/AllocatorExchangeManager.tsx:684` — "Binance, OKX, Bybit, or …"
- `src/lib/wizardErrors.ts:143` — key-format error copy.
- `src/app/(marketing)/security/page.tsx:11` — file-header comment.

Recommendation: OUT of the SC-1/2/3 boundary; leave them, or fold a one-line "and Deribit" copy touch into this phase only if the planner wants marketing consistency. Flag, don't silently rewrite (per project Rule 3 surgical-changes). No test asserts on this copy.

### Gap 5 — the wizard secret field is a raw `<input>`, not `<Input>`
`ConnectKeyStep.tsx:268–294` renders the API Secret as a hand-rolled `<div><label>API Secret</label><input …/></div>` (with the Show/Hide toggle), NOT the `Input` component used for the key field (`:259`). So `credentialLabels.secret` for Deribit must swap the text node at `:274` ("API Secret") and the placeholder at `:289` ("Paste the secret"), while `credentialLabels.key` swaps the `Input label` prop at `:260` and placeholder at `:263`. Two different edit shapes for key vs secret — call this out in the plan so the executor doesn't assume symmetric `Input` props.

## Marketing count (SC-3, expected behavior)
`src/app/(marketing)/page.tsx:115, 215` render `{EXCHANGES.length} exchanges supported` and a hero stat `{EXCHANGES.length}`. `EXCHANGES` imports from `@/lib/constants` which re-exports from `closed-sets` (derived from `UI_EXCHANGE_CODES`). Post-flip these auto-render **4**. This is the intended SC-3 auto-widen. **No test hardcodes "3 exchanges supported"** (grep clean) — only the `closed-sets.test.ts:36` pin, covered by Gap 3. **[VERIFIED: codebase]**

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Exchange display label for the verify dropdown | A per-component label record | `EXCHANGE_DISPLAY` from `@/lib/closed-sets` | The local `VerificationForm.EXCHANGE_LABELS` is the exact drift that Gap 1 exposes; the SoT map has a compile-time `satisfies Record<SupportedExchange,…>` guarantee |
| Passphrase-shape logic per exchange | New conditional branches | Existing `requiresPassphrase` flag (wizard) / `exchange==="okx"` (verify) | Mirrors binance/bybit; a passphrase-less Deribit is a natural fit |
| The Deribit card, testid, and setup-guide deep-link | Bespoke JSX | The existing `EXCHANGES.map` render loop | One array entry yields card + `data-testid="wizard-exchange-deribit"` + `#deribit-readonly` link for free |

## Common Pitfalls

### Pitfall 1: Flipping `UI_EXCHANGE_CODES` without inverting its gate test
`closed-sets.test.ts:36/44/46` fail the instant deribit is added. If the executor deletes the failing assertions instead of inverting them, the SC-3 regression guard is lost. **Invert, keep the shape.**

### Pitfall 2: Leaking Deribit into funding/cron surfaces
`FUNDING_EXCHANGES` (`closed-sets.ts:80`) and the Python `_FUNDING_BUCKET_HOURS`/perp/reconcile sets are Phase 70. Touch ONLY `UI_EXCHANGE_CODES`. `check-zod-db-check-parity.test.ts:243` pins `FUNDING_EXCHANGES` at 3-value — a leak there fails that contract test (good backstop).

### Pitfall 3: `undefined` dropdown label (Gap 1)
Silent, not a crash — the option renders blank. Only a rendered-label assertion catches it; add one (Validation Architecture SC-3-b).

### Pitfall 4: Assuming the wizard secret field is an `<Input>` (Gap 5)
It's a raw `<input>` + sibling `<label>`; the label swap targets a text node, not a prop.

## Validation Architecture

**Test framework:** Vitest + `@testing-library/react` (jsdom). Quick run: `npm run test -- <path>`. Full suite (coverage-gated, ratchet lines 82/stmt 80/fn 74/br 72): `npm run test:coverage`. No new framework install; all target test files already exist.

### Phase Requirements → Test Map

| SC | Behavior | Test | Automated command | File exists? |
|----|----------|------|-------------------|--------------|
| SC-1-a | Deribit card renders in the wizard | RTL: `getByTestId("wizard-exchange-deribit")` present; text "Deribit" | `npm run test -- src/app/\(dashboard\)/strategies/new/wizard/steps/ConnectKeyStep.test.tsx` | ✅ extend |
| SC-1-b | Selecting Deribit shows NO passphrase field | RTL: click deribit card → `queryByLabelText(/passphrase/i)` is null (contrast: OKX → present) | same | ✅ extend |
| SC-1-c | Deribit fields labeled "Client ID"/"Client Secret" | RTL: `getByLabelText("Client ID")` + `getByText("Client Secret")` after selecting deribit; binance still shows "API Key"/"API Secret" | same | ✅ extend |
| SC-1-d | Setup-guide deep-link resolves to `#deribit-readonly` | RTL: after selecting deribit, the "setup guide" link `href` ends `/security#deribit-readonly` | same | ✅ extend |
| SC-2-a | `deribit-readonly` anchor renders | RTL render `<SecurityPage/>`: `document.getElementById("deribit-readonly")` not null | `npm run test -- src/app/\(marketing\)/security/page.test.tsx` | ✅ extend |
| SC-2-b | Scope checklist names `account:read` | RTL: `within(#deribit-readonly).getByText(/account:read/)`; and assert NO `:read_write`/"Withdraw"/"Trade "(write) in that block | same | ✅ extend |
| SC-3-a | `UI_EXCHANGE_CODES` includes deribit (revert-proof const guard) | Vitest: `expect(UI_EXCHANGE_CODES).toContain("deribit")` (invert `:46`) | `npm run test -- src/lib/closed-sets.test.ts` | ✅ invert |
| SC-3-b | Verify dropdown renders a real "Deribit" label (no `undefined`/fallback) | RTL on `VerificationForm`/`VerificationSection.test.tsx`: `getByRole("option",{name:"Deribit"})` present; assert no option with empty text | `npm run test -- src/components/landing/__tests__/VerificationSection.test.tsx` | ✅ extend |
| SC-3-c | Chip surfaces still bind to `UI_EXCHANGE_CODES`, not `SUPPORTED_EXCHANGES` | Existing source-scan guard stays green | `closed-sets.test.ts:58–74` | ✅ exists |
| SC-1/SC-3 revert-proof | Wizard `EXCHANGES` array contains a deribit entry | NEW guard: import/parse `EXCHANGES` OR assert card testid; fail if absent | ConnectKeyStep.test.tsx | ✅ add |
| Gate integrity | `FUNDING_EXCHANGES` stays 3-value (no over-widen) | Keep `closed-sets.test.ts:45/47` unchanged | same | ✅ keep |

### Revert-proof (how each test fails if the wiring is reverted — wiring-invocation rule)

- **SC-1-a/c/d:** Remove the `deribit` entry from the wizard `EXCHANGES` array → `getByTestId("wizard-exchange-deribit")` throws / `getByLabelText("Client ID")` throws. The card, testid, labels, and deep-link ALL vanish because they derive from that single array entry. Test goes red.
- **SC-1-b:** If someone sets `requiresPassphrase:true` for deribit (or hard-codes a passphrase field), the "no passphrase field" assertion fails; the OKX-contrast half proves the assertion can actually fail.
- **SC-2-a/b:** Delete the `<SubAnchor id="deribit-readonly">` → `getElementById` returns null; drop `account:read` from the copy → the `getByText(/account:read/)` fails. Neutering the scope wording is caught.
- **SC-3-a:** Revert `UI_EXCHANGE_CODES` to 3-value → `toContain("deribit")` fails. (This is the exact inverse of the Phase-68 pin, so it can only be green when the flip is present.)
- **SC-3-b:** Revert the `VerificationForm` label fix (leave local map at 3 entries) → the deribit `<option>` renders an empty label; the `getByRole("option",{name:"Deribit"})` assertion fails. This is the test that catches Gap 1's silent `undefined`.
- **SC-3-c:** If a chip surface is repointed at `SUPPORTED_EXCHANGES`, the source-scan guard fails (pre-existing, Phase-68 authored).
- **Wizard-array guard:** Explicitly fails if the `EXCHANGES` array loses its deribit member — the D-09 revert-proof for the wizard side, symmetric to SC-3-a for the const side.

### Wave 0 gaps
- None — all four target test files exist (`ConnectKeyStep.test.tsx`, `security/page.test.tsx`, `closed-sets.test.ts`, `VerificationSection.test.tsx`). Optional bonus: extend `create-with-key/route.test.ts` and `verify-strategy/route.test.ts` with a "deribit accepted, no passphrase required" case to pin D-04 at the server boundary (low effort, high signal — confirms the OKX-only gate lets deribit through).

## Package Legitimacy Audit
**N/A — this phase installs ZERO external packages.** All work uses existing in-repo modules (`@/lib/closed-sets`, `@/components/ui/*`). No `npm install`. Slopcheck not applicable.

## Security Domain
No new attack surface. The key-save allowlist (`isSupportedExchange`), scope validation (Phase 68 DRB-03), and encryption path are unchanged. `credentialLabels` are presentational only — storage stays the generic key/secret columns; the wire payload shape (`create-with-key`) is untouched. `api_keys.passphrase` is already nullable (binance/bybit save without one), so a passphrase-less Deribit key persists correctly. The security-page copy must STEER users to read-only scopes (`account:read`, no `:read_write`/Trade/Withdraw) — this is user-facing hardening that grounds the DRB-03 rejection errors in docs (V5-adjacent input-guidance, not enforcement; enforcement stays server-side and unchanged).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The security-page anchor-preservation test (`page.test.tsx:113–127`) lists only top-level `Section` ids, NOT `SubAnchor` ids, so adding `deribit-readonly` won't trip it | SC-2 | LOW — verified the list; a new SubAnchor is additive. If a future test pins SubAnchor ids, extend it. |
| A2 | Deribit console uses "Client ID"/"Client Secret" terminology (SC-1 label choice) | D-03 | LOW — CONTEXT locks this wording; ground-truth confirms OAuth-style credentials, no passphrase. Presentational only; storage unaffected. |
| A3 | Recommended scope checklist = `account:read` + `trade:read` + `wallet:read`; steer away from write | D-05 | LOW — grounded in live-validated `deribit-ground-truth.md`. `account:read` is the hard SC-2 requirement; the others are the observed read set. |

## Sources

### Primary (HIGH confidence — verified in-session)
- `src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx` — wizard `EXCHANGES`, passphrase conditional, raw secret field, deep-link
- `src/lib/closed-sets.ts` + `src/lib/closed-sets.test.ts` — `UI_EXCHANGE_CODES`, `EXCHANGE_DISPLAY`, `FUNDING_EXCHANGES`, the inverted gate pins + chip-surface guard
- `src/components/landing/VerificationForm.tsx` — local `EXCHANGE_LABELS` drift (Gap 1)
- `src/components/strategy/RequestIntroButton.tsx` — second `UI_EXCHANGE_CODES` consumer (Gap 2)
- `src/app/api/strategies/create-with-key/route.ts` — `isSupportedExchange` allowlist + OKX-only passphrase gate (D-04)
- `src/app/(marketing)/security/page.tsx` + `security/page.test.tsx` — `Section`/`SubAnchor` pattern + anchor pins
- `src/app/(marketing)/page.tsx` + `src/lib/constants.ts` — `EXCHANGES.length` marketing count auto-widen
- `analytics-service/docs/deribit-ground-truth.md` — live-validated read-only scope string

### Notes
- Project convention (AGENTS.md): modified Next.js — but this phase writes ONLY JSX into existing components (a client component + a server component) and const/label edits; no new framework APIs (no routes, no cache-components, no data fetching). No `node_modules/next/dist/docs` read required for these edits.
- DESIGN.md is mandatory before UI work (CLAUDE.md) — but the card + SubAnchor reuse `Card`/`Input`/`Section`/`SubAnchor` verbatim with zero new visual design; conformance folds into review.

## Metadata
**Confidence breakdown:** Surfaces/edit points — HIGH (all verified). Test strategy — HIGH (target files exist, revert-proofs concrete). Scope copy — HIGH (live ground-truth). 
**Research date:** 2026-07-04 · **Valid until:** ~30 days (stable frontend surfaces)
