export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly fields?: Record<string, string>,
    readonly requestId?: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type ErrorEnvelope = {
  error?: {
    code?: string;
    message?: string;
    fields?: Record<string, string>;
    requestId?: string;
  };
};

export type ApiRequestOptions = RequestInit & {
  expectedStatus?: number;
};

export async function api<T>(
  path: string,
  options: ApiRequestOptions = {}
): Promise<T> {
  if (!path.startsWith("/api/")) {
    throw new Error("API paths must start with /api/.");
  }

  const { expectedStatus, ...requestOptions } = options;
  const headers = new Headers(requestOptions.headers);
  if (requestOptions.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, {
    ...requestOptions,
    credentials: "include",
    headers
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ErrorEnvelope | null;
    const error = body?.error;
    throw new ApiError(
      error?.message ?? "Request failed.",
      response.status,
      error?.code,
      error?.fields,
      error?.requestId
    );
  }

  if (expectedStatus !== undefined && response.status !== expectedStatus) {
    throw new Error("The API returned an unexpected success status.");
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}
