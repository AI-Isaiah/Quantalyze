@AGENTS.md

## Test Coverage

The TypeScript test suite tracks coverage via `@vitest/coverage-v8`. Run
`npm run test:coverage` to produce a v8 report (text + HTML + JSON
summary in `coverage/`).

- **Gate (ratchet)**: lines 82 / statements 80 / functions 74 / branches 72,
  configured as Vitest thresholds in `vitest.config.ts`. These are set a few
  points under measured actual (2026-06-20: 85.2 / 83.3 / 77.4 / 75.5) so a
  real regression fails CI but normal noise does not. When actual climbs
  durably, raise the thresholds to match.
- **Target**: 80%, matching the `--cov-fail-under=80` gate the
  `analytics-service/` Python suite already enforces. Lines and statements
  already clear it; functions and branches are the next ratchet.

Coverage is **a blocking CI gate** as of tech-debt #11 (2026-06-20): the
`frontend-coverage` job in `.github/workflows/ci.yml` runs the full suite with
`--coverage` and the aggregator `frontend` check gates branch protection on it.
(The prior 60% floor was enforced nowhere — CI ran vitest sharded without
`--coverage`.)

## Design System
Always read DESIGN.md before making any visual or UI decisions.
All font choices, colors, spacing, and aesthetic direction are defined there.
Do not deviate without explicit user approval.
In QA mode, flag any code that doesn't match DESIGN.md.

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
- Save progress, checkpoint, resume → invoke checkpoint
- Code quality, health check → invoke health
- Tech debt, "what should we refactor", "code health", refactoring priorities, maintenance backlog → invoke engineering:tech-debt
- Architecture decision, ADR, "how should we architect", evaluate architecture, system design review → invoke engineering:architecture
