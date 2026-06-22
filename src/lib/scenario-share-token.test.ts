import { describe, it, expect } from "vitest";
import { mintShareToken, hashShareToken } from "@/lib/scenario-share-token";

// SHARE-01 token-entropy / format / determinism unit test.
//
// These pins guard the security contract of the share path:
//   - the raw token is a 256-bit CSPRNG secret that lives ONLY in the URL,
//   - only its sha256 hex is ever persisted (`scenario_shares.token_hash`)
//     or passed to the `get_shared_scenario(p_token_hash)` RPC,
//   - the hash algorithm is deterministic so the route (which stores it) and
//     the public page (which looks up by it) cannot drift from the RPC.

const HEX_64 = /^[0-9a-f]{64}$/;
// base64url (RFC 4648 §5): A–Z a–z 0–9 - _ with NO padding.
const BASE64URL_NO_PAD = /^[A-Za-z0-9_-]+$/;

describe("mintShareToken", () => {
  it("returns a 256-bit base64url raw token that decodes to exactly 32 bytes", () => {
    const { raw } = mintShareToken();
    // 32 random bytes encode to 43 base64url chars (no padding).
    expect(raw).toHaveLength(43);
    expect(raw).toMatch(BASE64URL_NO_PAD);
    expect(Buffer.from(raw, "base64url")).toHaveLength(32);
  });

  it("returns a hash that equals hashShareToken(raw) and differs from raw", () => {
    const { raw, hash } = mintShareToken();
    expect(hash).toBe(hashShareToken(raw));
    expect(hash).not.toBe(raw);
  });

  it("produces a different raw token on each call (randomness sanity)", () => {
    const tokens = new Set(
      Array.from({ length: 50 }, () => mintShareToken().raw),
    );
    expect(tokens.size).toBe(50);
  });
});

describe("hashShareToken", () => {
  it("returns a 64-char lowercase sha256 hex digest", () => {
    const { raw } = mintShareToken();
    const hash = hashShareToken(raw);
    expect(hash).toMatch(HEX_64);
  });

  it("is deterministic: same input -> same digest", () => {
    const { raw } = mintShareToken();
    expect(hashShareToken(raw)).toBe(hashShareToken(raw));
  });

  it("matches a known sha256 vector (pins the exact algorithm the RPC expects)", () => {
    // sha256("scenario-share") — the recipient route / RPC must hash an
    // identical raw token to this same digest, or the lookup silently misses.
    expect(hashShareToken("scenario-share")).toBe(
      "e1c28b72e9237809e2bd84d2ace94f6b4c7b99096ac6ebf64fe665c46c491676",
    );
    // sha256("a") known vector — different inputs -> different digests.
    expect(hashShareToken("a")).toBe(
      "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb",
    );
    expect(hashShareToken("a")).not.toBe(hashShareToken("b"));
  });
});
