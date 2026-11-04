#!/usr/bin/env node
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { deriveWebhookSecret } from "./generate-webhook-secret.mjs";

function parseEnv(source) {
  const values = {};
  for (const [index, raw] of source.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (!match) throw new Error("Dòng " + (index + 1) + " trong .env không đúng KEY=VALUE.");
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

try {
  const env = parseEnv(readFileSync(resolve(".env"), "utf8"));
  if (!env.BOT_TOKEN) throw new Error("Thiếu BOT_TOKEN trong .env.");
  const values = {
    BOT_TOKEN: env.BOT_TOKEN,
    WEBHOOK_SECRET: deriveWebhookSecret(env.BOT_TOKEN),
    PAYMENT_BANK_CODE: env.PAYMENT_BANK_CODE || "",
    PAYMENT_BANK_NAME: env.PAYMENT_BANK_NAME || "",
    PAYMENT_ACCOUNT_NUMBER: env.PAYMENT_ACCOUNT_NUMBER || "",
    PAYMENT_ACCOUNT_NAME: env.PAYMENT_ACCOUNT_NAME || "",
    PAYMENT_QR_URL: env.PAYMENT_QR_URL || "",
    PAYMENT_TRANSFER_NOTE_PREFIX: env.PAYMENT_TRANSFER_NOTE_PREFIX || "HENDY",
    SUPPORT_URL: env.SUPPORT_URL || ""
  };
  const output = Object.entries(values).map(([key, value]) => key + "=" + JSON.stringify(value)).join("\n") + "\n";
  const outputPath = resolve(".dev.vars");
  writeFileSync(outputPath, output, { mode: 0o600 });
  // Enforce owner-only permissions even when .dev.vars already existed.
  try { chmodSync(outputPath, 0o600); } catch { /* Windows ACLs are managed by the OS. */ }
  console.log("Đã tạo .dev.vars local với quyền truy cập hạn chế. File này nằm trong .gitignore, không được commit.");
} catch (error) {
  console.error("Không thể tạo .dev.vars: " + error.message);
  process.exit(1);
}
