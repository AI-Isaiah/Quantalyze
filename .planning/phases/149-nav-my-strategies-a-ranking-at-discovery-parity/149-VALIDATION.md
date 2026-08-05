---
phase: 149
slug: nav-my-strategies-a-ranking-at-discovery-parity
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-05
---

# Phase 149 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | {pytest 7.x / jest 29.x / vitest / go test / other} |
| **Config file** | {path or "none — Wave 0 installs"} |
| **Quick run command** | `{quick command}` |
| **Full suite command** | `{full command}` |
| **Estimated runtime** | ~149 seconds |

---

## Sampling Rate

- **After every task commit:** Run `{quick run command}`
- **After every plan wave:** Run `{full suite command}`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 149 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 149-01-01 | 01 | 1 | REQ-{XX} | T-149-01 / — | {expected secure behavior or "N/A"} | unit | `{command}` | ✅ / ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `{tests/test_file.py}` — stubs for REQ-{XX}
- [ ] `{tests/conftest.py}` — shared fixtures
- [ ] `{framework install}` — if no framework detected

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| {behavior} | REQ-{XX} | {reason} | {steps} |

*If none: "All phase behaviors have automated verification."*

---

## Falsifiability Ledger

> **Coverage answers "is it verified?". This section answers "CAN the verification FAIL?"**
> A phase can satisfy every other section in this file with tests that cannot fail. Fill this in at
> plan time; complete the Observed column at execution time.

**One row per success criterion.** The mutation must be a *semantic* change to production code (a
value, a boundary, a branch direction) — not a syntax error, and not a change to the test.

| SC | Mutation (exact edit to production source) | Must turn RED | Observed? | Evidence |
|----|-------------------------------------------|---------------|-----------|----------|
| SC-1 | `{file:line}`: `{X}` → `{Y}` | `{test or file}` | ⬜ pending | `{pasted failure line, or "asserted — NOT observed"}` |

*Rules:*
- **Observed means run.** "The test covers it" is not evidence. Paste the failing assertion.
- **A mutation that is skipped** (ambiguous anchor, unreachable) is recorded as skipped, **never as caught**.
- **Prefer the second member of a class.** If a rule is enforced at N sites, mutate a site the author
  did *not* have in mind — that is what detects instance-fixes masquerading as class-fixes.

---

## Oracle Independence

> The failure this catches: assertions that read their expected value out of the module under test,
> so the test passes for any implementation.

- [ ] No test imports a **constant** from the module it tests — expected values are **literals** in the test
- [ ] No assertion compares a value to itself via a re-export, fixture, or table under test
- [ ] Table/registry sizes are pinned to a **literal count**, not to `len(THE_TABLE)`
- [ ] Any fake/double is pinned against the real contract it stands in for (version, key shape, semantics)

*If a self-referential oracle is deliberate, name it here and say what independently covers it:*
{none / rationale}

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 149s
- [ ] **Every success criterion has a Falsifiability Ledger row**
- [ ] **Every ledger row is `Observed ✅` with pasted evidence, or explicitly marked skipped-with-reason**
- [ ] **Oracle Independence checklist complete**
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** {pending / approved YYYY-MM-DD}
