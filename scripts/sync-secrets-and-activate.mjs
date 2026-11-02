import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import {
  buildSecretPayload,
  getWorkerBaseUrl,
  parseDotEnv,
  validateSetupValues
} from "./secret-sync-utils.mjs";

const varsPath = resolve(process.cwd(), ".dev.vars");

function fail(message) {
  console.error(message);
  process.exit(1);
}

let values;
try {
  values = parseDotEnv(readFileSync(varsPath, "utf8"));
} catch {
  fail("Cannot read .dev.vars. Copy .dev.vars.example to .dev.vars and fill the new credentials locally.");
}

const validationErrors = validateSetupValues(values);
if (validationErrors.length) {
  console.error("Setup stopped. Fix these .dev.vars fields:");
  for (const item of validationErrors) console.error(" - " + item);
  fail("No secrets were uploaded and the Telegram webhook was not changed.");
}

const payload = buildSecretPayload(values);
const secretNames = Object.keys(payload);
const executable = process.platform === "win32" ? "npx.cmd" : "npx";

console.log("[1/2] Syncing secret values to the Cloudflare Worker...");
const upload = spawnSync(
  executable,
  ["wrangler", "secret", "bulk", "--name", "hendy-server-pro"],
  {
    cwd: process.cwd(),
    input: JSON.stringify(payload),
    encoding: "utf8",
    windowsHide: true,
    shell: process.platform === "win32",
    maxBuffer: 2 * 1024 * 1024
  }
);

if (upload.error || upload.status !== 0) {
  // Do not print subprocess input or raw output: neither may reveal credentials.
  fail("Cloudflare secret upload failed. Check Wrangler login, the selected Cloudflare account, and Workers Scripts permission.");
}
console.log("Uploaded secret entries: " + secretNames.join(", "));

const workerBaseUrl = getWorkerBaseUrl(values);
const setupKey = String(values.WEBHOOK_SETUP_KEY).trim();

console.log("[2/2] Validating BOT_TOKEN and registering Telegram webhook...");
let response;
let result;
try {
  response = await fetch(workerBaseUrl + "/set-webhook", {
    method: "POST",
    headers: {
      authorization: "Bearer " + setupKey,
      accept: "application/json"
    },
    signal: AbortSignal.timeout(30_000)
  });
  result = await response.json();
} catch {
  fail("Could not reach the Worker activation endpoint. Check WORKER_BASE_URL and the latest Worker deployment.");
}

if (!response.ok || !result?.ok || !result?.webhook?.verified) {
  console.error("Telegram webhook setup failed.");
  if (result?.error) console.error("Error: " + result.error);
  if (result?.message) console.error("Details: " + String(result.message).slice(0, 500));
  if (result?.webhook?.last_error_message) {
    console.error("Telegram last error: " + String(result.webhook.last_error_message).slice(0, 500));
  }
  fail("Secrets were synced, but the webhook was not verified. Correct the reported issue and run npm run bot:setup again.");
}

console.log("Bot verified with Telegram.");
console.log("Bot username: " + (result.bot?.username ? "@" + result.bot.username : "(username unavailable)"));
console.log("Webhook URL: " + result.webhook.url);
console.log("URL source: " + result.webhook.source);
console.log("Webhook verified: yes");
console.log("Pending Telegram updates: " + Number(result.webhook.pending_update_count || 0));
if (result.webhook.last_error_message) {
  console.warn("Telegram reports a previous delivery error: " + String(result.webhook.last_error_message).slice(0, 500));
}
console.log("Setup complete. Send /start to the bot in Telegram.");
