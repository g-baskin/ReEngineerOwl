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
   - **Export Postman Collection** → `postman.collection.json`
   - **Export Postman Environment** → `postman.environment.json`
   - **Export Architecture Report** → `architecture.report.md` (+ optional `architecture.report.json`)

## Capture Library (local multi-session persistence)
- Use **Save Session** to manually save the current capture into the local **Capture Library**.
- Use **Auto-save on Stop** to save every stopped capture automatically.
- Each saved session includes metadata in a session index and payloads in separate `chrome.storage.local` keys:
  - Metadata: `id`, `name`, timestamps, hosts list/count, request counts, distinct endpoint template count, notes/tags.
  - Payload: `rawEntries` (optional), `filteredEntries` (optional), `normalizedEntries`, workflow, schema summary, and cached derived outputs when available.
- The library supports per-session **Load**, **Rename**, **Delete**, and **Export** actions.
- Loading a session makes it the active source for all export buttons.

### Retention and limits
- Default retention is **25 sessions** (configurable in the panel).
- Payload saves are best-effort and size-limited (default ~2 MB per session payload).
- If a session payload is too large, RE Recorder stores a reduced payload (dropping raw/filtered entries first).
- If the reduced payload is still too large, save fails and you should export immediately.

### `chrome.storage.local` quota considerations
- Chrome enforces per-extension local storage quotas that can vary by channel/environment.
- Session payloads containing full raw HTTP bodies can grow quickly; prefer frequent exports and moderate capture windows.
- If you need long-term archives, export artifacts (`capture.bundle.json`, OpenAPI, PRD, architecture report) and store them externally.

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

## Architecture Intelligence export
- Generates an educational, generalized architecture analysis from captured `normalizedEntries` only (no backend calls).
- Detects implementation patterns such as async job orchestration, polling cadence, pagination, search/filter usage, REST resource structure, auth boundaries, rate limiting, caching hints, and data complexity signals.
- Sanitizes output by aliasing hosts (`captured-host-*`), parameterizing ID-like segments (`{id}`), and omitting secrets/query values to avoid proprietary cloning.
- Produces `architecture.report.md` for human-readable guidance and `architecture.report.json` for automation workflows.


## Postman export details
- `postman.collection.json` uses the Postman Collection **v2.1** schema and groups requests by captured host, then by templated path (for example `/users/:id`).
- Request names follow `<METHOD> <pathTemplate>`, and URLs are emitted with Postman variables so they can be replayed safely.
- URL path templating converts numeric, UUID, and long opaque path segments to `:id`.
- Query parameters are exported as Postman `query` entries.
- Request bodies are exported as raw JSON only when valid JSON is present, with `options.raw.language = "json"`.
- Header export is intentionally strict: only safe headers (`Content-Type`, `Accept`) are included. Authorization, cookies, and token-like headers are excluded.

### Environment variable behavior
- If one host is captured, the environment contains `baseUrl` (for example `https://api.example.com`) and requests use `{{baseUrl}}`.
- If multiple hosts are captured, the environment contains one variable per host (for example `baseUrl_api_example_com`, `baseUrl_auth_example_com`) and each folder's requests reference the matching variable.

### Import into Postman
1. Open Postman and click **Import**.
2. Import `postman.collection.json`.
3. Import `postman.environment.json` and select it as the active environment.
4. Run requests from host folders; URL variables resolve automatically.

### Safety notes
- Exports are generated locally in the extension.
- Sensitive auth data is excluded from Postman artifacts by design.
- Review request bodies before sharing captures externally.
