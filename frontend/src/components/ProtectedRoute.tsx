import { Navigate, Outlet, useLocation } from "react-router-dom";
import type { Role } from "../api/types";
import { homeFor, useAuth } from "../context/AuthContext";

/**
 * Keeps people out of screens they cannot use. This is for navigation only:
 * the API enforces every permission itself on each request.
 */
export function ProtectedRoute({ roles }: { roles?: Role[] }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (roles && !roles.includes(user.role)) return <Navigate to={homeFor(user)} replace />;
  return <Outlet />;
}
