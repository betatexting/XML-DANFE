const XLSX = require("xlsx");
const { createHash } = require("crypto");
const { normalizeHeader } = require("./spreadsheetKeys");

function validFiscalKey(key, models = ["55", "65"]) {
  if (!/^\d{44}$/.test(key) || !models.includes(key.slice(20, 22))) return false;
  let sum = 0, weight = 2;
  for (let index = 42; index >= 0; index--) { sum += Number(key[index]) * weight; weight = weight === 9 ? 2 : weight + 1; }
  const rest = sum % 11;
  return Number(key[43]) === (rest < 2 ? 0 : 11 - rest);
}
const validNfeKey = (key) => validFiscalKey(key, ["55"]);
function isoDate(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})/) || text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const [year, month, day] = match[1].length === 4 ? match.slice(1).map(Number) : [Number(match[3]), Number(match[2]), Number(match[1])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` : null;
}
function parsePortalSpreadsheet(buffer, filename, { model = "55" } = {}) {
  if (!["55", "65"].includes(model)) throw new Error("Modelo fiscal inválido para importar chaves.");
  const invalid = () => Object.assign(new Error("A planilha recebida não possui uma estrutura válida de chaves para o modelo fiscal selecionado."), { code: "spreadsheet_invalid" });
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > 20 * 1024 * 1024) throw invalid();
  if (/^\s*(?:<!doctype|<html|<form)/i.test(buffer.subarray(0, 200).toString("utf8"))) throw invalid();
  let input = buffer, type = "buffer";
  if (/\.csv$/i.test(filename)) {
    const utf8 = new TextDecoder("utf-8", { fatal: true });
    try { input = utf8.decode(buffer); } catch { input = new TextDecoder("windows-1252").decode(buffer); }
    input = input.replace(/^\uFEFF/, ""); type = "string";
  }
  let workbook;
  try { workbook = XLSX.read(input, { type, raw: true, cellDates: false }); } catch { throw invalid(); }
  const records = new Map(), rejected = [], headers = [];
  let rowCount = 0, duplicateCount = 0, foundHeader = false;
  for (const sheetName of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true, defval: "" });
    let headerIndex = -1, keyIndex = -1, authorizationIndex = -1, statusIndex = -1;
    for (let index = 0; index < Math.min(30, rows.length); index++) {
      const normalized = rows[index].map(normalizeHeader);
      const column = normalized.findIndex((value) => ["chave de acesso", "chave de acesso da nf e", "chave da nf e", "chave acesso", "chave de acesso da nfc e", "chave da nfc e", "chave nfce"].includes(value));
      if (column >= 0) {
        headerIndex = index; keyIndex = column;
        authorizationIndex = normalized.findIndex((value) => /^(data de autorizacao|data autorizacao|autorizacao)$/.test(value));
        statusIndex = normalized.findIndex((value) => /^(situacao|situacao da nota|status)$/.test(value));
        headers.push(rows[index].map(String)); break;
      }
    }
    if (headerIndex < 0) continue;
    foundHeader = true;
    for (let index = headerIndex + 1; index < rows.length; index++) {
      const row = rows[index]; if (!row.some((cell) => String(cell).trim())) continue;
      rowCount++;
      const cell = row[keyIndex], key = typeof cell === "string" ? cell.trim().replace(/^'/, "").replace(/\s/g, "") : "";
      if (!validFiscalKey(key, [model])) { rejected.push({ row: index + 1, reason: typeof cell === "number" ? "numeric_key_precision" : "invalid_fiscal_key" }); continue; }
      if (records.has(key)) duplicateCount++;
      records.set(key, { key, authorizationDate: authorizationIndex >= 0 ? isoDate(row[authorizationIndex]) : null, situation: statusIndex >= 0 ? String(row[statusIndex]).slice(0, 100) : "", row: index + 1 });
    }
  }
  if (!foundHeader || (rowCount && !records.size)) throw invalid();
  return { records: [...records.values()], rowCount, duplicateCount, rejectedCount: rejected.length, rejected: rejected.slice(0, 20), headers, sha256: createHash("sha256").update(buffer).digest("hex") };
}
module.exports = { validFiscalKey, validNfeKey, isoDate, parsePortalSpreadsheet };
