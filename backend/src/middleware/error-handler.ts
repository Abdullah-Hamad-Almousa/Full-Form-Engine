import type { ErrorRequestHandler, RequestHandler } from "express";

type ApplicationErrorOptions = {
  status: number;
  code: string;
  message: string;
  fields?: Record<string, string>;
};

export class ApplicationError extends Error {
  readonly status: number;
  readonly code: string;
  readonly publicMessage: string;
  readonly fields?: Record<string, string>;

  constructor({ status, code, message, fields }: ApplicationErrorOptions) {
    super(message);
    this.name = "ApplicationError";
    this.status = status;
    this.code = code;
    this.publicMessage = message;
    this.fields = fields;
  }
}

function isMalformedJsonError(error: unknown): boolean {
  if (!(error instanceof SyntaxError)) {
    return false;
  }

  const parseError = error as SyntaxError & {
    status?: number;
    type?: string;
  };
  return parseError.status === 400 && parseError.type === "entity.parse.failed";
}

function isPayloadTooLargeError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const payloadError = error as Error & {
    status?: number;
    type?: string;
  };
  return payloadError.status === 413 && payloadError.type === "entity.too.large";
}

function logUnexpectedError(requestId: string, error: unknown): void {
  console.error(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "error",
      event: "request_failed",
      requestId,
      errorName: error instanceof Error ? error.name : "UnknownError"
    })
  );
}

export const notFoundHandler: RequestHandler = (request, response) => {
  response.status(404).json({
    error: {
      code: "NOT_FOUND",
      message: "Resource not found.",
      requestId: request.requestId
    }
  });
};

export const errorHandler: ErrorRequestHandler = (
  error,
  request,
  response,
  next
) => {
  void next;

  let applicationError: ApplicationError;
  if (error instanceof ApplicationError) {
    applicationError = error;
  } else if (isPayloadTooLargeError(error)) {
    applicationError = new ApplicationError({
      status: 413,
      code: "PAYLOAD_TOO_LARGE",
      message: "Request body is too large."
    });
  } else if (isMalformedJsonError(error)) {
    applicationError = new ApplicationError({
      status: 400,
      code: "MALFORMED_JSON",
      message: "Request body contains malformed JSON."
    });
  } else {
    applicationError = new ApplicationError({
      status: 500,
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred."
    });
  }

  if (applicationError.status >= 500) {
    logUnexpectedError(request.requestId, error);
  }

  response.status(applicationError.status).json({
    error: {
      code: applicationError.code,
      message: applicationError.publicMessage,
      ...(applicationError.fields
        ? { fields: applicationError.fields }
        : {}),
      requestId: request.requestId
    }
  });
};
