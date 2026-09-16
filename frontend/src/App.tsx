import { Route, Routes } from "react-router-dom";

import { AdminAuditLogsPage } from "./pages/AdminAuditLogsPage";
import { AdminSubmissionDetailPage } from "./pages/AdminSubmissionDetailPage";
import { AdminSubmissionsPage } from "./pages/AdminSubmissionsPage";
import { DashboardPage } from "./pages/DashboardPage";
import { FieldHistoryPage } from "./pages/FieldHistoryPage";
import { FieldPage } from "./pages/FieldPage";
import { LoginPage } from "./pages/LoginPage";
import { ManagerTeamHistoryPage } from "./pages/ManagerTeamHistoryPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { ProtectedRoute } from "./routes/ProtectedRoute";
import { RoleRoute } from "./routes/RoleRoute";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/fields/:fieldSlug" element={<FieldPage />} />
        <Route path="/fields/:fieldSlug/history" element={<FieldHistoryPage />} />
        <Route element={<RoleRoute allowedRole="MANAGER" />}>
          <Route
            path="/manager/fields/:fieldSlug/submissions"
            element={<ManagerTeamHistoryPage />}
          />
        </Route>
        <Route element={<RoleRoute allowedRole="ADMIN" />}>
          <Route path="/admin/submissions" element={<AdminSubmissionsPage />} />
          <Route
            path="/admin/submissions/:submissionId"
            element={<AdminSubmissionDetailPage />}
          />
          <Route path="/admin/audit-logs" element={<AdminAuditLogsPage />} />
        </Route>
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
