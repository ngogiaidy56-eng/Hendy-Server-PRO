import test from "node:test";
import assert from "node:assert/strict";
import { validateTelegramWebhookSecretMiddleware } from "../src/core/webhook-auth.js";
import { clearWebhookTraces, getRecentWebhookTraces } from "../src/core/logger.js";

const VALID_BOT_TOKEN = "123456789:ABCdefGHIjklMNOpqrSTUvwxYZ123456789";
const VALID_SECRET_TOKEN = "test_webhook_secret_token_1234567890_valid";

function createMockRequest(body, headers = {}) {
  const bodyString = typeof body === "string" ? body : JSON.stringify(body);
  const headerMap = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));

  return {
    headers: {
      get(name) {
        return headerMap.get(name.toLowerCase()) || null;
      }
    },
    async json() {
      return JSON.parse(bodyString);
    }
  };
}

test("webhook auth middleware: passes valid request and sets context", async () => {
  clearWebhookTraces();
  const updatePayload = {
    update_id: 888123,
    callback_query: {
      id: "cb_test_123",
      from: { id: 8639286417, first_name: "Admin" },
      data: "main:menu",
      chat_instance: "inst_test"
    }
  };

  const request = createMockRequest(updatePayload, {
    "x-telegram-bot-api-secret-token": VALID_SECRET_TOKEN,
    "content-length": "120"
  });

  const reqContext = {
    request,
    env: {
      BOT_TOKEN: VALID_BOT_TOKEN,
      WEBHOOK_SECRET_TOKEN: VALID_SECRET_TOKEN
    }
  };

  const result = await validateTelegramWebhookSecretMiddleware(reqContext);
  assert.equal(result, undefined, "Middleware should return undefined to continue chain");
  assert.ok(reqContext.update, "Should attach parsed update to context");
  assert.equal(reqContext.update.update_id, 888123);
  assert.equal(reqContext.summary.type, "callback_query");
  assert.equal(reqContext.summary.data, "main:menu");
  assert.ok(reqContext.startTime > 0);
});

test("webhook auth middleware: rejects when server secrets are missing", async () => {
  clearWebhookTraces();
  const request = createMockRequest({ update_id: 123 }, {
    "x-telegram-bot-api-secret-token": VALID_SECRET_TOKEN
  });

  const reqContext = {
    request,
    env: {
      BOT_TOKEN: "", // missing
      WEBHOOK_SECRET_TOKEN: VALID_SECRET_TOKEN
    }
  };

  const response = await validateTelegramWebhookSecretMiddleware(reqContext);
  assert.ok(response instanceof Response);
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.error, "webhook_not_configured");
});

test("webhook auth middleware: rejects invalid or missing secret token with 401", async () => {
  clearWebhookTraces();

  // Test missing header
  const reqNoHeader = {
    request: createMockRequest({ update_id: 123 }, {}),
    env: {
      BOT_TOKEN: VALID_BOT_TOKEN,
      WEBHOOK_SECRET_TOKEN: VALID_SECRET_TOKEN
    }
  };
  const resNoHeader = await validateTelegramWebhookSecretMiddleware(reqNoHeader);
  assert.equal(resNoHeader.status, 401);
  const bodyNoHeader = await resNoHeader.json();
  assert.equal(bodyNoHeader.error, "unauthorized");

  // Test wrong signature
  const reqWrongHeader = {
    request: createMockRequest({ update_id: 123 }, {
      "x-telegram-bot-api-secret-token": "wrong_secret_signature"
    }),
    env: {
      BOT_TOKEN: VALID_BOT_TOKEN,
      WEBHOOK_SECRET_TOKEN: VALID_SECRET_TOKEN
    }
  };
  const resWrongHeader = await validateTelegramWebhookSecretMiddleware(reqWrongHeader);
  assert.equal(resWrongHeader.status, 401);

  // Check that rejection was logged in traces
  const traces = getRecentWebhookTraces();
  assert.ok(traces.some((t) => t.event === "rejected" && t.reason === "invalid_webhook_secret_signature"));
});

test("webhook auth middleware: rejects oversized payload with 413", async () => {
  clearWebhookTraces();
  const request = createMockRequest({ update_id: 123 }, {
    "x-telegram-bot-api-secret-token": VALID_SECRET_TOKEN,
    "content-length": "2000000" // 2MB
  });

  const reqContext = {
    request,
    env: {
      BOT_TOKEN: VALID_BOT_TOKEN,
      WEBHOOK_SECRET_TOKEN: VALID_SECRET_TOKEN
    }
  };

  const response = await validateTelegramWebhookSecretMiddleware(reqContext);
  assert.equal(response.status, 413);
  const body = await response.json();
  assert.equal(body.error, "payload_too_large");
});

test("webhook auth middleware: rejects malformed JSON with 400", async () => {
  clearWebhookTraces();
  const badRequest = {
    headers: {
      get(name) {
        if (name.toLowerCase() === "x-telegram-bot-api-secret-token") return VALID_SECRET_TOKEN;
        return null;
      }
    },
    async json() {
      throw new SyntaxError("Unexpected token in JSON");
    }
  };

  const reqContext = {
    request: badRequest,
    env: {
      BOT_TOKEN: VALID_BOT_TOKEN,
      WEBHOOK_SECRET_TOKEN: VALID_SECRET_TOKEN
    }
  };

  const response = await validateTelegramWebhookSecretMiddleware(reqContext);
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error, "invalid_json");
});

test("webhook auth middleware: rejects invalid or missing update_id with 400", async () => {
  clearWebhookTraces();
  const request = createMockRequest({ message: { text: "hello" } }, {
    "x-telegram-bot-api-secret-token": VALID_SECRET_TOKEN
  });

  const reqContext = {
    request,
    env: {
      BOT_TOKEN: VALID_BOT_TOKEN,
      WEBHOOK_SECRET_TOKEN: VALID_SECRET_TOKEN
    }
  };

  const response = await validateTelegramWebhookSecretMiddleware(reqContext);
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error, "invalid_update_id");
});
