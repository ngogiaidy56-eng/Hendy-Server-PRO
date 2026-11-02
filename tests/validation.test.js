import test from "node:test";
import assert from "node:assert/strict";
import { isAllowedMediaUrl, parseJsonObject, resolveTelegramWebhookUrl } from "../src/validation.js";

test("media URL allowlist accepts HTTPS hosts and subdomains", () => {
  assert.equal(isAllowedMediaUrl("https://youtu.be/example"), true);
  assert.equal(isAllowedMediaUrl("https://www.youtube.com/watch?v=x"), true);
  assert.equal(isAllowedMediaUrl("https://m.tiktok.com/@user/video/1"), true);
});

test("media URL allowlist rejects unsafe or unrelated URLs", () => {
  assert.equal(isAllowedMediaUrl("http://youtube.com/watch?v=x"), false);
  assert.equal(isAllowedMediaUrl("https://youtube.com.evil.test/watch?v=x"), false);
  assert.equal(isAllowedMediaUrl("https://user:pass@youtube.com/watch?v=x"), false);
  assert.equal(isAllowedMediaUrl("javascript:alert(1)"), false);
});

test("configured media hosts replace the default allowlist", () => {
  assert.equal(isAllowedMediaUrl("https://media.example.com/video", "media.example.com"), true);
  assert.equal(isAllowedMediaUrl("https://youtube.com/watch?v=x", "media.example.com"), false);
});

test("parseJsonObject only accepts bounded JSON objects", () => {
  assert.deepEqual(parseJsonObject('{"theme":"dark"}'), { theme: "dark" });
  assert.throws(() => parseJsonObject("[]"));
  assert.throws(() => parseJsonObject("not-json"));
  assert.throws(() => parseJsonObject('{"long":"payload"}', 3));
});

test("webhook URL defaults to the current Worker hostname", () => {
  assert.deepEqual(
    resolveTelegramWebhookUrl("https://worker.example.workers.dev"),
    { url: "https://worker.example.workers.dev/webhook", source: "worker_hostname" }
  );
});

test("TELEGRAM_WEBHOOK_URL explicitly overrides the Worker hostname", () => {
  assert.deepEqual(
    resolveTelegramWebhookUrl("https://worker.example.workers.dev", "https://bot.example.com"),
    { url: "https://bot.example.com/webhook", source: "TELEGRAM_WEBHOOK_URL" }
  );
  assert.deepEqual(
    resolveTelegramWebhookUrl("https://worker.example.workers.dev", "https://bot.example.com/webhook/"),
    { url: "https://bot.example.com/webhook", source: "TELEGRAM_WEBHOOK_URL" }
  );
});

test("webhook URL override rejects unsafe or unexpected URLs", () => {
  assert.throws(() => resolveTelegramWebhookUrl("http://worker.example.workers.dev"));
  assert.throws(() => resolveTelegramWebhookUrl("https://worker.example.workers.dev", "http://bot.example.com/webhook"));
  assert.throws(() => resolveTelegramWebhookUrl("https://worker.example.workers.dev", "https://user:pass@bot.example.com/webhook"));
  assert.throws(() => resolveTelegramWebhookUrl("https://worker.example.workers.dev", "https://bot.example.com/webhook?token=x"));
  assert.throws(() => resolveTelegramWebhookUrl("https://worker.example.workers.dev", "https://bot.example.com/another-path"));
});
