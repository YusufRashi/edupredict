import type { ActionType, RiskLevel, StageKey, Subject } from "./api/types";

export const SUBJECT_LABELS: Record<Subject, string> = { math: "Mathematics", portuguese: "Portuguese" };
export const STAGE_LABELS: Record<StageKey, string> = {
  intake: "Start of course",
  period1: "After first period",
  period2: "After second period",
};
export const RISK_LABELS: Record<RiskLevel, string> = {
  low: "Lower concern",
  moderate: "Moderate concern",
  high: "Higher concern",
};
export const STUDY_TIME_LABELS: Record<number, string> = {
  1: "Under 2 hours",
  2: "2 to 5 hours",
  3: "5 to 10 hours",
  4: "Over 10 hours",
};

export const ACTION_LABELS: Record<ActionType, string> = {
  tutoring: "Tutoring",
  meeting: "One-to-one meeting",
  family_contact: "Contact family",
  attendance_plan: "Attendance plan",
  referral: "Refer to school support",
  other: "Other",
};

/** A date-only value from the API, shown without shifting across time zones. */
export const dueDate = (value: string): string =>
  new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { dateStyle: "medium" });

/** Today or a later day in the viewer's time zone, as YYYY-MM-DD. */
export const localDate = (daysAhead = 0): string => {
  const day = new Date();
  day.setDate(day.getDate() + daysAhead);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
};

export const percent = (value: number | null | undefined, digits = 0): string =>
  value === null || value === undefined ? "—" : `${(value * 100).toFixed(digits)}%`;

export const grade = (value: number | null | undefined, digits = 1): string =>
  value === null || value === undefined ? "—" : value.toFixed(digits);

export const dateTime = (value: string): string =>
  new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export const dateOnly = (value: string): string =>
  new Date(value).toLocaleDateString(undefined, { dateStyle: "medium" });

export const fileSize = (bytes: number): string =>
  bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** "student_code" becomes "Student code". */
export const columnLabel = (name: string): string => {
  const text = name.replaceAll("_", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
};

/** "report.risk.csv" becomes "Report risk csv". */
export const actionLabel = (action: string): string => columnLabel(action.replaceAll(".", " "));
