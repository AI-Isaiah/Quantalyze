## Round 1 fixes (topic B)

Scope: strategies-page row remedies. Branch `fix/199-r1b` (off `feat/199-managerhome`). Topic A (WR-01, WR-03, SFH-01, SFH-02) is a separate file.

### WR-02: no-job row claimed a read failure (fixed)

- **Commit:** `22e049ed5`
- **Change:** `src/app/(dashboard)/strategies/page.tsx` `healthDetailFor`: only a derived `unreadable` compute state (`deriveComputeState({ readError: true })`, or a non-exhaustive read) prints `strategies.compute-status-unreadable`. A read that worked and found no factsheet job (`jobDay === null`) now prints the new `strategies.analytics-failed-undated` line ("The last computation did not produce figures." plus the viewer's `ownerRemedy` action, `analyticsFailed: true`). New registry entry in `src/lib/degrade-warnings.ts` (class `empty`, scope `none`, no day or key to name, same precedent as `strategies.stale-no-data`).
- **Censuses moved:** `SAMPLES` in `src/lib/degrade-warnings.test.tsx` (with two registry tests for the new entry), the `LIST_PAGE` id list in `src/__tests__/degrade-warning-scan.test.ts`, the `DETAIL_IDS` list in `page.merged.test.tsx`.
- **Tests:** `page.merged.test.tsx` "a read that succeeds with no job on record is NOT unreadable ..." (replaced the old test that pinned the buggy behaviour); `page.key-pill.test.tsx` "renders the note after any key lines ..." now expects the undated id (its mock returns no job); `degrade-warnings.test.tsx` two new registry tests.
- **RED check:** restoring `facts.jobDay === null` as the unreadable condition fails the new page test (1 failed). Restored from a byte backup.
- **Result:** `npx vitest run "src/app/(dashboard)/strategies" src/lib/degrade-warnings.test.tsx src/__tests__/degrade-warning-scan.test.ts` 53 files, 1132 tests passed; `npx tsc --noEmit -p .` clean.
- **Status:** fixed.

### SFH-03: Stale (no data yet) remedy hardcoded never_started (fixed)

Verified first: a `stale_no_data` row (analytics pending or missing, not "computing", not updating) can have a failed_permanent or other job, so its real state can differ from `never_started`.

- **Commit:** `309db942d`
- **Change:** `page.tsx`: `failedFacts` now also reads rows whose Health is `stale_no_data` (an unpublished row reuses the read its share note already makes via `armOf`; only a published row adds one RPC). The `stale_no_data` branch takes the remedy from `ownerRemedy(facts.state, shapeOf(s, facts.compositeHistory), s.id)`; an unreadable state prints `strategies.compute-status-unreadable`. Registry: `strategies.stale-no-data` now lists `ANALYTICS_FAILED_ACTIONS` (a superset of the old `STALE_NO_DATA_ACTIONS`, which was removed as then unused).
- **Tests:** `page.merged.test.tsx` new describe "the Stale (no data yet) detail reads the row's REAL compute state": failed_permanent gives "Use the contact form to have it resolved." and no "Resync"; a transient failure keeps the shape remedy per role (allocator-only never gets the edit page); a failed jobs read prints the unreadable line for unpublished and published rows. `degrade-warnings.test.tsx`: the stale-no-data action sweep now covers every `COMPUTE_STATES` entry, not only never_started.
- **RED check:** hardcoding `never_started` and dropping the unreadable branch fails the failed_permanent test and the unreadable test (2 failed). The transient test is a pin, not a RED arm (never_started and transient share the shape remedy). Restored from a byte backup.
- **Result:** same targeted run, 53 files, 1135 tests passed; `npx tsc --noEmit -p .` clean.
- **Status:** fixed.

### Residual, recorded not fixed

A `stale_no_data` row whose job is `queued`, `retrying` or `running` now ends on the reload remedy, but the registered sentence still opens "No figures yet, and no computation is running." That claim is false for those states (it was equally false before, with the never-started remedy). Not in the finding; fixing it means a new in-progress variant or suppressing the line, which is a copy decision. Candidate for the next round or a booking.

Logic changes, so both fixes want a human read: **fixed: requires human verification**.
