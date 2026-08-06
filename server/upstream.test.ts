import assert from "node:assert/strict";
import test from "node:test";

import { fetchJson } from "./upstream";

test("bounded JSON fetch accepts JSON and exposes non-success status when requested", async () => {
  const fetchImplementation = async () => Response.json({ detail: "missing" }, { status: 404 });
  const result = await fetchJson<{ detail: string }>("https://example.test", {
    fetch: fetchImplementation,
    name: "Example",
    requireOk: false,
    timeoutMs: 100,
  });
  assert.equal(result.response.status, 404);
  assert.equal(result.data.detail, "missing");
});

test("bounded JSON fetch rejects invalid content types and oversized bodies with stable errors", async () => {
  await assert.rejects(
    fetchJson("https://example.test", {
      fetch: async () => new Response("{}", { headers: { "Content-Type": "text/plain" } }),
      name: "Example",
      timeoutMs: 100,
    }),
    { message: "Example returned an invalid response" },
  );
  await assert.rejects(
    fetchJson("https://example.test", {
      fetch: async () => Response.json({ value: "too long" }),
      maxBytes: 4,
      name: "Example",
      timeoutMs: 100,
    }),
    { message: "Example response was too large" },
  );
});
