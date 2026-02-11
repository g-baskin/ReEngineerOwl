import { buildOpenApiSpec, toYamlString } from "./utils/openapi.js";
import { analyzeArchitecture } from "./utils/architecture.js";
import {
  listSessions,
  loadSession,
  saveSession,
  updateSessionMeta,
  deleteSession,
  setActiveSession,
  getActiveSession,
  getLibrarySettings,
  updateLibrarySettings
} from "./utils/storage.js";
import { buildPostmanCollection, buildPostmanEnvironment } from "./utils/postman.js";

const SESSION_KEY = "reRecorder.lastSession";

const activeState = {
  id: null,
  payload: {
    savedAt: null,
    rawEntries: [],
    filteredEntries: [],
    normalizedEntries: [],
    workflowSteps: [],
    schemaSummary: []
  }
};

function normalizeSessionPayload(payload = {}) {
  return {
    savedAt: payload.savedAt || new Date().toISOString(),
    rawEntries: payload.rawEntries || [],
    filteredEntries: payload.filteredEntries || [],
    normalizedEntries: payload.normalizedEntries || [],
    workflowSteps: payload.workflowSteps || payload.workflow || [],
    schemaSummary: payload.schemaSummary || [],
    openapi: payload.openapi || null,
    postman: payload.postman || null,
    architectureReport: payload.architectureReport || null,
    prdMarkdown: payload.prdMarkdown || null
  };
}

async function initializeActiveState() {
  const activeId = await getActiveSession();
  if (activeId) {
    const session = await loadSession(activeId);
    if (session?.payload) {
      activeState.id = activeId;
      activeState.payload = normalizeSessionPayload(session.payload);
      await chrome.storage.local.set({ [SESSION_KEY]: activeState.payload });
      return;
    }
  }

  const result = await chrome.storage.local.get(SESSION_KEY);
  activeState.id = null;
  activeState.payload = normalizeSessionPayload(result[SESSION_KEY] || {});
  await chrome.storage.local.set({ [SESSION_KEY]: activeState.payload });
}

const ready = initializeActiveState();

function getCurrentPayload() {
  return normalizeSessionPayload(activeState.payload || {});
}

async function persistCurrentPayload() {
  await chrome.storage.local.set({ [SESSION_KEY]: getCurrentPayload() });
}

async function computeOpenApiJsonContent(sessionPayload) {
  if (typeof sessionPayload?.openapi?.json === "string") {
    return sessionPayload.openapi.json;
  }

  const normalizedEntries = sessionPayload?.normalizedEntries || [];
  const schemaSummary = sessionPayload?.schemaSummary || [];
  const spec = buildOpenApiSpec(normalizedEntries, schemaSummary);
  const content = JSON.stringify(spec, null, 2);
  sessionPayload.openapi = {
    ...(sessionPayload.openapi || {}),
    json: content,
    yaml: toYamlString(spec)
  };

  return content;
}

async function computeOpenApiYamlContent(sessionPayload) {
  if (typeof sessionPayload?.openapi?.yaml === "string") {
    return sessionPayload.openapi.yaml;
  }
  await computeOpenApiJsonContent(sessionPayload);
  return sessionPayload?.openapi?.yaml || "";
}

async function computeArchitectureMarkdown(sessionPayload) {
  if (typeof sessionPayload?.architectureReport?.markdown === "string") {
    return sessionPayload.architectureReport.markdown;
  }
  const normalizedEntries = sessionPayload?.normalizedEntries || [];
  const report = analyzeArchitecture(normalizedEntries);
  sessionPayload.architectureReport = {
    markdown: report.markdown,
    json: report.json
  };
  return report.markdown;
}

async function computeArchitectureJson(sessionPayload) {
  if (sessionPayload?.architectureReport?.json) {
    return JSON.stringify(sessionPayload.architectureReport.json, null, 2);
  }
  await computeArchitectureMarkdown(sessionPayload);
  return JSON.stringify(sessionPayload.architectureReport?.json || {}, null, 2);
}

async function persistActiveSessionCacheIfNeeded() {
  if (!activeState.id) return;
  const stored = await loadSession(activeState.id);
  if (!stored) return;
  await saveSession(activeState.payload, stored.metadata);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") return;

  const respondAsync = async (handler) => {
    await ready;
    try {
      const value = await handler();
      sendResponse({ ok: true, ...value });
    } catch (error) {
      sendResponse({ ok: false, error: String(error?.message || error) });
    }
  };

  if (message.type === "SAVE_CAPTURE_SESSION") {
    respondAsync(async () => {
      activeState.id = null;
      await setActiveSession(null);
      activeState.payload = normalizeSessionPayload({
        ...message.payload,
        savedAt: new Date().toISOString()
      });
      await persistCurrentPayload();
      return {};
    });
    return true;
  }

  if (message.type === "GET_CAPTURE_SESSION") {
    respondAsync(async () => ({ data: getCurrentPayload(), activeSessionId: activeState.id }));
    return true;
  }

  if (message.type === "LIST_SESSIONS") {
    respondAsync(async () => {
      const sessions = await listSessions();
      return { sessions, activeSessionId: activeState.id, settings: await getLibrarySettings() };
    });
    return true;
  }

  if (message.type === "SAVE_SESSION") {
    respondAsync(async () => {
      const payload = normalizeSessionPayload(message.payload || getCurrentPayload());
      const result = await saveSession(payload, message.metadata || {});
      activeState.id = result.id;
      activeState.payload = payload;
      await Promise.all([setActiveSession(result.id), persistCurrentPayload()]);
      return result;
    });
    return true;
  }

  if (message.type === "LOAD_SESSION") {
    respondAsync(async () => {
      const session = await loadSession(message.id);
      if (!session) {
        throw new Error("Session not found");
      }
      activeState.id = session.metadata.id;
      activeState.payload = normalizeSessionPayload(session.payload);
      await Promise.all([setActiveSession(session.metadata.id), persistCurrentPayload()]);
      return { session };
    });
    return true;
  }

  if (message.type === "DELETE_SESSION") {
    respondAsync(async () => {
      await deleteSession(message.id);
      if (activeState.id === message.id) {
        activeState.id = null;
      }
      return { sessions: await listSessions(), activeSessionId: activeState.id };
    });
    return true;
  }

  if (message.type === "RENAME_SESSION") {
    respondAsync(async () => {
      const metadata = await updateSessionMeta(message.id, { name: message.name });
      return { metadata };
    });
    return true;
  }

  if (message.type === "SET_ACTIVE_SESSION") {
    respondAsync(async () => {
      if (!message.id) {
        activeState.id = null;
        await setActiveSession(null);
        return { activeSessionId: null };
      }
      const session = await loadSession(message.id);
      if (!session) throw new Error("Session not found");
      activeState.id = session.metadata.id;
      activeState.payload = normalizeSessionPayload(session.payload);
      await Promise.all([setActiveSession(session.metadata.id), persistCurrentPayload()]);
      return { activeSessionId: session.metadata.id };
    });
    return true;
  }
  if (message.type === "EXPORT_POSTMAN_COLLECTION") {
    getStoredSession()
      .then((session) => {
        const normalizedEntries = session?.normalizedEntries || [];
        const collection = buildPostmanCollection(normalizedEntries);
        sendResponse({ ok: true, content: JSON.stringify(collection, null, 2) });
      })
      .catch((error) => sendResponse({ ok: false, error: String(error) }));

    return true;
  }

  if (message.type === "EXPORT_POSTMAN_ENV") {
    getStoredSession()
      .then((session) => {
        const normalizedEntries = session?.normalizedEntries || [];
        const environment = buildPostmanEnvironment(normalizedEntries);
        sendResponse({ ok: true, content: JSON.stringify(environment, null, 2) });
      })
      .catch((error) => sendResponse({ ok: false, error: String(error) }));

    return true;
  }

  if (message.type === "EXPORT_ARCH_REPORT_MD") {
    getStoredSession()
      .then((session) => {
        const normalizedEntries = session?.normalizedEntries || [];
        const report = analyzeArchitecture(normalizedEntries);
        sendResponse({ ok: true, content: report.markdown });
      })
      .catch((error) => sendResponse({ ok: false, error: String(error) }));

  if (message.type === "GET_ACTIVE_SESSION") {
    respondAsync(async () => ({ activeSessionId: activeState.id }));
    return true;
  }

  if (message.type === "UPDATE_LIBRARY_SETTINGS") {
    respondAsync(async () => ({ settings: await updateLibrarySettings(message.patch || {}) }));
    return true;
  }

  if (message.type === "EXPORT_OPENAPI_JSON") {
    respondAsync(async () => {
      const content = await computeOpenApiJsonContent(activeState.payload);
      await persistActiveSessionCacheIfNeeded();
      return { content };
    });
    return true;
  }

  if (message.type === "EXPORT_OPENAPI_YAML") {
    respondAsync(async () => {
      const content = await computeOpenApiYamlContent(activeState.payload);
      await persistActiveSessionCacheIfNeeded();
      return { content };
    });
    return true;
  }

  if (message.type === "EXPORT_ARCH_REPORT_MD") {
    respondAsync(async () => {
      const content = await computeArchitectureMarkdown(activeState.payload);
      await persistActiveSessionCacheIfNeeded();
      return { content };
    });
    return true;
  }

  if (message.type === "EXPORT_ARCH_REPORT_JSON") {
    respondAsync(async () => {
      const content = await computeArchitectureJson(activeState.payload);
      await persistActiveSessionCacheIfNeeded();
      return { content };
    });
    return true;
  }
});
