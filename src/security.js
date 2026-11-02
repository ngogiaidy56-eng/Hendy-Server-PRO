const encoder = new TextEncoder();

export function constantTimeEqual(left, right) {
  const a = String(left ?? "");
  const b = String(right ?? "");
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return mismatch === 0;
}

export function isBearerAuthorized(request, expectedToken) {
  if (!expectedToken) return false;
  const header = request.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return Boolean(match && constantTimeEqual(match[1], expectedToken));
}

function toBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function fromBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function hmacSign(data, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(data)));
}

export async function createSocketTicket(secret, now = Date.now()) {
  if (!secret) throw new Error("SOCKET_SIGNING_SECRET is not configured");
  const payload = {
    aud: "hendy-server-pro-socket",
    iat: Math.floor(now / 1000),
    exp: Math.floor(now / 1000) + 60,
    nonce: crypto.randomUUID()
  };
  const encodedPayload = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = toBase64Url(await hmacSign(encodedPayload, secret));
  return { ticket: encodedPayload + "." + signature, expiresAt: new Date(now + 60_000).toISOString() };
}

export async function verifySocketTicket(ticket, secret, now = Date.now()) {
  if (!ticket || !secret || typeof ticket !== "string") return false;
  const parts = ticket.split(".");
  if (parts.length !== 2) return false;
  try {
    const expected = toBase64Url(await hmacSign(parts[0], secret));
    if (!constantTimeEqual(parts[1], expected)) return false;
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(parts[0])));
    const nowSeconds = Math.floor(now / 1000);
    return payload.aud === "hendy-server-pro-socket" &&
      Number.isInteger(payload.exp) && payload.exp > nowSeconds &&
      Number.isInteger(payload.iat) && payload.iat <= nowSeconds + 5;
  } catch {
    return false;
  }
}

export function isValidTelegramSecret(secret) {
  return typeof secret === "string" && /^[A-Za-z0-9_-]{1,256}$/.test(secret);
}
