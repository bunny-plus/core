import assert from "node:assert/strict";
import test from "node:test";

import { parseChatEffects } from "../src/chat-effects";

test("parses RuneScape motion and color prefixes in either order", () => {
  assert.deepEqual(parseChatEffects("wave:red:buying gf"), {
    color: "red",
    motion: "wave",
    text: "buying gf",
  });
  assert.deepEqual(parseChatEffects(":cyan::shake: hello"), {
    color: "cyan",
    motion: "shake",
    text: "hello",
  });
});

test("supports classic animated color and motion variants case-insensitively", () => {
  assert.deepEqual(parseChatEffects("GLOW2:WAVE2:Party room"), {
    color: "glow2",
    motion: "wave2",
    text: "Party room",
  });
  assert.deepEqual(parseChatEffects("flash3:slide:bank sale"), {
    color: "flash3",
    motion: "slide",
    text: "bank sale",
  });
});

test("leaves unknown prefixes and ordinary colons intact", () => {
  assert.deepEqual(parseChatEffects("hello: world"), {
    color: null,
    motion: null,
    text: "hello: world",
  });
  assert.deepEqual(parseChatEffects(":dance: nope"), {
    color: null,
    motion: null,
    text: ":dance: nope",
  });
});

test("stops parsing at a duplicate effect category", () => {
  assert.deepEqual(parseChatEffects("red:cyan:wave:shake:hello"), {
    color: "red",
    motion: null,
    text: "cyan:wave:shake:hello",
  });
});
