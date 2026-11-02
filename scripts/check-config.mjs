import { readFileSync } from "node:fs";

const config = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
const required = [
  ['Worker entrypoint', /main\s*=\s*"src\/index\.js"/],
  ['D1 binding', /binding\s*=\s*"DB"/],
  ['Durable Object binding', /class_name\s*=\s*"BotSocket"/],
  ['Queue producer binding', /binding\s*=\s*"JOBS_QUEUE"/],
  ['R2 bucket binding', /binding\s*=\s*"ASSETS"/]
];
const errors = required.filter(([, pattern]) => !pattern.test(config)).map(([name]) => name);
if (errors.length) {
  console.error("Invalid Wrangler configuration:", errors.join(", "));
  process.exit(1);
}
if (/BOT_TOKEN\s*=|WEBHOOK_SECRET_TOKEN\s*=/.test(config)) {
  console.error("Do not store Telegram credentials in wrangler.toml.");
  process.exit(1);
}
console.log("Wrangler configuration structure looks valid. Check resource IDs and Cloudflare bindings before deployment.");
