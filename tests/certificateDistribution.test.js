const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("node:zlib");
const { getIssueDateFromXml, getIssueMonthFromAccessKey } = require("../src/accessKeys");
const { CertificateError, inspectCertificate } = require("../src/certificate");
const {
  discardCertificate,
  getCertificate,
  storeCertificate
} = require("../src/certificateSession");
const {
  buildDistNsuEnvelope,
  buildDistributionEnvelope,
  extractCompleteXml,
  MAX_NSU_BATCHES_PER_FALLBACK,
  parseDistributionResponse
} = require("../src/nfeDistribution");

const accessKey = "35260444823938000187551090000002691092067649";

function createSefazResponse(documentXml, schema = "procNFe_v4.00.xsd") {
  const documentZip = zlib.gzipSync(Buffer.from(documentXml, "utf8")).toString("base64");

  return `<?xml version="1.0" encoding="utf-8"?>
    <soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
      <soap:Body>
        <retDistDFeInt xmlns="http://www.portalfiscal.inf.br/nfe">
          <cStat>138</cStat>
          <xMotivo>Documento localizado</xMotivo>
          <loteDistDFeInt>
            <docZip schema="${schema}" NSU="000000000000001">${documentZip}</docZip>
          </loteDistDFeInt>
        </retDistDFeInt>
      </soap:Body>
    </soap:Envelope>`;
}

test("inspectCertificate rejects a file that is not a valid A1 certificate", () => {
  assert.throws(
    () => inspectCertificate({ pfx: Buffer.from("arquivo-invalido"), passphrase: "senha" }),
    (error) => error instanceof CertificateError && /Nao foi possivel abrir/i.test(error.message)
  );
});

test("certificate session is removed and its in-memory buffer is cleared", () => {
  const buffer = Buffer.from("dados-sensiveis-do-certificado");
  const { id } = storeCertificate({ buffer, fileName: "empresa.pfx" });

  assert.equal(getCertificate(id)?.buffer, buffer);
  discardCertificate(id);
  assert.equal(getCertificate(id), null);
  assert.deepEqual(buffer, Buffer.alloc(buffer.length));
});

test("buildDistributionEnvelope uses the selected company and target access key", () => {
  const envelope = buildDistributionEnvelope({
    key: accessKey,
    cnpj: "44823938000187",
    authorUfCode: "35"
  });

  assert.match(envelope, /<cUFAutor>35<\/cUFAutor>/);
  assert.match(envelope, /<CNPJ>44823938000187<\/CNPJ>/);
  assert.match(envelope, new RegExp(`<chNFe>${accessKey}<\\/chNFe>`));
});

test("access key identifies the invoice year and month, while XML has the exact issue date", () => {
  assert.equal(getIssueMonthFromAccessKey(accessKey), "2026-04");
  assert.equal(
    getIssueDateFromXml("<NFe><infNFe><ide><dhEmi>2026-04-09T12:00:00-03:00</dhEmi></ide></infNFe></NFe>"),
    "2026-04-09T12:00:00-03:00"
  );
});

test("buildDistNsuEnvelope sends the saved NSU cursor for the selected company", () => {
  const envelope = buildDistNsuEnvelope({
    cnpj: "44823938000187",
    authorUfCode: "35",
    ultNsu: "42"
  });

  assert.match(envelope, /<CNPJ>44823938000187<\/CNPJ>/);
  assert.match(envelope, /<distNSU><ultNSU>000000000000042<\/ultNSU><\/distNSU>/);
});

test("NSU fallback has a short batch limit before releasing the next fallback", () => {
  assert.equal(MAX_NSU_BATCHES_PER_FALLBACK, 3);
});

test("extractCompleteXml accepts a complete NF-e process document", async () => {
  const completeXml = "<?xml version=\"1.0\"?><nfeProc versao=\"4.00\"></nfeProc>";
  const response = createSefazResponse(completeXml);

  assert.equal(await extractCompleteXml(response), completeXml);
});

test("extractCompleteXml reports summary-only returns instead of saving them", async () => {
  const summaryXml = "<?xml version=\"1.0\"?><resNFe versao=\"1.01\"></resNFe>";
  const response = createSefazResponse(summaryXml, "resNFe_v1.01.xsd");

  await assert.rejects(
    extractCompleteXml(response),
    (error) =>
      error?.errorCode === "documento_resumido" &&
      /apenas um resumo do documento/i.test(error.message)
  );
});

test("extractCompleteXml reports when SEFAZ cannot authorize the certificate for the key", async () => {
  const response = `
    <retDistDFeInt xmlns="http://www.portalfiscal.inf.br/nfe">
      <cStat>137</cStat>
      <xMotivo>Nenhum documento localizado</xMotivo>
    </retDistDFeInt>`;

  await assert.rejects(
    extractCompleteXml(response),
    (error) =>
      error?.errorCode === "certificado_sem_autorizacao" &&
      error?.sefaz?.queryType === "consChNFe" &&
      error?.sefaz?.submitted === true &&
      error?.sefaz?.cStat === "137" &&
      error?.sefaz?.xMotivo === "Nenhum documento localizado"
  );
});

test("parseDistributionResponse keeps the NSU cursor and decodes complete XMLs", async () => {
  const completeXml = `<?xml version="1.0"?><nfeProc><NFe><infNFe Id="NFe${accessKey}" /></NFe></nfeProc>`;
  const response = createSefazResponse(completeXml).replace(
    "<loteDistDFeInt>",
    "<ultNSU>000000000000042</ultNSU><maxNSU>000000000000090</maxNSU><loteDistDFeInt>"
  );

  const parsed = await parseDistributionResponse(response, {
    lookupMode: "nfe-distribution-nsu"
  });

  assert.equal(parsed.cStat, "138");
  assert.equal(parsed.ultNsu, "000000000000042");
  assert.equal(parsed.maxNsu, "000000000000090");
  assert.equal(parsed.documents.length, 1);
  assert.equal(parsed.documents[0].key, accessKey);
  assert.equal(parsed.documents[0].isComplete, true);
});

test("parseDistributionResponse accepts cStat 137 so NSU flow can schedule its wait", async () => {
  const parsed = await parseDistributionResponse(`
    <retDistDFeInt xmlns="http://www.portalfiscal.inf.br/nfe">
      <cStat>137</cStat>
      <xMotivo>Nenhum documento localizado</xMotivo>
      <ultNSU>000000000000042</ultNSU>
      <maxNSU>000000000000042</maxNSU>
    </retDistDFeInt>
  `);

  assert.equal(parsed.cStat, "137");
  assert.equal(parsed.ultNsu, "000000000000042");
  assert.equal(parsed.maxNsu, "000000000000042");
  assert.deepEqual(parsed.documents, []);
});
