const fs = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");
const AdmZip = require("adm-zip");
const { diagnosticBrowser } = require("./siteFallback");
const { getIssueDateFromXml } = require("./accessKeys");

const MAX_EVENTS = 500;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BODY_BYTES = 8 * 1024 * 1024;
const MAX_TEXT_LENGTH = 16000;
const SETTLE_MS = 1500;
const BODY_WAIT_MS = 5000;

function shorten(value) {
  const text = String(value ?? "");
  return text.length > MAX_TEXT_LENGTH ? `${text.slice(0, MAX_TEXT_LENGTH)}\n[Texto truncado]` : text;
}

function safeHeaders(headers) {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [
    key, /^(authorization|proxy-authorization|cookie|set-cookie)$/i.test(key) ? "[omitido]" : value
  ]));
}

// Listeners exist only during a diagnostic attempt, on a fresh page for each key.
function captureBrowserEvents(page) {
  const data = { console: [], pageErrors: [], requests: [], responses: [], requestFailures: [], captureWarnings: [] };
  const pending = new Set();
  let bodyBytes = 0;
  let stopped = false;
  const requestIds = new WeakMap();
  let nextRequestId = 0;
  const requestId = (request) => {
    if (!requestIds.has(request)) requestIds.set(request, ++nextRequestId);
    return requestIds.get(request);
  };
  const add = (list, value) => {
    if (list.length < MAX_EVENTS) list.push(value);
    else if (!data.captureWarnings.includes("Limite de eventos atingido.")) data.captureWarnings.push("Limite de eventos atingido.");
  };
  const track = (operation) => {
    const task = operation.catch((error) => data.captureWarnings.push(shorten(error.message)));
    pending.add(task);
    task.finally(() => pending.delete(task));
  };
  const timestamp = () => new Date().toISOString();
  const onConsole = (message) => {
    const entry = { time: timestamp(), type: message.type(), text: shorten(message.text()), location: message.location() };
    add(data.console, entry);
    track((async () => {
      entry.arguments = await Promise.all(message.args().map(async (argument) => {
        try { return shorten(JSON.stringify(await argument.jsonValue())); }
        catch (error) { return `[Argumento indisponivel: ${shorten(error.message)}]`; }
      }));
    })());
  };
  const onPageError = (error) => add(data.pageErrors, { time: timestamp(), message: shorten(error.message), stack: shorten(error.stack) });
  const onRequest = (request) => add(data.requests, {
    id: requestId(request), time: timestamp(), url: request.url(), method: request.method(), resourceType: request.resourceType(),
    headers: safeHeaders(request.headers()), postData: shorten(request.postData())
  });
  const onRequestFailed = (request) => add(data.requestFailures, {
    requestId: requestId(request), time: timestamp(), url: request.url(), method: request.method(), failure: request.failure(), timing: request.timing?.()
  });
  const onResponse = (response) => {
    const request = response.request();
    const headers = response.headers();
    const entry = {
      requestId: requestId(request), time: timestamp(), url: response.url(), method: request.method(), status: response.status(),
      statusText: response.statusText(), resourceType: request.resourceType(), headers: safeHeaders(headers)
    };
    if (data.responses.length >= MAX_EVENTS) {
      add(data.responses, entry);
      return;
    }
    add(data.responses, entry);
    const contentType = headers["content-type"] || "";
    const relevant = ["document", "xhr", "fetch"].includes(request.resourceType()) || response.status() >= 400;
    const textual = /text|json|xml|javascript|html/i.test(contentType);
    if (!relevant || (!textual && !/\/chave(?:[/?#]|$)/.test(response.url()))) {
      entry.bodyOmitted = "Recurso binario ou estatico sem erro.";
      return;
    }
    track((async () => {
      let timer;
      try {
        const body = await Promise.race([
          response.body(),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Tempo limite ao ler corpo da resposta.")), BODY_WAIT_MS); })
        ]);
        const available = Math.max(0, Math.min(MAX_BODY_BYTES, MAX_TOTAL_BODY_BYTES - bodyBytes));
        const captured = body.subarray(0, available);
        bodyBytes += captured.length;
        entry.body = captured.toString("utf8");
        entry.bodyBytes = body.length;
        entry.bodyTruncated = body.length > captured.length;
        entry.timing = request.timing?.();
      } catch (error) {
        entry.bodyError = shorten(error.message);
      } finally {
        clearTimeout(timer);
      }
    })());
  };
  const listeners = { console: onConsole, pageerror: onPageError, request: onRequest, response: onResponse, requestfailed: onRequestFailed };
  for (const [event, handler] of Object.entries(listeners)) page.on(event, handler);
  return {
    data,
    async stop() {
      if (stopped) return data;
      stopped = true;
      for (const [event, handler] of Object.entries(listeners)) page.off(event, handler);
      await Promise.allSettled([...pending]);
      return data;
    }
  };
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
}

function buildHtmlReport(report) {
  const rows = report.results.map((result) => `<tr><td>${escapeHtml(result.key)}</td><td>${result.status === "success" ? "XML retornado" : "Erro"}</td><td>${escapeHtml(result.message || "")}</td><td>${result.attempts.map((attempt) => {
    const label = `Tentativa ${attempt.number}: ${attempt.status === "success" ? "XML retornado" : "erro"} (${attempt.durationMs} ms)`;
    return `<p>${escapeHtml(label)}${attempt.files ? ` — <a href="${attempt.files.json}">Console e rede</a>${attempt.files.html ? ` · <a href="${attempt.files.html}">HTML da pagina</a>` : ""}${attempt.files.screenshot ? ` · <a href="${attempt.files.screenshot}">Captura da tela</a>` : ""}` : ""}</p>`;
  }).join("")}</td></tr>`).join("");
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Diagnostico das consultas</title><style>body{font:15px Arial,sans-serif;color:#18212b;margin:32px;line-height:1.5}table{border-collapse:collapse;width:100%}th,td{text-align:left;vertical-align:top;border:1px solid #ccd3dc;padding:12px}th{background:#edf2f7}td:first-child{overflow-wrap:anywhere}a{color:#1456a0}p{margin:8px 0}</style></head><body><h1>Diagnostico das consultas</h1><p>Inicio: ${escapeHtml(report.startedAt)} · Fim: ${escapeHtml(report.finishedAt)}</p><p>${report.results.length} chaves · ${report.results.filter((r) => r.status === "success").length} XMLs retornados · ${report.results.filter((r) => r.status === "error").length} erros.</p><p>Consulta direta pelo site em navegador headless. Datas e eventos em UTC. Cada tentativa com erro possui console, rede, HTML e imagem quando a captura foi possivel. XMLs retornados nao foram salvos como downloads de notas.</p><p>Navegador: ${escapeHtml(report.browser?.channel || "indisponivel")} ${escapeHtml(report.browser?.version || "")} · Tempo limite por operacao: ${report.settings.timeoutMs} ms · Maximo de tentativas: ${report.settings.maxAttempts}.</p><p>Limites por tentativa: ${MAX_EVENTS} eventos de cada categoria, 2 MiB por corpo e 8 MiB de corpos no total. Truncamentos e falhas de captura sao indicados no JSON.</p><table><thead><tr><th>Chave</th><th>Resultado</th><th>Mensagem final</th><th>Evidencias</th></tr></thead><tbody>${rows}</tbody></table><p><a href="relatorio.json">Relatorio completo em JSON</a></p></body></html>`;
}

async function saveFailedAttempt(page, capture, attempt, directory, key) {
  const base = `${key}/tentativa-${attempt.number}`;
  const absoluteBase = path.join(directory, key, `tentativa-${attempt.number}`);
  await fs.mkdir(path.dirname(absoluteBase), { recursive: true });
  attempt.files = { json: `${base}.json` };
  attempt.captureWarnings = [];
  await page.waitForTimeout(SETTLE_MS).catch((error) => attempt.captureWarnings.push(shorten(error.message)));
  attempt.pageUrl = page.url();
  try {
    await fs.writeFile(`${absoluteBase}.html`, await page.content(), "utf8");
    attempt.files.html = `${base}.html`;
  } catch (error) { attempt.captureWarnings.push(`HTML: ${shorten(error.message)}`); }
  try {
    await page.screenshot({ path: `${absoluteBase}.png`, fullPage: true, timeout: BODY_WAIT_MS });
    attempt.files.screenshot = `${base}.png`;
  } catch (error) { attempt.captureWarnings.push(`Imagem: ${shorten(error.message)}`); }
  const events = await capture.stop();
  attempt.captureFinishedAt = new Date().toISOString();
  await fs.writeFile(`${absoluteBase}.json`, `${JSON.stringify({ key, ...attempt, ...events }, null, 2)}\n`, "utf8");
}

async function runBrowserDiagnostics({ keys, downloadsDir, onResult, onProgress, browserApi = diagnosticBrowser }) {
  const id = randomUUID();
  const parentDirectory = path.join(downloadsDir, "diagnosticos");
  const directory = path.join(parentDirectory, id);
  await fs.mkdir(directory, { recursive: true });
  const report = {
    id, startedAt: new Date().toISOString(), results: [],
    appVersion: require("../package.json").version,
    settings: { timeoutMs: browserApi.lookupTimeoutMs, maxAttempts: browserApi.maxAttempts, retryDelayMs: browserApi.retryDelayMs, settleMs: SETTLE_MS }
  };
  let browser;
  let context;
  try {
    const launched = await browserApi.launchBrowser();
    browser = launched.browser;
    report.browser = { ...launched.launchInfo, version: browser.version() };
    context = await browserApi.createBrowserContext(browser);
    for (const [index, key] of keys.entries()) {
      const page = await context.newPage();
      page.setDefaultTimeout(browserApi.lookupTimeoutMs);
      page.setDefaultNavigationTimeout(browserApi.lookupTimeoutMs);
      const result = { key, status: "error", lookupMode: "site-fallback", attempts: [] };
      try {
        for (let number = 1; number <= browserApi.maxAttempts; number += 1) {
          const capture = captureBrowserEvents(page);
          const started = Date.now();
          const attempt = { number, startedAt: new Date().toISOString() };
          let error;
          try {
            await onProgress?.({ type: "attempt", key, attempt: number, maxAttempts: browserApi.maxAttempts });
            attempt.stage = "abrir-pagina";
            await browserApi.openLookupPage(page);
            attempt.stage = "preencher-chave";
            await browserApi.typeAccessKey(page, key);
            attempt.stage = "consultar-chave";
            const xml = await browserApi.requestXmlForKey(page);
            result.status = "success";
            delete result.httpStatus;
            delete result.errorCode;
            result.documentIssueDate = getIssueDateFromXml(xml);
            result.fileName = "XML retornado na consulta diagnostica";
            result.message = "O site retornou XML nesta consulta.";
            attempt.status = "success";
          } catch (caught) {
            error = caught;
            attempt.status = "error";
            attempt.message = caught.message;
            attempt.errorName = caught.name;
            attempt.stack = shorten(caught.stack);
            attempt.httpStatus = caught.httpStatus || null;
            attempt.errorCode = caught.errorCode || "";
            result.message = caught.message;
            result.httpStatus = caught.httpStatus || null;
            result.errorCode = caught.errorCode || "";
          } finally {
            attempt.durationMs = Date.now() - started;
            attempt.finishedAt = new Date().toISOString();
            try {
              if (error) await saveFailedAttempt(page, capture, attempt, directory, key);
            } catch (captureError) {
              attempt.captureError = captureError.message;
            } finally {
              await capture.stop();
            }
            result.attempts.push(attempt);
          }
          if (!error || error.retryable === false || number === browserApi.maxAttempts) break;
          await page.waitForTimeout(browserApi.retryDelayMs);
        }
      } finally {
        await page.close().catch(() => {});
      }
      result.attemptCount = result.attempts.length;
      report.results.push(result);
      await onResult?.(result, { completed: index + 1, total: keys.length });
    }
  } catch (error) {
    report.error = error.message;
    for (const key of keys.slice(report.results.length)) {
      const result = { key, status: "error", lookupMode: "site-fallback", message: error.message, attempts: [], errorCode: "diagnostico_interrompido" };
      report.results.push(result);
      await onResult?.(result, { completed: report.results.length, total: keys.length });
    }
  } finally {
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }
  report.finishedAt = new Date().toISOString();
  await fs.writeFile(path.join(directory, "relatorio.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(directory, "relatorio.html"), buildHtmlReport(report), "utf8");
  const archivePath = path.join(parentDirectory, `diagnostico-${id}.zip`);
  const archive = new AdmZip();
  archive.addLocalFolder(directory);
  await archive.writeZipPromise(archivePath);
  return { id, directory, archivePath, report };
}

module.exports = { captureBrowserEvents, runBrowserDiagnostics };
