#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  VARIABLE_REGISTRY,
  classifyVariables,
  formatVariableReport,
  generateInternalKeys,
  mergeDevVarsContent,
  validateAllConfiguration
} from "./env-manager-utils.mjs";
import { parseDotEnv } from "./secret-sync-utils.mjs";

const rootDir = process.cwd();
const devVarsPath = resolve(rootDir, ".dev.vars");
const wranglerPath = resolve(rootDir, "wrangler.toml");

function loadWranglerConfig() {
  if (!existsSync(wranglerPath)) return {};
  const content = readFileSync(wranglerPath, "utf8");
  const vars = {};
  const varsMatch = content.match(/\[vars\]([^\[]+)/);
  if (varsMatch) {
    for (const line of varsMatch[1].split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"([^"]*)"/);
      if (m) vars[m[1]] = m[2];
    }
  }

  const d1Match = content.match(/\[\[d1_databases\]\]/g) || [];
  const doMatch = content.match(/\[\[durable_objects\.bindings\]\]/g) || [];
  const queueMatch = content.match(/\[\[queues\.producers\]\]/g) || [];
  const r2Match = content.match(/\[\[r2_buckets\]\]/g) || [];

  return {
    vars,
    d1_databases: d1Match,
    durable_objects: { bindings: doMatch },
    queues: { producers: queueMatch },
    r2_buckets: r2Match
  };
}

function loadDevVars() {
  if (!existsSync(devVarsPath)) return {};
  try {
    return parseDotEnv(readFileSync(devVarsPath, "utf8"));
  } catch {
    return {};
  }
}

async function verifyWebhookDirect(botToken, expectedUrl) {
  if (!botToken) return { ok: false, error: "BOT_TOKEN not configured" };
  try {
    const meRes = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
    const me = await meRes.json().catch(() => ({}));
    if (!me.ok) return { ok: false, error: "Telegram getMe failed: " + (me.description || "invalid token") };

    const infoRes = await fetch(`https://api.telegram.org/bot${botToken}/getWebhookInfo`);
    const info = await infoRes.json().catch(() => ({}));
    const actualUrl = info.result?.url || "";
    const isMatching = expectedUrl ? actualUrl.replace(/\/+$/, "") === expectedUrl.replace(/\/+$/, "") : Boolean(actualUrl);

    return {
      ok: true,
      bot: me.result,
      webhook: {
        url: actualUrl,
        matchesExpected: isMatching,
        pending_update_count: info.result?.pending_update_count || 0,
        last_error_message: info.result?.last_error_message || null,
        last_error_date: info.result?.last_error_date || null
      }
    };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function main() {
  const command = process.argv[2] || "report";
  const devVars = loadDevVars();
  const wranglerConfig = loadWranglerConfig();

  if (command === "report") {
    const classification = classifyVariables(devVars, wranglerConfig);
    console.log(formatVariableReport(classification));
    return;
  }

  if (command === "generate" || command === "sync") {
    console.log("⚡ Auto-generating missing internal keys (preserving all existing settings)...");
    const { values, generatedKeys } = generateInternalKeys(devVars, { preserveExisting: true });

    if (generatedKeys.length > 0) {
      console.log(`Generated ${generatedKeys.length} keys: ${generatedKeys.join(", ")}`);
      const existingRaw = existsSync(devVarsPath) ? readFileSync(devVarsPath, "utf8") : "";
      const updated = mergeDevVarsContent(existingRaw, values, { preserveExisting: true });
      writeFileSync(devVarsPath, updated, { mode: 0o600 });
      console.log("✅ Updated .dev.vars safely without overwriting existing settings.");
    } else {
      console.log("ℹ️ All internal keys are already set. No keys were overwritten.");
    }

    const classification = classifyVariables(values, wranglerConfig);
    console.log(formatVariableReport(classification));
    return;
  }

  if (command === "check") {
    const combined = { ...devVars, ...wranglerConfig.vars };
    const errors = validateAllConfiguration(combined);
    if (errors.length) {
      console.error("❌ Configuration validation failed with errors:");
      for (const err of errors) console.error("  • " + err);
      process.exit(1);
    }
    console.log("✅ All configured variables passed validation!");
    return;
  }

  if (command === "verify-webhook") {
    const botToken = devVars.BOT_TOKEN;
    const targetUrl = devVars.TELEGRAM_WEBHOOK_URL || (devVars.WORKER_BASE_URL ? `${devVars.WORKER_BASE_URL}/webhook` : null);
    console.log("🔍 Checking Telegram Webhook status...");
    const check = await verifyWebhookDirect(botToken, targetUrl);
    if (!check.ok) {
      console.error("❌ Webhook verification error: " + check.error);
      process.exit(1);
    }
    console.log(`🤖 Bot identity: @${check.bot.username} (${check.bot.first_name})`);
    console.log(`📡 Current webhook URL: ${check.webhook.url || "(none)"}`);
    console.log(`📬 Pending updates: ${check.webhook.pending_update_count}`);
    if (check.webhook.last_error_message) {
      console.warn(`⚠️ Last delivery error: ${check.webhook.last_error_message}`);
    } else {
      console.log("✅ Webhook delivery is healthy.");
    }
    return;
  }

  console.log(`Usage: node scripts/env-manager.mjs [report|generate|check|verify-webhook]`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
