import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useAuth } from "../auth/AuthProvider";
import { managerUser } from "../test/form-fixtures";
import { RoleRoute } from "./RoleRoute";

vi.mock("../auth/AuthProvider", () => ({
  useAuth: vi.fn()
}));

const useAuthMock = vi.mocked(useAuth);

afterEach(cleanup);

function renderGuard(role: "MANAGER" | "ADMIN") {
  useAuthMock.mockReturnValue({
    status: "authenticated",
    user: { ...managerUser, role },
    login: vi.fn(),
    logout: vi.fn(),
    retrySession: vi.fn(),
    invalidateSession: vi.fn()
  });
  render(
    <MemoryRouter initialEntries={["/manager"]}>
      <Routes>
        <Route element={<RoleRoute allowedRole="MANAGER" />}>
          <Route path="/manager" element={<h1>Manager history</h1>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe("RoleRoute", () => {
  it("renders the protected role route for the exact allowed role", () => {
    renderGuard("MANAGER");
    expect(screen.getByRole("heading", { name: "Manager history" })).toBeInTheDocument();
  });

  it("does not treat Admin as Manager and shows an accessible permission state", () => {
    renderGuard("ADMIN");
    expect(screen.getByRole("heading", { name: "Access denied" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Manager history" })).not.toBeInTheDocument();
  });
});
