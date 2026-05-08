# Phase 19 — Stability Log (BACKBONE-04 / BACKBONE-09)

**Purpose:** Records the 7-calendar-day stability window between commit (b) flag-flip and commit (d) VIEW rename per BACKBONE-04. Plan-checker reads `flag_flipped_at` and asserts ≥168h delta before commit (d) ships.

## Flag Flip Timestamp

- **flag_flipped_at:** TODO (record from commit (b) timestamp; ISO-8601 UTC, e.g. `2026-05-15T14:00:00Z`)

## Daily Sentry Error-Envelope Rate (15-min tumbling windows averaged daily)

| Day | Date | Error rate (%) | /process-key calls | Errors | Notes |
|-----|------|----------------|--------------------|--------|-------|
| 1 | YYYY-MM-DD | 0.00 | N | M | first 24h post-flip |
| 2 | YYYY-MM-DD | 0.00 | N | M | |
| 3 | YYYY-MM-DD | 0.00 | N | M | |
| 4 | YYYY-MM-DD | 0.00 | N | M | |
| 5 | YYYY-MM-DD | 0.00 | N | M | |
| 6 | YYYY-MM-DD | 0.00 | N | M | |
| 7 | YYYY-MM-DD | 0.00 | N | M | ≥168h elapsed; commit (d) eligible if all rows below 0.5% |

## Daily vcrpy + repro-key-flow.sh Cassette Refresh (Theme 5)

| Day | OKX cassettes refreshed | Bybit cassettes refreshed | Result |
|-----|-------------------------|---------------------------|--------|
| 1 | 4/4 | 4/4 | ✓ |
| 2 | 4/4 | 4/4 | ✓ |
| ... | ... | ... | ... |

## Exit Criteria

- All 7 days at error rate < 0.5%
- ≥168h between flag_flipped_at and commit (d)
- Daily cassette refresh succeeded all 7 days
- Customer-feedback file (`.planning/phase-19/customer-feedback.md`) has ≥1 verbatim entry
