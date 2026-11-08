import {
  AlertCircle,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  FlaskConical,
  Inbox,
  Info,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  X,
} from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import type { RiskLevel } from "../api/types";
import { RISK_LABELS } from "../format";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-slate-200/70 bg-white p-5 shadow-card ${className}`}>{children}</section>;
}

export function CardTitle({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <h2 className="text-base font-semibold">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-slate-brand">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-sm text-slate-brand">{subtitle}</p>}
      </div>
      {actions && <div className="no-print flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

const BUTTON_STYLES = {
  primary: "bg-brand text-white hover:bg-brand-dark",
  secondary: "border border-slate-300 bg-white text-navy hover:bg-slate-50",
  danger: "bg-red-700 text-white hover:bg-red-800",
  ghost: "text-slate-brand hover:bg-lavender hover:text-navy",
};

export const buttonClass = (variant: keyof typeof BUTTON_STYLES = "primary") =>
  `inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${BUTTON_STYLES[variant]}`;

export function Button({
  variant = "primary",
  busy = false,
  children,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof BUTTON_STYLES; busy?: boolean }) {
  return (
    <button type="button" {...props} disabled={props.disabled || busy} className={`${buttonClass(variant)} ${className}`}>
      {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

const CONTROL = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-navy placeholder:text-slate-400 focus:border-brand disabled:bg-slate-100 aria-invalid:border-red-600";

function FieldShell({ label, hint, error, id, children }: { label: string; hint?: string; error?: string; id: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">{label}</label>
      {children}
      {hint && !error && <p id={`${id}-hint`} className="mt-1 text-xs text-slate-brand">{hint}</p>}
      {error && <p id={`${id}-error`} className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  );
}

const describedBy = (id: string, hint?: string, error?: string) =>
  error ? `${id}-error` : hint ? `${id}-hint` : undefined;

export function TextField({ label, hint, error, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string }) {
  const id = useId();
  return (
    <FieldShell {...{ label, hint, error, id }}>
      <input {...props} id={id} aria-invalid={!!error} aria-describedby={describedBy(id, hint, error)} className={CONTROL} />
    </FieldShell>
  );
}

export function SelectField({ label, hint, error, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { label: string; hint?: string; error?: string }) {
  const id = useId();
  return (
    <FieldShell {...{ label, hint, error, id }}>
      <select {...props} id={id} aria-invalid={!!error} aria-describedby={describedBy(id, hint, error)} className={CONTROL}>
        {children}
      </select>
    </FieldShell>
  );
}

export function TextAreaField({ label, hint, error, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; hint?: string; error?: string }) {
  const id = useId();
  return (
    <FieldShell {...{ label, hint, error, id }}>
      <textarea {...props} id={id} aria-invalid={!!error} aria-describedby={describedBy(id, hint, error)} className={CONTROL} />
    </FieldShell>
  );
}

export function CheckboxField({ label, hint, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 text-sm">
      <input {...props} type="checkbox" className="mt-0.5 size-4 accent-brand" />
      <span>
        <span className="font-medium">{label}</span>
        {hint && <span className="block text-xs text-slate-brand">{hint}</span>}
      </span>
    </label>
  );
}

export function Skeleton({ className = "h-4 w-full" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-slate-200/70 ${className}`} aria-hidden />;
}

export function LoadingCards({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" role="status" aria-label="Loading">
      {Array.from({ length: count }, (_, index) => (
        <Card key={index}>
          <Skeleton className="mb-3 h-3 w-1/2" />
          <Skeleton className="h-8 w-2/3" />
        </Card>
      ))}
    </div>
  );
}

export function LoadingBlock({ lines = 5 }: { lines?: number }) {
  return (
    <div className="space-y-3" role="status" aria-label="Loading">
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} />
      ))}
    </div>
  );
}

export function EmptyState({ title, message, action }: { title: string; message?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      <Inbox className="size-8 text-slate-400" aria-hidden />
      <p className="font-medium">{title}</p>
      {message && <p className="max-w-md text-sm text-slate-brand">{message}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-2 py-10 text-center">
      <AlertCircle className="size-8 text-red-700" aria-hidden />
      <p className="max-w-md text-sm">{message}</p>
      {onRetry && <Button variant="secondary" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

const RISK_STYLE: Record<RiskLevel, { className: string; Icon: typeof ShieldCheck }> = {
  low: { className: "bg-green-50 text-green-800 ring-green-600/20", Icon: ShieldCheck },
  moderate: { className: "bg-amber-50 text-amber-900 ring-amber-600/30", Icon: AlertTriangle },
  high: { className: "bg-red-50 text-red-800 ring-red-600/20", Icon: ShieldAlert },
};

/** Always an icon and a word, so that the level is never carried by color alone. */
export function RiskBadge({ level }: { level: RiskLevel }) {
  const { className, Icon } = RISK_STYLE[level];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset ${className}`}>
      <Icon className="size-3" aria-hidden />
      {RISK_LABELS[level]}
    </span>
  );
}

export function DemoBadge() {
  return (
    <span title="Demonstration data, not a real student at your institution" className="inline-flex items-center gap-1 rounded-full bg-lavender px-2 py-0.5 text-xs font-medium whitespace-nowrap text-brand-dark">
      <FlaskConical className="size-3" aria-hidden />
      Demo
    </span>
  );
}

export function Pill({ children, tone = "slate" }: { children: ReactNode; tone?: "slate" | "green" | "amber" | "red" | "brand" }) {
  const tones = {
    slate: "bg-slate-100 text-slate-700",
    green: "bg-green-50 text-green-800",
    amber: "bg-amber-50 text-amber-900",
    red: "bg-red-50 text-red-800",
    brand: "bg-lavender text-brand-dark",
  };
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${tones[tone]}`}>{children}</span>;
}

export function Notice({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warning" }) {
  const Icon = tone === "info" ? Info : AlertTriangle;
  const style = tone === "info" ? "border-brand/20 bg-lavender" : "border-amber-300 bg-amber-50";
  return (
    <div className={`flex items-start gap-2.5 rounded-xl border p-3 text-sm ${style}`}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div>{children}</div>
    </div>
  );
}

export function StatCard({ label, value, hint, icon }: { label: string; value: ReactNode; hint?: string; icon?: ReactNode }) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-slate-brand">{label}</p>
        {icon && <span className="rounded-lg bg-lavender p-2 text-brand">{icon}</span>}
      </div>
      <p className="mt-1 text-3xl font-semibold tracking-tight">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-brand">{hint}</p>}
    </Card>
  );
}

export function Pagination({ page, pages, total, onChange }: { page: number; pages: number; total: number; onChange: (page: number) => void }) {
  return (
    <nav aria-label="Pagination" className="no-print mt-4 flex items-center justify-between gap-3 text-sm text-slate-brand">
      <span>{total.toLocaleString()} {total === 1 ? "result" : "results"}</span>
      <div className="flex items-center gap-2">
        <Button variant="secondary" disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="Previous page">
          <ChevronLeft className="size-4" aria-hidden />
        </Button>
        <span>Page {page} of {Math.max(pages, 1)}</span>
        <Button variant="secondary" disabled={page >= pages} onClick={() => onChange(page + 1)} aria-label="Next page">
          <ChevronRight className="size-4" aria-hidden />
        </Button>
      </div>
    </nav>
  );
}

export function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
    // Only on open and close: onClose often changes identity on each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-navy/50 p-4 sm:items-center">
      <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} className={`w-full rounded-2xl bg-white p-6 shadow-xl outline-none ${wide ? "max-w-2xl" : "max-w-md"}`}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 id={titleId} className="text-lg font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="cursor-pointer text-slate-brand hover:text-navy">
            <X className="size-5" aria-hidden />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  busy,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal title={title} onClose={onCancel}>
      <div className="text-sm text-slate-brand">{message}</div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button variant="danger" busy={busy} onClick={onConfirm}>{confirmLabel}</Button>
      </div>
    </Modal>
  );
}

export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs text-slate-brand">
            {head.map((cell, index) => (
              <th key={index} scope="col" className="px-3 py-2 font-medium whitespace-nowrap">{cell}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
  );
}

export const TD = ({ children, className = "" }: { children?: ReactNode; className?: string }) => (
  <td className={`px-3 py-2.5 ${className}`}>{children}</td>
);
