import { filterEntries } from "./utils/filter.js";
import { normalizeEntries, buildSchemaSummary } from "./utils/normalize.js";
import { inferWorkflowSteps } from "./utils/workflow.js";
import {
  exportHar,
  exportBundle,
  exportMarkdown,
  exportOpenApiJsonContent,
  exportOpenApiYamlContent,
  exportPostmanCollectionContent,
  exportPostmanEnvironmentContent,
  exportArchitectureMarkdown,
  exportArchitectureJson
} from "./utils/exporters.js";

const state = {
  isCapturing: false,
  rawEntries: [],
  filteredEntries: [],
  normalizedEntries: [],
  workflowSteps: [],
  schemaSummary: [],
  inspectedOrigin: "",
  sessions: [],
  activeSessionId: null,
  settings: {
    autoSaveOnStop: false,
    maxSessions: 25
  }
};

const el = {
  startBtn: document.getElementById("startBtn"),
  stopBtn: document.getElementById("stopBtn"),
  saveSessionBtn: document.getElementById("saveSessionBtn"),
  saveSettingsBtn: document.getElementById("saveSettingsBtn"),
  exportHarBtn: document.getElementById("exportHarBtn"),
  exportJsonBtn: document.getElementById("exportJsonBtn"),
  exportMdBtn: document.getElementById("exportMdBtn"),
  exportOpenApiJsonBtn: document.getElementById("exportOpenApiJsonBtn"),
  exportOpenApiYamlBtn: document.getElementById("exportOpenApiYamlBtn"),
  exportPostmanCollectionBtn: document.getElementById("exportPostmanCollectionBtn"),
  exportPostmanEnvBtn: document.getElementById("exportPostmanEnvBtn"),
  exportArchitectureMdBtn: document.getElementById("exportArchitectureMdBtn"),
  exportArchitectureJsonBtn: document.getElementById("exportArchitectureJsonBtn"),
  rawCount: document.getElementById("rawCount"),
  filteredCount: document.getElementById("filteredCount"),
  normalizedCount: document.getElementById("normalizedCount"),
  activeSessionLabel: document.getElementById("activeSessionLabel"),
  workflowList: document.getElementById("workflowList"),
  sessionList: document.getElementById("sessionList"),
  maxSessionsInput: document.getElementById("maxSessionsInput"),
  statusLog: document.getElementById("statusLog"),
  fullCaptureToggle: document.getElementById("fullCaptureToggle"),
  strictStatusToggle: document.getElementById("strictStatusToggle"),
  autoSaveOnStopToggle: document.getElementById("autoSaveOnStopToggle")
};

let listener = null;

function logStatus(message) {
  const line = `[${new Date().toLocaleTimeString()}] ${message}`;
  el.statusLog.textContent = `${line}\n${el.statusLog.textContent}`.slice(0, 5000);
}

function getCurrentSessionData() {
  return {
    rawEntries: state.rawEntries,
    filteredEntries: state.filteredEntries,
    normalizedEntries: state.normalizedEntries,
    workflowSteps: state.workflowSteps,
    schemaSummary: state.schemaSummary
  };
}

function formatSessionMeta(meta) {
  const created = new Date(meta.createdAt).toLocaleString();
  const hostCount = Array.isArray(meta.hosts) ? meta.hosts.length : 0;
  const tags = Array.isArray(meta.tags) && meta.tags.length ? meta.tags.join(", ") : "(none)";
  return `${created} • hosts: ${hostCount} • requests: ${meta.normalizedCount || 0} • endpoints: ${meta.distinctPathTemplates || 0} • tags: ${tags}`;
}

function renderLibrary() {
  el.sessionList.innerHTML = "";

  if (!state.sessions.length) {
    const empty = document.createElement("li");
    empty.className = "muted";
    empty.textContent = "No saved sessions yet.";
    el.sessionList.appendChild(empty);
    return;
  }

  state.sessions.forEach((session) => {
    const li = document.createElement("li");
    li.className = `session-item ${state.activeSessionId === session.id ? "active" : ""}`;

    const title = document.createElement("div");
    title.className = "session-title";
    title.textContent = session.name;

    const meta = document.createElement("div");
    meta.className = "session-meta";
    meta.textContent = formatSessionMeta(session);

    const actions = document.createElement("div");
    actions.className = "button-row";

    const loadBtn = document.createElement("button");
    loadBtn.textContent = "Load";
    loadBtn.addEventListener("click", () => loadSessionIntoView(session.id));

    const renameBtn = document.createElement("button");
    renameBtn.textContent = "Rename";
    renameBtn.addEventListener("click", async () => {
      const name = window.prompt("Rename session", session.name);
      if (!name) return;
      await sendRuntimeMessage({ type: "RENAME_SESSION", id: session.id, name: name.trim() });
      await refreshLibrary();
      logStatus(`Renamed session to \"${name.trim()}\".`);
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", async () => {
      const confirmed = window.confirm(`Delete session \"${session.name}\"?`);
      if (!confirmed) return;
      await sendRuntimeMessage({ type: "DELETE_SESSION", id: session.id });
      await refreshLibrary();
      logStatus(`Deleted session \"${session.name}\".`);
    });

    const exportBtn = document.createElement("button");
    exportBtn.textContent = "Export";
    exportBtn.addEventListener("click", async () => {
      await loadSessionIntoView(session.id, false);
      await exportFromPrompt();
    });

    actions.append(loadBtn, renameBtn, deleteBtn, exportBtn);
    li.append(title, meta, actions);
    el.sessionList.appendChild(li);
  });
}

function render() {
  el.rawCount.textContent = String(state.rawEntries.length);
  el.filteredCount.textContent = String(state.filteredEntries.length);
  el.normalizedCount.textContent = String(state.normalizedEntries.length);

  el.startBtn.disabled = state.isCapturing;
  el.stopBtn.disabled = !state.isCapturing;

  const hasData = state.normalizedEntries.length > 0;
  el.exportHarBtn.disabled = state.rawEntries.length === 0;
  el.exportJsonBtn.disabled = !hasData;
  el.exportMdBtn.disabled = !hasData;
  el.exportOpenApiJsonBtn.disabled = !hasData;
  el.exportOpenApiYamlBtn.disabled = !hasData;
  el.exportPostmanCollectionBtn.disabled = !hasData;
  el.exportPostmanEnvBtn.disabled = !hasData;
  el.exportArchitectureMdBtn.disabled = !hasData;
  el.exportArchitectureJsonBtn.disabled = !hasData;

  el.workflowList.innerHTML = "";
  state.workflowSteps.slice(0, 12).forEach((step) => {
    const li = document.createElement("li");
    li.textContent = `${step.name} — ${step.method} ${step.endpoint}`;
    el.workflowList.appendChild(li);
  });

  const active = state.sessions.find((item) => item.id === state.activeSessionId);
  el.activeSessionLabel.textContent = active
    ? `Active session: ${active.name}`
    : "Active session: unsaved current capture";

  el.autoSaveOnStopToggle.checked = !!state.settings.autoSaveOnStop;
  el.maxSessionsInput.value = String(state.settings.maxSessions || 25);

  renderLibrary();
}

function getCaptureOptions() {
  return {
    fullCapture: el.fullCaptureToggle.checked,
    strictStatus: el.strictStatusToggle.checked,
    inspectedOrigin: state.inspectedOrigin
  };
}

function toSerializableEntry(request, responseBody) {
  return {
    startedDateTime: request.startedDateTime,
    time: request.time,
    timings: request.timings,
    request: {
      method: request.request?.method,
      url: request.request?.url,
      headers: request.request?.headers || [],
      bodySize: request.request?.bodySize,
      postData: {
        mimeType: request.request?.postData?.mimeType || "",
        text: request.request?.postData?.text || ""
      }
    },
    response: {
      status: request.response?.status,
      statusText: request.response?.statusText,
      headers: request.response?.headers || [],
      bodySize: request.response?.bodySize,
      content: {
        size: request.response?.content?.size,
        mimeType: request.response?.content?.mimeType || ""
      }
    },
    _reRecorder: {
      responseBody
    }
  };
}

async function enrichEntry(request) {
  const responseBody = await new Promise((resolve) => {
    request.getContent((content) => {
      resolve(content ? String(content) : "");
    });
  });

  return toSerializableEntry(request, responseBody);
}

async function onRequestFinished(request) {
  if (!state.isCapturing) return;

  const enriched = await enrichEntry(request);
  state.rawEntries.push(enriched);
  render();
}

async function startCapture() {
  if (state.isCapturing) return;

  state.activeSessionId = null;
  state.rawEntries = [];
  state.filteredEntries = [];
  state.normalizedEntries = [];
  state.workflowSteps = [];
  state.schemaSummary = [];

  listener = onRequestFinished;
  chrome.devtools.network.onRequestFinished.addListener(listener);

  state.isCapturing = true;
  render();
  logStatus("Capture started. Interact with the app to record API traffic.");
}

async function saveCurrentSession(options = {}) {
  const { promptForName = true, explicitName = "" } = options;
  if (!state.normalizedEntries.length) {
    logStatus("Nothing to save yet. Capture and stop first.");
    return;
  }
  const defaultName = `Capture ${new Date().toLocaleString()}`;
  let targetName = explicitName || defaultName;
  if (promptForName) {
    const name = window.prompt("Save session as", defaultName);
    if (!name) return;
    targetName = name.trim() || defaultName;
  }

  const response = await sendRuntimeMessage({
    type: "SAVE_SESSION",
    payload: getCurrentSessionData(),
    metadata: {
      name: targetName
    }
  });

  state.activeSessionId = response.id;
  await refreshLibrary();

  if (response.droppedRawEntries) {
    logStatus("Session saved with raw entries omitted due to payload size limit.");
  } else {
    logStatus(`Session saved as \"${targetName}\".`);
  }

  if (response.removedCount > 0) {
    logStatus(`Retention applied. Removed ${response.removedCount} oldest session(s).`);
  }
}

async function stopCapture() {
  if (!state.isCapturing) return;

  if (listener) {
    chrome.devtools.network.onRequestFinished.removeListener(listener);
    listener = null;
  }

  state.isCapturing = false;

  await new Promise((resolve) => {
    setTimeout(() => {
      state.filteredEntries = filterEntries(state.rawEntries, getCaptureOptions());
      state.normalizedEntries = normalizeEntries(state.filteredEntries);
      state.workflowSteps = inferWorkflowSteps(state.normalizedEntries);
      state.schemaSummary = buildSchemaSummary(state.normalizedEntries);
      resolve();
    }, 0);
  });

  await sendRuntimeMessage({
    type: "SAVE_CAPTURE_SESSION",
    payload: getCurrentSessionData()
  });

  render();
  logStatus(`Capture stopped. ${state.rawEntries.length} raw requests processed.`);

  if (state.settings.autoSaveOnStop) {
    try {
      await saveCurrentSession({ promptForName: false });
    } catch (error) {
      logStatus(`Auto-save failed: ${String(error.message || error)}`);
    }
  }
}

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      if (!response?.ok) {
        reject(new Error(response?.error || "Unexpected runtime error"));
        return;
      }
      resolve(response);
    });
  });
}

async function loadSessionIntoView(id, withLog = true) {
  const response = await sendRuntimeMessage({ type: "LOAD_SESSION", id });
  const payload = response.session.payload;
  state.activeSessionId = response.session.metadata.id;
  state.rawEntries = payload.rawEntries || [];
  state.filteredEntries = payload.filteredEntries || [];
  state.normalizedEntries = payload.normalizedEntries || [];
  state.workflowSteps = payload.workflowSteps || payload.workflow || [];
  state.schemaSummary = payload.schemaSummary || [];
  await refreshLibrary(false);
  render();
  if (withLog) logStatus(`Loaded session \"${response.session.metadata.name}\".`);
}

async function refreshLibrary(renderAfter = true) {
  const response = await sendRuntimeMessage({ type: "LIST_SESSIONS" });
  state.sessions = response.sessions || [];
  state.activeSessionId = response.activeSessionId || null;
  state.settings = {
    ...state.settings,
    ...(response.settings || {})
  };
  if (renderAfter) render();
}

async function updateSettings(patch) {
  const response = await sendRuntimeMessage({ type: "UPDATE_LIBRARY_SETTINGS", patch });
  state.settings = {
    ...state.settings,
    ...response.settings
  };
  render();
}

async function exportFromPrompt() {
  const format = window.prompt(
    "Choose export: har, bundle, prd, openapi-json, openapi-yaml, arch-md, arch-json",
    "bundle"
  );
  if (!format) return;

  const choice = format.trim().toLowerCase();
  if (choice === "har") return el.exportHarBtn.click();
  if (choice === "bundle") return el.exportJsonBtn.click();
  if (choice === "prd") return el.exportMdBtn.click();
  if (choice === "openapi-json") return el.exportOpenApiJsonBtn.click();
  if (choice === "openapi-yaml") return el.exportOpenApiYamlBtn.click();
  if (choice === "arch-md") return el.exportArchitectureMdBtn.click();
  if (choice === "arch-json") return el.exportArchitectureJsonBtn.click();

  logStatus(`Unknown export format: ${choice}`);
}

function wireActions() {
  el.startBtn.addEventListener("click", startCapture);
  el.stopBtn.addEventListener("click", stopCapture);
  el.saveSessionBtn.addEventListener("click", () => {
    saveCurrentSession({ promptForName: true }).catch((error) => {
      logStatus(`Save failed: ${String(error.message || error)}`);
    });
  });

  el.saveSettingsBtn.addEventListener("click", async () => {
    const maxSessions = Number(el.maxSessionsInput.value || 25);
    await updateSettings({ maxSessions: Math.max(1, maxSessions) });
    logStatus(`Updated library retention: max ${Math.max(1, maxSessions)} session(s).`);
  });

  el.autoSaveOnStopToggle.addEventListener("change", async () => {
    await updateSettings({ autoSaveOnStop: el.autoSaveOnStopToggle.checked });
    logStatus(`Auto-save on Stop ${el.autoSaveOnStopToggle.checked ? "enabled" : "disabled"}.`);
  });

  el.exportHarBtn.addEventListener("click", () => {
    exportHar(getCurrentSessionData());
    logStatus("Exported HAR.");
  });

  el.exportJsonBtn.addEventListener("click", () => {
    exportBundle(getCurrentSessionData());
    logStatus("Exported capture.bundle.json and schema.summary.json.");
  });

  el.exportMdBtn.addEventListener("click", () => {
    exportMarkdown(getCurrentSessionData());
    logStatus("Exported PRD.md.");
  });

  el.exportOpenApiJsonBtn.addEventListener("click", async () => {
    try {
      const response = await sendRuntimeMessage({ type: "EXPORT_OPENAPI_JSON" });
      exportOpenApiJsonContent(response.content);
      logStatus("Exported openapi.json.");
    } catch (error) {
      logStatus(`OpenAPI JSON export failed: ${String(error.message || error)}`);
    }
  });

  el.exportOpenApiYamlBtn.addEventListener("click", async () => {
    try {
      const response = await sendRuntimeMessage({ type: "EXPORT_OPENAPI_YAML" });
      exportOpenApiYamlContent(response.content);
      logStatus("Exported openapi.yaml.");
    } catch (error) {
      logStatus(`OpenAPI YAML export failed: ${String(error.message || error)}`);
    }
  });


  el.exportPostmanCollectionBtn.addEventListener("click", async () => {
    try {
      const response = await sendRuntimeMessage({ type: "EXPORT_POSTMAN_COLLECTION" });
      exportPostmanCollectionContent(response.content);
      logStatus("Exported postman.collection.json.");
    } catch (error) {
      logStatus(`Postman Collection export failed: ${String(error.message || error)}`);
    }
  });

  el.exportPostmanEnvBtn.addEventListener("click", async () => {
    try {
      const response = await sendRuntimeMessage({ type: "EXPORT_POSTMAN_ENV" });
      exportPostmanEnvironmentContent(response.content);
      logStatus("Exported postman.environment.json.");
    } catch (error) {
      logStatus(`Postman Environment export failed: ${String(error.message || error)}`);
    }
  });

  el.exportArchitectureMdBtn.addEventListener("click", async () => {
    try {
      const response = await sendRuntimeMessage({ type: "EXPORT_ARCH_REPORT_MD" });
      exportArchitectureMarkdown(response.content);
      logStatus("Exported architecture.report.md.");
    } catch (error) {
      logStatus(`Architecture report (Markdown) export failed: ${String(error.message || error)}`);
    }
  });

  el.exportArchitectureJsonBtn.addEventListener("click", async () => {
    try {
      const response = await sendRuntimeMessage({ type: "EXPORT_ARCH_REPORT_JSON" });
      exportArchitectureJson(response.content);
      logStatus("Exported architecture.report.json.");
    } catch (error) {
      logStatus(`Architecture report (JSON) export failed: ${String(error.message || error)}`);
    }
  });
}

function resolveInspectedOrigin() {
  chrome.devtools.inspectedWindow.eval("window.location.origin", (result, exceptionInfo) => {
    if (!exceptionInfo || !exceptionInfo.isError) {
      state.inspectedOrigin = result || "";
      return;
    }
    state.inspectedOrigin = "";
  });
}

async function init() {
  wireActions();
  resolveInspectedOrigin();

  try {
    const response = await sendRuntimeMessage({ type: "GET_CAPTURE_SESSION" });
    if (response?.data) {
      state.rawEntries = response.data.rawEntries || [];
      state.filteredEntries = response.data.filteredEntries || [];
      state.normalizedEntries = response.data.normalizedEntries || [];
      state.workflowSteps = response.data.workflowSteps || response.data.workflow || [];
      state.schemaSummary = response.data.schemaSummary || [];
      state.activeSessionId = response.activeSessionId || null;
      logStatus("Restored last active capture from extension storage.");
    }
  } catch (error) {
    logStatus(`Unable to restore session: ${String(error.message || error)}`);
  }

  await refreshLibrary(false);
  render();
}

window.onPanelVisible = () => {
  logStatus("Panel visible.");
};

init();
