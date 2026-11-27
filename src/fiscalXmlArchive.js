const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const AdmZip = require("adm-zip");
const { parseXml } = require("./localXml");
const { identifyCte } = require("./cteDistribution");
const { getUserDataDir, getFiscalDownloadsDir } = require("./runtimePaths");
const { storageBase } = require("./storageDirectories");
const { cteDirection, fiscalArchivePath } = require("./fiscalXmlPaths");
const { validateManifestXml } = require("./mdfeDownload");

const types = new Set(["nfe", "nfce", "nfse", "cte", "mdfe"]);
const monthPattern = /^\d{4}-(?:0[1-9]|1[0-2])$/;
const child = (node, name) => node?.children.find((item) => item.name === name);
const value = (node, name) => child(node, name)?.text.trim() || "";
const identity = (node) => value(node, "cnpj") || value(node, "cpf");
function descendant(node, name) {
  if (node?.name === name) return node;
  for (const entry of node?.children || []) {
    const found = descendant(entry, name);
    if (found) return found;
  }
}
function identifyExportXml(xml, document, sourceType) {
  const root = parseXml(xml);
  if (["nfeproc", "procnfe"].includes(root.name) && !sourceType) {
    const info = child(child(root, "nfe"), "infnfe");
    const protocol = child(child(root, "protnfe"), "infprot");
    const model = value(child(info, "ide"), "mod");
    if (!["55", "65"].includes(model) || !["100", "150"].includes(value(protocol, "cstat")) ||
        !["emit", "dest"].some((tag) => identity(child(info, tag)) === document)) return null;
    return { type: model === "55" ? "nfe" : "nfce", key: value(protocol, "chnfe"), date: value(child(info, "ide"), "dhemi") || value(child(info, "ide"), "demi"),
      direction: identity(child(info, "emit")) === document ? "saidas" : "entradas" };
  }
  if (root.name === "cteproc" && (!sourceType || sourceType === "cte")) {
    const note = identifyCte(xml, document);
    const info = child(child(root, "cte"), "infcte"), protocol = child(child(root, "protcte"), "infprot");
    if (identity(child(info, "emit")) === document && ["100", "150"].includes(value(protocol, "cstat"))) {
      return { type: "cte", key: value(protocol, "chcte"), date: value(child(info, "ide"), "dhemi"), direction: "saidas" };
    }
    if (note) return { type: "cte", key: note.key, date: note.issuedAt, direction: cteDirection(note.roles) };
  }
  if (root.name === "mdfeproc" && (!sourceType || sourceType === "mdfe")) {
    const info = child(child(root, "mdfe"), "infmdfe"), protocol = child(child(root, "protmdfe"), "infprot");
    if (identity(child(info, "emit")) === document && value(protocol, "cstat") === "100") {
      return { type: "mdfe", key: value(protocol, "chmdfe"), date: value(child(info, "ide"), "dhemi"), direction: "saidas" };
    }
  }
  if (["nfse", "compnfse"].includes(root.name) && (!sourceType || sourceType === "nfse")) {
    const info = descendant(root, "infnfse");
    if (!info || !(value(info, "nnfse") || value(info, "numero"))) return null;
    const dps = child(child(info, "dps"), "infdps");
    const municipalActors = ["prestadorservico", "tomadorservico", "intermediarioservico"]
      .map((tag) => child(info, tag) || descendant(child(info, "declaracaoprestacaoservico"), tag));
    const matches = (tag, index) => identity(child(dps, tag)) === document ||
      ["cnpj", "cpf"].some((id) => descendant(municipalActors[index], id)?.text.trim() === document);
    const direction = identity(child(info, "emit")) === document || matches("prest", 0) ? "saidas" :
      matches("toma", 1) ? "tomadas" : matches("interm", 2) ? "entradas" : "";
    if (sourceType !== "nfse" && !direction) return null;
    const key = Object.values(info.attributes).find(({ local }) => local === "Id")?.value.replace(/^NFS/i, "");
    return { type: "nfse", key, date: value(info, "dhproc") || value(info, "dataemissao") || value(dps, "dhemi"), direction };
  }
  return null;
}

async function* xmlFiles(directory) {
  let entries;
  try { entries = await fs.readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === "ENOENT") return; throw error; }
  for (const entry of entries) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory() && !["diagnosticos", "diagnostics"].includes(entry.name.toLowerCase())) yield* xmlFiles(filename);
    if (entry.isFile() && /\.xml$/i.test(entry.name)) yield filename;
  }
}

function installFiscalArchiveRoutes(app, { getDownloadsDir, dataDir = getUserDataDir(), archiveRoot = getFiscalDownloadsDir() }) {
  app.get("/api/companies/:id/fiscal-xml/archive", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const { type = "all", month = "", format = "zip" } = req.query;
      if ((type !== "all" && !types.has(type)) || typeof month !== "string" || (month && !monthPattern.test(month))) {
        return res.status(400).json({ error: "Selecione um tipo fiscal e um mês válidos." });
      }
      if (format !== "zip" && (format !== "keys" || type !== "mdfe" || !month)) {
        return res.status(400).json({ error: "Selecione uma competência para exportar as chaves de MDF-e." });
      }
      const { companies } = await app.locals.companyCatalog.list();
      const company = companies.find(({ id }) => id === req.params.id);
      if (!company) return res.status(404).json({ error: "Empresa não encontrada." });
      const document = String(company.cnpj || company.document || "").replace(/[.\/\s-]/g, "");
      if (!/^(?:\d{11}|\d{14})$/.test(document)) return res.status(400).json({ error: "Confira o CPF ou CNPJ da empresa." });
      const sources = [[storageBase(getDownloadsDir()), null], [archiveRoot, null]];
      for (const sourceType of ["nfse", "cte", "mdfe"]) {
        if (type === "all" || type === sourceType) sources.push([path.join(archiveRoot, document, sourceType), sourceType]);
      }
      for (const sourceType of ["cte", "nfse", "mdfe"]) {
        if (type === "all" || type === sourceType) sources.push([path.join(dataDir, sourceType + "-distribution", document), sourceType]);
      }
      const zip = format === "zip" ? new AdmZip() : null;
      const added = new Set();
      const availableMonths = new Set();
      for (const [directory, sourceType] of sources) {
        for await (const file of xmlFiles(directory)) {
          let buffer;
          try {
            if ((await fs.stat(file)).size > 12 * 1024 * 1024) continue;
            buffer = await fs.readFile(file);
          } catch (error) {
            if (error.code === "ENOENT") continue;
            throw error;
          }
          let note;
          try { note = identifyExportXml(buffer.toString("utf8"), document, sourceType); }
          catch { continue; }
          if (!note || (type !== "all" && note.type !== type)) continue;
          if (format === "keys") {
            try { validateManifestXml(buffer, note.key); }
            catch { continue; }
          }
          const issuedMonth = note.date.slice(0, 7);
          if (monthPattern.test(issuedMonth)) availableMonths.add(issuedMonth);
          if (month && issuedMonth !== month) continue;
          if (format === "keys") {
            added.add(note.key);
            continue;
          }
          const key = /^\d{44}(?:\d{6})?$/.test(note.key || "") ? note.key : createHash("sha256").update(buffer).digest("hex");
          const name = fiscalArchivePath({ document, ...note, filename: key });
          if (added.has(name)) continue;
          zip.addFile(name, buffer);
          added.add(name);
        }
      }
      if (!added.size) {
        const months = [...availableMonths].sort().reverse();
        const periods = months.map((value) => `${value.slice(5)}/${value.slice(0, 4)}`);
        const error = periods.length ? `Nenhum XML no mês selecionado. Meses disponíveis: ${periods.join(", ")}.` :
          "Nenhum XML salvo corresponde à empresa e aos filtros selecionados.";
        return res.status(404).json({ error, availableMonths: months });
      }
      if (format === "keys") {
        return res.attachment(`chaves-mdfe-${month}.txt`).type("text/plain").send([...added].sort().join("\r\n") + "\r\n");
      }
      res.attachment(`xml-${type}-${month || "todos-os-meses"}.zip`).type("application/zip").send(zip.toBuffer());
    } catch {
      res.status(500).json({ error: "Não foi possível exportar os documentos fiscais salvos." });
    }
  });
}

module.exports = { installFiscalArchiveRoutes, identifyExportXml };
