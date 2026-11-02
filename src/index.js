import { handleTelegramUpdate } from "./bot.js";
import {
  claimWebhookUpdate,
  finishWebhookUpdate,
  getSetting,
  getVideoJob,
  requireDatabase,
  setSetting,
  updateVideoJob
} from "./db.js";
import { BotSocket } from "./durable-objects/BotSocket.js";
import { constantTimeEqual, createSocketTicket, isBearerAuthorized, isValidTelegramSecret } from "./security.js";
import { callTelegram } from "./telegram.js";
import { parseJsonObject } from "./validation.js";

const json = (data, status = 200, headers = {}) => Response.json(data, {
  status,
  headers: { "cache-control": "no-store", ...headers }
});

function adminAuthorized(request, env) {
  return isBearerAuthorized(request, env.ADMIN_API_TOKEN);
}

async function publishEvent(env, event) {
  if (!env.BOT_SOCKET || !env.INTERNAL_API_SECRET) return;
  try {
    const id = env.BOT_SOCKET.idFromName("global");
    const stub = env.BOT_SOCKET.get(id);
    await stub.fetch("https://bot-socket.internal/publish", {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-secret": env.INTERNAL_API_SECRET },
      body: JSON.stringify(event)
    });
  } catch (error) {
    console.error("WebSocket publish failed:", error?.message || "unknown error");
  }
}

async function activateWebhook(request, env, url) {
  if (!isBearerAuthorized(request, env.WEBHOOK_SETUP_KEY)) return json({ ok: false, error: "unauthorized" }, 401);
  if (!env.BOT_TOKEN || !isValidTelegramSecret(env.WEBHOOK_SECRET_TOKEN)) {
    return json({ ok: false, error: "telegram_secrets_not_configured" }, 503);
  }
  const webhookUrl = env.TELEGRAM_WEBHOOK_URL || `${url.origin}/webhook`;
  try {
    const result = await callTelegram(env, "setWebhook", {
      url: webhookUrl,
      secret_token: env.WEBHOOK_SECRET_TOKEN,
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: false
    });
    return json({ ok: true, webhookUrl, telegram: { ok: result.ok, description: result.description || "Webhook configured" } });
  } catch (error) {
    return json({ ok: false, error: "telegram_webhook_setup_failed", message: error.message }, 502);
  }
}

async function webhookInfo(request, env) {
  if (!isBearerAuthorized(request, env.WEBHOOK_SETUP_KEY)) return json({ ok: false, error: "unauthorized" }, 401);
  try {
    const result = await callTelegram(env, "getWebhookInfo");
    const safe = result.result || {};
    return json({
      ok: true,
      webhook: {
        url: safe.url || "",
        has_custom_certificate: Boolean(safe.has_custom_certificate),
        pending_update_count: Number(safe.pending_update_count || 0),
        last_error_date: safe.last_error_date || null,
        last_error_message: safe.last_error_message || null,
        max_connections: safe.max_connections || null,
        allowed_updates: safe.allowed_updates || []
      }
    });
  } catch (error) {
    return json({ ok: false, error: "telegram_webhook_info_failed", message: error.message }, 502);
  }
}

async function receiveWebhook(request, env) {
  if (!env.BOT_TOKEN || !isValidTelegramSecret(env.WEBHOOK_SECRET_TOKEN)) {
    return json({ ok: false, error: "webhook_not_configured" }, 503);
  }
  const suppliedSecret = request.headers.get("x-telegram-bot-api-secret-token") || "";
  if (!suppliedSecret || !constantTimeEqual(suppliedSecret, env.WEBHOOK_SECRET_TOKEN)) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 1024 * 1024) return json({ ok: false, error: "payload_too_large" }, 413);

  let update;
  try { update = await request.json(); } catch { return json({ ok: false, error: "invalid_json" }, 400); }
  if (!Number.isSafeInteger(update?.update_id)) return json({ ok: false, error: "invalid_update_id" }, 400);

  let db;
  try { db = requireDatabase(env); } catch { return json({ ok: false, error: "database_not_configured" }, 503); }

  const claimed = await claimWebhookUpdate(db, update.update_id);
  if (!claimed) return json({ ok: true, duplicate: true });

  try {
    await handleTelegramUpdate(update, env, db);
    await finishWebhookUpdate(db, update.update_id);
    return json({ ok: true });
  } catch (error) {
    await finishWebhookUpdate(db, update.update_id, error?.message || "update_failed");
    console.error("Telegram update failed:", error?.message || "unknown error");
    return json({ ok: false, error: "update_processing_failed" }, 500);
  }
}

async function adminSettings(request, env) {
  if (!adminAuthorized(request, env)) return json({ ok: false, error: "unauthorized" }, 401);
  const db = requireDatabase(env);
  if (request.method === "GET") {
    const [menuConfig, uiTheme] = await Promise.all([
      getSetting(db, "menu_config"),
      getSetting(db, "ui_theme")
    ]);
    return json({ ok: true, settings: { menu_config: menuConfig, ui_theme: uiTheme } });
  }
  if (request.method !== "PATCH") return json({ ok: false, error: "method_not_allowed" }, 405);
  const raw = await request.text();
  let body;
  try { body = parseJsonObject(raw, 8192); } catch { return json({ ok: false, error: "invalid_payload" }, 400); }
  const allowedKeys = ["menu_config", "ui_theme"];
  const entries = Object.entries(body);
  if (!entries.length || entries.some(([key]) => !allowedKeys.includes(key))) {
    return json({ ok: false, error: "unsupported_setting" }, 400);
  }
  for (const [key, value] of entries) {
    if (key === "menu_config" && (!value || typeof value !== "object" || Array.isArray(value))) {
      return json({ ok: false, error: "invalid_menu_config" }, 400);
    }
    if (key === "ui_theme" && (!value || typeof value !== "object" || Array.isArray(value))) {
      return json({ ok: false, error: "invalid_ui_theme" }, 400);
    }
    await setSetting(db, key, value, "api-admin");
  }
  await publishEvent(env, { type: "settings.updated", keys: entries.map(([key]) => key) });
  return json({ ok: true, updated: entries.map(([key]) => key) });
}

async function vietsubCallback(request, env) {
  if (!isBearerAuthorized(request, env.CORE_BACKEND_TOKEN)) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }
  const db = requireDatabase(env);
  let body;
  try { body = parseJsonObject(await request.text(), 8192); }
  catch { return json({ ok: false, error: "invalid_payload" }, 400); }

  const jobId = typeof body.jobId === "string" ? body.jobId : "";
  const allowedStatuses = ["processing", "completed", "failed"];
  if (!jobId || !allowedStatuses.includes(body.status)) {
    return json({ ok: false, error: "invalid_job_update" }, 400);
  }
  const job = await getVideoJob(db, jobId);
  if (!job) return json({ ok: false, error: "job_not_found" }, 404);

  const progress = Number.isInteger(body.progress)
    ? Math.max(0, Math.min(100, body.progress))
    : (body.status === "completed" ? 100 : Number(job.progress || 0));
  const outputUrl = typeof body.outputUrl === "string" ? body.outputUrl : "";
  if (outputUrl) {
    try {
      const parsed = new URL(outputUrl);
      if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
        return json({ ok: false, error: "invalid_output_url" }, 400);
      }
    } catch {
      return json({ ok: false, error: "invalid_output_url" }, 400);
    }
  }

  await updateVideoJob(db, jobId, {
    status: body.status,
    externalJobId: typeof body.externalJobId === "string" ? body.externalJobId : null,
    progress,
    errorCode: body.status === "failed" ? String(body.errorCode || "VIETSUB_FAILED").slice(0, 100) : null
  });
  await publishEvent(env, {
    type: "vietsub.updated",
    jobId,
    status: body.status,
    progress,
    outputUrl: outputUrl || undefined
  });

  if (body.status === "completed" || body.status === "failed") {
    const notification = body.status === "completed"
      ? `✅ Vietsub đã hoàn tất. Mã công việc: ${jobId}${outputUrl ? "\\nKết quả: " + outputUrl : ""}`
      : `❌ Vietsub thất bại. Mã công việc: ${jobId}. Mã lỗi: ${String(body.errorCode || "VIETSUB_FAILED").slice(0, 80)}`;
    try {
      await callTelegram(env, "sendMessage", { chat_id: job.telegram_id, text: notification, disable_web_page_preview: true });
    } catch (error) {
      console.error("Vietsub notification failed:", error?.message || "unknown error");
    }
  }
  return json({ ok: true, jobId, status: body.status, progress });
}

async function socketTicket(request, env) {
  if (!adminAuthorized(request, env)) return json({ ok: false, error: "unauthorized" }, 401);
  if (!env.SOCKET_SIGNING_SECRET) return json({ ok: false, error: "socket_signing_secret_not_configured" }, 503);
  const result = await createSocketTicket(env.SOCKET_SIGNING_SECRET);
  return json({ ok: true, ...result });
}

async function handleQueue(batch, env) {
  for (const message of batch.messages) {
    const body = message.body || {};
    if (body.type !== "vietsub" || !body.jobId) {
      message.ack();
      continue;
    }
    if (!env.DB) {
      message.retry();
      continue;
    }
    if (!env.CORE_BACKEND_URL || !env.CORE_BACKEND_TOKEN) {
      await updateVideoJob(env.DB, body.jobId, {
        status: "failed", errorCode: "CORE_BACKEND_NOT_CONFIGURED"
      });
      await publishEvent(env, { type: "vietsub.failed", jobId: body.jobId, reason: "backend_not_configured" });
      message.ack();
      continue;
    }
    try {
      const base = env.CORE_BACKEND_URL.replace(/\/+$/, "");
      const response = await fetch(`${base}/api/v1/vietsub/jobs`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${env.CORE_BACKEND_TOKEN}`
        },
        body: JSON.stringify({ jobId: body.jobId, telegramId: body.telegramId, sourceUrl: body.sourceUrl })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) {
        throw new Error(`CORE_BACKEND_HTTP_${response.status}`);
      }
      await updateVideoJob(env.DB, body.jobId, {
        status: "processing",
        externalJobId: data.jobId || data.id || null,
        progress: Number(data.progress || 0)
      });
      await publishEvent(env, { type: "vietsub.processing", jobId: body.jobId });
      message.ack();
    } catch (error) {
      console.error("Vietsub queue delivery failed:", error?.message || "unknown error");
      message.retry();
    }
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/" && request.method === "GET") {
        return new Response("Hendy Server PRO V2", { headers: { "content-type": "text/plain; charset=utf-8" } });
      }
      if (url.pathname === "/health" && request.method === "GET") {
        return json({ ok: true, service: "hendy-server-pro", version: "2.0.0", timestamp: new Date().toISOString() });
      }
      if (url.pathname === "/ready" && request.method === "GET") {
        const missing = [
          ...(!env.DB ? ["DB"] : []),
          ...(!env.BOT_TOKEN ? ["BOT_TOKEN"] : []),
          ...(!env.WEBHOOK_SECRET_TOKEN ? ["WEBHOOK_SECRET_TOKEN"] : []),
          ...(!env.WEBHOOK_SETUP_KEY ? ["WEBHOOK_SETUP_KEY"] : [])
        ];
        if (missing.length) {
          return json({ ok: false, ready: false, missing }, 503);
        }
        try {
          const result = await env.DB.prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('users', 'wallets', 'wallet_transactions', 'webhook_updates', 'user_sessions', 'video_jobs', 'payment_requests', 'system_settings', 'audit_logs')"
          ).all();
          const present = new Set((result.results || []).map((row) => row.name));
          const requiredTables = [
            "users", "wallets", "wallet_transactions", "webhook_updates",
            "user_sessions", "video_jobs", "payment_requests", "system_settings", "audit_logs"
          ];
          const missingTables = requiredTables.filter((table) => !present.has(table));
          if (missingTables.length) {
            return json({
              ok: false,
              ready: false,
              error: "database_migrations_pending",
              missing_tables: missingTables
            }, 503);
          }
          return json({ ok: true, ready: true, database: "connected", schema: "migrated" });
        } catch (error) {
          console.error("Readiness database check failed:", error?.message || "unknown error");
          return json({ ok: false, ready: false, error: "database_unavailable" }, 503);
        }
      }
      if (url.pathname === "/webhook" && request.method === "POST") {
        return await receiveWebhook(request, env);
      }
      if ((url.pathname === "/set-webhook" || url.pathname === "/activate") && request.method === "POST") {
        return await activateWebhook(request, env, url);
      }
      if (url.pathname === "/webhook-info" && request.method === "GET") {
        return await webhookInfo(request, env);
      }
      if (url.pathname === "/api/internal/vietsub/callback" && request.method === "POST") {
        return await vietsubCallback(request, env);
      }
      if (url.pathname === "/api/admin/settings") {
        return await adminSettings(request, env);
      }
      if (url.pathname === "/api/admin/socket-ticket" && request.method === "POST") {
        return await socketTicket(request, env);
      }
      if (url.pathname === "/ws" && request.method === "GET") {
        if (!env.BOT_SOCKET) return json({ ok: false, error: "websocket_not_configured" }, 503);
        const id = env.BOT_SOCKET.idFromName("global");
        return env.BOT_SOCKET.get(id).fetch(request);
      }
      return json({ ok: false, error: "not_found" }, 404);
    } catch (error) {
      console.error("Request failed:", error?.message || "unknown error");
      return json({ ok: false, error: "internal_error" }, 500);
    }
  },

  async queue(batch, env) {
    await handleQueue(batch, env);
  }
};

export { BotSocket };
