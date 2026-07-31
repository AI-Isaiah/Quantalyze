import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// The SAME needle the seam-surface comment guard uses, hoisted to a non-test
// leaf so there is ONE regex, not two. (Importing the sibling TEST file was
// measured and rejected: vitest re-registered its 46 tests into this file.)
import { citationsIn, CONVERSION_PROTOCOL } from "./seam-citations-needle";
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

  // ───────────────────────────────────────────────────────────────────────────
  // 141.1 CONTENT PINS — the re-derived evidence is pinned CLAIM BY CLAIM.
  //
  // WHY A CONTENT PIN AND NOT A KEY PIN. The key-set pins above prove WHICH
  // rows are allowlisted; they are blind to WHY. But the registry's premise is
  // "the evidence IS the entry" — a future engineer extending the allowlist
  // reasons from this prose, so prose that says something false is a defective
  // deliverable even while every verdict is right. The 141.1 re-derivation
  // found exactly that: three of the four analytics YES entries claimed "no
  // persisted server-side write" and all three DO write. These pins make the
  // corrected claims load-bearing, so a revert to the false text reddens
  // instead of silently restoring the reasoning that would authorise a wrong
  // YES.
  //
  // ⚠️ ORACLE INDEPENDENCE HOLDS HERE TOO: every key list below is hand-typed.
  // Deriving them from `Object.keys` of the map under test would make these
  // pins green for any table, including one whose evidence had been emptied.
  // ───────────────────────────────────────────────────────────────────────────

  /** The three analytics YES entries that DO write (D-04). `optimize-weights` is excluded. */
  const EXPECTED_WRITING_ANALYTICS_KEYS = [
    "bridge",
    "portfolio-optimizer",
    "simulator",
  ] as const;

  /** The banned claim — true of `optimize-weights` alone (D-04). */
  const BANNED_WRITELESS_CLAIM = "no persisted server-side write";

  describe("[D-04] the writeless claim belongs to optimize-weights ALONE", () => {
    it.each(EXPECTED_WRITING_ANALYTICS_KEYS)(
      "%s evidence does NOT claim to be writeless",
      (key) => {
        expect(
          RETRY_SAFE_ANALYTICS[key]?.evidence,
          `${key} carries the claim "${BANNED_WRITELESS_CLAIM}", which the 141.1 ` +
            `re-derivation DISPROVED for it (bridge and simulator append audit ` +
            `rows; portfolio-optimizer additionally UPDATEs ` +
            `portfolio_analytics.optimizer_suggestions). This is not a wording ` +
            `nit: the next engineer extending the allowlist reads this prose as ` +
            `the audit, and "writeless" is the single fact that would make a new ` +
            `YES look free. State the ACTUAL writes and why the retry is safe ` +
            `given them — never re-assert writelessness here.`,
        ).not.toContain(BANNED_WRITELESS_CLAIM);
      },
    );

    it("optimize-weights DOES still carry it (the pin is not vacuous)", () => {
      // Without this, deleting the claim everywhere would leave the pin above
      // green — a ban that bans nothing because the string no longer exists.
      expect(RETRY_SAFE_ANALYTICS["optimize-weights"]?.evidence).toContain(
        BANNED_WRITELESS_CLAIM,
      );
    });
  });

  describe("[D-03] every analytics YES entry records the doubled-compute cost", () => {
    // ⚠️ WHY THIS PIN NAMES THE MECHANISM AND NOT A LOOSE ALTERNATION. The first
    // draft of this pin was `/concurrent|is_disconnected|doubled/i`. Measured
    // against the real mutation (delete the COST sentence from `simulator`) it
    // stayed GREEN: simulator's evidence separately says the failure-path row
    // "cannot be doubled by a seam retry", so the alternation was satisfied by a
    // sentence about something else entirely. That is this phase's own thesis
    // turned on the guard — a scanner that matches something incidental reports
    // agreement forever. Both halves below are load-bearing and appear ONLY in
    // the COST sentence, so deleting that sentence reddens for all four keys.
    // NEVER relax these to an alternation that some other sentence can satisfy.
    it.each(EXPECTED_SAFE_ANALYTICS_KEYS)(
      "%s evidence records the second concurrent compute AND names the mechanism",
      (key) => {
        const evidence =
          RETRY_SAFE_ANALYTICS[key as keyof typeof RETRY_SAFE_ANALYTICS]?.evidence;
        const message =
          `${key} no longer records the D-03 cost. A retry on this budget adds a ` +
          `SECOND concurrent full compute while attempt 1 still burns CPU, ` +
          `because nothing on the FastAPI side awaits request.is_disconnected(). ` +
          `That is an ACCEPTED consequence of this phase, not an absent one — ` +
          `deleting it lets the cost be inherited silently by whoever reads this ` +
          `entry as precedent, and server-side cancellation is deferred to its ` +
          `own phase precisely BECAUSE the cost is recorded here.`;
        expect(evidence, message).toMatch(/second concurrent full compute/);
        expect(evidence, message).toMatch(/request\.is_disconnected\(\)/);
      },
    );
  });

  describe("[D-05] the flow evidence states its residuals and its qualification", () => {
    it("resync does NOT claim the SEQUENTIAL class is closed", () => {
      expect(
        RETRY_SAFE_FLOW_TYPES.resync?.evidence,
        `resync's evidence has re-acquired a "class is closed" claim. It is NOT ` +
          `closed: the plan-01 pre-check filters status='draft', and the worker's ` +
          `30s tick advances SV#1 out of draft, so a transition landing inside the ` +
          `blip window lets a SECOND draft row through. The residual is bounded ` +
          `and recorded — overstating it as closed is what a future reader would ` +
          `rely on when deciding a NEW flow needs no dedup.`,
      ).not.toMatch(/class is closed/i);
    });

    it.each(EXPECTED_SAFE_FLOW_KEYS)(
      "%s qualifies 'exactly one job' to the three INDEXED statuses",
      (key) => {
        expect(
          RETRY_SAFE_FLOW_TYPES[key as keyof typeof RETRY_SAFE_FLOW_TYPES]?.evidence,
          `${key} no longer names the three statuses the partial unique index ` +
            `compute_jobs_one_inflight_per_kind_strategy actually admits ` +
            `(pending, running, done_pending_children). Unqualified, "exactly one ` +
            `job" reads as an absolute — but failed_retry sits OUTSIDE the index ` +
            `predicate, so the guarantee lapses exactly where a retry story cares.`,
          // `[\s\S]*` rather than `.*` with the `s` flag: the dotAll flag needs
          // an es2018+ target and this repo's tsconfig is lower (TS1501). The
          // two are equivalent here and this form compiles everywhere.
        ).toMatch(/pending[\s\S]*running[\s\S]*done_pending_children/);
      },
    );

    it("onboard records the PROVENANCE of the wizard_session_id guarantee", () => {
      // The pre-141.1 text stated the non-NULL guarantee as a bare fact. A fact
      // cannot be falsified by a future producer; a recorded provenance can.
      const evidence = RETRY_SAFE_FLOW_TYPES.onboard?.evidence;
      const message =
        "onboard's evidence has lost part of the provenance chain that makes its " +
        "non-NULL wizard_session_id guarantee FALSIFIABLE rather than merely " +
        "asserted: the isUuid 400 gate in create-with-key, the 7-day " +
        "cleanup_abandoned_wizard_drafts purge, and the SV dedup index " +
        "strategy_verifications_strategy_wizard_session_uniq. Restore the link " +
        "that was deleted — a future producer emitting a NULL session id must " +
        "visibly trip this reasoning, not silently invalidate it.";
      expect(evidence, message).toMatch(/isUuid/);
      expect(evidence, message).toMatch(/cleanup_abandoned_wizard_drafts/);
      expect(evidence, message).toMatch(
        /strategy_verifications_strategy_wizard_session_uniq/,
      );
    });

    it("onboard names BOTH of its producers", () => {
      // Evidence derived from ONE member of a class of two is the
      // instance-not-class shape this phase exists to repair: `onboard` is
      // emitted by strategies/finalize-wizard AND by keys/validate-and-encrypt,
      // and the provenance argument above holds for only the first.
      const evidence = RETRY_SAFE_FLOW_TYPES.onboard?.evidence;
      const message =
        "onboard's evidence no longer names both emitters of flow_type=onboard. " +
        "The wizard path (strategies/finalize-wizard) is where the provenance " +
        "argument was derived; keys/validate-and-encrypt sends NO " +
        "wizard_session_id at all and is retry-safe for a DIFFERENT reason (its " +
        "budget row is pinned at zero retries). Dropping either producer leaves " +
        "the verdict resting on evidence that covers only half its own class.";
      expect(evidence, message).toMatch(/finalize-wizard/);
      expect(evidence, message).toMatch(/validate-and-encrypt/);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // [D-06] SC-H — THE REGISTRY-LOCAL CITATION GUARD, over the evidence STRING
  // LITERALS. This is the half that catches today's rot.
  //
  // WHY THE SIBLING GUARD IS NOT ENOUGH. `seam-citations.invariant.test.ts` now
  // lists this registry on its surface, but that guard EXTRACTS COMMENTS and
  // feeds only those to the needle. Its own `-1` self-test pins the fact that a
  // coordinate inside a STRING LITERAL is invisible to it. In this one file the
  // string literals ARE the prose — the registry's premise is "the evidence IS
  // the entry" — so the comment half finds zero offences here while the rot that
  // actually shipped lived in the evidence strings. Both halves, or neither
  // works.
  //
  // ⚠️ TWO VALUE SHAPES, HANDLED EXPLICITLY. The two YES maps hold
  // `RetrySafeEntry` OBJECTS (the prose is `entry.evidence`); the two NO maps are
  // `Partial<Record<K, string>>` where the VALUE **is** the prose. A naive
  // `.evidence` access across all four yields `undefined` for 7 of the 13
  // strings, and `citationsIn(undefined)` would throw or silently pass — a guard
  // half-vacuous on exactly the half where the load-bearing rot lived.
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Hand-typed per map (2 + 4 + 2 + 5), never derived from the maps. Emptying a
   * map must REDDEN rather than shrink the scanned population to zero and pass —
   * the "scanner that matches nothing reports agreement forever" fence.
   */
  const EXPECTED_EVIDENCE_STRING_COUNT = 2 + 4 + 2 + 5;

  /** Every evidence string across ALL FOUR maps, each shape read correctly. */
  function allEvidenceStrings(): Array<{ where: string; text: string }> {
    const out: Array<{ where: string; text: string }> = [];
    // Shape 1 — YES maps: the prose hangs off `.evidence`.
    for (const [key, entry] of Object.entries(RETRY_SAFE_FLOW_TYPES)) {
      if (entry) out.push({ where: `RETRY_SAFE_FLOW_TYPES.${key}`, text: entry.evidence });
    }
    for (const [key, entry] of Object.entries(RETRY_SAFE_ANALYTICS)) {
      if (entry) out.push({ where: `RETRY_SAFE_ANALYTICS.${key}`, text: entry.evidence });
    }
    // Shape 2 — NO maps: the VALUE is the prose.
    for (const [key, text] of Object.entries(RETRY_AUDIT_NO_FLOW_TYPES)) {
      if (text) out.push({ where: `RETRY_AUDIT_NO_FLOW_TYPES.${key}`, text });
    }
    for (const [key, text] of Object.entries(RETRY_AUDIT_NO_ANALYTICS)) {
      if (text) out.push({ where: `RETRY_AUDIT_NO_ANALYTICS.${key}`, text });
    }
    return out;
  }

  describe("[D-06 / SC-H] no coordinate citation in any evidence STRING", () => {
    it("scans exactly 13 non-empty evidence strings (anti-vacuity fence)", () => {
      const scanned = allEvidenceStrings().filter(
        (e) => typeof e.text === "string" && e.text.length > 0,
      );
      expect(
        scanned.length,
        `the evidence-string population is ${scanned.length}, not ` +
          `${EXPECTED_EVIDENCE_STRING_COUNT} (2 flow YES + 4 analytics YES + 2 ` +
          `flow NO + 5 analytics NO). If a verdict was legitimately added or ` +
          `removed, bump this hand-typed literal IN THE SAME COMMIT. If it was ` +
          `not, a map has been emptied and the citation guard below is now ` +
          `inspecting nothing while still reporting green.`,
      ).toBe(EXPECTED_EVIDENCE_STRING_COUNT);
    });

    it("every evidence string is free of `file.ext:NN` coordinates", () => {
      const offences: string[] = [];
      for (const { where, text } of allEvidenceStrings()) {
        for (const c of citationsIn(text)) {
          offences.push(`${where} cites \`${c.target}:${c.lines}\``);
        }
      }
      expect(
        offences,
        `a coordinate citation in evidence prose rots silently — anchor the ` +
          `symbol, not the address. ${offences.join("; ")}. ${CONVERSION_PROTOCOL} ` +
          `Note that the sibling comment guard in seam-citations.invariant.test.ts ` +
          `CANNOT see these: it extracts comments, and this rot lives in string ` +
          `literals.`,
      ).toEqual([]);
    });

    // BOTH POLARITIES on evidence-shaped text. Without the +1 the guard could be
    // a needle that never matches; without the -1 it could ban the conversion
    // target it is supposed to reward.
    it("+1: the needle catches a planted coordinate in evidence-shaped text", () => {
      expect(citationsIn("planted foo.ts:12 rot")).toHaveLength(1);
    });

    it("-1: a SYMBOL-anchored evidence sentence produces no offence", () => {
      expect(
        citationsIn(
          "resolved by _resume_duplicate_job in process_key.py — no coordinate",
        ),
      ).toEqual([]);
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
