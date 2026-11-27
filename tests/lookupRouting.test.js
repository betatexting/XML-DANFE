const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { planLookup, processRoutedKeys } = require("../src/lookupRouting");
const { createApiQueue } = require("../src/apiRequestQueue");
const { isFallbackEligibleResult } = require("../src/lookupResult");
const keyFor = (period) => `29${period}36309104000120550010000236881000233869`;

test("routing respects the Brazilian day-15 cutoff, midnight and December/January", () => {
  assert.equal(planLookup(keyFor("2610"), new Date("2026-11-15T02:59:59Z")).method, "api");
  assert.equal(planLookup(keyFor("2610"), new Date("2026-11-15T03:00:00Z")).method, "site");
  assert.equal(planLookup(keyFor("2611"), new Date("2026-11-17T12:00:00Z")).method, "api");
  assert.equal(planLookup(keyFor("2612"), new Date("2027-01-14T12:00:00Z")).method, "api");
  assert.equal(planLookup(keyFor("2612"), new Date("2027-01-15T12:00:00Z")).method, "site");
  assert.equal(planLookup(keyFor("2506"), new Date("2026-11-17T12:00:00Z")).method, "site");
  assert.equal(planLookup(keyFor("2613")).reason, "invalid_period");
  assert.equal(planLookup("bad").method, "none");
  assert.equal(planLookup(keyFor("2612"), new Date("2026-11-17T12:00:00Z")).reason, "future_period");
  const otherModel = keyFor("2611").slice(0, 20) + "65" + keyFor("2611").slice(22);
  assert.equal(planLookup(otherModel, new Date("2026-11-17T12:00:00Z")).reason, "unsupported_model");
});

test("site keys start before the API group finishes; callbacks retain source indexes and no fake errors", async () => {
  const current = keyFor("2611"), old = keyFor("2610");
  let apiStarted = false;
  let releaseApi;
  const gate = new Promise((resolve) => { releaseApi = resolve; });
  const observed = [];
  const results = await processRoutedKeys({ keys: [current, old], now: new Date("2026-11-17T12:00:00Z"),
    apiProcessor: async ({ keys, onResult }) => {
      assert.deepEqual(keys, [current]); apiStarted = true; await gate;
      await onResult({ key: current, status: "success", lookupMode: "http-direct" });
    },
    siteProcessor: async ({ keys, onResult, onProgress }) => {
      assert.equal(apiStarted, true); assert.deepEqual(keys, [old]);
      await onProgress({ key: old, type: "attempt" });
      await onResult({ key: old, status: "success", lookupMode: "site-fallback" }); releaseApi();
    }, onResult: async (result, meta) => observed.push({ result, meta }),
    onProgress: async (_progress, meta) => assert.equal(meta.sourceIndex, 1) });
  assert.equal(observed[0].result.key, old);
  assert.deepEqual(results.map((result) => result.key), [current, old]);
  assert.equal(results[1].downloadMethod, "without-certificate-site");
  assert.equal(results[1].routing.reason, "outside_api_window");
  assert.equal(results[1].initialError, undefined);
  assert.deepEqual(observed.map((item) => item.meta.completed), [1, 2]);
});

test("one failed origin does not discard completed results from the other origin", async () => {
  const results = await processRoutedKeys({ keys: [keyFor("2611"), keyFor("2610"), "bad"], now: new Date("2026-11-17T12:00:00Z"),
    apiProcessor: async () => { throw new Error("API unavailable"); },
    siteProcessor: async ({ keys }) => keys.map((key) => ({ key, status: "success", lookupMode: "site-fallback" })) });
  assert.equal(results[0].status, "success");
  assert.equal(results[0].initialError.message, "API unavailable");
  assert.equal(results[0].routing.initialMethod, "api");
  assert.equal(results[1].status, "success");
  assert.equal(results[2].lookupMode, "input-validation");
  assert.equal(isFallbackEligibleResult(results[2]), false);
});

test("API pacing is shared across batches, respects cooldown and does not wait hours", async () => {
  let time = 1000;
  const queue = createApiQueue({ now: () => time, wait: async (ms) => { time += ms; } });
  const starts = [];
  await Promise.all(Array.from({ length: 3 }, async () => { await queue.beforeRequest(); starts.push(time); }));
  assert.equal(time, 3200);
  queue.pause(15000);
  await queue.beforeRequest();
  assert.equal(time, 18200);
  queue.pause(86400000);
  await assert.rejects(queue.beforeRequest(), (error) => error.errorCode === "api_cooldown");
  assert.equal(isFallbackEligibleResult({ key: keyFor("2611"), status: "error", lookupMode: "http-direct", httpStatus: 429 }), false);
});

test("a real API error is sent to the site once and retains the original attempts", async () => {
  const key = keyFor("2611");
  const initial = { key, status: "error", lookupMode: "http-direct", httpStatus: 503,
    errorCode: "servico_indisponivel", message: "original error", attempts: [{ attempt: 1, status: "error", httpStatus: 503 }] };
  let siteCalls = 0;
  let progressError;
  const results = await processRoutedKeys({ keys: [key], now: new Date("2026-11-17T12:00:00Z"),
    apiProcessor: async ({ onResult }) => { await onResult(initial); return [initial]; },
    siteProcessor: async ({ keys }) => { siteCalls++; assert.deepEqual(keys, [key]); return [{ key, status: "success", lookupMode: "site-fallback" }]; },
    onProgress: async (progress) => { if (progress.type === "route-fallback") progressError = progress; } });
  assert.equal(siteCalls, 1);
  assert.equal(results[0].initialError.message, "original error");
  assert.equal(results[0].fallbackHistory[0].attempts[0].httpStatus, 503);
  assert.equal(results[0].downloadMethod, "without-certificate-site");
  assert.equal(progressError.message, "original error");
});

test("manual, item, PDF and spreadsheet endpoints all apply routing before querying the origins", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "routing-api-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  process.env.DOWNLOADS_DIR = directory;
  const now = new Date();
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en", { timeZone: "America/Sao_Paulo", year: "2-digit", month: "2-digit" })
    .formatToParts(now).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const current = keyFor(parts.year + parts.month), old = keyFor("2301");
  const calls = [];
  function fake(method) {
    return async ({ keys, onResult }) => {
      calls.push({ method, keys });
      for (const key of keys) await onResult({ key, status: "success", lookupMode: method === "api" ? "http-direct" : "site-fallback" });
    };
  }
  t.mock.method(require("../src/consultaDanfe"), "processAccessKeys", fake("api"));
  t.mock.method(require("../src/siteFallback"), "processAccessKeysWithSiteFallback", fake("site"));
  t.mock.method(require("../src/pdfToXml"), "extractCandidatesFromPdfFiles", async () => [current, old].map((key) => ({ key, status: "pending" })));
  const { app } = require("../server");
  const authCookie = await require("./helpers/auth").authenticateTestApp(app, directory);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  for (const endpoint of ["/api/process", "/api/process-items", "/api/process-pdfs", "/api/process-spreadsheets"]) {
    let body, headers;
    if (endpoint.endsWith("pdfs") || endpoint.endsWith("spreadsheets")) {
      body = new FormData(); const pdf = endpoint.endsWith("pdfs");
      body.append(pdf ? "pdfs" : "spreadsheets", new Blob([pdf ? "fixture" : `Chave de Acesso\n${current}\n${old}`], { type: pdf ? "application/pdf" : "text/csv" }), pdf ? "notes.pdf" : "notes.csv");
    } else { body = JSON.stringify({ rawKeys: `${current}\n${old}`, items: [{ key: current }, { key: old }] }); headers = { "Content-Type": "application/json" }; }
    const response = await fetch(`http://127.0.0.1:${server.address().port}${endpoint}`, { method: "POST", body, headers: { ...headers, Cookie: authCookie } });
    assert.equal(response.status, 200);
    const events = (await response.text()).trim().split("\n").map(JSON.parse);
    const results = events.filter((event) => event.type === "result").map((event) => event.result);
    assert.equal(results.length, 2);
    assert.equal(results.find((result) => result.key === old).routing.method, "site");
    assert.equal(results.find((result) => result.key === current).routing.method, "api");
    const log = await fs.readFile(events.find((event) => event.type === "complete").traceFilePath, "utf8");
    assert.match(log, /outside_api_window/);
    assert.ok(!results.some((result) => result.errorCode === "data_fora_da_janela"));
  }
  assert.equal(calls.length, 8);
  assert.ok(calls.filter((call) => call.method === "api").every((call) => call.keys.length === 1 && call.keys[0] === current));
  assert.ok(calls.filter((call) => call.method === "site").every((call) => call.keys.length === 1 && call.keys[0] === old));
});
