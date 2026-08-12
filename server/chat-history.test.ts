import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ChatHistory } from "./chat-history";

const member = { admin: false, avatar: null, id: "viewer-1", name: "Viewer" };

function chat(index: number) {
  return {
    createdAt: `2026-08-12T12:00:${String(index).padStart(2, "0")}.000Z`,
    id: `chat-${index}`,
    member,
    message: `message ${index}`,
    type: "chat" as const,
    x: 42,
  };
}

test("chat history survives a new database connection", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bunny-chat-"));
  const file = join(directory, "history.sqlite");
  const history = new ChatHistory(file, 200);

  history.append(chat(1));
  history.close();

  const restored = new ChatHistory(file, 200);
  assert.deepEqual(restored.all(), [chat(1)]);
  restored.close();
});

test("chat history keeps only the newest configured number of messages", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bunny-chat-"));
  const history = new ChatHistory(join(directory, "history.sqlite"), 2);

  history.append(chat(1));
  history.append(chat(2));
  history.append(chat(3));

  assert.deepEqual(history.all(), [chat(2), chat(3)]);
  history.close();
});

test("chat history returns messages in chronological order", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bunny-chat-"));
  const history = new ChatHistory(join(directory, "history.sqlite"), 200);

  history.append(chat(2));
  history.append(chat(1));

  assert.deepEqual(history.all(), [chat(1), chat(2)]);
  history.close();
});

test("chat history preserves arrival order for matching timestamps", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bunny-chat-"));
  const history = new ChatHistory(join(directory, "history.sqlite"), 200);
  const first = { ...chat(1), id: "z-first" };
  const second = { ...chat(1), id: "a-second" };

  history.append(first);
  history.append(second);

  assert.deepEqual(history.all(), [first, second]);
  history.close();
});
