(() => {
  if (window.__RE_RECORDER_CONTENT_INSTALLED__) {
    return;
  }
  window.__RE_RECORDER_CONTENT_INSTALLED__ = true;

  let captureActive = false;
  let currentMode = "injected";

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "START_CAPTURE") {
      currentMode = message.mode || "injected";
      if (currentMode === "injected") {
        injectPageHook();
        captureActive = true;
        window.postMessage({ source: "RE_RECORDER_CONTROL", type: "START" }, "*");
      } else {
        captureActive = true;
        window.postMessage({
          source: "RE_RECORDER",
          type: "NET_EVENT",
          payload: {
            type: "mode",
            method: "MODE",
            url: location.href,
            status: 0,
            startTime: Date.now(),
            endTime: Date.now(),
            bodyCaptured: false,
            responseBody: { notice: "DevTools fallback skeleton not fully implemented." }
          }
        }, "*");
      }
      sendResponse({ ok: true, captureActive, mode: currentMode });
      return true;
    }

    if (message?.type === "STOP_CAPTURE") {
      if (captureActive && currentMode === "injected") {
        window.postMessage({ source: "RE_RECORDER_CONTROL", type: "STOP" }, "*");
      }
      captureActive = false;
      sendResponse({ ok: true, captureActive, mode: currentMode });
      return true;
    }

    return false;
  });

  window.addEventListener("message", (event) => {
    if (event.source !== window || !captureActive) {
      return;
    }
    const data = event.data;
    if (!data || data.source !== "RE_RECORDER" || data.type !== "NET_EVENT") {
      return;
    }
    chrome.runtime.sendMessage({ type: "NET_EVENT", payload: data.payload });
  });

  function injectPageHook() {
    if (document.documentElement.dataset.reRecorderHookInjected === "1") {
      return;
    }
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("page_hook.js");
    script.dataset.reRecorderInjected = "1";
    (document.head || document.documentElement).appendChild(script);
    script.remove();
    document.documentElement.dataset.reRecorderHookInjected = "1";
  }
})();
