/**
 * Webhook Logging & Tracing Utility
 * Safely traces and sanitizes incoming Telegram webhook update payloads
 * with an in-memory diagnostic buffer for live inspection.
 */

// Ring buffer for keeping last 100 webhook traces
const MAX_BUFFER_SIZE = 100;
const webhookTraceBuffer = [];

export function recordWebhookTrace(trace) {
  const entry = {
    timestamp: new Date().toISOString(),
    ...trace
  };
  webhookTraceBuffer.unshift(entry);
  if (webhookTraceBuffer.length > MAX_BUFFER_SIZE) {
    webhookTraceBuffer.length = MAX_BUFFER_SIZE;
  }
  return entry;
}

export function getRecentWebhookTraces(limit = 50) {
  return webhookTraceBuffer.slice(0, Math.min(limit, MAX_BUFFER_SIZE));
}

export function clearWebhookTraces() {
  webhookTraceBuffer.length = 0;
}

/**
 * Extracts and sanitizes metadata from any Telegram Update payload
 */
export function summarizeTelegramUpdate(update) {
  if (!update || typeof update !== "object") {
    return { type: "invalid_payload", details: String(update) };
  }

  const updateId = update.update_id;

  if (update.callback_query) {
    const q = update.callback_query;
    return {
      type: "callback_query",
      updateId,
      callbackId: q.id,
      from: {
        id: q.from?.id,
        username: q.from?.username || null,
        name: [q.from?.first_name, q.from?.last_name].filter(Boolean).join(" ") || "Unknown"
      },
      chatId: q.message?.chat?.id || q.from?.id,
      messageId: q.message?.message_id || null,
      messageText: q.message?.text ? (q.message.text.slice(0, 50) + (q.message.text.length > 50 ? "..." : "")) : null,
      data: q.data || "(empty data)",
      chatInstance: q.chat_instance || null
    };
  }

  if (update.message) {
    const m = update.message;
    const text = String(m.text || "");
    const isCommand = text.startsWith("/");
    const command = isCommand ? text.split(/\s+/)[0].slice(1).split("@")[0].toLowerCase() : null;

    return {
      type: "message",
      updateId,
      messageId: m.message_id,
      from: {
        id: m.from?.id,
        username: m.from?.username || null,
        name: [m.from?.first_name, m.from?.last_name].filter(Boolean).join(" ") || "Unknown"
      },
      chatId: m.chat?.id,
      chatType: m.chat?.type || "unknown",
      text: text ? (text.slice(0, 100) + (text.length > 100 ? "..." : "")) : null,
      isCommand,
      command,
      hasMedia: Boolean(m.photo || m.video || m.audio || m.document || m.voice)
    };
  }

  if (update.edited_message) {
    return {
      type: "edited_message",
      updateId,
      messageId: update.edited_message.message_id,
      chatId: update.edited_message.chat?.id
    };
  }

  return {
    type: "other",
    updateId,
    keys: Object.keys(update)
  };
}

/**
 * Standard structured webhook logger
 */
export const webhookLogger = {
  incoming(summary, meta = {}) {
    console.log(
      `[Webhook Ingest] 📥 Update #${summary.updateId} [${summary.type}]` +
      (summary.type === "callback_query" ? ` | Button Data: "${summary.data}" | From: ${summary.from?.id} (${summary.from?.username || summary.from?.name})` : "") +
      (summary.type === "message" ? ` | Text: "${summary.text}" | From: ${summary.from?.id}` : "")
    );
    recordWebhookTrace({
      event: "incoming",
      summary,
      meta
    });
  },

  success(summary, durationMs, details = {}) {
    console.log(`[Webhook Ingest] ✅ Update #${summary.updateId} processed successfully in ${durationMs}ms`);
    recordWebhookTrace({
      event: "processed",
      updateId: summary.updateId,
      durationMs,
      details
    });
  },

  rejected(reason, meta = {}) {
    console.warn(`[Webhook Ingest] ⛔ Rejected webhook request: ${reason}`, JSON.stringify(meta));
    recordWebhookTrace({
      event: "rejected",
      reason,
      meta
    });
  },

  error(summary, error, durationMs) {
    console.error(
      `[Webhook Ingest] ❌ Update #${summary?.updateId || "unknown"} failed after ${durationMs}ms:`,
      error?.message || error
    );
    recordWebhookTrace({
      event: "error",
      updateId: summary?.updateId,
      error: error?.message || String(error),
      durationMs
    });
  }
};
