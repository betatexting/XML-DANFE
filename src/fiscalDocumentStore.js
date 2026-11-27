const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID, createHash } = require("node:crypto");
const { getFiscalDownloadsDir } = require("./runtimePaths");

const types = new Set(["nfe", "nfce", "nfse", "cte", "mdfe"]);
function companyDirectory(company, type, root = getFiscalDownloadsDir()) {
  if (!/^\d{11}(?:\d{3})?$/.test(company) || !types.has(type)) throw new Error("Empresa ou tipo fiscal inválido.");
  return path.join(root, company, type);
}
const equivalent = (a, b) => a.equals(b) || a.toString("utf8").trim() === b.toString("utf8").trim();

// Publish a complete file without replacing a previous XML, even during concurrent writes.
async function saveXmlFile(file, buffer, { versions = false } = {}) {
  buffer = Buffer.from(buffer);
  const candidates = [file];
  if (versions) candidates.push(file.replace(/\.xml$/i, `_${createHash("sha256").update(buffer).digest("hex")}.xml`));
  await fs.mkdir(path.dirname(file), { recursive: true });
  for (const target of candidates) {
    const temporary = target + "." + randomUUID() + ".tmp";
    await fs.writeFile(temporary, buffer, { mode: 0o600, flag: "wx" });
    try {
      try { await fs.link(temporary, target); return { file: target, saved: true }; }
      catch (error) {
        if (error.code !== "EEXIST") throw error;
        if (equivalent(await fs.readFile(target), buffer)) return { file: target, saved: false };
      }
    } finally { await fs.unlink(temporary); }
  }
  throw Object.assign(new Error("XML divergente para uma chave já salva. Arquivo original e progresso preservados."), { status: 502 });
}

function xmlKey(buffer) {
  const { parseXml } = require("./localXml");
  const root = parseXml(buffer.toString("utf8"));
  function visit(node) {
    for (const attr of Object.values(node.attributes || {})) {
      const key = attr.value.replace(/^(?:NFS|NFe|CTe|MDFe)/i, "");
      if (attr.local === "Id" && /^(?:\d{44}|\d{50})$/.test(key)) return key;
    }
    for (const child of node.children) { const key = visit(child); if (key) return key; }
  }
  return visit(root);
}
async function existingNotes(directory, found = new Map()) {
  let entries;
  try { entries = await fs.readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === "ENOENT") return found; throw error; }
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await existingNotes(file, found);
    if (!entry.isFile() || !/\.xml$/i.test(entry.name)) continue;
    let buffer;
    try { buffer = await fs.readFile(file); }
    catch (error) { if (error.code === "ENOENT") continue; throw error; }
    let key;
    try { key = xmlKey(buffer); } catch { continue; }
    if (key) {
      if (found.has(key) && !equivalent(found.get(key), buffer)) throw Object.assign(new Error("Há XMLs locais divergentes para a mesma chave."), { status: 502 });
      found.set(key, buffer);
    }
  }
  return found;
}

async function saveFiscalBatch({ company, type, notes, root, directory = companyDirectory(company, type, root), legacyDirectories = [] }) {
  const existing = await existingNotes(directory);
  for (const legacy of legacyDirectories) if (legacy !== directory) await existingNotes(legacy, existing);
  const documents = [], files = new Map(), seen = new Set();
  let duplicateCount = 0;
  for (const note of notes) {
    if (!/^(?:\d{44}|\d{50})$/.test(note.key)) throw new Error("Chave fiscal inválida.");
    if (seen.has(note.key)) {
      if (!equivalent(existing.get(note.key), note.buffer)) throw Object.assign(new Error("Lote com XMLs divergentes para a mesma chave."), { status: 502 });
      continue;
    }
    seen.add(note.key);
    const previous = existing.get(note.key);
    if (previous && !equivalent(previous, note.buffer)) throw Object.assign(new Error("XML divergente para uma chave já salva. Arquivo original e progresso preservados."), { status: 502 });
    const result = await saveXmlFile(path.join(directory, note.key + ".xml"), note.buffer);
    files.set(note.key, result.file);
    existing.set(note.key, note.buffer);
    if (previous || !result.saved) duplicateCount++;
    else documents.push(note);
  }
  return { documents, files, savedCount: documents.length, duplicateCount, directory };
}

async function findFiscalDocument({ company, type, key, root, legacyDirectories = [] }) {
  if (!/^(?:\d{44}|\d{50})$/.test(key)) throw new Error("Chave fiscal inválida.");
  for (const directory of [companyDirectory(company, type, root), ...legacyDirectories]) {
    const found = await existingNotes(directory);
    if (found.has(key)) return found.get(key);
  }
  return null;
}

module.exports = { companyDirectory, saveXmlFile, saveFiscalBatch, findFiscalDocument };
