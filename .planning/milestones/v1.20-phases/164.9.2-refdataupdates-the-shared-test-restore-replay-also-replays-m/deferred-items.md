# Phase 164.9.2: deferred items (out of scope, found during execution)

## Plan 04, 2026-09-25

- **ci.yml `sql-gate-lint`, step "Assert the data-dependence scan PRINTED its corpus census"
  has the same `bash -e` defect plan 04 fixed in its two sibling steps.** Its comment repeats the
  false claim that `set -uo pipefail` WITHOUT `-e` lets a non-matching `grep` reach its
  MEASURE_FAIL. GitHub runs the step as `bash -e {0}`, so the unbounded `node … > "$MIGDEP_SCAN_LOG"`
  status capture and the unbounded `census=$(grep …)` die unnamed, before their `::error::` lines.
  The direction is safe (red, never green); what is lost is the named diagnosis.
  Not fixed here: the founder's approval for ci.yml edits in this phase covers only what plan 04
  specifies, and that step belongs to Phase 164.9 criterion 5. The remedy is the same shape as
  plan 04's: `status=0 … || status=$?`, `census_rc=0 … || census_rc=$?` with an rc>1 branch, and
  an executed harness arm with an `unbind` calibration.

  **✅ RESOLVED 2026-09-25 in commit `78f9871c4`** (founder decision the same day, "Fix in this
  PR"). The step now carries `status=0 … || status=$?` and `census_rc=0 … || census_rc=$?` with an
  rc>1 branch, beside a dated correction of the false comment (kept as lineage). The wiring harness
  executes the step body under `bash -e` with an `unbind` calibration per bound-dependent arm.
  The entry above is kept as lineage. Details: `164.9.2-04-SUMMARY.md`, section
  "164.9.2-04-FOLLOWUP".
