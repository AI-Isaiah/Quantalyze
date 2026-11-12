---
phase: 201-plainwords-one-name-per-concept-explained-and-the-small-inco
plan: 32
subsystem: copy
tags: [plainwords, egress-ip, security-page, wizard-errors, error-envelope, F-12]
requires: ["201-05", "201-22", "201-27"]
provides:
  - "EGRESS_IP_STATUS_LINK phrase and href pair, one source for the hint and the envelope"
  - "/security#egress-ips opens with a static none-yet statement"
  - "wizard hint, two refused-key bullets and one cause link the same statement"
affects: [201-24]
key-files:
  modified:
    - src/lib/contact.ts
    - src/lib/contact.test.ts
    - src/components/contact/ContactPointerText.tsx
    - src/components/contact/ContactPointerText.test.tsx
    - src/app/(dashboard)/strategies/new/wizard/WizardIpAllowlistHint.tsx
    - src/app/(dashboard)/strategies/new/wizard/WizardIpAllowlistHint.test.tsx
    - src/app/(marketing)/security/page.tsx
    - src/app/(marketing)/security/page.test.tsx
    - src/lib/wizardErrors.ts
    - src/lib/wizardErrors.test.ts
    - src/components/error/ErrorEnvelope.tsx
    - src/components/error/ErrorEnvelope.test.tsx
decisions:
  - "ContactPointerText gains one optional linkText prop (default 'contact form') rather than a new component, so the hint and the envelope share classes, rel and suffix"
  - "The none-yet statement is static copy with no environment read (U-29 deferred)"
metrics:
  tasks: 3
  completed: 2026-11-11
status: complete
actuals:
  tasks: 3
  commits: 3
plan_head_before: 7a8543ac6
plan_head_after: 3f64f9ff4
---

# Phase 201 Plan 32: egress IP status (F-12) Summary

The wizard's IP-allowlist hint and the two refused-key errors now link the phrase "egress IP status" to `/security#egress-ips`, and that section opens with a static statement that there is no static egress IP yet, so a manager creates the read-only key without an IP restriction. This replaces plan 05's D-13 contact-form version.

## Tasks

| Task | Commit | What |
|------|--------|------|
| 1 (tracer) | 04d0ecf5f | `EGRESS_IP_STATUS_LINK` frozen pair, `linkText` option on `ContactPointerText`, reworked hint, `<p data-testid="egress-ip-status">` as the section body's first element, hint and page tests inverted (contact-link count 5 to 4) |
| 2 | 3c582c95d | `KEY_PERMISSION_DENIED.fix[1]`, `KEY_IP_ALLOWLIST.fix[1]` and `.cause` in the UI-SPEC 8.3 copy; plan-05 arm inverted; at-most-one-pointer sweep and exactly-two-codes arm added |
| 3 | 3f64f9ff4 | `ErrorEnvelope` links the first `egress IP status` in a `cause` or `debug_context` line (new tab, shared pair); `linkText`, default-renderer, two real-envelope and pair-pin tests |

## A-13 reading

TODOS `167.1.2.2-BYBIT-STATIC-EGRESS` is still open at HEAD: heading "booked 2026-10-09, Phase 167.1.2.2 D-17(a)", "Trigger: now.", "Owner: THE FOUNDER", no CLOSED paragraph and no recorded static outbound IP. The none-yet statement is therefore true.

## RED lines (neuter discipline, byte backups with `cp -p`, restored with `cmp` exit 0)

- `gc-201-32-neuter: gate=WizardIpAllowlistHint.test.tsx (hint href pointed at /contact?topic=security) result=red restored=identical` (RED: `has exactly one link, 'egress IP status', to the egress anchor in a new tab (F-12)` and `links nowhere to the contact form and shows no raw path (F-12)`; 2 failed, 5 passed; after restore 7 passed)
- `gc-201-32-neuter: gate=security/page.test.tsx (old contact-form paragraph put back in #egress-ips) result=red restored=identical` (RED: `opens the section body with the none-yet statement, word for word` and `carries no contact-form link and no address literal in the section`; 2 failed, 54 passed; after restore 56 passed)
- `gc-201-32-neuter: gate=wizardErrors.test.ts (plan-05 allowlist bullet put back) result=red restored=identical` (RED: `the two egress-IP bullets and the allowlist cause point at the egress IP status (F-12)` and `no wizard error line carries both pointer phrases, and exactly two codes link the egress status in a fix line (F-12, U-28)`; 2 failed, 285 passed; after restore 287 passed)
- `gc-201-32-neuter: gate=ErrorEnvelope.test.tsx (egress branch removed, every line to the contact pointer) result=red restored=identical` (RED: both real-envelope cases, the cause case and the mixed-lines case; 4 failed, 41 passed; after restore 45 passed)
- Before each neuter the new tests were also seen RED against HEAD before the implementation existed (hint 3 failed, page 4 failed, wizardErrors 2 failed, envelope 4 failed).
- `gc-201-32-gates: vitest=green eslint=clean tsc=clean`

## Verify results

- Task 1 vitest set (9 files): 217 passed, 0 failed.
- Task 2 vitest set (4 files): 341 passed, 0 failed. NUL byte count of `src/lib/wizardErrors.test.ts`: 1 before and after.
- Task 3 vitest set (49 files): 1322 passed, 0 failed. `npx eslint` on every touched source and test file: no output. `npm run typecheck`: no output, no errors.
- Extra: `degrade-warning-scan` plus the copy/census/vocab tests in `src/__tests__` (11 files): 394 passed.
- `node scripts/verify-plan-anchors.mjs` on the canonical plan (phase worktree copy): 11 claims checked, OK. The plan worktree holds an older copy, so the check was run on a scratchpad copy of the canonical one.
- Acceptance greps: `egress-ip-status` in security page 1; `no static egress IP yet` 1; `EGRESS_IP_STATUS_LINK` in the hint 5; `current IP set` 0; `process.env` 0; `egress IP status` in wizardErrors.ts 3 (two strings plus one comment); `ask for our current egress IPs` 0; `docsHref: "/security#egress-ips"` 2; `EGRESS_IP_STATUS_LINK` in ErrorEnvelope.tsx 4; `linkText` in ContactPointerText.tsx 7.

## Deviations from Plan

None - plan executed as written. Two small notes: the page header comment first named the statement in words that raised the `no static egress IP yet` count to 2, so it was reworded to keep the acceptance count at 1; and the `plan_head_before` ledger file was not created, so `commits: 3` was measured from `git rev-list --count 7a8543ac6..HEAD`, the worktree's fork HEAD.

## Issues

- `docs/` hits for the old literals: none quote the old paragraph. `docs/runbooks/mt5-go-live.md` mentions "egress IP" only for the MT5 gateway and is unrelated.
- The sFOX guide's egress step (`for the current IP — we rotate infrequently`) was left untouched on purpose (A-12).
- `src/lib/wizardErrors.ts` also carries other `contact form` pointers, which are unchanged.

reported-not-edited: none. A re-grep of `ApiKeyManager.tsx`, `ConfirmKeyChangeDialog.tsx`, `e2e/api-key-flow.spec.ts` and `e2e/sync-analytics-flow.spec.ts` found no egress or IP-allowlist copy (their `allowlist` hits are the Origin/CSRF allowlist and a column projection).

cross-plan-pins: none. A grep of `src e2e tests docs` for the old plan-05 sentences, the old cause, "current IP set" and "rotate infrequently" found hits only in the six files this plan owns, plus the sFOX step in the security page.

todos-egress: When the static egress exists, replace the none-yet statement on `/security#egress-ips` with the address list (U-29: a server-only source, tests on RFC 5737 addresses) and point the sFOX guide's egress step at `#egress-ips` (A-12).

## Known Stubs

None.

## Threat Flags

None. The threat register's mitigations hold: T-201-42 (static none-yet copy, no dotted-quad in the section, test pinned), T-201-43 (both links render through `ContactPointerText` with `newTab`, `rel="noopener noreferrer"` asserted in the hint and envelope tests), T-201-44 (the envelope branch renders text nodes with a fixed href from the constant).

## Self-Check: PASSED

Created and modified files exist; commits 04d0ecf5f, 3c582c95d and 3f64f9ff4 are ancestors of HEAD.
