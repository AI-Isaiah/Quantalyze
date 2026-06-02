#!/usr/bin/env node
/**
 * scripts/check-banned-packages.mjs
 *
 * Fails CI if any banned package (see the `BANNED` const below — the
 * in-repo, CI-checkable source of truth) appears in package.json (direct
 * dependency) OR in ANY lockfile in the repo (transitive): package-lock.json
 * (npm), pnpm-lock.yaml (pnpm), or yarn.lock (yarn). Supply-chain attacks
 * typically land through the lockfile's transitive graph, so we block every
 * install path — H-1018: scanning only package-lock.json would silently
 * disable the gate the moment a refactor introduces a pnpm/yarn lockfile.
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
 * Exit 0 = clean. Exit 1 = at least one banned package detected.
 */
import { readFileSync, existsSync } from "node:fs";
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
 * Check package.json for any direct dependency (dependencies,
 * devDependencies, peerDependencies, optionalDependencies) that matches
 * a banned package name.
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
    for (const banned of BANNED) {
      if (Object.prototype.hasOwnProperty.call(deps, banned.name)) {
        hits.push(hitFor({
          name: banned.name,
          version: String(deps[banned.name]),
          source: `package.json:${section}`,
        }));
      }
    }
  }
  return hits;
}

/**
 * @typedef {{ version?: unknown, dependencies?: unknown }} LockfileEntry
 * The npm lockfile entry shape we read from. Modelled loosely on purpose:
 * the only field we consume is `version` (a string), and `dependencies`
 * (a nested tree) for the v1 walker. Everything is `unknown` so a future
 * npm reshuffle of the `version` field surfaces in `entryVersion` (-> the
 * literal "unknown") rather than crashing or silently coercing.
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
 * Check package-lock.json for any banned package in the resolved tree,
 * catching transitive deps. Supports both lockfile v1 (dependencies
 * tree) and lockfile v2/v3 (packages map keyed by node_modules path).
 * Scoped banned names (e.g. `@openclaw-ai/openclawai`) are handled by both
 * arms: the v2/v3 key `node_modules/@scope/pkg` slices to the full `@scope/pkg`,
 * and the v1 `dependencies` tree keys scoped packages by their full
 * `@scope/pkg` name (H-1134).
 * @returns {Hit[]}
 */
function scanLockfile() {
  const path = resolve(REPO_ROOT, "package-lock.json");
  if (!existsSync(path)) return [];
  /** @type {{ packages?: Record<string, unknown>, dependencies?: Record<string, unknown> }} */
  const lock = JSON.parse(readFileSync(path, "utf8"));
  // Fail-loud on an unrecognized lockfile shape (M-0992): neither a v2/v3
  // `packages` map nor a v1 `dependencies` tree means npm changed the format
  // and this scanner is silently blind. Surface it instead of passing green.
  const hasV2 = lock.packages && typeof lock.packages === "object";
  const hasV1 = lock.dependencies && typeof lock.dependencies === "object";
  if (!hasV2 && !hasV1) {
    console.error(
      "check-banned-packages: WARNING — package-lock.json has neither a " +
        "`packages` map (v2/v3) nor a `dependencies` tree (v1); the lockfile " +
        "scan is BLIND to its shape. Update this scanner for the new format.",
    );
  }
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

  // Lockfile v2/v3: packages map. Keys are paths like "node_modules/axios"
  // or "node_modules/foo/node_modules/axios" (transitive).
  if (lock.packages && typeof lock.packages === "object") {
    for (const [key, entry] of Object.entries(lock.packages)) {
      if (!key || !entry || typeof entry !== "object") continue;
      const marker = "node_modules/";
      const idx = key.lastIndexOf(marker);
      if (idx < 0) continue;
      const name = key.slice(idx + marker.length);
      for (const banned of BANNED) {
        if (name === banned.name) {
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
  // package by its FULL `@scope/name` (not a nested scope object), so the
  // `name === banned.name` check matches scoped banned names directly (H-1134).
  if (lock.dependencies && typeof lock.dependencies === "object") {
    /** @param {Record<string, unknown>} tree @param {string} parentPath */
    function walk(tree, parentPath) {
      for (const [name, entry] of Object.entries(tree)) {
        if (!entry || typeof entry !== "object") continue;
        for (const banned of BANNED) {
          if (name === banned.name) {
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
 * script is zero-dependency) and instead match each banned name at a lockfile
 * ENTRY boundary — the name immediately followed by `@<version>` and preceded
 * by start-of-line / whitespace / quote / slash. That key shape is common to
 * both formats (yarn `"name@range":`, pnpm `/name@version:` or `name@version:`)
 * and the trailing `@` prevents substring false-positives (`my-axios@` etc.).
 * @param {string} relPath @param {string} label @returns {Hit[]}
 */
function scanTextLockfile(relPath, label) {
  const path = resolve(REPO_ROOT, relPath);
  if (!existsSync(path)) return [];
  const text = readFileSync(path, "utf8");
  /** @type {Hit[]} */
  const hits = [];
  const seen = new Set();
  for (const banned of BANNED) {
    const escaped = banned.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?:^|[\\s"'/])${escaped}@([^\\s:,"']+)`, "m");
    const m = re.exec(text);
    if (m && !seen.has(banned.name)) {
      seen.add(banned.name);
      hits.push(hitFor({
        name: banned.name,
        version: m[1] || "unknown",
        source: `${label}`,
      }));
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
  if (present.length === 0) {
    console.error(
      "check-banned-packages: WARNING — no lockfile (package-lock.json / " +
        "pnpm-lock.yaml / yarn.lock) found; the transitive-dependency scan is " +
        "INACTIVE and only direct package.json deps are checked.",
    );
  }

  const hits = [
    ...scanPackageJson(),
    ...scanLockfile(),
    ...scanTextLockfile("pnpm-lock.yaml", "pnpm-lock.yaml"),
    ...scanTextLockfile("yarn.lock", "yarn.lock"),
  ];
  if (hits.length === 0) {
    console.log("check-banned-packages: clean (0 banned packages found)");
    return 0;
  }

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
  return 1;
}

// Run only when invoked directly (`node scripts/check-banned-packages.mjs`),
// NOT when imported — the regression test imports `BANNED` from this module as
// the single source of truth, and importing must not trigger the exit.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
