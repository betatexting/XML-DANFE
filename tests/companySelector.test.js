const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const express = require("express");
const { chromium } = require("playwright-core");
const { createCompanyCatalog, installCompanyRoutes } = require("../src/companyCatalog");
const { installAuth } = require("../src/authRoutes");
const a = { id: "company-a", legalName: "Odonto Marques", cnpj: "14078646000104" };
const b = { id: "company-b", legalName: "Empresa B", cnpj: "14078646000368" };
async function temporary(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "company-selector-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  return directory;
}

test("company catalog persists one shared selection, rejects unknown IDs and does not expose unrelated fields", async (t) => {
  const filePath = path.join(await temporary(t), "companies.json");
  const catalog = createCompanyCatalog({ filePath });
  assert.deepEqual(await catalog.list(), { companies: [], selectedCompanyId: null });
  await fs.writeFile(filePath, JSON.stringify({ companies: [{ ...a, password: "must-not-leak" }, b], selectedCompanyId: null }));
  assert.doesNotMatch(JSON.stringify(await catalog.list()), /must-not-leak/);
  await Promise.all([catalog.select(a.id), catalog.select(b.id)]);
  assert.equal((await createCompanyCatalog({ filePath }).list()).selectedCompanyId, b.id);
  await assert.rejects(catalog.select("unknown"), (error) => error.status === 400);
  assert.equal((await catalog.list()).selectedCompanyId, b.id);
  await catalog.select(null);
  assert.equal((await catalog.list()).selectedCompanyId, null);
  await fs.writeFile(filePath, "broken-json");
  await assert.rejects(catalog.list());
  assert.equal(await fs.readFile(filePath, "utf8"), "broken-json");
});

test("completed query markers persist per company and never move backwards", async (t) => {
  const filePath = path.join(await temporary(t), "companies.json");
  await fs.writeFile(filePath, JSON.stringify({ companies: [a, b], selectedCompanyId: a.id }));
  const catalog = createCompanyCatalog({ filePath });
  await catalog.recordQueryCompletion(a.id, "2026-10-15T12:00:00Z");
  await Promise.all([catalog.select(b.id), catalog.recordQueryCompletion(b.id, "2026-10-18T12:00:00Z"), catalog.recordQueryCompletion(a.id, "2026-10-10T12:00:00Z")]);
  const snapshot = await createCompanyCatalog({ filePath }).list();
  assert.equal(snapshot.companies[0].lastCompletedQueryAt, "2026-10-15T12:00:00.000Z");
  assert.equal(snapshot.companies[1].lastCompletedQueryAt, "2026-10-18T12:00:00.000Z");
  assert.equal(snapshot.selectedCompanyId, b.id);
  await assert.rejects(catalog.recordQueryCompletion("unknown"));
  await assert.rejects(catalog.recordQueryCompletion(a.id, "invalid"));
  await assert.rejects(catalog.recordQueryCompletion(a.id, "2099-01-01T00:00:00Z"));
});

test("company popup handles hover, empty/single/multiple companies and shares context across module requests", async (t) => {
  const directory = await temporary(t);
  const filePath = path.join(directory, "companies.json");
  const app = express();
  app.use(express.json());
  const cookie = await require("./helpers/auth").authenticateTestApp(app, directory);
  installAuth(app);
  app.locals.companyCatalog = createCompanyCatalog({ filePath });
  installCompanyRoutes(app);
  app.use(express.static(path.resolve("public")));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const browser = await chromium.launch({ executablePath: path.resolve(".playwright-browsers/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe"), headless: true });
  t.after(async () => { await browser.close(); await new Promise((resolve) => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base + "/api/companies")).status, 401);
  assert.equal((await fetch(base + "/api/companies/selection", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ companyId: a.id }) })).status, 401);
  const context = await browser.newContext({ viewport: { width: 1052, height: 589 } });
  await context.addInitScript(() => {
    window.consultaDanfeDesktop = { isDesktop: true, minimizeWindow() {}, closeWindow() {} };
  });
  await context.addCookies([{ name: cookie.split("=")[0], value: cookie.split("=")[1], url: base }]);
  const page = await context.newPage();
  const errors = [], fiscalRequests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => { if (request.url().includes("/api/process")) fiscalRequests.push(request.url()); });
  await page.goto(base + "/notas-automaticas");
  await page.waitForFunction(() => document.querySelector("#companySelectLabel").textContent === "Cadastrar empresa");
  const icon = page.getByRole("button", { name: "Empresas", exact: true });
  const popup = page.locator("#companyPopover");
  await icon.hover();
  assert.equal(await popup.isVisible(), true);
  assert.equal(await page.locator(".login-panel__surface").evaluate((node) => getComputedStyle(node).getPropertyValue("-webkit-app-region")), "drag");
  for (const selector of [".company-hover-bridge", "#companyPopover", "#companySelectButton", ".company-module", "#companyDropdown", "#companyOptions", "#createCompanyButton"]) {
    assert.equal(await page.locator(selector).first().evaluate((node) => getComputedStyle(node).getPropertyValue("-webkit-app-region")), "no-drag", selector);
  }
  assert.equal(await page.getByRole("button", { name: "Chaves", exact: true }).isDisabled(), true);
  await page.click("#companySelectButton");
  assert.equal(await page.locator("#createCompanyButton").isVisible(), true);
  const registrationPromise = page.waitForEvent('popup');
  await page.click("#createCompanyButton");
  const registration = await registrationPromise;
  await registration.waitForLoadState();
  assert.ok(registration.url().endsWith('/cadastro-empresa'));
  await registration.close();
  await page.mouse.move(600, 400);
  await page.waitForFunction(() => document.querySelector("#companyPopover").hidden);
  assert.equal(await popup.isVisible(), false);

  await fs.writeFile(filePath, JSON.stringify({ companies: [a], selectedCompanyId: null }));
  await page.evaluate(() => document.dispatchEvent(new Event("company:registered")));
  await page.waitForFunction(() => document.querySelectorAll("#companyOptions .company-option").length === 1);
  await icon.hover();
  const box = await popup.boundingBox();
  await page.mouse.move(box.x + 110, box.y + 50, { steps: 30 });
  assert.equal(await popup.isVisible(), true, "crossing from icon to popup does not close it");
  // A brief trip across the boundary must not collapse the panel on reentry.
  await page.mouse.move(box.x - 4, box.y - 2);
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.waitForTimeout(170);
  assert.equal(await popup.isVisible(), true);
  await page.click("#companySelectButton");
  await page.getByRole("option", { name: a.legalName }).click();
  await page.waitForFunction(() => document.querySelector("#companySelectLabel").textContent === "Odonto Marques");
  await page.evaluate(() => {
    window.moduleRequests = [];
    document.addEventListener("company-module:request", (event) => window.moduleRequests.push(event.detail));
  });
  const mdfeKey = "29261114078646000104580010000000011000000001";
  await page.route(`**/api/companies/${a.id}/mdfe/open`, async (route) => {
    assert.equal(route.request().method(), "POST");
    await route.fulfill({ json: { status: "111", manifests: [{ key: mdfeKey, protocol: "129260000000001" }] } });
  });
  await page.route("**/api/companies/*/cte", (route) => route.fulfill({ json: {
    last: "000000000000013", added: 2, documents: [
      { nsu: "000000000000012", key: "cte-tomadora", issuer: "Transportadora A", issuedAt: "2026-10-20T10:00:00-03:00", roles: ["tomadora", "destinataria"] },
      { nsu: "000000000000013", key: "cte-remetente", issuer: "Transportadora B", issuedAt: "2026-11-20T10:00:00-03:00", roles: ["remetente"] }
    ]
  } }));
  await page.getByRole("button", { name: "Chaves", exact: true }).click();
  await page.getByRole("button", { name: "CT-e", exact: true }).click();
  const cte = page.getByRole("table", { name: "CT-e recebidos" });
  await cte.getByText("cte-tomadora", { exact: true }).waitFor();
  await page.locator("#cteRole").selectOption("remetente");
  assert.equal(await cte.getByText("cte-tomadora", { exact: true }).count(), 0);
  assert.equal(await cte.getByText("cte-remetente", { exact: true }).count(), 1);
  await page.locator("#cteRole").selectOption("destinataria");
  assert.equal(await cte.getByText("cte-tomadora", { exact: true }).count(), 1);
  await page.getByLabel("Mês de emissão", { exact: true }).selectOption("2026-11");
  assert.equal(await cte.getByText("cte-tomadora", { exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Baixar XMLs filtrados (ZIP)" }).isDisabled(), true);
  await page.getByLabel("Mês de emissão", { exact: true }).selectOption("2026-10");
  await page.route(`**/api/companies/${a.id}/cte/archive?**`, (route) => {
    const filters = new URL(route.request().url()).searchParams;
    assert.equal(filters.get("month"), "2026-10");
    assert.equal(filters.get("role"), "destinataria");
    return route.fulfill({ contentType: "application/zip", body: Buffer.from("fixture") });
  });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Baixar XMLs filtrados (ZIP)" }).click();
  assert.equal((await download).suggestedFilename(), "cte-2026-10-destinataria.zip");
  await page.getByRole("button", { name: "Consultar CT-e" }).click();
  await page.waitForFunction(() => document.querySelector("#cteMessage").textContent.includes("2 CT-e novo"), { timeout: 4000 });
  await icon.click();
  await page.getByRole("button", { name: "MDF-e", exact: true }).click();
  await page.getByRole("button", { name: "Não encerrados", exact: true }).click();
  await page.locator("#mdfeResults").waitFor({ state: "visible" });
  assert.match(await page.locator("#mdfeResults").innerText(), new RegExp(mdfeKey));
  assert.equal(await page.getByRole("table", { name: "Manifestos MDF-e" }).isVisible(), true);
  assert.equal(await popup.locator("table").count(), 0);
  await page.getByLabel("Filtrar resultados").fill("sem correspondência");
  await page.getByText("Nenhum resultado corresponde ao filtro.").waitFor();
  const exportMdfeKeys = page.getByRole("button", { name: "Baixar chaves encontradas" });
  const [collectedKeysDownload] = await Promise.all([page.waitForEvent("download"), exportMdfeKeys.click()]);
  assert.equal(collectedKeysDownload.suggestedFilename(), "chaves-mdfe-nao-encerrados.txt");
  assert.equal(await fs.readFile(await collectedKeysDownload.path(), "utf8"), mdfeKey + "\r\n");
  await page.getByLabel("Filtrar resultados").fill("");
  await page.route(`**/api/companies/${a.id}/mdfe/status`, (route) => route.fulfill({ json: { status: "107", reason: "Serviço em operação" } }));
  await page.getByRole("button", { name: "Disponibilidade da SVRS" }).click();
  await page.getByText("SVRS (107) — Serviço em operação").waitFor();
  await page.route(`**/api/companies/${a.id}/mdfe/situation`, async (route) => {
    assert.deepEqual(route.request().postDataJSON(), { key: mdfeKey });
    await route.fulfill({ json: { status: "100", reason: "Autorizado", protocol: "129260000000001", events: [{ description: "Encerramento" }] } });
  });
  await page.getByLabel("Chave de MDF-e próprio").fill(mdfeKey);
  await page.getByRole("button", { name: "Consultar situação" }).click();
  await page.getByText("Encerramento", { exact: true }).waitFor();
  await page.route(`**/api/companies/${a.id}/mdfe/download`, async (route) => {
    assert.equal(route.request().method(), "POST");
    await route.fulfill({ json: { state: "form", httpStatus: 200, filters: ["key"], challenge: false } });
  });
  await page.getByRole("button", { name: "Verificar Download XML na SVRS" }).click();
  await page.getByText("Formulário da SVRS acessível com o A1 cadastrado. Filtros identificados: chave.").waitFor();
  assert.equal(await page.getByText("Encerramento", { exact: true }).isVisible(), true);
  await page.route(`**/api/companies/${a.id}/mdfe/xml`, async (route) => {
    assert.deepEqual(route.request().postDataJSON(), { key: mdfeKey });
    await route.fulfill({ contentType: "application/xml", body: "<mdfeProc/>" });
  });
  const [xmlDownload] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Baixar XML", exact: true }).click()]);
  assert.equal(xmlDownload.suggestedFilename(), `${mdfeKey}-mdfe.xml`);
  await page.route(`**/api/companies/${a.id}/fiscal-xml/archive?*`, async (route) => {
    const query = new URL(route.request().url()).searchParams;
    assert.equal(query.get("type"), "mdfe");
    assert.equal(query.get("month"), "2026-11");
    assert.equal(query.get("format"), "keys");
    await route.fulfill({ contentType: "text/plain", body: mdfeKey + "\r\n" });
  });
  await page.getByLabel("Competência do acervo local").fill("2026-11");
  const [keysDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Baixar chaves salvas" }).click()
  ]);
  assert.equal(keysDownload.suggestedFilename(), "chaves-mdfe-2026-11.txt");
  const requests = await page.evaluate(() => window.moduleRequests);
  assert.deepEqual(requests.map((r) => r.module), ["chaves", "cte", "mdf"]);
  assert.ok(requests.every((r) => r.company.id === a.id));
  assert.equal((await app.locals.companyCatalog.list()).selectedCompanyId, a.id);
  const artifacts = path.resolve("tmp-company-selector");
  await fs.mkdir(artifacts, { recursive: true });
  await page.screenshot({ path: path.join(artifacts, "mdfe-table.png"), omitBackground: true });
  await icon.click();
  await page.screenshot({ path: path.join(artifacts, "selected-company.png"), omitBackground: true });
  await popup.screenshot({ path: path.join(artifacts, "popup.png"), omitBackground: true });
  await page.mouse.move(600, 400);
  await page.waitForFunction(() => document.querySelector("#companyPopover").hidden);
  assert.equal(await popup.isVisible(), false);

  const many = [{ ...a, nfseProxy: true, certificate: { validTo: "2099-01-01T00:00:00Z" } }, b, ...Array.from({ length: 20 }, (_, index) => ({ id: `extra-${index}`, legalName: `Empresa ${index}` }))];
  await fs.writeFile(filePath, JSON.stringify({ companies: many, selectedCompanyId: a.id }));
  await page.evaluate(() => document.dispatchEvent(new Event("company:registered")));
  await page.waitForFunction(() => document.querySelectorAll("#companyOptions .company-option").length === 22);
  await icon.hover();
  await page.click("#companySelectButton");
  assert.equal(await page.locator("#companyOptions").evaluate((node) => node.scrollHeight > node.clientHeight), true);
  assert.equal(await page.locator("#createCompanyButton").isVisible(), true);
  await page.getByRole("option", { name: b.legalName, exact: true }).click();
  await page.waitForFunction(() => document.querySelector("#companySelectLabel").textContent === "Empresa B");
  await page.route(`**/api/companies/${b.id}/mdfe/open`, (route) => route.fulfill({ json: { status: "112", manifests: [] } }));
  for (const text of ["Chaves", "CT-e"]) await page.getByRole("button", { name: text, exact: true }).click();
  await icon.click();
  await page.getByRole("button", { name: "MDF-e", exact: true }).click();
  await page.getByRole("button", { name: "Não encerrados", exact: true }).click();
  await page.getByText("Nenhum MDF-e não encerrado encontrado.").waitFor();
  assert.equal(await exportMdfeKeys.isDisabled(), true);
  assert.ok((await page.evaluate(() => window.moduleRequests.slice(-3))).every((r) => r.company.id === b.id));
  assert.equal(await page.locator('[data-company-module="nfse"]').count(), 0);
  await page.getByRole("button", { name: "Filtro de notas" }).click();
  await page.locator("#notePopover").getByRole("button", { name: "NFS-e", exact: true }).click();
  await page.getByText("Sem certificado cadastrado", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Forma de acesso").inputValue(), "proxy");
  await page.getByLabel("Procurador", { exact: true }).selectOption(a.id);
  const nfseNsus = [];
  await page.route(`**/api/companies/${b.id}/nfse/distribution`, async (route) => {
    const { nsu, proxyId } = route.request().postDataJSON();
    assert.equal(proxyId, a.id);
    nfseNsus.push(nsu);
    await route.fulfill({ json: { authorization: "Procuracao", nextNsu: "23", receivedCount: nsu === "0" ? 50 : 0, duplicateCount: nsu === "0" ? 49 : 0, documents: nsu === "0" ? [{ nsu: "23", type: "NFSE", key: "chave-simulada" }] : [] } });
  });
  await page.getByRole("button", { name: "Consultar NFS-e", exact: true }).click();
  await page.getByText("chave-simulada", { exact: true }).waitFor();
  await page.getByText("1 nota(s) nova(s) · 49 já salva(s) · 2 lote(s).", { exact: true }).waitFor();
  assert.deepEqual(nfseNsus, ["0", "23"]);
  await page.setViewportSize({ width: 480, height: 400 });
  await icon.hover();
  const smallPopup = await popup.boundingBox();
  const panel = await page.locator(".automatic-notes-panel").boundingBox();
  assert.ok(smallPopup.x + smallPopup.width <= panel.x + panel.width);
  assert.ok(smallPopup.y + smallPopup.height <= panel.y + panel.height);
  await page.screenshot({ path: path.join(artifacts, "small-window.png"), omitBackground: true });
  assert.deepEqual(fiscalRequests, [], "module placeholders do not start fiscal queries");
  assert.deepEqual(errors, []);
});
