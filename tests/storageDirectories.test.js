const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { saveOrganizedXml } = require("../src/xmlStorage");
const { resolveStorageDirectory, storageBase } = require("../src/storageDirectories");

const key = "35260444823938000187551090000002691092067649";
const cnpj = key.slice(6, 20);
const xml = '<NFe><dhEmi>2026-04-09T12:00:00-03:00</dhEmi></NFe>';

test("saving from a selected company, month or type folder reuses the complete destination", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "storage-folders-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const leaf = path.join(root, cnpj, "2026-04", "saidas");
  await fs.mkdir(leaf, { recursive: true });
  for (const selected of [root, path.join(root, cnpj), path.dirname(leaf), leaf]) {
    const file = await saveOrganizedXml(xml, key, selected, { type: "saidas" });
    assert.equal(file, path.join(leaf, `${key}.xml`));
  }
  assert.deepEqual(await fs.readdir(leaf), [`${key}.xml`]);
  assert.deepEqual(await fs.readdir(path.join(root, cnpj)), ["2026-04"]);
});

test("already duplicated company folders are reused and another period becomes a sibling", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "storage-folders-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const company = path.join(root, cnpj, cnpj);
  const selected = path.join(company, "2026-04", "saidas");
  await fs.mkdir(selected, { recursive: true });
  assert.equal(storageBase(selected), root);
  assert.equal(await saveOrganizedXml(xml, key, selected, { type: "saidas" }), path.join(selected, `${key}.xml`));
  const differentMonthXml = xml.replace("2026-04-09", "2026-05-09");
  const next = await saveOrganizedXml(differentMonthXml, key, selected, { type: "saidas" });
  assert.equal(next, path.join(company, "2026-05", "saidas", `${key}.xml`));
  assert.deepEqual(await fs.readdir(selected), [`${key}.xml`]);
});

test("formatted CNPJ, accented singular types and month-first naming are preserved", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "storage-folders-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const company = path.join(root, "44.823.938-0001-87");
  const leaf = path.join(company, "Saída", "04-2026");
  await fs.mkdir(leaf, { recursive: true });
  const saved = await saveOrganizedXml(xml, key, root, { type: "saidas" });
  assert.equal(saved, path.join(leaf, `${key}.xml`));
  assert.equal(storageBase(leaf), root);
  const next = await saveOrganizedXml(xml.replace("2026-04-09", "2026-05-09"), key, leaf, { type: "saidas" });
  assert.equal(next, path.join(company, "Saída", "2026-05", `${key}.xml`));
  assert.deepEqual(await fs.readdir(root), ["44.823.938-0001-87"]);
});

test("a different company is kept outside the currently selected company hierarchy", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "storage-folders-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const selected = path.join(root, cnpj, "2026-04", "saidas");
  await fs.mkdir(selected, { recursive: true });
  const other = "11111111000111";
  const destination = await resolveStorageDirectory({ downloadsDir: selected, cnpj: other, period: "2026-04", type: "entradas" });
  assert.equal(destination, path.join(root, other, "2026-04", "entradas"));
  assert.deepEqual(await fs.readdir(selected), []);
});
