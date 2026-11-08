import { lazy, Suspense } from "react";
import { Link, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { buttonClass, LoadingCards } from "./components/ui";
import { LandingPage } from "./pages/LandingPage";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";

// Split by page, because the charting library is large and the landing page does not need it.
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const StudentsPage = lazy(() => import("./pages/StudentsPage"));
const StudentProfilePage = lazy(() => import("./pages/StudentProfilePage"));
const NewPredictionPage = lazy(() => import("./pages/NewPredictionPage"));
const PredictionsPage = lazy(() => import("./pages/PredictionsPage"));
const PredictionDetailPage = lazy(() => import("./pages/PredictionDetailPage"));
const AnalyticsPage = lazy(() => import("./pages/AnalyticsPage"));
const ModelPage = lazy(() => import("./pages/ModelPage"));
const ReportsPage = lazy(() => import("./pages/ReportsPage"));
const DatasetsPage = lazy(() => import("./pages/DatasetsPage"));
const UsersPage = lazy(() => import("./pages/UsersPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const StudentPortalPage = lazy(() => import("./pages/StudentPortalPage"));

function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-sm text-slate-brand">That page does not exist, or it has moved.</p>
      <Link to="/" className={buttonClass()}>Go to the home page</Link>
    </div>
  );
}

export function App() {
  return (
    <Suspense fallback={<div className="p-8"><LoadingCards /></div>}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />

        <Route element={<ProtectedRoute />}>
          <Route element={<Layout />}>
            <Route path="/settings" element={<SettingsPage />} />

            <Route element={<ProtectedRoute roles={["student"]} />}>
              <Route path="/my-progress" element={<StudentPortalPage />} />
            </Route>

            <Route element={<ProtectedRoute roles={["admin", "educator"]} />}>
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/students" element={<StudentsPage />} />
              <Route path="/students/:id" element={<StudentProfilePage />} />
              <Route path="/predictions" element={<PredictionsPage />} />
              <Route path="/predictions/new" element={<NewPredictionPage />} />
              <Route path="/predictions/:id" element={<PredictionDetailPage />} />
              <Route path="/analytics" element={<AnalyticsPage />} />
              <Route path="/model" element={<ModelPage />} />
              <Route path="/reports" element={<ReportsPage />} />
              <Route path="/datasets" element={<DatasetsPage />} />
            </Route>

            <Route element={<ProtectedRoute roles={["admin"]} />}>
              <Route path="/users" element={<UsersPage />} />
            </Route>
          </Route>
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}
