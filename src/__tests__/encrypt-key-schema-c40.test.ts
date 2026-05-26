/**
 * NEW-C40-01 + NEW-C40-02 regression tests — EncryptKeyResponseSchema.
 *
 * NEW-C40-01: Verifies that unknown Python fields are stripped (not
 * passed through) so a future analytics-service field addition does not
 * cause a PostgREST PGRST204 insert failure on all key creation.
 *
 * NEW-C40-02: Verifies that kek_version is coerced to a positive integer
 * and that non-integer strings fail parse so they never reach an
 * INSERT that would produce opaque 22P02 errors.
 */
import { describe, it, expect } from "vitest";
import { EncryptKeyResponseSchema } from "@/lib/analytics-schemas";

const baseValid = {
  api_key_encrypted: "enc_abc",
  api_secret_encrypted: null,
  passphrase_encrypted: null,
  dek_encrypted: "dek_xyz",
  nonce: null,
  kek_version: 1,
};

describe("EncryptKeyResponseSchema (NEW-C40-01: no passthrough)", () => {
  it("parses a valid response without extra fields", () => {
    const result = EncryptKeyResponseSchema.safeParse(baseValid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(baseValid);
    }
  });

  it("strips unknown fields instead of passing them through (NEW-C40-01)", () => {
    const withExtra = {
      ...baseValid,
      key_fingerprint: "fp_abc123",
      correlation_id: "corr-uuid",
      kek_alg: "AES-256-GCM",
    };
    const result = EncryptKeyResponseSchema.safeParse(withExtra);
    expect(result.success).toBe(true);
    if (result.success) {
      // Unknown fields must NOT appear in the parsed output — they are
      // stripped at the schema boundary and will not be spread into the
      // api_keys INSERT (prevents PGRST204).
      expect(result.data).not.toHaveProperty("key_fingerprint");
      expect(result.data).not.toHaveProperty("correlation_id");
      expect(result.data).not.toHaveProperty("kek_alg");
      // Known fields survive
      expect(result.data.api_key_encrypted).toBe("enc_abc");
    }
  });
});

describe("EncryptKeyResponseSchema kek_version (NEW-C40-02)", () => {
  it("accepts a numeric integer kek_version", () => {
    const result = EncryptKeyResponseSchema.safeParse({ ...baseValid, kek_version: 2 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.kek_version).toBe(2);
    }
  });

  it("coerces a pure-numeric string '1' to integer 1", () => {
    const result = EncryptKeyResponseSchema.safeParse({ ...baseValid, kek_version: "1" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.kek_version).toBe(1);
    }
  });

  it("rejects a non-integer string 'v1' (NEW-C40-02: would cause 22P02 on insert)", () => {
    const result = EncryptKeyResponseSchema.safeParse({ ...baseValid, kek_version: "v1" });
    expect(result.success).toBe(false);
  });

  it("coerces float string '1.0' to integer 1 (1.0 is integer-valued)", () => {
    // z.coerce.number() parses "1.0" as 1.0, and .int() passes because
    // 1.0 === Math.trunc(1.0). This is safe: Postgres INTEGER accepts 1.
    const result = EncryptKeyResponseSchema.safeParse({ ...baseValid, kek_version: "1.0" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.kek_version).toBe(1);
    }
  });

  it("rejects a float number 1.5 (NEW-C40-02: DB column is INTEGER)", () => {
    const result = EncryptKeyResponseSchema.safeParse({ ...baseValid, kek_version: 1.5 });
    expect(result.success).toBe(false);
  });

  it("rejects zero (NEW-C40-02: DB column is positive integer)", () => {
    const result = EncryptKeyResponseSchema.safeParse({ ...baseValid, kek_version: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects a negative value", () => {
    const result = EncryptKeyResponseSchema.safeParse({ ...baseValid, kek_version: -1 });
    expect(result.success).toBe(false);
  });
});
