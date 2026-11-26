---
phase: 235
review: 235-REVIEW.md
titles: json
findings:
  - id: WR-01
    severity: medium
    disposition: fixed
    title: "HOLD-05 suppressed the book-level shared-account line using TS-side groups that do not match the derive's groups"
  - id: WR-02
    severity: medium
    disposition: fixed
    title: "A failed native-unpriced marker read in the matcher was swallowed while the batch it feeds is persisted"
  - id: IN-01
    severity: info
    disposition: open
    title: "The match AUM still ignores the clean-poll evidence Holdings uses, so a multi-key account whose newest clean poll read nothing can count differently in matching and on Holdings"
open: 1
total: 3
recorded: 2026-11-26T15:53:18.344Z
---

# Phase 235: Code Review Disposition

| Finding | Severity | Disposition | Source |
|---------|----------|-------------|--------|
| WR-01 | medium | fixed | round-1 fix: a group named only by the undated line keeps the book line (derive count not in payload, no cheap path); CONTEXT note 2026-11-26 |
| WR-02 | medium | fixed | round-1 fix: rows kept, `unpriced_check_failed` returned, persisted batch carries a book-level holding_flags entry; CONTEXT note 2026-11-26 |
| IN-01 | info | open | Info, never fixed (repo rule); recorded here only |

Dispositions: `open` (recorded, not yet triaged), `fixed`, `skipped`, `deferred`.
Set `deferred` by hand and put the reason in the Source cell; both are preserved. A `|` in the reason is kept as prose and escaped on the next run.
Re-running the gate keeps every row it can. A row the current review no longer reports is kept and its Source cell flagged, so a finding does not leave this record silently. ONE exception: when a finding id is REUSED by a different finding, the earlier decision cannot keep a row — the id is taken — and it is dropped. A RECORDED decision (anything but `open`) is named on the console when that happens; a row still at `open` is replaced silently, because `open` records no decision to lose.
