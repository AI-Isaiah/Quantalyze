# 145-TERMINALIZE.md — the one-time human-reviewed terminalize (145-06 Task 2, 2026-08-17/18)

**Outcome: 18 PROD rows TERMINALIZED (analytics `failed` + reason, then `status='archived'`);
TEST required NO writes (fresh q2 = 0). UPDATE/INSERT-only — zero DELETE statements ran in
this pass (count-assert this file: no line begins `DELETE FROM`).**

## Fresh census (step 1 — the Plan-02 list re-verified at write time, both projects)

| Project | (1) full orphans | (2) csv + no dailies | (1)−(2) first-hop |
|---|---|---|---|
| PROD `khslejtfbuezsmvmtsdn` | 3 (subset of the 18) | **18** — identical id set to Plan 02's census; stable since 2026-05 | 0 |
| TEST `qmnijlgmdhviwzwfyzlc` | 8146 — ALL non-csv (the e2e/first-hop residue class, EXCLUDED from 145 by decree; grew from 8107 by normal CI activity) | **0** | 8146 (excluded) |

## The review (step 2) — signals applied, with one dispositioned deviation

The pre-registered three-signal test was `source='csv' AND wizard_session_id present AND
verification row present`. Applied to the fresh rows, **signal 2 is NULL on all 18** — and
that is an AGE ARTIFACT, not a first-hop indicator: the `wizard_session_id` column write
shipped in `20260728120000` (2026-07-28); every candidate predates it (2026-05-07/05-21).
The signal that DOES discriminate on these rows is the first: a wizard first-hop draft is
written by `create_wizard_strategy` with `source='wizard'` — it can never read `'csv'`.
All 18 carry `source='csv'` and the fresh (1)−(2) first-hop population is ZERO, so no row
here can be a first-hop drop. Recorded as the review's judgment, not silently absorbed.

### Per-row dispositions (prior status = the rollback anchor; restore it to undo)

**Class A — 3 pure window-shape orphans** (pending_review, verification row PRESENT, no
jobs, no analytics row; the query-(1) subset): TERMINALIZE.

| id | prior status | created | verification |
|---|---|---|---|
| 5454d0d5-0492-46bf-bdbf-a368bee6079b | pending_review | 2026-05-07 16:32 | yes |
| 58786362-7e87-4aa4-afd2-07931d790d7c | pending_review | 2026-05-21 13:45 | yes |
| 454a301c-4844-4f92-86a5-117d13d995e4 | pending_review | 2026-05-21 13:50 | yes |

**Class B — 15 incident casualties** (prior status **published**, job `failed_final`,
analytics already `failed` with the ORIGINAL error `400: Insufficient trade history`, zero
data rows — publicly-listed strategies with no track record): TERMINALIZE. 8 carry a
verification row; the 7-row 15:07:31 burst (identical timestamp = one incident event) does
not — noted, and that absence makes them MORE anomalous, not exempt.

| id | prior status | created | verification |
|---|---|---|---|
| 56c9167a-2be4-42a9-9e01-fac6a822624f | published | 2026-05-07 14:27:45.161 | yes |
| 80584b77-55a9-4fc8-b5c6-057df56cb19d | published | 2026-05-07 14:27:45.178 | yes |
| 66ac85a2-9a87-4fac-96c1-fda688283161 | published | 2026-05-07 14:27:45.255 | yes |
| 7b926c14-0e4a-444e-b3fb-59a81a49d6ca | published | 2026-05-07 14:27:45.280 | yes |
| d22804c6-fffc-457b-9c51-be980dfa4a1c | published | 2026-05-07 14:27:45.393 | yes |
| 766249d6-b342-4b5e-89d9-7bc652882e74 | published | 2026-05-07 15:46:19 | yes |
| 95f64519-ff7e-41be-a466-3023efad7bd7 | published | 2026-05-21 15:07:31 | no |
| b17068c5-b0d4-4048-ac58-e16f8d649183 | published | 2026-05-21 15:07:31 | no |
| 123009c0-a712-494f-b391-34f123f1e5ae | published | 2026-05-21 15:07:31 | no |
| b0897a26-e2b3-493e-8018-d44929d0514a | published | 2026-05-21 15:07:31 | no |
| 464cbf83-06b2-474c-adfd-8aaa8e21d5c5 | published | 2026-05-21 15:07:31 | no |
| 2e655505-c60f-4854-bce8-c5c63bb53885 | published | 2026-05-21 15:07:31 | no |
| aea5ab48-445e-4d97-a988-ba91b749f2c6 | published | 2026-05-21 15:07:31 | no |
| 92963983-671a-404c-b1d3-915e498798a0 | published | 2026-05-21 19:35:15 | yes |
| 692f38af-4a7f-4dea-b4d7-644bf0c39c12 | published | 2026-05-21 19:41:35 | yes |

Excluded rows: NONE (the first-hop shape has zero members on PROD).

## The statements run (step 3 — one transaction, D-13 order)

1. `INSERT INTO strategy_analytics (strategy_id, computation_status, computation_error)
   SELECT id, 'failed', 'csv-finalize orphan reaped by Phase 145 one-time pass (2026-08-17):
   strategy has zero daily-return rows, created in the 2026-05 incident era before the
   Phase 19.1 fix' FROM the_list
   ON CONFLICT (strategy_id) DO UPDATE SET computation_status='failed',
   computation_error = COALESCE(existing, EXCLUDED.computation_error);`
   — the COALESCE deliberately PRESERVES the 15 casualties' original
   `400: Insufficient trade history` error text (better audit evidence than a generic
   reason); the 3 Class-A rows, which had no analytics row, received the Phase-145 reason.
2. `UPDATE strategies SET status='archived' WHERE id IN (…18 ids…) AND status <> 'archived';`

## Verification (step 3, re-selected)

Every one of the 18 re-selected: `status='archived'` AND `computation_status='failed'` AND
a non-NULL `computation_error` (15 × original incident error, 3 × the Phase-145 reason).
Post-pass census: PROD (1) = **0**, (2) = **0**. Nothing collects an archived strategy row
and nothing needs to — the surviving archived row IS reading (β)'s desired end-state.

Reversal recipe if ever needed: `UPDATE strategies SET status='<prior_status from the
tables above>' WHERE id='<id>'` — every prior status is recorded per-row above; the
analytics rows are additive and carry their own audit value either way.
