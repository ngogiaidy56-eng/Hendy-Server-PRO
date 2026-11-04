#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

let savedOutputs = {};
if (existsSync(".cloudflare-outputs.json")) {
  try { savedOutputs = JSON.parse(readFileSync(".cloudflare-outputs.json", "utf8")); } catch {}
}
const value = (key) => process.env[key] || savedOutputs[key] || "";
const required = ["D1_DATABASE_ID", "KV_NAMESPACE_ID", "MINI_APP_URL", "WORKER_API_URL"];
const missing = required.filter((key) => !value(key));
if (missing.length) {
  console.error("Missing Cloudflare deployment outputs: " + missing.join(", "));
  process.exit(1);
}

const databaseId = value("D1_DATABASE_ID");
const namespaceId = value("KV_NAMESPACE_ID");
const miniAppUrl = String(value("MINI_APP_URL")).replace(/\/$/, "");
const workerApiUrl = String(value("WORKER_API_URL")).replace(/\/$/, "");

if (!/^[a-f0-9-]{36}$/i.test(databaseId)) {
  console.error("D1_DATABASE_ID is not a valid UUID.");
  process.exit(1);
}
if (!/^[a-f0-9]{32}$/i.test(namespaceId)) {
  console.error("KV_NAMESPACE_ID is not a valid Cloudflare namespace ID.");
  process.exit(1);
}
for (const [name, value] of [["MINI_APP_URL", miniAppUrl], ["WORKER_API_URL", workerApiUrl]]) {
  if (!value.startsWith("https://")) {
    console.error(name + " must be an HTTPS URL.");
    process.exit(1);
  }
}

const sourcePath = resolve("apps/telegram-worker/wrangler.toml");
const outputPath = resolve("apps/telegram-worker/wrangler.generated.toml");
let config = readFileSync(sourcePath, "utf8");
const replacements = {
  "__D1_DATABASE_ID__": databaseId,
  "__KV_NAMESPACE_ID__": namespaceId,
  "__MINI_APP_URL__": miniAppUrl
};
for (const [placeholder, value] of Object.entries(replacements)) {
  if (!config.includes(placeholder)) {
    console.error("Missing Wrangler placeholder " + placeholder);
    process.exit(1);
  }
  config = config.replaceAll(placeholder, value);
}
writeFileSync(outputPath, config);
console.log("Generated deployment-specific Wrangler config: " + outputPath);
