import { randomBytes } from "node:crypto";

/**
 * Universal Variable Registry
 * Central single source of truth for all environment variables, secrets,
 * and Cloudflare Worker bindings used in Hendy Server PRO.
 */
export const VARIABLE_REGISTRY = {
  // --- SECRETS ---
  BOT_TOKEN: {
    name: "BOT_TOKEN",
    type: "secret",
    required: true,
    autoGeneratable: false,
    description: "Telegram Bot API token issued by @BotFather",
    validator: (val) => /^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(String(val || "").trim()) || "Invalid Telegram bot token format"
  },
  WEBHOOK_SECRET_TOKEN: {
    name: "WEBHOOK_SECRET_TOKEN",
    type: "secret",
    required: true,
    autoGeneratable: true,
    description: "Secret token for X-Telegram-Bot-Api-Secret-Token validation",
    generator: () => randomBytes(32).toString("hex"), // 64 hex chars
    validator: (val) => /^[A-Za-z0-9_-]{32,256}$/.test(String(val || "").trim()) || "Must be 32-256 chars (alphanumeric, _ or -)"
  },
  WEBHOOK_SETUP_KEY: {
    name: "WEBHOOK_SETUP_KEY",
    type: "secret",
    required: true,
    autoGeneratable: true,
    description: "Bearer key authorizing /set-webhook and /webhook-info endpoints",
    generator: () => randomBytes(32).toString("base64url"),
    validator: (val) => String(val || "").trim().length >= 32 || "Must contain at least 32 characters"
  },
  ADMIN_API_TOKEN: {
    name: "ADMIN_API_TOKEN",
    type: "secret",
    required: false,
    autoGeneratable: true,
    description: "Bearer key authorizing admin REST & management API endpoints",
    generator: () => randomBytes(32).toString("base64url"),
    validator: (val) => !val || String(val).trim().length >= 32 || "Must contain at least 32 characters or be left blank"
  },
  SOCKET_SIGNING_SECRET: {
    name: "SOCKET_SIGNING_SECRET",
    type: "secret",
    required: false,
    autoGeneratable: true,
    description: "Secret key for HMAC signing and verification of WebSocket tickets",
    generator: () => randomBytes(32).toString("base64url"),
    validator: (val) => !val || String(val).trim().length >= 32 || "Must contain at least 32 characters or be left blank"
  },
  INTERNAL_API_SECRET: {
    name: "INTERNAL_API_SECRET",
    type: "secret",
    required: false,
    autoGeneratable: true,
    description: "Secret key for internal Durable Object event dispatching (/publish)",
    generator: () => randomBytes(32).toString("base64url"),
    validator: (val) => !val || String(val).trim().length >= 32 || "Must contain at least 32 characters or be left blank"
  },
  CORE_BACKEND_TOKEN: {
    name: "CORE_BACKEND_TOKEN",
    type: "secret",
    required: false,
    autoGeneratable: false,
    description: "Bearer token for authenticating calls to external Vietsub Core Backend",
    validator: (val) => !val || String(val).trim().length >= 16 || "Must contain at least 16 characters or be left blank"
  },

  // --- VARIABLES (Non-secret runtime configurations) ---
  APP_ENV: {
    name: "APP_ENV",
    type: "variable",
    required: false,
    default: "production",
    description: "Application environment mode (production or development)",
    validator: (val) => ["production", "development", "staging", "test"].includes(String(val || "production").trim()) || "Must be production, development, staging or test"
  },
  ADMIN_IDS: {
    name: "ADMIN_IDS",
    type: "variable",
    required: false,
    description: "Comma-separated Telegram user IDs with bot administrator privileges",
    validator: (val) => !val || /^[0-9,\s]+$/.test(String(val).trim()) || "Must be numeric Telegram IDs separated by commas"
  },
  MEDIA_ALLOWED_HOSTS: {
    name: "MEDIA_ALLOWED_HOSTS",
    type: "variable",
    required: false,
    default: "youtube.com,youtu.be,tiktok.com,facebook.com,fb.watch",
    description: "Allowlisted domain names for video source URLs",
    validator: (val) => !val || typeof val === "string" || "Must be a string of comma-separated hosts"
  },
  CORE_BACKEND_URL: {
    name: "CORE_BACKEND_URL",
    type: "variable",
    required: false,
    description: "Base HTTPS URL of external Vietsub Core Backend service",
    validator: (val) => {
      if (!val) return true;
      try {
        const u = new URL(val);
        return u.protocol === "https:" || "Must be HTTPS URL";
      } catch {
        return "Must be a valid URL";
      }
    }
  },
  TELEGRAM_WEBHOOK_URL: {
    name: "TELEGRAM_WEBHOOK_URL",
    type: "variable",
    required: false,
    description: "Optional explicit public HTTPS URL override for Telegram webhook",
    validator: (val) => {
      if (!val) return true;
      try {
        const u = new URL(val);
        const path = u.pathname.replace(/\/+$/, "") || "/";
        return (u.protocol === "https:" && !u.username && !u.search && !u.hash && (path === "/" || path === "/webhook")) ||
          "Must be HTTPS URL without credentials/params, pointing to root or /webhook";
      } catch {
        return "Must be a valid URL";
      }
    }
  },
  WORKER_BASE_URL: {
    name: "WORKER_BASE_URL",
    type: "variable",
    required: false,
    default: "https://hendy-server-pro.ngogiaidy56.workers.dev",
    description: "Base HTTPS domain where Worker is deployed",
    validator: (val) => {
      if (!val) return true;
      try {
        const u = new URL(val);
        return (u.protocol === "https:" && !u.username && !u.search && !u.hash && (u.pathname === "/" || !u.pathname)) ||
          "Must be a valid HTTPS origin";
      } catch {
        return "Must be a valid HTTPS URL";
      }
    }
  },
  SUPPORT_URL: {
    name: "SUPPORT_URL",
    type: "variable",
    required: false,
    description: "Contact or support channel HTTPS URL",
    validator: (val) => !val || /^https:\/\//i.test(String(val).trim()) || "Must be an HTTPS URL"
  },

  // --- BINDINGS (Cloudflare infrastructure resources) ---
  DB: {
    name: "DB",
    type: "binding",
    required: true,
    description: "Cloudflare D1 Database binding (hendy-server-pro-db)"
  },
  BOT_SOCKET: {
    name: "BOT_SOCKET",
    type: "binding",
    required: false,
    description: "Cloudflare Durable Object binding for real-time WebSocket sessions"
  },
  JOBS_QUEUE: {
    name: "JOBS_QUEUE",
    type: "binding",
    required: false,
    description: "Cloudflare Queue binding (hendy-server-pro-jobs) for asynchronous tasks"
  },
  ASSETS: {
    name: "ASSETS",
    type: "binding",
    required: false,
    description: "Cloudflare R2 Bucket binding (hendy-server-pro-assets) for media storage"
  }
};

/**
 * Masks a secret value for safe logging / reporting.
 */
export function maskSecret(val) {
  const str = String(val || "").trim();
  if (!str) return "(not set)";
  if (str.length <= 8) return "••••••••";
  return str.slice(0, 4) + "••••••••" + str.slice(-4);
}

/**
 * Classifies all configured and known variables.
 */
export function classifyVariables(envValues = {}, wranglerConfig = {}) {
  const secrets = { required: [], optional: [] };
  const variables = { configured: [], missing: [] };
  const bindings = { configured: [], missing: [] };

  const combined = { ...envValues, ...(wranglerConfig.vars || {}) };

  for (const [key, meta] of Object.entries(VARIABLE_REGISTRY)) {
    const rawVal = combined[key];
    const isSet = rawVal !== undefined && String(rawVal).trim().length > 0;

    const item = {
      name: key,
      type: meta.type,
      required: Boolean(meta.required),
      autoGeneratable: Boolean(meta.autoGeneratable),
      description: meta.description,
      isConfigured: isSet,
      maskedValue: isSet ? (meta.type === "secret" ? maskSecret(rawVal) : String(rawVal)) : "(empty)"
    };

    if (meta.type === "secret") {
      if (meta.required) secrets.required.push(item);
      else secrets.optional.push(item);
    } else if (meta.type === "variable") {
      if (isSet) variables.configured.push(item);
      else variables.missing.push(item);
    } else if (meta.type === "binding") {
      const bindingConfigured = Boolean(
        (key === "DB" && wranglerConfig.d1_databases?.length) ||
        (key === "BOT_SOCKET" && wranglerConfig.durable_objects?.bindings?.length) ||
        (key === "JOBS_QUEUE" && wranglerConfig.queues?.producers?.length) ||
        (key === "ASSETS" && wranglerConfig.r2_buckets?.length)
      );
      item.isConfigured = bindingConfigured;
      if (bindingConfigured) bindings.configured.push(item);
      else bindings.missing.push(item);
    }
  }

  return { secrets, variables, bindings };
}

/**
 * Automatically generates cryptographic internal keys for missing or empty secrets.
 * Crucial safety guarantee: By default (preserveExisting: true), existing external
 * configurations and service settings are NEVER overwritten.
 */
export function generateInternalKeys(existingValues = {}, options = { preserveExisting: true }) {
  const preserve = options?.preserveExisting !== false;
  const result = { ...existingValues };
  const generatedKeys = [];

  for (const [key, meta] of Object.entries(VARIABLE_REGISTRY)) {
    if (meta.type !== "secret" || !meta.autoGeneratable) continue;

    const currentVal = String(result[key] || "").trim();
    const shouldGenerate = !preserve || !currentVal;

    if (shouldGenerate) {
      result[key] = meta.generator();
      generatedKeys.push(key);
    }
  }

  return { values: result, generatedKeys };
}

/**
 * Validates the combined configuration against format and anti-reuse rules.
 */
export function validateAllConfiguration(values = {}) {
  const errors = [];
  const configuredSecrets = [];

  for (const [key, meta] of Object.entries(VARIABLE_REGISTRY)) {
    if (meta.type === "binding") continue; // Cloudflare bindings are verified via wrangler.toml/runtime
    const raw = values[key];
    const str = String(raw || "").trim();

    if (meta.required && !str) {
      errors.push(`${key} (${meta.description}) is required but missing`);
      continue;
    }

    if (str && meta.validator) {
      const check = meta.validator(str);
      if (check !== true) {
        errors.push(`${key}: ${check}`);
      }
    }

    if (meta.type === "secret" && str) {
      configuredSecrets.push({ key, val: str });
    }
  }

  // Anti-secret-reuse check: Ensure all secrets have unique values
  const seenSecrets = new Map();
  for (const { key, val } of configuredSecrets) {
    if (seenSecrets.has(val)) {
      errors.push(`Secret reuse detected: ${key} has the same value as ${seenSecrets.get(val)}`);
    } else {
      seenSecrets.set(val, key);
    }
  }

  return errors;
}

/**
 * Formats a clean, readable ASCII report of all variables.
 */
export function formatVariableReport(classification, options = { maskSecrets: true }) {
  const lines = [
    "============================================================",
    "       HENDY SERVER PRO — VARIABLE & CONFIG REPORT",
    "============================================================"
  ];

  lines.push("\n🔒 SECRETS (Required):");
  for (const s of classification.secrets.required) {
    const status = s.isConfigured ? "✅ CONFIGURED" : "❌ MISSING";
    lines.push(`  • ${s.name.padEnd(24)} [${status}] ${options.maskSecrets ? s.maskedValue : ""}`);
    lines.push(`    ↳ ${s.description}`);
  }

  lines.push("\n🔑 SECRETS (Optional / Auto-generatable):");
  for (const s of classification.secrets.optional) {
    const status = s.isConfigured ? "✅ CONFIGURED" : (s.autoGeneratable ? "⚡ AUTO-GENERATABLE" : "ℹ️ OPTIONAL");
    lines.push(`  • ${s.name.padEnd(24)} [${status}] ${options.maskSecrets ? s.maskedValue : ""}`);
    lines.push(`    ↳ ${s.description}`);
  }

  lines.push("\n⚙️  VARIABLES (Runtime Config):");
  for (const v of [...classification.variables.configured, ...classification.variables.missing]) {
    const status = v.isConfigured ? "✅ CONFIGURED" : "ℹ️ DEFAULT/UNSET";
    lines.push(`  • ${v.name.padEnd(24)} [${status}] = ${v.maskedValue}`);
    lines.push(`    ↳ ${v.description}`);
  }

  lines.push("\n📦 CLOUDFLARE BINDINGS:");
  for (const b of [...classification.bindings.configured, ...classification.bindings.missing]) {
    const status = b.isConfigured ? "✅ BOUND" : "⚠️ UNBOUND";
    lines.push(`  • ${b.name.padEnd(24)} [${status}]`);
    lines.push(`    ↳ ${b.description}`);
  }

  lines.push("\n============================================================");
  return lines.join("\n");
}

/**
 * Safely updates .dev.vars content, preserving comments and existing values.
 */
export function mergeDevVarsContent(existingContent, newValues, options = { preserveExisting: true }) {
  const preserve = options?.preserveExisting !== false;
  const lines = String(existingContent || "").split(/\r?\n/);
  const seenKeys = new Set();
  const output = [];

  for (const line of lines) {
    const match = line.match(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
    if (match) {
      const [, indent, key, existingVal] = match;
      seenKeys.add(key);

      if (Object.hasOwn(newValues, key)) {
        const newVal = String(newValues[key] ?? "").trim();
        const curVal = String(existingVal).trim().replace(/^["']|["']$/g, "");
        if (preserve && curVal) {
          // Keep existing value
          output.push(line);
        } else if (newVal) {
          output.push(`${indent}${key}=${newVal}`);
        } else {
          output.push(line);
        }
      } else {
        output.push(line);
      }
    } else {
      output.push(line);
    }
  }

  // Append new keys that weren't in the file yet
  for (const [key, val] of Object.entries(newValues)) {
    if (!seenKeys.has(key) && String(val || "").trim()) {
      output.push(`${key}=${val}`);
    }
  }

  return output.join("\n").replace(/\n*$/, "\n");
}
