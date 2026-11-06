---
phase: 185-deribitflowtime-a-deribit-day-s-return-is-measured-against-t
plan: 06
status: complete
---

# 185-06 SUMMARY: founder questions F1, F6 and F5

Asked by the orchestrator with AskUserQuestion on 2026-11-01. F1 and F6 were answered before the
dry run and are recorded as D-05 and D-06; the dry-run gate (D-10) kept F1 standing, with the cash
basis and flag (D-07) where the smoothed build refuses. F5 was answered after the dry run.

f1-answer: f1-a

f6-answer: f6-a

f5-answer: f5-a

f5-route: none

- F1 (D-05): "Smoothed (Recommended)". Allocator books use the smoothed options basis.
- F6 (D-06): "No new switch (Recommended)". It ships live; rollback is reverting the merge.
- F5 (D-12): "No, strategies stay cash (Recommended)". A strategy's headline stays on the cash basis; this phase stays scoped to allocator books.
