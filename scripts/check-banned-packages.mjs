#!/usr/bin/env node
/**
 * scripts/check-banned-packages.mjs
 *
 * Fails CI if any package in ~/.claude/CLAUDE.md's "Banned Packages"
 * table appears in either package.json (direct dependency) OR
 * package-lock.json (transitive). Supply-chain attacks typically land
 * through the lockfile, so we must block both.
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

// Keep in sync with the "Banned Packages" table in ~/.claude/CLAUDE.md.
// Every entry must include a safe alternative — contributors need to
// know what to use instead, not just that their PR failed.
const BANNED = [
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
 * Check package-lock.json for any banned package in the resolved tree,
 * catching transitive deps. Supports both lockfile v1 (dependencies
 * tree) and lockfile v2/v3 (packages map keyed by node_modules path).
 * @returns {Hit[]}
 */
function scanLockfile() {
  const path = resolve(REPO_ROOT, "package-lock.json");
  if (!existsSync(path)) return [];
  const lock = JSON.parse(readFileSync(path, "utf8"));
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
            // @ts-expect-error — dynamic lockfile shape
            version: String(entry.version ?? "unknown"),
            source: `package-lock.json:${key}`,
          }));
        }
      }
    }
  }

  // Lockfile v1: dependencies tree. Walk recursively.
  if (lock.dependencies && typeof lock.dependencies === "object") {
    /** @param {Record<string, any>} tree @param {string} parentPath */
    function walk(tree, parentPath) {
      for (const [name, entry] of Object.entries(tree)) {
        if (!entry || typeof entry !== "object") continue;
        for (const banned of BANNED) {
          if (name === banned.name) {
            push(hitFor({
              name: banned.name,
              version: String(entry.version ?? "unknown"),
              source: `package-lock.json:${parentPath}${name}`,
            }));
          }
        }
        if (entry.dependencies && typeof entry.dependencies === "object") {
          walk(entry.dependencies, `${parentPath}${name}/`);
        }
      }
    }
    walk(lock.dependencies, "");
  }

  return hits;
}

function main() {
  const hits = [...scanPackageJson(), ...scanLockfile()];
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

process.exit(main());
