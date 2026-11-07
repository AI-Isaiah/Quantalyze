---
phase: 192-publictruth-the-public-site-and-the-demo-tell-a-visitor-one
plan: 04
subsystem: marketing-security-page
tags: [security, trust, tls, fernet, retention, pdf, drift-tests]

requires:
  - phase: 192-publictruth
    provides: "192-EVIDENCE.md (plan 01): Fernet reading, key-storage code facts, four D-03 TLS handshakes, HSTS and certificate readings, Retention at HEAD"
provides:
  - "/security Key handling is the one full key-storage explanation (Fernet, per-credential DEK, KEK held only by the analytics service with a per-row KEK version, column-grant clause)"
  - "/security TLS sentence, In Transit row, At Rest row and retention paragraph match the recorded evidence"
  - "Packet HTML and the rebuilt public/security-packet.pdf state the same cipher, KEK location, TLS versions, retention and the four-venue exchange list, with the same Last reviewed date"
  - "Pins: three describes in security/page.test.tsx and the 'packet facts match /security (192)' describe, including a parity read of EXCHANGES"
affects: [192-10, "Phase 200 MANAGERKEYS (wizard key-storage copy, routed by 192-10)"]

actuals:
  tokens: 5000
  tasks: 3
  commits: 3
plan_head_before: 86a118d9c76e9a4e497f2ba4ee2f3decfb2496d6
plan_head_after: 0196fa967d24695108a87c7074a58ab4452a04a7

tech-stack:
  added: []
  patterns:
    - "Static-HTML packet pinned to a TS constant by a file-read parity test that throws when its marker is absent (never passes vacuously)"

key-files:
  created: []
  modified:
    - "src/app/(marketing)/security/page.tsx"
    - "src/app/(marketing)/security/page.test.tsx"
    - "scripts/build-security-packet.html"
    - "public/security-packet.pdf"
    - "src/__tests__/security-packet-date-drift.test.ts"

key-decisions:
  - "Evidence wins over UI-SPEC only where it differed: the cryptography docs line agrees with the UI-SPEC wording, so the UI-SPEC Fernet text was copied verbatim"
  - "Retention copy rewritten, not removed: 'Retention at HEAD' is determinate (no scheduled deletion, no window), so both documents say that instead of the old 30-day / removed-on-disconnect claims"
  - "'retention windows' in the Compliance paragraph became 'data retention' (no window exists); the PDF CTA caption keeps 'retention' because the packet still carries retention rows"
  - "Last reviewed bumped to 2026-11-07 (the execution date) in the page and the packet"

patterns-established:
  - "Packet parity test: extract the dd after a named dt, throw if the dt is missing, compare to a value derived from the real constant"

requirements-completed: [TRUST-01]

coverage:
  - id: D1
    description: "/security Key handling and At Rest row state Fernet (AES-128-CBC + HMAC-SHA256) and a KEK held only by the analytics service, with the per-row KEK version and the column-grant clause"
    requirement: TRUST-01
    verification:
      - kind: unit
        ref: "src/app/(marketing)/security/page.test.tsx#Phase 192 — /security is the one full key-storage explanation (D-01, D-02)"
        status: pass
    human_judgment: false
  - id: D2
    description: "/security TLS sentence and In Transit row follow the four recorded handshakes (1.3 and 1.2 accepted, 1.0 and 1.1 refused); no TLS or header configuration changed"
    requirement: TRUST-01
    verification:
      - kind: unit
        ref: "src/app/(marketing)/security/page.test.tsx#Phase 192 — /security TLS sentence matches the recorded handshakes (D-03)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Packet HTML and rebuilt PDF carry the same cipher, KEK location, TLS, retention and four-venue exchange facts, with the same Last reviewed date"
    requirement: TRUST-01
    verification:
      - kind: unit
        ref: "src/__tests__/security-packet-date-drift.test.ts#packet facts match /security (192)"
        status: pass
      - kind: other
        ref: "pdftotext public/security-packet.pdf - (Fernet present, AES-256, Vault and 30 days absent, one page)"
        status: pass
    human_judgment: false
  - id: D4
    description: "At-a-glance table with the longer At Rest control string wraps inside its cell with no horizontal page scroll at the 390px reflow floor"
    requirement: TRUST-01
    verification: []
    human_judgment: true
    rationale: "Layout reflow is the reflow sweep's backstop (plan must_haves, verification: backstop); no browser run was possible in this executor, so it is unmeasured here"

duration: 8min
completed: 2026-11-07
status: complete
---

# Phase 192 Plan 04: /security and the packet say one true thing Summary

**/security is now the one full, code-true explanation of key storage (Fernet, per-credential DEK, KEK held only by the analytics service, per-row KEK version), TLS (1.3 or 1.2, 1.0 and 1.1 refused) and retention, and the downloadable PDF was rebuilt from corrected HTML to say the same with the same date.**

## Performance

- **Duration:** about 8 min
- **Completed:** 2026-11-07
- **Tasks:** 3 (one tracer, two auto)
- **Files modified:** 5

## Accomplishments

- Key handling paragraph and At Rest row replaced with the UI-SPEC text verbatim; the old 256-bit GCM and Supabase Vault claims are gone from the page and the packet (`grep -c` for `AES-256-GCM`, `Supabase Vault` and `Vault` prints 0 in the page and in the packet HTML).
- TLS paragraph rewritten to "TLS 1.3 or TLS 1.2. The edge refuses TLS 1.0 and 1.1."; In Transit row now `TLS 1.3, TLS 1.2` / `TLS 1.0 and 1.1 refused at the edge; HSTS enabled`; packet gained an `In transit` row.
- Retention and exchange facts reconciled; PDF rebuilt twice (after Task 1, after Task 3), one page, 113733 bytes.
- Tracer feedback gate (auto mode): Task 1 `<verify>` re-run end to end after the commit-ready state and passed; log: Tracer verified end-to-end, expanding.

## Task Commits

1. **Task 1: cipher and KEK location end to end (tracer)** - `4bf40041d` (fix)
2. **Task 2: TLS sentence and In Transit row** - `872ee5b84` (fix)
3. **Task 3: retention and exchange list, PDF rebuilt** - `0196fa967` (fix)

## Optional sentences kept (Task 2) and the evidence lines they rest on

- Kept "HSTS is enabled for quantalyze.xyz with a one-year max-age." and the `; HSTS enabled` suffix on the In Transit detail: evidence section "HSTS and certificate (D-03)" records the served header `strict-transport-security: max-age=31536000; includeSubDomains`.
- Kept "Certificates are issued by a public CA and rotated automatically before expiry.": the same section records issuer `C=US, O=Let's Encrypt, CN=YR1` and a 90-day validity window (notBefore Oct 9 2026, notAfter Jan 7 2027). The evidence records the issuer and window, which is what the plan's condition asked for; it does not independently show the renewal mechanism, which Vercel manages, so "rotated automatically" rests on the 90-day Let's Encrypt window plus the plan's decision rule.
- Cut: "internal service-to-service calls use the same profile" and the analytics-service-to-exchange clause (not measured).
- The four `D-03 TLS` lines read refused, refused, accepted, accepted, identical to CONTEXT D-03, so the planned sentence was written unchanged.

## Retention (Task 3), from `Retention at HEAD:`

The line is determinate, not `undeterminable`: strategy fills and aggregate analytics have no scheduled deletion and no window; they live as long as their strategy row, a key disconnect leaves them, and account closure blanks identifying fields on fills without deleting rows. So the rows were rewritten, not removed:

- /security Data handling paragraph 1: "We run no scheduled deletion on fills or aggregates: they are kept for as long as the strategy they belong to exists ... Deleting a strategy removes its fills and aggregates. Disconnecting an exchange key does not by itself remove them. Closing your account deletes your stored API keys and blanks identifying fields on fills." (Strategy-delete cascade, key-disconnect and `sanitize_user` readings are the evidence's own.) The dead pointer "(see the section below on deletion)" was removed; no such section exists.
- Packet "Raw fills retention" and "Aggregate analytics" rows rewritten to the same statements; "Retained indefinitely" was also dropped because a strategy delete cascades.

## Packet text

`pdftotext -layout public/security-packet.pdf -` after the final rebuild:

```
LAST REVIEWED 2026-11-07
CIPHER                         Fernet (AES-128-CBC + HMAC-SHA256)
PER-ROW DEK                    Generated when the key is saved, wrapped by a platform KEK
KEK STORAGE                    Held only by the Python analytics service; each row records its KEK version
                               so the KEK can be rotated
IN TRANSIT                     TLS 1.3 and TLS 1.2 at the edge; TLS 1.0 and 1.1 refused
RAW FILLS RETENTION            No scheduled deletion; kept while the strategy exists. Account closure blanks
                               identifying fields on fills
AGGREGATE ANALYTICS            No scheduled deletion; kept while the strategy exists (Sharpe, Sortino,
                               drawdown, daily returns)
SUPPORTED EXCHANGES            Binance, OKX, Bybit, or Deribit (read-only scope on each)
```

`pdftotext ... | grep -c "AES-256|Vault|30 days"` prints 0; `grep -c "Binance, OKX, Bybit, or Deribit"` prints 1; `pdfinfo` reports 1 page.

## RED evidence (tests proven able to fail)

Each RED ran against HEAD's text via byte backups in the scratchpad (never git checkout, restore or stash), then the new file was restored with `cmp` confirming byte-equality.

- **Task 1**, new describes against the HEAD page and HEAD packet: 4 failed, 42 passed. Failing: `Key handling names Fernet, the per-row KEK version, and no unsupported cipher or Vault` (received the old "AES-256-GCM envelope encryption ... stored in Supabase Vault" text), `the at-a-glance At Rest row ...` (received `AES-256-GCM` / `Per-row DEK wrapped by Vault-held KEK`), `no part of the page still names the unsupported cipher or Vault-held KEK`, and the packet parity test `both state the cipher the code uses (Fernet) ...`. Semantic assessment: each failed on its planned content assertion, not on an import, render or setup fault. After the edit, with only the page reverted to HEAD, the three page tests went RED again and returned GREEN on restore. The "keeps the column-grant clause" test passed at HEAD by design (it preserves a true clause carried from HEAD).
- **Task 2**: 3 page tests RED against the Task 1 page (TLS sentence, dropped claims, In Transit row), 1 packet test RED against the Task 1 packet HTML (`In transit` row not found). The "keeps the recorded HSTS and certificate sentences" test passes at HEAD by design (preservation pin).
- **Task 3**: 5 RED (3 retention page tests, packet exchange parity, packet retention). The exchange test failed with `expected 'Binance, OKX, Bybit (read-only scope ...' to contain 'Binance, OKX, Bybit, or Deribit'`; the retention test failed on `not to match /30 days/`. After the edit, restoring the Task 2 packet HTML turned the two packet tests RED again (2 failed, 3 passed) and the new HTML turned them GREEN.

## Gates (run from the worktree root)

- `npx vitest run "src/app/(marketing)/security" src/__tests__/security-packet-date-drift.test.ts`: 2 files, 56 tests passed (security/page.test.tsx 51 including 11 new, security-packet-date-drift.test.ts 5 including 4 new).
- `npx tsc --noEmit`: exit 0.
- `npx eslint` on the page, its test and the drift test: exit 0.
- `npm run lint`: **exit 1, not caused by this plan.** `check-planning-hygiene` reports one ABSOLUTE-HOME-PATH violation at `.planning/phases/192-.../192-01-SUMMARY.md:110`, a plan 192-01 artifact that is already in this worktree's base (86a118d9c). The eslint portion reports 0 errors and 2 warnings in `src/lib/factsheet/composite-read-path.ts` and one sibling file (`nativeUnitReason`, `isRankableAnalyticsRow` unused), both outside this plan's files. Logged here, not fixed (scope boundary); the orchestrator or plan 01's owner should clear the home path before the phase ships.
- PDF build tool ran (local Chrome via puppeteer-core); the output is one page.
- Not run: the 390px reflow backstop for the At Rest control string (no browser in this executor; it belongs to the reflow sweep), and `bun test:e2e e2e/security-page.spec.ts` from the runbook's acceptance list.

## Decisions Made

See frontmatter `key-decisions`. No TLS, header or edge configuration file was touched (T-192-08): the plan's five files are the only ones changed.

## Deviations from Plan

None - plan executed as written. Two small judgment calls inside the plan's rules, both recorded above: the Compliance paragraph says "data retention" rather than dropping the word (the packet still carries retention rows), and the Last reviewed date is the execution date 2026-11-07. The plan said to commit once at the end of Task 3 with the five paths; per the dispatch's "each task committed individually", each task was committed with its own explicit `git add`.

## Issues Encountered

- `npm run lint` fails on a pre-existing planning-hygiene violation in a sibling plan's SUMMARY (see Gates).
- `Edit` required a `Read` of each file first; no effect on output.

## Known Stubs

None.

## Threat Flags

None. No endpoint, auth path, file-access pattern or schema change was introduced.

## User Setup Required

None.

## Next Phase Readiness

- Plan 192-10's ship gate can cite the rebuilt PDF and the parity tests. `ConnectKeyStep.tsx` and `MultiKeyConnectStep.tsx` still carry the old cipher and Vault wording; that is Phase 200 MANAGERKEYS scope, routed by 192-10, deliberately untouched here.

## Self-Check: PASSED

- FOUND: src/app/(marketing)/security/page.tsx, page.test.tsx, scripts/build-security-packet.html, public/security-packet.pdf, src/__tests__/security-packet-date-drift.test.ts
- FOUND commits: 4bf40041d, 872ee5b84, 0196fa967 (each an ancestor of HEAD)

---
*Phase: 192-publictruth*
*Completed: 2026-11-07*
