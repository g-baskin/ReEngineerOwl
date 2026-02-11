const state = {
  isCapturing: false,
  captureMode: "injected",
  activeTabId: null,
  events: [],
  filteredEvents: []
};

const JWT_PATTERN = /\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9._-]{10,}\.[a-zA-Z0-9._-]{5,}\b/g;
const SENSITIVE_KEY_PATTERN = /(token|auth|secret|password|cookie|session|jwt|bearer|apikey|api[_-]?key)/i;
const JUNK_URL_PATTERN = /(google-analytics|doubleclick|segment|mixpanel|amplitude|hotjar|facebook|adsystem|adservice|pixel|beacon|metrics|fonts\.gstatic|\.mp4\b|\.webm\b|\.m3u8\b|\.jpg\b|\.png\b|\.gif\b)/i;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "START_CAPTURE") {
    startCapture(message.mode || "injected")
      .then(() => sendResponse(getStatus()))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message?.type === "STOP_CAPTURE") {
    stopCapture().then(() => sendResponse(getStatus()));
    return true;
  }

  if (message?.type === "NET_EVENT") {
    if (state.isCapturing && sender.tab?.id === state.activeTabId) {
      const sanitized = sanitizeEvent(message.payload || {});
      state.events.push(sanitized);
    }
    sendResponse(getStatus());
    return true;
  }

  if (message?.type === "GET_STATUS") {
    sendResponse(getStatus());
    return true;
  }

  if (message?.type === "GET_EXPORT") {
    const exportType = message.exportType || "bundle";
    sendResponse(buildExport(exportType));
    return true;
  }

  return false;
});

async function startCapture(mode) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    throw new Error("No active tab found.");
  }

  state.captureMode = mode;
  state.activeTabId = tab.id;
  state.isCapturing = true;
  state.events = [];
  state.filteredEvents = [];

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["content_script.js"]
  });

  await chrome.tabs.sendMessage(tab.id, { type: "START_CAPTURE", mode });
}

async function stopCapture() {
  if (!state.activeTabId) {
    state.isCapturing = false;
    return;
  }

  try {
    await chrome.tabs.sendMessage(state.activeTabId, { type: "STOP_CAPTURE" });
  } catch (_error) {
    // Ignore if tab navigated or closed.
  }

  state.isCapturing = false;
  state.filteredEvents = normalizeEvents(filterEvents(state.events));
}

function getStatus() {
  return {
    ok: true,
    isCapturing: state.isCapturing,
    captureMode: state.captureMode,
    rawCount: state.events.length,
    filteredCount: state.filteredEvents.length
  };
}

function sanitizeEvent(event) {
  const clone = structuredClone(event);
  clone.requestHeaders = sanitizeObject(clone.requestHeaders || {});
  clone.responseHeaders = sanitizeObject(clone.responseHeaders || {});
  clone.requestBody = sanitizeValue(clone.requestBody);
  clone.responseBody = sanitizeValue(clone.responseBody);
  clone.url = sanitizeValue(clone.url);
  return clone;
}

function sanitizeObject(input) {
  const output = {};
  for (const [key, value] of Object.entries(input || {})) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      output[key] = "[REDACTED]";
      continue;
    }
    output[key] = sanitizeValue(value);
  }
  return output;
}

function sanitizeValue(value) {
  if (typeof value === "string") {
    let next = value.replace(JWT_PATTERN, "[REDACTED_JWT]");
    next = next.replace(/(authorization\s*[:=]\s*)(bearer\s+)?[^\s"']+/gi, "$1[REDACTED]");
    next = next.replace(/(cookie\s*[:=]\s*)[^;\n]+/gi, "$1[REDACTED]");
    next = next.replace(/([?&](?:token|auth|secret|apikey|api_key|jwt)=)[^&\s]+/gi, "$1[REDACTED]");
    return next;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item));
  }

  if (value && typeof value === "object") {
    const output = {};
    for (const [key, nested] of Object.entries(value)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        output[key] = "[REDACTED]";
      } else {
        output[key] = sanitizeValue(nested);
      }
    }
    return output;
  }

  return value;
}

function filterEvents(events) {
  return events.filter((event) => {
    if (!event?.url || JUNK_URL_PATTERN.test(event.url)) {
      return false;
    }
    const contentType = String(event.responseHeaders?.["content-type"] || event.responseHeaders?.["Content-Type"] || "");
    const looksJson = contentType.includes("application/json") || contentType.includes("+json") || typeof event.responseBody === "object";
    return looksJson || event.bodyCaptured === false;
  });
}

function normalizeEvents(events) {
  return events.map((event, index) => ({
    id: index + 1,
    type: event.type || "fetch",
    method: (event.method || "GET").toUpperCase(),
    url: event.url,
    status: event.status ?? null,
    startTime: event.startTime ?? null,
    endTime: event.endTime ?? null,
    durationMs: event.endTime && event.startTime ? event.endTime - event.startTime : null,
    bodyCaptured: Boolean(event.bodyCaptured),
    requestHeaders: event.requestHeaders || {},
    responseHeaders: event.responseHeaders || {},
    requestBody: event.requestBody ?? null,
    responseBody: event.responseBody ?? null
  }));
}

function inferWorkflow(events) {
  const stages = [];
  const metadata = events.find((e) => /meta|schema|config|capabilities/i.test(e.url));
  const jobStart = events.find((e) => /submit|start|create|jobs?/i.test(e.url) && e.method !== "GET");
  const polling = events.filter((e) => /status|poll|jobs?|progress/i.test(e.url) && e.method === "GET");
  const finalResult = [...events].reverse().find((e) => /result|output|complete|final|download/i.test(e.url));

  if (metadata) stages.push({ name: "metadata", eventId: metadata.id, url: metadata.url });
  if (jobStart) stages.push({ name: "job_start", eventId: jobStart.id, url: jobStart.url });
  if (polling.length) stages.push({ name: "polling", count: polling.length, sampleUrl: polling[0].url });
  if (finalResult) stages.push({ name: "final_results", eventId: finalResult.id, url: finalResult.url });

  return {
    inferredPattern: stages.map((s) => s.name).join(" -> ") || "undetermined",
    stages
  };
}

function schemaSummary(events) {
  const endpointSummary = {};
  for (const event of events) {
    const key = `${event.method} ${stripQuery(event.url)}`;
    endpointSummary[key] = endpointSummary[key] || { count: 0, statuses: new Set(), requestKeys: new Set(), responseKeys: new Set() };
    const summary = endpointSummary[key];
    summary.count += 1;
    if (event.status != null) summary.statuses.add(event.status);

    collectTopLevelKeys(event.requestBody).forEach((k) => summary.requestKeys.add(k));
    collectTopLevelKeys(event.responseBody).forEach((k) => summary.responseKeys.add(k));
  }

  return {
    endpoints: Object.entries(endpointSummary).map(([endpoint, info]) => ({
      endpoint,
      count: info.count,
      statuses: [...info.statuses],
      requestKeys: [...info.requestKeys],
      responseKeys: [...info.responseKeys]
    }))
  };
}

function collectTopLevelKeys(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  return Object.keys(value);
}

function stripQuery(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url.split("?")[0];
  }
}

function buildExport(exportType) {
  const events = state.filteredEvents.length ? state.filteredEvents : normalizeEvents(filterEvents(state.events));
  const workflow = inferWorkflow(events);
  const schema = schemaSummary(events);

  if (exportType === "har") {
    return {
      filename: "capture.har.json",
      mimeType: "application/json",
      data: JSON.stringify(buildHarLike(events), null, 2)
    };
  }

  if (exportType === "schema") {
    return {
      filename: "schema.summary.json",
      mimeType: "application/json",
      data: JSON.stringify(schema, null, 2)
    };
  }

  if (exportType === "prd") {
    return {
      filename: "PRD.md",
      mimeType: "text/markdown",
      data: buildPrd(events, workflow, schema)
    };
  }

  return {
    filename: "capture.bundle.json",
    mimeType: "application/json",
    data: JSON.stringify({
      generatedAt: new Date().toISOString(),
      captureMode: state.captureMode,
      workflow,
      schema,
      events
    }, null, 2)
  };
}

function buildHarLike(events) {
  return {
    log: {
      version: "1.2",
      creator: { name: "RE Recorder", version: "2.0.0" },
      entries: events.map((event) => ({
        startedDateTime: event.startTime ? new Date(event.startTime).toISOString() : new Date().toISOString(),
        time: event.durationMs || 0,
        request: {
          method: event.method,
          url: event.url,
          headers: objectToHarHeaders(event.requestHeaders),
          postData: event.requestBody != null ? { mimeType: "application/json", text: JSON.stringify(event.requestBody) } : undefined
        },
        response: {
          status: event.status || 0,
          headers: objectToHarHeaders(event.responseHeaders),
          content: {
            mimeType: String(event.responseHeaders?.["content-type"] || "application/json"),
            text: event.responseBody != null ? JSON.stringify(event.responseBody) : ""
          }
        }
      }))
    }
  };
}

function objectToHarHeaders(headers) {
  return Object.entries(headers || {}).map(([name, value]) => ({ name, value: String(value) }));
}

function buildPrd(events, workflow, schema) {
  return `# Product Requirements Draft\n\n## Capture Summary\n- Captured events (filtered): ${events.length}\n- Capture mode: ${state.captureMode}\n- Workflow pattern: ${workflow.inferredPattern}\n\n## Workflow Stages\n${workflow.stages.map((s) => `- ${s.name}: ${JSON.stringify(s)}`).join("\n") || "- None inferred"}\n\n## Endpoint Summary\n${schema.endpoints.map((e) => `- ${e.endpoint} (count=${e.count}, statuses=${e.statuses.join(",") || "n/a"})`).join("\n") || "- No endpoints"}\n\n## Notes\n- Sensitive values are aggressively redacted.\n- Non-JSON bodies are omitted unless metadata-only capture is needed.`;
}
