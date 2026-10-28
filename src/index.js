// ==========================================
// ⚙️ CẤU HÌNH HỆ THỐNG CLOUDFLARE WORKER
// ==========================================

let users = {}; 
const userStates = {};   // Quản lý trạng thái nhập liệu tạm thời
const BRANDS = ["SC88", "C168", "CM88", "F8BET", "RR88", "MM88", "GG88", "U888", "J88", "88CLB", "ABC8", "XX8", "KJC_CU"];

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);

        // 1. Route trang chủ (Root)
        if (url.pathname === '/' && request.method === 'GET') {
            return new Response("🤖 Bot Telegram Hendy Cybertech đang chạy trên Cloudflare Workers!", {
                headers: { 'Content-Type': 'text/plain; charset=utf-8' }
            });
        }

        // 2. Route Webhook từ Telegram
        if (url.pathname === '/webhook' && request.method === 'POST') {
            // Bảo mật Webhook bằng Secret Token
            if (env.WEBHOOK_SECRET_TOKEN) {
                const clientSecret = request.headers.get('x-telegram-bot-api-secret-token');
                if (clientSecret !== env.WEBHOOK_SECRET_TOKEN) {
                    console.warn('⚠️ Cảnh báo: Phát hiện request không hợp lệ!');
                    return new Response("Unauthorized", { status: 403 });
                }
            }

            try {
                const update = await request.json();
                // Xử lý bất đồng bộ, không block response trả về Telegram
                ctx.waitUntil(handleUpdate(update, env));
                return new Response("OK", { status: 200 });
            } catch (e) {
                console.error("Lỗi xử lý:", e);
                return new Response("Lỗi xử lý", { status: 500 });
            }
        }

        return new Response("Not Found", { status: 404 });
    }
};

// ==========================================
// 2. HÀM GIAO TIẾP VỚI TELEGRAM API & KTOR CLIENT
// ==========================================
async function callTelegramApi(method, payload, botToken) {
    const apiurl = `https://api.telegram.org/bot${botToken}/${method}`;
    return fetch(apiurl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
}

async function sendAdminCommandViaKtorClient(command, adminId, coreBackendUrl) {
    try {
        const response = await fetch(`${coreBackendUrl}/api/bot-trigger`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chatId: adminId,
                userName: 'Hendy_Admin',
                action: 'ADMIN_COMPOSE_COMMAND',
                command: command,
                clientSDK: 'ComposeWeb-TMA-KtorClient'
            })
        });
        return await response.json();
    } catch (err) {
        return { success: false, error: err.message };
    }
}

function initUser(chatId, user) {
    if (!users[chatId]) {
        users[chatId] = {
            name: user ? (user.first_name || 'Khách') : 'Khách',
            balance: 50000,
            history: ["Khởi tạo tài khoản (+50,000 VNĐ)"],
            wonCodes: [],
            linkedAccounts: { SC88: [], C168: [], CM88: [], F8BET: [], ABCVIP: [], KJC_CU: [] },
            accountKho: { RR88: [], MM88: [], GG88: [], U888: [], J88: [], "88CLB": [], ABC8: [], XX8: [], ABCVIP: [], KJC_CU: [] }
        };
    }
    return users[chatId];
}

// ==========================================
// 3. HÀM TẠO GIAO DIỆN MENU CHÍNH
// ==========================================
function getMainMenuKeyboard() {
    return {
        inline_keyboard: [
            [{ text: '🛍️ TRUNG TÂM MUA CODE MINI TRỰC TIẾP', callback_data: 'shop_code_mini' }],
            [{ text: '🌐 DỊCH VỤ MẠNG XÃ HỘI', callback_data: 'social_service' }],
            [{ text: '💳 NẠP TIỀN', callback_data: 'deposit' }],
            [{ text: '💎 TRUNG TÂM KHÁCH HÀNG', callback_data: 'cshk_center' }],
            [{ text: '🤖 BOT DỊCH VỤ VIETSUB (PIPELINE)', callback_data: 'bot_vietsub' }],
            [{ text: '🚀 COMPOSE WEB / TMA KTOR ENTRYPOINT', callback_data: 'compose_web_tma' }],
            [{ text: '🎧 LIÊN HỆ CSKH', url: 'https://t.me/your_support' }],
            [{ text: '🛠 ADMIN QUẢN LÝ XÂY DỰNG PHÁT TRIỂN Vietsub', callback_data: 'admin_panel' }]
        ]
    };
}

// ==========================================
// 4. LOGIC XỬ LÝ TOÀN BỘ CẬP NHẬT (UPDATE)
// ==========================================
async function handleUpdate(update, env) {
    const BOT_TOKEN = env.BOT_TOKEN;
    const ADMIN_ID = env.ADMIN_ID || '8639286417';
    const MINI_APP_URL = env.MINI_APP_URL || 'https://ngogiaidy56-eng.github.io/BOT-TELE';
    const WEB_APP_URL = env.WEB_APP_URL || env.CORE_BACKEND_URL;
    const CORE_BACKEND_URL = env.CORE_BACKEND_URL;

    // A. XỬ LÝ TIN NHẮN VĂN BẢN
    if (update.message && update.message.text) {
        const msg = update.message;
        const chatId = msg.chat.id.toString();
        const text = msg.text.trim();
        const u = initUser(chatId, msg.from);

        if (text.startsWith('/start')) {
            delete userStates[chatId];
            const welcomeMessage = `🤖 *BOT HENDY CYBERTECH 2026* [BOT CHÍNH] 🚀\nBuổi chiều vui vẻ nhé, *${u.name}* (ID: \`${chatId}\`)\n--------------------------------------------------\n💎 *VIP 0*\n💰 **Ví Chính:** \`${u.balance.toLocaleString()} VNĐ\``;
            await callTelegramApi('sendMessage', {
                chat_id: chatId, text: welcomeMessage, parse_mode: 'Markdown', reply_markup: getMainMenuKeyboard()
            }, BOT_TOKEN);
            return;
        }

        if (userStates[chatId]) {
            const state = userStates[chatId];
            const action = state.action;

            if (action === 'waiting_add_acc') {
                const brand = state.brand;
                if (!u.accountKho[brand]) u.accountKho[brand] = [];
                u.accountKho[brand].push({ acc: text, checked: true });
                delete userStates[chatId];
                const successMsg = `✅ *THÊM TÀI KHOẢN THÀNH CÔNG!*\n\n📦 Kho: *${brand}*\n🔑 Thông tin: \`${text}\``;
                const kb = { inline_keyboard: [[{ text: "◀ Quay lại Kho " + brand, callback_data: "shop_kho_detail_" + brand }]] };
                await callTelegramApi('sendMessage', { chat_id: chatId, text: successMsg, parse_mode: 'Markdown', reply_markup: kb }, BOT_TOKEN);
                return;
            }

            if (action === 'waiting_link_account') {
                const brand = state.brand;
                if (!u.linkedAccounts[brand]) u.linkedAccounts[brand] = [];
                u.linkedAccounts[brand].push(text);
                u.history.push(`Liên kết tài khoản ${brand}:${text}`);
                delete userStates[chatId];
                const successMsg = `✅ *LIÊN KẾT THÀNH CÔNG!*\n\n🏢 Sảnh: *${brand}*\n🔑 Tài khoản: \`${text}\``;
                const kb = { inline_keyboard: [[{ text: "◀ Quay lại", callback_data: brand === "KJC_CU" ? "shop_kjc_cu_kho" : "cshk_center" }]] };
                await callTelegramApi('sendMessage', { chat_id: chatId, text: successMsg, parse_mode: 'Markdown', reply_markup: kb }, BOT_TOKEN);
                return;
            }

            if (action === 'waiting_live_link') {
                const platform = state.platform;
                const cost = platform === "TikTok" ? 10000 : 15000;
                if (u.balance < cost) {
                    delete userStates[chatId];
                    const errorMsg = `❌ *GIAO DỊCH THẤT BẠI*\nSố dư (\`${u.balance.toLocaleString()} VNĐ\`) không đủ mua 1K mắt ${platform}.`;
                    const kb = { inline_keyboard: [[{ text: "💳 Nạp Tiền", callback_data: "deposit" }, { text: "🔙 Menu", callback_data: "back_start" }]] };
                    await callTelegramApi('sendMessage', { chat_id: chatId, text: errorMsg, parse_mode: 'Markdown', reply_markup: kb }, BOT_TOKEN);
                    return;
                }
                u.balance -= cost;
                u.history.push(`Mua 1K mắt ${platform} Live (-${cost.toLocaleString()} VNĐ)`);
                delete userStates[chatId];
                const successBuff = `🚀 *BUFF MẮT THÀNH CÔNG!*\n🎵 Nền tảng: *${platform}*\n🔗 Link: ${text}\n💰 Trừ: \`-${cost.toLocaleString()} VNĐ\`\n💵 Số dư còn lại: \`${u.balance.toLocaleString()} VNĐ\``;
                const kb = { inline_keyboard: [[{ text: "🔙 Quay lại Menu Chính", callback_data: "back_start" }]] };
                await callTelegramApi('sendMessage', { chat_id: chatId, text: successBuff, parse_mode: 'Markdown', reply_markup: kb }, BOT_TOKEN);
                return;
            }

            if (action === 'waiting_video_link') {
                delete userStates[chatId];
                const successMsg = `🎬 *ĐÃ NHẬN YÊU CẦU*\n\nVideo của bạn đã được đưa vào hệ thống Media Pipeline qua Ktor Client / WebSocket Backend.`;
                const kb = { inline_keyboard: [[{ text: "🔙 Quay lại Menu Chính", callback_data: "back_start" }]] };
                await callTelegramApi('sendMessage', { chat_id: chatId, text: successMsg, parse_mode: 'Markdown', reply_markup: kb }, BOT_TOKEN);
                return;
            }
        }
    }

    // B. XỬ LÝ NÚT BẤM (CALLBACK QUERY)
    if (update.callback_query) {
        const query = update.callback_query;
        const chatId = query.message.chat.id.toString();
        const messageId = query.message.message_id;
        const data = query.data;
        const u = initUser(chatId, query.from);

        await callTelegramApi('answerCallbackQuery', { callback_query_id: query.id }, BOT_TOKEN);

        if (data === 'back_start') {
            delete userStates[chatId];
            const welcomeMessage = `🤖 *BOT HENDY CYBERTECH 2026* [BOT CHÍNH] 🚀\nChào mừng bạn quay lại, *${u.name}* (ID: \`${chatId}\`)\n--------------------------------------------------\n💎 *VIP 0*\n💰 **Ví Chính:** \`${u.balance.toLocaleString()} VNĐ\``;
            await callTelegramApi('editMessageText', { chat_id: chatId, message_id: messageId, text: welcomeMessage, parse_mode: 'Markdown', reply_markup: getMainMenuKeyboard() }, BOT_TOKEN);
            return;
        }

        let subMenuText = '';
        let subMenuKeyboard = { inline_keyboard: [[{ text: '🔙 Quay lại Menu Chính', callback_data: 'back_start' }]] };

        if (data === 'shop_code_mini') {
            subMenuText = `🛍️ *TRUNG TÂM MUA CODE MINI TRỰC TIẾP*\n\nVui lòng chọn sảnh hoặc gói mã code bên dưới:`;
            subMenuKeyboard = {
                inline_keyboard: [
                    [{ text: '🚀 Liên Minh KJC', callback_data: 'shop_kjc' }, { text: '🚀 Liên Minh KJC CŨ', callback_data: 'shop_kjc_cu' }],
                    [{ text: '🚀 Liên Minh ABCVIP', callback_data: 'shop_abcvip_group' }],
                    [{ text: '🐶 TRỞ VỀ MENU CHÍNH', callback_data: 'back_start' }]
                ]
            };
        } else if (data === 'shop_kjc_cu') {
            const rr88Count = (u.accountKho.RR88 || []).length;
            const mm88Count = (u.accountKho.MM88 || []).length;
            const gg88Count = (u.accountKho.GG88 || []).length;
            subMenuText = `🎮 *LIÊN MINH KJC CŨ (RR88 • MM88 • GG88)*\n----------------------------------------\n👤 Chào *${u.name}*\n📊 *THỐNG KÊ KHO ACC:*\n• Kho RR88: \`${rr88Count}\` tài khoản\n• Kho MM88: \`${mm88Count}\` tài khoản\n• Kho GG88: \`${gg88Count}\` tài khoản\n✅ Liên kết thành công: \`${(u.linkedAccounts.KJC_CU || []).length}\``;
            subMenuKeyboard = {
                inline_keyboard: [
                    [{ text: '🎮 RR88 MINI GAME', callback_data: 'shop_kho_detail_RR88' }],
                    [{ text: '🎮 MM88 MINI GAME', callback_data: 'shop_kho_detail_MM88' }],
                    [{ text: '🎮 GG88 MINI GAME', callback_data: 'shop_kho_detail_GG88' }],
                    [{ text: '🌊 【KHO ACC KJC CŨ LIÊN KẾT BOT】', callback_data: 'shop_kjc_cu_kho' }],
                    [{ text: '« QUAY LẠI', callback_data: 'shop_code_mini' }]
                ]
            };
        } else if (data === 'shop_kjc_cu_kho') {
            const accList = u.linkedAccounts.KJC_CU || [];
            let str = accList.length > 0 ? accList.map((a, i) => `${i+1}. \`${a}\``).join('\n') : 'Bạn chưa liên kết tài khoản KJC CŨ nào.';
            subMenuText = `🚀 *LIÊN MINH KJC CŨ*\n\n🎁 *KHO TÀI KHOẢN KJC CŨ ĐÃ LIÊN KẾT:*\n\n${str}`;
            subMenuKeyboard = {
                inline_keyboard: [
                    [{ text: '➕ THÊM LIÊN KẾT MỚI (AUTO)', callback_data: 'link_KJC_CU' }],
                    [{ text: '❌ XÓA LIÊN KẾT', callback_data: 'clear_link_KJC_CU' }],
                    [{ text: '« Quay lại', callback_data: 'shop_kjc_cu' }]
                ]
            };
        } else if (data === 'clear_link_KJC_CU') {
            u.linkedAccounts.KJC_CU = [];
            subMenuText = `🗑️ Đã xóa toàn bộ liên kết tài khoản Liên Minh KJC CŨ!`;
            subMenuKeyboard = { inline_keyboard: [[{ text: '« Quay lại', callback_data: 'shop_kjc_cu_kho' }]] };
        } else if (data === 'shop_abcvip_group') {
            subMenuText = `📊 *THỐNG KÊ ĐƠN ABCVIP:*\n🔴 Tổng đơn đang chạy: \`0\`\n>> U888: \`0\`\n>> J88: \`0\`\n>> 88CLB: \`0\`\n>> ABC8: \`0\`\n>> XX8: \`0\`\n⏳ Đang chờ duyệt: \`0\`\n✅ Liên kết thành công: \`${(u.linkedAccounts.ABCVIP || []).length}\``;
            subMenuKeyboard = {
                inline_keyboard: [
                    [{ text: '❤️ U888 MINIGAME', callback_data: 'shop_kho_detail_U888' }],
                    [{ text: '❤️ J88 MINIGAME', callback_data: 'shop_kho_detail_J88' }],
                    [{ text: '❤️ 88CLB MINIGAME', callback_data: 'shop_kho_detail_88CLB' }],
                    [{ text: '❤ ABC8 MINIGAME', callback_data: 'shop_kho_detail_ABC8' }],
                    [{ text: '❤️ XX8 MINIGAME', callback_data: 'shop_kho_detail_XX8' }],
                    [{ text: '🌊 【KHO ACC ABCVIP LIÊN KẾT BOT】', callback_data: 'shop_abcvip_kho' }],
                    [{ text: '« Quay lại', callback_data: 'shop_code_mini' }]
                ]
            };
        } else if (data === 'shop_abcvip_kho') {
            const accList = u.linkedAccounts.ABCVIP || [];
            let str = accList.length > 0 ? accList.map((a, i) => `${i+1}. \`${a}\``).join('\n') : 'Bạn chưa liên kết tài khoản ABCVIP nào.';
            subMenuText = `LIÊN MINH ABCVIP\n\n🎁 *KHO TÀI KHOẢN ABCVIP CỦA BẠN:*\n\n${str}`;
            subMenuKeyboard = {
                inline_keyboard: [
                    [{ text: '➕ THÊM LIÊN KẾT MỚI (AUTO)', callback_data: 'link_ABCVIP' }],
                    [{ text: '❌ XÓA LIÊN KẾT', callback_data: 'clear_link_ABCVIP' }],
                    [{ text: '« Quay lại', callback_data: 'shop_abcvip_group' }]
                ]
            };
        } else if (data.startsWith('shop_kho_detail_')) {
            const brand = data.replace('shop_kho_detail_', '');
            const list = u.accountKho[brand] || [];
            const total = list.length;
            const checked = list.filter(item => item.checked).length;
            const unchecked = total - checked;
            const emptyNotice = total === 0 ? '\n\n_Kho chưa có tài khoản nào._' : '';
            subMenuText = `📦 *KHO ACC ${brand}*\n----------------------------------------\n📊 Tổng: \`${total}/50\` tài khoản\n✅ Đã check: \`${checked}\` \n⏳ Chưa check: \`${unchecked}\` \n----------------------------------------${emptyNotice}`;
            subMenuKeyboard = {
                inline_keyboard: [
                    [{ text: '➕ THÊM ACC VÀO KHO', callback_data: `add_acc_${brand}` }],
                    [{ text: '🔍 CHECK ACC', callback_data: `check_acc_${brand}` }],
                    [{ text: '🗑️ XÓA ACC', callback_data: `clear_acc_${brand}` }],
                    [{ text: '« QUAY LẠI', callback_data: 'shop_code_mini' }]
                ]
            };
        } else if (data.startsWith('add_acc_')) {
            const brand = data.replace('add_acc_', '');
            userStates[chatId] = { action: 'waiting_add_acc', brand: brand };
            subMenuText = `➕ *THÊM ACC VÀO KHO ${brand}*\n\n👉 Vui lòng nhập **Tài khoản | Mật khẩu** của bạn vào khung chat:`;
        } else if (data.startsWith('check_acc_')) {
            const brand = data.replace('check_acc_', '');
            subMenuText = `🔍 *KIỂM TRA TÀI KHOẢN ${brand}*\n\nHệ thống đã quét toàn bộ tài khoản trong kho. Tất cả tài khoản hợp lệ!`;
            subMenuKeyboard = { inline_keyboard: [[{ text: '« Quay lại', callback_data: `shop_kho_detail_${brand}` }]] };
        } else if (data.startsWith('clear_acc_')) {
            const brand = data.replace('clear_acc_', '');
            u.accountKho[brand] = [];
            subMenuText = `🗑️ Đã xóa toàn bộ tài khoản trong kho *${brand}*!`;
            subMenuKeyboard = { inline_keyboard: [[{ text: '« Quay lại', callback_data: `shop_kho_detail_${brand}` }]] };
        } else if (data === 'clear_link_ABCVIP') {
            u.linkedAccounts.ABCVIP = [];
            subMenuText = `🗑️ Đã xóa toàn bộ liên kết tài khoản ABCVIP!`;
            subMenuKeyboard = { inline_keyboard: [[{ text: '« Quay lại', callback_data: 'shop_abcvip_kho' }]] };
        } else if (data === 'shop_kjc') {
            subMenuText = `🚀 *LIÊN MINH KJC*\nĐang cập nhật các gói code quà tặng KJC mới nhất...`;
            subMenuKeyboard = { inline_keyboard: [[{ text: '« Quay lại', callback_data: 'shop_code_mini' }]] };
        } else if (data === 'social_service') {
            subMenuText = '🌐 *DỊCH VỤ MẠNG XÃ HỘI*\nHệ thống buff tương tác tự động. Vui lòng chọn dịch vụ:';
            subMenuKeyboard = {
                inline_keyboard: [
                    [{ text: '🎵 Buff 1K Mắt TikTok Live (10k VNĐ)', callback_data: 'buff_tiktok' }],
                    [{ text: '📘 Buff 1K Mắt Facebook Live (15k VNĐ)', callback_data: 'buff_fb' }],
                    [{ text: '🔙 Quay lại Menu Chính', callback_data: 'back_start' }]
                ]
            };
        } else if (data === 'buff_tiktok') {
            userStates[chatId] = { action: 'waiting_live_link', platform: 'TikTok' };
            subMenuText = '🎵 *BUFF 1K MẮT TIKTOK LIVE*\n\n👉 Gửi **Link hoặc Username Livestream TikTok** vào khung chat:';
        } else if (data === 'buff_fb') {
            userStates[chatId] = { action: 'waiting_live_link', platform: 'Facebook' };
            subMenuText = '📘 *BUFF 1K MẮT FACEBOOK LIVE*\n\n👉 Gửi **Link Livestream Facebook** vào khung chat:';
        } else if (data === 'deposit') {
            subMenuText = '💳 *NẠP TIỀN VÀO HỆ THỐNG*\nChuyển khoản tự động qua Momo/Banking.\nSố dư hiện tại của bạn: `' + u.balance.toLocaleString() + ' VNĐ`';
        } else if (data === 'cshk_center') {
            subMenuText = `🎴 *TRUNG TÂM QUẢN LÝ TÀI KHOẢN*\n\nChọn một trong hai cách truy cập bên dưới:\n• *Mini App:* Trải nghiệm mới, mượt mà hơn (khuyến nghị).\n• *Đăng nhập truyền thống:* link có hiệu lực 5 phút.`;
            subMenuKeyboard = {
                inline_keyboard: [
                    [{ text: '🚀 [MINI APP] BẢN MỚI | CHỈ MOBILE', web_app: { url: MINI_APP_URL } }],
                    [{ text: '🔑 PHIÊN BẢN WEB CŨ', url: WEB_APP_URL }],
                    [{ text: '⬅️ TRỞ VỀ MENU CHÍNH', callback_data: 'back_start' }]
                ]
            };
        } else if (data === 'compose_web_tma') {
            subMenuText = `🚀 *COMPOSE WEB & TELEGRAM WEBSDK (TMA)*\n\nĐã khởi tạo *JS Entrypoint* thành công cho Kotlin/Compose Web Target!\n• *Ktor Client:* Đã sẵn sàng kết nối WebSocket & HTTP Gateway.\n• *Telegram WebApp SDK:* Đã bind sự dụng window.Telegram.WebApp.`;
            subMenuKeyboard = {
                inline_keyboard: [
                    [{ text: '🌐 Mở Compose Web App (TMA)', web_app: { url: MINI_APP_URL } }],
                    [{ text: '🔙 Quay lại Menu Chính', callback_data: 'back_start' }]
                ]
            };
        } else if (data === 'admin_panel') {
            if (chatId !== ADMIN_ID) {
                subMenuText = '⛔ Bạn không có quyền truy cập khu vực quản trị!';
            } else {
                const totalUsers = Object.keys(users).length;
                subMenuText = `🛠️ *ADMIN QUẢN LÝ XÂY DỰNG PHÁT TRIỂN Vietsub*\n\n📊 Thống kê: Có \`${totalUsers}\` user đang hoạt động.`;
                subMenuKeyboard = {
                    inline_keyboard: [
                        [{ text: '👥 Danh Sách User Online', callback_data: 'admin_list_users' }],
                        [{ text: '⚡ Ký Lệnh Quản Trị Ktor Client', callback_data: 'admin_ktor_trigger' }],
                        [{ text: '🔙 Quay lại Menu Chính', callback_data: 'back_start' }]
                    ]
                };
            }
        } else if (data === 'admin_list_users') {
            if (chatId !== ADMIN_ID) return;
            let userListStr = "";
            let i = 1;
            for (let id in users) {
                if (i > 10) { userListStr += `... và còn nhiều user khác.`; break; }
                userListStr += `${i}.${users[id].name} (\`${id}\`) - Ví: ${users[id].balance.toLocaleString()}đ\n`;
                i++;
            }
            subMenuText = `👥 *DANH SÁCH THÀNH VIÊN*\n\n${userListStr || 'Chưa có user nào.'}`;
            subMenuKeyboard = { inline_keyboard: [[{ text: '◀ Quay lại Admin', callback_data: 'admin_panel' }]] };
        } else if (data === 'admin_ktor_trigger') {
            if (chatId !== ADMIN_ID) return;
            const res = await sendAdminCommandViaKtorClient('FORCE_SYNC_ALL_PIPELINES', chatId, CORE_BACKEND_URL);
            subMenuText = `⚡ *KẾT QUẢ KTOR CLIENT GỬI LỆNH ADMIN*\n\nTrạng thái phản hồi từ Core Backend:\n\`${JSON.stringify(res, null, 2)}\``;
            subMenuKeyboard = { inline_keyboard: [[{ text: '◀ Quay lại Admin', callback_data: 'admin_panel' }]] };
        } else if (data === 'bot_vietsub') {
            try {
                await fetch(`${CORE_BACKEND_URL}/api/bot-trigger`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ chatId: chatId, userName: u.name, action: 'START_VIETSUB_PIPELINE' })
                });
                subMenuText = `🎬 *BOT DỊCH VỤ VIETSUB V3.0*\n\n✅ Đã gửi lệnh kích hoạt luồng xử lý Video AI đến Core Backend!\n\nVui lòng gửi link Video bạn muốn xử lý vào đây.`;
                userStates[chatId] = { action: 'waiting_video_link' };
            } catch (err) {
                subMenuText = `🔴 *MẤT KẾT NỐI*\nKhông thể kết nối đến Máy chủ Core Backend.`;
            }
            subMenuKeyboard = { inline_keyboard: [[{ text: '🔙 Quay lại Menu Chính', callback_data: 'back_start' }]] };
        }

        await callTelegramApi('editMessageText', { chat_id: chatId, message_id: messageId, text: subMenuText, parse_mode: 'Markdown', reply_markup: subMenuKeyboard }, BOT_TOKEN);
    }
}s
