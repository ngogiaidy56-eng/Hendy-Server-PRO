import { constantTimeEqual, isValidTelegramSecret } from "../security.js";
import { summarizeTelegramUpdate, webhookLogger } from "./logger.js";

/**
 * Middleware: Validates the integrity and secret token signature
 * of incoming Telegram webhook update requests.
 */
export async function validateTelegramWebhookSecretMiddleware(reqContext) {
  const { request, env } = reqContext;

  // 1. Ensure server-side secret is configured
  if (!env.BOT_TOKEN || !isValidTelegramSecret(env.WEBHOOK_SECRET_TOKEN)) {
    webhookLogger.rejected("telegram_secrets_not_configured");
    return Response.json(
      { ok: false, error: "webhook_not_configured" },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }

  // 2. Validate X-Telegram-Bot-Api-Secret-Token signature header
  const signature = request.headers.get("x-telegram-bot-api-secret-token") || "";
  if (!signature || !constantTimeEqual(signature, env.WEBHOOK_SECRET_TOKEN)) {
    const errorMeta = {
      headerReceived: Boolean(signature),
      suppliedLength: signature.length,
      expectedLength: env.WEBHOOK_SECRET_TOKEN?.length || 0,
      ip: request.headers.get("cf-connecting-ip") || "unknown"
    };
    console.error("[Webhook Auth Middleware] ❌ Invalid Telegram webhook secret signature:", JSON.stringify(errorMeta));
    webhookLogger.rejected("invalid_webhook_secret_signature", errorMeta);

    return Response.json(
      { ok: false, error: "unauthorized", message: "Invalid Telegram secret token signature" },
      { status: 401, headers: { "cache-control": "no-store" } }
    );
  }

  // 3. Validate content size boundary
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 1024 * 1024) {
    webhookLogger.rejected("payload_too_large", { contentLength });
    return Response.json(
      { ok: false, error: "payload_too_large" },
      { status: 413, headers: { "cache-control": "no-store" } }
    );
  }

  // 4. Validate JSON payload structure and integrity
  let update;
  try {
    update = await request.json();
  } catch (err) {
    webhookLogger.rejected("invalid_json", { error: err.message });
    return Response.json(
      { ok: false, error: "invalid_json" },
      { status: 400, headers: { "cache-control": "no-store" } }
    );
  }

  if (!update || !Number.isSafeInteger(update.update_id)) {
    webhookLogger.rejected("invalid_update_id", { update });
    return Response.json(
      { ok: false, error: "invalid_update_id" },
      { status: 400, headers: { "cache-control": "no-store" } }
    );
  }

  // 5. Attach validated update and summary to request context for downstream handlers
  reqContext.update = update;
  reqContext.summary = summarizeTelegramUpdate(update);
  reqContext.startTime = Date.now();

  webhookLogger.incoming(reqContext.summary, {
    contentLength,
    ip: request.headers.get("cf-connecting-ip") || "unknown"
  });

  // Return undefined so the router advances to the next handler
  return undefined;
}
