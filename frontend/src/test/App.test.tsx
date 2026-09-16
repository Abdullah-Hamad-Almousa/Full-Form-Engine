import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "../App";
import { AuthProvider } from "../auth/AuthProvider";
import {
  adminUser,
  historyRow,
  managerUser,
  mostDataForm,
  submittableMostDataField,
  validMostDataValues,
  viewOnlyMostDataField,
  workerUser
} from "./form-fixtures";

const currentUser = {
  id: "user-1",
  name: "Phase 1 User",
  username: "phase1_user",
  email: "phase1@example.local",
  role: "ADMIN"
} as const;

const mostDataField = viewOnlyMostDataField;

const confirmationName =
  "I have reviewed this form and confirm that all entered values are complete and correct.";

type FetchHandler = (
  path: string,
  options?: RequestInit
) => Response | Promise<Response>;

function jsonResponse(status: number, body?: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: status === 204 ? undefined : { "Content-Type": "application/json" }
  });
}

function apiError(status: number, code: string, message: string): Response {
  return jsonResponse(status, {
    error: { code, message, requestId: "request-id" }
  });
}

function historyResponse(
  data: (typeof historyRow)[] = [],
  pageSize = 5
): Response {
  return jsonResponse(200, {
    data,
    meta: { page: 1, pageSize, total: data.length }
  });
}

function installFetch(handler: FetchHandler) {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, options?: RequestInit) => {
      const value =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.pathname
            : new URL(input.url).pathname;
      return handler(value, options);
    }
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderApplication(path: string): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>
  );
}

function renderNavigableApplication(path: string): void {
  function RouteSwitcher() {
    const navigate = useNavigate();
    return (
      <button type="button" onClick={() => navigate("/fields/other-data")}>
        Open other field
      </button>
    );
  }

  render(
    <MemoryRouter initialEntries={[path]}>
      <RouteSwitcher />
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>
  );
}

async function fillValidMostDataForm(
  user: ReturnType<typeof userEvent.setup>
): Promise<void> {
  await user.type(
    screen.getByLabelText("Work date"),
    validMostDataValues.workDate
  );
  await user.type(
    screen.getByLabelText("Work time"),
    validMostDataValues.workTime
  );
  await user.selectOptions(
    screen.getByLabelText("Location"),
    validMostDataValues.locationId
  );
  await user.selectOptions(
    screen.getByLabelText("Shift"),
    validMostDataValues.shiftId
  );
  await user.type(
    screen.getByLabelText("Heat value"),
    validMostDataValues.heatValue
  );
  await user.selectOptions(
    screen.getByLabelText("Heat unit"),
    validMostDataValues.heatUnit
  );
  await user.selectOptions(
    screen.getByLabelText("Status"),
    validMostDataValues.status
  );
  await user.type(screen.getByLabelText("Notes"), validMostDataValues.notes);
  await user.tab();
}

function deferred<T>() {
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Phase 1 field navigation", () => {
  it("redirects an unauthenticated direct field visit to login", async () => {
    installFetch((path) => {
      expect(path).toBe("/api/auth/me");
      return apiError(401, "AUTHENTICATION_REQUIRED", "Authentication is required.");
    });

    renderApplication("/fields/most-data");

    expect(
      await screen.findByRole("heading", { name: "Sign in" })
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Username")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
  });

  it("logs in and renders the assigned Most Data navigation card", async () => {
    const fetchMock = installFetch((path, options) => {
      if (path === "/api/auth/me") {
        return apiError(
          401,
          "AUTHENTICATION_REQUIRED",
          "Authentication is required."
        );
      }
      if (path === "/api/auth/login") {
        expect(options?.method).toBe("POST");
        expect(JSON.parse(String(options?.body))).toEqual({
          username: "phase1_user",
          password: "phase1-password"
        });
        return jsonResponse(200, { data: { user: currentUser } });
      }
      if (path === "/api/fields") {
        return jsonResponse(200, { data: [mostDataField] });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    const user = userEvent.setup();

    renderApplication("/login");
    await screen.findByRole("heading", { name: "Sign in" });
    await user.type(screen.getByLabelText("Username"), "phase1_user");
    await user.type(screen.getByLabelText("Password"), "phase1-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    const link = await screen.findByRole("link", { name: /Most Data/ });
    expect(link).toHaveAttribute("href", "/fields/most-data");
    expect(screen.getByText(mostDataField.description)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("shows a safe login error for invalid credentials", async () => {
    installFetch((path) => {
      if (path === "/api/auth/me") {
        return apiError(
          401,
          "AUTHENTICATION_REQUIRED",
          "Authentication is required."
        );
      }
      if (path === "/api/auth/login") {
        return apiError(
          401,
          "INVALID_CREDENTIALS",
          "Invalid username or password."
        );
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    const user = userEvent.setup();

    renderApplication("/login");
    await screen.findByRole("heading", { name: "Sign in" });
    await user.type(screen.getByLabelText("Username"), "phase1_user");
    await user.type(screen.getByLabelText("Password"), "incorrect");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(
      await screen.findByText("Invalid username or password.")
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Username")).toHaveValue("phase1_user");
  });

  it("renders the published form for a view-only assigned field", async () => {
    installFetch((path) => {
      if (path === "/api/auth/me") {
        return jsonResponse(200, { data: { user: currentUser } });
      }
      if (path === "/api/fields/most-data") {
        return jsonResponse(200, { data: mostDataField });
      }
      if (path === "/api/fields/most-data/form") {
        return jsonResponse(200, { data: mostDataForm });
      }
      if (path.startsWith("/api/fields/most-data/submissions/me?")) {
        return historyResponse([historyRow]);
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    renderApplication("/fields/most-data");

    expect(
      await screen.findByRole("heading", { name: "Most Data" })
    ).toBeInTheDocument();
    expect(screen.getByText(mostDataField.description)).toBeInTheDocument();
    expect(screen.getByLabelText("Submitted by")).toHaveValue(currentUser.name);
    expect(screen.getByLabelText("Work date")).toBeRequired();
    expect(screen.getByLabelText("Notes")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: confirmationName })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Submit" })).toBeDisabled();
    expect(
      screen.getByText(/This assignment is view-only\./)
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: "Recent submissions" })
    ).toBeInTheDocument();
    expect(screen.getByText("42.5 °C - Celsius")).toBeInTheDocument();
  });

  it("submits one canonical request, resets, and keeps success when history refresh fails", async () => {
    let historyRequests = 0;
    const fetchMock = installFetch((path, options) => {
      if (path === "/api/auth/me") {
        return jsonResponse(200, { data: { user: currentUser } });
      }
      if (path === "/api/fields/most-data") {
        return jsonResponse(200, { data: submittableMostDataField });
      }
      if (path === "/api/fields/most-data/form") {
        return jsonResponse(200, { data: mostDataForm });
      }
      if (path.startsWith("/api/fields/most-data/submissions/me?")) {
        historyRequests += 1;
        return historyRequests === 1
          ? historyResponse()
          : apiError(500, "INTERNAL_ERROR", "An unexpected error occurred.");
      }
      if (path === "/api/fields/most-data/submissions") {
        expect(options?.method).toBe("POST");
        expect(JSON.parse(String(options?.body))).toEqual({
          formVersionId: mostDataForm.formVersionId,
          confirmed: true,
          responseData: {
            workDate: validMostDataValues.workDate,
            workTime: validMostDataValues.workTime,
            locationId: validMostDataValues.locationId,
            shiftId: validMostDataValues.shiftId,
            heatValue: 42.5,
            heatUnit: validMostDataValues.heatUnit,
            status: validMostDataValues.status,
            issueDetected: false,
            notes: validMostDataValues.notes
          }
        });
        return jsonResponse(201, { data: { id: "submission-1" } });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    const user = userEvent.setup();

    renderApplication("/fields/most-data");
    await screen.findByRole("heading", { name: "Data entry" });
    await screen.findByText("No recent submissions yet.");
    await fillValidMostDataForm(user);

    const confirmation = screen.getByRole("checkbox", {
      name: confirmationName
    });
    await user.click(confirmation);
    const submit = screen.getByRole("button", { name: "Submit" });
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);

    expect(
      await screen.findByText("Submission saved successfully.")
    ).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.filter(([, options]) => options?.method === "POST")
    ).toHaveLength(1);
    expect(confirmation).not.toBeChecked();
    expect(screen.getByLabelText("Work date")).toHaveValue("");
    expect(screen.getByLabelText("Notes")).toHaveValue("");
    expect(
      await screen.findByText("Unable to load recent submissions.")
    ).toBeInTheDocument();
    expect(screen.getByText("Submission saved successfully.")).toBeInTheDocument();
    expect(historyRequests).toBe(2);
  });

  it("returns to login when the session expires during submission", async () => {
    installFetch((path) => {
      if (path === "/api/auth/me") {
        return jsonResponse(200, { data: { user: currentUser } });
      }
      if (path === "/api/fields/most-data") {
        return jsonResponse(200, { data: submittableMostDataField });
      }
      if (path === "/api/fields/most-data/form") {
        return jsonResponse(200, { data: mostDataForm });
      }
      if (path.startsWith("/api/fields/most-data/submissions/me?")) {
        return historyResponse();
      }
      if (path === "/api/fields/most-data/submissions") {
        return apiError(
          401,
          "AUTHENTICATION_REQUIRED",
          "Authentication is required."
        );
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    const user = userEvent.setup();

    renderApplication("/fields/most-data");
    await screen.findByRole("heading", { name: "Data entry" });
    await fillValidMostDataForm(user);
    await user.click(
      screen.getByRole("checkbox", { name: confirmationName })
    );
    await user.click(screen.getByRole("button", { name: "Submit" }));

    expect(
      await screen.findByRole("heading", { name: "Sign in" })
    ).toBeInTheDocument();
    expect(screen.queryByText("Submission saved successfully.")).not.toBeInTheDocument();
  });

  it("shows an empty assignment state and logs out", async () => {
    installFetch((path) => {
      if (path === "/api/auth/me") {
        return jsonResponse(200, { data: { user: currentUser } });
      }
      if (path === "/api/fields") {
        return jsonResponse(200, { data: [] });
      }
      if (path === "/api/auth/logout") {
        return jsonResponse(204);
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    const user = userEvent.setup();

    renderApplication("/");

    expect(
      await screen.findByText("No fields are assigned to your account.")
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(
      await screen.findByRole("heading", { name: "Sign in" })
    ).toBeInTheDocument();
  });

  it("renders a generic forbidden state without protected field metadata", async () => {
    installFetch((path) => {
      if (path === "/api/auth/me") {
        return jsonResponse(200, { data: { user: currentUser } });
      }
      if (path === "/api/fields/most-data") {
        return jsonResponse(200, { data: mostDataField });
      }
      if (path === "/api/fields/most-data/form") {
        return apiError(
          403,
          "FIELD_ACCESS_FORBIDDEN",
          "You do not have permission to access this field."
        );
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    renderApplication("/fields/most-data");

    expect(
      await screen.findByRole("heading", { name: "Access denied" })
    ).toBeInTheDocument();
    expect(screen.queryByText(mostDataField.description)).not.toBeInTheDocument();
  });

  it("distinguishes a missing field from forbidden access", async () => {
    installFetch((path) => {
      if (path === "/api/auth/me") {
        return jsonResponse(200, { data: { user: currentUser } });
      }
      if (path === "/api/fields/missing-field") {
        return apiError(404, "FIELD_NOT_FOUND", "Field not found.");
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    renderApplication("/fields/missing-field");

    expect(
      await screen.findByRole("heading", { name: "Field not found" })
    ).toBeInTheDocument();
  });

  it("distinguishes an unavailable form from a missing field", async () => {
    installFetch((path) => {
      if (path === "/api/auth/me") {
        return jsonResponse(200, { data: { user: currentUser } });
      }
      if (path === "/api/fields/most-data") {
        return jsonResponse(200, { data: mostDataField });
      }
      if (path === "/api/fields/most-data/form") {
        return apiError(
          404,
          "FORM_NOT_AVAILABLE",
          "No published form is available."
        );
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    renderApplication("/fields/most-data");

    expect(
      await screen.findByRole("heading", { name: "Form unavailable" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Most Data" })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Field not found" })
    ).not.toBeInTheDocument();
  });

  it("returns to login when the session expires during a field request", async () => {
    installFetch((path) => {
      if (path === "/api/auth/me") {
        return jsonResponse(200, { data: { user: currentUser } });
      }
      if (path === "/api/fields/most-data") {
        return jsonResponse(200, { data: mostDataField });
      }
      if (path === "/api/fields/most-data/form") {
        return apiError(
          401,
          "AUTHENTICATION_REQUIRED",
          "Authentication is required."
        );
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    renderApplication("/fields/most-data");

    expect(
      await screen.findByRole("heading", { name: "Sign in" })
    ).toBeInTheDocument();
  });

  it("retries a failed form request and clears the error state", async () => {
    let formRequests = 0;
    installFetch((path) => {
      if (path === "/api/auth/me") {
        return jsonResponse(200, { data: { user: currentUser } });
      }
      if (path === "/api/fields/most-data") {
        return jsonResponse(200, { data: mostDataField });
      }
      if (path === "/api/fields/most-data/form") {
        formRequests += 1;
        return formRequests === 1
          ? apiError(500, "INTERNAL_ERROR", "An unexpected error occurred.")
          : jsonResponse(200, { data: mostDataForm });
      }
      if (path.startsWith("/api/fields/most-data/submissions/me?")) {
        return historyResponse();
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    const user = userEvent.setup();

    renderApplication("/fields/most-data");

    expect(
      await screen.findByRole("heading", { name: "Unable to load this form" })
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByRole("heading", { name: "Data entry" })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Unable to load this form" })
    ).not.toBeInTheDocument();
    expect(formRequests).toBe(2);
  });

  it("ignores a stale response after navigating to another field", async () => {
    const firstFieldResponse = deferred<Response>();
    const requestedPaths: string[] = [];
    let firstFieldSignal: AbortSignal | null | undefined;
    const otherField = {
      ...mostDataField,
      name: "Other Data",
      slug: "other-data",
      route: "/fields/other-data"
    };
    const otherForm = {
      ...mostDataForm,
      formVersionId: "other-form-version"
    };
    installFetch((path, options) => {
      requestedPaths.push(path);
      if (path === "/api/auth/me") {
        return jsonResponse(200, { data: { user: currentUser } });
      }
      if (path === "/api/fields/most-data") {
        firstFieldSignal = options?.signal;
        return firstFieldResponse.promise;
      }
      if (path === "/api/fields/other-data") {
        return jsonResponse(200, { data: otherField });
      }
      if (path === "/api/fields/other-data/form") {
        return jsonResponse(200, { data: otherForm });
      }
      if (path.startsWith("/api/fields/other-data/submissions/me?")) {
        return historyResponse();
      }
      if (path === "/api/fields/most-data/form") {
        throw new Error("The aborted request must not continue to the form read.");
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    const user = userEvent.setup();

    renderNavigableApplication("/fields/most-data");

    expect(await screen.findByText("Loading form...")).toBeInTheDocument();
    await waitFor(() => {
      expect(requestedPaths).toContain("/api/fields/most-data");
    });
    await user.click(screen.getByRole("button", { name: "Open other field" }));
    expect(
      await screen.findByRole("heading", { name: "Other Data" })
    ).toBeInTheDocument();
    expect(firstFieldSignal?.aborted).toBe(true);

    await act(async () => {
      firstFieldResponse.resolve(jsonResponse(200, { data: mostDataField }));
      await firstFieldResponse.promise;
      await Promise.resolve();
    });

    expect(
      screen.getByRole("heading", { name: "Other Data" })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Most Data" })
    ).not.toBeInTheDocument();
    expect(requestedPaths).not.toContain("/api/fields/most-data/form");
  });

  it("retries a failed assigned-field list without showing stale success", async () => {
    let fieldRequests = 0;
    installFetch((path) => {
      if (path === "/api/auth/me") {
        return jsonResponse(200, { data: { user: currentUser } });
      }
      if (path === "/api/fields") {
        fieldRequests += 1;
        return fieldRequests === 1
          ? apiError(500, "INTERNAL_ERROR", "An unexpected error occurred.")
          : jsonResponse(200, { data: [mostDataField] });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    const user = userEvent.setup();

    renderApplication("/");

    expect(
      await screen.findByText("Unable to load assigned fields.")
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByRole("link", { name: /Most Data/ })
    ).toBeInTheDocument();
    await waitFor(() => expect(fieldRequests).toBe(2));
  });

  it("shows Manager history links only for currently returned assigned fields", async () => {
    installFetch((path) => {
      if (path === "/api/auth/me") {
        return jsonResponse(200, { data: { user: managerUser } });
      }
      if (path === "/api/fields") {
        return jsonResponse(200, { data: [mostDataField] });
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    renderApplication("/");

    expect(
      await screen.findByRole("link", { name: "Most Data team history" })
    ).toHaveAttribute("href", "/manager/fields/most-data/submissions");
    expect(screen.queryByText("Other Data team history")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Admin submissions" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Audit logs" })).not.toBeInTheDocument();
  });

  it("shows only Admin navigation to Admins, including Admins without assignments", async () => {
    installFetch((path) => {
      if (path === "/api/auth/me") {
        return jsonResponse(200, { data: { user: adminUser } });
      }
      if (path === "/api/fields") {
        return jsonResponse(200, { data: [] });
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    renderApplication("/");

    expect(await screen.findByRole("link", { name: "Admin submissions" })).toHaveAttribute(
      "href",
      "/admin/submissions"
    );
    expect(screen.getByRole("link", { name: "Audit logs" })).toHaveAttribute(
      "href",
      "/admin/audit-logs"
    );
    expect(screen.queryByText(/team history/i)).not.toBeInTheDocument();
  });

  it("keeps role navigation hidden from Workers and blocks Admin use of Manager pages", async () => {
    let currentSessionUser: typeof workerUser | typeof adminUser = workerUser;
    const fetchMock = installFetch((path) => {
      if (path === "/api/auth/me") {
        return jsonResponse(200, { data: { user: currentSessionUser } });
      }
      if (path === "/api/fields") {
        return jsonResponse(200, { data: [mostDataField] });
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    const view = render(
      <MemoryRouter initialEntries={["/"]}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </MemoryRouter>
    );
    await screen.findByRole("link", { name: /Most Data/ });
    expect(screen.queryByText(/team history/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Admin submissions" })).not.toBeInTheDocument();

    view.unmount();
    currentSessionUser = adminUser;
    renderApplication("/manager/fields/most-data/submissions");
    expect(await screen.findByRole("heading", { name: "Access denied" })).toBeInTheDocument();
    expect(fetchMock.mock.calls.map(([path]) => path)).not.toContain(
      "/api/manager/fields/most-data/submissions?page=1&pageSize=25"
    );
  });
});
