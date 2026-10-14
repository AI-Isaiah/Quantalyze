/**
 * prod-prober incident decisions (phase 164.6.8 OUTAGEALERT, plan 03, D-07).
 *
 * One GitHub issue per INCIDENT. An incident starts at the first full prober run
 * with defects and ends at the first full run with none, which closes its issue.
 * The next defect therefore opens a NEW issue, and a new issue is the one GitHub
 * event that emails a human. The old shape (one forever-open, label-deduplicated
 * issue, #773) turned every outage after the first into a comment nobody is told
 * about.
 *
 * PURE: no I/O, no network, no clock. The workflow's `actions/github-script` step
 * owns every API call and hands this module plain strings.
 *
 * KIND-INDEPENDENT ON PURPOSE. Nothing here reads a defect kind. Incident
 * boundaries come from the run's clean/dirty status alone, and the open issue is
 * selected by a constant label in the workflow. A kind-keyed boundary could hide a
 * new kind behind an old kind's open issue, which is what the wiring test gate
 * `[164.8.3-01]` forbids and now scans this file for too.
 */

/**
 * What the workflow step does for one run.
 *
 * @param {object} input
 * @param {string} input.status    the probe step's published exit status ("0" clean)
 * @param {string} input.armInput  the dispatch `arm` input; "" on a schedule and a full dispatch
 * @param {string} input.mode      the dispatch `mode` input; "" on a schedule
 * @param {{number:number}|null|undefined} input.openIssue the open incident issue, if any
 * @returns {"open"|"comment"|"close"|"none"}
 */
export function decideIncidentAction({ status, armInput, mode, openIssue }) {
  // A narrowed `--arm` dispatch exits 2 BY DESIGN even when it finds nothing, and
  // it measured one arm only: it must never close a real incident, and must never
  // open one that reads "0 defect(s)".
  if (typeof armInput === "string" && armInput !== "") return "none";
  // A capture-manifest run runs no probe at all.
  if (mode === "capture-manifest") return "none";
  // No published status means the probe never reported (skipped, or died before
  // the status line). An unmeasured run is not a clean reading and not a defect.
  if (typeof status !== "string" || status === "") return "none";

  const clean = status === "0";
  const open = Boolean(openIssue);
  if (clean) return open ? "close" : "none"; // a clean run never opens an issue
  return open ? "comment" : "open"; // a dirty run never closes one
}

/**
 * Split the prober's own log into the parts an issue carries. The table is the
 * run's text from its first defect line onward, VERBATIM: a summary written here
 * would be a second account able to disagree with the log.
 *
 * @param {string} log
 */
export function parseLog(log) {
  const lines = String(log ?? "").split("\n");
  const tableAt = lines.findIndex((l) => l.startsWith("❌"));
  const table =
    tableAt >= 0
      ? lines.slice(tableAt).join("\n").replace(/\s+$/, "")
      : "(the prober produced no defect table - it died before it could report. Read the run log.)";
  const armsLine = lines.find((l) => l.startsWith("arms: ")) || "(no arms: line - the run did not reach its report)";
  const countMatch = table.match(/^❌ (\d+) defect/);
  const defectCount = countMatch ? countMatch[1] : "?";
  const detail = ["```", armsLine, "", table, "```"].join("\n");
  return { armsLine, table, defectCount, detail };
}

/** The title names the incident START; the issue keeps it for the incident's life. */
export function incidentTitle({ defectCount, today }) {
  return `prod-prober incident: ${defectCount} defect(s) since ${today}`;
}

/** Body of the issue a dirty run opens when no incident issue is open. */
export function openBody({ detail, runUrl, headSha, dedupLabel }) {
  return [
    "The hourly production prober reported at least one defect. Each row below carries its own remedy, copied from the run log verbatim.",
    "",
    detail,
    "",
    `Workflow run: ${runUrl}`,
    `Repository SHA at dispatch: \`${headSha}\``,
    "",
    "Auto-filed by .github/workflows/prod-prober.yml (phase 164.1, incident-scoped since phase 164.6.8). One issue per incident, found by the `" +
      dedupLabel +
      "` label: later failing runs comment here, and the first clean full run comments and closes this issue. The next defect then opens a new issue.",
  ].join("\n");
}

/** Comment a dirty run adds while the incident issue is still open. */
export function stillFailingComment({ today, headSha, detail, runUrl }) {
  return [`Still failing on ${today} (repo ${headSha}).`, "", detail, "", `Workflow run: ${runUrl}`].join("\n");
}

/** Comment the first clean full run adds before it closes the incident issue. */
export function recoveredComment({ today, headSha, runUrl }) {
  return [
    `Recovered on ${today} (repo ${headSha}): a full prober run reported no defects, so this incident is over and the issue is closed.`,
    "",
    `Workflow run: ${runUrl}`,
    "",
    "A later defect opens a new issue.",
  ].join("\n");
}
