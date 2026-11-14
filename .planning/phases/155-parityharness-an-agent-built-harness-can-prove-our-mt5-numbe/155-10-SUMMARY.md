---
phase: 155-parityharness-an-agent-built-harness-can-prove-our-mt5-numbe
plan: 10
subsystem: testing
tags: [mt5, parity, census, prod-capture, sha256-seal, records-cli]

requires:
  - phase: 155-parityharness plan 03
    provides: "the ten capture SQL files, the README run order, render-ordinal and labels procedure"
  - phase: 155-parityharness plan 04
    provides: "the throwaway-cluster execution test that proved every committed SQL file runs"
  - phase: 155-parityharness plan 08
    provides: "the records CLI (seal, census, scan) and the census renderer"
provides:
  - "155-CENSUS.md: the tracked pre-flight census record for MM2, MM3 and FX-AI_V (S, Friday-edge open P&L ratios, flags, unit, status, record length, computed_at, inception identity)"
  - "a sealed real PROD capture in the untracked, gitignored capture directory (raw/ plus sealed/ with sha256 sidecars and a manifest), for plan 11's dress rehearsal, surface matrix and findings"
affects: [155-11]

actuals:
  tokens: 3300
  tasks: 2
  commits: 1
plan_head_before: 6f4a02bc21872df6c3c5a3ec7f203656dd8c5e8d
plan_head_after: 2926f0d4eb016f6f2fa22a5acb457799576cd0c9

tech-stack:
  added: []
  patterns:
    - "The tracked census record is produced only by the renderer from sealed raw files; it is scanned (record profile) and never hand-edited"

key-files:
  created:
    - .planning/phases/155-parityharness-an-agent-built-harness-can-prove-our-mt5-numbe/155-CENSUS.md
  modified: []

key-decisions:
  - "labels.json written by the orchestrator was already in the format seal_capture expects (ordinal to label object, one entry per keymap ordinal); no conforming rewrite was needed and raw/ was not touched"

requirements-completed: []

coverage:
  - id: D1
    description: "The real PROD capture is sealed (bind witnesses equal before and after, row_count and day witnesses agree, every slice sha256-sealed) in the untracked capture directory"
    requirement: "PARITY-03"
    verification:
      - kind: command
        ref: "python3 -m scripts.mt5_parity_records seal --run-dir <capture dir> (exit 0, 'sealed'); sealed/manifest.json and manifest.json.sha256 exist"
        status: pass
    human_judgment: false
  - id: D2
    description: "155-CENSUS.md records, for each of the three accounts the keymap holds, S from raw marks / key inputs / flags with agreement, Friday-edge open P&L ratios with the weekend-window judgement, flag keys, unit, published status, record length, computed_at, the inception identity against MT5_INCEPTION_IDENTITY_BAND, and the server as unmeasured"
    requirement: "PARITY-04"
    verification:
      - kind: command
        ref: "python3 -m scripts.mt5_parity_records scan --profile record 155-CENSUS.md (exit 0)"
        status: pass
      - kind: command
        ref: "grep -c 'unmeasured (155.1 reading owns it)' 155-CENSUS.md (3, one per account)"
        status: pass
      - kind: command
        ref: "grep -cE '/(Users|home)/' 155-CENSUS.md (0)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The PROD read (marker query naming PRODUCTION first, fifteen calls in the runbook order) was done by the orchestrator through the Supabase MCP; its correctness as a read of the intended database rests on the orchestrator's marker reading, which this executor cannot re-measure"
    requirement: "PARITY-04"
    human_judgment: true
    rationale: "Executors never touch PROD; the marker answer is the orchestrator's reading, recorded here as reported in the resume signal"

duration: 5min
completed: 2026-11-13
status: complete
---

# Phase 155 Plan 10: PROD census and capture Summary

**The orchestrator's real PROD capture is sealed (bind witnesses equal) and the tracked pre-flight census for MM2, MM3 and FX-AI_V is rendered by the records CLI and passes the record-profile scan.**

## Task record

| Task | Name | Who | Result |
| ---- | ---- | --- | ------ |
| 1 | Orchestrator-only PROD census and capture through the Supabase MCP | orchestrator | complete before this run: run id `run-2026-11-13-2123`; marker named PRODUCTION (the orchestrator's reading); all fifteen calls in order from committed SQL text; `bind-before` and `bind-after` byte-identical; no truncation fallback needed |
| 2 | Seal the capture, render 155-CENSUS.md, scan it | executor | `seal` exit 0; `census` exit 0; record-profile `scan` exit 0 - commit `2926f0d4e` |

- Run id: `run-2026-11-13-2123`.
- Marker named PRODUCTION: yes, as reported by the orchestrator (the executor did not and could not re-measure it).
- keys_examined: 12 (twelve MT5 keys in the keymap); rows_examined: 18.
- Labels present: MM2, MM3 and FX-AI_V, all three. The other nine ordinals are `excluded`.
- The capture path is not recorded here by design.

## What the census shows (labels, dates and 3 s.f. ratios only)

- S is 2026-10-26 for all three accounts, and the raw-marks, key-inputs and flags readings all agree.
- All three are USD, native unit marked, status private, computation complete, with 18 marks each, the last mark day 2026-11-12.
- Record spans: FX-AI_V 169 days (170 observations, from 2026-05-26); MM2 and MM3 234 days (235 observations, from 2026-03-21).
- Flag keys on every account: `csv_source`, `cumulative_method`, `marks_covered_from`, `marks_since`.
- Inception identity ratios are of order 1e-16 on all three, inside `MT5_INCEPTION_IDENTITY_BAND`.
- Friday edges since S (2026-10-30 and 2026-11-06): every edge has a mark, and every weekend window is judged `attested`. FX-AI_V open P&L ratios are 0.0112 and 0.00419; MM2 and MM3 are 0.00259 and 0. The two Friday edges for MM2 and MM3 are close to identical.
- Keys sharing a login: MM2 has 1, the others 0 (a count only, no login). This matches the standing note that one account under several keys is intended.
- Server: `unmeasured (155.1 reading owns it)` for all three, as decided.

## Deviations from Plan

None - plan executed exactly as written. Task 1 was already complete when this run started, and `labels.json` needed no conforming rewrite.

## Authentication Gates

None for the executor. Task 1 was the orchestrator's PROD step, resolved before this run.

## Verification

- `seal` exit 0; `sealed/manifest.json` and `sealed/manifest.json.sha256` exist, with fourteen sealed files, twelve labels and one bind witness.
- Record-profile scan exit 0; `grep -c "unmeasured (155.1 reading owns it)"` is 3; `grep -cE "/(Users|home)/"` is 0.
- `git status --short` shows nothing under `.mt5-parity/` (gitignored).
- Gate failure is not re-shown in this plan: the seal and scan gates were proven able to fail in plans 01, 07 and 08, and no gate code changed here.
- No PROD contact, gateway call, derive, sync or analytics recompute by the executor. No analytics code changed, so mypy was not re-run.

## Notes for later plans

- `docs/runbooks/mt5-parity/README.md` names `mt5_parity_records` but not `mt5_parity_run` (the 155-07 note). It is not in this plan's `files_modified`, so it is left for plan 11 or a follow-up to document.
- The sealed manifest holds the labels, so plan 11's real-mode surface matrix and findings read them from `manifest.json`.
- Both accounts MM2 and MM3 show the same record span, last return day and computed_at minute; the identical Friday-edge readings are consistent with that and are noted for the findings pass, not judged here.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or schema.

## Self-Check: PASSED

- FOUND: 155-CENSUS.md
- FOUND: commit 2926f0d4e on `feat/155-parityharness`
