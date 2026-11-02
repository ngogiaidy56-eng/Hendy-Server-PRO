import { handleTelegramUpdate } from "./bot.js";
import {
  approvePayment,
  claimWebhookUpdate,
  finishWebhookUpdate,
  getAdminStats,
  getPaymentRequest,
  getSetting,
  getVideoJob,
  listPendingPayments,
  listRecentAuditLogs,
  listRecentVideoJobs,
  rejectPayment,
  requireDatabase,
  setSetting,
  updateVideoJob
} from "./db.js";
import { BotSocket } from "./durable-objects/BotSocket.js";
import { constantTimeEqual, createSocketTicket, isBearerAuthorized, isValidTelegramSecret } from "./security.js";
import { callTelegram } from "./telegram.js";
import { parseJsonObject, resolveTelegramWebhookUrl } from "./validation.js";
import { Router } from "./core/router.js";
import { getRecentWebhookTraces, summarizeTelegramUpdate, webhookLogger } from "./core/logger.js";
import { validateTelegramWebhookSecretMiddleware } from "./core/webhook-auth.js";
import { renderDashboardHtml } from "./core/admin-dashboard.js";

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

// Instantiate automated HTTP Router
export const router = new Router();

// --- 1. CORE & HEALTH ENDPOINTS ---

router.get("/", () => {
  return new Response("Hendy Server PRO V2", { headers: { "content-type": "text/plain; charset=utf-8" } });
});

router.get("/health", () => {
  return json({
    ok: true,
    service: "hendy-server-pro",
    version: "2.0.0",
    routes: router.getRegisteredRoutes().length,
    timestamp: new Date().toISOString()
  });
});

router.get("/ready", async ({ env }) => {
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
});

// --- 2. TELEGRAM WEBHOOK INGESTION & SETUP ---

router.post("/webhook", validateTelegramWebhookSecretMiddleware, async ({ env, update, summary, startTime }) => {
  let db;
  try {
    db = requireDatabase(env);
  } catch (err) {
    webhookLogger.error(summary, err, Date.now() - startTime);
    return json({ ok: false, error: "database_not_configured" }, 503);
  }

  const claimed = await claimWebhookUpdate(db, update.update_id);
  if (!claimed) {
    webhookLogger.rejected("duplicate_update_ignored", { updateId: update.update_id });
    return json({ ok: true, duplicate: true });
  }

  try {
    await handleTelegramUpdate(update, env, db);
    await finishWebhookUpdate(db, update.update_id);
    const duration = Date.now() - startTime;
    webhookLogger.success(summary, duration);
    return json({ ok: true });
  } catch (error) {
    const duration = Date.now() - startTime;
    await finishWebhookUpdate(db, update.update_id, error?.message || "update_failed");
    webhookLogger.error(summary, error, duration);
    return json({ ok: false, error: "update_processing_failed" }, 500);
  }
});

const handleActivateWebhook = async ({ request, env, url }) => {
  if (!isBearerAuthorized(request, env.WEBHOOK_SETUP_KEY)) {
    return json({ ok: false, error: "unauthorized", hint: "Check WEBHOOK_SETUP_KEY and send Authorization: Bearer <key>." }, 401);
  }
  if (!env.BOT_TOKEN || !isValidTelegramSecret(env.WEBHOOK_SECRET_TOKEN)) {
    return json({ ok: false, error: "telegram_secrets_not_configured" }, 503);
  }

  let target;
  try {
    target = resolveTelegramWebhookUrl(url.origin, env.TELEGRAM_WEBHOOK_URL);
  } catch (error) {
    return json({
      ok: false,
      error: "invalid_telegram_webhook_url",
      message: error.message
    }, 400);
  }

  try {
    const bot = await callTelegram(env, "getMe");
    const botIdentity = {
      id: bot.result?.id || null,
      username: bot.result?.username || null,
      first_name: bot.result?.first_name || null
    };

    const setResult = await callTelegram(env, "setWebhook", {
      url: target.url,
      secret_token: env.WEBHOOK_SECRET_TOKEN,
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: false
    });

    const infoResult = await callTelegram(env, "getWebhookInfo");
    const actualUrl = String(infoResult.result?.url || "");
    const verified = actualUrl.replace(/\/+$/, "") === target.url.replace(/\/+$/, "");

    return json({
      ok: Boolean(setResult.ok && verified),
      bot: botIdentity,
      webhook: {
        url: target.url,
        source: target.source,
        configured: Boolean(setResult.ok),
        verified,
        pending_update_count: Number(infoResult.result?.pending_update_count || 0),
        last_error_date: infoResult.result?.last_error_date || null,
        last_error_message: infoResult.result?.last_error_message || null
      },
      telegram: {
        ok: Boolean(setResult.ok),
        description: setResult.description || "Webhook configured"
      },
      ...(!verified ? { error: "webhook_verification_mismatch", actualWebhookUrl: actualUrl || null } : {})
    }, verified ? 200 : 502);
  } catch (error) {
    console.error("Telegram webhook activation failed:", error?.message || "unknown error");
    return json({
      ok: false,
      error: "telegram_webhook_setup_failed",
      message: error.message
    }, 502);
  }
};

router.post("/set-webhook", handleActivateWebhook);
router.post("/activate", handleActivateWebhook);

router.get("/webhook-info", async ({ request, env }) => {
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
});

// --- 3. INTERNAL SERVICES & QUEUE CALLBACKS ---

router.post("/api/internal/vietsub/callback", async ({ request, env }) => {
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
      ? `✅ Vietsub đã hoàn tất. Mã công việc: ${jobId}${outputUrl ? "\nKết quả: " + outputUrl : ""}`
      : `❌ Vietsub thất bại. Mã công việc: ${jobId}. Mã lỗi: ${String(body.errorCode || "VIETSUB_FAILED").slice(0, 80)}`;
    try {
      await callTelegram(env, "sendMessage", { chat_id: job.telegram_id, text: notification, disable_web_page_preview: true });
    } catch (error) {
      console.error("Vietsub notification failed:", error?.message || "unknown error");
    }
  }
  return json({ ok: true, jobId, status: body.status, progress });
});

// --- 4. ADMIN & MANAGEMENT REST API ---

router.get("/api/admin/settings", async ({ request, env }) => {
  if (!adminAuthorized(request, env)) return json({ ok: false, error: "unauthorized" }, 401);
  const db = requireDatabase(env);
  const [menuConfig, uiTheme] = await Promise.all([
    getSetting(db, "menu_config"),
    getSetting(db, "ui_theme")
  ]);
  return json({ ok: true, settings: { menu_config: menuConfig, ui_theme: uiTheme } });
});

router.patch("/api/admin/settings", async ({ request, env }) => {
  if (!adminAuthorized(request, env)) return json({ ok: false, error: "unauthorized" }, 401);
  const db = requireDatabase(env);
  const raw = await request.text();
  let body;
  try { body = parseJsonObject(raw, 8192); } catch { return json({ ok: false, error: "invalid_payload" }, 400); }
  const allowedKeys = ["menu_config", "ui_theme", "deposit_config"];
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
});

router.get("/api/admin/env-status", async ({ request, env }) => {
  if (!adminAuthorized(request, env)) return json({ ok: false, error: "unauthorized" }, 401);
  const mask = (v) => v ? (String(v).length > 8 ? String(v).slice(0, 4) + "••••••••" + String(v).slice(-4) : "••••••••") : null;
  return json({
    ok: true,
    service: "hendy-server-pro",
    routes: router.getRegisteredRoutes(),
    classification: {
      secrets: {
        BOT_TOKEN: { set: Boolean(env.BOT_TOKEN), masked: mask(env.BOT_TOKEN), required: true },
        WEBHOOK_SECRET_TOKEN: { set: Boolean(env.WEBHOOK_SECRET_TOKEN), masked: mask(env.WEBHOOK_SECRET_TOKEN), required: true },
        WEBHOOK_SETUP_KEY: { set: Boolean(env.WEBHOOK_SETUP_KEY), masked: mask(env.WEBHOOK_SETUP_KEY), required: true },
        ADMIN_API_TOKEN: { set: Boolean(env.ADMIN_API_TOKEN), masked: mask(env.ADMIN_API_TOKEN), required: false },
        SOCKET_SIGNING_SECRET: { set: Boolean(env.SOCKET_SIGNING_SECRET), masked: mask(env.SOCKET_SIGNING_SECRET), required: false },
        INTERNAL_API_SECRET: { set: Boolean(env.INTERNAL_API_SECRET), masked: mask(env.INTERNAL_API_SECRET), required: false },
        CORE_BACKEND_TOKEN: { set: Boolean(env.CORE_BACKEND_TOKEN), masked: mask(env.CORE_BACKEND_TOKEN), required: false }
      },
      variables: {
        APP_ENV: env.APP_ENV || "production",
        ADMIN_IDS: env.ADMIN_IDS || "",
        MEDIA_ALLOWED_HOSTS: env.MEDIA_ALLOWED_HOSTS || "youtube.com,youtu.be,tiktok.com,facebook.com,fb.watch",
        CORE_BACKEND_URL: env.CORE_BACKEND_URL || null,
        TELEGRAM_WEBHOOK_URL: env.TELEGRAM_WEBHOOK_URL || null
      },
      bindings: {
        DB: Boolean(env.DB),
        BOT_SOCKET: Boolean(env.BOT_SOCKET),
        JOBS_QUEUE: Boolean(env.JOBS_QUEUE),
        ASSETS: Boolean(env.ASSETS)
      }
    }
  });
});

router.get("/api/admin/jobs", async ({ request, env }) => {
  if (!adminAuthorized(request, env)) return json({ ok: false, error: "unauthorized" }, 401);
  const db = requireDatabase(env);
  const jobs = await listRecentVideoJobs(db, 50);
  return json({ ok: true, jobs });
});

router.get("/api/admin/payments", async ({ request, env }) => {
  if (!adminAuthorized(request, env)) return json({ ok: false, error: "unauthorized" }, 401);
  const db = requireDatabase(env);
  const pending = await listPendingPayments(db, 50);
  return json({ ok: true, pending });
});

router.post("/api/admin/payments/:id/approve", async ({ request, env, params }) => {
  if (!adminAuthorized(request, env)) return json({ ok: false, error: "unauthorized" }, 401);
  const db = requireDatabase(env);
  try {
    const result = await approvePayment(db, params.id, "api-admin");
    await publishEvent(env, { type: "payment.approved", paymentId: params.id, telegramId: result.telegramId, amount: result.amountVnd });
    try {
      await callTelegram(env, "sendMessage", {
        chat_id: result.telegramId,
        text: `🎉 Nạp tiền thành công! Giao dịch ${params.id} (+${result.amountVnd.toLocaleString("vi-VN")} VNĐ) đã được phê duyệt. Số dư mới: ${result.newBalance.toLocaleString("vi-VN")} VNĐ.`
      });
    } catch {}
    return json({ ok: true, result });
  } catch (error) {
    return json({ ok: false, error: error.message }, 400);
  }
});

router.post("/api/admin/payments/:id/reject", async ({ request, env, params }) => {
  if (!adminAuthorized(request, env)) return json({ ok: false, error: "unauthorized" }, 401);
  const db = requireDatabase(env);
  try {
    const result = await rejectPayment(db, params.id, "api-admin", "Rejected via Admin API");
    await publishEvent(env, { type: "payment.rejected", paymentId: params.id });
    try {
      await callTelegram(env, "sendMessage", {
        chat_id: result.telegramId,
        text: `❌ Yêu cầu nạp tiền ${params.id} đã bị từ chối.`
      });
    } catch {}
    return json({ ok: true, result });
  } catch (error) {
    return json({ ok: false, error: error.message }, 400);
  }
});

router.get("/api/admin/audit-logs", async ({ request, env }) => {
  if (!adminAuthorized(request, env)) return json({ ok: false, error: "unauthorized" }, 401);
  const db = requireDatabase(env);
  const logs = await listRecentAuditLogs(db, 50);
  return json({ ok: true, logs });
});

router.get("/api/admin/webhook-logs", async ({ request, env, url }) => {
  if (!adminAuthorized(request, env)) return json({ ok: false, error: "unauthorized" }, 401);
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") || 50)));
  const traces = getRecentWebhookTraces(limit);
  return json({ ok: true, count: traces.length, traces });
});

const handleAdminDashboard = async ({ request, env, url }) => {
  const token = url.searchParams.get("token") || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (token && env.ADMIN_API_TOKEN && !constantTimeEqual(token, env.ADMIN_API_TOKEN)) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }
  return new Response(renderDashboardHtml(), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store"
    }
  });
};

router.get("/admin/dashboard", handleAdminDashboard);
router.get("/api/admin/dashboard", handleAdminDashboard);

router.get("/api/admin/analytics", async ({ request, env }) => {
  if (!adminAuthorized(request, env)) return json({ ok: false, error: "unauthorized" }, 401);
  const traces = getRecentWebhookTraces(100);

  const stats = {
    totalUpdates: traces.length,
    callbacks: 0,
    successes: 0,
    failures: 0,
    signatureRejections: 0,
    buttonActions: {},
    failureReasons: {}
  };

  for (const t of traces) {
    if (t.summary?.type === "callback_query") {
      stats.callbacks++;
      const btn = t.summary.data || "unknown";
      stats.buttonActions[btn] = (stats.buttonActions[btn] || 0) + 1;
    }
    if (t.event === "processed") {
      stats.successes++;
    } else if (t.event === "error" || t.event === "rejected") {
      stats.failures++;
      const reason = t.reason || t.error || "unknown_failure";
      stats.failureReasons[reason] = (stats.failureReasons[reason] || 0) + 1;
      if (reason.includes("signature") || reason.includes("secret")) {
        stats.signatureRejections++;
      }
    }
  }

  return json({ ok: true, analytics: stats });
});

router.post("/api/admin/socket-ticket", async ({ request, env }) => {
  if (!adminAuthorized(request, env)) return json({ ok: false, error: "unauthorized" }, 401);
  if (!env.SOCKET_SIGNING_SECRET) return json({ ok: false, error: "socket_signing_secret_not_configured" }, 503);
  const result = await createSocketTicket(env.SOCKET_SIGNING_SECRET);
  return json({ ok: true, ...result });
});

// --- 5. WEBSOCKET REAL-TIME ENDPOINT ---

router.get("/ws", async ({ request, env }) => {
  if (!env.BOT_SOCKET) return json({ ok: false, error: "websocket_not_configured" }, 503);
  const id = env.BOT_SOCKET.idFromName("global");
  return env.BOT_SOCKET.get(id).fetch(request);
});

// --- 6. ASYNCHRONOUS QUEUE CONSUMER ---

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

// --- 7. WORKER EXPORT ---

export default {
  async fetch(request, env, ctx) {
    return router.handle(request, env, ctx);
  },

  async queue(batch, env) {
    await handleQueue(batch, env);
  }
};

export { BotSocket };
