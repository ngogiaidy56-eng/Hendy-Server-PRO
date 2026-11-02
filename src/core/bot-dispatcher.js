/**
 * Automated Telegram Bot Dispatcher & Feature Registry
 * Automatically maps commands, interactive sessions, and callback queries
 * to modular handlers with automated permission guards and self-documenting help.
 */

export class BotDispatcher {
  constructor() {
    this.commands = new Map();
    this.callbackPatterns = [];
    this.sessionHandlers = new Map();
    this.defaultHandler = null;
  }

  /**
   * Registers a bot command (e.g. "start", "help", "balance")
   */
  command(cmdName, handler, options = {}) {
    const normalized = cmdName.replace(/^\//, "").toLowerCase();
    this.commands.set(normalized, {
      name: normalized,
      handler,
      description: options.description || "",
      adminOnly: Boolean(options.adminOnly)
    });
    return this;
  }

  /**
   * Registers a callback query handler matching a prefix or regex pattern
   */
  callback(pattern, handler, options = {}) {
    let matcher;
    if (pattern instanceof RegExp) {
      matcher = (data) => pattern.test(data);
    } else if (typeof pattern === "string" && pattern.endsWith("*")) {
      const prefix = pattern.slice(0, -1);
      matcher = (data) => data.startsWith(prefix);
    } else {
      matcher = (data) => data === pattern;
    }

    this.callbackPatterns.push({
      pattern,
      matcher,
      handler,
      adminOnly: Boolean(options.adminOnly)
    });
    return this;
  }

  /**
   * Registers a conversation state session handler (e.g. "waiting_video_link")
   */
  session(actionKey, handler) {
    this.sessionHandlers.set(actionKey, handler);
    return this;
  }

  /**
   * Sets fallback handler for unhandled messages
   */
  fallback(handler) {
    this.defaultHandler = handler;
    return this;
  }

  /**
   * Generates formatted command help based on registry
   */
  generateHelpText(isAdmin = false) {
    const userLines = ["📖 *DANH SÁCH LỆNH HỖ TRỢ:*\n"];
    const adminLines = ["\n🛠 *LỆNH DÀNH CHO QUẢN TRỊ VIÊN:*\n"];

    for (const [, item] of this.commands.entries()) {
      if (item.adminOnly) {
        if (isAdmin) {
          adminLines.push(`• /${item.name}${item.description ? ` — ${item.description}` : ""}`);
        }
      } else {
        userLines.push(`• /${item.name}${item.description ? ` — ${item.description}` : ""}`);
      }
    }

    let result = userLines.join("\n");
    if (isAdmin && adminLines.length > 1) {
      result += adminLines.join("\n");
    }
    result += "\n\n_Hệ thống hoạt động tự động 24/7 trên nền tảng Cloudflare Workers._";
    return result;
  }

  /**
   * Dispatches incoming Telegram update
   */
  async dispatch(update, env, db, helpers) {
    const {
      sendMessage,
      safeEditOrSend,
      callTelegram,
      clearSession,
      getSession,
      upsertTelegramUser,
      isAdmin,
      mainKeyboard
    } = helpers;

    // 1. Handle incoming message
    if (update?.message) {
      const message = update.message;
      if (!message.chat?.id || !message.from) return;

      const chatId = message.chat.id;
      const telegramId = await upsertTelegramUser(db, message.from);
      const text = String(message.text || "").trim();
      if (!text) return;

      const userIsAdmin = isAdmin(env, telegramId);

      try {
        // Check if message is a command
        if (text.startsWith("/")) {
          const [rawCmd, ...argParts] = text.split(/\s+/);
          const cmdName = rawCmd.slice(1).toLowerCase().split("@")[0]; // remove bot mention if any
          const args = argParts.join(" ");

          const registered = this.commands.get(cmdName);
          if (registered) {
            if (registered.adminOnly && !userIsAdmin) {
              await sendMessage(env, chatId, "⛔ Bạn không có quyền truy cập lệnh quản trị này.");
              return;
            }
            return await registered.handler({
              message,
              chatId,
              telegramId,
              args,
              text,
              env,
              db,
              userIsAdmin,
              helpers
            });
          }
        }

        // Check if user is in an active conversational session
        const session = await getSession(db, telegramId);
        if (session?.action && this.sessionHandlers.has(session.action)) {
          const handler = this.sessionHandlers.get(session.action);
          return await handler({
            message,
            chatId,
            telegramId,
            session,
            text,
            env,
            db,
            userIsAdmin,
            helpers
          });
        }

        // Fallback
        if (this.defaultHandler) {
          return await this.defaultHandler({
            message,
            chatId,
            telegramId,
            text,
            env,
            db,
            userIsAdmin,
            helpers
          });
        }
      } catch (err) {
        console.error("Message dispatch error:", err?.message || err);
        await sendMessage(env, chatId, "⚠️ Đã có lỗi xảy ra khi xử lý yêu cầu. Vui lòng thử lại sau.", await mainKeyboard(env, db, telegramId)).catch(() => {});
      }
      return;
    }

    // 2. Handle callback query (button clicks)
    if (update?.callback_query) {
      const query = update.callback_query;
      if (!query.id) return;

      // Always acknowledge the callback query immediately to stop the button loading spinner in Telegram UI
      callTelegram(env, "answerCallbackQuery", { callback_query_id: query.id }).catch(() => {});

      const message = query.message;
      const chatId = message?.chat?.id || query.from?.id;
      const messageId = message?.message_id || null;
      const telegramId = String(query.from?.id || "");
      if (!chatId || !telegramId) return;

      await upsertTelegramUser(db, query.from);
      const data = String(query.data || "");
      const userIsAdmin = isAdmin(env, telegramId);

      let matched = false;

      for (const entry of this.callbackPatterns) {
        if (entry.matcher(data)) {
          matched = true;
          console.log(`[BotDispatcher] 🎯 Callback "${data}" from user ${telegramId} matched pattern: "${entry.pattern}"`);
          try {
            if (entry.adminOnly && !userIsAdmin) {
              console.warn(`[BotDispatcher] ⛔ Callback "${data}" blocked: user ${telegramId} is not admin.`);
              await safeEditOrSend(env, chatId, messageId, "⛔ Bạn không có quyền thực hiện hành động này.", {
                inline_keyboard: [[{ text: "🔙 Menu chính", callback_data: "menu:home" }]]
              });
              return;
            }
            const startTime = Date.now();
            const res = await entry.handler({
              query,
              message,
              messageId,
              chatId,
              telegramId,
              data,
              env,
              db,
              userIsAdmin,
              helpers
            });
            console.log(`[BotDispatcher] ✅ Callback "${data}" completed in ${Date.now() - startTime}ms`);
            return res;
          } catch (err) {
            console.error(`[BotDispatcher] ❌ Callback error for pattern "${entry.pattern}":`, err?.message || err);
            await safeEditOrSend(env, chatId, messageId, `❌ Lỗi xử lý tác vụ: ${err?.message || "Không xác định"}. Vui lòng thử lại:`, await mainKeyboard(env, db, telegramId)).catch(() => {});
            return;
          }
        }
      }

      // If callback data did not match any registered pattern
      if (!matched) {
        console.warn(`[BotDispatcher] ⚠️ UNMATCHED callback query: "${data}". Registered patterns: [${this.callbackPatterns.map((p) => p.pattern).join(", ")}]`);
        await safeEditOrSend(
          env,
          chatId,
          messageId,
          "🤖 Nút bấm hoặc phiên làm việc đã cũ. Vui lòng chọn chức năng bên dưới:",
          await mainKeyboard(env, db, telegramId)
        ).catch(() => {});
      }
    }
  }
}
