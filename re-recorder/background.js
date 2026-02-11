import { buildOpenApiSpec, toYamlString } from "./utils/openapi.js";

const SESSION_KEY = "reRecorder.lastSession";

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    [SESSION_KEY]: {
      savedAt: null,
      rawEntries: [],
      filteredEntries: [],
      normalizedEntries: [],
      workflow: [],
      schemaSummary: []
    }
  });
});

function getStoredSession() {
  return chrome.storage.local.get(SESSION_KEY).then((result) => result[SESSION_KEY] || null);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") return;

  if (message.type === "SAVE_CAPTURE_SESSION") {
    chrome.storage.local
      .set({
        [SESSION_KEY]: {
          savedAt: new Date().toISOString(),
          ...message.payload
        }
      })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));

    return true;
  }

  if (message.type === "GET_CAPTURE_SESSION") {
    getStoredSession()
      .then((session) => sendResponse({ ok: true, data: session }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));

    return true;
  }

  if (message.type === "EXPORT_OPENAPI_JSON") {
    getStoredSession()
      .then((session) => {
        const normalizedEntries = session?.normalizedEntries || [];
        const schemaSummary = session?.schemaSummary || [];
        const spec = buildOpenApiSpec(normalizedEntries, schemaSummary);
        sendResponse({ ok: true, content: JSON.stringify(spec, null, 2) });
      })
      .catch((error) => sendResponse({ ok: false, error: String(error) }));

    return true;
  }

  if (message.type === "EXPORT_OPENAPI_YAML") {
    getStoredSession()
      .then((session) => {
        const normalizedEntries = session?.normalizedEntries || [];
        const schemaSummary = session?.schemaSummary || [];
        const spec = buildOpenApiSpec(normalizedEntries, schemaSummary);
        sendResponse({ ok: true, content: toYamlString(spec) });
      })
      .catch((error) => sendResponse({ ok: false, error: String(error) }));

    return true;
  }
});
