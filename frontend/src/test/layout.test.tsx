import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, loadSession } from "../api/client";
import type { Role } from "../api/types";
import { Layout } from "../components/Layout";
import { renderApp, signIn } from "./helpers";

const PAGES = ["/this-week", "/dashboard", "/my-progress", "/students", "/predictions", "/results", "/analytics", "/model", "/reports", "/datasets", "/users", "/settings"];

function renderAs(role: Role, route = "/settings") {
  signIn(role);
  return renderApp(
    <Routes>
      <Route element={<Layout />}>
        {PAGES.map((path) => <Route key={path} path={path} element={<p>Page {path}</p>} />)}
      </Route>
      <Route path="/login" element={<p>Login page</p>} />
    </Routes>,
    route,
  );
}

const mainNav = () => within(screen.getByRole("navigation", { name: "Main" }));
const more = () => mainNav().getByRole("button", { name: /More/ });

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, "get").mockImplementation(async () => ({ data: loadSession()?.user }));
});

describe("top menu", () => {
  it("keeps the weekly pages on the bar and the rest under More", async () => {
    renderAs("educator");
    for (const name of ["This week", "Dashboard", "Students", "Predictions", "Results"]) {
      expect(mainNav().getByRole("link", { name })).toBeInTheDocument();
    }
    expect(mainNav().queryByRole("link", { name: "Analytics" })).not.toBeInTheDocument();

    await userEvent.click(more());
    for (const name of ["Analytics", "Model Information", "Reports", "Datasets"]) {
      expect(mainNav().getByRole("link", { name })).toBeInTheDocument();
    }
  });

  it("offers Users to admins only", async () => {
    renderAs("educator");
    await userEvent.click(more());
    expect(mainNav().queryByRole("link", { name: "Users" })).not.toBeInTheDocument();
  });

  it("shows admins the Users page", async () => {
    renderAs("admin");
    await userEvent.click(more());
    expect(mainNav().getByRole("link", { name: "Users" })).toBeInTheDocument();
  });

  it("shows students only their own page, with no More menu", () => {
    renderAs("student");
    expect(mainNav().getAllByRole("link").map((link) => link.textContent)).toEqual(["My progress"]);
    expect(mainNav().queryByRole("button", { name: /More/ })).not.toBeInTheDocument();
  });

  it("goes to the chosen page and closes the menu", async () => {
    renderAs("educator");
    await userEvent.click(more());
    await userEvent.click(mainNav().getByRole("link", { name: "Reports" }));
    expect(screen.getByText("Page /reports")).toBeInTheDocument();
    expect(more()).toHaveAttribute("aria-expanded", "false");
    expect(more().className).toContain("bg-lavender");
  });

  it("closes on Escape and on a click elsewhere", async () => {
    renderAs("educator");
    await userEvent.click(more());
    expect(more()).toHaveAttribute("aria-expanded", "true");
    await userEvent.keyboard("{Escape}");
    expect(more()).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(more());
    await userEvent.click(screen.getByText("Page /settings"));
    expect(more()).toHaveAttribute("aria-expanded", "false");
  });

  it("logs out from the account menu", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue({ data: null });
    renderAs("educator");
    await userEvent.click(screen.getByRole("button", { name: "Account menu" }));
    expect(screen.getByText("educator@example.com")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Log out" }));
    expect(post).toHaveBeenCalledWith("/auth/logout");
    expect(await screen.findByText("Login page")).toBeInTheDocument();
  });

  it("closes the phone menu after a choice, even the page already open", async () => {
    renderAs("educator", "/students");
    await userEvent.click(screen.getByRole("button", { name: "Open menu" }));
    await userEvent.click(within(screen.getByRole("navigation", { name: "Mobile" })).getByRole("link", { name: "Students" }));
    expect(screen.queryByRole("navigation", { name: "Mobile" })).not.toBeInTheDocument();
  });

  it("closes the More menu when choosing the page already open", async () => {
    renderAs("educator", "/reports");
    await userEvent.click(more());
    await userEvent.click(mainNav().getByRole("link", { name: "Reports" }));
    expect(more()).toHaveAttribute("aria-expanded", "false");
  });

  it("lists every allowed page in the phone menu", async () => {
    renderAs("admin");
    await userEvent.click(screen.getByRole("button", { name: "Open menu" }));
    const phone = within(screen.getByRole("navigation", { name: "Mobile" }));
    for (const name of ["This week", "Dashboard", "Students", "Predictions", "Results", "Analytics", "Model Information", "Reports", "Datasets", "Users", "Settings"]) {
      expect(phone.getByRole("link", { name })).toBeInTheDocument();
    }
    expect(phone.getByRole("button", { name: "Log out" })).toBeInTheDocument();
  });
});
