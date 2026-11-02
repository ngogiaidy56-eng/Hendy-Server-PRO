import test from "node:test";
import assert from "node:assert/strict";
import { isAllowedMediaUrl, parseJsonObject } from "../src/validation.js";

test("media URL allowlist accepts HTTPS hosts and subdomains", () => {
  assert.equal(isAllowedMediaUrl("https://youtu.be/example"), true);
  assert.equal(isAllowedMediaUrl("https://www.youtube.com/watch?v=x"), true);
  assert.equal(isAllowedMediaUrl("https://m.tiktok.com/@user/video/1"), true);
});

test("media URL allowlist rejects unsafe or unrelated URLs", () => {
  assert.equal(isAllowedMediaUrl("http://youtube.com/watch?v=x"), false);
  assert.equal(isAllowedMediaUrl("https://youtube.com.evil.test/watch?v=x"), false);
  assert.equal(isAllowedMediaUrl("https://user:pass@youtube.com/watch?v=x"), false);
  assert.equal(isAllowedMediaUrl("javascript:alert(1)"), false);
});

test("configured media hosts replace the default allowlist", () => {
  assert.equal(isAllowedMediaUrl("https://media.example.com/video", "media.example.com"), true);
  assert.equal(isAllowedMediaUrl("https://youtube.com/watch?v=x", "media.example.com"), false);
});

test("parseJsonObject only accepts bounded JSON objects", () => {
  assert.deepEqual(parseJsonObject('{"theme":"dark"}'), { theme: "dark" });
  assert.throws(() => parseJsonObject("[]"));
  assert.throws(() => parseJsonObject("not-json"));
  assert.throws(() => parseJsonObject('{"long":"payload"}', 3));
});
