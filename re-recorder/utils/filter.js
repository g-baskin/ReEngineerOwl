const ANALYTICS_PATTERNS = [
  "google-analytics.com",
  "googletagmanager.com",
  "doubleclick.net",
  "facebook.com/tr",
  "segment.io",
  "amplitude.com",
  "mixpanel.com",
  "hotjar.com",
  "sentry.io"
];

const STATIC_EXTENSIONS = [
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico",
  ".css", ".js", ".map", ".woff", ".woff2", ".ttf", ".eot",
  ".mp4", ".mp3", ".webm", ".avi"
];

const API_HINTS = ["/api/", "/graphql", "/trpc"];

function hasStaticExtension(url) {
  const lower = url.toLowerCase();
  return STATIC_EXTENSIONS.some((ext) => lower.includes(ext));
}

function isAnalytics(url) {
  const lower = url.toLowerCase();
  return ANALYTICS_PATTERNS.some((pattern) => lower.includes(pattern));
}

function looksLikeApi(url, mimeType = "") {
  const lowerUrl = url.toLowerCase();
  const lowerMime = String(mimeType).toLowerCase();
  return (
    API_HINTS.some((hint) => lowerUrl.includes(hint)) ||
    lowerMime.includes("application/json") ||
    lowerMime.includes("application/problem+json")
  );
}

export function filterEntries(rawEntries, options = {}) {
  const { fullCapture = false, strictStatus = true, inspectedOrigin = "" } = options;

  return rawEntries.filter((entry) => {
    const url = entry?.request?.url || "";
    const status = Number(entry?.response?.status || 0);
    const mimeType = entry?.response?.content?.mimeType || "";

    if (!url || isAnalytics(url) || hasStaticExtension(url)) {
      return false;
    }

    if (strictStatus && (status < 200 || status >= 400)) {
      return false;
    }

    if (fullCapture) {
      return true;
    }

    const sameOrigin = inspectedOrigin ? url.startsWith(inspectedOrigin) : false;
    const jsonResponse = String(mimeType).toLowerCase().includes("json");
    return sameOrigin || looksLikeApi(url, mimeType) || jsonResponse;
  });
}
