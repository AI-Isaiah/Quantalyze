import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ApiKeyForm } from "./ApiKeyForm";

/**
 * Reveal-toggle behaviour for the API Secret field. Motivated by dogfooding:
 * deribit rejects a mistyped secret as `invalid_credentials`, and a permanently
 * masked field gives the user no way to catch the typo. The toggle must flip the
 * field between masked (`type=password`) and visible (`type=text`), and — because
 * this is a credential form that scrubs plaintext on every close path — the
 * reveal must reset to masked when the form is cancelled, so a reopened form
 * never starts with a secret on screen.
 */
function renderForm() {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  const onCancel = vi.fn();
  render(
    <ApiKeyForm onSubmit={onSubmit} onCancel={onCancel} loading={false} error={null} />,
  );
  const secret = screen.getByLabelText("API Secret") as HTMLInputElement;
  return { onSubmit, onCancel, secret };
}

describe("ApiKeyForm — API Secret reveal toggle", () => {
  it("starts masked and flips password ↔ text on Show/Hide", () => {
    const { secret } = renderForm();
    expect(secret.type).toBe("password");

    fireEvent.click(screen.getByRole("button", { name: "Show API secret" }));
    expect(secret.type).toBe("text");
    expect(
      screen.getByRole("button", { name: "Hide API secret" }),
    ).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Hide API secret" }));
    expect(secret.type).toBe("password");
  });

  it("re-masks the secret when the form is cancelled (no revealed secret survives a reopen)", () => {
    const { onCancel, secret } = renderForm();
    fireEvent.change(secret, { target: { value: "s3cr3t" } });
    fireEvent.click(screen.getByRole("button", { name: "Show API secret" }));
    expect(secret.type).toBe("text");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
    // The toggle reset to masked, so a re-render can't show a stale plaintext.
    expect(
      screen.getByRole("button", { name: "Show API secret" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect((screen.getByLabelText("API Secret") as HTMLInputElement).type).toBe(
      "password",
    );
  });
});
