import test from "node:test";
import assert from "node:assert/strict";
import {
  constantTimeEqual,
  createSocketTicket,
  isBearerAuthorized,
  isValidTelegramSecret,
  verifySocketTicket
} from "../src/security.js";

test("constantTimeEqual compares equal and unequal values", () => {
  assert.equal(constantTimeEqual("abc", "abc"), true);
  assert.equal(constantTimeEqual("abc", "abd"), false);
  assert.equal(constantTimeEqual("abc", "abcd"), false);
  assert.equal(constantTimeEqual("", ""), true);
});

test("Bearer auth requires the configured token", () => {
  assert.equal(isBearerAuthorized(new Request("https://example.test", { headers: { authorization: "Bearer secret" } }), "secret"), true);
  assert.equal(isBearerAuthorized(new Request("https://example.test"), "secret"), false);
  assert.equal(isBearerAuthorized(new Request("https://example.test", { headers: { authorization: "Bearer secret" } }), ""), false);
});

test("Telegram webhook secret follows Telegram's allowed format", () => {
  assert.equal(isValidTelegramSecret("abc_DEF-123"), true);
  assert.equal(isValidTelegramSecret("bad secret"), false);
  assert.equal(isValidTelegramSecret(""), false);
});

test("socket ticket is signed, short-lived and verifiable", async () => {
  const now = 1_800_000_000_000;
  const { ticket } = await createSocketTicket("a-long-test-secret", now);
  assert.equal(await verifySocketTicket(ticket, "a-long-test-secret", now + 5_000), true);
  assert.equal(await verifySocketTicket(ticket, "wrong-secret", now + 5_000), false);
  assert.equal(await verifySocketTicket(ticket, "a-long-test-secret", now + 61_000), false);
  assert.equal(await verifySocketTicket(ticket + "x", "a-long-test-secret", now + 5_000), false);
});
