import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  OPS_ALERT_CAUSE_RE,
  OPS_ALERT_EVENTS,
  OPS_ALERT_SOURCES,
} from "@/lib/ops-alert-contract";

/**
 * Phase 164.6.8 plan 01: the ops-alert contract is defined once per language.
 * A source added on the Python side only makes the Next.js route answer 400 to
 * that source's emails, so the founder is silently NOT emailed for the very
 * outage the new source exists to report. This test reads the Python module as
 * text and fails when the two sides disagree.
 */

const PY = readFileSync(
  join(process.cwd(), "analytics-service/services/ops_alert.py"),
  "utf8",
);

function pySet(name: string): string[] {
  const m = PY.match(
    new RegExp(`^${name}\\b[^=\\n]*=\\s*frozenset\\(\\s*\\{([^}]*)\\}`, "m"),
  );
  if (!m) throw new Error(`could not find the ${name} literal in ops_alert.py`);
  const items = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  if (items.length === 0) throw new Error(`${name} parsed empty`);
  return items;
}

function pyString(name: string): string {
  const m = PY.match(new RegExp(`^${name}\\b[^=\\n]*=\\s*"([^"\\n]*)"`, "m"));
  if (!m) throw new Error(`could not find the ${name} string in ops_alert.py`);
  return m[1];
}

describe("ops-alert contract parity (Python vs TypeScript)", () => {
  it("OPS_ALERT_SOURCES is identical", () => {
    expect([...pySet("OPS_ALERT_SOURCES")].sort()).toEqual(
      [...OPS_ALERT_SOURCES].sort(),
    );
  });

  it("OPS_ALERT_EVENTS is identical", () => {
    expect([...pySet("OPS_ALERT_EVENTS")].sort()).toEqual(
      [...OPS_ALERT_EVENTS].sort(),
    );
  });

  it("OPS_ALERT_CAUSE_RE is the identical pattern string", () => {
    expect(pyString("OPS_ALERT_CAUSE_RE")).toBe(OPS_ALERT_CAUSE_RE);
  });

  it("the two sides have no duplicate entries hiding a drift", () => {
    expect(new Set(OPS_ALERT_SOURCES).size).toBe(OPS_ALERT_SOURCES.length);
    expect(new Set(pySet("OPS_ALERT_SOURCES")).size).toBe(
      pySet("OPS_ALERT_SOURCES").length,
    );
  });
});
