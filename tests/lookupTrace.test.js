const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { traceResult, createTrace } = require("../src/lookupTrace");
const { processAccessKeys } = require("../src/consultaDanfe");

test("persistent events are complete under concurrent writes and omit secrets recursively", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "lookup-trace-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const trace = await createTrace(directory, "test");
  const result = traceResult({ key: "test", status: "success", certificatePassphrase: "secret", xml: "secret",
    initialError: { status: "error", message: "first", pfx: "secret" },
    fallbackHistory: [{ status: "error", xml: "secret" }], attempts: [{ status: "success", durationMs: 3, token: "secret" }] });
  await Promise.all(Array.from({ length: 20 }, (_, index) => trace.append({ index, result })));
  const text = await fs.readFile(trace.filePath, "utf8");
  const events = text.trim().split("\n").map(JSON.parse);
  assert.equal(events.length, 20);
  assert.equal(new Set(events.map((event) => event.index)).size, 20);
  assert.doesNotMatch(text, /secret/);
  assert.equal(events[0].result.initialError.message, "first");
});

test("API retry success preserves the initial failed attempt with timings and HTTP", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "lookup-retry-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let requests = 0;
  t.mock.method(global, "fetch", async () => {
    requests++;
    return requests === 1
      ? new Response(JSON.stringify({ error: "temporario", message: "Initial unavailable" }), { status: 503 })
      : new Response(JSON.stringify({ xml: "<NFe/>" }), { status: 200 });
  });
  const progress = [];
  const [result] = await processAccessKeys({ keys: ["35260444823938000187551090000002691092067649"], downloadsDir: directory,
    onProgress: async (event) => progress.push(event) });
  assert.equal(result.status, "success");
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0].httpStatus, 503);
  assert.equal(result.initialError.httpStatus, 503);
  assert.equal(result.attempts[0].message, "Initial unavailable");
  assert.equal(result.attempts[1].status, "success");
  assert.ok(result.attempts.every((attempt) => attempt.startedAt && attempt.finishedAt && attempt.durationMs >= 0));
  assert.equal(progress.filter((event) => event.type === "attempt-result").length, 1);
});
