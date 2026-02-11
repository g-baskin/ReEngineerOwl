const UUID_FALLBACK = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const JWT_REGEX = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9._-]+\.[A-Za-z0-9._-]+/g;

function safeJsonParse(value) {
  if (!value || typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function sanitizeString(value) {
  if (typeof value !== "string") return value;
  return value.replace(JWT_REGEX, "[REDACTED_JWT]");
}

function sanitizeObject(value) {
  if (Array.isArray(value)) return value.map(sanitizeObject);
  if (!value || typeof value !== "object") return sanitizeString(value);

  const output = {};
  for (const [key, val] of Object.entries(value)) {
    const lowerKey = key.toLowerCase();
    if (
      lowerKey === "authorization" ||
      lowerKey === "cookie" ||
      lowerKey.includes("token") ||
      lowerKey.includes("auth")
    ) {
      output[key] = "[REDACTED]";
      continue;
    }
    output[key] = sanitizeObject(val);
  }
  return output;
}

function parseQueryParams(url) {
  try {
    const parsed = new URL(url);
    const params = {};
    parsed.searchParams.forEach((value, key) => {
      params[key] = sanitizeString(value);
    });
    return params;
  } catch {
    return {};
  }
}

function extractEndpoint(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}

export function normalizeEntries(filteredEntries) {
  return filteredEntries.map((entry, index) => {
    const requestBodyRaw = entry.request?.postData?.text || "";
    const responseBodyRaw = entry._reRecorder?.responseBody || "";

    const requestBodyJson = safeJsonParse(requestBodyRaw);
    const responseBodyJson = safeJsonParse(responseBodyRaw);

    const requestHeaders = sanitizeObject(entry.request?.headers || []);
    const responseHeaders = sanitizeObject(entry.response?.headers || []);

    return {
      id: crypto?.randomUUID?.() || UUID_FALLBACK(),
      index,
      timestamp: entry.startedDateTime,
      method: entry.request?.method || "GET",
      endpoint: extractEndpoint(entry.request?.url || ""),
      queryParams: parseQueryParams(entry.request?.url || ""),
      requestHeaders,
      responseHeaders,
      requestBody: sanitizeObject(requestBodyJson || sanitizeString(requestBodyRaw)),
      responseBody: sanitizeObject(responseBodyJson || sanitizeString(responseBodyRaw)),
      status: Number(entry.response?.status || 0),
      duration: Number(entry.time || 0)
    };
  });
}

function typeOfValue(value) {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function walkSchema(value, prefix, collector) {
  const valueType = typeOfValue(value);
  collector[prefix] = valueType;

  if (valueType === "object") {
    for (const [key, nested] of Object.entries(value)) {
      const next = prefix ? `${prefix}.${key}` : key;
      walkSchema(nested, next, collector);
    }
  }

  if (valueType === "array" && value.length > 0) {
    walkSchema(value[0], `${prefix}[]`, collector);
  }
}

export function buildSchemaSummary(normalizedEntries) {
  return normalizedEntries.map((entry) => {
    const fields = {};
    if (entry.responseBody && typeof entry.responseBody === "object") {
      for (const [key, value] of Object.entries(entry.responseBody)) {
        walkSchema(value, key, fields);
      }
    }

    return {
      endpoint: entry.endpoint,
      method: entry.method,
      status: entry.status,
      fields
    };
  });
}
