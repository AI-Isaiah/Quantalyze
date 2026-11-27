# Phase 242: SECRETSHYGIENE - Pattern Map

**Mapped:** 2026-11-27
**Files analyzed:** 22 new or modified (plus 5 ship-record files)
**Analogs found:** 22 / 22 (3 are partial: the `.gitleaksignore` file, the `secret-scan-full-history.test.ts` behavioural arm, and the new gate arms are new shapes assembled from analogs)

All analog paths below were checked as git-tracked (`git ls-files` / `git show --stat eedbc2433`). No credential-shaped literal is quoted anywhere in this file; findings are referred to by file, rule and line only (RESEARCH.md holds the 31-row table).

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `.gitleaksignore` | config (suppression contract) | transform (read by scanner) | none in repo; format from RESEARCH Pattern 1. Loose analog `.gitleaks.toml` | no-analog (use RESEARCH) |
| `.github/workflows/secret-scan-full-history.yml` | CI workflow (scheduled scan + report job) | batch / event-driven (cron) | `.github/workflows/sql-mutation-nightly.yml` (schedule, concurrency, `report` job) + `supabase-migrate.yml:1324-1335` (gitleaks install) | exact (composite of two) |
| `src/__tests__/secret-scan-full-history.test.ts` | test (text pin + skipIf real-binary arm) | request-response (text assertions, spawnSync) | `src/__tests__/sql-mutation-nightly-parity.test.ts` (text pin, anchor-throw discipline, calibration) + `src/__tests__/gitleaks-allowlist.test.ts:34-61,265-346` (HAS_GITLEAKS skipIf arm) | role-match |
| `supabase/migrations/2026112…_cron_destinations_exact.sql` | migration (4x CREATE OR REPLACE SECDEF + CHECK swap + catalogue verify) | CRUD / request-response (DB function posting via pg_net) | `supabase/migrations/20261126180000_poll_positions_cohort_ccxt_venues.sql` (commit eedbc2433, #1383) for shape; bodies from `supabase/schema/functions/*.sql`; CHECK shape from `20260907120000_analytics_service_settings_and_vault_tick.sql:209-229,567-578` | exact |
| `supabase/migrations/down/2026112…-rollback.sql` | migration rollback (manual) | batch | `supabase/migrations/down/20261126180000-rollback.sql` | exact |
| `supabase/schema/functions/{match_engine_cron_tick,prod_prober_cadence_check,cron_sync_tick,ops_staleness_check}.sql` | generated snapshot | transform | same four files; `eedbc2433` regenerated `enqueue_poll_positions_for_all_strategies.sql` | exact (generated, never hand-edited) |
| `supabase/tests/test_cron_sync_tick.sql` | SQL gate (repoint 6 twins, +K1,+W1, strengthen P1) | request-response | itself (arms P1, V2, C2/C3 are the templates) | exact |
| `supabase/tests/test_ops_staleness_check.sql` | SQL gate (repoint 13 twins, +2 arms) | request-response | `test_cron_sync_tick.sql` | exact |
| `supabase/tests/test_prod_prober_cadence.sql` | SQL gate (repoint 7 twins, +2 arms) | request-response | `test_cron_sync_tick.sql` | exact |
| `supabase/tests/test_analytics_service_settings_and_vault_tick.sql` | SQL gate (repoint 6 twins, R3 stays, +U3,+C4,+V3) | request-response | itself (U2 + D1 for the CHECK arm; C2/C3, V2 for body arms) | exact |
| `scripts/mutation-floors.mjs` | config (ratchet constant + dated comment) | transform | `eedbc2433` diff of the `ARMS_FLOOR` block | exact |
| `.github/workflows/ci.yml` (sql-tests table rows + `ARMS_FLOOR=` sum) | CI census | transform | `eedbc2433` diff of ci.yml (7 lines) | exact |
| `src/__tests__/gate-family-meta.test.ts` | test census (`KNOWN_THRESHOLD_SITES` key) | transform | `eedbc2433` one-line diff | exact |
| `src/__tests__/drift-check-scripts.test.ts` | test census (title + two `grep -ac` args) | transform | `eedbc2433` diff | exact |
| `src/__tests__/mutation-runner-floors.test.ts` | test census (synthetic FULL log, per-file rows) | transform | `eedbc2433` diff (~41 lines) | exact |
| `src/__tests__/mutation-annotation-parser.test.ts` | test census (`armsSeen`, `stepsSeen`, `needles.length`) | transform | `eedbc2433` diff | exact |
| `src/__tests__/contracts/ci-anti-skip-gate.contract.test.ts` | test census (`okCount`) | transform | `eedbc2433` diff (likely NO move here; confirm by running) | exact |
| `docs/runbooks/prod-prober-cadence-go-live.md` (line 112), `docs/runbooks/ops-staleness-go-live.md` (line 134) | docs | n/a | themselves (restate the wildcard regex as the exact set) | n/a |
| `.planning/WINDOWS.md` entry 61 (row line 78; JSON id 61 near line 813) | records | n/a | hand edit, `git diff` after | n/a |
| `TODOS.md` | records | n/a | CLAUDE.md rule (b): delete `[SECRETSCAN-FULLHISTORY-01]` (line 4288) and `[167.1.2.2.2-CRON-TICK-RESIDUALS]` (line 2766); annotate (not delete) the dispatch entry | n/a |
| `CHANGELOG.md`, `VERSION`, `package.json` | release records | n/a | `eedbc2433` (one unified entry, byte-equal 4-digit version) | exact |

## Pattern Assignments

### `.github/workflows/secret-scan-full-history.yml` (CI workflow, scheduled batch)

**Analog A:** `.github/workflows/sql-mutation-nightly.yml` (top-of-file, schedule, permissions, concurrency, `report` job).
**Analog B:** `.github/workflows/supabase-migrate.yml` lines 1319-1335 (gitleaks install).

**Header-comment convention** (nightly lines 1-40): a `# WHAT THIS IS / WHY IT FAILS RED AND FILES AN ISSUE / WHY NO SHARED-TEST MUTEX` block. Copy the D-11 Railway coupling sentence into this header (nightly lines 17-23), adapting "nightly" to "scheduled full-history scan".

**Trigger / permissions / concurrency** (nightly lines 42-54):
```yaml
on:
  schedule:
    # 03:00 UTC, distinct from nightly.yml's 08:00 so the two never contend
    # for runners at the same minute.
    - cron: "0 3 * * *"
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: sql-mutation-nightly
  cancel-in-progress: false
```
Use cron `"30 5 * * *"` (03:00 nightly, 04:00 cassette, 08:00 nightly.yml: 05:30 free per RESEARCH) and `group: secret-scan-full-history`. No `push`/`pull_request` trigger (critical-regressions pins the merge-path set at 8 files).

**Checkout** (nightly lines 64-66; add `ref: main` and `fetch-depth: 0` per RESEARCH Pattern 2):
```yaml
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1  # v7.0.1
        with:
          ref: main
          fetch-depth: 0
          persist-credentials: false
```

**Install step, copy byte-for-byte** (supabase-migrate.yml 1319-1335, including the D-26 comment explaining why the checksum file is never fetched):
```yaml
      - name: Install gitleaks (sha256-pinned release binary)
        env:
          GITLEAKS_VERSION: 8.30.1
          GITLEAKS_SHA256: 551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb
        run: |
          set -euo pipefail
          tarball="${RUNNER_TEMP}/gitleaks.tar.gz"
          curl -fsSL -o "${tarball}" "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz"
          printf '%s  %s\n' "${GITLEAKS_SHA256}" "${tarball}" | sha256sum -c -
          mkdir -p "${RUNNER_TEMP}/gitleaks-bin"
          tar -xzf "${tarball}" -C "${RUNNER_TEMP}/gitleaks-bin" gitleaks
          echo "${RUNNER_TEMP}/gitleaks-bin" >> "${GITHUB_PATH}"
```

**Scan + count steps:** no analog in repo; use the actionlint-verified skeleton in RESEARCH.md Pattern 2 (`gitleaks git . --config .gitleaks.toml --log-opts=HEAD --redact --no-banner --exit-code 2 --report-format json --report-path "${RUNNER_TEMP}/gitleaks-report.json"`; exit 0/2 vs other; count step prints a number only; never `-v`; report never uploaded or committed).

**Report job, copy and adapt** (nightly lines 859-867 and 876-941; excerpts):
```yaml
  report:
    needs: [scan]
    if: always() && needs.scan.result != 'success'
    runs-on: ubuntu-latest
    timeout-minutes: 5
    permissions:
      contents: read
      issues: write
    steps:
      - name: Open or update the secret-scan issue
        uses: actions/github-script@3a2844b7e9c422d3c10d287c895573f7108da1b3  # v9.0.0
        env:
          RUN_ID: ${{ github.run_id }}
          REPO_NAME: ${{ github.repository }}
          JOB_RESULT: ${{ needs.scan.result }}
        with:
          script: |
            const dedupLabel = "nightly-canary-failure:secret-scan-full-history";
            // ... body ...
            const { data: existing } = await github.rest.issues.listForRepo({
              owner: context.repo.owner, repo: context.repo.repo,
              state: "open", labels: dedupLabel, per_page: 1,
            });
            if (existing.length > 0) {
              await github.rest.issues.createComment({
                owner: context.repo.owner, repo: context.repo.repo,
                issue_number: existing[0].number,
                body: `Failed again on ${today}.\n\n${body}`,
              });
              return;
            }
            await github.rest.issues.create({
              owner: context.repo.owner, repo: context.repo.repo,
              title: `...`, body, labels: ["nightly-probe", "security", dedupLabel],
            });
```
Differences from the nightly: drop the `download-artifact` step and the `reading` var entirely (nothing from the scan may reach the issue); the body carries ONLY the run URL, `JOB_RESULT`, the findings count (pass `needs.scan.outputs.findings` as env), the local reproduction command, the "rotate first if any finding could be live; suppress only fixtures by adding a four-part line" instruction, and the D-11 coupling sentence. No file, line, commit or fingerprint.

**Workflow-wide invariants to satisfy** (critical-regressions.test.ts, RESEARCH Pitfall 6): every `uses:` 40-hex SHA pinned; exactly one top-level `permissions:` containing `contents: read`; every checkout `persist-credentials: false`; no YAML anchors. Run `actionlint` on the file.

---

### `src/__tests__/secret-scan-full-history.test.ts` (test, text pin plus real-binary arm)

**Analog A:** `src/__tests__/sql-mutation-nightly-parity.test.ts` (text-only pin; anchor-throw; calibration).
**Analog B:** `src/__tests__/gitleaks-allowlist.test.ts` (HAS_GITLEAKS probe + `it.skipIf`).

**Text-only header + fail-loud anchor helper** (parity test lines 22-34, 62-71):
```typescript
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// ⛔ AN ABSENT ANCHOR IS A FINDING, NOT A VALUE. An unchecked indexOf -> slice
// degenerates (slice(-1) is the LAST character) and every assertion over the
// result then passes vacuously. Throw, and name the anchor.
function anchorIndex(text: string, anchor: string, from = 0): number {
  const at = text.indexOf(anchor, from);
  if (at < 0) {
    throw new Error(
      `ANCHOR MISSING: ${JSON.stringify(anchor)} is not present in the subject text. ` +
        `Fix the anchor or the subject; do not default it.`,
    );
  }
  return at;
}
```
The parity test's `jobSlice` (lines 74-80) is reusable to slice the `scan` and `report` jobs; copy it rather than regex the whole file. Its design rule (header lines 18-21): every predicate is a function over ARBITRARY text, and the calibration copies run through the SAME function, so a predicate that cannot fail is caught by its own calibration. Apply that to the ignore-file shape predicate: feed it a three-part line and an inline-comment line and require RED.

**Real-binary probe + skip gate** (gitleaks-allowlist.test.ts 55-61 and 315-318):
```typescript
function gitleaksAvailable(): boolean {
  const probe = spawnSync("gitleaks", ["version"], { encoding: "utf8" });
  return probe.status === 0;
}
const HAS_GITLEAKS = gitleaksAvailable();
// ...
  it.skipIf(!HAS_GITLEAKS)(
    "...",
    () => {
      const scratch = mkdtempSync(join(tmpdir(), "gitleaks-real-"));
      // ...
    },
    60_000,
  );
```
and the advertised skip reason arm at 452-458 (`it.skipIf(HAS_GITLEAKS)("advertises skip reason ...")`).

**What the file asserts** (from RESEARCH "Hermetic pin" and Validation map):
- `.gitleaksignore` entries (non-blank, non-`#`) all match `/^[0-9a-f]{40}:[^:\s#]+:[a-z0-9-]+:[0-9]+$/` (rejects three-part global lines and inline comments).
- Workflow text: `schedule` + `workflow_dispatch` only; no `push`/`pull_request`; `ref: main`; `--log-opts=HEAD`; `--redact`; no `-v`; sha256 string and `GITLEAKS_VERSION: 8.30.1` present; no `upload-artifact` / `git add` / `git commit` of the report; `issues: write` only in the `report` job (use `jobSlice`).
- Behavioural arm (skipIf): throwaway git repo, same fixture at one path in two commits, ignore file naming only the first commit's fingerprint -> first suppressed, second still reported; global three-part form suppresses both.
- **Build any key-shaped fixture at runtime** (`crypto.randomBytes(...).toString("hex")`), never as a source literal. `gitleaks-allowlist.test.ts` is path-allowlisted for its JWT fixture; this new file is not (RESEARCH Pitfall 3).

---

### `supabase/migrations/2026112…_cron_destinations_exact.sql` (migration, SECDEF function re-base)

**Analog:** `supabase/migrations/20261126180000_poll_positions_cohort_ccxt_venues.sql` (eedbc2433 / #1383, the last function-changing migration). Bodies to re-base come from the committed snapshots `supabase/schema/functions/{match_engine_cron_tick (96 lines), prod_prober_cadence_check (208), cron_sync_tick (155), ops_staleness_check (317)}.sql`. Re-check each snapshot against `git log origin/main -- supabase/migrations` and the PROD ledger before writing (Open Question 4).

**Header block shape to copy** (analog lines 1-100): a ⚠️ OPS paragraph (apply-test then auto-PROD, no human stop), a ⛔ FORWARD MIGRATION paragraph naming the re-based source migration per function and the measurement that no newer migration redefines it, a THE DEFECT section, a THE DELTA section ("every other line is the previous body byte for byte, the dollar-quote tag included"), and a VAC-04 section. Analog lines 69-92 for the pragma:
```sql
-- VAC-04 / DRIFT-02
-- ...
-- prod-body-ack: 0be4c891a557e7ab61c8578244d65c15196e9b0c6ea02723efc72d4223828029
--
-- ⚠️ It is EARNED only if VAC-04 on the PR reports that SAME hash for PROD. If it differs, PROD
-- drifted out of band: fold the difference into this migration, never edit the pragma to match.
```
This migration needs FOUR `-- prod-body-ack: <sha256>` lines (one per function). RESEARCH Pitfall 14 lists candidate values; the CI VAC-04 output is the authority. Multi-ack precedent: `supabase/migrations/20261001120000_compute_job_fence_errcode_55006.sql` lines 82-88 (three pragma lines). Do not spell any gate `find` needle in this header prose (runner counts `occurrences` over raw text, comments included; RESEARCH Pitfall 10).

**Transaction preamble and function skeleton** (analog 91-111):
```sql
BEGIN;

SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE FUNCTION enqueue_poll_positions_for_all_strategies()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
```
Keep each function's own signature, return type, `SECURITY DEFINER`, `SET search_path = public, pg_catalog` and dollar-quote tag (`$tick$` in cron_sync_tick) exactly as in its snapshot. RESEARCH uses `SET lock_timeout='5s'`; the repo house style in the analog is `SET LOCAL lock_timeout`. Prefer `SET LOCAL`.

**The three body edits per function** (RESEARCH Pattern 3; the "before" text is at `cron_sync_tick.sql` snapshot lines 97-98, 114, 133):
```sql
-- before (snapshot):
  c_url_allowed CONSTANT TEXT :=
    '^(https://[a-z0-9][a-z0-9.-]*\.up\.railway\.app|http://127\.0\.0\.1:9)$';
  ...
  IF v_key IS NULL OR btrim(v_key) = '' THEN
  ...
  IF v_url !~ c_url_allowed THEN
-- after:
  c_allowed_origins CONSTANT TEXT[] :=
    ARRAY['https://quantalyze-analytics-production.up.railway.app', 'http://127.0.0.1:9'];
  ...
  IF v_key IS NULL OR btrim(v_key, E' \t\r\n') = '' THEN
  ...
  IF NOT (v_url = ANY (c_allowed_origins)) THEN
```
Remove the now-false comment sentences about spaces-only `btrim` (snapshot 110-113 for cron_sync; match_engine 50-51) and update the "BYTE-IDENTICAL to the CHECK" comment. Keep the refusal text byte for byte (CONTEXT locks it; the twins C3/S13 key on its tail; the stored value is never echoed, T-161.1-10).

**CHECK swap** (existing CHECK at `20260907120000_analytics_service_settings_and_vault_tick.sql` lines 213-229; new form per RESEARCH Pattern 3):
```sql
ALTER TABLE public.system_settings
  DROP CONSTRAINT IF EXISTS system_settings_analytics_service_url_allowed,
  ADD CONSTRAINT system_settings_analytics_service_url_allowed
  CHECK (
    key <> 'analytics_service_url'
    OR value = ANY (ARRAY['https://quantalyze-analytics-production.up.railway.app', 'http://127.0.0.1:9'])
  );
COMMENT ON CONSTRAINT system_settings_analytics_service_url_allowed
  ON public.system_settings IS '...exact two origins...';
```
No helper function (RESEARCH measured EXECUTE-in-CHECK failure; decided inline).

**ACL restated** (analog lines 177-179 style, one per function):
```sql
REVOKE ALL ON FUNCTION public.cron_sync_tick() FROM PUBLIC, anon, authenticated, service_role;
```
(Verify the actual REVOKE set each source migration used; the four functions keep EXECUTE for the owner alone.)

**Catalogue-only verify block** (analog lines 130-253): `DO $verify$` with every variable DECLAREd up front, `RAISE EXCEPTION 'Migration <ts>: ...'` (never a NOTICE-skip), one-overload check via `pg_proc`/`pg_namespace`, `to_regprocedure`, `prosecdef`, `proconfig` search_path check, comment-stripped body, `has_function_privilege` / `aclexplode` privilege matrix:
```sql
  v_body := regexp_replace(regexp_replace(pg_get_functiondef(v_fn), '/\*.*?\*/', '', 'gs'), '--.*', '', 'gn');
  ...
  IF has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'Migration 20261126180000: anon or authenticated holds EXECUTE on ...';
  END IF;
  IF EXISTS (SELECT 1
               FROM pg_proc p
               CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
              WHERE p.oid = v_fn AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION '...PUBLIC holds EXECUTE...';
  END IF;
```
Loop it over the four functions. Add: both origin literals present in the CHECK (`pg_get_constraintdef`, using `position()` per the 20260907120000 idiom at lines 567-578, not `~`) and in each body; the old pattern fragment absent from the CHECK text only (NOT from bodies: the wildcard-arm twin puts it back into a body and the apply would abort instead of the arm going RED; RESEARCH Pitfall 9). Assemble any needle a gate arm mutates by concatenation (cron_sync header lines 61-71 explain why). The block must read catalogues only, no rows (`scripts/lint-migration-data-dependence.mjs` refuses data-reading DO guards).

**Timestamp:** after PROD ledger tip `20261126180000` and after anything on origin/main; re-check before every push. Do not edit any applied migration (PROOF-01).

---

### `supabase/migrations/down/2026112…-rollback.sql` (manual rollback)

**Analog:** `supabase/migrations/down/20261126180000-rollback.sql` (147 lines).

Copy the header (lines 1-33): "Manual, off the auto-apply path", `psql --single-transaction -v ON_ERROR_STOP=1 -f`, the marker query (`SELECT shobj_description(oid, 'pg_database') AS which_database ...`) to run FIRST, list of what it undoes, the ⚠️ "ROLLING BACK RE-OPENS THE DEFECT" paragraph (here: re-opens the `.up.railway.app` wildcard and spaces-only key guard), and the ⚠️ "THE MIGRATION LEDGER ROW IS LEFT IN PLACE" paragraph (repair with `supabase migration repair --status reverted <ts>` after the marker names the database). Body shape (lines 35-60): no BEGIN/COMMIT, `SET LOCAL lock_timeout = '3s';`, a catalogue-only `DO $precondition$` that refuses when the deployed function is not the new one (check for `c_allowed_origins`), then `CREATE OR REPLACE` of the four OLD bodies (the snapshots as they stand before this phase) and the old regex CHECK, then a `DO $postcondition$`.

---

### Gate files: repointed twins and new arms

**Analog:** the gates themselves; precedent diff `eedbc2433` on `supabase/tests/test_enqueue_poll_positions_cohort.sql` (+124/-) repointed eleven older twins to the new migration and added five.

**Repoint rule** (RESEARCH Pitfall 8): every edit-kind `RED-UNDER-M` twin currently names the old migration (e.g. `"file":"supabase/migrations/20261010140000_cron_sync_tick.sql"` at test_cron_sync_tick.sql lines 140, 221, 268, 310, 357, 373). Change `"file"` to the new migration, re-measure `"occurrences"` with `grep -aFc` on the FINAL migration text, add `"nth"` where the needle occurs in several bodies, and append the new migration to each gate's `RED-UNDER-SETUP` `apply` list AFTER the old ones (do not remove them). Update each file's "WHICH FILE THE ARMS ACTUALLY MEASURE" header paragraph (test_cron_sync_tick.sql lines 6-9).

**Twin grammar with `nth`** (existing example `supabase/tests/test_api_keys_account_identity.sql:798`):
```
-- RED-UNDER-M: {"arm":"HIST-running","apply":[{"kind":"edit","file":"supabase/migrations/20260927180000_working_holder_rule_d18.sql","find":"  IF v_job_status = 'running' THEN","replace":"  IF FALSE THEN","occurrences":2,"nth":1}]}
```
Pin the function order in the migration with a comment (a reorder shifts every `nth`); prefer a unique multi-line `find` where one exists.

**Prose/twin parity** (test_cron_sync_tick.sql lines 216-221): a `-- RED-UNDER:` prose block directly above each `-- RED-UNDER-M:` JSON line, explaining the mutation and what stays GREEN under it (see the V2 "mirror of V1" note, lines 259-268, for how to argue arms are non-redundant).

**P1 strengthening (item 2).** Current P1 setup seeds a fixed literal and only checks non-blank (test_cron_sync_tick.sql lines 108-112 and 191):
```sql
    PERFORM vault.create_secret('arm-fixture-key-not-real', 'analytics_service_key', 'phase 167.1.2.2.2 gate fixture');
...
  IF v_key IS NULL OR btrim(v_key) = '' THEN
    RAISE EXCEPTION 'TEST FAILED (P1): the recorded post''s X-Service-Key header is % ...
```
Change per RESEARCH Pattern 4: seed `'arm-fixture-key-' || gen_random_uuid()::text`, read it back from `vault.decrypted_secrets`, assert `v_key IS DISTINCT FROM <that secret>` raises `TEST FAILED (P1)`. The P1 twin adds a second edit step (or a new arm) replacing `'X-Service-Key', v_key` with `'X-Service-Key', 'fixed-not-the-secret'` (occurrences 5, nth per function: ops posts twice). A fixed seed literal would let a mutant that posts the same literal pass, hence the uuid suffix.

**New arm K1 / V3 (blank key refused by name, item 3).** Template is V2 (test_cron_sync_tick.sql lines 236-293): `DELETE FROM vault.decrypted_secrets WHERE name = 'analytics_service_key'; PERFORM vault.create_secret(' ', ...)` inside a BEGIN/EXCEPTION block that sets `v_setup`, `DELETE FROM net._lane_posts;`, call the tick in a BEGIN/EXCEPTION capturing `v_raised`/`v_msg`, then assert raised, message `~ 'analytics_service_key missing from vault'`, and zero rows in `net._lane_posts`. For K1 store `E'\t\n'` instead of `' '`. Twin: edit the new guard back to `IF v_key IS NULL OR btrim(v_key) = '' THEN` (old spaces-only). Under that mutant V2 (space-only) stays GREEN and K1 is the first failure.

**New arm W1 / C4 (wildcard sibling refused).** Template is C2/C3 (lines 312-376): drop the CHECK first (`ALTER TABLE public.system_settings DROP CONSTRAINT IF EXISTS system_settings_analytics_service_url_allowed;`), insert a `*.up.railway.app` host that is NOT the production origin (the existing `collector.attacker.example` host is refused by old and new rules alike so it cannot discriminate), call the tick, assert `v_raised AND v_msg ~ 'not an allowed destination'` and zero posts. Twin: edit the new guard line back to the old `!~ '^(https://[a-z0-9][a-z0-9.-]*\.up\.railway\.app|http://127\.0\.0\.1:9)$'` form. Place W1/C4 after the CHECK drop that C2 performs.

**U3 (analytics settings gate only).** The CHECK arm: U2 (twin at test_analytics_service_settings_and_vault_tick.sql:354, a `sql` step dropping the constraint) proves the CHECK bites and then drops it for the rest of the file (load-bearing order, RESEARCH Pitfall 12). Place U3 between U2 and that drop. Its twin is a `sql` step shaped like D1 (line 865):
```
-- RED-UNDER-M: {"arm":"D1","apply":[{"kind":"sql","stmt":"ALTER TABLE public.system_settings DROP CONSTRAINT system_settings_analytics_service_url_allowed, ADD CONSTRAINT system_settings_analytics_service_url_allowed CHECK (key <> 'analytics_service_url' OR value ~ '^https://[a-z0-9][a-z0-9.-]*\\.up\\.railway\\.app$')"}]}
```
(U3 reinstalls the wildcard CHECK, so a wildcard sibling INSERT then succeeds and U3 reddens.) Use `sql` twins, not `edit`, for CHECK arms so the migration's verify block does not abort the apply (Pitfall 9). R3 (line 648) edits `20260907120000`'s `REVOKE ALL ... FROM anon;` and stays pointed there. The V3 arm in this file must use the same `DELETE FROM vault.decrypted_secrets` + `vault.create_secret` pattern as V2 (the file also runs on the local-stack lane with the real Vault view).

**Sentinels** (test_cron_sync_tick.sql lines 411-412): update the final `RAISE NOTICE 'ALL N ARMS EXECUTED (roster)...'` integer and roster in each gate (cron_sync now `ALL 8 ARMS EXECUTED (0,P1,V1,V2,U1,C2,C3,G1)`; analytics settings `ALL 13 ARMS EXECUTED (...)` at line 765; ops `ALL 14` at line 794; prober `ALL 7` at line 645). The analytics file has a second NOTICE after the D1 section deliberately NOT using the `ARMS EXECUTED` phrasing (line 841-847); do not add a second one.

---

### Census files (floors, sentinels, snapshots)

**Analog:** the whole `git show eedbc2433` diff (15 files). The same set moves here, plus the gates listed above. Copy the "dated CURRENCY comment next to the moved literal" convention; the number comes off the runner/test red, never summed by hand.

**`scripts/mutation-floors.mjs`** (eedbc2433):
```js
// RAISED 1074 -> 1079 2026-11-26 (poll_positions venue gate, migration 20261126180000): +5 twinned arms, ... in test_enqueue_poll_positions_cohort.sql, a file that already counted toward FILES_FLOOR ...
// MEASURED: the exit-2-by-design DIAGNOSTIC run of that file printed `arms: 16/16/0   (executed/annotated/waived)`, `biting: 16`, `lane-invocations: 16` with every arm `RED (identity ok)` ...
// WAIVED_CEILING stays 0 - no waiver was added.
export const ARMS_FLOOR = 1079;
```
Floors read at `1fd1ce2ee`: `FILES_FLOOR = 96`, `ARMS_FLOOR = 1079`; Phase 243 runs in parallel and moves the same constants: re-base on origin/main and run `node scripts/mutation-runner/run.mjs --parse-only` before every push. `FILES_FLOOR` does not move (no new gate file).

**`.github/workflows/ci.yml` sql-tests step** (eedbc2433): per-file table row edit (`test_enqueue_poll_positions_cohort.sql  7 -> 9`), a dated "Re-measured" comment, and the `ARMS_FLOOR=` sum line with its `a + b + ...` derivation. Four rows move here: `test_analytics_service_settings_and_vault_tick.sql 13`, `test_cron_sync_tick.sql 8`, `test_ops_staleness_check.sql 14`, `test_prod_prober_cadence.sql 7` (read each file's own first `ALL N ARMS EXECUTED`, never the table). `SENTINEL_FLOOR` unchanged.

**`gate-family-meta.test.ts`:** the single key `"scripts/mutation-floors.mjs :: ARMS_FLOOR=<n>"` in `KNOWN_THRESHOLD_SITES`.

**`drift-check-scripts.test.ts`:** the `it(...)` title and the two `["-ac", "ARMS_FLOOR=<n>", ".github/workflows/ci.yml"]` arguments.

**`mutation-runner-floors.test.ts` and `mutation-annotation-parser.test.ts`:** `totalAnchored`, the synthetic FULL log lines (`arms:`, `biting:`, `lane-invocations:`, `per-arm lane time ... over N arm run(s)`, `N arm lane(s) spawned`, the `rows sum to N-1 biting arm(s)` offset literals) and the per-file rows `"  file test_x.sql: sections N / judged N / annotated N / waived 0 / biting N"` for each of the four gates; `armsSeen`, `stepsSeen`, `needles.length`. Each step is a `// ⭐ CURRENCY <date> (<phase>): X -> Y, ... MEASURED: ...` comment above the literal.

**`ci-anti-skip-gate.contract.test.ts` lines 314-336:** `okCount` counts files printing `ALL 7 ARMS EXECUTED`. `test_prod_prober_cadence.sql` declares 7 but is LANE-ONLY and excluded; if it gains arms and no longer prints `ALL 7`, run the test and read the measured value.

**Snapshots:** `npm run schema:functions` then `npm run schema:functions:check`; never edit `supabase/schema/functions/*.sql` or `supabase/schema/baseline.sql` by hand. `scripts/prod-prober/cron-manifest.json` does NOT move (carries job command text, not bodies); confirm with `src/__tests__/prod-prober-wiring.test.ts`.

---

### `.gitleaksignore` (config, no repo analog)

No existing file. Use RESEARCH Pattern 1 as the spec:
- One line per finding, `<40-hex commit>:<file>:<rule>:<line>`, regenerated at plan time and again before push from a redacted scan (`gitleaks git . --config .gitleaks.toml --log-opts=origin/main --redact --no-banner --report-format json --report-path "$SCRATCH/main.json" --exit-code 7`, then print only the `Fingerprint` field).
- Group lines under whole-line `#` comments naming WHY each site is a fixture (kind of site, never its value). A three-part line is global; an inline `#` after a fingerprint silently voids it. Both are pinned by the vitest file above.
- The loose style analog for "every entry justified by a comment pointing at what it protects" is the header of `.gitleaks.toml` (lines 7-11).
- Re-run `gitleaks dir` over the final file: comment words that look key-shaped could trip `generic-api-key` once the file is in a commit.

---

### Records (ship PR)

- **WINDOWS.md entry 61**: edit the table row (line 78) and the JSON record (id 61 near line 813): half (c) answered, half (b) stays open. `git diff` after.
- **TODOS.md**: delete `### [SECRETSCAN-FULLHISTORY-01]` (line 4288) and `### [167.1.2.2.2-CRON-TICK-RESIDUALS]` (line 2766); annotate (do not delete) the `secret-scan is red on workflow_dispatch runs` entry. Name both deleted ids in the CHANGELOG entry; fix any pointer to them in CLAUDE.md-style sources in the same PR.
- **Runbooks**: `docs/runbooks/prod-prober-cadence-go-live.md:112` and `docs/runbooks/ops-staleness-go-live.md:134` restate the old regex `^(https://[a-z0-9][a-z0-9.-]*\.up\.railway\.app|http://127\.0\.0\.1:9)$` in a membership query: change to the exact two-origin set.
- **CHANGELOG/VERSION/package.json**: `eedbc2433` is the precedent for one unified entry with byte-equal 4-digit version. Never write a fixture literal or the CI skip tokens.

## Shared Patterns

### Fail-loud, count-only disclosure for secret handling
**Source:** RESEARCH Pattern 2 + Security Domain; `sql-mutation-nightly.yml` report job for the dedup mechanics.
**Apply to:** the workflow, its report job, the vitest pin, PLAN SUMMARY text, CHANGELOG, commit and PR text.
Redacted reports only, report stays in `RUNNER_TEMP`, issue carries count + run URL + local repro command, never a file/line/commit/fingerprint; no `Match`/`Secret` from an unredacted report anywhere tracked.

### Re-base on latest definition, forward migration only
**Source:** `20261126180000_poll_positions_cohort_ccxt_venues.sql` header lines 9-15.
**Apply to:** the single new migration and its four bodies. Measure that no newer migration than the one named in each snapshot's `-- source migration:` line (cron_sync_tick: 20261010140000; ops_staleness_check: 20261020120000; match_engine_cron_tick: 20260911120000; prod_prober_cadence_check: 20260918120000) redefines the function, and that PROD (VAC-04 output) equals the snapshot.

### Catalogue-only self-verify, RAISE EXCEPTION never NOTICE
**Source:** analog migration lines 130-253.
**Apply to:** the migration verify block and rollback pre/postcondition. Reads catalogues only (lint-migration-data-dependence), every variable DECLAREd up front, `RAISE EXCEPTION 'Migration <ts>: ...'` with a sentence naming the consequence.

### SQL gate arm structure (setup guard, call, named assertions, twin)
**Source:** `supabase/tests/test_cron_sync_tick.sql` arms P1/V2/C2/C3.
**Apply to:** every new or edited arm in the four gates. `-- ===== ARM X — ... ====` banner, `X-SETUP` block raising `TEST FAILED (X-SETUP)` on any setup failure, `DELETE FROM net._lane_posts;`, BEGIN/EXCEPTION call capture, prose `-- RED-UNDER:` then one-line `-- RED-UNDER-M:` JSON, then `RAISE EXCEPTION 'TEST FAILED (X): ...'` assertions. The first `TEST FAILED (<arm>)` must name the arm the twin mutates.

### PROOF-01 neuter / restore cycle
**Source:** RESEARCH "PROOF-01 manual byte-backup cycle" (commands there use `scripts/pg-lane/run.sh --workdir ... --apply <list> --gate <file>` and `node scripts/mutation-runner/run.mjs --file <gate>`).
**Apply to:** each of the four gates, the three new arm classes (wildcard host, whitespace key, P1 header equals secret), and the scan (remove one `.gitleaksignore` line, require exactly one finding by file/rule/line, restore with `cp` + `cmp`, require zero). Never `git checkout`, `restore` or `stash` on uncommitted work. Record verbatim in each plan SUMMARY.

### Census discipline
**Source:** `git show eedbc2433` (every census file it touched).
**Apply to:** every plan that adds an arm. Read values off the failing assertion or runner output; `grep -a` every census; re-measure floors against origin/main before each push (Phase 243 collides).

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `.gitleaksignore` | config | scanner-read | No suppression file or baseline exists in the repo; format and traps are fully specified in RESEARCH Pattern 1 (measured on 8.30.1). `.gitleaks.toml` is the only related config and is deliberately NOT widened. |
| scan + count steps of the new workflow | CI step | batch | No existing workflow runs `gitleaks git` with a binary over history; ci.yml's `secret-scan` uses `gitleaks-action` (different scope semantics, see ci.yml 5438+ and RESEARCH Alternatives). Use the actionlint-verified skeleton in RESEARCH Pattern 2. |
| behavioural arm of `secret-scan-full-history.test.ts` (two-commit scoped-fingerprint repo) | test | spawnSync git + gitleaks | `gitleaks-allowlist.test.ts` only scans `--no-git` temp dirs; the commit-scoped suppression arm is new. Reuse its `HAS_GITLEAKS`/`mkdtempSync`/`skipIf` scaffolding, build fixtures at runtime. |

## Metadata

**Analog search scope:** `.github/workflows/`, `src/__tests__/`, `supabase/migrations/` (+ `down/`), `supabase/schema/functions/`, `supabase/tests/`, `scripts/mutation-floors.mjs`, commit `eedbc2433` full diff, `docs/runbooks/`, `TODOS.md`, `.planning/WINDOWS.md`.
**Files scanned:** about 30 read or grepped; analog excerpts taken from 12.
**Pattern extraction date:** 2026-11-27
**Not re-measured here (carried from RESEARCH):** the 31-finding table, floors at `1fd1ce2ee`, PROD body equality, pg-lane prototype results.

## PATTERN MAPPING COMPLETE
