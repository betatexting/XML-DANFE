const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { findLocalXmls, inspectLocalXml } = require("../src/localXml");
const { getCertificateOrganization } = require("../src/xmlStorage");

const key = "35260444823938000187551090000002691092067649";
const otherKey = "29260621444661000186550030000065351001699396";
const company = "11111111000111";
const xmlFor = (key, recipient = company) => `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe${key}"><ide><dhEmi>2026-04-09T12:00:00-03:00</dhEmi></ide><emit><CNPJ>${key.slice(6, 20)}</CNPJ></emit><dest><CNPJ>${recipient}</CNPJ></dest><det nItem="1"><prod><xProd>Produto</xProd></prod></det><total><ICMSTot><vNF>1.00</vNF></ICMSTot></total></infNFe></NFe><protNFe><infProt><chNFe>${key}</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>`;

test("local XML validation rejects incomplete, malformed, renamed and unrelated documents", () => {
  const selection = getCertificateOrganization({ cnpj: company });
  const xml = xmlFor(key);
  assert.equal(inspectLocalXml(xml, key, selection).documentIssueDate, "2026-04-09T12:00:00-03:00");
  for (const invalid of ["", "<resNFe/>", xml.slice(0, -10), xmlFor(otherKey), xmlFor(key, "22222222000122"), xml.replace("2026-04-09", "2026-02-30"), xml.replace("<cStat>100", "<cStat>301"), `<!DOCTYPE nfeProc>${xml}`, xml.replace("</total>", "</wrong>")]) {
    assert.equal(inspectLocalXml(invalid, key, selection), null);
  }
  assert.ok(inspectLocalXml(xml.replaceAll("nfeProc", "procNFe"), key, selection));
  assert.equal(inspectLocalXml(xml, key, { type: "saidas", cnpj: company }), null);
  assert.ok(inspectLocalXml(xml, key, { type: "saidas", cnpj: key.slice(6, 20) }));
});

test("recursive lookup reuses unclassified files in zilma and ignores invalid duplicates", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "local-xml-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const source = path.join(directory, "zilma", "antigos", `${key}.XML`);
  await fs.mkdir(path.dirname(source), { recursive: true });
  await fs.writeFile(path.join(directory, `${key}.xml`), "<resNFe/>");
  await fs.writeFile(source, xmlFor(key));
  await fs.mkdir(path.join(directory, "diagnosticos"));
  await fs.writeFile(path.join(directory, "diagnosticos", `${otherKey}.xml`), xmlFor(otherKey));
  const found = await findLocalXmls({ keys: [key, otherKey], downloadsDir: directory, organization: { type: "entradas", cnpj: company } });
  assert.equal(found.size, 1);
  assert.equal(found.get(key).filePath, source);
  assert.equal(found.get(key).alreadyAvailable, true);
  assert.equal(found.get(key).downloadMethod, "local-file");
  assert.equal(await fs.readFile(source, "utf8"), xmlFor(key));
  assert.deepEqual((await fs.readdir(directory)).sort(), ["diagnosticos", `${key}.xml`, "zilma"].sort());
  const wrongCompany = await findLocalXmls({ keys: [key], downloadsDir: directory, organization: getCertificateOrganization({ cnpj: "22222222000122" }) });
  assert.equal(wrongCompany.size, 0);
});

test("selecting a month/type folder also finds valid files in sibling periods", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "local-xml-folders-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const selected = path.join(root, company, "2026-09", "entradas");
  const oldFolder = path.join(root, company, "2026-04", "entradas");
  await fs.mkdir(selected, { recursive: true });
  await fs.mkdir(oldFolder, { recursive: true });
  await fs.writeFile(path.join(oldFolder, `${key}.xml`), xmlFor(key));
  const found = await findLocalXmls({ keys: [key], downloadsDir: selected, organization: getCertificateOrganization({ cnpj: company }) });
  assert.equal(found.get(key).filePath, path.join(oldFolder, `${key}.xml`));
  assert.deepEqual(await fs.readdir(selected), []);
});

test("server uses local XML before all processors and requests only missing keys", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "local-xml-api-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.mkdir(path.join(directory, "zilma"));
  await fs.writeFile(path.join(directory, "zilma", `${key}.xml`), xmlFor(key));
  process.env.DOWNLOADS_DIR = directory;
  const certificateModule = require("../src/certificate");
  t.mock.method(certificateModule, "inspectCertificate", () => ({ cnpj: company }));
  const pdfModule = require("../src/pdfToXml");
  t.mock.method(pdfModule, "extractCandidatesFromPdfFiles", async () => [{ key, sourceType: "pdf", sourceName: "nota.pdf", status: "pending" }]);
  const { storeCertificate } = require("../src/certificateSession");
  const { app } = require("../server");
  const authCookie = await require("./helpers/auth").authenticateTestApp(app, directory);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const originalFetch = global.fetch;
  const todayParts = Object.fromEntries(new Intl.DateTimeFormat("en", { timeZone: "America/Sao_Paulo", year: "2-digit", month: "2-digit" })
    .formatToParts(new Date()).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const currentKey = otherKey.slice(0, 2) + todayParts.year + todayParts.month + otherKey.slice(6);
  let externalRequests = 0;
  t.mock.method(global, "fetch", async (url, options) => {
    if (String(url).startsWith("http://127.0.0.1:")) return originalFetch(url, options);
    externalRequests += 1;
    assert.equal(JSON.parse(options.body).chave, currentKey);
    return new Response(JSON.stringify({ error: "chave_invalida" }), { status: 400, headers: { "Content-Type": "application/json" } });
  });
  const https = require("node:https");
  t.mock.method(https, "request", () => { assert.fail("Local XML must not query SEFAZ"); });
  const { chromium } = require("playwright-core");
  t.mock.method(chromium, "launch", () => { assert.fail("Local XML must not start browser fallback"); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const org = { type: "entradas", cnpj: company };
  async function results(endpoint, body) {
    const response = await fetch(`${base}${endpoint}`, { method: "POST", headers: { Cookie: authCookie, ...(body instanceof FormData ? {} : { "Content-Type": "application/json" }) }, body: body instanceof FormData ? body : JSON.stringify(body) });
    assert.equal(response.status, 200);
    const events = (await response.text()).trim().split("\n").map(JSON.parse);
    return events.filter((event) => event.type === "result").map((event) => event.result);
  }
  for (const endpoint of ["/api/process", "/api/process-items", "/api/process-fallback"]) {
    const found = await results(endpoint, { rawKeys: key, items: [{ key }], organization: org });
    assert.equal(found[0].alreadyAvailable, true);
    assert.equal(found[0].filePath, path.join(directory, "zilma", `${key}.xml`));
  }
  for (const certified of [false, true]) {
    for (const [endpoint, field, name, mime, contents] of [
      ["/api/process-pdfs", "pdfs", "nota.pdf", "application/pdf", "fixture"],
      ["/api/process-spreadsheets", "spreadsheets", "notas.csv", "text/csv", `Chave de Acesso\n${key}\n${key}`]
    ]) {
      const body = new FormData();
      body.append(field, new Blob([contents], { type: mime }), name);
      body.append("organization", JSON.stringify(org));
      if (certified) {
        const { id } = storeCertificate({ buffer: Buffer.from("fixture"), fileName: "fixture.pfx" });
        body.append("certificateId", id);
        body.append("certificatePassphrase", "fixture");
        body.append("certificateAuthorUf", "35");
      }
      const found = await results(endpoint, body);
      assert.ok(found.length > 0);
      assert.ok(found.every((result) => result.alreadyAvailable));
    }
  }
  for (const endpoint of ["/api/process", "/api/process-distnsu"]) {
    const { id } = storeCertificate({ buffer: Buffer.from("fixture"), fileName: "fixture.pfx" });
    const found = await results(endpoint, { rawKeys: key, items: [{ key }], certificateId: id, certificatePassphrase: "fixture", certificateAuthorUf: "35", organization: { type: "saidas", cnpj: "22222222000122" } });
    assert.equal(found[0].alreadyAvailable, true);
  }
  assert.equal(externalRequests, 0);
  const mixed = await results("/api/process", { rawKeys: `${key}\n${currentKey}`, organization: org });
  assert.equal(mixed.find((result) => result.key === key).alreadyAvailable, true);
  assert.equal(mixed.find((result) => result.key === currentKey).status, "error");
  assert.equal(externalRequests, 1);
});
