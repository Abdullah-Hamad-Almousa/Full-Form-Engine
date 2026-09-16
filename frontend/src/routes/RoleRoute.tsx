import { Link, Outlet } from "react-router-dom";

import { useAuth } from "../auth/AuthProvider";
import type { UserRole } from "../services/auth";

type RoleRouteProps = {
  allowedRole: UserRole;
};

export function RoleRoute({ allowedRole }: RoleRouteProps) {
  const { status, user } = useAuth();

  if (status !== "authenticated" || !user) {
    return (
      <main className="status-page">
        <p role="status">Checking your permission...</p>
      </main>
    );
  }

  if (user.role !== allowedRole) {
    return (
      <main className="status-page">
        <h1>Access denied</h1>
        <p>You do not have permission to access this page.</p>
        <Link to="/">Return to assigned fields</Link>
      </main>
    );
  }

  return <Outlet />;
}
