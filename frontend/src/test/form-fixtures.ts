import type { AuthenticatedUser } from "../services/auth";
import type { FieldDescriptor } from "../services/fields";
import type {
  FormConstraints,
  FormDefinition,
  FormField
} from "../services/forms";

const unrestrictedConstraints: FormConstraints = {
  minValue: null,
  maxValue: null,
  decimalPlaces: null,
  maxLength: null
};

function field(
  value: Omit<FormField, "placeholder" | "constraints" | "options"> &
    Partial<Pick<FormField, "placeholder" | "constraints" | "options">>
): FormField {
  return {
    placeholder: null,
    constraints: unrestrictedConstraints,
    options: [],
    ...value
  };
}

export const phaseTwoUser: AuthenticatedUser = {
  id: "user-1",
  name: "Phase 2 User",
  username: "phase2_user",
  email: "phase2@example.local",
  role: "ADMIN"
};

export const viewOnlyMostDataField = {
  name: "Most Data",
  slug: "most-data",
  description: "Common work measurements, notes, and values",
  route: "/fields/most-data",
  canSubmit: false
} satisfies FieldDescriptor;

export const submittableMostDataField = {
  ...viewOnlyMostDataField,
  canSubmit: true
} satisfies FieldDescriptor;

export const mostDataForm: FormDefinition = {
  formVersionId: "form-version-1",
  versionNumber: 1,
  fields: [
    field({
      fieldKey: "workDate",
      label: "Work date",
      inputType: "DATE",
      required: true
    }),
    field({
      fieldKey: "workTime",
      label: "Work time",
      inputType: "TIME",
      required: true
    }),
    field({
      fieldKey: "locationId",
      label: "Location",
      inputType: "SELECT",
      required: true,
      options: [{ value: "building-a", label: "Building A" }]
    }),
    field({
      fieldKey: "shiftId",
      label: "Shift",
      inputType: "SELECT",
      required: true,
      options: [{ value: "morning", label: "Morning" }]
    }),
    field({
      fieldKey: "heatValue",
      label: "Heat value",
      inputType: "NUMBER",
      required: true
    }),
    field({
      fieldKey: "heatUnit",
      label: "Heat unit",
      inputType: "SELECT",
      required: true,
      options: [
        { value: "CELSIUS", label: "°C - Celsius" },
        { value: "FAHRENHEIT", label: "°F - Fahrenheit" },
        { value: "KELVIN", label: "K - Kelvin" }
      ]
    }),
    field({
      fieldKey: "status",
      label: "Status",
      inputType: "SELECT",
      required: true,
      options: [
        { value: "NORMAL", label: "Normal" },
        { value: "WARNING", label: "Warning" },
        { value: "PROBLEM", label: "Problem" },
        { value: "STOPPED", label: "Stopped" }
      ]
    }),
    field({
      fieldKey: "quantityValue",
      label: "Quantity or reading",
      inputType: "NUMBER",
      required: false
    }),
    field({
      fieldKey: "quantityUnit",
      label: "Quantity unit",
      inputType: "SELECT",
      required: false,
      options: [{ value: "KG", label: "kg" }]
    }),
    field({
      fieldKey: "issueDetected",
      label: "Issue detected",
      inputType: "CHECKBOX",
      required: false
    }),
    field({
      fieldKey: "notes",
      label: "Notes",
      inputType: "TEXTAREA",
      required: false,
      constraints: { ...unrestrictedConstraints, maxLength: 2000 }
    })
  ],
  rules: [
    {
      kind: "ALL_OR_NONE",
      fieldKeys: ["quantityValue", "quantityUnit"]
    }
  ]
};

export const validMostDataValues = {
  workDate: "2026-08-25",
  workTime: "08:30",
  locationId: "building-a",
  shiftId: "morning",
  heatValue: "42.5",
  heatUnit: "CELSIUS",
  status: "NORMAL",
  quantityValue: "",
  quantityUnit: "",
  issueDetected: false,
  notes: "Equipment checked."
};

export const historyRow = {
  id: "submission-1",
  field: { slug: "most-data", name: "Most Data" },
  formVersion: { id: mostDataForm.formVersionId, versionNumber: 1 },
  submittedBy: {
    id: "worker-1",
    name: "Worker A",
    username: "worker_a"
  },
  workDate: "2026-08-25",
  workTime: "08:30",
  location: { value: "building-a", label: "Building A" },
  shift: { value: "morning", label: "Morning" },
  heat: {
    value: 42.5,
    unit: { value: "CELSIUS", label: "°C - Celsius" }
  },
  status: { value: "NORMAL", label: "Normal" },
  confirmedBy: {
    id: "worker-1",
    name: "Worker A",
    username: "worker_a"
  },
  confirmedAt: "2026-08-25T08:31:00.000Z",
  confirmationTextVersion: 1,
  createdAt: "2026-08-25T08:31:00.000Z",
  updatedAt: "2026-08-25T08:31:00.000Z",
  recordState: "ACTIVE" as const
};

export const adminHistoryRow = {
  ...historyRow,
  deletedAt: null
};

export const adminSubmissionDetail = {
  ...adminHistoryRow,
  responseData: {
    workDate: "2026-08-25",
    workTime: "08:30",
    locationId: "building-a",
    shiftId: "morning",
    heatValue: 42.5,
    heatUnit: "CELSIUS",
    status: "NORMAL",
    issueDetected: false,
    notes: "Equipment checked."
  },
  historicalForm: mostDataForm
};

export const auditRow = {
  id: "audit-1",
  action: "SUBMISSION_CREATED",
  entityType: "SUBMISSION",
  entityId: historyRow.id,
  field: { id: "field-1", slug: "most-data", name: "Most Data" },
  actor: {
    id: "worker-1",
    name: "Worker A",
    username: "worker_a"
  },
  actorRole: "WORKER" as const,
  reason: null,
  oldValue: null,
  newValue: { id: historyRow.id, recordState: "ACTIVE" },
  createdAt: "2026-08-25T08:31:00.000Z",
  requestId: "request-1"
};

export const workerUser = {
  ...phaseTwoUser,
  id: "worker-1",
  name: "Worker A",
  username: "worker_a",
  email: "worker@example.local",
  role: "WORKER" as const
};

export const managerUser = {
  ...phaseTwoUser,
  id: "manager-1",
  name: "Manager A",
  username: "manager_a",
  email: "manager@example.local",
  role: "MANAGER" as const
};

export const adminUser = {
  ...phaseTwoUser,
  id: "admin-1",
  name: "Admin A",
  username: "admin_a",
  email: "admin@example.local",
  role: "ADMIN" as const
};
