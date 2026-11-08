import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { errorMessage } from "../api/client";
import { Logo } from "../components/Layout";
import { Button, Notice, TextField } from "../components/ui";
import { homeFor, useAuth } from "../context/AuthContext";

export function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-lavender p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-card">
        <Link to="/" aria-label="EduPredict home"><Logo /></Link>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 mb-6 text-sm text-slate-brand">{subtitle}</p>
        {children}
      </div>
    </main>
  );
}

export function LoginPage() {
  const { user, login, sessionExpired } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const from = (location.state as { from?: string } | null)?.from;

  if (user && !busy) return <Navigate to={from ?? homeFor(user)} replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const signedIn = await login(email.trim(), password);
      navigate(from ?? homeFor(signedIn), { replace: true });
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Log in" subtitle="Welcome back to EduPredict.">
      <form onSubmit={submit} className="space-y-4">
        {sessionExpired && <Notice tone="warning">Your session has ended. Please log in again.</Notice>}
        {location.state && (location.state as { registered?: boolean }).registered && (
          <Notice>Your account is ready. Log in to continue.</Notice>
        )}
        <TextField label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <TextField label="Password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <Button type="submit" busy={busy} className="w-full">Log in</Button>
      </form>
      <p className="mt-5 text-center text-sm text-slate-brand">
        New here? <Link to="/register" className="font-medium text-brand hover:underline">Create an account</Link>
      </p>
    </AuthShell>
  );
}
