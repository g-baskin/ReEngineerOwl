# RE Recorder Chrome Extension (MV3)

This extension captures `fetch()` and `XMLHttpRequest` network events from the **page context** using an injected hook script, without requiring DevTools to be open.

## Features
- Manifest V3 service worker architecture.
- Start / Stop capture from popup UI.
- Capture mode selector:
  - **Injected (Primary)**: injects `page_hook.js` from `content_script.js`.
  - **DevTools (Fallback)**: UI and event skeleton included.
- Captures request/response metadata for `fetch` and `XHR`.
- Captures JSON request/response bodies when available.
- Opaque/unreadable bodies are stored as metadata-only (`bodyCaptured=false`).
- Aggressive redaction:
  - Authorization headers
  - Cookies
  - token/auth/secret-like keys
  - JWT-like strings
- Filtering removes analytics/ad/media noise and keeps JSON-first traffic.
- Exports:
  - `capture.bundle.json`
  - HAR-like JSON (`capture.har.json`)
  - `schema.summary.json`
  - `PRD.md`

## Project Files
- `manifest.json`
- `background.js`
- `content_script.js`
- `page_hook.js`
- `popup.html`
- `popup.js`

## Load in Chrome
1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this folder.
4. Open any target website tab.
5. Click the extension icon to open popup.
6. Choose **Injected (Primary)** mode.
7. Click **Start Capture**.
8. Perform app actions on the page.
9. Click **Stop Capture**.
10. Export desired artifact(s).

## Simple Test Plan Checklist
- [ ] Extension loads successfully in `chrome://extensions`.
- [ ] Start capture toggles status to `capturing`.
- [ ] Fetch/XHR requests increase raw counter.
- [ ] Stop capture freezes recording and computes filtered counter.
- [ ] Analytics/ad/media URLs are excluded from filtered set.
- [ ] Authorization/cookie/token/JWT values are redacted in exports.
- [ ] HAR-like export downloads and has `log.entries`.
- [ ] `capture.bundle.json` includes workflow + schema + events.
- [ ] `schema.summary.json` lists endpoints and key summaries.
- [ ] `PRD.md` is generated and downloadable.

## Notes
- The DevTools fallback mode is intentionally a lightweight skeleton in this iteration.
- Primary capture mode is injection-based and does not require DevTools to be open.
