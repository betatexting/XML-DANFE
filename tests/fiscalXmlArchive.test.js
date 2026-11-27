const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { gzipSync } = require("node:zlib");
const AdmZip = require("adm-zip");
const express = require("express");
const { installNfseRoutes } = require("../src/nfseDistribution");
const { installFiscalArchiveRoutes } = require("../src/fiscalXmlArchive");

test("NFSe saves original XML before advancing its NSU and exports by company, type and month", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "fiscal-archive-"));
  const downloads = path.join(root, "downloads");
  await fs.mkdir(downloads);
  const company = { id: "company", cnpj: "14078646000104", certificate: { validTo: "2099-01-01" } };
  const noteKey = "1".repeat(50);
  const note = `<NFSe><infNFSe Id="NFS${noteKey}"><nNFSe>1</nNFSe><dhProc>2026-10-31T12:00:00-03:00</dhProc><DPS><infDPS><toma><CNPJ>${company.cnpj}</CNPJ></toma></infDPS></DPS></infNFSe></NFSe>`;
  const invoiceKey = "2".repeat(44);
  const invoice = (cnpj, model, key, month) => `<nfeProc><NFe><infNFe><ide><mod>${model}</mod><dhEmi>2026-${month}-20T10:00:00-03:00</dhEmi></ide><emit><CNPJ>${cnpj}</CNPJ></emit></infNFe></NFe><protNFe><infProt><cStat>100</cStat><chNFe>${key}</chNFe></infProt></protNFe></nfeProc>`;
  await fs.writeFile(path.join(downloads, "own.xml"), invoice(company.cnpj, "55", invoiceKey, "10"));
  await fs.writeFile(path.join(downloads, "duplicate.xml"), invoice(company.cnpj, "55", invoiceKey, "10"));
  await fs.writeFile(path.join(downloads, "other.xml"), invoice("00000000000000", "55", "3".repeat(44), "10"));
  await fs.writeFile(path.join(downloads, "november.xml"), invoice(company.cnpj, "65", "4".repeat(44), "11"));
  const cte = "6".repeat(44);
  const manifestKey = (month, cnpj) => `2926${month}${cnpj}58${"5".repeat(22)}`;
  const manifest = (month, cnpj, key) => `<mdfeProc><MDFe><infMDFe Id="MDFe${key}"><ide><mod>58</mod><dhEmi>2026-${month}-01</dhEmi></ide><emit><CNPJ>${cnpj}</CNPJ></emit></infMDFe></MDFe><protMDFe><infProt><chMDFe>${key}</chMDFe><cStat>100</cStat><nProt>123456789012345</nProt></infProt></protMDFe></mdfeProc>`;
  const mdfe = manifestKey("10", company.cnpj);
  const otherMdfe = manifestKey("10", "14078646000368");
  const novemberMdfe = manifestKey("11", company.cnpj);
  await fs.writeFile(path.join(downloads, "mdfe.xml"), manifest("10", company.cnpj, mdfe));
  await fs.writeFile(path.join(downloads, "mdfe-copy.xml"), manifest("10", company.cnpj, mdfe));
  await fs.writeFile(path.join(downloads, "mdfe-other.xml"), manifest("10", "14078646000368", otherMdfe));
  await fs.writeFile(path.join(downloads, "mdfe-november.xml"), manifest("11", company.cnpj, novemberMdfe));
  await fs.writeFile(path.join(downloads, "cte.xml"), `<cteProc><CTe><infCte><ide><dhEmi>2026-10-02</dhEmi></ide><emit><CNPJ>${company.cnpj}</CNPJ></emit></infCte></CTe><protCTe><infProt><chCTe>${cte}</chCTe><cStat>100</cStat></infProt></protCTe></cteProc>`);
  const app = express();
  app.use(express.json());
  app.locals.companyCatalog = { list: async () => ({ companies: [company] }), loadCertificate: async () => ({ pfx: Buffer.from([1]) }) };
  let invalid = true;
  let different = false;
  const archiveRoot = path.join(downloads, "Notas Fiscais");
  const otherCompanyDirectory = path.join(archiveRoot, "14078646000368", "nfse");
  await fs.mkdir(otherCompanyDirectory, { recursive: true });
  await fs.writeFile(path.join(otherCompanyDirectory, noteKey + ".xml"), note);
  installNfseRoutes(app, { root: path.join(root, "nfse-distribution"), archiveRoot, query: async () => ({
    httpStatus: 200, data: { LoteDFe: [{ NSU: 5, TipoDocumento: "NFSE", ChaveAcesso: noteKey, ArquivoXml: gzipSync(invalid ? "<bad/>" : different ? note.replace("<nNFSe>1", "<nNFSe>2") : note).toString("base64") }] }
  }) });
  installFiscalArchiveRoutes(app, { getDownloadsDir: () => downloads, dataDir: root, archiveRoot });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${server.address().port}/api/companies/company`;
  const collect = () => fetch(url + "/nfse/distribution", { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"nsu":"0"}' });
  assert.equal((await collect()).status, 502);
  assert.deepEqual(await (await fetch(url + "/nfse/distribution")).json(), { nsu: "0" });
  invalid = false;
  const firstBatch = await (await collect()).json();
  assert.equal(firstBatch.savedNsu, "5");
  assert.equal(firstBatch.savedCount, 1, "another company's copy must not suppress this company's download");
  const savedFile = path.join(archiveRoot, company.cnpj, "nfse", noteKey + ".xml");
  assert.equal(await fs.readFile(savedFile, "utf8"), note);
  const before = await fs.stat(savedFile);
  const repeated = await (await collect()).json();
  assert.equal(repeated.savedCount, 0);
  assert.equal(repeated.duplicateCount, 1);
  assert.equal(repeated.receivedCount, 1);
  assert.deepEqual(repeated.documents, []);
  assert.equal((await fs.stat(savedFile)).mtimeMs, before.mtimeMs);
  // A missing local file is recovered when its batch is requested again.
  await fs.unlink(savedFile);
  assert.equal((await (await collect()).json()).savedCount, 1);
  assert.deepEqual(await (await fetch(url + "/nfse/distribution")).json(), { nsu: "5" });
  const result = await fetch(url + "/fiscal-xml/archive?type=all&month=2026-10");
  assert.equal(result.status, 200);
  const zip = new AdmZip(Buffer.from(await result.arrayBuffer()));
  const nfsPath = `${company.cnpj}/nfse/2026/10/tomadas/${noteKey}.xml`;
  assert.deepEqual(zip.getEntries().map((entry) => entry.entryName).sort(), [
    `${company.cnpj}/cte/2026/10/saidas/${cte}.xml`, `${company.cnpj}/mdfe/2026/10/saidas/${mdfe}.xml`,
    `${company.cnpj}/nfe/2026/10/saidas/${invoiceKey}.xml`, nfsPath
  ]);
  assert.equal(zip.readAsText(nfsPath), note);
  const keys = await fetch(url + "/fiscal-xml/archive?type=mdfe&month=2026-10&format=keys");
  assert.equal(keys.status, 200);
  assert.match(keys.headers.get("content-disposition"), /chaves-mdfe-2026-10\.txt/);
  assert.equal(await keys.text(), mdfe + "\r\n");
  const mdfeZip = await fetch(url + "/fiscal-xml/archive?type=mdfe&month=2026-10");
  assert.equal(mdfeZip.status, 200);
  const mdfeFiles = new AdmZip(Buffer.from(await mdfeZip.arrayBuffer()));
  assert.deepEqual(mdfeFiles.getEntries().map((entry) => entry.entryName), [`${company.cnpj}/mdfe/2026/10/saidas/${mdfe}.xml`]);
  for (const format of ["zip", "keys"]) {
    const empty = await fetch(url + `/fiscal-xml/archive?type=mdfe&month=2026-09&format=${format}`);
    assert.equal(empty.status, 404);
    assert.deepEqual((await empty.json()).availableMonths, ["2026-11", "2026-10"]);
  }
  assert.equal((await fetch(url + "/fiscal-xml/archive?type=mdfe&format=keys")).status, 400);
  assert.equal((await fetch(url + "/fiscal-xml/archive?type=nfce&month=2026-10")).status, 404);
  assert.equal((await fetch(url + "/fiscal-xml/archive?type=nfce")).status, 200);
  const emptyMonth = await fetch(url + "/fiscal-xml/archive?type=nfse&month=2026-11");
  assert.equal(emptyMonth.status, 404);
  assert.deepEqual((await emptyMonth.json()).availableMonths, ["2026-10"]);
  different = true;
  assert.equal((await collect()).status, 502);
  assert.equal(await fs.readFile(savedFile, "utf8"), note);
  assert.equal((await (await fetch(url + "/nfse/distribution")).json()).nsu, "5");
});
