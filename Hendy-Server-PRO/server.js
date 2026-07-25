const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const app = express();

// 🔥 1. GIAO DIỆN HTTP CHỐNG NGỦ ĐÔNG (PING-PONG KEEP ALIVE) 🔥
app.get('/', (req, res) => {
    res.status(200).send(`
        <html>
            <head><title>HENDY CYBERPUNK SERVER</title></head>
            <body style="background: #050208; color: #00e5ff; font-family: monospace; text-align: center; padding-top: 15%;">
                <h1 style="color: #ffcc00; text-shadow: 0 0 10px #ffcc00;">🚀 TỔNG ĐÀI HENDY CYBERPUNK [VIP PRO] 🚀</h1>
                <h2>Trạng thái: <span style="color: #0f9;">ĐANG HOẠT ĐỘNG ONLINE</span></h2>
                <p style="color: #c840ff;">Số lượng Đàn Em đang kết nối: ${wss ? wss.clients.size : 0}</p>
                <div style="margin-top: 30px; font-size: 12px; color: #555;">Cyberpunk Core Engine v2.0 - Running on Port ${PORT}</div>
            </body>
        </html>
    `);
});

const server = http.createServer(app);

// 🔥 2. KHỞI TẠO WEBSOCKET CHỊU TẢI CAO 🔥
const wss = new WebSocketServer({ server });

// 🔥 3. THUẬT TOÁN DỌN RÁC (HEARTBEAT) - GIẢI PHÓNG RAM 🔥
const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            console.log('\x1b[31m[DỌN RÁC]\x1b[0m Đã ngắt kết nối 1 Tab bị treo/đóng.');
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
    });
}, 30000); // Quét mỗi 30 giây

wss.on('connection', (ws, req) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; }); // Phản hồi nhịp tim

    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    console.log(`\x1b[32m[KẾT NỐI MỚI]\x1b[0m Client IP: ${ip} | Tổng mạng lưới: ${wss.clients.size} thiết bị`);

    // Xử lý khi nhận được dữ liệu từ Master hoặc Đàn em
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            // Console log màu sắc để Master dễ giám sát lệnh
            if (data.action && data.action !== 'SYNC_PING_REQUEST' && data.action !== 'SYNC_REGISTER_TAB') {
                console.log(`\x1b[36m[PHÁT LỆNH]\x1b[0m Lệnh: \x1b[33m${data.action}\x1b[0m | Từ: ${data.sourceId || 'Master'}`);
            }

            // Gửi dữ liệu này tới TẤT CẢ các thiết bị khác (Trừ thằng vừa gửi)
            wss.clients.forEach((client) => {
                if (client !== ws && client.readyState === 1) { // 1 = OPEN
                    client.send(message.toString());
                }
            });
        } catch (err) {
            console.error(`\x1b[31m[LỖI DỮ LIỆU]\x1b[0m Phát hiện gói tin không hợp lệ!`);
        }
    });

    ws.on('close', () => {
        console.log(`\x1b[31m[NGẮT KẾT NỐI]\x1b[0m Còn lại: ${wss.clients.size} thiết bị`);
    });
});

wss.on('close', () => {
    clearInterval(interval);
});

// Khởi động Động cơ
server.listen(PORT, () => {
    console.log(`\x1b[36m
   ██╗  ██╗███████╗███╗   ██╗██████╗ ██╗   ██╗
   ██║  ██║██╔════╝████╗  ██║██╔══██╗╚██╗ ██╔╝
   ███████║█████╗  ██╔██╗ ██║██║  ██║ ╚████╔╝ 
   ██╔══██║██╔══╝  ██║╚██╗██║██║  ██║  ╚██╔╝  
   ██║  ██║███████╗██║ ╚████║██████╔╝   ██║   
   ╚═╝  ╚═╝╚══════╝╚═╝  ╚═══╝╚═════╝    ╚═╝   
    \x1b[0m`);
    console.log(`\x1b[33m[VIP PRO SERVER]\x1b[0m Động cơ đã nổ tại Port ${PORT}! Sẵn sàng đón bão...`);
});