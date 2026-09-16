import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { useAuth } from "../auth/AuthProvider";
import { FieldNavigationCard } from "../components/FieldNavigationCard";
import { ApiError } from "../services/api";
import {
  listAssignedFields,
  type FieldDescriptor
} from "../services/fields";

type FieldListState =
  | { status: "loading" }
  | { status: "success"; fields: FieldDescriptor[] }
  | { status: "error" };

type FieldListResult =
  | Exclude<FieldListState, { status: "loading" }>
  | { status: "unauthenticated" }
  | null;

async function resolveAssignedFields(
  signal?: AbortSignal
): Promise<FieldListResult> {
  try {
    return { status: "success", fields: await listAssignedFields(signal) };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return null;
    }
    return error instanceof ApiError && error.status === 401
      ? { status: "unauthenticated" }
      : { status: "error" };
  }
}

export function DashboardPage() {
  const { user, logout, invalidateSession } = useAuth();
  const [fieldState, setFieldState] = useState<FieldListState>({
    status: "loading"
  });
  const [logoutError, setLogoutError] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const applyFieldResult = useCallback(
    (result: FieldListResult) => {
      if (!result) {
        return;
      }
      if (result.status === "unauthenticated") {
        invalidateSession();
        return;
      }
      setFieldState(result);
    },
    [invalidateSession]
  );

  useEffect(() => {
    const controller = new AbortController();
    void resolveAssignedFields(controller.signal).then(applyFieldResult);
    return () => controller.abort();
  }, [applyFieldResult]);

  function retryFields() {
    setFieldState({ status: "loading" });
    void resolveAssignedFields().then(applyFieldResult);
  }

  async function handleLogout() {
    setSigningOut(true);
    setLogoutError(false);
    try {
      await logout();
    } catch {
      setLogoutError(true);
      setSigningOut(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Field Data Application</p>
          <h1>Assigned fields</h1>
          <p>Signed in as {user?.name}</p>
        </div>
        <button type="button" onClick={handleLogout} disabled={signingOut}>
          {signingOut ? "Signing out..." : "Sign out"}
        </button>
      </header>

      {logoutError ? (
        <p className="error-message">Unable to sign out. Try again.</p>
      ) : null}

      {user?.role === "ADMIN" ? (
        <nav className="role-navigation" aria-label="Admin navigation">
          <h2>Admin review</h2>
          <div className="role-navigation__links">
            <Link to="/admin/submissions">Admin submissions</Link>
            <Link to="/admin/audit-logs">Audit logs</Link>
          </div>
        </nav>
      ) : null}

      {fieldState.status === "loading" ? (
        <p role="status">Loading assigned fields...</p>
      ) : null}

      {fieldState.status === "error" ? (
        <section className="status-panel" aria-labelledby="field-error-heading">
          <h2 id="field-error-heading">Unable to load assigned fields.</h2>
          <p>Check the connection and try again.</p>
          <button type="button" onClick={retryFields}>
            Try again
          </button>
        </section>
      ) : null}

      {fieldState.status === "success" && fieldState.fields.length === 0 ? (
        <section className="status-panel">
          <h2>No assigned fields</h2>
          <p>No fields are assigned to your account.</p>
        </section>
      ) : null}

      {fieldState.status === "success" && fieldState.fields.length > 0 ? (
        <section className="field-grid" aria-label="Assigned field navigation">
          {fieldState.fields.map((field) => (
            <FieldNavigationCard key={field.slug} field={field} />
          ))}
        </section>
      ) : null}

      {user?.role === "MANAGER" &&
      fieldState.status === "success" &&
      fieldState.fields.length > 0 ? (
        <nav className="role-navigation" aria-label="Manager team history">
          <h2>Manager team history</h2>
          <ul>
            {fieldState.fields.map((field) => (
              <li key={field.slug}>
                <Link
                  to={`/manager/fields/${encodeURIComponent(field.slug)}/submissions`}
                >
                  {field.name} team history
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </main>
  );
}
