const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { getCertificateOrganization, normalizeOrganization, saveOrganizedXml } = require("../src/xmlStorage");

const key = "35260444823938000187551090000002691092067649";

test("downloads separate emitters and months and preserve XML contents", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "xml-storage-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const xml = '<NFe><ide><dhEmi>2026-05-01T00:15:00+03:00</dhEmi></ide><dest><CNPJ>11111111000111</CNPJ></dest></NFe>';
  const saved = await saveOrganizedXml(xml, key, directory);
  assert.equal(saved, path.join(directory, "44823938000187", "2026-05", `${key}.xml`));
  assert.equal(await fs.readFile(saved, "utf8"), `${xml}\n`);

  const otherKey = "29260621444661000186550030000065351001699396";
  const other = await saveOrganizedXml("<NFe/>", otherKey, directory);
  assert.equal(other, path.join(directory, "21444661000186", "2026-06", `${otherKey}.xml`));
  assert.equal(await fs.readFile(saved, "utf8"), `${xml}\n`);

  const legacy = await saveOrganizedXml('<n:NFe><n:dEmi>2026-03-15</n:dEmi></n:NFe>', key, directory);
  assert.equal(path.dirname(legacy), path.join(directory, "44823938000187", "2026-03"));
});

test("invalid keys or periods cannot create misplaced files", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "xml-storage-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await assert.rejects(saveOrganizedXml("<NFe/>", "../invalid", directory), /Chave invalida/);
  const invalidMonth = `${key.slice(0, 4)}13${key.slice(6)}`;
  await assert.rejects(saveOrganizedXml("<NFe/>", invalidMonth, directory), /Periodo de emissao invalido/);
  assert.deepEqual(await fs.readdir(directory), []);
});

test("entry and exit choices use the correct party or the company supplied by the user", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "xml-storage-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const xml = '<NFe><dest><CNPJ>11111111000111</CNPJ></dest></NFe>';
  const entry = await saveOrganizedXml(xml, key, directory, { type: "entradas" });
  assert.equal(entry, path.join(directory, "11111111000111", "2026-04", "entradas", `${key}.xml`));
  const exit = await saveOrganizedXml(xml, key, directory, { type: "saidas" });
  assert.equal(exit, path.join(directory, "44823938000187", "2026-04", "saidas", `${key}.xml`));
  const override = await saveOrganizedXml(xml, key, directory, { type: "entradas", cnpj: "22.222.222/0001-22" });
  assert.equal(override, path.join(directory, "22222222000122", "2026-04", "entradas", `${key}.xml`));
  await assert.rejects(saveOrganizedXml('<NFe><dest><CPF>12345678901</CPF></dest></NFe>', key, directory, { type: "entradas" }), /nao possui CNPJ/);
});

test("company identification sorts mixed invoices and rejects unrelated companies", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "xml-storage-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const organization = { type: "auto", cnpj: "44823938000187" };
  const xml = '<n:NFe><n:dest><n:CNPJ>44823938000187</n:CNPJ></n:dest></n:NFe>';
  const incomingKey = "29260621444661000186550030000065351001699396";
  const entry = await saveOrganizedXml(xml, incomingKey, directory, organization);
  const exit = await saveOrganizedXml(xml, key, directory, organization);
  assert.equal(entry, path.join(directory, organization.cnpj, "2026-06", "entradas", `${incomingKey}.xml`));
  assert.equal(exit, path.join(directory, organization.cnpj, "2026-04", "saidas", `${key}.xml`));
  await assert.rejects(saveOrganizedXml("<NFe/>", incomingKey, directory, organization), /nao e emitente nem destinatario/);
  assert.throws(() => normalizeOrganization({ type: "auto" }), /14 digitos/);
  assert.throws(() => normalizeOrganization({ type: "..", cnpj: "44823938000187" }), /Selecione entradas/);
  assert.throws(() => normalizeOrganization({ type: "saidas", cnpj: "abc44823938000187" }), /14 digitos/);
  assert.deepEqual(normalizeOrganization(JSON.stringify({ type: "auto", cnpj: "44.823.938/0001-87" })), organization);
});

test("certificate organization reads the parties and emission month from XML", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "xml-storage-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const organization = getCertificateOrganization({ cnpj: "44823938000187" });
  assert.deepEqual(organization, { type: "auto", cnpj: "44823938000187", requireXmlMetadata: true });
  // XML parties and period deliberately differ from the key to verify their source.
  const incoming = '<n:NFe><n:ide><n:dhEmi>2026-05-01T00:15:00-03:00</n:dhEmi></n:ide><n:emit><n:CNPJ>21444661000186</n:CNPJ></n:emit><n:dest><n:CNPJ>44823938000187</n:CNPJ></n:dest></n:NFe>';
  const entry = await saveOrganizedXml(incoming, key, directory, organization);
  assert.equal(entry, path.join(directory, organization.cnpj, "2026-05", "entradas", `${key}.xml`));
  const outgoing = incoming.replace('21444661000186', organization.cnpj).replace('<n:dest><n:CNPJ>44823938000187', '<n:dest><n:CNPJ>11111111000111');
  const exit = await saveOrganizedXml(outgoing, key, directory, organization);
  assert.equal(exit, path.join(directory, organization.cnpj, "2026-05", "saidas", `${key}.xml`));
  await assert.rejects(saveOrganizedXml('<NFe><emit><CNPJ>44823938000187</CNPJ></emit></NFe>', key, directory, organization), /data de emissao valida/);
  await assert.rejects(saveOrganizedXml('<NFe><dhEmi>2026-05-01</dhEmi></NFe>', key, directory, organization), /CNPJ do emitente/);
  await assert.rejects(saveOrganizedXml(incoming.replaceAll(organization.cnpj, '11111111000111'), key, directory, organization), /nao e emitente nem destinatario/);
});
