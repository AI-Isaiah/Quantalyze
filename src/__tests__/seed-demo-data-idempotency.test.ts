/**
 * #175 — seed-demo-data idempotency guard.
 *
 * `scripts/seed-demo-data.ts` documents itself (line 11) as "Idempotent: every
 * insert/upsert is onConflict-safe." Two writes — the `strategies` row and its
 * `strategy_analytics` row, seeded in the 8-strategy loop — used bare
 * `.insert()` without an `onConflict`, so any re-run against a populated DB
 * aborted on `STRATEGY_PROFILES[0]` with a duplicate-key violation. Because
 * `.github/workflows/ci.yml` re-runs the seeder on every CI invocation against
 * the persistent test project (`qmnijlgmdhviwzwfyzlc`, already holding the 8
 * demo rows), row 1 threw and every dependent seed step (portfolios, analytics,
 * match decisions) silently never ran — starving the seed-gated specs.
 *
 * The seeder's `main()` constructs a service-role client and cannot run under
 * vitest (the M-0846 entry-point guard blocks it), so this is a source-scan
 * guard — the same readFileSync idiom as the parity/frozen-spine guards. It
 * fails against the pre-fix bare-`.insert()` source and passes once both writes
 * are `.upsert(..., { onConflict })`.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, it, expect } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const SEED_PATH = resolve(HERE, "../../scripts/seed-demo-data.ts");
const SRC = readFileSync(SEED_PATH, "utf8");

describe("seed-demo-data idempotency (#175)", () => {
  it("the strategies write is an onConflict-safe upsert, not a bare insert", () => {
    expect(SRC).not.toMatch(/from\("strategies"\)\.insert\(/);
    // Upsert on the `id` primary key so a re-run overwrites rather than throws.
    expect(SRC).toMatch(
      /from\("strategies"\)\.upsert\([\s\S]*?onConflict:\s*"id"/,
    );
  });

  it("the strategy_analytics write is an onConflict-safe upsert, not a bare insert", () => {
    expect(SRC).not.toMatch(/from\("strategy_analytics"\)\.insert\(/);
    // strategy_analytics has a UNIQUE/PK on strategy_id (guarded by migration
    // 20260707120000); upsert on it keeps the seeder re-runnable.
    expect(SRC).toMatch(
      /from\("strategy_analytics"\)\.upsert\([\s\S]*?onConflict:\s*"strategy_id"/,
    );
  });
});
