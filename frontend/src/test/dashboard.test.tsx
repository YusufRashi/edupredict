import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import type { Overview } from "../api/types";
import DashboardPage from "../pages/DashboardPage";
import StudentPortalPage from "../pages/StudentPortalPage";
import StudentsPage from "../pages/StudentsPage";
import { apiError, renderApp, signIn } from "./helpers";

const OVERVIEW: Overview = {
  total_students: 137, demo_students: 0, total_records: 209, total_predictions: 412, demo_predictions: 0,
  students_needing_attention: 23, average_final_grade: 11.4, final_grades_recorded: 200, pass_rate: 0.78,
  pass_mark: 10, risk_distribution: { low: 150, moderate: 30, high: 20 },
};
const EMPTY_PAGE = { items: [], total: 0, page: 1, page_size: 15, pages: 0 };
const DISTRIBUTION = { pass_mark: 10, grades: [], risk_distribution: OVERVIEW.risk_distribution };
const TRENDS = { grades_by_period: [], predictions_per_day: [] };

function respond(routes: Record<string, unknown>) {
  return vi.spyOn(api, "get").mockImplementation(async (url) => ({
    data: url in routes ? routes[url] : {},
    status: 200,
  }));
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("educator dashboard", () => {
  beforeEach(() => signIn("educator"));

  it("shows figures from the API, with empty states where there is no data", async () => {
    respond({ "/analytics/overview": OVERVIEW, "/analytics/distribution": DISTRIBUTION, "/analytics/trends": TRENDS, "/analytics/attention": [], "/predictions": EMPTY_PAGE });
    renderApp(<DashboardPage />);
    expect(await screen.findByText("137")).toBeInTheDocument();
    expect(screen.getByText("412")).toBeInTheDocument();
    expect(screen.getByText("23")).toBeInTheDocument();
    expect(screen.getByText("11.4")).toBeInTheDocument();
    expect(await screen.findByText("No students flagged")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /New prediction/ })).toHaveAttribute("href", "/predictions/new");
    expect(screen.queryByText(/demonstration students/)).not.toBeInTheDocument();
  });

  it("says plainly when figures include demonstration data", async () => {
    respond({ "/analytics/overview": { ...OVERVIEW, demo_students: 137 }, "/analytics/distribution": DISTRIBUTION, "/analytics/trends": TRENDS, "/analytics/attention": [], "/predictions": EMPTY_PAGE });
    renderApp(<DashboardPage />);
    expect(await screen.findByText(/137 demonstration students/)).toBeInTheDocument();
  });

  it("shows an error with a retry that really refetches", async () => {
    const get = vi.spyOn(api, "get").mockRejectedValue(apiError(500, "Something went wrong on our side."));
    renderApp(<DashboardPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong on our side.");
    const before = get.mock.calls.length;
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(get.mock.calls.length).toBeGreaterThan(before);
  });
});

describe("student directory", () => {
  beforeEach(() => signIn("educator"));

  it("sends filters to the API and asks for confirmation before deleting", async () => {
    const student = { id: 4, student_code: "S-4", full_name: "Ana Example", year_group: "Year 11", is_demo: true, subjects: ["math"], average_final_grade: 12, highest_risk: "moderate" };
    const get = respond({ "/students": { ...EMPTY_PAGE, items: [student], total: 1, pages: 1 }, "/students/year-groups": ["Year 11"] });
    const del = vi.spyOn(api, "delete").mockResolvedValue({ data: null });
    renderApp(<StudentsPage />);

    expect(await screen.findByRole("link", { name: "Ana Example" })).toHaveAttribute("href", "/students/4");
    expect(screen.getByText("Demo")).toBeInTheDocument();
    expect(screen.getByText("Moderate concern")).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("Latest concern"), "high");
    expect(get).toHaveBeenLastCalledWith("/students", { params: expect.objectContaining({ risk_level: "high", page: 1 }) });

    await userEvent.click(await screen.findByRole("button", { name: "Delete Ana Example" }));
    expect(del).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Delete student" }));
    expect(del).toHaveBeenCalledWith("/students/4");
  });
});

describe("student portal", () => {
  beforeEach(() => signIn("student"));

  it("explains what to do when the account is not linked yet", async () => {
    vi.spyOn(api, "get").mockRejectedValue(apiError(404, "Not linked."));
    renderApp(<StudentPortalPage />);
    expect(await screen.findByText(/not linked to a student record yet/)).toBeInTheDocument();
  });

  it("shows own grades and shared feedback, with no risk score", async () => {
    respond({
      "/students/me": {
        id: 2, student_code: "S-2", full_name: "Ana Example", email: null, year_group: null, is_demo: false, linked_user_email: null, latest_predictions: [],
        records: [{ id: 1, student_id: 2, subject: "math", academic_year: "2025/26", period1_grade: 9, period2_grade: 11, final_grade: 12, absences: 3, study_time: 2, past_failures: 0, school_support: false, activities: true, wants_higher_education: true }],
        recommendations: [{ id: 5, student_id: 2, prediction_id: null, category: "general", title: "Keep it up", message: "Good progress.", priority: "low", status: "open", source: "educator", shared_with_student: true, created_at: "2026-11-08T10:00:00Z" }],
      },
    });
    renderApp(<StudentPortalPage />);
    expect(await screen.findByText("Keep it up")).toBeInTheDocument();
    expect(screen.getByText("1 of 1")).toBeInTheDocument();
    expect(screen.queryByText(/concern/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/risk/i)).not.toBeInTheDocument();
  });
});
