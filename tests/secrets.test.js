import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSecretPayload,
  getWorkerBaseUrl,
  parseDotEnv,
  validateSetupValues
} from "../scripts/secret-sync-utils.mjs";

const validValues = () => ({
  BOT_TOKEN: "123456789:abcdefghijklmnopqrstuvwxyz_123456",
  WEBHOOK_SECRET_TOKEN: "webhook_secret_value_12345678901234567890",
  WEBHOOK_SETUP_KEY: "setup_key_value_123456789012345678901234",
  ADMIN_API_TOKEN: "admin_api_secret_value_123456789012345678",
  SOCKET_SIGNING_SECRET: "",
  INTERNAL_API_SECRET: "",
  CORE_BACKEND_TOKEN: "",
  TELEGRAM_WEBHOOK_URL: "",
  WORKER_BASE_URL: ""
});

test("parseDotEnv reads comments, export, quoted values and duplicate overrides", () => {
  const values = parseDotEnv([
    "# comments ignored",
    "export BOT_TOKEN=first",
    'WEBHOOK_SECRET_TOKEN="secret with spaces"',
    "BOT_TOKEN=second # last one wins"
  ].join("\n"));
  assert.equal(values.BOT_TOKEN, "second");
  assert.equal(values.WEBHOOK_SECRET_TOKEN, "secret with spaces");
});

test("valid bot setup values pass validation", () => {
  assert.deepEqual(validateSetupValues(validValues()), []);
});

test("required credentials are enforced", () => {
  const values = validValues();
  values.BOT_TOKEN = "";
  values.WEBHOOK_SETUP_KEY = "";
  assert.ok(validateSetupValues(values).some((item) => item.includes("BOT_TOKEN")));
  assert.ok(validateSetupValues(values).some((item) => item.includes("WEBHOOK_SETUP_KEY")));
});

test("weak or reused credentials are rejected", () => {
  const values = validValues();
  values.ADMIN_API_TOKEN = "8639286417";
  values.WEBHOOK_SETUP_KEY = values.WEBHOOK_SECRET_TOKEN;
  const errors = validateSetupValues(values);
  assert.ok(errors.some((item) => item.includes("ADMIN_API_TOKEN")));
  assert.ok(errors.some((item) => item.includes("different value")));
});

test("webhook override and worker URL are validated", () => {
  const values = validValues();
  values.TELEGRAM_WEBHOOK_URL = "http://insecure.example/webhook";
  values.WORKER_BASE_URL = "https://worker.example/path";
  const errors = validateSetupValues(values);
  assert.ok(errors.some((item) => item.includes("TELEGRAM_WEBHOOK_URL")));
  assert.ok(errors.some((item) => item.includes("WORKER_BASE_URL")));
});

test("secret payload excludes empty optional keys and clears empty webhook override", () => {
  const values = validValues();
  const payload = buildSecretPayload(values);
  assert.equal(payload.BOT_TOKEN, values.BOT_TOKEN);
  assert.equal(payload.WEBHOOK_SECRET_TOKEN, values.WEBHOOK_SECRET_TOKEN);
  assert.equal(payload.WEBHOOK_SETUP_KEY, values.WEBHOOK_SETUP_KEY);
  assert.equal(payload.ADMIN_API_TOKEN, values.ADMIN_API_TOKEN);
  assert.equal(payload.TELEGRAM_WEBHOOK_URL, null);
  assert.equal(Object.hasOwn(payload, "SOCKET_SIGNING_SECRET"), false);
});

test("worker base URL defaults to the official Worker hostname", () => {
  assert.equal(
    getWorkerBaseUrl({}),
    "https://hendy-server-pro.ngogiaidy56.workers.dev"
  );
});
