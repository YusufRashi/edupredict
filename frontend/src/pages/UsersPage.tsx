import { Plus } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { api, errorMessage } from "../api/client";
import type { Page, Role, User } from "../api/types";
import { useApi, useDebounced } from "../api/useApi";
import { Button, Card, ConfirmDialog, EmptyState, ErrorState, LoadingBlock, Modal, PageHeader, Pagination, Pill, SelectField, TD, Table, TextField } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { dateOnly } from "../format";
import { passwordProblem } from "./RegisterPage";

function CreateUserModal({ onClose, onSaved }: { onClose: () => void; onSaved: (user: User) => void }) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("educator");
  const [password, setPassword] = useState("");
  const [problem, setProblem] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const issue = passwordProblem(password);
    setProblem(issue ?? undefined);
    if (issue) return;
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post<User>("/users", { full_name: fullName.trim(), email: email.trim(), role, password });
      onSaved(data);
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  };

  return (
    <Modal title="Add user" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <TextField label="Full name" required maxLength={120} value={fullName} onChange={(e) => setFullName(e.target.value)} />
        <TextField label="Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <SelectField label="Role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
          <option value="educator">Educator</option><option value="student">Student</option><option value="admin">Admin</option>
        </SelectField>
        <TextField label="Temporary password" type="password" autoComplete="new-password" required hint="At least 10 characters, with a letter and a number. Ask them to change it after logging in." error={problem} value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" busy={busy}>Add user</Button>
        </div>
      </form>
    </Modal>
  );
}

export default function UsersPage() {
  const toast = useToast();
  const { user: me } = useAuth();
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("");
  const [active, setActive] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [deactivating, setDeactivating] = useState<User | null>(null);
  const [busy, setBusy] = useState(false);
  const q = useDebounced(query);

  useEffect(() => setPage(1), [q, role, active]);

  const { data, error, reload } = useApi<Page<User>>("/users", { q, role, is_active: active, page, page_size: 15 });

  const change = async (user: User, body: { role?: Role; is_active?: boolean }, done: string) => {
    setBusy(true);
    try {
      await api.put(`/users/${user.id}`, body);
      toast.success(done);
      setDeactivating(null);
      reload();
    } catch (failure) {
      toast.error(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Users" subtitle="Manage who can sign in, and what they can do." actions={<Button onClick={() => setCreating(true)}><Plus className="size-4" aria-hidden />Add user</Button>} />
      <Card>
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <TextField label="Search" placeholder="Name or email" value={query} onChange={(e) => setQuery(e.target.value)} />
          <SelectField label="Role" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">All</option><option value="admin">Admin</option><option value="educator">Educator</option><option value="student">Student</option>
          </SelectField>
          <SelectField label="Status" value={active} onChange={(e) => setActive(e.target.value)}>
            <option value="">All</option><option value="true">Active</option><option value="false">Deactivated</option>
          </SelectField>
        </div>
        {error ? <ErrorState message={error} onRetry={reload} /> : !data ? <LoadingBlock lines={8} /> : data.items.length === 0 ? <EmptyState title="No users match these filters" /> : (
          <>
            <Table head={["Name", "Email", "Role", "Status", "Joined", ""]}>
              {data.items.map((user) => (
                <tr key={user.id}>
                  <TD className="font-medium">{user.full_name}{user.id === me?.id && <span className="ml-2 text-xs font-normal text-slate-brand">(you)</span>}</TD>
                  <TD className="text-slate-brand">{user.email}</TD>
                  <TD>
                    <select
                      aria-label={`Role for ${user.full_name}`}
                      value={user.role}
                      disabled={busy}
                      onChange={(e) => change(user, { role: e.target.value as Role }, "Role updated.")}
                      className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
                    >
                      <option value="admin">Admin</option><option value="educator">Educator</option><option value="student">Student</option>
                    </select>
                  </TD>
                  <TD><Pill tone={user.is_active ? "green" : "slate"}>{user.is_active ? "Active" : "Deactivated"}</Pill></TD>
                  <TD className="whitespace-nowrap text-slate-brand">{dateOnly(user.created_at)}</TD>
                  <TD className="text-right">
                    {user.is_active ? (
                      user.id !== me?.id && <Button variant="ghost" onClick={() => setDeactivating(user)}>Deactivate</Button>
                    ) : (
                      <Button variant="ghost" onClick={() => change(user, { is_active: true }, "Account reactivated.")}>Reactivate</Button>
                    )}
                  </TD>
                </tr>
              ))}
            </Table>
            <Pagination page={data.page} pages={data.pages} total={data.total} onChange={setPage} />
          </>
        )}
      </Card>
      {creating && <CreateUserModal onClose={() => setCreating(false)} onSaved={(user) => { toast.success(`${user.full_name} was added.`); setCreating(false); reload(); }} />}
      {deactivating && (
        <ConfirmDialog
          title="Deactivate this account?"
          message={<><strong>{deactivating.full_name}</strong> will be signed out and will no longer be able to log in. You can reactivate the account later.</>}
          confirmLabel="Deactivate"
          busy={busy}
          onConfirm={() => change(deactivating, { is_active: false }, "Account deactivated.")}
          onCancel={() => setDeactivating(null)}
        />
      )}
    </>
  );
}
