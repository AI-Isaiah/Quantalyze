## Summary

<!-- 1-2 sentences: what changed and why. Focus on the "why" — the diff
     shows the "what". -->

## Test plan

- [ ] `npm test` passes
- [ ] `npm run typecheck` passes
- [ ] `npm run build` passes
- [ ] `npm run lint` passes
- [ ] Playwright E2E specs for affected routes pass (if applicable)
- [ ] Manual smoke on the changed surface — describe what was tested and how

## Identity audit (per-chart)

For every chart added or modified inside `/strategy/[id]/v2` panels (or any
new chart added anywhere in the app), verify each chart against the
DESIGN.md identity rules:

- [ ] White card surface (`bg-card`)
- [ ] Strategy series uses `CHART_ACCENT` (`#1B6B5A`) — NOT `#0D9488` (legacy bright teal)
- [ ] Benchmark stroke uses `CHART_TEXT_MUTED` (`#94A3B8`), 1px width, dashed or 1px-vs-2px differentiation; never as text fill
- [ ] Positive cells (KPI strip) use `--color-positive` (`#16A34A`); negative cells use `--color-negative` (`#DC2626`)
- [ ] Gridlines (Recharts) use `CHART_BORDER` (`#E2E8F0`); lightweight-charts uses `--color-track` (`#F1F5F9`)
- [ ] No Plotly chrome (no modebar, no toolbar, no Plotly attribution)
- [ ] Axis ticks use `CHART_TICK_STYLE` token (Geist Mono 12px tabular-nums `#64748B` — DM Sans is wrong here; 11px is wrong here per the v2 4-size contract)
- [ ] No decorative animation; chart enter via Recharts default fade only (≤250ms)

## Notes

<!-- Anything else: screenshots, deviations from spec, deferred items,
     follow-up TODOs. -->
