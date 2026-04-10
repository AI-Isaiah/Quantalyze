import { describe, expect, it } from "vitest";
import { sanitizeFilename } from "./sanitize-filename";

describe("sanitizeFilename", () => {
  it("passes through clean ASCII names unchanged", () => {
    expect(sanitizeFilename("My Portfolio")).toBe("My Portfolio");
  });

  it("strips carriage returns and newlines (header injection)", () => {
    expect(sanitizeFilename("name\r\nInjected-Header: evil")).toBe(
      "nameInjected-Header: evil",
    );
    expect(sanitizeFilename("a\rb\nc")).toBe("abc");
  });

  it("strips double-quotes and backslashes", () => {
    expect(sanitizeFilename('file"name')).toBe("filename");
    expect(sanitizeFilename("file\\name")).toBe("filename");
  });

  it("strips non-ASCII characters", () => {
    expect(sanitizeFilename("caf\u00e9-strat\u00e9gie")).toBe("caf-stratgie");
    expect(sanitizeFilename("\u{1F680}rocket")).toBe("rocket");
  });

  it("truncates to 80 characters", () => {
    const long = "A".repeat(100);
    const result = sanitizeFilename(long);
    expect(result).toHaveLength(80);
    expect(result).toBe("A".repeat(80));
  });

  it("returns fallback for empty string", () => {
    expect(sanitizeFilename("")).toBe("document");
    expect(sanitizeFilename("", "report")).toBe("report");
  });

  it("returns fallback when only non-printable characters remain", () => {
    expect(sanitizeFilename("\r\n\"\\\u00e9")).toBe("document");
  });

  it("trims leading/trailing whitespace before length check", () => {
    expect(sanitizeFilename("  spaced  ")).toBe("spaced");
  });
});
