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

/**
 * ⭐ 146.2-03 / G2 — every ACCEPTED blob below now carries a `category_id`,
 * because the route enforces a new invariant: EVERY metadata UPDATE it issues
 * writes a category_id (see the G2 describe at the end of this file). The
 * asset_class contract these cases pin is unchanged; what changed is that a
 * blob which would run an UPDATE without a category is a caller error, so a
 * fixture omitting it would now be testing the OTHER rule.
 */
const CATEGORY_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";

describe("parseCsvMetadata — asset_class closed-set validation (#597 part 2)", () => {
  it("carries 'crypto' into the payload verbatim", () => {
    const result = parseCsvMetadata({
      category_id: CATEGORY_ID,
      asset_class: "crypto",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected acceptance");
    expect(result.payload?.asset_class).toBe("crypto");
  });

  it("carries 'traditional' into the payload verbatim (NO force-crypto on the CSV path)", () => {
    const result = parseCsvMetadata({
      category_id: CATEGORY_ID,
      asset_class: "traditional",
    });
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
    const result = parseCsvMetadata({
      category_id: CATEGORY_ID,
      description: "no asset_class here",
    });
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

// ---------------------------------------------------------------------------
// 146.2-03 / G2 — THE DISCRIMINATOR'S PROOF, PINNED AT THE COMPOSED LEVEL
// ---------------------------------------------------------------------------

/**
 * The 23505 resolve arm decides FILL vs REFUSE on one fact: the committed
 * row's `category_id` reads SQL NULL. Its comment calls that "observable proof
 * that UPDATE never ran", and the FILL it licenses rewrites description, aum,
 * markets and — the money field — `asset_class`, the annualization clock.
 *
 * ⭐ THE ORACLE IS THE INVARIANT, NOT THE IMPLEMENTATION'S OWN `if`:
 *
 *     every metadata UPDATE this route issues writes a `category_id`
 *
 * …because that, and only that, makes a committed NULL proof of anything. It
 * is asserted over the COMPOSITION `parseCsvMetadata → buildMetadataUpdatePayload`
 * — the two functions that together decide what the UPDATE contains — rather
 * than over either one's internals. A blob refused at the boundary runs no
 * UPDATE; a blob that parses to an empty payload runs no UPDATE; every OTHER
 * blob must carry a category.
 *
 * WHAT WAS TRUE BEFORE was a claim about the WIZARD, not the route:
 * `{asset_class:'crypto'}` (or an aum, or a description) ran a real UPDATE and
 * left `category_id` NULL, so a later same-session resubmit read that NULL as
 * "never classified", took the FILL arm, and rewrote fields the user never
 * resubmitted — including flipping the clock on a row whose committed clock
 * was a genuine choice.
 */
describe("[146.2-03 / G2] every metadata UPDATE this route issues writes a category_id", () => {
  /** Blobs spanning refused / empty-payload / real-UPDATE, mixed on purpose. */
  const BLOBS: Array<Record<string, unknown>> = [
    {},
    { description: "no category here" },
    { asset_class: "crypto" },
    { aum: "1000" },
    { markets: ["btc"] },
    { leverage_range: "1-2x" },
    { category_id: CATEGORY_ID },
    {
      category_id: CATEGORY_ID,
      description: "everything",
      aum: "1000",
      asset_class: "crypto",
    },
  ];

  it("🔴 THE INVARIANT: no blob produces a non-empty UPDATE without a category_id", () => {
    let updatesChecked = 0;
    for (const blob of BLOBS) {
      const parsed = parseCsvMetadata(blob);
      // Refused at the boundary → no UPDATE runs → nothing to prove.
      if (!parsed.ok) continue;
      const payload = buildMetadataUpdatePayload(parsed.payload);
      // Parses to nothing → `applyCsvMetadataUpdate` issues no UPDATE at all.
      if (Object.keys(payload).length === 0) continue;
      updatesChecked += 1;
      expect(
        payload.category_id,
        `the blob ${JSON.stringify(blob)} runs a REAL metadata UPDATE that ` +
          "leaves category_id NULL. The 23505 resolve arm then reads that " +
          "NULL as 'never classified', takes the FILL arm, and rewrites " +
          "description/aum/markets/asset_class the user never resubmitted — " +
          "moving the annualization clock on a row whose committed clock was " +
          "a real choice",
      ).toBe(CATEGORY_ID);
    }
    // ⛔ ANTI-VACUITY: a boundary that refused EVERYTHING would satisfy the
    // loop above by never entering the assertion. At least the two
    // category-bearing blobs must reach it.
    expect(
      updatesChecked,
      "no blob reached the assertion — the invariant passed vacuously",
    ).toBe(2);
  });

  it("a blob that omits category_id while carrying asset_class is a caller error, not a silent NULL", () => {
    const result = parseCsvMetadata({ asset_class: "crypto" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejection");
    expect(result.field).toBe("metadata.category_id");
  });

  it("…and the same for a description-only blob — the field does not matter, the UPDATE does", () => {
    const result = parseCsvMetadata({ description: "no category here" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejection");
    expect(result.field).toBe("metadata.category_id");
  });

  it("⛔ COUNTERWEIGHT: the metadata-LESS path stays legal — an empty blob issues no UPDATE and is accepted", () => {
    // Load-bearing in the other direction. "Reject every blob without a
    // category_id" would satisfy the invariant while 400-ing the legitimate
    // metadata-less finalize, which writes nothing and therefore proves
    // nothing wrong.
    const empty = parseCsvMetadata({});
    expect(empty.ok).toBe(true);
    if (!empty.ok) throw new Error("expected acceptance");
    expect(buildMetadataUpdatePayload(empty.payload)).toEqual({});

    const none = parseCsvMetadata(null);
    expect(none.ok).toBe(true);
    if (!none.ok) throw new Error("expected acceptance");
    expect(none.payload).toBeNull();
  });

  it("a blob whose only fields parse to NOTHING is also accepted — no payload, no UPDATE, no claim", () => {
    // `asset_class: null` and `aum: ""` are both explicitly-absent readings
    // that `parseCsvMetadata` drops. The result is an empty payload, so no
    // UPDATE runs and the invariant has nothing to quantify over.
    const result = parseCsvMetadata({ asset_class: null, aum: "" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected acceptance");
    expect(buildMetadataUpdatePayload(result.payload)).toEqual({});
  });
});
