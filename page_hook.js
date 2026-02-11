(() => {
  if (window.__RE_RECORDER_PAGE_HOOK__) return;
  window.__RE_RECORDER_PAGE_HOOK__ = true;

  let active = false;
  let integrityRetryDone = false;

  const originalFetch = window.fetch;
  const originalXhrOpen = XMLHttpRequest.prototype.open;
  const originalXhrSend = XMLHttpRequest.prototype.send;
  const originalXhrSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.source !== "RE_RECORDER_CONTROL") return;
    if (event.data.type === "START") {
      active = true;
      applyHooks();
    } else if (event.data.type === "STOP") {
      active = false;
    }
  });

  function applyHooks() {
    window.fetch = wrappedFetch;
    XMLHttpRequest.prototype.open = wrappedXhrOpen;
    XMLHttpRequest.prototype.send = wrappedXhrSend;
    XMLHttpRequest.prototype.setRequestHeader = wrappedXhrSetRequestHeader;
    setTimeout(checkIntegrity, 1500);
  }

  function checkIntegrity() {
    if (!active || integrityRetryDone) return;
    const fetchChanged = window.fetch !== wrappedFetch;
    const xhrChanged = XMLHttpRequest.prototype.send !== wrappedXhrSend;
    if (fetchChanged || xhrChanged) {
      integrityRetryDone = true;
      applyHooks();
    }
  }

  async function wrappedFetch(input, init = {}) {
    if (!active) return originalFetch.call(this, input, init);

    const startTime = Date.now();
    const url = typeof input === "string" ? input : input?.url;
    const method = (init?.method || input?.method || "GET").toUpperCase();
    const requestHeaders = headersToObject(init?.headers || input?.headers);
    const requestBody = parseBody(init?.body);

    try {
      const response = await originalFetch.call(this, input, init);
      const responseClone = response.clone();
      const responseHeaders = headersToObject(responseClone.headers);
      const contentType = responseHeaders["content-type"] || responseHeaders["Content-Type"] || "";
      const jsonLike = /application\/json|\+json/i.test(contentType);

      emit({
        type: "fetch",
        method,
        url,
        requestHeaders,
        requestBody,
        status: response.status,
        responseHeaders,
        responseBody: jsonLike ? await readJsonOrText(responseClone) : null,
        bodyCaptured: jsonLike,
        startTime,
        endTime: Date.now()
      });

      return response;
    } catch (error) {
      emit({
        type: "fetch",
        method,
        url,
        requestHeaders,
        requestBody,
        status: 0,
        responseHeaders: {},
        responseBody: { error: String(error) },
        bodyCaptured: false,
        startTime,
        endTime: Date.now()
      });
      throw error;
    }
  }

  function wrappedXhrOpen(method, url, ...rest) {
    this.__reRecorder = {
      method: String(method || "GET").toUpperCase(),
      url,
      startTime: Date.now(),
      requestHeaders: {},
      requestBody: null
    };
    return originalXhrOpen.call(this, method, url, ...rest);
  }

  function wrappedXhrSetRequestHeader(name, value) {
    if (this.__reRecorder) this.__reRecorder.requestHeaders[name] = value;
    return originalXhrSetRequestHeader.call(this, name, value);
  }

  function wrappedXhrSend(body) {
    if (this.__reRecorder) this.__reRecorder.requestBody = parseBody(body);

    this.addEventListener("loadend", () => {
      if (!active || !this.__reRecorder) return;
      const responseHeaders = parseRawHeaders(this.getAllResponseHeaders());
      const contentType = responseHeaders["content-type"] || responseHeaders["Content-Type"] || "";
      const jsonLike = /application\/json|\+json/i.test(contentType);

      emit({
        type: "xhr",
        method: this.__reRecorder.method,
        url: this.__reRecorder.url,
        requestHeaders: this.__reRecorder.requestHeaders,
        requestBody: this.__reRecorder.requestBody,
        status: this.status,
        responseHeaders,
        responseBody: jsonLike ? parseJsonOrText(this.responseText) : null,
        bodyCaptured: jsonLike,
        startTime: this.__reRecorder.startTime,
        endTime: Date.now()
      });
    });

    return originalXhrSend.call(this, body);
  }

  function emit(payload) {
    window.postMessage({ source: "RE_RECORDER", type: "NET_EVENT", payload }, "*");
  }

  function headersToObject(headers) {
    if (!headers) return {};
    if (headers instanceof Headers) {
      const out = {};
      headers.forEach((v, k) => (out[k] = v));
      return out;
    }
    if (Array.isArray(headers)) return Object.fromEntries(headers);
    return { ...headers };
  }

  function parseBody(body) {
    if (body == null) return null;
    if (typeof body === "string") return parseJsonOrText(body);
    if (body instanceof URLSearchParams) return body.toString();
    if (body instanceof FormData) return Array.from(body.entries());
    if (body instanceof Blob || body instanceof ArrayBuffer) return "[binary body omitted]";
    return body;
  }

  async function readJsonOrText(response) {
    try {
      return await response.json();
    } catch {
      try {
        return parseJsonOrText(await response.text());
      } catch {
        return "[unreadable response body]";
      }
    }
  }

  function parseJsonOrText(value) {
    if (typeof value !== "string") return value;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  function parseRawHeaders(raw) {
    const headers = {};
    const lines = raw.trim() ? raw.trim().split(/\r?\n/) : [];
    for (const line of lines) {
      const index = line.indexOf(":");
      if (index < 0) continue;
      headers[line.slice(0, index).trim()] = line.slice(index + 1).trim();
    }
    return headers;
  }
})();
