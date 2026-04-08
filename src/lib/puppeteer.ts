import type { Browser } from "puppeteer-core";

const DEFAULT_MAC_CHROME =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DEFAULT_LINUX_CHROME = "/usr/bin/google-chrome";

/**
 * Launch a headless Chromium browser that works on both Vercel's serverless
 * runtime and local dev. On serverless it uses @sparticuz/chromium (a
 * pre-compiled, size-optimized Chromium build for Lambda). Locally it uses
 * the system Chrome binary — override via `PUPPETEER_EXECUTABLE_PATH`.
 *
 * The caller is responsible for closing the browser in a finally block.
 */
export async function launchBrowser(): Promise<Browser> {
  const puppeteer = await import("puppeteer-core");

  const isServerless =
    !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME;

  if (isServerless) {
    const chromium = (await import("@sparticuz/chromium")).default;
    return puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: true,
    });
  }

  const localPath =
    process.env.PUPPETEER_EXECUTABLE_PATH ||
    (process.platform === "darwin" ? DEFAULT_MAC_CHROME : DEFAULT_LINUX_CHROME);

  return puppeteer.launch({
    headless: true,
    executablePath: localPath,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
}
