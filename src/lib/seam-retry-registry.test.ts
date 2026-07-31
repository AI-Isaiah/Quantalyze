import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  RETRY_SAFE_FLOW_TYPES,
  RETRY_AUDIT_NO_FLOW_TYPES,
  RETRY_SAFE_ANALYTICS,
  RETRY_AUDIT_NO_ANALYTICS,
} from "./seam-retry-registry";

/**
 * Phase 141 / SEAM-05 — the SC1 idempotency-audit artifact is pinned.
 *
 * ⚠️ ORACLE INDEPENDENCE (141-VALIDATION.md). Every EXPECTED value in this file
 * is a hand-typed literal. `Object.keys(...)` appears ONLY on the ACTUAL side of
 * a comparison; the key lists and counts on the expected side are typed here by
 * hand. The failure this discipline inverts is a registry test that reads the
 * registry's verdicts back out and asserts them against themselves — which would
 * be green for ANY table, including one that allowlisted teaser.
 *
 * What each group catches (all six are red-able against production source):
 *   1. SC3 belt — teaser/csv are strictly absent from the YES flow map.
 *   2. YES contents — the exact safe sets, each entry retries===1 + non-empty evidence.
 *   3. Exhaustiveness — YES∪NO covers EVERY flow_type and EVERY analytics wrapper,
 *      so a future one added without a verdict reddens here.
 *   4. Disjointness — nothing is simultaneously safe and unsafe.
 *   5. Lock resolution — match-recompute's NO evidence still carries the SEAM-05
 *      PROCESS-LOCAL finding; deleting it from the artifact reddens.
 *   6. Purity — the leaf imports nothing by VALUE (browser-bundle + mock survival).
 */

// ── Hand-typed EXPECTED literals (never read from the module under test) ──────

const EXPECTED_SAFE_FLOW_KEYS = ["onboard", "resync"];
const EXPECTED_SAFE_ANALYTICS_KEYS = [
  "bridge",
  "optimize-weights",
  "portfolio-optimizer",
  "simulator",
];

/** All four `/process-key` flow_types (process-key-client.ts:51). */
const EXPECTED_ALL_FLOW_KEYS = ["csv", "onboard", "resync", "teaser"];

/** The nine analytics-seam wrapper budget keys (Class E, PATTERNS). */
const EXPECTED_ALL_ANALYTICS_KEYS = [
  "bridge",
  "encrypt-key",
  "match-eval",
  "match-recompute",
  "optimize-weights",
  "portfolio-analytics",
  "portfolio-optimizer",
  "simulator",
  "validate-key",
];

const LEAF_PATH = "src/lib/seam-retry-registry.ts";

describe("[SEAM-05 / SC1] seam retry-safety registry", () => {
  describe("SC3 belt — teaser and csv are ABSENT from the YES flow map", () => {
    it("RETRY_SAFE_FLOW_TYPES.teaser is strictly undefined", () => {
      // Absence semantics: a present teaser entry would be retried on the next
      // Railway blip, double-minting verification + public_token + lead.
      expect(RETRY_SAFE_FLOW_TYPES.teaser).toBeUndefined();
    });
    it("RETRY_SAFE_FLOW_TYPES.csv is strictly undefined", () => {
      expect(RETRY_SAFE_FLOW_TYPES.csv).toBeUndefined();
    });
  });

  describe("YES maps carry exactly the audited-safe sets", () => {
    it("RETRY_SAFE_FLOW_TYPES keys equal the hand-typed safe set", () => {
      expect(Object.keys(RETRY_SAFE_FLOW_TYPES).sort()).toEqual(
        EXPECTED_SAFE_FLOW_KEYS,
      );
    });
    it("RETRY_SAFE_ANALYTICS keys equal the hand-typed safe set", () => {
      expect(Object.keys(RETRY_SAFE_ANALYTICS).sort()).toEqual(
        EXPECTED_SAFE_ANALYTICS_KEYS,
      );
    });
    it("every YES entry is retries===1 with non-empty evidence", () => {
      for (const entry of Object.values(RETRY_SAFE_FLOW_TYPES)) {
        expect(entry?.retries).toBe(1);
        expect((entry?.evidence.length ?? 0) > 0).toBe(true);
      }
      for (const entry of Object.values(RETRY_SAFE_ANALYTICS)) {
        expect(entry?.retries).toBe(1);
        expect((entry?.evidence.length ?? 0) > 0).toBe(true);
      }
    });
  });

  describe("exhaustiveness — every flow_type and every wrapper has a verdict", () => {
    it("YES∪NO flow keys cover ALL four flow_types", () => {
      const union = [
        ...Object.keys(RETRY_SAFE_FLOW_TYPES),
        ...Object.keys(RETRY_AUDIT_NO_FLOW_TYPES),
      ].sort();
      expect(union).toEqual(EXPECTED_ALL_FLOW_KEYS);
    });
    it("YES∪NO analytics keys cover ALL nine wrappers", () => {
      const union = [
        ...Object.keys(RETRY_SAFE_ANALYTICS),
        ...Object.keys(RETRY_AUDIT_NO_ANALYTICS),
      ].sort();
      expect(union).toEqual(EXPECTED_ALL_ANALYTICS_KEYS);
    });
    it("every NO analytics verdict is a non-empty evidence string", () => {
      for (const evidence of Object.values(RETRY_AUDIT_NO_ANALYTICS)) {
        expect(typeof evidence).toBe("string");
        expect(evidence.length > 0).toBe(true);
      }
    });
  });

  describe("disjointness — nothing is simultaneously safe and unsafe", () => {
    it("YES ∩ NO = ∅ at flow grain", () => {
      const noKeys = new Set(Object.keys(RETRY_AUDIT_NO_FLOW_TYPES));
      const overlap = Object.keys(RETRY_SAFE_FLOW_TYPES).filter((k) =>
        noKeys.has(k),
      );
      expect(overlap).toEqual([]);
    });
    it("YES ∩ NO = ∅ at analytics grain", () => {
      const noKeys = new Set(Object.keys(RETRY_AUDIT_NO_ANALYTICS));
      const overlap = Object.keys(RETRY_SAFE_ANALYTICS).filter((k) =>
        noKeys.has(k),
      );
      expect(overlap).toEqual([]);
    });
  });

  describe("the SEAM-05 lock resolution lives in the committed artifact", () => {
    it("match-recompute NO evidence records the PROCESS-LOCAL finding", () => {
      // Deleting the _get_recompute_lock resolution from the artifact reddens
      // here — the audit's explicit ask cannot silently leave the registry.
      expect(RETRY_AUDIT_NO_ANALYTICS["match-recompute"]).toMatch(
        /process-local/i,
      );
    });
  });

  describe("purity — the leaf imports nothing by VALUE", () => {
    // Same mechanism as seam-discriminator.purity.test.ts: read the source from
    // disk, strip comments, and assert every import statement is `import type`.
    // A VALUE import of resilient-fetch.ts would pull @upstash/redis + a
    // Redis.fromEnv() side effect into the "use client" wizard bundle, and would
    // evaluate to undefined under the wholesale seam-client mocks.
    const src = readFileSync(join(process.cwd(), LEAF_PATH), "utf8");
    const codeLines = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"));
    const importLines = codeLines.filter((line) => /^\s*import\s/.test(line));

    it("has import statements (guard is not vacuous)", () => {
      expect(importLines.length > 0).toBe(true);
    });
    it("every import statement is a type-only import", () => {
      for (const line of importLines) {
        expect(
          /^\s*import\s+type\s/.test(line),
          `${LEAF_PATH} has a non-type import: ${line.trim()} — a VALUE import ` +
            `here reaches the browser bundle and dies under wholesale seam mocks.`,
        ).toBe(true);
      }
    });
    it("contains no require() or dynamic import()", () => {
      const code = codeLines.join("\n");
      expect(/\brequire\s*\(/.test(code)).toBe(false);
      expect(/\bimport\s*\(/.test(code)).toBe(false);
    });
  });
});
