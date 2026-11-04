#!/usr/bin/env node
import { createHmac } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function deriveWebhookSecret(botToken) {
  if (typeof botToken !== "string" || !/^\d+:[A-Za-z0-9_-]{20,}$/.test(botToken)) {
    throw new Error("BOT_TOKEN không hợp lệ.");
  }
  // Secret ổn định giữa các lần deploy; không cần lưu thêm GitHub Secret.
  return createHmac("sha256", botToken)
    .update("hendydichvumang:telegram-webhook:v1", "utf8")
    .digest("hex");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(deriveWebhookSecret(process.env.BOT_TOKEN || "") + "\n");
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
