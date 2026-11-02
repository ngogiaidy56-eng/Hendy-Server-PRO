import test from "node:test";
import assert from "node:assert/strict";
import {
  clearWebhookTraces,
  getRecentWebhookTraces,
  recordWebhookTrace,
  summarizeTelegramUpdate,
  webhookLogger
} from "../src/core/logger.js";

test("summarizeTelegramUpdate extracts callback_query metadata accurately", () => {
  const update = {
    update_id: 123456,
    callback_query: {
      id: "cb_id_999",
      from: { id: 8639286417, first_name: "Admin", username: "admin_user" },
      message: {
        message_id: 42,
        chat: { id: 8639286417 },
        text: "Select a payment package:"
      },
      data: "deposit:50000",
      chat_instance: "inst_123"
    }
  };

  const summary = summarizeTelegramUpdate(update);
  assert.equal(summary.type, "callback_query");
  assert.equal(summary.updateId, 123456);
  assert.equal(summary.callbackId, "cb_id_999");
  assert.equal(summary.data, "deposit:50000");
  assert.equal(summary.from.id, 8639286417);
  assert.equal(summary.chatId, 8639286417);
  assert.equal(summary.messageId, 42);
});

test("summarizeTelegramUpdate extracts message commands and text", () => {
  const update = {
    update_id: 123457,
    message: {
      message_id: 43,
      from: { id: 111222, first_name: "John" },
      chat: { id: 111222, type: "private" },
      text: "/deposit 100000"
    }
  };

  const summary = summarizeTelegramUpdate(update);
  assert.equal(summary.type, "message");
  assert.equal(summary.isCommand, true);
  assert.equal(summary.command, "deposit");
  assert.equal(summary.text, "/deposit 100000");
});

test("recordWebhookTrace and buffer maintain circular history", () => {
  clearWebhookTraces();
  assert.equal(getRecentWebhookTraces().length, 0);

  recordWebhookTrace({ event: "incoming", updateId: 101 });
  recordWebhookTrace({ event: "processed", updateId: 101, durationMs: 12 });

  const traces = getRecentWebhookTraces(10);
  assert.equal(traces.length, 2);
  // Newest first
  assert.equal(traces[0].event, "processed");
  assert.equal(traces[1].event, "incoming");
  assert.ok(traces[0].timestamp);
});

test("webhookLogger logs events and writes traces without crashing", () => {
  clearWebhookTraces();

  const summary = {
    updateId: 9991,
    type: "callback_query",
    data: "service:vietsub",
    from: { id: 123, username: "tester" }
  };

  webhookLogger.incoming(summary, { contentLength: 256 });
  webhookLogger.success(summary, 25);
  webhookLogger.rejected("unauthorized_secret_header", { expected: 32 });
  webhookLogger.error(summary, new Error("Test error"), 50);

  const traces = getRecentWebhookTraces();
  assert.equal(traces.length, 4);
});
