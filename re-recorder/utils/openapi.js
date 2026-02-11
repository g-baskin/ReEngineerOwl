const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NUMERIC_ID_REGEX = /^\d+$/;
const OPAQUE_ID_REGEX = /^[A-Za-z0-9_-]{12,}$/;
const SENSITIVE_KEY_REGEX = /(auth|token|cookie|secret)/i;

function safeJsonParse(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function isEmptyBody(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

function parseEndpoint(endpoint) {
  try {
    return new URL(endpoint);
  } catch {
    return null;
  }
}

function singularize(segment) {
  if (!segment) return "resource";
  if (segment.endsWith("ies")) return `${segment.slice(0, -3)}y`;
  if (segment.endsWith("s") && segment.length > 1) return segment.slice(0, -1);
  return segment;
}

function inferPathParamName(segments, index) {
  const previous = segments[index - 1] || "resource";
  const normalized = singularize(previous).replace(/[^A-Za-z0-9]/g, "");
  if (!normalized) return "id";
  return `${normalized}Id`;
}

function isLikelyPathId(segment) {
  return UUID_REGEX.test(segment) || NUMERIC_ID_REGEX.test(segment) || OPAQUE_ID_REGEX.test(segment);
}

function normalizePath(pathname) {
  const segments = pathname.split("/").filter(Boolean);
  const parameters = [];

  const templatedSegments = segments.map((segment, index) => {
    if (!isLikelyPathId(segment)) return segment;

    const name = inferPathParamName(segments, index);
    parameters.push({
      name,
      in: "path",
      required: true,
      schema: { type: NUMERIC_ID_REGEX.test(segment) ? "integer" : "string" },
      example: NUMERIC_ID_REGEX.test(segment) ? Number(segment) : segment
    });

    return `{${name}}`;
  });

  return {
    path: `/${templatedSegments.join("/")}` || "/",
    parameters
  };
}

function normalizeMethod(method) {
  return String(method || "get").toLowerCase();
}

function scrubHeaders(headers) {
  if (!headers || typeof headers !== "object") return undefined;

  if (Array.isArray(headers)) {
    return headers
      .filter((header) => !SENSITIVE_KEY_REGEX.test(String(header?.name || "")))
      .map((header) => ({ name: header.name || "", value: header.value || "" }));
  }

  const cleaned = {};
  for (const [key, value] of Object.entries(headers)) {
    if (SENSITIVE_KEY_REGEX.test(key)) continue;
    cleaned[key] = value;
  }
  return cleaned;
}

function normalizeSampleBody(value) {
  if (typeof value === "string") {
    const parsed = safeJsonParse(value);
    return parsed === null ? value : parsed;
  }
  return value;
}

function ensureArrayType(type) {
  if (!type) return [];
  return Array.isArray(type) ? type : [type];
}

function uniqueTypes(...types) {
  return [...new Set(types.flatMap(ensureArrayType))].filter(Boolean);
}

function inferSchema(value) {
  if (value === null) return { type: "null" };

  if (Array.isArray(value)) {
    if (!value.length) return { type: "array", items: {} };
    let itemsSchema = inferSchema(value[0]);
    for (const item of value.slice(1)) {
      itemsSchema = mergeSchemas(itemsSchema, inferSchema(item));
    }
    return {
      type: "array",
      items: itemsSchema
    };
  }

  if (typeof value === "object") {
    const properties = {};
    const required = [];

    for (const [key, nestedValue] of Object.entries(value)) {
      properties[key] = inferSchema(nestedValue);
      required.push(key);
    }

    return {
      type: "object",
      properties,
      required,
      additionalProperties: false
    };
  }

  if (typeof value === "number") {
    return {
      type: Number.isInteger(value) ? "integer" : "number",
      example: value
    };
  }

  if (typeof value === "boolean") {
    return { type: "boolean", example: value };
  }

  return {
    type: "string",
    example: String(value)
  };
}

function mergeObjectProperties(left = {}, right = {}) {
  const merged = { ...left };
  for (const [key, value] of Object.entries(right)) {
    if (!merged[key]) {
      merged[key] = value;
      continue;
    }
    merged[key] = mergeSchemas(merged[key], value);
  }
  return merged;
}

function mergeSchemas(left, right) {
  if (!left) return right;
  if (!right) return left;

  const mergedTypes = uniqueTypes(left.type, right.type);
  const merged = {
    ...left,
    ...right
  };

  if (mergedTypes.length === 1) merged.type = mergedTypes[0];
  if (mergedTypes.length > 1) merged.type = mergedTypes;

  if (merged.type === "object" || (Array.isArray(merged.type) && merged.type.includes("object"))) {
    merged.properties = mergeObjectProperties(left.properties, right.properties);
    const leftRequired = Array.isArray(left.required) ? left.required : [];
    const rightRequired = Array.isArray(right.required) ? right.required : [];
    merged.required = [...new Set([...leftRequired, ...rightRequired])];
    merged.additionalProperties = false;
  }

  if (merged.type === "array" || (Array.isArray(merged.type) && merged.type.includes("array"))) {
    merged.items = mergeSchemas(left.items || {}, right.items || {});
  }

  if (left.example !== undefined) merged.example = left.example;
  if (merged.example === undefined && right.example !== undefined) merged.example = right.example;

  return merged;
}

function createSchemaRegistry() {
  const fingerprints = new Map();
  const schemas = {};

  function stable(value) {
    if (Array.isArray(value)) return value.map(stable);
    if (!value || typeof value !== "object") return value;

    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = stable(value[key]);
        return acc;
      }, {});
  }

  function makeName(base) {
    const safe = base.replace(/[^A-Za-z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
    return safe || "Schema";
  }

  function register(baseName, schema) {
    const fingerprint = JSON.stringify(stable(schema));
    if (fingerprints.has(fingerprint)) {
      return fingerprints.get(fingerprint);
    }

    const normalizedBase = makeName(baseName);
    let finalName = normalizedBase;
    let index = 2;
    while (schemas[finalName]) {
      finalName = `${normalizedBase}_${index}`;
      index += 1;
    }

    schemas[finalName] = schema;
    fingerprints.set(fingerprint, finalName);
    return finalName;
  }

  return {
    register,
    schemas
  };
}

function operationIdFor(method, path) {
  const pathPart = path
    .replace(/[{}]/g, "")
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.replace(/[^A-Za-z0-9]/g, "_"))
    .join("_");

  return `${normalizeMethod(method)}_${pathPart || "root"}`;
}

function collectQueryParameters(entry, url) {
  const parameters = new Map();

  const fromQueryObject = entry.queryParams && typeof entry.queryParams === "object" ? entry.queryParams : {};
  for (const [name, value] of Object.entries(fromQueryObject)) {
    parameters.set(name, value);
  }

  if (url) {
    for (const [name, value] of url.searchParams.entries()) {
      if (!parameters.has(name)) parameters.set(name, value);
    }
  }

  return [...parameters.entries()].map(([name, value]) => ({
    name,
    in: "query",
    required: false,
    schema: {
      type: NUMERIC_ID_REGEX.test(String(value)) ? "integer" : "string"
    },
    example: NUMERIC_ID_REGEX.test(String(value)) ? Number(value) : value
  }));
}

function createResponseObject(samples, method, templatedPath, schemaRegistry) {
  const responses = {};

  for (const sample of samples) {
    const status = String(sample.status || 200);
    const bodyCaptured = sample.bodyCaptured !== false && !isEmptyBody(sample.responseBody);
    const normalizedBody = normalizeSampleBody(sample.responseBody);

    if (!responses[status]) {
      responses[status] = {
        description: bodyCaptured ? `Captured HTTP ${status} response.` : "Body not captured; metadata only"
      };
    }

    if (bodyCaptured && (typeof normalizedBody === "object" || Array.isArray(normalizedBody))) {
      const schema = inferSchema(normalizedBody);
      const schemaName = schemaRegistry.register(
        `Response_${status}_${method}_${templatedPath}`,
        schema
      );

      responses[status].content = {
        "application/json": {
          schema: { $ref: `#/components/schemas/${schemaName}` },
          example: normalizedBody
        }
      };
    }
  }

  if (!Object.keys(responses).length) {
    responses["200"] = { description: "Body not captured; metadata only" };
  }

  return responses;
}

function createRequestBody(samples, method, templatedPath, schemaRegistry) {
  const requestSamples = samples
    .map((sample) => normalizeSampleBody(sample.requestBody))
    .filter((body) => !isEmptyBody(body));

  if (!requestSamples.length) return undefined;

  let schema = inferSchema(requestSamples[0]);
  for (const sample of requestSamples.slice(1)) {
    schema = mergeSchemas(schema, inferSchema(sample));
  }

  const schemaName = schemaRegistry.register(`Request_${method}_${templatedPath}`, schema);

  return {
    required: true,
    content: {
      "application/json": {
        schema: {
          $ref: `#/components/schemas/${schemaName}`
        },
        example: requestSamples[0]
      }
    }
  };
}

function buildOperation(samples, method, templatedPath, pathParams, schemaRegistry) {
  const first = samples[0] || {};
  const queryParams = collectQueryParameters(first, parseEndpoint(first.endpoint));

  return {
    summary: `Captured ${method.toUpperCase()} ${templatedPath}`,
    operationId: operationIdFor(method, templatedPath),
    parameters: [...pathParams, ...queryParams],
    requestBody: createRequestBody(samples, method, templatedPath, schemaRegistry),
    responses: createResponseObject(samples, method, templatedPath, schemaRegistry)
  };
}

function compact(value) {
  if (!value || typeof value !== "object") return value;
  const output = { ...value };
  for (const [key, nested] of Object.entries(output)) {
    if (nested === undefined) delete output[key];
    if (nested && typeof nested === "object" && !Array.isArray(nested) && Object.keys(nested).length === 0) {
      delete output[key];
    }
  }
  return output;
}

export function buildOpenApiSpec(normalizedEntries = [], schemaSummary = []) {
  const schemaRegistry = createSchemaRegistry();
  const groups = new Map();
  const serverSet = new Set();

  for (const rawEntry of normalizedEntries) {
    const entry = {
      ...rawEntry,
      requestHeaders: scrubHeaders(rawEntry.requestHeaders),
      responseHeaders: scrubHeaders(rawEntry.responseHeaders)
    };

    const parsedUrl = parseEndpoint(entry.endpoint || "");
    if (!parsedUrl) continue;

    serverSet.add(parsedUrl.origin);

    const { path, parameters } = normalizePath(parsedUrl.pathname || "/");
    const method = normalizeMethod(entry.method);
    const key = `${method} ${path}`;

    if (!groups.has(key)) {
      groups.set(key, {
        method,
        path,
        parameters,
        samples: []
      });
    }

    groups.get(key).samples.push({
      ...entry,
      endpoint: `${parsedUrl.origin}${parsedUrl.pathname}${parsedUrl.search}`
    });
  }

  const paths = {};
  for (const group of groups.values()) {
    if (!paths[group.path]) paths[group.path] = {};
    paths[group.path][group.method] = compact(
      buildOperation(group.samples, group.method, group.path, group.parameters, schemaRegistry)
    );
  }

  // Fallback to schema.summary.json when no captures are present.
  if (!Object.keys(paths).length && Array.isArray(schemaSummary)) {
    for (const summary of schemaSummary) {
      const parsedUrl = parseEndpoint(summary.endpoint || "");
      if (!parsedUrl) continue;
      serverSet.add(parsedUrl.origin);
      const { path } = normalizePath(parsedUrl.pathname || "/");
      const method = normalizeMethod(summary.method || "get");
      if (!paths[path]) paths[path] = {};
      paths[path][method] = {
        summary: `Captured ${method.toUpperCase()} ${path}`,
        operationId: operationIdFor(method, path),
        responses: {
          [String(summary.status || 200)]: {
            description: "Body not captured; metadata only"
          }
        }
      };
    }
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "RE Recorder Captured API",
      version: "1.0.0",
      description:
        "Generated from RE Recorder network captures. Sensitive auth/token/cookie-like headers are excluded."
    },
    servers: [...serverSet].sort().map((url) => ({ url })),
    paths,
    components: {
      schemas: schemaRegistry.schemas
    }
  };
}

function yamlEscapeString(value) {
  return JSON.stringify(String(value));
}

function toYaml(value, indent = 0) {
  const spacing = "  ".repeat(indent);

  if (Array.isArray(value)) {
    if (!value.length) return "[]";
    return value
      .map((item) => {
        if (item && typeof item === "object") {
          const nested = toYaml(item, indent + 1);
          return `${spacing}-\n${nested}`;
        }
        return `${spacing}- ${toYaml(item, 0)}`;
      })
      .join("\n");
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    if (!entries.length) return "{}";

    return entries
      .map(([key, nested]) => {
        const safeKey = /^[A-Za-z0-9_-]+$/.test(key) ? key : yamlEscapeString(key);
        if (nested && typeof nested === "object") {
          const nestedYaml = toYaml(nested, indent + 1);
          return `${spacing}${safeKey}:\n${nestedYaml}`;
        }
        return `${spacing}${safeKey}: ${toYaml(nested, 0)}`;
      })
      .join("\n");
  }

  if (typeof value === "string") return yamlEscapeString(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null) return "null";
  return "\"\"";
}

export function toYamlString(value) {
  return `${toYaml(value)}\n`;
}
