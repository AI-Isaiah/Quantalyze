# Audit Canonical Integration (2026-05-17)

Bookkeeping pass that canonicalizes the `audit-2026-05-07` campaign artifacts
locally in `.planning/audit-2026-05-07/` and records the data structure here so
future sessions can navigate. Local files are per-developer (gitignored); the
tracked substance of this PR is this runbook plus a VERSION bump.

> **Note:** this runbook documents the *campaign machinery* (the working set),
> which is intentionally local-only. The **durable record of what remains
> deferred** — finding IDs, defer rationale, and the "do NOT implement" landmine
> warnings — is tracked at [`docs/deferred-findings.md`](../deferred-findings.md).
> The working queue has since been relocated to
> `.planning/v1.0.0-DEFERRED-AUDIT-DECISIONS.md` (still gitignored).

## Scope

Three integration tasks, completed locally against
`.planning/audit-2026-05-07/` (gitignored, per-developer):

1. **G13–G22 specialist-run records** folded into `SPECIALIST-LOG.md`
   (1 new section: `## G13–G22 specialist + red-team fan-out (2026-05-16)`).
2. **HIGH-INVENTORY supplement** for G13–G22 CRITICAL + HIGH findings,
   grouped by file (alphabetic) — new file
   `HIGH-INVENTORY-G13-G22-2026-05-17.md`. The existing
   `HIGH-INVENTORY-2026-05-14.md` (S1a/S1b/S2/S3/S4 snapshot) is NOT modified.
3. **G23 retroactive-audit canonicalization** — five `.review/retro-audit-pr*.jsonl`
   files renamed and relocated to `findings/batch-G23.*.pr-NNN.jsonl`, plus an
   appended `## G23 retroactive audits (2026-05-16/17)` section in
   `SPECIALIST-LOG.md` and a per-file fold-in in `FIX-LIST.md`.

Companion bookkeeping:

- `PR-PLAN.md` and `SHIP-PLAN.md` each get a `## G13–G22 batch coverage`
  section mapping audit-campaign local PRs to the GitHub PRs that landed the
  fixes (#177 through #204).
- `pr-briefs/MISSING-PR-BRIEFS-G13-G22.md` (new) inventories the 27 of 36
  audit-campaign PRs that landed without dedicated briefs, with a known-debt
  decision rule for back-fill.

None of the above modifies the **content** of pre-existing FIX-LIST.md
entries — the G23 fold-in is appended below the existing entries.

## Data structure (`.planning/audit-2026-05-07/`)

```
.planning/audit-2026-05-07/
├── findings/                                # raw specialist JSONL output
│   ├── batch-G1.jsonl                       # round-1 specialist sweeps (G1–G12)
│   ├── batch-G10.partial.jsonl              # partial sweeps where applicable
│   ├── batch-G13.<specialist>.jsonl         # round-2 per-specialist sweeps (G13–G22)
│   │     # specialists: code-reviewer, silent-failure-hunter, type-design-analyzer,
│   │     #              pr-test-analyzer, security, performance, data-migration,
│   │     #              api-contract, red-team
│   └── batch-G23.<specialist>.pr-NNN.jsonl  # retroactive PR-specific sweeps
│         # specialists: migration-reviewer, rls-policy-auditor
├── pr-briefs/                               # per-PR fix briefs (round-1: PR-1..PR-9)
│   ├── PR-1-for-quants-analytics.md
│   ├── …
│   └── MISSING-PR-BRIEFS-G13-G22.md         # inventory of un-briefed PRs
├── FIX-LIST.md                              # canonical per-file fix index (append-only)
├── FIX-LIST-ATOMIC.md                       # atomic-ID provenance archive
├── FIX-LIST-G1-G7-ATOMIC.md                 # provenance archive
├── FIX-LIST-G8-G12-ATOMIC.md                # provenance archive
├── FIX-LIST-REFRESHED-2026-05-12.md         # 2026-05-12 refresh snapshot
├── FIX-LIST-FILTERED-OUT.md                 # all dedup/filter-removed records
├── fix-list-refresh-2026-05-14.md           # 2026-05-14 specialist verbose refresh
├── HIGH-INVENTORY-2026-05-14.md             # CRITICAL+HIGH by user-impact bucket (snapshot)
├── HIGH-INVENTORY-G13-G22-2026-05-17.md     # CRITICAL+HIGH by file (G13–G22 supplement)
├── PR-PLAN.md                               # 9-PR bundling plan for round-1
├── SHIP-PLAN.md                             # 8-worktree ship order for round-1
├── SPECIALIST-LOG.md                        # per (PR or batch, specialist) run records
├── PLAN.md                                  # original audit plan
├── PLAN-ROUND-2-CRITICAL.md                 # round-2 critical-only plan
├── INVEST-*.md                              # /investigate output archives
└── specialist-checklists/                   # checklist templates
```

## ID taxonomies

Three coexisting ID conventions appear in audit-2026-05-07 artifacts; they
are independent and do NOT cross-reference.

| Family | Format | Source | Used in |
|--------|--------|--------|---------|
| **C-/H-/M-/L-NNNN** | severity letter + 4-digit ordinal | `FIX-LIST.md` per-file blocks | FIX-LIST.md, FIX-LIST-FILTERED-OUT.md |
| **P-NNN / R-PNNN** | P-number from REFRESHED list | `FIX-LIST-REFRESHED-2026-05-12.md` | HIGH-INVENTORY-2026-05-14.md, FIX-LIST.md (as cross-references in evidence text) |
| **S{slice}-NNN** | slice prefix + 3-digit ordinal | `fix-list-refresh-2026-05-14.md` | HIGH-INVENTORY-2026-05-14.md |
| **G{batch}** | batch group (G1–G23) | raw specialist runs | FIX-LIST.md (per-finding `batches:` column), SPECIALIST-LOG.md |
| **G23-{pr}-{spec}-NN** | G23 retro-audit composite ID | this integration | HIGH-INVENTORY-G13-G22 supplement and FIX-LIST.md G23 section |

`G23-{pr}-{spec}-NN` is the only ID minted by this PR. All other IDs predate
this integration.

## Why `.planning/` is gitignored

`.gitignore:48-50` declares `.planning/` as a per-developer planning artifact
(gstack tooling convention). The directory accretes worktree-specific state
(specialist JSONL output, run logs, planning notes) that does not belong in
the shared repo — different developers will have different specialist runs,
different staging snapshots, different mid-flight investigation notes. The
durable substance of any audit landing into the repo lives in:

- Code changes (`src/`, `analytics-service/`, `supabase/migrations/`)
- Tests (`e2e/`, `tests/`, `__tests__/`)
- Documentation (`docs/runbooks/`)
- ADRs (`docs/adr/`)
- Long-lived planning docs (`tasks/` if used; project README)

The `audit-2026-05-07/` directory is a working set, not a deliverable.

## How to interpret the data

### Triage workflow

1. Start at **`FIX-LIST.md`** for the canonical per-file view (511 files
   across G1–G22, plus the G23 fold-in section at the bottom).
2. For G13–G22 CRITICAL + HIGH quick scan, use
   **`HIGH-INVENTORY-G13-G22-2026-05-17.md`** (sorted by file).
3. For S/R-prefixed items (older), use **`HIGH-INVENTORY-2026-05-14.md`**
   (sorted by user-impact bucket: ALLOCATOR / STRATEGY-TEAM / etc.).
4. For per-batch specialist run records (which batches ran, when, on which
   files), see **`SPECIALIST-LOG.md`** (the new G13–G22 and G23 sections at
   the bottom).
5. For raw findings (the input to all the above), the JSONL is under
   **`findings/batch-G*.jsonl`**.

### Closure cross-reference

The FIX-LIST.md's existing `## Summary` table records the closure pass already
done on 2026-05-17 (114 explicit ✅ CLOSED + 393 ⚠️ NEEDS-RE-VERIFY across the
58 files touched by PRs #169–#203). This PR does NOT modify those annotations
— the user's instruction was to add to FIX-LIST.md, not replace.

PRs that closed audit findings in this campaign window: #177, #178, #179, #180,
#181, #182, #183, #184, #185, #186, #187, #188, #189, #190, #191, #192, #193,
#194, #195, #196, #197, #203, #204. See SPECIALIST-LOG.md G13–G22 and G23
sections for the per-PR scope, and PR bodies on GitHub for the per-finding
closure manifest.

## Known gaps

- **27 of 36 audit-campaign PRs lack pr-briefs** (#55–#90 in the local PR
  numbering — see `pr-briefs/MISSING-PR-BRIEFS-G13-G22.md` for the inventory).
  Known-debt: low priority to back-fill. The per-PR scope is recoverable from
  the GitHub PR bodies + SPECIALIST-LOG.md.
- **Verification badges in FIX-LIST.md remain ⏳ for G13–G22 entries.** The
  post-merge re-verification was attempted but most agents aborted with API
  errors. Re-verification is queued as a separate workstream.
- **G23 schema differs from G1–G22.** G23 JSONL rows do not carry a `batch`
  field, a `specialist` field, or a `title` field — they use `summary` plus
  `recommended_fix` and optionally `leak_scope`. The canonical filename
  encodes (batch, specialist, pr-ref). Triage tooling that reads G1–G22 fields
  should treat G23 as a structural variant.
- One non-JSON trailing line survives in
  `findings/batch-G23.migration-reviewer.pr-193.jsonl`
  (`Findings summary: 0 CRITICAL, 1 HIGH, 3 MEDIUM, 0 LOW.`). It is parser
  noise — JSONL readers skip non-parseable lines.

## Convention reference for future sessions

- **Batch naming**: `batch-G{N}.{specialist}[.partial|.{pr-ref}].jsonl`
- **Finding IDs**:
  - Per-file FIX-LIST: severity-letter + 4-digit ordinal (`C-0123`, `H-0456`)
  - Per-batch HIGH-INVENTORY supplement: `G{N}-{cr|hi}-NNN` (where NNN is the
    JSONL row index)
  - Retro-audit G23: `G23-{pr}-{spec-prefix}-NN` (e.g. `G23-182-mig-01`)
- **Severity gates** (applied during FIX-LIST.md aggregation):
  CRITICAL all in · HIGH ≥ conf 7 · MEDIUM ≥ conf 8 · LOW ≥ conf 9
- **Closure markers** (in FIX-LIST.md per-finding annotations):
  `✅ CLOSED-by-PR-#NNN` (explicit), `⚠️ NEEDS-RE-VERIFY` (file touched,
  finding ID not enumerated), `⏳` (unverified prior).

## Cross-references

- `FIX-LIST.md` (gitignored) — canonical per-file index, append-only
- `SPECIALIST-LOG.md` (gitignored) — per-batch run records
- `HIGH-INVENTORY-2026-05-14.md` (gitignored) — S/R-prefixed inventory snapshot
- `HIGH-INVENTORY-G13-G22-2026-05-17.md` (gitignored) — G13–G22 supplement
- `pr-briefs/MISSING-PR-BRIEFS-G13-G22.md` (gitignored) — un-briefed PR inventory
- `docs/runbooks/fix-list-closure-2026-05-17.md` — referenced from the
  FIX-LIST.md top-of-file note as the per-finding closure rationale source.
  Not yet authored as of this PR; closure metadata currently lives inline in
  FIX-LIST.md per-finding annotations.
