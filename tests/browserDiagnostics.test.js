const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { EventEmitter } = require("node:events");
const { chromium } = require("playwright-core");
const AdmZip = require("adm-zip");
const { captureBrowserEvents, runBrowserDiagnostics } = require("../src/browserDiagnostics");
const { diagnosticBrowser } = require("../src/siteFallback");

test("diagnostic listeners record console objects and response bodies and detach afterwards", async () => {
  const page = new EventEmitter();
  const capture = captureBrowserEvents(page);
  const request = {
    url: () => "http://localhost/chave", method: () => "POST", resourceType: () => "fetch",
    headers: () => ({ cookie: "secret", authorization: "secret", accept: "application/json" }),
    postData: () => '{"chave":"fixture"}', failure: () => ({ errorText: "net::ERR_FAILED" })
  };
  page.emit("request", request);
  page.emit("console", {
    type: () => "error", text: () => "Consulta falhou", location: () => ({ lineNumber: 1 }),
    args: () => [{ jsonValue: async () => ({ error: "pendente" }) }]
  });
  page.emit("pageerror", new Error("Excecao da pagina"));
  page.emit("requestfailed", request);
  page.emit("response", {
    request: () => request, url: request.url, status: () => 429, statusText: () => "Too Many Requests",
    headers: () => ({ "content-type": "application/json", "set-cookie": "secret", "retry-after": "5" }),
    body: async () => Buffer.from('{"message":"Limite de consultas"}')
  });
  const events = await capture.stop();
  assert.equal(events.console[0].arguments[0], '{"error":"pendente"}');
  assert.equal(events.responses[0].status, 429);
  assert.equal(events.responses[0].body, '{"message":"Limite de consultas"}');
  assert.equal(events.requests[0].headers.cookie, "[omitido]");
  assert.equal(events.responses[0].headers["set-cookie"], "[omitido]");
  assert.equal(events.requestFailures[0].failure.errorText, "net::ERR_FAILED");
  assert.match(events.pageErrors[0].stack, /Excecao da pagina/);
  for (const event of ["console", "response", "pageerror", "request", "requestfailed"]) assert.equal(page.listenerCount(event), 0);
});

test("a browser startup failure still generates a downloadable diagnostic report", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "diagnostic-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const diagnostic = await runBrowserDiagnostics({
    keys: ["35260444823938000187551090000002691092067649"], downloadsDir: directory,
    browserApi: { lookupTimeoutMs: 100, maxAttempts: 2, launchBrowser: async () => { throw new Error("Navegador indisponivel"); } }
  });
  assert.equal(diagnostic.report.results[0].errorCode, "diagnostico_interrompido");
  assert.equal(diagnostic.report.error, "Navegador indisponivel");
  const archive = new AdmZip(diagnostic.archivePath);
  assert.ok(archive.getEntry("relatorio.html"));
  assert.match(archive.readAsText("relatorio.json"), /Navegador indisponivel/);
});

const browserPath = process.env.DIAGNOSTIC_TEST_BROWSER || path.resolve(".playwright-browsers/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe");
test("headless diagnostics preserve failed attempts, network errors and evidence across multiple keys", { skip: !fsSync.existsSync(browserPath) }, async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "diagnostic-test-"));
  const keyA = "35260444823938000187551090000002691092067649";
  const keyB = "29260621444661000186550030000065351001699396";
  const counts = new Map();
  const server = http.createServer((request, response) => {
    if (request.url === "/broken") { request.socket.destroy(); return; }
    if (request.url === "/chave") {
      let body = "";
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        const { chave } = JSON.parse(body);
        counts.set(chave, (counts.get(chave) || 0) + 1);
        response.setHeader("Content-Type", "application/json");
        if (chave === keyA && counts.get(chave) === 2) response.end(JSON.stringify({ xml: "<NFe><dhEmi>2026-04-01T10:00:00-03:00</dhEmi></NFe>" }));
        else {
          response.statusCode = chave === keyA ? 503 : 202;
          response.end(JSON.stringify({ message: `Consulta em preparacao: ${chave}`, status: "pendente" }));
        }
      });
      return;
    }
    response.setHeader("Content-Type", "text/html");
    response.end(`<!doctype html><html><body><input id="accessKey"><button onclick="consultar()">Imprimir DANFE</button><p id="message"></p><script>
      async function consultar(){
        const chave=document.querySelector('#accessKey').value;
        const response=await fetch('/chave',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chave})});
        const data=await response.json();
        document.querySelector('#message').textContent=data.message||'XML retornado';
        if(!data.xml){console.error('Falha para '+chave,{status:response.status,data});fetch('/broken').catch(()=>{});setTimeout(()=>{throw new Error('Erro JavaScript para '+chave)},20);}
      }
    </script></body></html>`);
  });
  server.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const diagnostic = await runBrowserDiagnostics({
    keys: [keyA, keyB], downloadsDir: directory,
    browserApi: {
      ...diagnosticBrowser, lookupTimeoutMs: 2000, retryDelayMs: 10, maxAttempts: 2,
      launchBrowser: async () => ({ browser: await chromium.launch({ executablePath: browserPath, headless: true }), launchInfo: { channel: "test-headless" } }),
      openLookupPage: async (page) => { await page.goto(baseUrl); }
    }
  });
  const [recovered, failed] = diagnostic.report.results;
  assert.equal(recovered.status, "success");
  assert.equal(recovered.attemptCount, 2);
  assert.equal(failed.status, "error");
  assert.equal(failed.httpStatus, 202);
  assert.equal(failed.attemptCount, 1);
  const first = JSON.parse(await fs.readFile(path.join(diagnostic.directory, recovered.attempts[0].files.json), "utf8"));
  assert.ok(first.console.some((event) => event.type === "error" && event.text.includes(keyA)));
  assert.ok(first.pageErrors.some((event) => event.message.includes(keyA)));
  assert.ok(first.requestFailures.some((event) => event.url.endsWith("/broken")));
  assert.ok(first.responses.some((event) => event.status === 503 && event.body.includes(keyA)));
  const second = JSON.parse(await fs.readFile(path.join(diagnostic.directory, failed.attempts[0].files.json), "utf8"));
  assert.ok(second.responses.some((event) => event.status === 202 && event.body.includes(keyB)));
  assert.ok(!second.console.some((event) => event.text.includes(keyA)));
  assert.match(await fs.readFile(path.join(diagnostic.directory, failed.attempts[0].files.html), "utf8"), /Consulta em preparacao/);
  assert.ok((await fs.stat(path.join(diagnostic.directory, failed.attempts[0].files.screenshot))).size > 0);
  const archive = new AdmZip(diagnostic.archivePath);
  assert.ok(archive.getEntry(`${keyB}/tentativa-1.json`));
  assert.ok(archive.getEntry(`${keyA}/tentativa-1.png`));
  assert.ok(!archive.getEntry(`${keyA}/tentativa-2.json`));
  assert.deepEqual(await fs.readdir(directory), ["diagnosticos"]);
});
