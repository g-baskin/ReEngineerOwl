function payloadSize(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === "string") return value.length;
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}

function summarize(entry) {
  const size = payloadSize(entry.responseBody);
  if (entry.method === "GET" && size < 1500) return "Returns metadata or reference context.";
  if (entry.method === "POST" && size < 600) return "Triggers an async action or submit operation.";
  if (entry.method === "GET" && size > 8000) return "Returns final or heavy result payload.";
  return "General workflow request/response.";
}

function endpointSignature(endpoint) {
  return endpoint
    .replace(/\/[0-9a-f]{8,}/gi, "/:id")
    .replace(/\/\d+/g, "/:id");
}

export function inferWorkflowSteps(normalizedEntries) {
  const sorted = [...normalizedEntries].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  const grouped = new Map();
  for (const entry of sorted) {
    const sig = `${entry.method} ${endpointSignature(entry.endpoint)}`;
    if (!grouped.has(sig)) grouped.set(sig, []);
    grouped.get(sig).push(entry);
  }

  const pollingSignatures = new Set();
  for (const [sig, entries] of grouped.entries()) {
    if (entries.length >= 3 && entries.every((e) => e.method === "GET")) {
      pollingSignatures.add(sig);
    }
  }

  const steps = [];
  let stepNo = 1;

  for (const entry of sorted) {
    const sig = `${entry.method} ${endpointSignature(entry.endpoint)}`;
    const size = payloadSize(entry.responseBody);

    let name = "API request";
    if (pollingSignatures.has(sig)) {
      name = "Polling status";
    } else if (entry.method === "GET" && size < 1500) {
      name = "Load metadata";
    } else if (entry.method === "POST") {
      name = "Submit operation";
    } else if (size === Math.max(...sorted.map((e) => payloadSize(e.responseBody)))) {
      name = "Fetch final result";
    }

    steps.push({
      step: stepNo++,
      name,
      endpoint: entry.endpoint,
      method: entry.method,
      summary: summarize(entry)
    });
  }

  return steps;
}
