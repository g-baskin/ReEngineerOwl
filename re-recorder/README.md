# RE Recorder — Network Capture & Workflow Extractor

## Load the extension in Chrome
1. Open `chrome://extensions`.
2. Toggle **Developer mode** on.
3. Click **Load unpacked**.
4. Select the `re-recorder/` folder from this repository.

## Test capture on any SPA
1. Open a web app tab (your target SPA).
2. Open DevTools (`Cmd+Opt+I` on macOS or `Ctrl+Shift+I` on Windows/Linux).
3. Open the **RE Recorder** tab in DevTools.
4. Click **Start Capture**.
5. Use the app normally (login/search/create/update/etc.).
6. Click **Stop Capture**.
7. Review counts and inferred workflow preview.
8. Export one or more files:
   - **Export HAR** → `capture.har`
   - **Export JSON Bundle** → `capture.bundle.json` + `schema.summary.json`
   - **Export Markdown (PRD)** → `PRD.md`

## Notes
- All processing is local (no backend).
- Sensitive headers and token-like data are redacted in normalized output.
- Use **Full capture** only when you intentionally want non-JSON traffic retained.
