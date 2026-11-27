const fs = require("fs/promises");
const path = require("path");
const { parseXml } = require("./localXml");
const { storageBase } = require("./storageDirectories");
const { getFiscalDownloadsDir } = require("./runtimePaths");

const child = (node, name) => node?.children.find((item) => item.name === name);
const value = (node, name) => child(node, name)?.text.trim() || "";
function descendant(node, name) {
  if (node?.name === name) return node;
  for (const item of node?.children || []) { const found = descendant(item, name); if (found) return found; }
  return null;
}
function identifyDownloadedNote(xml) {
  const root = parseXml(xml);
  if (["nfeproc", "procnfe"].includes(root.name)) {
    const info = child(child(root, "nfe"), "infnfe");
    const protocol = child(child(root, "protnfe"), "infprot");
    const model = value(child(info, "ide"), "mod");
    const cnpj = value(child(info, "emit"), "cnpj");
    if (info && protocol && ["100", "150"].includes(value(protocol, "cstat")) && /^\d{14}$/.test(cnpj) && ["55", "65"].includes(model)) return { cnpj, type: model === "55" ? "nfe" : "nfc" };
  }
  // Recognize completed NFS-e documents, never RPS/DPS requests or summaries.
  if (["compnfse", "nfse"].includes(root.name)) {
    const info = descendant(root, "infnfse");
    const provider = child(info, "prestadorservico") || child(info, "emit");
    const cnpj = descendant(provider, "cnpj")?.text.trim() || "";
    if (info && /^\d{14}$/.test(cnpj) && (value(info, "numero") || value(info, "nnfse"))) return { cnpj, type: "nfs" };
  }
  return null;
}

async function readNoteInventory({ companies, downloadsDir }) {
  const byCnpj = new Map();
  for (const company of companies) {
    const cnpj = String(company.cnpj || "").replace(/\D/g, "");
    if (/^\d{14}$/.test(cnpj)) byCnpj.set(cnpj, { nfe: 0, nfs: 0, nfc: 0 });
  }
  if (!byCnpj.size) return { companies: [] };
  const directories = [...new Set([storageBase(downloadsDir), getFiscalDownloadsDir()])];
  const visited = new Set();
  while (directories.length) {
    const directory = directories.pop();
    if (visited.has(path.resolve(directory))) continue;
    visited.add(path.resolve(directory));
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); }
    catch (error) { if (error.code === "ENOENT") continue; throw error; }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) { if (entry.name.toLowerCase() !== "diagnosticos") directories.push(filename); continue; }
      if (!entry.isFile() || !/\.xml$/i.test(entry.name)) continue;
      const stat = await fs.stat(filename).catch((error) => { if (error.code === "ENOENT") return null; throw error; });
      if (!stat || stat.size > 12 * 1024 * 1024) continue;
      let xml;
      try { xml = await fs.readFile(filename, "utf8"); } catch (error) { if (error.code === "ENOENT") continue; throw error; }
      let note;
      try { note = identifyDownloadedNote(xml); } catch { continue; }
      if (note && byCnpj.has(note.cnpj)) byCnpj.get(note.cnpj)[note.type]++;
    }
  }
  return { companies: companies.flatMap((company) => {
    const counts = byCnpj.get(String(company.cnpj || "").replace(/\D/g, ""));
    return counts && Object.values(counts).some(Boolean) ? [{ ...company, notes: counts }] : [];
  }) };
}

function installNoteInventoryRoutes(app, { getDownloadsDir }) {
  app.get("/api/note-filter", async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const { companies } = await app.locals.companyCatalog.list();
      res.json(await readNoteInventory({ companies, downloadsDir: getDownloadsDir() }));
    } catch { res.status(500).json({ error: "Não foi possível conferir as notas baixadas." }); }
  });
}
module.exports = { identifyDownloadedNote, readNoteInventory, installNoteInventoryRoutes };
