---
phase: 69-onboarding-ux-wizard-card-setup-guide
verified: 2026-07-04T23:05:00Z
status: passed
score: 4/4 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: none
  note: "Initial verification (69-REVIEW.md is the code review, not a prior VERIFICATION.md)"
requirements_covered: [UX-01, UX-02]
---

# Phase 69: Onboarding UX — Wizard Card & Setup Guide Verification Report

**Phase Goal:** A strategy manager can self-serve Deribit onboarding — the wizard offers Deribit with the right credential shape (Client ID + Client Secret, NO passphrase) and `/security#deribit-readonly` shows the scope checklist (must include `account:read`).
**Verified:** 2026-07-04T23:05:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC-1 | Wizard shows a Deribit card with Client ID + Client Secret fields and NO passphrase field | ✓ VERIFIED | `ConnectKeyStep.tsx:81-91` 4th EXCHANGES entry `{id:"deribit", name:"Deribit", requiresPassphrase:false, credentialLabels:{key:"Client ID", secret:"Client Secret"}}`; labels resolved `:145-146`, applied to key `<Input label={keyLabel}>` `:287` and raw-secret sibling `<label>{secretLabel}</label>` `:301`; passphrase field gated on `requiresPassphrase` `:323` (false for deribit → not rendered). Payload-invariant test `ConnectKeyStep.test.tsx:206-252` proves POST body keeps `api_key`/`api_secret` + `passphrase:null`, no `client_id`/`client_secret` leak. |
| SC-2 | `/security#deribit-readonly` renders a setup guide with a scope checklist including `account:read` | ✓ VERIFIED | `security/page.tsx:468-485` `<SubAnchor id="deribit-readonly" title="Deribit">`, 3-step `<ol>`; step 2 `:476-479` `<strong>account:read</strong>` + steer-away "Do not enable Trade or Withdraw, and do not grant any :read_write scope." Positioned after bybit block inside `Section id="readonly-key"`. |
| SC-3 | Auto-widening TS consumers render Deribit correctly, no "unsupported exchange" fallback | ✓ VERIFIED | `closed-sets.ts:65-70` `UI_EXCHANGE_CODES = ["binance","okx","bybit","deribit"]`; `VerificationForm.tsx:8,19-22` labels sourced from single-source `EXCHANGE_DISPLAY` (local `EXCHANGE_LABELS` drift map DELETED — grep confirms 0 hits); `RequestIntroButton.tsx:26` `capitalize`-maps `UI_EXCHANGE_CODES` (auto-widens, comment refreshed in `036b149c`); marketing count `page.tsx:115,215` renders `{EXCHANGES.length}` (derives from UI_EXCHANGE_CODES → 4). |
| D-08 | FUNDING_EXCHANGES stays 3-value — Deribit does NOT leak into funding/cron surfaces | ✓ VERIFIED | `closed-sets.ts:82-86` `FUNDING_EXCHANGES = ["binance","okx","bybit"]` byte-identical; parity backstop `check-zod-db-check-parity.test.ts:240-243` pins `ts: FUNDING_EXCHANGES, rejects: ["deribit"]`; `closed-sets.test.ts:48-49` asserts FUNDING excludes deribit. |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `ConnectKeyStep.tsx` | deribit EXCHANGES entry + credentialLabels rendering | ✓ VERIFIED | `id:"deribit"` present `:82`; labels/placeholders resolved and wired to both edit shapes; wiring is revert-proof (all assertions derive from the single entry). |
| `security/page.tsx` | SubAnchor id=deribit-readonly with account:read checklist | ✓ VERIFIED | `deribit-readonly` present `:468`; `account:read` strong-wrapped `:477`. |
| `closed-sets.ts` | 4-value UI_EXCHANGE_CODES | ✓ VERIFIED | 4 members `:65-70`; `EXCHANGE_DISPLAY`, `SUPPORTED_EXCHANGES`, `FUNDING_EXCHANGES` unchanged shape. |
| `VerificationForm.tsx` | labels from EXCHANGE_DISPLAY, no local drift map | ✓ VERIFIED | `EXCHANGE_DISPLAY` imported `:8`, mapped `:21`; `EXCHANGE_LABELS` grep = 0. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `ConnectKeyStep.tsx` | `/security#deribit-readonly` | generic `href={`/security#${exchange}-readonly`}` | ✓ WIRED | `:276` generic deep-link; resolves to `#deribit-readonly` for deribit. Anchor exists in target (`security/page.tsx:468`). |
| `VerificationForm.tsx` | `closed-sets.ts` | `EXCHANGE_DISPLAY[value]` keyed by `UI_EXCHANGE_CODES` | ✓ WIRED | `:19-22`. |
| `closed-sets.test.ts` | `closed-sets.ts` | inverted gate pin (UI contains deribit, FUNDING excludes) | ✓ WIRED | `:42-49` inverted (not deleted). |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Targeted suite green | `npx vitest run ConnectKeyStep + security/page + closed-sets + VerificationSection + check-zod-db-check-parity --no-file-parallelism` | 5 files, **60 passed** | ✓ PASS |
| Payload rename is label-only | test `submits Deribit with api_key/api_secret + passphrase:null` | `body.api_key/api_secret` set, `passphrase` null, no `client_id` leak | ✓ PASS |
| Drift-proof labels | grep `EXCHANGE_LABELS` in VerificationForm | 0 hits | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| UX-01 | 69-01 | Wizard Deribit card, Client ID/Secret, no passphrase | ✓ SATISFIED | SC-1 above |
| UX-02 | 69-01 | `/security#deribit-readonly` scope guide naming account:read | ✓ SATISFIED | SC-2 above |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `security/page.tsx` | 11 | Stale "Binance/OKX/Bybit" header comment | ℹ️ Info | Non-derived prose; documented Gap-4 follow-up (IN-02). Not a phase-goal failure. |

No debt markers (TBD/FIXME/XXX) introduced. No stubs, empty handlers, or hollow data paths — presentation-only, all values are static copy or derived from typed closed-sets.

### Noted Observations (not blockers)

- **WR-01 (roadmap sequencing):** Deribit onboarding is exposed before the Phase-70 ingestion pipeline exists — a connected Deribit key yields no trades/dailies/positions yet. Per the phase scope this is a deliberate, documented phased-rollout decision, explicitly directed to be treated as a noted observation, not a phase-goal failure. Ship-gate call for the human, not a code defect.
- **Phase-71 carry-forward:** the saved-key display-casing cosmetic is a documented Phase-71 item, not a Phase-69 failure.
- **IN-01:** stale `RequestIntroButton` comment was fixed in follow-up commit `036b149c` (verified: comment now names the Phase-69 flip at `:21-24`).

### Human Verification Required

None. All three success criteria are code-verifiable and empirically confirmed via the RTL/vitest suite (60/60 green). Visual rendering of the card and guide is covered by the render-based tests; no runtime/external-service behavior is in scope for this presentation-only phase.

### Gaps Summary

No gaps. All 4 must-have truths VERIFIED; UX-01 and UX-02 satisfied; FUNDING_EXCHANGES gate and parity backstop intact (Phase-70 boundary preserved). The two review follow-ups (payload-invariant test + stale RequestIntroButton comment) landed in `036b149c`. WR-01 is a deliberate roadmap-sequencing decision surfaced for the human ship-gate, not a blocker.

---

_Verified: 2026-07-04T23:05:00Z_
_Verifier: Claude (gsd-verifier)_
