import { buildOpenApiSpec, toYamlString } from "./openapi.js";
import { buildPostmanCollection, buildPostmanEnvironment } from "./postman.js";

function downloadFile(filename, content, type = "application/json") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function mapHeaders(headers = []) {
  if (!Array.isArray(headers)) return [];
  return headers.map((h) => ({ name: h.name || "", value: h.value || "" }));
}

function normalizeSessionInput(value, schemaSummaryArg) {
  if (Array.isArray(value)) {
    return {
      rawEntries: value,
      filteredEntries: [],
      normalizedEntries: value,
      workflowSteps: [],
      schemaSummary: schemaSummaryArg || []
    };
  }

  return {
    rawEntries: value?.rawEntries || [],
    filteredEntries: value?.filteredEntries || [],
    normalizedEntries: value?.normalizedEntries || [],
    workflowSteps: value?.workflowSteps || value?.workflow || [],
    schemaSummary: value?.schemaSummary || schemaSummaryArg || []
  };
}

export function exportHar(sessionOrEntries) {
  const session = normalizeSessionInput(sessionOrEntries);
  const rawEntries = session.rawEntries || [];

  const har = {
    log: {
      version: "1.2",
      creator: {
        name: "RE Recorder",
        version: "1.0.0"
      },
      pages: [
        {
          startedDateTime: rawEntries[0]?.startedDateTime || new Date().toISOString(),
          id: "page_1",
          title: "Captured Session",
          pageTimings: {}
        }
      ],
      entries: rawEntries.map((entry) => ({
        pageref: "page_1",
        startedDateTime: entry.startedDateTime,
        time: Number(entry.time || 0),
        request: {
          method: entry.request?.method || "GET",
          url: entry.request?.url || "",
          httpVersion: "HTTP/1.1",
          headers: mapHeaders(entry.request?.headers),
          queryString: [],
          headersSize: -1,
          bodySize: entry.request?.bodySize || -1,
          postData: {
            mimeType: entry.request?.postData?.mimeType || "",
            text: entry.request?.postData?.text || ""
          }
        },
        response: {
          status: Number(entry.response?.status || 0),
          statusText: entry.response?.statusText || "",
          httpVersion: "HTTP/1.1",
          headers: mapHeaders(entry.response?.headers),
          content: {
            size: Number(entry.response?.content?.size || 0),
            mimeType: entry.response?.content?.mimeType || "",
            text: entry._reRecorder?.responseBody || ""
          },
          redirectURL: "",
          headersSize: -1,
          bodySize: Number(entry.response?.bodySize || 0)
        },
        cache: {},
        timings: {
          blocked: entry.timings?.blocked ?? -1,
          dns: entry.timings?.dns ?? -1,
          connect: entry.timings?.connect ?? -1,
          send: entry.timings?.send ?? 0,
          wait: entry.timings?.wait ?? 0,
          receive: entry.timings?.receive ?? 0,
          ssl: entry.timings?.ssl ?? -1
        }
      }))
    }
  };

  downloadFile("capture.har", JSON.stringify(har, null, 2), "application/json");
}

export function exportBundle(sessionOrEntries, schemaSummaryArg) {
  const session = normalizeSessionInput(sessionOrEntries, schemaSummaryArg);

  downloadFile(
    "capture.bundle.json",
    JSON.stringify({ capturedAt: new Date().toISOString(), entries: session.normalizedEntries }, null, 2),
    "application/json"
  );

  downloadFile("schema.summary.json", JSON.stringify(session.schemaSummary, null, 2), "application/json");
}

export function exportMarkdown(sessionOrSteps, schemaSummaryArg, normalizedCountArg) {
  const session =
    Array.isArray(sessionOrSteps) && typeof sessionOrSteps[0]?.step === "number"
      ? {
          workflowSteps: sessionOrSteps,
          schemaSummary: schemaSummaryArg || [],
          normalizedEntries: new Array(normalizedCountArg || 0)
        }
      : normalizeSessionInput(sessionOrSteps, schemaSummaryArg);

  const workflowLines = (session.workflowSteps || [])
    .map(
      (step) =>
        `${step.step}. ${step.name}\n   - Method: ${step.method}\n   - Endpoint: ${step.endpoint}\n   - Description: ${step.summary}`
    )
    .join("\n\n");

  const schemaLines = (session.schemaSummary || [])
    .map((schema) => {
      const fields = Object.entries(schema.fields || {})
        .map(([field, type]) => `  - ${field}: ${type}`)
        .join("\n");
      return `### ${schema.method} ${schema.endpoint}\n${fields || "  - (No JSON fields detected)"}`;
    })
    .join("\n\n");

  const content = `# Reverse Engineered Workflow

## Overview
Captured ${(session.normalizedEntries || []).length} API calls.

## Workflow Steps
${workflowLines || "No workflow steps inferred."}

## Endpoint Schemas
${schemaLines || "No endpoint schema data available."}
`;

  downloadFile("PRD.md", content, "text/markdown");
}

export function exportOpenApiJson(normalizedEntries, schemaSummary) {
  const spec = buildOpenApiSpec(normalizedEntries, schemaSummary);
  downloadFile("openapi.json", JSON.stringify(spec, null, 2), "application/json");
  return spec;
}

export function exportOpenApiYaml(normalizedEntries, schemaSummary) {
  const spec = buildOpenApiSpec(normalizedEntries, schemaSummary);
  downloadFile("openapi.yaml", toYamlString(spec), "application/yaml");
  return spec;
}

export function exportOpenApiJsonContent(content) {
  downloadFile("openapi.json", content, "application/json");
}

export function exportOpenApiYamlContent(content) {
  downloadFile("openapi.yaml", content, "application/yaml");
}

export function exportArchitectureMarkdown(content) {
  downloadFile("architecture.report.md", content, "text/markdown");
}

export function exportArchitectureJson(content) {
  downloadFile("architecture.report.json", content, "application/json");
}


export function exportPostmanCollection(normalizedEntries) {
  const collection = buildPostmanCollection(normalizedEntries);
  downloadFile("postman.collection.json", JSON.stringify(collection, null, 2), "application/json");
  return collection;
}

export function exportPostmanEnvironment(normalizedEntries) {
  const environment = buildPostmanEnvironment(normalizedEntries);
  downloadFile("postman.environment.json", JSON.stringify(environment, null, 2), "application/json");
  return environment;
}


export function exportPostmanCollectionContent(content) {
  downloadFile("postman.collection.json", content, "application/json");
}

export function exportPostmanEnvironmentContent(content) {
  downloadFile("postman.environment.json", content, "application/json");
}
