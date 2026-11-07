---
phase: "192"
slug: "publictruth-the-public-site-and-the-demo-tell-a-visitor-one"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-06"
---

# Phase 192 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Derived from `192-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x (jsdom default; node project via `vitest.node-env.ts`) with `@testing-library/react`; Playwright for e2e |
| **Config file** | `vitest.config.ts`, `playwright.config.*` |
| **Quick run command** | `npx vitest run src/lib/status-surface-copy.test.ts "src/app/(marketing)" src/components/portfolio src/__tests__/security-packet-date-drift.test.ts src/__tests__/public-truth-copy.test.tsx` |
| **Full suite command** | `npx vitest run && npx tsc --noEmit && npm run lint` |
| **Estimated runtime** | ~60 seconds quick; several minutes full |

---

## Sampling Rate

- **After every task commit:** Run the quick run command plus `npx tsc --noEmit` on touched types
- **After every plan wave:** Run the full suite command
- **Before `/gsd-verify-work`:** Full suite must be green, and CI e2e green on the head SHA
- **Max feedback latency:** 120 seconds
- **RED-then-restore:** every new census/render/throw test is shown RED against HEAD's copy (byte backup with `cp`, reintroduce the old sentence or remove the guard), then restored from the backup and shown GREEN. Never `git checkout/restore/stash` on uncommitted work.

---

## Per-Task Verification Map

Filled by the planner per task; requirement-level map below.

| Requirement | Behavior | Test Type | Automated Command | File Exists | Status |
|-------------|----------|-----------|-------------------|-------------|--------|
| TRUST-01 / SC-1 | Home, `/for-quants`, Terms render `KEY_STORAGE_SENTENCE` + `/security#key-handling`; `/security` carries the full explanation | render | `npx vitest run src/__tests__/public-truth-copy.test.tsx` | ❌ W0 | ⬜ pending |
| TRUST-01 / SC-1 | No banned phrase in marketing tree, landing components, `build-security-packet.html` | fs census | same | ❌ W0 | ⬜ pending |
| TRUST-01 / SC-1 | Packet HTML facts equal `/security` rows; dates match | fs | `npx vitest run src/__tests__/security-packet-date-drift.test.ts` | ✅ extend | ⬜ pending |
| TRUST-01 / SC-2 | TLS and factsheet-visibility sentences pinned; handshakes and signed-out factsheet status recorded | render + evidence | census file + phase evidence file | ❌ W0 | ⬜ pending |
| TRUST-01 / SC-3 | Cost sentence identical on `/for-quants` and Terms §7; exchange list/count from `EXCHANGES` | render + fs | census file | ❌ W0 | ⬜ pending |
| TRUST-01 / SC-4 | Home renders no key/secret input, no "never stored", one link to `/signup` | render | `npx vitest run "src/app/(marketing)/page"` | ✅ extend | ⬜ pending |
| ROUTE-03 | *2026-11-07: the four `/demo` rows that stood here (SC-5 render cases, the founder-view removal, the seeded `/demo` e2e) are superseded by D-11. The public demo is retired, not repaired, so the rows below replace them.* | | | | |
| ROUTE-03 / D-11 | `/demo` and `/api/demo` are gone from the build: no page or API route in `.next/app-path-routes-manifest.json`, and an anonymous request gets the same answer as an unknown URL | build + curl on a placeholder build | plan 192-11 and 192-15 probe sections in the phase evidence file (`D-11 /demo: build-route=absent`, `D-11 /api/demo: build-route=absent`, and the two `anon answer: matches control` lines) | n/a | ⬜ pending |
| ROUTE-03 / D-11 | The proxy no longer lists `/demo` or `/api/demo` as public; a signed-out request redirects to `/login` like any unknown path | unit | `npx vitest run src/proxy.test.ts` | ✅ extend | ⬜ pending |
| ROUTE-03 / D-11 | No app or component links to a retired route, and both retired directories are absent | fs census | `npx vitest run src/__tests__/public-truth-census.test.tsx` | ❌ plan 192-10 | ⬜ pending |
| ROUTE-03 / D-11 | No demo e2e or visual spec is left, and every e2e path a workflow names exists on disk | fs + grep | plan 192-14 Task 1 verify | n/a | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/__tests__/public-truth-copy.test.tsx` — SC-1..SC-4 renders and census
- [x] ~~`src/app/(marketing)/demo/page.truth.test.tsx`~~. Superseded 2026-11-07 by D-11: plan 192-11 deletes the demo page and its tests.
- [ ] `src/lib/status-surface-copy.test.ts` — literal pins for the new constants
- [x] ~~`e2e/` unseeded loud-failure assertion for `/demo`~~. Superseded 2026-11-07 by D-11: plan 192-14 deletes the demo specs and the seeded `/demo` rows.
- [ ] Phase evidence file — handshakes, HSTS, certificate, signed-out factsheet status, D-08 PROD read answers (no PROD ids), `pdftotext` output

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| TLS handshake per version against the production host | TRUST-01 / SC-2 | Network fact, not a code fact | `openssl s_client -connect <host>:443 -tls1 / -tls1_1 / -tls1_2 / -tls1_3`; record result in evidence file |
| ~~PROD `/demo` renders populated on the deployed Phase 192 code~~ | ROUTE-03 / SC-5, D-08 | **Superseded 2026-11-07 by D-11.** The public demo is retired, so there is no populated `/demo` to probe after deploy. `[192-DEMO-POSTDEPLOY-PROBE]` is not booked (plan 192-10, `## Dropped bookings`). The ship gate is plan 192-10 Task 1: the retired state, not the D-08 repair or the D-10 label count | none |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
