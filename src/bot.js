import {
  clearSession,
  createVideoJob,
  getAdminStats,
  getSetting,
  getSession,
  getWalletBalance,
  setSession,
  upsertTelegramUser
} from "./db.js";
import { isAllowedMediaUrl } from "./validation.js";
import { callTelegram } from "./telegram.js";

function adminIds(env) {
  return String(env.ADMIN_IDS || "").split(",").map((id) => id.trim()).filter(Boolean);
}

async function mainKeyboard(env, db) {
  const configured = await getSetting(db, "menu_config").catch(() => null);
  if (configured && Array.isArray(configured.inline_keyboard)) {
    const rows = configured.inline_keyboard.slice(0, 10).map((row) => {
      if (!Array.isArray(row)) return [];
      return row.slice(0, 8).filter((button) => {
        if (!button || typeof button.text !== "string" || button.text.length > 64) return false;
        const hasCallback = typeof button.callback_data === "string" && button.callback_data.length > 0 && button.callback_data.length <= 64;
        const hasUrl = typeof button.url === "string" && /^https:\/\//i.test(button.url);
        const hasWebApp = button.web_app && typeof button.web_app.url === "string" && /^https:\/\//i.test(button.web_app.url);
        return hasCallback || hasUrl || hasWebApp;
      }).map((button) => {
        if (typeof button.callback_data === "string") return { text: button.text, callback_data: button.callback_data };
        if (button.web_app?.url) return { text: button.text, web_app: { url: button.web_app.url } };
        return { text: button.text, url: button.url };
      });
    }).filter((row) => row.length);
    if (rows.length) return { inline_keyboard: rows };
  }
  const support = env.SUPPORT_URL && /^https:\/\//i.test(env.SUPPORT_URL)
    ? [[{ text: "🎧 Liên hệ hỗ trợ", url: env.SUPPORT_URL }]]
    : [];
  return {
    inline_keyboard: [
      [{ text: "🎬 Dịch vụ Vietsub", callback_data: "service:vietsub" }],
      [{ text: "💳 Nạp tiền", callback_data: "service:deposit" }],
      [{ text: "💰 Số dư", callback_data: "wallet:balance" }],
      ...support
    ]
  };
}

async function sendMessage(env, chatId, text, replyMarkup) {
  return callTelegram(env, "sendMessage", {
    chat_id: chatId,
    text,
    reply_markup: replyMarkup,
    disable_web_page_preview: true
  });
}

async function sendAdminPanel(env, chatId, telegramId, db) {
  if (!adminIds(env).includes(String(telegramId))) {
    await sendMessage(env, chatId, "⛔ Bạn không có quyền truy cập khu vực quản trị.");
    return;
  }
  const stats = await getAdminStats(db);
  await sendMessage(
    env,
    chatId,
    `🛠 HENDY SERVER PRO V2\n\n👥 Người dùng: ${stats.users}\n🎬 Video đang xử lý: ${stats.activeVideoJobs}\n💳 Yêu cầu nạp chờ duyệt: ${stats.pendingPayments}\n\nAPI quản trị được bảo vệ bằng ADMIN_API_TOKEN.`,
    { inline_keyboard: [[{ text: "🔙 Menu chính", callback_data: "menu:home" }]] }
  );
}

async function handleMessage(message, env, db) {
  if (!message?.chat?.id || !message?.from) return;
  const chatId = message.chat.id;
  const telegramId = await upsertTelegramUser(db, message.from);
  const text = String(message.text || "").trim();
  if (!text) return;

  if (text === "/start" || text.startsWith("/start ")) {
    await clearSession(db, telegramId);
    await sendMessage(
      env,
      chatId,
      `🤖 HENDY SERVER PRO V2\nXin chào ${message.from.first_name || "bạn"}!\n\nChọn dịch vụ bên dưới. Số dư ban đầu: 0 VNĐ.`,
      await mainKeyboard(env, db)
    );
    return;
  }

  if (text === "/help") {
    await sendMessage(env, chatId, "Lệnh hỗ trợ:\n/start — Mở menu\n/balance — Kiểm tra số dư\n/vietsub — Gửi yêu cầu Vietsub\n/admin — Quản trị viên", await mainKeyboard(env, db));
    return;
  }

  if (text === "/balance") {
    const balance = await getWalletBalance(db, telegramId);
    await sendMessage(env, chatId, `💰 Số dư hiện tại: ${balance.toLocaleString("vi-VN")} VNĐ`);
    return;
  }

  if (text === "/admin") {
    await sendAdminPanel(env, chatId, telegramId, db);
    return;
  }

  const session = await getSession(db, telegramId);
  if (session?.action === "waiting_video_link") {
    if (!isAllowedMediaUrl(text, env.MEDIA_ALLOWED_HOSTS)) {
      await sendMessage(env, chatId, "❌ Link không hợp lệ. Chỉ chấp nhận URL HTTPS từ nền tảng video được cấu hình.");
      return;
    }
    if (!env.JOBS_QUEUE) {
      await clearSession(db, telegramId);
      await sendMessage(env, chatId, "⚠️ Hệ thống hàng đợi chưa được cấu hình. Vui lòng liên hệ quản trị viên.");
      return;
    }
    const jobId = crypto.randomUUID();
    await createVideoJob(db, telegramId, text, jobId);
    try {
      await env.JOBS_QUEUE.send({ type: "vietsub", jobId, telegramId, sourceUrl: text });
      await clearSession(db, telegramId);
      await sendMessage(env, chatId, `✅ Đã tiếp nhận yêu cầu Vietsub. Mã công việc: ${jobId}\nHệ thống sẽ thông báo khi backend cập nhật trạng thái.`);
    } catch (error) {
      await clearSession(db, telegramId);
      await sendMessage(env, chatId, "❌ Không thể đưa yêu cầu vào hàng đợi. Vui lòng thử lại sau.");
      throw error;
    }
    return;
  }

  await sendMessage(env, chatId, "Mình chưa nhận diện được lệnh. Gửi /help để xem hướng dẫn.", await mainKeyboard(env, db));
}

async function handleCallback(query, env, db) {
  if (!query?.id) return;
  await callTelegram(env, "answerCallbackQuery", { callback_query_id: query.id });
  const message = query.message;
  if (!message?.chat?.id || !query.from?.id) return;
  const chatId = message.chat.id;
  const telegramId = String(query.from.id);
  await upsertTelegramUser(db, query.from);

  switch (query.data) {
    case "menu:home":
      await clearSession(db, telegramId);
      await callTelegram(env, "editMessageText", {
        chat_id: chatId,
        message_id: message.message_id,
        text: "🤖 HENDY SERVER PRO V2\nChọn dịch vụ bên dưới.",
        reply_markup: await mainKeyboard(env, db)
      });
      return;
    case "service:vietsub":
      await setSession(db, telegramId, { action: "waiting_video_link" });
      await callTelegram(env, "editMessageText", {
        chat_id: chatId,
        message_id: message.message_id,
        text: "🎬 Gửi link video HTTPS từ YouTube, TikTok hoặc Facebook để tạo yêu cầu Vietsub.",
        reply_markup: { inline_keyboard: [[{ text: "🔙 Menu chính", callback_data: "menu:home" }]] }
      });
      return;
    case "service:deposit":
      await callTelegram(env, "editMessageText", {
        chat_id: chatId,
        message_id: message.message_id,
        text: "💳 Thanh toán tự động chưa được cấu hình. Không chuyển khoản cho đến khi quản trị viên công bố thông tin thanh toán chính thức.",
        reply_markup: { inline_keyboard: [[{ text: "🔙 Menu chính", callback_data: "menu:home" }]] }
      });
      return;
    case "wallet:balance": {
      const balance = await getWalletBalance(db, telegramId);
      await callTelegram(env, "editMessageText", {
        chat_id: chatId,
        message_id: message.message_id,
        text: `💰 Số dư: ${balance.toLocaleString("vi-VN")} VNĐ`,
        reply_markup: { inline_keyboard: [[{ text: "🔙 Menu chính", callback_data: "menu:home" }]] }
      });
      return;
    }
    default:
      if (query.data === "admin:panel" && adminIds(env).includes(telegramId)) {
        await sendAdminPanel(env, chatId, telegramId, db);
      }
  }
}

export async function handleTelegramUpdate(update, env, db) {
  if (update?.message) return handleMessage(update.message, env, db);
  if (update?.callback_query) return handleCallback(update.callback_query, env, db);
}
