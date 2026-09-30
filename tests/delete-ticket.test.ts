import test from "node:test";
import assert from "node:assert/strict";
import { deleteTickets } from "../artifacts/orbitdesk/src/lib/delete-ticket.ts";

test("bulk deletion counts only confirmed successes and preserves failed IDs", async () => {
  const originalFetch = globalThis.fetch;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => null } });
  globalThis.fetch = async (input) => {
    const id = Number(String(input).split("/").at(-1));
    if (id === 1) return new Response(null, { status: 204 });
    if (id === 2) return Response.json({ error: "Your role cannot delete tickets" }, { status: 403 });
    if (id === 3) throw new Error("Network disconnected");
    return new Response("Unavailable", { status: 503 });
  };
  try {
    const result = await deleteTickets([1, 2, 3, 4]);
    assert.deepEqual(result.deleted, [1]);
    assert.deepEqual(result.failed.map((item) => item.id), [2, 3, 4]);
    assert.match(result.failed[0].error, /Your role cannot/);
    assert.match(result.failed[1].error, /Network disconnected/);
    assert.match(result.failed[2].error, /503/);
  } finally {
    globalThis.fetch = originalFetch;
    Reflect.deleteProperty(globalThis, "localStorage");
  }
});
