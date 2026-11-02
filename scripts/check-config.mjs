import { readFileSync } from "node:fs";

const config = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
const required = [
  ["Worker entrypoint", /main\\s*=\\s*"src\\/index\\.js"/],
  ["D1 binding", /binding\\s*=\\s*"DB"/],
  ["Durable Object binding", /class_name\\s*=\\s*"BotSocket"/],
  ["Queue producer binding", /binding\\s*=\\s*"JOBS_QUEUE"/],
  ["R2 bucket binding", /binding\\s*=\\s*"ASSETS"/]
];
const errors = required.filter(([, pattern]) => !pattern.test(config)).map(([name]) => name);

const compatibilityDate = config.match(/^compatibility_date\\s*=\\s*"([0-9]{4}-[0-9]{2}-[0-9]{2})"/m)?.[1];
const todayUtc = new Date().toISOString().slice(0, 10);
if (!compatibilityDate) {
  errors.push("Cloudflare compatibility_date");
} else if (compatibilityDate > todayUtc) {
  errors.push(`compatibility_date is in the future (${compatibilityDate}; UTC today is ${todayUtc})`);
}

const databaseId = config.match(/^database_id\\s*=\\s*"([^"]+)"/m)?.[1];
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!databaseId || !uuidPattern.test(databaseId) || /^0{8}-0{4}-0{4}-0{4}-0{12}$/i.test(databaseId)) {
  errors.push("real D1 database_id");
}

if (errors.length) {
  console.error("Invalid Wrangler configuration:", errors.join(", "));
  process.exit(1);
}
if (/BOT_TOKEN\\s*=|WEBHOOK_SECRET_TOKEN\\s*=/.test(config)) {
  console.error("Do not store Telegram credentials in wrangler.toml.");
  process.exit(1);
}
console.log(`Wrangler configuration looks valid (compatibility_date ${compatibilityDate}, D1 binding configured).`);
