const XLSX = require("xlsx");
const { extractAccessKeys } = require("./accessKeys");

const ACCESS_KEY_HEADER = "chave de acesso";
const SUPPORTED_SPREADSHEET_EXTENSIONS = new Set([".csv", ".xlsx", ".xlsm", ".xls"]);

function normalizeHeader(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function getFirstWorksheet(workbook) {
  const firstSheetName = workbook?.SheetNames?.[0];
  if (!firstSheetName) {
    return {
      sheetName: "",
      sheet: null
    };
  }

  return {
    sheetName: firstSheetName,
    sheet: workbook.Sheets[firstSheetName] ?? null
  };
}

function findAccessKeyColumnIndex(headerRow) {
  return headerRow.findIndex((value) => normalizeHeader(value) === ACCESS_KEY_HEADER);
}

function buildNoKeyFoundMessage() {
  return [
    'Nao encontramos chaves validas na coluna "Chave de Acesso".',
    "Se a planilha converteu a chave para numero ou formato cientifico, exporte a coluna como texto e tente novamente."
  ].join(" ");
}

async function extractCandidatesFromSpreadsheetFiles(files) {
  const candidates = [];

  for (const file of files) {
    try {
      const workbook = XLSX.read(file.buffer, {
        type: "buffer",
        raw: false,
        dense: true
      });
      const { sheetName, sheet } = getFirstWorksheet(workbook);

      if (!sheet) {
        candidates.push({
          sourceName: file.originalname,
          sourceType: "planilha",
          status: "error",
          message: "A planilha nao tem abas utilizaveis."
        });
        continue;
      }

      const rows = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        raw: false,
        defval: ""
      });
      const headerRow = Array.isArray(rows[0]) ? rows[0] : [];
      const accessKeyColumnIndex = findAccessKeyColumnIndex(headerRow);

      if (accessKeyColumnIndex === -1) {
        candidates.push({
          sourceName: file.originalname,
          sourceType: "planilha",
          sheetName,
          status: "error",
          message:
            'Nao encontramos o cabecalho "Chave de Acesso" na primeira linha da planilha.'
        });
        continue;
      }

      let foundAnyKey = false;

      for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
        const row = Array.isArray(rows[rowIndex]) ? rows[rowIndex] : [];
        const cellValue = row[accessKeyColumnIndex];

        if (cellValue === undefined || cellValue === null || String(cellValue).trim() === "") {
          continue;
        }

        const keys = extractAccessKeys(String(cellValue));
        if (keys.length === 0) {
          continue;
        }

        foundAnyKey = true;

        for (const key of keys) {
          candidates.push({
            sourceName: file.originalname,
            sourceType: "planilha",
            sheetName,
            rowNumber: rowIndex + 1,
            key,
            status: "pending"
          });
        }
      }

      if (!foundAnyKey) {
        candidates.push({
          sourceName: file.originalname,
          sourceType: "planilha",
          sheetName,
          status: "error",
          message: buildNoKeyFoundMessage()
        });
      }
    } catch (error) {
      candidates.push({
        sourceName: file.originalname,
        sourceType: "planilha",
        status: "error",
        message: error.message || "Falha ao ler a planilha enviada."
      });
    }
  }

  return candidates;
}

module.exports = {
  ACCESS_KEY_HEADER,
  SUPPORTED_SPREADSHEET_EXTENSIONS,
  extractCandidatesFromSpreadsheetFiles,
  findAccessKeyColumnIndex,
  normalizeHeader
};
