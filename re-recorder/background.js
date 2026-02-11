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
    chrome.storage.local
      .get(SESSION_KEY)
      .then((result) => sendResponse({ ok: true, data: result[SESSION_KEY] || null }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));

    return true;
  }
});
