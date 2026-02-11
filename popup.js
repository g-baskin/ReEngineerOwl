const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const captureMode = document.getElementById("captureMode");
const rawCount = document.getElementById("rawCount");
const filteredCount = document.getElementById("filteredCount");
const captureState = document.getElementById("captureState");
const statusText = document.getElementById("statusText");

startBtn.addEventListener("click", async () => {
  const response = await chrome.runtime.sendMessage({ type: "START_CAPTURE", mode: captureMode.value });
  updateStatus(response);
  statusText.textContent = response.captureMode === "devtools"
    ? "DevTools fallback mode is a skeleton in this build."
    : "Capture started.";
});

stopBtn.addEventListener("click", async () => {
  const response = await chrome.runtime.sendMessage({ type: "STOP_CAPTURE" });
  updateStatus(response);
  statusText.textContent = "Capture stopped. Ready for export.";
});

for (const button of document.querySelectorAll("[data-export]")) {
  button.addEventListener("click", async () => {
    const exportType = button.getAttribute("data-export");
    const result = await chrome.runtime.sendMessage({ type: "GET_EXPORT", exportType });
    download(result.filename, result.data, result.mimeType);
    statusText.textContent = `Exported ${result.filename}`;
  });
}

async function refresh() {
  const response = await chrome.runtime.sendMessage({ type: "GET_STATUS" });
  updateStatus(response);
}

function updateStatus(status) {
  rawCount.textContent = String(status?.rawCount ?? 0);
  filteredCount.textContent = String(status?.filteredCount ?? 0);
  captureState.textContent = status?.isCapturing ? "capturing" : "idle";
}

function download(filename, data, mimeType) {
  const blob = new Blob([data], { type: mimeType || "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

refresh();
setInterval(refresh, 1500);
