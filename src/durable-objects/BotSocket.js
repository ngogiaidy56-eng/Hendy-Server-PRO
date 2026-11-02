import { verifySocketTicket, constantTimeEqual } from "../security.js";

export class BotSocket {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/publish" && request.method === "POST") {
      const supplied = request.headers.get("x-internal-secret") || "";
      if (!this.env.INTERNAL_API_SECRET || !constantTimeEqual(supplied, this.env.INTERNAL_API_SECRET)) {
        return new Response("Unauthorized", { status: 401 });
      }
      const event = await request.json().catch(() => null);
      if (!event || typeof event.type !== "string") {
        return new Response("Invalid event", { status: 400 });
      }
      const payload = JSON.stringify({ ...event, emittedAt: new Date().toISOString() });
      let delivered = 0;
      for (const socket of this.state.getWebSockets()) {
        try {
          socket.send(payload);
          delivered += 1;
        } catch {
          try { socket.close(1011, "delivery failed"); } catch {}
        }
      }
      return Response.json({ ok: true, delivered });
    }

    if (url.pathname !== "/ws" || request.method !== "GET") {
      return new Response("Not Found", { status: 404 });
    }
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }
    const valid = await verifySocketTicket(url.searchParams.get("ticket"), this.env.SOCKET_SIGNING_SECRET);
    if (!valid) return new Response("Unauthorized", { status: 401 });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);
    server.send(JSON.stringify({ type: "connected", emittedAt: new Date().toISOString() }));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket, message) {
    if (message === "ping") {
      socket.send(JSON.stringify({ type: "pong", emittedAt: new Date().toISOString() }));
    }
  }

  async webSocketClose(socket) {
    try { socket.close(); } catch {}
  }

  async webSocketError(socket) {
    try { socket.close(1011, "socket error"); } catch {}
  }
}
