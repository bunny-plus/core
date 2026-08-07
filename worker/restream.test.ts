import assert from "node:assert/strict";
import test from "node:test";

import { parseRestreamRequest, RestreamValidationError } from "./restream";

test("accepts public YouTube and Twitch URLs", () => {
  assert.deepEqual(parseRestreamRequest({ source: "https://youtu.be/abc123?t=10#chat" }), {
    platform: "youtube",
    quality: "best",
    source: "https://youtu.be/abc123?t=10",
    title: "YouTube restream",
  });
  assert.deepEqual(
    parseRestreamRequest({
      quality: "720p",
      source: "https://www.twitch.tv/bunny",
      title: "  Bunny live  ",
    }),
    {
      platform: "twitch",
      quality: "720p",
      source: "https://www.twitch.tv/bunny",
      title: "Bunny live",
    },
  );
  assert.equal(parseRestreamRequest({ source: "https://twitch.tv/bunny" }).title, "bunny");
  assert.equal(parseRestreamRequest({ source: "https://youtube.com/@bunny/live" }).title, "@bunny");
});

test("rejects unsafe and unsupported restream URLs", () => {
  for (const source of [
    "http://youtube.com/watch?v=abc",
    "https://youtube.com.evil.test/watch?v=abc",
    "https://user@twitch.tv/bunny",
    "https://127.0.0.1/live",
    "https://www.youtube.com/",
  ]) {
    assert.throws(() => parseRestreamRequest({ source }), RestreamValidationError);
  }
  assert.throws(
    () => parseRestreamRequest({ quality: "source", source: "https://twitch.tv/bunny" }),
    RestreamValidationError,
  );
});
