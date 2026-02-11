const SESSION_INDEX_KEY = "reRecorder.sessionIndex";
const SESSION_PREFIX = "reRecorder.session.";
const ACTIVE_SESSION_KEY = "reRecorder.activeSessionId";
const LIBRARY_SETTINGS_KEY = "reRecorder.librarySettings";

const DEFAULT_SETTINGS = {
  maxSessions: 25,
  maxPayloadBytes: 2_000_000,
  autoSaveOnStop: false
};

function storageGet(keys) {
  return chrome.storage.local.get(keys);
}

function storageSet(values) {
  return chrome.storage.local.set(values);
}

function storageRemove(keys) {
  return chrome.storage.local.remove(keys);
}

function getSessionKey(id) {
  return `${SESSION_PREFIX}${id}`;
}

function fallbackId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function parameterizePath(pathname = "") {
  return pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      if (/^\d+$/.test(segment)) return "{id}";
      if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(segment)) return "{id}";
      if (/^[A-Za-z0-9_-]{12,}$/.test(segment)) return "{id}";
      return segment;
    })
    .join("/");
}

function safeEndpoint(entry = {}) {
  try {
    return new URL(entry.endpoint || "");
  } catch {
    return null;
  }
}

function deriveHosts(entries = []) {
  const hosts = new Set();
  entries.forEach((entry) => {
    const parsed = safeEndpoint(entry);
    if (parsed?.host) hosts.add(parsed.host);
  });
  return [...hosts];
}

function deriveDistinctTemplates(entries = []) {
  const templates = new Set();
  entries.forEach((entry) => {
    const parsed = safeEndpoint(entry);
    if (!parsed) return;
    templates.add(`/${parameterizePath(parsed.pathname)}`.replace(/\/+/g, "/"));
  });
  return templates.size;
}

function estimateBytes(value) {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

function sanitizePayloadForStorage(payload = {}, maxPayloadBytes = DEFAULT_SETTINGS.maxPayloadBytes) {
  const prepared = {
    rawEntries: Array.isArray(payload.rawEntries) ? payload.rawEntries : [],
    filteredEntries: Array.isArray(payload.filteredEntries) ? payload.filteredEntries : [],
    normalizedEntries: Array.isArray(payload.normalizedEntries) ? payload.normalizedEntries : [],
    workflowSteps: Array.isArray(payload.workflowSteps || payload.workflow)
      ? payload.workflowSteps || payload.workflow
      : [],
    schemaSummary: Array.isArray(payload.schemaSummary) ? payload.schemaSummary : [],
    openapi: payload.openapi || null,
    postman: payload.postman || null,
    architectureReport: payload.architectureReport || null,
    prdMarkdown: typeof payload.prdMarkdown === "string" ? payload.prdMarkdown : null
  };

  const fullSize = estimateBytes(prepared);
  if (fullSize <= maxPayloadBytes) {
    return { payload: prepared, droppedRawEntries: false };
  }

  const reduced = {
    ...prepared,
    rawEntries: [],
    filteredEntries: []
  };

  const reducedSize = estimateBytes(reduced);
  if (reducedSize <= maxPayloadBytes) {
    return { payload: reduced, droppedRawEntries: true };
  }

  throw new Error(
    `Session payload (${Math.ceil(reducedSize / 1024)} KB) exceeds local storage limit. Export immediately or reduce capture volume.`
  );
}

async function getIndex() {
  const result = await storageGet(SESSION_INDEX_KEY);
  return Array.isArray(result[SESSION_INDEX_KEY]) ? result[SESSION_INDEX_KEY] : [];
}

async function setIndex(index) {
  await storageSet({ [SESSION_INDEX_KEY]: index });
}

export async function getLibrarySettings() {
  const result = await storageGet(LIBRARY_SETTINGS_KEY);
  return {
    ...DEFAULT_SETTINGS,
    ...(result[LIBRARY_SETTINGS_KEY] || {})
  };
}

export async function updateLibrarySettings(patch = {}) {
  const settings = await getLibrarySettings();
  const next = {
    ...settings,
    ...patch
  };
  await storageSet({ [LIBRARY_SETTINGS_KEY]: next });
  return next;
}

export async function listSessions() {
  const index = await getIndex();
  return index.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export async function loadSession(id) {
  if (!id) return null;
  const [result, index] = await Promise.all([storageGet(getSessionKey(id)), getIndex()]);
  const payload = result[getSessionKey(id)] || null;
  const metadata = index.find((item) => item.id === id) || null;
  if (!payload || !metadata) return null;
  return { metadata, payload };
}

export async function saveSession(payload = {}, metadata = {}) {
  const settings = await getLibrarySettings();
  const index = await getIndex();
  const id = metadata.id || crypto?.randomUUID?.() || fallbackId();
  const now = new Date().toISOString();

  const serialized = sanitizePayloadForStorage(payload, Number(settings.maxPayloadBytes) || DEFAULT_SETTINGS.maxPayloadBytes);
  const normalizedEntries = serialized.payload.normalizedEntries || [];

  const derivedMeta = {
    id,
    name: metadata.name || `Capture ${new Date().toLocaleString()}`,
    createdAt: metadata.createdAt || now,
    updatedAt: now,
    hosts: metadata.hosts || deriveHosts(normalizedEntries),
    rawCount: Number(metadata.rawCount ?? (serialized.payload.rawEntries || []).length),
    filteredCount: Number(metadata.filteredCount ?? (serialized.payload.filteredEntries || []).length),
    normalizedCount: Number(metadata.normalizedCount ?? normalizedEntries.length),
    distinctPathTemplates: Number(metadata.distinctPathTemplates ?? deriveDistinctTemplates(normalizedEntries)),
    notes: metadata.notes || "",
    tags: Array.isArray(metadata.tags) ? metadata.tags : []
  };

  const previous = index.find((item) => item.id === id);
  if (previous) {
    Object.assign(previous, { ...previous, ...derivedMeta, createdAt: previous.createdAt || derivedMeta.createdAt });
  } else {
    index.unshift(derivedMeta);
  }

  const maxSessions = Math.max(1, Number(settings.maxSessions) || DEFAULT_SETTINGS.maxSessions);
  const trimmed = index.slice(0, maxSessions);
  const removed = index.slice(maxSessions);

  await Promise.all([
    storageSet({ [getSessionKey(id)]: serialized.payload }),
    setIndex(trimmed),
    ...removed.map((item) => storageRemove(getSessionKey(item.id)))
  ]);

  return {
    id,
    metadata: trimmed.find((item) => item.id === id) || derivedMeta,
    droppedRawEntries: serialized.droppedRawEntries,
    removedCount: removed.length
  };
}

export async function updateSessionMeta(id, patch = {}) {
  const index = await getIndex();
  const target = index.find((item) => item.id === id);
  if (!target) throw new Error("Session not found");

  Object.assign(target, patch, { updatedAt: new Date().toISOString() });
  await setIndex(index);
  return target;
}

export async function deleteSession(id) {
  const index = await getIndex();
  const next = index.filter((item) => item.id !== id);
  await Promise.all([setIndex(next), storageRemove(getSessionKey(id))]);

  const activeId = await getActiveSession();
  if (activeId === id) {
    await setActiveSession(null);
  }
}

export async function setActiveSession(id) {
  if (!id) {
    await storageRemove(ACTIVE_SESSION_KEY);
    return null;
  }
  await storageSet({ [ACTIVE_SESSION_KEY]: id });
  return id;
}

export async function getActiveSession() {
  const result = await storageGet(ACTIVE_SESSION_KEY);
  return result[ACTIVE_SESSION_KEY] || null;
}
