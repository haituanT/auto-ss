const AUTH_TOKEN = String(import.meta.env.VITE_STUDIO_AUTH_TOKEN || "").trim();

function requestHeaders(headers, hasJsonBody = false) {
  const next = new Headers(headers || {});
  if (hasJsonBody && !next.has("Content-Type")) next.set("Content-Type", "application/json");
  if (AUTH_TOKEN) next.set("X-Studio-Token", AUTH_TOKEN);
  return next;
}

async function responseData(response, mode = "json") {
  const data = mode === "text"
    ? await response.text()
    : await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = mode === "text" ? data : data?.error;
    const error = new Error(message || response.statusText);
    error.status = response.status;
    error.code = mode === "text" ? "" : data?.code || "";
    error.details = mode === "text" ? undefined : data?.details;
    throw error;
  }
  return data;
}

export async function requestJson(path, options = {}) {
  const bodyIsJson = options.body != null && typeof options.body === "string";
  const response = await fetch(path, {
    ...options,
    headers: requestHeaders(options.headers, bodyIsJson),
  });
  return responseData(response);
}

export async function uploadForm(path, formData, options = {}) {
  const response = await fetch(path, {
    ...options,
    method: options.method || "POST",
    body: formData,
    headers: requestHeaders(options.headers),
  });
  return responseData(response);
}

export async function requestText(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: requestHeaders(options.headers, false),
  });
  return responseData(response, "text");
}
