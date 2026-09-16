import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";

import { useAuth } from "../auth/AuthProvider";
import { DynamicFieldForm } from "../components/DynamicFieldForm";
import { RecentSubmissions } from "../components/RecentSubmissions";
import { ApiError } from "../services/api";
import { getField, type FieldDescriptor } from "../services/fields";
import { getFieldForm, type FormDefinition } from "../services/forms";

type FieldState = { fieldSlug: string; navigationKey: string } & (
  | { status: "loading" }
  | { status: "success"; field: FieldDescriptor; form: FormDefinition }
  | { status: "no-form"; field: FieldDescriptor }
  | { status: "forbidden" }
  | { status: "not-found" }
  | { status: "error" }
);

type FieldResult =
  | Exclude<FieldState, { status: "loading" }>
  | { status: "unauthenticated" }
  | null;

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

async function resolveField(
  fieldSlug: string,
  navigationKey: string,
  signal: AbortSignal
): Promise<FieldResult> {
  if (!fieldSlug) {
    return { status: "not-found", fieldSlug, navigationKey };
  }

  let field: FieldDescriptor | null = null;
  try {
    field = await getField(fieldSlug, signal);
    if (signal.aborted) {
      return null;
    }
    const form = await getFieldForm(fieldSlug, signal);
    if (signal.aborted) {
      return null;
    }
    return { status: "success", fieldSlug, navigationKey, field, form };
  } catch (error) {
    if (isAbortError(error) || signal.aborted) {
      return null;
    }
    if (error instanceof ApiError && error.status === 401) {
      return { status: "unauthenticated" };
    }
    if (error instanceof ApiError && error.status === 403) {
      return { status: "forbidden", fieldSlug, navigationKey };
    }
    if (
      error instanceof ApiError &&
      error.status === 404 &&
      error.code === "FORM_NOT_AVAILABLE" &&
      field
    ) {
      return { status: "no-form", fieldSlug, navigationKey, field };
    }
    if (error instanceof ApiError && error.status === 404) {
      return { status: "not-found", fieldSlug, navigationKey };
    }
    return { status: "error", fieldSlug, navigationKey };
  }
}

export function FieldPage() {
  const { fieldSlug } = useParams();
  const { key: navigationKey } = useLocation();
  const requestedFieldSlug = fieldSlug ?? "";
  const { invalidateSession, user } = useAuth();
  const requestSequence = useRef(0);
  const activeController = useRef<AbortController | null>(null);
  const [fieldState, setFieldState] = useState<FieldState>({
    status: "loading",
    fieldSlug: requestedFieldSlug,
    navigationKey
  });
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const visibleState: FieldState =
    fieldState.fieldSlug === requestedFieldSlug &&
    fieldState.navigationKey === navigationKey
      ? fieldState
      : {
          status: "loading",
          fieldSlug: requestedFieldSlug,
          navigationKey
        };

  const loadField = useCallback(() => {
    activeController.current?.abort();
    const controller = new AbortController();
    activeController.current = controller;
    const requestId = ++requestSequence.current;

    void resolveField(
      requestedFieldSlug,
      navigationKey,
      controller.signal
    ).then((result) => {
      if (
        !result ||
        controller.signal.aborted ||
        requestId !== requestSequence.current
      ) {
        return;
      }
      if (result.status === "unauthenticated") {
        invalidateSession();
        return;
      }
      setFieldState(result);
    });

    return controller;
  }, [invalidateSession, navigationKey, requestedFieldSlug]);

  useEffect(() => {
    loadField();
    return () => {
      activeController.current?.abort();
      activeController.current = null;
      requestSequence.current += 1;
    };
  }, [loadField]);

  const refreshHistory = useCallback(() => {
    setHistoryRefreshKey((value) => value + 1);
  }, []);

  function retryField(): void {
    setFieldState({
      status: "loading",
      fieldSlug: requestedFieldSlug,
      navigationKey
    });
    loadField();
  }

  if (visibleState.status === "loading") {
    return (
      <main className="status-page">
        <p role="status">Loading form...</p>
      </main>
    );
  }

  if (visibleState.status === "forbidden") {
    return (
      <main className="status-page">
        <h1>Access denied</h1>
        <p>You do not have permission to access this field.</p>
        <Link to="/">Return to assigned fields</Link>
      </main>
    );
  }

  if (visibleState.status === "not-found") {
    return (
      <main className="status-page">
        <h1>Field not found</h1>
        <p>The requested field is unavailable.</p>
        <Link to="/">Return to assigned fields</Link>
      </main>
    );
  }

  if (visibleState.status === "error") {
    return (
      <main className="status-page">
        <h1>Unable to load this form</h1>
        <p>Check the connection and try again.</p>
        <button type="button" onClick={retryField}>
          Try again
        </button>
        <Link to="/">Return to assigned fields</Link>
      </main>
    );
  }

  if (visibleState.status === "no-form") {
    return (
      <main className="app-shell">
        <Link className="back-link" to="/">
          Back to assigned fields
        </Link>
        <section className="field-page" aria-labelledby="field-heading">
          <p className="eyebrow">Assigned field</p>
          <h1 id="field-heading">{visibleState.field.name}</h1>
          <div className="status-panel">
            <h2>Form unavailable</h2>
            <p>This field does not have a published form yet.</p>
          </div>
        </section>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="status-page">
        <p role="status">Checking your session...</p>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <Link className="back-link" to="/">
        Back to assigned fields
      </Link>
      <section className="field-page" aria-labelledby="field-heading">
        <p className="eyebrow">Assigned field</p>
        <h1 id="field-heading">{visibleState.field.name}</h1>
        {visibleState.field.description ? (
          <p>{visibleState.field.description}</p>
        ) : null}
        <DynamicFieldForm
          key={`${visibleState.form.formVersionId}:${
            visibleState.field.canSubmit ? "submit" : "view"
          }`}
          canSubmit={visibleState.field.canSubmit}
          definition={visibleState.form}
          fieldSlug={visibleState.field.slug}
          onReloadForm={retryField}
          onSessionExpired={invalidateSession}
          onSubmissionCreated={refreshHistory}
          submittedBy={user}
        />
        <RecentSubmissions
          fieldSlug={visibleState.field.slug}
          refreshKey={historyRefreshKey}
          onSessionExpired={invalidateSession}
        />
      </section>
    </main>
  );
}
