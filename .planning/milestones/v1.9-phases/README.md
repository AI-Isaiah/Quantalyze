# v1.9 phase artifacts — NOT RECOVERED

Milestone **v1.9 (Multi-Key Composite)** shipped and tagged: `v1.9 @ 044bee50`
(PR #607). Closure entry recorded in MILESTONES.md. **All code is in git and
safe.**

The local, gitignored phase working-dirs (plans / evidence / verification for
phases **85–91**) were deleted by a `phases.clear` run during
`/gsd-new-milestone v1.9.1` on 2026-07-11, before v1.9 was formally archived via
`/gsd:complete-milestone`. They existed only under `.planning/phases/` (local,
gitignored) so they are not recoverable from git. Time Machine local snapshots
(13:20 / 14:22) predated the clear and could have restored them, but recovery
required an interactive `sudo mount_apfs` and was deliberately skipped — the
durable milestone record (tag + MILESTONES.md + archived `v1.9-ROADMAP.md`) is
sufficient.

The v1.9 `REQUIREMENTS.md` was lost the same way (overwritten by v1.9.1's when
`/gsd-new-milestone` rewrote `.planning/REQUIREMENTS.md`), so there is no
`v1.9-REQUIREMENTS.md` in this archive either.

This stub exists so the `.planning/milestones/` archive convention (one
`vX.Y-phases/` dir per milestone) is not broken for future tooling. The
authoritative v1.9 record is **[../v1.9-MILESTONE-AUDIT.md](../v1.9-MILESTONE-AUDIT.md)**
plus the v1.9 entry in `.planning/MILESTONES.md`.
