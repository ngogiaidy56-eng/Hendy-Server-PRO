const REQUIRED_SECRET_NAMES = [
  "BOT_TOKEN",
  "WEBHOOK_SECRET_TOKEN",
  "WEBHOOK_SETUP_KEY"
];

const OPTIONAL_SECRET_NAMES = [
  "ADMIN_API_TOKEN",
  "SOCKET_SIGNING_SECRET",
  "INTERNAL_API_SECRET",
  "CORE_BACKEND_TOKEN"
];

export function parseDotEnv(source) {
  const values = {};
  for (const rawLine of String(source).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;

    let value = match[2].trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
       (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
      if (match[2].trim().startsWith('"')) {
        value = value.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
      }
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    values[match[1]] = value;
  }
  return values;
}

export function validateSetupValues(values) {
  const errors = [];

  for (const name of REQUIRED_SECRET_NAMES) {
    if (!String(values[name] || "").trim()) errors.push(name + " is required");
  }

  const botToken = String(values.BOT_TOKEN || "").trim();
  if (botToken && !/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(botToken)) {
    errors.push("BOT_TOKEN format is invalid");
  }

  const webhookSecret = String(values.WEBHOOK_SECRET_TOKEN || "").trim();
  if (webhookSecret && !/^[A-Za-z0-9_-]{32,256}$/.test(webhookSecret)) {
    errors.push("WEBHOOK_SECRET_TOKEN must be 32-256 characters using A-Z, a-z, 0-9, _ or -");
  }

  const setupKey = String(values.WEBHOOK_SETUP_KEY || "").trim();
  if (setupKey && setupKey.length < 32) {
    errors.push("WEBHOOK_SETUP_KEY must contain at least 32 characters");
  }

  for (const name of OPTIONAL_SECRET_NAMES) {
    const value = String(values[name] || "").trim();
    if (value && value.length < 32) errors.push(name + " must contain at least 32 characters or be left blank");
  }

  const secretValues = [
    "WEBHOOK_SECRET_TOKEN",
    "WEBHOOK_SETUP_KEY",
    ...OPTIONAL_SECRET_NAMES
  ].map((name) => String(values[name] || "").trim()).filter(Boolean);
  if (new Set(secretValues).size !== secretValues.length) {
    errors.push("Each configured secret must have a different value");
  }

  const webhookUrl = String(values.TELEGRAM_WEBHOOK_URL || "").trim();
  if (webhookUrl) {
    try {
      const parsed = new URL(webhookUrl);
      const path = parsed.pathname.replace(/\/+$/, "") || "/";
      if (
        parsed.protocol !== "https:" ||
        parsed.username ||
        parsed.password ||
        parsed.search ||
        parsed.hash ||
        (path !== "/" && path !== "/webhook")
      ) {
        errors.push("TELEGRAM_WEBHOOK_URL must be HTTPS and point to the domain root or /webhook");
      }
    } catch {
      errors.push("TELEGRAM_WEBHOOK_URL must be a valid absolute HTTPS URL");
    }
  }

  const workerBase = String(values.WORKER_BASE_URL || "").trim();
  if (workerBase) {
    try {
      const parsed = new URL(workerBase);
      if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/") {
        errors.push("WORKER_BASE_URL must be an HTTPS origin without a path, query, or fragment");
      }
    } catch {
      errors.push("WORKER_BASE_URL must be a valid HTTPS origin");
    }
  }

  return errors;
}

export function buildSecretPayload(values) {
  const payload = {};
  for (const name of REQUIRED_SECRET_NAMES) payload[name] = String(values[name]).trim();

  for (const name of OPTIONAL_SECRET_NAMES) {
    const value = String(values[name] || "").trim();
    if (value) payload[name] = value;
  }

  // Null removes a previously uploaded secret override when the local entry is blank.
  if (Object.hasOwn(values, "TELEGRAM_WEBHOOK_URL")) {
    const value = String(values.TELEGRAM_WEBHOOK_URL || "").trim();
    payload.TELEGRAM_WEBHOOK_URL = value || null;
  }
  return payload;
}

export function getWorkerBaseUrl(values) {
  return String(values.WORKER_BASE_URL || "https://hendy-server-pro.ngogiaidy56.workers.dev").trim().replace(/\/+$/, "");
}
