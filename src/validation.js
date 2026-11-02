const DEFAULT_MEDIA_HOSTS = [
  "youtube.com",
  "youtu.be",
  "tiktok.com",
  "facebook.com",
  "fb.watch"
];

export function isAllowedMediaUrl(input, configuredHosts = "") {
  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) return false;
  const configured = String(configuredHosts || "").split(",").map((host) => host.trim().toLowerCase()).filter(Boolean);
  const allowed = configured.length ? configured : DEFAULT_MEDIA_HOSTS;
  const hostname = parsed.hostname.toLowerCase();
  return allowed.some((host) => hostname === host || hostname.endsWith("." + host));
}

export function parseJsonObject(value, maxBytes = 8192) {
  if (typeof value !== "string" || new TextEncoder().encode(value).byteLength > maxBytes) {
    throw new Error("Invalid JSON payload size");
  }
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected a JSON object");
  }
  return parsed;
}

/**
 * Resolve the Telegram webhook URL.
 * A configured TELEGRAM_WEBHOOK_URL intentionally overrides the current
 * Worker host; when absent, use the hostname that received this request.
 */
export function resolveTelegramWebhookUrl(requestUrl, configuredOverride = "") {
  const request = new URL(requestUrl);
  if (request.protocol !== "https:") {
    throw new Error("The Worker request URL must use HTTPS.");
  }

  const override = String(configuredOverride || "").trim();
  if (!override) {
    return {
      url: `${request.origin}/webhook`,
      source: "worker_hostname"
    };
  }

  let parsed;
  try {
    parsed = new URL(override);
  } catch {
    throw new Error("TELEGRAM_WEBHOOK_URL must be a valid absolute HTTPS URL.");
  }

  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("TELEGRAM_WEBHOOK_URL must use HTTPS and cannot contain credentials, query parameters, or fragments.");
  }

  const path = parsed.pathname.replace(/\/+$/, "") || "/";
  if (path !== "/" && path !== "/webhook") {
    throw new Error("TELEGRAM_WEBHOOK_URL must point to the Worker root or end with /webhook.");
  }

  return {
    url: `${parsed.origin}/webhook`,
    source: "TELEGRAM_WEBHOOK_URL"
  };
}
