const UUID_SEGMENT_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LONG_HEX_REGEX = /^[0-9a-f]{16,}$/i;
const LONG_OPAQUE_REGEX = /^[A-Za-z0-9_-]{16,}$/;
const SAFE_HEADER_NAMES = new Set(["content-type", "accept"]);

function makeId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `postman-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function parseUrl(endpoint) {
  try {
    return new URL(endpoint);
  } catch {
    return null;
  }
}

function normalizePathSegment(segment) {
  if (!segment) return segment;
  if (/^\d+$/.test(segment)) return ":id";
  if (UUID_SEGMENT_REGEX.test(segment)) return ":id";
  if (LONG_HEX_REGEX.test(segment)) return ":id";
  if (LONG_OPAQUE_REGEX.test(segment)) return ":id";
  return segment;
}

export function templatePathForPostman(endpoint) {
  const parsed = parseUrl(endpoint);
  const pathname = parsed?.pathname || "/";
  const templatedSegments = pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => normalizePathSegment(decodeURIComponent(segment)));

  if (templatedSegments.length === 0) return "/";
  return `/${templatedSegments.join("/")}`;
}

function pathTemplateToSegments(pathTemplate) {
  return pathTemplate.split("/").filter(Boolean);
}

function shouldIncludeRequestBody(requestBody) {
  if (requestBody === null || requestBody === undefined) return false;
  if (typeof requestBody === "string") return requestBody.trim().length > 0;
  if (typeof requestBody === "object") return true;
  return false;
}

function toPostmanBody(requestBody) {
  if (!shouldIncludeRequestBody(requestBody)) return undefined;

  if (typeof requestBody === "object") {
    return {
      mode: "raw",
      raw: JSON.stringify(requestBody, null, 2),
      options: {
        raw: {
          language: "json"
        }
      }
    };
  }

  if (typeof requestBody === "string") {
    try {
      const parsed = JSON.parse(requestBody);
      return {
        mode: "raw",
        raw: JSON.stringify(parsed, null, 2),
        options: {
          raw: {
            language: "json"
          }
        }
      };
    } catch {
      return undefined;
    }
  }

  return undefined;
}

function toPostmanHeaders(requestHeaders = []) {
  if (!Array.isArray(requestHeaders)) return [];

  return requestHeaders
    .filter((header) => header && typeof header.name === "string")
    .map((header) => ({
      key: String(header.name || "").trim(),
      value: String(header.value || "")
    }))
    .filter((header) => {
      const lowerName = header.key.toLowerCase();
      if (!SAFE_HEADER_NAMES.has(lowerName)) return false;
      if (lowerName.includes("auth") || lowerName.includes("token") || lowerName.includes("cookie")) return false;
      if (header.value.includes("[REDACTED]")) return false;
      return true;
    });
}

function hostToVariableName(host) {
  return `baseUrl_${host.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase()}`;
}

function buildRequestUrlObject(entry, pathTemplate, baseUrlVariable) {
  const parsed = parseUrl(entry.endpoint);
  const query = Object.entries(entry.queryParams || {}).map(([key, value]) => ({
    key,
    value: String(value)
  }));
  const pathSegments = pathTemplateToSegments(pathTemplate);

  const queryString = query.length
    ? `?${query
        .map((item) => `${encodeURIComponent(item.key)}=${encodeURIComponent(item.value)}`)
        .join("&")}`
    : "";

  return {
    raw: `{{${baseUrlVariable}}}${pathTemplate}${queryString}`,
    host: [`{{${baseUrlVariable}}}`],
    path: pathSegments,
    query
  };
}

function createRequestItem(entry, pathTemplate, baseUrlVariable) {
  const request = {
    method: entry.method || "GET",
    header: toPostmanHeaders(entry.requestHeaders),
    url: buildRequestUrlObject(entry, pathTemplate, baseUrlVariable)
  };

  const body = toPostmanBody(entry.requestBody);
  if (body) {
    request.body = body;
  }

  return {
    name: `${request.method} ${pathTemplate}`,
    request
  };
}

export function buildPostmanCollection(entries = []) {
  const groupsByHost = new Map();
  const hostSet = new Set();

  for (const entry of entries) {
    const parsed = parseUrl(entry.endpoint);
    if (!parsed) continue;

    const host = parsed.host;
    hostSet.add(host);
    const pathTemplate = templatePathForPostman(entry.endpoint);

    if (!groupsByHost.has(host)) {
      groupsByHost.set(host, new Map());
    }

    const byPath = groupsByHost.get(host);
    if (!byPath.has(pathTemplate)) {
      byPath.set(pathTemplate, []);
    }

    byPath.get(pathTemplate).push(entry);
  }

  const multipleHosts = hostSet.size > 1;
  const item = Array.from(groupsByHost.entries()).map(([host, pathMap]) => {
    const baseUrlVariable = multipleHosts ? hostToVariableName(host) : "baseUrl";

    return {
      name: host,
      item: Array.from(pathMap.entries()).map(([pathTemplate, pathEntries]) => ({
        name: pathTemplate,
        item: pathEntries.map((entry) => createRequestItem(entry, pathTemplate, baseUrlVariable))
      }))
    };
  });

  return {
    info: {
      _postman_id: makeId(),
      name: "RE Recorder Capture",
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
    },
    item
  };
}

export function buildPostmanEnvironment(entries = []) {
  const hosts = [];
  const seenHosts = new Set();

  for (const entry of entries) {
    const parsed = parseUrl(entry.endpoint);
    if (!parsed) continue;
    if (!seenHosts.has(parsed.host)) {
      seenHosts.add(parsed.host);
      hosts.push({ host: parsed.host, origin: parsed.origin });
    }
  }

  const values = [];
  if (hosts.length === 1) {
    values.push({
      key: "baseUrl",
      value: hosts[0].origin,
      enabled: true,
      type: "default"
    });
  } else {
    for (const hostInfo of hosts) {
      values.push({
        key: hostToVariableName(hostInfo.host),
        value: hostInfo.origin,
        enabled: true,
        type: "default"
      });
    }
  }

  return {
    id: makeId(),
    name: "RE Recorder Environment",
    values,
    _postman_variable_scope: "environment",
    _postman_exported_at: new Date().toISOString(),
    _postman_exported_using: "RE Recorder"
  };
}
