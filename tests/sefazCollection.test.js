const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const express = require("express");
const { chromium } = require("playwright-core");
const XLSX = require("xlsx");
const { parsePortalSpreadsheet, validNfeKey } = require("../src/portalSpreadsheet");
const { collectSefazBa } = require("../src/sefazBaPortal");
const { createKeyCollection, installKeyCollectionRoutes } = require("../src/keyCollection");
const { createCompanyCatalog, installCompanyRoutes } = require("../src/companyCatalog");
const { installAuth } = require("../src/authRoutes");
const key = "29261014078646000104550050000078661136729035";
const other = "35261014078646000104550050000078671112655761";
const csv = `Chave de Acesso;Data de Autorização;Situação\r\n${key};18/11/2026;Autorizada\r\n${other};18/11/2026;Cancelada\r\n${key};18/11/2026;Autorizada\r\n`;
const executablePath = path.resolve(".playwright-browsers/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe");
const company = { id: "a", legalName: "Empresa teste", cnpj: "14078646000104" };
const catalog = { list: async () => ({ companies: [company, { id: "b", legalName: "Outra empresa" }] }) };
async function temp(t) { const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sefaz-collection-")); t.after(() => fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })); return dir; }
async function waitJob(api, id, predicate = (job) => ["completed", "empty", "partial", "failed", "cancelled"].includes(job.status)) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) { const job = await api.job(id); if (predicate(job)) return job; await new Promise((resolve) => setTimeout(resolve, 50)); }
  throw new Error("Job did not reach expected state");
}
async function portal(t, flags = {}) {
  let logins = 0, downloads = 0;
  const app = express(); app.use(express.urlencoded({ extended: false }));
  const reportPath = "/servicos/nfenc/Modulos/Autenticado/Restrito/NFENC_consulta_:direction.aspx";
  app.get("/servicos/NFENC/SSL/ASLibrary/Login", (_req, res) => res.send(`<form method="post" action="/login"><input id="PHCentro_userLogin" name="login"><input id="PHCentro_userPass" name="password" type="password"><button id="PHCentro_btnLogin">Entrar</button></form>`));
  app.post("/login", (req, res) => { logins++; if (flags.badLogin) return res.send('<p id="msgDetalhesErro">Credenciais inválidas</p>'); res.cookie("authenticated", "yes"); res.redirect("/servicos/nfenc/Modulos/Autenticado/Restrito/NFENC_consulta_emitente.aspx"); });
  app.get(reportPath, (req, res) => {
    if (!req.headers.cookie?.includes("authenticated=yes")) return res.redirect("/servicos/NFENC/SSL/ASLibrary/Login");
    let result = "";
    if (req.query.run) {
      if (flags.limit && (req.query.from !== req.query.to || (flags.oneDayLimit && req.query.from === "19/11/2026"))) result = '<script>window.onload=()=>alert("Quantidade de registros supera o limite da pagina")</script>';
      else if (flags.captcha && req.query.answer !== "ABCDE") result = '<script>window.onload=()=>alert("captcha invalido")</script>';
      else if (flags.empty) result = '<p id="lblConsultaVazia">Sem notas</p>';
      else result = `<button id="btn_GerarPlanilha" onclick="location.href='/export/${req.params.direction}'">Gerar Planilha</button>`;
      if (flags.mdfe && result.includes("btn_GerarPlanilha")) {
        const first = req.query.page !== "2";
        result += `<span id="lblPagina">Página ${first ? 1 : 2} de 2</span>
          <table id="Grid"><tr><td><a target="_blank" href="/note/${first ? "found" : "empty"}">123</a></td>
          <td>${first ? key : other}</td></tr></table>
          <a href="javascript:__doPostBack('grid','Page$2')">2</a>
          <script>function __doPostBack(){ const url=new URL(location.href); url.searchParams.set('page','2'); location.href=url.href; }</script>`;
      }
    }
    const captcha = flags.captcha ? `<img id="img_captcha" width="160" height="40" src="data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="40"><rect width="160" height="40" fill="white"/><text x="5" y="30" fill="black" font-size="25">ABCDE</text></svg>')}"><input id="txt_cod_antirobo" name="answer">` : "";
    res.send(`<form method="get"><input id="rbt_filtro3" type="radio" name="filter"><input id="txtPeriodoInicial" name="from"><input id="txtPeriodoFinal" name="to">${captcha}<button id="AplicarFiltro" name="run" value="1">Consultar</button></form>${result}`);
  });
  app.get("/export/:direction", (req, res) => { downloads++; res.set("Content-Disposition", `attachment; filename="rpt_cons_${req.params.direction}.csv"`).type("text/csv").send(flags.headerOnly ? csv.split("\r\n")[0] + "\r\n" : csv); });
  app.get("/note/:kind", (req, res) => res.send(`<button id="btnNFEDetalhada" onclick="document.querySelector('table').hidden=false">Detalhar</button>
    <table class="tabNFe" hidden><tr><td>${req.params.kind === "found" ? "MDF-e Autorizado com CT-e (610614)" : "MDF-e Cancelado (610611)"}</td>
    <td><a target="_blank" href="/protocol">129260000000001</a></td></tr></table>`));
  app.get("/protocol", (_req, res) => res.send("<p>Data Evento: 18/11/2026 às 12:34:56</p>"));
  const server = app.listen(0, "127.0.0.1"); await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { baseURL: `http://127.0.0.1:${server.address().port}`, counts: () => ({ logins, downloads }) };
}
function service(root, origin) { return createKeyCollection({ root, catalog, getCredentials: async () => ({ login: "fixture-login-secret", password: "fixture-password-secret" }), collector: (options) => collectSefazBa({ ...options, baseURL: origin.baseURL, timeout: 3000, downloadTimeout: 3000, launch: () => chromium.launch({ executablePath, headless: true }) }) }); }

test("linked MDF-e events include Bahia and São Paulo invoices across pages and preserve found and empty results", async (t) => {
  const api = service(await temp(t), await portal(t, { mdfe: true }));
  const filters = { companyId: "a", from: "2026-11-18", to: "2026-11-18" };
  const job = await api.start({ ...filters, directions: ["saidas"], includeMdfeEvents: true });
  assert.equal((await waitJob(api, job.id)).status, "completed");
  const { sheets } = await api.list(filters);
  assert.equal(sheets[0].hasMdfeReport, true);
  const { records } = await api.sheet(sheets[0].id, "a");
  assert.deepEqual(records.map(({ mdfe }) => mdfe), [
    { status: "found", events: [{ code: "610614", protocol: "129260000000001", date: "18/11/2026 às 12:34:56", detailUnavailable: false }] },
    { status: "empty", events: [] }
  ]);
  const app = express();
  app.locals.keyCollection = api;
  installKeyCollectionRoutes(app);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => server.close());
  const endpoint = `http://127.0.0.1:${server.address().port}/api/key-sheets/${sheets[0].id}/mdfe-events`;
  const report = await fetch(endpoint + "?companyId=a");
  assert.equal(report.status, 200);
  assert.match(report.headers.get("content-disposition"), /eventos-mdfe-por-nfe\.xlsx/);
  const workbook = XLSX.read(Buffer.from(await report.arrayBuffer()));
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  assert.equal(sheet.A2.v, key);
  assert.equal(sheet.B2.v, "29");
  assert.equal(sheet.E2.v, "129260000000001");
  assert.equal(sheet.A3.v, other);
  assert.equal(sheet.B3.v, "35");
  assert.equal((await fetch(endpoint + "?companyId=b")).status, 404);
});

test("an export containing only the header is reported as an empty consultation", async (t) => {
  const origin = await portal(t, { headerOnly: true });
  const api = service(await temp(t), origin);
  const job = await api.start({ companyId: company.id, from: "2026-11-18", to: "2026-11-18", directions: ["saidas"] });
  const result = await waitJob(api, job.id);
  assert.equal(origin.counts().downloads, 1);
  assert.equal(result.status, "empty");
  assert.equal(result.sheetCount, 0);
  assert.equal(result.keyCount, 0);
});

test("portal spreadsheets preserve all 44 digits, statuses, encoding and reject damaged numeric cells", () => {
  assert.equal(validNfeKey(key), true); assert.equal(validNfeKey(key.slice(0, -1) + "0"), false);
  const parsed = parsePortalSpreadsheet(Buffer.from(csv), "export.csv");
  assert.equal(parsed.records.length, 2); assert.equal(parsed.duplicateCount, 1);
  assert.equal(parsed.records[1].situation, "Cancelada"); assert.equal(parsed.records[0].authorizationDate, "2026-11-18");
  assert.equal(parsePortalSpreadsheet(Buffer.from(csv, "latin1"), "export.csv").records.length, 2);
  const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Chave de Acesso"], [Number(key)]]), "Notas");
  assert.throws(() => parsePortalSpreadsheet(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }), "export.xlsx"), { code: "spreadsheet_invalid" });
  assert.throws(() => parsePortalSpreadsheet(Buffer.from("<html>login</html>"), "export.xls"));
  assert.throws(() => parsePortalSpreadsheet(Buffer.from("Título;Outro\n1;2"), "export.csv"));
});

test("the same spreadsheet parser imports NFC-e with explicit model and rejects wrong models or check digits", () => {
  const { validFiscalKey } = require("../src/portalSpreadsheet");
  const base = key.slice(0, 20) + "65" + key.slice(22, 43);
  let sum = 0, weight = 2;
  for (let index = 42; index >= 0; index--) { sum += Number(base[index]) * weight; weight = weight === 9 ? 2 : weight + 1; }
  const rest = sum % 11;
  const nfce = base + (rest < 2 ? 0 : 11 - rest);
  assert.equal(validFiscalKey(nfce), true);
  assert.equal(validNfeKey(nfce), false);
  const buffer = Buffer.from(`Chave de acesso da NFC-e;Situacao\n'${nfce};Autorizada\n${nfce};Autorizada\n${key};Autorizada\n`);
  const parsed = parsePortalSpreadsheet(buffer, "nfce.csv", { model: "65" });
  assert.deepEqual(parsed.records.map(({ key }) => key), [nfce]);
  assert.equal(parsed.duplicateCount, 1);
  assert.equal(parsed.rejectedCount, 1);
  assert.equal(validFiscalKey(nfce.slice(0, 43) + ((Number(nfce[43]) + 1) % 10)), false);
  assert.throws(() => parsePortalSpreadsheet(Buffer.from(`Chave de Acesso\n${nfce}\n`), "nfce.csv"), { code: "spreadsheet_invalid" });
  assert.throws(() => parsePortalSpreadsheet(buffer, "nfce.csv", { model: "57" }));
});
test("real headless browser downloads and imports both contexts, survives restart and keeps company/period boundaries", async (t) => {
  const root = await temp(t), origin = await portal(t), api = service(root, origin);
  const started = await api.start({ companyId: "a", from: "2026-11-18", to: "2026-11-18" });
  await assert.rejects(api.start({ companyId: "a", from: "2026-11-18", to: "2026-11-18" }), { status: 409 });
  const result = await waitJob(api, started.id); assert.equal(result.status, "completed");
  assert.equal(result.sheetCount, 2); assert.equal(result.keyCount, 4); assert.equal(result.duplicateCount, 2);
  assert.deepEqual(origin.counts(), { logins: 1, downloads: 2 });
  const restarted = service(root, origin), listing = await restarted.list({ companyId: "a", from: "2026-11-01", to: "2026-11-30" });
  assert.equal(listing.sheets.length, 2);
  assert.equal((await restarted.list({ companyId: "b", from: "2026-11-01", to: "2026-11-30" })).sheets.length, 0);
  assert.equal((await restarted.list({ companyId: "a", from: "2026-10-01", to: "2026-10-31" })).sheets.length, 0);
  const sheet = await restarted.sheet(listing.sheets[0].id, "a"); assert.equal((await fs.readFile(sheet.filePath, "utf8")), csv);
  await assert.rejects(restarted.sheet(sheet.id, "b"), { status: 404 });
  const next = await api.start({ companyId: "a", from: "2026-11-18", to: "2026-11-18" });
  const repeated = await waitJob(api, next.id); assert.equal(repeated.keyCount, 0); assert.equal(repeated.duplicateCount, 6);
  assert.doesNotMatch(await fs.readFile(path.join(root, "index.json"), "utf8"), /fixture-login-secret|fixture-password-secret/);
});
test("headless CAPTCHA can be answered in the app without opening a browser window; cancellation also works", async (t) => {
  const root = await temp(t), origin = await portal(t, { captcha: true }), api = service(root, origin);
  const started = await api.start({ companyId: "a", from: "2026-11-18", to: "2026-11-18", directions: ["saidas"] });
  const challenge = await waitJob(api, started.id, (job) => !!job.challenge);
  assert.match(challenge.challenge.image, /^data:image\/png;base64,/);
  await assert.rejects(api.answer(started.id, "wrong-token", "ABCDE"), { status: 400 });
  await api.answer(started.id, challenge.challenge.token, "ABCDE");
  assert.equal((await waitJob(api, started.id)).status, "completed");
  const another = await api.start({ companyId: "a", from: "2026-11-18", to: "2026-11-18", directions: ["saidas"] });
  await waitJob(api, another.id, (job) => !!job.challenge); await api.cancel(another.id);
  assert.equal((await waitJob(api, another.id)).status, "cancelled");
  assert.equal((await api.job(another.id)).challenge, null);
  await assert.rejects(fs.access(path.join(root, "captcha.png")), { code: "ENOENT" });
  assert.doesNotMatch(await fs.readFile(path.join(root, "index.json"), "utf8"), /data:image|ABCDE/);
});
test("record limits split the period and failed single days remain partial; invalid login is attempted only once", async (t) => {
  const root = await temp(t), origin = await portal(t, { limit: true, oneDayLimit: true }), api = service(root, origin);
  const started = await api.start({ companyId: "a", from: "2026-11-18", to: "2026-11-19", directions: ["saidas"] });
  const result = await waitJob(api, started.id); assert.equal(result.status, "partial"); assert.equal(result.sheetCount, 1);
  assert.ok(result.events.some((entry) => entry.stage === "splitting"));
  assert.ok(result.events.some((entry) => entry.stage === "part_failed" && entry.from === "2026-11-19"));
  const bad = await portal(t, { badLogin: true }), rejected = service(path.join(root, "bad"), bad);
  const rejectedJob = await rejected.start({ companyId: "a", from: "2026-11-18", to: "2026-11-18" });
  const error = await waitJob(rejected, rejectedJob.id); assert.equal(error.code, "invalid_credentials"); assert.equal(bad.counts().logins, 1);
});
