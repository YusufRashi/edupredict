import {
  BarChart3,
  BrainCircuit,
  CalendarCheck,
  FileText,
  LineChart,
  Lock,
  Scale,
  ShieldCheck,
  Sparkles,
  Target,
  Users,
} from "lucide-react";
import { Link, Navigate } from "react-router-dom";
import { Logo } from "../components/Layout";
import { buttonClass } from "../components/ui";
import { homeFor, useAuth } from "../context/AuthContext";

const FEATURES = [
  { icon: CalendarCheck, title: "A weekly support list", text: "Opens on who needs attention now, what changed, and which follow-ups are overdue." },
  { icon: Target, title: "Follow-through", text: "Record who is doing what by when, so that no student is flagged and then forgotten." },
  { icon: Sparkles, title: "Grade outlook", text: "Estimates the chance that a final course grade falls below the pass mark, with the likely grade range." },
  { icon: BrainCircuit, title: "Explained estimates", text: "Each result shows which inputs moved the estimate, and how sure the model is." },
  { icon: Users, title: "Student records", text: "Search, filter and manage students, grades and attendance in one place." },
  { icon: BarChart3, title: "Live analytics", text: "Grade distributions, subject comparisons and trends, calculated from your data." },
  { icon: FileText, title: "Reports", text: "Performance and support reports, ready to export as CSV or print." },
  { icon: Lock, title: "Role-based access", text: "Admins, educators and students each see only what they are allowed to see." },
];

const STEPS = [
  { title: "Keep records current", text: "Enter grades and absences by hand or import a validated CSV file." },
  { title: "See who needs attention", text: "The weekly list shows who is flagged, why, and what has changed." },
  { title: "Plan the support", text: "Use your own judgment, agree a step, and set who follows up by when." },
  { title: "Follow through", text: "Overdue steps rise to the top, and Results shows how flagged courses ended." },
];

const BENEFITS = [
  "See a short, prioritised list each week, rather than checking every student.",
  "Stop flagged students being forgotten, with an owner and a date for every step.",
  "See how far to trust a model, with its test results and limitations in plain view.",
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
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-5 py-10 lg:grid-cols-2 lg:py-16">
          <div>
            <p className="mb-3 text-sm font-medium text-brand">Student support, week by week</p>
            <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
              Know which students may need support, while you can still help.
            </h1>
            <p className="mt-5 max-w-2xl text-lg text-slate-brand">
              A teacher with 150 students can't watch all of them. EduPredict gives you a short
              weekly list of who needs attention and why, then helps make sure nobody is forgotten.
              The decisions stay with you.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/register" className={buttonClass()}>Create an account</Link>
              <Link to="/login" className={buttonClass("secondary")}>Log in</Link>
            </div>
          </div>
          <img src="/images/library.webp" alt="A student with a backpack walking between library shelves" className="aspect-[4/3] w-full rounded-3xl object-cover shadow-xl" />
        </section>

        <section aria-labelledby="features" className="bg-lavender py-16">
          <div className="mx-auto max-w-6xl px-5">
            <h2 id="features" className="text-2xl font-semibold tracking-tight">Key features</h2>
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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

        <section aria-labelledby="benefits" className="mx-auto grid max-w-6xl items-center gap-10 px-5 pb-16 lg:grid-cols-2">
          <img src="/images/teachers.webp" alt="Three colleagues talking around a table with laptops" loading="lazy" className="aspect-[4/3] w-full rounded-3xl object-cover shadow-xl" />
          <div>
            <h2 id="benefits" className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
              <LineChart className="size-6 text-brand" aria-hidden /> Benefits for educators
            </h2>
            <ul className="mt-5 space-y-3 text-slate-brand">
              {BENEFITS.map((benefit) => <li key={benefit}>{benefit}</li>)}
            </ul>
          </div>
        </section>

        <section aria-labelledby="responsible" className="bg-navy py-16 text-white">
          <div className="mx-auto max-w-6xl px-5">
            <div>
              <h2 id="responsible" className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
                <Scale className="size-6" aria-hidden /> Responsible by design
              </h2>
              <ul className="mt-5 grid gap-3 text-slate-300 sm:grid-cols-2">
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
