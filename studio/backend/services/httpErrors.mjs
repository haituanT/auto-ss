export class ApiError extends Error {
  constructor(status, code, message, options = {}) {
    super(String(message || code || "Request failed."));
    this.name = "ApiError";
    this.status = Number(status) || 500;
    this.code = String(code || "INTERNAL_ERROR");
    this.details = options.details;
    this.cause = options.cause;
  }
}

export function badRequest(message = "Bad request.", details) {
  return new ApiError(400, "BAD_REQUEST", message, { details });
}

export function notFound(message = "Resource not found.", details) {
  return new ApiError(404, "NOT_FOUND", message, { details });
}

export function conflict(code = "CONFLICT", message = "The resource is busy.", details) {
  return new ApiError(409, code, message, { details });
}

export function projectExists(slug) {
  const normalized = String(slug || "").trim();
  const label = normalized ? `Project "${normalized}"` : "Project";
  return conflict(
    "PROJECT_EXISTS",
    `${label} already exists. Choose a different project name or slug.`,
    normalized ? { slug: normalized } : undefined,
  );
}

export function projectBusy(slug, jobs = []) {
  return conflict(
    "PROJECT_BUSY",
    `Project ${slug} has active jobs. Cancel them before deleting or replacing project files.`,
    { slug, jobs },
  );
}

export function toApiError(error) {
  if (error instanceof ApiError) return error;

  if (error?.type === "entity.parse.failed") {
    return badRequest("Request body must be valid JSON.");
  }

  const message = String(error?.message || error || "Internal server error.");
  if (error?.code === "ENOENT") {
    return notFound(message);
  }
  if (/invalid project id|invalid slug|outside the videos folder|bad request|missing required|must be an? object|must be an? array/i.test(message)) {
    return badRequest(message);
  }
  if (/project not found|missing video\.json|job not found|template not found|resource not found|does not exist/i.test(message)) {
    return notFound(message);
  }
  if (/project_busy|active jobs|project is busy/i.test(message)) {
    return conflict("PROJECT_BUSY", message);
  }
  if (/video already exists|project already exists|already exists/i.test(message)) {
    return conflict("PROJECT_EXISTS", message);
  }
  return new ApiError(500, "INTERNAL_ERROR", message, { cause: error });
}

export function errorPayload(error) {
  const apiError = toApiError(error);
  const payload = {
    error: apiError.message,
    code: apiError.code,
  };
  if (apiError.details !== undefined) payload.details = apiError.details;
  return { apiError, payload };
}
