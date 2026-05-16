import { describe, it, expect } from "vitest";
import {
  EnqueueComputeJobResponseSchema,
  EncryptKeyResponseSchema,
  GetUserComputeJobsRowSchema,
  RecomputeMatchResponseSchema,
  TickJobsResponseSchema,
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
 *  - error_kind enum is transient/permanent/unknown (or null)
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
    // The RPC's error_kind is constrained to transient/permanent/unknown.
    // A future write path emitting "timeout" would slip past untyped
    // consumers; the schema flags it.
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
