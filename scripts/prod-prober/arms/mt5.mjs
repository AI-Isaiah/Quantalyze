/**
 * prod-prober arm: MT5-WEDGE-OBS-01 — a real MT5 round-trip (phase 164.1 plan 04).
 *
 * ============================================================================
 * ⛔ READ-ONLY, AND DELIBERATELY SO — carried VERBATIM from `scripts/mt5-diag.sh:9-18`
 * ============================================================================
 *
 *   ⛔ READ-ONLY, and deliberately so: it calls initialize() + terminal_info() and
 *   NEVER login(). A login() is an "account change"; while
 *   `[Experts] Account=1` is armed, MT5 re-clears `Enabled` on every account
 *   change, so a probe that logged in would itself re-break the thing it is
 *   measuring. That is not hypothetical — it happened during the 2026-08-13
 *   investigation, where each diagnostic round re-disabled algo trading.
 *
 *   ⚠️ Do NOT "improve" this by reading Config/terminal.ini instead. MT5 only
 *   rewrites that file on a clean exit, so it can report `Enabled=0` while the
 *   running terminal is already correct. The live terminal_info() is the oracle.
 *
 * Those two paragraphs are the WHOLE reason this arm executes a COMMITTED
 * constant rather than anything assembled at run time (D-16, threat T-164.1-17).
 * `MT5_PROBE_PY` below is asserted by the self-test to contain no such call and
 * no interpolation marker, so the rule is machine-checked rather than trusted.
 *
 * ============================================================================
 * WHY THE PROBE RUNS *INSIDE* THE CONTAINER
 * ============================================================================
 * `deploy/mt5-gateway/railway-gateway.md:10-14` — HARD CONSTRAINT, PRIVATE
 * NETWORK ONLY: the RPyC bridge (`:8001`) is an UNAUTHENTICATED
 * ARBITRARY-REMOTE-CODE channel and must be reachable ONLY at
 * `gateway.railway.internal:8001` over Railway's internal mesh. NEVER attach a
 * public domain, NEVER expose `:8001` publicly, no exceptions. So the prober
 * cannot dial the bridge from a GitHub runner; it executes one command INSIDE
 * the container over `railway ssh` and reads the single line that comes back.
 *
 * ============================================================================
 * WHAT THIS ARM EXISTS FOR — AND WHY -10004 AND -10005 MUST NOT COLLAPSE
 * ============================================================================
 * The terminal wedged into a `-10005` IPC timeout THREE TIMES IN ONE DAY while
 * its Railway container was healthy, its `/health` was green and its log had no
 * ERROR line. The cause was a MODAL LOGIN DIALOG blocking the IPC bridge, and
 * that dialog SURVIVES A REDEPLOY because the Wine prefix lives on the
 * persistent volume. Meanwhile `-10004` — the bridge not attached at all — IS
 * fixed by a redeploy.
 *
 * The two codes therefore have OPPOSITE remedies. Reporting them as one failure
 * is not a shortcut; it is a wrong instruction to the operator, and it is the
 * exact confusion that produced "We could not find that broker server." for a
 * byte-for-byte correct server string (`analytics-service/services/
 * mt5_validation.py:71-83`). `REMEDIES` below keeps them apart, and the
 * self-test asserts the two strings differ.
 *
 * ⚠️ FOUR STATES AROUND THEM, kept distinct on purpose:
 *   - `mt5-probe-timeout`  — the PROBER's own 120 s transport budget elapsed.
 *                            This is OUR instrument, NOT the terminal's -10005.
 *   - `mt5-ssh-transport`  — no `PROBE ` line came back at all (any ssh status),
 *                            or the line was unparsable.
 *   - `mt5-terminal-error` — the terminal answered with a non-IPC failure code,
 *                            or initialize succeeded and terminal_info() did not.
 *   - `measure-fail`       — the CLI was absent or could not be spawned.
 *
 * ⚠️ `connected` and `trade_allowed` are printed and NEVER JUDGED. A
 * logged-out terminal is harmless to this measurement (and `trade_allowed` is
 * the separate MT5GW-COPY-01 concern, whose own diagnostic is mt5-diag.sh); a
 * modal dialog is what is fatal, and that shows up as -10005.
 *
 * ⚠️ CONCURRENCY: the probe takes no lease and issues only reads, so a probe
 * overlapping a real validate call shares the terminal's IPC bridge and may
 * read -10005 while the terminal is legitimately busy. The remedy text names
 * that as a possible transient and the hourly cadence disambiguates on the next
 * tick — a SECOND consecutive hit is the confirmation.
 */

/**
 * The rpyc bridge coordinates, INSIDE the container. Exported for the
 * self-test, which asserts the constant below carries them as LITERALS — the
 * constant is not built from these, they are a restatement of what it contains,
 * and the self-test proving the two agree is what keeps the restatement honest.
 */
export const RPYC_HOST = "127.0.0.1";
export const RPYC_PORT = 8001;

/**
 * The PROBER's own transport budget. Exceeding it is `mt5-probe-timeout` — a
 * statement about this instrument, never about the terminal.
 */
export const SSH_TIMEOUT_MS = 120000;

/**
 * ⛔ THE COMMITTED PROBE BODY. A CONSTANT, base64-encoded at run time and
 * executed inside the gateway container.
 *
 * NOTHING is interpolated into it — not the host, not the port, not any
 * environment value. That is threat T-164.1-16's whole mitigation: the only
 * variables that reach the Railway CLI at all are the `-p` / `-e` / `-s` flags,
 * which the CLI consumes itself and never passes to the container. The
 * self-test asserts this string contains no `${` marker AND decodes the argv
 * the arm actually built to prove what was sent equals what is committed here.
 *
 * It is `scripts/mt5-diag.sh:30-41` ported unchanged IN WHAT IT CALLS:
 * `initialize()`, `last_error()`, `terminal_info()`. Nothing else.
 *
 * ⚠️ ONE DELIBERATE DIFFERENCE from mt5-diag.sh's output shape: `terminal_info`
 * is emitted in BOTH branches ("present" / null) rather than only when null. In
 * mt5-diag.sh the healthy reading is the ABSENCE of a key, which would make the
 * classifier's OK test satisfiable by a truncated or malformed line. A positive
 * marker cannot be produced by something going missing.
 */
export const MT5_PROBE_PY = [
  "import json",
  "from mt5linux import MetaTrader5",
  'mt5 = MetaTrader5(host="127.0.0.1", port=8001)',
  'out = {"initialize": bool(mt5.initialize()), "last_error": mt5.last_error()}',
  "ti = mt5.terminal_info()",
  "if ti is None:",
  '    out["terminal_info"] = None',
  "else:",
  '    out["terminal_info"] = "present"',
  "    d = ti._asdict()",
  '    for k in ("trade_allowed", "tradeapi_disabled", "connected", "build", "path"):',
  "        out[k] = d.get(k)",
  'print("PROBE " + json.dumps(out))',
].join("\n");

/**
 * ⛔ ONE REMEDY PER KIND, AND THE TWO IPC REMEDIES SAY OPPOSITE THINGS.
 *
 * `mt5-no-ipc` says redeploy. `mt5-ipc-timeout` says a redeploy will NOT help
 * and names the VNC console. If these two ever converge on one string, the arm
 * has stopped doing the one thing it was built for — the self-test asserts they
 * differ, that each carries its distinguishing word, and that no two remedies
 * in this table are the same string.
 */
export const REMEDIES = {
  "mt5-no-ipc":
    "The rpyc bridge is NOT ATTACHED (-10004): the gateway is down or mid-redeploy, so the terminal was never reached. Run `railway redeploy` on the mt5-gateway service, wait for the container to report healthy, then re-run this prober. This is the code a redeploy DOES fix.",
  "mt5-ipc-timeout":
    "The bridge IS ATTACHED but the terminal is NOT ANSWERING (-10005). Open the gateway's VNC console and clear the MODAL LOGIN DIALOG by completing any login — ⛔ a redeploy does NOT fix this, because the Wine prefix and the dialog live on the persistent volume and come straight back. A transient reading is possible while a real validate call holds the terminal's IPC bridge, so a SECOND consecutive hourly hit is the confirmation.",
  "mt5-ssh-transport":
    "railway ssh did not return a PROBE line, so the terminal was never reached and nothing about it was measured. Check, in order: the RAILWAY_API_TOKEN's scope (it must be the WORKSPACE/account slot — the CLI's project-slot token is refused by `railway ssh`), then the project / environment / service variables, then the gateway container's own state in Railway.",
  "mt5-probe-timeout":
    "The PROBER's own 120 s transport budget elapsed before railway ssh returned — this is our instrument's timeout, NOT the terminal's -10005 IPC timeout, and it says nothing about the terminal. Check the Railway relay and the gateway container, then re-run.",
  "mt5-terminal-error":
    "The terminal answered with a NON-IPC failure code, so the bridge is fine and the fault is inside MT5 itself. Read the reported code against the MT5 error table and the gateway container log for the same minute; neither IPC remedy applies here.",
};

// ---------------------------------------------------------------------------
// Classification (PURE — the whole reason fixtures can drive it)
// ---------------------------------------------------------------------------

/**
 * Classify one `railway ssh` result into at most one defect.
 *
 * ⛔ THE ORDER OF THESE BRANCHES IS THE ARM. Every one of them is reachable
 * from a committed fixture or a self-test seam override, and no two can fire on
 * the same input.
 *
 * @param {{status: number|null, stdout: string, stderr: string, timedOut: boolean, measureFail: string|null}} result
 * @returns {{kind: string|null, subject: string|null, detail: string|null, info: string|null}}
 */
export function classifyProbe(result) {
  const none = { kind: null, subject: null, detail: null, info: null };
  const r = result || {};

  // (1) OUR budget, not the terminal's. Kept ahead of everything because a
  //     timed-out spawn has no stdout to classify and must never be read as a
  //     statement about MT5.
  if (r.measureFail && r.timedOut === true) {
    return {
      kind: "mt5-probe-timeout",
      subject: "railway ssh",
      detail:
        `${r.measureFail}. This is the PROBER's own transport budget (${SSH_TIMEOUT_MS} ms), NOT the ` +
        "terminal's -10005 IPC timeout: no PROBE line was ever received, so nothing was measured about MT5.",
      info: null,
    };
  }

  // (2) The CLI was absent or unspawnable — the instrument, not production.
  if (r.measureFail) {
    return {
      kind: "measure-fail",
      subject: "railway ssh",
      detail: `${r.measureFail}. The probe never ran, so nothing this arm did or did not report is evidence.`,
      info: null,
    };
  }

  // (3) The PROBE line. Found by SCANNING, never by assuming line 1 — the CLI
  //     prints its own connection banner first, and `mt5-diag.sh` greps for the
  //     same reason.
  const line = String(r.stdout || "")
    .split("\n")
    .find((l) => l.startsWith("PROBE "));
  const exitPart = `railway ssh exit ${r.status === null || r.status === undefined ? "unknown" : r.status}`;
  const stderrPart = `stderr: ${String(r.stderr || "").split("\n")[0].trim() || "<empty>"}`;

  if (line === undefined) {
    return {
      kind: "mt5-ssh-transport",
      subject: "railway ssh",
      // ⚠️ The exit status is REPORTED, never used as the verdict. An exit 0
      // with no PROBE line is exactly as much of a failure as an exit 255 —
      // the difference mt5-diag.sh's `| grep` pipeline throws away.
      detail: `${exitPart}, no PROBE line; ${stderrPart}`,
      info: null,
    };
  }

  let probe;
  try {
    probe = JSON.parse(line.slice("PROBE ".length));
  } catch (err) {
    return {
      kind: "mt5-ssh-transport",
      subject: "railway ssh",
      detail: `${exitPart}, a PROBE line came back but its JSON is unparsable (${err.message}); ${stderrPart}`,
      info: null,
    };
  }
  if (probe === null || typeof probe !== "object") {
    return {
      kind: "mt5-ssh-transport",
      subject: "railway ssh",
      detail: `${exitPart}, the PROBE line parsed to a ${probe === null ? "null" : typeof probe}, not an object; ${stderrPart}`,
      info: null,
    };
  }

  const code = Array.isArray(probe.last_error) ? probe.last_error[0] : null;
  const terminalInfoPresent = probe.terminal_info !== null && probe.terminal_info !== undefined;

  // (4) OK — and it needs BOTH halves. `initialize()` returning true while
  //     `terminal_info()` returns null is a real state (branch 7), not a pass.
  if (probe.initialize === true && terminalInfoPresent) {
    return {
      ...none,
      info:
        `initialize=true last_error=${code === null ? "none" : code} ` +
        `connected=${String(probe.connected)} trade_allowed=${String(probe.trade_allowed)} ` +
        `build=${String(probe.build)}`,
    };
  }

  // (5) The bridge is not attached. A redeploy fixes this one.
  if (code === -10004) {
    return {
      kind: "mt5-no-ipc",
      subject: "-10004",
      detail:
        "MT5 initialize() failed with -10004 (No IPC connection): the rpyc bridge is not attached at all, " +
        "so the terminal was never reached. This is the code a redeploy fixes — it is NOT the modal-dialog state.",
      info: null,
    };
  }

  // (6) The bridge IS attached and the terminal is not answering. A redeploy
  //     does NOT fix this one, which is why it is a separate kind.
  if (code === -10005) {
    return {
      kind: "mt5-ipc-timeout",
      subject: "-10005",
      detail:
        "MT5 initialize() failed with -10005 (IPC timeout): the rpyc bridge IS attached but the terminal " +
        "stopped answering — the modal-login-dialog wedge, observed three times in one day behind a healthy " +
        "container, a green /health and a quiet log. NOT the same state as -10004 and NOT fixed by a redeploy.",
      info: null,
    };
  }

  // (7) initialize() succeeded, terminal_info() did not. The bridge answered,
  //     so neither IPC remedy applies.
  if (probe.initialize === true) {
    return {
      kind: "mt5-terminal-error",
      subject: "terminal_info",
      detail:
        `initialize ok but terminal_info() returned null (last_error ${code === null ? "none" : code}). ` +
        "The bridge answered, so this is the terminal itself, not the IPC transport.",
      info: null,
    };
  }

  // (8) initialize() failed with something that is not an IPC code.
  return {
    kind: "mt5-terminal-error",
    subject: code === null ? "no code" : String(code),
    detail:
      `MT5 initialize() failed with ${code === null ? "no last_error code" : `code ${code}`}, which is ` +
      "neither -10004 nor -10005 — the IPC transport is not implicated, so neither IPC remedy applies.",
    info: null,
  };
}

// ---------------------------------------------------------------------------
// The arm
// ---------------------------------------------------------------------------

/**
 * Build the argv handed to the Railway CLI.
 *
 * Exported so the self-test can decode the `-c` payload and prove it is
 * byte-identical to `MT5_PROBE_PY` — the strongest available statement of
 * "no run-time interpolation reached the container" (T-164.1-16).
 *
 * ⚠️ The `-c` string is assembled by CONCATENATION rather than a template
 * literal, so the one place a `${` could appear in this file's source is the
 * one place the self-test's own no-interpolation grep would not be looking.
 *
 * @param {Record<string,string|undefined>} env
 */
export function buildProbeArgv(env) {
  const b64 = Buffer.from(MT5_PROBE_PY, "utf8").toString("base64");
  return [
    "ssh",
    "-p",
    env.RAILWAY_PROJECT_ID,
    "-e",
    env.RAILWAY_ENVIRONMENT,
    "-s",
    env.RAILWAY_MT5_SERVICE,
    "--",
    // ⛔ ONE word after `--`, not three. Railway CLI 4.36.1 JOINS the trailing
    // words with spaces and hands the result to `sh -c` in the container, so
    // `python3 -c import base64;exec(...)` reaches the shell UNQUOTED and dies
    // on the `(` before Python ever starts. MEASURED 2026-09-06:
    //   sh -c "python3 -c import base64;exec(base64.b64decode('<b64>'))"
    //   -> sh: -c: line 0: syntax error near unexpected token `base64.b64decode'
    // The only `railway ssh` this repo has ever seen succeed
    // (scripts/mt5-diag.sh:44-45) passes the whole command as ONE argument;
    // this now matches it. b64 is [A-Za-z0-9+/=] only, so it cannot break out
    // of either quote layer. Still assembled by CONCATENATION, never a template
    // literal, so the no-interpolation grep keeps working.
    "python3 -c \"import base64;exec(base64.b64decode('" + b64 + "'))\"",
  ];
}

async function run({ env, seams, log, addDefect }) {
  const result = await seams.ssh("mt5", buildProbeArgv(env), { timeoutMs: SSH_TIMEOUT_MS });
  const verdict = classifyProbe(result);

  if (verdict.kind === null) {
    // Informational ONLY. `connected` and `trade_allowed` are printed here and
    // judged NOWHERE — see the header.
    log(`mt5: ${verdict.info}`);
    return;
  }

  // `measure-fail` is harness-wide and has no arm remedy; every mt5 kind has one.
  addDefect(verdict.kind, "mt5", verdict.subject, verdict.detail, REMEDIES[verdict.kind] || null);
}

export const ARM = {
  name: "mt5",
  // ⚠️ The token is the WORKSPACE/account slot. The CLI's other, shorter
  // credential variable is the PROJECT slot, which `railway ssh` refuses; its
  // name appears nowhere under scripts/prod-prober/ and an acceptance grep pins
  // that absence. See `realSshRunner` in ../seams.mjs.
  requiredEnv: ["RAILWAY_API_TOKEN", "RAILWAY_PROJECT_ID", "RAILWAY_MT5_SERVICE", "RAILWAY_ENVIRONMENT"],
  run,
  REMEDIES,
};
