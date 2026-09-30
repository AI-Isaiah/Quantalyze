import { describe, it, expect } from "vitest";
import type React from "react";
import {
  normalizeCredentialInput,
  readCredentialInput,
  CREDENTIAL_KEY_INPUT_PROPS,
  CREDENTIAL_SECRET_INPUT_PROPS,
} from "./credential-input";

/**
 * Phase 169.3 D-76: the one client-side rule for credential inputs.
 *
 * Why it exists: an exchange API key or secret pasted from a spreadsheet cell
 * arrives with leading/trailing whitespace, line breaks or invisible characters
 * (U+200B, U+FEFF). The server trims (`trimCredential`), so without a client
 * rule the field shows something other than what is sent.
 */

function changeEvent(value: string, inputType?: string) {
  return {
    target: { value },
    nativeEvent: inputType === undefined ? {} : { inputType },
  } as unknown as React.ChangeEvent<HTMLInputElement>;
}

describe("normalizeCredentialInput (D-76)", () => {
  it("strips leading/trailing spaces and a trailing line break", () => {
    expect(normalizeCredentialInput("  AK_TEST_1\n")).toBe("AK_TEST_1");
  });

  it("strips tabs, CR and LF on both ends", () => {
    expect(normalizeCredentialInput("\t\r\nAK\r\n")).toBe("AK");
  });

  it("strips U+200B on both ends, the character a bare String.prototype.trim() leaves in place", () => {
    expect(normalizeCredentialInput("​AK​")).toBe("AK");
  });

  it("strips U+FEFF mixed with spaces on both ends", () => {
    expect(normalizeCredentialInput("﻿ AK ﻿")).toBe("AK");
  });

  it("strips a no-break space (U+00A0) on both ends", () => {
    expect(normalizeCredentialInput(" AK ")).toBe("AK");
  });

  it("leaves an interior space untouched, so a credential's own content is never edited", () => {
    expect(normalizeCredentialInput("A K")).toBe("A K");
  });

  it("returns the empty string for the empty string", () => {
    expect(normalizeCredentialInput("")).toBe("");
  });
});

describe("readCredentialInput: normalizes bulk-arriving text, never keystrokes (D-76 keystroke guard)", () => {
  it("normalizes a paste (insertFromPaste)", () => {
    expect(readCredentialInput(changeEvent("  AK_TEST_1\n", "insertFromPaste"))).toBe("AK_TEST_1");
  });

  it("normalizes a drop (insertFromDrop)", () => {
    expect(readCredentialInput(changeEvent("​AK​", "insertFromDrop"))).toBe("AK");
  });

  it("normalizes a change with no inputType (autofill, programmatic change)", () => {
    expect(readCredentialInput(changeEvent("  AK  "))).toBe("AK");
  });

  it("returns the raw value for a typed character, because an interior space being typed is briefly trailing and stripping it would silently change the credential", () => {
    expect(readCredentialInput(changeEvent("ab ", "insertText"))).toBe("ab ");
  });

  it("returns the raw value for IME composition input", () => {
    expect(readCredentialInput(changeEvent("ab ", "insertCompositionText"))).toBe("ab ");
  });

  it("returns the raw value for any deletion, so backspacing to an interior space keeps it", () => {
    expect(readCredentialInput(changeEvent("ab ", "deleteContentBackward"))).toBe("ab ");
    expect(readCredentialInput(changeEvent(" ab", "deleteWordForward"))).toBe(" ab");
  });
});

describe("the attribute sets (D-76)", () => {
  const VENDOR_IGNORE = {
    "data-1p-ignore": "true",
    "data-bwignore": "true",
    "data-lpignore": "true",
    "data-form-type": "other",
  };

  it("key inputs keep autocomplete=off and carry the four vendor ignore attributes", () => {
    expect(CREDENTIAL_KEY_INPUT_PROPS).toEqual({ autoComplete: "off", ...VENDOR_IGNORE });
  });

  it("masked secret inputs carry autocomplete=new-password (not a saved-login target) and the four vendor ignore attributes", () => {
    expect(CREDENTIAL_SECRET_INPUT_PROPS).toEqual({ autoComplete: "new-password", ...VENDOR_IGNORE });
  });
});
