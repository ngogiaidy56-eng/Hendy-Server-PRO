const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 8080;

// ==============================================================
// 🧠 CỤC RAM VĨNH CỬU
// ==============================================================
let connectedTabs = {}; // Sổ Nam Tào ghi chú Đàn em
let masterSocket = null; // Ngai vàng của Trạm Mẹ

// ==============================================================
// 🌐 GIAO DIỆN GIÁM SÁT TRÊN TRÌNH DUYỆT (DASHBOARD)
// ==============================================================
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>TRẠM VŨ TRỤ HENDY</title>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
                body { background: #050208; color: #00e5ff; font-family: monospace; text-align: center; padding-top: 50px; }
                .box { border: 2px solid #c840ff; padding: 20px; border-radius: 10px; display: inline-block; box-shadow: 0 0 20px rgba(200,64,255,0.4); background: #0a0410; }
                h1 { color: #ffcc00; text-shadow: 0 0 10px rgba(255,204,0,0.5); font-size: 24px;}
                .status { font-size: 20px; font-weight: bold; margin: 15px 0;}
                .online { color: #00ffcc; text-shadow: 0 0 10px rgba(0,255,204,0.5); }
                .offline { color: #ff3366; text-shadow: 0 0 10px rgba(255,51,102,0.5); }
                .count { font-size: 40px; color: #fff; margin: 10px 0; }
            </style>
        </head>
        <body>
            <div class="box">
                <h1>🚀 TỔNG ĐÀI HENDY CYBERPUNK 🚀</h1>
                <div class="status">Trạm Mẹ (Master): <span class="${masterSocket ? 'online' : 'offline'}">${masterSocket ? '🟢 ĐÃ KẾT NỐI' : '🔴 MẤT KẾT NỐI'}</span></div>
                <div class="status" style="color: #aaa;">Đàn Em Đang Sống:</div>
                <div class="count">${Object.keys(connectedTabs).length}</div>
                <div style="color: #555; font-size: 12px; margin-top: 20px;">Trạng thái Server: BẤT TỬ | Port: ${PORT}</div>
            </div>
        </body>
        </html>
    `);
});

// ==============================================================
// ⚡ XỬ LÝ GIAO TIẾP WEBSOCKET (TRÁI TIM HỆ THỐNG)
// ==============================================================
wss.on('connection', (ws, req) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            const action = data.action;

            // 1. TRẠM MẸ XƯNG DANH
            if (action === 'SYNC_REGISTER_MASTER') {
                masterSocket = ws;
                console.log('👑 [MASTER] Trạm Mẹ đã lên sóng!');
                // Gửi ngay danh sách Đàn em hiện có cho Trạm Mẹ
                ws.send(JSON.stringify({ action: 'SYNC_TAB_LIST', value: Object.values(connectedTabs) }));
                return;
            }

            // 2. ĐÀN EM XƯNG DANH HOẶC BÁO CÁO TÌNH HÌNH
            if (action === 'SYNC_REGISTER_TAB' || action === 'SYNC_PING_RESPONSE') {
                if (data.value && data.value.id) {
                    connectedTabs[data.value.id] = data.value;
                    ws.slaveId = data.value.id; // Dán mác cho Đàn em
                    console.log(`🟢 [SLAVE IN] Đàn em [${data.value.name || ws.slaveId}] vừa báo cáo!`);
                }
            }

            // 3. KHI TRẠM MẸ CHỦ ĐỘNG BẤM NÚT "CẬP NHẬT" TÌNH HÌNH
            if (action === 'SYNC_REQUEST_TAB_LIST') {
                if (masterSocket && masterSocket.readyState === WebSocket.OPEN) {
                    masterSocket.send(JSON.stringify({ action: 'SYNC_TAB_LIST', value: Object.values(connectedTabs) }));
                }
                return; // Không cần phát lệnh này đi tiếp
            }

            // 4. PHÁT LỆNH ĐI MUÔN NƠI (Broadcast)
            wss.clients.forEach((client) => {
                // Không gửi lại cho chính người vừa phát lệnh
                if (client !== ws && client.readyState === WebSocket.OPEN) {
                    client.send(message.toString());
                }
            });

        } catch (err) {
            console.error('❌ [CẢNH BÁO] Có kẻ gửi dữ liệu rác, đã chặn!');
        }
    });

    // 5. XỬ LÝ KHI CÓ KẺ RỚT MẠNG HOẶC TẮT TAB
    ws.on('close', () => {
        if (ws === masterSocket) {
            console.log('⚠️ [MASTER OUT] Trạm Mẹ đã mất kết nối!');
            masterSocket = null;
        } else if (ws.slaveId) {
            console.log(`🔴 [SLAVE OUT] Đàn em [${ws.slaveId}] đã chết hoặc rớt mạng.`);
            // Xóa ngay lập tức khỏi sổ Nam Tào
            delete connectedTabs[ws.slaveId];
            
            // TỰ ĐỘNG BÁO CHO TRẠM MẸ ĐỂ TRỪ SỐ TRÊN MÀN HÌNH (Không cần bấm F5)
            if (masterSocket && masterSocket.readyState === WebSocket.OPEN) {
                masterSocket.send(JSON.stringify({ action: 'SYNC_TAB_LIST', value: Object.values(connectedTabs) }));
            }
        }
    });
});

// ==============================================================
// 💓 NHỊP TIM BẢO VỆ MẠNG (CHỐNG RAILWAY CẮT ĐIỆN GÂY LỖI 502)
// ==============================================================
const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
        // Kẻ nào ngưng tim -> Trảm ngay lập tức để giải phóng RAM
        if (ws.isAlive === false) {
            if (ws.slaveId) delete connectedTabs[ws.slaveId];
            return ws.terminate();
        }
        // Còn sống thì ép tim
        ws.isAlive = false;
        ws.ping();
    });
}, 15000); // Rút ngắn xuống 15 giây để bao sống trên mạng yếu

wss.on('close', () => clearInterval(interval));

// ==============================================================
// 🚀 KHỞI ĐỘNG ĐỘNG CƠ
// ==============================================================
server.listen(PORT, () => {
    console.log(`
   ██╗  ██╗███████╗███╗   ██╗██████╗ ██╗   ██╗
   ██║  ██║██╔════╝████╗  ██║██╔══██╗╚██╗ ██╔╝
   ███████║█████╗  ██╔██╗ ██║██║  ██║ ╚████╔╝ 
   ██╔══██║██╔══╝  ██║╚██╗██║██║  ██║  ╚██╔╝  
   ██║  ██║███████╗██║ ╚████║██████╔╝   ██║   
   ╚═╝  ╚═╝╚══════╝╚═╝  ╚═══╝╚═════╝    ╚═╝   
    `);
    console.log(`🚀 TỔNG ĐÀI HENDY VIP PRO ĐÃ SẴN SÀNG TẠI PORT ${PORT} 🚀`);
});
