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
   - **Export OpenAPI (JSON)** → `openapi.json`
   - **Export OpenAPI (YAML)** → `openapi.yaml`

## OpenAPI export details
- The extension generates an OpenAPI **3.1.0** spec from captured `normalizedEntries` and uses `schema.summary.json` only as a fallback when samples are missing.
- Servers are inferred from captured URL origins.
- Paths are normalized and parameterized for common ID-like segments (numeric IDs, UUIDs, and long opaque tokens).
- Request/response schemas are inferred from real JSON samples and deduplicated into `components.schemas`.
- If a response body is unavailable, the spec still includes the status response with `Body not captured; metadata only`.
- Header keys that look sensitive (`auth`, `token`, `cookie`, `secret`) are excluded from OpenAPI output.

## Notes
- All processing is local (no backend).
- Sensitive headers and token-like data are redacted in normalized output.
- Use **Full capture** only when you intentionally want non-JSON traffic retained.
- Some requests may not expose bodies due to browser/network constraints, CORS restrictions, or opaque responses.
