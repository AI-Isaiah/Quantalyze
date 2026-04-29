@AGENTS.md

## Test Coverage

The TypeScript test suite tracks coverage via `@vitest/coverage-v8`. Run
`npm run test:coverage` to produce a v8 report (text + HTML + JSON
summary in `coverage/`).

- **Minimum**: 60% lines / functions / branches / statements. Configured
  as a Vitest threshold in `vitest.config.ts` so the local run fails the
  reporter if a regression dips below the floor.
- **Target**: 80%, matching the `--cov-fail-under=80` gate the
  `analytics-service/` Python suite already enforces.

Coverage is currently measurement-only — it is NOT a blocking CI gate.
Promoting it to a gate is a separate decision tracked in the long-tail
tech-debt backlog.

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
