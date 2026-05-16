# Fix briefing — `src/lib/gdpr-export.ts`

Scope: fix every CRITICAL + HIGH + MEDIUM≥conf-8 finding listed below in current `main`.

---

## CRITICAL — 1 findings in scope

#### C-0166 · L97 · security c5 ⏳
- **Title**: (no title)
- **Summary**: USER_EXPORT_TABLES includes api_keys as a direct user-owned table with SELECT *. api_keys carries the encrypted credential blob (and potentially encryption metadata / KMS key reference depending on schema). Exporting the encrypted ciphertext into a JSON bundle that lives in a private bucket under a 1-hour signed URL widens the attack surface: anyone who captures the signed URL captures the ciphertext. While the credential is at-rest-encrypted, including it in GDPR bundles serves no Art. 15/20 purpose (the user already has the underlying API key in their broker UI) and creates an exfil pathway that bypasses the production decrypt RPC's access controls.
- **Fix**: Either (a) exclude api_keys from USER_EXPORT_TABLES (the user can re-create keys via their broker; the encrypted blob is internal storage), or (b) project a redacted column set: exchange, label, created_at, last_sync_at, status — explicitly omitting the encrypted_secret / iv / aad columns.
- **Source**: `batch-S9a.security.jsonl` (batches: S9a)

## HIGH — 7 findings in scope

#### H-0448 · L? · performance c9 ⏳
- **Title**: GDPR export collects entire bundle in memory; whole-table SELECTs up to 50k rows per table × 28 tables blow lambda RAM
- **Summary**: The assembler iterates 28 tables sequentially, each with `.select('*').limit(50_000)` (EXPORT_PER_TABLE_ROW_CAP), accumulating every row in JS heap before any streaming starts. For a power user with full strategy + trade history the bundle can hit 100MB serialized (the explicit cap), and that's after JSON.stringify — peak heap is 2-3× that (string buffer + parsed objects + TextEncoder copy). On a Vercel Fluid 1024MB lambda this risks OOM, and there is no chunking/pagination — `.limit(50_000)` on a single SELECT also returns one giant payload to PostgREST.
- **Evidence**: src/lib/gdpr-export.ts:230-322: `for (const spec of USER_EXPORT_TABLES) { const rows = await fetchRowsForSpec(...) ; tables.push({...rows...}) }`. fetchRowsForSpec at L338-L342 does `.select('*').eq().limit(EXPORT_PER_TABLE_ROW_CAP)`. Spec comment at L24-L29 acknowledges 'rows are collected in memory' and notes 'A future sprint can switch to true streamed JSON if the cap is hit'.
- **Source**: `batch-S9b.performance.jsonl` (batches: S9b)

#### H-0451 · L? · security c9 ⏳
- **Title**: gdpr-export 100MB cap can be defeated by metadata.user_id field collisions; per-table 50K row cap silently truncates without surfacing to the user
- **Summary**: The 100MB cap is enforced AT ASSEMBLY (in memory), not at upload, so the lambda still allocates a 100MB+ JSON string before truncation. A bad actor with 49,999 large `metadata` JSONB rows can craft an OOM (4096MB Vercel lambda) by pushing values per-row above the per-table TextEncoder check. The per-table row cap (50K, EXPORT_PER_TABLE_ROW_CAP) silently drops rows for users whose row count exceeds 50K — `truncated_at_cap` is set on the table payload but only logs to stderr, never surfaces to the user. From a GDPR perspective, returning an incomplete export without telling the user IS a compliance violation (Art. 12 requires the controller to communicate the response).
- **Evidence**: src/lib/gdpr-export.ts:188 `EXPORT_SIZE_CAP_BYTES = 100 * 1024 * 1024` ; line 195 `EXPORT_PER_TABLE_ROW_CAP = 50_000` ; lines 252-258 — `truncated_at_cap: rows.length >= EXPORT_PER_TABLE_ROW_CAP` is recorded but no user-facing notice. Indirect tables hard-cap parent_ids at 2000 (line 358) — silently drops the tail.
- **Source**: `batch-S9b.security.jsonl` (batches: S9b)

#### H-0453 · L? · silent-failure-hunter c9 ⏳
- **Title**: Indirect-export parent-id batch silently capped at 2000 with no flag in the bundle — a user with >2000 strategies or portfolios silently loses child-table rows
- **Summary**: For indirect-owned tables (trades, portfolio_analytics, weight_snapshots, etc.) the parent-id probe is `.limit(2000)` against parent_table. If the user owns >2000 strategies (uncommon but real for partner-imported demo users) or >2000 portfolios, the tail is dropped and ALL child rows scoped to dropped parents disappear from the export. The bundle has no `parent_id_truncated: true` flag — the function comment at line 327-330 says 'simply drops the tail in the extreme case (marked truncated)' but no marking actually happens. ExportTablePayload only has `truncated_at_cap` for ROW-count truncation at EXPORT_PER_TABLE_ROW_CAP=50000, not for parent-id truncation.
- **Evidence**: src/lib/gdpr-export.ts:352-369 — `.limit(2000)` on parent select; `truncated_at_cap` is set to `rows.length >= EXPORT_PER_TABLE_ROW_CAP` (line 257) which is downstream rows, not the parent cap. No bundle-level `incomplete_indirect_scopes` field.
- **Source**: `batch-S9b.silent-failure-hunter.jsonl` (batches: S9b)

#### H-0454 · L? · code-reviewer c8 ⏳
- **Title**: GDPR export 100MB cap: bundle envelope itself counted before TextEncoder size — schema overhead is double-counted, allows under-pack
- **Summary**: `approxBytes = TextEncoder.encode(JSON.stringify(payload)).byteLength` measures the serialized PER-TABLE payload, but the cap check `totalBytes + approxBytes > EXPORT_SIZE_CAP_BYTES` never accounts for the FINAL bundle envelope (schema_version, user_id, generated_at, total_row_count, tables: [...], truncated_at_size_cap, comma separators, array brackets, etc.). The actual JSON.stringify(bundle) at upload time will be approximately `sum(approxBytes) + envelope_overhead + per-table-comma-separators`. For 50k-row exports the comma separator alone is ~50k bytes per table; with 25 tables this is ~1.2MB of unaccounted overhead. Caps slightly above EXPORT_SIZE_CAP_BYTES at upload time, but the cap is technically violated.
- **Evidence**: src/lib/gdpr-export.ts:264-321 — `totalBytes` accumulates per-payload size only; envelope overhead and inter-payload separators are never added. The test at gdpr-export.test.ts:199 gives a 1MB grace but real-world skew can be larger with many small tables.
- **Source**: `batch-S9b.code-reviewer.jsonl` (batches: S9b)

#### H-0455 · L? · security c8 ⏳
- **Title**: sanitize_user RPC parity with USER_EXPORT_TABLES is NOT machine-verified — export/delete drift surface
- **Summary**: There are TWO mirror-image lists: (a) the GDPR Art. 15 export manifest (USER_EXPORT_TABLES, ~25 entries) and (b) the GDPR Art. 17 delete/anonymise list (inside the sanitize_user PL/pgSQL function in migration 055). Both are hand-curated. A new user-owned table needs to land in BOTH or the user can be 'forgotten' from export but not delete (worse: GDPR partial deletion liability) or vice-versa. The CI hook check-gdpr-export-coverage.ts only validates the export manifest — there is no parity check that every table in USER_EXPORT_TABLES is also in sanitize_user's PURGE/PRESERVE matrix.
- **Evidence**: src/lib/gdpr-export.ts:82-182 — manifest. sanitize_user matrix lives in supabase/migrations/055_*.sql (PL/pgSQL function body), not in TS. CI hook in scripts/check-gdpr-export-coverage.ts greps migrations for user_id but doesn't compare against sanitize_user's table list.
- **Source**: `batch-S9b.security.jsonl` (batches: S9b)

#### H-0456 · L? · red-team c7 ⏳
- **Title**: CHAIN: 50000 per-table row cap + 100MB cap + binary-search packing = bundle is INCOMPLETE for any user with >50K trades, exporter still emits success audit
- **Summary**: Compound: (a) EXPORT_PER_TABLE_ROW_CAP=50000 silently truncates with truncated_at_cap:true but no `total_rows_in_db` count (silent-failure #13); (b) the 100MB binary-search packing at gdpr-export.ts:275-297 trims rows from the END — depends on the SELECT's default order which is per-table dependent and NOT deterministic (Postgres doesn't guarantee row order without ORDER BY); (c) `.select('*')` has no ORDER BY clause (lines 340, 372). Compliance impact: a user with 200K trades calls /api/account/export. The trades table truncates at 50K (truncated_at_cap:true), but WHICH 50K is non-deterministic — the same user calling export twice gets different 50K subsets. The 100MB cap triggers earlier in alphabetic order (allocator_equity_snapshots is first), starving real per-table SELECTs of bytes budget — meaning trades and reconciliation_reports may get 0 rows even when the user has 200K. Bundle's truncated_at_size_cap is true, but the user has no way to RESUME — there's no continuation_token despite the file's docstring at lines 22-26 mentioning one ('the route returns a continuation_token the client can use to resume'). The token does not exist in the implementation. Compliance gap: regulator expects ART. 20 portability; gets a randomly-truncated 100MB blob with no path to completeness.
- **Evidence**: gdpr-export.ts:188 size cap; gdpr-export.ts:195 row cap; gdpr-export.ts:275-297 binary search trims tail; gdpr-export.ts:340/372 no ORDER BY; docstring claim of continuation_token at :22-26 — but no token field in ExportBundle at :210-217.
- **Source**: `batch-S9b.red-team.jsonl` (batches: S9b)

#### H-0457 · L? · red-team c7 ⏳
- **Title**: CHAIN: sanitize_user parity with USER_EXPORT_TABLES is NOT machine-verified = export covers tables sanitize misses (or vice versa), per-table compliance drift
- **Summary**: Compound (security #12): (a) USER_EXPORT_TABLES is the GDPR Art. 15/20 manifest in TS; (b) sanitize_user (migration 055) is the GDPR Art. 17 manifest in PL/pgSQL; (c) CI hook check-gdpr-export-coverage.ts only validates the export manifest against migrations' user_id columns; (d) NO check that every USER_EXPORT_TABLES entry also has a corresponding PURGE/PRESERVE rule in sanitize_user. Outcomes: (1) An entry in USER_EXPORT_TABLES that's NOT in sanitize_user means an Art. 17 deletion request leaves data the Art. 15 export will continue to surface — user can keep accessing 'deleted' data forever. (2) An entry in sanitize_user PURGE that's NOT in USER_EXPORT_TABLES means user can never see what was deleted — opaque erasure violates Art. 15(1)(h)/12 transparency. Live drift candidates: allocator_equity_snapshots was added to USER_EXPORT_TABLES per the recent diff (gdpr-export.ts:90) — was sanitize_user updated in the same PR? No CI check enforces this. Same for allocator_holdings (line 95) and any future user-owned table.
- **Evidence**: gdpr-export.ts:90 + :95 recent additions; sanitize_user lives in migration 055 PL/pgSQL; scripts/check-gdpr-export-coverage.ts only diffs migrations' user_id columns vs USER_EXPORT_TABLES (per security #12 evidence).
- **Source**: `batch-S9b.red-team.jsonl` (batches: S9b)

## MEDIUM — 5 findings in scope

#### M-0520 · L? · code-reviewer c9 ⏳  · merged 2-way
- **Title**: GDPR export indirect-fetch error path returns empty array — silent data loss with no truncation flag
- **Summary**: When the indirect parent query (e.g., `SELECT id FROM strategies WHERE user_id=$1`) errors, `fetchRowsForSpec` logs and returns `[]`. The caller then writes a payload with `row_count: 0, truncated_at_cap: false`. A GDPR Art. 15 export response with `truncated_at_cap=false` is a compliance claim that the user's data is complete — but in the error case the data is INCOMPLETE and the bundle never says so. The right behavior is either (a) propagate the error to fail the export atomically, or (b) record `truncated_at_cap: true` with an `error: '...'` field so the user knows the export is incomplete.
- **Evidence**: src/lib/gdpr-export.ts:343-349 (direct error), 359-365 (parent error), 376-382 (indirect error) — every error path returns `[]` and the caller records `row_count: 0, truncated_at_cap: false`.
- **Also flagged**: [code-reviewer] GDPR export indirect-fetch caps parent_ids at 2000 rows with no audit trail — silent data loss for power users
- **Source**: `batch-S9b.code-reviewer.jsonl` (batches: S9b)

#### M-0521 · L? · type-design-analyzer c9 ⏳
- **Title**: UserExportTable lacks per-table row schema — exported bundle's `rows: unknown[]` loses every per-table contract
- **Summary**: `ExportTablePayload.rows: unknown[]` and `fetchRowsForSpec` returns `Promise<unknown[]>`. The CI hook `check-gdpr-export-coverage.ts` already enforces that USER_EXPORT_TABLES covers every user-owned table, but the type layer makes NO connection between the manifest entries and the row shapes the export bundle is supposed to contain. Concretely: a future renaming of `audit_log.action` → `audit_log.action_type` would not surface here at all (the row is `unknown`), and consumers of the export bundle (download script, regulator-facing serializer) would have to re-discover the row shape at runtime. ADR-0023's commitment that 'every user-owned table is in the bundle' is enforced by row presence — but row CONTENT/SHAPE is unenforced.
- **Evidence**: gdpr-export.ts:200-205, 332-384. The codebase has database.types.ts available — `UserExportTable` could be parameterised over a `Table extends keyof Database['public']['Tables']` to recover row typing and force exhaustiveness when the schema changes.
- **Source**: `batch-S9b.type-design-analyzer.jsonl` (batches: S9b)

#### M-0522 · L? · type-design-analyzer c9 ⏳
- **Title**: `UserExportTable.table: string` is unbranded — manifest can list a non-existent table at compile time
- **Summary**: Both DirectUserTable and IndirectUserTable type `table: string` (and `user_column: string`, `via_column: string`, `parent_table: string`, `parent_user_column: string`). The supabase types in src/lib/database.types.ts already model Database['public']['Tables'] as a closed keyset, but the GDPR manifest's `table` field never reaches for it. A typo like `table: 'allocator_holdngs'` compiles fine; the CI hook (`check-gdpr-export-coverage.ts`) is the only safety net, and it runs in a separate phase from `tsc`. For a GDPR export — where the failure mode is 'we promised to give the user table X, we returned table Y because of a typo' — type-level coverage of the table name space is the natural place to enforce the invariant.
- **Evidence**: gdpr-export.ts:44-69, 82-182. Recommend `table: keyof Database['public']['Tables']` and `user_column: keyof Database['public']['Tables'][T]['Row']` parameterized over T.
- **Source**: `batch-S9b.type-design-analyzer.jsonl` (batches: S9b)

#### M-0523 · L? · type-design-analyzer c8 ⏳
- **Title**: `ExportBundle.schema_version: 1` is a literal but `total_row_count: number` allows int64-shaped values without bounding — bundle format is not versionable
- **Summary**: `ExportBundle.schema_version: 1` is fixed at the literal `1` — adding `schema_version: 2` requires a non-backward-compat change to every reader. There's no `type ExportBundleV1 = { schema_version: 1; ... }` plus `type ExportBundle = ExportBundleV1 | ExportBundleV2` discriminated union for migration. Combined with `truncated_at_size_cap: boolean` re-using a name that's nearly identical to per-table `truncated_at_cap: boolean` (gdpr-export.ts:204) — the two flags differ only in `_at_size_` infix, a typo that compiles in either context. A consumer iterating `bundle.truncated_at_cap` (which doesn't exist on the outer object) would receive `undefined` and silently treat the bundle as not-truncated.
- **Evidence**: gdpr-export.ts:200-217. Recommend (a) typing schema_version as a discriminated-union tag and (b) renaming the inner flag to `rows_truncated` to break the homograph with `truncated_at_size_cap`.
- **Source**: `batch-S9b.type-design-analyzer.jsonl` (batches: S9b)

#### M-0524 · L? · type-design-analyzer c8 ⏳
- **Title**: `fetchRowsForSpec` parent-id read hard-codes `{ id: string }` — silently wrong for parent tables whose PK is not `id` or not a string
- **Summary**: `const parentIds = (parentRows ?? []).map((r: { id: string }) => r.id);` (gdpr-export.ts:366). The function assumes (a) every indirect parent table has a primary key named `id`, and (b) that PK is typed `string`. The current manifest happens to satisfy this (strategies.id, portfolios.id are both uuid strings), but the IndirectUserTable type does NOT encode 'parent PK column name' — it only encodes `parent_user_column` (the column to filter by). A new indirect entry whose parent table uses a composite key or a non-`id` PK column would fail at runtime with a type-checker-blessed `{ id: undefined }.id` lookup that yields `undefined` for every row, returning an empty export silently.
- **Evidence**: gdpr-export.ts:60-70, 354-376. IndirectUserTable should add a `parent_id_column: string` field (or default it explicitly to 'id' with a literal type) and the select should mirror it: `.select(spec.parent_id_column)`. The hard-coded `r: { id: string }` is the unsafe cast equivalent.
- **Source**: `batch-S9b.type-design-analyzer.jsonl` (batches: S9b)

---
**TOTAL IN-SCOPE FINDINGS: 13**
