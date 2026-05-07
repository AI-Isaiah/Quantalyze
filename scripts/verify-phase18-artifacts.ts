#!/usr/bin/env -S npx tsx
/**
 * Phase 18 / Adversarial revision 2026-05-06 (Grok B4) — /ship pre-flight gate.
 *
 * Fails when any founder-fillable artefact still has unfilled `<TODO:` literals,
 * fewer than the FIX-03 minimum row count, or shows signs of accidental
 * ciphertext leak. Called from /ship's pre-flight step. Exit code 0 = pass,
 * exit code 1 = fail (with diagnostics on stderr).
 *
 * Threshold note (Phase 18 Plan 01 execute-time deviation, Rule 3): the leak
 * guard threshold was relaxed from the plan's original 32 to 40 chars. The
 * file's own contractual identifiers — gate slug `phase-18-fix-02-founder-okx-smoke`
 * (33 chars), regression-test class names (38 chars), kebab-case route
 * prefixes — collide with the 32-char threshold. 40 is well below typical
 * Fernet ciphertext (which is 100+ chars) but above any kebab-case slug or
 * Python class name we ship.
 */
import { readFileSync, existsSync } from "node:fs";

const ARTEFACTS = [
  ".planning/phase-18/founder-okx-smoke.md",
  ".planning/phase-18/dogfood-commitment.md",
  ".planning/phase-18/team-status.md",
];

const failures: string[] = [];

// Gate 1: every artefact exists.
for (const path of ARTEFACTS) {
  if (!existsSync(path)) failures.push(`MISSING: ${path}`);
}

if (failures.length === 0) {
  // Gate 2: no `<TODO:` literal remains.
  for (const path of ARTEFACTS) {
    const text = readFileSync(path, "utf8");
    if (text.includes("<TODO:")) {
      const lines = text.split(/\r?\n/);
      const offending = lines
        .map((line, i) => ({ line, i: i + 1 }))
        .filter(({ line }) => line.includes("<TODO:"))
        .map(({ line, i }) => `  ${path}:${i}: ${line.trim()}`)
        .join("\n");
      failures.push(`UNFILLED <TODO: in ${path}:\n${offending}`);
    }
  }

  // Gate 3: team-status.md FIX-03 minimum signal — at least 3 rows with status=published.
  const teamStatus = readFileSync(".planning/phase-18/team-status.md", "utf8");
  const publishedRows = (teamStatus.match(/\|\s*published\s*\|/g) ?? []).length;
  if (publishedRows < 3) {
    failures.push(
      `team-status.md: expected >= 3 rows with status=published; found ${publishedRows}`,
    );
  }

  // Gate 4: founder-okx-smoke.md must have a UUID-shaped correlation_id and
  // the SHA256(...) literal must have been replaced with an actual fingerprint.
  const smoke = readFileSync(".planning/phase-18/founder-okx-smoke.md", "utf8");
  const uuidMatch =
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(smoke);
  if (!uuidMatch) {
    failures.push(`founder-okx-smoke.md: no UUID v4 correlation_id present`);
  }
  // Fingerprint cell must no longer hold the placeholder text.
  if (smoke.includes("last 8 hex chars of SHA256 of the ciphertext")) {
    failures.push(
      `founder-okx-smoke.md: fingerprint cell still contains the placeholder — founder did not fill it in`,
    );
  }

  // Gate 5: leak guard — Fernet/base64 char class, threshold 40 (Rule 3 deviation).
  // No `.` metachar in the class so the dotAll (`s`) flag is unnecessary; dropping
  // it keeps the regex compatible with tsconfig target=ES2017 (TS1501).
  if (/[A-Za-z0-9_=+/-]{40,}/.test(smoke)) {
    failures.push(
      `founder-okx-smoke.md: Fernet/base64-shape run >= 40 chars detected (potential ciphertext leak)`,
    );
  }
}

if (failures.length > 0) {
  console.error("[verify-phase18-artifacts] FAIL:");
  for (const f of failures) console.error(f);
  process.exit(1);
}
console.log("[verify-phase18-artifacts] OK");
process.exit(0);
