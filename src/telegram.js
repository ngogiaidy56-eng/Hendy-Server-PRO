export async function callTelegram(env, method, payload = {}) {
  if (!env?.BOT_TOKEN) throw new Error("BOT_TOKEN is not configured");

  const response = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000)
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.ok === false) {
    const desc = String(data.description || response.status || "Unknown Telegram error");

    // "message is not modified" is a normal Telegram API condition when editing a message to identical content.
    // It should not throw or fail the webhook execution.
    if (method === "editMessageText" && desc.toLowerCase().includes("message is not modified")) {
      return { ok: true, result: true, not_modified: true };
    }

    // If Telegram rejects entity parsing (unmatched asterisks, underscores in usernames/IDs), retry without parse_mode
    if (payload.parse_mode && desc.toLowerCase().includes("can't parse entities")) {
      const { parse_mode, ...plainPayload } = payload;
      return callTelegram(env, method, plainPayload);
    }

    throw new Error(`Telegram API ${method} failed: ${desc}`);
  }

  return data;
}
