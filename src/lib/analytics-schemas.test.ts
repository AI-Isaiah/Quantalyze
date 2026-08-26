import { describe, it, expect } from "vitest";
import {
  EnqueueComputeJobResponseSchema,
  EncryptKeyResponseSchema,
  GetUserComputeJobsRowSchema,
  RecomputeMatchResponseSchema,
  TickJobsResponseSchema,
  BridgeFitLabelSchema,
  BridgeResponseSchema,
  LivePermissionsSchema,
  KeyPermissionsPayloadSchema,
} from "./analytics-schemas";

/**
 * Unit tests for the Sprint 2 Task 2.9 strict-versioned contracts.
 *
 * These tests exist specifically to pin down the "fail loud on contract
 * drift" guarantee of the strict-versioned style. The legacy loose
 * .passthrough() schemas in analytics-schemas.ts are not covered here
 * because their contract is "warn on drift, accept extras" — nothing to
 * pin. The strict schemas are the first ones where a future accidental
 * loosening (.optional, wider type) would silently pass review, so we
 * lock in the exact behavior with negative-path tests.
 */

describe("EnqueueComputeJobResponseSchema", () => {
  it("accepts a valid UUID", () => {
    const uuid = "11111111-2222-4333-8444-555555555555";
    expect(EnqueueComputeJobResponseSchema.parse(uuid)).toBe(uuid);
  });

  it.each([
    ["not-a-uuid"],
    [""],
    ["11111111-2222-4333-8444"],
    ["11111111222243338444555555555555"],
  ])("rejects malformed string %p", (value) => {
    const result = EnqueueComputeJobResponseSchema.safeParse(value);
    expect(result.success).toBe(false);
  });

  it.each([[null], [undefined], [42], [{}], [[]]])(
    "rejects non-string %p",
    (value) => {
      const result = EnqueueComputeJobResponseSchema.safeParse(value);
      expect(result.success).toBe(false);
    },
  );
});

describe("TickJobsResponseSchema", () => {
  const valid = {
    contract_version: 1 as const,
    claimed: 3,
    done: 2,
    failed_retry: 1,
    failed_final: 0,
    reclaimed: 0,
    duration_ms: 1234,
    worker_id: "railway-abc",
  };

  it("parses a valid tick summary", () => {
    expect(TickJobsResponseSchema.parse(valid)).toMatchObject(valid);
  });

  it("rejects contract_version=2 (future drift must fail loudly)", () => {
    const result = TickJobsResponseSchema.safeParse({
      ...valid,
      contract_version: 2,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["contract_version"]);
    }
  });

  it("rejects missing contract_version", () => {
    const rest = { ...valid } as Partial<typeof valid>;
    delete rest.contract_version;
    expect(TickJobsResponseSchema.safeParse(rest).success).toBe(false);
  });

  it.each([
    ["claimed", -1],
    ["done", -1],
    ["failed_retry", -1],
    ["failed_final", -1],
    ["reclaimed", -1],
    ["duration_ms", -1],
  ])("rejects negative %s", (key, value) => {
    expect(
      TickJobsResponseSchema.safeParse({ ...valid, [key]: value }).success,
    ).toBe(false);
  });

  it.each([
    ["claimed", 1.5],
    ["done", 2.7],
    ["duration_ms", 1234.5],
  ])("rejects non-integer %s", (key, value) => {
    expect(
      TickJobsResponseSchema.safeParse({ ...valid, [key]: value }).success,
    ).toBe(false);
  });

  it("rejects empty worker_id", () => {
    expect(
      TickJobsResponseSchema.safeParse({ ...valid, worker_id: "" }).success,
    ).toBe(false);
  });

  it("rejects string where number expected", () => {
    expect(
      TickJobsResponseSchema.safeParse({ ...valid, duration_ms: "1234" })
        .success,
    ).toBe(false);
  });

  it("rejects unknown extra fields (strict contract)", () => {
    // This test locks in the .strict() behavior — without it, Zod would
    // silently strip `secrets_leaked` and a contract drift would pass
    // review. See analytics-schemas.ts comment on TickJobsResponseSchema.
    const result = TickJobsResponseSchema.safeParse({
      ...valid,
      secrets_leaked: "very bad",
    });
    expect(result.success).toBe(false);
  });

  it("rejects contract_version=0 (literal binding)", () => {
    // Pins down that the literal is specifically 1, not just "any number".
    // If someone refactors to z.number() by mistake, this catches it.
    const result = TickJobsResponseSchema.safeParse({
      ...valid,
      contract_version: 0,
    });
    expect(result.success).toBe(false);
  });
});

// Regression: ISSUE-002 — EncryptKeyResponseSchema used legacy flat field
// names (encrypted_key, encrypted_secret) but analytics-service returns
// envelope-encryption field names (api_key_encrypted, api_secret_encrypted
// ALWAYS null, dek_encrypted, etc.). Add-key modal could never submit.
// Found by /qa on 2026-04-20 in /exchanges add-key modal.
// Report: .gstack/qa-reports/qa-report-quantalyze-phase-06-2026-04-20.md
describe("EncryptKeyResponseSchema (envelope-encryption contract)", () => {
  // Exact response shape produced by analytics-service/services/encryption.py
  // -> encrypt_credentials(). All credentials bundled into api_key_encrypted;
  // api_secret_encrypted / passphrase_encrypted / nonce stay null by design.
  const realPayload = {
    api_key_encrypted: "gAAAAABp5fDh...ciphertext...",
    api_secret_encrypted: null,
    passphrase_encrypted: null,
    dek_encrypted: "gAAAAABp5fDh...dek...",
    nonce: null,
    kek_version: 1,
  };

  it("accepts the real analytics-service envelope-encryption payload", () => {
    const result = EncryptKeyResponseSchema.safeParse(realPayload);
    expect(result.success).toBe(true);
  });

  it("accepts kek_version as a string (legacy compatibility)", () => {
    const result = EncryptKeyResponseSchema.safeParse({
      ...realPayload,
      kek_version: "1",
    });
    expect(result.success).toBe(true);
  });

  it("rejects response missing api_key_encrypted (no ciphertext = unrecoverable)", () => {
    const { api_key_encrypted: _unused, ...rest } = realPayload;
    const result = EncryptKeyResponseSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects response missing dek_encrypted (no DEK = cannot decrypt payload)", () => {
    const { dek_encrypted: _unused, ...rest } = realPayload;
    const result = EncryptKeyResponseSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects the old flat schema shape that caused the add-key 400", () => {
    // If anyone reverts the schema to the legacy flat names, this fails
    // loudly instead of silently breaking the add-key modal in production.
    const legacyFlat = {
      encrypted_key: "ciphertext",
      encrypted_secret: "ciphertext",
      kek_version: 1,
    };
    const result = EncryptKeyResponseSchema.safeParse(legacyFlat);
    expect(result.success).toBe(false);
  });
});

/**
 * pr-test-analyzer c9 (audit-2026-05-07 apply): pin
 * `GetUserComputeJobsRowSchema` against contract drift. The schema's
 * regression value comes from .strict() rejecting unknown fields plus
 * tight enum constraints — without this battery a future relaxation
 * (e.g. dropping .strict() or widening status to z.string()) ships
 * silently. Mirrors the TickJobsResponseSchema pattern above.
 *
 * Field semantics under test:
 *  - .strict() rejects unknown fields (added column = schema bump)
 *  - last_error is z.null() (redaction-layer regression trips parse)
 *  - status enum is fixed at 6 values (drift = parse failure)
 *  - error_kind enum is transient/permanent/unknown/orphaned (or null)
 *  - exchange enum is binance/okx/bybit (or null)
 *  - attempts non-negative, max_attempts positive, trade_count non-negative
 */
describe("GetUserComputeJobsRowSchema", () => {
  // A canonical valid row matching the RPC's RETURNS TABLE shape (mig 032
  // STEP 16 + mig 111 user_message + audit-2026-05-07 residual COALESCE).
  const valid = {
    id: "11111111-2222-4333-8444-555555555555",
    strategy_id: "22222222-3333-4444-8555-666666666666",
    portfolio_id: null,
    kind: "sync_trades",
    parent_job_ids: [],
    status: "failed_final" as const,
    attempts: 3,
    max_attempts: 3,
    next_attempt_at: "2026-05-15T12:00:00.000Z",
    claimed_at: "2026-05-15T11:59:00.000Z",
    claimed_by: "railway-pod-abc",
    last_error: null,
    error_kind: "permanent" as const,
    idempotency_key: "strategy:22222222-3333-4444-8555-666666666666:sync_trades",
    exchange: "binance" as const,
    trade_count: 42,
    created_at: "2026-05-15T11:55:00.000Z",
    updated_at: "2026-05-15T12:00:00.000Z",
    metadata: { source: "manual" },
    user_message: "Tried multiple times without success. Please contact support.",
  };

  it("accepts a canonical valid RPC row", () => {
    expect(GetUserComputeJobsRowSchema.parse(valid)).toMatchObject(valid);
  });

  it("rejects unknown extra fields (.strict() lock)", () => {
    // The "fail loud on contract drift" guarantee. A future migration
    // that adds a column to the RPC's RETURNS TABLE without updating
    // this schema fails the parse here. Without .strict() Zod strips
    // the field and the contract drift goes silently to production.
    const result = GetUserComputeJobsRowSchema.safeParse({
      ...valid,
      secrets_leaked: "very bad",
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-null last_error (redaction-layer regression)", () => {
    // The RPC hard-codes NULL::TEXT for last_error inside its body. If
    // a future refactor returns the raw column instead, this test
    // catches it before the leaked-credential surface reaches the UI.
    const result = GetUserComputeJobsRowSchema.safeParse({
      ...valid,
      last_error: "LEAKED_SECRET",
    });
    expect(result.success).toBe(false);
  });

  it.each([
    ["frozen"],
    ["queued"],
    ["complete"],
    ["DONE"], // case-sensitive
    [""],
  ])("rejects unknown status %p", (status) => {
    const result = GetUserComputeJobsRowSchema.safeParse({ ...valid, status });
    expect(result.success).toBe(false);
  });

  it("rejects attempts = -1 (CHECK constraint mirror)", () => {
    const result = GetUserComputeJobsRowSchema.safeParse({
      ...valid,
      attempts: -1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects max_attempts = 0 (CHECK constraint mirror)", () => {
    const result = GetUserComputeJobsRowSchema.safeParse({
      ...valid,
      max_attempts: 0,
    });
    expect(result.success).toBe(false);
  });

  it("rejects trade_count = -1", () => {
    const result = GetUserComputeJobsRowSchema.safeParse({
      ...valid,
      trade_count: -1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer attempts", () => {
    const result = GetUserComputeJobsRowSchema.safeParse({
      ...valid,
      attempts: 1.5,
    });
    expect(result.success).toBe(false);
  });

  it("rejects idempotency_key longer than 128 chars", () => {
    const result = GetUserComputeJobsRowSchema.safeParse({
      ...valid,
      idempotency_key: "x".repeat(129),
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown exchange (enum drift)", () => {
    const result = GetUserComputeJobsRowSchema.safeParse({
      ...valid,
      exchange: "kraken",
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown error_kind", () => {
    // The RPC's error_kind is constrained to transient/permanent/unknown/
    // orphaned ('orphaned' added by mig 20260826140000, and pinned against the
    // SQL CHECK by check-zod-db-check-parity.test.ts). A future write path
    // emitting "timeout" would slip past untyped consumers; the schema flags it.
    const result = GetUserComputeJobsRowSchema.safeParse({
      ...valid,
      error_kind: "timeout",
    });
    expect(result.success).toBe(false);
  });

  it("accepts null user_message (healthy / in-flight row)", () => {
    const parsed = GetUserComputeJobsRowSchema.parse({
      ...valid,
      status: "running" as const,
      user_message: null,
    });
    expect(parsed.user_message).toBeNull();
  });

  it("rejects non-array parent_job_ids", () => {
    const result = GetUserComputeJobsRowSchema.safeParse({
      ...valid,
      parent_job_ids: "not-an-array",
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-UUID id", () => {
    const result = GetUserComputeJobsRowSchema.safeParse({
      ...valid,
      id: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });
});

/**
 * Phase B pr-test-analyzer F8 — `RecomputeMatchResponseSchema` covers ONLY
 * the per-allocator `/api/match/recompute` endpoint (3 statuses). The wider
 * cron-recompute status set (`no_allocators`, `empty_universe`, `degraded`,
 * `total_failure`) is intentionally NOT in this schema. Negative tests pin
 * the contract so a future contributor that wires cron-recompute through
 * the same parser sees a loud failure rather than silent drift.
 */
describe("RecomputeMatchResponseSchema", () => {
  it("accepts the three valid status values", () => {
    expect(
      RecomputeMatchResponseSchema.parse({ status: "ok" }).status,
    ).toBe("ok");
    expect(
      RecomputeMatchResponseSchema.parse({ status: "disabled" }).status,
    ).toBe("disabled");
    expect(
      RecomputeMatchResponseSchema.parse({ status: "skipped" }).status,
    ).toBe("skipped");
  });

  it.each([
    "throttled",
    "no_allocators",
    "empty_universe",
    "total_failure",
    "degraded",
    "",
    "OK", // case-sensitive
  ])("rejects unknown status value %p", (status) => {
    const result = RecomputeMatchResponseSchema.safeParse({ status });
    expect(result.success).toBe(false);
  });

  it("rejects payloads missing the required status field", () => {
    const result = RecomputeMatchResponseSchema.safeParse({
      allocator_id: "00000000-0000-0000-0000-000000000abc",
    });
    expect(result.success).toBe(false);
  });

  it("passes through extra fields (.passthrough() forward-compat)", () => {
    const parsed = RecomputeMatchResponseSchema.parse({
      status: "ok",
      allocator_id: "00000000-0000-0000-0000-000000000abc",
      processed: 12,
      reason: "future_field",
    }) as { status: string; reason?: string; processed?: number };
    expect(parsed.status).toBe("ok");
    expect(parsed.reason).toBe("future_field");
    expect(parsed.processed).toBe(12);
  });
});

/**
 * H-1078 — /api/portfolio-bridge response contract.
 *
 * BridgeResponseSchema validates the Python bridge service response. A
 * regression in the Python router (sharpe_delta coerced to a string, a
 * dropped field, a mistyped fit_label tier) crashes the panel with a
 * generic Zod error. These tests pin the contract:
 *   - BridgeFitLabelSchema accepts ONLY the 4 canonical tiers (case-exact).
 *   - BridgeCandidateSchema requires all 7 fields with their exact types.
 *   - BridgeResponseSchema is .passthrough() — the service's extra
 *     top-level fields (status, portfolio_id, ...) must NOT throw. If a
 *     future PR makes it .strict(), this test fails loudly.
 */
const VALID_CANDIDATE = {
  strategy_id: "strat-a",
  strategy_name: "Strategy A",
  sharpe_delta: 0.1,
  dd_delta: -0.05,
  corr_delta: -0.03,
  composite_score: 0.5,
  fit_label: "Strong fit" as const,
};

describe("BridgeFitLabelSchema", () => {
  it.each([["Strong fit"], ["Good fit"], ["Moderate fit"], ["Weak fit"]])(
    "accepts the canonical tier %s",
    (tier) => {
      expect(BridgeFitLabelSchema.parse(tier)).toBe(tier);
    },
  );

  it("rejects a mis-cased tier ('Strong Fit' vs 'Strong fit')", () => {
    // The Record<BridgeFitLabel,…> lookups in ReplacementCard rely on the
    // exact lowercase-second-word casing; a contract drift would slip a
    // bad enum value past parse and break the styling lookup.
    expect(() => BridgeFitLabelSchema.parse("Strong Fit")).toThrow();
  });

  it("rejects a tier outside the 4 allowed values", () => {
    expect(() => BridgeFitLabelSchema.parse("Excellent fit")).toThrow();
  });
});

describe("BridgeResponseSchema", () => {
  it("parses a valid candidates array", () => {
    const parsed = BridgeResponseSchema.parse({ candidates: [VALID_CANDIDATE] });
    expect(parsed.candidates).toHaveLength(1);
    expect(parsed.candidates[0]).toMatchObject(VALID_CANDIDATE);
  });

  it("parses an empty candidates array", () => {
    expect(BridgeResponseSchema.parse({ candidates: [] }).candidates).toEqual([]);
  });

  it("rejects a fit_label outside the 4 allowed enum values", () => {
    const result = BridgeResponseSchema.safeParse({
      candidates: [{ ...VALID_CANDIDATE, fit_label: "Strong Fit" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects when sharpe_delta is a string (no numeric coercion)", () => {
    // Python returning "0.1" instead of 0.1 must fail loud, not coerce.
    const result = BridgeResponseSchema.safeParse({
      candidates: [{ ...VALID_CANDIDATE, sharpe_delta: "0.1" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a candidate missing strategy_name (all 7 fields required)", () => {
    const { strategy_name: _omit, ...withoutName } = VALID_CANDIDATE;
    const result = BridgeResponseSchema.safeParse({ candidates: [withoutName] });
    expect(result.success).toBe(false);
  });

  it("rejects a candidate missing composite_score", () => {
    const { composite_score: _omit, ...withoutScore } = VALID_CANDIDATE;
    const result = BridgeResponseSchema.safeParse({ candidates: [withoutScore] });
    expect(result.success).toBe(false);
  });

  it("passes through extra top-level fields (status, portfolio_id, underperformer_strategy_id)", () => {
    // .passthrough() is intentional — the Python service ships extra
    // envelope fields. Flipping to .strict() would 500 the panel.
    const parsed = BridgeResponseSchema.parse({
      candidates: [VALID_CANDIDATE],
      status: "ok",
      portfolio_id: "pf-1",
      underperformer_strategy_id: "strat-z",
    }) as Record<string, unknown>;
    expect(parsed.status).toBe("ok");
    expect(parsed.portfolio_id).toBe("pf-1");
    expect(parsed.underperformer_strategy_id).toBe("strat-z");
  });
});

/**
 * [140.3-03 / SEAMUX-07] LivePermissionsSchema — the PUBLISH GATE's contract.
 *
 * This schema is not a display contract. Two call sites turn this body into a
 * decision about whether a money-bearing key may be published as
 * read-only-verified, and both used to read it through an unchecked `as` cast
 * that rejected only on an explicit `=== true`. A 2xx `{}` therefore left every
 * scope `undefined`, every gate passed, and the draft finalised.
 *
 * So the assertions below are about ABSENCE and MISTYPING, not about the happy
 * path: `read` / `trade` / `withdraw` must be UNPARSEABLE when missing, because
 * absence is exactly the drift that publishes a write-capable key. Every fixture
 * is hand-typed here; nothing is imported from a call site.
 */
describe("[140.3-03 / SEAMUX-07] LivePermissionsSchema", () => {
  const WELL_FORMED_READ_ONLY = {
    read: true,
    trade: false,
    withdraw: false,
    probe_error: false,
  };

  it("accepts the well-formed read-only triple — the case that must still PUBLISH", () => {
    const parsed = LivePermissionsSchema.parse(WELL_FORMED_READ_ONLY);
    expect(parsed.read).toBe(true);
    expect(parsed.trade).toBe(false);
    expect(parsed.withdraw).toBe(false);
    expect(parsed.probe_error).toBe(false);
  });

  it("accepts a body with probe_error OMITTED — its absence already means 'no probe error'", () => {
    const parsed = LivePermissionsSchema.parse({
      read: true,
      trade: false,
      withdraw: false,
    });
    expect(parsed.probe_error).toBeUndefined();
  });

  it("REJECTS an empty 2xx object — the shape that published a write-capable key", () => {
    expect(LivePermissionsSchema.safeParse({}).success).toBe(false);
  });

  it.each([["read"], ["trade"], ["withdraw"]])(
    "REJECTS a body missing %s — absence must never read as 'not granted'",
    (field) => {
      const body: Record<string, unknown> = { ...WELL_FORMED_READ_ONLY };
      delete body[field];
      const result = LivePermissionsSchema.safeParse(body);
      expect(
        result.success,
        `A missing \`${field}\` must fail the parse. If it parses, the gate ` +
          `reads \`undefined\`, \`undefined === true\` is false, and a key ` +
          `holding that scope publishes as read-only-verified.`,
      ).toBe(false);
    },
  );

  it("REJECTS a renamed scope field (trade → can_trade) rather than defaulting it", () => {
    const result = LivePermissionsSchema.safeParse({
      read: true,
      can_trade: true,
      withdraw: false,
    });
    expect(result.success).toBe(false);
  });

  it.each([["true"], [1], [null], [{}]])(
    "REJECTS a non-boolean trade (%p) — no coercion at a security boundary",
    (value) => {
      const result = LivePermissionsSchema.safeParse({
        ...WELL_FORMED_READ_ONLY,
        trade: value,
      });
      expect(result.success).toBe(false);
    },
  );

  it("STRIPS unknown extra fields instead of passing them through", () => {
    const parsed = LivePermissionsSchema.parse({
      ...WELL_FORMED_READ_ONLY,
      detected_at: "2026-07-27T00:00:00Z",
      future_field: "whatever",
    }) as Record<string, unknown>;
    expect(parsed.future_field).toBeUndefined();
    expect(parsed.detected_at).toBeUndefined();
  });
});

describe("[140.3-03 / SEAMUX-07] KeyPermissionsPayloadSchema", () => {
  const WELL_FORMED = {
    read: true,
    trade: false,
    withdraw: false,
    probe_error: false,
    detected_at: "2026-07-27T00:00:00Z",
  };

  it("accepts the badge payload and FORWARDS detected_at", () => {
    const parsed = KeyPermissionsPayloadSchema.parse(WELL_FORMED);
    expect(parsed.detected_at).toBe("2026-07-27T00:00:00Z");
    expect(parsed.read).toBe(true);
  });

  it("inherits the scope requirement — a body missing `trade` is REJECTED here too", () => {
    const { trade: _omit, ...withoutTrade } = WELL_FORMED;
    expect(KeyPermissionsPayloadSchema.safeParse(withoutTrade).success).toBe(
      false,
    );
  });

  it("REJECTS an empty 2xx object", () => {
    expect(KeyPermissionsPayloadSchema.safeParse({}).success).toBe(false);
  });

  it("REJECTS a body without detected_at — every emitter arm sets it, so its absence is drift", () => {
    const { detected_at: _omit, ...withoutStamp } = WELL_FORMED;
    expect(KeyPermissionsPayloadSchema.safeParse(withoutStamp).success).toBe(
      false,
    );
  });
});
