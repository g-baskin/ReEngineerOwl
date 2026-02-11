import { filterEntries } from "./utils/filter.js";
import { normalizeEntries, buildSchemaSummary } from "./utils/normalize.js";
import { inferWorkflowSteps } from "./utils/workflow.js";
import { exportHar, exportBundle, exportMarkdown } from "./utils/exporters.js";

const state = {
  isCapturing: false,
  rawEntries: [],
  filteredEntries: [],
  normalizedEntries: [],
  workflowSteps: [],
  schemaSummary: [],
  inspectedOrigin: ""
};

const el = {
  startBtn: document.getElementById("startBtn"),
  stopBtn: document.getElementById("stopBtn"),
  exportHarBtn: document.getElementById("exportHarBtn"),
  exportJsonBtn: document.getElementById("exportJsonBtn"),
  exportMdBtn: document.getElementById("exportMdBtn"),
  rawCount: document.getElementById("rawCount"),
  filteredCount: document.getElementById("filteredCount"),
  normalizedCount: document.getElementById("normalizedCount"),
  workflowList: document.getElementById("workflowList"),
  statusLog: document.getElementById("statusLog"),
  fullCaptureToggle: document.getElementById("fullCaptureToggle"),
  strictStatusToggle: document.getElementById("strictStatusToggle")
};

let listener = null;

function logStatus(message) {
  const line = `[${new Date().toLocaleTimeString()}] ${message}`;
  el.statusLog.textContent = `${line}\n${el.statusLog.textContent}`.slice(0, 5000);
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

  el.workflowList.innerHTML = "";
  state.workflowSteps.slice(0, 12).forEach((step) => {
    const li = document.createElement("li");
    li.textContent = `${step.name} — ${step.method} ${step.endpoint}`;
    el.workflowList.appendChild(li);
  });
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

async function stopCapture() {
  if (!state.isCapturing) return;

  if (listener) {
    chrome.devtools.network.onRequestFinished.removeListener(listener);
    listener = null;
  }

  state.isCapturing = false;

  state.filteredEntries = filterEntries(state.rawEntries, getCaptureOptions());
  state.normalizedEntries = normalizeEntries(state.filteredEntries);
  state.workflowSteps = inferWorkflowSteps(state.normalizedEntries);
  state.schemaSummary = buildSchemaSummary(state.normalizedEntries);

  chrome.runtime.sendMessage({
    type: "SAVE_CAPTURE_SESSION",
    payload: {
      rawEntries: state.rawEntries,
      filteredEntries: state.filteredEntries,
      normalizedEntries: state.normalizedEntries,
      workflow: state.workflowSteps,
      schemaSummary: state.schemaSummary
    }
  });

  render();
  logStatus(`Capture stopped. ${state.rawEntries.length} raw requests processed.`);
}

function wireActions() {
  el.startBtn.addEventListener("click", startCapture);
  el.stopBtn.addEventListener("click", stopCapture);

  el.exportHarBtn.addEventListener("click", () => {
    exportHar(state.rawEntries);
    logStatus("Exported HAR.");
  });

  el.exportJsonBtn.addEventListener("click", () => {
    exportBundle(state.normalizedEntries, state.schemaSummary);
    logStatus("Exported capture.bundle.json and schema.summary.json.");
  });

  el.exportMdBtn.addEventListener("click", () => {
    exportMarkdown(state.workflowSteps, state.schemaSummary, state.normalizedEntries.length);
    logStatus("Exported PRD.md.");
  });
}

function resolveInspectedOrigin() {
  chrome.devtools.inspectedWindow.eval("window.location.origin", (_result, exceptionInfo) => {
    if (!exceptionInfo || !exceptionInfo.isError) {
      state.inspectedOrigin = _result || "";
      return;
    }
    state.inspectedOrigin = "";
  });
}

function init() {
  wireActions();
  resolveInspectedOrigin();

  chrome.runtime.sendMessage({ type: "GET_CAPTURE_SESSION" }, (response) => {
    if (response?.ok && response.data) {
      state.rawEntries = response.data.rawEntries || [];
      state.filteredEntries = response.data.filteredEntries || [];
      state.normalizedEntries = response.data.normalizedEntries || [];
      state.workflowSteps = response.data.workflow || [];
      state.schemaSummary = response.data.schemaSummary || [];
      render();
      logStatus("Restored last saved capture from extension storage.");
    } else {
      render();
    }
  });
}

window.onPanelVisible = () => {
  logStatus("Panel visible.");
};

init();
