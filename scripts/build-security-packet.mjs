#!/usr/bin/env node
/**
 * Render scripts/build-security-packet.html to public/security-packet.pdf
 * using the repo's existing puppeteer-core + system Chrome pipeline.
 *
 * Usage (from repo root):
 *   node scripts/build-security-packet.mjs
 *
 * Commit the resulting public/security-packet.pdf. Regenerate only when
 * scripts/build-security-packet.html changes — see
 * docs/runbooks/security-packet-update.md for the full checklist.
 *
 * We launch a local Chrome (same path the rest of the repo uses for
 * puppeteer-core in development) so the output is deterministic across
 * developer machines. No dependency bump is needed — puppeteer-core is
 * already pinned in package.json for the per-request PDF routes.
 */
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const HTML_PATH = resolve(__dirname, "build-security-packet.html");
const PDF_PATH = resolve(REPO_ROOT, "public", "security-packet.pdf");

const DEFAULT_MAC_CHROME =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DEFAULT_LINUX_CHROME = "/usr/bin/google-chrome";

async function main() {
  if (!existsSync(HTML_PATH)) {
    throw new Error(`Missing source HTML: ${HTML_PATH}`);
  }
  const outDir = dirname(PDF_PATH);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const executablePath =
    process.env.PUPPETEER_EXECUTABLE_PATH ||
    (process.platform === "darwin" ? DEFAULT_MAC_CHROME : DEFAULT_LINUX_CHROME);

  const puppeteer = await import("puppeteer-core");
  const browser = await puppeteer.launch({
    headless: true,
    executablePath,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(15_000);
    page.setDefaultTimeout(15_000);
    const url = pathToFileURL(HTML_PATH).toString();
    await page.goto(url, { waitUntil: "networkidle0", timeout: 20_000 });
    await page.emulateMediaType("print");
    await page.pdf({
      path: PDF_PATH,
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
    });
    console.log(`wrote ${PDF_PATH}`);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error("[build-security-packet] failed:", err);
  process.exit(1);
});
