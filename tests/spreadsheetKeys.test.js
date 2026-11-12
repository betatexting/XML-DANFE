const test = require("node:test");
const assert = require("node:assert/strict");
const XLSX = require("xlsx");
const {
  extractCandidatesFromSpreadsheetFiles,
  findAccessKeyColumnIndex,
  normalizeHeader
} = require("../src/spreadsheetKeys");

function createWorkbookBuffer(rows, bookType = "xlsx") {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Dados");

  return XLSX.write(workbook, {
    type: "buffer",
    bookType
  });
}

test("normalizeHeader should ignore accents and casing", () => {
  assert.equal(normalizeHeader(" Chave de Acesso "), "chave de acesso");
  assert.equal(normalizeHeader("CHAVE DE ACESSO"), "chave de acesso");
});

test("findAccessKeyColumnIndex should find the expected header", () => {
  assert.equal(findAccessKeyColumnIndex(["Numero", "Chave de Acesso", "Serie"]), 1);
  assert.equal(findAccessKeyColumnIndex(["Numero", "Chave", "Serie"]), -1);
});

test("extractCandidatesFromSpreadsheetFiles should read keys from xlsx column", async () => {
  const key = "35260444823938000187551090000002691092067649";
  const buffer = createWorkbookBuffer([
    ["Empresa", "Chave de Acesso"],
    ["ACME", key]
  ]);

  const [candidate] = await extractCandidatesFromSpreadsheetFiles([
    {
      originalname: "notas.xlsx",
      buffer
    }
  ]);

  assert.equal(candidate.status, "pending");
  assert.equal(candidate.sourceType, "planilha");
  assert.equal(candidate.key, key);
  assert.equal(candidate.sheetName, "Dados");
  assert.equal(candidate.rowNumber, 2);
});

test("extractCandidatesFromSpreadsheetFiles should support csv files", async () => {
  const key = "35260444823938000187551090000002691092067649";
  const buffer = Buffer.from(`Cliente,Chave de Acesso\nLoja 1,${key}\n`, "utf8");

  const [candidate] = await extractCandidatesFromSpreadsheetFiles([
    {
      originalname: "notas.csv",
      buffer
    }
  ]);

  assert.equal(candidate.status, "pending");
  assert.equal(candidate.key, key);
  assert.equal(candidate.rowNumber, 2);
});

test("extractCandidatesFromSpreadsheetFiles should report missing header", async () => {
  const buffer = createWorkbookBuffer([
    ["Empresa", "Serie"],
    ["ACME", "1"]
  ]);

  const [candidate] = await extractCandidatesFromSpreadsheetFiles([
    {
      originalname: "sem-chave.xlsx",
      buffer
    }
  ]);

  assert.equal(candidate.status, "error");
  assert.match(candidate.message, /Chave de Acesso/);
});
