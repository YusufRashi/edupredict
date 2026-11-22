import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { api, errorMessage } from "../api/client";
import { Button, Notice, TextField } from "../components/ui";
import { homeFor, useAuth } from "../context/AuthContext";
import { AuthShell } from "./LoginPage";

/** Mirrors the API's rule, so most mistakes are caught before a request is sent. */
export function passwordProblem(password: string): string | null {
  if (password.length < 10) return "Use at least 10 characters.";
  if (new TextEncoder().encode(password).length > 72) return "Use at most 72 bytes.";
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return "Include a letter and a number.";
  return null;
}

export function RegisterPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ password?: string; confirm?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={homeFor(user)} replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const problems = {
      password: passwordProblem(password) ?? undefined,
      confirm: password !== confirm ? "The passwords do not match." : undefined,
    };
    setFieldErrors(problems);
    if (problems.password || problems.confirm) return;
    setBusy(true);
    try {
      await api.post("/auth/register", { email: email.trim(), full_name: fullName.trim(), password });
      navigate("/login", { state: { registered: true } });
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Create an account" subtitle="Register as a student. Administrators create educator accounts." image="/images/desk.webp" imagePosition="28% center">
      <form onSubmit={submit} className="space-y-4" noValidate={false}>
        <TextField label="Full name" autoComplete="name" required maxLength={120} value={fullName} onChange={(e) => setFullName(e.target.value)} />
        <TextField label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <TextField label="Password" type="password" autoComplete="new-password" required hint="At least 10 characters, with a letter and a number." error={fieldErrors.password} value={password} onChange={(e) => setPassword(e.target.value)} />
        <TextField label="Confirm password" type="password" autoComplete="new-password" required error={fieldErrors.confirm} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <Notice>Your account starts unlinked. Your school connects it to your student record, and your grades then appear.</Notice>
        <Button type="submit" busy={busy} className="w-full">Create account</Button>
      </form>
      <p className="mt-5 text-center text-sm text-slate-brand">
        Already registered? <Link to="/login" className="font-medium text-brand hover:underline">Log in</Link>
      </p>
    </AuthShell>
  );
}
