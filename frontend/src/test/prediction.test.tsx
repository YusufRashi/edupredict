import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import type { PredictionDetail, PredictionOptions } from "../api/types";
import NewPredictionPage from "../pages/NewPredictionPage";
import { apiError, renderApp, signIn } from "./helpers";

const int = (label: string, minimum: number, maximum: number) => ({ label, kind: "int" as const, help: "", minimum, maximum, choices: [] });
const choice = (label: string, choices: string[]) => ({ label, kind: "choice" as const, help: "", minimum: null, maximum: null, choices });
const BASE = ["studytime", "failures", "absences", "subject", "schoolsup", "activities", "higher"];

const OPTIONS: PredictionOptions = {
  stages: [
    { key: "intake", label: "Start of course", description: "No grades yet.", features: BASE },
    { key: "period1", label: "After first period", description: "Adds G1.", features: ["G1", ...BASE] },
    { key: "period2", label: "After second period", description: "Adds G1 and G2.", features: ["G1", "G2", ...BASE] },
  ],
  features: {
    subject: choice("Subject", ["math", "portuguese"]),
    studytime: int("Weekly study time", 1, 4),
    failures: int("Past class failures", 0, 3),
    absences: int("School absences", 0, 93),
    schoolsup: choice("Extra school support", ["yes", "no"]),
    activities: choice("Extracurricular activities", ["yes", "no"]),
    higher: choice("Wants higher education", ["yes", "no"]),
    G1: int("First period grade", 0, 20),
    G2: int("Second period grade", 0, 20),
  },
};

const RESULT: PredictionDetail = {
  id: 7, student_id: null, student_name: null, student_code: null, academic_record_id: null,
  stage: "period1", subject: "math", predicted_at_risk: true, risk_probability: 0.73, risk_level: "high",
  confidence: 0.73, predicted_grade: 8.42, grade_interval_low: 6.65, grade_interval_high: 10.19,
  is_demo: false, model_version: "1.0.0+test", actual_final_grade: null, created_at: "2026-11-08T10:00:00Z",
  input_features: { G1: 6 },
  contributions: [{ feature: "G1", label: "First period grade", value: 6, typical_value: 11, effect: 0.41, direction: "raises_risk" }],
  classifier_algorithm: "Random Forest", regressor_algorithm: "Random Forest", requested_by_name: "Test",
  history: [],
  recommendations: [{ id: 1, student_id: 1, prediction_id: 7, category: "tutoring", title: "Plan targeted help", message: "Go through recent work.", priority: "high", status: "open", source: "rule", shared_with_student: false, created_at: "2026-11-08T10:00:00Z" }],
  disclaimer: "This is an estimate, not a judgment.",
  estimates_disagree: false,
  pass_mark: 10,
};

describe("prediction page", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    signIn("educator");
    vi.spyOn(api, "get").mockImplementation(async (url) => ({ data: url === "/predictions/options" ? OPTIONS : {}, status: 200 }));
  });

  it("asks only for what is known at the chosen stage, and never for the final grade", async () => {
    renderApp(<NewPredictionPage />);
    expect(await screen.findByLabelText("First period grade")).toBeInTheDocument();
    expect(screen.queryByLabelText("Second period grade")).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("Point in the course"), "intake");
    expect(screen.queryByLabelText("First period grade")).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("Point in the course"), "period2");
    expect(screen.getByLabelText("Second period grade")).toBeInTheDocument();
    expect(screen.queryByLabelText(/final grade/i)).not.toBeInTheDocument();
  });

  it("sends typed values and shows the model output and disclaimer", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue({ data: RESULT });
    renderApp(<NewPredictionPage />);
    await userEvent.type(await screen.findByLabelText("First period grade"), "6");
    await userEvent.click(screen.getByRole("button", { name: "Run prediction" }));

    expect(await screen.findByText("This is an estimate, not a judgment.")).toBeInTheDocument();
    const [url, body] = post.mock.calls[0];
    expect(url).toBe("/predictions");
    expect(body).toMatchObject({ stage: "period1", student_id: null, academic_record_id: null });
    expect((body as { features: Record<string, unknown> }).features).toEqual({
      G1: 6, studytime: 2, failures: 0, absences: 0, subject: "math", schoolsup: "no", activities: "no", higher: "yes",
    });

    expect(screen.getAllByText("73%")).toHaveLength(2);
    expect(screen.getByText("8.4")).toBeInTheDocument();
    expect(screen.getByText("Higher concern")).toBeInTheDocument();
    const reason = screen.getByText(/First period grade: 6/).closest("li")!;
    expect(within(reason).getByText(/Raises concern by 41.0 points/)).toBeInTheDocument();
    expect(screen.getByText("Plan targeted help")).toBeInTheDocument();
  });

  it("explains when the grade and the flag point in different directions", async () => {
    vi.spyOn(api, "post").mockResolvedValue({
      data: { ...RESULT, predicted_at_risk: false, risk_level: "low", confidence: 0.6, estimates_disagree: true },
    });
    renderApp(<NewPredictionPage />);
    await userEvent.type(await screen.findByLabelText("First period grade"), "6");
    await userEvent.click(screen.getByRole("button", { name: "Run prediction" }));

    expect(await screen.findByText(/below the pass mark of 10, but this student is not flagged/)).toBeInTheDocument();
    expect(screen.getByText("Confidence in no flag")).toBeInTheDocument();
  });

  it("shows no disagreement note when the estimates agree", async () => {
    vi.spyOn(api, "post").mockResolvedValue({ data: RESULT });
    renderApp(<NewPredictionPage />);
    await userEvent.type(await screen.findByLabelText("First period grade"), "6");
    await userEvent.click(screen.getByRole("button", { name: "Run prediction" }));

    expect(await screen.findByText("Confidence in this flag")).toBeInTheDocument();
    expect(screen.queryByText(/two separate models/)).not.toBeInTheDocument();
  });

  it("shows the API message when the input is rejected", async () => {
    vi.spyOn(api, "post").mockRejectedValue(apiError(422, "First period grade must be between 0 and 20."));
    renderApp(<NewPredictionPage />);
    await userEvent.type(await screen.findByLabelText("First period grade"), "6");
    await userEvent.click(screen.getByRole("button", { name: "Run prediction" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("must be between 0 and 20");
  });

  it("fills the form from the student record and locks the subject", async () => {
    vi.spyOn(api, "get").mockImplementation(async (url) => ({
      status: 200,
      data: url === "/predictions/options" ? OPTIONS : {
        id: 3, student_code: "S-3", full_name: "Ana Example", email: null, year_group: null, is_demo: false,
        linked_user_email: null, latest_predictions: [], recommendations: [],
        records: [{ id: 9, student_id: 3, subject: "portuguese", academic_year: "2025/26", period1_grade: 14, period2_grade: 12, final_grade: null, absences: 5, study_time: 3, past_failures: 1, school_support: true, activities: false, wants_higher_education: true }],
      },
    }));
    const post = vi.spyOn(api, "post").mockResolvedValue({ data: RESULT });
    renderApp(<NewPredictionPage />, "/?student=3&record=9");

    expect(await screen.findByDisplayValue("14")).toBeInTheDocument();
    expect(screen.getByLabelText("Second period grade")).toHaveValue(12);
    expect(screen.getByLabelText("Subject")).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Run prediction" }));
    expect(post.mock.calls[0][1]).toMatchObject({ stage: "period2", student_id: 3, academic_record_id: 9 });
  });
});
