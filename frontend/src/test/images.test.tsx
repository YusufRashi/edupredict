import { screen } from "@testing-library/react";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { LandingPage } from "../pages/LandingPage";
import { LoginPage } from "../pages/LoginPage";
import { RegisterPage } from "../pages/RegisterPage";
import StudentPortalPage from "../pages/StudentPortalPage";
import { renderApp, signIn } from "./helpers";

const PUBLIC = join(process.cwd(), "public");
const MAX_BYTES = 400 * 1024;

function sources(container: HTMLElement): string[] {
  return [...container.querySelectorAll("img")].map((image) => image.getAttribute("src")!);
}

beforeEach(() => {
  vi.restoreAllMocks();
  signIn(null);
});

describe("images", () => {
  it.each(readdirSync(join(PUBLIC, "images")))("%s is a real, reasonably small image", (name) => {
    const path = join(PUBLIC, "images", name);
    expect(statSync(path).size).toBeLessThan(MAX_BYTES);
    const header = readFileSync(path).subarray(0, 12).toString("latin1");
    expect(header.slice(0, 4)).toBe("RIFF");
    expect(header.slice(8, 12)).toBe("WEBP");
  });

  it("the landing page uses photos that exist, each described for screen readers", () => {
    const { container } = renderApp(<LandingPage />);
    const photos = sources(container).filter((src) => src.startsWith("/images/"));
    expect(photos.length).toBeGreaterThanOrEqual(2);
    for (const src of photos) expect(existsSync(join(PUBLIC, src))).toBe(true);
    expect(screen.getByAltText(/student with a backpack/)).toBeInTheDocument();
    expect(screen.getByAltText(/colleagues talking/)).toBeInTheDocument();
  });

  it("the login page photo exists and is hidden from screen readers as decoration", () => {
    const { container } = renderApp(<LoginPage />, "/login");
    const photo = container.querySelector('img[src="/images/books.webp"]');
    expect(photo).toHaveAttribute("alt", "");
    expect(existsSync(join(PUBLIC, "images/books.webp"))).toBe(true);
  });

  it("the register page has its own photo, and that file exists", () => {
    const { container } = renderApp(<RegisterPage />, "/register");
    expect(container.querySelector('img[src="/images/desk.webp"]')).toHaveAttribute("alt", "");
    expect(existsSync(join(PUBLIC, "images/desk.webp"))).toBe(true);
  });

  it("the student portal banner keeps the page title as its heading", async () => {
    signIn("student");
    vi.spyOn(api, "get").mockImplementation(async (url) => ({
      status: 200,
      data: url === "/students/me"
        ? { id: 2, student_code: "S-2", full_name: "Ana Example", email: null, year_group: null, is_demo: false, linked_user_email: null, latest_predictions: [], records: [], recommendations: [] }
        : { id: 1, email: "s@example.com", full_name: "Test student", role: "student", is_active: true, created_at: "2026-01-01T00:00:00Z" },
    }));
    const { container } = renderApp(<StudentPortalPage />);
    expect(await screen.findByRole("heading", { level: 1, name: "Welcome, Ana Example" })).toBeInTheDocument();
    expect(container.querySelector('img[src="/images/library.webp"]')).toHaveAttribute("alt", "");
  });
});
