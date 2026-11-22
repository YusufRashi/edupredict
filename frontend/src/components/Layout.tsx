import {
  BarChart3,
  BrainCircuit,
  CalendarCheck,
  ChevronDown,
  Database,
  FileText,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  Sparkles,
  Target,
  UserCog,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { Suspense, useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import type { Role } from "../api/types";
import { homeFor, useAuth } from "../context/AuthContext";
import { Avatar, LoadingCards } from "./ui";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  roles: Role[];
}

const STAFF: Role[] = ["admin", "educator"];

// The pages used every week stay on the bar. Everything else is one click further, under More.
const PRIMARY: NavItem[] = [
  { to: "/this-week", label: "This week", icon: CalendarCheck, roles: STAFF },
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: STAFF },
  { to: "/my-progress", label: "My progress", icon: GraduationCap, roles: ["student"] },
  { to: "/students", label: "Students", icon: Users, roles: STAFF },
  { to: "/predictions", label: "Predictions", icon: Sparkles, roles: STAFF },
  { to: "/results", label: "Results", icon: Target, roles: STAFF },
];

const MORE: NavItem[] = [
  { to: "/analytics", label: "Analytics", icon: BarChart3, roles: STAFF },
  { to: "/model", label: "Model Information", icon: BrainCircuit, roles: STAFF },
  { to: "/reports", label: "Reports", icon: FileText, roles: STAFF },
  { to: "/datasets", label: "Datasets", icon: Database, roles: STAFF },
  { to: "/users", label: "Users", icon: UserCog, roles: ["admin"] },
];

export function Logo() {
  return (
    <span className="flex items-center gap-2 text-lg font-semibold tracking-tight text-navy">
      <img src="/favicon.svg" alt="" className="size-7" />
      EduPredict
    </span>
  );
}

const PANEL = "absolute z-40 mt-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl";

function menuLink({ isActive }: { isActive: boolean }) {
  return `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${isActive ? "bg-lavender font-medium text-brand-dark" : "text-slate-700 hover:bg-slate-100"}`;
}

/** A button that opens a panel, which closes on an outside click or Escape. */
function Dropdown({ label, button, buttonClass, panelClass, children }: {
  label?: string;
  button: React.ReactNode;
  buttonClass: string;
  panelClass: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button type="button" aria-label={label} aria-expanded={open} onClick={() => setOpen(!open)} className={buttonClass}>
        {button}
      </button>
      {/* Closes on any choice, including the page already open, where the route does not change. */}
      {open && <div onClick={() => setOpen(false)} className={`${PANEL} ${panelClass}`}>{children}</div>}
    </div>
  );
}

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => setMobileOpen(false), [pathname]);

  if (!user) return null;
  const primary = PRIMARY.filter((item) => item.roles.includes(user.role));
  const more = MORE.filter((item) => item.roles.includes(user.role));
  const moreActive = more.some((item) => pathname.startsWith(item.to));

  const signOut = () => {
    // The local session ends even if the server cannot be reached.
    logout().catch(() => {}).finally(() => navigate("/login"));
  };

  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:rounded focus:bg-white focus:p-2">Skip to content</a>

      {/* The solid backing stops page content showing through the gap around the floating bar. */}
      <div className="no-print sticky top-0 z-30 bg-[#f1f2fa] px-4 py-3 sm:px-6 lg:px-8">
        <header className="mx-auto max-w-7xl rounded-2xl border border-slate-200/70 bg-white px-4 py-2 shadow-card lg:rounded-full">
          <div className="flex items-center justify-between gap-4">
            <Link to={homeFor(user)} aria-label="EduPredict home" className="shrink-0"><Logo /></Link>

            <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
              {primary.map(({ to, label }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) => `rounded-full px-3.5 py-1.5 text-sm whitespace-nowrap transition-colors ${isActive ? "bg-lavender font-medium text-brand-dark" : "text-slate-700 hover:bg-slate-100"}`}
                >
                  {label}
                </NavLink>
              ))}
              {more.length > 0 && (
                <Dropdown
                  button={<>More <ChevronDown className="size-4" aria-hidden /></>}
                  buttonClass={`flex cursor-pointer items-center gap-1 rounded-full px-3.5 py-1.5 text-sm transition-colors ${moreActive ? "bg-lavender font-medium text-brand-dark" : "text-slate-700 hover:bg-slate-100"}`}
                  panelClass="left-0 w-60"
                >
                  {more.map(({ to, label, icon: Icon }) => (
                    <NavLink key={to} to={to} className={menuLink}>
                      <Icon className="size-4" aria-hidden />
                      {label}
                    </NavLink>
                  ))}
                </Dropdown>
              )}
            </nav>

            <div className="hidden items-center gap-2 lg:flex">
              <NavLink to="/settings" aria-label="Settings" className={({ isActive }) => `rounded-full border p-2 transition-colors ${isActive ? "border-brand bg-lavender text-brand-dark" : "border-slate-200 text-slate-700 hover:bg-slate-100"}`}>
                <Settings className="size-4" aria-hidden />
              </NavLink>
              <Dropdown
                label="Account menu"
                button={<><Avatar name={user.full_name} /><ChevronDown className="size-4 text-slate-500" aria-hidden /></>}
                buttonClass="flex cursor-pointer items-center gap-1 rounded-full"
                panelClass="right-0 w-64"
              >
                <div className="border-b border-slate-100 px-3 py-2">
                  <p className="truncate text-sm font-medium">{user.full_name}</p>
                  <p className="truncate text-xs text-slate-brand">{user.email}</p>
                  <p className="text-xs text-slate-brand capitalize">{user.role}</p>
                </div>
                <button type="button" onClick={signOut} className="mt-1 flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-100">
                  <LogOut className="size-4" aria-hidden />
                  Log out
                </button>
              </Dropdown>
            </div>

            <button type="button" onClick={() => setMobileOpen(!mobileOpen)} aria-label={mobileOpen ? "Close menu" : "Open menu"} aria-expanded={mobileOpen} className="cursor-pointer p-1 text-navy lg:hidden">
              {mobileOpen ? <X className="size-6" aria-hidden /> : <Menu className="size-6" aria-hidden />}
            </button>
          </div>

          {mobileOpen && (
            <nav aria-label="Mobile" onClick={() => setMobileOpen(false)} className="mt-2 max-h-[calc(100vh-6rem)] overflow-y-auto border-t border-slate-100 pt-2 lg:hidden">
              {[...primary, ...more].map(({ to, label, icon: Icon }) => (
                <NavLink key={to} to={to} className={menuLink}>
                  <Icon className="size-4" aria-hidden />
                  {label}
                </NavLink>
              ))}
              <NavLink to="/settings" className={menuLink}>
                <Settings className="size-4" aria-hidden />
                Settings
              </NavLink>
              <div className="mt-2 border-t border-slate-100 px-3 pt-2">
                <p className="truncate text-sm font-medium">{user.full_name}</p>
                <p className="text-xs text-slate-brand capitalize">{user.role}</p>
              </div>
              <button type="button" onClick={signOut} className="mt-1 flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-100">
                <LogOut className="size-4" aria-hidden />
                Log out
              </button>
            </nav>
          )}
        </header>
      </div>

      <main id="main" className="min-w-0 px-4 pt-3 pb-8 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <Suspense fallback={<LoadingCards />}>
            <Outlet />
          </Suspense>
        </div>
      </main>
    </div>
  );
}
