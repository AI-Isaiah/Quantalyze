---
phase: 94
slug: wizard-resumability
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-11
---

# Phase 94 — Validation Strategy

> Frontend + one secure server read. WIZ-01 is a SECURITY boundary (no-secret-
> leak) and lands first. Bulk is component-testable (vitest); the owner-seeded
> e2e is the one true-e2e need (Ph91 lesson: seed the fixture OWNED BY the
> logged-in user, wired in BOTH HAS_SEED_ENV and ci.yml, or the wizard's RLS
> browser reads return empty and the test false-REDs).

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (components/routes) + Playwright e2e (owner-seeded, WIZ-03/05 round-trips) |
| **Quick run** | `npx vitest run src/app/(dashboard)/strategies/new/wizard src/app/api/strategies/composite` |
| **Full suite** | `npx vitest run` + `npx tsc --noEmit` + `npm run lint` |
| **Security pin** | route test asserting the WIZ-01 GET response NEVER contains any of: `api_key_encrypted, api_secret_encrypted, passphrase_encrypted, dek_encrypted, nonce` |

## Sampling Rate
- After every task commit: vitest for the touched area + `tsc`.
- After every wave: full vitest + lint.
- Before verify-work: the WIZ-01 no-secret-leak route test is load-bearing and green.

## Per-Requirement Test Map

| Req | Seam | Type |
|-----|------|------|
| WIZ-01 | new GET route test: returns exchange/nickname/window/verified, NEVER the 5 secret columns; owner-scoped (non-owner → empty/403) | vitest route |
| WIZ-02 | MultiKeyConnectStep mount rehydrates panels marked verified, no re-validate, empty-secret-OK resubmit via api_key_id | vitest component |
| WIZ-03 | "Review your keys" (composite) calls onReviewKeys (setStep only), does NOT delete draft / mint session; single-key keeps destructive path | vitest component |
| WIZ-04 | WizardChrome step cells clickable both directions; forward-skip past incomplete blocked; return-forward-after-no-change allowed; DESIGN.md Enter-activation | vitest component |
| WIZ-05 | SyncPreviewStep remount with a COMPLETE cachedSnapshot short-circuits before any read/kickoff (no re-crawl) | vitest component |
| e2e | owner-seeded: leave→return→review (WIZ-03) keys intact; back-to-crawled shows snapshot (WIZ-05) | Playwright |

## Wave 0
Existing wizard vitest infra + the composite route test harness cover all requirements. No new framework. The owner-seeded e2e fixture must be added owner-matched + wired in ci.yml (Ph91).

## Sign-Off
- [ ] WIZ-01 no-secret-leak route test green + owner-scoped
- [ ] Each WIZ item has a component test that fails without the fix
- [ ] No migration / no new RLS policy (verified — existing owner RLS)
- [ ] DESIGN.md honored for the clickable stepper
- [ ] Owner-seeded e2e wired in both HAS_SEED_ENV and ci.yml (or documented advisory)

**Approval:** approved (autonomous, 2026-07-11)
