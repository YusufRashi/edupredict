import {
  BarChart3,
  BrainCircuit,
  Database,
  FileText,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  Sparkles,
  UserCog,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { Suspense, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import type { Role } from "../api/types";
import { useAuth } from "../context/AuthContext";
import { LoadingCards } from "./ui";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  roles: Role[];
}

const NAV: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ["admin", "educator"] },
  { to: "/my-progress", label: "My progress", icon: GraduationCap, roles: ["student"] },
  { to: "/students", label: "Students", icon: Users, roles: ["admin", "educator"] },
  { to: "/predictions", label: "Predictions", icon: Sparkles, roles: ["admin", "educator"] },
  { to: "/analytics", label: "Analytics", icon: BarChart3, roles: ["admin", "educator"] },
  { to: "/model", label: "Model Information", icon: BrainCircuit, roles: ["admin", "educator"] },
  { to: "/reports", label: "Reports", icon: FileText, roles: ["admin", "educator"] },
  { to: "/datasets", label: "Datasets", icon: Database, roles: ["admin", "educator"] },
  { to: "/users", label: "Users", icon: UserCog, roles: ["admin"] },
  { to: "/settings", label: "Settings", icon: Settings, roles: ["admin", "educator", "student"] },
];

export function Logo({ light = false }: { light?: boolean }) {
  return (
    <span className={`flex items-center gap-2 text-lg font-semibold tracking-tight ${light ? "text-white" : "text-navy"}`}>
      <img src="/favicon.svg" alt="" className="size-7" />
      EduPredict
    </span>
  );
}

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  if (!user) return null;
  const items = NAV.filter((item) => item.roles.includes(user.role));

  const signOut = () => {
    // The local session ends even if the server cannot be reached.
    logout().catch(() => {}).finally(() => navigate("/login"));
  };

  return (
    <div className="min-h-screen lg:flex">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:rounded focus:bg-white focus:p-2">Skip to content</a>

      <div className="no-print flex items-center justify-between bg-navy p-3 lg:hidden">
        <Logo light />
        <button type="button" onClick={() => setOpen(!open)} aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} className="cursor-pointer p-1 text-white">
          {open ? <X className="size-6" aria-hidden /> : <Menu className="size-6" aria-hidden />}
        </button>
      </div>

      <aside className={`no-print bg-navy text-slate-300 lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-64 lg:shrink-0 lg:flex-col ${open ? "block" : "hidden"}`}>
        <div className="hidden p-5 lg:block"><Logo light /></div>
        <nav aria-label="Main" className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
          {items.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${isActive ? "bg-brand font-medium text-white" : "hover:bg-white/10 hover:text-white"}`
              }
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-white/10 p-4">
          <p className="truncate text-sm font-medium text-white">{user.full_name}</p>
          <p className="truncate text-xs capitalize">{user.role}</p>
          <button type="button" onClick={signOut} className="mt-3 flex cursor-pointer items-center gap-2 text-sm hover:text-white">
            <LogOut className="size-4" aria-hidden />
            Log out
          </button>
        </div>
      </aside>

      <main id="main" className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">
        <div className="mx-auto max-w-7xl">
          <Suspense fallback={<LoadingCards />}>
            <Outlet />
          </Suspense>
        </div>
      </main>
    </div>
  );
}
