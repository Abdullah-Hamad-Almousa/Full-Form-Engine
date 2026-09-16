import { api } from "./api";

export type FieldDescriptor = {
  name: string;
  slug: string;
  description: string | null;
  route: string;
  canSubmit: boolean;
};

type FieldListEnvelope = {
  data: FieldDescriptor[];
};

type FieldEnvelope = {
  data: FieldDescriptor;
};

export async function listAssignedFields(
  signal?: AbortSignal
): Promise<FieldDescriptor[]> {
  const response = await api<FieldListEnvelope>("/api/fields", { signal });
  return response.data;
}

export async function getField(
  fieldSlug: string,
  signal?: AbortSignal
): Promise<FieldDescriptor> {
  const response = await api<FieldEnvelope>(
    `/api/fields/${encodeURIComponent(fieldSlug)}`,
    { signal }
  );
  return response.data;
}
