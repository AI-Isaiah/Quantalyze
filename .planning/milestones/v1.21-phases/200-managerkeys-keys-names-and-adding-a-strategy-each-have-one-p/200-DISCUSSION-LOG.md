# Phase 200: MANAGERKEYS — keys, names and adding a strategy each have one place - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-11-10
**Phase:** 200-managerkeys-keys-names-and-adding-a-strategy-each-have-one-place
**Areas discussed:** Feeds display, Re-point confirmation, Key manager home, Rename place and public name, Add-a-strategy entry point, Security explanation

The founder was not available. Every area took the recommended option (marked ✓), recorded in CONTEXT.md as "(orchestrator default, founder may revisit)".

---

## Feeds display

| Option | Description | Selected |
|--------|-------------|----------|
| Both link kinds, one server read | `api_key_id` + `strategy_keys`, ownership-checked, honest failure | ✓ |
| Single-key links only | Misses composites | |
| Browser read through RLS | RLS filters rather than errors (167.2.1 lineage) | |

## Re-point confirmation

| Option | Description | Selected |
|--------|-------------|----------|
| Confirm every write of `api_key_id` on an existing strategy, first links included | Names strategy + current key (or "none") + new key | ✓ |
| Confirm only key-to-key changes | First link unconfirmed | |
| Remove re-pointing entirely | Loses a needed remedy | |

## Key manager home

| Option | Description | Selected |
|--------|-------------|----------|
| Account-level list on Profile, all key-holding roles; edit page keeps current key + "Change key…" | One manager, feeds visible | ✓ |
| Keep edit-page manager as the one manager | Allocators have no strategy page | |
| New standalone /keys page | New route, more surface | |

## Rename place and public name

| Option | Description | Selected |
|--------|-------------|----------|
| Edit page via existing dialog + name route; remove other Rename controls; show what public surfaces actually render | Reuses gated writer | ✓ |
| Strategies list as the place | List rows are crowded; edit page already holds the name | |
| Keep preset dropdown | Second ungated writer of `name` | |

## Add-a-strategy entry point

| Option | Description | Selected |
|--------|-------------|----------|
| Wizard is the one flow; one control on `/strategies`; allocator overlay mounts the same wizard | Respects Phase 109 / 199 CD-10 | ✓ |
| Open the wizard route to allocators | Breaks the Phase 109 lock | |

## Security explanation

| Option | Description | Selected |
|--------|-------------|----------|
| `/security#key-handling`; in-app reuses `KEY_STORAGE_SENTENCE` + link; test fails on restated encryption detail | Builds on 192 | ✓ |
| Rewrite each in-app sentence to be correct | Still several restatements | |

## Claude's Discretion

Key-name fallback, dialog layout, batching of the feeds read, tab and button wording.

## Deferred Ideas

Unifying the public name across surfaces; allocator-book usage per key; renaming published strategies.
