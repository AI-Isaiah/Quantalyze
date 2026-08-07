---
phase: 152
slug: scen-composer-legibility
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-07
---

# Phase 152 — Validation Strategy

> Per-phase validation contract. Details in 152-RESEARCH.md `## Validation Architecture`;
> the planner fills the per-task map + falsifiability ledger.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (TS only this phase) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run <touched-test-file> --no-file-parallelism` |
| **Full suite command** | `npm test`; coverage gate `npm run test:coverage` (82/80/74/72, blocking) |
| **Estimated runtime** | quick ~10-30s; full ~5min |

---

## Per-Task Verification Map

*(Planner fills task rows.)*

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | — | — | SCEN-02..05 | — | — | — | — | — | ⬜ pending |

---

## Binding Oracle Rules

- **SCEN-02 wire:** the strip-guard test MUST use a POPULATED `addedStrategies` fixture
  (151-06's template fixture is `[]` — vacuity trap measured by research). Assert a v4
  blob WITHOUT `isOwn` decodes with outcome ≠ reset, AND a blob WITH `isOwn: true`
  round-trips through codec + save-route POST without stripping.
- **SCEN-02 fence (H-0300):** `route.test.ts:731-763` becomes TWO exhaustive arms —
  third-party row: exact key set UNCHANGED (no created_at/key_count/status/isOwn beyond
  spec); own row: exact key set including the new fields. Adding new keys to a single
  shared ALLOWED list is the forbidden fix.
- **SCEN-03:** clicking the strategy-name button expands exactly one detail panel
  (one-open-at-a-time owned by the list parent); factsheet link present iff the id
  resolves under OWN-02 visibility; null metrics render the honest "not available"
  copy — never `0.00`. Falsifier: neuter the expansion state → test RED.
- **SCEN-04:** header li renders ONLY above the added-strategies group; per-key rows
  gain no header (alignment scope call). Arrow-key/list-nav (if any) skips the
  non-interactive header li. Em-dash title+sr-only copy is CAUSE-ACCURATE (driven by
  `totalBookEquity == null`, NOT scenarioAum — research Open Q1).
- **SCEN-05:** disambiguation secondary line renders ONLY when an OWN row's name
  collides with another OWN row in the same result; third-party rows never emit or
  render owner metadata. `created_at` alone resolves the founder's real case (15 days
  apart); omit-when-absent per UI-SPEC.

---

## Wave 0 Requirements

- [ ] Grep `addedStrategies` across `src/app/api/**` + `analytics-service/**` for any
      `.strict()` schema that would REJECT (not strip) the new field.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Two Alpha Centauri rows distinguishable at a glance | SCEN-05 | PROD data state | Founder account → Browse: both rows show created dates; choice resolvable |
| Founder can answer "what do the numbers mean" | SCEN-04 | Founder-eyes | Composer added rows show WEIGHT/USD/MODE/LEV/NOTIONAL header |
