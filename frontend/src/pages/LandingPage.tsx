import {
  BarChart3,
  BrainCircuit,
  FileText,
  LineChart,
  Lock,
  Scale,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { Link, Navigate } from "react-router-dom";
import { Logo } from "../components/Layout";
import { buttonClass } from "../components/ui";
import { homeFor, useAuth } from "../context/AuthContext";

const FEATURES = [
  { icon: Sparkles, title: "Grade outlook", text: "Estimates the chance that a final course grade falls below the pass mark, with the likely grade range." },
  { icon: BrainCircuit, title: "Explained estimates", text: "Each result shows which inputs moved the estimate, and how sure the model is." },
  { icon: Users, title: "Student records", text: "Search, filter and manage students, grades and attendance in one place." },
  { icon: BarChart3, title: "Live analytics", text: "Grade distributions, subject comparisons and trends, calculated from your data." },
  { icon: FileText, title: "Reports", text: "Performance and support reports, ready to export as CSV or print." },
  { icon: Lock, title: "Role-based access", text: "Admins, educators and students each see only what they are allowed to see." },
];

const STEPS = [
  { title: "Add academic records", text: "Enter students by hand or import a validated CSV file." },
  { title: "Run a prediction", text: "Choose the point in the course. The model uses only what is known by then." },
  { title: "Review the estimate", text: "See the estimate, its uncertainty, and what contributed to it." },
  { title: "Decide on support", text: "Use your own judgment, record a review, and share suggestions with the student." },
];

const BENEFITS = [
  "Spot students who may need support while there is still time to help.",
  "See how far to trust a model, with its test results and limitations in plain view.",
  "Keep a record of who ran which prediction, and of your own review alongside it.",
];

export function LandingPage() {
  const { user } = useAuth();
  if (user) return <Navigate to={homeFor(user)} replace />;

  return (
    <div className="bg-white">
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-3 p-5">
        <Logo />
        <nav aria-label="Account" className="flex items-center gap-2">
          <Link to="/login" className={buttonClass("ghost")}>Log in</Link>
          <Link to="/register" className={buttonClass()}>Register</Link>
        </nav>
      </header>

      <main>
        <section className="mx-auto max-w-6xl px-5 py-16 sm:py-24">
          <p className="mb-3 text-sm font-medium text-brand">Student performance analytics</p>
          <h1 className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">
            Know which students may need support, while you can still help.
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-slate-brand">
            EduPredict analyses academic records with machine learning, and gives educators an
            explained estimate of each student's course outcome. The decision stays with you.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/register" className={buttonClass()}>Create an account</Link>
            <Link to="/login" className={buttonClass("secondary")}>Log in</Link>
          </div>
        </section>

        <section aria-labelledby="features" className="bg-lavender py-16">
          <div className="mx-auto max-w-6xl px-5">
            <h2 id="features" className="text-2xl font-semibold tracking-tight">Key features</h2>
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(({ icon: Icon, title, text }) => (
                <div key={title} className="rounded-2xl bg-white p-5 shadow-card">
                  <Icon className="size-5 text-brand" aria-hidden />
                  <h3 className="mt-3 font-semibold">{title}</h3>
                  <p className="mt-1 text-sm text-slate-brand">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section aria-labelledby="how" className="mx-auto max-w-6xl px-5 py-16">
          <h2 id="how" className="text-2xl font-semibold tracking-tight">How it works</h2>
          <ol className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, index) => (
              <li key={step.title}>
                <span className="flex size-8 items-center justify-center rounded-full bg-brand text-sm font-semibold text-white">{index + 1}</span>
                <h3 className="mt-3 font-semibold">{step.title}</h3>
                <p className="mt-1 text-sm text-slate-brand">{step.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="benefits" className="bg-navy py-16 text-white">
          <div className="mx-auto grid max-w-6xl gap-10 px-5 lg:grid-cols-2">
            <div>
              <h2 id="benefits" className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
                <LineChart className="size-6" aria-hidden /> Benefits for educators
              </h2>
              <ul className="mt-5 space-y-3 text-slate-300">
                {BENEFITS.map((benefit) => <li key={benefit}>{benefit}</li>)}
              </ul>
            </div>
            <div>
              <h2 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
                <Scale className="size-6" aria-hidden /> Responsible by design
              </h2>
              <ul className="mt-5 space-y-3 text-slate-300">
                <li>Estimates support educators' decisions. They are not judgments about students.</li>
                <li>The model predicts a final grade below the pass mark. It does not predict dropout.</li>
                <li>Sex, age, family background and other sensitive details are not model inputs.</li>
                <li>Historical data can carry bias, so fairness results by group are published in the app.</li>
              </ul>
            </div>
          </div>
        </section>
      </main>

      <footer className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 p-5 text-sm text-slate-brand">
        <span className="flex items-center gap-2"><ShieldCheck className="size-4" aria-hidden /> Model trained on the UCI Student Performance dataset (CC BY 4.0).</span>
      </footer>
    </div>
  );
}
