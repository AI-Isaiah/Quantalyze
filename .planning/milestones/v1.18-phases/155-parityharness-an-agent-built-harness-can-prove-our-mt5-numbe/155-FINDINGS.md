# MT5 parity findings

Flag classes are a PROPOSAL for the Phase 155.2 founder sign-off, never a final acceptance.

## Findings

- F-155-01 [cross_store] FX-AI_V cross_store, bucket unexplained: the strategy series and the per-key return rows differ on 134 of 171 days compared, first on 2026-05-26
- F-155-02 [cross_store] MM2 cross_store, bucket unexplained: the strategy series and the per-key return rows differ on 113 of 237 days compared, first on 2026-03-21
- F-155-03 [cross_store] MM3 cross_store, bucket unexplained: the strategy series and the per-key return rows differ on 113 of 237 days compared, first on 2026-03-21
- F-155-04 [flag] FX-AI_V csv_source, bucket unknown: stored flag csv_source is outside the closed flag table; 155.2 classifies it
- F-155-05 [flag] MM2 csv_source, bucket unknown: stored flag csv_source is outside the closed flag table; 155.2 classifies it
- F-155-06 [flag] MM3 csv_source, bucket unknown: stored flag csv_source is outside the closed flag table; 155.2 classifies it
- F-155-07 [surface] FX-AI_V allocations_live_baseline.cumulative_return, bucket unexplained: allocations_live_baseline and the factsheet cell disagree on cumulative return by 1.73 times the parity tolerance
- F-155-08 [surface] FX-AI_V allocations_live_baseline.last_return_date, bucket unexplained: series ends on a different day: allocations_live_baseline ends 2026-11-12, the factsheet cell ends 2026-11-11
- F-155-09 [surface] FX-AI_V allocations_live_baseline.sharpe, bucket unexplained: allocations_live_baseline and the factsheet cell disagree on Sharpe at three significant figures and no reannualization explains it
- F-155-10 [surface] FX-AI_V scenario_composer_book.cagr, bucket unexplained: scenario_composer_book and the factsheet cell disagree on CAGR by 3.52 times the parity tolerance and no reannualization explains it
- F-155-11 [surface] FX-AI_V scenario_composer_book.cumulative_return, bucket unexplained: scenario_composer_book and the factsheet cell disagree on cumulative return by 1.73 times the parity tolerance
- F-155-12 [surface] FX-AI_V scenario_composer_book.last_return_date, bucket unexplained: series ends on a different day: scenario_composer_book ends 2026-11-12, the factsheet cell ends 2026-11-11
- F-155-13 [surface] FX-AI_V scenario_composer_book.sharpe, bucket unexplained: scenario_composer_book and the factsheet cell disagree on Sharpe at three significant figures and no reannualization explains it
- F-155-14 [surface] FX-AI_V scenario_composer_route.sharpe, bucket unexplained: scenario_composer_route and the factsheet cell disagree on Sharpe at three significant figures and no reannualization explains it
- F-155-15 [surface] MM2 allocations_live_baseline.last_return_date, bucket unexplained: series ends on a different day: allocations_live_baseline ends 2026-11-12, the factsheet cell ends 2026-11-10
- F-155-16 [surface] MM2 allocations_live_baseline.sharpe, bucket unexplained: allocations_live_baseline and the factsheet cell disagree on Sharpe at three significant figures and no reannualization explains it
- F-155-17 [surface] MM2 scenario_composer_book.last_return_date, bucket unexplained: series ends on a different day: scenario_composer_book ends 2026-11-12, the factsheet cell ends 2026-11-10
- F-155-18 [surface] MM2 scenario_composer_book.sharpe, bucket unexplained: scenario_composer_book and the factsheet cell disagree on Sharpe at three significant figures and no reannualization explains it
- F-155-19 [surface] MM2 scenario_composer_route.sharpe, bucket unexplained: scenario_composer_route and the factsheet cell disagree on Sharpe at three significant figures and no reannualization explains it
- F-155-20 [surface] MM3 allocations_live_baseline.cumulative_return, bucket unexplained: allocations_live_baseline and the factsheet cell disagree on cumulative return by 1.27 times the parity tolerance
- F-155-21 [surface] MM3 allocations_live_baseline.last_return_date, bucket unexplained: series ends on a different day: allocations_live_baseline ends 2026-11-12, the factsheet cell ends 2026-11-10
- F-155-22 [surface] MM3 allocations_live_baseline.max_drawdown, bucket unexplained: allocations_live_baseline and the factsheet cell disagree on max drawdown by 1.15 times the parity tolerance
- F-155-23 [surface] MM3 allocations_live_baseline.sharpe, bucket unexplained: allocations_live_baseline and the factsheet cell disagree on Sharpe at three significant figures and no reannualization explains it
- F-155-24 [surface] MM3 scenario_composer_book.cagr, bucket unexplained: scenario_composer_book and the factsheet cell disagree on CAGR by 1.2 times the parity tolerance and no reannualization explains it
- F-155-25 [surface] MM3 scenario_composer_book.cumulative_return, bucket unexplained: scenario_composer_book and the factsheet cell disagree on cumulative return by 1.27 times the parity tolerance
- F-155-26 [surface] MM3 scenario_composer_book.last_return_date, bucket unexplained: series ends on a different day: scenario_composer_book ends 2026-11-12, the factsheet cell ends 2026-11-10
- F-155-27 [surface] MM3 scenario_composer_book.max_drawdown, bucket unexplained: scenario_composer_book and the factsheet cell disagree on max drawdown by 1.15 times the parity tolerance
- F-155-28 [surface] MM3 scenario_composer_book.sharpe, bucket unexplained: scenario_composer_book and the factsheet cell disagree on Sharpe at three significant figures and no reannualization explains it
- F-155-29 [surface] MM3 scenario_composer_route.sharpe, bucket unexplained: scenario_composer_route and the factsheet cell disagree on Sharpe at three significant figures and no reannualization explains it

## Observations

- FX-AI_V share_card: not_rendered_while_unpublished
- FX-AI_V factsheet_pdf: not_rendered_while_unpublished
- FX-AI_V discovery_card: not_rendered_while_unpublished
- MM2 share_card: not_rendered_while_unpublished
- MM2 factsheet_pdf: not_rendered_while_unpublished
- MM2 allocations_strategies_panel: not_applicable:not_own_capital
- MM2 discovery_card: not_rendered_while_unpublished
- MM3 share_card: not_rendered_while_unpublished
- MM3 factsheet_pdf: not_rendered_while_unpublished
- MM3 discovery_card: not_rendered_while_unpublished

## Flag classification (proposed)

### FX-AI_V (computed 2026-11-12T00:26Z)

- csv_source: unknown
- cumulative_method: explained_acceptable
- marks_covered_from: explained_acceptable
- marks_since: explained_acceptable

### MM2 (computed 2026-11-11T01:36Z)

- csv_source: unknown
- cumulative_method: explained_acceptable
- marks_covered_from: explained_acceptable
- marks_since: explained_acceptable

### MM3 (computed 2026-11-11T01:36Z)

- csv_source: unknown
- cumulative_method: explained_acceptable
- marks_covered_from: explained_acceptable
- marks_since: explained_acceptable
