export type Role = "admin" | "educator" | "student";
export type Subject = "math" | "portuguese";
export type RiskLevel = "low" | "moderate" | "high";
export type StageKey = "intake" | "period1" | "period2";
export type Priority = "low" | "medium" | "high";

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
}

export interface User {
  id: number;
  email: string;
  full_name: string;
  role: Role;
  is_active: boolean;
  created_at: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  user: User;
}

export interface AcademicRecord {
  id: number;
  student_id: number;
  subject: Subject;
  academic_year: string;
  period1_grade: number | null;
  period2_grade: number | null;
  final_grade: number | null;
  absences: number;
  study_time: number;
  past_failures: number;
  school_support: boolean;
  activities: boolean;
  wants_higher_education: boolean;
}

export interface StudentListItem {
  id: number;
  student_code: string;
  full_name: string;
  year_group: string | null;
  is_demo: boolean;
  subjects: Subject[];
  average_final_grade: number | null;
  highest_risk: RiskLevel | null;
}

export interface Recommendation {
  id: number;
  student_id: number;
  prediction_id: number | null;
  category: string;
  title: string;
  message: string;
  priority: Priority;
  status: "open" | "completed";
  source: "rule" | "educator";
  shared_with_student: boolean;
  created_at: string;
}

export interface PredictionSummary {
  id: number;
  student_id: number | null;
  student_name: string | null;
  student_code: string | null;
  academic_record_id: number | null;
  stage: StageKey;
  subject: Subject;
  predicted_at_risk: boolean;
  risk_probability: number;
  risk_level: RiskLevel;
  confidence: number;
  predicted_grade: number;
  grade_interval_low: number;
  grade_interval_high: number;
  is_demo: boolean;
  model_version: string;
  actual_final_grade: number | null;
  created_at: string;
}

export interface Contribution {
  feature: string;
  label: string;
  value: string | number;
  typical_value: string | number;
  effect: number;
  direction: "raises_risk" | "lowers_risk" | "neutral";
}

export interface PredictionDetail extends PredictionSummary {
  input_features: Record<string, string | number>;
  contributions: Contribution[];
  classifier_algorithm: string;
  regressor_algorithm: string;
  requested_by_name: string | null;
  history: { action: string; actor_name: string | null; note: string | null; created_at: string }[];
  recommendations: Recommendation[];
  disclaimer: string;
  estimates_disagree: boolean;
  pass_mark: number;
}

export interface StudentDetail {
  id: number;
  student_code: string;
  full_name: string;
  email: string | null;
  year_group: string | null;
  is_demo: boolean;
  linked_user_email: string | null;
  records: AcademicRecord[];
  latest_predictions: PredictionSummary[];
  recommendations: Recommendation[];
}

export interface FeatureSpec {
  label: string;
  kind: "int" | "choice";
  help: string;
  minimum: number | null;
  maximum: number | null;
  choices: string[];
}

export interface PredictionOptions {
  stages: { key: StageKey; label: string; description: string; features: string[] }[];
  features: Record<string, FeatureSpec>;
}

export interface Overview {
  total_students: number;
  demo_students: number;
  total_records: number;
  total_predictions: number;
  demo_predictions: number;
  students_needing_attention: number;
  average_final_grade: number | null;
  final_grades_recorded: number;
  pass_rate: number | null;
  pass_mark: number;
  risk_distribution: Record<RiskLevel, number>;
}

export interface SubjectPerformance {
  subject: Subject;
  records: number;
  average_period1: number | null;
  average_period2: number | null;
  average_final: number | null;
  final_grades_recorded: number;
  pass_rate: number | null;
  average_absences: number | null;
}

export interface Performance {
  pass_mark: number;
  subjects: SubjectPerformance[];
}

export interface Distribution {
  pass_mark: number;
  grades: { grade: number; math: number; portuguese: number }[];
  risk_distribution: Record<RiskLevel, number>;
}

export interface Trends {
  grades_by_period: { period: string; math?: number | null; portuguese?: number | null }[];
  predictions_per_day: { date: string; count: number }[];
}

export interface SystemOverview {
  users_by_role: Record<Role, number>;
  active_users: number;
  datasets: number;
  database_status: string;
  active_models: {
    version: string;
    stage: StageKey;
    classifier: string;
    regressor: string;
    trained_at: string;
  }[];
  recent_activity: {
    id: number;
    action: string;
    actor: string;
    entity_type: string | null;
    entity_id: string | null;
    created_at: string;
  }[];
}

export interface ClassifierScores {
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
  roc_auc: number;
  pr_auc: number;
  brier: number;
}

export interface RegressorScores {
  mae: number;
  mse: number;
  rmse: number;
  r2: number;
}

export interface ModelInfo {
  version: string;
  trained_at: string;
  dataset: {
    name: string;
    source: string;
    url: string;
    doi: string;
    licence: string;
    citation: string;
    context: string;
    sha256: string;
    cleaning: {
      rows_after_cleaning: number;
      missing_values: number;
      exact_duplicates_removed: number;
      distinct_student_groups: number;
      rows_by_subject: Record<string, number>;
    };
    splits: Record<string, { rows: number; student_groups: number; at_risk_rate: number }>;
    split_method: string;
  };
  target: { description: string; pass_mark: number; positive_class: string };
  feature_policy: {
    excluded: Record<string, string>;
    specs: Record<string, FeatureSpec>;
  };
  limitations: string[];
  stages: {
    key: StageKey;
    label: string;
    description: string;
    features: string[];
    classifier_algorithm: string;
    regressor_algorithm: string;
    risk_bands: { moderate_from: number; high_from: number };
    classifier_test: ClassifierScores;
    regressor_test: RegressorScores;
  }[];
}

export interface ModelComparison<S> {
  algorithm: string;
  best_params: Record<string, unknown>;
  cv_mean: number;
  cv_std: number;
  validation: S;
  selection_score: number;
  selected: boolean;
}

export interface FairnessGroup {
  group: string;
  n: number;
  actual_below_pass: number;
  actual_below_pass_rate: number;
  flagged_rate: number;
  recall: number | null;
  false_positive_rate: number | null;
  precision: number | null;
  grade_mae: number;
  small_sample: boolean;
}

export interface ModelMetrics {
  stage: StageKey;
  version: string;
  label: string;
  description: string;
  classifier: {
    algorithm: string;
    selection_metric: string;
    comparison: ModelComparison<ClassifierScores>[];
    risk_bands: { moderate_from: number; high_from: number };
    test: ClassifierScores;
    baseline_test: ClassifierScores;
    all_features_benchmark_test: ClassifierScores;
    confusion_matrix: { tn: number; fp: number; fn: number; tp: number };
    roc_curve: { fpr: number; tpr: number }[];
    calibration: { predicted: number; observed: number }[];
    band_outcomes: { level: RiskLevel; students: number; observed_below_pass_rate: number | null }[];
    feature_importance: { feature: string; label: string; importance: number; std: number }[];
  };
  regressor: {
    algorithm: string;
    selection_metric: string;
    comparison: ModelComparison<RegressorScores>[];
    interval_half_width_80: number;
    interval_coverage_test: number;
    test: RegressorScores;
    baseline_test: RegressorScores;
    actual_vs_predicted: { actual: number; predicted: number }[];
  };
  fairness: { attribute: string; groups: FairnessGroup[] }[];
}

export interface Report {
  title: string;
  generated_at: string;
  generated_by: string;
  disclaimer: string;
  pass_mark: number;
  total: number;
  demo_rows: number;
  columns: string[];
  rows: Record<string, string | number | null>[];
}

export type ActionType = "tutoring" | "meeting" | "family_contact" | "attendance_plan" | "referral" | "other";
export type ActionStatus = "planned" | "done" | "cancelled";
export type WatchState = "overdue" | "needs_action" | "in_progress" | "followed_up";

export interface SupportAction {
  id: number;
  student_id: number;
  student_name: string;
  student_code: string;
  is_demo: boolean;
  subject: Subject;
  prediction_id: number | null;
  action_type: ActionType;
  note: string | null;
  status: ActionStatus;
  due_date: string;
  is_overdue: boolean;
  owner_id: number | null;
  owner_name: string | null;
  outcome_note: string | null;
  completed_at: string | null;
  created_by_name: string | null;
  created_at: string;
}

export interface WatchItem {
  student_id: number;
  student_name: string;
  student_code: string;
  year_group: string | null;
  is_demo: boolean;
  subject: Subject;
  prediction_id: number;
  risk_level: RiskLevel;
  risk_probability: number;
  predicted_grade: number;
  assessed_at: string;
  state: WatchState;
  reasons: string[];
  changes: { direction: "worse" | "better"; text: string }[];
  next_action: SupportAction | null;
  actions_done: number;
}

export interface Watchlist extends Page<WatchItem> {
  counts: Record<WatchState, number>;
}

export interface OutcomeGroup {
  courses: number;
  finals_known: number;
  passed: number;
  pass_rate: number | null;
  small_group: boolean;
}

export interface SupportResults {
  pass_mark: number;
  include_demo: boolean;
  flagged_courses: number;
  demo_courses: number;
  actions: { total: number; planned: number; overdue: number; done: number; cancelled: number };
  with_completed_action: OutcomeGroup;
  without_completed_action: OutcomeGroup;
}

export interface StaffMember {
  id: number;
  full_name: string;
}

export interface PlatformSettings {
  allow_public_registration: boolean;
  educators_can_upload_datasets: boolean;
}

export interface Dataset {
  id: number;
  name: string;
  original_filename: string;
  size_bytes: number;
  row_count: number;
  column_count: number;
  status: "validated" | "rejected" | "processed";
  validation_report: {
    valid: boolean;
    file_error: string | null;
    error_count: number;
    errors: { line: number; column: string; message: string }[];
    profile?: {
      distinct_students: number;
      subjects: Record<string, number>;
      missing_by_column: Record<string, number>;
      final_grades_present: number;
      average_final_grade: number | null;
    };
  };
  processing_summary: Record<string, number> | null;
  created_at: string;
  processed_at: string | null;
  uploaded_by_name: string | null;
}
