import { buildOpenApiSpec, toYamlString } from "./openapi.js";
import { buildPostmanCollection } from "./postman.js";
import { analyzeArchitecture } from "./architecture.js";

export const DEFAULT_SYNC_SETTINGS = {
  serverBaseUrl: "http://localhost:4000",
  orgId: "cmlifnbe000023f8447j6dxow",
  projectId: "cmlifp7zq00073f84s66grg4u",
  devUserEmail: "you@example.com",
  autoUploadOnStop: false
};

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function shouldStripKey(key) {
  const lowered = String(key || "").toLowerCase();
  return lowered.includes("authorization") || lowered.includes("cookie") || lowered === "headers";
}

export function sanitizeArtifactValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeArtifactValue(item));
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const sanitized = {};
  for (const [key, child] of Object.entries(value)) {
    if (shouldStripKey(key)) continue;
    sanitized[key] = sanitizeArtifactValue(child);
  }

  return sanitized;
}

function buildCaptureBundle(payload = {}) {
  const entries = sanitizeArtifactValue(payload.normalizedEntries || []);
  if (!entries.length) {
    throw new Error("No normalized entries available to upload.");
  }

  return {
    capturedAt: payload.savedAt || new Date().toISOString(),
    entries
  };
}

function buildSchemaSummary(payload = {}) {
  const summary = sanitizeArtifactValue(payload.schemaSummary || []);
  return summary.length ? summary : null;
}

function buildOpenApiArtifacts(payload = {}) {
  if (typeof payload?.openapi?.json === "string" && payload?.openapi?.json.trim()) {
    const jsonObject = sanitizeArtifactValue(JSON.parse(payload.openapi.json));
    const json = JSON.stringify(jsonObject, null, 2);
    const yaml = typeof payload?.openapi?.yaml === "string" && payload.openapi.yaml.trim()
      ? payload.openapi.yaml
      : toYamlString(jsonObject);
    return { json, yaml };
  }

  const normalizedEntries = payload.normalizedEntries || [];
  if (!normalizedEntries.length) return { json: null, yaml: null };

  const spec = sanitizeArtifactValue(buildOpenApiSpec(normalizedEntries, payload.schemaSummary || []));
  return {
    json: JSON.stringify(spec, null, 2),
    yaml: toYamlString(spec)
  };
}

function buildPostmanArtifact(payload = {}) {
  const normalizedEntries = payload.normalizedEntries || [];
  if (!normalizedEntries.length) return null;

  const collection = sanitizeArtifactValue(buildPostmanCollection(normalizedEntries));
  return JSON.stringify(collection, null, 2);
}

function buildArchitectureArtifacts(payload = {}) {
  if (typeof payload?.architectureReport?.markdown === "string" && payload.architectureReport.markdown.trim()) {
    const jsonObj = payload?.architectureReport?.json ? sanitizeArtifactValue(payload.architectureReport.json) : null;
    return {
      markdown: payload.architectureReport.markdown,
      json: jsonObj ? JSON.stringify(jsonObj, null, 2) : null
    };
  }

  const normalizedEntries = payload.normalizedEntries || [];
  if (!normalizedEntries.length) return { markdown: null, json: null };

  const report = analyzeArchitecture(normalizedEntries);
  const reportJson = sanitizeArtifactValue(report.json);
  return {
    markdown: report.markdown,
    json: JSON.stringify(reportJson, null, 2)
  };
}

function buildPrdMarkdown(payload = {}) {
  if (typeof payload.prdMarkdown === "string" && payload.prdMarkdown.trim()) {
    return payload.prdMarkdown;
  }

  const workflowLines = (payload.workflowSteps || payload.workflow || [])
    .map(
      (step) =>
        `${step.step}. ${step.name}\n   - Method: ${step.method}\n   - Endpoint: ${step.endpoint}\n   - Description: ${step.summary}`
    )
    .join("\n\n");

  const schemaLines = (payload.schemaSummary || [])
    .map((schema) => {
      const fields = Object.entries(schema.fields || {})
        .map(([field, type]) => `  - ${field}: ${type}`)
        .join("\n");
      return `### ${schema.method} ${schema.endpoint}\n${fields || "  - (No JSON fields detected)"}`;
    })
    .join("\n\n");

  if (!workflowLines && !schemaLines) return null;

  return `# Reverse Engineered Workflow\n\n## Overview\nCaptured ${(payload.normalizedEntries || []).length} API calls.\n\n## Workflow Steps\n${workflowLines || "No workflow steps inferred."}\n\n## Endpoint Schemas\n${schemaLines || "No endpoint schema data available."}\n`;
}


export function buildUploadFormData(payload = {}, metadata = {}, settings = DEFAULT_SYNC_SETTINGS) {
  const formData = new FormData();

  const captureBundle = buildCaptureBundle(payload);
  formData.append("captureBundle", new Blob([JSON.stringify(captureBundle, null, 2)], { type: "application/json" }), "capture.bundle.json");

  const schemaSummary = buildSchemaSummary(payload);
  if (schemaSummary) {
    formData.append("schemaSummary", new Blob([JSON.stringify(schemaSummary, null, 2)], { type: "application/json" }), "schema.summary.json");
  }

  const openapi = buildOpenApiArtifacts(payload);
  if (openapi.json) {
    formData.append("openapiJson", new Blob([openapi.json], { type: "application/json" }), "openapi.json");
  }
  if (openapi.yaml) {
    formData.append("openapiYaml", new Blob([openapi.yaml], { type: "application/yaml" }), "openapi.yaml");
  }

  const postmanCollection = buildPostmanArtifact(payload);
  if (postmanCollection) {
    formData.append(
      "postmanCollection",
      new Blob([postmanCollection], { type: "application/json" }),
      "postman.collection.json"
    );
  }

  const architecture = buildArchitectureArtifacts(payload);
  if (architecture.markdown) {
    formData.append("archMd", new Blob([architecture.markdown], { type: "text/markdown" }), "architecture.report.md");
  }
  if (architecture.json) {
    formData.append("archJson", new Blob([architecture.json], { type: "application/json" }), "architecture.report.json");
  }

  const prdMarkdown = buildPrdMarkdown(payload);
  if (prdMarkdown) {
    formData.append("prdMarkdown", new Blob([prdMarkdown], { type: "text/markdown" }), "PRD.md");
  }

  const title = metadata.title || `Capture ${new Date().toISOString()}`;
  formData.append("title", title);
  if (metadata.notes) formData.append("notes", metadata.notes);

  const stats = {
    requestCount: metadata.requestCount ?? payload.normalizedEntries?.length,
    distinctEndpointCount: metadata.distinctEndpointCount,
    hostCount: metadata.hostCount,
    timeWindowStart: metadata.timeWindowStart,
    timeWindowEnd: metadata.timeWindowEnd
  };

  Object.entries(stats).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    formData.append(key, String(value));
  });

  return {
    formData,
    endpoint: `${settings.serverBaseUrl.replace(/\/$/, "")}/orgs/${settings.orgId}/projects/${settings.projectId}/captures`
  };
}

export async function uploadCaptureSession(payload = {}, metadata = {}, settings = DEFAULT_SYNC_SETTINGS) {
  const mergedSettings = {
    ...DEFAULT_SYNC_SETTINGS,
    ...(settings || {})
  };
  const { formData, endpoint } = buildUploadFormData(payload, metadata, mergedSettings);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "x-user-email": mergedSettings.devUserEmail
    },
    body: formData
  });

  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: body?.error || body?.message || `Upload failed with status ${response.status}`
    };
  }

  return {
    ok: true,
    status: response.status,
    captureId: body?.captureId || body?.id || body?.capture?.id || null
  };
}
