import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, errorMessage, loadSession, saveSession } from "../api/client";
import { ProtectedRoute } from "../components/ProtectedRoute";
import { useAuth } from "../context/AuthContext";
import { LoginPage } from "../pages/LoginPage";
import { passwordProblem, RegisterPage } from "../pages/RegisterPage";
import { apiError, makeUser, renderApp, signIn } from "./helpers";

beforeEach(() => {
  vi.restoreAllMocks();
  signIn(null);
});

describe("login form", () => {
  it("stores the session and leaves the login page on success", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ data: makeUser("educator") });
    const post = vi.spyOn(api, "post").mockResolvedValue({ data: { access_token: "abc", token_type: "bearer", expires_in: 3600, user: makeUser("educator") } });
    renderApp(<Routes><Route path="/login" element={<LoginPage />} /><Route path="/this-week" element={<p>Dashboard here</p>} /></Routes>, "/login");

    await userEvent.type(screen.getByLabelText("Email"), "educator@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "CorrectHorse42");
    await userEvent.click(screen.getByRole("button", { name: "Log in" }));

    expect(await screen.findByText("Dashboard here")).toBeInTheDocument();
    expect(post).toHaveBeenCalledWith("/auth/login", { email: "educator@example.com", password: "CorrectHorse42" });
    expect(loadSession()?.token).toBe("abc");
  });

  it("shows the API message for a wrong password and stores nothing", async () => {
    vi.spyOn(api, "post").mockRejectedValue(apiError(401, "Incorrect email or password."));
    renderApp(<LoginPage />, "/login");

    await userEvent.type(screen.getByLabelText("Email"), "a@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "wrong");
    await userEvent.click(screen.getByRole("button", { name: "Log in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Incorrect email or password.");
    expect(loadSession()).toBeNull();
  });
});

describe("registration form", () => {
  it.each([
    ["short1", "at least 10"],
    ["onlylettershere", "a letter and a number"],
    ["12345678901", "a letter and a number"],
  ])("rejects the password %s", (password, message) => {
    expect(passwordProblem(password)).toContain(message);
  });

  it("does not send a request when the passwords differ", async () => {
    const post = vi.spyOn(api, "post");
    renderApp(<RegisterPage />, "/register");
    await userEvent.type(screen.getByLabelText("Full name"), "New Learner");
    await userEvent.type(screen.getByLabelText("Email"), "new@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "CorrectHorse42");
    await userEvent.type(screen.getByLabelText("Confirm password"), "CorrectHorse43");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("The passwords do not match.")).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it("never sends a role, so nobody can register as staff", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue({ data: makeUser("student") });
    renderApp(<Routes><Route path="/register" element={<RegisterPage />} /><Route path="/login" element={<p>Login page</p>} /></Routes>, "/register");
    await userEvent.type(screen.getByLabelText("Full name"), "New Learner");
    await userEvent.type(screen.getByLabelText("Email"), "new@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "CorrectHorse42");
    await userEvent.type(screen.getByLabelText("Confirm password"), "CorrectHorse42");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("Login page")).toBeInTheDocument();
    expect(post.mock.calls[0][1]).toEqual({ email: "new@example.com", full_name: "New Learner", password: "CorrectHorse42" });
  });
});

describe("protected routes", () => {
  const routes = (
    <Routes>
      <Route path="/login" element={<p>Login page</p>} />
      <Route path="/my-progress" element={<p>Student portal</p>} />
      <Route path="/this-week" element={<p>Weekly list</p>} />
      <Route element={<ProtectedRoute roles={["admin"]} />}>
        <Route path="/users" element={<p>User management</p>} />
      </Route>
    </Routes>
  );

  // Keep the role from the saved session rather than overwriting it from /auth/me.
  beforeEach(() => {
    vi.spyOn(api, "get").mockImplementation(async () => ({ data: loadSession()?.user }));
  });

  it("sends anonymous visitors to login", () => {
    renderApp(routes, "/users");
    expect(screen.getByText("Login page")).toBeInTheDocument();
  });

  it("sends a student away from an admin page to their own home", () => {
    signIn("student");
    renderApp(routes, "/users");
    expect(screen.getByText("Student portal")).toBeInTheDocument();
    expect(screen.queryByText("User management")).not.toBeInTheDocument();
  });

  it("sends an educator away from an admin page to the weekly list", () => {
    signIn("educator");
    renderApp(routes, "/users");
    expect(screen.getByText("Weekly list")).toBeInTheDocument();
  });

  it("lets an admin in", () => {
    signIn("admin");
    renderApp(routes, "/users");
    expect(screen.getByText("User management")).toBeInTheDocument();
  });
});

describe("session handling", () => {
  it("ignores an expired saved session", () => {
    saveSession({ token: "old", expiresAt: Date.now() - 1000, user: makeUser() });
    expect(loadSession()).toBeNull();
  });

  it("ends the session and says why when the API rejects the token", async () => {
    signIn("educator");
    vi.spyOn(api, "get").mockResolvedValue({ data: makeUser("educator") });
    function Probe() {
      const { user, sessionExpired } = useAuth();
      return <p>{user ? "signed in" : sessionExpired ? "expired" : "signed out"}</p>;
    }
    renderApp(<Probe />);
    expect(screen.getByText("signed in")).toBeInTheDocument();

    // A real 401 from a protected endpoint travels through the response interceptor.
    vi.restoreAllMocks();
    const adapter = vi.fn().mockRejectedValue(Object.assign(apiError(401, "Invalid token."), { config: { url: "/students" } }));
    await api.get("/students", { adapter }).catch(() => {});

    expect(await screen.findByText("expired")).toBeInTheDocument();
    await waitFor(() => expect(loadSession()).toBeNull());
  });
});

describe("error messages", () => {
  it("joins validation errors and removes the pydantic prefix", () => {
    expect(errorMessage(apiError(422, [{ msg: "Value error, Name is required." }, { msg: "Too long." }]))).toBe("Name is required. Too long.");
  });

  it("explains when the server cannot be reached", () => {
    expect(errorMessage(Object.assign(new Error("x"), { isAxiosError: true }))).toContain("Cannot reach the server");
  });
});
