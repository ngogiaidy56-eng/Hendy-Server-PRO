import {
  approvePayment,
  clearSession,
  createPaymentRequest,
  createVideoJob,
  getAdminStats,
  getPaymentRequest,
  getSession,
  getSetting,
  getUserTransactions,
  getUserVideoJobs,
  getWalletBalance,
  listPendingPayments,
  listRecentVideoJobs,
  rejectPayment,
  setSession,
  upsertTelegramUser
} from "./db.js";
import { isAllowedMediaUrl } from "./validation.js";
import { callTelegram } from "./telegram.js";
import { BotDispatcher } from "./core/bot-dispatcher.js";

export function adminIds(env) {
  return String(env?.ADMIN_IDS || "").split(",").map((id) => id.trim()).filter(Boolean);
}

export function isAdmin(env, telegramId) {
  return adminIds(env).includes(String(telegramId));
}

export async function mainKeyboard(env, db, telegramId = null) {
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

  const support = env?.SUPPORT_URL && /^https:\/\//i.test(env.SUPPORT_URL)
    ? [[{ text: "🎧 Liên hệ hỗ trợ", url: env.SUPPORT_URL }]]
    : [];

  const keyboard = [
    [
      { text: "🎬 Dịch vụ Vietsub", callback_data: "service:vietsub" },
      { text: "💳 Nạp tiền", callback_data: "service:deposit" }
    ],
    [
      { text: "💰 Số dư", callback_data: "wallet:balance" },
      { text: "📜 Lịch sử", callback_data: "user:history" }
    ],
    ...support
  ];

  if (telegramId && isAdmin(env, telegramId)) {
    keyboard.push([{ text: "🛠 Quản trị viên", callback_data: "admin:panel" }]);
  }

  return { inline_keyboard: keyboard };
}

export async function sendMessage(env, chatId, text, replyMarkup, parseMode = "Markdown") {
  const payload = {
    chat_id: chatId,
    text,
    reply_markup: replyMarkup,
    disable_web_page_preview: true
  };
  if (parseMode) payload.parse_mode = parseMode;
  return callTelegram(env, "sendMessage", payload);
}

/**
 * Safely edits the original message if possible, or gracefully falls back to sending
 * a fresh message so button clicks never fail or stay unresponsive in Telegram.
 */
export async function safeEditOrSend(env, chatId, messageId, text, replyMarkup, parseMode = "Markdown") {
  const payload = {
    chat_id: chatId,
    text,
    reply_markup: replyMarkup,
    disable_web_page_preview: true
  };
  if (parseMode) payload.parse_mode = parseMode;

  if (messageId) {
    try {
      return await callTelegram(env, "editMessageText", {
        ...payload,
        message_id: messageId
      });
    } catch (err) {
      console.warn("safeEditOrSend: editMessageText failed, falling back to sendMessage:", err.message);
    }
  }

  return await callTelegram(env, "sendMessage", payload);
}

async function showUserHistory(env, db, chatId, messageId, telegramId) {
  const [jobs, transactions] = await Promise.all([
    getUserVideoJobs(db, telegramId, 5),
    getUserTransactions(db, telegramId, 5)
  ]);

  let text = `📜 *LỊCH SỬ HOẠT ĐỘNG*\n\n`;

  text += `🎬 *Video Jobs gần đây:*\n`;
  if (!jobs.length) {
    text += `  _(Chưa có yêu cầu vietsub nào)_\n`;
  } else {
    for (const j of jobs) {
      const statusIcon = j.status === "completed" ? "🟢" : j.status === "failed" ? "🔴" : "🟡";
      text += `  • ${statusIcon} [${j.id.slice(0, 8)}] ${j.status.toUpperCase()} (${j.progress}%)\n`;
    }
  }

  text += `\n💰 *Giao dịch ví gần đây:*\n`;
  if (!transactions.length) {
    text += `  _(Chưa có biến động số dư)_\n`;
  } else {
    for (const t of transactions) {
      const sign = t.amount_vnd >= 0 ? "+" : "";
      text += `  • ${sign}${t.amount_vnd.toLocaleString("vi-VN")} đ (${t.transaction_type}) | Số dư: ${t.balance_after_vnd.toLocaleString("vi-VN")} đ\n`;
    }
  }

  await safeEditOrSend(env, chatId, messageId, text, {
    inline_keyboard: [[{ text: "🔙 Menu chính", callback_data: "menu:home" }]]
  });
}

async function handleDepositRequest(env, db, chatId, messageId, telegramId, amountVnd) {
  const amount = Number(amountVnd);
  if (!Number.isSafeInteger(amount) || amount < 5000 || amount > 50_000_000) {
    await safeEditOrSend(env, chatId, messageId, "❌ Số tiền nạp không hợp lệ (tối thiểu 5.000 VNĐ, tối đa 50.000.000 VNĐ).", {
      inline_keyboard: [[{ text: "🔙 Menu chính", callback_data: "menu:home" }]]
    });
    return;
  }

  const paymentId = "HD" + Math.floor(100_000 + Math.random() * 900_000);
  await createPaymentRequest(db, paymentId, telegramId, amount, "bank_transfer", paymentId);

  const depositConfig = await getSetting(db, "deposit_config").catch(() => null);
  const bankName = depositConfig?.bank_name || "Ngân hàng TMCP Quân Đội (MB Bank)";
  const accountNumber = depositConfig?.account_number || "999988889999";
  const accountHolder = depositConfig?.account_holder || "HENDY SERVER PRO";

  const messageText =
    `💳 *YÊU CẦU NẠP TIỀN ĐÃ TẠO*\n\n` +
    `• Mã giao dịch: \`${paymentId}\`\n` +
    `• Số tiền: *${amount.toLocaleString("vi-VN")} VNĐ*\n` +
    `• Trạng thái: ⏳ *Chờ thanh toán*\n\n` +
    `📌 *Thông tin chuyển khoản:*\n` +
    `• Ngân hàng: *${bankName}*\n` +
    `• Số tài khoản: \`${accountNumber}\`\n` +
    `• Chủ tài khoản: *${accountHolder}*\n` +
    `• Nội dung CK: \`${paymentId}\`\n\n` +
    `⚠️ *Lưu ý:* Vui lòng ghi chính xác nội dung chuyển khoản để hệ thống đối soát và cộng tiền nhanh nhất.`;

  await safeEditOrSend(env, chatId, messageId, messageText, {
    inline_keyboard: [
      [{ text: "📜 Xem lịch sử", callback_data: "user:history" }],
      [{ text: "🔙 Menu chính", callback_data: "menu:home" }]
    ]
  });

  // Notify admins of new pending payment
  for (const adminId of adminIds(env)) {
    if (adminId !== String(telegramId)) {
      sendMessage(
        env,
        adminId,
        `🔔 *Yêu cầu nạp mới!*\\nMã: \`${paymentId}\` | Số tiền: *${amount.toLocaleString("vi-VN")} VNĐ* | Người dùng: \`${telegramId}\``,
        {
          inline_keyboard: [
            [
              { text: "✅ Duyệt", callback_data: `pay:app:${paymentId}` },
              { text: "❌ Từ chối", callback_data: `pay:rej:${paymentId}` }
            ]
          ]
        }
      ).catch(() => {});
    }
  }
}

async function sendAdminPanel(env, chatId, messageId, telegramId, db) {
  if (!isAdmin(env, telegramId)) {
    await safeEditOrSend(env, chatId, messageId, "⛔ Bạn không có quyền truy cập khu vực quản trị.", {
      inline_keyboard: [[{ text: "🔙 Menu chính", callback_data: "menu:home" }]]
    });
    return;
  }
  const stats = await getAdminStats(db);
  await safeEditOrSend(
    env,
    chatId,
    messageId,
    `🛠 *HENDY SERVER PRO V2 — QUẢN TRỊ*\n\n` +
    `👥 Người dùng: *${stats.users}*\n` +
    `🎬 Video đang xử lý: *${stats.activeVideoJobs}*\n` +
    `💳 Yêu cầu nạp chờ duyệt: *${stats.pendingPayments}*\n\n` +
    `Chọn tác vụ quản lý bên dưới:`,
    {
      inline_keyboard: [
        [{ text: `💳 Duyệt nạp tiền (${stats.pendingPayments})`, callback_data: "admin:pending_payments" }],
        [{ text: "🎬 Video Jobs gần đây", callback_data: "admin:jobs" }],
        [{ text: "🔙 Menu chính", callback_data: "menu:home" }]
      ]
    }
  );
}

// Instantiate and configure automated bot dispatcher
export const bot = new BotDispatcher();

// --- 1. COMMANDS REGISTRATION ---

bot.command("start", async ({ chatId, telegramId, message, env, db }) => {
  await clearSession(db, telegramId);
  const balance = await getWalletBalance(db, telegramId);
  await sendMessage(
    env,
    chatId,
    `🤖 *HENDY SERVER PRO V2*\n` +
    `Xin chào *${message.from.first_name || "bạn"}*!\n\n` +
    `💰 Số dư hiện tại: *${balance.toLocaleString("vi-VN")} VNĐ*\n\n` +
    `Chọn dịch vụ hoặc tác vụ bên dưới:`,
    await mainKeyboard(env, db, telegramId)
  );
}, { description: "Mở menu chính và kiểm tra trạng thái tài khoản" });

bot.command("help", async ({ chatId, env, db, telegramId, userIsAdmin }) => {
  const helpText = bot.generateHelpText(userIsAdmin);
  await sendMessage(env, chatId, helpText, await mainKeyboard(env, db, telegramId));
}, { description: "Xem tài liệu hướng dẫn và danh sách lệnh" });

bot.command("balance", async ({ chatId, telegramId, env, db }) => {
  const balance = await getWalletBalance(db, telegramId);
  await sendMessage(
    env,
    chatId,
    `💰 *Số dư ví hiện tại:*\n*${balance.toLocaleString("vi-VN")} VNĐ*`,
    {
      inline_keyboard: [
        [{ text: "💳 Nạp thêm", callback_data: "service:deposit" }],
        [{ text: "🔙 Menu chính", callback_data: "menu:home" }]
      ]
    }
  );
}, { description: "Kiểm tra số dư ví hiện tại" });

bot.command("vietsub", async ({ chatId, telegramId, env, db }) => {
  await setSession(db, telegramId, { action: "waiting_video_link" });
  await sendMessage(
    env,
    chatId,
    `🎬 Gửi link video HTTPS từ YouTube, TikTok hoặc Facebook để tạo yêu cầu Vietsub.`,
    { inline_keyboard: [[{ text: "🔙 Menu chính", callback_data: "menu:home" }]] }
  );
}, { description: "Gửi link video tạo phụ đề tự động" });

bot.command("deposit", async ({ chatId, telegramId, args, env, db }) => {
  if (args) {
    const amount = parseInt(args.replace(/[^0-9]/g, ""), 10);
    if (amount) {
      await handleDepositRequest(env, db, chatId, null, telegramId, amount);
      return;
    }
  }
  await sendMessage(
    env,
    chatId,
    `💳 *CHỌN MỨC TIỀN NẠP HOẶC NHẬP SỐ TIỀN:*\n\nBạn có thể nhấn nút chọn nhanh bên dưới hoặc gõ \`/deposit <số tiền>\` (ví dụ: \`/deposit 50000\`).`,
    {
      inline_keyboard: [
        [
          { text: "10.000 đ", callback_data: "deposit:10000" },
          { text: "20.000 đ", callback_data: "deposit:20000" }
        ],
        [
          { text: "50.000 đ", callback_data: "deposit:50000" },
          { text: "100.000 đ", callback_data: "deposit:100000" }
        ],
        [{ text: "✏️ Nhập số khác", callback_data: "deposit:custom" }],
        [{ text: "🔙 Menu chính", callback_data: "menu:home" }]
      ]
    }
  );
}, { description: "Tạo yêu cầu nạp tiền vào ví (/deposit 50000)" });

bot.command("history", async ({ chatId, telegramId, env, db }) => {
  await showUserHistory(env, db, chatId, null, telegramId);
}, { description: "Xem lịch sử video jobs và biến động số dư" });

bot.command("jobs", async ({ chatId, telegramId, env, db }) => {
  await showUserHistory(env, db, chatId, null, telegramId);
}, { description: "Xem danh sách các video jobs của bạn" });

bot.command("admin", async ({ chatId, telegramId, env, db }) => {
  await sendAdminPanel(env, chatId, null, telegramId, db);
}, { description: "Bảng điều khiển quản trị viên", adminOnly: true });

bot.command("admin_payments", async ({ chatId, env, db }) => {
  const pending = await listPendingPayments(db, 10);
  if (!pending.length) {
    await sendMessage(env, chatId, "✅ Không có yêu cầu nạp tiền nào đang chờ duyệt.");
    return;
  }
  for (const p of pending) {
    await sendMessage(
      env,
      chatId,
      `💳 *Yêu cầu: \`${p.id}\`*\n• User: \`${p.telegram_id}\` (${p.first_name || p.username || "Khách"})\n• Số tiền: *${p.amount_vnd.toLocaleString("vi-VN")} VNĐ*\n• Thời gian: ${p.created_at}`,
      {
        inline_keyboard: [
          [
            { text: "✅ Duyệt", callback_data: `pay:app:${p.id}` },
            { text: "❌ Từ chối", callback_data: `pay:rej:${p.id}` }
          ]
        ]
      }
    );
  }
}, { description: "Danh sách các yêu cầu nạp chờ duyệt", adminOnly: true });

bot.command("admin_jobs", async ({ chatId, env, db }) => {
  const jobs = await listRecentVideoJobs(db, 10);
  if (!jobs.length) {
    await sendMessage(env, chatId, "ℹ️ Chưa có video jobs nào trong hệ thống.");
    return;
  }
  let msg = `🎬 *DANH SÁCH 10 VIDEO JOBS GẦN NHẤT:*\n\n`;
  for (const j of jobs) {
    msg += `• [${j.id.slice(0, 8)}] User: \`${j.telegram_id}\` | ${j.status.toUpperCase()} (${j.progress}%)\n  Link: ${j.source_url.slice(0, 40)}...\n`;
  }
  await sendMessage(env, chatId, msg);
}, { description: "Danh sách 10 video jobs mới nhất", adminOnly: true });

// --- 2. SESSIONS REGISTRATION ---

bot.session("waiting_deposit_amount", async ({ text, chatId, telegramId, env, db }) => {
  const amount = parseInt(text.replace(/[^0-9]/g, ""), 10);
  if (!amount || amount < 5000) {
    await sendMessage(env, chatId, "❌ Vui lòng nhập số tiền hợp lệ (tối thiểu 5.000 VNĐ):");
    return;
  }
  await clearSession(db, telegramId);
  await handleDepositRequest(env, db, chatId, null, telegramId, amount);
});

bot.session("waiting_video_link", async ({ text, chatId, telegramId, env, db }) => {
  if (!isAllowedMediaUrl(text, env.MEDIA_ALLOWED_HOSTS)) {
    await sendMessage(env, chatId, "❌ Link không hợp lệ. Chỉ chấp nhận URL HTTPS từ nền tảng video được cấu hình (YouTube, TikTok, Facebook).");
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
    await sendMessage(
      env,
      chatId,
      `✅ *ĐÃ TIẾP NHẬN YÊU CẦU VIETSUB!*\n\n` +
      `• Mã công việc: \`${jobId}\`\n` +
      `• Nguồn video: ${text}\n` +
      `• Trạng thái: ⏳ *Đang xếp hàng*\n\n` +
      `Hệ thống sẽ gửi thông báo tự động ngay khi quá trình tạo phụ đề hoàn tất.`,
      {
        inline_keyboard: [
          [{ text: "📜 Xem lịch sử", callback_data: "user:history" }],
          [{ text: "🔙 Menu chính", callback_data: "menu:home" }]
        ]
      }
    );
  } catch (error) {
    await clearSession(db, telegramId);
    await sendMessage(env, chatId, "❌ Không thể đưa yêu cầu vào hàng đợi. Vui lòng thử lại sau.");
    throw error;
  }
});

// Fallback message handler
bot.fallback(async ({ chatId, env, db, telegramId }) => {
  await sendMessage(
    env,
    chatId,
    "Mình chưa nhận diện được lệnh. Gửi /help để xem danh sách lệnh được hỗ trợ.",
    await mainKeyboard(env, db, telegramId)
  );
});

// --- 3. CALLBACK QUERIES REGISTRATION ---

bot.callback("menu:home", async ({ chatId, messageId, telegramId, env, db }) => {
  await clearSession(db, telegramId);
  const balance = await getWalletBalance(db, telegramId);
  await safeEditOrSend(
    env,
    chatId,
    messageId,
    `🤖 *HENDY SERVER PRO V2*\n` +
    `Số dư ví: *${balance.toLocaleString("vi-VN")} VNĐ*\n\n` +
    `Chọn dịch vụ bên dưới:`,
    await mainKeyboard(env, db, telegramId)
  );
});

bot.callback("service:vietsub", async ({ chatId, messageId, telegramId, env, db }) => {
  await setSession(db, telegramId, { action: "waiting_video_link" });
  await safeEditOrSend(
    env,
    chatId,
    messageId,
    "🎬 Gửi link video HTTPS từ YouTube, TikTok hoặc Facebook để tạo yêu cầu Vietsub.",
    { inline_keyboard: [[{ text: "🔙 Menu chính", callback_data: "menu:home" }]] }
  );
});

bot.callback("service:deposit", async ({ chatId, messageId, env }) => {
  await safeEditOrSend(
    env,
    chatId,
    messageId,
    "💳 *CHỌN MỨC TIỀN NẠP VÀO VÍ:*\n\nHệ thống hỗ trợ nạp qua chuyển khoản ngân hàng tự động đối soát nội dung.",
    {
      inline_keyboard: [
        [
          { text: "10.000 đ", callback_data: "deposit:10000" },
          { text: "20.000 đ", callback_data: "deposit:20000" }
        ],
        [
          { text: "50.000 đ", callback_data: "deposit:50000" },
          { text: "100.000 đ", callback_data: "deposit:100000" }
        ],
        [{ text: "✏️ Nhập số khác", callback_data: "deposit:custom" }],
        [{ text: "🔙 Menu chính", callback_data: "menu:home" }]
      ]
    }
  );
});

bot.callback("deposit:*", async ({ data, chatId, messageId, telegramId, env, db }) => {
  const val = data.replace("deposit:", "");
  if (val === "custom") {
    await setSession(db, telegramId, { action: "waiting_deposit_amount" });
    await safeEditOrSend(
      env,
      chatId,
      messageId,
      "✏️ Vui lòng gửi tin nhắn chứa số tiền bạn muốn nạp (ví dụ: `50000` hoặc `200000`):",
      { inline_keyboard: [[{ text: "🔙 Menu chính", callback_data: "menu:home" }]] }
    );
    return;
  }
  const amount = parseInt(val, 10);
  if (amount) {
    await handleDepositRequest(env, db, chatId, messageId, telegramId, amount);
  }
});

bot.callback("wallet:balance", async ({ chatId, messageId, telegramId, env, db }) => {
  const balance = await getWalletBalance(db, telegramId);
  await safeEditOrSend(
    env,
    chatId,
    messageId,
    `💰 *Số dư ví hiện tại:*\n*${balance.toLocaleString("vi-VN")} VNĐ*`,
    {
      inline_keyboard: [
        [{ text: "💳 Nạp thêm", callback_data: "service:deposit" }],
        [{ text: "🔙 Menu chính", callback_data: "menu:home" }]
      ]
    }
  );
});

bot.callback("user:history", async ({ chatId, messageId, telegramId, env, db }) => {
  await showUserHistory(env, db, chatId, messageId, telegramId);
});

bot.callback("admin:panel", async ({ chatId, messageId, telegramId, env, db }) => {
  await sendAdminPanel(env, chatId, messageId, telegramId, db);
}, { adminOnly: true });

bot.callback("admin:pending_payments", async ({ chatId, messageId, env, db }) => {
  const pending = await listPendingPayments(db, 10);
  if (!pending.length) {
    await safeEditOrSend(
      env,
      chatId,
      messageId,
      "✅ Không có yêu cầu nạp tiền nào đang chờ duyệt.",
      { inline_keyboard: [[{ text: "🔙 Bảng quản trị", callback_data: "admin:panel" }]] }
    );
    return;
  }
  await sendMessage(env, chatId, `📋 Tìm thấy ${pending.length} yêu cầu nạp tiền đang chờ:`);
  for (const p of pending) {
    await sendMessage(
      env,
      chatId,
      `💳 *Mã: \`${p.id}\`*\n• User: \`${p.telegram_id}\` (${p.first_name || p.username || "Khách"})\n• Số tiền: *${p.amount_vnd.toLocaleString("vi-VN")} VNĐ*\n• Ngày: ${p.created_at}`,
      {
        inline_keyboard: [
          [
            { text: "✅ Duyệt", callback_data: `pay:app:${p.id}` },
            { text: "❌ Từ chối", callback_data: `pay:rej:${p.id}` }
          ]
        ]
      }
    );
  }
}, { adminOnly: true });

bot.callback("admin:jobs", async ({ chatId, messageId, env, db }) => {
  const jobs = await listRecentVideoJobs(db, 10);
  if (!jobs.length) {
    await safeEditOrSend(
      env,
      chatId,
      messageId,
      "ℹ️ Chưa có video jobs nào.",
      { inline_keyboard: [[{ text: "🔙 Bảng quản trị", callback_data: "admin:panel" }]] }
    );
    return;
  }
  let msg = `🎬 *10 VIDEO JOBS GẦN NHẤT:*\n\n`;
  for (const j of jobs) {
    msg += `• [${j.id.slice(0, 8)}] User \`${j.telegram_id}\` | ${j.status.toUpperCase()} (${j.progress}%)\n`;
  }
  await safeEditOrSend(
    env,
    chatId,
    messageId,
    msg,
    { inline_keyboard: [[{ text: "🔙 Bảng quản trị", callback_data: "admin:panel" }]] }
  );
}, { adminOnly: true });

bot.callback("pay:app:*", async ({ data, chatId, messageId, telegramId, env, db }) => {
  const paymentId = data.replace("pay:app:", "");
  try {
    const result = await approvePayment(db, paymentId, telegramId);
    await safeEditOrSend(
      env,
      chatId,
      messageId,
      `✅ *ĐÃ DUYỆT YÊU CẦU ${paymentId}*\nCộng: *${result.amountVnd.toLocaleString("vi-VN")} VNĐ*\nSố dư mới của user: ${result.newBalance.toLocaleString("vi-VN")} VNĐ`,
      { inline_keyboard: [[{ text: "🔙 Bảng quản trị", callback_data: "admin:panel" }]] }
    );
    await sendMessage(
      env,
      result.telegramId,
      `🎉 *NẠP TIỀN THÀNH CÔNG!*\n\nYêu cầu \`${paymentId}\` đã được duyệt.\nSố tiền: *+${result.amountVnd.toLocaleString("vi-VN")} VNĐ*\nSố dư ví hiện tại: *${result.newBalance.toLocaleString("vi-VN")} VNĐ*`
    ).catch(() => {});
  } catch (err) {
    await sendMessage(env, chatId, `❌ Lỗi khi duyệt: ${err.message}`);
  }
}, { adminOnly: true });

bot.callback("pay:rej:*", async ({ data, chatId, messageId, telegramId, env, db }) => {
  const paymentId = data.replace("pay:rej:", "");
  try {
    const result = await rejectPayment(db, paymentId, telegramId, "Admin rejected");
    await safeEditOrSend(
      env,
      chatId,
      messageId,
      `❌ *ĐÃ TỪ CHỐI YÊU CẦU ${paymentId}*`,
      { inline_keyboard: [[{ text: "🔙 Bảng quản trị", callback_data: "admin:panel" }]] }
    );
    await sendMessage(
      env,
      result.telegramId,
      `❌ *Yêu cầu nạp tiền \`${paymentId}\` không được duyệt.* Vui lòng kiểm tra lại thông tin chuyển khoản hoặc liên hệ hỗ trợ.`
    ).catch(() => {});
  } catch (err) {
    await sendMessage(env, chatId, `❌ Lỗi khi từ chối: ${err.message}`);
  }
}, { adminOnly: true });

// --- MAIN EXPORTED ENTRY POINT ---

export async function handleTelegramUpdate(update, env, db) {
  const helpers = {
    sendMessage,
    safeEditOrSend,
    callTelegram,
    clearSession,
    setSession,
    getSession,
    upsertTelegramUser,
    isAdmin,
    mainKeyboard
  };
  return bot.dispatch(update, env, db, helpers);
}
