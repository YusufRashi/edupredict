import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { saveSession } from "../api/client";
import type { Role, User } from "../api/types";
import { AuthProvider } from "../context/AuthContext";
import { ToastProvider } from "../context/ToastContext";

export function makeUser(role: Role = "educator"): User {
  return { id: 1, email: `${role}@example.com`, full_name: `Test ${role}`, role, is_active: true, created_at: "2026-01-01T00:00:00Z" };
}

/** Start logged in as this role, or logged out when given null. */
export function signIn(role: Role | null): void {
  saveSession(role ? { token: "test-token", expiresAt: Date.now() + 60_000, user: makeUser(role) } : null);
}

export function renderApp(ui: ReactElement, route = "/") {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <ToastProvider>
        <AuthProvider>{ui}</AuthProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
}

/** A rejection shaped like an Axios error from the API. */
export function apiError(status: number, detail: unknown) {
  return Object.assign(new Error("Request failed"), { isAxiosError: true, response: { status, data: { detail } } });
}
