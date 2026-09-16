import { Navigate, Outlet, useLocation } from "react-router-dom";

import { useAuth } from "../auth/AuthProvider";

export function ProtectedRoute() {
  const { status, retrySession } = useAuth();
  const location = useLocation();

  if (status === "loading") {
    return (
      <main className="status-page">
        <p role="status">Checking your session...</p>
      </main>
    );
  }

  if (status === "error") {
    return (
      <main className="status-page">
        <h1>Unable to verify your session</h1>
        <p>Check the connection and try again.</p>
        <button type="button" onClick={retrySession}>
          Try again
        </button>
      </main>
    );
  }

  if (status === "unauthenticated") {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: `${location.pathname}${location.search}` }}
      />
    );
  }

  return <Outlet />;
}
