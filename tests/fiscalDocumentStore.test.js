const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { saveFiscalBatch, saveXmlFile, companyDirectory } = require("../src/fiscalDocumentStore");

test("one fiscal store handles all types, company isolation, duplicates and conflicts", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "shared-fiscal-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const type of ["nfe", "nfce", "nfse", "cte", "mdfe"]) {
    const key = "1".repeat(type === "nfse" ? 50 : 44);
    const buffer = Buffer.from(`<document Id="${key}"/>`);
    const options = { company: "14078646000104", type, root, notes: [{ key, buffer }] };
    const first = await saveFiscalBatch(options);
    assert.equal(first.savedCount, 1);
    const file = first.files.get(key), before = await fs.stat(file);
    const repeated = await saveFiscalBatch(options);
    assert.equal(repeated.savedCount, 0);
    assert.equal(repeated.duplicateCount, 1);
    assert.equal((await fs.stat(file)).mtimeMs, before.mtimeMs);
    assert.equal((await saveFiscalBatch({ ...options, company: "14078646000368" })).savedCount, 1);
    await assert.rejects(saveFiscalBatch({ ...options, notes: [{ key, buffer: Buffer.from(`<different Id="${key}"/>`) }] }), /divergente/);
    assert.deepEqual(await fs.readFile(file), buffer);
  }
  assert.throws(() => companyDirectory("../escape", "nfe", root));
  const concurrent = path.join(root, "concurrent.xml");
  const results = await Promise.all([saveXmlFile(concurrent, Buffer.from("<a/>")), saveXmlFile(concurrent, Buffer.from("<a/>"))]);
  assert.equal(results.filter(({ saved }) => saved).length, 1);
});

test("shared pagination continues past duplicate-only batches, respects adapter stop and never retries errors", async () => {
  const source = await fs.readFile(path.join(__dirname, "../public/fiscal-batches.js"), "utf8");
  const { fiscalBatches } = await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
  const calls = [];
  for await (const _ of fiscalBatches({ cursor: 0, pause: 0, request: async (cursor) => { calls.push(cursor); return { next: cursor + 1 }; }, next: (data) => data.next < 3 ? data.next : null })) {}
  assert.deepEqual(calls, [0, 1, 2]);
  let count = 0;
  await assert.rejects(async () => { for await (const _ of fiscalBatches({ request: async () => { count++; throw Error("rejected"); }, next: () => 1 })) {} }, /rejected/);
  assert.equal(count, 1);
});

test("CT-e routes save by key, resume NSU, skip duplicates and respect cooldown; MDF-e reuses local XML", async (t) => {
  const express = require("express");
  const { installCteRoutes } = require("../src/cteDistribution");
  const { installMdfeRoutes } = require("../src/mdfeConsulta");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "fiscal-adapters-"));
  const archiveRoot = path.join(root, "downloads");
  const company = { id: "company", cnpj: "14078646000104" };
  const app = express();
  app.use(express.json());
  app.locals.companyCatalog = { list: async () => ({ companies: [company] }), loadCertificate: async () => ({ pfx: Buffer.from([1]) }) };
  let cteCalls = 0, mdfeCalls = 0;
  const key = "29261014078646000104570010000000011000000000";
  installCteRoutes(app, { archiveRoot, root: path.join(root, "cte"), record: async () => {}, query: async ({ last }) => {
    assert.equal(last, String(cteCalls).padStart(15, "0"));
    cteCalls++;
    return { status: "138", last: String(cteCalls).padStart(15, "0"), max: "000000000000002", documents: [{ key, nsu: String(cteCalls).padStart(15, "0"), roles: ["tomadora"], buffer: Buffer.from(`<cteProc><infCte Id="CTe${key}"/></cteProc>`) }] };
  } });
  const manifestKey = key.slice(0, 20) + "58" + key.slice(22);
  const manifest = Buffer.from(`<mdfeProc><MDFe><infMDFe Id="MDFe${manifestKey}"><ide><mod>58</mod></ide><emit><CNPJ>${company.cnpj}</CNPJ></emit></infMDFe></MDFe><protMDFe><infProt><chMDFe>${manifestKey}</chMDFe><cStat>100</cStat><nProt>123456789012345</nProt></infProt></protMDFe></mdfeProc>`);
  installMdfeRoutes(app, { archiveRoot, xmlRoot: path.join(root, "mdfe"), record: async () => {}, download: async () => { mdfeCalls++; return manifest; } });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await fs.rm(root, { recursive: true, force: true }); });
  const url = `http://127.0.0.1:${server.address().port}/api/companies/company`;
  const collect = async () => { const response = await fetch(url + "/cte", { method: "POST" }); assert.equal(response.status, 200); return response.json(); };
  assert.equal((await collect()).hasMore, true);
  const second = await collect();
  assert.equal(second.added, 0);
  assert.equal(second.duplicateCount, 1);
  assert.equal(second.documents.length, 1);
  assert.equal(second.hasMore, false);
  assert.equal((await collect()).waiting, true);
  assert.equal(cteCalls, 2);
  assert.equal((await fetch(url + "/cte/000000000000002/xml")).status, 200);
  for (let i = 0; i < 2; i++) {
    const response = await fetch(url + "/mdfe/xml", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: manifestKey }) });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), manifest.toString());
  }
  assert.equal(mdfeCalls, 1);
});
