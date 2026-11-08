import { useState, type FormEvent } from "react";
import { api, errorMessage } from "../api/client";
import type { PlatformSettings, TokenResponse, User } from "../api/types";
import { useApi } from "../api/useApi";
import { Button, Card, CardTitle, CheckboxField, ErrorState, LoadingBlock, PageHeader, TextField } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { passwordProblem } from "./RegisterPage";

function ProfileForm() {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const [fullName, setFullName] = useState(user?.full_name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const emailChanged = email.trim().toLowerCase() !== user?.email;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.put<User>("/auth/me", {
        full_name: fullName.trim(),
        email: email.trim(),
        current_password: emailChanged ? currentPassword : null,
      });
      setUser(data);
      setCurrentPassword("");
      toast.success("Your profile was saved.");
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardTitle title="Profile" />
      <form onSubmit={submit} className="space-y-4">
        <TextField label="Full name" required maxLength={120} value={fullName} onChange={(e) => setFullName(e.target.value)} />
        <TextField label="Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        {emailChanged && <TextField label="Current password" type="password" autoComplete="current-password" required hint="Needed to change your email." value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <Button type="submit" busy={busy}>Save profile</Button>
      </form>
    </Card>
  );
}

function PasswordForm() {
  const { applyToken } = useAuth();
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [problems, setProblems] = useState<{ next?: string; confirm?: string }>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const found = {
      next: passwordProblem(next) ?? undefined,
      confirm: next !== confirm ? "The passwords do not match." : undefined,
    };
    setProblems(found);
    if (found.next || found.confirm) return;
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post<TokenResponse>("/auth/change-password", { current_password: current, new_password: next });
      applyToken(data);
      setCurrent("");
      setNext("");
      setConfirm("");
      toast.success("Your password was changed. Other sessions have been signed out.");
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardTitle title="Change password" subtitle="This signs you out on all other devices." />
      <form onSubmit={submit} className="space-y-4">
        <TextField label="Current password" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
        <TextField label="New password" type="password" autoComplete="new-password" required hint="At least 10 characters, with a letter and a number." error={problems.next} value={next} onChange={(e) => setNext(e.target.value)} />
        <TextField label="Confirm new password" type="password" autoComplete="new-password" required error={problems.confirm} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <Button type="submit" busy={busy}>Change password</Button>
      </form>
    </Card>
  );
}

function PlatformSettingsCard() {
  const toast = useToast();
  const { data, error, reload } = useApi<PlatformSettings>("/settings");
  const [saving, setSaving] = useState(false);

  const change = async (body: Partial<PlatformSettings>) => {
    setSaving(true);
    try {
      await api.put("/settings", body);
      toast.success("Setting saved.");
      reload();
    } catch (failure) {
      toast.error(errorMessage(failure));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardTitle title="Platform settings" subtitle="These apply to everyone." />
      {error ? <ErrorState message={error} onRetry={reload} /> : !data ? <LoadingBlock lines={2} /> : (
        <div className="space-y-4">
          <CheckboxField label="Allow public registration" hint="Anyone can create a student account. Staff accounts are always created by an admin." disabled={saving} checked={data.allow_public_registration} onChange={(e) => change({ allow_public_registration: e.target.checked })} />
          <CheckboxField label="Let educators manage datasets" hint="Educators can upload and import CSV files. Admins always can." disabled={saving} checked={data.educators_can_upload_datasets} onChange={(e) => change({ educators_can_upload_datasets: e.target.checked })} />
        </div>
      )}
    </Card>
  );
}

export default function SettingsPage() {
  const { user } = useAuth();
  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <ProfileForm />
        <PasswordForm />
        {user?.role === "admin" && <PlatformSettingsCard />}
      </div>
    </>
  );
}
