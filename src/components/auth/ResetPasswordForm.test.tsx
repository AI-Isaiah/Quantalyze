import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";

/**
 * ResetPasswordForm — client validation + success/error path contract.
 */

const updateUserMock = vi.fn();
const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      updateUser: updateUserMock,
    },
  }),
}));

import { ResetPasswordForm } from "./ResetPasswordForm";

function getInputs(container: HTMLElement) {
  return {
    pw: container.querySelector('input[name="password"]') as HTMLInputElement,
    confirm: container.querySelector(
      'input[name="confirm_password"]',
    ) as HTMLInputElement,
  };
}

describe("ResetPasswordForm", () => {
  beforeEach(() => {
    updateUserMock.mockReset();
    pushMock.mockReset();
  });

  it("rejects mismatched passwords client-side without calling updateUser", async () => {
    const { container, getByText } = render(<ResetPasswordForm />);
    const { pw, confirm } = getInputs(container);
    fireEvent.change(pw, { target: { value: "abcdef" } });
    fireEvent.change(confirm, { target: { value: "abcdeg" } });
    fireEvent.click(getByText("Update password"));

    await new Promise((r) => setTimeout(r, 0));
    expect(updateUserMock).not.toHaveBeenCalled();
    expect(container.textContent).toMatch(/passwords do not match/i);
  });

  it("calls updateUser with the new password and navigates to /login?reset=1 on success", async () => {
    updateUserMock.mockResolvedValueOnce({ data: { user: {} }, error: null });
    const { container, getByText } = render(<ResetPasswordForm />);
    const { pw, confirm } = getInputs(container);
    fireEvent.change(pw, { target: { value: "supersecret" } });
    fireEvent.change(confirm, { target: { value: "supersecret" } });
    fireEvent.click(getByText("Update password"));

    await waitFor(() => expect(updateUserMock).toHaveBeenCalledOnce());
    expect(updateUserMock.mock.calls[0][0]).toEqual({ password: "supersecret" });
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/login?reset=1"));
  });

  it("surfaces a non-session Supabase error.message into the form", async () => {
    updateUserMock.mockResolvedValueOnce({
      data: null,
      error: {
        message: "New password should be different from the old password.",
        name: "AuthApiError",
        status: 422,
      },
    });
    const { container, getByText } = render(<ResetPasswordForm />);
    const { pw, confirm } = getInputs(container);
    fireEvent.change(pw, { target: { value: "supersecret" } });
    fireEvent.change(confirm, { target: { value: "supersecret" } });
    fireEvent.click(getByText("Update password"));

    await waitFor(() => {
      expect(container.textContent).toMatch(
        /new password should be different from the old password/i,
      );
    });
    expect(pushMock).not.toHaveBeenCalled();
  });
});
