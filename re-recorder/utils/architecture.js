const ID_SEGMENT_REGEX = /^(?:\d+|[0-9a-f]{8,}|[0-9a-f]{8}-[0-9a-f-]{27,}|[A-Za-z0-9_-]{16,})$/i;
const POLLING_MIN_INTERVAL_S = 1;
const POLLING_MAX_INTERVAL_S = 10;

function toUrl(value) {
  if (!value) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function toTimestamp(value) {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function bodySize(value) {
  if (value == null) return 0;
  if (typeof value === "string") return value.length;
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function stdDev(values, avg) {
  if (!values.length) return 0;
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function hostAliasFactory(entries) {
  const aliases = new Map();
  let next = 1;
  for (const entry of entries) {
    const parsed = toUrl(entry.endpoint || entry.url || "");
    if (!parsed) continue;
    const host = parsed.host;
    if (!aliases.has(host)) {
      aliases.set(host, `captured-host-${next}`);
      next += 1;
    }
  }
  return aliases;
}

export function templatePath(urlOrPath = "") {
  const parsed = toUrl(urlOrPath);
  const pathname = parsed?.pathname || String(urlOrPath || "").split("?")[0] || "/";
  const segments = pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      if (ID_SEGMENT_REGEX.test(segment)) {
        return "{id}";
      }
      return segment.toLowerCase();
    });
  return `/${segments.join("/")}` || "/";
}

function anonymizeTemplatePath(pathname) {
  const genericKeywords = new Set([
    "api",
    "v1",
    "v2",
    "auth",
    "login",
    "session",
    "token",
    "jobs",
    "job",
    "status",
    "search",
    "filter",
    "sort",
    "results",
    "result",
    "health"
  ]);

  const segments = pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      if (segment === "{id}") return "{id}";
      if (/^v\d+$/i.test(segment) || genericKeywords.has(segment)) return segment;
      return "resource";
    });

  return `/${segments.join("/")}` || "/";
}

function withSanitizedEntries(entries) {
  const hostAliases = hostAliasFactory(entries);
  return entries.map((entry) => {
    const parsed = toUrl(entry.endpoint || entry.url || "");
    const host = parsed?.host || "unknown-host";
    const alias = hostAliases.get(host) || "captured-host-unknown";
    const pathTemplate = templatePath(entry.endpoint || entry.url || "");

    return {
      method: String(entry.method || "GET").toUpperCase(),
      status: Number(entry.status || 0),
      duration: Number(entry.duration ?? entry.durationMs ?? 0),
      timestamp: toTimestamp(entry.timestamp),
      queryParams: entry.queryParams || {},
      requestBody: entry.requestBody,
      responseBody: entry.responseBody,
      responseHeaders: entry.responseHeaders,
      requestHeaders: entry.requestHeaders,
      hostAlias: alias,
      pathTemplate,
      endpointShape: `${alias}${anonymizeTemplatePath(pathTemplate)}`,
      rawPath: parsed?.pathname || pathTemplate
    };
  });
}

function detectPolling(entries) {
  const groups = new Map();
  for (const entry of entries) {
    if (entry.method !== "GET" || !entry.timestamp) continue;
    const key = `${entry.hostAlias} ${entry.pathTemplate}`;
    const list = groups.get(key) || [];
    list.push(entry);
    groups.set(key, list);
  }

  const findings = [];
  for (const [key, calls] of groups) {
    if (calls.length < 3) continue;
    const sorted = [...calls].sort((a, b) => a.timestamp - b.timestamp);
    const deltas = [];
    for (let index = 1; index < sorted.length; index += 1) {
      const seconds = (sorted[index].timestamp - sorted[index - 1].timestamp) / 1000;
      if (seconds > 0) deltas.push(seconds);
    }
    if (deltas.length < 2) continue;

    const deltaMedian = median(deltas);
    const avg = deltas.reduce((sum, value) => sum + value, 0) / deltas.length;
    const variation = avg > 0 ? stdDev(deltas, avg) / avg : 1;
    if (deltaMedian < POLLING_MIN_INTERVAL_S || deltaMedian > POLLING_MAX_INTERVAL_S) continue;

    let confidence = "Low";
    if (variation < 0.35) confidence = "High";
    else if (variation < 0.6) confidence = "Medium";

    findings.push({
      confidence,
      evidence: `${key} called ${calls.length} times with median interval ${deltaMedian.toFixed(1)}s`
    });
  }

  return findings;
}

function detectPagination(entries) {
  const keys = ["page", "limit", "offset", "cursor", "next", "after"];
  const matches = [];

  for (const entry of entries) {
    const params = entry.queryParams || {};
    const present = keys.filter((key) => Object.prototype.hasOwnProperty.call(params, key));
    if (!present.length) continue;
    matches.push({ entry, present });
  }

  if (matches.length < 2) return null;

  const changed = new Set();
  const valueTracker = new Map();
  for (const match of matches) {
    for (const key of match.present) {
      const trackerKey = `${match.entry.hostAlias} ${match.entry.pathTemplate} ${key}`;
      const values = valueTracker.get(trackerKey) || new Set();
      values.add(String(match.entry.queryParams[key]));
      valueTracker.set(trackerKey, values);
      if (values.size > 1) changed.add(trackerKey);
    }
  }

  if (!changed.size) return null;
  return {
    confidence: changed.size >= 2 ? "High" : "Medium",
    evidence: `${matches.length} calls contained pagination params; ${changed.size} endpoint/param combinations changed values`
  };
}

function detectSearch(entries) {
  const keys = ["q", "query", "search", "filter", "sort", "orderBy"];
  let hits = 0;
  for (const entry of entries) {
    if (Object.keys(entry.queryParams || {}).some((key) => keys.includes(key))) {
      hits += 1;
    }
  }
  if (!hits) return null;
  return {
    confidence: hits >= 4 ? "High" : "Medium",
    evidence: `${hits} requests used search/filter-style query params (${keys.join(", ")})`
  };
}

function detectRestPatterns(entries) {
  const byPath = new Map();
  for (const entry of entries) {
    const base = entry.pathTemplate.replace(/\/\{id\}(?:\/)?$/, "");
    const record = byPath.get(base) || { methods: new Set(), hasItemRoute: false, hasListRoute: false };
    record.methods.add(entry.method);
    if (entry.pathTemplate.endsWith("/{id}")) record.hasItemRoute = true;
    else record.hasListRoute = true;
    byPath.set(base, record);
  }

  const candidates = [...byPath.values()].filter((item) => item.hasItemRoute && item.hasListRoute && item.methods.size >= 2);
  if (!candidates.length) return null;

  const comprehensive = candidates.some((item) => ["GET", "POST", "PUT", "PATCH", "DELETE"].some((method) => item.methods.has(method)));
  return {
    confidence: comprehensive ? "High" : "Medium",
    evidence: `${candidates.length} resource groups showed list/item path templates and multi-method usage`
  };
}

function detectAuthHints(entries) {
  const forbiddenCount = entries.filter((entry) => entry.status === 401 || entry.status === 403).length;
  const authPathCount = entries.filter((entry) => /\/(login|auth|session|token)(\/|$)/i.test(entry.rawPath)).length;

  let redactedAuthHeaders = 0;
  for (const entry of entries) {
    if (entry.hadAuthHeader) {
      redactedAuthHeaders += 1;
      continue;
    }

    const headers = Array.isArray(entry.requestHeaders)
      ? entry.requestHeaders
      : Object.entries(entry.requestHeaders || {}).map(([name, value]) => ({ name, value }));

    const found = headers.some((header) => /authorization|cookie|token|auth/i.test(String(header.name || "")));
    if (found) redactedAuthHeaders += 1;
  }

  if (!forbiddenCount && !authPathCount && !redactedAuthHeaders) return null;
  return {
    confidence: forbiddenCount > 0 || redactedAuthHeaders > 0 ? "Medium" : "Low",
    evidence: `${forbiddenCount} calls returned 401/403, ${authPathCount} auth-style paths observed, ${redactedAuthHeaders} requests carried auth-related headers (values redacted)`
  };
}

function detectRateLimiting(entries) {
  const status429 = entries.filter((entry) => entry.status === 429).length;
  let retryAfter = 0;

  for (const entry of entries) {
    const headers = Array.isArray(entry.responseHeaders)
      ? entry.responseHeaders
      : Object.entries(entry.responseHeaders || {}).map(([name, value]) => ({ name, value }));
    if (headers.some((header) => String(header.name || "").toLowerCase() === "retry-after")) {
      retryAfter += 1;
    }
  }

  if (!status429 && !retryAfter) return null;
  return {
    confidence: status429 > 0 ? "High" : "Medium",
    evidence: `${status429} responses had 429 status; Retry-After header observed in ${retryAfter} responses (values omitted)`
  };
}

function detectCaching(entries) {
  const groups = new Map();
  for (const entry of entries) {
    if (entry.method !== "GET") continue;
    const key = `${entry.hostAlias} ${entry.pathTemplate}`;
    const list = groups.get(key) || [];
    list.push(entry);
    groups.set(key, list);
  }

  let fastRepeatGroups = 0;
  let cacheHeaderHits = 0;
  for (const calls of groups.values()) {
    if (calls.length >= 3 && calls.every((item) => item.duration > 0 && item.duration <= 120)) {
      fastRepeatGroups += 1;
    }

    for (const call of calls) {
      const headers = Array.isArray(call.responseHeaders)
        ? call.responseHeaders
        : Object.entries(call.responseHeaders || {}).map(([name, value]) => ({ name, value }));
      if (headers.some((header) => /etag|cache-control/i.test(String(header.name || "")))) {
        cacheHeaderHits += 1;
      }
    }
  }

  if (!fastRepeatGroups && !cacheHeaderHits) return null;
  return {
    confidence: fastRepeatGroups > 0 && cacheHeaderHits > 0 ? "High" : "Low",
    evidence: `${fastRepeatGroups} repeated GET groups were consistently fast; caching headers observed on ${cacheHeaderHits} responses`
  };
}

function detectDataComplexity(entries) {
  let maxDepth = 0;
  let maxKeys = 0;
  const schemaFingerprints = new Set();

  function walk(value, depth) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      maxDepth = Math.max(maxDepth, depth);
      if (value.length) walk(value[0], depth + 1);
      return;
    }

    const keys = Object.keys(value);
    maxKeys = Math.max(maxKeys, keys.length);
    maxDepth = Math.max(maxDepth, depth);
    for (const nested of Object.values(value)) {
      walk(nested, depth + 1);
    }
  }

  for (const entry of entries) {
    if (!entry.responseBody || typeof entry.responseBody !== "object") continue;
    walk(entry.responseBody, 1);
    schemaFingerprints.add(Object.keys(entry.responseBody).sort().join("|"));
  }

  return {
    confidence: maxDepth >= 4 || schemaFingerprints.size >= 10 ? "High" : "Medium",
    evidence: `max JSON depth ${maxDepth}, max top-level key count ${maxKeys}, distinct response schema signatures ${schemaFingerprints.size}`
  };
}

function detectJobs(entries, pollingFindings) {
  const triggerCalls = entries.filter(
    (entry) => ["POST", "PUT", "PATCH"].includes(entry.method) && [200, 201, 202].includes(entry.status)
  );

  const pollingSignals = pollingFindings.length;
  const statusLikeGets = entries.filter(
    (entry) => entry.method === "GET" && /status|progress|poll/i.test(entry.rawPath)
  );
  const jobPathSignals = entries.filter((entry) => /job|status|progress|result|output/i.test(entry.rawPath)).length;

  let finalGrowth = false;
  let finalEndpointSeen = false;
  for (const entry of entries) {
    if (entry.method !== "GET") continue;
    if (!/result|output|final|download|complete/i.test(entry.rawPath)) continue;
    finalEndpointSeen = true;
    const finalSize = bodySize(entry.responseBody);
    const peerSizes = entries
      .filter((candidate) => candidate.method === "GET" && candidate.hostAlias === entry.hostAlias)
      .map((candidate) => bodySize(candidate.responseBody));
    const baseline = median(peerSizes);
    if (finalSize > baseline * 1.5 && finalSize > 150) {
      finalGrowth = true;
      break;
    }
  }

  if (!triggerCalls.length || (!pollingSignals && statusLikeGets.length < 2 && jobPathSignals < 2)) return null;

  const confidence =
    triggerCalls.length && (pollingSignals || statusLikeGets.length >= 2) && (finalGrowth || finalEndpointSeen)
      ? "High"
      : "Medium";
  return {
    confidence,
    evidence: `${triggerCalls.length} write operations looked like job triggers; ${pollingSignals} polling signatures and ${jobPathSignals} job/status-like paths observed`
  };
}

function detectBackgroundProcessing(entries, jobPattern) {
  const longCalls = entries.filter((entry) => entry.duration >= 4000).length;
  if (!longCalls && !jobPattern) return null;
  return {
    confidence: longCalls >= 2 || jobPattern?.confidence === "High" ? "High" : "Medium",
    evidence: `${longCalls} requests exceeded 4s duration; asynchronous job cues ${jobPattern ? "present" : "not present"}`
  };
}

function summarizeOverview(entries) {
  const hosts = new Set(entries.map((entry) => entry.hostAlias));
  const endpointShapes = new Set(entries.map((entry) => `${entry.method} ${entry.endpointShape}`));
  const timestamps = entries.map((entry) => entry.timestamp).filter(Boolean);
  const minTime = timestamps.length ? new Date(Math.min(...timestamps)).toISOString() : "n/a";
  const maxTime = timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : "n/a";

  return {
    callCount: entries.length,
    distinctHosts: hosts.size,
    distinctEndpointShapes: endpointShapes.size,
    timeWindow: { start: minTime, end: maxTime }
  };
}

function buildRecommendations(patterns) {
  const includes = (name) => patterns.some((pattern) => pattern.name === name);
  return {
    apiLayer: "Implement a versioned API layer with explicit request validation, response contracts, and stable path templates.",
    auth: includes("Auth boundary hints")
      ? "Add a dedicated authentication boundary (session/token validation middleware, role checks, and explicit unauthorized/forbidden handling)."
      : "Plan for an authentication boundary even if not visible in this capture (session/token middleware and authorization checks).",
    db: "Use a transactional data store for core resources and keep schema migrations versioned.",
    backgroundJobs: includes("Async job orchestration") || includes("Background processing")
      ? "Introduce a job queue + worker pool for long-running tasks and expose job status endpoints."
      : "Evaluate whether background workers are needed for heavy operations as feature scope grows.",
    cache: includes("Caching hints")
      ? "Add cache strategy (ETag/cache-control and selective in-memory/edge caching for hot reads)."
      : "Consider cache primitives for repeated GET routes if latency or cost become bottlenecks.",
    observability: "Implement structured logging, trace IDs, request metrics (latency/error rates), and alerting on 4xx/5xx spikes."
  };
}

function buildChecklist(patterns) {
  const has = (name) => patterns.some((pattern) => pattern.name === name);
  const checklist = [
    "Define canonical resource path templates and method semantics for list/item operations.",
    "Add centralized validation + error model for API responses.",
    "Instrument latency, error-rate, and throughput dashboards for every major endpoint.",
    "Document pagination strategy (cursor or offset) and enforce consistent defaults.",
    "Create contract tests for high-traffic endpoint templates."
  ];

  if (has("Async job orchestration") || has("Background processing")) {
    checklist.push("Implement job table with status fields (queued/running/succeeded/failed), timestamps, and failure reason.");
    checklist.push("Implement /jobs/{id}/status polling endpoint with clear retry guidance.");
    checklist.push("Separate synchronous request handling from worker execution via queue.");
  }

  if (has("Pagination")) {
    checklist.push("Standardize pagination response envelope (items + next cursor/offset metadata).");
  }

  if (has("Search / filtering")) {
    checklist.push("Define allowlisted search and filter parameters with indexed query paths.");
  }

  if (has("Rate limiting hints")) {
    checklist.push("Apply rate-limit middleware and return Retry-After consistently for throttled clients.");
  }

  return checklist;
}

function toMarkdown(report) {
  const patternLines = report.patterns.length
    ? report.patterns
        .map(
          (pattern) =>
            `- **${pattern.name}** — Confidence: **${pattern.confidence}**\n  - Evidence: ${pattern.evidence}`
        )
        .join("\n")
    : "- No strong architectural patterns detected from this sample.";

  const recommendationLines = [
    `- **API layer:** ${report.recommendations.apiLayer}`,
    `- **Auth:** ${report.recommendations.auth}`,
    `- **Database:** ${report.recommendations.db}`,
    `- **Background jobs/worker:** ${report.recommendations.backgroundJobs}`,
    `- **Cache:** ${report.recommendations.cache}`,
    `- **Observability/logging:** ${report.recommendations.observability}`
  ].join("\n");

  const checklistLines = report.checklist.map((line) => `- [ ] ${line}`).join("\n");
  const endpointLines = report.appendix.endpointShapes.map((shape) => `- ${shape}`).join("\n") || "- No endpoint shapes available";

  return `# Architecture Intelligence Report

## Overview
- Captured calls: ${report.overview.callCount}
- Distinct hosts: ${report.overview.distinctHosts}
- Distinct endpoint shapes: ${report.overview.distinctEndpointShapes}
- Time window: ${report.overview.timeWindow.start} → ${report.overview.timeWindow.end}

## Detected Patterns
${patternLines}

## Recommended Reference Architecture
${recommendationLines}

## Suggested MVP Implementation Checklist
${checklistLines}

## Appendix: Anonymized Endpoint Shapes
${endpointLines}

> This report is generated from observed traffic patterns only. Endpoint names, hosts, identifiers, and secret values are sanitized to keep recommendations educational and non-proprietary.`;
}

export function analyzeArchitecture(entries = []) {
  const sanitizedEntries = withSanitizedEntries(entries);
  const overview = summarizeOverview(sanitizedEntries);

  const polling = detectPolling(sanitizedEntries);
  const pagination = detectPagination(sanitizedEntries);
  const search = detectSearch(sanitizedEntries);
  const rest = detectRestPatterns(sanitizedEntries);
  const auth = detectAuthHints(sanitizedEntries);
  const rateLimiting = detectRateLimiting(sanitizedEntries);
  const caching = detectCaching(sanitizedEntries);
  const dataComplexity = detectDataComplexity(sanitizedEntries);
  const jobs = detectJobs(sanitizedEntries, polling);
  const background = detectBackgroundProcessing(sanitizedEntries, jobs);

  const patterns = [];
  if (jobs) patterns.push({ name: "Async job orchestration", ...jobs });
  if (polling.length) patterns.push({ name: "Polling", confidence: polling.some((item) => item.confidence === "High") ? "High" : "Medium", evidence: polling.map((item) => item.evidence).join("; ") });
  if (pagination) patterns.push({ name: "Pagination", ...pagination });
  if (search) patterns.push({ name: "Search / filtering", ...search });
  if (rest) patterns.push({ name: "Resource-oriented REST", ...rest });
  if (auth) patterns.push({ name: "Auth boundary hints", ...auth });
  if (rateLimiting) patterns.push({ name: "Rate limiting hints", ...rateLimiting });
  if (background) patterns.push({ name: "Background processing", ...background });
  if (caching) patterns.push({ name: "Caching hints", ...caching });
  if (dataComplexity) patterns.push({ name: "Data model complexity", ...dataComplexity });

  const recommendations = buildRecommendations(patterns);
  const checklist = buildChecklist(patterns);
  const endpointShapes = [...new Set(sanitizedEntries.map((entry) => `${entry.method} ${entry.endpointShape}`))].sort();

  const json = {
    generatedAt: new Date().toISOString(),
    overview,
    patterns,
    recommendations,
    checklist,
    appendix: {
      endpointShapes
    }
  };

  const markdown = toMarkdown(json);
  return { markdown, json };
}
