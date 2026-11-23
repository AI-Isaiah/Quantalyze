---
phase: 220-extractor-the-baseline-re-dump-carrying-phase-219-s-migratio
audited: 2026-11-20
asvs_level: 1
block_on: high
verdict: SECURED
threats_total: 8
threats_closed: 8
threats_open: 0
audited_head: d7ec9cd41
diff_range: e4899ee74..HEAD
---

# Phase 220 Security Audit

Verdict: SECURED. Every `mitigate` threat has its mitigation in code at HEAD, and the one `accept` has its rationale present in the diff. `threats_open: 0`.

Scope: `git diff e4899ee74..HEAD -- scripts src` is exactly three files: `scripts/local-stack/nonpublic-objects.mjs`, `scripts/local-stack/nonpublic-catalogue.sql`, `src/__tests__/local-stack-lane-wiring.test.ts`. `package.json`, `package-lock.json` and `analytics-service/` are unchanged.

## Threat Verification

| Threat ID | Category | Severity | Disposition | Status | Evidence |
|-----------|----------|----------|-------------|--------|----------|
| T-220-01 | Tampering | medium | mitigate | CLOSED | `nonpublic-objects.mjs` `EVENT` accepts `UPDATE OF` followed only by `IDENT(, IDENT)*`. `CREATE_SHAPE` stays `^...$` anchored and has no WHEN, REFERENCING or CONSTRAINT production. Pinned by the existing WHEN arm (`local-stack-lane-wiring.test.ts:772`), M2 (REFERENCING) and M3 (CONSTRAINT, even with UPDATE OF). SUMMARY records M2 RED under Neuter D and M3 RED under Neuter E, each restored byte-identical (`cmp`). |
| T-220-02 | Tampering | high | mitigate | CLOSED | `check()` pushes `DIFFERS ... update-of columns lane=... declared=...` whenever `got.columns !== d.columns`. This is a set compare, because both sides are sorted. It sits inside the loop over declared triggers, so narrowed, widened and emptied lanes all differ. Arms R1 (name vs email), R2 (plain AFTER UPDATE widened on lane), R3 (declared OF, lane plain) and R4 (narrowed) pin it. SUMMARY records all four RED under Neuter A. Real PostgreSQL forced-drift run: `--check` exit 1 with the update-of columns DIFFERS line. |
| T-220-03 | Tampering | medium | mitigate | CLOSED | `parseCatalogue` trigger branch requires `f.length === 7`, so a 6-field row falls through to the unrecognised-line MEASURE_FAIL. Field 7 is re-sorted in JS (`f[6].split(",").sort().join(",")`) and an empty element is refused. M1 pins the 6-field case, RED under Neuter B. The SFH-02 arm (phone,email on the lane vs declared email, phone) pins the lane-side re-sort, shown RED by neuter in commit 18521d1b0 (REVIEW). |
| T-220-04 | Tampering | low | mitigate | CLOSED | `foldAuthTriggers` runs `/[,\|]/.test(col)` on each folded column and calls `measureFail`. M4 pins it, RED under Neuter C. |
| T-220-05 | Information Disclosure | low | accept | CLOSED (accepted risk) | The new DIFFERS line prints only auth.users column names, which are public schema identifiers. No statement text, DSN or password is added to any output. The diff touches only the findings string and header docs. Accepted risk logged here. |
| T-220-06 | Tampering | high | mitigate | CLOSED | No repo code writes to a database in this phase: the diff touches only the extractor, the read-only catalogue SELECT and the tests. The `run.sh` diff is empty. The plan's Task 3 evidence (SUMMARY) is `--assert-local-handoff` passing before the DROP/CREATE on a runner-private loopback lane, a DSN taken from the copy's `.stack-env` and never printed, and `down` run afterwards with 0 containers left. That is execution evidence in the SUMMARY, not something a grep of the code can re-prove. |
| T-220-07 | Tampering | medium | mitigate | CLOSED | `git diff e4899ee74..HEAD --name-only` outside `.planning` lists exactly the three files. Working tree clean (`git status --porcelain` empty). No re-dump file (`baseline.sql`, carried marker, `BASELINE.md`), fixture or migration reached the branch. |
| T-220-SC | Tampering | high | mitigate | CLOSED | No dependency manifest or lockfile changed in the diff range, so nothing was installed. |

## Notes (non-blocking, none counts toward threats_open)

- **Test run:** `npx vitest run src/__tests__/local-stack-lane-wiring.test.ts` at HEAD: 74 passed on three of four runs. One run reported "1 failed | 73 passed" and I did not capture which arm. Three consecutive later runs were fully green, and the tree was clean and unchanged between runs. This looks like load-related flake (the failing run took 59s against 35s for the green ones), but it is unattributed, so it is recorded here rather than dismissed.
- **LR-01 (REVIEW, low):** whitespace collapsing could read a quoted `UPDATE OF` column containing runs of spaces as false DRIFT. It fails loud, never silent, so it is not a gate bypass.
- **IN-01 (REVIEW, info):** a lane-side column named `a,b` is ambiguous with `a` and `b` in the catalogue field. A real lane cannot reach it, since the lane's trigger is created from the emitted bytes.
- **T-220-06 caveat:** verified from the SUMMARY's recorded evidence and the absence of any code path that writes. I did not re-run Task 3.

## Unregistered Flags

None. SUMMARY `## Threat Flags` says None, and the diff adds no new network, auth or file-write surface.
