#!/usr/bin/env node
/**
 * scripts/check-banned-packages.mjs
 *
 * Fails CI if any banned package (see the `BANNED` const below — the
 * in-repo, CI-checkable source of truth) appears in package.json (direct
 * dependency or `npm:` alias) OR in ANY lockfile in the repo (transitive):
 * package-lock.json (npm), pnpm-lock.yaml (pnpm), or yarn.lock (yarn).
 * Supply-chain attacks typically land through the lockfile's transitive graph,
 * so we block every install path — H-1018: scanning only package-lock.json
 * would silently disable the gate the moment a refactor introduces a pnpm/yarn
 * lockfile.
 *
 * The gate FAILS CLOSED. It exits non-zero when it cannot actually scan —
 * an unrecognized package-lock.json shape, or no lockfile present at all
 * (override the latter with ALLOW_NO_LOCKFILE=1) — rather than passing green
 * while blind. A security gate that can't see must block, not warn-and-pass.
 *
 * It also matches a banned package installed under an `npm:` ALIAS
 * (`innocent@npm:axios@1.14.1`), which keys the manifest/lockfile on the alias
 * name while resolving to the banned package — a well-known evasion the gate's
 * whole purpose is to stop.
 *
 * Source of truth: the `BANNED` array IS the authority and is exported so the
 * regression test imports the same list (no hand-duplication). The "Banned
 * Packages" table in ~/.claude/CLAUDE.md is a USER-PRIVATE, human-readable
 * MIRROR — it is not in the repo and CI cannot read it, so it can drift; when
 * a new compromise is documented there it MUST also be added here. (Older
 * docs claimed this file is "kept in sync with" CLAUDE.md, which was a lie:
 * there is no automatic sync — this array is the real, CI-enforced gate.)
 *
 * Pure Node, zero runtime dependencies. Run from the repo root:
 *
 *   node scripts/check-banned-packages.mjs
 *
 * Exit 0 = clean. Exit 1 = at least one banned package detected, or the scan
 * could not run (fail-closed).
 */
import { readFileSync, existsSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

// THE in-repo source of truth for banned packages (exported for the
// regression test). Every entry must include a safe alternative — contributors
// need to know what to use instead, not just that their PR failed.
//
// `name` matches ANY version by design: a banned package is one this project
// must never ship at all (the listed alternative replaces it), so we do not
// narrow to the specific compromised version — a pre-compromise version of a
// compromised package is still a package we have a safe alternative for, and a
// "downgrade to dodge the gate" is exactly the move we want to block.
export const BANNED = [
  {
    name: "axios",
    reason:
      "Maintainer account compromised; versions 1.14.1 and 0.30.4 install a cross-platform RAT.",
    alternative: "Use native fetch() or undici.",
  },
  {
    name: "react-native-international-phone-number",
    reason: "Malicious release injects remote payload on npm install.",
    alternative: "Use react-native-phone-input.",
  },
  {
    name: "react-native-country-select",
    reason: "Same attacker as react-native-international-phone-number; payload injection on install.",
    alternative: "Use react-native-country-picker-modal.",
  },
  {
    name: "@openclaw-ai/openclawai",
    reason: "Typosquat; steals credentials, crypto wallets, SSH keys, installs RAT.",
    alternative: "N/A — do not install; verify the package name you intended.",
  },
];

/** @typedef {{ name: string, version: string, source: string, reason: string, alternative: string }} Hit */

/** @param {{name: string, version: string, source: string}} partial @returns {Hit} */
function hitFor(partial) {
  const meta = BANNED.find((b) => b.name === partial.name);
  return {
    ...partial,
    reason: meta?.reason ?? "Unknown reason",
    alternative: meta?.alternative ?? "No alternative listed.",
  };
}

/**
 * A synthetic blocking "hit" used to FAIL CLOSED when the scanner cannot
 * actually scan the lockfile (unparseable, or an unrecognized shape). It is
 * NOT a real banned package — it forces a non-zero exit so a blind gate never
 * passes green, with the same explicit diagnostic the rest of the file uses.
 * @param {string} name @param {string} reason @returns {Hit}
 */
function blindHit(name, reason) {
  return {
    name,
    version: "unknown",
    source: "package-lock.json",
    reason,
    alternative:
      "Update scripts/check-banned-packages.mjs to support this lockfile before merging.",
  };
}

/** Escape a string for safe literal interpolation into a RegExp. */
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * If a dependency spec/version is an `npm:` alias (`npm:<name>[@<range>]`),
 * return the aliased REAL package name; else null. npm aliasing
 * (`innocent@npm:axios@1.14.1`) installs the banned package under a DIFFERENT
 * key, so the spec value — not just the dependency key — must be inspected, or
 * the alias silently defeats the gate. Handles scoped targets (`npm:@scope/pkg@1`).
 * @param {unknown} spec @returns {string | null}
 */
function aliasTarget(spec) {
  if (typeof spec !== "string") return null;
  const m = /^npm:((?:@[^/@\s]+\/)?[^@\s]+?)(?:@|$)/.exec(spec);
  return m ? m[1] : null;
}

/**
 * @typedef {{ version?: unknown, name?: unknown, dependencies?: unknown }} LockfileEntry
 * The npm lockfile entry shape we read from. Modelled loosely on purpose:
 * we consume `version` (a string), `name` (present for v2/v3 alias entries),
 * and `dependencies` (a nested tree) for the v1 walker. Everything is `unknown`
 * so a future npm reshuffle surfaces as the literal "unknown" rather than
 * crashing or silently coercing.
 */

/** Read a lockfile entry's version without trusting its shape (M-0992 —
 * replaces a `@ts-expect-error` over a raw `any` access).
 * @param {unknown} entry @returns {string} */
function entryVersion(entry) {
  if (entry && typeof entry === "object" && "version" in entry) {
    const v = /** @type {{ version?: unknown }} */ (entry).version;
    if (typeof v === "string" && v.length > 0) return v;
  }
  return "unknown";
}

/**
 * The set of real package names an npm-lockfile entry could resolve to: the
 * path/tree KEY, the entry's explicit `name` (npm writes this for v2/v3 alias
 * entries), and the alias target parsed out of its `version` (v1 lockfiles
 * encode an alias as `version: "npm:<name>@<range>"`). Matching on ALL of them
 * closes the `npm:<banned>` alias bypass, where the key is an innocuous alias
 * but the resolved package is banned.
 * @param {string} keyName @param {unknown} entry @returns {string[]}
 */
function entryNames(keyName, entry) {
  const names = [keyName];
  if (entry && typeof entry === "object") {
    const n = /** @type {{ name?: unknown }} */ (entry).name;
    if (typeof n === "string" && n.length > 0) names.push(n);
    const alias = aliasTarget(entryVersion(entry));
    if (alias) names.push(alias);
  }
  return names;
}

/**
 * Check package.json for any direct dependency (dependencies,
 * devDependencies, peerDependencies, optionalDependencies) that matches a
 * banned package name — either as the dependency KEY, or as an `npm:<banned>@`
 * ALIAS value that installs the banned package under a different key.
 * @returns {Hit[]}
 */
function scanPackageJson() {
  const path = resolve(REPO_ROOT, "package.json");
  if (!existsSync(path)) return [];
  const pkg = JSON.parse(readFileSync(path, "utf8"));
  const sections = [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ];
  /** @type {Hit[]} */
  const hits = [];
  for (const section of sections) {
    const deps = pkg[section];
    if (!deps || typeof deps !== "object") continue;
    for (const [depName, depSpec] of Object.entries(deps)) {
      const alias = aliasTarget(depSpec);
      for (const banned of BANNED) {
        if (depName === banned.name) {
          hits.push(hitFor({
            name: banned.name,
            version: String(depSpec),
            source: `package.json:${section}`,
          }));
        } else if (alias === banned.name) {
          hits.push(hitFor({
            name: banned.name,
            version: String(depSpec),
            source: `package.json:${section} (alias of ${depName})`,
          }));
        }
      }
    }
  }
  return hits;
}

/**
 * Check package-lock.json for any banned package in the resolved tree,
 * catching transitive deps. Supports both lockfile v1 (dependencies tree) and
 * lockfile v2/v3 (packages map keyed by node_modules path). Matches on the
 * key, the entry's `name`, and any `npm:` alias target (entryNames), so an
 * aliased banned package keyed under an innocuous name is still caught. Scoped
 * banned names (e.g. `@openclaw-ai/openclawai`) are handled by both arms (the
 * v2/v3 key `node_modules/@scope/pkg` slices to the full `@scope/pkg`, and the
 * v1 `dependencies` tree keys scoped packages by their full `@scope/pkg` name).
 *
 * FAILS CLOSED: if the lockfile has neither a v2/v3 `packages` map nor a v1
 * `dependencies` tree, the scan is BLIND, so it emits a blocking hit (exit 1)
 * rather than passing green.
 * @returns {Hit[]}
 */
function scanLockfile() {
  const path = resolve(REPO_ROOT, "package-lock.json");
  if (!existsSync(path)) return [];
  /** @type {{ packages?: Record<string, unknown>, dependencies?: Record<string, unknown> }} */
  let lock;
  try {
    lock = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    // Fail CLOSED with the same explicit diagnostic as the other blind paths,
    // not an uncaught SyntaxError stack trace. A corrupt lockfile means the
    // transitive scan cannot run — block, don't crash-and-hope (Rule 12).
    const msg = e instanceof Error ? e.message : String(e);
    console.error(
      `check-banned-packages: package-lock.json could not be parsed (${msg}); ` +
        "the lockfile scan is BLIND. FAILING CLOSED.",
    );
    return [
      blindHit(
        "<unparseable-lockfile>",
        `package-lock.json could not be parsed (${msg}); the transitive banned-package scan could not run.`,
      ),
    ];
  }
  const hasV2 = lock.packages && typeof lock.packages === "object";
  const hasV1 = lock.dependencies && typeof lock.dependencies === "object";

  /** @type {Hit[]} */
  const hits = [];
  const seen = new Set();

  /** @param {Hit} hit */
  function push(hit) {
    const k = `${hit.name}@${hit.version}@${hit.source}`;
    if (seen.has(k)) return;
    seen.add(k);
    hits.push(hit);
  }

  // Fail CLOSED on an unrecognized lockfile shape (M-0992): neither a v2/v3
  // `packages` map nor a v1 `dependencies` tree means npm changed the format
  // and this scanner is silently blind. Block instead of passing green
  // (CLAUDE.md Rule 12 — fail loud).
  if (!hasV2 && !hasV1) {
    console.error(
      "check-banned-packages: package-lock.json has neither a `packages` map " +
        "(v2/v3) nor a `dependencies` tree (v1); the lockfile scan is BLIND to " +
        "its shape. FAILING CLOSED — update this scanner for the new format.",
    );
    push(
      blindHit(
        "<unscannable-lockfile>",
        "Unrecognized package-lock.json shape — neither a v2/v3 `packages` map " +
          "nor a v1 `dependencies` tree. The transitive banned-package scan could not run.",
      ),
    );
    return hits;
  }

  // Lockfile v2/v3: packages map. Keys are paths like "node_modules/axios"
  // or "node_modules/foo/node_modules/axios" (transitive).
  if (lock.packages && typeof lock.packages === "object") {
    for (const [key, entry] of Object.entries(lock.packages)) {
      if (!key || !entry || typeof entry !== "object") continue;
      const marker = "node_modules/";
      const idx = key.lastIndexOf(marker);
      if (idx < 0) continue;
      const name = key.slice(idx + marker.length);
      const candidates = entryNames(name, entry);
      for (const banned of BANNED) {
        if (candidates.includes(banned.name)) {
          push(hitFor({
            name: banned.name,
            version: entryVersion(entry),
            source: `package-lock.json:${key}`,
          }));
        }
      }
    }
  }

  // Lockfile v1: dependencies tree. Walk recursively. npm v1 keys a scoped
  // package by its FULL `@scope/name` (not a nested scope object), so the key
  // check matches scoped banned names directly; an aliased dep encodes the real
  // name in `version: "npm:<name>@<range>"`, caught via entryNames.
  if (lock.dependencies && typeof lock.dependencies === "object") {
    /** @param {Record<string, unknown>} tree @param {string} parentPath */
    function walk(tree, parentPath) {
      for (const [name, entry] of Object.entries(tree)) {
        if (!entry || typeof entry !== "object") continue;
        const candidates = entryNames(name, entry);
        for (const banned of BANNED) {
          if (candidates.includes(banned.name)) {
            push(hitFor({
              name: banned.name,
              version: entryVersion(entry),
              source: `package-lock.json:${parentPath}${name}`,
            }));
          }
        }
        const nested = /** @type {LockfileEntry} */ (entry).dependencies;
        if (nested && typeof nested === "object") {
          walk(/** @type {Record<string, unknown>} */ (nested), `${parentPath}${name}/`);
        }
      }
    }
    walk(lock.dependencies, "");
  }

  return hits;
}

/**
 * Scan a non-npm lockfile (pnpm-lock.yaml / yarn.lock) for banned package
 * names. H-1018: a refactor that introduces a pnpm or yarn lockfile would
 * otherwise silently bypass the gate. We avoid a YAML/yarn-lock parser (this
 * script is zero-dependency) and instead match each banned name where it
 * appears as a complete entry-key token, in the shapes every real install
 * emits:
 *   1. the name followed by a version separator `@` or `/`, with an OPTIONAL
 *      leading `/` — covers pnpm v9 `axios@1.14.1:`, pnpm v6 `/axios@1.14.1:`,
 *      pnpm v5 `/axios/1.14.1:`, scoped `/@scope/n/1:`, and yarn `"axios@^1":`.
 *      The leading `/` must itself sit at a start/space/quote boundary, so
 *      `@scope/axios` (a DIFFERENT, scoped package) does NOT match `axios`.
 *   2. an `npm:<banned>@…` alias target — covers a yarn classic/berry alias
 *      key `"my-alias@npm:axios@^1":` where the banned name sits behind `npm:`.
 * The leading boundary prevents substring false-positives (`my-axios@` etc.).
 * @param {string} relPath @param {string} label @returns {Hit[]}
 */
function scanTextLockfile(relPath, label) {
  const path = resolve(REPO_ROOT, relPath);
  if (!existsSync(path)) return [];
  const text = readFileSync(path, "utf8");
  /** @type {Hit[]} */
  const hits = [];
  for (const banned of BANNED) {
    const esc = escapeRegExp(banned.name);
    const patterns = [
      new RegExp(`(?:^|[\\s"'])/?${esc}[@/]([^\\s:,"'(]+)`, "m"),
      new RegExp(`npm:${esc}@([^\\s:,"']+)`, "m"),
    ];
    for (const re of patterns) {
      const m = re.exec(text);
      if (m) {
        hits.push(hitFor({
          name: banned.name,
          version: m[1] || "unknown",
          source: label,
        }));
        break;
      }
    }
  }
  return hits;
}

function main() {
  // H-1018: scan EVERY lockfile format present, not just package-lock.json.
  const lockfiles = [
    { rel: "package-lock.json", label: "package-lock.json" },
    { rel: "pnpm-lock.yaml", label: "pnpm-lock.yaml" },
    { rel: "yarn.lock", label: "yarn.lock" },
  ];
  const present = lockfiles.filter((l) => existsSync(resolve(REPO_ROOT, l.rel)));

  const hits = [
    ...scanPackageJson(),
    ...scanLockfile(),
    ...scanTextLockfile("pnpm-lock.yaml", "pnpm-lock.yaml"),
    ...scanTextLockfile("yarn.lock", "yarn.lock"),
  ];

  // Fail CLOSED when there is no lockfile at all: a security gate must not
  // silently degrade to a manifest-only check, missing every transitive
  // supply-chain dep (the primary attack surface). Explicit opt-out for the
  // rare legitimate lockfile-less context.
  const noLockfile = present.length === 0 && !process.env.ALLOW_NO_LOCKFILE;
  if (noLockfile) {
    console.error(
      "check-banned-packages: no lockfile (package-lock.json / pnpm-lock.yaml " +
        "/ yarn.lock) present — the transitive-dependency scan cannot run. " +
        "FAILING CLOSED. Set ALLOW_NO_LOCKFILE=1 to run a direct-deps-only scan.",
    );
  }

  if (hits.length === 0 && !noLockfile) {
    console.log("check-banned-packages: clean (0 banned packages found)");
    return 0;
  }

  if (hits.length > 0) {
    console.error("check-banned-packages: BANNED PACKAGES DETECTED\n");
    for (const hit of hits) {
      console.error(
        `  Banned package detected: ${hit.name}@${hit.version} (found in ${hit.source}).`,
      );
      console.error(`    Reason: ${hit.reason}`);
      console.error(`    ${hit.alternative}`);
      console.error("");
    }
    console.error(
      "See ~/.claude/CLAUDE.md 'Banned Packages' section for full rationale.",
    );
    console.error(
      "If this is a transitive dep, find a replacement upstream package that does not pull the banned lib.",
    );
  }
  return 1;
}

// Run only when invoked directly (`node scripts/check-banned-packages.mjs`),
// NOT when imported — the regression test imports `BANNED` from this module as
// the single source of truth, and importing must not trigger the exit. Compare
// REALPATHS: `import.meta.url` is realpath-resolved while `process.argv[1]` is
// not, so a symlinked invocation path would otherwise diverge and silently skip
// the gate (fail-open). realpathSync is wrapped so a missing argv path falls
// back to running rather than throwing.
function invokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  }
}

if (invokedDirectly()) {
  process.exit(main());
}
