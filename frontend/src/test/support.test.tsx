import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import type { SupportAction, SupportResults, WatchItem, Watchlist } from "../api/types";
import { localDate } from "../format";
import ResultsPage from "../pages/ResultsPage";
import ThisWeekPage from "../pages/ThisWeekPage";
import { apiError, renderApp, signIn } from "./helpers";

const ACTION: SupportAction = {
  id: 11, student_id: 3, student_name: "Ana Example", student_code: "S-3", is_demo: false, subject: "math",
  prediction_id: 9, action_type: "tutoring", note: null, status: "planned", due_date: "2026-11-01", is_overdue: true,
  owner_id: 1, owner_name: "Test educator", outcome_note: null, completed_at: null, created_by_name: "Test educator",
  created_at: "2026-10-20T10:00:00Z",
};

const ITEM: WatchItem = {
  student_id: 4, student_name: "Ben Example", student_code: "S-4", year_group: "Year 11", is_demo: false,
  subject: "portuguese", prediction_id: 12, risk_level: "high", risk_probability: 0.81, predicted_grade: 7.2,
  assessed_at: "2026-11-08T10:00:00Z", state: "needs_action", reasons: ["Second period grade: 6", "School absences: 18"],
  changes: [{ direction: "worse", text: "Absences up from 4 to 18" }], next_action: null, actions_done: 0,
};

const OVERDUE: WatchItem = { ...ITEM, student_id: 3, student_name: "Ana Example", subject: "math", prediction_id: 9, state: "overdue", changes: [], next_action: ACTION };

const LIST: Watchlist = {
  items: [OVERDUE, ITEM], total: 2, page: 1, page_size: 15, pages: 1,
  counts: { overdue: 1, needs_action: 1, in_progress: 0, followed_up: 0 },
};

const EMPTY: Watchlist = { items: [], total: 0, page: 1, page_size: 15, pages: 1, counts: { overdue: 0, needs_action: 0, in_progress: 0, followed_up: 0 } };

function respond(list: Watchlist = LIST) {
  return vi.spyOn(api, "get").mockImplementation(async (url) => ({
    status: 200,
    data: url === "/support/watchlist" ? list : url === "/support/staff" ? [{ id: 1, full_name: "Test educator" }, { id: 2, full_name: "Other Teacher" }] : {},
  }));
}

beforeEach(() => {
  vi.restoreAllMocks();
  signIn("educator");
});

describe("this week page", () => {
  it("shows counts, reasons, changes and an overdue follow-up", async () => {
    respond();
    renderApp(<ThisWeekPage />);
    const ben = (await screen.findByRole("link", { name: "Ben Example" })).closest("li")!;
    expect(within(ben).getByText("Absences up from 4 to 18")).toBeInTheDocument();
    expect(within(ben).getByText(/Second period grade: 6/)).toBeInTheDocument();
    const ana = screen.getByRole("link", { name: "Ana Example" }).closest("li")!;
    expect(within(ana).getByText(/was due/)).toBeInTheDocument();
    expect(within(ana).getByText("Tutoring")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Overdue/ })).toHaveTextContent("1");
  });

  it("filters by state when a count is clicked", async () => {
    const get = respond();
    renderApp(<ThisWeekPage />);
    await userEvent.click(await screen.findByRole("button", { name: /Needs a plan/ }));
    expect(get).toHaveBeenLastCalledWith("/support/watchlist", { params: expect.objectContaining({ state: "needs_action" }) });
  });

  it("plans support with the owner, date and prediction, then reloads", async () => {
    const get = respond();
    const post = vi.spyOn(api, "post").mockResolvedValue({ data: {} });
    renderApp(<ThisWeekPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Plan support for Ben Example, Portuguese" }));

    const dialog = screen.getByRole("dialog");
    await within(dialog).findByRole("option", { name: "Other Teacher" });
    await userEvent.selectOptions(within(dialog).getByLabelText("What will happen"), "family_contact");
    await userEvent.selectOptions(within(dialog).getByLabelText("Responsible"), "2");
    await userEvent.type(within(dialog).getByLabelText("Note (optional)"), "Call on Tuesday");
    const before = get.mock.calls.length;
    await userEvent.click(within(dialog).getByRole("button", { name: "Save plan" }));

    expect(post).toHaveBeenCalledWith("/support/actions", {
      student_id: 4, subject: "portuguese", action_type: "family_contact", due_date: localDate(7),
      owner_id: 2, note: "Call on Tuesday", prediction_id: 12,
    });
    expect(await screen.findByText("The plan was saved.")).toBeInTheDocument();
    expect(get.mock.calls.length).toBeGreaterThan(before);
  });

  it("keeps the form open and shows why when saving fails", async () => {
    respond();
    vi.spyOn(api, "post").mockRejectedValue(apiError(422, "The follow-up date cannot be in the past."));
    renderApp(<ThisWeekPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Plan support for Ben Example, Portuguese" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save plan" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("cannot be in the past");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("marks a follow-up as done with what happened", async () => {
    respond();
    const patch = vi.spyOn(api, "patch").mockResolvedValue({ data: {} });
    renderApp(<ThisWeekPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Mark done for Ana Example, Mathematics" }));
    const dialog = screen.getByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("What happened? (optional)"), "Attended twice");
    await userEvent.click(within(dialog).getByRole("button", { name: "Mark as done" }));
    expect(patch).toHaveBeenCalledWith("/support/actions/11", { status: "done", outcome_note: "Attended twice" });
  });

  it("reports honestly when an update finds nothing new", async () => {
    respond();
    const post = vi.spyOn(api, "post").mockResolvedValue({ data: { scored: 0, remaining: 0 } });
    renderApp(<ThisWeekPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Update from records" }));
    expect(post).toHaveBeenCalledWith("/support/refresh");
    expect(await screen.findByText(/No records have changed/)).toBeInTheDocument();
  });

  it("explains an empty list", async () => {
    respond(EMPTY);
    renderApp(<ThisWeekPage />);
    expect(await screen.findByText("Nobody needs attention right now")).toBeInTheDocument();
  });

  it("explains why demo students stay on the list", async () => {
    respond({ ...LIST, items: [{ ...ITEM, is_demo: true }] });
    renderApp(<ThisWeekPage />);
    expect(await screen.findByText(/come from a finished dataset/)).toBeInTheDocument();
  });
});

describe("results page", () => {
  const RESULTS: SupportResults = {
    pass_mark: 10, include_demo: true, flagged_courses: 40, demo_courses: 0,
    actions: { total: 32, planned: 5, overdue: 2, done: 25, cancelled: 2 },
    with_completed_action: { courses: 25, finals_known: 20, passed: 15, pass_rate: 0.75, small_group: true },
    without_completed_action: { courses: 15, finals_known: 0, passed: 0, pass_rate: null, small_group: true },
  };

  it("shows real counts and warns that this is not proof", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ status: 200, data: RESULTS });
    renderApp(<ResultsPage />);
    expect(await screen.findByText("40")).toBeInTheDocument();
    expect(screen.getByText("75%")).toBeInTheDocument();
    expect(screen.getByText("Small group")).toBeInTheDocument();
    expect(screen.getByText(/does not prove that support caused/)).toBeInTheDocument();
  });

  it("can leave out demonstration students", async () => {
    const get = vi.spyOn(api, "get").mockResolvedValue({ status: 200, data: RESULTS });
    renderApp(<ResultsPage />);
    await userEvent.click(await screen.findByLabelText("Include demonstration students"));
    expect(get).toHaveBeenLastCalledWith("/support/results", { params: { include_demo: false } });
  });
});
