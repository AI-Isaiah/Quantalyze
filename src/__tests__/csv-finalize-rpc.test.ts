/**
 * csv-finalize route unit coverage (#597 part 2).
 *
 * ⚠️ THIS FILE IS LIVE AND LOAD-BEARING. Do not "finish the cleanup" by
 * deleting it — the two describes below are pure-function tests that run in
 * every CI shard and are the only coverage of the CSV asset_class contract.
 *
 * ── TOMBSTONE (2026-08-18, Phase 146.1 / v1.19 review finding B5) ──────────
 *
 * REMOVED: `describe("finalize_csv_strategy RPC (Phase 15 / CSV-01)")` — six
 * live-DB cases, each skip-gated on the live-DB env flag, plus a skip-reason
 * advertiser that asserted nothing, together with the live-DB fixture
 * (admin/user clients, createAuthedClient, beforeAll / afterAll seeding and
 * cleanup).
 *
 * WHY: every one of those cases called `finalize_csv_strategy`, a function
 * migration 20260819120000_csv_finalize_atomic_fold.sql DROPped when it folded
 * the two-RPC path into `finalize_csv_strategy_with_returns`. They could never
 * pass again against a live DB. They did not fail either — the live-DB flag is
 * false in every CI vitest shard by explicit instruction
 * (.github/workflows/ci.yml:286), so they skipped silently. Coverage that
 * cannot execute is worse than absent coverage: it reads as a green tick over
 * a guarantee nothing checks.
 *
 * WHERE THE COVERAGE WENT: the three real guard behaviours those cases pinned
 * (invalid fmt, empty p_strategy_name, p_strategy_name > 80 chars, each a
 * SQLSTATE 22023) are now asserted by
 * `supabase/tests/test_csv_finalize_atomic_fold.sql` Part 7 (7a / 7b / 7c).
 * That file is auto-discovered by the `sql-tests` CI job's
 * `supabase/tests/test_*.sql` glob and runs under `psql -v ON_ERROR_STOP=1`
 * against the TEST project — so unlike the cases removed here, it executes.
 *
 * (The "nine 22023 assertions" figure in the v1.19 review was a `grep -c` of
 * the string, not an assertion count. There were three.)
 */

// #597 part 2 (Plan 84-07): the pure-function asset_class blocks below import
// the csv-finalize route module, which pulls in `server-only`. Run in the node
// environment and stub `server-only` so the import resolves (mirrors
// csv-finalize-c14-regression.test.ts).
// @vitest-environment node

import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  parseCsvMetadata,
  buildMetadataUpdatePayload,
} from "@/app/api/strategies/csv-finalize/route";

// ---------------------------------------------------------------------------
// #597 part 2 — asset_class boundary validation + persistence (Plan 84-07).
//
// Pure-function coverage (NO live DB): the wizard's CSV branch now forwards an
// asset_class picker value to csv-finalize (CsvSubmitStep). These tests pin the
// route-side contract that closes the deferred upload-picker gap:
//   - the two closed-set values 'crypto'/'traditional' parse into the payload
//     VERBATIM — CSV strategies keep the user's choice (NO force-derive to
//     'crypto'; that rule is API-key-only, per the locked #597 decision);
//   - a present-but-invalid value fails loud (ok:false, field
//     'metadata.asset_class') → the route 400s CSV_INVALID_FORMAT (NEW-C14-03);
//   - an ABSENT field is omitted from the UPDATE payload (back-compat: the
//     column stays null → annualizationPeriods default 252 downstream). This is
//     byte-identical to the metadata-less finalize behavior shipped today.
// ---------------------------------------------------------------------------

describe("parseCsvMetadata — asset_class closed-set validation (#597 part 2)", () => {
  it("carries 'crypto' into the payload verbatim", () => {
    const result = parseCsvMetadata({ asset_class: "crypto" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected acceptance");
    expect(result.payload?.asset_class).toBe("crypto");
  });

  it("carries 'traditional' into the payload verbatim (NO force-crypto on the CSV path)", () => {
    const result = parseCsvMetadata({ asset_class: "traditional" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected acceptance");
    expect(result.payload?.asset_class).toBe("traditional");
  });

  it("rejects a wrong-case value ('CRYPTO') — no case-folding, DB set is lowercase", () => {
    const result = parseCsvMetadata({ asset_class: "CRYPTO" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejection");
    expect(result.field).toBe("metadata.asset_class");
  });

  it("rejects an out-of-set value ('equities')", () => {
    const result = parseCsvMetadata({ asset_class: "equities" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejection");
    expect(result.field).toBe("metadata.asset_class");
  });

  it("rejects a non-string value (42)", () => {
    const result = parseCsvMetadata({ asset_class: 42 });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejection");
    expect(result.field).toBe("metadata.asset_class");
  });

  it("omits asset_class from the payload when the field is absent (back-compat)", () => {
    const result = parseCsvMetadata({ description: "no asset_class here" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected acceptance");
    expect(result.payload?.asset_class).toBeUndefined();
  });

  it("omits asset_class when the field is explicitly null (back-compat)", () => {
    const result = parseCsvMetadata({ asset_class: null });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected acceptance");
    expect(result.payload?.asset_class).toBeUndefined();
  });
});

describe("buildMetadataUpdatePayload — asset_class UPDATE persistence (#597 part 2)", () => {
  it("writes a validated asset_class into the UPDATE payload verbatim", () => {
    const payload = buildMetadataUpdatePayload({ asset_class: "traditional" });
    expect(payload.asset_class).toBe("traditional");
  });

  it("writes 'crypto' when the picker chose crypto", () => {
    const payload = buildMetadataUpdatePayload({ asset_class: "crypto" });
    expect(payload.asset_class).toBe("crypto");
  });

  it("omits the asset_class key entirely when absent (column stays null → 252 default)", () => {
    const payload = buildMetadataUpdatePayload({ description: "x" });
    expect("asset_class" in payload).toBe(false);
  });

  it("omits asset_class for a null metadata blob (metadata-less finalize unchanged)", () => {
    const payload = buildMetadataUpdatePayload(null);
    expect("asset_class" in payload).toBe(false);
  });
});
