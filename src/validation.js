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
