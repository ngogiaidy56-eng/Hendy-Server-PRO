const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 8080;

// ==============================================================
// 🧠 CỤC RAM VĨNH CỬU (ĐÃ NÂNG CẤP CHIA LUỒNG)
// ==============================================================
// Cấu trúc: { "id_dan_em": { name: "...", channel: "KENH-1", ... } }
let connectedTabs = {}; 

// ==============================================================
// 🌐 GIAO DIỆN GIÁM SÁT TRÊN TRÌNH DUYỆT (DASHBOARD)
// ==============================================================
app.get('/', (req, res) => {
    // Đếm số lượng luồng đang hoạt động
    const activeChannels = [...new Set(Object.values(connectedTabs).map(t => t.channel))];
    const masterCount = Array.from(wss.clients).filter(c => c.isMaster).length;

    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>TRẠM VŨ TRỤ HENDY 5.2</title>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
                @import url('https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@400;700&display=swap');
                body { background: #050208; color: #00e5ff; font-family: 'Chakra Petch', sans-serif; text-align: center; padding-top: 50px; }
                .box { border: 2px solid #c840ff; padding: 30px; border-radius: 10px; display: inline-block; box-shadow: 0 0 30px rgba(200,64,255,0.4); background: rgba(10,4,16,0.9); min-width: 400px; }
                h1 { color: #ffcc00; text-shadow: 0 0 10px rgba(255,204,0,0.5); font-size: 28px; margin-top: 0;}
                .status { font-size: 18px; font-weight: bold; margin: 15px 0; border-bottom: 1px dashed #333; padding-bottom: 10px;}
                .online { color: #00ffcc; text-shadow: 0 0 10px rgba(0,255,204,0.5); }
                .count { font-size: 50px; color: #fff; margin: 10px 0; font-weight: bold; text-shadow: 0 0 20px #00e5ff;}
                .stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-top: 20px;}
                .stat-box { background: #000; border: 1px solid #555; padding: 15px; border-radius: 8px; }
            </style>
        </head>
        <body>
            <div class="box">
                <h1>🚀 TỔNG ĐÀI HENDY CYBERPUNK 5.2 🚀</h1>
                
                <div class="status">Trạm Mẹ (Master) Online: <span class="online">${masterCount}</span></div>
                
                <div class="stat-grid">
                    <div class="stat-box">
                        <div style="color: #aaa; font-size: 14px;">Đàn Em Đang Sống</div>
                        <div class="count">${Object.keys(connectedTabs).length}</div>
                    </div>
                    <div class="stat-box" style="border-color: #ffcc00;">
                        <div style="color: #ffcc00; font-size: 14px;">Luồng (Channel) Kích Hoạt</div>
                        <div class="count" style="color:#ffcc00; text-shadow: 0 0 20px #ffcc00;">${activeChannels.length}</div>
                    </div>
                </div>

                <div style="color: #555; font-size: 12px; margin-top: 25px;">Trạng thái Server: BẤT TỬ | Cổng: ${PORT}</div>
            </div>
        </body>
        </html>
    `);
});

// Hàm dùng để gửi cập nhật danh sách Đàn Em cho các Trạm Mẹ trong cùng Luồng
function broadcastTabList(channel) {
    const tabsInChannel = Object.values(connectedTabs).filter(t => t.channel === channel);
    const payload = JSON.stringify({ action: 'SYNC_TAB_LIST', value: tabsInChannel, channel: channel });
    
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client.isMaster && client.channel === channel) {
            client.send(payload);
        }
    });
}

// ==============================================================
// ⚡ XỬ LÝ GIAO TIẾP WEBSOCKET (ĐÃ FIX PHÂN LUỒNG)
// ==============================================================
wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.channel = 'KENH-1'; // Luồng mặc định
    ws.isMaster = false;

    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            const action = data.action;
            
            // Cập nhật luồng cho Socket nếu client có gửi kèm
            const channel = data.channel || ws.channel || 'KENH-1';
            ws.channel = channel; 

            // 1. TRẠM MẸ PHÁT TÍN HIỆU TÌM ĐÀN EM HOẶC XƯNG DANH
            if (action === 'SYNC_PING_REQUEST' || action === 'SYNC_REGISTER_MASTER') {
                ws.isMaster = true; // Đóng dấu là Trạm Mẹ
                
                // Trả về danh sách Tab theo Luồng của Trạm Mẹ này
                const tabsInChannel = Object.values(connectedTabs).filter(t => t.channel === channel);
                ws.send(JSON.stringify({ action: 'SYNC_TAB_LIST', value: tabsInChannel, channel: channel }));
                
                // NẾU LÀ PING: Lan truyền sóng Ping ra cho các Đàn Em trong luồng nghe thấy để báo danh lại
                if (action === 'SYNC_PING_REQUEST') {
                    wss.clients.forEach((client) => {
                        if (client !== ws && client.readyState === WebSocket.OPEN && client.channel === channel) {
                            client.send(message.toString());
                        }
                    });
                }
                return;
            }

            // 2. ĐÀN EM BÁO CÁO TÌNH HÌNH & XƯNG DANH
            if (action === 'SYNC_REGISTER_TAB' || action === 'SYNC_PING_RESPONSE') {
                if (data.value && data.value.id) {
                    ws.slaveId = data.value.id; // Dán mác ID Đàn em cho socket này
                    
                    // Ghi sổ Nam Tào kèm theo Luồng
                    connectedTabs[ws.slaveId] = { ...data.value, channel: channel };
                    
                    // Phát lệnh cập nhật UI về cho Trạm Mẹ của luồng này
                    broadcastTabList(channel);
                }
                return;
            }

            // 3. TRẠM MẸ CHỦ ĐỘNG YÊU CẦU DANH SÁCH
            if (action === 'SYNC_REQUEST_TAB_LIST') {
                const tabsInChannel = Object.values(connectedTabs).filter(t => t.channel === channel);
                ws.send(JSON.stringify({ action: 'SYNC_TAB_LIST', value: tabsInChannel, channel: channel }));
                return;
            }

            // 4. CHUYỂN PHÁT NHANH CÁC LỆNH KHÁC (BẮN, AUTO, CƯỚP, CHAT...) TRONG CÙNG LUỒNG
            wss.clients.forEach((client) => {
                // Chỉ gửi lệnh nếu client không phải là người gửi và NẰM CÙNG LUỒNG
                if (client !== ws && client.readyState === WebSocket.OPEN && client.channel === channel) {
                    client.send(message.toString());
                }
            });

        } catch (err) {
            // Im lặng bỏ qua rác
        }
    });

    // 5. XỬ LÝ KHI CÓ KẺ RỚT MẠNG HOẶC TẮT TAB
    ws.on('close', () => {
        if (ws.slaveId && connectedTabs[ws.slaveId]) {
            const ch = connectedTabs[ws.slaveId].channel; // Lấy kênh của Đàn em vừa chết
            delete connectedTabs[ws.slaveId]; // Xóa khỏi sổ
            
            // TỰ ĐỘNG BÁO CHO TRẠM MẸ CỦA KÊNH ĐÓ ĐỂ CẬP NHẬT UI
            broadcastTabList(ch);
        }
    });
});

// ==============================================================
// 💓 NHỊP TIM BẢO VỆ MẠNG (TỰ ĐỘNG XÓA XÁC CHẾT KHỎI RAM)
// ==============================================================
const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
        // Nếu qua 15s không có hồi âm Pong -> Lôi ra chém
        if (ws.isAlive === false) {
            if (ws.slaveId && connectedTabs[ws.slaveId]) {
                const ch = connectedTabs[ws.slaveId].channel;
                delete connectedTabs[ws.slaveId];
                broadcastTabList(ch); // Cập nhật lại Trạm Mẹ
            }
            return ws.terminate();
        }
        
        // Vẫn sống thì đặt cờ chờ ép tim lại
        ws.isAlive = false;
        ws.ping();
    });
}, 15000); 

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
    console.log(`🚀 TỔNG ĐÀI HENDY 5.2 ĐÃ SẴN SÀNG TẠI PORT ${PORT} 🚀`);
});
