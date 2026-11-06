---
phase: 162-honest-what-the-user-sees-is-true
plan: 09
subsystem: connect/key-scopes
tags: [honest, rendered-claims, security-presentation, a11y]
status: complete
requires:
  - "GET /api/keys/[id]/permissions probe_error pass-through (already shipped)"
provides:
  - "probe_error-gated scope chips + freshness caption in KeyPermissionBadge"
  - "Pill unknown state (granted: boolean | null) using the UI-SPEC C-3/C-4 absence vocabulary"
affects:
  - "src/app/(dashboard)/strategies/[id]/edit/page.tsx (renders the badge)"
  - "src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx (renders the badge)"
tech-stack:
  added: []
  patterns:
    - "one fact, one gate: the probe result is decided once (probeFailed) and every claim reads from it"
    - "absence vocabulary reused, not reinvented: em-dash + text-text-muted, no semantic color"
key-files:
  created: []
  modified:
    - src/components/connect/KeyPermissionBadge.tsx
    - src/components/connect/KeyPermissionBadge.test.tsx
decisions:
  - "Chips render as UNKNOWN (em-dash) rather than being omitted — the panel is titled 'Detected key scopes', so three missing chips would read as a layout failure, while `Read — Trade — Withdraw —` states the unknown in the UI-SPEC's own vocabulary."
  - "The 'Detected … from the exchange' caption is OMITTED, not restated — the summary sentence above already states the limitation plainly, and C-4's single-note discipline says one sentence names the state."
  - "`granted: boolean | null` rather than a separate `unknown` prop — a third state on one axis cannot be desynchronised from the other two."
metrics:
  duration: ~25m
  completed: 2026-08-26
actuals:
  tokens: 5200
  tasks: 2
  commits: 2
---

# Phase 162 Plan 09: Probe-error-gated scope chips Summary

A failed scope probe can no longer render scope facts: the three Read/Trade/Withdraw
chips and the "Detected … from the exchange" caption now read from the same
`probe_error` fact the plain-English summary already branched on.

## What was built

**Task 1 — the gate** (`ff0c205ef`)

- `Pill` gained a third state: `granted: boolean | null`, where `null` means the probe
  did not answer. It renders `—` in `text-text-muted` with `data-granted="unknown"` and
  `aria-label="{label} scope unknown"`. This is 162-UI-SPEC §C-3/C-4's vocabulary
  verbatim — em-dash for a value that cannot be claimed, colorless, **no red** (absence
  is not an error) and **no accent** (it is not reassurance either).
- `const probeFailed = perms?.probe_error === true;` is declared once in the component
  body; the three chips and the caption both read from it. One fact, decided once.
- The freshness caption is omitted under `probeFailed`. `detected_at` on a failed probe
  is the timestamp of the *failure*, so "Detected {t} from the exchange" was false twice
  over: nothing was detected, and it did not come from the exchange.
- The probe-error **summary sentence is byte-unchanged** — it was already honest. K-3
  pins it with `toBe(...)` on the full string.

**Task 2 — the class sweep** (`f82cc689e`) — recorded in the spec's header comment.

## Deviations from Plan

None — plan executed as written.

## The RED witness (anti-vacuity)

Witnessed **twice, first-hand**, not predicted:

1. **Pre-fix RED.** K-1a/K-1b/K-1c written first and run against the unmodified
   component: `3 failed | 19 passed (22)`. K-1c's failure output reproduced the PROD
   contradiction byte-for-byte in a single string:

   > `Detected key scopesRe-checkCould not contact the exchange to verify scopes. Try the Re-check button in a moment.Read ✓Trade ✓Withdraw ✓Detected just now from the exchange.`

2. **Neutered-fix RED.** After GREEN (`22 passed`), the new guard was neutered
   (`const probeFailed = perms?.probe_error === true;` → `const probeFailed = false;`)
   and the spec re-run: `3 failed | 19 passed (22)` — the same three, with the same
   PROD-contradiction string. K-2 and K-3 stayed green under the neuter, which is
   correct: they are not the pin.

   **Restore was byte-identical, via a byte copy — never `git checkout --`:**

   | Stage | `shasum -a 256 src/components/connect/KeyPermissionBadge.tsx` |
   |-------|---------------------------------------------------------------|
   | before neuter | `593f5ca4d3ebae1c6ab37d3e7cd06d9c22ca839b904541a69444b2fdea31c427` |
   | after restore | `593f5ca4d3ebae1c6ab37d3e7cd06d9c22ca839b904541a69444b2fdea31c427` |

**Why the existing assertion could not stand in.** `KeyPermissionBadge.test.tsx:266`
(`expect(summary.textContent).toContain("Could not contact the exchange")`) passes
against the *broken* behaviour — it is satisfied by the very screen that also renders
`Trade ✓ Withdraw ✓`. The new assertions query the chips and the caption instead:

- `K-1a` — `data-granted="unknown"` on all three; no `✓`, no `✗` in chip text; `aria-label`
  matches `/unknown/` and **not** `/granted/`; className matches neither `text-negative`
  nor `text-accent` (the a11y + colorless requirements, asserted, not assumed).
- `K-1b` — `container.querySelector("time")` is null and the body does not contain
  "from the exchange". (Matching on "Detected" alone would have hit the panel *heading*
  "Detected key scopes", which is a label, not a claim — a vacuity trap avoided.)
- `K-1c` — the contradiction pin: the summary says "Could not contact the exchange" AND
  the body contains none of `Read ✓` / `Trade ✓` / `Withdraw ✓`.
- `K-2` — successful probe still renders chips (`true`/`false`, `✓` present) **and** the
  caption (`<time>` present). The gate is error-scoped, not a chip deletion.
- `K-3` — summary sentence byte-exact, `role="alert"`, chips still present (as unknown).

## Consumer sweep (Task 2) — a class of ONE, stated loudly

| Render site | Consumes | Gating verdict |
|---|---|---|
| `src/components/connect/KeyPermissionBadge.tsx` | `{read, trade, withdraw, detected_at, probe_error}` | **was ungated — FIXED this plan** |
| `strategies/[id]/edit/page.tsx:84` | renders `<KeyPermissionBadge>` | covered — same component, no independent render |
| `wizard/steps/SyncPreviewStep.tsx:2546` | renders `<KeyPermissionBadge>` | covered — same component (composite branch at :2269 deliberately omits the badge entirely) |
| `wizard/WithdrawalWarningStrip.tsx` | nothing — no props | not a consumer: states the **policy** ("keys with Trade or Withdraw permissions are refused"), never a detected fact. It is the copy the chips were contradicting. |
| `api/strategies/finalize-wizard/route.ts:946` | `livePerms.probe_error` | already gated server-side (→ `KEY_NETWORK_TIMEOUT`); asserts no scope to the user |
| `lib/wizardErrors.ts:1264` | static copy | remediation instruction ("Confirm every Withdrawal and Transfer scope is off"), not a claim about this key |

Grep evidence (`-a` used throughout, per the NUL-byte file trap):
- `grep -rna "probe_error" src analytics-service` → exactly **one** component hit
  (`KeyPermissionBadge.tsx`); every other TS hit is a route, a schema, or a spec.
- `grep -rna "detected_at" src --include="*.tsx"` → only `KeyPermissionBadge.tsx` and its spec.
- `grep -rna "Withdraw" src --include="*.tsx" --include="*.ts" -l` → 15 files, each
  classified in the table above; no second ungated scope-fact renderer.

**Conclusion: no independent ungated instance exists.** Nothing was filed as deferred.

## Verification

| Gate | Result |
|---|---|
| `npx vitest run src/components/connect/KeyPermissionBadge.test.tsx` | 22 passed |
| `npx vitest run src/components/connect/` | 1 file, 22 passed |
| `npx tsc --noEmit` | clean (run after both tasks) |
| Render-site regression: `strategies/[id]/edit/page.test.tsx` + `SyncPreviewStep.render.test.tsx` | 2 files, 63 passed |

**Not run:** the full vitest suite. `src/__tests__/contracts/` scans all of `src/` and a
file-scoped run cannot clear it — the wave gate owns that. No clean-suite claim is made here.

## Threat mitigations applied

- **T-162-09-A** (Tampering — integrity of displayed capability claims): mitigated. Chips
  gate on `probe_error`; K-1a/K-1c pin that non-null scope values under `probe_error`
  never render as fact, in the dangerous direction (`trade: true, withdraw: true`).
- **T-162-09-B** (Spoofing — false freshness): mitigated. Caption omitted under
  `probe_error`; K-1b pins the absence of `<time>` and of "from the exchange".
- **T-162-SC**: no packages installed.

## Known Stubs

None.

## Scope untouched

Scope **enforcement** was not modified. Read-only remains enforced server-side; this plan
is presentation-layer only, exactly as the finding specifies.

## Self-Check: PASSED

- `src/components/connect/KeyPermissionBadge.tsx` — FOUND
- `src/components/connect/KeyPermissionBadge.test.tsx` — FOUND
- `.planning/phases/162-honest-what-the-user-sees-is-true/162-09-SUMMARY.md` — FOUND
- commit `ff0c205ef` — FOUND
- commit `f82cc689e` — FOUND
