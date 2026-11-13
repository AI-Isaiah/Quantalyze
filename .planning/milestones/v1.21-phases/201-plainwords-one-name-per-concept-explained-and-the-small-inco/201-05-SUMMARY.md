---
phase: 201-plainwords-one-name-per-concept-explained-and-the-small-inco
plan: 05
subsystem: ui-copy
tags: [copy, wizard, disclaimer, contact-pointer, jsx-whitespace]
requires: []
provides:
  - wizard IP-allowlist hint pointing at the security contact form
  - two wizardErrors fix bullets with no dead "docs link below"
  - disclaimer custody sentence rendering "does not operate"
affects: [201-19, 201-24]
tech-stack:
  added: []
  patterns: [ContactPointerText with contactHref and newTab, rendered-text test for a JSX whitespace join]
key-files:
  created:
    - src/app/(marketing)/legal/disclaimer/page.test.tsx
  modified:
    - src/app/(dashboard)/strategies/new/wizard/WizardIpAllowlistHint.tsx
    - src/app/(dashboard)/strategies/new/wizard/WizardIpAllowlistHint.test.tsx
    - src/lib/wizardErrors.ts
    - src/lib/wizardErrors.test.ts
    - src/app/(marketing)/legal/disclaimer/page.tsx
key-decisions:
  - "D-13: the egress IPs are not published, so the hint links the security-topic contact form instead of the security page anchor."
  - "D-23 / U-16: the bullets say to ask for the IPs through the contact form; docsHref values are untouched."
  - "D-14: one {\" \"} after the closing strong; the Disclaimer component's custody variant is untouched (D-24)."
requirements-completed: [CLAR-06]
status: complete
duration: 15min
completed: 2026-11-11
actuals:
  tokens: 3200
  tasks: 2
  commits: 2
plan_head_before: 8dbc36a02d92b8659c4807bd21ec248246a96756
plan_head_after: 497bfe410ae2c92a124f8a84a735aa025bface10
---

# Phase 201 Plan 05: egress-IP pointer and the disclaimer space Summary

The wizard's IP-allowlist hint now tells a manager to ask for the current egress IPs through the security-topic contact form (new tab), the two wizard error bullets that pointed at a docs link no component renders now say the same thing, and the disclaimer reads "does not operate" instead of "notoperate".

`commits: 2` and `plan_head_after` are measured over the two task commits; this SUMMARY's own docs commit comes after.

## Tasks

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (tracer) | Hint to contact form; two wizardErrors bullets (D-13, D-23) | ab1ce5b4a | WizardIpAllowlistHint.tsx and test, wizardErrors.ts and test |
| 2 | Disclaimer space (D-14) and join verdicts | 497bfe410 | disclaimer/page.tsx, disclaimer/page.test.tsx |

### Task 1

- `WizardIpAllowlistHint` renders the UI-SPEC sentence through `ContactPointerText` with a module-local `contactHref({ topic: "security" })` and `newTab`. The `WarningBanner` shell, `role="note"`, `aria-label` and classes are unchanged. Nothing is exported from a page file.
- `KEY_PERMISSION_DENIED` bullet 2 and `KEY_IP_ALLOWLIST` bullet 2 carry the UI-SPEC "After" text. Bullet counts, `fixRequires` alignment and every `docsHref` are unchanged (`ErrorEnvelope` already routes each `fix` line through `ContactPointerText`, so no component change).
- Tests: the hint test pins the sentence, the absence of any `egress-ips` href, and the single link (name, href equal to `contactHref({ topic: "security" })`, `target=_blank`, `rel`); `wizardErrors.test.ts` pins both bullets, the counts, no "docs link" wording and the `docsHref` regex.
- Tracer gate: the task verify (hint test, wizardErrors test, `no-email-in-copy`, security page test) re-ran green end to end before Task 2; interactive mode, automated-only verify, no checkpoint needed.

### Task 2

- The new `page.test.tsx` renders `RiskDisclaimerPage` and reads `container.textContent`. It failed at HEAD with the received text showing "does notoperate a fund", then passed after the `{" "}`.
- No other sentence in the paragraph changed.

## Neuter proofs (tests can fail)

Each neuter was made on a byte backup in the scratchpad and restored with `cp -p`; `cmp` exited 0 each time.

- Task 1, hint: restored the old inline `/security#egress-ips` anchor sentence in `WizardIpAllowlistHint.tsx`. Command: `npx vitest run "src/app/(dashboard)/strategies/new/wizard/WizardIpAllowlistHint.test.tsx" src/lib/wizardErrors.test.ts`. RED lines: `× links nothing to the egress-IP anchor, which holds no IPs (D-13)`, `× renders the UI-SPEC sentence, with the new-tab suffix only for assistive tech`, `× has one 'contact form' link to the security topic that opens in a new tab`.
- Task 1, wizardErrors (same run): reverted `KEY_IP_ALLOWLIST` bullet 2 to "Or, add our egress IPs to the allowlist. See the docs link below." RED line: `× the two egress-IP bullets send the user to the contact form, not to a docs link that never renders`. Total 4 failed, 286 passed; after restore 290 passed.
- Task 2: removed the `{" "}` from `disclaimer/page.tsx`. Command: `npx vitest run "src/app/(marketing)/legal/disclaimer/page.test.tsx"`. RED line: `× renders the custody sentence with a space between 'not' and 'operate'`; restore, GREEN 2/2.

gc-201-05-neuter: gate=WizardIpAllowlistHint.test.tsx+wizardErrors.test.ts result=red restored=identical
gc-201-05-neuter: gate=disclaimer/page.test.tsx result=red restored=identical
gc-201-05-gates: vitest=green eslint=clean tsc=clean

## RESEARCH section 8: flagged whitespace joins

I wrote a throwaway AST scan (TypeScript compiler API, scratchpad, not committed). First draft used `getText()`, which strips the JSX text's leading newline, so it found nothing, not even the known disclaimer bug. After switching to `getFullText()` it flagged `disclaimer/page.tsx` line 61 at the old HEAD blob and reproduced every site RESEARCH lists, so the scan is validated. Symbols are cited below; the scan's line numbers match RESEARCH's at HEAD.

| Site | Verdict |
|------|---------|
| `BridgeWidget` (two empty-state spans: "Last reviewed", "No reviews recorded yet.") | Compensated: the text follows a `·` dot span carrying `mr-2`; "Last reviewed" also ends in `{" "}`. |
| `ScenarioComposer` BTC Benchmark label | Compensated: swatch span inside a `flex items-center gap-1.5` label. |
| `ScenarioComposer` other hits (aum note, flagged-holdings plural, effective-bets sentence) | Not joins: each boundary is a `{" "}`, a leading-space fragment, or an intended plural suffix ("holding" plus `s`). |
| `OutcomesWidget` "Window open"; header ("Bridge outcomes" before the badge, "reallocations" before the pending clause) | Compensated: dot span in `flex gap-2`; badge in `flex gap-2` h3; pending clause is a template literal that starts with a space. |
| `FactsheetView` "Computed · not yet" | Compensated: dot span in `flex gap-1.5`. |
| `FactsheetView` sr-only stitched-keys sentence and the Display menu badge | Compensated: the sentence uses a leading-space string and `{" "}`; the badge is in `inline-flex gap-1`. |
| `MatchQueueIndex` "Engine:" | Compensated: dot span in an `inline-flex gap-1.5` button. |
| `MandateSaveStatus` "Mandate saved" and `NoteSaveStatus` "Note saved" | Compensated: icon span in an `inline-flex gap-1.5` span. |
| `PortfolioImpactPanel` "Current" and "Proposed" legend; the "Partial history" line | Compensated: swatch in `inline-flex gap-1.5`; the partial-history boundary ends in `{" "}`. |
| `RequestIntroButton` "Add mandate context (optional)" | Compensated: arrow span in a `flex gap-2` button. |
| `factsheet/[id]/not-found.tsx` "recent" and `<code>` and "row" | Compensated by `mx-1` on the code element (visual spacing only; `textContent` runs the words together). Intentional per RESEARCH, left alone. |
| `disclaimer/page.tsx` line 61 | Fixed here (D-14). The scan still lists it afterwards only because the previous sibling is now the `{" "}` expression. |

open-joins: none. Plan 201-24 has nothing to pick up from this scan.

## Deviations from Plan

None in behaviour. Two small adaptations:

- The hint's accessible name in jsdom is `contact form(opens in a new tab)` (the dom-accessibility-api drops the sr-only span's leading space; a browser keeps it). The link-name arm matches `/^contact form\s?\(opens in a new tab\)$/` and the sentence arm pins the full `textContent`, which does carry the space.
- The hint's sentence test pins `textContent` including the sr-only suffix, because that suffix is part of the rendered note. The visible sentence is the UI-SPEC text.

## Known Stubs

None.

## Threat Flags

None. T-201-07 mitigated: the hint's href comes only from `contactHref` with the closed constant topic `security`; no user text enters it.

## Notes for later plans

- `wizardErrors.ts` still carries retired words elsewhere; plan 201-19 owns those. This plan touched only the two bullets.
- Environment note: `node_modules` is a symlink to the primary checkout, which is why vitest stack traces show `../quantalyze/node_modules`.

## Self-Check: PASSED

- FOUND: the six touched files; commits `ab1ce5b4a` and `497bfe410` are ancestors of HEAD on `wt/201-p05`.
- STATE.md, ROADMAP.md, CHANGELOG.md, VERSION and TODOS.md not modified.
