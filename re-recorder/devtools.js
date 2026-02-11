chrome.devtools.panels.create(
  "RE Recorder",
  "",
  "panel.html",
  (panel) => {
    panel.onShown.addListener((windowRef) => {
      if (windowRef && typeof windowRef.onPanelVisible === "function") {
        windowRef.onPanelVisible();
      }
    });
  }
);
