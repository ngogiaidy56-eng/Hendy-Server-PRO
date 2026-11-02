import test from "node:test";
import assert from "node:assert/strict";
import {
  VARIABLE_REGISTRY,
  classifyVariables,
  generateInternalKeys,
  maskSecret,
  mergeDevVarsContent,
  validateAllConfiguration
} from "../scripts/env-manager-utils.mjs";

test("maskSecret masks middle characters and handles empty strings", () => {
  assert.equal(maskSecret(""), "(not set)");
  assert.equal(maskSecret("short"), "••••••••");
  assert.equal(maskSecret("1234567890abcdef"), "1234••••••••cdef");
});

test("classifyVariables separates secrets, variables, and cloudflare bindings", () => {
  const envValues = {
    BOT_TOKEN: "123456:abcdefghijklmnopqrstuvwxyz",
    WEBHOOK_SECRET_TOKEN: "secret_12345678901234567890123456789012",
    WEBHOOK_SETUP_KEY: "setup_key_12345678901234567890123456789"
  };
  const wranglerConfig = {
    vars: { APP_ENV: "production", ADMIN_IDS: "123456" },
    d1_databases: [{}],
    durable_objects: { bindings: [{}] },
    queues: { producers: [{}] },
    r2_buckets: [{}]
  };

  const classification = classifyVariables(envValues, wranglerConfig);

  // Check required secrets
  const reqSecretNames = classification.secrets.required.map((s) => s.name);
  assert.ok(reqSecretNames.includes("BOT_TOKEN"));
  assert.ok(reqSecretNames.includes("WEBHOOK_SECRET_TOKEN"));
  assert.ok(reqSecretNames.includes("WEBHOOK_SETUP_KEY"));

  // Check optional secrets
  const optSecretNames = classification.secrets.optional.map((s) => s.name);
  assert.ok(optSecretNames.includes("ADMIN_API_TOKEN"));
  assert.ok(optSecretNames.includes("SOCKET_SIGNING_SECRET"));
  assert.ok(optSecretNames.includes("INTERNAL_API_SECRET"));

  // Check bindings
  const boundNames = classification.bindings.configured.map((b) => b.name);
  assert.deepEqual(boundNames.sort(), ["ASSETS", "BOT_SOCKET", "DB", "JOBS_QUEUE"]);
});

test("generateInternalKeys generates keys without overwriting existing settings", () => {
  const initial = {
    BOT_TOKEN: "custom_external_bot_token",
    ADMIN_API_TOKEN: "pre_existing_admin_token_12345678901234"
  };

  const { values, generatedKeys } = generateInternalKeys(initial, { preserveExisting: true });

  // Existing keys must be strictly preserved
  assert.equal(values.BOT_TOKEN, "custom_external_bot_token");
  assert.equal(values.ADMIN_API_TOKEN, "pre_existing_admin_token_12345678901234");

  // Missing auto-generatable keys must be populated
  assert.ok(values.WEBHOOK_SECRET_TOKEN && values.WEBHOOK_SECRET_TOKEN.length >= 32);
  assert.ok(values.WEBHOOK_SETUP_KEY && values.WEBHOOK_SETUP_KEY.length >= 32);
  assert.ok(values.SOCKET_SIGNING_SECRET && values.SOCKET_SIGNING_SECRET.length >= 32);
  assert.ok(values.INTERNAL_API_SECRET && values.INTERNAL_API_SECRET.length >= 32);

  assert.ok(generatedKeys.includes("WEBHOOK_SECRET_TOKEN"));
  assert.ok(generatedKeys.includes("WEBHOOK_SETUP_KEY"));
  assert.ok(!generatedKeys.includes("ADMIN_API_TOKEN")); // Not regenerated
});

test("mergeDevVarsContent updates file content while preserving comments and existing values", () => {
  const initialDevVars = [
    "# External configuration",
    "BOT_TOKEN=do_not_touch_my_bot_token",
    "# Custom setup key",
    "WEBHOOK_SETUP_KEY=my_custom_setup_key_12345678901234"
  ].join("\n");

  const newValues = {
    BOT_TOKEN: "different_bot_token",
    WEBHOOK_SECRET_TOKEN: "new_generated_secret_12345678901234",
    INTERNAL_API_SECRET: "new_internal_secret_12345678901234"
  };

  const merged = mergeDevVarsContent(initialDevVars, newValues, { preserveExisting: true });

  // Must keep comments
  assert.ok(merged.includes("# External configuration"));
  // Must preserve existing values
  assert.ok(merged.includes("BOT_TOKEN=do_not_touch_my_bot_token"));
  assert.ok(merged.includes("WEBHOOK_SETUP_KEY=my_custom_setup_key_12345678901234"));
  // Must add new missing keys
  assert.ok(merged.includes("WEBHOOK_SECRET_TOKEN=new_generated_secret_12345678901234"));
  assert.ok(merged.includes("INTERNAL_API_SECRET=new_internal_secret_12345678901234"));
});

test("validateAllConfiguration catches required missing fields and secret collisions", () => {
  const invalid = {
    BOT_TOKEN: "invalid_token",
    WEBHOOK_SECRET_TOKEN: "identical_secret_value_12345678901234",
    WEBHOOK_SETUP_KEY: "identical_secret_value_12345678901234" // Reuse!
  };

  const errors = validateAllConfiguration(invalid);
  assert.ok(errors.some((e) => e.includes("BOT_TOKEN")));
  assert.ok(errors.some((e) => e.includes("Secret reuse detected")));
});

test("validateAllConfiguration passes for complete and valid config", () => {
  const valid = {
    BOT_TOKEN: "123456789:abcdefghijklmnopqrstuvwxyz_123456",
    WEBHOOK_SECRET_TOKEN: "webhook_secret_value_1234567890123456789012",
    WEBHOOK_SETUP_KEY: "setup_key_value_1234567890123456789012345678",
    ADMIN_API_TOKEN: "admin_api_token_value_12345678901234567890123",
    APP_ENV: "production",
    ADMIN_IDS: "123456789,987654321",
    MEDIA_ALLOWED_HOSTS: "youtube.com,youtu.be"
  };

  const errors = validateAllConfiguration(valid);
  assert.deepEqual(errors, []);
});
