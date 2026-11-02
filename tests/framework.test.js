import test from "node:test";
import assert from "node:assert/strict";
import { Router } from "../src/core/router.js";
import { BotDispatcher } from "../src/core/bot-dispatcher.js";

test("Router dispatches methods and extracts path parameters", async () => {
  const router = new Router();
  router.get("/health", () => Response.json({ status: "healthy" }));
  router.post("/users/:userId/items/:itemId", ({ params }) => {
    return Response.json({ userId: params.userId, itemId: params.itemId });
  });

  // Test GET /health
  const res1 = await router.handle(new Request("https://example.com/health"));
  assert.equal(res1.status, 200);
  assert.deepEqual(await res1.json(), { status: "healthy" });

  // Test POST /users/alice/items/42
  const res2 = await router.handle(new Request("https://example.com/users/alice/items/42", { method: "POST" }));
  assert.equal(res2.status, 200);
  assert.deepEqual(await res2.json(), { userId: "alice", itemId: "42" });

  // Test 404 on unmapped route
  const res3 = await router.handle(new Request("https://example.com/not-exists"));
  assert.equal(res3.status, 404);

  // Test 404 on method mismatch
  const res4 = await router.handle(new Request("https://example.com/health", { method: "POST" }));
  assert.equal(res4.status, 404);
});

test("Router executes middlewares in order and allows early return", async () => {
  const router = new Router();
  router.use(async ({ request }) => {
    if (request.headers.get("x-block")) {
      return new Response("Blocked", { status: 403 });
    }
  });

  router.get("/allowed", () => new Response("Allowed"));

  const blocked = await router.handle(new Request("https://example.com/allowed", {
    headers: { "x-block": "true" }
  }));
  assert.equal(blocked.status, 403);

  const allowed = await router.handle(new Request("https://example.com/allowed"));
  assert.equal(allowed.status, 200);
  assert.equal(await allowed.text(), "Allowed");
});

test("Router introspects registered routes", () => {
  const router = new Router();
  router.get("/a", () => {});
  router.post("/b/:id", () => {});
  const routes = router.getRegisteredRoutes();
  assert.deepEqual(routes, [
    { method: "GET", path: "/a" },
    { method: "POST", path: "/b/:id" }
  ]);
});

test("BotDispatcher routes commands and enforces permissions", async () => {
  const bot = new BotDispatcher();
  let executedCmd = null;

  bot.command("start", ({ chatId }) => {
    executedCmd = `start:${chatId}`;
  }, { description: "Start the bot" });

  bot.command("admin_panel", ({ chatId }) => {
    executedCmd = `admin:${chatId}`;
  }, { description: "Admin panel", adminOnly: true });

  const mockHelpers = {
    sendMessage: async (_env, _chatId, text) => { executedCmd = `denied:${text}`; },
    clearSession: async () => {},
    getSession: async () => null,
    upsertTelegramUser: async (_db, from) => String(from.id),
    isAdmin: (_env, id) => id === "999" // Only 999 is admin
  };

  // 1. Regular user running regular command
  await bot.dispatch(
    { message: { chat: { id: 100 }, from: { id: 123 }, text: "/start" } },
    {}, {}, mockHelpers
  );
  assert.equal(executedCmd, "start:100");

  // 2. Regular user trying to run admin command
  await bot.dispatch(
    { message: { chat: { id: 100 }, from: { id: 123 }, text: "/admin_panel" } },
    {}, {}, mockHelpers
  );
  assert.ok(executedCmd.startsWith("denied:"));

  // 3. Admin running admin command
  await bot.dispatch(
    { message: { chat: { id: 100 }, from: { id: 999 }, text: "/admin_panel" } },
    {}, {}, mockHelpers
  );
  assert.equal(executedCmd, "admin:100");
});

test("BotDispatcher auto-generates help text with role separation", () => {
  const bot = new BotDispatcher();
  bot.command("start", () => {}, { description: "Open main menu" });
  bot.command("balance", () => {}, { description: "Check balance" });
  bot.command("admin_jobs", () => {}, { description: "View jobs", adminOnly: true });

  const userHelp = bot.generateHelpText(false);
  assert.ok(userHelp.includes("/start — Open main menu"));
  assert.ok(userHelp.includes("/balance — Check balance"));
  assert.ok(!userHelp.includes("/admin_jobs")); // Hidden from regular users

  const adminHelp = bot.generateHelpText(true);
  assert.ok(adminHelp.includes("/start — Open main menu"));
  assert.ok(adminHelp.includes("/admin_jobs — View jobs")); // Visible to admins
});

test("BotDispatcher dispatches prefix and wildcard callback queries", async () => {
  const bot = new BotDispatcher();
  let callbackResult = null;

  bot.callback("menu:home", () => {
    callbackResult = "home";
  });

  bot.callback("deposit:*", ({ data }) => {
    callbackResult = `deposit:${data.replace("deposit:", "")}`;
  });

  const mockHelpers = {
    callTelegram: async () => ({ ok: true }),
    upsertTelegramUser: async () => "123",
    isAdmin: () => false
  };

  await bot.dispatch({
    callback_query: { id: "cb1", from: { id: 123 }, message: { chat: { id: 50 }, message_id: 1 }, data: "menu:home" }
  }, {}, {}, mockHelpers);
  assert.equal(callbackResult, "home");

  await bot.dispatch({
    callback_query: { id: "cb2", from: { id: 123 }, message: { chat: { id: 50 }, message_id: 1 }, data: "deposit:50000" }
  }, {}, {}, mockHelpers);
  assert.equal(callbackResult, "deposit:50000");
});
