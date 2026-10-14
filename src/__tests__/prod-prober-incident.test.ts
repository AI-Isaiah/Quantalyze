/**
 * Phase 164.6.8 OUTAGEALERT, plan 03 (D-07): one prober issue per INCIDENT.
 *
 * WHY THESE TESTS EXIST. The prober's issue used to be one forever-open,
 * label-deduplicated issue (#773). Every outage after the first became a comment
 * on an issue nobody is emailed about. An incident now ends at the first clean
 * full run, which closes the issue, so the next defect opens a NEW issue and that
 * is the one GitHub event that emails a human. If the `close` branch is removed,
 * the issue never closes and the alert channel silently goes back to dead.
 *
 * Each decision-table row carries the reason it matters. The wiring test
 * (`prod-prober-wiring.test.ts`) owns the kind-independence gate [164.8.3-01].
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  decideIncidentAction,
  incidentTitle,
  openBody,
  parseLog,
  recoveredComment,
  stillFailingComment,
} from "../../scripts/prod-prober/incident.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WORKFLOW_TEXT = readFileSync(join(REPO_ROOT, ".github", "workflows", "prod-prober.yml"), "utf8");

const OPEN = { number: 773 };
const STEP_ANCHOR = "- name: Open, update or close the prod-prober incident issue";

/** The incident step, bounded at the next step header (or EOF when it is last). */
function incidentStep(text: string): string {
  const start = text.indexOf(STEP_ANCHOR);
  expect(start, "the incident step must exist under its renamed header").toBeGreaterThan(-1);
  const next = text.indexOf("\n      - name: ", start + STEP_ANCHOR.length);
  return next < 0 ? text.slice(start) : text.slice(start, next);
}

describe("[164.6.8-03] tracer: a clean scheduled run closes the open incident issue", () => {
  it("a clean full run with an incident issue open decides `close`", () => {
    // WHY: this is the only event that lets the NEXT defect open a fresh issue.
    expect(decideIncidentAction({ status: "0", armInput: "", mode: "", openIssue: OPEN })).toBe("close");
  });

  it("the workflow step imports the module and closes the issue as completed", () => {
    const step = incidentStep(WORKFLOW_TEXT);
    expect(step).toContain("scripts/prod-prober/incident.mjs");
    expect(step).toMatch(/await import\(/);
    expect(step).toContain("issues.update");
    expect(step).toContain('state: "closed"');
    expect(step).toContain('state_reason: "completed"');
  });
});

describe("[164.6.8-03] decision table", () => {
  it("clean + no open issue: none (a clean run that opened an issue would email a false alarm)", () => {
    expect(decideIncidentAction({ status: "0", armInput: "", mode: "", openIssue: null })).toBe("none");
  });

  it("defects + open issue: comment, never close (a still-failing incident stays open)", () => {
    expect(decideIncidentAction({ status: "1", armInput: "", mode: "", openIssue: OPEN })).toBe("comment");
  });

  it("defects + no open issue: open (a new incident is a new issue, which is what emails a human)", () => {
    expect(decideIncidentAction({ status: "1", armInput: "", mode: "", openIssue: null })).toBe("open");
    expect(decideIncidentAction({ status: "3", armInput: "", mode: "", openIssue: undefined })).toBe("open");
  });

  it("a narrowed --arm dispatch is `none` in every combination (it exits 2 by design and measured one arm)", () => {
    for (const status of ["0", "1", "2"]) {
      for (const openIssue of [null, OPEN]) {
        expect(
          decideIncidentAction({ status, armInput: "mt5", mode: "", openIssue }),
          `status=${status} open=${Boolean(openIssue)}: a narrowed run must never close, comment on or open an issue`,
        ).toBe("none");
      }
    }
  });

  it("a capture-manifest run is `none` in every combination (it runs no probe)", () => {
    for (const status of ["0", "1", ""]) {
      for (const openIssue of [null, OPEN]) {
        expect(decideIncidentAction({ status, armInput: "", mode: "capture-manifest", openIssue })).toBe("none");
      }
    }
  });

  it("an unpublished status is `none` (an unmeasured run is neither clean nor dirty)", () => {
    expect(decideIncidentAction({ status: "", armInput: "", mode: "", openIssue: OPEN })).toBe("none");
    expect(
      decideIncidentAction({ status: undefined as unknown as string, armInput: "", mode: "", openIssue: OPEN }),
    ).toBe("none");
  });

  it("the explicit probe mode behaves as a full run", () => {
    expect(decideIncidentAction({ status: "0", armInput: "", mode: "probe", openIssue: OPEN })).toBe("close");
  });

  it("a dirty run with an open issue never closes it, and a clean run never opens one (all full-run rows)", () => {
    for (const status of ["0", "1", "2", "3"]) {
      for (const openIssue of [null, OPEN]) {
        const action = decideIncidentAction({ status, armInput: "", mode: "", openIssue });
        if (status !== "0" && openIssue) expect(action).not.toBe("close");
        if (status === "0" && !openIssue) expect(action).not.toBe("open");
      }
    }
  });
});

describe("[164.6.8-03] text builders", () => {
  const log = ["arms: 4/4 executed", "ok pyapi06", "❌ 2 defect(s)", "- row one", "- row two", ""].join("\n");

  it("parseLog keeps the run's own table verbatim and reads the defect count", () => {
    const p = parseLog(log);
    expect(p.defectCount).toBe("2");
    expect(p.table).toBe("❌ 2 defect(s)\n- row one\n- row two");
    expect(p.detail).toBe(["```", "arms: 4/4 executed", "", p.table, "```"].join("\n"));
  });

  it("parseLog on an empty log says the prober died, with an unknown count", () => {
    const p = parseLog("");
    expect(p.defectCount).toBe("?");
    expect(p.table).toContain("died before it could report");
  });

  it("the title names the incident start", () => {
    expect(incidentTitle({ defectCount: "2", today: "2026-10-13" })).toBe(
      "prod-prober incident: 2 defect(s) since 2026-10-13",
    );
  });

  it("the open body and the still-failing comment carry the run link and the table", () => {
    const detail = parseLog(log).detail;
    const body = openBody({ detail, runUrl: "https://example.test/run/1", headSha: "abc", dedupLabel: "prod-prober" });
    expect(body).toContain(detail);
    expect(body).toContain("https://example.test/run/1");
    expect(body).toContain("closes this issue");
    const c = stillFailingComment({ today: "2026-10-13", headSha: "abc", detail, runUrl: "https://example.test/run/2" });
    expect(c).toContain("Still failing on 2026-10-13 (repo abc).");
    expect(c).toContain("https://example.test/run/2");
  });

  it("the recovered comment carries only date, sha and run url (public repo: no defect text)", () => {
    const c = recoveredComment({ today: "2026-10-14", headSha: "def", runUrl: "https://example.test/run/3" });
    expect(c).toContain("Recovered on 2026-10-14 (repo def)");
    expect(c).toContain("https://example.test/run/3");
    expect(c).not.toContain("❌");
    expect(c).not.toContain("```");
  });
});

describe("[164.6.8-03] workflow wiring", () => {
  it("the scheduled path still exits 0 whatever the probe found (D-07: Railway's wait-for-CI)", () => {
    // The POSTURE LINE: on a schedule the probe step exits 0 after warning.
    expect(WORKFLOW_TEXT).toMatch(/if \[ "\$\{GITHUB_EVENT_NAME:-\}" = "schedule" \]; then[\s\S]{0,400}?exit 0\n\s+fi\n\s+exit \$status/);
  });

  it("the step runs on clean AND dirty full runs, and inputs reach the script through env only (T-164.6.8-13)", () => {
    const step = incidentStep(WORKFLOW_TEXT);
    const ifLine = step.match(/^\s*if:(.*)$/m);
    expect(ifLine, "the step must carry an if:").not.toBeNull();
    expect(ifLine![1]).toContain("inputs.arm == ''");
    expect(ifLine![1]).not.toContain("status != '0'");
    const scriptAt = step.indexOf("script: |");
    // A miss must THROW: slice(-1) would be the last character and the not.toContain below would pass vacuously.
    if (scriptAt < 0) throw new Error('ANCHOR MISSING: "script: |" is not in the incident step');
    const script = step.slice(scriptAt);
    expect(script, "no ${{ }} may be interpolated into the script body").not.toContain("${{");
    for (const key of ["PROBE_STATUS", "ARM_INPUT", "MODE_INPUT"]) {
      expect(step).toMatch(new RegExp(`^\\s+${key}: \\$\\{\\{ .+ \\}\\}$`, "m"));
    }
  });
});
