# Onboarding Summary

Written 2026-08-14 by `/gsd-onboard` after migrating from gstack GSD v1.42.3 to
`@opengsd/gsd-core` v1.10.0. ⭐ **This is a re-onboard of a mature project, not a
greenfield init** — the projection returned `next_action: write-summary`, meaning every
planning artifact and a complete codebase map already existed and nothing was overwritten.

## Project State
- PROJECT.md: present (335 lines)
- REQUIREMENTS.md: present (1,526 lines) — ⛔ carries THREE milestones' rows: v1.17 (closed),
  v1.16 (PARKED, live work), v1.18 (carried). Do not let any workflow delete it.
- ROADMAP.md: present (1,491 lines) — v1.18 current, v1.17 closed, v1.16 parked, all in one file
- STATE.md: present (1,416 lines)

## Codebase Context
- Brownfield repo: yes
- Map readiness: complete
- Codebase map: `.planning/codebase/` — STACK, ARCHITECTURE, STRUCTURE, CONVENTIONS, TESTING,
  INTEGRATIONS, CONCERNS (7/7)
- Fast map available: yes

## Docs Context
- Existing ADR/PRD/SPEC/RFC candidates: 25 (`docs/architecture/adr-*.md`)
- ⛔ NOT ingested. `/gsd-ingest-docs` was deliberately not run: the ADRs are already the
  authoritative record and are cited throughout REQUIREMENTS.md and the phase artifacts.
  Ingesting them would create a second copy of decisions that already have one home —
  the duplicate-source problem, not a gain.

## Migration notes (read before trusting old muscle memory)
- Runtime dir renamed: `~/.claude/get-shit-done/` → `~/.claude/gsd-core/`. The OLD directory
  still exists, so in-flight sessions did not break, but new workflows resolve to `gsd-core/`.
- 71 skills installed; 127 total in `~/.claude/skills`.
- ⚠️ **Local patches from v1.42.3 were NOT reapplied.** Three files were modified in the old
  install (`get-shit-done/templates/VALIDATION.md`, `get-shit-done/workflows/execute-phase.md`,
  `agents/gsd-plan-checker.md`). They are preserved with pristine hashes in
  `~/.claude/gsd-local-patches/` (`backup-meta.json` records `from_version: 1.42.3`).
  **Why not reapplied:** the old and new workflow files diverge by ~1,100 lines — this is a
  different product, not a newer revision of the same file, so a merge would be guesswork.
  Reversible: `/gsd-update --reapply`, or diff by hand.
- Backup of the pre-migration `~/.claude/{get-shit-done,skills}` tree: see
  `gsd-backup-path.txt` in the session scratchpad (514 MB tarball).

## Recommended Next Step
- `/gsd-manager`
- ⭐ **Actual next work: v1.16, PARKED at 13/19 phases.** Resume at **Phase 143**, then
  144 → 145 → 146. That order is a DECLARED DEPENDENCY CHAIN (144←143, 145←144; 146 last so
  its gap list comes from a fresh grep), not a preference.
- ⛔ v1.18 (Phases 155, 157) is entirely founder-gated — new MT5 investor passwords AND the
  founder at the terminal on a trading day. No agent can advance it.
